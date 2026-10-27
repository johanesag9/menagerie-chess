/**
 * A PieceActor: one skinned mesh with its own bones and material.
 *
 * Motion is layered so tweens never fight: every bone gets rest + idle + act + emo.
 * - idle: rebuilt every frame by the animal's idle function (breathing, tails, tentacles, glances).
 * - act: written by GSAP during actions (move, attack, defeat, celebrate). Each action relaxes it back to zero.
 * - emo: emotes, hover and selection reactions. They play on top of anything.
 * The actor's `object` holds board position (parent space) and facing (rotation.y). Its scale is the square size,
 * so bone offsets are in square units.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import type { EmoteKind, PieceActor, PieceId, PieceKind, PieceState, QualityTier, Side, SkinChoice } from '../contracts/types';
import { applySlotTable, createSlotMaterial, type SlotUniforms } from './material';
import { instantiate } from './kit';
import { getTemplate, type AnimalTemplate } from './roster';
import { DEFAULT_PALETTE, paletteTable } from './palettes';
import { ACCESSORIES, accessoryGeometry } from './accessories';
import { motion } from './motion';
import * as fx from './fx';
import { STYLES, type Gait, type Style } from './styles';

const PI = Math.PI;
const TAU = PI * 2;
type TL = gsap.core.Timeline;

// ---------- pose layers ----------

export interface Off { px: number; py: number; pz: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number }
const ZERO: Off = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };

export class Layer {
  readonly m = new Map<string, Off>();
  get(n: string): Off {
    let o = this.m.get(n);
    if (!o) this.m.set(n, (o = { ...ZERO }));
    return o;
  }
  reset() { for (const o of this.m.values()) Object.assign(o, ZERO); }
}

export type MouthKind = 'smile' | 'open' | 'o' | 'frown';
export interface Face {
  /** 0 open .. 1 shut (added on top of idle blinks). */
  blink: number;
  /** Eye size multiplier (shock = big). */
  eyeScale: number;
  /** Angry brows 0..1. */
  brows: number;
  /** Mouth shape weights. `smile` is the animal's neutral mouth. */
  m: Record<MouthKind, number>;
}

// ---------- events ----------

export interface CastEventMap {
  /** A heavy footstep (elephant). Hook for camera shake. Intensity 0..1 (0 under reduced motion). */
  stomp: { id: PieceId; at: THREE.Vector3; intensity: number };
  /** An attack connects. */
  impact: { id: PieceId; victimId: PieceId; at: THREE.Vector3; intensity: number };
  /** A piece lands at the end of a move. */
  land: { id: PieceId; at: THREE.Vector3; intensity: number };
  /** A defeated piece vanishes in a poof. */
  poof: { id: PieceId; at: THREE.Vector3; intensity: number };
}
export type Emit = <K extends keyof CastEventMap>(name: K, payload: CastEventMap[K]) => void;

interface BoneRec { name: string; b: THREE.Bone; p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }

const MOUTH_BONES: [MouthKind, string][] = [['smile', 'mSmile'], ['open', 'mOpen'], ['o', 'mO'], ['frown', 'mFrown']];
const shortest = (from: number, to: number) => from + ((((to - from) % TAU) + TAU + PI) % TAU) - PI;

export class Actor implements PieceActor {
  readonly id: PieceId;
  readonly side: Side;
  readonly kind: PieceKind;
  readonly object = new THREE.Group();
  readonly tpl: AnimalTemplate;
  readonly style: Style;
  readonly mesh: THREE.SkinnedMesh;
  readonly idleL = new Layer();
  readonly act = new Layer();
  readonly emo = new Layer();
  readonly face: Face = { blink: 0, eyeScale: 1, brows: 0, m: { smile: 1, open: 0, o: 0, frown: 0 } };
  /** Personal clock offset and speed, so pieces never sync up. */
  readonly phase = Math.random() * 100;
  readonly rate = 0.85 + Math.random() * 0.3;

  private recs: BoneRec[] = [];
  private eyeRecs: BoneRec[] = [];
  private bones: Map<string, THREE.Bone>;
  private material: THREE.MeshPhysicalMaterial & { userData: { u: SlotUniforms } };
  private u: SlotUniforms;
  private home: number | null = null;
  private actionTls = new Set<gsap.core.Animation>();
  private emoTl: TL | null = null;
  private reactTl: TL | null = null;
  private pending = new Set<() => void>();
  private accessoryMesh: THREE.Mesh | null = null;
  private killBubble: (() => void) | null = null;
  private disposed = false;
  private gone = false;
  // idle state
  private blinkIn = 1 + Math.random() * 3;
  private blinkT = -1;
  private glanceIn = 2 + Math.random() * 5;
  private glance = { yaw: 0, pitch: 0, until: 0 };
  private lookTarget = { yaw: 0, pitch: 0, hold: 0 };
  private look = { yaw: 0, pitch: 0 };
  private sel = 0;
  private selT = 0;
  private hov = 0;
  private hovT = 0;
  private flashV = { v: 0 };
  private clock = 0;
  private struck = false;

