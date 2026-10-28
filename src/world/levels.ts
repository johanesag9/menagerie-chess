/**
 * Sandcastle King (Phase 6): square heights as stacked sand tiers, a little sandcastle on level 3, and the flag
 * on the castle being held.
 * - Level 1 and 2 are soft-bevelled tiers, each a little smaller than the one below. On the meadow half they are
 *   packed earth with a grass cap ("turf", the default); on the beach, sand. `setMeadowLook('sand')` makes the meadow sand too.
 * - Level 3 is a sandcastle (keep, four turrets, crenels, a door facing each side, a flag spot) on top of tier 2.
 * - A change animates: a tier pats on with a sand puff, or is scooped off with spilled grains (about 0.4s); the castle
 *   pops up or crumbles. Several squares lowered at once is the tide: they wash down one rank after another, Sea side first.
 * Draw calls: meadow tiers, beach tiers and castles are one instanced mesh each (only live instances are drawn).
 * The flag is two small meshes, hidden when nobody holds a castle. Picking uses `tops` (see coords.ts `rayToColumns`).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Level, Side, Square } from '../contracts/types';
import { clamp01, ease } from './anim';
import type { Particles } from './chaos';
import { BOARD_TOP, PALETTE, SQUARE } from './constants';
import { squareIdx } from './coords';
import type { Bin } from './kit';

/** Height of one level in world units (a square is 1). */
export const LEVEL_H = 0.28;

/** Seconds. `stack` = the gap between two tiers of one square (the Builder's +2); `tideStagger` = per rank. */
export const LEVEL_TIMING = {
  normal: { build: 0.42, dig: 0.4, castle: 0.55, tide: 0.6, tideStagger: 0.1, stack: 0.15 },
  reduced: { build: 0.22, dig: 0.22, castle: 0.25, tide: 0.3, tideStagger: 0.03, stack: 0.06 },
} as const;

/** Board-local y of the walkable top at a level. */
export function levelTop(level: number): number {
  return BOARD_TOP + level * LEVEL_H;
}

/** Half the width of a raised column, for picking (the bottom tier, a touch generous). */
export const COLUMN_HALF = 0.47;

/**
 * How one `setLevels` call changes the board. `tide`: two or more squares go down and none go up
 * (a dig or a build only ever changes one square per call).
 */
export function diffLevels(prev: ArrayLike<number>, next: ArrayLike<number>): { changes: { i: number; from: number; to: number }[]; tide: boolean } {
  const changes: { i: number; from: number; to: number }[] = [];
  for (let i = 0; i < 64; i++) if (prev[i] !== next[i]) changes.push({ i, from: prev[i], to: next[i] });
  const tide = changes.length >= 2 && changes.every((c) => c.to < c.from);
  return { changes, tide };
}

const TIER_W = [0.92, 0.84] as const;
const CASTLE_W = 0.72;
const TURRET_X = 0.33;
const TURRET_R = 0.088;
const TURRET_UP = 0.16;
/** The flag pole stands on this turret (back left, seen from Land). */
const FLAG_SPOT = new THREE.Vector3(-TURRET_X, LEVEL_H + TURRET_UP, -TURRET_X);

const COLORS = {
  sandTop: '#f4ddac', sandSide: '#e6c68c', sandFoot: '#cfac72',
  earthSide: '#b07c52', earthFoot: '#946540', grass: PALETTE.grass, grassLip: '#79b053',
  castle: '#efd39c', castleTop: '#f7e3b8', door: '#7d5531',
  puffSand: '#f5e2b8', puffEarth: '#c99a6b', grainSand: '#e3c288', grainEarth: '#9a6a44', foam: '#ffffff',
  flag: {
    land: { field: '#fbf3df', mark: '#d9a43a', pole: '#e2b45a' },
    sea: { field: '#1f7f8c', mark: '#6fe0d6', pole: '#bfeee8' },
  },
} as const;

type Kind = 'in' | 'out' | 'wash' | null;
interface Slot {
  want: boolean;
  kind: Kind;
  t0: number;
  dur: number;
  /** Particles already emitted for this animation (bit flags). */
  fx: number;
  /** Direction (radians, board xz) a dug tier tips and throws its sand. */
  dir: number;
  /** Next time to drop a grain while it is scooped. */
  grainAt: number;
}

