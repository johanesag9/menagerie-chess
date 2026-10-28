/**
 * Normal and Crazy on the 3D board: how each power, card, bonus, bonk and wheel result plays out.
 * Every function here runs inside a Director task, so core stays paused until it resolves.
 */
import gsap from 'gsap';
import { Vector3 } from 'three';
import type {
  AudioCue, AudioEngine, BoardChange, Cast, CardResult, ChangeHow, DuelInfo, GameEventMap, Level, MoveStyle, PieceActor, PieceId, PowerResult, Side,
  Square, TreasureState, Ui, World,
} from '../contracts/types';
import { TIDE_TIMING } from '../world';
import type { PieceBoard } from './pieces';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const NAME: Record<Side, string> = { land: 'Land', sea: 'Sea' };
const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');

type TreasureChange = Extract<BoardChange, { type: 'treasure' }>;
const TREASURE_CUE: Record<TreasureChange['event'], AudioCue> = {
  pickup: 'pickup', drop: 'drop', return: 'treasureHome', score: 'score', snatch: 'treasureHome', throw: 'catch', intercept: 'intercept',
};

/** BoardChange travel -> cast travel style (see `ChangeHow` in the contracts). */
const STYLE: Record<ChangeHow, MoveStyle> = {
  sidestep: 'sidestep', jump: 'jump', pushed: 'pushed', teleport: 'teleport', swap: 'teleport',
  dig: 'dig', step: 'step', swept: 'swept', quake: 'quake', sentHome: 'teleport',
};

export interface ModeShowDeps {
  board: PieceBoard;
  world: World;
  cast: Cast;
  ui: Ui;
  audio: AudioEngine;
  reducedMotion: () => boolean;
  /** Party modes: where an animal stands now (the pigeon takes a carried treasure from there). */
  squareOf?: (id: PieceId) => Square | undefined;
}

export class ModeShow {
  /** Raid: the treasures as the changes play out (reset from every `state` snapshot). */
  treasures: TreasureState[] = [];
  /** Sandcastle King: square levels as the changes play out (reset from every `state` snapshot). */
  levels: Partial<Record<Square, Level>> = {};
  /** Stepping Stones: water squares as the changes play out (reset from every `state` snapshot). */
  sunk = new Set<Square>();

  constructor(private d: ModeShowDeps) {}

  private get board() { return this.d.board; }

  /** Play changes step by step; changes that share a step play together. */
  async changes(changes: BoardChange[], skipCaptureOf?: string): Promise<void> {
    const steps = [...new Set(changes.map((c) => c.step))].sort((a, b) => a - b);
    for (const step of steps) {
      await Promise.all(changes.filter((c) => c.step === step).map((c) => this.change(c, skipCaptureOf)));
    }
  }

  private async change(c: BoardChange, skipCaptureOf?: string): Promise<void> {
    const { audio } = this.d;
    switch (c.type) {
      case 'move': {
        const a = this.board.get(c.pieceId);
        if (!a) return;
        if (c.how === 'pushed') void a.hit();
        if (c.how === 'swept' || c.how === 'quake') void a.hit();
        await a.moveTo(this.board.point(c.to), { style: this.styleFor(a, c.how, c.to) });
        return;
      }
      case 'capture': {
        if (c.pieceId === skipCaptureOf) return;
        const victim = this.board.get(c.pieceId);
        if (!victim) return;
        const by = c.by ? this.board.get(c.by) : undefined;
        if (by) await by.attack(victim);
        this.board.forget(victim.id);
        void victim.defeat(by ?? victim).then(() => victim.dispose());
        return;
      }
      case 'spawn': {
        const a = this.board.spawn(c.piece, false);
        audio.play('revive');
        await a.appear();
        return;
      }
      case 'promote': {
        const old = this.board.get(c.pieceId);
        const side: Side = old?.side ?? (c.pieceId.startsWith('land') ? 'land' : 'sea');
        this.board.remove(c.pieceId);
        const fresh = this.board.spawn({ id: c.newId, side, kind: c.kind, square: c.square }, true);
        audio.play('promote');
        await this.board.popsDone();
        void fresh.celebrate();
        return;
      }
      case 'status': {
        const a = this.board.get(c.pieceId);
        if (!a) return;
        audio.play(c.status === 'stunned' ? 'stun' : 'freeze');
        a.setStatus(c.status);
        await a.hit();
        return;
      }
      case 'block':
        // The vase or ink shows from the `modeState` snapshot that follows.
        audio.play('block');
        return;
      case 'recharge': {
        audio.play('recharge');
        for (const id of c.pieceIds) this.board.get(id)?.emote('love');
        await wait(400);
        return;
      }
      case 'fall': {
        // Sumo: totter, tumble into the sea (the cast's `splash` event brings the water and the sound), then gone.
        const a = this.board.get(c.pieceId);
        if (!a) return;
        this.board.forget(a.id);
        await a.fall(new Vector3(c.dir[0], 0, -c.dir[1]).normalize());
        a.dispose();
        return;
      }
      case 'treasure':
        return this.treasure(c);
      // Phase 6
      case 'level': {
        // The animal's build or dig gesture has already played (ArenaMatch); the tier lands now and anyone on it rides.
        audio.play(c.cause === 'build' ? 'build' : c.cause === 'dig' ? 'dig' : 'tideWear');
        this.setLevel(c.square, c.to);
        await this.ride([c.square]);
        return;
      }
      case 'water': {
        if (c.sunk) this.sunk.add(c.square);
        else this.sunk.delete(c.square);
        this.d.world.setSunk([...this.sunk], []);
        audio.play(c.sunk ? 'sinkStone' : 'raise');
        await wait(this.d.reducedMotion() ? 150 : 450);
        return;
      }
      case 'enter': {
        const a = this.board.spawn(c.piece, false);
        audio.play('draftPick');
        await a.appear();
        return;
      }
    }
  }

