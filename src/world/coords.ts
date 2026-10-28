/**
 * Square <-> board-local position. Pure maths, no three.js objects, so it is unit-tested.
 * Board-local axes: x runs a -> h, z runs rank 8 (negative, Sea side) -> rank 1 (positive, Land side).
 */
import type { File, Rank, Square } from '../contracts/types';
import { BOARD_TOP, SQUARE } from './constants';

export const FILES: readonly File[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS: readonly Rank[] = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const ALL_SQUARES: readonly Square[] = FILES.flatMap((f) => RANKS.map((r) => `${f}${r}` as Square));

export function squareIndex(sq: Square): { file: number; rank: number } {
  return { file: FILES.indexOf(sq[0] as File), rank: Number(sq[1]) - 1 };
}

export function isSquare(s: string): s is Square {
  return s.length === 2 && FILES.includes(s[0] as File) && RANKS.includes(s[1] as Rank);
}

/** Centre of a square on the board surface, board-local. */
export function squareToXZ(sq: Square): { x: number; y: number; z: number } {
  const { file, rank } = squareIndex(sq);
  return { x: (file - 3.5) * SQUARE, y: BOARD_TOP, z: (3.5 - rank) * SQUARE };
}

/** Board-local x/z to the square under it, or null when off the board. */
export function xzToSquare(x: number, z: number): Square | null {
  const file = Math.floor(x / SQUARE + 4);
  const rank = Math.floor(4 - z / SQUARE);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${RANKS[rank]}` as Square;
}

/**
 * Where a ray (board-local origin + direction) meets the board's top plane.
 * Returns null when the ray runs parallel to the board or points away from it.
 */
export function rayToBoardXZ(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  planeY = BOARD_TOP,
): { x: number; z: number } | null {
  if (Math.abs(dy) < 1e-6) return null;
  const t = (planeY - oy) / dy;
  if (t <= 0) return null;
  return { x: ox + dx * t, z: oz + dz * t };
}

/** Phase 6: index of a square in the per-square arrays (file * 8 + rank). */
export function squareIdx(sq: Square): number {
  const { file, rank } = squareIndex(sq);
  return file * 8 + rank;
}

/** Phase 6: the square for a per-square array index (file * 8 + rank). */
export function idxSquare(i: number): Square {
  return `${FILES[Math.floor(i / 8)]}${RANKS[i % 8]}` as Square;
}

/**
 * Phase 6 (castle): the nearest raised square column a ray (board-local) hits, top or side.
 * `heights[i]` = how far square i's top stands above the board (0 = flat, skipped). `half` = half the column width.
 * Returns the square and the ray distance, or null when no column is hit.
 */
export function rayToColumns(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  heights: ArrayLike<number>, half: number,
): { square: Square; t: number } | null {
  let best: { square: Square; t: number } | null = null;
  for (let i = 0; i < 64; i++) {
    const h = heights[i];
    if (!(h > 0.005)) continue;
    const cx = (Math.floor(i / 8) - 3.5) * SQUARE, cz = (3.5 - (i % 8)) * SQUARE;
    const t = slab(ox, oy, oz, dx, dy, dz, cx - half, BOARD_TOP - 0.2, cz - half, cx + half, BOARD_TOP + h, cz + half);
    if (t !== null && (!best || t < best.t)) best = { square: idxSquare(i), t };
  }
  return best;
}

/** Ray vs axis-aligned box (slab method): the entry distance, or null on a miss. */
function slab(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): number | null {
  let tmin = 0, tmax = Infinity;
  const axes: [number, number, number, number][] = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    tmin = Math.max(tmin, a);
    tmax = Math.min(tmax, b);
    if (tmin > tmax) return null;
  }
  return tmin;
}
