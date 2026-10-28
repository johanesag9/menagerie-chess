# Core stream report

## Phase 4: party modes (Sumo, Raid)

### What's done
- `createArena()` in `src/core/index.ts`: the Sumo and Raid engine behind `ArenaController`, following the clarified contract (b0547e8): `previewArea` gives `{area, falls}`, `sank` lists `sunk` and `sinkingNext`, falls share their shove's step, PowerInfo has `name`/`line`/`note`, anchored ends at the start of the owner's next turn.
- Both modes play start to finish, local and vs bot.
- Bot: a beam search over up to 4 actions per turn, levels 1–8, in a Web Worker. It answers duels and throws at random.
- **Raid "quick raids" (Johanes, 2026-10-28)**, now the default. These differ from GAME_SPEC; the old values are still knobs.
  - Treasures sit at e3 (bone) and d6 (pearl).
  - Grabbing the enemy treasure from its home scores 1. Carrying it into your own half scores 2 more. First to 5 wins; the round cap is 12.
  - A tag stuns an animal where it stands for its next turn, and a stunned animal can't be tagged.
  - The tide sweeps both sides back toward their own half.
  - "Pass and run" (throwing) waits for the contract; see Contract requests.
- Every rule number is a knob in `src/core/arena/tuning.ts`, editable in the playtest's Tuning panel.
- Tests: 60 rules tests (`arena/sumo.test.ts`, `arena/raid.test.ts`) and a fuzz of 200 seeded games per mode (`arena/fuzz.*.test.ts`, about 8 s each). The fuzz checks that options match the legal moves, that the board rebuilt from events matches the state, the event order, and that illegal actions are refused. `ARENA_FUZZ_GAMES=10` runs a quick sample.
- `npm run typecheck` passes and `npm test` passes (316 tests, Classic/Normal/Crazy included).
- Checked in the browser at 1280px and 390px: all four (Sumo/Raid × local/bot) reach game over with no console errors and no sideways scroll.

### How to run the playtest
- Start the `core-demo` launch config (port 4411), then open http://localhost:4411/src/core/arena.html.
- Pick **Sumo** or **Raid**, local or vs bot, a bot level, and an optional **seed** (same seed = same dice and wheel). Press **New game**.
- Click one of your animals: dots are its steps, red rings its shoves (Sumo) or tags (Raid) with their AP cost. Hover a red ring to see the shove line; 💦 marks who would fall. The panel under the board has the power button.
- The pips show the AP left; **End turn** gives up the rest. Water is blue; squares that sink at the end of this round wobble with a dashed outline.
- `window.arena` is the controller, for the console. The Phase 3 page (`/src/core/demo.html`) still works.

### Rules choices where the spec was silent
Raid
- The enemy home is closed while its treasure is away (you can only enter it to grab the treasure).
- A headbutt or escape that would land on your own home is refused, same as "stays put".
- Block can't go on a home or a treasure square.
- A headbutt needs a free square behind the target.
- **A tagged carrier is still sent home and drops the treasure** (not stunned in place). If it stayed, it would stand on the dropped treasure. Also, the treasure would go home right next to it, so it could grab again for a free point every other turn. Knob: `tagStuns` (off = every tag sends home).
- The grab point only counts when the treasure lay at its home; picking up a dropped one scores nothing.
- A score that jumps past the target (4 + 2) still wins.
- Tide and earthquake moves follow the normal arrival rules (pickup, scoring). Sent-home squares skip treasure squares.

Sumo
- An anchored (Dig in) animal can still act; it just can't be shoved.
- The heavy shove cost (3 AP) depends on the victim only (king, rook).

Events and log
- The sink log entry has kind `'wheel'`.
- A game that ends mid-turn sends no `turnChanged`.
- A bonk sends no `acted`; running out of AP ends the turn with no log entry of its own.

### Contract requests
- **Throw ("pass and run", approved by Johanes):**
  - A new action `{ type: 'throw'; pieceId; to: Square }`. Only a carrier can throw, to a teammate in a straight line up to 2 squares away, for 1 AP.
  - The catcher becomes the carrier, and scores at once if it stands in its own half.
  - If an enemy stands on the square in between, it intercepts: it owns the treasure, so the treasure flies home.
  - `ArenaPieceOptions` needs a `throws: Square[]` list.
  - The treasure change needs new events, `'throw'` and `'intercept'` (or one `'throw'` with `carrier` = the catcher, null when intercepted), so 3D can play a flight.
  - Core will build it once the contract is in.
