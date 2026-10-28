/**
 * Power flourishes: 6 powers x 2 sides, each in the animal's own character.
 * A flourish plays in place and returns the moment the power takes effect; the actor emits `power` then.
 * Travel is separate (integration calls moveTo with the matching style afterwards; a headbutt calls attack, see `charge`).
 * Every flourish follows the same beats: a quick anticipation, one strong key pose that reads at 390px from either
 * side of the board, the moment of effect (with a squash and, on heavy hits, a hit-stop), then follow-through.
 * Offsets are in square units, as in styles.ts. `target` is in the actor's parent space, or null.
 */
import * as THREE from 'three';
import type { PowerKind, Side } from '../contracts/types';
import type { Actor } from './actor';
import * as fx from './fx';
import * as vfx from './vfx';
import { freeze, hitStop } from './motion';

type TL = gsap.core.Timeline;
const PI = Math.PI;
const TAU = PI * 2;
const C = vfx.COLORS;

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
/** Pose amount: full, or small under reduced motion. */
const amt = (a: Actor, v: number, rm = 0.3) => (a.rm ? v * rm : v);
/** Where the snout is (parent space). */
const nose = (a: Actor, fwd = 0.22, up = 0) => a.bonePoint('head').addScaledVector(a.forward(), a.sq * fwd).add(new THREE.Vector3(0, a.sq * up, 0));
/** Sumo's "Dig in" reuses the pawn's sidestep with no target (or its own square). */
const isDigIn = (a: Actor, target: THREE.Vector3 | null) => !target || target.clone().sub(a.object.position).setY(0).length() < a.sq * 0.3;
/** `to` in the actor's own frame (x right, z forward), flat and unit length. */
function localDir(a: Actor, to: THREE.Vector3) {
  const d = to.clone().sub(a.object.position).setY(0);
  if (d.lengthSq() < 1e-8) return new THREE.Vector3(1, 0, 0);
  return d.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -a.object.rotation.y);
}
/** A hard landing: squash, hold through the hit-stop, then an elastic recovery. */
function slamSquash(a: Actor, tl: TL, at: number, k: number, hold: number) {
  const body = a.b('body');
  tl.to(body, { sy: 1 - k, sx: 1 + k * 0.6, sz: 1 + k * 0.6, duration: 0.03, ease: 'power3.out' }, at);
  tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.5, ease: 'elastic.out(1.15, 0.38)' }, at + 0.03 + hold);
}
/** Octopus tentacle lift (as in styles.ts): raise tentacle i by theta. */
function lift(i: number, th: number) {
  const ang = (i / 8) * TAU + PI / 8;
  return { rx: -th * Math.cos(ang), rz: th * Math.sin(ang) };
}

// ---------- Land ----------

/** Pup: a play bow with its tail a blur, a sniff, then digging like mad (dirt arcs out behind). Dig in: digs itself down. */
const pupSidestep: Flourish = (a, tl, at, target) => {
  const dig = isDigIn(a, target);
  const base = a.b('base'), head = a.b('head');
  // Play bow: chest down, bum up, front legs stretched out, ears up (the key pose).
  tl.to(base, { rx: amt(a, 0.34), duration: 0.16, ease: 'back.out(2)' }, at);
  tl.to(head, { rx: -0.3, duration: 0.16 }, at);
  for (const n of ['legFL', 'legFR']) tl.to(a.b(n), { rx: -0.7, duration: 0.16 }, at);
  tl.to(a.b('earL'), { rz: -0.45, duration: 0.12 }, at);
  tl.to(a.b('earR'), { rz: 0.45, duration: 0.12 }, at);
  tl.to(a.b('tail1'), { rx: -0.7, duration: 0.16 }, at);
  yo(tl, a.b('tail1'), { ry: 0.9 }, 0.045, at, 13);
  tl.to(a.face, { eyeScale: 1.15, duration: 0.1 }, at);
  a.mouth('open', tl, at);
  // Sniff sniff.
  yo(tl, head, { rx: 0.05 }, 0.05, at + 0.18, 3);
  // Dig: head down, front paws a blur, dirt flying out behind.
  const d = at + 0.36;
  const back = a.forward().negate();
  tl.to(head, { rx: 0.35, duration: 0.08 }, d);
  tl.to(a.face, { blink: 0.3, brows: 0.7, eyeScale: 1, duration: 0.08 }, d);
  yo(tl, a.b('legFL'), { rx: -1.3 }, 0.045, d, 7);
  yo(tl, a.b('legFR'), { rx: -1.3 }, 0.045, d + 0.045, 7);
  yo(tl, base, { rz: 0.05 }, 0.045, d, 7);
  const throws = dig ? [0, 0.09, 0.18, 0.27, 0.36] : [0, 0.1, 0.2];
  for (const t of throws) {
    tl.call(() => {
      const p = a.above(0).addScaledVector(a.forward(), a.sq * 0.15);
      vfx.debris(a.fxParent, p, a.sq, dig ? 4 : 3, { color: C.dirt, dir: dig && t > 0.15 ? undefined : back, spread: 0.6, up: 0.55, radius: 0.85, size: 0.9 });
    }, [], d + t);
  }
  tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.55, C.dust), [], d + 0.1);
  if (!dig) return d + 0.3;
  // Dig in: it sinks into its hole, bracing.
  tl.to(base, { py: -0.06, rx: 0.12, duration: 0.3, ease: 'power2.in' }, d + 0.12);
  return d + 0.42;
};

