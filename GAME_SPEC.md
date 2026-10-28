# Game spec — working title "Menagerie Chess"

Status: Phase 3 (2026-10-27): building the Normal and Crazy modes. Phase 2 is done: the four streams are merged into `main` and wired into a playable game (`npm run dev`, or the `app` launch config on port 4410). The working title is still open; Johanes decides it.

## Pitch
Real chess, played by a weird mix of animals. **Land** (dogs, horses, goats...) plays against **Sea** (crabs, seahorses, an octopus...).
Every move is in character, and every capture is a short slapstick moment. The board sits somewhere surreal and alive.
Inspired by Cat Chess on Steam. None of its art, video, names or text is used.

## Decisions so far (Johanes, 2026-10-25)
| Topic | Decision |
|---|---|
| Armies | Two factions: Land vs Sea |
| 3D art | All animals built in code (Three.js shapes and shaders). No downloaded models |
| Devices | Desktop browser first; also playable with touch on a phone (390px wide) |
| v1 scope | Offline only: local 2-player, vs bot, animations, emotes, skins, Weird Mode. Online play comes later |
| Stack | Vite, TypeScript, Three.js, GSAP, chess.js, Stockfish (WASM), Howler. No Unity |
| World | **A: Shoreline diorama** (picked 2026-10-25 over B Whale's back and C Giant's dinner table). B and C may come back later as unlockable arenas |

## Roster
| Piece | Land (moves first) | Sea |
|---|---|---|
| Pawn | Dachshund pup | Crab (scuttles sideways while moving forward) |
| Knight | Horse | Seahorse |
| Bishop | Mountain goat | Pufferfish |
| Rook | Elephant carrying a tower | Sea turtle with a lighthouse on its shell |
| Queen | Cat | Octopus |
| King | Pug in a crown | Blobfish |

Personality guide:
- Land is warm, bouncy and loyal.
- Sea is floaty, wobbly and smug.
- Pieces move in their own style: the horse gallops and leaps (a real knight jump), the seahorse bobs through the air on a bubble trail, the goat hops diagonally, the elephant stomps (the board shakes), the turtle slides, the octopus swings tentacle over tentacle, the pug waddles, and the blobfish jiggles.

## World: Shoreline diorama
The reference is the Phase 0 prototype in `prototypes/a-shoreline/` (run `npm run proto:build`, then serve `prototypes/dist`).
- **Setting:** a toy diorama on a wooden display base, at golden hour. A tilt-shift blur makes it feel like a miniature set.
- **The board straddles the shoreline.** Ranks 1 to 4 are meadow: cream and grass-green squares. Ranks 5 to 8 are beach: sand and aqua squares. It sits in a wooden frame.
- **Land side (behind rank 1):** meadow with grass tufts, flowers, lollipop trees, a picket fence and a dog house.
- **Sea side (behind rank 8):** sand, then an animated water pool with foam at the shoreline. Rocks, starfish, a beach umbrella and a sand castle.
- **Light:** a warm low sun and soft shadows. A blue-to-peach gradient sky and drifting clouds.
- **Pieces:** every animal stands on a round toy pedestal in its team colour. Land is cream with a gold rim. Sea is deep teal with an aqua rim. This keeps the sides readable whatever colour the animal is.
- **Ideas the world stream may add:** waves that react to Sea moves, birds, wind in the grass, and the sun moving slowly through the game.

## Rules (Classic mode)
- Standard FIDE chess through chess.js: castling, en passant, promotion with a choice, check, mate, stalemate, threefold repetition, fifty-move rule, insufficient material.
- Bot: Stockfish WASM in a Web Worker, levels 1 to 8.
- Clocks: untimed, 3+2, 5+0, 10+0 or 15+10.
- FEN import and export.
- Undo: in local games, and against the bot (takes back the bot's reply too).
- **Weird Mode** (optional, off by default, Classic and Normal only): every 4 to 6 turns, a random cosmetic event (tilt, fog, everything bounces, a pigeon visits, disco lights, a tide swap). It **never** changes chess legality. Crazy mode has the Wheel of Chaos instead, which does change the board.

## Game modes (decided by Johanes 2026-10-27)
The setup screen offers three modes. Words used below:
- A **turn** is one player's go (one ply).
- A **round** is a Land turn plus a Sea turn.
- **Neighbouring** means the 8 squares around a piece.

| Mode | In one line |
|---|---|
| **Classic** | Real chess, exactly as in "Rules (Classic mode)". Stockfish bot. |
| **Normal** | Chess plus one animal power per piece. Check and checkmate still apply. |
| **Crazy** | Powers plus luck: a fate die every turn, jankenpon duels, chaos cards and the Wheel of Chaos. You win by bonking (capturing) the king. |

Normal and Crazy use core's own rules engine and a custom bot (Stockfish can't play them). The bot levels 1–8 map to search depth and some randomness.

