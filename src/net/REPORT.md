# net stream: Phase 5 report (online play with a friend)

Branch `claude/p5-net-e0d74f`. Owns `src/net/` only. No new packages.

## What's done
- **`createOnline(opts?)`** (`index.ts`): the `OnlineClient` from `src/contracts/net.ts`.
  - `createRoom`, `roomInfo` (null on 404), `join` (resolves on `welcome`, rejects on a room error or an unreachable server).
  - One WebSocket with auto-reconnect: backoff 1s, 2s, 4s, 8s, then 15s. `connection` events: connecting, online, reconnecting.
    After 2.5 min without getting back in it says `offline` but keeps trying. It pings every 20s, and 10s of silence after a ping counts as a dead socket.
  - Base URL: `opts.base`, else `VITE_ONLINE_URL`, else `http://<this host>:8787`. Using this host rather than localhost lets a phone on the same Wi-Fi reach `wrangler dev`.
  - Rejoin token in `localStorage` under `mc.online.<room>`, all wrapped in try/catch. `leave()` forgets it. An error before `welcome` (full, expired) also forgets it and stops retrying.
  - It stops for good on the server's "don't come back" close codes: 4001 opened somewhere else (keeps the token), 4003 bad token, 4004 full, 4005 left, 4010 expired. It emits `error` with a plain reason.
    4008 (too many messages) and plain network drops keep retrying.
  - An expired room is refused at connect time with no message. So when a reconnect never opens, the client asks `roomInfo`. If the room is gone it stops ("This game has ended") and forgets the token; on a network failure it keeps trying.
    A dead invite link makes `join` reject with "This invite has expired".
- **Mirror** (`client.ts`, `match.ts`): a fresh core per `start` with `createGame()` / `createArena()` from `src/core/index.ts`. Inputs apply in order and are counted. Duplicates are dropped.
  A gap, or an input the mirror refuses (out of step), rebuilds the mirror and rejoins with `have: 0`.
- **Proxies** (`proxies.ts`): stable `game` and `arena` objects with the exact local interfaces.
  - Reads come from the mirror (idle placeholders before the first game).
  - `act`, `move`, `answerDuel`, `throwHand` and `resign` send an input instead. Inputs that aren't yours are refused locally with `Not your turn`. Illegal moves are refused with `Illegal move`.
  - `move()` sends and returns null; the result arrives as `moved`. `resign()` always resigns you. `sendEmote` only sends your own.
  - Interactive reads only offer your pieces on your turn: `legalTargets`, `powerInfo`, `canPlayCard`, `targets`, `pieceOptions`. The friend's moves never light up.
  - `resume()` sends `idle` once per (game, count). `newGame`, `undo`, `pause` and `dispose` do nothing.
  - Listeners live on the proxy, so they survive new games and rematches.
- **Catch-up**: after `welcome`, the room replays the game. Mirror events are muted until the first message that isn't `start`/`inputs` (or 400 ms). Then it emits `started` (if the game is new to this screen) and `resync`. `resync.over` carries the result when the game had already ended (its `gameOver` was muted), else null.
  A brand-new game with no inputs yet is rebuilt with its events instead, so it starts like any game (`gameStarted`, etc.).
- **Other events**:
  - `presence` (with `graceEndsAt` as local time) and `timer` (`msLeft` → local `endsAt`).
  - `emote`. Chess modes also get it as the game proxy's own `emote`, as in a local game.
  - `rematch`; `auto`, just before the input applies (muted during catch-up); `rejected`; `error`.
  - After a rematch, `you` comes from the room's `start.options.opponent.you`, so the side swap is picked up.
- **Fake server** (`fakeServer.ts`): the protocol in-page, for the demo and tests. Each room runs its own core and does the same checks (side, turn, legality via core).
  - It holds the first throw until the second arrives (both go out together, attacker first).
  - Turn timer 60s, started by the mover's `idle` or 5s after a broadcast. Duel answer and throws 20s. Away grace 2 min, then `resign` with `auto: 'left'`.
  - Rematch with sides swapped and a new seed. Room codes have 6 characters with no look-alikes.
  - It matches the real server's details: `POST /rooms` returns 201, the same close codes, an unknown room refused before the socket opens, and a re-throw replacing your held hand.
  - Test hooks: `timeScale`, `forceTimeout(room)`, `expire(room)`, droppable transports (`ControlledTransport`), and logs of everything sent and received.
- **Board games online (Phase 6: castle, stones)**:
  - `ARENA_EVENT_SET` has `tide` and `crowned` (checked: the compiler requires every key of `ArenaEventMap`).
  - The arena proxy has `shapeOptions()`: the mirror's options on your stage, else `[]`. `pieceOptions` is masked as before; in castle the trait info stays, since traits are always on.
  - The `'draft'` phase is the turn of `state.turn`, so a `pick` is only yours on your pick.
  - The fake server plays both, with the board-game timer rule: one 60s timer for the whole turn, not restarted between stages.
    On timeout it plays a random legal action for each stage left until the turn passes: a random unpicked animal in the draft, a random step or hit, a random shape square and direction, and `endTurn` for 'more'.
  - The demo offers Sandcastle King and Stepping Stones: pick buttons in the draft, Build/Dig (Raise/Sink) toggles, levels (▲1, ▲2, 🏰), the crown 👑 and fresh squares.
