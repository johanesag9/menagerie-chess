/**
 * Browser engine: Stockfish 19 "lite, single-threaded" WASM in a classic Web Worker.
 * Runs without cross-origin isolation headers. Vite serves/hashes both files; the worker
 * finds its .wasm through the URL hash (a stockfish.js convention).
 */
import stockfishJsUrl from 'stockfish/bin/stockfish-19-lite-single.js?url';
import stockfishWasmUrl from 'stockfish/bin/stockfish-19-lite-single.wasm?url';
import { StockfishEngine, type BotEngine } from './bot';

export function createStockfishWorkerEngine(): BotEngine | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const wasm = new URL(stockfishWasmUrl, location.href).href;
    const worker = new Worker(`${stockfishJsUrl}#${encodeURIComponent(wasm)}`);
    return new StockfishEngine({
      send: (cmd) => worker.postMessage(cmd),
      onLine: (fn) => worker.addEventListener('message', (e: MessageEvent) => fn(e.data)),
      onError: (fn) => worker.addEventListener('error', (e) => fn(e.message || e)),
      terminate: () => worker.terminate(),
    });
  } catch (err) {
    console.warn('[core] could not start the Stockfish worker; using the simple fallback bot.', err);
    return null;
  }
}
