/**
 * Little effects: stars, poofs, bubbles, water squirts, ink, confetti, hearts and emote bubbles.
 * Geometries and materials are shared and made once (see `fxMaterials()` for warm-up).
 * Positions are in the parent's local space; `sq` is the square size, so effects scale with the board.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EmoteKind } from '../contracts/types';
import { motion } from './motion';
import { emit, in2, out2, type Kind } from './pool';

const PI = Math.PI;
const TAU = PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- shared resources ----------

function starShape(outer: number, inner: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * PI * 2 + PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}
function heartShape(r: number) {
  const s = new THREE.Shape();
  s.moveTo(0, -r);
  s.bezierCurveTo(r * 0.2, -r * 0.55, r * 1.1, -r * 0.2, r * 1.0, r * 0.35);
  s.bezierCurveTo(r * 0.9, r * 0.85, r * 0.25, r * 0.95, 0, r * 0.45);
  s.bezierCurveTo(-r * 0.25, r * 0.95, -r * 0.9, r * 0.85, -r * 1.0, r * 0.35);
  s.bezierCurveTo(-r * 1.1, -r * 0.2, -r * 0.2, -r * 0.55, 0, -r);
  return s;
}

let R: ReturnType<typeof make> | null = null;
function make() {
  const ext = { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 };
  const star = new THREE.ExtrudeGeometry(starShape(0.07, 0.032), ext).center();
  const heart = new THREE.ExtrudeGeometry(heartShape(0.06), ext).center();
  const ball = new THREE.IcosahedronGeometry(0.1, 1);
  const drop = new THREE.SphereGeometry(0.05, 10, 8);
  const chip = new THREE.BoxGeometry(0.05, 0.05, 0.012);
  const mats = {
    star: new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffb300', emissiveIntensity: 0.9, roughness: 0.35 }),
    puff: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }),
    bubble: new THREE.MeshStandardMaterial({ color: '#e6fbff', emissive: '#7fdcff', emissiveIntensity: 0.25, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false }),
    water: new THREE.MeshStandardMaterial({ color: '#5cc8ff', emissive: '#1a6aa0', emissiveIntensity: 0.3, roughness: 0.1, transparent: true, opacity: 0.85, depthWrite: false }),
    ink: new THREE.MeshStandardMaterial({ color: '#2a1838', roughness: 0.25 }),
    heart: new THREE.MeshStandardMaterial({ color: '#ff4f7b', emissive: '#ff2a5c', emissiveIntensity: 0.5, roughness: 0.35 }),
    confetti: ['#ff5d8f', '#ffd23f', '#5ec8ff', '#7be07b', '#b48cff'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, side: THREE.DoubleSide })),
  };
  return { star, heart, ball, drop, chip, mats };
}
const res = () => (R ??= make());

/** Every material the effects use (for shader warm-up). */
export function fxMaterials(): THREE.Material[] {
  const m = res().mats;
  const p3 = res3().mats;
  return [m.star, m.puff, m.bubble, m.water, m.ink, m.heart, ...m.confetti, ...Object.values(p3), ...Object.values(emoteMats())];
}

function spawn(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3, scale: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(at);
  m.scale.setScalar(scale);
  m.castShadow = false;
  m.userData.noPick = true; // effects float off their piece; never pick them as a square
  parent.add(m);
  return m;
}
const gone = (m: THREE.Object3D) => () => m.removeFromParent();

// ---------- effects ----------

