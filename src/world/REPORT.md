# World stream report

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
