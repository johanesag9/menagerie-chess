/**
 * Animation polish effects: impact frames, speed lines, shock rings, sparkles, debris, steam and droplets.
 * All pooled (pool.ts): each kind is one instanced draw call per parent, hidden while idle.
 * The flat kinds (sparkle, burst, line, ring) are unlit and fade with a per-particle alpha; the round ones reuse fx's lit shapes.
 * Positions are in the parent's local space; `sq` is the square size, so everything scales with the board.
 */
import * as THREE from 'three';
import { motion } from './motion';
import { KINDS as FX } from './fx';
import { emit, out2, out3, in2, popLife, rnd, warmMeshes, type Kind } from './pool';

const PI = Math.PI;
const TAU = PI * 2;

// ---------- unlit instanced shader ----------

const VS = /* glsl */ `
attribute float iAlpha;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = iAlpha;
#ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
#else
  vColor = vec3(1.0);
#endif
#if defined(BILLBOARD)
  // Faces the camera; the instance's x/y scale sizes it and its z rotation spins it in the view plane.
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(instanceMatrix[0].xyz);
  float sy = length(instanceMatrix[1].xyz);
  vec2 ax = instanceMatrix[0].xy / max(sx, 1e-6);
  vec2 p = position.xy * vec2(sx, sy);
  p = vec2(p.x * ax.x - p.y * ax.y, p.x * ax.y + p.y * ax.x);
  gl_Position = projectionMatrix * (c + vec4(p, 0.0, 0.0));
#elif defined(AXIAL)
  // A ribbon along the instance's y axis (its length), turned to face the camera; x scale is the width.
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 a = (modelViewMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  float w = length(instanceMatrix[0].xyz);
  vec3 side = cross(a, normalize(c.xyz));
  side = side / max(length(side), 1e-6);
  gl_Position = projectionMatrix * vec4(c.xyz + a * position.y + side * position.x * w, 1.0);
#else
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
#endif
}`;
const FS = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  if (vAlpha < 0.004) discard;
  gl_FragColor = vec4(vColor, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function flatMat(defines: Record<string, string>, depthTest = true) {
  return new THREE.ShaderMaterial({
    name: 'castVfx', defines, vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, toneMapped: false,
  });
}

function starShape(points: number, outer: (i: number) => number, inner: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer(i / 2);
    const a = (i / (points * 2)) * TAU + PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

let R: ReturnType<typeof make> | null = null;
function make() {
  // Comic impact burst: 11 uneven spikes (seeded so every burst has the same jagged outline).
  const spikes = [0.5, 0.36, 0.47, 0.4, 0.5, 0.33, 0.45, 0.39, 0.5, 0.35, 0.44];
  return {
    sparkle: new THREE.ShapeGeometry(starShape(4, () => 0.5, 0.1)),
    burst: new THREE.ShapeGeometry(starShape(11, (i) => spikes[i % spikes.length], 0.2)),
    line: new THREE.PlaneGeometry(1, 1),
    ring: new THREE.RingGeometry(0.8, 1, 48, 1).rotateX(-PI / 2),
    bill: flatMat({ BILLBOARD: '' }),
    top: flatMat({ BILLBOARD: '' }, false),
    axial: flatMat({ AXIAL: '' }),
    flat: flatMat({}),
  };
}
const res = () => (R ??= make());

const K = {
  sparkle: { key: 'vfx-sparkle', geo: () => res().sparkle, mat: () => res().bill, cap: 96, alpha: true, renderOrder: 6 } as Kind,
  burst: { key: 'vfx-burst', geo: () => res().burst, mat: () => res().top, cap: 18, alpha: true, renderOrder: 20 } as Kind,
  line: { key: 'vfx-line', geo: () => res().line, mat: () => res().axial, cap: 72, alpha: true, renderOrder: 5 } as Kind,
  ring: { key: 'vfx-ring', geo: () => res().ring, mat: () => res().flat, cap: 10, alpha: true, renderOrder: 4 } as Kind,
};

/** Instanced meshes of every pooled kind (cast preload compiles them so the first burst doesn't hitch). */
export function vfxWarmup(): THREE.Object3D[] {
  return warmMeshes([...Object.values(K), ...Object.values(FX)]);
}

export const COLORS = {
  dust: '#f6efe2', sand: '#ecd3a0', dirt: '#8a5a32', rock: '#9a8d7c', water: '#8fdcff', foam: '#f2fdff',
  ink: '#2a1838', gold: '#ffd84a', orange: '#ff8a1f', white: '#ffffff', steam: '#f4f1ec', pink: '#ff9ec4',
};
const few = (n: number) => (motion.reduced ? Math.ceil(n / 2) : n);

// ---------- effects ----------

/**
 * An impact frame where two things meet. 'cartoon': a big comic burst (orange, yellow, white) with radial speed lines
 * and stars. 'clean': a quick white flash with a few sparkles. `k` scales it (1 = an ordinary hit).
 */
export function impact(parent: THREE.Object3D, at: THREE.Vector3, sq: number, k = 1) {
  const cartoon = motion.look === 'cartoon' && !motion.reduced;
  if (cartoon) {
    const layers = [[1.3, COLORS.orange], [1.05, COLORS.gold], [0.55, COLORS.white]] as const;
    const spin = rnd(0, TAU);
    const life = 0.17;
    emit(parent, K.burst, 3, life, (i) => layers[i][1], (i, t, o) => {
      o.p.copy(at);
      const s = sq * 0.7 * k * layers[i][0] * (0.55 + 0.45 * out3(t / 0.05)) * (1 + 0.15 * (t / life));
      o.s.set(s, s, 1);
      o.spin = spin + (i === 1 ? 0.18 : 0) + t * 1.5;
      o.a = t < life * 0.6 ? 1 : 1 - (t - life * 0.6) / (life * 0.4);
    });
    radialLines(parent, at, sq, 9, 0.5 * k);
    fxStarsSmall(parent, at, sq, 5, 0.55 * k);
  } else {
    const life = 0.13;
    emit(parent, K.burst, 1, life, () => COLORS.white, (_i, t, o) => {
      o.p.copy(at);
      const s = sq * 0.5 * k * (0.6 + 0.4 * out3(t / 0.04));
      o.s.set(s, s, 1);
      o.a = 1 - in2(t / life);
    });
    sparkles(parent, at, sq, few(4), { radius: 0.4 * k, size: 0.22, life: 0.35 });
  }
}

/** Speed lines bursting out of a point in every direction (the cartoon impact uses these). */
export function radialLines(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 8, len = 0.5) {
  if (motion.reduced) return;
  const P = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU + rnd(-0.2, 0.2);
    const el = rnd(-0.35, 0.7);
    return { d: new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), l: sq * len * rnd(0.7, 1.2) };
  });
  const life = 0.22;
  emit(parent, K.line, n, life, () => COLORS.white, (i, t, o) => {
    const q = P[i];
    const u = t / life;
    // Starts at the rim of the flash and shoots outward, shrinking.
    o.p.copy(at).addScaledVector(q.d, sq * 0.35 + q.l * (0.3 + out2(u) * 1.1));
    o.dir = q.d;
    o.s.set(sq * 0.05, q.l * (1 - 0.7 * u), 1);
    o.a = 1 - in2(u);
  });
}

