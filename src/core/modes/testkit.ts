/** Helpers shared by the Normal/Crazy tests (not used by the app). */
import type { ActionInput, Card, CardSuit, DieValue, GameEventMap, GameOptions, PieceId, Side, Square } from '../../contracts/types';
import { ModeGame } from './game';
import { DEFAULT_TUNING, setTuning, type Tuning } from './tuning';

export const QUIET_DIE: Tuning['dieFaces'] = ['none', 'none', 'none', 'none', 'none', 'none'];

/** A local Normal/Crazy game. Crazy tests default to a die that never does anything (set `s.die` to test it). */
export function modeGame(
  mode: 'normal' | 'crazy',
  fen?: string,
  opts: Partial<GameOptions> = {},
  tuning: Partial<Tuning> = {},
): ModeGame {
  setTuning({ ...(mode === 'crazy' ? { dieFaces: QUIET_DIE, startHand: 0 } : {}), ...tuning });
  const g = new ModeGame({ botMinThinkMs: 0 });
  g.newGame({ mode, opponent: { type: 'local' }, time: { initialMs: null, incrementMs: 0 }, weirdMode: false, seed: 1, ...(fen ? { fen } : {}), ...opts });
  setTuning(null);
  return g;
}

export const at = (g: ModeGame, id: PieceId): Square | undefined => g.pieces.find((p) => p.id === id)?.square;
export const idAt = (g: ModeGame, sq: Square): PieceId | undefined => g.pieces.find((p) => p.square === sq)?.id;

export function ok(g: ModeGame, a: ActionInput): void {
  const r = g.act(a);
  if (!r.ok) throw new Error(`expected legal: ${JSON.stringify(a)} → ${r.reason} (fen ${g.fen})`);
}

export const mv = (from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n'): ActionInput =>
  ({ type: 'move', from, to, ...(promotion ? { promotion } : {}) });
export const pw = (pieceId: PieceId, ...targets: Square[]): ActionInput => ({ type: 'power', pieceId, targets });

/** Put cards straight into a hand. */
export function give(g: ModeGame, side: Side, ...suits: CardSuit[]): Card[] {
  const cards = suits.map((suit, n) => ({ id: `t${side[0]}${n}-${Math.random().toString(36).slice(2, 6)}`, suit }));
  g.state[side].hand.push(...cards);
  return cards;
}

export function setDie(g: ModeGame, value: DieValue): void {
  g.state.die = { value, effect: value === 1 ? 'banana' : value === 6 ? 'lucky' : 'none' };
  g.state.phase = value === 6 ? 'bonus' : 'action';
}

export function record(g: ModeGame) {
  const log: { name: keyof GameEventMap; payload: unknown }[] = [];
  const names = [
    'gameStarted', 'moved', 'turnChanged', 'check', 'gameOver', 'botThinking', 'undone', 'modeState', 'powerUsed',
    'cardPlayed', 'bonusUsed', 'dieRolled', 'cardDrawn', 'turnPassed', 'logged', 'wheelSpun', 'duelOffered', 'duelRound',
    'duelEnded', 'bonked',
  ] as const;
  for (const n of names) g.on(n, (payload) => log.push({ name: n, payload }));
  return {
    log,
    names: () => log.map((e) => e.name),
    last: <K extends keyof GameEventMap>(n: K) => [...log].reverse().find((e) => e.name === n)?.payload as GameEventMap[K] | undefined,
    clear: () => (log.length = 0),
  };
}

export { DEFAULT_TUNING };