/** Horse: dips, rears up tall pawing the air with a snort (the key pose), then drops into a coiled crouch the first hop springs from. */
const horseDoubleJump: Flourish = (a, tl, at) => {
  const base = a.b('base'), body = a.b('body'), neck = a.b('neck');
  tl.to(body, { sy: 0.88, sx: 1.07, sz: 1.07, duration: 0.1, ease: 'power2.out' }, at);
  tl.to(base, { rx: amt(a, 0.1), duration: 0.1 }, at);
  const r = at + 0.1;
  tl.to(base, { rx: amt(a, -0.74), py: amt(a, 0.1), duration: 0.24, ease: 'back.out(1.8)' }, r);
  tl.to(body, { sy: 1.07, sx: 0.96, sz: 0.96, duration: 0.2 }, r);
  tl.to(neck, { rx: -0.45, duration: 0.22 }, r);
  tl.to(a.b('tail1'), { rx: -0.85, duration: 0.22 }, r);
  for (const n of ['legBL', 'legBR']) tl.to(a.b(n), { rx: 0.25, duration: 0.2 }, r);
  yo(tl, a.b('legFL'), { rx: -1.5 }, 0.08, r + 0.04, 3);
  yo(tl, a.b('legFR'), { rx: -1.5 }, 0.08, r + 0.09, 3);
  tl.to(a.face, { eyeScale: 1.2, brows: 0.5, duration: 0.1 }, r);
  a.mouth('open', tl, r);
  tl.call(() => vfx.steam(a.fxParent, nose(a, 0.25), a.forward().add(new THREE.Vector3(0, 0.6, 0)), a.sq, 3, { dist: 0.35, size: 0.28 }), [], r + 0.14);
  // Down onto all fours and into a crouch.
  const down = r + 0.36;
  tl.to(base, { rx: amt(a, 0.12), py: 0, duration: 0.12, ease: 'power3.in' }, down);
  for (const n of ['legFL', 'legFR', 'legBL', 'legBR']) tl.to(a.b(n), { rx: 0, duration: 0.12, ease: 'power3.in' }, down);
  tl.to(neck, { rx: 0.15, duration: 0.12 }, down);
  const E = down + 0.12;
  tl.to(body, { sy: 0.8, sx: 1.12, sz: 1.12, duration: 0.06, ease: 'power2.out' }, E);
  tl.to(a.face, { brows: 1, eyeScale: 1.1, duration: 0.08 }, E);
  tl.call(() => {
    fx.dust(a.fxParent, a.above(0).addScaledVector(a.forward(), a.sq * 0.2), a.sq, 0.75);
    a.markLanded();
  }, [], E);
  return E;
};

/** Goat: shifts its weight back, paws once, then rears on its hind legs with its horns tucked forward (the key pose), snorting. */
const goatHeadbutt: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  const base = a.b('base'), head = a.b('head'), body = a.b('body');
  tl.to(base, { pz: -0.1, duration: 0.12, ease: 'power2.out' }, at);
  tl.to(body, { sy: 0.9, duration: 0.12 }, at);
  yo(tl, a.b('legFR'), { rx: -0.8 }, 0.07, at, 1);
  tl.call(() => vfx.kick(a.fxParent, a.above(0).addScaledVector(a.forward(), a.sq * 0.1), a.forward().negate(), a.sq), [], at + 0.12);
  tl.to(a.face, { brows: 1, blink: 0.25, duration: 0.1 }, at);
  a.mouth('frown', tl, at);
  const r = at + 0.14;
  tl.to(base, { rx: amt(a, -0.5), py: amt(a, 0.1), pz: -0.14, duration: 0.24, ease: 'back.out(1.6)' }, r);
  tl.to(head, { rx: 0.65, duration: 0.22, ease: 'power2.out' }, r);
  tl.to(body, { sy: 1.05, sx: 0.97, sz: 0.97, duration: 0.2 }, r);
  for (const n of ['legFL', 'legFR']) tl.to(a.b(n), { rx: -1.0, duration: 0.2 }, r);
  for (const n of ['legBL', 'legBR']) tl.to(a.b(n), { rx: 0.2, duration: 0.2 }, r);
  yo(tl, a.b('beard'), { rx: 0.4 }, 0.08, r, 3);
  for (const t of [0.08, 0.26]) tl.call(() => vfx.steam(a.fxParent, nose(a, 0.18, -0.05), a.forward().add(new THREE.Vector3(0, -0.2, 0)), a.sq, 2, { dist: 0.3, size: 0.24, life: 0.32 }), [], r + t);
  // Hold the rear-up, trembling with effort: attack() charges straight out of this pose.
  if (!a.rm) yo(tl, base, { rz: 0.04 }, 0.04, r + 0.24, 3);
  return r + 0.42;
};

