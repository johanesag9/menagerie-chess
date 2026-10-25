import type { AudioCue, EmoteKind, PieceKind, Side } from '../contracts/types';
import { midi, noise, tone, voice, type Out } from './synth';

/** One synthesized sound. `t` is the AudioContext start time. */
export type CueFn = (o: Out, t: number) => void;

// ---------- UI ----------

const ui: Record<'uiHover' | 'uiClick' | 'uiBack', CueFn> = {
  uiHover: (o, t) => {
    tone(o, { t, dur: 0.05, f: 1500, f2: 1700, gain: 0.05, type: 'sine' });
  },
  uiClick: (o, t) => {
    tone(o, { t, dur: 0.08, f: 700, f2: 520, gain: 0.22, type: 'triangle' });
    noise(o, { t, dur: 0.025, f: 3500, type: 'highpass', gain: 0.06 });
  },
  uiBack: (o, t) => {
    tone(o, { t, dur: 0.1, f: 560, f2: 360, gain: 0.2, type: 'triangle' });
    tone(o, { t: t + 0.05, dur: 0.1, f: 420, f2: 300, gain: 0.12, type: 'triangle' });
  },
};

// ---------- Board ----------

const board: Record<'select' | 'deselect' | 'illegal' | 'moveLand' | 'moveSea' | 'capture' | 'castle' | 'promote', CueFn> = {
  select: (o, t) => {
    tone(o, { t, dur: 0.14, f: 500, f2: 820, gain: 0.3 });
    tone(o, { t, dur: 0.1, f: 1000, f2: 1640, gain: 0.05 });
  },
  deselect: (o, t) => {
    tone(o, { t, dur: 0.14, f: 760, f2: 430, gain: 0.26 });
  },
  illegal: (o, t) => {
    for (const dt of [0, 0.11]) tone(o, { t: t + dt, dur: 0.08, f: 190, type: 'square', gain: 0.12, filter: { type: 'lowpass', f: 900 } });
  },
  // Soft paw steps then a wooden "tok" as the pedestal lands.
  moveLand: (o, t) => {
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.12;
      tone(o, { t: s, dur: 0.09, f: 150 - i * 10, f2: 70, gain: 0.32 });
      noise(o, { t: s, dur: 0.05, f: 500, type: 'lowpass', gain: 0.12 });
    }
    tone(o, { t: t + 0.38, dur: 0.08, f: 880, f2: 620, type: 'triangle', gain: 0.18 });
    tone(o, { t: t + 0.38, dur: 0.12, f: 180, f2: 90, gain: 0.3 });
  },
  // A small splash and two bubbles.
  moveSea: (o, t) => {
    noise(o, { t, dur: 0.38, f: 1400, f2: 380, q: 0.9, gain: 0.26, attack: 0.02 });
    tone(o, { t: t + 0.12, dur: 0.09, f: 520, f2: 900, gain: 0.14 });
    tone(o, { t: t + 0.24, dur: 0.08, f: 700, f2: 1200, gain: 0.1 });
    tone(o, { t: t + 0.36, dur: 0.1, f: 200, f2: 110, gain: 0.22 });
  },
  // Cartoon bonk with a springy boing.
  capture: (o, t) => {
    tone(o, { t, dur: 0.28, f: 340, f2: 85, gain: 0.55 });
    tone(o, { t, dur: 0.07, f: 1300, f2: 320, type: 'triangle', gain: 0.22 });
    noise(o, { t, dur: 0.05, f: 2500, type: 'highpass', gain: 0.18 });
    tone(o, { t: t + 0.09, dur: 0.45, f: 260, f2: 620, gain: 0.16, vib: [17, 45] });
  },
  castle: (o, t) => {
    tone(o, { t, dur: 0.07, f: 900, f2: 640, type: 'triangle', gain: 0.2 });
    tone(o, { t: t + 0.1, dur: 0.07, f: 860, f2: 600, type: 'triangle', gain: 0.2 });
    [72, 76, 79].forEach((n, i) => tone(o, { t: t + 0.22 + i * 0.07, dur: 0.35, f: midi(n), type: 'triangle', gain: 0.16 }));
  },
  promote: (o, t) => {
    [84, 88, 91, 96].forEach((n, i) => tone(o, { t: t + i * 0.065, dur: 0.4, f: midi(n), type: 'sine', gain: 0.17 }));
    noise(o, { t, dur: 0.6, f: 7000, type: 'highpass', gain: 0.05, attack: 0.1 });
    tone(o, { t, dur: 0.5, f: 300, f2: 900, gain: 0.1 });
  },
};

// ---------- Game moments ----------

