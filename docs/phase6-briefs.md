# Phase 6 session briefs: board-game modes (Sandcastle King, Stepping Stones)

Four sessions run at the same time, the same way as Phases 3 and 4. Each one gets its own git worktree and branch, cut from the **`phase6`** branch (which is `phase3` plus the Phase 6 contracts, spec and stubs). `main` and `phase3` don't have this work.

Every session reads these first:
- `CLAUDE.md`
- `GAME_SPEC.md`, especially **"Board-game modes"**. That section is the rulebook. Also skim "Party modes": the new modes run on the same `ArenaController`.
- The **Phase 6** parts of `src/contracts/types.ts`: search for "Phase 6". The key ones:
  - `ArenaMode` (adds `castle` and `stones`), `BoardMode`, `isBoardMode`, `Level`
  - `ArenaState` (`stage`, `mover`, `levels`, `crowned`, `nextTideIn`, `draft`, `fresh`, `pathLength`, phase `draft`)
  - `ArenaAction` (`pick`, `shape`), `ShapeOption`, `ArenaController.shapeOptions`
  - `BoardChange` (`level`, `water`, `enter`), the `tide` and `crowned` events
  - `World.setLevels/squareTop/setFlag/setFresh`, `MoveStyle 'climb'`, `PieceActor.work`
  - `Ui.setShapeMode/askDraft`, the `shapeMode` and `draftPicked` ui events, the new `AudioCue`s

The branch has small **stubs** marked `Phase 6 stub (orchestrator)` in each stream folder. Replace them.

**Everything else must keep working exactly as it does now:** Classic, Normal, Crazy, Sumo and Raid.

**Online (Phase 5) is being built at the same time** on other branches. Don't touch `src/net/` or `server/`. Online for these modes is wired by the orchestrator later. It works because rooms run core and relay `ArenaAction`s, so core must stay **deterministic** for the same seed and inputs (the bot may use the seed's random stream only).

---

