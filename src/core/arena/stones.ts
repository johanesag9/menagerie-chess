/**
 * Stepping Stones rules (GAME_SPEC "Board-game modes"). A turn: shape the sea (raise or sink one square, or use a
 * power, which is the whole turn), then step one animal. First animal on the enemy back rank wins.
 * Works on the shared arena board model (rules.ts): `water` marks sunk squares, `fresh` the ones changed last turn.
 */
import type { BoardChange, GameOver, PieceKind, PowerBlock, Side } from '../../contracts/types';
import { opposite, rankOf, sqName } from '../modes/state';
import { ADJ, HOPS, cheb, stepFrom } from './geom';
import { ANIMAL, blockAt, relocate, sentHomeSquare, type AState } from './rules';

export const STONES_POWERS: Record<PieceKind, { name: string; line: string }> = {
  p: { name: 'Bridge', line: 'Raise two sunk squares in a row; the first must touch dry land.' },
  n: { name: 'Double jump', line: 'Two knight hops onto empty dry squares; water in between doesn’t matter.' },
  b: { name: 'Headbutt', line: 'Push an enemy next to it 1 square. Into the water, it’s sent home.' },
  r: { name: 'Stomp', line: 'Sink every empty dry square around it in ranks 3–6 (fresh ones too).' },
  q: { name: 'Block', line: 'A vase or ink cloud on an empty dry square: no sinking, no standing, for 4 plies.' },
  k: { name: 'Escape', line: 'Teleport to an empty dry square up to 2 away.' },
};

export const isDry = (s: AState, i: number) => s.water[i] === 0;
export const isFresh = (s: AState, i: number) => s.cfg.freshRule && s.fresh.includes(i);
/** In the middle ranks that start under water (the only ones that can be sunk). */
const inSea = (s: AState, i: number) => s.cfg.stonesWaterRanks.includes(rankOf(i) + 1);
/** An animal can stand here: dry, no animal, no block. */
export const isOpen = (s: AState, i: number) => s.water[i] === 0 && !s.board[i] && !blockAt(s, i);
const backRank = (side: Side) => (side === 'land' ? 7 : 0);

export function canRaise(s: AState, i: number): boolean {
  return s.water[i] === 1 && !isFresh(s, i) && ADJ[i].some((j) => s.water[j] === 0);
}

export function canSink(s: AState, i: number): boolean {
  return isOpen(s, i) && inSea(s, i) && !isFresh(s, i);
}

/** Squares the side to move can raise or sink now (stage 'shape' only). */
export function stonesShapes(s: AState): { sq: number; up: boolean; down: boolean }[] {
  if (s.over || s.stage !== 'shape') return [];
  const out: { sq: number; up: boolean; down: boolean }[] = [];
  for (let i = 0; i < 64; i++) {
    const up = canRaise(s, i);
    const down = !up && canSink(s, i);
    if (up || down) out.push({ sq: i, up, down });
  }
  return out;
}

/** Steps for the animal on i (stage 'move', its side to move). */
export function stonesSteps(s: AState, i: number): number[] {
  const p = s.board[i];
  if (!p || s.over || s.stage !== 'move' || p.side !== s.turn) return [];
  return ADJ[i].filter((j) => isOpen(s, j));
}

/** Every complete target list for this animal's power, ignoring turn, stage and use. */
export function stonesPowerRaw(s: AState, i: number): number[][] {
  const p = s.board[i];
  if (!p) return [];
  const out: number[][] = [];
  switch (p.kind) {
    case 'p':
      for (let a = 0; a < 64; a++) {
        if (!canRaise(s, a)) continue;
        for (const b of ADJ[a]) if (s.water[b] === 1 && !isFresh(s, b)) out.push([a, b]);
      }
      break;
    case 'n':
      for (const mid of HOPS[i]) {
        if (!isOpen(s, mid)) continue;
        for (const to of HOPS[mid]) if (to !== i && isOpen(s, to)) out.push([mid, to]);
      }
      break;
    case 'b':
      for (const v of ADJ[i]) if (headbuttDest(s, i, v) !== null) out.push([v]);
      break;
    case 'r':
      if (stompSquares(s, i).length) out.push([]);
      break;
    case 'q':
      for (let j = 0; j < 64; j++) if (isOpen(s, j)) out.push([j]);
      break;
    case 'k':
      for (let j = 0; j < 64; j++) if (j !== i && cheb(i, j) <= 2 && isOpen(s, j)) out.push([j]);
      break;
  }
  return out;
}

export function stonesPowerBlock(s: AState, i: number): PowerBlock | undefined {
  const p = s.board[i];
  if (!p) return 'noTarget';
  if (s.over) return 'wrongPhase';
  if (p.side !== s.turn) return 'notYourTurn';
  if (s.powersUsed.includes(p.id)) return 'used';
  if (s.stage !== 'shape') return 'wrongPhase';
  if (!stonesPowerRaw(s, i).length) return 'noTarget';
  return undefined;
}

export function stonesPowerOptions(s: AState, i: number): number[][] {
  return stonesPowerBlock(s, i) ? [] : stonesPowerRaw(s, i);
}

/**
 * Where a headbutted enemy on v (pushed away from the goat on g) ends up: the next square when it is open,
 * home when that square is water. Null when it can't be pushed (not an enemy, off the board, an animal or block behind).
 */
export function headbuttDest(s: AState, g: number, v: number): { to: number; home: boolean } | null {
  const p = s.board[g];
  const q = s.board[v];
  if (!p || !q || q.side === p.side) return null;
  const to = stepFrom(v, Math.sign((v & 7) - (g & 7)), Math.sign((v >> 3) - (g >> 3)));
  if (to < 0 || s.board[to] || blockAt(s, to)) return null;
  if (s.water[to] === 0) return { to, home: false };
  const home = sentHomeSquare(s, q, v);
  return home === null ? null : { to: home, home: true };
}

