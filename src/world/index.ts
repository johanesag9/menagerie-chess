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
  HighlightSet, Level, QualityTier, Side, Square, SquareEffect, TreasureState, Unsubscribe, WeirdEvent, WheelOutcome, World, WorldEventMap, WorldOptions,
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
import { ChaosEffects, type ChaosOptions, Particles } from './chaos';
import { SquareEffects } from './squareFx';
import { SinkingIsland } from './sink';
import { Splashes } from './splash';
import { Treasures } from './treasures';
import { IslandMode } from './island';
import { COLUMN_HALF, SandLevels } from './levels';

export { TIDE_TIMING } from './chaos';
export { SINK_TIMING, RISE_TIMING, sinkDropTimes, sinkStyle, ringOf } from './sink';
export { LEVEL_H, LEVEL_TIMING, levelTop } from './levels';
export { TREASURE_COLORS, makeBoneGeometry, makePearlGeometry } from './treasures';

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
  /** Phase 4 (Sumo): built, so not optional here. */
  setIslandMode(on: boolean): void;
  /**
   * Phase 6 (castle): built, so not optional here. Extra `opts`: `tide` forces the tide wash (by default two or more
   * squares going down in one call is the tide), `instant` skips the animation.
   */
  setLevels(levels: Partial<Record<Square, Level>>, opts?: { tide?: boolean; instant?: boolean }): void;
  squareTop(square: Square): THREE.Vector3;
  setFlag(flag: { square: Square; side: Side } | null): void;
  setFresh(squares: Square[]): void;
  /** Phase 6 extra: the meadow half's tiers as turf (packed earth, grass top; the default) or plain sand. */
  setMeadowTiers(look: 'turf' | 'sand'): void;
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
  // Declared before the resize hook: a resize can land while the world is still loading.
  let dirty = true;
  stage.onResize = () => {
    rig.onResize();
    dirty = true;
  };
  rig.onResize();

  // Any click or key skips the intro and a running Wheel of Chaos spectacle.
  const skipAll = () => {
    rig.skipIntro();
    chaos?.skip();
  };
  let levelsRef: SandLevels | null = null;
  const picker = new Picker(stage.canvas, camera, board.group, board.pieceLayer, events, {
    canPick: () => !rig.introRunning,
    onPress: skipAll,
    // Phase 6: tier tops and sides pick their square (assigned once the levels exist).
    columns: () => (levelsRef ? { heights: levelsRef.tops, half: COLUMN_HALF } : null),
  });
  const onKey = skipAll;
  window.addEventListener('keydown', onKey);
  stage.canvas.addEventListener('wheel', onKey, { passive: true });

  const weird = new WeirdEffects({
    scene, board, diorama, rig, animator, bin, mats, tex, reducedMotion, quality: () => stage.quality,
  });

  // Phase 3: blocked squares and Wheel of Chaos spectacles.
  const squareFx = new SquareEffects(bin);
  board.overlay.add(squareFx.group);
  const bufSize = new THREE.Vector2();
  const chaos: ChaosEffects = new ChaosEffects({
    board, diorama, rig, animator, bin, mats, tex, weird, reducedMotion, quality: () => stage.quality,
    pxScale: () => renderer.getDrawingBufferSize(bufSize).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)),
  });

  // Phase 4: the sinking island, treasures and splashes share one particle system (one draw call).
  const waterParticles = new Particles(bin, tex, () => renderer.getDrawingBufferSize(bufSize).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  waterParticles.points.name = 'water-particles';
  board.overlay.add(waterParticles.points);
  const sink = new SinkingIsland({ board, bin, particles: waterParticles, reducedMotion, shake: (k) => rig.shake(k) });
  const treasures = new Treasures(bin, tex, waterParticles, reducedMotion);
  board.overlay.add(treasures.group);
  chaos.treasures = treasures;
  const island = new IslandMode(bin, diorama, reducedMotion);
  const splashes = new Splashes(bin, board.overlay, waterParticles, reducedMotion);
  board.overlay.add(splashes.group);
  // Phase 6: sand levels and the castle flag (castle mode). Highlights ride on raised squares.
  const levels = new SandLevels({ bin, particles: waterParticles, reducedMotion });
  board.group.add(levels.group);
  highlights.setHeights(levels.tops);
  levelsRef = levels;

  // Compile every shader (including hidden effects) before the first visible frame.
  weird.setPrewarm(true);
  chaos.setPrewarm(true);
  squareFx.setPrewarm(true);
  sink.setPrewarm(true);
  treasures.setPrewarm(true);
  island.setPrewarm(true);
  splashes.setPrewarm(true);
  levels.setPrewarm(true);
  waterParticles.points.visible = true;
  highlights.setAllVisible(true);
  for (const t of Object.values(tex)) renderer.initTexture(t);
  await renderer.compileAsync(scene, camera);
  stage.render(0);
  weird.setPrewarm(false);
  chaos.setPrewarm(false);
  squareFx.setPrewarm(false);
  sink.setPrewarm(false);
  treasures.setPrewarm(false);
  island.setPrewarm(false);
  splashes.setPrewarm(false);
  levels.setPrewarm(false);
  waterParticles.points.visible = false;
  highlights.setAllVisible(false);

  let paused = false;
  let disposed = false;
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
      island.update(dt, elapsed);
      highlights.update(dt, elapsed);
      squareFx.update(dt, elapsed);
      chaos.update(dt);
      sink.update(dt, elapsed);
      treasures.update(dt, elapsed);
      splashes.update(dt);
      const levelsMoving = levels.animating;
      levels.update(dt, elapsed);
      if (levelsMoving) picker.invalidate();
      waterParticles.update(dt);
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
    setSquareEffects(effects: SquareEffect[]) {
      squareFx.set(effects);
      dirty = true;
    },
    playChaos(outcome: WheelOutcome, o?: ChaosOptions) {
      return chaos.play(outcome, o);
    },
    setSunk(sunk: Square[], warn: Square[]) {
      sink.set(sunk, warn);
      dirty = true;
    },
    setTreasures(list: TreasureState[]) {
      treasures.set(list);
      dirty = true;
    },
    setIslandMode(on: boolean) {
      island.set(on);
      dirty = true;
    },
    setLevels(l: Partial<Record<Square, Level>>, o?: { tide?: boolean; instant?: boolean }) {
      levels.set(l, o);
      picker.invalidate();
      dirty = true;
    },
    squareTop(square: Square) {
      const { x, z } = squareToXZ(square);
      return new THREE.Vector3(x, levels.topY(square), z);
    },
    setFlag(flag: { square: Square; side: Side } | null) {
      levels.setFlag(flag);
      dirty = true;
    },
    setFresh(squares: Square[]) {
      sink.setFresh(squares);
      dirty = true;
    },
    setMeadowTiers(look: 'turf' | 'sand') {
      levels.setMeadowLook(look);
      dirty = true;
    },
    splash(point: THREE.Vector3, big?: boolean) {
      splashes.play(point, big);
      dirty = true;
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
      chaos.dispose();
      squareFx.dispose();
      sink.dispose();
      treasures.dispose();
      island.dispose();
      splashes.clear();
      levels.dispose();
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
