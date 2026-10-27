import { describe, expect, it } from 'vitest';
import type { Square } from '../../contracts/types';
import { flush } from '../testUtils';
import { sqIndex } from './state';
import { at, idAt, modeGame, mv, ok, pw, record } from './testkit';

type G = ReturnType<typeof modeGame>;
const block = (g: G, sq: string, turnsLeft = 3) => g.state.blocks.push({ sq: sqIndex(sq), by: 'sea', turnsLeft });
const stun = (g: G, id: string, status: 'stunned' | 'frozen' = 'stunned', turnsLeft = 1) => g.state.statuses.push({ id, status, turnsLeft });
const opts = (g: G, pieceId: string, targets: Square[] = []) => g.targets({ type: 'power', pieceId, targets }).squares.sort();

async function until(cond: () => boolean): Promise<void> {
  for (let n = 0; n < 200 && !cond(); n++) await flush();
}

describe('Normal: sidestep (pawn)', () => {
  const FEN = '4k3/8/8/8/8/8/3P4/4K3 w - - 0 1';

  it('moves one square sideways onto an empty square, then is used', () => {
    const g = modeGame('normal', FEN);
    expect(opts(g, 'land-p-d2')).toEqual(['c2', 'e2']);
    const log = record(g);
    ok(g, pw('land-p-d2', 'c2'));
    expect(at(g, 'land-p-d2')).toBe('c2');
    expect(log.names()).toEqual(['powerUsed', 'logged', 'modeState', 'turnChanged']);
    expect(log.last('powerUsed')!.changes).toEqual([{ step: 0, type: 'move', pieceId: 'land-p-d2', from: 'd2', to: 'c2', how: 'sidestep' }]);
    expect(log.last('logged')).toEqual({ side: 'land', kind: 'power', label: 'Pup: Sidestep d2→c2' });
    expect(g.modeState.land.powersUsed).toEqual(['land-p-d2']);
    expect(g.state.halfmove).toBe(0); // an own pawn move resets the fifty-move count
    ok(g, mv('e8', 'd8'));
    expect(g.powerInfo('land-p-d2')).toMatchObject({ available: false, reason: 'used' });
    expect(g.act(pw('land-p-d2', 'b2')).ok).toBe(false);
  });

  it('is stopped by pieces and blocked squares', () => {
    const g = modeGame('normal', '4k3/8/8/8/8/8/2NP4/4K3 w - - 0 1');
    block(g, 'e2');
    expect(g.powerInfo('land-p-d2')).toMatchObject({ available: false, reason: 'noTarget' });
    expect(g.act(pw('land-p-d2', 'e2')).ok).toBe(false);
  });

  it('a stunned pawn can neither move nor use its power', () => {
    const g = modeGame('normal', FEN);
    stun(g, 'land-p-d2');
    expect(g.powerInfo('land-p-d2')).toMatchObject({ available: false, reason: 'stunned' });
    expect(g.legalTargets('d2')).toEqual([]);
  });

  it("can't leave the own king in check (the pawn is pinned by the b4 bishop)", () => {
    const g = modeGame('normal', '4k3/8/8/8/1b6/8/3P4/4K3 w - - 0 1');
    expect(g.powerInfo('land-p-d2')).toMatchObject({ available: false, reason: 'noTarget' });
  });

  it('other reasons: not your turn, classic', () => {
    const g = modeGame('normal', FEN);
    expect(g.powerInfo('sea-k-e8')).toMatchObject({ available: false, reason: 'notYourTurn' });
  });
});

