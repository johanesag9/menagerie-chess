/// <reference lib="webworker" />
/** Web Worker entry for the Normal/Crazy bot: runs the search off the main thread. */
import { decide, type SearchRequest } from './search';

self.onmessage = (e: MessageEvent<{ id: number; req: SearchRequest }>) => {
  const { id, req } = e.data;
  let action = null;
  try {
    action = decide(req);
  } catch (err) {
    console.warn('[core] mode bot search failed', err);
  }
  (self as unknown as Worker).postMessage({ id, action });
};