/** Elephant: crouches, rears up with trunk high and ears out and trumpets (the key pose), hangs, then slams down. */
const elephantStomp: Flourish = (a, tl, at) => {
  const base = a.b('base'), body = a.b('body');
  const tr = [a.b('trunk1'), a.b('trunk2'), a.b('trunk3')];
  tl.to(body, { sy: 0.9, sx: 1.05, sz: 1.05, duration: 0.1, ease: 'power2.out' }, at);
  tl.to(a.b('earL'), { ry: 0.2, duration: 0.1 }, at);
  tl.to(a.b('earR'), { ry: -0.2, duration: 0.1 }, at);
  const r = at + 0.1;
  tl.to(base, { rx: amt(a, -0.55), py: amt(a, 0.17), duration: 0.26, ease: 'back.out(1.5)' }, r);
  tl.to(body, { sy: 1.06, sx: 0.97, sz: 0.97, duration: 0.2 }, r);
  tl.to(tr[0], { rx: -1.3, duration: 0.24, ease: 'back.out(1.6)' }, r);
  tl.to(tr[1], { rx: -0.9, duration: 0.24 }, r + 0.02);
  tl.to(tr[2], { rx: -0.7, duration: 0.24 }, r + 0.04);
  tl.to(a.b('earL'), { ry: -0.85, duration: 0.2, ease: 'back.out(2)' }, r);
  tl.to(a.b('earR'), { ry: 0.85, duration: 0.2, ease: 'back.out(2)' }, r);
  for (const n of ['legFL', 'legFR']) tl.to(a.b(n), { rx: -1.0, duration: 0.24 }, r);
  a.mouth('open', tl, r + 0.08);
  tl.to(a.face, { brows: 1, eyeScale: 1.15, duration: 0.1 }, r + 0.1);
  // The trumpet: a blast of air and a few sparkles from the trunk tip.
  tl.call(() => {
    const tip = a.bonePoint('trunk3');
    vfx.steam(a.fxParent, tip, new THREE.Vector3(0, 1, 0).addScaledVector(a.forward(), 0.4), a.sq, 3, { dist: 0.45, size: 0.3 });
    vfx.sparkles(a.fxParent, tip, a.sq, 3, { color: C.gold, radius: 0.3, size: 0.24, rise: 0.35 });
  }, [], r + 0.16);
  if (!a.rm) yo(tl, tr[2], { rz: 0.3 }, 0.05, r + 0.22, 3);
  // Slam: everything comes down at once, the trunk whipping down a beat later.
  const s = r + 0.36;
  tl.to(base, { rx: amt(a, 0.08), py: 0, duration: 0.11, ease: 'power4.in' }, s);
  for (const n of ['legFL', 'legFR']) tl.to(a.b(n), { rx: 0, duration: 0.11, ease: 'power4.in' }, s);
  tl.to(tr[0], { rx: 0.2, duration: 0.14, ease: 'power3.in' }, s + 0.02);
  tl.to(tr[1], { rx: 0.25, duration: 0.14 }, s + 0.04);
  tl.to(tr[2], { rx: 0.3, duration: 0.14 }, s + 0.06);
  const hit = s + 0.11;
  const hs = hitStop(1.2);
  slamSquash(a, tl, hit, amt(a, 0.26, 0.4), hs);
  tl.call(() => {
    freeze(hs);
    a.stomp(0.9);
    const g = a.above(0);
    vfx.shockwave(a.fxParent, g, a.sq, { radius: 1.75, color: C.white, puffs: C.dust });
    vfx.debris(a.fxParent, g, a.sq, 10, { color: C.rock, up: 0.55, radius: 1.2, size: 0.85 });
  }, [], hit);
  tl.to(a.face, { blink: 0.8, duration: 0.03 }, hit);
  tl.to(a.face, { blink: 0, eyeScale: 1.15, duration: 0.12 }, hit + hs + 0.1);
  // Follow-through: ears flap, trunk bounces back up.
  yo(tl, a.b('earL'), { ry: -0.5 }, 0.08, hit + hs, 3);
  yo(tl, a.b('earR'), { ry: 0.5 }, 0.08, hit + hs + 0.02, 3);
  tl.to(tr[0], { rx: -0.3, duration: 0.5, ease: 'elastic.out(1, 0.4)' }, hit + hs + 0.05);
  return hit;
};

