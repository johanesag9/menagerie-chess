import type { MoveResult, PieceKind, Side } from '../contracts/types';

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
