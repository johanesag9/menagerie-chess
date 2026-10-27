/**
 * Little effects: stars, poofs, bubbles, water squirts, ink, confetti, hearts and emote bubbles.
 * Geometries and materials are shared and made once (see `fxMaterials()` for warm-up).
 * Positions are in the parent's local space; `sq` is the square size, so effects scale with the board.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import type { EmoteKind } from '../contracts/types';
import { motion } from './motion';

const PI = Math.PI;
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
  return [m.star, m.puff, m.bubble, m.water, m.ink, m.heart, ...m.confetti, ...Object.values(emoteMats())];
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

/** A ring of spinning stars flying out from `at`. */
export function stars(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 9, spread = 0.7) {
  const { star, mats } = res();
  for (let i = 0; i < n; i++) {
    const m = spawn(parent, star, mats.star, at, sq * rnd(0.8, 1.3));
    const a = (i / n) * PI * 2 + rnd(-0.2, 0.2);
    const r = sq * spread * rnd(0.7, 1.2);
    const d = rnd(0.5, 0.75);
    gsap.to(m.position, { x: at.x + Math.cos(a) * r, y: at.y + sq * rnd(0.3, 0.9), z: at.z + Math.sin(a) * r, duration: d, ease: 'power2.out' });
    gsap.to(m.rotation, { x: rnd(-6, 6), y: rnd(-6, 6), z: rnd(-6, 6), duration: d });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: d * 0.6, delay: d * 0.4, ease: 'power2.in', onComplete: gone(m) });
  }
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

/** Small dust puffs at the feet (landings, stomps). */
export function dust(parent: THREE.Object3D, at: THREE.Vector3, sq: number, size = 1) {
  const { ball, mats } = res();
  for (let i = 0; i < 6; i++) {
    const m = spawn(parent, ball, mats.puff, at, 0.001);
    const a = (i / 6) * PI * 2 + rnd(0, 1);
    const r = sq * 0.42 * size;
    const s = sq * 0.45 * size * rnd(0.8, 1.2);
    gsap.to(m.position, { x: at.x + Math.cos(a) * r, y: at.y + sq * 0.06, z: at.z + Math.sin(a) * r, duration: 0.45, ease: 'power2.out' });
    gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.15, ease: 'power2.out' });
    gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, delay: 0.15, ease: 'power2.in', onComplete: gone(m) });
  }
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
  gsap.delayedCall(dur, () => {
    for (let i = 0; i < 10; i++) {
      const m = spawn(parent, drop, mats.water, to, sq * rnd(0.5, 0.9));
      const a = rnd(0, PI * 2);
      const r = sq * rnd(0.2, 0.45);
      gsap.to(m.position, { x: to.x + Math.cos(a) * r, y: to.y + sq * rnd(0.15, 0.5), z: to.z + Math.sin(a) * r, duration: 0.3, ease: 'power2.out' });
      gsap.to(m.position, { y: to.y - sq * 0.2, duration: 0.3, delay: 0.3, ease: 'power2.in' });
      gsap.to(m.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, delay: 0.35, onComplete: gone(m) });
    }
  });
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