/** Cat: crouches low with a bum wiggle and a paw cocked high (the key pose), swats at the square, then licks its paw, smug. */
const catBlock: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  const paw = a.b('pawR'), base = a.b('base'), head = a.b('head');
  tl.to(a.b('body'), { sy: 0.82, duration: 0.14, ease: 'power2.out' }, at);
  tl.to(base, { rx: amt(a, 0.12), duration: 0.14 }, at);
  if (!a.rm) yo(tl, base, { rz: 0.09 }, 0.05, at + 0.06, 5);
  yo(tl, a.b('tail3'), { ry: 0.8 }, 0.07, at, 5);
  tl.to(paw, { rx: -2.4, rz: -0.25, duration: 0.2, ease: 'back.out(2)' }, at + 0.12);
  tl.to(a.face, { blink: 0.4, brows: 0.7, duration: 0.1 }, at);
  a.mouth('o', tl, at + 0.06);
  const sw = at + 0.42;
  tl.to(paw, { rx: -0.4, rz: 0.25, duration: 0.06, ease: 'power3.in' }, sw);
  tl.to(base, { pz: 0.16, ry: -0.18, rx: amt(a, 0.05), duration: 0.08, ease: 'power2.in' }, sw);
  tl.call(() => {
    const from = a.bonePoint('pawR');
    const to = target ?? a.above(0).addScaledVector(a.forward(), a.sq * 1.5);
    vfx.speedLines(a.fxParent, from, from.clone().lerp(to, 0.5), a.sq, { n: 4, dur: 0.08, lo: (from.y - a.object.position.y) / a.sq - 0.15, hi: (from.y - a.object.position.y) / a.sq + 0.1 });
  }, [], sw);
  const hit = sw + 0.07;
  tl.call(() => {
    const p = (target ?? a.above(0).addScaledVector(a.forward(), a.sq * 1.5)).clone();
    vfx.sparkles(a.fxParent, p.clone().setY(p.y + a.sq * 0.35), a.sq, 8, { color: C.gold, radius: 0.45, size: 0.3, rise: 0.3 });
    fx.dust(a.fxParent, p, a.sq, 0.6);
  }, [], hit);
  // Smug follow-through: paw up to the mouth for a lick, eyes half shut, tail curls up.
  const f = hit + 0.14;
  tl.to(paw, { rx: -1.9, rz: 0.35, duration: 0.18, ease: 'power2.out' }, f);
  tl.to(head, { rx: 0.18, rz: -0.18, duration: 0.18 }, f);
  yo(tl, head, { rx: 0.05 }, 0.07, f + 0.18, 3);
  tl.to(a.b('tail1'), { rx: -0.9, duration: 0.25 }, f);
  tl.to(a.face, { blink: 0.6, brows: 0, duration: 0.15 }, f);
  a.mouth('smile', tl, f);
  unaim(a, tl, f + 0.45);
  return hit;
};

/** Pug: crouches, paws scrabble on the spot kicking dust, then it spins up into the zoomies (the dash follows). */
const pugEscape: Flourish = (a, tl, at) => {
  const body = a.b('body'), base = a.b('base');
  tl.to(body, { sy: 0.8, sx: 1.1, sz: 1.1, duration: 0.12, ease: 'power2.out' }, at);
  tl.to(base, { rx: amt(a, 0.15), duration: 0.12 }, at);
  tl.to(a.face, { brows: 1, eyeScale: 1.25, duration: 0.1 }, at);
  a.mouth('open', tl, at);
  yo(tl, a.b('pawL'), { rx: -0.9 }, 0.04, at + 0.08, 9);
  yo(tl, a.b('pawR'), { rx: -0.9 }, 0.04, at + 0.12, 9);
  for (const t of [0.1, 0.22, 0.34]) tl.call(() => vfx.kick(a.fxParent, a.above(0), a.forward().negate(), a.sq), [], at + t);
  if (a.rm) {
    yo(tl, base, { ry: 0.3 }, 0.12, at + 0.15, 3);
  } else {
    tl.to(a.object.rotation, { y: `+=${TAU * 2}`, duration: 0.52, ease: 'power2.in' }, at + 0.18);
    tl.call(() => vfx.spinLines(a.fxParent, a.above(0), a.sq, 6, 0.25, 0.45), [], at + 0.3);
  }
  tl.to(body, { sy: 1.12, sx: 0.94, sz: 0.94, duration: 0.14 }, at + 0.52);
  tl.to(base, { rx: 0, duration: 0.14 }, at + 0.52);
  return at + 0.7;
};

