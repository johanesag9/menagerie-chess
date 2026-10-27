/**
 * The Normal/Crazy bot's brain: alpha-beta over moves, powers and cards, with iterative deepening and a time cap.
 * Pure: it runs in the bot worker (browser) or straight in the tests.
 * Chance is ignored: the search never rolls dice, draws cards or spins the wheel, and a Joker counts as Party.
 */
import type { ActionInput, PieceKind, Side } from '../../contracts/types';
import { cloneState, fileOf, opposite, rankOf, sqIndex, type MState } from './state';
import { applyAction, endTurn, inCheck, isAttacked, legalActions, pseudoMoves, statusOf } from './rules';

export interface SearchRequest {
  kind: 'action' | 'bonus';
  state: MState;
  depth: number;
  timeMs: number;
  seed: number;
}

const MATE = 100000;
const VAL: Record<PieceKind, number> = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 0 };
/** What an unused power is worth, by piece kind. */
const POWER_VAL: Record<PieceKind, number> = { p: 12, n: 30, b: 22, r: 22, q: 40, k: 30 };
const CARD_VAL = 35;
const TOKEN_VAL = 20;

class Abort extends Error {}

interface Ctx { deadline: number; nodes: number; noise: () => number }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bot's pick for its action (or lucky bonus). Null only when there's nothing to do. */
export function decide(req: SearchRequest): ActionInput | null {
  const ctx: Ctx = { deadline: now() + req.timeMs, nodes: 0, noise: rng(req.seed) };
  return req.kind === 'bonus' ? decideBonus(req.state, ctx) : decideAction(req.state, Math.max(1, req.depth), ctx);
}

function decideAction(s: MState, depth: number, ctx: Ctx): ActionInput | null {
  const actions = order(s, legalActions(s, true));
  if (!actions.length) return null;
  let best: ActionInput = actions[0];
  for (let d = 1; d <= depth; d++) {
    try {
      const r = root(s, actions, d, ctx);
      best = r;
      // Search the best one first next time.
      actions.splice(actions.indexOf(r), 1);
      actions.unshift(r);
    } catch (e) {
      if (e instanceof Abort) break;
      throw e;
    }
  }
  return best;
}

function root(s: MState, actions: ActionInput[], depth: number, ctx: Ctx): ActionInput {
  let alpha = -Infinity;
  let best = actions[0];
  for (const a of actions) {
    const c = cloneState(s);
    applyAction(c, a, false);
    endTurn(c);
    // A little noise so equal choices vary between games.
    const v = -negamax(c, depth - 1, -Infinity, -alpha, 1, ctx) + ctx.noise() * 6;
    if (v > alpha) {
      alpha = v;
      best = a;
    }
  }
  return best;
}

function negamax(s: MState, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  if (++ctx.nodes % 256 === 0 && now() > ctx.deadline) throw new Abort();
  if (s.kingTaken) return s.kingTaken === s.turn ? -MATE + ply : MATE - ply;
  if (depth <= 0) return evaluate(s);
  const actions = order(s, legalActions(s, true));
  if (!actions.length) {
    if (s.mode === 'normal') return inCheck(s, s.turn) ? -MATE + ply : 0;
    const c = cloneState(s);
    endTurn(c); // a Crazy turn with nothing to do passes
    return -negamax(c, depth - 1, -beta, -alpha, ply + 1, ctx);
  }
  let best = -Infinity;
  for (const a of actions) {
    const c = cloneState(s);
    applyAction(c, a, false);
    endTurn(c);
    const v = -negamax(c, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** Captures first (biggest victim, smallest attacker), then promotions, powers, cards, quiet moves. */
function order(s: MState, actions: ActionInput[]): ActionInput[] {
  const score = (a: ActionInput): number => {
    if (a.type === 'move') {
      const victim = s.board[sqIndex(a.to)];
      const mover = s.board[sqIndex(a.from)];
      let v = a.promotion === 'q' ? 800 : 0;
      if (victim) v += 1000 + VAL[victim.kind] * 10 - VAL[mover!.kind] + (victim.kind === 'k' ? 50000 : 0);
      return v;
    }
    if (a.type === 'power') {
      const last = a.targets[a.targets.length - 1];
      const victim = last ? s.board[sqIndex(last)] : null;
      return victim && victim.side !== s.turn ? 900 + VAL[victim.kind] * 10 + (victim.kind === 'k' ? 50000 : 0) : 50;
    }
    return a.type === 'card' ? 40 : 0;
  };
  return actions.map((a) => [score(a), a] as const).sort((x, y) => y[0] - x[0]).map((x) => x[1]);
}

function decideBonus(s: MState, ctx: Ctx): ActionInput | null {
  const options = legalActions(s, true);
  let best: ActionInput | null = null;
  let bestV = -Infinity;
  for (const o of options) {
    const c = cloneState(s);
    if (o.type !== 'bonus' || o.choice !== 'skip') applyAction(c, o, false);
    c.phase = 'action';
    let v: number;
    try {
      const acts = order(c, legalActions(c, true));
      v = acts.length ? -Infinity : evaluate(c);
      for (const a of acts) {
        const d = cloneState(c);
        applyAction(d, a, false);
        endTurn(d);
        v = Math.max(v, -negamax(d, 0, -Infinity, Infinity, 1, ctx));
      }
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      v = evaluate(c);
    }
    v += ctx.noise() * 4;
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}

/** Score from the side to move's point of view, in centipawns. */
export function evaluate(s: MState): number {
  const me = s.turn;
  const them = opposite(me);
  let score = 0;
  let threat = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p) continue;
    const sign = p.side === me ? 1 : -1;
    let v = VAL[p.kind] + placement(p.kind, p.side, i);
    if (!s[p.side].powersUsed.includes(p.id)) v += POWER_VAL[p.kind];
    const st = statusOf(s, p.id);
    if (st) v -= 12 * st.turnsLeft;
    score += sign * v;
    // What the side to move could grab next: an enemy piece it attacks that nobody guards.
    if (p.side === them && isAttacked(s, i, me)) {
      if (p.kind === 'k') {
        if (s.mode === 'crazy') return MATE / 2;
      } else if (!isAttacked(s, i, them)) {
        threat = Math.max(threat, VAL[p.kind]);
      }
    }
  }
  score += threat * 0.7;
  if (s.mode === 'crazy') {
    score += (s[me].hand.length - s[them].hand.length) * CARD_VAL;
    score += (s[me].tokens - s[them].tokens) * TOKEN_VAL;
  }
  score += (pseudoMoves(s, me).length - pseudoMoves(s, them).length) * 3;
  if (s.mode === 'normal' && inCheck(s, me)) score -= 40;
  return score;
}

function placement(kind: PieceKind, side: Side, i: number): number {
  const f = fileOf(i);
  const r = rankOf(i);
  const centre = 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5));
  switch (kind) {
    case 'p': return (side === 'land' ? r - 1 : 6 - r) * 8 + (f >= 2 && f <= 5 ? 4 : 0);
    case 'n':
    case 'b': return centre * 8;
    case 'q': return centre * 3;
    case 'k': return -centre * 4;
    default: return 0;
  }
}

/** How much the defender cares about the piece under attack (used for duel answers). */
export function pieceWorth(kind: PieceKind): number {
  return kind === 'k' ? Infinity : VAL[kind] / 100;
}
