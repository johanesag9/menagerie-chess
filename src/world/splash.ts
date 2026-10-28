/**
 * Splashes (Phase 4): an animal falling in, a treasure flying home. Each splash is a jagged water crown
 * that shoots up and collapses, a ring ripple on the surface, and droplets (from the shared particle system).
 * A few splashes are pooled, so a ring of animals falling at once costs no new materials or draw-call spikes.
 * `big` (a king) is taller and wider. Reduced motion: a small crown, the ripple, a few droplets.
 */
import * as THREE from 'three';
import { clamp01, ease } from './anim';
import { PALETTE } from './constants';
import type { Particles } from './chaos';
import type { Bin } from './kit';

const POOL = 4;
const DURATION = { normal: 0.95, big: 1.15, reduced: 0.7 } as const;

interface Slot {
  root: THREE.Group;
  crown: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  ripple: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  t: number;
  duration: number;
  busy: boolean;
  started: number;
}

/** An open cylinder whose top edge is a ring of spikes (the crown), radius 1, height 1. */
function crownGeometry(): THREE.BufferGeometry {
  const spikes = 14, n = spikes * 2;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const top = i % 2 === 0 ? 1 : 0.55 + 0.1 * Math.sin(i * 1.7);
    pos.push(Math.cos(a), 0, Math.sin(a), Math.cos(a), top, Math.sin(a));
    uv.push(i / n, 0, i / n, top);
  }
  for (let i = 0; i < n; i++) {
    const b = i * 2;
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const CROWN_VERT = /* glsl */ `
  uniform float p; uniform float height; uniform float radius;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 q = position;
    // Up fast, then collapse; the wall flares outward toward the top as it rises.
    float up = sin(3.14159 * clamp(p * 1.15, 0.0, 1.0));
    float r = radius * (0.35 + 0.65 * (1.0 - pow(1.0 - p, 3.0))) * (1.0 + q.y * 0.55 * up);
    q.xz *= r;
    q.y *= height * up;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
  }`;

const CROWN_FRAG = /* glsl */ `
  uniform float p; uniform vec3 water; varying vec2 vUv;
  void main() {
    float y = vUv.y;
    vec3 c = mix(water, vec3(1.0), smoothstep(0.15, 0.8, y));
    float streak = 0.75 + 0.25 * sin(vUv.x * 90.0 + y * 6.0);
    float a = (1.0 - smoothstep(0.55, 1.0, p)) * mix(0.55, 0.95, y) * streak;
    if (a < 0.01) discard;
    gl_FragColor = vec4(c, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const RIPPLE_FRAG = /* glsl */ `
  uniform float p; varying vec2 vUv;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float r1 = p, r2 = p * 0.62;
    float ring = smoothstep(0.07, 0.0, abs(r - r1)) + 0.7 * smoothstep(0.05, 0.0, abs(r - r2));
    float inner = (1.0 - smoothstep(0.0, r1, r)) * 0.18;
    float a = (ring + inner) * (1.0 - p) * (1.0 - p);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(1.0), min(a, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Splashes {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private time = 0;
  private tmp = new THREE.Vector3();

  constructor(bin: Bin, private parent: THREE.Object3D, private particles: Particles, private reducedMotion: () => boolean) {
    this.group.name = 'splashes';
    this.group.userData.noPick = true;
    const crownGeo = bin.add(crownGeometry());
    const rippleGeo = bin.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const crownMat = bin.add(new THREE.ShaderMaterial({
      uniforms: { p: { value: 0.3 }, height: { value: 0.6 }, radius: { value: 0.3 }, water: { value: new THREE.Color(PALETTE.waterShallow) } },
      vertexShader: CROWN_VERT, fragmentShader: CROWN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    const rippleMat = bin.add(new THREE.ShaderMaterial({
      uniforms: { p: { value: 0.3 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: RIPPLE_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    for (let i = 0; i < POOL; i++) {
      const root = new THREE.Group();
      root.name = 'splash';
      // Clones share one compiled program; each slot just needs its own uniforms.
      const crown = new THREE.Mesh(crownGeo, i === 0 ? crownMat : bin.add(crownMat.clone()));
      crown.renderOrder = 4;
      crown.frustumCulled = false;
      const ripple = new THREE.Mesh(rippleGeo, i === 0 ? rippleMat : bin.add(rippleMat.clone()));
      ripple.position.y = 0.005;
      ripple.renderOrder = 3;
      root.add(ripple, crown);
      root.visible = false;
      this.group.add(root);
      this.slots.push({ root, crown, ripple, t: 0, duration: 1, busy: false, started: 0 });
    }
  }

  setPrewarm(on: boolean): void {
    const s = this.slots[0];
    if (s.busy) return;
    s.root.visible = on;
    s.root.position.set(0, 0.4, 0);
  }

  /** `point` is world space. */
  play(point: THREE.Vector3, big = false): void {
    const reduced = this.reducedMotion();
    const free = this.slots.find((s) => !s.busy) ?? this.slots.reduce((a, b) => (a.started <= b.started ? a : b));
    const local = this.parent.worldToLocal(this.tmp.copy(point));
    const k = big ? 1.6 : 1;
    free.busy = true;
    free.t = 0;
    free.started = this.time;
    free.duration = reduced ? DURATION.reduced : big ? DURATION.big : DURATION.normal;
    free.root.position.copy(local);
    free.root.visible = true;
    const cu = free.crown.material.uniforms;
    cu.height.value = (reduced ? 0.28 : 0.62) * k;
    cu.radius.value = 0.26 * k;
    free.crown.visible = true;
    free.ripple.scale.setScalar(1.6 * k);

    const n = reduced ? 4 : big ? 34 : 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = (0.5 + Math.random() * 1.1) * k;
      this.particles.emit({
        x: local.x + Math.cos(a) * 0.2 * k, y: local.y + 0.05, z: local.z + Math.sin(a) * 0.2 * k,
        vx: Math.cos(a) * out, vy: (reduced ? 1.2 : 2 + Math.random() * 1.6) * Math.sqrt(k), vz: Math.sin(a) * out,
        life: 0.9, size: [0.1 * k, 0.05 * k], color: Math.random() < 0.6 ? '#ffffff' : PALETTE.waterShallow, alpha: 0.95,
        gravity: -9, drag: 0.3, floor: local.y - 0.02,
      });
    }
    if (!reduced) {
      for (let i = 0; i < (big ? 8 : 4); i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.emit({
          x: local.x + Math.cos(a) * 0.15, y: local.y + 0.08, z: local.z + Math.sin(a) * 0.15,
          vx: Math.cos(a) * 0.5, vy: 0.4, vz: Math.sin(a) * 0.5,
          life: 0.6, size: [0.3 * k, 0.55 * k], color: '#ffffff', alpha: 0.45, gravity: 0, drag: 2,
        });
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.slots) {
      if (!s.busy) continue;
      s.t += dt;
      const p = clamp01(s.t / s.duration);
      s.crown.material.uniforms.p.value = p;
      s.ripple.material.uniforms.p.value = ease.cubicOut(clamp01(s.t / (s.duration * 1.1)));
      if (p >= 1) {
        s.busy = false;
        s.root.visible = false;
      }
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.busy = false;
      s.root.visible = false;
    }
  }
}