/** Stomp: every empty dry square around the rook in the middle ranks, fresh or not. */
export function stompSquares(s: AState, i: number): number[] {
  return ADJ[i].filter((j) => isOpen(s, j) && inSea(s, j));
}

/** The squares a power would touch, for `previewArea`. */
export function stonesPowerArea(s: AState, i: number, targets: number[]): number[] {
  const p = s.board[i];
  if (!p) return [];
  if (p.kind === 'r') return stompSquares(s, i);
  if (p.kind === 'b' && targets.length) {
    const d = headbuttDest(s, i, targets[0]);
    return d ? [targets[0], d.to] : [targets[0]];
  }
  return targets.slice();
}

const nameOf = (s: AState, i: number) => {
  const p = s.board[i]!;
  return ANIMAL[p.side][p.kind];
};

/** Raise or sink one square. */
export function stonesShape(s: AState, i: number, up: boolean): { changes: BoardChange[]; label: string } {
  s.water[i] = up ? 0 : 1;
  s.freshNext.push(i);
  return {
    changes: [{ step: 0, type: 'water', square: sqName(i), sunk: !up, cause: up ? 'raise' : 'sink' }],
    label: `${up ? 'Raised' : 'Sank'} ${sqName(i)}`,
  };
}

export function stonesStep(s: AState, i: number, to: number): { changes: BoardChange[]; label: string } {
  const label = `${nameOf(s, i)} ${sqName(i)}→${sqName(to)}`;
  const id = s.board[i]!.id;
  relocate(s, i, to);
  return { changes: [{ step: 0, type: 'move', pieceId: id, from: sqName(i), to: sqName(to), how: 'step' }], label };
}

/** Use the power of the animal on i (the caller checked the targets). */
export function stonesPower(s: AState, i: number, t: number[]): { changes: BoardChange[]; label: string } {
  const p = s.board[i]!;
  const pname = `${ANIMAL[p.side][p.kind]}: ${STONES_POWERS[p.kind].name}`;
  const changes: BoardChange[] = [];
  s.powersUsed.push(p.id);
  switch (p.kind) {
    case 'p':
      t.forEach((j, k) => {
        s.water[j] = 0;
        s.freshNext.push(j);
        changes.push({ step: k, type: 'water', square: sqName(j), sunk: false, cause: 'bridge' });
      });
      return { changes, label: `${pname} ${sqName(t[0])}+${sqName(t[1])}` };
    case 'n':
      relocate(s, i, t[0]);
      relocate(s, t[0], t[1]);
      changes.push(
        { step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(t[0]), how: 'jump' },
        { step: 1, type: 'move', pieceId: p.id, from: sqName(t[0]), to: sqName(t[1]), how: 'jump' },
      );
      return { changes, label: `${pname} ${sqName(i)}→${sqName(t[0])}→${sqName(t[1])}` };
    case 'b': {
      const v = t[0];
      const victim = s.board[v]!;
      const d = headbuttDest(s, i, v)!;
      relocate(s, v, d.to);
      changes.push({ step: 0, type: 'move', pieceId: victim.id, from: sqName(v), to: sqName(d.to), how: d.home ? 'sentHome' : 'pushed' });
      const vname = ANIMAL[victim.side][victim.kind];
      return { changes, label: d.home ? `${pname}: ${vname} splashed in and was sent home to ${sqName(d.to)}` : `${pname} on ${vname} (${sqName(v)}→${sqName(d.to)})` };
    }
    case 'r': {
      const sq = stompSquares(s, i);
      for (const j of sq) {
        s.water[j] = 1;
        s.freshNext.push(j);
        changes.push({ step: 0, type: 'water', square: sqName(j), sunk: true, cause: 'stomp' });
      }
      return { changes, label: `${pname} on ${sqName(i)} (${sq.length} sank)` };
    }
    case 'q':
      s.blocks.push({ sq: t[0], by: p.side, turnsLeft: s.cfg.blockPlies });
      changes.push({ step: 0, type: 'block', square: sqName(t[0]), by: p.side });
      return { changes, label: `${pname} on ${sqName(t[0])}` };
    case 'k':
      relocate(s, i, t[0]);
      changes.push({ step: 0, type: 'move', pieceId: p.id, from: sqName(i), to: sqName(t[0]), how: 'teleport' });
      return { changes, label: `${pname} ${sqName(i)}→${sqName(t[0])}` };
  }
}

/** An animal on the enemy back rank wins: the mover's side is checked first (a headbutt can put an enemy there). */
export function stonesWinner(s: AState, mover: Side | null): GameOver | null {
  const sides: Side[] = mover ? [mover, opposite(mover)] : ['land', 'sea'];
  for (const side of sides) {
    const r = backRank(side);
    for (let f = 0; f < 8; f++) if (s.board[f + 8 * r]?.side === side) return { winner: side, reason: 'crossed' };
  }
  return null;
}

/**
 * `ArenaState.pathLength`: steps from the side's nearest animal to the enemy back rank over dry squares
 * (blocks can't be crossed; animals are ignored, they can move). Null when there is no dry path.
 */
export function pathLength(s: AState, side: Side): number | null {
  const dist = new Array<number>(64).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (s.board[i]?.side === side) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  const goal = backRank(side);
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    if (rankOf(i) === goal) return dist[i];
    for (const j of ADJ[i]) {
      if (dist[j] >= 0 || s.water[j] === 1 || blockAt(s, j)) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return null;
}
