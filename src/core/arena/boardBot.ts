/**
 * The Castle and Stones bot: a game-tree search over whole turns (castle: move + build/dig; stones: raise/sink + step,
 * or a power). Minimax with alpha-beta; below the root, inner levels keep only the `width` turns with the best quick
 * score, and the last level looks at every reply. It plans its whole turn and plays the first action, re-planning
 * before each action. Pure and deterministic for a seed (it runs in the arena bot's Web Worker in the browser).
 */
import type { ArenaAction, PieceKind, Side } from '../../contracts/types';
import { opposite } from '../modes/state';
import { advanceTurn, boardApply, boardLegal } from './board';
import { canAnswerCrown, castleMoves, castlePushes, crownedOf } from './castle';
import { ADJ } from './geom';
import { cloneArena, type AState } from './rules';
import type { BoardBotLevel } from './tuning';

const WIN = 1_000_000;

export function decideBoard(s0: AState, level: BoardBotLevel, seed: number): ArenaAction {
  const rng = mulberry(seed);
  if (s0.stage === 'pick') return { type: 'pick', kind: draftPick(s0, rng) };
  const plan = planBoardTurn(s0, level, rng);
  return plan[0] ?? boardLegal(s0)[0] ?? { type: 'endTurn' };
}

interface Turn { actions: ArenaAction[]; s: AState }

/** Every complete turn from the current stage, each with the state after it (the turn ended and the next one started). */
export function turnsOf(s: AState): Turn[] {
  const out: Turn[] = [];
  const walk = (cur: AState, prefix: ArenaAction[]) => {
    for (const a of boardLegal(cur, true)) {
      const c = cloneArena(cur);
      const r = boardApply(c, a, false);
      const actions = [...prefix, a];
      if (r.done) {
        if (!c.over) advanceTurn(c);
        out.push({ actions, s: c });
      } else {
        walk(c, actions);
      }
    }
  };
  walk(s, []);
  return out;
}

/** The best whole turn for the side to move (empty when it has nothing legal). */
export function planBoardTurn(s0: AState, level: BoardBotLevel, rng: () => number = mulberry(1)): ArenaAction[] {
  const root = s0.turn;
  const kids = turnsOf(s0);
  if (!kids.length) return [];
  const quick = kids.map((k) => score(k.s, root, 1));
  let values: number[];
  if (level.depth <= 1) {
    values = quick;
  } else {
    const order = kids.map((_, k) => k).sort((a, b) => quick[b] - quick[a]);
    const keep = new Set(order.slice(0, Math.max(level.width, 1)));
    values = quick.map(() => -Infinity);
    let alpha = -Infinity;
    for (const k of order) {
      if (!keep.has(k)) continue;
      values[k] = search(kids[k].s, level.depth - 1, alpha, Infinity, root, 1, level.width);
      alpha = Math.max(alpha, values[k]);
    }
  }
  // Noise and tolerance keep low levels playful; never on a won or lost line.
  const noisy = values.map((v) => (Math.abs(v) < WIN / 8 && level.noise ? v + (rng() - 0.5) * 2 * level.noise : v));
  const best = Math.max(...noisy);
  const pool = noisy.map((v, k) => (v >= best - (Math.abs(best) < WIN / 8 ? level.tolerance : 0) ? k : -1)).filter((k) => k >= 0);
  return kids[pool[Math.floor(rng() * pool.length)]].actions;
}

/** Minimax value of `s` for `root`, `depth` whole turns deep. */
function search(s: AState, depth: number, alpha: number, beta: number, root: Side, ply: number, width: number): number {
  if (s.over || depth <= 0) return score(s, root, ply);
  const kids = turnsOf(s);
  if (!kids.length) return score(s, root, ply);
  const max = s.turn === root;
  let best = max ? -Infinity : Infinity;
  let list = kids;
  if (depth > 1) {
    const quick = kids.map((k) => score(k.s, root, ply + 1));
    list = kids.map((_, k) => k).sort((a, b) => (max ? quick[b] - quick[a] : quick[a] - quick[b])).slice(0, width).map((k) => kids[k]);
  }
  for (const k of list) {
    const v = depth > 1 ? search(k.s, depth - 1, alpha, beta, root, ply + 1, width) : score(k.s, root, ply + 1);
    if (max) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (alpha >= beta) break;
  }
  return best;
}

/** How good `s` is for `root` (bigger = better). Faster wins score a little more. */
export function score(s: AState, root: Side, ply = 0): number {
  if (s.over) return s.over.winner === null ? 0 : s.over.winner === root ? WIN - ply : -WIN + ply;
  return s.mode === 'castle' ? evalCastle(s, root) : evalStones(s, root);
}

// ---------- Castle ----------

