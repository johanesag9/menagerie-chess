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

## Feel targets
- 60fps on a mid-range laptop. 30fps or better on a recent phone, with a 'low' quality tier.
- No move takes longer than about 1.2s to animate. Captures may take about 2s. Every animation can be skipped by clicking.
- Easing everywhere (GSAP). Squash and stretch on landing. The camera eases and never snaps.
- Every action has a sound. The UI has hover and click sounds.
- Respects reduced motion: shorter moves and no shake.

## Screens
Title, game setup (mode, opponent, bot level, time, Weird Mode, side), game (HUD with clocks, turn, move list, emote wheel, menu), customize (palette and accessory per side), settings, pause, result (with rematch).

## Architecture
```
src/contracts/   shared types and factories (orchestrator only)
src/core/        core stream: rules, clocks, bot worker, Weird Mode scheduler, tests
src/world/       world stream: renderer, scene, shoreline diorama, camera, board, picking, highlights, post-processing
src/cast/        cast stream: the 12 animals, materials, skins, all piece animations
src/ui/          ui stream: DOM/CSS screens, HUD, emote wheel, promotion picker
src/audio/       ui stream: Howler/WebAudio engine, synthesized sounds (any downloaded sound needs Johanes's OK)
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
4. Later: online play, campaign, achievements.
