/**
 * Blocked squares (Phase 3). Land's block is a knocked-over flower vase with spilled water and petals;
 * Sea's block is a swirling octopus ink cloud. `turnsLeft` shows softly: the puddle shrinks and the
 * cloud thins as it runs out. Nothing here catches clicks (`noPick`).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Side, Square, SquareEffect } from '../contracts/types';
import { clamp01, damp, ease } from './anim';
import { BOARD_TOP, SQUARE } from './constants';
import { squareToXZ } from './coords';
import { type Bin, seeded } from './kit';

/** A block lasts 4 plies when placed (see `SquareEffect.turnsLeft`). */
const MAX_TURNS = 4;
const APPEAR_S = 0.7;
const VANISH_S = 0.45;

interface Fx {
  by: Side;
  root: THREE.Group;
  /** 0..1 appear progress; counts down while vanishing. */
  t: number;
  state: 'in' | 'on' | 'out' | 'free';
  /** Countdown look: 1 = fresh, falls toward 0 as turnsLeft runs out. */
  life: number;
  lifeTarget: number;
  square: Square | null;
  update(fx: Fx, dt: number, el: number): void;
}

/** Non-indexed copy with position, normal and a flat vertex colour, so parts merge into one mesh. */
function paint(src: THREE.BufferGeometry, color: THREE.ColorRepresentation | ((y: number) => THREE.Color)): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  src.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const fixed = typeof color === 'function' ? null : new THREE.Color(color);
  for (let i = 0; i < pos.count; i++) {
    const c = fixed ?? (color as (y: number) => THREE.Color)(pos.getY(i));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

const INK_VERT = /* glsl */ `
  uniform float t; uniform float density; varying vec3 vP; varying vec3 vN; varying vec3 vView;
  // Cheap smooth lumps: a few travelling sines.
  float lumps(vec3 p) {
    return sin(p.x * 5.1 + t * 1.3) * sin(p.z * 4.3 - t * 1.1) * 0.5
         + sin((p.x + p.z) * 7.0 + t * 2.0) * 0.25 + sin(p.y * 9.0 - t * 1.7) * 0.15;
  }
  void main() {
    vec3 p = position;
    float swirl = t * 0.5 + p.y * 2.5;
    float c = cos(swirl * 0.3), s = sin(swirl * 0.3);
    p.xz = mat2(c, -s, s, c) * p.xz;
    p += normal * lumps(position) * 0.14 * (0.4 + p.y);
    vP = position;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const INK_FRAG = /* glsl */ `
  uniform float t; uniform float density; uniform vec3 ink; uniform vec3 glow;
  varying vec3 vP; varying vec3 vN; varying vec3 vView;
  void main() {
    float r = length(vP.xz);
    float a = atan(vP.z, vP.x);
    float swirl = sin(a * 3.0 + r * 9.0 - t * 1.6 + sin(vP.y * 6.0 + t) * 1.5);
    float band = smoothstep(0.55, 1.0, swirl);
    float rim = pow(1.0 - abs(dot(vN, vView)), 2.0);
    vec3 c = mix(ink, glow, band * 0.55 + rim * 0.5);
    c += vec3(0.9, 0.85, 1.0) * smoothstep(0.92, 1.0, swirl) * 0.18; // faint glossy streaks
    float alpha = density * mix(0.95, 0.55, rim) ;
    gl_FragColor = vec4(c, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const STAIN_FRAG = /* glsl */ `
  uniform float t; uniform float density; uniform vec3 ink; uniform vec3 glow; varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    // Wobbly edge with tendrils that slowly turn.
    float edge = 0.62 + 0.1 * sin(a * 5.0 + t * 0.7) + 0.08 * sin(a * 9.0 - t * 1.1) + 0.06 * sin(a * 2.0 + t * 0.4);
    float m = 1.0 - smoothstep(edge - 0.18, edge, r);
    float swirl = smoothstep(0.6, 1.0, sin(a * 2.0 - r * 10.0 + t * 1.4));
    vec3 c = mix(ink, glow, swirl * 0.35);
    gl_FragColor = vec4(c, m * density * 0.85);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class SquareEffects {
  readonly group = new THREE.Group();
  private live = new Map<Square, Fx>();
  private pool: Fx[] = [];
  private vaseGeo: THREE.BufferGeometry;
  private petalGeo: THREE.BufferGeometry;
  private puddleGeo: THREE.BufferGeometry;
  private toyMat: THREE.MeshPhysicalMaterial;
  private puddleMat: THREE.MeshPhysicalMaterial;
  private domeGeo: THREE.BufferGeometry;
  private stainGeo: THREE.BufferGeometry;
  private domeMat: THREE.ShaderMaterial;
  private stainMat: THREE.ShaderMaterial;
  /** One hidden vase and one hidden cloud, shown only for the shader warm-up. */
  private warm: Fx[] = [];

  constructor(private bin: Bin) {
    this.group.name = 'squareEffects';
    this.group.userData.noPick = true;

    // ---- Land: a porcelain vase lying on its side, flowers spilling out, petals and a puddle ----
    const cream = new THREE.Color('#f7f1e6'), cobalt = new THREE.Color('#2c58b0');
    const profile = [
      [0.0, 0.0], [0.085, 0.0], [0.1, 0.03], [0.15, 0.12], [0.145, 0.2], [0.09, 0.29], [0.065, 0.33], [0.075, 0.37], [0.095, 0.385], [0.085, 0.395],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const vase = paint(new THREE.LatheGeometry(profile, 20), (y) => ((y > 0.1 && y < 0.15) || (y > 0.3 && y < 0.34) ? cobalt : cream));
    const parts = [vase];
    const stemGeo = (len: number) => new THREE.CylinderGeometry(0.009, 0.011, len, 5).translate(0, len / 2, 0);
    const flowers: [number, number, string][] = [[-0.35, 0.16, '#ff6f91'], [0.05, 0.2, '#ffd23f'], [0.4, 0.14, '#ff9ecb']];
    for (const [lean, len, col] of flowers) {
      const stem = stemGeo(len).rotateZ(lean).rotateX(lean * 0.5).translate(0, 0.37, 0);
      parts.push(paint(stem, '#4f9a3a'));
      const tip = new THREE.Vector3(0, len, 0).applyEuler(new THREE.Euler(lean * 0.5, 0, lean, 'ZXY')).add(new THREE.Vector3(0, 0.37, 0));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        parts.push(paint(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.45, 1.4).rotateY(a).translate(tip.x + Math.cos(a) * 0.03, tip.y, tip.z + Math.sin(a) * 0.03), col));
      }
      parts.push(paint(new THREE.SphereGeometry(0.022, 8, 6).translate(tip.x, tip.y + 0.01, tip.z), '#fff3b0'));
    }
    this.vaseGeo = bin.add(mergeGeometries(parts)!);
    parts.forEach((p) => p.dispose());

    const rnd = seeded(31);
    const petals: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = rnd() * Math.PI * 2, r = 0.12 + rnd() * 0.24;
      const col = ['#ff6f91', '#ff9ecb', '#ffd23f', '#ffffff'][i % 4];
      petals.push(paint(new THREE.SphereGeometry(0.028, 8, 5).scale(1, 0.25, 1.5).rotateY(rnd() * 3).translate(Math.cos(a) * r + 0.18, 0.006, Math.sin(a) * r), col));
    }
    this.petalGeo = bin.add(mergeGeometries(petals)!);
    petals.forEach((p) => p.dispose());

    // A blobby puddle (wobbly circle), centred a little past the vase mouth.
    const puddle = new THREE.CircleGeometry(0.4, 40);
    const pp = puddle.attributes.position;
    for (let i = 1; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), a = Math.atan2(y, x);
      const k = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.07 * Math.sin(a * 7 + 2);
      pp.setXY(i, x * k * 1.15, y * k * 0.9);
    }
    puddle.rotateX(-Math.PI / 2).translate(0.2, 0, 0);
    this.puddleGeo = bin.add(puddle);

    this.toyMat = bin.add(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
    this.puddleMat = bin.add(new THREE.MeshPhysicalMaterial({
      color: '#9ad8ff', roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));

    // ---- Sea: an ink cloud (a lumpy dome over a tendrilled stain) ----
    this.domeGeo = bin.add(new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2));
    this.stainGeo = bin.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const inkUniforms = () => ({
      t: { value: 0 }, density: { value: 1 }, ink: { value: new THREE.Color('#1b1330') }, glow: { value: new THREE.Color('#6a3fa8') },
    });
    this.domeMat = bin.add(new THREE.ShaderMaterial({ uniforms: inkUniforms(), vertexShader: INK_VERT, fragmentShader: INK_FRAG, transparent: true, depthWrite: false }));
    this.stainMat = bin.add(new THREE.ShaderMaterial({
      uniforms: inkUniforms(),
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: STAIN_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));

    this.warm = [this.take('land'), this.take('sea')];
    for (const fx of this.warm) this.release(fx);
  }

  /** Show every kind for one frame (shader warm-up before reveal), or hide them again. */
  setPrewarm(on: boolean): void {
    for (const fx of this.warm) {
      if (fx.state !== 'free') continue;
      fx.root.visible = on;
      if (on) {
        fx.t = 1;
        fx.life = 1;
        fx.root.position.set(0, BOARD_TOP, 0);
        fx.update(fx, 0, 0);
      }
    }
  }

  /** Show exactly these effects: new ones appear, missing ones vanish, `turnsLeft` changes ease in. */
  set(effects: SquareEffect[]): void {
    const want = new Map<Square, SquareEffect>();
    for (const e of effects) if (e.effect === 'blocked') want.set(e.square, e);
    for (const [sq, fx] of this.live) {
      const e = want.get(sq);
      if (!e || e.by !== fx.by) {
        fx.state = 'out';
        this.live.delete(sq);
      }
    }
    for (const [sq, e] of want) {
      let fx = this.live.get(sq);
      if (!fx) {
        fx = this.take(e.by);
        fx.square = sq;
        fx.state = 'in';
        fx.t = 0;
        fx.life = fx.lifeTarget = lifeOf(e.turnsLeft);
        const { x, z } = squareToXZ(sq);
        // A stable little turn per square so two vases don't look stamped.
        const yaw = ((sq.charCodeAt(0) * 7 + sq.charCodeAt(1) * 13) % 16) / 16 * Math.PI * 2;
        fx.root.position.set(x, BOARD_TOP, z);
        fx.root.rotation.y = yaw;
        fx.root.visible = true;
        this.live.set(sq, fx);
      }
      fx.lifeTarget = lifeOf(e.turnsLeft);
    }
  }

  update(dt: number, el: number): void {
    for (const fx of [...this.live.values(), ...this.pool.filter((f) => f.state === 'out')]) {
      if (fx.state === 'in') {
        fx.t = Math.min(1, fx.t + dt / APPEAR_S);
        if (fx.t >= 1) fx.state = 'on';
      } else if (fx.state === 'out') {
        fx.t = Math.max(0, fx.t - dt / VANISH_S);
      }
      fx.life = damp(fx.life, fx.lifeTarget, 3, dt);
      fx.update(fx, dt, el);
      if (fx.state === 'out' && fx.t <= 0) this.release(fx);
    }
  }

  /** Jump every animation to its end (used when the world disposes or skips). */
  clear(): void {
    this.set([]);
    for (const fx of this.pool) if (fx.state === 'out') this.release(fx);
  }

  private take(by: Side): Fx {
    const i = this.pool.findIndex((f) => f.state === 'free' && f.by === by);
    if (i >= 0) {
      const fx = this.pool[i];
      fx.state = 'in';
      return fx;
    }
    const fx = by === 'land' ? this.makeVase() : this.makeInk();
    this.pool.push(fx);
    this.group.add(fx.root);
    return fx;
  }

  private release(fx: Fx): void {
    fx.state = 'free';
    fx.square = null;
    fx.root.visible = false;
  }

  private makeVase(): Fx {
    const root = new THREE.Group();
    root.name = 'block-vase';
    // The vase tips over around a pivot on the board, toward +x.
    const pivot = new THREE.Group();
    pivot.position.x = -0.2;
    const vase = new THREE.Mesh(this.vaseGeo, this.toyMat);
    vase.castShadow = true;
    pivot.add(vase);
    const petals = new THREE.Mesh(this.petalGeo, this.toyMat);
    const puddleMat = this.bin.add(this.puddleMat.clone());
    const puddle = new THREE.Mesh(this.puddleGeo, puddleMat);
    puddle.position.y = 0.004;
    puddle.renderOrder = 1;
    root.add(puddle, petals, pivot);
    const fxObj: Fx = {
      by: 'land', root, t: 0, state: 'in', life: 1, lifeTarget: 1, square: null,
      update: (fx, _dt, el) => {
        const out = fx.state === 'out';
        // Appear: the vase falls from a little above, tips onto its side with a bounce, then the water spreads.
        const fall = clamp01(fx.t / 0.45);
        const tip = out ? 1 : ease.backOut(clamp01((fx.t - 0.15) / 0.55));
        pivot.rotation.z = -Math.PI / 2 * tip;
        pivot.position.y = 0.15 * Math.min(1, tip) + (out ? 0 : (1 - ease.cubicIn(fall)) * 0.6);
        pivot.position.x = -0.2 * (1 - Math.min(1, tip)) - 0.05;
        // A tiny settled rock so it feels alive.
        pivot.rotation.x = fx.state === 'on' ? Math.sin(el * 1.3) * 0.02 : 0;
        const spill = out ? fx.t : ease.cubicOut(clamp01((fx.t - 0.4) / 0.6));
        const size = 0.45 + 0.55 * fx.life;
        puddle.scale.set(size * spill, 1, size * spill);
        puddleMat.opacity = 0.62 * spill;
        petals.scale.setScalar(Math.max(0.001, spill));
        const shrink = out ? ease.cubicOut(fx.t) : 1;
        pivot.scale.setScalar(Math.max(0.001, shrink));
      },
    };
    return fxObj;
  }

  private makeInk(): Fx {
    const root = new THREE.Group();
    root.name = 'block-ink';
    const domeMat = this.bin.add(this.domeMat.clone());
    const stainMat = this.bin.add(this.stainMat.clone());
    const dome = new THREE.Mesh(this.domeGeo, domeMat);
    dome.renderOrder = 2;
    const stain = new THREE.Mesh(this.stainGeo, stainMat);
    stain.position.y = 0.004;
    stain.renderOrder = 1;
    stain.scale.setScalar(SQUARE * 1.02);
    root.add(stain, dome);
    const seed = Math.random() * 10;
    return {
      by: 'sea', root, t: 0, state: 'in', life: 1, lifeTarget: 1, square: null,
      update: (fx, _dt, el) => {
        const k = fx.state === 'out' ? ease.cubicIn(fx.t) : ease.backOut(fx.t);
        const thin = 0.4 + 0.6 * fx.life;
        const breathe = 1 + Math.sin(el * 1.6 + seed) * 0.04;
        dome.scale.set(0.42 * k * (0.75 + 0.25 * fx.life) * breathe, 0.3 * k * (0.6 + 0.4 * fx.life), 0.42 * k * (0.75 + 0.25 * fx.life) * breathe);
        dome.position.y = 0.02 + (fx.state === 'in' ? (1 - k) * 0.3 : 0);
        const a = clamp01(fx.t * 1.5);
        domeMat.uniforms.t.value = el + seed;
        domeMat.uniforms.density.value = thin * a;
        stainMat.uniforms.t.value = el + seed;
        stainMat.uniforms.density.value = thin * a;
        stain.scale.setScalar(SQUARE * (0.6 + 0.42 * clamp01(fx.t * 1.3)));
      },
    };
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

function lifeOf(turnsLeft: number): number {
  return clamp01(turnsLeft / MAX_TURNS);
}
