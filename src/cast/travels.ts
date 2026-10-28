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
import { climb, ledge, LEVEL } from './climb';

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
const HOP: Gait = { dur: () => 0.6, hops: () => 1, height: 0.95, squash: 0.25, antic: 0.15, landIntensity: 0.35, ease: 'power1.inOut' };
const PUSHED: Gait = { dur: () => 0.42, hops: () => 1, height: 0.16, squash: 0.22, antic: 0, landIntensity: 0.3, ease: 'power2.out' };
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
  tl.call(() => fx.streak(P, from, to, sq, run), [], t1);
  const t2 = slide(a, tl, t1, to, run, 'power2.inOut');
  tl.call(() => { fx.dust(P, to, sq, 0.8); landed(a, 0.3); }, [], t2);
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
  tl.call(() => fx.bubbles(P, a.above(0.05), sq, 4, 0.4), [], melt * 0.8);
  const t = slide(a, tl, melt, to, ooze, 'sine.inOut', every(3, () => fx.trailBubble(P, a.above(0.05), sq)));
  tl.call(() => { fx.bubbles(P, a.above(0.1), sq, 6, 0.7); landed(a, 0.2); }, [], t);
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

/** Headbutted: tips over in the push direction, skids a square, and rocks back upright. */
function pushed(a: Actor, tl: TL, to: THREE.Vector3): Leg {
  const rm = a.rm;
  const base = a.b('base');
  const l = localDir(a, to);
  const tip = rm ? 0.18 : 0.55;
  tl.to(a.face, { eyeScale: 1.35, duration: 0.06 }, 0);
  a.mouth('o', tl, 0);
  tl.call(() => fx.stars(a.fxParent, a.above(a.height), a.sq, rm ? 3 : 5, 0.4), [], 0);
  tl.to(base, { rx: l.z * tip, rz: -l.x * tip, duration: 0.1, ease: 'power2.out' }, 0);
  if (!rm) yo(tl, a.b('base'), { ry: 0.4 }, 0.15, 0.05, 1);
  const dy = (to.y - a.object.position.y) / a.sq;
  if (Math.abs(dy) > 0.02) return pushedLedge(a, tl, to, dy);
  const t = a.travel(tl, 0.05, to, PUSHED, { keepFacing: true, noAntic: true, cap: 0.6 });
  tl.to(base, { rx: 0, rz: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.35)' }, t);
  tl.to(a.face, { eyeScale: 1, blink: 0.4, duration: 0.15 }, t);
  return { arrive: t, end: t + 0.4 };
}
/**
 * Phase 6 (Sandcastle King): pushed onto a square at another height. It skids off the edge and falls
 * (a thump, a bounce and dust; harder for a bigger drop), or gets bumped up one level. The tip-over above already started.
 */
function pushedLedge(a: Actor, tl: TL, to: THREE.Vector3, dy: number): Leg {
  const rm = a.rm, base = a.b('base'), body = a.b('body');
  const lv = Math.abs(dy) / LEVEL;
  const down = dy < 0;
  const dur = rm ? 0.36 : down ? 0.46 + lv * 0.04 : 0.42;
  const t = ledge(a, tl, 0.05, to, dur, rm ? 0.03 : down ? 0.05 : 0.08, rm ? undefined : (k) => {
    for (const n of LIMBS) a.b(n).rx = Math.sin(k * PI * 6) * 0.9 * k;
  });
  const sq = rm ? 0.08 : down ? Math.min(0.35, 0.18 + lv * 0.06) : 0.18;
  tl.call(() => {
    landed(a, Math.min(1, 0.3 + (down ? lv * 0.15 : 0)));
    fx.dust(a.fxParent, a.above(0), a.sq, down ? 0.5 + lv * 0.15 : 0.4);
  }, [], t);
  tl.fromTo(body, { sy: 1 - sq, sx: 1 + sq * 0.55, sz: 1 + sq * 0.55 }, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', immediateRender: false }, t);
  let end = t + 0.4;
  if (down && !rm) {
    const hop = Math.min(0.16, 0.06 + lv * 0.03);
    tl.to(base, { py: hop, duration: 0.12, ease: 'power2.out' }, t + 0.03);
    tl.to(base, { py: 0, duration: 0.14, ease: 'power2.in' }, t + 0.15);
    tl.call(() => fx.stars(a.fxParent, a.above(a.height), a.sq, 3, 0.35), [], t);
    end = t + 0.45;
  }
  for (const n of LIMBS) tl.to(a.b(n), { rx: 0, duration: 0.2 }, t);
  tl.to(base, { rx: 0, rz: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.35)' }, t);
  tl.to(a.face, { eyeScale: 1, blink: 0.4, duration: 0.15 }, t);
  a.mouth('frown', tl, t);
  return { arrive: t, end };
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

function styleOf(a: Actor, style: MoveStyle): (a: Actor, tl: TL, to: THREE.Vector3) => Leg {
  switch (style) {
    case 'sidestep':
      if (a.kind === 'p' && a.side === 'land') return burrow;
      // The crab already walks sideways: it scuttles across without turning.
      return (a, tl, to) => {
        const g = a.kind === 'p' ? a.style.gait : STEP;
        const t = a.travel(tl, 0, to, g, { keepFacing: true, durScale: 0.55 });
        return { arrive: t, end: t + 0.1 };
      };
    case 'dig':
      return burrow;
    case 'jump':
      return (a, tl, to) => {
        const t = a.kind === 'n' ? a.travel(tl, 0, to, a.style.gait, { faceAfter: true, durScale: 0.85 }) : a.travel(tl, 0, to, HOP, { faceAfter: true });
        return { arrive: t, end: t + 0.1 };
      };
    case 'climb': return climb;
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
        tl.call(() => fx.dizzy(a.object, a.height + 0.08, 1.1), [], 0);
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
