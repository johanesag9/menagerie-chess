/** The room's rules: joining, checking inputs, secret throws, timers, presence, rematch, hibernation and expiry. */
import { describe, expect, it } from 'vitest';
import type { NetInput } from '../../src/contracts/net';
import type { PlayMode, Side } from '../../src/contracts/types';
import { seeded } from '../../src/core/testUtils';
import { cleanInput, type Need } from '../src/logic/match';
import { CODE_ALPHABET, isCode, randomCode, TIMING } from '../src/logic/room';
import { Harness, randomInput, type Socket } from './harness';

const bySide = (a: Socket, b: Socket, side: Side) => (a.you === side ? a : b);

/** Play random legal inputs until `want` says stop (throws are sent but not looked at one by one). */
function playUntil(a: Socket, b: Socket, rnd: () => number, want: (n: Need) => boolean, max = 400): boolean {
  for (let n = 0; n < max; n++) {
    const need = a.mirror!.need();
    if (!need) return false;
    if (want(need)) return true;
    const pick = randomInput(a.mirror!, rnd);
    if (!pick) return false;
    for (const input of ([] as NetInput[]).concat(pick)) {
      if (input.k === 'resign') continue; // keep the game going
      bySide(a, b, input.side).input(input);
    }
  }
  return false;
}

/** A fresh room in `mode` that has reached a state `want` accepts (tries seeds until one does). */
function reach(mode: PlayMode, want: (n: Need) => boolean): { h: Harness; a: Socket; b: Socket } {
  for (let seed = 1; seed < 200; seed++) {
    const h = new Harness(seed);
    const [a, b] = h.pair(mode);
    if (playUntil(a, b, seeded(seed), want)) {
      a.take();
      b.take();
      return { h, a, b };
    }
  }
  throw new Error(`could not reach the wanted state in ${mode}`);
}

describe('room codes', () => {
  it('are 6 characters with no look-alikes', () => {
    for (const bad of '0O1Il') expect(CODE_ALPHABET).not.toContain(bad);
    for (let n = 0; n < 200; n++) expect(isCode(randomCode())).toBe(true);
    expect(isCode('ABC0EF')).toBe(false);
    expect(isCode('ABCDE')).toBe(false);
  });
});

