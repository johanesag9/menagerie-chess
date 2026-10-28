/**
 * How the arena game talks to its bot. In the browser the search runs in a Web Worker;
 * anywhere else (tests, or if the worker can't start) it runs in-process on a timer.
 */
import type { ArenaAction } from '../../contracts/types';
import { decideArena, type ArenaBotRequest } from './bot';

export interface ArenaBotEngine {
  /** The bot's next action. Null when the search failed. */
  decide(req: ArenaBotRequest): Promise<ArenaAction | null>;
  dispose(): void;
}

export function createLocalArenaBot(): ArenaBotEngine {
  return {
    decide: (req) => new Promise((resolve) => setTimeout(() => resolve(safeDecide(req)), 0)),
    dispose: () => {},
  };
}

function safeDecide(req: ArenaBotRequest): ArenaAction | null {
  try {
    return decideArena(req);
  } catch (err) {
    console.warn('[core] arena bot search failed', err);
    return null;
  }
}

export function createWorkerArenaBot(): ArenaBotEngine {
  if (typeof Worker === 'undefined') return createLocalArenaBot();
  let worker: Worker | null;
  try {
    worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('[core] could not start the arena bot worker; searching on the main thread.', err);
    return createLocalArenaBot();
  }
  const local = createLocalArenaBot();
  const pending = new Map<number, (a: ArenaAction | null) => void>();
  let nextId = 0;
  worker.onmessage = (e: MessageEvent<{ id: number; action: ArenaAction | null }>) => {
    pending.get(e.data.id)?.(e.data.action);
    pending.delete(e.data.id);
  };
  worker.onerror = (e) => {
    console.warn('[core] arena bot worker failed; searching on the main thread from now on.', e.message);
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
