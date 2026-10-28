/**
 * ArenaGame: the ArenaController for Sumo and Raid (GAME_SPEC "Party modes"), and since Phase 6 for the board-game
 * modes Sandcastle King ('castle') and Stepping Stones ('stones'). No chess here.
 * Event order (types.ts `ArenaController`, docs/phase4-briefs.md "Event order"):
 *   newGame: started · state · turnChanged · rolled · state
 *   an action: [duelOffered, duelRound*, duelEnded] · acted · logged · state      (a bonk: bonked · logged · state)
 *   end of a turn (AP spent, nothing left to do, or endTurn): [sank · logged] · state · gameOver? · turnChanged ·
 *     [wheelSpun · logged] · rolled · state
 *   a game that ends mid-turn: acted · logged · state (phase 'over') · gameOver
 * Board-game modes (no die, AP or duels; see board.ts for the stages):
 *   newGame: started · state · turnChanged · state
 *   an action: acted · logged · state · [crowned]; the turn ends by itself after its last stage
 *   end of a turn: [tide · logged] · state · gameOver? · turnChanged · [castle win check: state · gameOver] · state · [crowned]
 *   a side with nothing to do: logged (pass), then the end of its turn
 */
import { Emitter } from '../../contracts/emitter';
import type {
  ActionRecord, ActResponse, ArenaAction, ArenaController, ArenaEventMap, ArenaPieceOptions, ArenaState, BotLevel, DuelInfo,
  GameOptions, GameOver, Hand, Level, PieceId, PieceKind, Side, Square, TargetStep, Unsubscribe,
} from '../../contracts/types';
import { isArenaMode, POWER_OF } from '../../contracts/types';
import type { ShapeOption } from '../../contracts/types';
import { opposite, sqIndex, sqName } from '../modes/state';
import { beginTurn, boardEndTurn, completingRound, isBoard, passLabel, startWin, turnOverResult } from './board';
import { createLocalArenaBot, type ArenaBotEngine } from './botClient';
import { castlePushes, castleShapes, crownedOf, nextTideIn, TRAITS } from './castle';
import { wantsDuel } from './bot';
import {
  ANIMAL, actionKey, applyAction, powerLine, powerNote, carriedBy, cloneArena, createArenaState, detectOver, endTurn, findA, hasAnyAction,
  hitCostOf, hitTargets, isSunk, legalActions, maxRoundsOf, nextSinkIn, nextWheelIn, piecesOn, powerBlock, powerName,
  powerOptions, pushLine, roll, roundCapResult, sentHomeSquare, shoveLine, sinkingNext,
  spinWheel, stepCostOf, stepTargets, stompShoves, stunVictims, throwTargets, wheelDue, type AState,
} from './rules';
import { headbuttDest, pathLength, STONES_POWERS, stonesPowerArea, stonesPowerBlock, stonesPowerOptions, stonesShapes } from './stones';
import { getArenaTuning } from './tuning';

export interface ArenaDeps {
  createBot?: () => ArenaBotEngine;
  /** Override every level's minimum think time (tests use 0). */
  botMinThinkMs?: number;
}

interface Duel {
  info: DuelInfo;
  action: ArenaAction;
  stage: 'offer' | 'throw';
  round: number;
  ties: number;
  hands: Partial<Record<Side, Hand>>;
}

