import type { SimEvent } from "../core/sim";

type V = { x: number; y: number; z: number };

/** Som sintetizado com WebAudio. Fontes espaciais usam HRTF para que a baliza e as entradas sejam localizáveis. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode; music!: GainNode; sfx!: GainNode; amb!: GainNode; voice!: GainNode;
  private noiseBuf!: AudioBuffer;
  private reverb!: ConvolverNode; private reverbSend!: GainNode;
  vol = { master: 0.8, music: 0.55, sfx: 0.9 };
  private musicLayers: { g: GainNode; target: number }[] = [];
  private rainGain: GainNode | null = null;
  private duck = 1;
  private musicTimer = 0;
  private step = 0;
  intensity = 0; // 0 exploração, 1 ameaça, 2 pico
  outdoors = 0;
  events: string[] = []; // registro de sons tocados (diagnóstico)

  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(comp);
    this.sfx = ctx.createGain(); this.sfx.connect(comp);
    this.amb = ctx.createGain(); this.amb.connect(comp);
    this.voice = ctx.createGain(); this.voice.connect(comp);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // reverberação curta de terminal azulejado
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2); }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.28;
    this.reverbSend.connect(this.reverb); this.reverb.connect(comp);
    this.applyVolumes();
    this.startAmbience();
    this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.music.gain.value = this.vol.music * 0.5;
  }

  setListener(pos: V, yaw: number, pitch: number) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02); l.forwardY.setTargetAtTime(fy, t, 0.02); l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      (l as any).setPosition(pos.x, pos.y, pos.z); (l as any).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Saída posicionada (HRTF) ou direta. */
  private out(pos?: V, gain = 1, refDist = 2, rev = true): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = refDist; p.rolloffFactor = 1.3; p.maxDistance = 60;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); p.connect(this.sfx);
      if (rev) p.connect(this.reverbSend);
    } else { g.connect(this.sfx); if (rev) g.connect(this.reverbSend); }
    return g;
  }

  private noise(dest: AudioNode, t0: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002, freqEnd?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }

  private tone(dest: AudioNode, t0: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number, attack = 0.003) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /** Batida cerâmica (o peso dentro do emissor e o acerto confirmado). */
  private ceramic(dest: AudioNode, t0: number, base: number, gain: number, dur = 0.25) {
    for (const [r, g] of [[1, 1], [2.76, 0.5], [5.4, 0.3], [8.9, 0.15]]) this.tone(dest, t0, dur / r ** 0.3, "sine", base * r, base * r * 0.99, gain * g, 0.001);
  }

  private bell(dest: AudioNode, t0: number, base: number, gain: number) {
    for (const [r, g, d] of [[0.5, 0.6, 3], [1, 1, 2.5], [1.19, 0.6, 2], [1.56, 0.4, 1.6], [2.0, 0.4, 1.2], [2.74, 0.25, 0.8]]) this.tone(dest, t0, d, "sine", base * r, base * r, gain * g, 0.002);
  }

  /** Acerto em carne/quitina: baque seco e úmido (sem tilintar de vidro). */
  private fleshHit(pos: any, t: number, gain: number) { const o = this.out(pos, gain); this.noise(o, t, 0.07, "bandpass", 1100, 1.4, 0.5); this.tone(o, t, 0.07, "sine", 220, 90, 0.35); }
  /** Morte orgânica: baque grave e um chiado que se esvai. */
  private organicKill(pos: any, t: number) { const k = this.out(pos, 0.9); this.tone(k, t + 0.03, 0.35, "sine", 140, 45, 0.6); this.noise(k, t + 0.03, 0.6, "lowpass", 700, 1, 0.7, 0.01, 200); this.noise(k, t + 0.2, 0.8, "bandpass", 2400, 0.8, 0.15, 0.1); }

  play(e: SimEvent) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.events.push(e.type);
    if (this.events.length > 200) this.events.shift();
    switch (e.type) {
      case "shot": if (e.weapon === "tear") {
        // Tear: fio esticado que estala (corda), sem estampido
        const o = this.out(undefined, 0.55);
        this.tone(o, t, 0.16, "triangle", 620, 1240, 0.35);
        this.tone(o, t, 0.25, "sine", 310, 300, 0.25);
        this.noise(o, t, 0.08, "bandpass", 3200, 3, 0.35);
        for (const h of (e.hits ?? []) as { killed: boolean; at: any }[]) { this.fleshHit(h.at, t + 0.03, 0.55); if (h.killed) this.organicKill(h.at, t); }
        break;
      } else if (e.weapon === "fole") {
        // Fole: estouro grave de ar comprimido + chiado dos fragmentos
        const o = this.out(undefined, 0.7);
        this.noise(o, t, 0.25, "lowpass", 900, 0.8, 0.9, 0.003, 300);
        this.tone(o, t, 0.18, "sine", 110, 40, 0.7);
        this.noise(o, t + 0.01, 0.12, "bandpass", 2600, 1.5, 0.35);
        this.noise(o, t + 0.28, 0.18, "bandpass", 700, 2, 0.25, 0.03); // fole enchendo de novo
        for (const _h of (e.hits ?? []) as { killed: boolean }[]) this.fleshHit(e.to, t + 0.03, 0.6);
        if (e.killed) this.organicKill(e.to, t);
        break;
      } else {
        const o = this.out(undefined, 0.5);
        this.tone(o, t, 0.09, "sawtooth", 2400, 500, 0.35);
        this.tone(o, t, 0.05, "square", 4800, 2200, 0.12);
        this.noise(o, t, 0.06, "highpass", 3000, 0.7, 0.4);
        this.tone(o, t, 0.12, "sine", 160, 60, 0.5);
        if (e.hit) { this.fleshHit(e.to, t + 0.02, 0.6); if (e.marked) this.tone(this.out(e.to, 0.5), t + 0.02, 0.2, "triangle", 1900, 1500, 0.2); }
        if (e.killed) this.organicKill(e.to, t);
        break;
      }
      case "mark": {
        const o = this.out(undefined, 0.5);
        this.tone(o, t, 0.08, "triangle", 1200, 1800, 0.4); this.tone(o, t + 0.07, 0.15, "triangle", 1800, 2600, 0.35);
        if (e.hit) this.ceramic(this.out(e.to, 0.5), t + 0.05, 1500, 0.4, 0.6);
        break;
      }
      case "dry": { const o = this.out(undefined, 0.6, 2, false); this.noise(o, t, 0.03, "bandpass", 2500, 4, 0.6); this.tone(o, t, 0.02, "square", 900, 700, 0.1); break; }
      case "reload": {
        const o = this.out(undefined, 0.5);
        this.noise(o, t, 0.05, "bandpass", 1800, 3, 0.5);
        this.noise(o, t + 0.35, 0.06, "bandpass", 1200, 3, 0.5);
        this.tone(o, t + 0.5, (e.time ?? 1.4) - 0.6, "sine", 300, 1600, 0.15, 0.2);
        this.noise(o, t + (e.time ?? 1.4) - 0.12, 0.08, "bandpass", 2600, 3, 0.7);
        break;
      }
      case "reloaded": { const o = this.out(undefined, 0.4); this.tone(o, t, 0.06, "square", 1600, 2000, 0.1); break; }
      case "switch": { const o = this.out(undefined, 0.4); this.noise(o, t, 0.1, "bandpass", 900, 2, 0.4); break; }
      case "step": {
        const o = this.out(undefined, e.sprint ? 0.35 : 0.22, 2, true);
        if (e.mat === "metal") { this.noise(o, t, 0.12, "bandpass", 1800 + Math.random() * 600, 6, 0.7); this.tone(o, t, 0.18, "triangle", 420 + Math.random() * 60, 380, 0.25); }
        else if (e.mat === "madeira") { this.noise(o, t, 0.08, "lowpass", 700, 1, 0.8); this.tone(o, t, 0.08, "sine", 140, 90, 0.4); }
        else if (e.mat === "azulejo") { this.noise(o, t, 0.05, "highpass", 2400, 1, 0.6); this.tone(o, t, 0.05, "sine", 220, 120, 0.35); this.noise(o, t + 0.02, 0.1, "bandpass", 600, 1, 0.15); }
        else { this.noise(o, t, 0.07, "lowpass", 1200, 1, 0.7); }
        break;
      }
      case "slide": { const o = this.out(undefined, 0.4); this.noise(o, t, 0.55, "bandpass", 1500, 1, 0.6, 0.02, 500); break; }
      case "hurt": {
        const o = this.out(undefined, 0.7, 2, false);
        this.tone(o, t, 0.25, "sine", 110, 50, 0.9); this.noise(o, t, 0.15, "lowpass", 800, 1, 0.6);
        break;
      }
      case "death": { const o = this.out(undefined, 0.8); this.tone(o, t, 1.6, "sawtooth", 220, 40, 0.3, 0.02); this.noise(o, t, 1.2, "lowpass", 600, 1, 0.5); break; }
      case "healStart": { const o = this.out(undefined, 0.4); this.noise(o, t, 0.5, "highpass", 4000, 1, 0.3, 0.05); this.tone(o, t + 0.45, 0.2, "sine", 880, 1320, 0.2); break; }
      case "pickup": { const o = this.out(undefined, 0.5); this.tone(o, t, 0.08, "triangle", 880, 880, 0.3); this.tone(o, t + 0.07, 0.12, "triangle", e.kind === "dardos" ? 1320 : 1100, e.kind === "dardos" ? 1320 : 1100, 0.3); break; }
      case "equip": { const o = this.out(undefined, 0.6); this.noise(o, t, 0.2, "bandpass", 1500, 2, 0.5); this.ceramic(o, t + 0.25, 900, 0.4, 0.5); this.ceramic(o, t + 0.55, 900, 0.4, 0.5); break; }
      case "beaconThrow": { const o = this.out(undefined, 0.4); this.noise(o, t, 0.35, "bandpass", 900, 2, 0.4, 0.05, 2500); break; }
      case "beaconLand": { const o = this.out(e.pos, 0.9, 3); this.noise(o, t, 0.08, "bandpass", 1400, 3, 0.8); this.ceramic(o, t + 0.01, 1100, 0.25, 0.2); break; }
      case "beaconInvalid": { const o = this.out(undefined, 0.4, 2, false); this.tone(o, t, 0.12, "square", 300, 220, 0.15); break; }
      case "beaconCall": {
        // o peso cerâmico bate duas vezes; o chamado pulsa no ponto do emissor
        const o = this.out(e.pos, 1.4, 4);
        this.ceramic(o, t, 520, 0.9, 0.6);
        this.ceramic(o, t + 0.32, 520, 1.0, 0.8);
        for (let i = 0; i < 5; i++) {
          const tt = t + 0.65 + i * 0.38;
          this.tone(o, tt, 0.34, "sine", 660, 610, 0.35, 0.02);
          this.tone(o, tt, 0.34, "triangle", 990, 920, 0.15, 0.02);
          this.noise(o, tt, 0.25, "bandpass", 3200, 8, 0.25);
        }
        break;
      }
      case "beaconReady": { const o = this.out(undefined, 0.5, 2, false); this.noise(o, t, 0.02, "bandpass", 3000, 5, 0.7); this.tone(o, t + 0.02, 0.05, "sine", 1800, 1800, 0.2); break; }
      case "beaconExpired": { const o = this.out(undefined, 0.3); this.tone(o, t, 0.2, "sine", 800, 400, 0.2); break; }
      case "scratch": case "scratch2": {
        const o = this.out(e.pos, 1.3, 2.5);
        this.noise(o, t, 0.22, "bandpass", 2600, 2, 0.9, 0.01, 1200);
        this.noise(o, t + 0.24, 0.2, "bandpass", 3000, 2, 0.8, 0.01, 1400);
        break;
      }
      case "leap": { const o = this.out(e.pos, 1.2, 3); this.tone(o, t, 0.35, "sawtooth", 900, 2400, 0.25, 0.02); this.noise(o, t, 0.3, "highpass", 5000, 1, 0.4); break; }
      case "land": { const o = this.out(e.pos, 0.8, 2); this.noise(o, t, 0.25, "lowpass", 900, 1, 0.7); break; }
      case "lured": { const o = this.out(e.pos, 0.6, 2); this.tone(o, t, 0.25, "triangle", 1300, 1900, 0.15, 0.02); break; }
      case "estAim": {
        const o = this.out(e.pos, 1.2, 4);
        this.tone(o, t, 0.9, "sawtooth", 300, 1400, 0.2, 0.1);
        this.tone(o, t, 0.9, "sine", 600, 2800, 0.15, 0.1);
        break;
      }
      case "estFire": { const o = this.out(e.pos, 1.2, 4); this.noise(o, t, 0.2, "bandpass", 3600, 3, 0.9); this.ceramic(o, t, 1300, 0.4, 0.3); this.tone(o, t, 0.3, "sawtooth", 500, 120, 0.3); break; }
      case "projHit": { const o = this.out(e.pos, 0.8, 3); this.noise(o, t, 0.25, "bandpass", 2000, 2, 0.7); break; }
      case "spawn": { if (e.ctype) { const o = this.out(e.pos, 0.7, 3); this.noise(o, t, 0.6, "bandpass", 700, 2, 0.4, 0.1, 2400); } break; }
      case "doorVibrate": {
        const o = this.out(e.pos, 1.5, 5);
        for (let i = 0; i < 9; i++) this.noise(o, t + i * 0.11, 0.1, "bandpass", 250 + Math.random() * 200, 4, 0.8);
        this.tone(o, t, 1.0, "sawtooth", 55, 70, 0.4, 0.1);
        break;
      }
      case "doorOpen": { const o = this.out(e.pos, 1.0, 4); this.noise(o, t, 0.8, "lowpass", 400, 1, 0.6, 0.05, 1500); this.tone(o, t, 0.3, "square", 90, 60, 0.15); break; }
      case "latchOpen": { const o = this.out(e.pos, 1.2, 3); this.tone(o, t, 0.1, "square", 880, 880, 0.2); this.tone(o, t + 0.12, 0.2, "square", 1320, 1320, 0.2); this.noise(o, t + 0.3, 0.15, "lowpass", 600, 1, 0.9); break; }
      case "bell": { const o = this.out(e.pos, 0.9, 5); this.bell(o, t, 392, 0.4); this.bell(o, t + 0.45, 466, 0.3); this.bell(o, t + 0.9, 349, 0.35); break; }
      case "panel": {
        const o = this.out(undefined, 0.7);
        [523, 659, 784, 1046].forEach((f, i) => this.tone(o, t + i * 0.12, 0.15, "square", f, f, 0.15));
        this.noise(o, t + 0.6, 0.3, "lowpass", 500, 1, 0.9);
        // buzina da balsa
        const h = this.out({ x: 50, y: 5, z: -42 }, 2.5, 30);
        for (const f of [98, 123, 147]) this.tone(h, t + 1.2, 2.6, "sawtooth", f, f * 0.99, 0.18, 0.25);
        break;
      }
      case "lightOn": { const o = this.out(undefined, 0.3); this.noise(o, t, 0.05, "bandpass", 3000, 4, 0.5); this.tone(o, t, 0.4, "sine", 120, 120, 0.15, 0.01); break; }
      case "subtitle": {
        const o = this.voice;
        this.noise(o, t, 0.12, "bandpass", 2200, 1, 0.12);
        this.noise(o, t + Math.min(4, e.dur ?? 3), 0.1, "bandpass", 2200, 1, 0.08);
        this.duck = 0.45; setTimeout(() => (this.duck = 1), (e.dur ?? 3) * 1000);
        break;
      }
      case "save": { const o = this.out(undefined, 0.3, 2, false); this.tone(o, t, 0.2, "sine", 660, 660, 0.15); this.tone(o, t + 0.15, 0.3, "sine", 990, 990, 0.12); break; }
      case "arenaStart": this.intensity = 2; break;
      case "arenaCleared": this.intensity = 0; break;
      case "levelComplete": { const o = this.out(undefined, 0.6); [392, 523, 659, 784].forEach((f, i) => this.tone(o, t + i * 0.18, 0.6, "triangle", f, f, 0.2)); break; }
      case "sopro": { const o = this.out(undefined, 0.6); this.noise(o, t, 0.7, "bandpass", 500, 0.7, 0.8, 0.04, 1800); this.noise(o, t + 0.05, 0.5, "highpass", 2500, 0.5, 0.25, 0.05); break; }
      case "veuSwell": { const o = this.out(e.pos, 0.8, 4); this.tone(o, t, 1.1, "sine", 180, 360, 0.25, 0.3); this.noise(o, t, 1.1, "bandpass", 800, 3, 0.25, 0.4, 1600); break; }
      case "cloud": { const o = this.out(e.pos, 0.9, 5); this.noise(o, t, 1.4, "lowpass", 1200, 0.7, 0.6, 0.02, 300); break; }
      case "cloudGone": { const o = this.out(undefined, 0.3); this.noise(o, t, 0.6, "highpass", 3000, 0.7, 0.2, 0.05); break; }
      case "valve": { const o = this.out(e.pos, 1.0, 3); for (let i = 0; i < 4; i++) this.noise(o, t + i * 0.22, 0.16, "bandpass", 500 + i * 60, 4, 0.6); this.tone(o, t + 0.95, 0.5, "sine", 70, 50, 0.4, 0.05); break; }
      case "gateStart": { const o = this.out(undefined, 0.5); this.tone(o, t, 0.25, "square", 440, 440, 0.12); this.noise(o, t, 2.5, "lowpass", 180, 1, 0.5, 0.4, 260); break; }
      case "gateSegment": { const o = this.out(undefined, 0.5, 2, false); const f = 523 + (e.n - 1) * 131; this.tone(o, t, 0.18, "triangle", f, f, 0.25); this.noise(o, t, 0.4, "lowpass", 220, 1, 0.4); break; }
      case "gateOpen": { const o = this.out(undefined, 0.7); this.tone(o, t, 0.5, "triangle", 784, 784, 0.2); this.tone(o, t + 0.15, 0.6, "triangle", 1046, 1046, 0.2); this.noise(o, t, 1.6, "lowpass", 300, 1, 0.8, 0.05, 900); break; }
      case "tearLine": { const o = this.out(undefined, 0.5); this.tone(o, t, 0.4, "triangle", 440, 880, 0.25, 0.02); this.tone(o, t + 0.05, 0.6, "sine", 880, 870, 0.15, 0.05); break; }
      case "tearLineHit": { const o = this.out(e.pos, 0.9, 3); this.noise(o, t, 0.2, "bandpass", 1600, 2, 0.7); this.tone(o, t, 0.3, "triangle", 900, 300, 0.3); break; }
      case "tearInvalid": { const o = this.out(undefined, 0.4, 2, false); this.tone(o, t, 0.12, "square", 300, 220, 0.15); break; }
      case "carStomp": { const o = this.out(e.pos, 1.3, 5); for (let i = 0; i < 3; i++) { this.tone(o, t + i * 0.3, 0.25, "sine", 70, 40, 0.7); this.noise(o, t + i * 0.3, 0.2, "lowpass", 300, 1, 0.6); } break; }
      case "carCharge": { const o = this.out(e.pos, 1.2, 5); this.tone(o, t, 0.6, "sawtooth", 90, 160, 0.35, 0.05); this.noise(o, t, 0.8, "lowpass", 500, 1, 0.5, 0.05, 900); break; }
      case "carSlam": { const o = this.out(e.pos, 1.5, 6); this.tone(o, t, 0.5, "sine", 80, 30, 0.9); this.noise(o, t, 0.5, "lowpass", 1200, 1, 0.9); if (e.batente) this.tone(o, t, 0.6, "square", 220, 180, 0.15); break; }
      case "carOpen": { const o = this.out(e.pos, 1.0, 4); this.noise(o, t, 0.5, "bandpass", 600, 2, 0.6, 0.05); this.tone(o, t, 0.5, "sawtooth", 160, 90, 0.2); break; }
      case "badaloTilt": { const o = this.out(e.pos, 1.0, 8); this.bell(o, t, 98, 0.5); this.noise(o, t, 1.0, "lowpass", 300, 1, 0.4, 0.3); break; }
      case "badaloLock": { const o = this.out(e.pos, 0.9, 8); this.tone(o, t, 0.3, "square", 330, 330, 0.12); this.tone(o, t + 0.15, 0.3, "square", 330, 330, 0.12); break; }
      case "badaloSlam": case "badaloStuck": { const o = this.out(e.pos, 1.6, 10); this.bell(o, t, 73, 0.9); this.tone(o, t, 0.9, "sine", 55, 30, 1.0); this.noise(o, t, 0.8, "lowpass", 900, 1, 1.0); break; }
      case "badaloRise": { const o = this.out(undefined, 0.6); this.noise(o, t, 1.4, "lowpass", 400, 1, 0.4, 0.2, 200); this.tone(o, t, 1.4, "sine", 60, 90, 0.25, 0.3); break; }
      case "badaloWaveWarn": { const o = this.out(e.pos, 1.0, 8); this.tone(o, t, 1.1, "sawtooth", 50, 140, 0.3, 0.6); break; }
      case "badaloWave": { const o = this.out(e.pos, 1.4, 10); this.bell(o, t, 110, 0.8); this.noise(o, t, 1.0, "lowpass", 700, 1, 0.8, 0.01, 200); break; }
      case "badaloHalf": { const o = this.out(undefined, 0.8); this.noise(o, t, 0.9, "bandpass", 700, 1, 0.7); this.tone(o, t, 1.2, "sawtooth", 140, 60, 0.3); break; }
      case "bossStart": this.intensity = 2; break;
      case "bossDead": { this.intensity = 0; const o = this.out(undefined, 0.8); this.bell(o, t, 65, 1); this.bell(o, t + 0.8, 49, 0.8); this.noise(o, t, 2.5, "lowpass", 400, 1, 0.8, 0.1, 150); break; }
      case "pump": { const o = this.out(e.pos, 1.2, 6); for (let i = 0; i < 4; i++) this.noise(o, t + i * 0.2, 0.15, "bandpass", 450 + i * 50, 4, 0.6); this.tone(o, t + 0.8, 1.6, "sawtooth", 40, 60, 0.25, 0.4); break; }
      case "jet": { const o = this.out(undefined, 0.6); this.noise(o, t, 1.6, "highpass", 1500, 0.7, 0.6, 0.05, 600); break; }
      case "dispense": { const o = this.out(undefined, 0.5); this.noise(o, t, 0.12, "bandpass", 1500, 3, 0.6); this.tone(o, t + 0.1, 0.08, "square", 1200, 1200, 0.15); this.noise(o, t + 0.2, 0.15, "bandpass", 1100, 3, 0.5); break; }
      case "doorClose": { const o = this.out(undefined, 0.8); this.noise(o, t, 0.8, "lowpass", 400, 1, 0.7, 0.02, 1500); this.tone(o, t + 0.7, 0.4, "square", 70, 50, 0.3); break; }
      case "denied": { const o = this.out(undefined, 0.4, 2, false); this.tone(o, t, 0.15, "square", 220, 200, 0.12); this.tone(o, t + 0.16, 0.15, "square", 180, 170, 0.12); break; }
    }
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // chuva e mar: ruído filtrado, mais forte em áreas abertas
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.4;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0.05;
    src.connect(f); f.connect(this.rainGain); this.rainGain.connect(this.amb); src.start();
    const sea = ctx.createBufferSource(); sea.buffer = this.noiseBuf; sea.loop = true; sea.playbackRate.value = 0.5;
    const sf = ctx.createBiquadFilter(); sf.type = "lowpass"; sf.frequency.value = 300;
    const sg = ctx.createGain(); sg.gain.value = 0.06;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.04; lfo.connect(lg); lg.connect(sg.gain); lfo.start();
    sea.connect(sf); sf.connect(sg); sg.connect(this.amb); sea.start();
    // zumbido das lâmpadas
    const hum = ctx.createOscillator(); hum.frequency.value = 120; const hg = ctx.createGain(); hg.gain.value = 0.008; hum.connect(hg); hg.connect(this.amb); hum.start();
  }

  private startMusic() {
    const ctx = this.ctx!;
    // três camadas: exploração, ameaça e pico
    for (let i = 0; i < 3; i++) { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.music); this.musicLayers.push({ g, target: 0 }); }
    // camada 0: drone grave e acordes lentos
    const pad = (f: number, det: number) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380; lp.Q.value = 0.7; const g = ctx.createGain(); g.gain.value = 0.05; o.connect(lp); lp.connect(g); g.connect(this.musicLayers[0].g); o.start(); };
    pad(55, 0); pad(55, 7); pad(82.4, -5); pad(130.8, 4);
  }

  /** Chamado por quadro: mixagem adaptativa e sequenciador simples. */
  update(dt: number, ctxInfo: { danger: number; outdoors: boolean; paused: boolean }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const lvl = Math.max(this.intensity === 2 ? 2 : 0, ctxInfo.danger);
    const targets = [1, lvl >= 1 ? 0.9 : 0, lvl >= 2 ? 1 : 0];
    this.musicLayers.forEach((l, i) => l.g.gain.setTargetAtTime(ctxInfo.paused ? targets[i] * 0.3 : targets[i] * this.duck, t, 0.6));
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(ctxInfo.outdoors ? 0.12 : 0.03, t, 0.5);
    // sequenciador: ostinato (ameaça) e percussão (pico)
    this.musicTimer -= dt;
    if (this.musicTimer <= 0 && !ctxInfo.paused) {
      this.musicTimer = 0.25;
      this.step = (this.step + 1) % 16;
      const notes = [110, 110, 130.8, 110, 116.5, 110, 98, 110];
      const f = notes[this.step % 8];
      if (this.musicLayers[1].g.gain.value > 0.02) this.tone(this.musicLayers[1].g, t, 0.22, "triangle", f, f, 0.18);
      if (this.musicLayers[2].g.gain.value > 0.02) {
        if (this.step % 4 === 0) { this.tone(this.musicLayers[2].g, t, 0.25, "sine", 90, 40, 0.6); }
        if (this.step % 4 === 2) this.noise(this.musicLayers[2].g, t, 0.08, "highpass", 6000, 1, 0.15);
        if (this.step % 8 === 6) this.tone(this.musicLayers[2].g, t, 0.4, "sawtooth", 233, 220, 0.06);
      }
      if (this.step === 0 && Math.random() < 0.35) this.bell(this.musicLayers[0].g, t, 196, 0.05);
    }
  }
}
