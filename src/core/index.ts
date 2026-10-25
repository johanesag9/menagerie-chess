import type { CreateGame } from '../contracts/factories';
import { CoreGame } from './game';
import { createStockfishWorkerEngine } from './stockfishWorker';

/** The game controller used by the app: chess rules, clocks, Stockfish bot, Weird Mode. */
export const createGame: CreateGame = () => new CoreGame({ createEngine: createStockfishWorkerEngine });

export { BOT_LEVELS } from './bot';
export type { CoreMoveResult } from './game';