export interface LevelsContext {
  bin: Bin;
  particles: Particles;
  reducedMotion: () => boolean;
}

export class SandLevels {
  readonly group = new THREE.Group();
  /** How far each square's top stands above the board right now, animated (index file * 8 + rank). */
  readonly tops = new Float32Array(64);
  private level = new Uint8Array(64);
  private slots: Slot[] = [];
  private wet = new Float32Array(64);
  private meadowTiers: THREE.InstancedMesh;
  private beachTiers: THREE.InstancedMesh;
  private castles: THREE.InstancedMesh;
  private meadowLook: 'turf' | 'sand' = 'turf';
  private flag: Flag;
  private time = 0;
  private dirty = true;
  private prewarm = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private col = new THREE.Color();
  private wetCol = new THREE.Color('#9c8462');

  constructor(private c: LevelsContext) {
    this.group.name = 'sand-levels';
    for (let i = 0; i < 64 * 3; i++) this.slots.push({ want: false, kind: null, t0: 0, dur: 1, fx: 0, dir: 0, grainAt: 0 });
    const speckle = makeSpeckle(c.bin);
    const mat = c.bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, map: speckle }));
    const castleMat = c.bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map: speckle }));
    const mk = (geo: THREE.BufferGeometry, material: THREE.Material, n: number, name: string) => {
      const mesh = new THREE.InstancedMesh(geo, material, n);
      mesh.name = name;
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      return mesh;
    };
    this.meadowTiers = mk(c.bin.add(tierGeometry('turf')), mat, 128, 'tiers-meadow');
    this.beachTiers = mk(c.bin.add(tierGeometry('sand')), mat, 128 + 64, 'tiers-beach');
    this.castles = mk(c.bin.add(castleGeometry()), castleMat, 64, 'castles');
    this.flag = new Flag(c.bin, c.particles, c.reducedMotion);
    this.group.add(this.flag.group);
  }

  /** Show exactly these heights (missing = 0). `{}` (all flat) restores instantly. `tide` forces the tide look. */
  set(levels: Partial<Record<Square, Level>>, opts: { tide?: boolean; instant?: boolean } = {}): void {
    const next = new Uint8Array(64);
    for (const [sq, l] of Object.entries(levels) as [Square, Level][]) next[squareIdx(sq)] = Math.max(0, Math.min(3, l | 0));
    const allFlat = next.every((l) => l === 0);
    const instant = opts.instant || allFlat;
    const { changes, tide: autoTide } = diffLevels(this.level, next);
    const tide = opts.tide ?? autoTide;
    const reduced = this.c.reducedMotion();
    const T = reduced ? LEVEL_TIMING.reduced : LEVEL_TIMING.normal;
    if (instant) {
      for (let i = 0; i < 64; i++) for (let k = 0; k < 3; k++) {
        const s = this.slots[i * 3 + k];
        s.want = k < next[i];
        s.kind = null;
      }
    }
    for (const { i, from, to } of instant ? [] : changes) {
      const rank = i % 8;
      // The tide rolls in from the Sea side: rank 8 first.
      const delay = tide ? (7 - rank) * T.tideStagger + (((i * 7) % 5) / 5) * T.tideStagger * 0.5 : 0;
      const dir = Math.random() * Math.PI * 2;
      for (let k = 0; k < 3; k++) {
        const s = this.slots[i * 3 + k];
        const want = k < to;
        if (want && !s.want) {
          // Builds stack bottom up: the second tier lands just after the first.
          const n = k - from;
          s.kind = 'in';
          s.dur = k === 2 ? T.castle : T.build;
          s.t0 = this.time + Math.max(0, n) * T.stack;
          s.fx = 0;
        } else if (!want && s.want) {
          // Digs come off top down.
          const n = from - 1 - k;
          s.kind = tide ? 'wash' : 'out';
          s.dur = tide ? T.tide : T.dig;
          s.t0 = this.time + delay + Math.max(0, n) * T.stack;
          s.fx = 0;
          s.dir = dir;
          s.grainAt = 0;
        }
        s.want = want;
      }
    }
    if (instant) this.wet.fill(0);
    this.level = next;
    this.dirty = true;
    if (allFlat) this.flag.set(null, true);
  }

  /** Current target level of a square. */
  levelOf(sq: Square): Level {
    return this.level[squareIdx(sq)] as Level;
  }

  /** Board-local y of the walkable top of a square at its (target) level. */
  topY(sq: Square): number {
    return levelTop(this.level[squareIdx(sq)]);
  }

  /** True while anything moves (tiers, flag, wet sand drying). */
  get animating(): boolean {
    return this.dirty;
  }

  setFlag(flag: { square: Square; side: Side } | null): void {
    this.flag.set(flag);
    this.dirty = true;
  }

  get flagSquare(): Square | null {
    return this.flag.current?.square ?? null;
  }

  setMeadowLook(look: 'turf' | 'sand'): void {
    this.meadowLook = look;
    this.dirty = true;
  }

  get meadowLookNow(): 'turf' | 'sand' {
    return this.meadowLook;
  }

  /** Show every mesh for one frame (shader warm-up before reveal), or go back to normal. */
  setPrewarm(on: boolean): void {
    this.prewarm = on;
    this.flag.setPrewarm(on);
    this.dirty = true;
    this.write();
  }

  update(dt: number, elapsed: number): void {
    this.time += dt;
    let wetting = false;
    for (let i = 0; i < 64; i++) {
      if (this.wet[i] > 0) {
        this.wet[i] = Math.max(0, this.wet[i] - dt * 0.35);
        wetting = true;
      }
    }
    if (wetting) this.dirty = true;
    const flagMoving = this.flag.update(dt, elapsed, (sq) => this.flagBase(sq));
    if (this.dirty || flagMoving) this.write();
  }

  dispose(): void {
    this.group.removeFromParent();
  }

  // ---------- internals ----------

  /** Where the flag pole stands on a square: the turret top when it is a castle, else the corner of its top. */
  private flagBase(sq: Square): THREE.Vector3 {
    const i = squareIdx(sq);
    const f = Math.floor(i / 8), r = i % 8;
    const castle = this.slots[i * 3 + 2];
    const onCastle = castle.want || castle.kind !== null;
    const y = BOARD_TOP + this.tops[i] + (onCastle ? TURRET_UP : 0);
    return this.v.set((f - 3.5) * SQUARE + FLAG_SPOT.x, y, (3.5 - r) * SQUARE + FLAG_SPOT.z);
  }

  private write(): void {
    const reduced = this.c.reducedMotion();
    let nm = 0, nb = 0, nc = 0, moving = false;
    for (let i = 0; i < 64; i++) {
      const f = Math.floor(i / 8), r = i % 8;
      const x = (f - 3.5) * SQUARE, z = (3.5 - r) * SQUARE;
      const meadow = r < 4 && this.meadowLook === 'turf';
      const parity = (f + r) % 2 === 1 ? 1.03 : 0.95;
      let base = 0;
      for (let k = 0; k < 3; k++) {
        const s = this.slots[i * 3 + k];
        if (!s.want && s.kind === null) continue;
        let y = base, sy = 1, sxz = 1, tilt = 0, spin = 0, contrib = 1, shown = true;
        if (s.kind) {
          moving = true;
          const p = (this.time - s.t0) / s.dur;
          if (p >= 1) {
            if (s.kind !== 'in') {
              s.kind = null;
              continue;
            }
            s.kind = null;
          } else if (s.kind === 'in') {
            if (p < 0) shown = false;
            else if (k === 2) {
              // The castle pops up out of the tier.
              // Grows with an overshoot, then a little jiggle as it settles.
              if (p < 0.6) sy = Math.max(0.02, ease.backOut(p / 0.6));
              else {
                const u = (p - 0.6) / 0.4;
                sy = 1 + 0.05 * Math.sin(u * Math.PI * 2) * (1 - u);
              }
              sxz = 0.6 + 0.4 * ease.backOut(Math.min(1, p / 0.5));
              contrib = sy;
              if (!(s.fx & 1)) {
                s.fx |= 1;
                this.puff(x, z, BOARD_TOP + base, meadow, reduced ? 4 : 14, 0.5);
              }
              if (!(s.fx & 2) && p > 0.55) {
                s.fx |= 2;
                if (!reduced) this.twinkle(x, z, BOARD_TOP + base + LEVEL_H + 0.1);
              }
            } else if (reduced) {
              sy = ease.cubicOut(p);
              contrib = sy;
              if (!(s.fx & 1)) {
                s.fx |= 1;
                this.puff(x, z, BOARD_TOP + base, meadow, 4, 0.3);
              }
            } else if (p < 0.38) {
              // Falling in, stretched a little.
              const u = p / 0.38;
              y = base + 0.36 * (1 - u * u);
              sy = 1.1;
              sxz = 0.9;
              contrib = 0;
            } else {
              // Pat: squash on landing, a little rebound, settle.
              const u = (p - 0.38) / 0.62;
              const w = Math.cos(u * Math.PI * 1.5) * (1 - u) * (1 - u);
              sy = 1 - 0.3 * w;
              sxz = 1 + 0.12 * w;
              contrib = sy;
              if (!(s.fx & 1)) {
                s.fx |= 1;
                this.puff(x, z, BOARD_TOP + base, meadow, 12, 0.55);
              }
            }
          } else if (s.kind === 'out') {
            if (p >= 0) {
              const e = ease.cubicInOut(p);
              sy = Math.max(0.001, 1 - e);
              sxz = 1 - 0.14 * p;
              contrib = sy;
              tilt = Math.sin(Math.PI * p) * (k === 2 ? 0.08 : 0.22);
              if (k === 2) spin = Math.sin(p * 22) * 0.06 * (1 - p);
              y = base + Math.sin(Math.PI * p) * 0.03;
              if (!(s.fx & 1)) {
                s.fx |= 1;
                this.scoop(x, z, BOARD_TOP + base + LEVEL_H, s.dir, meadow && k < 2, reduced ? 3 : k === 2 ? 16 : 10);
              }
              if (!reduced && p < 0.8 && this.time >= s.grainAt) {
                s.grainAt = this.time + 0.04;
                this.grain(x, z, BOARD_TOP + base + LEVEL_H * sy, meadow && k < 2);
              }
            }
          } else if (s.kind === 'wash') {
            if (p >= 0) {
              const e = ease.sineInOut(p);
              sy = Math.max(0.001, 1 - e);
              sxz = 1 + 0.1 * e;
              contrib = sy;
              this.wet[i] = 1;
              if (!(s.fx & 1)) {
                s.fx |= 1;
                this.foam(x, z, BOARD_TOP + base + LEVEL_H, reduced ? 3 : 12);
              }
            }
          }
        }
        if (!shown) continue;
        const w = k === 2 ? 1 : TIER_W[k];
        if (tilt !== 0) {
          this.axis.set(Math.sin(s.dir), 0, -Math.cos(s.dir));
          this.q.setFromAxisAngle(this.axis, tilt);
        } else this.q.identity();
        if (spin !== 0) this.q.multiply(this.q2.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spin));
        this.m.compose(this.v.set(x, BOARD_TOP + y, z), this.q, this.s.set(w * sxz, sy, w * sxz));
        const wet = this.wet[i];
        if (k === 2) {
          this.col.setRGB(1, 1, 1).lerp(this.wetCol, wet * 0.55);
          this.castles.setMatrixAt(nc, this.m);
          this.castles.setColorAt(nc++, this.col);
        } else {
          this.col.setRGB(parity, parity, parity).lerp(this.wetCol, wet * 0.55);
          const mesh = meadow ? this.meadowTiers : this.beachTiers;
          const n = meadow ? nm++ : nb++;
          mesh.setMatrixAt(n, this.m);
          mesh.setColorAt(n, this.col);
        }
        base += LEVEL_H * contrib;
      }
      this.tops[i] = base;
      if (this.wet[i] > 0) moving = true;
    }
    if (this.prewarm) {
      // One instance far under the board so every shader compiles.
      this.m.makeTranslation(0, -50, 0);
      for (const [mesh, n] of [[this.meadowTiers, nm], [this.beachTiers, nb], [this.castles, nc]] as const) {
        if (n === 0) mesh.setMatrixAt(0, this.m);
      }
      nm = Math.max(nm, 1);
      nb = Math.max(nb, 1);
      nc = Math.max(nc, 1);
    }
    for (const [mesh, n] of [[this.meadowTiers, nm], [this.beachTiers, nb], [this.castles, nc]] as const) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.dirty = moving;
  }

  // ---------- particles ----------

  private puff(x: number, z: number, y: number, earth: boolean, n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
      this.c.particles.emit({
        x: x + Math.cos(a) * 0.42, y: y + 0.03, z: z + Math.sin(a) * 0.42,
        vx: Math.cos(a) * speed * (0.7 + Math.random() * 0.6), vy: 0.25 + Math.random() * 0.35, vz: Math.sin(a) * speed * (0.7 + Math.random() * 0.6),
        life: 0.5 + Math.random() * 0.2, size: [0.12, 0.26], color: earth && k % 2 ? COLORS.puffEarth : COLORS.puffSand,
        alpha: 0.75, gravity: -0.6, drag: 3.5,
      });
    }
  }

  /** A scoop of sand thrown off toward `dir`. */
  private scoop(x: number, z: number, y: number, dir: number, earth: boolean, n: number): void {
    const dx = Math.cos(dir), dz = Math.sin(dir);
    for (let k = 0; k < n; k++) {
      const sp = 0.7 + Math.random() * 0.9;
      this.c.particles.emit({
        x: x + dx * 0.3 + (Math.random() - 0.5) * 0.3, y, z: z + dz * 0.3 + (Math.random() - 0.5) * 0.3,
        vx: dx * sp + (Math.random() - 0.5) * 0.5, vy: 1.1 + Math.random() * 1.0, vz: dz * sp + (Math.random() - 0.5) * 0.5,
        life: 0.6 + Math.random() * 0.25, size: [0.07, 0.05], color: earth && k % 3 === 0 ? COLORS.grainEarth : COLORS.grainSand,
        alpha: 0.95, gravity: -7, drag: 0.4,
      });
    }
  }

  /** One grain trickling off the edge of a tier being scooped. */
  private grain(x: number, z: number, y: number, earth: boolean): void {
    const a = Math.random() * Math.PI * 2;
    this.c.particles.emit({
      x: x + Math.cos(a) * 0.42, y, z: z + Math.sin(a) * 0.42,
      vx: Math.cos(a) * 0.25, vy: 0.2, vz: Math.sin(a) * 0.25,
      life: 0.5, size: [0.05, 0.04], color: earth ? COLORS.grainEarth : COLORS.grainSand, alpha: 0.9, gravity: -6, drag: 0.3,
    });
  }

  /** Tide wash: foam sliding in from the Sea side, a little wet sand thrown up. */
  private foam(x: number, z: number, y: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const wet = k % 3 === 0;
      this.c.particles.emit({
        x: x + (Math.random() - 0.5) * 0.9, y: y + 0.02, z: z - 0.45 + Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 0.3, vy: wet ? 0.8 + Math.random() * 0.6 : 0.15 + Math.random() * 0.2, vz: 0.9 + Math.random() * 0.6,
        life: 0.55 + Math.random() * 0.3, size: wet ? [0.07, 0.05] : [0.16, 0.3], color: wet ? COLORS.grainSand : k % 2 ? COLORS.foam : PALETTE.waterShallow,
        alpha: 0.85, gravity: wet ? -6 : -0.8, drag: wet ? 0.4 : 2.2,
      });
    }
  }

  private twinkle(x: number, z: number, y: number): void {
    for (let k = 0; k < 5; k++) {
      const a = Math.random() * Math.PI * 2;
      this.c.particles.emit({
        x: x + Math.cos(a) * 0.3, y: y + Math.random() * 0.2, z: z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * 0.15, vy: 0.5 + Math.random() * 0.3, vz: Math.sin(a) * 0.15,
        life: 0.6, size: [0.16, 0.05], color: '#fff6d6', alpha: 1, gravity: 0, drag: 2, shape: 1,
      });
    }
  }
}

