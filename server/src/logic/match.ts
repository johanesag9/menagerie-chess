/**
 * Match: one game of core, driven only by NetInputs. The room runs one; every browser's mirror runs the same.
 * Imports the core classes directly (never src/core/index.ts, which pulls in the Stockfish worker).
 */
import { ArenaGame } from '../../../src/core/arena/game';
import { MenagerieGame } from '../../../src/core/controller';
import { legalActions as modeActions } from '../../../src/core/modes/rules';
import type { NetInput } from '../../../src/contracts/net';
import type {
  ActionInput, ArenaAction, DuelInfo, GameOptions, GameOver, Hand, Side, Square,
} from '../../../src/contracts/types';
import { isArenaMode } from '../../../src/contracts/types';

export const HANDS: Hand[] = ['rock', 'paper', 'scissors'];

/** What core waits for now, and from whom. A throw waits for both duel sides. */
export type Need =
  | { kind: 'turn'; side: Side }
  | { kind: 'bonus'; side: Side }
  | { kind: 'answer'; side: Side }
  | { kind: 'throw'; attacker: Side; defender: Side };

export type ApplyResult = { ok: true } | { ok: false; reason: string; broken?: boolean };

const GAME_EVENTS = [
  'gameStarted', 'moved', 'turnChanged', 'check', 'gameOver', 'clock', 'botThinking', 'weirdEvent', 'undone', 'emote',
  'modeState', 'powerUsed', 'cardPlayed', 'bonusUsed', 'dieRolled', 'cardDrawn', 'turnPassed', 'logged', 'wheelSpun',
  'duelOffered', 'duelRound', 'duelEnded', 'bonked',
] as const;
const ARENA_EVENTS = [
  'started', 'state', 'rolled', 'acted', 'sank', 'wheelSpun', 'duelOffered', 'duelRound', 'duelEnded', 'bonked',
  'turnChanged', 'logged', 'gameOver', 'botThinking',
] as const;

export class Match {
  readonly arenaMode: boolean;
  private chess: MenagerieGame | null = null;
  private arena: ArenaGame | null = null;
  private duel: { info: DuelInfo; stage: 'offer' | 'throw' } | null = null;
  /** Every core event as JSON, when asked for (the determinism tests compare these). */
  readonly events: string[] = [];

  constructor(readonly options: GameOptions, opts: { record?: boolean } = {}) {
    this.arenaMode = isArenaMode(options.mode);
    const onEvent = (name: string) => (payload: unknown) => {
      if (opts.record) this.events.push(`${name} ${JSON.stringify(payload)}`);
      if (name === 'duelOffered') this.duel = { info: payload as DuelInfo, stage: 'offer' };
      else if (name === 'duelEnded' || name === 'gameOver') this.duel = null;
    };
    if (this.arenaMode) {
      const g = (this.arena = new ArenaGame());
      for (const name of ARENA_EVENTS) g.on(name, onEvent(name));
      g.newGame(options);
    } else {
      const g = (this.chess = new MenagerieGame());
      for (const name of GAME_EVENTS) g.on(name, onEvent(name));
      g.newGame(options);
    }
  }

  /** Build a match and replay inputs into it (a room waking from hibernation, or a mirror catching up). */
  static replay(options: GameOptions, inputs: NetInput[], opts: { record?: boolean } = {}): Match {
    const m = new Match(options, opts);
    for (const input of inputs) {
      const r = m.apply(input);
      if (!r.ok) throw new Error(`Replay refused a stored input (${r.reason}): ${JSON.stringify(input)}`);
    }
    return m;
  }

  over(): GameOver | null {
    return this.arena ? this.arena.state.phase === 'over' ? lastOver(this.arena) : null : this.chess!.isOver();
  }

  /** The side whose turn it is (the attacker during a duel). */
  turn(): Side {
    return this.arena ? this.arena.state.turn : this.chess!.turn;
  }

