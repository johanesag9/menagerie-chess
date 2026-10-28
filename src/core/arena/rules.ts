/**
 * Sumo and Raid rules (GAME_SPEC "Party modes") on a plain board model, so the bot can clone it and run it in a worker.
 * Squares are indexes 0..63: file + 8 * rank (a1 = 0, h8 = 63), as in ../modes/state.ts.
 * Every function is pure apart from mutating the state passed in.
 *
 * Words: "dry" = not sunk. "free for a side" = no animal, no block, dry, and (Raid) not a home square closed to that side:
 * your own home is always closed (no guarding); the enemy's home is open only while their treasure lies on it.
 */
import { POWER_OF } from '../../contracts/types';
import type {
  ArenaAction, ArenaMode, BoardChange, DieValue, GameOver, PieceId, PieceKind, PieceState, PieceStatusKind, PowerBlock,
  PowerKind, Side, Square, WheelOutcome,
} from '../../contracts/types';
import { fileOf, idx, onBoard, opposite, rankOf, sqName } from '../modes/state';
import type { ArenaTuning } from './tuning';

export interface APiece { readonly id: PieceId; readonly side: Side; readonly kind: PieceKind }
export interface AStatus { id: PieceId; status: PieceStatusKind; turnsLeft: number }
export interface ABlock { sq: number; by: Side; turnsLeft: number }
export interface ATreasure { owner: Side; home: number; sq: number | null; carrier: PieceId | null }

export interface AState {
  mode: ArenaMode;
  cfg: ArenaTuning;
  board: (APiece | null)[];
  /** Sumo: animals that fell in, with the square they fell from. */
  out: PieceState[];
  turn: Side;
  round: number;
  die: DieValue | null;
  ap: number;
  powersUsed: PieceId[];
  statuses: AStatus[];
  blocks: ABlock[];
  tokens: Record<Side, number>;
  /** Sumo: rings sunk so far (ring 0 = the outer ring). */
  sunkRings: number;
  /** Raid: [Land's bone, Sea's pearl]. Sumo: []. */
  treasures: ATreasure[];
  score: Record<Side, number>;
  /** mulberry32 state: dice, wheel. */
  rng: number;
  over: GameOver | null;
}

export const ANIMAL: Record<Side, Record<PieceKind, string>> = {
  land: { p: 'Pup', n: 'Horse', b: 'Goat', r: 'Elephant', q: 'Cat', k: 'Pug' },
  sea: { p: 'Crab', n: 'Seahorse', b: 'Pufferfish', r: 'Turtle', q: 'Octopus', k: 'Blobfish' },
};
export const TREASURE_NAME: Record<Side, string> = { land: 'bone', sea: 'pearl' };
export const WHEEL_NAME: Record<WheelOutcome, string> = { tide: 'Tide', pigeon: 'Pigeon', earthquake: 'Earthquake', disco: 'Disco' };
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function powerName(mode: ArenaMode, kind: PieceKind): string {
  if (kind === 'p') return mode === 'sumo' ? 'Dig in' : 'Sidestep';
  return { n: 'Double jump', b: 'Headbutt', r: 'Stomp', q: 'Block', k: 'Escape' }[kind];
}

/** The team: one of each kind, in files b..g of rank 2 (Land) and rank 7 (Sea). */
const TEAM: [PieceKind, number][] = [['n', 1], ['b', 2], ['q', 3], ['k', 4], ['r', 5], ['p', 6]];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
/** Diagonals first: a stomp shoves the farthest neighbours first. */
const NEIGHBOURS = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export const BONE_HOME = 4; // e1
export const PEARL_HOME = 59; // d8

// ---------- set-up ----------

export function createArenaState(mode: ArenaMode, cfg: ArenaTuning, seed: number): AState {
  const board: (APiece | null)[] = new Array(64).fill(null);
  for (const [side, rank] of [['land', 1], ['sea', 6]] as [Side, number][]) {
    for (const [kind, file] of TEAM) board[idx(file, rank)] = { id: `${side}-${kind}-${sqName(idx(file, rank))}`, side, kind };
  }
  return {
    mode, cfg, board, out: [], turn: 'land', round: 1, die: null, ap: 0, powersUsed: [], statuses: [], blocks: [],
    tokens: { land: cfg.duelTokens, sea: cfg.duelTokens },
    sunkRings: 0,
    treasures: mode === 'raid'
      ? [{ owner: 'land', home: BONE_HOME, sq: BONE_HOME, carrier: null }, { owner: 'sea', home: PEARL_HOME, sq: PEARL_HOME, carrier: null }]
      : [],
    score: { land: 0, sea: 0 },
    rng: seed >>> 0,
    over: null,
  };
}