/** Soft synth brass: two detuned saws through a low-pass. */
function brass(o: Out, t: number, n: number, dur: number, gain = 0.14) {
  for (const det of [-4, 4]) {
    tone(o, { t, dur, f: midi(n) * Math.pow(2, det / 1200), type: 'sawtooth', gain, attack: 0.03, hold: 0.5, filter: { type: 'lowpass', f: 2200, q: 0.7 } });
  }
}

const moments: Record<'check' | 'checkmate' | 'draw' | 'gameStart' | 'clockLow' | 'weird', CueFn> = {
  check: (o, t) => {
    brass(o, t, 79, 0.12, 0.16);
    brass(o, t + 0.13, 84, 0.4, 0.18);
    tone(o, { t, dur: 0.5, f: midi(96), gain: 0.06 });
  },
  checkmate: (o, t) => {
    [72, 76, 79].forEach((n, i) => brass(o, t + i * 0.13, n, 0.16, 0.15));
    brass(o, t + 0.39, 84, 1.0, 0.17);
    brass(o, t + 0.39, 79, 1.0, 0.1);
    brass(o, t + 0.39, 76, 1.0, 0.1);
    tone(o, { t: t + 0.39, dur: 0.8, f: 95, f2: 48, gain: 0.5 }); // timpani
    noise(o, { t: t + 0.39, dur: 0.3, f: 220, type: 'lowpass', gain: 0.2 });
    [96, 100, 103].forEach((n, i) => tone(o, { t: t + 0.6 + i * 0.08, dur: 0.6, f: midi(n), gain: 0.05 }));
  },
  // A friendly "oh well" shrug, then a warm chord.
  draw: (o, t) => {
    tone(o, { t, dur: 0.25, f: midi(76), f2: midi(74), type: 'triangle', gain: 0.18 });
    tone(o, { t: t + 0.26, dur: 0.35, f: midi(74), f2: midi(71), type: 'triangle', gain: 0.18 });
    [60, 64, 67, 72].forEach((n) => tone(o, { t: t + 0.6, dur: 1.0, f: midi(n), type: 'triangle', gain: 0.09, attack: 0.08, hold: 0.3 }));
  },
  gameStart: (o, t) => {
    [67, 72, 76, 79].forEach((n, i) => tone(o, { t: t + i * 0.08, dur: 0.22, f: midi(n), type: 'triangle', gain: 0.18 }));
    tone(o, { t: t + 0.34, dur: 1.1, f: midi(91), gain: 0.12 }); // bell
    tone(o, { t: t + 0.34, dur: 0.7, f: midi(91) * 2.76, gain: 0.03 });
  },
  clockLow: (o, t) => {
    noise(o, { t, dur: 0.03, f: 4200, type: 'highpass', gain: 0.18 });
    tone(o, { t, dur: 0.04, f: 1900, type: 'square', gain: 0.05, filter: { type: 'bandpass', f: 1900, q: 3 } });
  },
  // Whoosh plus a wobbly theremin slide.
  weird: (o, t) => {
    noise(o, { t, dur: 0.9, f: 300, f2: 3200, f3: 260, q: 3.5, gain: 0.3, attack: 0.15 });
    tone(o, { t: t + 0.05, dur: 1.0, f: 980, f2: 260, gain: 0.12, vib: [6, 60], attack: 0.1 });
  },
};

// ---------- Animal voices (side x kind) ----------

