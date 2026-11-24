import { box, type World } from "../core/world";
import type { Sim } from "../core/sim";
import { ArenaDirector, type CreatureType } from "../core/waves";
import { DIFFICULTY } from "../config";
import { floor, stairs, wallX, wallZ } from "./build";
import type { Decor, LevelDef, LightDef } from "./types";
import type { V3 } from "../core/math";

const EAST = -Math.PI / 2;

/** Portas de entrada da arena da catraca. */
export const ARENA_DOORS: Record<string, { spawn: V3; door: V3; label: string }> = {
  oficina: { spawn: { x: 75, y: 0, z: 12.8 }, door: { x: 75, y: 1.2, z: 11 }, label: "Porta da oficina (sul)" },
  superior: { spawn: { x: 78, y: 2.4, z: -8.1 }, door: { x: 78, y: 3.6, z: -8.95 }, label: "Acesso superior (norte)" },
  leste: { spawn: { x: 86.9, y: 2.4, z: -7 }, door: { x: 87.75, y: 3.6, z: -7 }, label: "Acesso leste" },
};
export const PRACA_PERCHES: V3[] = [
  { x: 78, y: 2.4, z: -7.2 }, { x: 68, y: 2.4, z: -7.4 }, { x: 86, y: 2.4, z: -6.2 }, { x: 72, y: 2.4, z: -6.0 },
];
export const WAVE1: { type: CreatureType; door: string }[] = [
  { type: "riscador", door: "oficina" }, { type: "riscador", door: "oficina" }, { type: "estilhaco", door: "superior" },
];
export const WAVE2: { type: CreatureType; door: string }[] = [
  { type: "riscador", door: "oficina" }, { type: "riscador", door: "oficina" }, { type: "riscador", door: "oficina" }, { type: "estilhaco", door: "leste" },
];

export const F1_POINTS = {
  latch: { x: 39.6, y: 1.5, z: -1.2 },
  chalk: { x: 34.5, y: 0, z: 0.5 },
  locker: { x: 5.5, y: 1.3, z: -4.3 },
  panel: { x: 87.55, y: 1.5, z: 1.6 },
  exitX: 98.4,
};

