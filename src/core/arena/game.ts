/**
 * ArenaGame: the ArenaController for Sumo and Raid (GAME_SPEC "Party modes"). No chess here.
 * Event order (types.ts `ArenaController`, docs/phase4-briefs.md "Event order"):
 *   newGame: started · state · turnChanged · rolled · state
 *   an action: [duelOffered, duelRound*, duelEnded] · acted · logged · state      (a bonk: bonked · logged · state)
 *   end of a turn (AP spent, nothing left to do, or endTurn): [sank · logged] · state · gameOver? · turnChanged ·
 *     [wheelSpun · logged] · rolled · state
 *   a game that ends mid-turn: acted · logged · state (phase 'over') · gameOver
 */
import { Emitter } from '../../contracts/emitter';
import type {
  ActionRecord, ActResponse, ArenaAction, ArenaController, ArenaEventMap, ArenaPieceOptions, ArenaState, BotLevel, DuelInfo,
  GameOptions, GameOver, Hand, PieceId, Side, Square, TargetStep, Unsubscribe,
} from '../../contracts/types';
import { POWER_OF } from '../../contracts/types';
import { opposite, sqIndex, sqName } from '../modes/state';
import { createLocalArenaBot, type ArenaBotEngine } from './botClient';
import { wantsDuel } from './bot';
import {
  ANIMAL, actionKey, applyAction, carriedBy, cloneArena, createArenaState, detectOver, endTurn, findA, hasAnyAction,
  hitCostOf, hitTargets, isSunk, legalActions, maxRoundsOf, nextSinkIn, nextWheelIn, piecesOn, powerBlock, powerName,
  powerOptions, pushLine, roll, roundCapResult, sentHomeSquare, shoveLine, sinkingNext,
  spinWheel, stepCostOf, stepTargets, stompShoves, stunVictims, wheelDue, type AState,
} from './rules';
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
    const s = this.s;
    const i = findA(s, pieceId);
    const p = s.board[i];
    const power = POWER_OF[p?.kind ?? (pieceId.split('-')[1] as keyof typeof POWER_OF) ?? 'p'] ?? 'sidestep';
    const none: ArenaPieceOptions = { steps: [], hits: [], stepCost: 0, hitCosts: [], power: { power, available: false, reason: 'noTarget' } };
    if (!p) return none;
    const stepCost = stepCostOf(s, p);
    if (!this.humanCanAct() || p.side !== s.turn) {
      const reason = s.over || this.duel ? 'wrongPhase' : 'notYourTurn';
      return { ...none, stepCost, power: { power, available: false, reason } };
    }
    const hits = hitTargets(s, i);
    const block = powerBlock(s, i);
    return {
      steps: stepTargets(s, i).map(sqName),
      hits: hits.map((h) => sqName(h.target)),
      stepCost,
      hitCosts: hits.map((h) => h.cost),
      power: block ? { power, available: false, reason: block } : { power, available: true },
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

  previewArea(pending: { pieceId: PieceId; targets: Square[] } | { pieceId: PieceId; hit: Square }): Square[] {
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
    if (options.mode !== 'sumo' && options.mode !== 'raid') throw new Error(`ArenaController runs 'sumo' or 'raid', not '${options.mode}'`);
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.cancelBot();
    this.options = { ...options, opponent: { ...options.opponent }, time: { ...options.time } };
    this.s = createArenaState(options.mode, getArenaTuning(), seed);
    this.botRng = (seed ^ 0x9e3779b9) >>> 0;
    this.records = [];
    this.duel = null;
    this.paused = false;
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
    return i < 0 ? [] : powerOptions(this.s, i).map((t) => t.map(sqName));
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
    if (a.type === 'endTurn') return { type: 'endTurn' };
    const key = actionKey(a.type === 'power' ? { ...a, targets: Array.isArray(a.targets) ? a.targets : [] } : a);
    const found = legalActions(this.s).find((x) => actionKey(x) === key);
    return found ?? null;
  }

  /** Can the defender duel this? A shove (or Headbutt) that would make one of its animals fall in; a tag on its carrier. */
  private duelFor(a: ArenaAction): DuelInfo | null {
    const s = this.s;
    if (a.type === 'endTurn' || a.type === 'step') return null;
    const i = findA(s, a.pieceId);
    const attacker = s.board[i]!;
    const defender = opposite(attacker.side);
    if (s.tokens[defender] <= 0) return null;
    let victimId: PieceId | null = null;
    let to: Square;
    let via: DuelInfo['via'];
    if (s.mode === 'sumo') {
      const isHeadbutt = a.type === 'power' && attacker.kind === 'b';
      if (a.type !== 'hit' && !isHeadbutt) return null;
      to = a.type === 'hit' ? a.target : (a as Extract<ArenaAction, { type: 'power' }>).targets[0];
      const trial = cloneArena(s);
      const out = applyAction(trial, a);
      const fall = out.changes.find((c) => c.type === 'fall' && trial.out.some((p) => p.id === c.pieceId && p.side === defender));
      if (!fall || fall.type !== 'fall') return null;
      victimId = fall.pieceId;
      via = 'shove';
    } else {
      if (a.type !== 'hit') return null;
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
    const a = d.action as Extract<ArenaAction, { type: 'hit' | 'power' }>;
    const p = s.board[findA(s, a.pieceId)]!;
    const victim = s.board[findA(s, d.info.victimId)];
    if (a.type === 'hit') s.ap -= hitCostOf(s, s.board[sqIndex(a.target)]!);
    else {
      s.ap -= s.cfg.powerCost;
      s.powersUsed.push(p.id);
    }
    const record: ActionRecord = {
      side: p.side, kind: 'bonk',
      label: `Bonked! ${victim ? `${ANIMAL[victim.side][victim.kind]} won the duel` : 'The defender won the duel'}; ${ANIMAL[p.side][p.kind]}'s ${a.type === 'hit' ? (s.mode === 'sumo' ? 'shove' : 'tag') : 'Headbutt'} failed`,
    };
    this.records.push(record);
    this.events.emit('bonked', { info: d.info });
    this.events.emit('logged', record);
    this.events.emit('state', this.snapshot());
    this.afterAction();
  }

  /** Apply a legal action, then send acted · logged · state, then end the turn or the game if due. */
  private resolve(action: ArenaAction): void {
    const s = this.s;
    const mover = s.turn;
    const out = applyAction(s, action);
    const record: ActionRecord = {
      side: mover, kind: action.type === 'power' ? 'power' : action.type === 'endTurn' ? 'pass' : 'move', label: out.label,
    };
    this.records.push(record);
    const over = detectOver(s, mover);
    if (over) s.over = over;
    this.events.emit('acted', { side: mover, action, ...(out.power ? { power: out.power } : {}), changes: out.changes });
    this.events.emit('logged', record);
    this.events.emit('state', this.snapshot());
    if (over) return this.finish(over);
    if (action.type === 'endTurn') return this.endOfTurn();
    this.afterAction();
  }

  /** After an action: the turn ends when AP is spent or nothing is left to do; else the side (or bot) goes on. */
  private afterAction(): void {
    if (this.s.ap <= 0 || !hasAnyAction(this.s)) return this.endOfTurn();
    this.maybeBot();
  }

  /** [sank · logged] · state · gameOver? · turnChanged, then the next turn starts. */
  private endOfTurn(): void {
    const s = this.s;
    const e = this.events;
    const mover = s.turn;
    const completedRound = mover === 'sea' ? s.round : null;
    const sink = endTurn(s);
    if (sink) {
      const record: ActionRecord = { side: null, kind: 'wheel', label: sink.label };
      this.records.push(record);
      e.emit('sank', { squares: sink.squares, changes: sink.changes });
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
    };
  }

  private promptFor(pieceId: PieceId, n: number, complete: boolean): string {
    const s = this.s;
    const p = s.board[findA(s, pieceId)];
    if (!p) return '';
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
    const token = ++this.botToken;
    this.setBotThinking(true);

    let pick: Promise<ArenaAction | boolean | null>;
    if (need === 'duel') {
      const d = this.duel!;
      pick = Promise.resolve(wantsDuel(this.s, d.info, () => this.botRandom()));
    } else if (this.botRandom() < cfg.randomChance) {
      const all = legalActions(this.s, true);
      const pool = all.length > 1 ? all.filter((a) => a.type !== 'endTurn') : all;
      pick = Promise.resolve(pool[Math.floor(this.botRandom() * pool.length)]);
    } else {
      const req = { state: cloneArena(this.s), level: cfg, seed: Math.floor(this.botRandom() * 2 ** 31) };
      pick = (this.bot ?? (this.bot = createLocalArenaBot())).decide(req);
    }
    void Promise.all([pick, wait(this.deps.botMinThinkMs ?? cfg.minThinkMs)]).then(([choice]) => {
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
    this.perform({ type: 'endTurn' });
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
