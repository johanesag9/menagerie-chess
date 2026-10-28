/**
 * Determinism: for each mode, 100 seeded games of random legal inputs played through the room, with timeouts
 * (the room's own auto inputs) and hibernation wake-ups mixed in. At the end:
 * - both mirrors and the room's core show the same game, and
 * - a core rebuilt from the stored inputs gives the same state and the same events as the live mirror.
 * A failure here is a core bug (some hidden randomness or a read that changes state): report it to core.
 */
import { describe, expect, it } from 'vitest';
import type { NetInput } from '../../src/contracts/net';
import type { PlayMode, Side } from '../../src/contracts/types';
import { seeded } from '../../src/core/testUtils';
import { Match } from '../src/logic/match';
import { Harness, randomInput, type Socket } from './harness';

const GAMES = 100;
const CHUNK = 10;
/** Inputs per game before one side resigns. Classic is shorter: chess.js re-checks threefold over the whole history on every move. */
const MAX_INPUTS = (mode: PlayMode) => (mode === 'classic' ? 150 : 300);

function playOne(mode: PlayMode, seed: number): { inputs: number; autos: number; wakes: number } {
  const rnd = seeded(seed * 31 + 7);
  const h = new Harness(seed);
  const [a, b] = h.pair(mode, rnd() < 0.5 ? 'land' : 'sea', true);
  const bySide = (side: Side): Socket => (a.you === side ? a : b);
  let wakes = 0;
  for (let n = 0; n < MAX_INPUTS(mode) && a.mirror!.need(); n++) {
    const roll = rnd();
    if (roll < 0.03) {
      h.advance(70_000); // nobody moved: the room plays for the slow side
      continue;
    }
    if (roll < 0.04) {
      h.wake();
      wakes++;
    }
    const pick = randomInput(a.mirror!, rnd);
    if (!pick) throw new Error(`no legal input but the game is on (${mode}, seed ${seed})`);
    for (const input of ([] as NetInput[]).concat(pick)) bySide(input.side).input(input, n);
  }
  if (a.mirror!.need()) a.input({ k: 'resign', side: a.you! });

  const where = `${mode} seed ${seed}`;
  expect(a.of('reject'), `rejects in ${where}`).toEqual([]);
  expect(b.of('reject'), `rejects in ${where}`).toEqual([]);
  expect(a.mirror!.over(), `over in ${where}`).not.toBeNull();
  expect(h.room.state!.status).toBe('over');
  const live = a.mirror!.fingerprint();
  expect(b.mirror!.fingerprint(), `mirrors agree in ${where}`).toBe(live);
  expect(h.room.currentMatch!.fingerprint(), `room agrees in ${where}`).toBe(live);

  const stored = h.store.loadInputs();
  expect(stored.length).toBe(a.have);
  const rebuilt = Match.replay(a.mirror!.options, stored.map((s) => s.input), { record: true });
  expect(rebuilt.fingerprint(), `rebuilt state in ${where}`).toBe(live);
  expect(rebuilt.events.length, `rebuilt event count in ${where}`).toBe(a.mirror!.events.length);
  for (let k = 0; k < rebuilt.events.length; k++) {
    if (rebuilt.events[k] !== a.mirror!.events[k]) expect(rebuilt.events[k], `event ${k} in ${where}`).toBe(a.mirror!.events[k]);
  }
  return { inputs: stored.length, autos: stored.filter((s) => s.auto).length, wakes };
}

/** One test file per mode (Classic: two; they run in parallel), in chunks so no single test blocks the worker for long. */
export function determinismSuite(mode: PlayMode, first = 1, last = GAMES): void {
  describe(`determinism (${mode}, games ${first}-${last}): replaying the stored inputs matches the live game`, () => {
    const games = last - first + 1;
    const totals = { inputs: 0, autos: 0, wakes: 0 };
    for (let from = first; from <= last; from += CHUNK) {
      it(`games ${from}-${from + CHUNK - 1}`, { timeout: 120_000 }, async () => {
        for (let g = from; g < from + CHUNK; g++) {
          const r = playOne(mode, g);
          totals.inputs += r.inputs;
          totals.autos += r.autos;
          totals.wakes += r.wakes;
          await new Promise((r) => setTimeout(r, 0)); // let vitest talk to its worker
        }
      });
    }
    it('the mix really happened: plenty of inputs, some made by the room, some wake-ups', () => {
      expect(totals.inputs).toBeGreaterThan(games * 10);
      expect(totals.autos).toBeGreaterThan(0);
      expect(totals.wakes).toBeGreaterThan(0);
    });
  });
}
