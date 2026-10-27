/**
 * The controller the app gets from `createGame()`. It holds a Classic game (chess.js + Stockfish)
 * and a Normal/Crazy game (core's own rules), and forwards the events of whichever one `newGame` picked.
 */
import { Emitter } from '../contracts/emitter';
import type {
  ActionInput, ActResponse, EmoteKind, GameController, GameEventMap, GameEventName, GameOptions, Hand, MoveInput,
  PendingAction, PieceId, Side, Square, Unsubscribe,
} from '../contracts/types';
import { CoreGame, type CoreDeps } from './game';
import { ModeGame, type ModeDeps } from './modes/game';

const EVENTS: GameEventName[] = [
  'gameStarted', 'moved', 'turnChanged', 'check', 'gameOver', 'clock', 'botThinking', 'weirdEvent', 'undone', 'emote',
  'modeState', 'powerUsed', 'cardPlayed', 'bonusUsed', 'dieRolled', 'cardDrawn', 'turnPassed', 'logged', 'wheelSpun',
  'duelOffered', 'duelRound', 'duelEnded', 'bonked',
];

export class MenagerieGame implements GameController {
  private events = new Emitter<GameEventMap>();
  readonly classic: CoreGame;
  readonly modes: ModeGame;
  private active: CoreGame | ModeGame;

  constructor(deps: { classic?: CoreDeps; modes?: ModeDeps } = {}) {
    this.classic = new CoreGame(deps.classic);
    this.modes = new ModeGame(deps.modes);
    this.active = this.classic;
    for (const source of [this.classic, this.modes]) {
      for (const name of EVENTS) {
        source.on(name, (payload) => {
          if (source === this.active) this.events.emit(name, payload as never);
        });
      }
    }
  }

  on<K extends keyof GameEventMap>(name: K, fn: (payload: GameEventMap[K]) => void): Unsubscribe {
    return this.events.on(name, fn);
  }

  newGame(options: GameOptions): void {
    const target = (options.mode ?? 'classic') === 'classic' ? this.classic : this.modes;
    const prev = this.active;
    this.active = target;
    try {
      target.newGame(options);
    } catch (err) {
      this.active = prev; // a bad FEN leaves the current game as it was
      throw err;
    }
    if (prev !== target) prev.halt();
  }

  get fen() { return this.active.fen; }
  get turn() { return this.active.turn; }
  get pieces() { return this.active.pieces; }
  get history() { return this.active.history; }
  get mode() { return this.active.mode; }
  get modeState() { return this.active.modeState; }
  get log() { return this.active.log; }
  isOver() { return this.active.isOver(); }
  legalTargets(from: Square) { return this.active.legalTargets(from); }
  needsPromotion(from: Square, to: Square) { return this.active.needsPromotion(from, to); }
  move(input: MoveInput) { return this.active.move(input); }
  undo() { this.active.undo(); }
  resign(side: Side) { this.active.resign(side); }
  sendEmote(side: Side, emote: EmoteKind) { this.active.sendEmote(side, emote); }
  pause() { this.active.pause(); }
  resume() { this.active.resume(); }
  act(input: ActionInput): ActResponse { return this.active.act(input); }
  powerInfo(pieceId: PieceId) { return this.active.powerInfo(pieceId); }
  canPlayCard(side: Side, cardId: string) { return this.active.canPlayCard(side, cardId); }
  targets(pending: PendingAction) { return this.active.targets(pending); }
  previewArea(pending: PendingAction) { return this.active.previewArea(pending); }
  answerDuel(call: boolean) { this.active.answerDuel(call); }
  throwHand(side: Side, hand: Hand) { this.active.throwHand(side, hand); }

  dispose(): void {
    this.classic.dispose();
    this.modes.dispose();
    this.events.clear();
  }
}
