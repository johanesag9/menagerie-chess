/**
 * Per-animal motion: idle loop, travel gait, attack, how it knocks a victim out, and celebration.
 * Offsets are in square units (the actor's object is scaled to the square size).
 * Bones: see animals/common.ts. A missing bone is harmless (its offset is just never applied).
 */
import * as THREE from 'three';
import type { PieceKind, Side } from '../contracts/types';
import type { Actor } from './actor';
import * as fx from './fx';

type TL = gsap.core.Timeline;
const PI = Math.PI;
const TAU = PI * 2;

export interface Gait {
  /** Travel time for `n` squares (before the move cap). */
  dur(n: number): number;
  /** Number of hop arcs for `n` squares. */
  hops(n: number): number;
  /** Hop height in squares. */
  height: number;
  ease?: string;
  /** Extra yaw while travelling (the crab walks sideways). */
  face?: number;
  /** Squash on each landing (0..0.4). */
  squash?: number;
  /** Anticipation squash before take-off (0 = none). */
  antic?: number;
  landIntensity?: number;
  /** Height multiplier per hop. */
  arc?(i: number, hops: number): number;
  /** Each time a hop lands (not the last). */
  step?(a: Actor, i: number): void;
  /** Every frame while travelling: k = path progress, f = progress within hop i. */
  frame?(a: Actor, k: number, f: number, i: number, hops: number): void;
  land?(a: Actor): void;
}

export type HitKind = 'launch' | 'pancake' | 'dizzy';

export interface Style {
  gait: Gait;
  /** How this attacker's victims leave the board. */
  hit: HitKind;
  /** Impact strength for the camera hook (0..1). */
  impact: number;
  /** Emote body energy (Land bouncier, Sea floatier). */
  energy: number;
  idle(a: Actor, t: number): void;
  /** Add the strike to `tl` from `at`; return the impact time. */
  attack(a: Actor, tl: TL, at: number, victim: Actor): number;
  /** Add the celebration to `tl` from `at`; return its end time. */
  celebrate(a: Actor, tl: TL, at: number): number;
}

// ---------- helpers ----------

function breathe(a: Actor, t: number, rate: number, amt: number) {
  const s = Math.sin(t * rate);
  const o = a.ib('body');
  o.sy *= 1 + s * amt;
  o.sx *= 1 - s * amt * 0.5;
  o.sz *= 1 - s * amt * 0.5;
}
/** Alternating leg swing for quadrupeds (each hop is half a stride). */
function stride(a: Actor, f: number, i: number, amp: number) {
  const s = Math.cos((i + f) * PI) * amp;
  a.b('legFL').rx = s; a.b('legBR').rx = s;
  a.b('legFR').rx = -s; a.b('legBL').rx = -s;
}
function tuck(a: Actor, amt: number) {
  a.b('legFL').rx = -amt; a.b('legFR').rx = -amt;
  a.b('legBL').rx = amt; a.b('legBR').rx = amt;
}
const yo = (tl: TL, o: object, vars: gsap.TweenVars, dur: number, at: number, repeat = 1, ease = 'sine.inOut') =>
  tl.to(o, { ...vars, duration: dur, yoyo: true, repeat, ease }, at);
const TENT = Array.from({ length: 8 }, (_, i) => {
  const ang = (i / 8) * TAU + PI / 8;
  return { dx: Math.sin(ang), dz: Math.cos(ang) };
});
/** Raise octopus tentacle i by theta (negative = press down). */
function liftVars(i: number, th: number) {
  return { rx: -th * TENT[i].dz, rz: th * TENT[i].dx };
}
function stomp(a: Actor, intensity: number) {
  a.emit('stomp', { id: a.id, at: a.worldPos(), intensity: a.rm ? 0 : intensity });
  fx.dust(a.fxParent, a.above(0), a.sq, 0.5 + intensity * 0.5);
}

// ---------- Land ----------

