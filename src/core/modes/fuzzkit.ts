/**
 * Fuzz: 200 seeded bot-vs-bot games per mode, both sides driven through the controller by the bot's brain
 * (depth-1 search) mixed with random legal actions, random duel calls and throws, and (Normal) the odd undo.
 * After every step: no exceptions, every legal action is accepted and an illegal one refused, `targets()` agrees
 * with the legal list, a piece map rebuilt from events alone matches `pieces` (ids stable), and `modeState` fits `pieces`.
 */
import { describe, expect, it } from 'vitest';
import type { ActionInput, BoardChange, GameMode, Hand, PendingAction, PieceState, Side, Square } from '../../contracts/types';
import { seeded } from '../testUtils';
import { ModeGame } from './game';
import { actionKey, inCheck, legalActions } from './rules';
import { decide } from './search';
import { DEFAULT_TUNING } from './tuning';

const GAMES = 200;
const CHUNK = 25;
const MAX_STEPS = 80;
const HANDS: Hand[] = ['rock', 'paper', 'scissors'];
const SQUARES: Square[] = [];
for (const r of '12345678') for (const f of 'abcdefgh') SQUARES.push(`${f}${r}` as Square);

const where = (g: ModeGame) => `(fen ${g.fen}, phase ${g.modeState.phase})`;

/** A piece map kept up to date from events only, the way integration would. */
function tracker(g: ModeGame) {
  const map = new Map<string, PieceState>();
  const reset = (pieces: PieceState[]) => {
    map.clear();
    for (const p of pieces) map.set(p.id, { ...p });
  };
  const move = (id: string, to: Square) => {
    const p = map.get(id);
    if (!p) throw new Error(`event moved unknown piece ${id}`);
    p.square = to;
  };
  const apply = (changes: BoardChange[]) => {
    for (const c of changes) {
      if (c.type === 'move') move(c.pieceId, c.to);
      else if (c.type === 'capture') {
        if (!map.delete(c.pieceId)) throw new Error(`event captured unknown piece ${c.pieceId}`);
      } else if (c.type === 'spawn') {
        if (map.has(c.piece.id)) throw new Error(`spawned a live id ${c.piece.id}`);
        map.set(c.piece.id, { ...c.piece });
      } else if (c.type === 'promote') {
        const p = map.get(c.pieceId)!;
        map.delete(c.pieceId);
        map.set(c.newId, { ...p, id: c.newId, kind: c.kind, square: c.square });
      }
    }
  };
  g.on('gameStarted', (e) => reset(e.pieces));
  g.on('undone', (e) => reset(e.pieces));
  g.on('moved', (m) => {
    if (m.captured && !map.delete(m.captured.id)) throw new Error(`moved captured unknown ${m.captured.id}`);
    if (m.rookMove) move(m.rookMove.pieceId, m.rookMove.to);
    const end = m.slide?.to ?? m.to;
    move(m.pieceId, end);
    if (m.promotedId) {
      const p = map.get(m.pieceId)!;
      map.delete(m.pieceId);
      map.set(m.promotedId, { ...p, id: m.promotedId, kind: m.promotion!, square: end });
    }
  });
  g.on('powerUsed', (e) => apply(e.changes));
  g.on('cardPlayed', (e) => apply(e.changes));
  g.on('bonusUsed', (e) => apply(e.changes));
  g.on('wheelSpun', (e) => apply(e.changes));
  return {
    check() {
      const real = [...g.pieces].sort((a, b) => a.id.localeCompare(b.id));
      const mine = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
      expect(mine, `pieces rebuilt from events ${where(g)}`).toEqual(real);
    },
  };
}

