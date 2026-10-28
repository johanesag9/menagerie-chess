/**
 * Sandcastle King rules (GAME_SPEC "Board-game modes"). Draft 2 animals each; a turn is: move one animal
 * (up at most 1 level, down any), then build or dig next to it. An animal still on a level-3 castle at the start of
 * its own turn wins. Works on the shared arena board model (rules.ts): `levels`, `picks`, `stage`, `mover`.
 */
import type { BoardChange, PieceKind, Side } from '../../contracts/types';
import { rankOf, sqIndex, sqName } from '../modes/state';
import { ADJ, HOPS, cheb, stepFrom } from './geom';
import { ANIMAL, cap, findA, relocate, type AState } from './rules';

/** The always-on traits, the same for both sides (pieceOptions().power name and line). */
export const TRAITS: Record<PieceKind, { name: string; line: string }> = {
  p: { name: 'Digger', line: 'After a dig, it may dig once more.' },
  n: { name: 'Leaper', line: 'Its move may be a knight hop (still up at most 1 level).' },
  b: { name: 'Climber', line: 'It may go up 2 levels in one step.' },
  r: { name: 'Builder', line: 'A build adds 2 levels (up to 3).' },
  q: { name: 'Shover', line: 'Instead of moving, it may push an enemy next to it 1 square.' },
  k: { name: 'Zoomer', line: 'Its move may be 2 steps.' },
};

export const CASTLE = 3;
const maxUp = (kind: PieceKind) => (kind === 'b' ? 2 : 1);

/** One way to move: `via` is the middle square of a Zoomer's 2 steps (-1 for a single step or hop). */
export interface CMove { to: number; via: number; hop: boolean }

/** Every square the animal on i can move to (one route each), traits included. Ignores turn and stage. */
export function castleMoves(s: AState, i: number): CMove[] {
  const p = s.board[i];
  if (!p) return [];
  const up = maxUp(p.kind);
  const L = s.levels;
  const seen = new Array<boolean>(64).fill(false);
  const out: CMove[] = [];
  const add = (to: number, via: number, hop: boolean) => {
    if (seen[to]) return;
    seen[to] = true;
    out.push({ to, via, hop });
  };
  const singles: number[] = [];
  for (const j of ADJ[i]) {
    if (!s.board[j] && L[j] - L[i] <= up) {
      singles.push(j);
      add(j, -1, false);
    }
  }
  if (p.kind === 'n') for (const j of HOPS[i]) if (!s.board[j] && L[j] - L[i] <= 1) add(j, -1, true);
  if (p.kind === 'k') {
    for (const j of singles) for (const k of ADJ[j]) if (!s.board[k] && L[k] - L[j] <= up) add(k, j, false);
  }
  return out;
}

/** The Shover's pushes from i: the enemy on `victim` goes to `to` (on the board, empty, up at most 1 level). */
export function castlePushes(s: AState, i: number): { victim: number; to: number }[] {
  const p = s.board[i];
  if (!p || p.kind !== 'q') return [];
  const out: { victim: number; to: number }[] = [];
  for (const v of ADJ[i]) {
    const q = s.board[v];
    if (!q || q.side === p.side) continue;
    const to = stepFrom(v, Math.sign((v & 7) - (i & 7)), Math.sign((v >> 3) - (i >> 3)));
    if (to >= 0 && !s.board[to] && s.levels[to] - s.levels[v] <= 1) out.push({ victim: v, to });
  }
  return out;
}

export interface CShape { sq: number; up: boolean; down: boolean; upBy: number }

/** What the mover can build or dig next to itself now (stage 'shape'; 'more' = the Digger's second dig only). */
export function castleShapes(s: AState): CShape[] {
  if (s.over || (s.stage !== 'shape' && s.stage !== 'more') || !s.mover) return [];
  const i = findA(s, s.mover);
  const p = s.board[i];
  if (!p) return [];
  const out: CShape[] = [];
  for (const j of ADJ[i]) {
    const q = s.board[j];
    const L = s.levels[j];
    const up = s.stage === 'shape' && !q && L < CASTLE;
    const down = L > 0 && (!q || q.side !== p.side);
    if (up || down) out.push({ sq: j, up, down, upBy: up ? Math.min(p.kind === 'r' ? 2 : 1, CASTLE - L) : 0 });
  }
  return out;
}

