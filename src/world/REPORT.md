# World stream report

## Phase 4: sinking island, treasures, splash

Branch `claude/p4-world-3e55fc`. New files: `sink.ts`, `treasures.ts`, `splash.ts`, `phase4.test.ts`. Changed: `chaos.ts` (the particle system is exported and droplets can die at a water line), `index.ts`, the demo.

### What's done
- **`setSunk(sunk, warn)`** (Sumo)
  - **Sunk squares:** the tile drops a little and stays faintly visible under deep-teal water. White foam runs where the water meets dry tiles and the frame, and the water spills a little over the rim. Sunk tiles bob very slightly.
  - **A ring sinking at once** (4 or more new squares): a wave crest rolls in from the board edge, reaching the Sea side first and wrapping round to Land. Spray flies off the crest. Each tile pops, dunks and tips outward as the crest passes, with droplets. The crest crashes into the next dry ring with a spray and a small camera shake. About 1.2s in total.
  - **1–3 new squares** just drop quietly, with no wave.
  - **Warn squares:** the tile wobbles gently with a little shudder every couple of seconds. Its edge goes dark and wet with a moving sheen, and dark water creeps into the gaps around it.
  - **`setSunk([], [])`** restores the board at once.
  - **Draw calls:** the water is one mesh over the whole board; the wet edges are one instanced mesh; the tiles are the board's own instanced squares (only their matrices move). Both are hidden, so they cost nothing, outside Sumo. Everything is `noPick`.
- **`setTreasures(list)`** (Raid)
  - **Home markers** while the list isn't empty: a red dog bowl (pale inside) at Land's home, and an open pink ribbed shell at Sea's home, opening toward the middle of the board. They pop in.
  - **Treasures on the board:** Land's cream cartoon bone and Sea's glossy white pearl (pearly sheen). Each is about 0.3–0.4 of a square and floats with a slow bob and spin, a soft glow on the board under it, and an odd twinkle. At home they sit in the bowl or shell.
  - **Changes animate:** a new square = it drops in with a little hop; a square change (flying home) = an arc with a spin and a sparkle puff on landing; picked up (carried) = a quick lift and shrink. Carried treasures are skipped (the cast draws them). `[]` hides everything at once.
  - **Shared colours:** bone `#f3e6c8`, pearl `#f7f4ee`, shell `#f2a7b5`, exported as `TREASURE_COLORS`. The exact shapes are exported too (`makeBoneGeometry`, `makePearlGeometry`) if the cast wants them.
- **`splash(point, big)`:** a jagged water crown shoots up and collapses, a double ripple ring spreads, droplets fly and die when they fall back to the water line, and a puff of mist rises. `big` (a king) is 1.6× bigger with twice the droplets. `point` is world space. Four splashes are pooled, so a whole ring falling in at once is fine.
- **Reduced motion:** a lower, quicker sink with no crest, spray or tile pop; no wobble (the wet edge stays); a small crown with few droplets; treasures slide instead of arcing, with no bob or spin.
- **No first-use hitch:** every new shader compiles in the existing warm-up. The program count is the same at boot and after running every Phase 4 effect (35 on low, 76 on high), and frame times during the effects matched idle in headless Chrome.
- **Tests:** ring sizes, ring-sink timing (every tile drops inside the effect, Sea first, Land last, normal and reduced). World tests: 24.

### Ring-sink timing (for integration)
Exported from `src/world/index.ts`: `SINK_TIMING`, `sinkDropTimes(squares, reduced)` and `ringOf(square)`.

| | Whole effect | Crest crashes into the next ring | One tile's drop |
|---|---|---|---|
| Normal | **1.2s** | 0.74s | 0.4s |
| Reduced motion | **0.8s** | (no crest) | 0.3s |

**When each tile drops:** `sinkDropTimes(ring, reduced)` gives each square's time in seconds after `setSunk`. Start an animal's fall on a sinking square at its square's time.

| Ring | Sea-side middle | Sea corners | Land corners | Land-side middle | Reduced motion |
|---|---|---|---|---|---|
| Outer (0) | 0.31s | 0.37s | 0.52s | 0.58s | 0.17–0.33s |
| Next (1) | 0.46s | 0.50s | 0.60s | 0.64s | 0.26–0.36s |
| Next (2) | 0.54s | 0.57s | 0.65s | 0.67s | 0.30–0.38s |

With a 0.55s fall, the last animal is under by about 1.2s. The demo does exactly this with its stand-in tokens, and splashes each one as it hits the water.

