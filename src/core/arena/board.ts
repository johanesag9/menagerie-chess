/**
 * The turn flow shared by the board-game modes (castle, stones): legal actions per stage, applying one action and
 * moving on to the next stage, and the end and start of a turn. No events here: game.ts emits them; the bot runs
 * the same functions on copies (`advanceTurn`).
 *
 * Stages (`AState.stage`), a stage with nothing legal is skipped:
 * - castle: 'pick' (the draft) · 'move' (a step, or the Shover's hit) · 'shape' · 'more' (the Digger's second dig, or endTurn)
 * - stones: 'shape' (raise, sink, or a power that is the whole turn) · 'move'
 */
import type { ArenaAction, ArenaMode, BoardChange, GameOver, PowerKind, Side } from '../../contracts/types';
import { POWER_OF } from '../../contracts/types';
import { opposite, sqIndex, sqName } from '../modes/state';
import { ADJ, cheb } from './geom';
import {
  applyTide, castleMoves, castlePick, castlePush, castlePushes, castleShape, castleShapes, castleStep, draftChoices, draftDone,
  holdsCastle, tideDue,
} from './castle';
import { cap, findA, maxRoundsOf, type AState, type Outcome } from './rules';
import {
  canRaise, canSink, stonesPower, stonesPowerOptions, stonesShape, stonesShapes, stonesStep, stonesSteps, stonesWinner,
} from './stones';

export const isBoard = (m: ArenaMode) => m === 'castle' || m === 'stones';

/** Every legal action for the side to move. `forBot` trims Stones Block targets to squares next to an animal. */
export function boardLegal(s: AState, forBot = false): ArenaAction[] {
  const out: ArenaAction[] = [];
  if (s.over || !s.stage) return out;
  if (s.stage === 'pick') {
    for (const kind of draftChoices(s)) out.push({ type: 'pick', kind });
    return out;
  }
  if (s.mode === 'castle') {
    if (s.stage === 'move') {
      for (let i = 0; i < 64; i++) {
        const p = s.board[i];
        if (!p || p.side !== s.turn) continue;
        for (const m of castleMoves(s, i)) out.push({ type: 'step', pieceId: p.id, to: sqName(m.to) });
        for (const h of castlePushes(s, i)) out.push({ type: 'hit', pieceId: p.id, target: sqName(h.victim) });
      }
      return out;
    }
    for (const o of castleShapes(s)) {
      if (o.up) out.push({ type: 'shape', pieceId: s.mover, square: sqName(o.sq), dir: 'up' });
      if (o.down) out.push({ type: 'shape', pieceId: s.mover, square: sqName(o.sq), dir: 'down' });
    }
    if (s.stage === 'more') out.push({ type: 'endTurn' });
    return out;
  }
  // stones
  if (s.stage === 'shape') {
    // The bot only shapes within 2 squares of an animal: anything farther can wait.
    const near = forBot ? nearAnimals(s) : null;
    for (const o of stonesShapes(s)) {
      if (!near || near[o.sq]) out.push({ type: 'shape', pieceId: null, square: sqName(o.sq), dir: o.up ? 'up' : 'down' });
    }
  }
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.side !== s.turn) continue;
    for (const j of stonesSteps(s, i)) out.push({ type: 'step', pieceId: p.id, to: sqName(j) });
    let opts = stonesPowerOptions(s, i);
    if (forBot && p.kind === 'q') opts = opts.filter(([j]) => ADJ[j].some((k) => s.board[k]));
    for (const t of opts) out.push({ type: 'power', pieceId: p.id, targets: t.map(sqName) });
  }
  return out;
}

function nearAnimals(s: AState): boolean[] {
  const near = new Array<boolean>(64).fill(false);
  for (let i = 0; i < 64; i++) if (s.board[i]) for (let j = 0; j < 64; j++) if (cheb(i, j) <= 2) near[j] = true;
  return near;
}

/** Apply a legal action for the side to move (the caller checked it) and move to the next stage. `done` = the turn is over. */
export function boardApply(s: AState, a: ArenaAction, labels = true): Outcome {
  if (a.type === 'endTurn') {
    s.stage = null;
    return { changes: [], label: 'Ended the turn', done: true };
  }
  s.passes = 0;
  let r: { changes: BoardChange[]; label: string };
  let power: PowerKind | undefined;
  let done = false;
  if (a.type === 'pick') {
    r = castlePick(s, a.kind);
    done = true;
  } else if (s.mode === 'castle') {
    if (a.type === 'step') {
      const i = findA(s, a.pieceId);
      const to = sqIndex(a.to);
      r = castleStep(s, i, castleMoves(s, i).find((m) => m.to === to)!);
      s.stage = 'shape';
      done = castleShapes(s).length === 0;
    } else if (a.type === 'hit') {
      const i = findA(s, a.pieceId);
      const v = sqIndex(a.target);
      r = castlePush(s, i, v, castlePushes(s, i).find((h) => h.victim === v)!.to);
      s.stage = 'shape';
      done = castleShapes(s).length === 0;
    } else if (a.type === 'shape') {
      const digger = s.board[findA(s, s.mover!)]?.kind === 'p';
      const first = s.stage === 'shape';
      r = castleShape(s, sqIndex(a.square), a.dir === 'up');
      if (first && digger && a.dir === 'down') {
        s.stage = 'more';
        done = castleShapes(s).length === 0;
      } else {
        done = true;
      }
    } else {
      throw new Error(`castle has no '${a.type}' action`);
    }
  } else {
    if (a.type === 'shape') {
      r = stonesShape(s, sqIndex(a.square), a.dir === 'up');
      s.stage = 'move';
      done = !anyMove(s);
    } else if (a.type === 'step') {
      r = stonesStep(s, findA(s, a.pieceId), sqIndex(a.to));
      done = true;
    } else if (a.type === 'power') {
      const i = findA(s, a.pieceId);
      power = POWER_OF[s.board[i]!.kind];
      r = stonesPower(s, i, a.targets.map(sqIndex));
      done = true;
    } else {
      throw new Error(`stones has no '${a.type}' action`);
    }
    s.over = stonesWinner(s, s.turn);
  }
  // A pick keeps stage 'pick' until the turn ends, so `boardEndTurn` knows not to count it as a round.
  if ((done && a.type !== 'pick') || s.over) s.stage = null;
  return { changes: r.changes, label: labels ? r.label : '', ...(power ? { power } : {}), done: done || !!s.over };
}


