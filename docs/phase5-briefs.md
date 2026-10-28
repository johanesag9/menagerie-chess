# Phase 5 session briefs: online play with a friend (invite link)

Three sessions run at the same time: **server**, **net** and **ui**. Each gets its own git worktree and branch, cut from `phase3`. `main` doesn't have this work.

Every session reads these first:
- `CLAUDE.md`
- `GAME_SPEC.md`, especially **"Online play"**. That section has the rules and defaults.
- `src/contracts/net.ts` in full: the wire protocol, `OnlineClient` and `OnlineHud`.
- In `src/contracts/types.ts`: `Opponent` (the new `'online'` variant), the Phase 5 `Ui` members, `UiEventMap` (`cancelInvite`, `rematchOnline`) and the new `AudioCue`s.

Classic, Normal, Crazy, Sumo and Raid must keep working offline exactly as they do now.

---

## The big idea (everyone)
- **The server runs the real rules.** Each match lives in a Cloudflare Durable Object, a "room". The room runs core for that match and checks every input.
- **Every browser also runs a mirror.** It's a copy of core with the same options and seed. The room broadcasts each accepted input in order (`NetInput`), and every mirror applies it.
  - Same seed plus same inputs gives the same game, so the existing 3D game plays it as if it were local.
- **Duel throws stay secret.** The room holds the first throw of a round until the second one arrives, then broadcasts both, attacker first.
- **Online, core treats both sides like a local game** (`opponent.type === 'online'`).
  - Whose turn it is gets checked by the room, and by the net proxies before sending.
  - The ui and integration decide which side "you" are from `opponent.you`.
- **The free plan is the target.** Cloudflare Workers Free has Durable Objects with SQLite only and 100,000 requests a day.
  - Use WebSocket **hibernation** (`ctx.acceptWebSocket`) and **alarms** for timers, so idle rooms cost nothing.
  - Don't use `setTimeout` for timers that must survive hibernation.

---

## server: Cloudflare Worker + Durable Object rooms
**Owns** `server/`, which is new. It has its own `wrangler.jsonc`, `tsconfig.json`, `src/` and tests.

**Packages allowed:** `wrangler` and `@cloudflare/workers-types` as root devDependencies. List them in the report. Johanes approved Cloudflare on 2026-10-28.

**Build**
1. **The Worker** (`server/src/index.ts`) routes:
   - `POST /rooms`, `GET /rooms/:room`, and the WebSocket upgrade at `/rooms/:room/ws`. All three are in `net.ts`.
   - It handles CORS for the allowed origins: any `http://localhost:*` in dev, plus an `ALLOWED_ORIGINS` env var for the future site.
   - Room codes are 6 characters, with no look-alike characters (0/O, 1/I/l).
2. **The room**: a SQLite-backed Durable Object class (`new_sqlite_classes` migration). It stores:
   - the options, seed, game number and inputs of the current game
   - one rejoin token per side
   - presence
   - the last-activity time
3. **Running core in the Worker**
   - Import the core classes directly: `MenagerieGame` from `src/core/controller.ts` with no bot or engine, and `ArenaGame` from `src/core/arena/game.ts` with no bot.
   - Never import `src/core/index.ts`: it pulls in the Stockfish worker.
   - After hibernation, rebuild core by replaying the stored inputs.
   - If core can't bundle cleanly, work around it inside `server/` and put what you need under "Contract requests". A small headless entry in core is a likely one.
4. **Checking inputs**
   - The sender must own `input.side`, and it must be that side's move or answer.
   - Apply the input to the room's core. If it's refused, send `reject` and broadcast nothing.
   - Duel answers and throws come back as `void`: compare core's state before and after to tell whether they took.
5. **Timers** (GAME_SPEC defaults), run with alarms:
   - **The turn timer** is 60s. It starts when the mover's screen sends `idle`, or 5s after the last broadcast, whichever comes first.
   - **When it runs out**, the room makes the input and flags it `auto: 'timeout'`:
     - party modes: `endTurn`
     - chess modes: a random legal move, picked with core's own target APIs
     - duel answer: no duel, after 20s
     - throw: a random hand, after 20s
     - lucky 6: skip
   - Broadcast `timer` whenever it starts, stops or changes hands.
