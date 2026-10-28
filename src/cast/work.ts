/**
 * Phase 6 `work(kind, target)`: build (pat sand onto a neighbouring square) or dig (scoop sand off it), in each animal's style.
 * Stepping Stones reuses it: 'build' raises a stone out of the sea, 'dig' sinks one. With `water`, the sand lands in
 * (or the stone goes under) with a splash and bubbles instead of a sand pat.
 * A gesture plays in place, facing the target (the pup and seahorse turn their backs to it: they kick or flick sand behind them).
 * It returns `hit`: the moment the sand lands or leaves (the promise resolves then; integration calls world.setLevels).
 * Offsets are in square units, as in styles.ts. `to` is in the actor's parent space. Everything stays under about 1.2s.
 */
import * as THREE from 'three';
import type { Actor } from './actor';
import * as fx from './fx';

type TL = gsap.core.Timeline;
const PI = Math.PI;
const TAU = PI * 2;
export type WorkKind = 'build' | 'dig';

const yo = (tl: TL, o: object, vars: gsap.TweenVars, dur: number, at: number, repeat = 1, ease = 'sine.inOut') =>
  tl.to(o, { ...vars, duration: dur, yoyo: true, repeat, ease }, at);
const nearest = (from: number, to: number) => from + ((((to - from) % TAU) + TAU + PI) % TAU) - PI;

interface Ctx {
  kind: WorkKind;
  build: boolean;
  water: boolean;
  /** Target top, parent space. */
  to: THREE.Vector3;
  /** Flat unit direction from the animal to the target, parent space. */
  dir: THREE.Vector3;
  /** Amplitude: 1, or 0.4 under reduced motion. */
  k: number;
  rm: boolean;
}
interface Out {
  /** Sand lands (build) or leaves (dig). */
  hit: number;
  /** The pose can relax. */
  end: number;
  /** Build: sand is thrown from this bone (or point) at `release` and lands at `hit`. Without it, it pats down at `hit`. */
  from?: string | (() => THREE.Vector3);
  release?: number;
  /** Dig: which way the sand flies off the target. Default: all round. */
  fling?: 'away' | 'back' | 'side' | 'up';
}
interface Gesture {
  /** Turn its back to the target to work. */
  back?: (c: Ctx) => boolean;
  play(a: Actor, tl: TL, at: number, c: Ctx): Out;
}

// ---------- Land ----------

/** Pup: digs like mad with its front paws; dirt flies out behind. Building, it backs up to the square and kicks sand onto it. */
const pup: Gesture = {
  back: (c) => c.build,
  play(a, tl, at, c) {
    const base = a.b('base');
    tl.to(base, { rx: 0.32 * c.k, duration: 0.14, ease: 'power2.out' }, at);
    tl.to(a.b('tail1'), { rx: -0.6, duration: 0.14 }, at);
    yo(tl, a.b('tail1'), { ry: 0.8 }, 0.05, at, 11);
    tl.to(a.face, { eyeScale: 1.12, duration: 0.1 }, at);
    a.mouth('open', tl, at + 0.1);
    const dig = at + 0.12;
    yo(tl, a.b('legFL'), { rx: -1.1 * c.k }, 0.05, dig, 7);
    yo(tl, a.b('legFR'), { rx: -1.1 * c.k }, 0.05, dig + 0.05, 7);
    yo(tl, a.b('head'), { rx: 0.15 }, 0.06, dig, 5);
    const rear = () => a.above(0.12).add(a.forward().multiplyScalar(-0.25 * a.sq));
    if (c.build) {
      tl.call(() => fx.clods(a.fxParent, a.above(0), a.sq, 3, true, a.forward().negate()), [], dig + 0.12);
      return { from: rear, release: dig + 0.16, hit: dig + 0.4, end: dig + 0.62 };
    }
    tl.call(() => fx.clods(a.fxParent, a.above(0), a.sq, 4, true, c.dir.clone().negate()), [], dig + 0.32);
    return { hit: dig + 0.18, end: dig + 0.6, fling: 'back' };
  },
};