function buildF1(w: World) {
  // 1 · Vestiário (x 0..12)
  floor(w, 0, -5, 12, 5, "azulejo");
  wallX(w, 0, 12, -5, 3.6, [], "azulejo-parede");
  wallX(w, 0, 12, 5, 3.6);
  wallZ(w, -5, 5, 0, 3.6);
  wallZ(w, -5, 5, 12, 3.6, [[-1.2, 1.2]]);
  w.add(box(0.2, 0, -4.8, 4.9, 2.1, -4.2, "armario"));
  w.add(box(6.1, 0, -4.8, 11.8, 2.1, -4.2, "armario"));
  w.add(box(4.9, 0, -4.8, 6.1, 2.1, -4.5, "armario", "solid", "armario-lia"));
  w.add(box(0.2, 0, 4.2, 7, 2.1, 4.8, "armario"));
  w.add(box(3, 0, -0.25, 8, 0.45, 0.25, "madeira"));
  // corredor seco com persiana baixa (agachar ou deslizar)
  floor(w, 12, -1.2, 24, 1.2, "concreto");
  wallX(w, 12, 24, -1.4, 3);
  wallX(w, 12, 24, 1.4, 3);
  w.add(box(17.8, 1.15, -1.2, 18.2, 3, 1.2, "persiana", "solid", "persiana"));

  // 2 · Bilheteria (x 24..40)
  floor(w, 24, -7, 40, 9, "azulejo");
  wallZ(w, -7, 9, 24, 5, [[-1.2, 1.2]]);
  wallX(w, 24, 40, -7, 5);
  wallX(w, 24, 40, 9, 5);
  wallZ(w, -7, 9, 40, 5, [[-2.4, 0]]);
  w.add(box(39.8, 0, -2.4, 40.2, 3, 0, "porta", "solid", "porta-servico"));
  wallX(w, 24.2, 39.8, 3, 4.5, [], "grade", 0, "grate"); // grade da ala fechada
  w.add(box(27.7, 0, -3.3, 28.3, 5, -2.7, "concreto"));
  w.add(box(35.7, 0, -4.3, 36.3, 5, -3.7, "concreto"));
  w.add(box(26, 0, 6.5, 38, 1.1, 7.4, "balcao")); // guichês antigos atrás da grade

  // 3 · Guichê quebrado (x 40..56)
  floor(w, 40, -7, 56, 8, "azulejo");
  wallX(w, 40, 56, -7, 5);
  wallX(w, 40, 56, 8, 5);
  wallZ(w, -7, 2, 56, 5);
  w.add(box(45, 0, -2.5, 51, 1.1, 1.5, "balcao", "solid", "guiche"));
  w.add(box(51.5, 0, -6.8, 55.8, 2.2, -4, "metal")); // prateleira alta leste
  w.add(box(40.2, 0, -6.8, 44, 2.2, -4.5, "metal")); // prateleira alta oeste
  w.add(box(43, 0, 4.5, 44.2, 1.0, 5.7, "madeira"));

  // F1-B · Abrigo (x 56..62, z 2..8)
  floor(w, 56, 2, 62, 8, "madeira");
  wallX(w, 56, 62, 2, 5);
  wallX(w, 56, 62, 8, 5);
  const div = w.add(box(55.8, 0, 2, 56.2, 3.2, 8, "persiana", "solid", "divisoria"));
  div.enabled = false;
  w.add(box(57, 0, 7.2, 60, 0.45, 7.8, "madeira"));

  // 4 · Praça da catraca (x 62..88, z -9..9) — 26 × 18 m
  floor(w, 62, -9, 88, 9, "azulejo");
  wallZ(w, -9, 9, 62, 7, [[2.6, 7.6]]);
  // parede norte com faixa de vidro (vista do porto)
  w.add(box(62, 0, -9.2, 88, 3.4, -8.8, "azulejo-parede"));
  w.add(box(62, 3.4, -9.2, 88, 6, -8.8, "vidro"));
  w.add(box(62, 6, -9.2, 88, 7, -8.8, "azulejo-parede"));
  wallX(w, 62, 88, 9, 7, [[70, 80]]);
  wallZ(w, -9, 9, 88, 7, [[3, 6.4]]);
  w.add(box(87.8, 0, 3, 88.2, 3.2, 6.4, "grade", "grate", "portao"));
  // plataforma alta a 2,4 m
  w.add(box(62.2, 0, -8.8, 87.8, 2.4, -5, "metal", "solid", "plataforma"));
  w.add(box(64.6, 2.4, -5.15, 81.8, 3.4, -4.95, "grade", "grate"));
  w.add(box(84.6, 2.4, -5.15, 87.8, 3.4, -4.95, "grade", "grate"));
  stairs(w, 62.4, 64.4, -1, -5, 2.4, 8, "metal");
  stairs(w, 82, 84.4, 3, -5, 2.4, 16, "metal");
  // quiosque opaco 4 × 3 m
  w.add(box(73, 0, -0.5, 77, 3, 2.5, "quiosque", "solid", "quiosque"));
  // coberturas baixas
  w.add(box(67.4, 0, 3.4, 68.6, 1.1, 4.6, "madeira"));
  w.add(box(79.5, 0, 6.2, 80.7, 1.1, 7.4, "madeira"));
  w.add(box(68, 0, -3.2, 68.8, 7, -2.4, "concreto"));
  // recuo da oficina e oficina
  floor(w, 70, 9, 80, 11, "concreto");
  wallZ(w, 9, 11, 70, 4);
  wallZ(w, 9, 11, 80, 4);
  wallX(w, 70, 80, 11, 4, [[73, 77]]);
  w.add(box(73, 0, 10.85, 77, 3, 11.15, "porta", "solid", "porta-oficina"));
  floor(w, 72, 11, 78, 14.5, "concreto");
  wallX(w, 72, 78, 14.5, 4);
  wallZ(w, 11, 14.5, 72, 4);
  wallZ(w, 11, 14.5, 78, 4);

  // 5 · Embarque (x 88..100)
  floor(w, 88, 2.8, 100, 6.6, "metal");
  wallX(w, 88, 100, 2.8, 3.4);
  wallX(w, 88, 100, 6.6, 3.4);
  wallZ(w, 2.8, 6.6, 100, 3.4);
}

