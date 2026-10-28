/**
 * An in-page stand-in for the Cloudflare room server (`server/`), speaking the same protocol (`src/contracts/net.ts`).
 * It runs its own core per room, checks every input, holds the first duel throw until the second arrives, runs the
 * turn timer and the away grace, and does rematches. For the demo and the tests only: the real rules live in `server/`.
 *
 * Extras for testing: `timeScale` speeds every timer up, `forceTimeout(room)` fires the running timer now,
 * and each `transport()` is a `ControlledTransport` you can drop.
 */
import type {
  ClientMsg, CreateRoomRequest, CreateRoomResponse, NetInput, Presence, RoomInfo, RoomStatus, SentInput, ServerMsg,
} from '../contracts/net';
import type { GameOptions, Side } from '../contracts/types';
import { ArenaGame } from '../core/arena/game';
import { MenagerieGame } from '../core/controller';
import { HANDS, Match, other } from './match';
import { ControlledTransport, type HttpReply, type SocketLike, type Transport } from './transport';

export interface FakeServerOptions {
  /** One-way delay for every socket message and HTTP reply, ms. Default 30. */
  latencyMs?: number;
  /** Multiplies every timer (0.1 = ten times faster). Default 1. */
  timeScale?: number;
  /** Milliseconds, monotonic. Default performance.now. */
  now?: () => number;
  random?: () => number;
  /** Picks each game's seed. Default: random. */
  seed?: () => number;
}

/** GAME_SPEC "Online play" defaults. */
export const TIMES = {
  turnMs: 60_000,
  /** Duel answer and throws. */
  answerMs: 20_000,
  /** The turn timer starts at the latest this long after a broadcast, even if the mover's screen never says idle. */
  idleFallbackMs: 5_000,
  graceMs: 120_000,
};

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/l

/** The server end of one socket. */
class Conn {
  /** False once either end started closing: nothing new is sent, but what's in flight still arrives. */
  open = true;
  /** The client saw the close. */
  dead = false;
  constructor(private server: FakeServer, private client: SocketLike) {}
  send(msg: ServerMsg): void {
    if (!this.open) return;
    const data = JSON.stringify(msg);
    this.server.later(() => !this.dead && this.client.onmessage?.(data));
  }
  /** `code`: the close code the client sees (server/REPORT.md: 4001 replaced, 4003 bad token, 4004 full, 4005 left). */
  close(code?: number): void {
    if (!this.open) return;
    this.open = false;
    this.server.later(() => {
      if (this.dead) return;
      this.dead = true;
      this.client.onclose?.(code);
    });
  }
}

class Room {
  status: RoomStatus = 'waiting';
  game = -1;
  options!: GameOptions;
  inputs: SentInput[] = [];
  match: Match | null = null;
  tokens: Record<Side, string | null> = { land: null, sea: null };
  conns: Record<Side, Conn | null> = { land: null, sea: null };
  presence: Record<Side, Presence> = { land: 'waiting', sea: 'waiting' };
  graceEndsAt: Record<Side, number | null> = { land: null, sea: null };
  private graceTimers: Record<Side, ReturnType<typeof setTimeout> | null> = { land: null, sea: null };
  /** This round's throws, held back until both are in. A second throw from the same side replaces its first. */
  held: Partial<Record<Side, SentInput>> = {};
  rematch = new Set<Side>();
  timer: { side: Side; endsAt: number; handle: ReturnType<typeof setTimeout> } | null = null;
  private fallback: ReturnType<typeof setTimeout> | null = null;
  /** Board games: whose turn the running timer (or its fallback) covers. It runs on through that turn's stages. */
  private turnSide: Side | null = null;
  private timingOut = false;
  private idleSides = new Set<Side>();

  constructor(private server: FakeServer, readonly code: string, readonly base: GameOptions, readonly creator: Side) {}

  info(): RoomInfo {
    const open = (['land', 'sea'] as Side[]).find((s) => !this.tokens[s]) ?? null;
    return { room: this.code, mode: this.base.mode ?? 'classic', openSide: open, status: this.status };
  }

  // ---------- sockets ----------