/** A ring of spinning stars flying out from `at` (pooled: one draw call however many fly). */
export function stars(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 9, spread = 0.7) {
  const P = Array.from({ length: n }, (_, i) => ({
    a: (i / n) * PI * 2 + rnd(-0.2, 0.2), r: sq * spread * rnd(0.7, 1.2), y: sq * rnd(0.3, 0.9), d: rnd(0.5, 0.75),
    s: sq * rnd(0.8, 1.3), rx: rnd(-6, 6), ry: rnd(-6, 6), rz: rnd(-6, 6),
  }));
  emit(parent, KINDS.star, n, 0.75, () => 0xffffff, (i, t, o) => {
    const q = P[i];
    const k = out2(t / q.d);
    o.p.set(at.x + Math.cos(q.a) * q.r * k, at.y + q.y * k, at.z + Math.sin(q.a) * q.r * k);
    const u = Math.min(1, t / q.d);
    o.r.set(q.rx * u, q.ry * u, q.rz * u);
    o.s.setScalar(t >= q.d ? 0 : q.s * (u < 0.4 ? 1 : 1 - in2((u - 0.4) / 0.6)));
  });
}

/** A cartoon smoke poof (or a burst of bubbles for Sea). */
export function poof(parent: THREE.Object3D, at: THREE.Vector3, sq: number, size = 1, sea = false) {
  const { ball, mats } = res();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const m = spawn(parent, ball, sea && i % 2 ? mats.bubble : mats.puff, at, 0.001);
    const a = (i / n) * PI * 2;
    const r = sq * 0.32 * size;
    const s = sq * size * rnd(0.9, 1.5);
    const d = rnd(0.45, 0.6);
    gsap.to(m.position, { x: at.x + Math.cos(a) * r, y: at.y + sq * rnd(0.05, 0.35) * size, z: at.z + Math.sin(a) * r, duration: d, ease: 'power3.out' });
    gsap.to(m.scale, { x: s, y: s, z: s, duration: d * 0.35, ease: 'back.out(2)' });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: d * 0.6, delay: d * 0.4, ease: 'power2.in', onComplete: gone(m) });
  }
  if (sea) bubbles(parent, at, sq, 6);
}

/** Small dust puffs at the feet (landings, stomps). Pooled. `color` tints them (sand, steam). */
export function dust(parent: THREE.Object3D, at: THREE.Vector3, sq: number, size = 1, color: THREE.ColorRepresentation = 0xffffff) {
  const n = motion.reduced ? 4 : 6;
  const P = Array.from({ length: n }, (_, i) => ({ a: (i / n) * PI * 2 + rnd(0, 1), s: sq * 0.45 * size * rnd(0.8, 1.2) }));
  const r = sq * 0.42 * size;
  emit(parent, KINDS.dust, n, 0.45, () => color, (i, t, o) => {
    const q = P[i];
    const k = out2(t / 0.45);
    o.p.set(at.x + Math.cos(q.a) * r * k, at.y + sq * 0.06 * k, at.z + Math.sin(q.a) * r * k);
    o.s.setScalar(q.s * (t < 0.15 ? out2(t / 0.15) : 1 - in2((t - 0.15) / 0.3)));
  });
}

/** Bubbles that wobble up and pop. */
export function bubbles(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 5, rise = 0.9) {
  const { ball, mats } = res();
  for (let i = 0; i < n; i++) {
    const p = at.clone().add(new THREE.Vector3(rnd(-0.15, 0.15) * sq, rnd(0, 0.1) * sq, rnd(-0.15, 0.15) * sq));
    const m = spawn(parent, ball, mats.bubble, p, 0.001);
    const s = sq * rnd(0.25, 0.55);
    const d = rnd(0.7, 1.1);
    gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.2, delay: i * 0.04, ease: 'back.out(2)' });
    gsap.to(m.position, { y: p.y + sq * rise * rnd(0.7, 1.3), duration: d, delay: i * 0.04, ease: 'sine.out' });
    gsap.to(m.position, { x: p.x + rnd(-0.12, 0.12) * sq, duration: d / 3, delay: i * 0.04, ease: 'sine.inOut', yoyo: true, repeat: 2 });
    gsap.to(m.scale, { x: s * 1.5, y: s * 1.5, z: s * 1.5, duration: 0.08, delay: i * 0.04 + d, onComplete: gone(m) });
  }
}