export function cloneArena(s: AState): AState {
  return {
    ...s,
    board: s.board.slice(),
    out: s.out.map((p) => ({ ...p })),
    powersUsed: s.powersUsed.slice(),
    statuses: s.statuses.map((x) => ({ ...x })),
    blocks: s.blocks.map((b) => ({ ...b })),
    tokens: { ...s.tokens },
    treasures: s.treasures.map((t) => ({ ...t })),
    score: { ...s.score },
    over: s.over && { ...s.over },
  };
}

export function rand(s: AState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pickWeighted<K extends string>(s: AState, weights: Record<K, number>): K {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((n, k) => n + Math.max(0, weights[k]), 0);
  let x = rand(s) * total;
  for (const k of keys) {
    x -= Math.max(0, weights[k]);
    if (x < 0) return k;
  }
  return keys[keys.length - 1];
}

export function piecesOn(s: AState): PieceState[] {
  const out: PieceState[] = [];
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p) out.push({ id: p.id, side: p.side, kind: p.kind, square: sqName(i) });
  }
  return out;
}

export function findA(s: AState, id: PieceId): number {
  for (let i = 0; i < 64; i++) if (s.board[i]?.id === id) return i;
  return -1;
}

// ---------- queries ----------

export const ringOf = (i: number) => Math.min(fileOf(i), 7 - fileOf(i), rankOf(i), 7 - rankOf(i));
export const isSunk = (s: AState, i: number) => ringOf(i) < s.sunkRings;
export const blockAt = (s: AState, i: number) => s.blocks.some((b) => b.sq === i);
export const statusOf = (s: AState, id: PieceId) => s.statuses.find((x) => x.id === id);
/** Stunned animals can't step, hit or use a power. Anchored ones can. */
export const canAct = (s: AState, id: PieceId) => !s.statuses.some((x) => x.id === id && x.status !== 'anchored');
export const isAnchored = (s: AState, id: PieceId) => s.statuses.some((x) => x.id === id && x.status === 'anchored');
/** Raid halves: Land's meadow is ranks 1-4, Sea's beach ranks 5-8. */
export const halfOf = (i: number): Side => (rankOf(i) < 4 ? 'land' : 'sea');
export const treasureOf = (s: AState, owner: Side) => s.treasures.find((t) => t.owner === owner)!;
export const carriedBy = (s: AState, id: PieceId) => s.treasures.find((t) => t.carrier === id) ?? null;
export const treasureAt = (s: AState, i: number) => s.treasures.find((t) => t.sq === i) ?? null;
const isHome = (s: AState, i: number) => s.treasures.some((t) => t.home === i);
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Can an animal of `side` end up on square i? */
export function canEnter(s: AState, side: Side, i: number): boolean {
  if (s.board[i] || blockAt(s, i) || isSunk(s, i)) return false;
  for (const t of s.treasures) {
    if (t.home !== i) continue;
    if (t.owner === side ? s.cfg.noGuarding : t.sq !== i) return false;
  }
  return true;
}

export function stepCostOf(s: AState, p: APiece): number {
  return s.mode === 'raid' && carriedBy(s, p.id) ? s.cfg.carrierStepCost : s.cfg.stepCost;
}

export function hitCostOf(s: AState, victim: APiece): number {
  if (s.mode === 'raid') return s.cfg.tagCost;
  return s.cfg.heavyKinds.includes(victim.kind) ? s.cfg.heavyShoveCost : s.cfg.shoveCost;
}

export function powerCostOf(s: AState, p: APiece): number {
  return s.mode === 'raid' && p.kind === 'p' ? s.cfg.sidestepCost : s.cfg.powerCost;
}

/** An animal of the side to move that may act now. */
function active(s: AState, i: number): APiece | null {
  const p = s.board[i];
  return p && !s.over && p.side === s.turn && canAct(s, p.id) ? p : null;
}

function neighbours(i: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [df, dr] of NEIGHBOURS) if (onBoard(fileOf(i) + df, rankOf(i) + dr)) out.push([idx(fileOf(i) + df, rankOf(i) + dr), df, dr]);
  return out;
}

// ---------- shoves (Sumo) ----------

export interface Line {
  /** [from, to] for every animal that moves, the farthest first. */
  moves: [number, number][];
  /** The square of the animal at the end of the line that falls in, else null. */
  fall: number | null;
  dir: [number, number];
}

