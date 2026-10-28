import type { ActionRecord, MoveResult, PieceId, PieceKind, PieceState, Side, SideModeState } from '../contracts/types';

/** Clock text: "10:00", "0:42", and tenths under 10 seconds ("7.3"). */
export function formatClock(ms: number | null): string {
  if (ms === null) return '∞';
  const t = Math.max(0, ms);
  if (t < 10_000) return (Math.floor(t / 100) / 10).toFixed(1);
  const total = Math.ceil(t / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Spoken clock for screen readers: "4 minutes 2 seconds". */
export function spokenClock(ms: number | null): string {
  if (ms === null) return 'untimed';
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} minute${m === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}` : `${s} second${s === 1 ? '' : 's'}`;
}

export const PIECE_VALUE: Record<PieceKind, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ORDER: PieceKind[] = ['q', 'r', 'b', 'n', 'p', 'k'];

export interface CapturedTally {
  /** Pieces each side has taken (so `land` holds Sea animals), biggest first. */
  land: PieceKind[];
  sea: PieceKind[];
  /** Material lead from Land's point of view, counting promotions. */
  diff: number;
}

export function tallyCaptures(moves: MoveResult[]): CapturedTally {
  const out: CapturedTally = { land: [], sea: [], diff: 0 };
  for (const m of moves) {
    if (m.captured) {
      out[m.side].push(m.captured.kind);
      out.diff += (m.side === 'land' ? 1 : -1) * PIECE_VALUE[m.captured.kind];
    }
    if (m.promotion) out.diff += (m.side === 'land' ? 1 : -1) * (PIECE_VALUE[m.promotion] - 1);
  }
  const byOrder = (a: PieceKind, b: PieceKind) => ORDER.indexOf(a) - ORDER.indexOf(b);
  out.land.sort(byOrder);
  out.sea.sort(byOrder);
  return out;
}

/** Group moves into numbered rows. Handles a game that starts with Sea to move (FEN). */
export function moveRows(moves: MoveResult[]): { n: number; land?: string; sea?: string }[] {
  const rows: { n: number; land?: string; sea?: string }[] = [];
  for (const m of moves) {
    const last = rows[rows.length - 1];
    if (m.side === 'land' || !last || last.sea !== undefined) {
      rows.push({ n: (last?.n ?? 0) + 1, [m.side]: m.san });
    } else {
      last.sea = m.san;
    }
  }
  return rows;
}

export const otherSide = (s: Side): Side => (s === 'land' ? 'sea' : 'land');

// ---------- Phase 3: game modes ----------

/** One entry of the move list in the order it happened: a move, or a non-move line (power, card, bonus, bonk, wheel, pass). */
export type ListEntry = { move: MoveResult } | { log: ActionRecord };
export type ListRow =
  | { type: 'move'; n: number; land?: string; sea?: string }
  | { type: 'log'; n: number; record: ActionRecord };

/** Lines that belong to their side's turn (the wheel has no side; a bonus opens its side's turn). */
const TURN_KINDS: ActionRecord['kind'][] = ['move', 'power', 'card', 'pass', 'bonk', 'bonus'];

/**
 * Rows for the move list. Moves pair up as in Classic ("1. e4 e5"); a log line sits between them on its own
 * row and closes the row it follows, so a Sea move after it starts a new "1. … e5" row.
 * The round number goes up each time Land starts a turn. A log record of kind 'move' is skipped (addMove shows moves).
 */
/** `keepMoveLogs`: the party modes have no addMove, so their 'move' records (steps, shoves, tags) are lines too. */
export function listRows(entries: ListEntry[], keepMoveLogs = false): ListRow[] {
  const rows: ListRow[] = [];
  let round = 1;
  let lastSide: Side | null = null;
  let row: Extract<ListRow, { type: 'move' }> | null = null;
  for (const e of entries) {
    const side = 'move' in e ? e.move.side : e.log.side;
    const turn = 'move' in e || TURN_KINDS.includes(e.log.kind);
    if (turn && side && side !== lastSide) {
      if (lastSide !== null && side === 'land') round++;
      lastSide = side;
    }
    if ('log' in e) {
      if (e.log.kind === 'move' && !keepMoveLogs) continue;
      // The wheel spins at the start of Land's turn: it belongs to the next round.
      const n = e.log.kind === 'wheel' && lastSide === 'sea' ? round + 1 : round;
      rows.push({ type: 'log', n, record: e.log });
      row = null;
      continue;
    }
    const m = e.move;
    if (m.side === 'sea' && row && row.n === round && row.sea === undefined) {
      row.sea = m.san;
    } else {
      row = { type: 'move', n: round, [m.side]: m.san };
      rows.push(row);
    }
  }
  return rows;
}

/** Captured trays from the mode state (`captured` = a side's own lost pieces). Covers pigeon, double jump and revive. */
export function tallyFromCaptured(landLost: PieceState[], seaLost: PieceState[]): CapturedTally {
  const byOrder = (a: PieceKind, b: PieceKind) => ORDER.indexOf(a) - ORDER.indexOf(b);
  const land = seaLost.map((p) => p.kind).sort(byOrder);
  const sea = landLost.map((p) => p.kind).sort(byOrder);
  const value = (ks: PieceKind[]) => ks.reduce((s, k) => s + PIECE_VALUE[k], 0);
  return { land, sea, diff: value(land) - value(sea) };
}

export const POWER_ORDER: PieceKind[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const START_COUNT: Record<PieceKind, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

/**
 * Powers left per piece kind for one side: how many live pieces of that kind, and how many still have their power.
 * With `pieces` (the live board) it is exact. Without, it assumes the standard start minus captures, and reads the
 * kind of a used power from its id, so promoted pieces can be off.
 */
export function powerCounts(
  side: Side,
  s: SideModeState,
  pieces: PieceState[] | null,
  kindOf: (id: PieceId) => PieceKind | null,
): Record<PieceKind, { total: number; left: number }> {
  const out = Object.fromEntries(POWER_ORDER.map((k) => [k, { total: 0, left: 0 }])) as Record<PieceKind, { total: number; left: number }>;
  const used = new Set(s.powersUsed);
  if (pieces) {
    for (const p of pieces) {
      if (p.side !== side) continue;
      out[p.kind].total++;
      if (!used.has(p.id)) out[p.kind].left++;
    }
    return out;
  }
  for (const k of POWER_ORDER) out[k].total = START_COUNT[k];
  for (const p of s.captured) out[p.kind].total = Math.max(0, out[p.kind].total - 1);
  for (const k of POWER_ORDER) out[k].left = out[k].total;
  for (const id of s.powersUsed) {
    const k = kindOf(id);
    if (k && out[k].left > 0) out[k].left--;
  }
  return out;
}
