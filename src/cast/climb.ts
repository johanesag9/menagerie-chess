/**
 * Phase 6 'climb' travel: a hop up onto a higher sand tier, or a drop down off one (with a bounce on landing).
 * `to.y` carries the new height. Each animal climbs in character; the Climbers (goat, pufferfish) bound up 2 with flair.
 * `ledge()` is the shared path (also used by 'pushed' when the victim drops down tiers).
 * Offsets are in square units, as in styles.ts. Everything stays under about 1.2s.
 */
import * as THREE from 'three';
import type { Actor } from './actor';
import type { Leg } from './travels';
import * as fx from './fx';

type TL = gsap.core.Timeline;
const PI = Math.PI;
const TAU = PI * 2;
/** About one sand level, in squares (the world's tier height). Only used to count levels for timing and flair. */
export const LEVEL = 0.28;

const yo = (tl: TL, o: object, vars: gsap.TweenVars, dur: number, at: number, repeat = 1, ease = 'sine.inOut') =>
  tl.to(o, { ...vars, duration: dur, yoyo: true, repeat, ease }, at);
const smooth = (k: number) => k * k * (3 - 2 * k);
/** The value nearest `from` that faces the same way as `to`. */
const nearest = (from: number, to: number) => from + ((((to - from) % TAU) + TAU + PI) % TAU) - PI;

/**
 * Move the object from where it is now to `to` across a height change, over `dur`, peaking `lift` squares above the higher top.
 * Going up it rises first, then moves over (it clears the tier edge). Going down it hops off the edge, then falls
 * (gravity: faster and faster). The same height is a plain arc. `frame(k)` runs every update. Returns the arrival time.
 */
export function ledge(a: Actor, tl: TL, at: number, to: THREE.Vector3, dur: number, lift: number, frame?: (k: number) => void): number {
  const from = a.object.position.clone();
  const dy = to.y - from.y;
  const L = lift * a.sq;
  const up = dy >= 0;
  const p = { k: 0 };
  const kp = up ? 0.55 : 0.4;
  tl.to(p, {
    k: 1, duration: dur, ease: 'none',
    onUpdate: () => {
      const k = p.k;
      const h = up ? smooth(k) : k;
      a.object.position.x = from.x + (to.x - from.x) * h;
      a.object.position.z = from.z + (to.z - from.z) * h;
      let y: number;
      if (up) {
        // Decelerating rise to the peak, then settle onto the top.
        if (k < kp) { const u = 1 - k / kp; y = from.y + (dy + L) * (1 - u * u); }
        else { const u = (k - kp) / (1 - kp); y = from.y + dy + L * (1 - u * u); }
      } else {
        // A little hop off the edge, then fall.
        if (k < kp) { y = from.y + L * Math.sin((PI / 2) * (k / kp)); }
        else { const u = (k - kp) / (1 - kp); y = from.y + L - (L - dy) * u * u; }
      }
      a.object.position.y = y;
      frame?.(k);
    },
  }, at);
  tl.call(() => { a.object.position.copy(to); }, [], at + dur);
  return at + dur;
}

// ---------- per-animal climbs ----------

interface Ctx {
  /** Height change in squares (+ up). */
  dy: number;
  /** Levels climbed (about), always >= 0. */
  lv: number;
  up: boolean;
  /** A Climber bounding up 2 or more. */
  flair: boolean;
  rm: boolean;
}
interface Climb {
  /** Flight time for one level, and extra per level. */
  dur: number;
  per: number;
  /** Clearance above the higher top, in squares. */
  lift: number;
  /** Extra yaw while climbing (the crab scrambles sideways). */
  face?: number;
  land: number;
  /** Wind-up before take-off; returns the take-off time. Default: a quick crouch. */
  pre?(a: Actor, tl: TL, at: number, c: Ctx): number;
  /** Pose during the flight (k = 0..1). */
  frame?(a: Actor, k: number, c: Ctx): void;
  /** After landing; returns when the pose can relax. */
  after?(a: Actor, tl: TL, at: number, c: Ctx): number;
  /** Bigger numbers for the Climbers' flair climb. */
  flair?: Partial<Pick<Climb, 'dur' | 'per' | 'lift'>>;
}