// ---------- Sea ----------

/** Crab: snip-snip with claws raised in a V (the key pose), then leans away from where it's going, legs bunched. Dig in: shimmies into the sand. */
const crabSidestep: Flourish = (a, tl, at, target) => {
  const dig = isDigIn(a, target);
  const cl = a.b('clawL'), cr = a.b('clawR'), base = a.b('base'), body = a.b('body');
  tl.to(cl, { rx: -1.05, rz: 0.45, duration: 0.14, ease: 'back.out(2.5)' }, at);
  tl.to(cr, { rx: -1.05, rz: -0.45, duration: 0.14, ease: 'back.out(2.5)' }, at);
  yo(tl, a.b('jawL'), { rx: 0.6 }, 0.045, at + 0.1, 5);
  yo(tl, a.b('jawR'), { rx: 0.6 }, 0.045, at + 0.14, 5);
  for (const [t, c] of [[0.16, 'clawR'], [0.25, 'clawL']] as const) {
    tl.call(() => vfx.sparkles(a.fxParent, a.bonePoint(c).add(new THREE.Vector3(0, a.sq * 0.12, 0)), a.sq, 2, { radius: 0.12, size: 0.2, life: 0.28 }), [], at + t);
  }
  tl.to(a.face, { blink: 0.35, brows: 0.8, duration: 0.1 }, at);
  const t1 = at + 0.26;
  for (let j = 1; j <= 3; j++) {
    tl.to(a.b('legL' + j), { rz: 0.35, duration: 0.16 }, t1);
    tl.to(a.b('legR' + j), { rz: -0.35, duration: 0.16 }, t1);
  }
  tl.to(body, { sy: 0.8, sx: 1.12, sz: 1.12, duration: 0.16, ease: 'power2.out' }, t1);
  if (!dig) {
    // Lean away from the way it's about to scuttle, then it's off.
    const l = localDir(a, target!);
    tl.to(base, { rz: amt(a, l.x * 0.24), px: -l.x * 0.08, duration: 0.18, ease: 'power2.out' }, t1);
    tl.to(a.face, { brows: 1, blink: 0.15, duration: 0.1 }, t1);
    tl.call(() => fx.dust(a.fxParent, a.above(0), a.sq, 0.45, C.sand), [], t1 + 0.12);
    return at + 0.5;
  }
  // Dig in: shimmy down into the sand, sand spraying, claws driven down.
  if (!a.rm) yo(tl, base, { rz: 0.12 }, 0.06, t1, 5);
  tl.to(base, { py: -0.06, duration: 0.32, ease: 'power2.in' }, t1);
  for (const t of [0.04, 0.16, 0.28]) tl.call(() => vfx.debris(a.fxParent, a.above(0), a.sq, 4, { color: C.sand, up: 0.4, radius: 0.7, size: 0.85 }), [], t1 + t);
  tl.to(cl, { rx: 0.5, rz: 0.2, duration: 0.1, ease: 'power3.in' }, t1 + 0.26);
  tl.to(cr, { rx: 0.5, rz: -0.2, duration: 0.1, ease: 'power3.in' }, t1 + 0.26);
  return t1 + 0.36;
};

/** Seahorse: rises, coils its tail like a spring and blows a big bubble (the key pose); the pop launches the first hop. */
const seahorseDoubleJump: Flourish = (a, tl, at) => {
  const base = a.b('base'), head = a.b('head'), body = a.b('body');
  tl.to(base, { py: amt(a, 0.16), duration: 0.24, ease: 'sine.out' }, at);
  tl.to(head, { sx: 1.12, sy: 1.12, sz: 1.12, duration: 0.2, ease: 'sine.out' }, at);
  tl.to(a.b('tail1'), { rx: 0.55, duration: 0.28, ease: 'back.out(2)' }, at);
  tl.to(a.b('tail2'), { rx: 0.7, duration: 0.28, ease: 'back.out(2)' }, at + 0.03);
  tl.to(a.b('tail3'), { rx: 0.9, duration: 0.28, ease: 'back.out(2)' }, at + 0.06);
  yo(tl, a.b('fin'), { ry: 0.6 }, 0.03, at, 15);
  a.mouth('o', tl, at + 0.08);
  const grow = 0.34;
  tl.call(() => fx.bigBubble(a.fxParent, nose(a, 0.35), a.sq, grow), [], at + 0.1);
  tl.to(head, { sx: 1, sy: 1, sz: 1, duration: 0.2 }, at + 0.28);
  // Coiled: squash down just before the pop.
  tl.to(body, { sy: 0.85, sx: 1.08, sz: 1.08, duration: 0.1, ease: 'power2.out' }, at + 0.34);
  const pop = at + 0.1 + grow;
  tl.to(a.face, { eyeScale: 1.3, duration: 0.05 }, pop);
  a.mouth('open', tl, pop);
  tl.to(base, { py: amt(a, 0.05), duration: 0.08, ease: 'power2.in' }, pop);
  tl.call(() => {
    vfx.sparkles(a.fxParent, nose(a, 0.35), a.sq, 5, { radius: 0.35, size: 0.26, life: 0.35 });
    a.markLanded();
  }, [], pop);
  return pop + 0.04;
};