- **Grab points:** a grab from home now adds to `score` with the `pickup` change. 3D can read it from the `state` score diff; a flag on `pickup` (e.g. `points: 1`) would be clearer.
- Comments in `types.ts` still say bone e1 / pearl d8 and "tagged → sent home". Homes come from `TreasureState.home`, and a tag on a non-carrier now sends a `status` change (stunned), not a `sentHome` move.
- PowerKind has no `'digIn'`; `PowerInfo.name`/`note` cover it.

### Open design questions for Johanes
- **Raid balance, after quick raids.** Bot vs bot, Raid:

  | Rules | Land wins | Sea wins | Draws | Points per game | Ends in round |
  |---|---|---|---|---|---|
  | First version, level 8 (16 games) | 0 | 0 | 16 | 0 | 20 (the cap) |
  | Quick raids, level 5 (20 games) | 11 | 9 | 0 | Land 4.7, Sea 3.9 | about 6 |
  | Quick raids, level 8 (16 games) | 11 | 5 | 0 | Land 5.1, Sea 3.4 | about 6 |

  Every game now has scoring and a winner. Treasures are grabbed about 5–6 times a game and brought home about 2 times, so there are plenty of chases.
  - Land, which moves first, wins about 60–65%: its first turn can already reach the pearl. A possible fix is fewer AP on Land's first turn; it isn't built yet.
  - Games are short, about 6 rounds. "First to 7" makes them about 8 rounds, but Land then won 14 of 20.
  - Same-rules tag that sends home (`tagStuns` off) played almost the same in the bot games.
- **Sumo seems to favour Sea** (the spec already flags that Sea moves last before each sink). In a small sample the level 8 bot won 6/6 as Sea, 3/6 as Land.
- Bot levels 1–3 make a random move some of the time on purpose (30% at level 1). Should they feel more playful than that?

### Known issues
- GAME_SPEC's Raid section still describes the first version; the orchestrator owns it.
- On a heavily loaded machine the bot can take over a second on a turn (normally a few ms), and old time-limited Phase 3 tests can time out. Re-run them alone.
- The playtest is a flat 2D dev tool with emoji stand-ins, not the game look.

# Phase 3 report (Normal and Crazy, unchanged)

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
- **Tests** (`npm test`): `normal.test.ts` (31: every power, blocked cases, mate by block, stalemate by stuns, threefold, fifty-move, undo, promotion), `crazy.test.ts` (43: every card and joker outcome incl. when they can't be played, every wheel result and its edge cases, every banana-slide shape, both lucky bonuses, duels incl. ties, bonks, the king, the bot on either side, king capture, passes, no undo, card draws), and a fuzz test (`fuzz.normal.test.ts`, `fuzz.crazy.test.ts`): 200 seeded bot-vs-bot games per mode. After every step it checks that legal actions are accepted and illegal ones refused, `targets()` matches the legal list, a piece map rebuilt from events alone matches `pieces` (so ids stay stable), `modeState` fits `pieces`, and in Normal your own king is never left attacked. Classic's tests are unchanged.
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
2. **Signal for "throw now".** Core sends a `modeState` with phase `'duel'` at the start of every throw round: after the defender calls, and again after each tie. That is the cue to ask for hands (the demo does this). A dedicated event, or a `duel` field in `ModeState` with the round and who still has to throw, would be clearer.
3. **`SideModeState.captured` shows the kind at capture.** A promoted queen comes back as a pawn. A `reviveAs?: PieceKind` on each entry would let the revive picker show that.
4. `setTuning()`, `getTuning()` and `DEFAULT_TUNING` are exported from `src/core/index.ts` (not in the contract, as the brief asked).

## Open design questions for Johanes
1. **Normal: should a double jump be allowed to take the king?** Right now it can't (choice 1 above).
2. **Lucky 6 with nothing to take:** show the choice anyway (now), or skip it automatically?
3. **Bot levels 1–3:** level 1 plays a random action 35% of the time, level 3 looks 2 moves ahead with 12% random. Please play them and tell me if they feel playful, not cruel.
4. All the defaults in GAME_SPEC "Defaults in the mode rules" are in the tuning file, including "Tide pulls Sea back too" (off).

## Known issues
- The fuzz games add about 25s of CPU time to `npm test` (two files that run side by side). On a very busy machine, two of Classic's time-limited tests (the random-games id check and the bot game) can time out. They did here at load average 70–130, even when run alone; they don't touch the new code.
- The bot at levels 7–8 rarely finishes depth 4 within 1.5s; it plays its depth-3 answer then.
- Undo doesn't rewind the Weird Mode countdown (same as Classic; harmless).
- The demo board squares are 43px at 390px wide, just under the 44px touch target. It's a dev tool.
- Emoji stand-ins: 🐠 and 🐟 stand in for the seahorse and blobfish.
