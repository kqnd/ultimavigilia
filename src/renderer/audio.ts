/// <reference types="vite/client" />
/**
 * Áudio 100% procedural (WebAudio): nenhum arquivo externo. Barramentos separados para efeitos,
 * ambiente, interface e alertas; alertas abaixam ("ducking") os efeitos para permanecerem
 * audíveis em hordas grandes. Limite de vozes por som evita saturação.
 */

type Recipe = (a: Audio, t: number, out: AudioNode, v: number) => void;
const BARD_TRACKS = Object.values(import.meta.glob('./music/bardo/*.mp3', { eager: true, query: '?url', import: 'default' })) as string[];

export function bardSpatial(sourceX: number, sourceY: number, listenerX: number, listenerY: number): { pan: number; gain: number } {
  const dx = sourceX - listenerX;
  const dy = sourceY - listenerY;
  return {
    pan: Math.max(-1, Math.min(1, dx / 220)),
    gain: Math.max(0, 1 - Math.hypot(dx, dy) / 560) ** 1.5 * 0.66,
  };
}

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private themeBus: GainNode | null = null;
  private themeTimer: ReturnType<typeof setInterval> | null = null;
  private themeNext = 0;
  private themeBeat = 0;
  private themeType = '';
  private themePhase = 1;
  private alert!: GainNode;
  private ui!: GainNode;
  private noiseBuf!: AudioBuffer;
  private voices = new Map<string, number[]>();
  private listener = { x: 0, y: 0 };
  /** Multiplicador de tom aplicado às primitivas enquanto uma receita toca (variação de pitch). */
  private pitchMul = 1;
  private vol = { master: 0.8, sfx: 0.9, amb: 0.6 };
  private ambStarted = false;
  private bardEl: HTMLAudioElement | null = null;
  private bardGain: GainNode | null = null;
  private bardPan: StereoPannerNode | null = null;
  private bardTrack = 0;
  private bardFailures = 0;
  private bardDisabled = false;
  bardPaused = false;

  /** Precisa de um gesto do usuário para iniciar (política de autoplay). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music = ctx.createGain();
    this.alert = ctx.createGain();
    this.ui = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.music.connect(this.master);
    this.alert.connect(this.master);
    this.ui.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startAmbience();
  }

  /** Música real do bardo: uma fonte WebAudio estéreo, sem reiniciar entre ondas. */
  setBard(source: { x: number; y: number } | null, listenerX: number, listenerY: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !BARD_TRACKS.length || this.bardDisabled) return;
    if (!this.bardEl && active) this.createBardTrack();
    if (!this.bardEl || !this.bardGain || !this.bardPan) return;
    const spatial = source ? bardSpatial(source.x, source.y, listenerX, listenerY) : { pan: 0, gain: 0 };
    const duck = this.themeType ? 0.16 : 1;
    const target = active && !this.bardPaused && source && ctx.state === 'running' ? spatial.gain * duck : 0;
    this.bardGain.gain.setTargetAtTime(target, ctx.currentTime, 0.18);
    this.bardPan.pan.setTargetAtTime(spatial.pan, ctx.currentTime, 0.12);
    if (active && this.bardEl.paused && ctx.state === 'running') void this.bardEl.play().catch(() => undefined);
  }

  private createBardTrack(): void {
    const ctx = this.ctx;
    if (!ctx || !BARD_TRACKS.length) return;
    const el = document.createElement('audio');
    el.src = BARD_TRACKS[this.bardTrack % BARD_TRACKS.length] as string;
    el.preload = 'auto';
    el.onended = () => {
      this.bardFailures = 0;
      this.bardTrack = (this.bardTrack + 1) % BARD_TRACKS.length;
      el.src = BARD_TRACKS[this.bardTrack] as string;
      void el.play().catch(() => undefined);
    };
    el.onerror = () => {
      if (++this.bardFailures >= BARD_TRACKS.length) {
        this.bardDisabled = true;
        el.pause();
        return;
      }
      this.bardTrack = (this.bardTrack + 1) % BARD_TRACKS.length;
      el.src = BARD_TRACKS[this.bardTrack] as string;
      void el.play().catch(() => undefined);
    };
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    gain.gain.value = 0;
    src.connect(gain).connect(pan).connect(this.music);
    this.bardEl = el;
    this.bardGain = gain;
    this.bardPan = pan;
  }

  stopBard(): void {
    this.bardEl?.pause();
    if (this.bardGain && this.ctx) this.bardGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  setVolumes(master: number, sfx: number, amb: number): void {
    this.vol = { master, sfx, amb };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.alert.gain.value = Math.min(1, this.vol.sfx * 1.1);
    this.ui.gain.value = this.vol.sfx * 0.8;
    this.amb.gain.value = this.vol.amb * 0.5;
    this.music.gain.value = this.vol.amb * 0.62;
  }

  /** Nota com ataque/decay suaves e duas camadas levemente desafinadas (timbre de cordas). */
  private scoreNote(t: number, dur: number, out: AudioNode, hz: number, gain: number, lead = false): void {
    const ctx = this.ctx as AudioContext;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lead ? 1800 : 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + (lead ? 0.025 : 0.11));
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.42), t + dur * 0.63);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(out);
    for (const [kind, cents, level] of [['triangle', 0, 1], [lead ? 'sine' : 'sawtooth', lead ? 4 : -5, lead ? 0.26 : 0.18]] as const) {
      const osc = ctx.createOscillator();
      osc.type = kind;
      osc.frequency.value = hz;
      osc.detune.value = cents;
      const mix = ctx.createGain();
      mix.gain.value = level;
      osc.connect(mix).connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }

  /** Trilha procedural orquestral: frases com pausas, acentos e leve swing. */
  startBossTheme(type: string, introSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.themeType === type) return;
    this.stopBossTheme();
    this.themeType = type;
    this.themePhase = 1;
    const bus = ctx.createGain();
    bus.gain.value = 0.85;
    bus.connect(this.music);
    this.themeBus = bus;
    const dark = type === 'patriarch' || type === 'elderFather';
    const cold = type === 'frostBride' || type === 'highAcolyte';
    const root = dark ? 65.41 : cold ? 92.5 : type === 'moonDevourer' ? 82.41 : 73.42;
    const bpm = type === 'alphaWolf' ? 132 : dark ? 112 : cold ? 104 : 118;
    const beat = 60 / bpm;
    const step = beat / 2;
    const intro = Math.max(0.5, introSeconds);
    const t = ctx.currentTime + 0.06;
    // Crescendo acompanha a materialização; a percussão abre a luta.
    for (const [i, ratio] of [1, 1.189, 1.498].entries())
      this.scoreNote(t + i * 0.24, Math.max(0.6, intro - i * 0.24), bus, root * ratio * 2, 0.08 + i * 0.018);
    this.noise(t, intro * 0.7, bus, { type: 'lowpass', f0: 110, f1: 600, gain: 0.08, attack: 0.25 });
    this.tone(t + intro - 0.2, 0.65, bus, { type: 'sine', f0: 70, f1: 35, gain: 0.32 });
    this.noise(t + intro - 0.2, 0.28, bus, { type: 'lowpass', f0: 600, f1: 110, gain: 0.22 });
    this.themeNext = t + intro;
    this.themeBeat = 0;
    const schedule = (): void => {
      if (this.themeBus !== bus || !this.ctx) return;
      while (this.themeNext < this.ctx.currentTime + 0.8) {
        const n = this.themeBeat++;
        const bar = Math.floor(n / 8);
        const pos = n % 8;
        const chord = [1, 0.7937, 1.1892, 0.8909][bar % 4];
        const base = root * chord;
        const swing = pos % 2 ? step * 0.13 : 0;
        const at = this.themeNext + swing;
        const intensity = this.themePhase >= 2 ? 1.18 : 1;
        if (pos === 0) {
          for (const ratio of [2, 2.378, 2.997]) this.scoreNote(at, beat * 3.8, bus, base * ratio, 0.04 * intensity);
          this.tone(at, 0.26, bus, { type: 'sine', f0: 78, f1: 38, gain: 0.27 * intensity });
        }
        if (pos === 3 || pos === 6) this.scoreNote(at, beat * 0.8, bus, base / 2, 0.14 * intensity);
        if (pos === 4) {
          this.noise(at, 0.18, bus, { type: 'bandpass', f0: 820, f1: 340, gain: 0.12 * intensity });
          this.tone(at, 0.13, bus, { type: 'sine', f0: 95, f1: 60, gain: 0.14 });
        }
        if (pos === 2 || pos === 5 || (pos === 7 && bar % 2 === 1)) {
          const phrase = [1.5, 1.189, 1.335, 1.5, 1.189, 1, 0.891, 1.189];
          const pitch = phrase[(bar * 2 + pos) % phrase.length];
          this.scoreNote(at, step * (pos === 7 ? 2.2 : 1.5), bus, base * pitch * 4, 0.065 * (pos === 5 ? 0.8 : 1) * intensity, true);
        }
        if (this.themePhase >= 2 && (pos === 1 || pos === 7))
          this.noise(at, 0.075, bus, { type: 'highpass', f0: 2100, gain: 0.035 });
        this.themeNext += step;
      }
    };
    schedule();
    this.themeTimer = setInterval(schedule, 180);
  }

  setBossPhase(phase: number): void {
    this.themePhase = phase;
  }

  stopBossTheme(): void {
    if (this.themeTimer) clearInterval(this.themeTimer);
    this.themeTimer = null;
    this.themeType = '';
    const bus = this.themeBus;
    this.themeBus = null;
    if (bus && this.ctx) {
      const t = this.ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0.0001, t + 0.5);
      setTimeout(() => bus.disconnect(), 1200);
    }
  }

  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
  }

  // ---------------------------------------------------------------- primitivas

  noise(t: number, dur: number, out: AudioNode, o: { type?: BiquadFilterType; f0: number; f1?: number; q?: number; gain: number; attack?: number }): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    const pm = this.pitchMul;
    f.frequency.setValueAtTime(o.f0 * pm, t);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * pm), t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(t: number, dur: number, out: AudioNode, o: { type?: OscillatorType; f0: number; f1?: number; gain: number; attack?: number; vib?: number; lp?: number }): void {
    const ctx = this.ctx as AudioContext;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    const pm = this.pitchMul;
    osc.frequency.setValueAtTime(o.f0 * pm, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * pm), t + dur);
    if (o.vib) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = o.vib;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      node = osc.connect(f);
    }
    node.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- reprodução

  /**
   * Toca um som. x,y opcionais (mundo) para atenuação/pan pela distância do ouvinte.
   * `pitch` (1 = original) desafina a receita; sons repetitivos ganham variação aleatória
   * automática (±7%) para não soarem como metralhadora de samples.
   */
  play(name: string, x?: number, y?: number, volume = 1, pitch?: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const r = RECIPES[name];
    if (!r) return;
    const now = ctx.currentTime;
    // limite de vozes: no máximo 4 simultâneas e 35 ms entre repetições
    const list = (this.voices.get(name) ?? []).filter((v) => v > now);
    const lastStart = list.length ? Math.max(...list) - (DUR[name] ?? 0.3) : -1;
    if (list.length >= 4 || now - lastStart < 0.035) return;
    list.push(now + (DUR[name] ?? 0.3));
    this.voices.set(name, list);
    let v = volume;
    let pan = 0;
    if (x !== undefined && y !== undefined) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const d = Math.hypot(dx, dy);
      v *= Math.max(0, 1 - d / 520);
      if (v < 0.03) return;
      pan = Math.max(-0.8, Math.min(0.8, dx / 320));
    }
    const isAlert = ALERTS.has(name);
    const bus = isAlert ? this.alert : UI_SOUNDS.has(name) ? this.ui : this.sfx;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(p).connect(bus);
    this.pitchMul = Math.max(0.5, Math.min(2, (pitch ?? 1) * (VARIED.has(name) ? 0.93 + Math.random() * 0.14 : 1)));
    try {
      r(this, now, g, v);
    } finally {
      this.pitchMul = 1;
    }
    if (isAlert) this.duck();
  }

  private duck(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = this.sfx.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(this.vol.sfx * 0.45, t);
    g.linearRampToValueAtTime(this.vol.sfx, t + 0.6);
  }

  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || this.ambStarted) return;
    this.ambStarted = true;
    // vento: ruído grave com LFO lento
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    this.windGain = g;
    this.windFilter = f;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.1;
    lfo.connect(lg).connect(g.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lg2 = ctx.createGain();
    lg2.gain.value = 140;
    lfo2.connect(lg2).connect(f.frequency);
    src.connect(f).connect(g).connect(this.amb);
    src.start();
    lfo.start();
    lfo2.start();
    // drone grave sombrio
    for (const fr of [55, 55.4, 82.5]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const og = ctx.createGain();
      og.gain.value = 0.035;
      o.connect(og).connect(this.amb);
      o.start();
    }
  }

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private stormOn = false;

  /** Nevasca / tempestade de cinzas: o vento do ambiente sobe e fica mais agudo. */
  setStorm(on: boolean): void {
    if (on === this.stormOn || !this.ctx || !this.windGain || !this.windFilter) return;
    this.stormOn = on;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(on ? 0.5 : 0.18, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(on ? 900 : 380, t, 0.8);
  }

  /** Estalos da fogueira, proporcionais à proximidade. */
  crackle(nearness: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || nearness <= 0.02) return;
    if (Math.random() > 0.25) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = nearness * 0.5;
    g.connect(this.amb);
    this.noise(t, 0.03 + Math.random() * 0.04, g, { type: 'highpass', f0: 1800 + Math.random() * 2000, gain: 0.5 });
  }
}

