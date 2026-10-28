# net stream: Phase 5 report (online play with a friend)

Branch `claude/p5-net-e0d74f`. Owns `src/net/` only. No new packages.

## What's done
- **`createOnline(opts?)`** (`index.ts`): the `OnlineClient` from `src/contracts/net.ts`.
  - `createRoom`, `roomInfo` (null on 404), `join` (resolves on `welcome`, rejects on a room error or an unreachable server).
  - One WebSocket with auto-reconnect: backoff 1s, 2s, 4s, 8s, then 15s. `connection` events: connecting, online, reconnecting.
    After 2.5 min without getting back in it says `offline` but keeps trying. It pings every 20s, and 10s of silence after a ping counts as a dead socket.
  - Base URL: `opts.base`, else `VITE_ONLINE_URL`, else `http://<this host>:8787`. Using this host rather than localhost lets a phone on the same Wi-Fi reach `wrangler dev`.
  - Rejoin token in `localStorage` under `mc.online.<room>`, all wrapped in try/catch. `leave()` forgets it. An error before `welcome` (full, expired) also forgets it and stops retrying.
- **Mirror** (`client.ts`, `match.ts`): a fresh core per `start` with `createGame()` / `createArena()` from `src/core/index.ts`. Inputs apply in order and are counted. Duplicates are dropped.
  A gap, or an input the mirror refuses (out of step), rebuilds the mirror and rejoins with `have: 0`.
- **Proxies** (`proxies.ts`): stable `game` and `arena` objects with the exact local interfaces.
  - Reads come from the mirror (idle placeholders before the first game).
  - `act`, `move`, `answerDuel`, `throwHand` and `resign` send an input instead. Inputs that aren't yours are refused locally with `Not your turn`. Illegal moves are refused with `Illegal move`.
  - `move()` sends and returns null; the result arrives as `moved`. `resign()` always resigns you. `sendEmote` only sends your own.
  - Interactive reads only offer your pieces on your turn: `legalTargets`, `powerInfo`, `canPlayCard`, `targets`, `pieceOptions`. The friend's moves never light up.
  - `resume()` sends `idle` once per (game, count). `newGame`, `undo`, `pause` and `dispose` do nothing.
  - Listeners live on the proxy, so they survive new games and rematches.
- **Catch-up**: after `welcome`, the room replays the game. Mirror events are muted until the first message that isn't `start`/`inputs` (or 400 ms). Then it emits `started` (if the game is new to this screen) and `resync`.
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
  - Test hooks: `timeScale`, `forceTimeout(room)`, droppable transports (`ControlledTransport`), and logs of everything sent and received.
- **Tests** (`net.test.ts`, 21 cases, vitest): rooms (create, link, info, full room); reads come from the mirror; actions send and don't apply; local refusals; room rejects; party modes.
  Also: inputs in order and duplicates ignored, plus gap recovery; `auto` before apply; secret throws (nothing leaks, attacker first); duel answer and throw timeouts.
  Also: catch-up then `resync` on reload; reconnect after a drop; grace forfeit; `leave` resigns; emotes; `idle` once per count; the mover's idle starts the timer; listeners survive a rematch, with the side swap.
- `npm run typecheck` passes. `npm test` passes: 14 files, 302 tests, including the 21 net ones.

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
2. `net.ts`: an explicit end-of-catch-up message, e.g. `{ t: 'synced' }` after a join's `inputs`. Until then, the client ends the catch-up at the next other message, or after 400 ms.
   The real server sends nothing after `inputs` when no timer runs, so a rejoin `resync` comes about 0.4s late.
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
- **Not yet tried live against `wrangler dev`.** The server session was still working, and its launch config needs its `server/` folder, which isn't in this worktree.
  I read its room code: the same join order, per-player `opponent.you`, throws together attacker first, and a per-game `have`. It should fit, but it's untested.
- **Reload while your throw is held:** the room keeps your throw, but a reloaded screen doesn't know it threw, so the hands come back. Throwing again is refused by the room.
  The room should probably re-send "you already threw" on rejoin. It's rare and harmless.
- **The fake server is a stand-in** for the real one in `server/`. It does no 24 h expiry and no message-size or rate limits.
- **Demo stand-ins:** ♥ Revive always brings back your first captured animal (no picker). Promotion is always a queen.
- With **Real server** picked and no server running, the browser logs its own "connection refused" line. The page then shows a hint to start `online-server`.
