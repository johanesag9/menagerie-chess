/** Sandcastle King rules (GAME_SPEC "Board-game modes"). */
import { describe, expect, it } from 'vitest';
import type { ArenaEventMap, BoardChange, Square } from '../../contracts/types';
import { castleGame, pick, recordBoard, shape } from './boardkit';
import { arenaGame, at, END, hit, id, ok, step } from './testkit';

const steps = (g: ReturnType<typeof castleGame>, pieceId: string) => g.pieceOptions(pieceId).steps.slice().sort();
const sorted = (xs: Square[]) => xs.slice().sort();

describe('castle: the draft', () => {
  it('alternates Land, Sea, Land, Sea and places the animals in one step', () => {
    const g = arenaGame('castle');
    const rec = recordBoard(g);
    expect(g.state.phase).toBe('draft');
    expect(g.state.stage).toBe('pick');
    expect(g.state.pieces).toEqual([]);
    expect(g.state.draft).toEqual({ size: 2, picks: { land: [], sea: [] } });
    ok(g, pick('b'));
    expect(g.state.turn).toBe('sea');
    expect(g.act(pick('b')).ok).toBe(true); // Sea may pick the same kind
    expect(g.act(pick('b')).ok).toBe(false); // Land already has its Goat
    ok(g, pick('r'));
    ok(g, pick('q'));
    expect(g.state.round).toBe(1);
    expect(g.state.turn).toBe('land');
    expect(g.state.phase).toBe('action');
    expect(g.state.stage).toBe('move');
    expect(g.state.draft!.picks).toEqual({ land: ['b', 'r'], sea: ['b', 'q'] });
    const ids = g.state.pieces.map((p) => `${p.id}`).sort();
    expect(ids).toEqual(['land-b-c2', 'land-r-f2', 'sea-b-c7', 'sea-q-f7']);
    const acted = rec.events.filter(([n]) => n === 'acted').map(([, p]) => p as ArenaEventMap['acted']);
    expect(acted).toHaveLength(4);
    expect(acted.slice(0, 3).every((a) => a.changes.length === 0)).toBe(true);
    const enter = acted[3].changes;
    expect(enter.map((c) => c.type === 'enter' && c.step === 0 && c.piece.square)).toEqual(['c2', 'c7', 'f2', 'f7']);
    // The last pick: acted · logged · state, then the end of the turn and the start of Land's.
    const tail = rec.names.slice(rec.names.lastIndexOf('acted'));
    expect(tail).toEqual(['acted', 'logged', 'state', 'state', 'turnChanged', 'state']);
    expect(rec.names).not.toContain('rolled');
  });

  it('refuses moves during the draft and picks after it', () => {
    const g = arenaGame('castle');
    expect(g.act(step('land-b-c2', 'c3')).ok).toBe(false);
    expect(g.act(END).ok).toBe(false);
    for (const k of ['p', 'n', 'k', 'q'] as const) ok(g, pick(k));
    expect(g.act(pick('b')).ok).toBe(false);
  });
});

