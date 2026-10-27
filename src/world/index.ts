/**
 * World stream: the shoreline diorama, board, camera, picking, highlights and Weird Mode visuals.
 * Exports `createWorld` (contract: src/contracts/factories.ts).
 *
 * Notes for integration:
 * - `squareToWorld` returns the square centre with the board at rest. That is also the position
 *   inside `pieceLayer` (the board group sits at the origin), so use it for piece positions.
 * - `setHighlights`: fields you leave out keep their value; pass null / [] to clear one.
 * - Objects with `userData.noPick = true` are ignored by picking.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Emitter } from '../contracts/emitter';
import type { CreateWorld } from '../contracts/factories';
import type {
  HighlightSet, QualityTier, Side, Square, Unsubscribe, WeirdEvent, World, WorldEventMap, WorldOptions,
} from '../contracts/types';
import { Animator } from './anim';
import { createBoard } from './board';
import { CameraRig } from './camera';
import { PALETTE, SQUARE } from './constants';
import { squareToXZ } from './coords';
import { createDiorama } from './diorama';
import { Highlights } from './highlights';
import { Bin, Materials } from './kit';
import { Picker } from './picking';
import { PROFILES, detectQuality, readDeviceInfo } from './quality';
import { Stage } from './stage';
import { makeTextures } from './textures';
import { WeirdEffects } from './weird';

export interface WorldStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  quality: QualityTier;
  /** Compiled shader programs (fewer = faster first load). */
  programs: number;
}

/** Extras beyond the contract (see REPORT.md "Contract requests"). */
export interface ShorelineWorld extends World {
  setQuality(q: QualityTier): void;
  setCoordinatesVisible(visible: boolean): void;
  /** null = follow the OS setting (prefers-reduced-motion). */
  setReducedMotion(reduced: boolean | null): void;
  readonly reducedMotion: boolean;
  readonly stats: WorldStats;
}

