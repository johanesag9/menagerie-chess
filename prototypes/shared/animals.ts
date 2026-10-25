/**
 * Phase 0 stand-in cast: rough, code-built versions of all 12 animals so the world
 * prototypes read as a real game. Session C (cast) builds the real ones.
 * Every animal faces +Z; its feet are at y = 0 of `body` (the pedestal top).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Side = 'land' | 'sea';
export type Kind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Animal {
  side: Side;
  kind: Kind;
  root: THREE.Group;
  body: THREE.Group;
  height: number;
  idle(t: number): void;
}

type V3 = [number, number, number];
type MatKind = 'toy' | 'gloss' | 'eye' | 'pupil' | 'glow' | 'gold' | 'glass' | 'cloth' | 'slime';

// ---------- materials & primitives ----------

const mats = new Map<string, THREE.Material>();
export function mat(color: string, kind: MatKind = 'toy'): THREE.Material {
  const key = color + kind;
  let m = mats.get(key);
  if (m) return m;
  switch (kind) {
    case 'gloss': m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 }); break;
    case 'eye': m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }); break;
    case 'pupil': m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.08, clearcoat: 1 }); break;
    case 'glow': m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3, toneMapped: false }); break;
    case 'gold': m = new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.28, clearcoat: 0.6 }); break;
    case 'glass': m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, transparent: true, opacity: 0.4, depthWrite: false, clearcoat: 1 }); break;
    case 'cloth': m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(color).offsetHSL(0, 0, 0.25), side: THREE.DoubleSide }); break;
    case 'slime': m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.5, sheenColor: new THREE.Color('#fff') }); break;
    default: m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 });
  }
  mats.set(key, m);
  return m;
}

const S = (r: number, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h);
const HS = (r: number) => new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
const C = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14);
const Cy = (rt: number, rb: number, h: number, seg = 20, open = false, ts = 0, tl = Math.PI * 2) =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl);
const Co = (r: number, h: number, seg = 14) => new THREE.ConeGeometry(r, h, seg);
const T = (r: number, tube: number, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, 10, 32, arc);
const Tube = (pts: V3[], r: number) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 40, r, 10);

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: number | V3 = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(...p);
  mesh.rotation.set(...r);
  if (typeof s === 'number') mesh.scale.setScalar(s);
  else mesh.scale.set(...s);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** An animated sub-part: a pivot group that survives baking. */
function pivot(parent: THREE.Object3D, p: V3, r: V3 = [0, 0, 0]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...p);
  g.rotation.set(...r);
  g.userData.keep = true;
  parent.add(g);
  return g;
}

interface EyeOpts {
  x: number; y: number; z: number; r: number;
  yaw?: number;
  pupil?: 'round' | 'slit' | 'bar';
  pupilSize?: number;
  iris?: string;
  lid?: { color: string; droop: number };
}
function eyes(parent: THREE.Object3D, o: EyeOpts) {
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * o.x, o.y, o.z);
    g.rotation.y = s * (o.yaw ?? 0.25);
    parent.add(g);
    add(g, S(o.r), mat('#fbfaf7', 'eye'));
    if (o.iris) add(g, S(o.r * 0.74), mat(o.iris, 'eye'), [0, 0, o.r * 0.42], [0, 0, 0], [1, 1, 0.6]);
    const ps = o.pupilSize ?? 0.52;
    const shape: V3 = o.pupil === 'slit' ? [0.32, 1.15, 0.5] : o.pupil === 'bar' ? [1.25, 0.38, 0.5] : [1, 1, 0.5];
    add(g, S(o.r * ps), mat('#141018', 'pupil'), [0, 0, o.r * 0.68], [0, 0, 0], shape);
    add(g, S(o.r * 0.16, 10, 8), mat('#ffffff', 'glow'), [-o.r * 0.28, o.r * 0.32, o.r * 0.9]);
    if (o.lid) add(g, HS(o.r * 1.1), mat(o.lid.color), [0, 0, 0], [o.lid.droop, 0, 0]);
  }
}

function crown(parent: THREE.Object3D, p: V3, r: number, tilt: V3 = [0, 0, 0], gem = '#e8384f') {
  const g = new THREE.Group();
  g.position.set(...p);
  g.rotation.set(...tilt);
  parent.add(g);
  const gold = mat('#f2c14e', 'gold');
  add(g, Cy(r, r * 0.88, r * 0.62, 28, true), new THREE.MeshPhysicalMaterial({ color: '#f2c14e', metalness: 1, roughness: 0.28, side: THREE.DoubleSide }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(g, Co(r * 0.3, r * 0.7, 8), gold, [Math.sin(a) * r * 0.95, r * 0.62, Math.cos(a) * r * 0.95]);
    add(g, S(r * 0.14, 10, 8), gold, [Math.sin(a) * r * 0.95, r * 1.0, Math.cos(a) * r * 0.95]);
  }
  add(g, S(r * 0.2, 12, 10), mat(gem, 'gloss'), [0, 0, r * 0.95]);
  return g;
}

function beads(parent: THREE.Object3D, pts: V3[], radius: (t: number) => number, color: (i: number) => THREE.Material, n: number) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = curve.getPoint(t);
    add(parent, S(radius(t), 16, 12), color(i), [p.x, p.y, p.z]);
  }
}