function crouch(a: Actor, tl: TL, at: number, amt: number, dur = 0.12) {
  const body = a.b('body');
  tl.to(body, { sy: 1 - amt, sx: 1 + amt * 0.5, sz: 1 + amt * 0.5, duration: dur, ease: 'power2.out' }, at);
  tl.to(body, { sy: 1 + amt * 0.4, sx: 1 - amt * 0.2, sz: 1 - amt * 0.2, duration: 0.1, ease: 'power2.out' }, at + dur);
  return at + dur;
}
function legs4(a: Actor, f: number, b: number) {
  a.b('legFL').rx = f; a.b('legFR').rx = f;
  a.b('legBL').rx = b; a.b('legBR').rx = b;
}

const pup: Climb = {
  dur: 0.4, per: 0.1, lift: 0.14, land: 0.2,
  // Front paws reach up the ledge, tail going.
  pre(a, tl, at, c) {
    if (c.up) {
      tl.to(a.b('base'), { rx: -0.3, duration: 0.12, ease: 'power2.out' }, at);
      tl.to(a.b('legFL'), { rx: -1.1, duration: 0.12 }, at);
      tl.to(a.b('legFR'), { rx: -0.9, duration: 0.12 }, at + 0.03);
      a.mouth('open', tl, at);
    }
    yo(tl, a.b('tail1'), { ry: 0.8 }, 0.05, at, 3);
    return crouch(a, tl, at + 0.05, 0.14, 0.1);
  },
  // Back legs scrabble, ears flap.
  frame(a, k, c) {
    const s = Math.sin(k * PI * 8) * 0.7;
    a.b('legBL').rx = 0.5 + s; a.b('legBR').rx = 0.5 - s;
    a.b('legFL').rx = c.up ? -1.1 + k * 1.1 : -0.4;
    a.b('legFR').rx = c.up ? -0.9 + k * 0.9 : -0.4;
    a.b('base').rx = c.up ? -0.3 + k * 0.3 : Math.sin(k * PI) * 0.25;
    const flap = Math.sin(k * PI) * (c.up ? 0.4 : 0.9);
    a.b('earL').rz = flap; a.b('earR').rz = -flap;
  },
  after(a, tl, at) {
    yo(tl, a.b('tail1'), { ry: 0.8 }, 0.05, at, 7);
    return at + 0.3;
  },
};

const horse: Climb = {
  dur: 0.42, per: 0.1, lift: 0.2, land: 0.35,
  pre(a, tl, at) {
    tl.to(a.b('neck'), { rx: -0.25, duration: 0.12 }, at);
    return crouch(a, tl, at, 0.2, 0.12);
  },
  // A neat bound: legs tucked, nose up then down.
  frame(a, k) {
    a.b('base').rx = -Math.cos(k * PI) * 0.3;
    const t = Math.sin(k * PI) * 0.9;
    legs4(a, -t, t);
    a.b('tail1').rx = -Math.sin(k * PI) * 0.6;
    a.b('neck').rx = -0.25 + k * 0.3;
  },
  after(a, tl, at) {
    tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.6), [], at);
    return at + 0.2;
  },
};

