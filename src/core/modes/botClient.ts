/**
 * How the game talks to the Normal/Crazy bot. In the browser the search runs in a Web Worker;
 * anywhere else (tests, or if the worker can't start) it runs in-process on a timer.
 */
import type { ActionInput } from '../../contracts/types';
import { decide, type SearchRequest } from './search';

export interface ModeBotEngine {
  /** The bot's action or bonus choice. Null when it has nothing to do or the search failed. */
  decide(req: SearchRequest): Promise<ActionInput | null>;
  dispose(): void;
}

export function createLocalModeBot(): ModeBotEngine {
  return {
    decide: (req) => new Promise((resolve) => setTimeout(() => resolve(safeDecide(req)), 0)),
    dispose: () => {},
  };
}

function safeDecide(req: SearchRequest): ActionInput | null {
  try {
    return decide(req);
  } catch (err) {
    console.warn('[core] mode bot search failed', err);
    return null;
  }
}

export function createWorkerModeBot(): ModeBotEngine {
  if (typeof Worker === 'undefined') return createLocalModeBot();
  let worker: Worker | null;
  try {
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('[core] could not start the mode bot worker; searching on the main thread.', err);
    return createLocalModeBot();
  }
  const local = createLocalModeBot();
  const pending = new Map<number, (a: ActionInput | null) => void>();
  let nextId = 0;
  worker.onmessage = (e: MessageEvent<{ id: number; action: ActionInput | null }>) => {
    pending.get(e.data.id)?.(e.data.action);
    pending.delete(e.data.id);
  };
  worker.onerror = (e) => {
    console.warn('[core] mode bot worker failed; searching on the main thread from now on.', e.message);
    worker?.terminate();
    worker = null;
    pending.forEach((resolve) => resolve(null));
    pending.clear();
  };
  return {
    decide(req) {
      if (!worker) return local.decide(req);
      const id = ++nextId;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        worker!.postMessage({ id, req });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.forEach((resolve) => resolve(null));
      pending.clear();
    },
  };
}