describe('castle: moving', () => {
  it('goes up at most 1 level and down any number', () => {
    const g = castleGame({ d4: 'land-p', h8: 'sea-p' }, { d4: 1, d5: 2, e5: 3, c4: 0, c3: 0, e3: 3 });
    const s = steps(g, id('land', 'p', 'd4'));
    expect(s).toContain('d5'); // +1
    expect(s).not.toContain('e5'); // +2
    expect(s).toContain('c3'); // -1
    expect(s).not.toContain('e3'); // +2
    const g2 = castleGame({ d4: 'land-p', h8: 'sea-p' }, { d4: 3 });
    expect(steps(g2, id('land', 'p', 'd4'))).toHaveLength(8); // down 3 is fine
  });

  it('steps only onto empty squares', () => {
    const g = castleGame({ d4: 'land-p', d5: 'sea-p', e5: 'land-r' });
    const s = steps(g, id('land', 'p', 'd4'));
    expect(s).not.toContain('d5');
    expect(s).not.toContain('e5');
    expect(s).toHaveLength(6);
  });

  it('Climber goes up 2', () => {
    const g = castleGame({ d4: 'land-b', h8: 'sea-p' }, { d5: 2, e5: 3 });
    expect(steps(g, id('land', 'b', 'd4'))).toContain('d5');
    expect(steps(g, id('land', 'b', 'd4'))).not.toContain('e5');
    expect(g.pieceOptions(id('land', 'b', 'd4')).power).toMatchObject({ name: 'Climber', line: 'It may go up 2 levels in one step.', available: true });
  });

  it('Leaper may hop like a knight, still up at most 1', () => {
    const g = castleGame({ d4: 'land-n', h8: 'sea-p' }, { e6: 1, c6: 2, f5: 0, b3: 3 }, 'land');
    g.raw.levels[27] = 0;
    const s = steps(g, id('land', 'n', 'd4'));
    expect(s).toEqual(expect.arrayContaining(['e6', 'f5', 'f3', 'e2', 'c2', 'b5']));
    expect(s).not.toContain('c6');
    expect(s).not.toContain('b3');
    ok(g, step(id('land', 'n', 'd4'), 'e6'));
    expect(at(g, id('land', 'n', 'd4'))).toBe('e6');
  });

  it('Zoomer may take 2 steps, each up at most 1, never through an animal', () => {
    const g = castleGame({ a1: 'land-k', b2: 'sea-p', h8: 'sea-q' }, { a2: 1, a3: 2, b1: 3 });
    const s = steps(g, id('land', 'k', 'a1'));
    expect(s).toContain('a3'); // a1 (0) → a2 (1) → a3 (2)
    expect(s).toContain('b3'); // via a2
    expect(s).not.toContain('b1'); // +3 from a1, +2 from a2
    expect(s).not.toContain('c2'); // only reachable through b1 (+2) or b2 (an animal)
    expect(s).not.toContain('c1'); // through b1 or b2 only
    const rec = recordBoard(g);
    ok(g, step(id('land', 'k', 'a1'), 'a3'));
    const moves = (rec.events.find(([n]) => n === 'acted')![1] as ArenaEventMap['acted']).changes;
    expect(moves).toEqual([
      { step: 0, type: 'move', pieceId: 'land-k-a1', from: 'a1', to: 'a2', how: 'step' },
      { step: 1, type: 'move', pieceId: 'land-k-a1', from: 'a2', to: 'a3', how: 'step' },
    ]);
  });

  it('the animal that moved is the one that shapes, next to where it now stands', () => {
    const g = castleGame({ d4: 'land-p', f4: 'land-r', h8: 'sea-p' });
    ok(g, step(id('land', 'p', 'd4'), 'd5'));
    expect(g.state.stage).toBe('shape');
    expect(g.state.mover).toBe('land-p-d4');
    expect(sorted(g.shapeOptions().map((o) => o.square))).toEqual(sorted(['c4', 'd4', 'e4', 'c5', 'e5', 'c6', 'd6', 'e6'] as Square[]));
    expect(g.pieceOptions(id('land', 'r', 'f4')).steps).toEqual([]);
    expect(g.act(shape('f5', 'up', 'land-p-d4')).ok).toBe(false);
    expect(g.act(shape('d6', 'up', 'land-r-f4')).ok).toBe(false); // wrong animal
    ok(g, shape('d6', 'up', 'land-p-d4'));
    expect(g.state.levels).toEqual({ d6: 1 });
    expect(g.state.turn).toBe('sea');
  });
});