- **Tests** (`net.test.ts`, 35 cases, vitest). Board games: draft reads, sends and turn checks; `shapeOptions` masked; a draft rejoin resyncs; the draft timeout; the stones whole-turn timer and timeout; the castle timeout (move, then build/dig).
  Earlier cases: rooms (create, link, info, full room); reads come from the mirror; actions send and don't apply; local refusals; room rejects; party modes.
  Also: inputs in order and duplicates ignored, plus gap recovery; `auto` before apply; secret throws (nothing leaks, attacker first); duel answer and throw timeouts.
  Also: dead link, opened somewhere else, room expired (connected and while away), drops keep retrying, re-throw replaces;
  catch-up then `resync` on reload; reconnect after a drop; grace forfeit; `leave` resigns; emotes; `idle` once per count; the mover's idle starts the timer; listeners survive a rematch, with the side swap.
- `npm run typecheck` passes. All 35 net tests pass.
  The full `npm test` on this branch (`phase3` merged) has 15 failures outside `src/net`, which are the same on `phase3`: `src/cast/phase6.test.ts` (11, also alone) and `server/test/determinism.raid.test.ts` (4, the Raid throw bug in the server brief).

## How to run the demo
- Launch config `net-demo` (port 4415; it moves to 4416 if 4415 is taken), then open `/src/net/demo.html`.
- Two players side by side, **You** and **Friend**, each with its own connection and its own saved token. They stack on phones (checked at 390px).
  Each board faces its own side. Click your animal, then a dot (move or step) or a ring (capture or shove). The buttons show what you can do now: power, cards, lucky bonus, duel call, the three hands, End turn, Resign, Rematch, an emote.
- **Top bar:**
  - **Fake server / Real server.** Real uses `wrangler dev` on port 8787 (the `online-server` config, from the server branch).
  - Mode and side.
  - **New room.**
  - **Timers ×1 / ×10 / ×60** (fake only).
  - **Force timeout** (fake only).
- **Per player:**
  - **Drop** cuts that player's network: the other side sees "away" and a 2:00 countdown.
  - **Restore** brings it back (it reconnects on its next retry).
  - **Reload page** throws the client away and rejoins with the saved token: silent catch-up, then `resync`.
- The event log at the bottom shows what each screen saw.

## Contract requests
1. `net.ts`: say that `start.options.opponent.you` is **the recipient's own side**. Both the fake and the real server do this, and the client relies on it after a rematch swap.
2. `net.ts`: record the join order (`welcome`, `start` + `inputs`, `presence`, `timer`, `rematch`s) and the close codes. The client ends its silent catch-up at the `presence` after `inputs`; the real server now always sends it.
3. `net.ts` (`OnlineClient` doc): record the proxy details integration needs:
   - `move()` returns null online.
   - `resign()` ignores its argument (it resigns you).
   - Interactive reads only offer your own pieces on your turn.
   - Emotes: the game proxy re-emits `emote`; `ArenaController` has no `emote` event, so `ArenaMatch` should use the online `emote`.
4. Optional: `join` could carry `game`, so `have` is never ambiguous. The real server already handles this with its own per-player `sentGame`, so it's low priority.
5. For integration: `createOnlineWith(deps)` (also in `index.ts`) takes any transport and storage. Handy if the app ever wants the fake server (for example an offline "try online" demo).

## Open design questions for Johanes
- **Turn timer during a duel throw:** both players pick at once, but the timer shows by the side still to throw (the attacker if neither has). OK, or show it for both?
- **After you throw:** your screen says "Waiting for the other throw…". Nothing shows your pick until both are in. OK?
- **Long drop:** after 2.5 minutes of failed retries the pill says "Offline". It keeps trying every 15s; by then your friend's screen has already counted you out.
- **Friend's turn:** clicking the friend's animals shows nothing (no moves, no power). OK, or would you like to see their options greyed?

## Known issues
- **Not yet tried live against `wrangler dev`.** Its launch config needs the server's `server/` folder, which isn't in this worktree; that's for integration on `phase3`.
  The server session checked my protocol note against its code (commit 46e8150), and I adapted to its differences: 201, close codes, the 404 upgrade, re-throws. It should fit, but it's untested live.
- **Phone testing over Wi-Fi:** the client aims at `http://<this host>:8787`, but the real server's CORS only allows `localhost`/`127.0.0.1` origins and `ALLOWED_ORIGINS`. A LAN IP needs adding there.
- **Reload while your throw is held:** a reloaded screen doesn't know it threw, so the hands come back. Throwing again simply replaces the held hand (real and fake server).
- **The fake server is a stand-in** for the real one in `server/`. It does no 24 h expiry and no message-size or rate limits.
- **Demo stand-ins:** ♥ Revive always brings back your first captured animal (no picker). Promotion is always a queen.
- With **Real server** picked and no server running, the browser logs its own "connection refused" line. The page then shows a hint to start `online-server`.
