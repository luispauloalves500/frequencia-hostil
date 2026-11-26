import { DT } from "./config";
import { Autopilot } from "./autopilot";
import type { Sim } from "./core/sim";
import type { V3 } from "./core/math";
import { F1Script, F1_POINTS } from "./levels/f1";

/**
 * Roteiros de teste. Cada roteiro é um gerador que roda um passo por tick e
 * dirige o piloto automático com as mesmas entradas de um jogador.
 */
export type Plan = Generator<void, void, void>;

export class PlanRunner {
  log: string[] = [];
  done = false;
  ok = true;
  error = "";
  t = 0;
  data: Record<string, any> = {};
  private gen: Plan;
  constructor(public sim: Sim, public auto: Autopilot, factory: (r: PlanRunner) => Plan) { this.gen = factory(this); }
  step() {
    if (this.done) return;
    this.t += DT;
    try { const r = this.gen.next(); if (r.done) this.done = true; }
    catch (e) { this.done = true; this.ok = false; this.error = String(e); this.log.push("ERRO: " + e); }
  }
  say(s: string) { this.log.push(`[${this.sim.t.toFixed(1)}s] ${s}`); }
  fail(s: string) { this.ok = false; this.say("FALHA: " + s); }

  *wait(secs: number): Plan { const end = this.sim.t + secs; while (this.sim.t < end) yield; }
  *until(cond: () => boolean, timeout: number, label: string): Plan {
    const end = this.sim.t + timeout;
    while (!cond()) { if (this.sim.t > end) throw new Error(`tempo esgotado: ${label}`); yield; }
  }
  *goto(p: V3, opts: { sprint?: boolean; timeout?: number; r?: number; crouchZone?: [number, number] } = {}): Plan {
    const a = this.auto; a.moveTo(p, opts.sprint);
    const end = this.sim.t + (opts.timeout ?? 40);
    while (!a.arrived(opts.r ?? 0.8)) {
      if (this.sim.t > end) throw new Error(`não chegou em ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      if (!this.sim.alive) throw new Error("morreu no caminho");
      yield;
    }
    a.stop();
  }
  /** Luta até não haver criaturas hostis vivas perto. */
  *clear(radius: number, timeout: number, center?: V3): Plan {
    const s = this.sim; const end = s.t + timeout;
    const hostile = () => s.creatures.filter((c) => c.alive && !c.passive && Math.hypot(c.pos.x - (center ?? s.player.pos).x, c.pos.z - (center ?? s.player.pos).z) < radius);
    while (hostile().length) {
      if (s.t > end) throw new Error("luta não terminou");
      if (!s.alive) throw new Error("morreu na luta");
      const c = hostile()[0];
      // aproxima se não houver linha de visão
      if (!this.auto.target()) this.auto.moveTo(c.pos); else this.auto.stop();
      if (s.hp < 45 && s.medkits > 0 && s.healT < 0) this.auto.push({ heal: true });
      yield;
    }
    this.auto.stop();
  }
  *throwBeacon(at: V3): Plan {
    this.auto.fight = false; this.auto.aimOverride = { ...at };
    yield; yield;
    this.auto.push({ beacon: true });
    yield* this.until(() => this.sim.beacon.state === "armed", 2, "baliza armada");
    this.auto.aimOverride = null; this.auto.fight = true;
  }
  *call(): Plan { this.auto.push({ beacon: true }); yield* this.until(() => this.sim.beacon.state === "emitting", 1, "chamado"); }
}

const f1 = (s: Sim) => s.script as unknown as F1Script;

/** Novo jogo → armário → corredor (agachado) → bilheteria (baliza) → guichê → F1-B. */
export function* tutorialToShelter(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  yield* r.goto({ x: 5.5, y: 0, z: -3.2 });
  a.aimOverride = F1_POINTS.locker; yield; yield;
  a.push({ interact: true }); yield; a.aimOverride = null;
  yield* r.until(() => !!s.flags.armario, 2, "armário");
  r.say("pegou Agulha e baliza");
  yield* r.goto({ x: 10, y: 0, z: 3.4 }, { r: 0.6 });
  yield* r.goto({ x: 16.5, y: 0, z: 0 });
  // passa sob a persiana agachado
  a.fight = false;
  let n = 0;
  a.moveTo({ x: 20, y: 0, z: 0 });
  while (s.player.pos.x < 19.3 && n++ < 600) { const f = a.next(); a.queue.unshift({ ...f, crouch: true }); yield; }
  r.data.crouchedUnderShutter = s.player.pos.x > 19;
  r.say(`passou sob a persiana agachado: ${r.data.crouchedUnderShutter}`);
  a.fight = true;
  yield* r.goto({ x: 30, y: 0, z: -1.2 });
  yield* r.throwBeacon({ x: F1_POINTS.chalk.x, y: 0, z: F1_POINTS.chalk.z });
  yield* r.wait(0.3);
  yield* r.call();
  r.say("chamado emitido na marca de giz");
  yield* r.until(() => !!s.flags.trinco, 3, "trinco acústico");
  r.data.demoLured = s.creatures.filter((c) => c.tag === "demo" && c.state === "lured").length;
  r.say(`trinco aberto; Riscadores da demonstração atraídos: ${r.data.demoLured}`);
  yield* r.wait(3.5);
  yield* r.clear(20, 25);
  r.say("Riscador solto derrubado");
  yield* r.goto({ x: 41.5, y: 0, z: -1.2 });
  yield* r.goto({ x: 43, y: 0, z: 3 });
  yield* r.clear(30, 40);
  r.say("guichê limpo");
  yield* r.goto({ x: 52, y: 0, z: 4.5 });
  yield* r.goto({ x: 58.4, y: 0, z: 5 });
  yield* r.until(() => !!s.flags.abrigoB, 2, "abrigo F1-B");
  r.say(`chegou ao abrigo F1-B (vida ${Math.ceil(s.hp)})`);
}

/** Entra na praça e morre depois do aviso da onda 2. */
export function* dieInWave2(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  yield* r.goto({ x: 65, y: 0, z: 5 });
  yield* r.until(() => f1(s).arena?.state !== "idle", 3, "início da arena");
  // luta até a onda 2 ser anunciada
  const end = s.t + 90;
  while (!f1(s).arena!.wave2Started) {
    if (s.t > end) throw new Error("onda 2 não começou");
    if (!a.target()) a.moveTo({ x: 70, y: 0, z: 4 }); else a.stop();
    yield;
  }
  r.say("onda 2 anunciada — parando de lutar");
  a.fight = false; a.stop();
  a.moveTo({ x: 68, y: 0, z: 1 });
  yield* r.until(() => !s.alive, 120, "morte na onda 2");
  r.say("Lia caiu na onda 2");
}

/** Limpa a praça pela rota escolhida e cruza a porta do peixe. */
export function* finishPraca(r: PlanRunner, route: "terreo" | "passarela"): Plan {
  const s = r.sim, a = r.auto;
  if (route === "passarela") {
    yield* r.goto({ x: 63.4, y: 0, z: 1.5 });
    yield* r.goto({ x: 63.4, y: 2.4, z: -6.5 });
    r.say("subiu a escada");
    yield* r.goto({ x: 75, y: 2.4, z: -7.2 });
    r.data.gotDarts = s.pickups.find((p) => p.id === "dardos-passarela")?.taken;
    yield* r.goto({ x: 83.2, y: 2.4, z: -5.6 });
    yield* r.goto({ x: 83.2, y: 0, z: 4.5 });
    r.say("desceu pela rampa");
  } else {
    yield* r.goto({ x: 66, y: 0, z: 6 });
  }
  const end = s.t + 240;
  while (!f1(s).arena!.panelUnlocked()) {
    if (s.t > end) throw new Error("praça não liberou: " + s.creatures.filter((c) => c.alive).map((c) => `${c.type}@${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)}:${c.state}`).join(" ") + ` lia@${s.player.pos.x.toFixed(1)},${s.player.pos.z.toFixed(1)} fila=${f1(s).arena!.pending.length}`);
    if (!s.alive) throw new Error("morreu na praça");
    const hostile = s.creatures.filter((c) => c.alive && !c.passive && c.state !== "emerging");
    if (!a.target() && hostile.length) {
      const h = hostile[0];
      if (route === "terreo" && h.pos.y > 1.2) {
        // fica no térreo: procura um ponto com linha de visão para o atirador
        const spots = [{ x: 70, y: 0, z: 4 }, { x: 80, y: 0, z: 6 }, { x: 66, y: 0, z: 1 }, { x: 78, y: 0, z: -2 }, { x: 72, y: 0, z: 7 }, { x: 86, y: 0, z: 2 }];
        const ok = spots.find((p) => !s.world.blocked({ x: p.x, y: 1.6, z: p.z }, h.center(), ["solid", "grate", "ceiling"])) ?? spots[0];
        if (!a.goal || Math.hypot(a.goal.x - ok.x, a.goal.z - ok.z) > 0.5) a.moveTo(ok);
      } else a.moveTo(h.pos);
    }
    else if (!hostile.length) a.moveTo(route === "passarela" ? { x: 83, y: 0, z: 5 } : { x: 70, y: 0, z: 5 });
    else a.stop();
    if (s.hp < 50 && s.medkits > 0 && s.healT < 0) a.push({ heal: true });
    yield;
  }
  r.say("ondas encerradas — painel liberado");
  yield* r.goto({ x: 86.4, y: 0, z: 1.8 });
  a.aimOverride = { x: 87.6, y: 1.5, z: 1.6 }; yield; yield;
  a.push({ interact: true }); a.push({ interact: true }); // dois E produzem uma única transição
  yield* r.until(() => f1(s).panelUsed, 2, "painel");
  a.aimOverride = null;
  r.say("painel acionado");
  yield* r.goto({ x: 92, y: 0, z: 4.7 });
  a.moveTo({ x: 99.5, y: 0, z: 4.7 });
  yield* r.until(() => s.done, 20, "porta do peixe");
  r.say("cruzou a porta do peixe");
}

/** Praça • execução 1: derrubar os três primeiros antes dos 8 s. */
export function* quickOpening(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  yield* r.goto({ x: 66, y: 0, z: 4 });
  const ar = f1(s).arena!;
  yield* r.until(() => ar.state !== "idle", 2, "arena");
  const end = s.t + 30;
  while (!ar.wave2Started) {
    if (s.t > end) throw new Error("sem onda 2");
    const hostile = s.creatures.filter((c) => c.alive && !c.passive && c.state !== "emerging");
    if (!a.target() && hostile.length) a.moveTo(hostile[0].pos); else a.stop();
    yield;
  }
  r.data.wave1KilledAt = ar.remainingWave1() === 0 ? ar.t : null;
  r.data.wave2At = ar.wave2StartTime;
  r.say(`onda 2 iniciou em ${ar.wave2StartTime.toFixed(2)} s (onda 1 restante ${ar.remainingWave1()})`);
  yield* r.wait(6);
  r.data.wave2Spawns = ar.spawnLog.filter((x) => x.wave === 2).length;
  r.data.telegraphs = ar.telegraphLog.filter((x) => x.wave === 2).length;
}

/** Praça • execução 2: escada, dardos da passarela e rampa com inimigo da onda 1 vivo. */
export function* overTheTop(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  const ar = f1(s).arena!;
  a.fight = false;
  yield* r.goto({ x: 63.4, y: 0, z: 1.5 }, { sprint: true });
  yield* r.goto({ x: 63.4, y: 2.4, z: -6.5 }, { sprint: true });
  const before = s.arsenal.ammo("agulha")?.reserve ?? 0;
  yield* r.goto({ x: 75, y: 2.4, z: -7.2 }, { sprint: true });
  r.data.reserveGain = (s.arsenal.ammo("agulha")?.reserve ?? 0) - before;
  r.data.gotDarts = s.pickups.find((p) => p.id === "dardos-passarela")?.taken;
  yield* r.goto({ x: 83.2, y: 2.4, z: -5.6 }, { sprint: true });
  yield* r.goto({ x: 83.2, y: 0, z: 4.5 }, { sprint: true });
  r.data.wave1AliveAtRamp = ar.remainingWave1();
  r.data.routeHigh = f1(s).routeHigh;
  r.data.hp = s.hp;
  r.say(`desceu a rampa com ${ar.remainingWave1()} inimigo(s) da onda 1 restantes, vida ${Math.ceil(s.hp)}`);
  a.fight = true;
}

/** Praça • execução 3: baliza na oficina, dois Riscadores atraídos, travessia até o quiosque. */
export function* soundDetour(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  const ar = f1(s).arena!;
  a.fight = false;
  yield* r.goto({ x: 65, y: 0, z: 6 });
  yield* r.until(() => s.creatures.filter((c) => c.tag === "onda1" && c.type === "riscador" && c.state !== "emerging").length === 2, 8, "dois Riscadores da oficina");
  yield* r.throwBeacon({ x: 75, y: 0, z: 10 });
  yield* r.call();
  yield* r.wait(0.4);
  r.data.lured = s.creatures.filter((c) => c.tag === "onda1" && c.type === "riscador" && c.state === "lured").length;
  r.say(`Riscadores atraídos para a oficina: ${r.data.lured}`);
  const hp0 = s.hp, t0 = s.t;
  const end = s.t + 6;
  a.moveTo({ x: 75, y: 0, z: -1.6 }, true);
  while (!a.arrived(0.8) && s.t < end) {
    yield;
  }
  r.data.reachedKiosk = a.arrived(0.8);
  const riscHits = s.hurtLog.filter((h) => h.t >= t0 && h.src === "riscador").length;
  r.data.riscadorHitsDuringCross = riscHits;
  r.data.hpLost = hp0 - s.hp;
  r.say(`chegou ao quiosque: ${r.data.reachedKiosk}; golpes de Riscador na travessia: ${riscHits}`);
  a.fight = true;
  void ar;
}

// ---------------------------------------------------------------- F2
import { F2Script, F2_POINTS } from "./levels/f2";
const f2 = (s: Sim) => s.script as unknown as F2Script;

/** Pega o Fole na bancada sob a placa de gelo. */
export function* f2TakeFole(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  a.fight = false; // o Véu da passagem fica para a demonstração do Fole
  yield* r.goto({ x: 19.6, y: 0, z: 4.3 });
  a.aimOverride = F2_POINTS.fole; yield; yield;
  a.push({ interact: true }); yield; a.aimOverride = null;
  yield* r.until(() => !!s.flags.fole, 2, "Fole");
  r.data.foleMag = s.arsenal.ammo("fole")?.mag;
  r.say(`pegou o Fole (${s.arsenal.ammo("fole")?.mag}/${s.arsenal.ammo("fole")?.reserve})`);
  a.fight = true;
}

/** Por baixo, com o Fole: espera a névoa, sopra, atravessa a passagem e derruba o Véu. */
export function* f2LowPassage(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  a.weapon = "fole"; a.fight = false;
  yield* r.goto({ x: 21, y: 0, z: 0 });
  const veu = s.creatures.find((c) => c.tag === "veu-passagem")!;
  yield* r.until(() => s.clouds.length > 0, 12, "nuvem do Véu");
  r.data.cloudAt = s.t;
  yield* r.wait(0.7);
  r.data.densityBefore = s.cloudDensity({ x: 26, y: 1, z: 0 });
  a.aimOverride = veu.center(); yield; yield;
  a.push({ altPressed: true }); yield; yield;
  a.aimOverride = null;
  r.data.densityAfterSopro = s.cloudDensity({ x: 26, y: 1, z: 0 });
  r.say(`sopro: névoa ${r.data.densityBefore.toFixed(2)} → ${r.data.densityAfterSopro.toFixed(2)}`);
  a.fight = true;
  // atravessa pela passagem baixa enquanto a névoa está afastada, derrubando o Véu com o leque
  a.moveTo({ x: 31.5, y: 0, z: 0 }, true);
  const end = s.t + 25;
  while (veu.alive || !a.arrived(0.9)) {
    if (s.t > end) throw new Error(`passagem: véu ${veu.state} hp ${veu.hp} lia ${s.player.pos.x.toFixed(1)},${s.player.pos.z.toFixed(1)}`);
    if (!s.alive) throw new Error("morreu na passagem");
    if (!veu.alive && !a.goal) a.moveTo({ x: 31.5, y: 0, z: 0 });
    yield;
  }
  r.data.veuKilledBy = s.arsenal.current;
  r.data.lowRoute = !f2(s).routeHigh;
  r.say(`passou por baixo; Véu derrubado (${r.data.veuKilledBy})`);
  a.weapon = null;
}

/** Por cima, com a Agulha: escada, passarela de serviço, ponte e toldo. */
export function* f2HighRoute(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  a.weapon = "agulha";
  a.fight = false;
  yield* r.goto({ x: 4.8, y: 0, z: -0.8 });
  yield* r.goto({ x: 4.8, y: 2.4, z: -7 });
  r.say("subiu a escada da peixaria");
  yield* r.goto({ x: 22.5, y: 2.4, z: -7 });
  r.data.gotDarts = s.pickups.find((p) => p.id === "dardos-passarela-f2")?.taken;
  // marca o Véu de cima (se estiver à vista) e segue
  const veu = s.creatures.find((c) => c.tag === "veu-passagem");
  yield* r.goto({ x: 33, y: 2.4, z: -7 });
  if (veu?.alive && !s.world.blocked(s.player.eyePos(), veu.center(), ["solid", "grate", "ceiling"])) {
    a.aimOverride = veu.center(); yield; yield; a.push({ altPressed: true }); yield; yield; a.aimOverride = null;
    r.data.markedVeu = veu.markT > 0;
  }
  yield* r.goto({ x: 40, y: 2.4, z: -3 });
  r.data.routeHigh = f2(s).routeHigh;
  r.say(`atravessou por cima (toldo): ${r.data.routeHigh}`);
  a.fight = true;
}

/** Banca azul: luta, registro da praça, corredor de gelo e abrigo F2-B. */
export function* f2Praca(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  if (s.player.pos.y > 1.5) yield* r.goto({ x: 45, y: 0, z: 4.5 });
  else yield* r.goto({ x: 38, y: 0, z: 2 });
  const ar = f2(s).arena!;
  yield* r.until(() => ar.state !== "idle", 4, "luta da praça");
  const end = s.t + 150;
  while (ar.state !== "cleared") {
    if (s.t > end) throw new Error("praça não liberou: " + ar.blockReason());
    if (!s.alive) throw new Error("morreu na praça");
    const hostile = s.creatures.filter((c) => c.alive && c.state !== "emerging" && c.pos.x > 29);
    if (!a.target() && hostile.length) a.moveTo(hostile[0].pos); else if (!hostile.length) a.moveTo({ x: 44, y: 0, z: 3 }); else a.stop();
    if (s.hp < 50 && s.medkits > 0 && s.healT < 0) a.push({ heal: true });
    yield;
  }
  r.data.pracaSpawns = ar.spawnLog.map((x) => `${x.type}@${x.door}`);
  r.say(`praça limpa (vida ${Math.ceil(s.hp)})`);
  yield* r.goto({ x: 54.3, y: 0, z: -4.5 });
  a.aimOverride = F2_POINTS.registro1; yield; yield;
  a.push({ interact: true }); yield; a.aimOverride = null;
  yield* r.until(() => !!s.flags.registro1, 2, "registro 1");
  yield* r.wait(1.2);
  r.say("registro da praça aberto");
  yield* r.goto({ x: 62, y: 0, z: 0 });
  yield* r.goto({ x: 72.5, y: 0, z: 2.6 });
  yield* r.until(() => !!s.flags.abrigoB, 2, "abrigo F2-B");
  r.say(`abrigo F2-B (vida ${Math.ceil(s.hp)})`);
}

/** Casa da boia: registro 2 na plataforma, abertura de 8 s e saída com um comum vivo. */
export function* f2Boia(r: PlanRunner, leaveAlive = true): Plan {
  const s = r.sim, a = r.auto, sc = f2(s);
  yield* r.goto({ x: 75, y: 0, z: 0 });
  yield* r.goto({ x: 79.2, y: 0, z: 0 });
  yield* r.until(() => sc.arena2?.state !== "idle", 3, "luta da casa da boia");
  // sobe direto ao registro; com leaveAlive, sem parar para lutar (fuga com comuns vivos)
  a.fight = !leaveAlive;
  yield* r.goto({ x: 79.2, y: 2.4, z: -7.6 }, { timeout: 60 });
  yield* r.goto({ x: 99.4, y: 2.4, z: -8.4 }, { timeout: 60 });
  a.fight = false;
  a.aimOverride = F2_POINTS.registro2; yield; yield;
  a.push({ interact: true }); yield; a.aimOverride = null;
  a.fight = !leaveAlive;
  yield* r.until(() => sc.gateT >= 0, 2, "registro 2");
  r.data.objectiveDuringGate = s.objective;
  r.say("registro 2: comporta abrindo");
  const t0 = s.t;
  // defende a plataforma durante a abertura, deixando ao menos um comum vivo para a fuga
  const gEnd = s.t + 12;
  while (sc.gateT < F2_POINTS.gateTime) {
    if (!s.alive) throw new Error("morreu durante a abertura da comporta");
    if (s.t > gEnd) throw new Error("comporta não abriu");
    const alive = s.creatures.filter((c) => c.alive).length + sc.arena2!.pending.length;
    a.fight = !leaveAlive || alive > 1;
    if (s.hp < 50 && s.medkits > 0 && s.healT < 0) a.push({ heal: true });
    yield;
  }
  r.data.gateSecs = +(s.t - t0).toFixed(2);
  r.data.segments = sc.segmentsLit;
  if (!leaveAlive) { yield* r.until(() => sc.arena2!.pending.length === 0, 20, "entradas"); yield* r.clear(40, 120, { x: 90, y: 0, z: 0 }); }
  a.fight = false;
  if (s.hp < 60 && s.medkits > 0) { a.push({ heal: true }); yield* r.wait(1.2); }
  r.data.aliveBeforeExit = s.creatures.filter((c) => c.alive).length;
  yield* r.goto({ x: 79.2, y: 2.4, z: -6.6 }, { sprint: true, timeout: 40 });
  yield* r.goto({ x: 79.2, y: 0, z: -0.6 }, { sprint: true, timeout: 20 });
  yield* r.goto({ x: 101.5, y: 0, z: 4 }, { sprint: true, timeout: 30 });
  a.moveTo({ x: 110, y: 0, z: 4 }, true);
  yield* r.until(() => s.done, 20, "batente da comporta");
  r.data.aliveAtExit = sc.aliveAtExit;
  r.say(`cruzou o batente com ${sc.aliveAtExit} comum(ns) vivo(s)`);
}

/** F2 inteira por uma das rotas. */
export function* f2Full(r: PlanRunner, route: "baixo" | "cima"): Plan {
  yield* f2TakeFole(r);
  if (route === "baixo") yield* f2LowPassage(r); else yield* f2HighRoute(r);
  yield* f2Praca(r);
  yield* f2Boia(r);
}

// ---------------------------------------------------------------- F3
import { F3Script, F3_POINTS } from "./levels/f3";
import { BADALO } from "./config";
const f3 = (s: Sim) => s.script as unknown as F3Script;

/** Pega o Tear na bancada da galeria dos filtros. */
export function* f3TakeTear(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  yield* r.goto({ x: 5.25, y: 0, z: -3.3 });
  a.aimOverride = F3_POINTS.tear; yield; yield;
  a.push({ interact: true }); yield; a.aimOverride = null;
  yield* r.until(() => !!s.flags.tear, 2, "Tear");
  r.say(`pegou o Tear (${s.arsenal.ammo("tear")?.mag}/${s.arsenal.ammo("tear")?.reserve})`);
}

/** Galeria dos filtros: estica a linha do Tear na faixa e derruba os dois Riscadores. */
export function* f3Filtros(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  a.weapon = "tear";
  yield* r.goto({ x: 10.2, y: 0, z: 0 });
  yield* r.until(() => s.arsenal.current === "tear" && s.arsenal.state === "ready", 3, "Tear em mãos");
  // espera o primeiro Riscador sair da grelha e estica a linha transversal na faixa, entre ele e Lia
  a.fight = false;
  yield* r.until(() => s.creatures.some((c) => c.tag === "filtro" && c.alive && c.state !== "emerging"), 10, "primeiro Riscador da faixa");
  a.aimOverride = { x: 15.5, y: 0, z: 0 }; yield; yield;
  a.push({ altPressed: true }); yield; yield; a.aimOverride = null;
  r.data.linePlaced = s.tearLines.length > 0;
  r.say(`linha do Tear no piso: ${r.data.linePlaced}`);
  let lineHits = 0;
  const track = () => { for (const l of s.tearLines) lineHits = Math.max(lineHits, l.hit.length); };
  // segura o tiro até o bicho pisar na linha (ou chegar perto)
  yield* r.until(() => { track(); const c = s.creatures.find((x) => x.tag === "filtro" && x.alive); return lineHits > 0 || !c || Math.hypot(c.pos.x - s.player.pos.x, c.pos.z - s.player.pos.z) < 4; }, 6, "Riscador na linha");
  a.fight = true;
  yield* r.until(() => { track(); return s.creatures.filter((c) => c.tag === "filtro").length >= 2; }, 16, "dois Riscadores da faixa");
  const end = s.t + 40;
  while (s.creatures.some((c) => c.tag === "filtro" && c.alive)) {
    track();
    if (s.t > end) throw new Error("faixa não limpou");
    if (!s.alive) throw new Error("morreu na faixa");
    const c = s.creatures.find((x) => x.tag === "filtro" && x.alive)!;
    if (!a.target()) a.moveTo(c.pos); else a.stop();
    yield;
  }
  a.stop();
  r.data.lineHits = lineHits;
  r.say(`faixa limpa; passagens pela linha: ${lineHits}`);
  yield* r.goto({ x: 29, y: 0, z: 0 });
  a.weapon = null;
}

/** Batente amarelo: leva a Carapaça a trombar no batente, derruba-a e liga a bomba 1. */
export function* f3Batente(r: PlanRunner, kill = true): Plan {
  const s = r.sim, a = r.auto;
  const car = s.creatures.find((c) => c.type === "carapaca")!;
  a.fight = false;
  yield* r.goto({ x: 36.6, y: 0, z: -1.5 });
  a.aimOverride = car.center(); yield; yield; a.aimOverride = null;
  a.fight = true;
  yield* r.until(() => car.state === "open" || !car.alive, 25, "Carapaça no batente");
  r.data.carapacaOpenedAt = s.t; r.say(`carapaça ${car.state} vivo ${car.alive} hp ${car.hp} pos ${car.pos.x.toFixed(1)},${car.pos.z.toFixed(1)}`);
  r.say(`Carapaça trombou no batente (placas abertas): ${car.state === "open"}`);
  if (kill) {
    const end = s.t + 60;
    while (car.alive) {
      if (s.t > end) throw new Error(`Carapaça não caiu (${car.hp})`);
      if (!s.alive) throw new Error("morreu para a Carapaça");
      // fica atrás do batente: cada investida termina nele
      if (Math.hypot(s.player.pos.x - 36.6, s.player.pos.z + 1.5) > 1.2) a.moveTo({ x: 36.6, y: 0, z: -1.5 }); else a.stop();
      if (s.hp < 45 && s.medkits > 0 && s.healT < 0) a.push({ heal: true });
      yield;
    }
    r.data.carapacaKilled = true;
    r.data.carapacaOpens = f3(s).carapacaOpened;
    r.say(`Carapaça derrubada (aberturas: ${r.data.carapacaOpens})`);
  }
  a.fight = false;
  yield* r.goto({ x: 47.5, y: 0, z: -6.6 }, { timeout: 30 });
  a.aimOverride = F3_POINTS.bomba1; yield; yield;
  a.push({ interact: true }); yield; a.aimOverride = null;
  yield* r.until(() => !!s.flags.bomba1, 2, "bomba 1");
  yield* r.until(() => !s.world.get("persiana-galeria")!.enabled, 3, "persiana da galeria");
  r.say("bomba 1 ligada; persiana aberta");
  a.fight = true;
}

/** Galeria baixa: escada de serviço, passarela, curva em U (pico), bomba 2 e abrigo do poço. */
export function* f3Galeria(r: PlanRunner, route: "passarela" | "margem" = "passarela"): Plan {
  const s = r.sim, a = r.auto, sc = f3(s);
  const fightHere = function* (radius: number, secs: number) {
    const end = s.t + secs;
    for (;;) {
      const pend = (sc.arenaGal?.pending.length ?? 0) + (sc.arenaPico?.pending.length ?? 0);
      const hostile = s.creatures.filter((c) => c.alive && c.state !== "emerging" && c.type !== "badalo" && Math.hypot(c.pos.x - s.player.pos.x, c.pos.z - s.player.pos.z) < radius);
      if (!hostile.length && !pend) break;
      if (s.t > end) throw new Error("galeria não limpou");
      if (!s.alive) throw new Error("morreu na galeria");
      if (!a.target() && hostile.length) a.moveTo(hostile[0].pos); else a.stop();
      if (s.hp < 50 && s.medkits > 0 && s.healT < 0) a.push({ heal: true });
      yield;
    }
    a.stop();
  };
  yield* r.goto({ x: 53.2, y: 0, z: 0.5 });
  yield* r.until(() => sc.arenaGal?.state !== "idle", 3, "travessia da galeria");
  if (route === "passarela") {
    yield* r.goto({ x: 56, y: 2.6, z: -6.8 }, { timeout: 30 });
    yield* fightHere(18, 90);
    yield* r.goto({ x: 70, y: 2.6, z: -6.8 }, { timeout: 30 });
    yield* r.goto({ x: 78, y: 2.6, z: -6 }, { timeout: 30 });
    yield* r.until(() => !!s.flags.pico, 2, "pico da curva");
    r.data.pico = true;
    r.say("pisou na curva: pico (rampa + abertura)");
    yield* fightHere(30, 120);
    yield* r.goto({ x: 77.4, y: 0, z: 3.4 }, { timeout: 30 });
  } else {
    yield* r.goto({ x: 60, y: 0, z: 6 }, { timeout: 30 });
    yield* fightHere(20, 90);
    yield* r.goto({ x: 76.5, y: 0, z: 6.2 }, { timeout: 30 });
  }
  yield* r.goto({ x: 77.2, y: 0, z: 6.2 }, { timeout: 20 });
  a.fight = false; a.aimOverride = F3_POINTS.bomba2; yield; yield;
  a.push({ interact: true }); yield; a.aimOverride = null; a.fight = true;
  yield* r.until(() => !!s.flags.bomba2, 2, "bomba 2");
  yield* r.until(() => !s.world.get("porta-abrigo")!.enabled, 3, "porta do abrigo");
  r.say("bomba 2 ligada; duas lâmpadas; abrigo aberto");
  a.fight = false;
  yield* r.goto({ x: 79, y: 0, z: 0 }, { timeout: 20 });
  yield* r.goto({ x: 83, y: 0, z: 0 }, { timeout: 20 });
  yield* r.until(() => !!s.flags.abrigoB, 2, "abrigo F3-B");
  a.fight = true;
  r.say(`abrigo do poço (vida ${Math.ceil(s.hp)})`);
}

/**
 * Badalo. "posicao": espera sobre a placa e sai depois da trava; "baliza": pulsa a baliza sobre a placa
 * enquanto ele se inclina; "alterna": um ciclo de cada. `stopAtHalf` para logo depois da transição.
 */
export function* f3Boss(r: PlanRunner, method: "posicao" | "baliza" | "alterna" = "alterna", stopAtHalf = false): Plan {
  const s = r.sim, a = r.auto, sc = f3(s);
  const P = F3_POINTS.plates;
  yield* r.goto({ x: 88.8, y: 0, z: 0 }, { timeout: 20 });
  yield* r.until(() => sc.bossStarted, 2, "chefe acordou");
  const b = sc.boss!;
  r.say("Badalo: entrada (batida livre na placa norte)");
  let cycle = 0, called = false, lastState = "";
  const end = s.t + 400;
  const nearestPlate = () => { let bi = 0, bd = 1e9; P.forEach((p, i) => { const d = Math.hypot(p.x - s.player.pos.x, p.z - s.player.pos.z); if (d < bd) { bd = d; bi = i; } }); return bi; };
  while (b.alive) {
    if (s.t > end) throw new Error(`chefe não caiu (${b.state} ${Math.ceil(b.hp)})`);
    if (!s.alive) throw new Error(`morreu no chefe (${b.state} ${Math.ceil(b.hp)})`);
    if (stopAtHalf && b.halfDone && s.creatures.some((c) => c.tag === "transicao")) { r.data.atHalf = true; return; }
    if (b.state !== lastState) { lastState = b.state; if (b.state === "tilt") { cycle++; called = false; } }
    const useBeacon = method === "baliza" || (method === "alterna" && sc.stuckBy.baliza < sc.stuckBy.lia);
    const commons = s.creatures.filter((c) => c.alive && c.type !== "badalo" && c.state !== "emerging");
    if (s.hp < 50 && s.medkits > 0 && s.healT < 0) a.push({ heal: true });
    const ag = s.arsenal.ammo("agulha");
    if (ag && ag.reserve < 30 && sc.dispenserT <= 0 && b.state !== "stuck" && b.state !== "tilt" && !commons.length) {
      a.fight = false; yield* r.goto({ x: 87.4, y: 0, z: -11.6 }, { timeout: 15 });
      a.aimOverride = F3_POINTS.dispenser; yield; yield; a.push({ interact: true }); yield; a.aimOverride = null; a.fight = true;
      continue;
    }
    if (b.state === "wave") {
      const d = Math.hypot(s.player.pos.x - b.pos.x, s.player.pos.z - b.pos.z);
      if (d > b.waveR && d - b.waveR < 1.25 && s.player.grounded) a.push({ jump: true });
      yield; continue;
    }
    if (b.state === "stuck") { a.fight = true; a.stop(); yield; continue; }
    if (commons.length) { a.fight = true; if (!a.target()) a.moveTo(commons[0].pos); else a.stop(); yield; continue; }
    if (b.state === "tilt" || b.state === "intro" || b.state === "drop") {
      if (b.locked && b.lockSrc === "lia" && b.lockPos) {
        // travou o ponto de Lia: sai do círculo de impacto
        const dx = s.player.pos.x - 100, dz = s.player.pos.z, l = Math.hypot(dx, dz) || 1;
        const esc = { x: s.player.pos.x - (dz / l) * 4.6, y: 0, z: s.player.pos.z + (dx / l) * 4.6 };
        if (!a.goal || Math.hypot(a.goal.x - esc.x, a.goal.z - esc.z) > 2) a.moveTo(esc, true);
      } else if (useBeacon && !called && s.beacon.state === "armed" && Math.hypot(s.beacon.pos.x - b.pos.x, s.beacon.pos.z - b.pos.z) <= BADALO.hearRadius - 0.3) {
        a.push({ beacon: true }); called = true;
      }
      yield; continue;
    }
    // ocioso / subindo: prepara o próximo ciclo
    a.fight = true;
    const pi = nearestPlate();
    const plate = P[pi];
    if (useBeacon) {
      if (s.beacon.state === "ready" && Math.hypot(plate.x - s.player.pos.x, plate.z - s.player.pos.z) < 12) { a.fight = false; yield* r.throwBeacon(plate); a.fight = true; continue; }
      // fica logo atrás da placa (lado de fora): o sino vem atrás de Lia e passa por cima da baliza
      const ox = plate.x - 100, oz = plate.z, ol = Math.hypot(ox, oz) || 1;
      const stand = { x: plate.x + (ox / ol) * 2.4, y: 0, z: plate.z + (oz / ol) * 2.4 };
      if (Math.hypot(stand.x - s.player.pos.x, stand.z - s.player.pos.z) > 1) a.moveTo(stand); else a.stop();
    } else {
      if (Math.hypot(plate.x - s.player.pos.x, plate.z - s.player.pos.z) > 0.4) a.moveTo(plate); else a.stop();
    }
    yield;
  }
  r.data.stuck = { ...sc.stuckBy };
  r.data.transitions = sc.transitions;
  r.data.bossSecs = +sc.bossT.toFixed(1);
  r.say(`Badalo caiu em ${r.data.bossSecs}s; quedas nas placas ${JSON.stringify(sc.stuckBy)}; transições ${sc.transitions}`);
  yield* r.until(() => !s.world.get("grade-tunel")!.enabled, 2, "grade do túnel");
}

/** Túnel de inspeção até a boca de visita. */
export function* f3Exit(r: PlanRunner): Plan {
  const s = r.sim, a = r.auto;
  a.fight = true;
  yield* r.clear(30, 30);
  a.fight = false;
  yield* r.goto({ x: 112, y: 0, z: 0 }, { timeout: 25 });
  r.data.waterAtTunnel = s.vars.agua;
  yield* r.goto({ x: 138.5, y: 0, z: 0 }, { timeout: 30 });
  yield* r.until(() => s.done, 2, "saída de inspeção");
  r.say("saiu pela boca de visita");
}

export function* f3Full(r: PlanRunner, route: "passarela" | "margem" = "passarela", method: "posicao" | "baliza" | "alterna" = "alterna"): Plan {
  yield* f3TakeTear(r);
  yield* f3Filtros(r);
  yield* f3Batente(r);
  yield* f3Galeria(r, route);
  yield* f3Boss(r, method);
  yield* f3Exit(r);
}
