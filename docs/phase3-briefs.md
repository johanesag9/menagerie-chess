# Phase 3 session briefs: game modes (Normal and Crazy)

Four sessions run at the same time, in the same way as Phase 1. Each one runs in its own git worktree and branch.

Every session first reads:
- `CLAUDE.md`, for ownership, rules and done criteria.
- `GAME_SPEC.md`, especially **"Game modes"**. That section is the rulebook.
- The Phase 3 parts of `src/contracts/types.ts`.

`main` already has small **stubs** for every new contract member, so everything still typechecks. They are marked `Phase 3 stubs (orchestrator ...)` in each stream folder. Replace them with the real thing.

Classic mode must keep working exactly as it does today.

---

## Event order (core emits, integration and ui rely on it)
Normal and Crazy only. Classic is unchanged.

**After a move, power or card**

The step in brackets runs only in Crazy, and only when the defender can duel. The `check` step runs only when it applies.

1. *(duel)* `duelOffered`. Core waits for `answerDuel`; the bot answers by itself when it is the defender.
   - If the defender calls the duel: one `duelRound` per throw. Core waits for `throwHand` from each human side; the bot throws by itself.
   - Then `duelEnded`.
   - If the defender won: `bonked`, then go straight to step 4.
2. `moved`, `powerUsed` or `cardPlayed`, then `logged`.
3. `check`, if any. It is about the opponent's king, the side to move next. In Crazy it is only a warning.
4. `modeState`.
5. `turnChanged`.
6. `gameOver`, if any.