describe('Normal: double jump (knight)', () => {
  it('hops to an empty square, then may capture; changes come in three steps', () => {
    const g = modeGame('normal', '4k3/8/8/4p3/8/8/8/4K1N1 w - - 0 1');
    expect(opts(g, 'land-n-g1')).toEqual(['e2', 'f3', 'h3']);
    const second = opts(g, 'land-n-g1', ['f3']);
    expect(second).toContain('e5');
    expect(second).not.toContain('g1'); // can't end where it started
    const log = record(g);
    ok(g, pw('land-n-g1', 'f3', 'e5'));
    expect(log.last('powerUsed')!.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-n-g1', from: 'g1', to: 'f3', how: 'jump' },
      { step: 1, type: 'capture', pieceId: 'sea-p-e5', square: 'e5', by: 'land-n-g1' },
      { step: 2, type: 'move', pieceId: 'land-n-g1', from: 'f3', to: 'e5', how: 'jump' },
    ]);
    expect(at(g, 'land-n-g1')).toBe('e5');
    expect(g.state.halfmove).toBe(0);
  });

  it('without a capture the steps are 0 and 1', () => {
    const g = modeGame('normal', '4k3/7p/8/8/8/8/8/4K1N1 w - - 0 1');
    const log = record(g);
    ok(g, pw('land-n-g1', 'f3', 'g5'));
    expect(log.last('powerUsed')!.changes.map((c) => c.step)).toEqual([0, 1]);
  });

  it('the first hop needs an empty square, and it never takes the king in Normal', () => {
    const g = modeGame('normal', '8/8/8/8/3k4/5P2/8/4K1N1 w - - 0 1');
    expect(opts(g, 'land-n-g1')).toEqual(['e2', 'h3']); // f3 is taken by the own pawn
    expect(opts(g, 'land-n-g1', ['e2'])).not.toContain('d4');
    expect(g.act(pw('land-n-g1', 'e2', 'd4')).ok).toBe(false);
  });
});

describe('Normal: headbutt (bishop)', () => {
  it('pushes a neighbouring enemy one square straight away; the bishop stays', () => {
    const g = modeGame('normal', '4k3/8/8/4n3/3B4/8/8/4K3 w - - 0 1');
    expect(g.previewArea({ type: 'power', pieceId: 'land-b-d4', targets: ['e5'] })).toEqual(['f6']);
    const log = record(g);
    ok(g, pw('land-b-d4', 'e5'));
    expect(at(g, 'sea-n-e5')).toBe('f6');
    expect(at(g, 'land-b-d4')).toBe('d4');
    expect(log.last('powerUsed')!.changes).toEqual([{ step: 0, type: 'move', pieceId: 'sea-n-e5', from: 'e5', to: 'f6', how: 'pushed' }]);
  });

  it("can't push off the board, or a pawn onto the last rank", () => {
    const g = modeGame('normal', '4k2n/4p1B1/3B4/8/8/8/8/4K3 w - - 0 1');
    expect(g.powerInfo('land-b-g7')).toMatchObject({ available: false, reason: 'noTarget' }); // h8 would go off the board
    expect(opts(g, 'land-b-d6')).toEqual([]); // e7 pawn would land on f8
  });

  it("can't push into a piece or a blocked square", () => {
    const g = modeGame('normal', '4k3/8/5p2/4n3/3B4/8/8/4K3 w - - 0 1');
    expect(opts(g, 'land-b-d4')).toEqual([]);
    const h = modeGame('normal', '4k3/8/8/4n3/3B4/8/8/4K3 w - - 0 1');
    block(h, 'f6');
    expect(opts(h, 'land-b-d4')).toEqual([]);
  });

  it('can push the king, which loses castling for good', () => {
    const g = modeGame('normal', 'r2Bk3/8/8/8/8/8/8/4K3 w q - 0 1');
    ok(g, pw('land-b-d8', 'e8'));
    expect(at(g, 'sea-k-e8')).toBe('f8');
    expect(g.fen.split(' ')[2]).toBe('-');
  });

  it("can't open a line onto your own king", () => {
    // The e4 knight shields the e1 king from the e8 rook; pushing it away is illegal.
    const g = modeGame('normal', '4r2k/8/8/8/4n3/3B4/8/4K3 w - - 0 1');
    expect(opts(g, 'land-b-d3')).toEqual([]);
  });
});

