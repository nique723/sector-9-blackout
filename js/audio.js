export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.enabled = false;
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.enabled = true;
  }

  tone(freq, dur, type, gain, slide) {
    if (!this.enabled || !this.ctx || this.volume <= 0) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
    g.gain.setValueAtTime(gain * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot() { this.tone(220, 0.08, "square", 0.12, 80); }
  reload() { this.tone(140, 0.18, "triangle", 0.08, 220); }
  melee() { this.tone(90, 0.12, "sawtooth", 0.1, 50); }
  hit() { this.tone(320, 0.06, "square", 0.06, 140); }
  hurt() { this.tone(110, 0.16, "sawtooth", 0.1, 60); }
  pickup() { this.tone(520, 0.12, "sine", 0.1, 880); }
  wave() { this.tone(180, 0.28, "square", 0.08, 90); }
  win() { this.tone(440, 0.3, "triangle", 0.1, 660); }
  lose() { this.tone(160, 0.4, "sawtooth", 0.1, 50); }
}