**At the start of each turn (Crazy, if the game isn't over)**

These fire right after `turnChanged`. The first two only fire when they're due.
1. `wheelSpun`, then `logged`. If the wheel ends the game (say a pigeon leaves only two kings), `modeState` and `gameOver` come next and nothing more fires.
2. `cardDrawn`
3. `dieRolled`
4. `modeState`. Its phase is `'bonus'` after a 6, otherwise `'action'`.
5. If the side has no legal action: `turnPassed`, `logged`, `modeState`, then `turnChanged` for the other side.

**Lucky bonus.** `act({ type: 'bonus', ... })` emits `bonusUsed` (a skip too, with no changes), `logged`, then `modeState` (phase `'action'`). Aim recharge and pawn step with `targets()`, like a power.

**Statuses and blocked squares.** They tick down at turn start and show up in the next `modeState` snapshot. Core never emits a separate "expired" event; listeners compare snapshots.

**Bot and pause.** When it's the bot's turn, core runs the turn start, bonus and action by itself. Each step still emits its events. The bot holds its next step while core is `pause()`d, exactly like `heldBotMove` today, so integration can animate each step before the next one comes.

**Who needs an answer.** Core waits for a human side in three places: `phase: 'bonus'`, `duelOffered` when the human is the defender, and the throws. Integration asks the ui (`askLucky`, `askDuel`, `askThrow`) and calls core back.

---

## core: rules engine, custom bot, the 2D playtest
**Owns** `src/core/`. **Implements** the Phase 3 `GameController` members and events.

**Build first, so Johanes can play it early: the 2D playtest.**
1. **A rules engine for Normal and Crazy**, separate from Classic. Classic stays on chess.js + Stockfish, untouched. chess.js can't do blocked squares, stuns or king capture, so write a small board model of your own, for example an 8×8 array.
   - Keep stable `PieceId`s: promotions get `-promo<N>`, and a revived piece keeps its old id.
   - Follow the "Game modes" rules exactly. Where they're silent, pick the simplest rule, note it in REPORT.md and keep going.
2. **All Phase 3 `GameController` members.**
   - `act()` takes moves, powers, cards and bonuses.
   - `move()` keeps working as a shortcut.
   - `targets()` and `previewArea()` must agree with `act()`: every square they offer must be legal. Fuzz this.
3. **The events, in the order above.** Rules for what they carry:
   - Every piece change goes in `changes`, with a `step`: same step = played together (a swap, a tide, an earthquake, all stomp victims).
   - Fill in the `BoardChange` cases:
     - Double jump: step 0 `move` (how `jump`) to mid, step 1 `capture` if any, step 2 `move` (how `jump`) to the destination.
     - Headbutt: a `move` (how `pushed`) for the victim.
     - Revive: a `spawn`.
     - Banana-slide promotion, and promotions caused by cards or wheel results: a `promote`.
   - `modeState` is the source of truth for powers, cards, `playableCards`, tokens, statuses, blocks, die and phase.
   - Emit `logged` with a short plain label after every action, and keep `log` for rebuilding the move list after an undo.
4. **The demo becomes the playtest** (`src/core/demo.html`):
   - A mode picker (Classic, Normal, Crazy), local or vs bot, and a seed field.
   - Clicking a piece shows its power button. Then you pick targets with highlighted squares.
   - It also shows:
     - the die, with the lucky choice
     - the card hand, with unplayable cards greyed
     - duel prompts (local games cover the screen between picks)
     - the wheel result as a banner
     - stunned, frozen and blocked squares drawn clearly
     - a plain-English event log ("Seahorse double-jumped and bonked a Pup")
   - Use animal emoji. It's a dev tool, but it must be easy to read on a phone at 390px.
   - **Commit once Normal is playable, and again once Crazy is.** Write REPORT.md early with how to run it, so Johanes can start playing.
5. **Tuning knobs** in one file, `src/core/modes/tuning.ts`:
   - card odds, start hand, draw interval, hand limit
   - duel tokens, tie limit
   - wheel interval and outcome weights
   - die faces
   - block, stun and freeze lengths
   - bot depth per level
   
   Add a small "Tuning" panel to the demo that overrides them live for new games. Export a `setTuning()` for it; don't add it to the contract.

**The custom bot (Normal and Crazy)**
- Run it in a Web Worker so it never blocks the main thread.
- It can do everything a player can: moves, powers, cards, lucky bonuses, duel answers (call a duel to save its king or a valuable piece, more often when it has tokens to spare) and throws (always random).
- Search: alpha-beta over moves, powers and cards, with material plus mobility, plus a small value for powers in hand and cards held. Ignore chance (take the expected outcome for dice and jokers).
- Levels: 1 = depth 1 with 35% random actions, rising to 8 = depth 3 or 4 within about 1.5s. It must feel playful, not cruel, at levels 1–3.
- Keep `botThinking` and the pause hold working for each step.
- In Normal, the bot must never leave its own king in check. In Crazy it may.

**Tests (vitest), real rules tests:**
- Every power, with its blocked cases:
  - used
  - stunned or frozen
  - no target
  - would leave the king in check (Normal)
  - pushing off the board
  - stunning a king
- In Normal:
  - escaping out of check
  - a block that creates mate
  - stalemate caused by stuns
  - threefold repetition including mode state
  - undo restores powers and effects
- Every card and joker outcome, including the cases where it can't be played.
- Every wheel result, including the edge cases:
  - tide chains and blocked squares
  - an earthquake at the board edges and into blocked squares
  - a pigeon taking a pawn that's later revived
- The die: a banana slide in every move shape (including a slide onto the last rank, and a slide stopped by a blocked square or another piece), and both lucky bonuses.
- Duels:
  - on a normal capture and on a double jump (`via`, `mid`)
  - both directions: the bot as defender and the human as defender
  - a tie three times
  - a bonk, which means no slide and the turn ends
  - a king saved by a duel
  - token counts
- Crazy: winning by capturing the king, a turn that passes when there's no action, and no undo.
- A fuzz test: 200 seeded bot-vs-bot games per mode. No exceptions, every action legal, ids stable, and `modeState` always consistent with `pieces`.

**Done:** see `CLAUDE.md`. Also: the playtest can be played start to finish in Normal and in Crazy, both local and vs bot, at desktop size and at 390px.

---

## world: blocked squares, chaos spectacles, aiming highlights
**Owns** `src/world/`. **Implements** `setSquareEffects`, `playChaos`, and `HighlightSet.targets` and `area`.

- **`setSquareEffects(effects)`** shows exactly the blocked squares given. Diff against what's already shown, and animate appear and vanish.
  - **Land block:** the cat knocked a vase over. A toppled flower vase with spilled water and petals.
  - **Sea block:** an octopus ink cloud. A dark swirling blob, slightly raised, with an animated shader.
  - Both must read clearly at 390px from the default camera, and from the Sea side too.
  - Show `turnsLeft` softly: the cloud thins and the puddle shrinks as it runs out.
  - They must not eat clicks: set `noPick`.
- **`playChaos(outcome, opts)`.** Each one is about 1.2–2s, skippable by any click, and gentle under reduced motion.
  - **tide:** a real wave rolls in from the sea over the beach ranks. Foam, a water sheen on the squares, then it recedes. Reuse your `tideSwap` water if it helps. Integration slides the swept pieces with the wave, so time the crest at about 40% of the effect and document the exact moment.
  - **pigeon:** reuse the pigeon. It flies in, grabs `opts.carry` (a piece's `Object3D`) by reparenting it to itself, and flies off-screen with it, wobbling. Detach it before resolving and don't dispose it.
  - **earthquake:** a board rumble, dust puffs and a couple of crack decals that fade. Use the camera shake, respecting reduced motion. `direction` tells you which way the pieces will slide.
  - **disco:** spotlights and a sparkle burst over the whole board, about 1.5s.
- **Highlights:**
  - `targets`: squares you can pick for a power or card. A distinct "magic" violet ring with a slow sparkle. It must be clearly different from the legal-move dots and capture rings.
  - `area`: a soft wash for the squares a power will affect.
- Keep draw calls low. Compile everything new before first use. No hitch on the first wave, pigeon or vase.
- **Demo:** add buttons for:
  - blocked squares (Land and Sea), with a countdown
  - each chaos result (pigeon carrying a stand-in token)
  - `targets` and `area` highlights

---

## cast: power flourishes, travel styles, statuses
**Owns** `src/cast/`. **Implements** `powerUp`, `moveTo`'s `style`, `setStatus`, `hit`, `appear` and the `power` cast event.

- **`powerUp(power, target)`:** 12 flourishes, one per power per side, each in the animal's character. Each resolves at the moment of effect (emit `power` then). About 0.5–0.9s.

| Power | Land | Sea |
|---|---|---|
| sidestep | Pup bows, sniffs and starts digging | Crab clacks its claws and crouches |
| doubleJump | Horse rears with a whinny pose | Seahorse puffs a big bubble |
| headbutt | Goat lowers its horns and paws the ground | Pufferfish inflates |
| stomp | Elephant rears and stomps; a dust ring goes out | Turtle tucks in and slams its shell; a splash ring goes out |
| block | Cat swats toward `target`, and a vase falls there (the world draws the vase itself) | Octopus squirts an ink arc to `target` (the world draws the cloud) |
| escape | Pug spins up for zoomies | Blobfish wobbles and goes gloopy |

- **`moveTo(target, { style })`, every `MoveStyle`:**
  - **sidestep:** the pup burrows and pops up with a dirt trail; the crab scuttles sideways fast.
  - **jump:** one knight hop (two in a row make a double jump).
  - **slip:** a banana peel appears under its feet, it slides with flailing arms, and the peel is left spinning and then fades.
  - **pushed:** a tumble backward.
  - **teleport:** the pug becomes a speed blur that dashes; the blobfish melts into a puddle and reforms. Also used for swaps.
  - **dig:** the pawn burrows backward.
  - **swept:** it floats on a wave with a splash.
  - **quake:** it stumbles sideways.
  - **bonked:** a dizzy waddle back, with stars.
  - **step:** a quick hop forward.
  - Keep each one under about 1.2s.
- **`setStatus`:**
  - stunned: orbiting stars, a wobble and droopy eyes.
  - frozen: encased in an ice block with frost, and the idle stops.
  - Both stay until they're cleared, survive skin changes and are cheap on draw calls.
- **`hit()`:** a flinch with a little "bonk" star.
- **`appear()`:** the revive entrance. Land rises from a dirt mound; Sea bubbles up from a puddle. About 0.8s.
- Everything skips with `skip()`/`skipAll()` and respects reduced motion (`setReducedMotion`).
- **Demo:** for every piece, buttons for its power, every move style, both statuses, `hit` and `appear`. Add a "power showcase" that plays all 12 in a row.

---

## ui (+ audio): mode picker, powers, dice, cards, duels, wheel
**Owns** `src/ui/`, `src/audio/`. **Implements** the Phase 3 `Ui` members and `UiEventMap` events, plus the new `AudioCue`s.

- **Setup:**
  - A mode picker with three big cards (Classic, Normal, Crazy), each with a one-line pitch, and a "How it works" sheet (rules in plain words, taken from GAME_SPEC "Game modes").
  - Put the mode into `GameOptions.mode`.
  - Hide the Weird Mode toggle in Crazy.
  - Remember the last mode.
- **HUD (`setModeState`):**
  - Powers left per side (small icons per piece kind, greyed when used).
  - Duel tokens.
  - The card hand: a fan of cards with big suit symbols and names. Tap one to emit `cardRequested`. Grey out a card when it can't be played; it's greyed when its id is missing from `playableCards` in that side's `SideModeState`.
  - In local games show both hands, but only the side to move can tap.
  - Round number, "Wheel in N", "Card in N".
  - The current die face.
  - `setModeState(null)` hides all of it for Classic.
- **Selection panel (`setSelection`):** the piece's name, its power name, a one-line description and a big "Use power" button, which emits `powerRequested`. When it's unavailable, show why ("Used", "Stunned", "No target").
- **Prompt bar (`setPrompt`):** an aiming hint with a Cancel button, which emits `cancelAction`.
- **`rollDie`:** a chunky CSS 3D d6 that tumbles and lands. The call-outs are "BANANA PEEL!", "LUCKY!" or a quiet "3". About 1s, skippable.
- **`askLucky`:** two choices plus Skip. A choice that can't be used is disabled.
- **`showCardDrawn` / `showCardPlayed`:** the card flies into the hand, or flips big in the middle. Jokers reveal their outcome with a little drumroll.
- **`askRevive`:** a picker of captured animals. Use the existing piece names and icons.
- **`askDuel`:** "Sea's Crab wants to bonk your Pup! Call a duel? (2 tokens left)" with Yes and No.
- **`askThrow`:** three big hands. With `hotSeat`, first show a cover ("Land, take the device — Sea, look away"), then the picker, then cover again.
- **`showDuelRound`:** both hands slam in, the winner is called out, and a tie shows "Again!".
- **`spinWheel`:** a four-slice wheel (Tide, Pigeon, Earthquake, Disco) that spins and ticks down to the outcome, about 2s, skippable, then shows one line of what happens.
- **Move list (`addLog`):** the non-move lines (powers, cards, bonuses, bonks, wheel, passes) sit in the move list between moves, styled a little differently.
- **King in danger:** in Crazy, `showCheck` should say "King in danger!" rather than "Check!". `setGameInfo` tells you the mode.
- **Result screen:** the new reason `kingCaptured` ("by bonking the king").
- Every new overlay works at 390px without covering the board for long, works by keyboard and touch, and respects reduced motion.
- **Audio:** synthesize every new `AudioCue`:
  - `power:*` for each power
  - die rattle, banana slip, lucky jingle
  - card draw/play, joker
  - duel call/throw/win/lose, bonk
  - wheel ticking and stop, the four chaos results
  - stun, freeze, block, revive, recharge
  
  No downloaded sounds.
- **Demo:** every new overlay with fake data, plus a scripted "Crazy turn" button that runs: wheel, then card draw, then die, then lucky, then duel, then card played.

---

## Integration (orchestrator, after the four merge)
`src/app/` handles the new events:
- It plays the cast animations, world effects and ui overlays in order through the Director, with core paused while they run.
- Input: clicking a piece selects it and shows its power. Aiming walks `targets()` with highlights, then calls `act()`.
- It handles cards, lucky bonuses, duels (with hot-seat) and the wheel.

Integration notes from the contract review:
- Switch `tryMove` from `move()` to `act()`, since `null` can mean a duel is pending.
- A headbutting bishop and a bonked attacker are moved back with `moveTo` after `attack`.
- Dispose the pigeon's carried actor after `playChaos` resolves.
- Diff `modeState` snapshots for `setStatus(null)` and `setSquareEffects`.

Then QA all three modes at desktop size and at 390px.
