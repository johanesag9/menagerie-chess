/** Stepping Stones rules (GAME_SPEC "Board-game modes"). */
import { describe, expect, it } from 'vitest';
import type { ArenaEventMap, Square } from '../../contracts/types';
import { ranks, recordBoard, shape, stonesGame } from './boardkit';
import { arenaGame, at, END, ok, pw, step } from './testkit';

const shapesOf = (g: ReturnType<typeof stonesGame>, dir: 'up' | 'down') =>
  g.shapeOptions().filter((o) => (dir === 'up' ? o.up : o.down)).map((o) => o.square).sort();
const SEA = ranks(3, 4, 5, 6);
const without = (xs: Square[], ...out: Square[]) => xs.filter((x) => !out.includes(x));
const acted = (rec: ReturnType<typeof recordBoard>) => rec.events.filter(([n]) => n === 'acted').map(([, p]) => p as ArenaEventMap['acted']);

describe('stones: setup', () => {
  it('sinks ranks 3–6 and lines both teams up as in the party modes', () => {
    const g = arenaGame('stones');
    const s = g.state;
    expect(s.sunk.slice().sort()).toEqual(SEA.slice().sort());
    expect(s.pieces.filter((p) => p.side === 'land').map((p) => p.square).sort()).toEqual(['b2', 'c2', 'd2', 'e2', 'f2', 'g2']);
    expect(s.pieces.filter((p) => p.side === 'sea').map((p) => p.square).sort()).toEqual(['b7', 'c7', 'd7', 'e7', 'f7', 'g7']);
    expect(s.pieces.map((p) => p.id)).toContain('land-n-b2');
    expect(s).toMatchObject({ phase: 'action', stage: 'shape', turn: 'land', die: null, ap: 0, maxRounds: 25, fresh: [] });
    expect(s.pathLength).toEqual({ land: null, sea: null });
    expect(s.levels).toBeUndefined();
  });
});

describe('stones: shaping', () => {
  it('raises only sunk squares that touch dry land', () => {
    const g = stonesGame({ a1: 'land-p', h8: 'sea-p' });
    expect(shapesOf(g, 'up')).toEqual([...ranks(3), ...ranks(6)].sort());
    expect(shapesOf(g, 'down')).toEqual([]);
  });

  it('sinks only empty dry squares in ranks 3–6', () => {
    const g = stonesGame({ d4: 'land-p', h8: 'sea-p' }, without(SEA, 'c4', 'd4', 'e4', 'e5'));
    g.raw.blocks.push({ sq: 36, by: 'sea', turnsLeft: 4 }); // e5
    expect(shapesOf(g, 'down')).toEqual(['c4', 'e4']); // not d4 (an animal), not e5 (a block), not rank 2
    expect(g.act(shape('d2', 'down')).ok).toBe(false);
  });

  it('then steps one animal onto an empty dry square, and the turn ends', () => {
    const g = arenaGame('stones');
    const rec = recordBoard(g);
    expect(g.pieceOptions('land-q-d2').steps).toEqual([]); // shape first
    ok(g, shape('d3', 'up'));
    expect(g.state.stage).toBe('move');
    expect(g.state.turn).toBe('land');
    expect(g.shapeOptions()).toEqual([]);
    expect(g.pieceOptions('land-q-d2').steps.sort()).toEqual(['c1', 'd1', 'd3', 'e1']);
    expect(g.act(step('land-q-d2', 'c3')).ok).toBe(false); // water
    expect(g.act(step('land-q-d2', 'c2')).ok).toBe(false); // an animal
    expect(g.act(END).ok).toBe(false);
    ok(g, step('land-q-d2', 'd3'));
    expect(g.state.turn).toBe('sea');
    expect(g.state.stage).toBe('shape');
    expect(acted(rec)[0].changes).toEqual([{ step: 0, type: 'water', square: 'd3', sunk: false, cause: 'raise' }]);
    expect(rec.names).toEqual(['acted', 'logged', 'state', 'acted', 'logged', 'state', 'state', 'turnChanged', 'state']);
    expect(g.state.pathLength).toEqual({ land: null, sea: null });
  });

  it('a shape stage with nothing legal is skipped', () => {
    // Sea just changed every square Land could raise (all fresh now), nothing is dry to sink, and the Bridge has nothing.
    const g = stonesGame({ a1: 'land-p', h8: 'sea-p' }, SEA, 'sea', 'move');
    g.raw.freshNext = [...ranks(3), ...ranks(6)].map(sqi);
    ok(g, step('sea-p-h8', 'g8'));
    expect(g.state.turn).toBe('land');
    expect(g.state.stage).toBe('move');
  });

  it('a move stage with nothing legal is skipped: the turn ends after shaping', () => {
    const g = stonesGame({ a1: 'land-p', h8: 'sea-p' }, ['a2', 'b1', 'b2', ...SEA]);
    ok(g, shape('h3', 'up'));
    expect(g.state.turn).toBe('sea');
  });
});