/** One trailing bubble (call repeatedly while moving). */
export function trailBubble(parent: THREE.Object3D, at: THREE.Vector3, sq: number) {
  bubbles(parent, at, sq, 1, 0.5);
}

/** A water squirt from `from` to `to`, arriving after `dur` seconds, with a splash. */
export function squirt(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, sq: number, dur = 0.35) {
  const { drop, mats } = res();
  const n = 14;
  const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, sq * 0.35, 0));
  const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
  for (let i = 0; i < n; i++) {
    const m = spawn(parent, drop, mats.water, from, sq * rnd(0.6, 1.0));
    const p = { t: 0 };
    gsap.to(p, {
      t: 1, duration: dur, delay: i * 0.018, ease: 'none',
      onUpdate: () => m.position.copy(curve.getPoint(p.t)),
      onComplete: gone(m),
    });
  }
  gsap.delayedCall(dur, () => splash(parent, to, sq, 10));
}

/** Water drops bursting up and out from `at`, then falling. */
export function splash(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 10, spread = 1) {
  const { drop, mats } = res();
  if (motion.reduced) n = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const m = spawn(parent, drop, mats.water, at, sq * rnd(0.5, 0.9));
    const a = rnd(0, PI * 2);
    const r = sq * rnd(0.2, 0.45) * spread;
    gsap.to(m.position, { x: at.x + Math.cos(a) * r, y: at.y + sq * rnd(0.15, 0.5), z: at.z + Math.sin(a) * r, duration: 0.3, ease: 'power2.out' });
    gsap.to(m.position, { y: at.y - sq * 0.2, duration: 0.3, delay: 0.3, ease: 'power2.in' });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, delay: 0.35, onComplete: gone(m) });
  }
}

/** An ink splat (octopus). */
export function ink(parent: THREE.Object3D, at: THREE.Vector3, sq: number) {
  const { ball, mats } = res();
  for (let i = 0; i < 8; i++) {
    const m = spawn(parent, ball, mats.ink, at, 0.001);
    const a = rnd(0, PI * 2);
    const r = sq * rnd(0.1, 0.4);
    const s = sq * rnd(0.3, 0.7);
    gsap.to(m.position, { x: at.x + Math.cos(a) * r, y: at.y + rnd(-0.05, 0.25) * sq, z: at.z + Math.sin(a) * r, duration: 0.3, ease: 'power3.out' });
    gsap.to(m.scale, { x: s, y: s * 0.7, z: s, duration: 0.15, ease: 'back.out(3)' });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, delay: 0.45, ease: 'power2.in', onComplete: gone(m) });
  }
}

/** Confetti shower. */
export function confetti(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 22) {
  const { chip, mats } = res();
  if (motion.reduced) n = Math.round(n / 2);
  for (let i = 0; i < n; i++) {
    const m = spawn(parent, chip, mats.confetti[i % mats.confetti.length], at, sq * rnd(0.7, 1.1));
    const a = rnd(0, PI * 2);
    const r = sq * rnd(0.2, 0.8);
    const up = sq * rnd(0.6, 1.2);
    const d = rnd(1.0, 1.4);
    gsap.to(m.position, { x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r, duration: d, ease: 'power1.out' });
    gsap.to(m.position, { y: at.y + up, duration: d * 0.35, ease: 'power2.out' });
    gsap.to(m.position, { y: at.y - sq * 0.3, duration: d * 0.65, delay: d * 0.35, ease: 'sine.in' });
    gsap.to(m.rotation, { x: rnd(-9, 9), y: rnd(-9, 9), z: rnd(-9, 9), duration: d });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.2, delay: d - 0.2, onComplete: gone(m) });
  }
}

