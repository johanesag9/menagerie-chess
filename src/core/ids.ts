/**
 * Stable piece ids. Every piece keeps one id for the whole game:
 *   side-kind-startSquare            e.g. "land-n-g1"
 *   side-kind-square-promo<N>        for promoted pieces, e.g. "land-q-e8-promo1"
 * With a custom FEN, "startSquare" is the square the piece stood on when the game started.
 */
import type { Chess, Move } from 'chess.js';
import type { PieceId, PieceKind, PieceState, Side, Square } from '../contracts/types';
import { colorToSide } from '../contracts/types';

export interface TrackerSnapshot {
  bySquare: [Square, PieceId][];
  promoCount: number;
}

export interface TrackedMove {
  pieceId: PieceId;
  captured?: PieceState;
  rookMove?: { pieceId: PieceId; from: Square; to: Square };
  /** New id when a pawn promotes (the pawn's id is retired). */
  promotedId?: PieceId;
}

export const opposite = (s: Side): Side => (s === 'land' ? 'sea' : 'land');

export class PieceTracker {
  private bySquare = new Map<Square, PieceId>();
  private promoCount = 0;

  /** Assign fresh ids from the board as it stands now. */
  reset(chess: Chess): void {
    this.bySquare.clear();
    this.promoCount = 0;
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        const sq = cell.square as Square;
        this.bySquare.set(sq, `${colorToSide(cell.color)}-${cell.type}-${sq}`);
      }
    }
  }

  idAt(square: Square): PieceId | undefined {
    return this.bySquare.get(square);
  }

  /** Update ids for a move that chess.js has just made. */
  apply(m: Move): TrackedMove {
    const side = colorToSide(m.color);
    const from = m.from as Square;
    const to = m.to as Square;
    const pieceId = this.require(from);
    const out: TrackedMove = { pieceId };

    if (m.captured) {
      // En passant: the taken pawn sits beside the mover, on the mover's start rank.
      const capSq = (m.isEnPassant() ? `${to[0]}${from[1]}` : to) as Square;
      out.captured = { id: this.require(capSq), side: opposite(side), kind: m.captured as PieceKind, square: capSq };
      this.bySquare.delete(capSq);
    }

    this.bySquare.delete(from);
    this.bySquare.set(to, pieceId);

    if (m.isKingsideCastle() || m.isQueensideCastle()) {
      const rank = from[1];
      const kingside = m.isKingsideCastle();
      const rFrom = `${kingside ? 'h' : 'a'}${rank}` as Square;
      const rTo = `${kingside ? 'f' : 'd'}${rank}` as Square;
      const rookId = this.require(rFrom);
      this.bySquare.delete(rFrom);
      this.bySquare.set(rTo, rookId);
      out.rookMove = { pieceId: rookId, from: rFrom, to: rTo };
    }

    if (m.promotion) {
      const promotedId = `${side}-${m.promotion}-${to}-promo${++this.promoCount}`;
      this.bySquare.set(to, promotedId);
      out.promotedId = promotedId;
    }
    return out;
  }

  pieces(chess: Chess): PieceState[] {
    const out: PieceState[] = [];
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        const sq = cell.square as Square;
        out.push({ id: this.require(sq), side: colorToSide(cell.color), kind: cell.type, square: sq });
      }
    }
    return out;
  }

  snapshot(): TrackerSnapshot {
    return { bySquare: [...this.bySquare], promoCount: this.promoCount };
  }

  restore(s: TrackerSnapshot): void {
    this.bySquare = new Map(s.bySquare);
    this.promoCount = s.promoCount;
  }

  private require(sq: Square): PieceId {
    const id = this.bySquare.get(sq);
    if (!id) throw new Error(`core: no piece id tracked on ${sq} (tracker out of sync)`);
    return id;
  }
}
