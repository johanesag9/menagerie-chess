# Cast stream: report

The 12 animals and all their animations. Everything is built in code. No downloaded assets, and nothing from `steam-scrape/`.

# Animation polish (2026-10-28)

## What changed
- **All six powers, both sides, are re-animated** (`powers.ts`). Each one now has a wind-up, a clear key pose, a hit (freeze or squash), a follow-through and a touch of the animal's character:

  | Power | Land | Sea |
  |---|---|---|
  | Sidestep | Pup: play bow with the tail a blur, a sniff, then digs like mad with dirt flying behind | Crab: snip-snip with claws in a V, legs splay, leans away from where it is going |
  | Double jump | Horse: rears up tall pawing the air with a snort, drops into a crouch | Seahorse: coils its tail like a spring, blows a bubble, the pop launches it |
  | Headbutt | Goat: weight back, paws and kicks, rears up with horns tucked and **holds**; `attack()` then charges straight out of that pose | Pufferfish: sucks in, puffs up in two gulps, leans back trembling and holds; the charge flies like a let-go balloon |
  | Stomp | Elephant: crouch, rears up with trunk high and ears out, trumpets, slams. Freeze on the squash, shock ring, pebbles | Turtle: tucks into its shell, spins up, hangs, slams shell-first. Splash ring, droplets, pops back out dazed |
  | Block | Cat: low crouch with a bum wiggle, swat with a smear, sparkles on the square, smug paw-lick | Octopus: big breath with tentacles curling, ink arc onto the square while it jets back from the recoil |
  | Escape | Pug: paws scrabble on the spot kicking dust, spins up with whirl lines | Blobfish: wobbles harder and harder, sweats, sighs, melts |

  Dig in (Sumo) reuses sidestep: the pup and crab dig down instead of leaning off.
- **Supporting moves.**
  - `attack()`: an impact frame at the contact point, a short freeze (hit-stop), then the victim flinches. The freeze carries over: a `hit()`, `defeat()`, push or move started during it waits for it to end.
  - `hit()`: squash, tremble through the freeze, spring back, gold sparkles.
  - `pushed`: tips, flails, skids with speed lines and dust, overshoots and settles.
  - `jump`: a real arc with a crouch, peak sparkles and a squash landing. A second hop straight after a landing (double jump) skips the crouch, so the two hops chain.
  - `teleport` (Land dash) gets speed lines and a dust kick. `sidestep` for the crab and pawns scuttles with sand puffs. `bonked` sweats. `fall` (Sumo): Land sweats and kicks dust, Sea gives a smug eye twinkle.
- **Pooled effects** (`pool.ts`, `vfx.ts`). Dust, stars, drops, clods, sparkles, impact bursts, speed lines, shock rings, debris, steam and the ink arc are all code-built, one instanced mesh per kind (one draw call each, hidden when idle). The old one-mesh-per-puff dust, stars and clods now use the same pools. Their shaders are compiled in `preload`, so first use doesn't stall.
- **Two impact looks**, switchable with `cast.setLook('clean' | 'cartoon')` (also readable as `cast.look`). **A, clean**: a small white flash and sparkles, 0.045s freeze. **B, cartoon**: a jagged orange and gold comic burst with radial lines, 0.08s freeze. **B is the default for now, only until Johanes picks.**
- **Reduced motion**: no hit-stop, no spins or flips, lower jumps, fewer particles, and impact/stomp events at intensity 0, as before.
- **Tests**: the existing 101 cast tests all pass unchanged. `npm run typecheck` passes.

## Timings
Time to effect (when `powerUp` resolves) and time until the animal is fully settled, at 60fps. "Settled" includes the follow-through, which the next action cuts short anyway.