/** Pufferfish: sucks in, then puffs up in two gulps into a huge ball and leans back, trembling (the key pose). */
const pufferHeadbutt: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  const head = a.b('head'), base = a.b('base');
  tl.to(head, { sx: 0.85, sy: 0.85, sz: 0.85, duration: 0.1, ease: 'power2.in' }, at);
  a.mouth('o', tl, at);
  tl.to(head, { sx: 1.3, sy: 1.3, sz: 1.3, duration: 0.12, ease: 'back.out(3)' }, at + 0.1);
  tl.to(head, { sx: 1.62, sy: 1.62, sz: 1.62, duration: 0.14, ease: 'back.out(3)' }, at + 0.26);
  tl.to(a.face, { eyeScale: 1.35, brows: 1, duration: 0.12 }, at + 0.1);
  for (const t of [0.1, 0.26]) tl.call(() => fx.bubbles(a.fxParent, nose(a, 0.3), a.sq, 2, 0.5), [], at + t);
  yo(tl, a.b('finL'), { ry: 0.7 }, 0.035, at, 13);
  yo(tl, a.b('finR'), { ry: -0.7 }, 0.035, at, 13);
  tl.to(base, { pz: -0.12, rx: amt(a, -0.18), duration: 0.18, ease: 'power2.out' }, at + 0.3);
  if (!a.rm) yo(tl, base, { rz: 0.05 }, 0.04, at + 0.4, 3);
  return at + 0.56;
};

/** Turtle: tucks into its shell, spins up high, hangs, then slams down shell-first; a splash ring rushes out and it pops back out, dazed. */
const turtleStomp: Flourish = (a, tl, at) => {
  const base = a.b('base');
  const tuck = ['head', 'flipFL', 'flipFR', 'flipBL', 'flipBR'];
  tl.to(a.b('head'), { sx: 0.35, sy: 0.35, sz: 0.35, pz: -0.09, duration: 0.14, ease: 'power2.in' }, at);
  for (const f of tuck.slice(1)) tl.to(a.b(f), { sx: 0.3, sy: 0.3, sz: 0.3, duration: 0.14, ease: 'power2.in' }, at);
  tl.to(a.b('body'), { sy: 0.85, sx: 1.08, sz: 1.08, duration: 0.14 }, at);
  const up = at + 0.14;
  tl.to(base, { py: amt(a, 0.42, 0.2), duration: 0.26, ease: 'power2.out' }, up);
  tl.to(a.b('body'), { sy: 1.1, sx: 0.95, sz: 0.95, duration: 0.12 }, up);
  if (!a.rm) tl.to(base, { ry: PI * 1.5, duration: 0.3, ease: 'sine.inOut' }, up);
  yo(tl, a.b('lamp'), { sx: 1.8, sy: 1.8, sz: 1.8 }, 0.07, up, 3);
  tl.call(() => fx.bubbles(a.fxParent, a.above(0.15), a.sq, 3, 0.4), [], up + 0.05);
  const s = up + 0.32;
  tl.to(base, { py: 0, duration: 0.11, ease: 'power4.in' }, s);
  if (!a.rm) tl.to(base, { ry: TAU, duration: 0.11, ease: 'power2.in' }, s);
  const hit = s + 0.11;
  const hs = hitStop(1.2);
  tl.set(base, { ry: 0 }, hit);
  slamSquash(a, tl, hit, amt(a, 0.26, 0.4), hs);
  tl.call(() => {
    freeze(hs);
    const g = a.above(0);
    vfx.shockwave(a.fxParent, g, a.sq, { radius: 1.65, color: C.foam, puffs: C.water });
    vfx.droplets(a.fxParent, g, a.sq, 10, { up: 0.55, radius: 0.9 });
    vfx.debris(a.fxParent, g, a.sq, 6, { color: C.sand, up: 0.35, radius: 0.9, size: 0.8 });
  }, [], hit);
  // Pops back out of its shell, dazed.
  const out = hit + hs + 0.08;
  for (const f of tuck) tl.to(a.b(f), { sx: 1, sy: 1, sz: 1, pz: 0, duration: 0.4, ease: 'elastic.out(1.2, 0.45)' }, out);
  tl.to(a.face, { blink: 0.6, duration: 0.08 }, out);
  tl.to(a.face, { blink: 0, eyeScale: 1.2, duration: 0.1 }, out + 0.2);
  return hit;
};

