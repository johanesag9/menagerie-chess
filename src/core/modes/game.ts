/**
 * ModeGame: the GameController for Normal and Crazy (Classic stays on chess.js in ../game.ts).
 * Event order is the one in docs/phase3-briefs.md "Event order":
 *   after an action: [duelOffered, duelRound*, duelEnded, bonked] · moved|powerUsed|cardPlayed · logged · check? · modeState · turnChanged · gameOver?
 *   Crazy turn start: wheelSpun+logged? · cardDrawn? · dieRolled · modeState · [turnPassed, logged, modeState, turnChanged ...]
 */
import { Emitter } from '../../contracts/emitter';
import { POWER_OF } from '../../contracts/types';
import type {
  ActionInput, ActionRecord, ActResponse, BotLevel, CardResult, DieValue, DuelInfo, EmoteKind, GameController,
  GameEventMap, GameMode, GameOptions, GameOver, Hand, ModeState, MoveInput, MoveResult, PendingAction, PieceId,
  PieceState, PowerInfo, PowerResult, Side, Square, TargetStep, Unsubscribe,
} from '../../contracts/types';
import { ChessClock, type ClockSnapshot } from '../clock';
import { WeirdScheduler } from '../weird';
import { createLocalModeBot, type ModeBotEngine } from './botClient';
import {
  ANIMAL, CARD_NAME, POWER_NAME, applyAction, applyBonus, cardOptions, detectOver, drawCard, endTurn,
  hasAnyAction, inCheck, kingIndex, legalActions, legalMoves, nextWheelIn, pawnStepOptions, positionKey, powerOptions,
  powerUsed, rechargeOptions, sanOf, spinWheel, statusOf, stompVictims, toMove, wheelDue, type Outcome,
} from './rules';
import { pieceWorth } from './search';
import {
  cloneState, createState, findPiece, nextRandom, opposite, piecesOf, sqIndex, sqName, toFen, type ModeKind, type MState,
} from './state';
import { getTuning } from './tuning';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface ModeDeps {
  createBot?: () => ModeBotEngine;
  now?: () => number;
  /** Override every level's minimum think time (tests use 0). */
  botMinThinkMs?: number;
  clockTickMs?: number;
}

interface Snapshot {
  state: MState;
  clock: ClockSnapshot & { running: Side | null };
  history: number;
  log: number;
  keys: number;
  side: Side;
}

interface Duel {
  info: DuelInfo;
  action: ActionInput;
  stage: 'offer' | 'throw';
  round: number;
  ties: number;
  hands: Partial<Record<Side, Hand>>;
}

