import { describe, expect, it } from 'vitest';
import type { BoardChange } from '../../contracts/types';
import { sqIndex } from '../modes/state';
import { END, arenaGame, at, hit, id, ok, pw, record, setBoard, step } from './testkit';

const KINGS = { d4: 'land-k', e5: 'sea-k' } as const;

describe('Sumo: set-up and turns', () => {
  it('starts with 6 animals a side on ranks 2 and 7, in the spec order, with stable ids', () => {
    const g = arenaGame('sumo');
    const ids = g.state.pieces.map((p) => p.id).sort();
    expect(ids).toEqual([
      'land-b-c2', 'land-k-e2', 'land-n-b2', 'land-p-g2', 'land-q-d2', 'land-r-f2',
      'sea-b-c7', 'sea-k-e7', 'sea-n-b7', 'sea-p-g7', 'sea-q-d7', 'sea-r-f7',
    ]);
    expect(g.state.turn).toBe('land');
    expect(g.state.round).toBe(1);
    expect(g.state.duelTokens).toEqual({ land: 2, sea: 2 });
    expect(g.state.maxRounds).toBe(15);
    expect(g.state.nextSinkIn).toBe(3);
    expect(g.state.treasures).toEqual([]);
  });

  it('newGame sends started, state, turnChanged, rolled, state; the roll sets the AP', () => {
    const g = arenaGame('sumo');
    const r = record(g);
    g.newGame({ mode: 'sumo', opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed: 9 });
    expect(r.names).toEqual(['started', 'state', 'turnChanged', 'rolled', 'state']);
    const rolled = r.events[3][1] as { value: number; ap: number };
    expect(rolled.ap).toBe([2, 2, 3, 3, 4, 4][rolled.value - 1]);
    expect(g.state.ap).toBe(rolled.ap);
  });

  it('refuses chess modes', () => {
    const g = arenaGame('sumo');
    expect(() => g.newGame({ mode: 'normal', opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false })).toThrow();
  });

  it('the turn ends when AP runs out, with the end-of-turn events in order', () => {
    const g = arenaGame('sumo');
    setBoard(g, { ...KINGS, b2: 'land-n' }, 'land', 1);
    const r = record(g);
    ok(g, step(id('land', 'n', 'b2'), 'b3'));
    expect(r.names).toEqual(['acted', 'logged', 'state', 'state', 'turnChanged', 'rolled', 'state']);
    expect(g.state.turn).toBe('sea');
  });

  it('End turn gives up the rest of the AP: logged (pass), then the end of the turn, no acted', () => {
    const g = arenaGame('sumo');
    setBoard(g, { ...KINGS }, 'land', 4);
    const r = record(g);
    ok(g, END);
    expect(r.names).toEqual(['logged', 'state', 'turnChanged', 'rolled', 'state']);
    expect(g.log.at(-1)).toMatchObject({ side: 'land', kind: 'pass' });
    expect(g.state.turn).toBe('sea');
  });
});

describe('Sumo: steps', () => {
  it('steps onto empty, dry, unblocked squares only', () => {
    const g = arenaGame('sumo');
    setBoard(g, { ...KINGS, b2: 'land-n', c2: 'land-p' });
    g.raw.sunkRings = 1;
    g.raw.blocks.push({ sq: sqIndex('c3'), by: 'sea', turnsLeft: 3 });
    const horse = id('land', 'n', 'b2');
    expect(g.pieceOptions(horse).steps).toEqual(['b3']);
    expect(g.act(step(horse, 'a2')).ok).toBe(false);
    expect(g.act(step(horse, 'c3')).ok).toBe(false);
    expect(g.act(step(horse, 'c2')).ok).toBe(false);
    ok(g, step(horse, 'b3'));
    expect(g.state.ap).toBe(3);
  });

  it('only the side to move gets options', () => {
    const g = arenaGame('sumo');
    expect(g.pieceOptions('sea-n-b7').steps).toEqual([]);
    expect(g.pieceOptions('land-n-b2').steps.length).toBeGreaterThan(0);
  });
});

