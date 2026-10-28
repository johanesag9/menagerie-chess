import { describe, expect, it } from 'vitest';
import type { BoardChange, PieceId, Side, Square } from '../../contracts/types';
import { sqIndex } from '../modes/state';
import { spinWheel } from './rules';
import type { ArenaGame } from './game';
import type { ArenaTuning } from './tuning';
import { END, arenaGame, at, hit, ok, pw, record, setBoard, step } from './testkit';

/** Put a treasure on the ground (`sq`) or in an animal's mouth (`carrier`). */
function treasure(g: ArenaGame, owner: Side, where: { sq?: Square; carrier?: PieceId }): void {
  const t = g.raw.treasures.find((x) => x.owner === owner)!;
  t.sq = where.sq ? sqIndex(where.sq) : null;
  t.carrier = where.carrier ?? null;
}
/**
 * Most tests below pin the first-version knobs (bone e1, pearl d8, 1 point a raid, tags send home, Land-only tide):
 * they check the mechanics, which the knobs only re-weight. "Raid: quick raids" covers the current defaults.
 */
const FIRST: Partial<ArenaTuning> = {
  treasureHomes: { land: 'e1', sea: 'd8' }, grabPoints: 0, scorePoints: 1, pointsToWin: 3, raidMaxRounds: 20, tagStuns: false, tideBothWays: false,
};
const firstRaid = () => arenaGame('raid', {}, FIRST);
const lastActed = (r: ReturnType<typeof record>) => r.events.filter(([n]) => n === 'acted').at(-1)![1] as { changes: BoardChange[] };

describe('Raid: set-up', () => {
  it('starts with both treasures at home, 3 points to win, 20 rounds, the wheel in 5', () => {
    const g = firstRaid();
    const s = g.state;
    expect(s.treasures).toEqual([
      { owner: 'land', home: 'e1', square: 'e1', carrier: null },
      { owner: 'sea', home: 'd8', square: 'd8', carrier: null },
    ]);
    expect(s.target).toBe(3);
    expect(s.maxRounds).toBe(20);
    expect(s.nextWheelIn).toBe(5);
    expect(s.nextSinkIn).toBeNull();
    expect(s.sunk).toEqual([]);
  });
});

