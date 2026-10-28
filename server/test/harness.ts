/**
 * Test harness: a Room with a fake clock and in-memory storage, fake sockets that carry out its Effects the way the
 * Durable Object does, and clients that keep a mirror Match from what the room broadcasts.
 */
import type { ClientMsg, NetInput, ServerMsg } from '../../src/contracts/net';
import type { GameOptions, PlayMode, Side } from '../../src/contracts/types';
import { legalActions as arenaActions } from '../../src/core/arena/rules';
import { legalActions as modeActions } from '../../src/core/modes/rules';
import { seeded } from '../../src/core/testUtils';
import { HANDS, Match } from '../src/logic/match';
import { MemoryStore, Room, type Effect } from '../src/logic/room';

export const T0 = 1_000_000;

export class Socket {
  token: string | null = null;
  open = true;
  inbox: ServerMsg[] = [];
  /** The client's mirror, built from `start` and `inputs`. */
  mirror: Match | null = null;
  have = 0;
  you: Side | null = null;
  game = -1;
  /** A reloaded page's mirror: these inputs are applied right after the next `start` (as if it had them already). */
  preload: NetInput[] = [];
  constructor(readonly h: Harness, readonly name: string, readonly record = false) {}

  send(msg: ClientMsg | string): void {
    if (!this.open) throw new Error(`${this.name} is closed`);
    this.h.run(this.h.room.message(this.token, typeof msg === 'string' ? msg : JSON.stringify(msg)), this);
  }
  join(token: string | null = null, have = this.have): void {
    this.send({ t: 'join', token, have });
  }
  input(input: NetInput, id = 1): void {
    this.send({ t: 'input', id, input });
  }
  /** Drop the connection (no `leave`). */
  drop(): void {
    this.open = false;
    this.h.socketGone(this);
  }
  /** Messages since the last call. */
  take(): ServerMsg[] {
    const out = this.inbox;
    this.inbox = [];
    return out;
  }
  of<K extends ServerMsg['t']>(t: K): Extract<ServerMsg, { t: K }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMsg, { t: K }>[];
  }
  last<K extends ServerMsg['t']>(t: K): Extract<ServerMsg, { t: K }> | undefined {
    const all = this.of(t);
    return all[all.length - 1];
  }

  receive(msg: ServerMsg): void {
    this.inbox.push(msg);
    if (msg.t === 'welcome') {
      this.you = msg.you;
      this.token = msg.token;
    } else if (msg.t === 'start') {
      this.mirror?.dispose();
      this.mirror = new Match(msg.options, { record: this.record });
      this.have = 0;
      this.game = msg.game;
      for (const input of this.preload.splice(0)) {
        this.mirror.apply(input);
        this.have++;
      }
      if (msg.options.opponent.type === 'online') this.you = msg.options.opponent.you;
    } else if (msg.t === 'inputs') {
      msg.list.forEach((s, k) => {
        const n = msg.from + k;
        if (n < this.have) return; // already applied
        if (n > this.have) throw new Error(`${this.name} missed input ${this.have} (got ${n})`);
        const r = this.mirror!.apply(s.input);
        if (!r.ok) throw new Error(`${this.name}'s mirror refused a broadcast input (${r.reason}): ${JSON.stringify(s.input)}`);
        this.have++;
      });
    }
  }
}

export class Harness {
  now = T0;
  store = new MemoryStore();
  room: Room;
  sockets: Socket[] = [];
  destroyed = false;
  readonly random: () => number;

  constructor(seed = 1) {
    this.random = seeded(seed);
    let s = seed * 7919;
    let t = 0;
    this.room = this.makeRoom(() => (s = (s * 48271) % 2147483647), () => `tok${seed}-${t++}`);
  }

  private seedFn!: () => number;
  private tokenFn!: () => string;
  private makeRoom(seed: () => number, token: () => string): Room {
    this.seedFn = seed;
    this.tokenFn = token;
    return new Room({ store: this.store, now: () => this.now, random: this.random, seed, token });
  }

  /** The Durable Object went to sleep and woke up: a new Room from storage alone. */
  wake(): void {
    this.room = this.makeRoom(this.seedFn, this.tokenFn);
  }

  create(mode: PlayMode, you: Side = 'land'): { room: string; token: string; you: Side } {
    const options: GameOptions = { mode, opponent: { type: 'online', you }, time: { initialMs: 300000, incrementMs: 0 }, weirdMode: true };
    return this.room.create('ABCDEF', options)!;
  }

  connect(name: string, record = false): Socket {
    const s = new Socket(this, name, record);
    this.sockets.push(s);
    return s;
  }

