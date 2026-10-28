/**
 * Room: everything one match room does, in plain TypeScript (no Cloudflare APIs), so vitest runs it in Node.
 * The Durable Object (../room.ts) feeds it messages, socket closes and alarms, and carries out the Effects it returns.
 *
 * Players are known by their rejoin token. A rematch swaps which side each token plays.
 */
import type {
  ClientMsg, CreateRoomResponse, NetInput, Presence, RoomInfo, RoomStatus, SentInput, ServerMsg,
} from '../../../src/contracts/net';
import type { EmoteKind, GameOptions, Hand, PlayMode, Side } from '../../../src/contracts/types';
import { cleanInput, Match } from './match';

export const TIMING = {
  /** The turn timer (also the lucky-6 choice). */
  turnMs: 60_000,
  /** A duel answer or a throw. */
  duelMs: 20_000,
  /** The timer starts at most this long after the last broadcast, even if the mover's screen never says idle. */
  idleFallbackMs: 5_000,
  /** An away player's time to come back. */
  graceMs: 120_000,
  /** The room is deleted this long after its last input. */
  expiryMs: 24 * 60 * 60 * 1000,
};

export const MAX_MESSAGE_BYTES = 8 * 1024;
const MODES: PlayMode[] = ['classic', 'normal', 'crazy', 'sumo', 'raid'];
const EMOTES: EmoteKind[] = ['laugh', 'angry', 'love', 'shock', 'sleepy', 'taunt'];
const other = (s: Side): Side => (s === 'land' ? 'sea' : 'land');

interface Player {
  token: string;
  presence: Exclude<Presence, 'waiting'>;
  /** When an away player forfeits (only while a game is on). */
  graceEndsAt: number | null;
  /** The game number this player was last sent a `start` for (rejoin catch-up). */
  sentGame: number;
}

interface Timer {
  kind: 'turn' | 'bonus' | 'answer' | 'throw';
  /** The side shown with the timer (for a throw: one that hasn't thrown yet). */
  side: Side;
  /** The input count it was armed at: an `idle` must report this count. */
  count: number;
  /** It starts by then even without an `idle`. */
  startBy: number;
  /** Set once it runs. */
  endsAt: number | null;
}

/** Everything about the room except the inputs. Saved as one JSON row. */
export interface Meta {
  v: 1;
  room: string;
  mode: PlayMode;
  createdAt: number;
  lastActivity: number;
  status: RoomStatus;
  /** Rematches count from 0. */
  game: number;
  seed: number;
  /** The creator's side in game 0 (the open side is the other one). */
  creatorSide: Side;
  players: Record<Side, Player | null>;
  rematch: Side[];
  /** A duel throw waiting for the other side's (never broadcast until both are in). */
  held: Partial<Record<Side, Hand>>;
  timer: Timer | null;
}

/** Storage the room needs. The DO backs it with SQLite; tests use MemoryStore. */
export interface RoomStore {
  loadMeta(): Meta | null;
  saveMeta(meta: Meta): void;
  loadInputs(): SentInput[];
  /** `n` is the input's index in the current game. */
  appendInputs(from: number, list: SentInput[]): void;
  clearInputs(): void;
  wipe(): void;
}

export interface RoomDeps {
  store: RoomStore;
  now?: () => number;
  /** 0..1, for auto inputs. */
  random?: () => number;
  /** A fresh seed for each game. */
  seed?: () => number;
  /** A fresh rejoin token. */
  token?: () => string;
  /** Called with every new Match (tests watch core's events through it). */
  onMatch?: (m: Match) => void;
}

/** What the Durable Object must do after a call. `reply`/`close`/`bind` act on the socket that sent the message. */
export type Effect =
  | { kind: 'send'; token: string; msg: ServerMsg }
  | { kind: 'reply'; msg: ServerMsg }
  | { kind: 'bind'; token: string }
  | { kind: 'close'; code: number; reason: string }
  | { kind: 'destroy' };

export const CLOSE = { replaced: 4001, unknownToken: 4003, full: 4004, left: 4005, expired: 4010, rateLimited: 4008 };

export class Room {
  private meta: Meta | null;
  private inputs: SentInput[] = [];
  private match: Match | null = null;
  private fx: Effect[] = [];
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newSeed: () => number;
  private readonly newToken: () => string;

