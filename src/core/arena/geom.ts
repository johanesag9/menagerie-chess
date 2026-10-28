/** Board geometry for the board-game modes, precomputed once: neighbours and knight hops of every square (0..63). */
import { fileOf, idx, onBoard, rankOf } from '../modes/state';

/** The 8 directions, orthogonal first. */
export const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 1]];
const KNIGHT: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

const table = (moves: [number, number][]) =>
  Array.from({ length: 64 }, (_, i) =>
    moves.filter(([df, dr]) => onBoard(fileOf(i) + df, rankOf(i) + dr)).map(([df, dr]) => idx(fileOf(i) + df, rankOf(i) + dr)));

/** ADJ[i]: the squares next to i (8 directions). */
export const ADJ: number[][] = table(DIRS);
/** HOPS[i]: knight hops from i. */
export const HOPS: number[][] = table(KNIGHT);

/** The square one step from i toward (df, dr), or -1 off the board. */
export function stepFrom(i: number, df: number, dr: number): number {
  return onBoard(fileOf(i) + df, rankOf(i) + dr) ? idx(fileOf(i) + df, rankOf(i) + dr) : -1;
}

/** King distance. */
export const cheb = (a: number, b: number) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