const dachshund: Style = {
  hit: 'launch', impact: 0.35, energy: 1.1,
  idle(a, t) {
    breathe(a, t, 2.6, 0.025);
    a.ib('tail1').ry = Math.sin(t * 11) * 0.6;
    a.ib('tail2').ry = Math.sin(t * 11 - 1) * 0.4;
    a.ib('earL').rz = Math.sin(t * 1.3) * 0.06;
    a.ib('earR').rz = -Math.sin(t * 1.3 + 0.4) * 0.06;
    a.ib('head').rz = Math.sin(t * 0.5) * 0.07;
  },
  gait: {
    dur: (n) => 0.28 * n + 0.32, hops: (n) => n * 3, height: 0.08, squash: 0.12,
    frame(a, _k, f, i) {
      stride(a, f, i, 0.65);
      const flap = Math.sin(f * PI) * 0.45;
      a.b('earL').rz = flap; a.b('earR').rz = -flap;
      a.b('tail1').ry = Math.sin((i + f) * PI * 2) * 0.7;
      a.b('head').rx = -Math.sin(f * PI) * 0.08;
    },
  },
  attack(a, tl, at) {
    const body = a.b('body'), base = a.b('base'), head = a.b('head');
    yo(tl, body, { ry: 0.25 }, 0.07, at, 3);
    tl.to(body, { sy: 0.82, sx: 1.1, sz: 1.1, duration: 0.25 }, at);
    tl.to(head, { rx: 0.15, duration: 0.2 }, at);
    a.b('tail1').ry = 0;
    yo(tl, a.b('tail1'), { ry: 0.8 }, 0.05, at, 5);
    const t1 = at + 0.3;
    tl.to(base, { pz: 0.4, duration: 0.16, ease: 'power2.in' }, t1);
    yo(tl, base, { py: 0.2 }, 0.08, t1, 1, 'power1.out');
    tl.to(body, { sy: 1.15, sx: 0.92, sz: 0.92, duration: 0.1 }, t1);
    tl.to(head, { rx: -0.25, duration: 0.1 }, t1);
    a.mouth('open', tl, t1);
    return t1 + 0.16;
  },
  celebrate(a, tl, at) {
    if (!a.rm) tl.to(a.object.rotation, { y: `+=${TAU}`, duration: 0.9, ease: 'power1.inOut' }, at);
    yo(tl, a.b('base'), { py: a.rm ? 0.05 : 0.16 }, 0.1, at, 7, 'power1.out');
    yo(tl, a.b('tail1'), { ry: 0.9 }, 0.05, at, 15);
    return at + 1.0;
  },
};

const horse: Style = {
  hit: 'launch', impact: 0.5, energy: 1,
  idle(a, t) {
    breathe(a, t, 1.8, 0.015);
    a.ib('tail1').rz = Math.sin(t * 1.7) * 0.25;
    a.ib('tail2').rz = Math.sin(t * 1.7 - 0.6) * 0.2;
    a.ib('earL').rx = Math.max(0, Math.sin(t * 0.9)) ** 12 * -0.5;
    a.ib('earR').rx = Math.max(0, Math.sin(t * 0.9 + 2)) ** 12 * -0.5;
    a.ib('neck').rx = Math.sin(t * 0.8) * 0.04;
    a.ib('legFR').rx = Math.max(0, Math.sin(t * 0.45)) ** 20 * -0.5;
  },
  // A real knight jump: one big leap over whatever is in the way.
  gait: {
    dur: () => 0.78, hops: () => 1, height: 1.1, squash: 0.3, antic: 0.2, landIntensity: 0.45, ease: 'power1.inOut',
    frame(a, k) {
      a.b('base').rx = -Math.cos(k * PI) * 0.35;
      tuck(a, Math.sin(k * PI) * 0.9);
      a.b('tail1').rx = -Math.sin(k * PI) * 0.7;
      a.b('neck').rx = Math.sin(k * TAU) * 0.15;
    },
    land(a) { fx.dust(a.fxParent, a.above(0), a.sq, 0.9); },
  },
  attack(a, tl, at) {
    const base = a.b('base'), neck = a.b('neck');
    tl.to(base, { rx: -0.55, duration: 0.25, ease: 'power2.out' }, at);
    tl.to(neck, { rx: -0.3, duration: 0.2 }, at);
    yo(tl, a.b('legFL'), { rx: -1.3 }, 0.1, at + 0.05, 3);
    yo(tl, a.b('legFR'), { rx: -1.3 }, 0.1, at + 0.1, 3);
    a.mouth('open', tl, at);
    const t1 = at + 0.46;
    tl.to(base, { rx: 0.22, pz: 0.3, duration: 0.13, ease: 'power3.in' }, t1);
    tl.to(neck, { rx: 0.15, duration: 0.13 }, t1);
    return t1 + 0.13;
  },
  celebrate(a, tl, at) {
    const base = a.b('base');
    yo(tl, base, { rx: a.rm ? -0.15 : -0.5 }, 0.22, at, 3);
    yo(tl, a.b('legFL'), { rx: -1.3 }, 0.1, at + 0.05, 7);
    yo(tl, a.b('legFR'), { rx: -1.3 }, 0.1, at + 0.1, 7);
    yo(tl, a.b('tail1'), { rz: 0.6 }, 0.1, at, 7);
    return at + 0.95;
  },
};

