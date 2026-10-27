/**
 * A tiny animator that runs on the world's own clock, so pausing the world pauses every
 * world animation (camera moves, highlights, weird events) with it.
 */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  cubicIn: (t: number) => t * t * t,
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  quintInOut: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  backOut: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elasticOut: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
} satisfies Record<string, Ease>;

/** A running process. Return true when finished. */
export type Process = (dt: number, elapsed: number) => boolean | void;

export interface Handle {
  /** Resolves when the process finishes or is cancelled. */
  readonly done: Promise<void>;
  /** Stop now. If `finish`, the tween jumps to its end state first. */
  cancel(finish?: boolean): void;
  readonly running: boolean;
}

interface Task {
  step: Process;
  finish?: () => void;
  resolve: () => void;
  alive: boolean;
}

export class Animator {
  private tasks = new Set<Task>();
  private time = 0;

  get elapsed(): number {
    return this.time;
  }

  /** Run a process every frame until it returns true. */
  process(step: Process, finish?: () => void): Handle {
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const task: Task = { step, finish, resolve, alive: true };
    this.tasks.add(task);
    return {
      done,
      get running() {
        return task.alive;
      },
      cancel: (fin = false) => {
        if (!task.alive) return;
        if (fin) task.finish?.();
        this.end(task);
      },
    };
  }

  /** Tween 0 -> 1 over `duration` seconds. `onUpdate` gets the eased value. */
  tween(duration: number, onUpdate: (v: number, raw: number) => void, easing: Ease = ease.cubicInOut, delay = 0): Handle {
    let t = -delay;
    const d = Math.max(duration, 1e-4);
    return this.process(
      (dt) => {
        t += dt;
        if (t < 0) return false;
        const raw = Math.min(t / d, 1);
        onUpdate(easing(raw), raw);
        return raw >= 1;
      },
      () => onUpdate(easing(1), 1),
    );
  }

  /** Resolve after `seconds` of world time. */
  wait(seconds: number): Promise<void> {
    let t = 0;
    return this.process((dt) => (t += dt) >= seconds).done;
  }

  update(dt: number): void {
    this.time += dt;
    for (const task of [...this.tasks]) {
      if (!task.alive) continue;
      if (task.step(dt, this.time)) this.end(task);
    }
  }

  /** Finish everything at once (used by dispose). */
  clear(): void {
    for (const task of [...this.tasks]) this.end(task);
  }

  get size(): number {
    return this.tasks.size;
  }

  private end(task: Task) {
    task.alive = false;
    this.tasks.delete(task);
    task.resolve();
  }
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent smoothing toward a target. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));