// ---------- the flag ----------

class Flag {
  readonly group = new THREE.Group();
  current: { square: Square; side: Side } | null = null;
  private target: { square: Square; side: Side } | null = null;
  private phase: 'idle' | 'up' | 'down' = 'idle';
  private t = 0;
  private cloth: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private pole: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private clothRest: Float32Array;
  private tex: Record<Side, THREE.Texture>;
  private prewarm = false;
  private sparkle = false;

  constructor(bin: Bin, private particles: Particles, private reducedMotion: () => boolean) {
    this.group.name = 'castle-flag';
    this.group.visible = false;
    this.group.userData.noPick = true;
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.013, 0.016, 0.48, 8).translate(0, 0.24, 0),
      new THREE.SphereGeometry(0.03, 12, 8).translate(0, 0.49, 0),
    ])!;
    this.pole = new THREE.Mesh(bin.add(poleGeo), bin.add(new THREE.MeshStandardMaterial({ color: COLORS.flag.land.pole, roughness: 0.35, metalness: 0.4 })));
    this.pole.castShadow = true;
    const clothGeo = bin.add(new THREE.PlaneGeometry(0.28, 0.17, 12, 4).translate(0.14 + 0.012, 0.37, 0));
    this.clothRest = Float32Array.from(clothGeo.attributes.position.array as Float32Array);
    this.tex = { land: flagTexture(bin, 'land'), sea: flagTexture(bin, 'sea') };
    this.cloth = new THREE.Mesh(clothGeo, bin.add(new THREE.MeshStandardMaterial({
      map: this.tex.land, side: THREE.DoubleSide, roughness: 0.75, alphaTest: 0.5,
    })));
    this.cloth.castShadow = true;
    this.group.add(this.pole, this.cloth);
  }

  set(flag: { square: Square; side: Side } | null, instant = false): void {
    if (instant) {
      this.target = this.current = flag;
      this.phase = 'idle';
      this.group.visible = this.prewarm || !!flag;
      if (flag) this.style(flag.side);
      return;
    }
    const same = (a: typeof flag, b: typeof flag) => a?.square === b?.square && a?.side === b?.side;
    this.target = flag;
    if (same(flag, this.current) && this.phase !== 'down') return;
    if (this.current && this.phase !== 'down') {
      // Lower the old flag first; the new one rises once it is down.
      this.phase = 'down';
      this.t = 0;
    } else if (!this.current && flag) this.raise(flag);
  }

  setPrewarm(on: boolean): void {
    this.prewarm = on;
    this.group.visible = on || !!this.current;
  }

  /** Returns true while it animates. */
  update(dt: number, elapsed: number, baseAt: (sq: Square) => THREE.Vector3): boolean {
    if (!this.current) {
      this.group.visible = this.prewarm;
      return false;
    }
    const reduced = this.reducedMotion();
    this.t += dt;
    let sy = 1, sx = 1, drop = 0;
    if (this.phase === 'up') {
      const d = reduced ? 0.2 : 0.55;
      const u = clamp01(this.t / d);
      sy = reduced ? u : ease.backOut(Math.min(1, u * 1.5));
      sx = reduced ? u : ease.elasticOut(clamp01((u - 0.25) / 0.75));
      if (u >= 1) this.phase = 'idle';
    } else if (this.phase === 'down') {
      const d = reduced ? 0.15 : 0.3;
      const u = clamp01(this.t / d);
      sy = 1 - ease.cubicIn(u);
      sx = 1 - u * 0.6;
      drop = ease.cubicIn(u) * 0.1;
      if (u >= 1) {
        this.current = null;
        this.phase = 'idle';
        this.group.visible = this.prewarm;
        if (this.target) this.raise(this.target);
        return true;
      }
    }
    const p = baseAt(this.current.square);
    this.group.position.set(p.x, p.y - drop, p.z);
    this.group.scale.set(1, Math.max(0.001, sy), 1);
    this.cloth.scale.x = Math.max(0.001, sx);
    this.group.visible = true;
    if (this.sparkle) {
      this.sparkle = false;
      this.emitSparkle(this.current.side);
    }
    this.wave(elapsed, reduced);
    return this.phase !== 'idle';
  }

  private raise(flag: { square: Square; side: Side }): void {
    this.current = flag;
    this.phase = 'up';
    this.t = 0;
    this.style(flag.side);
    this.group.visible = true;
    this.sparkle = !this.reducedMotion();
  }

  /** Twinkles in the team colour round the top of the pole. */
  private emitSparkle(side: Side): void {
    const p = this.group.position;
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.emit({
        x: p.x + Math.cos(a) * 0.12, y: p.y + 0.3 + Math.random() * 0.2, z: p.z + Math.sin(a) * 0.12,
        vx: Math.cos(a) * 0.4, vy: 0.6 + Math.random() * 0.4, vz: Math.sin(a) * 0.4,
        life: 0.7, size: [0.14, 0.04], color: k % 2 ? COLORS.flag[side].mark : '#fff6d6', alpha: 1, gravity: -0.5, drag: 2, shape: 1,
      });
    }
  }

  private style(side: Side): void {
    this.cloth.material.map = this.tex[side];
    this.cloth.material.needsUpdate = true;
    this.pole.material.color.set(COLORS.flag[side].pole);
  }

  /** The cloth flaps: a travelling wave, stronger toward the fly end. */
  private wave(t: number, reduced: boolean): void {
    const pos = this.cloth.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const amp = reduced ? 0.008 : 0.024;
    for (let k = 0; k < pos.count; k++) {
      const x = this.clothRest[k * 3], y = this.clothRest[k * 3 + 1];
      const w = (x - 0.012) / 0.28;
      arr[k * 3 + 2] = Math.sin(x * 20 - t * 6.5 + y * 6) * amp * w;
      arr[k * 3 + 1] = y - w * w * 0.012;
    }
    pos.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
  }
}