describe('Raid: treasures', () => {
  it('stepping onto the enemy treasure picks it up for free; the carrier then steps for 2 AP and has no power', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', c7: 'land-n' });
    const r = record(g);
    ok(g, step('land-n-c7', 'd8'));
    expect(lastActed(r).changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-n-c7', from: 'c7', to: 'd8', how: 'step' },
      { step: 1, type: 'treasure', owner: 'sea', event: 'pickup', square: null, carrier: 'land-n-c7' },
    ]);
    expect(g.state.ap).toBe(3);
    expect(g.state.treasures[1]).toEqual({ owner: 'sea', home: 'd8', square: null, carrier: 'land-n-c7' });
    const o = g.pieceOptions('land-n-c7');
    expect(o.stepCost).toBe(2);
    expect(o.power).toMatchObject({ available: false, reason: 'wrongPhase' });
    ok(g, step('land-n-c7', 'd7'));
    expect(g.state.ap).toBe(1);
  });

  it('no guarding: you never stand on your own home; the enemy home is open only while its treasure lies there', () => {
    const g = firstRaid();
    setBoard(g, { d1: 'land-k', c8: 'sea-q', h8: 'sea-k', c7: 'land-n', e7: 'land-b' }, 'land', 10);
    expect(g.pieceOptions('land-k-d1').steps).not.toContain('e1');
    expect(g.pieceOptions('land-b-e7').steps).toContain('d8');
    ok(g, step('land-n-c7', 'd8'));
    ok(g, step('land-n-c7', 'd7'));
    expect(g.pieceOptions('land-b-e7').steps).not.toContain('d8');
    ok(g, END);
    expect(g.pieceOptions('sea-q-c8').steps).not.toContain('d8');
  });

  it('carrying it into your own half scores 1; the treasure goes home', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d5: 'land-n' });
    treasure(g, 'sea', { carrier: 'land-n-d5' });
    const r = record(g);
    ok(g, step('land-n-d5', 'd4'));
    expect(lastActed(r).changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-n-d5', from: 'd5', to: 'd4', how: 'step' },
      { step: 1, type: 'treasure', owner: 'sea', event: 'score', square: 'd8', carrier: null },
    ]);
    expect(g.state.score).toEqual({ land: 1, sea: 0 });
    expect(g.state.treasures[1]).toMatchObject({ square: 'd8', carrier: null });
  });

  it('a pickup inside your own half scores at once (pickup, then score)', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', b3: 'land-q' });
    treasure(g, 'sea', { sq: 'c3' });
    const r = record(g);
    ok(g, step('land-q-b3', 'c3'));
    expect(lastActed(r).changes.slice(1)).toEqual([
      { step: 1, type: 'treasure', owner: 'sea', event: 'pickup', square: null, carrier: 'land-q-b3' },
      { step: 2, type: 'treasure', owner: 'sea', event: 'score', square: 'd8', carrier: null },
    ]);
  });

  it('reaching 3 points wins: acted, logged, state (over), gameOver', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h1: 'sea-k', e4: 'sea-n' }, 'sea');
    g.raw.score.sea = 2;
    treasure(g, 'land', { carrier: 'sea-n-e4' });
    const r = record(g);
    ok(g, step('sea-n-e4', 'e5'));
    expect(r.names).toEqual(['acted', 'logged', 'state', 'gameOver']);
    expect(r.events.at(-1)![1]).toEqual({ winner: 'sea', reason: 'treasure' });
  });

  it('a dropped treasure: the enemy can pick it up again; its owner sends it straight home', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d2: 'land-p', f4: 'sea-n' }, 'sea');
    treasure(g, 'land', { sq: 'e3' });
    ok(g, step('sea-n-f4', 'e3'));
    expect(g.state.treasures[0]).toMatchObject({ square: null, carrier: 'sea-n-f4' });

    setBoard(g, { a1: 'land-k', h8: 'sea-k', d2: 'land-p' });
    treasure(g, 'land', { sq: 'e3' });
    const r = record(g);
    ok(g, step('land-p-d2', 'e3'));
    expect(lastActed(r).changes[1]).toEqual({ step: 1, type: 'treasure', owner: 'land', event: 'return', square: 'e1', carrier: null });
  });
});

describe('Raid: tags', () => {
  it('tag (1 AP): both animals in the tagger\'s own half; the enemy goes to the nearest free square of its back rank', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', e8: 'sea-k', d3: 'land-q', e4: 'sea-n', c4: 'land-b', c5: 'sea-p', b6: 'land-n', a7: 'sea-b' });
    expect(g.pieceOptions('land-q-d3')).toMatchObject({ hits: ['e4'], hitCosts: [1] });
    expect(g.pieceOptions('land-b-c4').hits).toEqual([]); // c5 is in Sea's half
    expect(g.pieceOptions('land-n-b6').hits).toEqual([]); // the tagger is in Sea's half
    expect(g.previewArea({ pieceId: 'land-q-d3', hit: 'e4' })).toEqual({ area: ['e4', 'f8'], falls: [] });
    const r = record(g);
    ok(g, hit('land-q-d3', 'e4'));
    // e8 is taken and d8 is Sea's own home, so f8.
    expect(lastActed(r).changes).toEqual([{ step: 0, type: 'move', pieceId: 'sea-n-e4', from: 'e4', to: 'f8', how: 'sentHome' }]);
    expect(g.state.ap).toBe(3);
  });

  it('sent home: ties on file distance go toward the centre', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d3: 'land-q', e4: 'sea-n', e8: 'sea-p' });
    ok(g, hit('land-q-d3', 'e4'));
    expect(at(g, 'sea-n-e4')).toBe('f8'); // d8 is Sea's home; f8 is next
    const g2 = firstRaid();
    setBoard(g2, { a1: 'land-k', a8: 'sea-k', b3: 'land-q', b4: 'sea-n', b8: 'sea-p' });
    ok(g2, hit('land-q-b3', 'b4'));
    expect(at(g2, 'sea-n-b4')).toBe('c8'); // a8 and c8 are both 1 away: toward the centre
  });

  it('a tagged carrier drops the treasure where it was tagged, then goes home', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d2: 'land-q', e3: 'sea-n' });
    treasure(g, 'land', { carrier: 'sea-n-e3' });
    g.raw.tokens.sea = 0;
    const r = record(g);
    ok(g, hit('land-q-d2', 'e3'));
    expect(lastActed(r).changes).toEqual([
      { step: 0, type: 'treasure', owner: 'land', event: 'drop', square: 'e3', carrier: null },
      { step: 1, type: 'move', pieceId: 'sea-n-e3', from: 'e3', to: 'e8', how: 'sentHome' },
    ]);
    expect(g.state.treasures[0]).toMatchObject({ square: 'e3', carrier: null });
  });

  it('only a carrier can duel a tag; a bonk spends the AP and keeps the treasure', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d2: 'land-q', e3: 'sea-n', c3: 'sea-p' });
    expect(g.act(hit('land-q-d2', 'c3'))).toEqual({ ok: true });
    treasure(g, 'land', { carrier: 'sea-n-e3' });
    const r = record(g);
    expect(g.act(hit('land-q-d2', 'e3'))).toEqual({ ok: true, pending: 'duel' });
    expect(r.events[0][1]).toMatchObject({ via: 'tag', victimId: 'sea-n-e3', defender: 'sea' });
    g.answerDuel(true);
    g.throwHand('land', 'scissors');
    g.throwHand('sea', 'rock');
    expect(r.names.slice(-3)).toEqual(['bonked', 'logged', 'state']);
    expect(at(g, 'sea-n-e3')).toBe('e3');
    expect(g.state.treasures[0].carrier).toBe('sea-n-e3');
    expect(g.state.ap).toBe(2);
  });
});

