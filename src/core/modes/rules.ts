/**
 * Normal and Crazy rules on the plain board model (see GAME_SPEC.md "Game modes").
 * Every function here is pure apart from mutating the state passed in, so the bot can run it in a worker.
 *
 * Words: "empty" = no piece and not blocked. "can act" = no stun or freeze on the piece.
 */
import { POWER_OF } from '../../contracts/types';
import type {
  ActionInput, BoardChange, Card, CardSuit, GameOver, JokerOutcome, MoveFlag, PieceId, PieceKind, PieceState,
  PieceStatusKind, PowerKind, Side, Square, WheelOutcome,
} from '../../contracts/types';
import {
  backRank, fileOf, findPiece, forward, idx, nextRandom, onBoard, opposite, pickWeighted, rankOf, sqIndex, sqName,
  cloneState, type MPiece, type MState,
} from './state';

export type PromoKind = Exclude<PieceKind, 'p' | 'k'>;
export interface Move { from: number; to: number; promo?: PromoKind; castle?: 'k' | 'q'; ep?: boolean; double?: boolean }

export const ANIMAL: Record<Side, Record<PieceKind, string>> = {
  land: { p: 'Pup', n: 'Horse', b: 'Goat', r: 'Elephant', q: 'Cat', k: 'Pug' },
  sea: { p: 'Crab', n: 'Seahorse', b: 'Pufferfish', r: 'Turtle', q: 'Octopus', k: 'Blobfish' },
};
export const POWER_NAME: Record<PowerKind, string> = {
  sidestep: 'Sidestep', doubleJump: 'Double jump', headbutt: 'Headbutt', stomp: 'Stomp', block: 'Block', escape: 'Escape',
};
export const CARD_SYMBOL: Record<CardSuit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '🃏' };
export const CARD_NAME: Record<CardSuit, string> = { hearts: 'Revive', diamonds: 'Swap', clubs: 'Freeze', spades: 'Dig', joker: 'Joker' };
export const JOKER_NAME: Record<JokerOutcome, string> = { party: 'Party', teleport: 'Teleport', butterfingers: 'Butterfingers', double: 'Double' };
export const WHEEL_NAME: Record<WheelOutcome, string> = { tide: 'Tide', pigeon: 'Pigeon', earthquake: 'Earthquake', disco: 'Disco' };
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const PROMOS: PromoKind[] = ['q', 'r', 'b', 'n'];

// ---------- queries ----------

export const blockAt = (s: MState, i: number) => s.blocks.some((b) => b.sq === i);
export const isEmpty = (s: MState, i: number) => !s.board[i] && !blockAt(s, i);
export const statusOf = (s: MState, id: PieceId) => s.statuses.find((x) => x.id === id);
export const canAct = (s: MState, id: PieceId) => !s.statuses.some((x) => x.id === id);
export const powerUsed = (s: MState, p: MPiece) => s[p.side].powersUsed.includes(p.id);
const lastRank = (side: Side) => (side === 'land' ? 7 : 0);

export function kingIndex(s: MState, side: Side): number {
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p && p.kind === 'k' && p.side === side) return i;
  }
  return -1;
}

/** Is square `i` attacked by `by`? Stunned and frozen pieces still attack; blocked squares stop sliders. */
export function isAttacked(s: MState, i: number, by: Side): boolean {
  const f = fileOf(i);
  const r = rankOf(i);
  const b = s.board;
  const pr = r - forward(by);
  for (const df of [-1, 1]) {
    if (!onBoard(f + df, pr)) continue;
    const p = b[idx(f + df, pr)];
    if (p && p.side === by && p.kind === 'p') return true;
  }
  for (const [df, dr] of KNIGHT) {
    if (!onBoard(f + df, r + dr)) continue;
    const p = b[idx(f + df, r + dr)];
    if (p && p.side === by && p.kind === 'n') return true;
  }
  for (const [df, dr] of KING) {
    if (!onBoard(f + df, r + dr)) continue;
    const p = b[idx(f + df, r + dr)];
    if (p && p.side === by && p.kind === 'k') return true;
  }
  const ray = (dirs: number[][], a: PieceKind) => {
    for (const [df, dr] of dirs) {
      let x = f + df;
      let y = r + dr;
      while (onBoard(x, y)) {
        const j = idx(x, y);
        if (blockAt(s, j)) break;
        const p = b[j];
        if (p) {
          if (p.side === by && (p.kind === a || p.kind === 'q')) return true;
          break;
        }
        x += df;
        y += dr;
      }
    }
    return false;
  };
  return ray(ORTHO, 'r') || ray(DIAG, 'b');
}

export function inCheck(s: MState, side: Side): boolean {
  const k = kingIndex(s, side);
  return k >= 0 && isAttacked(s, k, opposite(side));
}

// ---------- normal moves ----------

