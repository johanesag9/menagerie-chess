# ui + audio stream report

Status: **partial, stopped early (usage limit reached on 2026-10-25).** Not done.

## What's done
- `src/audio/` (commit `ca3642e`). Type-checks. **Not yet heard or level-checked in a browser.**
  - `createAudio()` in `src/audio/index.ts`: WebAudio only, nothing downloaded. Context is built in `unlock()` (call it from a user gesture). Before unlock, `play()` does nothing and `setMusic()` remembers the track and starts it on unlock. Suspends when the tab is hidden. Master compressor, separate music and sfx gains, `setVolumes(music, sfx)`.
  - `src/audio/cues.ts`: a synthesized sound for every `AudioCue`: UI hover/click/back, select/deselect/illegal, paw steps (Land) and splash (Sea), cartoon bonk for captures, castle, promote sparkle, check/mate/draw fanfares, game start, low-clock tick, weird whoosh, 12 animal voices, 6 emote sounds. `ALL_CUES` lists them for a sound board.
  - `src/audio/music.ts`: generative look-ahead music. `title` (sunny marimba), `game` (calm kalimba), `tense` (minor pulse with hats). Tracks crossfade.

## What's left
- All of `src/ui/`: `createUi`, every screen (title, setup, HUD, promotion, check banner, weird toast, result, customize, settings, pause), CSS, settings persistence.
- `src/ui/demo.html` + `demo.ts` with a fake game and the sound board.
- Browser check of sound levels (render each cue, normalise peaks).
- Verify at desktop and 390px, finish this report.

## How to run the demo
Not built yet.

## Contract requests (planned, from reading the contracts)
- The Ui has no way to get the skin list: suggest `Ui.setSkinCatalog(side, listSkins(side))` or pass the `Cast` to `createUi`.
- The Ui has no way to show an error (e.g. core rejects a bad FEN): suggest `Ui.showError(message)`.
- If integration starts a game without the Ui's setup screen, the HUD doesn't know the options: suggest `Ui.setGameInfo(options)`.

## Open design questions for Johanes
- Sounds are first-pass synth sketches. Animal voices especially may want real recorded samples later (none downloaded).

## Known issues
- Audio not yet tested by ear or in the browser.