## Event order (core emits it; integration and the ui rely on it)
The full order is in the `ArenaController` doc comment in `types.ts`. In short:
- **No `rolled`** in these modes, and no duels. `die` is null, `ap` 0, `duelTokens` 0.
- **One action:** `acted`, then `logged`, then `state`. The `state` snapshot is the source of truth.
- **Castle draft:** `phase: 'draft'`, `stage: 'pick'`. Four `pick` actions alternate Land, Sea, Land, Sea. After the last one, an `acted` (the last `pick`) carries `enter` changes for all four animals in one step, then the normal start of Land's turn.
- **Castle turn:** `step` (or the Shover's `hit`) -> `shape` -> Digger only: an optional second `shape`, or `endTurn`. `state.mover` names the animal that shapes.
- **Stones turn:** `shape` (or a `power`, which is the whole turn) -> `step`.
- **End of a turn:** castle, at the end of every 5th round: `tide`, `logged`. Then `state`, `gameOver?`, `turnChanged`, and in castle the "hold the castle" check at the start of the new turn (it can end the game, reason `castle`), then `state`.
- **`crowned`** fires when an animal steps up onto a castle, and with `null` when that crown is lost (dug, pushed off, or the holder stepped down).

---

## core: two engines, bots, 2D playtest
**Owns** `src/core/`.

1. **Both modes inside `createArena()`**, next to Sumo and Raid (`options.mode` 'castle' or 'stones'). Keep each mode's rules in its own file, e.g. `src/core/arena/castle.ts` and `stones.ts`. Follow "Board-game modes" exactly; where it's silent, pick the simplest option, note it in REPORT.md, and keep going.
   - Piece ids as before: `land-b-c2` style (castle: the start square the animal entered on).
   - `pieceOptions().steps` must list every legal destination, traits included (Leaper hops, Climber +2, Zoomer 2 steps). `hits` = the Shover's push targets.
   - `pieceOptions().power`: castle sets `name`/`line` to the trait ("Climber", "It may go up 2 levels in one step"), `available` true. Stones: the mode's power with `name`/`line`.
   - Implement `shapeOptions()`. `targets` and `previewArea` work for stones powers as in Raid.
   - `pathLength` for stones every `state` (shortest dry path in steps from that side's nearest animal to the enemy back rank; null if none).
   - `pieceOptions`, `shapeOptions`, `targets` and `previewArea` must agree with `act()`. Fuzz this.
2. **Tuning** in `src/core/arena/tuning.ts`: draft size (2), castle round cap (30), tide interval (5), stones round cap (25), the fresh rule on/off.
3. **Bots.** No AP here, so a real game-tree search works:
   - Castle: alpha-beta over (move, shape) pairs. Score: own height and the heights you can reach next turn, threats to step onto a castle, enemy threats you must answer (dig or push), mobility. Level 1 picks among decent moves at random; 8 searches deeper.
   - Stones: score = enemy path length minus own path length, plus tempo. Depth by level.
   - The draft: the bot picks from a short list of good pairs, with a little randomness.
   - Run in a Web Worker if a move costs more than about 10ms; keep it deterministic for a seed.
4. **The playtest page** `src/core/arena.html` gains both modes (mode picker, local or vs bot, seed):
   - Castle: levels as numbers or shades on each square, the castle crown, the draft as buttons, Build/Dig toggle, trait names on the animal panel, "tide in N".
   - Stones: water squares blue, fresh squares marked, both path lengths, Raise/Sink.
   - Reads well at 390px. **Commit once Stones is playable, and again once Castle is.** Write REPORT.md early.

**Tests (vitest), real rules tests:**
- Castle: climbing up 1 / down any; each trait; build cap at 3, dig floor at 0; no building on animals; digging under an enemy (it rides down) but not your own; the Shover's push rules (up at most 1, any drop, onto empty squares only); the draft order and start squares; hold-the-castle timing (a win only at the start of your own turn; a dug castle or a push cancels it); the tide (beach only, empty squares only, every 5 rounds); passing; round cap.
- Stones: raise only next to dry land; sink only empty squares in ranks 3–6; the fresh rule; every power; headbutt into water sends home; win on the enemy back rank; round cap.
- A fuzz test: 200 seeded bot-vs-bot games per mode. No exceptions, every action legal, `state` matches the events, same seed + same inputs = same game.

---

## world: sand levels, castles, rising stones
**Owns** `src/world/`.

- **`setLevels(levels)`** (castle):
  - Each level is a sand tier on the square, a little smaller than the tile, with soft bevels; level 3 becomes a small sandcastle (turrets, a door, a flag spot). On the meadow half, the tiers can be packed earth with a grass top, or the same sand; pick the one that reads best and note it.
  - Animate changes: a tier pats on with a sand puff, or scoops off with spilled grains (about 0.4s). A tide change (many squares at once) washes them down with a stagger.
  - **Picking:** clicking a tier's top or side must report that square (`squareClicked`). Animals still win over the board, as before.
  - `squareTop(square)` returns the walkable top centre at the current level (integration puts animals there).
  - Level heights should read clearly from the default camera at 390px; about 0.28 of a square per level is a starting point.
  - Keep draw calls low (instance the tiers). `setLevels({})` restores instantly.
- **`setFlag(flag)`** (castle): a team flag (Land cream and gold, Sea teal and aqua) pops up on the castle being held, and drops when null.
- **Rising stones** (stones): `setSunk` already sinks tiles. Make a square **leaving** the sunk list rise out of the water as a stepping stone with a splash and streaming water (about 0.6s). Sinking one square at a time should be quick and clear too. Starting a stones game sinks ranks 3–6 instantly (no drama), via `setSunk(sunk, [])`.
- **`setFresh(squares)`** (stones): bubbles and ripples on a freshly sunk square, a dark wet edge on a freshly raised stone. [] clears.
- **Demo:** buttons to build and dig a square, set random levels, run a tide wear, plant and drop a flag, raise and sink stones, set the stones start, mark fresh squares.

---

## cast: climbing, building, digging
**Owns** `src/cast/`.

- **`moveTo(target, { style: 'climb' })`:** a hop up onto a higher tier, or a drop down (a little bounce on landing). `target.y` is the new height. Each animal in character: the goat and pufferfish (Climbers) bound up 2 levels with flair; the elephant hauls itself up; the octopus pulls itself up with tentacles; the crab scrambles sideways.
- **`work(kind, target)`:** build (pat sand onto the target square) or dig (scoop sand off it), in each animal's style: pup paws (dirt flying), crab claws, horse hoof scrape, seahorse tail flick, goat horns, pufferfish puff-blow, elephant trunk, turtle flipper, cat swats, octopus tentacles, pug paws, blobfish belly-flop. It resolves at the moment the sand lands or leaves; any follow-through keeps playing. Stones uses the same `work` for raising (build) and sinking (dig) a stone, so it must read well aimed at water too.
- **The Shover's push** reuses `attack` plus the victim's `moveTo(..., { style: 'pushed' })`. Check it reads well when the victim drops down tiers (use 'climb' for the landing if 'pushed' doesn't handle height).
- **A riding animal** (dug under) is lowered by integration with the ground; make sure a plain tween of `object.position.y` doesn't fight the idle animation.
- Everything skips with `skip()` and respects reduced motion.
- **Demo:** for every animal: climb up 1, up 2, drop down 2; build; dig; aimed at a tile and at water.

---

## ui (+ audio): setup, draft, board-game HUD
**Owns** `src/ui/`, `src/audio/`.

- **Setup:** add **Sandcastle King** and **Stepping Stones** as a third row, "Board games", each with a one-line pitch. Add both to the "How it works" sheet from GAME_SPEC "Board-game modes" (the trait table and the powers table, short). Hide clock, Weird Mode and FEN for these modes, as for the party modes.
- **`askDraft(side, opts)`:** your 6 animals as cards with the trait name and one line, picks so far for both sides, and whose pick it is. `hotSeat` covers a local game ("Sea, your pick"). It also emits `draftPicked`.
- **`setArenaState(state)`** for these modes: no AP pips or die. Show:
  - whose turn and the stage, in plain words ("Move an animal", "Build or dig next to your Goat", "Raise or sink a square", "Dig again or end turn")
  - Castle: your two animals with their traits, "Tide in N", and a loud warning when someone is crowned ("Sea's Octopus holds a castle: dig under it or push it off!")
  - Stones: both shortest paths ("Your path: 3 · Theirs: 4"), powers left
  - round and round cap; End turn only when the stage is 'more'
- **`setShapeMode(state)`:** a big two-way toggle near the bottom (Build / Dig, or Raise / Sink) that emits `shapeMode`. "Build ×2" for the Builder. Easy to hit with a thumb at 390px.
- **`showResult`** with the new reasons `castle` ("by holding the castle") and `crossed` ("by crossing the sea"); `rounds` is a draw here.
- **Audio:** synthesize every new Phase 6 `AudioCue`: `build` (sand pat), `dig` (scoop), `raise` (stone rising with water), `sinkStone` (glug), `climb` (hop up), `flag` (a little fanfare), `tideWear` (a wash), `draftPick`.
- **Demo:** the draft, the HUD for both modes with fake states (including crowned and stage 'more'), the toggle, and the result screen.

Coordinate in your report with the Phase 5 ui work (it's on another branch): keep your changes in new files where you can (`screens/draft.ts`, `hud/board.ts`, ...) so the merge stays easy.

---

## Integration (orchestrator, after the four merge)
- `ArenaMatch` handles `castle` and `stones`: the draft (`askDraft`, `enter` changes), levels (`world.setLevels`, animals placed with `squareTop`), the Build/Dig toggle and shape clicks (`shapeOptions`), `level`/`water` changes with `work`, `climb` moves, riding down, `tide`, `crowned` + `setFlag`, `setFresh`.
- `main.ts` routes both modes to `ArenaMatch`.
- Online: once Phase 5 is merged, the server and net accept the two modes (rooms relay `ArenaAction` already); test a full game by invite link.
- QA covers both modes at desktop size and at 390px, using real mouse clicks.