const goat: Climb = {
  dur: 0.36, per: 0.08, lift: 0.16, land: 0.3,
  flair: { dur: 0.5, per: 0.06, lift: 0.42 },
  pre(a, tl, at, c) {
    if (c.flair) {
      // Sizes up the ledge: head up, a hoof scrape, a deep crouch.
      tl.to(a.b('head'), { rx: -0.3, duration: 0.12 }, at);
      tl.to(a.face, { brows: 0.7, eyeScale: 1.1, duration: 0.1 }, at);
      if (!c.rm) yo(tl, a.b('legFR'), { rx: -0.6 }, 0.06, at + 0.04, 1);
      a.mouth('open', tl, at + 0.1);
      return crouch(a, tl, at + 0.12, c.rm ? 0.15 : 0.3, 0.12);
    }
    return crouch(a, tl, at, 0.16, 0.1);
  },
  frame(a, k, c) {
    const t = Math.sin(k * PI);
    if (c.flair) {
      // Springs off its back legs, tucks, then reaches for the top with the front hooves.
      legs4(a, k < 0.5 ? -t * 1.1 : -0.4, k < 0.3 ? 1.2 * (1 - k / 0.3) : t * 0.8);
      a.b('base').rx = -Math.cos(k * PI) * 0.4;
      if (!c.rm) a.b('base').ry = Math.sin(k * TAU) * 0.35;
      a.b('beard').rx = Math.cos(k * PI) * 0.4;
      a.b('tail1').rx = -t * 0.8;
      a.b('head').rx = -0.3 + k * 0.3;
    } else {
      legs4(a, -t * 0.7, t * 0.7);
      a.b('base').rx = -Math.cos(k * PI) * 0.22;
      a.b('beard').rx = Math.cos(k * PI) * 0.3;
    }
  },
  // Flair: lands like a champion, head toss and a sparkle.
  after(a, tl, at, c) {
    tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, c.flair ? 0.9 : 0.4), [], at);
    if (!c.flair) return at + 0.15;
    tl.call(() => { if (!c.rm) fx.stars(a.fxParent, a.above(a.height), a.sq, 5, 0.45); }, [], at + 0.05);
    yo(tl, a.b('head'), { rx: -0.35 }, 0.12, at + 0.05, 1);
    yo(tl, a.b('beard'), { rz: 0.4 }, 0.06, at + 0.05, 3);
    a.mouth('open', tl, at + 0.05);
    return at + 0.3;
  },
};

const elephant: Climb = {
  dur: 0.5, per: 0.14, lift: 0.08, land: 0.6,
  // Hauls itself up: front feet onto the ledge first, trunk up, then a heave.
  pre(a, tl, at, c) {
    if (!c.up) return crouch(a, tl, at, 0.08, 0.1);
    const k = c.rm ? 0.4 : 1;
    tl.to(a.b('base'), { rx: -0.35 * k, py: 0.06 * k, duration: 0.22, ease: 'power2.out' }, at);
    tl.to(a.b('legFL'), { rx: -1.0 * k, duration: 0.2 }, at);
    tl.to(a.b('legFR'), { rx: -1.0 * k, duration: 0.2 }, at + 0.04);
    tl.to(a.b('trunk1'), { rx: -0.8 * k, duration: 0.2 }, at);
    tl.to(a.b('trunk2'), { rx: -0.5 * k, duration: 0.2 }, at);
    tl.to(a.face, { brows: 0.8, blink: 0.3, duration: 0.1 }, at);
    a.mouth('frown', tl, at);
    return at + 0.22;
  },
  frame(a, k, c) {
    if (c.up) {
      a.b('base').rx = -0.35 * (1 - k) + Math.sin(k * PI) * 0.1;
      a.b('base').py = 0.06 * (1 - k);
      legs4(a, -1.0 * (1 - k), Math.sin(k * PI) * 0.6);
      a.b('trunk1').rx = -0.8 * (1 - k);
      a.b('trunk2').rx = -0.5 * (1 - k);
    } else {
      // A heavy step off: front legs reach down.
      legs4(a, -Math.sin(k * PI) * 0.6, 0);
      a.b('base').rx = Math.sin(k * PI) * 0.2;
      a.b('trunk1').rx = -Math.sin(k * PI) * 0.6;
    }
    const e = Math.sin(k * PI) * 0.4;
    a.b('earL').ry = -e; a.b('earR').ry = e;
  },
  after(a, tl, at, c) {
    tl.call(() => a.stomp(c.up ? 0.6 : Math.min(1, 0.6 + c.lv * 0.15)), [], at);
    a.mouth('smile', tl, at);
    return at + 0.25;
  },
};

