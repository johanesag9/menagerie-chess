/**
 * Rig kit: build an animal from simple shapes hung on bones, then compile it into ONE rigidly
 * skinned mesh (one draw call per animal, shadows included). Every shape is bound to the nearest
 * bone above it; bones stay live, so any part (head, tail, eyes, mouth) can move.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { slotIndex, type Slot } from './material';

export type V3 = [number, number, number];

// ---------- primitives (low-ish segment counts: 32 pieces share these, but skinning is per vertex) ----------

export const S = (r: number, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);
export const HS = (r: number, w = 20, h = 8) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
export const C = (r: number, len: number, cap = 5, radial = 12) => new THREE.CapsuleGeometry(r, len, cap, radial);
export const Cy = (rt: number, rb: number, h: number, seg = 18, open = false, ts = 0, tl = Math.PI * 2) =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl);
export const Co = (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg);
export const T = (r: number, tube: number, arc = Math.PI * 2, rs = 8, ts = 24) => new THREE.TorusGeometry(r, tube, rs, ts, arc);
export const Box = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, r);
export const Tube = (pts: V3[], r: number, seg = 24, radial = 8) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, radial);
/** Tapered tube: radius goes from r0 to r1 along the curve, with round end caps. */
export function Taper(pts: V3[], r0: number, r1: number, seg = 20, radial = 8): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const tube = new THREE.TubeGeometry(curve, seg, 1, radial);
  const pos = tube.attributes.position;
  const frames = curve.computeFrenetFrames(seg, false);
  const v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  void frames;
  tube.computeVertexNormals();
  const a = curve.getPointAt(0), b = curve.getPointAt(1);
  const capA = S(r0, 10, 8).translate(a.x, a.y, a.z);
  const capB = S(r1, 10, 8).translate(b.x, b.y, b.z);
  return merge([tube, capA, capB]);
}
/** Lathe around Y from a list of [radius, y] points. */
export const Lathe = (pts: [number, number][], seg = 20) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

/** Keep only position and normal, make it indexed (so differently built shapes merge). */
export function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.morphAttributes = {};
  g.clearGroups();
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos.map((g) => clean(g)))!;
}

// ---------- the rig builder ----------

export class Rig {
  readonly root: THREE.Bone;
  private bones = new Map<string, THREE.Bone>();

  constructor() {
    this.root = new THREE.Bone();
    this.root.name = 'base';
    this.bones.set('base', this.root);
  }