/** Horse: scrapes a front hoof twice, then flicks sand forward (build), or drags sand off the square toward itself (dig). */
const horse: Gesture = {
  play(a, tl, at, c) {
    const leg = a.b('legFR'), base = a.b('base');
    tl.to(a.b('neck'), { rx: 0.2 * c.k, duration: 0.15 }, at);
    if (c.build) {
      yo(tl, leg, { rx: -0.7 * c.k }, 0.075, at, 3);
      tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.35), [], at + 0.15);
      const t1 = at + 0.3;
      tl.to(leg, { rx: 0.5 * c.k, duration: 0.08, ease: 'power2.in' }, t1);
      tl.to(leg, { rx: -1.3 * c.k, duration: 0.1, ease: 'power3.out' }, t1 + 0.08);
      tl.to(base, { rx: -0.12 * c.k, duration: 0.1 }, t1 + 0.08);
      a.mouth('open', tl, t1 + 0.08);
      return { from: 'legFR', release: t1 + 0.12, hit: t1 + 0.32, end: t1 + 0.5 };
    }
    tl.to(base, { pz: 0.12 * c.k, rx: 0.1 * c.k, duration: 0.18, ease: 'power2.out' }, at);
    tl.to(leg, { rx: -1.2 * c.k, duration: 0.18, ease: 'power2.out' }, at);
    const t1 = at + 0.24;
    tl.to(leg, { rx: 0.6 * c.k, duration: 0.12, ease: 'power3.in' }, t1);
    tl.to(base, { pz: 0, rx: -0.05, duration: 0.14 }, t1);
    a.mouth('open', tl, t1);
    yo(tl, leg, { rx: -0.5 * c.k }, 0.08, t1 + 0.16, 1);
    return { hit: t1 + 0.1, end: t1 + 0.5, fling: 'back' };
  },
};

/** Goat: scoops sand with its horns and tosses it over with a head flick (build), or gouges it out with a horn jab (dig). */
const goat: Gesture = {
  play(a, tl, at, c) {
    const head = a.b('head'), base = a.b('base');
    tl.to(a.face, { brows: 0.8, duration: 0.1 }, at);
    if (c.build) {
      tl.to(head, { rx: 0.6 * c.k, duration: 0.16, ease: 'power2.out' }, at);
      tl.to(base, { rx: 0.12 * c.k, pz: -0.05, duration: 0.16 }, at);
      tl.call(() => fx.clods(a.fxParent, a.above(0), a.sq, 3, true), [], at + 0.16);
      const t1 = at + 0.24;
      tl.to(head, { rx: -0.5 * c.k, duration: 0.12, ease: 'power3.out' }, t1);
      tl.to(base, { rx: -0.08 * c.k, pz: 0, duration: 0.12 }, t1);
      yo(tl, a.b('beard'), { rx: 0.4 }, 0.06, t1, 3);
      a.mouth('open', tl, t1 + 0.05);
      return { from: 'head', release: t1 + 0.08, hit: t1 + 0.32, end: t1 + 0.55 };
    }
    tl.to(head, { rx: 0.55 * c.k, duration: 0.16 }, at);
    tl.to(base, { pz: -0.12 * c.k, duration: 0.18, ease: 'power2.out' }, at);
    yo(tl, a.b('legFR'), { rx: -0.6 * c.k }, 0.07, at + 0.04, 1);
    const t1 = at + 0.26;
    tl.to(base, { pz: 0.28 * c.k, duration: 0.1, ease: 'power3.in' }, t1);
    tl.to(base, { pz: 0, duration: 0.25, ease: 'power2.out' }, t1 + 0.12);
    tl.to(head, { rx: -0.3 * c.k, duration: 0.12 }, t1 + 0.1);
    if (!c.rm) yo(tl, head, { rz: 0.25 }, 0.06, t1 + 0.24, 3);
    return { hit: t1 + 0.1, end: t1 + 0.55, fling: 'up' };
  },
};