describe('Sumo: shoves', () => {
  it('pushes the whole line one square, own animals included, in one step', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', h1: 'sea-k', d3: 'land-b', d4: 'sea-p', d5: 'land-n', d6: 'sea-n' });
    const r = record(g);
    ok(g, hit(id('land', 'b', 'd3'), 'd4'));
    const acted = r.events.find(([n]) => n === 'acted')![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'sea-n-d6', from: 'd6', to: 'd7', how: 'pushed' },
      { step: 0, type: 'move', pieceId: 'land-n-d5', from: 'd5', to: 'd6', how: 'pushed' },
      { step: 0, type: 'move', pieceId: 'sea-p-d4', from: 'd4', to: 'd5', how: 'pushed' },
    ]);
    expect(g.state.ap).toBe(2);
    expect(at(g, 'land-b-d3')).toBe('d3');
  });

  it('the animal pushed off the end falls in the same step, with no move of its own', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', d1: 'sea-k', f4: 'land-b', g4: 'sea-p', h4: 'sea-n' });
    g.raw.tokens.sea = 0;
    const r = record(g);
    ok(g, hit(id('land', 'b', 'f4'), 'g4'));
    const acted = r.events.find(([n]) => n === 'acted')![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'sea-p-g4', from: 'g4', to: 'h4', how: 'pushed' },
      { step: 0, type: 'fall', pieceId: 'sea-n-h4', square: 'h4', dir: [1, 0] },
    ]);
    expect(g.state.out.map((p) => p.id)).toEqual(['sea-n-h4']);
  });

  it('pushes diagonally, and into sunk squares', () => {
    const g = arenaGame('sumo');
    setBoard(g, { e4: 'land-k', e5: 'sea-k', d3: 'land-q', c2: 'sea-p' });
    g.raw.sunkRings = 1;
    g.raw.tokens.sea = 0;
    const r = record(g);
    ok(g, hit(id('land', 'q', 'd3'), 'c2'));
    const acted = r.events.find(([n]) => n === 'acted')![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([{ step: 0, type: 'fall', pieceId: 'sea-p-c2', square: 'c2', dir: [-1, -1] }]);
  });

  it('a shove that would end on a blocked square is refused', () => {
    const g = arenaGame('sumo');
    setBoard(g, { ...KINGS, b3: 'land-b', b4: 'sea-p', b5: 'sea-n' });
    g.raw.blocks.push({ sq: sqIndex('b6'), by: 'land', turnsLeft: 3 });
    expect(g.pieceOptions('land-b-b3').hits).toEqual([]);
    expect(g.act(hit('land-b-b3', 'b4')).ok).toBe(false);
  });

  it('a heavy king or rook costs 3 AP; without the AP it is not offered', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', c3: 'land-b', c4: 'sea-r', d3: 'sea-p', h8: 'sea-k' }, 'land', 2);
    const o = g.pieceOptions('land-b-c3');
    expect(o.hits).toEqual(['d3']);
    expect(o.hitCosts).toEqual([2]);
    g.raw.ap = 4;
    const o2 = g.pieceOptions('land-b-c3');
    expect(Object.fromEntries(o2.hits.map((h, k) => [h, o2.hitCosts[k]]))).toEqual({ c4: 3, d3: 2 });
    ok(g, hit('land-b-c3', 'c4'));
    expect(g.state.ap).toBe(1);
  });

  it('an anchored animal anywhere in the line stops the shove', () => {
    const g = arenaGame('sumo');
    setBoard(g, { ...KINGS, b3: 'land-b', b4: 'sea-p', b5: 'sea-n', g3: 'land-r', g4: 'sea-q' });
    g.raw.statuses.push({ id: 'sea-n-b5', status: 'anchored', turnsLeft: 1 });
    g.raw.statuses.push({ id: 'sea-q-g4', status: 'anchored', turnsLeft: 1 });
    expect(g.pieceOptions('land-b-b3').hits).toEqual([]);
    expect(g.pieceOptions('land-r-g3').hits).toEqual([]);
  });
});

