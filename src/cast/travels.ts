/**
 * Phase 3 travel styles for `moveTo(target, { style })`. 'normal' stays in actor.ts (each animal's own gait).
 * Each builder adds to `tl` from 0 and returns `arrive` (on the square: the promise resolves) and `end`
 * (when the pose can relax). Everything stays under about 1.2s. `to` is in the actor's parent space.
 */
import * as THREE from 'three';
import type { MoveStyle } from '../contracts/types';
import type { Actor } from './actor';
import type { Gait } from './styles';
import * as fx from './fx';
import * as vfx from './vfx';

type TL = gsap.core.Timeline;
const PI = Math.PI;
const TAU = PI * 2;
export interface Leg { arrive: number; end: number }

const yo = (tl: TL, o: object, vars: gsap.TweenVars, dur: number, at: number, repeat = 1, ease = 'sine.inOut') =>
  tl.to(o, { ...vars, duration: dur, yoyo: true, repeat, ease }, at);
/** The value nearest `from` that faces the same way as `to`. */
const nearest = (from: number, to: number) => from + ((((to - from) % TAU) + TAU + PI) % TAU) - PI;
/** Arms, legs, claws, fins and two tentacles: whatever the animal has gets flailed. */
const LIMBS = ['legFL', 'legFR', 'pawL', 'pawR', 'clawL', 'clawR', 'finL', 'finR', 'flipFL', 'flipFR', 't0a', 't7a'];

/** Travel direction in the actor's own frame (x right, z forward). */
function localDir(a: Actor, to: THREE.Vector3) {
  const d = to.clone().sub(a.object.position).setY(0);
  if (d.lengthSq() < 1e-8) return new THREE.Vector3(0, 0, -1);
  return d.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -a.object.rotation.y);
}
/** Slide the object from where it is now to `to` over `dur`, calling `frame(k)` along the way. */
function slide(a: Actor, tl: TL, at: number, to: THREE.Vector3, dur: number, ease: string, frame?: (k: number) => void) {
  const from = a.object.position.clone();
  const p = { k: 0 };
  tl.to(p, { k: 1, duration: dur, ease, onUpdate: () => { a.object.position.lerpVectors(from, to, p.k); frame?.(p.k); } }, at);
  tl.call(() => { a.object.position.copy(to); }, [], at + dur);
  return at + dur;
}
/** Call `fn` at most `n` times along a slide (skip-safe: k jumps straight to 1). */
function every(n: number, fn: () => void) {
  let last = -1;
  return (k: number) => {
    const i = Math.min(n - 1, Math.floor(k * n));
    if (i !== last) { last = i; fn(); }
  };
}
function landed(a: Actor, intensity = 0.2) {
  a.emit('land', { id: a.id, at: a.worldPos(), intensity: a.rm ? 0 : intensity });
}
function turnHome(a: Actor, tl: TL, at: number, dur = 0.35) {
  tl.to(a.object.rotation, { y: a.homeYawNear(), duration: dur, ease: 'power2.inOut' }, at);
}

// ---------- gaits for the simpler styles ----------

const STEP: Gait = { dur: () => 0.36, hops: () => 1, height: 0.32, squash: 0.18, antic: 0.1, landIntensity: 0.15, ease: 'power1.inOut' };
const STUMBLE: Gait = {
  dur: () => 0.55, hops: () => 3, height: 0.07, squash: 0.12, antic: 0, ease: 'power1.inOut',
  frame(a, _k, f, i) {
    a.b('base').rz = Math.sin(f * PI) * 0.24 * (i % 2 ? 1 : -1);
    for (const n of LIMBS) a.b(n).rx = Math.sin((i + f) * TAU) * 0.8;
  },
};
const DAZED: Gait = {
  dur: (n) => 0.3 * n + 0.45, hops: (n) => Math.round(n * 3) + 1, height: 0.04, squash: 0.08, antic: 0, ease: 'sine.inOut',
  frame(a, k, f, i) {
    a.b('base').rz = Math.sin((i + f) * PI) * 0.2;
    a.b('base').ry = Math.sin(k * TAU) * 0.25;
    a.b('head').rz = -Math.sin((i + f) * PI) * 0.15;
  },
};

// ---------- styles ----------

