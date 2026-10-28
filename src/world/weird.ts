/**
 * Weird Mode visuals. Every effect is cosmetic, runs on world time (so it pauses with the world),
 * and resolves its promise when it is fully over. Playing the same kind again restarts it.
 */
import * as THREE from 'three';
import type { Square, WeirdEvent, WeirdEventKind } from '../contracts/types';
import { type Animator, type Handle, clamp01, ease, lerp } from './anim';
import type { Board } from './board';
import type { CameraRig } from './camera';
import { BOARD_TOP, FRAME_W, PALETTE } from './constants';
import { squareToXZ, xzToSquare } from './coords';
import { type Diorama, WATER_Y } from './diorama';
import type { Bin, Materials } from './kit';
import type { Textures } from './textures';

export interface WeirdContext {
  scene: THREE.Scene;
  board: Board;
  diorama: Diorama;
  rig: CameraRig;
  animator: Animator;
  bin: Bin;
  mats: Materials;
  tex: Textures;
  reducedMotion: () => boolean;
  quality: () => 'high' | 'low';
}

/** Rises 0 -> 1 over `inT`, holds, falls back over `outT`. */
function envelope(t: number, inT: number, hold: number, outT: number, easeIn = ease.cubicOut, easeOut = ease.sineInOut): number {
  if (t < inT) return easeIn(clamp01(t / inT));
  if (t < inT + hold) return 1;
  return 1 - easeOut(clamp01((t - inT - hold) / outT));
}

export class WeirdEffects {
  /** World-space effect objects (disco ball, beams, fog puffs). */
  readonly root = new THREE.Group();
  private running = new Map<WeirdEventKind, Handle>();
  private prewarm: THREE.Object3D[] = [];
  private fogPuffs: THREE.Sprite[] = [];
  private disco: { ball: THREE.Group; beams: THREE.Mesh[]; spots: THREE.Mesh[] };
  private tide: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private pigeon: Pigeon;
  private baseFog = { near: 34, far: 110 };

  constructor(private c: WeirdContext) {
    this.root.name = 'weird';
    this.root.userData.noPick = true;
    c.scene.add(this.root);
    this.buildFog();
    this.disco = this.buildDisco();
    this.tide = this.buildTide();
    this.pigeon = new Pigeon(c.bin, c.mats);
    this.pigeon.group.visible = false;
    c.board.group.add(this.pigeon.group);
    this.prewarm.push(this.pigeon.group);
  }

  /** Show every effect object (for shader compile before the first reveal) or hide them again. */
  setPrewarm(on: boolean): void {
    for (const o of this.prewarm) o.visible = on;
  }

  play(e: WeirdEvent): Promise<void> {
    this.running.get(e.kind)?.cancel(true);
    let h: Handle;
    switch (e.kind) {
      case 'tilt': h = this.tilt(); break;
      case 'fog': h = this.fog(); break;
      case 'gravityHop': h = this.hop(); break;
      case 'pigeonPeek': h = this.pigeonPeek(e.squares); break;
      case 'tideSwap': h = this.tideSwap(); break;
      case 'disco': h = this.discoParty(); break;
      default: return Promise.resolve();
    }
    this.running.set(e.kind, h);
    return h.done.then(() => {
      if (this.running.get(e.kind) === h) this.running.delete(e.kind);
    });
  }

  stopAll(): void {
    for (const h of this.running.values()) h.cancel(true);
    this.running.clear();
  }

  // ---------- tilt: the board wobbles like a jelly plate ----------
  private tilt(): Handle {
    const g = this.c.board.group;
    const reduced = this.c.reducedMotion();
    const amp = reduced ? 0.035 : 0.1;
    const dur = reduced ? 1.6 : 3.0;
    let t = 0;
    const reset = () => {
      g.rotation.set(0, 0, 0);
      g.position.y = 0;
    };
    return this.c.animator.process((dt) => {
      t += dt;
      const u = clamp01(t / dur);
      const ramp = ease.cubicOut(clamp01(t / 0.3));
      const decay = Math.pow(1 - u, 1.6) * ramp;
      g.rotation.z = amp * Math.sin(t * Math.PI * 2 * 0.85) * decay;
      g.rotation.x = amp * 0.6 * Math.sin(t * Math.PI * 2 * 0.65 + 1.2) * decay;
      g.position.y = 0.28 * Math.sin(Math.PI * u) * ramp;
      if (u >= 1) reset();
      return u >= 1;
    }, reset);
  }

