# server stream (Phase 5): report

The small online server for "play a friend by invite link". It's a Cloudflare Worker with one Durable Object "room" per match, on the free plan.

## What's done
- **Worker** (`src/index.ts`)
  - `POST /rooms`, `GET /rooms/:room` and the WebSocket at `/rooms/:room/ws`, as in `src/contracts/net.ts`.
  - CORS: any `http://localhost:*` or `127.0.0.1:*`, plus `ALLOWED_ORIGINS` (comma-separated). Other browser origins get 403.
  - Room codes are 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, so no 0/O, 1/I/L. Lowercase is accepted.
- **Room** (`src/room.ts`, the Durable Object plumbing)
  - SQLite storage: one `meta` row (options, seed, game number, both rejoin tokens, presence, timers, held throw, last activity) and one row per input.
  - Hibernating WebSockets, so an idle room costs nothing.
  - One alarm covers every timer.
  - Pings are answered by Cloudflare itself, without waking the room (not billed).
- **Room logic** (`src/logic/room.ts`): plain TypeScript, no Cloudflare imports, unit-tested in Node.
  - **Checks every input**: the sender must own `side`, it must be that side's turn or answer, and the room's own core must accept it. Inputs are cleaned first (unknown fields dropped, bad squares refused) so core never sees junk. A refused input gets `reject`; nothing is broadcast.
  - **Secret throws**: the first throw is held, never broadcast. When the second arrives, both go out together, attacker first. A held throw survives hibernation.
  - **Timers** (GAME_SPEC defaults):
    - 60 s per decision. It starts on the mover's `idle`, or 5 s after the last broadcast, whichever is first.
    - Time out in party modes: `endTurn`. Chess modes: a random legal move through core's `legalTargets`. Lucky 6: skip.
    - Duel answer or throw: 20 s, then "no duel" or a random hand. All are flagged `auto: 'timeout'`.
  - **Presence**: a dropped socket makes that player away. After a 2-minute grace they resign (`auto: 'left'`). `leave` resigns at once. Rejoining with the token restores the side and sends only the missing inputs.
  - **Rematch**: once both ask, a new game starts with sides swapped, a new seed and `game + 1`.
  - **Expiry**: the room deletes itself 24 hours after its last input.
  - **Abuse basics**: messages over 8 KB are dropped, more than 20 messages a second closes the socket, and a third player is refused.
- **Running core** (`src/logic/match.ts`)
  - It imports `MenagerieGame` (`src/core/controller.ts`) and `ArenaGame` (`src/core/arena/game.ts`) directly, never `src/core/index.ts`. Core bundles into the Worker as-is.
  - After hibernation, the room rebuilds core by replaying the stored inputs.
  - If core ever throws mid-input, the room rebuilds from storage rather than trust a half-changed state.
- **Tests** (`test/`, 33 room tests plus the determinism suite)
  - Joining, rejoining and catch-up; wrong-side, wrong-turn, illegal and junk inputs.
  - The throw hold; every timeout kind on a fake clock; away, grace and forfeit; leave; rematch swapping sides; hibernation; expiry.
- **Determinism**: per mode, 100 seeded games of random legal inputs, played through the room by two mirror clients.
  - The mix includes the room's own timeout moves, random hibernation wake-ups and the reads a screen makes (`legalTargets`, `targets`, `previewArea`…).
  - Both mirrors, the room's core, and a core rebuilt from the stored inputs agree on state and on every event.
  - **All 500 pass**, so core showed no hidden randomness.
- **Smoke** (`smoke.ts`): against `wrangler dev`.
  - It creates a Sumo room over HTTP, joins two sockets and checks a third is refused.
  - It plays to the end (duels included), checks both mirrors agree, and prints the result. Last run: 57 inputs, 2 duels, "sea wins by kingOverboard", SMOKE OK.

## How to run
- Server: the `online-server` launch config, or `npx wrangler dev --config server/wrangler.jsonc --port 8787`. No Cloudflare account needed locally.
- Tests: `npx vitest run server`. Typecheck: `npx tsc -p server`.
- Smoke, with the server running: `NODE_OPTIONS=--experimental-websocket npx vite-node server/smoke.ts`. Add `SMOKE_URL=http://localhost:8788` if the server got another port. The flag is needed on Node 20.