/**
 * Push the animal on v one square toward (df, dr), with everything lined up behind it.
 * Null when it can't be done: the end of the line is a blocked square, or an anchored animal is in the line.
 */
export function pushLine(s: AState, v: number, df: number, dr: number): Line | null {
  const line: number[] = [];
  let f = fileOf(v);
  let r = rankOf(v);
  while (onBoard(f, r) && s.board[idx(f, r)]) {
    line.push(idx(f, r));
    f += df;
    r += dr;
  }
  if (!line.length || line.some((j) => isAnchored(s, s.board[j]!.id))) return null;
  const end = onBoard(f, r) ? idx(f, r) : -1;
  if (end >= 0 && blockAt(s, end)) return null;
  const falls = end < 0 || isSunk(s, end);
  const moves: [number, number][] = [];
  for (let k = line.length - 1; k >= 0; k--) {
    if (falls && k === line.length - 1) continue;
    moves.push([line[k], line[k] + df + 8 * dr]);
  }
  return { moves, fall: falls ? line[line.length - 1] : null, dir: [df, dr] };
}

/** The shove of the enemy on v by the animal on a (they must be neighbours). */
export const shoveLine = (s: AState, a: number, v: number) => pushLine(s, v, sign(fileOf(v) - fileOf(a)), sign(rankOf(v) - rankOf(a)));

function knockOut(s: AState, i: number, dir: [number, number], step: number): BoardChange {
  const p = s.board[i]!;
  s.board[i] = null;
  s.out.push({ id: p.id, side: p.side, kind: p.kind, square: sqName(i) });
  s.statuses = s.statuses.filter((x) => x.id !== p.id);
  return { step, type: 'fall', pieceId: p.id, square: sqName(i), dir: [dir[0], dir[1]] };
}

function relocate(s: AState, from: number, to: number): void {
  s.board[to] = s.board[from];
  s.board[from] = null;
}

/** Apply a line: its moves in `step`, a fall in the step after. Returns the next free step. */
function applyLine(s: AState, line: Line, step: number, changes: BoardChange[]): number {
  const fall = line.fall !== null ? knockOut(s, line.fall, line.dir, step + (line.moves.length ? 1 : 0)) : null;
  for (const [a, b] of line.moves) {
    const p = s.board[a]!;
    relocate(s, a, b);
    changes.push({ step, type: 'move', pieceId: p.id, from: sqName(a), to: sqName(b), how: 'pushed' });
  }
  if (fall) changes.push(fall);
  return step + (line.moves.length ? 1 : 0) + (fall ? 1 : 0);
}

/** A stomp's shoves: every enemy neighbour whose line can move, diagonals first. */
export function stompShoves(s: AState, i: number): number[] {
  const p = s.board[i];
  if (!p) return [];
  return neighbours(i).filter(([j]) => s.board[j] && s.board[j]!.side !== p.side && shoveLine(s, i, j)).map(([j]) => j);
}

// ---------- tags and treasures (Raid) ----------

/** Raid Stomp victims: enemy neighbours, not the king (as in Normal). */
export function stunVictims(s: AState, i: number): number[] {
  const p = s.board[i];
  if (!p) return [];
  return neighbours(i).filter(([j]) => s.board[j] && s.board[j]!.side !== p.side && s.board[j]!.kind !== 'k').map(([j]) => j);
}

/** Where a tagged animal goes: the nearest free square of its back rank (then the next rank in, if the row is full). */
export function sentHomeSquare(s: AState, p: APiece, from: number): number | null {
  const ranks = p.side === 'land' ? [0, 1, 2, 3] : [7, 6, 5, 4];
  for (const r of ranks) {
    let best = -1;
    let bestD = 99;
    for (let f = 0; f < 8; f++) {
      const j = idx(f, r);
      if (!canEnter(s, p.side, j) || treasureAt(s, j)) continue;
      const d = Math.abs(f - fileOf(from));
      if (d < bestD) {
        best = j;
        bestD = d;
      }
    }
    if (best >= 0) return best;
  }
  return null;
}

function treasureChange(t: ATreasure, event: Extract<BoardChange, { type: 'treasure' }>['event'], step: number): BoardChange {
  return { step, type: 'treasure', owner: t.owner, event, square: t.sq === null ? null : sqName(t.sq), carrier: t.carrier };
}

/** A carrier lets go of the treasure where it stands. */
function drop(s: AState, i: number, step: number, changes: BoardChange[]): boolean {
  const p = s.board[i]!;
  const t = carriedBy(s, p.id);
  if (!t) return false;
  t.carrier = null;
  t.sq = i;
  changes.push(treasureChange(t, 'drop', step));
  return true;
}

