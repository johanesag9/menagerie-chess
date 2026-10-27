# ui + audio stream report

Status: **Phase 3 done** (2026-10-27), branch `claude/p3-ui-518806`. Phase 1 work is unchanged (summary at the end).

## What's done (Phase 3: Normal and Crazy)

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

## How to run the demo
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

## Contract requests
1. **Live pieces for the HUD.** `ModeState` has no pieces, so "powers left per kind" has to guess from the standard start minus captures. A promoted piece reads as a pawn. Ask: add `pieces: PieceState[]` to `ModeState`, or a `Ui.setPieces(pieces)`. *Workaround:* `MenagerieUi.setPieces()` exists. Call it after each move and use the exact counts.
2. **Animal kinds in `DuelInfo`.** It has only ids, so the duel question reads the kind from `setPieces`, or else from the id (wrong for promoted pieces). Ask: add `attackerKind` and `victimKind`.
3. **Earthquake direction.** `spinWheel(outcome)` doesn't get `direction`, so the line says "shifts one file sideways". Ask: `spinWheel(outcome, direction?)`.

## Open design questions for Johanes
- **Bot's cards** show face up in its strip (the rules don't say hands are secret). Keep, or show card backs?
- **The big hand:** yours vs the bot. In 2-player games it's the side to move's hand, and the other side's shows small. OK?
- **Hands and wheel icons** use system emoji (✊ ✋ ✌️, 🌊 🐦 🌋 🪩), like the emotes. Draw our own later?
- **Timings:** the die takes about 1.7s on a 1 or 6, the wheel about 3s including its result line, and a joker about 2.6s. Each covers the middle only briefly and any tap skips it. Too long or too short?
- **Key hints** (Y, N, 1, 2, R, P, S) also show on phones. Hide them on touch?
- **Names:** the UI says "Dachshund" (roster), while the power table calls it the pup. Fine?
- **Sounds:** balanced by numbers only, not yet heard. Please try the sound board.

## Known issues
- The high-pass noise in `synth.ts` can spike at random when a sound starts. I found it on the freeze crackle and switched that one to band-pass. Older cues that use high-pass noise (clicks, capture, promote) may rarely play a louder tick; the master compressor softens it.
- "Powers left" is a guess until `setPieces` is called (see contract request 1).
- When the browser tab is hidden, the CSS animations pause, but every overlay's promise still resolves on a timer. Nothing hangs.
- From Phase 1, still true: the music isn't level-checked, and `quality`/`showCoordinates` are only saved and emitted.

## Phase 1 (unchanged)
Title, setup, HUD (cards, clocks, captured trays, move list, emotes, undo, pause), promotion picker, check banner, Weird Mode toast, error line, result, customize, settings and pause. Every control is 44px or more, with focus rings, Tab traps, Esc to go back, and a live region for screen readers. Settings are saved in `localStorage`. There are 35 synthesized cues plus music, and the level check.
