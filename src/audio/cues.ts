import type { AudioCue, EmoteKind, PieceKind, PowerKind, Side, WheelOutcome } from '../contracts/types';
import { BOARD_CUES } from './boardCues';
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

// ---------- Phase 3: powers ----------

const powers: Record<PowerKind, CueFn> = {
  // Quick scrabbling: digging pup or scuttling crab.
  sidestep: (o, t) => {
    for (let i = 0; i < 5; i++) noise(o, { t: t + i * 0.055, dur: 0.045, f: 1800 - i * 150, q: 2, gain: 0.3 });
    tone(o, { t: t + 0.28, dur: 0.08, f: 420, f2: 760, gain: 0.18 });
  },
  // Two springy hops.
  doubleJump: (o, t) => {
    for (const [dt, f] of [[0, 300], [0.2, 420]] as const) {
      tone(o, { t: t + dt, dur: 0.18, f, f2: f * 2.6, gain: 0.26 });
      tone(o, { t: t + dt, dur: 0.16, f: f * 2, f2: f * 5, gain: 0.05 });
    }
  },
  // Wind-up then a hollow thunk.
  headbutt: (o, t) => {
    tone(o, { t, dur: 0.22, f: 180, f2: 320, gain: 0.12, attack: 0.15 });
    tone(o, { t: t + 0.22, dur: 0.24, f: 160, f2: 55, gain: 0.6 });
    tone(o, { t: t + 0.22, dur: 0.05, f: 900, f2: 400, type: 'triangle', gain: 0.25 });
    noise(o, { t: t + 0.22, dur: 0.08, f: 900, type: 'lowpass', gain: 0.3 });
  },
  // A heavy boom with a rumble tail.
  stomp: (o, t) => {
    tone(o, { t, dur: 0.6, f: 90, f2: 32, gain: 0.8 });
    noise(o, { t, dur: 0.7, f: 260, f2: 90, type: 'lowpass', gain: 0.45 });
    noise(o, { t, dur: 0.04, f: 1800, type: 'highpass', gain: 0.15 });
  },
  // A soft "pomf" (vase tips / ink puffs), then a little tinkle.
  block: (o, t) => {
    noise(o, { t, dur: 0.3, f: 700, f2: 220, q: 0.8, gain: 0.4, attack: 0.01 });
    tone(o, { t, dur: 0.2, f: 210, f2: 90, gain: 0.35 });
    [2400, 3100, 2750].forEach((f, i) => tone(o, { t: t + 0.12 + i * 0.05, dur: 0.18, f, gain: 0.05 }));
  },
  // Zoomies: a whoosh that shoots up.
  escape: (o, t) => {
    noise(o, { t, dur: 0.45, f: 500, f2: 5000, q: 2.5, gain: 0.32, attack: 0.03 });
    tone(o, { t, dur: 0.4, f: 260, f2: 1600, gain: 0.14, vib: [24, 30] });
  },
};

// ---------- Phase 3: die, cards, duels, wheel, effects ----------

/** Short hollow knock: dice on wood, wheel pegs. */
function knock(o: Out, t: number, f: number, gain: number) {
  tone(o, { t, dur: 0.05, f, f2: f * 0.7, type: 'triangle', gain });
  noise(o, { t, dur: 0.02, f: f * 3, type: 'highpass', gain: gain * 0.6 });
}