/**
 * An animal arrived on square i (Raid): it sends its own dropped treasure home, picks up the enemy's,
 * and scores when it carries the enemy treasure in its own half. Each event gets its own step. Returns the next step.
 */
function arrive(s: AState, i: number, step: number, changes: BoardChange[]): number {
  if (s.mode !== 'raid') return step;
  const p = s.board[i];
  if (!p) return step;
  const own = treasureOf(s, p.side);
  const enemy = treasureOf(s, opposite(p.side));
  if (own.sq === i && own.home !== i) {
    own.sq = own.home;
    changes.push(treasureChange(own, 'return', step++));
  }
  if (enemy.sq === i && !enemy.carrier) {
    enemy.sq = null;
    enemy.carrier = p.id;
    changes.push(treasureChange(enemy, 'pickup', step++));
  }
  if (enemy.carrier === p.id && halfOf(i) === p.side) {
    enemy.carrier = null;
    enemy.sq = enemy.home;
    s.score[p.side]++;
    changes.push(treasureChange(enemy, 'score', step++));
  }
  return step;
}

// ---------- options ----------

export function stepTargets(s: AState, i: number): number[] {
  const p = active(s, i);
  if (!p || s.ap < stepCostOf(s, p)) return [];
  return neighbours(i).filter(([j]) => canEnter(s, p.side, j)).map(([j]) => j);
}

export interface Hit { target: number; cost: number }

export function hitTargets(s: AState, i: number): Hit[] {
  const p = active(s, i);
  if (!p) return [];
  const out: Hit[] = [];
  for (const [j] of neighbours(i)) {
    const q = s.board[j];
    if (!q || q.side === p.side) continue;
    const cost = hitCostOf(s, q);
    if (s.ap < cost) continue;
    if (s.mode === 'sumo') {
      if (shoveLine(s, i, j)) out.push({ target: j, cost });
    } else if (halfOf(i) === p.side && halfOf(j) === p.side && sentHomeSquare(s, q, j) !== null) {
      out.push({ target: j, cost });
    }
  }
  return out;
}

/** Every complete target list for this animal's power, ignoring AP, use and turn (see `powerOptions`). */
export function powerOptionsRaw(s: AState, i: number): number[][] {
  const p = s.board[i];
  if (!p) return [];
  const sumo = s.mode === 'sumo';
  const f = fileOf(i);
  const r = rankOf(i);
  const out: number[][] = [];
  switch (p.kind) {
    case 'p':
      if (sumo) out.push([]);
      else for (const df of [-1, 1]) if (onBoard(f + df, r) && canEnter(s, p.side, idx(f + df, r))) out.push([idx(f + df, r)]);
      break;
    case 'n':
      for (const [a, b] of KNIGHT) {
        if (!onBoard(f + a, r + b)) continue;
        const mid = idx(f + a, r + b);
        if (!canEnter(s, p.side, mid) || treasureAt(s, mid)) continue;
        for (const [c, d] of KNIGHT) {
          if (!onBoard(f + a + c, r + b + d)) continue;
          const to = idx(f + a + c, r + b + d);
          if (to !== i && canEnter(s, p.side, to)) out.push([mid, to]);
        }
      }
      break;
    case 'b':
      for (const [v, df, dr] of neighbours(i)) {
        const q = s.board[v];
        if (!q || q.side === p.side) continue;
        if (sumo ? pushLine(s, v, df, dr) : onBoard(f + 2 * df, r + 2 * dr) && canEnter(s, q.side, v + df + 8 * dr)) out.push([v]);
      }
      break;
    case 'r':
      if ((sumo ? stompShoves(s, i) : stunVictims(s, i)).length) out.push([]);
      break;
    case 'q':
      for (let j = 0; j < 64; j++) if (!s.board[j] && !blockAt(s, j) && !isSunk(s, j) && !isHome(s, j) && !treasureAt(s, j)) out.push([j]);
      break;
    case 'k':
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if ((dx || dy) && onBoard(f + dx, r + dy) && canEnter(s, p.side, idx(f + dx, r + dy))) out.push([idx(f + dx, r + dy)]);
        }
      }
      break;
  }
  return out;
}

/** Why this animal can't use its power now (undefined = it can). Carrying and too little AP use 'wrongPhase' (see REPORT.md). */
export function powerBlock(s: AState, i: number): PowerBlock | undefined {
  const p = s.board[i];
  if (!p) return 'noTarget';
  if (s.over) return 'wrongPhase';
  if (p.side !== s.turn) return 'notYourTurn';
  if (s.powersUsed.includes(p.id)) return 'used';
  if (!canAct(s, p.id)) return 'stunned';
  if (s.mode === 'raid' && carriedBy(s, p.id)) return 'wrongPhase';
  if (s.ap < powerCostOf(s, p)) return 'wrongPhase';
  if (!powerOptionsRaw(s, i).length) return 'noTarget';
  return undefined;
}