  join(conn: Conn, token: string | null, have: number): void {
    let side: Side | undefined;
    if (token) {
      side = (['land', 'sea'] as Side[]).find((s) => this.tokens[s] === token);
      if (!side) return this.refuse(conn, 'This invite is for someone else', 4003);
    } else {
      side = (['land', 'sea'] as Side[]).find((s) => !this.tokens[s]);
      if (!side) return this.refuse(conn, 'This game is full', 4004);
      this.tokens[side] = this.server.token();
    }
    const old = this.conns[side];
    if (old && old !== conn) old.close(4001);
    this.conns[side] = conn;
    this.server.sides.set(conn, { room: this, side });
    const wasHere = this.presence[side];
    this.presence[side] = 'here';
    this.graceEndsAt[side] = null;
    this.clearGrace(side);

    conn.send({ t: 'welcome', you: side, token: this.tokens[side]!, info: this.info(), opponent: this.presence[other(side)] });
    if (this.status === 'waiting' && this.tokens.land && this.tokens.sea) {
      this.startGame(); // sends `start` to both
      conn.send({ t: 'inputs', from: 0, list: [] });
    } else if (this.match) {
      conn.send(this.startMsg(side));
      const from = have >= 0 && have <= this.inputs.length ? have : 0;
      conn.send({ t: 'inputs', from, list: this.inputs.slice(from) });
    }
    conn.send(this.presenceMsg(side));
    conn.send(this.timerMsg());
    if (wasHere !== 'here') this.send(other(side), this.presenceMsg(other(side)));
  }

  private refuse(conn: Conn, reason: string, code: number): void {
    conn.send({ t: 'error', reason });
    conn.close(code);
  }

  message(side: Side, msg: ClientMsg): void {
    switch (msg.t) {
      case 'join':
        return; // handled before a side is known
      case 'ping':
        return this.send(side, { t: 'pong' });
      case 'emote':
        return this.both({ t: 'emote', side, emote: msg.emote });
      case 'input':
        return this.input(side, msg.id, msg.input);
      case 'idle':
        return this.idle(side, msg.have);
      case 'rematch':
        return this.askRematch(side);
      case 'leave':
        return this.leave(side);
    }
  }

  closed(conn: Conn, side: Side): void {
    if (this.conns[side] !== conn) return; // an old socket that was replaced
    this.conns[side] = null;
    if (this.presence[side] === 'left') return;
    this.presence[side] = 'away';
    this.graceEndsAt[side] = this.server.now() + this.server.scaled(TIMES.graceMs);
    this.clearGrace(side);
    this.graceTimers[side] = setTimeout(() => this.graceOver(side), this.server.scaled(TIMES.graceMs));
    this.send(other(side), this.presenceMsg(other(side)));
  }

  private graceOver(side: Side): void {
    this.graceTimers[side] = null;
    if (this.presence[side] !== 'away') return;
    this.markLeft(side);
  }

  private leave(side: Side): void {
    const conn = this.conns[side];
    this.markLeft(side);
    this.conns[side] = null;
    conn?.close(4005);
  }

  private markLeft(side: Side): void {
    this.presence[side] = 'left';
    this.graceEndsAt[side] = null;
    this.clearGrace(side);
    if (this.status === 'playing') this.take({ k: 'resign', side }, 'left');
    this.send(other(side), this.presenceMsg(other(side)));
  }

  private clearGrace(side: Side): void {
    if (this.graceTimers[side]) clearTimeout(this.graceTimers[side]!);
    this.graceTimers[side] = null;
  }

  // ---------- the game ----------

  private startGame(): void {
    this.game++;
    this.status = 'playing';
    this.options = {
      ...this.base,
      opponent: { type: 'online', you: this.creator },
      time: { initialMs: null, incrementMs: 0 },
      weirdMode: false,
      seed: this.server.nextSeed(),
    };
    this.match?.dispose();
    this.match = Match.create(this.options, { game: () => new MenagerieGame(), arena: () => new ArenaGame() });
    this.inputs = [];
    this.held = {};
    this.rematch.clear();
    this.match.core.ctl.newGame(this.options);
    for (const s of ['land', 'sea'] as Side[]) this.send(s, this.startMsg(s));
    this.armTimer();
  }

  private input(side: Side, id: number, input: NetInput): void {
    if (!this.match || this.status !== 'playing') return this.send(side, { t: 'reject', id, reason: 'The game is not on' });
    if (!input || input.side !== side) return this.send(side, { t: 'reject', id, reason: 'Not your side' });
    const bad = this.take(input);
    if (bad) this.send(side, { t: 'reject', id, reason: bad });
  }

