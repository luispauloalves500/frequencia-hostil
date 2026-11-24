import { describe, expect, it } from "vitest";
import { DT } from "../src/config";
import { Sim } from "../src/core/sim";
import { Autopilot } from "../src/autopilot";
import { PlanRunner, tutorialToShelter, finishPraca, dieInWave2, quickOpening, overTheTop, soundDetour, type Plan } from "../src/scenarios";
import { F1, F1Script } from "../src/levels/f1";
import { MemoryKV, SaveStore } from "../src/core/save";

function run(sim: Sim, factory: (r: PlanRunner) => Plan, maxSecs = 600) {
  const auto = new Autopilot(sim);
  const r = new PlanRunner(sim, auto, factory);
  const saves: string[] = [];
  for (let i = 0; i < maxSecs / DT && !r.done; i++) {
    r.step();
    sim.tick(DT, auto.next());
    for (const e of sim.drain()) if (e.type === "save") saves.push(e.point);
  }
  return { r, saves };
}

describe("F1 completa (simulação sem navegador)", () => {
  it("tutorial até F1-B pelo fluxo normal", () => {
    const sim = new Sim(F1); sim.start("F1-A");
    const { r, saves } = run(sim, tutorialToShelter, 400);
    console.log(r.log.join("\n"));
    expect(r.error).toBe("");
    expect(r.done && r.ok).toBe(true);
    expect(r.data.crouchedUnderShutter).toBe(true);
    expect(r.data.demoLured).toBeGreaterThanOrEqual(1);
    expect(saves).toContain("F1-B");
  }, 60000);

  it("morre na onda 2, retoma em F1-B com as ondas rearmadas e conclui pelo térreo e pela passarela", () => {
    const sim = new Sim(F1); sim.start("F1-A");
    run(sim, tutorialToShelter, 400);
    const cp = sim.checkpoint("F1-B");
    const kv = new MemoryKV(); const store = new SaveStore(kv);
    store.save({ checkpoint: cp, completed: [], unlocked: ["F1"] });
    const d = run(sim, dieInWave2, 300);
    console.log(d.r.log.join("\n"));
    expect(sim.alive).toBe(false);
    // "fecha e reabre": novo armazenamento lendo o mesmo kv
    for (const route of ["terreo", "passarela"] as const) {
      const loaded = new SaveStore(kv).load()!;
      expect(loaded.checkpoint.point).toBe("F1-B");
      const s2 = new Sim(F1); s2.start("F1-B", loaded.checkpoint);
      const sc = s2.script as unknown as F1Script;
      expect(sc.arena!.state).toBe("idle");
      expect(s2.flags.tutorial).toBe(true);
      expect(s2.world.get("porta-servico")!.enabled).toBe(false);
      const f = run(s2, (r) => finishPraca(r, route), 400);
      console.log(route, f.r.log.join("\n"));
      expect(f.r.error).toBe("");
      expect(s2.done).toBe(true);
      expect(sc.arena!.spawnLog.length).toBe(7);
      expect(sc.panelUsed).toBe(true);
      expect(sc.routeHigh).toBe(route === "passarela");
      expect(s2.maxActiveSeen).toBeLessThanOrEqual(6);
    }
  }, 120000);

  it("praça • abertura rápida: a onda 2 aguarda 8 s e ocorre uma vez", () => {
    const sim = new Sim(F1); sim.start("F1-B", { ...new Sim(F1).checkpoint("F1-B"), weapons: { agulha: { mag: 24, reserve: 48 } }, current: "agulha", hasBeacon: true, flags: { trinco: true, abrigoB: true, tutorial: true } });
    const { r } = run(sim, quickOpening, 120);
    console.log(r.log.join("\n"));
    expect(r.data.wave2At).toBeGreaterThanOrEqual(8);
    expect(r.data.telegraphs).toBe(4);
    expect(r.data.wave2Spawns).toBe(4);
  }, 60000);

  const fresh = () => { const sim = new Sim(F1); sim.start("F1-B", { ...new Sim(F1).checkpoint("F1-B"), weapons: { agulha: { mag: 24, reserve: 48 } }, current: "agulha", hasBeacon: true, flags: { trinco: true, abrigoB: true, tutorial: true } }); return sim; };

  it("praça • por cima: escada, dardos e rampa com inimigo da onda 1 vivo", () => {
    const sim = fresh();
    const { r } = run(sim, overTheTop, 60);
    console.log(r.log.join("\n"));
    expect(r.error).toBe("");
    expect(r.data.gotDarts).toBe(true);
    expect(r.data.reserveGain).toBe(24);
    expect(r.data.routeHigh).toBe(true);
    expect(r.data.wave1AliveAtRamp).toBeGreaterThanOrEqual(1);
  }, 60000);

  it("praça • desvio sonoro: baliza na oficina atrai os dois Riscadores e Lia cruza até o quiosque", () => {
    const sim = fresh();
    const { r } = run(sim, soundDetour, 60);
    console.log(r.log.join("\n"));
    expect(r.error).toBe("");
    expect(r.data.lured).toBe(2);
    expect(r.data.reachedKiosk).toBe(true);
    expect(r.data.riscadorHitsDuringCross).toBe(0);
  }, 60000);
});
