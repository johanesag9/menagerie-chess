import { describe, expect, it } from 'vitest';
import type { SquareEffect } from '../contracts/types';
import { TIDE_TIMING } from './chaos';
import { Bin } from './kit';
import { SquareEffects } from './squareFx';

const block = (square: SquareEffect['square'], by: SquareEffect['by'], turnsLeft = 4): SquareEffect => ({ square, effect: 'blocked', by, turnsLeft });

describe('tide timing', () => {
  it('puts the crest at 40% of the effect, normal and reduced', () => {
    for (const t of [TIDE_TIMING.normal, TIDE_TIMING.reduced]) {
      expect(t.crest / t.duration).toBeCloseTo(0.4, 5);
      expect(t.duration).toBeGreaterThanOrEqual(1.2);
      expect(t.duration).toBeLessThanOrEqual(2);
    }
  });
});

describe('square effects', () => {
  const shown = (fx: SquareEffects) => fx.group.children.filter((o) => o.visible).map((o) => o.name).sort();

  it('shows exactly the blocked squares given, and never catches clicks', () => {
    const fx = new SquareEffects(new Bin());
    expect(fx.group.userData.noPick).toBe(true);
    expect(shown(fx)).toEqual([]);
    fx.set([block('d5', 'sea'), block('c4', 'land')]);
    fx.update(1, 1);
    expect(shown(fx)).toEqual(['block-ink', 'block-vase']);
  });

  it('vanishes removed squares and swaps the look when the placer changes', () => {
    const fx = new SquareEffects(new Bin());
    fx.set([block('d5', 'sea'), block('c4', 'land')]);
    fx.update(1, 1);
    fx.set([block('d5', 'sea', 3)]);
    fx.update(0.1, 1.1);
    expect(shown(fx)).toHaveLength(2); // c4 is still fading out
    fx.update(1, 2.1);
    expect(shown(fx)).toEqual(['block-ink']);
    fx.set([block('d5', 'land')]);
    fx.update(1, 3.1);
    expect(shown(fx)).toEqual(['block-vase']);
    fx.set([]);
    fx.update(1, 4.1);
    expect(shown(fx)).toEqual([]);
  });

  it('reuses pooled objects instead of creating new ones', () => {
    const fx = new SquareEffects(new Bin());
    const before = fx.group.children.length;
    for (let i = 0; i < 5; i++) {
      fx.set([block('e4', 'land'), block('e5', 'sea')]);
      fx.update(1, i);
      fx.set([]);
      fx.update(1, i + 0.5);
    }
    expect(fx.group.children.length).toBe(before);
  });
});