export async function createWorld(opts: WorldOptions): Promise<ShorelineWorld> {
  const bin = new Bin();
  const mats = new Materials(bin);
  const events = new Emitter<WorldEventMap>();
  const animator = new Animator();
  const frameFns = new Set<(dt: number, elapsed: number) => void>();

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 34, 110);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);

  const stage = new Stage(opts.container, scene, camera, (gl) => opts.quality ?? detectQuality(readDeviceInfo(gl)));
  const renderer = stage.renderer;

  // Reduced motion: OS setting unless overridden.
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedOverride: boolean | null = null;
  const reducedMotion = () => reducedOverride ?? mq.matches;

  // Soft image-based light.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTex = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environment = envTex;

  const tex = makeTextures(bin);
  const diorama = createDiorama(bin, mats, PROFILES[stage.quality]);
  scene.environmentIntensity = diorama.base.env;
  scene.add(diorama.root);
  const board = createBoard(bin, mats, tex);
  scene.add(board.group);

  const highlights = new Highlights(bin, tex, () => (stage.quality === 'high' ? 1 : 0));
  board.overlay.add(highlights.group);

  const rig = new CameraRig(camera, stage.canvas, animator, () => stage.aspect, reducedMotion);
  stage.onResize = () => {
    rig.onResize();
    dirty = true;
  };
  rig.onResize();

  const picker = new Picker(stage.canvas, camera, board.group, board.pieceLayer, events, {
    canPick: () => !rig.introRunning,
    onPress: () => rig.skipIntro(),
  });
  const onKey = () => rig.skipIntro();
  window.addEventListener('keydown', onKey);
  stage.canvas.addEventListener('wheel', onKey, { passive: true });

  const weird = new WeirdEffects({
    scene, board, diorama, rig, animator, bin, mats, tex, reducedMotion, quality: () => stage.quality,
  });

  // Compile every shader (including hidden effects) before the first visible frame.
  weird.setPrewarm(true);
  highlights.setAllVisible(true);
  for (const t of Object.values(tex)) renderer.initTexture(t);
  await renderer.compileAsync(scene, camera);
  stage.render(0);
  weird.setPrewarm(false);
  highlights.setAllVisible(false);

  let paused = false;
  let disposed = false;
  let dirty = true;
  let elapsed = 0;
  let introStarted = false;
  let introSkipped = opts.autoIntro === false;
  let fps = 60;
  const timer = new THREE.Timer();
  timer.connect(document);

  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const raw = timer.getDelta();
    const dt = Math.min(raw, 1 / 20);
    if (raw > 0) fps += (1 / raw - fps) * 0.05;

    rig.beginFrame();
    if (!paused) {
      elapsed += dt;
      animator.update(dt);
      diorama.update(dt, elapsed);
      highlights.update(dt, elapsed);
      for (const fn of frameFns) {
        try {
          fn(dt, elapsed);
        } catch (err) {
          console.error('[world] onFrame callback failed', err);
        }
      }
    }
    // The intro starts on the first frame the canvas actually has a size.
    if (!introStarted && stage.hasSize) {
      introStarted = true;
      if (!introSkipped) void rig.intro();
    }
    const moved = rig.endFrame(dt, elapsed);
    if (moved) picker.invalidate();
    picker.update();

    if (paused && !moved && !dirty) return;
    if (stage.render(dt)) {
      dirty = false;
      stage.trackFrame(raw);
      stage.reveal();
    }
  });

  const world: ShorelineWorld = {
    on: (name, fn) => events.on(name, fn),
    get quality() {
      return stage.quality;
    },
    squareSize: SQUARE,
    camera,
    renderer,
    scene,
    pieceLayer: board.pieceLayer,
    squareToWorld(square: Square) {
      const { x, y, z } = squareToXZ(square);
      return new THREE.Vector3(x, y, z);
    },
    setHighlights(h: HighlightSet) {
      highlights.set(h);
    },
    faceSide(side: Side, animate = true) {
      return rig.faceSide(side, animate);
    },
    focusOn(point: THREE.Vector3, strength?: number) {
      return rig.focusOn(point, strength);
    },
    shake(intensity: number) {
      rig.shake(intensity);
    },
    playWeirdEvent(e: WeirdEvent) {
      return weird.play(e);
    },
    onFrame(fn): Unsubscribe {
      frameFns.add(fn);
      return () => frameFns.delete(fn);
    },
    setPaused(p: boolean) {
      paused = p;
      dirty = true;
    },
    setQuality(q: QualityTier) {
      stage.setQuality(q);
      diorama.setQuality(PROFILES[q]);
      dirty = true;
    },
    setCoordinatesVisible(v: boolean) {
      board.labels.visible = v;
      dirty = true;
    },
    setReducedMotion(r: boolean | null) {
      reducedOverride = r;
    },
    get reducedMotion() {
      return reducedMotion();
    },
    playIntro() {
      introStarted = true;
      return rig.intro();
    },
    skipIntro() {
      if (!introStarted) introSkipped = true;
      rig.skipIntro();
    },
    get stats(): WorldStats {
      const i = stage.info;
      return { fps: Math.round(fps), drawCalls: i.calls, triangles: i.triangles, pixelRatio: i.pixelRatio, quality: stage.quality, programs: renderer.info.programs?.length ?? 0 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      timer.disconnect();
      window.removeEventListener('keydown', onKey);
      stage.canvas.removeEventListener('wheel', onKey);
      picker.dispose();
      weird.dispose();
      animator.clear();
      rig.dispose();
      // Pieces belong to the cast; integration disposes them. We only detach the layer.
      board.pieceLayer.removeFromParent();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const list = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mat of list) mat.dispose();
      });
      diorama.sun.shadow.dispose();
      bin.dispose();
      envTex.dispose();
      stage.dispose();
      events.clear();
      frameFns.clear();
    },
  };
  return world;
}

// Compile-time check that the factory matches the contract.
const _contract: CreateWorld = createWorld;
void _contract;

export default createWorld;
