/**
 * Optional short notification tones. Off by default.
 *
 * Tones are synthesised with the Web Audio API (no audio files, nothing
 * downloaded). The AudioContext is created only after the user turns sound
 * on with a click, which satisfies browser autoplay rules. Tones are short
 * and quiet so they do not compete with Webex Desktop's own ringtone.
 */
const PATTERNS = {
  newCall: [
    [660, 0.12],
    [880, 0.12],
  ],
  statusChanged: [[740, 0.1]],
  failure: [
    [330, 0.18],
    [262, 0.25],
  ],
  connectionLost: [
    [440, 0.15],
    [330, 0.15],
    [262, 0.2],
  ],
};

export class AudioNotifier {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  /** Must be called from a user gesture (button click). */
  enable() {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return false;
    try {
      if (!this.ctx) this.ctx = new Ctx();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.enabled = true;
    } catch {
      this.enabled = false;
    }
    return this.enabled;
  }

  disable() {
    this.enabled = false;
  }

  play(name) {
    if (!this.enabled || !this.ctx || !PATTERNS[name]) return;
    try {
      let t = this.ctx.currentTime + 0.02;
      for (const [freq, dur] of PATTERNS[name]) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        t += dur + 0.05;
      }
    } catch {
      /* sound is optional; never break the widget */
    }
  }

  close() {
    this.enabled = false;
    if (this.ctx && typeof this.ctx.close === 'function') this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
