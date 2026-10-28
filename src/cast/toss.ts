/**
 * Raid "pass and run": the throw toward a teammate, and the catch.
 * Same beats as the powers: turn to face the catcher, a quick wind-up, the release (about 0.3s in), then follow-through.
 * Built from how each animal holds a treasure (party.ts): mouth flick (dogs, horse, goat, cat), trunk toss (elephant),
 * claw fling (crab), tentacle whip (octopus), head-bob launch (the four that balance it on their head).
 * The treasure itself flies with the world's `flyTreasure`; the actor hides its copy at the release.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import type { Actor } from './actor';
import { holdOf } from './party';
import * as vfx from './vfx';

type TL = gsap.core.Timeline;
const PI = Math.PI;
const TAU = PI * 2;
const C = vfx.COLORS;
/** When the treasure leaves the animal (seconds into the toss). */
export const RELEASE = 0.3;

const yo = (tl: TL, o: object, vars: gsap.TweenVars, dur: number, at: number, repeat = 1, ease = 'sine.inOut') =>
  tl.to(o, { ...vars, duration: dur, yoyo: true, repeat, ease }, at);
const amt = (a: Actor, v: number, rm = 0.3) => (a.rm ? v * rm : v);
/** Octopus tentacle lift (as in styles.ts): raise tentacle i by theta. */
function lift(i: number, th: number) {
  const ang = (i / 8) * TAU + PI / 8;
  return { rx: -th * Math.cos(ang), rz: th * Math.sin(ang) };
}

/**
 * Pose the throw on `tl` toward `target` (parent space) and return the release time.
 * The follow-through runs on after it; the caller hides the treasure at the release.
 */
export function tossPose(a: Actor, tl: TL, target: THREE.Vector3): number {
  const d = target.clone().sub(a.object.position).setY(0);
  if (d.lengthSq() > 1e-6) tl.add(a.turnTween(Math.atan2(d.x, d.z), 0.16), 0);
  const { mode } = holdOf(a.side, a.kind);
  if (mode === 'mouth') mouthFlick(a, tl);
  else if (mode === 'trunk') trunkToss(a, tl);
  else if (mode === 'claw') clawFling(a, tl);
  else if (mode === 'tentacle') tentacleWhip(a, tl);
  else headLaunch(a, tl);
  a.mouth('open', tl, RELEASE - 0.02);
  tl.to(a.face, { eyeScale: 1.2, brows: 0, blink: 0, duration: 0.08 }, RELEASE);
  a.mouth('smile', tl, RELEASE + 0.3);
  tl.to(a.face, { eyeScale: 1, duration: 0.25 }, RELEASE + 0.35);
  tl.to(a.object.rotation, { y: () => a.homeYawNear(), duration: 0.35, ease: 'power2.inOut' }, RELEASE + 0.28);
  return RELEASE;
}

/** Release puff where the treasure leaves: a few sparkles and short speed lines toward the catcher. */
export function releaseFx(a: Actor, from: THREE.Vector3, target: THREE.Vector3) {
  vfx.sparkles(a.fxParent, from, a.sq, a.rm ? 2 : 5, { radius: 0.3, size: 0.2, color: C.white, life: 0.3, stagger: 0.05 });
  const to = from.clone().lerp(target.clone().setY(from.y), 0.5);
  vfx.speedLines(a.fxParent, from, to, a.sq, { n: 3, dur: 0.22, lo: 0.1, hi: 0.3, color: C.white });
}

