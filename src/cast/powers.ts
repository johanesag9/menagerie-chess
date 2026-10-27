/**
 * Phase 3 power flourishes: 6 powers x 2 sides, each in the animal's own character.
 * A flourish plays in place and returns the moment the power takes effect; the actor emits `power` then.
 * Travel is separate (integration calls moveTo with the matching style afterwards).
 * Offsets are in square units, as in styles.ts. `target` is in the actor's parent space, or null.
 */
import * as THREE from 'three';
import type { PowerKind, Side } from '../contracts/types';
import type { Actor } from './actor';
import * as fx from './fx';

type TL = gsap.core.Timeline;
const PI = Math.PI;
const TAU = PI * 2;

export type Flourish = (a: Actor, tl: TL, at: number, target: THREE.Vector3 | null) => number;

const yo = (tl: TL, o: object, vars: gsap.TweenVars, dur: number, at: number, repeat = 1, ease = 'sine.inOut') =>
  tl.to(o, { ...vars, duration: dur, yoyo: true, repeat, ease }, at);

/** Turn to face `target` (if any); returns the time after the turn. */
function aim(a: Actor, tl: TL, at: number, target: THREE.Vector3 | null): number {
  if (!target) return at;
  const d = target.clone().sub(a.object.position).setY(0);
  if (d.lengthSq() < 1e-6) return at;
  tl.add(a.turnTween(Math.atan2(d.x, d.z), 0.14), at);
  return at + 0.12;
}
/** Turn back to the home facing. */
function unaim(a: Actor, tl: TL, at: number) {
  tl.to(a.object.rotation, { y: a.homeYawNear(), duration: 0.35, ease: 'power2.inOut' }, at);
}

// ---------- Land ----------

/** Pup: bows, sniffs, and starts digging (dirt flies out behind). */
const pupSidestep: Flourish = (a, tl, at) => {
  const base = a.b('base'), head = a.b('head');
  tl.to(base, { rx: 0.3, duration: 0.18, ease: 'power2.out' }, at);
  tl.to(a.b('tail1'), { rx: -0.6, duration: 0.18 }, at);
  yo(tl, a.b('tail1'), { ry: 0.8 }, 0.05, at, 11);
  yo(tl, head, { rx: 0.2 }, 0.06, at + 0.15, 5);
  tl.to(a.face, { blink: 0.4, duration: 0.1 }, at + 0.15);
  a.mouth('o', tl, at + 0.15);
  const dig = at + 0.42;
  a.mouth('open', tl, dig);
  tl.to(a.face, { blink: 0, eyeScale: 1.1, duration: 0.1 }, dig);
  yo(tl, a.b('legFL'), { rx: -1.1 }, 0.05, dig, 5);
  yo(tl, a.b('legFR'), { rx: -1.1 }, 0.05, dig + 0.05, 5);
  for (const t of [dig + 0.05, dig + 0.2]) tl.call(() => fx.clods(a.fxParent, a.above(0), a.sq, 4, false, a.forward().negate()), [], t);
  return dig + 0.3;
};

/** Horse: rears up with a whinny, front hooves kicking, then slams down. */
const horseDoubleJump: Flourish = (a, tl, at) => {
  const base = a.b('base');
  tl.to(base, { rx: a.rm ? -0.2 : -0.62, py: 0.08, duration: 0.28, ease: 'power2.out' }, at);
  tl.to(a.b('neck'), { rx: -0.35, duration: 0.25 }, at);
  tl.to(a.b('tail1'), { rx: -0.7, duration: 0.25 }, at);
  yo(tl, a.b('legFL'), { rx: -1.4 }, 0.09, at + 0.08, 3);
  yo(tl, a.b('legFR'), { rx: -1.4 }, 0.09, at + 0.13, 3);
  tl.to(a.face, { eyeScale: 1.15, duration: 0.1 }, at);
  a.mouth('open', tl, at + 0.1);
  const t1 = at + 0.52;
  tl.to(base, { rx: 0.08, py: 0, duration: 0.14, ease: 'power3.in' }, t1);
  tl.to(a.b('neck'), { rx: 0.1, duration: 0.14 }, t1);
  tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.8), [], t1 + 0.14);
  return t1 + 0.14;
};