export function powerOptions(s: AState, i: number): number[][] {
  return powerBlock(s, i) ? [] : powerOptionsRaw(s, i);
}

/** Every legal action for the side to move, end turn last. `forBot` trims block targets to squares next to an animal. */
export function legalActions(s: AState, forBot = false): ArenaAction[] {
  const out: ArenaAction[] = [];
  if (s.over) return out;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.side !== s.turn) continue;
    for (const j of stepTargets(s, i)) out.push({ type: 'step', pieceId: p.id, to: sqName(j) });
    for (const h of hitTargets(s, i)) out.push({ type: 'hit', pieceId: p.id, target: sqName(h.target) });
    let opts = powerOptions(s, i);
    if (forBot && p.kind === 'q') opts = opts.filter(([j]) => neighbours(j).some(([k]) => s.board[k]));
    for (const t of opts) out.push({ type: 'power', pieceId: p.id, targets: t.map(sqName) });
  }
  out.push({ type: 'endTurn' });
  return out;
}

/** Can the side to move do anything but end its turn? */
export function hasAnyAction(s: AState): boolean {
  if (s.over) return false;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.side !== s.turn) continue;
    if (stepTargets(s, i).length || hitTargets(s, i).length || !powerBlock(s, i)) return true;
  }
  return false;
}

export function actionKey(a: ArenaAction): string {
  switch (a.type) {
    case 'step': return `s:${a.pieceId}:${a.to}`;
    case 'hit': return `h:${a.pieceId}:${a.target}`;
    case 'power': return `p:${a.pieceId}:${a.targets.join(',')}`;
    case 'endTurn': return 'e';
  }
}

// ---------- doing things ----------

export interface Outcome {
  changes: BoardChange[];
  label: string;
  power?: PowerKind;
}

const name = (p: APiece) => ANIMAL[p.side][p.kind];

/** Plain words for what the changes did beyond the main action ("and the Pug fell in!"). */
function extras(changes: BoardChange[], ids: Map<PieceId, APiece>): string {
  const bits: string[] = [];
  for (const c of changes) {
    if (c.type === 'fall') bits.push(`${ids.get(c.pieceId) ? name(ids.get(c.pieceId)!) : c.pieceId} fell in`);
    if (c.type === 'treasure') {
      const what = `${cap(c.owner)}'s ${TREASURE_NAME[c.owner]}`;
      if (c.event === 'pickup') bits.push(`grabbed ${what}`);
      if (c.event === 'drop') bits.push(`dropped ${what}`);
      if (c.event === 'return') bits.push(`sent ${what} home`);
      if (c.event === 'score') bits.push(`scored with ${what}`);
    }
  }
  return bits.length ? ` (${bits.join(', ')})` : '';
}

/**
 * Apply a legal action for the side to move (the caller checks it is legal) and spend its AP.
 * `endTurn` changes nothing here; the caller ends the turn.
 */
