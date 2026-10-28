# Board-game mode ideas (10 to pick from)

Status (2026-10-28): **Johanes picked two.** Stepping Stones (idea 2), and a new Santorini-spirited mode, **Sandcastle King** (move, then build or dig; hold a castle for a turn to win; each animal has a trait), which came out of the discussion after this list. Both are being built in Phase 6; the rules live in `GAME_SPEC.md` "Board-game modes". The other ideas stay here for later.

These are our own designs. They borrow the *feelings* of abstract board games (building up, walling off, territory, racing), not their rules.

**What all 10 share (defaults, easy to change)**
- 6 animals per side, one of each kind, like Sumo and Raid, unless the idea says otherwise.
- No die, cards or duels: everything is visible, like the genre. Luck could come back later as an optional "spice" switch.
- Powers: once per game, and using one is your whole turn (as in Normal). Each idea re-themes them.
- Online: the server runs the rules, as for the other modes. Nothing is secret, so online is simple. The 60s turn timer works for all.
- Land moves first. Where that is an edge, Sea gets a small catch-up rule.
- Size: **S** about a week of work across streams, **M** a normal phase, **L** a big phase.

## At a glance

| # | Mode | Feel | Size | Bot | Length |
|---|---|---|---|---|---|
| 1 | Shore Shift | territory, tug-of-war | M | easy to build, decent | ~10 min |
| 2 | Stepping Stones | racing, path building | M | medium, plays well | ~10 min |
| 3 | High Tide | walling off (Land vs Sea differ) | M | medium, two bots | 2 × 10 min |
| 4 | Paw Prints | territory, painting | S | easy, good | ~10 min |
| 5 | Slick Sand | racing, sliding | S | easy (too sharp unless tuned) | ~6 min |
| 6 | Hedge & Reef | walling off, territory | M | medium-hard, weaker than people | 15–20 min |
| 7 | Beacon Builders | building up, racing | M | medium | ~12 min |
| 8 | Seesaw Shore | balance, weight | M | easy | ~10 min |
| 9 | Sand Shapes | patterns, racing | S | easy, medium strength | ~8 min |
| 10 | Lantern Night | territory, light | L | easy to build, medium | ~12 min |

---

## 1. Shore Shift
**The shoreline is the scoreboard. Grow grass onto the beach, or wash sand over the meadow, one square at a time.**

- **Win:** own 40 of the 64 squares. After round 15, whoever owns more wins; equal is a draw.
- **A turn:**
  1. Move one animal 1 step (2 steps if it starts on your own terrain), or use a power.
  2. Flip one enemy square that touches your terrain, if more of your animals than theirs stand around it. Grass sprouts over the sand, or a wave washes sand over the grass.
- **Land vs Sea:** each side is quicker on home ground, so pushing into enemy turf is slow and needs backup. Stomp flips every flippable square around the rook. Block (vase or ink) keeps a square from flipping for 4 plies. Headbutt shoves a defender off a contested square. Double jump and Escape reach a weak spot fast. Sidestep plugs a gap.
- **To build (M):** rules S (a neighbour count). 3D: a per-square terrain flip (grass grows, sand drifts, the tile re-tints). UI: a 64-square tug meter.
- **Bot:** easy to build and decent: greedy flips plus a 2-ply look-ahead.
- **Fun:** you see who's winning just by looking at the board, and the border moves every turn.
- **Risk:** a stable front line can stall. Fix with the round cap, or make squares next to the water count double.

## 2. Stepping Stones
**The middle of the board is sea. Raise stones to make your path, sink theirs, and be first across.**

- **Setup:** ranks 3–6 start under water. Land on rank 2, Sea on rank 7.
- **Win:** the first animal to stand on the enemy's back rank.
- **A turn:**
  1. Shape the sea: raise one sunk square that touches dry land, or sink one empty stone in the middle four ranks. A square you sink keeps bubbling: it can't be raised again until the next round.
  2. Move one animal 1 step onto dry land.
