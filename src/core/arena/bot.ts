/**
 * The Sumo/Raid bot: a greedy beam search over this turn's action sequences (up to 4 actions), scored by a plain
 * evaluation. It re-plans before every action, so a duel or a surprise never leaves it with a stale plan.
 * Pure functions: it runs in a Web Worker in the browser (see botClient.ts).
 */
import type { ArenaAction, DuelInfo, Side } from '../../contracts/types';
import { opposite } from '../modes/state';
import {
  applyAction, carriedBy, cloneArena, findA, halfOf, legalActions, ringOf, shoveLine, sinkingNext, statusOf, treasureOf, type AState,
} from './rules';
import type { ArenaBotLevel } from './tuning';

export interface ArenaBotRequest {
  state: AState;
  level: ArenaBotLevel;
  seed: number;
}

const WIN = 100000;

/** The bot's next action for the side to move (endTurn when doing nothing more scores best). */
export function decideArena(req: ArenaBotRequest): ArenaAction {
  const plan = planTurn(req.state, req.level, req.seed);
  return plan[0] ?? { type: 'endTurn' };
}

interface Node { s: AState; actions: ArenaAction[]; score: number }

/** The best sequence of actions for the side to move (may be empty = end the turn now). */
export function planTurn(s0: AState, level: ArenaBotLevel, seed: number): ArenaAction[] {
  const side = s0.turn;
  let rng = seed >>> 0 || 1;
  const noise = () => {
    if (!level.noise) return 0;
    rng = (rng * 1103515245 + 12345) >>> 0;
    return ((rng / 4294967296) - 0.5) * 2 * level.noise;
  };
  const root: Node = { s: s0, actions: [], score: evaluate(s0, side, level.lookahead) + noise() };
  let best = root;
  let beam = [root];
  for (let depth = 0; depth < level.maxActions && beam.length; depth++) {
    const next: Node[] = [];
    for (const node of beam) {
      if (node.s.ap <= 0 || node.s.over) continue;
      for (const a of legalActions(node.s, true)) {
        if (a.type === 'endTurn') continue;
        const c = cloneArena(node.s);
        applyAction(c, a, false);
        if (c.mode === 'sumo') sumoOver(c);
        else if (c.score[side] >= c.cfg.pointsToWin) c.over = { winner: side, reason: 'treasure' };
        const child: Node = { s: c, actions: [...node.actions, a], score: evaluate(c, side, level.lookahead) + noise() };
        next.push(child);
        if (child.score > best.score) best = child;
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, level.beam);
  }
  return best.actions;
}

function sumoOver(s: AState): void {
  const out = s.out.filter((p) => p.kind === 'k').map((p) => p.side);
  if (out.length >= 2) s.over = { winner: null, reason: 'kingOverboard' };
  else if (out.length === 1) s.over = { winner: opposite(out[0]), reason: 'kingOverboard' };
}

/** How good this position is for `side` (bigger = better). */
export function evaluate(s: AState, side: Side, lookahead: boolean): number {
  if (s.over) return s.over.winner === side ? WIN : s.over.winner === null ? 0 : -WIN;
  return s.mode === 'sumo' ? evalSumo(s, side, lookahead) : evalRaid(s, side, lookahead);
}

// ---------- Sumo ----------

/**
 * Steps an animal on square i is from falling in: 1 = on the edge or next to water. Squares that sink at the end
 * of this round count as 0 when the side standing there can't move again before it sinks.
 */
function waterDistance(s: AState, i: number, doomed: Set<number>): number {
  if (doomed.has(i)) return 0;
  let d = ringOf(i) - s.sunkRings + 1;
  // A sunk ring is the edge now; the outer ring of dry land is 1 step from water.
  if (d < 1) d = 1;
  return d;
}

function evalSumo(s: AState, side: Side, lookahead: boolean): number {
  const enemy = opposite(side);
  // The warned ring sinks after Sea's turn. Land animals still on it when Land's turn ends are doomed;
  // Sea ones only once it's Sea's turn (during Land's turn they can still walk off).
  const warn = sinkingNext(s);
  const doomedFor = (who: Side) => new Set(warn.length && (who === 'land' || s.turn === 'sea') ? warn : []);
  const doomed: Record<Side, Set<number>> = { land: doomedFor('land'), sea: doomedFor('sea') };
  let score = 0;
  let mine = 0;
  let theirs = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p) continue;
    const wd = waterDistance(s, i, doomed[p.side]);
    const danger = Math.max(0, 4 - wd); // 0 (safe middle) .. 4 (doomed)
    const king = p.kind === 'k';
    if (p.side === side) {
      mine += wd === 0 ? 0 : 1;
      score -= danger * (king ? 70 : 9);
      if (king && wd === 0) score -= 4000;
    } else {
      theirs += wd === 0 ? 0 : 1;
      score += danger * (king ? 60 : 8);
      if (king && wd === 0) score += 4000;
    }
  }
  score += (mine - theirs) * 120;
  // The other side moves next: what it can shove in counts a lot; our own chances count a little (they can dodge).
  if (lookahead) score += threats(s, side) * 0.3 - threats(s, enemy) * 0.8;
  return score;
}

