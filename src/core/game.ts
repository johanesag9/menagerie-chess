/**
 * GameController: chess.js rules + stable piece ids + clocks + bot + Weird Mode.
 *
 * Event order after every move: moved, check (if any), turnChanged, gameOver (if any).
 * A `weirdEvent` (Weird Mode only) and a `clock` update follow when the game goes on.
 */
import { Chess, DEFAULT_POSITION, type Move } from 'chess.js';
import { Emitter } from '../contracts/emitter';
import type {
  EmoteKind,
  GameController,
  GameEventMap,
  GameOptions,
  GameOver,
  MoveFlag,
  MoveInput,
  MoveResult,
  PieceId,
  PieceState,
  Side,
  Square,
  Unsubscribe,
} from '../contracts/types';
import { colorToSide } from '../contracts/types';
import { BOT_LEVELS, clockBudget, fallbackMove, randomMove, type BotEngine } from './bot';
import { ChessClock, type ClockSnapshot } from './clock';
import { opposite, PieceTracker, type TrackerSnapshot } from './ids';
import { assertPlayableFen, detectGameOver, hasMatingMaterial, kingSquare, turnOf } from './rules';
import { WeirdScheduler } from './weird';

/** MoveResult plus the new piece's id when a pawn promotes (see REPORT.md, contract requests). */
export type CoreMoveResult = MoveResult & { promotedId?: PieceId };

export interface CoreDeps {
  /** Makes the bot engine, once, the first time a bot game starts. Return null to use the simple fallback bot. */
  createEngine?: () => BotEngine | null;
  /** Milliseconds, monotonic. Default: performance.now. */
  now?: () => number;
  /** 0..1. Default: Math.random. */
  random?: () => number;
  /** Override every level's minimum think time (tests use 0). */
  botMinThinkMs?: number;
  /** How often `clock` fires while a clock runs. Default 100ms. */
  clockTickMs?: number;
}

interface PlyRecord {
  move: CoreMoveResult;
  tracker: TrackerSnapshot;
  clock: ClockSnapshot & { running: Side | null };
}

const DEFAULT_OPTIONS: GameOptions = {
  opponent: { type: 'local' },
  time: { initialMs: null, incrementMs: 0 },
  weirdMode: false,
};