- **Land vs Sea:** same rules both sides; the race is the fight. Double jump crosses water. Escape teleports over it. Headbutt pushes an enemy into the water: it's swept back to its back rank. Stomp sinks every empty stone around the rook. Block puts a vase or ink on a stone: nobody can sink it or step on it for 4 plies. Sidestep is a free sideways step.
- **To build (M):** rules M. 3D: sinking tiles already exist (`setSunk`); add the reverse, a stone rising out of the water with a splash. UI: an optional "shortest path" hint for each side.
- **Bot:** "my path length minus theirs" is a classic, strong measure, so the bot plays well at medium effort.
- **Fun:** every turn is "build mine or wreck theirs", and tiles rising and sinking is pure diorama.
- **Risk:** raising and sinking can cancel out and stall (the bubbling rule is there for that). Land's first move may be an edge.

## 3. High Tide
**The tide is coming in. Sea steers the water toward the dog house; Land piles sandbags to keep it dry.**

- **Setup:** dry board, the sea behind rank 8. Land on rank 2, Sea on rank 7. The dog house is at e1.
- **Win:** Sea wins if water reaches the dog house by the end of round 12. Land wins if it's still dry. Play two legs, swapping sides; at 1–1, the faster flood wins.
- **A turn:**
  - **Land:** move one animal up to 2 steps, then drop 2 sandbags on empty squares next to your animals (16 in the sack).
  - **Sea:** move one animal up to 2 steps (Sea animals swim through water), then flood 2 empty squares touching the water, or wash away 1 sandbag next to one of your animals.
  - Every 4th round a big wave floods 4 instead of 2.
- **Land vs Sea:** the sides play differently: Land builds walls, Sea digs and swims. Animals are walls too: water can't flood a square an animal stands on. Stomp is the big one: the elephant packs nearby sandbags so they can't be washed away; the turtle's shell-slam washes them all away. Block stops water too, for 4 plies. The other powers move animals as usual.
- **To build (M):** rules M (flooding, plus two rule sets). 3D: water creeping over tiles (`setSunk`), a sandbag prop, a wash-away splash. UI: sandbag count, "big wave in N", the two-leg score.
- **Bot:** two bots, one per side, with a flood look-ahead: medium.
- **Fun:** tower-defence tension and the most Land-vs-Sea idea of all; water visibly creeping in looks great in 3D.
- **Risk:** balancing two unequal sides takes playtesting. Two legs make a match about 20 minutes.

## 4. Paw Prints
**Every animal leaves tracks. Paint the biggest connected patch of the board.**

- **Win:** when neither side can move, or after round 16, the side with the biggest connected patch of prints wins. Tie: most prints overall.
- **A turn:**
  1. Move one animal with its real chess move (horse L, goat diagonal, elephant straight, cat any line, pug and pup 1 step any way). No captures.
  2. Every square it crossed or landed on gets your prints (paws in the grass, a wet trail on the sand). Nobody can cross or land on enemy prints.
- **Land vs Sea:** mirrored moves on both sides; Sea gets +2 at the end for moving second. Stomp prints all 8 squares around the rook. Block (vase or ink) cuts a patch in two. Headbutt shoves an enemy off a key square. Escape and Double jump hop over prints. Sidestep slips through a gap.
- **To build (S):** rules S (chess moves without captures, plus a flood fill). 3D: print decals per square, cheap. UI: live patch counters.
- **Bot:** easy to build and good: grow the biggest region, 2-ply look-ahead.
- **Fun:** chess know-how used in a brand-new way; the long movers paint stripes that cut the board in half.
- **Risk:** cat and octopus may be too strong (a whole line in one move). First-move edge.

## 5. Slick Sand
**The beach is wet. Animals slide until they bump into something. Park your king on the enemy's nest.**