  /** A bone (moving part). `parent` is a bone name or object. */
  bone(name: string, parent: string | THREE.Object3D, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0]): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...p);
    b.rotation.set(...r);
    this.obj(parent).add(b);
    this.bones.set(name, b);
    return b;
  }

  get(name: string): THREE.Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`rig: no bone ${name}`);
    return b;
  }

  has(name: string) { return this.bones.has(name); }

  /** A positioning frame (not a bone): shapes inside it bind to the bone above it. */
  frame(parent: string | THREE.Object3D, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: number | V3 = 1): THREE.Object3D {
    const g = new THREE.Object3D();
    g.position.set(...p);
    g.rotation.set(...r);
    if (typeof s === 'number') g.scale.setScalar(s); else g.scale.set(...s);
    this.obj(parent).add(g);
    return g;
  }

  /** Add a shape with a palette slot. Returns the placeholder so callers can tweak orientation. */
  add(parent: string | THREE.Object3D, geo: THREE.BufferGeometry, slot: Slot, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: number | V3 = 1): THREE.Object3D {
    const m = new THREE.Mesh(geo);
    m.userData.slot = slotIndex(slot);
    m.position.set(...p);
    m.rotation.set(...r);
    if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(...s);
    this.obj(parent).add(m);
    return m;
  }

  /** Mirror helper: calls fn(-1) and fn(1). */
  both(fn: (s: -1 | 1) => void) { fn(-1); fn(1); }

  private obj(o: string | THREE.Object3D) { return typeof o === 'string' ? this.get(o) : o; }

  /** Compile into a shareable template (geometry + bone hierarchy). */
  compile(): RigTemplate {
    const root = this.root;
    root.updateMatrixWorld(true);
    const bones: THREE.Bone[] = [];
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    const boneIdx = new Map(bones.map((b, i) => [b, i]));
    const geos: THREE.BufferGeometry[] = [];
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      let b: THREE.Object3D | null = m.parent;
      while (b && !(b as THREE.Bone).isBone) b = b.parent;
      const bi = boneIdx.get(b as THREE.Bone)!;
      const g = clean(m.geometry.clone()).applyMatrix4(m.matrixWorld);
      const n = g.attributes.position.count;
      g.setAttribute('slot', new THREE.BufferAttribute(new Float32Array(n).fill(m.userData.slot), 1));
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geos.push(g);
      m.geometry.dispose();
    }
    // Strip placeholders and frames, keep only bones.
    for (const m of meshes) m.removeFromParent();
    const frames: THREE.Object3D[] = [];
    root.traverse((o) => { if (!(o as THREE.Bone).isBone) frames.push(o); });
    // Re-parent bones that live under frames to the frame's bone, preserving their transform.
    for (const f of frames) {
      for (const c of [...f.children]) if ((c as THREE.Bone).isBone) {
        let b: THREE.Object3D | null = f.parent;
        while (b && !(b as THREE.Bone).isBone) b = b.parent;
        b!.attach(c);
      }
    }
    for (const f of frames) f.removeFromParent();
    root.updateMatrixWorld(true);
    const geometry = mergeGeometries(geos)!;
    geometry.computeBoundingSphere();
    const finalBones: THREE.Bone[] = [];
    root.traverse((o) => { if ((o as THREE.Bone).isBone) finalBones.push(o as THREE.Bone); });
    if (finalBones.length !== bones.length || finalBones.some((b, i) => b !== bones[i])) {
      // Bone order changed by re-parenting: remap skin indices.
      const remap = bones.map((b) => finalBones.indexOf(b));
      const si = geometry.attributes.skinIndex as THREE.BufferAttribute;
      for (let i = 0; i < si.count; i++) si.setX(i, remap[si.getX(i)]);
    }
    const boneInverses = finalBones.map((b) => b.matrixWorld.clone().invert());
    return { geometry, root, boneInverses, vertexCount: geometry.attributes.position.count };
  }
}

export interface RigTemplate {
  geometry: THREE.BufferGeometry;
  root: THREE.Bone;
  boneInverses: THREE.Matrix4[];
  vertexCount: number;
}

/** A fresh skinned mesh sharing the template geometry, with its own bones. */
export function instantiate(t: RigTemplate, material: THREE.Material): { mesh: THREE.SkinnedMesh; bones: Map<string, THREE.Bone> } {
  const root = t.root.clone(true) as THREE.Bone;
  const list: THREE.Bone[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) list.push(o as THREE.Bone); });
  const mesh = new THREE.SkinnedMesh(t.geometry, material);
  mesh.add(root);
  mesh.bind(new THREE.Skeleton(list, t.boneInverses.map((m) => m.clone())), new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Actions fling pieces far from the bind pose; a stale bounding sphere would cull them.
  mesh.frustumCulled = false;
  return { mesh, bones: new Map(list.map((b) => [b.name, b])) };
}

// ---------- face kit ----------

/** A patch hugging a sphere of radius R around +Z: an ellipse with angular half-sizes ax, ay (radians). */
export function Decal(R: number, ax: number, ay: number, seg = 18): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0.0001, 1, seg, 3);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const a = pos.getX(i) * ax, b = pos.getY(i) * ay;
    const x = Math.sin(a) * Math.cos(b), y = Math.sin(b), z = Math.cos(a) * Math.cos(b);
    nrm.setXYZ(i, x, y, z);
    pos.setXYZ(i, x * R, y * R, z * R);
  }
  return g;
}

