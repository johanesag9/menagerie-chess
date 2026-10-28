/**
 * Sumo's sinking island (Phase 4).
 * - Sunk squares: the tile drops a little and the water rises over it, with foam where it meets dry tiles
 *   and the frame, so it reads as "sea now" from either side.
 * - Warn squares: the tile wobbles gently, its edge goes dark and wet, and water creeps into the gaps around it.
 * - A whole ring sinking at once: a wave rolls in from the Sea side and wraps round to Land, and the tiles
 *   drop one after another as it passes (about 1.2s). `sinkDropTimes` tells integration when each tile drops.
 * Draw calls: the water is one mesh over the whole board, the wet edges one instanced mesh; the tiles are the
 * board's own instanced squares (only their matrices change). Nothing here catches clicks (`noPick`).
 */
import * as THREE from 'three';
import type { Square } from '../contracts/types';
import { clamp01, ease } from './anim';
import type { Board } from './board';
import type { Particles } from './chaos';
import { BOARD_TOP, PALETTE, SQUARE, TILE_H } from './constants';
import { squareIndex, squareToXZ } from './coords';
import type { Bin } from './kit';

/**
 * Ring-sink timing in seconds, from the `setSunk` call. Each tile drops at its own time (see `sinkDropTimes`):
 * Sea-side tiles first, Land-side last. `drop` is how long one tile's drop takes; the effect ends at `duration`.
 */
export const SINK_TIMING = {
  normal: { duration: 1.2, travel: 0.8, drop: 0.4, rise: 0.3 },
  reduced: { duration: 0.8, travel: 0.45, drop: 0.3, rise: 0.3 },
} as const;

/** How many squares must sink in one call for the wave to play (a ring); fewer just drop quietly. */
export const WAVE_MIN_SQUARES = 4;
/**
 * Phase 6: this many squares or more joining (or leaving) the sunk list in one call, and not one ring, is a new game
 * or a restore (Stepping Stones' start sinks ranks 3-6): it happens instantly, with no drama.
 * Fewer (a Stomp sinks up to 8) drop one after another.
 */
export const INSTANT_MIN_SQUARES = 9;
/** Phase 6 (Stepping Stones): a square leaving the sunk list rises out of the water as a stone. Seconds. */
export const RISE_TIMING = { normal: 0.6, reduced: 0.3 } as const;

/** Phase 6: true when these squares sinking at once play the ring wave (Sumo): enough of them, all in one ring. */
export function isRingSink(squares: readonly Square[]): boolean {
  if (squares.length < WAVE_MIN_SQUARES) return false;
  const k = ringOf(squares[0]);
  return squares.every((sq) => ringOf(sq) === k);
}

/** Phase 6: how a `setSunk` call plays a set of squares joining or leaving the sunk list. */
export function sinkStyle(changed: readonly Square[]): 'none' | 'wave' | 'instant' | 'each' {
  if (!changed.length) return 'none';
  if (isRingSink(changed)) return 'wave';
  return changed.length >= INSTANT_MIN_SQUARES ? 'instant' : 'each';
}
/** How much later (in squares of travel) the wave reaches the Land side than the Sea side. */
const SKEW = 0.9;
const FRONT_START = -0.25;
/** The crest peaks a little behind the wave front; tiles drop as the peak passes. */
const CREST_LAG = 0.14;

/** Water surface when hidden (under the board bed) and when a square is fully sunk (just under dry tile tops). */
const Y_LOW = 0.29;
const Y_HIGH = BOARD_TOP - 0.008;
/** Warned squares fill the gaps around the tile to this fraction of a full sink. */
const WARN_LEVEL = 0.72;
/** How far the water spills over the frame rim when an edge square sinks. */
const MARGIN = 0.22;
const RIM_Y = BOARD_TOP - 0.05;
/** How far a sunk tile drops. Small, so it stays visible under the water. */
const DROP = 0.042;

/** 0 = the outer ring, 3 = the middle 2x2. */
export function ringOf(sq: Square): number {
  const { file, rank } = squareIndex(sq);
  return Math.min(file, 7 - file, rank, 7 - rank);
}

/** 0 on the Sea side of the board, 1 on the Land side (by angle round the centre). */
function sweepOf(sq: Square): number {
  const { x, z } = squareToXZ(sq);
  return Math.abs(Math.atan2(x, -z)) / Math.PI;
}

function waveFor(squares: readonly Square[], reduced: boolean) {
  const T = reduced ? SINK_TIMING.reduced : SINK_TIMING.normal;
  const inner = Math.max(...squares.map(ringOf)) + 1;
  const end = inner + SKEW + 0.25;
  return { T, inner, speed: (end - FRONT_START) / T.travel };
}