  constructor(private deps: RoomDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.newSeed = deps.seed ?? randomSeed;
    this.newToken = deps.token ?? randomToken;
    this.meta = deps.store.loadMeta();
    if (this.meta) {
      this.inputs = deps.store.loadInputs();
      if (this.meta.status !== 'waiting') this.rebuild();
    }
  }

  // ---------- HTTP side ----------

  exists(): boolean {
    return !!this.meta;
  }

  /** Set up a new room. Returns null when this code is taken (the Worker tries another). */
  create(room: string, options: unknown): CreateRoomResponse | null {
    if (this.meta) return null;
    const o = options as GameOptions | null;
    if (!o || typeof o !== 'object' || o.opponent?.type !== 'online') throw new BadRequest('opponent must be { type: "online", you }');
    const you = o.opponent.you;
    if (you !== 'land' && you !== 'sea') throw new BadRequest('opponent.you must be "land" or "sea"');
    const mode = o.mode ?? 'classic';
    if (!MODES.includes(mode)) throw new BadRequest(`unknown mode "${String(mode)}"`);
    const now = this.now();
    const token = this.newToken();
    this.meta = {
      v: 1, room, mode, createdAt: now, lastActivity: now, status: 'waiting', game: 0, seed: 0, creatorSide: you,
      players: { land: null, sea: null }, rematch: [], held: {}, timer: null,
    };
    this.meta.players[you] = { token, presence: 'away', graceEndsAt: null, sentGame: -1 };
    this.save();
    return { room, token, you };
  }

  info(): RoomInfo | null {
    const m = this.meta;
    if (!m) return null;
    const open: Side | null = !m.players.land ? 'land' : !m.players.sea ? 'sea' : null;
    return { room: m.room, mode: m.mode, openSide: open, status: m.status };
  }

  /** When the Durable Object's alarm should next fire (null: no alarm). */
  nextAlarm(): number | null {
    const m = this.meta;
    if (!m) return null;
    const times = [m.lastActivity + TIMING.expiryMs];
    if (m.status === 'playing') {
      for (const s of ['land', 'sea'] as Side[]) {
        const g = m.players[s]?.graceEndsAt;
        if (g != null) times.push(g);
      }
      if (m.timer) times.push(m.timer.endsAt ?? m.timer.startBy);
    }
    return Math.min(...times);
  }

  // ---------- socket side ----------