export function applyAction(s: AState, a: ArenaAction, labels = true): Outcome {
  if (a.type === 'endTurn') return { changes: [], label: `Ended the turn${s.ap ? ` (${s.ap} AP unused)` : ''}` };
  const i = findA(s, a.pieceId);
  const p = s.board[i]!;
  const ids = new Map<PieceId, APiece>();
  if (labels) for (const q of s.board) if (q) ids.set(q.id, q);
  const changes: BoardChange[] = [];
  let label: string;
  let power: PowerKind | undefined;

  if (a.type === 'step') {
    const to = sqIndexOf(a.to);
    s.ap -= stepCostOf(s, p);
    relocate(s, i, to);
    changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: a.to, how: 'step' });
    arrive(s, to, 1, changes);
    label = `${name(p)} ${sqName(i)}→${a.to}`;
  } else if (a.type === 'hit') {
    const v = sqIndexOf(a.target);
    const victim = s.board[v]!;
    s.ap -= hitCostOf(s, victim);
    if (s.mode === 'sumo') {
      applyLine(s, shoveLine(s, i, v)!, 0, changes);
      label = `${name(p)} shoved ${name(victim)} on ${a.target}`;
    } else {
      const dropped = drop(s, v, 0, changes);
      const home = sentHomeSquare(s, victim, v)!;
      relocate(s, v, home);
      changes.push({ step: dropped ? 1 : 0, type: 'move', pieceId: victim.id, from: a.target, to: sqName(home), how: 'sentHome' });
      label = `${name(p)} tagged ${name(victim)} on ${a.target}, sent home to ${sqName(home)}`;
    }
  } else {
    power = POWER_OF[p.kind];
    s.ap -= powerCostOf(s, p);
    s.powersUsed.push(p.id);
    const t = a.targets.map(sqIndexOf);
    const pname = `${name(p)}: ${powerName(s.mode, p.kind)}`;
    label = pname;
    switch (p.kind) {
      case 'p':
        if (s.mode === 'sumo') {
          s.statuses = s.statuses.filter((x) => x.id !== p.id);
          s.statuses.push({ id: p.id, status: 'anchored', turnsLeft: 1 });
          changes.push({ step: 0, type: 'status', pieceId: p.id, status: 'anchored' });
          label = `${pname} on ${sqName(i)}`;
        } else {
          relocate(s, i, t[0]);
          changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(t[0]), how: 'sidestep' });
          arrive(s, t[0], 1, changes);
          label = `${pname} ${sqName(i)}→${sqName(t[0])}`;
        }
        break;
      case 'n':
        relocate(s, i, t[0]);
        changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(t[0]), how: 'jump' });
        relocate(s, t[0], t[1]);
        changes.push({ step: 1, type: 'move', pieceId: p.id, from: sqName(t[0]), to: sqName(t[1]), how: 'jump' });
        arrive(s, t[1], 2, changes);
        label = `${pname} ${sqName(i)}→${sqName(t[0])}→${sqName(t[1])}`;
        break;
      case 'b': {
        const v = t[0];
        const victim = s.board[v]!;
        const df = sign(fileOf(v) - fileOf(i));
        const dr = sign(rankOf(v) - rankOf(i));
        if (s.mode === 'sumo') {
          let step = 0;
          let at = v;
          for (let n = 0; n < s.cfg.headbuttSquares; n++) {
            const line = n === 0 ? pushLine(s, at, df, dr)! : pushLine(s, at, df, dr);
            if (!line) break;
            step = applyLine(s, line, step, changes);
            if (line.fall === at) break;
            at += df + 8 * dr;
          }
        } else {
          const dest = v + df + 8 * dr;
          const dropped = drop(s, v, 0, changes);
          relocate(s, v, dest);
          changes.push({ step: dropped ? 1 : 0, type: 'move', pieceId: victim.id, from: sqName(v), to: sqName(dest), how: 'pushed' });
          arrive(s, dest, dropped ? 2 : 1, changes);
        }
        label = `${pname} on ${name(victim)} (${sqName(v)})`;
        break;
      }
      case 'r':
        if (s.mode === 'sumo') {
          // The shove lines point away from the rook in different directions, so they never touch: one step for all.
          const lines = stompShoves(s, i).map((j) => shoveLine(s, i, j)!);
          const falls = lines.filter((l) => l.fall !== null).map((l) => knockOut(s, l.fall!, l.dir, 0));
          const anyMove = lines.some((l) => l.moves.length);
          for (const l of lines) {
            for (const [a2, b2] of l.moves) {
              const q = s.board[a2]!;
              relocate(s, a2, b2);
              changes.push({ step: 0, type: 'move', pieceId: q.id, from: sqName(a2), to: sqName(b2), how: 'pushed' });
            }
          }
          for (const f of falls) changes.push({ ...f, step: anyMove ? 1 : 0 });
          label = `${pname} on ${sqName(i)} (${lines.length} shoved)`;
        } else {
          let n = 0;
          for (const v of stunVictims(s, i)) {
            const id = s.board[v]!.id;
            const cur = statusOf(s, id);
            if (cur && cur.turnsLeft >= s.cfg.stunTurns) continue;
            s.statuses = s.statuses.filter((x) => x.id !== id);
            s.statuses.push({ id, status: 'stunned', turnsLeft: s.cfg.stunTurns });
            changes.push({ step: 0, type: 'status', pieceId: id, status: 'stunned' });
            n++;
          }
          label = `${pname} on ${sqName(i)} (${n} stunned)`;
        }
        break;
      case 'q':
        s.blocks.push({ sq: t[0], by: p.side, turnsLeft: s.cfg.blockPlies });
        changes.push({ step: 0, type: 'block', square: sqName(t[0]), by: p.side });
        label = `${pname} on ${sqName(t[0])}`;
        break;
      case 'k':
        relocate(s, i, t[0]);
        changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(t[0]), how: 'teleport' });
        arrive(s, t[0], 1, changes);
        label = `${pname} ${sqName(i)}→${sqName(t[0])}`;
        break;
    }
  }
  return { changes, label: labels ? label + extras(changes, ids) : label, ...(power ? { power } : {}) };
}

