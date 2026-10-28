/**
 * The stable `game` and `arena` objects of the online client. They have the exact local interfaces, so the 3D app
 * can drive them like local controllers:
 * - reads come from the current mirror (an idle placeholder before the first game);
 * - the interactive reads (`legalTargets`, `powerInfo`, `canPlayCard`, `targets`, `pieceOptions`) only offer
 *   your own pieces on your own turn, so the friend's moves never light up;
 * - actions send an input to the room instead of changing the mirror; the change shows when the room
 *   broadcasts it back. Inputs that aren't yours are refused here (`Not your turn`);
 * - `move()` sends and returns null (the result arrives as `moved`); `act()` returns `{ ok: true }` once sent;
 * - `resign()` always resigns you; `sendEmote()` only sends your own;
 * - `newGame`, `undo`, `pause` and `dispose` do nothing; `resume()` tells the room this screen is idle.
 * Listeners live on the proxy, so they survive new games and rematches.
 */
import type { NetInput } from '../contracts/net';
import type {
  ActionInput, ActResponse, ArenaAction, ArenaController, ArenaEventMap, ArenaPieceOptions, EmoteKind, GameController,
  GameEventMap, Hand, MoveInput, MoveResult, PendingAction, PieceId, PowerInfo, Side, Square, TargetStep, Unsubscribe,
} from '../contracts/types';
import type { OnlineClientImpl } from './client';

/** Why you can't act now, or null when it's your move. */
function notYours(c: OnlineClientImpl): string | null {
  const m = c.match;
  if (!m || c.you === null) return 'No game yet';
  const w = m.awaiting();
  if (w.kind === 'none') return 'The game is over';
  if (w.kind === 'answer' || w.kind === 'throw') return 'A duel is on';
  return w.side === c.you ? null : 'Not your turn';
}

function submit(c: OnlineClientImpl, input: NetInput): ActResponse {
  const why = notYours(c) ?? c.match!.check(input);
  if (why) return { ok: false, reason: why };
  return c.sendInput(input) ? { ok: true } : { ok: false, reason: 'Not connected' };
}

function answer(c: OnlineClientImpl, call: boolean): void {
  const w = c.match?.awaiting();
  if (w?.kind === 'answer' && w.side === c.you) c.sendInput({ k: 'duel', side: w.side, call });
}

function throwHand(c: OnlineClientImpl, side: Side, hand: Hand): void {
  const m = c.mirror;
  const w = m?.match.awaiting();
  if (!m || w?.kind !== 'throw' || side !== c.you || !w.sides.includes(side)) return;
  const round = `${m.game}:${m.applied}`; // the room holds my throw, so the count only moves once both are in
  if (c.thrownRound === round) return;
  if (c.sendInput({ k: 'throw', side, hand })) c.thrownRound = round;
}

function resign(c: OnlineClientImpl): void {
  const m = c.match;
  if (m && c.you && !m.isOver()) c.sendInput({ k: 'resign', side: c.you });
}

const NO_STEP: TargetStep = { squares: [], complete: false, prompt: 'Not your turn' };

class GameProxy implements GameController {
  constructor(private c: OnlineClientImpl) {}
  private get g() { return this.c.readGame; }
  private mine(square: Square): boolean {
    const you = this.c.you;
    return you === null || (notYours(this.c) === null && this.g.pieces.some((p) => p.square === square && p.side === you));
  }

  on<K extends keyof GameEventMap>(name: K, fn: (payload: GameEventMap[K]) => void): Unsubscribe {
    return this.c.gameEvents.on(name, fn);
  }

  get fen() { return this.g.fen; }
  get turn() { return this.g.turn; }
  get pieces() { return this.g.pieces; }
  get history() { return this.g.history; }
  get mode() { return this.g.mode; }
  get modeState() { return this.g.modeState; }
  get log() { return this.g.log; }
  isOver() { return this.g.isOver(); }
  needsPromotion(from: Square, to: Square) { return this.g.needsPromotion(from, to); }
  previewArea(pending: PendingAction) { return this.g.previewArea(pending); }