/** Merge static meshes under `body` per material (≈6 draw calls per animal). Pivot groups stay live. */
function bake(body: THREE.Group) {
  body.updateMatrixWorld(true);
  const inv = body.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const remove: THREE.Mesh[] = [];
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (let p: THREE.Object3D | null = o.parent; p && p !== body; p = p.parent) if (p.userData.keep) return;
    let g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.clearGroups();
    const m = o.material as THREE.Material;
    (byMat.get(m) ?? byMat.set(m, []).get(m)!).push(g);
    remove.push(o);
  });
  for (const o of remove) o.removeFromParent();
  for (const [m, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos), m);
    merged.castShadow = merged.receiveShadow = true;
    body.add(merged);
  }
  // Drop now-empty helper groups.
  const empties: THREE.Object3D[] = [];
  body.traverse((o) => { if (o !== body && o.type === 'Group' && !o.userData.keep && o.children.length === 0) empties.push(o); });
  empties.forEach((o) => o.removeFromParent());
}

// ---------- palettes ----------

export const TEAM = {
  land: { base: '#f3e3c3', rim: '#d9a441' },
  sea: { base: '#1d5a70', rim: '#7fe0d8' },
};

// ---------- the cast ----------

type Build = (b: THREE.Group) => { height: number; idle?: (t: number) => void };

const breathe = (b: THREE.Group, t: number, speed = 2.2, amt = 0.022) => {
  const s = Math.sin(t * speed);
  b.scale.set(1 - s * amt * 0.5, 1 + s * amt, 1 - s * amt * 0.5);
};

