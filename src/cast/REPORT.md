# Cast stream: report

The 12 animals and all their animations. Everything is built in code. No downloaded assets, and nothing from `steam-scrape/`.

# Phase 6: board-game modes (2026-10-28)

## What's done
New code is in `climb.ts` and `work.ts`, plus small hooks in `travels.ts`, `actor.ts`, `fx.ts` (`toss`) and `index.ts`.
- **`moveTo(target, { style: 'climb' })`**: a hop up onto a higher tier, or a drop down off one. `target.y` is the new height. Going up, it rises first, then moves over, so it clears the tier edge. Going down, it hops off the edge, falls faster and faster, lands with a squash and bounces once (a bigger drop lands harder and fires a stronger `land`). The same height is a plain hop. It arrives in 0.65–1.1s.
  - Pup: front paws up the ledge, back legs scrabbling. Horse: a neat bound, legs tucked. Elephant: front feet up first, then a heave and a stomp. Cat: crouch, butt wiggle, smooth pounce, soft landing. Pug: a determined heave and a wobble at the top.
  - Crab: scrambles up sideways, legs a blur. Seahorse: floats up on bubbles, tail curled. Turtle: hauls itself up with its front flippers, then flops forward. Octopus: front tentacles grab the ledge and pull it up. Blobfish: squish, gloop up tall, splat.
  - **Climbers, up 2 or more, with flair.** Goat: sizes up the ledge, deep crouch, a big spring with a twist, and a champion landing (head toss, sparkle). Pufferfish: puffs up like a balloon, floats up spinning, then lets the air out on top. Climbing 1, or dropping, they hop like everyone else.
- **`work(kind, target)`**: build pats sand onto the square, dig scoops it off. It resolves the moment the sand lands (build, 0.63–0.75s) or leaves (dig, 0.33–0.55s); the follow-through keeps playing, about 0.5s more. The animal faces the square, works, and turns back home. It leans toward a lower square and back from a higher one.
  - Pup: digs like mad with its front paws, dirt flying out behind. To build, it backs up to the square and kicks sand onto it. Horse: two hoof scrapes, then a forward flick (build), or a hoof drags sand off (dig). Goat: scoops with its horns and tosses it over, or gouges it out with a jab. Elephant: sucks up sand and sprays it on, or scoops a trunkful off and flings it over its head. Cat: two quick paw swats, or a litter-box rake. Pug: scoops with both paws and heaves, or scrabbles clumsily and sneezes.
  - Crab: pinches up two clawfuls and lobs them, or snips the sand away claw after claw. Seahorse: turns its back and flicks sand over with its tail, or swishes it off. Pufferfish: puffs up, then blows a jet that carries sand over, or blasts it off. Turtle: sweeps sand over with both front flippers, or scoops it away one flipper at a time. Octopus: two tentacles slap sandfuls on, or four reach out and yank sand away. Blobfish: hops and belly-flops: the splat throws a pile on, or splats it out.
  - **Water (Stepping Stones).** `work(kind, target, { water: true })` keeps the same gesture, but the sand lands in the sea with a splash and bubbles (raise), or the stone goes under with sand, a splash and bubbles (sink). See the contract request below.