describe('castle: building and digging', () => {
  it('build caps at 3, dig stops at 0, no building on animals', () => {
    const g = castleGame({ d4: 'land-p', e5: 'sea-p', h8: 'sea-q' }, { c5: 3, d5: 2 });
    g.raw.stage = 'shape';
    g.raw.mover = 'land-p-d4';
    const opts = new Map(g.shapeOptions().map((o) => [o.square, o]));
    expect(opts.get('c5')).toMatchObject({ up: false, down: true });
    expect(opts.get('c4')).toMatchObject({ up: true, down: false });
    expect(opts.get('d5')).toMatchObject({ up: true, down: true });
    expect(opts.get('e5')).toBeUndefined(); // an enemy on flat ground: no build, nothing to dig
    expect(g.act(shape('c4', 'down', 'land-p-d4')).ok).toBe(false);
    expect(g.act(shape('c5', 'up', 'land-p-d4')).ok).toBe(false);
    expect(g.act(shape('e5', 'up', 'land-p-d4')).ok).toBe(false);
    expect(g.state.turn).toBe('land'); // still shaping
  });

  it('digs under an enemy (it rides down) but not under its own animal', () => {
    const g = castleGame({ d4: 'land-r', e5: 'sea-p', c5: 'land-p', h8: 'sea-q' }, { e5: 2, c5: 2 });
    g.raw.stage = 'shape';
    g.raw.mover = 'land-r-d4';
    const opts = new Map(g.shapeOptions().map((o) => [o.square, o]));
    expect(opts.get('e5')).toMatchObject({ up: false, down: true });
    expect(opts.get('c5')).toBeUndefined();
    const rec = recordBoard(g);
    ok(g, shape('e5', 'down', 'land-r-d4'));
    const acted = rec.events.find(([n]) => n === 'acted')![1] as ArenaEventMap['acted'];
    expect(acted.changes).toEqual([{ step: 0, type: 'level', square: 'e5', from: 2, to: 1, cause: 'dig', by: 'land-r-d4' }]);
    expect(at(g, 'sea-p-e5')).toBe('e5');
    expect(g.state.levels!.e5).toBe(1);
  });

  it('Builder adds 2 (only 1 onto a level 2)', () => {
    const g = castleGame({ d4: 'land-r', h8: 'sea-p' }, { d5: 2 });
    ok(g, step(id('land', 'r', 'd4'), 'd3'));
    const opts = new Map(g.shapeOptions().map((o) => [o.square, o]));
    expect(opts.get('c2')).toMatchObject({ up: true, upBy: 2 });
    expect(opts.get('d4')).toMatchObject({ up: true, upBy: 2 });
    ok(g, shape('c2', 'up', 'land-r-d4'));
    expect(g.state.levels!.c2).toBe(2);
    const g2 = castleGame({ d4: 'land-r', h8: 'sea-p' }, { d5: 2 });
    g2.raw.stage = 'shape';
    g2.raw.mover = 'land-r-d4';
    expect(g2.shapeOptions().find((o) => o.square === 'd5')).toMatchObject({ up: true, upBy: 1 });
    ok(g2, shape('d5', 'up', 'land-r-d4'));
    expect(g2.state.levels!.d5).toBe(3);
  });

  it('Digger may dig once more (same square or another), or end the turn', () => {
    const g = castleGame({ d4: 'land-p', h8: 'sea-p' }, { d5: 2, c3: 1 });
    ok(g, step(id('land', 'p', 'd4'), 'c4'));
    ok(g, shape('d5', 'down', 'land-p-d4'));
    expect(g.state.stage).toBe('more');
    expect(g.state.turn).toBe('land');
    expect(g.shapeOptions().every((o) => !o.up)).toBe(true);
    expect(sorted(g.shapeOptions().map((o) => o.square))).toEqual(['c3', 'd5']);
    ok(g, shape('d5', 'down', 'land-p-d4'));
    expect(g.state.levels!.d5).toBeUndefined();
    expect(g.state.turn).toBe('sea');

    const g2 = castleGame({ d4: 'land-p', h8: 'sea-p' }, { d5: 1 });
    ok(g2, step(id('land', 'p', 'd4'), 'c4'));
    ok(g2, shape('d5', 'down', 'land-p-d4'));
    // Nothing left to dig: the optional stage is skipped.
    expect(g2.state.turn).toBe('sea');

    const g3 = castleGame({ d4: 'land-p', h8: 'sea-p' }, { d5: 2 });
    ok(g3, step(id('land', 'p', 'd4'), 'c4'));
    ok(g3, shape('d5', 'down', 'land-p-d4'));
    ok(g3, END);
    expect(g3.state.turn).toBe('sea');
    expect(g3.state.levels!.d5).toBe(1);

    const g4 = castleGame({ d4: 'land-p', h8: 'sea-p' }, { d5: 2 });
    ok(g4, step(id('land', 'p', 'd4'), 'c4'));
    ok(g4, shape('b4', 'up', 'land-p-d4'));
    expect(g4.state.turn).toBe('sea'); // a build gets no second go
  });

  it('end turn is only for the optional second dig', () => {
    const g = castleGame({ d4: 'land-p', h8: 'sea-p' });
    expect(g.act(END).ok).toBe(false);
    ok(g, step(id('land', 'p', 'd4'), 'c4'));
    expect(g.act(END).ok).toBe(false);
  });
});