const LAND: Record<Kind, Build> = {
  // Dachshund pup
  p(b) {
    const fur = mat('#b8693a'), dark = mat('#7a3f22'), belly = mat('#e8c39e');
    add(b, C(0.12, 0.26), fur, [0, 0.2, 0], [Math.PI / 2, 0, 0]);
    add(b, S(0.1), belly, [0, 0.16, 0.05], [0, 0, 0], [1, 0.8, 1.6]);
    for (const [x, z] of [[-0.075, 0.13], [0.075, 0.13], [-0.075, -0.13], [0.075, -0.13]]) {
      add(b, Cy(0.038, 0.04, 0.12), fur, [x, 0.07, z]);
      add(b, S(0.046), belly, [x, 0.025, z + 0.015], [0, 0, 0], [1, 0.6, 1.2]);
    }
    add(b, S(0.11), fur, [0, 0.34, 0.2]);
    add(b, C(0.055, 0.08), belly, [0, 0.31, 0.31], [Math.PI / 2, 0, 0]);
    add(b, S(0.028), mat('#2a1a14', 'gloss'), [0, 0.325, 0.37]);
    for (const s of [-1, 1]) add(b, S(0.065), dark, [s * 0.105, 0.29, 0.17], [0.2, 0, s * 0.35], [0.42, 1.25, 0.8]);
    eyes(b, { x: 0.048, y: 0.37, z: 0.28, r: 0.024, yaw: 0.2 });
    add(b, T(0.088, 0.018), mat('#e2453c', 'gloss'), [0, 0.29, 0.13], [Math.PI / 2 - 0.5, 0, 0]);
    add(b, S(0.02), mat('#f2c14e', 'gold'), [0, 0.22, 0.2]);
    const tail = pivot(b, [0, 0.26, -0.24]);
    add(tail, C(0.022, 0.12), fur, [0, 0.06, -0.04], [-0.7, 0, 0]);
    return { height: 0.45, idle: (t) => { tail.rotation.y = Math.sin(t * 11) * 0.55; breathe(b, t, 2.6); } };
  },
  // Horse
  n(b) {
    const coat = mat('#8a4b2a'), mane = mat('#3a2216'), white = mat('#f2e6d8'), hoof = mat('#2b2420', 'gloss');
    add(b, C(0.14, 0.3), coat, [0, 0.44, 0], [Math.PI / 2, 0, 0]);
    for (const [x, z] of [[-0.08, 0.15], [0.08, 0.15], [-0.08, -0.15], [0.08, -0.15]]) {
      add(b, Cy(0.036, 0.03, 0.32), coat, [x, 0.2, z]);
      add(b, Cy(0.04, 0.045, 0.05), hoof, [x, 0.025, z]);
      add(b, Cy(0.034, 0.038, 0.05), white, [x, 0.07, z]);
    }
    add(b, C(0.08, 0.2), coat, [0, 0.63, 0.17], [0.64, 0, 0]);
    add(b, C(0.075, 0.15), coat, [0, 0.78, 0.27], [1.9, 0, 0]);
    add(b, S(0.072), coat, [0, 0.72, 0.36], [0, 0, 0], [1, 0.9, 1]);
    add(b, S(0.03), white, [0, 0.83, 0.3], [0, 0, 0], [0.8, 1.6, 0.6]);
    for (const s of [-1, 1]) {
      add(b, S(0.012), mat('#1a1210', 'gloss'), [s * 0.03, 0.72, 0.42]);
      add(b, Co(0.026, 0.08), coat, [s * 0.04, 0.88, 0.21], [-0.2, 0, s * 0.2]);
    }
    eyes(b, { x: 0.062, y: 0.8, z: 0.28, r: 0.026, yaw: 0.9 });
    for (let i = 0; i < 6; i++) add(b, S(0.038), mane, [0, 0.86 - i * 0.055, 0.21 - i * 0.03]);
    add(b, new RoundedBoxGeometry(0.24, 0.03, 0.2, 2, 0.012), mat('#d0423a'), [0, 0.575, -0.02]);
    const tail = pivot(b, [0, 0.5, -0.27]);
    add(tail, Tube([[0, 0, 0], [0, -0.06, -0.08], [0, -0.18, -0.11], [0, -0.3, -0.08]], 0.035), mane);
    return { height: 0.92, idle: (t) => { tail.rotation.z = Math.sin(t * 1.7) * 0.25; tail.rotation.x = Math.sin(t * 2.3) * 0.1; breathe(b, t, 1.8, 0.015); } };
  },
  // Mountain goat on a rock
  b(b) {
    const fur = mat('#efe6d6'), horn = mat('#8a7a66', 'gloss'), rock = mat('#9b9184');
    add(b, new THREE.DodecahedronGeometry(0.2), rock, [0, 0.09, 0], [0.3, 0.5, 0], [1.4, 0.6, 1.2]);
    add(b, C(0.12, 0.2), fur, [0, 0.44, 0], [Math.PI / 2, 0, 0]);
    for (const [x, z] of [[-0.07, 0.1], [0.07, 0.1], [-0.07, -0.1], [0.07, -0.1]]) {
      add(b, Cy(0.03, 0.026, 0.22), fur, [x, 0.28, z]);
      add(b, Cy(0.032, 0.035, 0.04), mat('#3a332c', 'gloss'), [x, 0.17, z]);
    }
    add(b, C(0.07, 0.08), fur, [0, 0.6, 0.16], [0.5, 0, 0]);
    add(b, C(0.06, 0.08), fur, [0, 0.62, 0.24], [1.6, 0, 0]);
    add(b, S(0.016), mat('#d99a8a', 'gloss'), [0, 0.62, 0.32]);
    add(b, Co(0.03, 0.1), mat('#d9cdb8'), [0, 0.52, 0.25], [Math.PI, 0, 0]);
    for (const s of [-1, 1]) {
      add(b, T(0.06, 0.02, Math.PI * 1.5), horn, [s * 0.06, 0.7, 0.13], [0, -Math.PI / 2, 0]);
      add(b, S(0.045), fur, [s * 0.09, 0.64, 0.14], [0, 0, s * 0.8], [0.35, 1.2, 0.6]);
    }
    eyes(b, { x: 0.05, y: 0.67, z: 0.22, r: 0.022, yaw: 0.6, pupil: 'bar', iris: '#e3b04b' });
    add(b, S(0.04), fur, [0, 0.52, -0.18]);
    return { height: 0.78, idle: (t) => breathe(b, t, 2.0) };
  },
  // Elephant carrying a tower
  r(b) {
    const skin = mat('#a49a94'), pink = mat('#d9a3a0'), stone = mat('#e6d3b0'), red = mat('#c8323c');
    add(b, S(0.22), skin, [0, 0.36, -0.03], [0, 0, 0], [1, 0.85, 1.15]);
    for (const [x, z] of [[-0.12, 0.12], [0.12, 0.12], [-0.12, -0.14], [0.12, -0.14]]) {
      add(b, Cy(0.07, 0.075, 0.22), skin, [x, 0.11, z]);
      add(b, S(0.018), mat('#f4efe6'), [x, 0.03, z + 0.068]);
    }
    add(b, S(0.15), skin, [0, 0.47, 0.2]);
    for (const s of [-1, 1]) {
      const ear = pivot(b, [s * 0.12, 0.5, 0.17], [0, s * 0.35, 0]);
      ear.userData.side = s;
      add(ear, S(0.14), skin, [s * 0.05, 0, 0], [0, 0, 0], [0.22, 1, 0.85]);
      add(ear, S(0.11), pink, [s * 0.075, 0, 0.005], [0, 0, 0], [0.12, 0.85, 0.7]);
      add(b, Co(0.018, 0.1), mat('#fbf6ec', 'gloss'), [s * 0.06, 0.37, 0.32], [1.2, 0, 0]);
    }
    eyes(b, { x: 0.075, y: 0.52, z: 0.31, r: 0.022, yaw: 0.45 });
    const trunk = pivot(b, [0, 0.45, 0.32]);
    add(trunk, Tube([[0, 0, 0], [0, -0.1, 0.07], [0, -0.22, 0.08], [0, -0.3, 0.04], [0, -0.28, -0.01]], 0.042), skin);
    add(b, Cy(0.21, 0.21, 0.035, 28), red, [0, 0.55, -0.04]);
    add(b, Cy(0.13, 0.15, 0.28, 24), stone, [0, 0.72, -0.04]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(b, new RoundedBoxGeometry(0.06, 0.07, 0.05, 2, 0.01), stone, [Math.sin(a) * 0.12, 0.89, -0.04 + Math.cos(a) * 0.12], [0, a, 0]);
    }
    add(b, Cy(0.006, 0.006, 0.22, 6), mat('#5a4636'), [0, 1.0, -0.04]);
    const flag = pivot(b, [0, 1.07, -0.04]);
    add(flag, new RoundedBoxGeometry(0.11, 0.06, 0.008, 1, 0.003), red, [0.058, 0, 0]);
    return {
      height: 1.1,
      idle: (t) => {
        trunk.rotation.z = Math.sin(t * 1.3) * 0.18;
        trunk.rotation.x = Math.sin(t * 0.9) * 0.08;
        b.children.forEach((c) => { if (c.userData.side) c.rotation.y = c.userData.side * (0.35 + Math.sin(t * 2.4) * 0.12); });
        flag.rotation.y = Math.sin(t * 4) * 0.4;
        breathe(b, t, 1.4, 0.012);
      },
    };
  },
  // Cat queen
  q(b) {
    const fur = mat('#e08a3c'), cream = mat('#f6dcb4'), stripe = mat('#b35e22'), pink = mat('#f29aa6', 'gloss');
    add(b, S(0.17), fur, [0, 0.24, 0], [0, 0, 0], [1, 1.25, 1]);
    add(b, S(0.12), cream, [0, 0.24, 0.1], [0, 0, 0], [0.8, 1.15, 0.55]);
    for (const s of [-1, 1]) {
      add(b, C(0.042, 0.14), fur, [s * 0.065, 0.11, 0.12]);
      add(b, S(0.045), cream, [s * 0.065, 0.03, 0.15], [0, 0, 0], [1, 0.6, 1.2]);
      add(b, Co(0.055, 0.1), fur, [s * 0.08, 0.66, 0.02], [0, 0, -s * 0.3]);
      add(b, Co(0.032, 0.06), pink, [s * 0.078, 0.655, 0.035], [0, 0, -s * 0.3]);
      add(b, S(0.042), cream, [s * 0.034, 0.47, 0.155]);
      for (const k of [-1, 1]) add(b, Cy(0.003, 0.003, 0.14, 4), mat('#ffffff'), [s * 0.1, 0.475 + k * 0.012, 0.16], [0, 0, Math.PI / 2 + k * 0.12 * s]);
    }
    add(b, S(0.145), fur, [0, 0.52, 0.04], [0, 0, 0], [1.1, 0.95, 1]);
    for (let i = 0; i < 3; i++) add(b, S(0.03), stripe, [(i - 1) * 0.045, 0.64, 0.02], [0, 0, 0], [0.5, 0.4, 1.4]);
    add(b, S(0.016), pink, [0, 0.495, 0.18]);
    eyes(b, { x: 0.058, y: 0.54, z: 0.14, r: 0.032, yaw: 0.25, pupil: 'slit', iris: '#8fd16a' });
    crown(b, [0.02, 0.665, 0.03], 0.06, [0.1, 0, -0.15]);
    const tail = pivot(b, [0.06, 0.06, -0.15]);
    add(tail, Tube([[0, 0, 0], [0.12, 0.0, -0.04], [0.2, 0.05, 0.06], [0.17, 0.07, 0.16], [0.09, 0.09, 0.21]], 0.03), fur);
    return { height: 0.86, idle: (t) => { tail.rotation.y = Math.sin(t * 1.4) * 0.2; breathe(b, t, 1.9); } };
  },
  // Pug king
  k(b) {
    const fawn = mat('#d9b48a'), mask = mat('#3b2c26'), red = mat('#c8323c', 'cloth');
    add(b, S(0.19), fawn, [0, 0.25, 0], [0, 0, 0], [1, 1.15, 1]);
    for (const s of [-1, 1]) {
      add(b, C(0.048, 0.14), fawn, [s * 0.075, 0.11, 0.12]);
      add(b, S(0.05), fawn, [s * 0.075, 0.03, 0.15], [0, 0, 0], [1, 0.6, 1.2]);
      add(b, S(0.06), mask, [s * 0.14, 0.66, 0.03], [0.3, 0, s * 0.9], [0.4, 1, 0.8]);
    }
    add(b, S(0.17), fawn, [0, 0.56, 0.05], [0, 0, 0], [1.15, 0.95, 1]);
    add(b, S(0.1), mask, [0, 0.52, 0.17], [0, 0, 0], [1.3, 0.9, 0.6]);
    add(b, S(0.025), mat('#1a1210', 'gloss'), [0, 0.545, 0.225], [0, 0, 0], [1.4, 0.8, 0.8]);
    add(b, S(0.03), mat('#ef7d8f', 'gloss'), [0.02, 0.465, 0.2], [0.4, 0, 0], [1, 1.4, 0.6]);
    eyes(b, { x: 0.075, y: 0.59, z: 0.17, r: 0.046, yaw: 0.45, pupilSize: 0.62 });
    add(b, Cy(0.17, 0.27, 0.38, 28, true, Math.PI * 0.32, Math.PI * 1.36), red, [0, 0.3, -0.02]);
    add(b, T(0.17, 0.025, Math.PI * 1.36), mat('#f7f2ea', 'cloth'), [0, 0.49, -0.02], [Math.PI / 2, 0, Math.PI * 0.18 + Math.PI / 2]);
    crown(b, [0, 0.72, 0.03], 0.1, [0.08, 0, 0]);
    add(b, T(0.04, 0.016, Math.PI * 1.6), fawn, [0, 0.22, -0.2], [0, Math.PI / 2, 0]);
    return { height: 0.98, idle: (t) => breathe(b, t, 7.5, 0.012) };
  },
};