/** Endings you can't take back with undo. */
const FINAL_REASONS: GameOver['reason'][] = ['resign', 'timeout', 'agreement'];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class CoreGame implements GameController {
  private events = new Emitter<GameEventMap>();
  private chess = new Chess();
  private tracker = new PieceTracker();
  private clock: ChessClock;
  private weird: WeirdScheduler;
  private options: GameOptions = DEFAULT_OPTIONS;
  private plies: PlyRecord[] = [];
  private over: GameOver | null = null;
  private paused = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private engine: BotEngine | null | undefined;
  private botToken = 0;
  private botThinking = false;
  private heldBotMove: string | null = null;
  private disposed = false;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private deps: CoreDeps = {}) {
    this.now = deps.now ?? (() => performance.now());
    this.random = deps.random ?? Math.random;
    this.clock = new ChessClock(this.now);
    this.weird = new WeirdScheduler(this.random);
    this.tracker.reset(this.chess);
    this.clock.reset(DEFAULT_OPTIONS.time);
  }

  on<K extends keyof GameEventMap>(name: K, fn: (payload: GameEventMap[K]) => void): Unsubscribe {
    return this.events.on(name, fn);
  }

  // ---------- state ----------

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Side {
    return turnOf(this.chess);
  }

  get pieces(): PieceState[] {
    return this.tracker.pieces(this.chess);
  }

  get history(): MoveResult[] {
    return this.plies.map((p) => p.move);
  }

  isOver(): GameOver | null {
    return this.over;
  }

  legalTargets(from: Square): Square[] {
    if (this.over || this.isBotTurn()) return [];
    return [...new Set(this.chess.moves({ square: from, verbose: true }).map((m) => m.to as Square))];
  }

  needsPromotion(from: Square, to: Square): boolean {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && !!m.promotion);
  }

  // ---------- game flow ----------

  newGame(options: GameOptions): void {
    const fen = options.fen?.trim() || DEFAULT_POSITION;
    assertPlayableFen(fen); // throws before anything changes

    this.cancelBot();
    this.options = { ...options, opponent: { ...options.opponent }, time: { ...options.time } };
    this.chess = new Chess(fen);
    this.tracker.reset(this.chess);
    this.plies = [];
    this.over = null;
    this.paused = false;
    this.clock.reset(options.time);
    this.weird.reset();
    this.syncTicker();
    if (options.opponent.type === 'bot') this.getEngine()?.newGame();

    const turn = this.turn;
    this.events.emit('gameStarted', { options: this.options, pieces: this.pieces, fen: this.fen, turn });
    this.emitClock();
    if (this.chess.inCheck()) this.events.emit('check', { side: turn, kingSquare: kingSquare(this.chess, turn) });
    this.events.emit('turnChanged', { turn, legalMoveCount: this.chess.moves().length });

    const over = detectGameOver(this.chess, opposite(turn));
    if (over) this.finish(over);
    else this.maybeStartBot();
  }

  move(input: MoveInput): MoveResult | null {
    if (this.over || this.disposed || this.isBotTurn()) return null;
    return this.play(input);
  }

  undo(): void {
    if (!this.plies.length || this.disposed) return;
    if (this.over && FINAL_REASONS.includes(this.over.reason)) return;

    let count = 1;
    const opp = this.options.opponent;
    if (opp.type === 'bot') {
      // Take back plies until the human's latest move is gone (so it's the human's turn again).
      const human = opposite(opp.botSide);
      const lastHuman = this.plies.map((p) => p.move.side).lastIndexOf(human);
      if (lastHuman < 0) return; // only the bot has moved; nothing of yours to take back
      count = this.plies.length - lastHuman;
    }

    this.cancelBot();
    let first: PlyRecord | undefined;
    for (let i = 0; i < count; i++) {
      this.chess.undo();
      first = this.plies.pop();
    }
    this.tracker.restore(first!.tracker);
    this.clock.restore(first!.clock);
    this.over = null;
    this.syncTicker();

    const turn = this.turn;
    this.events.emit('undone', { fen: this.fen, pieces: this.pieces });
    this.emitClock();
    if (this.chess.inCheck()) this.events.emit('check', { side: turn, kingSquare: kingSquare(this.chess, turn) });
    this.events.emit('turnChanged', { turn, legalMoveCount: this.chess.moves().length });
    this.maybeStartBot();
  }

  resign(side: Side): void {
    if (this.over || this.disposed) return;
    this.finish({ winner: opposite(side), reason: 'resign' });
  }

  sendEmote(side: Side, emote: EmoteKind): void {
    this.events.emit('emote', { side, emote });
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.clock.setPaused(true);
    this.emitClock();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.clock.setPaused(false);
    this.emitClock();
    if (this.heldBotMove) this.applyBotMove(this.heldBotMove);
  }

  dispose(): void {
    this.cancelBot();
    this.disposed = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.engine?.dispose();
    this.engine = null;
    this.events.clear();
  }

  // ---------- internals ----------

  private play(input: MoveInput): CoreMoveResult | null {
    if (this.checkFlag()) return null;
    const mover = this.turn;
    const promotion = input.promotion ?? (this.needsPromotion(input.from, input.to) ? 'q' : undefined);
    const before = { tracker: this.tracker.snapshot(), clock: this.clock.snapshot() };

    let m: Move;
    try {
      m = this.chess.move({ from: input.from, to: input.to, promotion });
    } catch {
      return null;
    }

    const tracked = this.tracker.apply(m);
    const check = this.chess.inCheck();
    const result: CoreMoveResult = {
      pieceId: tracked.pieceId,
      side: mover,
      kind: m.piece,
      from: m.from as Square,
      to: m.to as Square,
      san: m.san,
      flags: moveFlags(m),
      check,
      fenAfter: m.after,
    };
    if (tracked.captured) result.captured = tracked.captured;
    if (tracked.rookMove) result.rookMove = tracked.rookMove;
    if (m.promotion) {
      result.promotion = m.promotion;
      result.promotedId = tracked.promotedId;
    }
    this.plies.push({ move: result, ...before });

    const over = detectGameOver(this.chess, mover);
    const next = colorToSide(this.chess.turn());
    this.clock.pressAfterMove(mover, over ? null : next);

    this.events.emit('moved', result);
    if (check) this.events.emit('check', { side: next, kingSquare: kingSquare(this.chess, next) });
    this.events.emit('turnChanged', { turn: next, legalMoveCount: this.chess.moves().length });

    if (over) {
      this.finish(over);
    } else {
      if (this.options.weirdMode) {
        const e = this.weird.onPly(this.pieces, next);
        if (e) this.events.emit('weirdEvent', e);
      }
      this.emitClock();
      this.maybeStartBot();
    }
    return result;
  }

  private finish(over: GameOver): void {
    this.over = over;
    this.clock.stop();
    this.cancelBot();
    this.syncTicker();
    this.emitClock();
    this.events.emit('gameOver', over);
  }

  /** Ends the game if the side to move has run out of time. */
  private checkFlag(): boolean {
    const loser = this.clock.flagged();
    if (!loser || this.over) return false;
    const winner = opposite(loser);
    this.finish({ winner: hasMatingMaterial(this.chess, winner) ? winner : null, reason: 'timeout' });
    return true;
  }

  private syncTicker(): void {
    const want = this.clock.timed && !this.over && !this.disposed;
    if (want && !this.ticker) {
      this.ticker = setInterval(() => {
        if (this.over || !this.clock.ticking) return;
        if (!this.checkFlag()) this.emitClock();
      }, this.deps.clockTickMs ?? 100);
    } else if (!want && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private emitClock(): void {
    this.events.emit('clock', {
      landMs: this.clock.remaining('land'),
      seaMs: this.clock.remaining('sea'),
      running: this.over ? null : this.clock.ticking,
    });
  }

  // ---------- bot ----------

  private isBotTurn(): boolean {
    const o = this.options.opponent;
    return o.type === 'bot' && this.turn === o.botSide;
  }

  private maybeStartBot(): void {
    const o = this.options.opponent;
    if (o.type !== 'bot' || this.over || this.disposed || !this.isBotTurn() || this.botThinking) return;

    const token = ++this.botToken;
    const cfg = BOT_LEVELS[o.level];
    this.setBotThinking(true);

    let pick: Promise<string | null>;
    if (this.random() < cfg.randomChance) {
      pick = Promise.resolve(randomMove(this.chess, this.random));
    } else {
      const engine = this.getEngine();
      const budget = clockBudget(this.clock.remaining(o.botSide), this.options.time.incrementMs);
      pick = engine ? engine.search(this.fen, o.level, budget) : Promise.resolve(null);
    }

    void Promise.all([pick, wait(this.deps.botMinThinkMs ?? cfg.minThinkMs)]).then(([uci]) => {
      if (token !== this.botToken) return; // cancelled by undo, new game, resign...
      const chosen = uci ?? fallbackMove(this.chess, this.random);
      if (!chosen) return this.setBotThinking(false);
      if (this.paused) this.heldBotMove = chosen;
      else this.applyBotMove(chosen);
    });
  }

  private applyBotMove(uci: string): void {
    this.heldBotMove = null;
    this.setBotThinking(false);
    const toInput = (u: string): MoveInput => ({
      from: u.slice(0, 2) as Square,
      to: u.slice(2, 4) as Square,
      promotion: (u[4] as MoveInput['promotion']) || undefined,
    });
    if (this.play(toInput(uci)) || this.over) return;
    console.warn(`[core] bot suggested an illegal move (${uci}); using the fallback`);
    const alt = fallbackMove(this.chess, this.random);
    if (alt) this.play(toInput(alt));
  }

  private cancelBot(): void {
    this.botToken++;
    this.heldBotMove = null;
    if (this.botThinking) {
      this.engine?.cancel();
      this.setBotThinking(false);
    }
  }

  private setBotThinking(thinking: boolean): void {
    const o = this.options.opponent;
    if (this.botThinking === thinking || o.type !== 'bot') return;
    this.botThinking = thinking;
    this.events.emit('botThinking', { side: o.botSide, thinking });
  }

  private getEngine(): BotEngine | null {
    if (this.engine === undefined) this.engine = this.deps.createEngine?.() ?? null;
    return this.engine;
  }
}

function moveFlags(m: Move): MoveFlag[] {
  const flags: MoveFlag[] = [];
  if (m.captured) flags.push('capture');
  if (m.isEnPassant()) flags.push('enPassant');
  if (m.isKingsideCastle()) flags.push('castleKing');
  if (m.isQueensideCastle()) flags.push('castleQueen');
  if (m.isPromotion()) flags.push('promotion');
  if (m.isBigPawn()) flags.push('doublePush');
  return flags;
}