/** Elephant: sucks sand up from its feet and sprays it on with its trunk (build), or scoops it off and flings it over its head (dig). */
const elephant: Gesture = {
  play(a, tl, at, c) {
    const tr = [a.b('trunk1'), a.b('trunk2'), a.b('trunk3')];
    yo(tl, a.b('earL'), { ry: -0.4 }, 0.12, at, 3);
    yo(tl, a.b('earR'), { ry: 0.4 }, 0.12, at, 3);
    if (c.build) {
      tl.to(tr[0], { rx: 0.35 * c.k, duration: 0.18 }, at);
      tl.to(tr[2], { rx: 0.6 * c.k, duration: 0.18 }, at);
      tl.to(a.b('head'), { rx: 0.15 * c.k, duration: 0.18 }, at);
      tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.35), [], at + 0.16);
      const t1 = at + 0.26;
      tl.to(tr[0], { rx: -0.9 * c.k, duration: 0.14, ease: 'power2.out' }, t1);
      tl.to(tr[1], { rx: -0.6 * c.k, duration: 0.14 }, t1);
      tl.to(tr[2], { rx: -0.4 * c.k, duration: 0.14 }, t1);
      tl.to(a.b('head'), { rx: -0.1 * c.k, duration: 0.14 }, t1);
      a.mouth('open', tl, t1);
      return { from: 'trunk3', release: t1 + 0.12, hit: t1 + 0.36, end: t1 + 0.6 };
    }
    tl.to(tr[0], { rx: -0.45 * c.k, duration: 0.18 }, at);
    tl.to(tr[1], { rx: -0.2 * c.k, duration: 0.18 }, at);
    tl.to(a.b('base'), { pz: 0.08 * c.k, rx: 0.08 * c.k, duration: 0.18 }, at);
    const t1 = at + 0.2;
    tl.to(tr[2], { rx: 0.9 * c.k, duration: 0.1 }, t1);
    const t2 = t1 + 0.12;
    tl.to(tr[0], { rx: -1.3 * c.k, duration: 0.16, ease: 'power3.out' }, t2);
    tl.to(tr[1], { rx: -0.8 * c.k, duration: 0.16 }, t2);
    tl.to(a.b('base'), { pz: 0, rx: -0.1 * c.k, duration: 0.16 }, t2);
    a.mouth('open', tl, t2);
    // The trunkful lands behind it.
    tl.call(() => fx.clods(a.fxParent, a.above(0), a.sq, 4, true, c.dir.clone().negate()), [], t2 + 0.3);
    return { hit: t2 + 0.04, end: t2 + 0.5, fling: 'back' };
  },
};

/** Cat: bats sand over with quick paw swats (build), or rakes it off like a litter box (dig). */
const cat: Gesture = {
  play(a, tl, at, c) {
    const L = a.b('pawL'), R = a.b('pawR');
    tl.to(a.b('body'), { sy: 0.88, duration: 0.14 }, at);
    yo(tl, a.b('tail3'), { ry: 0.7 }, 0.08, at, 5);
    tl.to(a.face, { blink: 0.35, duration: 0.1 }, at);
    if (c.build) {
      a.mouth('o', tl, at);
      for (const [p, t] of [[L, at + 0.08], [R, at + 0.24]] as const) {
        tl.to(p, { rx: -1.6 * c.k, duration: 0.08, ease: 'power2.out' }, t);
        tl.to(p, { rx: -0.3 * c.k, duration: 0.07, ease: 'power3.in' }, t + 0.08);
      }
      tl.call(() => fx.toss(a.fxParent, a.bonePoint('pawL'), c.to, a.sq, 0.2, 3), [], at + 0.16);
      return { from: 'pawR', release: at + 0.32, hit: at + 0.52, end: at + 0.75 };
    }
    for (let i = 0; i < 4; i++) {
      const p = i % 2 ? R : L, t = at + 0.06 + i * 0.1;
      tl.to(p, { rx: -1.4 * c.k, duration: 0.05, ease: 'power2.out' }, t);
      tl.to(p, { rx: 0.4 * c.k, duration: 0.05, ease: 'power3.in' }, t + 0.05);
    }
    tl.call(() => fx.clods(a.fxParent, c.to, a.sq, 3, true, c.dir.clone().negate()), [], at + 0.36);
    tl.to(a.face, { blink: 0.55, duration: 0.15 }, at + 0.5);
    return { hit: at + 0.28, end: at + 0.7, fling: 'back' };
  },
};