/** A few small lit stars popping out (pooled `fx.stars`, smaller). */
function fxStarsSmall(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n: number, spread: number) {
  const P = Array.from({ length: n }, () => ({ a: rnd(0, TAU), r: sq * spread * rnd(0.6, 1.1), y: sq * rnd(0.15, 0.6), d: rnd(0.38, 0.5), s: sq * rnd(0.6, 0.95) }));
  emit(parent, FX.star, n, 0.5, () => 0xffffff, (i, t, o) => {
    const q = P[i];
    const k = out2(t / q.d);
    o.p.set(at.x + Math.cos(q.a) * q.r * k, at.y + q.y * k, at.z + Math.sin(q.a) * q.r * k);
    o.r.set(t * 9, t * 7, t * 5);
    o.s.setScalar(t >= q.d ? 0 : q.s * (1 - in2(t / q.d)));
  });
}

/**
 * Speed lines left behind along a dash from `from` to `to`, appearing as the mover passes and sliding off behind it.
 * `dur` is how long the dash takes.
 */
export function speedLines(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, sq: number, o: { n?: number; dur?: number; lo?: number; hi?: number; color?: THREE.ColorRepresentation } = {}) {
  if (motion.reduced) return;
  const d = to.clone().sub(from).setY(0);
  const len = d.length();
  if (len < 1e-4) return;
  d.divideScalar(len);
  const side = new THREE.Vector3(-d.z, 0, d.x);
  const n = o.n ?? 7, dur = o.dur ?? 0.2, lo = o.lo ?? 0.15, hi = o.hi ?? 0.6;
  const P = Array.from({ length: n }, (_, i) => ({
    k: (i + rnd(0.1, 0.9)) / n, off: rnd(-0.32, 0.32) * sq, y: rnd(lo, hi) * sq, l: rnd(0.35, 0.7) * sq,
  }));
  const life = 0.26;
  emit(parent, K.line, n, dur + life, () => o.color ?? COLORS.white, (i, t, out) => {
    const q = P[i];
    const t0 = q.k * dur;
    const u = (t - t0) / life;
    if (u <= 0 || u >= 1) { out.s.set(0, 0, 0); out.a = 0; return; }
    out.p.copy(from).addScaledVector(d, len * q.k - q.l * 0.5 - out2(u) * 0.3 * sq).addScaledVector(side, q.off);
    out.p.y = from.y + q.y;
    out.dir = d;
    out.s.set(sq * 0.035, q.l * (1 - 0.6 * u), 1);
    out.a = 0.9 * (1 - in2(u));
  });
}

