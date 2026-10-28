/**
 * Raid treasures (Phase 4). Home markers (a dog bowl at Land's home, an open pink shell at Sea's) show while
 * treasures are set. A treasure lying on the board (at home or dropped) floats there with a soft glow and a slow
 * bob: Land's bone is a cream cartoon bone, Sea's pearl a glossy white pearl. A carried one is the cast's job.
 * Changes animate: a little hop when one appears, a hop out with a sparkle and a hop in at the new square when it
 * moves (flying home: no flight path, by the spec), a lift-and-shrink when it leaves (picked up). Nothing here catches clicks (`noPick`).
 *
 * Shared look with the cast (carried treasures): bone #f3e6c8, pearl #f7f4ee, pink shell #f2a7b5.
 * `makeBoneGeometry` / `makePearlGeometry` are exported so the cast can use the exact same shapes.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Side, Square, TreasureState } from '../contracts/types';
import { clamp01, ease } from './anim';
import type { Particles } from './chaos';
import { BOARD_TOP } from './constants';
import { squareToXZ } from './coords';
import type { Bin } from './kit';
import type { Textures } from './textures';

export const TREASURE_COLORS = { bone: '#f3e6c8', pearl: '#f7f4ee', shell: '#f2a7b5' } as const;

const BOWL = { outer: '#e4574b', inner: '#dfe6ea', rim: '#f6efe4' } as const;
const SHELL_INSIDE = '#f9c9d3';
const SHELL_RIB = '#e07f95';

/** A cream cartoon bone along x, about 0.4 long (0.35-0.4 of a square), centred on the origin. */
export function makeBoneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.042, 0.042, 0.27, 14).rotateZ(Math.PI / 2)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.SphereGeometry(0.062, 16, 12).translate(sx * 0.14, 0, sz * 0.046));
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** A pearl, 0.3 across, centred on the origin. */
export function makePearlGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.15, 32, 20);
}

