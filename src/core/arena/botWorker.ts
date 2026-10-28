/// <reference lib="webworker" />
/** Web Worker entry for the Sumo/Raid bot: runs the turn search off the main thread. */
import { decideArena, type ArenaBotRequest } from './bot';

self.onmessage = (e: MessageEvent<{ id: number; req: ArenaBotRequest }>) => {
  const { id, req } = e.data;
  let action = null;
  try {
    action = decideArena(req);
  } catch (err) {
    console.warn('[core] arena bot search failed', err);
  }
  (self as unknown as Worker).postMessage({ id, action });
};
