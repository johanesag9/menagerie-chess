import type { CreateGame } from '../contracts/factories';
import { MenagerieGame } from './controller';
import { createWorkerModeBot } from './modes/botClient';
import { createStockfishWorkerEngine } from './stockfishWorker';

/**
 * The game controller used by the app. Classic: chess.js rules, Stockfish bot, Weird Mode.
 * Normal and Crazy: core's own rules engine and a custom bot in a Web Worker.
 */
export const createGame: CreateGame = () =>
  new MenagerieGame({ classic: { createEngine: createStockfishWorkerEngine }, modes: { createBot: createWorkerModeBot } });

export { BOT_LEVELS } from './bot';
export type { CoreMoveResult } from './game';
export { DEFAULT_TUNING, getTuning, setTuning, type Tuning } from './modes/tuning';