describe('castle: the Shover', () => {
  it('pushes a neighbouring enemy 1 square: up at most 1, down any, onto empty squares on the board', () => {
    const g = castleGame(
      { d4: 'land-q', d5: 'sea-p', e5: 'sea-n', c5: 'sea-k', c4: 'sea-r', a1: 'sea-b' },
      { d6: 1, d5: 0, f6: 2, e5: 0, c4: 3, b4: 0 },
    );
    const hits = sorted(g.pieceOptions(id('land', 'q', 'd4')).hits);
    // d5 → d6 (+1) fine · e5 → f6 (+2) no · c5 → b6 fine · c4 → b4 (down 3) fine
    expect(hits).toEqual(['c4', 'c5', 'd5']);
    expect(g.pieceOptions(id('land', 'q', 'd4')).power.name).toBe('Shover');
    expect(g.previewArea({ pieceId: 'land-q-d4', hit: 'c4' }).area).toEqual(['c4', 'b4']);
    const rec = recordBoard(g);
    ok(g, hit('land-q-d4', 'c4'));
    expect(at(g, 'sea-r-c4')).toBe('b4');
    expect((rec.events.find(([n]) => n === 'acted')![1] as ArenaEventMap['acted']).changes).toEqual([
      { step: 0, type: 'move', pieceId: 'sea-r-c4', from: 'c4', to: 'b4', how: 'pushed' },
    ]);
    expect(g.state.stage).toBe('shape');
    expect(g.state.mover).toBe('land-q-d4');
    expect(g.shapeOptions().map((o) => o.square)).toContain('c4'); // shapes next to itself
  });

  it("can't push off the board or onto an animal", () => {
    // a1 would go off the board; c1 and b2 have an animal behind them.
    const g = castleGame({ b1: 'land-q', a1: 'sea-p', c1: 'sea-n', d1: 'land-r', b2: 'sea-k', b3: 'land-p' });
    expect(g.pieceOptions(id('land', 'q', 'b1')).hits).toEqual([]);
  });

  it('only the Shover pushes', () => {
    const g = castleGame({ d4: 'land-r', d5: 'sea-p' });
    expect(g.pieceOptions(id('land', 'r', 'd4')).hits).toEqual([]);
    expect(g.act(hit('land-r-d4', 'd5')).ok).toBe(false);
  });
});