// ---------- geometry and textures ----------

function paint(geo: THREE.BufferGeometry, color: (y: number, ny: number, x: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = color(p.getY(i), n.getY(i), p.getX(i), p.getZ(i));
    // A little hand-made unevenness.
    const h = Math.sin(i * 91.7 + p.getX(i) * 13.1) * 43758.5453;
    const j = 1 + ((h - Math.floor(h)) - 0.5) * 0.05;
    out.set([c.r * j, c.g * j, c.b * j], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

/** One tier, 1 wide (scaled per instance), its bottom at y = 0. */
function tierGeometry(look: 'turf' | 'sand'): THREE.BufferGeometry {
  const geo = new RoundedBoxGeometry(1, LEVEL_H, 1, 3, 0.055).translate(0, LEVEL_H / 2, 0);
  const top = new THREE.Color(look === 'turf' ? COLORS.grass : COLORS.sandTop);
  const lip = new THREE.Color(look === 'turf' ? COLORS.grassLip : COLORS.sandTop);
  const side = new THREE.Color(look === 'turf' ? COLORS.earthSide : COLORS.sandSide);
  const foot = new THREE.Color(look === 'turf' ? COLORS.earthFoot : COLORS.sandFoot);
  const tmp = new THREE.Color();
  return paint(geo, (y, ny) => {
    if (ny > 0.75) return tmp.copy(top);
    if (ny > 0.2 || y > LEVEL_H - 0.03) return tmp.copy(lip);
    return tmp.copy(foot).lerp(side, clamp01(y / (LEVEL_H * 0.7)));
  });
}

/** The level-3 sandcastle, its bottom at y = 0, sitting on tier 2. */
function castleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sand = new THREE.Color(COLORS.castle), top = new THREE.Color(COLORS.castleTop), door = new THREE.Color(COLORS.door);
  const tmp = new THREE.Color();
  const shade = (g: THREE.BufferGeometry, base: THREE.Color) =>
    parts.push(paint(g, (_y, ny) => (ny > 0.75 ? tmp.copy(top) : tmp.copy(base))));
  // Keep.
  shade(new RoundedBoxGeometry(CASTLE_W, LEVEL_H, CASTLE_W, 2, 0.035).translate(0, LEVEL_H / 2, 0), sand);
  // Turrets: slightly tapered, like a bucket mould, with four crenels each.
  const th = LEVEL_H + TURRET_UP;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tx = sx * TURRET_X, tz = sz * TURRET_X;
    shade(new THREE.CylinderGeometry(TURRET_R, TURRET_R * 1.15, th, 14).translate(tx, th / 2, tz), sand);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      shade(new THREE.BoxGeometry(0.05, 0.05, 0.05).rotateY(-a).translate(tx + Math.cos(a) * 0.062, th + 0.025, tz + Math.sin(a) * 0.062), sand);
    }
  }
  // Wall crenels between the turrets, two per side.
  const e = CASTLE_W / 2 - 0.03;
  for (const s of [-0.11, 0.11]) {
    shade(new THREE.BoxGeometry(0.08, 0.06, 0.06).translate(s, LEVEL_H + 0.03, e), sand);
    shade(new THREE.BoxGeometry(0.08, 0.06, 0.06).translate(s, LEVEL_H + 0.03, -e), sand);
    shade(new THREE.BoxGeometry(0.06, 0.06, 0.08).translate(e, LEVEL_H + 0.03, s), sand);
    shade(new THREE.BoxGeometry(0.06, 0.06, 0.08).translate(-e, LEVEL_H + 0.03, s), sand);
  }
  // A door facing each side (Land +z, Sea -z): a dark arch.
  for (const sz of [-1, 1]) {
    const z = sz * (CASTLE_W / 2 + 0.004);
    parts.push(paint(new THREE.BoxGeometry(0.13, 0.13, 0.016).translate(0, 0.065, z), () => tmp.copy(door)));
    parts.push(paint(new THREE.CylinderGeometry(0.065, 0.065, 0.016, 14).rotateX(Math.PI / 2).translate(0, 0.13, z), () => tmp.copy(door)));
  }
  // The flag spot: a little hole on the back-left turret.
  parts.push(paint(new THREE.CylinderGeometry(0.028, 0.028, 0.006, 10).translate(FLAG_SPOT.x, th + 0.002, FLAG_SPOT.z), () => tmp.copy(door)));
  // RoundedBoxGeometry has no index; the rest do. Merge them all unindexed.
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat)!;
  for (const g of new Set([...parts, ...flat])) g.dispose();
  return merged;
}