/** Octopus: draws a big breath with tentacles curling up, then squirts an ink arc onto the square, jetting back from the recoil. */
const octopusBlock: Flourish = (a, tl, at0, target) => {
  const at = aim(a, tl, at0, target);
  const body = a.b('body'), base = a.b('base');
  tl.to(body, { sy: 1.2, sx: 1.1, sz: 1.1, duration: 0.26, ease: 'sine.out' }, at);
  tl.to(a.b('head'), { rx: -0.25, duration: 0.26 }, at);
  for (let i = 0; i < 8; i++) tl.to(a.b(`t${i}a`), { ...lift(i, 0.4), duration: 0.26, ease: 'sine.out' }, at);
  a.mouth('o', tl, at);
  tl.to(a.face, { blink: 0.25, eyeScale: 1.15, duration: 0.1 }, at);
  const sq = at + 0.3;
  const fly = 0.3;
  tl.to(body, { sy: 0.82, sx: 1.12, sz: 1.12, duration: 0.06, ease: 'power3.in' }, sq);
  tl.to(a.b('head'), { rx: 0.15, duration: 0.06 }, sq);
  tl.to(base, { pz: -0.14, duration: 0.14, ease: 'power2.out' }, sq);
  for (let i = 0; i < 8; i++) tl.to(a.b(`t${i}a`), { ...lift(i, -0.15), duration: 0.12, ease: 'power2.out' }, sq);
  tl.call(() => {
    const from = a.above(a.height * 0.4).addScaledVector(a.forward(), a.sq * 0.3);
    const to = target ? target.clone().setY(target.y + a.sq * 0.12) : a.above(0).addScaledVector(a.forward(), a.sq * 2);
    vfx.arc(a.fxParent, from, to, a.sq, { dur: fly });
  }, [], sq + 0.03);
  const hit = sq + 0.03 + fly;
  tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.4, ease: 'elastic.out(1, 0.45)' }, sq + 0.1);
  tl.to(a.face, { blink: 0.55, eyeScale: 1, duration: 0.15 }, hit);
  a.mouth('smile', tl, hit);
  yo(tl, a.b('t3a'), lift(3, 0.9), 0.12, hit + 0.05, 3);
  unaim(a, tl, hit + 0.25);
  return hit;
};

/** Blobfish: wobbles harder and harder, sweating, lets out a sigh, then melts into a gloop. */
const blobEscape: Flourish = (a, tl, at) => {
  const head = a.b('head');
  yo(tl, head, { sy: 1.12, sx: 0.92, sz: 0.92 }, 0.08, at, 1);
  yo(tl, head, { sy: 1.26, sx: 0.84, sz: 0.84 }, 0.06, at + 0.16, 3);
  yo(tl, a.b('base'), { rz: amt(a, 0.1) }, 0.06, at + 0.1, 5);
  tl.to(a.face, { blink: 0.5, duration: 0.15 }, at);
  a.mouth('frown', tl, at);
  for (const t of [0.14, 0.3]) tl.call(() => vfx.droplets(a.fxParent, a.bonePoint('head').add(new THREE.Vector3(0, a.sq * 0.2, 0)), a.sq, 3, { up: 0.3, radius: 0.3, size: 0.55, life: 0.4 }), [], at + t);
  const t1 = at + 0.42;
  a.mouth('o', tl, t1 - 0.06);
  tl.call(() => vfx.steam(a.fxParent, nose(a, 0.25, -0.05), a.forward().add(new THREE.Vector3(0, -0.4, 0)), a.sq, 3, { dist: 0.35, size: 0.3, color: C.foam }), [], t1 - 0.04);
  tl.to(head, { sy: 0.6, sx: 1.32, sz: 1.32, duration: 0.26, ease: 'sine.in' }, t1);
  tl.to(a.b('body'), { sy: 0.85, duration: 0.26, ease: 'sine.in' }, t1);
  tl.to(a.b('finL'), { rz: -0.7, duration: 0.26 }, t1);
  tl.to(a.b('finR'), { rz: 0.7, duration: 0.26 }, t1);
  tl.call(() => fx.bubbles(a.fxParent, a.above(0.1), a.sq, 5, 0.5), [], t1 + 0.14);
  return t1 + 0.28;
};

