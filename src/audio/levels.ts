/**
 * Offline level check: renders one cue into an OfflineAudioContext and measures it.
 * Used by the ui demo's sound board to even out loudness. Not used in the game itself.
 */
import type { AudioCue } from '../contracts/types';
import { cueFn, cueTrim } from './cues';

export interface CueLevel {
  cue: AudioCue;
  /** Sample peak, dBFS. */
  peakDb: number;
  /** Loudest 50ms RMS window, dBFS: a rough "how loud does it feel". */
  loudDb: number;
  /** Seconds until the sound falls below -60 dBFS. */
  length: number;
}

const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -120);

export async function measureCue(cue: AudioCue, withTrim = true): Promise<CueLevel> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, rate * 3, rate);
  const g = ctx.createGain();
  g.gain.value = withTrim ? cueTrim(cue) : 1;
  g.connect(ctx.destination);
  cueFn(cue)?.({ ctx, dest: g, rate: 1 }, 0.01);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    if (a > 0.001) last = i;
  }
  const win = Math.round(rate * 0.05);
  let loud = 0;
  for (let i = 0; i + win <= d.length; i += Math.floor(win / 2)) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += d[j] * d[j];
    loud = Math.max(loud, Math.sqrt(sum / win));
  }
  return { cue, peakDb: db(peak), loudDb: db(loud), length: last / rate };
}