/** Near-white speckles: multiplied over the vertex colours, it reads as grains of sand. */
function makeSpeckle(bin: Bin): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f6f6';
  g.fillRect(0, 0, s, s);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 900; k++) {
    const v = 200 + Math.floor(rnd() * 55);
    g.fillStyle = rnd() < 0.15 ? '#ffffff' : `rgb(${v},${v - 6},${v - 18})`;
    g.fillRect(Math.floor(rnd() * s), Math.floor(rnd() * s), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
  }
  const t = bin.add(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

/** A swallowtail pennant: Land cream with a gold band and sun, Sea teal with an aqua wave. */
function flagTexture(bin: Bin, side: Side): THREE.Texture {
  const w = 128, h = 80;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const col = COLORS.flag[side];
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, 0);
  g.lineTo(w * 0.8, h / 2);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fillStyle = col.field;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = col.mark;
  if (side === 'land') {
    g.fillRect(0, h * 0.4, w, h * 0.2);
    g.beginPath();
    g.arc(w * 0.3, h / 2, h * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = col.field;
    g.beginPath();
    g.arc(w * 0.3, h / 2, h * 0.12, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(0, h * 0.55);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.5 + Math.sin(x / 9) * h * 0.09);
    g.lineTo(w, h * 0.72);
    for (let x = w; x >= 0; x -= 4) g.lineTo(x, h * 0.68 + Math.sin(x / 9) * h * 0.09);
    g.closePath();
    g.fill();
  }
  g.restore();
  const t = bin.add(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

