/**
 * Shared building blocks for the diorama: a material cache, a disposal bin,
 * a static-mesh batcher (merge per material to keep draw calls low) and the wind shader patch.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Disposable = { dispose(): void };

/** Everything the world creates goes in here so dispose() can free it. */
export class Bin {
  private items = new Set<Disposable>();
  add<T extends Disposable>(x: T): T {
    this.items.add(x);
    return x;
  }
  dispose(): void {
    for (const x of this.items) x.dispose();
    this.items.clear();
  }
}

export type MatKind = 'toy' | 'gloss' | 'matte' | 'wood' | 'metal';

/** Cached toy materials (vinyl/clay look), one per colour + kind. */
export class Materials {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(private bin: Bin) {}

  get(color: THREE.ColorRepresentation, kind: MatKind = 'toy'): THREE.MeshStandardMaterial {
    const key = `${new THREE.Color(color).getHexString()}:${kind}`;
    let m = this.cache.get(key);
    if (m) return m;
    switch (kind) {
      case 'gloss':
        m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.18 });
        break;
      case 'matte':
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
        break;
      case 'wood':
        m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, clearcoat: 0.35, clearcoatRoughness: 0.5 });
        break;
      case 'metal':
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 1 });
        break;
      default:
        m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 });
    }
    this.cache.set(key, this.bin.add(m));
    return m;
  }
}

/**
 * Collects static meshes and merges them into one mesh per material.
 * Geometries are cloned, so callers may reuse a source geometry many times.
 */
export class StaticBatch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private tmp = new THREE.Matrix4();

  constructor(private bin: Bin) {}

  add(geo: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4): void {
    const g = normalise(geo).applyMatrix4(matrix);
    let list = this.parts.get(material);
    if (!list) this.parts.set(material, (list = []));
    list.push(g);
  }

  /** Add one mesh at a position/rotation/scale. */
  put(
    geo: THREE.BufferGeometry, material: THREE.Material,
    pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1,
  ): void {
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale);
    this.tmp.compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), s);
    this.add(geo, material, this.tmp);
  }

  /** Add every mesh under an object, using its world matrices. The object itself is not kept. */
  addObject(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && !Array.isArray(o.material)) this.add(o.geometry, o.material, o.matrixWorld);
    });
  }

  build(name: string, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(this.bin.add(merged), material);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Non-indexed copy with exactly position/normal/uv, so any mix of shapes can merge. */
function normalise(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
  }
  g.clearGroups();
  return g;
}

export interface WindUniforms {
  uTime: { value: number };
  uWind: { value: number };
}

/**
 * Bends vertices in the wind. Height above `groundY` (after the instance matrix) sets how far
 * a vertex sways, so grass tips and flower heads move while roots stay put.
 */
export function addWind(mat: THREE.Material, u: WindUniforms, groundY: number, strength: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uWind = u.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      {
        float hgt = max( mvPosition.y - ${groundY.toFixed(3)}, 0.0 );
        float phase = dot( mvPosition.xz, vec2( 1.7, 1.1 ) );
        float gust = sin( uTime * 0.8 - mvPosition.x * 0.45 + mvPosition.z * 0.25 ) * 0.5 + 0.5;
        float sway = ( sin( uTime * 2.4 + phase ) * 0.35 + gust * gust * 0.9 ) * uWind;
        float k = hgt * hgt * ${strength.toFixed(3)};
        mvPosition.x += sway * k;
        mvPosition.z -= sway * k * 0.35;
        mvPosition.y -= abs( sway ) * k * 0.15;
      }
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.customProgramCacheKey = () => `wind:${groundY}:${strength}`;
}

export const rand = (a: number, b: number, r: () => number) => a + r() * (b - a);

/** Small seeded random so the diorama looks the same every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