/** Moves for `side` ignoring king safety. Stunned and frozen pieces don't move. */
export function pseudoMoves(s: MState, side: Side): Move[] {
  const out: Move[] = [];
  const b = s.board;
  const normal = s.mode === 'normal';
  const takeable = (p: MPiece | null) => !!p && p.side !== side && !(normal && p.kind === 'k');
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || p.side !== side || !canAct(s, p.id)) continue;
    const f = fileOf(i);
    const r = rankOf(i);
    if (p.kind === 'p') {
      const fw = forward(side);
      const ny = r + fw;
      if (!onBoard(f, ny)) continue;
      const push = (to: number, extra: Partial<Move> = {}) => {
        if (rankOf(to) === lastRank(side)) for (const promo of PROMOS) out.push({ from: i, to, promo, ...extra });
        else out.push({ from: i, to, ...extra });
      };
      const one = idx(f, ny);
      if (isEmpty(s, one)) {
        push(one);
        const start = side === 'land' ? 1 : 6;
        const two = idx(f, r + 2 * fw);
        if (r === start && isEmpty(s, two)) out.push({ from: i, to: two, double: true });
      }
      for (const df of [-1, 1]) {
        if (!onBoard(f + df, ny)) continue;
        const t = idx(f + df, ny);
        if (takeable(b[t])) push(t);
        else if (s.ep && s.ep.sq === t && isEmpty(s, t) && s.ep.pawnSq === idx(f + df, r) && b[s.ep.pawnSq]?.id === s.ep.pawnId) {
          out.push({ from: i, to: t, ep: true });
        }
      }
    } else if (p.kind === 'n' || p.kind === 'k') {
      for (const [df, dr] of p.kind === 'n' ? KNIGHT : KING) {
        if (!onBoard(f + df, r + dr)) continue;
        const t = idx(f + df, r + dr);
        if (blockAt(s, t)) continue;
        if (!b[t] || takeable(b[t])) out.push({ from: i, to: t });
      }
      if (p.kind === 'k') castles(s, side, i, out);
    } else {
      const dirs = p.kind === 'r' ? ORTHO : p.kind === 'b' ? DIAG : [...ORTHO, ...DIAG];
      for (const [df, dr] of dirs) {
        let x = f + df;
        let y = r + dr;
        while (onBoard(x, y)) {
          const t = idx(x, y);
          if (blockAt(s, t)) break;
          const q = b[t];
          if (q) {
            if (takeable(q)) out.push({ from: i, to: t });
            break;
          }
          out.push({ from: i, to: t });
          x += df;
          y += dr;
        }
      }
    }
  }
  return out;
}

function castles(s: MState, side: Side, k: number, out: Move[]): void {
  const r = backRank(side);
  if (k !== idx(4, r)) return;
  const cs = s[side];
  const enemy = opposite(side);
  const safe = (i: number) => s.mode === 'crazy' || !isAttacked(s, i, enemy);
  for (const wing of ['k', 'q'] as const) {
    const rookId = wing === 'k' ? cs.castleK : cs.castleQ;
    if (!rookId) continue;
    const rookSq = idx(wing === 'k' ? 7 : 0, r);
    if (s.board[rookSq]?.id !== rookId || !canAct(s, rookId)) continue;
    const between = wing === 'k' ? [5, 6] : [1, 2, 3];
    if (!between.every((f) => isEmpty(s, idx(f, r)))) continue;
    const pass = wing === 'k' ? [4, 5, 6] : [4, 3, 2];
    if (!pass.every((f) => safe(idx(f, r)))) continue;
    out.push({ from: k, to: idx(wing === 'k' ? 6 : 2, r), castle: wing });
  }
}

/** After `apply`, would the mover's king be safe in the position the opponent moves in (blocks ticked)? */
function safeAfter(s: MState, apply: (c: MState) => void): boolean {
  const side = s.turn;
  const c = cloneState(s);
  apply(c);
  tickBlocks(c);
  return !inCheck(c, side);
}

export function legalMoves(s: MState): Move[] {
  const ms = pseudoMoves(s, s.turn);
  if (s.mode === 'crazy') return ms;
  return ms.filter((m) => safeAfter(s, (c) => applyMove(c, m)));
}

// ---------- powers ----------

/** Target lists (square indexes) a piece's power accepts, ignoring king safety. */
export function powerOptionsRaw(s: MState, i: number): number[][] {
  const p = s.board[i];
  if (!p) return [];
  const f = fileOf(i);
  const r = rankOf(i);
  const out: number[][] = [];
  const enemy = opposite(p.side);
  const normal = s.mode === 'normal';
  switch (POWER_OF[p.kind]) {
    case 'sidestep':
      for (const df of [-1, 1]) if (onBoard(f + df, r) && isEmpty(s, idx(f + df, r))) out.push([idx(f + df, r)]);
      break;
    case 'doubleJump':
      for (const [a, b] of KNIGHT) {
        if (!onBoard(f + a, r + b)) continue;
        const mid = idx(f + a, r + b);
        if (!isEmpty(s, mid)) continue;
        for (const [c, d] of KNIGHT) {
          const x = f + a + c;
          const y = r + b + d;
          if (!onBoard(x, y)) continue;
          const to = idx(x, y);
          if (to === i || blockAt(s, to)) continue;
          const q = s.board[to];
          if (q && (q.side === p.side || (normal && q.kind === 'k'))) continue;
          out.push([mid, to]);
        }
      }
      break;
    case 'headbutt':
      for (const [df, dr] of KING) {
        if (!onBoard(f + df, r + dr)) continue;
        const v = idx(f + df, r + dr);
        const victim = s.board[v];
        if (!victim || victim.side !== enemy) continue;
        const x = f + 2 * df;
        const y = r + 2 * dr;
        if (!onBoard(x, y) || !isEmpty(s, idx(x, y))) continue;
        if (victim.kind === 'p' && (y === 0 || y === 7)) continue;
        out.push([v]);
      }
      break;
    case 'stomp':
      if (stompVictims(s, i).length) out.push([]);
      break;
    case 'block':
      for (let j = 0; j < 64; j++) if (isEmpty(s, j)) out.push([j]);
      break;
    case 'escape':
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if ((!dx && !dy) || !onBoard(f + dx, r + dy)) continue;
          const t = idx(f + dx, r + dy);
          if (isEmpty(s, t)) out.push([t]);
        }
      }
      break;
  }
  return out;
}