### Powers (Normal and Crazy)
- Every piece can use its power **once per game**.
- Using a power **is your whole turn**. A piece that uses its power doesn't also move.
- The same rule applies to both sides; only the animation differs.
- In Normal, a power may not leave your own king in check. In Crazy there is no such rule.
- A promoted or revived piece has a fresh power.

| Piece | Power | Rule | Land / Sea animation |
|---|---|---|---|
| Pawn | **Sidestep** | Move one square left or right, to an empty square. No capture. | Pup digs across / crab scuttles |
| Knight | **Double jump** | Two knight moves in one turn. The first must land on an empty square; the second may capture. | Horse leaps twice / seahorse bubbles twice |
| Bishop | **Headbutt** | Push a neighbouring enemy piece (the king too) one square straight away from the bishop. The square it's pushed to must be empty and on the board. The bishop stays put. | Goat rams / pufferfish bonks |
| Rook | **Stomp** | Every neighbouring enemy piece except the king is **stunned**: it can't move or use its power on its owner's next turn. Needs at least one enemy neighbour. | Elephant stomps / turtle slams its shell |
| Queen | **Block** | Pick any empty square. It's **blocked**: nothing can land on it or slide through it, and it blocks attacks like a wall. Knights can jump over it. It disappears at the start of your second turn after placing it, so your opponent must play around it twice. | Cat knocks over a vase / octopus inks it |
| King | **Escape** | Teleport to an empty square up to 2 squares away (pieces in between don't matter). In Normal it must be a safe square. It also uses up castling. | Pug zoomies / blobfish blorps |

Stunned and frozen pieces still guard squares and still give check; they just can't move.
In Normal, check, checkmate, stalemate and the draw rules work as in Classic. Powers count as moves: if you're in check, a power that gets you out of check is a legal answer. For threefold repetition, the used powers and the square effects count as part of the position.

**Fine print (both Normal and Crazy)**
- **"Empty" means unoccupied and not blocked.** This applies to every power, card, bonus and wheel effect.
- **A blocked square** also stops:
  - castling through it
  - en passant onto it
  - a pawn's double push through it
- **No effect may put a pawn on the first or last rank**, except a normal promotion. That rules out a headbutt push, a teleport, a swap or a dig.
- **Double jump:** it can't end on its starting square.
- **Escape:** it reaches any of the 24 squares within 2 steps, diagonals included.
- **Castling:**
  - A king or rook moved by anything other than castling loses castling for good. That covers a push, an escape, a teleport, a swap, tide and earthquake.
  - A revived king or rook can't castle.
  - In Crazy, castling ignores attacked squares.
- **Stunned and frozen pieces:**
  - They can't be used by their owner's powers, cards or bonuses.
  - Outside effects still move them: a push, tide or earthquake.
  - A piece holds only one status at a time; the longer one wins.
  - A stomp needs at least one enemy neighbour that isn't the king.
- **How long effects last.** A turn passed for having no legal action counts.
  - **Stuns and freezes** count down at the end of each of the owner's turns.
  - **A block** lasts 4 plies from when it's placed.
- **Fifty-move rule:**
  - These reset it:
    - any capture, the pigeon included
    - any pawn move by its owner, including sidestep, lucky step and dig
  - Wheel shifts don't reset it.

### Crazy mode
Everything in Normal, plus these rules.

**Winning.** You win by capturing the king. There is no check rule: you may leave your king in danger or walk into it. The HUD warns the side to move "King in danger!" when its king is attacked.
- **No legal action:** if a side has none, its turn passes. It still rolls the die and draws a card.
- **Draws:** only when just the two kings are left (reason `insufficient`), or under the fifty-move rule. There is no threefold repetition and no stalemate.

**Turn order.**
1. **Wheel of Chaos.** It spins at the start of Land's turn after every 5th round.
2. **Card draw.** If one is due, you draw a card.
3. **Fate die.** Roll the die. On a 6, you may take your lucky bonus first.
4. **Your action.** Do one of these:
   - move a piece
   - use a power
   - play a card
5. **Duel.** If your action captures, the defender may call a duel.
6. **Banana slide.** On a 1, the piece you moved slides one more square.

**Fate die (d6, rolled at the start of every turn, before you act, so you can plan around it).**

| Roll | Result |
|---|---|
| 1 | **Banana peel.** If this turn you move a piece normally, it slides one more square in the direction it travelled (a knight slides along its long leg). It only slides onto an empty, unblocked square on the board; otherwise it stays. The slide never captures. A pawn that slides onto the last rank becomes a queen. Castling and powers don't slide. |
| 2–5 | A normal turn. |
| 6 | **Lucky!** Before your action you may take one bonus, or skip it. The choices are: <ul><li>recharge one used power of one of your pieces</li><li>move one pawn one square forward onto an empty square (no capture, not onto the last rank)</li></ul> |

**Jankenpon duels (rock-paper-scissors).**
- When a move or a double jump would capture, the defender may call a duel if they have a duel token left. Each side has **3 tokens** per game, and calling a duel spends one whether you win or lose.
- Both sides pick rock, paper or scissors in secret.
  - Against the bot, the bot picks at random.
  - In a local game, the screen hides each pick ("pass the device").
- A tie is thrown again. After 3 ties in a row, the attacker wins.
- **If the defender wins,** the attacker is bonked back to its square. Nothing is captured, the attacker's turn is over, and a banana slide doesn't happen. A bonked double jump still counts as used, and the knight ends on its starting square.
- **No tokens left:** the duel offer doesn't appear.
- **If the attacker wins,** the capture goes ahead.
- The king may duel too, so a king capture can be saved.
- Clocks stop during a duel.

**Chaos cards.**
- Each side starts with 1 card.
- You draw a new card at the start of every 3rd turn of your own.
- You can hold up to 3. If your hand is full, the draw is skipped.
- Playing a card is your whole action for the turn.
- You can't play a card that would do nothing.
- Draw odds: ♥ 20%, ♦ 20%, ♣ 25%, ♠ 20%, 🃏 15%.

| Card | Effect |
|---|---|
| ♥ **Revive** | One of your captured animals (not the king) comes back on an empty square of your choice. A pawn comes back on your 2nd rank; any other piece on your back rank. It keeps its id, and its power is fresh. A promoted piece comes back as a pawn. |
| ♦ **Swap** | Two of your own pieces trade places. A pawn can't be swapped onto the first or last rank. Moving a king or rook this way uses up castling. |
| ♣ **Freeze** | One enemy piece (not the king) is frozen: it can't move or use its power on its owner's next 2 turns. |
| ♠ **Dig** | One of your pawns moves one square backward onto an empty square, but not onto your back rank. |
| 🃏 **Joker** | Always playable, even if its outcome then does nothing. A random wild effect, revealed when you play it. One of these four, equally likely:<ul><li>**Party:** all your used powers recharge.</li><li>**Teleport:** a random piece of yours (not the king) jumps to a random empty square in your own half.</li><li>**Butterfingers:** a random enemy piece (not the king) is frozen for 2 turns.</li><li>**Double:** draw two cards (up to the limit of 3).</li></ul> |

**Wheel of Chaos (at the start of Land's turn after every 5th round; each result equally likely).**

| Result | Effect |
|---|---|
| **Tide** | Land pieces standing on the beach (ranks 5–8) are swept back one rank toward rank 1. Pieces closest to the meadow move first. A piece only moves if the square behind it is empty and unblocked; otherwise it stays. |
| **Pigeon** | A pigeon steals one random pawn from the board, of either side. It counts as captured, so the owner can revive it with ♥. If there are no pawns, it flies past. |
| **Earthquake** | Every piece shifts one file left or right. The direction is random but the same for all pieces. A piece that would leave the board, or bump into a piece that can't move, or land on a blocked square, stays put. Pieces move from the leading edge first. Kings and rooks that move lose castling. |
| **Disco** | Every used power on both sides recharges. |

**Other Crazy rules**
- Weird Mode is off in Crazy; the wheel replaces it.
- There's no undo in Crazy, because luck is luck.
- En passant is only possible right after a normal double pawn push. A pawn that banana-slid can't be taken en passant.
- Clocks work as in Classic. A duel stops both clocks.

### Defaults in the mode rules (picked by the orchestrator, easy to change)
These fill gaps the approved draft didn't cover. Johanes may want to change any of them after playtesting:
- The king can't be stunned by a Stomp, and can't be frozen.
- A bishop's Headbutt can push the king.
- Tide only sweeps Land pieces. That favours Sea, so a fairer option is to also pull Sea pieces on the meadow back one rank.
- After 3 tied jankenpon throws, the attacker wins.
- Card odds, starting with 1 card, and drawing every 3rd own turn.
- The Wheel spins every 5 rounds, rather than every 5 turns.
- A pawn that banana-slides onto the last rank becomes a queen automatically.
- A promoted piece that is revived comes back as a pawn.
- If a bonked double jump fails, it still uses up the power.
- There is no undo in Crazy.

## Party modes: not chess (Johanes asked for these on 2026-10-28)
Two more modes use the same board, animals, powers, die and duels, but none of the chess rules.

| Mode | In one line |
|---|---|
| **Sumo** (Sinking Island) | Shove the enemy king into the sea while the island sinks ring by ring. |
| **Raid** (Treasure Raid) | Grab the other side's treasure, pass it and run it home. First to 5 points wins. |

Core runs both with its own engine (`ArenaController`) and a simple bot. The setup screen lists them next to the chess modes. Clocks, Weird Mode and FEN don't apply.

### What both modes share
- **The team.** Each side has 6 animals, one of each kind:
  - Land starts on rank 2: Horse b2, Goat c2, Cat d2, Pug e2, Elephant f2 and Pup g2.
  - Sea starts on rank 7, in the same files: Seahorse b7, Pufferfish c7, Octopus d7, Blobfish e7, Turtle f7 and Crab g7.
- **Action points (AP).** At the start of your turn you roll the die. The roll sets your AP for the turn: 1–2 gives 2 AP, 3–4 gives 3 AP, 5–6 gives 4 AP.
- **Spending AP.** Use AP on any of your animals, in any order, until you run out or press **End turn**. AP you don't use is lost.
- **Step (1 AP).** Move one square in any of the 8 directions onto an empty square. It can't be water or a blocked square.
- **Powers (2 AP, once per game per animal).** These are the same six powers and animations as Normal mode, with the rules adjusted for each mode (see below).
- **Duels.** Each side has **2 duel tokens**. Jankenpon works as in Crazy: the defender calls the duel, ties throw again, and after 3 ties the attacker wins. If the defender wins, the attack fails, but the attacker's AP is still spent.
- **Blocks** from the queen work as in Normal: nothing can step onto or be pushed onto a blocked square. A block lasts 4 plies.
- **Turns** in these modes means plies (one side's go); a **round** is one Land turn plus one Sea turn.

### Sumo (Sinking Island)
**Win:** the enemy king falls into the water.
- If your own king falls in on your turn, you lose.
- If both kings fall at the same moment, it's a draw.
- After round 15, the side with more animals left wins; if they're equal, it's a draw.

**Shove (2 AP; 3 AP when shoving a heavy king or rook).** Pick one of your animals and an enemy on a neighbouring square. The enemy moves one square straight away from your animal.
- If animals stand in the way, the whole line moves along, your own animals included.
- If the push would end on a blocked square, the shove can't be done.
- Any animal pushed onto water, or off the board, falls in and is out of the game.

**The island sinks.** The board has 4 rings, counted from the edge in.
- The outer ring sinks at the end of round 3, the next ring at the end of round 6, and the next at the end of round 9.
- The middle 2×2 always stays.
- The ring that's about to sink wobbles for the whole round before, as a warning.
- Animals still standing on a ring when it sinks fall in.

**Powers in Sumo**

| Animal | Power |
|---|---|
| Pawn | **Dig in.** It can't be pushed until your next turn. |
| Knight | **Double jump.** Two knight hops onto empty, dry squares. |
| Bishop | **Headbutt.** Shoves a neighbouring enemy 2 squares, heavy or not. |
| Rook | **Stomp.** Shoves every neighbouring enemy 1 square straight away. The farthest go first. |
| Queen | **Block.** Places a vase or ink wall on an empty dry square. It lasts 4 plies. |
| King | **Escape.** Teleports to an empty dry square up to 2 squares away. |

**Duel:** you can call one when a shove would make your animal fall in. Sinking can't be dueled.

### Raid (Treasure Raid): "quick raids" with "pass and run" (Johanes approved both, 2026-10-28)
**Win:** first to **5 points**. After round 12, whoever has more points wins; if they're equal, it's a draw.

**The halves and the treasures**
- **Halves.** Land's half is the meadow (ranks 1–4). Sea's half is the beach (ranks 5–8).
- **Treasures.** Land's bone lies at e3, Sea's pearl at d6: close to the middle, so raids are quick.
- **No guarding the treasure.** You can't stand on your own treasure's home square.
- **The enemy home is closed while its treasure is away.** You can only step onto it to grab the treasure.

**Stealing and scoring**
- **Grab (free): +1 point.** Step onto the enemy treasure at its home to pick it up. Picking up a dropped treasure scores nothing.
- **Carrying.** The carrier moves slowly: each step costs 2 AP, and it can't use its power.
- **Bring it home: +2 points.** Carry it into your own half. The treasure then goes back to its home square.
- **Pass and run (1 AP).** The carrier throws the treasure to a teammate in a straight line, up to 2 squares away.
  - The catcher becomes the carrier. If it stands in its own half, the +2 scores at once.
  - If an enemy stands on the square in between, it intercepts, and the treasure flies straight home.

**Tag (1 AP).** An animal standing in its own half can tag a neighbouring enemy that is also in that half.
- A tagged animal that isn't carrying is **stunned where it stands** for its next turn. A stunned animal can't be tagged again.
- A tagged **carrier** is sent home, to the nearest empty square on its own back rank, and drops the treasure where it was tagged. It can call a duel.

**Dropped treasure**
- An enemy can pick it up again (no grab point).
- If its owner's animal steps on it, the treasure flies straight home.

**Powers in Raid:** the same as Normal mode.

| Animal | Power |
|---|---|
| Pawn | **Sidestep.** One free step sideways. |
| Knight | **Double jump.** Two knight hops. |
| Bishop | **Headbutt.** Pushes a neighbouring enemy one square; a carrier drops the treasure. |
| Rook | **Stomp.** Neighbouring enemies are stunned for their owner's next turn. |
| Queen | **Block.** |
| King | **Escape.** Teleports up to 2 squares. |

**Wheel of Chaos (every 5 rounds)**

| Result | Effect |
|---|---|
| **Tide** | Every animal standing in the other side's half is swept back one rank toward home. |
| **Pigeon** | It grabs a carried or dropped treasure and drops it on a random empty square in its owner's half. If there's none to grab, it flies past. |
| **Earthquake** | Every animal shifts one file. |
| **Disco** | Every power recharges. |

All of these numbers are knobs in `src/core/arena/tuning.ts`. Bot-vs-bot playtests: every game is won by someone at about round 6, Land 60–65%.

### Fine print (party modes)
- **Both kings fall at once:** it's a draw, even on your own turn. If only your own king falls, you lose.
- **Shove chains**
  - If an anchored animal or a block is anywhere in the line, the shove is refused.
  - Only the animal you shove directly decides whether the cost is 3 AP.
  - Your own animals in the line can fall.
- **Shove duels**
  - You can call a duel only when one of your animals would fall into the water. You are the defender.
  - Powers can't be dueled. That covers headbutt and stomp.
- **Headbutt (Sumo)** is two 1-square shoves. If the second one isn't possible, it stops after the first.
- **Stomp (Sumo)**
  - Each neighbour is pushed straight away on its own line.
  - A line that's refused is skipped.
  - The king can be stomped.
- **Dig in** lasts until the start of your next turn.
- **Sinking**
  - "Island sinks in 1" means it sinks at the end of this round.
  - Sea always gets the last turn before a ring sinks. This is a fairness question for Johanes.
- **Turn ends by itself** when you have AP left but nothing you can afford.
- **Raid pawn power:** Sidestep costs no AP.
- **Raid stomp** needs at least one enemy neighbour. Kings can't be stunned.
- **No guarding (Raid)**
  - Nothing can put an animal on its own treasure's home square.
  - A push, tide, earthquake or escape that would do it leaves the animal where it is instead.
- **Sent home (Raid, a tagged carrier)**
  - The animal goes to the nearest free square on its back rank, by file. Ties go toward the centre.
  - If the back rank is full, it goes to the next rank in.
- **Picking up and scoring (Raid)**
  - **Picking up:** only the square where an animal finishes counts. The middle hop of a double jump doesn't.
  - **Scoring:** a carrier that ends up in its own half scores, however it got there, the tide included.
  - **Headbutted carrier:** it drops the treasure where it stood.
- **The pigeon (Raid)** drops the treasure on a random empty square in the treasure owner's half. It never uses a back rank or a home square.
- **The treasure flying home** is a hop out at the old square and a hop in at home, with a sparkle. There's no flight path.

### Defaults in the party modes (picked by the orchestrator, easy to change)
Johanes may want to change any of these after playtesting:
- Team size: 6 per side.
- AP from the die: 2, 3 or 4.
- Costs: a shove is 2 AP, or 3 AP against a heavy animal; a tag is 1 AP.
- When each Sumo ring sinks, and the round cap.
- Raid: 3 points to win, the carrier's slow steps, and the no-guarding rule.
- Duel tokens: 2.
- Raid has no chaos cards, to keep the first version lean.

## Online play (Johanes picked invite links on Cloudflare, free plan, 2026-10-28)
Play a friend over the internet by sharing a link. No accounts, no strangers, no chat (emotes only).

**How a match starts**
1. On the setup screen, pick a mode, **Friend online** as the opponent, and your side. Press Start.
2. An invite overlay shows the link, with Copy and Share. "Waiting for your friend…"
3. The friend opens the link: "Your friend invited you to Sumo. You play Sea." They press Join.
4. The game starts on both screens. Each player sees the board from their own side; the camera never swings.

**How it runs**
- A small server on Cloudflare (Workers + a Durable Object per room) runs the rules and checks every move. Both browsers run the same rules from the same seed and replay every move the server confirms. So animations look exactly like a local game.
- Duel throws stay secret until both are in.
- **Known limit:** a player with browser dev tools could predict dice and cards. That's fine for friends; it needs fixing before any public matchmaking.
- **Cost:** Cloudflare's free plan (Durable Objects with SQLite: 100,000 requests a day). If a limit is hit, new games fail with an error until the next day; nothing is billed. Pages hosts the website for free.

**Defaults (picked by the orchestrator, easy to change; Johanes to confirm)**
| Topic | Default |
|---|---|
| Modes online | All five. Classic has no clock online (the turn timer replaces it); Weird Mode is off. |
| Turn timer | 60s, starting once your screen has finished animating (at most 5s after the last move). The last 10s tick. |
| Time runs out | Party modes: your turn ends. Chess modes: a random legal move is played for you. Duel answer: no duel. Throw: a random hand. Lucky 6: skipped. |
| Friend drops | They have 2 minutes to come back, with a countdown on your screen. After that they resign. |
| Leaving on purpose | Going back to the title resigns the game. |
| Rematch | Both press Rematch; the new game swaps sides. |
| Sides | The creator picks; the friend gets the other. |
| Room life | A room is deleted 24 hours after its last move. |
| Names | "You" and "Friend" (no accounts). |

## Feel targets
- 60fps on a mid-range laptop. 30fps or better on a recent phone, with a 'low' quality tier.
- No move takes longer than about 1.2s to animate. Captures may take about 2s. Every animation can be skipped by clicking.
- Easing everywhere (GSAP). Squash and stretch on landing. The camera eases and never snaps.
- Every action has a sound. The UI has hover and click sounds.
- Respects reduced motion: shorter moves and no shake.

## Screens
Title, game setup (mode incl. the party modes, opponent, bot level, time, Weird Mode, side), game (HUD with clocks, turn, move list, emote wheel, menu), customize (palette and accessory per side), settings, pause, result (with rematch).

## Architecture
```
src/contracts/   shared types and factories (orchestrator only)
src/core/        core stream: rules, clocks, bot worker, Weird Mode scheduler, tests
src/world/       world stream: renderer, scene, shoreline diorama, camera, board, picking, highlights, post-processing
src/cast/        cast stream: the 12 animals, materials, skins, all piece animations
src/ui/          ui stream: DOM/CSS screens, HUD, emote wheel, promotion picker
src/audio/       ui stream: Howler/WebAudio engine, synthesized sounds (any downloaded sound needs Johanes's OK)
src/net/         net stream (Phase 5): the online client: room flow, WebSocket, mirror controllers
server/          server stream (Phase 5): Cloudflare Worker + Durable Object rooms that run core
src/app/         orchestrator: the Match (game flow, animation order, input) and the piece registry
src/main.ts      orchestrator: boots everything and hands it to the Match
prototypes/      Phase 0 world directions (throwaway)
```
Each stream works only in its own folder, builds a standalone demo page for itself (`src/<stream>/demo.html`), and codes against `src/contracts`.

## Defaults waiting on Johanes (picked by the streams, easy to change)
| Topic | Current default | Where |
|---|---|---|
| Clocks start | After Land's first move (like lichess) | core |
| Draws | Threefold and fifty-move end the game on their own (no "claim draw" button) | core |
| Bot levels 1–3 | Level 1 plays a random move 30% of the time; please play them | core |
| Stockfish licence | GPL-3.0: a public release must offer the game's source under GPL | core |
| Camera | 3/4 view from the right of your side; stays where you orbit it | world |
| Coordinates | On by default | world / ui |
| Highlight colours | Gold selected, red capture and check, orange last move, dark legal dots | world |
| Knockout style | Chosen by the attacker (launch, pancake or dizzy) | cast |
| Hats on royals | Sit on top of the crown | cast |
| Goat bishop | No mitre (rock, blue collar and bell) | cast |
| Emotes | Bubbles with short English text; HUD uses system emoji | cast / ui |
| Bot names | Sleepy Snail … Grandmaster Kraken | ui |
| Sounds | Synth sketches, balanced by numbers, not yet heard by Johanes | audio |
| Camera intro | Plays when the first game starts, not on page load | integration |
| Local 2-player | Camera swings to the side to move after every move | integration |
| Bot emotes | The bot answers your emote 40% of the time | integration |

## Phases
0. Setup, spec, contracts, 3 world prototypes, and Johanes picks one. Done 2026-10-25: picked A.
1. Four parallel sessions (core, world, cast, ui+audio), each on its own branch. The rules for them are in `CLAUDE.md`. Done 2026-10-27.
2. Merge, integrate, playtest, tune for phones, polish. Merged and integrated 2026-10-27; playtesting and tuning next.
3. Game modes (Normal and Crazy): four parallel sessions again, against the mode contracts (`docs/phase3-briefs.md`). Core's 2D demo is the first playtest. Started 2026-10-27.
4. Party modes (Sumo, Raid): four parallel sessions against the arena contracts (`docs/phase4-briefs.md`), on top of the `phase3` branch. Started 2026-10-28.
5. Online play with a friend by invite link: three parallel sessions (server, net, ui) against `src/contracts/net.ts` (`docs/phase5-briefs.md`), on the `phase3` branch. Started 2026-10-28.
6. Later: public matchmaking, campaign, achievements.
