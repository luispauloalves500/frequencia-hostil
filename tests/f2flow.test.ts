import { describe, expect, it } from "vitest";
import { DT } from "../src/config";
import { Sim } from "../src/core/sim";
import { Autopilot } from "../src/autopilot";
import { PlanRunner, f2Full, f2TakeFole, f2Praca, f2Boia, f2LowPassage, type Plan } from "../src/scenarios";
import { F2, F2Script, F2_POINTS } from "../src/levels/f2";

function run(sim: Sim, factory: (r: PlanRunner) => Plan, maxSecs = 600) {
  const auto = new Autopilot(sim);
  const r = new PlanRunner(sim, auto, factory);
  const saves: string[] = []; const evs: string[] = [];
  for (let i = 0; i < maxSecs / DT && !r.done; i++) {
    r.step();
    sim.tick(DT, auto.next());
    for (const e of sim.drain()) { if (e.type === "save") saves.push(e.point); evs.push(e.type); }
  }
  return { r, saves, evs };
}
const f1Inventory = () => ({ phase: "F2", point: "F2-A", hp: 100, medkits: 2, weapons: { agulha: { mag: 24, reserve: 96 } }, current: "agulha" as const, hasBeacon: true, objective: "", flags: {}, difficulty: "normal" as const, playTime: 600, deaths: 1, stats: { kills: 9, shots: 80, hits: 50, pulses: 2, damageTaken: 40 } });

describe("F2 • Mercado Afogado (simulação)", () => {
  it("por baixo com o Fole, registro da praça, F2-B e saída com um comum vivo", () => {
    const sim = new Sim(F2); sim.start("F2-A", f1Inventory());
    expect(sim.arsenal.ammo("agulha")!.reserve).toBe(96);
    const { r, saves, evs } = run(sim, (x) => f2Full(x, "baixo"), 700);
    console.log(r.log.join("\n"));
    expect(r.error).toBe("");
    expect(r.data.densityBefore).toBeGreaterThan(0.3);
    expect(r.data.densityAfterSopro).toBe(0);
    expect(r.data.lowRoute).toBe(true);
    expect(saves).toContain("F2-B");
    expect(r.data.gateSecs).toBeGreaterThanOrEqual(7.9);
    expect(r.data.gateSecs).toBeLessThanOrEqual(8.2);
    expect(r.data.segments).toBe(4);
    expect(r.data.objectiveDuringGate).toBe("Atravesse a comporta");
    expect(r.data.aliveAtExit).toBeGreaterThanOrEqual(1);
    expect(sim.done).toBe(true);
    expect(evs).toContain("sopro");
    expect(sim.maxActiveSeen).toBeLessThanOrEqual(6);
    expect(sim.stats.kills).toBeGreaterThan(9); // contadores trazidos de F1
  }, 120000);

  it("por cima com a Agulha", () => {
    const sim = new Sim(F2); sim.start("F2-A", f1Inventory());
    const { r } = run(sim, (x) => f2Full(x, "cima"), 700);
    console.log(r.log.join("\n"));
    expect(r.error).toBe("");
    expect(r.data.routeHigh).toBe(true);
    expect(sim.done).toBe(true);
  }, 120000);

  it("reabrir em F2-B: primeiro registro aberto, Fole no arsenal, segundo fechado", () => {
    const sim = new Sim(F2); sim.start("F2-A", f1Inventory());
    run(sim, function* (r) { yield* f2TakeFole(r); yield* f2LowPassage(r); yield* f2Praca(r); }, 500);
    const cp = sim.checkpoint("F2-B");
    const s2 = new Sim(F2); s2.start("F2-B", JSON.parse(JSON.stringify(cp)));
    expect(s2.flags.registro1).toBe(true);
    expect(s2.world.get("porta-corredor")!.enabled).toBe(false);
    expect(s2.arsenal.owned.has("fole")).toBe(true);
    expect((s2.script as unknown as F2Script).gateT).toBe(-1);
    expect(s2.world.get("comporta")!.enabled).toBe(true);
    expect(s2.world.get("divisoria")!.enabled).toBe(true);
    const f = run(s2, (r) => f2Boia(r), 300);
    console.log(f.r.log.join("\n"));
    expect(f.r.error).toBe("");
    expect(s2.done).toBe(true);
    void F2_POINTS;
  }, 120000);
});
