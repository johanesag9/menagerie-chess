/**
 * Phase 4 (party modes): falling into the sea (Sumo), carrying a treasure (Raid) and the dug-in look (Sumo pawn "Dig in").
 * The actor calls in here; everything is in square units on the actor's own bones, like the rest of the cast.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PieceKind, Side } from '../contracts/types';
import type { Actor } from './actor';
import type { V3 } from './kit';
import * as fx from './fx';
import * as vfx from './vfx';

const PI = Math.PI;
const TAU = PI * 2;
type TL = gsap.core.Timeline;

// ---------- shared resources (made once) ----------

/** Shared with the world's treasures on the ground (docs/phase4-briefs.md). */
export const TREASURE_COLORS = { bone: '#f3e6c8', pearl: '#f7f4ee', shell: '#f2a7b5' };

function boneGeometry() {
  // A cartoon dog bone, 1 unit long along x, knobs stacked in y.
  const shaft = new THREE.CylinderGeometry(0.1, 0.1, 0.72, 12, 1).rotateZ(PI / 2);
  const knobs = [-1, 1].flatMap((x) => [-1, 1].map((y) => new THREE.SphereGeometry(0.15, 14, 10).translate(x * 0.37, y * 0.1, 0)));
  return mergeGeometries([shaft, ...knobs])!;
}
function shellGeometry() {
  // An open clam: a shallow bowl and a lid hinged at the back (-z), 0.7 wide. The pearl sits in the bowl.
  const bowl = new THREE.SphereGeometry(0.35, 22, 8, 0, TAU, PI / 2, PI / 2).scale(1, 0.42, 1);
  const lid = new THREE.SphereGeometry(0.35, 22, 8, 0, TAU, 0, PI / 2).scale(1, 0.42, 1)
    .translate(0, 0, 0.35).rotateX(-1.05).translate(0, 0, -0.35);
  // Scallop ridges on the lid.
  const ridges = Array.from({ length: 5 }, (_, i) => {
    const a = -0.9 + (i / 4) * 1.8;
    return new THREE.CylinderGeometry(0.018, 0.018, 0.34, 5).rotateX(PI / 2).rotateY(a).translate(Math.sin(a) * 0.17, 0.13, Math.cos(a) * 0.17)
      .translate(0, 0, 0.35).rotateX(-1.05).translate(0, 0, -0.35);
  });
  return mergeGeometries([bowl, lid, ...ridges].map((g) => (g.index ? g.toNonIndexed() : g)))!;
}
function ringGeometry() {
  // A lumpy ring of dirt or sand around the pedestal (seeded, so every ring looks the same).
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.42, 0.085, 8, 30).rotateX(PI / 2).scale(1, 0.75, 1).translate(0, 0.07, 0).toNonIndexed()];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + r() * 0.4;
    const rad = 0.42 + r() * 0.08;
    const k = 0.07 + r() * 0.05;
    parts.push(new THREE.IcosahedronGeometry(1, 1).scale(k * 1.3, k * 0.75, k).rotateY(r() * TAU).translate(Math.cos(a) * rad, 0.09 + r() * 0.05, Math.sin(a) * rad));
  }
  return mergeGeometries(parts)!;
}

let R: ReturnType<typeof make> | null = null;
function make() {
  return {
    bone: boneGeometry(),
    shell: shellGeometry(),
    pearl: new THREE.SphereGeometry(0.17, 20, 14),
    ring: ringGeometry(),
    mats: {
      bone: new THREE.MeshStandardMaterial({ color: TREASURE_COLORS.bone, roughness: 0.55 }),
      pearl: new THREE.MeshPhysicalMaterial({ color: TREASURE_COLORS.pearl, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 1, sheenColor: new THREE.Color('#ffd6e4'), iridescence: 0.5 }),
      shell: new THREE.MeshStandardMaterial({ color: TREASURE_COLORS.shell, roughness: 0.45, side: THREE.DoubleSide }),
    },
  };
}
const res = () => (R ??= make());

/** Every material used here (for shader warm-up). */
export function partyMaterials(): THREE.Material[] {
  const m = res().mats;
  return [m.bone, m.pearl, m.shell];
}

// ---------- carrying (Raid) ----------