/** Enemy non-king neighbours of a stomping rook. */
export function stompVictims(s: MState, i: number): number[] {
  const p = s.board[i];
  if (!p) return [];
  const out: number[] = [];
  for (const [df, dr] of KING) {
    const x = fileOf(i) + df;
    const y = rankOf(i) + dr;
    if (!onBoard(x, y)) continue;
    const q = s.board[idx(x, y)];
    if (q && q.side !== p.side && q.kind !== 'k') out.push(idx(x, y));
  }
  return out;
}

/** Power target lists that are legal right now (the piece's side to move, power unused, can act, king safe in Normal). */
export function powerOptions(s: MState, i: number): number[][] {
  const p = s.board[i];
  if (!p || p.side !== s.turn || s.phase !== 'action' || powerUsed(s, p) || !canAct(s, p.id)) return [];
  const raw = powerOptionsRaw(s, i);
  if (s.mode === 'crazy') return raw;
  const power = POWER_OF[p.kind];
  // A stomp changes nothing on the board, and a new block can only shield: if the king is safe anyway, they all are.
  if ((power === 'block' || power === 'stomp') && safeAfter(s, () => {})) return raw;
  if (power === 'stomp') return [];
  return raw.filter((t) => safeAfter(s, (c) => applyPower(c, i, t)));
}

// ---------- cards ----------

export interface CardChoice { pieceId?: PieceId; targets: number[] }

export const reviveKind = (p: PieceState): PieceKind => (p.id.includes('-promo') ? 'p' : p.kind);

export function reviveSquares(s: MState, side: Side, p: PieceState): number[] {
  const r = reviveKind(p) === 'p' ? backRank(side) + forward(side) : backRank(side);
  const out: number[] = [];
  for (let f = 0; f < 8; f++) if (isEmpty(s, idx(f, r))) out.push(idx(f, r));
  return out;
}

/** Every legal way to play a card (Crazy, the holder's action phase). `forBot` trims the long lists. */
export function cardOptions(s: MState, card: Card, forBot = false): CardChoice[] {
  const side = s.turn;
  if (s.mode !== 'crazy' || s.phase !== 'action' || !s[side].hand.some((c) => c.id === card.id)) return [];
  const out: CardChoice[] = [];
  const own = ownActive(s, side);
  switch (card.suit) {
    case 'hearts':
      for (const p of s[side].captured) {
        if (p.kind === 'k') continue;
        let sqs = reviveSquares(s, side, p);
        if (forBot) sqs = sqs.sort((a, b) => Math.abs(fileOf(a) - 3.5) - Math.abs(fileOf(b) - 3.5)).slice(0, 2);
        for (const t of sqs) out.push({ pieceId: p.id, targets: [t] });
      }
      break;
    case 'diamonds':
      for (const a of own) {
        for (const b of own) {
          if (a === b || (forBot && a > b)) continue;
          if (!swapOk(s, a, b)) continue;
          out.push({ targets: [a, b] });
        }
      }
      if (forBot) return botSwaps(s, out);
      break;
    case 'clubs': {
      const turns = s.cfg.freezeTurns;
      for (let i = 0; i < 64; i++) {
        const p = s.board[i];
        if (!p || p.side === side || p.kind === 'k') continue;
        const st = statusOf(s, p.id);
        if (!st || st.turnsLeft < turns) out.push({ targets: [i] });
      }
      break;
    }
    case 'spades':
      for (const i of own) {
        if (s.board[i]!.kind !== 'p') continue;
        const y = rankOf(i) - forward(side);
        if (y === backRank(side) || !onBoard(fileOf(i), y)) continue;
        if (isEmpty(s, idx(fileOf(i), y))) out.push({ targets: [i] });
      }
      break;
    case 'joker':
      out.push({ targets: [] });
      break;
  }
  return out;
}

function swapOk(s: MState, a: number, b: number): boolean {
  const pa = s.board[a]!;
  const pb = s.board[b]!;
  const edge = (i: number) => rankOf(i) === 0 || rankOf(i) === 7;
  if (pa.kind === 'p' && edge(b)) return false;
  if (pb.kind === 'p' && edge(a)) return false;
  return true;
}

/** The bot only considers swaps that pull an attacked piece to safety, best first. */
function botSwaps(s: MState, all: CardChoice[]): CardChoice[] {
  const enemy = opposite(s.turn);
  const scored: [number, CardChoice][] = [];
  for (const c of all) {
    const [a, b] = c.targets;
    const va = VALUE[s.board[a]!.kind];
    const vb = VALUE[s.board[b]!.kind];
    if (va === vb) continue;
    const hiSq = va > vb ? a : b;
    const loSq = va > vb ? b : a;
    if (isAttacked(s, hiSq, enemy) && !isAttacked(s, loSq, enemy)) scored.push([Math.abs(va - vb), c]);
  }
  return scored.sort((x, y) => y[0] - x[0]).slice(0, 6).map((x) => x[1]);
}

function ownActive(s: MState, side: Side): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p && p.side === side && canAct(s, p.id)) out.push(i);
  }
  return out;
}

// ---------- lucky bonus ----------

