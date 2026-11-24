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
