/**
 * The online client (`OnlineClient` in src/contracts/net.ts): room calls, one socket with reconnect and ping,
 * a mirror core per game, and the stable `game` / `arena` proxies the 3D app drives as if they were local.
 */
import { Emitter } from '../contracts/emitter';
import type {
  ClientMsg, Connection, CreateRoomResponse, NetInput, OnlineClient, OnlineEventMap, RoomInfo, SentInput, ServerMsg,
} from '../contracts/net';
import type {
  ArenaController, ArenaEventMap, EmoteKind, GameController, GameEventMap, GameOptions, Side, Unsubscribe,
} from '../contracts/types';
import { ARENA_EVENTS, GAME_EVENTS, Match } from './match';
import { makeArenaProxy, makeGameProxy } from './proxies';
import type { SocketLike, Transport } from './transport';

export type TokenStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ClientDeps {
  transport: Transport;
  createGame: () => GameController;
  createArena: () => ArenaController;
  /** Where rejoin tokens live (key `mc.online.<room>`). Default localStorage. Null = none (a reload can't rejoin). */
  storage?: TokenStore | null;
  /** Milliseconds, monotonic, the same clock the HUD counts down with. Default performance.now. */
  now?: () => number;
  /** Used for the invite link. Default location.origin. */
  origin?: string;
}

/** Reconnect delays: 1s, 2s, 4s, 8s, then 15s. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const PING_MS = 20_000;
/** No message at all for this long after a ping: the socket is dead, reconnect. */
const PONG_WAIT_MS = 10_000;
/** After this long without getting back in, say "offline" (it keeps trying). Just past the away grace. */
const GIVE_UP_MS = 150_000;
/** The catch-up after `welcome` ends at the first message that isn't `start`/`inputs`, or after this long. */
const CATCHUP_MS = 400;
/**
 * Close codes that mean "don't come back" (server/REPORT.md). 4008 (too many messages) is not one: we reconnect.
 * `forget`: the token is no good any more.
 */
const FINAL_CLOSE: Record<number, { reason: string; forget: boolean }> = {
  4001: { reason: 'This game was opened somewhere else', forget: false },
  4003: { reason: 'This invite is for someone else', forget: true },
  4004: { reason: 'This game is full', forget: true },
  4005: { reason: 'You left this game', forget: true },
  4010: { reason: 'This game has expired', forget: true },
};

export const tokenKey = (room: string) => `mc.online.${room}`;