  // ---------- fog: a sea mist rolls in over the board ----------
  private buildFog(): void {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const mat = this.c.bin.add(new THREE.SpriteMaterial({ map: this.c.tex.softDisc, color: '#fff3e6', transparent: true, opacity: 0, depthWrite: false, fog: false }));
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.userData.seed = Math.random() * 100;
      this.fogPuffs.push(s);
      this.root.add(s);
      this.prewarm.push(s);
    }
  }

  private fog(): Handle {
    const fog = this.c.scene.fog as THREE.Fog;
    const sky = this.c.diorama.sky.material.uniforms;
    const puffs = this.fogPuffs.slice(0, this.c.quality() === 'high' ? 18 : 9);
    puffs.forEach((p, i) => {
      p.position.set(lerp(-9, 9, (i + Math.random()) / puffs.length), 0.6 + Math.random() * 1.2, -11 - Math.random() * 5);
      p.scale.setScalar(3.2 + Math.random() * 2.4);
      p.visible = true;
    });
    const inT = 1.6, hold = 4.4, outT = 2.2;
    let t = 0;
    const restore = () => {
      fog.near = this.baseFog.near;
      fog.far = this.baseFog.far;
      sky.fogMix.value = 0;
      for (const p of this.fogPuffs) {
        p.visible = false;
        p.material.opacity = 0;
      }
    };
    return this.c.animator.process((dt, el) => {
      t += dt;
      const k = envelope(t, inT, hold, outT);
      fog.near = lerp(this.baseFog.near, 10, k);
      fog.far = lerp(this.baseFog.far, 34, k);
      sky.fogMix.value = 0.7 * k;
      for (const p of puffs) {
        const seed = p.userData.seed as number;
        // Roll in from the sea, drift across, then thin out.
        p.position.z += dt * (1.6 + Math.sin(seed) * 0.5) * (t < inT + hold ? 1.6 : 0.7);
        if (p.position.z > 10) p.position.z -= 20;
        p.position.x += Math.sin(el * 0.6 + seed) * dt * 0.4;
        p.material.opacity = 0.38 * k * clamp01((p.position.z + 12) / 4);
      }
      if (t >= inT + hold + outT) restore();
      return t >= inT + hold + outT;
    }, restore);
  }

  // ---------- gravityHop: every piece bounces ----------
  private hop(): Handle {
    const layer = this.c.board.pieceLayer;
    const hops = this.c.reducedMotion() ? [0.12] : [0.6, 0.3, 0.13];
    const times = hops.map((h) => 0.26 + h * 0.5);
    let i = 0, t = 0;
    return this.c.animator.process((dt) => {
      t += dt;
      while (i < hops.length && t >= times[i]) {
        t -= times[i];
        this.c.rig.shake(hops[i] * 0.35);
        i++;
      }
      if (i >= hops.length) {
        layer.position.y = 0;
        return true;
      }
      const u = t / times[i];
      layer.position.y = hops[i] * 4 * u * (1 - u);
      return false;
    }, () => (layer.position.y = 0));
  }

  // ---------- pigeonPeek: a pigeon drops in, sits on a piece, leaves ----------
  private pigeonPeek(squares?: Square[]): Handle {
    const board = this.c.board;
    const occupied = board.pieceLayer.children.filter((o) => o.visible && !o.userData.noPick);
    let sq: Square | null = squares?.[0] ?? null;
    if (!sq && occupied.length) {
      const o = occupied[Math.floor(Math.random() * occupied.length)];
      sq = xzToSquare(o.position.x, o.position.z);
    }
    sq ??= 'e4';
    // Land on top of the piece standing there, or on the square.
    const { x, z } = squareToXZ(sq);
    let top = BOARD_TOP;
    const piece = board.pieceLayer.children.find((o) => o.visible && xzToSquare(o.position.x, o.position.z) === sq);
    if (piece) {
      const box = new THREE.Box3().setFromObject(piece);
      if (!box.isEmpty()) {
        const local = board.pieceLayer.worldToLocal(new THREE.Vector3(0, box.max.y, 0));
        top = Math.max(BOARD_TOP, local.y + board.pieceLayer.position.y);
      }
    }
    const land = new THREE.Vector3(x, top, z);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const from = new THREE.Vector3(x + dir * 8, top + 5, z - 4);
    const to = new THREE.Vector3(x - dir * 8, top + 6, z + 3);
    return this.pigeon.visit(this.c.animator, from, land, to, this.c.reducedMotion());
  }

  // ---------- tideSwap: the sea washes over the beach squares ----------
  private buildTide(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const w = 8 + FRAME_W * 2 - 0.1, d = 4 + FRAME_W - 0.05;
    const mat = this.c.bin.add(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        t: { value: 0 },
        front: { value: 0 },
        alpha: { value: 0 },
        deep: { value: new THREE.Color(PALETTE.waterDeep) },
        shallow: { value: new THREE.Color(PALETTE.waterShallow) },
      },
      vertexShader: /* glsl */ `
        uniform float t; varying vec2 vUv; varying float vH;
        void main() {
          vUv = uv; vec3 p = position;
          float h = sin(p.x * 2.1 + t * 2.2) * 0.025 + sin(p.y * 3.0 - t * 2.6) * 0.02;
          p.z += h; vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float t; uniform float front; uniform float alpha; uniform vec3 deep; uniform vec3 shallow;
        varying vec2 vUv; varying float vH;
        void main() {
          float d = 1.0 - vUv.y; // 0 at the Sea edge of the board, 1 at the middle line
          float edge = front + 0.035 * sin(vUv.x * 26.0 + t * 3.0) + 0.02 * sin(vUv.x * 9.0 - t * 1.7);
          if (d > edge) discard;
          vec3 c = mix(deep, shallow, smoothstep(0.0, max(edge, 0.01), d) * 0.85 + 0.15);
          float foam = smoothstep(edge - 0.06, edge, d);
          float ripple = smoothstep(0.93, 1.0, sin(d * 48.0 - t * 4.0 + sin(vUv.x * 10.0) * 1.5)) * 0.35;
          c = mix(c, vec3(1.0), max(foam, ripple));
          c += vH * 2.0;
          gl_FragColor = vec4(c, alpha * mix(0.62, 0.95, foam));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    const geo = this.c.bin.add(new THREE.PlaneGeometry(w, d, 64, 24));
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, BOARD_TOP + 0.05, -d / 2 + 0.02);
    mesh.renderOrder = 3;
    mesh.visible = false;
    mesh.name = 'tide';
    this.c.board.overlay.add(mesh);
    this.prewarm.push(mesh);
    return mesh;
  }

  private tideSwap(): Handle {
    const u = this.tide.material.uniforms;
    const water = this.c.diorama.water;
    const baseY = WATER_Y;
    const inT = 1.5, hold = 1.9, outT = 1.5;
    let t = 0;
    this.tide.visible = true;
    const restore = () => {
      this.tide.visible = false;
      u.front.value = 0;
      water.position.y = baseY;
      water.material.uniforms.surge.value = 0;
    };
    return this.c.animator.process((dt, el) => {
      t += dt;
      u.t.value = el;
      let front: number;
      if (t < inT) front = ease.backOut(t / inT);
      else if (t < inT + hold) front = 1 + Math.sin((t - inT) * 3.2) * 0.04;
      else front = 1 - ease.cubicIn(clamp01((t - inT - hold) / outT));
      u.front.value = Math.max(0, front * 1.02);
      u.alpha.value = clamp01(front * 4);
      const k = envelope(t, 0.8, inT + hold - 0.8, outT);
      water.position.y = baseY + 0.07 * k;
      water.material.uniforms.surge.value = 0.06 * k;
      if (t >= inT + hold + outT) restore();
      return t >= inT + hold + outT;
    }, restore);
  }

  // ---------- disco: lights down, mirror ball, coloured spotlights ----------
  private buildDisco() {
    const ball = new THREE.Group();
    ball.name = 'discoBall';
    const sphere = new THREE.Mesh(
      this.c.bin.add(new THREE.IcosahedronGeometry(0.48, 2)),
      this.c.bin.add(new THREE.MeshStandardMaterial({ color: '#e8ecf4', metalness: 1, roughness: 0.12, flatShading: true, emissive: '#3a3550', emissiveIntensity: 0.6 })),
    );
    const string = new THREE.Mesh(this.c.bin.add(new THREE.CylinderGeometry(0.01, 0.01, 8, 4).translate(0, 4.4, 0)), this.c.mats.get('#555555', 'matte'));
    ball.add(sphere, string);
    ball.visible = false;
    this.root.add(ball);
    this.prewarm.push(ball);

    const beamGeo = this.c.bin.add(new THREE.ConeGeometry(0.75, 1, 24, 1, true).translate(0, -0.5, 0));
    const beams: THREE.Mesh[] = [];
    const spots: THREE.Mesh[] = [];
    const spotGeo = this.c.bin.add(new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2));
    for (let i = 0; i < 5; i++) {
      const mat = this.c.bin.add(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { color: { value: new THREE.Color() }, alpha: { value: 0 } },
        vertexShader: /* glsl */ `varying float vY; void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 color; uniform float alpha; varying float vY;
          void main() {
            float a = alpha * mix(0.05, 0.4, smoothstep(-1.0, 0.0, vY));
            gl_FragColor = vec4(color * a, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }));
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.visible = false;
      beam.frustumCulled = false;
      beam.renderOrder = 4;
      this.root.add(beam);
      beams.push(beam);
      this.prewarm.push(beam);

      const spotMat = this.c.bin.add(new THREE.MeshBasicMaterial({ map: this.c.tex.softDisc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      const spot = new THREE.Mesh(spotGeo, spotMat);
      spot.visible = false;
      spot.renderOrder = 3;
      this.c.board.overlay.add(spot);
      spots.push(spot);
      this.prewarm.push(spot);
    }
    return { ball, beams, spots };
  }

  /** Phase 3 Wheel of Chaos: the same party, squeezed into about 1.5s (no slow lights-down). */
  discoFlash(): Handle {
    this.running.get('disco')?.cancel(true);
    return this.discoParty({ inT: 0.3, hold: 0.85, outT: 0.35, quick: true });
  }

  private discoParty(timing = { inT: 0.9, hold: 5.6, outT: 1.1, quick: false }): Handle {
    const { ball, beams, spots } = this.disco;
    const d = this.c.diorama;
    const scene = this.c.scene;
    const sq = this.c.board.squares;
    const base = this.c.board.baseColors;
    const sky = d.sky.material.uniforms;
    const nightTint = new THREE.Color(0.32, 0.27, 0.5);
    const white = new THREE.Color(1, 1, 1);
    const reduced = this.c.reducedMotion();
    const { inT, hold, outT, quick } = timing;
    let t = 0;
    const col = new THREE.Color();
    const tmp = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0), target = new THREE.Vector3();
    ball.visible = true;
    beams.forEach((b) => (b.visible = true));
    spots.forEach((s) => (s.visible = true));

    const restore = () => {
      d.sun.intensity = d.base.sun;
      d.hemi.intensity = d.base.hemi;
      d.fill.intensity = d.base.fill;
      scene.environmentIntensity = d.base.env;
      sky.tint.value.copy(white);
      d.water.material.uniforms.tint.value.copy(white);
      ball.visible = false;
      ball.scale.setScalar(1);
      beams.forEach((b) => (b.visible = false));
      spots.forEach((s) => (s.visible = false));
      for (let i = 0; i < 64; i++) sq.setColorAt(i, base[i]);
      sq.instanceColor!.needsUpdate = true;
    };

    return this.c.animator.process((dt, el) => {
      t += dt;
      const k = envelope(t, inT, hold, outT);
      d.sun.intensity = lerp(d.base.sun, d.base.sun * 0.12, k);
      d.hemi.intensity = lerp(d.base.hemi, d.base.hemi * 0.3, k);
      d.fill.intensity = lerp(d.base.fill, d.base.fill * 0.25, k);
      scene.environmentIntensity = lerp(d.base.env, d.base.env * 0.3, k);
      sky.tint.value.copy(white).lerp(nightTint, k);
      d.water.material.uniforms.tint.value.copy(white).lerp(nightTint, k * 0.7);

      // Mirror ball drops in and spins.
      const ballY = quick
        ? 4.6 + (t > inT + hold ? (t - inT - hold) * 8 : 0)
        : lerp(9.5, 4.6, ease.backOut(clamp01(t / 1.1))) + (t > inT + hold ? (t - inT - hold) * 6 : 0);
      ball.position.set(0, ballY, 0);
      if (quick) ball.scale.setScalar(Math.max(0.001, ease.backOut(clamp01(t / inT))));
      ball.rotation.y += dt * (reduced ? 0.6 : 1.6);

      const beat = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(el * Math.PI * 4); // ~120 bpm
      beams.forEach((beam, i) => {
        const hue = (el * 0.12 + i / beams.length) % 1;
        col.setHSL(hue, 1, 0.55);
        const speed = reduced ? 0.35 : 1;
        target.set(Math.sin(el * 0.9 * speed + i * 1.3) * 3, BOARD_TOP, Math.cos(el * 0.7 * speed + i * 2.1) * 3);
        tmp.copy(target).sub(ball.position);
        const len = tmp.length();
        beam.position.copy(ball.position);
        beam.quaternion.setFromUnitVectors(down, tmp.normalize());
        beam.scale.set(1, len, 1);
        const m = beam.material as THREE.ShaderMaterial;
        m.uniforms.color.value.copy(col);
        m.uniforms.alpha.value = k * (0.75 + 0.25 * beat);
        const spot = spots[i];
        spot.position.set(target.x, BOARD_TOP + 0.015, target.z);
        const sm = spot.material as THREE.MeshBasicMaterial;
        sm.color.copy(col).multiplyScalar(1.6);
        sm.opacity = k * (0.7 + 0.3 * beat);
      });

      // Light-up dance floor.
      for (let i = 0; i < 64; i++) {
        const f = Math.floor(i / 8), r = i % 8;
        const pulse = Math.max(0, Math.sin(el * 3.1 + f * 1.7 + r * 2.3) * Math.sin(el * 1.3 + r * 0.9 - f * 0.4));
        col.setHSL((el * 0.1 + (f + r) / 16) % 1, 0.9, 0.6);
        sq.setColorAt(i, col.lerp(base[i], 1 - k * pulse * 0.55));
      }
      sq.instanceColor!.needsUpdate = true;

      const done = t >= inT + hold + outT;
      if (done) restore();
      return done;
    }, restore);
  }

  dispose(): void {
    this.stopAll();
    this.root.removeFromParent();
  }
}

