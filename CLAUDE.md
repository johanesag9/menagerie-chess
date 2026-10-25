# Menagerie Chess (working title)

A weird, smooth 3D chess game in the browser: Land animals vs Sea animals on a shoreline diorama.
**Read `GAME_SPEC.md` first.** It has the decisions, roster, rules, world and feel targets.

## Streams and ownership
The work is split into streams. Each one runs in its own session, on its own git branch.

| Stream | Folder(s) it owns | Factory it exports |
|---|---|---|
| core | `src/core/` | `createGame` from `src/core/index.ts` |
| world | `src/world/` | `createWorld` from `src/world/index.ts` |
| cast | `src/cast/` | `createCast` from `src/cast/index.ts` |
| ui | `src/ui/`, `src/audio/` | `createUi` from `src/ui/index.ts`, `createAudio` from `src/audio/index.ts` |
| orchestrator | `src/contracts/`, `src/main.ts`, `index.html`, root config, docs | wires everything together |

Rules:
- **Edit only your own folder(s).** Never edit `src/contracts/`, another stream's folder, `src/main.ts`, `GAME_SPEC.md` or this file.
- **Code against `src/contracts/types.ts` and `src/contracts/factories.ts` exactly.** If a contract is wrong or missing something, work around it inside your folder. Write the change you need under "Contract requests" in your `REPORT.md`; the orchestrator updates the contracts.
- Use `Emitter` from `src/contracts/emitter.ts` to implement `EventSource`.
- **Dependencies:** don't add npm packages unless your brief allows it. List any you add in your report. Root `package.json` changes are the only shared-file edits allowed, and only for packages.
- **No downloaded assets** (models, textures, sounds, fonts other than Google Fonts) without Johanes's OK. Build in code or synthesize instead. `steam-scrape/` holds Cat Chess reference material. It is git-ignored and must never be used in the game.
- Commit small and often on your own branch. Never push, merge or rebase onto other branches.

## Demo page per stream
Each stream builds a standalone page, `src/<stream>/demo.html` with `demo.ts`, that shows its work alone, using fake inputs where needed:
- core can show a minimal 2D board in the DOM to play against the bot.
- world can show the scene with plain stand-in tokens.
- cast can show all 12 animals on a turntable, with buttons for every animation.
- ui can show every screen with fake game events.

Run demos with the launch configs in `.claude/launch.json` (each uses its own port), then open `/src/<stream>/demo.html`:

| Config | Port |
|---|---|
| `app` | 4410 |
| `core-demo` | 4411 |
| `world-demo` | 4412 |
| `cast-demo` | 4413 |
| `ui-demo` | 4414 |

## Done means
- `npm run typecheck` passes. `npm test` passes; core must have real rules tests.
- The demo runs with no console errors, at desktop size and at 390px wide.
- It feels smooth: about 60fps on a laptop, with no hitches on first reveal.
- `src/<stream>/REPORT.md` exists, with these sections: what's done, how to run the demo, contract requests, open design questions for Johanes, known issues.

## Working style (Johanes, designer)
- Plain language, short.
- Within the spec, make sensible choices and keep going. When a real design choice isn't covered by the spec, pick a reasonable default, make it easy to change, and list it under "open design questions". Don't block on it.
- Never present a stand-in or guess as finished. Label it.

## Three.js r186 notes
- `PCFSoftShadowMap` is removed. Use `PCFShadowMap` with `shadow.radius`.
- Use `THREE.Timer`, not `Clock`.
- Import addons from `three/addons/...`.
- Call `renderer.compileAsync(scene, camera)` before first reveal, or the first frames stall.
- Merge static meshes per material (`mergeGeometries`) to keep draw calls low. The Phase 0 cast in `prototypes/shared/animals.ts` shows how.
- Guard against zero-size canvases (hidden tabs) before rendering post-processing.

## Reference
- `prototypes/` holds the Phase 0 world prototypes. `a-shoreline` is the chosen world. `shared/animals.ts` has the rough stand-in animals, `shared/demo.ts` the move and capture feel, and `shared/stage.ts` the renderer setup.
- Build them with `npm run proto:build`. Serve them with the `world-directions` launch config (port 4401).