const DUR: Record<string, number> = { eliteDie: 0.5, madness: 1.8, army: 1.1, chapter: 3, raise: 0.6, howl: 1.3, ruptureCharge: 1.2, waveStart: 2, victory: 2.5, defeat: 2.5, feast: 1, endScream: 0.7, transform: 2, bossWarn: 1.2 };
const ALERTS = new Set(['bossWarn', 'waveStart', 'howl', 'transform', 'telegraph', 'down', 'deny', 'victory', 'defeat', 'lowHp']);
/** Sons que se repetem muito: ganham variação de tom a cada disparo. */
const VARIED = new Set(['hit', 'critHit', 'axeHit', 'swordHit', 'maceHit', 'clawHit', 'bite', 'heavyHit', 'swing', 'playerHit', 'enemyDie', 'pickup', 'essence', 'breakHit', 'break', 'dodge', 'crossbow', 'block', 'shieldBlock', 'guardianBlockPhysical', 'stagger', 'land']);
const UI_SOUNDS = new Set(['uiClick', 'uiHover', 'uiBack', 'upgrade']);

const RECIPES: Record<string, Recipe> = {
  // --- v1.2: Redemoinho Rubro
  vortex: (a, t, o) => {
    a.noise(t, 0.9, o, { f0: 300, f1: 1400, q: 1.1, gain: 0.3, attack: 0.08 });
    a.tone(t, 0.9, o, { type: 'sawtooth', f0: 90, f1: 140, gain: 0.08, lp: 700, vib: 9 });
  },
  vortexPulse: (a, t, o) => a.noise(t, 0.12, o, { type: 'bandpass', f0: 900, f1: 500, q: 2, gain: 0.3 }),
  // --- Acólito Sombrio: início, crescimento, sucesso e interrupção da Marcha Sombria
  marchStart: (a, t, o) => a.tone(t, 0.5, o, { type: 'triangle', f0: 180, f1: 240, gain: 0.12, attack: 0.1, vib: 6 }),
  marchGrow: (a, t, o) => {
    a.tone(t, 0.6, o, { type: 'triangle', f0: 240, f1: 360, gain: 0.12, attack: 0.05, vib: 10 });
    a.noise(t, 0.6, o, { type: 'lowpass', f0: 500, gain: 0.12, attack: 0.2 });
  },
  marchDone: (a, t, o) => {
    a.tone(t, 0.35, o, { type: 'square', f0: 120, f1: 60, gain: 0.14, lp: 900 });
    a.noise(t, 0.3, o, { type: 'lowpass', f0: 800, f1: 200, gain: 0.35 });
  },
  marchBreak: (a, t, o) => {
    a.noise(t, 0.18, o, { type: 'highpass', f0: 2500, gain: 0.35 });
    a.tone(t, 0.25, o, { type: 'triangle', f0: 520, f1: 140, gain: 0.12 });
  },
  // --- Caçador de Névoa: aviso espacial curto (vem do lado do salto) e pouso
  mistCue: (a, t, o) => {
    a.noise(t, 0.22, o, { f0: 2400, f1: 900, q: 1.5, gain: 0.3, attack: 0.02 });
    a.tone(t, 0.18, o, { type: 'triangle', f0: 880, f1: 1320, gain: 0.07 });
  },
  mistLand: (a, t, o) => {
    a.noise(t, 0.22, o, { type: 'lowpass', f0: 900, f1: 200, gain: 0.45 });
    a.tone(t, 0.18, o, { f0: 110, f1: 60, gain: 0.25 });
  },
  // --- Portador do Ossário: bloqueio seco e quebra forte
  shieldBlock: (a, t, o) => {
    a.noise(t, 0.05, o, { type: 'bandpass', f0: 1800, q: 3, gain: 0.45 });
    a.tone(t, 0.07, o, { type: 'square', f0: 320, f1: 260, gain: 0.08, lp: 1500 });
  },
  shieldBreak: (a, t, o) => {
    a.noise(t, 0.45, o, { type: 'bandpass', f0: 1200, f1: 300, q: 1.2, gain: 0.7 });
    a.tone(t, 0.35, o, { f0: 140, f1: 50, gain: 0.35 });
    a.noise(t + 0.08, 0.3, o, { type: 'highpass', f0: 3000, gain: 0.2 });
  },
  // --- Lapanha: arremesso (sopro), estouro de polpa (úmido e grave, sem tom cômico), carga, casca e Safra
  melonThrow: (a, t, o) => {
    a.noise(t, 0.14, o, { type: 'bandpass', f0: 700, f1: 1400, q: 1.2, gain: 0.22 });
    a.tone(t, 0.1, o, { type: 'triangle', f0: 220, f1: 330, gain: 0.05 });
  },
  melonBurst: (a, t, o) => {
    a.noise(t, 0.22, o, { type: 'lowpass', f0: 1400, f1: 300, gain: 0.5 });
    a.tone(t, 0.14, o, { f0: 140, f1: 70, gain: 0.2 });
    a.noise(t + 0.04, 0.12, o, { type: 'bandpass', f0: 2600, q: 2, gain: 0.12 });
  },
  melonBurstBig: (a, t, o) => {
    a.noise(t, 0.45, o, { type: 'lowpass', f0: 1100, f1: 160, gain: 0.8 });
    a.tone(t, 0.35, o, { f0: 90, f1: 40, gain: 0.4 });
    a.noise(t + 0.06, 0.25, o, { type: 'bandpass', f0: 2200, q: 1.5, gain: 0.2 });
  },
  melonCharge: (a, t, o) => a.tone(t, 1.1, o, { type: 'triangle', f0: 140, f1: 300, gain: 0.07, attack: 0.3, vib: 5 }),
  melonChargeMax: (a, t, o) => {
    a.tone(t, 0.2, o, { type: 'square', f0: 330, f1: 330, gain: 0.06, lp: 1400 });
    a.noise(t, 0.12, o, { type: 'highpass', f0: 3000, gain: 0.12 });
  },
  melonHeavyThrow: (a, t, o) => {
    a.noise(t, 0.25, o, { type: 'bandpass', f0: 500, f1: 1100, q: 1, gain: 0.35 });
    a.tone(t, 0.2, o, { type: 'triangle', f0: 160, f1: 240, gain: 0.08 });
  },
  peelPlace: (a, t, o) => a.noise(t, 0.08, o, { type: 'bandpass', f0: 900, q: 2.5, gain: 0.3 }),
  slip: (a, t, o) => {
    a.noise(t, 0.2, o, { type: 'bandpass', f0: 1600, f1: 500, q: 2, gain: 0.35 });
    a.noise(t + 0.18, 0.1, o, { type: 'lowpass', f0: 600, gain: 0.4 });
  },
  peelBurst: (a, t, o) => {
    a.noise(t, 0.3, o, { type: 'lowpass', f0: 1200, f1: 250, gain: 0.55 });
    a.noise(t + 0.03, 0.2, o, { type: 'bandpass', f0: 3000, q: 2, gain: 0.15 });
  },
  harvestStart: (a, t, o) => {
    a.noise(t, 0.12, o, { type: 'bandpass', f0: 1200, q: 2, gain: 0.25 });
    a.tone(t + 0.35, 0.5, o, { type: 'triangle', f0: 330, f1: 495, gain: 0.08, attack: 0.08 });
  },
  harvestEnd: (a, t, o) => a.tone(t, 0.35, o, { type: 'triangle', f0: 440, f1: 260, gain: 0.07 }),
  // --- Guardião v1.5: Martelo Sísmico
  maceQuake: (a, t, o) => {
    a.noise(t, 0.4, o, { type: 'lowpass', f0: 900, f1: 120, gain: 0.8 });
    a.tone(t, 0.35, o, { f0: 110, f1: 38, gain: 0.45 });
    a.noise(t + 0.03, 0.15, o, { type: 'bandpass', f0: 2400, q: 2, gain: 0.18 });
  },
  // --- Maycon: garrafa, vidro, fumaça, tapete e o gole da Rodada
  bottleThrow: (a, t, o) => a.noise(t, 0.12, o, { type: 'bandpass', f0: 900, f1: 1800, q: 1.4, gain: 0.2 }),
  bottleBreak: (a, t, o) => {
    a.noise(t, 0.16, o, { type: 'highpass', f0: 3200, gain: 0.45 });
    a.tone(t, 0.08, o, { type: 'triangle', f0: 2600, f1: 1900, gain: 0.07 });
    a.noise(t + 0.03, 0.12, o, { type: 'lowpass', f0: 900, gain: 0.25 });
  },
  chokeBurst: (a, t, o) => {
    a.noise(t, 0.5, o, { type: 'lowpass', f0: 1400, f1: 200, gain: 0.6 });
    a.noise(t + 0.05, 0.8, o, { type: 'bandpass', f0: 600, f1: 300, q: 0.8, gain: 0.25, attack: 0.08 });
  },
  carpetDash: (a, t, o) => {
    a.noise(t, 0.3, o, { type: 'bandpass', f0: 500, f1: 2200, q: 1.1, gain: 0.35 });
    a.tone(t, 0.25, o, { type: 'triangle', f0: 520, f1: 880, gain: 0.05, vib: 9 });
  },
  gulp: (a, t, o) => {
    for (let i = 0; i < 3; i++) a.tone(t + i * 0.17, 0.12, o, { type: 'sine', f0: 190, f1: 120, gain: 0.16 });
    a.noise(t + 0.55, 0.15, o, { type: 'bandpass', f0: 500, q: 2, gain: 0.25 });
  },
  brewBurst: (a, t, o) => {
    a.noise(t, 0.7, o, { type: 'lowpass', f0: 1800, f1: 160, gain: 0.85 });
    a.tone(t, 0.5, o, { f0: 120, f1: 45, gain: 0.4 });
    a.noise(t + 0.1, 0.9, o, { type: 'bandpass', f0: 1200, f1: 600, q: 0.7, gain: 0.25, attack: 0.1 });
  },
  // --- Jota: teclado, feixe de patch, /compact, /rewind, transformação e batarangues
  prompt: (a, t, o) => {
    a.noise(t, 0.03, o, { type: 'highpass', f0: 4200, gain: 0.3 });
    a.tone(t + 0.01, 0.07, o, { type: 'square', f0: 1040, f1: 1560, gain: 0.05, lp: 3000 });
  },
  patch: (a, t, o) => {
    a.tone(t, 0.22, o, { type: 'sawtooth', f0: 420, f1: 1700, gain: 0.07, lp: 2600 });
    a.noise(t, 0.2, o, { type: 'bandpass', f0: 2600, f1: 5200, q: 1.2, gain: 0.22 });
    a.tone(t + 0.1, 0.12, o, { type: 'square', f0: 1320, f1: 1980, gain: 0.04, lp: 3500 });
  },
  compact: (a, t, o) => {
    a.tone(t, 0.3, o, { f0: 160, f1: 60, gain: 0.4 });
    a.noise(t, 0.28, o, { type: 'lowpass', f0: 1600, f1: 200, gain: 0.45 });
    for (let i = 0; i < 4; i++) a.tone(t + 0.04 + i * 0.05, 0.06, o, { type: 'square', f0: 880 + i * 220, f1: 880 + i * 220, gain: 0.04, lp: 3200 });
  },
  rewind: (a, t, o) => {
    a.tone(t, 0.35, o, { type: 'sawtooth', f0: 1400, f1: 180, gain: 0.08, lp: 2200, vib: 14 });
    a.noise(t, 0.3, o, { type: 'bandpass', f0: 3200, f1: 500, q: 1.4, gain: 0.25 });
    a.tone(t + 0.3, 0.12, o, { type: 'triangle', f0: 330, f1: 660, gain: 0.08 });
  },
  batStart: (a, t, o) => {
    a.tone(t, 0.6, o, { type: 'sawtooth', f0: 70, f1: 150, gain: 0.12, lp: 600, attack: 0.3, vib: 5 });
    a.noise(t, 0.6, o, { type: 'bandpass', f0: 400, f1: 1800, q: 0.8, gain: 0.2, attack: 0.3 });
  },
  batTransform: (a, t, o) => {
    a.noise(t, 0.7, o, { type: 'lowpass', f0: 2200, f1: 120, gain: 0.85 });
    a.tone(t, 0.55, o, { f0: 98, f1: 40, gain: 0.45 });
    a.tone(t + 0.02, 0.8, o, { type: 'sawtooth', f0: 147, f1: 110, gain: 0.1, lp: 700 });
    a.tone(t + 0.02, 0.8, o, { type: 'sawtooth', f0: 196, f1: 146, gain: 0.07, lp: 700 });
    a.noise(t + 0.1, 0.5, o, { type: 'highpass', f0: 3500, gain: 0.15 });
  },
  batEnd: (a, t, o) => {
    a.tone(t, 0.4, o, { type: 'triangle', f0: 440, f1: 130, gain: 0.08 });
    a.noise(t, 0.3, o, { type: 'lowpass', f0: 1400, f1: 200, gain: 0.3 });
  },
  batarang: (a, t, o) => {
    a.noise(t, 0.15, o, { type: 'bandpass', f0: 1800, f1: 3400, q: 2.2, gain: 0.3 });
    a.tone(t, 0.12, o, { type: 'triangle', f0: 900, f1: 1500, gain: 0.04, vib: 30 });
  },
  fearBurst: (a, t, o) => {
    a.noise(t, 0.5, o, { type: 'lowpass', f0: 1100, f1: 160, gain: 0.55 });
    a.tone(t, 0.45, o, { type: 'sawtooth', f0: 240, f1: 90, gain: 0.07, lp: 700, vib: 8 });
  },
  grappleDash: (a, t, o) => {
    a.noise(t, 0.08, o, { type: 'highpass', f0: 3000, gain: 0.35 });
    a.noise(t + 0.04, 0.25, o, { type: 'bandpass', f0: 600, f1: 2600, q: 1.2, gain: 0.35 });
  },
  // --- Ferida Profana, atordoamento, cerco e escolta
  woundCharge: (a, t, o) => a.tone(t, 0.9, o, { type: 'sawtooth', f0: 110, f1: 180, gain: 0.07, lp: 900, attack: 0.2, vib: 7 }),
  woundCast: (a, t, o) => a.noise(t, 0.18, o, { type: 'bandpass', f0: 1400, f1: 700, q: 3, gain: 0.3 }),
  woundHit: (a, t, o) => {
    a.tone(t, 0.45, o, { type: 'sawtooth', f0: 220, f1: 90, gain: 0.12, lp: 1200 });
    a.noise(t, 0.25, o, { type: 'bandpass', f0: 800, q: 2, gain: 0.25 });
  },
  stun: (a, t, o) => {
    a.tone(t, 0.3, o, { type: 'triangle', f0: 1200, f1: 900, gain: 0.07, vib: 14 });
    a.noise(t, 0.15, o, { type: 'lowpass', f0: 700, gain: 0.35 });
  },
  siegeCharge: (a, t, o) => a.tone(t, 1.2, o, { type: 'triangle', f0: 90, f1: 150, gain: 0.08, attack: 0.4, vib: 4 }),
  siegeHit: (a, t, o) => {
    a.noise(t, 0.3, o, { type: 'lowpass', f0: 900, f1: 200, gain: 0.45 });
    a.tone(t, 0.25, o, { type: 'square', f0: 110, f1: 70, gain: 0.1, lp: 700 });
  },
  assaultHorn: (a, t, o) => {
    a.tone(t, 1.1, o, { type: 'sawtooth', f0: 110, f1: 104, gain: 0.14, lp: 700, attack: 0.15 });
    a.tone(t + 0.05, 1.0, o, { type: 'sawtooth', f0: 165, f1: 156, gain: 0.08, lp: 700, attack: 0.15 });
  },
  ambushWarn: (a, t, o) => {
    a.tone(t, 0.25, o, { type: 'triangle', f0: 660, f1: 520, gain: 0.08 });
    a.tone(t + 0.3, 0.25, o, { type: 'triangle', f0: 660, f1: 520, gain: 0.08 });
  },
  survivorAlarm: (a, t, o) => a.tone(t, 0.3, o, { type: 'square', f0: 880, f1: 700, gain: 0.05, lp: 2200 }),
  // --- combos entre classes
  comboFreeze: (a, t, o) => {
    a.tone(t, 0.3, o, { type: 'sine', f0: 1600, f1: 2200, gain: 0.1, vib: 22 });
    a.noise(t, 0.22, o, { type: 'highpass', f0: 3200, gain: 0.18 });
  },
  comboFollowUp: (a, t, o) => {
    a.tone(t, 0.16, o, { type: 'square', f0: 260, f1: 140, gain: 0.13, lp: 1000 });
    a.noise(t, 0.1, o, { type: 'lowpass', f0: 700, gain: 0.25 });
  },
  comboChain: (a, t, o) => a.noise(t, 0.18, o, { type: 'lowpass', f0: 800, f1: 180, gain: 0.3 }),
  comboMark: (a, t, o) => {
    a.tone(t, 0.16, o, { type: 'triangle', f0: 440, f1: 440, gain: 0.08 });
    a.tone(t + 0.1, 0.22, o, { type: 'triangle', f0: 660, f1: 660, gain: 0.08 });
  },
  comboExpose: (a, t, o) => a.noise(t, 0.2, o, { type: 'bandpass', f0: 1500, f1: 2600, q: 2, gain: 0.22 }),
  cardRare: (a, t, o) => {
    a.tone(t, 0.18, o, { type: 'triangle', f0: 523, f1: 523, gain: 0.07 });
    a.tone(t + 0.12, 0.3, o, { type: 'triangle', f0: 784, f1: 784, gain: 0.07 });
  },
  cardLegendary: (a, t, o) => {
    a.tone(t, 0.2, o, { type: 'triangle', f0: 392, f1: 392, gain: 0.08 });
    a.tone(t + 0.14, 0.2, o, { type: 'triangle', f0: 523, f1: 523, gain: 0.08 });
    a.tone(t + 0.28, 0.6, o, { type: 'triangle', f0: 784, f1: 784, gain: 0.09, vib: 5 });
    a.noise(t + 0.28, 0.4, o, { type: 'highpass', f0: 4000, gain: 0.08 });
  },
  guardianGuard: (a, t, o) => {
    a.tone(t, 0.36, o, { type: 'triangle', f0: 280, f1: 430, gain: 0.13, attack: 0.03, vib: 5 });
    a.noise(t, 0.2, o, { type: 'bandpass', f0: 900, f1: 1800, gain: 0.1 });
  },
  guardianBlockPhysical: (a, t, o) => {
    a.noise(t, 0.13, o, { type: 'lowpass', f0: 1000, f1: 240, gain: 0.42 });
    a.tone(t, 0.2, o, { type: 'triangle', f0: 230, f1: 100, gain: 0.19 });
  },
  guardianBlockProjectile: (a, t, o) => {
    a.tone(t, 0.22, o, { type: 'sine', f0: 750, f1: 260, gain: 0.19, vib: 15 });
    a.noise(t, 0.1, o, { type: 'highpass', f0: 2200, gain: 0.2 });
  },
  guardianBreak: (a, t, o) => {
    a.noise(t, 0.5, o, { type: 'bandpass', f0: 1900, f1: 260, gain: 0.5 });
    a.tone(t, 0.45, o, { type: 'sawtooth', f0: 290, f1: 60, gain: 0.21, lp: 900 });
  },
  guardianDash: (a, t, o) => {
    a.noise(t, 0.35, o, { type: 'bandpass', f0: 420, f1: 1200, gain: 0.25 });
    a.tone(t, 0.3, o, { type: 'triangle', f0: 110, f1: 210, gain: 0.14 });
  },
  guardianImpact: (a, t, o) => {
    a.noise(t, 0.24, o, { type: 'lowpass', f0: 1100, f1: 170, gain: 0.55 });
    a.tone(t, 0.28, o, { type: 'square', f0: 125, f1: 50, gain: 0.19, lp: 600 });
  },
  guardianCounter: (a, t, o) => {
    a.noise(t, 0.17, o, { type: 'bandpass', f0: 800, f1: 2200, gain: 0.32 });
    a.tone(t, 0.23, o, { type: 'triangle', f0: 440, f1: 180, gain: 0.19 });
  },
  guardianPlant: (a, t, o) => {
    a.tone(t, 0.65, o, { type: 'sawtooth', f0: 78, f1: 118, gain: 0.16, lp: 750, attack: 0.08 });
    a.noise(t + 0.12, 0.25, o, { type: 'lowpass', f0: 600, gain: 0.27 });
  },
  guardianBurst: (a, t, o) => {
    a.tone(t, 0.65, o, { type: 'sawtooth', f0: 180, f1: 48, gain: 0.25, lp: 1000 });
    a.noise(t, 0.56, o, { type: 'lowpass', f0: 1600, f1: 170, gain: 0.5 });
    a.tone(t + 0.05, 0.43, o, { type: 'triangle', f0: 510, f1: 125, gain: 0.16 });
  },
  // --- Berserker
  axeHit: (a, t, o) => {
    a.noise(t, 0.1, o, { type: 'lowpass', f0: 1400, f1: 300, gain: 0.55 });
    a.tone(t, 0.12, o, { type: 'square', f0: 160, f1: 70, gain: 0.2, lp: 900 });
  },
  axeHeavy: (a, t, o) => {
    a.noise(t, 0.28, o, { f0: 500, f1: 1800, q: 0.8, gain: 0.45 });
    a.tone(t + 0.05, 0.25, o, { f0: 110, f1: 45, gain: 0.35 });
  },
  frenzy: (a, t, o) => a.noise(t, 0.09, o, { f0: 1200, f1: 3200, q: 1.5, gain: 0.3 }),
  leap: (a, t, o) => a.noise(t, 0.35, o, { f0: 300, f1: 1400, q: 0.8, gain: 0.3, attack: 0.05 }),
  madness: (a, t, o) => {
    // rugido: sub-grave sustentado + serra subindo com vibrato + ruído grave descendo
    a.tone(t, 1.8, o, { type: 'sine', f0: 38, f1: 30, gain: 0.5, attack: 0.04 });
    a.tone(t, 1.6, o, { type: 'sawtooth', f0: 62, f1: 128, gain: 0.3, lp: 620, vib: 6, attack: 0.06 });
    a.tone(t + 0.08, 1.3, o, { type: 'square', f0: 96, f1: 74, gain: 0.14, lp: 900, vib: 11 });
    a.noise(t, 1.2, o, { type: 'lowpass', f0: 900, f1: 180, gain: 0.42, attack: 0.12 });
    a.noise(t + 0.5, 0.9, o, { type: 'bandpass', f0: 240, f1: 90, q: 2.5, gain: 0.26, attack: 0.2 });
  },
  // --- Necromante
  bone: (a, t, o) => {
    a.tone(t, 0.1, o, { type: 'triangle', f0: 900, f1: 500, gain: 0.18 });
    a.noise(t, 0.05, o, { type: 'highpass', f0: 3500, gain: 0.25 });
  },
  raise: (a, t, o) => {
    a.tone(t, 0.6, o, { type: 'sawtooth', f0: 90, f1: 220, gain: 0.16, lp: 900, attack: 0.1 });
    a.noise(t, 0.4, o, { type: 'lowpass', f0: 500, gain: 0.3, attack: 0.1 });
  },
  graveHand: (a, t, o) => {
    a.noise(t, 0.5, o, { type: 'lowpass', f0: 400, f1: 150, gain: 0.5 });
    a.tone(t, 0.4, o, { f0: 70, f1: 50, gain: 0.3 });
  },
  army: (a, t, o) => {
    a.tone(t, 1.1, o, { type: 'sawtooth', f0: 55, f1: 110, gain: 0.2, lp: 600, attack: 0.2, vib: 5 });
    a.tone(t, 1.1, o, { type: 'sawtooth', f0: 82, f1: 165, gain: 0.14, lp: 700, attack: 0.2 });
    a.noise(t, 0.9, o, { type: 'lowpass', f0: 300, gain: 0.35, attack: 0.3 });
  },
  essence: (a, t, o) => a.tone(t, 0.18, o, { f0: 700, f1: 1100, gain: 0.08, vib: 20 }),
  // --- mapa e objetivos
  breakHit: (a, t, o) => a.noise(t, 0.07, o, { type: 'bandpass', f0: 700, q: 2, gain: 0.4 }),
  break: (a, t, o) => {
    a.noise(t, 0.3, o, { type: 'bandpass', f0: 500, f1: 250, q: 1.5, gain: 0.6 });
    a.noise(t + 0.05, 0.2, o, { type: 'highpass', f0: 2000, gain: 0.2 });
  },
  pickup: (a, t, o) => {
    a.tone(t, 0.1, o, { type: 'triangle', f0: 660, gain: 0.14 });
    a.tone(t + 0.08, 0.16, o, { type: 'triangle', f0: 990, gain: 0.14 });
  },
  shards: (a, t, o) => {
    a.noise(t, 0.25, o, { type: 'highpass', f0: 5000, gain: 0.3 });
    a.tone(t, 0.2, o, { type: 'triangle', f0: 1800, f1: 2400, gain: 0.08 });
  },
  chapter: (a, t, o) => {
    a.tone(t, 3, o, { f0: 55, gain: 0.25, attack: 0.8 });
    a.tone(t, 3, o, { f0: 82.4, gain: 0.18, attack: 1 });
    a.tone(t + 0.4, 2.4, o, { type: 'triangle', f0: 440, gain: 0.05, attack: 0.3, vib: 3 });
    a.noise(t, 3, o, { type: 'lowpass', f0: 350, gain: 0.25, attack: 1 });
  },
  dodge: (a, t, o) => a.noise(t, 0.18, o, { f0: 700, f1: 2400, q: 1.2, gain: 0.35 }),
  crossbow: (a, t, o) => {
    a.noise(t, 0.05, o, { type: 'highpass', f0: 3000, gain: 0.4 });
    a.tone(t, 0.12, o, { type: 'triangle', f0: 320, f1: 140, gain: 0.3 });
  },
  crossbowHeavy: (a, t, o) => {
    a.noise(t, 0.08, o, { type: 'highpass', f0: 2500, gain: 0.5 });
    a.tone(t, 0.2, o, { type: 'square', f0: 260, f1: 90, gain: 0.2, lp: 1200 });
  },
  arcane: (a, t, o) => a.tone(t, 0.22, o, { f0: 520, f1: 880, gain: 0.25, vib: 30 }),
  arcaneBig: (a, t, o) => {
    a.tone(t, 0.35, o, { f0: 420, f1: 1100, gain: 0.3, vib: 50 });
    a.tone(t, 0.35, o, { type: 'triangle', f0: 210, f1: 550, gain: 0.2 });
  },
  ice: (a, t, o) => {
    a.noise(t, 0.4, o, { type: 'highpass', f0: 4000, gain: 0.25, attack: 0.02 });
    a.tone(t, 0.5, o, { f0: 1400, f1: 1800, gain: 0.1 });
  },
  ruptureCharge: (a, t, o) => a.tone(t, 1.2, o, { type: 'sawtooth', f0: 120, f1: 700, gain: 0.12, attack: 0.3, lp: 1500, vib: 12 }),
  rupture: (a, t, o) => {
    a.noise(t, 0.8, o, { type: 'lowpass', f0: 900, f1: 80, gain: 0.9 });
    a.tone(t, 0.6, o, { f0: 90, f1: 35, gain: 0.6 });
  },
  explosion: (a, t, o) => {
    a.noise(t, 0.6, o, { type: 'lowpass', f0: 700, f1: 60, gain: 0.8 });
    a.tone(t, 0.4, o, { f0: 80, f1: 30, gain: 0.5 });
  },
  trapSet: (a, t, o) => a.tone(t, 0.08, o, { type: 'square', f0: 900, f1: 600, gain: 0.12 }),
  trapSnap: (a, t, o) => {
    a.tone(t, 0.25, o, { type: 'square', f0: 1300, f1: 700, gain: 0.18, lp: 3000 });
    a.noise(t, 0.12, o, { type: 'highpass', f0: 2000, gain: 0.4 });
  },
  maceHit: (a, t, o) => {
    a.noise(t, 0.15, o, { type: 'lowpass', f0: 600, gain: 0.7 });
    a.tone(t, 0.18, o, { f0: 110, f1: 50, gain: 0.5 });
  },
  swordHit: (a, t, o) => {
    a.noise(t, 0.07, o, { type: 'highpass', f0: 2500, gain: 0.45 });
    a.tone(t, 0.15, o, { type: 'triangle', f0: 900, f1: 700, gain: 0.12 });
  },
  swordHeavy: (a, t, o) => {
    a.noise(t, 0.12, o, { type: 'bandpass', f0: 1800, q: 0.8, gain: 0.6 });
    a.tone(t, 0.2, o, { f0: 140, f1: 60, gain: 0.4 });
  },
  swing: (a, t, o) => a.noise(t, 0.12, o, { f0: 500, f1: 1600, q: 2, gain: 0.25 }),
  clawHit: (a, t, o) => {
    a.noise(t, 0.05, o, { f0: 1600, q: 2, gain: 0.45 });
    a.noise(t + 0.04, 0.05, o, { f0: 2100, q: 2, gain: 0.35 });
  },
  bite: (a, t, o) => {
    a.noise(t, 0.12, o, { type: 'lowpass', f0: 900, gain: 0.6 });
    a.tone(t, 0.1, o, { type: 'square', f0: 180, f1: 90, gain: 0.15, lp: 800 });
  },
  mist: (a, t, o) => a.noise(t, 0.35, o, { f0: 1800, f1: 400, q: 0.8, gain: 0.35, attack: 0.03 }),
  feast: (a, t, o) => {
    a.tone(t, 1, o, { type: 'sawtooth', f0: 110, gain: 0.12, attack: 0.2, lp: 700 });
    a.tone(t, 1, o, { type: 'sawtooth', f0: 111.5, gain: 0.12, attack: 0.2, lp: 700 });
    a.tone(t, 1, o, { f0: 330, f1: 220, gain: 0.08, attack: 0.1 });
  },
  fury: (a, t, o) => {
    a.tone(t, 0.6, o, { type: 'sawtooth', f0: 90, f1: 220, gain: 0.25, lp: 900 });
    a.noise(t, 0.4, o, { type: 'lowpass', f0: 300, f1: 1200, gain: 0.4 });
  },
  parryReady: (a, t, o) => a.tone(t, 0.05, o, { type: 'triangle', f0: 1200, gain: 0.08 }),
  parry: (a, t, o) => {
    a.tone(t, 0.5, o, { type: 'triangle', f0: 1560, gain: 0.3 });
    a.tone(t, 0.5, o, { type: 'triangle', f0: 2340, gain: 0.18 });
    a.noise(t, 0.06, o, { type: 'highpass', f0: 5000, gain: 0.6 });
  },
  block: (a, t, o) => {
    a.tone(t, 0.18, o, { type: 'square', f0: 330, f1: 260, gain: 0.15, lp: 1400 });
    a.noise(t, 0.08, o, { type: 'bandpass', f0: 1200, gain: 0.5 });
  },
  guardBreak: (a, t, o) => {
    a.noise(t, 0.4, o, { type: 'bandpass', f0: 900, f1: 200, gain: 0.8 });
    a.tone(t, 0.3, o, { type: 'square', f0: 400, f1: 80, gain: 0.2, lp: 1000 });
  },
  taunt: (a, t, o) => a.tone(t, 0.6, o, { type: 'sawtooth', f0: 150, f1: 175, gain: 0.25, attack: 0.05, lp: 900 }),
  bastion: (a, t, o) => {
    a.tone(t, 0.9, o, { f0: 220, gain: 0.2, attack: 0.1 });
    a.tone(t, 0.9, o, { f0: 330, gain: 0.15, attack: 0.2 });
    a.tone(t, 0.9, o, { f0: 440, gain: 0.1, attack: 0.3 });
  },
  shout: (a, t, o) => {
    a.tone(t, 0.22, o, { type: 'sawtooth', f0: 420, f1: 330, gain: 0.18, lp: 1600, vib: 25 });
    a.noise(t, 0.2, o, { f0: 1200, q: 3, gain: 0.25 });
  },
  shoutBig: (a, t, o) => {
    a.tone(t, 0.4, o, { type: 'sawtooth', f0: 520, f1: 300, gain: 0.25, lp: 2200, vib: 40 });
    a.noise(t, 0.35, o, { f0: 1400, q: 2, gain: 0.35 });
    a.tone(t, 0.4, o, { f0: 120, f1: 60, gain: 0.3 });
  },
  pulse: (a, t, o) => {
    a.tone(t, 0.35, o, { f0: 200, f1: 55, gain: 0.5 });
    a.noise(t, 0.2, o, { type: 'lowpass', f0: 800, gain: 0.3 });
  },
  polarity: (a, t, o) => a.tone(t, 0.8, o, { f0: 240, f1: 120, gain: 0.18, vib: 60, attack: 0.05 }),
  inhale: (a, t, o) => a.noise(t, 0.35, o, { f0: 400, f1: 1800, q: 1, gain: 0.3, attack: 0.3 }),
  endScream: (a, t, o) => {
    a.tone(t, 0.6, o, { type: 'sawtooth', f0: 600, f1: 350, gain: 0.3, lp: 2600, vib: 60 });
    a.noise(t, 0.5, o, { f0: 1500, q: 1.5, gain: 0.5 });
    a.tone(t, 0.6, o, { f0: 90, f1: 40, gain: 0.6 });
  },
  stagger: (a, t, o) => a.tone(t, 0.12, o, { type: 'square', f0: 200, f1: 120, gain: 0.1, lp: 900 }),
  playerHit: (a, t, o) => {
    a.noise(t, 0.12, o, { type: 'lowpass', f0: 700, gain: 0.5 });
    a.tone(t, 0.12, o, { f0: 160, f1: 90, gain: 0.3 });
  },
  heavyHit: (a, t, o) => {
    a.noise(t, 0.25, o, { type: 'lowpass', f0: 500, gain: 0.8 });
    a.tone(t, 0.25, o, { f0: 90, f1: 40, gain: 0.5 });
  },
  // golpe crítico: estalo agudo + corpo grave (camadas de impacto)
  critHit: (a, t, o) => {
    a.noise(t, 0.08, o, { type: 'bandpass', f0: 1500, q: 1.5, gain: 0.4 });
    a.tone(t, 0.14, o, { type: 'triangle', f0: 1400, f1: 2400, gain: 0.12 });
    a.tone(t, 0.18, o, { f0: 120, f1: 55, gain: 0.3 });
  },
  // morte de elite/chefe: baque grave com cauda
  eliteDie: (a, t, o) => {
    a.tone(t, 0.45, o, { f0: 95, f1: 32, gain: 0.5 });
    a.noise(t, 0.3, o, { type: 'lowpass', f0: 900, f1: 120, gain: 0.35 });
    a.noise(t + 0.02, 0.12, o, { type: 'highpass', f0: 2500, gain: 0.15 });
  },
  hit: (a, t, o) => a.noise(t, 0.06, o, { type: 'bandpass', f0: 1100, q: 1.5, gain: 0.35 }),
  death: (a, t, o) => a.tone(t, 0.8, o, { type: 'triangle', f0: 300, f1: 60, gain: 0.3 }),
  enemyDie: (a, t, o) => a.noise(t, 0.2, o, { type: 'lowpass', f0: 1200, f1: 200, gain: 0.35 }),
  orbCast: (a, t, o) => a.tone(t, 0.4, o, { f0: 420, f1: 300, gain: 0.15, vib: 40 }),
  slipper: (a, t, o) => {
    a.noise(t, 0.25, o, { f0: 900, f1: 1800, q: 2, gain: 0.3 });
    a.noise(t + 0.02, 0.05, o, { type: 'highpass', f0: 2500, gain: 0.5 });
  },
  howl: (a, t, o) => {
    const ctx = a.ctx as AudioContext;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.linearRampToValueAtTime(520, t + 0.4);
    osc.frequency.linearRampToValueAtTime(430, t + 1.2);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    osc.connect(f).connect(g).connect(o);
    osc.start(t);
    osc.stop(t + 1.35);
  },
  bossLeap: (a, t, o) => a.noise(t, 0.3, o, { f0: 400, f1: 1200, q: 1, gain: 0.4 }),
  bossLand: (a, t, o) => {
    a.noise(t, 0.6, o, { type: 'lowpass', f0: 400, f1: 50, gain: 1 });
    a.tone(t, 0.5, o, { f0: 70, f1: 30, gain: 0.7 });
  },
  bossDash: (a, t, o) => a.noise(t, 0.4, o, { f0: 300, f1: 1500, q: 0.7, gain: 0.5 }),
  burst: (a, t, o) => {
    a.tone(t, 0.5, o, { f0: 700, f1: 200, gain: 0.25, vib: 80 });
    a.noise(t, 0.3, o, { f0: 1500, q: 1, gain: 0.3 });
  },
  transform: (a, t, o) => {
    a.tone(t, 2, o, { type: 'sawtooth', f0: 55, f1: 40, gain: 0.35, attack: 0.3, lp: 400 });
    a.tone(t, 2, o, { type: 'sawtooth', f0: 82, f1: 60, gain: 0.25, attack: 0.5, lp: 500 });
    a.noise(t, 1.6, o, { type: 'lowpass', f0: 200, f1: 1200, gain: 0.4, attack: 1 });
  },
  bossWarn: (a, t, o) => {
    for (let i = 0; i < 3; i++) a.tone(t + i * 0.35, 0.3, o, { type: 'sawtooth', f0: 98, gain: 0.25, lp: 700 });
  },
  telegraph: (a, t, o) => a.tone(t, 0.12, o, { type: 'square', f0: 660, f1: 520, gain: 0.06, lp: 2000 }),
  waveStart: (a, t, o) => {
    a.tone(t, 2, o, { f0: 196, gain: 0.35, attack: 0.01 });
    a.tone(t, 2, o, { f0: 392, gain: 0.15, attack: 0.01 });
    a.tone(t, 1.6, o, { f0: 588, gain: 0.08, attack: 0.01 });
  },
  waveClear: (a, t, o) => {
    [523, 659, 784].forEach((f, i) => a.tone(t + i * 0.12, 0.5, o, { type: 'triangle', f0: f, gain: 0.18 }));
  },
  deny: (a, t, o) => a.tone(t, 0.12, o, { type: 'square', f0: 140, gain: 0.08, lp: 900 }),
  uiClick: (a, t, o) => a.tone(t, 0.05, o, { type: 'square', f0: 880, f1: 660, gain: 0.08, lp: 3000 }),
  uiHover: (a, t, o) => a.tone(t, 0.03, o, { type: 'square', f0: 1200, gain: 0.03, lp: 3000 }),
  uiBack: (a, t, o) => a.tone(t, 0.07, o, { type: 'square', f0: 500, f1: 350, gain: 0.08, lp: 2000 }),
  upgrade: (a, t, o) => [659, 880].forEach((f, i) => a.tone(t + i * 0.08, 0.3, o, { type: 'triangle', f0: f, gain: 0.15 })),
  revive: (a, t, o) => [440, 554, 659, 880].forEach((f, i) => a.tone(t + i * 0.08, 0.4, o, { type: 'triangle', f0: f, gain: 0.14 })),
  down: (a, t, o) => a.tone(t, 0.9, o, { type: 'triangle', f0: 440, f1: 110, gain: 0.3 }),
  lowHp: (a, t, o) => a.tone(t, 0.15, o, { f0: 60, gain: 0.4 }),
  spawn: (a, t, o) => a.noise(t, 0.5, o, { type: 'lowpass', f0: 150, gain: 0.35, attack: 0.1 }),
  ult: (a, t, o) => {
    a.tone(t, 0.6, o, { type: 'sawtooth', f0: 110, gain: 0.2, lp: 1200 });
    a.tone(t, 0.6, o, { type: 'sawtooth', f0: 165, gain: 0.15, lp: 1200 });
    a.tone(t, 0.6, o, { type: 'sawtooth', f0: 220, gain: 0.12, lp: 1400 });
  },
  victory: (a, t, o) => [392, 494, 587, 784].forEach((f, i) => a.tone(t + i * 0.2, 1.4, o, { type: 'triangle', f0: f, gain: 0.2 })),
  defeat: (a, t, o) => [220, 207, 196, 147].forEach((f, i) => a.tone(t + i * 0.35, 1.2, o, { type: 'sawtooth', f0: f, gain: 0.12, lp: 800 })),
  land: (a, t, o) => a.noise(t, 0.2, o, { type: 'lowpass', f0: 500, gain: 0.5 }),
  runeBlast: (a, t, o) => {
    a.tone(t, 0.3, o, { f0: 300, f1: 90, gain: 0.3, vib: 30 });
    a.noise(t, 0.2, o, { f0: 900, gain: 0.3 });
  },
};
RECIPES.eruptionBlast = RECIPES.explosion as Recipe;
RECIPES.dash = RECIPES.dodge as Recipe;
RECIPES.rainCall = RECIPES.crossbowHeavy as Recipe;

export const audio = new Audio();