export interface EyeOpts {
  x: number; y: number; z: number; r: number;
  /** Outward turn of each eye (radians). */
  yaw?: number;
  /** Small vertical tilt. */
  pitch?: number;
  pupil?: 'round' | 'slit' | 'bar';
  /** Pupil radius as a share of the eye radius. */
  pupilSize?: number;
  iris?: boolean;
  /** Eye shape: stretch of the whole eye (x, y, z). Baked into the eye bone's rest scale. */
  shape?: V3;
  /** Half-closed lid in a body slot (smug Sea look). Droop 0 = open, 1 = shut. */
  lid?: { slot: Slot; droop: number };
}

/**
 * Two eyes. Bones: eyeL/eyeR (blink = scale.y), lookL/lookR (gaze = rotation).
 * Iris and pupil are decals hugging the eye white, so gaze slides them over the surface.
 */
export function eyes(rig: Rig, head: string, o: EyeOpts) {
  const r = o.r;
  rig.both((s) => {
    const n = s < 0 ? 'L' : 'R';
    const blink = rig.bone('eye' + n, head, [s * o.x, o.y, o.z], [o.pitch ?? 0, s * (o.yaw ?? 0.25), 0]);
    if (o.shape) blink.scale.set(...o.shape);
    blink.userData.r = r;
    rig.add(blink, S(r, 18, 14), 'eyeWhite');
    const look = rig.bone('look' + n, blink);
    const ang = Math.asin(Math.min(0.95, o.pupilSize ?? 0.56));
    if (o.iris) rig.add(look, Decal(r * 1.006, ang * 1.45, ang * 1.45), 'iris');
    const [ax, ay] = o.pupil === 'slit' ? [ang * 0.34, ang * 1.15] : o.pupil === 'bar' ? [ang * 1.2, ang * 0.45] : [ang, ang];
    rig.add(look, Decal(r * 1.013, ax, ay), 'pupil');
    rig.add(look, S(r * 0.2, 8, 6), 'glint', [-r * 0.32, r * 0.36, r * 0.86]);
    rig.add(look, S(r * 0.1, 6, 5), 'glint', [r * 0.26, -r * 0.24, r * 0.93]);
    if (o.lid) {
      // A cap over the top of the eye, rotated down by droop.
      rig.add(blink, HS(r * 1.1, 16, 6), o.lid.slot, [0, 0, 0], [o.lid.droop * 1.25 - 0.3, 0, 0]);
    }
  });
}

export interface MouthOpts {
  /** Mouth centre on the face (in the head bone's space) and its facing. */
  p: V3; r?: V3;
  /** Half-width. */
  w: number;
  /** Neutral expression: 'smile' (Land) or 'smirk' (smug Sea) or 'flat'. */
  neutral?: 'smile' | 'smirk' | 'flat';
  dark?: Slot;
  tongue?: Slot;
}

/** Mouth variants on bones (hidden ones are scaled to 0): mSmile, mOpen, mO, mFrown. */
export function mouths(rig: Rig, head: string, o: MouthOpts) {
  const dark = o.dark ?? 'dark';
  const tongue = o.tongue ?? 'pink';
  const w = o.w;
  const tube = Math.max(0.006, w * 0.2);
  const f = rig.frame(head, o.p, o.r ?? [0, 0, 0]);
  f.name = 'mouthFrame';
  const smile = rig.bone('mSmile', f);
  const neutral = o.neutral ?? 'smile';
  if (neutral === 'flat') rig.add(smile, C(tube, w * 1.4, 3, 6), dark, [0, 0, 0], [0, 0, Math.PI / 2]);
  else if (neutral === 'smirk') rig.add(smile, T(w * 0.85, tube, Math.PI * 0.7, 5, 12), dark, [0, w * 0.5, 0], [0, 0, Math.PI * 1.3]);
  else rig.add(smile, T(w * 0.7, tube, Math.PI, 5, 12), dark, [0, w * 0.45, 0], [0, 0, Math.PI]);
  const open = rig.bone('mOpen', f);
  // A D-shape: flat edge on top, open downward, tongue inside.
  rig.add(open, Cy(w, w, w * 0.25, 16, false, -Math.PI / 2, Math.PI), dark, [0, w * 0.15, 0], [Math.PI / 2, 0, 0], [1, 1, 0.9]);
  rig.add(open, S(w * 0.48, 10, 8), tongue, [0, -w * 0.45, w * 0.1], [0, 0, 0], [1.1, 0.6, 0.5]);
  const oh = rig.bone('mO', f);
  rig.add(oh, Cy(w * 0.5, w * 0.5, w * 0.3, 14), dark, [0, 0, 0], [Math.PI / 2, 0, 0], [0.9, 1, 1.25]);
  const frown = rig.bone('mFrown', f);
  rig.add(frown, T(w * 0.65, tube, Math.PI, 5, 12), dark, [0, -w * 0.4, 0]);
  for (const n of ['mOpen', 'mO', 'mFrown']) rig.get(n).scale.setScalar(0.001);
}