/** A plump code-built pigeon with flapping wings and a bobbing head. */
export class Pigeon {
  readonly group = new THREE.Group();
  /** At the pigeon's feet: a carried piece hangs from here and swings. */
  private hook = new THREE.Group();
  /** At the beak tip: a snatched treasure (Phase 4) is held here. */
  private beakHold = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private wingL = new THREE.Group();
  private wingR = new THREE.Group();

  constructor(bin: Bin, mats: Materials) {
    this.group.name = 'pigeon';
    this.group.userData.noPick = true;
    const grey = mats.get('#9aa3b5', 'toy');
    const light = mats.get('#c4cad6', 'toy');
    const neck = mats.get('#5fae8e', 'gloss');
    const orange = mats.get('#ff8a3d', 'gloss');
    const black = mats.get('#151515', 'gloss');
    const sphere = bin.add(new THREE.SphereGeometry(1, 18, 14));

    const torso = new THREE.Mesh(sphere, light);
    torso.scale.set(0.16, 0.15, 0.22);
    torso.position.y = 0.17;
    const collar = new THREE.Mesh(sphere, neck);
    collar.scale.set(0.11, 0.09, 0.1);
    collar.position.set(0, 0.27, 0.1);
    const tail = new THREE.Mesh(bin.add(new THREE.BoxGeometry(0.16, 0.025, 0.18)), grey);
    tail.position.set(0, 0.17, -0.25);
    tail.rotation.x = -0.35;
    const legGeo = bin.add(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 5));
    for (const sx of [-0.05, 0.05]) {
      const leg = new THREE.Mesh(legGeo, orange);
      leg.position.set(sx, 0.04, 0.02);
      this.body.add(leg);
    }
    this.body.add(torso, collar, tail);