/** `modeState` must fit `pieces`. */
function checkState(g: ModeGame, mode: GameMode) {
  const ms = g.modeState;
  const pieces = g.pieces;
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const at = new Set(pieces.map((p) => p.square));
  const ctx = where(g);
  expect(byId.size, `ids unique ${ctx}`).toBe(pieces.length);
  expect(at.size, `one piece per square ${ctx}`).toBe(pieces.length);
  const over = g.isOver();
  expect(ms.phase === 'over', ctx).toBe(!!over);
  for (const side of ['land', 'sea'] as Side[]) {
    const kings = pieces.filter((p) => p.side === side && p.kind === 'k').length;
    if (over?.reason === 'kingCaptured' && over.winner !== side) expect(kings).toBe(0);
    else expect(kings, `${side} king ${ctx}`).toBe(1);
    const st = ms[side];
    for (const id of st.powersUsed) expect(byId.get(id)?.side, `used power on live ${side} piece ${id} ${ctx}`).toBe(side);
    expect(new Set(st.powersUsed).size).toBe(st.powersUsed.length);
    for (const p of st.captured) {
      expect(p.side).toBe(side);
      expect(byId.has(p.id), `captured ${p.id} not on the board ${ctx}`).toBe(false);
    }
    const hand = new Set(st.hand.map((c) => c.id));
    for (const id of st.playableCards) expect(hand.has(id), `playable ${id} in hand ${ctx}`).toBe(true);
    if (ms.phase !== 'action' || g.turn !== side) expect(st.playableCards, ctx).toEqual([]);
    if (mode === 'normal') {
      expect(st.hand).toEqual([]);
    } else {
      expect(st.hand.length).toBeLessThanOrEqual(DEFAULT_TUNING.handLimit);
      expect(st.duelTokens).toBeGreaterThanOrEqual(0);
      expect(st.duelTokens).toBeLessThanOrEqual(DEFAULT_TUNING.duelTokens);
      expect(st.nextCardIn).toBeGreaterThanOrEqual(1);
    }
  }
  expect(new Set(ms.statuses.map((s) => s.pieceId)).size, `one status per piece ${ctx}`).toBe(ms.statuses.length);
  for (const s of ms.statuses) {
    const p = byId.get(s.pieceId);
    expect(p && p.kind !== 'k', `status ${s.pieceId} on a live non-king ${ctx}`).toBe(true);
    expect(s.turnsLeft).toBeGreaterThanOrEqual(1);
    expect(s.turnsLeft).toBeLessThanOrEqual(Math.max(DEFAULT_TUNING.stunTurns, DEFAULT_TUNING.freezeTurns));
  }
  for (const b of ms.squares) {
    expect(at.has(b.square), `blocked ${b.square} is empty ${ctx}`).toBe(false);
    expect(b.turnsLeft).toBeGreaterThanOrEqual(1);
    expect(b.turnsLeft).toBeLessThanOrEqual(DEFAULT_TUNING.blockPlies);
  }
  if (mode === 'normal') {
    expect(ms.die).toBeNull();
    expect(ms.nextWheelIn).toBeNull();
  } else if (ms.phase === 'bonus') {
    expect(ms.die?.effect).toBe('lucky');
  }
}

/** Walk `targets()` along an action and check every step against the legal list. */
function checkTargets(g: ModeGame, a: ActionInput, legal: ActionInput[]) {
  if (a.type === 'move' || (a.type === 'bonus' && a.choice === 'skip')) return;
  const same = legal.filter((x): x is typeof a => {
    if (x.type !== a.type) return false;
    if (a.type === 'power') return x.type === 'power' && x.pieceId === a.pieceId;
    if (a.type === 'card') return x.type === 'card' && x.cardId === a.cardId && x.pieceId === a.pieceId;
    return x.type === 'bonus' && x.choice === a.choice;
  });
  for (let n = 0; n <= a.targets.length; n++) {
    const prefix = a.targets.slice(0, n);
    const pending = { ...a, targets: prefix } as PendingAction;
    const step = g.targets(pending);
    const fits = same.filter((x) => prefix.every((t, i) => x.targets[i] === t));
    const next = new Set(fits.filter((x) => x.targets.length > n).map((x) => x.targets[n]));
    const ctx = `${JSON.stringify(pending)} ${where(g)}`;
    expect(new Set(step.squares), `targets() squares ${ctx}`).toEqual(next);
    expect(step.complete, `targets() complete ${ctx}`).toBe(fits.some((x) => x.targets.length === n));
  }
}