/** Burrow under and pop up at `to` with a dirt (or sand) trail. Pup sidestep; any pawn's dig. */
function burrow(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm, sea = a.side === 'sea', P = a.fxParent, sq = a.sq;
  const base = a.b('base');
  const from = a.object.position.clone();
  const dive = rm ? 0.16 : 0.24, under = rm ? 0.24 : 0.34, up = rm ? 0.22 : 0.3;
  tl.call(() => { fx.mound(P, from, sq, dive + 0.1, sea); fx.clods(P, from, sq, 6, sea); }, [], 0);
  a.mouth('o', tl, 0);
  tl.to(base, { py: -a.height * 0.7, sx: 0.3, sy: 0.3, sz: 0.3, rx: 0.4, duration: dive, ease: 'back.in(1.5)' }, 0);
  const t = slide(a, tl, dive, to, under, 'sine.inOut', every(3, () => fx.clods(P, a.object.position.clone(), sq, 2, sea)));
  tl.call(() => { fx.mound(P, to, sq, 0.3, sea); fx.clods(P, to, sq, 7, sea); landed(a, 0.2); }, [], t);
  tl.to(base, { py: 0, sx: 1, sy: 1, sz: 1, rx: 0, duration: up, ease: 'back.out(2)' }, t);
  a.mouth('open', tl, t);
  tl.to(a.face, { eyeScale: 1.2, duration: 0.1 }, t);
  return { arrive: t + up * 0.6, end: t + up };
}