  /**
   * Check and apply an input (from a player or the room), then broadcast it. Throws are held until both are in;
   * then both apply and go out together, attacker first. Returns a reason when refused.
   */
  private take(input: NetInput, auto?: SentInput['auto']): string | null {
    const match = this.match!;
    const sent: SentInput = auto ? { input, auto } : { input };
    if (input.k === 'throw') return this.takeThrow(input, sent);
    const bad = match.check(input) ?? match.apply(input);
    if (bad) return bad;
    this.held = {};
    this.broadcast([sent]);
    return null;
  }

  private takeThrow(input: Extract<NetInput, { k: 'throw' }>, sent: SentInput): string | null {
    const match = this.match!;
    const d = match.duel;
    if (match.isOver() || d?.stage !== 'throw') return 'No throw now';
    if (input.side !== d.info.attacker && input.side !== d.info.defender) return 'Not in this duel';
    if (!HANDS.includes(input.hand)) return 'Not a hand';
    this.held[input.side] = sent;
    d.thrown[input.side] = true; // so the timer moves on to whoever still has to throw
    const a = this.held[d.info.attacker];
    const b = this.held[d.info.defender];
    if (!a || !b) {
      this.armTimer();
      return null;
    }
    this.held = {};
    for (const t of [a, b]) match.apply(t.input);
    this.broadcast([a, b]);
    return null;
  }

  private broadcast(list: SentInput[]): void {
    const from = this.inputs.length;
    this.inputs.push(...list);
    for (const s of ['land', 'sea'] as Side[]) this.send(s, { t: 'inputs', from, list });
    if (this.match?.isOver()) {
      this.status = 'over';
      this.stopTimer();
      return;
    }
    this.armTimer();
  }

  /** After every change: stop the timer; it starts again on the mover's idle, or after the fallback. */
  private armTimer(): void {
    if (this.timingOut) return;
    const w = this.match?.awaiting();
    // Board games: one timer for the whole turn, not one per stage.
    if (this.match?.board && w?.kind === 'action' && w.side === this.turnSide && (this.timer || this.fallback)) return;
    this.stopTimer();
    this.idleSides.clear();
    this.turnSide = null;
    if (!w || w.kind === 'none') return;
    if (this.match?.board && w.kind === 'action') this.turnSide = w.side;
    this.fallback = setTimeout(() => this.startTimer(), this.server.scaled(TIMES.idleFallbackMs));
  }

  private idle(side: Side, have: number): void {
    if (have !== this.inputs.length || this.timer || !this.fallback) return;
    const w = this.match?.awaiting();
    if (!w || w.kind === 'none') return;
    const movers = w.kind === 'throw' ? w.sides : [w.side];
    if (movers.includes(side)) this.startTimer();
  }

  private startTimer(): void {
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
    const w = this.match?.awaiting();
    if (!w || w.kind === 'none' || this.timer) return;
    const side = w.kind === 'throw' ? w.sides[0] : w.side;
    if (!side) return;
    const ms = this.server.scaled(w.kind === 'answer' || w.kind === 'throw' ? TIMES.answerMs : TIMES.turnMs);
    this.timer = { side, endsAt: this.server.now() + ms, handle: setTimeout(() => this.timeout(), ms) };
    this.both(this.timerMsg());
  }

  private stopTimer(): void {
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
    if (!this.timer) return;
    clearTimeout(this.timer.handle);
    this.timer = null;
    this.both(this.timerMsg());
  }

  /** Time ran out (or `forceTimeout`): make the input(s) for whoever we wait on. */
  timeout(): void {
    const match = this.match;
    if (this.timer) clearTimeout(this.timer.handle);
    this.timer = null;
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
    if (!match || this.status !== 'playing') return;
    const w = match.awaiting();
    if (match.board && w.kind === 'action') return this.timeoutBoardTurn(w.side);
    const sides = w.kind === 'none' ? [] : w.kind === 'throw' ? w.sides : [w.side];
    for (const side of sides) {
      const input = match.timeoutInput(side, this.server.random);
      const bad = input && this.take(input, 'timeout');
      if (bad) console.warn('[fake server] the timeout input was refused', input, bad);
    }
  }

