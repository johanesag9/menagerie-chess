/**
 * Tells a tap apart from an orbit drag or a pinch. Pure logic, fed with pointer events,
 * so it is unit-tested without a browser.
 */

export interface TapPointer {
  id: number;
  x: number;
  y: number;
  type: string; // 'mouse' | 'touch' | 'pen'
  button?: number;
}

export interface TapOptions {
  /** Max travel in CSS px before it counts as a drag. */
  mouseSlop?: number;
  touchSlop?: number;
  /** Max press length in ms. */
  maxDuration?: number;
}

export class TapTracker {
  private active = new Map<number, { x: number; y: number }>();
  private start: { id: number; x: number; y: number; time: number } | null = null;
  private spoiled = false;
  private readonly mouseSlop: number;
  private readonly touchSlop: number;
  private readonly maxDuration: number;

  constructor(o: TapOptions = {}) {
    this.mouseSlop = o.mouseSlop ?? 6;
    this.touchSlop = o.touchSlop ?? 12;
    this.maxDuration = o.maxDuration ?? 700;
  }

  down(p: TapPointer, time: number): void {
    if (p.type === 'mouse' && p.button !== undefined && p.button !== 0) {
      this.spoiled = true;
      return;
    }
    this.active.set(p.id, { x: p.x, y: p.y });
    if (this.active.size === 1) {
      this.start = { id: p.id, x: p.x, y: p.y, time };
      this.spoiled = false;
    } else {
      // Second finger: this is a pinch or two-finger orbit, never a tap.
      this.spoiled = true;
    }
  }

  move(p: TapPointer): void {
    if (!this.start || this.spoiled || p.id !== this.start.id) return;
    const slop = p.type === 'mouse' ? this.mouseSlop : this.touchSlop;
    if (Math.hypot(p.x - this.start.x, p.y - this.start.y) > slop) this.spoiled = true;
  }

  /** Returns true when this release completes a tap. */
  up(p: TapPointer, time: number): boolean {
    this.move(p);
    const wasStart = this.start?.id === p.id;
    const ok = wasStart && !this.spoiled && time - this.start!.time <= this.maxDuration;
    this.active.delete(p.id);
    if (wasStart) this.start = null;
    if (this.active.size === 0) this.spoiled = false;
    return ok;
  }

  cancel(p: TapPointer): void {
    this.active.delete(p.id);
    if (this.start?.id === p.id) this.start = null;
    this.spoiled = this.active.size > 0;
  }

  /** True while the current press can still become a tap. */
  get pending(): boolean {
    return this.start !== null && !this.spoiled;
  }
}