/** Pug: scoops with both paws and heaves it over (build), or scrabbles clumsily and ends with a sneeze (dig). */
const pug: Gesture = {
  play(a, tl, at, c) {
    const L = a.b('pawL'), R = a.b('pawR'), base = a.b('base');
    tl.to(a.face, { brows: 0.6, duration: 0.1 }, at);
    if (c.build) {
      tl.to(base, { rx: 0.2 * c.k, duration: 0.15 }, at);
      tl.to(L, { rx: -0.3, duration: 0.15 }, at);
      tl.to(R, { rx: -0.3, duration: 0.15 }, at);
      const t1 = at + 0.2;
      tl.to(base, { rx: -0.15 * c.k, py: 0.05 * c.k, duration: 0.14, ease: 'power2.out' }, t1);
      tl.to(L, { rx: -2.2 * c.k, duration: 0.14, ease: 'back.out(2)' }, t1);
      tl.to(R, { rx: -2.2 * c.k, duration: 0.14, ease: 'back.out(2)' }, t1);
      tl.to(base, { py: 0, rx: 0, duration: 0.15, ease: 'power2.in' }, t1 + 0.16);
      a.mouth('open', tl, t1);
      yo(tl, base, { rz: 0.1 * c.k }, 0.1, t1 + 0.4, 1);
      return { from: 'pawR', release: t1 + 0.1, hit: t1 + 0.34, end: t1 + 0.62 };
    }
    for (let i = 0; i < 5; i++) {
      const p = i % 2 ? R : L, t = at + 0.04 + i * 0.08;
      tl.to(p, { rx: -1.3 * c.k, duration: 0.04 }, t);
      tl.to(p, { rx: -0.2, duration: 0.04 }, t + 0.04);
    }
    yo(tl, base, { rz: 0.08 * c.k }, 0.08, at, 3);
    // Achoo.
    const t2 = at + 0.5;
    tl.to(a.b('head'), { rx: -0.25 * c.k, duration: 0.12 }, t2);
    tl.to(a.face, { blink: 1, duration: 0.1 }, t2);
    tl.to(a.b('head'), { rx: 0.2 * c.k, duration: 0.06, ease: 'power3.in' }, t2 + 0.14);
    a.mouth('o', tl, t2 + 0.14);
    tl.call(() => fx.dust(a.fxParent, a.bonePoint('head').addScaledVector(c.dir, 0.2 * a.sq), a.sq, 0.35), [], t2 + 0.2);
    return { hit: at + 0.3, end: t2 + 0.38, fling: 'side' };
  },
};

// ---------- Sea ----------

/** Crab: pinches up two clawfuls and lobs them over (build), or snips the sand away, claw after claw (dig). */
const crab: Gesture = {
  play(a, tl, at, c) {
    const L = a.b('clawL'), R = a.b('clawR');
    tl.to(a.face, { brows: 0.6, duration: 0.1 }, at);
    if (c.build) {
      tl.to(L, { rx: 0.5 * c.k, duration: 0.14 }, at);
      tl.to(R, { rx: 0.5 * c.k, duration: 0.14 }, at);
      yo(tl, a.b('jawL'), { rx: 0.5 }, 0.05, at + 0.06, 3);
      yo(tl, a.b('jawR'), { rx: 0.5 }, 0.05, at + 0.08, 3);
      const t1 = at + 0.26;
      tl.to(L, { rx: -1.0 * c.k, duration: 0.12, ease: 'power3.out' }, t1);
      tl.to(R, { rx: -1.0 * c.k, duration: 0.12, ease: 'power3.out' }, t1);
      tl.to(a.b('base'), { rx: -0.1 * c.k, duration: 0.12 }, t1);
      return { from: 'clawR', release: t1 + 0.08, hit: t1 + 0.3, end: t1 + 0.55 };
    }
    for (let i = 0; i < 4; i++) {
      const p = i % 2 ? R : L, t = at + 0.05 + i * 0.1;
      tl.to(p, { rx: -0.7 * c.k, duration: 0.05 }, t);
      tl.to(p, { rx: 0.4 * c.k, duration: 0.05, ease: 'power3.in' }, t + 0.05);
    }
    tl.call(() => fx.clods(a.fxParent, c.to, a.sq, 3, true), [], at + 0.4);
    tl.to(a.b('base'), { rx: 0.1 * c.k, duration: 0.15 }, at);
    return { hit: at + 0.2, end: at + 0.65, fling: 'side' };
  },
};

