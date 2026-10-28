import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg, OnlineEventMap, ServerMsg } from '../contracts/net';
import type { GameEventMap, GameOptions, PlayMode, Side } from '../contracts/types';
import { MenagerieGame } from '../core/controller';
import type { TokenStore } from './client';
import { FakeServer } from './fakeServer';
import { createOnlineWith } from './index';
import type { SocketLike, Transport } from './transport';

const now = () => Date.now();
const flush = (ms = 20) => vi.advanceTimersByTimeAsync(ms);

function memStore(): TokenStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const opts = (mode: PlayMode, you: Side = 'land'): GameOptions => ({
  mode, opponent: { type: 'online', you }, time: { initialMs: 300_000, incrementMs: 0 }, weirdMode: true,
});

/** Records the named events of an EventSource. */
function record<M>(src: { on<K extends keyof M>(n: K, fn: (p: M[K]) => void): unknown }, names: (keyof M)[]) {
  const log: { name: keyof M; payload: unknown }[] = [];
  for (const n of names) src.on(n, (p) => log.push({ name: n, payload: p }));
  return { log, names: () => log.map((e) => e.name), count: (n: keyof M) => log.filter((e) => e.name === n).length };
}

async function setup(mode: PlayMode = 'classic', serverOpts: ConstructorParameters<typeof FakeServer>[0] = {}) {
  const server = new FakeServer({ latencyMs: 0, now, ...serverOpts });
  const ta = server.transport();
  const tb = server.transport();
  const sa = memStore();
  const sb = memStore();
  const a = createOnlineWith({ transport: ta, storage: sa, now, origin: 'http://test' });
  const b = createOnlineWith({ transport: tb, storage: sb, now, origin: 'http://test' });
  const created = a.createRoom(opts(mode));
  await flush();
  const { room, link } = await created;
  const joined = b.join(room);
  await flush();
  await joined;
  await flush(500);
  return { server, a, b, ta, tb, sa, sb, room, link };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('rooms', () => {
  it('creates a room, stores the token and gives an invite link', async () => {
    const { a, b, sa, room, link } = await setup();
    expect(room).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(link).toBe(`http://test/?room=${room}`);
    expect(sa.map.get(`mc.online.${room}`)).toBeTruthy();
    expect(a.you).toBe('land');
    expect(b.you).toBe('sea');
    expect(a.connection).toBe('online');
  });

  it('roomInfo gives the open side, and null for an unknown room', async () => {
    const server = new FakeServer({ latencyMs: 0, now });
    const a = createOnlineWith({ transport: server.transport(), storage: memStore(), now });
    const c = a.createRoom(opts('sumo', 'sea'));
    await flush();
    const { room } = await c;
    const info = a.roomInfo(room);
    const none = a.roomInfo('ZZZZZZ');
    await flush();
    expect(await info).toEqual({ room, mode: 'sumo', openSide: 'land', status: 'waiting' });
    expect(await none).toBeNull();
  });

  it('a third player is refused', async () => {
    const { server, room } = await setup();
    const c = createOnlineWith({ transport: server.transport(), storage: memStore(), now });
    const errors = record<OnlineEventMap>(c, ['error']);
    const j = c.join(room);
    j.catch(() => {});
    await flush();
    await expect(j).rejects.toThrow('This game is full');
    expect(errors.count('error')).toBe(1);
    expect(c.connection).toBe('offline');
  });
});

describe('mirror and proxies', () => {
  it('reads come from the mirror (same seed, forced untimed, no Weird Mode)', async () => {
    const { a, b, server, room } = await setup('classic');
    const ref = new MenagerieGame();
    const real = server.room(room)!;
    ref.newGame(real.options);
    expect(a.game.pieces).toEqual(ref.pieces);
    expect(a.game.fen).toBe(ref.fen);
    expect(b.game.turn).toBe('land');
    expect(a.mirror!.options.time.initialMs).toBeNull();
    expect(a.mirror!.options.weirdMode).toBe(false);
    expect(a.mirror!.options.seed).toBe(b.mirror!.options.seed);
  });

  it('actions send and do not apply until the room broadcasts them', async () => {
    const { a, b } = await setup('classic');
    const ea = record<GameEventMap>(a.game, ['moved']);
    const eb = record<GameEventMap>(b.game, ['moved']);
    const before = a.game.fen;
    expect(a.game.act({ type: 'move', from: 'e2', to: 'e4' })).toEqual({ ok: true });
    expect(a.game.fen).toBe(before);
    expect(ea.count('moved')).toBe(0);
    await flush();
    expect(ea.count('moved')).toBe(1);
    expect(eb.count('moved')).toBe(1);
    expect(b.game.fen).toBe(a.game.fen);
    expect(a.game.turn).toBe('sea');
  });

  it("refuses locally what isn't yours, and hides the friend's moves", async () => {
    const { a, b } = await setup('normal');
    expect(b.game.act({ type: 'move', from: 'e7', to: 'e5' })).toEqual({ ok: false, reason: 'Not your turn' });
    expect(b.game.legalTargets('e2')).toEqual([]); // Land's pawn, seen by Sea
    expect(a.game.legalTargets('e2')).toEqual(['e3', 'e4']);
    const pawn = a.game.pieces.find((p) => p.square === 'e2')!;
    expect(b.game.powerInfo(pawn.id).available).toBe(false);
    expect(a.game.act({ type: 'move', from: 'e2', to: 'e5' })).toEqual({ ok: false, reason: 'Illegal move' });
  });

  it('the room refuses the wrong side and illegal inputs (reject -> rejected)', async () => {
    const { a } = await setup('classic');
    const ev = record<OnlineEventMap>(a, ['rejected']);
    a.sendInput({ k: 'act', side: 'sea', input: { type: 'move', from: 'e7', to: 'e5' } });
    a.sendInput({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e5' } });
    await flush();
    expect(ev.log.map((e) => (e.payload as { reason: string }).reason)).toEqual(['Not your side', 'Illegal move']);
    expect(a.mirror!.applied).toBe(0);
  });

  it('party modes: actions go through the arena proxy', async () => {
    const { a, b } = await setup('sumo');
    expect(a.arena.state.mode).toBe('sumo');
    const seaPiece = a.arena.state.pieces.find((p) => p.side === 'sea')!;
    expect(a.arena.pieceOptions(seaPiece.id).steps).toEqual([]);
    expect(b.arena.act({ type: 'endTurn' })).toEqual({ ok: false, reason: 'Not your turn' });
    expect(a.arena.act({ type: 'endTurn' })).toEqual({ ok: true });
    await flush();
    expect(a.arena.state.turn).toBe('sea');
    expect(b.arena.state).toEqual(a.arena.state);
  });
});

/** A transport whose socket the test drives by hand. */
function manualTransport() {
  const sockets: (SocketLike & { sent: ClientMsg[]; push(m: ServerMsg): void; open(): void })[] = [];
  const t: Transport = {
    request: async () => ({ status: 404, body: null }),
    connect: () => {
      const s = {
        onopen: null, onmessage: null, onclose: null, sent: [] as ClientMsg[],
        send(d: string) { s.sent.push(JSON.parse(d)); },
        close() { s.onclose?.(); },
        push(m: ServerMsg) { s.onmessage?.(JSON.stringify(m)); },
        open() { s.onopen?.(); },
      } as SocketLike & { sent: ClientMsg[]; push(m: ServerMsg): void; open(): void };
      sockets.push(s);
      return s;
    },
  };
  return { t, sockets };
}

const CLASSIC: GameOptions = { mode: 'classic', opponent: { type: 'online', you: 'sea' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed: 7 };
const info = { room: 'ABCDEF', mode: 'classic' as const, openSide: null, status: 'playing' as const };
const mv = (side: Side, from: string, to: string) => ({ input: { k: 'act' as const, side, input: { type: 'move' as const, from, to } } }) as never;

describe('inputs', () => {
  it('apply in order; duplicates are dropped; a gap rebuilds from the full list', async () => {
    const { t, sockets } = manualTransport();
    const c = createOnlineWith({ transport: t, storage: memStore(), now });
    const moved = record<GameEventMap>(c.game, ['moved']);
    const j = c.join('ABCDEF');
    const s = sockets[0];
    s.open();
    expect(s.sent[0]).toEqual({ t: 'join', token: null, have: 0 });
    s.push({ t: 'welcome', you: 'sea', token: 'tok', info, opponent: 'here' });
    await j;
    s.push({ t: 'start', game: 0, options: CLASSIC });
    s.push({ t: 'inputs', from: 0, list: [] });
    s.push({ t: 'presence', opponent: 'here', msLeft: null }); // ends the catch-up: a fresh game starts with its events
    s.push({ t: 'inputs', from: 0, list: [mv('land', 'e2', 'e4')] });
    s.push({ t: 'inputs', from: 0, list: [mv('land', 'e2', 'e4'), mv('sea', 'e7', 'e5')] });
    expect(moved.log.map((e) => (e.payload as { san: string }).san)).toEqual(['e4', 'e5']);
    expect(c.mirror!.applied).toBe(2);

    s.push({ t: 'inputs', from: 5, list: [mv('land', 'g1', 'f3')] });
    expect(sockets).toHaveLength(2); // closed and joined again, asking for everything
    sockets[1].open();
    expect(sockets[1].sent[0]).toEqual({ t: 'join', token: 'tok', have: 0 });
    c.dispose();
  });

  it('auto inputs fire `auto` just before they apply', async () => {
    const { a, b, server, room } = await setup('classic');
    const seen: string[] = [];
    b.on('auto', (e) => seen.push(`auto:${e.side}:${e.why}`));
    b.game.on('moved', (m) => seen.push(`moved:${m.side}`));
    server.forceTimeout(room);
    await flush();
    expect(seen).toEqual(['auto:land:timeout', 'moved:land']);
    expect(a.game.turn).toBe('sea');
  });
});

describe('duels', () => {
  /** Crazy (duels are Crazy-only), 1.e4 d5 2.exd5: Sea may duel for its pawn. Seed 5 rolls no 1s or 6s for these. */
  async function toDuel() {
    const env = await setup('crazy', { seed: () => 5 });
    const { a, b } = env;
    a.game.act({ type: 'move', from: 'e2', to: 'e4' });
    await flush();
    b.game.act({ type: 'move', from: 'd7', to: 'd5' });
    await flush();
    const offered = record<GameEventMap>(b.game, ['duelOffered']);
    expect(a.game.act({ type: 'move', from: 'e4', to: 'd5' })).toEqual({ ok: true });
    await flush();
    expect(offered.count('duelOffered')).toBe(1);
    return env;
  }

  it('the first throw stays secret until the second arrives; then both go out, attacker first', async () => {
    const { a, b, server, room } = await toDuel();
    a.game.answerDuel(true); // not Land's to answer
    await flush();
    expect(server.received.some((r) => r.msg.t === 'input')).toBe(true);
    const inputsBefore = server.received.filter((r) => r.msg.t === 'input').length;
    a.game.answerDuel(true);
    await flush();
    expect(server.received.filter((r) => r.msg.t === 'input').length).toBe(inputsBefore); // refused locally

    b.game.answerDuel(true);
    await flush();
    const rounds = record<GameEventMap>(a.game, ['duelRound']);
    const roundsB = record<GameEventMap>(b.game, ['duelRound']);
    const mark = server.sent.length;
    b.game.throwHand('sea', 'paper'); // the defender throws first
    b.game.throwHand('sea', 'rock'); // a second throw this round is refused locally
    await flush();
    const leaked = server.sent.slice(mark).filter((s) => s.room === room && s.msg.t === 'inputs');
    expect(leaked).toEqual([]);
    expect(roundsB.count('duelRound')).toBe(0);

    a.game.throwHand('land', 'rock');
    await flush();
    const out = server.sent.slice(mark).filter((s) => s.msg.t === 'inputs').map((s) => s.msg as Extract<ServerMsg, { t: 'inputs' }>);
    expect(out).toHaveLength(2); // one message to each side
    expect(out[0].list.map((x) => x.input)).toEqual([
      { k: 'throw', side: 'land', hand: 'rock' },
      { k: 'throw', side: 'sea', hand: 'paper' },
    ]);
    expect(rounds.log[0].payload).toMatchObject({ attackerHand: 'rock', defenderHand: 'paper', result: 'defender' });
    expect(roundsB.log[0].payload).toEqual(rounds.log[0].payload);
    expect(a.game.fen).toBe(b.game.fen);
  });

  it('a slow duel answer times out to no duel', async () => {
    const { a, b, server, room } = await toDuel();
    const auto = record<OnlineEventMap>(a, ['auto']);
    const ended = record<GameEventMap>(a.game, ['duelEnded']);
    server.forceTimeout(room);
    await flush();
    expect(auto.log[0].payload).toEqual({ side: 'sea', why: 'timeout' });
    expect(ended.log[0].payload).toMatchObject({ called: false, winner: 'attacker' });
    expect(b.game.fen).toBe(a.game.fen);
  });
});

describe('duel timeouts', () => {
  it('a slow thrower gets a random hand; the pair still goes out attacker first', async () => {
    const env = await setup('crazy', { seed: () => 5 });
    const { a, b, server, room } = env;
    for (const [c, from, to] of [[a, 'e2', 'e4'], [b, 'd7', 'd5'], [a, 'e4', 'd5']] as const) {
      c.game.act({ type: 'move', from, to });
      await flush();
    }
    b.game.answerDuel(true);
    await flush();
    const mark = server.sent.length;
    b.game.throwHand('sea', 'scissors');
    await flush();
    server.forceTimeout(room); // Land never throws
    await flush();
    const out = server.sent.slice(mark).find((s) => s.side === 'land' && s.msg.t === 'inputs')!.msg as Extract<ServerMsg, { t: 'inputs' }>;
    expect(out.list.map((x) => [x.input.side, x.auto ?? null])).toEqual([['land', 'timeout'], ['sea', null]]);
    expect(a.game.fen).toBe(b.game.fen);
  });
});

describe('leaving and emotes', () => {
  it('leave() resigns now and the friend sees "left"', async () => {
    const { a, b, sb, room } = await setup('sumo');
    const over = record<GameEventMap>(a.game, ['gameOver']);
    const arenaOver: unknown[] = [];
    a.arena.on('gameOver', (g) => arenaOver.push(g));
    const on = record<OnlineEventMap>(a, ['auto', 'presence']);
    b.leave();
    await flush();
    expect(b.connection).toBe('offline');
    expect(sb.map.has(`mc.online.${room}`)).toBe(false);
    expect(on.log.map((e) => e.payload)).toEqual([{ side: 'sea', why: 'left' }, { opponent: 'left', graceEndsAt: null }]);
    expect(arenaOver).toEqual([{ winner: 'land', reason: 'resign' }]);
    expect(over.log).toEqual([]); // the chess proxy stays quiet in a party mode
  });

  it('emotes go to both screens', async () => {
    const { a, b } = await setup('classic');
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    a.on('emote', (e) => seenA.push(e));
    b.game.on('emote', (e) => seenB.push(e));
    a.game.sendEmote('sea', 'laugh'); // not yours: ignored
    a.game.sendEmote('land', 'love');
    await flush();
    expect(seenA).toEqual([{ side: 'land', emote: 'love' }]);
    expect(seenB).toEqual([{ side: 'land', emote: 'love' }]);
  });
});

describe('rejoin', () => {
  it('a reload catches up silently, then emits started and resync', async () => {
    const { a, b, server, sb, room } = await setup('classic');
    for (const [c, from, to] of [[a, 'e2', 'e4'], [b, 'e7', 'e5'], [a, 'g1', 'f3']] as const) {
      c.game.act({ type: 'move', from, to });
      await flush();
    }
    b.dispose(); // the page went away
    const b2 = createOnlineWith({ transport: server.transport(), storage: sb, now });
    const ev = record<GameEventMap>(b2.game, ['gameStarted', 'moved', 'turnChanged']);
    const on = record<OnlineEventMap>(b2, ['started', 'resync', 'connection']);
    const j = b2.join(room);
    await flush();
    expect(await j).toMatchObject({ you: 'sea' });
    expect(ev.log).toEqual([]);
    expect(on.names()).toEqual(['connection', 'connection', 'started', 'resync']);
    expect(b2.game.fen).toBe(a.game.fen);
    expect(b2.game.history).toHaveLength(3);
    // and play goes on with events again
    b2.game.act({ type: 'move', from: 'b8', to: 'c6' });
    await flush();
    expect(ev.count('moved')).toBe(1);
  });

  it('reconnects after a drop and catches up on what it missed', async () => {
    const { a, b, tb } = await setup('classic', { timeScale: 1 });
    const pres = record<OnlineEventMap>(a, ['presence']);
    const conn = record<OnlineEventMap>(b, ['connection', 'resync']);
    tb.offline = true;
    tb.drop();
    await flush();
    expect(b.connection).toBe('reconnecting');
    const away = pres.log.at(-1)!.payload as OnlineEventMap['presence'];
    expect(away.opponent).toBe('away');
    expect(away.graceEndsAt! - now()).toBeGreaterThan(110_000);

    a.game.act({ type: 'move', from: 'd2', to: 'd4' });
    await flush(3000); // retries fail while offline
    expect(b.game.turn).toBe('land');
    tb.offline = false;
    await flush(8000);
    expect(b.connection).toBe('online');
    expect(conn.names()).toEqual(['connection', 'connection', 'resync']);
    expect(b.game.fen).toBe(a.game.fen);
    expect((pres.log.at(-1)!.payload as OnlineEventMap['presence']).opponent).toBe('here');
  });

  it('a friend who stays away past the grace resigns', async () => {
    const { a, tb, server } = await setup('classic');
    server.timeScale = 0.001; // turn timers (60ms) still run first and move for both
    const over = record<GameEventMap>(a.game, ['gameOver']);
    const auto = record<OnlineEventMap>(a, ['auto', 'presence']);
    tb.offline = true;
    tb.drop();
    await flush(500);
    expect(auto.log.filter((e) => e.name === 'auto').at(-1)?.payload).toEqual({ side: 'sea', why: 'left' });
    expect(over.log[0].payload).toEqual({ winner: 'land', reason: 'resign' });
    expect((auto.log.filter((e) => e.name === 'presence').at(-1)!.payload as OnlineEventMap['presence']).opponent).toBe('left');
  });
});

describe('idle and timers', () => {
  it('resume() sends idle once per new count', async () => {
    const { a, b, server } = await setup('classic');
    const idles = () => server.received.filter((r) => r.msg.t === 'idle' && r.side === 'land').map((r) => (r.msg as { have: number }).have);
    a.game.resume();
    a.game.resume();
    a.game.pause();
    a.game.resume();
    await flush();
    expect(idles()).toEqual([0]);
    a.game.act({ type: 'move', from: 'e2', to: 'e4' });
    await flush();
    a.game.resume();
    b.game.resume();
    await flush();
    expect(idles()).toEqual([0, 1]);
  });

  it("the mover's idle starts the turn timer; the HUD gets a local endsAt", async () => {
    const { a, b } = await setup('classic');
    const t = record<OnlineEventMap>(b, ['timer']);
    b.game.resume(); // not Sea's turn: no timer
    await flush();
    expect(t.log).toEqual([]);
    a.game.resume();
    await flush();
    const ev = t.log.at(-1)!.payload as OnlineEventMap['timer'];
    expect(ev.side).toBe('land');
    expect(ev.endsAt! - now()).toBeGreaterThan(59_000);
  });
});

describe('rematch', () => {
  it("the proxies' listeners survive a rematch, and sides swap", async () => {
    const { a, b } = await setup('classic');
    const starts = record<GameEventMap>(a.game, ['gameStarted', 'gameOver']);
    const onB = record<OnlineEventMap>(b, ['rematch', 'started']);
    a.game.resign('sea'); // the argument is ignored: you can only resign yourself
    await flush();
    expect(starts.log.at(-1)!.payload).toEqual({ winner: 'sea', reason: 'resign' });
    a.askRematch();
    await flush();
    expect(onB.log[0].payload).toEqual({ side: 'land' });
    b.askRematch();
    await flush();
    expect(starts.count('gameStarted')).toBe(1);
    expect(onB.log.at(-1)!.payload).toMatchObject({ game: 1, you: 'land' });
    expect(a.you).toBe('sea');
    expect(b.you).toBe('land');
    expect(b.game.act({ type: 'move', from: 'e2', to: 'e4' })).toEqual({ ok: true });
    await flush();
    expect(a.game.history).toHaveLength(1);
  });
});
