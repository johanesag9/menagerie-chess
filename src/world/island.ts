/**
 * Sumo island mode (Phase 4, optional in the contract): the sea rises inside the display tray until the board stands
 * alone in open water, and the meadow and beach props sink out of sight. `set(false)` drains it and brings them back.
 * The sea is one mesh (hidden when off). Tucked props are hidden once under water, so they cost no draw calls.
 */
import * as THREE from 'three';
import { clamp01, ease } from './anim';
import { BASE_D, BASE_W, FRAME_W, PALETTE, SQUARE } from './constants';
import type { Diorama } from './diorama';
import type { Bin } from './kit';

/** Sea surface in island mode: over the meadow (about 0.2) and under the tray lip (0.3) and the board rim (0.31). */
const SEA_Y = 0.255;
const LOW_Y = -0.08;
const SINK = 1.1;
const FRAME_HALF = 4 * SQUARE + FRAME_W;

const SEA_VERT = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float t; varying vec2 vP; varying float vH;
  void main() {
    vec3 p = position;
    float h = sin(p.x * 1.3 + t * 1.4) * 0.03 + sin(p.z * 2.1 - t * 1.9) * 0.025 + sin((p.x + p.z) * 3.7 + t * 2.6) * 0.01;
    p.y += h; vP = p.xz; vH = h;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const SEA_FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float t; uniform float alpha; uniform vec3 deep; uniform vec3 shallow;
  varying vec2 vP; varying float vH;
  void main() {
    // Distance from the board's frame (a rounded square) and from the tray edge.
    vec2 q = abs(vP) - vec2(${FRAME_HALF.toFixed(3)});
    float dFrame = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float dEdge = min(${(BASE_W / 2 - 0.3).toFixed(3)} - abs(vP.x), ${(BASE_D / 2 - 0.3).toFixed(3)} - abs(vP.y));
    vec3 c = mix(shallow, deep, smoothstep(0.1, 3.2, dFrame));
    float w = 0.16 + 0.05 * sin(t * 1.8 + (vP.x - vP.y) * 2.3);
    float foam = smoothstep(w, 0.0, dFrame) + smoothstep(0.18, 0.0, dEdge) * 0.8;
    float lines = smoothstep(0.93, 1.0, sin(dFrame * 9.0 - t * 2.2 + sin(vP.x * 1.7) * 1.5)) * 0.35 * (1.0 - smoothstep(0.4, 2.0, dFrame));
    float sparkle = pow(max(0.0, sin(vP.x * 47.0 + sin(vP.y * 3.1) * 4.0 + t * 3.0) * sin(vP.y * 41.0 + sin(vP.x * 2.7) * 4.0 - t * 2.2)), 60.0) * 0.45;
    c = mix(c, vec3(1.0), clamp(max(foam, lines), 0.0, 1.0));
    c += vH * 1.5 + sparkle;
    gl_FragColor = vec4(c, alpha * mix(0.93, 0.98, foam));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

interface Tuck {
  obj: THREE.Object3D;
  y: number;
  /** 0..1 start delay share: props nearer the board go under first. */
  delay: number;
  wasVisible: boolean;
}

export class IslandMode {
  readonly sea: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private tucks: Tuck[] = [];
  /** 0 = normal diorama, 1 = island. */
  private k = 0;
  private target = 0;

  constructor(bin: Bin, private diorama: Diorama, private reducedMotion: () => boolean) {
    const geo = bin.add(new THREE.PlaneGeometry(BASE_W - 0.5, BASE_D - 0.5, 90, 85).rotateX(-Math.PI / 2));
    const mat = bin.add(new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { t: { value: 0 }, alpha: { value: 1 }, deep: { value: new THREE.Color(PALETTE.waterDeep) }, shallow: { value: new THREE.Color(PALETTE.waterShallow) } },
      ]),
      vertexShader: SEA_VERT, fragmentShader: SEA_FRAG,
    }));
    this.sea = new THREE.Mesh(geo, mat);
    this.sea.name = 'island-sea';
    this.sea.position.y = LOW_Y;
    this.sea.visible = false;
    this.sea.renderOrder = 1;
    this.sea.userData.noPick = true;
    diorama.root.add(this.sea);

    // Everything on the tray goes under except the lights, sky, clouds, birds, the base itself and the old pool.
    const keep = new Set<THREE.Object3D>([diorama.sky, diorama.water, diorama.sun, diorama.sun.target, diorama.hemi, diorama.fill, this.sea]);
    for (const o of diorama.root.children) {
      if (keep.has(o) || o instanceof THREE.Light || o.name === 'ground' || o.name === 'birds' || o.position.y > 2.5) continue;
      const box = new THREE.Box3().setFromObject(o);
      const c = box.isEmpty() ? o.position : box.getCenter(new THREE.Vector3());
      const dist = Math.max(Math.abs(c.x), Math.abs(c.z)) - FRAME_HALF;
      this.tucks.push({ obj: o, y: o.position.y, delay: clamp01(dist / 6) * 0.45, wasVisible: o.visible });
    }
  }

  get on(): boolean {
    return this.target === 1;
  }

  set(on: boolean): void {
    const next = on ? 1 : 0;
    if (next === this.target) return;
    this.target = next;
    if (on) for (const t of this.tucks) t.wasVisible = t.obj.visible;
  }

  /** Show the sea for one frame (shader warm-up before reveal), or hide it again. */
  setPrewarm(on: boolean): void {
    this.sea.visible = on || this.k > 0;
  }

  update(dt: number, elapsed: number): void {
    this.sea.material.uniforms.t.value = elapsed;
    if (this.k === this.target) return;
    const dur = this.reducedMotion() ? 0.4 : 1.4;
    this.k = this.target > this.k ? Math.min(1, this.k + dt / dur) : Math.max(0, this.k - dt / dur);
    const k = this.k;
    // The sea rises over the first 70%, the props sink in a ripple outward across the whole time.
    this.sea.visible = k > 0;
    this.sea.position.y = LOW_Y + (SEA_Y - LOW_Y) * ease.sineInOut(clamp01(k / 0.7));
    this.diorama.water.visible = k < 0.75;
    for (const t of this.tucks) {
      const u = ease.cubicIn(clamp01((k - t.delay) / 0.55));
      t.obj.position.y = t.y - SINK * u;
      // Hidden once fully under; only what was showing comes back (quality hides some props).
      t.obj.visible = t.wasVisible && u < 1;
    }
  }

  dispose(): void {
    this.sea.removeFromParent();
  }
}
