/** Rule helpers on top of chess.js: FEN checks, game-over detection, mating material. */
import { Chess, validateFen } from 'chess.js';
import type { GameOver, Side, Square } from '../contracts/types';
import { colorToSide, sideToColor } from '../contracts/types';

/** Throws an Error with a plain message if the FEN can't start a game. */
export function assertPlayableFen(fen: string): void {
  const trimmed = fen.trim();
  const v = validateFen(trimmed);
  if (!v.ok) throw new Error(v.error ?? 'Invalid FEN');
  const placement = trimmed.split(/\s+/)[0];
  const count = (ch: string) => [...placement].filter((c) => c === ch).length;
  if (count('K') !== 1 || count('k') !== 1) throw new Error('Invalid FEN: each side needs exactly one king');
  const rows = placement.split('/');
  if (/[pP]/.test(rows[0]) || /[pP]/.test(rows[7])) throw new Error('Invalid FEN: pawns cannot stand on rank 1 or 8');
  const chess = new Chess(trimmed);
  // The side that just moved can't be left in check.
  const waiting = chess.turn() === 'w' ? 'b' : 'w';
  const king = chess.findPiece({ type: 'k', color: waiting })[0];
  if (king && chess.isAttacked(king, chess.turn())) {
    throw new Error('Invalid FEN: the side not to move is in check');
  }
}

/** Board-based endings, checked after every move. `mover` is the side that just moved. */
export function detectGameOver(chess: Chess, mover: Side): GameOver | null {
  if (chess.isCheckmate()) return { winner: mover, reason: 'checkmate' };
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' };
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'threefold' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fiftyMove' };
  return null;
}

/**
 * Can `side` still deliver mate at all? Used when the other side's flag falls.
 * Rule used (USCF-style, simple): a lone king, or king plus a single knight or bishop, can't win on time.
 */
export function hasMatingMaterial(chess: Chess, side: Side): boolean {
  const color = sideToColor(side);
  let minors = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== color || cell.type === 'k') continue;
      if (cell.type === 'n' || cell.type === 'b') minors++;
      else return true; // pawn, rook or queen
    }
  }
  return minors >= 2;
}

export function kingSquare(chess: Chess, side: Side): Square {
  return chess.findPiece({ type: 'k', color: sideToColor(side) })[0] as Square;
}

export const turnOf = (chess: Chess): Side => colorToSide(chess.turn());
