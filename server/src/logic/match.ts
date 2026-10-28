/**
 * Match: one game of core, driven only by NetInputs. The room runs one; every browser's mirror runs the same.
 * Imports the core classes directly (never src/core/index.ts, which pulls in the Stockfish worker).
 */
import { ArenaGame } from '../../../src/core/arena/game';
import { MenagerieGame } from '../../../src/core/controller';
import { legalActions as arenaActions } from '../../../src/core/arena/rules';
import { legalActions as modeActions } from '../../../src/core/modes/rules';
import type { NetInput } from '../../../src/contracts/net';
import type {
  ActionInput, ArenaAction, DuelInfo, GameOptions, GameOver, Hand, PieceKind, Side, Square,
} from '../../../src/contracts/types';
import { isArenaMode, isBoardMode } from '../../../src/contracts/types';

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
  'turnChanged', 'logged', 'gameOver', 'botThinking', 'tide', 'crowned',
] as const;
const KINDS: PieceKind[] = ['p', 'n', 'b', 'r', 'q', 'k'];

export class Match {
  readonly arenaMode: boolean;
  /** Sandcastle King and Stepping Stones: a turn has stages, and the turn (not each action) is what the timer covers. */
  readonly boardMode: boolean;
  /** Counts `turnChanged` events: a new number means a new turn. */
  turns = 0;
  private chess: MenagerieGame | null = null;
  private arena: ArenaGame | null = null;
  private duel: { info: DuelInfo; stage: 'offer' | 'throw' } | null = null;
  /** Every core event as JSON, when asked for (the determinism tests compare these). */
  readonly events: string[] = [];

  constructor(readonly options: GameOptions, opts: { record?: boolean } = {}) {
    this.arenaMode = isArenaMode(options.mode);
    this.boardMode = isBoardMode(options.mode);
    const onEvent = (name: string) => (payload: unknown) => {
      if (opts.record) this.events.push(`${name} ${JSON.stringify(payload)}`);
      if (name === 'turnChanged') this.turns++;
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

  /** The input the room makes when time runs out (GAME_SPEC "Online play" defaults). Board games: one for the current stage. */
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
        if (this.boardMode) {
          const action = this.randomStage(random);
          return action ? [{ k: 'arena', side: need.side, action }] : [];
        }
        if (this.arena) return [{ k: 'arena', side: need.side, action: { type: 'endTurn' } }];
        const move = this.randomAction(random);
        return move ? [{ k: 'act', side: need.side, input: move }] : [{ k: 'resign', side: need.side }];
      }
    }
  }

  /**
   * Board games: a random legal action for the stage the turn is in, through core's own APIs (Johanes 2026-10-28):
   * draft, a kind not yet picked; move, a step or hit from `pieceOptions`; shape, an option from `shapeOptions`
   * ('more': end the turn). Falls back to any legal action, so a timeout always moves the turn on.
   */
  private randomStage(random: () => number): ArenaAction | null {
    const g = this.arena!;
    const st = g.state;
    const any = <T>(list: T[]): T | null => (list.length ? list[Math.floor(random() * list.length)] : null);
    if (st.phase === 'draft') {
      const picked = st.draft?.picks[st.turn] ?? [];
      const kind = any(KINDS.filter((k) => !picked.includes(k)));
      if (kind) return { type: 'pick', kind };
    } else if (st.stage === 'more') {
      return { type: 'endTurn' };
    } else if (st.stage === 'shape') {
      const pieceId = st.mode === 'castle' ? st.mover ?? null : null;
      const shapes = (g.shapeOptions?.() ?? []).flatMap((o) => [
        ...(o.up ? [{ type: 'shape', pieceId, square: o.square, dir: 'up' } as const] : []),
        ...(o.down ? [{ type: 'shape', pieceId, square: o.square, dir: 'down' } as const] : []),
      ]);
      const shape = any<ArenaAction>(shapes);
      if (shape) return shape;
    } else {
      const moves: ArenaAction[] = [];
      for (const p of st.pieces) {
        if (p.side !== st.turn) continue;
        const o = g.pieceOptions(p.id);
        for (const to of o.steps) moves.push({ type: 'step', pieceId: p.id, to });
        for (const target of o.hits) moves.push({ type: 'hit', pieceId: p.id, target });
      }
      const move = any(moves);
      if (move) return move;
    }
    return any(arenaActions(g.raw));
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
    case 'throw': return isId(x.pieceId) && isSquare(x.to);
    case 'pick': return KINDS.includes(x.kind as PieceKind);
    case 'shape': return (x.pieceId === null || isId(x.pieceId)) && isSquare(x.square) && (x.dir === 'up' || x.dir === 'down');
    default: return false;
  }
}

function cleanArena(a: ArenaAction): ArenaAction {
  switch (a.type) {
    case 'endTurn': return { type: 'endTurn' };
    case 'step': return { type: 'step', pieceId: a.pieceId, to: a.to };
    case 'hit': return { type: 'hit', pieceId: a.pieceId, target: a.target };
    case 'power': return { type: 'power', pieceId: a.pieceId, targets: a.targets.slice() };
    case 'throw': return { type: 'throw', pieceId: a.pieceId, to: a.to };
    case 'pick': return { type: 'pick', kind: a.kind };
    case 'shape': return { type: 'shape', pieceId: a.pieceId, square: a.square, dir: a.dir };
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
      const action: ArenaAction = cleanArena(a);
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
