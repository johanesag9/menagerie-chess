/**
 * Every Normal/Crazy number Johanes may want to change after playtesting, in one place.
 * `setTuning()` overrides them for games started after the call (the demo's Tuning panel uses it).
 * Each game copies the tuning when it starts, so a running game never changes under you.
 */
import type { BotLevel, CardSuit, DieEffect, JokerOutcome, WheelOutcome } from '../../contracts/types';

export interface ModeBotLevel {
  /** Search depth in plies (1 = just look at the result of each action). */
  depth: number;
  /** Chance of a random legal action instead of the best one (keeps low levels playful). */
  randomChance: number;
  /** Search time cap. */
  timeMs: number;
  /** Shortest time the bot appears to think, so replies don't snap in. */
  minThinkMs: number;
}

export interface Tuning {
  /** Draw odds per suit (relative weights). */
  cardOdds: Record<CardSuit, number>;
  /** Cards each side starts with. */
  startHand: number;
  /** A card is drawn at the start of every Nth own turn. */
  drawEvery: number;
  handLimit: number;
  /** Joker outcome odds (relative weights). */
  jokerOdds: Record<JokerOutcome, number>;
  /** Duel tokens per side per game. */
  duelTokens: number;
  /** Tied throws in a row before the attacker wins. */
  tieLimit: number;
  /** The wheel spins at the start of Land's turn after every Nth round. */
  wheelEvery: number;
  wheelOdds: Record<WheelOutcome, number>;
  /** Tide also pulls Sea pieces on the meadow back one rank (fairer; off by default as in the spec). */
  tideBothSides: boolean;
  /** What each die face does, faces 1..6. */
  dieFaces: [DieEffect, DieEffect, DieEffect, DieEffect, DieEffect, DieEffect];
  /** A block lasts this many plies. */
  blockPlies: number;
  /** A stomp stuns for this many of the owner's turns. */
  stunTurns: number;
  /** ♣ Freeze and Joker butterfingers freeze for this many of the owner's turns. */
  freezeTurns: number;
  /** Bot strength per level (Normal and Crazy only; Classic uses Stockfish). */
  bot: Record<BotLevel, ModeBotLevel>;
}

export const DEFAULT_TUNING: Tuning = {
  cardOdds: { hearts: 20, diamonds: 20, clubs: 25, spades: 20, joker: 15 },
  startHand: 1,
  drawEvery: 3,
  handLimit: 3,
  jokerOdds: { party: 1, teleport: 1, butterfingers: 1, double: 1 },
  duelTokens: 3,
  tieLimit: 3,
  wheelEvery: 5,
  wheelOdds: { tide: 1, pigeon: 1, earthquake: 1, disco: 1 },
  tideBothSides: false,
  dieFaces: ['banana', 'none', 'none', 'none', 'none', 'lucky'],
  blockPlies: 4,
  stunTurns: 1,
  freezeTurns: 2,
  bot: {
    1: { depth: 1, randomChance: 0.35, timeMs: 300, minThinkMs: 700 },
    2: { depth: 1, randomChance: 0.2, timeMs: 400, minThinkMs: 700 },
    3: { depth: 2, randomChance: 0.12, timeMs: 600, minThinkMs: 650 },
    4: { depth: 2, randomChance: 0.04, timeMs: 800, minThinkMs: 600 },
    5: { depth: 3, randomChance: 0, timeMs: 1000, minThinkMs: 500 },
    6: { depth: 3, randomChance: 0, timeMs: 1200, minThinkMs: 450 },
    7: { depth: 4, randomChance: 0, timeMs: 1400, minThinkMs: 400 },
    8: { depth: 4, randomChance: 0, timeMs: 1500, minThinkMs: 400 },
  },
};

let current: Tuning = cloneTuning(DEFAULT_TUNING);

/** The tuning new games will use. */
export function getTuning(): Tuning {
  return cloneTuning(current);
}

/** Override some knobs for games started from now on. Pass `null` to go back to the defaults. */
export function setTuning(patch: Partial<Tuning> | null): void {
  current = patch === null ? cloneTuning(DEFAULT_TUNING) : cloneTuning({ ...current, ...patch });
}

export function cloneTuning(t: Tuning): Tuning {
  return JSON.parse(JSON.stringify(t)) as Tuning;
}