describe('creating and joining', () => {
  it('creates a waiting room; the friend takes the other side and the game starts for both', () => {
    const h = new Harness();
    const res = h.create('sumo', 'sea');
    expect(res.you).toBe('sea');
    expect(h.room.info()).toEqual({ room: 'ABCDEF', mode: 'sumo', openSide: 'land', status: 'waiting' });

    const a = h.connect('creator');
    a.join(res.token);
    expect(a.last('welcome')).toMatchObject({ you: 'sea', token: res.token, opponent: 'waiting' });
    expect(a.of('start')).toEqual([]);

    const b = h.connect('friend');
    b.join(null);
    expect(b.last('welcome')).toMatchObject({ you: 'land', opponent: 'here', info: { openSide: null, status: 'playing' } });
    expect(b.inbox.map((m) => m.t)).toEqual(['welcome', 'start', 'presence']);
    expect(a.last('presence')).toEqual({ t: 'presence', opponent: 'here', msLeft: null });
    const sa = a.last('start')!;
    const sb = b.last('start')!;
    expect(sa.game).toBe(0);
    expect(sa.options.seed).toBe(sb.options.seed);
    expect(sa.options.opponent).toEqual({ type: 'online', you: 'sea' });
    expect(sb.options.opponent).toEqual({ type: 'online', you: 'land' });
    // The room forces untimed and Weird Mode off, whatever was asked for.
    expect(sa.options.time).toEqual({ initialMs: null, incrementMs: 0 });
    expect(sa.options.weirdMode).toBe(false);
    expect(h.room.info()!.status).toBe('playing');
  });

  it('refuses bad create options', () => {
    const h = new Harness();
    expect(() => h.room.create('ABCDEF', { mode: 'sumo', opponent: { type: 'local' } })).toThrow(/online/);
    expect(() => h.room.create('ABCDEF', { mode: 'chess960', opponent: { type: 'online', you: 'land' } })).toThrow(/mode/);
    expect(() => h.room.create('ABCDEF', { opponent: { type: 'online', you: 'purple' } })).toThrow(/you/);
    expect(h.room.exists()).toBe(false);
  });

  it('a taken code is refused (the Worker picks another)', () => {
    const h = new Harness();
    h.create('classic');
    expect(h.room.create('ABCDEF', { mode: 'classic', opponent: { type: 'online', you: 'land' } })).toBeNull();
  });

  it('a full room refuses a third player', () => {
    const h = new Harness();
    h.pair('classic');
    const c = h.connect('third');
    c.join(null);
    expect(c.last('error')).toEqual({ t: 'error', reason: 'This game is full' });
    expect(c.open).toBe(false);
  });

  it('an unknown token is refused', () => {
    const h = new Harness();
    h.pair('classic');
    const c = h.connect('stranger');
    c.join('not-a-token');
    expect(c.last('error')?.reason).toMatch(/someone else/);
    expect(c.open).toBe(false);
  });

  it('nothing but join works before joining', () => {
    const h = new Harness();
    h.create('classic');
    const c = h.connect('early');
    c.send({ t: 'rematch' });
    expect(c.last('error')).toEqual({ t: 'error', reason: 'Join first' });
  });

  it('rejoining with the token restores the side and sends only the missing inputs', () => {
    const h = new Harness();
    const [a, b] = h.pair('classic');
    a.input({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4' } });
    b.input({ k: 'act', side: 'sea', input: { type: 'move', from: 'e7', to: 'e5' } });
    a.input({ k: 'act', side: 'land', input: { type: 'move', from: 'g1', to: 'f3' } });
    const token = b.token!;
    b.drop();
    expect(a.last('presence')).toEqual({ t: 'presence', opponent: 'away', msLeft: TIMING.graceMs });

    // A reload: a new socket and a fresh mirror that had applied 2 inputs before.
    const b2 = h.connect('friend again');
    b2.preload = h.room.storedInputs.slice(0, 2).map((s) => s.input);
    b2.join(token, 2);
    expect(b2.last('welcome')).toMatchObject({ you: 'sea', token, opponent: 'here' });
    expect(b2.last('start')!.game).toBe(0);
    expect(b2.last('inputs')).toMatchObject({ from: 2, list: [{ input: { k: 'act', side: 'land' } }] });
    expect(a.last('presence')).toEqual({ t: 'presence', opponent: 'here', msLeft: null });

    // A brand-new mirror (have 0) gets everything.
    // Join order: welcome, start, inputs, presence (then timer, rematch).
    expect(b2.inbox.map((m) => m.t)).toEqual(['welcome', 'start', 'inputs', 'presence']);
    expect(b2.last('presence')).toEqual({ t: 'presence', opponent: 'here', msLeft: null });

    const b3 = h.connect('friend, third tab');
    b3.join(token, 0);
    expect(b3.last('inputs')!.list).toHaveLength(3);
    expect(b2.open).toBe(false); // replaced by the newer socket
    expect(b3.mirror!.fingerprint()).toBe(a.mirror!.fingerprint());
  });
});

describe('checking inputs', () => {
  it('refuses the wrong side, the wrong turn, illegal moves and junk, and broadcasts nothing', () => {
    const h = new Harness();
    const [a, b] = h.pair('classic'); // a = land
    a.take();
    b.take();
    a.input({ k: 'act', side: 'sea', input: { type: 'move', from: 'e7', to: 'e5' } }, 1);
    b.input({ k: 'act', side: 'sea', input: { type: 'move', from: 'e7', to: 'e5' } }, 2);
    a.input({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e5' } }, 3);
    a.send({ t: 'input', id: 4, input: { k: 'act', side: 'land', input: { type: 'move', from: 'z9', to: 'e4' } } as never });
    a.send({ t: 'input', id: 5, input: { k: 'arena', side: 'land', action: { type: 'endTurn' } } });
    a.send({ t: 'input', id: 6, input: { k: 'duel', side: 'land', call: true } });
    expect(a.of('reject').map((r) => [r.id, r.reason])).toEqual([
      [1, 'Not your side'], [3, 'Illegal move'], [4, 'Bad input'], [5, 'This is a chess mode'], [6, 'No duel to answer'],
    ]);
    expect(b.of('reject').map((r) => [r.id, r.reason])).toEqual([[2, 'Not your turn']]);
    expect(a.of('inputs')).toEqual([]);
    expect(b.of('inputs')).toEqual([]);
    expect(h.room.inputCount).toBe(0);

    a.input({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4' } }, 7);
    expect(b.last('inputs')).toEqual({ t: 'inputs', from: 0, list: [{ input: { k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4' } } }] });
    expect(a.last('inputs')).toEqual(b.last('inputs'));
  });

  it('party modes check turns too, and refuse chess inputs', () => {
    const h = new Harness();
    const [a, b] = h.pair('sumo');
    b.input({ k: 'arena', side: 'sea', action: { type: 'endTurn' } }, 1);
    a.input({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4' } }, 2);
    expect(b.last('reject')!.reason).toBe('Not your turn');
    expect(a.last('reject')!.reason).toBe('This is a party mode');
    a.input({ k: 'arena', side: 'land', action: { type: 'endTurn' } }, 3);
    expect(b.last('inputs')!.list).toHaveLength(1);
  });

  it('cleans inputs: unknown fields are dropped, bad shapes refused', () => {
    expect(cleanInput({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4', evil: 1 }, x: 2 }))
      .toEqual({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4' } });
    expect(cleanInput({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4', promotion: 'k' } })).toBeNull();
    expect(cleanInput({ k: 'arena', side: 'sea', action: { type: 'power', pieceId: 'x', targets: ['a1', 'a2', 'a3', 'a4', 'a5'] } })).toBeNull();
    expect(cleanInput({ k: 'throw', side: 'sea', hand: 'lizard' })).toBeNull();
    expect(cleanInput({ k: 'resign', side: 'moon' })).toBeNull();
  });

  it('drops oversized and broken messages', () => {
    const h = new Harness();
    const [a] = h.pair('classic');
    a.take();
    a.send('{"t":"emote","emote":"laugh","pad":"' + 'x'.repeat(9000) + '"}');
    a.send('{not json');
    expect(a.take()).toEqual([]);
  });

  it('relays emotes to both, with the sender\'s side', () => {
    const h = new Harness();
    const [a, b] = h.pair('classic');
    b.send({ t: 'emote', emote: 'taunt' });
    a.send({ t: 'emote', emote: 'nope' as never });
    expect(a.of('emote')).toEqual([{ t: 'emote', side: 'sea', emote: 'taunt' }]);
    expect(b.of('emote')).toEqual([{ t: 'emote', side: 'sea', emote: 'taunt' }]);
  });
});

describe('duels: the secret throw', () => {
  for (const mode of ['crazy', 'sumo'] as PlayMode[]) {
    it(`${mode}: the first throw is held; both go out together, attacker first`, () => {
      const { a, b } = reach(mode, (n) => n.kind === 'answer');
      const need = a.mirror!.need() as Extract<Need, { kind: 'answer' }>;
      const defender = need.side;
      const attacker: Side = defender === 'land' ? 'sea' : 'land';
      bySide(a, b, defender).input({ k: 'duel', side: defender, call: true });
      expect(a.mirror!.need()).toMatchObject({ kind: 'throw', attacker, defender });
      a.take();
      b.take();

      bySide(a, b, defender).input({ k: 'throw', side: defender, hand: 'rock' });
      expect(a.of('inputs')).toEqual([]);
      expect(b.of('inputs')).toEqual([]);
      // Changing your mind is fine until the other throw is in.
      bySide(a, b, defender).input({ k: 'throw', side: defender, hand: 'paper' });
      expect(a.of('inputs')).toEqual([]);

      bySide(a, b, attacker).input({ k: 'throw', side: attacker, hand: 'paper' });
      const sent = a.last('inputs')!;
      expect(sent.list.map((s) => s.input)).toEqual([
        { k: 'throw', side: attacker, hand: 'paper' },
        { k: 'throw', side: defender, hand: 'paper' },
      ]);
      expect(b.last('inputs')).toEqual(sent);
    });
  }

  it('a held throw survives the room hibernating', () => {
    const { h, a, b } = reach('crazy', (n) => n.kind === 'answer');
    const defender = (a.mirror!.need() as { side: Side }).side;
    const attacker: Side = defender === 'land' ? 'sea' : 'land';
    bySide(a, b, defender).input({ k: 'duel', side: defender, call: true });
    bySide(a, b, attacker).input({ k: 'throw', side: attacker, hand: 'scissors' });
    h.wake();
    a.take();
    bySide(a, b, defender).input({ k: 'throw', side: defender, hand: 'rock' });
    expect(a.last('inputs')!.list.map((s) => s.input)).toEqual([
      { k: 'throw', side: attacker, hand: 'scissors' },
      { k: 'throw', side: defender, hand: 'rock' },
    ]);
  });
});

describe('timers', () => {
  it('the turn timer starts on the mover\'s idle (or 5s after the last broadcast) and runs 60s', () => {
    const h = new Harness();
    const [a, b] = h.pair('classic'); // a = land, to move
    a.take();
    b.send({ t: 'idle', have: 0 }); // not the mover: ignored
    expect(a.of('timer')).toEqual([]);
    a.send({ t: 'idle', have: 0 });
    expect(b.last('timer')).toEqual({ t: 'timer', side: 'land', msLeft: TIMING.turnMs });
    a.send({ t: 'idle', have: 0 }); // only once
    expect(b.of('timer')).toHaveLength(1);

    a.input({ k: 'act', side: 'land', input: { type: 'move', from: 'd2', to: 'd4' } });
    expect(a.last('timer')).toEqual({ t: 'timer', side: null, msLeft: null }); // stopped until sea's screen is ready
    b.take();
    h.advance(TIMING.idleFallbackMs);
    expect(b.last('timer')).toEqual({ t: 'timer', side: 'sea', msLeft: TIMING.turnMs });
  });

  it('chess: time runs out -> a random legal move, flagged timeout', () => {
    const h = new Harness();
    const [a, b] = h.pair('normal');
    h.advance(TIMING.idleFallbackMs + TIMING.turnMs);
    const sent = b.last('inputs')!;
    expect(sent.list).toHaveLength(1);
    expect(sent.list[0]).toMatchObject({ auto: 'timeout', input: { k: 'act', side: 'land', input: { type: 'move' } } });
    expect(a.mirror!.need()).toEqual({ kind: 'turn', side: 'sea' });
  });

  it('classic too', () => {
    const h = new Harness();
    const [a] = h.pair('classic');
    h.advance(TIMING.idleFallbackMs + TIMING.turnMs);
    expect(a.last('inputs')!.list[0]).toMatchObject({ auto: 'timeout', input: { k: 'act', side: 'land' } });
  });

  it('party modes: time runs out -> the turn ends', () => {
    const h = new Harness();
    const [a] = h.pair('raid');
    h.advance(TIMING.idleFallbackMs + TIMING.turnMs - 1);
    expect(a.of('inputs')).toEqual([]);
    h.advance(1);
    expect(a.last('inputs')!.list).toEqual([{ input: { k: 'arena', side: 'land', action: { type: 'endTurn' } }, auto: 'timeout' }]);
    expect(a.mirror!.turn()).toBe('sea');
  });

  it('lucky 6: time runs out -> the bonus is skipped', () => {
    const { h, a } = reach('crazy', (n) => n.kind === 'bonus');
    const side = (a.mirror!.need() as { side: Side }).side;
    h.advance(TIMING.idleFallbackMs + TIMING.turnMs);
    expect(a.of('inputs')[0].list).toEqual([{ input: { k: 'act', side, input: { type: 'bonus', choice: 'skip' } }, auto: 'timeout' }]);
    expect(a.mirror!.need()).toEqual({ kind: 'turn', side });
  });

  it('duel answer: after 20s, no duel', () => {
    const { h, a } = reach('sumo', (n) => n.kind === 'answer');
    const side = (a.mirror!.need() as { side: Side }).side;
    h.advance(TIMING.idleFallbackMs);
    expect(a.last('timer')).toEqual({ t: 'timer', side, msLeft: TIMING.duelMs });
    h.advance(TIMING.duelMs);
    expect(a.of('inputs')[0].list).toEqual([{ input: { k: 'duel', side, call: false }, auto: 'timeout' }]);
  });

  it('throw: after 20s, a random hand for whoever hasn\'t thrown (and the timer changes hands)', () => {
    const { h, a, b } = reach('crazy', (n) => n.kind === 'answer');
    const defender = (a.mirror!.need() as { side: Side }).side;
    const attacker: Side = defender === 'land' ? 'sea' : 'land';
    bySide(a, b, defender).input({ k: 'duel', side: defender, call: true });
    bySide(a, b, attacker).send({ t: 'idle', have: h.room.inputCount });
    expect(a.last('timer')).toMatchObject({ side: attacker, msLeft: TIMING.duelMs });
    bySide(a, b, attacker).input({ k: 'throw', side: attacker, hand: 'rock' });
    expect(a.last('timer')).toMatchObject({ side: defender });
    a.take();
    h.advance(TIMING.duelMs);
    const list = a.of('inputs')[0].list;
    expect(list[0]).toEqual({ input: { k: 'throw', side: attacker, hand: 'rock' } });
    expect(list[1]).toMatchObject({ input: { k: 'throw', side: defender }, auto: 'timeout' });
  });

  it('throw: nobody throws -> both random', () => {
    const { h, a, b } = reach('sumo', (n) => n.kind === 'answer');
    const defender = (a.mirror!.need() as { side: Side }).side;
    bySide(a, b, defender).input({ k: 'duel', side: defender, call: true });
    a.take();
    h.advance(TIMING.idleFallbackMs + TIMING.duelMs);
    const list = a.of('inputs')[0].list;
    expect(list).toHaveLength(2);
    expect(list.every((s) => s.auto === 'timeout' && s.input.k === 'throw')).toBe(true);
  });
});

describe('presence', () => {
  it('away, the 2-minute grace, then a forfeit flagged left', () => {
    const h = new Harness();
    const [a, b] = h.pair('classic');
    a.send({ t: 'idle', have: 0 });
    b.drop();
    expect(a.last('presence')).toEqual({ t: 'presence', opponent: 'away', msLeft: TIMING.graceMs });
    a.input({ k: 'act', side: 'land', input: { type: 'move', from: 'e2', to: 'e4' } });
    a.take();
    // Sea's timer still runs while it's away (a random move for it after 65s).
    h.advance(TIMING.graceMs - 1);
    expect(a.of('inputs').flatMap((m) => m.list).every((s) => s.auto === 'timeout')).toBe(true);
    expect(h.room.info()!.status).toBe('playing');
    h.advance(1);
    expect(a.last('presence')).toEqual({ t: 'presence', opponent: 'left', msLeft: null });
    expect(a.last('inputs')!.list).toEqual([{ input: { k: 'resign', side: 'sea' }, auto: 'left' }]);
    expect(a.mirror!.over()).toEqual({ winner: 'land', reason: 'resign' });
    expect(h.room.info()!.status).toBe('over');
    expect(a.last('timer')).toEqual({ t: 'timer', side: null, msLeft: null });
  });

  it('coming back inside the grace cancels the forfeit', () => {
    const h = new Harness();
    const [a, b] = h.pair('sumo');
    const token = b.token!;
    b.drop();
    h.advance(60_000);
    h.connect('back').join(token, b.have);
    h.advance(TIMING.graceMs);
    expect(a.of('inputs').flatMap((m) => m.list).some((s) => s.auto === 'left')).toBe(false);
  });

  it('leaving on purpose resigns at once', () => {
    const h = new Harness();
    const [a, b] = h.pair('crazy');
    b.send({ t: 'leave' });
    expect(b.open).toBe(false);
    expect(a.last('inputs')!.list).toEqual([{ input: { k: 'resign', side: 'sea' }, auto: 'left' }]);
    expect(a.last('presence')!.opponent).toBe('left');
    expect(h.room.info()!.status).toBe('over');
  });

  it('a creator who drops while waiting does not forfeit; the game still starts when the friend joins', () => {
    const h = new Harness();
    const res = h.create('classic');
    const a = h.connect('creator');
    a.join(res.token);
    a.drop();
    h.advance(10 * 60_000);
    const b = h.connect('friend');
    b.join(null);
    expect(b.last('welcome')!.opponent).toBe('away');
    expect(b.last('presence')).toEqual({ t: 'presence', opponent: 'away', msLeft: TIMING.graceMs });
    expect(b.inbox.map((m) => m.t)).toEqual(['welcome', 'start', 'presence']);
  });
});

describe('rematch', () => {
  it('needs both; the new game swaps sides, with a new seed and game + 1', () => {
    const h = new Harness();
    const [a, b] = h.pair('raid'); // a = land
    const seed0 = a.last('start')!.options.seed;
    a.send({ t: 'rematch' }); // not over yet: ignored
    expect(b.of('rematch')).toEqual([]);
    a.input({ k: 'resign', side: 'land' });
    a.send({ t: 'rematch' });
    expect(b.last('rematch')).toEqual({ t: 'rematch', side: 'land' });
    expect(a.last('rematch')).toEqual({ t: 'rematch', side: 'land' });
    a.take();
    b.take();
    b.send({ t: 'rematch' });
    const sa = a.last('start')!;
    const sb = b.last('start')!;
    expect(sa.game).toBe(1);
    expect(sa.options.opponent).toEqual({ type: 'online', you: 'sea' });
    expect(sb.options.opponent).toEqual({ type: 'online', you: 'land' });
    expect(sa.options.seed).not.toBe(seed0);
    expect(h.room.info()!.status).toBe('playing');
    expect(h.room.inputCount).toBe(0);

    // The friend is Land now and moves first; the creator's old Land token now plays Sea.
    a.input({ k: 'arena', side: 'land', action: { type: 'endTurn' } }, 9);
    expect(a.last('reject')!.reason).toBe('Not your side');
    b.input({ k: 'arena', side: 'land', action: { type: 'endTurn' } });
    expect(a.last('inputs')!.list).toHaveLength(1);

    // Rejoining after the rematch: the token now gets Sea, and the whole new game.
    const token = a.token!;
    a.drop();
    const a2 = h.connect('creator again');
    a2.join(token, 0);
    expect(a2.last('welcome')!.you).toBe('sea');
    expect(a2.last('start')!.game).toBe(1);
  });

  it('a player who asked, dropped, and missed the new start gets it from input 0 on rejoin', () => {
    const h = new Harness();
    const [a, b] = h.pair('sumo'); // a = land
    for (let n = 0; n < 3; n++) bySide(a, b, a.mirror!.turn()).input({ k: 'arena', side: a.mirror!.turn(), action: { type: 'endTurn' } });
    a.input({ k: 'resign', side: 'land' });
    expect(a.have).toBe(4);
    a.send({ t: 'rematch' });
    const token = a.token!;
    a.drop();
    b.send({ t: 'rematch' }); // the new game starts while the creator is away
    expect(b.last('start')!.game).toBe(1);
    b.input({ k: 'arena', side: 'land', action: { type: 'endTurn' } }); // the friend is Land now
    const a2 = h.connect('creator again');
    a2.join(token, 4); // a stale count from the old game
    expect(a2.last('start')!.game).toBe(1);
    expect(a2.last('inputs')!.from).toBe(0);
    expect(a2.mirror!.fingerprint()).toBe(b.mirror!.fingerprint());
  });
});

describe('hibernation and expiry', () => {
  it('waking from storage gives the same game, timers and all', () => {
    const h = new Harness(3);
    const [a, b] = h.pair('crazy');
    playUntil(a, b, seeded(3), () => false, 40);
    const before = h.room.currentMatch!.fingerprint();
    const alarm = h.room.nextAlarm();
    h.wake();
    expect(h.room.currentMatch!.fingerprint()).toBe(before);
    expect(h.room.nextAlarm()).toBe(alarm);
    expect(h.room.info()!.status).not.toBe('waiting');
  });

  it('a room is deleted 24 hours after its last input', () => {
    const h = new Harness();
    const [a] = h.pair('classic');
    a.input({ k: 'resign', side: 'land' });
    h.advance(TIMING.expiryMs - 1);
    expect(h.destroyed).toBe(false);
    h.advance(1);
    expect(h.destroyed).toBe(true);
    expect(h.room.info()).toBeNull();
    expect(h.store.meta).toBeNull();
  });

  it('pings get a pong', () => {
    const h = new Harness();
    const [a] = h.pair('classic');
    a.take();
    a.send({ t: 'ping' });
    expect(a.take()).toEqual([{ t: 'pong' }]);
  });
});