6. **Presence**
   - A closed socket makes that side `away`, with a 2-minute grace. When it ends, the room sends `resign` with `auto: 'left'`.
   - `leave` means resign now.
   - Rejoining with the token restores the side and sends the missing inputs from `have`.
7. **Rematch.** When both sides have asked, start a new game with sides swapped, a new seed and `game + 1`.
8. **Expiry.** Delete the room 24 hours after its last input.
9. **Abuse basics**
   - Messages over 8 KB are dropped.
   - More than about 20 messages a second closes the socket.
   - A full room refuses a third player.

**Tests (vitest)**
- Keep the room logic in plain TypeScript, apart from the Durable Object plumbing, so it unit-tests in Node.
- Cover:
  - creating, joining and rejoining with a token
  - wrong-side and illegal inputs refused
  - the secret throw hold
  - every timeout kind, with a fake clock
  - away, then the grace period, then the forfeit
  - rematch swapping sides
- **Determinism:** for each mode, play 100 seeded games of random legal inputs. Rebuilding from the stored inputs must give the same state and events as the live core. If this ever fails, it's a core bug: report it.
- `server/smoke.ts`: run against `wrangler dev`. It opens two sockets, plays a short Sumo game to the end, and prints the result.

**Run:** the `online-server` launch config (port 8787). Add root scripts under "Contract requests" for the orchestrator: `server:dev`, `server:test` and `server:typecheck`.

**Report:** `server/REPORT.md`, with the usual sections, plus "How to deploy": the wrangler commands Johanes will run once he has a Cloudflare account.

---

## net: the online client (mirror + proxies)
**Owns** `src/net/`, which is new.

**Build** `createOnline(opts?)` from `src/net/index.ts` (`CreateOnline` in `factories.ts`).

1. **HTTP and socket**
   - `createRoom`, `roomInfo` and `join`.
   - Reconnect on its own with backoff (1s, then 2s, 4s, up to 15s), and report `connection` events.
   - Ping every 20s.
   - Base URL: `opts.base`, else `import.meta.env.VITE_ONLINE_URL`, else `http://localhost:8787` in dev.
2. **The mirror**
   - On `start`, create a fresh core with `createGame()` or `createArena()` from `src/core/index.ts`, and call `newGame(options)`.
   - On `inputs`, apply each one in order and keep count. Drop any you already have.