**Water height on a sunk square:** about y 0.35 (board-local, which is also world space at rest). Use it for `splash` points.

### How to run the demo
Start `world-demo` (port 4412) and open http://localhost:4412/src/world/demo.html. The pieces are **stand-in tokens**, not the animals.
- **Sumo:** Sink next ring (the tokens on it fall in step and splash, and the next ring starts to wobble), Warn next ring, Sink 1 square, Restore board.
- **Raid:** Treasures at home, Steal pearl, Drop pearl (d4), Pearl flies home, Drop bone (e5), Bone flies home, Hide treasures. The tokens on e1 and d8 are hidden while treasures show (nobody stands on their own treasure).
- **Splash:** Splash and Big splash (king). They land on a sunk square if there is one, else in the sea.
- **URL shortcuts:** `&warn`, `&sink=1|2|3` (sinks that many rings), `&treasures`.

### Contract requests
1. **Ring timing in the contract.** Integration shouldn't import from `src/world/`. Suggest a `World.sinkDropTimes(squares)` method, or `setSunk` returning `Promise<void>` that resolves when the wave ends. For now it's `sinkDropTimes` from `src/world/index.ts`.
2. **`splash` point space.** I read it as world space. If the cast's `splash` event gives a `pieceLayer` point, it's the same while the board is at rest.

### Open design questions for Johanes
- **Sunk look:** the dropped tile stays faintly visible under the water (its checker colour shows through). Should sunk squares be solid sea instead?
- **Where the wave comes from:** it reaches the Sea side first and wraps round to Land, as if the sea pours in. Should it come in from all sides at once?
- **Warn wobble strength:** gentle, about 1.5°, with a shudder every couple of seconds. Stronger?
- **Bowl colour:** red outside, pale steel inside. **Shell:** pink with darker ribs.
- **Treasure size:** bone 0.4 long, pearl 0.3 across. Bigger reads better at 390px but covers more of the square.

### Known issues
- **The water spills a little onto the rim** next to sunk edge squares, so the frame looks wet there. That's on purpose, but it shows even while a ring only wobbles.
- **Warn and the tide/disco:** these never meet (Sumo has no Wheel of Chaos), so they weren't tested together.
- **Testing:** headless Chrome on this Mac only, at 1280×800 and 390×844, with no console errors. It ran at 56–60fps once the machine calmed down (about 30fps while the load average was over 100), with no hitches from these effects. No real phone yet.

---

## Phase 3: blocked squares, chaos spectacles, aiming highlights

Branch `claude/p3-world-022f8e`. New files: `squareFx.ts` (blocks), `chaos.ts` (Wheel of Chaos), `phase3.test.ts`. Changed: `highlights.ts`, `weird.ts`, `textures.ts`, `constants.ts`, `index.ts`, the demo.

### What's done
- **`setSquareEffects`** shows exactly the blocks given. It compares with what is already shown: new blocks appear, missing ones vanish, a changed `turnsLeft` eases in.
  - **Land:** a cream-and-cobalt porcelain vase falls, tips over with a bounce and spills water, petals and three flowers.
  - **Sea:** a dark purple ink cloud, a lumpy dome that slowly swirls (animated shader) over a stain with moving tendrils.
  - **Countdown:** the puddle shrinks and the cloud thins and shrinks as `turnsLeft` goes from 4 to 1.
  - Both are `noPick`, so clicks go through to the square. Objects are pooled and reused.
- **`playChaos`**, each one skippable:
  - **tide:** a wave with a foamy rolling crest comes in from the sea over ranks 5–8 and reaches the middle line. Spray comes off the crest, then a splash. It drains back and leaves a wet sheen. The beach squares darken while wet, and the sea pool surges.
  - **pigeon:** the pigeon flies in, lands on `opts.carry`, grabs it (reparents it to a hook under its feet) and flies up and off-screen. It wobbles and the piece swings under it. `carry` is detached (`removeFromParent`, never disposed) before the promise resolves, also when skipped. With no `carry` (no pawns), it just flies past.
  - **earthquake:** the board rumbles and tips slightly toward `direction`, with two camera shakes, dust puffs drifting that way, and three crack decals that fade.
  - **disco:** a 1.5s version of the Weird Mode disco (mirror ball, coloured beams and spots, dance-floor squares), plus three sparkle bursts.
