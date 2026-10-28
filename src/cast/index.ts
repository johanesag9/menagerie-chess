/**
 * Cast stream: the 12 animals and all their animations.
 *
 * `createCast(opts)` returns the contract `Cast` plus a few extras (see `CastExtras`):
 * - `on('stomp' | 'impact' | 'land' | 'poof' | 'power' | 'splash', fn)`: hooks for camera shake and sounds.
 * - `setReducedMotion(on)`: shorter moves, no spins or flips, shake intensity 0.
 * - `preload(renderer, scene, camera)`: builds every animal and compiles shaders up front (no hitch on first reveal).
 * - `skipAll()`: jump every running animation to its end (for "click to skip").
 * - `setLook('clean' | 'cartoon')`: how loud the impact frames are ('cartoon' by default, Johanes's pick).
 *
 * Expected capture flow for integration:
 *   await attacker.attack(victim); victim.defeat(attacker); await attacker.moveTo(square);
 */
import * as THREE from 'three';
import type { Cast, CastOptions, PieceKind, PieceState, Side, SkinChoice } from '../contracts/types';
import type { CreateCast } from '../contracts/factories';
import { Emitter } from '../contracts/emitter';
import { Actor, type CastEventMap } from './actor';
import { PALETTES } from './palettes';
import { ACCESSORIES } from './accessories';
import { ROSTER, KINDS, getTemplate } from './roster';
import { createSlotMaterial } from './material';
import { instantiate } from './kit';
import { paletteTable } from './palettes';
import { fxMaterials } from './fx';
import { partyMaterials } from './party';
import { motion, setLook, setReducedMotion, type Look } from './motion';
import { vfxWarmup } from './vfx';

export type { CastEventMap } from './actor';
export type { Look } from './motion';
export { Actor } from './actor';

export interface CastExtras {
  on<K extends keyof CastEventMap>(name: K, fn: (payload: CastEventMap[K]) => void): () => void;
  setReducedMotion(on: boolean): void;
  readonly reducedMotion: boolean;
  /** Impact look: 'clean' or 'cartoon' (the default). */
  setLook(look: Look): void;
  readonly look: Look;
  preload(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
  skipAll(): void;
  /** Every live actor this cast created. */
  readonly actors: ReadonlySet<Actor>;
}

export type CastWithExtras = Omit<Cast, 'createPiece'> & CastExtras & { createPiece(state: PieceState, skin?: SkinChoice): Actor };

export function createCast(opts: CastOptions): CastWithExtras {
  const events = new Emitter<CastEventMap>();
  const actors = new Set<Actor>();
  const emit = <K extends keyof CastEventMap>(name: K, p: CastEventMap[K]) => events.emit(name, p);

  return {
    createPiece(state, skin) {
      const a = new Actor(state, skin, emit, opts.squareSize, opts.quality);
      actors.add(a);
      const dispose = a.dispose.bind(a);
      a.dispose = () => { actors.delete(a); dispose(); };
      return a;
    },
    listSkins(side: Side) {
      return {
        palettes: PALETTES[side].map((p) => ({ id: p.id, name: p.name, swatch: p.swatch })),
        accessories: [{ id: 'none', name: 'None' }, ...ACCESSORIES.map((a) => ({ id: a.id, name: a.name }))],
      };
    },
    displayName(side: Side, kind: PieceKind) {
      return ROSTER[side][kind].name;
    },
    on: (name, fn) => events.on(name, fn),
    setReducedMotion,
    get reducedMotion() { return motion.reduced; },
    setLook,
    get look() { return motion.look; },
    async preload(renderer, scene, camera) {
      const lite = opts.quality === 'low';
      const tmp = new THREE.Group();
      tmp.position.set(0, -500, 0);
      for (const side of ['land', 'sea'] as const) {
        for (const k of KINDS) {
          const t = getTemplate(side, k, opts.quality);
          tmp.add(instantiate(t.rig, createSlotMaterial(paletteTable(t.def, undefined), lite)).mesh);
        }
      }
      // A non-skinned mesh with the slot material too (accessories use it).
      const acc = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), createSlotMaterial(paletteTable(getTemplate('land', 'p', opts.quality).def, undefined), lite));
      acc.geometry.setAttribute('slot', new THREE.BufferAttribute(new Float32Array(acc.geometry.attributes.position.count), 1));
      tmp.add(acc);
      for (const m of [...fxMaterials(), ...partyMaterials()]) {
        tmp.add(m instanceof THREE.SpriteMaterial ? new THREE.Sprite(m) : new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), m));
      }
      // Pooled effects draw instanced, which compiles its own shader variants.
      for (const m of vfxWarmup()) tmp.add(m);
      scene.add(tmp);
      try {
        await renderer.compileAsync(scene, camera);
        // Draw them once too (off-screen, so nothing shows): some GPUs only finish a pipeline on its first draw,
        // which stalled the first splash by ~100ms.
        tmp.traverse((o) => { o.frustumCulled = false; });
        renderer.render(scene, camera);
      } finally {
        tmp.removeFromParent();
        tmp.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.Mesh).geometry.dispose();
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.dispose();
        });
      }
    },
    skipAll() { for (const a of actors) a.skip(); },
    actors,
  };
}

// Compile-time check against the contract factory.
void (createCast satisfies CreateCast);
