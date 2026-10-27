# Core stream report (Phase 3: Normal and Crazy)

## How to run the playtest
- Start the `core-demo` launch config (port 4411), then open http://localhost:4411/src/core/demo.html.
- Pick **Classic**, **Normal** or **Crazy**, local or vs bot, a bot level, and optionally a **seed** (same seed = same dice, cards and wheel). Press **New game**.
- How to play:
  - Click a piece: its moves show as dots, and a panel shows its power with a **Use** button (or why it can't: Used, Stunned, Frozen, No target, Not now).
  - Aiming a power or card: violet rings are the squares you can pick; a soft violet wash shows what it will affect. **Cancel** backs out.
  - Crazy: each side's bar shows powers left, duel tokens, "card in N", captured animals and the hand. Cards you can't play are greyed. The die, round and "wheel in N" are in the status line. A lucky 6 shows Recharge / Pawn step / Skip.
  - Duels pop up over the board. In local games a cover says who should take the device before each secret pick.
  - The wheel result shows as a banner. 💫 = stunned, 🧊 = frozen (with turns left), 🏺 = Land block, ⚫ = Sea ink (with plies left). A gold dot on a piece = its power is still ready.
  - Under the board is a plain-English log ("Sea 🐠 Seahorse double-jumped b8→c6→e5 and bonked Land's 🐎 Horse"). The move list shows powers, cards, wheel and passes between moves.
- **Tuning** (closed panel on the right): change card odds, hand size, draw interval, duel tokens, tie limit, wheel interval and odds, die faces, block/stun/freeze lengths and bot strength. **Apply** starts a new game with them. The knobs live in `src/core/modes/tuning.ts`.
- `window.coreGame` is the controller, for the console. Tests: `npm test`. Types: `npm run typecheck`.

## What's done
- **Normal and Crazy rules engine** (`src/core/modes/`), separate from Classic. Classic is untouched: still chess.js + Stockfish, and its tests still pass.
  - `state.ts`: an 8×8 board model, FEN in and out, stable ids (promotions get `-promo<N>`, a revived piece keeps its id).
  - `rules.ts`: moves, all six powers, all five cards and four joker outcomes, both lucky bonuses, the banana slide, the four wheel results, statuses, blocked squares, castling and en passant rules, and game-over checks.
  - `game.ts`: the controller with every Phase 3 `GameController` member and the event order from `docs/phase3-briefs.md`, duels, passes, clocks (stopped during duels), pause holds, undo (Normal only) and Weird Mode (Normal).
  - `controller.ts`: `createGame()` now returns one controller that runs Classic or Normal/Crazy depending on `GameOptions.mode`.
- **Custom bot** (`search.ts`, `botWorker.ts`, `botClient.ts`): alpha-beta over moves, powers and cards in a Web Worker. It also takes lucky bonuses, answers duels (always for its king, more often for big pieces and when it has spare tokens) and throws at random. Level 1 = depth 1 with 35% random actions; level 8 = depth 4 within 1.5s (depth 3 usually completes; the time cap stops depth 4 early).

## Rules choices where the spec was silent
1. **Normal: nothing may capture a king.** Otherwise a double jump could "take" a king that wasn't in check.
2. **Normal king safety is judged after blocks tick down** at the start of the opponent's turn, so a vanishing block can never leave your own king capturable.
3. **Normal insufficient material** is Classic's: K v K, K + one knight or bishop v K, or only same-coloured bishops.
4. **Your own stunned or frozen pieces can't be targeted by your own swap, dig, lucky step, lucky recharge or joker teleport.** Party and Disco still recharge them.
5. **♣ Freeze can't target a piece already frozen for the full length** (it would do nothing). Stomp is allowed even if every neighbour is already frozen longer.
6. **A lucky 6 always gives the bonus choice**, even when neither bonus is possible; you press Skip. If you then have no action, the turn passes.
7. **Revive:** the captured list shows animals as they were captured. A promoted piece comes back as a pawn, keeping its promo id. A revived pawn on its 2nd rank can double-push.
8. **Swap** works on any two of your pieces, even two of the same kind.
9. **Card draws:** the counter starts at 3, so your first draw is at the start of your 3rd turn. A skipped draw (full hand) still resets the counter.
10. **The wheel** spins at the start of Land's turn in rounds 6, 11, 16 and so on.
11. **Fifty-move rule** counts every turn, passes included. **Threefold (Normal)** also compares used powers, statuses and blocks (with turns left), castling and en passant.
12. **Timeouts** in Normal/Crazy use Classic's rule: a lone king (or king + one minor) can't win on time.
13. **The bot's search treats a Joker as Party** (no dice in the search), as the brief allows.

## Contract requests
1. **Event order after a bonk.** Core sends `bonked`, then `logged` ("Bonked! …"), then `check` if the defender's king is attacked, then `modeState`, `turnChanged`. The brief said "straight to step 4", but `logged` lists bonks, and the HUD needs the king-in-danger warning. The same goes for a pass: `turnPassed`, `logged`, `check` (if any), `modeState`, `turnChanged`. Please confirm or tell me to drop them.
2. **No signal for "throw again" after a tie.** Today a `duelRound` with `result: 'tie'` and no `duelEnded` right after means "ask for new throws". A `duelThrowNeeded { side }` event, or a `duel` field in `ModeState` with the round and who still has to throw, would make this explicit.
3. **`SideModeState.captured` shows the kind at capture.** A promoted queen comes back as a pawn. A `reviveAs?: PieceKind` on each entry would let the revive picker show that.
4. `setTuning()`, `getTuning()` and `DEFAULT_TUNING` are exported from `src/core/index.ts` (not in the contract, as the brief asked).

## Open design questions for Johanes
1. **Normal: should a double jump be allowed to take the king?** Right now it can't (choice 1 above).
2. **Lucky 6 with nothing to take:** show the choice anyway (now), or skip it automatically?
3. **Bot levels 1–3:** level 1 plays a random action 35% of the time, level 3 looks 2 moves ahead with 12% random. Please play them and tell me if they feel playful, not cruel.
4. All the defaults in GAME_SPEC "Defaults in the mode rules" are in the tuning file, including "Tide pulls Sea back too" (off).

## Known issues
- The bot at levels 7–8 rarely finishes depth 4 within 1.5s; it plays its depth-3 answer then.
- Undo doesn't rewind the Weird Mode countdown (same as Classic; harmless).
- The demo board squares are 43px at 390px wide, just under the 44px touch target. It's a dev tool.
- Emoji stand-ins: 🐠 and 🐟 stand in for the seahorse and blobfish.