/** A ring of lines whipping round a spinning piece (the pug's zoomies). */
export function spinLines(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 6, y = 0.3, dur = 0.5) {
  if (motion.reduced) return;
  const P = Array.from({ length: n }, (_, i) => ({ a: (i / n) * TAU, y: (y + rnd(-0.12, 0.12)) * sq, r: sq * rnd(0.42, 0.55), d: rnd(0, 0.15) }));
  emit(parent, K.line, n, dur, () => COLORS.white, (i, t, o) => {
    const q = P[i];
    const u = (t - q.d) / (dur - q.d);
    if (u <= 0 || u >= 1) { o.s.set(0, 0, 0); o.a = 0; return; }
    const a = q.a + t * 14;
    o.p.set(at.x + Math.cos(a) * q.r, at.y + q.y, at.z + Math.sin(a) * q.r);
    o.dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    o.s.set(sq * 0.04, sq * 0.45 * (1 - u * 0.5), 1);
    o.a = Math.sin(u * PI);
  });
}

/** A flat shock ring rushing out along the ground, plus a skirt of dust (or foam) puffs. */
export function shockwave(parent: THREE.Object3D, at: THREE.Vector3, sq: number, o: { radius?: number; color?: THREE.ColorRepresentation; puffs?: THREE.ColorRepresentation; dur?: number } = {}) {
  const radius = (o.radius ?? 1.6) * sq, dur = o.dur ?? 0.5;
  const rings = motion.reduced ? 1 : 2;
  emit(parent, K.ring, rings, dur + 0.1, () => o.color ?? COLORS.white, (i, t, out) => {
    const tt = t - i * 0.1;
    if (tt <= 0) { out.s.set(0, 0, 0); out.a = 0; return; }
    const u = tt / dur;
    const r = radius * (0.2 + out3(u) * 0.8) * (i ? 0.75 : 1);
    out.p.set(at.x, at.y + sq * (0.03 + i * 0.01), at.z);
    out.s.set(r, 1, r);
    out.a = (i ? 0.5 : 0.85) * (1 - in2(u));
  });
  const n = few(14);
  const P = Array.from({ length: n }, (_, i) => ({ a: (i / n) * TAU + rnd(-0.15, 0.15), s: sq * rnd(0.32, 0.5), r: rnd(0.75, 1) }));
  emit(parent, FX.dust, n, dur, () => o.puffs ?? 0xffffff, (i, t, out) => {
    const q = P[i];
    const u = t / dur;
    const r = radius * 0.85 * q.r * out3(u);
    out.p.set(at.x + Math.cos(q.a) * r, at.y + sq * (0.05 + 0.12 * out2(u)), at.z + Math.sin(q.a) * r);
    out.s.setScalar(q.s * (u < 0.2 ? out2(u / 0.2) : 1 - in2((u - 0.2) / 0.8)));
  });
}