describe('Sumo: king overboard', () => {
  it('shoving the enemy king in wins: acted, logged, state (over), gameOver', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', g5: 'land-b', h5: 'sea-k' });
    g.raw.tokens.sea = 0;
    const r = record(g);
    ok(g, hit('land-b-g5', 'h5'));
    expect(r.names).toEqual(['acted', 'logged', 'state', 'gameOver']);
    expect(g.state.phase).toBe('over');
    expect(r.events.at(-1)![1]).toEqual({ winner: 'land', reason: 'kingOverboard' });
    expect(g.act(END).ok).toBe(false);
  });

  it('pushing your own king off the end of the line on your turn loses', () => {
    const g = arenaGame('sumo');
    setBoard(g, { e4: 'land-b', f4: 'sea-p', g4: 'land-n', h4: 'land-k', a8: 'sea-k' });
    g.raw.tokens.sea = 0;
    const r = record(g);
    ok(g, hit('land-b-e4', 'f4'));
    expect(r.events.at(-1)).toEqual(['gameOver', { winner: 'sea', reason: 'kingOverboard' }]);
  });

  it('both kings in at once is a draw (a stomp)', () => {
    const g = arenaGame('sumo');
    setBoard(g, { c6: 'land-r', b6: 'sea-p', a6: 'sea-k', c7: 'sea-n', c8: 'land-k' });
    g.raw.tokens.sea = 0;
    const r = record(g);
    ok(g, pw('land-r-c6'));
    expect(r.events.at(-1)).toEqual(['gameOver', { winner: null, reason: 'kingOverboard' }]);
  });
});