const sqIndexOf = (sq: Square | string) => sq.charCodeAt(0) - 97 + 8 * (sq.charCodeAt(1) - 49);

/** Sumo: who has lost a king. */
export function kingsOut(s: AState): Side[] {
  return s.out.filter((p) => p.kind === 'k').map((p) => p.side);
}

/** Has the game ended after something that happened on `mover`'s turn (null mover = sinking or the wheel)? */
export function detectOver(s: AState, mover: Side | null): GameOver | null {
  if (s.mode === 'sumo') {
    const out = kingsOut(s);
    if (out.length >= 2) return { winner: null, reason: 'kingOverboard' };
    if (out.length === 1) return { winner: opposite(out[0]), reason: 'kingOverboard' };
    return null;
  }
  const target = s.cfg.pointsToWin;
  for (const side of (mover ? [mover, opposite(mover)] : ['land', 'sea']) as Side[]) {
    if (s.score[side] >= target) return { winner: side, reason: 'treasure' };
  }
  return null;
}

/** After the last round: more animals left (Sumo) or more points (Raid) wins, else a draw. */
export function roundCapResult(s: AState): GameOver {
  const count = (side: Side) => (s.mode === 'sumo' ? s.board.filter((p) => p?.side === side).length : s.score[side]);
  const l = count('land');
  const r = count('sea');
  return { winner: l > r ? 'land' : r > l ? 'sea' : null, reason: 'rounds' };
}

export const maxRoundsOf = (s: AState) => (s.mode === 'sumo' ? s.cfg.sumoMaxRounds : s.cfg.raidMaxRounds);

// ---------- turns, sinking, wheel ----------

const sinkSchedule = (s: AState) => s.cfg.sinkRounds.slice(0, 3);

/** Sumo: rounds until the next ring sinks, counting this one (1 = at the end of this round); null when no more will. */
export function nextSinkIn(s: AState): number | null {
  if (s.mode !== 'sumo') return null;
  const at = sinkSchedule(s)[s.sunkRings];
  return at === undefined ? null : Math.max(1, at - s.round + 1);
}

/** Sumo: the ring that sinks at the end of this round (the warning), else []. */
export function sinkingNext(s: AState): number[] {
  if (nextSinkIn(s) !== 1) return [];
  const out: number[] = [];
  for (let i = 0; i < 64; i++) if (ringOf(i) === s.sunkRings) out.push(i);
  return out;
}

export interface SinkResult { squares: Square[]; changes: BoardChange[]; label: string }

/** Sink the warned ring: everything on it falls in (all in one step), blocks on it vanish. */
function sinkRing(s: AState): SinkResult {
  const squares = sinkingNext(s);
  const changes: BoardChange[] = [];
  const fell: string[] = [];
  for (const i of squares) {
    const p = s.board[i];
    if (!p) continue;
    fell.push(`${cap(p.side)}'s ${name(p)}`);
    changes.push(knockOut(s, i, outward(i), 0));
  }
  s.blocks = s.blocks.filter((b) => !squares.includes(b.sq));
  s.sunkRings++;
  const label = `The ${['outer', 'second', 'third'][s.sunkRings - 1] ?? 'next'} ring sank${fell.length ? `: ${fell.join(', ')} fell in` : ''}`;
  return { squares: squares.map(sqName), changes, label };
}

/** The way off the board from a square: toward its nearest edge (a corner falls diagonally). */
export function outward(i: number): [number, number] {
  const f = fileOf(i);
  const r = rankOf(i);
  const fd = Math.min(f, 7 - f);
  const rd = Math.min(r, 7 - r);
  const df = f < 4 ? -1 : 1;
  const dr = r < 4 ? -1 : 1;
  return fd < rd ? [df, 0] : rd < fd ? [0, dr] : [df, dr];
}

/**
 * End the mover's turn: its stuns tick down, a ring sinks at the end of a round when due (Sumo), the turn passes,
 * blocks tick down and the new side's anchors lift. Returns the sinking, if any.
 */