/** Non-indexed copy with position, normal and a vertex colour from a function of the position. */
function paint(src: THREE.BufferGeometry, color: (p: THREE.Vector3) => THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  src.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.set(color(v.fromBufferAttribute(pos, i)));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

/** A low dog bowl, red outside, steel-pale inside. The bone rests in it at about y 0.1. */
function bowlGeometry(): THREE.BufferGeometry {
  const profile = [[0, 0.035], [0.17, 0.035], [0.215, 0.085], [0.24, 0.112], [0.262, 0.114], [0.278, 0.1], [0.33, 0.006], [0.32, 0], [0, 0]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  return paint(new THREE.LatheGeometry(profile, 40), (p) => {
    const r = Math.hypot(p.x, p.z);
    if (p.y > 0.105 && r > 0.235 && r < 0.282) return BOWL.rim;
    return r < 0.245 && p.y > 0.03 ? BOWL.inner : BOWL.outer;
  });
}

/** One scallop valve: a ribbed fan opening toward +z from a hinge at the origin. */
function valve(R: number, depth: number): THREE.BufferGeometry {
  const NA = 40, NR = 10, A = 1.25;
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NR; j++) {
    const r = j / NR;
    for (let i = 0; i <= NA; i++) {
      const a = -A + (2 * A * i) / NA;
      const rr = R * r * (1 + 0.045 * Math.cos(a * 16) * r);
      const rib = 0.014 * (0.5 + 0.5 * Math.cos(a * 16)) * r;
      pos.push(Math.sin(a) * rr, depth * Math.pow(r, 1.6) + rib, Math.cos(a) * rr);
    }
  }
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
    const a = j * (NA + 1) + i, b = a + NA + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An open pink shell: the bottom valve cups the pearl, the top one stands open behind it. */
function shellGeometry(): THREE.BufferGeometry {
  const ribColor = (p: THREE.Vector3) => {
    const a = Math.atan2(p.x, p.z);
    return Math.cos(a * 16) > 0.55 ? SHELL_RIB : TREASURE_COLORS.shell;
  };
  const bottom = paint(valve(0.34, 0.07).translate(0, 0.012, 0), (p) => (Math.hypot(p.x, p.z) < 0.27 ? SHELL_INSIDE : ribColor(p)));
  const top = paint(valve(0.34, 0.07).scale(1, -1, 1).rotateX(-1.15).translate(0, 0.02, 0), ribColor);
  const hinge = paint(new THREE.SphereGeometry(0.05, 12, 8).scale(1.6, 0.8, 0.9).translate(0, 0.03, 0), () => SHELL_RIB);
  const g = mergeGeometries([bottom, top, hinge])!;
  [bottom, top, hinge].forEach((p) => p.dispose());
  // Centre the fan on the square: the hinge sits toward the back.
  return g.translate(0, 0, -0.16);
}

interface Item {
  owner: Side;
  root: THREE.Group;
  body: THREE.Mesh;
  glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Where it is drawn (null = hidden). */
  square: Square | null;
  home: Square | null;
  anim: { kind: 'appear' | 'swap' | 'leave'; t: number; dur: number; from: THREE.Vector3; sparkled?: boolean } | null;
  twinkle: number;
}

/** A treasure in the air (Raid "pass and run"): a copy of the bone or pearl, so the board item is left alone. */
interface Flight {
  side: Side;
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  height: number;
  intercepted: boolean;
  reduced: boolean;
  /** The home square an interception lands on (the treasure stays there, so a later `set` changes nothing). */
  home: Square | null;
  trail: number;
  resolve: () => void;
}

/** Height a thrown treasure leaves and reaches an animal at (about mouth height). */
const MOUTH_Y = 0.5;
export const FLY_TIMING = { catch: 0.45, intercepted: 0.38, reduced: 0.25 } as const;

interface Marker {
  root: THREE.Group;
  pop: number;
}

export class Treasures {
  readonly group = new THREE.Group();
  private items: Record<Side, Item>;
  private markers: Record<Side, Marker>;
  private prewarm = false;
  private fliers: Record<Side, THREE.Group>;
  private flights: Flight[] = [];
  private time = 0;

  constructor(bin: Bin, tex: Textures, private particles: Particles, private reducedMotion: () => boolean) {
    this.group.name = 'treasures';
    this.group.userData.noPick = true;

    const markerMat = bin.add(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide }));
    const bowl = new THREE.Mesh(bin.add(bowlGeometry()), markerMat);
    const shell = new THREE.Mesh(bin.add(shellGeometry()), markerMat);
    const marker = (mesh: THREE.Mesh, name: string): Marker => {
      mesh.castShadow = mesh.receiveShadow = true;
      const root = new THREE.Group();
      root.name = name;
      root.add(mesh);
      root.visible = false;
      this.group.add(root);
      return { root, pop: 1 };
    };
    this.markers = { land: marker(bowl, 'home-bowl'), sea: marker(shell, 'home-shell') };

    const boneMat = bin.add(new THREE.MeshPhysicalMaterial({
      color: TREASURE_COLORS.bone, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35, emissive: TREASURE_COLORS.bone, emissiveIntensity: 0.12,
    }));
    const pearlMat = bin.add(new THREE.MeshPhysicalMaterial({
      color: TREASURE_COLORS.pearl, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06,
      iridescence: 0.7, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 520],
      sheen: 1, sheenColor: new THREE.Color(TREASURE_COLORS.shell), sheenRoughness: 0.4,
      emissive: TREASURE_COLORS.pearl, emissiveIntensity: 0.08,
    }));
    const glowGeo = bin.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const glowMat = (color: string) => bin.add(new THREE.MeshBasicMaterial({
      map: tex.softDisc, color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    const item = (owner: Side, geo: THREE.BufferGeometry, mat: THREE.Material, glowColor: string): Item => {
      const root = new THREE.Group();
      root.name = owner === 'land' ? 'treasure-bone' : 'treasure-pearl';
      const body = new THREE.Mesh(bin.add(geo), mat);
      body.castShadow = true;
      const glow = new THREE.Mesh(glowGeo, glowMat(glowColor));
      glow.renderOrder = 1;
      glow.scale.setScalar(0.95);
      root.add(body, glow);
      root.visible = false;
      this.group.add(root);
      return { owner, root, body, glow, square: null, home: null, anim: null, twinkle: Math.random() * 0.5 };
    };
    this.items = {
      land: item('land', makeBoneGeometry(), boneMat, '#ffe7a6'),
      sea: item('sea', makePearlGeometry(), pearlMat, '#ffd2e0'),
    };
    const flier = (side: Side) => {
      const g = new THREE.Group();
      g.name = `flying-${this.items[side].root.name}`;
      const body = new THREE.Mesh(this.items[side].body.geometry, this.items[side].body.material);
      body.castShadow = true;
      g.add(body);
      g.visible = false;
      this.group.add(g);
      return g;
    };
    this.fliers = { land: flier('land'), sea: flier('sea') };
  }

  /**
   * Raid "pass and run": the treasure arcs from `from` to `to` with a spin and a soft trail, and pops when it lands
   * (about 0.45s). `intercepted`: a higher, quicker arc straight into its home bowl or shell, with a sparkle; it then
   * stays drawn there. Otherwise it vanishes on landing (integration shows it in the catcher's mouth).
   * Reduced motion: a short fade-hop. Resolves on landing.
   */
  fly(side: Side, from: Square, to: Square, intercepted = false): Promise<void> {
    for (const f of this.flights.filter((x) => x.side === side)) this.land(f);
    const it = this.items[side];
    // The board item, if shown at either end, steps aside while this one flies.
    if (it.square === from || it.square === to) {
      it.square = null;
      it.anim = null;
      it.root.visible = false;
    }
    const reduced = this.reducedMotion();
    const a = squareToXZ(from), b = squareToXZ(to);
    const start = new THREE.Vector3(a.x, BOARD_TOP + MOUTH_Y, a.z);
    // Intercepted: into its bowl or shell (its resting float height); a catch: into the catcher's mouth.
    const end = intercepted ? this.rest(it, to, new THREE.Vector3()).add(new THREE.Vector3(0, 0.045, 0)) : new THREE.Vector3(b.x, BOARD_TOP + MOUTH_Y, b.z);
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const obj = this.fliers[side];
    obj.position.copy(start);
    obj.scale.setScalar(1);
    obj.visible = true;
    return new Promise((resolve) => {
      this.flights.push({
        side, obj, from: start, to: end, t: 0, intercepted, reduced, home: intercepted ? to : null, trail: 0, resolve,
        dur: reduced ? FLY_TIMING.reduced : intercepted ? FLY_TIMING.intercepted : FLY_TIMING.catch,
        height: reduced ? 0.15 : intercepted ? 1.1 + 0.08 * dist : 0.45 + 0.06 * dist,
      });
    });
  }

  /** Show every part for one frame (shader warm-up before reveal), or hide them again. */
  setPrewarm(on: boolean): void {
    this.prewarm = on;
    for (const side of ['land', 'sea'] as const) {
      const m = this.markers[side], it = this.items[side];
      if (!it.home) {
        m.root.visible = on;
        m.root.position.set(side === 'land' ? -0.5 : 0.5, BOARD_TOP, 0);
      }
      if (!it.square) {
        it.root.visible = on;
        it.root.position.set(side === 'land' ? -0.5 : 0.5, BOARD_TOP + 0.3, 0);
      }
    }
  }

  set(list: readonly TreasureState[]): void {
    const by = new Map<Side, TreasureState>(list.map((t) => [t.owner, t]));
    for (const side of ['land', 'sea'] as const) {
      const t = by.get(side);
      const it = this.items[side], mk = this.markers[side];
      if (!t) {
        // Hide at once (a new game or another mode).
        it.square = it.home = null;
        it.anim = null;
        it.root.visible = mk.root.visible = false;
        continue;
      }
      if (it.home !== t.home) {
        it.home = t.home;
        const { x, z } = squareToXZ(t.home);
        mk.root.position.set(x, BOARD_TOP, z);
        // The shell opens toward the middle of the board.
        mk.root.rotation.y = z < 0 ? 0 : Math.PI;
        mk.root.visible = true;
        mk.pop = 0;
      }
      const next = t.carrier ? null : t.square;
      if (next === it.square) continue;
      const reduced = this.reducedMotion();
      if (next && it.square && it.root.visible) {
        it.anim = { kind: 'swap', t: 0, dur: reduced ? 0.35 : 0.85, from: it.root.position.clone() };
        if (!reduced) this.burst(it.root.position);
      } else if (next) {
        it.anim = { kind: 'appear', t: 0, dur: reduced ? 0.25 : 0.55, from: new THREE.Vector3() };
      } else if (it.root.visible) {
        it.anim = { kind: 'leave', t: 0, dur: reduced ? 0.15 : 0.28, from: it.root.position.clone() };
      }
      it.square = next;
      if (next) it.root.visible = true;
    }
  }

  update(dt: number, elapsed: number): void {
    this.time += dt;
    const reduced = this.reducedMotion();
    for (const f of [...this.flights]) this.stepFlight(f, dt);
    for (const side of ['land', 'sea'] as const) {
      const mk = this.markers[side];
      if (mk.pop < 1) {
        mk.pop = Math.min(1, mk.pop + dt / (reduced ? 0.2 : 0.45));
        mk.root.scale.setScalar(Math.max(0.001, reduced ? mk.pop : ease.backOut(mk.pop)));
      }
      const it = this.items[side];
      if (!it.root.visible || (this.prewarm && !it.square && !it.anim)) continue;
      this.place(it, dt, elapsed, reduced);
    }
  }

  clear(): void {
    this.set([]);
  }

  /** Where each treasure is drawn (null = hidden, carried or leaving), and whether its home marker shows. */
  shown(side: Side): { square: Square | null; marker: boolean } {
    return { square: this.items[side].square, marker: this.markers[side].root.visible };
  }

  /** True when this treasure is drawn lying on `sq` (not carried, not leaving). */
  isLyingAt(side: Side, sq: Square): boolean {
    const it = this.items[side];
    return it.square === sq && it.root.visible && it.anim?.kind !== 'leave';
  }

  /** Raid pigeon: take the treasure off the board and hand back a copy for the beak (same shape and material, real size). */
  grabForPigeon(side: Side): THREE.Object3D {
    const it = this.items[side];
    it.square = null;
    it.anim = null;
    it.root.visible = false;
    const cargo = new THREE.Group();
    cargo.name = `beak-${it.root.name}`;
    const body = new THREE.Mesh(it.body.geometry, it.body.material);
    body.castShadow = true;
    cargo.add(body);
    return cargo;
  }

  /** Raid pigeon: the treasure drops onto `to` with a little hop. A later `set` with the same square changes nothing. */
  dropFromPigeon(side: Side, to: Square): void {
    const it = this.items[side];
    it.square = to;
    it.root.visible = true;
    it.anim = { kind: 'appear', t: 0, dur: this.reducedMotion() ? 0.25 : 0.5, from: new THREE.Vector3() };
  }

  dispose(): void {
    for (const f of [...this.flights]) this.land(f);
    this.group.removeFromParent();
  }

  // ---------- internals ----------

  private stepFlight(f: Flight, dt: number): void {
    f.t += dt;
    const k = clamp01(f.t / f.dur);
    const p = f.obj.position;
    p.lerpVectors(f.from, f.to, f.reduced ? k : ease.sineInOut(k));
    p.y += Math.sin(Math.PI * k) * f.height;
    if (f.reduced) {
      f.obj.scale.setScalar(Math.max(0.001, Math.sin(Math.PI * Math.min(1, 0.15 + k * 0.85))));
    } else {
      f.obj.rotation.y += dt * (f.intercepted ? 16 : 11);
      f.obj.rotation.z = Math.sin(k * Math.PI * 2) * 0.4;
      // A soft trail of puffs in the treasure's glow colour.
      if ((f.trail -= dt) <= 0) {
        f.trail = 0.016;
        this.particles.emit({
          x: p.x, y: p.y, z: p.z, vx: 0, vy: 0.05, vz: 0, life: 0.32, size: [0.2, 0.05],
          color: f.side === 'land' ? '#fff0c4' : '#ffe2ec', alpha: 0.5, gravity: 0, drag: 3,
        });
      }
    }
    if (k >= 1) this.land(f);
  }

  /** Landing: a pop (a sparkle burst when intercepted), then the flier hides and the promise resolves. */
  private land(f: Flight): void {
    const i = this.flights.indexOf(f);
    if (i < 0) return;
    this.flights.splice(i, 1);
    f.obj.visible = false;
    f.obj.rotation.set(0, 0, 0);
    if (!f.reduced) {
      if (f.intercepted) this.burst(f.to);
      else this.pop(f.to, f.side);
    }
    if (f.home) {
      const it = this.items[f.side];
      it.square = f.home;
      it.anim = null;
      it.root.visible = true;
      it.root.position.copy(f.to);
    }
    f.resolve();
  }

  /** A small pop where a thrown treasure is caught. */
  private pop(at: THREE.Vector3, side: Side): void {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.particles.emit({
        x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 0.7, vy: 0.3, vz: Math.sin(a) * 0.7,
        life: 0.3, size: [0.12, 0.02], color: side === 'land' ? '#fff4c2' : '#ffe6f0', alpha: 0.9, gravity: 0, drag: 4, shape: 1,
      });
    }
  }

  /** Resting centre of a treasure on a square: in its bowl or shell at home, else on the board. */
  private rest(it: Item, sq: Square, out: THREE.Vector3): THREE.Vector3 {
    const { x, z } = squareToXZ(sq);
    const home = sq === it.home;
    const lift = it.owner === 'land' ? (home ? 0.1 : 0.065) : home ? 0.17 : 0.15;
    return out.set(x, BOARD_TOP + lift, z);
  }

  private place(it: Item, dt: number, el: number, reduced: boolean): void {
    const pos = it.root.position;
    const target = it.square ? this.rest(it, it.square, new THREE.Vector3()) : pos.clone();
    // Floats a little above its rest spot with a slow bob.
    target.y += reduced ? 0.02 : 0.045 + Math.sin(el * 1.7 + (it.owner === 'land' ? 0 : 2)) * 0.025;
    let scale = 1;
    let glow = 1;
    const a = it.anim;
    if (a) {
      a.t += dt;
      const k = clamp01(a.t / a.dur);
      // A swap hops out at the old square (first 40%), then hops in at the new one like an appear.
      const inK = a.kind === 'swap' ? clamp01((k - 0.4) / 0.6) : k;
      if (a.kind === 'swap' && k < 0.4) {
        const o = k / 0.4;
        pos.copy(a.from);
        pos.y += reduced ? 0 : Math.sin(Math.PI * 0.5 * o) * 0.3;
        scale = 1 - ease.cubicIn(o);
        glow = 1 - o;
      } else if (a.kind === 'appear' || a.kind === 'swap') {
        if (a.kind === 'swap' && !a.sparkled) {
          a.sparkled = true;
          if (!reduced) this.burst(target);
        }
        // Drops in from a little above and lands with a hop.
        const fall = clamp01(inK / 0.6);
        const hop = inK > 0.6 ? Math.sin((Math.PI * (inK - 0.6)) / 0.4) * 0.12 : 0;
        pos.copy(target);
        pos.y += reduced ? 0 : (1 - ease.cubicIn(fall)) * 0.6 + hop;
        scale = reduced ? inK : ease.backOut(clamp01(inK / 0.35));
        glow = inK;
      } else {
        // Picked up: a quick lift and shrink.
        pos.copy(a.from);
        pos.y += 0.25 * ease.cubicOut(k);
        scale = 1 - ease.cubicIn(k);
        glow = 1 - k;
      }
      if (k >= 1) {
        it.anim = null;
        if (a.kind === 'leave') {
          it.root.visible = false;
          return;
        }
      }
    } else if (it.square) {
      pos.copy(target);
    }
    if (!reduced) it.body.rotation.y += dt * (it.owner === 'land' ? 0.6 : 0.35);
    it.body.scale.setScalar(Math.max(0.001, scale));
    // The glow lies on the board under the treasure and breathes.
    it.glow.position.y = BOARD_TOP + 0.008 - pos.y;
    it.glow.material.opacity = 0.4 * glow * (reduced ? 1 : 0.85 + 0.15 * Math.sin(el * 2.2));
    if (!reduced && it.square && !a && (it.twinkle -= dt) <= 0) {
      it.twinkle = 0.45 + Math.random() * 0.3;
      const ang = Math.random() * Math.PI * 2;
      this.particles.emit({
        x: pos.x + Math.cos(ang) * 0.2, y: pos.y + 0.05, z: pos.z + Math.sin(ang) * 0.2,
        vx: 0, vy: 0.25, vz: 0, life: 0.7, size: [0.12, 0.02], color: '#fffbe8', alpha: 0.9, gravity: 0, shape: 1,
      });
    }
  }

  /** A puff of sparkles (a treasure leaving or arriving by magic). */
  private burst(at: THREE.Vector3): void {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.particles.emit({
        x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 0.9, vy: 0.6 + Math.random() * 0.5, vz: Math.sin(a) * 0.9,
        life: 0.55, size: [0.14, 0.03], color: i % 2 ? '#fff4c2' : '#ffffff', alpha: 0.95, gravity: -1.5, drag: 2, shape: 1,
      });
    }
  }
}