describe('castle: holding the castle', () => {
  const crowned = (rec: ReturnType<typeof recordBoard>) =>
    rec.events.filter(([n]) => n === 'crowned').map(([, p]) => (p as ArenaEventMap['crowned']).crowned);

  it('wins at the start of your next turn, not straight away', () => {
    const g = castleGame({ d4: 'land-b', a8: 'sea-p', h8: 'sea-n' }, { d4: 1, d5: 3 });
    const rec = recordBoard(g);
    ok(g, step(id('land', 'b', 'd4'), 'd5'));
    expect(g.state.phase).toBe('action');
    expect(g.state.crowned).toEqual({ pieceId: 'land-b-d4', side: 'land', square: 'd5' });
    expect(crowned(rec)).toEqual([{ pieceId: 'land-b-d4', side: 'land', square: 'd5' }]);
    expect(rec.names.slice(rec.names.indexOf('acted'))).toEqual(['acted', 'logged', 'state', 'crowned']);
    ok(g, shape('e4', 'up', 'land-b-d4'));
    expect(g.state.turn).toBe('sea');
    ok(g, step('sea-p-a8', 'a7'));
    ok(g, shape('a6', 'up', 'sea-p-a8'));
    expect(g.state.phase).toBe('over');
    const over = rec.events.find(([n]) => n === 'gameOver')![1];
    expect(over).toEqual({ winner: 'land', reason: 'castle' });
    // The last shape: acted · logged · state, the end of Sea's turn: state · turnChanged, then Land still holds it.
    const tail = rec.names.slice(rec.names.lastIndexOf('acted'));
    expect(tail).toEqual(['acted', 'logged', 'state', 'state', 'turnChanged', 'state', 'gameOver']);
  });

  it('a dug castle cancels it', () => {
    const g = castleGame({ d4: 'land-b', e7: 'sea-p', h8: 'sea-n' }, { d4: 1, d5: 3 });
    const rec = recordBoard(g);
    ok(g, step(id('land', 'b', 'd4'), 'd5'));
    ok(g, shape('c4', 'up', 'land-b-d4'));
    ok(g, step('sea-p-e7', 'e6'));
    ok(g, shape('d5', 'down', 'sea-p-e7'));
    expect(g.state.levels!.d5).toBe(2);
    expect(g.state.crowned).toBeNull();
    expect(crowned(rec)).toEqual([{ pieceId: 'land-b-d4', side: 'land', square: 'd5' }, null]);
    ok(g, END); // the Digger skips its second dig
    expect(g.state.phase).toBe('action');
    expect(g.state.turn).toBe('land');
  });

  it('a push off the castle cancels it', () => {
    const g2 = castleGame({ d5: 'land-b', e6: 'sea-q', h8: 'sea-n' }, { d5: 3, c4: 1 }, 'sea');
    expect(g2.state.crowned).toMatchObject({ pieceId: 'land-b-d5' });
    ok(g2, hit('sea-q-e6', 'd5'));
    expect(at(g2, 'land-b-d5')).toBe('c4');
    expect(g2.state.crowned).toBeNull();
    ok(g2, shape('f7', 'up', 'sea-q-e6'));
    expect(g2.state.phase).toBe('action');
    expect(g2.state.turn).toBe('land');
  });

  it('crowned prefers the side that would win next', () => {
    const g = castleGame({ d5: 'land-b', a7: 'sea-b', h8: 'sea-n' }, { d5: 3, a6: 3, a7: 1 }, 'sea');
    expect(g.state.crowned).toMatchObject({ side: 'land' });
    ok(g, step('sea-b-a7', 'a6'));
    expect(g.state.crowned).toMatchObject({ side: 'land' });
  });
});