describe('Raid: powers', () => {
  it('Sidestep: one free step sideways (0 AP)', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d4: 'land-p', c4: 'sea-n' }, 'land', 2);
    expect(g.targets({ pieceId: 'land-p-d4', targets: [] }).squares).toEqual(['e4']);
    ok(g, pw('land-p-d4', 'e4'));
    expect(g.state.ap).toBe(2);
    expect(at(g, 'land-p-d4')).toBe('e4');
  });

  it('Double jump onto the enemy treasure picks it up', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d4: 'land-n' });
    const r = record(g);
    ok(g, pw('land-n-d4', 'e6', 'd8'));
    expect(lastActed(r).changes.map((c) => `${c.step}:${c.type}`)).toEqual(['0:move', '1:move', '2:treasure']);
    expect(g.state.treasures[1].carrier).toBe('land-n-d4');
  });

  it('Headbutt pushes one square; a carrier drops the treasure', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d3: 'land-b', d4: 'sea-n' });
    treasure(g, 'land', { carrier: 'sea-n-d4' });
    const r = record(g);
    ok(g, pw('land-b-d3', 'd4'));
    expect(lastActed(r).changes).toEqual([
      { step: 0, type: 'treasure', owner: 'land', event: 'drop', square: 'd4', carrier: null },
      { step: 1, type: 'move', pieceId: 'sea-n-d4', from: 'd4', to: 'd5', how: 'pushed' },
    ]);
  });

  it('Stomp stuns enemy neighbours (not the king) for their next turn', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', e5: 'sea-k', d4: 'land-r', c5: 'sea-n' });
    expect(g.previewArea({ pieceId: 'land-r-d4', targets: [] })).toEqual({ area: ['c5'], falls: [] });
    const r = record(g);
    ok(g, pw('land-r-d4'));
    expect(lastActed(r).changes).toEqual([{ step: 0, type: 'status', pieceId: 'sea-n-c5', status: 'stunned' }]);
    ok(g, END);
    expect(g.pieceOptions('sea-n-c5').steps).toEqual([]);
    expect(g.pieceOptions('sea-k-e5').steps.length).toBeGreaterThan(0);
    ok(g, END);
    expect(g.state.statuses).toEqual([]);
  });

  it('Block can\'t go on a home square or a treasure; Escape never lands on your own home', () => {
    const g = firstRaid();
    setBoard(g, { d2: 'land-k', h8: 'sea-k', a3: 'land-q' });
    treasure(g, 'land', { sq: 'c4' });
    const blocks = g.targets({ pieceId: 'land-q-a3', targets: [] }).squares;
    expect(blocks).not.toContain('e1');
    expect(blocks).not.toContain('d8');
    expect(blocks).not.toContain('c4');
    expect(g.targets({ pieceId: 'land-k-d2', targets: [] }).squares).not.toContain('e1');
  });
});

