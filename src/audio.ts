/**
 * All sound is synthesised at runtime -- no audio files in the repo.
 *
 * The palette is deliberately soft: warm sine chimes for makes, dull thuds for
 * the ball, a low filtered-noise bed for wheels. Nothing here should ever be
 * sharp enough to be tiring on a twentieth attempt, because on this game the
 * twentieth attempt is normal.
 */

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture or the context stays suspended. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // Two seconds of white noise, reused by every noise-based sound.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // Persistent wheel-roll bed, gated by gain.
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 900;
    filt.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    this.rollGain = g;
    this.rollFilter = filt;
  }

  private get t(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    detune = 0,
    delay = 0,
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.t + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(
    dur: number,
    gain: number,
    filterType: BiquadFilterType,
    from: number,
    to: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const t0 = this.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** Ball hitting dirt, grass or plywood. */
  bounce(strength: number) {
    const s = Math.min(1, strength);
    if (s < 0.05) return;
    this.tone(74 + s * 40, 0.16, 0.3 * s, 'sine');
    this.noise(0.09, 0.14 * s, 'lowpass', 1600, 300);
  }

  /** Rim contact: the sound of hope. */
  rim(strength: number) {
    const s = Math.min(1, 0.35 + strength);
    this.tone(760, 0.34, 0.13 * s, 'triangle', 6);
    this.tone(1141, 0.26, 0.09 * s, 'triangle', -9);
    this.noise(0.13, 0.08 * s, 'bandpass', 2600, 1500);
  }

  backboard(strength: number) {
    const s = Math.min(1, 0.4 + strength);
    this.tone(196, 0.2, 0.2 * s, 'triangle');
    this.noise(0.12, 0.13 * s, 'lowpass', 900, 220);
  }

  /** Net-only make. Soft descending hiss. */
  swish() {
    this.noise(0.4, 0.2, 'bandpass', 5200, 900);
  }

  /** The payoff chime. Rises a step with each consecutive make. */
  make(streak: number) {
    const root = 392 * Math.pow(2, Math.min(6, streak - 1) / 12);
    this.tone(root, 0.5, 0.16, 'sine', 0, 0.0);
    this.tone(root * 1.25, 0.5, 0.13, 'sine', 0, 0.07);
    this.tone(root * 1.5, 0.62, 0.13, 'sine', 0, 0.14);
    this.tone(root * 2, 0.8, 0.1, 'sine', 0, 0.21);
  }

  /** Ollie pop off the tail. */
  pop() {
    this.tone(150, 0.09, 0.16, 'square');
    this.noise(0.07, 0.12, 'highpass', 1400, 3000);
  }

  land(strength: number) {
    const s = Math.min(1, strength);
    this.noise(0.13, 0.2 * s, 'lowpass', 2400, 400);
    this.tone(96, 0.11, 0.14 * s, 'sine');
  }

  step() {
    this.noise(0.06, 0.045, 'bandpass', 1800, 900);
  }

  /** Board picked up / put down. */
  mount(on: boolean) {
    this.tone(on ? 330 : 247, 0.14, 0.1, 'triangle');
    this.noise(0.09, 0.07, 'bandpass', 2200, 1100);
  }

  place() {
    this.tone(220, 0.1, 0.09, 'triangle');
    this.tone(330, 0.14, 0.07, 'sine', 0, 0.05);
  }

  /** Continuous wheel roll. `speed01` is 0..1, `rough` raises the filter. */
  roll(speed01: number, grounded: boolean) {
    if (!this.rollGain || !this.rollFilter || !this.ctx) return;
    const target = grounded && !this.muted ? Math.min(0.14, speed01 * 0.15) : 0;
    this.rollGain.gain.setTargetAtTime(target, this.t, 0.06);
    this.rollFilter.frequency.setTargetAtTime(500 + speed01 * 1500, this.t, 0.08);
  }
}

export const sfx = new Sfx();