const goat: Style = {
  hit: 'launch', impact: 0.4, energy: 1.1,
  idle(a, t) {
    breathe(a, t, 2.0, 0.02);
    a.ib('beard').rz = Math.sin(t * 5) * 0.08;
    a.ib('head').rx = Math.sin(t * 5) * 0.025;
    a.ib('earL').rz = Math.sin(t * 1.1) * 0.12;
    a.ib('earR').rz = -Math.sin(t * 1.1 + 1) * 0.12;
    a.ib('tail1').rx = Math.max(0, Math.sin(t * 0.7)) ** 16 * -0.8;
  },
  gait: {
    dur: (n) => 0.24 * n + 0.28, hops: (n) => n, height: 0.45, squash: 0.2,
    frame(a, _k, f) {
      tuck(a, Math.sin(f * PI) * 0.7);
      a.b('base').rx = -Math.cos(f * PI) * 0.22;
      a.b('beard').rx = Math.cos(f * PI) * 0.3;
    },
  },
  attack(a, tl, at) {
    const base = a.b('base'), head = a.b('head'), body = a.b('body');
    tl.to(base, { pz: -0.22, duration: 0.22, ease: 'power2.out' }, at);
    tl.to(head, { rx: 0.45, duration: 0.2 }, at);
    tl.to(a.face, { brows: 1, duration: 0.1 }, at);
    yo(tl, a.b('legFR'), { rx: -0.5 }, 0.07, at + 0.06, 3);
    tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.5), [], at + 0.2);
    const t1 = at + 0.4;
    tl.to(base, { pz: 0.45, duration: 0.14, ease: 'power3.in' }, t1);
    tl.to(body, { sx: 0.9, sy: 0.95, sz: 1.15, duration: 0.14 }, t1);
    return t1 + 0.14;
  },
  celebrate(a, tl, at) {
    const base = a.b('base');
    for (let i = 0; i < 3; i++) {
      const t = at + i * 0.32;
      yo(tl, base, { py: a.rm ? 0.06 : 0.35 }, 0.16, t, 1, 'power2.out');
      if (!a.rm) yo(tl, base, { ry: i % 2 ? -0.5 : 0.5 }, 0.16, t);
    }
    return at + 1.0;
  },
};

const elephant: Style = {
  hit: 'launch', impact: 0.6, energy: 0.8,
  idle(a, t) {
    breathe(a, t, 1.4, 0.012);
    const e = Math.sin(t * 2.4) * 0.15;
    a.ib('earL').ry = e;
    a.ib('earR').ry = -e;
    a.ib('trunk1').rx = Math.sin(t * 1.3) * 0.15;
    a.ib('trunk2').rx = Math.sin(t * 1.3 - 0.6) * 0.2;
    a.ib('trunk3').rx = Math.sin(t * 1.3 - 1.2) * 0.3;
    a.ib('trunk1').rz = Math.sin(t * 0.9) * 0.12;
    a.ib('flag').ry = Math.sin(t * 4) * 0.5;
    a.ib('tail1').rz = Math.sin(t * 2) * 0.3;
  },
  // Heavy stomps: each footfall fires a 'stomp' event (camera shake hook).
  gait: {
    dur: (n) => 0.3 * n + 0.32, hops: (n) => n * 2, height: 0.05, squash: 0.1, landIntensity: 0.6, ease: 'none',
    step(a) { stomp(a, 0.5); },
    land(a) { stomp(a, 0.9); },
    frame(a, _k, f, i) {
      stride(a, f, i, 0.35);
      a.b('base').rz = Math.cos((i + f) * PI) * 0.05;
      a.b('trunk1').rz = Math.sin((i + f) * PI) * 0.25;
      a.b('earL').ry = -Math.sin(f * PI) * 0.2;
      a.b('earR').ry = Math.sin(f * PI) * 0.2;
    },
  },
  attack(a, tl, at, v) {
    const head = a.b('head');
    const tr = [a.b('trunk1'), a.b('trunk2'), a.b('trunk3')];
    tl.to(tr[0], { rx: -1.1, duration: 0.2 }, at);
    tl.to(tr[1], { rx: -0.7, duration: 0.2 }, at);
    tl.to(tr[2], { rx: -0.5, duration: 0.2 }, at);
    tl.to(head, { rx: -0.25, duration: 0.2 }, at);
    tl.to(a.b('earL'), { ry: -0.5, duration: 0.2 }, at);
    tl.to(a.b('earR'), { ry: 0.5, duration: 0.2 }, at);
    a.mouth('open', tl, at);
    yo(tl, a.b('base'), { rz: 0.04 }, 0.05, at + 0.08, 3);
    const t1 = at + 0.3;
    tl.to(tr[0], { rx: -0.45, duration: 0.1 }, t1);
    tl.to(tr[1], { rx: -0.3, duration: 0.1 }, t1);
    tl.to(tr[2], { rx: -0.2, duration: 0.1 }, t1);
    tl.to(head, { rx: 0, duration: 0.1 }, t1);
    const fly = 0.22;
    tl.call(() => fx.squirt(a.fxParent, a.bonePoint('trunk3'), v.object.parent ? v.bonePoint('head') : a.above(0.5), a.sq, fly), [], t1 + 0.08);
    return t1 + 0.08 + fly;
  },
  celebrate(a, tl, at) {
    const tr = [a.b('trunk1'), a.b('trunk2'), a.b('trunk3')];
    tl.to(tr[0], { rx: -1.3, duration: 0.25 }, at);
    tl.to(tr[1], { rx: -0.9, duration: 0.25 }, at);
    tl.to(tr[2], { rx: -0.6, duration: 0.25 }, at);
    yo(tl, a.b('earL'), { ry: -0.6 }, 0.12, at, 5);
    yo(tl, a.b('earR'), { ry: 0.6 }, 0.12, at, 5);
    tl.call(() => {
      const from = a.bonePoint('trunk3');
      fx.squirt(a.fxParent, from, from.clone().add(new THREE.Vector3(0, a.sq * 0.9, 0)), a.sq, 0.3);
    }, [], at + 0.3);
    for (let i = 0; i < 2; i++) {
      yo(tl, a.b('base'), { py: 0.08 }, 0.12, at + 0.5 + i * 0.25, 1, 'power2.out');
      tl.call(() => stomp(a, 0.5), [], at + 0.74 + i * 0.25);
    }
    return at + 1.1;
  },
};

