import { describe, expect, it } from 'vitest';
import type { Side, Square, WheelOutcome } from '../../contracts/types';
import { flush } from '../testUtils';
import { spinWheel } from './rules';
import { createState, sqIndex, type MState } from './state';
import { at, give, modeGame, mv, ok, pw, record, setDie } from './testkit';
import { DEFAULT_TUNING, getTuning, type Tuning } from './tuning';

type G = ReturnType<typeof modeGame>;
const LOCAL = { opponent: { type: 'local' as const } };
const cardStep = (g: G, cardId: string, targets: Square[] = [], pieceId?: string) =>
  g.targets({ type: 'card', cardId, ...(pieceId ? { pieceId } : {}), targets });
const playable = (g: G, side: Side) => g.modeState[side].playableCards;

async function until(cond: () => boolean): Promise<void> {
  for (let n = 0; n < 300 && !cond(); n++) await flush();
}

describe('Crazy: cards', () => {
  it('♥ Revive brings a captured animal back on the back rank, with its id and a fresh power', () => {
    const g = modeGame('crazy', '4k3/pppp4/8/8/8/8/PPPP4/4K3 w - - 0 1');
    const [card] = give(g, 'land', 'hearts');
    expect(playable(g, 'land')).toEqual([]); // nothing captured yet
    expect(g.act({ type: 'card', cardId: card.id, pieceId: 'land-n-g1', targets: ['g1'] }).ok).toBe(false);
    g.state.land.captured.push({ id: 'land-n-g1', side: 'land', kind: 'n', square: 'f3' });
    expect(playable(g, 'land')).toEqual([card.id]);
    expect(cardStep(g, card.id, [], 'land-n-g1').squares.sort()).toEqual(['a1', 'b1', 'c1', 'd1', 'f1', 'g1', 'h1']);
    const log = record(g);
    ok(g, { type: 'card', cardId: card.id, pieceId: 'land-n-g1', targets: ['b1'] });
    const r = log.last('cardPlayed')!;
    expect(r.card).toEqual(card);
    expect(r.changes).toEqual([{ step: 0, type: 'spawn', piece: { id: 'land-n-g1', side: 'land', kind: 'n', square: 'b1' }, cause: 'revive' }]);
    expect(at(g, 'land-n-g1')).toBe('b1');
    expect(g.modeState.land.captured).toEqual([]);
    expect(g.modeState.land.hand).toEqual([]);
    expect(g.modeState.land.powersUsed).toEqual([]);
    expect(g.turn).toBe('sea'); // playing a card is the whole turn
  });

  it('♥ a promoted piece comes back as a pawn on the 2nd rank', () => {
    const g = modeGame('crazy', '4k3/pppp4/8/8/8/8/PPPP4/4K3 w - - 0 1');
    const [card] = give(g, 'land', 'hearts');
    g.state.land.captured.push({ id: 'land-q-a8-promo1', side: 'land', kind: 'q', square: 'c6' });
    expect(cardStep(g, card.id, [], 'land-q-a8-promo1').squares.sort()).toEqual(['e2', 'f2', 'g2', 'h2']);
    ok(g, { type: 'card', cardId: card.id, pieceId: 'land-q-a8-promo1', targets: ['f2'] });
    expect(g.pieces.find((p) => p.id === 'land-q-a8-promo1')).toEqual({ id: 'land-q-a8-promo1', side: 'land', kind: 'p', square: 'f2' });
  });

  it('♦ Swap trades two own pieces; a king or rook loses castling; no pawn onto the first rank', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/4P3/R3K3 w Q - 0 1');
    const [card] = give(g, 'land', 'diamonds');
    expect(cardStep(g, card.id).squares.sort()).toEqual(['a1', 'e1']); // the e2 pawn has no legal partner
    expect(cardStep(g, card.id, ['a1']).squares).toEqual(['e1']);
    const log = record(g);
    ok(g, { type: 'card', cardId: card.id, targets: ['a1', 'e1'] });
    expect(log.last('cardPlayed')!.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-r-a1', from: 'a1', to: 'e1', how: 'swap' },
      { step: 0, type: 'move', pieceId: 'land-k-e1', from: 'e1', to: 'a1', how: 'swap' },
    ]);
    expect(g.fen.split(' ')[2]).toBe('-');
  });

  it("♦ can't be played with only a king, or with frozen pieces", () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/8/4K3 w - - 0 1');
    give(g, 'land', 'diamonds');
    expect(playable(g, 'land')).toEqual([]);
    const h = modeGame('crazy', '4k3/p7/8/8/8/8/8/R3K3 w - - 0 1');
    h.state.statuses.push({ id: 'land-r-a1', status: 'frozen', turnsLeft: 2 });
    give(h, 'land', 'diamonds');
    expect(playable(h, 'land')).toEqual([]);
  });

  it('♣ Freeze stops an enemy (not the king) for 2 of its turns', () => {
    const g = modeGame('crazy', '4k3/8/3q4/8/8/8/8/4K3 w - - 0 1');
    const [card] = give(g, 'land', 'clubs');
    expect(cardStep(g, card.id).squares).toEqual(['d6']);
    ok(g, { type: 'card', cardId: card.id, targets: ['d6'] });
    expect(g.modeState.statuses).toEqual([{ pieceId: 'sea-q-d6', status: 'frozen', turnsLeft: 2 }]);
    expect(g.legalTargets('d6')).toEqual([]);
    expect(g.powerInfo('sea-q-d6')).toMatchObject({ available: false, reason: 'frozen' });
    ok(g, mv('e8', 'f8'));
    expect(g.modeState.statuses[0].turnsLeft).toBe(1);
    ok(g, mv('e1', 'e2'));
    expect(g.legalTargets('d6')).toEqual([]);
    ok(g, mv('f8', 'e8'));
    expect(g.modeState.statuses).toEqual([]);
  });

  it("♣ can't freeze the king or a piece already frozen for the full time", () => {
    const g = modeGame('crazy', '4k3/8/3q4/8/8/8/8/4K3 w - - 0 1');
    g.state.statuses.push({ id: 'sea-q-d6', status: 'frozen', turnsLeft: 2 });
    give(g, 'land', 'clubs');
    expect(playable(g, 'land')).toEqual([]);
  });

  it('♠ Dig moves an own pawn back one square, never onto the back rank or a block', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/4P3/3P4/4K3 w - - 0 1');
    const [card] = give(g, 'land', 'spades');
    expect(cardStep(g, card.id).squares).toEqual(['e3']);
    g.state.halfmove = 7;
    const log = record(g);
    ok(g, { type: 'card', cardId: card.id, targets: ['e3'] });
    expect(log.last('cardPlayed')!.changes).toEqual([{ step: 0, type: 'move', pieceId: 'land-p-e3', from: 'e3', to: 'e2', how: 'dig' }]);
    expect(g.state.halfmove).toBe(0);
    const h = modeGame('crazy', '4k3/p7/8/8/8/4P3/3P4/4K3 w - - 0 1');
    h.state.blocks.push({ sq: sqIndex('e2'), by: 'sea', turnsLeft: 2 });
    give(h, 'land', 'spades');
    expect(playable(h, 'land')).toEqual([]);
  });

  const jokerGame = (outcome: string, fen = '4k3/pp6/8/8/8/8/PP6/RN2K3 w - - 0 1') => {
    const odds = { party: 0, teleport: 0, butterfingers: 0, double: 0, [outcome]: 1 } as Tuning['jokerOdds'];
    return modeGame('crazy', fen, LOCAL, { jokerOdds: odds });
  };

  it('🃏 Joker is always playable; Party recharges every used power', () => {
    const g = jokerGame('party');
    const [card] = give(g, 'land', 'joker');
    expect(playable(g, 'land')).toEqual([card.id]);
    expect(cardStep(g, card.id)).toMatchObject({ squares: [], complete: true });
    g.state.land.powersUsed.push('land-p-a2', 'land-n-b1');
    const log = record(g);
    ok(g, { type: 'card', cardId: card.id, targets: [] });
    const r = log.last('cardPlayed')!;
    expect(r.joker).toBe('party');
    expect(r.changes).toEqual([{ step: 0, type: 'recharge', pieceIds: ['land-p-a2', 'land-n-b1'] }]);
    expect(g.modeState.land.powersUsed).toEqual([]);
  });

  it('🃏 Party with nothing to recharge still plays (and does nothing)', () => {
    const g = jokerGame('party');
    const [card] = give(g, 'land', 'joker');
    const log = record(g);
    ok(g, { type: 'card', cardId: card.id, targets: [] });
    expect(log.last('cardPlayed')!.changes).toEqual([]);
  });

  it('🃏 Teleport sends a random own piece (not the king) to an empty square in its own half', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = jokerGame('teleport');
      g.state.rng = seed;
      const [card] = give(g, 'land', 'joker');
      const log = record(g);
      ok(g, { type: 'card', cardId: card.id, targets: [] });
      const c = log.last('cardPlayed')!.changes[0];
      expect(c.type).toBe('move');
      if (c.type !== 'move') continue;
      expect(c.how).toBe('teleport');
      expect(c.pieceId).not.toBe('land-k-e1');
      expect(Number(c.to[1])).toBeLessThanOrEqual(4);
      if (c.pieceId.includes('-p-')) expect(c.to[1]).not.toBe('1');
    }
  });

  it('🃏 Butterfingers freezes a random enemy (not the king)', () => {
    const g = jokerGame('butterfingers');
    const [card] = give(g, 'land', 'joker');
    const log = record(g);
    ok(g, { type: 'card', cardId: card.id, targets: [] });
    const c = log.last('cardPlayed')!.changes[0];
    expect(c).toMatchObject({ type: 'status', status: 'frozen' });
    expect(['sea-p-a7', 'sea-p-b7']).toContain((c as { pieceId: string }).pieceId);
  });

  it('🃏 Double draws two cards, up to the hand limit, without cardDrawn events', () => {
    const g = jokerGame('double');
    const [card] = give(g, 'land', 'joker', 'clubs');
    const log = record(g);
    ok(g, { type: 'card', cardId: card.id, targets: [] });
    expect(log.last('cardPlayed')!.drawn).toHaveLength(2);
    expect(g.modeState.land.hand).toHaveLength(3);
    expect(log.names()).not.toContain('cardDrawn');
    const h = jokerGame('double');
    const [j] = give(h, 'land', 'joker', 'clubs', 'spades');
    ok(h, { type: 'card', cardId: j.id, targets: [] });
    expect(h.modeState.land.hand).toHaveLength(3);
  });
});