const HANDS: Hand[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<Hand, Hand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export class ArenaGame implements ArenaController {
  private events = new Emitter<ArenaEventMap>();
  private s!: AState;
  private options!: GameOptions;
  private records: ActionRecord[] = [];
  private duel: Duel | null = null;
  private paused = false;
  private disposed = false;
  private bot: ArenaBotEngine | null = null;
  private botRng = 1;
  private botToken = 0;
  private botThinking = false;
  private heldBotStep: (() => void) | null = null;
  /** Castle: the crown last announced with `crowned` ('' = none). */
  private crownKey = '';

  constructor(private deps: ArenaDeps = {}) {
    this.newGame({ mode: 'sumo', opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false }, true);
  }

  on<K extends keyof ArenaEventMap>(name: K, fn: (payload: ArenaEventMap[K]) => void): Unsubscribe {
    return this.events.on(name, fn);
  }

  // ---------- reading ----------

  get state(): ArenaState {
    return this.snapshot();
  }
  get log(): ActionRecord[] {
    return this.records.slice();
  }
  /** The raw board model (tests and the playtest; don't mutate it). */
  get raw(): AState {
    return this.s;
  }
  /** The options of the current game. */
  get gameOptions(): GameOptions {
    return this.options;
  }

  pieceOptions(pieceId: PieceId): ArenaPieceOptions {
    if (isBoard(this.s.mode)) return this.boardPieceOptions(pieceId);
    const s = this.s;
    const i = findA(s, pieceId);
    const p = s.board[i];
    const power = POWER_OF[p?.kind ?? (pieceId.split('-')[1] as keyof typeof POWER_OF) ?? 'p'] ?? 'sidestep';
    const none: ArenaPieceOptions = { steps: [], hits: [], stepCost: 0, hitCosts: [], power: { power, available: false, reason: 'noTarget' } };
    if (!p) return none;
    const stepCost = stepCostOf(s, p);
    if (!this.humanCanAct() || p.side !== s.turn) {
      const reason = s.over || this.duel ? 'wrongPhase' : 'notYourTurn';
      return { ...none, stepCost, power: { power, available: false, reason, name: powerName(s.mode, p.kind), line: powerLine(s, p.kind) } };
    }
    const hits = hitTargets(s, i);
    const block = powerBlock(s, i);
    const text = { name: powerName(s.mode, p.kind), line: powerLine(s, p.kind) };
    const note = block ? powerNote(s, i, block) : undefined;
    return {
      steps: stepTargets(s, i).map(sqName),
      hits: hits.map((h) => sqName(h.target)),
      stepCost,
      hitCosts: hits.map((h) => h.cost),
      power: block ? { power, available: false, reason: block, ...text, ...(note ? { note } : {}) } : { power, available: true, ...text },
      ...(carriedBy(s, p.id) ? { throws: throwTargets(s, i).map(sqName), throwCost: s.cfg.throwCost } : {}),
    };
  }

  /** Phase 6: what the side to move can build/dig (castle, next to the mover) or raise/sink (stones) right now. */
  shapeOptions(): ShapeOption[] {
    const s = this.s;
    if (!isBoard(s.mode) || !this.humanCanAct()) return [];
    if (s.mode === 'castle') {
      const builder = s.board[findA(s, s.mover ?? '')]?.kind === 'r';
      return castleShapes(s).map((o) => ({ square: sqName(o.sq), up: o.up, down: o.down, ...(builder && o.up ? { upBy: o.upBy } : {}) }));
    }
    return stonesShapes(s).map((o) => ({ square: sqName(o.sq), up: o.up, down: o.down }));
  }

  private boardPieceOptions(pieceId: PieceId): ArenaPieceOptions {
    const s = this.s;
    const i = findA(s, pieceId);
    const p = s.board[i];
    const kind = p?.kind ?? (pieceId.split('-')[1] as keyof typeof POWER_OF);
    const power = POWER_OF[kind] ?? 'sidestep';
    const text = s.mode === 'castle' ? TRAITS[kind] : STONES_POWERS[kind];
    const info = text ? { name: text.name, line: text.line } : {};
    // Castle traits are always on: there is no power action, so `available` is simply true.
    const none: ArenaPieceOptions = {
      steps: [], hits: [], stepCost: 0, hitCosts: [],
      power: s.mode === 'castle' && p ? { power, available: true, ...info } : { power, available: false, reason: 'noTarget', ...info },
    };
    if (!p) return none;
    if (!this.humanCanAct() || p.side !== s.turn) {
      if (s.mode === 'castle') return none;
      return { ...none, power: { power, available: false, reason: s.over ? 'wrongPhase' : 'notYourTurn', ...info } };
    }
    const mine = legalActions(s).filter((a) => 'pieceId' in a && a.pieceId === pieceId && a.type !== 'shape');
    const steps = mine.flatMap((a) => (a.type === 'step' ? [a.to] : []));
    const hits = mine.flatMap((a) => (a.type === 'hit' ? [a.target] : []));
    if (s.mode === 'castle') return { steps, hits, stepCost: 0, hitCosts: hits.map(() => 0), power: { power, available: true, ...info } };
    const block = stonesPowerBlock(s, i);
    return {
      steps, hits: [], stepCost: 0, hitCosts: [],
      power: block ? { power, available: false, reason: block, ...info } : { power, available: true, ...info },
    };
  }

  targets(pending: { pieceId: PieceId; targets: Square[] }): TargetStep {
    const lists = this.humanCanAct() ? this.powerLists(pending.pieceId) : [];
    const picked = pending.targets;
    const next = new Set<Square>();
    let complete = false;
    for (const t of lists) {
      if (t.length < picked.length || picked.some((sq, k) => t[k] !== sq)) continue;
      if (t.length === picked.length) complete = true;
      else next.add(t[picked.length]);
    }
    return { squares: [...next], complete, prompt: lists.length ? this.promptFor(pending.pieceId, picked.length, complete) : 'Nothing to pick' };
  }

  previewArea(pending: { pieceId: PieceId; targets: Square[] } | { pieceId: PieceId; hit: Square }): { area: Square[]; falls: Square[] } {
    const area = this.area(pending);
    // Which animals would fall: play the finished action on a copy (only hits and complete powers can drop anything).
    const s = this.s;
    let falls: Square[] = [];
    const p = s.board[findA(s, pending.pieceId)];
    if (isBoard(s.mode)) return { area: this.boardArea(pending), falls };
    if (p && s.mode === 'sumo' && !s.over) {
      const action: ArenaAction = 'hit' in pending
        ? { type: 'hit', pieceId: pending.pieceId, target: pending.hit }
        : { type: 'power', pieceId: pending.pieceId, targets: pending.targets };
      const key = actionKey(action);
      if (legalActions(s).some((a) => actionKey(a) === key)) {
        falls = applyAction(cloneArena(s), action, false).changes.flatMap((c) => (c.type === 'fall' ? [c.square] : []));
      }
    }
    return { area, falls };
  }

  /** Castle hit: the victim and where it lands. Stones powers: the squares they touch. */
  private boardArea(pending: { pieceId: PieceId; targets: Square[] } | { pieceId: PieceId; hit: Square }): Square[] {
    const s = this.s;
    const i = findA(s, pending.pieceId);
    if (i < 0) return [];
    if ('hit' in pending) {
      const h = s.mode === 'castle' ? castlePushes(s, i).find((x) => sqName(x.victim) === pending.hit) : undefined;
      return h ? [pending.hit, sqName(h.to)] : [];
    }
    if (s.mode !== 'stones') return [];
    const t = pending.targets.map(sqIndex);
    if (s.board[i]!.kind === 'b' && t.length && !headbuttDest(s, i, t[0])) return [pending.targets[0]];
    return stonesPowerArea(s, i, t).map(sqName);
  }

  private area(pending: { pieceId: PieceId; targets: Square[] } | { pieceId: PieceId; hit: Square }): Square[] {
    const s = this.s;
    const i = findA(s, pending.pieceId);
    const p = s.board[i];
    if (!p) return [];
    if ('hit' in pending) {
      const v = sqIndex(pending.hit);
      const victim = s.board[v];
      if (!victim || victim.side === p.side) return [];
      if (s.mode === 'raid') {
        const home = sentHomeSquare(s, victim, v);
        return home === null ? [pending.hit] : [pending.hit, sqName(home)];
      }
      const line = shoveLine(s, i, v);
      return line ? lineArea(line) : [];
    }
    const t = pending.targets;
    switch (p.kind) {
      case 'p': return s.mode === 'sumo' ? [sqName(i)] : t.slice(0, 1);
      case 'n': return t.slice();
      case 'b': {
        if (!t[0]) return [];
        const v = sqIndex(t[0]);
        const df = Math.sign((v & 7) - (i & 7));
        const dr = Math.sign((v >> 3) - (i >> 3));
        if (s.mode === 'raid') {
          const dest = v + df + 8 * dr;
          return dest >= 0 && dest < 64 ? [t[0], sqName(dest)] : [t[0]];
        }
        const line = pushLine(s, v, df, dr);
        return line ? lineArea(line) : [];
      }
      case 'r':
        if (s.mode === 'raid') return stunVictims(s, i).map(sqName);
        return [...new Set(stompShoves(s, i).flatMap((j) => lineArea(shoveLine(s, i, j)!)))];
      case 'q':
      case 'k':
        return t.slice(0, 1);
    }
  }

  // ---------- game flow ----------

  newGame(options: GameOptions, silent = false): void {
    if (!isArenaMode(options.mode)) throw new Error(`ArenaController runs 'sumo', 'raid', 'castle' or 'stones', not '${options.mode}'`);
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.cancelBot();
    this.options = { ...options, opponent: { ...options.opponent }, time: { ...options.time } };
    this.s = createArenaState(options.mode, getArenaTuning(), seed);
    this.botRng = (seed ^ 0x9e3779b9) >>> 0;
    this.records = [];
    this.duel = null;
    this.paused = false;
    this.crownKey = '';
    if (silent) return;
    if (options.opponent.type === 'bot' && !this.bot) this.bot = this.deps.createBot?.() ?? createLocalArenaBot();
    this.events.emit('started', { options: this.options, state: this.snapshot() });
    this.events.emit('state', this.snapshot());
    this.events.emit('turnChanged', { turn: this.s.turn });
    this.startTurn();
  }

  act(action: ArenaAction): ActResponse {
    if (!this.humanCanAct()) return { ok: false, reason: this.s.over ? 'The game is over' : this.duel ? 'A duel is on' : 'Not your turn' };
    return this.perform(action);
  }

  answerDuel(call: boolean): void {
    const d = this.duel;
    if (!d || d.stage !== 'offer' || this.isBotSide(d.info.defender) || this.disposed) return;
    this.answer(call);
  }

  throwHand(side: Side, hand: Hand): void {
    const d = this.duel;
    if (!d || d.stage !== 'throw' || this.isBotSide(side) || !HANDS.includes(hand) || this.disposed) return;
    if (side !== d.info.attacker && side !== d.info.defender) return;
    if (d.hands[side]) return;
    d.hands[side] = hand;
    if (d.hands.land && d.hands.sea) this.resolveRound();
  }

  resign(side: Side): void {
    if (this.s.over || this.disposed) return;
    this.duel = null;
    this.s.over = { winner: opposite(side), reason: 'resign' };
    this.events.emit('state', this.snapshot());
    this.finish(this.s.over);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const step = this.heldBotStep;
    this.heldBotStep = null;
    step?.();
  }

  dispose(): void {
    this.cancelBot();
    this.disposed = true;
    this.bot?.dispose();
    this.bot = null;
    this.events.clear();
  }

  // ---------- acting ----------

  private humanCanAct(): boolean {
    return !this.s.over && !this.disposed && !this.duel && !this.isBotSide(this.s.turn);
  }

  /** Every complete target list for this animal's power right now. */
  private powerLists(pieceId: PieceId): Square[][] {
    const i = findA(this.s, pieceId);
    if (i < 0 || this.s.mode === 'castle') return [];
    return (this.s.mode === 'stones' ? stonesPowerOptions(this.s, i) : powerOptions(this.s, i)).map((t) => t.map(sqName));
  }

  /** Validate and run an action for the side to move (human or bot). */
  private perform(input: ArenaAction): ActResponse {
    const action = this.normalise(input);
    if (!action) return { ok: false, reason: 'Not a legal action' };
    const duel = this.duelFor(action);
    if (duel) {
      this.duel = { info: duel, action, stage: 'offer', round: 0, ties: 0, hands: {} };
      this.events.emit('duelOffered', duel);
      this.maybeBot();
      return { ok: true, pending: 'duel' };
    }
    this.resolve(action);
    return { ok: true };
  }

  /** A clean copy of the legal action matching `input`, or null. */
  private normalise(a: ArenaAction): ArenaAction | null {
    if (!a || typeof a !== 'object') return null;
    if (a.type === 'endTurn' && !isBoard(this.s.mode)) return { type: 'endTurn' };
    const key = actionKey(a.type === 'power' ? { ...a, targets: Array.isArray(a.targets) ? a.targets : [] } : a);
    const found = legalActions(this.s).find((x) => actionKey(x) === key);
    return found ?? null;
  }

  /** Can the defender duel this? A shove (or Headbutt) that would make one of its animals fall in; a tag on its carrier. */
  private duelFor(a: ArenaAction): DuelInfo | null {
    const s = this.s;
    if (isBoard(s.mode) || a.type === 'endTurn' || a.type === 'step' || a.type === 'pick' || a.type === 'shape') return null;
    const i = findA(s, a.pieceId);
    const attacker = s.board[i]!;
    const defender = opposite(attacker.side);
    if (s.tokens[defender] <= 0) return null;
    let victimId: PieceId | null = null;
    let to: Square;
    let via: DuelInfo['via'];
    if (a.type !== 'hit') return null; // powers can't be dueled
    if (s.mode === 'sumo') {
      to = a.target;
      const trial = cloneArena(s);
      const out = applyAction(trial, a);
      const fall = out.changes.find((c) => c.type === 'fall' && trial.out.some((p) => p.id === c.pieceId && p.side === defender));
      if (!fall || fall.type !== 'fall') return null;
      victimId = fall.pieceId;
      via = 'shove';
    } else {
      const victim = s.board[sqIndex(a.target)]!;
      if (!carriedBy(s, victim.id)) return null;
      victimId = victim.id;
      to = a.target;
      via = 'tag';
    }
    return {
      attackerId: attacker.id, victimId, via, from: sqName(i), to, attacker: attacker.side, defender, tokensLeft: s.tokens[defender],
    };
  }

  private answer(call: boolean): void {
    const d = this.duel!;
    if (!call) {
      this.events.emit('duelEnded', { info: d.info, called: false, winner: 'attacker' });
      return this.endDuel('attacker');
    }
    this.s.tokens[d.info.defender]--;
    d.stage = 'throw';
    d.round = 1;
    this.startRound();
  }

  /** A new throw round. The `state` (phase 'duel') is the signal to ask the human side(s) for a hand. */
  private startRound(): void {
    const d = this.duel!;
    d.hands = {};
    this.events.emit('state', this.snapshot());
    const bot = this.botSide();
    if (bot && (bot === d.info.attacker || bot === d.info.defender)) d.hands[bot] = HANDS[Math.floor(this.botRandom() * 3)];
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
    if (winner === 'attacker') return this.resolve(d.action);
    // Bonked: the AP is spent (a Headbutt counts as used) and nothing moves.
    const s = this.s;
    const a = d.action as Extract<ArenaAction, { type: 'hit' }>;
    const p = s.board[findA(s, a.pieceId)]!;
    const victim = s.board[findA(s, d.info.victimId)];
    s.ap -= hitCostOf(s, s.board[sqIndex(a.target)]!);
    const record: ActionRecord = {
      side: p.side, kind: 'bonk',
      label: `Bonked! ${victim ? `${ANIMAL[victim.side][victim.kind]} won the duel` : 'The defender won the duel'}; ${ANIMAL[p.side][p.kind]}'s ${s.mode === 'sumo' ? 'shove' : 'tag'} failed`,
    };
    this.records.push(record);
    this.events.emit('bonked', { info: d.info });
    this.events.emit('logged', record);
    this.events.emit('state', this.snapshot());
    this.afterAction();
  }

  /** Apply a legal action, then send acted · logged · state, then end the turn or the game if due. */
  private resolve(action: ArenaAction): void {
    if (isBoard(this.s.mode)) return this.resolveBoard(action);
    const s = this.s;
    const mover = s.turn;
    if (action.type === 'endTurn') {
      const record: ActionRecord = { side: mover, kind: 'pass', label: applyAction(s, action).label };
      this.records.push(record);
      this.events.emit('logged', record);
      return this.endOfTurn();
    }
    const out = applyAction(s, action);
    const record: ActionRecord = {
      side: mover, kind: action.type === 'power' ? 'power' : 'move', label: out.label,
    };
    this.records.push(record);
    const over = detectOver(s, mover);
    if (over) s.over = over;
    this.events.emit('acted', { side: mover, action, ...(out.power ? { power: out.power } : {}), changes: out.changes });
    this.events.emit('logged', record);
    this.events.emit('state', this.snapshot());
    if (over) return this.finish(over);
    this.afterAction();
  }

  /** Board-game modes: acted · logged · state · [crowned], then the turn ends after its last stage. */
  private resolveBoard(action: ArenaAction): void {
    const s = this.s;
    const mover = s.turn;
    const out = applyAction(s, action);
    if (action.type === 'endTurn') {
      const record: ActionRecord = { side: mover, kind: 'pass', label: out.label };
      this.records.push(record);
      this.events.emit('logged', record);
      return this.endOfTurn();
    }
    const record: ActionRecord = { side: mover, kind: action.type === 'power' ? 'power' : 'move', label: out.label };
    this.records.push(record);
    this.events.emit('acted', { side: mover, action, ...(out.power ? { power: out.power } : {}), changes: out.changes });
    this.events.emit('logged', record);
    this.events.emit('state', this.snapshot());
    if (s.over) return this.finish(s.over);
    this.syncCrowned();
    if (out.done) return this.endOfTurn();
    this.maybeBot();
  }

  /** Castle: announce the crown when it changes (an animal stepped onto a castle, or the crown was lost: null). */
  private syncCrowned(): void {
    if (this.s.mode !== 'castle') return;
    const c = crownedOf(this.s);
    const key = c ? `${c.id}@${c.sq}` : '';
    if (key === this.crownKey) return;
    this.crownKey = key;
    this.events.emit('crowned', { crowned: c ? { pieceId: c.id, side: c.side, square: sqName(c.sq) } : null });
  }

  /** [tide · logged] · state · gameOver? · turnChanged, then the next turn starts. */
  private endOfBoardTurn(): void {
    const s = this.s;
    const e = this.events;
    const completed = completingRound(s);
    const tide = boardEndTurn(s);
    if (tide) {
      const record: ActionRecord = { side: null, kind: 'wheel', label: tide.label };
      this.records.push(record);
      e.emit('tide', { changes: tide.changes });
      e.emit('logged', record);
    }
    const over = turnOverResult(s, completed);
    if (over) s.over = over;
    e.emit('state', this.snapshot());
    if (over) return this.finish(over);
    e.emit('turnChanged', { turn: s.turn });
    this.startBoardTurn();
  }

  /** [castle: still on a castle? state · gameOver] · state · [crowned]; a side with nothing to do passes. */
  private startBoardTurn(): void {
    const s = this.s;
    const e = this.events;
    const win = startWin(s);
    if (win) {
      s.over = win;
      e.emit('state', this.snapshot());
      return this.finish(win);
    }
    const any = beginTurn(s);
    e.emit('state', this.snapshot());
    this.syncCrowned();
    if (any) return this.maybeBot();
    s.passes++;
    const record: ActionRecord = { side: s.turn, kind: 'pass', label: passLabel(s.turn) };
    this.records.push(record);
    e.emit('logged', record);
    this.endOfBoardTurn();
  }

  /** After an action: the turn ends when AP is spent or nothing is left to do; else the side (or bot) goes on. */
  private afterAction(): void {
    if (this.s.ap <= 0 || !hasAnyAction(this.s)) return this.endOfTurn();
    this.maybeBot();
  }

  /** [sank · logged] · state · gameOver? · turnChanged, then the next turn starts. */
  private endOfTurn(): void {
    if (isBoard(this.s.mode)) return this.endOfBoardTurn();
    const s = this.s;
    const e = this.events;
    const mover = s.turn;
    const completedRound = mover === 'sea' ? s.round : null;
    const sink = endTurn(s);
    if (sink) {
      const record: ActionRecord = { side: null, kind: 'wheel', label: sink.label };
      this.records.push(record);
      e.emit('sank', { squares: sink.squares, sunk: sink.sunk, sinkingNext: sink.sinkingNext, changes: sink.changes });
      e.emit('logged', record);
    }
    let over = sink ? detectOver(s, null) : null;
    if (!over && completedRound !== null && completedRound >= maxRoundsOf(s)) over = roundCapResult(s);
    if (over) s.over = over;
    e.emit('state', this.snapshot());
    if (over) return this.finish(over);
    e.emit('turnChanged', { turn: s.turn });
    this.startTurn();
  }

  /** [wheelSpun · logged] · rolled · state; a side with nothing to do passes. */
  private startTurn(): void {
    if (isBoard(this.s.mode)) return this.startBoardTurn();
    const s = this.s;
    const e = this.events;
    if (wheelDue(s)) {
      const w = spinWheel(s);
      const record: ActionRecord = { side: null, kind: 'wheel', label: w.label };
      this.records.push(record);
      e.emit('wheelSpun', { outcome: w.outcome, ...(w.direction ? { direction: w.direction } : {}), changes: w.changes });
      e.emit('logged', record);
      const over = detectOver(s, null);
      if (over) {
        s.over = over;
        e.emit('state', this.snapshot());
        return this.finish(over);
      }
    }
    const value = roll(s);
    e.emit('rolled', { side: s.turn, value, ap: s.ap });
    e.emit('state', this.snapshot());
    if (hasAnyAction(s)) return this.maybeBot();
    const record: ActionRecord = { side: s.turn, kind: 'pass', label: `${cap(s.turn)} had nothing to do and passed` };
    this.records.push(record);
    e.emit('logged', record);
    this.endOfTurn();
  }

  private finish(over: GameOver): void {
    this.s.over = over;
    this.duel = null;
    this.cancelBot();
    this.events.emit('gameOver', over);
  }

  // ---------- helpers ----------

  private snapshot(): ArenaState {
    const s = this.s;
    const raid = s.mode === 'raid';
    return {
      mode: s.mode,
      round: s.over ? Math.min(s.round, maxRoundsOf(s)) : s.round,
      turn: s.turn,
      phase: s.over ? 'over' : this.duel ? 'duel' : 'action',
      die: s.die,
      ap: s.ap,
      pieces: piecesOn(s),
      out: s.out.map((p) => ({ ...p })),
      powersUsed: s.powersUsed.slice(),
      statuses: s.statuses.map((x) => ({ pieceId: x.id, status: x.status, turnsLeft: x.turnsLeft })),
      squares: s.blocks.map((b) => ({ square: sqName(b.sq), effect: 'blocked' as const, by: b.by, turnsLeft: b.turnsLeft })),
      duelTokens: { ...s.tokens },
      sunk: SQUARES.filter((i) => isSunk(s, i)).map(sqName),
      sinkingNext: sinkingNext(s).map(sqName),
      nextSinkIn: nextSinkIn(s),
      treasures: s.treasures.map((t) => ({ owner: t.owner, home: sqName(t.home), square: t.sq === null ? null : sqName(t.sq), carrier: t.carrier })),
      score: { ...s.score },
      target: raid ? s.cfg.pointsToWin : 0,
      nextWheelIn: nextWheelIn(s),
      maxRounds: maxRoundsOf(s),
      ...(isBoard(s.mode) ? this.boardSnapshot() : {}),
    };
  }

  /** The Phase 6 fields of the snapshot. */
  private boardSnapshot(): Partial<ArenaState> {
    const s = this.s;
    const base: Partial<ArenaState> = {
      phase: s.over ? 'over' : s.stage === 'pick' ? 'draft' : 'action',
      die: null, ap: 0, duelTokens: { land: 0, sea: 0 },
      ...(s.over ? {} : { stage: s.stage ?? undefined }),
      mover: s.mover,
    };
    if (s.mode === 'stones') {
      return { ...base, fresh: s.cfg.freshRule ? s.fresh.map(sqName) : [], pathLength: { land: pathLength(s, 'land'), sea: pathLength(s, 'sea') } };
    }
    const levels: Partial<Record<Square, Level>> = {};
    for (let i = 0; i < 64; i++) if (s.levels[i]) levels[sqName(i)] = s.levels[i] as Level;
    const c = crownedOf(s);
    return {
      ...base,
      levels,
      crowned: c ? { pieceId: c.id, side: c.side, square: sqName(c.sq) } : null,
      nextTideIn: nextTideIn(s),
      draft: { size: s.cfg.castleDraftSize, picks: { land: s.picks.land.slice(), sea: s.picks.sea.slice() } },
    };
  }

  private promptFor(pieceId: PieceId, n: number, complete: boolean): string {
    const s = this.s;
    const p = s.board[findA(s, pieceId)];
    if (!p) return '';
    if (s.mode === 'stones') return stonesPrompt(p.kind, n, complete);
    const power = powerName(s.mode, p.kind);
    if (complete) {
      if (p.kind === 'p' && s.mode === 'sumo') return 'Dig in: it can\'t be pushed until your next turn';
      if (p.kind === 'r') return s.mode === 'sumo' ? 'Stomp shoves every enemy next to it' : 'Stomp stuns every enemy next to it (not the king)';
      return `Ready: ${power}`;
    }
    switch (p.kind) {
      case 'p': return 'Pick an empty square beside it';
      case 'n': return n === 0 ? 'Pick the first hop' : 'Pick where to land';
      case 'b': return s.mode === 'sumo' ? 'Pick an enemy next to it to headbutt 2 squares' : 'Pick an enemy next to it to push';
      case 'q': return 'Pick an empty square to block';
      case 'k': return 'Pick an empty square up to 2 away';
      default: return '';
    }
  }

  // ---------- bot ----------

  private botSide(): Side | null {
    const o = this.options?.opponent;
    return o?.type === 'bot' ? o.botSide : null;
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
  private botNeed(): 'action' | 'duel' | null {
    const bot = this.botSide();
    if (!bot || this.s.over || this.disposed) return null;
    if (this.duel) return this.duel.stage === 'offer' && this.duel.info.defender === bot ? 'duel' : null;
    return this.s.turn === bot ? 'action' : null;
  }

  /** The bot plays one action at a time; while paused, it holds the next one. */
  private maybeBot(): void {
    const need = this.botNeed();
    if (!need || this.botThinking) return;
    const level = (this.options.opponent as { level: BotLevel }).level;
    const cfg = this.s.cfg.bot[level] ?? this.s.cfg.bot[4];
    const levels = this.s.mode === 'castle' ? this.s.cfg.castleBot : this.s.mode === 'stones' ? this.s.cfg.stonesBot : null;
    const board = levels ? levels[level] ?? levels[4] : null;
    const token = ++this.botToken;
    this.setBotThinking(true);

    let pick: Promise<ArenaAction | boolean | null>;
    if (need === 'duel') {
      const d = this.duel!;
      pick = Promise.resolve(wantsDuel(this.s, d.info, () => this.botRandom()));
    } else if (board) {
      const req = { state: cloneArena(this.s), level: cfg, board, seed: Math.floor(this.botRandom() * 2 ** 31) };
      pick = (this.bot ?? (this.bot = createLocalArenaBot())).decide(req);
    } else if (this.botRandom() < cfg.randomChance) {
      const all = legalActions(this.s, true);
      const pool = all.length > 1 ? all.filter((a) => a.type !== 'endTurn') : all;
      pick = Promise.resolve(pool[Math.floor(this.botRandom() * pool.length)]);
    } else {
      const req = { state: cloneArena(this.s), level: cfg, seed: Math.floor(this.botRandom() * 2 ** 31) };
      pick = (this.bot ?? (this.bot = createLocalArenaBot())).decide(req);
    }
    void Promise.all([pick, wait(this.deps.botMinThinkMs ?? board?.minThinkMs ?? cfg.minThinkMs)]).then(([choice]) => {
      if (token !== this.botToken) return;
      const step = () => {
        this.setBotThinking(false);
        if (token !== this.botToken || this.botNeed() !== need) return this.maybeBot();
        if (need === 'duel') return this.answer(choice as boolean);
        this.botAct(choice as ArenaAction | null);
      };
      if (this.paused) this.heldBotStep = step;
      else step();
    });
  }

  private botAct(choice: ArenaAction | null): void {
    if (choice && this.perform(choice).ok) return;
    if (choice) console.warn('[core] arena bot picked an illegal action; ending its turn', choice);
    // Board-game modes have no free end turn: take the first legal action instead.
    this.perform(isBoard(this.s.mode) ? legalActions(this.s)[0] ?? { type: 'endTurn' } : { type: 'endTurn' });
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

const SQUARES = Array.from({ length: 64 }, (_, i) => i);

function stonesPrompt(kind: PieceKind, n: number, complete: boolean): string {
  if (complete) return kind === 'r' ? 'Stomp sinks every empty stone around it' : `Ready: ${STONES_POWERS[kind].name}`;
  switch (kind) {
    case 'p': return n === 0 ? 'Pick a sunk square next to dry land' : 'Pick the second sunk square, next to the first';
    case 'n': return n === 0 ? 'Pick the first hop' : 'Pick where to land';
    case 'b': return 'Pick an enemy next to it to push';
    case 'q': return 'Pick an empty dry square to block';
    case 'k': return 'Pick an empty dry square up to 2 away';
    default: return '';
  }
}

/** The squares a shove line touches: where its animals stand now, plus where the last one ends (if on the board). */
function lineArea(line: { moves: [number, number][]; fall: number | null; dir: [number, number] }): Square[] {
  const out = new Set<number>();
  for (const [a, b] of line.moves) {
    out.add(a);
    out.add(b);
  }
  if (line.fall !== null) {
    out.add(line.fall);
    const f = (line.fall & 7) + line.dir[0];
    const r = (line.fall >> 3) + line.dir[1];
    if (f >= 0 && f < 8 && r >= 0 && r < 8) out.add(f + 8 * r);
  }
  return [...out].map(sqName);
}