  need(): Need | null {
    if (this.over()) return null;
    if (this.duel) {
      const { attacker, defender } = this.duel.info;
      return this.duel.stage === 'offer' ? { kind: 'answer', side: defender } : { kind: 'throw', attacker, defender };
    }
    const side = this.turn();
    if (!this.arena && this.chess!.modeState?.phase === 'bonus') return { kind: 'bonus', side };
    return { kind: 'turn', side };
  }

  /** Check an input against whose go it is, then apply it to core. Core refusing it leaves core unchanged. */
  apply(input: NetInput): ApplyResult {
    const need = this.need();
    const side = input.side;
    try {
      if (input.k === 'resign') {
        if (!need) return { ok: false, reason: 'The game is over' };
        this.arena ? this.arena.resign(side) : this.chess!.resign(side);
        return { ok: true };
      }
      if (!need) return { ok: false, reason: 'The game is over' };
      switch (input.k) {
        case 'act': {
          if (!this.chess) return { ok: false, reason: 'This is a party mode' };
          if ((need.kind !== 'turn' && need.kind !== 'bonus') || need.side !== side) return { ok: false, reason: 'Not your turn' };
          const r = this.chess.act(input.input);
          return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? 'Not a legal action' };
        }
        case 'arena': {
          if (!this.arena) return { ok: false, reason: 'This is a chess mode' };
          if (need.kind !== 'turn' || need.side !== side) return { ok: false, reason: 'Not your turn' };
          const r = this.arena.act(input.action);
          return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? 'Not a legal action' };
        }
        case 'duel': {
          if (need.kind !== 'answer' || need.side !== side) return { ok: false, reason: 'No duel to answer' };
          this.arena ? this.arena.answerDuel(input.call) : this.chess!.answerDuel(input.call);
          if (this.duel) this.duel.stage = 'throw'; // called: the throws start (not called: duelEnded cleared it)
          return { ok: true };
        }
        case 'throw': {
          if (need.kind !== 'throw' || (side !== need.attacker && side !== need.defender)) return { ok: false, reason: 'No duel throw now' };
          this.arena ? this.arena.throwHand(side, input.hand) : this.chess!.throwHand(side, input.hand);
          return { ok: true };
        }
      }
    } catch (err) {
      // Core threw half-way: its state can't be trusted any more. The room rebuilds it from the stored inputs.
      return { ok: false, reason: 'Core error', broken: true };
    }
  }

  /** The input the room makes when time runs out (GAME_SPEC "Online play" defaults). */
  autoInputs(random: () => number, missing: Side[] = []): NetInput[] {
    const need = this.need();
    if (!need) return [];
    switch (need.kind) {
      case 'answer':
        return [{ k: 'duel', side: need.side, call: false }];
      case 'throw':
        return missing.map((side) => ({ k: 'throw', side, hand: HANDS[Math.floor(random() * 3)] }));
      case 'bonus':
        return [{ k: 'act', side: need.side, input: { type: 'bonus', choice: 'skip' } }];
      case 'turn': {
        if (this.arena) return [{ k: 'arena', side: need.side, action: { type: 'endTurn' } }];
        const move = this.randomAction(random);
        return move ? [{ k: 'act', side: need.side, input: move }] : [{ k: 'resign', side: need.side }];
      }
    }
  }

  /** A random legal move found through core's own target API; a random power or card if no animal can move. */
  private randomAction(random: () => number): ActionInput | null {
    const g = this.chess!;
    const side = g.turn;
    const moves: ActionInput[] = [];
    for (const p of g.pieces) {
      if (p.side !== side) continue;
      for (const to of g.legalTargets(p.square)) moves.push({ type: 'move', from: p.square, to });
    }
    if (moves.length) return moves[Math.floor(random() * moves.length)];
    if (g.mode === 'classic') return null;
    const all = modeActions(g.modes.state);
    return all.length ? all[Math.floor(random() * all.length)] : null;
  }

  /** Everything a player can see, as one string (the determinism tests compare these). */
  fingerprint(): string {
    if (this.arena) return JSON.stringify({ state: this.arena.state, log: this.arena.log, over: this.over() });
    const g = this.chess!;
    return JSON.stringify({
      fen: g.fen, turn: g.turn, pieces: g.pieces, history: g.history.map((m) => m.san), modeState: g.modeState, log: g.log,
      over: g.isOver(),
    });
  }

  /** For tests and the random driver: the raw controllers. */
  get controller(): MenagerieGame | null {
    return this.chess;
  }
  get arenaController(): ArenaGame | null {
    return this.arena;
  }

  dispose(): void {
    this.chess?.dispose();
    this.arena?.dispose();
  }
}

