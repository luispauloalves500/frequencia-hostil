import { describe, expect, it } from "vitest";
import { DT, MOVE } from "../src/config";
import { PlayerBody, emptyInput } from "../src/core/player";
import { World, box } from "../src/core/world";
import { FixedStep } from "../src/core/fixedStep";

function flat(): World {
  const w = new World();
  w.add(box(-100, -0.5, -100, 100, 0, 100, "azulejo"));
  return w;
}
function run(p: PlayerBody, w: World, secs: number, inp: Partial<ReturnType<typeof emptyInput>>) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) p.step(DT, { ...emptyInput(), ...inp }, w);
}

describe("movimento", () => {
  it("anda a 5,5 m/s e mantém velocidade na diagonal", () => {
    const w = flat();
    const a = new PlayerBody(); a.place({ x: 0, y: 0, z: 0 });
    run(a, w, 1, { fwd: 1 });
    const x0 = a.pos.z; run(a, w, 2, { fwd: 1 });
    expect(Math.abs(a.pos.z - x0) / 2).toBeCloseTo(MOVE.walk, 1);
    const b = new PlayerBody(); b.place({ x: 0, y: 0, z: 0 });
    run(b, w, 1, { fwd: 1, right: 1 });
    const p0 = { ...b.pos }; run(b, w, 2, { fwd: 1, right: 1 });
    expect(Math.hypot(b.pos.x - p0.x, b.pos.z - p0.z) / 2).toBeCloseTo(MOVE.walk, 1);
  });
  it("corre a 8 m/s sem fôlego e disparar encerra a corrida", () => {
    const w = flat(); const p = new PlayerBody(); p.place({ x: 0, y: 0, z: 0 });
    run(p, w, 1, { fwd: 1, sprint: true });
    const z0 = p.pos.z; run(p, w, 10, { fwd: 1, sprint: true });
    expect(Math.abs(p.pos.z - z0) / 10).toBeCloseTo(MOVE.sprint, 1);
    p.breakSprint(); run(p, w, 0.5, { fwd: 1, sprint: true });
    expect(p.sprinting).toBe(false);
    run(p, w, 0.1, { fwd: 1, sprint: false }); run(p, w, 0.1, { fwd: 1, sprint: true });
    expect(p.sprinting).toBe(true);
  });
  it("pula 1 m", () => {
    const w = flat(); const p = new PlayerBody(); p.place({ x: 0, y: 0, z: 0 });
    let maxY = 0;
    p.step(DT, { ...emptyInput(), jump: true }, w);
    for (let i = 0; i < 90; i++) { p.step(DT, emptyInput(), w); maxY = Math.max(maxY, p.pos.y); }
    expect(maxY).toBeGreaterThan(0.93); expect(maxY).toBeLessThan(1.05);
    expect(p.grounded).toBe(true);
  });
  it("desliza 0,55 s, até 3,8 m, com intervalo de 1,2 s", () => {
    const w = flat(); const p = new PlayerBody(); p.place({ x: 0, y: 0, z: 0 });
    run(p, w, 0.6, { fwd: 1, sprint: true });
    p.step(DT, { ...emptyInput(), fwd: 1, sprint: true, crouch: true, crouchPressed: true }, w);
    expect(p.sliding).toBe(true);
    let t = DT;
    while (p.sliding) { p.step(DT, { ...emptyInput(), crouch: true }, w); t += DT; }
    expect(t).toBeCloseTo(MOVE.slideDuration, 1);
    expect(p.lastSlideDist).toBeGreaterThan(3.5); expect(p.lastSlideDist).toBeLessThanOrEqual(3.85);
    // durante o intervalo não desliza de novo
    run(p, w, 0.3, { fwd: 1, sprint: true });
    p.step(DT, { ...emptyInput(), fwd: 1, sprint: true, crouch: true, crouchPressed: true }, w);
    expect(p.sliding).toBe(false);
    run(p, w, 1.2, { fwd: 1, sprint: true });
    p.step(DT, { ...emptyInput(), fwd: 1, sprint: true, crouch: true, crouchPressed: true }, w);
    expect(p.sliding).toBe(true);
  });
  it("passa sob a persiana só agachado ou deslizando; Ctrl parado agacha", () => {
    const w = flat();
    w.add(box(-5, 1.15, -10.2, 5, 3, -9.8, "persiana"));
    const a = new PlayerBody(); a.place({ x: 0, y: 0, z: -5 });
    run(a, w, 3, { fwd: 1 });
    expect(a.pos.z).toBeGreaterThan(-9.8); // bloqueado em pé
    const b = new PlayerBody(); b.place({ x: 0, y: 0, z: -5 });
    run(b, w, 0.1, { crouch: true }); expect(b.crouching).toBe(true);
    run(b, w, 4, { fwd: 1, crouch: true });
    expect(b.pos.z).toBeLessThan(-10.5);
    // sob a grade não consegue levantar
    const c = new PlayerBody(); c.place({ x: 0, y: 0, z: -10 }); c.crouching = true;
    run(c, w, 0.2, {}); expect(c.crouching).toBe(true);
  });
  it("mesmo deslocamento em 10 s a 30 e 60 quadros/s (≤ 0,2 m)", () => {
    const results: number[] = [];
    for (const fps of [30, 60, 144]) {
      const w = flat(); const p = new PlayerBody(); p.place({ x: 0, y: 0, z: 0 });
      const fs = new FixedStep();
      for (let f = 0; f < 10 * fps; f++) {
        const n = fs.advance(1 / fps);
        for (let i = 0; i < n; i++) p.step(DT, { ...emptyInput(), fwd: 1, right: 0.5 }, w);
      }
      results.push(Math.hypot(p.pos.x, p.pos.z));
    }
    expect(Math.abs(results[0] - results[1])).toBeLessThanOrEqual(0.2);
    expect(Math.abs(results[2] - results[1])).toBeLessThanOrEqual(0.2);
  });
  it("sobe degraus pequenos e colide com paredes", () => {
    const w = flat();
    w.add(box(-2, 0, -3, 2, 0.3, -2.5)); w.add(box(-2, 0, -3.5, 2, 0.6, -3));
    w.add(box(-5, 0, -8, 5, 3, -7.6));
    const p = new PlayerBody(); p.place({ x: 0, y: 0, z: 0 });
    run(p, w, 0.8, { fwd: 1 });
    expect(p.pos.y).toBeGreaterThan(0.25);
    run(p, w, 3, { fwd: 1 });
    expect(p.pos.z).toBeGreaterThan(-7.6);
    expect(p.pos.y).toBeCloseTo(0, 1);
  });
});