3. **The proxies**: `game: GameController` and `arena: ArenaController`. These are stable objects whose listeners survive new games and rematches.
   - Reads (`pieces`, `turn`, `modeState`, `legalTargets`, `targets`, `previewArea`, `pieceOptions`, `state`, `log`…) come from the current mirror.
   - These calls send an input instead of changing the mirror:
     - `act` and `move` (returns `{ ok: true }` once it's sent)
     - `answerDuel`, `throwHand` and `resign`
   - Refuse locally (`{ ok: false, reason: 'Not your turn' }`) when the input isn't yours to make.
   - `newGame` and `undo` do nothing.
   - `pause()` does nothing.
   - `resume()` sends `idle` with the count of inputs applied, once per new count. Integration calls `resume` when the animations are done.
   - Events are the mirror's events, re-emitted.
4. **Catch-up**
   - A rejoin or page reload can arrive mid-game. Build the mirror silently: no events re-emitted while catching up. Then emit `resync`.
   - Store the token in `localStorage` under `mc.online.<room>`. Wrap it in try/catch; without storage, a reload simply can't rejoin.
5. **Other events:** `presence`, `timer` (convert `msLeft` to local `endsAt`), `emote`, `rematch`, `auto` (just before applying an auto input), `rejected` and `error`.

**A fake server, so you don't wait for the server session:**
- Write `src/net/fakeServer.ts`, which implements the protocol in `net.ts` in-page.
  - It runs its own core and applies the same checks and secret-throw rule.
  - It has simple timers you can speed up, and a fake socket you can drop.
- Test against it. When the real server is ready, also try `wrangler dev`.

**Demo** (`src/net/demo.html`, the `net-demo` config on port 4415):
- Two clients side by side (You as Land, Friend as Sea) on one page, each with a small 2D board from core's demo style.
- Clicking plays through the proxies.
- Buttons:
  - drop and restore each connection
  - reload one side (rejoin)
  - force a timeout
  - rematch
  - switch between the fake and the real server
- A plain event log.
- It must read well at 390px, with the two clients stacked.

**Tests:**
- reads come from the mirror
- actions send and don't apply
- inputs apply in order and duplicates are ignored
- secret throws
- catch-up then `resync`
- reconnect after a drop
- `idle` sent once per count
- the proxies' listeners survive a rematch

---

## ui (+ audio): invite, join, the online HUD
**Owns** `src/ui/`, `src/audio/`. Replace the `Phase 5 stubs (orchestrator ...)` in `src/ui/index.ts`.

- **Setup:** the opponent row gets a third choice, **Friend online**.
  - With it: show "Play as" (your side). Hide the bot level, the clock and Weird Mode.
  - Start emits `startGame` with `opponent: { type: 'online', you }` and an untimed `time`.
- **`showInvite`**: an overlay over the setup screen.
  - It shows the mode and your side, the link in a box, **Copy** (with a "Copied!" tick) and **Share** (`navigator.share` when there is one).
  - "Waiting for your friend…" with a gentle animation, and **Cancel**, which emits `cancelInvite`.
  - It goes away on `hideInvite()` or `show(...)`.
- **`askJoin`**: an overlay for someone who opened a link.
  - "Your friend invited you to **Sumo**. You play **Sea**.", with the mode's one-line pitch. Buttons: **Join** and **Not now**.
  - With `null`: "This invite has expired or the game is full." and an **OK** button. It resolves `false`.
- **`setOnline`**: on the game screen.
  - **Connection:** a small pill, only when not `online` ("Reconnecting…", "Offline").
  - **Your friend:**
    - "Friend is away · 1:42", counting down to `graceEndsAt`.
    - "Friend left" when `opponent` is `'left'`.
    - Waiting is never shown in game.
  - **Turn timer:** a ring or countdown by the side to move. It turns urgent in the last 10s and plays `timeLow` once.
  - **Rematch** on the result screen:
    - Online, the Rematch button emits `rematchOnline`, not `rematch`.
    - Show "Waiting for your friend…" after you've asked, and "Your friend wants a rematch!" when they ask first.
  - `null` hides all of it.
- **"You" online:** everywhere the HUD works out the human side from `opponent.type === 'bot'`, also handle `'online'` (you = `opponent.you`).
  - Names: "You" and "Friend".
  - Never show the hot-seat cover online.
  - The friend's Crazy hand shows card backs.
- **How it works:** add a short "Play a friend online" section.
- **Audio:** synthesize the new cues: `friendJoined` (a bright pop-ding), `friendLeft` (a soft down-blip) and `timeLow` (a light tick).
- **Demo:** every new overlay and HUD state with fake data: invite, join (good and dead link), away countdown, timer urgent, reconnecting, and both rematch states. Check at 390px.

---

## Integration (orchestrator, after the three merge)
- `main.ts` creates the online client. Starting with `opponent.type === 'online'`:
  1. call `createRoom`
  2. `showInvite(link)`
  3. on `started`, run the match on the online proxies
- `?room=` in the URL: call `roomInfo`, then `askJoin`, then `join`.
- `Match` and `ArenaMatch` swap to the proxies for online games.
  - "You" is `opponent.you`. The camera stays on your side.
  - Duel prompts and throws are only for you.
  - The Director going idle calls `resume`, which sends `idle`.
  - Emotes go through `sendEmote`.
  - `auto` shows a banner: "Time's up!" or "Your friend left".
  - `resync` redraws everything from the proxy state.
- QA: two browser windows, playing all five modes to the end, with drops, reloads and timeouts, at desktop size and at 390px.
