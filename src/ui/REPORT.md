# ui + audio stream report

Status: **Phase 5 done** (2026-10-28), branch `claude/p5-ui-2d8a97`. Phase 4, 3 and 1 work is unchanged (reports further down).

## Phase 5: online with a friend

### What's done
**Setup**
- Opponent has a third choice, **Friend online** ("Send them a link"). With it: "Play as" shows; bot level, time, Weird Mode and the FEN box hide. A short line says there's no clock but a 60-second turn timer, with a "How online works" link.
- Start says **Invite a friend**. It emits `startGame` with `opponent: { type: 'online', you }`, untimed and `weirdMode: false` (Random side is flipped here). The UI stays on setup and the button says "Making your link…" until `showInvite`, `hideInvite`, `showError` or 15 seconds.

**Invite (`showInvite`)**: over the setup screen. Your king, three pulsing dots and a bobbing "?" for the friend. "Invite a friend", then "Crazy · You play Sea", the link in a box (tap selects it), **Copy link** (turns green: "Copied! ✓"; if the browser blocks it, the link gets selected with "copy it by hand"), **Share** (only where `navigator.share` exists), "Waiting for your friend…", "Keep this screen open. The game starts when they join." and **Cancel**. Cancel or Esc emits `cancelInvite`. `hideInvite()` or any `show(...)` closes it without an event.

**Join (`askJoin`)**: the mode's icon with your king, "Your friend invited you to **Sumo**." "You play **Sea**." and the mode's pitch. **Join** (true) and **Not now** (false, also Esc). With `null`: "This invite is closed" / "This invite has expired or the game is full." and **OK** (false).

**Online HUD (`setOnline`)**
- Pills under the friend's card: "Reconnecting…" / "Connecting…" (spinner) or "Offline", only when not `online`. "Friend is away · 1:42", counting down to `graceEndsAt`. "Friend left". Waiting never shows in game.
- The friend's card greys out while away; when they left, the name is crossed out too.
- Turn timer by the side to move: a ring around the avatar that empties, and a stopwatch countdown where the clock goes. Under 10s it turns red and pulses, and `timeLow` plays once (your own timer only).
- `setOnline(null)` hides it all. An offline `setGameInfo` clears it too.

**Result (online)**: Rematch emits `rematchOnline` and does not switch screens (the room starts the game). After you ask: button greyed, "Waiting for your friend…". When they ask first: a gold "🔁 Your friend wants a rematch!" and the button says "Rematch!" and pulses. If the friend left: "Your friend left, so no rematch this time." Titles: "You win!" / "Friend wins".

**"You" online**: one helper (`youSide`, `playerName`) now drives every place that used to look only at the bot: card names ("You", "Friend"), you at the bottom, "Your move", "Friend's turn" in party modes, duel and lucky wording, the big card fan for your hand. Online there's no undo (HUD and pause), the throw never uses the hot-seat cover, the friend's Crazy hand shows card backs, and the friend's drawn card stays face down ("Friend draws a card"). Pause is called "Menu" online ("The game keeps going online while this is open"), and Quit warns "It counts as resigning."

**How it works**: a sixth tab, **Online**, with "Play a friend online" and "Turns and leaving" (all from GAME_SPEC "Online play").

**Audio**: `friendJoined` (pop and a bright two-note ding, −19 dB), `friendLeft` (soft down-blip, −23 dB), `timeLow` (light tick-tock, −27 dB). Peaks stay under −9 dBFS.

