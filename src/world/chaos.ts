/**
 * Wheel of Chaos spectacles (Phase 3): tide, pigeon, earthquake, disco. Each runs on world time,
 * is about 1.2-2s, resolves when the board-level effect is over, and can be skipped (`skip()` jumps
 * every running one to its end). Reduced motion makes each one shorter and gentler, with no shake.
 */
import * as THREE from 'three';
import type { Side, Square, WheelOutcome } from '../contracts/types';
import { type Animator, type Handle, clamp01, ease, lerp } from './anim';
import type { Board } from './board';
import type { CameraRig } from './camera';
import { BOARD_TOP, FRAME_W, PALETTE, SQUARE } from './constants';
import { squareToXZ, xzToSquare } from './coords';
import type { Diorama } from './diorama';
import type { Bin, Materials } from './kit';
import type { Textures } from './textures';
import { Pigeon, type WeirdEffects } from './weird';

/**
 * Tide timing in seconds. The crest is the moment the wave front reaches the middle line at full height;
 * slide the swept pieces from there (see REPORT.md). Integration can read these.
 */
export const TIDE_TIMING = {
  normal: { duration: 1.8, crest: 0.72 },
  reduced: { duration: 1.4, crest: 0.56 },
} as const;

export interface ChaosContext {
  board: Board;
  diorama: Diorama;
  rig: CameraRig;
  animator: Animator;
  bin: Bin;
  mats: Materials;
  tex: Textures;
  weird: WeirdEffects;
  reducedMotion: () => boolean;
  quality: () => 'high' | 'low';
  /** Pixels per world unit at distance 1 (drawing-buffer height / (2 tan(fov/2))), for particle sizes. */
  pxScale: () => number;
}

export interface ChaosOptions {
  squares?: Square[];
  carry?: THREE.Object3D;
  direction?: 'left' | 'right';
  /** Phase 4 Raid: the pigeon snatches this treasure at `from` and drops it at `to`. */
  treasure?: { owner: Side; from: Square; to: Square };
}

/** What the pigeon needs from the Raid treasures (Phase 4). */
export interface TreasureHooks {
  isLyingAt(side: Side, sq: Square): boolean;
  grabForPigeon(side: Side): THREE.Object3D;
  dropFromPigeon(side: Side, to: Square): void;
}

/** Board-local z of the Sea edge the tide starts from (just past the frame) and of the middle line. */
const SEA_Z = -(4 * SQUARE + FRAME_W + 0.3);

export class ChaosEffects {
  private running = new Map<WheelOutcome, Handle[]>();
  private prewarm: THREE.Object3D[] = [];
  private particles: Particles;
  private wave: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private cracks: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private pigeon: Pigeon;
  /** Phase 4: set by the world once the treasures exist. */
  treasures: TreasureHooks | null = null;

