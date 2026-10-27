# Cast stream: report

The 12 animals and all their animations. Everything is built in code. No downloaded assets, and nothing from `steam-scrape/`.

## What's done
- **`createCast(opts)`** in `src/cast/index.ts`. It matches `CreateCast`, with a compile-time check. It returns the contract `Cast` plus the extras listed under "Contract requests".
- **All 12 animals** (`animals/land.ts`, `animals/sea.ts`). Chibi proportions, a toy vinyl look, each on its team pedestal, each inside one square.
  - Heights in squares: pawns 0.55, knights and bishops 0.86, rooks 0.97, queens 1.15, kings 1.25. Kings are the tallest, then queens.
  - Each animal is **one skinned mesh** (one draw call, plus one for an accessory). All pieces share one shader. Geometry is shared between pieces.
  - **Faces:** blinks (sometimes a double blink), eyes that follow `lookAt` and idle glances, 4 mouth shapes (neutral smile or smug smirk, open with tongue, O, frown), angry brows, blush cheeks. Sea animals have half-closed smug lids. Mouths snap onto the face surface automatically.
- **Every `PieceActor` method, in a different style per animal** (`styles.ts`, `actor.ts`):
  - `update`: breathing, tails, ears, trunk, tentacles, claws, fins, the lighthouse lamp and the elephant's flag. Each piece runs on its own random clock, so they never sync up.
  - `setSelected`: a hop, wide eyes, an open mouth, a lift with a gentle bob, and a rim glow. `setHovered`: a small perk-up and a softer rim glow.
  - `moveTo`, travel style per animal:

    | Animal | Travel style |
    |---|---|
    | Dachshund | trots with floppy ears |
    | Horse | one big knight leap |
    | Goat | a hop per square |
    | Elephant | stomps (fires a `stomp` event every step) |
    | Cat | prowls, then a little pounce |
    | Pug | royal waddle |
    | Crab | scuttles sideways |
    | Seahorse | floats on a bubble trail |
    | Pufferfish | balloon float |
    | Turtle | slides and paddles |
    | Octopus | swings tentacle over tentacle |
    | Blobfish | jiggle-hops |

    Each piece turns to face where it's going, then turns back. It squashes and stretches on landing. Every move takes 1.15s or less.
  - `attack`, per animal. Each one resolves at the moment of impact:

    | Animal | Attack |
    |---|---|
    | Dachshund | wiggles its bum, then pounces |
    | Horse | rears up and stamps |
    | Goat | backs up, then headbutts |
    | Elephant | trumpets, then squirts water |
    | Cat | paw bap |
    | Pug | royal belly flop |
    | Crab | claw pinch |
    | Seahorse | spins into a tail whip |
    | Pufferfish | inflates, then bonks |
    | Turtle | tucks in, spins, slides like a curling stone |
    | Octopus | tentacle slap with an ink splat |
    | Blobfish | belly flop |

    The attacker stops 0.75 of a square short of the victim. A whole capture (approach, strike, step onto the square) takes **1.45–1.9s** from any distance.
  - `defeat`: always slapstick. There are three kinds, picked by the attacker: **launched** (flies off spinning, with stars and a poof), **pancake** (squashed flat, dizzy, then pops away) and **dizzy** (spins around, tips over, poofs). Sea pieces poof into bubbles. The promise resolves once the piece is gone, and the piece is removed from its parent.
  - `celebrate`: per animal. Examples: the dachshund chases its tail, the cat does a backflip, the elephant makes a water fountain, the seahorse does a loop, the turtle spins its shell. Confetti for everyone.
  - `emote`: a speech bubble above the head (HA HA, an anger mark, a heart, !?, Zzz, nyah~) plus a body reaction. Land reactions are bouncier, Sea reactions floatier.
  - `lookAt`: the head and eyes turn to the point and hold for about 2.5s.