/** Hearts floating up. */
export function hearts(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 4) {
  const { heart, mats } = res();
  for (let i = 0; i < n; i++) {
    const m = spawn(parent, heart, mats.heart, at, 0.001);
    const s = sq * rnd(0.8, 1.3);
    const d = rnd(0.9, 1.3);
    const dl = i * 0.12;
    gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.25, delay: dl, ease: 'back.out(3)' });
    gsap.to(m.position, { x: at.x + rnd(-0.35, 0.35) * sq, y: at.y + sq * rnd(0.5, 0.9), z: at.z + rnd(-0.2, 0.2) * sq, duration: d, delay: dl, ease: 'sine.out' });
    gsap.to(m.rotation, { y: rnd(-1.5, 1.5), duration: d, delay: dl });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, delay: dl + d - 0.25, onComplete: gone(m) });
  }
}

/** Stars circling above a head (dizzy). Attached to `obj`, in its local units. */
export function dizzy(obj: THREE.Object3D, y: number, dur = 1) {
  const { star, mats } = res();
  const ring = new THREE.Group();
  ring.position.y = y;
  obj.add(ring);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(star, mats.star);
    const a = (i / 4) * PI * 2;
    m.position.set(Math.cos(a) * 0.22, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.22);
    m.scale.setScalar(0.8);
    ring.add(m);
  }
  ring.scale.setScalar(0.001);
  gsap.to(ring.scale, { x: 1, y: 1, z: 1, duration: 0.2, ease: 'back.out(2)' });
  gsap.to(ring.rotation, { y: PI * 2 * dur * 1.4, duration: dur, ease: 'none' });
  gsap.to(ring.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.2, delay: dur - 0.2, onComplete: gone(ring) });
}

// ---------- emote bubbles ----------