/** Seahorse: turns its back, curls its tail and flicks sand over (build), or swishes it off the square (dig). */
const seahorse: Gesture = {
  back: () => true,
  play(a, tl, at, c) {
    const base = a.b('base'), t1b = a.b('tail1'), t2b = a.b('tail2'), t3b = a.b('tail3');
    tl.to(base, { py: 0.1 * c.k, rx: 0.15 * c.k, duration: 0.2, ease: 'power2.out' }, at);
    tl.to(t2b, { rx: 0.7 * c.k, duration: 0.2 }, at);
    tl.to(t3b, { rx: 0.8 * c.k, duration: 0.2 }, at);
    yo(tl, a.b('fin'), { ry: 0.6 }, 0.04, at, 9);
    a.mouth('o', tl, at);
    const t1 = at + 0.24;
    if (c.build) {
      tl.to(t1b, { rx: -0.8 * c.k, duration: 0.1, ease: 'power3.out' }, t1);
      tl.to(t2b, { rx: -0.5 * c.k, duration: 0.1 }, t1);
      tl.to(t3b, { rx: -0.6 * c.k, duration: 0.1 }, t1);
      tl.to(base, { py: 0, rx: 0, duration: 0.3, ease: 'power2.inOut' }, t1 + 0.12);
      return { from: 'tail3', release: t1 + 0.06, hit: t1 + 0.28, end: t1 + 0.5 };
    }
    yo(tl, t1b, { ry: 0.7 * c.k }, 0.07, t1, 3);
    tl.to(t3b, { rx: -0.6 * c.k, duration: 0.1 }, t1);
    tl.call(() => fx.bubbles(a.fxParent, a.above(0.15), a.sq, 3, 0.5), [], t1);
    tl.to(base, { py: 0, rx: 0, duration: 0.3, ease: 'power2.inOut' }, t1 + 0.24);
    return { hit: t1 + 0.1, end: t1 + 0.5, fling: 'away' };
  },
};

/** Pufferfish: puffs up, then blows a jet that carries sand over (build) or blasts it off the square (dig). */
const puffer: Gesture = {
  play(a, tl, at, c) {
    const head = a.b('head'), base = a.b('base');
    const big = c.rm ? 1.15 : 1.4;
    tl.to(head, { sx: big, sy: big, sz: big, duration: 0.24, ease: 'back.out(2)' }, at);
    tl.to(a.face, { eyeScale: 1.2, duration: 0.12 }, at);
    a.mouth('o', tl, at);
    const t1 = at + 0.28;
    tl.to(head, { sx: 0.92, sy: 0.92, sz: 0.92, duration: 0.14, ease: 'power2.in' }, t1);
    tl.to(head, { sx: 1, sy: 1, sz: 1, duration: 0.35, ease: 'elastic.out(1, 0.4)' }, t1 + 0.14);
    tl.to(base, { pz: -0.08 * c.k, duration: 0.1, ease: 'power2.out' }, t1);
    tl.to(base, { pz: 0, duration: 0.25 }, t1 + 0.12);
    yo(tl, a.b('finL'), { ry: 0.7 }, 0.04, at, 9);
    yo(tl, a.b('finR'), { ry: -0.7 }, 0.04, at, 9);
    const mouth = () => a.bonePoint('head').addScaledVector(c.dir, 0.22 * a.sq);
    // The jet: a stream of bubbles from the mouth to the square.
    tl.call(() => {
      const from = mouth();
      for (let i = 0; i < 3; i++) fx.bubbles(a.fxParent, from.clone().lerp(c.to, i / 3), a.sq, 1, 0.3);
    }, [], t1 + 0.02);
    if (c.build) return { from: mouth, release: t1 + 0.02, hit: t1 + 0.22, end: t1 + 0.5 };
    tl.call(() => fx.bubbles(a.fxParent, c.to, a.sq, 3, 0.5), [], t1 + 0.14);
    return { hit: t1 + 0.14, end: t1 + 0.5, fling: 'away' };
  },
};

/** Turtle: sweeps sand over with both front flippers (build), or scoops it away, flipper after flipper (dig). */
const turtle: Gesture = {
  play(a, tl, at, c) {
    const L = a.b('flipFL'), R = a.b('flipFR');
    tl.to(a.b('head'), { pz: 0.04, duration: 0.16 }, at);
    if (c.build) {
      tl.to(L, { rz: 0.8 * c.k, duration: 0.18 }, at);
      tl.to(R, { rz: -0.8 * c.k, duration: 0.18 }, at);
      tl.to(a.b('base'), { rx: -0.08 * c.k, duration: 0.18 }, at);
      const t1 = at + 0.24;
      tl.to(L, { rz: -0.6 * c.k, rx: -0.4 * c.k, duration: 0.13, ease: 'power3.out' }, t1);
      tl.to(R, { rz: 0.6 * c.k, rx: -0.4 * c.k, duration: 0.13, ease: 'power3.out' }, t1);
      tl.to(a.b('base'), { rx: 0.08 * c.k, duration: 0.13 }, t1);
      a.mouth('open', tl, t1);
      yo(tl, a.b('lamp'), { sx: 1.5, sy: 1.5, sz: 1.5 }, 0.08, t1 + 0.3, 1);
      return { from: 'flipFR', release: t1 + 0.1, hit: t1 + 0.34, end: t1 + 0.6 };
    }
    for (let i = 0; i < 3; i++) {
      const p = i % 2 ? R : L, s = i % 2 ? -1 : 1, t = at + 0.06 + i * 0.13;
      tl.to(p, { rx: -0.8 * c.k, rz: -0.4 * s * c.k, duration: 0.07 }, t);
      tl.to(p, { rx: 0.3 * c.k, rz: 0.6 * s * c.k, duration: 0.06, ease: 'power3.in' }, t + 0.07);
    }
    tl.to(a.b('base'), { rx: 0.1 * c.k, duration: 0.15 }, at);
    tl.call(() => fx.clods(a.fxParent, c.to, a.sq, 3, true), [], at + 0.45);
    return { hit: at + 0.2, end: at + 0.65, fling: 'side' };
  },
};

