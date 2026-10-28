/** Helpers shared by the Castle/Stones tests (not used by the app). */
import type { ArenaAction, ArenaEventMap, PieceKind, Side, Square } from '../../contracts/types';
import { sqIndex } from '../modes/state';
import type { ArenaGame } from './game';
import type { BoardStage } from './rules';
import { arenaGame, setBoard } from './testkit';
import type { ArenaTuning } from './tuning';

/**
 * A castle game past the draft: `pieces` maps squares to "land-b" style (ids "land-b-e3"), `levels` sets heights.
 * The draft counts as done; the side to move is at stage 'move'.
 */
export function castleGame(
  pieces: Partial<Record<Square, string>>, levels: Partial<Record<Square, number>> = {}, turn: Side = 'land',
  tuning: Partial<ArenaTuning> = {},
): ArenaGame {
  const g = arenaGame('castle', {}, tuning);
  setBoard(g, pieces, turn, 0);
  const s = g.raw;
  s.die = null;
  for (const side of ['land', 'sea'] as Side[]) {
    const kinds = Object.values(pieces).filter((w) => w!.startsWith(side)).map((w) => w!.split('-')[1] as PieceKind);
    while (kinds.length < s.cfg.castleDraftSize) kinds.push('p');
    s.picks[side] = kinds;
  }
  s.levels = new Array(64).fill(0);
  for (const [sq, l] of Object.entries(levels)) s.levels[sqIndex(sq)] = l!;
  s.stage = 'move';
  s.mover = null;
  s.passes = 0;
  return g;
}

/**
 * A stones game with this board: `pieces` as in `castleGame`, `water` = the sunk squares (default: ranks 3–6 all sunk).
 */
export function stonesGame(
  pieces: Partial<Record<Square, string>>, water?: Square[], turn: Side = 'land', stage: BoardStage = 'shape',
  tuning: Partial<ArenaTuning> = {},
): ArenaGame {
  const g = arenaGame('stones', {}, tuning);
  setBoard(g, pieces, turn, 0);
  const s = g.raw;
  s.die = null;
  if (water) {
    s.water = new Array(64).fill(0);
    for (const sq of water) s.water[sqIndex(sq)] = 1;
  }
  s.stage = stage;
  s.fresh = [];
  s.freshNext = [];
  return g;
}

export const shape = (square: Square, dir: 'up' | 'down', pieceId: string | null = null): ArenaAction => ({ type: 'shape', pieceId, square, dir });
export const pick = (kind: PieceKind): ArenaAction => ({ type: 'pick', kind });

/** Every square in these ranks (1..8). */
export function ranks(...rs: number[]): Square[] {
  const out: Square[] = [];
  for (const r of rs) for (const f of 'abcdefgh') out.push(`${f}${r}` as Square);
  return out;
}

/** Record event names (and payloads) in order, Phase 6 events included. */
export function recordBoard(g: ArenaGame): { names: string[]; events: [string, unknown][] } {
  const out = { names: [] as string[], events: [] as [string, unknown][] };
  const names: (keyof ArenaEventMap)[] = ['started', 'state', 'rolled', 'acted', 'tide', 'crowned', 'turnChanged', 'logged', 'gameOver'];
  for (const n of names) {
    g.on(n, (p) => {
      out.names.push(n);
      out.events.push([n, p]);
    });
  }
  return out;
}
