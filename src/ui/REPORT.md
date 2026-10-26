# ui + audio stream report

Status: **done for Phase 1** (2026-10-26). Branch `claude/stream-ui-414e96`.

## What's done

**UI (`src/ui/`)**: `createUi(root, audio)` in `index.ts`. Plain TypeScript and CSS, no framework, no new packages.
- **Title**: a big wordmark with bouncing letters, "Land vs Sea", and Play, Customize, Settings. The name lives in one place: `GAME_NAME` in `config.ts`.
- **Setup**: opponent (Bot or Friend on the same device), 8 bot levels with fun names (Sleepy Snail to Grandmaster Kraken), play as Land, Sea or Random, the 5 time controls, a Weird Mode switch, and an "Advanced" FEN box with a basic shape check. It remembers your last choices.
- **HUD**: two player cards on the top and bottom edges. Each card has the king's face, the name, a turn glow, bot "thinking" dots, a clock (gold for Land, teal for Sea, red and pulsing under 20s), and a captured tray with animal icons and a "+3" lead. There's a collapsible move list in SAN (open by default on wide screens), an emote picker (6 emotes) with speech bubbles by the cards, an undo button and a pause button. The middle stays clear for the board.
- **Promotion picker**: `askPromotion(side)` returns a promise. It shows 4 big animal choices and also takes the Q/R/B/N keys. You must pick one (Esc does nothing).
- **Check banner**, **Weird Mode toast** (one line per event kind), and an **error line** (an extra, see contract requests).
- **Result**: "You win!" / "Sly Fox wins" / "Land wins!" / "Stalemate!", with the reason, confetti on wins, and Rematch, New game and Title.
- **Customize**: Land/Sea tabs, palette swatches, accessory chips, and a rough preview of all 6 animals in the chosen palette.
- **Settings**: music and effects volume, quality (Auto/High/Low), reduced motion, board coordinates, and "reset to defaults".
- **Pause**: Resume, Undo, Settings, Customize, Resign and Quit. Resign and Quit ask "are you sure?" first.
- **Feel**: every screen change animates (a springy pop-in, a quick fade-out). Buttons have hover and press states and play hover/click/back sounds. The reduced motion setting turns animations into short fades.
- **Access**: every control is 44px or more. Focus rings show for keyboard use. Tab stays inside open dialogs, Esc goes back (game ↔ pause, settings → back), arrow keys work in option groups, and a hidden live region reads out moves, check and results.
- **Settings persistence**: `localStorage` key `menagerie.settings.v1`, with every read and write in try/catch. Bad or old saves get cleaned up, not crashed on. The default for reduced motion follows the system setting.
- **Animal icons**: 12 flat faces drawn in SVG code (`icons.ts`). First-pass art, see the open questions.
- **Tests** (`ui.test.ts`, 10): settings round-trip, junk and blocked storage, setup → GameOptions (incl. random side), FEN shape check, clock format, capture tally with promotions, move numbering.

**Audio (`src/audio/`)**: done in the earlier session. This session added:
- A **level check**: `measureCue()` in `levels.ts` renders a cue offline and measures its peak and loudness. The demo has a "Check levels" button.
- **Per-cue trims** (`TRIM` in `cues.ts`), set from that check. Before, cue loudness spread over about 18 dB (crab clicks -28, horse neigh -10). Now the voices and emotes sit at -16 dB (the crab is the exception, about -23, because its clicks are spiky). Board sounds are at about -20, captures -15, fanfares -13 to -18, clicks -26, hover -36 and the clock tick -28. No peak goes above -2 dBFS, and there's a compressor on the master too.

**Who plays which sound** (for integration):
- The UI plays its own control sounds, `clockLow` (every second under 10s), and the cue for whatever it shows: `check`, `weird`, `checkmate`/`draw` on the result, and `emote:*`.
- Integration plays the board sounds (moves, captures, select, castle, promote, voices), because they need to match the animations.
- The UI picks the music: `title` on menus and the result screen, `game` in play, and `tense` when a running clock drops under 30s (back to calm above 45s).
- The UI calls `audio.unlock()` on the first tap or key press.