/** Dogs, horse, goat, cat: scoop the head down, then flick it up and forward, letting go at the top. */
function mouthFlick(a: Actor, tl: TL) {
  const base = a.b('base'), body = a.b('body'), head = a.b('head');
  const horse = a.kind === 'n';
  // Wind-up: weight forward, nose down, focused.
  tl.to(base, { rx: amt(a, 0.14), duration: 0.16, ease: 'power2.out' }, 0);
  tl.to(head, { rx: amt(a, 0.5), duration: 0.16, ease: 'power2.out' }, 0);
  tl.to(body, { sy: 0.9, sx: 1.05, sz: 1.05, duration: 0.16 }, 0);
  if (horse) tl.to(a.b('neck'), { rx: amt(a, 0.4), duration: 0.16 }, 0);
  tl.to(a.face, { brows: 0.6, blink: 0.25, duration: 0.1 }, 0);
  // Flick: fastest at the release.
  const f = RELEASE - 0.11;
  tl.to(head, { rx: amt(a, -0.62), duration: 0.11, ease: 'power2.in' }, f);
  tl.to(base, { rx: amt(a, -0.16), py: amt(a, 0.05), duration: 0.11, ease: 'power2.in' }, f);
  tl.to(body, { sy: 1.1, sx: 0.95, sz: 0.95, duration: 0.11 }, f);
  if (horse) tl.to(a.b('neck'), { rx: amt(a, -0.5), duration: 0.11, ease: 'power2.in' }, f);
  // The cat bats it off with a paw too; the goat's beard swings.
  if (a.kind === 'q') {
    tl.to(a.b('pawR'), { rx: -1.3, duration: 0.1, ease: 'power2.in' }, f + 0.02);
    tl.to(a.b('pawR'), { rx: 0, duration: 0.3, ease: 'back.out(2)' }, RELEASE + 0.12);
  }
  if (a.kind === 'b') yo(tl, a.b('beard'), { rx: -0.5 }, 0.1, RELEASE, 3);
  // Follow-through: head overshoots, settles; a happy tail wag.
  const r = RELEASE;
  tl.to(head, { rx: amt(a, -0.2), duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, r + 0.02);
  tl.to(base, { rx: 0, py: 0, duration: 0.35, ease: 'back.out(2)' }, r + 0.04);
  tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, r + 0.04);
  if (horse) tl.to(a.b('neck'), { rx: 0, duration: 0.4, ease: 'elastic.out(1, 0.45)' }, r + 0.02);
  if (!a.rm && a.bone('tail1')) yo(tl, a.b('tail1'), { ry: 0.7 }, 0.06, r + 0.05, 5);
}