  constructor(private c: ChaosContext) {
    this.particles = new Particles(c.bin, c.tex, c.pxScale);
    c.board.overlay.add(this.particles.points);
    this.prewarm.push(this.particles.points);
    this.wave = this.buildWave();
    const crackGeo = c.bin.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(crackGeo, c.bin.add(new THREE.MeshBasicMaterial({
        map: c.tex.crack, transparent: true, depthWrite: false, opacity: 0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      })));
      m.name = 'quake-crack';
      m.renderOrder = 2;
      m.visible = false;
      c.board.overlay.add(m);
      this.cracks.push(m);
      this.prewarm.push(m);
    }
    this.pigeon = new Pigeon(c.bin, c.mats);
    this.pigeon.group.visible = false;
    c.board.group.add(this.pigeon.group);
    this.prewarm.push(this.pigeon.group);
  }

  /** Show every effect object (for shader compile before the first reveal) or hide them again. */
  setPrewarm(on: boolean): void {
    for (const o of this.prewarm) o.visible = on;
  }

  update(dt: number): void {
    this.particles.update(dt);
  }

  play(outcome: WheelOutcome, opts: ChaosOptions = {}): Promise<void> {
    for (const h of this.running.get(outcome) ?? []) h.cancel(true);
    let handles: Handle[];
    switch (outcome) {
      case 'tide': handles = [this.tide()]; break;
      case 'pigeon': handles = [opts.treasure ? this.pigeonSnatch(opts.treasure) : this.pigeonSteal(opts)]; break;
      case 'earthquake': handles = [this.quake(opts.direction ?? 'left')]; break;
      case 'disco': handles = [this.c.weird.discoFlash(), this.discoSparkles()]; break;
      default: return Promise.resolve();
    }
    this.running.set(outcome, handles);
    return Promise.all(handles.map((h) => h.done)).then(() => {
      if (this.running.get(outcome) === handles) this.running.delete(outcome);
    });
  }

  /** Jump every running spectacle to its end (any click skips). */
  skip(): void {
    for (const hs of this.running.values()) for (const h of hs) h.cancel(true);
    this.running.clear();
    this.particles.clear();
  }

  get busy(): boolean {
    return this.running.size > 0;
  }

  // ---------- tide: a real wave rolls in over the beach ranks, then drains back ----------
  private buildWave(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const w = 8 * SQUARE + FRAME_W * 2 + 0.2;
    const near = 0.7; // reaches a little past the middle line
    const depth = near - SEA_Z;
    const geo = this.c.bin.add(new THREE.PlaneGeometry(w, depth, 72, 56));
    geo.rotateX(-Math.PI / 2).translate(0, 0, SEA_Z + depth / 2);
    const mat = this.c.bin.add(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        t: { value: 0 }, front: { value: -0.2 }, crest: { value: 0 }, reach: { value: 0 }, wet: { value: 0 }, alpha: { value: 0 },
        deep: { value: new THREE.Color(PALETTE.waterDeep) },
        shallow: { value: new THREE.Color(PALETTE.waterShallow) },
      },
      vertexShader: /* glsl */ `
        uniform float t; uniform float front; uniform float crest;
        varying float vD; varying float vBehind; varying float vH; varying vec2 vXZ;
        void main() {
          vec3 p = position;
          float d = (p.z - ${SEA_Z.toFixed(3)}) / ${(-SEA_Z).toFixed(3)}; // 0 = sea edge, 1 = middle line
          float edge = front + 0.03 * sin(p.x * 3.1 + t * 2.0) + 0.02 * sin(p.x * 7.3 - t * 3.0);
          float behind = edge - d;
          // The crest: a rounded roll just behind the front, leaning forward.
          float x = (behind - 0.07) / 0.075;
          float bump = crest * exp(-x * x) * (1.0 + 0.15 * sin(p.x * 2.0 + t * 3.0));
          float sheet = 0.03 * smoothstep(0.0, 0.08, behind);
          float ripple = (sin(p.x * 2.3 + t * 2.4) * 0.012 + sin(d * 30.0 - t * 5.0) * 0.01) * step(0.0, behind);
          p.y += max(bump, 0.0) + sheet + ripple;
          p.z += bump * 0.35; // lean the roll toward the shore
          vD = d; vBehind = behind; vH = bump; vXZ = p.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float t; uniform float crest; uniform float reach; uniform float wet; uniform float alpha;
        uniform vec3 deep; uniform vec3 shallow;
        varying float vD; varying float vBehind; varying float vH; varying vec2 vXZ;
        void main() {
          if (vBehind < 0.0) {
            // Where the water has been but drained away: a glossy wet sheen that dries off.
            if (vD > reach || wet <= 0.0) discard;
            float streak = 0.55 + 0.45 * sin(vXZ.x * 4.0 + vD * 26.0 + t * 1.5);
            gl_FragColor = vec4(mix(shallow, vec3(1.0), 0.55), wet * 0.3 * streak);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }
          vec3 c = mix(shallow, deep, smoothstep(0.0, 0.7, vBehind) * 0.75);
          float foamEdge = smoothstep(0.07, 0.0, vBehind);
          float foamTop = crest > 0.001 ? smoothstep(0.55, 0.95, vH / crest) : 0.0;
          float bubbles = smoothstep(0.82, 1.0, sin(vXZ.x * 19.0 + t * 2.0) * sin(vXZ.y * 23.0 - t * 3.0)) * smoothstep(0.35, 0.05, vBehind);
          float foam = clamp(max(max(foamEdge, foamTop), bubbles), 0.0, 1.0);
          c = mix(c, vec3(1.0), foam);
          c += vH * 0.6;
          gl_FragColor = vec4(c, alpha * mix(0.62, 0.95, foam));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = BOARD_TOP + 0.012;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.name = 'chaos-tide';
    this.c.board.overlay.add(mesh);
    this.prewarm.push(mesh);
    return mesh;
  }

  private tide(): Handle {
    const reduced = this.c.reducedMotion();
    const { duration: D, crest: C } = reduced ? TIDE_TIMING.reduced : TIDE_TIMING.normal;
    const height = reduced ? 0.12 : 0.34;
    const recedeAt = C + (D - C) * 0.28; // short hold at full reach, then drain back
    const u = this.wave.material.uniforms;
    const water = this.c.diorama.water;
    const baseY = water.position.y;
    const sq = this.c.board.squares;
    const base = this.c.board.baseColors;
    const wetCol = new THREE.Color();
    let t = 0, sprayed = false, frothT = 0;
    this.wave.visible = true;
    u.reach.value = 0;

    const setWet = (k: number) => {
      // Beach squares (ranks 5-8) look darker and wetter while the water is on them.
      for (let f = 0; f < 8; f++) for (let r = 4; r < 8; r++) {
        const i = f * 8 + r;
        sq.setColorAt(i, wetCol.copy(base[i]).multiplyScalar(1 - 0.18 * k));
      }
      sq.instanceColor!.needsUpdate = true;
    };
    const restore = () => {
      this.wave.visible = false;
      u.front.value = -0.2;
      u.crest.value = 0;
      u.wet.value = 0;
      u.alpha.value = 0;
      water.position.y = baseY;
      water.material.uniforms.surge.value = 0;
      setWet(0);
    };

    return this.c.animator.process((dt, el) => {
      t += dt;
      u.t.value = el;
      let front: number;
      if (t < C) front = lerp(-0.12, 1.08, 1 - (1 - t / C) ** 2);
      else if (t < recedeAt) front = 1.08 + Math.sin((t - C) * 9) * 0.012;
      else front = lerp(1.08, -0.15, ease.sineInOut(clamp01((t - recedeAt) / (D - recedeAt))));
      u.front.value = front;
      u.reach.value = Math.max(u.reach.value, front + 0.05);
      // The roll builds as it travels, peaks at the crest moment, then flattens into a sheet.
      const crestK = t < C ? ease.cubicOut(clamp01(t / (C * 0.7))) : 1 - ease.cubicOut(clamp01((t - C) / ((recedeAt - C) * 1.6)));
      u.crest.value = height * crestK;
      u.alpha.value = clamp01(t / 0.12) * (1 - clamp01((t - (D - 0.18)) / 0.18));
      u.wet.value = t < recedeAt ? 1 : 1 - clamp01((t - recedeAt) / (D - recedeAt));
      setWet(t < recedeAt ? clamp01(t / C) : u.wet.value);

      const k = Math.sin(Math.PI * clamp01(t / D));
      water.position.y = baseY + 0.07 * k;
      water.material.uniforms.surge.value = 0.06 * k;

      // Spray off the roll while it travels, and a big splash at the crest.
      const z = SEA_Z + front * -SEA_Z;
      if (!reduced && t < C && (frothT -= dt) <= 0) {
        frothT = 0.05;
        for (let i = 0; i < 4; i++) {
          this.particles.emit({
            x: (Math.random() - 0.5) * 8.4, y: BOARD_TOP + height * crestK * 0.9, z,
            vx: (Math.random() - 0.5) * 0.4, vy: 0.8 + Math.random() * 0.8, vz: 0.6 + Math.random() * 0.6,
            life: 0.45, size: [0.22, 0.1], color: '#ffffff', alpha: 0.9, gravity: -5,
          });
        }
      }
      if (!sprayed && t >= C) {
        sprayed = true;
        const n = reduced ? 10 : 46;
        for (let i = 0; i < n; i++) {
          this.particles.emit({
            x: (Math.random() - 0.5) * 8.2, y: BOARD_TOP + height * 0.8, z: z - 0.1,
            vx: (Math.random() - 0.5) * 0.8, vy: 1.4 + Math.random() * 1.6, vz: 0.4 + Math.random() * 0.8,
            life: 0.55 + Math.random() * 0.3, size: [0.3, 0.12], color: Math.random() < 0.7 ? '#ffffff' : PALETTE.waterShallow, alpha: 0.95, gravity: -7,
          });
        }
      }
      const done = t >= D;
      if (done) restore();
      return done;
    }, restore);
  }

  // ---------- pigeon: grabs a piece and flies off with it ----------
  private pigeonSteal(opts: ChaosOptions): Handle {
    const board = this.c.board;
    const cargo = opts.carry ?? null;
    let sq: Square | null = opts.squares?.[0] ?? null;
    if (!sq && cargo?.parent) {
      const p = board.pieceLayer.worldToLocal(cargo.getWorldPosition(new THREE.Vector3()));
      sq = xzToSquare(p.x, p.z);
    }
    const centre = squareToXZ(sq ?? 'e4');
    let top = BOARD_TOP + 0.6;
    if (cargo?.parent) {
      board.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(cargo, true);
      if (!box.isEmpty()) top = board.group.worldToLocal(new THREE.Vector3(0, box.max.y, 0)).y - 0.04;
    }
    const land = cargo || sq ? new THREE.Vector3(centre.x, top, centre.z) : new THREE.Vector3(0, BOARD_TOP + 2.2, 0);
    const dir = centre.x > 0 ? -1 : 1; // come in from the far side of the board
    const from = new THREE.Vector3(land.x + dir * 9, land.y + 4.5, land.z - 5);
    const to = new THREE.Vector3(land.x - dir * 12, land.y + 11, land.z - 9);
    // If the piece isn't on the board any more, there's nothing to grab: just fly past.
    return this.pigeon.carry(this.c.animator, from, land, to, cargo?.parent ? cargo : null, this.c.reducedMotion());
  }

  /** Phase 4 Raid: the pigeon takes a treasure in its beak and drops it on another square. */
  private pigeonSnatch(t: NonNullable<ChaosOptions['treasure']>): Handle {
    const tr = this.treasures;
    const a = squareToXZ(t.from), b = squareToXZ(t.to);
    const perch = tr?.isLyingAt(t.owner, t.from) ?? false;
    // On the ground it lands to peck it up; out of a carrier's mouth it hovers above the animal's head.
    const grabAt = new THREE.Vector3(a.x, BOARD_TOP + (perch ? 0 : 0.9), a.z);
    const dropAt = new THREE.Vector3(b.x, BOARD_TOP + 0.9, b.z);
    const dir = a.x > 0 ? -1 : 1;
    const from = new THREE.Vector3(grabAt.x + dir * 9, grabAt.y + 4.5, grabAt.z - 5);
    const to = new THREE.Vector3(dropAt.x - dir * 12, dropAt.y + 10, dropAt.z - 9);
    return this.pigeon.snatch(this.c.animator, from, grabAt, dropAt, to, perch, {
      grab: () => tr?.grabForPigeon(t.owner) ?? null,
      drop: () => tr?.dropFromPigeon(t.owner, t.to),
    }, this.c.reducedMotion());
  }

  // ---------- earthquake: rumble, dust and cracks ----------
  private quake(direction: 'left' | 'right'): Handle {
    const reduced = this.c.reducedMotion();
    const D = reduced ? 1.0 : 1.6;
    const g = this.c.board.group;
    const sign = direction === 'left' ? -1 : 1; // left = toward the a-file (-x)
    const amp = reduced ? 0.01 : 0.045;
    const tilt = reduced ? 0.01 : 0.035;
    // Cracks on three different squares, spread across the board.
    const used = new Set<number>();
    const crackAt: { x: number; z: number; rot: number; delay: number; size: number }[] = [];
    for (const c of this.cracks) {
      let f = 0, r = 0;
      do {
        f = Math.floor(Math.random() * 8);
        r = Math.floor(Math.random() * 8);
      } while (used.has(f) && used.size < 8);
      used.add(f);
      crackAt.push({ x: (f - 3.5) * SQUARE + (Math.random() - 0.5) * 0.4, z: (3.5 - r) * SQUARE + (Math.random() - 0.5) * 0.4, rot: Math.random() * 6.28, delay: 0.08 + crackAt.length * 0.12, size: 1.7 + Math.random() * 0.5 });
      c.visible = true;
      c.material.opacity = 0;
    }
    if (!reduced) {
      this.c.rig.shake(0.7);
    }
    let t = 0, second = false, dustT = 0;
    const restore = () => {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
      for (const c of this.cracks) {
        c.visible = false;
        c.material.opacity = 0;
      }
    };
    return this.c.animator.process((dt) => {
      t += dt;
      const u = clamp01(t / D);
      const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.4);
      g.position.x = amp * env * (Math.sin(t * 57) + 0.5 * Math.sin(t * 91 + 1));
      g.position.z = amp * 0.6 * env * Math.sin(t * 43 + 2);
      g.position.y = Math.abs(Math.sin(t * 38)) * amp * 0.5 * env;
      // The board leans the way the pieces will slide.
      g.rotation.z = -sign * tilt * Math.sin(Math.PI * clamp01(u * 1.3));
      if (!second && t > D * 0.4) {
        second = true;
        if (!reduced) this.c.rig.shake(0.4);
      }
      if ((dustT -= dt) <= 0 && t < D * 0.65) {
        dustT = reduced ? 0.12 : 0.04;
        const edge = Math.random() < 0.5;
        const x = edge ? (Math.random() < 0.5 ? -1 : 1) * (4 + FRAME_W * 0.5) : (Math.random() - 0.5) * 8;
        const z = edge ? (Math.random() - 0.5) * 8 : (Math.floor(Math.random() * 8) - 3.5) * SQUARE + 0.3;
        this.particles.emit({
          x, y: BOARD_TOP + 0.15, z,
          vx: sign * (0.3 + Math.random() * 0.5), vy: 0.35 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.3,
          life: 0.9 + Math.random() * 0.4, size: [0.6, 1.6], color: Math.random() < 0.5 ? '#a8845a' : '#8f6d48', alpha: 0.95, gravity: 0, drag: 1.5, shape: 0,
        });
      }
      this.cracks.forEach((c, i) => {
        const a = crackAt[i];
        const k = clamp01((t - a.delay) / 0.18);
        const fade = 1 - clamp01((t - D * 0.62) / (D * 0.38));
        c.position.set(a.x, BOARD_TOP + 0.004, a.z);
        c.rotation.y = a.rot;
        c.scale.setScalar(a.size * (0.35 + 0.65 * ease.backOut(k)));
        c.material.opacity = 0.9 * k * fade;
      });
      const done = t >= D;
      if (done) restore();
      return done;
    }, restore);
  }

  // ---------- disco: sparkle bursts over the whole board (the lights come from WeirdEffects.discoFlash) ----------
  private discoSparkles(): Handle {
    const reduced = this.c.reducedMotion();
    const bursts = reduced ? [0.2] : [0.12, 0.5, 0.9];
    const per = reduced ? 36 : this.c.quality() === 'high' ? 60 : 40;
    let t = 0, next = 0;
    const col = new THREE.Color();
    return this.c.animator.process((dt) => {
      t += dt;
      while (next < bursts.length && t >= bursts[next]) {
        const cx = (Math.random() - 0.5) * 5, cz = (Math.random() - 0.5) * 5;
        for (let i = 0; i < per; i++) {
          const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.6;
          col.setHSL(Math.random(), 1, 0.65);
          this.particles.emit({
            x: cx, y: BOARD_TOP + 1.6 + Math.random() * 0.6, z: cz,
            vx: Math.cos(a) * s, vy: 0.8 + Math.random() * 1.6, vz: Math.sin(a) * s,
            life: 0.7 + Math.random() * 0.5, size: [0.5, 0.22], color: col.getHex(), alpha: 1, gravity: -2.5, drag: 1.2, shape: 1,
          });
        }
        next++;
      }
      return t >= 1.5;
    });
  }

  dispose(): void {
    this.skip();
  }
}

// ---------- one shared particle system: spray, dust and sparkles in one draw call ----------

export interface Emit {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  /** Start and end size in world units. */
  size: [number, number];
  color: THREE.ColorRepresentation;
  alpha: number;
  gravity?: number;
  drag?: number;
  /** 0 = soft round puff, 1 = four-point twinkle. Default 0. */
  shape?: number;
  /** Phase 4: a particle falling below this height dies (a droplet back in the water). Default: it rests on the board. */
  floor?: number;
}

export class Particles {
  readonly points: THREE.Points;
  private n = 512;
  private pos: Float32Array;
  private vel = new Float32Array(this.n * 3);
  private life = new Float32Array(this.n);
  private maxLife = new Float32Array(this.n);
  private s0 = new Float32Array(this.n);
  private s1 = new Float32Array(this.n);
  private a0 = new Float32Array(this.n);
  private grav = new Float32Array(this.n);
  private drag = new Float32Array(this.n);
  private floorY = new Float32Array(this.n).fill(NaN);
  private attrs: { pos: THREE.BufferAttribute; col: THREE.BufferAttribute; size: THREE.BufferAttribute; alpha: THREE.BufferAttribute; shape: THREE.BufferAttribute };
  private cursor = 0;
  private alive = 0;
  private tmp = new THREE.Color();

  constructor(bin: Bin, tex: Textures, private pxScale: () => number) {
    const geo = bin.add(new THREE.BufferGeometry());
    this.pos = new Float32Array(this.n * 3);
    const mk = (arr: Float32Array, size: number) => {
      const a = new THREE.BufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attrs = {
      pos: mk(this.pos, 3), col: mk(new Float32Array(this.n * 3), 3), size: mk(new Float32Array(this.n), 1),
      alpha: mk(new Float32Array(this.n), 1), shape: mk(new Float32Array(this.n), 1),
    };
    geo.setAttribute('position', this.attrs.pos);
    geo.setAttribute('color', this.attrs.col);
    geo.setAttribute('aSize', this.attrs.size);
    geo.setAttribute('aAlpha', this.attrs.alpha);
    geo.setAttribute('aShape', this.attrs.shape);
    const mat = bin.add(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: tex.softDisc }, pxScale: { value: 800 } },
      vertexShader: /* glsl */ `
        uniform float pxScale; attribute float aSize; attribute float aAlpha; attribute float aShape; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; varying float vShape;
        void main() {
          vColor = color; vAlpha = aAlpha; vShape = aShape;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.0 ? aSize * pxScale / max(-mv.z, 0.1) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec3 vColor; varying float vAlpha; varying float vShape;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float a;
          if (vShape > 0.5) {
            vec2 q = abs(p);
            a = max(0.0, 1.0 - (q.x * q.y * 14.0 + (q.x + q.y) * 0.7)) + max(0.0, 1.0 - length(p) * 2.2);
          } else {
            a = texture2D(map, gl_PointCoord).a;
          }
          a *= vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, min(a, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'chaos-particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    this.points.userData.noPick = true;
  }

  emit(e: Emit): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    if (this.life[i] <= 0) this.alive++;
    this.pos.set([e.x, e.y, e.z], i * 3);
    this.vel.set([e.vx, e.vy, e.vz], i * 3);
    this.life[i] = this.maxLife[i] = e.life;
    this.s0[i] = e.size[0];
    this.s1[i] = e.size[1];
    this.a0[i] = e.alpha;
    this.grav[i] = e.gravity ?? -4;
    this.drag[i] = e.drag ?? 0.5;
    this.floorY[i] = e.floor ?? NaN;
    this.tmp.set(e.color);
    (this.attrs.col.array as Float32Array).set([this.tmp.r, this.tmp.g, this.tmp.b], i * 3);
    (this.attrs.shape.array as Float32Array)[i] = e.shape ?? 0;
    this.attrs.col.needsUpdate = this.attrs.shape.needsUpdate = true;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (this.alive === 0) {
      this.points.visible = false;
      return;
    }
    (this.points.material as THREE.ShaderMaterial).uniforms.pxScale.value = this.pxScale();
    const size = this.attrs.size.array as Float32Array;
    const alpha = this.attrs.alpha.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        alpha[i] = 0;
        this.alive--;
        continue;
      }
      const k = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      const y = this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt;
      const floor = this.floorY[i];
      if (floor === floor && y < floor && this.vel[i * 3 + 1] < 0) {
        this.life[i] = 0;
        alpha[i] = 0;
        this.alive--;
        continue;
      }
      this.pos[i * 3 + 1] = floor === floor ? y : Math.max(BOARD_TOP + 0.02, y);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      size[i] = lerp(this.s0[i], this.s1[i], k);
      alpha[i] = this.a0[i] * Math.min(1, k * 8) * (1 - k * k);
    }
    this.attrs.pos.needsUpdate = this.attrs.size.needsUpdate = this.attrs.alpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    (this.attrs.alpha.array as Float32Array).fill(0);
    this.attrs.alpha.needsUpdate = true;
    this.alive = 0;
  }
}