  /** Steps between heights hop (climb); a long flat step is a knight hop (Leaper). */
  private styleFor(a: PieceActor, how: ChangeHow, to: Square): MoveStyle {
    if (how !== 'step' && how !== 'jump') return STYLE[how];
    const dest = this.board.local(to);
    if (Math.abs(dest.y - a.object.position.y) > 0.01) return 'climb';
    if (how === 'step' && a.object.position.distanceTo(dest) > this.d.world.squareSize * 1.6) return 'jump';
    return STYLE[how];
  }

  /** Sandcastle King: one square's tier changes now (the world animates it). */
  setLevel(sq: Square, level: Level): void {
    if (level) this.levels[sq] = level;
    else delete this.levels[sq];
    this.d.world.setLevels?.({ ...this.levels });
  }

  /** Animals standing on squares whose height changed ride up or down with the sand. */
  async ride(squares: Square[]): Promise<void> {
    const rides: Promise<unknown>[] = [];
    for (const sq of squares) {
      const id = this.pieceOn(sq);
      const a = id ? this.board.get(id) : undefined;
      if (!a) continue;
      const y = this.board.local(sq).y;
      if (Math.abs(a.object.position.y - y) < 1e-4) continue;
      rides.push(gsap.to(a.object.position, { y, duration: this.d.reducedMotion() ? 0.15 : 0.4, ease: 'power2.inOut' }).then());
    }
    await Promise.all(rides);
  }

  private pieceOn(sq: Square): PieceId | undefined {
    return this.board.all().find((a) => this.d.squareOf?.(a.id) === sq)?.id;
  }

  /** Raid: a treasure is picked up, dropped, sent home or scored. */
  private async treasure(c: TreasureChange): Promise<void> {
    const before = this.treasures.find((t) => t.owner === c.owner)?.carrier ?? null;
    if (c.event === 'throw' || c.event === 'intercept') await this.flight(c, before);
    if (before && before !== c.carrier) this.board.get(before)?.setCarrying(null);
    if (c.carrier && c.carrier !== before) this.board.get(c.carrier)?.setCarrying(c.owner);
    this.treasures = this.treasures.map((t) => (t.owner === c.owner ? { ...t, square: c.square, carrier: c.carrier } : t));
    this.d.world.setTreasures(this.treasures);
    this.d.audio.play(TREASURE_CUE[c.event]);
    if (c.event === 'score') {
      if (before) void this.board.get(before)?.celebrate();
      await this.d.ui.announce(`${NAME[other(c.owner)]} scores!`, 'good');
    } else await wait(c.event === 'pickup' ? 250 : 400);
  }

  async power(r: PowerResult): Promise<void> {
    const { audio } = this.d;
    const actor = this.board.get(r.pieceId);
    audio.play(`power:${r.power}`);
    if (!actor) return this.changes(r.changes);
    const aim = (sq?: Square) => (sq ? this.board.point(sq) : undefined);
    switch (r.power) {
      case 'headbutt': {
        const victimMove = r.changes.find((c) => c.type === 'move');
        const victim = victimMove?.type === 'move' ? this.board.get(victimMove.pieceId) : undefined;
        const home = this.board.pointOf(actor);
        await actor.powerUp('headbutt', aim(r.targets[0]));
        if (victim) await actor.attack(victim);
        await Promise.all([actor.moveTo(home()), this.changes(r.changes)]);
        return;
      }
      case 'stomp':
        await actor.powerUp('stomp');
        this.d.world.shake(this.d.reducedMotion() ? 0 : 0.45);
        await this.changes(r.changes);
        return;
      case 'block':
        await actor.powerUp('block', aim(r.targets[0]));
        await this.changes(r.changes);
        return;
      case 'doubleJump':
        await actor.powerUp('doubleJump', aim(r.targets[1]));
        await this.changes(r.changes);
        return;
      default: // sidestep, escape
        await actor.powerUp(r.power, aim(r.targets[r.targets.length - 1]));
        await this.changes(r.changes);
    }
  }