describe('Sumo: powers', () => {
  it('Dig in: anchored, can\'t be shoved on the enemy turn, lifts at its own next turn', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d4: 'land-p', d5: 'sea-b' }, 'land', 2);
    const r = record(g);
    ok(g, pw('land-p-d4'));
    const acted = r.events.find(([n]) => n === 'acted')![1] as { power: string; changes: BoardChange[] };
    expect(acted.power).toBe('sidestep'); // the pawn's PowerKind; Sumo shows it as "Dig in"
    expect(acted.changes).toEqual([{ step: 0, type: 'status', pieceId: 'land-p-d4', status: 'anchored' }]);
    // AP was 2: the turn ended. Sea can't shove the pup.
    expect(g.state.turn).toBe('sea');
    expect(g.state.statuses).toEqual([{ pieceId: 'land-p-d4', status: 'anchored', turnsLeft: 1 }]);
    expect(g.pieceOptions('sea-b-d5').hits).toEqual([]);
    ok(g, END);
    expect(g.state.turn).toBe('land');
    expect(g.state.statuses).toEqual([]);
  });

  it('PowerInfo carries the mode\'s name, rule and a plain note', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d4: 'land-p' }, 'land', 1);
    expect(g.pieceOptions('land-p-d4').power).toMatchObject({
      power: 'sidestep', name: 'Dig in', available: false, reason: 'wrongPhase', note: 'Not enough AP',
    });
    g.raw.ap = 2;
    expect(g.pieceOptions('land-p-d4').power).toMatchObject({ available: true, name: 'Dig in' });
    expect(g.pieceOptions('land-p-d4').power.line).toMatch(/pushed/);
  });

  it('Double jump: two knight hops onto empty, dry squares', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', c3: 'land-n', d5: 'sea-p' });
    g.raw.sunkRings = 1;
    const first = g.targets({ pieceId: 'land-n-c3', targets: [] }).squares.sort();
    expect(first).toEqual(['b5', 'e2', 'e4']); // a2, a4, b1, d1 are water; d5 is taken
    const r = record(g);
    ok(g, pw('land-n-c3', 'e4', 'f6'));
    const acted = r.events.find(([n]) => n === 'acted')![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-n-c3', from: 'c3', to: 'e4', how: 'jump' },
      { step: 1, type: 'move', pieceId: 'land-n-c3', from: 'e4', to: 'f6', how: 'jump' },
    ]);
    expect(g.act(pw('land-n-f6', 'e4', 'c3')).ok).toBe(false); // used up (and wrong id now)
    expect(g.pieceOptions('land-n-c3').power).toMatchObject({ available: false, reason: 'used' });
  });

  it('Headbutt shoves 2 squares, heavy or not, for 2 AP', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d4: 'land-b', d5: 'sea-r' });
    const r = record(g);
    ok(g, pw('land-b-d4', 'd5'));
    const acted = r.events.find(([n]) => n === 'acted')![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'sea-r-d5', from: 'd5', to: 'd6', how: 'pushed' },
      { step: 1, type: 'move', pieceId: 'sea-r-d5', from: 'd6', to: 'd7', how: 'pushed' },
    ]);
    expect(g.state.ap).toBe(2);
  });

  it('Headbutt: falls in after one square at the edge; stops early at a block', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', h1: 'sea-k', d6: 'land-b', d7: 'sea-n', b4: 'land-q', b5: 'sea-p' });
    g.raw.blocks.push({ sq: sqIndex('b7'), by: 'land', turnsLeft: 3 });
    g.raw.tokens.sea = 0;
    g.raw.ap = 10;
    const r = record(g);
    ok(g, pw('land-b-d6', 'd7'));
    let acted = r.events.filter(([n]) => n === 'acted').at(-1)![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'sea-n-d7', from: 'd7', to: 'd8', how: 'pushed' },
      { step: 1, type: 'fall', pieceId: 'sea-n-d7', square: 'd8', dir: [0, 1] },
    ]);
    // A second goat would be needed for the block case: use a fresh board.
    setBoard(g, { a1: 'land-k', h1: 'sea-k', b4: 'land-b', b5: 'sea-p' });
    g.raw.blocks.push({ sq: sqIndex('b7'), by: 'land', turnsLeft: 3 });
    ok(g, pw('land-b-b4', 'b5'));
    acted = r.events.filter(([n]) => n === 'acted').at(-1)![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([{ step: 0, type: 'move', pieceId: 'sea-p-b5', from: 'b5', to: 'b6', how: 'pushed' }]);
  });

  it('Stomp shoves every enemy neighbour away, all in one step; a refused line is skipped', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', a8: 'sea-k', g4: 'land-r', h4: 'sea-p', f5: 'sea-n', f3: 'land-p', g5: 'sea-b' });
    g.raw.blocks.push({ sq: sqIndex('g6'), by: 'land', turnsLeft: 3 });
    g.raw.tokens.sea = 0;
    expect(g.previewArea({ pieceId: 'land-r-g4', targets: [] }).area.sort()).toEqual(['e6', 'f5', 'h4']);
    expect(g.previewArea({ pieceId: 'land-r-g4', targets: [] }).falls).toEqual(['h4']);
    const r = record(g);
    ok(g, pw('land-r-g4'));
    const acted = r.events.find(([n]) => n === 'acted')![1] as { changes: BoardChange[] };
    expect(acted.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'sea-n-f5', from: 'f5', to: 'e6', how: 'pushed' },
      { step: 0, type: 'fall', pieceId: 'sea-p-h4', square: 'h4', dir: [1, 0] },
    ]);
    expect(at(g, 'sea-b-g5')).toBe('g5'); // its line ends on the block: it stays
  });

  it('Block: an empty dry square; nothing can be shoved onto it; it lasts 4 plies', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', h8: 'sea-k', d1: 'land-q', d4: 'land-p', d5: 'sea-b' });
    g.raw.sunkRings = 1;
    const sq = g.targets({ pieceId: 'land-q-d1', targets: [] }).squares;
    expect(sq).not.toContain('a5'); // water
    expect(sq).not.toContain('d4'); // taken
    ok(g, pw('land-q-d1', 'd3'));
    expect(g.state.squares).toEqual([{ square: 'd3', effect: 'blocked', by: 'land', turnsLeft: 4 }]);
    ok(g, END);
    expect(g.state.squares[0].turnsLeft).toBe(3);
    expect(g.pieceOptions('sea-b-d5').hits).toEqual([]);
    ok(g, END);
    ok(g, END);
    expect(g.state.squares[0].turnsLeft).toBe(1);
    ok(g, END);
    expect(g.state.squares).toEqual([]);
  });

  it('Escape: an empty dry square up to 2 away', () => {
    const g = arenaGame('sumo');
    setBoard(g, { c3: 'land-k', h8: 'sea-k', d4: 'sea-p' });
    g.raw.sunkRings = 1;
    const sq = g.targets({ pieceId: 'land-k-c3', targets: [] }).squares.sort();
    expect(sq).toEqual(['b2', 'b3', 'b4', 'b5', 'c2', 'c4', 'c5', 'd2', 'd3', 'd5', 'e2', 'e3', 'e4', 'e5']);
    ok(g, pw('land-k-c3', 'e5'));
    expect(at(g, 'land-k-c3')).toBe('e5');
  });
});

