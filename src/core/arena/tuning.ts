/**
 * Every Sumo/Raid number Johanes may want to change after playtesting, in one place (GAME_SPEC "Party modes").
 * `setArenaTuning()` overrides them for games started after the call (the playtest's Tuning panel uses it).
 * Each game copies the tuning when it starts, so a running game never changes under you.
 */
import type { BotLevel, PieceKind, Side, Square, WheelOutcome } from '../../contracts/types';

export interface ArenaBotLevel {
  /** Longest action sequence the bot plans in one turn. */
  maxActions: number;
  /** Sequences kept at each depth of the turn search. */
  beam: number;
  /** Chance of a random action instead of the planned one (keeps low levels playful). */
  randomChance: number;
  /** Random points added to each score (0 = always the best plan). */
  noise: number;
  /** Also count what the other side could do to it next turn. */
  lookahead: boolean;
  /** Shortest time the bot appears to think before each action. */
  minThinkMs: number;
}

export interface ArenaTuning {
  /** AP for die faces 1..6. */
  apTable: [number, number, number, number, number, number];
  stepCost: number;
  /** Raid: a step while carrying a treasure. */
  carrierStepCost: number;
  /** Sumo shove. */
  shoveCost: number;
  /** Sumo shove when the animal you push is heavy. */
  heavyShoveCost: number;
  heavyKinds: PieceKind[];
  /** Raid tag. */
  tagCost: number;
  powerCost: number;
  /** Raid pawn Sidestep ("one free step sideways"). */
  sidestepCost: number;
  /** Sumo: a ring sinks at the end of each of these rounds (outer ring first). At most 3 rings; the middle 2×2 stays. */
  sinkRounds: number[];
  /** Sumo: squares a Headbutt pushes. */
  headbuttSquares: number;
  sumoMaxRounds: number;
  raidMaxRounds: number;
  /** Raid: points to win. */
  pointsToWin: number;
  /** Raid: where each side's treasure lies (inside its own half, not on the back rank). */
  treasureHomes: Record<Side, Square>;
  /** Raid: points for picking the enemy treasure up from its home (a dropped one gives none). */
  grabPoints: number;
  /** Raid: points for carrying it into your own half. */
  scorePoints: number;
  /** Raid: a tag stuns an animal that isn't carrying, where it stands. Off = sent home, like a tagged carrier. */
  tagStuns: boolean;
  /** Raid: the tide also sweeps Sea animals out of Land's half. Off = Land only. */
  tideBothWays: boolean;
  /** Raid: you can't stand on your own treasure's home square. */
  noGuarding: boolean;
  duelTokens: number;
  /** Tied throws in a row before the attacker wins. */
  tieLimit: number;
  /** Raid: the wheel spins at the start of Land's turn after every Nth round. */
  wheelEvery: number;
  wheelOdds: Record<WheelOutcome, number>;
  blockPlies: number;
  /** Raid Stomp and tag: owner's turns the stun lasts. */
  stunTurns: number;
  bot: Record<BotLevel, ArenaBotLevel>;
}

export const DEFAULT_ARENA_TUNING: ArenaTuning = {
  apTable: [2, 2, 3, 3, 4, 4],
  stepCost: 1,
  carrierStepCost: 2,
  shoveCost: 2,
  heavyShoveCost: 3,
  heavyKinds: ['k', 'r'],
  tagCost: 1,
  powerCost: 2,
  sidestepCost: 0,
  sinkRounds: [3, 6, 9],
  headbuttSquares: 2,
  sumoMaxRounds: 15,
  raidMaxRounds: 12,
  pointsToWin: 5,
  treasureHomes: { land: 'e3', sea: 'd6' },
  grabPoints: 1,
  scorePoints: 2,
  tagStuns: true,
  tideBothWays: true,
  noGuarding: true,
  duelTokens: 2,
  tieLimit: 3,
  wheelEvery: 5,
  wheelOdds: { tide: 1, pigeon: 1, earthquake: 1, disco: 1 },
  blockPlies: 4,
  stunTurns: 1,
  bot: {
    1: { maxActions: 2, beam: 2, randomChance: 0.3, noise: 60, lookahead: false, minThinkMs: 650 },
    2: { maxActions: 3, beam: 3, randomChance: 0.2, noise: 40, lookahead: false, minThinkMs: 600 },
    3: { maxActions: 3, beam: 4, randomChance: 0.12, noise: 25, lookahead: false, minThinkMs: 550 },
    4: { maxActions: 4, beam: 4, randomChance: 0.05, noise: 12, lookahead: true, minThinkMs: 500 },
    5: { maxActions: 4, beam: 6, randomChance: 0.02, noise: 6, lookahead: true, minThinkMs: 450 },
    6: { maxActions: 4, beam: 8, randomChance: 0, noise: 3, lookahead: true, minThinkMs: 420 },
    7: { maxActions: 4, beam: 10, randomChance: 0, noise: 1, lookahead: true, minThinkMs: 400 },
    8: { maxActions: 4, beam: 12, randomChance: 0, noise: 0, lookahead: true, minThinkMs: 400 },
  },
};

let current: ArenaTuning = cloneArenaTuning(DEFAULT_ARENA_TUNING);

/** The tuning new arena games will use. */
export function getArenaTuning(): ArenaTuning {
  return cloneArenaTuning(current);
}

/** Override some knobs for arena games started from now on. Pass `null` to go back to the defaults. */
export function setArenaTuning(patch: Partial<ArenaTuning> | null): void {
  current = patch === null ? cloneArenaTuning(DEFAULT_ARENA_TUNING) : cloneArenaTuning({ ...current, ...patch });
}

export function cloneArenaTuning(t: ArenaTuning): ArenaTuning {
  return JSON.parse(JSON.stringify(t)) as ArenaTuning;
}