- **Skipping:** any click or tap on the canvas, or any key, jumps every running spectacle to its end. It also skips the intro, as before.
- **Reduced motion:** shorter effects, no camera shake, a low wave, a gentle rumble and less wobble.
- **Highlights:**
  - `targets`: a violet ring with four turning star glints that twinkle, and a soft violet glow inside. It ripples in from the selected square.
  - `area`: a soft lilac rounded-square wash that breathes.
  - Each is a single instanced draw call, however many squares are shown.
- **No first-use hitch:** every new shader is compiled in the existing warm-up before the first frame. The program count stays the same (63 high, 28 low) before and after running every block, chaos effect and highlight.
- **Tests:** tide crest at 40% (normal and reduced), and the block diff (show exactly, vanish, swap Land↔Sea, pooling). World tests: 18.

### Tide timing (exact)
Exported as `TIDE_TIMING` from `src/world/index.ts`.

| | Total | Crest | Holds until | Gone |
|---|---|---|---|---|
| Normal | 1.80s | **0.72s** (40%) | 1.02s | 1.80s |
| Reduced motion | 1.40s | **0.56s** (40%) | 0.80s | 1.40s |

**Crest** means the wave front reaches the middle line (rank 4/5) at full height. Start the swept pieces' slide at the crest; a slide of about 0.5s lands while the water is still on the beach. The demo does exactly this with its stand-in tokens.

**Other lengths:**
- pigeon: 2.05s with a piece (1.9s reduced); it grabs at 0.87s. A fly-past takes 1.6s.
- earthquake: 1.6s (1.0s reduced).
- disco: 1.5s.

All of them run on world time, so `setPaused` holds them.

### How to run the demo
Start `world-demo` (port 4412) and open http://localhost:4412/src/world/demo.html. The pieces are **stand-in tokens**, not the animals.
- **Blocked squares:** Land vase, Sea ink, "Next turn (−1)" counts every block down and removes it at 0, Clear blocks.
- **Wheel of Chaos:**
  - Tide: Land tokens on the beach slide back one rank at the crest. This stands in for integration.
  - Pigeon steals: it takes a random pawn token.
  - Quake ← and Quake →.
  - Disco.
  - The log shows how long each one took.
- **Aiming:** Targets: escape, Targets: block, Area: stomp, Targets + area, Clear aim.
- **URL shortcuts:** `&blocks` (sample blocks), `&aim=targets` or `&aim=area`, `&chaos=tide|pigeon|earthquake|earthquakeRight|disco`.

### Contract requests
1. **Tide crest timing in the contract.** Integration shouldn't import from `src/world/`. Suggest either `playChaos(..., { onCrest })`, or a `World.chaosTiming` field. For now it's `TIDE_TIMING` from `src/world/index.ts`.
2. **A skip on `World`.** Today only clicks and keys on the canvas skip a spectacle. If the Director has its own skip (a button, or `cast.skipAll`), add `World.skipEffects()`. It's a one-liner here.
3. **Earthquake `direction`.** I took `'left'` to mean toward the a-file (−x, as Land sees it). Please confirm that core means the same.
4. **Tide `squares`** is accepted but not needed: the wave always covers the whole beach. Fine to keep as a hint.

### Open design questions for Johanes
- **Vase look:** cream porcelain with cobalt stripes, and pink and yellow flowers. **Ink:** near-black purple. Do these fit?
- **Target colour:** violet `#8a4dff` with cream glints. Area wash: lilac `#b866ff`. They're easy to change in `constants.ts`.
- **Wave height:** the crest stands about a third of a square tall. Bigger reads more, but hides more of the pieces.
- **Chaos disco** is a short version of the Weird Mode disco. Should it be its own look?
- **Earthquake dust** is subtle on the cream squares. Should it be heavier?

### Known issues
- **Draw calls:** each blocked square adds 3 (vase, plus its shadow) or 2 (ink). Targets and area are 1 each. Chaos adds a few draws only while it runs; idle cost is unchanged.
- **Disco objects are shared.** Weird disco and chaos disco use the same objects, so if both played at once the later one would win. That can't happen in Crazy, because Weird Mode is off there.
- **Testing:** checked in headless Chrome on this Mac only, at 1280×800 and 390×844, at about 60fps with no console errors. No real phone yet.
- **Test timeouts:** `npm test` passes. Two earlier full runs failed on core's slow tests (rules fuzz, bot game) timing out while the machine was heavily loaded (load average about 40). Core is untouched here.

---

## Phase 1 (unchanged)

Branch `claude/stream-world-c0afbe`. Everything lives in `src/world/`. The only export the contract needs is `createWorld` from `src/world/index.ts`.

## What's done