const HANDS: Hand[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<Hand, Hand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const FINAL_REASONS: GameOver['reason'][] = ['resign', 'timeout', 'agreement'];
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ModeGame implements GameController {
  private events = new Emitter<GameEventMap>();
  private s!: MState;
  private options!: GameOptions;
  private moves: MoveResult[] = [];
  private records: ActionRecord[] = [];
  private undoStack: Snapshot[] = [];
  private keys: string[] = [];
  private over: GameOver | null = null;
  private duel: Duel | null = null;
  private paused = false;
  private disposed = false;
  private clock: ChessClock;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private weird: WeirdScheduler;
  private bot: ModeBotEngine | null = null;
  private botRng = 1;
  private botToken = 0;
  private botThinking = false;
  private heldBotStep: (() => void) | null = null;
  private readonly now: () => number;

  constructor(private deps: ModeDeps = {}) {
    this.now = deps.now ?? (() => performance.now());
    this.clock = new ChessClock(this.now);
    this.weird = new WeirdScheduler(() => this.botRandom());
    this.newGame({ mode: 'normal', opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false }, true);
  }

  on<K extends keyof GameEventMap>(name: K, fn: (payload: GameEventMap[K]) => void): Unsubscribe {
    return this.events.on(name, fn);
  }

  // ---------- state ----------

  get mode(): GameMode {
    return this.s.mode;
  }
  get fen(): string {
    return toFen(this.s);
  }
  get turn(): Side {
    return this.s.turn;
  }
  get pieces(): PieceState[] {
    return piecesOf(this.s);
  }
  get history(): MoveResult[] {
    return this.moves.slice();
  }
  get log(): ActionRecord[] {
    return this.records.slice();
  }
  get modeState(): ModeState {
    return this.snapshot();
  }
  /** The raw board model (tests and the demo; don't mutate it). */
  get state(): MState {
    return this.s;
  }

  isOver(): GameOver | null {
    return this.over;
  }

  legalTargets(from: Square): Square[] {
    if (!this.humanCanAct('action')) return [];
    const i = sqIndex(from);
    return [...new Set(legalMoves(this.s).filter((m) => m.from === i).map((m) => sqName(m.to)))];
  }

  needsPromotion(from: Square, to: Square): boolean {
    const f = sqIndex(from);
    const t = sqIndex(to);
    return legalMoves(this.s).some((m) => m.from === f && m.to === t && !!m.promo);
  }

  // ---------- game flow ----------

  newGame(options: GameOptions, silent = false): void {
    const mode: ModeKind = options.mode === 'crazy' ? 'crazy' : 'normal';
    const fen = options.fen?.trim() || START_FEN;
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    const s = createState(fen, mode, getTuning(), seed); // throws on a bad FEN before anything changes
    if (mode === 'normal' && inCheck(s, opposite(s.turn))) throw new Error('Invalid FEN: the side not to move is in check');

    this.cancelBot();
    this.options = { ...options, mode, opponent: { ...options.opponent }, time: { ...options.time } };
    this.s = s;
    this.botRng = (seed ^ 0x9e3779b9) >>> 0;
    this.moves = [];
    this.records = [];
    this.undoStack = [];
    this.keys = [positionKey(s)];
    this.over = null;
    this.duel = null;
    this.paused = false;
    this.clock.reset(options.time);
    this.weird.reset();
    if (mode === 'crazy') {
      for (const side of ['land', 'sea'] as Side[]) for (let n = 0; n < s.cfg.startHand; n++) drawCard(s, side);
    }
    if (silent) return;
    this.syncTicker();
    if (options.opponent.type === 'bot' && !this.bot) this.bot = this.deps.createBot?.() ?? createLocalModeBot();

    const e = this.events;
    e.emit('gameStarted', { options: this.options, pieces: this.pieces, fen: this.fen, turn: s.turn });
    e.emit('modeState', this.snapshot());
    this.emitClock();
    this.emitCheck();
    e.emit('turnChanged', { turn: s.turn, legalMoveCount: legalMoves(s).length });
    const over = detectOver(s);
    if (over) return this.finish(over);
    if (mode === 'crazy') this.startTurn();
    this.maybeBot();
  }

  act(input: ActionInput): ActResponse {
    const phase = input.type === 'bonus' ? 'bonus' : 'action';
    if (!this.humanCanAct(phase)) return { ok: false, reason: this.over ? 'The game is over' : 'Not your turn now' };
    return this.perform(input);
  }

  move(input: MoveInput): MoveResult | null {
    const before = this.moves.length;
    const r = this.act({ type: 'move', ...input });
    return r.ok && !r.pending && this.moves.length > before ? this.moves[this.moves.length - 1] : null;
  }

  powerInfo(pieceId: PieceId): PowerInfo {
    const i = findPiece(this.s, pieceId);
    const p = this.s.board[i];
    const power = POWER_OF[p?.kind ?? (pieceId.split('-')[1] as keyof typeof POWER_OF) ?? 'p'] ?? 'sidestep';
    const no = (reason: PowerInfo['reason']): PowerInfo => ({ power, available: false, reason });
    if (!p) return no('noTarget');
    if (this.over || this.duel) return no('wrongPhase');
    if (p.side !== this.s.turn || this.isBotSide(p.side)) return no('notYourTurn');
    if (this.s.phase !== 'action') return no('wrongPhase');
    if (powerUsed(this.s, p)) return no('used');
    const st = statusOf(this.s, p.id);
    if (st) return no(st.status);
    if (!powerOptions(this.s, i).length) return no('noTarget');
    return { power, available: true };
  }

  canPlayCard(side: Side, cardId: string): boolean {
    return this.snapshot()[side].playableCards.includes(cardId);
  }

  targets(pending: PendingAction): TargetStep {
    const lists = this.humanCanAct(pending.type === 'bonus' ? 'bonus' : 'action') ? this.optionsFor(pending) : [];
    const picked = pending.targets;
    const next = new Set<Square>();
    let complete = false;
    for (const t of lists) {
      if (t.length < picked.length || picked.some((sq, k) => t[k] !== sq)) continue;
      if (t.length === picked.length) complete = true;
      else next.add(t[picked.length]);
    }
    return { squares: [...next], complete, prompt: lists.length ? promptFor(this.s, pending, complete) : nothingPrompt(pending) };
  }

  previewArea(pending: PendingAction): Square[] {
    if (pending.type !== 'power') {
      if (pending.type === 'card' && this.s[this.s.turn].hand.find((c) => c.id === pending.cardId)?.suit === 'clubs') return pending.targets.slice(0, 1);
      return [];
    }
    const i = findPiece(this.s, pending.pieceId);
    const p = this.s.board[i];
    if (!p) return [];
    switch (POWER_OF[p.kind]) {
      case 'stomp':
        return stompVictims(this.s, i).map(sqName);
      case 'headbutt': {
        if (!pending.targets[0]) return [];
        const v = sqIndex(pending.targets[0]);
        const dest = v + (v - i);
        return dest >= 0 && dest < 64 ? [sqName(dest)] : [];
      }
      case 'block':
        return pending.targets.slice(0, 1);
      default:
        return [];
    }
  }

  answerDuel(call: boolean): void {
    const d = this.duel;
    if (!d || d.stage !== 'offer' || this.isBotSide(d.info.defender)) return;
    this.answer(call);
  }

  throwHand(side: Side, hand: Hand): void {
    const d = this.duel;
    if (!d || d.stage !== 'throw' || this.isBotSide(side) || !HANDS.includes(hand)) return;
    if (side !== d.info.attacker && side !== d.info.defender) return;
    if (d.hands[side]) return;
    d.hands[side] = hand;
    if (d.hands.land && d.hands.sea) this.resolveRound();
  }

  undo(): void {
    if (this.s.mode !== 'normal' || !this.undoStack.length || this.disposed) return;
    if (this.over && FINAL_REASONS.includes(this.over.reason)) return;
    let count = 1;
    const opp = this.options.opponent;
    if (opp.type === 'bot') {
      const human = opposite(opp.botSide);
      const last = this.undoStack.map((x) => x.side).lastIndexOf(human);
      if (last < 0) return;
      count = this.undoStack.length - last;
    }
    this.cancelBot();
    let snap: Snapshot | undefined;
    for (let n = 0; n < count; n++) snap = this.undoStack.pop();
    this.s = snap!.state;
    this.clock.restore(snap!.clock);
    this.moves.length = snap!.history;
    this.records.length = snap!.log;
    this.keys.length = snap!.keys;
    this.over = null;
    this.syncTicker();
    this.events.emit('undone', { fen: this.fen, pieces: this.pieces });
    this.events.emit('modeState', this.snapshot());
    this.emitClock();
    this.emitCheck();
    this.events.emit('turnChanged', { turn: this.s.turn, legalMoveCount: legalMoves(this.s).length });
    this.maybeBot();
  }

  resign(side: Side): void {
    if (this.over || this.disposed) return;
    this.duel = null;
    this.finish({ winner: opposite(side), reason: 'resign' });
  }

  sendEmote(side: Side, emote: EmoteKind): void {
    this.events.emit('emote', { side, emote });
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.syncClockPause();
    this.emitClock();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.syncClockPause();
    this.emitClock();
    const step = this.heldBotStep;
    this.heldBotStep = null;
    step?.();
  }

  /** Stop clocks and the bot without ending the game (the facade calls this when switching to Classic). */
  halt(): void {
    this.cancelBot();
    this.clock.stop();
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  dispose(): void {
    this.halt();
    this.disposed = true;
    this.bot?.dispose();
    this.bot = null;
    this.events.clear();
  }

  // ---------- acting ----------

  private humanCanAct(phase: 'action' | 'bonus'): boolean {
    return !this.over && !this.disposed && !this.duel && this.s.phase === phase && !this.isBotSide(this.s.turn);
  }

  /** Validate and run an action for the side to move (human or bot). */
  private perform(input: ActionInput): ActResponse {
    const s = this.s;
    if (input.type === 'bonus') {
      if (s.phase !== 'bonus') return { ok: false, reason: 'No lucky bonus now' };
      if (input.choice !== 'skip') {
        const list = this.optionsFor({ type: 'bonus', choice: input.choice, targets: [] });
        if (!list.some((t) => t[0] === input.targets[0])) return { ok: false, reason: 'That bonus is not possible' };
      }
      this.doBonus(input);
      return { ok: true };
    }
    if (s.phase !== 'action') return { ok: false, reason: 'Take or skip the lucky bonus first' };
    const action = this.normalise(input);
    if (!action) return { ok: false, reason: 'Not a legal action' };
    const duel = this.duelFor(action);
    if (duel) {
      this.duel = { info: duel, action, stage: 'offer', round: 0, ties: 0, hands: {} };
      this.syncClockPause();
      this.events.emit('duelOffered', duel);
      this.maybeBot();
      return { ok: true, pending: 'duel' };
    }
    this.resolve(action, false);
    return { ok: true };
  }

  /** The legal action matching `input`, with defaults filled in (promotion to a queen), or null. */
  private normalise(input: ActionInput): ActionInput | null {
    if (input.type === 'move') {
      const f = sqIndex(input.from);
      const t = sqIndex(input.to);
      const ms = legalMoves(this.s).filter((m) => m.from === f && m.to === t);
      if (!ms.length) return null;
      const want = ms.some((m) => m.promo) ? (input.promotion ?? 'q') : undefined;
      if (want && !ms.some((m) => m.promo === want)) return null;
      return { type: 'move', from: input.from, to: input.to, ...(want ? { promotion: want } : {}) };
    }
    if (input.type === 'bonus') return null;
    const pending: PendingAction = input.type === 'power'
      ? { type: 'power', pieceId: input.pieceId, targets: [] }
      : { type: 'card', cardId: input.cardId, ...(input.pieceId ? { pieceId: input.pieceId } : {}), targets: [] };
    const ok = this.optionsFor(pending).some((t) => t.length === input.targets.length && t.every((sq, k) => sq === input.targets[k]));
    return ok ? { ...input, targets: input.targets.slice() } as ActionInput : null;
  }

  /** Every complete target list for a half-built action (empty when it can't be done now). */
  private optionsFor(pending: PendingAction): Square[][] {
    const s = this.s;
    if (this.over || this.duel) return [];
    if (pending.type === 'bonus') {
      if (s.phase !== 'bonus') return [];
      return (pending.choice === 'recharge' ? rechargeOptions(s) : pawnStepOptions(s)).map((i) => [sqName(i)]);
    }
    if (s.phase !== 'action') return [];
    if (pending.type === 'power') {
      const i = findPiece(s, pending.pieceId);
      return i < 0 ? [] : powerOptions(s, i).map((t) => t.map(sqName));
    }
    const card = s[s.turn].hand.find((c) => c.id === pending.cardId);
    if (!card) return [];
    return cardOptions(s, card)
      .filter((c) => card.suit !== 'hearts' || c.pieceId === pending.pieceId)
      .map((c) => c.targets.map(sqName));
  }

  /** Would this action capture something the defender can duel for? */
  private duelFor(a: ActionInput): DuelInfo | null {
    const s = this.s;
    if (s.mode !== 'crazy') return null;
    let from: Square;
    let to: Square;
    let victimSq: number;
    let via: DuelInfo['via'] = 'move';
    let mid: Square | undefined;
    if (a.type === 'move') {
      const m = toMove(s, a);
      from = a.from;
      to = a.to;
      victimSq = m.ep ? (m.to & 7) + (m.from & ~7) : m.to;
    } else if (a.type === 'power' && a.targets.length === 2) {
      from = sqName(findPiece(s, a.pieceId));
      [mid, to] = a.targets as [Square, Square];
      via = 'doubleJump';
      victimSq = sqIndex(to);
    } else {
      return null;
    }
    const victim = s.board[victimSq];
    const attacker = s.board[sqIndex(from)];
    if (!victim || !attacker || victim.side === attacker.side) return null;
    const defender = victim.side;
    if (s[defender].tokens <= 0) return null;
    return {
      attackerId: attacker.id, victimId: victim.id, via, ...(mid ? { mid } : {}), from, to,
      attacker: attacker.side, defender, tokensLeft: s[defender].tokens,
    };
  }

  private answer(call: boolean): void {
    const d = this.duel!;
    if (!call) {
      this.events.emit('duelEnded', { info: d.info, called: false, winner: 'attacker' });
      return this.endDuel('attacker');
    }
    this.s[d.info.defender].tokens--;
    d.stage = 'throw';
    d.round = 1;
    this.startRound();
  }

  /** A new throw round. The `modeState` (phase 'duel') is the signal to ask the human side(s) for a hand. */
  private startRound(): void {
    const d = this.duel!;
    d.hands = {};
    this.events.emit('modeState', this.snapshot());
    const bot = this.botSide();
    if (bot && (bot === d.info.attacker || bot === d.info.defender)) d.hands[bot] = HANDS[Math.floor(this.botRandom() * 3)];
    this.maybeBot();
  }

  private resolveRound(): void {
    const d = this.duel!;
    const a = d.hands[d.info.attacker]!;
    const b = d.hands[d.info.defender]!;
    const result = a === b ? 'tie' : BEATS[a] === b ? 'attacker' : 'defender';
    this.events.emit('duelRound', { info: d.info, round: d.round, attackerHand: a, defenderHand: b, result });
    if (result === 'tie') {
      d.ties++;
      if (d.ties < this.s.cfg.tieLimit) {
        d.round++;
        return this.startRound();
      }
    }
    const winner = result === 'defender' ? 'defender' : 'attacker';
    this.events.emit('duelEnded', { info: d.info, called: true, winner });
    this.endDuel(winner);
  }

  private endDuel(winner: 'attacker' | 'defender'): void {
    const d = this.duel!;
    this.duel = null;
    this.syncClockPause();
    this.resolve(d.action, winner === 'defender', d.info);
  }

  /** Apply an action (or its bonk), end the turn, and send the events in order. */
  private resolve(action: ActionInput, bonk: boolean, info?: DuelInfo): void {
    const s = this.s;
    const mover = s.turn;
    if (s.mode === 'normal') {
      this.undoStack.push({
        state: cloneState(s), clock: this.clock.snapshot(), history: this.moves.length, log: this.records.length,
        keys: this.keys.length, side: mover,
      });
    }
    const e = this.events;
    let emitAction: (() => void) | null = null;
    let record: ActionRecord;

    if (bonk) {
      // Nothing is captured. A bonked double jump still uses up the power.
      if (action.type === 'power') {
        const p = s.board[findPiece(s, action.pieceId)]!;
        if (!s[mover].powersUsed.includes(p.id)) s[mover].powersUsed.push(p.id);
      }
      const att = s.board[sqIndex(info!.from)]!;
      const vic = s.board[findPiece(s, info!.victimId)]!;
      record = { side: mover, kind: 'bonk', label: `Bonked! ${ANIMAL[vic.side][vic.kind]} won the duel; ${ANIMAL[att.side][att.kind]} bounced back` };
      emitAction = () => e.emit('bonked', { info: info! });
    } else if (action.type === 'move') {
      const m = toMove(s, action);
      const san = sanOf(s, m, legalMoves(s));
      const out = applyAction(s, action).move!;
      const result: MoveResult = { ...out, san, check: false, fenAfter: '' };
      record = { side: mover, kind: 'move', label: san };
      emitAction = () => e.emit('moved', result);
      this.afterTurn(() => {
        result.check = this.opponentKingAttacked();
        result.san = san + (result.check ? (this.over?.reason === 'checkmate' ? '#' : '+') : '');
        result.fenAfter = this.fen;
        record.label = result.san + (result.slide ? ` (slid to ${result.slide.to})` : '');
        this.moves.push(result);
      });
    } else {
      const kind = action.type === 'power' ? s.board[findPiece(s, action.pieceId)]!.kind : 'p';
      const card = action.type === 'card' ? s[mover].hand.find((c) => c.id === action.cardId)! : null;
      const out: Outcome = applyAction(s, action);
      record = { side: mover, kind: action.type === 'power' ? 'power' : 'card', label: out.label };
      if (action.type === 'power') {
        const r: PowerResult = {
          side: mover, pieceId: action.pieceId, power: POWER_OF[kind], targets: action.targets,
          changes: out.changes, check: false,
        };
        emitAction = () => e.emit('powerUsed', r);
        this.afterTurn(() => (r.check = this.opponentKingAttacked()));
      } else if (card && action.type === 'card') {
        const r: CardResult = {
          side: mover, card, ...(action.pieceId ? { pieceId: action.pieceId } : {}), targets: action.targets,
          ...(out.joker ? { joker: out.joker } : {}), ...(out.drawn ? { drawn: out.drawn } : {}), changes: out.changes, check: false,
        };
        emitAction = () => e.emit('cardPlayed', r);
        this.afterTurn(() => (r.check = this.opponentKingAttacked()));
      }
    }
    this.finishTurn(mover, record!, emitAction!);
  }

  private pendingAfter: (() => void)[] = [];
  private afterTurn(fn: () => void): void {
    this.pendingAfter.push(fn);
  }

  /** End the mover's turn, then emit: action event, logged, check, modeState, turnChanged, gameOver. */
  private finishTurn(mover: Side, record: ActionRecord, emitAction: () => void): void {
    const s = this.s;
    endTurn(s);
    let over = detectOver(s);
    if (!over && s.mode === 'normal') {
      const key = positionKey(s);
      this.keys.push(key);
      if (this.keys.filter((k) => k === key).length >= 3) over = { winner: null, reason: 'threefold' };
    }
    if (over) this.over = over;
    this.clock.pressAfterMove(mover, over ? null : s.turn);
    for (const fn of this.pendingAfter.splice(0)) fn();
    this.records.push(record);

    const e = this.events;
    emitAction();
    e.emit('logged', record);
    this.emitCheck();
    e.emit('modeState', this.snapshot());
    e.emit('turnChanged', { turn: s.turn, legalMoveCount: legalMoves(s).length });
    if (over) return this.finish(over);
    if (s.mode === 'normal' && this.options.weirdMode) {
      const w = this.weird.onPly(this.pieces, s.turn);
      if (w) e.emit('weirdEvent', w);
    }
    this.emitClock();
    if (s.mode === 'crazy') this.startTurn();
    this.maybeBot();
  }

  private doBonus(a: Extract<ActionInput, { type: 'bonus' }>): void {
    const s = this.s;
    const out = applyBonus(s, a);
    s.phase = 'action';
    const record: ActionRecord = { side: s.turn, kind: 'bonus', label: out.label };
    this.records.push(record);
    this.events.emit('bonusUsed', { side: s.turn, choice: a.choice, changes: out.changes });
    this.events.emit('logged', record);
    this.events.emit('modeState', this.snapshot());
    if (!hasAnyAction(s)) this.passTurn();
    this.maybeBot();
  }

  /** Crazy: wheel, card draw, die, then wait for the side (or pass if it has nothing to do). */
  private startTurn(): void {
    const s = this.s;
    const e = this.events;
    for (let guard = 0; guard < 400 && !this.over; guard++) {
      if (wheelDue(s)) {
        const w = spinWheel(s);
        const record: ActionRecord = { side: null, kind: 'wheel', label: w.label };
        this.records.push(record);
        e.emit('wheelSpun', { outcome: w.outcome, ...(w.direction ? { direction: w.direction } : {}), changes: w.changes });
        e.emit('logged', record);
        const over = detectOver(s);
        if (over) {
          this.over = over;
          e.emit('modeState', this.snapshot());
          return this.finish(over);
        }
      }
      const side = s[s.turn];
      if (--side.nextCardIn <= 0) {
        side.nextCardIn = s.cfg.drawEvery;
        if (side.hand.length < s.cfg.handLimit) e.emit('cardDrawn', { side: s.turn, card: drawCard(s, s.turn) });
      }
      const value = (Math.floor(nextRandom(s) * 6) + 1) as DieValue;
      s.die = { value, effect: s.cfg.dieFaces[value - 1] };
      e.emit('dieRolled', { side: s.turn, value, effect: s.die.effect });
      s.phase = s.die.effect === 'lucky' ? 'bonus' : 'action';
      e.emit('modeState', this.snapshot());
      if (s.phase === 'bonus' || hasAnyAction(s)) return;
      if (!this.passTurn(false)) return;
    }
  }

  /** The side to move has nothing to do: its turn passes. Returns true when the next turn should start. */
  private passTurn(startNext = true): boolean {
    const s = this.s;
    const e = this.events;
    const mover = s.turn;
    const record: ActionRecord = { side: mover, kind: 'pass', label: `${cap(mover)} had nothing to do and passed` };
    this.records.push(record);
    endTurn(s);
    const over = detectOver(s);
    if (over) this.over = over;
    this.clock.pressAfterMove(mover, over ? null : s.turn);
    e.emit('turnPassed', { side: mover });
    e.emit('logged', record);
    this.emitCheck();
    e.emit('modeState', this.snapshot());
    e.emit('turnChanged', { turn: s.turn, legalMoveCount: legalMoves(s).length });
    if (over) {
      this.finish(over);
      return false;
    }
    this.emitClock();
    if (startNext) this.startTurn();
    return true;
  }

  private finish(over: GameOver): void {
    this.over = over;
    this.duel = null;
    this.clock.stop();
    this.cancelBot();
    this.syncTicker();
    this.emitClock();
    this.events.emit('gameOver', over);
  }

  // ---------- helpers ----------

  private opponentKingAttacked(): boolean {
    return inCheck(this.s, this.s.turn);
  }

  private emitCheck(): void {
    const s = this.s;
    if (!inCheck(s, s.turn)) return;
    this.events.emit('check', { side: s.turn, kingSquare: sqName(kingIndex(s, s.turn)) });
  }

  private snapshot(): ModeState {
    const s = this.s;
    const crazy = s.mode === 'crazy';
    const side = (sd: Side) => {
      const m = s[sd];
      const live = new Set(piecesOf(s).map((p) => p.id));
      const playable = crazy && !this.over && !this.duel && s.turn === sd && s.phase === 'action'
        ? m.hand.filter((c) => cardOptions(s, c).length > 0).map((c) => c.id)
        : [];
      return {
        powersUsed: m.powersUsed.filter((id) => live.has(id)), hand: m.hand.map((c) => ({ ...c })), playableCards: playable,
        duelTokens: m.tokens, captured: m.captured.map((p) => ({ ...p })), nextCardIn: crazy ? m.nextCardIn : 0,
      };
    };
    return {
      mode: s.mode,
      round: s.round,
      phase: this.over ? 'over' : this.duel ? 'duel' : s.phase,
      die: s.die && { ...s.die },
      nextWheelIn: crazy ? nextWheelIn(s) : null,
      statuses: s.statuses.map((x) => ({ pieceId: x.id, status: x.status, turnsLeft: x.turnsLeft })),
      squares: s.blocks.map((b) => ({ square: sqName(b.sq), effect: 'blocked' as const, by: b.by, turnsLeft: b.turnsLeft })),
      land: side('land'),
      sea: side('sea'),
    };
  }

  private syncClockPause(): void {
    this.clock.setPaused(this.paused || !!this.duel);
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

  private checkFlag(): boolean {
    const loser = this.clock.flagged();
    if (!loser || this.over) return false;
    const winner = opposite(loser);
    this.finish({ winner: canWinOnTime(this.s, winner) ? winner : null, reason: 'timeout' });
    return true;
  }

  private emitClock(): void {
    this.events.emit('clock', {
      landMs: this.clock.remaining('land'),
      seaMs: this.clock.remaining('sea'),
      running: this.over ? null : this.clock.ticking,
    });
  }

  // ---------- bot ----------

  private botSide(): Side | null {
    const o = this.options?.opponent;
    if (!o) return null;
    return o.type === 'bot' ? o.botSide : null;
  }

  private isBotSide(side: Side): boolean {
    return this.botSide() === side;
  }

  private botRandom(): number {
    this.botRng = (this.botRng + 0x6d2b79f5) >>> 0;
    let t = this.botRng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** What the bot has to decide next, if anything. */
  private botNeed(): 'action' | 'bonus' | 'duel' | null {
    const bot = this.botSide();
    if (!bot || this.over || this.disposed) return null;
    if (this.duel) return this.duel.stage === 'offer' && this.duel.info.defender === bot ? 'duel' : null;
    if (this.s.turn !== bot) return null;
    return this.s.phase === 'bonus' ? 'bonus' : this.s.phase === 'action' ? 'action' : null;
  }

  private maybeBot(): void {
    const need = this.botNeed();
    if (!need || this.botThinking) return;
    const o = this.options.opponent as { level: BotLevel };
    const cfg = this.s.cfg.bot[o.level];
    const token = ++this.botToken;
    this.setBotThinking(true);

    let pick: Promise<ActionInput | boolean | null>;
    if (need === 'duel') {
      pick = Promise.resolve(this.botWantsDuel());
    } else if (need === 'action' && this.botRandom() < cfg.randomChance) {
      pick = Promise.resolve(this.randomAction());
    } else {
      const req = { kind: need, state: cloneState(this.s), depth: cfg.depth, timeMs: cfg.timeMs, seed: Math.floor(this.botRandom() * 2 ** 31) };
      pick = (this.bot ?? (this.bot = createLocalModeBot())).decide(req);
    }
    void Promise.all([pick, wait(this.deps.botMinThinkMs ?? cfg.minThinkMs)]).then(([choice]) => {
      if (token !== this.botToken) return;
      const step = () => {
        this.setBotThinking(false);
        if (token !== this.botToken || this.botNeed() !== need) return this.maybeBot();
        if (need === 'duel') return this.answer(choice as boolean);
        this.botAct(choice as ActionInput | null);
      };
      if (this.paused) this.heldBotStep = step;
      else step();
    });
  }

  private botAct(choice: ActionInput | null): void {
    if (choice && this.perform(choice).ok) return;
    if (choice) console.warn('[core] mode bot picked an illegal action; playing a random one', choice);
    const alt = this.s.phase === 'bonus' ? ({ type: 'bonus', choice: 'skip' } as const) : this.randomAction();
    if (alt) this.perform(alt);
  }

  /** Mostly a random move, sometimes a random power or card: playful, never stuck. */
  private randomAction(): ActionInput | null {
    const all = legalActions(this.s, true);
    if (!all.length) return null;
    const moves = all.filter((a) => a.type === 'move');
    const pool = moves.length && this.botRandom() < 0.7 ? moves : all;
    return pool[Math.floor(this.botRandom() * pool.length)];
  }

  /** Save the king always; big pieces more often, and more when tokens are spare. */
  private botWantsDuel(): boolean {
    const d = this.duel!;
    const victim = this.s.board[findPiece(this.s, d.info.victimId)];
    if (!victim) return false;
    const worth = pieceWorth(victim.kind);
    if (worth === Infinity) return true;
    const chance = Math.min(1, (worth / 9) * (0.5 + 0.25 * d.info.tokensLeft));
    return this.botRandom() < chance;
  }

  private cancelBot(): void {
    this.botToken++;
    this.heldBotStep = null;
    this.setBotThinking(false);
  }

  private setBotThinking(thinking: boolean): void {
    const bot = this.botSide();
    if (this.botThinking === thinking || !bot) {
      this.botThinking = thinking && !!bot;
      return;
    }
    this.botThinking = thinking;
    this.events.emit('botThinking', { side: bot, thinking });
  }
}

// ---------- small helpers ----------

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** On time, a lone king (or king plus one knight or bishop) can't win. */
function canWinOnTime(s: MState, side: Side): boolean {
  let minors = 0;
  for (const p of s.board) {
    if (!p || p.side !== side || p.kind === 'k') continue;
    if (p.kind === 'n' || p.kind === 'b') minors++;
    else return true;
  }
  return minors >= 2;
}

function nothingPrompt(p: PendingAction): string {
  if (p.type === 'card') return p.targets.length || p.pieceId ? 'Nothing to pick' : 'Pick an animal to bring back';
  return 'Nothing to pick';
}

function promptFor(s: MState, p: PendingAction, complete: boolean): string {
  const n = p.targets.length;
  if (p.type === 'bonus') {
    if (complete) return 'Ready';
    return p.choice === 'recharge' ? 'Pick a piece to recharge its power' : 'Pick a pawn to step forward';
  }
  if (p.type === 'power') {
    const i = findPiece(s, p.pieceId);
    const kind = s.board[i]?.kind ?? 'p';
    const power = POWER_OF[kind];
    if (complete) return power === 'stomp' ? 'Stomp stuns every enemy next to it (not the king)' : `Ready: ${POWER_NAME[power]}`;
    switch (power) {
      case 'sidestep': return 'Pick an empty square beside the pawn';
      case 'doubleJump': return n === 0 ? 'Pick the first hop (an empty square)' : 'Pick where to land (it may capture)';
      case 'headbutt': return 'Pick an enemy next to it to push';
      case 'block': return 'Pick an empty square to block';
      case 'escape': return 'Pick an empty square up to 2 away';
      default: return '';
    }
  }
  const card = s[s.turn].hand.find((c) => c.id === p.cardId);
  if (!card) return '';
  if (complete) return card.suit === 'joker' ? 'Play the Joker?' : `Ready: ${CARD_NAME[card.suit]}`;
  switch (card.suit) {
    case 'hearts': return 'Pick where it comes back';
    case 'diamonds': return n === 0 ? 'Pick the first piece to swap' : 'Pick the piece to swap with';
    case 'clubs': return 'Pick an enemy to freeze';
    case 'spades': return 'Pick a pawn to dig back';
    default: return '';
  }
}
