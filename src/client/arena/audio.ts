// Sound for the projector, synthesized with Web Audio. There are no audio files
// and nothing is sampled or copied: every sound below is built from oscillators
// and filtered noise. Phones stay silent on purpose (20 phones would blare).
//
// The character (BRAND.md): short and soft, like system sounds. Round sine and
// triangle tones, quick attacks, gentle tails, nothing harsh or loud.
//
// A browser will not start audio before a user gesture, so unlock() is called on
// the host's first key press or click.

export type Track = "lobby" | "question";

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const LEVEL = { master: 0.9, effects: 0.5, music: 0.2 };
const LOOKAHEAD_S = 0.25;
const SCHEDULE_MS = 80;

interface TrackDef {
  bpm: number;
  steps: number; // eighth notes per loop
  play(sound: Sound, step: number, at: number, eighth: number, out: AudioNode): void;
}

// Lobby: slow and open. Four soft chords, two bars each, with a sparse arpeggio.
const LOBBY_CHORDS = [
  [48, 55, 64, 71, 74], // C major 9
  [45, 52, 60, 67, 71], // A minor 9
  [41, 48, 57, 64, 67], // F major 9
  [43, 50, 57, 59, 64], // G 6/9
];
const LOBBY_ARP = [0, -1, 2, 3, -1, 4, 3, -1, 2, -1, 3, 4, -1, 3, 2, -1]; // chord tone, or -1 for a rest

// Question: a quiet pulse that keeps time without pulling focus from the question.
const QUESTION_ROOTS = [38, 34, 41, 36]; // D, B flat, F, C: one bar each
const QUESTION_ARP = [12, 19, 24, 19, 15, 19, 24, 19]; // semitones above the root