/** Land: a speed blur that dashes (the pug spins up first). Sea: melts into a puddle and reforms. Also swaps. */
function teleport(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  return a.side === 'land' ? dash(a, tl, to) : blorp(a, tl, to);
}
function dash(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm, P = a.fxParent, sq = a.sq;
  const body = a.b('body');
  const from = a.object.position.clone();
  const d = to.clone().sub(from).setY(0);
  const zoom = a.kind === 'k' && !rm;
  const y0 = a.object.rotation.y;
  const yaw = d.lengthSq() > 1e-8 ? nearest(y0, Math.atan2(d.x, d.z)) : y0;
  const turn = zoom ? 0.3 : 0.12;
  tl.to(a.object.rotation, { y: yaw + (zoom ? TAU : 0), duration: turn, ease: 'power2.in' }, 0);
  tl.to(body, { sy: 0.78, sx: 1.12, sz: 1.12, duration: turn, ease: 'power2.out' }, 0);
  tl.to(a.face, { brows: 1, eyeScale: 1.15, duration: 0.1 }, 0);
  a.mouth('open', tl, 0);
  const t1 = turn + 0.05;
  const run = rm ? 0.24 : 0.2;
  if (!rm) tl.to(body, { sz: 2.1, sy: 0.72, sx: 0.7, duration: 0.06, ease: 'power2.out' }, t1);
  tl.call(() => {
    if (rm) fx.streak(P, from, to, sq, run);
    else { vfx.speedLines(P, from, to, sq, { n: 9, dur: run, lo: 0.1, hi: a.height * 0.9 }); vfx.kick(P, from, to.clone().sub(from).negate(), sq); }
  }, [], t1);
  const t2 = slide(a, tl, t1, to, run, 'power2.inOut');
  tl.call(() => {
    fx.dust(P, to, sq, 0.8);
    if (!rm) vfx.sparkles(P, to.clone().setY(to.y + a.height * sq * 0.6), sq, 4, { radius: 0.4, size: 0.26, life: 0.35 });
    landed(a, 0.3);
  }, [], t2);
  tl.fromTo(body, { sz: 0.7, sy: 1.15, sx: 1.1 }, { sz: 1, sy: 1, sx: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', immediateRender: false }, t2);
  tl.to(a.object.rotation, { y: nearest(yaw, a.homeYaw()) + (zoom ? TAU : 0), duration: 0.3, ease: 'power2.inOut' }, t2 + 0.1);
  return { arrive: t2, end: t2 + 0.4 };
}
function blorp(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm, P = a.fxParent, sq = a.sq;
  const base = a.b('base');
  const melt = rm ? 0.18 : 0.3, ooze = rm ? 0.26 : 0.32;
  yo(tl, base, { rz: 0.08 }, 0.06, 0, 3);
  tl.to(base, { sy: 0.07, sx: 1.5, sz: 1.5, duration: melt, ease: 'power2.in' }, 0);
  tl.to(a.face, { blink: 1, duration: melt }, 0);
  tl.call(() => { fx.bubbles(P, a.above(0.05), sq, 4, 0.4); vfx.droplets(P, a.above(0.05), sq, 5, { up: 0.3, radius: 0.45, size: 0.6 }); }, [], melt * 0.8);
  const t = slide(a, tl, melt, to, ooze, 'sine.inOut', every(3, () => fx.trailBubble(P, a.above(0.05), sq)));
  tl.call(() => { fx.bubbles(P, a.above(0.1), sq, 6, 0.7); vfx.droplets(P, a.above(0.05), sq, 6, { up: 0.45, radius: 0.4, size: 0.6 }); landed(a, 0.2); }, [], t);
  tl.to(base, { sy: 1.25, sx: 0.85, sz: 0.85, duration: 0.14, ease: 'power2.out' }, t);
  tl.to(base, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1, 0.4)' }, t + 0.14);
  tl.to(a.face, { blink: 0, eyeScale: 1.15, duration: 0.12 }, t + 0.05);
  return { arrive: t + 0.14, end: t + 0.5 };
}

/** Banana peel: the feet go out, it slides with flailing arms, and the peel is left spinning. */
function slip(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm, sq = a.sq;
  const base = a.b('base');
  const from = a.object.position.clone();
  const l = localDir(a, to);
  tl.call(() => fx.peel(a.fxParent, from, sq, a.object.rotation.y), [], 0);
  tl.to(a.face, { eyeScale: 1.35, blink: 0, duration: 0.06 }, 0.04);
  a.mouth('o', tl, 0.04);
  const lean = rm ? 0.15 : 0.45;
  // The top lags behind as the feet shoot forward.
  tl.to(base, { rx: -l.z * lean, rz: l.x * lean, py: rm ? 0.03 : 0.1, duration: 0.12, ease: 'power2.out' }, 0.12);
  if (!rm) LIMBS.forEach((n, j) => yo(tl, a.b(n), { rx: -1.2 }, 0.07, 0.12 + (j % 2) * 0.035, 7));
  const run = rm ? 0.4 : 0.58;
  const t = slide(a, tl, 0.1, to, run, 'power2.out', rm ? undefined : (k) => { base.ry = Math.sin(k * PI * 3) * 0.25 * (1 - k); });
  tl.to(base, { rx: 0, rz: 0, py: 0, duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, t - 0.05);
  tl.call(() => landed(a, 0.25), [], t);
  tl.to(a.face, { eyeScale: 1, blink: 0.3, duration: 0.15 }, t);
  a.mouth('frown', tl, t);
  return { arrive: t, end: t + 0.3 };
}

/**
 * Headbutted or stomped away: the top snaps over in the push direction, it skids along on its heels with legs flailing
 * (dust dragging behind, speed lines), then windmills to catch its balance and rocks back upright.
 */
function pushed(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm, P = a.fxParent, sq = a.sq;
  const base = a.b('base');
  const l = localDir(a, to);
  const from = a.object.position.clone();
  const dw = to.clone().sub(from).setY(0);
  const n = dw.length() / sq;
  dw.normalize();
  const tip = rm ? 0.18 : 0.6;
  tl.to(a.face, { eyeScale: 1.4, blink: 0, duration: 0.05 }, 0);
  a.mouth('o', tl, 0);
  tl.to(base, { rx: l.z * tip, rz: -l.x * tip, duration: 0.08, ease: 'power3.out' }, 0);
  if (!rm) LIMBS.forEach((nm, j) => yo(tl, a.b(nm), { rx: -1.1 }, 0.06, (j % 2) * 0.03, 7));
  const D = Math.min(0.62, 0.34 + n * 0.08) * (rm ? 0.75 : 1);
  tl.call(() => vfx.speedLines(P, from, to, sq, { n: 5, dur: D * 0.6, lo: 0.2, hi: a.height * 0.9 }), [], 0.02);
  const kick = every(5, () => vfx.kick(P, a.above(0), dw.clone().negate(), sq));
  const t = slide(a, tl, 0.02, to, D, 'power3.out', (k) => {
    base.py = Math.sin(Math.min(1, k * 2.2) * PI) * (rm ? 0.03 : 0.1);
    if (k < 0.85) kick(k);
  });
  tl.set(base, { py: 0 }, t);
  // Catch the balance: overshoot back the other way, then settle with a wobble.
  tl.to(base, { rx: -l.z * tip * 0.4, rz: l.x * tip * 0.4, duration: 0.14, ease: 'power2.out' }, t - 0.08);
  tl.to(base, { rx: 0, rz: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.35)' }, t + 0.06);
  tl.call(() => { fx.dust(P, to, sq, 0.6); landed(a, 0.3); }, [], t);
  tl.to(a.face, { eyeScale: 1, blink: 0.4, duration: 0.15 }, t);
  a.mouth('frown', tl, t);
  return { arrive: t, end: t + 0.45 };
}

/** Tide: rides a water hump to the square with droplets, then a splash. */
function swept(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm, P = a.fxParent, sq = a.sq;
  const base = a.b('base');
  const wave = fx.waveHump();
  wave.scale.setScalar(0.001);
  tl.call(() => a.temp(wave), [], 0);
  tl.to(wave.scale, { x: 1.15, y: 0.4, z: 1.15, duration: 0.18, ease: 'back.out(2)' }, 0);
  tl.to(base, { py: rm ? 0.06 : 0.2, duration: 0.2, ease: 'power2.out' }, 0.05);
  if (!rm) yo(tl, base, { rz: 0.14 }, 0.16, 0.1, 3);
  tl.to(a.face, { eyeScale: 1.2, duration: 0.1 }, 0);
  a.mouth('o', tl, 0);
  const t = slide(a, tl, 0.15, to, rm ? 0.45 : 0.62, 'sine.inOut', every(4, () => fx.trailBubble(P, a.above(0.05), sq)));
  tl.to(wave.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.18, ease: 'power2.in' }, t - 0.08);
  tl.call(() => { a.untemp(wave); fx.splash(P, to, sq, 12); landed(a, 0.3); }, [], t + 0.1);
  tl.to(base, { py: 0, rz: 0, duration: 0.25, ease: 'bounce.out' }, t - 0.05);
  return { arrive: t + 0.1, end: t + 0.3 };
}

/**
 * A knight hop (each half of a double jump): crouch, launch with a stretch, a high clear arc with legs tucked, and a
 * squashed landing with a dust ring. The second hop springs straight out of the first landing (no second crouch).
 */
function leap(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm, P = a.fxParent, sq = a.sq;
  const body = a.b('body'), base = a.b('base');
  const horse = a.side === 'land' && a.kind === 'n';
  const sea = a.side === 'sea';
  const from = a.object.position.clone();
  const d = to.clone().sub(from).setY(0);
  const chained = a.sinceLand() < 0.3;
  const yaw = d.lengthSq() > 1e-8 ? nearest(a.object.rotation.y, Math.atan2(d.x, d.z)) : a.object.rotation.y;
  tl.to(a.object.rotation, { y: yaw, duration: chained ? 0.08 : 0.14, ease: 'power2.out' }, 0);
  const D = (horse ? 0.5 : sea ? 0.52 : 0.46) * (rm ? 0.75 : 1);
  const H = rm ? 0.12 : horse ? 1.15 : sea ? 0.85 : 0.9;
  let t = rm ? 0.08 : chained ? 0.03 : 0.12;
  if (!rm) {
    if (!chained) tl.to(body, { sy: 0.74, sx: 1.14, sz: 1.14, duration: 0.12, ease: 'power2.out' }, 0);
    tl.to(body, { sy: 1.2, sx: 0.9, sz: 0.9, duration: 0.1, ease: 'power2.out' }, t);
    tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.2, ease: 'sine.inOut' }, t + 0.12);
    tl.to(body, { sy: 1.1, sx: 0.94, sz: 0.94, duration: 0.14, ease: 'sine.in' }, t + D - 0.16);
  }
  tl.to(a.face, { eyeScale: 1.15, duration: 0.1 }, 0);
  a.mouth('open', tl, t);
  tl.call(() => fx.dust(P, from, sq, 0.55, sea ? vfx.COLORS.sand : 0xffffff), [], t);
  if (!rm) tl.call(() => vfx.sparkles(P, from.clone().lerp(to, 0.5).setY(from.y + (H + a.height * 0.6) * sq), sq, 3, { radius: 0.3, size: 0.22, life: 0.3 }), [], t + D * 0.45);
  const p = { k: 0 };
  let bub = 0;
  tl.to(p, {
    k: 1, duration: D, ease: 'none',
    onUpdate: () => {
      const k = p.k, s = Math.sin(k * PI);
      a.object.position.lerpVectors(from, to, k);
      base.py = 4 * H * k * (1 - k);
      if (horse) {
        base.rx = -Math.cos(k * PI) * 0.4;
        a.b('legFL').rx = a.b('legFR').rx = -s * 1.1;
        a.b('legBL').rx = a.b('legBR').rx = s * 0.9;
        a.b('tail1').rx = -s * 0.8;
        a.b('neck').rx = Math.sin(k * TAU) * 0.15;
      } else if (sea) {
        base.rx = s * 0.3;
        a.b('tail1').rx = s * 0.5; a.b('tail2').rx = s * 0.6; a.b('tail3').rx = s * 0.8;
        a.b('fin').ry = Math.sin(k * 60) * 0.5;
        if (k > bub) { bub = k + 0.12; fx.trailBubble(P, a.above(0.3 + base.py), sq); }
      } else {
        base.rx = -Math.cos(k * PI) * 0.25;
        for (const n of LIMBS) a.b(n).rx = -s * 0.8;
      }
    },
  }, t);
  const land = t + D;
  tl.call(() => {
    base.py = 0;
    a.object.position.copy(to);
    landed(a, horse ? 0.45 : 0.35);
    a.markLanded();
    if (sea) { fx.dust(P, to, sq, 0.8, vfx.COLORS.sand); vfx.droplets(P, to, sq, 4, { up: 0.3, radius: 0.4, size: 0.55 }); }
    else fx.dust(P, to, sq, 0.95);
  }, [], land);
  if (!rm) tl.fromTo(body, { sy: 0.72, sx: 1.16, sz: 1.16 }, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', immediateRender: false }, land);
  tl.to(base, { rx: 0, duration: 0.2, ease: 'power2.out' }, land);
  turnHome(a, tl, land + 0.12);
  return { arrive: land, end: land + 0.25 };
}

/** Crab (or any pawn) scuttling sideways without turning, kicking up little puffs. */
function scuttle(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const P = a.fxParent, sq = a.sq;
  const from = a.object.position.clone();
  const g = a.kind === 'p' ? a.style.gait : STEP;
  const t = a.travel(tl, 0, to, g, { keepFacing: true, durScale: 0.55 });
  const sand = a.side === 'sea' ? vfx.COLORS.sand : vfx.COLORS.dust;
  if (!a.rm) tl.call(() => vfx.speedLines(P, from, to, sq, { n: 4, dur: t, lo: 0.08, hi: 0.3 }), [], 0);
  for (const k of [0.2, 0.5, 0.8]) tl.call(() => fx.dust(P, a.above(0), sq, 0.32, sand), [], t * k);
  return { arrive: t, end: t + 0.1 };
}

function styleOf(a: Actor, style: MoveStyle): (a: Actor, tl: TL, to: THREE.Vector3) => Leg {
  switch (style) {
    case 'sidestep':
      if (a.kind === 'p' && a.side === 'land') return burrow;
      // The crab already walks sideways: it scuttles across without turning.
      return scuttle;
    case 'dig':
      return burrow;
    case 'jump':
      return leap;
    case 'step':
      return (a, tl, to) => {
        const t = a.travel(tl, 0, to, STEP, { faceAfter: true });
        return { arrive: t, end: t + 0.1 };
      };
    case 'quake':
      return (a, tl, to) => {
        tl.to(a.face, { eyeScale: 1.3, duration: 0.08 }, 0);
        a.mouth('o', tl, 0);
        const t = a.travel(tl, 0, to, STUMBLE, { keepFacing: true, noAntic: true });
        tl.to(a.b('base'), { rz: 0, duration: 0.3, ease: 'elastic.out(1, 0.4)' }, t);
        return { arrive: t, end: t + 0.2 };
      };
    case 'bonked':
      return (a, tl, to) => {
        tl.call(() => {
          fx.dizzy(a.object, a.height + 0.08, 1.1);
          vfx.droplets(a.fxParent, a.bonePoint('head').add(new THREE.Vector3(0, a.sq * 0.2, 0)), a.sq, 3, { up: 0.3, radius: 0.3, size: 0.5 });
        }, [], 0);
        tl.to(a.face, { blink: 0.6, duration: 0.15 }, 0);
        a.mouth('open', tl, 0);
        const t = a.travel(tl, 0.05, to, DAZED, { keepFacing: true, noAntic: true, cap: 1.05 });
        turnHome(a, tl, t);
        return { arrive: t, end: t + 0.3 };
      };
    case 'slip': return slip;
    case 'pushed': return pushed;
    case 'teleport': return teleport;
    case 'swept': return swept;
    case 'normal': throw new Error('normal travel lives in Actor.moveTo');
  }
}

/** Build the travel for `style` onto `tl`. */
export function travelStyle(a: Actor, tl: TL, to: THREE.Vector3, style: MoveStyle): Leg {
  return styleOf(a, style)(a, tl, to);
}