/**
 * Set the first stage of the side to move's turn. Returns false when it can do nothing at all (it passes).
 * Stones: 'shape' when it can raise, sink or use a power, else straight to 'move'.
 */
export function beginTurn(s: AState): boolean {
  s.mover = null;
  if (s.mode === 'castle') {
    s.stage = draftDone(s) ? 'move' : 'pick';
  } else {
    s.stage = 'shape';
    if (!canShapeStones(s)) s.stage = 'move';
  }
  if (s.stage === 'pick' || (s.stage === 'shape' ? true : anyMove(s))) return true;
  s.stage = null;
  return false;
}

/** Stones: can the side to move raise, sink or use a power? (Quick: stops at the first one.) */
function canShapeStones(s: AState): boolean {
  for (let i = 0; i < 64; i++) if (canRaise(s, i) || canSink(s, i)) return true;
  for (let i = 0; i < 64; i++) if (s.board[i]?.side === s.turn && stonesPowerOptions(s, i).length) return true;
  return false;
}

/** Can the side to move make its move (castle: a step or a push; stones: a step)? */
function anyMove(s: AState): boolean {
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.side !== s.turn) continue;
    if (s.mode === 'castle' ? castleMoves(s, i).length || castlePushes(s, i).length : stonesSteps(s, i).length) return true;
  }
  return false;
}

/**
 * End the side to move's turn: (castle) the tide at the end of every Nth round, fresh squares and blocks tick over,
 * the turn passes. The draft doesn't count rounds. Returns the tide, if any.
 */
export function boardEndTurn(s: AState): { changes: BoardChange[]; label: string } | null {
  const drafting = s.stage === 'pick';
  const tide = tideDue(s) ? applyTide(s) : null;
  s.fresh = s.freshNext;
  s.freshNext = [];
  s.stage = null;
  s.mover = null;
  s.turn = opposite(s.turn);
  if (s.turn === 'land' && !drafting) s.round++;
  for (const b of s.blocks) b.turnsLeft--;
  s.blocks = s.blocks.filter((b) => b.turnsLeft > 0);
  return tide;
}

/**
 * After `boardEndTurn`: does the game end before the next turn starts? Castle: two passes in a row (nobody could do
 * anything for a whole round) is a draw. After the last round: castle, a side that holds a castle at the start of its
 * turn still wins; else a draw. `completedRound` = the round Sea's turn just finished, else null.
 */
export function turnOverResult(s: AState, completedRound: number | null): GameOver | null {
  if (s.mode === 'castle' && s.passes >= 2) return { winner: null, reason: 'stalemate' };
  if (completedRound !== null && completedRound >= maxRoundsOf(s)) {
    return s.mode === 'castle' && holdsCastle(s, s.turn) ? { winner: s.turn, reason: 'castle' } : { winner: null, reason: 'rounds' };
  }
  return null;
}

/** Castle, at the start of a turn: the side to move still stands on a castle, so it wins. */
export function startWin(s: AState): GameOver | null {
  return s.mode === 'castle' && draftDone(s) && holdsCastle(s, s.turn) ? { winner: s.turn, reason: 'castle' } : null;
}

/** The round Sea's turn is about to finish (for the round cap), else null. Call before `boardEndTurn`. */
export const completingRound = (s: AState): number | null => (s.turn === 'sea' && s.stage !== 'pick' && (s.mode !== 'castle' || draftDone(s)) ? s.round : null);

/**
 * The whole end of a turn and start of the next, without events (the bot's search): end the turn, check the game,
 * start the next turn, and pass for a side that can't do anything (at most twice in a row).
 */
export function advanceTurn(s: AState): void {
  for (let n = 0; n < 3 && !s.over; n++) {
    const completed = completingRound(s);
    boardEndTurn(s);
    s.over = turnOverResult(s, completed) ?? startWin(s);
    if (s.over || beginTurn(s)) return;
    s.passes++;
  }
}

/** Plain words for a pass. */
export const passLabel = (side: Side) => `${cap(side)} had nothing to do and passed`;