function defaultStorage(): TokenStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class OnlineClientImpl implements OnlineClient {
  readonly game: GameController;
  readonly arena: ArenaController;
  private events = new Emitter<OnlineEventMap>();
  /** The proxies' own listeners (stable across games). */
  readonly gameEvents = new Emitter<GameEventMap>();
  readonly arenaEvents = new Emitter<ArenaEventMap>();

  private _you: Side | null = null;
  private _room: string | null = null;
  private _connection: Connection = 'offline';

  /** The current game's mirror. Before the first `start`, reads come from idle placeholders. */
  mirror: { game: number; options: GameOptions; match: Match; applied: number } | null = null;
  private idleGame: GameController | null = null;
  private idleArena: ArenaController | null = null;
  /** The game number we last announced with `started`. */
  private announced: number | null = null;
  /** Building a mirror without its events (a desync rebuild). */
  private building = false;
  private catchup: { timer: ReturnType<typeof setTimeout>; mirror: OnlineClientImpl['mirror']; applied: number } | null = null;

  private socket: SocketLike | null = null;
  private wantOpen = false;
  private welcomed = false;
  private attempt = 0;
  private downSince: number | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private pongWait: ReturnType<typeof setTimeout> | null = null;
  private joining: { resolve: (v: { you: Side; info: RoomInfo }) => void; reject: (e: Error) => void; opened: boolean } | null = null;
  private nextId = 1;
  private idleSent: string | null = null;
  /** Set when I send my throw this round, so the proxy doesn't send twice (the room holds it, so the mirror can't tell). */
  thrownRound: string | null = null;
  private disposed = false;

  private readonly storage: TokenStore | null;
  readonly now: () => number;
  private readonly origin: string;

  constructor(private deps: ClientDeps) {
    this.storage = deps.storage === undefined ? defaultStorage() : deps.storage;
    this.now = deps.now ?? (() => performance.now());
    this.origin = deps.origin ?? (typeof location === 'undefined' ? '' : location.origin);
    this.game = makeGameProxy(this);
    this.arena = makeArenaProxy(this);
  }

  // ---------- OnlineClient ----------

  get you() { return this._you; }
  get room() { return this._room; }
  get connection() { return this._connection; }

  on<K extends keyof OnlineEventMap>(name: K, fn: (payload: OnlineEventMap[K]) => void): Unsubscribe {
    return this.events.on(name, fn);
  }

  async createRoom(options: GameOptions): Promise<{ room: string; link: string; you: Side }> {
    const res = await this.request('POST', '/rooms', { options });
    if (res.status < 200 || res.status > 299) throw new Error(errorText(res.body) ?? `Could not create a room (${res.status})`);
    const { room, token, you } = res.body as CreateRoomResponse;
    this.saveToken(room, token);
    await this.join(room);
    return { room, link: `${this.origin}/?room=${room}`, you };
  }

  async roomInfo(room: string): Promise<RoomInfo | null> {
    const res = await this.request('GET', `/rooms/${encodeURIComponent(room)}`);
    if (res.status === 404) return null;
    if (res.status < 200 || res.status > 299) throw new Error(errorText(res.body) ?? `Could not look up the room (${res.status})`);
    return res.body as RoomInfo;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown) {
    try {
      return await this.deps.transport.request(method, path, body);
    } catch {
      throw new Error('Could not reach the game server');
    }
  }

  join(room: string): Promise<{ you: Side; info: RoomInfo }> {
    if (this.disposed) return Promise.reject(new Error('disposed'));
    this.closeSocket();
    this.joining?.reject(new Error('Joined another room'));
    if (this._room !== room) this.dropMirror();
    this._room = room;
    this.wantOpen = true;
    this.attempt = 0;
    this.downSince = null;
    return new Promise((resolve, reject) => {
      this.joining = { resolve, reject, opened: false };
      this.setConnection('connecting');
      this.open();
    });
  }

  sendEmote(emote: EmoteKind): void {
    this.send({ t: 'emote', emote });
  }

  askRematch(): void {
    this.send({ t: 'rematch' });
  }

  leave(): void {
    this.send({ t: 'leave' });
    if (this._room) this.forgetToken(this._room);
    this.stop('offline');
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop('offline');
    this.disposed = true;
    this.dropMirror();
    this.idleGame?.dispose();
    this.idleArena?.dispose();
    this.events.clear();
    this.gameEvents.clear();
    this.arenaEvents.clear();
  }

  // ---------- used by the proxies ----------

  /** The chess controller reads come from: the mirror when a chess game runs, else an idle placeholder. */
  get readGame(): GameController {
    const m = this.mirror?.match.core;
    if (m?.kind === 'game') return m.ctl;
    return (this.idleGame ??= this.deps.createGame());
  }

  get readArena(): ArenaController {
    const m = this.mirror?.match.core;
    if (m?.kind === 'arena') return m.ctl;
    return (this.idleArena ??= this.deps.createArena());
  }

  get match(): Match | null {
    return this.mirror?.match ?? null;
  }

  get isOpen(): boolean {
    return this.welcomed && !!this.socket;
  }

  /** Send an input to the room. False when there's no live connection. */
  sendInput(input: NetInput): boolean {
    if (!this.isOpen) return false;
    this.send({ t: 'input', id: this.nextId++, input });
    return true;
  }

  /** `resume()`: my screen is idle. Sent once per (game, count). */
  sendIdle(): void {
    const m = this.mirror;
    if (!m || !this.isOpen) return;
    const key = `${m.game}:${m.applied}`;
    if (key === this.idleSent) return;
    this.idleSent = key;
    this.send({ t: 'idle', have: m.applied });
  }

  // ---------- socket ----------

  private open(): void {
    if (!this._room || !this.wantOpen) return;
    this.welcomed = false;
    const s = this.deps.transport.connect(`/rooms/${encodeURIComponent(this._room)}/ws`);
    this.socket = s;
    let opened = false;
    s.onopen = () => {
      if (this.socket !== s) return;
      opened = true;
      if (this.joining) this.joining.opened = true;
      const token = this.loadToken(this._room!);
      this.raw({ t: 'join', token, have: this.mirror?.applied ?? 0 });
    };
    s.onmessage = (data) => {
      if (this.socket !== s) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(data) as ServerMsg;
      } catch {
        return;
      }
      this.heard();
      this.onMessage(msg);
    };
    s.onclose = (code) => {
      if (this.socket !== s) return;
      this.socket = null;
      this.lost(code, opened);
    };
  }

  private raw(msg: ClientMsg): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private send(msg: ClientMsg): void {
    if (this.isOpen) this.raw(msg);
  }

  private lost(code: number | undefined, opened: boolean): void {
    this.welcomed = false;
    this.stopPing();
    this.endCatchup();
    if (!this.wantOpen) return;
    const final = code === undefined ? undefined : FINAL_CLOSE[code];
    if (final) return this.giveUp(final.reason, final.forget);
    const j = this.joining;
    if (j && !j.opened) {
      // Never got through on the first try: the room is gone (404 at the upgrade) or the server is unreachable.
      this.joining = null;
      this.stop('offline');
      this.roomGone().then((gone) => j.reject(new Error(gone ? 'This invite has expired' : 'Could not reach the game server')));
      return;
    }
    // A refused upgrade looks just like a network failure; ask whether the room still exists.
    if (!opened) {
      const room = this._room;
      this.roomGone().then((gone) => gone && this._room === room && this.wantOpen && this.giveUp('This game has ended', true));
    }
    this.downSince ??= this.now();
    const gaveUp = this.now() - this.downSince > GIVE_UP_MS;
    this.setConnection(gaveUp ? 'offline' : 'reconnecting');
    const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, wait);
  }

  /** True only when the server answered that the room doesn't exist (not on a network failure). */
  private async roomGone(): Promise<boolean> {
    const room = this._room;
    if (!room) return false;
    try {
      const res = await this.deps.transport.request('GET', `/rooms/${encodeURIComponent(room)}`);
      return res.status === 404;
    } catch {
      return false;
    }
  }

  /** The room said not to come back: stop for good. */
  private giveUp(reason: string, forget: boolean): void {
    if (forget && this._room) this.forgetToken(this._room);
    const j = this.joining;
    this.joining = null;
    this.stop('offline');
    this.events.emit('error', { reason });
    j?.reject(new Error(reason));
  }

  private closeSocket(): void {
    const s = this.socket;
    this.socket = null;
    this.welcomed = false;
    this.stopPing();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    s?.close();
  }

  private stop(state: Connection): void {
    this.wantOpen = false;
    this.closeSocket();
    this.endCatchup();
    this.setConnection(state);
  }

  private setConnection(state: Connection): void {
    if (this._connection === state) return;
    this._connection = state;
    this.events.emit('connection', { state });
  }

  private startPing(): void {
    this.stopPing();
    this.ping = setInterval(() => {
      this.raw({ t: 'ping' });
      if (!this.pongWait) this.pongWait = setTimeout(() => this.socket?.close(), PONG_WAIT_MS);
    }, PING_MS);
  }

  private heard(): void {
    if (this.pongWait) clearTimeout(this.pongWait);
    this.pongWait = null;
  }

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    this.heard();
  }

  // ---------- messages ----------

  private onMessage(msg: ServerMsg): void {
    if (this.catchup && msg.t !== 'start' && msg.t !== 'inputs') this.endCatchup();
    switch (msg.t) {
      case 'welcome':
        return this.welcome(msg);
      case 'start':
        return this.start(msg.game, msg.options);
      case 'inputs':
        return this.inputs(msg.from, msg.list);
      case 'reject':
        return this.events.emit('rejected', { reason: msg.reason });
      case 'presence':
        return this.events.emit('presence', {
          opponent: msg.opponent, graceEndsAt: msg.msLeft === null ? null : this.now() + msg.msLeft,
        });
      case 'timer':
        return this.events.emit('timer', { side: msg.side, endsAt: msg.msLeft === null ? null : this.now() + msg.msLeft });
      case 'emote':
        // The chess mirror plays it as a local game would (`emote` on the game proxy), and everyone gets the online event.
        if (this.mirror?.match.core.kind === 'game') this.mirror.match.core.ctl.sendEmote(msg.side, msg.emote);
        return this.events.emit('emote', { side: msg.side, emote: msg.emote });
      case 'rematch':
        return this.events.emit('rematch', { side: msg.side });
      case 'error':
        return this.serverError(msg.reason);
      case 'pong':
        return;
    }
  }

  private welcome(msg: Extract<ServerMsg, { t: 'welcome' }>): void {
    this.welcomed = true;
    this.attempt = 0;
    this.downSince = null;
    this._you = msg.you;
    if (this._room) this.saveToken(this._room, msg.token);
    this.idleSent = null;
    this.startPing();
    this.setConnection('online');
    this.beginCatchup();
    const j = this.joining;
    this.joining = null;
    j?.resolve({ you: msg.you, info: msg.info });
  }

  private serverError(reason: string): void {
    this.events.emit('error', { reason });
    if (this.welcomed) return;
    // Refused before we got in (room gone, full, bad token): stop trying.
    if (this._room) this.forgetToken(this._room);
    const j = this.joining;
    this.joining = null;
    this.stop('offline');
    j?.reject(new Error(reason));
  }

  private start(game: number, options: GameOptions): void {
    if (options.opponent.type === 'online') this._you = options.opponent.you;
    const cur = this.mirror;
    if (cur && cur.game === game && cur.options.seed === options.seed) return; // the game we already mirror (a rejoin)
    this.buildMirror(game, options);
  }

  private buildMirror(game: number, options: GameOptions): void {
    this.dropMirror();
    const match = Match.create(options, { game: this.deps.createGame, arena: this.deps.createArena });
    const mirror = { game, options, match, applied: 0 };
    this.mirror = mirror;
    this.idleSent = null;
    this.thrownRound = null;
    const isCurrent = () => this.mirror === mirror && !this.muted;
    if (match.core.kind === 'game') {
      const ctl = match.core.ctl;
      for (const name of GAME_EVENTS) ctl.on(name, (p) => isCurrent() && this.gameEvents.emit(name, p as never));
    } else {
      const ctl = match.core.ctl;
      for (const name of ARENA_EVENTS) ctl.on(name, (p) => isCurrent() && this.arenaEvents.emit(name, p as never));
    }
    if (!this.muted) {
      this.announced = game;
      this.events.emit('started', { game, options, you: this._you ?? youOf(options) });
    }
    match.core.ctl.newGame(options);
  }

  private inputs(from: number, list: SentInput[]): void {
    const m = this.mirror;
    if (!m) return;
    if (from > m.applied) return this.resetAndRejoin('Missed some moves; catching up');
    for (let i = m.applied - from; i < list.length; i++) {
      if (this.mirror !== m) return; // a desync rebuilt it
      const sent = list[i];
      if (sent.auto && !this.muted) this.events.emit('auto', { side: sent.input.side, why: sent.auto });
      const bad = m.match.check(sent.input) ?? m.match.apply(sent.input);
      m.applied++;
      if (bad) return this.resetAndRejoin(`Out of step with the room (${bad})`);
    }
  }

  /** Something went wrong with the mirror: rebuild it from the room's full list. */
  private resetAndRejoin(why: string): void {
    console.warn(`[net] ${why}`);
    const m = this.mirror;
    if (this.catchup) clearTimeout(this.catchup.timer);
    this.catchup = null; // the next welcome starts a new one
    if (m) this.buildMirrorSilently(m.game, m.options);
    this.closeSocket();
    this.attempt = 0;
    if (this.wantOpen) this.open();
  }

  private buildMirrorSilently(game: number, options: GameOptions): void {
    this.building = true;
    try {
      this.buildMirror(game, options);
    } finally {
      this.building = false;
    }
  }

  /** No events go out while catching up or rebuilding. */
  private get muted(): boolean {
    return !!this.catchup || this.building;
  }

  // ---------- catch-up ----------

  /** After `welcome`, the room replays the game so far: build the mirror without events, then `resync`. */
  private beginCatchup(): void {
    this.endCatchup();
    this.catchup = { timer: setTimeout(() => this.endCatchup(), CATCHUP_MS), mirror: this.mirror, applied: this.mirror?.applied ?? 0 };
  }

  private endCatchup(): void {
    const c = this.catchup;
    if (!c) return;
    clearTimeout(c.timer);
    this.catchup = null;
    const m = this.mirror;
    if (!m) return;
    if (m.game !== this.announced) {
      if (m.applied === 0) {
        // A fresh game: build it again with its events, so it starts like any game.
        this.buildMirror(m.game, m.options);
        return;
      }
      this.announced = m.game;
      this.events.emit('started', { game: m.game, options: m.options, you: this._you ?? youOf(m.options) });
      this.events.emit('resync', { game: m.game, over: m.match.result });
      return;
    }
    if (m !== c.mirror || m.applied !== c.applied) this.events.emit('resync', { game: m.game, over: m.match.result });
  }

  private dropMirror(): void {
    this.mirror?.match.dispose();
    this.mirror = null;
  }

  // ---------- tokens ----------

  private loadToken(room: string): string | null {
    try {
      return this.storage?.getItem(tokenKey(room)) ?? null;
    } catch {
      return null;
    }
  }

  private saveToken(room: string, token: string): void {
    try {
      this.storage?.setItem(tokenKey(room), token);
    } catch {
      /* no storage: a reload can't rejoin */
    }
  }

  private forgetToken(room: string): void {
    try {
      this.storage?.removeItem(tokenKey(room));
    } catch {
      /* ignore */
    }
  }
}

const youOf = (o: GameOptions): Side => (o.opponent.type === 'online' ? o.opponent.you : 'land');

function errorText(body: unknown): string | null {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === 'string' ? e : null;
}