export function rechargeOptions(s: MState): number[] {
  const side = s.turn;
  return ownActive(s, side).filter((i) => s[side].powersUsed.includes(s.board[i]!.id));
}

export function pawnStepOptions(s: MState): number[] {
  const side = s.turn;
  return ownActive(s, side).filter((i) => {
    if (s.board[i]!.kind !== 'p') return false;
    const y = rankOf(i) + forward(side);
    return onBoard(fileOf(i), y) && y !== lastRank(side) && isEmpty(s, idx(fileOf(i), y));
  });
}

// ---------- all actions ----------

export function moveToInput(m: Move): ActionInput {
  return { type: 'move', from: sqName(m.from), to: sqName(m.to), ...(m.promo ? { promotion: m.promo } : {}) };
}

/**
 * Every legal action for the side to move in the action phase (bonus phase: the bonus choices).
 * `forBot` drops duplicates that end in the same position and trims long lists (blocks, swaps, revives).
 */
export function legalActions(s: MState, forBot = false): ActionInput[] {
  if (s.phase === 'bonus') {
    return [
      ...rechargeOptions(s).map((i): ActionInput => ({ type: 'bonus', choice: 'recharge', targets: [sqName(i)] })),
      ...pawnStepOptions(s).map((i): ActionInput => ({ type: 'bonus', choice: 'pawnStep', targets: [sqName(i)] })),
      { type: 'bonus', choice: 'skip' },
    ];
  }
  if (s.phase !== 'action') return [];
  const out: ActionInput[] = [];
  for (const m of legalMoves(s)) {
    if (forBot && m.promo && m.promo !== 'q' && m.promo !== 'n') continue;
    out.push(moveToInput(m));
  }
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.side !== s.turn) continue;
    let opts = powerOptions(s, i);
    if (forBot) opts = trimPowerOptions(s, i, opts);
    for (const t of opts) out.push({ type: 'power', pieceId: p.id, targets: t.map(sqName) });
  }
  if (s.mode === 'crazy') {
    const seen = new Set<string>();
    for (const card of s[s.turn].hand) {
      if (forBot && seen.has(card.suit)) continue;
      seen.add(card.suit);
      for (const c of cardOptions(s, card, forBot)) {
        out.push({ type: 'card', cardId: card.id, ...(c.pieceId ? { pieceId: c.pieceId } : {}), targets: c.targets.map(sqName) });
      }
    }
  }
  return out;
}

/** Bot-only: one double jump per landing square, and blocks only around the kings and big pieces. */
function trimPowerOptions(s: MState, i: number, opts: number[][]): number[][] {
  const p = s.board[i]!;
  const power = POWER_OF[p.kind];
  if (power === 'doubleJump') {
    const seen = new Set<number>();
    return opts.filter((t) => !seen.has(t[1]) && !!seen.add(t[1]));
  }
  if (power === 'block') {
    const near = new Set<number>();
    for (let j = 0; j < 64; j++) {
      const q = s.board[j];
      if (!q || !(q.kind === 'k' || (q.side === p.side && VALUE[q.kind] >= 5))) continue;
      for (const [df, dr] of KING) if (onBoard(fileOf(j) + df, rankOf(j) + dr)) near.add(idx(fileOf(j) + df, rankOf(j) + dr));
    }
    return opts.filter((t) => near.has(t[0]));
  }
  return opts;
}

/** Does the side to move have any action at all? (Crazy: else its turn passes.) */
export function hasAnyAction(s: MState): boolean {
  if (legalMoves(s).length) return true;
  for (let i = 0; i < 64; i++) if (s.board[i]?.side === s.turn && powerOptions(s, i).length) return true;
  if (s.mode === 'crazy') return s[s.turn].hand.some((c) => cardOptions(s, c).length > 0);
  return false;
}

/** Normalise and check an action against the legal list. Returns the matching legal action or null. */
export function findLegal(s: MState, a: ActionInput): ActionInput | null {
  const key = actionKey(a);
  return legalActions(s).find((x) => actionKey(x) === key) ?? null;
}

export function actionKey(a: ActionInput): string {
  switch (a.type) {
    case 'move': return `m:${a.from}${a.to}${a.promotion ?? ''}`;
    case 'power': return `p:${a.pieceId}:${a.targets.join(',')}`;
    case 'card': return `c:${a.cardId}:${a.pieceId ?? ''}:${a.targets.join(',')}`;
    case 'bonus': return `b:${a.choice}:${a.choice === 'skip' ? '' : a.targets.join(',')}`;
  }
}

// ---------- applying ----------

export interface MoveOutcome {
  pieceId: PieceId;
  side: Side;
  kind: PieceKind;
  from: Square;
  to: Square;
  flags: MoveFlag[];
  captured?: PieceState;
  rookMove?: { pieceId: PieceId; from: Square; to: Square };
  promotion?: PieceKind;
  promotedId?: PieceId;
  slide?: { from: Square; to: Square };
}

export interface Outcome {
  move?: MoveOutcome;
  changes: BoardChange[];
  joker?: JokerOutcome;
  drawn?: Card[];
  label: string;
}

/** Take the piece on `i` off the board as captured. */
function capture(s: MState, i: number): PieceState {
  const p = s.board[i]!;
  const state: PieceState = { id: p.id, side: p.side, kind: p.kind, square: sqName(i) };
  s.board[i] = null;
  const own = s[p.side];
  own.captured.push(state);
  own.powersUsed = own.powersUsed.filter((x) => x !== p.id);
  if (own.castleK === p.id) own.castleK = null;
  if (own.castleQ === p.id) own.castleQ = null;
  s.statuses = s.statuses.filter((x) => x.id !== p.id);
  s.fiftyReset = true;
  if (p.kind === 'k') s.kingTaken = p.side;
  return state;
}

