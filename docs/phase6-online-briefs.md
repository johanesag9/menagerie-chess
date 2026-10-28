# Board games online: session briefs (2026-10-28)

Sandcastle King ('castle') and Stepping Stones ('stones') are merged into `phase3`, and they run on the `ArenaController` like Sumo and Raid. These briefs make them playable with a friend online.
Johanes's two decisions are in `GAME_SPEC.md` "Online play" (the "Board games" row):
- The timer is **60s for the whole turn**, covering all its stages.
- **When time runs out, the room plays a random legal action for each stage left.** In the castle draft, it picks a random animal.

Everyone:
- Start by bringing your branch up to date with `git merge phase3`. It should fast-forward. Don't merge anything else.
- Read the Phase 6 parts of `src/contracts/types.ts`: `ArenaState.stage`, `draft`, `levels`, `fresh`, the `pick` and `shape` `ArenaAction`s, `shapeOptions()`, and the `tide` and `crowned` events. Also read GAME_SPEC "Board-game modes".
- The board games have no die, no AP, no duels and no hidden information. The phase is `'draft'` while castle picks run.
- Edit only your own folder. Ask for contract changes under "Contract requests" in your REPORT.

## server (`server/`)
1. **Live bug (fix first):** `isArenaAction`/`cleanInput` refuse `{ type: 'throw' }`, so Raid pass-and-run is refused online ("Bad input"). The Raid determinism tests show it.
2. Accept `pick` (a valid `PieceKind`) and `shape` (`pieceId` is an id or null, `square` is a square, `dir` is 'up' or 'down'). Add `'castle'` and `'stones'` to `MODES`.
3. The turn is the unit for board games:
   - The 60s timer starts at the start of the turn and does **not** restart between stages.
   - `need()` / `check` treat phase `'draft'` like a turn of `state.turn`.
4. **Timeout:** play a random legal action for the current stage until the turn passes:
   - draft: a random kind not yet picked
   - move: a random step or hit from `pieceOptions`
   - shape / more: a random option from `shapeOptions()` (for 'more', `endTurn` is fine)
   - stones: shape first, then move
   - If nothing is legal, core passes by itself. Mark each auto input `auto: 'timeout'`.
5. **Tests:**
   - the determinism suite for castle and stones (100 seeded random games each, with the room rebuilt from stored inputs)
   - every timeout kind for both modes
   - the Raid throw accepted
6. Smoke test (`server:smoke`) still green.

## net (`src/net/`)
1. The merge already added `tide` and `crowned` to `ARENA_EVENT_SET` (the orchestrator did this, to make the merge typecheck). Check it.
2. The arena proxy gets `shapeOptions()`: the mirror's options when it's your stage, else `[]` (like the `pieceOptions` mask).
3. `awaiting()` / `notYours()`: the `'draft'` phase is the turn of `state.turn`, and `pick` is only yours on your pick.
4. The fake server covers castle and stones, including the timeout rule above, so the demo can play them.
5. **Tests:** reads come from the mirror; actions are sent, not applied; `shapeOptions` is masked; a draft rejoin resyncs.

## ui (`src/ui/`)
1. Setup: allow **Friend online** for both board games (Play as, no bot level, no clock).
2. Castle draft online:
   - Only ask for your own picks. Never show the hot-seat cover.
   - While your friend picks, show "Friend is picking…", and show their picks as they come in.
   - `askDraft` works out the remote side from `opponent.type === 'online'` too (not only 'bot').
3. `closeQuestion()` also closes an open draft pick with a random free kind. The room picks for you on a timeout, and integration ignores the stale answer.
4. The online HUD timer reads well with the board-game HUD strips (castle levels, stones path length). Check this at 390px.
5. The demo shows the online draft (your pick, and the friend picking) and the board-game online HUD.

## Integration (orchestrator, after the three merge)
- `ArenaMatch` already uses `remote` (bot, or friend online) for the draft, crowned banners and hot-seat.
- Check that the shape and draft prompts only go to you, and that `resync` redraws levels, fresh squares and the flag.
- QA with two tabs: both games to the end, with a reload mid-game, a timeout in each stage, a rematch, and 390px.
- Redeploy (GAME_SPEC "Online play", Live).
