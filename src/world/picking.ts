/**
 * Mouse and touch picking. A tap or click on a piece or a square emits `squareClicked`;
 * orbit drags and pinches never do. Mouse hover emits `squareHovered` (checked once per frame).
 * Pieces win over the board, so tapping an animal's head picks the square it stands on.
 * Both events also carry `boardSquare`: the board square under the pointer, ignoring pieces.
 * Objects with `userData.noPick = true` (or under such a parent) are ignored.
 */
import * as THREE from 'three';
import type { Emitter } from '../contracts/emitter';
import type { Square, WorldEventMap } from '../contracts/types';
import { rayToBoardXZ, rayToColumns, xzToSquare } from './coords';
import { TapTracker } from './tap';

export class Picker {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private ray = new THREE.Ray();
  private inv = new THREE.Matrix4();
  private tap = new TapTracker();
  private hoverPoint: { x: number; y: number } | null = null;
  private hoverDirty = false;
  private hovered: Square | null = null;
  private hoveredBoard: Square | null = null;
  private listeners: [string, EventListener][] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private boardGroup: THREE.Object3D,
    private pieceLayer: THREE.Object3D,
    private events: Emitter<WorldEventMap>,
    private hooks: {
      canPick: () => boolean;
      onPress: () => void;
      /** Phase 6: raised squares (height of each top above the board, index file * 8 + rank) and their half width. */
      columns?: () => { heights: ArrayLike<number>; half: number } | null;
    },
  ) {
    this.raycaster.camera = camera as THREE.PerspectiveCamera;
    const on = <K extends keyof HTMLElementEventMap>(name: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      canvas.addEventListener(name, fn as EventListener);
      this.listeners.push([name, fn as EventListener]);
    };
    const tp = (e: PointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, button: e.button });
    on('pointerdown', (e) => {
      this.hooks.onPress();
      this.tap.down(tp(e), e.timeStamp);
    });
    on('pointermove', (e) => {
      this.tap.move(tp(e));
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        this.hoverPoint = { x: e.clientX, y: e.clientY };
        this.hoverDirty = true;
      }
    });
    on('pointerup', (e) => {
      if (!this.tap.up(tp(e), e.timeStamp) || !this.hooks.canPick()) return;
      const { square, boardSquare } = this.pickBoth(e.clientX, e.clientY);
      if (square) this.events.emit('squareClicked', { square, boardSquare });
    });
    on('pointercancel', (e) => this.tap.cancel(tp(e)));
    on('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.hoverPoint = null;
      this.hoverDirty = true;
    });
  }

  /** The square under a screen point, or null. */
  pick(clientX: number, clientY: number): Square | null {
    return this.pickBoth(clientX, clientY).square;
  }

  /** The picked square (pieces first) and the board square under the point (pieces ignored). */
  pickBoth(clientX: number, clientY: number): { square: Square | null; boardSquare: Square | null } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { square: null, boardSquare: null };
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    // The board's top plane, in board-local space so it works while the board tilts.
    this.boardGroup.updateMatrixWorld();
    this.inv.copy(this.boardGroup.matrixWorld).invert();
    this.ray.copy(this.raycaster.ray).applyMatrix4(this.inv);
    const o = this.ray.origin, d = this.ray.direction;
    const p = rayToBoardXZ(o.x, o.y, o.z, d.x, d.y, d.z);
    let boardSquare = p ? xzToSquare(p.x, p.z) : null;
    // Phase 6: a raised square's top or side is hit before the flat board behind it.
    const cols = this.hooks.columns?.();
    if (cols) {
      const hit = rayToColumns(o.x, o.y, o.z, d.x, d.y, d.z, cols.heights, cols.half);
      if (hit) boardSquare = hit.square;
    }

    // Pieces win: the square of the piece that was hit.
    if (this.pieceLayer.children.length) {
      const hits = this.raycaster.intersectObjects(this.pieceLayer.children, true);
      for (const hit of hits) {
        const top = this.pieceRoot(hit.object);
        if (!top) continue;
        const sq = xzToSquare(top.position.x, top.position.z);
        if (sq) return { square: sq, boardSquare };
      }
    }
    return { square: boardSquare, boardSquare };
  }

  /** Walks up to the direct child of pieceLayer; null if anything on the way is noPick. */
  private pieceRoot(o: THREE.Object3D): THREE.Object3D | null {
    let cur: THREE.Object3D | null = o;
    while (cur && cur.parent !== this.pieceLayer) {
      if (cur.userData?.noPick) return null;
      cur = cur.parent;
    }
    if (!cur || cur.userData?.noPick || !cur.visible) return null;
    return cur;
  }

  /** Once per frame: resolve the hovered square if the mouse moved. */
  update(): void {
    if (!this.hoverDirty) return;
    this.hoverDirty = false;
    const { square, boardSquare } = this.hoverPoint && this.hooks.canPick()
      ? this.pickBoth(this.hoverPoint.x, this.hoverPoint.y)
      : { square: null, boardSquare: null };
    if (square !== this.hovered || boardSquare !== this.hoveredBoard) {
      this.hovered = square;
      this.hoveredBoard = boardSquare;
      this.events.emit('squareHovered', { square, boardSquare });
    }
  }

  /** Re-check hover next frame (the camera or board moved under a still mouse). */
  invalidate(): void {
    if (this.hoverPoint) this.hoverDirty = true;
  }

  dispose(): void {
    for (const [name, fn] of this.listeners) this.canvas.removeEventListener(name, fn);
    this.listeners = [];
  }
}
