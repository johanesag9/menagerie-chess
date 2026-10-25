# Phase 1 session briefs

Four sessions run at the same time. Each one is Opus 5.5 at high effort, in its own git worktree and branch.
Every session first reads `CLAUDE.md` (ownership, rules, done criteria) and `GAME_SPEC.md`.

---

## core: rules, bot, clocks, Weird Mode
**Owns** `src/core/`. **Exports** `createGame(): GameController` (`src/contracts/types.ts`).

Build:
- A `GameController` on chess.js. It emits every event in `GameEventMap`, in this order after a move: `moved`, `check` (if any), `turnChanged`, `gameOver` (if any).
- **Stable piece ids.** `PieceId` = `side-kind-startSquare` (e.g. `land-n-g1`), with `-promo<N>` for promoted pieces. Track them through every move, capture, en passant, castling and promotion, and restore them on undo. `MoveResult` must fill `pieceId`, `captured` (with the real captured square for en passant), `rookMove` for castling, and `flags`.
- **Bot:** Stockfish compiled to WASM, running in a Web Worker. You may add the `stockfish` npm package; use the single-threaded "lite" build so it runs without cross-origin isolation headers. Map `BotLevel` 1–8 to skill, depth and move-time so level 1 is beatable by a child and 8 is very strong. Give level 1–3 a little randomness so they feel human. Emit `botThinking`. Never block the main thread.
- **Clocks:** untimed or `initialMs` + `incrementMs`. Emit `clock` about 10 times a second while running. Timeout ends the game; when the opponent has insufficient material, it's a draw.
- `pause()`/`resume()` freeze clocks and hold the bot's reply. Integration pauses while move animations play.
- **Undo:** in local games, one ply. Against the bot, it takes back the bot's reply and your move. Emit `undone` with the restored `pieces`.
- `resign`, `sendEmote` (just emits `emote`), FEN start via `GameOptions.fen` (reject invalid FEN with a clear error), `needsPromotion`, `legalTargets`.
- **Weird Mode scheduler:** when `weirdMode` is on, emit a `weirdEvent` every 4–6 plies with a random kind and sensible `squares`. It must never change chess state.
- **Tests (vitest):** castling both sides, en passant id tracking, promotion ids, undo against the bot, threefold, stalemate, timeout, insufficient material, and id stability over a full scripted game.
- **Demo:** `src/core/demo.html`, a plain 2D DOM board using Unicode or animal emoji labels. You can play local or against the bot, with a level picker, clocks, undo and FEN load. Style it simply; it's a dev tool.

---

## world: shoreline diorama, camera, board, picking
**Owns** `src/world/`. **Exports** `createWorld(opts): Promise<World>`.

Build the chosen world (spec: "World: Shoreline diorama") as production code. Start from `prototypes/a-shoreline/main.ts`, `prototypes/shared/stage.ts` and `prototypes/shared/board.ts`, and make it better:
- **Renderer:** ACES tone mapping, soft PCF shadows, a modest environment map, and post-processing (tilt-shift, vignette, light bloom). Run `compileAsync` before reveal and handle resize and zero-size canvases. Hide the canvas until the first good frame, then fade in.
- **Quality tiers:** `high` and `low`. Auto-detect phones and weak GPUs. Low means fewer props, a smaller shadow map, no tilt-shift and pixel ratio ≤ 1.5. Hold 60fps on a laptop.
- **Board:** 8×8 in board-local space (`pieceLayer` rides with the board). Ranks 1–4 meadow squares, 5–8 beach squares, wooden frame, optional coordinates (a1–h8) along the frame.
- **Diorama:**
  - Meadow side: grass that sways in the wind (vertex shader), flowers, trees, picket fence, dog house.
  - Beach side: sand, animated water with shoreline foam, rocks, starfish, umbrella, sand castle.
  - Overhead: drifting clouds, a few birds that loop.
  - Make it richer than the prototype, but keep the board readable.
- **Picking:** raycast squares with mouse and touch. Emit `squareHovered` and `squareClicked`. A tap must not fire when the user is orbiting or dragging.
- **Highlights** (`setHighlights`), all with soft animated reveals:
  - selected square glow
  - legal-move dots
  - capture rings
  - last-move tint
  - check pulse on the king's square
- **Camera:**
  - Default framing from behind Land, at a 3/4 angle. Orbit is clamped so it never goes under the board.
  - `faceSide(side)` swings smoothly to the other side for local 2-player hand-off.
  - `focusOn` gives a gentle punch-in.
  - `shake` respects a reduced-motion flag (read `matchMedia('(prefers-reduced-motion)')`).
  - An intro fly-in on first reveal (about 2.5s, skippable).
- `playWeirdEvent` with a visible effect for every `WeirdEventKind`:
  - tilt: board wobble
  - fog: roll-in
  - gravityHop: nudge `pieceLayer`
  - pigeonPeek: a pigeon flies in, sits, and leaves
  - tideSwap: water rises over the beach squares briefly
  - disco: coloured spotlights