**Renderer** (`stage.ts`)
- ACES tone mapping, soft PCF shadows (`PCFShadowMap` with `shadow.radius`), and a soft room environment map.
- High tier: an HDR target with 4x MSAA, then light bloom (only the brightest highlights glow), then tilt-shift.
- Low tier: renders directly, with no post passes.
- The vignette is a CSS overlay, so it costs no GPU time.
- Every shader is compiled with `compileAsync` before the first frame, including the hidden Weird Mode effects and highlights. One hidden frame is rendered, then the canvas fades in.
- Resizing follows the container (ResizeObserver). Zero-size canvases (hidden tabs) are never rendered.
- Pixel ratio steps down automatically if frames stay slow. It never steps back up.

**Quality tiers** (`quality.ts`)
- `low` is picked automatically for phones, touch tablets, software or weak GPUs, and devices with under 4 GB of memory.
- Low means 35% of the grass, fewer flowers, no extra props (palm, birds, buoy, bushes, extra clouds and others), a 1024 shadow map, no tilt-shift or bloom, and pixel ratio ≤ 1.5.
- The tier can be switched live with `setQuality`.

**Board** (`board.ts`)
- 8×8 rounded toy tiles in one draw call.
- Ranks 1–4 are meadow squares (cream and green); ranks 5–8 are beach squares (sand and aqua).
- Wooden frame with brass corner studs.
- Coordinates a–h and 1–8 on the frame, readable from both the Land and the Sea side, drawn as one mesh.
- `pieceLayer` is a child of the board, so pieces ride along when the board tilts.

**Diorama** (`diorama.ts`)
- A wooden display base with a tray lip.
- **Meadow:** about 1,100 grass tufts that sway in a wind shader, flower clumps that sway with them, 5 lollipop trees, bushes, a picket fence with a gate, a dog house with a bowl and a bone, stepping stones, and a spinning pinwheel.
- **Beach:** an animated water pool with shoreline foam and sparkles, rocks, starfish, shells, an umbrella with a striped towel, a sand castle with a waving flag, a bucket and spade, a palm tree and a bobbing buoy.
- **Sky:** a gradient sky with a glow where the sun sits, drifting clouds, and 4 seagulls looping over the sea.
- Static props are merged per material to keep draw calls low.

**Picking** (`picking.ts`, `tap.ts`)
- Mouse and touch. A tap on a piece picks the square the piece stands on; otherwise the ray hits the board plane. This still works while the board tilts.
- Orbit drags, pinches, right-clicks and long holds never count as clicks.
- Hover is checked once per frame and only emitted when the hovered square changes.

**Highlights** (`highlights.ts`), all easing in and out:
- selected: a gold square-edge glow that pulses
- legal-move dots, which ripple out from the selected square
- capture: a red rotating ring
- last move: an orange tint on both squares
- check: a red square pulse plus expanding rings

**Camera** (`camera.ts`)
- Default view is a 3/4 angle from behind Land, framed so the whole board fits. On tall phones it moves more top-down.
- Orbit is clamped so the camera never goes below about 20° above the board, and pan is off.
- `faceSide` swings in a crane arc.
- `focusOn` punches in, holds, then eases back.
- `shake` uses smooth trauma-based shake.
- On first reveal there is a 2.6s fly-in. Any tap, key or wheel skips it.
- Reduced motion (the OS setting or an override) gives a shorter intro and swing, a gentler punch-in, no shake, and smaller tilts and hops.

**Weird Mode** (`weird.ts`). Every kind has an effect, and its promise resolves when the effect ends:
- **tilt:** the board lifts and wobbles like jelly (3s)
- **fog:** sea mist rolls in and the far side goes hazy (8s)
- **gravityHop:** `pieceLayer` bounces three times, with small shakes (1.3s)
- **pigeonPeek:** a code-built pigeon flies in, lands on top of the piece on `squares[0]` (or a random piece), bobs, looks around and leaves (4.7s)
- **tideSwap:** the sea washes over the beach squares and the pool rises (5s)
- **disco:** the lights go down, a mirror ball drops in, and coloured beams and spots sweep the board while the squares light up like a dance floor (7.6s)

**Other:** `onFrame`, and `setPaused`, which freezes world time (camera moves, effects and shader time) and only re-renders when the view changes. `dispose` frees GPU resources, listeners and the WebGL context, and detaches `pieceLayer`.

**Tests:** 14 unit tests covering square maths, ray-to-square, quality detection, the animator and tap-vs-drag.