const chaos: Record<string, CueFn> = {
  // Dice rattling in a cup, then tumbling to a stop.
  dieRoll: (o, t) => {
    let dt = 0;
    for (let i = 0; i < 9; i++) {
      knock(o, t + dt, 900 + ((i * 337) % 500), 0.2 - i * 0.012);
      dt += 0.045 + i * 0.012;
    }
  },
  // A sliding "whoop" down: uh-oh.
  dieBanana: (o, t) => {
    tone(o, { t, dur: 0.5, f: 1300, f2: 260, gain: 0.2, vib: [9, 40] });
    tone(o, { t: t + 0.5, dur: 0.18, f: 300, f2: 700, gain: 0.14 });
  },
  // A bright lucky jingle.
  dieLucky: (o, t) => {
    [76, 79, 84, 88, 91].forEach((n, i) => tone(o, { t: t + i * 0.07, dur: 0.45, f: midi(n), gain: 0.14 }));
    noise(o, { t: t + 0.2, dur: 0.5, f: 8000, type: 'highpass', gain: 0.05, attack: 0.1 });
  },
  // Card slides off the deck.
  cardDraw: (o, t) => {
    noise(o, { t, dur: 0.18, f: 1500, f2: 6000, q: 1.2, gain: 0.3, attack: 0.02 });
    knock(o, t + 0.17, 1500, 0.1);
  },
  // Card slapped down on the table.
  cardPlay: (o, t) => {
    noise(o, { t, dur: 0.12, f: 3000, f2: 900, q: 0.8, gain: 0.4 });
    tone(o, { t, dur: 0.12, f: 220, f2: 110, gain: 0.3 });
    noise(o, { t: t + 0.04, dur: 0.25, f: 800, f2: 3000, q: 2, gain: 0.08, attack: 0.05 });
  },
  // Drumroll (about 0.75s, matching the joker shake), then a cymbal and a ta-da.
  joker: (o, t) => {
    for (let i = 0; i < 24; i++) noise(o, { t: t + i * 0.031, dur: 0.05, f: 900, type: 'bandpass', q: 0.7, gain: 0.08 + i * 0.006 });
    noise(o, { t: t + 0.76, dur: 0.9, f: 6000, type: 'highpass', gain: 0.18 });
    brass(o, t + 0.76, 72, 0.12, 0.13);
    brass(o, t + 0.9, 79, 0.45, 0.15);
    brass(o, t + 0.9, 76, 0.45, 0.09);
  },
  // "En garde!": two rising stabs.
  duelCall: (o, t) => {
    brass(o, t, 67, 0.1, 0.15);
    brass(o, t + 0.12, 74, 0.28, 0.16);
    noise(o, { t: t + 0.12, dur: 0.25, f: 4000, f2: 9000, type: 'highpass', gain: 0.08 });
  },
  // Two hands slam down together.
  duelThrow: (o, t) => {
    tone(o, { t, dur: 0.16, f: 150, f2: 60, gain: 0.55 });
    noise(o, { t, dur: 0.09, f: 1800, q: 0.7, gain: 0.4 });
  },
  duelWin: (o, t) => {
    [72, 76, 84].forEach((n, i) => tone(o, { t: t + i * 0.08, dur: i === 2 ? 0.5 : 0.12, f: midi(n), type: 'triangle', gain: 0.2 }));
  },
  // Sad "wah-wah".
  duelLose: (o, t) => {
    for (const [dt, a, b] of [[0, 62, 61], [0.28, 60, 55]] as const) {
      tone(o, { t: t + dt, dur: 0.3, f: midi(a), f2: midi(b), type: 'sawtooth', gain: 0.1, vib: [6, 4], filter: { type: 'lowpass', f: 900 } });
    }
  },
  // Cartoon bonk on the head, then a dizzy boing.
  bonk: (o, t) => {
    knock(o, t, 1100, 0.35);
    tone(o, { t, dur: 0.15, f: 520, f2: 260, gain: 0.35 });
    tone(o, { t: t + 0.1, dur: 0.5, f: 380, f2: 700, gain: 0.12, vib: [14, 60] });
  },
  // One peg passing the pointer (the UI plays it for every peg).
  wheelSpin: (o, t) => knock(o, t, 1700, 0.16),
  wheelStop: (o, t) => {
    knock(o, t, 900, 0.25);
    tone(o, { t: t + 0.05, dur: 0.9, f: midi(88), gain: 0.12 });
    tone(o, { t: t + 0.05, dur: 0.6, f: midi(88) * 2.76, gain: 0.03 });
  },
  stun: (o, t) => {
    tone(o, { t, dur: 0.6, f: 1500, f2: 700, gain: 0.1, vib: [11, 120] });
    [2600, 3200].forEach((f, i) => tone(o, { t: t + 0.1 + i * 0.15, dur: 0.12, f, gain: 0.05 }));
  },
  // Ice crackles and a cold shimmer.
  freeze: (o, t) => {
    for (let i = 0; i < 6; i++) noise(o, { t: t + i * 0.04 + (i % 2) * 0.012, dur: 0.03, f: 6000, q: 1.2, gain: 0.25 }); // band-pass: a high-pass here spiked at random
    [88, 95, 100].forEach((n, i) => tone(o, { t: t + 0.08 + i * 0.05, dur: 0.6, f: midi(n), gain: 0.06, vib: [7, 8] }));
  },
  block: (o, t) => {
    tone(o, { t, dur: 0.2, f: 140, f2: 70, gain: 0.45 });
    noise(o, { t, dur: 0.12, f: 500, type: 'lowpass', gain: 0.3 });
  },
  // A rising shimmer: an animal comes back.
  revive: (o, t) => {
    [60, 67, 72, 76, 79, 84].forEach((n, i) => tone(o, { t: t + i * 0.06, dur: 0.4, f: midi(n), type: 'triangle', gain: 0.08 }));
    noise(o, { t, dur: 0.6, f: 300, f2: 4000, q: 1.5, gain: 0.12, attack: 0.2 });
  },
  // Banana peel: a squeaky skid.
  slip: (o, t) => {
    tone(o, { t, dur: 0.35, f: 500, f2: 1700, gain: 0.14, vib: [30, 60] });
    noise(o, { t, dur: 0.35, f: 2500, f2: 1200, q: 4, gain: 0.12 });
  },
  // Power coming back: a charge-up sweep with a ping.
  recharge: (o, t) => {
    tone(o, { t, dur: 0.35, f: 200, f2: 1200, type: 'square', gain: 0.05, filter: { type: 'lowpass', f: 2500 } });
    tone(o, { t: t + 0.33, dur: 0.4, f: midi(96), gain: 0.1 });
  },
};