/** Something that isn't legal now must be refused and change nothing. */
function checkRefusal(g: ModeGame, rnd: () => number, legal: ActionInput[]) {
  const keys = new Set(legal.map(actionKey));
  for (let tries = 0; tries < 20; tries++) {
    const a: ActionInput = { type: 'move', from: SQUARES[Math.floor(rnd() * 64)], to: SQUARES[Math.floor(rnd() * 64)] };
    if (keys.has(actionKey(a))) continue;
    const fen = g.fen;
    const ms = JSON.stringify(g.modeState);
    expect(g.act(a).ok, `illegal ${JSON.stringify(a)} ${where(g)}`).toBe(false);
    expect(g.fen).toBe(fen);
    expect(JSON.stringify(g.modeState)).toBe(ms);
    return;
  }
}

function playGame(mode: 'normal' | 'crazy', seed: number) {
  const rnd = seeded(seed * 7919 + (mode === 'crazy' ? 1 : 0));
  const g = new ModeGame({ botMinThinkMs: 0 });
  const track = tracker(g);
  g.newGame({ mode, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed });
  track.check();
  checkState(g, mode);
  // Some games play mostly random, others mostly by the bot's brain.
  const searchChance = [0, 0.2, 0.4][seed % 3];
  let steps = 0;
  for (; steps < MAX_STEPS && !g.isOver(); steps++) {
    const ms = g.modeState;
    if (ms.phase === 'duel') {
      g.answerDuel(rnd() < 0.6);
      for (let n = 0; n < 10 && g.modeState.phase === 'duel'; n++) {
        g.throwHand('land', HANDS[Math.floor(rnd() * 3)]);
        g.throwHand('sea', HANDS[Math.floor(rnd() * 3)]);
      }
      expect(g.modeState.phase, `duel settles ${where(g)}`).not.toBe('duel');
    } else if (mode === 'normal' && g.history.length && rnd() < 0.03) {
      g.undo();
    } else {
      const mover = g.turn;
      const legal = legalActions(g.state);
      expect(legal.length, `side to move has an action ${where(g)}`).toBeGreaterThan(0);
      if (rnd() < 0.15) checkRefusal(g, rnd, legal);
      let a: ActionInput | null = null;
      if (rnd() < searchChance) {
        a = decide({ kind: ms.phase === 'bonus' ? 'bonus' : 'action', state: g.state, depth: 1, timeMs: 200, seed: seed + steps });
        expect(a, `bot finds an action ${where(g)}`).not.toBeNull();
        expect(legal.map(actionKey), `bot action is legal ${where(g)}`).toContain(actionKey(a!));
      }
      a ??= legal[Math.floor(rnd() * legal.length)];
      checkTargets(g, a, legal);
      const r = g.act(a);
      if (!r.ok) throw new Error(`legal action refused: ${JSON.stringify(a)} → ${r.reason} ${where(g)}`);
      if (mode === 'normal' && a.type !== 'bonus') {
        expect(inCheck(g.state, mover), `own king safe after ${JSON.stringify(a)} ${where(g)}`).toBe(false);
      }
    }
    track.check();
    checkState(g, mode);
  }
  g.dispose();
  return { steps, over: g.isOver()?.reason ?? 'none' };
}

/** Register the fuzz games for one mode (each mode has its own test file, so both run in parallel). */
export function fuzzMode(mode: 'normal' | 'crazy'): void {
  describe(`fuzz: ${mode}`, () => {
    for (let start = 0; start < GAMES; start += CHUNK) {
      it(`games ${start + 1}-${start + CHUNK}`, async () => {
        for (let seed = start + 1; seed <= start + CHUNK; seed++) {
          try {
            playGame(mode, seed);
          } catch (e) {
            (e as Error).message = `${mode} game seed ${seed}: ${(e as Error).message}`;
            throw e;
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      }, 120_000);
    }
  });
}