**What the UI does by itself**: Start (setup) and Rematch reset the HUD and switch to the game screen, then emit `startGame` / `rematch`. "Quit to title" just shows the title, so integration should treat `screenChanged: title` from a game as quitting. `screenChanged: pause` means pause the game.

## How to run the demo
1. Start the `ui-demo` launch config (port 4414; it moves to 4415 if 4414 is busy).
2. Open `/src/ui/demo.html`.
3. Click the **Demo controls** tab on the left edge. It has:
   - buttons for every screen
   - **▶ Start fake game**: a bot game with 3+2 clocks (running 4× fast) and Weird Mode on. It plays Morphy's Opera Game through chess.js: castling, checks, captures, then mate.
   - **Local 2-player**
   - **Low clock**: drops the clock to 12s so you hear the tick and the tense music
   - single events: check, weird, emotes, bot thinking, promotion for each side, error line
   - each result type
   - the music tracks
   - a **sound board** with all 35 cues
   - the **level table**
   - a log of the UI events

You can also play through the real screens: Play → Start game runs the fake game with your setup choices. Undo, resign, emotes and rematch all work.

Everything behind the UI is a **stand-in**: a flat CSS board, not the real world. It's labelled on the page.

Checked: no console errors. Every control is 44px or more and nothing scrolls sideways, at 1024px and at 390px. Focus rings, the Tab trap and Esc work. Settings survive a reload.

## Contract requests
1. **Skins**: the Ui can't get the skin list. Add `Ui.setSkinCatalog(side, cast.listSkins(side))`, or pass the `Cast` to `createUi`. *Workaround*: `MenagerieUi.setSkinCatalog()` exists. Until it's called, Customize uses a stand-in list based on the cast stream's plan (Meadow, Porcelain, Candy, Gilded / Lagoon, Abyss, Coral, Pearl, plus 6 accessories). Those ids are guesses.
2. **Errors**: the Ui has no way to show an error, e.g. when core rejects a FEN. Add `Ui.showError(message)`. *Workaround*: `MenagerieUi.showError()` exists.
3. **Game info**: if integration starts a game without the Ui's setup screen, the HUD doesn't know the options (names, clocks, which side is the bot). Add `Ui.setGameInfo(options)`. *Workaround*: `MenagerieUi.setGameInfo()` exists. It also resets the HUD.
4. (New, small) **Names**: the UI keeps its own animal names in `config.ts`, copied from the spec roster. If the cast's `displayName()` should be the only source of names, pass it in the same way as the skins.

To use the extras, integration can do `const ui = createUi(root, audio) as MenagerieUi` (exported from `src/ui/index.ts`).

## Open design questions for Johanes
- **Animal icons** are my first-pass SVG faces. Should they become proper drawn icons, or small renders of the 3D animals later?
- **Emotes** use system emoji (😂 😍 😲 😜 😠 😴), so they look a bit different on each device. Keep them, or draw our own?
- **Bot names** (Sleepy Snail … Grandmaster Kraken): are you happy with these?
- **Card positions**: vs the bot, you're at the bottom. In local games Land is always at the bottom, even if the camera turns to face Sea. Should the cards swap when the camera turns?
- **Move list** is open by default on wide screens and closed on phones. OK?
- **Customize preview** just tints the face icons toward the swatch colour. The real look only shows on the board.
- **Sounds**: I balanced them by numbers, but nobody has listened to them yet. The animal voices are synth sketches and may want recorded samples later (none downloaded). Please listen on the sound board.
- **Music volume vs effects**: music sits at 55% of effects at equal slider settings. It hasn't been level-checked against them yet.

## Known issues
- The music tracks haven't been measured by the level check: it only renders effects. They have only been checked in code.
- In the demo, if the window starts wide and then shrinks to phone size, the move list stays open (it only picks its default once at start).
- `quality` and `showCoordinates` are only saved and emitted (`settingsChanged`). The world stream has to act on them.
- FEN check is a basic shape check. Core does the real one and should report failures through `showError`.
