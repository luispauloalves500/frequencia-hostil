import "./style.css";
import { DT, WEAPONS, type Difficulty } from "./config";
import { FixedStep } from "./core/fixedStep";
import { Sim, type SimEvent, emptyFrame } from "./core/sim";
import { SaveStore, browserKV, type Checkpoint, type SaveData } from "./core/save";
import { Renderer, type Quality } from "./render/renderer";
import { AudioEngine } from "./audio/audio";
import { Input } from "./input";
import { Autopilot } from "./autopilot";
import { F1 } from "./levels/f1";
import { makeLab, type LabStage } from "./levels/lab";
import { F2 } from "./levels/f2";
import { F3 } from "./levels/f3";
import { defaultF2Entry as f2Entry, defaultF3Entry as f3Entry, f2EntryFromF1, f3EntryFromF2, migrateCheckpoint } from "./core/progress";
import type { LevelDef } from "./levels/types";
import { angleDiff, yawTo } from "./core/math";
import * as UI from "./ui/dom";
import { PlanRunner, tutorialToShelter, dieInWave2, finishPraca, quickOpening, f2Full, f2TakeFole, f2LowPassage, f2HighRoute, f2Praca, f2Boia, f3Full, f3TakeTear, f3Filtros, f3Batente, f3Galeria, f3Boss, f3Exit, type Plan } from "./scenarios";

export const BUILD = { version: "0.5.0", milestone: "D05" };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const LAB = params.get("sala") as LabStage | null;

interface Options { sens: number; fov: number; invert: boolean; master: number; music: number; sfx: number; quality: Quality; reduce: boolean; subBg: boolean; text: string; perf: "auto" | "max" }
const DEFAULT_OPTS: Options = { sens: 1, fov: 75, invert: false, master: 0.8, music: 0.55, sfx: 0.9, quality: "media", reduce: false, subBg: false, text: "1", perf: "auto" };

type GState = "menu" | "loading" | "playing" | "paused" | "dead" | "result";

function levelById(id: string): LevelDef {
  if (id === "F2" || id === "F2P") return F2; // "F2P" = registro da prévia antiga
  if (id === "F3") return F3;
  if (id === "LAB") return makeLab(LAB ?? "d02");
  return F1;
}

class Game {
  state: GState = "menu";
  sim: Sim | null = null;
  renderer: Renderer;
  audio = new AudioEngine();
  input: Input;
  store = new SaveStore(browserKV());
  opts: Options;
  fixed = new FixedStep();
  replay = false;
  lastCp: Checkpoint | null = null;
  difficulty: Difficulty = "normal";
  transitioning = false;
  timeScale = 1;
  auto: Autopilot | null = null;
  plan: PlanRunner | null = null;
  eventLog: SimEvent[] = [];
  private last = performance.now();
  private subLines: { el: HTMLElement; t: number }[] = [];
  private dirInd: { el: HTMLElement; pos: { x: number; y: number; z: number }; t: number }[] = [];
  private dmgInd: { el: HTMLElement; ang: number; t: number }[] = [];
  private toastT = 0;
  private hitT = 0;
  private hurtT = 0;
  private deathTimer = -1;
  private pauseReason = "";
  showDiag = DEBUG;
  stats = { frames: 0, frameTimes: new Array<number>(120).fill(16.7) };
  /** Resolução adaptativa: só age quando os quadros ficam lentos de forma sustentada. */
  perf = { ema: 16.7, slowT: 0, fastT: 0, upWait: 6, changes: 0 };
  adaptResolution(ms: number) {
    const P = this.perf, R = this.renderer;
    // > 1 s é aba escondida/travada pontual: ignora; o resto entra limitado a 100 ms para não disparar por um pico só
    if (this.opts.perf !== "auto" || this.state !== "playing" || ms > 1000 || ms <= 0) { P.slowT = P.fastT = 0; return; }
    ms = Math.min(ms, 100);
    P.ema += (ms - P.ema) * 0.08;
    const s = ms / 1000;
    if (P.ema > 21) { P.slowT += s; P.fastT = 0; } else if (P.ema < 17.8) { P.fastT += s; P.slowT = 0; } else { P.slowT = Math.max(0, P.slowT - s); P.fastT = 0; }
    if (P.slowT > 1.5 && R.renderScale > 0.6) {
      R.setRenderScale(R.renderScale - 0.1); P.slowT = 0; P.changes++;
      P.upWait = Math.min(60, P.upWait * 1.5); // se subir e voltar a pesar, espera mais antes de tentar de novo
    } else if (P.fastT > P.upWait && R.renderScale < 1) {
      R.setRenderScale(R.renderScale + 0.05); P.fastT = 0; P.changes++;
    }
  }
  menuStack: string[] = [];

