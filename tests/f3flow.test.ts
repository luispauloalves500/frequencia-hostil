import { describe, expect, it } from "vitest";
import { DT } from "../src/config";
import { Sim, emptyFrame } from "../src/core/sim";
import { Autopilot } from "../src/autopilot";
import { PlanRunner, f3Full, f3TakeTear, f3Filtros, f3Batente, f3Galeria, f3Boss, type Plan } from "../src/scenarios";
import { F3, F3Script } from "../src/levels/f3";
import { f3EntryFromF2, defaultF3Entry } from "../src/core/progress";

function run(sim: Sim, factory: (r: PlanRunner) => Plan, maxSecs = 900) {
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
/** Inventário de quem terminou a F2 (Fole incluído, contadores de F1+F2). */
const f2Exit = () => ({ phase: "F2", point: "F2-B", hp: 82, medkits: 2, weapons: { agulha: { mag: 24, reserve: 96 }, fole: { mag: 8, reserve: 16 } }, current: "agulha" as const, hasBeacon: true, objective: "", flags: { fole: true, registro1: true }, difficulty: "normal" as const, playTime: 1300, deaths: 2, stats: { kills: 30, shots: 200, hits: 120, pulses: 4, damageTaken: 90, sopros: 3, foleShots: 10, foleHits: 30 } });
const sc = (s: Sim) => s.script as unknown as F3Script;

describe("F3 • Casa das Bombas (simulação)", () => {
  it("inventário vem da F2: Fole, curativos, vida e baliza; capítulo recomeça", () => {
    const cp = f3EntryFromF2({ ...f2Exit(), phase: "F2" } as any);
    expect(cp.phase).toBe("F3"); expect(cp.point).toBe("F3-A");
    const sim = new Sim(F3); sim.start("F3-A", cp);
    expect(sim.arsenal.ammo("fole")!.reserve).toBe(16);
    expect(sim.arsenal.ammo("agulha")!.reserve).toBe(96);
    expect(sim.arsenal.owned.has("tear")).toBe(false);
    expect(sim.medkits).toBe(2); expect(sim.hp).toBe(82); expect(sim.beacon.owned).toBe(true);
    expect(defaultF3Entry("normal").weapons.fole).toBeTruthy();
  });

  it("partida completa: Tear na faixa, Carapaça no batente, passarela, Badalo pelos dois métodos, saída", () => {
    const sim = new Sim(F3); sim.start("F3-A", f3EntryFromF2(f2Exit() as any));
    const { r, saves, evs } = run(sim, (x) => f3Full(x, "passarela", "alterna"), 1000);
    console.log(r.log.join("\n"));
    expect(r.error).toBe("");
    expect(r.data.linePlaced).toBe(true);
    expect(r.data.lineHits).toBeGreaterThanOrEqual(1);
    expect(r.data.carapacaOpens).toBeGreaterThanOrEqual(1);
    expect(r.data.pico).toBe(true);
    expect(saves).toContain("F3-B");
    expect(r.data.stuck.lia).toBeGreaterThanOrEqual(1);
    expect(r.data.stuck.baliza).toBeGreaterThanOrEqual(1);
    expect(r.data.transitions).toBe(1);
    expect(evs).toContain("bossDead");
    expect(evs).toContain("tearLineHit");
    expect(sim.done).toBe(true);
    expect(sim.maxActiveSeen).toBeLessThanOrEqual(8);
    expect(sim.stats.tearLines).toBeGreaterThanOrEqual(1);
  }, 240000);

  it("pela margem, Badalo só pela baliza", () => {
    const sim = new Sim(F3); sim.start("F3-A", f3EntryFromF2(f2Exit() as any));
    const { r } = run(sim, (x) => f3Full(x, "margem", "baliza"), 1000);
    console.log(r.log.join("\n"));
    expect(r.error).toBe("");
    expect(r.data.pico).toBeUndefined();
    expect(r.data.stuck.baliza).toBeGreaterThanOrEqual(2);
    expect(sim.done).toBe(true);
  }, 240000);

  it("queda depois da transição: F3-B reabre com o chefe inteiro e a transição acontece de novo uma vez", () => {
    const sim = new Sim(F3); sim.start("F3-A", f3EntryFromF2(f2Exit() as any));
    const { r } = run(sim, function* (x) { yield* f3TakeTear(x); yield* f3Filtros(x); yield* f3Batente(x); yield* f3Galeria(x); yield* f3Boss(x, "alterna", true); }, 600);
    expect(r.error).toBe("");
    expect(r.data.atHalf).toBe(true);
    const cp = sim.checkpoint("F3-B");
    expect(cp.weapons.tear).toBeTruthy();
    // morre ali: volta ao abrigo F3-B
    const s2 = new Sim(F3); s2.start("F3-B", JSON.parse(JSON.stringify({ ...cp, flags: { ...sim.flags } })));
    expect(s2.flags.bomba2).toBe(true);
    expect(s2.world.get("porta-abrigo")!.enabled).toBe(false);
    const b2 = sc(s2).boss!;
    expect(b2.hp).toBe(b2.maxHp);
    expect(b2.halfDone).toBeFalsy();
    const r2 = run(s2, (x) => f3Boss(x, "alterna"), 400);
    expect(r2.r.error).toBe("");
    expect(sc(s2).transitions).toBe(1);
    expect(r2.evs.filter((e) => e === "badaloHalf").length).toBe(1);
  }, 240000);

  it("Tear: o fio atravessa dois alvos; linha fora do piso não gasta carga", () => {
    const sim = new Sim(F3); sim.start("F3-B", { ...defaultF3Entry("normal"), point: "F3-B", weapons: { agulha: { mag: 24, reserve: 72 }, tear: { mag: 12, reserve: 24 } }, current: "tear" } as any);
    for (const c of [...sim.creatures]) if (c.type === "badalo") sim.forceKill(c);
    sim.player.pos = { x: 88, y: 0, z: -11 };
    const auto = new Autopilot(sim); auto.fight = false;
    for (let i = 0; i < 60; i++) sim.tick(DT, { ...auto.next(), slot: i === 0 ? 3 : null } as any);
    expect(sim.arsenal.current).toBe("tear");
    const a = sim.spawnCreature("riscador", { x: 91, y: 0, z: -11 }), b = sim.spawnCreature("riscador", { x: 93.5, y: 0, z: -11 });
    for (const c of [a, b]) c.set("idle" as any);
    const hpA = a.hp, hpB = b.hp;
    auto.aimAt({ x: 92.2, y: 0.45, z: -11 });
    sim.tick(DT, { ...auto.next(), firePressed: true, fireHeld: true } as any);
    expect(a.hp).toBeLessThan(hpA);
    expect(b.hp).toBeLessThan(hpB);
    // linha mirando a parede: inválida, carga preservada
    for (let i = 0; i < 30; i++) sim.tick(DT, emptyFrame());
    const mag = sim.arsenal.ammo("tear")!.mag;
    sim.player.pitch = 0.3; sim.drain();
    sim.tick(DT, { ...emptyFrame(), altPressed: true });
    const evs = sim.drain();
    expect(evs.some((e) => e.type === "tearInvalid")).toBe(true);
    expect(sim.arsenal.ammo("tear")!.mag).toBe(mag);
  });
});