describe('Raid: the Wheel of Chaos', () => {
  it('spins at the start of Land\'s turn every 5 rounds: turnChanged, wheelSpun, logged, rolled, state', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k' }, 'sea');
    g.raw.round = 5;
    const r = record(g);
    ok(g, END);
    expect(r.names).toEqual(['logged', 'state', 'turnChanged', 'wheelSpun', 'logged', 'rolled', 'state']);
    expect(g.state.round).toBe(6);
    expect(g.state.nextWheelIn).toBe(5);
  });

  it('Tide sweeps Land animals in Sea\'s half back a rank (a carrier crossing home scores)', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', c5: 'land-n', d5: 'land-q', f6: 'land-b', f5: 'sea-p', b4: 'land-p' });
    treasure(g, 'sea', { carrier: 'land-q-d5' });
    const w = spinWheel(g.raw, 'tide');
    expect(w.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-n-c5', from: 'c5', to: 'c4', how: 'swept' },
      { step: 0, type: 'move', pieceId: 'land-q-d5', from: 'd5', to: 'd4', how: 'swept' },
      { step: 1, type: 'treasure', owner: 'sea', event: 'score', square: 'd8', carrier: null },
    ]);
    expect(at(g, 'land-b-f6')).toBe('f6');
    expect(g.state.score.land).toBe(1);
  });

  it('Pigeon grabs a carried or dropped treasure and drops it on a random empty square, else flies past', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', c5: 'land-n' });
    expect(spinWheel(g.raw, 'pigeon').changes).toEqual([]);
    treasure(g, 'sea', { carrier: 'land-n-c5' });
    const w = spinWheel(g.raw, 'pigeon');
    expect(w.changes).toHaveLength(1);
    const c = w.changes[0] as Extract<BoardChange, { type: 'treasure' }>;
    expect(c).toMatchObject({ step: 0, type: 'treasure', owner: 'sea', event: 'snatch', carrier: null });
    expect(['e1', 'd8', 'a1', 'h8', 'c5']).not.toContain(c.square);
    expect(['5', '6', '7']).toContain(c.square![1]); // the pearl's owner (Sea) half, never the back rank
    expect(g.state.treasures[1]).toMatchObject({ square: c.square, carrier: null });
  });

  it('Earthquake shifts every animal one file; Disco recharges every power', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k', c5: 'land-n', d5: 'sea-n' });
    const before = new Map(g.state.pieces.map((p) => [p.id, p.square]));
    const w = spinWheel(g.raw, 'earthquake');
    const dir = w.direction === 'left' ? -1 : 1;
    for (const p of g.state.pieces) {
      const was = before.get(p.id)!;
      const want = String.fromCharCode(was.charCodeAt(0) + dir) + was[1];
      if (want[0] >= 'a' && want[0] <= 'h') expect([want, was]).toContain(p.square);
      else expect(p.square).toBe(was);
    }
    expect(w.changes.every((c) => c.type === 'move' && c.how === 'quake')).toBe(true);
    g.raw.powersUsed = ['land-n-c5'];
    const d = spinWheel(g.raw, 'disco');
    expect(d.changes).toEqual([{ step: 0, type: 'recharge', pieceIds: ['land-n-c5'] }]);
    expect(g.state.powersUsed).toEqual([]);
  });
});

describe('Raid: round cap', () => {
  it('after round 20 more points wins, else a draw', () => {
    const g = firstRaid();
    setBoard(g, { a1: 'land-k', h8: 'sea-k' }, 'sea');
    g.raw.round = 20;
    g.raw.score = { land: 1, sea: 2 };
    const r = record(g);
    ok(g, END);
    expect(r.events.at(-1)).toEqual(['gameOver', { winner: 'sea', reason: 'rounds' }]);

    const g2 = firstRaid();
    setBoard(g2, { a1: 'land-k', h8: 'sea-k' }, 'sea');
    g2.raw.round = 20;
    const r2 = record(g2);
    ok(g2, END);
    expect(r2.events.at(-1)).toEqual(['gameOver', { winner: null, reason: 'rounds' }]);
  });
});

