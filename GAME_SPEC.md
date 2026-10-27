# Game spec — working title "Menagerie Chess"

Status: Phase 2 (2026-10-27). The four streams are merged into `main` and wired into a playable game (`npm run dev`, or the `app` launch config on port 4410). The working title is still open; Johanes decides it.

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

## Rules
- Standard FIDE chess through chess.js: castling, en passant, promotion with a choice, check, mate, stalemate, threefold repetition, fifty-move rule, insufficient material.
- Bot: Stockfish WASM in a Web Worker, levels 1 to 8.
- Clocks: untimed, 3+2, 5+0, 10+0 or 15+10.
- FEN import and export.
- Undo: in local games, and against the bot (takes back the bot's reply too).
- **Weird Mode** (optional, off by default): every 4 to 6 turns, a random cosmetic event (tilt, fog, everything bounces, a pigeon visits, disco lights, a tide swap). It **never** changes chess legality.

## Feel targets
- 60fps on a mid-range laptop. 30fps or better on a recent phone, with a 'low' quality tier.
- No move takes longer than about 1.2s to animate. Captures may take about 2s. Every animation can be skipped by clicking.
- Easing everywhere (GSAP). Squash and stretch on landing. The camera eases and never snaps.
- Every action has a sound. The UI has hover and click sounds.
- Respects reduced motion: shorter moves and no shake.

## Screens
Title, game setup (opponent, bot level, time, Weird Mode, side), game (HUD with clocks, turn, move list, emote wheel, menu), customize (palette and accessory per side), settings, pause, result (with rematch).

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
3. Later: online play, campaign, achievements.