const cat: Style = {
  hit: 'dizzy', impact: 0.35, energy: 0.9,
  idle(a, t) {
    breathe(a, t, 1.9, 0.02);
    a.ib('tail3').ry = Math.sin(t * 1.4) * 0.5;
    a.ib('tail2').ry = Math.sin(t * 1.4 - 0.5) * 0.2;
    a.ib('tail3').rx = Math.sin(t * 2.1) * 0.15;
    a.ib('earL').rz = Math.max(0, Math.sin(t * 0.7)) ** 14 * 0.4;
    a.ib('earR').rz = -(Math.max(0, Math.sin(t * 0.7 + 1.7)) ** 14) * 0.4;
    a.ib('head').rz = Math.sin(t * 0.4) * 0.08;
  },
  // Prowls low and smooth, then a little pounce to finish.
  gait: {
    dur: (n) => 0.3 * n + 0.35, hops: (n) => n * 2 + 1, height: 0.05, squash: 0.12, ease: 'sine.inOut',
    arc: (i, hops) => (i === hops - 1 ? 5 : 1),
    frame(a, k, f, i) {
      const s = Math.cos((i + f) * PI) * 0.5;
      a.b('pawL').rx = s; a.b('pawR').rx = -s;
      a.b('base').rz = Math.cos((i + f) * PI) * 0.06;
      a.b('body').sy = 0.9 + 0.1 * (k > 0.8 ? 1 : 0);
      a.b('tail1').rx = -0.4;
    },
  },
  attack(a, tl, at) {
    const base = a.b('base'), paw = a.b('pawR');
    tl.to(a.b('body'), { sy: 0.86, duration: 0.2 }, at);
    yo(tl, base, { rz: 0.07 }, 0.06, at, 3);
    tl.to(paw, { rx: -2.3, rz: -0.2, duration: 0.22, ease: 'back.out(2)' }, at + 0.05);
    tl.to(a.face, { brows: 1, blink: 0.3, duration: 0.1 }, at);
    a.mouth('o', tl, at);
    const t1 = at + 0.38;
    tl.to(paw, { rx: -0.7, duration: 0.08, ease: 'power3.in' }, t1);
    tl.to(base, { pz: 0.3, duration: 0.1, ease: 'power2.in' }, t1);
    return t1 + 0.08;
  },
  celebrate(a, tl, at) {
    const base = a.b('base');
    tl.to(a.b('body'), { sy: 0.82, duration: 0.12 }, at);
    tl.to(a.b('body'), { sy: 1, duration: 0.1 }, at + 0.12);
    yo(tl, base, { py: a.rm ? 0.06 : 0.55 }, 0.28, at + 0.12, 1, 'power2.out');
    if (!a.rm) tl.to(base, { rx: -TAU, duration: 0.56, ease: 'power1.inOut' }, at + 0.12);
    tl.to(a.b('tail1'), { rx: -0.9, duration: 0.2 }, at + 0.6);
    tl.to(a.face, { blink: 0.6, duration: 0.15 }, at + 0.7);
    a.mouth('smile', tl, at + 0.7);
    return at + 1.0;
  },
};

