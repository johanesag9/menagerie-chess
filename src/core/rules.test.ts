import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { PieceState } from '../contracts/types';
import { makeGame, playSan, recordEvents, seeded } from './testUtils';

const byId = (pieces: PieceState[]) => Object.fromEntries(pieces.map((p) => [p.id, p.square]));

describe('castling', () => {
  it('moves the right rook on both sides and reports it', () => {
    const g = makeGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    const [white, black] = playSan(g, ['O-O', 'O-O-O']);
    expect(white.pieceId).toBe('land-k-e1');
    expect(white.flags).toContain('castleKing');
    expect(white.rookMove).toEqual({ pieceId: 'land-r-h1', from: 'h1', to: 'f1' });
    expect(black.pieceId).toBe('sea-k-e8');
    expect(black.flags).toContain('castleQueen');
    expect(black.rookMove).toEqual({ pieceId: 'sea-r-a8', from: 'a8', to: 'd8' });
    const ids = byId(g.pieces);
    expect(ids).toMatchObject({ 'land-k-e1': 'g1', 'land-r-h1': 'f1', 'land-r-a1': 'a1', 'sea-k-e8': 'c8', 'sea-r-a8': 'd8' });
  });

  it('works from the normal start (queenside for Land, kingside for Sea)', () => {
    const g = makeGame();
    const moves = playSan(g, ['d4', 'Nf6', 'Nc3', 'e6', 'Bf4', 'Be7', 'Qd2', 'O-O', 'O-O-O']);
    expect(moves[7].rookMove).toEqual({ pieceId: 'sea-r-h8', from: 'h8', to: 'f8' });
    expect(moves[8].rookMove).toEqual({ pieceId: 'land-r-a1', from: 'a1', to: 'd1' });
    expect(byId(g.pieces)).toMatchObject({ 'land-k-e1': 'c1', 'sea-k-e8': 'g8' });
  });

  it('undo puts king and rook back', () => {
    const g = makeGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    const start = byId(g.pieces);
    playSan(g, ['O-O']);
    g.undo();
    expect(byId(g.pieces)).toEqual(start);
    expect(g.fen).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  });
});

describe('en passant', () => {
  it('reports the real captured square and tracks ids', () => {
    const g = makeGame();
    const moves = playSan(g, ['e4', 'a6', 'e5', 'd5', 'exd6']);
    expect(moves[3].flags).toContain('doublePush');
    const ep = moves[4];
    expect(ep.pieceId).toBe('land-p-e2');
    expect(ep.flags).toEqual(expect.arrayContaining(['capture', 'enPassant']));
    expect(ep.to).toBe('d6');
    expect(ep.captured).toEqual({ id: 'sea-p-d7', side: 'sea', kind: 'p', square: 'd5' });
    expect(g.pieces.find((p) => p.id === 'sea-p-d7')).toBeUndefined();
    expect(byId(g.pieces)['land-p-e2']).toBe('d6');

    g.undo();
    expect(byId(g.pieces)).toMatchObject({ 'land-p-e2': 'e5', 'sea-p-d7': 'd5' });
  });
});

