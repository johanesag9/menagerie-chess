import type { AudioCue, AudioEngine } from '../contracts/types';
import type { CreateAudio } from '../contracts/factories';
import { cueFn, cueTrim } from './cues';
import { MusicPlayer, type Track } from './music';

export { ALL_CUES } from './cues';
export { measureCue, type CueLevel } from './levels';

/** Music sits under the effects; these are the gains at volume 1. */
const MUSIC_BASE = 0.55;
const SFX_BASE = 0.9;

/** Perceptual-ish volume curve. */
const curve = (v: number) => Math.pow(Math.min(1, Math.max(0, v)), 1.6);

class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private volumes = { music: 0.6, sfx: 0.8 };
  private track: Track | 'none' = 'none';
  private player: MusicPlayer | null = null;
  private lastPlayed = new Map<AudioCue, number>();
  private unlocking: Promise<void> | null = null;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  unlock(): Promise<void> {
    if (this.ctx?.state === 'running') return Promise.resolve();
    if (this.unlocking) return this.unlocking;
    this.unlocking = (async () => {
      try {
        if (!this.ctx) this.build();
        await this.ctx!.resume();
        // iOS: a silent buffer inside the gesture fully wakes the output.
        const b = this.ctx!.createBuffer(1, 1, 22050);
        const s = this.ctx!.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx!.destination);
        s.start();
        if (this.track !== 'none' && !this.player) this.startTrack(this.track);
      } catch (err) {
        console.warn('[audio] unlock failed', err);
      } finally {
        this.unlocking = null;
      }
    })();
    return this.unlocking;
  }

  play(cue: AudioCue, opts?: { pan?: number; rate?: number }): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.sfxGain) return;
    const fn = cueFn(cue);
    if (!fn) return;
    // Same cue twice within 35ms (e.g. hover sweep) just stacks up loudness: skip it.
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(cue) ?? -1) < 0.035) return;
    this.lastPlayed.set(cue, now);

    let dest: AudioNode = this.sfxGain;
    const temp: AudioNode[] = [];
    if (opts?.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      p.connect(dest);
      dest = p;
      temp.push(p);
    }
    const trim = cueTrim(cue);
    if (trim !== 1) {
      const g = ctx.createGain();
      g.gain.value = trim;
      g.connect(dest);
      dest = g;
      temp.push(g);
    }
    if (temp.length) window.setTimeout(() => temp.forEach((n) => n.disconnect()), 3000);
    fn({ ctx, dest, rate: opts?.rate ?? 1 }, now + 0.005);
  }

  setMusic(track: Track | 'none'): void {
    if (track === this.track) return;
    this.track = track;
    this.player?.stop();
    this.player = null;
    if (track !== 'none' && this.ctx?.state === 'running') this.startTrack(track);
  }

  setVolumes(music: number, sfx: number): void {
    this.volumes = { music, sfx };
    this.applyVolumes();
  }

  private build(): void {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.musicGain.connect(comp);
    this.sfxGain.connect(comp);
    this.ctx = ctx;
    this.applyVolumes();
  }

  private startTrack(track: Track): void {
    if (!this.ctx || !this.musicGain) return;
    this.player = new MusicPlayer(this.ctx, this.musicGain, track);
    this.player.start();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.musicGain || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(curve(this.volumes.music) * MUSIC_BASE, t, 0.05);
    this.sfxGain.gain.setTargetAtTime(curve(this.volumes.sfx) * SFX_BASE, t, 0.03);
  }
}

export const createAudio: CreateAudio = () => new WebAudioEngine();