describe('Normal: stomp (rook)', () => {
  it('stuns every enemy neighbour except the king, for one turn', () => {
    const g = modeGame('normal', '8/8/8/2p1k3/3R4/4n3/8/4K3 w - - 0 1');
    expect(g.previewArea({ type: 'power', pieceId: 'land-r-d4', targets: [] }).sort()).toEqual(['c5', 'e3']);
    expect(g.targets({ type: 'power', pieceId: 'land-r-d4', targets: [] })).toMatchObject({ squares: [], complete: true });
    const log = record(g);
    ok(g, pw('land-r-d4'));
    expect(log.last('powerUsed')!.changes).toEqual([
      { step: 0, type: 'status', pieceId: 'sea-p-c5', status: 'stunned' },
      { step: 0, type: 'status', pieceId: 'sea-n-e3', status: 'stunned' },
    ]);
    expect(g.modeState.statuses).toEqual([
      { pieceId: 'sea-p-c5', status: 'stunned', turnsLeft: 1 },
      { pieceId: 'sea-n-e3', status: 'stunned', turnsLeft: 1 },
    ]);
    expect(g.legalTargets('e3')).toEqual([]);
    expect(g.powerInfo('sea-n-e3')).toMatchObject({ available: false, reason: 'stunned' });
    ok(g, mv('e5', 'e6'));
    expect(g.modeState.statuses).toEqual([]); // worn off at the end of Sea's turn
    expect(g.act(mv('e1', 'f1')).ok).toBe(false); // the stunned knight still covers f1
    ok(g, mv('e1', 'e2'));
    expect(g.legalTargets('e3').length).toBeGreaterThan(0);
  });

  it('needs an enemy neighbour that is not the king', () => {
    const g = modeGame('normal', '8/8/8/4k3/3R4/8/8/4K3 w - - 0 1');
    expect(g.powerInfo('land-r-d4')).toMatchObject({ available: false, reason: 'noTarget' });
  });

  it("a frozen piece keeps its longer status, and the king is never stunned", () => {
    const g = modeGame('normal', '8/8/8/2p1k3/3R4/8/8/4K3 w - - 0 1');
    stun(g, 'sea-p-c5', 'frozen', 2);
    const log = record(g);
    ok(g, pw('land-r-d4'));
    expect(log.last('powerUsed')!.changes).toEqual([]);
    expect(g.modeState.statuses).toEqual([{ pieceId: 'sea-p-c5', status: 'frozen', turnsLeft: 2 }]);
  });

  it('stunned pieces still give check', () => {
    const g = modeGame('normal', '4k3/8/8/8/8/8/4q3/R3K3 w - - 0 1');
    stun(g, 'sea-q-e2');
    expect(g.legalTargets('e1')).not.toContain('d1'); // still covered by the stunned queen
    expect(g.legalTargets('e1')).toContain('e2');
  });
});