// The Wheel of Chaos results (integration plays these with the world's spectacle).
const wheel: Record<WheelOutcome, CueFn> = {
  // A wave rolls in and out.
  tide: (o, t) => {
    noise(o, { t, dur: 1.5, f: 300, f2: 1600, f3: 250, type: 'lowpass', gain: 0.5, attack: 0.5, hold: 0.2 });
    noise(o, { t: t + 0.5, dur: 0.6, f: 4000, type: 'highpass', gain: 0.06, attack: 0.1 });
  },
  // Wing flaps and a "roo-coo".
  pigeon: (o, t) => {
    for (let i = 0; i < 5; i++) noise(o, { t: t + i * 0.08, dur: 0.06, f: 700, q: 0.9, gain: 0.25 });
    voice(o, { t: t + 0.45, dur: 0.22, f: 300, f2: 380, formants: [500, 900], gain: 0.7 });
    voice(o, { t: t + 0.7, dur: 0.35, f: 380, f2: 280, formants: [450, 850], gain: 0.7, vib: [8, 10] });
  },
  // A deep rumble.
  earthquake: (o, t) => {
    tone(o, { t, dur: 1.4, f: 48, f2: 38, gain: 0.5, vib: [9, 6], attack: 0.15, hold: 0.4 });
    noise(o, { t, dur: 1.4, f: 180, type: 'lowpass', gain: 0.45, attack: 0.1, hold: 0.4 });
    for (const dt of [0.3, 0.7]) knock(o, t + dt, 400, 0.12);
  },
  // A funky bar: bass, hats and a chord stab.
  disco: (o, t) => {
    const beat = 0.15;
    [36, 48, 36, 48, 39, 51, 41, 53].forEach((n, i) => tone(o, { t: t + i * beat, dur: beat * 0.9, f: midi(n), type: 'square', gain: 0.07, filter: { type: 'lowpass', f: 700 } }));
    for (let i = 0; i < 8; i++) noise(o, { t: t + i * beat + beat / 2, dur: 0.04, f: 8000, type: 'highpass', gain: 0.08 });
    [72, 76, 79].forEach((n) => tone(o, { t: t + beat * 2, dur: 0.12, f: midi(n), type: 'sawtooth', gain: 0.05, filter: { type: 'lowpass', f: 2500 } }));
    [72, 76, 79].forEach((n) => tone(o, { t: t + beat * 6, dur: 0.3, f: midi(n + 2), type: 'sawtooth', gain: 0.05, filter: { type: 'lowpass', f: 2500 } }));
  },
};

// ---------- Phase 4: party modes (Sumo, Raid) ----------