describe('Crazy: Wheel of Chaos', () => {
  const state = (fen: string, tuning: Partial<Tuning> = {}, seed = 1): MState =>
    createState(fen, 'crazy', { ...getTuning(), ...tuning }, seed);
  const sq = (s: MState, id: string) => {
    const i = s.board.findIndex((p) => p?.id === id);
    return i < 0 ? undefined : `${'abcdefgh'[i & 7]}${(i >> 3) + 1}`;
  };
  const quake = (fen: string, dir: 'left' | 'right', prep?: (s: MState) => void) => {
    for (let seed = 1; seed < 50; seed++) {
      const s = state(fen, {}, seed);
      prep?.(s);
      const r = spinWheel(s, 'earthquake');
      if (r.direction === dir) return { s, r };
    }
    throw new Error('no seed gave that direction');
  };

  it('Tide sweeps Land pieces on the beach back a rank, front first, so chains follow', () => {
    const s = state('4k3/8/4N3/4R3/3B4/8/8/4K3 w - - 0 1');
    const r = spinWheel(s, 'tide');
    expect(r.changes).toEqual([
      { step: 0, type: 'move', pieceId: 'land-r-e5', from: 'e5', to: 'e4', how: 'swept' },
      { step: 0, type: 'move', pieceId: 'land-n-e6', from: 'e6', to: 'e5', how: 'swept' },
    ]);
    expect(sq(s, 'land-b-d4')).toBe('d4'); // meadow pieces stay
  });

  it('Tide stops at pieces and blocked squares', () => {
    const s = state('4k3/8/4N3/4R3/8/8/8/4K3 w - - 0 1');
    s.blocks.push({ sq: sqIndex('e4'), by: 'sea', turnsLeft: 2 });
    expect(spinWheel(s, 'tide').changes).toEqual([]);
    const t = state('4k3/8/4N3/4R3/4p3/8/8/4K3 w - - 0 1');
    expect(spinWheel(t, 'tide').changes).toEqual([]);
  });

  it('Tide can also pull Sea back (tuning knob)', () => {
    const s = state('4k3/8/8/8/8/3n4/8/4K3 w - - 0 1', { tideBothSides: true });
    expect(spinWheel(s, 'tide').changes).toEqual([{ step: 0, type: 'move', pieceId: 'sea-n-d3', from: 'd3', to: 'd4', how: 'swept' }]);
  });

  it('Earthquake: edge pieces stay, a piece bumping into them stays, blocked squares stop it, castling is lost', () => {
    const { s, r } = quake('4k3/8/8/8/6NR/1p6/8/4K2R w K - 0 1', 'right', (x) => x.blocks.push({ sq: sqIndex('c3'), by: 'land', turnsLeft: 2 }));
    expect(sq(s, 'land-r-h4')).toBe('h4');
    expect(sq(s, 'land-n-g4')).toBe('g4');
    expect(sq(s, 'sea-p-b3')).toBe('b3'); // c3 is blocked
    expect(sq(s, 'land-r-h1')).toBe('h1');
    expect(sq(s, 'land-k-e1')).toBe('f1');
    expect(sq(s, 'sea-k-e8')).toBe('f8');
    expect(s.land.castleK).toBeNull();
    expect(r.changes.every((c) => c.type === 'move' && c.how === 'quake' && c.step === 0)).toBe(true);
    const left = quake('4k3/8/8/8/NR6/8/8/4K3 w - - 0 1', 'left');
    expect(sq(left.s, 'land-n-a4')).toBe('a4');
    expect(sq(left.s, 'land-r-b4')).toBe('b4');
    expect(sq(left.s, 'land-k-e1')).toBe('d1');
  });

  it('Pigeon steals a random pawn (it counts as captured, so ♥ can bring it back)', () => {
    const g = modeGame('crazy', '4k3/8/8/3n4/8/8/4P3/4K3 w - - 0 1');
    const r = spinWheel(g.state, 'pigeon');
    expect(r.changes).toEqual([{ step: 0, type: 'capture', pieceId: 'land-p-e2', square: 'e2', cause: 'pigeon' }]);
    expect(g.modeState.land.captured.map((p) => p.id)).toEqual(['land-p-e2']);
    const [card] = give(g, 'land', 'hearts');
    ok(g, { type: 'card', cardId: card.id, pieceId: 'land-p-e2', targets: ['a2'] });
    expect(at(g, 'land-p-e2')).toBe('a2');
    const none = state('4k3/8/8/3n4/8/8/8/4K3 w - - 0 1');
    expect(spinWheel(none, 'pigeon')).toMatchObject({ changes: [], label: 'Wheel: Pigeon (flew past)' });
  });

  it('Disco recharges every used power on both sides', () => {
    const s = state('4k3/p7/8/8/8/8/P7/4K3 w - - 0 1');
    s.land.powersUsed.push('land-p-a2');
    s.sea.powersUsed.push('sea-p-a7');
    expect(spinWheel(s, 'disco').changes).toEqual([{ step: 0, type: 'recharge', pieceIds: ['land-p-a2', 'sea-p-a7'] }]);
    expect(s.land.powersUsed).toEqual([]);
  });

  it('spins at the start of Land’s turn after every Nth round, before the card draw and the die', () => {
    const odds = { tide: 1, pigeon: 0, earthquake: 0, disco: 0 } as Record<WheelOutcome, number>;
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/P7/4K3 w - - 0 1', LOCAL, { wheelEvery: 1, wheelOdds: odds });
    expect(g.modeState.nextWheelIn).toBe(1);
    ok(g, mv('e1', 'e2'));
    const log = record(g);
    ok(g, mv('e8', 'e7'));
    expect(log.names()).toEqual(['moved', 'logged', 'modeState', 'turnChanged', 'wheelSpun', 'logged', 'dieRolled', 'modeState']);
    expect(log.last('logged')).toEqual({ side: null, kind: 'wheel', label: 'Wheel: Tide' });
    const def = modeGame('crazy');
    expect(def.modeState.nextWheelIn).toBe(DEFAULT_TUNING.wheelEvery);
  });

  it('a pigeon that leaves only the kings ends the game', () => {
    const odds = { tide: 0, pigeon: 1, earthquake: 0, disco: 0 } as Record<WheelOutcome, number>;
    const g = modeGame('crazy', '4k3/8/8/8/8/8/P7/4K3 w - - 0 1', LOCAL, { wheelEvery: 1, wheelOdds: odds });
    ok(g, mv('e1', 'e2'));
    const log = record(g);
    ok(g, mv('e8', 'e7'));
    expect(log.names().slice(4)).toEqual(['wheelSpun', 'logged', 'modeState', 'gameOver']);
    expect(g.isOver()).toEqual({ winner: null, reason: 'insufficient' });
  });
});