describe('Normal: block (queen)', () => {
  it('walls off sliders, lets knights jump over, and vanishes after 4 plies', () => {
    const g = modeGame('normal', '4k3/8/8/8/8/8/8/R2QK1N1 w - - 0 1');
    const log = record(g);
    ok(g, pw('land-q-d1', 'a4'));
    expect(log.last('powerUsed')!.changes).toEqual([{ step: 0, type: 'block', square: 'a4', by: 'land' }]);
    expect(g.modeState.squares).toEqual([{ square: 'a4', effect: 'blocked', by: 'land', turnsLeft: 3 }]);
    ok(g, mv('e8', 'f8'));
    expect(g.legalTargets('a1')).toContain('a3');
    expect(g.legalTargets('a1')).not.toContain('a4');
    expect(g.legalTargets('a1')).not.toContain('a5');
    ok(g, mv('g1', 'f3'));
    expect(g.modeState.squares[0].turnsLeft).toBe(1);
    ok(g, mv('f8', 'e8'));
    expect(g.modeState.squares).toEqual([]); // gone at the start of Land's second turn after placing it
    expect(g.legalTargets('a1')).toContain('a8');
  });

  it('knights jump over a block but cannot land on it', () => {
    const g = modeGame('normal', '4k3/8/8/8/8/8/6P1/4K1N1 w - - 0 1');
    block(g, 'f2');
    block(g, 'h3');
    expect(g.legalTargets('g1').sort()).toEqual(['e2', 'f3']);
  });

  it('a block that makes a back-rank mate possible', () => {
    // The sea king's only flight square is h7 (escape already spent).
    const FEN = '6k1/1p3pp1/7p/8/8/8/8/R2QK3 w - - 0 1';
    const plain = modeGame('normal', FEN);
    plain.state.sea.powersUsed.push('sea-k-g8');
    ok(plain, mv('d1', 'd2'));
    ok(plain, mv('b7', 'b6'));
    ok(plain, mv('a1', 'a8'));
    expect(plain.isOver()).toBeNull(); // Kh7

    const g = modeGame('normal', FEN);
    g.state.sea.powersUsed.push('sea-k-g8');
    ok(g, pw('land-q-d1', 'h7'));
    ok(g, mv('b7', 'b6'));
    ok(g, mv('a1', 'a8'));
    expect(g.isOver()).toEqual({ winner: 'land', reason: 'checkmate' });
    expect(g.history.at(-1)!.san).toBe('Ra8#');
  });

  it('stops castling through it, double pushes through it and en passant onto it', () => {
    const g = modeGame('normal', '4k3/8/8/8/8/8/4P3/4K2R w K - 0 1');
    expect(g.legalTargets('e1')).toContain('g1');
    expect(g.legalTargets('e2').sort()).toEqual(['e3', 'e4']);
    block(g, 'f1');
    block(g, 'e3');
    expect(g.legalTargets('e1')).not.toContain('g1');
    expect(g.legalTargets('e2')).toEqual([]);
    const ep = modeGame('normal', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    expect(ep.legalTargets('e5')).toContain('d6');
    block(ep, 'd6');
    expect(ep.legalTargets('e5')).not.toContain('d6');
  });

  it('can be placed to block a check', () => {
    const g = modeGame('normal', '4r2k/8/8/8/8/8/8/3QK3 w - - 0 1');
    const sq = opts(g, 'land-q-d1');
    expect(sq).toEqual(['e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
  });
});

describe('Normal: escape (king)', () => {
  it('teleports up to 2 squares away, and loses castling', () => {
    const g = modeGame('normal', 'r3k3/8/8/8/8/8/8/4K2R w K - 0 1');
    const sq = opts(g, 'land-k-e1');
    expect(sq).toHaveLength(14);
    expect(sq).not.toContain('a1');
    const log = record(g);
    ok(g, pw('land-k-e1', 'c2'));
    expect(log.last('powerUsed')!.changes[0]).toEqual({ step: 0, type: 'move', pieceId: 'land-k-e1', from: 'e1', to: 'c2', how: 'teleport' });
    expect(g.fen.split(' ')[2]).toBe('-');
  });

  it('answers a check, but only onto a safe square', () => {
    const g = modeGame('normal', '4k3/8/8/8/8/3n4/3PPP2/3QKB2 w - - 0 1');
    expect(g.legalTargets('e1')).toEqual([]);
    expect(opts(g, 'land-k-e1')).toEqual(['c2', 'c3', 'e3', 'f3', 'g1', 'g2', 'g3']); // c1 is covered by the knight
    ok(g, pw('land-k-e1', 'g2'));
    expect(g.isOver()).toBeNull();
  });
});

describe('Normal: endings and bookkeeping', () => {
  it('stalemate caused by stuns', () => {
    // The sea king has no squares and its escape is spent; the a6 pawn is its last mover until the stomp.
    const g = modeGame('normal', '7k/1R6/p5Q1/8/8/8/8/K7 w - - 0 1');
    g.state.sea.powersUsed.push('sea-k-h8');
    ok(g, pw('land-r-b7'));
    expect(g.isOver()).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('threefold repetition counts the mode state too', () => {
    const land: [Square, Square][] = [['g1', 'f3'], ['f3', 'g1']];
    const sea: [Square, Square][] = [['g8', 'f6'], ['f6', 'g8']];
    const plain = modeGame('normal');
    let plies = 0;
    while (!plain.isOver() && plies < 20) {
      const [f, t] = (plies % 2 ? sea : land)[Math.floor(plies / 2) % 2];
      ok(plain, mv(f, t));
      plies++;
    }
    expect(plain.isOver()).toEqual({ winner: null, reason: 'threefold' });
    expect(plies).toBe(8);

    // Spend a power first: the block counts down, then the queen's used power keeps the start position from coming back.
    const g = modeGame('normal');
    ok(g, pw('land-q-d1', 'a4'));
    plies = 1;
    let k = 0;
    while (!g.isOver() && plies < 30) {
      const [f, t] = (k % 2 ? land : sea)[Math.floor(k / 2) % 2];
      ok(g, mv(f, t));
      plies++;
      k++;
    }
    expect(g.isOver()).toEqual({ winner: null, reason: 'threefold' });
    expect(plies).toBe(12); // the repeated position first appears after ply 4, once the block is gone
  });

  it('fifty-move rule', () => {
    const g = modeGame('normal', '4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
    ok(g, mv('a1', 'a2'));
    expect(g.isOver()).toEqual({ winner: null, reason: 'fiftyMove' });
  });

  it('undo restores powers, statuses and blocks', () => {
    const g = modeGame('normal', '4k3/8/8/2p5/3R4/8/8/3QK3 w - - 0 1');
    ok(g, pw('land-r-d4'));
    ok(g, mv('e8', 'e7'));
    ok(g, pw('land-q-d1', 'h5'));
    expect(g.modeState.land.powersUsed.sort()).toEqual(['land-q-d1', 'land-r-d4']);
    expect(g.modeState.squares).toHaveLength(1);
    const log = record(g);
    g.undo();
    expect(log.names()).toEqual(['undone', 'modeState', 'turnChanged']);
    expect(g.modeState.squares).toHaveLength(0);
    expect(g.modeState.land.powersUsed).toEqual(['land-r-d4']);
    g.undo();
    expect(g.modeState.statuses).toEqual([{ pieceId: 'sea-p-c5', status: 'stunned', turnsLeft: 1 }]);
    g.undo();
    expect(g.modeState.land.powersUsed).toEqual([]);
    expect(g.modeState.statuses).toEqual([]);
    expect(g.log).toEqual([]);
    expect(at(g, 'sea-k-e8')).toBe('e8');
  });

  it('undo against the bot takes back the bot reply too', async () => {
    const g = modeGame('normal', undefined, { opponent: { type: 'bot', level: 1, botSide: 'sea' } });
    ok(g, mv('e2', 'e4'));
    await until(() => g.turn === 'land');
    expect(g.log).toHaveLength(2);
    g.undo();
    expect(g.log).toHaveLength(0);
    expect(idAt(g, 'e2')).toBe('land-p-e2');
  });

  it('promotion keeps stable ids and gives a fresh power', () => {
    const g = modeGame('normal', '4k3/P6p/8/8/8/8/8/4K3 w - - 0 1');
    ok(g, pw('land-p-a7', 'b7'));
    ok(g, mv('e8', 'd8'));
    expect(g.needsPromotion('b7', 'b8')).toBe(true);
    ok(g, mv('b7', 'b8', 'n'));
    const m = g.history.at(-1)!;
    expect(m.promotedId).toBe('land-n-b8-promo1');
    expect(g.modeState.land.powersUsed).toEqual([]);
    expect(g.powerInfo('land-n-b8-promo1').reason).toBe('notYourTurn');
  });

  it('rejects a FEN where the side not to move is in check', () => {
    const g = modeGame('normal');
    expect(() => g.newGame({ mode: 'normal', opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, fen: '4k2R/8/8/8/8/8/8/4K3 w - - 0 1' })).toThrow(/not to move is in check/);
  });
});