const LIGHTS: LightDef[] = [
  { pos: { x: 6, y: 3.2, z: 0 }, color: 0xa8d4ff, intensity: 14, distance: 12, flicker: 0.25 },
  { pos: { x: 22, y: 2.7, z: 0 }, color: 0xfff0d0, intensity: 16, distance: 9 },
  { pos: { x: 30, y: 4.4, z: -2 }, color: 0x9cc8ff, intensity: 22, distance: 16, flicker: 0.15 },
  { pos: { x: 34, y: 3, z: 5.5 }, color: 0x52e0ff, intensity: 10, distance: 8 },
  { pos: { x: 48, y: 4.4, z: 3 }, color: 0xb0c8e0, intensity: 18, distance: 15, flicker: 0.4 },
  { pos: { x: 53.5, y: 4.2, z: -5.5 }, color: 0x6ad0ff, intensity: 8, distance: 7 },
  { pos: { x: 59, y: 3.6, z: 5 }, color: 0xffa040, intensity: 22, distance: 10, shadow: false },
  { pos: { x: 70, y: 6, z: 0 }, color: 0x8fb0d8, intensity: 30, distance: 22 },
  { pos: { x: 82, y: 6, z: 2 }, color: 0x8fb0d8, intensity: 24, distance: 20, flicker: 0.2 },
  { pos: { x: 75, y: 4.6, z: -7 }, color: 0x7ec8ff, intensity: 16, distance: 12 },
  { pos: { x: 75, y: 3.4, z: 10.2 }, color: 0xff7040, intensity: 10, distance: 8, flicker: 0.5 },
  { pos: { x: 86.5, y: 4.6, z: 4.7 }, color: 0xff3838, intensity: 16, distance: 9, id: "luz-catraca" },
  { pos: { x: 90.5, y: 3.1, z: 4.7 }, color: 0xe8f4ff, intensity: 0, distance: 7, id: "emb-1" },
  { pos: { x: 93.5, y: 3.1, z: 4.7 }, color: 0xe8f4ff, intensity: 0, distance: 7, id: "emb-2" },
  { pos: { x: 96.5, y: 3.1, z: 4.7 }, color: 0xe8f4ff, intensity: 0, distance: 7, id: "emb-3" },
  { pos: { x: 99.3, y: 3.1, z: 4.7 }, color: 0x9fe8ff, intensity: 0, distance: 7, id: "emb-4" },
];

