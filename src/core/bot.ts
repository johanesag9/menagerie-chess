/**
 * The bot: level table, a UCI engine wrapper for Stockfish, and a simple fallback.
 * The engine talks UCI over a transport, so the same code runs on a Web Worker (browser)
 * or on the stockfish npm module (node tests).
 */
import type { Chess } from 'chess.js';
import type { BotLevel } from '../contracts/types';

export interface BotLevelConfig {
  /** Stockfish "Skill Level", 0..20. */
  skill: number;
  /** Search depth cap. */
  depth: number;
  /** Search time cap in ms. */
  movetimeMs: number;
  /** Chance of playing a random legal move instead (makes low levels feel human). */
  randomChance: number;
  /** Shortest time the bot appears to think, so replies don't snap in. */
  minThinkMs: number;
}

/** 1 = a child can win, 8 = very strong. Tune here. */
export const BOT_LEVELS: Record<BotLevel, BotLevelConfig> = {
  1: { skill: 0, depth: 1, movetimeMs: 50, randomChance: 0.3, minThinkMs: 700 },
  2: { skill: 2, depth: 2, movetimeMs: 100, randomChance: 0.15, minThinkMs: 700 },
  3: { skill: 4, depth: 4, movetimeMs: 150, randomChance: 0.06, minThinkMs: 650 },
  4: { skill: 7, depth: 6, movetimeMs: 250, randomChance: 0, minThinkMs: 600 },
  5: { skill: 10, depth: 8, movetimeMs: 400, randomChance: 0, minThinkMs: 500 },
  6: { skill: 14, depth: 12, movetimeMs: 700, randomChance: 0, minThinkMs: 450 },
  7: { skill: 17, depth: 16, movetimeMs: 1000, randomChance: 0, minThinkMs: 400 },
  8: { skill: 20, depth: 22, movetimeMs: 1500, randomChance: 0, minThinkMs: 400 },
};

export interface BotEngine {
  /** Best move in UCI form ("e2e4", "e7e8q"), or null if cancelled or the engine failed. */
  search(fen: string, level: BotLevel, budgetMs: number | null): Promise<string | null>;
  newGame(): void;
  /** Stop the current search early. Its promise still settles. */
  cancel(): void;
  dispose(): void;
}

export interface UciTransport {
  send(cmd: string): void;
  onLine(fn: (line: string) => void): void;
  onError(fn: (err: unknown) => void): void;
  terminate(): void;
}

const READY_TIMEOUT_MS = 20000;

export class StockfishEngine implements BotEngine {
  private ready: Promise<boolean>;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: ((uci: string | null) => void) | null = null;
  private waiters: { match: (l: string) => boolean; resolve: () => void }[] = [];
  private failed = false;
  private disposed = false;

  constructor(private t: UciTransport) {
    t.onLine((line) => this.handle(line));
    t.onError((err) => this.fail(err));
    this.ready = this.handshake();
  }

  search(fen: string, level: BotLevel, budgetMs: number | null): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      if (!(await this.ready) || this.failed || this.disposed) return null;
      const cfg = BOT_LEVELS[level];
      const movetime = Math.max(30, Math.round(budgetMs === null ? cfg.movetimeMs : Math.min(cfg.movetimeMs, budgetMs)));
      return new Promise<string | null>((resolve) => {
        this.pending = resolve;
        this.t.send(`setoption name Skill Level value ${cfg.skill}`);
        this.t.send(`position fen ${fen}`);
        this.t.send(`go depth ${cfg.depth} movetime ${movetime}`);
      });
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => null);
    return p;
  }

  newGame(): void {
    this.queue = this.queue.then(async () => {
      if (!(await this.ready) || this.failed) return;
      await this.ask('ucinewgame\nisready', 'readyok');
    });
  }

  cancel(): void {
    if (this.pending) this.t.send('stop');
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.(null);
    this.pending = null;
    try {
      this.t.send('quit');
    } catch {
      /* already gone */
    }
    this.t.terminate();
  }

  private async handshake(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((r) => (timer = setTimeout(() => r(false), READY_TIMEOUT_MS)));
    const ok = (async () => {
      await this.ask('uci', 'uciok');
      await this.ask('isready', 'readyok');
      return !this.failed;
    })();
    const result = await Promise.race([ok, timeout]);
    clearTimeout(timer);
    if (!result) this.fail(new Error('Stockfish did not start in time'));
    return result;
  }

  /** Send commands and wait for a reply line. The waiter goes in first: some engines answer synchronously. */
  private ask(cmds: string, reply: string): Promise<void> {
    const p = new Promise<void>((resolve) => this.waiters.push({ match: (l) => l === reply, resolve }));
    for (const c of cmds.split('\n')) this.t.send(c);
    return p;
  }

  private handle(raw: unknown): void {
    if (typeof raw !== 'string') return; // download-progress objects etc.
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith('bestmove')) {
        const mv = l.split(/\s+/)[1];
        const done = this.pending;
        this.pending = null;
        done?.(mv && mv !== '(none)' ? mv : null);
      }
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(l)) return true;
        w.resolve();
        return false;
      });
    }
  }

  private fail(err: unknown): void {
    if (this.failed) return;
    this.failed = true;
    console.warn('[core] Stockfish failed, the bot falls back to simple moves.', err);
    this.pending?.(null);
    this.pending = null;
    this.waiters.forEach((w) => w.resolve());
    this.waiters = [];
  }
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * Stand-in move picker for when Stockfish is unavailable: mates first, then the biggest capture,
 * otherwise a random move. Weak on purpose; it only keeps the game going.
 */
export function fallbackMove(chess: Chess, random: () => number): string | null {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const mate = moves.find((m) => m.san.endsWith('#'));
  const best = mate ?? [...moves].sort((a, b) => (VALUE[b.captured ?? ''] ?? 0) - (VALUE[a.captured ?? ''] ?? 0))[0];
  const pick = mate || best.captured ? best : moves[Math.floor(random() * moves.length)];
  return pick.lan;
}

export function randomMove(chess: Chess, random: () => number): string | null {
  const moves = chess.moves({ verbose: true });
  return moves.length ? moves[Math.floor(random() * moves.length)].lan : null;
}

/** Think-time budget from the bot's clock, so it never flags itself. */
export function clockBudget(remainingMs: number | null, incrementMs: number): number | null {
  if (remainingMs === null) return null;
  return Math.max(50, remainingMs / 30 + incrementMs * 0.8);
}