- **Setup:** Land's target nest is d8 (Sea's shell); Sea's target nest is e1 (the dog house). Each side has 4 rocks.
- **Win:** your king stops on the enemy's nest.
- **A turn (do one):**
  - Slide one animal straight in one of 4 directions. On sand it slides until it bumps an animal, a rock or the edge. On grass it stops after 2 squares (grass grips).
  - Or place one of your rocks on any empty square. It stays all game.
- **Land vs Sea:** the board makes it lopsided in a fun way: Land must cross the slippery beach, Sea must trudge through grippy grass. Your other animals are bumpers: park them so your king stops where you want. Block is a temporary bumper. Headbutt sends an enemy sliding. Stomp stops nearby animals sliding next turn. Escape, Double jump and Sidestep move without sliding.
- **To build (S):** rules S. 3D: reuse the `slip` move style from the banana peel, plus a rock prop. UI: 4 arrows around the selected animal.
- **Bot:** a search finds slide paths easily, so it's easy to build; low levels need randomness or it's too sharp.
- **Fun:** bank shots and big slapstick slides; quick games; great on phones.
- **Risk:** may feel like a solo puzzle, and the first player might find a forced win. Test the setup.

## 6. Hedge & Reef
**Grow hedges and coral reefs to fence off as much of the shore as you can.**

- **Win:** when no region holds animals of both sides, each side scores the empty squares in regions only its animals can reach. Most wins.
- **A turn:**
  1. Move one animal up to 2 steps (walls block).
  2. Grow one wall square next to one of your animals or your own walls. In your own half, you may grow a second one.
- **Land vs Sea:** Land grows hedges, Sea grows coral. Both grow faster at home, so the middle is the fight. Double jump hops a wall. Escape lands inside a pen before it closes. Headbutt shoves an enemy out of a pen. Stomp grows 3 walls at once around the rook. Block is a temporary wall. Sidestep slips through.
- **To build (M):** rules M (regions and the end check). 3D: hedge and coral pillars rising out of the board, region tint. UI: region scores.
- **Bot:** medium-hard to make strong; territory is tricky for bots, so it will be weaker than a good player.
- **Fun:** closing a pen around a big empty area is very satisfying; the board ends as a little garden maze.
- **Risk:** slow and brainy (15–20 minutes). The end scoring must be very clear.

## 7. Beacon Builders
**Each side stacks a lighthouse from driftwood. First to light the top wins.**

- **Setup:** tower bases on the back ranks (Land e1, Sea d8). 8 driftwood crates lie on ranks 4–5.
- **Win:** the first tower to 5 levels lights up.
- **A turn:**
  1. Move one animal up to 2 steps. Stepping onto a crate picks it up; a carrier moves only 1 step.
  2. A carrier next to your tower adds its crate: the tower grows a level.
  - When a crate is used, the tide washes a new one onto the empty shoreline square nearest the middle.
