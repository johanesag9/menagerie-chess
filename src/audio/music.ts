/**
 * Gentle generative music, one short looping "song" per track.
 * A look-ahead scheduler places notes slightly in the future on the AudioContext clock,
 * so timing stays tight even when the main thread is busy.
 */
import { midi, noise, tone, type Out } from './synth';

export type Track = 'title' | 'game' | 'tense';

interface TrackDef {
  bpm: number;
  /** Chords as midi roots + intervals; each lasts `barsPerChord` bars of 4 beats. */
  chords: number[][];
  barsPerChord: number;
  /** Melody scale (midi notes) to random-walk over. */
  scale: number[];
  /** Chance of a melody note on each 8th. */
  density: number;
  lead: 'marimba' | 'kalimba' | 'pluck';
  pad: number; // pad gain
  bass: 'roots' | 'pulse';
  hat: boolean;
}

const pent = (root: number, steps: number[], octaves: number) => {
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) for (const s of steps) out.push(root + o * 12 + s);
  return out;
};

const TRACKS: Record<Track, TrackDef> = {
  // Sunny C major pentatonic marimba.
  title: {
    bpm: 92,
    chords: [[48, 0, 4, 7, 11], [45, 0, 3, 7, 10], [41, 0, 4, 7, 9], [43, 0, 4, 7, 10]],
    barsPerChord: 2,
    scale: pent(72, [0, 2, 4, 7, 9], 2),
    density: 0.5,
    lead: 'marimba',
    pad: 0.035,
    bass: 'roots',
    hat: false,
  },
  // Calm, sparse kalimba that sits under play.
  game: {
    bpm: 80,
    chords: [[41, 0, 4, 7, 9], [38, 0, 3, 7, 10], [46, 0, 4, 7, 11], [48, 0, 4, 7, 10]],
    barsPerChord: 2,
    scale: pent(77, [0, 2, 4, 7, 9], 2),
    density: 0.3,
    lead: 'kalimba',
    pad: 0.03,
    bass: 'roots',
    hat: false,
  },
  // Minor, with a pulsing bass and ticking hats: low clocks, endgames.
  tense: {
    bpm: 112,
    chords: [[45, 0, 3, 7], [41, 0, 4, 7], [38, 0, 3, 7], [40, 0, 4, 7, 10]],
    barsPerChord: 1,
    scale: [69, 71, 72, 74, 76, 77, 80, 81],
    density: 0.38,
    lead: 'pluck',
    pad: 0.03,
    bass: 'pulse',
    hat: true,
  },
};

export class MusicPlayer {
  private bus: GainNode;
  private timer: number | null = null;
  private step = 0; // 8th-note counter
  private nextTime = 0;
  private melodyIdx = 3;
  private def: TrackDef;

  constructor(private ctx: AudioContext, dest: AudioNode, track: Track) {
    this.def = TRACKS[track];
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.0001;
    this.bus.connect(dest);
  }

  start(fadeS = 1.2): void {
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(0.0001, now);
    this.bus.gain.exponentialRampToValueAtTime(1, now + fadeS);
    this.nextTime = now + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 50);
    this.schedule();
  }

  /** Fade out, then disconnect. */
  stop(fadeS = 0.8): void {
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(Math.max(this.bus.gain.value, 0.0001), now);
    this.bus.gain.exponentialRampToValueAtTime(0.0001, now + fadeS);
    window.setTimeout(() => {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      this.bus.disconnect();
    }, fadeS * 1000 + 100);
  }

  private schedule(): void {
    const ahead = 0.25;
    const eighth = 60 / this.def.bpm / 2;
    // If the tab was throttled we may have fallen behind: skip, don't burst.
    if (this.nextTime < this.ctx.currentTime - 0.1) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + ahead) {
      this.playStep(this.step, this.nextTime, eighth);
      this.nextTime += eighth;
      this.step++;
    }
  }

  private playStep(step: number, t: number, eighth: number): void {
    const d = this.def;
    const o: Out = { ctx: this.ctx, dest: this.bus, rate: 1 };
    const stepsPerChord = d.barsPerChord * 8;
    const chord = d.chords[Math.floor(step / stepsPerChord) % d.chords.length];
    const [root, ...ints] = chord;
    const inBar = step % 8;

    // Pad: soft chord at the start of each chord.
    if (step % stepsPerChord === 0) {
      const len = stepsPerChord * eighth;
      for (const i of ints) {
        tone(o, { t, dur: len + 0.3, f: midi(root + 12 + i), type: 'triangle', gain: d.pad, attack: 0.6, hold: 0.6 });
      }
    }

    // Bass.
    if (d.bass === 'roots' && (inBar === 0 || inBar === 4)) {
      tone(o, { t, dur: eighth * 3.5, f: midi(root), gain: 0.16, attack: 0.02, hold: 0.3 });
    } else if (d.bass === 'pulse') {
      tone(o, { t, dur: eighth * 0.9, f: midi(root + (inBar === 7 ? 7 : 0)), gain: inBar % 2 ? 0.08 : 0.13, attack: 0.01, filter: { type: 'lowpass', f: 500 } });
    }

    if (d.hat && inBar % 2 === 1) noise(o, { t, dur: 0.035, f: 7000, type: 'highpass', gain: 0.025 });

    // Melody: random walk, prefers chord tones on strong beats, rests often.
    const strong = inBar % 4 === 0;
    if (Math.random() < d.density + (strong ? 0.15 : 0)) {
      const move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
      this.melodyIdx = Math.max(0, Math.min(d.scale.length - 1, this.melodyIdx + move));
      let n = d.scale[this.melodyIdx];
      if (strong) {
        // Snap to the nearest chord tone so it always sounds sweet.
        const pcs = ints.map((i) => (root + i) % 12);
        for (let k = 0; k < 3 && !pcs.includes(n % 12); k++) n--;
      }
      this.lead(o, t, n, eighth);
    }
  }

  private lead(o: Out, t: number, n: number, eighth: number): void {
    const f = midi(n);
    switch (this.def.lead) {
      case 'marimba':
        tone(o, { t, dur: 0.5, f, gain: 0.09, attack: 0.004 });
        tone(o, { t, dur: 0.12, f: f * 4, gain: 0.025, attack: 0.002 });
        break;
      case 'kalimba':
        tone(o, { t, dur: 0.9, f, gain: 0.075, attack: 0.003 });
        tone(o, { t, dur: 0.2, f: f * 5.4, gain: 0.015, attack: 0.002 });
        break;
      case 'pluck':
        tone(o, { t, dur: eighth * 1.6, f, type: 'triangle', gain: 0.07, attack: 0.003, filter: { type: 'lowpass', f: 2400 } });
        break;
    }
  }
}