- **Shover's push down tiers.** `pushed` now handles height: when the target is lower, the victim skids to the edge, falls, thumps down with a bounce, dust and a few stars. Pushed up 1, it gets bumped up and over. A flat push plays exactly as before.
- **Riding.** Integration can lower (or raise) an idle animal with a plain tween of `object.position.y`. Idle, hover, selection, emotes, `hit`, statuses and the carried treasure all live on the bones, so nothing fights the tween. The next move starts from the new height. Tested for all 12.
- **Skip and reduced motion.** `climb` and `work` resolve on `skip()` and on `dispose()`. Under reduced motion they are quicker and smaller (no spins or twists, a plain hop that still clears the edge), with `land` intensity 0 and fewer particles.
- **No first-play hitch.** `preload` now also draws its warm-up meshes once, off-screen. Before, the first water splash stalled about 100ms on a real GPU (pre-compiling shaders didn't cover it). Now the worst frame is about 5ms (headless Chrome, real GPU, all 12 climbing and working, drawing included). This also helps the older splash effects.
- **Existing animations are unchanged.** Old styles and gaits weren't touched. `toss` is a new effect. The only shared change is the preload warm-up draw.
- **Tests:** 29 new in `phase6.test.ts` (130 in the cast). For all 12: climb up 1, up 2 and down 2 clears the edge, lands on target and faces home; build and dig on sand and on water resolve on time and stay put. Also: Climbers bound higher, drops land harder, reduced motion, a ledge push for all 12, skip and dispose, and riding. `npm run typecheck` and `npm test` pass (391 tests).

## How to run the demo
Start `cast-demo` (port 4413), then open http://localhost:4413/src/cast/demo.html. Look under **Board games**. The buttons work on a copy of the picked animal in the middle row.
- **Up 1**, **Up 2**: climb onto the square in front, then drop back down. **Drop 2**: the square rises under the animal (riding up), it drops off, then climbs back. **Pushed off**: the animal pushes an enemy pup off a level-2 square, down to level 0 (any animal can push here; in the game only the cat and octopus do). **Ride down**: it rides a square down three levels on a plain y tween. **All 12 climb** (the Climbers go up 2).
- **Build**, **Dig**, **Build up high** (onto a level-2 square from the ground). **Raise stone** and **Sink stone** (with `water: true`). **All 12 work**. The log shows when the promise resolved; the stand-in tier or stone changes at that moment.
- **The sand blocks, blue squares and grey stones are stand-ins** for the world's tiers, sea and stones.
- Checked at 1280×800 and at 390×844, with real clicks at 390: no console errors, and about 1–2ms a frame (5ms at worst) in headless Chrome with a real GPU.

## Contract requests
1. **`PieceActor.work?(kind, target, opts?: { water?: boolean })`.** The cast already takes the optional `opts`. Stepping Stones should pass `water: true` for raise and sink. Without it, a raise shows a sand pat instead of a splash: it still works, but reads less clearly.

Notes for integration (no contract change):
- **Every `moveTo` target in castle needs the right height** (`world.squareTop`). The old travel styles move straight to `target.y`, so a target at level 0 would slide the animal down through the tier. Use `climb` whenever the height changes. For same-height steps, `climb` (a small hop) or the old styles both work.
- **Shover's push:** `await shover.attack(victim)`, then together `shover.moveTo(squareTop(own square))`, `victim.hit()` and `victim.moveTo(squareTop(dest), { style: 'pushed' })`. The pusher's return target must carry its own height too.
- **Riding:** tween `object.position.y` only while that animal isn't in its own `moveTo` or `work` (those write the position every frame). A dug-under enemy is idle, so this is the normal case.
- **`work` timing:** call `world.setLevels` (castle) or `setSunk` (stones) when `work` resolves. Target = `world.squareTop(square)` in castle. In stones, use the water surface to raise and the stone's top to sink.
- **Leaper and Zoomer:** a Leaper's knight hop that changes height can use `climb` (one longer hop). A Zoomer's 2 steps are two `climb` calls.
- The cast assumes about 0.28 of a square per level (`LEVEL` in `climb.ts`). It only uses this to count levels for timing and flair, so a different world height still works.

## Open design questions for Johanes
1. **Back to the square.** The pup builds by kicking sand backwards onto the square, and the seahorse flicks sand with its tail, so both turn their backs to work. Keep it, or have them face the square like the others?
2. **Sand colour.** All the work sand is sand-coloured, even on the meadow half. It could be brown dirt there to match packed-earth tiers, if the world uses them.
3. **How much flair.** The goat twists in mid-air and sparkles on landing; the pufferfish spins while puffed up. More, less, or about right?
4. **The pug sneezes** after it digs. Keep the joke?
5. **Reduced motion** climbs are a plain hop for everyone (no personality). Should some character stay?

## Known issues
- `climb` over a knight hop (2.2 squares) uses the same timing as a single step, so it's a quick, long hop. It still clears the edge.
- The demo doesn't queue actions: clicking a new button while one is running overlaps them (as before).
- I saw one failing test once in a full `npm test` run while other sessions were busy. It didn't come back in five more runs, and I didn't catch which test it was.
- The climb and work are tuned against stand-in tiers 0.88 squares wide. Check them against the world's real tiers at integration.

# Phase 4: party modes (2026-10-28)

## What's done
New code is in `party.ts`, with small hooks in `actor.ts`.
- **`fall(dir)`** (Sumo). The animal totters at the edge, tumbles one square toward `dir` and drops into the water. It fires the `splash` cast event once, as it hits the water line, then sinks with a few bubbles and leaves the board. It isn't freed, like `defeat`. It takes about 1.15s (octopus 1.4s).
  - Land panics: wide eyes, an "O" mouth, a windmill wobble, legs and paws flailing, ears flapping. Then it topples over its feet and somersaults in.
  - Sea is smug: half-closed eyes, a smirk, a lazy lean back. Then it does a neat head-first dive, like going home. The octopus waves goodbye with a tentacle first.
  - `splash.at` is just below the board top where it lands. Intensity is 1 for kings, 0.8 for rooks and 0.55 for the rest, or 0 under reduced motion.
- **`setCarrying(owner)`** (Raid). `'land'` gives the cream bone (`#f3e6c8`). `'sea'` gives the white pearl (`#f7f4ee`) in an open pink shell (`#f2a7b5`). These are the colours from the world brief.
  - Dogs, horse, goat and cat hold it in the mouth. The crab holds it up high in its right claw. The elephant swings its trunk up and holds it to the side. The octopus lifts it on a front tentacle. The turtle, pufferfish, seahorse and blobfish balance it on the head, with a gentle wobble.
  - It stays on through moves, emotes, skins and falls. While carrying, every move is 1.2× slower and the hops are lower, so it reads as heavy.
  - `actor.carrying` reads who's carried (not in the contract).
- **`setStatus('anchored')`** (Dig in). A lumpy ring of dirt (Land) or sand (Sea) heaps up round the feet, with dirt flying. The animal sinks a little and braces itself: legs out front and back, head down, brows set. The crab digs its claws into the sand and splays its legs. The pawns get the tallest ring, so they look half-buried. Clearing it throws dirt as it climbs out. Like the other statuses, it's one extra mesh.
- **Skip and reduced motion.** A fall resolves on `skip()`, still fires its splash and leaves the board. Under reduced motion, the fall is a small lean, a slide and a drop (0.7s, no spins, splash intensity 0). The carry and dig-in pops are shorter, and the balance wobble is smaller.
- **Existing animations are unchanged.** The only shared change is the heavier walk while carrying.
- **Anchored** stays on until integration calls `setStatus(null)`, at the start of the owner's next turn.
- **Tests:** 28 new (101 in the cast, all passing): a fall for all 12 animals, carrying both treasures for all 12, plus skip, reduced motion, the heavy walk and anchored. `npm run typecheck` passes.

## How to run the demo
Start `cast-demo` (port 4413), then open http://localhost:4413/src/cast/demo.html. Look under **Party modes**. The buttons work on a copy of the picked animal in the middle row.
- **Fall ↑ ↓ ← →** and **All 12 fall**. A blue square and a white ripple are **stand-ins** for the world's water and `world.splash`.
- **Dig in** toggles anchored. **Clear status** also clears it.
- **Carry bone**, **Carry pearl**, **Drop it**, **Walk with it** (one step; the log shows how long it took). **All 12 carry** lines everyone up holding the other side's treasure.
- Checked at 1280×800 and at 390×844: 60fps or more, no console errors. All 12 falls with treasures cost about 3ms a frame (6ms at worst), drawing included.

## Contract requests
None needed. Notes for integration:
- **Fall order** matches the clarified contract (b0547e8, cherry-picked here). `fall` starts from the centre of the pre-shove square, totters, travels one square toward `dir` and splashes there. The pusher's shove can play at the same time.
- Hook `world.splash(at, big)` and the sound to the cast `splash` event. Use `big` when intensity ≥ 0.9 (kings). Dispose the actor when `fall` resolves.
- Treasure handover: on `pickup`, call `carrier.setCarrying(owner)` and `world.setTreasures` in the same frame. On `drop`, `score` or `snatch`, call `setCarrying(null)`. The cast pops it in and out over 0.2–0.35s.

## Open design questions for Johanes
1. **Hold positions.** Mouth for the land animals (the cat too, which the brief didn't list), a raised claw for the crab, the trunk swung to one side so the face stays visible, a raised front tentacle for the octopus, and on the head for the other four. Want any of these changed?
2. **How heavy the carrier walks:** 1.2× slower with lower hops. Should it be heavier still?
3. **The dig-in ring is fairly big.** It is wider than the pedestal, so it reads at 390px. It could be smaller, or look like a hole instead.
4. **Only the octopus waves goodbye.** Should other Sea animals get a small wave too?

## Known issues
- The world's water level isn't known to the cast, so `splash.at.y` is just below the board top (0.1 of a square down).

# Phase 3: powers, travel styles, statuses (2026-10-27)

## What's done
- **`powerUp(power, target)`**: 12 flourishes, one per power per side (`powers.ts`). Each resolves, and emits the `power` cast event, at the moment of effect. All take effect in 0.55–0.85s.

  | Power | Land | Sea |
  |---|---|---|
  | Sidestep | Pup bows, sniffs, digs (dirt flies behind) | Crab clacks its claws, crouches |
  | Double jump | Horse rears, kicks, whinnies, slams down | Seahorse puffs a big bubble that pops |
  | Headbutt | Goat turns to the victim, lowers its horns, paws the ground | Pufferfish turns, inflates, fins buzzing |
  | Stomp | Elephant rears, trumpets, stomps; dust ring | Turtle tucks in, shell lifts and slams; splash ring |
  | Block | Cat turns, winds up, swats toward the square | Octopus turns, squirts an ink arc onto the square |
  | Escape | Pug crouches and spins up (zoomies) | Blobfish wobbles and goes gloopy |

  The `power` event's `at` is the target square for block and headbutt, otherwise the piece. The elephant also fires `stomp` (camera shake).
- **Every `MoveStyle` in `moveTo`** (`travels.ts`). All end exactly on target, in under 1.1s:
  - sidestep: the pup burrows under and pops up with a dirt trail; the crab scuttles across without turning.
  - jump: one knight hop (the horse's leap, the seahorse's float). Two in a row make a double jump.
  - slip: a banana peel appears under the feet, the piece slides with flailing limbs, the peel is left spinning, then fades.
  - pushed: tips over in the push direction, skids a square, rocks back upright, with stars.
  - teleport: Land pieces turn into a speed blur and dash (the pug spins up first). Sea pieces melt into a puddle, ooze over and reform. Use it for swaps too.
  - dig: burrows backward (dirt for Land, sand for Sea).
  - swept: rides a water hump, then a splash.
  - quake: stumbles sideways with arms flailing.
  - bonked: dizzy waddle back with circling stars, then turns to face forward.
  - step: one quick hop.
- **`setStatus`**: stunned shows 4 circling stars, droopy eyes and a sway. Frozen shows a clear ice block with frost, a frosty tint, and the idle stops dead. Each is one extra mesh (one draw call). Both hang on the pedestal, so they ride along with moves, survive skin changes, and stay until cleared. Clearing a freeze shatters the ice. `defeat` clears any status.
- **`hit()`**: a flinch, a big bonk star and a white flash, about 0.6s. It plays on top of whatever is running, so it never cuts a push or a wave.
- **`appear()`**: Land rises out of a dirt mound; Sea bubbles up out of a puddle. Resolves at 0.8s.
- **Skip and reduced motion**: everything new resolves on `skip()`/`skipAll()`. Under reduced motion the new actions run 1.3× faster, with no spins, smaller tilts, fewer particles, and `power`/`land` events at intensity 0.
- **Existing animations are unchanged.** `moveTo` with no style (or `'normal'`) is the Phase 1 move.
- **Tests**: 30 new (73 in the cast). They cover every flourish's timing and its single `power` event, every style for all 12 animals landing on target under 1.2s, a double jump, statuses (one mesh, survive moves and skins, frozen idle stops, clear), hit, appear, skip and reduced motion. `npm run typecheck` and `npm test` (139 tests) pass.

## How to run the demo
Start the `cast-demo` launch config (port 4413), then open http://localhost:4413/src/cast/demo.html
- **Powers and modes** section. These play on a copy of the picked animal in the empty middle row:
  - **Use power** plays the power the way the game will. For example, the goat headbutts a crab that gets pushed away, the elephant's stomp stuns two pawns, and the pug flourishes and then teleports.
  - Hit, Appear, Stunned, Frozen, Clear status.
  - The 10 travel styles. After each one, the piece walks back.
  - **Power showcase** plays all 12 in a row (about 55s). Press it again to stop.
- The gold ring is a **stand-in** marking the blocked square. The world draws the real vase or ink cloud.
- Checked in headless Chrome (real frame loop) at 1280×800 and 390×844: 60fps, no console errors, no sideways scroll at 390px.

## Contract requests
None needed. Notes for integration:
- Headbutt: `await bishop.powerUp('headbutt', victimPoint); await bishop.attack(victim);` then together `bishop.moveTo(home)`, `victim.hit()` and `victim.moveTo(dest, { style: 'pushed' })`.
- Banana slide: call `moveTo(slideSquare, { style: 'slip' })` after the normal move resolves. The peel appears where the slide starts.
- Swap: call `moveTo(..., { style: 'teleport' })` on both pieces at once.
- Escape and sidestep: `await powerUp(power, destPoint)`, then `moveTo(dest, { style })`.
- Stomp victims: `hit()` and `setStatus('stunned')` when the `power` event fires (or when `powerUp` resolves).
- Revive: add the object at its square, then `appear()`.
- Extra (not in the contract): `actor.statusKind` reads the current status.

## Open design questions for Johanes
1. **Teleport goes by side, not by animal.** Every Land piece dashes as a blur (the pug adds a spin). Every Sea piece melts into a puddle. This covers swaps and joker teleports too. Should each animal get its own?
2. **Pushed is a tip-and-skid, not a somersault.** A full roll would sink the animal into the board mid-roll.
3. **Stunned and frozen looks**: gold stars plus droopy eyes; a clear ice block plus a pale tint. Colours and sizes are easy to change.
4. **Crab dig** burrows backward into sand, like the pup's dig into dirt.
5. **Block flourish**: the cat and octopus turn back to face forward afterwards. Should they keep looking at the vase or ink until the turn ends?

## Known issues
- **Not seen in the real game yet**: the world's vase and ink cloud, the real camera, and integration's order of calls.
- Burrow and appear shrink the animal and sink it below the surface. On the real board the board top should hide it, but this isn't checked.
- Little effects (dirt, peel, splash, ice chips) aren't cut by skip; they finish on their own within about 1.4s, like the Phase 1 effects.
- An emote played during `hit()` resets the flinch (both use the emote layer).
- FPS isn't measured on a real phone. The demo had 78–99 draw calls with 12–15 animals and effects on screen.

---

## What's done (Phase 1)
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
- **Tests:** `src/cast/cast.test.ts` had 43 tests (73 now, with Phase 3). They cover every animal building with a full face and hitting its height, kings and queens being the tallest, the skins, display names, moves under 1.2s landing exactly on target, captures under 2.1s with the victim removed, skip and dispose resolving promises, and reduced motion. `npm run typecheck` and `npm test` pass.

## How to run the demo (Phase 1 parts)
Start the `cast-demo` launch config (port 4413), then open http://localhost:4413/src/cast/demo.html
- All 12 animals sit on a slowly turning turntable. Tap a piece to pick it, and hover to see it perk up.
- There's a button for every animation: Select, Move 1, Move 2, L jump, Diagonal, Back home, Look at me, Celebrate, and all 6 emotes.
- **Fight:** pick any attacker and victim, or press "Every victim" to watch one attacker against all 6 on the other side.
- **Skins:** palette and accessory for each side.
- **Demo controls:** Skip, Turntable on or off, Reduced motion, Reset.
- The FPS and draw-call readout is at the top left. Add `?q=low` or `?q=high` to force a quality tier (phones default to low).
- At 390px the controls become a bottom sheet. It starts collapsed, and the view shifts up when you open it.
- Test hooks for headless checks, from the console: `__manual()`, then `__advance(seconds)`.

## Contract requests (Phase 1)
All Phase 1 requests (events, `skip`/`skipAll`, `setReducedMotion`, `preload`, board facing) are now in the contracts.

## Open design questions for Johanes (Phase 1)
1. **Defeat style is picked by the attacker.** The Horse, Goat, Dachshund, Elephant, Seahorse, Pufferfish and Turtle launch their victims. The Pug, Octopus and Blobfish make pancakes. The Cat and Crab make victims dizzy. Should it go by victim instead, or be random? The map is easy to change.
2. **Hats on kings and queens sit on top of the crown** (stacked, which looks funny). They could replace the crown instead, but the crown is how you spot the royals.
3. **Bishop identity.** The pufferfish wears a mitre. The goat has no mitre: it stands on a rock and wears a blue collar with a bell. Should the goat get a mitre too?
4. **Natural colours.** The crab is red-orange, the seahorse golden and the pufferfish pale yellow. I chose them so each reads clearly against the teal Sea pedestal.
5. **Emote bubbles** use short English text and symbols (HA HA, !?, Zzz, nyah~) in the system font. Keep the text, or go to symbols only?
6. **Palette and accessory names and colours** are first picks. The same 6 accessories are offered to both sides.
7. **Knight leap height** is 1.1 squares. Higher reads more as "jumping over pieces", but it's slower.

## Known issues (Phase 1)
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
