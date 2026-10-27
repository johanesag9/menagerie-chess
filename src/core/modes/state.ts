/**
 * The Normal/Crazy board model: plain data only, so it can be cloned cheaply for the bot search
 * and posted to the bot worker. Squares are indexes 0..63: file + 8 * rank (a1 = 0, h8 = 63).
 */
import { validateFen } from 'chess.js';
import type {
  Card, DieEffect, DieValue, GameMode, ModeState, PieceId, PieceKind, PieceState, PieceStatusKind, Side, Square,
} from '../../contracts/types';
import type { Tuning } from './tuning';

export type ModeKind = Exclude<GameMode, 'classic'>;

export interface MPiece {
  readonly id: PieceId;
  readonly side: Side;
  readonly kind: PieceKind;
}

export interface MStatus { id: PieceId; status: PieceStatusKind; turnsLeft: number }
export interface MBlock { sq: number; by: Side; turnsLeft: number }

export interface MSide {
  powersUsed: PieceId[];
  hand: Card[];
  tokens: number;
  captured: PieceState[];
  /** Own turns until the next card draw. */
  nextCardIn: number;
  /** Id of the rook that may still castle on that wing (null = no right). */
  castleK: PieceId | null;
  castleQ: PieceId | null;
}

export interface MState {
  mode: ModeKind;
  cfg: Tuning;
  board: (MPiece | null)[];
  turn: Side;
  land: MSide;
  sea: MSide;
  /** Set right after a normal double pawn push: the square passed over and the pawn that can be taken. */
  ep: { sq: number; pawnId: PieceId; pawnSq: number } | null;
  /** The en passant chance this turn's action creates; it becomes `ep` when the turn ends. */
  epNext: { sq: number; pawnId: PieceId; pawnSq: number } | null;
  halfmove: number;
  fullmove: number;
  round: number;
  statuses: MStatus[];
  blocks: MBlock[];
  die: { value: DieValue; effect: DieEffect } | null;
  phase: ModeState['phase'];
  promoCount: number;
  cardCount: number;
  /** mulberry32 state: dice, cards, wheel, jokers. */
  rng: number;
  /** Something this turn resets the fifty-move count (a capture or an own pawn move). */
  fiftyReset: boolean;
  /** Set when a king is captured (Crazy). */
  kingTaken: Side | null;
}

export const FILES = 'abcdefgh';
export const fileOf = (i: number) => i & 7;
export const rankOf = (i: number) => i >> 3;
export const idx = (file: number, rank: number) => file + 8 * rank;
export const onBoard = (file: number, rank: number) => file >= 0 && file < 8 && rank >= 0 && rank < 8;
export const sqName = (i: number) => `${FILES[i & 7]}${(i >> 3) + 1}` as Square;
export const sqIndex = (s: Square | string) => s.charCodeAt(0) - 97 + 8 * (s.charCodeAt(1) - 49);
export const opposite = (s: Side): Side => (s === 'land' ? 'sea' : 'land');
/** Rank index where a side's back row is. */
export const backRank = (s: Side) => (s === 'land' ? 0 : 7);
/** Rank direction a side's pawns move in. */
export const forward = (s: Side) => (s === 'land' ? 1 : -1);
export const isSquare = (s: unknown): s is Square => typeof s === 'string' && /^[a-h][1-8]$/.test(s);