- **Skins** (`palettes.ts`, `accessories.ts`). `setSkin` swaps them live, and accessories pop on.
  - Land palettes: Meadow (natural), Porcelain, Candy, Gilded.
  - Sea palettes: Lagoon (natural), Abyss (neon accents), Coral, Pearl.
  - The team pedestal colours never change.
  - 6 accessories: party hat, sunglasses (sized to each animal's eyes), bow tie, flower crown, pirate hat, top hat.
  - `listSkins` and `displayName` are done.
- **Reduced motion:** shorter moves, no spins or flips, fewer particles, and stomp/impact events fire with intensity 0 (so no camera shake).
- **Quality:** `quality: 'low'` builds the animals with about 60% of the segments and drops the clearcoat layer. It looks almost the same, and on a full board the pieces cost about a fifth of what high costs.
- **Tests:** `src/cast/cast.test.ts` has 43 tests. They cover every animal building with a full face and hitting its height, kings and queens being the tallest, the skins, display names, moves under 1.2s landing exactly on target, captures under 2.1s with the victim removed, skip and dispose resolving promises, and reduced motion. `npm run typecheck` and `npm test` pass.

## How to run the demo
Start the `cast-demo` launch config (port 4413), then open http://localhost:4413/src/cast/demo.html
- All 12 animals sit on a slowly turning turntable. Tap a piece to pick it, and hover to see it perk up.
- There's a button for every animation: Select, Move 1, Move 2, L jump, Diagonal, Back home, Look at me, Celebrate, and all 6 emotes.
- **Fight:** pick any attacker and victim, or press "Every victim" to watch one attacker against all 6 on the other side.
- **Skins:** palette and accessory for each side.
- **Demo controls:** Skip, Turntable on or off, Reduced motion, Reset.
- The FPS and draw-call readout is at the top left. Add `?q=low` or `?q=high` to force a quality tier (phones default to low).
- At 390px the controls become a bottom sheet. It starts collapsed, and the view shifts up when you open it.
- Test hooks for headless checks, from the console: `__manual()`, then `__advance(seconds)`.

## Contract requests
1. **Event hook on `Cast`:** `on('stomp' | 'impact' | 'land' | 'poof', fn)`. The payload is `{ id, at: world Vector3, intensity 0..1 }`, and `impact` also carries `victimId`. Use it for camera shake (`world.shake`), `focusOn` and sounds. Today it's an extra on the object `createCast` returns.
2. **`PieceActor.skip()`** and **`Cast.skipAll()`**, for "every animation can be skipped by clicking". Both exist today as extras.
3. **`Cast.setReducedMotion(on)`**, driven by `Settings.reducedMotion`. It exists today as an extra.
4. **Warm-up:** `cast.preload(renderer, scene, camera)` compiles every animal and effect shader up front, so the first reveal doesn't hitch. `World` doesn't expose its renderer, scene or camera, so integration can't call it yet. One fix: `World` exposes `compile()` or its renderer. Another: the cast gives integration objects to add before the world's own `compileAsync`.
5. **Board facing:** I assumed rank 1 is at +Z. Land faces −Z (yaw π) and Sea faces +Z (yaw 0), which `createPiece` sets by default. If the world differs, integration sets `actor.object.rotation.y` after `createPiece`. Each piece reads its "home" yaw at its first action.
6. **Coordinates:** `moveTo` and `lookAt` take world-space points, such as `world.squareToWorld(sq)`. Add `actor.object` to `world.pieceLayer` before animating. The pieceLayer should be unscaled, because the actor sets `object.scale = squareSize` itself.
7. **Capture flow** for integration: `await attacker.attack(victim); victim.defeat(attacker); await attacker.moveTo(square);`. After `defeat` resolves, call `victim.dispose()`. `defeat` removes the piece from the board but doesn't free it.

## Open design questions for Johanes
1. **Defeat style is picked by the attacker.** The Horse, Goat, Dachshund, Elephant, Seahorse, Pufferfish and Turtle launch their victims. The Pug, Octopus and Blobfish make pancakes. The Cat and Crab make victims dizzy. Should it go by victim instead, or be random? The map is easy to change.
2. **Hats on kings and queens sit on top of the crown** (stacked, which looks funny). They could replace the crown instead, but the crown is how you spot the royals.
3. **Bishop identity.** The pufferfish wears a mitre. The goat has no mitre: it stands on a rock and wears a blue collar with a bell. Should the goat get a mitre too?
4. **Natural colours.** The crab is red-orange, the seahorse golden and the pufferfish pale yellow. I chose them so each reads clearly against the teal Sea pedestal.
5. **Emote bubbles** use short English text and symbols (HA HA, !?, Zzz, nyah~) in the system font. Keep the text, or go to symbols only?
6. **Palette and accessory names and colours** are first picks. The same 6 accessories are offered to both sides.
7. **Knight leap height** is 1.1 squares. Higher reads more as "jumping over pieces", but it's slower.

## Known issues
- **FPS isn't verified in a visible browser.** The app window wasn't on screen during this session, so the browser didn't animate on its own. I measured with the manual time-stepping hook, at 1024×768:
  - The CPU cost for 32 pieces is about 3.9 ms per frame.
  - Frame times with the graphics card included (a hidden page at 2× pixel ratio, so treat them as rough):
    - empty scene: about 9 ms
    - all 32 pieces, high tier: about 19 ms
    - all 32 pieces, high tier at 1× pixel ratio: 7.4 ms
    - all 32 pieces, low tier: 6.8 ms
  - Next step: check 60fps on a real laptop and a phone.
- The elephant's trunk covers most of its mouth, so its expressions come mainly from the eyes and brows.
- The seahorse reads thin from straight in front. It's best seen side-on or three-quarter.
- A launched victim flies about 3 squares and can leave the board before it poofs. That's fine on the diorama, but worth a look with the real camera.
- There's no sound in the cast. Audio can listen to the events in contract request 1.
- The demo shows emote bubbles for every emote, but the in-game emote UI is the ui stream's job.