  constructor(state: PieceState, skin: SkinChoice | undefined, private emitFn: Emit, squareSize: number, quality: QualityTier = 'high') {
    this.id = state.id;
    this.side = state.side;
    this.kind = state.kind;
    this.tpl = getTemplate(state.side, state.kind, quality);
    this.style = STYLES[state.side][state.kind];
    this.material = createSlotMaterial(paletteTable(this.tpl.def, skin?.palette), quality === 'low');
    this.u = this.material.userData.u;
    if (this.side === 'land') this.u.uRim.value.set(1, 0.86, 0.55, 0.12);
    else this.u.uRim.value.set(0.55, 0.97, 1, 0.12);
    const { mesh, bones } = instantiate(this.tpl.rig, this.material);
    this.mesh = mesh;
    this.bones = bones;
    for (const [name, b] of bones) this.recs.push({ name, b, p: b.position.clone(), r: b.rotation.clone(), s: b.scale.clone() });
    this.eyeRecs = this.recs.filter((r) => r.name === 'eyeL' || r.name === 'eyeR');
    this.object.add(mesh);
    this.object.name = `piece:${state.id}`;
    this.object.userData.pieceId = state.id;
    this.object.scale.setScalar(squareSize);
    this.object.rotation.y = this.side === 'land' ? PI : 0;
    this.setSkin(skin ?? {});
  }

  // ---------- helpers for styles ----------

  /** Act-layer offset of a bone (actions write here). */
  b(name: string): Off { return this.act.get(name); }
  /** Idle-layer offset (idle functions write here every frame). */
  ib(name: string): Off { return this.idleL.get(name); }
  /** Emote-layer offset. */
  eb(name: string): Off { return this.emo.get(name); }
  bone(name: string): THREE.Bone | undefined { return this.bones.get(name); }
  get sq() { return this.object.scale.x; }
  get height() { return this.tpl.height; }
  get rm() { return motion.reduced; }
  get fxParent(): THREE.Object3D { return this.object.parent ?? this.object; }
  /** A point in this actor's parent space, `y` squares above its feet. */
  above(y: number): THREE.Vector3 { return this.object.position.clone().add(new THREE.Vector3(0, y * this.sq, 0)); }
  /** World position of a bone, converted to parent space. */
  bonePoint(name: string): THREE.Vector3 {
    const b = this.bones.get(name);
    if (!b) return this.above(this.height * 0.6);
    this.object.updateWorldMatrix(true, true);
    const w = b.getWorldPosition(new THREE.Vector3());
    return this.object.parent ? this.object.parent.worldToLocal(w) : w;
  }
  toParent(world: THREE.Vector3): THREE.Vector3 { return this.object.parent ? this.object.parent.worldToLocal(world.clone()) : world.clone(); }
  worldPos(): THREE.Vector3 { return this.object.getWorldPosition(new THREE.Vector3()); }
  emit<K extends keyof CastEventMap>(name: K, p: CastEventMap[K]) { this.emitFn(name, p); }
  /** Track a loose tween as part of the current action (so skip/dispose reach it). */
  own<T extends gsap.core.Animation>(t: T): T {
    this.actionTls.add(t);
    t.eventCallback('onComplete', () => this.actionTls.delete(t));
    return t;
  }
  mouth(kind: MouthKind, tl?: TL, at?: number, dur = 0.08) {
    const v = { smile: 0, open: 0, o: 0, frown: 0, [kind]: 1, duration: dur, ease: 'back.out(3)' };
    if (tl) tl.to(this.face.m, v, at);
    else gsap.to(this.face.m, v);
  }
  flash(amount = 0.85) {
    gsap.fromTo(this.flashV, { v: amount }, { v: 0, duration: 0.35, ease: 'power2.out', overwrite: true });
  }
  turnTween(yaw: number, duration: number) {
    return gsap.to(this.object.rotation, { y: shortest(this.object.rotation.y, yaw), duration, ease: 'power2.out' });
  }
  homeYaw() { return this.home ?? this.object.rotation.y; }

  // ---------- action plumbing ----------

