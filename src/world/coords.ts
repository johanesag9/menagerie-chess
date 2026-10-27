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