describe('Crazy: the fate die', () => {
  const slideOf = (g: G) => g.history.at(-1)!.slide;

  it('banana: a slider slides one more square the way it went', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/8/R1B1K3 w - - 0 1');
    setDie(g, 1);
    ok(g, mv('a1', 'a4'));
    expect(slideOf(g)).toEqual({ from: 'a4', to: 'a5' });
    expect(at(g, 'land-r-a1')).toBe('a5');
    expect(g.log.at(-1)!.label).toBe('Ra4 (slid to a5)');
    const b = modeGame('crazy', '4k3/p7/8/8/8/8/8/R1B1K3 w - - 0 1');
    setDie(b, 1);
    ok(b, mv('c1', 'e3'));
    expect(at(b, 'land-b-c1')).toBe('f4');
  });

  it('banana: a knight slides along its long leg', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/8/4K1N1 w - - 0 1');
    setDie(g, 1);
    ok(g, mv('g1', 'f3'));
    expect(slideOf(g)).toEqual({ from: 'f3', to: 'f4' });
    const h = modeGame('crazy', '4k3/p7/8/8/8/8/8/4K1N1 w - - 0 1');
    setDie(h, 1);
    ok(h, mv('g1', 'e2'));
    expect(slideOf(h)).toEqual({ from: 'e2', to: 'd2' });
  });

  it('banana: a pawn sliding onto the last rank becomes a queen', () => {
    const g = modeGame('crazy', '7k/8/4P3/8/8/8/p7/4K3 w - - 0 1');
    setDie(g, 1);
    ok(g, mv('e6', 'e7'));
    const m = g.history.at(-1)!;
    expect(m.slide).toEqual({ from: 'e7', to: 'e8' });
    expect(m.promotion).toBe('q');
    expect(m.promotedId).toBe('land-q-e8-promo1');
    expect(m.flags).toContain('promotion');
  });

  it('banana: no slide into a piece, a block or off the board; never on castling', () => {
    const g = modeGame('crazy', '4k3/p7/8/n7/8/8/8/R3K3 w - - 0 1');
    setDie(g, 1);
    ok(g, mv('a1', 'a4'));
    expect(slideOf(g)).toBeUndefined();
    const b = modeGame('crazy', '4k3/p7/8/8/8/8/8/R3K3 w - - 0 1');
    b.state.blocks.push({ sq: sqIndex('a5'), by: 'sea', turnsLeft: 2 });
    setDie(b, 1);
    ok(b, mv('a1', 'a4'));
    expect(slideOf(b)).toBeUndefined();
    const e = modeGame('crazy', '4k3/1p6/8/8/8/8/8/R3K3 w - - 0 1');
    setDie(e, 1);
    ok(e, mv('a1', 'a8'));
    expect(slideOf(e)).toBeUndefined();
    const c = modeGame('crazy', '4k3/p7/8/8/8/8/8/4K2R w K - 0 1');
    setDie(c, 1);
    ok(c, mv('e1', 'g1'));
    expect(slideOf(c)).toBeUndefined();
    expect(at(c, 'land-k-e1')).toBe('g1');
  });

  it('banana: a slid double push gives no en passant chance', () => {
    const g = modeGame('crazy', '4k3/8/8/8/5p2/8/4P3/4K3 w - - 0 1');
    setDie(g, 1);
    ok(g, mv('e2', 'e4'));
    const m = g.history.at(-1)!;
    expect(m.slide).toEqual({ from: 'e4', to: 'e5' });
    expect(m.flags).not.toContain('doublePush');
    expect(g.legalTargets('f4')).toEqual(['f3']);
    const plain = modeGame('crazy', '4k3/8/8/8/5p2/8/4P3/4K3 w - - 0 1');
    ok(plain, mv('e2', 'e4'));
    expect(plain.legalTargets('f4').sort()).toEqual(['e3', 'f3']);
  });

  it('banana: powers and cards never slide', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/8/4K1N1 w - - 0 1');
    setDie(g, 1);
    ok(g, pw('land-n-g1', 'f3', 'g5'));
    expect(at(g, 'land-n-g1')).toBe('g5');
  });

  it('lucky 6: recharge a used power before acting', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/P7/4K1N1 w - - 0 1');
    g.state.land.powersUsed.push('land-n-g1');
    setDie(g, 6);
    expect(g.modeState.phase).toBe('bonus');
    expect(g.act(mv('g1', 'f3'))).toEqual({ ok: false, reason: 'Not your turn now' });
    expect(g.targets({ type: 'bonus', choice: 'recharge', targets: [] }).squares).toEqual(['g1']);
    const log = record(g);
    ok(g, { type: 'bonus', choice: 'recharge', targets: ['g1'] });
    expect(log.names()).toEqual(['bonusUsed', 'logged', 'modeState']);
    expect(log.last('bonusUsed')).toEqual({ side: 'land', choice: 'recharge', changes: [{ step: 0, type: 'recharge', pieceIds: ['land-n-g1'] }] });
    expect(g.modeState.phase).toBe('action');
    expect(g.turn).toBe('land');
    ok(g, pw('land-n-g1', 'f3', 'g5'));
  });

  it('lucky 6: a pawn steps forward (not onto the last rank), or skip', () => {
    const g = modeGame('crazy', '4k3/p6P/8/8/8/8/P7/4K3 w - - 0 1');
    setDie(g, 6);
    expect(g.targets({ type: 'bonus', choice: 'pawnStep', targets: [] }).squares).toEqual(['a2']);
    const log = record(g);
    ok(g, { type: 'bonus', choice: 'pawnStep', targets: ['a2'] });
    expect(log.last('bonusUsed')!.changes).toEqual([{ step: 0, type: 'move', pieceId: 'land-p-a2', from: 'a2', to: 'a3', how: 'step' }]);
    const s = modeGame('crazy', '4k3/p7/8/8/8/8/P7/4K3 w - - 0 1');
    setDie(s, 6);
    ok(s, { type: 'bonus', choice: 'skip' });
    expect(s.modeState.phase).toBe('action');
  });
});

