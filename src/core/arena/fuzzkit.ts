/**
 * Fuzz: seeded bot-vs-bot Sumo/Raid games, both sides driven through the controller by the bot's brain (a cheap level)
 * mixed with random legal actions, random duel calls and random throws.
 * After every action: no exceptions; every option `pieceOptions` and `targets()` offers is legal and every legal action
 * is offered; a made-up illegal action is refused; a piece map and treasures rebuilt from events alone match `state`
 * (so ids stay stable); and the state's own rules hold (no stacking, nobody on water, blocks or their own home).
 */
import { describe, it } from 'vitest';
import type { ArenaAction, ArenaMode, ArenaState, BoardChange, Hand, PieceState, Side, Square } from '../../contracts/types';
import { seeded } from '../testUtils';
import { decideArena } from './bot';
import { ArenaGame } from './game';
import { actionKey, cloneArena, legalActions } from './rules';
import type { ArenaBotLevel } from './tuning';

/** 200 games per mode; `ARENA_FUZZ_GAMES=10` runs a quick sample. */
const GAMES = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ARENA_FUZZ_GAMES) || 200;
const CHUNK = Math.min(25, GAMES);
const MAX_ACTIONS = 600;
const HANDS: Hand[] = ['rock', 'paper', 'scissors'];
const SQUARES: Square[] = [];
for (const r of '12345678') for (const f of 'abcdefgh') SQUARES.push(`${f}${r}` as Square);
const FUZZ_BOT: ArenaBotLevel = { maxActions: 1, beam: 1, randomChance: 0, noise: 40, lookahead: false, minThinkMs: 0 };

function need(ok: unknown, what: () => string): void {
  if (!ok) throw new Error(what());
}

/** Pieces and treasures kept up to date from events only, the way integration would. */
function tracker(g: ArenaGame) {
  const map = new Map<string, PieceState>();
  const treasures = new Map<Side, { square: Square | null; carrier: string | null }>();
  const allIds = new Set<string>();
  const apply = (changes: BoardChange[]) => {
    for (const c of changes) {
      if (c.type === 'move') {
        const p = map.get(c.pieceId);
        need(p, () => `event moved unknown piece ${c.pieceId}`);
        need(p!.square === c.from, () => `move of ${c.pieceId} from ${c.from}, but it was on ${p!.square}`);
        p!.square = c.to;
      } else if (c.type === 'fall') {
        need(map.delete(c.pieceId), () => `event dropped unknown piece ${c.pieceId}`);
      } else if (c.type === 'treasure') {
        treasures.set(c.owner, { square: c.square, carrier: c.carrier });
      } else if (c.type === 'capture' || c.type === 'spawn' || c.type === 'promote') {
        throw new Error(`arena sent a chess change: ${c.type}`);
      }
    }
  };
  g.on('started', (e) => {
    map.clear();
    treasures.clear();
    allIds.clear();
    for (const p of e.state.pieces) {
      map.set(p.id, { ...p });
      allIds.add(p.id);
    }
    for (const t of e.state.treasures) treasures.set(t.owner, { square: t.square, carrier: t.carrier });
  });
  g.on('acted', (a) => apply(a.changes));
  g.on('sank', (s) => apply(s.changes));
  g.on('wheelSpun', (w) => apply(w.changes));
  return {
    check(s: ArenaState) {
      need(map.size === s.pieces.length, () => `tracked ${map.size} pieces, state has ${s.pieces.length}`);
      for (const p of s.pieces) {
        const t = map.get(p.id);
        need(t && t.square === p.square && t.kind === p.kind && t.side === p.side, () => `piece ${p.id} on ${p.square}, events say ${t?.square}`);
      }
      const ids = new Set([...s.pieces, ...s.out].map((p) => p.id));
      need(ids.size === allIds.size && [...ids].every((x) => allIds.has(x)), () => 'piece ids changed');
      for (const t of s.treasures) {
        const tr = treasures.get(t.owner)!;
        need(tr.square === t.square && tr.carrier === t.carrier, () => `treasure ${t.owner}: state ${t.square}/${t.carrier}, events ${tr.square}/${tr.carrier}`);
      }
    },
  };
}

/** The state's own rules. */
function checkState(s: ArenaState): void {
  const on = new Map<Square, string>();
  const sunk = new Set(s.sunk);
  const blocked = new Set(s.squares.map((b) => b.square));
  for (const p of s.pieces) {
    need(!on.has(p.square), () => `two animals on ${p.square}`);
    on.set(p.square, p.id);
    need(!sunk.has(p.square), () => `${p.id} stands on water ${p.square}`);
    need(!blocked.has(p.square), () => `${p.id} stands on a block ${p.square}`);
    const own = s.treasures.find((t) => t.owner === p.side);
    if (own) need(own.home !== p.square, () => `${p.id} guards its own home ${p.square}`);
  }
  need(s.ap >= 0, () => `negative AP ${s.ap}`);
  for (const t of s.treasures) {
    need((t.square === null) !== (t.carrier === null), () => `treasure ${t.owner} both lying and carried`);
    if (t.carrier) {
      const c = s.pieces.find((p) => p.id === t.carrier);
      need(c && c.side !== t.owner, () => `treasure ${t.owner} carried by ${t.carrier}`);
    }
    if (t.square && t.square !== t.home) need(!on.has(t.square) || s.phase === 'over', () => `dropped treasure under ${on.get(t.square!)}`);
  }
  need(s.score.land <= s.target && s.score.sea <= s.target, () => 'score past the target');
}