const DECOR: Decor[] = [
  { kind: "window", pos: { x: 6.5, y: 1.6, z: -5.25 }, size: { x: 3, y: 1.1, z: 0.1 } },
  { kind: "lockerLia", pos: { x: 5.5, y: 0, z: -4.5 }, id: "armario-lia" },
  { kind: "sign", pos: { x: 6, y: 3.0, z: 4.75 }, rot: Math.PI, text: "VESTIÁRIO • EQUIPE DE BALIZAS", color: 0xbfe2ff },
  { kind: "arrow", pos: { x: 11.7, y: 2.6, z: 0 }, rot: EAST },
  { kind: "drip", pos: { x: 23, y: 3, z: 0.6 } },
  { kind: "sign", pos: { x: 32, y: 4.2, z: -6.75 }, rot: 0, text: "ÚLTIMA CHAMADA • PLATAFORMA 3", color: 0xff9a3c, id: "letreiro" },
  { kind: "bell", pos: { x: 34, y: 2.6, z: 3.5 }, id: "sino" },
  { kind: "chalk", pos: { x: 34.5, y: 0.01, z: 0.5 } },
  { kind: "hatch", pos: { x: 31, y: 0, z: -6.75 }, id: "alcapao" },
  { kind: "latch", pos: { x: 39.75, y: 1.5, z: -1.2 }, rot: EAST, id: "trinco" },
  { kind: "sign", pos: { x: 39.75, y: 3.3, z: -1.2 }, rot: -Math.PI / 2, text: "SERVIÇO", color: 0xbfe2ff },
  { kind: "glassShards", pos: { x: 48, y: 1.1, z: -0.5 } },
  { kind: "sign", pos: { x: 48, y: 3.6, z: -6.75 }, rot: 0, text: "GUICHÊ • VENDA DE PASSAGENS", color: 0x9fc8ff },
  { kind: "shelterSign", pos: { x: 59, y: 3.2, z: 7.75 }, rot: Math.PI, text: "ABRIGO", color: 0xffb050 },
  { kind: "cot", pos: { x: 58.5, y: 0, z: 3.2 } },
  { kind: "sign", pos: { x: 87.75, y: 5.0, z: 4.7 }, rot: -Math.PI / 2, text: "CATRACA DE SERVIÇO", color: 0xffffff, id: "placa-catraca" },
  { kind: "panel", pos: { x: 87.6, y: 1.5, z: 1.6 }, rot: -Math.PI / 2, id: "painel" },
  { kind: "gateLight", pos: { x: 87.6, y: 3.6, z: 4.7 }, rot: -Math.PI / 2, id: "luz-portao" },
  { kind: "turnstile", pos: { x: 91, y: 0, z: 4.7 } },
  { kind: "sign", pos: { x: 75, y: 6.3, z: -8.75 }, rot: 0, text: "ÚLTIMA CHAMADA • BALSA PORTO DO SAL", color: 0xff9a3c, id: "letreiro2" },
  { kind: "doorFrame", pos: { x: 78, y: 2.4, z: -8.75 }, rot: 0, id: "porta-superior" },
  { kind: "doorFrame", pos: { x: 87.75, y: 2.4, z: -7 }, rot: -Math.PI / 2, id: "porta-leste" },
  { kind: "sign", pos: { x: 75, y: 3.4, z: 10.85 }, rot: 0, text: "OFICINA", color: 0xff8a50 },
  { kind: "fish", pos: { x: 99.75, y: 1.5, z: 4.7 }, rot: -Math.PI / 2, id: "porta-peixe" },
  { kind: "ferry", pos: { x: 50, y: -1.2, z: -42 } },
  { kind: "dock", pos: { x: 60, y: -0.6, z: -20 } },
  { kind: "arrow", pos: { x: 61.8, y: 2.4, z: 5 }, rot: EAST },
];

export const F1: LevelDef = {
  id: "F1",
  nome: "F1 • Última Chamada",
  build: buildF1,
  spawns: {
    "F1-A": { pos: { x: 2.2, y: 0, z: 1.2 }, yaw: EAST },
    "F1-B": { pos: { x: 58.4, y: 0, z: 5 }, yaw: EAST + 0.35 },
  },
  lights: LIGHTS,
  decor: DECOR,
  ceilings: [
    { min: { x: 0, y: 3.6, z: -5 }, max: { x: 12, y: 3.8, z: 5 }, mat: "teto" },
    { min: { x: 12, y: 3, z: -1.4 }, max: { x: 24, y: 3.2, z: 1.4 }, mat: "teto" },
    { min: { x: 24, y: 5, z: -7 }, max: { x: 40, y: 5.2, z: 9 }, mat: "teto" },
    { min: { x: 40, y: 5, z: -7 }, max: { x: 56, y: 5.2, z: 8 }, mat: "teto" },
    { min: { x: 56, y: 5, z: 2 }, max: { x: 62, y: 5.2, z: 8 }, mat: "teto" },
    { min: { x: 70, y: 4, z: 9 }, max: { x: 80, y: 4.2, z: 14.5 }, mat: "teto" },
    { min: { x: 88, y: 3.4, z: 2.8 }, max: { x: 100, y: 3.6, z: 6.6 }, mat: "teto" },
  ],
  env: { fogColor: 0x0a121c, fogDensity: 0.028, ambient: 0.32, hemiSky: 0x34507a, hemiGround: 0x0c0e12, sky: true, rain: true, sea: true, music: "explore" },
  script: (sim: Sim) => new F1Script(sim),
};