- **Land vs Sea:** elephant and turtle carry 2 crates. Headbutt next to the enemy tower knocks its top crate off; it lands 2 squares away. Stomp makes nearby carriers drop their crates. Block shuts a path. Double jump and Escape make quick runs.
- **To build (M):** rules M. 3D: a tower that grows a level at a time and lights at the top, a crate prop, carrying (like Raid's treasure). UI: tower heights.
- **Bot:** medium (path finding plus a race).
- **Fun:** towers rising at both ends is a clear visual race; knock-downs are big moments.
- **Risk:** close to Raid (fetch and carry). It could feel like Raid with crates.

## 8. Seesaw Shore
**The board balances on a log along the shoreline. Pile weight on their side to tip it into the sea.**

- **Weights:** pup and crab 1; horse, seahorse, goat, pufferfish, pug and blobfish 2; cat and octopus 3; elephant and turtle 4. Pull = weight × distance from the shoreline.
- **Win:** the first side whose half dips 3 times loses. Each dip floods that side's outermost dry rank, and animals on it fall in.
- **A turn:**
  1. Move one animal 1 step, or use a power. The board tilts live.
  2. At the end of each round, if the tilt is past the line, the low side dips.
- **Land vs Sea:** the heavies decide everything. Your animals in the enemy half push it down, but they fall in too when it floods: risk against reward. Enemies deep in their own half also weigh their side down, so Headbutt (push them back toward their edge) is strong. Stomp makes the rook count double for a round. A Block vase weighs 2.
- **To build (M):** rules S. 3D: the whole board tilting on a log (the Weird Mode tilt, made to follow the game), ranks flooding (`setSunk`). UI: a tilt gauge.
- **Bot:** easy (the pull is simple maths).
- **Fun:** physical, new and readable; every step visibly tips the board.
- **Risk:** once one side dips it may snowball. A tilting board may make tapping harder on phones (keep the tilt small).

## 9. Sand Shapes
**Three shape cards lie face up. Arrange 4 of your animals into one of them to claim it. First to 3 wins.**

- **Win:** claim 3 shapes.
- **A turn:**
  1. Move one animal 1 step, or use a power.
  2. If 4 of your animals now form a face-up shape (turned or mirrored is fine), claim it. The shape is drawn in the sand and a new card turns over.
  - The deck has 12 shapes (line, square, L, T, S, diagonal…), shuffled from the game seed. Both players see the same 3.
- **Land vs Sea:** same rules; the fight is blocking: stand on the square they need. Headbutt breaks a nearly finished shape. Escape and Double jump snap the last animal in. Block fills the key square. Stomp stuns blockers. Sidestep nudges into place.
- **To build (S):** rules S (shape matching). 3D: the outline drawn in the sand with a glow. UI: the card row.
- **Bot:** easy to build, medium strength.
- **Fun:** quick and easy to learn; lots of "they're one step away!" moments.
- **Risk:** the card order adds luck, and it may feel more like a race than a fight.

## 10. Lantern Night
**Night falls on the shore. Lanterns light straight lines until something blocks them. Light the most squares.**

- **Win:** at the end of every round, score 1 point for every square lit only by your lanterns. First to 60.
- **A turn (do one):**
  - Place a lantern (you have 4) on an empty square.
  - Move one of your lanterns 1 step.
  - Move one animal 1 step, or use a power.
  - Light goes out in 4 straight lines and stops at any animal, lantern or block. Squares lit by both sides score for nobody.
- **Land vs Sea:** animals are shadows: park them in enemy beams to cut the light. Stomp blows out neighbouring enemy lanterns for 2 plies. Block (vase or ink) casts a shadow. Headbutt pushes an animal into a beam. Escape and Double jump get a shadow-caster into place fast.
- **To build (L):** rules S. 3D: a night version of the diorama (moonlight, glow), lantern props, beams as glowing strips (not real lights, for phones). UI: a points race.
- **Bot:** easy to build, medium strength (count lit squares, 2-ply look-ahead).
- **Fun:** the prettiest one: warm and cool light fighting across the board, and it's clear who holds what.
- **Risk:** the night look is a big new world job, and scoring every round needs a quick, clear tally.

---

## My top 3 (you decide)
1. **Stepping Stones.** Best reuse: sinking tiles already exist, so it mostly needs "rise" as well. Simple rules, a strong bot from a simple measure, short games. It feels the most like a real abstract board game.
2. **Shore Shift.** The most on-theme: Land and Sea fight over the shoreline itself, and the board shows the score. Animals and powers work as they are.
3. **High Tide.** The most dramatic and story-like: water creeping toward the dog house. It's a bigger balance job (the two sides play differently), so it may suit a second release.

If you want the cheapest one first: **Paw Prints** or **Slick Sand** (both S).

Next step once you pick: a 2D playtest in core's demo first (like Phases 3 and 4), then the 3D build.