/** Every option the controller offers must be in the legal list, and the other way round. */
function checkOptions(g: ArenaGame): void {
  const s = g.state;
  const legal = new Set(legalActions(g.raw).map(actionKey));
  const offered = new Set<string>(['e']);
  for (const p of s.pieces) {
    const o = g.pieceOptions(p.id);
    if (p.side !== s.turn) {
      need(!o.steps.length && !o.hits.length && !o.power.available, () => `options for ${p.id} out of turn`);
      continue;
    }
    for (const to of o.steps) offered.add(actionKey({ type: 'step', pieceId: p.id, to }));
    o.hits.forEach((target, k) => {
      offered.add(actionKey({ type: 'hit', pieceId: p.id, target }));
      need(o.hitCosts[k] <= s.ap, () => `hit costs ${o.hitCosts[k]} > AP ${s.ap}`);
      g.previewArea({ pieceId: p.id, hit: target });
    });
    // Walk the targets() tree.
    let lists = 0;
    const walk = (picked: Square[]) => {
      const t = g.targets({ pieceId: p.id, targets: picked });
      g.previewArea({ pieceId: p.id, targets: picked });
      if (t.complete) {
        lists++;
        offered.add(actionKey({ type: 'power', pieceId: p.id, targets: picked }));
      }
      for (const sq of t.squares) walk([...picked, sq]);
    };
    walk([]);
    need(o.power.available === lists > 0, () => `power of ${p.id}: available ${o.power.available}, ${lists} target lists`);
  }
  for (const k of offered) need(legal.has(k), () => `offered but illegal: ${k}`);
  for (const k of legal) need(offered.has(k), () => `legal but not offered: ${k}`);
}

export function fuzzArena(mode: ArenaMode): void {
  describe(`fuzz ${mode}`, () => {
    for (let c = 0; c < GAMES / CHUNK; c++) {
      it(`games ${c * CHUNK + 1}-${(c + 1) * CHUNK}`, { timeout: 600000 }, () => {
        for (let k = 0; k < CHUNK; k++) playOne(mode, 1000 + c * CHUNK + k);
      });
    }
  });
}

function playOne(mode: ArenaMode, seed: number): void {
  const rnd = seeded(seed);
  const g = new ArenaGame({ botMinThinkMs: 0 });
  const tr = tracker(g);
  const names: string[] = [];
  let over = false;
  for (const n of ['acted', 'logged', 'state', 'sank', 'wheelSpun', 'rolled', 'turnChanged', 'gameOver', 'bonked'] as const) g.on(n, () => names.push(n));
  g.on('state', (s) => {
    tr.check(s);
    checkState(s);
  });
  g.on('gameOver', () => (over = true));
  const where = () => `(${mode} seed ${seed}, round ${g.state.round}, ${g.state.turn})`;
  try {
    g.newGame({ mode, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed });
    for (let n = 0; n < MAX_ACTIONS && !over; n++) {
      const s = g.state;
      need(s.phase === 'action', () => `phase ${s.phase} between actions`);
      checkOptions(g);
      // A made-up action that isn't legal is refused without events.
      const piece = s.pieces[Math.floor(rnd() * s.pieces.length)];
      const bogus: ArenaAction = { type: 'step', pieceId: piece.id, to: SQUARES[Math.floor(rnd() * 64)] };
      if (!legalActions(g.raw).some((a) => actionKey(a) === actionKey(bogus))) {
        const before = names.length;
        need(!g.act(bogus).ok && names.length === before, () => `illegal action accepted: ${JSON.stringify(bogus)}`);
      }
      let a: ArenaAction;
      if (rnd() < 0.5) {
        a = decideArena({ state: cloneArena(g.raw), level: FUZZ_BOT, seed: Math.floor(rnd() * 2 ** 31) });
      } else {
        const all = legalActions(g.raw);
        const moves = all.filter((x) => x.type !== 'endTurn');
        const pool = moves.length && rnd() < 0.9 ? moves : all;
        a = pool[Math.floor(rnd() * pool.length)];
      }
      const start = names.length;
      const r = g.act(a);
      need(r.ok, () => `legal action refused: ${JSON.stringify(a)} ${!r.ok ? r.reason : ''}`);
      if (r.ok && r.pending) {
        g.answerDuel(rnd() < 0.6);
        for (let guard = 0; g.state.phase === 'duel' && guard < 20; guard++) {
          g.throwHand('land', HANDS[Math.floor(rnd() * 3)]);
          g.throwHand('sea', HANDS[Math.floor(rnd() * 3)]);
        }
        need(g.state.phase !== 'duel', () => 'duel never ended');
      }
      checkOrder(names.slice(start));
    }
    need(over, () => `game didn't end in ${MAX_ACTIONS} actions`);  } catch (err) {
    (err as Error).message += ` ${where()}`;
    throw err;
  }
}

/** acted → logged → state; bonked → logged → state; sank → logged; wheelSpun → logged; rolled → state. */
function checkOrder(seq: string[]): void {
  const after: Record<string, string[]> = { acted: ['logged', 'state'], bonked: ['logged', 'state'], sank: ['logged'], wheelSpun: ['logged'], rolled: ['state'] };
  seq.forEach((n, k) => {
    const want = after[n];
    if (want) need(want.every((w, j) => seq[k + 1 + j] === w), () => `${n} followed by ${seq.slice(k + 1, k + 3).join(', ')} in ${seq.join(' ')}`);
    if (n === 'gameOver') need(seq[k - 1] === 'state' && k === seq.length - 1, () => `gameOver out of place: ${seq.join(' ')}`);
    if (n === 'turnChanged') need(seq[k - 1] === 'state', () => `turnChanged not after state: ${seq.join(' ')}`);
  });
}