const party: Record<'step' | 'shove' | 'tag' | 'splash' | 'sinkWarn' | 'sink' | 'anchor' | 'pickup' | 'drop' | 'treasureHome' | 'score' | 'endTurn', CueFn> = {
  // One light hop: a soft pad and a puff of sand. Quieter and shorter than a chess move (a turn has several).
  step: (o, t) => {
    tone(o, { t, dur: 0.09, f: 210, f2: 95, gain: 0.32 });
    noise(o, { t, dur: 0.06, f: 900, f2: 400, q: 0.8, gain: 0.1 });
    tone(o, { t: t + 0.07, dur: 0.06, f: 640, f2: 520, type: 'triangle', gain: 0.06 });
  },
  // A heave: a body thump, then the victim skids across the board.
  shove: (o, t) => {
    tone(o, { t, dur: 0.16, f: 160, f2: 55, gain: 0.55 });
    noise(o, { t, dur: 0.06, f: 1600, q: 0.8, gain: 0.25 });
    noise(o, { t: t + 0.05, dur: 0.32, f: 1400, f2: 500, q: 2.5, gain: 0.16, attack: 0.03 });
    tone(o, { t: t + 0.05, dur: 0.3, f: 340, f2: 180, type: 'triangle', gain: 0.08, vib: [22, 25] });
  },
  // "Tag, you're it!": a quick slap and a cheeky up-chirp.
  tag: (o, t) => {
    noise(o, { t, dur: 0.04, f: 3200, q: 0.7, gain: 0.35 });
    tone(o, { t, dur: 0.06, f: 900, f2: 500, type: 'triangle', gain: 0.18 });
    tone(o, { t: t + 0.07, dur: 0.14, f: 700, f2: 1500, gain: 0.16 });
  },
  // Into the sea: a heavy plop, a spray, then bubbles rising.
  splash: (o, t) => {
    tone(o, { t, dur: 0.22, f: 260, f2: 70, gain: 0.5 });
    noise(o, { t, dur: 0.7, f: 2400, f2: 700, q: 0.6, gain: 0.4, attack: 0.01 });
    noise(o, { t: t + 0.02, dur: 0.4, f: 6000, type: 'highpass', gain: 0.08 });
    [0.28, 0.38, 0.46, 0.58].forEach((dt, i) => tone(o, { t: t + dt, dur: 0.07, f: 420 + i * 140, f2: 900 + i * 220, gain: 0.07 }));
  },
  // The ring is about to go: a slow, low wooden creak.
  sinkWarn: (o, t) => {
    tone(o, { t, dur: 0.9, f: 62, f2: 78, type: 'sawtooth', gain: 0.22, attack: 0.08, vib: [13, 9], filter: { type: 'bandpass', f: 520, q: 5 } });
    tone(o, { t: t + 0.35, dur: 0.6, f: 88, f2: 70, type: 'sawtooth', gain: 0.14, attack: 0.05, vib: [17, 7], filter: { type: 'bandpass', f: 740, q: 6 } });
    for (const dt of [0.12, 0.5, 0.78]) noise(o, { t: t + dt, dur: 0.03, f: 1800, q: 3, gain: 0.08 });
  },
  // A ring goes under: a deep rumble, then the sea rushes in.
  sink: (o, t) => {
    tone(o, { t, dur: 1.5, f: 46, f2: 34, gain: 0.5, attack: 0.1, hold: 0.3, vib: [7, 4] });
    noise(o, { t, dur: 1.1, f: 160, type: 'lowpass', gain: 0.4, attack: 0.15, hold: 0.3 });
    noise(o, { t: t + 0.35, dur: 1.2, f: 300, f2: 2600, f3: 400, q: 0.7, gain: 0.32, attack: 0.3 });
    knock(o, t + 0.2, 380, 0.14);
  },
  // Dig in: paws scrabble in the dirt, then settle with a thud.
  anchor: (o, t) => {
    for (let i = 0; i < 4; i++) noise(o, { t: t + i * 0.055, dur: 0.045, f: 900 + (i % 2) * 400, q: 1.4, gain: 0.22 });
    tone(o, { t: t + 0.24, dur: 0.16, f: 120, f2: 60, gain: 0.45 });
    noise(o, { t: t + 0.24, dur: 0.12, f: 400, type: 'lowpass', gain: 0.2 });
  },
  // Got it! A bright two-note pling with a sparkle.
  pickup: (o, t) => {
    [79, 86].forEach((n, i) => tone(o, { t: t + i * 0.07, dur: 0.3, f: midi(n), type: 'triangle', gain: 0.16 }));
    noise(o, { t: t + 0.06, dur: 0.3, f: 7000, type: 'highpass', gain: 0.05, attack: 0.04 });
  },
  // Dropped it: a falling bloop and a clunk on the ground.
  drop: (o, t) => {
    tone(o, { t, dur: 0.22, f: midi(79), f2: midi(67), type: 'triangle', gain: 0.16 });
    tone(o, { t: t + 0.18, dur: 0.12, f: 180, f2: 90, gain: 0.4 });
    knock(o, t + 0.18, 700, 0.14);
  },
  // The treasure flies home: a rising whoosh and a chime as it lands.
  treasureHome: (o, t) => {
    noise(o, { t, dur: 0.45, f: 500, f2: 4500, q: 1.6, gain: 0.18, attack: 0.15 });
    tone(o, { t, dur: 0.45, f: 300, f2: 1200, gain: 0.06 });
    [84, 91].forEach((n, i) => tone(o, { t: t + 0.42 + i * 0.06, dur: 0.6, f: midi(n), gain: 0.12 }));
  },
  // +1! A short brass fanfare: ta-da-daaa.
  score: (o, t) => {
    brass(o, t, 67, 0.1, 0.15);
    brass(o, t + 0.12, 72, 0.1, 0.15);
    brass(o, t + 0.24, 76, 0.55, 0.16);
    brass(o, t + 0.24, 79, 0.55, 0.1);
    noise(o, { t: t + 0.24, dur: 0.7, f: 6500, type: 'highpass', gain: 0.07, attack: 0.05 });
    tone(o, { t: t + 0.24, dur: 0.2, f: 120, f2: 70, gain: 0.3 });
  },
  // Done: a soft two-note "over to you".
  endTurn: (o, t) => {
    tone(o, { t, dur: 0.14, f: midi(74), type: 'triangle', gain: 0.16 });
    tone(o, { t: t + 0.1, dur: 0.22, f: midi(67), type: 'triangle', gain: 0.14 });
  },
};

