/**
 * Phase 6 cues: the board-game modes (Sandcastle King, Stepping Stones). Synthesized like every other cue.
 * cues.ts merges these into the cue table.
 */
import type { CueFn } from './cues';
import { midi, noise, tone, type Out } from './synth';

/** A short bright horn note (two detuned saws through a lowpass). */
function horn(o: Out, t: number, n: number, dur: number, gain = 0.12) {
  for (const det of [-5, 5]) {
    tone(o, { t, dur, f: midi(n) * Math.pow(2, det / 1200), type: 'sawtooth', gain, attack: 0.02, hold: 0.45, filter: { type: 'lowpass', f: 2600, q: 0.7 } });
  }
}

/** One soft hand-pat on damp sand. */
function pat(o: Out, t: number, f: number, gain: number) {
  tone(o, { t, dur: 0.1, f, f2: f * 0.5, gain });
  noise(o, { t, dur: 0.07, f: 700, f2: 300, type: 'lowpass', gain: gain * 0.5 });
}

export const BOARD_CUES: Record<'build' | 'dig' | 'raise' | 'sinkStone' | 'climb' | 'flag' | 'tideWear' | 'draftPick', CueFn> = {
  // Sandcastle building: a pat-pat of damp sand, then a little puff of grains.
  build: (o, t) => {
    pat(o, t, 190, 0.42);
    pat(o, t + 0.13, 170, 0.36);
    noise(o, { t: t + 0.15, dur: 0.22, f: 2400, f2: 4800, q: 0.9, gain: 0.07, attack: 0.02 });
  },
  // A scoop: a scrape through the sand, then grains tossed aside.
  dig: (o, t) => {
    noise(o, { t, dur: 0.2, f: 600, f2: 1800, q: 1.8, gain: 0.32, attack: 0.02 });
    tone(o, { t, dur: 0.12, f: 140, f2: 90, gain: 0.25 });
    [0.2, 0.25, 0.31, 0.36].forEach((dt, i) => noise(o, { t: t + dt, dur: 0.035, f: 3000 + i * 500, q: 3, gain: 0.08 }));
  },
  // A stone rises out of the sea: a heave from below, water pouring off, a few drips.
  raise: (o, t) => {
    tone(o, { t, dur: 0.5, f: 70, f2: 150, gain: 0.42, attack: 0.08 });
    noise(o, { t, dur: 0.6, f: 400, f2: 2200, f3: 700, q: 0.7, gain: 0.3, attack: 0.12 });
    noise(o, { t: t + 0.3, dur: 0.45, f: 5000, type: 'highpass', gain: 0.06, attack: 0.05 });
    [0.48, 0.6, 0.7].forEach((dt, i) => tone(o, { t: t + dt, dur: 0.06, f: 900 + i * 240, f2: 1500 + i * 300, gain: 0.08 }));
  },
  // A square goes under: glug glug glug, then one deep plop.
  sinkStone: (o, t) => {
    [0, 0.11, 0.2].forEach((dt, i) => tone(o, { t: t + dt, dur: 0.1, f: 420 - i * 70, f2: 230 - i * 40, gain: 0.26 - i * 0.04 }));
    tone(o, { t: t + 0.28, dur: 0.3, f: 160, f2: 60, gain: 0.42 });
    noise(o, { t: t + 0.28, dur: 0.35, f: 900, f2: 300, q: 0.8, gain: 0.16 });
  },
  // Hop up a tier: a springy rise and a soft landing.
  climb: (o, t) => {
    tone(o, { t, dur: 0.16, f: 300, f2: 760, type: 'triangle', gain: 0.2 });
    tone(o, { t, dur: 0.12, f: 180, f2: 120, gain: 0.2 });
    pat(o, t + 0.18, 220, 0.3);
  },
  // A flag pops up on the castle: ta-ta-taaa, with a flutter.
  flag: (o, t) => {
    horn(o, t, 72, 0.09);
    horn(o, t + 0.1, 76, 0.09);
    horn(o, t + 0.2, 79, 0.5, 0.13);
    tone(o, { t: t + 0.2, dur: 0.5, f: midi(84), type: 'triangle', gain: 0.06 });
    noise(o, { t: t + 0.18, dur: 0.45, f: 1400, q: 2, gain: 0.07, attack: 0.03 });
    tone(o, { t: t + 0.2, dur: 0.18, f: 130, f2: 80, gain: 0.25 });
  },
  // The tide washes over the beach: a long swell in, and a hiss as it draws back.
  tideWear: (o, t) => {
    noise(o, { t, dur: 1.4, f: 250, f2: 1600, f3: 300, q: 0.6, gain: 0.34, attack: 0.45, hold: 0.15 });
    noise(o, { t: t + 0.6, dur: 0.9, f: 6000, type: 'highpass', gain: 0.07, attack: 0.2 });
    tone(o, { t, dur: 1.2, f: 55, f2: 45, gain: 0.22, attack: 0.4 });
  },
  // Picked! A card-like slap and a bright two-note pling.
  draftPick: (o, t) => {
    noise(o, { t, dur: 0.04, f: 2600, q: 0.8, gain: 0.22 });
    tone(o, { t, dur: 0.08, f: 260, f2: 160, gain: 0.25 });
    [76, 83].forEach((n, i) => tone(o, { t: t + 0.05 + i * 0.07, dur: 0.28, f: midi(n), type: 'triangle', gain: 0.14 }));
  },
};

/** Level trims for these cues (from the ui demo's level check), aiming at the targets in cues.ts TRIM: board actions about -20 dBFS, the flag a small fanfare. */
export const BOARD_TRIM: Partial<Record<keyof typeof BOARD_CUES, number>> = {
  build: 0.85,
  dig: 1.3,
  raise: 0.5,
  sinkStone: 0.6,
  climb: 1.2,
  flag: 1.15,
  draftPick: 1.3,
};