export type HoldMode = 'mouth' | 'claw' | 'trunk' | 'tentacle' | 'head';
interface Hold {
  bone: string;
  /** Grip point in the bone's own (unscaled) space. */
  p: V3;
  /** Turns the treasure upright again when the holding bone is posed (the sum of the pose's rotations, undone). */
  r?: V3;
  mode: HoldMode;
  /** Treasure size in squares (bone length / shell width). */
  size: number;
  /** Extra pose (idle layer) so the holder shows it off: trunk curled up, claw raised, tentacle lifted. */
  pose?: (a: Actor, k: number) => void;
}

/** How each animal holds a treasure: mouth (dogs, horse, goat, cat), claw, trunk, tentacle, or balanced on the head. */
const HOLD: Record<Side, Record<PieceKind, Hold>> = {
  land: {
    p: { bone: 'head', p: [0, 0.03, 0.25], mode: 'mouth', size: 0.3 },
    n: { bone: 'head', p: [0, -0.06, 0.185], mode: 'mouth', size: 0.3 },
    b: { bone: 'head', p: [0, -0.025, 0.17], mode: 'mouth', size: 0.28 },
    r: {
      bone: 'trunk3', p: [0, -0.065, 0.01], r: [1.7, 0, -1.4], mode: 'trunk', size: 0.32,
      pose(a, k) {
        // Trunk raised and swung out to one side, holding it up beside its head.
        a.ib('trunk1').rx -= 0.9 * k;
        a.ib('trunk1').rz += 1.4 * k;
        a.ib('trunk2').rx -= 0.5 * k;
        a.ib('trunk3').rx -= 0.3 * k;
      },
    },
    q: { bone: 'head', p: [0, 0.04, 0.19], mode: 'mouth', size: 0.3 },
    k: { bone: 'head', p: [0, 0.065, 0.22], mode: 'mouth', size: 0.34 },
  },
  sea: {
    p: {
      bone: 'clawR', p: [0.085, 0.035, 0.25], mode: 'claw', size: 0.27,
      pose(a, k) {
        // Claw raised high and out to the side, like a trophy.
        a.ib('clawR').rz += 0.75 * k;
        a.ib('clawR').rx -= 0.25 * k;
        a.ib('jawR').rx += 0.25 * k;
      },
    },
    n: { bone: 'head', p: [0, 0.2, -0.01], mode: 'head', size: 0.26 },
    b: { bone: 'head', p: [0, 0.375, -0.035], mode: 'head', size: 0.28 },
    r: { bone: 'head', p: [0, 0.145, 0.075], mode: 'head', size: 0.26 },
    q: {
      bone: 't0c', p: [0.03, 0.06, 0.075], r: [2.3, 0, 0], mode: 'tentacle', size: 0.3,
      pose(a, k) {
        a.ib('t0a').rx -= 1.4 * k;
        a.ib('t0b').rx -= 0.55 * k;
        a.ib('t0c').rx -= 0.35 * k;
      },
    },
    k: { bone: 'head', p: [0, 0.6, 0.0], mode: 'head', size: 0.32 },
  },
};

/**
 * The carried treasure: `owner` 'land' = the bone, 'sea' = the pearl in its shell.
 * The returned group's origin is the grip point; its unit size is 1 (scale it to `hold.size`).
 */
function treasure(owner: Side, mode: HoldMode): THREE.Group {
  const r = res();
  const g = new THREE.Group();
  g.userData.noPick = true;
  const inner = new THREE.Group();
  g.add(inner);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    m.userData.noPick = true;
    inner.add(m);
  };
  const head = mode === 'head';
  if (owner === 'land') {
    // Bone: held across the mouth / in the grip by its middle; lying flat on a head.
    add(r.bone, r.mats.bone);
    if (head) {
      // Lying flat, knobs front and back.
      inner.rotation.x = PI / 2;
      inner.position.y = 0.14;
    }
    if (mode === 'trunk' || mode === 'tentacle') inner.rotation.z = 0.25;
  } else {
    // Pearl in a shell: held by the hinge (the shell sticks out in front); sitting upright on a head.
    add(r.shell, r.mats.shell);
    add(r.pearl, r.mats.pearl, 0.1);
    if (head) inner.position.y = 0.16;
    else {
      inner.position.z = 0.34;
      inner.rotation.x = 0.25;
    }
  }
  return g;
}

