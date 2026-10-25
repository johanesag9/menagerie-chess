# Cast stream: handoff (work in progress)

Stopped early: the usage limit was reached. Only the foundation is built.

## Done (committed)
- `material.ts`: the "slot" toy material. Each vertex has a `slot` index. Uniform arrays set colour, roughness, metalness, clearcoat and glow per slot, so all animals share one shader program and skins swap live through uniforms. It also has a per-actor `uFlash` (hit flash) and `uRim` (fresnel rim for hover and select).
- `kit.ts`: the rig builder. You hang shapes on bones, then `compile()` merges everything into one rigidly skinned mesh, so each animal plus its pedestal is 1 draw call. `instantiate()` shares the geometry and gives each piece its own bones. Face kit: `eyes` (blink = eye bone scale.y, gaze = look bone rotation, optional smug lid), `mouths` (mSmile/mOpen/mO/mFrown, hidden ones scaled to 0), `brows`, `cheeks`, `crown`, `beads`, `pedestal`.
- `npm run typecheck` passes.

## Plan for the rest
1. `animals/land.ts`, `animals/sea.ts`: the 12 builders. Use chibi proportions (big heads and eyes). Heights: pawn ~0.55, knight/bishop ~0.85, rook ~0.95, queen ~1.15, king ~1.25 (the tallest). Standard bones: base, body, head, the eye, look, mouth and brow bones, plus parts (tail, legs, ears, trunk, tentacles in 3-bone chains, claws, fins). Natural colours per slot.
2. `palettes.ts`: Land has Meadow (natural), Porcelain (Delft blue and white, gold), Candy and Gilded. Sea has Lagoon (natural), Abyss (dark with glowing accents), Coral and Pearl. Slots `teamBase` and `teamRim` stay fixed per side. Accessories are separate meshes on head anchors (hat, eyes, neck), coloured through slots acc1–acc4: party hat, sunglasses, bow tie, flower crown, pirate hat, top hat.
3. `actor.ts`: a PieceActor with a per-actor material. GSAP tweens write an action-state object, and `update()` combines idle and action onto the bones, so they never fight. Idle uses a random phase and rate per piece, plus blinks and head glances. If the actor is disposed mid-animation, its promises resolve anyway. Add `skip()`.
4. Travel, attack, defeat, celebrate and emote styles per animal (the full list is in the cast brief). Captures: attack approaches to about 0.75 of a square short of the victim and resolves at impact. Defeat resolves when the piece is gone, then removes it from its parent.
5. `fx.ts`: stars, poofs, bubbles, water squirt, ink, and emote bubble sprites drawn on canvas.
6. `index.ts`: `createCast` plus extras: `setReducedMotion`, an `on('stomp'|'impact'|'land'|'poof')` event source, and `preload()`.
7. Demo (`demo.html`/`demo.ts`, port 4413), then `REPORT.md`.

## Assumptions to carry into REPORT.md
- Facing: rank 1 is at +Z, as in the prototype. Land default yaw = π, Sea = 0. Each piece's home yaw is read from `object.rotation.y` at its first action.
- `moveTo` and `lookAt` targets are in world space and converted to parent-local.
- `actor.object.scale` = squareSize.

Contract requests to make: a stomp/impact event hook on `Cast`, `PieceActor.skip()`, `setReducedMotion`, and the board's forward direction.