  /** A message from a socket. `token` is the player the socket is bound to (null before `join`). */
  message(token: string | null, data: string | ArrayBuffer): Effect[] {
    this.fx = [];
    if (!this.meta) return [{ kind: 'reply', msg: { t: 'error', reason: 'This room has expired' } }, { kind: 'close', code: CLOSE.expired, reason: 'expired' }];
    if (typeof data !== 'string' || data.length > MAX_MESSAGE_BYTES) return []; // dropped
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data);
    } catch {
      return [];
    }
    if (!msg || typeof msg !== 'object') return [];
    if (msg.t === 'ping') return [{ kind: 'reply', msg: { t: 'pong' } }];
    if (msg.t === 'join') {
      this.join(token, msg);
      return this.flush();
    }
    const side = token ? this.sideOf(token) : null;
    if (!side) return [{ kind: 'reply', msg: { t: 'error', reason: 'Join first' } }];
    switch (msg.t) {
      case 'input': this.onInput(side, msg.id, msg.input); break;
      case 'idle': this.onIdle(side, msg.have); break;
      case 'emote':
        if (EMOTES.includes(msg.emote)) this.sendBoth({ t: 'emote', side, emote: msg.emote });
        break;
      case 'rematch': this.onRematch(side); break;
      case 'leave': this.onLeave(side); break;
    }
    return this.flush();
  }

  /** The player's last socket closed. */
  closed(token: string): Effect[] {
    this.fx = [];
    const side = this.sideOf(token);
    const m = this.meta;
    if (!m || !side) return [];
    const p = m.players[side]!;
    if (p.presence !== 'here') return [];
    p.presence = 'away';
    p.graceEndsAt = m.status === 'playing' ? this.now() + TIMING.graceMs : null;
    this.sendPresence(other(side));
    this.save();
    return this.flush();
  }

  /** The alarm fired: run whatever is due (expiry, forfeits, timers starting or running out). */
  alarm(): Effect[] {
    this.fx = [];
    for (let guard = 0; guard < 50 && this.meta; guard++) {
      const m = this.meta;
      const now = this.now();
      if (now >= m.lastActivity + TIMING.expiryMs) {
        this.meta = null;
        this.inputs = [];
        this.match?.dispose();
        this.match = null;
        this.deps.store.wipe();
        return [...this.flush(), { kind: 'destroy' }];
      }
      if (m.status !== 'playing') break;
      const away = (['land', 'sea'] as Side[]).find((s) => { const g = m.players[s]?.graceEndsAt; return g != null && now >= g; });
      if (away) {
        const p = m.players[away]!;
        p.presence = 'left';
        p.graceEndsAt = null;
        this.sendPresence(other(away));
        this.broadcast([{ input: { k: 'resign', side: away }, auto: 'left' }]);
        continue;
      }
      const t = m.timer;
      if (t && t.endsAt === null && now >= t.startBy) {
        this.startTimer();
        continue;
      }
      if (t && t.endsAt !== null && now >= t.endsAt) {
        this.timeout();
        continue;
      }
      break;
    }
    this.save();
    return this.flush();
  }

  // ---------- reading (tests) ----------

  get state(): Readonly<Meta> | null {
    return this.meta;
  }
  get currentMatch(): Match | null {
    return this.match;
  }
  get inputCount(): number {
    return this.inputs.length;
  }
  get storedInputs(): readonly SentInput[] {
    return this.inputs;
  }

  // ---------- handlers ----------

  private join(bound: string | null, msg: Extract<ClientMsg, { t: 'join' }>): void {
    const m = this.meta!;
    if (bound) return this.reply({ t: 'error', reason: 'Already joined' });
    let side: Side | null;
    let fresh = false;
    if (typeof msg.token === 'string') {
      side = this.sideOf(msg.token);
      if (!side) {
        this.reply({ t: 'error', reason: 'This invite is for someone else' });
        this.fx.push({ kind: 'close', code: CLOSE.unknownToken, reason: 'unknown token' });
        return;
      }
    } else {
      side = !m.players.land ? 'land' : !m.players.sea ? 'sea' : null;
      if (!side) {
        this.reply({ t: 'error', reason: 'This game is full' });
        this.fx.push({ kind: 'close', code: CLOSE.full, reason: 'full' });
        return;
      }
      m.players[side] = { token: this.newToken(), presence: 'here', graceEndsAt: null, sentGame: -1 };
      fresh = true;
    }
    const p = m.players[side]!;
    p.presence = 'here';
    p.graceEndsAt = null;
    this.fx.push({ kind: 'bind', token: p.token });
    const opp = m.players[other(side)];
    this.reply({ t: 'welcome', you: side, token: p.token, info: this.info()!, opponent: opp ? opp.presence : 'waiting' });
    if (opp) this.sendPresence(other(side));

    if (fresh && m.status === 'waiting' && m.players.land && m.players.sea) {
      this.startGame();
    } else if (m.status !== 'waiting') {
      // Rejoin: the current game, the inputs this mirror lacks, then the live extras.
      const have = Number.isInteger(msg.have) && msg.have >= 0 && msg.have <= this.inputs.length && p.sentGame === m.game ? msg.have : 0;
      p.sentGame = m.game;
      this.reply({ t: 'start', game: m.game, options: this.optionsFor(side) });
      this.reply({ t: 'inputs', from: have, list: this.inputs.slice(have) });
      if (m.timer?.endsAt != null) this.reply({ t: 'timer', side: m.timer.side, msLeft: Math.max(0, m.timer.endsAt - this.now()) });
      for (const s of m.rematch) this.reply({ t: 'rematch', side: s });
    }
    this.save();
  }

  private onInput(side: Side, id: number, raw: unknown): void {
    const m = this.meta!;
    const reject = (reason: string) => this.reply({ t: 'reject', id, reason });
    if (m.status !== 'playing' || !this.match) return reject(m.status === 'over' ? 'The game is over' : 'The game has not started');
    const input = cleanInput(raw);
    if (!input) return reject('Bad input');
    if (input.side !== side) return reject('Not your side');

    if (input.k === 'throw') {
      // Held until the other throw is in. A side may change its throw until then (say, after a reload).
      const need = this.match.need();
      if (need?.kind !== 'throw') return reject('No duel throw now');
      m.held[side] = input.hand;
      if (m.held[need.attacker] && m.held[need.defender]) return this.releaseThrows();
      if (m.timer?.kind === 'throw') {
        m.timer.side = other(side);
        if (m.timer.endsAt !== null) this.sendTimer();
      }
      return this.save();
    }

    const r = this.match.apply(input);
    if (!r.ok) {
      if (r.broken) this.rebuild();
      return reject(r.reason);
    }
    this.accepted([{ input }]);
  }

  private onIdle(side: Side, have: number): void {
    const t = this.meta!.timer;
    if (!t || t.endsAt !== null || have !== t.count || have !== this.inputs.length) return;
    const allowed = t.kind === 'throw' ? !this.meta!.held[side] : t.side === side;
    if (!allowed) return;
    this.startTimer();
    this.save();
  }

  private onRematch(side: Side): void {
    const m = this.meta!;
    if (m.status !== 'over' || m.rematch.includes(side)) return;
    m.rematch.push(side);
    this.sendBoth({ t: 'rematch', side });
    if (m.rematch.length === 2) {
      // Swap sides: each player (token) takes the other side.
      m.players = { land: m.players.sea, sea: m.players.land };
      m.game++;
      this.startGame();
      return;
    }
    this.save();
  }

  private onLeave(side: Side): void {
    const m = this.meta!;
    const p = m.players[side]!;
    p.presence = 'left';
    p.graceEndsAt = null;
    m.rematch = m.rematch.filter((s) => s !== side);
    if (m.status === 'playing') this.broadcast([{ input: { k: 'resign', side }, auto: 'left' }]);
    this.sendPresence(other(side));
    this.fx.push({ kind: 'close', code: CLOSE.left, reason: 'left' });
    this.save();
  }

  // ---------- game flow ----------

  private startGame(): void {
    const m = this.meta!;
    const now = this.now();
    m.seed = this.newSeed();
    m.status = 'playing';
    m.rematch = [];
    m.held = {};
    m.lastActivity = now;
    this.inputs = [];
    this.deps.store.clearInputs();
    this.match?.dispose();
    this.match = new Match(this.coreOptions());
    this.deps.onMatch?.(this.match);
    for (const side of ['land', 'sea'] as Side[]) {
      const p = m.players[side]!;
      p.sentGame = m.game;
      if (p.presence !== 'here') {
        p.graceEndsAt = now + TIMING.graceMs;
        this.sendPresence(other(side));
      }
      this.send(side, { t: 'start', game: m.game, options: this.optionsFor(side) });
    }
    this.armTimer();
    this.save();
  }

  /** Both throws are in: apply them attacker first and broadcast them together. `auto`: the sides the room threw for. */
  private releaseThrows(auto: Side[] = []): void {
    const m = this.meta!;
    const need = this.match!.need() as Extract<ReturnType<Match['need']>, { kind: 'throw' }>;
    const list: SentInput[] = [];
    for (const side of [need.attacker, need.defender]) {
      const input: NetInput = { k: 'throw', side, hand: m.held[side]! };
      this.match!.apply(input);
      list.push(auto.includes(side) ? { input, auto: 'timeout' } : { input });
    }
    m.held = {};
    this.accepted(list);
  }

  /** Inputs the room's core already applied: store, broadcast, and move the game on. */
  private accepted(list: SentInput[]): void {
    const m = this.meta!;
    this.deps.store.appendInputs(this.inputs.length, list);
    this.inputs.push(...list);
    m.lastActivity = this.now();
    this.sendBoth({ t: 'inputs', from: this.inputs.length - list.length, list });
    if (this.match!.over()) {
      m.status = 'over';
      m.timer = null;
      m.held = {};
      for (const s of ['land', 'sea'] as Side[]) if (m.players[s]) m.players[s]!.graceEndsAt = null;
      this.sendTimer();
    } else {
      this.armTimer();
    }
    this.save();
  }

  /** Inputs the room makes itself (a resign after the grace, or a timeout): apply, then as `accepted`. */
  private broadcast(list: SentInput[]): boolean {
    for (const s of list) {
      const r = this.match!.apply(s.input);
      if (!r.ok) {
        if (r.broken) this.rebuild();
        return false;
      }
    }
    this.accepted(list);
    return true;
  }

  /** A new decision is due: the timer waits for the mover's `idle` (or the fallback), then runs. */
  private armTimer(): void {
    const m = this.meta!;
    const need = this.match!.need();
    const was = m.timer?.endsAt != null;
    if (!need) {
      m.timer = null;
    } else {
      const side = need.kind === 'throw' ? need.attacker : need.side;
      m.timer = { kind: need.kind, side, count: this.inputs.length, startBy: this.now() + TIMING.idleFallbackMs, endsAt: null };
    }
    if (was) this.sendTimer();
  }

  private startTimer(): void {
    const t = this.meta!.timer!;
    t.endsAt = this.now() + (t.kind === 'answer' || t.kind === 'throw' ? TIMING.duelMs : TIMING.turnMs);
    this.sendTimer();
  }

  /** Time ran out: make the input for the slow side, flagged auto 'timeout'. */
  private timeout(): void {
    const m = this.meta!;
    const need = this.match!.need();
    if (!need) {
      m.timer = null;
      return;
    }
    if (need.kind === 'throw') {
      const missing = [need.attacker, need.defender].filter((s) => !m.held[s]);
      for (const input of this.match!.autoInputs(this.random, missing)) {
        if (input.k === 'throw') m.held[input.side] = input.hand;
      }
      return this.releaseThrows(missing);
    }
    // Should never fail; if it does, drop the timer rather than retry forever.
    if (!this.broadcast(this.match!.autoInputs(this.random).map((input) => ({ input, auto: 'timeout' as const })))) m.timer = null;
  }

  /** Core state can't be trusted (it threw): rebuild it from the stored inputs. */
  private rebuild(): void {
    this.match?.dispose();
    this.match = Match.replay(this.coreOptions(), this.inputs.map((s) => s.input));
    this.deps.onMatch?.(this.match);
  }

  // ---------- helpers ----------

  /** The options the room's core runs (the same for both mirrors, apart from `you`). */
  private coreOptions(): GameOptions {
    const m = this.meta!;
    return { mode: m.mode, opponent: { type: 'online', you: m.creatorSide }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed: m.seed };
  }

  private optionsFor(side: Side): GameOptions {
    return { ...this.coreOptions(), opponent: { type: 'online', you: side } };
  }

  private sideOf(token: string): Side | null {
    const p = this.meta?.players;
    if (!p) return null;
    return p.land?.token === token ? 'land' : p.sea?.token === token ? 'sea' : null;
  }

  private save(): void {
    if (this.meta) this.deps.store.saveMeta(this.meta);
  }

  private flush(): Effect[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  private reply(msg: ServerMsg): void {
    this.fx.push({ kind: 'reply', msg });
  }

  private send(side: Side, msg: ServerMsg): void {
    const p = this.meta!.players[side];
    if (p && p.presence === 'here') this.fx.push({ kind: 'send', token: p.token, msg });
  }

  private sendBoth(msg: ServerMsg): void {
    this.send('land', msg);
    this.send('sea', msg);
  }

  /** Tell `to` how its opponent is doing. */
  private sendPresence(to: Side): void {
    const opp = this.meta!.players[other(to)];
    const g = opp?.graceEndsAt ?? null;
    this.send(to, { t: 'presence', opponent: opp ? opp.presence : 'waiting', msLeft: opp?.presence === 'away' && g != null ? Math.max(0, g - this.now()) : null });
  }

  private sendTimer(): void {
    const t = this.meta!.timer;
    if (t?.endsAt != null) this.sendBoth({ t: 'timer', side: t.side, msLeft: Math.max(0, t.endsAt - this.now()) });
    else this.sendBoth({ t: 'timer', side: null, msLeft: null });
  }
}

export class BadRequest extends Error {}

/** A 31-bit seed from the platform's crypto RNG. */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
}

/** 128 random bits as hex. */
function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Room codes: 6 characters with no look-alikes (no 0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
export const isCode = (s: string): boolean => s.length === 6 && [...s].every((c) => CODE_ALPHABET.includes(c));

/** Storage in memory (tests). Keeps JSON copies, the way SQLite would. */
export class MemoryStore implements RoomStore {
  meta: string | null = null;
  inputs: string[] = [];
  loadMeta() { return this.meta ? JSON.parse(this.meta) as Meta : null; }
  saveMeta(meta: Meta) { this.meta = JSON.stringify(meta); }
  loadInputs() { return this.inputs.map((s) => JSON.parse(s) as SentInput); }
  appendInputs(from: number, list: SentInput[]) { list.forEach((s, k) => (this.inputs[from + k] = JSON.stringify(s))); }
  clearInputs() { this.inputs = []; }
  wipe() { this.meta = null; this.inputs = []; }
}