/** Elephant: curls the trunk right back, then whips it forward and lets go at the front of the swing. */
function trunkToss(a: Actor, tl: TL) {
  const base = a.b('base'), head = a.b('head');
  const t1 = a.b('trunk1'), t2 = a.b('trunk2'), t3 = a.b('trunk3');
  tl.to(base, { rx: amt(a, -0.07), duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(head, { rx: amt(a, -0.15), duration: 0.18 }, 0);
  tl.to(t1, { rx: amt(a, -0.45), duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(t2, { rx: amt(a, -0.6), duration: 0.18 }, 0.02);
  tl.to(t3, { rx: amt(a, -0.5), duration: 0.18 }, 0.04);
  tl.to(a.b('earL'), { ry: -0.45, duration: 0.14 }, 0);
  tl.to(a.b('earR'), { ry: 0.45, duration: 0.14 }, 0);
  tl.to(a.face, { brows: 0.5, duration: 0.1 }, 0);
  // The whip: each joint a beat after the one before.
  const f = RELEASE - 0.1;
  tl.to(t1, { rx: amt(a, 1.0), rz: amt(a, -1.2), duration: 0.1, ease: 'power2.in' }, f);
  tl.to(t2, { rx: amt(a, 0.6), duration: 0.09, ease: 'power2.in' }, f + 0.02);
  tl.to(t3, { rx: amt(a, 0.6), duration: 0.08, ease: 'power2.in' }, f + 0.03);
  tl.to(head, { rx: amt(a, 0.15), duration: 0.1 }, f);
  tl.to(base, { rx: amt(a, 0.08), duration: 0.1 }, f);
  // Follow-through: the trunk swings back loose, ears flap.
  const r = RELEASE;
  for (const [o, dl] of [[t1, 0.02], [t2, 0.05], [t3, 0.08]] as const) tl.to(o, { rx: 0, rz: 0, duration: 0.55, ease: 'elastic.out(1, 0.35)' }, r + dl);
  tl.to(head, { rx: 0, duration: 0.35, ease: 'back.out(2)' }, r + 0.05);
  tl.to(base, { rx: 0, duration: 0.35, ease: 'back.out(2)' }, r + 0.05);
  if (!a.rm) {
    yo(tl, a.b('earL'), { ry: -0.8 }, 0.08, r, 3);
    yo(tl, a.b('earR'), { ry: 0.8 }, 0.08, r + 0.02, 3);
  }
  tl.to(a.b('earL'), { ry: 0, duration: 0.2 }, r + 0.35);
  tl.to(a.b('earR'), { ry: 0, duration: 0.2 }, r + 0.37);
}

/** Crab: cocks the raised claw right back, leaning away, then flings it over and snaps it open. */
function clawFling(a: Actor, tl: TL) {
  const base = a.b('base'), clawR = a.b('clawR'), clawL = a.b('clawL'), jawR = a.b('jawR');
  tl.to(base, { rz: amt(a, 0.14), duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(clawR, { rz: amt(a, 0.45), rx: amt(a, -0.5), duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(clawL, { rz: amt(a, -0.3), duration: 0.18 }, 0);
  tl.to(jawR, { rx: -0.15, duration: 0.1 }, 0);
  for (const n of ['legL1', 'legL2', 'legL3', 'legR1', 'legR2', 'legR3']) tl.to(a.b(n), { rz: n.startsWith('legL') ? -0.2 : 0.2, duration: 0.16 }, 0);
  tl.to(a.face, { brows: 0.7, blink: 0.3, duration: 0.1 }, 0);
  const f = RELEASE - 0.1;
  tl.to(clawR, { rz: amt(a, -0.85), rx: amt(a, 0.6), duration: 0.1, ease: 'power2.in' }, f);
  tl.to(base, { rz: amt(a, -0.1), duration: 0.1, ease: 'power2.in' }, f);
  tl.to(jawR, { rx: 0.45, duration: 0.05 }, RELEASE - 0.02);
  // Follow-through: claw springs back, a smug snip-snip with the other claw.
  const r = RELEASE;
  tl.to(clawR, { rz: 0, rx: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' }, r + 0.03);
  tl.to(jawR, { rx: 0, duration: 0.2 }, r + 0.15);
  tl.to(base, { rz: 0, duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, r + 0.03);
  tl.to(clawL, { rz: amt(a, -0.55), duration: 0.12 }, r + 0.08);
  if (!a.rm) yo(tl, a.b('jawL'), { rx: 0.4 }, 0.05, r + 0.14, 3);
  tl.to(clawL, { rz: 0, duration: 0.25 }, r + 0.38);
  for (const n of ['legL1', 'legL2', 'legL3', 'legR1', 'legR2', 'legR3']) tl.to(a.b(n), { rz: 0, duration: 0.25 }, r + 0.1);
}

/** Octopus: curls the holding tentacle back, leans back, then whips it forward joint by joint. */
function tentacleWhip(a: Actor, tl: TL) {
  const base = a.b('base'), body = a.b('body');
  const ta = a.b('t0a'), tb = a.b('t0b'), tc = a.b('t0c');
  tl.to(base, { rx: amt(a, -0.12), duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(body, { sy: 1.08, sx: 0.96, sz: 0.96, duration: 0.18 }, 0);
  tl.to(ta, { rx: amt(a, -0.45), duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(tb, { rx: amt(a, -0.6), duration: 0.18 }, 0.02);
  tl.to(tc, { rx: amt(a, -0.6), duration: 0.18 }, 0.04);
  // The other arms curl up for balance.
  for (const i of [2, 6]) tl.to(a.b(`t${i}a`), { ...lift(i, amt(a, 0.5)), duration: 0.16 }, 0);
  tl.to(a.face, { brows: 0.5, blink: 0.3, duration: 0.1 }, 0);
  const f = RELEASE - 0.1;
  // Ends level and pointing at the catcher (the hold pose has it raised in front of the face).
  tl.to(ta, { rx: amt(a, 0.7), duration: 0.1, ease: 'power2.in' }, f);
  tl.to(tb, { rx: amt(a, 0.6), duration: 0.09, ease: 'power2.in' }, f + 0.02);
  tl.to(tc, { rx: amt(a, 0.45), duration: 0.08, ease: 'power2.in' }, f + 0.03);
  tl.to(base, { rx: amt(a, 0.1), duration: 0.1 }, f);
  tl.to(body, { sy: 0.92, sx: 1.05, sz: 1.05, duration: 0.1 }, f);
  const r = RELEASE;
  for (const [o, dl] of [[ta, 0.02], [tb, 0.05], [tc, 0.08]] as const) tl.to(o, { rx: 0, duration: 0.55, ease: 'elastic.out(1, 0.35)' }, r + dl);
  for (const i of [2, 6]) tl.to(a.b(`t${i}a`), { rx: 0, rz: 0, duration: 0.4, ease: 'elastic.out(1, 0.4)' }, r + 0.05);
  tl.to(base, { rx: 0, duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, r + 0.03);
  tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, r + 0.03);
}

/** Seahorse, pufferfish, turtle, blobfish: crouch with the chin up, then pop up and nod it off the head. */
function headLaunch(a: Actor, tl: TL) {
  const base = a.b('base'), body = a.b('body'), head = a.b('head');
  tl.to(body, { sy: 0.8, sx: 1.12, sz: 1.12, duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(base, { py: amt(a, -0.02), duration: 0.18 }, 0);
  tl.to(head, { rx: amt(a, -0.25), duration: 0.18, ease: 'power2.out' }, 0);
  tl.to(a.face, { brows: 0.5, blink: 0.35, duration: 0.1 }, 0);
  // Per animal: tail coils, fins buzz, flippers tuck.
  if (a.kind === 'n') for (const [i, n] of ['tail1', 'tail2', 'tail3'].entries()) tl.to(a.b(n), { rx: 0.35 + i * 0.1, duration: 0.16 }, 0);
  if ((a.kind === 'b' || a.kind === 'k') && !a.rm) {
    yo(tl, a.b('finL'), { ry: 0.6 }, 0.04, 0.02, 5);
    yo(tl, a.b('finR'), { ry: -0.6 }, 0.04, 0.02, 5);
  }
  if (a.kind === 'r') {
    tl.to(a.b('flipFL'), { rz: 0.4, duration: 0.14 }, 0);
    tl.to(a.b('flipFR'), { rz: -0.4, duration: 0.14 }, 0);
  }
  // Pop: up and a sharp nod forward, letting go at the top.
  const f = RELEASE - 0.12;
  tl.to(body, { sy: 1.16, sx: 0.92, sz: 0.92, duration: 0.12, ease: 'power2.out' }, f);
  tl.to(base, { py: amt(a, 0.13), duration: 0.12, ease: 'power2.out' }, f);
  tl.to(head, { rx: amt(a, 0.4), duration: 0.1, ease: 'power2.in' }, f + 0.02);
  if (a.kind === 'n') for (const n of ['tail1', 'tail2', 'tail3']) tl.to(a.b(n), { rx: -0.2, duration: 0.1 }, f);
  // Follow-through: drop, squash, a little head wobble.
  const r = RELEASE;
  tl.to(base, { py: 0, duration: 0.16, ease: 'power2.in' }, r + 0.04);
  tl.to(body, { sy: 0.88, sx: 1.07, sz: 1.07, duration: 0.05 }, r + 0.18);
  tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.4, ease: 'elastic.out(1.1, 0.4)' }, r + 0.23);
  tl.to(head, { rx: 0, duration: 0.45, ease: 'elastic.out(1, 0.35)' }, r + 0.04);
  if (a.kind === 'n') for (const n of ['tail1', 'tail2', 'tail3']) tl.to(a.b(n), { rx: 0, duration: 0.4, ease: 'elastic.out(1, 0.4)' }, r + 0.06);
  if (a.kind === 'r') {
    tl.to(a.b('flipFL'), { rz: 0, duration: 0.3, ease: 'back.out(2)' }, r);
    tl.to(a.b('flipFR'), { rz: 0, duration: 0.3, ease: 'back.out(2)' }, r);
  }
  if (a.kind === 'k' && !a.rm) yo(tl, body, { sx: 1.08, sz: 1.08 }, 0.07, r + 0.3, 3);
}

// ---------- the catch ----------

/** The last toss (global timeline seconds), so the next pickup within a moment plays a catch. */
const last = { t: -Infinity, id: '' };
const CATCH_WINDOW = 2.5;

export function noteToss(id: string) {
  last.t = gsap.globalTimeline.time();
  last.id = id;
}

/** True once, for the first other animal handed a treasure soon after a toss. */
export function takeCatch(id: string): boolean {
  if (id === last.id || gsap.globalTimeline.time() - last.t > CATCH_WINDOW) return false;
  last.t = -Infinity;
  return true;
}

/** Limbs to throw up for the catch: [bone, offset]. */
function armsUp(a: Actor): [string, gsap.TweenVars][] {
  const land = a.side === 'land';
  switch (land ? `l${a.kind}` : `s${a.kind}`) {
    case 'lq': case 'lk': return [['pawL', { rx: -1.7, rz: 0.25 }], ['pawR', { rx: -1.7, rz: -0.25 }]];
    case 'sp': return [['clawL', { rz: -0.7 }], ['clawR', { rz: 0.7 }]];
    case 'sq': return [[`t2a`, lift(2, 0.9)], [`t6a`, lift(6, 0.9)], [`t1a`, lift(1, 0.6)], [`t7a`, lift(7, 0.6)]];
    case 'sr': return [['flipFL', { rz: 0.7 }], ['flipFR', { rz: -0.7 }]];
    case 'sn': case 'sb': case 'sk': return [['finL', { rz: 0.8 }], ['finR', { rz: -0.8 }]];
    default: return [['legFL', { rx: -1.1 }], ['legFR', { rx: -1.1 }]];
  }
}

/** A happy hop with arms up as the treasure lands with it (emote layer, so it never cuts an action). */
export function catchHop(a: Actor, tl: TL) {
  const base = a.eb('base'), body = a.eb('body');
  const rm = a.rm;
  tl.to(body, { sy: 0.86, sx: 1.08, sz: 1.08, duration: 0.06, ease: 'power2.out' }, 0);
  tl.to(body, { sy: 1.1, sx: 0.95, sz: 0.95, duration: 0.1 }, 0.06);
  tl.to(base, { py: rm ? 0.03 : 0.16, duration: 0.16, ease: 'power2.out' }, 0.06);
  tl.to(base, { py: 0, duration: 0.18, ease: 'power2.in' }, 0.22);
  tl.to(body, { sy: 0.88, sx: 1.07, sz: 1.07, duration: 0.05 }, 0.4);
  tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.35, ease: 'elastic.out(1.1, 0.4)' }, 0.45);
  for (const [n, v] of armsUp(a)) {
    const o = a.eb(n);
    const k = rm ? 0.4 : 1;
    const to = Object.fromEntries(Object.entries(v).map(([key, x]) => [key, (x as number) * k]));
    tl.to(o, { ...to, duration: 0.12, ease: 'back.out(2)' }, 0.05);
    tl.to(o, { rx: 0, rz: 0, duration: 0.3, ease: 'power2.inOut' }, 0.5);
  }
  tl.to(a.face, { eyeScale: 1.25, blink: 0, duration: 0.08 }, 0);
  tl.to(a.face, { eyeScale: 1, duration: 0.25 }, 0.55);
  a.mouth('open', tl, 0);
  a.mouth('smile', tl, 0.45);
  tl.call(() => {
    if (!rm) vfx.sparkles(a.fxParent, a.above(a.height * 1.05), a.sq, 5, { radius: 0.4, size: 0.24, color: C.gold, life: 0.4 });
  }, [], 0.12);
  return 0.8;
}