const cat: Climb = {
  dur: 0.38, per: 0.06, lift: 0.18, land: 0.1,
  // Crouch, a butt wiggle, then a smooth pounce.
  pre(a, tl, at, c) {
    tl.to(a.b('body'), { sy: 0.84, duration: 0.12, ease: 'power2.out' }, at);
    tl.to(a.face, { blink: 0.3, duration: 0.1 }, at);
    if (c.up && !c.rm) yo(tl, a.b('base'), { rz: 0.07 }, 0.05, at + 0.06, 3);
    tl.to(a.b('body'), { sy: 1.08, duration: 0.08 }, at + (c.up ? 0.26 : 0.12));
    return at + (c.up ? 0.28 : 0.14);
  },
  frame(a, k) {
    const t = Math.sin(k * PI);
    a.b('pawL').rx = -t * 1.3; a.b('pawR').rx = -t * 1.3;
    a.b('base').rx = -Math.cos(k * PI) * 0.25;
    a.b('tail1').rx = -0.5 - t * 0.4;
    a.b('body').sy = 1 + t * 0.06;
  },
  after(a, tl, at) {
    tl.to(a.face, { blink: 0.5, duration: 0.12 }, at);
    yo(tl, a.b('tail3'), { ry: 0.6 }, 0.12, at, 1);
    return at + 0.25;
  },
};

const pug: Climb = {
  dur: 0.42, per: 0.12, lift: 0.1, land: 0.3,
  // A determined little heave; it wobbles at the top.
  pre(a, tl, at, c) {
    tl.to(a.face, { brows: c.up ? 1 : 0.3, duration: 0.1 }, at);
    a.mouth(c.up ? 'frown' : 'o', tl, at);
    return crouch(a, tl, at, 0.2, 0.14);
  },
  frame(a, k, c) {
    const s = Math.sin(k * PI * 6);
    a.b('pawL').rx = -0.8 - s * 0.5; a.b('pawR').rx = -0.8 + s * 0.5;
    a.b('base').rz = Math.sin(k * PI * 2) * 0.1;
    a.b('base').rx = c.up ? -Math.sin(k * PI) * 0.15 : Math.sin(k * PI) * 0.15;
  },
  after(a, tl, at, c) {
    yo(tl, a.b('base'), { rz: c.rm ? 0.04 : 0.14 }, 0.1, at, 3);
    tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.5), [], at);
    a.mouth('open', tl, at + 0.1);
    return at + 0.42;
  },
};

const crab: Climb = {
  // Scrambles up sideways, legs a blur.
  dur: 0.44, per: 0.1, lift: 0.1, land: 0.2, face: PI / 2,
  pre(a, tl, at) {
    tl.to(a.b('clawL'), { rx: -0.8, rz: 0.3, duration: 0.12 }, at);
    tl.to(a.b('clawR'), { rx: -0.8, rz: -0.3, duration: 0.12 }, at);
    tl.to(a.face, { eyeScale: 1.15, duration: 0.1 }, at);
    return crouch(a, tl, at, 0.1, 0.1);
  },
  frame(a, k, c) {
    for (let j = 1; j <= 3; j++) {
      const s = Math.sin(k * PI * 14 + j * 2) * 0.45;
      a.b('legL' + j).rz = s;
      a.b('legR' + j).rz = -s;
    }
    if (!c.rm) a.b('base').py = Math.abs(Math.sin(k * PI * 4)) * 0.03;
    a.b('base').rz = (c.up ? -1 : 1) * Math.sin(k * PI) * 0.18;
  },
  after(a, tl, at) {
    yo(tl, a.b('clawL'), { ry: -0.5 }, 0.08, at, 3);
    yo(tl, a.b('clawR'), { ry: 0.5 }, 0.08, at, 3);
    yo(tl, a.b('jawL'), { rx: 0.5 }, 0.05, at, 3);
    return at + 0.3;
  },
};