const TRACKS: Record<Track, TrackDef> = {
  lobby: {
    bpm: 76,
    steps: 64,
    play(sound, step, at, eighth, out) {
      const chord = LOBBY_CHORDS[Math.floor(step / 16)]!;
      if (step % 16 === 0) {
        sound.pad(chord.slice(1).map(hz), at, eighth * 16, 0.16, out);
        sound.pluck(hz(chord[0]! - 12), at, eighth * 10, 0.5, out, "sine");
      }
      const tone = LOBBY_ARP[step % 16]!;
      if (tone >= 0) sound.bell(hz(chord[tone]! + 12), at, 1.4, 0.22, out);
    },
  },
  question: {
    bpm: 104,
    steps: 32,
    play(sound, step, at, eighth, out) {
      const root = QUESTION_ROOTS[Math.floor(step / 8)]!;
      if (step % 4 === 0) sound.pluck(hz(root), at, eighth * 3, 0.6, out, "triangle");
      if (step % 8 === 6) sound.pluck(hz(root + 7), at, eighth * 1.5, 0.35, out, "triangle");
      sound.pluck(hz(root + 12 + QUESTION_ARP[step % 8]!), at, eighth * 0.9, step % 2 ? 0.1 : 0.16, out, "sine");
    },
  },
};

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  private wanted: Track | null = null;
  private playing: { track: Track; out: GainNode; step: number; next: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  // "off" until the first gesture, then the AudioContext's own state.
  onState: (state: string) => void = () => undefined;

  get state(): string {
    return this.ctx?.state ?? "off";
  }

  // Call from a user gesture. Safe to call again.
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : LEVEL.master;
      // A gentle limiter, so stacked sounds never clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 6;
      this.master.connect(limiter).connect(ctx.destination);
      this.effects = ctx.createGain();
      this.effects.gain.value = LEVEL.effects;
      this.effects.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = LEVEL.music;
      this.musicBus.connect(this.master);

      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = noise;

      ctx.addEventListener("statechange", () => this.onState(ctx.state));
      this.timer = setInterval(this.schedule, SCHEDULE_MS);
      this.onState(ctx.state);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.music(this.wanted);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : LEVEL.master, this.ctx.currentTime, 0.03);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  // ---- music

  music(track: Track | null): void {
    this.wanted = track;
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    if (this.playing?.track === track) return;
    if (this.playing) {
      // Fade the old loop out; its last notes ring out under the fade.
      const old = this.playing.out;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      setTimeout(() => old.disconnect(), 2500);
      this.playing = null;
    }
    if (!track) return;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    out.connect(this.musicBus);
    this.playing = { track, out, step: 0, next: ctx.currentTime + 0.12 };
  }

  private readonly schedule = (): void => {
    const ctx = this.ctx;
    const playing = this.playing;
    if (!ctx || !playing || ctx.state !== "running") return;
    const def = TRACKS[playing.track];
    const eighth = 60 / def.bpm / 2;
    // After a stall (a hidden tab), skip ahead instead of bunching notes up.
    if (playing.next < ctx.currentTime) playing.next = ctx.currentTime + 0.05;
    while (playing.next < ctx.currentTime + LOOKAHEAD_S) {
      def.play(this, playing.step, playing.next, eighth, playing.out);
      playing.step = (playing.step + 1) % def.steps;
      playing.next += eighth;
    }
  };

  // ---- effects

  // Someone joined: a small two-note blip.
  join(): void {
    const t = this.now();
    if (t === null) return;
    this.bell(hz(81), t, 0.22, 0.5);
    this.bell(hz(88), t + 0.07, 0.3, 0.45);
  }

  // A question starts: three rising notes.
  questionStart(): void {
    const t = this.now();
    if (t === null) return;
    [74, 78, 81].forEach((note, i) => this.bell(hz(note), t + i * 0.11, 0.7, 0.55));
    this.pluck(hz(50), t, 0.6, 0.5, undefined, "sine");
  }

  // The last five seconds: a soft tick each second, the last one higher.
  tick(last = false): void {
    const t = this.now();
    if (t === null) return;
    this.pluck(hz(last ? 93 : 86), t, 0.07, 0.5, undefined, "sine");
    this.noise(t, 0.03, 0.12, 5000, "highpass");
  }

  // Platforms give way: a low rumble that sinks.
  collapse(): void {
    const ctx = this.ctx;
    const t = this.now();
    if (!ctx || t === null || !this.effects) return;
    this.noise(t, 1.1, 0.9, 180, "lowpass", 60);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(82, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.9);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.7, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(gain).connect(this.effects);
    osc.start(t);
    osc.stop(t + 1.2);
  }

  // A winner: a rising major arpeggio that rings.
  win(): void {
    const t = this.now();
    if (t === null) return;
    [72, 76, 79, 84, 88].forEach((note, i) => this.bell(hz(note), t + i * 0.1, 1.6, 0.5));
    this.pad([hz(60), hz(67), hz(76)], t, 1.8, 0.3);
  }

  // ---- voices (public so the track definitions above can use them)

  private now(): number | null {
    return this.ctx && this.ctx.state === "running" ? this.ctx.currentTime : null;
  }

  // A plucked tone: instant attack, exponential decay.
  pluck(freq: number, at: number, length: number, level: number, out?: AudioNode, type: OscillatorType = "sine"): void {
    const ctx = this.ctx;
    const dest = out ?? this.effects;
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = freq;
    filter.type = "lowpass";
    filter.frequency.value = Math.min(6000, freq * 6);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(filter).connect(gain).connect(dest);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  // A bell or marimba tone: a sine with a quieter, slightly sharp overtone.
  bell(freq: number, at: number, length: number, level: number, out?: AudioNode): void {
    this.pluck(freq, at, length, level, out, "sine");
    this.pluck(freq * 2.01, at, length * 0.45, level * 0.28, out, "sine");
    this.pluck(freq * 4.2, at, length * 0.18, level * 0.08, out, "sine");
  }

  // A soft held chord: detuned triangles through a low filter, slow in and out.
  pad(freqs: number[], at: number, length: number, level: number, out?: AudioNode): void {
    const ctx = this.ctx;
    const dest = out ?? this.effects;
    if (!ctx || !dest) return;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const attack = Math.min(0.9, length * 0.3);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + attack);
    gain.gain.setValueAtTime(level, at + length * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.6);
    filter.connect(gain).connect(dest);
    for (const freq of freqs) {
      for (const detune of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(at);
        osc.stop(at + length + 0.7);
      }
    }
  }

  // Filtered noise, optionally sweeping the filter down.
  noise(at: number, length: number, level: number, cutoff: number, type: BiquadFilterType, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.effects || !this.noiseBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(cutoff, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.05, length / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(this.effects);
    source.start(at);
    source.stop(at + length + 0.05);
  }
}