/** What `by` could shove into the water next turn: a cheap one-shove look at every enemy next to its animals. */
function threats(s: AState, by: Side): number {
  let t = 0;
  for (let a = 0; a < 64; a++) {
    const p = s.board[a];
    if (!p || p.side !== by) continue;
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const f = (a & 7) + df;
        const r = (a >> 3) + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const v = f + 8 * r;
        const q = s.board[v];
        if (!q || q.side === by) continue;
        const line = shoveLine(s, a, v);
        if (!line || line.fall === null) continue;
        const faller = s.board[line.fall]!;
        const sign = faller.side === by ? -0.5 : 1;
        t += sign * (faller.kind === 'k' ? 900 : 70);
      }
    }
  }
  return t;
}

// ---------- Raid ----------

const cheb = (a: number, b: number) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));
/** Ranks a square is from a side's own half (0 = inside it). */
const toOwnHalf = (i: number, side: Side) => (side === 'land' ? Math.max(0, (i >> 3) - 3) : Math.max(0, 4 - (i >> 3)));

function evalRaid(s: AState, side: Side, lookahead: boolean): number {
  return raidSide(s, side, lookahead) - raidSide(s, opposite(side), lookahead) * 0.9;
}

/** The good things `side` has going for it. */
function raidSide(s: AState, side: Side, lookahead: boolean): number {
  const enemy = opposite(side);
  let score = s.score[side] * 3000;
  const theirs = treasureOf(s, enemy);
  const ours = treasureOf(s, side);
  const carrierSq = theirs.carrier ? findA(s, theirs.carrier) : -1;
  if (carrierSq >= 0) {
    score += 1500 - toOwnHalf(carrierSq, side) * 200;
  } else if (theirs.sq !== null) {
    // Our closest animal to the enemy treasure, and a bit for the second closest.
    const ds: number[] = [];
    // A stunned animal loses a turn: count it a step and a half farther.
    for (let i = 0; i < 64; i++) {
      const p = s.board[i];
      if (p?.side === side && !carriedBy(s, p.id)) ds.push(cheb(i, theirs.sq) + (statusOf(s, p.id) ? 1.5 : 0));
    }
    ds.sort((a, b) => a - b);
    if (ds.length) score -= ds[0] * 40 + (ds[1] ?? 8) * 10;
  }
  // Our own dropped treasure: get it home.
  if (ours.sq !== null && ours.sq !== ours.home) {
    let d = 9;
    for (let i = 0; i < 64; i++) if (s.board[i]?.side === side) d = Math.min(d, cheb(i, ours.sq));
    score -= d * 25;
  }
  // Defence: animals near the enemy carrier while it is in our half.
  if (ours.carrier) {
    const c = findA(s, ours.carrier);
    if (c >= 0) {
      let d = 9;
      for (let i = 0; i < 64; i++) if (s.board[i]?.side === side) d = Math.min(d, cheb(i, c));
      score -= d * 30;
      if (lookahead && halfOf(c) === side && d === 1) score += 250;
    }
  }
  // Animals standing where the enemy can tag them are a small risk.
  if (lookahead) {
    for (let i = 0; i < 64; i++) {
      const p = s.board[i];
      if (!p || p.side !== side || halfOf(i) !== enemy) continue;
      let near = false;
      for (let j = 0; j < 64 && !near; j++) if (s.board[j]?.side === enemy && halfOf(j) === enemy && cheb(i, j) === 1) near = true;
      if (near) score -= carriedBy(s, p.id) ? 500 : 15;
    }
  }
  return score;
}

/** Duel answer for a bot defender: always for the king (Sumo) or a carrier (Raid); else more often with spare tokens. */
export function wantsDuel(s: AState, info: DuelInfo, random: () => number): boolean {
  const victim = s.board[findA(s, info.victimId)];
  if (!victim) return false;
  if (s.mode === 'sumo') {
    if (victim.kind === 'k') return true;
    return random() < 0.25 + 0.2 * info.tokensLeft;
  }
  // A tagged carrier loses the treasure: usually worth a token.
  return carriedBy(s, victim.id) ? random() < 0.85 : false;
}
