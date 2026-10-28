/**
 * One game's core plus what it waits for. Shared by the client's mirror and the fake room, so both read
 * "whose input is next" the same way. Core keeps its duel stage private, so we follow it from its events.
 */
import type { NetInput } from '../contracts/net';
import type {
  ArenaController, ArenaEventMap, DuelInfo, GameController, GameEventMap, GameOptions, GameOver, Hand, Side, Square,
} from '../contracts/types';
import { isArenaMode } from '../contracts/types';

export type Core = { kind: 'game'; ctl: GameController } | { kind: 'arena'; ctl: ArenaController };

/** Every event name, checked by the compiler against the maps (adding one to core's map fails here until listed). */
const GAME_EVENT_SET: Record<keyof GameEventMap, true> = {
  gameStarted: true, moved: true, turnChanged: true, check: true, gameOver: true, clock: true, botThinking: true,
  weirdEvent: true, undone: true, emote: true, modeState: true, powerUsed: true, cardPlayed: true, bonusUsed: true,
  dieRolled: true, cardDrawn: true, turnPassed: true, logged: true, wheelSpun: true, duelOffered: true, duelRound: true,
  duelEnded: true, bonked: true,
};
const ARENA_EVENT_SET: Record<keyof ArenaEventMap, true> = {
  started: true, state: true, rolled: true, acted: true, sank: true, wheelSpun: true, duelOffered: true, duelRound: true,
  duelEnded: true, bonked: true, turnChanged: true, logged: true, gameOver: true, botThinking: true,
};
export const GAME_EVENTS = Object.keys(GAME_EVENT_SET) as (keyof GameEventMap)[];
export const ARENA_EVENTS = Object.keys(ARENA_EVENT_SET) as (keyof ArenaEventMap)[];

export const HANDS: Hand[] = ['rock', 'paper', 'scissors'];
export const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');

/** What the game waits for next, and from whom. */
export type Awaiting =
  | { kind: 'none' }
  | { kind: 'action' | 'bonus' | 'answer'; side: Side }
  /** `sides`: who still has to throw this round (attacker first). */
  | { kind: 'throw'; sides: Side[]; info: DuelInfo };

export class Match {
  readonly core: Core;
  duel: { stage: 'offer' | 'throw'; info: DuelInfo; thrown: Partial<Record<Side, true>> } | null = null;
  /** The result once the game ends (from core's `gameOver`, which fires even while the client mutes events). */
  result: GameOver | null = null;

  constructor(core: Core) {
    this.core = core;
    const c = core.ctl as GameController & ArenaController; // both have these four events with the same payloads
    c.on('duelOffered', (info: DuelInfo) => (this.duel = { stage: 'offer', info, thrown: {} }));
    c.on('duelRound', () => this.duel && (this.duel.thrown = {}));
    c.on('duelEnded', () => (this.duel = null));
    c.on('gameOver', (g: GameOver) => {
      this.duel = null;
      this.result = g;
    });
  }

  static create(options: GameOptions, make: { game: () => GameController; arena: () => ArenaController }): Match {
    return new Match(isArenaMode(options.mode) ? { kind: 'arena', ctl: make.arena() } : { kind: 'game', ctl: make.game() });
  }

  get turn(): Side {
    return this.core.kind === 'game' ? this.core.ctl.turn : this.core.ctl.state.turn;
  }

  isOver(): boolean {
    return !!this.result || (this.core.kind === 'game' ? !!this.core.ctl.isOver() : this.core.ctl.state.phase === 'over');
  }

  awaiting(): Awaiting {
    if (this.isOver()) return { kind: 'none' };
    const d = this.duel;
    if (d?.stage === 'offer') return { kind: 'answer', side: d.info.defender };
    if (d?.stage === 'throw') {
      const sides = [d.info.attacker, d.info.defender].filter((s) => !d.thrown[s]);
      return { kind: 'throw', sides, info: d.info };
    }
    if (this.core.kind === 'game' && this.core.ctl.modeState?.phase === 'bonus') return { kind: 'bonus', side: this.turn };
    return { kind: 'action', side: this.turn };
  }

  /** Is this input's side the one the game waits on, for this kind of input? Returns a reason when not. */
  check(input: NetInput): string | null {
    if (this.isOver()) return 'The game is over';
    const w = this.awaiting();
    switch (input.k) {
      case 'act':
        if (this.core.kind !== 'game') return 'Wrong kind of input';
        if ((w.kind !== 'action' && w.kind !== 'bonus') || w.side !== input.side) return 'Not your turn';
        if (w.kind === 'bonus' && input.input.type !== 'bonus') return 'Pick your lucky bonus first';
        return null;
      case 'arena':
        if (this.core.kind !== 'arena') return 'Wrong kind of input';
        return w.kind === 'action' && w.side === input.side ? null : 'Not your turn';
      case 'duel':
        return w.kind === 'answer' && w.side === input.side ? null : 'No duel to answer';
      case 'throw':
        if (w.kind !== 'throw') return 'No throw now';
        if (!HANDS.includes(input.hand)) return 'Not a hand';
        return w.sides.includes(input.side) ? null : 'Already thrown';
      case 'resign':
        return null;
    }
  }

  /** Apply an input that passed `check`. Returns a reason when core refused it. */
  apply(input: NetInput): string | null {
    const core = this.core;
    switch (input.k) {
      case 'act': {
        if (core.kind !== 'game') return 'Wrong kind of input';
        const r = core.ctl.act(input.input);
        return r.ok ? null : r.reason;
      }
      case 'arena': {
        if (core.kind !== 'arena') return 'Wrong kind of input';
        const r = core.ctl.act(input.action);
        return r.ok ? null : r.reason;
      }
      case 'duel': {
        const d = this.duel;
        core.ctl.answerDuel(input.call);
        // A decline ends the duel (duelEnded clears it); a call starts the throws.
        if (input.call && d && this.duel === d && d.stage === 'offer') d.stage = 'throw';
        return null;
      }
      case 'throw':
        if (this.duel) this.duel.thrown[input.side] = true; // before: the second throw resolves the round and resets it
        core.ctl.throwHand(input.side, input.hand);
        return null;
      case 'resign':
        core.ctl.resign(input.side);
        this.duel = null;
        return null;
    }
  }

  /** The input the room makes when time runs out for `side` (GAME_SPEC "Online play" defaults). */
  timeoutInput(side: Side, random: () => number = Math.random): NetInput | null {
    const w = this.awaiting();
    const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)];
    switch (w.kind) {
      case 'none':
        return null;
      case 'answer':
        return { k: 'duel', side: w.side, call: false };
      case 'throw':
        return w.sides.includes(side) ? { k: 'throw', side, hand: pick(HANDS) } : null;
      case 'bonus':
        return { k: 'act', side: w.side, input: { type: 'bonus', choice: 'skip' } };
      case 'action': {
        if (this.core.kind === 'arena') return { k: 'arena', side: w.side, action: { type: 'endTurn' } };
        const g = this.core.ctl;
        const moves: { from: Square; to: Square }[] = [];
        for (const p of g.pieces) {
          if (p.side !== w.side) continue;
          for (const to of g.legalTargets(p.square)) moves.push({ from: p.square, to });
        }
        if (!moves.length) return null; // core passes a stuck turn on its own
        const m = pick(moves);
        return { k: 'act', side: w.side, input: { type: 'move', ...m, ...(g.needsPromotion(m.from, m.to) ? { promotion: 'q' as const } : {}) } };
      }
    }
  }

  dispose(): void {
    this.core.ctl.dispose();
  }
}