/** Goat: lowers its horns and paws the ground. */
const goatHeadbutt: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  const base = a.b('base'), head = a.b('head');
  tl.to(head, { rx: 0.5, duration: 0.2 }, at);
  tl.to(base, { pz: -0.1, rx: 0.08, duration: 0.2, ease: 'power2.out' }, at);
  tl.to(a.b('body'), { sy: 0.92, duration: 0.2 }, at);
  tl.to(a.face, { brows: 1, blink: 0.25, duration: 0.1 }, at);
  a.mouth('frown', tl, at);
  yo(tl, a.b('legFR'), { rx: -0.7 }, 0.08, at + 0.15, 5);
  for (const t of [at + 0.23, at + 0.39, at + 0.55]) tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.4), [], t);
  yo(tl, a.b('beard'), { rx: 0.3 }, 0.08, at + 0.15, 5);
  return at + 0.62;
};

/** Elephant: rears on its back legs, trumpets, and stomps; a dust ring rushes out. */
const elephantStomp: Flourish = (a, tl, at) => {
  const base = a.b('base');
  const tr = [a.b('trunk1'), a.b('trunk2'), a.b('trunk3')];
  tl.to(base, { rx: a.rm ? -0.15 : -0.45, py: a.rm ? 0.04 : 0.14, duration: 0.3, ease: 'power2.out' }, at);
  tl.to(tr[0], { rx: -1.2, duration: 0.25 }, at);
  tl.to(tr[1], { rx: -0.8, duration: 0.25 }, at);
  tl.to(tr[2], { rx: -0.6, duration: 0.25 }, at);
  tl.to(a.b('earL'), { ry: -0.6, duration: 0.2 }, at);
  tl.to(a.b('earR'), { ry: 0.6, duration: 0.2 }, at);
  tl.to(a.b('legFL'), { rx: -0.9, duration: 0.25 }, at);
  tl.to(a.b('legFR'), { rx: -0.9, duration: 0.25 }, at);
  a.mouth('open', tl, at + 0.1);
  tl.to(a.face, { brows: 1, duration: 0.1 }, at + 0.2);
  const t1 = at + 0.42;
  tl.to(base, { rx: 0.04, py: 0, duration: 0.12, ease: 'power4.in' }, t1);
  tl.to(a.b('legFL'), { rx: 0, duration: 0.12, ease: 'power4.in' }, t1);
  tl.to(a.b('legFR'), { rx: 0, duration: 0.12, ease: 'power4.in' }, t1);
  const hit = t1 + 0.12;
  tl.fromTo(a.b('body'), { sy: 0.82, sx: 1.1, sz: 1.1 }, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', immediateRender: false }, hit);
  tl.call(() => {
    a.stomp(0.9);
    fx.shockRing(a.fxParent, a.above(0), a.sq, false);
  }, [], hit);
  return hit;
};

/** Cat: crouches, winds up a paw, and swats toward the target (the world drops the vase there). */
const catBlock: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  const paw = a.b('pawR');
  tl.to(a.b('body'), { sy: 0.86, duration: 0.2 }, at);
  yo(tl, a.b('tail3'), { ry: 0.7 }, 0.08, at, 5);
  tl.to(paw, { rx: -2.3, rz: -0.2, duration: 0.22, ease: 'back.out(2)' }, at + 0.06);
  tl.to(a.face, { blink: 0.35, brows: 0.6, duration: 0.1 }, at);
  a.mouth('o', tl, at + 0.06);
  const t1 = at + 0.4;
  tl.to(paw, { rx: -0.5, rz: 0.2, duration: 0.08, ease: 'power3.in' }, t1);
  tl.to(a.b('base'), { pz: 0.15, ry: -0.15, duration: 0.1, ease: 'power2.in' }, t1);
  tl.call(() => fx.stars(a.fxParent, a.bonePoint('pawR'), a.sq, a.rm ? 2 : 4, 0.35), [], t1 + 0.06);
  const hit = t1 + 0.08;
  // Smug follow-through: eyes half shut, a little smile, turn back.
  tl.to(a.face, { blink: 0.55, brows: 0, duration: 0.15 }, hit + 0.1);
  a.mouth('smile', tl, hit + 0.1);
  unaim(a, tl, hit + 0.35);
  return hit;
};

/** Pug: crouches, paws scramble, and it spins up for the zoomies. */
const pugEscape: Flourish = (a, tl, at) => {
  const body = a.b('body');
  tl.to(body, { sy: 0.8, sx: 1.1, sz: 1.1, duration: 0.15, ease: 'power2.out' }, at);
  tl.to(a.face, { brows: 1, eyeScale: 1.2, duration: 0.1 }, at);
  a.mouth('open', tl, at);
  yo(tl, a.b('pawL'), { rx: -0.8 }, 0.05, at + 0.1, 9);
  yo(tl, a.b('pawR'), { rx: -0.8 }, 0.05, at + 0.15, 9);
  if (a.rm) yo(tl, a.b('base'), { ry: 0.3 }, 0.12, at + 0.15, 3);
  else tl.to(a.object.rotation, { y: `+=${TAU * 2}`, duration: 0.58, ease: 'power2.in' }, at + 0.12);
  for (const t of [at + 0.3, at + 0.48, at + 0.62]) tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.6), [], t);
  return at + 0.7;
};

