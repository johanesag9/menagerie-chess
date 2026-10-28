# ui + audio stream report

Status: **Phase 6 done** (2026-10-28), branch `claude/p6-ui-4d2bbc` (cut from `phase6`). Phase 4, 3 and 1 work is unchanged (reports further down).

## Phase 6: board-game modes (Sandcastle King, Stepping Stones)

### What's done
- **Setup:** a third row, "Board games" (tag "No luck"), with Sandcastle King 🏰 and Stepping Stones 🪨 and a one-line pitch each. Clock, Weird Mode and FEN hide for them, as for the party modes. The choice is remembered.
- **How it works:** both modes, from GAME_SPEC "Board-game modes": win, draft, turn, tide, the trait table (castle); the sea, turn, fresh squares, the powers table (stones). Words live in `boardText.ts`.
- **Draft picker** (`askDraft`, `screens/draft.ts`): a sheet over the board with your 6 animals as cards (animal, trait name, one line; core's `traits` words win over ours), both sides' picks so far with empty slots, and the slot being picked glowing. "Land, your pick" in a local game, "Pick your animals" vs the bot. Keys 1–6, arrows, Tab stays inside. Plays `draftPick` and emits `draftPicked`. Leaving the game or a result answers an open question with the first free animal.
- **Board HUD** (`hud/board.ts`, `hud/board.css`). `setArenaState` sends 'castle' and 'stones' here and Sumo/Raid to the old party HUD. No AP pips, no die, no duel tokens.
  - Turn bar in the bottom dock: whose turn and the stage in plain words ("Move an animal", "Build or dig next to your Mountain Goat", "Dig again or end turn", "Raise or sink a square, or use a power"; "Building or digging" on the bot's turn). In castle the animal that shapes sits beside the words.
  - **End turn only in stage 'more'**, only for a human side. E works too.
  - Strips by the player cards. Castle: each drafted animal with its trait name, its height (a small number) and a crown on a castle; empty slots during the draft. Stones: the six animals with a dot on each unused power, and "⚡N" left.
  - Chip: "Round N / cap" (or "Draft: pick 3 of 4"); castle "🌊 Tide in N" (red "Tide after this round!" at 1); stones "Your path 3 · Theirs 4" vs the bot, "Path: Land 3 · Sea 4" locally, "–" when there is no path, and a number of 1 pulses red.
  - **Crown warning:** a big coral banner under the chips while someone is crowned: "Sea's Octopus holds a castle: dig under it or push it off!" (only "dig under it!" when the answering side has no Shover). Gold when it's yours: "Your Mountain Goat holds a castle! Keep it there through their turn to win." It pops in once and is read out (role alert).
- **Build/Dig toggle** (`setShapeMode`): a two-way switch under the turn bar with a sliding thumb, 56–58px tall and full width at 390px. Build / Dig (castle), Raise / Sink (stones), "Build ×2" when `upBy` is 2, a side greys out when it can't be used. Tap, arrow keys, or B/D (castle) and R/S (stones). It flips at once and emits `shapeMode`.
- **Selected animal panel** in castle shows the trait with "Always on" instead of a "Use" button (core sends `available: true` for traits; there is no power action in castle).
- **Result:** `castle` "Sea wins by holding the castle: the Octopus stood its ground!", `crossed` "Land wins by crossing the sea: the Pug reached the far shore!", `rounds` is a draw ("Round 30 is over and nobody held a castle." / "...nobody got across."). The art shows the animal that won (not the king, which may not be in the game) with 🏰 or 🪨.
- **Sounds** (`audio/boardCues.ts`, all synthesized): `build` (pat-pat of damp sand), `dig` (scrape and tossed grains), `raise` (a heave, water pouring off, drips), `sinkStone` (glug glug, plop), `climb` (springy hop up), `flag` (ta-ta-taaa with a flutter), `tideWear` (a long wash in and out), `draftPick` (slap and pling). Levels trimmed to the existing targets (board actions about −20 dBFS).
- **Tests** (`board.test.ts`, 6): setup memory, stage words, crown words from each side, tide countdown, every ending, every Phase 6 cue. `npm run typecheck` and `npm test` (all 368) pass.

### How to run
1. Start the `ui-demo` launch config (port 4414, or the next free port) and open `/src/ui/demo.html`.
2. In **setup**, pick Sandcastle King and press Start: the real draft picker runs (the demo bot picks after a pause), then the animals enter. Stepping Stones starts with the Raise/Sink toggle.
3. **Demo controls** on the left, new sections:
   - **Sandcastle King:** draft vs bot, draft for 2 players, Sea's 2nd pick, stage move, build or dig, Builder ×2, stage 'more' (End turn works), crowned theirs / yours / no Shover, the tide wearing the beach, and a **scripted turn** (move, shape by the toggle, the bot's turn, then you climb onto the castle).
   - **Stepping Stones:** start, stage move (with a fresh square), 2-player midgame, their path is 1, only sink possible, bot thinking, hide toggle.
   - **Board-game results:** castle win and loss, round 30, crossed, round 25.
   - **Board-game sounds**, also on the full sound board.
4. The stand-in board draws levels (1–3, 🏰), water, fresh squares (dashed) and animals. It is a CSS stand-in, not the world, and the demo does not run the rules: the states are hand-made to follow the spec (start squares, draft order, round caps). Stones path lengths are worked out on the fake board.

Checked in the browser pane at desktop size and at 390×844 with clicks and keys (setup Start, draft picks with 1–6 and taps, B/D, the toggle, End turn). No console errors. Sumo, Raid and a chess game still show their own HUD and none of this.

### Contract requests
None blocking. To confirm:
1. **`nextTideIn`:** I read it like Sumo's `nextSinkIn`: 1 = the tide comes at the end of this round ("Tide after this round!"). Core, please match or tell me.
2. **Who plays which sound:** the UI plays `draftPick` when a human picks, `endTurn` on End turn, and `uiClick` on the toggle. Integration plays the board sounds (`build`, `dig`, `raise`, `sinkStone`, `climb`, `flag`, `tideWear`) with the animations, and `draftPick` for the bot's picks only.
3. **The toggle** flips by itself when tapped and emits `shapeMode`. Integration should answer with `setShapeMode` (new options); until then the UI keeps the player's choice.
4. **Traits in the HUD:** strips use core's trait words from the last `askDraft`, else ours. If core's names ever differ from the spec, a way to pass them without a draft would help (e.g. in `ArenaState.draft`).

### Open design questions for Johanes
- **Setup colours:** Sandcastle King turns sand brown when picked, Stepping Stones slate blue. The tag says "No luck". OK?
- **The toggle** sits under the turn bar at the bottom, full width on phones. Build thumb is sand, Dig dark earth; Raise slate grey, Sink sea teal. Arrows plus words. OK, or icons (pail and spade)?
- **Crown warning** stays up the whole time someone is crowned, red when it's against you and gold when it's yours. Too loud?
- **Path chip:** "Your path 3 · Theirs 4", "–" for no path. Would "steps to cross" read better?
- **Trait icons** are emoji (⛏️ 🦘 🧗 🧱 👐 💨). Draw our own later?
- **Draft:** no secrecy cover in a local game, since both sides see all picks anyway. OK?
- **A draw with nothing to do for a whole round:** if core reports it as `stalemate`, the title reads "Stalemate!" (a chess word) with "Nobody could do anything for a whole round." Change the title to "It's a draw"?
- **Sounds:** balanced by numbers only, not heard yet. Please try them on the sound board.

### Known issues
- **How it works tabs** wrap to three rows on a phone now that there are seven modes. It works, but takes space.
- The demo's stand-in board isn't clickable, so the demo shows states and short scripts, not a playable game.
- The draft sheet covers the bottom player card on a phone while it's open (on purpose: it says whose pick it is).
- Not in my brief, found in passing: the Phase 4 cues `toss`, `catch` and `intercept` have no sound yet (they play silence).

### Merge notes (Phase 5 ui is on another branch)
New files: `boardText.ts`, `hud/board.ts`, `hud/board.css`, `screens/draft.ts`, `demoBoard.ts`, `board.test.ts`, `audio/boardCues.ts`.
Small edits to shared files: `index.ts` (a Phase 6 block of two methods just above the Phase 5 stubs, the draft picker set-up, `draft.cancel()` in three places, the Tab trap line, `arenaState` getter), `screens/hud.ts` (create and place the board HUD, route `setArenaState`), `screens/setup.ts` (third row), `screens/modeHud.ts` (one line: "Always on"), `screens/overlays.ts` (result line and art), `modeText.ts`, `config.ts`, `settings.ts` (mode lists and stub words), `audio/cues.ts` (two spreads), `demo.ts` (routing).


## Phase 4 report (Sumo and Raid, unchanged)

### What's done

**Setup**
- A second row, "Party modes · Not chess", with Sumo and Raid and a one-line pitch each. It is one radio group with the chess modes, so the arrow keys run through all five.
- For Sumo and Raid the clock, Weird Mode and FEN are hidden, and `toGameOptions` sends no clock, `weirdMode: false` and no FEN.
- "How it works" has tabs for all five modes. The Sumo and Raid text follows GAME_SPEC "Party modes" and its "Fine print" (`modeText.ts`).

**Party HUD (`setArenaState`)**
- By each player card: the six animals. Fallen ones are crossed out. A gold dot marks each power that's still ready. It also shows duel tokens (2 dots) and status (stunned, frozen, dug in). In Raid it shows where that side's treasure is: "Home", "Dropped on f4" or, in red, "Horse has it!". The carrier's icon wears the treasure.
- Top chip: "Round 4 / 15". Sumo: "Island sinks in N", which turns red and pulses as "Island sinks this round!". Raid: "Land 1 – 2 Sea (to 3)" and "Wheel in N".
- Bottom turn bar: the die face, AP pips with "3 AP", and a big **End turn** button. The button emits `endTurn` and plays `endTurn`. It shows only for a human side to move, with AP left and outside a duel. During a duel the bar says "Duel!"; on the bot's turn it shows thinking dots. **E** on the keyboard ends the turn too.
- The selected-animal panel shows core's `PowerInfo.name`, `line` and `note` when they're there ("Dig in", "Not enough AP"). Without them it falls back to the UI's own party text.
- No clocks and no undo in party games. `setArenaState(null)` hides it all.

**Banners, die, duels, wheel, result**
- `announce(text, tone)`: a big bouncy banner, about 1.2s. Tones: info (teal), good (green), bad (red). Clicks pass through it; a tap or Space skips it; a new one cuts the old one short. With reduced motion it is a fade.
- `rollDie(side, value, 'none', { ap })` in party modes says "5 → 4 AP" (no banana or lucky). Without `ap` it uses the spec table.
- Duel question by `via`:
  - shove: "Sea's Sea Turtle wants to shove your Pug into the sea!" / "Let it go: The Pug falls in".
  - tag: "Sea's Crab tags your Horse! It would drop the pearl." / "The Horse drops it and goes home".
- `spinWheel` in Raid uses the Raid lines (the pigeon grabs a treasure, and so on).
- Results:
  - `kingOverboard`: "Sea wins: Land's Pug fell into the sea!" (the king sinks in the waves), or "Both kings fell into the sea at the same moment."
  - `treasure`: "Land wins 3–1 by raiding the pearl!"
  - `rounds`: "Round 15 is over. Land wins with more animals left (3 to 1)." / "Round 20 is over, level on points (1–1)."
- The move list shows the party `'move'` lines (steps, shoves, tags) with a 👣. Chess modes still skip them.

**Audio.** All 12 new cues are synthesized and level-matched (trims in `cues.ts`, no peak above −3 dBFS):
- step, shove, tag, splash
- sinkWarn (low creak), sink (rumble and rush)
- anchor (dig in)
- pickup, drop, treasureHome
- score (brass fanfare), endTurn

**Who plays which sound.**
- The UI plays `endTurn` (button or E), plus everything it already played: die, duel throws, wheel.
- Integration plays the rest, timed with the board: step, shove, tag, splash, sinkWarn, sink, anchor, pickup, drop, treasureHome and score. `announce` plays no sound of its own, so pair it: score with "+1 Sea!", splash with "Pug overboard!".

**Notes for integration**
- Call `setArenaState` on every `state`. It also gives the duel and selection panels their animal names. Call it with the final state *before* `showResult`, because the result line reads the score and the animals left from it.
- `setGameInfo` with `mode: 'sumo' | 'raid'` hides the clocks and undo.
- `addLog` shows `'move'` records in party modes (chess still uses `addMove`).

**Tests** (`ui.test.ts`, now 24): party setup (no clock, Weird Mode or FEN), text for every mode, die to AP, shove and tag wording, every party ending, step lines in party mode only, and every Phase 4 cue has a sound. `npm run typecheck` passes.

### How to run the demo
1. Start the `ui-demo` launch config (port 4414; it moves to 4415 if 4414 is busy) and open `/src/ui/demo.html`.
2. Open **Demo controls** on the left. New sections:
   - **Party HUD:** Sumo start, sinks this round, round 8 (two rings gone, fallen animals, a dug-in crab, bot's turn), Raid start, pearl carried, Raid 2-player, out of AP, bot thinking, Pup selected.
   - **Party: banners, die, duels:** each announce tone, "5 → 4 AP", shove and tag duel questions, the Raid wheel.
   - **Party results:** all three endings.
   - **▶ Sumo turn:** roll, step, shove the Crab off the board, Sea calls a duel (you throw), Crab overboard. Then it waits for End turn (tap it or press E), the bot steps, and the edge sinks with the Seahorse.
   - **▶ Raid turn:** the Horse grabs the pearl, the carrier walks slowly, the Crab tags it (you choose to duel), the pearl drops and flies home, then the wheel (Disco) and the next roll.
   - Choosing Sumo or Raid in **setup** and pressing Start gives a free-play fake. End turn works there; the bot takes random legal steps.
3. The stand-in board draws the animals, water, the wobbling ring and the treasures so the scripts make sense. It is a CSS stand-in, not the world. The fake states follow the party rules (start squares, rings 3/6/9, AP 2/3/4, costs, halves). They are not core.

Checked in the browser pane at desktop size and 390×844, with real taps and keys (Start, End turn, E, N). No console errors. Reduced motion works. Normal and Crazy show none of the party HUD.

### Contract requests
Done in b0547e8: the die's AP (`rollDie` opts), `PowerInfo` name/line/note, the log kinds, and what "Island sinks in 1" means. Still open:
1. **How many AP pips.** `ArenaState` has the AP left but not the AP the turn started with, so the HUD counts the highest AP it saw this turn. Ask: add `apStart` (or `apMax`).

### Open design questions for Johanes
- **Treasure icons** are system emoji: 🦴 bone and 🦪 for the pearl (an oyster, the closest one). Draw our own later?
- **Setup colours:** Sumo turns coral red when picked, Raid a deep amber. OK?
- **End turn** hides at 0 AP, because the turn ends by itself then. Should it stay visible?
- **Banner tone** is the caller's choice. I suggest it's from your side in bot games ("Pug overboard!" is bad when it's your Pug).
- **Fallen animals** are crossed out in the strip; the capture trays stay empty in party modes. Show fallen enemies as trophies too?
- **Sounds:** balanced by numbers only, not heard yet. Please try them on the sound board.

### Known issues
- AP pips can undercount if the first state of a turn arrives with AP already spent (see contract request 1).
- In the demo's free play you can only press End turn, because the stand-in board isn't clickable.
- The demo drawer's tab covers the left edge of the setup screen at 390px. This happens in the demo only.

## Phase 3 report (Normal and Crazy, unchanged)

### What's done

**Setup**
- Three big mode cards (Classic, Normal, Crazy), each with a one-line pitch. The choice goes into `GameOptions.mode` and is remembered.
- A "How it works" sheet with the rules in plain words, one tab per mode. The text follows GAME_SPEC "Game modes" and lives in `modeText.ts`.
- Weird Mode is hidden in Crazy, and Crazy always sends `weirdMode: false`.

**HUD (`setModeState`)**
- A strip by each player card: a face per piece kind with "powers left" (greyed at 0), duel tokens (3 dots), and the other side's cards as small suit chips.
- A chip in the top bar: "Round 4 · Wheel in 2 · Card in 2" and the current die face. Normal shows the round only.
- The card hand: a fan of big cards at the bottom. Vs the bot it's your hand; in a local game it's the side to move. A card is greyed unless its id is in `playableCards`. Tapping emits `cardRequested`, and the card stays lit until the prompt clears.
- The captured trays now come from `captured` in the mode state, so pigeons, double jumps and revives show up right.
- No undo button in Crazy (HUD and pause menu).
- `setModeState(null)` hides all of it. Classic looks as before.

**Selection, prompt and move list**
- `setSelection`: the piece, its power name, a one-line rule, and a big "Use Double jump" button (emits `powerRequested`). If it can't be used, it says why: Used, Stunned, Frozen, No target, Not your turn.
- `setPrompt`: a violet aiming bar with Cancel. Esc cancels too. Both emit `cancelAction`.
- `addLog`: power, card, bonus, bonk, wheel and pass lines sit between the moves, with an icon and a side colour. Round numbers stay right.

**Overlays.** Shows can be skipped with a tap or Space/Enter/Esc. Questions take focus, keep Tab inside, have key shortcuts, and fit at 390px.
- `rollDie`: a 3D die tumbles and lands. It calls "BANANA PEEL!" or "LUCKY!" with one line of what that means; 2–5 is a quiet number. About 1.2–1.7s.
- `askLucky`: Recharge, Pawn step, or Skip. An option that can't be used is greyed with the reason. Keys 1, 2, Esc.
- `showCardDrawn`: the card flips in, then flies to that side's hand. `showCardPlayed`: it flies from the hand to the middle, flips big, and shows its effect. A joker shakes to a drumroll, then flips to the outcome (Party, Teleport, Butterfingers, Double).
- `askRevive`: one button per captured animal kind ("Crab ×3"), plus Cancel (returns null).
- `askDuel`: "Sea's Crab wants to bonk your Dachshund!", both faces, tokens left, Duel / Let it go. Keys Y and N; Esc means no.
- `askThrow`: three big hands (keys R, P, S). With `hotSeat`, an opaque cover first says "Sea, take the device. Land, look away!", then shows the picker, then "Locked in!". The cover stays up between two throws in a row.
- `showDuelRound`: both hands slam in, the winner grows and the loser greys. It calls "You win the throw!" or "Tie! Again!".
- `spinWheel`: a four-slice wheel spins about 1.9s and ticks on every peg. It stops on the result and shows one line of what happens.
- "King in danger!" replaces "Check!" in Crazy.
- Result: `kingCaptured` reads "Land wins by bonking the king.", with the loser's king lying dizzy.
- Reduced motion: every show becomes a short fade.

**Audio.** All 29 new cues are synthesized; nothing is downloaded. They are level-matched to the old ones with the level check (trims in `cues.ts`). No peak goes above −3 dBFS.

**Who plays which sound**
- **The UI plays:** dieRoll, dieBanana, dieLucky, cardDraw, cardPlay, joker, duelCall (when *you* call a duel), duelThrow, duelWin and duelLose (from your side; always "win" in local games), wheelSpin (one tick per peg), wheelStop, and check for "King in danger!".
- **Integration plays,** timed with the board: `power:*`, bonk, `chaos:*` (with `world.playChaos`), stun, freeze, block, revive, slip, recharge, and duelCall when the bot calls.

**Notes for integration**
- `addLog` ignores records of kind `'move'`; use `addMove` for moves. To rebuild after an undo: `resetMoves()`, then walk `game.log`. For each `'move'` record, `addMove` the next `history` entry; for anything else, `addLog`.
- `showResult` gives any open question its default answer and clears the prompt and selection.
- Rematch from the result screen resets the mode HUD. Send the `modeState` from the new game again.
- `setSelection` with `power: null` (Classic) shows nothing.

**Tests** (`ui.test.ts`, now 17): mode saved and loaded, Crazy turns Weird Mode off, move-list rows with log lines (round numbers, "1. … e5" rows), trays from the mode state, power counts (exact and guessed), id parsing, and that every Phase 3 cue has a sound.

### How to run the demo
1. Start the `ui-demo` launch config (port 4414, or 4415 if that's busy) and open `/src/ui/demo.html`.
2. Open the **Demo controls** tab on the left. New sections:
   - **Fake game:** "Normal vs bot" and "Crazy vs bot". These play chess.js moves with fake mode state. In Crazy you get the wheel, card draws and a die roll before every turn, and the lucky question on your 6s.
   - **Mode HUD:** quiet game screens at round 4 (Normal, Crazy, Crazy 2-player, wheel due).
   - **Selection and prompt:** each power state.
   - **Move-list lines**, **Fate die**, **Cards** (every suit and joker outcome, revive), **Duels** (ask, throws, hot seat, round results), **Wheel of Chaos** (all four), **King in danger** and **Result: king bonked**.
   - **▶ Crazy turn** (vs bot or 2 players): wheel, card draw, die, lucky, Land moves, Sea's Crab attacks, duel (you answer, then throw), and Land plays the joker. You answer the questions yourself.
   - The **sound board** has every new cue.
3. The board is a CSS stand-in, not the real world. The mode state is fake demo data that follows the spec's numbers (1 card to start, 3 tokens, a card every 3rd own turn, the wheel at round 6). It is not core: no power actually changes the board.

Checked in headless Chrome at 1280×800 and 390×844: no console errors, nothing scrolls sideways, and Classic looks as before. Keys, Esc-to-cancel, skipping and reduced motion work.

### Contract requests
1. **Live pieces for the HUD.** `ModeState` has no pieces, so "powers left per kind" has to guess from the standard start minus captures. A promoted piece reads as a pawn. Ask: add `pieces: PieceState[]` to `ModeState`, or a `Ui.setPieces(pieces)`. *Workaround:* `MenagerieUi.setPieces()` exists. Call it after each move and use the exact counts.
2. **Animal kinds in `DuelInfo`.** It has only ids, so the duel question reads the kind from `setPieces`, or else from the id (wrong for promoted pieces). Ask: add `attackerKind` and `victimKind`.
3. **Earthquake direction.** `spinWheel(outcome)` doesn't get `direction`, so the line says "shifts one file sideways". Ask: `spinWheel(outcome, direction?)`.

### Open design questions for Johanes
- **Bot's cards** show face up in its strip (the rules don't say hands are secret). Keep, or show card backs?
- **The big hand:** yours vs the bot. In 2-player games it's the side to move's hand, and the other side's shows small. OK?
- **Hands and wheel icons** use system emoji (✊ ✋ ✌️, 🌊 🐦 🌋 🪩), like the emotes. Draw our own later?
- **Timings:** the die takes about 1.7s on a 1 or 6, the wheel about 3s including its result line, and a joker about 2.6s. Each covers the middle only briefly and any tap skips it. Too long or too short?
- **Key hints** (Y, N, 1, 2, R, P, S) also show on phones. Hide them on touch?
- **Names:** the UI says "Dachshund" (roster), while the power table calls it the pup. Fine?
- **Sounds:** balanced by numbers only, not yet heard. Please try the sound board.

### Known issues
- The high-pass noise in `synth.ts` can spike at random when a sound starts. I found it on the freeze crackle and switched that one to band-pass. Older cues that use high-pass noise (clicks, capture, promote) may rarely play a louder tick; the master compressor softens it.
- "Powers left" is a guess until `setPieces` is called (see contract request 1).
- When the browser tab is hidden, the CSS animations pause, but every overlay's promise still resolves on a timer. Nothing hangs.
- From Phase 1, still true: the music isn't level-checked, and `quality`/`showCoordinates` are only saved and emitted.

## Phase 1 (unchanged)
Title, setup, HUD (cards, clocks, captured trays, move list, emotes, undo, pause), promotion picker, check banner, Weird Mode toast, error line, result, customize, settings and pause. Every control is 44px or more, with focus rings, Tab traps, Esc to go back, and a live region for screen readers. Settings are saved in `localStorage`. There are 35 synthesized cues plus music, and the level check.
