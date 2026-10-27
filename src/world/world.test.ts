import { describe, expect, it } from 'vitest';
import { ALL_SQUARES, rayToBoardXZ, squareToXZ, xzToSquare } from './coords';
import { detectQuality } from './quality';
import { Animator, ease } from './anim';
import { TapTracker } from './tap';
import { BOARD_TOP } from './constants';

describe('coords', () => {
  it('maps every square to its centre and back', () => {
    for (const sq of ALL_SQUARES) {
      const { x, z } = squareToXZ(sq);
      expect(xzToSquare(x, z)).toBe(sq);
      expect(xzToSquare(x + 0.45, z - 0.45)).toBe(sq);
    }
  });
  it('puts Land (rank 1) on +z and a-file on -x', () => {
    expect(squareToXZ('a1')).toEqual({ x: -3.5, y: BOARD_TOP, z: 3.5 });
    expect(squareToXZ('h8')).toEqual({ x: 3.5, y: BOARD_TOP, z: -3.5 });
  });
  it('returns null off the board', () => {
    expect(xzToSquare(4.01, 0)).toBeNull();
    expect(xzToSquare(0, -4.01)).toBeNull();
  });
  it('intersects a downward ray with the board plane', () => {
    const p = rayToBoardXZ(0.5, 10, 0.5, 0, -1, 0)!;
    expect(xzToSquare(p.x, p.z)).toBe('e4');
    expect(rayToBoardXZ(0, 10, 0, 0, 1, 0)).toBeNull(); // pointing away
    expect(rayToBoardXZ(0, 10, 0, 1, 0, 0)).toBeNull(); // parallel
  });
});

describe('quality', () => {
  const desktop = { minScreenSide: 1080, coarsePointer: false, userAgent: 'Mozilla/5.0 (Macintosh)', deviceMemory: 8, hardwareConcurrency: 8, gpu: 'Apple M2' };
  it('picks high on a normal laptop', () => expect(detectQuality(desktop)).toBe('high'));
  it('picks low on phones', () => {
    expect(detectQuality({ ...desktop, minScreenSide: 390, coarsePointer: true, userAgent: 'iPhone' })).toBe('low');
    expect(detectQuality({ ...desktop, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' })).toBe('low');
  });
  it('picks low on weak or software GPUs and low memory', () => {
    expect(detectQuality({ ...desktop, gpu: 'Google SwiftShader' })).toBe('low');
    expect(detectQuality({ ...desktop, gpu: 'Intel(R) HD Graphics 520' })).toBe('low');
    expect(detectQuality({ ...desktop, deviceMemory: 2 })).toBe('low');
  });
});

describe('animator', () => {
  it('runs a tween to its end and resolves', async () => {
    const a = new Animator();
    const seen: number[] = [];
    const h = a.tween(1, (v) => seen.push(v), ease.linear);
    for (let i = 0; i < 12; i++) a.update(0.1);
    await h.done;
    expect(seen.at(-1)).toBe(1);
    expect(a.size).toBe(0);
  });
  it('cancel(true) jumps to the end state', async () => {
    const a = new Animator();
    let v = 0;
    const h = a.tween(5, (x) => (v = x));
    a.update(0.1);
    h.cancel(true);
    await h.done;
    expect(v).toBe(1);
  });
  it('freezes while not updated (pause)', () => {
    const a = new Animator();
    let v = 0;
    a.tween(1, (x) => (v = x), ease.linear);
    a.update(0.5);
    const before = v;
    expect(v).toBeCloseTo(0.5);
    expect(v).toBe(before);
  });
});

describe('tap vs drag', () => {
  it('a short still press is a tap', () => {
    const t = new TapTracker();
    t.down({ id: 1, x: 100, y: 100, type: 'touch' }, 0);
    t.move({ id: 1, x: 104, y: 102, type: 'touch' });
    expect(t.up({ id: 1, x: 104, y: 102, type: 'touch' }, 150)).toBe(true);
  });
  it('an orbit drag is not a tap', () => {
    const t = new TapTracker();
    t.down({ id: 1, x: 100, y: 100, type: 'mouse', button: 0 }, 0);
    t.move({ id: 1, x: 140, y: 100, type: 'mouse', button: 0 });
    t.move({ id: 1, x: 100, y: 100, type: 'mouse', button: 0 }); // came back: still a drag
    expect(t.up({ id: 1, x: 100, y: 100, type: 'mouse', button: 0 }, 200)).toBe(false);
  });
  it('a pinch is never a tap', () => {
    const t = new TapTracker();
    t.down({ id: 1, x: 100, y: 100, type: 'touch' }, 0);
    t.down({ id: 2, x: 200, y: 200, type: 'touch' }, 10);
    expect(t.up({ id: 2, x: 200, y: 200, type: 'touch' }, 100)).toBe(false);
    expect(t.up({ id: 1, x: 100, y: 100, type: 'touch' }, 120)).toBe(false);
    // Next single tap works again.
    t.down({ id: 3, x: 50, y: 50, type: 'touch' }, 500);
    expect(t.up({ id: 3, x: 50, y: 50, type: 'touch' }, 600)).toBe(true);
  });
  it('right-click and long holds are not taps', () => {
    const t = new TapTracker();
    t.down({ id: 1, x: 0, y: 0, type: 'mouse', button: 2 }, 0);
    expect(t.up({ id: 1, x: 0, y: 0, type: 'mouse', button: 2 }, 50)).toBe(false);
    t.down({ id: 1, x: 0, y: 0, type: 'mouse', button: 0 }, 0);
    expect(t.up({ id: 1, x: 0, y: 0, type: 'mouse', button: 0 }, 2000)).toBe(false);
  });
});