describe('promotion', () => {
  it('needs a choice, gives the new piece a promo id, and counts up', () => {
    const g = makeGame({ fen: '4k3/P7/8/8/8/8/7p/4K3 w - - 0 1' });
    expect(g.needsPromotion('a7', 'a8')).toBe(true);
    expect(g.needsPromotion('e1', 'e2')).toBe(false);
    const w = g.move({ from: 'a7', to: 'a8', promotion: 'q' })!;
    expect(w.pieceId).toBe('land-p-a7');
    expect(w.promotion).toBe('q');
    expect(w.flags).toContain('promotion');
    expect((w as { promotedId?: string }).promotedId).toBe('land-q-a8-promo1');
    expect(w.check).toBe(true);
    playSan(g, ['Kd7']);
    playSan(g, ['Kf2']);
    const b = g.move({ from: 'h2', to: 'h1', promotion: 'n' })!;
    expect((b as { promotedId?: string }).promotedId).toBe('sea-n-h1-promo2');
    const pieces = g.pieces;
    expect(pieces.find((p) => p.id === 'land-q-a8-promo1')).toMatchObject({ kind: 'q', square: 'a8' });
    expect(pieces.find((p) => p.id === 'sea-n-h1-promo2')).toMatchObject({ kind: 'n', square: 'h1' });
    expect(pieces.some((p) => p.id === 'land-p-a7' || p.id === 'sea-p-h2')).toBe(false);
  });

  it('capture-promotion; undo restores the pawn, the victim and the counter', () => {
    const g = makeGame({ fen: '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1' });
    const r = g.move({ from: 'a7', to: 'b8', promotion: 'r' })!;
    expect(r.captured).toEqual({ id: 'sea-r-b8', side: 'sea', kind: 'r', square: 'b8' });
    expect((r as { promotedId?: string }).promotedId).toBe('land-r-b8-promo1');
    g.undo();
    expect(byId(g.pieces)).toEqual({ 'sea-r-b8': 'b8', 'sea-k-e8': 'e8', 'land-p-a7': 'a7', 'land-k-e1': 'e1' });
    const again = g.move({ from: 'a7', to: 'b8', promotion: 'n' })!;
    expect((again as { promotedId?: string }).promotedId).toBe('land-n-b8-promo1');
  });

  it('defaults to a queen if no choice is passed', () => {
    const g = makeGame({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' });
    expect(g.move({ from: 'a7', to: 'a8' })?.promotion).toBe('q');
  });
});

describe('game endings', () => {
  it('checkmate emits moved, check, turnChanged, gameOver in that order', () => {
    const g = makeGame();
    playSan(g, ['f3', 'e5', 'g4']);
    const log = recordEvents(g);
    playSan(g, ['Qh4#']);
    const names = log.map((e) => e.name).filter((n) => n !== 'clock');
    expect(names).toEqual(['moved', 'check', 'turnChanged', 'gameOver']);
    expect(log.find((e) => e.name === 'check')!.payload).toEqual({ side: 'land', kingSquare: 'e1' });
    expect(log.find((e) => e.name === 'turnChanged')!.payload).toEqual({ turn: 'land', legalMoveCount: 0 });
    expect(g.isOver()).toEqual({ winner: 'sea', reason: 'checkmate' });
    expect(g.move({ from: 'a2', to: 'a3' })).toBeNull();
  });

  it('stalemate is a draw', () => {
    const g = makeGame({ fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1' });
    playSan(g, ['Qf7']);
    expect(g.isOver()).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('threefold repetition is a draw', () => {
    const g = makeGame();
    playSan(g, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']);
    expect(g.isOver()).toBeNull();
    playSan(g, ['Ng8']);
    expect(g.isOver()).toEqual({ winner: null, reason: 'threefold' });
  });

  it('insufficient material (king takes the last piece) is a draw', () => {
    const g = makeGame({ fen: '4k3/8/8/8/8/8/3q4/4K3 w - - 0 1' });
    const r = playSan(g, ['Kxd2'])[0];
    expect(r.captured?.id).toBe('sea-q-d2');
    expect(g.isOver()).toEqual({ winner: null, reason: 'insufficient' });
  });

  it('fifty-move rule is a draw', () => {
    const g = makeGame({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 99 80' });
    playSan(g, ['Ra2']);
    expect(g.isOver()).toEqual({ winner: null, reason: 'fiftyMove' });
  });

  it('resign ends the game and cannot be undone', () => {
    const g = makeGame();
    playSan(g, ['e4']);
    g.resign('sea');
    expect(g.isOver()).toEqual({ winner: 'land', reason: 'resign' });
    g.undo();
    expect(g.history).toHaveLength(1);
  });

  it('undo after checkmate reopens the game', () => {
    const g = makeGame();
    playSan(g, ['f3', 'e5', 'g4', 'Qh4#']);
    g.undo();
    expect(g.isOver()).toBeNull();
    expect(g.turn).toBe('sea');
  });
});

describe('FEN start', () => {
  it('rejects bad FEN with a clear error and keeps the old game', () => {
    const g = makeGame();
    playSan(g, ['e4']);
    const fen = g.fen;
    expect(() => g.newGame({ ...g['options'], fen: 'not a fen' })).toThrow(/Invalid FEN/);
    expect(() => g.newGame({ ...g['options'], fen: '8/8/8/8/8/8/8/8 w - - 0 1' })).toThrow(/Invalid FEN/);
    expect(() => g.newGame({ ...g['options'], fen: 'P3k3/8/8/8/8/8/8/4K3 w - - 0 1' })).toThrow(/edge rows|rank 1 or 8/);
    expect(() => g.newGame({ ...g['options'], fen: '4k3/8/8/8/8/8/8/R3K3 b - - 0 1' })).not.toThrow();
    expect(() => g.newGame({ ...g['options'], fen: '4k3/8/8/8/8/8/8/4K2R w - - 0 1' })).not.toThrow();
    expect(() => g.newGame({ ...g['options'], fen: '4k2R/8/8/8/8/8/8/4K3 w - - 0 1' })).toThrow(/not to move is in check/);
    g.newGame({ opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false });
    expect(g.fen).not.toBe(fen); // a valid newGame did reset
  });

  it('ids come from the squares in the FEN, and gameStarted carries them', () => {
    const g = makeGame();
    const log = recordEvents(g);
    g.newGame({ opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, fen: '4k3/8/8/3n4/8/8/8/4K2R b K - 0 1' });
    const started = log.find((e) => e.name === 'gameStarted')!.payload as { pieces: PieceState[]; turn: string };
    expect(started.turn).toBe('sea');
    expect(started.pieces.map((p) => p.id).sort()).toEqual(['land-k-e1', 'land-r-h1', 'sea-k-e8', 'sea-n-d5']);
  });
});

describe('legal targets', () => {
  it('lists unique target squares for the side to move only', () => {
    const g = makeGame();
    expect(g.legalTargets('g1').sort()).toEqual(['f3', 'h3']);
    expect(g.legalTargets('g8')).toEqual([]);
    const p = makeGame({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' });
    expect(p.legalTargets('a7')).toEqual(['a8']);
  });
});

describe('piece id stability', () => {
  // Morphy's "Opera Game" (1858): captures, queenside castling, a mate by the h1 rook.
  const OPERA = 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#'.split(' ');

  it('tracks every piece through a full game', () => {
    const g = makeGame();
    const moves = checkedReplay(g, OPERA);
    expect(moves.find((m) => m.san === 'O-O-O')!.rookMove!.pieceId).toBe('land-r-a1');
    expect(moves.find((m) => m.san === 'Rxd7')!.captured!.id).toBe('sea-n-b8');
    expect(moves.at(-1)!.pieceId).toBe('land-r-h1');
    expect(moves.at(-1)!.san).toBe('Rd8#');
    expect(g.isOver()).toEqual({ winner: 'land', reason: 'checkmate' });
    expect(byId(g.pieces)).toEqual({
      'sea-n-g8': 'b8', 'sea-k-e8': 'e8', 'sea-p-f7': 'f7', 'sea-p-g7': 'g7', 'sea-p-h7': 'h7', 'sea-b-f8': 'f8', 'sea-r-h8': 'h8',
      'sea-p-a7': 'a7', 'sea-q-d8': 'e6', 'sea-p-d7': 'e5', 'land-r-h1': 'd8', 'land-b-c1': 'g5', 'land-k-e1': 'c1',
      'land-p-a2': 'a2', 'land-p-b2': 'b2', 'land-p-c2': 'c2', 'land-p-e2': 'e4', 'land-p-f2': 'f2', 'land-p-g2': 'g2',
      'land-p-h2': 'h2',
    } as Record<string, string>);
  });

  it('undo all the way back restores the starting ids', () => {
    const g = makeGame();
    const start = byId(g.pieces);
    const snapshots: Record<string, string>[] = [];
    for (const san of OPERA) {
      snapshots.push(byId(g.pieces));
      playSan(g, [san]);
    }
    for (let i = OPERA.length - 1; i >= 0; i--) {
      g.undo();
      expect(byId(g.pieces)).toEqual(snapshots[i]);
    }
    expect(byId(g.pieces)).toEqual(start);
  });

  it('stays in sync with the board over many random games (promotions, en passant, castling)', () => {
    const rnd = seeded(7);
    const seen = { promotion: 0, enPassant: 0, castle: 0 };
    const problems: string[] = [];
    for (let game = 0; game < 15 && problems.length === 0; game++) {
      const g = makeGame();
      for (let ply = 0; ply < 250 && !g.isOver(); ply++) {
        const legal = new Chess(g.fen).moves({ verbose: true });
        const m = legal[Math.floor(rnd() * legal.length)];
        const before = byId(g.pieces);
        const r = g.move({ from: m.from as never, to: m.to as never, promotion: m.promotion as never });
        if (!r) { problems.push(`rejected ${m.san} in ${g.fen}`); break; }
        if (before[r.pieceId] !== r.from) problems.push(`${r.pieceId} was not on ${r.from}`);
        if (r.flags.includes('promotion')) seen.promotion++;
        if (r.flags.includes('enPassant')) seen.enPassant++;
        if (r.rookMove) seen.castle++;
        problems.push(...syncProblems(g.fen, g.pieces));
        if (problems.length) break;
      }
    }
    expect(problems).toEqual([]);
    // Make sure the random games actually exercised the special moves.
    expect(seen.promotion).toBeGreaterThan(0);
    expect(seen.enPassant).toBeGreaterThan(0);
    expect(seen.castle).toBeGreaterThan(0);
  }, 30000);
});

/** Replays SAN moves, checking ids against the board after every ply. */
function checkedReplay(g: ReturnType<typeof makeGame>, sans: string[]) {
  return sans.map((san) => {
    const before = byId(g.pieces);
    const r = playSan(g, [san])[0];
    expect(before[r.pieceId]).toBe(r.from);
    assertInSync(g.fen, g.pieces);
    return r;
  });
}

function assertInSync(fen: string, pieces: PieceState[]) {
  expect(syncProblems(fen, pieces)).toEqual([]);
}

/** Every tracked piece must match the board, ids unique, id prefix = side and kind. */
function syncProblems(fen: string, pieces: PieceState[]): string[] {
  const out: string[] = [];
  const board = new Chess(fen);
  if (new Set(pieces.map((p) => p.id)).size !== pieces.length) out.push('duplicate ids');
  let occupied = 0;
  for (const row of board.board()) for (const c of row) if (c) occupied++;
  if (pieces.length !== occupied) out.push(`${pieces.length} ids for ${occupied} pieces`);
  for (const p of pieces) {
    const cell = board.get(p.square);
    const [side, kind] = p.id.split('-');
    if (cell?.type !== p.kind || cell?.color !== (p.side === 'land' ? 'w' : 'b')) out.push(`${p.id} mismatched on ${p.square}`);
    if (side !== p.side || kind !== p.kind) out.push(`${p.id} has the wrong prefix`);
  }
  return out;
}
