/**
 * Normal and Crazy on the 3D board: how each power, card, bonus, bonk and wheel result plays out.
 * Every function here runs inside a Director task, so core stays paused until it resolves.
 */
import { Vector3 } from 'three';
import type {
  AudioEngine, BoardChange, Cast, CardResult, ChangeHow, DuelInfo, GameEventMap, MoveStyle, PieceActor, PowerResult, Side, Square, Ui, World,
} from '../contracts/types';
import { TIDE_TIMING } from '../world';
import type { PieceBoard } from './pieces';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** BoardChange travel -> cast travel style (see `ChangeHow` in the contracts). */
const STYLE: Record<ChangeHow, MoveStyle> = {
  sidestep: 'sidestep', jump: 'jump', pushed: 'pushed', teleport: 'teleport', swap: 'teleport',
  dig: 'dig', step: 'step', swept: 'swept', quake: 'quake',
};

export interface ModeShowDeps {
  board: PieceBoard;
  world: World;
  cast: Cast;
  ui: Ui;
  audio: AudioEngine;
  reducedMotion: () => boolean;
}

export class ModeShow {
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
        await a.moveTo(this.board.point(c.to), { style: STYLE[c.how] });
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
    }
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

  /** Banana peel: after the move lands, slip on one more square. */
  async slip(actor: PieceActor, to: Vector3): Promise<void> {
    this.d.audio.play('slip');
    await actor.moveTo(to, { style: 'slip' });
  }
}
