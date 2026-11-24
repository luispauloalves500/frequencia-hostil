import { describe, expect, it } from "vitest";
import { DT } from "../src/config";
import { Sim, emptyFrame, type FrameInput } from "../src/core/sim";
import { makeLab } from "../src/levels/lab";
import { F1 } from "../src/levels/f1";
import { yawTo } from "../src/core/math";

function step(s: Sim, secs: number, inp: Partial<FrameInput> = {}, each?: () => void) {
  for (let i = 0; i < Math.round(secs / DT); i++) { s.tick(DT, { ...emptyFrame(), ...inp }); each?.(); }
}
function aimAt(s: Sim, p: { x: number; y: number; z: number }) {
  const e = s.player.eyePos();
  s.player.yaw = yawTo(e, p);
  s.player.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z));
}

describe("D01 • Riscador", () => {
  it("cai com três dardos", () => {
    const s = new Sim(makeLab("d01")); s.start("start");
    const c = s.creatures[0];
    c.passive = true; // parado para a contagem
    let hits = 0;
    for (let i = 0; i < 40 && c.alive; i++) {
      aimAt(s, c.center());
      s.tick(DT, { ...emptyFrame(), firePressed: true });
      for (const e of s.drain()) if (e.type === "shot" && e.hit) hits++;
      step(s, 0.2);
    }
    expect(c.alive).toBe(false);
    expect(hits).toBe(3);
    expect(s.arsenal.ammo()!.mag).toBe(21);
  });
  it("errar permite receber dano, morrer e repetir sem duplicar o inimigo", () => {
    const s = new Sim(makeLab("d01")); s.start("start");
    let t = 0;
    while (s.alive && t < 90) { step(s, 0.1, { fwd: s.player.pos.x < 20 ? 1 : 0 }); t += 0.1; }
    expect(s.alive).toBe(false);
    const ev = s.drain();
    expect(ev.some((e) => e.type === "hurt" && e.src === "riscador")).toBe(true);
    s.start("start");
    expect(s.creatures.length).toBe(1);
    expect(s.hp).toBe(100);
  });
});

describe("D02 • baliza, grade e parede", () => {
  it("atrás da grade a criatura escuta; atrás da parede sólida mantém a patrulha", () => {
    const s = new Sim(makeLab("d02")); s.start("start");
    const grade = s.creatures.find((c) => c.tag === "grade")!;
    const parede = s.creatures.find((c) => c.tag === "parede")!;
    // lança na marca do lado da grade
    s.player.place({ x: 24, y: 0, z: 0 }, 0);
    aimAt(s, { x: 27, y: 0, z: -3 });
    step(s, DT, { beacon: true }); step(s, 0.6);
    expect(s.beacon.state).toBe("armed");
    step(s, DT, { beacon: true });
    step(s, 2.4);
    expect(grade.state).toBe("lured");
    expect(grade.pos.z).toBeGreaterThan(-7.5); // encostou na grade
    step(s, 6);
    // agora do lado da parede
    aimAt(s, { x: 27, y: 0, z: 3 });
    step(s, DT, { beacon: true }); step(s, 0.6); step(s, DT, { beacon: true });
    step(s, 2);
    expect(parede.state).not.toBe("lured");
    expect(Math.abs(parede.pos.z - 9)).toBeLessThan(3.5);
  });
});

describe("F1 • estrutura", () => {
  it("monta a fase, o trinco acústico abre com o pulso perto da marca", () => {
    const s = new Sim(F1); s.start("F1-A");
    expect(s.interactables.some((i) => i.id === "armario")).toBe(true);
    s.interactables.find((i) => i.id === "armario")!.use();
    expect(s.beacon.state).toBe("ready");
    s.player.place({ x: 30, y: 0, z: -1 }, 0);
    aimAt(s, { x: 34.5, y: 0, z: 0.5 });
    step(s, DT, { beacon: true }); step(s, 0.6); step(s, DT, { beacon: true });
    step(s, 2.5);
    expect(s.flags.trinco).toBe(true);
    expect(s.world.get("porta-servico")!.enabled).toBe(false);
    const demo = s.creatures.filter((c) => c.tag === "demo");
    expect(demo.every((c) => c.pos.z > 3)).toBe(true); // permanecem na ala fechada
    expect(demo.some((c) => c.state === "lured")).toBe(true);
  });
  it("F1-B recria o estado: tutorial concluído, trinco aberto, divisória fechada, ondas armadas", () => {
    const s = new Sim(F1); s.start("F1-A");
    s.interactables.find((i) => i.id === "armario")!.use();
    const cp = s.checkpoint("F1-B"); cp.flags = { ...cp.flags, trinco: true, abrigoB: true, tutorial: true };
    const r = new Sim(F1); r.start("F1-B", cp);
    expect(r.world.get("porta-servico")!.enabled).toBe(false);
    expect(r.world.get("divisoria")!.enabled).toBe(true);
    expect(r.creatures.length).toBe(0);
    expect(r.beacon.state).toBe("ready");
    expect(r.arsenal.ammo("agulha")).toBeTruthy();
    const nav = r.nav;
    expect(nav.reachable({ x: 58.4, y: 0, z: 5 }, { x: 87, y: 0, z: 1.6 })).toBe(true);
    expect(nav.reachable({ x: 58.4, y: 0, z: 5 }, { x: 75, y: 2.4, z: -7 })).toBe(true); // escada → passarela
    expect(nav.reachable({ x: 75, y: 2.4, z: -7 }, { x: 83, y: 0, z: 4 })).toBe(true); // rampa → térreo
  });
});