describe('castle: the tide', () => {
  it('wears empty beach squares down one level at the end of every 5th round', () => {
    const g = castleGame(
      { a1: 'land-p', h1: 'land-n', a8: 'sea-p', e5: 'sea-n' },
      { c3: 2, c4: 1, c5: 2, d6: 1, e5: 2, h8: 3, b8: 0 },
    );
    g.raw.round = 5;
    expect(g.state.nextTideIn).toBe(1);
    ok(g, step('land-p-a1', 'a2'));
    ok(g, shape('b1', 'up', 'land-p-a1'));
    const rec = recordBoard(g);
    ok(g, step('sea-p-a8', 'b8'));
    ok(g, shape('a8', 'up', 'sea-p-a8'));
    const tide = rec.events.find(([n]) => n === 'tide')![1] as ArenaEventMap['tide'];
    const by = (sq: string) => tide.changes.find((c) => c.type === 'level' && c.square === sq) as Extract<BoardChange, { type: 'level' }> | undefined;
    expect(by('c5')).toEqual({ step: 0, type: 'level', square: 'c5', from: 2, to: 1, cause: 'tide' });
    expect(by('d6')?.to).toBe(0);
    expect(by('h8')?.to).toBe(2);
    expect(by('a8')?.to).toBe(0); // built this turn, still empty: worn back down
    expect(by('e5')).toBeUndefined(); // an animal stands on it
    expect(by('c4')).toBeUndefined(); // the meadow never wears
    expect(by('c3')).toBeUndefined();
    expect(tide.changes.every((c) => c.step === 0)).toBe(true);
    const k = rec.names.indexOf('tide');
    expect(rec.names.slice(k, k + 4)).toEqual(['tide', 'logged', 'state', 'turnChanged']);
    expect(g.state.round).toBe(6);
    expect(g.state.nextTideIn).toBe(5);
    expect(g.state.levels).toEqual({ c3: 2, c4: 1, c5: 1, e5: 2, h8: 2, b1: 1 });
  });

  it('counts down and stops before the last round', () => {
    const g = castleGame({ a1: 'land-p', a8: 'sea-p' });
    expect(g.state.nextTideIn).toBe(5);
    g.raw.round = 3;
    expect(g.state.nextTideIn).toBe(3);
    g.raw.round = 26;
    expect(g.state.nextTideIn).toBeNull();
  });
});

describe('castle: passing and the end', () => {
  // Land's Pup on h1 is boxed in: every neighbour is 2+ levels up.
  const boxedLand = { g1: 3, g2: 3, h2: 3 };

  it('a side that can do nothing passes', () => {
    const g = castleGame({ h1: 'land-p', d4: 'sea-n' }, boxedLand, 'sea');
    const rec = recordBoard(g);
    ok(g, step('sea-n-d4', 'd5'));
    ok(g, shape('d6', 'up', 'sea-n-d4'));
    const passes = rec.events.filter(([n, p]) => n === 'logged' && (p as ArenaEventMap['logged']).kind === 'pass');
    expect(passes).toHaveLength(1);
    expect((passes[0][1] as ArenaEventMap['logged']).side).toBe('land');
    expect(g.state.turn).toBe('sea');
    expect(g.state.round).toBe(2);
    expect(g.state.phase).toBe('action');
  });

  it('nobody able to move for a whole round is a draw', () => {
    // Sea's Builder steps a8→b7 and builds a8 up by 2: it boxes itself in.
    const g = castleGame(
      { h1: 'land-p', a8: 'sea-r' },
      { ...boxedLand, a7: 3, b8: 3, a6: 2, b6: 2, c6: 2, c7: 2, c8: 2 }, 'sea',
    );
    const rec = recordBoard(g);
    ok(g, step('sea-r-a8', 'b7'));
    ok(g, shape('a8', 'up', 'sea-r-a8'));
    const passes = rec.events.filter(([n, p]) => n === 'logged' && (p as ArenaEventMap['logged']).kind === 'pass');
    expect(passes.map(([, p]) => (p as ArenaEventMap['logged']).side)).toEqual(['land', 'sea']);
    expect(rec.events.find(([n]) => n === 'gameOver')![1]).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('after round 30 it is a draw', () => {
    const g = castleGame({ a1: 'land-p', h8: 'sea-p' });
    g.raw.round = 30;
    const rec = recordBoard(g);
    ok(g, step('land-p-a1', 'a2'));
    ok(g, shape('b2', 'up', 'land-p-a1'));
    ok(g, step('sea-p-h8', 'h7'));
    ok(g, shape('g7', 'up', 'sea-p-h8'));
    expect(rec.events.find(([n]) => n === 'gameOver')![1]).toEqual({ winner: null, reason: 'rounds' });
    expect(g.state.round).toBe(30);
  });
});
