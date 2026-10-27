# Core stream report

## What's done
- **`createGame()`** in `src/core/index.ts` returns the `GameController` from the contracts, built on chess.js.
  - Full rules: castling, en passant, promotion, check, mate, stalemate, threefold, fifty-move, insufficient material.
  - Events after a move, in this order: `moved`, `check` (if any), `turnChanged`, `gameOver` (if any). After that come a `weirdEvent` (Weird Mode only) and a `clock` update.
- **Stable piece ids** (`ids.ts`): `land-n-g1` style. Promoted pieces get `land-q-e8-promo1`: the square they appeared on, plus a counter for the game.
  - Ids are tracked through captures, en passant, castling and promotion, and restored exactly on undo.
  - `MoveResult` fills `pieceId`, `captured` (the real square for en passant), `rookMove` and `flags`.
- **Bot** (`bot.ts`, `stockfishWorker.ts`): Stockfish 19 lite, single-threaded WASM, in a Web Worker. It needs no special server headers and works in `vite build` output too (checked).
  - Levels 1–8 map to skill, depth and think time. Tune them in `BOT_LEVELS` in `bot.ts`.
  - Levels 1–3 sometimes play a random move, so they feel human. Each level also has a short minimum "thinking" time, so replies don't snap in.
  - In timed games the bot limits its think time from its own clock.
  - If Stockfish fails to load, a simple stand-in bot keeps the game going and a warning is logged.
- **Clocks** (`clock.ts`): untimed, or start time plus increment. A `clock` event fires about 10 times a second while a clock runs.
  - When a flag falls, the opponent wins. It's a draw if the opponent has only a king, or a king and one knight or bishop.
- **`pause()`/`resume()`** freeze the clocks. The bot keeps thinking, but holds its move until `resume()`.
- **Undo:** one move in local games. Against the bot it takes back the bot's reply and your move, and also works while the bot is still thinking. It emits `undone` with the restored pieces.
  - You can undo after checkmate or a draw, but not after a resignation or a timeout.
- `resign`, `sendEmote`, `legalTargets`, `needsPromotion`, and FEN start. A bad FEN throws an error with a clear message (for example `Invalid FEN: each side needs exactly one king`) and leaves the current game untouched.
- **Weird Mode** (`weird.ts`): an event every 4–6 moves (counting each side's move), never the same kind twice in a row, with sensible focus squares. It only reads the board, never changes it.
- **Tests:** 42 vitest tests in `src/core/*.test.ts`.
  - Every case in the brief: castling, en passant ids, promotion ids, undo against the bot, threefold, stalemate, timeout, insufficient material, and id stability over a full game.
  - Also 15 random full games that check ids against the board after every move, clocks and pause, Weird Mode timing, and real Stockfish in node (level 8 finds a mate in one).

## How to run the demo
- Start the `core-demo` launch config (port 4411), then open http://localhost:4411/src/core/demo.html.
- The demo shows:
  - a 2D board with emoji stand-ins (🐠 and 🐟 stand in for the seahorse and blobfish)
  - local or bot play, the level picker, Land/Sea for the bot, and time controls
  - Weird Mode, FEN load, undo, resign, pause, flip board, copy FEN and emotes
  - a "show piece ids" toggle and a live event log
  - a "fake 0.6s move animation" toggle, which runs the pause/resume flow integration will use
- `window.coreGame` is the controller, for poking at it in the console.
- Tests: `npm test`. Types: `npm run typecheck`. Both pass.

## Contract requests
1. **`MoveResult.promotedId?: PieceId`.** Integration needs the new piece's id when a pawn promotes. Core already adds it at runtime (type `CoreMoveResult` in `src/core/game.ts`). Until it's in the contract, integration can read `game.pieces` at `move.to`.
2. **Optional: `GameController.botLevels` or level names.** The UI invents its own level names. Core exports `BOT_LEVELS` (skill and timing only) if that helps.
3. **Optional: a `paused` flag on the `clock` event.** While paused, core sends `running: null`, so the HUD can't tell "paused" from "stopped". It isn't needed if integration tracks its own pause.

## Open design questions for Johanes
1. **When do clocks start?** Now: after the first move. Land's first move is free, then Sea's clock starts (like lichess). The other option is to start Land's clock as soon as the game begins.
2. **Fifty-move rule and threefold end the game automatically** (no "claim draw" button). This is simpler for casual play.
3. **Timeout draw rule:** a lone king, or a king with one knight or bishop, can't win on time. FIDE's rule is stricter (any possible mate counts). This one is simpler and common online.
4. **Promotion without a choice defaults to a queen.** The UI should still ask, using `needsPromotion`.
5. **Bot strength:** level 1 plays a random move 30% of the time. Please play levels 1–3 and tell me whether they feel right.
6. **Bot "thinking" time** is at least 0.4–0.7s, so it doesn't feel instant. Tell me if that should be longer.
7. **Licence:** Stockfish is GPL-3.0. Shipping it in a public web game means the game's source must be offered under GPL too. Fine for a hobby project, but worth deciding before any commercial release.

## Known issues
- The real Stockfish worker can't run in vitest (no Web Worker in node). The browser path was checked by hand in dev and in a production build. The node test runs the same engine build through the npm package.
- The demo board squares are 43px at 390px wide, just under the 44px touch target. It's a dev tool; the real board is the world stream's.
- Undo doesn't rewind the Weird Mode countdown. It keeps counting forward, which is harmless.
- The Stockfish files add about 1.2 MB gzipped. They download only when the first bot game starts.
