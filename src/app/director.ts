/**
 * Plays game moments one after another (move animations, check banners, the result),
 * so the board, HUD and camera never get ahead of each other.
 */
type Task = () => Promise<unknown> | unknown;

export class Director {
  private queue: Task[] = [];
  private running = false;
  private gen = 0;

  constructor(private hooks: { busy: () => void; idle: () => void }) {}

  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  push(task: Task): void {
    this.queue.push(task);
    if (!this.running) void this.run();
  }

  /** Drop everything still queued (undo, new game). The current task is left to finish on its own. */
  cancel(): void {
    this.gen++;
    this.queue = [];
    if (this.running) {
      this.running = false;
      this.hooks.idle();
    }
  }

  private async run(): Promise<void> {
    const gen = this.gen;
    this.running = true;
    this.hooks.busy();
    while (this.queue.length) {
      const task = this.queue.shift()!;
      try {
        await task();
      } catch (err) {
        console.error('[app] game moment failed', err);
      }
      if (gen !== this.gen) return; // cancelled while we waited
    }
    this.running = false;
    this.hooks.idle();
  }
}