export class F1Script {
  arena: ArenaDirector | null = null;
  arenaIds = new Set<string>();
  panelUsed = false;
  exitDone = false;
  timers: { t: number; fn: () => void }[] = [];
  routeHigh = false;
  enteredPraca = false;
  constructor(private sim: Sim) {}

  later(t: number, fn: () => void) { this.timers.push({ t, fn }); }

  start(point: string) {
    const s = this.sim, f = s.flags;
    if (point === "F1-B") { f.armario = true; f.persiana = true; f.trinco = true; f.abrigoB = true; f.tutorial = true; }

    // 1 · Vestiário
    if (!f.armario) {
      s.interactables.push({
        id: "armario", pos: F1_POINTS.locker, radius: 2.4, prompt: "Pegar a Agulha e a baliza", enabled: () => !f.armario,
        use: () => {
          if (f.armario) return;
          f.armario = true;
          s.arsenal.give("agulha", 24, 24);
          s.beacon.acquire();
          s.emit({ type: "equip", what: "agulha+baliza" });
          s.setObjective("Siga a luz do corredor e passe sob a persiana (Ctrl)");
          s.say("Nara", "Tá com a baliza? Ótimo. Segue a luz do corredor. A persiana travou baixa: agacha ou desliza.", 5);
        },
      });
      s.setObjective("Pegue a Agulha e a baliza no armário");
      this.later(0.8, () => s.say("Rádio", "…Lia Vilar, apresente-se no cais… Lia Vilar…", 3.5));
      this.later(4.6, () => s.say("Nara", "Lia, essa não é você. Aqui é a Nara, ao vivo. A comporta ainda tá fechada.", 5));
      this.later(10, () => { if (!f.armario) s.say("Nara", "Teu armário tá aberto. Pega a Agulha e a baliza.", 4); });
    }
    if (point === "F1-A") s.pickups.push({ id: "dardos-vestiario", pos: { x: 10, y: 0, z: 3.4 }, kind: "dardos", amount: 24, taken: false });

    s.triggers.push({ id: "corredor", min: { x: 18.5, y: -1, z: -1.2 }, max: { x: 24, y: 3, z: 1.2 }, once: true, fired: !!f.persiana, onEnter: () => { f.persiana = true; } });

    // 2 · Bilheteria — demonstração da baliza
    if (!f.trinco) {
      s.spawnCreature("riscador", { x: 30, y: 0, z: 5 }, { passive: true, tag: "demo", home: { x: 30, y: 0, z: 5 } });
      s.spawnCreature("riscador", { x: 37, y: 0, z: 5.5 }, { passive: true, tag: "demo", home: { x: 37, y: 0, z: 5.5 } });
      s.triggers.push({
        id: "bilheteria", min: { x: 24.5, y: -1, z: -7 }, max: { x: 40, y: 3, z: 3 }, once: true, fired: false,
        onEnter: () => {
          if (f.trinco) return;
          s.setObjective("Lance a baliza na marca de giz (Q) e chame com Q");
          s.say("Nara", "O trinco da porta de serviço é acústico. Joga a baliza na marca de giz e manda chamar. Quando o sino tocar, olha pro vidro.", 6);
          this.later(14, () => { if (!f.trinco) s.say("Nara", "Primeiro Q lança. Segundo Q chama. A marca de giz tá perto do trinco e dos dois.", 5); });
        },
      });
      s.latches.push({
        id: "trinco", pos: F1_POINTS.latch, open: false,
        onOpen: () => {
          f.trinco = true; f.tutorial = true;
          this.later(0.6, () => { s.world.setEnabled("porta-servico", false); s.emit({ type: "doorOpen", id: "porta-servico", pos: { x: 40, y: 1.2, z: -1.2 } }); });
          s.setObjective("Atravesse a porta de serviço");
          s.say("Nara", "Ouvi o trinco! Cuidado: o barulho chamou mais um.", 4);
          // um Riscador solto invade o mesmo espaço
          this.later(1.6, () => s.emit({ type: "doorVibrate", door: "alcapao", pos: { x: 31, y: 0.5, z: -6.5 } }));
          this.later(2.8, () => {
            if (!s.alive) return;
            const c = s.spawnCreature("riscador", { x: 31, y: 0, z: -5.8 }, { tag: "solto" });
            c.set("emerging");
          });
        },
      });
    } else {
      s.world.setEnabled("porta-servico", false);
    }

    // 3 · Guichê quebrado
    if (!f.abrigoB) {
      s.spawnCreature("riscador", { x: 49, y: 0, z: 5 }, { tag: "guiche", home: { x: 49, y: 0, z: 5 } });
      s.spawnCreature("estilhaco", { x: 53.6, y: 2.2, z: -5.4 }, { tag: "guiche", perches: [{ x: 53.6, y: 2.2, z: -5.4 }, { x: 42.1, y: 2.2, z: -5.6 }] });
      s.triggers.push({
        id: "guiche", min: { x: 40.5, y: -1, z: -7 }, max: { x: 56, y: 3, z: 8 }, once: true, fired: false,
        onEnter: () => {
          s.setObjective("Contorne o guichê até o abrigo");
          s.say("Nara", "Linha de luz é o Estilhaço mirando. Sai da linha ou bota algo sólido no meio.", 5);
        },
      });
    }

    // F1-B · abrigo: salva e fecha a divisória
    s.triggers.push({
      id: "abrigo", min: { x: 56.8, y: -1, z: 2.3 }, max: { x: 61.6, y: 3, z: 7.7 }, once: true, fired: false,
      onEnter: () => {
        s.world.setEnabled("divisoria", true);
        // encerra inimigos da zona anterior
        const keep = s.creatures.filter((c) => c.pos.x >= 62);
        s.creatures.length = 0; s.creatures.push(...keep);
        const first = !f.abrigoB;
        f.abrigoB = true; f.tutorial = true;
        s.setObjective("Ligue a catraca de serviço — termine as duas ondas");
        s.applyShelterFloor();
        s.emit({ type: "save", point: "F1-B" });
        if (first) s.say("Nara", "Dá pra ver a catraca daí? Placa branca, lado leste. Pela escada tu pega a passarela; pelo chão é mais curto.", 6);
      },
    });
    if (point === "F1-B") {
      s.world.setEnabled("divisoria", true);
      s.setObjective("Ligue a catraca de serviço — termine as duas ondas");
    }

    // 4 · Praça da catraca
    s.pickups.push({ id: "curativo-escada", pos: { x: 63.4, y: 0, z: 0.4 }, kind: "curativo", amount: 1, taken: false });
    s.pickups.push({ id: "dardos-passarela", pos: { x: 75, y: 2.4, z: -7.2 }, kind: "dardos", amount: 24, taken: false });
    const scale = DIFFICULTY[s.difficulty].reinforce;
    this.arena = new ArenaDirector(WAVE1, WAVE2, {
      activeCount: () => s.activeCommons(),
      distanceToDoor: (d) => s.distTo(ARENA_DOORS[d].spawn),
      telegraph: (d, wave) => {
        s.emit({ type: "doorVibrate", door: d, pos: ARENA_DOORS[d].door, wave, label: ARENA_DOORS[d].label });
        if (wave === 2 && d === "oficina") s.say("Nara", "A porta da oficina tá tremendo de novo. Vem mais!", 3);
      },
      spawn: (type, d, wave) => {
        const door = ARENA_DOORS[d];
        if (d === "oficina" && s.world.get("porta-oficina")?.enabled) { s.world.setEnabled("porta-oficina", false); s.emit({ type: "doorOpen", id: "porta-oficina", pos: door.door }); }
        const jitter = { x: (s.rand() - 0.5) * 2.2, z: (s.rand() - 0.5) * 0.8 };
        const pos = { x: door.spawn.x + (d === "oficina" ? jitter.x : 0), y: door.spawn.y, z: door.spawn.z + (d === "oficina" ? jitter.z : 0) };
        const c = s.spawnCreature(type, pos, { wave, door: d, tag: `onda${wave}`, relentless: true, perches: type === "estilhaco" ? PRACA_PERCHES : [] });
        c.set("emerging");
        if (d !== "oficina") s.emit({ type: "doorOpen", id: d === "superior" ? "porta-superior" : "porta-leste", pos: door.door });
        this.arenaIds.add(c.id);
        return c.id;
      },
      isAlive: (id) => !!s.creature(id)?.alive,
    }, scale);
    s.triggers.push({
      id: "soleira", min: { x: 62.6, y: -1, z: -9 }, max: { x: 88, y: 6, z: 9 }, once: true, fired: false,
      onEnter: () => {
        if (!this.arena || this.arena.state !== "idle") return;
        this.enteredPraca = true;
        this.arena.start();
        s.emit({ type: "arenaStart" });
        s.setObjective("Sobreviva às ondas e libere o painel da catraca");
      },
    });
    s.interactables.push({
      id: "painel", pos: F1_POINTS.panel, radius: 2.6, prompt: "Ligar a catraca de serviço",
      enabled: () => !!this.arena?.panelUnlocked() && !this.panelUsed,
      lockedPrompt: () => (this.panelUsed ? null : `Bloqueado • ${this.arena?.blockReason() ?? ""}`),
      use: () => {
        if (this.panelUsed) return; // dois E produzem uma única transição
        this.panelUsed = true; f.painel = true;
        s.world.setEnabled("portao", false);
        s.emit({ type: "panel" });
        s.emit({ type: "doorOpen", id: "portao", pos: { x: 88, y: 1.5, z: 4.7 } });
        s.setObjective("Cruze a porta com o símbolo de peixe");
        s.say("Nara", "A catraca respondeu! As luzes tão acendendo até o mercado. Ouviu a buzina? É a balsa.", 5);
        for (let i = 1; i <= 4; i++) this.later(0.35 * i, () => s.emit({ type: "lightOn", id: `emb-${i}` }));
      },
    });

    // 5 · Embarque
    s.triggers.push({
      id: "saida", min: { x: F1_POINTS.exitX, y: -1, z: 2.8 }, max: { x: 100, y: 3, z: 6.6 }, once: true, fired: false,
      onEnter: () => {
        if (this.exitDone || !this.panelUsed) return;
        this.exitDone = true;
        s.done = true;
        s.emit({ type: "levelComplete", route: this.routeHigh ? "passarela" : "térreo" });
      },
    });
  }