const voices: Record<Side, Record<PieceKind, CueFn>> = {
  land: {
    // Dachshund: two quick yips.
    p: (o, t) => {
      for (const dt of [0, 0.15]) voice(o, { t: t + dt, dur: 0.11, f: 820, f2: 1250, f3: 700, formants: [1300, 2700], gain: 0.9 });
    },
    // Horse: a whinnying neigh that falls.
    n: (o, t) => voice(o, { t, dur: 0.75, f: 900, f2: 760, f3: 380, formants: [900, 2300], vib: [13, 110], gain: 0.85 }),
    // Goat: "meh-eh-eh".
    b: (o, t) => voice(o, { t, dur: 0.5, f: 430, f2: 440, f3: 380, formants: [650, 1900], vib: [9, 40], gain: 0.95 }),
    // Elephant: a trumpet blast.
    r: (o, t) => {
      voice(o, { t, dur: 0.6, f: 320, f2: 560, f3: 430, formants: [850, 1750, 3000], vib: [7, 12], gain: 1.1, attack: 0.04 });
      noise(o, { t, dur: 0.5, f: 1200, gain: 0.08, attack: 0.05 });
    },
    // Cat: "mi-aow".
    q: (o, t) => voice(o, { t, dur: 0.55, f: 520, f2: 780, f3: 470, formants: [950, 2500], vib: [6, 10], gain: 0.85 }),
    // Pug: snort-snort grunt.
    k: (o, t) => {
      noise(o, { t, dur: 0.13, f: 550, type: 'lowpass', gain: 0.4, attack: 0.01 });
      noise(o, { t: t + 0.17, dur: 0.13, f: 520, type: 'lowpass', gain: 0.35, attack: 0.01 });
      voice(o, { t: t + 0.32, dur: 0.28, f: 170, f2: 120, formants: [400, 950], gain: 1.0 });
    },
  },
  sea: {
    // Crab: claw clicks.
    p: (o, t) => {
      for (let i = 0; i < 4; i++) {
        noise(o, { t: t + i * 0.06, dur: 0.02, f: 2800, type: 'highpass', gain: 0.3 });
        tone(o, { t: t + i * 0.06, dur: 0.025, f: 2100 + (i % 2) * 300, type: 'square', gain: 0.04 });
      }
    },
    // Seahorse: a bubbly little whistle.
    n: (o, t) => tone(o, { t, dur: 0.38, f: 1150, f2: 1750, gain: 0.18, vib: [21, 70], attack: 0.02 }),
    // Pufferfish: inflates, then pops.
    b: (o, t) => {
      tone(o, { t, dur: 0.4, f: 180, f2: 950, gain: 0.25, attack: 0.03 });
      noise(o, { t: t + 0.4, dur: 0.04, f: 2000, type: 'highpass', gain: 0.3 });
    },
    // Sea turtle: slow, low hum.
    r: (o, t) => voice(o, { t, dur: 0.7, f: 115, f2: 100, f3: 92, formants: [320, 720], vib: [5, 4], gain: 1.2, attack: 0.08 }),
    // Octopus: a squelchy wobble.
    q: (o, t) => {
      tone(o, { t, dur: 0.55, f: 320, f2: 240, gain: 0.22, vib: [12, 140] });
      noise(o, { t, dur: 0.45, f: 700, f2: 300, q: 2, gain: 0.12 });
    },
    // Blobfish: "blub... blub".
    k: (o, t) => {
      for (const dt of [0, 0.24]) tone(o, { t: t + dt, dur: 0.2, f: 240, f2: 130, gain: 0.32, filter: { type: 'lowpass', f: 600 } });
      tone(o, { t: t + 0.5, dur: 0.07, f: 700, f2: 1100, gain: 0.08 });
    },
  },
};

// ---------- Emotes ----------

const emotes: Record<EmoteKind, CueFn> = {
  laugh: (o, t) => {
    [560, 520, 480, 450].forEach((f, i) => voice(o, { t: t + i * 0.13, dur: 0.1, f, f2: f * 0.92, formants: [800, 1700], gain: 0.85 }));
  },
  angry: (o, t) => {
    tone(o, { t, dur: 0.55, f: 115, f2: 95, type: 'sawtooth', gain: 0.22, vib: [28, 12], filter: { type: 'lowpass', f: 650 } });
    noise(o, { t, dur: 0.5, f: 180, type: 'lowpass', gain: 0.18 });
  },
  love: (o, t) => {
    tone(o, { t, dur: 0.35, f: midi(81), gain: 0.15 });
    tone(o, { t: t + 0.14, dur: 0.6, f: midi(88), gain: 0.15 });
    voice(o, { t: t + 0.05, dur: 0.6, f: 620, f2: 560, f3: 470, formants: [700, 1100], gain: 0.6, attack: 0.08 });
  },
  shock: (o, t) => {
    voice(o, { t, dur: 0.22, f: 480, f2: 900, formants: [700, 1100], gain: 0.85 });
    tone(o, { t: t + 0.05, dur: 0.35, f: 600, f2: 1900, gain: 0.12 });
  },
  sleepy: (o, t) => {
    voice(o, { t, dur: 0.85, f: 420, f2: 360, f3: 190, formants: [750, 1150], gain: 0.7, attack: 0.12 });
    noise(o, { t: t + 0.95, dur: 0.45, f: 320, type: 'lowpass', gain: 0.22, attack: 0.15 });
  },
  // "Na-na na-na naa".
  taunt: (o, t) => {
    [79, 76, 81, 79, 76].forEach((n, i) => voice(o, { t: t + i * 0.13, dur: 0.12, f: midi(n - 12), formants: [900, 1600], gain: 0.7 }));
  },
};

const table: Record<string, CueFn> = { ...ui, ...board, ...moments };
for (const side of ['land', 'sea'] as const) {
  for (const kind of Object.keys(voices[side]) as PieceKind[]) table[`voice:${side}:${kind}`] = voices[side][kind];
}
for (const e of Object.keys(emotes) as EmoteKind[]) table[`emote:${e}`] = emotes[e];

export function cueFn(cue: AudioCue): CueFn | undefined {
  return table[cue];
}

/** Every cue the engine knows, in a stable order (the demo's sound board uses this). */
export const ALL_CUES = Object.keys(table) as AudioCue[];