let EMO: Record<EmoteKind, THREE.SpriteMaterial> | null = null;
function drawBubble(kind: EmoteKind): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const fill: Record<EmoteKind, string> = { laugh: '#fff4c2', angry: '#ffd0c8', love: '#ffe0ec', shock: '#e8f6ff', sleepy: '#e9e4ff', taunt: '#e4ffd8' };
  // Speech bubble with a little tail.
  g.fillStyle = fill[kind];
  g.strokeStyle = '#3a2a2a';
  g.lineWidth = 10;
  g.beginPath();
  g.roundRect(18, 18, 220, 170, 60);
  g.moveTo(100, 186);
  g.lineTo(118, 238);
  g.lineTo(150, 186);
  g.fill();
  g.stroke();
  g.fillStyle = fill[kind];
  g.fillRect(102, 172, 46, 22);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const text = (s: string, size: number, color: string, y = 104, x = 128, rot = 0) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.font = `900 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    g.fillStyle = color;
    g.fillText(s, 0, 0);
    g.restore();
  };
  if (kind === 'laugh') { text('HA', 64, '#e07a00', 82, 98, -0.15); text('HA', 64, '#e07a00', 128, 160, 0.12); }
  if (kind === 'angry') {
    // A cartoon anger mark: four bent strokes.
    g.strokeStyle = '#e02a2a';
    g.lineWidth = 16;
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(128, 104);
      g.rotate((i * PI) / 2 + PI / 4);
      g.beginPath();
      g.moveTo(14, -34);
      g.quadraticCurveTo(14, -14, 34, -14);
      g.stroke();
      g.restore();
    }
  }
  if (kind === 'love') {
    g.fillStyle = '#ff3f6f';
    g.save();
    g.translate(128, 108);
    g.scale(3.2, -3.2);
    const s = heartShape(18).getPoints(16);
    g.beginPath();
    s.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.fill();
    g.restore();
  }
  if (kind === 'shock') { text('!', 120, '#2a6ae0', 108, 106); text('?', 90, '#2a6ae0', 104, 160, 0.2); }
  if (kind === 'sleepy') { text('Z', 70, '#6a4ae0', 120, 96); text('z', 52, '#6a4ae0', 84, 146); text('z', 36, '#6a4ae0', 58, 186); }
  if (kind === 'taunt') { text('nyah', 60, '#2a9a3a', 92); text('~', 70, '#2a9a3a', 140); }
  return c;
}
function emoteMats(): Record<EmoteKind, THREE.SpriteMaterial> {
  if (EMO) return EMO;
  const kinds: EmoteKind[] = ['laugh', 'angry', 'love', 'shock', 'sleepy', 'taunt'];
  EMO = {} as Record<EmoteKind, THREE.SpriteMaterial>;
  for (const k of kinds) {
    const tex = new THREE.CanvasTexture(drawBubble(k));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    EMO[k] = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  }
  return EMO;
}

/** A speech bubble that pops in above the head, wobbles, and pops away. Returns a remover. */
export function emoteBubble(obj: THREE.Object3D, kind: EmoteKind, y: number, hold = 1.4): () => void {
  if (typeof document === 'undefined') return () => {};
  const mat = emoteMats()[kind].clone();
  const s = new THREE.Sprite(mat);
  s.center.set(0.45, 0.05);
  s.position.set(0.12, y, 0);
  s.scale.setScalar(0.001);
  s.renderOrder = 10;
  obj.add(s);
  const size = 0.62;
  const tl = gsap.timeline({ onComplete: () => kill() });
  tl.to(s.scale, { x: size, y: size, duration: 0.3, ease: 'back.out(2.5)' })
    .to(s.position, { y: y + 0.06, duration: hold / 2, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0.3)
    .to(s.scale, { x: 0.001, y: 0.001, duration: 0.18, ease: 'back.in(2)' }, 0.3 + hold);
  const kill = () => {
    tl.kill();
    s.removeFromParent();
    mat.dispose();
  };
  return kill;
}

// ---------- Phase 3: powers, travel styles, statuses ----------

/** Brown-tipped banana peel: a squashed middle and four floppy petals, vertex coloured. */
function peelGeometry() {
  const yellow = new THREE.Color('#ffd84a'), brown = new THREE.Color('#7a5a2a');
  const parts: THREE.BufferGeometry[] = [];
  const mid = new THREE.SphereGeometry(0.07, 10, 6).scale(1, 0.7, 1).translate(0, 0.04, 0);
  parts.push(mid);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.SphereGeometry(0.06, 8, 6).scale(0.75, 0.25, 2.1);
    g.translate(0, 0.012, 0.13).rotateY((i / 4) * TAU + 0.4);
    parts.push(g);
  }
  for (const g of parts) {
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = Math.hypot(pos.getX(i), pos.getZ(i)) > 0.2 ? brown : yellow;
      c.toArray(col, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return mergeGeometries(parts)!;
}

/** A clear ice block (unit size, bottom at y = 0) with frost crystals on its top and edges, vertex coloured. */
function iceGeometry() {
  const parts: THREE.BufferGeometry[] = [new RoundedBoxGeometry(1, 1, 1, 2, 0.1).translate(0, 0.5, 0)];
  const ice = new THREE.Color('#d9f6ff'), frost = new THREE.Color('#ffffff');
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.OctahedronGeometry(0.07 + r() * 0.06, 0).scale(1, 0.45, 1);
    const onTop = i < 6;
    const a = r() * TAU;
    const x = onTop ? (r() - 0.5) * 0.8 : Math.sign(Math.cos(a)) * 0.5;
    const z = onTop ? (r() - 0.5) * 0.8 : Math.sin(a) * 0.5;
    g.rotateY(r() * PI).translate(x, onTop ? 1 : 0.15 + r() * 0.75, z);
    parts.push(g);
  }
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  flat.forEach((g, i) => {
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let j = 0; j < g.attributes.position.count; j++) (i === 0 ? ice : frost).toArray(col, j * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  });
  return mergeGeometries(flat)!;
}

let R3: ReturnType<typeof make3> | null = null;
function make3() {
  const { star } = res();
  // Four stars in a ring, merged into one mesh (one draw call per stunned piece).
  const ringParts = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * TAU;
    return star.clone().rotateY(-a).translate(Math.cos(a) * 0.22, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.22);
  });
  return {
    clod: new THREE.DodecahedronGeometry(0.06, 0),
    dome: new THREE.SphereGeometry(0.5, 16, 6, 0, TAU, 0, PI / 2),
    disc: new THREE.CircleGeometry(0.5, 28).rotateX(-PI / 2),
    peel: peelGeometry(),
    ice: iceGeometry(),
    starRing: mergeGeometries(ringParts)!,
    mats: {
      dirt: new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 1 }),
      sand: new THREE.MeshStandardMaterial({ color: '#e8c98f', roughness: 1 }),
      peel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
      ice: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#5cc8ff', emissiveIntensity: 0.18, roughness: 0.08, transparent: true, opacity: 0.55, depthWrite: false }),
      chip: new THREE.MeshStandardMaterial({ color: '#e6faff', emissive: '#7fdcff', emissiveIntensity: 0.3, roughness: 0.1, transparent: true, opacity: 0.8 }),
      chunk: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
      puddle: new THREE.MeshStandardMaterial({ color: '#4fb6e8', emissive: '#1a6aa0', emissiveIntensity: 0.25, roughness: 0.05, transparent: true, opacity: 0.7, depthWrite: false }),
    },
  };
}
const res3 = () => (R3 ??= make3());

/** Pooled particle kinds built from the shared shapes (lit, like the rest of the effects). */
export const KINDS = {
  dust: { key: 'dust', geo: () => res().ball, mat: () => res().mats.puff, cap: 160 } as Kind,
  star: { key: 'star', geo: () => res().star, mat: () => res().mats.star, cap: 96 } as Kind,
  drop: { key: 'drop', geo: () => res().drop, mat: () => res().mats.water, cap: 96 } as Kind,
  chunk: { key: 'chunk', geo: () => res3().clod, mat: () => res3().mats.chunk, cap: 96 } as Kind,
};

/** Clods of dirt (Land) or sand (Sea) thrown out in arcs. `dir` biases them one way (a digger throws dirt behind). Pooled. */
export function clods(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 6, sea = false, dir?: THREE.Vector3) {
  if (motion.reduced) n = Math.ceil(n / 2);
  const base = dir ? Math.atan2(dir.z, dir.x) : 0;
  const P = Array.from({ length: n }, () => ({
    a: dir ? base + rnd(-0.7, 0.7) : rnd(0, TAU), r: sq * rnd(0.3, 0.7), d: rnd(0.4, 0.6), h: sq * rnd(0.25, 0.5),
    s: sq * rnd(0.6, 1.2), rx: rnd(-6, 6), rz: rnd(-6, 6),
  }));
  const color = sea ? '#e8c98f' : '#8a5a32';
  emit(parent, KINDS.chunk, n, 0.9, () => color, (i, t, o) => {
    const q = P[i];
    const u = Math.min(1, t / q.d);
    o.p.set(at.x + Math.cos(q.a) * q.r * u, at.y + sq * 0.05 * (1 - u) + q.h * 4 * u * (1 - u), at.z + Math.sin(q.a) * q.r * u);
    o.r.set(q.rx * u, 0, q.rz * u);
    const fade = (t - q.d - 0.1) / 0.2;
    o.s.setScalar(fade <= 0 ? q.s : Math.max(0, q.s * (1 - fade)));
  });
}

/** A little mound of dirt or sand that rises, holds, and sinks away. */
export function mound(parent: THREE.Object3D, at: THREE.Vector3, sq: number, hold = 0.5, sea = false) {
  const { dome, mats } = res3();
  const m = spawn(parent, dome, sea ? mats.sand : mats.dirt, at, 0.001);
  const s = sq * 0.75;
  gsap.to(m.scale, { x: s, y: s * 0.35, z: s, duration: 0.18, ease: 'back.out(2)' });
  gsap.to(m.scale, { x: s * 0.6, y: 0.001, z: s * 0.6, duration: 0.3, delay: 0.18 + hold, ease: 'power2.in', onComplete: gone(m) });
}

/** A flat puddle of water that spreads, holds, and dries up. */
export function puddle(parent: THREE.Object3D, at: THREE.Vector3, sq: number, hold = 0.5) {
  const { disc, mats } = res3();
  const m = spawn(parent, disc, mats.puddle, at.clone().setY(at.y + sq * 0.01), 0.001);
  const s = sq * 1.15;
  gsap.to(m.scale, { x: s, y: 1, z: s, duration: 0.22, ease: 'back.out(1.6)' });
  gsap.to(m.scale, { x: 0.001, z: 0.001, duration: 0.3, delay: 0.22 + hold, ease: 'power2.in', onComplete: gone(m) });
}

/** A ring of dust puffs (Land) or water drops (Sea) rushing outward along the ground. */
export function shockRing(parent: THREE.Object3D, at: THREE.Vector3, sq: number, sea = false, radius = 1.4) {
  const { ball, drop, mats } = res();
  const n = motion.reduced ? 8 : 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const m = spawn(parent, sea ? drop : ball, sea ? mats.water : mats.puff, at.clone().setY(at.y + sq * 0.05), 0.001);
    const s = sq * (sea ? rnd(0.9, 1.4) : rnd(0.35, 0.5));
    const d = 0.55;
    gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.12, ease: 'power2.out' });
    gsap.to(m.position, { x: at.x + Math.cos(a) * sq * radius, z: at.z + Math.sin(a) * sq * radius, duration: d, ease: 'power2.out' });
    if (sea) {
      gsap.to(m.position, { y: at.y + sq * 0.3, duration: d * 0.4, ease: 'power2.out' });
      gsap.to(m.position, { y: at.y, duration: d * 0.6, delay: d * 0.4, ease: 'power2.in' });
    }
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, delay: d - 0.1, ease: 'power2.in', onComplete: gone(m) });
  }
  if (sea) splash(parent, at, sq, 8, 0.8);
}

/** An arc of ink blobs from `from` to `to`, arriving after `dur`, with a splat. */
export function inkArc(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, sq: number, dur = 0.38) {
  const { ball, mats } = res();
  const n = motion.reduced ? 6 : 12;
  const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, sq * (0.5 + from.distanceTo(to) / sq * 0.15), 0));
  const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
  for (let i = 0; i < n; i++) {
    const m = spawn(parent, ball, mats.ink, from, sq * rnd(0.6, 1.0) * (1 - i / n * 0.5));
    const p = { t: 0 };
    gsap.to(p, {
      t: 1, duration: dur, delay: i * 0.02, ease: 'none',
      onUpdate: () => m.position.copy(curve.getPoint(p.t)),
      onComplete: gone(m),
    });
  }
  gsap.delayedCall(dur, () => ink(parent, to, sq));
}

/** A bubble that swells at `at` for `grow` seconds, then pops into little bubbles. */
export function bigBubble(parent: THREE.Object3D, at: THREE.Vector3, sq: number, grow = 0.45) {
  const { ball, mats } = res();
  const m = spawn(parent, ball, mats.bubble, at, 0.001);
  const s = sq * 2.6;
  gsap.to(m.scale, { x: s, y: s * 0.92, z: s, duration: grow, ease: 'sine.out' });
  gsap.to(m.position, { y: at.y + sq * 0.12, duration: grow, ease: 'sine.out' });
  gsap.to(m.scale, { x: s * 1.25, y: s * 1.25, z: s * 1.25, duration: 0.06, delay: grow, onComplete: () => { m.removeFromParent(); bubbles(parent, m.position, sq, 7, 0.6); } });
}

/** Speed puffs left along a dash from `from` to `to`. */
export function streak(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, sq: number, dur = 0.2) {
  const { ball, mats } = res();
  const n = motion.reduced ? 3 : 7;
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const p = from.clone().lerp(to, k).add(new THREE.Vector3(0, sq * rnd(0.12, 0.4), 0));
    const m = spawn(parent, ball, mats.puff, p, 0.001);
    const s = sq * rnd(0.6, 0.9);
    gsap.to(m.scale, { x: s, y: s * 0.6, z: s, duration: 0.08, delay: k * dur, ease: 'power2.out' });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, delay: k * dur + 0.1, ease: 'power2.in', onComplete: gone(m) });
  }
}

/** A banana peel left on the ground at `at`: it pops in, spins as the piece slides off it, and fades. */
export function peel(parent: THREE.Object3D, at: THREE.Vector3, sq: number, yaw = 0) {
  const { peel: geo, mats } = res3();
  const m = spawn(parent, geo, mats.peel, at, 0.001);
  m.rotation.y = yaw;
  gsap.to(m.scale, { x: sq, y: sq, z: sq, duration: 0.12, ease: 'back.out(3)' });
  gsap.to(m.rotation, { y: yaw + (motion.reduced ? 1 : 4 * PI), duration: 1.0, delay: 0.12, ease: 'power2.out' });
  gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, delay: 1.25, ease: 'power2.in', onComplete: gone(m) });
}

/** Ice chips flying out (an ice block shattering). */
export function shatter(parent: THREE.Object3D, at: THREE.Vector3, sq: number, h = 1) {
  const { clod, mats } = res3();
  const n = motion.reduced ? 5 : 10;
  for (let i = 0; i < n; i++) {
    const p = at.clone().add(new THREE.Vector3(0, sq * h * rnd(0.2, 0.9), 0));
    const m = spawn(parent, clod, mats.chip, p, sq * rnd(0.8, 1.4));
    const a = rnd(0, TAU);
    const r = sq * rnd(0.4, 0.8);
    const d = rnd(0.4, 0.55);
    gsap.to(m.position, { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, duration: d, ease: 'power1.out' });
    gsap.to(m.position, { y: at.y, duration: d, ease: 'power2.in' });
    gsap.to(m.rotation, { x: rnd(-8, 8), y: rnd(-8, 8), duration: d });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.2, delay: d, onComplete: gone(m) });
  }
}

/** One big cartoon star that pops above a head and spins away (a bonk). */
export function bonkStar(parent: THREE.Object3D, at: THREE.Vector3, sq: number) {
  const { star, mats } = res();
  const m = spawn(parent, star, mats.star, at, 0.001);
  const s = sq * 2.2;
  gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.14, ease: 'back.out(3)' });
  gsap.to(m.position, { y: at.y + sq * 0.25, duration: 0.5, ease: 'power2.out' });
  gsap.to(m.rotation, { z: motion.reduced ? 0.5 : 3, duration: 0.5, ease: 'power2.out' });
  gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.18, delay: 0.38, ease: 'back.in(2)', onComplete: gone(m) });
}

/** The dirt (Land) or sand (Sea) material, shared. */
export function groundMaterial(sea: boolean): THREE.Material {
  const { mats } = res3();
  return sea ? mats.sand : mats.dirt;
}

/** A water hump that carries a swept piece (attach to the piece; square units). */
export function waveHump(): THREE.Mesh {
  const { dome } = res3();
  const m = new THREE.Mesh(dome, res().mats.water);
  m.userData.noPick = true;
  return m;
}

/** Stunned: four stars in a ring (one mesh). Spin it every frame. Square units. */
export function starRing(): THREE.Mesh {
  const m = new THREE.Mesh(res3().starRing, res().mats.star);
  m.userData.noPick = true;
  return m;
}

/** Frozen: an ice block with frost, unit size with its bottom at y = 0 (scale it to the animal). */
export function iceBlock(): THREE.Mesh {
  const r3 = res3();
  const m = new THREE.Mesh(r3.ice, r3.mats.ice);
  m.renderOrder = 5;
  m.userData.noPick = true;
  return m;
}
