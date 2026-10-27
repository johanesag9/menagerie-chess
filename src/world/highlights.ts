/**
 * Square highlights: selected glow, legal-move dots, capture rings, last-move tint, check pulse,
 * and (Phase 3) the violet "magic" target rings and the soft area wash.
 * Every marker eases in and out on its own (no popping). Legal dots ripple out from the selected square.
 * Targets and area are one instanced draw call each (one slot per square), so 40 targets cost no more than 1.
 */
import * as THREE from 'three';
import type { HighlightSet, Square } from '../contracts/types';
import { damp } from './anim';
import { BOARD_TOP, PALETTE, SQUARE } from './constants';
import { squareIndex, squareToXZ } from './coords';
import type { Bin } from './kit';
import type { Textures } from './textures';

type Kind = 'selected' | 'legal' | 'capture' | 'lastMove' | 'check';

interface Marker {
  kind: Kind;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  square: Square | null;
  /** 0 = hidden, 1 = fully shown. */
  v: number;
  target: number;
  /** Seconds to wait before revealing (ripple). */
  delay: number;
  /** Time since this marker was (re)shown, for pulses. */
  age: number;
  phase: number;
}

/** Height above the tiles. Tiles never rise above BOARD_TOP (see board.ts). */
const LIFT: Record<Kind, number> = { lastMove: 0.008, selected: 0.011, check: 0.014, legal: 0.017, capture: 0.02 };

export class Highlights {
  readonly group = new THREE.Group();
  private markers: Marker[] = [];
  private plane: THREE.PlaneGeometry;
  private state: {
    selected: Square | null; legal: Square[]; captures: Square[]; lastMove: [Square, Square] | null; check: Square | null;
    targets: Square[]; area: Square[];
  } = { selected: null, legal: [], captures: [], lastMove: null, check: null, targets: [], area: [] };
  private checkWave: Marker;
  private targets: SquareField;
  private area: SquareField;

  constructor(private bin: Bin, private tex: Textures, private bloomBoost: () => number) {
    this.group.name = 'highlights';
    this.plane = bin.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    // Pre-allocate the common case so nothing is created mid-game.
    this.make('selected');
    this.make('lastMove');
    this.make('lastMove');
    this.make('check');
    this.checkWave = this.make('check');
    this.checkWave.mat.map = tex.ring;
    for (let i = 0; i < 28; i++) this.make('legal');
    for (let i = 0; i < 8; i++) this.make('capture');
    this.area = new SquareField(bin, 'area', LIFT.lastMove + 0.0015);
    this.targets = new SquareField(bin, 'target', LIFT.capture + 0.003);
    this.group.add(this.area.mesh, this.targets.mesh);
  }