describe('Sumo: the sinking island', () => {
  it('warns during round 3 and sinks the outer ring at its end; everything on it falls in one step', () => {
    const g = arenaGame('sumo');
    setBoard(g, { d4: 'land-k', e5: 'sea-k', a5: 'sea-p', h4: 'land-p', b2: 'land-n' }, 'land');
    expect(g.state.sinkingNext).toEqual([]);
    g.raw.round = 3;
    expect(g.state.nextSinkIn).toBe(1);
    expect(g.state.sinkingNext).toHaveLength(28);
    ok(g, END);
    expect(g.state.sunk).toEqual([]);
    const r = record(g);
    ok(g, END);
    expect(r.names).toEqual(['logged', 'sank', 'logged', 'state', 'turnChanged', 'rolled', 'state']);
    const sank = r.events[1][1] as { squares: string[]; sunk: string[]; sinkingNext: string[]; changes: BoardChange[] };
    expect(sank.squares).toHaveLength(28);
    expect(sank.sunk).toEqual(sank.squares.slice().sort((a, b) => a[1].localeCompare(b[1]) || a.localeCompare(b)));
    expect(sank.sinkingNext).toEqual([]);
    expect(sank.changes).toEqual([
      { step: 0, type: 'fall', pieceId: 'land-p-h4', square: 'h4', dir: [1, 0] },
      { step: 0, type: 'fall', pieceId: 'sea-p-a5', square: 'a5', dir: [-1, 0] },
    ]);
    expect(g.state.sunk).toHaveLength(28);
    expect(g.state.round).toBe(4);
    expect(g.state.nextSinkIn).toBe(3);
    expect(at(g, 'land-n-b2')).toBe('b2');
  });

  it('then the next rings at the end of rounds 6 and 9; the middle 2×2 always stays', () => {
    const g = arenaGame('sumo');
    setBoard(g, { d4: 'land-k', e5: 'sea-k' });
    for (let r = 1; r <= 9; r++) {
      ok(g, END);
      ok(g, END);
    }
    expect(g.state.sunk).toHaveLength(60);
    expect(g.state.nextSinkIn).toBeNull();
    expect(g.state.sinkingNext).toEqual([]);
    expect(g.state.pieces).toHaveLength(2);
  });

  it('kings sinking: a lone king lost is a win for the other side; both at once is a draw', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a4: 'land-k', e5: 'sea-k' }, 'sea');
    g.raw.round = 3;
    const r = record(g);
    ok(g, END);
    expect(r.names).toEqual(['logged', 'sank', 'logged', 'state', 'gameOver']);
    expect(r.events.at(-1)![1]).toEqual({ winner: 'sea', reason: 'kingOverboard' });

    const g2 = arenaGame('sumo');
    setBoard(g2, { a4: 'land-k', h5: 'sea-k' }, 'sea');
    g2.raw.round = 3;
    const r2 = record(g2);
    ok(g2, END);
    expect(r2.events.at(-1)![1]).toEqual({ winner: null, reason: 'kingOverboard' });
  });
});

describe('Sumo: round cap', () => {
  it('after round 15 the side with more animals left wins, else a draw', () => {
    const g = arenaGame('sumo');
    setBoard(g, { d4: 'land-k', d5: 'land-p', e5: 'sea-k' }, 'sea');
    g.raw.round = 15;
    g.raw.sunkRings = 3;
    const r = record(g);
    ok(g, END);
    expect(r.events.at(-1)).toEqual(['gameOver', { winner: 'land', reason: 'rounds' }]);
    expect(g.state.round).toBe(15);

    const g2 = arenaGame('sumo');
    setBoard(g2, { d4: 'land-k', e5: 'sea-k' }, 'sea');
    g2.raw.round = 15;
    g2.raw.sunkRings = 3;
    const r2 = record(g2);
    ok(g2, END);
    expect(r2.events.at(-1)).toEqual(['gameOver', { winner: null, reason: 'rounds' }]);
  });
});