// ---------- Sea ----------

/** Crab: clacks its claws and crouches, legs splayed. */
const crabSidestep: Flourish = (a, tl, at) => {
  const cl = a.b('clawL'), cr = a.b('clawR');
  yo(tl, cl, { rx: -0.9, rz: 0.3 }, 0.08, at, 5);
  yo(tl, cr, { rx: -0.9, rz: -0.3 }, 0.08, at + 0.04, 5);
  yo(tl, a.b('jawL'), { rx: 0.5 }, 0.04, at, 9);
  yo(tl, a.b('jawR'), { rx: 0.5 }, 0.04, at + 0.04, 9);
  tl.to(a.face, { blink: 0.4, duration: 0.1 }, at);
  const t1 = at + 0.3;
  tl.to(a.b('body'), { sy: 0.78, sx: 1.12, sz: 1.12, duration: 0.18, ease: 'power2.out' }, t1);
  for (let j = 1; j <= 3; j++) {
    tl.to(a.b('legL' + j), { rz: 0.35, duration: 0.18 }, t1);
    tl.to(a.b('legR' + j), { rz: -0.35, duration: 0.18 }, t1);
  }
  tl.to(a.face, { brows: 1, duration: 0.1 }, t1);
  return t1 + 0.24;
};

/** Seahorse: rises, curls its tail, and puffs a big bubble that pops. */
const seahorseDoubleJump: Flourish = (a, tl, at) => {
  const base = a.b('base'), head = a.b('head');
  tl.to(base, { py: 0.18, duration: 0.3, ease: 'power2.out' }, at);
  tl.to(a.b('tail1'), { rx: 0.5, duration: 0.3 }, at);
  tl.to(head, { sx: 1.15, sy: 1.15, sz: 1.15, duration: 0.25, ease: 'sine.out' }, at);
  a.mouth('o', tl, at + 0.1);
  const grow = 0.42;
  tl.call(() => fx.bigBubble(a.fxParent, a.bonePoint('head').add(a.forward().multiplyScalar(a.sq * 0.35)), a.sq, grow), [], at + 0.12);
  tl.to(head, { sx: 1, sy: 1, sz: 1, duration: 0.3 }, at + 0.3);
  const pop = at + 0.12 + grow;
  tl.to(a.face, { eyeScale: 1.25, duration: 0.06 }, pop);
  yo(tl, a.b('fin'), { ry: 0.6 }, 0.03, at, 19);
  return pop;
};

/** Pufferfish: inflates to a spiky ball, fins buzzing. */
const pufferHeadbutt: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  const head = a.b('head');
  tl.to(head, { sx: 1.5, sy: 1.5, sz: 1.5, duration: 0.35, ease: 'back.out(2.5)' }, at);
  tl.to(a.face, { eyeScale: 1.25, brows: 1, duration: 0.15 }, at);
  a.mouth('o', tl, at);
  yo(tl, a.b('finL'), { ry: 0.7 }, 0.04, at, 11);
  yo(tl, a.b('finR'), { ry: -0.7 }, 0.04, at, 11);
  yo(tl, a.b('base'), { rz: 0.06 }, 0.05, at + 0.32, 3);
  tl.call(() => fx.bubbles(a.fxParent, a.above(a.height * 0.5), a.sq, 4, 0.6), [], at + 0.3);
  return at + 0.55;
};

