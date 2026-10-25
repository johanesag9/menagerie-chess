/**
 * Tiny WebAudio synth helpers. Every sound in the game is built from these:
 * enveloped oscillators, filtered noise and a formant "voice" for animal calls.
 * Nothing is downloaded.
 */

export interface Out {
  /** A live AudioContext, or an OfflineAudioContext when measuring levels. */
  ctx: BaseAudioContext;
  /** Where this sound goes (already panned / volume-controlled). */
  dest: AudioNode;
  /** Pitch multiplier from play({ rate }). */
  rate: number;
}

export interface ToneOpts {
  t: number;
  dur: number;
  f: number;
  /** Glide target frequency (exponential). */
  f2?: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** Vibrato (Hz) and depth (Hz). */
  vib?: [rate: number, depth: number];
  filter?: { type: BiquadFilterType; f: number; q?: number };
  /** Hold the level before the decay (0..1 of dur). */
  hold?: number;
}

/** Envelope: 0 -> peak over `attack`, hold, then exponential fall to silence at t + dur. */
function envelope(ctx: BaseAudioContext, g: GainNode, t: number, dur: number, peak: number, attack: number, hold = 0) {
  const p = Math.max(peak, 0.0002);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(p, t + attack);
  const holdEnd = t + attack + Math.max(0, (dur - attack) * hold);
  g.gain.setValueAtTime(p, holdEnd);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  void ctx;
}

export function tone(o: Out, opts: ToneOpts): void {
  const { ctx } = o;
  const { t, dur, type = 'sine', gain = 0.3, attack = 0.005 } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  const f = opts.f * o.rate;
  osc.frequency.setValueAtTime(f, t);
  if (opts.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f2 * o.rate), t + dur);

  if (opts.vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = opts.vib[0];
    depth.gain.value = opts.vib[1] * o.rate;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  const g = ctx.createGain();
  envelope(ctx, g, t, dur, gain, attack, opts.hold);
  let head: AudioNode = osc;
  if (opts.filter) {
    const bq = ctx.createBiquadFilter();
    bq.type = opts.filter.type;
    bq.frequency.value = opts.filter.f;
    bq.Q.value = opts.filter.q ?? 0.8;
    head.connect(bq);
    head = bq;
  }
  head.connect(g).connect(o.dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

export interface NoiseOpts {
  t: number;
  dur: number;
  gain?: number;
  attack?: number;
  type?: BiquadFilterType;
  f: number;
  /** Filter sweep target. */
  f2?: number;
  /** Optional sweep back (f -> f2 -> f3). */
  f3?: number;
  q?: number;
  hold?: number;
}

export function noise(o: Out, opts: NoiseOpts): void {
  const { ctx } = o;
  const { t, dur, gain = 0.2, attack = 0.003, type = 'bandpass', q = 1 } = opts;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = type;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(opts.f * o.rate, t);
  if (opts.f2 && opts.f3) {
    bq.frequency.exponentialRampToValueAtTime(opts.f2 * o.rate, t + dur * 0.5);
    bq.frequency.exponentialRampToValueAtTime(opts.f3 * o.rate, t + dur);
  } else if (opts.f2) {
    bq.frequency.exponentialRampToValueAtTime(opts.f2 * o.rate, t + dur);
  }
  const g = ctx.createGain();
  envelope(ctx, g, t, dur, gain, attack, opts.hold);
  src.connect(bq).connect(g).connect(o.dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

export interface VoiceOpts {
  t: number;
  dur: number;
  /** Pitch path: start, (middle), end. */
  f: number;
  f2?: number;
  f3?: number;
  /** Formant centres (Hz): roughly the "vowel" of the call. */
  formants: number[];
  gain?: number;
  attack?: number;
  vib?: [rate: number, depth: number];
  type?: OscillatorType;
}

/** A buzzy source through parallel band-pass formants: cartoon animal calls and "ha ha"s. */
export function voice(o: Out, opts: VoiceOpts): void {
  const { ctx } = o;
  const { t, dur, gain = 0.35, attack = 0.02, type = 'sawtooth' } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(opts.f * o.rate, t);
  if (opts.f2 && opts.f3) {
    osc.frequency.exponentialRampToValueAtTime(opts.f2 * o.rate, t + dur * 0.4);
    osc.frequency.exponentialRampToValueAtTime(opts.f3 * o.rate, t + dur);
  } else if (opts.f2) {
    osc.frequency.exponentialRampToValueAtTime(opts.f2 * o.rate, t + dur);
  }
  if (opts.vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = opts.vib[0];
    depth.gain.value = opts.vib[1] * o.rate;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const g = ctx.createGain();
  envelope(ctx, g, t, dur, gain, attack, 0.35);
  for (const fc of opts.formants) {
    const bq = ctx.createBiquadFilter();
    bq.type = 'bandpass';
    bq.frequency.value = fc;
    bq.Q.value = 5;
    osc.connect(bq).connect(g);
  }
  g.connect(o.dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Equal-tempered note name helper: midi(60) = middle C. */
export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