export interface Carry {
  owner: Side;
  group: THREE.Group;
  hold: Hold;
  /** Eases 0 -> 1 as it shows (drives the holder pose). */
  k: { v: number };
}

/** Attach a treasure to the actor's holding bone (popping in). `restScale` undoes the body scale of that bone. */
export function attachCarry(a: Actor, owner: Side, restScale: (bone: string) => number): Carry | null {
  const hold = HOLD[a.side][a.kind];
  const bone = a.bone(hold.bone) ?? a.bone('head');
  if (!bone) return null;
  const group = treasure(owner, hold.mode);
  group.position.set(...hold.p);
  if (hold.r) group.rotation.set(...hold.r);
  const s = hold.size / restScale(bone.name);
  group.scale.setScalar(0.001);
  bone.add(group);
  const k = { v: 0 };
  const d = a.rm ? 0.18 : 0.35;
  gsap.to(group.scale, { x: s, y: s, z: s, duration: d, ease: a.rm ? 'power2.out' : 'back.out(2.5)' });
  gsap.to(k, { v: 1, duration: d, ease: 'power2.out' });
  return { owner, group, hold, k };
}

/** How an animal holds a treasure (the toss is built from this). */
export function holdOf(side: Side, kind: PieceKind): { mode: HoldMode; bone: string } {
  const h = HOLD[side][kind];
  return { mode: h.mode, bone: h.bone };
}

/** Pop the treasure away and remove it. The holder pose eases out meanwhile (the actor keeps calling `carryFrame` until it's gone). */
export function detachCarry(c: Carry, rm: boolean) {
  gsap.killTweensOf(c.group.scale);
  gsap.killTweensOf(c.k);
  gsap.to(c.k, { v: 0, duration: 0.2 });
  gsap.to(c.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: rm ? 0.12 : 0.2, ease: 'back.in(2)', onComplete: () => { c.group.removeFromParent(); } });
}

/** After a toss: the treasure is already hidden (the world flies it); just ease the holder pose out, then remove it. */
export function letGoCarry(c: Carry) {
  gsap.killTweensOf(c.group.scale);
  gsap.killTweensOf(c.k);
  c.group.visible = false;
  gsap.to(c.k, { v: 0, duration: 0.35, ease: 'power2.inOut', onComplete: () => { c.group.removeFromParent(); } });
}

/** Every frame while carrying (after the idle): the holder pose, and a balanced treasure wobbles on the head. */
export function carryFrame(a: Actor, c: Carry, t: number) {
  c.hold.pose?.(a, c.k.v);
  if (c.hold.mode === 'head') {
    const w = a.rm ? 0.03 : 0.1;
    c.group.rotation.z = (c.hold.r?.[2] ?? 0) + Math.sin(t * 2.3) * w;
    c.group.rotation.x = (c.hold.r?.[0] ?? 0) + Math.sin(t * 1.7 + 1) * w * 0.6;
  }
}

/** Dispose-time cleanup (shared geometry and materials stay). */
export function dropCarry(c: Carry) {
  gsap.killTweensOf(c.group.scale);
  gsap.killTweensOf(c.k);
  c.group.removeFromParent();
}

// ---------- anchored (Sumo pawn "Dig in") ----------

/** A lumpy ring of dirt (Land) or sand (Sea) around the pedestal, on the ground (y = 0). Unit size. */
export function anchorRing(sea: boolean): THREE.Mesh {
  const m = new THREE.Mesh(res().ring, fx.groundMaterial(sea));
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.noPick = true;
  return m;
}

/** How tall the ring is per animal: the small pawns get buried up to their bellies. */
export function anchorRingHeight(kind: PieceKind): number {
  return kind === 'p' ? 1.35 : 1;
}

/** Every frame while dug in (`k` eases 0 -> 1): sunk a little into the ground, legs or claws braced, head down. */
export function anchorFrame(a: Actor, k: number, t: number) {
  if (k <= 0) return;
  a.ib('body').py -= (a.kind === 'p' ? 0.06 : 0.035) * k;
  a.ib('head').rx += 0.12 * k;
  // Front legs braced forward, back legs pushed back (quadrupeds).
  for (const n of ['legFL', 'legFR']) a.ib(n).rx -= 0.35 * k;
  for (const n of ['legBL', 'legBR']) a.ib(n).rx += 0.35 * k;
  // Crab: claws dug down into the sand, legs splayed.
  a.ib('clawL').rx += 0.45 * k;
  a.ib('clawR').rx += 0.45 * k;
  for (let i = 1; i <= 3; i++) {
    a.ib('legL' + i).rz += 0.3 * k;
    a.ib('legR' + i).rz -= 0.3 * k;
  }
  // Straining to hold on: a tiny tremble.
  if (!a.rm) a.ib('base').rz += Math.sin(t * 31) * 0.006 * k;
}

