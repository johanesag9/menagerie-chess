/**
 * Pooled particles: one InstancedMesh per effect kind and parent (one draw call, hidden while idle).
 * A burst is one GSAP tween that rewrites its particles every frame from closed-form motion,
 * so skip, manual clocks and dropped frames never leave a particle stranded.
 * Positions are in the parent's local space.
 */
import * as THREE from 'three';
import gsap from 'gsap';

export interface Kind {
  key: string;
  geo: () => THREE.BufferGeometry;
  mat: () => THREE.Material;
  cap: number;
  /** Writes `a` (0..1) into an `iAlpha` instance attribute (the vfx shaders read it). */
  alpha?: boolean;
  renderOrder?: number;
}

/** What a particle writer fills in each frame (reset before every call). */
export interface Out {
  p: THREE.Vector3;
  s: THREE.Vector3;
  /** 3D rotation (lit kinds). */
  r: THREE.Euler;
  /** Billboard spin (radians, view plane). */
  spin: number;
  /** Axial lines: unit direction; s.y is the length, s.x the width. */
  dir: THREE.Vector3 | null;
  a: number;
}
export type Writer = (i: number, t: number, o: Out) => void;

interface Pool { mesh: THREE.InstancedMesh; alpha: THREE.InstancedBufferAttribute | null; owner: Int32Array; next: number; live: number }

const POOLS = new WeakMap<THREE.Object3D, Map<string, Pool>>();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const VIEW_Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _c = new THREE.Color();
const o: Out = { p: new THREE.Vector3(), s: new THREE.Vector3(), r: new THREE.Euler(), spin: 0, dir: null, a: 1 };
let burstId = 0;

function make(k: Kind): Pool {
  const geo = k.geo().clone();
  let alpha: THREE.InstancedBufferAttribute | null = null;
  if (k.alpha) {
    alpha = new THREE.InstancedBufferAttribute(new Float32Array(k.cap), 1);
    alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAlpha', alpha);
  }
  const mesh = new THREE.InstancedMesh(geo, k.mat(), k.cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < k.cap; i++) {
    mesh.setMatrixAt(i, ZERO);
    mesh.setColorAt(i, _c.set(0xffffff));
  }
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.visible = false;
  mesh.renderOrder = k.renderOrder ?? 0;
  mesh.name = `fx:${k.key}`;
  mesh.userData.noPick = true;
  mesh.raycast = () => {};
  return { mesh, alpha, owner: new Int32Array(k.cap), next: 0, live: 0 };
}

function poolFor(parent: THREE.Object3D, k: Kind): Pool {
  let m = POOLS.get(parent);
  if (!m) POOLS.set(parent, (m = new Map()));
  let p = m.get(k.key);
  if (!p) m.set(k.key, (p = make(k)));
  if (p.mesh.parent !== parent) parent.add(p.mesh);
  return p;
}

function write(pool: Pool, slot: number) {
  if (o.dir) {
    _q.setFromUnitVectors(UP, o.dir);
  } else if (pool.alpha) {
    _q.setFromAxisAngle(VIEW_Z, o.spin);
  } else {
    _q.setFromEuler(o.r);
  }
  _m.compose(o.p, _q, o.s);
  pool.mesh.setMatrixAt(slot, _m);
  pool.alpha?.setX(slot, Math.max(0, Math.min(1, o.a)));
}

/**
 * Emit `n` particles of `kind` for `dur` seconds. `color(i)` sets each particle's tint once;
 * `writer(i, t, out)` places particle i at time t (seconds since the burst began). Oldest particles are reused when full.
 */
export function emit(parent: THREE.Object3D, kind: Kind, n: number, dur: number, color: (i: number) => THREE.ColorRepresentation, writer: Writer): void {
  n = Math.min(Math.floor(n), kind.cap);
  if (n <= 0) return;
  const pool = poolFor(parent, kind);
  const id = ++burstId;
  const slots = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const s = pool.next;
    pool.next = (pool.next + 1) % kind.cap;
    pool.owner[s] = id;
    slots[i] = s;
    pool.mesh.setColorAt(s, _c.set(color(i)));
  }
  pool.mesh.instanceColor!.needsUpdate = true;
  pool.live++;
  pool.mesh.visible = true;
  const st = { t: 0 };
  const frame = () => {
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      if (pool.owner[s] !== id) continue;
      o.p.set(0, 0, 0); o.s.set(1, 1, 1); o.r.set(0, 0, 0); o.spin = 0; o.dir = null; o.a = 1;
      writer(i, st.t, o);
      write(pool, s);
    }
    pool.mesh.instanceMatrix.needsUpdate = true;
    if (pool.alpha) pool.alpha.needsUpdate = true;
  };
  frame();
  gsap.to(st, {
    t: dur, duration: dur, ease: 'none', onUpdate: frame,
    onComplete: () => {
      for (const s of slots) {
        if (pool.owner[s] !== id) continue;
        pool.owner[s] = 0;
        pool.mesh.setMatrixAt(s, ZERO);
        pool.alpha?.setX(s, 0);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
      if (pool.alpha) pool.alpha.needsUpdate = true;
      if (--pool.live <= 0) { pool.live = 0; pool.mesh.visible = false; }
    },
  });
}

/** Tiny instanced meshes of each kind, for shader warm-up (instancing compiles its own program). */
export function warmMeshes(kinds: Kind[]): THREE.Object3D[] {
  return kinds.map((k) => {
    const p = make(k);
    p.mesh.visible = true;
    return p.mesh;
  });
}

// ---------- small maths for writers ----------

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const out2 = (x: number) => 1 - (1 - clamp01(x)) ** 2;
export const out3 = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const in2 = (x: number) => clamp01(x) ** 2;
/** 0 -> 1 quickly over `rise` (with a little overshoot), holds, then back to 0 over the last `fall` of `life`. */
export function popLife(t: number, life: number, rise = 0.12, fall = 0.4): number {
  if (t <= 0 || t >= life) return 0;
  const up = t < rise ? backOut(t / rise) : 1;
  const f0 = life * (1 - fall);
  return t > f0 ? up * (1 - in2((t - f0) / (life - f0))) : up;
}
export function backOut(x: number, k = 2.2): number {
  const u = clamp01(x) - 1;
  return 1 + (k + 1) * u ** 3 + k * u ** 2;
}
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
