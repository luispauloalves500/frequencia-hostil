import { box, type World } from "../core/world";
import type { Sim } from "../core/sim";
import { floor, stairs, wallX, wallZ } from "./build";
import type { LevelDef } from "./types";

export type LabStage = "d00" | "d01" | "d02";

/** Sala de teste usada por D00–D02. */
export function makeLab(stage: LabStage): LevelDef {
  const d02 = stage === "d02";
  return {
    id: "LAB",
    nome: `Sala de teste (${stage.toUpperCase()})`,
    build(w: World) {
      floor(w, 0, -14, 32, 14, "azulejo");
      wallX(w, 0, 32, -14, 4.5); wallX(w, 0, 32, 14, 4.5);
      wallZ(w, -14, 14, 0, 4.5); wallZ(w, -14, 14, 32, 4.5);
      // pilares
      w.add(box(10, 0, -2.5, 11, 4.5, -1.5, "concreto"));
      w.add(box(10, 0, 1.5, 11, 4.5, 2.5, "concreto"));
      if (stage !== "d00") {
        w.add(box(16, 0, 4, 17.2, 1.1, 5.2, "madeira")); // caixa baixa
      }
      if (d02) {
        // rota alta: escada → passarela norte → rampa que devolve ao térreo (volta ao início)
        stairs(w, 2, 4.4, -4, -11, 2.4, 8, "metal");
        w.add(box(2, 0, -14, 22, 2.4, -11, "metal"));
        stairs(w, 19.6, 22, -3, -11, 2.4, 16, "metal");
        w.add(box(4.4, 2.4, -11.2, 19.6, 3.4, -11, "grade", "grate")); // guarda-corpo vazado
        // célula com grade (o pulso atravessa)
        wallX(w, 24, 31.8, -6, 4.5, [], "grade", 0, "grate");
        wallZ(w, -14, -6, 24, 4.5);
        // célula com parede sólida (o pulso não atravessa)
        wallX(w, 24, 31.8, 6, 4.5);
        wallZ(w, 6, 14, 24, 4.5);
        // bloco para o Estilhaço
        w.add(box(13, 0, 10, 18, 2.4, 14, "metal"));
      }
    },
    spawns: { start: { pos: { x: 4, y: 0, z: 0 }, yaw: -Math.PI / 2 } },
    lights: [
      { pos: { x: 8, y: 4, z: 0 }, color: 0xcfe6ff, intensity: 30, distance: 18, flicker: 0.1 },
      { pos: { x: 22, y: 4, z: 0 }, color: 0xcfe6ff, intensity: 30, distance: 18 },
      { pos: { x: 27, y: 3.5, z: -10 }, color: 0x7fd8ff, intensity: 14, distance: 10 },
      { pos: { x: 27, y: 3.5, z: 10 }, color: 0xffb070, intensity: 14, distance: 10 },
    ],
    decor: [
      { kind: "sign", pos: { x: 16, y: 3.2, z: -13.75 }, rot: 0, text: stage === "d00" ? "SALA DE TESTE • D00" : stage === "d01" ? "SALA DE TESTE • D01" : "SALA DE TESTE • D02", color: 0x9fe8ff },
      ...(d02 ? [
        { kind: "chalk", pos: { x: 27, y: 0.01, z: -3 } },
        { kind: "chalk", pos: { x: 27, y: 0.01, z: 3 } },
        { kind: "sign", pos: { x: 27, y: 4, z: -5.75 }, rot: 0, text: "GRADE", color: 0x7fd8ff },
        { kind: "sign", pos: { x: 27, y: 4, z: 5.75 }, rot: Math.PI, text: "PAREDE", color: 0xffb070 },
      ] : []),
    ],
    ceilings: [{ min: { x: 0, y: 4.5, z: -14 }, max: { x: 32, y: 4.7, z: 14 }, mat: "teto" }],
    env: { fogColor: 0x0b1420, fogDensity: 0.02, ambient: 0.5, hemiSky: 0x3a5a80, hemiGround: 0x101418, sky: false, rain: false, sea: false, music: "lab" },
    script(sim: Sim) {
      return {
        start() {
          sim.setObjective(stage === "d00" ? "Ande pela sala, pause e retome" : stage === "d01" ? "Derrube o Riscador com a Agulha" : "Distraia os Riscadores com a baliza e derrube o Estilhaço marcado");
          if (stage !== "d00") {
            sim.arsenal.give("agulha", 24, 24);
            sim.pickups.push({ id: "lab-dardos", pos: { x: 6, y: 0, z: 10 }, kind: "dardos", amount: 24, taken: false });
          }
          if (stage === "d01") sim.spawnCreature("riscador", { x: 24, y: 0, z: 4 }, { home: { x: 24, y: 0, z: 4 } });
          if (d02) {
            sim.beacon.acquire();
            sim.spawnCreature("riscador", { x: 26, y: 0, z: -7.8 }, { passive: true, tag: "grade", home: { x: 26, y: 0, z: -7.8 } });
            sim.spawnCreature("riscador", { x: 28.4, y: 0, z: -8 }, { passive: true, tag: "grade", home: { x: 28.4, y: 0, z: -8 } });
            sim.spawnCreature("riscador", { x: 27, y: 0, z: 9 }, { passive: true, tag: "parede", home: { x: 27, y: 0, z: 9 } });
            sim.spawnCreature("estilhaco", { x: 15.5, y: 2.4, z: 12 }, { perches: [{ x: 15.5, y: 2.4, z: 12 }, { x: 12, y: 2.4, z: -12.5 }], tag: "estilhaco" });
          }
        },
        update() {},
      };
    },
  };
}

/** Sala temporária identificada como prévia de F2 (o D04 substitui pela fase real). */
export const F2_PREVIEW: LevelDef = {
  id: "F2P",
  nome: "Prévia de F2 • Mercado Afogado",
  build(w) {
    floor(w, 0, -6, 16, 6, "madeira");
    wallX(w, 0, 16, -6, 4); wallX(w, 0, 16, 6, 4); wallZ(w, -6, 6, 0, 4); wallZ(w, -6, 6, 16, 4);
    w.add(box(6, 0, -2, 9, 0.9, 2, "madeira"));
  },
  spawns: { "F2-A": { pos: { x: 2, y: 0, z: 0 }, yaw: -Math.PI / 2 } },
  lights: [{ pos: { x: 8, y: 3.5, z: 0 }, color: 0xffc070, intensity: 25, distance: 14 }],
  decor: [{ kind: "sign", pos: { x: 15.75, y: 2.6, z: 0 }, rot: -Math.PI / 2, text: "PRÉVIA DE F2 • MERCADO AFOGADO", color: 0xffd27a }, { kind: "fish", pos: { x: 15.7, y: 1.4, z: 0 }, rot: -Math.PI / 2 }],
  ceilings: [{ min: { x: 0, y: 4, z: -6 }, max: { x: 16, y: 4.2, z: 6 }, mat: "teto" }],
  env: { fogColor: 0x10161c, fogDensity: 0.03, ambient: 0.45, hemiSky: 0x40506a, hemiGround: 0x15110c, sky: false, rain: false, sea: false, music: "explore" },
  script(sim) {
    return {
      start() { sim.setObjective("Prévia de F2 — o mercado chega no D04"); sim.say("Nara", "A primeira trava abriu. Te espero no mercado, Lia.", 5); },
      update() {},
    };
  },
};