    const headBall = new THREE.Mesh(sphere, grey);
    headBall.scale.setScalar(0.085);
    const beak = new THREE.Mesh(bin.add(new THREE.ConeGeometry(0.022, 0.07, 8).rotateX(Math.PI / 2)), orange);
    beak.position.set(0, -0.01, 0.1);
    const eyeGeo = bin.add(new THREE.SphereGeometry(0.016, 8, 6));
    for (const sx of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(eyeGeo, black);
      eye.position.set(sx, 0.02, 0.055);
      this.head.add(eye);
    }
    // The pigeon flies at 2.6x; this keeps a held treasure at about 80% of its board size.
    this.beakHold.position.set(0, -0.03, 0.15);
    this.beakHold.scale.setScalar(0.8 / 2.6);
    this.head.add(headBall, beak, this.beakHold);
    this.head.position.set(0, 0.36, 0.12);
    this.body.add(this.head);

    const wingGeo = bin.add(new THREE.SphereGeometry(1, 12, 8).scale(0.2, 0.025, 0.12));
    const wl = new THREE.Mesh(wingGeo, grey);
    wl.position.x = -0.18;
    this.wingL.add(wl);
    this.wingL.position.set(-0.1, 0.22, 0);
    const wr = new THREE.Mesh(wingGeo, grey);
    wr.position.x = 0.18;
    this.wingR.add(wr);
    this.wingR.position.set(0.1, 0.22, 0);
    this.body.add(this.wingL, this.wingR);
    this.group.add(this.body, this.hook);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  /**
   * Phase 3 Wheel of Chaos: fly in to `land` (on top of `cargo`), grab it by reparenting it to the pigeon,
   * and fly off with it, wobbling. With no cargo it just flies past through `land`.
   * The cargo is detached (removeFromParent, never disposed) before the handle resolves, also when cancelled.
   */
  carry(animator: Animator, from: THREE.Vector3, land: THREE.Vector3, to: THREE.Vector3, cargo: THREE.Object3D | null, reduced: boolean): Handle {
    const g = this.group;
    const flyIn = 0.75, grab = cargo ? 0.35 : 0, flyOut = reduced ? 0.8 : 0.95;
    const total = cargo ? flyIn + grab + flyOut : 1.6;
    const ctrlIn = from.clone().lerp(land, 0.5).add(new THREE.Vector3(0, 2.2, 0));
    const ctrlOut = land.clone().lerp(to, 0.5).add(new THREE.Vector3(0, cargo ? 0.5 : 2, 0));
    const ctrlPast = land.clone().multiplyScalar(2).sub(from.clone().add(to).multiplyScalar(0.5));
    const bez = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3) =>
      out.set(0, 0, 0).addScaledVector(a, (1 - u) ** 2).addScaledVector(c, 2 * (1 - u) * u).addScaledVector(b, u * u);
    const prev = new THREE.Vector3();
    const wobble = reduced ? 0.25 : 1;
    let grabbed = false;
    let t = 0;
    g.visible = true;
    g.position.copy(from);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(2.6);
    const end = () => {
      cargo?.removeFromParent();
      g.visible = false;
      g.rotation.set(0, 0, 0);
      this.hook.rotation.set(0, 0, 0);
      this.body.scale.set(1, 1, 1);
    };
    return animator.process((dt, el) => {
      t += dt;
      prev.copy(g.position);
      let flapping = true;
      if (!cargo) {
        bez(from, ctrlPast, to, ease.sineInOut(clamp01(t / total)), g.position);
      } else if (t < flyIn) {
        bez(from, ctrlIn, land, ease.cubicOut(t / flyIn), g.position);
      } else if (t < flyIn + grab) {
        // Land, squash, clamp on, then a heave upward.
        const s = t - flyIn;
        flapping = s > grab * 0.45;
        const squash = Math.exp(-s * 10) * Math.sin(s * 34) * 0.18;
        this.body.scale.set(1 + squash, 1 - squash, 1 + squash);
        g.position.copy(land);
        if (s > grab * 0.35 && !grabbed) {
          grabbed = true;
          this.hook.attach(cargo);
        }
        g.position.y += ease.cubicIn(clamp01((s - grab * 0.45) / (grab * 0.55))) * 0.25;
      } else {
        this.body.scale.set(1, 1, 1);
        const u = clamp01((t - flyIn - grab) / flyOut);
        bez(land.clone().setY(land.y + 0.25), ctrlOut, to, ease.cubicIn(u), g.position);
        // Heavy load: the pigeon rolls side to side and the cargo swings under it.
        g.rotation.z = Math.sin(el * 9) * 0.22 * wobble;
        this.hook.rotation.z = Math.sin(el * 6.5 + 1) * 0.3 * wobble;
        this.hook.rotation.x = Math.sin(el * 4.3) * 0.18 * wobble;
      }
      if (flapping) {
        const flap = Math.sin(el * (grabbed ? 38 : 28)) * 0.95;
        this.wingL.rotation.z = flap;
        this.wingR.rotation.z = -flap;
        const v = g.position.clone().sub(prev);
        if (v.x * v.x + v.z * v.z > 1e-6) g.rotation.y = Math.atan2(v.x, v.z);
      } else {
        this.wingL.rotation.z = 0.5;
        this.wingR.rotation.z = -0.5;
      }
      const done = t >= total;
      if (done) end();
      return done;
    }, end);
  }

  /**
   * Phase 4 Raid snatch: fly in to `grabAt`, take the treasure in the beak (`hooks.grab` hands over a copy and hides the
   * one on the board), fly over to `dropAt`, let go (`hooks.drop` puts it on its new square) and fly off.
   * `perch` = it lands to peck the treasure off the ground; else it hovers (snatching it from a carrier's mouth).
   * Cancelling finishes it: the treasure is always dropped and the beak emptied before the handle resolves.
   */
  snatch(
    animator: Animator, from: THREE.Vector3, grabAt: THREE.Vector3, dropAt: THREE.Vector3, to: THREE.Vector3, perch: boolean,
    hooks: { grab: () => THREE.Object3D | null; drop: () => void }, reduced: boolean,
  ): Handle {
    const g = this.group;
    const flyIn = 0.75, grab = perch ? 0.45 : 0.3, carry = reduced ? 0.7 : 0.95, flyOut = 0.8;
    const total = flyIn + grab + carry + flyOut;
    const up = grabAt.clone().setY(grabAt.y + 0.3);
    const ctrlIn = from.clone().lerp(grabAt, 0.5).add(new THREE.Vector3(0, 2.2, 0));
    const ctrlCarry = up.clone().lerp(dropAt, 0.5).add(new THREE.Vector3(0, 1.1, 0));
    const ctrlOut = dropAt.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 1.5, 0));
    const bez = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3) =>
      out.set(0, 0, 0).addScaledVector(a, (1 - u) ** 2).addScaledVector(c, 2 * (1 - u) * u).addScaledVector(b, u * u);
    const prev = new THREE.Vector3();
    let cargo: THREE.Object3D | null = null;
    let grabbed = false, dropped = false;
    let t = 0;
    g.visible = true;
    g.position.copy(from);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(2.6);
    const release = () => {
      if (dropped) return;
      dropped = true;
      cargo?.removeFromParent();
      cargo = null;
      hooks.drop();
    };
    const end = () => {
      if (!grabbed) {
        grabbed = true;
        hooks.grab();
      }
      release();
      g.visible = false;
      g.rotation.set(0, 0, 0);
      this.head.rotation.set(0, 0, 0);
      this.body.scale.set(1, 1, 1);
    };
    return animator.process((dt, el) => {
      t += dt;
      prev.copy(g.position);
      let flapping = true;
      if (t < flyIn) {
        bez(from, ctrlIn, grabAt, ease.cubicOut(t / flyIn), g.position);
      } else if (t < flyIn + grab) {
        const s = t - flyIn;
        g.position.copy(grabAt);
        if (perch) {
          // Land with a squash and peck it up.
          flapping = false;
          const squash = Math.exp(-s * 10) * Math.sin(s * 34) * 0.15;
          this.body.scale.set(1 + squash, 1 - squash, 1 + squash);
          this.head.rotation.x = Math.sin(Math.PI * clamp01(s / (grab * 0.7))) * 0.9;
        } else {
          g.position.y += Math.sin(s * 14) * 0.03;
        }
        if (!grabbed && s > grab * 0.4) {
          grabbed = true;
          cargo = hooks.grab();
          if (cargo) {
            this.beakHold.add(cargo);
            cargo.rotation.set(0, 0, 0);
          }
        }
      } else if (t < flyIn + grab + carry) {
        this.body.scale.set(1, 1, 1);
        this.head.rotation.x = 0;
        const u = clamp01((t - flyIn - grab) / carry);
        bez(grabAt, ctrlCarry, dropAt, ease.sineInOut(u), g.position);
        g.rotation.z = Math.sin(el * 8) * 0.12 * (reduced ? 0.25 : 1);
        if (cargo) cargo.rotation.z = Math.sin(el * 7) * 0.25 * (reduced ? 0.25 : 1);
      } else {
        release();
        g.rotation.z = 0;
        const u = clamp01((t - flyIn - grab - carry) / flyOut);
        bez(dropAt, ctrlOut, to, ease.cubicIn(u), g.position);
      }
      if (flapping) {
        const flap = Math.sin(el * 30) * 0.95;
        this.wingL.rotation.z = flap;
        this.wingR.rotation.z = -flap;
        const v = g.position.clone().sub(prev);
        if (v.x * v.x + v.z * v.z > 1e-6) g.rotation.y = Math.atan2(v.x, v.z);
      } else {
        this.wingL.rotation.z = 0.5;
        this.wingR.rotation.z = -0.5;
      }
      const done = t >= total;
      if (done) end();
      return done;
    }, end);
  }

  visit(animator: Animator, from: THREE.Vector3, land: THREE.Vector3, to: THREE.Vector3, reduced: boolean): Handle {
    const g = this.group;
    const flyIn = reduced ? 1.6 : 1.3, sit = 2.2, flyOut = 1.2;
    const ctrlIn = from.clone().lerp(land, 0.5).add(new THREE.Vector3(0, 2.5, 0));
    const ctrlOut = land.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 1.5, 0));
    const bez = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3) =>
      out.set(0, 0, 0).addScaledVector(a, (1 - u) ** 2).addScaledVector(c, 2 * (1 - u) * u).addScaledVector(b, u * u);
    const prev = new THREE.Vector3();
    let t = 0;
    g.visible = true;
    g.position.copy(from);
    g.scale.setScalar(1.6);
    const hide = () => {
      g.visible = false;
      this.body.scale.set(1, 1, 1);
    };
    return animator.process((dt, el) => {
      t += dt;
      prev.copy(g.position);
      let flapping = true;
      if (t < flyIn) {
        bez(from, ctrlIn, land, ease.cubicOut(t / flyIn), g.position);
      } else if (t < flyIn + sit) {
        flapping = false;
        const s = t - flyIn;
        g.position.copy(land);
        // Landing squash, then head bobs and a look around.
        const squash = Math.exp(-s * 8) * Math.sin(s * 30) * 0.15;
        this.body.scale.set(1 + squash, 1 - squash, 1 + squash);
        this.head.position.z = 0.12 + Math.max(0, Math.sin(s * 9)) * 0.04;
        this.head.rotation.y = Math.sin(s * 1.7) * 0.7;
        // Face the camera-ish side while sitting.
        g.rotation.y += (Math.sin(s * 0.8) * 0.6 - g.rotation.y) * Math.min(1, dt * 4);
      } else {
        const u = clamp01((t - flyIn - sit) / flyOut);
        bez(land, ctrlOut, to, ease.cubicIn(u), g.position);
      }
      if (flapping) {
        const flap = Math.sin(el * 28) * 0.9;
        this.wingL.rotation.z = flap;
        this.wingR.rotation.z = -flap;
        const v = g.position.clone().sub(prev);
        if (v.lengthSq() > 1e-6) g.rotation.y = Math.atan2(v.x, v.z);
      } else {
        this.wingL.rotation.z = 0.1;
        this.wingR.rotation.z = -0.1;
      }
      const done = t >= flyIn + sit + flyOut;
      if (done) hide();
      return done;
    }, hide);
  }
}