const seahorse: Climb = {
  // Floats up on a column of bubbles, tail curled.
  dur: 0.5, per: 0.08, lift: 0.18, land: 0.15,
  pre(a, tl, at) {
    tl.to(a.b('tail2'), { rx: 0.4, duration: 0.15 }, at);
    tl.to(a.b('tail3'), { rx: 0.6, duration: 0.15 }, at);
    tl.call(() => fx.bubbles(a.fxParent, a.above(0.1), a.sq, 3, 0.6), [], at);
    return at + 0.12;
  },
  frame(a, k) {
    a.b('fin').ry = Math.sin(k * 70) * 0.6;
    a.b('base').rx = Math.sin(k * PI) * 0.2;
    a.b('tail2').rx = 0.4 * (1 - k); a.b('tail3').rx = 0.6 * (1 - k);
    if (Math.random() < 0.3) fx.trailBubble(a.fxParent, a.above(0.2), a.sq);
  },
  after(a, tl, at) {
    yo(tl, a.b('base'), { py: 0.05 }, 0.15, at, 1);
    return at + 0.3;
  },
};

const puffer: Climb = {
  dur: 0.46, per: 0.06, lift: 0.14, land: 0.15,
  flair: { dur: 0.58, per: 0.05, lift: 0.4 },
  // Flair: puffs up like a balloon and floats up 2, spins, then lets the air out on top.
  pre(a, tl, at, c) {
    const big = c.flair ? 1.5 : 1.15;
    tl.to(a.b('head'), { sx: big, sy: big, sz: big, duration: c.flair ? 0.24 : 0.14, ease: 'back.out(2)' }, at);
    tl.to(a.face, { eyeScale: c.flair ? 1.25 : 1.1, duration: 0.1 }, at);
    a.mouth('o', tl, at);
    return at + (c.flair ? 0.24 : 0.12);
  },
  frame(a, k, c) {
    const big = c.flair ? 1.5 : 1.15;
    const h = a.b('head');
    h.sx = h.sy = h.sz = big + Math.sin(k * PI * 4) * 0.03;
    a.b('finL').ry = Math.sin(k * 80) * 0.7;
    a.b('finR').ry = -Math.sin(k * 80) * 0.7;
    a.b('tailFin').ry = Math.sin(k * 40) * 0.5;
    if (c.flair && !c.rm) a.b('base').ry = smooth(k) * TAU;
    else a.b('base').rz = Math.sin(k * PI * 3) * 0.08;
  },
  after(a, tl, at, c) {
    const h = a.b('head');
    tl.set(a.b('base'), { ry: 0 }, at);
    tl.to(h, { sx: 0.9, sy: 0.9, sz: 0.9, duration: 0.12, ease: 'power2.in' }, at);
    tl.to(h, { sx: 1, sy: 1, sz: 1, duration: 0.35, ease: 'elastic.out(1, 0.4)' }, at + 0.12);
    tl.call(() => fx.bubbles(a.fxParent, a.bonePoint('head'), a.sq, c.flair ? 6 : 3, 0.6), [], at);
    if (c.flair) a.mouth('open', tl, at + 0.12);
    return at + 0.3;
  },
};