## How to deploy (once Johanes has a Cloudflare account)
The free plan is enough.
1. `npx wrangler login` opens the browser to sign in.
2. `npx wrangler deploy --config server/wrangler.jsonc` prints the Worker's URL, like `https://menagerie-chess-online.<your-subdomain>.workers.dev`.
3. When the site is on Pages, add its address to `ALLOWED_ORIGINS` in `server/wrangler.jsonc` (e.g. `"https://menagerie-chess.pages.dev"`), then deploy again.
4. Build the site with `VITE_ONLINE_URL=<the Worker URL>` so the game talks to it.
5. Check it: `SMOKE_URL=<the Worker URL> NODE_OPTIONS=--experimental-websocket npx vite-node server/smoke.ts`.
6. Live logs: `npx wrangler tail --config server/wrangler.jsonc`.

## Contract requests
- **Root scripts** (`package.json`):
  - `"server:dev": "wrangler dev --config server/wrangler.jsonc --port 8787"`
  - `"server:test": "vitest run server"`
  - `"server:typecheck": "tsc -p server"`
  - `"server:smoke": "NODE_OPTIONS=--experimental-websocket vite-node server/smoke.ts"`
  - `"server:deploy": "wrangler deploy --config server/wrangler.jsonc"`
- **Packages added** (root devDependencies, allowed by the brief): `wrangler@^4.86.0`, `@cloudflare/workers-types`.
- **Root `npm test` now also runs `server/`**: it goes from about 14 s to 35 s, mostly Classic determinism (chess.js is slow on long games) (see Known issues). If that's too slow, exclude `server/**` from the root vitest config and rely on `server:test`.
- **`net.ts`, small gaps the server fills its own way** (also in the shared notes file `p5-server.md` for net):
  - `timer.side` during throws: both sides throw, but `side` is a single side. The room sends the side that hasn't thrown, or the attacker when neither has. A `'both'` value might be clearer.
  - `join` has no game number. The room tracks which game each player was last sent, and sends `inputs` from 0 when the player's `have` belongs to an older game.
  - `emote` and `rematch` are sent to both players, the sender included (they carry `side`).

## Open design questions for Johanes
| Topic | Default I picked | Easy to change in |
|---|---|---|
| Turn timer in party modes | 60 s **per action** (it restarts after each action), not per whole turn | `armTimer` in `src/logic/room.ts` |
| Changing your throw | Allowed until the friend's throw is in (so a reload can't leave you stuck) | `onInput` |
| Leaving on purpose | Shows the friend the same "Your friend left" as a drop that ran out of time (`auto: 'left'`) | `onLeave` |
| Custom start position online | Not allowed (any `fen` is dropped) | `coreOptions` |
| Room life | 24 h after the last input, or after creation if nobody ever moved | `TIMING.expiryMs` |
| Free-plan budget | Each move writes about 2 rows. Free SQLite DOs allow 100,000 row writes a day: roughly 150+ full games a day | — |

## Known issues
- **Classic determinism games are capped at 150 inputs** (other modes 300). chess.js re-checks threefold repetition over the whole history on every move, so long Classic games get slow (quadratic), in tests and a little on the server too. Past the cap, one side resigns. Core may want to keep its own position count instead.
- **Phone testing over the LAN**: the server only allows `localhost` origins and `wrangler dev` listens on localhost only. Testing from a phone on the same Wi-Fi needs `--ip 0.0.0.0` plus the LAN origin in `ALLOWED_ORIGINS` (or a deploy).
- The installed wrangler (4.86) supports compatibility dates up to 2026-05-03, so `compatibility_date` is 2026-05-01.
- On first start in this session, port 8787 was busy for a moment and the launcher moved the server to 8788.
- Real hibernation (the room sleeping between messages on Cloudflare) is only tested through the logic's wake test, which rebuilds from storage. `wrangler dev` rarely hibernates, so the real thing shows only after a deploy.
- Known limit from the spec: anyone with dev tools can read the seed and predict dice and cards. Fine for friends.