  /** Board games: a random legal action for each stage left, until the turn passes (or the game ends). */
  private timeoutBoardTurn(side: Side): void {
    const match = this.match!;
    this.timingOut = true;
    try {
      for (let i = 0; i < 12; i++) {
        const w = match.awaiting();
        if (this.status !== 'playing' || w.kind !== 'action' || w.side !== side) break;
        const input = match.timeoutInput(side, this.server.random);
        const bad = input ? this.take(input, 'timeout') : 'nothing legal';
        if (!bad) continue;
        if (this.take({ k: 'arena', side, action: { type: 'endTurn' } }, 'timeout')) {
          console.warn('[fake server] the timeout found nothing to play', input, bad);
          break;
        }
      }
    } finally {
      this.timingOut = false;
    }
    this.turnSide = null;
    if (this.status === 'playing') this.armTimer();
  }

  private askRematch(side: Side): void {
    if (this.status !== 'over' || this.rematch.has(side)) return;
    this.rematch.add(side);
    this.both({ t: 'rematch', side });
    if (this.rematch.size < 2) return;
    // Swap sides: each player's token, socket and presence move to the other side.
    const swap = <T>(r: Record<Side, T>) => ([r.land, r.sea] = [r.sea, r.land]);
    swap(this.tokens);
    swap(this.conns);
    swap(this.presence);
    swap(this.graceEndsAt);
    swap(this.graceTimers);
    for (const s of ['land', 'sea'] as Side[]) {
      const c = this.conns[s];
      if (c) this.server.sides.set(c, { room: this, side: s });
    }
    (this as { creator: Side }).creator = other(this.creator);
    this.startGame();
  }

  // ---------- messages ----------

  /** `start` with this player's own side in `opponent.you` (sides swap on rematch). */
  private startMsg(side: Side): ServerMsg {
    return { t: 'start', game: this.game, options: { ...this.options, opponent: { type: 'online', you: side } } };
  }

  private presenceMsg(to: Side): ServerMsg {
    const them = other(to);
    const end = this.graceEndsAt[them];
    return { t: 'presence', opponent: this.presence[them], msLeft: end === null ? null : Math.max(0, end - this.server.now()) };
  }

  private timerMsg(): ServerMsg {
    const t = this.timer;
    return t ? { t: 'timer', side: t.side, msLeft: Math.max(0, t.endsAt - this.server.now()) } : { t: 'timer', side: null, msLeft: null };
  }

  private send(side: Side, msg: ServerMsg): void {
    this.conns[side]?.send(msg);
    this.server.record(this.code, side, msg);
  }

  private both(msg: ServerMsg): void {
    this.send('land', msg);
    this.send('sea', msg);
  }

  /** The room is deleted (24 h without a move): sockets close with 4010. */
  expire(): void {
    for (const side of ['land', 'sea'] as Side[]) this.conns[side]?.close(4010);
    this.conns = { land: null, sea: null };
    this.dispose();
  }

  /** Close a player's socket as if their network went away. */
  drop(side: Side): void {
    this.conns[side]?.close();
    const c = this.conns[side];
    if (c) this.closed(c, side);
  }

  dispose(): void {
    this.stopTimer();
    this.clearGrace('land');
    this.clearGrace('sea');
    this.match?.dispose();
  }
}

export class FakeServer {
  latencyMs: number;
  timeScale: number;
  readonly now: () => number;
  readonly random: () => number;
  readonly rooms = new Map<string, Room>();
  /** Which room and side each open socket plays. */
  readonly sides = new Map<Conn, { room: Room; side: Side }>();
  /** Every message the rooms sent, for tests: `{ room, side, msg }`. */
  readonly sent: { room: string; side: Side; msg: ServerMsg }[] = [];
  /** Every message the rooms got from a player, for tests. */
  readonly received: { room: string; side: Side; msg: ClientMsg }[] = [];

  constructor(opts: FakeServerOptions = {}) {
    this.latencyMs = opts.latencyMs ?? 30;
    this.timeScale = opts.timeScale ?? 1;
    this.now = opts.now ?? (() => performance.now());
    this.random = opts.random ?? Math.random;
    this.seed = opts.seed ?? (() => Math.floor(this.random() * 2 ** 31));
  }

  private seed: () => number;
  nextSeed(): number {
    return this.seed();
  }

  /** A new transport (one per client), wrapped so it can be dropped. */
  transport(): ControlledTransport {
    const raw: Transport = {
      request: (method, path, body) => new Promise<HttpReply>((resolve) => this.later(() => resolve(this.http(method, path, body)))),
      connect: (path) => this.connect(path),
    };
    return new ControlledTransport(raw);
  }