const turtle: Climb = {
  // Hauls itself up with the front flippers, shell tipping back, then flops forward.
  dur: 0.5, per: 0.14, lift: 0.07, land: 0.45,
  pre(a, tl, at, c) {
    if (!c.up) return crouch(a, tl, at, 0.06, 0.1);
    const k = c.rm ? 0.4 : 1;
    tl.to(a.b('base'), { rx: -0.3 * k, duration: 0.2, ease: 'power2.out' }, at);
    tl.to(a.b('flipFL'), { rx: -0.9 * k, rz: -0.3, duration: 0.18 }, at);
    tl.to(a.b('flipFR'), { rx: -0.9 * k, rz: 0.3, duration: 0.18 }, at);
    tl.to(a.b('head'), { pz: 0.04, duration: 0.18 }, at);
    a.mouth('frown', tl, at);
    return at + 0.2;
  },
  frame(a, k, c) {
    const p = Math.sin(k * PI * 5) * 0.4;
    if (c.up) {
      a.b('base').rx = -0.3 * (1 - k) + Math.sin(k * PI) * 0.1;
      a.b('flipFL').rx = -0.9 * (1 - k) + p; a.b('flipFR').rx = -0.9 * (1 - k) + p;
    } else {
      a.b('base').rx = Math.sin(k * PI) * 0.2;
      a.b('flipFL').rz = -p; a.b('flipFR').rz = p;
    }
    a.b('flipBL').rz = p * 0.5; a.b('flipBR').rz = -p * 0.5;
  },
  after(a, tl, at, c) {
    tl.fromTo(a.b('base'), { rx: c.up ? 0.12 : 0.05 }, { rx: 0, duration: 0.35, ease: 'elastic.out(1, 0.4)', immediateRender: false }, at);
    tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.5), [], at);
    yo(tl, a.b('lamp'), { sx: 1.5, sy: 1.5, sz: 1.5 }, 0.08, at, 1);
    return at + 0.3;
  },
};

const TENT = Array.from({ length: 8 }, (_, i) => {
  const ang = (i / 8) * TAU + PI / 8;
  return { dx: Math.sin(ang), dz: Math.cos(ang) };
});
const lift8 = (i: number, th: number) => ({ rx: -th * TENT[i].dz, rz: th * TENT[i].dx });
const FRONT = [0, 7, 1, 6];

const octopus: Climb = {
  // Front tentacles reach up and grab the ledge, then it pulls itself up and over.
  dur: 0.48, per: 0.1, lift: 0.08, land: 0.2,
  pre(a, tl, at, c) {
    for (const i of FRONT) {
      tl.to(a.b(`t${i}a`), { ...lift8(i, c.up ? 1.3 : 0.6), duration: 0.18, ease: 'back.out(2)' }, at);
      tl.to(a.b(`t${i}c`), { rx: c.up ? 0.6 : 0.2, duration: 0.18 }, at);
    }
    tl.to(a.b('head'), { sy: 1.1, duration: 0.18 }, at);
    a.mouth('o', tl, at);
    return at + 0.2;
  },
  frame(a, k, c) {
    // Front ones pull down; back ones push off and trail.
    for (let j = 0; j < 8; j++) {
      const front = FRONT.includes(j);
      const th = front ? (c.up ? 1.3 : 0.6) * (1 - k) - Math.sin(k * PI) * 0.3 : -Math.sin(k * PI) * 0.5;
      Object.assign(a.b(`t${j}a`), lift8(j, th));
      a.b(`t${j}c`).rx = front ? (c.up ? 0.6 : 0.2) * (1 - k) : Math.sin(k * PI) * 0.4;
    }
    a.b('head').sy = 1.1 + Math.sin(k * PI) * 0.1;
    a.b('base').rx = Math.sin(k * PI) * 0.15;
  },
  after(a, tl, at) {
    tl.fromTo(a.b('body'), { sy: 0.85, sx: 1.12, sz: 1.12 }, { sy: 1, sx: 1, sz: 1, duration: 0.4, ease: 'elastic.out(1, 0.4)', immediateRender: false }, at);
    return at + 0.25;
  },
};