  legalTargets(from: Square): Square[] {
    return this.mine(from) ? this.g.legalTargets(from) : [];
  }

  powerInfo(pieceId: PieceId): PowerInfo {
    const info = this.g.powerInfo(pieceId);
    const you = this.c.you;
    if (!info.available || you === null) return info;
    const p = this.g.pieces.find((x) => x.id === pieceId);
    return p?.side === you && notYours(this.c) === null ? info : { ...info, available: false, reason: 'notYourTurn' };
  }

  canPlayCard(side: Side, cardId: string): boolean {
    if (this.c.you !== null && (side !== this.c.you || notYours(this.c) !== null)) return false;
    return this.g.canPlayCard(side, cardId);
  }

  targets(pending: PendingAction): TargetStep {
    return this.c.you !== null && notYours(this.c) !== null ? NO_STEP : this.g.targets(pending);
  }

  act(input: ActionInput): ActResponse {
    if (input.type === 'move' && !this.legalTargets(input.from).includes(input.to)) {
      return { ok: false, reason: notYours(this.c) ?? 'Illegal move' };
    }
    return submit(this.c, { k: 'act', side: this.c.you ?? this.g.turn, input });
  }

  move(input: MoveInput): MoveResult | null {
    this.act({ type: 'move', ...input });
    return null;
  }

  answerDuel(call: boolean): void { answer(this.c, call); }
  throwHand(side: Side, hand: Hand): void { throwHand(this.c, side, hand); }
  resign(_side: Side): void { resign(this.c); }
  sendEmote(side: Side, emote: EmoteKind): void {
    if (side === this.c.you) this.c.sendEmote(emote);
  }
  resume(): void { this.c.sendIdle(); }
  newGame(): void {}
  undo(): void {}
  pause(): void {}
  dispose(): void {}
}

class ArenaProxy implements ArenaController {
  constructor(private c: OnlineClientImpl) {}
  private get a() { return this.c.readArena; }

  on<K extends keyof ArenaEventMap>(name: K, fn: (payload: ArenaEventMap[K]) => void): Unsubscribe {
    return this.c.arenaEvents.on(name, fn);
  }

  get state() { return this.a.state; }
  get log() { return this.a.log; }
  previewArea(pending: Parameters<ArenaController['previewArea']>[0]) { return this.a.previewArea(pending); }

  pieceOptions(pieceId: PieceId): ArenaPieceOptions {
    const o = this.a.pieceOptions(pieceId);
    const you = this.c.you;
    if (you === null) return o;
    const p = this.a.state.pieces.find((x) => x.id === pieceId);
    if (p?.side === you && notYours(this.c) === null) return o;
    return { ...o, steps: [], hits: [], hitCosts: [], power: { ...o.power, available: false, reason: o.power.reason ?? 'notYourTurn' } };
  }

  targets(pending: { pieceId: PieceId; targets: Square[] }): TargetStep {
    return this.c.you !== null && notYours(this.c) !== null ? NO_STEP : this.a.targets(pending);
  }

  act(action: ArenaAction): ActResponse {
    return submit(this.c, { k: 'arena', side: this.c.you ?? this.a.state.turn, action });
  }

  answerDuel(call: boolean): void { answer(this.c, call); }
  throwHand(side: Side, hand: Hand): void { throwHand(this.c, side, hand); }
  resign(_side: Side): void { resign(this.c); }
  resume(): void { this.c.sendIdle(); }
  newGame(): void {}
  pause(): void {}
  dispose(): void {}
}

export const makeGameProxy = (c: OnlineClientImpl): GameController => new GameProxy(c);
export const makeArenaProxy = (c: OnlineClientImpl): ArenaController => new ArenaProxy(c);