const TENT = Array.from({ length: 8 }, (_, i) => {
  const ang = (i / 8) * TAU + PI / 8;
  return { dx: Math.sin(ang), dz: Math.cos(ang) };
});
const lift8 = (i: number, th: number) => ({ rx: -th * TENT[i].dz, rz: th * TENT[i].dx });

/** Octopus: two tentacles slap sandfuls onto the square (build), or four reach out and yank the sand away (dig). */
const octopus: Gesture = {
  play(a, tl, at, c) {
    tl.to(a.b('head'), { sy: 1.08, duration: 0.18 }, at);
    tl.to(a.face, { blink: 0.3, brows: 0.5, duration: 0.1 }, at);
    if (c.build) {
      for (const [i, t] of [[0, at], [7, at + 0.12]] as const) {
        tl.to(a.b(`t${i}a`), { ...lift8(i, 1.3 * c.k), duration: 0.16, ease: 'back.out(2)' }, t);
        tl.to(a.b(`t${i}c`), { rx: 0.8 * c.k, duration: 0.16 }, t);
        tl.to(a.b(`t${i}a`), { ...lift8(i, -0.2), duration: 0.1, ease: 'power3.in' }, t + 0.22);
        tl.to(a.b(`t${i}c`), { rx: -0.2, duration: 0.1 }, t + 0.22);
      }
      tl.call(() => fx.toss(a.fxParent, a.bonePoint('t0c'), c.to, a.sq, 0.16, 3), [], at + 0.24);
      a.mouth('open', tl, at + 0.3);
      return { from: 't7c', release: at + 0.36, hit: at + 0.52, end: at + 0.75 };
    }
    const F = [0, 7, 1, 6];
    for (const i of F) {
      tl.to(a.b(`t${i}a`), { ...lift8(i, 1.1 * c.k), duration: 0.18, ease: 'back.out(2)' }, at);
      tl.to(a.b(`t${i}c`), { rx: 0.7 * c.k, duration: 0.18 }, at);
      tl.to(a.b(`t${i}a`), { ...lift8(i, -0.4 * c.k), duration: 0.12, ease: 'power3.in' }, at + 0.26);
      tl.to(a.b(`t${i}c`), { rx: -0.3, duration: 0.12 }, at + 0.26);
    }
    tl.to(a.b('base'), { pz: -0.06 * c.k, duration: 0.12 }, at + 0.26);
    a.mouth('o', tl, at + 0.26);
    return { hit: at + 0.32, end: at + 0.65, fling: 'up' };
  },
};