describe('stones: the fresh rule', () => {
  it("a square changed last turn can't be raised or sunk this turn, but can the turn after", () => {
    const g = arenaGame('stones');
    ok(g, shape('d3', 'up'));
    ok(g, step('land-q-d2', 'c1'));
    expect(g.state.fresh).toEqual(['d3']);
    expect(g.act(shape('d3', 'down')).ok).toBe(false);
    expect(g.shapeOptions().find((o) => o.square === 'd3')).toBeUndefined();
    ok(g, shape('e6', 'up'));
    ok(g, step('sea-r-f7', 'e6'));
    expect(g.state.fresh).toEqual(['e6']);
    ok(g, shape('d3', 'down')); // Land's own square from two turns ago
    ok(g, step('land-k-e2', 'e1'));
    expect(g.state.fresh).toEqual(['d3']);
  });

  it('can be turned off', () => {
    const g = arenaGame('stones', {}, { freshRule: false });
    ok(g, shape('d3', 'up'));
    ok(g, step('land-q-d2', 'c1'));
    expect(g.state.fresh).toEqual([]);
    ok(g, shape('d3', 'down'));
  });
});

describe('stones: powers (once per game, the whole turn)', () => {
  it('Bridge raises two sunk squares in a line, the first next to dry land', () => {
    const g = stonesGame({ d2: 'land-p', h8: 'sea-p' });
    const t = g.targets({ pieceId: 'land-p-d2', targets: [] });
    expect(t.squares.sort()).toEqual(ranks(3, 6).sort());
    expect(g.targets({ pieceId: 'land-p-d2', targets: ['d3'] }).squares.sort()).toEqual(['c3', 'c4', 'd4', 'e3', 'e4']);
    const rec = recordBoard(g);
    ok(g, pw('land-p-d2', 'd3', 'd4'));
    expect(acted(rec)[0]).toMatchObject({ power: 'sidestep', changes: [
      { step: 0, type: 'water', square: 'd3', sunk: false, cause: 'bridge' },
      { step: 1, type: 'water', square: 'd4', sunk: false, cause: 'bridge' },
    ] });
    expect(g.state.turn).toBe('sea'); // no move after a power
    expect(g.state.powersUsed).toEqual(['land-p-d2']);
    expect(g.state.fresh!.sort()).toEqual(['d3', 'd4']);
    expect(g.act(pw('land-p-d2', 'e3', 'e4')).ok).toBe(false);
  });

  it('Bridge respects fresh squares', () => {
    const g = stonesGame({ d2: 'land-p', h8: 'sea-p' });
    g.raw.fresh = [sqi('d3')];
    expect(g.targets({ pieceId: 'land-p-d2', targets: [] }).squares).not.toContain('d3');
    expect(g.targets({ pieceId: 'land-p-d2', targets: ['c3'] }).squares).not.toContain('d3');
  });

  it('Double jump: two knight hops onto empty dry squares, over water', () => {
    const g = stonesGame({ b2: 'land-n', h8: 'sea-p' }, without(SEA, 'c4'));
    const first = g.targets({ pieceId: 'land-n-b2', targets: [] }).squares.sort();
    expect(first).toEqual(['c4', 'd1']); // a4, d3 are water
    expect(g.targets({ pieceId: 'land-n-b2', targets: ['c4'] }).squares).toEqual(['d2']); // not back to b2
    ok(g, pw('land-n-b2', 'd1', 'f2'));
    expect(at(g, 'land-n-b2')).toBe('f2');
  });

  it('Headbutt pushes an enemy 1 square; into the water sends it home; never off the board or into an animal', () => {
    const g = stonesGame({ d4: 'land-b', d5: 'sea-k', e5: 'sea-r', c5: 'sea-n', c4: 'sea-q', e8: 'sea-p' }, without(SEA, 'd4', 'd5', 'e5', 'c5', 'c4', 'd6'));
    // d5 → d6 (dry), e5 → f6 (water: home), c5 → b6 (water: home), c4 → b4 (water: home)
    expect(g.targets({ pieceId: 'land-b-d4', targets: [] }).squares.sort()).toEqual(['c4', 'c5', 'd5', 'e5']);
    expect(g.previewArea({ pieceId: 'land-b-d4', targets: ['d5'] }).area).toEqual(['d5', 'd6']);
    const rec = recordBoard(g);
    ok(g, pw('land-b-d4', 'e5'));
    // Nearest empty square on Sea's back rank to the e-file: e8 is taken, so d8 (toward the centre on a tie).
    expect(acted(rec)[0].changes).toEqual([{ step: 0, type: 'move', pieceId: 'sea-r-e5', from: 'e5', to: 'd8', how: 'sentHome' }]);
    expect(at(g, 'sea-r-e5')).toBe('d8');

    const g2 = stonesGame({ d7: 'land-b', d8: 'sea-k', c8: 'sea-q', c7: 'sea-p', b7: 'land-p' });
    expect(g2.targets({ pieceId: 'land-b-d7', targets: [] }).squares).toEqual([]); // off the board / into an animal
    expect(g2.pieceOptions('land-b-d7').power).toMatchObject({ available: false, reason: 'noTarget', name: 'Headbutt' });
  });

  it('a headbutt onto dry land is a plain push', () => {
    const g = stonesGame({ d4: 'land-b', d5: 'sea-k', a8: 'sea-p' }, without(SEA, 'd4', 'd5', 'd6'));
    const rec = recordBoard(g);
    ok(g, pw('land-b-d4', 'd5'));
    expect(acted(rec)[0].changes).toEqual([{ step: 0, type: 'move', pieceId: 'sea-k-d5', from: 'd5', to: 'd6', how: 'pushed' }]);
  });

  it('Stomp sinks every empty dry square around the rook in ranks 3–6, fresh ones too', () => {
    const g = stonesGame({ d3: 'land-r', c4: 'sea-p', h8: 'sea-k' }, without(SEA, 'c3', 'd3', 'e3', 'c4', 'd4', 'e4'));
    g.raw.fresh = [sqi('e4')];
    g.raw.blocks.push({ sq: sqi('d4'), by: 'sea', turnsLeft: 3 });
    expect(g.previewArea({ pieceId: 'land-r-d3', targets: [] }).area.sort()).toEqual(['c3', 'e3', 'e4']);
    const rec = recordBoard(g);
    ok(g, pw('land-r-d3'));
    expect(acted(rec)[0].changes.map((c) => c.type === 'water' && `${c.square}:${c.cause}:${c.step}`).sort()).toEqual(['c3:stomp:0', 'e3:stomp:0', 'e4:stomp:0']);
    expect(g.state.sunk).toEqual(expect.arrayContaining(['c3', 'e3', 'e4']));
    expect(g.state.sunk).not.toContain('c2');
  });

  it('Block: nobody can sink it or stand on it, for 4 plies', () => {
    const g = stonesGame({ a1: 'land-q', h8: 'sea-p' }, without(SEA, 'd4'));
    ok(g, pw('land-q-a1', 'd4'));
    expect(g.state.squares).toEqual([{ square: 'd4', effect: 'blocked', by: 'land', turnsLeft: 3 }]);
    expect(g.shapeOptions().find((o) => o.square === 'd4')).toBeUndefined();
    for (let k = 0; k < 2; k++) {
      ok(g, shape(g.state.turn === 'sea' ? 'a6' : 'a3', 'up'));
      const p = g.state.pieces.find((x) => x.side === g.state.turn)!;
      ok(g, step(p.id, g.pieceOptions(p.id).steps[0]));
    }
    expect(g.state.squares).toEqual([{ square: 'd4', effect: 'blocked', by: 'land', turnsLeft: 1 }]);
    ok(g, shape('b6', 'up'));
    const p = g.state.pieces.find((x) => x.side === 'sea')!;
    ok(g, step(p.id, g.pieceOptions(p.id).steps[0]));
    expect(g.state.squares).toEqual([]);
  });

  it('Escape: teleport to an empty dry square up to 2 away', () => {
    const g = stonesGame({ d2: 'land-k', h8: 'sea-p' }, without(SEA, 'd4', 'f4'));
    const t = g.targets({ pieceId: 'land-k-d2', targets: [] }).squares;
    expect(t).toContain('d4');
    expect(t).toContain('f4');
    expect(t).toContain('b1');
    expect(t).not.toContain('d3'); // water
    expect(t).not.toContain('g2'); // 3 files away
    ok(g, pw('land-k-d2', 'f4'));
    expect(at(g, 'land-k-d2')).toBe('f4');
  });

  it('a power is only instead of shaping, and only once', () => {
    const g = arenaGame('stones');
    ok(g, shape('d3', 'up'));
    expect(g.pieceOptions('land-k-e2').power).toMatchObject({ available: false, reason: 'wrongPhase', name: 'Escape' });
    expect(g.act(pw('land-k-e2', 'e1')).ok).toBe(false);
    expect(g.pieceOptions('sea-k-e7').power).toMatchObject({ available: false, reason: 'notYourTurn' });
  });
});

