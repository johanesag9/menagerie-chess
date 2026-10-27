/**
 * Square highlights: selected glow, legal-move dots, capture rings, last-move tint, check pulse.
 * Every marker eases in and out on its own (no popping). Legal dots ripple out from the selected square.
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
  private state: { selected: Square | null; legal: Square[]; captures: Square[]; lastMove: [Square, Square] | null; check: Square | null } = {
    selected: null, legal: [], captures: [], lastMove: null, check: null,
  };
  private checkWave: Marker;

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
  }
}