/** Blobfish: hops and belly-flops at the square: the splat throws a pile onto it (build), or splats the sand out of it (dig). */
const blobfish: Gesture = {
  play(a, tl, at, c) {
    const head = a.b('head'), base = a.b('base');
    yo(tl, head, { sy: 0.85, sx: 1.1, sz: 1.1 }, 0.07, at, 1);
    tl.to(a.face, { brows: 0.6, duration: 0.1 }, at);
    const flop = (t: number, h: number) => {
      tl.to(base, { py: h * c.k, pz: 0.16 * c.k, rx: 0.35 * c.k, duration: 0.16, ease: 'power2.out' }, t);
      tl.to(head, { sy: 1.2, sx: 0.88, sz: 0.88, duration: 0.14 }, t);
      tl.to(base, { py: 0, duration: 0.1, ease: 'power3.in' }, t + 0.16);
      tl.to(head, { sy: c.rm ? 0.85 : 0.55, sx: 1.4, sz: 1.4, duration: 0.05, ease: 'power3.out' }, t + 0.25);
      tl.to(head, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.35)' }, t + 0.3);
      tl.call(() => fx.dust(a.fxParent, a.above(0).addScaledVector(c.dir, 0.25 * a.sq), a.sq, 0.4), [], t + 0.26);
      return t + 0.26;
    };
    const t1 = flop(at + 0.14, 0.3);
    tl.to(a.face, { blink: 1, duration: 0.05 }, t1);
    a.mouth('o', tl, t1);
    tl.to(base, { pz: 0, rx: 0, duration: 0.3, ease: 'power2.out' }, t1 + 0.15);
    if (c.build) return { from: () => a.above(0.05).addScaledVector(c.dir, 0.3 * a.sq), release: t1, hit: t1 + 0.14, end: t1 + 0.5 };
    return { hit: t1, end: t1 + 0.5 };
  },
};

const GESTURE = {
  land: { p: pup, n: horse, b: goat, r: elephant, q: cat, k: pug },
  sea: { p: crab, n: seahorse, b: puffer, r: turtle, q: octopus, k: blobfish },
} as const;

/** Add the work to `tl` from 0. `to` = target top (parent space). Returns when the sand lands or leaves, and when the pose can relax. */
export function work(a: Actor, tl: TL, kind: WorkKind, to: THREE.Vector3, water: boolean): { hit: number; end: number } {
  const g: Gesture = GESTURE[a.side][a.kind];
  const rm = a.rm, P = a.fxParent, sq = a.sq;
  const flat = to.clone().sub(a.object.position).setY(0);
  const dir = flat.lengthSq() > 1e-6 ? flat.clone().normalize() : a.forward();
  const c: Ctx = { kind, build: kind === 'build', water, to, dir, k: rm ? 0.4 : 1, rm };
  const back = g.back?.(c) ?? false;
  // Face the square (or turn its back to it).
  const y0 = a.object.rotation.y;
  const yaw = flat.lengthSq() > 1e-6 ? nearest(y0, Math.atan2(dir.x, dir.z) + (back ? PI : 0)) : y0;
  tl.to(a.object.rotation, { y: yaw, duration: rm ? 0.12 : back ? 0.24 : 0.16, ease: 'power2.inOut' }, 0);
  let at = rm ? 0.1 : back ? 0.2 : 0.12;
  // Lean a little toward a lower square, back from a higher one.
  if (!back) {
    const up = (to.y - a.object.position.y) / sq;
    tl.to(a.b('body'), { rx: THREE.MathUtils.clamp(-up * 0.35, -0.25, 0.25) * c.k, duration: 0.2, ease: 'power2.out' }, at * 0.5);
  }
  const o = g.play(a, tl, at, c);
  // Build: the sand flies over and lands.
  if (c.build && o.from !== undefined && o.release !== undefined) {
    const from = o.from, flight = Math.max(0.08, o.hit - o.release);
    tl.call(() => fx.toss(P, typeof from === 'string' ? a.bonePoint(from) : from(), to, sq, flight), [], o.release);
  }
  tl.call(() => {
    if (c.build) {
      if (water) {
        fx.splash(P, to, sq, 12);
        fx.bubbles(P, to, sq, 4, 0.5);
      } else {
        fx.mound(P, to, sq, 0.18, true);
        fx.dust(P, to, sq, 0.45);
        fx.clods(P, to, sq, 3, true);
      }
      return;
    }
    const f = o.fling;
    const d = f === 'away' ? dir.clone()
      : f === 'back' ? dir.clone().negate()
      : f === 'side' ? new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1)
      : undefined;
    fx.clods(P, to, sq, f === 'up' ? 9 : 7, true, d);
    fx.dust(P, to, sq, 0.35);
    if (water) {
      fx.splash(P, to, sq, 10);
      fx.bubbles(P, to, sq, 5, 0.6);
    }
  }, [], o.hit);
  at = Math.max(o.end, o.hit + 0.15);
  // Turn back to the home facing as it relaxes.
  tl.to(a.object.rotation, { y: nearest(yaw, a.homeYaw()), duration: back ? 0.4 : 0.32, ease: 'power2.inOut' }, at - 0.1);
  return { hit: o.hit, end: at };
}