/** Any other animal using a power it doesn't own (only reachable from tests or odd states): a pump and sparkle. */
export const genericFlourish: Flourish = (a, tl, at) => {
  const body = a.b('body');
  tl.to(body, { sy: 0.85, sx: 1.08, sz: 1.08, duration: 0.14 }, at);
  tl.to(body, { sy: 1.12, sx: 0.95, sz: 0.95, duration: 0.12 }, at + 0.14);
  yo(tl, a.b('base'), { py: amt(a, 0.15) }, 0.12, at + 0.14, 1, 'power2.out');
  a.mouth('open', tl, at + 0.14);
  tl.call(() => vfx.sparkles(a.fxParent, a.above(a.height), a.sq, 6, { color: C.gold, radius: 0.45 }), [], at + 0.3);
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

// ---------- headbutt charge ----------

/**
 * The headbutt's strike, straight out of the held wind-up (attack() calls this after a headbutt powerUp).
 * One explosive charge to the victim, speed lines behind; returns the impact time. The actor adds the impact frame.
 */
export function charge(a: Actor, tl: TL, v: Actor): number {
  const sq = a.sq;
  const from = a.object.position.clone();
  const vp = v.object.parent ? a.toParent(v.worldPos()) : v.object.position.clone();
  const d = vp.clone().sub(from).setY(0);
  const dist = d.length();
  const dir = dist > 1e-4 ? d.clone().divideScalar(dist) : a.forward();
  const stop = 0.6 * sq;
  const contact = dist > stop ? vp.clone().sub(dir.clone().multiplyScalar(stop)).setY(from.y) : from.clone();
  tl.add(a.turnTween(Math.atan2(dir.x, dir.z), 0.06), 0);
  const run = Math.min(0.22, Math.max(0.1, 0.1 + ((dist - stop) / sq) * 0.07));
  const base = a.b('base'), body = a.b('body'), head = a.b('head');
  const p = { k: 0 };
  tl.to(p, { k: 1, duration: run, ease: 'power2.in', onUpdate: () => a.object.position.lerpVectors(from, contact, p.k) }, 0);
  tl.call(() => {
    vfx.speedLines(a.fxParent, from, contact, sq, { n: 6, dur: run, lo: 0.15, hi: a.height * 0.8 });
    vfx.kick(a.fxParent, a.above(0), dir.clone().negate(), sq);
  }, [], 0);
  if (a.side === 'land') {
    // Goat: drops from the rear-up into a horns-first lunge, legs at full stretch.
    tl.to(base, { rx: amt(a, 0.3), py: 0, pz: 0, rz: 0, duration: run, ease: 'power2.in' }, 0);
    tl.to(body, { sy: 0.92, sx: 0.94, sz: 1.22, duration: run, ease: 'power2.in' }, 0);
    for (const n of ['legFL', 'legFR']) tl.to(a.b(n), { rx: -0.7, duration: run }, 0);
    for (const n of ['legBL', 'legBR']) tl.to(a.b(n), { rx: 0.7, duration: run }, 0);
    tl.to(a.b('beard'), { rx: -0.5, duration: run }, 0);
  } else {
    // Pufferfish: lets go like a balloon, stretched long, fins swept back.
    tl.to(base, { rx: amt(a, 0.15), pz: 0, rz: 0, duration: run, ease: 'power2.in' }, 0);
    tl.to(head, { sx: 1.38, sy: 1.38, sz: 2.0, duration: run, ease: 'power2.in' }, 0);
    tl.to(a.b('finL'), { ry: 1.0, duration: run }, 0);
    tl.to(a.b('finR'), { ry: -1.0, duration: run }, 0);
  }
  const hit = run;
  // Contact: squashed flat against the victim, held through the hit-stop, then a recoil.
  const hs = hitStop(1.25);
  if (a.side === 'land') {
    tl.to(body, { sz: 0.78, sy: 1.08, sx: 1.12, duration: 0.03, ease: 'power3.out' }, hit);
    tl.to(head, { rx: 0.25, duration: 0.03 }, hit);
    tl.to(body, { sz: 1, sy: 1, sx: 1, duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, hit + 0.03 + hs);
    tl.to(base, { rx: 0, pz: -0.12, duration: 0.18, ease: 'power2.out' }, hit + 0.03 + hs);
  } else {
    tl.to(head, { sz: 1.05, sx: 1.9, sy: 1.8, duration: 0.03, ease: 'power3.out' }, hit);
    tl.to(head, { sz: 1.3, sx: 1.3, sy: 1.3, duration: 0.3, ease: 'elastic.out(1, 0.45)' }, hit + 0.03 + hs);
    tl.call(() => vfx.steam(a.fxParent, a.bonePoint('head'), dir.clone().negate(), sq, 3, { color: C.foam, dist: 0.4, size: 0.3 }), [], hit + hs + 0.04);
  }
  tl.to(a.face, { blink: 0.7, duration: 0.03 }, hit);
  tl.to(a.face, { blink: 0, eyeScale: 1.2, duration: 0.1 }, hit + hs + 0.08);
  return hit;
}