/** ArenaState doesn't carry the result; take it from the raw model. */
function lastOver(g: ArenaGame): GameOver | null {
  return g.raw.over ?? null;
}

// ---------- input shape checks (before core ever sees an input) ----------

const SQUARE = /^[a-h][1-8]$/;
const isSquare = (x: unknown): x is Square => typeof x === 'string' && SQUARE.test(x);
const isSide = (x: unknown): x is Side => x === 'land' || x === 'sea';
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 24;
const isSquares = (x: unknown, max = 4): x is Square[] => Array.isArray(x) && x.length <= max && x.every(isSquare);

function isActionInput(a: unknown): a is ActionInput {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  switch (x.type) {
    case 'move':
      return isSquare(x.from) && isSquare(x.to) && (x.promotion === undefined || ['n', 'b', 'r', 'q'].includes(x.promotion as string));
    case 'power':
      return isId(x.pieceId) && isSquares(x.targets);
    case 'card':
      return isId(x.cardId) && (x.pieceId === undefined || isId(x.pieceId)) && isSquares(x.targets);
    case 'bonus':
      return x.choice === 'skip' || ((x.choice === 'recharge' || x.choice === 'pawnStep') && isSquares(x.targets, 1) && (x.targets as unknown[]).length === 1);
    default:
      return false;
  }
}

function isArenaAction(a: unknown): a is ArenaAction {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  switch (x.type) {
    case 'endTurn': return true;
    case 'step': return isId(x.pieceId) && isSquare(x.to);
    case 'hit': return isId(x.pieceId) && isSquare(x.target);
    case 'power': return isId(x.pieceId) && isSquares(x.targets);
    default: return false;
  }
}

/** A clean copy of a well-formed NetInput (unknown fields dropped), or null. */
export function cleanInput(raw: unknown): NetInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  if (!isSide(x.side)) return null;
  const side = x.side;
  switch (x.k) {
    case 'act': {
      if (!isActionInput(x.input)) return null;
      const a = x.input;
      const input: ActionInput = a.type === 'move'
        ? { type: 'move', from: a.from, to: a.to, ...(a.promotion ? { promotion: a.promotion } : {}) }
        : a.type === 'power' ? { type: 'power', pieceId: a.pieceId, targets: a.targets.slice() }
          : a.type === 'card' ? { type: 'card', cardId: a.cardId, ...(a.pieceId ? { pieceId: a.pieceId } : {}), targets: a.targets.slice() }
            : a.choice === 'skip' ? { type: 'bonus', choice: 'skip' } : { type: 'bonus', choice: a.choice, targets: [a.targets[0]] };
      return { k: 'act', side, input };
    }
    case 'arena': {
      if (!isArenaAction(x.action)) return null;
      const a = x.action;
      const action: ArenaAction = a.type === 'endTurn' ? { type: 'endTurn' }
        : a.type === 'step' ? { type: 'step', pieceId: a.pieceId, to: a.to }
          : a.type === 'hit' ? { type: 'hit', pieceId: a.pieceId, target: a.target }
            : { type: 'power', pieceId: a.pieceId, targets: a.targets.slice() };
      return { k: 'arena', side, action };
    }
    case 'duel':
      return typeof x.call === 'boolean' ? { k: 'duel', side, call: x.call } : null;
    case 'throw':
      return HANDS.includes(x.hand as Hand) ? { k: 'throw', side, hand: x.hand as Hand } : null;
    case 'resign':
      return { k: 'resign', side };
    default:
      return null;
  }
}
