/**
 * Accessories: small separate meshes hung on a head/neck bone, coloured through slots acc1–acc4
 * of the actor's own material. Geometry is shared and cached per accessory (and per eye layout for glasses).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Box, C, Co, Cy, S, T, clean, type V3 } from './kit';
import { FINISH, slotIndex, type Slot, type SlotStyle } from './material';
import type { Anchor } from './animals/common';

const PI = Math.PI;

export interface AccessoryDef {
  id: string;
  name: string;
  anchor: 'top' | 'face' | 'neck';
  colors: Partial<Record<'acc1' | 'acc2' | 'acc3' | 'acc4', SlotStyle>>;
  build(a: Anchor): THREE.BufferGeometry;
}

type Part = [THREE.BufferGeometry, Slot, V3?, V3?, (number | V3)?];

function bake(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(([g, slot, p = [0, 0, 0], r = [0, 0, 0], s = 1]) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
      typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
    );
    const c = clean(g).applyMatrix4(m);
    c.setAttribute('slot', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count).fill(slotIndex(slot)), 1));
    return c;
  });
  const out = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

const st = (color: string, finish = FINISH.toy): SlotStyle => ({ color, finish });

export const ACCESSORIES: AccessoryDef[] = [
  {
    id: 'party', name: 'Party hat', anchor: 'top',
    colors: { acc1: st('#ff5d8f', FINISH.gloss), acc2: st('#ffd23f', FINISH.gloss), acc3: st('#5ec8ff', FINISH.gloss) },
    build: () => bake([
      [Co(0.06, 0.17, 18), 'acc1', [0, 0.085, 0]],
      [T(0.047, 0.008, PI * 2, 4, 18), 'acc2', [0, 0.05, 0], [PI / 2, 0, 0]],
      [T(0.03, 0.007, PI * 2, 4, 16), 'acc2', [0, 0.1, 0], [PI / 2, 0, 0]],
      [S(0.024, 10, 8), 'acc3', [0, 0.175, 0]],
    ]),
  },
  {
    id: 'shades', name: 'Sunglasses', anchor: 'face',
    colors: { acc1: st('#141418', FINISH.gloss), acc2: st('#f2c14e', FINISH.gold) },
    build: (a) => {
      const w = a.w ?? 0.06, r = (a.lr ?? 0.04) * 1.15;
      const parts: Part[] = [];
      for (const s of [-1, 1]) {
        parts.push([Cy(r, r, r * 0.25, 18), 'acc1', [s * w, 0, 0], [PI / 2, 0, 0], [1.1, 1, 0.85]]);
        parts.push([T(r * 1.08, r * 0.1, PI * 2, 4, 20), 'acc2', [s * w, 0, 0.0], [0, 0, 0], [1.02, 0.8, 1]]);
        parts.push([C(r * 0.08, w * 1.2, 2, 5), 'acc2', [s * (w + r * 1.05), r * 0.2, -w * 0.6], [PI / 2, 0, 0]]);
      }
      parts.push([C(r * 0.09, Math.max(0.001, w * 2 - r * 2.2), 2, 5), 'acc2', [0, r * 0.25, 0], [0, 0, PI / 2]]);
      return bake(parts);
    },
  },
  {
    id: 'bowtie', name: 'Bow tie', anchor: 'neck',
    colors: { acc1: st('#d0263e', FINISH.gloss), acc2: st('#a81830', FINISH.gloss) },
    build: () => bake([
      [Co(0.04, 0.07, 12), 'acc1', [-0.035, 0, 0], [0, 0, -PI / 2], [1, 1, 0.55]],
      [Co(0.04, 0.07, 12), 'acc1', [0.035, 0, 0], [0, 0, PI / 2], [1, 1, 0.55]],
      [S(0.02, 10, 8), 'acc2', [0, 0, 0.008]],
    ]),
  },
  {
    id: 'flowers', name: 'Flower crown', anchor: 'top',
    colors: { acc1: st('#5aa845', FINISH.soft), acc2: st('#ff8fb8', FINISH.toy), acc3: st('#fff3a0', FINISH.toy), acc4: st('#ffb347', FINISH.toy) },
    build: () => {
      const parts: Part[] = [[T(0.085, 0.013, PI * 2, 5, 28), 'acc1', [0, 0.01, 0], [PI / 2, 0, 0]]];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2 + 0.3;
        const x = Math.sin(a) * 0.085, z = Math.cos(a) * 0.085;
        const petal = i % 2 ? 'acc2' : 'acc3';
        for (let k = 0; k < 5; k++) {
          const b = (k / 5) * PI * 2;
          parts.push([S(0.014, 8, 6), petal, [x + Math.sin(a) * Math.cos(b) * 0.016, 0.022 + Math.sin(b) * 0.016, z + Math.cos(a) * Math.cos(b) * 0.016]]);
        }
        parts.push([S(0.011, 8, 6), 'acc4', [x * 1.08, 0.022, z * 1.08]]);
        parts.push([S(0.015, 6, 5), 'acc1', [Math.sin(a + 0.5) * 0.088, 0.008, Math.cos(a + 0.5) * 0.088], [0, a, 0], [1.6, 0.5, 0.8]]);
      }
      return bake(parts);
    },
  },
  {
    id: 'pirate', name: 'Pirate hat', anchor: 'top',
    colors: { acc1: st('#22222a', FINISH.toy), acc2: st('#fbf6ec', FINISH.toy), acc3: st('#f2c14e', FINISH.gold) },
    build: () => bake([
      [S(0.1, 20, 12), 'acc1', [0, 0.05, 0], [0, 0, 0], [1.45, 0.62, 0.62]],
      [Cy(0.075, 0.085, 0.05, 18), 'acc1', [0, 0.02, 0]],
      [T(0.1, 0.007, PI, 4, 20), 'acc3', [0, 0.03, 0.03], [0, 0, 0], [1.45, 1.0, 1]],
      [S(0.022, 10, 8), 'acc2', [0, 0.065, 0.062], [0, 0, 0], [1, 1, 0.4]],
      [Box(0.04, 0.008, 0.006, 0.002), 'acc2', [0, 0.04, 0.062], [0, 0, 0.6]],
      [Box(0.04, 0.008, 0.006, 0.002), 'acc2', [0, 0.04, 0.062], [0, 0, -0.6]],
    ]),
  },
  {
    id: 'tophat', name: 'Top hat', anchor: 'top',
    colors: { acc1: st('#1c1c24', FINISH.toy), acc2: st('#c8323c', FINISH.toy) },
    build: () => bake([
      [Cy(0.105, 0.105, 0.012, 24), 'acc1', [0, 0.006, 0]],
      [Cy(0.062, 0.066, 0.13, 20), 'acc1', [0, 0.075, 0]],
      [Cy(0.068, 0.068, 0.025, 20), 'acc2', [0, 0.028, 0]],
    ]),
  },
];

const geoCache = new Map<string, THREE.BufferGeometry>();

export function accessoryGeometry(def: AccessoryDef, anchor: Anchor, key: string): THREE.BufferGeometry {
  const k = def.anchor === 'face' ? `${def.id}:${key}` : def.id;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = def.build(anchor)));
  return g;
}