- `onFrame`, `setPaused`, `dispose` (free everything).
- **Demo:** `src/world/demo.html` with stand-in tokens (simple cylinders in team colours, clearly labelled stand-ins). Buttons for every highlight, faceSide, focusOn, shake, each weird event, and a quality toggle. Clicking a square logs and highlights it.

---

## cast: the 12 animals and all their animations
**Owns** `src/cast/`. **Exports** `createCast(opts): Cast`.

Build the real cast (spec: "Roster" + "Personality guide"). Start from the stand-ins in `prototypes/shared/animals.ts` and make each animal clearly better: more character, cleaner silhouettes, and expressive faces (blinks, looks, mouth shapes). Keep them code-built, toy-like (vinyl/clay look) and readable from the default camera at phone size.
- Each animal stands on the team pedestal (Land cream and gold, Sea deep teal and aqua) and fits within one square (`CastOptions.squareSize`).
- Kings and queens are clearly the tallest.
- Bake static parts per material for low draw calls, and share geometries and materials between instances.
- **Every `PieceActor` method**, with GSAP and a distinct style per animal:
  - `update`: idle loop with breathing, blinks, glances, and tails and tentacles moving. Pieces never all sync up.
  - `setSelected`: an excited reaction plus a lift. `setHovered`: a small perk-up.
  - `moveTo` uses the spec's travel styles: horse gallops and leaps, seahorse floats with a bubble trail, goat hops, elephant stomps (expose a hook so integration can shake the camera on each stomp), turtle slides, octopus swings, pug waddles, blobfish jiggles, crab scuttles sideways, dachshund trots.
  - Turn to face the travel direction, then back to face the opponent.
  - Squash and stretch on landing. No move over about 1.2s.
  - `attack(victim)`: a per-animal attack that resolves at impact. Examples: horse rears and kicks, octopus slaps with a tentacle, puffer inflates and bonks, elephant trumpets and squirts.
  - `defeat(by)`: slapstick, never violent: launched off the board with spin, stars and a poof, or flattened like a pancake and then popping away. Pick per victim. It resolves once the piece is gone.
  - `celebrate`, `emote` (for each `EmoteKind`, a little speech bubble or icon sprite above the head plus a body reaction), `lookAt`.
- **Skins:** 3–4 palettes per side and 4–6 accessories (party hat, sunglasses, bow tie, flower crown, pirate hat...). `setSkin` swaps them live. Implement `listSkins` and `displayName`.
- `reducedMotion` support: a module-level setter or option you document. Movement gets shorter, with no spins.
- **Demo:** `src/cast/demo.html`. A turntable lineup of all 12 animals with buttons for every animation per piece, an attack/defeat pairing picker, a skin picker, and an FPS readout. Use a simple lit floor; you don't need the world.

---

## ui + audio: screens, HUD, sound
**Owns** `src/ui/` and `src/audio/`. **Exports** `createUi(root, audio): Ui` and `createAudio(): AudioEngine`.

**UI**, in DOM and CSS over the canvas. No framework needed; vanilla TS is fine. Every screen and component in the spec:
- Title, with a big wordmark for the working title "Menagerie Chess" (keep the name easy to change in one place).
- Game setup: opponent local or bot, bot level 1–8 with fun names, time control, Weird Mode toggle, play as Land or Sea, and FEN paste (advanced).
- Game HUD: two player cards with clocks and turn indicator, a captured-pieces tray using animal icons, a collapsible move list in SAN, an emote wheel, and a menu button.
- Promotion picker, which returns a promise.
- A check banner, a Weird Mode event toast, and the result screen with rematch.
- Customize (palette and accessory per side, previewed as swatches), settings (volumes, quality, reduced motion, coordinates) and pause.

Style:
- Playful and chunky, fitting a sunny toy diorama: rounded, soft shadows, a warm cream palette with Land gold and Sea teal accents.
- Fredoka or a similar Google Font.
- Animated transitions on every screen change (GSAP or CSS), with hover and press states everywhere.
- Fully usable at 390px wide with touch targets of 44px or more, and keyboard-accessible with focus rings.
- Never block the board during play. Keep the HUD on the edges.

Persist `Settings` in `localStorage`, wrapped in try/catch. Emit the `UiEventMap` events.

**Audio:**
- Sound effects are synthesized with WebAudio, so nothing is downloaded. Cover every `AudioCue`:
  - soft UI clicks and hovers
  - "boop" select and deselect
  - footstep or splash movement sounds per side
  - a cartoon bonk for captures
  - fanfares for check, mate and draw
  - a ticking low-clock warning
  - a weird whoosh
  - a short pitched animal "voice" per piece kind and side, like a squeak, neigh or blub
  - emote sounds
- Music: a short, gentle generative loop per track, synthesized too.
- Respect volumes. Implement `unlock()` for autoplay rules.
- If a sound really needs a recorded sample, list it in the report instead of downloading.

**Demo:** `src/ui/demo.html`. Every screen, with a "fake game" button that streams fake game events into the HUD, and a sound board that plays every cue.