describe('Sumo: duels', () => {
  it('a shove that would make the defender\'s animal fall in can be dueled; declining lets it happen', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', d8: 'sea-k', g4: 'land-b', h4: 'sea-p' });
    const r = record(g);
    expect(g.act(hit('land-b-g4', 'h4'))).toEqual({ ok: true, pending: 'duel' });
    expect(r.names).toEqual(['duelOffered']);
    expect(r.events[0][1]).toMatchObject({ attackerId: 'land-b-g4', victimId: 'sea-p-h4', via: 'shove', from: 'g4', to: 'h4', attacker: 'land', defender: 'sea', tokensLeft: 2 });
    expect(g.state.phase).toBe('duel');
    expect(g.act(END).ok).toBe(false);
    g.answerDuel(false);
    expect(r.names).toEqual(['duelOffered', 'duelEnded', 'acted', 'logged', 'state']);
    expect(g.state.out.map((p) => p.id)).toEqual(['sea-p-h4']);
    expect(g.state.duelTokens.sea).toBe(2);
  });

  it('a bonk spends the AP and the token, and moves nothing', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', d8: 'sea-k', g4: 'land-b', h4: 'sea-p' });
    const r = record(g);
    ok(g, hit('land-b-g4', 'h4'));
    g.answerDuel(true);
    expect(g.state.phase).toBe('duel');
    g.throwHand('land', 'rock');
    g.throwHand('sea', 'rock'); // tie: throw again
    g.throwHand('land', 'rock');
    g.throwHand('sea', 'paper');
    expect(r.names).toEqual(['duelOffered', 'state', 'duelRound', 'state', 'duelRound', 'duelEnded', 'bonked', 'logged', 'state']);
    expect(at(g, 'sea-p-h4')).toBe('h4');
    expect(g.state.ap).toBe(2);
    expect(g.state.duelTokens.sea).toBe(1);
    expect(g.log.at(-1)!.kind).toBe('bonk');
  });

  it('three ties in a row: the attacker wins', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', d8: 'sea-k', g4: 'land-b', h4: 'sea-p' });
    ok(g, hit('land-b-g4', 'h4'));
    g.answerDuel(true);
    for (let n = 0; n < 3; n++) {
      g.throwHand('land', 'paper');
      g.throwHand('sea', 'paper');
    }
    expect(g.state.out.map((p) => p.id)).toEqual(['sea-p-h4']);
  });

  it('no duel without tokens, for a shove that drops nothing, or when your own animal falls', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', d8: 'sea-k', g4: 'land-b', h4: 'sea-p', c4: 'land-q', d4: 'sea-n', f3: 'land-r', g3: 'sea-b', h3: 'land-p' }, 'land', 10);
    expect(g.act(hit('land-q-c4', 'd4'))).toEqual({ ok: true });
    expect(g.act(hit('land-r-f3', 'g3'))).toEqual({ ok: true }); // the land pup at the end falls, not a sea animal
    expect(g.state.out.map((p) => p.id)).toEqual(['land-p-h3']);
    g.raw.tokens.sea = 0;
    expect(g.act(hit('land-b-g4', 'h4'))).toEqual({ ok: true });
  });

  it('powers can\'t be dueled: a Headbutt into the sea just happens', () => {
    const g = arenaGame('sumo');
    setBoard(g, { a1: 'land-k', d1: 'sea-k', g4: 'land-b', h4: 'sea-p' });
    expect(g.previewArea({ pieceId: 'land-b-g4', targets: ['h4'] }).falls).toEqual(['h4']);
    expect(g.act(pw('land-b-g4', 'h4'))).toEqual({ ok: true });
    expect(g.state.out.map((p) => p.id)).toEqual(['sea-p-h4']);
  });
});