// ---------- falling into the sea (Sumo) ----------

/** Flailing limbs per bone name (missing bones are skipped by the layers). */
const FRONT = ['legFL', 'pawL'];
const FRONT2 = ['legFR', 'pawR'];

/**
 * Totter at the edge, tumble off toward `dir` (parent space, unit, flat) and drop into the water.
 * Land panics (wide eyes, flailing legs, a head-over-heels tumble). Sea is smug (half-lidded, a lazy lean, a neat dive home);
 * the octopus waves goodbye first. Returns when it hits the water (`splash`) and when it has sunk out of sight (`end`).
 */
export function fall(a: Actor, tl: TL, dir: THREE.Vector3): { splash: number; end: number } {
  const rm = a.rm;
  const sq = a.sq;
  const sea = a.side === 'sea';
  const base = a.b('base');
  const body = a.b('body');
  const f = a.face;
  // The direction in the actor's own frame, as a tilt: rx tips toward +z, rz toward -x.
  const l = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -a.object.rotation.y);
  const tip = (ang: number) => ({ rx: l.z * ang, rz: -l.x * ang });
  const from = a.object.position.clone();
  const move = (dist: number, at: number, dur: number, ease: string) =>
    tl.to(a.object.position, { x: from.x + dir.x * dist * sq, z: from.z + dir.z * dist * sq, duration: dur, ease }, at);
  const sink = (at: number, dur: number) => {
    tl.to(base, { py: -(a.height + 0.35), duration: dur, ease: 'power1.in' }, at);
    tl.to(base, { sx: 0.001, sy: 0.001, sz: 0.001, duration: dur, ease: 'power2.in' }, at + dur * 0.2);
    tl.call(() => fx.bubbles(a.fxParent, a.object.position.clone().setY(from.y - 0.1 * sq), sq, sea ? 6 : 4, 0.6), [], at + 0.05);
  };

  if (rm) {
    // Reduced motion: a small lean, a slide off and a drop, no spins.
    if (sea) { tl.to(f, { blink: 0.5, duration: 0.1 }, 0); a.mouth('smile', tl, 0); }
    else { tl.to(f, { eyeScale: 1.3, duration: 0.08 }, 0); a.mouth('o', tl, 0); }
    tl.to(base, { ...tip(0.18), duration: 0.18, ease: 'power2.out' }, 0);
    move(0.7, 0.15, 0.3, 'power1.in');
    tl.to(base, { py: -0.3, duration: 0.3, ease: 'power2.in' }, 0.15);
    sink(0.45, 0.22);
    return { splash: 0.45, end: 0.68 };
  }

  if (!sea) {
    // Land: panic at the edge (sweat flying, feet scrabbling at the edge).
    tl.to(f, { eyeScale: 1.45, blink: 0, brows: 0, duration: 0.07 }, 0);
    a.mouth('o', tl, 0);
    const sweat = () => vfx.droplets(a.fxParent, a.bonePoint('head').add(new THREE.Vector3(0, sq * 0.2, 0)), sq, 3, { up: 0.3, radius: 0.3, size: 0.5 });
    tl.call(sweat, [], 0.04);
    tl.call(sweat, [], 0.3);
    for (const t of [0.1, 0.24, 0.38]) tl.call(() => vfx.kick(a.fxParent, a.above(0), dir.clone().negate(), sq), [], t);
    // Windmill wobble: lean out, catch, lean further, catch...
    tl.to(base, { ...tip(0.32), duration: 0.12, ease: 'power2.out' }, 0);
    tl.to(base, { ...tip(-0.1), duration: 0.14, ease: 'sine.inOut' }, 0.12);
    tl.to(base, { ...tip(0.28), duration: 0.12, ease: 'sine.inOut' }, 0.26);
    tl.to(base, { ...tip(0.05), duration: 0.1, ease: 'sine.inOut' }, 0.38);
    // Flailing legs and paws, ears flapping, tail going wild, trunk waving.
    for (const n of FRONT) tl.to(a.b(n), { rx: -1.4, rz: 0.3, duration: 0.07, yoyo: true, repeat: 7, ease: 'sine.inOut' }, 0.03);
    for (const n of FRONT2) tl.to(a.b(n), { rx: -1.4, rz: -0.3, duration: 0.07, yoyo: true, repeat: 7, ease: 'sine.inOut' }, 0.1);
    tl.to(a.b('earL'), { rz: 0.7, duration: 0.06, yoyo: true, repeat: 9 }, 0);
    tl.to(a.b('earR'), { rz: -0.7, duration: 0.06, yoyo: true, repeat: 9 }, 0.03);
    tl.to(a.b('tail1'), { ry: 0.8, duration: 0.05, yoyo: true, repeat: 11 }, 0);
    tl.to(a.b('trunk1'), { rx: -0.9, duration: 0.09, yoyo: true, repeat: 5 }, 0);
    tl.to(body, { sy: 1.08, sx: 0.95, sz: 0.95, duration: 0.07, yoyo: true, repeat: 5 }, 0);
    a.mouth('open', tl, 0.3);
    // Over it goes: topples around its feet, hops off the edge, somersaults down.
    tl.to(base, { ...tip(PI * 1.25), duration: 0.5, ease: 'power2.in' }, 0.48);
    move(0.95, 0.48, 0.42, 'power1.in');
    tl.to(base, { py: 0.14, duration: 0.14, ease: 'power2.out' }, 0.48);
    tl.to(base, { py: -0.3, duration: 0.28, ease: 'power2.in' }, 0.62);
    tl.to(f, { blink: 0.85, duration: 0.08 }, 0.8);
    sink(0.9, 0.26);
    return { splash: 0.9, end: 1.16 };
  }

  // Sea: smug. Half-lidded, a lazy lean back, then a neat dive home.
  const octo = a.kind === 'q';
  const t0 = octo ? 0.42 : 0;
  tl.to(f, { blink: 0.5, eyeScale: 1, brows: 0, duration: 0.15 }, 0);
  a.mouth('smile', tl, 0);
  tl.to(a.b('head'), { rx: -0.2, duration: 0.25, ease: 'sine.inOut' }, 0);
  if (octo) {
    // The octopus waves goodbye with a tentacle (right side, facing us).
    tl.to(a.b('t1a'), { rz: 2.1, rx: 0.2, duration: 0.14, ease: 'back.out(2)' }, 0);
    tl.to(a.b('t1b'), { rz: 0.6, duration: 0.09, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0.1);
    tl.to(a.b('t1c'), { rz: 0.9, duration: 0.09, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0.12);
    tl.to(a.b('t1a'), { rz: 0, rx: 0, duration: 0.15, ease: 'power2.in' }, 0.42);
  }
  tl.to(base, { ...tip(-0.14), duration: 0.22, ease: 'sine.inOut' }, t0);
  tl.to(body, { sy: 0.9, sx: 1.06, sz: 1.06, duration: 0.18, ease: 'power2.out' }, t0 + 0.12);
  tl.to(f, { blink: 0.7, duration: 0.1 }, t0 + 0.2);
  // A smug little twinkle by the eye before it goes.
  tl.call(() => vfx.sparkles(a.fxParent, a.bonePoint('head').add(new THREE.Vector3(0, sq * 0.12, 0)).addScaledVector(a.forward(), sq * 0.2), sq, 1, { radius: 0.05, size: 0.32, life: 0.3, rise: 0.05 }), [], t0 + 0.18);
  // The dive: a stretch, a hop up and out, head first into the water.
  const dv = t0 + 0.3;
  tl.to(body, { sy: 1.18, sx: 0.88, sz: 0.88, duration: 0.14, ease: 'power2.out' }, dv);
  tl.to(base, { ...tip(PI * 0.8), duration: 0.5, ease: 'sine.inOut' }, dv);
  move(0.9, dv, 0.48, 'sine.out');
  tl.to(base, { py: 0.28, duration: 0.2, ease: 'power2.out' }, dv);
  tl.to(base, { py: -0.3, duration: 0.24, ease: 'power2.in' }, dv + 0.2);
  sink(dv + 0.44, 0.24);
  return { splash: dv + 0.44, end: dv + 0.68 };
}