/** Move a piece. A king or rook moved this way loses castling for good. */
function relocate(s: MState, from: number, to: number): void {
  const p = s.board[from]!;
  s.board[from] = null;
  s.board[to] = p;
  loseCastling(s, p);
}

function loseCastling(s: MState, p: MPiece): void {
  const own = s[p.side];
  if (p.kind === 'k') own.castleK = own.castleQ = null;
  if (own.castleK === p.id) own.castleK = null;
  if (own.castleQ === p.id) own.castleQ = null;
}

function markUsed(s: MState, p: MPiece): void {
  if (!s[p.side].powersUsed.includes(p.id)) s[p.side].powersUsed.push(p.id);
}

/** Stun or freeze; the longer status wins. Returns true if it changed anything. */
export function giveStatus(s: MState, id: PieceId, status: PieceStatusKind, turns: number): boolean {
  const cur = statusOf(s, id);
  if (cur && cur.turnsLeft >= turns) return false;
  s.statuses = s.statuses.filter((x) => x.id !== id);
  s.statuses.push({ id, status, turnsLeft: turns });
  return true;
}

function promote(s: MState, i: number, kind: PieceKind): PieceId {
  const p = s.board[i]!;
  const newId = `${p.side}-${kind}-${sqName(i)}-promo${++s.promoCount}`;
  s.board[i] = { id: newId, side: p.side, kind };
  s[p.side].powersUsed = s[p.side].powersUsed.filter((x) => x !== p.id);
  s.statuses = s.statuses.filter((x) => x.id !== p.id);
  return newId;
}

export function applyMove(s: MState, m: Move): MoveOutcome {
  const p = s.board[m.from]!;
  const side = p.side;
  const out: MoveOutcome = { pieceId: p.id, side, kind: p.kind, from: sqName(m.from), to: sqName(m.to), flags: [] };
  const victimSq = m.ep ? idx(fileOf(m.to), rankOf(m.from)) : m.to;
  if (s.board[victimSq]) {
    out.captured = capture(s, victimSq);
    out.flags.push('capture');
    if (m.ep) out.flags.push('enPassant');
  }
  relocate(s, m.from, m.to);
  if (p.kind === 'p') s.fiftyReset = true;
  if (m.castle) {
    const r = rankOf(m.from);
    const rf = idx(m.castle === 'k' ? 7 : 0, r);
    const rt = idx(m.castle === 'k' ? 5 : 3, r);
    out.rookMove = { pieceId: s.board[rf]!.id, from: sqName(rf), to: sqName(rt) };
    relocate(s, rf, rt);
    out.flags.push(m.castle === 'k' ? 'castleKing' : 'castleQueen');
  }
  let at = m.to;
  if (s.die?.effect === 'banana' && !m.castle) {
    const dx = fileOf(m.to) - fileOf(m.from);
    const dy = rankOf(m.to) - rankOf(m.from);
    const knight = p.kind === 'n';
    const ux = knight ? (Math.abs(dx) === 2 ? Math.sign(dx) : 0) : Math.sign(dx);
    const uy = knight ? (Math.abs(dy) === 2 ? Math.sign(dy) : 0) : Math.sign(dy);
    const x = fileOf(m.to) + ux;
    const y = rankOf(m.to) + uy;
    if (onBoard(x, y) && isEmpty(s, idx(x, y))) {
      at = idx(x, y);
      relocate(s, m.to, at);
      out.slide = { from: sqName(m.to), to: sqName(at) };
    }
  }
  if (m.double && !out.slide) {
    out.flags.push('doublePush');
    s.epNext = { sq: (m.from + m.to) >> 1, pawnId: p.id, pawnSq: m.to };
  }
  if (p.kind === 'p' && rankOf(at) === lastRank(side)) {
    const kind = out.slide ? 'q' : (m.promo ?? 'q');
    out.promotion = kind;
    out.promotedId = promote(s, at, kind);
    out.flags.push('promotion');
  }
  return out;
}

