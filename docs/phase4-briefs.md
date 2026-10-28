# Phase 4 session briefs: party modes (Sumo, Raid)

Four sessions run at the same time, in the same way as Phases 1 and 3. Each one gets its own git worktree and branch, cut from the `phase3` branch. `main` doesn't have this work.

Every session reads these first:
- `CLAUDE.md`
- `GAME_SPEC.md`, especially **"Party modes"**. That section is the rulebook.
- The **Phase 4** parts of `src/contracts/types.ts`: `ArenaMode`, `PlayMode`, the `ArenaController` section, and the new `World`, `PieceActor`, `Ui` and `AudioCue` members.

The branch has small **stubs** for the new members, marked `Phase 4 stubs (orchestrator ...)` in each stream folder. Replace them.

Classic, Normal and Crazy must keep working exactly as they do now.

**The party modes aren't chess.** There is no FEN and no check. Square names (`a1`–`h8`) are still used for positions.

**What gets reused from Phase 3:** the die, powers (`powerUp`), duels (`DuelInfo`, `askDuel`, `askThrow`, `showDuelRound`), blocks (`setSquareEffects`), the wheel (`spinWheel`, `playChaos`) and the log (`ActionRecord`).

---

## Event order (core emits it; integration and the ui rely on it)
The full order is in the `ArenaController` doc comment in `types.ts`. In short:
- **One action:** an optional duel, then `acted`, then `logged`, then `state`.
- **End of a turn:**
  1. In Sumo, at the end of a round: `sank`, then `logged`.
  2. `state`
  3. `gameOver`, if the game ended.
  4. `turnChanged`
  5. In Raid, every 5 rounds: `wheelSpun`, then `logged`.
  6. `rolled`
  7. `state`
- The `state` snapshot is the source of truth. Listeners compare snapshots for statuses, blocks, sunk squares and treasures; no separate "expired" events exist.
- **The bot** plays its turn one action at a time. While core is `pause()`d, it holds its next action, exactly like Phase 3.

---

## core: arena engine, bot, 2D playtest
**Owns** `src/core/`.

**Build:** `createArena(): ArenaController`, exported from `src/core/index.ts` (the `CreateArena` type in `factories.ts`).

**Build first, so Johanes can play it early: the 2D playtest.**

1. **An engine for Sumo and Raid**, separate from the chess code.
   - Keep piece ids stable; use the Phase 1 style, e.g. `land-n-b2`.
   - Follow "Party modes" exactly.
   - Where the rules are silent, pick the simplest option, note it in REPORT.md, and keep going.
2. **Every `ArenaController` member and event**, in the order above. Fill `changes` with `step` numbers, as in Phase 3:
   - A shove line moves together in one step. Any `fall` comes in the next step.
   - Sinking: every `fall` in one step.
   - Treasure events in the order they happen: pickup on arrival, drop on a tag, return when its owner steps on it, score on crossing into the home half.
   - `pieceOptions`, `targets` and `previewArea` must agree with `act()`. Fuzz this.
3. **The demo becomes the playtest**, in its own page: `src/core/arena.html` and `arena.ts`. Keep the Phase 3 demo working.
   - Mode picker (Sumo or Raid), local or vs bot, and a seed field.
   - Show the AP pips and an End turn button.
   - Clicking an animal shows its steps (dots), its hits (red rings with their AP cost) and its power button.
   - Sunk squares are drawn as water. The next ring to sink wobbles or is outlined.
   - Treasures and carriers are drawn clearly.
   - Duel prompts work as in the Phase 3 demo.
   - A plain-English event log.
   - It must read well at 390px.
   - **Commit once Sumo is playable, and again once Raid is.** Write REPORT.md early, with how to run it (the `core-demo` launch config, port 4411, at `/src/core/arena.html`).
4. **Tuning knobs** go in `src/core/arena/tuning.ts`: the AP table, costs, sink rounds, round caps, points to win, duel tokens and wheel interval. Add a small Tuning panel to the playtest.

**Bot.**
- A greedy search over the actions in one turn: sequences of up to 4 actions, pruned.
- Score it on:
  - Sumo: enemy animals near the water, enemy king near the edge, its own king central and dry.
  - Raid: distance of its carriers to home, distance of its animals to the enemy treasure, and threats to enemy carriers.
- Run it in a Web Worker if it costs more than about 10ms.
- Levels 1–3 should feel playful; 8 should be sharp.
- It answers duels by itself; its throws are random.

**Tests (vitest), real rules tests:**
- **Steps:** water, blocks and occupied squares.
- **Shoves:**
  - chain pushes, including your own animals in the line
  - a shove into a block is refused
  - heavy cost
  - anchored animals
  - falling off the edge and into sunk squares
- **Each Sumo power**, and each Raid power.
- **Sinking schedule:** the warning ring, and animals falling with it.
- **King overboard:** your own, the enemy's, and both at once.
- **Round cap**, in both modes.
- **Raid treasures:**
  - pickup, the carrier's slow steps, tag rules (halves), being sent home, dropping
  - an owner returning a dropped treasure, scoring, the no-guarding rule, reaching 3 points
- **Wheel results** in Raid, including the pigeon taking a carried treasure.
- **Duels on shoves and tags:** a bonk spends AP and moves nothing.
- **A fuzz test:** 200 seeded bot-vs-bot games per mode. No exceptions; every action is legal; ids stay stable; `state` always fits the events.

---

## world: sinking island, treasures, splash
**Owns** `src/world/`.