  private make(kind: Kind): Marker {
    const map = {
      selected: this.tex.squareGlow, legal: this.tex.dot, capture: this.tex.ring, lastMove: this.tex.squareFill, check: this.tex.squareFill,
    }[kind];
    const color = { selected: PALETTE.selected, legal: PALETTE.legal, capture: PALETTE.capture, lastMove: PALETTE.lastMove, check: PALETTE.check }[kind];
    const mat = this.bin.add(new THREE.MeshBasicMaterial({
      map, color, transparent: true, depthWrite: false, opacity: 0,
      blending: THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    const mesh = new THREE.Mesh(this.plane, mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    mesh.name = `hl-${kind}`;
    this.group.add(mesh);
    const m: Marker = { kind, mesh, mat, square: null, v: 0, target: 0, delay: 0, age: 0, phase: Math.random() * 6 };
    this.markers.push(m);
    return m;
  }

  /** Fields left out keep their current value. Pass null / [] to clear one. */
  set(h: HighlightSet): void {
    if (h.selected !== undefined) this.state.selected = h.selected;
    if (h.legal !== undefined) this.state.legal = [...h.legal];
    if (h.captures !== undefined) this.state.captures = [...h.captures];
    if (h.lastMove !== undefined) this.state.lastMove = h.lastMove ? [...h.lastMove] : null;
    if (h.check !== undefined) this.state.check = h.check;
    if (h.targets !== undefined) this.state.targets = [...(h.targets ?? [])];
    if (h.area !== undefined) this.state.area = [...(h.area ?? [])];
    this.sync();
  }

  get current(): HighlightSet {
    return { ...this.state };
  }

  private sync(): void {
    const s = this.state;
    const origin = s.selected ? squareIndex(s.selected) : null;
    const rippleDelay = (sq: Square) => {
      if (!origin) return 0;
      const { file, rank } = squareIndex(sq);
      return Math.hypot(file - origin.file, rank - origin.rank) * 0.035;
    };
    this.assign('selected', s.selected ? [s.selected] : [], () => 0);
    this.assign('legal', s.legal ?? [], rippleDelay);
    this.assign('capture', s.captures ?? [], rippleDelay);
    this.assign('lastMove', s.lastMove ? [...s.lastMove] : [], () => 0);
    const check = this.markers.filter((m) => m.kind === 'check');
    this.assignTo(check.filter((m) => m !== this.checkWave), s.check ? [s.check] : [], () => 0, 'check');
    this.assignTo([this.checkWave], s.check ? [s.check] : [], () => 0.1, 'check');
    this.targets.set(s.targets, rippleDelay);
    this.area.set(s.area, () => 0);
  }

  private assign(kind: Kind, squares: Square[], delay: (sq: Square) => number): void {
    this.assignTo(this.markers.filter((m) => m.kind === kind), squares, delay, kind);
  }

  /** Keeps markers already on a wanted square, frees the rest, then fills new squares. */
  private assignTo(pool: Marker[], squares: Square[], delay: (sq: Square) => number, kind: Kind): void {
    const want = new Set(squares);
    for (const m of pool) {
      if (m.square && want.has(m.square) && m.target === 1) want.delete(m.square);
      else m.target = 0;
    }
    for (const sq of want) {
      // Prefer a marker that is fully hidden; grow the pool if needed.
      let m = pool.find((p) => p.target === 0 && p.v === 0);
      if (!m) {
        m = this.make(kind);
        pool.push(m);
      }
      m.square = sq;
      m.target = 1;
      m.delay = delay(sq);
      m.age = 0;
      const { x, z } = squareToXZ(sq);
      m.mesh.position.set(x, BOARD_TOP + LIFT[kind], z);
    }
  }

  update(dt: number, t: number): void {
    const boost = this.bloomBoost();
    this.targets.update(dt, t, boost);
    this.area.update(dt, t, boost);
    for (const m of this.markers) {
      if (m.target === 1 && m.delay > 0) {
        m.delay -= dt;
        continue;
      }
      m.age += dt;
      const rate = m.target === 1 ? 14 : 10;
      m.v = damp(m.v, m.target, rate, dt);
      if (m.target === 0 && m.v < 0.01) m.v = 0;
      if (m.target === 1 && m.v > 0.995) m.v = 1;
      m.mesh.visible = m.v > 0;
      if (!m.mesh.visible) continue;
      this.style(m, t, boost);
    }
  }

  private style(m: Marker, t: number, boost: number): void {
    const v = m.v;
    // Overshoot on the way in: a soft pop.
    const pop = m.target === 1 ? 1 + Math.sin(Math.min(m.age * 9, Math.PI)) * 0.18 * (1 - Math.min(m.age * 2, 1)) : 1;
    switch (m.kind) {
      case 'selected': {
        const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);
        m.mesh.scale.setScalar(SQUARE * (1.0 + pulse * 0.03) * (0.8 + 0.2 * v) * pop);
        m.mat.opacity = v * (0.85 + pulse * 0.15);
        m.mat.color.set(PALETTE.selected).multiplyScalar(1 + boost * 0.5);
        break;
      }
      case 'legal': {
        m.mesh.scale.setScalar(SQUARE * 0.34 * v * pop);
        m.mat.opacity = v * 0.62;
        break;
      }
      case 'capture': {
        const pulse = 0.5 + 0.5 * Math.sin(t * 5 + m.phase);
        m.mesh.scale.setScalar(SQUARE * (1.16 + pulse * 0.06) * (0.6 + 0.4 * v) * pop);
        m.mesh.rotation.y = t * 0.6;
        m.mat.opacity = v * (0.85 + pulse * 0.15);
        m.mat.color.set(PALETTE.capture).multiplyScalar(1 + boost * 0.5);
        break;
      }
      case 'lastMove': {
        m.mesh.scale.setScalar(SQUARE * 0.98);
        m.mat.opacity = v * 0.55;
        break;
      }
      case 'check': {
        if (m === this.checkWave) {
          // Expanding ring every 1.1s.
          const w = (m.age % 1.1) / 1.1;
          m.mesh.scale.setScalar(SQUARE * (1.0 + w * 1.2));
          m.mat.opacity = v * (1 - w) * 0.9;
        } else {
          const pulse = 0.5 + 0.5 * Math.sin(t * 6.5);
          m.mesh.scale.setScalar(SQUARE * 0.84 * pop); // inset, so a selected glow still shows around it
          m.mat.opacity = v * (0.5 + pulse * 0.35);
        }
        m.mat.color.set(PALETTE.check).multiplyScalar(1 + boost * 0.8);
        break;
      }
    }
  }

  /** Make every marker visible for one frame (shader warm-up before reveal). */
  setAllVisible(v: boolean): void {
    for (const m of this.markers) m.mesh.visible = v || m.v > 0;
    this.targets.mesh.visible = v || this.targets.active;
    this.area.mesh.visible = v || this.area.active;
  }
}

const FIELD_VERT = /* glsl */ `
  attribute vec2 aState; // x = shown 0..1, y = age in seconds
  attribute float aPhase;
  varying vec2 vUv; varying vec2 vState; varying float vPhase;
  void main() {
    vUv = uv; vState = aState; vPhase = aPhase;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

/** Violet ring with four turning star glints that twinkle; a soft violet glow inside. */
const TARGET_FRAG = /* glsl */ `
  uniform float t; uniform vec3 color; uniform vec3 spark; uniform float boost;
  varying vec2 vUv; varying vec2 vState; varying float vPhase;
  float star(vec2 p, float size) {
    p = abs(p) / size;
    return max(0.0, 1.0 - (p.x * p.y * 18.0 + (p.x + p.y) * 0.8)) * step(max(p.x, p.y), 1.2);
  }
  void main() {
    float v = vState.x;
    if (v <= 0.0) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float pop = 1.0 + sin(min(vState.y * 9.0, 3.14159)) * 0.2 * (1.0 - min(vState.y * 2.0, 1.0));
    p /= mix(0.6, 1.0, v) * pop;
    float r = length(p);
    float breathe = 0.5 + 0.5 * sin(t * 2.2 + vPhase);
    float ringR = 0.66 + breathe * 0.03;
    float ring = smoothstep(0.075, 0.03, abs(r - ringR));
    float glowIn = smoothstep(ringR, 0.0, r) * 0.22;
    // Four glints riding the ring, turning slowly, each twinkling on its own beat.
    float a0 = t * 0.45 + vPhase;
    float glints = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = a0 + float(i) * 1.5708;
      vec2 c = vec2(cos(a), sin(a)) * ringR;
      float tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 3.3 + float(i) * 2.1 + vPhase * 3.0), 3.0);
      glints += star(p - c, 0.2 * tw);
    }
    float a = max(ring * 0.95, glowIn) * v;
    vec3 c = mix(color, spark, clamp(glints, 0.0, 1.0)) * (1.0 + boost * 0.6);
    a = max(a, clamp(glints, 0.0, 1.0) * v);
    if (a < 0.003) discard;
    gl_FragColor = vec4(c, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** A soft rounded-square wash that breathes gently. */
const AREA_FRAG = /* glsl */ `
  uniform float t; uniform vec3 color; uniform vec3 spark; uniform float boost;
  varying vec2 vUv; varying vec2 vState; varying float vPhase;
  void main() {
    float v = vState.x;
    if (v <= 0.0) discard;
    vec2 p = abs(vUv * 2.0 - 1.0);
    vec2 q = max(p - 0.62, 0.0);
    float d = length(q) + min(max(p.x, p.y) - 0.62, 0.0);
    float fill = 1.0 - smoothstep(0.12, 0.32, d);
    float edge = smoothstep(0.32, 0.22, d) * smoothstep(0.08, 0.2, d);
    float breathe = 0.5 + 0.5 * sin(t * 2.6 + vPhase);
    float a = (fill * (0.32 + breathe * 0.1) + edge * 0.25) * v;
    gl_FragColor = vec4(mix(color, spark, edge * 0.6) * (1.0 + boost * 0.3), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** One instanced marker per board square (instance i = file * 8 + rank). Eases each one in and out. */
class SquareField {
  readonly mesh: THREE.InstancedMesh;
  private v = new Float32Array(64);
  private want = new Uint8Array(64);
  private delay = new Float32Array(64);
  private age = new Float32Array(64);
  private state: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  active = false;

  constructor(bin: Bin, kind: 'target' | 'area', lift: number) {
    const geo = bin.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    this.mat = bin.add(new THREE.ShaderMaterial({
      uniforms: {
        t: { value: 0 }, boost: { value: 0 },
        color: { value: new THREE.Color(kind === 'target' ? PALETTE.target : PALETTE.area) },
        spark: { value: new THREE.Color(PALETTE.targetSpark) },
      },
      vertexShader: FIELD_VERT,
      fragmentShader: kind === 'target' ? TARGET_FRAG : AREA_FRAG,
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh = new THREE.InstancedMesh(geo, this.mat, 64);
    this.mesh.name = `hl-${kind}`;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    const m = new THREE.Matrix4();
    const phase = new Float32Array(64);
    const size = kind === 'target' ? SQUARE * 1.0 : SQUARE * 0.98;
    for (let i = 0; i < 64; i++) {
      const file = Math.floor(i / 8), rank = i % 8;
      m.makeScale(size, 1, size).setPosition((file - 3.5) * SQUARE, BOARD_TOP + lift, (3.5 - rank) * SQUARE);
      this.mesh.setMatrixAt(i, m);
      phase[i] = (file * 1.7 + rank * 2.9) % 6.28;
    }
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(128), 2);
    this.state.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', this.state);
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  }

  set(squares: Square[], delay: (sq: Square) => number): void {
    const next = new Uint8Array(64);
    for (const sq of squares) {
      const { file, rank } = squareIndex(sq);
      next[file * 8 + rank] = 1;
    }
    for (let i = 0; i < 64; i++) {
      if (next[i] && !this.want[i]) {
        const f = Math.floor(i / 8), r = i % 8;
        this.delay[i] = delay(`${'abcdefgh'[f]}${r + 1}` as Square);
        this.age[i] = 0;
      }
      this.want[i] = next[i];
    }
  }

  update(dt: number, t: number, boost: number): void {
    let any = false;
    for (let i = 0; i < 64; i++) {
      if (this.want[i] && this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      const target = this.want[i];
      if (!target && this.v[i] === 0) continue;
      this.age[i] += dt;
      let v = damp(this.v[i], target, target ? 12 : 10, dt);
      if (!target && v < 0.01) v = 0;
      if (target && v > 0.995) v = 1;
      this.v[i] = v;
      this.state.setXY(i, v, this.age[i]);
      if (v > 0 || target) any = true;
    }
    for (let i = 0; i < 64; i++) if (this.want[i]) any = true;
    this.state.needsUpdate = true;
    this.active = any;
    this.mesh.visible = any;
    this.mat.uniforms.t.value = t;
    this.mat.uniforms.boost.value = boost;
  }
}