export function endTurn(s: AState): SinkResult | null {
  const mover = s.turn;
  for (const st of s.statuses) {
    if (st.status === 'anchored') continue;
    const i = findA(s, st.id);
    if (i >= 0 && s.board[i]!.side === mover) st.turnsLeft--;
  }
  s.statuses = s.statuses.filter((x) => x.turnsLeft > 0);
  const sink = s.mode === 'sumo' && mover === 'sea' && nextSinkIn(s) === 1 ? sinkRing(s) : null;
  s.turn = opposite(mover);
  if (s.turn === 'land') s.round++;
  for (const b of s.blocks) b.turnsLeft--;
  s.blocks = s.blocks.filter((b) => b.turnsLeft > 0);
  s.statuses = s.statuses.filter((x) => !(x.status === 'anchored' && s.board[findA(s, x.id)]?.side === s.turn));
  s.die = null;
  s.ap = 0;
  return sink;
}

/** Roll the die for the side to move and set its AP. */
export function roll(s: AState): DieValue {
  const value = (Math.floor(rand(s) * 6) + 1) as DieValue;
  s.die = value;
  s.ap = s.cfg.apTable[value - 1];
  return value;
}

export const wheelDue = (s: AState) => s.mode === 'raid' && s.turn === 'land' && s.round > 1 && (s.round - 1) % s.cfg.wheelEvery === 0;
export const nextWheelIn = (s: AState) => (s.mode === 'raid' ? s.cfg.wheelEvery - ((s.round - 1) % s.cfg.wheelEvery) : null);

export interface WheelResult { outcome: WheelOutcome; direction?: 'left' | 'right'; changes: BoardChange[]; label: string }

/** Raid: the Wheel of Chaos. Moved animals then meet any treasure they land on (pickups, returns, scores). */
export function spinWheel(s: AState, forced?: WheelOutcome): WheelResult {
  const outcome = forced ?? pickWeighted(s, s.cfg.wheelOdds);
  const changes: BoardChange[] = [];
  const res: WheelResult = { outcome, changes, label: `Wheel: ${WHEEL_NAME[outcome]}` };
  const moved: number[] = [];
  const moveAll = (order: number[], dest: (i: number) => number | null, how: 'swept' | 'quake') => {
    for (const i of order) {
      const p = s.board[i];
      if (!p) continue;
      const to = dest(i);
      if (to === null || !canEnter(s, p.side, to)) continue;
      relocate(s, i, to);
      moved.push(to);
      changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(to), how });
    }
  };
  switch (outcome) {
    case 'tide': {
      // Closest to the meadow first, so an animal can follow the one in front of it.
      const order: number[] = [];
      for (let r = 4; r <= 7; r++) for (let f = 0; f < 8; f++) order.push(idx(f, r));
      moveAll(order, (i) => (s.board[i]!.side === 'land' ? i - 8 : null), 'swept');
      break;
    }
    case 'pigeon': {
      const grab = s.treasures.filter((t) => t.carrier || (t.sq !== null && t.sq !== t.home));
      const spots: number[] = [];
      for (let j = 0; j < 64; j++) if (!s.board[j] && !blockAt(s, j) && !isHome(s, j) && !treasureAt(s, j)) spots.push(j);
      if (grab.length && spots.length) {
        const t = grab[Math.floor(rand(s) * grab.length)];
        const to = spots[Math.floor(rand(s) * spots.length)];
        t.carrier = null;
        t.sq = to;
        changes.push(treasureChange(t, 'snatch', 0));
        res.label += ` grabbed ${cap(t.owner)}'s ${TREASURE_NAME[t.owner]} and dropped it on ${sqName(to)}`;
      } else {
        res.label += ' (flew past)';
      }
      break;
    }
    case 'earthquake': {
      const dir = rand(s) < 0.5 ? -1 : 1;
      res.direction = dir < 0 ? 'left' : 'right';
      const order: number[] = [];
      for (let k = 0; k < 8; k++) {
        const f = dir > 0 ? 7 - k : k;
        for (let r = 0; r < 8; r++) order.push(idx(f, r));
      }
      moveAll(order, (i) => (onBoard(fileOf(i) + dir, 0) ? i + dir : null), 'quake');
      res.label += ` (${res.direction})`;
      break;
    }
    case 'disco': {
      const ids = s.powersUsed.filter((id) => findA(s, id) >= 0);
      s.powersUsed = [];
      if (ids.length) changes.push({ step: 0, type: 'recharge', pieceIds: ids });
      break;
    }
  }
  let step = 1;
  for (const i of moved) step = arrive(s, i, step, changes);
  const ids = new Map<PieceId, APiece>();
  for (const q of s.board) if (q) ids.set(q.id, q);
  res.label += extras(changes.filter((c) => c.type === 'treasure' && c.event !== 'snatch'), ids);
  return res;
}