/** Little twinkling 4-point sparkles around `at`, drifting up. */
export function sparkles(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 6, o: { radius?: number; size?: number; life?: number; color?: THREE.ColorRepresentation; rise?: number; stagger?: number } = {}) {
  const radius = (o.radius ?? 0.45) * sq, size = (o.size ?? 0.26) * sq, life = o.life ?? 0.45, rise = (o.rise ?? 0.25) * sq, stagger = o.stagger ?? 0.12;
  const P = Array.from({ length: n }, () => {
    const a = rnd(0, TAU);
    const r = radius * Math.sqrt(rnd(0.15, 1));
    return { x: Math.cos(a) * r, y: rnd(-0.4, 0.6) * radius, z: Math.sin(a) * r, d: rnd(0, stagger), s: size * rnd(0.6, 1.2), sp: rnd(-3, 3) };
  });
  emit(parent, K.sparkle, n, life + stagger, () => o.color ?? COLORS.white, (i, t, out) => {
    const q = P[i];
    const tt = t - q.d;
    const k = popLife(tt, life, 0.1, 0.5);
    out.p.set(at.x + q.x, at.y + q.y + rise * out2(tt / life), at.z + q.z);
    const s = q.s * k;
    out.s.set(s, s, 1);
    out.spin = q.sp * tt;
    out.a = k > 0 ? 1 : 0;
  });
}

/**
 * Chunks (dirt, sand, pebbles, ink) thrown up and out, landing back on the ground at `at.y`.
 * `dir` biases them one way (a digger throws dirt behind it).
 */
export function debris(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 8, o: { color?: THREE.ColorRepresentation; up?: number; radius?: number; size?: number; dir?: THREE.Vector3; spread?: number; life?: number } = {}) {
  n = few(n);
  const up = (o.up ?? 0.5) * sq, radius = (o.radius ?? 0.7) * sq, size = o.size ?? 1, life = o.life ?? 0.55;
  const base = o.dir ? Math.atan2(o.dir.z, o.dir.x) : 0;
  const P = Array.from({ length: n }, (_, i) => ({
    a: o.dir ? base + rnd(-1, 1) * (o.spread ?? 0.7) : (i / n) * TAU + rnd(-0.3, 0.3),
    r: radius * rnd(0.45, 1), h: up * rnd(0.6, 1.2), d: life * rnd(0.8, 1), s: sq * size * rnd(0.6, 1.25), rx: rnd(-9, 9), rz: rnd(-9, 9),
  }));
  emit(parent, FX.chunk, n, life + 0.15, () => o.color ?? COLORS.dirt, (i, t, out) => {
    const q = P[i];
    const u = Math.min(1, t / q.d);
    // A parabola: up and back down to the ground by u = 1.
    out.p.set(at.x + Math.cos(q.a) * q.r * u, at.y + sq * 0.05 + q.h * 4 * u * (1 - u), at.z + Math.sin(q.a) * q.r * u);
    out.r.set(q.rx * u, 0, q.rz * u);
    out.s.setScalar(t > q.d ? q.s * Math.max(0, 1 - (t - q.d) / 0.15) : q.s);
  });
}

/** Puffs streaming from `at` along `dir` (a snort of steam, a trumpet blast, a sigh). */
export function steam(parent: THREE.Object3D, at: THREE.Vector3, dir: THREE.Vector3, sq: number, n = 3, o: { color?: THREE.ColorRepresentation; dist?: number; size?: number; life?: number } = {}) {
  n = few(n);
  const d = dir.clone().normalize();
  const dist = (o.dist ?? 0.4) * sq, size = (o.size ?? 0.35) * sq, life = o.life ?? 0.4;
  const P = Array.from({ length: n }, (_, i) => ({ d: i * 0.04, j: new THREE.Vector3(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).multiplyScalar(sq * 0.06), s: size * rnd(0.7, 1.2) }));
  emit(parent, FX.dust, n, life + n * 0.04, () => o.color ?? COLORS.steam, (i, t, out) => {
    const q = P[i];
    const u = (t - q.d) / life;
    if (u <= 0 || u >= 1) { out.s.set(0, 0, 0); return; }
    out.p.copy(at).addScaledVector(d, dist * out2(u)).addScaledVector(q.j, u);
    out.p.y += sq * 0.08 * u;
    out.s.setScalar(q.s * (u < 0.25 ? out2(u / 0.25) : 1 - in2((u - 0.25) / 0.75)));
  });
}