const pug: Style = {
  hit: 'pancake', impact: 0.55, energy: 1,
  idle(a, t) {
    breathe(a, t, 7.5, 0.012);
    a.ib('head').ry = Math.max(0, Math.sin(t * 0.6)) ** 30 * 0.25;
    a.ib('pawR').rx = Math.sin(t * 0.8) * 0.08;
    a.ib('earL').rz = Math.sin(t * 1.2) * 0.08;
    a.ib('earR').rz = -Math.sin(t * 1.2) * 0.08;
  },
  // Royal waddle: rocks side to side.
  gait: {
    dur: (n) => 0.3 * n + 0.32, hops: (n) => n * 3, height: 0.04, squash: 0.1,
    frame(a, _k, f, i) {
      const s = Math.cos((i + f) * PI);
      a.b('base').rz = s * 0.16;
      a.b('base').ry = s * 0.08;
      a.b('pawL').rx = s * 0.3; a.b('pawR').rx = -s * 0.3;
    },
  },
  attack(a, tl, at) {
    const base = a.b('base'), body = a.b('body');
    tl.to(body, { sy: 0.8, sx: 1.1, sz: 1.1, duration: 0.15 }, at);
    tl.to(a.face, { brows: 1, duration: 0.1 }, at);
    const t1 = at + 0.15;
    tl.to(body, { sy: 1.1, sx: 0.95, sz: 0.95, duration: 0.15 }, t1);
    tl.to(base, { py: a.rm ? 0.1 : 0.7, pz: 0.2, duration: 0.25, ease: 'power2.out' }, t1);
    a.mouth('open', tl, t1);
    const t2 = t1 + 0.25;
    tl.to(base, { py: 0, pz: 0.45, rx: 0.45, duration: 0.14, ease: 'power3.in' }, t2);
    tl.to(body, { sy: 0.75, sx: 1.2, sz: 1.2, duration: 0.06 }, t2 + 0.12);
    return t2 + 0.14;
  },
  celebrate(a, tl, at) {
    tl.to(a.b('pawR'), { rx: -2.4, duration: 0.2, ease: 'back.out(2)' }, at);
    yo(tl, a.b('base'), { py: a.rm ? 0.05 : 0.25 }, 0.15, at + 0.1, 3, 'power2.out');
    tl.call(() => fx.stars(a.fxParent, a.above(a.height), a.sq, 6, 0.4), [], at + 0.3);
    yo(tl, a.b('pawR'), { rz: 0.3 }, 0.12, at + 0.25, 5);
    return at + 1.0;
  },
};

// ---------- Sea ----------

const crab: Style = {
  hit: 'dizzy', impact: 0.3, energy: 0.9,
  idle(a, t) {
    breathe(a, t, 2.4, 0.02);
    a.ib('jawL').rx = Math.max(0, Math.sin(t * 3)) ** 3 * 0.5;
    a.ib('jawR').rx = Math.max(0, Math.sin(t * 3 + 2)) ** 3 * 0.5;
    a.ib('clawL').rx = Math.sin(t * 1.6) * 0.08;
    a.ib('clawR').rx = Math.sin(t * 1.6 + 1) * 0.08;
    a.ib('head').rz = Math.sin(t * 1.1) * 0.08;
    a.ib('base').px = Math.sin(t * 0.8) * 0.02;
    for (let i = 1; i <= 3; i++) {
      a.ib('legL' + i).rz = Math.sin(t * 4 + i) * 0.04;
      a.ib('legR' + i).rz = Math.sin(t * 4 + i + 1) * 0.04;
    }
  },
  // Scuttles sideways, tiny fast steps.
  gait: {
    dur: (n) => 0.26 * n + 0.3, hops: (n) => n * 5, height: 0.03, squash: 0.06, face: PI / 2, ease: 'none',
    frame(a, _k, f, i) {
      for (let j = 1; j <= 3; j++) {
        const s = Math.sin((i + f) * PI * 2 + j * 2) * 0.35;
        a.b('legL' + j).rz = s;
        a.b('legR' + j).rz = s;
      }
      a.b('clawL').rx = -0.35; a.b('clawR').rx = -0.35;
      a.b('head').rz = Math.sin((i + f) * PI) * 0.1;
    },
  },
  attack(a, tl, at) {
    const cl = a.b('clawL'), cr = a.b('clawR');
    tl.to(cl, { rx: -0.9, rz: 0.3, duration: 0.2, ease: 'back.out(2)' }, at);
    tl.to(cr, { rx: -0.9, rz: -0.3, duration: 0.2, ease: 'back.out(2)' }, at);
    yo(tl, a.b('jawL'), { rx: 0.5 }, 0.06, at + 0.1, 3);
    yo(tl, a.b('jawR'), { rx: 0.5 }, 0.06, at + 0.13, 3);
    tl.to(a.face, { brows: 1, duration: 0.1 }, at);
    const t1 = at + 0.42;
    tl.to(cr, { rx: -0.2, ry: 0.45, rz: 0, duration: 0.12, ease: 'power3.in' }, t1);
    tl.to(a.b('base'), { pz: 0.3, duration: 0.12, ease: 'power2.in' }, t1);
    tl.to(a.b('jawR'), { rx: 0.6, duration: 0.04 }, t1);
    tl.to(a.b('jawR'), { rx: 0, duration: 0.04 }, t1 + 0.08);
    return t1 + 0.12;
  },
  celebrate(a, tl, at) {
    yo(tl, a.b('clawL'), { ry: -0.6, rx: -0.6 }, 0.1, at, 9);
    yo(tl, a.b('clawR'), { ry: 0.6, rx: -0.6 }, 0.1, at, 9);
    yo(tl, a.b('base'), { px: 0.12 }, 0.2, at, 3);
    yo(tl, a.b('base'), { py: a.rm ? 0.03 : 0.1 }, 0.1, at, 7, 'power1.out');
    return at + 1.0;
  },
};

