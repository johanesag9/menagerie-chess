/**
 * The animals on the board: one PieceActor per live PieceId, kept in step with core's pieces.
 */
import gsap from 'gsap';
import type { Vector3 } from 'three';
import type { Cast, PieceActor, PieceId, PieceState, Side, SkinChoice, Square, World } from '../contracts/types';

export class PieceBoard {
  private actors = new Map<PieceId, PieceActor>();
  private skins: Record<Side, SkinChoice>;
  private pops: gsap.core.Tween[] = [];

  constructor(private world: World, private cast: Cast, skins: Record<Side, SkinChoice>) {
    this.skins = { ...skins };
  }

  get(id: PieceId): PieceActor | undefined {
    return this.actors.get(id);
  }

  all(): PieceActor[] {
    return [...this.actors.values()];
  }

  /** Position inside the piece layer (board at rest). */
  local(sq: Square) {
    return this.world.squareToWorld(sq);
  }

  /** Live world point for a square, for cast moveTo/lookAt (the board may be tilting or hopping). */
  point(sq: Square) {
    // Fresh matrices: the cast converts back with them, and Weird Mode may have moved the board since the last frame.
    this.world.pieceLayer.updateWorldMatrix(true, false);
    return this.world.pieceLayer.localToWorld(this.world.squareToWorld(sq));
  }

  /** Remembers where an actor stands now; call the result later for that spot's live world point (to send it back home). */
  pointOf(a: PieceActor): () => Vector3 {
    const local = a.object.position.clone();
    return () => {
      this.world.pieceLayer.updateWorldMatrix(true, false);
      return this.world.pieceLayer.localToWorld(local.clone());
    };
  }

  spawn(state: PieceState, pop = false): PieceActor {
    this.actors.get(state.id)?.dispose();
    const a = this.cast.createPiece(state, this.skins[state.side]);
    a.object.position.copy(this.local(state.square));
    this.world.pieceLayer.add(a.object);
    this.actors.set(state.id, a);
    if (pop) this.pop(a);
    return a;
  }

  remove(id: PieceId): void {
    this.actors.get(id)?.dispose();
    this.actors.delete(id);
  }

  /** Stop tracking a piece without freeing it (a captured piece playing its defeat). */
  forget(id: PieceId): void {
    this.actors.delete(id);
  }

  /**
   * Make the board match `pieces` exactly. Pieces already standing on the right square stay;
   * anything missing or misplaced pops in fresh, anything extra is removed.
   */
  sync(pieces: PieceState[], pop: boolean): void {
    const want = new Map(pieces.map((p) => [p.id, p]));
    for (const [id, a] of this.actors) {
      const p = want.get(id);
      const onBoard = a.object.parent === this.world.pieceLayer;
      const here = p && onBoard && a.kind === p.kind && a.object.position.distanceToSquared(this.local(p.square)) < 1e-4;
      if (!here) this.remove(id);
    }
    let i = 0;
    for (const p of pieces) {
      if (this.actors.has(p.id)) continue;
      const a = this.spawn(p, false);
      if (pop) this.pop(a, i++ * 0.025);
    }
  }

  /** Finish any pop-in right away (click to skip). */
  finishPops(): void {
    for (const t of this.pops) t.progress(1);
    this.pops = [];
  }

  /** Resolves when every pop-in has finished. */
  popsDone(): Promise<void> {
    const live = this.pops.filter((t) => t.isActive() || t.progress() < 1);
    return Promise.all(live.map((t) => t.then(() => undefined))).then(() => undefined);
  }

  setSkin(side: Side, skin: SkinChoice): void {
    const prev = this.skins[side];
    if (prev.palette === skin.palette && prev.accessory === skin.accessory) return;
    this.skins[side] = { ...skin };
    for (const a of this.actors.values()) if (a.side === side) a.setSkin(skin);
  }

  update(dt: number, elapsed: number): void {
    for (const a of this.actors.values()) a.update(dt, elapsed);
  }

  clear(): void {
    this.finishPops();
    for (const id of [...this.actors.keys()]) this.remove(id);
  }

  /** A springy scale-in. The actor's scale is its square size, so the tween ends exactly there. */
  private pop(a: PieceActor, delay = 0): void {
    const s = a.object.scale.x;
    a.object.scale.setScalar(s * 0.001);
    const t = gsap.to(a.object.scale, { x: s, y: s, z: s, duration: 0.45, delay, ease: 'back.out(2.2)' });
    this.pops.push(t);
  }
}
