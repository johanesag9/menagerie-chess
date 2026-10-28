import { describe, expect, it } from 'vitest';
import type { Square } from '../contracts/types';
import { BOARD_TOP } from './constants';
import { ALL_SQUARES, idxSquare, rayToColumns, squareIdx, squareToXZ } from './coords';
import { COLUMN_HALF, LEVEL_H, LEVEL_TIMING, diffLevels, levelTop } from './levels';
import { INSTANT_MIN_SQUARES, isRingSink, ringOf, sinkDropTimes, sinkStyle } from './sink';

const heightsOf = (levels: Partial<Record<Square, number>>) => {
  const h = new Float32Array(64);
  for (const [sq, l] of Object.entries(levels)) h[squareIdx(sq as Square)] = l * LEVEL_H;
  return h;
};

describe('square indexes', () => {
  it('round-trips every square', () => {
    for (const sq of ALL_SQUARES) expect(idxSquare(squareIdx(sq))).toBe(sq);
  });
});

describe('level heights', () => {
  it('level 0 is the flat board and each level adds the same height', () => {
    expect(levelTop(0)).toBe(BOARD_TOP);
    expect(levelTop(3) - levelTop(2)).toBeCloseTo(LEVEL_H);
  });
  it('a level reads clearly: about 0.28 of a square', () => {
    expect(LEVEL_H).toBeGreaterThanOrEqual(0.24);
    expect(LEVEL_H).toBeLessThanOrEqual(0.32);
  });
  it('builds and digs take about 0.4s', () => {
    expect(LEVEL_TIMING.normal.build).toBeGreaterThan(0.3);
    expect(LEVEL_TIMING.normal.dig).toBeLessThan(0.5);
  });
});

describe('diffLevels', () => {
  const lv = (o: Partial<Record<Square, number>>) => {
    const a = new Uint8Array(64);
    for (const [sq, l] of Object.entries(o)) a[squareIdx(sq as Square)] = l;
    return a;
  };
  it('a build or a dig changes one square and is not the tide', () => {
    expect(diffLevels(lv({}), lv({ e4: 1 }))).toMatchObject({ tide: false, changes: [{ from: 0, to: 1 }] });
    expect(diffLevels(lv({ e4: 2 }), lv({ e4: 1 })).tide).toBe(false);
  });
  it('several squares going down at once is the tide', () => {
    expect(diffLevels(lv({ a5: 2, b6: 1 }), lv({ a5: 1 })).tide).toBe(true);
  });
  it('a mix of ups and downs is not the tide', () => {
    expect(diffLevels(lv({ a5: 2 }), lv({ a5: 1, c3: 1 })).tide).toBe(false);
  });
});

describe('picking raised squares', () => {
  // A camera above and in front of rank 1 (Land side), looking down the board.
  const cam = { x: 0, y: 7, z: 9 };
  const rayTo = (sq: Square, y: number) => {
    const { x, z } = squareToXZ(sq);
    const d = { x: x - cam.x, y: y - cam.y, z: z - cam.z };
    return [cam.x, cam.y, cam.z, d.x, d.y, d.z] as const;
  };
  it('hits nothing on a flat board', () => {
    expect(rayToColumns(...rayTo('e4', BOARD_TOP), heightsOf({}), COLUMN_HALF)).toBeNull();
  });
  it('the top of a castle picks its square', () => {
    const h = heightsOf({ e4: 3 });
    expect(rayToColumns(...rayTo('e4', BOARD_TOP + 3 * LEVEL_H), h, COLUMN_HALF)?.square).toBe('e4');
  });
  it('the front side of a tall square picks it, not the square behind it', () => {
    // Aim at e5 on the flat board; a level-3 e4 in front of it blocks the view, so its side is hit.
    const h = heightsOf({ e4: 3 });
    const { x, z } = squareToXZ('e4');
    const ray = [cam.x, cam.y, cam.z, x - cam.x, BOARD_TOP + LEVEL_H - cam.y, z + 0.47 - cam.z] as const;
    expect(rayToColumns(...ray, h, COLUMN_HALF)?.square).toBe('e4');
  });
  it('the nearest column wins', () => {
    const h = heightsOf({ e3: 3, e4: 3 });
    expect(rayToColumns(...rayTo('e4', BOARD_TOP + LEVEL_H), h, COLUMN_HALF)?.square).toBe('e3');
  });
});

describe('Stepping Stones sinking', () => {
  const middle = ALL_SQUARES.filter((sq) => '3456'.includes(sq[1]));
  it('the stones start (ranks 3-6) is instant, not a wave', () => {
    expect(middle.length).toBeGreaterThanOrEqual(INSTANT_MIN_SQUARES);
    expect(sinkStyle(middle)).toBe('instant');
    expect([...sinkDropTimes(middle).values()].every((t) => t === 0)).toBe(true);
  });
  it('a Sumo ring still plays the wave', () => {
    const ring = ALL_SQUARES.filter((sq) => ringOf(sq) === 0);
    expect(isRingSink(ring)).toBe(true);
    expect(sinkStyle(ring)).toBe('wave');
  });
  it('one square, or a Stomp of up to 8, sinks quickly one after another', () => {
    expect(sinkStyle(['d4'])).toBe('each');
    const stomp: Square[] = ['c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5'];
    expect(sinkStyle(stomp)).toBe('each');
    const times = [...sinkDropTimes(stomp).values()];
    expect(Math.max(...times)).toBeLessThan(0.8);
  });
});
