/** Two-sided chess clock with Fischer increment. Time comes from an injectable `now()` (ms). */
import type { Side, TimeControl } from '../contracts/types';

export interface ClockSnapshot {
  land: number | null;
  sea: number | null;
}

export class ChessClock {
  private ms: Record<Side, number | null> = { land: null, sea: null };
  private runningSide: Side | null = null;
  private paused = false;
  private since = 0;
  private tc: TimeControl = { initialMs: null, incrementMs: 0 };

  constructor(private now: () => number) {}

  reset(tc: TimeControl): void {
    this.tc = tc;
    this.ms = { land: tc.initialMs, sea: tc.initialMs };
    this.runningSide = null;
    this.paused = false;
    this.since = this.now();
  }

  get timed(): boolean {
    return this.tc.initialMs !== null;
  }

  /** The side whose time is going down right now (null if stopped, paused or untimed). */
  get ticking(): Side | null {
    return this.timed && !this.paused ? this.runningSide : null;
  }

  get running(): Side | null {
    return this.runningSide;
  }

  remaining(side: Side): number | null {
    this.settle();
    const v = this.ms[side];
    return v === null ? null : Math.max(0, v);
  }

  /** Called after `mover` completes a move. Adds increment (if their clock was running) and starts the opponent. */
  pressAfterMove(mover: Side, next: Side | null): void {
    this.settle();
    const v = this.ms[mover];
    if (v !== null && this.runningSide === mover) this.ms[mover] = v + this.tc.incrementMs;
    this.runningSide = next;
    this.since = this.now();
  }

  stop(): void {
    this.settle();
    this.runningSide = null;
  }

  setPaused(paused: boolean): void {
    this.settle();
    this.paused = paused;
    this.since = this.now();
  }

  /** Side whose flag has fallen, if any. */
  flagged(): Side | null {
    const s = this.runningSide;
    if (!s || !this.timed) return null;
    return (this.remaining(s) ?? 1) <= 0 ? s : null;
  }

  snapshot(): ClockSnapshot & { running: Side | null } {
    this.settle();
    return { land: this.ms.land, sea: this.ms.sea, running: this.runningSide };
  }

  restore(s: ClockSnapshot & { running: Side | null }): void {
    this.ms = { land: s.land, sea: s.sea };
    this.runningSide = s.running;
    this.since = this.now();
  }

  private settle(): void {
    const t = this.now();
    const s = this.runningSide;
    if (s && !this.paused) {
      const v = this.ms[s];
      if (v !== null) this.ms[s] = v - (t - this.since);
    }
    this.since = t;
  }
}