const seahorse: Style = {
  hit: 'launch', impact: 0.4, energy: 0.8,
  idle(a, t) {
    a.ib('body').py = Math.sin(t * 1.6) * 0.025;
    a.ib('base').rz = Math.sin(t * 1.1) * 0.03;
    a.ib('fin').ry = Math.sin(t * 14) * 0.35;
    a.ib('tail2').rx = Math.sin(t * 1.2) * 0.12;
    a.ib('tail3').rx = Math.sin(t * 1.2 - 0.7) * 0.2;
    a.ib('head').rx = Math.sin(t * 0.9) * 0.06;
    a.ib('finL').ry = Math.sin(t * 9) * 0.4;
    a.ib('finR').ry = -Math.sin(t * 9) * 0.4;
  },
  // Bobs through the air on a bubble trail.
  gait: {
    dur: (n) => 0.3 * n + 0.45, hops: () => 1, height: 0.55, squash: 0.06, antic: 0, ease: 'sine.inOut',
    frame(a, k, f) {
      const base = a.b('base');
      base.py += Math.sin(k * PI * 6) * 0.05 * Math.sin(f * PI);
      base.rx = Math.sin(k * PI) * 0.25;
      a.b('fin').ry = Math.sin(k * 60) * 0.5;
      a.b('tail1').rx = Math.sin(k * PI) * 0.35;
      if (Math.random() < 0.35) fx.trailBubble(a.fxParent, a.above(0.3 + base.py), a.sq);
    },
  },
  attack(a, tl, at) {
    const base = a.b('base');
    tl.to(base, { py: 0.25, duration: 0.2, ease: 'power2.out' }, at);
    a.mouth('o', tl, at);
    const t1 = at + 0.2;
    if (a.rm) yo(tl, base, { ry: 0.5 }, 0.15, t1);
    else tl.to(base, { ry: TAU, duration: 0.42, ease: 'power2.in' }, t1);
    tl.to(a.b('tail1'), { rx: 0.6, duration: 0.15 }, t1);
    tl.to(base, { pz: 0.3, duration: 0.3 }, t1);
    return t1 + 0.32;
  },
  celebrate(a, tl, at) {
    const base = a.b('base');
    tl.to(base, { py: 0.6, duration: 0.3, ease: 'power2.out' }, at);
    if (!a.rm) tl.to(base, { rx: -TAU, duration: 0.55, ease: 'power1.inOut' }, at + 0.2);
    tl.call(() => fx.bubbles(a.fxParent, a.above(0.8), a.sq, 8), [], at + 0.4);
    tl.to(base, { py: 0, duration: 0.3, ease: 'power2.in' }, at + 0.75);
    return at + 1.05;
  },
};

const puffer: Style = {
  hit: 'launch', impact: 0.45, energy: 0.8,
  idle(a, t) {
    const head = a.ib('head');
    head.py = Math.sin(t * 1.7) * 0.03;
    const p = 1 + Math.max(0, Math.sin(t * 0.6)) ** 10 * 0.14;
    head.sx = head.sy = head.sz = p;
    head.ry += Math.sin(t * 0.8) * 0.15;
    a.ib('finL').ry = Math.sin(t * 8) * 0.4;
    a.ib('finR').ry = -Math.sin(t * 8) * 0.4;
    a.ib('tailFin').ry = Math.sin(t * 5) * 0.3;
  },
  // Floats like a balloon with a wobble.
  gait: {
    dur: (n) => 0.28 * n + 0.38, hops: (n) => (n > 2.5 ? 2 : 1), height: 0.4, squash: 0.08, antic: 0, ease: 'sine.inOut',
    frame(a, k) {
      a.b('finL').ry = Math.sin(k * 70) * 0.6;
      a.b('finR').ry = -Math.sin(k * 70) * 0.6;
      a.b('base').rz = Math.sin(k * PI * 4) * 0.1;
      const h = a.b('head');
      h.sx = h.sy = h.sz = 1 + Math.sin(k * PI) * 0.08;
    },
  },
  attack(a, tl, at, v) {
    const head = a.b('head');
    tl.to(head, { sx: 1.45, sy: 1.45, sz: 1.45, duration: 0.3, ease: 'back.out(2)' }, at);
    tl.to(a.face, { eyeScale: 1.2, brows: 1, duration: 0.15 }, at);
    a.mouth('o', tl, at);
    yo(tl, a.b('base'), { rz: 0.05 }, 0.04, at + 0.28, 3);
    const t1 = at + 0.42;
    tl.to(a.b('base'), { pz: 0.42, duration: 0.12, ease: 'power3.in' }, t1);
    tl.call(() => fx.bubbles(a.fxParent, v.object.parent ? v.above(v.height * 0.5) : a.above(0.5), a.sq, 6), [], t1 + 0.12);
    return t1 + 0.12;
  },
  celebrate(a, tl, at) {
    const head = a.b('head');
    yo(tl, head, { sx: 1.5, sy: 1.5, sz: 1.5 }, 0.2, at, 3, 'back.out(2)');
    if (!a.rm) tl.to(a.b('base'), { ry: TAU, duration: 0.8, ease: 'power2.inOut' }, at);
    yo(tl, a.b('base'), { py: 0.2 }, 0.4, at, 1);
    tl.call(() => fx.bubbles(a.fxParent, a.above(0.6), a.sq, 8), [], at + 0.5);
    return at + 0.95;
  },
};

