/**
 * Camera: default 3/4 framing from behind the side to move, clamped orbit, side hand-off,
 * punch-in, trauma-based shake and the intro fly-in. Everything eases; nothing snaps.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Side } from '../contracts/types';
import { type Animator, type Handle, clamp01, ease, lerp } from './anim';
import { BOARD_TOP, FRAME_W, SQUARE } from './constants';

interface Pose {
  target: THREE.Vector3;
  radius: number;
  /** Angle down from straight up (three.js Spherical.phi). */
  polar: number;
  /** Angle around y, 0 = looking from +z (behind Land). */
  azimuth: number;
}

const MIN_POLAR = 0.12;
const MAX_POLAR = 1.22; // never lower than ~20 degrees above the board
const HALF_BOARD = 4 * SQUARE + FRAME_W;

export class CameraRig {
  readonly controls: OrbitControls;
  side: Side = 'land';
  private userMoved = false;
  private busy = 0;
  private trauma = 0;
  private shakeOffset = new THREE.Vector3();
  private focus: { handle: Handle; base: Pose } | null = null;
  private faceHandle: Handle | null = null;
  private introHandle: Handle | null = null;
  private fitCam = new THREE.PerspectiveCamera();
  private tmp = new THREE.Vector3();
  private sph = new THREE.Spherical();
  private corners: THREE.Vector3[] = [];

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    private animator: Animator,
    private aspect: () => number,
    private reducedMotion: () => boolean,
  ) {
    for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [BOARD_TOP - 0.1, BOARD_TOP + 1.15]) {
      this.corners.push(new THREE.Vector3(x * HALF_BOARD, y, z * HALF_BOARD));
    }
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.minPolarAngle = MIN_POLAR;
    this.controls.maxPolarAngle = MAX_POLAR;
    this.controls.addEventListener('start', () => (this.userMoved = true));
    this.applyPose(this.restPose('land'));
  }

  /** The framing for a side at the current screen shape. */
  restPose(side: Side): Pose {
    const a = clamp01((this.aspect() - 0.55) / (1.5 - 0.55)); // 0 = tall phone, 1 = wide screen
    const polar = lerp(0.66, 0.96, a);
    const azimuth = lerp(0.14, 0.55, a) + (side === 'sea' ? Math.PI : 0);
    this.camera.fov = lerp(46, 38, a);
    this.camera.updateProjectionMatrix();
    const target = new THREE.Vector3(0, BOARD_TOP, 0);
    return { target, polar, azimuth, radius: this.fitRadius(target, polar, azimuth) };
  }

  /** Smallest distance at which the whole board (with piece height) fits with room for the HUD. */
  private fitRadius(target: THREE.Vector3, polar: number, azimuth: number): number {
    const c = this.fitCam;
    c.fov = this.camera.fov;
    c.aspect = this.aspect();
    c.near = 0.1;
    c.far = 500;
    c.updateProjectionMatrix();
    for (let r = 7; r < 80; r += 0.25) {
      c.position.setFromSphericalCoords(r, polar, azimuth).add(target);
      c.lookAt(target);
      c.updateMatrixWorld();
      let ok = true;
      for (const p of this.corners) {
        const v = this.tmp.copy(p).project(c);
        if (Math.abs(v.x) > 0.8 || v.y > 0.68 || v.y < -0.74) {
          ok = false;
          break;
        }
      }
      if (ok) return Math.max(r, 13);
    }
    return 30;
  }

  private currentPose(): Pose {
    const target = this.controls.target.clone();
    this.sph.setFromVector3(this.tmp.copy(this.camera.position).sub(this.shakeOffset).sub(target));
    return { target, radius: this.sph.radius, polar: this.sph.phi, azimuth: this.sph.theta };
  }

  private applyPose(p: Pose): void {
    this.controls.target.copy(p.target);
    this.camera.position.setFromSphericalCoords(p.radius, p.polar, p.azimuth).add(p.target);
    this.camera.lookAt(p.target);
  }

  private blend(a: Pose, b: Pose, t: number, azimuthT = t): Pose {
    return {
      target: a.target.clone().lerp(b.target, t),
      radius: lerp(a.radius, b.radius, t),
      polar: lerp(a.polar, b.polar, t),
      azimuth: lerp(a.azimuth, b.azimuth, azimuthT),
    };
  }

  private refreshLimits(): void {
    const fit = this.restPose(this.side).radius;
    this.controls.minDistance = fit * 0.55;
    this.controls.maxDistance = fit * 1.6;
  }

  private begin(): void {
    this.busy++;
    this.controls.enabled = false;
  }

  private end(): void {
    this.busy = Math.max(0, this.busy - 1);
    if (this.busy === 0) {
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  get animating(): boolean {
    return this.busy > 0;
  }

  faceSide(side: Side, animate = true): Promise<void> {
    this.side = side;
    this.focus?.handle.cancel(false);
    this.faceHandle?.cancel(false);
    const to = this.restPose(side);
    this.refreshLimits();
    if (!animate) {
      this.applyPose(to);
      this.userMoved = false;
      this.controls.update();
      return Promise.resolve();
    }
    const from = this.currentPose();
    // Shortest way round; an exact half-turn always swings the same way.
    let d = to.azimuth - from.azimuth;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (Math.abs(Math.abs(d) - Math.PI) < 0.02) d = Math.PI;
    to.azimuth = from.azimuth + d;
    const reduced = this.reducedMotion();
    const swing = Math.abs(d) > 0.6 && !reduced;
    this.begin();
    const h = this.animator.tween(reduced ? 0.6 : 1.5, (t, raw) => {
      const p = this.blend(from, to, t);
      // Lift up and back a little mid-swing, so the turn feels like a crane move.
      if (swing) {
        const arc = Math.sin(raw * Math.PI);
        p.radius *= 1 + arc * 0.1;
        p.polar -= arc * 0.12;
      }
      this.applyPose(p);
    }, ease.cubicInOut);
    this.faceHandle = h;
    return h.done.then(() => {
      this.userMoved = false;
      this.end();
    });
  }

  focusOn(point: THREE.Vector3, strength = 1): Promise<void> {
    const reduced = this.reducedMotion();
    const s = Math.min(Math.max(strength, 0), 2) * (reduced ? 0.5 : 1);
    const base = this.focus ? this.focus.base : this.currentPose();
    this.focus?.handle.cancel(false);
    const start = this.currentPose();
    const peak: Pose = {
      target: base.target.clone().lerp(point, 0.38 * Math.min(s, 1.4)),
      radius: base.radius * (1 - 0.2 * s),
      polar: base.polar - 0.04 * s,
      azimuth: base.azimuth,
    };
    const tin = reduced ? 0.3 : 0.42, hold = reduced ? 0.15 : 0.3, tout = reduced ? 0.5 : 0.85;
    const total = tin + hold + tout;
    let t = 0;
    this.begin();
    const handle = this.animator.process(
      (dt) => {
        t += dt;
        if (t < tin) this.applyPose(this.blend(start, peak, ease.cubicOut(t / tin)));
        else if (t < tin + hold) this.applyPose(peak);
        else this.applyPose(this.blend(peak, base, ease.sineInOut(Math.min((t - tin - hold) / tout, 1))));
        return t >= total;
      },
      () => this.applyPose(base),
    );
    const entry = { handle, base };
    this.focus = entry;
    return handle.done.then(() => {
      if (this.focus === entry) this.focus = null;
      this.end();
    });
  }

  shake(intensity: number): void {
    if (this.reducedMotion()) return;
    this.trauma = Math.min(1, this.trauma + Math.max(0, intensity));
  }

  /** The intro fly-in. Skippable with skipIntro(). */
  intro(): Promise<void> {
    this.introHandle?.cancel(true);
    const to = this.restPose(this.side);
    this.refreshLimits();
    const reduced = this.reducedMotion();
    const from: Pose = reduced
      ? { ...to, target: to.target.clone(), radius: to.radius * 1.25 }
      : { target: to.target.clone().add(new THREE.Vector3(0, 1.2, -1.5)), radius: to.radius * 2.3, polar: 0.28, azimuth: to.azimuth - 1.9 };
    this.applyPose(from);
    this.begin();
    const h = this.animator.tween(reduced ? 1.0 : 2.6, (t, raw) => {
      // Spin settles before the dolly does, so the arrival feels soft.
      this.applyPose(this.blend(from, to, t, ease.cubicOut(raw)));
    }, ease.quintInOut);
    this.introHandle = h;
    return h.done.then(() => {
      this.introHandle = null;
      this.userMoved = false;
      this.end();
    });
  }

  skipIntro(): void {
    this.introHandle?.cancel(true);
  }

  get introRunning(): boolean {
    return !!this.introHandle?.running;
  }

  onResize(): void {
    if (this.busy > 0) return;
    this.refreshLimits();
    if (!this.userMoved) this.applyPose(this.restPose(this.side));
    this.controls.update();
  }

  /** Call at the start of a frame, before animations move the camera. */
  beginFrame(): void {
    this.camera.position.sub(this.shakeOffset);
    this.shakeOffset.set(0, 0, 0);
  }

  /** Call after animations, before rendering. Returns true if the view changed. */
  endFrame(dt: number, elapsed: number): boolean {
    let changed = false;
    if (this.busy === 0) changed = this.controls.update(dt);
    if (this.trauma > 0) {
      const k = this.trauma * this.trauma * 0.32;
      const t = elapsed * 30;
      this.shakeOffset.set(
        (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.3) * 0.5) * k,
        (Math.sin(t * 1.7 + 2.1) + Math.sin(t * 2.9) * 0.5) * k * 0.7,
        (Math.sin(t * 1.3 + 4.2) + Math.sin(t * 3.1 + 0.4) * 0.5) * k,
      );
      this.camera.position.add(this.shakeOffset);
      this.trauma = Math.max(0, this.trauma - dt * 1.5);
      changed = true;
    }
    return changed || this.busy > 0;
  }

  dispose(): void {
    this.focus?.handle.cancel(false);
    this.faceHandle?.cancel(false);
    this.introHandle?.cancel(false);
    this.controls.dispose();
  }
}