  bellRung = 0;
  update(dt: number) {
    const s = this.sim;
    this.bellRung -= dt;
    if (this.bellRung <= 0) {
      for (const c of s.creatures) {
        if (c.tag === "demo" && c.state === "lured" && Math.hypot(c.pos.x - 34, c.pos.z - 3.5) < 2.2) {
          s.emit({ type: "bell", pos: { x: 34, y: 2.6, z: 3.5 } }); this.bellRung = 1.2; break;
        }
      }
    }
    for (const t of [...this.timers]) { t.t -= dt; if (t.t <= 0) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); } }
    if (this.arena) {
      this.arena.update(dt);
      if (this.arena.state !== "idle" && !this.panelUsed && s.player.pos.y > 2.0 && s.player.pos.x > 62) this.routeHigh = true;
      // reintroduz comuns obrigatórios sem caminho por 5 s
      for (const id of this.arenaIds) {
        const c = s.creature(id);
        if (c && c.alive && c.noPathT > 5) s.reintroduce(c, ARENA_DOORS[c.door].spawn);
      }
      if (this.arena.state === "cleared" && !s.flags.pracaLimpa) {
        s.flags.pracaLimpa = true;
        s.emit({ type: "arenaCleared" });
        s.setObjective("Use o painel da catraca (E)");
        s.say("Nara", "Silêncio… Agora, Lia! O painel da catraca.", 4);
      }
    }
  }

  diagnostics() {
    return {
      arena: this.arena?.state, wave2: this.arena?.wave2Started, wave2At: this.arena?.wave2StartTime, t: this.arena?.t,
      pending: this.arena?.pending.length, block: this.arena?.blockReason(), spawns: this.arena?.spawnLog, telegraphs: this.arena?.telegraphLog,
      panelUsed: this.panelUsed, routeHigh: this.routeHigh,
    };
  }
}