  async card(r: CardResult): Promise<void> {
    await this.d.ui.showCardPlayed(r.side, r.card, r.joker);
    await this.changes(r.changes);
  }

  /** The defender won the duel: the attacker lunges, gets bonked and wobbles home. */
  async bonk(info: DuelInfo): Promise<void> {
    const attacker = this.board.get(info.attackerId);
    const victim = this.board.get(info.victimId);
    if (!attacker) return;
    const home = this.board.pointOf(attacker);
    if (victim) await attacker.attack(victim);
    this.d.audio.play('bonk');
    void victim?.emote('laugh');
    await attacker.hit();
    await attacker.moveTo(home(), { style: 'bonked' });
  }

  /** Before the defender decides: the two animals size each other up. */
  faceOff(info: DuelInfo): void {
    const attacker = this.board.get(info.attackerId);
    const victim = this.board.get(info.victimId);
    if (attacker && victim) {
      attacker.lookAt(victim.object.getWorldPosition(new Vector3()));
      victim.lookAt(attacker.object.getWorldPosition(new Vector3()));
    }
    attacker?.emote('taunt');
    victim?.emote('shock');
  }

  async wheel(w: GameEventMap['wheelSpun']): Promise<void> {
    const { ui, world, audio } = this.d;
    await ui.spinWheel(w.outcome);
    audio.play(`chaos:${w.outcome}`);
    switch (w.outcome) {
      case 'tide': {
        const swept = w.changes.flatMap((c) => (c.type === 'move' ? [c.from] : []));
        const t = this.d.reducedMotion() ? TIDE_TIMING.reduced : TIDE_TIMING.normal;
        await Promise.all([world.playChaos('tide', { squares: swept }), wait(t.crest * 1000).then(() => this.changes(w.changes))]);
        return;
      }
      case 'pigeon': {
        const snatch = w.changes.find((c): c is TreasureChange => c.type === 'treasure' && c.event === 'snatch');
        if (snatch) return this.pigeonTreasure(snatch, w.changes);
        const grab = w.changes.find((c) => c.type === 'capture');
        const pawn = grab?.type === 'capture' ? this.board.get(grab.pieceId) : undefined;
        if (!grab || grab.type !== 'capture' || !pawn) {
          await world.playChaos('pigeon');
          return;
        }
        this.board.forget(pawn.id);
        pawn.emote('shock');
        await world.playChaos('pigeon', { squares: [grab.square], carry: pawn.object });
        pawn.dispose();
        await this.changes(w.changes, pawn.id);
        return;
      }
      case 'earthquake':
        await Promise.all([world.playChaos('earthquake', { direction: w.direction }), this.changes(w.changes)]);
        return;
      case 'disco':
        await Promise.all([world.playChaos('disco'), this.changes(w.changes)]);
        return;
    }
  }

  /** Raid "pass and run": the thrower winds up and the treasure arcs to the catcher, or straight home when an enemy intercepts it. */
  private async flight(c: TreasureChange, thrower: PieceId | null): Promise<void> {
    const { world, audio } = this.d;
    const to = c.event === 'throw' ? (c.carrier ? this.d.squareOf?.(c.carrier) : undefined) : (c.square ?? undefined);
    const from = c.from ?? (thrower ? this.d.squareOf?.(thrower) : undefined);
    const actor = thrower ? this.board.get(thrower) : undefined;
    audio.play('toss');
    if (actor && to) await actor.toss?.(this.board.point(to));
    actor?.setCarrying(null);
    if (c.event === 'intercept' && c.by) this.board.get(c.by)?.emote('taunt');
    if (from && to && world.flyTreasure) await world.flyTreasure(c.owner, from, to, { intercepted: c.event === 'intercept' });
    else await wait(350);
  }

  /** Raid pigeon: it grabs a treasure (off the ground or out of a carrier's mouth) and drops it somewhere else. */
  private async pigeonTreasure(snatch: TreasureChange, changes: BoardChange[]): Promise<void> {
    const t = this.treasures.find((x) => x.owner === snatch.owner);
    const from = t?.square ?? (t?.carrier ? this.d.squareOf?.(t.carrier) : undefined);
    if (t?.carrier) {
      const carrier = this.board.get(t.carrier);
      carrier?.setCarrying(null);
      carrier?.emote('shock');
    }
    // The world hides the treasure while the pigeon has it; it lands at `to`.
    this.treasures = this.treasures.map((x) => (x.owner === snatch.owner ? { ...x, square: null, carrier: null } : x));
    this.d.world.setTreasures(this.treasures);
    if (from && snatch.square) await this.d.world.playChaos('pigeon', { treasure: { owner: snatch.owner, from, to: snatch.square } });
    else await this.d.world.playChaos('pigeon');
    await this.changes(changes);
  }

  /** Banana peel: after the move lands, slip on one more square. */
  async slip(actor: PieceActor, to: Vector3): Promise<void> {
    this.d.audio.play('slip');
    await actor.moveTo(to, { style: 'slip' });
  }
}