  private begin(): TL {
    this.cut();
    if (this.home === null) this.home = this.object.rotation.y;
    // Bake a leftover lunge (from an attack) into the board position, so the next move starts from there.
    const bo = this.act.m.get('base');
    if (bo && (bo.px || bo.pz)) {
      const v = new THREE.Vector3(bo.px, 0, bo.pz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.object.rotation.y).multiplyScalar(this.sq);
      this.object.position.add(v);
      bo.px = bo.pz = 0;
    }
    const tl = gsap.timeline();
    this.own(tl);
    this.relaxNow(0.15);
    return tl;
  }
  /** Kill the running action and resolve its promises (the action is over). */
  private cut() {
    for (const t of [...this.actionTls]) t.kill();
    this.actionTls.clear();
    this.resolveAll();
  }
  private resolveAll() {
    const p = [...this.pending];
    this.pending.clear();
    p.forEach((r) => r());
  }
  /** A promise resolved when `tl` reaches `at` (or completes, or is cut). */
  private promiseAt(tl: TL, at?: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.disposed) return resolve();
      const done = () => { this.pending.delete(done); resolve(); };
      this.pending.add(done);
      if (at === undefined) tl.eventCallback('onComplete', () => { this.actionTls.delete(tl); done(); });
      else tl.call(done, [], at);
    });
  }
  /** Tween every act offset back to rest. */
  relaxNow(dur = 0.3) {
    for (const o of this.act.m.values()) {
      if (Object.keys(ZERO).every((k) => o[k as keyof Off] === ZERO[k as keyof Off])) continue;
      this.own(gsap.to(o, { ...ZERO, duration: dur, ease: 'power2.out' }));
    }
  }
  private relaxFace(tl: TL, at: number, dur = 0.25) {
    tl.to(this.face, { blink: 0, eyeScale: 1, brows: 0, duration: dur, ease: 'power2.out' }, at);
    this.mouth('smile', tl, at);
  }

  /**
   * Travel along the ground to `to` (parent space) in the given gait. Adds to `tl` from `at`.
   * Returns the arrival time. `faceAfter`: turn back to the home yaw afterwards.
   */
  travel(tl: TL, at: number, to: THREE.Vector3, g: Gait, o: { faceAfter?: boolean; durScale?: number; keepFacing?: boolean; cap?: number; heightScale?: number; noAntic?: boolean } = {}): number {
    const from = this.object.position.clone();
    const d = to.clone().sub(from).setY(0);
    const n = d.length() / this.sq;
    if (n < 0.02) return at;
    const rm = this.rm;
    const yaw = Math.atan2(d.x, d.z) + (g.face ?? 0);
    const turn = rm ? 0.1 : 0.16;
    if (!o.keepFacing) tl.add(this.turnTween(yaw, turn), at);
    let t = at + (o.keepFacing ? 0 : turn * 0.7);
    const body = this.b('body');
    const base = this.b('base');
    if (!rm && g.antic !== 0 && !o.noAntic) {
      const amt = g.antic ?? 0.12;
      tl.to(body, { sy: 1 - amt, sx: 1 + amt * 0.5, sz: 1 + amt * 0.5, duration: 0.08, ease: 'power2.out' }, t);
      t += 0.08;
      tl.to(body, { sy: 1 + amt * 0.4, sx: 1 - amt * 0.2, sz: 1 - amt * 0.2, duration: 0.1, ease: 'power2.out' }, t);
    }
    const budget = (o.cap ?? 1.15) - (t - at);
    const D = Math.min(budget, g.dur(n) * (rm ? 0.6 : 1) * (o.durScale ?? 1));
    const hops = rm ? Math.max(1, Math.round(n)) : Math.max(1, Math.round(g.hops(n)));
    const H = (rm ? Math.min(g.height, 0.08) : g.height) * (o.heightScale ?? 1);
    const p = { t: 0 };
    let last = 0;
    tl.to(p, {
      t: 1, duration: D, ease: g.ease ?? 'power1.inOut',
      onUpdate: () => {
        const k = p.t;
        this.object.position.lerpVectors(from, to, k);
        const h = Math.min(hops - 1e-6, k * hops);
        const i = Math.floor(h);
        const f = h - i;
        base.py = Math.sin(f * PI) * H * (g.arc ? g.arc(i, hops) : 1);
        if (i !== last) {
          last = i;
          if (!rm && g.squash) this.own(gsap.fromTo(body, { sy: 1 - g.squash * 0.6, sx: 1 + g.squash * 0.3, sz: 1 + g.squash * 0.3 }, { sy: 1, sx: 1, sz: 1, duration: 0.2, ease: 'power2.out' }));
          g.step?.(this, i);
        }
        g.frame?.(this, k, f, i, hops);
      },
    }, t);
    t += D;
    tl.call(() => {
      base.py = 0;
      this.object.position.copy(to);
      const at = this.worldPos();
      this.emit('land', { id: this.id, at, intensity: rm ? 0 : g.landIntensity ?? 0.2 });
      g.land?.(this);
    }, [], t);
    const sq = rm ? (g.squash ?? 0) * 0.4 : g.squash ?? 0;
    if (sq > 0) tl.fromTo(body, { sy: 1 - sq, sx: 1 + sq * 0.55, sz: 1 + sq * 0.55 }, { sy: 1, sx: 1, sz: 1, duration: 0.45, ease: 'elastic.out(1.1, 0.4)', immediateRender: false }, t);
    if (o.faceAfter) tl.add(this.turnTween(this.homeYaw(), 0.35), t + 0.05);
    return t;
  }

  // ---------- PieceActor ----------

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    this.clock += dt;
    const t = this.phase + elapsed * this.rate;
    this.idleL.reset();
    this.style.idle(this, t);

    // Blinks (sometimes a double blink).
    this.blinkIn -= dt;
    if (this.blinkIn <= 0 && this.blinkT < 0) this.blinkT = 0;
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const d = 0.14;
      blink = this.blinkT < d ? Math.sin((this.blinkT / d) * PI) : 0;
      if (this.blinkT >= d) {
        this.blinkT = -1;
        this.blinkIn = Math.random() < 0.2 ? 0.12 : 1.8 + Math.random() * 3.5;
      }
    }

    // Glances, and lookAt() targets (held a few seconds).
    this.glanceIn -= dt;
    if (this.glanceIn <= 0) {
      this.glanceIn = 3 + Math.random() * 5;
      this.glance = { yaw: (Math.random() - 0.5) * 0.9, pitch: (Math.random() - 0.5) * 0.3, until: this.clock + 0.8 + Math.random() * 1.2 };
    }
    let ty = 0, tp = 0;
    if (this.lookTarget.hold > 0) {
      this.lookTarget.hold -= dt;
      ty = this.lookTarget.yaw;
      tp = this.lookTarget.pitch;
    } else if (this.clock < this.glance.until) {
      ty = this.glance.yaw;
      tp = this.glance.pitch;
    }
    const kl = 1 - Math.exp(-dt * 6);
    this.look.yaw += (ty - this.look.yaw) * kl;
    this.look.pitch += (tp - this.look.pitch) * kl;
    const head = this.ib('head');
    head.ry += this.look.yaw * 0.6;
    head.rx += this.look.pitch * 0.5;

    // Hover and selection.
    const ks = 1 - Math.exp(-dt * 12);
    this.sel += (this.selT - this.sel) * ks;
    this.hov += (this.hovT - this.hov) * ks;
    const base = this.ib('base');
    base.py += this.sel * (0.16 + Math.sin(t * 4) * 0.02);
    const body = this.ib('body');
    const perk = 1 + this.hov * 0.035 + this.sel * 0.02;
    body.sx *= perk; body.sy *= perk; body.sz *= perk;
    head.rx -= this.hov * 0.12;
    this.u.uRim.value.w = 0.12 + this.hov * 0.35 + this.sel * 0.55;
    this.u.uFlash.value = this.flashV.v;

    this.applyBones(blink, t);
  }

  private applyBones(idleBlink: number, t: number) {
    const A = this.act.m, E = this.emo.m, I = this.idleL.m;
    const f = this.face;
    for (const r of this.recs) {
      const a = A.get(r.name), e = E.get(r.name), i = I.get(r.name);
      const b = r.b;
      if (a || e || i) {
        // A tilted pedestal would dig into the board: lift it by its tilt.
        const lift = r.name === 'base' ? 0.39 * Math.min(1, Math.abs(Math.sin((a?.rx ?? 0) + (e?.rx ?? 0))) + Math.abs(Math.sin((a?.rz ?? 0) + (e?.rz ?? 0) + (i?.rz ?? 0)))) : 0;
        b.position.set(
          r.p.x + (a?.px ?? 0) + (e?.px ?? 0) + (i?.px ?? 0),
          r.p.y + (a?.py ?? 0) + (e?.py ?? 0) + (i?.py ?? 0) + lift,
          r.p.z + (a?.pz ?? 0) + (e?.pz ?? 0) + (i?.pz ?? 0),
        );
        b.rotation.set(
          r.r.x + (a?.rx ?? 0) + (e?.rx ?? 0) + (i?.rx ?? 0),
          r.r.y + (a?.ry ?? 0) + (e?.ry ?? 0) + (i?.ry ?? 0),
          r.r.z + (a?.rz ?? 0) + (e?.rz ?? 0) + (i?.rz ?? 0),
        );
        b.scale.set(
          r.s.x * (a?.sx ?? 1) * (e?.sx ?? 1) * (i?.sx ?? 1),
          r.s.y * (a?.sy ?? 1) * (e?.sy ?? 1) * (i?.sy ?? 1),
          r.s.z * (a?.sz ?? 1) * (e?.sz ?? 1) * (i?.sz ?? 1),
        );
      }
    }
    // Face.
    const open = Math.max(0.06, 1 - Math.max(idleBlink, Math.min(1, f.blink)));
    const es = f.eyeScale;
    for (const r of this.eyeRecs) r.b.scale.set(r.s.x * es, r.s.y * es * open, r.s.z * es);
    const gx = this.look.yaw * 0.5, gy = this.look.pitch * 0.4 + Math.sin(t * 0.37) * 0.04;
    for (const n of ['lookL', 'lookR']) {
      const b = this.bones.get(n);
      if (b) b.rotation.set(-gy, gx, 0);
    }
    for (const [k, n] of MOUTH_BONES) {
      const b = this.bones.get(n);
      if (b) b.scale.setScalar(Math.max(0.001, f.m[k]));
    }
    const brows = this.bones.get('brows');
    if (brows) brows.scale.setScalar(Math.max(0.001, f.brows));
  }

  setSelected(selected: boolean): void {
    if (this.disposed || this.selT === (selected ? 1 : 0)) return;
    this.selT = selected ? 1 : 0;
    if (!selected) return;
    // Excited reaction: a little hop, eyes wide, mouth open, then a happy smile.
    this.reactTl?.kill();
    const tl = (this.reactTl = gsap.timeline());
    const base = this.eb('base');
    const head = this.eb('head');
    const rm = this.rm;
    tl.to(base, { py: rm ? 0.03 : 0.12, duration: 0.14, ease: 'power2.out' }, 0)
      .to(base, { py: 0, duration: 0.22, ease: 'bounce.out' }, 0.14)
      .to(this.face, { eyeScale: 1.18, duration: 0.1 }, 0)
      .to(this.face, { eyeScale: 1, duration: 0.3 }, 0.45);
    this.mouth('open', tl, 0);
    this.mouth('smile', tl, 0.5);
    if (!rm) {
      if (this.side === 'land') tl.to(head, { rz: 0.12, duration: 0.08, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0.1);
      else tl.to(base, { ry: 0.25, duration: 0.18, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0.1);
    }
  }

  setHovered(hovered: boolean): void {
    this.hovT = hovered ? 1 : 0;
  }

  lookAt(point: THREE.Vector3): void {
    if (this.disposed) return;
    this.object.updateWorldMatrix(true, false);
    const l = this.object.worldToLocal(point.clone());
    const yaw = Math.atan2(l.x, l.z);
    const flat = Math.hypot(l.x, l.z);
    const pitch = -Math.atan2(l.y - this.height * 0.7, Math.max(0.1, flat));
    this.lookTarget = { yaw: THREE.MathUtils.clamp(yaw, -1.1, 1.1), pitch: THREE.MathUtils.clamp(pitch, -0.5, 0.5), hold: 2.5 };
  }

  moveTo(target: THREE.Vector3, opts?: { duration?: number }): Promise<void> {
    if (this.disposed || this.gone) return Promise.resolve();
    const tl = this.begin();
    const to = this.toParent(target);
    const g = this.style.gait;
    let scale: number | undefined;
    if (opts?.duration) {
      const n = to.clone().sub(this.object.position).setY(0).length() / this.sq;
      scale = opts.duration / Math.max(0.1, g.dur(n));
    }
    // Right after a strike, finish onto the victim's square with a quick hop (keeps captures near 2s).
    const struck = this.struck;
    this.struck = false;
    const arrive = struck
      ? this.travel(tl, 0, to, g, { faceAfter: true, keepFacing: true, noAntic: true, cap: 0.4, heightScale: 0.45 })
      : this.travel(tl, 0, to, g, { faceAfter: true, durScale: scale });
    this.relaxFaceAndPose(tl, arrive + 0.1);
    return this.promiseAt(tl, arrive);
  }

  private relaxFaceAndPose(tl: TL, at: number) {
    tl.call(() => this.relaxNow(0.35), [], at);
    this.relaxFace(tl, at);
  }

  attack(victim: PieceActor): Promise<void> {
    if (this.disposed || this.gone) return Promise.resolve();
    const v = victim as Actor;
    const tl = this.begin();
    const vp = v.object.parent ? this.toParent(v.worldPos()) : v.object.position.clone();
    const from = this.object.position.clone();
    const d = vp.clone().sub(from).setY(0);
    const dist = d.length();
    const dir = dist > 1e-4 ? d.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const stop = 0.75 * this.sq;
    let at = 0;
    if (dist > stop + 0.05 * this.sq) {
      const target = vp.clone().sub(dir.clone().multiplyScalar(stop));
      target.y = from.y;
      at = this.travel(tl, 0, target, this.style.gait, { durScale: 0.8, cap: 0.8 });
    }
    // Face the victim squarely (the crab scuttles sideways, so it needs this).
    const yaw = Math.atan2(dir.x, dir.z);
    tl.add(this.turnTween(yaw, 0.12), at);
    at += 0.08;
    const impact = this.style.attack(this, tl, at, v);
    tl.call(() => {
      this.struck = true;
      const hit = v.object.parent ? v.bonePoint('head') : this.above(this.height * 0.6);
      fx.stars(this.fxParent, hit, this.sq, this.rm ? 5 : 9);
      v.flash();
      this.emit('impact', { id: this.id, victimId: v.id, at: this.fxParent.localToWorld(hit.clone()), intensity: this.rm ? 0 : this.style.impact });
    }, [], impact);
    this.relaxFaceAndPose(tl, impact + 0.25);
    return this.promiseAt(tl, impact);
  }

  defeat(by: PieceActor): Promise<void> {
    if (this.disposed || this.gone) return Promise.resolve();
    const a = by as Actor;
    const tl = this.begin();
    const rm = this.rm;
    const sq = this.sq;
    const away = this.object.position.clone().sub(a.object.parent === this.object.parent ? a.object.position : this.toParent(a.worldPos())).setY(0);
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.normalize();
    const base = this.b('base');
    const body = this.b('body');
    const sea = this.side === 'sea';
    // Shocked face first.
    tl.to(this.face, { eyeScale: 1.35, blink: 0, duration: 0.08 }, 0);
    this.mouth('o', tl, 0);
    const kind = a.style?.hit ?? 'launch';
    let end: number;
    const vanish = (t: number, y: number) => {
      tl.call(() => {
        const p = this.above(y);
        p.y += base.py * sq;
        fx.poof(this.fxParent, p, sq, this.tpl.height, sea);
        if (!rm) fx.stars(this.fxParent, p, sq, 6, 0.5);
        this.emit('poof', { id: this.id, at: this.fxParent.localToWorld(p.clone()), intensity: rm ? 0 : 0.4 });
      }, [], t);
      tl.to(base, { sx: 0.001, sy: 0.001, sz: 0.001, duration: 0.18, ease: 'back.in(2)' }, t - 0.06);
    };
    if (rm) {
      // Reduced motion: a small hop back, then a poof.
      tl.to(this.object.position, { x: `+=${away.x * sq * 0.3}`, z: `+=${away.z * sq * 0.3}`, duration: 0.3, ease: 'power2.out' }, 0.05);
      tl.to(this.face, { blink: 1, duration: 0.15 }, 0.2);
      vanish(0.45, this.tpl.height * 0.4);
      end = 0.5;
    } else if (kind === 'pancake') {
      // Flattened like a pancake, a dazed wobble, then pop away.
      tl.to(body, { sy: 0.12, sx: 1.6, sz: 1.6, duration: 0.07, ease: 'power4.out' }, 0.02);
      tl.to(this.face, { blink: 1, duration: 0.06 }, 0.04);
      this.mouth('frown', tl, 0.05);
      tl.to(body, { sx: 1.75, sz: 1.45, duration: 0.12, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0.12);
      tl.call(() => fx.dizzy(this.object, 0.25, 0.6), [], 0.15);
      tl.to(body, { sy: 1.25, sx: 0.85, sz: 0.85, duration: 0.14, ease: 'back.out(3)' }, 0.72);
      tl.to(base, { py: 0.25, duration: 0.14, ease: 'power2.out' }, 0.72);
      vanish(0.92, this.tpl.height * 0.5);
      end = 0.98;
    } else if (kind === 'dizzy') {
      // Spun round and round, stars circling, then tips over and poofs.
      tl.to(this.object.rotation, { y: `+=${TAU * 2}`, duration: 0.85, ease: 'power2.out' }, 0.05);
      tl.to(base, { rz: 0.18, duration: 0.1, yoyo: true, repeat: 7, ease: 'sine.inOut' }, 0.05);
      tl.call(() => fx.dizzy(this.object, this.tpl.height + 0.08, 1.1), [], 0.05);
      tl.to(this.face, { blink: 0.85, eyeScale: 1, duration: 0.2 }, 0.3);
      this.mouth('open', tl, 0.3);
      tl.to(base, { rz: PI / 2, duration: 0.3, ease: 'bounce.out' }, 0.9);
      tl.to(base, { py: 0.18, duration: 0.15, ease: 'power2.out' }, 0.9);
      tl.to(base, { py: 0, duration: 0.15, ease: 'power2.in' }, 1.05);
      vanish(1.35, 0.25);
      end = 1.4;
    } else {
      // Launched off the board with a spin.
      const dist = sq * 3.2;
      tl.to(this.object.position, { x: `+=${away.x * dist}`, z: `+=${away.z * dist}`, duration: 1.05, ease: 'power1.out' }, 0.04);
      tl.to(base, { py: 2.2, duration: 0.5, ease: 'power2.out' }, 0.04);
      tl.to(base, { py: 1.0, duration: 0.5, ease: 'power2.in' }, 0.54);
      // Tumble around the axis perpendicular to the flight, in the piece's own frame.
      const local = away.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.object.rotation.y);
      tl.to(base, { rx: local.z * TAU * 1.5, rz: -local.x * TAU * 1.5, duration: 1.0, ease: 'none' }, 0.04);
      tl.to(this.face, { blink: 0.8, duration: 0.1 }, 0.2);
      this.mouth('open', tl, 0.2);
      vanish(0.98, this.tpl.height * 0.5);
      end = 1.04;
    }
    tl.call(() => {
      this.gone = true;
      this.object.removeFromParent();
    }, [], end);
    return this.promiseAt(tl, end);
  }

  celebrate(): Promise<void> {
    if (this.disposed || this.gone) return Promise.resolve();
    const tl = this.begin();
    tl.to(this.face, { blink: 0.55, duration: 0.1 }, 0);
    this.mouth('open', tl, 0);
    tl.call(() => fx.confetti(this.fxParent, this.above(this.height * 0.9), this.sq), [], 0.05);
    const end = this.style.celebrate(this, tl, 0.05);
    tl.add(this.turnTween(this.homeYaw(), 0.3), end);
    this.relaxFaceAndPose(tl, end);
    return this.promiseAt(tl);
  }

  emote(e: EmoteKind): void {
    if (this.disposed || this.gone) return;
    this.killBubble?.();
    this.killBubble = fx.emoteBubble(this.object, e, this.height + 0.08);
    this.emoTl?.kill();
    for (const o of this.emo.m.values()) Object.assign(o, ZERO);
    const tl = (this.emoTl = gsap.timeline());
    const f = this.face;
    const base = this.eb('base');
    const body = this.eb('body');
    const head = this.eb('head');
    const rm = this.rm;
    const land = this.side === 'land';
    const k = this.style.energy * (rm ? 0.4 : 1);
    const P = this.fxParent;
    switch (e) {
      case 'laugh':
        tl.to(f, { blink: 0.65, duration: 0.1 }, 0);
        this.mouth('open', tl, 0);
        tl.to(head, { rx: -0.2 * k, duration: 0.12 }, 0);
        if (land) tl.to(base, { py: 0.08 * k, duration: 0.12, yoyo: true, repeat: 5, ease: 'power1.out' }, 0);
        else tl.to(base, { rz: 0.12 * k, duration: 0.18, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 0);
        tl.to(body, { sy: 1 + 0.06 * k, sx: 1 - 0.03 * k, duration: 0.08, yoyo: true, repeat: 9, ease: 'sine.inOut' }, 0);
        break;
      case 'angry':
        tl.to(f, { brows: 1, blink: 0.2, duration: 0.1 }, 0);
        this.mouth('frown', tl, 0);
        tl.to(head, { rx: 0.15 * k, duration: 0.15 }, 0);
        if (land) {
          tl.to(base, { py: 0.1 * k, duration: 0.1, yoyo: true, repeat: 3, ease: 'power2.out' }, 0.1);
          tl.call(() => fx.dust(P, this.above(0), this.sq, 0.6), [], 0.3);
        } else {
          tl.to(body, { sx: 1 + 0.12 * k, sy: 1 + 0.12 * k, sz: 1 + 0.12 * k, duration: 0.25, ease: 'back.out(3)' }, 0.05);
          tl.to(base, { rz: 0.06 * k, duration: 0.05, yoyo: true, repeat: 9 }, 0.1);
        }
        break;
      case 'love':
        tl.to(f, { blink: 0.55, duration: 0.15 }, 0);
        this.mouth('smile', tl, 0);
        tl.call(() => fx.hearts(P, this.above(this.height * 0.8), this.sq, rm ? 2 : 4), [], 0.1);
        tl.to(head, { rz: 0.2 * k, duration: 0.35, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0);
        tl.to(base, { ry: 0.15 * k, duration: 0.35, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0);
        break;
      case 'shock':
        tl.to(f, { eyeScale: 1.4, blink: 0, duration: 0.06 }, 0);
        this.mouth('o', tl, 0);
        tl.to(base, { py: 0.25 * k, pz: -0.08 * k, duration: 0.14, ease: 'power2.out' }, 0);
        tl.to(base, { py: 0, duration: 0.25, ease: 'bounce.out' }, 0.14);
        tl.to(body, { sy: 1.15, sx: 0.92, sz: 0.92, duration: 0.1 }, 0);
        tl.to(body, { sy: 1, sx: 1, sz: 1, duration: 0.4, ease: 'elastic.out(1, 0.4)' }, 0.2);
        tl.to(base, { pz: 0, duration: 0.4 }, 0.9);
        break;
      case 'sleepy':
        tl.to(f, { blink: 0.92, duration: 0.6, ease: 'sine.inOut' }, 0);
        this.mouth('o', tl, 0.3);
        tl.to(head, { rx: 0.35, rz: 0.12, duration: 0.8, ease: 'sine.inOut' }, 0);
        tl.to(body, { sy: 0.93, duration: 0.8, ease: 'sine.inOut' }, 0);
        tl.to(base, { rz: 0.05, duration: 0.6, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0.2);
        tl.to(head, { rx: -0.1, duration: 0.15, ease: 'back.out(3)' }, 1.5);
        tl.to(f, { blink: 0, eyeScale: 1.2, duration: 0.1 }, 1.5);
        break;
      case 'taunt':
        tl.to(f, { blink: 0.45, duration: 0.1 }, 0);
        this.mouth('open', tl, 0);
        tl.to(head, { rz: 0.22 * k, duration: 0.12, yoyo: true, repeat: 7, ease: 'sine.inOut' }, 0);
        if (land) tl.to(base, { ry: PI * (rm ? 0.1 : 0.8), duration: 0.25, yoyo: true, repeat: 1, repeatDelay: 0.4, ease: 'power2.inOut' }, 0.1);
        else if (!rm) tl.to(base, { ry: TAU, duration: 0.8, ease: 'power2.inOut' }, 0.1);
        break;
    }
    const end = Math.max(1.4, tl.duration()) + 0.15;
    tl.to(f, { blink: 0, eyeScale: 1, brows: 0, duration: 0.25 }, end);
    this.mouth('smile', tl, end);
    for (const o of [base, body, head]) tl.to(o, { ...ZERO, duration: 0.3, ease: 'power2.out' }, end);
  }

  setSkin(skin: SkinChoice): void {
    if (this.disposed) return;
    const palette = skin.palette ?? DEFAULT_PALETTE[this.side];
    applySlotTable(this.material, paletteTable(this.tpl.def, palette));
    this.accessoryMesh?.removeFromParent();
    this.accessoryMesh = null;
    const def = ACCESSORIES.find((a) => a.id === skin.accessory);
    if (!def) return;
    applySlotTable(this.material, def.colors);
    const anchor = this.tpl.anchors[def.anchor];
    const bone = this.bones.get(anchor.bone);
    if (!bone) return;
    const m = new THREE.Mesh(accessoryGeometry(def, anchor, this.side + this.kind), this.material);
    m.castShadow = true;
    m.position.set(...anchor.p);
    if (anchor.r) m.rotation.set(...anchor.r);
    const s = def.anchor === 'face' ? 1 : anchor.s ?? 1;
    m.scale.setScalar(0.001);
    bone.add(m);
    this.accessoryMesh = m;
    gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.35, ease: 'back.out(2.5)' });
  }

  /** Jump the running action (and emote) to its end. Not in the contract; integration can call it on click. */
  skip(): void {
    for (const t of [...this.actionTls]) t.progress(1);
    this.emoTl?.progress(1);
    this.reactTl?.progress(1);
  }

  get selected(): boolean { return this.selT === 1; }

  get isBusy(): boolean { return this.actionTls.size > 0; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of [...this.actionTls]) t.kill();
    this.actionTls.clear();
    this.emoTl?.kill();
    this.reactTl?.kill();
    this.killBubble?.();
    this.resolveAll();
    this.object.removeFromParent();
    this.mesh.skeleton.dispose();
    this.material.dispose();
  }
}