describe('Crazy: jankenpon duels', () => {
  const FEN = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';

  it('a capture waits on a duel; the attacker winning the throw goes ahead', () => {
    const g = modeGame('crazy', FEN);
    const log = record(g);
    expect(g.act(mv('e4', 'd5'))).toEqual({ ok: true, pending: 'duel' });
    expect(log.names()).toEqual(['duelOffered']);
    expect(log.last('duelOffered')).toEqual({
      attackerId: 'land-p-e4', victimId: 'sea-p-d5', via: 'move', from: 'e4', to: 'd5', attacker: 'land', defender: 'sea', tokensLeft: 3,
    });
    expect(g.modeState.phase).toBe('duel');
    expect(g.act(mv('e1', 'e2')).ok).toBe(false);
    g.answerDuel(true);
    expect(g.modeState.sea.duelTokens).toBe(2);
    g.throwHand('land', 'rock');
    g.throwHand('sea', 'scissors');
    expect(log.names()).toEqual([
      'duelOffered', 'modeState', 'duelRound', 'duelEnded', 'moved', 'logged', 'modeState', 'turnChanged', 'dieRolled', 'modeState',
    ]);
    expect(log.last('duelRound')).toMatchObject({ round: 1, attackerHand: 'rock', defenderHand: 'scissors', result: 'attacker' });
    expect(log.last('duelEnded')).toMatchObject({ called: true, winner: 'attacker' });
    expect(log.last('moved')!.captured?.id).toBe('sea-p-d5');
  });

  it('declining lets the capture go ahead and keeps the token', () => {
    const g = modeGame('crazy', FEN);
    const log = record(g);
    g.act(mv('e4', 'd5'));
    g.answerDuel(false);
    expect(log.names().slice(0, 3)).toEqual(['duelOffered', 'duelEnded', 'moved']);
    expect(log.last('duelEnded')).toMatchObject({ called: false, winner: 'attacker' });
    expect(g.modeState.sea.duelTokens).toBe(3);
  });

  it('a bonk: nothing is captured, no banana slide, and the turn ends', () => {
    const g = modeGame('crazy', '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1');
    setDie(g, 1);
    const log = record(g);
    g.act(mv('d1', 'd5'));
    g.answerDuel(true);
    g.throwHand('land', 'rock');
    g.throwHand('sea', 'paper');
    expect(log.names().slice(0, 8)).toEqual(['duelOffered', 'modeState', 'duelRound', 'duelEnded', 'bonked', 'logged', 'modeState', 'turnChanged']);
    expect(log.last('logged')!.kind).toBe('bonk');
    expect(at(g, 'land-r-d1')).toBe('d1');
    expect(at(g, 'sea-p-d5')).toBe('d5');
    expect(g.turn).toBe('sea');
    expect(g.history).toEqual([]);
  });

  it('three ties in a row: the attacker wins', () => {
    const g = modeGame('crazy', FEN);
    const log = record(g);
    g.act(mv('e4', 'd5'));
    g.answerDuel(true);
    for (let n = 0; n < 3; n++) {
      g.throwHand('sea', 'paper');
      g.throwHand('land', 'paper');
    }
    const rounds = log.log.filter((e) => e.name === 'duelRound').map((e) => (e.payload as { result: string }).result);
    expect(rounds).toEqual(['tie', 'tie', 'tie']);
    expect(log.last('duelEnded')).toMatchObject({ winner: 'attacker' });
    expect(at(g, 'land-p-e4')).toBe('d5');
    // A modeState starts every throw round: after the call and after each tie.
    const between = log.names().slice(1, log.names().indexOf('duelEnded'));
    expect(between).toEqual(['modeState', 'duelRound', 'modeState', 'duelRound', 'modeState', 'duelRound']);
  });

  it('a double jump can be dueled (via, mid); a bonked double jump is still used up', () => {
    const g = modeGame('crazy', '4k3/8/8/4p3/8/8/8/4K1N1 w - - 0 1');
    const log = record(g);
    expect(g.act(pw('land-n-g1', 'f3', 'e5'))).toEqual({ ok: true, pending: 'duel' });
    expect(log.last('duelOffered')).toMatchObject({ via: 'doubleJump', mid: 'f3', from: 'g1', to: 'e5', victimId: 'sea-p-e5' });
    g.answerDuel(true);
    g.throwHand('land', 'scissors');
    g.throwHand('sea', 'rock');
    expect(log.names()).toContain('bonked');
    expect(at(g, 'land-n-g1')).toBe('g1');
    expect(g.modeState.land.powersUsed).toEqual(['land-n-g1']);
  });

  it('a duel can save the king; losing it loses the game', () => {
    const g = modeGame('crazy', '4k2R/p7/8/8/8/8/8/4K3 w - - 0 1');
    g.act(mv('h8', 'e8'));
    g.answerDuel(true);
    g.throwHand('land', 'rock');
    g.throwHand('sea', 'paper');
    expect(g.isOver()).toBeNull();
    expect(at(g, 'sea-k-e8')).toBe('e8');
    const h = modeGame('crazy', '4k2R/p7/8/8/8/8/8/4K3 w - - 0 1');
    h.act(mv('h8', 'e8'));
    h.answerDuel(true);
    h.throwHand('land', 'paper');
    h.throwHand('sea', 'rock');
    expect(h.isOver()).toEqual({ winner: 'land', reason: 'kingCaptured' });
  });

  it('no tokens left: no duel at all', () => {
    const g = modeGame('crazy', FEN);
    g.state.sea.tokens = 0;
    const log = record(g);
    expect(g.act(mv('e4', 'd5'))).toEqual({ ok: true });
    expect(log.names()).not.toContain('duelOffered');
  });

  it('the bot defends by itself (always for its king) and throws by itself', async () => {
    const g = modeGame('crazy', '4k2R/p7/8/8/8/8/8/4K3 w - - 0 1', { opponent: { type: 'bot', level: 1, botSide: 'sea' } });
    const log = record(g);
    g.act(mv('h8', 'e8'));
    await until(() => log.names().includes('modeState'));
    expect(g.modeState.sea.duelTokens).toBe(2); // called
    for (let n = 0; n < 3 && g.modeState.phase === 'duel'; n++) g.throwHand('land', 'rock');
    expect(log.names()).toContain('duelEnded');
    g.dispose();
  });

  it('a human defends against the bot', async () => {
    const bot = { ...DEFAULT_TUNING.bot, 1: { depth: 1, randomChance: 0, timeMs: 300, minThinkMs: 0 } };
    const g = modeGame('crazy', 'q3k3/8/8/8/8/8/8/R3K3 w - - 0 1', { opponent: { type: 'bot', level: 1, botSide: 'land' } }, { bot });
    const log = record(g);
    await until(() => log.names().includes('duelOffered'));
    expect(log.last('duelOffered')).toMatchObject({ attackerId: 'land-r-a1', victimId: 'sea-q-a8', defender: 'sea' });
    g.answerDuel(false);
    expect(at(g, 'land-r-a1')).toBe('a8');
    g.dispose();
  });
});