// ---------- the draft ----------

export const draftDone = (s: AState) => s.picks.land.length >= s.cfg.castleDraftSize && s.picks.sea.length >= s.cfg.castleDraftSize;

/** Kinds the side to move can still pick. */
export function draftChoices(s: AState): PieceKind[] {
  if (s.over || s.stage !== 'pick') return [];
  return (['p', 'n', 'b', 'r', 'q', 'k'] as PieceKind[]).filter((k) => !s.picks[s.turn].includes(k));
}

/** Pick an animal. The last pick places all of them on their start squares (`enter` changes, one step). */
export function castlePick(s: AState, kind: PieceKind): { changes: BoardChange[]; label: string } {
  const side = s.turn;
  s.picks[side].push(kind);
  const label = `${cap(side)} picked the ${ANIMAL[side][kind]} (${TRAITS[kind].name})`;
  const changes: BoardChange[] = [];
  if (draftDone(s)) {
    for (let k = 0; k < s.cfg.castleDraftSize; k++) {
      for (const who of ['land', 'sea'] as Side[]) {
        const kd = s.picks[who][k];
        const sq = sqIndex(s.cfg.castleStarts[who][k]);
        const id = `${who}-${kd}-${sqName(sq)}`;
        s.board[sq] = { id, side: who, kind: kd };
        changes.push({ step: 0, type: 'enter', piece: { id, side: who, kind: kd, square: sqName(sq) } });
      }
    }
  }
  return { changes, label };
}

// ---------- a turn ----------

const nameOf = (s: AState, i: number) => {
  const p = s.board[i]!;
  return ANIMAL[p.side][p.kind];
};
const lvl = (n: number) => (n === CASTLE ? 'castle' : `level ${n}`);

export function castleStep(s: AState, i: number, m: CMove): { changes: BoardChange[]; label: string } {
  const p = s.board[i]!;
  const from = sqName(i);
  const changes: BoardChange[] = [];
  if (m.via >= 0) {
    changes.push({ step: 0, type: 'move', pieceId: p.id, from, to: sqName(m.via), how: 'step' });
    changes.push({ step: 1, type: 'move', pieceId: p.id, from: sqName(m.via), to: sqName(m.to), how: 'step' });
  } else {
    changes.push({ step: 0, type: 'move', pieceId: p.id, from, to: sqName(m.to), how: m.hop ? 'jump' : 'step' });
  }
  relocate(s, i, m.to);
  s.mover = p.id;
  const dl = s.levels[m.to] - s.levels[i];
  const how = dl > 0 ? ` (up to ${lvl(s.levels[m.to])})` : dl < 0 ? ` (down to ${lvl(s.levels[m.to])})` : '';
  return { changes, label: `${ANIMAL[p.side][p.kind]} ${from}→${sqName(m.to)}${how}` };
}

export function castlePush(s: AState, i: number, v: number, to: number): { changes: BoardChange[]; label: string } {
  const p = s.board[i]!;
  const q = s.board[v]!;
  relocate(s, v, to);
  s.mover = p.id;
  const dl = s.levels[to] - s.levels[v];
  const how = dl < 0 ? `, down ${-dl} level${dl === -1 ? '' : 's'}` : dl > 0 ? ', up 1 level' : '';
  return {
    changes: [{ step: 0, type: 'move', pieceId: q.id, from: sqName(v), to: sqName(to), how: 'pushed' }],
    label: `${ANIMAL[p.side][p.kind]} pushed ${ANIMAL[q.side][q.kind]} ${sqName(v)}→${sqName(to)}${how}`,
  };
}