const turtle: Style = {
  hit: 'launch', impact: 0.55, energy: 0.6,
  idle(a, t) {
    breathe(a, t, 1.2, 0.01);
    const p = Math.sin(t * 2) * 0.25;
    a.ib('flipFL').rz = -p; a.ib('flipFR').rz = p;
    a.ib('flipBL').rz = p * 0.5; a.ib('flipBR').rz = -p * 0.5;
    a.ib('head').pz = Math.sin(t * 0.7) * 0.012;
    const l = a.ib('lamp');
    l.sx = l.sy = l.sz = 1 + Math.sin(t * 3) * 0.12;
    a.ib('tail1').ry = Math.sin(t * 1.5) * 0.3;
  },
  // Slides smoothly, paddling.
  gait: {
    dur: (n) => 0.3 * n + 0.38, hops: () => 1, height: 0.0, squash: 0.05, antic: 0.06, ease: 'power2.inOut',
    frame(a, k) {
      const p = Math.sin(k * 40) * 0.5;
      a.b('flipFL').rz = -p; a.b('flipFR').rz = p;
      a.b('flipBL').rz = p * 0.6; a.b('flipBR').rz = -p * 0.6;
      a.b('base').rx = Math.sin(k * PI) * 0.06;
      a.b('head').pz = Math.sin(k * PI) * 0.04;
      if (Math.random() < 0.12) fx.trailBubble(a.fxParent, a.above(0.05), a.sq);
    },
  },
  attack(a, tl, at) {
    const head = a.b('head');
    tl.to(head, { sx: 0.35, sy: 0.35, sz: 0.35, pz: -0.09, duration: 0.18 }, at);
    for (const f of ['flipFL', 'flipFR', 'flipBL', 'flipBR']) tl.to(a.b(f), { sx: 0.3, sy: 0.3, sz: 0.3, duration: 0.18 }, at);
    const t1 = at + 0.18;
    if (!a.rm) tl.to(a.b('base'), { ry: TAU, duration: 0.42, ease: 'power1.in' }, t1);
    const lamp = a.b('lamp');
    yo(tl, lamp, { sx: 1.7, sy: 1.7, sz: 1.7 }, 0.1, t1, 3);
    const t2 = t1 + 0.3;
    tl.to(a.b('base'), { pz: 0.45, duration: 0.14, ease: 'power2.in' }, t2);
    return t2 + 0.14;
  },
  celebrate(a, tl, at) {
    if (!a.rm) tl.to(a.b('base'), { ry: TAU * 1.5, duration: 0.95, ease: 'power2.inOut' }, at);
    yo(tl, a.b('lamp'), { sx: 1.8, sy: 1.8, sz: 1.8 }, 0.1, at, 9);
    yo(tl, a.b('flipFL'), { rz: -0.7 }, 0.12, at, 7);
    yo(tl, a.b('flipFR'), { rz: 0.7 }, 0.12, at, 7);
    tl.call(() => fx.bubbles(a.fxParent, a.above(0.3), a.sq, 6), [], at + 0.3);
    return at + 1.0;
  },
};