**Checked:**
- `npm run typecheck` and `npm test` pass.
- Checked in headless Chrome on this Mac (M1 Pro) at 1280×800 and at 390×844. No console errors. All six weird events played at once, followed by every camera call, then dispose and recreate.
- Ran at 60fps in headless Chrome at 1280×800, pixel ratio 1. The in-app browser earlier showed a median frame of 15.8ms at pixel ratio 2. A mid-range laptop and a real phone are not tested.
- The world alone draws 172 calls on high (including the shadow pass and post-processing) and 71 on low.

## How to run the demo
1. Start the `world-demo` launch config (port 4412).
2. Open http://localhost:4412/src/world/demo.html

The pieces are **labelled stand-in tokens** (cylinders in team colours), not the real animals. The demo uses chess.js, so every highlight is a real legal position:
- Click a token to see its legal moves, then click a dot to move.
- "Sample position" loads a check with a capture available.

The buttons cover every highlight, Face Land and Face Sea, focus, shake, replay intro, each weird event, quality, coordinates, reduced motion, pause, and dispose + recreate.

URL options for quick checks: `?quality=low|high`, `&skipIntro`, `&sample`, `&select=e2`, `&face=sea`, `&weird=disco` (any kind).

## Contract requests
1. **`squareToWorld` meaning.** It returns the square centre with the board at rest. Because the board sits at the origin, this is also the position inside `pieceLayer`. Pieces should be positioned with it inside `pieceLayer`. I suggest renaming it to `squareToLocal`, or noting this in `types.ts`. A live world position would put the tilt or hop offset permanently into piece positions.
2. **Settings the world can't receive today.** `Settings` has `quality`, `reducedMotion` and `showCoordinates`, but `World` has no setters. I added these as extras on the returned object (type `ShorelineWorld`):
   - `setQuality`, `setCoordinatesVisible`, `setReducedMotion(boolean | null)`
   - `playIntro`, `skipIntro`
   - `camera` (read-only, for projecting a piece to the screen)
   - `stats`

   Please add the ones you want to `World`.
3. **Intro timing.** The fly-in plays on the first frame. If the title screen sits on top of the world, integration may want an `autoIntro: false` option in `WorldOptions` and a call to `playIntro()` when the game starts. Today the workaround is to call `skipIntro()` right away, then `playIntro()` later.
4. **`setHighlights` semantics.** Fields you leave out keep their current value; pass `null` or `[]` to clear one. Please note this in `types.ts`.
5. **Weird event length.** The world doesn't know about turns, so effects run for a fixed 1.3–8s and `durationTurns` is ignored. If an effect must last exactly one turn, add something like `endWeirdEvent(kind)`.
6. **`tideSwap` comment.** `types.ts` says "board colours swap". I built what the brief asks for: water rises over the beach squares. Please update the comment.
7. **`userData.noPick = true`.** Picking ignores objects with this flag, or under a parent that has it. Cast effect sprites that float away from their piece (stars, poofs) should set it.

## Open design questions for Johanes
- **Camera:** the default is a 3/4 view from the right of the Land side. Should it be straight behind instead? And after a player orbits, should it drift back to the default on its own? Today it stays where they left it.
- **Coordinates** are on by default. Keep them on?
- **Highlight colours:** gold for selected, red for capture and check, orange for last move, dark dots for legal moves. Do these match the UI palette?
- **Weird Mode lengths and strength:** fog thickness, disco length (about 7.6s), and how high the hop goes.
- **Foreground trees:** the big lollipop tree at the front right partly covers the dog house at 16:10. Move it?
- **Ideas from the spec not built yet:** waves reacting to Sea moves, and the sun moving slowly through the game. They would need a small API, for example `world.notifyMove(side)`.

## Known issues
- **First load time.** A cold first load (fresh browser profile) sometimes took 4–9s to compile shaders in headless Chrome. Warm loads take 0.3–0.8s. This looks like cold GPU start-up in headless mode, but I couldn't confirm it on a real device. Worth a check on a real phone and a mid-range laptop.
- **Testing method.** The app's browser pane was hidden for most of this session, which freezes animation. Visual QA was done with headless Chrome instead. There has been no real-phone touch test yet.
- **Pixel ratio.** It only steps down, never back up, within a session.
- **Grass shadows.** Grass doesn't cast shadows, for speed.
- **Stomp effect.** Bouncing is applied to the whole `pieceLayer`, not each piece separately, so it can't conflict with cast animations.
- **Fixed lengths.** The fog and disco lengths are fixed (see contract request 5).