describe('Raid: quick raids (current defaults)', () => {
  it('treasures at e3 and d6, 5 points to win, 12 rounds', () => {
    const s = arenaGame('raid').state;
    expect(s.treasures.map((t) => [t.home, t.square])).toEqual([['e3', 'e3'], ['d6', 'd6']]);
    expect(s.target).toBe(5);
    expect(s.maxRounds).toBe(12);
  });

  it('grabbing from home scores 1, carrying it into your own half 2 more; a dropped treasure scores no grab', () => {
    const g = arenaGame('raid');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d5: 'land-n' }, 'land', 10);
    const r = record(g);
    ok(g, step('land-n-d5', 'd6'));
    expect(lastActed(r).changes.at(-1)).toMatchObject({ type: 'treasure', event: 'pickup', carrier: 'land-n-d5' });
    expect(g.state.score).toEqual({ land: 1, sea: 0 });
    ok(g, step('land-n-d5', 'd5'));
    ok(g, step('land-n-d5', 'd4'));
    expect(g.state.score).toEqual({ land: 3, sea: 0 });
    expect(g.state.treasures[1].square).toBe('d6');

    const g2 = arenaGame('raid');
    setBoard(g2, { a1: 'land-k', h8: 'sea-k', b5: 'land-n' });
    treasure(g2, 'sea', { sq: 'c5' });
    ok(g2, step('land-n-b5', 'c5'));
    expect(g2.state.score.land).toBe(0);
  });

  it('a score that passes the target still wins', () => {
    const g = arenaGame('raid');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d5: 'land-n' }, 'land', 10);
    treasure(g, 'sea', { carrier: 'land-n-d5' });
    g.raw.score.land = 4;
    const r = record(g);
    ok(g, step('land-n-d5', 'd4'));
    expect(g.state.score.land).toBe(6);
    expect(r.events.at(-1)).toEqual(['gameOver', { winner: 'land', reason: 'treasure' }]);
  });

  it('a tag stuns an animal that isn\'t carrying, where it stands; it can\'t be tagged again and skips its next turn', () => {
    const g = arenaGame('raid');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d3: 'land-q', e4: 'sea-n', c2: 'land-b' });
    const r = record(g);
    ok(g, hit('land-q-d3', 'e4'));
    expect(lastActed(r).changes).toEqual([{ step: 0, type: 'status', pieceId: 'sea-n-e4', status: 'stunned' }]);
    expect(at(g, 'sea-n-e4')).toBe('e4');
    expect(g.state.statuses).toEqual([{ pieceId: 'sea-n-e4', status: 'stunned', turnsLeft: 1 }]);
    expect(g.state.ap).toBe(3);
    expect(g.pieceOptions('land-q-d3').hits).toEqual([]);
    ok(g, END);
    expect(g.pieceOptions('sea-n-e4').steps).toEqual([]);
    ok(g, END);
    expect(g.state.statuses).toEqual([]);
    expect(g.pieceOptions('land-q-d3').hits).toEqual(['e4']);
  });

  it('a tagged carrier is still sent home and drops the treasure', () => {
    const g = arenaGame('raid');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d3: 'land-q', e4: 'sea-n' });
    treasure(g, 'land', { carrier: 'sea-n-e4' });
    g.raw.tokens.sea = 0;
    ok(g, hit('land-q-d3', 'e4'));
    expect(at(g, 'sea-n-e4')).toBe('e8');
    expect(g.state.treasures[0]).toMatchObject({ square: 'e4', carrier: null });
    expect(g.state.statuses).toEqual([]);
  });

  it('the tide sweeps both sides back toward their own half', () => {
    const g = arenaGame('raid');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', c5: 'land-n', f4: 'sea-q', f3: 'sea-b', b4: 'land-p' });
    const w = spinWheel(g.raw, 'tide');
    expect(w.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-n-c5', from: 'c5', to: 'c4', how: 'swept' },
      { step: 0, type: 'move', pieceId: 'sea-q-f4', from: 'f4', to: 'f5', how: 'swept' },
      { step: 0, type: 'move', pieceId: 'sea-b-f3', from: 'f3', to: 'f4', how: 'swept' },
    ]);
  });
});