export function applyPower(s: MState, i: number, t: number[]): Outcome {
  const p = s.board[i]!;
  const power = POWER_OF[p.kind];
  const name = `${ANIMAL[p.side][p.kind]}: ${POWER_NAME[power]}`;
  const changes: BoardChange[] = [];
  markUsed(s, p);
  switch (power) {
    case 'sidestep':
      relocate(s, i, t[0]);
      s.fiftyReset = true;
      changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(t[0]), how: 'sidestep' });
      return { changes, label: `${name} ${sqName(i)}→${sqName(t[0])}` };
    case 'doubleJump': {
      const [mid, to] = t;
      relocate(s, i, mid);
      changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(mid), how: 'jump' });
      let step = 1;
      const took = s.board[to];
      if (took) {
        capture(s, to);
        changes.push({ step: step++, type: 'capture', pieceId: took.id, square: sqName(to), by: p.id });
      }
      relocate(s, mid, to);
      changes.push({ step, type: 'move', pieceId: p.id, from: sqName(mid), to: sqName(to), how: 'jump' });
      return { changes, label: `${name} ${sqName(i)}→${sqName(mid)}→${took ? 'x' : ''}${sqName(to)}` };
    }
    case 'headbutt': {
      const v = t[0];
      const dest = v + (v - i);
      const victim = s.board[v]!;
      relocate(s, v, dest);
      changes.push({ step: 0, type: 'move', pieceId: victim.id, from: sqName(v), to: sqName(dest), how: 'pushed' });
      return { changes, label: `${name} pushes ${ANIMAL[victim.side][victim.kind]} ${sqName(v)}→${sqName(dest)}` };
    }
    case 'stomp': {
      const victims = stompVictims(s, i);
      for (const v of victims) {
        const id = s.board[v]!.id;
        if (giveStatus(s, id, 'stunned', s.cfg.stunTurns)) changes.push({ step: 0, type: 'status', pieceId: id, status: 'stunned' });
      }
      return { changes, label: `${name} on ${sqName(i)} (${changes.length} stunned)` };
    }
    case 'block':
      s.blocks.push({ sq: t[0], by: p.side, turnsLeft: s.cfg.blockPlies });
      changes.push({ step: 0, type: 'block', square: sqName(t[0]), by: p.side });
      return { changes, label: `${name} on ${sqName(t[0])}` };
    case 'escape':
      relocate(s, i, t[0]);
      changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(t[0]), how: 'teleport' });
      return { changes, label: `${name} ${sqName(i)}→${sqName(t[0])}` };
  }
}

/** Play a card. `real` = false (bot search): a Joker counts as Party instead of rolling. */
export function applyCard(s: MState, cardId: string, pieceId: PieceId | undefined, t: number[], real = true): Outcome {
  const side = s.turn;
  const hand = s[side].hand;
  const card = hand.find((c) => c.id === cardId)!;
  s[side].hand = hand.filter((c) => c.id !== cardId);
  const sym = CARD_SYMBOL[card.suit];
  const changes: BoardChange[] = [];
  switch (card.suit) {
    case 'hearts': {
      const caps = s[side].captured;
      const dead = caps.find((p) => p.id === pieceId)!;
      s[side].captured = caps.filter((p) => p !== dead);
      const kind = reviveKind(dead);
      s.board[t[0]] = { id: dead.id, side, kind };
      s[side].powersUsed = s[side].powersUsed.filter((x) => x !== dead.id);
      changes.push({ step: 0, type: 'spawn', piece: { id: dead.id, side, kind, square: sqName(t[0]) }, cause: 'revive' });
      return { changes, label: `${sym} Revive ${ANIMAL[side][kind]} on ${sqName(t[0])}` };
    }
    case 'diamonds': {
      const [a, b] = t;
      const pa = s.board[a]!;
      const pb = s.board[b]!;
      s.board[a] = pb;
      s.board[b] = pa;
      loseCastling(s, pa);
      loseCastling(s, pb);
      if (pa.kind === 'p' || pb.kind === 'p') s.fiftyReset = true;
      changes.push(
        { step: 0, type: 'move', pieceId: pa.id, from: sqName(a), to: sqName(b), how: 'swap' },
        { step: 0, type: 'move', pieceId: pb.id, from: sqName(b), to: sqName(a), how: 'swap' },
      );
      return { changes, label: `${sym} Swap ${sqName(a)}↔${sqName(b)}` };
    }
    case 'clubs': {
      const v = s.board[t[0]]!;
      giveStatus(s, v.id, 'frozen', s.cfg.freezeTurns);
      changes.push({ step: 0, type: 'status', pieceId: v.id, status: 'frozen' });
      return { changes, label: `${sym} Freeze on ${sqName(t[0])}` };
    }
    case 'spades': {
      const from = t[0];
      const to = idx(fileOf(from), rankOf(from) - forward(side));
      const pawn = s.board[from]!;
      relocate(s, from, to);
      s.fiftyReset = true;
      changes.push({ step: 0, type: 'move', pieceId: pawn.id, from: sqName(from), to: sqName(to), how: 'dig' });
      return { changes, label: `${sym} Dig ${sqName(from)}→${sqName(to)}` };
    }
    case 'joker': {
      const joker: JokerOutcome = real ? pickWeighted(s, s.cfg.jokerOdds) : 'party';
      const res = applyJoker(s, joker, changes);
      return { changes, joker, ...(res ? { drawn: res } : {}), label: `${sym} Joker: ${JOKER_NAME[joker]}` };
    }
  }
}

function applyJoker(s: MState, joker: JokerOutcome, changes: BoardChange[]): Card[] | undefined {
  const side = s.turn;
  const enemy = opposite(side);
  const pickOne = <T>(xs: T[]): T => xs[Math.floor(nextRandom(s) * xs.length)];
  switch (joker) {
    case 'party': {
      const ids = s[side].powersUsed;
      s[side].powersUsed = [];
      if (ids.length) changes.push({ step: 0, type: 'recharge', pieceIds: ids });
      return;
    }
    case 'teleport': {
      const half = side === 'land' ? [0, 1, 2, 3] : [4, 5, 6, 7];
      const movers = ownActive(s, side).filter((i) => s.board[i]!.kind !== 'k');
      const spots = (i: number) => {
        const out: number[] = [];
        for (const r of half) {
          if (s.board[i]!.kind === 'p' && r === backRank(side)) continue;
          for (let f = 0; f < 8; f++) if (isEmpty(s, idx(f, r))) out.push(idx(f, r));
        }
        return out;
      };
      const able = movers.filter((i) => spots(i).length);
      if (!able.length) return;
      const from = pickOne(able);
      const to = pickOne(spots(from));
      const p = s.board[from]!;
      relocate(s, from, to);
      if (p.kind === 'p') s.fiftyReset = true;
      changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(from), to: sqName(to), how: 'teleport' });
      return;
    }
    case 'butterfingers': {
      const targets: number[] = [];
      for (let i = 0; i < 64; i++) if (s.board[i]?.side === enemy && s.board[i]!.kind !== 'k') targets.push(i);
      if (!targets.length) return;
      const id = s.board[pickOne(targets)]!.id;
      if (giveStatus(s, id, 'frozen', s.cfg.freezeTurns)) changes.push({ step: 0, type: 'status', pieceId: id, status: 'frozen' });
      return;
    }
    case 'double': {
      const drawn: Card[] = [];
      for (let n = 0; n < 2 && s[side].hand.length < s.cfg.handLimit; n++) drawn.push(drawCard(s, side));
      return drawn;
    }
  }
}

