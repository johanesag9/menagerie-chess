/** Helpers shared by the core tests (not used by the app). */
import { Chess } from 'chess.js';
import type { BotLevel, GameController, GameEventMap, GameOptions, MoveInput, MoveResult, Square } from '../contracts/types';
import type { BotEngine } from './bot';
import { CoreGame, type CoreDeps } from './game';

export const LOCAL: GameOptions = { opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false };

export function makeGame(options: Partial<GameOptions> = {}, deps: CoreDeps = {}): CoreGame {
  const g = new CoreGame({ botMinThinkMs: 0, ...deps });
  g.newGame({ ...LOCAL, ...options });
  return g;
}

/** SAN -> MoveInput for the current position. */
export function sanToInput(fen: string, san: string): MoveInput {
  const m = new Chess(fen).move(san);
  return { from: m.from as Square, to: m.to as Square, promotion: m.promotion as MoveInput['promotion'] };
}

export function playSan(g: GameController, sans: string[]): MoveResult[] {
  return sans.map((san) => {
    const r = g.move(sanToInput(g.fen, san));
    if (!r) throw new Error(`illegal in test script: ${san} at ${g.fen}`);
    return r;
  });
}

/** Records every event name (and payload) in order. */
export function recordEvents(g: GameController) {
  const log: { name: keyof GameEventMap; payload: unknown }[] = [];
  const names: (keyof GameEventMap)[] = [
    'gameStarted', 'moved', 'turnChanged', 'check', 'gameOver', 'clock', 'botThinking', 'weirdEvent', 'undone', 'emote',
  ];
  for (const n of names) g.on(n, (payload) => log.push({ name: n, payload }));
  return log;
}

/** Deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Engine double: answers with the first legal move (sorted), immediately or when released. */
export class FakeEngine implements BotEngine {
  searches: { fen: string; level: BotLevel; budgetMs: number | null }[] = [];
  cancelled = 0;
  private waiting: (() => void)[] = [];
  constructor(public manual = false) {}

  search(fen: string, level: BotLevel, budgetMs: number | null): Promise<string | null> {
    this.searches.push({ fen, level, budgetMs });
    const answer = () => new Chess(fen).moves({ verbose: true }).map((m) => m.lan).sort()[0] ?? null;
    if (!this.manual) return Promise.resolve(answer());
    return new Promise((resolve) => this.waiting.push(() => resolve(answer())));
  }
  release(): void {
    this.waiting.splice(0).forEach((f) => f());
  }
  newGame(): void {}
  cancel(): void {
    this.cancelled++;
  }
  dispose(): void {}
}

export const flush = () => new Promise((r) => setTimeout(r, 5));
