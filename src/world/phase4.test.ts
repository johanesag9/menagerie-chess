import { describe, expect, it } from 'vitest';
import type { Square, TreasureState } from '../contracts/types';
import { ALL_SQUARES } from './coords';
import { SINK_TIMING, WAVE_MIN_SQUARES, ringOf, sinkDropTimes } from './sink';

const ring = (k: number) => ALL_SQUARES.filter((sq) => ringOf(sq) === k);

describe('rings', () => {
  it('has 28, 20 and 12 squares in the three sinking rings and a middle 2x2', () => {
    expect([0, 1, 2, 3].map((k) => ring(k).length)).toEqual([28, 20, 12, 4]);
    expect(ring(3).sort()).toEqual(['d4', 'd5', 'e4', 'e5']);
  });
});

describe('ring-sink timing', () => {
  for (const reduced of [false, true]) {
    const T = reduced ? SINK_TIMING.reduced : SINK_TIMING.normal;
    it(`drops every tile within the effect (${reduced ? 'reduced' : 'normal'} motion)`, () => {
      for (const k of [0, 1, 2]) {
        const times = sinkDropTimes(ring(k), reduced);
        expect(times.size).toBe(ring(k).length);
        for (const t of times.values()) {
          expect(t).toBeGreaterThan(0);
          expect(t + T.drop).toBeLessThanOrEqual(T.duration);
        }
      }
    });
  }

  it('reaches the Sea side first and the Land side last', () => {
    const times = sinkDropTimes(ring(0));
    expect(times.get('d8')!).toBeLessThan(times.get('a8')!);
    expect(times.get('a8')!).toBeLessThan(times.get('a4')!);
    expect(times.get('a4')!).toBeLessThan(times.get('d1')!);
    // Mirror squares drop together.
    expect(times.get('a5')).toBeCloseTo(times.get('h5')!, 6);
  });

  it('a ring takes about 1.2s; a few squares drop at once without the wave', () => {
    expect(SINK_TIMING.normal.duration).toBeCloseTo(1.2, 5);
    const few: Square[] = ['c3', 'f6'];
    expect(few.length).toBeLessThan(WAVE_MIN_SQUARES);
    const times = sinkDropTimes(few);
    expect(Math.max(...times.values())).toBeLessThan(0.3);
    expect(sinkDropTimes([]).size).toBe(0);
  });
});

describe('treasure states the world gets', () => {
  it('carried treasures have no square (the world skips them)', () => {
    const carried: TreasureState = { owner: 'sea', home: 'd8', square: null, carrier: 'land-n' };
    expect(carried.square).toBeNull();
  });
});
