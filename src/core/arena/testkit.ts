/** Helpers shared by the Sumo/Raid tests (not used by the app). */
import type { ArenaAction, ArenaEventMap, ArenaMode, GameOptions, PieceKind, Side, Square } from '../../contracts/types';
import { sqIndex } from '../modes/state';
import { ArenaGame } from './game';
import { setArenaTuning, type ArenaTuning } from './tuning';

/** A local arena game with seed 1. `tuning` applies to this game only. */
export function arenaGame(mode: ArenaMode, opts: Partial<GameOptions> = {}, tuning: Partial<ArenaTuning> = {}): ArenaGame {
  setArenaTuning(tuning);
  const g = new ArenaGame({ botMinThinkMs: 0 });
  g.newGame({ mode, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed: 1, ...opts });
  setArenaTuning(null);
  return g;
}

/**
 * Replace the board: `pieces` maps squares to "land-k", "sea-r" and so on. Ids follow the start-square style
 * ("land-k-e3"). Clears statuses, blocks and fallen animals, sets the side to move and its AP.
 */
export function setBoard(g: ArenaGame, pieces: Partial<Record<Square, string>>, turn: Side = 'land', ap = 4): void {
  const s = g.raw;
  s.board.fill(null);
  for (const [sq, what] of Object.entries(pieces)) {
    const [side, kind] = what!.split('-') as [Side, PieceKind];
    s.board[sqIndex(sq)] = { id: `${side}-${kind}-${sq}`, side, kind };
  }
  s.out = [];
  s.statuses = [];
  s.blocks = [];
  s.powersUsed = [];
  s.turn = turn;
  s.ap = ap;
  s.die = 6;
}

export const id = (side: Side, kind: PieceKind, sq: Square) => `${side}-${kind}-${sq}`;
export const at = (g: ArenaGame, pieceId: string): Square | undefined => g.state.pieces.find((p) => p.id === pieceId)?.square;

export function ok(g: ArenaGame, a: ArenaAction): void {
  const r = g.act(a);
  if (!r.ok) throw new Error(`expected legal: ${JSON.stringify(a)} → ${r.reason}`);
}

export const step = (pieceId: string, to: Square): ArenaAction => ({ type: 'step', pieceId, to });
export const hit = (pieceId: string, target: Square): ArenaAction => ({ type: 'hit', pieceId, target });
export const pw = (pieceId: string, ...targets: Square[]): ArenaAction => ({ type: 'power', pieceId, targets });
export const END: ArenaAction = { type: 'endTurn' };

/** Record every event name (and payload) in order. */
export function record(g: ArenaGame): { names: string[]; events: [string, unknown][] } {
  const out = { names: [] as string[], events: [] as [string, unknown][] };
  const names: (keyof ArenaEventMap)[] = [
    'started', 'state', 'rolled', 'acted', 'sank', 'wheelSpun', 'duelOffered', 'duelRound', 'duelEnded', 'bonked',
    'turnChanged', 'logged', 'gameOver', 'botThinking',
  ];
  for (const n of names) {
    g.on(n, (p) => {
      out.names.push(n);
      out.events.push([n, p]);
    });
  }
  return out;
}