  constructor() {
    const canvas = $<HTMLCanvasElement>("view");
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.input.emulateLock = DEBUG;
    if (DEBUG) { this.fixed.maxSteps = 40; this.fixed.clamp = 0.7; }
    this.opts = this.loadOptions();
    this.applyOptions();
    this.renderer.setQuality(this.opts.quality);
    window.addEventListener("resize", () => this.renderer.resize());
    this.input.onLockChange = (l) => { if (!l && this.state === "playing") this.pause("mouse liberado"); };
    this.input.onEscape = () => { if (this.state === "playing") { this.pause("Esc"); this.input.releaseLock(); } };
    this.input.onKey = (c) => { if (c === "F3") { this.showDiag = !this.showDiag; } };
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "playing") { this.pause("aba oculta"); this.input.releaseLock(); } });
    window.addEventListener("blur", () => { if (this.state === "playing" && !DEBUG) { this.pause("foco perdido"); this.input.releaseLock(); } });
    this.bindUI();
    // cena do menu: a praça e a balsa ao fundo
    this.renderer.menuMode = true;
    this.renderer.buildLevel(F1);
    $("buildTag").textContent = `v${BUILD.version} • ${BUILD.milestone}${LAB ? ` • sala de teste ${LAB.toUpperCase()}` : ""}`;
    this.showMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- opções ----------
  loadOptions(): Options {
    try { const r = localStorage.getItem("fh.options"); if (r) return { ...DEFAULT_OPTS, ...JSON.parse(r) }; } catch { /* sem armazenamento */ }
    return { ...DEFAULT_OPTS };
  }
  saveOptions() { try { localStorage.setItem("fh.options", JSON.stringify(this.opts)); } catch { /* sem armazenamento */ } }
  applyOptions() {
    const o = this.opts;
    this.audio.vol = { master: o.master, music: o.music, sfx: o.sfx }; this.audio.applyVolumes();
    this.renderer.fov = o.fov; this.renderer.reduceShake = o.reduce;
    if (o.perf !== "auto") this.renderer.setRenderScale(1);
    $("subtitles").classList.toggle("opaque", o.subBg);
    document.documentElement.style.setProperty("--ui-scale", o.text);
  }

  // ---------- telas ----------
  screens = ["menu", "difficulty", "select", "options", "credits", "loading", "pause", "death", "result", "clickResume"];
  show(id: string | null) {
    for (const s of this.screens) $(s).classList.toggle("hidden", s !== id);
    $("hud").classList.toggle("hidden", !(this.state === "playing" || this.state === "paused" || this.state === "dead"));
    if (id) { const b = $(id).querySelector("button:not(:disabled)") as HTMLButtonElement | null; b?.focus(); }
  }

  showMenu() {
    this.state = "menu";
    this.renderer.menuMode = true;
    if (this.renderer.level?.id !== "F1") this.renderer.buildLevel(F1);
    const save = this.loadSave();
    const cont = $<HTMLButtonElement>("btnContinue");
    cont.disabled = !save;
    $<HTMLButtonElement>("btnSelect").disabled = !(save?.completed.includes("F1"));
    $("continueInfo").textContent = save ? `Último registro: ${save.checkpoint.phase === "F3" ? "F3 • Casa das Bombas" : save.checkpoint.phase === "F2" ? "F2 • Mercado Afogado" : "F1 • Última Chamada"} • ${save.checkpoint.point} • ${({ historia: "História", normal: "Normal", intenso: "Intenso" } as const)[save.checkpoint.difficulty]}` : this.store.sessionOnly ? "Progresso disponível apenas nesta sessão" : "";
    this.show("menu");
  }

  bindUI() {
    document.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => { this.audio.ensure(); this.act(b.dataset.act!, b); }));
    document.querySelectorAll<HTMLButtonElement>("button[data-diff]").forEach((b) => b.addEventListener("click", () => { this.audio.ensure(); this.newGame(b.dataset.diff as Difficulty); }));
    $("clickResume").addEventListener("click", () => this.resume());
    const bind = (id: string, key: keyof Options, fmt = (v: number) => v.toFixed(2)) => {
      const el = $<HTMLInputElement>(id);
      const out = el.parentElement!.querySelector("output");
      if (el.type === "checkbox") el.checked = this.opts[key] as boolean; else el.value = String(this.opts[key]);
      if (out) out.textContent = fmt(Number(el.value));
      el.addEventListener("input", () => {
        (this.opts as any)[key] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value);
        if (out) out.textContent = fmt(Number(el.value));
        this.applyOptions(); this.saveOptions();
        if (key === "quality") this.renderer.setQuality(this.opts.quality);
      });
    };
    bind("optSens", "sens"); bind("optFov", "fov", (v) => String(v)); bind("optInvert", "invert"); bind("optMaster", "master"); bind("optMusic", "music"); bind("optSfx", "sfx");
    bind("optQuality", "quality"); bind("optReduce", "reduce"); bind("optSubBg", "subBg"); bind("optText", "text"); bind("optPerf", "perf");
  }

  act(a: string, _b?: HTMLButtonElement) {
    switch (a) {
      case "new": if (LAB) this.startLab(); else { this.menuStack = ["menu"]; this.show("difficulty"); } break;
      case "continue": this.continueGame(); break;
      case "select": this.buildSelect(); this.menuStack = ["menu"]; this.show("select"); break;
      case "options": this.menuStack.push(this.state === "paused" ? "pause" : "menu"); this.show("options"); break;
      case "credits": this.menuStack = ["menu"]; this.show("credits"); break;
      case "back": { const prev = this.menuStack.pop() ?? (this.state === "paused" ? "pause" : "menu"); if (prev === "menu") this.showMenu(); else this.show(prev); break; }
      case "resume": this.resume(); break;
      case "menu": this.toMenu(); break;
      case "retry": this.retry(); break;
      case "next": this.goNext(); break;
    }
  }

  buildSelect() {
    const list = $("selectList"); list.innerHTML = "";
    const save = this.loadSave();
    const add = (label: string, fn: () => void, enabled = true) => { const b = document.createElement("button"); b.innerHTML = label; b.disabled = !enabled; b.onclick = () => { this.audio.ensure(); fn(); }; list.appendChild(b); };
    add("F1 • Última Chamada <small>repetição • 8–10 min</small>", () => { this.replay = true; this.startLevel(F1, "F1-A", undefined); });
    // repetição de F2 começa com o arsenal de quem terminou F1 (Agulha e baliza)
    add("F2 • Mercado Afogado <small>repetição • 10–12 min</small>", () => { this.replay = true; this.startLevel(F2, "F2-A", f2Entry(this.difficulty)); }, !!save?.unlocked.includes("F2"));
    // repetição de F3 começa com o arsenal de quem terminou F2 (Agulha, Fole e baliza)
    add("F3 • Casa das Bombas <small>repetição • 12–15 min</small>", () => { this.replay = true; this.startLevel(F3, "F3-A", f3Entry(this.difficulty)); }, !!save?.unlocked.includes("F3"));
    const back = document.createElement("button"); back.textContent = "Voltar"; back.onclick = () => this.showMenu(); list.appendChild(back);
  }

  // ---------- fluxo ----------
  newGame(diff: Difficulty) {
    this.difficulty = diff; this.replay = false;
    this.startLevel(F1, "F1-A", undefined, true);
  }
  startLab() { this.replay = true; this.startLevel(makeLab(LAB!), "start", undefined); }

  /** Carrega o save migrando registros antigos (prévia "F2P" → F2). */
  loadSave(): SaveData | null {
    const s = this.store.load();
    if (s && s.checkpoint.phase === "F2P") {
      s.checkpoint = migrateCheckpoint(s.checkpoint);
      try { this.store.save({ checkpoint: s.checkpoint, completed: s.completed, unlocked: s.unlocked }); } catch { /* segue só nesta sessão */ }
    }
    return s;
  }

  continueGame() {
    const s = this.loadSave();
    if (!s) return;
    this.replay = false; this.difficulty = s.checkpoint.difficulty;
    this.startLevel(levelById(s.checkpoint.phase), s.checkpoint.point, s.checkpoint);
  }

  /** Uma única transição em andamento. */
  startLevel(level: LevelDef, point: string, cp?: Checkpoint, saveEntry = false) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.state = "loading"; this.show("loading");
    // a captura do mouse precisa do gesto do clique
    this.input.requestLock(true);
    const t0 = performance.now();
    setTimeout(() => {
      const sim = new Sim(level, cp?.difficulty ?? this.difficulty, 7);
      sim.start(point, cp);
      this.sim = sim;
      this.auto = null; this.plan = null;
      this.renderer.menuMode = false;
      this.renderer.buildLevel(level, sim.world);
      this.lastCp = cp ?? sim.checkpoint(point);
      this.fixed.acc = 0;
      this.state = "playing";
      this.transitioning = false;
      this.deathTimer = -1;
      this.clearHud();
      this.show(this.input.locked ? null : "clickResume");
      if (!this.input.locked) this.state = "paused";
      if (saveEntry) this.persist(sim.checkpoint(point));
      this.handleEvents(sim.drain());
      (window as any).__fhLastLoadMs = performance.now() - t0;
    }, 30);
  }

  persist(cp: Checkpoint, extra?: Partial<Pick<SaveData, "completed" | "unlocked">>) {
    this.lastCp = cp;
    if (this.replay) return;
    const prev = this.store.load();
    const completed = [...new Set([...(prev?.completed ?? []), ...(extra?.completed ?? [])])];
    const unlocked = [...new Set([...(prev?.unlocked ?? ["F1"]), ...(extra?.unlocked ?? [])])];
    const r = this.store.save({ checkpoint: cp, completed, unlocked });
    this.toast(r === "ok" ? "Progresso salvo" : "Progresso disponível apenas nesta sessão");
  }

  pause(reason: string) {
    if (this.state !== "playing") return;
    this.state = "paused"; this.pauseReason = reason;
    this.sim?.arsenal.clearIntent();
    $("pauseObj").textContent = this.sim?.objective ?? "";
    this.show("pause");
  }
  resume() {
    if (this.state !== "paused" || !this.sim) return;
    this.audio.ensure();
    this.input.requestLock(true);
    this.sim.arsenal.clearIntent();
    this.state = "playing";
    this.fixed.acc = 0;
    this.show(null);
  }
  toMenu() {
    this.input.releaseLock();
    this.sim = null;
    this.showMenu();
  }
  retry() {
    if (this.transitioning || !this.lastCp) return;
    const cp = this.lastCp;
    this.startLevel(levelById(cp.phase), cp.point, cp);
  }
  goNext() {
    if (this.sim?.level.id === "F3") return; // F4 ainda não existe
    const s = this.loadSave();
    const cp = this.replay ? this.lastCp : s?.checkpoint;
    if (this.sim?.level.id === "F2") {
      // a F3 começa com o inventário com que a F2 terminou (Fole incluído)
      this.startLevel(F3, "F3-A", cp && cp.phase === "F3" ? cp : f3Entry(this.difficulty));
      return;
    }
    // a F2 começa com o inventário com que a F1 terminou
    this.startLevel(F2, "F2-A", cp && cp.phase === "F2" ? cp : f2Entry(this.difficulty));
  }

  // ---------- eventos ----------
  handleEvents(evs: SimEvent[]) {
    const sim = this.sim!;
    if (DEBUG) { this.eventLog.push(...evs.map((e) => ({ ...e, t: sim.t }))); if (this.eventLog.length > 5000) this.eventLog.splice(0, 1000); }
    this.renderer.onEvents(evs, sim);
    for (const e of evs) {
      this.audio.play(e);
      switch (e.type) {
        case "subtitle": this.subtitle(e.who, e.text, e.dur); break;
        case "save": {
          const cp = sim.checkpoint(e.point);
          if (sim.difficulty === "historia" && cp.medkits < 2) { cp.medkits++; sim.medkits++; }
          this.persist(cp);
          break;
        }
        case "shot": if (e.hit) { this.hitT = e.killed ? 0.35 : 0.18; $("hitmark").setAttribute("stroke", e.killed ? "#ff9a5a" : e.marked ? "#9fffd0" : "#ffffff"); } break;
        case "hurt": this.hurtT = 0.5; this.damageIndicator(e.from); break;
        case "doorVibrate": this.directional(e.pos, e.label ?? "Entrada"); break;
        case "death": {
          this.deathTimer = 1.3;
          // a queda entra no registro sem mover o ponto de retorno
          if (this.lastCp) { this.lastCp = { ...this.lastCp, deaths: (this.lastCp.deaths ?? 0) + 1, playTime: sim.playTimeBase + sim.stats.time }; if (!this.replay) { const prev = this.store.load(); if (prev) this.store.save({ ...prev, checkpoint: this.lastCp }); } }
          break;
        }
        case "levelComplete": if (sim.level.id === "F3") this.completeF3(e.route, e.boss ?? 0, e.stuck ?? {}); else if (sim.level.id === "F2") this.completeF2(e.route, e.alive ?? 0); else this.complete(e.route); break;
        case "pickup": this.toast(e.kind === "dardos" ? `+${e.amount} dardos` : e.kind === "fole" ? `+${e.amount} cargas do Fole` : e.kind === "tear" ? `+${e.amount} fio do Tear` : "+1 curativo"); break;
        case "tearInvalid": this.toast("Sem piso firme para a linha"); break;
        case "bossStart": this.bossBar(e.name); break;
        case "switch": if (e.weapon === "fole" && !this.foleHinted) { this.foleHinted = true; this.toast("Fole • 2 ou roda do mouse troca de arma"); } else if (e.weapon === "tear" && !this.tearHinted) { this.tearHinted = true; this.toast("Tear • 3 • botão direito estica a linha no piso"); } break;
        case "bossDead": this.bossBar(null); break;
      }
    }
  }

  complete(route: string) {
    const sim = this.sim!;
    // registro de entrada da F2: leva vida, curativos, arsenal e baliza da F1; tempo e contadores do capítulo recomeçam
    sim.applyShelterFloor();
    const exitCp: Checkpoint = f2EntryFromF1(sim.checkpoint("F2-A"));
    this.persist(exitCp, { completed: ["F1"], unlocked: ["F1", "F2"] });
    this.state = "result";
    this.input.releaseLock();
    const st = sim.stats;
    const mm = Math.floor((sim.playTimeBase + st.time) / 60), ss = Math.floor((sim.playTimeBase + st.time) % 60);
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    $("resTable").innerHTML = [
      ["Tempo", `${mm}:${String(ss).padStart(2, "0")}`], ["Rota até a catraca", route], ["Criaturas derrubadas", String(st.kills)],
      ["Precisão da Agulha", `${acc}%`], ["Quedas", String(sim.deathsBase + st.deaths)], ["Chamados da baliza", String(st.pulses)], ["Dano recebido", String(Math.round(st.damageTaken))],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    (window as any).__fhResult = { level: "F1", route, ...st, deathsTotal: sim.deathsBase + st.deaths };
    $("resTitle").textContent = "F1 • Última Chamada";
    $("resQuote").textContent = "Nara: “A primeira trava abriu. A balsa tá andando.”";
    const nb = $<HTMLButtonElement>("btnNext"); nb.disabled = false; nb.textContent = "Seguir para o mercado";
    this.show("result");
  }

  completeF2(route: string, alive: number) {
    const sim = this.sim!;
    // registro de entrada da F3: leva vida, curativos, arsenal (Fole incluído) e baliza da F2
    sim.applyShelterFloor();
    const exitCp: Checkpoint = f3EntryFromF2(sim.checkpoint("F3-A"));
    this.persist(exitCp, { completed: ["F1", "F2"], unlocked: ["F1", "F2", "F3"] });
    this.state = "result";
    this.input.releaseLock();
    const st = sim.stats;
    const total = sim.playTimeBase + st.time;
    const mm = Math.floor(total / 60), ss = Math.floor(total % 60);
    const agShots = st.shots, agHits = st.hits;
    const acc = agShots > 0 ? Math.round((agHits / agShots) * 100) : 0;
    const foleAcc = st.foleShots ? Math.round((st.foleHits / (st.foleShots * 6)) * 100) : 0;
    $("resTable").innerHTML = [
      ["Tempo", `${mm}:${String(ss).padStart(2, "0")}`], ["Rota até a praça", route === "toldo" ? "Por cima (toldos, Agulha)" : "Por baixo (névoa, Fole)"],
      ["Criaturas derrubadas", String(st.kills)], ["Comuns vivos na saída", String(alive)],
      ["Precisão da Agulha", `${Math.min(100, acc)}%`], ["Fragmentos do Fole no alvo", `${foleAcc}%`], ["Sopros", String(st.sopros)],
      ["Quedas", String(sim.deathsBase + st.deaths)], ["Dano recebido", String(Math.round(st.damageTaken))],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    (window as any).__fhResult = { level: "F2", route, alive, ...st, deathsTotal: sim.deathsBase + st.deaths };
    $("resTitle").textContent = "F2 • Mercado Afogado";
    $("resQuote").textContent = "Nara: “Comporta baixa vencida. Próxima parada: a casa das bombas.”";
    const nb = $<HTMLButtonElement>("btnNext"); nb.disabled = false; nb.textContent = "Seguir para a casa das bombas";
    this.show("result");
  }

  completeF3(route: string, bossSecs: number, stuck: Record<string, number>) {
    const sim = this.sim!;
    this.bossBar(null);
    sim.applyShelterFloor();
    const exitCp: Checkpoint = { ...sim.checkpoint("F3-B"), objective: "Casa das Bombas concluída" };
    this.persist(exitCp, { completed: ["F1", "F2", "F3"], unlocked: ["F1", "F2", "F3"] });
    this.state = "result";
    this.input.releaseLock();
    const st = sim.stats;
    const total = sim.playTimeBase + st.time;
    const mm = Math.floor(total / 60), ss = Math.floor(total % 60);
    const tearAcc = st.tearShots ? Math.round((st.tearHits / st.tearShots) * 100) : 0;
    const bm = Math.floor(bossSecs / 60), bs = Math.floor(bossSecs % 60);
    $("resTable").innerHTML = [
      ["Tempo", `${mm}:${String(ss).padStart(2, "0")}`], ["Rota na galeria baixa", route === "passarela" ? "Pela passarela (curva em U)" : "Pela margem"],
      ["Criaturas derrubadas", String(st.kills)], ["Badalo", `${bm}:${String(bs).padStart(2, "0")}`],
      ["Quedas do sino nas placas", `${(stuck.lia ?? 0) + (stuck.baliza ?? 0)} (baliza: ${stuck.baliza ?? 0})`],
      ["Fios do Tear no alvo", `${Math.min(200, tearAcc)}%`], ["Linhas no piso", String(st.tearLines)],
      ["Quedas", String(sim.deathsBase + st.deaths)], ["Dano recebido", String(Math.round(st.damageTaken))],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    (window as any).__fhResult = { level: "F3", route, bossSecs, stuck, ...st, deathsTotal: sim.deathsBase + st.deaths };
    $("resTitle").textContent = "F3 • Casa das Bombas";
    $("resQuote").textContent = "Nara (eco): “...a luz da rua... sobe, Lia.”";
    const nb = $<HTMLButtonElement>("btnNext"); nb.disabled = true; nb.textContent = "F4 • Rua das Vozes — em breve";
    this.show("result");
  }

  /** Barra do chefe (nome e vida). */
  bossBar(name: string | null) {
    const el = $("bossBar"); if (!el) return;
    el.classList.toggle("on", !!name);
    if (name) $("bossName").textContent = name;
  }

  // ---------- HUD ----------
  clearHud() {
    this.bossBar(null);
    $("subtitles").innerHTML = ""; this.subLines = [];
    $("dirs").innerHTML = ""; this.dirInd = []; this.dmgInd = [];
  }
  subtitle(who: string, text: string, dur = 4) {
    const el = document.createElement("div"); el.className = "line";
    el.innerHTML = `<span class="who ${who === "Rádio" ? "radio" : ""}">${who}</span>${text}`;
    $("subtitles").appendChild(el);
    this.subLines.push({ el, t: dur });
    while (this.subLines.length > 3) this.subLines.shift()!.el.remove();
  }
  toast(text: string) { const t = $("toast"); t.textContent = text; t.classList.add("on"); this.toastT = 2.2; }
  directional(pos: { x: number; y: number; z: number }, label: string) {
    const el = document.createElement("div"); el.className = "dir"; el.innerHTML = `<span class="arr">▲</span>${label}`;
    $("dirs").appendChild(el); this.dirInd.push({ el, pos, t: 2.6 });
  }
  damageIndicator(from: { x: number; z: number }) {
    const sim = this.sim!; const el = document.createElement("div"); el.className = "dmg";
    const ang = angleDiff(sim.player.yaw, yawTo(sim.player.pos, { x: from.x, y: 0, z: from.z }));
    $("dirs").appendChild(el); this.dmgInd.push({ el, ang, t: 1 });
  }

  isOutdoors(sim: Sim): boolean {
    const env = sim.level.env, p = sim.player.pos;
    if (!env.rain) return false;
    const rects = env.outdoors ?? [[62, -9, 88, 9]];
    return rects.some((r) => p.x > r[0] && p.x < r[2] && p.z > r[1] && p.z < r[3]);
  }
  private kitEls: HTMLElement[] | null = null;
  private slotKey = -1;
  private fogVis = 0;
  foleHinted = false;
  tearHinted = false;
  private diagT = 0;
  updateHud(dt: number) {
    const sim = this.sim!;
    const hp = Math.max(0, Math.ceil(sim.hp));
    if (sim.vars.bossHp !== undefined) UI.style("bossFill", "width", `${Math.round(sim.vars.bossHp * 1000) / 10}%`);
    UI.style("hpFill", "width", `${hp}%`); UI.cls("hpFill", "low", hp <= 30); UI.text("hpNum", String(hp));
    if (!this.kitEls) this.kitEls = Array.from(document.querySelectorAll<HTMLElement>("#medkits .kit"));
    this.kitEls.forEach((k, i) => { UI.elCls(k, "on", i < sim.medkits); UI.elCls(k, "healing", sim.healT >= 0 && i === sim.medkits - 1); });
    const a = sim.arsenal; const am = a.ammo();
    UI.style("ammo", "visibility", am ? "visible" : "hidden");
    if (am && a.current) {
      const d = WEAPONS[a.current];
      UI.text("wName", d.nome.toUpperCase());
      UI.text("mag", String(am.mag)); UI.cls("mag", "low", am.mag <= 6);
      UI.text("reserve", `/ ${am.reserve}`);
      UI.text("mode", `SECUNDÁRIO • ${d.altNome} ◆${d.altCost}`);
      const rl = a.state === "reloading";
      UI.cls("reloadBar", "on", rl);
      UI.style("reloadFill", "width", rl ? `${Math.round((1 - a.timer / d.reload) * 1000) / 10}%` : "0");
      UI.text("altCost", am.mag < d.altCost ? `◆${d.altCost} sem carga` : `◆${d.altCost}`);
      UI.style("altCost", "color", am.mag < d.altCost ? "#ff8080" : "");
    } else UI.text("altCost", "");
    // armas que a Lia carrega (número do atalho)
    const sk = a.owned.size * 100 + (a.current ? WEAPONS[a.current].slot : 0);
    if (sk !== this.slotKey) {
      this.slotKey = sk;
      const slots = ([...a.owned.keys()] as (keyof typeof WEAPONS)[]).sort((x, y) => WEAPONS[x].slot - WEAPONS[y].slot); UI.html("wSlots", slots.length > 1 ? slots.map((w) => (w === a.current ? `<b>${WEAPONS[w].slot} ${WEAPONS[w].nome.toUpperCase()}</b>` : `<i>${WEAPONS[w].slot} ${WEAPONS[w].nome.toUpperCase()}</i>`)).join("  ") : ""); }
    // névoa do Véu na câmera
    const fogK = sim.cloudDensity(sim.player.eyePos());
    this.fogVis += (fogK - this.fogVis) * Math.min(1, dt * 5);
    UI.style("fogveil", "opacity", (this.fogVis * 0.92).toFixed(2));
    // baliza junto à mira
    const b = sim.beacon;
    UI.style("bRing", "display", b.owned ? "" : "none"); UI.style("bRingBg", "display", b.owned ? "" : "none");
    const frac = b.ringFraction();
    UI.attr("bRing", "stroke-dashoffset", (138.2 * (1 - frac)).toFixed(1));
    const col = b.state === "ready" ? "#7ff6ff" : b.state === "armed" ? "#ffe07a" : b.state === "emitting" ? "#ffffff" : "#5a8a90";
    UI.attr("bRing", "stroke", col);
    UI.attr("bRing", "stroke-width", b.state === "emitting" ? (3 + Math.sin(performance.now() / 60) * 1.5).toFixed(1) : "3");
    const lbl = !b.owned ? "" : b.state === "ready" ? (sim.beaconAim?.valid ? "BALIZA PRONTA • Q LANÇA" : "BALIZA PRONTA • MIRE NO PISO (14 m)")
      : b.state === "flying" ? "LANÇANDO…" : b.state === "armed" ? `ARMADA • Q CHAMA • ${Math.ceil(b.timer)} s` : b.state === "emitting" ? "CHAMANDO" : "RECARREGANDO";
    UI.text("bLabel", lbl); UI.style("bLabel", "color", col);
    // objetivo e interação
    UI.text("objText", sim.objective);
    const f = sim.focus;
    if (f && sim.alive) {
      const en = f.enabled();
      const txt = en ? `<kbd>E</kbd>${f.prompt}` : f.lockedPrompt?.() ?? "";
      UI.html("prompt", txt); UI.cls("prompt", "on", !!txt); UI.cls("prompt", "locked", !en);
    } else UI.cls("prompt", "on", false);
    // marcadores temporários
    this.hitT = Math.max(0, this.hitT - dt); UI.attr("hitmark", "opacity", Math.min(1, this.hitT * 6).toFixed(2));
    this.hurtT = Math.max(0, this.hurtT - dt); UI.style("hurtflash", "opacity", Math.min(this.opts.reduce ? 0.4 : 1, this.hurtT * 2 + (hp < 30 && hp > 0 ? 0.35 : 0)).toFixed(2));
    this.toastT -= dt; if (this.toastT <= 0) $("toast").classList.remove("on");
    if (this.subLines.length) {
      for (const s of this.subLines) { s.t -= dt; if (s.t <= 0) s.el.remove(); }
      this.subLines = this.subLines.filter((s) => s.t > 0);
    }
    if (this.dirInd.length) {
      const W = window.innerWidth, H = window.innerHeight;
      for (const d of this.dirInd) {
        d.t -= dt;
        const pj = this.renderer.project(d.pos);
        const on = !pj.behind && pj.x > 40 && pj.x < W - 40 && pj.y > 40 && pj.y < H - 40;
        let x = pj.x, y = pj.y, rot = 0;
        if (!on) {
          const ang = angleDiff(sim.player.yaw, yawTo(sim.player.pos, d.pos));
          x = W / 2 - Math.sin(ang) * W * 0.36; y = H / 2 - Math.cos(ang) * H * 0.36; rot = -ang;
        }
        UI.elStyle(d.el, "transform", `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%)`);
        UI.elStyle(d.el.firstChild as HTMLElement, "transform", `rotate(${rot.toFixed(2)}rad)`);
        UI.elStyle(d.el, "opacity", Math.min(1, d.t).toFixed(2));
      }
      this.dirInd = this.dirInd.filter((d) => (d.t > 0 ? true : (d.el.remove(), false)));
    }
    if (this.dmgInd.length) {
      for (const d of this.dmgInd) {
        d.t -= dt;
        const ang = angleDiff(sim.player.yaw, yawTo(sim.player.pos, sim.player.pos)) + d.ang;
        UI.elStyle(d.el, "transform", `rotate(${(-ang).toFixed(2)}rad)`); UI.elStyle(d.el, "opacity", Math.max(0, d.t).toFixed(2));
      }
      this.dmgInd = this.dmgInd.filter((d) => (d.t > 0 ? true : (d.el.remove(), false)));
    }
    // diagnóstico (4 vezes por segundo)
    UI.cls("diag", "hidden", !this.showDiag);
    this.diagT -= dt;
    if (this.showDiag && this.diagT <= 0) {
      this.diagT = 0.25;
      const di = sim.script.diagnostics?.() ?? {};
      const ps = this.renderer.lightPool.stats;
      UI.text("diag", [
        `${sim.level.id} ${sim.point}  t=${sim.t.toFixed(1)}  ${this.state}`,
        `pos ${sim.player.pos.x.toFixed(1)} ${sim.player.pos.y.toFixed(1)} ${sim.player.pos.z.toFixed(1)}  piso:${sim.groundMat()}`,
        `ativos ${sim.activeCommons()}  máx ${sim.maxActiveSeen}  baliza ${sim.beacon.state}`,
        `arena ${di.arena ?? "-"}  onda2 ${di.wave2 ?? "-"}  pendentes ${di.pending ?? "-"}`,
        `painel: ${di.block ?? "-"}`,
        `gatilhos: ${sim.triggers.map((t) => `${t.id}${t.fired ? "✓" : ""}`).join(" ")}`,
        ...sim.creatures.filter((c) => c.alive).map((c) => `  ${c.id} ${c.state} hp${c.hp} ${c.tag}`),
        `quadro ${(this.stats.frameTimes.reduce((x, y) => x + y, 0) / Math.max(1, this.stats.frameTimes.length)).toFixed(1)} ms  escala ${this.renderer.renderScale.toFixed(2)}  luzes ${ps.used}/${ps.inFrustum}/${ps.sources}`,
      ].join("\n"));
    }
  }

  // ---------- laço ----------
  frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const raw = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.1, raw);
    const simDt = DEBUG ? Math.min(0.7, raw) : dt;
    this.last = now;
    this.stats.frames++; this.stats.frameTimes[this.stats.frames % 120] = dt * 1000;
    this.adaptResolution(raw * 1000);
    const sim = this.sim;
    if (this.state === "playing" && sim) {
      const look = this.input.takeLook();
      const k = 0.0022 * this.opts.sens;
      sim.player.yaw -= look.dx * k;
      sim.player.pitch -= look.dy * k * (this.opts.invert ? -1 : 1);
      sim.player.pitch = Math.max(-1.45, Math.min(1.45, sim.player.pitch));
      const n = this.fixed.advance(simDt * this.timeScale);
      for (let i = 0; i < n; i++) {
        this.plan?.step();
        let inp = this.auto ? this.auto.next() : i === 0 ? this.input.frame() : { ...this.input.frame(), firePressed: false };
        if (!sim.alive) inp = emptyFrame();
        sim.tick(DT, inp);
        this.handleEvents(sim.drain());
        if (this.state !== "playing") break;
      }
      if (this.deathTimer > 0) {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0 && this.state === "playing") {
          this.state = "dead"; this.input.releaseLock();
          $("deathInfo").textContent = `Retorno em ${this.lastCp?.point ?? "-"} • ${sim.objective}`;
          this.show("death"); $("btnRetry").focus();
        }
      }
    }
    if (sim && this.state !== "menu") {
      this.renderer.sync(sim, this.state === "playing" ? dt : 0, { reduceFlashes: this.opts.reduce });
      this.updateHud(this.state === "playing" ? dt : 0);
      const e = sim.player.eyePos();
      this.audio.setListener(e, sim.player.yaw, sim.player.pitch);
      const danger = sim.creatures.some((c) => c.alive && !c.passive && c.aware) ? 1 : 0;
      this.audio.update(dt, { danger, outdoors: this.isOutdoors(sim), paused: this.state !== "playing" });
    } else {
      this.renderer.menuCamera(dt);
      this.audio.update(dt, { danger: 0, outdoors: true, paused: true });
    }
    this.renderer.render();
  }
}