export function applyBonus(s: MState, a: Extract<ActionInput, { type: 'bonus' }>): Outcome {
  const changes: BoardChange[] = [];
  if (a.choice === 'skip') return { changes, label: 'Lucky: skipped' };
  const i = sqIndex(a.targets[0]);
  const p = s.board[i]!;
  if (a.choice === 'recharge') {
    s[p.side].powersUsed = s[p.side].powersUsed.filter((x) => x !== p.id);
    changes.push({ step: 0, type: 'recharge', pieceIds: [p.id] });
    return { changes, label: `Lucky: ${ANIMAL[p.side][p.kind]} recharged` };
  }
  const to = idx(fileOf(i), rankOf(i) + forward(p.side));
  relocate(s, i, to);
  s.fiftyReset = true;
  changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(to), how: 'step' });
  return { changes, label: `Lucky: ${ANIMAL[p.side][p.kind]} steps ${sqName(i)}→${sqName(to)}` };
}

/** Apply any legal action (move, power, card or bonus) to `s`. */
export function applyAction(s: MState, a: ActionInput, real = true): Outcome {
  switch (a.type) {
    case 'move': {
      const m = toMove(s, a);
      const move = applyMove(s, m);
      return { move, changes: [], label: '' };
    }
    case 'power': return applyPower(s, findPiece(s, a.pieceId), a.targets.map(sqIndex));
    case 'card': return applyCard(s, a.cardId, a.pieceId, a.targets.map(sqIndex), real);
    case 'bonus': return applyBonus(s, a);
  }
}

/** The internal move for a legal move input. */
export function toMove(s: MState, a: Extract<ActionInput, { type: 'move' }>): Move {
  const from = sqIndex(a.from);
  const to = sqIndex(a.to);
  const m = pseudoMoves(s, s.turn).find((x) => x.from === from && x.to === to && (!x.promo || x.promo === (a.promotion ?? 'q')));
  if (!m) throw new Error(`core: not a move ${a.from}${a.to}`);
  return m;
}

export function drawCard(s: MState, side: Side): Card {
  const card: Card = { id: `card${++s.cardCount}`, suit: pickWeighted(s, s.cfg.cardOdds) };
  s[side].hand.push(card);
  return card;
}

// ---------- turn flow ----------

export function tickBlocks(s: MState): void {
  for (const b of s.blocks) b.turnsLeft--;
  s.blocks = s.blocks.filter((b) => b.turnsLeft > 0);
}

/** End the mover's turn and start the next: statuses, fifty-move count, round, blocks, en passant. */
export function endTurn(s: MState): void {
  const mover = s.turn;
  for (const st of s.statuses) {
    const i = findPiece(s, st.id);
    if (i >= 0 && s.board[i]!.side === mover) st.turnsLeft--;
  }
  s.statuses = s.statuses.filter((x) => x.turnsLeft > 0);
  s.halfmove = s.fiftyReset ? 0 : s.halfmove + 1;
  s.fiftyReset = false;
  if (mover === 'sea') s.fullmove++;
  s.turn = opposite(mover);
  if (s.turn === 'land') s.round++;
  tickBlocks(s);
  s.ep = s.epNext;
  s.epNext = null;
  s.die = null;
  s.phase = 'action';
}

export const wheelDue = (s: MState) => s.turn === 'land' && s.round > 1 && (s.round - 1) % s.cfg.wheelEvery === 0;
export const nextWheelIn = (s: MState) => s.cfg.wheelEvery - ((s.round - 1) % s.cfg.wheelEvery);

export interface WheelResult { outcome: WheelOutcome; direction?: 'left' | 'right'; changes: BoardChange[]; label: string }