  /** Run the room's running (or about-to-start) timer out now. */
  forceTimeout(code: string): void {
    this.rooms.get(code)?.timeout();
  }

  /** Delete a room as the 24-hour expiry would. */
  expire(code: string): void {
    this.rooms.get(code)?.expire();
    this.rooms.delete(code);
  }

  room(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  dispose(): void {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
  }

  // ---------- internals (used by Room and Conn) ----------

  later(fn: () => void): void {
    setTimeout(fn, this.latencyMs);
  }

  scaled(ms: number): number {
    return Math.max(1, Math.round(ms * this.timeScale));
  }

  token(): string {
    let t = '';
    for (let i = 0; i < 24; i++) t += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(this.random() * 36)];
    return t;
  }

  record(room: string, side: Side, msg: ServerMsg): void {
    this.sent.push({ room, side, msg });
    if (this.sent.length > 5000) this.sent.splice(0, 1000);
  }

  private code(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(this.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  private http(method: string, path: string, body: unknown): HttpReply {
    if (method === 'POST' && path === '/rooms') {
      const opts = (body as CreateRoomRequest | null)?.options;
      if (!opts || opts.opponent?.type !== 'online') return { status: 400, body: { error: "opponent must be { type: 'online', you }" } };
      const you = opts.opponent.you;
      const room = new Room(this, this.code(), { ...opts }, you);
      room.tokens[you] = this.token();
      this.rooms.set(room.code, room);
      const res: CreateRoomResponse = { room: room.code, token: room.tokens[you]!, you };
      return { status: 201, body: res };
    }
    const m = /^\/rooms\/([A-Z0-9]{6})$/.exec(path);
    if (method === 'GET' && m) {
      const room = this.rooms.get(m[1]);
      return room ? { status: 200, body: room.info() } : { status: 404, body: { error: 'No such room' } };
    }
    return { status: 404, body: { error: 'Not found' } };
  }

  private connect(path: string): SocketLike {
    const client: SocketLike = { onopen: null, onmessage: null, onclose: null, send: () => {}, close: () => {} };
    const m = /^\/rooms\/([A-Z0-9]{6})\/ws$/.exec(path);
    const conn = new Conn(this, client);
    if (!m || !this.rooms.has(m[1])) {
      // Like the real Worker: an unknown room is refused at the upgrade (HTTP 404), so the socket never opens.
      conn.open = false;
      this.later(() => client.onclose?.(1006));
      return client;
    }
    let joined = false;
    client.send = (data) => {
      if (!conn.open) return;
      this.later(() => {
        if (!conn.open) return;
        let msg: ClientMsg;
        try {
          msg = JSON.parse(data) as ClientMsg;
        } catch {
          return;
        }
        const room = m ? this.rooms.get(m[1]) : undefined;
        if (!room) {
          conn.send({ t: 'error', reason: 'This invite has expired' });
          return conn.close();
        }
        if (!joined) {
          if (msg.t !== 'join') return;
          joined = true;
          return room.join(conn, msg.token, msg.have);
        }
        const at = this.sides.get(conn);
        if (!at) return;
        this.received.push({ room: at.room.code, side: at.side, msg });
        if (this.received.length > 5000) this.received.splice(0, 1000);
        at.room.message(at.side, msg);
      });
    };
    let closing = false;
    client.send = ((send) => (data: string) => !closing && send(data))(client.send);
    client.close = () => {
      if (closing || !conn.open) return;
      closing = true; // messages already sent still arrive first
      this.later(() => {
        conn.open = false;
        if (conn.dead) return;
        conn.dead = true;
        client.onclose?.(1000);
        const at = this.sides.get(conn);
        this.sides.delete(conn);
        if (at) at.room.closed(conn, at.side);
      });
    };
    // Server-side close (refuse, replaced, drop) also has to tell the room.
    const serverClose = conn.close.bind(conn);
    conn.close = (code?: number) => {
      if (!conn.open) return;
      serverClose(code);
      this.later(() => {
        const at = this.sides.get(conn);
        this.sides.delete(conn);
        if (at) at.room.closed(conn, at.side);
      });
    };
    this.later(() => conn.open && client.onopen?.());
    return client;
  }
}