const game = new Game();
(window as any).__fhGame = game;
if (DEBUG) {
  (window as any).__fh = {
    game, BUILD,
    get sim() { return game.sim; },
    get state() { return game.state; },
    setSpeed(s: number) { game.timeScale = s; },
    /** Começa uma fase a partir de um registro (como o Continuar faria), gravando progresso se replay = false. */
    startWith(id: "F1" | "F2" | "F3", point: string, cp: Checkpoint, replay = false) { game.replay = replay; game.difficulty = cp.difficulty; game.startLevel(levelById(id), point, cp, !replay); },
    /** Começa uma fase direto (F2 com o inventário padrão de fim da F1). */
    start(id: "F1" | "F2" | "F3", point?: string) {
      game.replay = true;
      if (id === "F3") { const cp = f3Entry(game.difficulty); game.startLevel(F3, point ?? "F3-A", { ...cp, point: point ?? "F3-A", weapons: point === "F3-B" ? { ...cp.weapons, tear: { mag: 12, reserve: 24 } } : cp.weapons }); return; }
      game.startLevel(id === "F2" ? F2 : F1, point ?? `${id}-A`, id === "F2" ? { ...f2Entry(game.difficulty), point: point ?? "F2-A", flags: point === "F2-B" ? { fole: true, registro1: true } : {}, weapons: point === "F2-B" ? { agulha: { mag: 24, reserve: 72 }, fole: { mag: 8, reserve: 8 } } : { agulha: { mag: 24, reserve: 72 } } } : undefined); },
    /** Equivale a mover o mouse até mirar o ponto (só no modo de depuração). */
    aimAt(p: { x: number; y: number; z: number }) { if (game.sim) new Autopilot(game.sim).aimAt(p); },
    autopilot() { if (!game.sim) return null; game.auto = new Autopilot(game.sim); return game.auto; },
    manual() { game.auto = null; game.plan = null; },
    runPlan(name: string, arg?: string) {
      if (!game.sim) return false;
      const auto = new Autopilot(game.sim); game.auto = auto;
      const plans: Record<string, (r: PlanRunner) => Plan> = {
        tutorial: tutorialToShelter, dieWave2: dieInWave2, quick: quickOpening,
        finish: (r) => finishPraca(r, (arg as any) ?? "terreo"),
        full: function* (r) { yield* tutorialToShelter(r); yield* finishPraca(r, (arg as any) ?? "terreo"); },
        f2: (r) => f2Full(r, (arg as any) ?? "baixo"),
        f2Fole: f2TakeFole, f2Low: f2LowPassage, f2High: f2HighRoute, f2Praca: f2Praca,
        f2Boia: (r) => f2Boia(r, arg !== "limpa"),
        // F3: arg = "rota/metodo" (ex.: "passarela/alterna", "margem/baliza")
        f3: (r) => f3Full(r, ((arg ?? "").split("/")[0] || "passarela") as any, ((arg ?? "").split("/")[1] || "alterna") as any),
        f3Ate: function* (r) { yield* f3TakeTear(r); yield* f3Filtros(r); yield* f3Batente(r); yield* f3Galeria(r, (arg as any) || "passarela"); },
        f3Boss: (r) => f3Boss(r, (arg as any) || "alterna"),
        f3BossMeio: (r) => f3Boss(r, "alterna", true),
        f3Exit: f3Exit,
      };
      game.plan = new PlanRunner(game.sim, auto, plans[name]);
      return true;
    },
    get plan() { const p = game.plan; return p ? { done: p.done, ok: p.ok, error: p.error, log: p.log, data: p.data } : null; },
    events() { return game.eventLog; },
    /** Decoração solta no ar (sem piso, parede, teto ou suporte por perto). */
    floatingProps() { return game.renderer.propReport.filter((p) => !p.support || (p.loose?.length ?? 0) > 0); },
    clearEvents() { game.eventLog.length = 0; },
  };
}