/** Deterministic PRNG step (mulberry32). Returns [value 0..1, next state]. */
export function nextRandom(s: MState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pickWeighted<K extends string>(s: MState, weights: Record<K, number>): K {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((a, k) => a + Math.max(0, weights[k]), 0);
  let r = nextRandom(s) * (total || 1);
  for (const k of keys) {
    r -= Math.max(0, weights[k]);
    if (r < 0) return k;
  }
  return keys[keys.length - 1];
}

export function cloneState(s: MState): MState {
  return {
    ...s,
    board: s.board.slice(),
    land: cloneSide(s.land),
    sea: cloneSide(s.sea),
    ep: s.ep && { ...s.ep },
    epNext: s.epNext && { ...s.epNext },
    statuses: s.statuses.map((x) => ({ ...x })),
    blocks: s.blocks.map((x) => ({ ...x })),
    die: s.die && { ...s.die },
  };
}

function cloneSide(m: MSide): MSide {
  return { ...m, powersUsed: m.powersUsed.slice(), hand: m.hand.slice(), captured: m.captured.slice() };
}

// ---------- FEN ----------

const KIND: Record<string, PieceKind> = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

/** Throws an Error with a plain message if the FEN can't start a Normal/Crazy game. */
export function assertModeFen(fen: string): void {
  const v = validateFen(fen);
  if (!v.ok) throw new Error(v.error ?? 'Invalid FEN');
  const placement = fen.split(/\s+/)[0];
  const count = (ch: string) => [...placement].filter((c) => c === ch).length;
  if (count('K') !== 1 || count('k') !== 1) throw new Error('Invalid FEN: each side needs exactly one king');
  const rows = placement.split('/');
  if (/[pP]/.test(rows[0]) || /[pP]/.test(rows[7])) throw new Error('Invalid FEN: pawns cannot stand on rank 1 or 8');
}

export function createState(fen: string, mode: ModeKind, cfg: Tuning, seed: number): MState {
  assertModeFen(fen);
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board: (MPiece | null)[] = new Array(64).fill(null);
  placement.split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const side: Side = ch === ch.toUpperCase() ? 'land' : 'sea';
      const kind = KIND[ch.toLowerCase()];
      const i = idx(f, 7 - r);
      board[i] = { id: `${side}-${kind}-${sqName(i)}`, side, kind };
      f++;
    }
  });
  const side = (): MSide => ({
    powersUsed: [], hand: [], tokens: mode === 'crazy' ? cfg.duelTokens : 0, captured: [],
    nextCardIn: cfg.drawEvery, castleK: null, castleQ: null,
  });
  const s: MState = {
    mode, cfg, board, turn: turn === 'b' ? 'sea' : 'land', land: side(), sea: side(),
    ep: null, epNext: null, halfmove: Number(half) || 0, fullmove: Number(full) || 1, round: 1,
    statuses: [], blocks: [], die: null, phase: 'action', promoCount: 0, cardCount: 0,
    rng: seed >>> 0, fiftyReset: false, kingTaken: null,
  };
  for (const sd of ['land', 'sea'] as Side[]) {
    const r = backRank(sd);
    const king = board[idx(4, r)];
    if (!king || king.kind !== 'k' || king.side !== sd) continue;
    const kCh = sd === 'land' ? 'K' : 'k';
    const qCh = sd === 'land' ? 'Q' : 'q';
    const rk = board[idx(7, r)];
    const rq = board[idx(0, r)];
    if (castling.includes(kCh) && rk?.kind === 'r' && rk.side === sd) s[sd].castleK = rk.id;
    if (castling.includes(qCh) && rq?.kind === 'r' && rq.side === sd) s[sd].castleQ = rq.id;
  }
  if (ep && ep !== '-') {
    const e = sqIndex(ep);
    // The pawn that just double-pushed stands one rank past the ep square, from the mover's view.
    const pawnSq = s.turn === 'land' ? e - 8 : e + 8;
    const pawn = board[pawnSq];
    if (pawn?.kind === 'p' && pawn.side !== s.turn) s.ep = { sq: e, pawnId: pawn.id, pawnSq };
  }
  return s;
}

export function toFen(s: MState): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[idx(f, r)];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += p.side === 'land' ? p.kind.toUpperCase() : p.kind;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let castle = '';
  if (s.land.castleK) castle += 'K';
  if (s.land.castleQ) castle += 'Q';
  if (s.sea.castleK) castle += 'k';
  if (s.sea.castleQ) castle += 'q';
  const ep = s.ep && s.board[s.ep.pawnSq]?.id === s.ep.pawnId ? sqName(s.ep.sq) : '-';
  return `${rows.join('/')} ${s.turn === 'land' ? 'w' : 'b'} ${castle || '-'} ${ep} ${s.halfmove} ${s.fullmove}`;
}

// ---------- reading ----------

export function piecesOf(s: MState): PieceState[] {
  const out: PieceState[] = [];
  for (let r = 7; r >= 0; r--) {
    for (let f = 0; f < 8; f++) {
      const i = idx(f, r);
      const p = s.board[i];
      if (p) out.push({ id: p.id, side: p.side, kind: p.kind, square: sqName(i) });
    }
  }
  return out;
}

export function findPiece(s: MState, id: PieceId): number {
  for (let i = 0; i < 64; i++) if (s.board[i]?.id === id) return i;
  return -1;
}