| Animal · power | Effect before | Effect now | Settled before | Settled now |
|---|---|---|---|---|
| Pup · sidestep | 0.73 | 0.67 | 1.23 | 1.17 |
| Horse · double jump | 0.67 | 0.58 | 1.17 | 1.08 |
| Goat · headbutt | 0.75 | 0.68 | 1.25 | 1.48 (held pose) |
| Elephant · stomp | 0.55 | 0.58 | 1.35 | 1.57 |
| Cat · block | 0.60 | 0.62 | 1.65 | 1.90 |
| Pug · escape | 0.70 | 0.70 | 1.20 | 1.20 |
| Crab · sidestep | 0.55 | 0.50 | 1.05 | 1.00 |
| Seahorse · double jump | 0.55 | 0.48 | 1.05 | 0.98 |
| Pufferfish · headbutt | 0.68 | 0.68 | 1.18 | 1.48 (held pose) |
| Turtle · stomp | 0.60 | 0.58 | 1.40 | 1.45 |
| Octopus · block | 0.85 | 0.75 | 1.75 | 1.70 |
| Blobfish · escape | 0.73 | 0.70 | 1.23 | 1.20 |

- Every power takes effect within 0.1s of before, all under 0.8s.
- **Longer:** the goat and pufferfish hold their wind-up for up to 0.45s so the charge can start from it (integration calls `attack()` right after, which cuts the hold). The elephant's ears and trunk settle 0.2s longer. The cat's paw-lick adds 0.25s.
- **Captures and headbutts** are 0.045s (A) or 0.08s (B) longer, from the freeze. The headbutt charge freezes 1.25× longer.
- **Double jump**: the second hop is about 0.15s shorter, since it skips the crouch.

## How to run the demo
- **Before/after page:** http://localhost:4408/ (launch configs `anim-before` on 4406, `anim-after` on 4407, `anim-compare` on 4408; the "before" copy and the compare page live in this session's scratchpad, not in the repo). Pick an animal and a move; three boxes loop it: Before, A clean, B cartoon. Front/Back, Reduced motion, and Show before toggle. Drag in a box to orbit.
- **Solo mode** in the cast demo, for one animal close up: `src/cast/demo.html?solo=land-r&act=power&look=clean&view=back&rm=1`. `act` can be power, attack, hit, pushed, jump, bonked, fall, digin, any travel style, or none (an empty stage).
- The normal cast demo (`cast-demo`, port 4413) still works as before.
- Checked at desktop size and at 390×844, with no console errors and no sideways scroll. A scripted run of all 12 animals × power, capture, defeat, every travel style, dig in and fall, in both looks: no failures, no leftover pieces, at most 83 draw calls (51 is the demo's idle baseline). No shader compiled on first use.

## Contract requests
None needed. Notes for integration:
- **Headbutt**: keep the order `await powerUp('headbutt', victimPoint); await attack(victim);`. The attack now charges out of the held wind-up. If anything else is called on the attacker in between, it just does a normal attack.
- **Camera shake**: hook it to the cast `impact` event (intensity 0–1) as well as `stomp`. Both fire on the frame of contact, when the freeze starts, so the camera shakes while the pieces hold still. That is the intended feel.
- **Hit-stop**: start `victim.hit()`, `victim.defeat()` and the pushed `moveTo` straight away, as now. They wait out the freeze by themselves.
- **Look**: call `cast.setLook(...)` once at start-up when Johanes has picked.

## Open design questions for Johanes
1. **A or B?** Clean (small flash, short freeze) or cartoon (comic burst, longer freeze). B is on for now only as a placeholder.
2. **Burst size** in B: about two-thirds of a square. Bigger reads better at 390px, but it starts hiding both animals.
3. **Rear-ups lift the pedestal** a little off the board (goat, horse, elephant) so the pose reads from the front camera. OK, or keep the base planted?
4. **Freeze length**: 0.045s (A) and 0.08s (B). Longer feels punchier but slows a capture.
5. **Held headbutt wind-up**: the goat and pufferfish hold the reared pose until the charge. Should the pose also hold if the player cancels?

## Known issues
- The B burst draws on top of everything (no depth test), so it can show through a piece in front of the hit.
- The compare page's three boxes aren't synced. Each loops on its own clock, so use Restart all to line them up.
- The before/after setup (servers 4406–4408, the old copy) is temporary and lives outside the repo. `.claude/launch.json` has three extra entries for it that are **not committed**.
- One 78ms spike on the first animal spawn showed up once in a scripted run. Spawning every animal and accessory again added no new shaders, so I couldn't reproduce it. Worth a recheck in the real game.
- Not seen in the real game yet: the real camera, the world's shake and integration's call order.

---

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