describe('stones: winning and the round cap', () => {
  it('the first animal on the enemy back rank wins', () => {
    const g = stonesGame({ d7: 'land-p', h1: 'sea-p' }, [], 'land', 'move');
    const rec = recordBoard(g);
    ok(g, step('land-p-d7', 'd8'));
    expect(rec.events.find(([n]) => n === 'gameOver')![1]).toEqual({ winner: 'land', reason: 'crossed' });
    expect(rec.names).toEqual(['acted', 'logged', 'state', 'gameOver']);
    expect(g.state.phase).toBe('over');
  });

  it('Sea wins on rank 1, by a power too', () => {
    const g = stonesGame({ a8: 'land-p', c3: 'sea-n' }, [], 'sea');
    const rec = recordBoard(g);
    ok(g, pw('sea-n-c3', 'e2', 'c1'));
    expect(rec.events.find(([n]) => n === 'gameOver')![1]).toEqual({ winner: 'sea', reason: 'crossed' });
  });

  it('after round 25 it is a draw', () => {
    const g = stonesGame({ a1: 'land-p', h8: 'sea-p' }, SEA, 'land');
    g.raw.round = 25;
    const rec = recordBoard(g);
    ok(g, shape('a3', 'up'));
    ok(g, step('land-p-a1', 'b1'));
    ok(g, shape('h6', 'up'));
    ok(g, step('sea-p-h8', 'g8'));
    expect(rec.events.find(([n]) => n === 'gameOver')![1]).toEqual({ winner: null, reason: 'rounds' });
  });

  it('pathLength counts dry steps from the nearest animal to the enemy back rank', () => {
    const g = stonesGame({ d2: 'land-p', b2: 'land-n', d7: 'sea-p' }, without(SEA, 'd3', 'd4', 'd5', 'e6'));
    expect(g.state.pathLength).toEqual({ land: 6, sea: 6 });
    g.raw.blocks.push({ sq: sqi('d5'), by: 'sea', turnsLeft: 4 });
    expect(g.state.pathLength).toEqual({ land: null, sea: null });
  });
});

function sqi(sq: string): number {
  return sq.charCodeAt(0) - 97 + 8 * (Number(sq[1]) - 1);
}