describe('Crazy: winning, passing, no undo', () => {
  it('capturing the king wins; a king in danger is only a warning', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/8/4K2R w - - 0 1');
    g.state.sea.tokens = 0;
    const log = record(g);
    ok(g, mv('h1', 'h8'));
    expect(log.last('check')).toEqual({ side: 'sea', kingSquare: 'e8' });
    expect(g.isOver()).toBeNull();
    ok(g, mv('a7', 'a6')); // Sea may ignore the danger
    ok(g, mv('h8', 'e8'));
    expect(g.isOver()).toEqual({ winner: 'land', reason: 'kingCaptured' });
    expect(log.names().slice(-5)).toEqual(['moved', 'logged', 'modeState', 'turnChanged', 'gameOver']);
    expect(g.modeState.phase).toBe('over');
  });

  it('castling ignores attacked squares', () => {
    const g = modeGame('crazy', '4kr2/p7/8/8/8/8/8/4K2R w K - 0 1');
    expect(g.legalTargets('e1')).toContain('g1');
  });

  it('a side with no legal action passes its turn (and its freeze still counts down)', () => {
    const g = modeGame('crazy', '4k3/4p3/8/8/8/8/PP6/KN6 b - - 0 1');
    for (const id of ['land-p-a2', 'land-p-b2', 'land-n-b1']) g.state.statuses.push({ id, status: 'frozen', turnsLeft: 2 });
    g.state.land.powersUsed.push('land-k-a1');
    const log = record(g);
    ok(g, mv('e7', 'e6'));
    expect(log.names()).toEqual([
      'moved', 'logged', 'modeState', 'turnChanged',
      'dieRolled', 'modeState', 'turnPassed', 'logged', 'modeState', 'turnChanged',
      'dieRolled', 'modeState',
    ]);
    expect(log.last('turnPassed')).toEqual({ side: 'land' });
    expect(g.turn).toBe('sea');
    expect(g.modeState.statuses.every((s) => s.turnsLeft === 1)).toBe(true);
  });

  it('there is no undo', () => {
    const g = modeGame('crazy');
    ok(g, mv('e2', 'e4'));
    g.undo();
    expect(g.log).toHaveLength(1);
    expect(at(g, 'land-p-e2')).toBe('e4');
  });

  it('cards are drawn at the start of every 3rd own turn, skipped when the hand is full', () => {
    const g = modeGame('crazy', '4k3/p7/8/8/8/8/P7/4K3 w - - 0 1');
    expect(g.modeState.land.nextCardIn).toBe(2);
    ok(g, mv('e1', 'e2'));
    ok(g, mv('e8', 'e7'));
    ok(g, mv('e2', 'e1'));
    const log = record(g);
    ok(g, mv('e7', 'e8'));
    expect(log.names().slice(4)).toEqual(['cardDrawn', 'dieRolled', 'modeState']);
    expect(g.modeState.land.hand).toHaveLength(1);
    expect(g.modeState.land.nextCardIn).toBe(3);

    const full = modeGame('crazy', '4k3/p7/8/8/8/8/P7/4K3 w - - 0 1');
    give(full, 'land', 'clubs', 'clubs', 'clubs');
    ok(full, mv('e1', 'e2'));
    ok(full, mv('e8', 'e7'));
    ok(full, mv('e2', 'e1'));
    const flog = record(full);
    ok(full, mv('e7', 'e8'));
    expect(flog.names()).not.toContain('cardDrawn');
    expect(full.modeState.land.nextCardIn).toBe(3);
  });

  it('each side starts with the tuned hand and 3 duel tokens', () => {
    const g = modeGame('crazy', undefined, LOCAL, { startHand: 1 });
    expect(g.modeState.land.hand).toHaveLength(1);
    expect(g.modeState.sea.hand).toHaveLength(1);
    expect(g.modeState.land.duelTokens).toBe(3);
  });
});