const SEA: Record<Kind, Build> = {
  // Crab
  p(b) {
    const shell = mat('#2f8fb0'), belly = mat('#bfe6ee'), tip = mat('#f26b5a', 'gloss');
    add(b, S(0.16), shell, [0, 0.17, 0], [0, 0, 0], [1.3, 0.55, 1]);
    add(b, S(0.15), belly, [0, 0.14, 0.01], [0, 0, 0], [1.22, 0.4, 0.95]);
    for (const s of [-1, 1]) {
      add(b, Cy(0.014, 0.016, 0.11), shell, [s * 0.05, 0.27, 0.1]);
      for (const z of [-0.08, 0, 0.08]) {
        add(b, C(0.016, 0.12), shell, [s * 0.22, 0.12, z], [0, 0, s * 0.9]);
        add(b, C(0.014, 0.08), shell, [s * 0.31, 0.05, z * 1.2], [0, 0, s * 0.2]);
      }
    }
    eyes(b, { x: 0.05, y: 0.335, z: 0.1, r: 0.035, yaw: 0.15 });
    const claws: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const c = pivot(b, [s * 0.17, 0.18, 0.12], [0, -s * 0.4, 0]);
      add(c, C(0.026, 0.08), shell, [s * 0.04, 0, 0.03], [Math.PI / 2, 0, s * 0.6]);
      add(c, S(0.066), shell, [s * 0.07, 0.02, 0.12], [0, 0, 0], [0.95, 0.75, 1.25]);
      const jaw = pivot(c, [s * 0.07, 0.02, 0.19]);
      jaw.userData.jaw = true;
      add(c, Co(0.03, 0.1), tip, [s * 0.07, 0.04, 0.22], [Math.PI / 2, 0, 0], [1, 1, 0.8]);
      add(jaw, Co(0.026, 0.09), tip, [0, -0.02, 0.03], [Math.PI / 2 + 0.3, 0, 0], [1, 1, 0.7]);
      claws.push(c);
    }
    const ph = Math.random() * 10;
    return {
      height: 0.38,
      idle: (t) => {
        b.position.x = Math.sin(t * 1.3 + ph) * 0.025;
        claws.forEach((c, i) => {
          const jaw = c.children.find((o) => o.userData.jaw)!;
          jaw.rotation.x = Math.max(0, Math.sin(t * 3 + i * 2 + ph)) * 0.5;
          c.rotation.x = Math.sin(t * 1.6 + i) * 0.08;
        });
        breathe(b, t, 2.4, 0.02);
      },
    };
  },
  // Seahorse
  n(b) {
    const body = mat('#3cc2b0'), ridge = mat('#a9eedd'), fin = mat('#9fe8ff', 'glass');
    const pts: V3[] = [[0, 0.74, -0.02], [0, 0.64, -0.05], [0, 0.54, 0.0], [0, 0.44, 0.06], [0, 0.34, 0.06], [0, 0.25, 0.0], [0, 0.18, -0.07], [0, 0.1, -0.08], [0, 0.05, -0.02], [0, 0.07, 0.04], [0, 0.12, 0.04], [0, 0.13, -0.01]];
    beads(b, pts, (t) => (t < 0.25 ? 0.065 + (t / 0.25) * 0.025 : 0.09 * Math.pow(1 - (t - 0.25) / 0.75, 1.1) + 0.012), (i) => (i % 3 === 0 ? ridge : body), 46);
    add(b, S(0.08), body, [0, 0.8, 0], [0, 0, 0], [1, 0.95, 1.1]);
    add(b, Cy(0.026, 0.034, 0.15), body, [0, 0.785, 0.12], [Math.PI / 2, 0, 0]);
    add(b, Cy(0.036, 0.03, 0.025), ridge, [0, 0.785, 0.2], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) add(b, Co(0.018, 0.06, 6), ridge, [(i - 1) * 0.03, 0.89, -0.01], [0, 0, (1 - i) * 0.3]);
    eyes(b, { x: 0.062, y: 0.81, z: 0.03, r: 0.03, yaw: 1.0, iris: '#ffcf5a' });
    const dorsal = pivot(b, [0, 0.46, -0.07]);
    add(dorsal, Co(0.075, 0.17), fin, [0, 0, -0.06], [-2.0, 0, 0], [0.15, 1, 1]);
    const ph = Math.random() * 10;
    return {
      height: 0.95,
      idle: (t) => {
        b.position.y = 0.05 + Math.sin(t * 1.6 + ph) * 0.04;
        b.rotation.z = Math.sin(t * 1.1 + ph) * 0.05;
        dorsal.rotation.y = Math.sin(t * 14) * 0.35;
      },
    };
  },
  // Pufferfish in a mitre
  b(b) {
    const skin = mat('#8ecae6'), spot = mat('#3a6ea5'), spike = mat('#f1f7fb'), fin = mat('#bde9ff', 'glass'), bubble = mat('#dff6ff', 'glass');
    const puff = pivot(b, [0, 0.43, 0]);
    add(puff, S(0.21, 32, 24), skin);
    add(puff, S(0.2), mat('#e8f6fb'), [0, -0.04, 0.02], [0, 0, 0], [0.95, 0.75, 0.95]);
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const seen = new Set<string>();
    const pos = ico.attributes.position;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
      const key = v.toArray().map((n) => n.toFixed(2)).join();
      if (seen.has(key) || v.z > 0.5 || v.y < -0.75) continue;
      seen.add(key);
      const m = add(puff, Co(0.02, 0.07, 6), spike, [v.x * 0.215, v.y * 0.215, v.z * 0.215]);
      m.quaternion.setFromUnitVectors(up, v);
    }
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, y = 0.35 + (i % 3) * 0.2;
      const v = new THREE.Vector3(Math.sin(a), y, Math.cos(a) * 0.6 - 0.4).normalize();
      if (v.z > 0.3) continue;
      add(puff, S(0.022, 10, 8), spot, [v.x * 0.205, v.y * 0.205, v.z * 0.205], [0, 0, 0], [1, 1, 0.4]).lookAt(v.clone().multiplyScalar(2));
    }
    eyes(puff, { x: 0.1, y: 0.06, z: 0.15, r: 0.055, yaw: 0.5, iris: '#ffd166' });
    add(puff, T(0.03, 0.015), mat('#f28fa0', 'gloss'), [0, -0.05, 0.205]);
    for (const s of [-1, 1]) add(puff, S(0.065), fin, [s * 0.21, -0.01, 0.03], [0, s * 0.6, 0], [0.25, 0.7, 1]);
    add(puff, Co(0.075, 0.13), fin, [0, 0, -0.27], [Math.PI / 2, 0, 0], [1, 1, 0.25]);
    const mitre = mat('#f26b5a');
    add(puff, Co(0.075, 0.17, 18), mitre, [0, 0.27, -0.02], [-0.1, 0, 0], [1, 1, 0.75]);
    add(puff, S(0.022), mat('#f2c14e', 'gold'), [0, 0.36, -0.03]);
    for (const [y, r, x] of [[0.07, 0.04, 0], [0.16, 0.03, 0.03], [0.23, 0.022, -0.02]]) add(b, S(r), bubble, [x, y, 0]);
    const ph = Math.random() * 10;
    return {
      height: 0.8,
      idle: (t) => {
        puff.position.y = 0.43 + Math.sin(t * 1.7 + ph) * 0.03;
        const p = 1 + Math.max(0, Math.sin(t * 0.7 + ph)) ** 8 * 0.18;
        puff.scale.setScalar(p);
        puff.rotation.y = Math.sin(t * 0.8 + ph) * 0.15;
      },
    };
  },
  // Sea turtle with a lighthouse
  r(b) {
    const shell = mat('#2f7f6f'), plate = mat('#62b49a'), skin = mat('#9ad1c0'), white = mat('#f4f1e8'), red = mat('#e0473f');
    add(b, HS(0.27), shell, [0, 0.1, 0], [0, 0, 0], [1, 0.62, 1.12]);
    add(b, T(0.27, 0.035), plate, [0, 0.1, 0], [Math.PI / 2, 0, 0], [1, 1.12, 1]);
    add(b, Cy(0.26, 0.23, 0.06, 28), mat('#e9e0b8'), [0, 0.08, 0], [0, 0, 0], [1, 1, 1.12]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const v = new THREE.Vector3(Math.sin(a) * 0.62, 0.62, Math.cos(a) * 0.62 * 1.1).normalize();
      add(b, Cy(0.06, 0.06, 0.02, 6), plate, [v.x * 0.24, 0.1 + v.y * 0.16, v.z * 0.27]).lookAt(new THREE.Vector3(v.x * 2, 0.1 + v.y * 2, v.z * 2));
    }
    add(b, C(0.055, 0.08), skin, [0, 0.13, 0.27], [1.2, 0, 0]);
    add(b, S(0.085), skin, [0, 0.17, 0.34], [0, 0, 0], [1, 0.9, 1.1]);
    eyes(b, { x: 0.048, y: 0.2, z: 0.39, r: 0.022, yaw: 0.55, lid: { color: '#9ad1c0', droop: 0.5 } });
    const flips: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const f = pivot(b, [s * 0.22, 0.1, 0.14]);
      add(f, S(0.1), skin, [s * 0.1, 0, 0.03], [0, -s * 0.4, 0], [1.5, 0.22, 0.6]);
      f.userData.side = s;
      flips.push(f);
      add(b, S(0.06), skin, [s * 0.2, 0.08, -0.24], [0, s * 0.5, 0], [1.4, 0.25, 0.7]);
    }
    const ly = 0.26;
    add(b, Cy(0.1, 0.12, 0.08), white, [0, ly + 0.04, 0]);
    for (let i = 0; i < 4; i++) add(b, Cy(0.096 - (i + 1) * 0.006, 0.1 - i * 0.006, 0.075), i % 2 ? white : red, [0, ly + 0.115 + i * 0.075, 0]);
    add(b, Cy(0.1, 0.1, 0.02), mat('#33373d'), [0, ly + 0.43, 0]);
    add(b, T(0.095, 0.007), mat('#33373d'), [0, ly + 0.47, 0], [Math.PI / 2, 0, 0]);
    add(b, Cy(0.058, 0.058, 0.08), mat('#fff6d0', 'glass'), [0, ly + 0.48, 0]);
    const lamp = add(b, S(0.038), mat('#ffe9a0', 'glow'), [0, ly + 0.48, 0]);
    lamp.parent!.remove(lamp);
    const lampPivot = pivot(b, [0, ly + 0.48, 0]);
    lampPivot.add(lamp);
    lamp.position.set(0, 0, 0);
    add(b, Co(0.075, 0.08), red, [0, ly + 0.56, 0]);
    add(b, S(0.016), mat('#f2c14e', 'gold'), [0, ly + 0.61, 0]);
    const ph = Math.random() * 10;
    return {
      height: 0.88,
      idle: (t) => {
        flips.forEach((f) => (f.rotation.z = f.userData.side * Math.sin(t * 2 + ph) * 0.25));
        lamp.scale.setScalar(1 + Math.sin(t * 3 + ph) * 0.15);
        breathe(b, t, 1.2, 0.01);
      },
    };
  },
  // Octopus queen
  q(b) {
    const skin = mat('#8b5fbf'), light = mat('#c9a7ec');
    const tents: THREE.Group[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const g = pivot(b, [d.x * 0.08, 0.36, d.z * 0.08]);
      g.userData.i = i;
      const P = (k: number, y: number): V3 => [d.x * k, y, d.z * k];
      beads(g, [P(0, 0), P(0.1, -0.13), P(0.22, -0.27), P(0.32, -0.31), P(0.39, -0.26), P(0.37, -0.19)], (t) => 0.055 * (1 - t) + 0.014, (k) => (k % 4 === 0 ? light : skin), 18);
      tents.push(g);
    }
    add(b, S(0.17), skin, [0, 0.52, -0.05], [-0.3, 0, 0], [1, 1.3, 1.05]);
    for (let i = 0; i < 5; i++) add(b, S(0.02, 10, 8), light, [Math.sin(i * 1.7) * 0.1, 0.6 + (i % 2) * 0.08, -0.14 + Math.cos(i) * 0.03]);
    eyes(b, { x: 0.085, y: 0.48, z: 0.1, r: 0.052, yaw: 0.55, pupil: 'bar', iris: '#f5d76e' });
    add(b, S(0.03), light, [0, 0.42, 0.13], [0, 0, 0], [1.3, 0.7, 0.8]);
    crown(b, [0, 0.72, -0.12], 0.065, [-0.35, 0, 0.1], '#59d1c9');
    const ph = Math.random() * 10;
    return {
      height: 0.86,
      idle: (t) => {
        tents.forEach((g) => {
          const i = g.userData.i as number;
          g.rotation.x = Math.sin(t * 2.2 + i * 0.9 + ph) * 0.12;
          g.rotation.z = Math.cos(t * 1.9 + i * 1.3 + ph) * 0.12;
        });
        breathe(b, t, 1.6, 0.03);
      },
    };
  },
  // Blobfish king on a cushion
  k(b) {
    const blob = mat('#e8a3a8', 'slime'), dark = mat('#b7666f', 'slime'), velvet = mat('#c8323c', 'cloth');
    add(b, new RoundedBoxGeometry(0.5, 0.13, 0.5, 3, 0.05), velvet, [0, 0.065, 0]);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(b, S(0.025), mat('#f2c14e', 'gold'), [x * 0.24, 0.04, z * 0.24]);
    const y0 = 0.13;
    const jig = pivot(b, [0, y0, 0]);
    add(jig, S(0.21), blob, [0, 0.17, -0.02], [0, 0, 0], [1.15, 0.88, 1]);
    add(jig, S(0.15), blob, [0, 0.09, 0.08], [0, 0, 0], [1.25, 0.72, 1]);
    add(jig, C(0.052, 0.07), blob, [0, 0.17, 0.23], [0.35, 0, 0]);
    add(jig, T(0.06, 0.013, Math.PI), dark, [0, 0.055, 0.205], [0.2, 0, 0]);
    eyes(jig, { x: 0.088, y: 0.255, z: 0.17, r: 0.03, yaw: 0.35, pupilSize: 0.7, lid: { color: '#e8a3a8', droop: 0.75 } });
    for (const s of [-1, 1]) add(jig, S(0.06), blob, [s * 0.25, 0.1, 0], [0, 0, s * 0.5], [0.4, 0.9, 0.7]);
    add(jig, Cy(0.17, 0.26, 0.3, 28, true, Math.PI * 0.35, Math.PI * 1.3), mat('#1f8a8a', 'cloth'), [0, 0.16, -0.05]);
    crown(jig, [0.075, 0.37, -0.02], 0.048, [0.1, 0, -0.5]);
    const ph = Math.random() * 10;
    return {
      height: 0.85,
      idle: (t) => {
        const s = Math.sin(t * 3 + ph);
        jig.scale.set(1 + s * 0.035, 1 - s * 0.05, 1 + s * 0.035);
      },
    };
  },
};