/**
 * When each square's tile drops, in seconds after `setSunk`. For a ring (WAVE_MIN_SQUARES or more) the wave
 * reaches the Sea side first and wraps round to Land; for a few squares they drop almost at once.
 * Integration: start an animal's fall on a sinking square at its time here.
 */
export function sinkDropTimes(squares: readonly Square[], reduced = false): Map<Square, number> {
  const out = new Map<Square, number>();
  if (!squares.length) return out;
  const style = sinkStyle(squares);
  if (style === 'instant') {
    for (const sq of squares) out.set(sq, 0);
    return out;
  }
  if (style === 'each') {
    squares.forEach((sq, i) => out.set(sq, 0.05 + i * 0.08));
    return out;
  }
  const { speed } = waveFor(squares, reduced);
  for (const sq of squares) {
    const d = ringOf(sq) + 0.5 + SKEW * sweepOf(sq);
    out.set(sq, (d - FRONT_START + CREST_LAG) / speed);
  }
  return out;
}

const WATER_VERT = /* glsl */ `
  uniform sampler2D levels; uniform float t; uniform float front; uniform float crest; uniform float inner;
  varying vec2 vG; varying float vL; varying float vBump;
  float cellL(vec2 c) { vec4 s = texture2D(levels, (c + 1.5) / 10.0); return max(s.r, s.g * ${WARN_LEVEL.toFixed(3)}); }
  void main() {
    vec3 p = position;
    vec2 g = vec2(p.x + 4.0, 4.0 - p.z); // file, rank coordinates (0..8)
    // A vertex on a cell border takes the wettest cell touching it, so water fills the gaps and slopes under dry tiles.
    float L = 0.0;
    L = max(L, cellL(clamp(floor(g + vec2( 0.02,  0.02)), 0.0, 7.0)));
    L = max(L, cellL(clamp(floor(g + vec2(-0.02,  0.02)), 0.0, 7.0)));
    L = max(L, cellL(clamp(floor(g + vec2( 0.02, -0.02)), 0.0, 7.0)));
    L = max(L, cellL(clamp(floor(g + vec2(-0.02, -0.02)), 0.0, 7.0)));
    float h = mix(${Y_LOW.toFixed(3)}, ${Y_HIGH.toFixed(3)}, L);
    h += (sin(p.x * 3.1 + t * 1.7) + sin(p.z * 2.6 - t * 1.3)) * 0.004 * L;
    // The ring wave: a rounded crest travelling in from the board edge, Sea side first.
    float d = min(min(g.x, 8.0 - g.x), min(g.y, 8.0 - g.y));
    float sweep = abs(atan(p.x, -p.z)) / 3.14159265;
    float behind = front - (d + ${SKEW.toFixed(3)} * sweep) + 0.025 * sin(p.x * 4.0 + p.z * 3.0 + t * 3.0);
    float x = (behind - ${CREST_LAG.toFixed(3)}) / 0.17;
    float bump = crest * exp(-x * x) * smoothstep(inner + 0.25, inner - 0.15, d);
    h += bump;
    // Past the board edge the water spills a little way onto the rim, then dips under it.
    float outside = max(max(-g.x, g.x - 8.0), max(-g.y, g.y - 8.0));
    h = mix(h, ${(RIM_Y - 0.012).toFixed(3)}, smoothstep(0.0, 1.0, clamp(outside / ${MARGIN.toFixed(3)}, 0.0, 1.0)));
    p.y = h;
    vG = g; vL = L; vBump = bump;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const WATER_FRAG = /* glsl */ `
  uniform sampler2D levels; uniform float t; uniform float crest; uniform vec3 deep; uniform vec3 shallow; uniform vec3 wetDark;
  varying vec2 vG; varying float vL; varying float vBump;
  vec2 cellS(vec2 c) { return texture2D(levels, (c + 1.5) / 10.0).rg; }
  /** Foam within w of the edge toward neighbour cc when it is dry; thinner against the frame (blue channel). */
  float edgeFoam(vec2 cc, float dist, float w) {
    vec4 n = texture2D(levels, (cc + 1.5) / 10.0);
    return (1.0 - n.r) * smoothstep(n.b > 0.5 ? w * 0.5 : w, 0.0, dist);
  }
  void main() {
    float bumpVis = crest > 0.001 ? smoothstep(0.015, 0.07, vBump) : 0.0;
    float vis = max(clamp(vL * 5.0, 0.0, 1.0), bumpVis);
    if (vis < 0.01) discard;
    vec2 c = clamp(floor(vG), 0.0, 7.0);
    vec2 f = vG - c;
    vec4 own4 = texture2D(levels, (c + 1.5) / 10.0);
    vec2 own = own4.rg;
    float L0 = own.r;
    // Phase 6: a freshly sunk square (alpha channel) ripples in rings from its middle.
    float dc = length(f - 0.5);
    float rip = own4.a * smoothstep(0.52, 0.12, dc) * pow(0.5 + 0.5 * sin(dc * 40.0 - t * 4.5), 5.0);
    // Foam where this square's water meets a dry neighbour or the frame (off-board texels read as dry).
    float w = 0.16 + 0.04 * sin(t * 2.3 + (vG.x * 1.7 + vG.y * 1.3) * 3.0);
    float foam = 0.0;
    foam = max(foam, edgeFoam(c + vec2( 1.0,  0.0), 1.0 - f.x, w));
    foam = max(foam, edgeFoam(c + vec2(-1.0,  0.0), f.x, w));
    foam = max(foam, edgeFoam(c + vec2( 0.0,  1.0), 1.0 - f.y, w));
    foam = max(foam, edgeFoam(c + vec2( 0.0, -1.0), f.y, w));
    foam = max(foam, edgeFoam(c + vec2( 1.0,  1.0), length(vec2(1.0) - f), w));
    foam = max(foam, edgeFoam(c + vec2(-1.0,  1.0), length(vec2(f.x, 1.0 - f.y)), w));
    foam = max(foam, edgeFoam(c + vec2( 1.0, -1.0), length(vec2(1.0 - f.x, f.y)), w));
    foam = max(foam, edgeFoam(c + vec2(-1.0, -1.0), length(f), w));
    float wetN = max(max(cellS(c + vec2(1.0, 0.0)).r, cellS(c + vec2(-1.0, 0.0)).r), max(cellS(c + vec2(0.0, 1.0)).r, cellS(c + vec2(0.0, -1.0)).r));
    float lace = 0.5 + 0.5 * sin(vG.x * 21.0 + t * 1.8 + sin(vG.y * 9.0)) * sin(vG.y * 17.0 - t * 1.5 + sin(vG.x * 7.0));
    foam = max(smoothstep(0.55, 0.9, foam), foam * smoothstep(0.25, 0.7, lace)); // a solid line, lacy further out
    foam *= step(0.5, L0);
    // A dry square's own fragments only show in the gaps beside sunk water: that is the waterline.
    if (L0 < 0.5) foam = wetN;
    // While a square fills, its water churns white.
    foam = max(foam, (1.0 - L0) * step(0.02, L0) * 0.8);
    float top = crest > 0.001 ? smoothstep(0.45, 0.95, vBump / crest) : 0.0;
    foam = clamp(max(max(foam, top), rip * 0.75), 0.0, 1.0);

    vec3 col = mix(shallow, deep, 0.74 + 0.12 * sin(vG.x * 1.3 + t * 0.6) * sin(vG.y * 1.1 - t * 0.5));
    float ca = pow(abs(sin(vG.x * 6.0 + sin(vG.y * 5.0 + t) * 1.2 + t * 0.8) * sin(vG.y * 6.5 - sin(vG.x * 4.0 - t * 0.7) + t * 0.6)), 6.0);
    col += ca * 0.16 + vBump * 0.5;
    // Water that only creeps round a warned tile is darker.
    col = mix(col, wetDark, (1.0 - step(0.5, max(L0, wetN))) * 0.55);
    col = mix(col, vec3(1.0), foam);
    gl_FragColor = vec4(col, mix(0.9, 0.97, foam) * vis);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const EDGE_VERT = /* glsl */ `
  attribute float aWarn; varying vec2 vUv; varying float vW;
  void main() { vUv = uv; vW = aWarn; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;

const EDGE_FRAG = /* glsl */ `
  uniform float t; uniform vec3 wetDark; varying vec2 vUv; varying float vW;
  void main() {
    if (vW < 0.002) discard;
    vec2 q = vUv;
    float e = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
    float wig = 0.025 * sin(q.x * 23.0 + q.y * 7.0) + 0.02 * sin(q.y * 19.0 - q.x * 5.0 + t * 0.6);
    float band = smoothstep(0.2 + wig, 0.03, e);
    float sheen = smoothstep(0.022, 0.0, abs(e - 0.075 - wig * 0.5)) * (0.55 + 0.45 * sin(t * 2.0 + (q.x + q.y) * 6.0));
    vec3 c = mix(wetDark, vec3(0.88, 0.96, 1.0), sheen * 0.85);
    float a = vW * (band * 0.6 + sheen * 0.35);
    if (a < 0.01) discard;
    gl_FragColor = vec4(c, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

interface Wave {
  start: number;
  speed: number;
  inner: number;
  reduced: boolean;
  T: (typeof SINK_TIMING)['normal' | 'reduced'];
  crashed: boolean;
  sprayT: number;
}

export interface SinkContext {
  board: Board;
  bin: Bin;
  particles: Particles;
  reducedMotion: () => boolean;
  shake: (intensity: number) => void;
}

export class SinkingIsland {
  readonly water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly edges: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private levels: THREE.DataTexture;
  private data = new Uint8Array(10 * 10 * 4);
  private base: THREE.Matrix4[] = [];
  /** Per square (index file * 8 + rank). */
  private sunk = new Array<boolean>(64).fill(false);
  /** Time the tile starts to drop (Infinity = not sunk). */
  private dropAt = new Float64Array(64).fill(Infinity);
  private quiet = new Array<boolean>(64).fill(false);
  private warn = new Float32Array(64);
  private warnTarget = new Float32Array(64);
  private touched = new Array<boolean>(64).fill(false);
  /** Phase 6: time a stone started rising out of the water (Infinity = not rising). */
  private riseAt = new Float64Array(64).fill(Infinity);
  private riseQuiet = new Array<boolean>(64).fill(false);
  private riseFx = new Uint8Array(64);
  /** Phase 6: wet sheen on a stone just out of the water (fades), and the fresh marks (eased 0..1). */
  private wet = new Float32Array(64);
  private fresh = new Float32Array(64);
  private freshTarget = new Uint8Array(64);
  private bubbleAt = new Float64Array(64);
  private splashed = new Array<boolean>(64).fill(false);
  private phase: number[] = [];
  private restTilt: [number, number][] = [];
  private out: [number, number][] = [];
  private warnAttr: THREE.InstancedBufferAttribute;
  private wave: Wave | null = null;
  private time = 0;
  private prewarm = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private edgeOffset = new THREE.Matrix4().makeTranslation(0, TILE_H / 2 + 0.003, 0);

  constructor(private c: SinkContext) {
    const sq = c.board.squares;
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Matrix4();
      sq.getMatrixAt(i, m);
      this.base.push(m);
      const f = Math.floor(i / 8), r = i % 8;
      const h = Math.sin(i * 12.9898) * 43758.5453;
      const rnd = h - Math.floor(h);
      this.phase.push(rnd * Math.PI * 2);
      this.restTilt.push([(rnd - 0.5) * 0.04, (((rnd * 7.13) % 1) - 0.5) * 0.04]);
      const ox = f - 3.5, oz = 3.5 - r;
      const len = Math.max(Math.abs(ox), Math.abs(oz));
      this.out.push([Math.abs(ox) >= len - 0.01 ? Math.sign(ox) : 0, Math.abs(oz) >= len - 0.01 ? Math.sign(oz) : 0]);
    }
    sq.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.levels = c.bin.add(new THREE.DataTexture(this.data, 10, 10, THREE.RGBAFormat));
    this.levels.magFilter = this.levels.minFilter = THREE.NearestFilter;
    this.levels.needsUpdate = true;
    // The ring of texels round the board stands for the frame (blue channel).
    for (let k = 0; k < 10; k++) for (const o of [k * 4, (90 + k) * 4, k * 40, (k * 10 + 9) * 4]) this.data[o + 2] = 255;

    const size = 8 * SQUARE + MARGIN * 2;
    const segs = Math.round(size * 12);
    const geo = c.bin.add(new THREE.PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2));
    const mat = c.bin.add(new THREE.ShaderMaterial({
      uniforms: {
        levels: { value: this.levels }, t: { value: 0 }, front: { value: -9 }, crest: { value: 0 }, inner: { value: 0 },
        deep: { value: new THREE.Color(PALETTE.waterDeep) }, shallow: { value: new THREE.Color(PALETTE.waterShallow) },
        wetDark: { value: new THREE.Color('#163846') },
      },
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false,
    }));
    this.water = new THREE.Mesh(geo, mat);
    this.water.name = 'sunk-water';
    this.water.renderOrder = 2;
    this.water.frustumCulled = false;
    this.water.visible = false;
    this.water.userData.noPick = true;

    const edgeGeo = c.bin.add(new THREE.PlaneGeometry(SQUARE * 0.95, SQUARE * 0.95).rotateX(-Math.PI / 2));
    this.warnAttr = new THREE.InstancedBufferAttribute(new Float32Array(64), 1);
    this.warnAttr.setUsage(THREE.DynamicDrawUsage);
    edgeGeo.setAttribute('aWarn', this.warnAttr);
    const edgeMat = c.bin.add(new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, wetDark: { value: new THREE.Color('#123241') } },
      vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.edges = new THREE.InstancedMesh(edgeGeo, edgeMat, 64);
    this.edges.name = 'warn-edges';
    this.edges.renderOrder = 1;
    this.edges.frustumCulled = false;
    this.edges.visible = false;
    this.edges.userData.noPick = true;
    for (let i = 0; i < 64; i++) this.edges.setMatrixAt(i, this.m.multiplyMatrices(this.base[i], this.edgeOffset));

    c.board.group.add(this.water, this.edges);
  }

  /** Show the water and wet edges for one frame (shader warm-up before reveal), or hide them again. */
  setPrewarm(on: boolean): void {
    this.prewarm = on;
    this.water.visible = on || this.anyWater();
    this.edges.visible = on || this.anyEdge();
  }

  /** Show exactly these sunk and warned squares. A ring sinking at once plays the wave; [] [] restores instantly. */
  set(sunk: readonly Square[], warn: readonly Square[]): void {
    const want = new Set(sunk.map(idx));
    const fresh: Square[] = [];
    for (const sq of sunk) if (!this.sunk[idx(sq)]) fresh.push(sq);
    const leaving: number[] = [];
    for (let i = 0; i < 64; i++) if (this.sunk[i] && !want.has(i)) leaving.push(i);
    // Squares no longer sunk come back: at once for a new game (nothing sunk) or many at once; else they rise as stones.
    const rise = sunk.length > 0 && leaving.length < INSTANT_MIN_SQUARES;
    const reducedNow = this.c.reducedMotion();
    for (const i of leaving) {
      // Only a tile that is already under rises; one still dropping just pops back.
      const under = this.time >= this.dropAt[i];
      this.sunk[i] = false;
      this.dropAt[i] = Infinity;
      this.quiet[i] = false;
      this.riseAt[i] = rise && under ? this.time : Infinity;
      this.riseQuiet[i] = reducedNow;
      this.riseFx[i] = 0;
    }
    if (!rise) this.wet.fill(0);
    const warnSet = new Set(warn.map(idx));
    for (let i = 0; i < 64; i++) this.warnTarget[i] = warnSet.has(i) && !want.has(i) ? 1 : 0;
    if (!sunk.length && !warn.length) {
      this.wave = null;
      this.warn.fill(0);
    }

    if (fresh.length) {
      const reduced = this.c.reducedMotion();
      const times = sinkDropTimes(fresh, reduced);
      const style = sinkStyle(fresh);
      const ring = style === 'wave';
      for (const sq of fresh) {
        const i = idx(sq);
        this.sunk[i] = true;
        this.riseAt[i] = Infinity;
        this.wet[i] = 0;
        if (style === 'instant') {
          // Already under: no drop, no splash.
          this.dropAt[i] = this.time - 10;
          this.quiet[i] = true;
          this.splashed[i] = true;
          continue;
        }
        this.dropAt[i] = this.time + times.get(sq)!;
        this.quiet[i] = reduced;
        this.splashed[i] = false;
      }
      if (ring) {
        const { T, inner, speed } = waveFor(fresh, reduced);
        this.wave = { start: this.time, speed, inner, reduced, T, crashed: reduced, sprayT: 0 };
      }
    }
    this.water.visible = this.prewarm || this.anyWater();
    this.writeLevels();
    this.writeTiles();
  }

  /**
   * Phase 6 (Stepping Stones): squares changed last turn. On water: bubbles and ripples; on a dry stone: a dark wet edge.
   * [] clears.
   */
  setFresh(squares: readonly Square[]): void {
    this.freshTarget.fill(0);
    for (const sq of squares) this.freshTarget[idx(sq)] = 1;
    this.water.visible = this.prewarm || this.anyWater();
    this.edges.visible = this.prewarm || this.anyEdge();
  }

  /** Squares currently marked fresh (for tests and the demo). */
  get freshSquares(): Square[] {
    const out: Square[] = [];
    for (let i = 0; i < 64; i++) if (this.freshTarget[i]) out.push(sqOf(i));
    return out;
  }

  /** Squares currently sunk (for tests and the demo). */
  get sunkSquares(): Square[] {
    const out: Square[] = [];
    for (let i = 0; i < 64; i++) if (this.sunk[i]) out.push(sqOf(i));
    return out;
  }

  /** True while a ring wave is playing. */
  get waving(): boolean {
    return this.wave !== null;
  }

  update(dt: number, elapsed: number): void {
    this.time += dt;
    const reduced = this.c.reducedMotion();
    for (let i = 0; i < 64; i++) {
      const d = this.warnTarget[i] - this.warn[i];
      if (d !== 0) this.warn[i] = Math.abs(d) < dt * 2.5 ? this.warnTarget[i] : this.warn[i] + Math.sign(d) * dt * 2.5;
      const fd = this.freshTarget[i] - this.fresh[i];
      if (fd !== 0) this.fresh[i] = Math.abs(fd) < dt * 3 ? this.freshTarget[i] : this.fresh[i] + Math.sign(fd) * dt * 3;
      if (this.wet[i] > 0) this.wet[i] = Math.max(0, this.wet[i] - dt * 0.4);
      if (this.riseAt[i] !== Infinity) this.riseEffects(i, reduced);
      // Bubbles on a freshly sunk square.
      if (this.sunk[i] && this.fresh[i] > 0.5 && !reduced && this.time >= this.bubbleAt[i]) {
        this.bubbleAt[i] = this.time + 0.12 + Math.random() * 0.25;
        this.bubble(i);
      }
    }
    const u = this.water.material.uniforms;
    u.t.value = elapsed;
    this.edges.material.uniforms.t.value = elapsed;
    const w = this.wave;
    if (w) {
      const tw = this.time - w.start;
      u.front.value = FRONT_START + w.speed * tw;
      u.inner.value = w.inner;
      const height = w.reduced ? 0 : 0.34;
      const fall = clamp01((tw - w.T.travel) / (w.T.duration - w.T.travel));
      u.crest.value = height * ease.cubicOut(clamp01(tw / 0.18)) * (1 - ease.cubicIn(fall));
      if (!w.reduced && tw < w.T.travel && (w.sprayT -= dt) <= 0) {
        w.sprayT = 0.03;
        this.frontSpray(u.front.value - CREST_LAG, w.inner, height);
      }
      if (!w.crashed && tw >= w.T.travel - 0.06) {
        w.crashed = true;
        this.crash(w.inner);
      }
      if (tw >= w.T.duration) {
        this.wave = null;
        u.crest.value = 0;
        u.front.value = -9;
      }
    }
    // Droplets as each tile goes under.
    for (let i = 0; i < 64; i++) {
      if (!this.sunk[i] || this.splashed[i] || this.time < this.dropAt[i]) continue;
      this.splashed[i] = true;
      if (!this.quiet[i] && !reduced) this.tileSplash(i);
    }
    this.water.visible = this.prewarm || this.anyWater() || this.wave !== null;
    this.edges.visible = this.prewarm || this.anyEdge();
    if (this.water.visible) this.writeLevels();
    this.writeTiles(reduced);
  }

  /** Drop the board back to dry at once (dispose, new game). */
  clear(): void {
    this.set([], []);
  }

  dispose(): void {
    this.water.removeFromParent();
    this.edges.removeFromParent();
  }

  // ---------- internals ----------

  private anyWater(): boolean {
    for (let i = 0; i < 64; i++) if (this.sunk[i] || this.warn[i] > 0 || this.riseAt[i] !== Infinity) return true;
    return false;
  }

  /** Any wet edge to draw: a warned square, a stone just out of the water, or a fresh stone. */
  private anyEdge(): boolean {
    for (let i = 0; i < 64; i++) if (this.warn[i] > 0 || this.wet[i] > 0 || this.edgeFresh(i) > 0) return true;
    return false;
  }

  /** How strongly a fresh dry stone shows its wet edge. */
  private edgeFresh(i: number): number {
    return this.sunk[i] ? 0 : this.fresh[i] * 0.85;
  }

  /** Progress of a rising stone, 0..1 (1 = done or not rising). */
  private riseP(i: number): number {
    if (this.riseAt[i] === Infinity) return 1;
    return clamp01((this.time - this.riseAt[i]) / (this.riseQuiet[i] ? RISE_TIMING.reduced : RISE_TIMING.normal));
  }

  private levelOf(i: number): number {
    if (!this.sunk[i]) {
      if (this.riseAt[i] === Infinity) return 0;
      // The water drains off once the stone breaks the surface.
      return 1 - clamp01((this.riseP(i) - 0.28) / 0.27);
    }
    const T = this.quiet[i] ? SINK_TIMING.reduced : SINK_TIMING.normal;
    return clamp01((this.time - (this.dropAt[i] - 0.06)) / T.rise);
  }

  private writeLevels(): void {
    for (let i = 0; i < 64; i++) {
      const f = Math.floor(i / 8), r = i % 8;
      const o = ((r + 1) * 10 + (f + 1)) * 4;
      this.data[o] = Math.round(this.levelOf(i) * 255);
      this.data[o + 1] = Math.round(this.warn[i] * 255);
      this.data[o + 3] = this.sunk[i] ? Math.round(this.fresh[i] * 255) : 0;
    }
    this.levels.needsUpdate = true;
  }

  /** Tile offsets: the warn wobble, the drop, and a faint bob once under water. */
  private writeTiles(reduced = this.c.reducedMotion()): void {
    const sq = this.c.board.squares;
    let wrote = false, wroteEdge = false;
    const t = this.time;
    for (let i = 0; i < 64; i++) {
      let dy = 0, rx = 0, rz = 0;
      const ph = this.phase[i];
      const wv = this.warn[i];
      const dropping = this.sunk[i] && t >= this.dropAt[i];
      if (wv > 0 && !dropping && !reduced) {
        rx += Math.sin(t * 2.6 + ph) * 0.026 * wv;
        rz += Math.sin(t * 2.1 + ph * 1.7) * 0.026 * wv;
        dy += (Math.sin(t * 3.3 + ph) * 0.5 + 0.5) * 0.008 * wv;
        // Every couple of seconds, a short shudder.
        const shudder = Math.pow(Math.max(0, Math.sin(t * 2.7 + ph * 0.5)), 14);
        rz += Math.sin(t * 43) * 0.018 * shudder * wv;
      }
      if (dropping) {
        const T = this.quiet[i] ? SINK_TIMING.reduced : SINK_TIMING.normal;
        const k = clamp01((t - this.dropAt[i]) / T.drop);
        const [tx, tz] = this.restTilt[i];
        if (this.quiet[i] || reduced) {
          const e = ease.cubicOut(k);
          dy = -DROP * e;
          rx = tx * e;
          rz = tz * e;
        } else {
          // A small pop, a dunk past its rest depth tipping toward the sea, then it settles and bobs.
          const pop = k < 0.2 ? Math.sin((Math.PI * k) / 0.2) * 0.03 : 0;
          const v = clamp01((k - 0.2) / 0.8);
          const dunk = Math.sin(Math.PI * v) * (1 - v) * 0.06;
          dy = pop - DROP * ease.cubicOut(v) - dunk;
          const [ox, oz] = this.out[i];
          const tip = Math.sin(Math.PI * v) * (1 - v * 0.6) * 0.16;
          rx = tx * v + oz * tip;
          rz = tz * v - ox * tip;
          if (k >= 1) {
            dy += Math.sin(t * 1.3 + ph) * 0.004;
            rx += Math.sin(t * 0.9 + ph) * 0.008;
          }
        }
      }
      if (this.riseAt[i] !== Infinity) {
        const p = this.riseP(i);
        if (this.riseQuiet[i] || reduced) dy = -DROP * (1 - ease.cubicOut(p));
        else if (p < 0.12) dy = -DROP - 0.08 * Math.sin((p / 0.12) * Math.PI * 0.5); // a dip, gathering itself
        else if (p < 0.42) dy = -DROP - 0.08 + (DROP + 0.08 + 0.085) * ease.cubicOut((p - 0.12) / 0.3); // surges out
        else {
          const u = (p - 0.42) / 0.58;
          dy = 0.085 * Math.cos(u * Math.PI * 1.3) * (1 - u) * (1 - u); // settles with a bob
        }
        if (!(this.riseQuiet[i] || reduced)) {
          const wob = Math.sin(Math.PI * p) * (1 - p);
          rx += Math.sin(ph * 3 + p * 9) * 0.07 * wob;
          rz += Math.cos(ph * 2 + p * 8) * 0.07 * wob;
        }
        if (p >= 1) {
          this.riseAt[i] = Infinity;
          dy = rx = rz = 0;
        }
      }
      const moved = dy !== 0 || rx !== 0 || rz !== 0;
      if (moved || this.touched[i]) {
        if (moved) {
          this.q.setFromEuler(this.e.set(rx, 0, rz));
          this.m.compose(this.v.set(0, dy, 0), this.q, this.one).premultiply(this.base[i]);
        } else this.m.copy(this.base[i]);
        sq.setMatrixAt(i, this.m);
        this.touched[i] = moved;
        wrote = true;
        this.edges.setMatrixAt(i, this.m.multiply(this.edgeOffset));
        wroteEdge = true;
      }
      const a = Math.max(wv * (1 - this.levelOf(i)), this.wet[i], this.edgeFresh(i));
      const arr = this.warnAttr.array as Float32Array;
      if (arr[i] !== a) {
        arr[i] = a;
        this.warnAttr.needsUpdate = true;
      }
    }
    if (wrote) sq.instanceMatrix.needsUpdate = true;
    if (wroteEdge) this.edges.instanceMatrix.needsUpdate = true;
  }

  /** A rising stone: bubbles as it gathers, a splash as it breaks the surface, then water streaming off its edges. */
  private riseEffects(i: number, reduced: boolean): void {
    if (reduced || this.riseQuiet[i]) {
      this.wet[i] = 1;
      return;
    }
    const p = this.riseP(i);
    const { x, z } = squareToXZ(sqOf(i));
    if (!(this.riseFx[i] & 1)) {
      this.riseFx[i] |= 1;
      for (let k = 0; k < 5; k++) this.bubble(i);
    }
    if (!(this.riseFx[i] & 2) && p >= 0.26) {
      this.riseFx[i] |= 2;
      this.wet[i] = 1;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + Math.random() * 0.3;
        const r = 0.42 + Math.random() * 0.08;
        this.c.particles.emit({
          x: x + Math.cos(a) * r, y: Y_HIGH + 0.03, z: z + Math.sin(a) * r,
          vx: Math.cos(a) * (0.5 + Math.random() * 0.5), vy: 1.4 + Math.random() * 1.2, vz: Math.sin(a) * (0.5 + Math.random() * 0.5),
          life: 0.6, size: [0.14, 0.06], color: k % 3 ? '#ffffff' : PALETTE.waterShallow, alpha: 0.9, gravity: -8, floor: Y_HIGH - 0.02,
        });
      }
    }
    if (p > 0.32 && p < 0.97) {
      // Water streams off the stone's edges.
      for (let k = 0; k < 2; k++) {
        const side = Math.floor(Math.random() * 4);
        const s = (Math.random() - 0.5) * 0.9;
        const ex = side < 2 ? s : side === 2 ? -0.47 : 0.47;
        const ez = side < 2 ? (side === 0 ? -0.47 : 0.47) : s;
        this.c.particles.emit({
          x: x + ex, y: BOARD_TOP + 0.02, z: z + ez,
          vx: ex * 0.5, vy: 0.15, vz: ez * 0.5,
          life: 0.45, size: [0.07, 0.05], color: k ? '#ffffff' : PALETTE.waterShallow, alpha: 0.85, gravity: -7, drag: 0.3, floor: Y_HIGH - 0.03,
        });
      }
    }
  }

  /** A small bubble popping up through the water of a square. */
  private bubble(i: number): void {
    const { x, z } = squareToXZ(sqOf(i));
    this.c.particles.emit({
      x: x + (Math.random() - 0.5) * 0.7, y: Y_HIGH - 0.01, z: z + (Math.random() - 0.5) * 0.7,
      vx: 0, vy: 0.12 + Math.random() * 0.1, vz: 0,
      life: 0.35 + Math.random() * 0.25, size: [0.03, 0.08], color: '#f2fffd', alpha: 0.8, gravity: 0, drag: 1, floor: Y_LOW,
    });
  }

  private tileSplash(i: number): void {
    const { x, z } = squareToXZ(sqOf(i));
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      this.c.particles.emit({
        x: x + Math.cos(a) * 0.35, y: Y_HIGH + 0.02, z: z + Math.sin(a) * 0.35,
        vx: Math.cos(a) * 0.6, vy: 1.3 + Math.random() * 1.1, vz: Math.sin(a) * 0.6,
        life: 0.6, size: [0.13, 0.06], color: k % 2 ? '#ffffff' : PALETTE.waterShallow, alpha: 0.9, gravity: -8, floor: Y_HIGH - 0.02,
      });
    }
  }

  /** Spray off the top of the travelling crest. `at` = where the crest peaks, in skewed edge distance. */
  private frontSpray(at: number, inner: number, height: number): void {
    for (let k = 0; k < 4; k++) {
      const th = (Math.random() * 2 - 1) * Math.PI;
      const d = at - SKEW * (Math.abs(th) / Math.PI);
      if (d < 0 || d > inner) continue;
      const half = 4 - d;
      const sx = Math.sin(th), sz = -Math.cos(th);
      const n = half / Math.max(Math.abs(sx), Math.abs(sz));
      this.c.particles.emit({
        x: sx * n, y: Y_HIGH + height * 0.8, z: sz * n,
        vx: -sx * 0.5, vy: 0.9 + Math.random() * 0.9, vz: -sz * 0.5,
        life: 0.45, size: [0.2, 0.08], color: Math.random() < 0.75 ? '#ffffff' : PALETTE.waterShallow, alpha: 0.9, gravity: -6, floor: Y_HIGH - 0.02,
      });
    }
  }

  /** The crest crashes into the next dry ring: spray all along its edge. */
  private crash(inner: number): void {
    this.c.shake(0.25);
    const h = 4 - inner;
    if (h <= 0) return;
    const n = Math.round(10 * h);
    for (let k = 0; k < n; k++) {
      const s = (Math.random() * 2 - 1) * h;
      const side = Math.floor(Math.random() * 4);
      const x = side < 2 ? s : side === 2 ? -h : h;
      const z = side < 2 ? (side === 0 ? -h : h) : s;
      this.c.particles.emit({
        x, y: Y_HIGH + 0.1, z,
        vx: -Math.sign(x) * 0.2 * (side >= 2 ? 1 : 0) + (Math.random() - 0.5) * 0.3, vy: 1.6 + Math.random() * 1.4,
        vz: -Math.sign(z) * 0.2 * (side < 2 ? 1 : 0) + (Math.random() - 0.5) * 0.3,
        life: 0.7, size: [0.24, 0.1], color: Math.random() < 0.7 ? '#ffffff' : PALETTE.waterShallow, alpha: 0.9, gravity: -8, floor: Y_HIGH - 0.02,
      });
    }
  }
}

function idx(sq: Square): number {
  const { file, rank } = squareIndex(sq);
  return file * 8 + rank;
}

function sqOf(i: number): Square {
  return `${'abcdefgh'[Math.floor(i / 8)]}${(i % 8) + 1}` as Square;
}