**Build:** `setSunk`, `setTreasures` and `splash`.

- **`setSunk(sunk, warn)`**
  - **Sunk squares:** the tile sinks a little and the water rises over it. It must read clearly as "this is sea now" from both sides at 390px: animated water with a foam edge where it meets dry tiles. When a whole ring sinks at once it should look dramatic: a wave rolls in and the tiles drop with a stagger, in about 1.2s.
  - **Warn squares:** a gentle wobble and a wet dark edge, to show "this goes next".
  - `setSunk([], [])` restores the board instantly, for new games.
  - Keep draw calls low: instance the tiles and the water patch.
- **`setTreasures(list)`**
  - **Home markers**, always shown: a dog bowl at Land's home and an open pink shell at Sea's.
  - **A treasure on the ground** (`square` not null): Land's bone is a cream cartoon bone; Sea's pearl is a glossy white pearl. About 0.35 of a square, with a soft glow and a slow bob.
  - Skip carried treasures; the cast draws those.
  - Animate a treasure appearing at a new square (a little hop), and leaving.
  - Set `noPick` on all of it.
  - **Shared look:** the cast draws the same bone and pearl when carried. Use the same colours: bone `#f3e6c8`, pearl `#f7f4ee` with a pink shell `#f2a7b5`.
- **`splash(point, big)`:** a splash crown, droplets and a ring ripple on the water. `big` for a king. Respect reduced motion.
- **Demo:** buttons to:
  - sink the rings one by one
  - warn a ring
  - restore the board
  - show the treasures at home and dropped
  - splash, both normal and big

---

## cast: falling, carrying, digging in
**Owns** `src/cast/`.

**Build:** `fall`, `setCarrying`, the `anchored` status and the `splash` cast event.

- **`fall(dir)`:** each animal totters at the edge with flailing arms, then tumbles off toward `dir` and drops into the water, emitting `splash` at the water line. About 1s.
  - Land animals panic; Sea animals look smug, as if they're going home. The octopus waves goodbye.
  - It resolves when the animal is gone. It leaves the board but isn't freed, like `defeat`.
- **`setCarrying(owner)`:** the animal holds the other side's treasure: in its mouth (dogs, horse, goat, pug), a claw (crab), a tentacle (octopus), its trunk (elephant), or balanced on its head (turtle, puffer, seahorse, blobfish).
  - Use the same look and colours as the world brief: bone `#f3e6c8`; pearl `#f7f4ee` in a pink shell `#f2a7b5`.
  - It stays on through moves, emotes and skin changes.
  - When it's on, the animal walks a bit heavier.
- **`setStatus('anchored')`:** for the pawn's "Dig in". The pup is half-buried with dirt around it; the crab is dug into the sand with its claws braced.
- Everything skips with `skip()` and respects reduced motion.
- **Demo:** buttons for falling (in each of 4 directions), carrying both treasures, and anchored, for every animal.

---

## ui (+ audio): party modes in setup, arena HUD, banners
**Owns** `src/ui/`, `src/audio/`.

- **Setup:**
  - Add **Sumo** and **Raid** to the mode picker, as a second row called "Party modes", each with a one-line pitch.
  - Add both to the "How it works" sheet, using the rules from GAME_SPEC "Party modes".
  - For these modes, hide the clock, Weird Mode and FEN options.
- **`setArenaState(state)`** shows the party HUD:
  - AP pips and a big **End turn** button, which emits `endTurn` and only shows for a human side to move.
  - Animals left per side, with the fallen ones crossed out (Sumo).
  - Powers left, duel tokens, and the round with its cap ("Round 4 / 15").
  - **Sumo:** "Island sinks in N". When N is 1, it turns urgent.
  - **Raid:** the score, as "Land 1 – 2 Sea (to 3)", plus where each treasure is (home / dropped / carried by the Seahorse) and "Wheel in N".
  - `null` hides it.
- **`announce(text, tone)`:** a big, short, bouncy banner. About 1.2s, skippable, and it must not block the board for long.
- **Reused as they are:**
  - `rollDie`, which shows the AP gained: "3 → 3 AP".
  - `setSelection` and `setPrompt` (power aiming), and the duel overlays. The duel text must handle `via` 'shove' ("Sea's Turtle wants to shove your Pug into the sea! Duel?") and 'tag'.
  - `spinWheel`, `addLog` and `showResult`, with the new reasons `kingOverboard`, `treasure` and `rounds`.
- **Audio:** synthesize every new Phase 4 `AudioCue`:
  - `step`, `shove`, `tag`, `splash`, `sinkWarn` (low creak), `sink` (rumble and whoosh), `anchor`
  - `pickup`, `drop`, `treasureHome`, `score` (a fanfare), `endTurn`
- **Demo:** the party HUD for both modes with fake states, `announce`, and a scripted Sumo turn and Raid turn.

---

## Integration (orchestrator, after the four merge)
- `src/app/arena.ts`: an `ArenaMatch`, like `Match`, that drives `ArenaController` events through the Director.
  - It animates the changes: step, a shove (attack then pushed), fall plus splash, the treasure (`setCarrying` / `setTreasures`), `sentHome`, and powers through `powerUp`.
  - It handles clicks: select, then step, hit or power aim.
  - It also wires up the End turn button and duels.
- `main.ts` routes by `GameOptions.mode`: chess modes go to `Match`, and `sumo`/`raid` go to `ArenaMatch`.
- QA covers both modes at desktop size and at 390px, using **real mouse clicks**.
