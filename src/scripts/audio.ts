/** A generative sub-bass drone. No samples: oscillators + brown noise. */
export class Drone {
  private ctx?: AudioContext;
  private master?: GainNode;
  private filter?: BiquadFilterNode;
  private rumble?: GainNode;
  private oscs: OscillatorNode[] = [];
  on = false;

  private init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    filter.Q.value = 6;
    filter.connect(master);
    this.filter = filter;

    // detuned fifths — the "hum" of the hole
    [
      [41.2, "sine", 0.32],
      [41.9, "sine", 0.26],
      [61.7, "triangle", 0.1],
      [82.4, "sine", 0.06],
      [123.5, "sine", 0.025],
    ].forEach(([f, type, g]) => {
      const o = ctx.createOscillator();
      o.type = type as OscillatorType;
      o.frequency.value = f as number;
      const gn = ctx.createGain();
      gn.gain.value = g as number;
      o.connect(gn).connect(filter);
      o.start();
      this.oscs.push(o);
    });

    // slow breathing on the filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    // brown-noise rumble for proximity
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 180;
    const rumble = ctx.createGain();
    rumble.gain.value = 0.15;
    src.connect(nf).connect(rumble).connect(master);
    src.start();
    this.rumble = rumble;
    this.noiseBuf = buf;
    this.initFx(ctx, comp);
  }

  /* ── cinematic hits, layered on top of the drone ───────────────── */

  private fx?: GainNode;
  private verb?: ConvolverNode;
  private whoosh?: { gain: GainNode; filter: BiquadFilterNode };
  private noiseBuf?: AudioBuffer;
  private last: Record<string, number> = {};

  private initFx(ctx: AudioContext, out: AudioNode) {
    const fx = ctx.createGain();
    fx.gain.value = 0.9;
    fx.connect(out);
    this.fx = fx;

    // long dark hall — a synthetic impulse response (decaying filtered noise)
    const len = Math.floor(ctx.sampleRate * 5.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.35 - t * 0.3);
        d[i] = lp * Math.pow(1 - t, 3.2);
      }
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.85;
    verb.connect(wet).connect(out);
    this.verb = verb;

    // scroll whoosh: band-passed noise that opens up with velocity
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 400;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain);
    gain.connect(fx);
    gain.connect(verb);
    src.start();
    this.whoosh = { gain, filter };
  }

  private ready(key: string, cooldown: number) {
    if (!this.ctx || !this.on) return false;
    const now = this.ctx.currentTime;
    if (now - (this.last[key] ?? -99) < cooldown) return false;
    this.last[key] = now;
    return true;
  }

  private send(node: AudioNode, wet = 0.6) {
    node.connect(this.fx!);
    if (wet > 0) {
      const g = this.ctx!.createGain();
      g.gain.value = wet;
      node.connect(g).connect(this.verb!);
    }
  }

  private noiseBurst(dur: number, from: number, to: number, peak: number, wet: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.send(g, wet);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.1);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack: number, wet: number, at = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.send(g, wet);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** Scroll speed 0..1 → wind rushing past. */
  setVelocity(v: number) {
    if (!this.ctx || !this.whoosh) return;
    const t = this.ctx.currentTime;
    const on = this.on ? 1 : 0;
    this.whoosh.gain.gain.setTargetAtTime(Math.min(0.5, v * v * 0.7) * on, t, 0.12);
    this.whoosh.filter.frequency.setTargetAtTime(250 + v * 1800, t, 0.15);
  }

  /** Soft sub thump when a new chapter begins. */
  chapter() {
    if (!this.ready("chapter", 1.2)) return;
    this.tone("sine", 70, 38, 1.4, 0.35, 0.01, 0.5);
    this.noiseBurst(0.9, 900, 120, 0.06, 0.7);
  }

  /** The supernova: transient crack, sub drop, roaring tail. */
  supernova() {
    if (!this.ready("nova", 3)) return;
    this.noiseBurst(0.25, 9000, 1200, 0.5, 0.4);
    this.noiseBurst(4.5, 3200, 80, 0.55, 0.9);
    this.tone("sine", 95, 24, 3.5, 0.9, 0.008, 0.6);
    this.tone("triangle", 48, 30, 2.5, 0.25, 0.02, 0.3);
  }

  /** Crossing the horizon: rising tension, then the floor drops out. */
  horizon() {
    if (!this.ready("horizon", 4)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.tone("sawtooth", 110, 55, 1.2, 0.06, 0.6, 0.8);
    this.tone("sine", 60, 18, 5, 0.95, 0.04, 0.5, 0.35);
    this.noiseBurst(3.5, 600, 40, 0.3, 1);
    // the drone falls silent for a breath, as if sound itself can't follow
    const m = this.master!.gain;
    m.cancelScheduledValues(t);
    m.setTargetAtTime(0.04, t + 0.3, 0.25);
    m.setTargetAtTime(0.55, t + 3.4, 1.2);
  }

  /** The last light: a slow, shimmering major swell. */
  light() {
    if (!this.ready("light", 6)) return;
    [220, 277.18, 329.63, 440, 554.37, 659.25, 880].forEach((f, i) => {
      this.tone("sine", f * (1 + (Math.random() - 0.5) * 0.004), f, 7, 0.07 - i * 0.006, 2.4 + i * 0.12, 0.9);
    });
    this.noiseBurst(5, 12000, 4000, 0.04, 1);
  }

  toggle() {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") ctx.resume();
    this.on = !this.on;
    this.master!.gain.cancelScheduledValues(ctx.currentTime);
    this.master!.gain.setTargetAtTime(this.on ? 0.55 : 0, ctx.currentTime, 0.6);
    return this.on;
  }

  /** 0 = far away and calm, 1 = at the horizon. */
  setIntensity(x: number) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.filter!.frequency.setTargetAtTime(180 + x * 900, t, 0.3);
    this.rumble!.gain.setTargetAtTime(0.12 + x * 0.9, t, 0.3);
    this.oscs.forEach((o, i) => o.detune.setTargetAtTime(-x * 120 * (i % 2 ? 1 : -0.5), t, 0.5));
  }
}
