import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame, playSan, recordEvents } from './testUtils';

const timed = (initialMs: number, incrementMs = 0) => ({ time: { initialMs, incrementMs } });
const deps = { now: () => Date.now() };

describe('clocks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start after the first move, tick ~10 times a second, and add increment', () => {
    const g = makeGame(timed(180_000, 2_000), deps);
    const log = recordEvents(g);
    vi.advanceTimersByTime(1000);
    expect(log.filter((e) => e.name === 'clock')).toHaveLength(0); // nothing runs before the first move

    playSan(g, ['e4']); // Land's first move is free; Sea's clock starts
    log.length = 0;
    vi.advanceTimersByTime(1000);
    const ticks = log.filter((e) => e.name === 'clock').map((e) => e.payload as { seaMs: number; running: string });
    expect(ticks.length).toBeGreaterThanOrEqual(9);
    expect(ticks.at(-1)).toMatchObject({ seaMs: 179_000, running: 'sea' });

    playSan(g, ['e5']);
    const last = log.filter((e) => e.name === 'clock').at(-1)!.payload;
    expect(last).toEqual({ landMs: 180_000, seaMs: 181_000, running: 'land' });
  });

  it('timeout: the side with time left wins', () => {
    const g = makeGame({ ...timed(1000), fen: '4k3/8/8/8/8/8/q7/4K2N w - - 0 1' }, deps);
    playSan(g, ['Ng3', 'Qa1+']);
    vi.advanceTimersByTime(1200);
    expect(g.isOver()).toEqual({ winner: 'sea', reason: 'timeout' });
  });

  it('timeout is a draw when the winner cannot mate (lone knight)', () => {
    const g = makeGame({ ...timed(1000), fen: '4k3/8/8/8/8/8/q7/4K2N w - - 0 1' }, deps);
    playSan(g, ['Ng3']);
    vi.advanceTimersByTime(1200);
    expect(g.isOver()).toEqual({ winner: null, reason: 'timeout' });
  });

  it('a move made after the flag fell is refused', () => {
    const g = makeGame(timed(1000), deps);
    playSan(g, ['e4']);
    vi.setSystemTime(Date.now() + 5000); // time passes without the ticker running
    expect(g.move({ from: 'e7', to: 'e5' })).toBeNull();
    expect(g.isOver()).toEqual({ winner: 'land', reason: 'timeout' });
  });

  it('pause freezes the clock; resume continues', () => {
    const g = makeGame(timed(60_000), deps);
    const log = recordEvents(g);
    playSan(g, ['e4']);
    vi.advanceTimersByTime(500);
    g.pause();
    expect(log.at(-1)!.payload).toMatchObject({ seaMs: 59_500, running: null });
    vi.advanceTimersByTime(10_000);
    g.resume();
    vi.advanceTimersByTime(500);
    expect(log.filter((e) => e.name === 'clock').at(-1)!.payload).toMatchObject({ seaMs: 59_000, running: 'sea' });
  });

  it('undo restores the clocks to before the move', () => {
    const g = makeGame(timed(60_000, 1_000), deps);
    playSan(g, ['e4']);
    vi.advanceTimersByTime(2000);
    playSan(g, ['e5']);
    const log = recordEvents(g);
    g.undo();
    expect(log.find((e) => e.name === 'clock')!.payload).toMatchObject({ landMs: 60_000, seaMs: 58_000, running: 'sea' });
  });

  it('untimed games report null clocks and no ticking', () => {
    const g = makeGame({}, deps);
    const log = recordEvents(g);
    playSan(g, ['e4']);
    vi.advanceTimersByTime(3000);
    const clocks = log.filter((e) => e.name === 'clock');
    expect(clocks).toHaveLength(1);
    expect(clocks[0].payload).toEqual({ landMs: null, seaMs: null, running: null });
  });
});