function evalCastle(s: AState, root: Side): number {
  const turn = s.turn;
  const c = crownedOf(s);
  let crown = 0;
  if (c && c.side !== turn) {
    // It wins at the start of its next turn, unless the side to move digs it out or pushes it off now.
    if (!canAnswerCrown(s, turn, c.sq)) return c.side === root ? WIN / 4 : -WIN / 4;
    crown = c.side === root ? 150 : -150;
  }
  return crown + castleSide(s, root, turn) - castleSide(s, opposite(root), turn);
}

/** Height, the heights it can reach next, castles it can step onto (worth most on its own turn), and mobility. */
function castleSide(s: AState, side: Side, turn: Side): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.side !== side) continue;
    const h = s.levels[i];
    score += h * 40;
    const moves = castleMoves(s, i);
    let reach = 0;
    let castle = false;
    for (const m of moves) {
      const l = s.levels[m.to];
      if (l > reach) reach = l;
      if (l === 3) castle = true;
    }
    score += Math.min(reach, 2) * 25 + moves.length * 3;
    if (castle) score += side === turn ? 400 : 120;
    if (!moves.length && !castlePushes(s, i).length) score -= 60;
  }
  return score;
}

// ---------- Stones ----------

function evalStones(s: AState, root: Side): number {
  const enemy = opposite(root);
  const own = raceDist(s, root);
  const theirs = raceDist(s, enemy);
  // One step from an open back-rank square on its own turn: it walks in.
  if (s.turn === root && own <= 1) return WIN / 4;
  if (s.turn === enemy && theirs <= 1) return -WIN / 4;
  let score = (theirs - own) * 100 + (s.turn === root ? 50 : -50);
  // Powers still to use: one per animal, minus the used ones.
  for (const id of s.powersUsed) score += id.startsWith(root) ? -15 : 15;
  return score;
}

/**
 * Roughly how many turns the side's best runner needs to reach the enemy back rank. A turn is one step, and a sunk
 * square can be raised and stepped onto in the same turn, so it costs only a little more than a dry one; squares
 * changed last turn, blocks and enemy animals cost more. Own animals can make way.
 */
function raceDist(s: AState, side: Side): number {
  const goal = side === 'land' ? 7 : 0;
  // Costs in half steps; Dial's algorithm over small integer distances (buckets as linked lists in flat arrays).
  const cost = COST;
  for (let j = 0; j < 64; j++) {
    const q = s.board[j];
    cost[j] = q ? (q.side === side ? 3 : 6) : s.water[j] ? 3 : 2;
  }
  if (s.cfg.freshRule) for (const j of s.fresh) if (s.water[j] && !s.board[j]) cost[j] = 5;
  for (const b of s.blocks) cost[b.sq] = 6;
  DIST.fill(1e9);
  HEAD.fill(-1);
  let n = 0;
  const push = (d: number, i: number) => {
    NODE[n] = i;
    NEXT[n] = HEAD[d];
    HEAD[d] = n++;
  };
  for (let i = 0; i < 64; i++) {
    if (s.board[i]?.side === side) {
      DIST[i] = 0;
      push(0, i);
    }
  }
  for (let d = 0; d < HEAD.length; d++) {
    for (let e = HEAD[d]; e >= 0; e = NEXT[e]) {
      const i = NODE[e];
      if (DIST[i] !== d) continue;
      if (i >> 3 === goal) return d / 2;
      for (const j of ADJ[i]) {
        const nd = d + cost[j];
        if (nd < DIST[j] && nd < HEAD.length) {
          DIST[j] = nd;
          push(nd, j);
        }
      }
    }
  }
  return 20;
}
const COST = new Int32Array(64);
const DIST = new Int32Array(64);
const HEAD = new Int32Array(400);
const NODE = new Int32Array(64 * 9);
const NEXT = new Int32Array(64 * 9);

// ---------- the draft (castle) ----------

/** How much each trait is worth on its own, and with each other one (ordered p n b r q k). */
const BASE: Record<PieceKind, number> = { p: 3, n: 2, b: 5, r: 4, q: 4, k: 3 };
const PAIR: Partial<Record<string, number>> = { br: 4, bq: 3, pr: 3, kr: 3, bp: 2, kq: 2, nr: 2, bk: 2, pq: 2 };
const pairValue = (a: PieceKind, b: PieceKind) => PAIR[a + b] ?? PAIR[b + a] ?? 0;

/** Pick from the 4 best kinds for this side's draft so far, at random weighted by value. */
export function draftPick(s: AState, rng: () => number): PieceKind {
  const mine = s.picks[s.turn];
  const left = (['p', 'n', 'b', 'r', 'q', 'k'] as PieceKind[]).filter((k) => !mine.includes(k));
  const value = (k: PieceKind) => BASE[k] + mine.reduce((n, j) => n + pairValue(j, k), 0);
  const top = left.sort((a, b) => value(b) - value(a)).slice(0, 4);
  const weights = top.map((k) => value(k));
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < top.length; k++) {
    x -= weights[k];
    if (x < 0) return top[k];
  }
  return top[0];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