const octopus: Style = {
  hit: 'pancake', impact: 0.45, energy: 0.85,
  idle(a, t) {
    for (let i = 0; i < 8; i++) {
      const ph = t * 2.2 + i * 0.9;
      const oa = a.ib(`t${i}a`);
      oa.rx = Math.sin(ph) * 0.1;
      oa.rz = Math.cos(t * 1.9 + i * 1.3) * 0.1;
      a.ib(`t${i}b`).rx = Math.sin(ph - 0.7) * 0.15;
      a.ib(`t${i}c`).rx = Math.sin(ph - 1.4) * 0.25;
    }
    const h = a.ib('head');
    const s = Math.sin(t * 1.6);
    h.sy *= 1 + s * 0.03;
    h.sx *= 1 - s * 0.015;
    h.sz *= 1 - s * 0.015;
    h.rz += Math.sin(t * 0.6) * 0.05;
  },
  // Swings tentacle over tentacle.
  gait: {
    dur: (n) => 0.3 * n + 0.32, hops: (n) => n * 2, height: 0.12, squash: 0.15, ease: 'none',
    frame(a, _k, f, i) {
      for (let j = 0; j < 8; j++) {
        const up = (j + i) % 2 === 0 ? Math.sin(f * PI) * 0.7 : -Math.sin(f * PI) * 0.15;
        Object.assign(a.b(`t${j}a`), liftVars(j, up));
        a.b(`t${j}c`).rx = -up * 0.5;
      }
      a.b('base').rz = Math.cos((i + f) * PI) * 0.08;
      a.b('head').rx = 0.12;
    },
  },
  attack(a, tl, at, v) {
    tl.to(a.b('body'), { sy: 1.12, duration: 0.2 }, at);
    tl.to(a.b('base'), { py: 0.1, duration: 0.2 }, at);
    tl.to(a.face, { brows: 1, blink: 0.35, duration: 0.1 }, at);
    for (const i of [0, 7]) {
      tl.to(a.b(`t${i}a`), { ...liftVars(i, 1.4), duration: 0.25, ease: 'back.out(2)' }, at);
      tl.to(a.b(`t${i}b`), { rx: -0.6, duration: 0.25 }, at);
    }
    const t1 = at + 0.4;
    for (const i of [0, 7]) {
      tl.to(a.b(`t${i}a`), { ...liftVars(i, -0.3), duration: 0.08, ease: 'power3.in' }, t1);
      tl.to(a.b(`t${i}b`), { rx: 0.3, duration: 0.08 }, t1);
    }
    tl.to(a.b('base'), { pz: 0.32, py: 0, duration: 0.1 }, t1);
    tl.call(() => fx.ink(a.fxParent, v.object.parent ? v.above(v.height * 0.5) : a.above(0.5), a.sq), [], t1 + 0.08);
    return t1 + 0.08;
  },
  celebrate(a, tl, at) {
    const p = { k: 0 };
    tl.to(p, {
      k: 1, duration: 1.0, ease: 'none',
      onUpdate: () => {
        const env = Math.sin(p.k * PI);
        for (let j = 0; j < 8; j++) Object.assign(a.b(`t${j}a`), liftVars(j, (0.6 + Math.sin(p.k * 18 + j) * 0.5) * env));
      },
    }, at);
    if (!a.rm) tl.to(a.b('base'), { ry: TAU, duration: 1.0, ease: 'power1.inOut' }, at);
    yo(tl, a.b('base'), { py: 0.15 }, 0.25, at, 3);
    return at + 1.05;
  },
};

const blobfish: Style = {
  hit: 'pancake', impact: 0.6, energy: 0.7,
  idle(a, t) {
    const s = Math.sin(t * 3);
    const h = a.ib('head');
    h.sx = 1 + s * 0.035;
    h.sz = 1 + s * 0.035;
    h.sy = 1 - s * 0.05;
    a.ib('finL').rz = Math.sin(t * 1.5) * 0.2;
    a.ib('finR').rz = -Math.sin(t * 1.5) * 0.2;
  },
  // Jiggles along, very squishy.
  gait: {
    dur: (n) => 0.32 * n + 0.35, hops: (n) => n * 2, height: 0.07, squash: 0.28, ease: 'none',
    frame(a, _k, f) {
      const h = a.b('head');
      const w = Math.sin(f * TAU);
      h.sy = 1 + w * 0.14;
      h.sx = h.sz = 1 - w * 0.08;
      a.b('finL').rz = Math.sin(f * PI) * 0.5;
      a.b('finR').rz = -Math.sin(f * PI) * 0.5;
    },
  },
  attack(a, tl, at) {
    const head = a.b('head'), base = a.b('base');
    tl.to(head, { sy: 0.7, sx: 1.2, sz: 1.2, duration: 0.18 }, at);
    tl.to(a.face, { brows: 1, duration: 0.1 }, at);
    const t1 = at + 0.18;
    tl.to(base, { py: a.rm ? 0.1 : 0.65, pz: 0.25, duration: 0.22, ease: 'power2.out' }, t1);
    tl.to(head, { sy: 1.25, sx: 0.85, sz: 0.85, duration: 0.15 }, t1);
    const t2 = t1 + 0.22;
    tl.to(base, { py: 0, pz: 0.45, duration: 0.13, ease: 'power3.in' }, t2);
    tl.to(head, { sy: 0.55, sx: 1.45, sz: 1.45, duration: 0.06 }, t2 + 0.11);
    return t2 + 0.13;
  },
  celebrate(a, tl, at) {
    const head = a.b('head');
    yo(tl, head, { sy: 1.25, sx: 0.85, sz: 0.85 }, 0.1, at, 9);
    yo(tl, a.b('base'), { ry: a.rm ? 0.1 : 0.4 }, 0.2, at, 4);
    tl.call(() => fx.stars(a.fxParent, a.above(a.height), a.sq, 6, 0.4), [], at + 0.3);
    return at + 1.05;
  },
};

export const STYLES: Record<Side, Record<PieceKind, Style>> = {
  land: { p: dachshund, n: horse, b: goat, r: elephant, q: cat, k: pug },
  sea: { p: crab, n: seahorse, b: puffer, r: turtle, q: octopus, k: blobfish },
};
