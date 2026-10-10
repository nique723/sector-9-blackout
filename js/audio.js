// Synthesised sound. No audio files: every effect is built from filtered
// noise plus a pitched body, which is what makes a gunshot read as a gunshot
// instead of a beep.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this.noiseBuf = null;
    this._volume = 0.7;
  }

  get volume() { return this._volume; }
  set volume(v) {
    this._volume = v;
    if (this.master) this.master.gain.value = v;
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      this.master = this.ctx.createGain();
      this.master.gain.value = this._volume;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.enabled = true;
  }

  ready() {
    return this.enabled && this.ctx && this._volume > 0;
  }

  // Filtered noise burst. f0 -> f1 sweeps the filter over the duration.
  noise({ at = 0, dur = 0.1, type = "lowpass", f0 = 2000, f1 = 0, q = 0.7, gain = 0.3, attack = 0.001 }) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    if (f1) filter.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.03);
  }

  tone({ at = 0, freq = 440, slide = 0, dur = 0.1, type = "sine", gain = 0.2, attack = 0.001 }) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // Pistol: sharp crack, mid body, low thump, short street tail, then the
  // casing hitting the ground a moment later.
  shot() {
    const p = 0.94 + Math.random() * 0.12;
    this.noise({ dur: 0.045, type: "highpass", f0: 2400 * p, gain: 0.5 });
    this.noise({ dur: 0.17, type: "lowpass", f0: 5200 * p, f1: 480, gain: 0.75 });
    this.tone({ freq: 175 * p, slide: 46, dur: 0.13, type: "triangle", gain: 0.85 });
    this.noise({ at: 0.03, dur: 0.42, type: "bandpass", f0: 950, q: 0.5, gain: 0.1, attack: 0.02 });
    const c = 0.34 + Math.random() * 0.1;
    this.tone({ at: c, freq: 5200 + Math.random() * 900, dur: 0.035, gain: 0.03 });
    this.tone({ at: c + 0.07, freq: 6100 + Math.random() * 900, dur: 0.03, gain: 0.018 });
  }

  // Enemy rifle: lower, duller, and quieter the further away it is.
  enemyShot(dist = 10) {
    const v = Math.max(0.18, 1 - dist / 28);
    this.noise({ dur: 0.05, type: "highpass", f0: 1500, gain: 0.3 * v });
    this.noise({ dur: 0.22, type: "lowpass", f0: 2600, f1: 300, gain: 0.5 * v });
    this.tone({ freq: 120, slide: 40, dur: 0.16, type: "triangle", gain: 0.5 * v });
  }

  // Enemy dropping a mag: the cue that it is safe to push.
  enemyReload(dist = 10) {
    const v = Math.max(0.25, 1 - dist / 24);
    this.noise({ dur: 0.04, type: "bandpass", f0: 1300, q: 2.5, gain: 0.2 * v });
    this.noise({ at: 0.5, dur: 0.04, type: "bandpass", f0: 1000, q: 2.5, gain: 0.24 * v });
  }

  // A round passing close by.
  whiz() {
    this.noise({ dur: 0.16, type: "bandpass", f0: 3400, f1: 900, q: 5, gain: 0.16, attack: 0.02 });
  }

  dry() {
    this.tone({ freq: 1900, dur: 0.02, type: "square", gain: 0.07 });
    this.noise({ dur: 0.025, type: "highpass", f0: 3000, gain: 0.1 });
  }

  // Mag out, mag in, slide rack. `dur` is the full reload time in seconds.
  reload(dur = 1.4) {
    const click = (at, f, g) => {
      this.noise({ at, dur: 0.04, type: "bandpass", f0: f, q: 2.5, gain: g });
      this.tone({ at, freq: f * 0.5, dur: 0.03, type: "square", gain: g * 0.25 });
    };
    click(dur * 0.1, 1500, 0.22);
    click(dur * 0.55, 1100, 0.28);
    click(dur * 0.82, 2100, 0.24);
    click(dur * 0.9, 1700, 0.3);
  }

  melee() {
    this.noise({ dur: 0.16, type: "bandpass", f0: 700, f1: 2600, q: 1.4, gain: 0.3, attack: 0.03 });
  }

  dodge() {
    this.noise({ dur: 0.24, type: "bandpass", f0: 420, f1: 1300, q: 0.9, gain: 0.22, attack: 0.05 });
  }

  // Round landing on an enemy.
  hit() {
    this.noise({ dur: 0.06, type: "lowpass", f0: 1400, f1: 300, gain: 0.4 });
    this.tone({ freq: 240, slide: 120, dur: 0.06, type: "square", gain: 0.1 });
  }

  headshot() {
    this.hit();
    this.tone({ freq: 1560, dur: 0.12, type: "sine", gain: 0.2 });
    this.tone({ at: 0.015, freq: 2340, dur: 0.1, type: "sine", gain: 0.1 });
  }

  kill() {
    this.tone({ freq: 880, dur: 0.07, type: "triangle", gain: 0.16 });
    this.tone({ at: 0.07, freq: 1320, dur: 0.12, type: "triangle", gain: 0.16 });
  }

  // Round landing on a wall or the street.
  ricochet() {
    this.noise({ dur: 0.05, type: "bandpass", f0: 3200, q: 1.2, gain: 0.1 });
  }

  hurt() {
    this.noise({ dur: 0.12, type: "lowpass", f0: 900, f1: 200, gain: 0.5 });
    this.tone({ freq: 130, slide: 60, dur: 0.16, type: "sawtooth", gain: 0.16 });
  }

  step() {
    this.noise({ dur: 0.05, type: "lowpass", f0: 420, gain: 0.07 });
  }

  pickup() { this.tone({ freq: 520, slide: 880, dur: 0.12, gain: 0.14 }); }
  wave() { this.tone({ freq: 180, slide: 90, dur: 0.3, type: "square", gain: 0.1 }); }
  win() { this.tone({ freq: 440, slide: 660, dur: 0.3, type: "triangle", gain: 0.14 }); }
  lose() { this.tone({ freq: 160, slide: 50, dur: 0.4, type: "sawtooth", gain: 0.14 }); }
}