  /** Create a room and seat two players; returns [creator, friend], game started. */
  pair(mode: PlayMode, creatorSide: Side = 'land', record = false): [Socket, Socket] {
    const res = this.create(mode, creatorSide);
    const a = this.connect('creator', record);
    a.join(res.token, 0);
    const b = this.connect('friend', record);
    b.join(null, 0);
    return [a, b];
  }

  run(effects: Effect[], from: Socket | null): void {
    for (const e of effects) {
      switch (e.kind) {
        case 'reply': from?.receive(e.msg); break;
        case 'send':
          for (const s of this.sockets) if (s.open && s.token === e.token) s.receive(e.msg);
          break;
        case 'bind':
          for (const s of this.sockets) if (s !== from && s.open && s.token === e.token) this.closeSocket(s);
          if (from) from.token = e.token;
          break;
        case 'close':
          if (from) this.closeSocket(from);
          break;
        case 'destroy':
          this.destroyed = true;
          for (const s of this.sockets) s.open = false;
          break;
      }
    }
  }

  private closeSocket(s: Socket): void {
    if (!s.open) return;
    s.open = false;
    this.socketGone(s);
  }

  socketGone(s: Socket): void {
    if (!s.token) return;
    if (this.sockets.some((o) => o !== s && o.open && o.token === s.token)) return;
    this.run(this.room.closed(s.token), null);
  }

  /** Move the fake clock on, firing the alarm whenever it's due (as the Durable Object would). */
  advance(ms: number): void {
    const end = this.now + ms;
    for (let guard = 0; guard < 1000; guard++) {
      const at = this.room.nextAlarm();
      if (at === null || at > end) break;
      this.now = Math.max(this.now, at);
      this.run(this.room.alarm(), null);
      if (this.destroyed) break;
    }
    this.now = end;
  }
}

/** A random legal input for whoever core is waiting on, read from a mirror (with some UI-style reads first). */
export function randomInput(m: Match, rnd: () => number): NetInput | NetInput[] | null {
  const need = m.need();
  if (!need) return null;
  if (rnd() < 0.002) return { k: 'resign', side: need.kind === 'throw' ? need.attacker : need.side };
  switch (need.kind) {
    case 'answer':
      return { k: 'duel', side: need.side, call: rnd() < 0.6 };
    case 'throw':
      return [need.defender, need.attacker].map((side) => ({ k: 'throw', side, hand: HANDS[Math.floor(rnd() * 3)] }));
    case 'turn':
    case 'bonus': {
      poke(m, rnd);
      if (m.arenaMode) {
        const all = arenaActions(m.arenaController!.raw, true);
        return { k: 'arena', side: need.side, action: all[Math.floor(rnd() * all.length)] };
      }
      const g = m.controller!;
      if (g.mode === 'classic') {
        // Random animal first, then one of its moves (asking every animal is slow with chess.js).
        const mine = g.pieces.filter((p) => p.side === need.side);
        for (let tries = 0; tries < 40 && mine.length; tries++) {
          const p = mine.splice(Math.floor(rnd() * mine.length), 1)[0];
          const to = g.legalTargets(p.square);
          if (to.length) return { k: 'act', side: need.side, input: { type: 'move', from: p.square, to: to[Math.floor(rnd() * to.length)] } };
        }
        return null;
      }
      const all = modeActions(g.modes.state).map((input): NetInput => ({ k: 'act', side: need.side, input }));
      return all.length ? all[Math.floor(rnd() * all.length)] : null;
    }
  }
}

/** The reads a screen makes while a player thinks. They must never change the game. */
function poke(m: Match, rnd: () => number): void {
  if (m.arenaMode) {
    const g = m.arenaController!;
    const mine = g.state.pieces.filter((p) => p.side === g.state.turn);
    const p = mine[Math.floor(rnd() * mine.length)];
    if (!p) return;
    const o = g.pieceOptions(p.id);
    g.targets({ pieceId: p.id, targets: [] });
    if (o.hits[0]) g.previewArea({ pieceId: p.id, hit: o.hits[0] });
    g.previewArea({ pieceId: p.id, targets: [] });
    g.shapeOptions?.();
    return;
  }
  const g = m.controller!;
  const mine = g.pieces.filter((p) => p.side === g.turn);
  const p = mine[Math.floor(rnd() * mine.length)];
  if (!p) return;
  g.legalTargets(p.square);
  if (g.mode !== 'classic') {
    g.powerInfo(p.id);
    const pending = { type: 'power' as const, pieceId: p.id, targets: [] };
    g.targets(pending);
    g.previewArea(pending);
    void g.modeState;
  }
}