export const NAMES: Record<Side, Record<Kind, string>> = {
  land: { p: 'Dachshund', n: 'Horse', b: 'Mountain goat', r: 'Elephant', q: 'Cat', k: 'Pug' },
  sea: { p: 'Crab', n: 'Seahorse', b: 'Pufferfish', r: 'Sea turtle', q: 'Octopus', k: 'Blobfish' },
};

const SCALE: Record<Kind, number> = { p: 1, n: 1.02, b: 1.02, r: 1, q: 1.12, k: 1.12 };

export function createAnimal(side: Side, kind: Kind): Animal {
  const root = new THREE.Group();
  const team = TEAM[side];
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.385, 0.07, 40), mat(team.base));
  ped.position.y = 0.035;
  ped.castShadow = ped.receiveShadow = true;
  root.add(ped);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.016, 8, 48), mat(team.rim, 'gloss'));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.07;
  root.add(rim);

  const body = new THREE.Group();
  body.position.y = 0.07;
  const holder = new THREE.Group();
  holder.position.y = 0.07;
  holder.scale.setScalar(SCALE[kind]);
  root.add(holder);
  body.position.y = 0;
  holder.add(body);

  const built = (side === 'land' ? LAND : SEA)[kind](body);
  bake(body);
  // Pivot groups were built before baking; their idle functions keep working.
  const idle = built.idle ?? ((t: number) => breathe(body, t));
  return { side, kind, root, body: holder, height: built.height * SCALE[kind] + 0.07, idle };
}