const blobfish: Climb = {
  // Squish down, gloop up tall, plop onto the top in a big splat.
  dur: 0.44, per: 0.08, lift: 0.1, land: 0.3,
  pre(a, tl, at, c) {
    tl.to(a.b('head'), { sy: c.rm ? 0.88 : 0.68, sx: 1.25, sz: 1.25, duration: 0.16, ease: 'power2.out' }, at);
    tl.to(a.face, { blink: 0.4, duration: 0.1 }, at);
    return at + 0.16;
  },
  frame(a, k) {
    const h = a.b('head');
    const s = Math.sin(k * PI);
    h.sy = 0.68 + (1 - 0.68) * Math.min(1, k * 4) + s * 0.3;
    h.sx = h.sz = 1.25 - Math.min(1, k * 4) * 0.25 - s * 0.15;
    a.b('finL').rz = s * 0.6; a.b('finR').rz = -s * 0.6;
  },
  after(a, tl, at, c) {
    const h = a.b('head');
    tl.to(h, { sy: c.rm ? 0.85 : 0.6, sx: 1.35, sz: 1.35, duration: 0.06, ease: 'power3.out' }, at);
    tl.to(h, { sy: 1, sx: 1, sz: 1, duration: 0.5, ease: 'elastic.out(1.1, 0.35)' }, at + 0.06);
    tl.to(a.face, { blink: 0.8, duration: 0.06 }, at);
    a.mouth('o', tl, at);
    return at + 0.35;
  },
};

const CLIMB = {
  land: { p: pup, n: horse, b: goat, r: elephant, q: cat, k: pug },
  sea: { p: crab, n: seahorse, b: puffer, r: turtle, q: octopus, k: blobfish },
} as const;

/** The 'climb' travel style. */
export function climb(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm;
  const prof: Climb = CLIMB[a.side][a.kind];
  const dy = (to.y - a.object.position.y) / a.sq;
  const lv = Math.abs(dy) / LEVEL;
  const up = dy > 0.02;
  const flair = up && lv > 1.5 && !!prof.flair;
  const c: Ctx = { dy, lv, up, flair, rm };
  const p = flair ? { ...prof, ...prof.flair } : prof;
  // Turn toward the new square (unless it's straight up or down).
  const d = to.clone().sub(a.object.position).setY(0);
  let t = 0;
  let yaw = a.object.rotation.y;
  if (d.lengthSq() > 1e-6) {
    yaw = nearest(yaw, Math.atan2(d.x, d.z) + (prof.face ?? 0));
    tl.to(a.object.rotation, { y: yaw, duration: rm ? 0.1 : 0.16, ease: 'power2.out' }, 0);
    t = rm ? 0.07 : 0.11;
  }
  t = rm ? crouch(a, tl, t, 0.06, 0.08) : prof.pre ? prof.pre(a, tl, t, c) : crouch(a, tl, t, 0.14);
  const down = !up && dy < -0.02;
  const dur = Math.min(0.75, (p.dur + p.per * lv * (down ? 0.5 : 1)) * (rm ? 0.65 : 1));
  const lift = rm ? Math.min(p.lift, 0.06) : p.lift;
  const arrive = ledge(a, tl, t, to, dur, lift, (k) => { if (!rm) prof.frame?.(a, k, c); });
  const body = a.b('body');
  tl.call(() => {
    a.emit('land', { id: a.id, at: a.worldPos(), intensity: rm ? 0 : Math.min(1, prof.land * (down ? 1 + lv * 0.3 : 1)) });
  }, [], arrive);
  // Landing squash; a drop also bounces once.
  const sq = rm ? 0.08 : down ? Math.min(0.32, 0.16 + lv * 0.06) : 0.16;
  tl.fromTo(body, { sy: 1 - sq, sx: 1 + sq * 0.55, sz: 1 + sq * 0.55 }, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', immediateRender: false }, arrive);
  let end = arrive + 0.15;
  if (down && !rm) {
    const base = a.b('base');
    const hop = Math.min(0.14, 0.05 + lv * 0.03);
    tl.to(base, { py: hop, duration: 0.11, ease: 'power2.out' }, arrive + 0.03);
    tl.to(base, { py: 0, duration: 0.13, ease: 'power2.in' }, arrive + 0.14);
    tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.4), [], arrive);
    end = arrive + 0.27;
  }
  if (!rm && prof.after) end = Math.max(end, prof.after(a, tl, arrive, c));
  tl.to(a.object.rotation, { y: nearest(yaw, a.homeYaw()), duration: 0.35, ease: 'power2.inOut' }, arrive + 0.05);
  return { arrive, end };
}