/** Water (or sweat) drops flicked up and out, falling back. */
export function droplets(parent: THREE.Object3D, at: THREE.Vector3, sq: number, n = 6, o: { up?: number; radius?: number; size?: number; dir?: THREE.Vector3; life?: number } = {}) {
  n = few(n);
  const up = (o.up ?? 0.4) * sq, radius = (o.radius ?? 0.35) * sq, size = o.size ?? 0.8, life = o.life ?? 0.45;
  const base = o.dir ? Math.atan2(o.dir.z, o.dir.x) : 0;
  const P = Array.from({ length: n }, () => ({ a: o.dir ? base + rnd(-0.6, 0.6) : rnd(0, TAU), r: radius * rnd(0.4, 1), h: up * rnd(0.6, 1.2), s: sq * size * rnd(0.6, 1.1) }));
  emit(parent, FX.drop, n, life, () => 0xffffff, (i, t, out) => {
    const q = P[i];
    const u = t / life;
    out.p.set(at.x + Math.cos(q.a) * q.r * u, at.y + q.h * 4 * u * (1 - u) - sq * 0.15 * u, at.z + Math.sin(q.a) * q.r * u);
    out.s.set(q.s, q.s * (1 + 0.5 * Math.abs(1 - 2 * u)), q.s);
    if (u > 0.75) out.s.multiplyScalar(1 - (u - 0.75) / 0.25);
  });
}

/** Dust kicked up behind running feet (call along a skid or a scramble). */
export function kick(parent: THREE.Object3D, at: THREE.Vector3, back: THREE.Vector3, sq: number, color: THREE.ColorRepresentation = COLORS.dust) {
  steam(parent, at.clone().setY(at.y + sq * 0.05), back.clone().setY(0.25), sq, 2, { color, dist: 0.3, size: 0.28, life: 0.35 });
}

/** Blobs flying along an arc from `from` to `to` over `dur` (an ink squirt), then splatting. Pooled. */
export function arc(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, sq: number, o: { n?: number; dur?: number; color?: THREE.ColorRepresentation; size?: number } = {}) {
  const n = few(o.n ?? 12), dur = o.dur ?? 0.35, size = o.size ?? 0.85;
  const mid = from.clone().lerp(to, 0.5);
  mid.y += sq * (0.45 + (from.distanceTo(to) / sq) * 0.15);
  const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
  const gap = 0.022;
  const P = Array.from({ length: n }, (_, i) => ({ d: i * gap, s: sq * size * rnd(0.75, 1.1) * (1 - (i / n) * 0.55) }));
  const color = o.color ?? COLORS.ink;
  emit(parent, FX.dust, n, dur + n * gap, () => color, (i, t, out) => {
    const q = P[i];
    const u = (t - q.d) / dur;
    if (u <= 0 || u >= 1) { out.s.set(0, 0, 0); return; }
    curve.getPoint(u, out.p);
    // Stretched along the flight a little.
    out.s.set(q.s, q.s * 1.25, q.s);
  });
  debrisLater(parent, to, sq, dur, color);
}
function debrisLater(parent: THREE.Object3D, at: THREE.Vector3, sq: number, delay: number, color: THREE.ColorRepresentation) {
  // A splat when the stream lands: dark blobs out across the square.
  const n = few(9);
  const P = Array.from({ length: n }, (_, i) => ({ a: (i / n) * TAU + rnd(-0.3, 0.3), r: sq * rnd(0.12, 0.42), h: sq * rnd(0.05, 0.25), s: sq * rnd(0.32, 0.6) }));
  emit(parent, FX.dust, n, delay + 0.7, () => color, (i, t, out) => {
    const q = P[i];
    const u = (t - delay) / 0.7;
    if (u <= 0) { out.s.set(0, 0, 0); return; }
    const k = out3(u / 0.4);
    out.p.set(at.x + Math.cos(q.a) * q.r * k, at.y + q.h * k, at.z + Math.sin(q.a) * q.r * k);
    const s = q.s * (u < 0.15 ? out2(u / 0.15) : u < 0.6 ? 1 : 1 - in2((u - 0.6) / 0.4));
    out.s.set(s, s * 0.7, s);
  });
}
