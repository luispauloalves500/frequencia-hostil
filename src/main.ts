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
import { F2_PREVIEW, makeLab, type LabStage } from "./levels/lab";
import type { LevelDef } from "./levels/types";
import { angleDiff, yawTo } from "./core/math";
import * as UI from "./ui/dom";
import { PlanRunner, tutorialToShelter, dieInWave2, finishPraca, quickOpening, type Plan } from "./scenarios";

export const BUILD = { version: "0.3.1", milestone: "D03" };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const LAB = params.get("sala") as LabStage | null;

interface Options { sens: number; fov: number; invert: boolean; master: number; music: number; sfx: number; quality: Quality; reduce: boolean; subBg: boolean; text: string; perf: "auto" | "max" }
const DEFAULT_OPTS: Options = { sens: 1, fov: 75, invert: false, master: 0.8, music: 0.55, sfx: 0.9, quality: "media", reduce: false, subBg: false, text: "1", perf: "auto" };

type GState = "menu" | "loading" | "playing" | "paused" | "dead" | "result";

function levelById(id: string): LevelDef {
  if (id === "F2P") return F2_PREVIEW;
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
    const save = this.store.load();
    const cont = $<HTMLButtonElement>("btnContinue");
    cont.disabled = !save;
    $<HTMLButtonElement>("btnSelect").disabled = !(save?.completed.includes("F1"));
    $("continueInfo").textContent = save ? `Último registro: ${save.checkpoint.phase === "F2P" ? "Prévia de F2" : "F1 • Última Chamada"} • ${save.checkpoint.point} • ${({ historia: "História", normal: "Normal", intenso: "Intenso" } as const)[save.checkpoint.difficulty]}` : this.store.sessionOnly ? "Progresso disponível apenas nesta sessão" : "";
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
    const save = this.store.load();
    const add = (label: string, fn: () => void, enabled = true) => { const b = document.createElement("button"); b.innerHTML = label; b.disabled = !enabled; b.onclick = () => { this.audio.ensure(); fn(); }; list.appendChild(b); };
    add("F1 • Última Chamada <small>repetição • 8–10 min</small>", () => { this.replay = true; this.startLevel(F1, "F1-A", undefined); });
    add("F2 • Mercado Afogado <small>prévia — a fase real chega no D04</small>", () => { this.replay = true; this.startLevel(F2_PREVIEW, "F2-A", save?.checkpoint.phase === "F2P" ? save.checkpoint : undefined); }, !!save?.unlocked.includes("F2"));
    const back = document.createElement("button"); back.textContent = "Voltar"; back.onclick = () => this.showMenu(); list.appendChild(back);
  }

  // ---------- fluxo ----------
  newGame(diff: Difficulty) {
    this.difficulty = diff; this.replay = false;
    this.startLevel(F1, "F1-A", undefined, true);
  }
  startLab() { this.replay = true; this.startLevel(makeLab(LAB!), "start", undefined); }

  continueGame() {
    const s = this.store.load();
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
    const s = this.store.load();
    const cp = this.replay ? this.lastCp : s?.checkpoint;
    this.startLevel(F2_PREVIEW, "F2-A", cp && cp.phase === "F2P" ? cp : undefined);
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
        case "levelComplete": this.complete(e.route); break;
        case "pickup": this.toast(e.kind === "dardos" ? `+${e.amount} dardos` : "+1 curativo"); break;
      }
    }
  }

  complete(route: string) {
    const sim = this.sim!;
    const exitCp: Checkpoint = { ...sim.checkpoint("F2-A"), phase: "F2P", objective: "Abra a comporta baixa (D04)", flags: {} };
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
    (window as any).__fhResult = { route, ...st, deathsTotal: sim.deathsBase + st.deaths };
    this.show("result");
  }

  // ---------- HUD ----------
  clearHud() {
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

  private kitEls: HTMLElement[] | null = null;
  private diagT = 0;
  updateHud(dt: number) {
    const sim = this.sim!;
    const hp = Math.max(0, Math.ceil(sim.hp));
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
      this.audio.update(dt, { danger, outdoors: sim.level.env.rain && sim.player.pos.x > 62 && sim.player.pos.x < 88, paused: this.state !== "playing" });
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
      };
      game.plan = new PlanRunner(game.sim, auto, plans[name]);
      return true;
    },
    get plan() { const p = game.plan; return p ? { done: p.done, ok: p.ok, error: p.error, log: p.log, data: p.data } : null; },
    events() { return game.eventLog; },
    clearEvents() { game.eventLog.length = 0; },
  };
}