export function spinWheel(s: MState, forced?: WheelOutcome): WheelResult {
  const outcome = forced ?? pickWeighted(s, s.cfg.wheelOdds);
  const changes: BoardChange[] = [];
  const res: WheelResult = { outcome, changes, label: `Wheel: ${WHEEL_NAME[outcome]}` };
  const moveAll = (order: number[], dest: (i: number) => number | null, how: 'swept' | 'quake') => {
    for (const i of order) {
      const p = s.board[i];
      if (!p) continue;
      const to = dest(i);
      if (to === null || !isEmpty(s, to)) continue;
      relocate(s, i, to);
      changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(to), how });
    }
  };
  switch (outcome) {
    case 'tide': {
      // Closest to the meadow first, so a piece can follow the one in front of it.
      const order: number[] = [];
      for (let r = 4; r <= 7; r++) for (let f = 0; f < 8; f++) order.push(idx(f, r));
      moveAll(order, (i) => (s.board[i]!.side === 'land' ? i - 8 : null), 'swept');
      if (s.cfg.tideBothSides) {
        const back: number[] = [];
        for (let r = 3; r >= 0; r--) for (let f = 0; f < 8; f++) back.push(idx(f, r));
        moveAll(back, (i) => (s.board[i]!.side === 'sea' ? i + 8 : null), 'swept');
      }
      break;
    }
    case 'pigeon': {
      const pawns: number[] = [];
      for (let i = 0; i < 64; i++) if (s.board[i]?.kind === 'p') pawns.push(i);
      if (pawns.length) {
        const i = pawns[Math.floor(nextRandom(s) * pawns.length)];
        const took = capture(s, i);
        changes.push({ step: 0, type: 'capture', pieceId: took.id, square: took.square, cause: 'pigeon' });
        res.label += ` took a ${ANIMAL[took.side].p}`;
      } else {
        res.label += ' (flew past)';
      }
      break;
    }
    case 'earthquake': {
      const dir = nextRandom(s) < 0.5 ? -1 : 1;
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
      const ids = [...s.land.powersUsed, ...s.sea.powersUsed];
      s.land.powersUsed = [];
      s.sea.powersUsed = [];
      if (ids.length) changes.push({ step: 0, type: 'recharge', pieceIds: ids });
      break;
    }
  }
  return res;
}

/** Only the two kings left (Crazy's only material draw). */
function onlyKings(s: MState): boolean {
  return s.board.every((p) => !p || p.kind === 'k');
}

/** Classic's insufficient material: K v K, K+minor v K, or only same-coloured bishops. */
function insufficient(s: MState): boolean {
  const rest: { kind: PieceKind; sq: number }[] = [];
  s.board.forEach((p, i) => p && p.kind !== 'k' && rest.push({ kind: p.kind, sq: i }));
  if (!rest.length) return true;
  if (rest.length === 1 && (rest[0].kind === 'n' || rest[0].kind === 'b')) return true;
  if (rest.every((x) => x.kind === 'b')) {
    const colour = (i: number) => (fileOf(i) + rankOf(i)) % 2;
    return rest.every((x) => colour(x.sq) === colour(rest[0].sq));
  }
  return false;
}

/** Endings that can be read off the position at the start of a turn (threefold is the game's job). */
export function detectOver(s: MState): GameOver | null {
  if (s.mode === 'crazy') {
    if (s.kingTaken) return { winner: opposite(s.kingTaken), reason: 'kingCaptured' };
    if (onlyKings(s)) return { winner: null, reason: 'insufficient' };
    if (s.halfmove >= 100) return { winner: null, reason: 'fiftyMove' };
    return null;
  }
  if (!hasAnyAction(s)) {
    return inCheck(s, s.turn) ? { winner: opposite(s.turn), reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
  }
  if (insufficient(s)) return { winner: null, reason: 'insufficient' };
  if (s.halfmove >= 100) return { winner: null, reason: 'fiftyMove' };
  return null;
}

/** Threefold key: the board plus everything beyond it that changes what can happen (Normal). */
export function positionKey(s: MState): string {
  const board = s.board.map((p) => (p ? `${p.side[0]}${p.kind}` : '.')).join('');
  const ep = s.ep && pseudoMoves(s, s.turn).some((m) => m.ep) ? s.ep.sq : '-';
  const used = [...s.land.powersUsed, ...s.sea.powersUsed].map((id) => findPiece(s, id)).sort((a, b) => a - b).join(',');
  const st = s.statuses.map((x) => `${findPiece(s, x.id)}${x.status[0]}${x.turnsLeft}`).sort().join(',');
  const bl = s.blocks.map((b) => `${b.sq}${b.by[0]}${b.turnsLeft}`).sort().join(',');
  const cs = `${s.land.castleK ? 'K' : ''}${s.land.castleQ ? 'Q' : ''}${s.sea.castleK ? 'k' : ''}${s.sea.castleQ ? 'q' : ''}`;
  return `${board}|${s.turn}|${cs}|${ep}|${used}|${st}|${bl}`;
}

// ---------- SAN ----------

const LETTER: Record<PieceKind, string> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

/** SAN without the check suffix, worked out before the move is applied. */
export function sanOf(s: MState, m: Move, legal: Move[]): string {
  if (m.castle) return m.castle === 'k' ? 'O-O' : 'O-O-O';
  const p = s.board[m.from]!;
  const takes = m.ep || !!s.board[m.to];
  let out = LETTER[p.kind];
  if (p.kind === 'p') {
    if (takes) out += 'abcdefgh'[fileOf(m.from)];
  } else {
    const rivals = legal.filter((x) => x.to === m.to && x.from !== m.from && s.board[x.from]?.kind === p.kind);
    if (rivals.length) {
      const sameFile = rivals.some((x) => fileOf(x.from) === fileOf(m.from));
      const sameRank = rivals.some((x) => rankOf(x.from) === rankOf(m.from));
      if (!sameFile) out += 'abcdefgh'[fileOf(m.from)];
      else if (!sameRank) out += String(rankOf(m.from) + 1);
      else out += sqName(m.from);
    }
  }
  if (takes) out += 'x';
  out += sqName(m.to);
  if (m.promo) out += `=${m.promo.toUpperCase()}`;
  return out;
}

export const VALUE: Record<PieceKind, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