/** Angry brows on one bone, hidden by default. */
export function brows(rig: Rig, head: string, p: V3, spread: number, len: number, slot: Slot = 'dark', r: V3 = [0, 0, 0]) {
  const b = rig.bone('brows', head, p, r);
  rig.both((s) => rig.add(b, C(len * 0.2, len, 3, 6), slot, [s * spread, 0, 0], [0, 0, Math.PI / 2 - s * 0.45]));
  b.scale.setScalar(0.001);
}

/** Two blush cheeks. */
export function cheeks(rig: Rig, head: string, x: number, y: number, z: number, r: number, yaw = 0.5) {
  rig.both((s) => rig.add(head, S(r, 10, 8), 'cheek', [s * x, y, z], [0, s * yaw, 0], [1, 0.62, 0.3]));
}

/** Gold crown with 5 points and a gem. Built into the given bone at p. */
export function crown(rig: Rig, parent: string, p: V3, r: number, tilt: V3 = [0, 0, 0], gemSlot: Slot = 'extra2') {
  const g = rig.frame(parent, p, tilt);
  rig.add(g, Cy(r, r * 0.86, r * 0.6, 20), 'gold');
  rig.add(g, T(r * 0.98, r * 0.09, Math.PI * 2, 6, 24), 'gold', [0, -r * 0.28, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    rig.add(g, Co(r * 0.3, r * 0.75, 8), 'gold', [Math.sin(a) * r * 0.93, r * 0.62, Math.cos(a) * r * 0.93]);
    rig.add(g, S(r * 0.15, 8, 6), 'gold', [Math.sin(a) * r * 0.93, r * 1.02, Math.cos(a) * r * 0.93]);
  }
  rig.add(g, S(r * 0.22, 10, 8), gemSlot, [0, 0.02 * r, r * 0.95], [0, 0, 0], [1, 1.2, 0.6]);
  return g;
}

/** Spheres placed along a curve (for tentacles, seahorse tail, manes). */
export function beads(rig: Rig, parent: string | THREE.Object3D, pts: V3[], radius: (t: number) => number, slot: (i: number) => Slot, n: number, seg = 12) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = curve.getPoint(t);
    rig.add(parent, S(radius(t), seg, Math.max(6, seg - 4)), slot(i), [p.x, p.y, p.z]);
  }
}

/** Team pedestal (built into the base bone). Height 0.08. */
export const PEDESTAL_H = 0.08;
export function pedestal(rig: Rig) {
  rig.add('base', Lathe([[0, 0], [0.37, 0], [0.39, 0.012], [0.392, 0.05], [0.375, PEDESTAL_H - 0.006], [0.35, PEDESTAL_H], [0, PEDESTAL_H]], 36), 'teamBase');
  rig.add('base', T(0.372, 0.014, Math.PI * 2, 6, 40), 'teamRim', [0, PEDESTAL_H - 0.012, 0], [Math.PI / 2, 0, 0]);
}