/** Build (up) or dig (down) square j next to the mover. */
export function castleShape(s: AState, j: number, up: boolean): { changes: BoardChange[]; label: string } {
  const i = findA(s, s.mover!);
  const p = s.board[i]!;
  const from = s.levels[j];
  const to = up ? Math.min(CASTLE, from + (p.kind === 'r' ? 2 : 1)) : from - 1;
  s.levels[j] = to;
  const rider = s.board[j];
  const extra = rider && !up ? ` (${nameOf(s, j)} rode down)` : '';
  return {
    changes: [{ step: 0, type: 'level', square: sqName(j), from: from as 0 | 1 | 2 | 3, to: to as 0 | 1 | 2 | 3, cause: up ? 'build' : 'dig', by: p.id }],
    label: `${ANIMAL[p.side][p.kind]} ${up ? 'built' : 'dug'} ${sqName(j)} ${from}→${to}${to === CASTLE ? ': a castle!' : ''}${extra}`,
  };
}

// ---------- castles, crowns and the tide ----------

/** Does `side` have an animal on a castle? (At the start of its own turn, that wins.) */
export function holdsCastle(s: AState, side: Side): boolean {
  for (let i = 0; i < 64; i++) if (s.levels[i] === CASTLE && s.board[i]?.side === side) return true;
  return false;
}

/**
 * `ArenaState.crowned`: an animal on a castle. The other side's one first (it wins at the start of its next turn,
 * unless the side to move digs it out or pushes it off); else one of the side to move's own (it stepped up this turn).
 */
export function crownedOf(s: AState): { id: string; side: Side; sq: number } | null {
  if (s.mode !== 'castle') return null;
  let own: { id: string; side: Side; sq: number } | null = null;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || s.levels[i] !== CASTLE) continue;
    if (p.side !== s.turn) return { id: p.id, side: p.side, sq: i };
    own ??= { id: p.id, side: p.side, sq: i };
  }
  return own;
}

/**
 * Can `side` take the crown away from the animal on castle square c this turn: move next to it and dig, or push it off?
 * (A quick check for the bot.)
 */
export function canAnswerCrown(s: AState, side: Side, c: number): boolean {
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p || p.side !== side) continue;
    if (castlePushes(s, i).some((x) => x.victim === c)) return true;
    if (castleMoves(s, i).some((m) => cheb(m.to, c) === 1)) return true;
  }
  return false;
}

/** Is the tide due at the end of this round (after Sea's turn)? Never in the draft or on the last round. */
export const tideDue = (s: AState) =>
  s.mode === 'castle' && s.turn === 'sea' && s.stage !== 'pick' && s.round % s.cfg.tideEvery === 0 && s.round < s.cfg.castleMaxRounds;

/** `ArenaState.nextTideIn`: rounds until the tide, counting this one (1 = at the end of this round); null = no more. */
export function nextTideIn(s: AState): number | null {
  if (s.mode !== 'castle' || s.over) return null;
  const n = s.cfg.tideEvery - ((s.round - 1) % s.cfg.tideEvery);
  return s.round + n - 1 < s.cfg.castleMaxRounds ? n : null;
}

/** The tide: every empty beach square (ranks 5–8) loses a level. All changes in step 0. */
export function applyTide(s: AState): { changes: BoardChange[]; label: string } {
  const changes: BoardChange[] = [];
  for (let i = 0; i < 64; i++) {
    if (rankOf(i) < 4 || s.board[i] || s.levels[i] === 0) continue;
    const from = s.levels[i];
    s.levels[i] = from - 1;
    changes.push({ step: 0, type: 'level', square: sqName(i), from: from as 0 | 1 | 2 | 3, to: (from - 1) as 0 | 1 | 2, cause: 'tide' });
  }
  return { changes, label: changes.length ? `The tide wore down ${changes.length} beach square${changes.length === 1 ? '' : 's'}` : 'The tide came in (nothing to wear down)' };
}
