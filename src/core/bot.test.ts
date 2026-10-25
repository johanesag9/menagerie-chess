import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { BotLevel } from '../contracts/types';
import { BOT_LEVELS, StockfishEngine, type UciTransport } from './bot';
import { FakeEngine, flush, makeGame, playSan, recordEvents, seeded } from './testUtils';

const vsBot = (level: BotLevel, botSide: 'land' | 'sea' = 'sea') => ({ opponent: { type: 'bot' as const, level, botSide } });

describe('bot games', () => {
  it('the bot replies, emitting botThinking around its move', async () => {
    const engine = new FakeEngine();
    const g = makeGame(vsBot(5), { createEngine: () => engine });
    const log = recordEvents(g);
    playSan(g, ['e4']);
    await flush();
    expect(g.history).toHaveLength(2);
    expect(g.history[1].side).toBe('sea');
    const names = log.map((e) => e.name).filter((n) => n !== 'clock');
    expect(names.slice(names.indexOf('botThinking'))).toEqual(['botThinking', 'botThinking', 'moved', 'turnChanged']);
    expect(log.filter((e) => e.name === 'botThinking').map((e) => e.payload)).toEqual([
      { side: 'sea', thinking: true },
      { side: 'sea', thinking: false },
    ]);
  });

  it('refuses human moves for the bot side', async () => {
    const engine = new FakeEngine(true);
    const g = makeGame(vsBot(5), { createEngine: () => engine });
    playSan(g, ['e4']);
    expect(g.move({ from: 'e7', to: 'e5' })).toBeNull();
    expect(g.legalTargets('e7')).toEqual([]);
  });

  it('undo takes back the bot reply and your move, restoring ids', async () => {
    const engine = new FakeEngine();
    const g = makeGame(vsBot(4), { createEngine: () => engine });
    const start = g.pieces;
    playSan(g, ['e4']);
    await flush();
    playSan(g, ['d4']);
    await flush();
    expect(g.history).toHaveLength(4);
    const afterTwo = g.history.slice(0, 2).map((m) => m.san);
    const log = recordEvents(g);
    g.undo();
    expect(g.history.map((m) => m.san)).toEqual(afterTwo);
    g.undo();
    expect(g.history).toHaveLength(0);
    expect(g.turn).toBe('land');
    expect(g.pieces).toEqual(start);
    const undone = log.filter((e) => e.name === 'undone');
    expect(undone).toHaveLength(2);
    expect((undone[1].payload as { pieces: unknown }).pieces).toEqual(start);
    await flush();
    expect(g.history).toHaveLength(0); // the bot doesn't move again on your turn
  });

  it('undo while the bot is thinking takes back your move and drops its late answer', async () => {
    const engine = new FakeEngine(true);
    const g = makeGame(vsBot(6), { createEngine: () => engine });
    const log = recordEvents(g);
    playSan(g, ['e4']);
    g.undo();
    expect(engine.cancelled).toBe(1);
    expect(log.filter((e) => e.name === 'botThinking').map((e) => (e.payload as { thinking: boolean }).thinking)).toEqual([true, false]);
    engine.release();
    await flush();
    expect(g.history).toHaveLength(0);
  });

  it('bot playing Land opens; undo does nothing until you have moved', async () => {
    const engine = new FakeEngine();
    const g = makeGame(vsBot(3, 'land'), { createEngine: () => engine, random: () => 0.99 });
    await flush();
    expect(g.history).toHaveLength(1);
    g.undo();
    expect(g.history).toHaveLength(1);
  });

  it('pause holds the bot reply until resume', async () => {
    const engine = new FakeEngine();
    const g = makeGame(vsBot(5), { createEngine: () => engine });
    playSan(g, ['e4']);
    g.pause();
    await flush();
    expect(g.history).toHaveLength(1);
    g.resume();
    expect(g.history).toHaveLength(2);
  });

  it('low levels sometimes play a random move without asking the engine', async () => {
    const engine = new FakeEngine();
    const g = makeGame(vsBot(1), { createEngine: () => engine, random: () => 0.01 });
    playSan(g, ['e4']);
    await flush();
    expect(g.history).toHaveLength(2);
    expect(engine.searches).toHaveLength(0);
  });

  it('falls back to a simple bot when no engine is available', async () => {
    const g = makeGame(vsBot(8), { createEngine: () => null });
    playSan(g, ['e4']);
    await flush();
    expect(g.history).toHaveLength(2);
  });

  it('timed games give the engine a think-time budget from its clock', async () => {
    const engine = new FakeEngine();
    const g = makeGame({ ...vsBot(8), time: { initialMs: 60_000, incrementMs: 0 } }, { createEngine: () => engine });
    playSan(g, ['e4']);
    await flush();
    expect(engine.searches[0].budgetMs).toBeGreaterThan(1500);
    expect(engine.searches[0].budgetMs).toBeLessThanOrEqual(2000);
  });

  it('a game against the bot can be played to the end', async () => {
    const engine = new FakeEngine();
    const rnd = seeded(3);
    const g = makeGame(vsBot(5), { createEngine: () => engine });
    for (let i = 0; i < 200 && !g.isOver(); i++) {
      const legal = new Chess(g.fen).moves({ verbose: true });
      const m = legal[Math.floor(rnd() * legal.length)];
      expect(g.move({ from: m.from as never, to: m.to as never, promotion: m.promotion as never })).not.toBeNull();
      await flush();
    }
    expect(g.history.length).toBeGreaterThan(20);
  });
});

describe('level table', () => {
  it('gets stronger with every level', () => {
    for (let l = 2; l <= 8; l++) {
      const a = BOT_LEVELS[(l - 1) as BotLevel];
      const b = BOT_LEVELS[l as BotLevel];
      expect(b.skill).toBeGreaterThan(a.skill);
      expect(b.depth).toBeGreaterThan(a.depth);
      expect(b.movetimeMs).toBeGreaterThan(a.movetimeMs);
      expect(b.randomChance).toBeLessThanOrEqual(a.randomChance);
    }
    expect(BOT_LEVELS[1].randomChance).toBeGreaterThan(0);
    expect(BOT_LEVELS[4].randomChance).toBe(0);
  });
});

describe('real Stockfish (lite, single-threaded WASM)', () => {
  /** Runs the same engine build in node, through the npm package's loader. */
  async function nodeTransport(): Promise<UciTransport> {
    // A variable specifier keeps node types out of the browser-only tsconfig.
    const nodeModule = 'node:module';
    const { createRequire } = await import(/* @vite-ignore */ nodeModule);
    const require = createRequire(import.meta.url);
    let listener: (l: string) => void = () => {};
    const engine = require('stockfish')('lite-single', (line: string) => listener(line));
    return {
      send: (cmd) => engine.processCommand(cmd),
      onLine: (fn) => (listener = fn),
      onError: () => {},
      terminate: () => engine.terminate?.(),
    };
  }

  it('answers with a legal move at levels 1, 4 and 8', async () => {
    const sf = new StockfishEngine(await nodeTransport());
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3'; // Qxf7# is on
    for (const level of [1, 4, 8] as BotLevel[]) {
      const uci = await sf.search(fen, level, 300);
      expect(uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
      expect(() => new Chess(fen).move(uci!)).not.toThrow();
    }
    expect(await sf.search(fen, 8, 500)).toBe('f3f7'); // a strong level finds mate in one
    sf.dispose();
  }, 60_000);
});