const table: Record<string, CueFn> = { ...ui, ...board, ...moments, ...chaos, ...party, ...BOARD_CUES };
for (const p of Object.keys(powers) as PowerKind[]) table[`power:${p}`] = powers[p];
for (const w of Object.keys(wheel) as WheelOutcome[]) table[`chaos:${w}`] = wheel[w];
for (const side of ['land', 'sea'] as const) {
  for (const kind of Object.keys(voices[side]) as PieceKind[]) table[`voice:${side}:${kind}`] = voices[side][kind];
}
for (const e of Object.keys(emotes) as EmoteKind[]) table[`emote:${e}`] = emotes[e];

export function cueFn(cue: AudioCue): CueFn | undefined {
  return table[cue];
}

/**
 * Per-cue gain trims (linear), from the level check in the ui demo (`src/ui/demo.html`, "Check levels").
 * They even out loudness between cues; anything not listed plays at 1.
 */
export const TRIM: Partial<Record<AudioCue, number>> = {
  // Targets (loudest 50ms, dBFS): hover -36, clicks -26, board -20, capture -15, fanfares -13..-18,
  // tick -28, voices and emotes -16. No peak above -3 dBFS. Measured 2026-10-26.
  uiHover: 1.38,
  illegal: 1.64,
  moveSea: 1.62,
  capture: 0.79,
  castle: 1.6,
  promote: 1.36,
  checkmate: 0.72,
  draw: 1.45,
  gameStart: 1.7,
  clockLow: 1.46,
  weird: 1.6,
  'voice:land:p': 0.69,
  'voice:land:n': 0.53,
  'voice:land:r': 0.62,
  'voice:sea:p': 1.6, // crab clicks are random noise: peaks vary, so less boost; reads a bit quieter
  'voice:sea:n': 1.8,
  'voice:sea:b': 1.22,
  'voice:sea:r': 0.78,
  'voice:sea:q': 1.48,
  'voice:sea:k': 1.24,
  'emote:laugh': 1.19,
  'emote:angry': 2.11,
  'emote:love': 0.78,
  'emote:shock': 0.6,
  'emote:sleepy': 0.87,
  // Phase 3, measured 2026-10-27. Targets: shows and effects -18..-22, impacts -15..-17, heavy hits -13, peg tick -28.
  dieRoll: 2.09,
  dieBanana: 1.3,
  dieLucky: 1.68,
  cardDraw: 2.82,
  cardPlay: 1.13,
  joker: 1.2,
  duelCall: 1.1,
  duelThrow: 0.88,
  duelWin: 1.53,
  duelLose: 3.27,
  bonk: 1.05,
  wheelSpin: 1.3,
  wheelStop: 1.5,
  stun: 1.97,
  freeze: 2.3,
  block: 0.78,
  revive: 2.75,
  slip: 1.58,
  recharge: 2.24,
  'power:sidestep': 2.72,
  'power:doubleJump': 1.35,
  'power:headbutt': 0.77,
  'power:stomp': 0.57,
  'power:block': 1.1,
  'power:escape': 1.9,
  'chaos:tide': 1.41,
  'chaos:pigeon': 0.82,
  'chaos:earthquake': 0.54,
  'chaos:disco': 3.16,
  // Phase 4, measured 2026-10-28 with the same targets. Steps sit a bit under a chess move (a turn has several),
  // endTurn a bit over a click, sink is the one heavy hit.
  step: 0.9,
  tag: 2.14,
  splash: 0.89,
  sinkWarn: 5.5,
  sink: 0.61,
  anchor: 0.84,
  pickup: 2.07,
  drop: 1.05,
  treasureHome: 1.6,
  score: 1.05,
  endTurn: 1.43,
};

export const cueTrim = (cue: AudioCue): number => TRIM[cue] ?? 1;

/** Every cue the engine knows, in a stable order (the demo's sound board uses this). */
export const ALL_CUES = Object.keys(table) as AudioCue[];
