import type { CreateArena, CreateGame } from '../contracts/factories';
import { ArenaGame } from './arena/game';
import { createWorkerArenaBot } from './arena/botClient';
import { MenagerieGame } from './controller';
import { createWorkerModeBot } from './modes/botClient';
import { createStockfishWorkerEngine } from './stockfishWorker';

/**
 * The game controller used by the app. Classic: chess.js rules, Stockfish bot, Weird Mode.
 * Normal and Crazy: core's own rules engine and a custom bot in a Web Worker.
 */
export const createGame: CreateGame = () =>
  new MenagerieGame({ classic: { createEngine: createStockfishWorkerEngine }, modes: { createBot: createWorkerModeBot } });

/** Phase 4: Sumo and Raid (GAME_SPEC "Party modes"). Its bot searches in a Web Worker. */
export const createArena: CreateArena = () => new ArenaGame({ createBot: createWorkerArenaBot });

export { BOT_LEVELS } from './bot';
export type { CoreMoveResult } from './game';
export { DEFAULT_TUNING, getTuning, setTuning, type Tuning } from './modes/tuning';
export { DEFAULT_ARENA_TUNING, getArenaTuning, setArenaTuning, type ArenaTuning } from './arena/tuning';