/** Turtle: tucks in, the shell lifts and slams down; a splash ring rushes out. */
const turtleStomp: Flourish = (a, tl, at) => {
  const base = a.b('base');
  tl.to(a.b('head'), { sx: 0.35, sy: 0.35, sz: 0.35, pz: -0.09, duration: 0.18 }, at);
  for (const f of ['flipFL', 'flipFR', 'flipBL', 'flipBR']) tl.to(a.b(f), { sx: 0.3, sy: 0.3, sz: 0.3, duration: 0.18 }, at);
  const t1 = at + 0.18;
  tl.to(base, { py: a.rm ? 0.08 : 0.38, duration: 0.25, ease: 'power2.out' }, t1);
  if (!a.rm) tl.to(base, { ry: PI * 0.5, duration: 0.3, ease: 'sine.inOut' }, t1);
  yo(tl, a.b('lamp'), { sx: 1.7, sy: 1.7, sz: 1.7 }, 0.08, t1, 3);
  const t2 = t1 + 0.3;
  tl.to(base, { py: 0, ry: 0, duration: 0.12, ease: 'power4.in' }, t2);
  const hit = t2 + 0.12;
  tl.fromTo(a.b('body'), { sy: 0.8, sx: 1.12, sz: 1.12 }, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', immediateRender: false }, hit);
  tl.call(() => fx.shockRing(a.fxParent, a.above(0), a.sq, true), [], hit);
  return hit;
};

/** Octopus: puffs up, then squirts an ink arc onto the target (the world draws the ink cloud). */
const octopusBlock: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  tl.to(a.b('body'), { sy: 1.15, sx: 1.08, sz: 1.08, duration: 0.25, ease: 'sine.out' }, at);
  tl.to(a.b('head'), { rx: -0.2, duration: 0.25 }, at);
  for (const i of [0, 7]) tl.to(a.b(`t${i}a`), { rx: -0.5, duration: 0.25 }, at);
  a.mouth('o', tl, at);
  tl.to(a.face, { blink: 0.3, duration: 0.1 }, at);
  const t1 = at + 0.3;
  const fly = 0.38;
  tl.to(a.b('body'), { sy: 0.85, sx: 1.05, sz: 1.05, duration: 0.08, ease: 'power3.in' }, t1);
  tl.to(a.b('head'), { rx: 0.15, duration: 0.08 }, t1);
  tl.call(() => {
    const from = a.above(a.height * 0.4).add(a.forward().multiplyScalar(a.sq * 0.3));
    const to = target ? target.clone().setY(target.y + a.sq * 0.15) : a.above(0).add(a.forward().multiplyScalar(a.sq * 2));
    fx.inkArc(a.fxParent, from, to, a.sq, fly);
  }, [], t1 + 0.04);
  const hit = t1 + 0.04 + fly;
  tl.to(a.face, { blink: 0.55, duration: 0.15 }, hit);
  a.mouth('smile', tl, hit);
  unaim(a, tl, hit + 0.2);
  return hit;
};

/** Blobfish: wobbles harder and harder, then goes gloopy. */
const blobEscape: Flourish = (a, tl, at) => {
  const head = a.b('head');
  yo(tl, head, { sy: 1.22, sx: 0.86, sz: 0.86 }, 0.07, at, 5);
  yo(tl, a.b('base'), { rz: a.rm ? 0.03 : 0.1 }, 0.07, at, 5);
  tl.to(a.face, { blink: 0.5, duration: 0.15 }, at);
  a.mouth('frown', tl, at);
  const t1 = at + 0.42;
  tl.to(head, { sy: 0.62, sx: 1.3, sz: 1.3, duration: 0.28, ease: 'sine.in' }, t1);
  tl.to(a.b('body'), { sy: 0.85, duration: 0.28, ease: 'sine.in' }, t1);
  tl.to(a.b('finL'), { rz: -0.6, duration: 0.28 }, t1);
  tl.to(a.b('finR'), { rz: 0.6, duration: 0.28 }, t1);
  a.mouth('o', tl, t1 + 0.1);
  tl.call(() => fx.bubbles(a.fxParent, a.above(0.1), a.sq, 5, 0.5), [], t1 + 0.15);
  return t1 + 0.3;
};

/** Any other animal using a power it doesn't own (only reachable from tests or odd states): a pump and sparkle. */
export const genericFlourish: Flourish = (a, tl, at) => {
  const body = a.b('body');
  tl.to(body, { sy: 0.85, sx: 1.08, sz: 1.08, duration: 0.14 }, at);
  tl.to(body, { sy: 1.12, sx: 0.95, sz: 0.95, duration: 0.12 }, at + 0.14);
  yo(tl, a.b('base'), { py: a.rm ? 0.04 : 0.15 }, 0.12, at + 0.14, 1, 'power2.out');
  a.mouth('open', tl, at + 0.14);
  tl.call(() => fx.stars(a.fxParent, a.above(a.height), a.sq, 5, 0.45), [], at + 0.3);
  return at + 0.4;
};

export const FLOURISH: Record<Side, Record<PowerKind, Flourish>> = {
  land: { sidestep: pupSidestep, doubleJump: horseDoubleJump, headbutt: goatHeadbutt, stomp: elephantStomp, block: catBlock, escape: pugEscape },
  sea: { sidestep: crabSidestep, doubleJump: seahorseDoubleJump, headbutt: pufferHeadbutt, stomp: turtleStomp, block: octopusBlock, escape: blobEscape },
};

/** Camera/sound strength of each power's moment of effect (0 under reduced motion). */
export const POWER_INTENSITY: Record<PowerKind, number> = {
  sidestep: 0.2, doubleJump: 0.35, headbutt: 0.35, stomp: 0.85, block: 0.4, escape: 0.4,
};
