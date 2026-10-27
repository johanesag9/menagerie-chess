/**
 * Weird Mode scheduler. Every 4–6 plies it picks a random cosmetic event.
 * It only reads the position (to pick focus squares); it never changes chess state.
 */
import type { PieceState, Side, Square, WeirdEvent, WeirdEventKind } from '../contracts/types';

export const WEIRD_KINDS: WeirdEventKind[] = ['tilt', 'fog', 'gravityHop', 'pigeonPeek', 'tideSwap', 'disco'];
export const WEIRD_MIN_PLIES = 4;
export const WEIRD_MAX_PLIES = 6;

const FILES = 'abcdefgh';

export class WeirdScheduler {
  private untilNext = 0;
  private last: WeirdEventKind | null = null;

  constructor(private random: () => number) {
    this.reset();
  }

  reset(): void {
    this.last = null;
    this.untilNext = this.gap();
  }

  /** Call once per ply played. Returns an event when one is due. `toMove` is the side about to move. */
  onPly(pieces: PieceState[], toMove: Side): WeirdEvent | null {
    if (--this.untilNext > 0) return null;
    this.untilNext = this.gap();
    const choices = WEIRD_KINDS.filter((k) => k !== this.last);
    const kind = choices[Math.floor(this.random() * choices.length)];
    this.last = kind;
    return { kind, ...this.focus(kind, pieces, toMove) };
  }

  private gap(): number {
    return WEIRD_MIN_PLIES + Math.floor(this.random() * (WEIRD_MAX_PLIES - WEIRD_MIN_PLIES + 1));
  }

  private focus(kind: WeirdEventKind, pieces: PieceState[], toMove: Side): Omit<WeirdEvent, 'kind'> {
    switch (kind) {
      case 'pigeonPeek': {
        const p = pieces[Math.floor(this.random() * pieces.length)];
        return { squares: p ? [p.square] : [], durationTurns: 1 };
      }
      case 'gravityHop':
        return { squares: pieces.map((p) => p.square), durationTurns: 1 };
      case 'fog': {
        // Haze over the three ranks farthest from the side about to move.
        const ranks = toMove === 'land' ? [6, 7, 8] : [1, 2, 3];
        return { squares: ranks.flatMap((r) => [...FILES].map((f) => `${f}${r}` as Square)), durationTurns: 2 };
      }
      case 'disco': {
        const squares = new Set<Square>();
        for (let i = 0; squares.size < 4 && i < 32; i++) {
          squares.add(`${FILES[Math.floor(this.random() * 8)]}${1 + Math.floor(this.random() * 8)}` as Square);
        }
        return { squares: [...squares], durationTurns: 1 };
      }
      case 'tilt':
      case 'tideSwap':
        return { durationTurns: 1 };
    }
  }
}