**Who plays which sound (Phase 5).** All from the UI: `friendJoined` when the invite closes into the game (`show('game')` while it's open) or when the friend comes back (`opponent` away/left → here); `friendLeft` when they go away or leave; `timeLow` as above. Integration plays nothing new.

**Tests**: 5 new in `ui.test.ts` (29 in all): online options (your side, untimed, no Weird Mode or FEN), Friend online is remembered, `youSide`/`playerName` for bot, online and local, the m:ss countdown text, the Online help page and the three cues. `npm run typecheck` and all 286 tests pass.

### How to run the demo
1. Start `ui-demo` (port 4414, or 4415 if busy) and open `/src/ui/demo.html`. Open **Demo controls**.
2. Setup → Friend online → **Invite a friend** shows the invite after a fake 0.7s. New drawer sections:
   - **Online: invite and join**: invite (Sumo/Land, Crazy/Sea), Friend joins, Hide invite, Room error, Join good link, Join dead link.
   - **Online: games**: Classic (playing, the timer follows each turn), Crazy with the friend's hand, Friend draws a card, a duel throw (no cover), Sumo as Sea, Raid as Land.
   - **Online: HUD states**: all good, reconnecting, offline, friend away (2:00), back, left, timer yours / urgent 12s / friend's / off / follows turns.
   - **Online: result and rematch**: you win, friend wins, you asked, friend asked, friend left. Pressing Rematch: the fake friend accepts after 2.5s and sides swap.
3. Everything is fake: no server, a made-up room code, and the friend is a timer.

Checked in the browser pane at desktop size and 390×844: setup, invite, join (both), every HUD state, Crazy card backs, result and rematch, How it works. No console errors. A bot game still shows "Sly Fox", clocks and undo, with no online bits.

### Contract requests
None blocking. Notes for integration:
1. Online `startGame` does not switch to the game screen. On `started`, call `setGameInfo(options)` then `show('game')`: that closes the invite and plays `friendJoined`. Then `setOnline(...)`.
2. If `createRoom` fails, call `showError(...)` (or `hideInvite()`): it frees the Start button.
3. Nice to have: the turn's full length in `OnlineHud.timer` (e.g. `totalMs`). The ring now assumes 60s (or the most it has seen).

### Open design questions for Johanes
- Start says **Invite a friend** online instead of "Start game". OK?
- The FEN box is hidden online (custom start positions only offline).
- `timeLow` plays once at 10s, and only on your own turn. The spec says "the last 10s tick": tick every second instead, like the chess clock?
- The online pills sit under the friend's card (top left), not in the middle. OK?
- Away = greyed card; left = greyed and crossed out. Too strong?
- No sound when the friend asks for a rematch (only the gold line). Add a ding?
- The dead link says "This invite is closed". Other wording?
- Sounds are balanced by numbers, not heard yet: try them on the sound board.

### Known issues
- **Copy** couldn't be proven in the browser pane: scripted clicks have no clipboard permission, so it showed the "copy it by hand" fallback (which works). Real taps should copy; not tried on a phone. **Share** was only checked for layout (stubbed).
- Found while levelling `timeLow`: the noise helper (`synth.ts`) can spike when a burst starts later than the cue's start. `timeLow` avoids it. Older cues with late noise bursts may peak higher than measured; not changed.
- Not tried with the real net client or server (that's integration).

---

## Phase 4 report (Sumo and Raid, unchanged)
### What's done


**Setup**
- A second row, "Party modes · Not chess", with Sumo and Raid and a one-line pitch each. It is one radio group with the chess modes, so the arrow keys run through all five.
- For Sumo and Raid the clock, Weird Mode and FEN are hidden, and `toGameOptions` sends no clock, `weirdMode: false` and no FEN.
- "How it works" has tabs for all five modes. The Sumo and Raid text follows GAME_SPEC "Party modes" and its "Fine print" (`modeText.ts`).

**Party HUD (`setArenaState`)**
- By each player card: the six animals. Fallen ones are crossed out. A gold dot marks each power that's still ready. It also shows duel tokens (2 dots) and status (stunned, frozen, dug in). In Raid it shows where that side's treasure is: "Home", "Dropped on f4" or, in red, "Horse has it!". The carrier's icon wears the treasure.
- Top chip: "Round 4 / 15". Sumo: "Island sinks in N", which turns red and pulses as "Island sinks this round!". Raid: "Land 1 – 2 Sea (to 5)", the target read from the state and "Wheel in N".
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
- Integration plays the rest, timed with the board: step, shove, tag, splash, sinkWarn, sink, anchor, pickup, drop, treasureHome, score, and the Raid pass cues toss, catch and intercept. `announce` plays no sound of its own, so pair it: score with "+1 Sea!", splash with "Pug overboard!".

**Notes for integration**
- Call `setArenaState` on every `state`. It also gives the duel and selection panels their animal names. Call it with the final state *before* `showResult`, because the result line reads the score and the animals left from it.
- `setGameInfo` with `mode: 'sumo' | 'raid'` hides the clocks and undo.
- `addLog` shows `'move'` records in party modes (chess still uses `addMove`).

**Raid update (quick raids, pass and run, 2026-10-28):** the Raid pitch and How it works follow the new spec (bone e3, pearl d6, grab +1, home +2, first to 5, 12 rounds, pass and run, stun on tag, tide both sides). New cues: `toss` (whoosh-up), `catch` (bright pluck), `intercept` (a "nope" boing). The demo's fake Raid data and script use the new rules. The UI has no throw button: picking a throw target is integration (the `throws` on the selection, like steps).

**Tests** (`ui.test.ts`, now 24): party setup (no clock, Weird Mode or FEN), text for every mode, die to AP, shove and tag wording, every party ending, step lines in party mode only, and every Phase 4 cue has a sound. `npm run typecheck` passes.

### How to run the demo
1. Start the `ui-demo` launch config (port 4414; it moves to 4415 if 4414 is busy) and open `/src/ui/demo.html`.
2. Open **Demo controls** on the left. New sections:
   - **Party HUD:** Sumo start, sinks this round, round 8 (two rings gone, fallen animals, a dug-in crab, bot's turn), Raid start, pearl carried, Raid 2-player, out of AP, bot thinking, Pup selected.
   - **Party: banners, die, duels:** each announce tone, "5 → 4 AP", shove and tag duel questions, the Raid wheel.
   - **Party results:** all three endings.
   - **▶ Sumo turn:** roll, step, shove the Crab off the board, Sea calls a duel (you throw), Crab overboard. Then it waits for End turn (tap it or press E), the bot steps, and the edge sinks with the Seahorse.
   - **▶ Raid turn:** the Horse grabs the pearl (+1) and throws it to the Dachshund, the Octopus stuns the Horse, the Crab tags the carrier (you choose to duel), the pearl drops and flies home, then the wheel (Disco) and the next roll.
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
