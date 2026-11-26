import { box, type World } from "../core/world";
import type { Sim } from "../core/sim";
import { ArenaDirector, type CreatureType } from "../core/waves";
import { DIFFICULTY } from "../config";
import { floor, stairs, wallX, wallZ } from "./build";
import type { Decor, LevelDef, LightDef } from "./types";
import type { V3 } from "../core/math";

const EAST = -Math.PI / 2, WEST = Math.PI / 2, NORTH = 0, SOUTH = Math.PI;

/** Entradas identificáveis (portas e alçapões) das duas lutas de F2. */
export const F2_DOORS: Record<string, { spawn: V3; door: V3; label: string; decor?: string }> = {
  camara: { spawn: { x: 43, y: 0, z: 12.2 }, door: { x: 43, y: 1.4, z: 10 }, label: "Câmara fria (sul)", decor: "porta-camara" },
  telhado: { spawn: { x: 53, y: 2.4, z: -10.6 }, door: { x: 53, y: 6.6, z: -10.6 }, label: "Telhado (norte)", decor: "alcapao-telhado" },
  boiaSul: { spawn: { x: 90, y: 0, z: 12.2 }, door: { x: 90, y: 1.4, z: 10 }, label: "Porta sul da casa da boia", decor: "porta-boia" },
  respiro: { spawn: { x: 88, y: 0, z: 3 }, door: { x: 88, y: 7, z: 3 }, label: "Respiro do teto", decor: "respiro" },
  telhado2: { spawn: { x: 97, y: 2.4, z: -8.2 }, door: { x: 97, y: 7, z: -8.2 }, label: "Alçapão da plataforma", decor: "alcapao-boia" },
};
export const PRACA_PERCHES: V3[] = [{ x: 53, y: 2.4, z: -10.6 }, { x: 32, y: 2.4, z: 8.6 }, { x: 55, y: 2.4, z: -9.6 }];
export const BOIA_PERCHES: V3[] = [{ x: 97, y: 2.4, z: -8.2 }, { x: 84, y: 2.4, z: -7.8 }, { x: 102.5, y: 2.4, z: -7.6 }];
export const WAVE_PRACA: { type: CreatureType; door: string }[] = [
  { type: "riscador", door: "camara" }, { type: "riscador", door: "camara" }, { type: "estilhaco", door: "telhado" },
];
export const WAVE_BOIA: { type: CreatureType; door: string }[] = [
  { type: "veu", door: "respiro" }, { type: "riscador", door: "boiaSul" }, { type: "riscador", door: "boiaSul" }, { type: "estilhaco", door: "telhado2" },
];

export const F2_POINTS = {
  fole: { x: 20, y: 1.15, z: 5.75 },
  registro1: { x: 55.55, y: 1.3, z: -4.5 },
  registro2: { x: 100, y: 3.7, z: -9.55 },
  veu1: { x: 27, y: 0, z: 0 },
  exitX: 105.2,
  gateTime: 8,
};

function buildF2(w: World) {
  // 1 · Peixaria (x 0..24, z -8..8)
  floor(w, 0, -8, 24, 8, "azulejo");
  wallX(w, 0, 30, -8, 5);
  wallX(w, 0, 24, 8, 5);
  wallZ(w, -8, 8, 0, 5);
  // escada norte → passarela de serviço (2,4 m) que cruza sobre a passagem até o toldo
  w.add(box(2, 0, -8, 30, 2.4, -6, "metal", "solid", "passarela-peixaria"));
  stairs(w, 3.6, 6, -1.6, -6, 2.4, 10, "metal");
  w.add(box(6, 2.4, -6.1, 30, 3.4, -5.95, "grade", "grate"));
  // bancas de peixe
  w.add(box(8, 0, 1.5, 11.5, 1.0, 3.2, "balcao"));
  w.add(box(14, 0, 1.5, 17.5, 1.0, 3.2, "balcao"));
  w.add(box(8, 0, -3.8, 11.5, 1.0, -2.2, "balcao"));
  w.add(box(14, 0, -3.8, 17.5, 1.0, -2.2, "balcao"));
  w.add(box(18.5, 0, 5.2, 21.5, 0.95, 6.6, "metal", "solid", "bancada")); // bancada sob a placa de gelo
  w.add(box(1.2, 0, 6.4, 4.5, 1.2, 7.8, "madeira")); // caixas de peixe
  w.add(box(12, 0, 6.6, 13.4, 0.9, 7.8, "madeira"));
  // parede leste espessa: passagem baixa (z −1,5..1,5) e vão da passarela (z −8..−6, acima de 2,4 m)
  w.add(box(24, 0, -6, 30, 5, -1.7, "azulejo-parede"));
  w.add(box(24, 0, 1.7, 30, 5, 8, "azulejo-parede"));
  w.add(box(24, 3.2, -1.7, 30, 5, 1.7, "azulejo-parede"));
  floor(w, 24, -1.7, 30, 1.7, "concreto");
  w.add(box(24, 4.6, -8, 30, 5, -6, "azulejo-parede"));

  // 2 · Banca azul (x 30..56, z -12..10)
  floor(w, 30, -12, 56, 10, "azulejo");
  w.add(box(29.8, 0, -12, 30.2, 7, -8, "azulejo-parede"));
  w.add(box(29.8, 0, 8, 30.2, 7, 10, "azulejo-parede"));
  w.add(box(29.8, 5, -8, 30.2, 7, 8, "azulejo-parede"));
  wallX(w, 30, 56, -12, 7);
  wallX(w, 30, 56, 10, 7, [[41, 45]]);
  wallZ(w, -12, 10, 56, 7, [[-1.5, 1.5]]);
  // ponte fina e toldo superior (2,2–2,4 m): só Lia sobe; dali se vê a praça inteira
  w.add(box(30, 2.2, -8, 36, 2.4, -6, "metal"));
  w.add(box(36, 2.2, -8, 46, 2.4, -1, "toldo", "solid", "toldo"));
  for (const [x, z] of [[36.1, -7.9], [45.8, -7.9], [36.1, -1.2], [45.8, -1.2], [33, -7.9]]) w.add(box(x - 0.1, 0, z - 0.1, x + 0.1, 2.2, z + 0.1, "metal"));
  w.add(box(36, 2.4, -1.15, 44, 3.3, -1.0, "grade", "grate"));
  stairs(w, 44, 46, 3.6, -1, 2.4, 10, "metal");
  w.add(box(38, 0, -6, 44, 1.1, -3, "bancaAzul", "solid", "banca-azul"));
  // caixas que bloqueiam a visão
  for (const [x0, z0, x1, z1, h] of [[33, 3, 34.4, 4.4, 1.3], [36, 6, 37.4, 7.4, 1.3], [49, -4, 50.4, -2.6, 1.6], [50.6, -4, 52, -2.6, 1.3], [40, 4, 41.4, 5.4, 1.3], [47.5, 5, 48.9, 6.4, 1.4], [34, -10.5, 35.4, -9.1, 1.2]] as const) w.add(box(x0, 0, z0, x1, h, z1, "madeira"));
  // poleiros do Estilhaço (telhado norte e canto sudoeste)
  w.add(box(48, 0, -12, 56, 2.4, -9, "metal"));
  w.add(box(30.2, 0, 7, 34, 2.4, 10, "metal"));
  // câmara fria
  floor(w, 40, 10, 46, 14, "concreto");
  wallX(w, 40, 46, 14, 4); wallZ(w, 10, 14, 40, 4); wallZ(w, 10, 14, 46, 4);
  w.add(box(41, 0, 9.85, 45, 3, 10.15, "porta", "solid", "porta-camara"));
  // porta do corredor de serviço (registro 1)
  w.add(box(55.8, 0, -1.5, 56.2, 3, 1.5, "porta", "solid", "porta-corredor"));

  // 3 · Corredor de gelo (x 56..70) e abrigo F2-B (x 70..76)
  floor(w, 56, -1.6, 76, 1.6, "gelo");
  w.add(box(56, 0, -1.8, 76, 1.1, -1.4, "azulejo-parede"));
  w.add(box(56, 2.5, -1.8, 76, 3.2, -1.4, "azulejo-parede"));
  w.add(box(56, 1.1, -1.8, 58, 2.5, -1.4, "azulejo-parede"));
  w.add(box(69, 1.1, -1.8, 76, 2.5, -1.4, "azulejo-parede"));
  w.add(box(58, 1.1, -1.7, 69, 2.5, -1.5, "vidro")); // vitrô: a balsa no canal
  wallX(w, 56, 70, 1.6, 3.2, [], "gelo-parede");
  const div = w.add(box(69.8, 0, -1.6, 70.2, 3.2, 1.6, "persiana", "solid", "divisoria"));
  div.enabled = false;
  floor(w, 70, 1.6, 76, 4.2, "madeira");
  wallX(w, 70, 76, 4.2, 3.2);
  wallZ(w, 1.6, 4.2, 70, 3.2);
  wallZ(w, 1.6, 4.2, 76, 3.2);
  w.add(box(71, 0, 3.4, 74, 0.45, 4.0, "madeira")); // catre

  // 4 · Casa da boia (x 76..104, z -10..10) — três alturas
  floor(w, 76, -10, 104, 10, "concreto");
  wallZ(w, -10, 10, 76, 7.5, [[-1.5, 1.5]]);
  wallX(w, 76, 104, -10, 7.5);
  wallX(w, 76, 104, 10, 7.5, [[88, 92]]);
  w.add(box(103.8, 0, -10, 104.2, 7.5, 1, "azulejo-parede"));
  w.add(box(103.8, 0, 7, 104.2, 7.5, 10, "azulejo-parede"));
  w.add(box(103.8, 5, 1, 104.2, 7.5, 7, "azulejo-parede"));
  w.add(box(103.75, 0, 1, 104.25, 5, 7, "comporta", "solid", "comporta"));
  w.add(box(78, 0, -10, 104, 2.4, -6, "metal", "solid", "plataforma-boia"));
  stairs(w, 78, 80.4, -1.4, -6, 2.4, 10, "metal");
  w.add(box(80.4, 2.4, -6.1, 104, 3.4, -5.95, "grade", "grate"));
  w.add(box(84, 0, 2.5, 85.4, 1.3, 3.9, "madeira"));
  w.add(box(94, 0, 3.5, 95.6, 1.5, 5.1, "madeira"));
  w.add(box(96.5, 0, -2.5, 98, 1.2, -1, "madeira"));
  // porta sul (Riscadores)
  floor(w, 87, 10, 93, 14, "concreto");
  wallX(w, 87, 93, 14, 4); wallZ(w, 10, 14, 87, 4); wallZ(w, 10, 14, 93, 4);
  w.add(box(88, 0, 9.85, 92, 3, 10.15, "porta", "solid", "porta-boia"));

  // 5 · Doca das caixas (x 104..118)
  floor(w, 104, -2, 118, 10, "madeira");
  w.add(box(108, 0, -1.6, 109.6, 1.4, -0.2, "madeira"));
  w.add(box(111, 0, 7.4, 112.6, 1.2, 9, "madeira"));
  w.add(box(114, 0, 1, 115.4, 2.4, 2.4, "madeira"));
  w.add(box(117.8, 0, -2, 118.2, 1.0, 10, "metal")); // guarda-corpo do cais
  w.add(box(104, 0, -2.2, 118, 1.0, -1.8, "metal"));
  w.add(box(104, 0, 9.8, 118, 1.0, 10.2, "metal"));
}

const LIGHTS: LightDef[] = [
  // peixaria: lâmpadas penduradas sobre as bancas, luz fria da câmara
  { pos: { x: 9.7, y: 3.6, z: 2.3 }, color: 0xd8f0ff, intensity: 14, distance: 9, flicker: 0.12 },
  { pos: { x: 15.7, y: 3.6, z: -3 }, color: 0xd8f0ff, intensity: 14, distance: 9 },
  { pos: { x: 20, y: 3.4, z: 5.9 }, color: 0x7fe0ff, intensity: 16, distance: 7 }, // bancada do Fole
  { pos: { x: 4.8, y: 4.4, z: -4 }, color: 0xffd08a, intensity: 12, distance: 9 }, // escada
  { pos: { x: 22, y: 4.3, z: -7 }, color: 0x9cc8ff, intensity: 10, distance: 8 },
  { pos: { x: 27, y: 2.9, z: 0 }, color: 0x8fe8c8, intensity: 10, distance: 7, flicker: 0.35 }, // passagem
  // banca azul
  { pos: { x: 41, y: 6.2, z: -4 }, color: 0x7fb4ff, intensity: 30, distance: 20 },
  { pos: { x: 50, y: 6.2, z: 4 }, color: 0x9fb8d0, intensity: 24, distance: 18, flicker: 0.2 },
  { pos: { x: 34, y: 6, z: 2 }, color: 0x9fb8d0, intensity: 18, distance: 15 },
  { pos: { x: 43, y: 3.2, z: 11.6 }, color: 0x6ad0ff, intensity: 12, distance: 8, flicker: 0.4 },
  { pos: { x: 54.2, y: 3, z: -4.5 }, color: 0xffb060, intensity: 14, distance: 8 }, // registro 1
  { pos: { x: 52, y: 5.6, z: -10.5 }, color: 0xff8a50, intensity: 10, distance: 9 },
  // corredor de gelo e abrigo
  { pos: { x: 60, y: 2.9, z: 0 }, color: 0xbfe8ff, intensity: 12, distance: 8 },
  { pos: { x: 66, y: 2.9, z: 0 }, color: 0xbfe8ff, intensity: 10, distance: 8, flicker: 0.3 },
  { pos: { x: 73, y: 2.9, z: 2.6 }, color: 0xffa040, intensity: 20, distance: 9 },
  // casa da boia
  { pos: { x: 84, y: 6.6, z: 2 }, color: 0x8fb0d8, intensity: 26, distance: 18 },
  { pos: { x: 96, y: 6.6, z: 2 }, color: 0x8fb0d8, intensity: 24, distance: 18, flicker: 0.15 },
  { pos: { x: 100, y: 4.6, z: -8.8 }, color: 0xffb060, intensity: 16, distance: 9 }, // registro 2
  { pos: { x: 90, y: 3.2, z: 11.6 }, color: 0xff7040, intensity: 10, distance: 8, flicker: 0.5 },
  { pos: { x: 101.5, y: 3, z: 8 }, color: 0xffd040, intensity: 10, distance: 7 }, // boia-sino
  { pos: { x: 102.6, y: 5.6, z: 4 }, color: 0xff3838, intensity: 14, distance: 9, id: "luz-comporta" },
  // doca
  { pos: { x: 110, y: 4.6, z: 4 }, color: 0xffb060, intensity: 20, distance: 16 },
  { pos: { x: 116, y: 4.6, z: 8 }, color: 0xffb060, intensity: 14, distance: 14 },
];

const DECOR: Decor[] = [
  // peixaria
  { kind: "sign", pos: { x: 12, y: 4.2, z: 7.75 }, rot: SOUTH, text: "MERCADO DE PEIXE • PORTO DO SAL", color: 0x9fe0ff },
  { kind: "sign", pos: { x: 4.8, y: 3.3, z: -7.75 }, rot: NORTH, text: "ESCADA • PASSARELA DE SERVIÇO ↑", color: 0xffd08a },
  { kind: "stall", pos: { x: 9.75, y: 0, z: 2.35 } }, { kind: "stall", pos: { x: 15.75, y: 0, z: 2.35 } },
  { kind: "stall", pos: { x: 9.75, y: 0, z: -3 } }, { kind: "stall", pos: { x: 15.75, y: 0, z: -3 } },
  { kind: "iceBench", pos: { x: 20, y: 0, z: 5.9 }, id: "bancada-fole" },
  { kind: "sign", pos: { x: 20, y: 2.6, z: 7.75 }, rot: SOUTH, text: "GELO • NÃO ENCOSTE", color: 0x7fe0ff },
  { kind: "hangLamp", pos: { x: 9.7, y: 3.6, z: 2.3 } }, { kind: "hangLamp", pos: { x: 15.7, y: 3.6, z: -3 } },
  { kind: "fishCrates", pos: { x: 2.8, y: 1.2, z: 7.1 } }, { kind: "fishCrates", pos: { x: 12.7, y: 0.9, z: 7.2 } },
  { kind: "puddle", pos: { x: 12, y: 0, z: -0.3 }, size: { x: 5, y: 0, z: 2.2 } },
  { kind: "puddle", pos: { x: 21, y: 0, z: 0.5 }, size: { x: 3, y: 0, z: 3 } },
  { kind: "drip", pos: { x: 13, y: 4.8, z: 0 } },
  { kind: "poster", pos: { x: 0.25, y: 2, z: -2 }, rot: WEST + Math.PI, text: "Tabela do dia", color: 0xe8d9b0 },
  { kind: "arrow", pos: { x: 23.8, y: 2.2, z: 0 }, rot: EAST },
  { kind: "cables", pos: { x: 12, y: 4.7, z: -5 }, size: { x: 22, y: 0, z: 0 } },
  // banca azul
  { kind: "sign", pos: { x: 41, y: 5.2, z: -11.75 }, rot: NORTH, text: "BANCA AZUL • PEIXE FRESCO", color: 0x7fb4ff },
  { kind: "awning", pos: { x: 41, y: 2.4, z: -4.5 }, size: { x: 10, y: 0, z: 7 } },
  { kind: "blueStall", pos: { x: 41, y: 0, z: -4.5 } },
  { kind: "doorFrame", pos: { x: 43, y: 0, z: 9.95 }, rot: SOUTH, id: "porta-camara-quadro" },
  { kind: "sign", pos: { x: 43, y: 3.4, z: 9.75 }, rot: SOUTH, text: "CÂMARA FRIA", color: 0x6ad0ff },
  { kind: "hatchRoof", pos: { x: 53, y: 6.9, z: -10.6 }, id: "alcapao-telhado" },
  { kind: "valve", pos: { x: 55.75, y: 1.3, z: -4.5 }, rot: WEST, id: "registro1" },
  { kind: "sign", pos: { x: 55.75, y: 2.4, z: -4.5 }, rot: WEST, text: "REGISTRO DA PRAÇA", color: 0xffb060 },
  { kind: "sign", pos: { x: 55.75, y: 3.4, z: 0 }, rot: WEST, text: "CORREDOR DE SERVIÇO", color: 0xbfe2ff },
  { kind: "puddle", pos: { x: 45, y: 0, z: 1.5 }, size: { x: 6, y: 0, z: 4 } },
  { kind: "puddle", pos: { x: 35, y: 0, z: -3 }, size: { x: 3, y: 0, z: 5 } },
  { kind: "drip", pos: { x: 47, y: 6.8, z: 1 } }, { kind: "drip", pos: { x: 37, y: 6.8, z: 5 } },
  { kind: "fishCrates", pos: { x: 50, y: 0, z: 8.6 } },
  { kind: "bench", pos: { x: 52.5, y: 0, z: 2.5 }, rot: WEST },
  { kind: "luggage", pos: { x: 36, y: 0, z: 1.2 } },
  // v0.6 • mercado abandonado às pressas
  { kind: "dragMark", pos: { x: 40, y: 0, z: -2 }, rot: 1.0, size: { x: 0.6, y: 0, z: 5 } },
  { kind: "clawMarks", pos: { x: 30.25, y: 1.4, z: -7.4 }, rot: EAST + Math.PI, size: { x: 0, y: 1, z: 0 } },
  { kind: "backpack", pos: { x: 37.2, y: 0, z: 2.1 }, rot: 0.6 },
  { kind: "note", pos: { x: 14, y: 0, z: 3 } },
  { kind: "note", pos: { x: 46, y: 0, z: -3.4 } },
  { kind: "floorArrow", pos: { x: 8, y: 0, z: 0 }, rot: WEST },
  { kind: "exitLight", pos: { x: 23.8, y: 2.75, z: 0 }, rot: EAST },
  { kind: "poster", pos: { x: 30.25, y: 2.2, z: -10 }, rot: EAST + Math.PI, text: "Leilão 5h", color: 0xffc070 },
  { kind: "cables", pos: { x: 43, y: 6.8, z: 0 }, size: { x: 25, y: 0, z: 0 } },
  { kind: "skylight", pos: { x: 43, y: 7, z: -1 }, size: { x: 20, y: 0, z: 4 } },
  // corredor de gelo
  { kind: "sign", pos: { x: 57, y: 2.7, z: 1.45 }, rot: SOUTH, text: "CORREDOR DE GELO", color: 0xbfe8ff },
  { kind: "iceRack", pos: { x: 63, y: 0, z: 1.2 } }, { kind: "iceRack", pos: { x: 67.5, y: 0, z: 1.2 } },
  { kind: "wallDrawing", pos: { x: 73, y: 1.6, z: 4.0 }, rot: SOUTH, text: "REGISTRO 2 ↗ PLATAFORMA" },
  { kind: "shelterSign", pos: { x: 73, y: 2.7, z: 4.0 }, rot: SOUTH, text: "ABRIGO", color: 0xffb050 },
  { kind: "cot", pos: { x: 71.5, y: 0, z: 2.4 } },
  { kind: "backpack", pos: { x: 70.1, y: 0, z: 1.6 }, rot: 2.2 },
  // casa da boia
  { kind: "sign", pos: { x: 90, y: 6.2, z: -9.75 }, rot: NORTH, text: "CASA DA BOIA • COMPORTA BAIXA", color: 0xff9a3c },
  { kind: "valve", pos: { x: 100, y: 3.7, z: -9.75 }, rot: NORTH, id: "registro2" },
  { kind: "sign", pos: { x: 100, y: 4.7, z: -9.75 }, rot: NORTH, text: "REGISTRO 2 • COMPORTA", color: 0xffb060 },
  { kind: "gateSegments", pos: { x: 103.7, y: 5.6, z: 4 }, rot: WEST, id: "segmentos" },
  { kind: "buoyBell", pos: { x: 101, y: 0, z: 8.2 }, id: "boia-sino" },
  { kind: "doorFrame", pos: { x: 90, y: 0, z: 9.95 }, rot: SOUTH, id: "porta-boia-quadro" },
  { kind: "hatchRoof", pos: { x: 97, y: 7.4, z: -8.2 }, id: "alcapao-boia" },
  { kind: "vent", pos: { x: 88, y: 7.4, z: 3 }, id: "respiro" },
  { kind: "chain", pos: { x: 92, y: 7.5, z: 0 } },
  { kind: "puddle", pos: { x: 90, y: 0, z: 4 }, size: { x: 8, y: 0, z: 6 } },
  { kind: "drip", pos: { x: 92, y: 7.3, z: 6 } },
  { kind: "arrow", pos: { x: 103.6, y: 5.0, z: 4 }, rot: EAST, id: "seta-comporta" },
  // doca e canal
  { kind: "crateStack", pos: { x: 108.8, y: 0, z: -0.9 } }, { kind: "crateStack", pos: { x: 111.8, y: 0, z: 8.2 } },
  { kind: "bollard", pos: { x: 117, y: 0, z: 4 } },
  { kind: "ferry", pos: { x: 60, y: -1.2, z: -26 }, id: "balsa" },
  { kind: "pumpHouse", pos: { x: 150, y: 0, z: -34 } },
  { kind: "dock", pos: { x: 80, y: -0.6, z: -16 } },
];

export const F2: LevelDef = {
  id: "F2",
  nome: "F2 • Mercado Afogado",
  build: buildF2,
  spawns: {
    "F2-A": { pos: { x: 2.5, y: 0, z: 2 }, yaw: EAST },
    "F2-B": { pos: { x: 73, y: 0, z: 1.4 }, yaw: EAST },
  },
  lights: LIGHTS,
  decor: DECOR,
  ceilings: [
    { min: { x: 0, y: 5, z: -8 }, max: { x: 24, y: 5.2, z: 8 }, mat: "teto" },
    { min: { x: 24, y: 5, z: -8 }, max: { x: 30, y: 5.2, z: 8 }, mat: "teto" },
    { min: { x: 30, y: 7, z: -12 }, max: { x: 56, y: 7.2, z: 10 }, mat: "teto" },
    { min: { x: 40, y: 4, z: 10 }, max: { x: 46, y: 4.2, z: 14 }, mat: "teto" },
    { min: { x: 56, y: 3.2, z: -1.8 }, max: { x: 76, y: 3.4, z: 4.2 }, mat: "teto" },
    { min: { x: 76, y: 7.5, z: -10 }, max: { x: 104, y: 7.7, z: 10 }, mat: "teto" },
    { min: { x: 87, y: 4, z: 10 }, max: { x: 93, y: 4.2, z: 14 }, mat: "teto" },
  ],
  env: {
    fogColor: 0x0b1518, fogDensity: 0.03, ambient: 0.3, hemiSky: 0x2f5866, hemiGround: 0x0c100e, sky: true, rain: true, sea: true, music: "explore",
    rainRects: [[104, -2, 118, 10, 0], [-10, -70, 160, -14, -1.2], [56, -12, 76, -2, -1.2]],
    seaRect: { x: 75, z: -60, w: 340, d: 110 },
    outdoors: [[104, -2, 118, 10]],
    ferryPath: true,
  },
  script: (sim: Sim) => new F2Script(sim),
};

export class F2Script {
  arena: ArenaDirector | null = null;
  arena2: ArenaDirector | null = null;
  arenaIds = new Set<string>();
  timers: { t: number; fn: () => void }[] = [];
  gateT = -1;
  exitDone = false;
  routeHigh = false;
  segmentsLit = 0;
  aliveAtExit = 0;
  constructor(private sim: Sim) {}
  later(t: number, fn: () => void) { this.timers.push({ t, fn }); }

  private makeArena(wave: { type: CreatureType; door: string }[], perches: V3[], tag: string) {
    const s = this.sim;
    return new ArenaDirector(wave, [], {
      activeCount: () => s.activeCommons(),
      distanceToDoor: (d) => s.distTo(F2_DOORS[d].spawn),
      telegraph: (d) => s.emit({ type: "doorVibrate", door: d, decor: F2_DOORS[d].decor, pos: F2_DOORS[d].door, label: F2_DOORS[d].label }),
      spawn: (type, d) => {
        const door = F2_DOORS[d];
        if (d === "camara" && s.world.get("porta-camara")?.enabled) { s.world.setEnabled("porta-camara", false); s.emit({ type: "doorOpen", id: "porta-camara", pos: door.door }); }
        if (d === "boiaSul" && s.world.get("porta-boia")?.enabled) { s.world.setEnabled("porta-boia", false); s.emit({ type: "doorOpen", id: "porta-boia", pos: door.door }); }
        if (door.decor && d !== "camara" && d !== "boiaSul") s.emit({ type: "doorOpen", id: door.decor, pos: door.door });
        const jit = d === "camara" || d === "boiaSul" ? (s.rand() - 0.5) * 2.4 : 0;
        const pos = { x: door.spawn.x + jit, y: door.spawn.y, z: door.spawn.z };
        const opts: any = { tag, door: d, relentless: true, perches: type === "estilhaco" ? perches : [] };
        if (type === "veu") Object.assign(opts, { home: { x: 90, y: 0, z: 1 }, leash: 7, hover: 3.6 });
        const c = s.spawnCreature(type, pos, opts);
        if (type === "veu") { c.pos.y = 2.6; c.aware = true; } else c.set("emerging");
        this.arenaIds.add(c.id);
        return c.id;
      },
      isAlive: (id) => !!s.creature(id)?.alive,
    }, DIFFICULTY[s.difficulty].reinforce);
  }

  start(point: string) {
    const s = this.sim, f = s.flags;
    if (point === "F2-B") { f.fole = true; f.registro1 = true; f.abrigoB = true; f.peixaria = true; }

    // 1 · Peixaria: o Fole sob a placa de gelo
    if (!f.fole) {
      s.interactables.push({
        id: "fole", pos: F2_POINTS.fole, radius: 2.6, prompt: "Pegar o Fole", enabled: () => !f.fole,
        use: () => {
          if (f.fole) return;
          f.fole = true;
          s.arsenal.give("fole"); // pente cheio e uma recarga de reserva
          if (s.arsenal.switchTo("fole")) s.emit({ type: "switch", weapon: "fole" });
          s.emit({ type: "equip", what: "fole" });
          s.setObjective("Atravesse a peixaria até a banca azul");
          s.say("Nara", "Pegou o Fole? Clique abre o leque de perto. Botão direito sopra: afasta a névoa do Véu por uns segundos.", 6);
        },
      });
    }
    if (point === "F2-A") {
      s.setObjective(f.fole ? "Atravesse a peixaria até a banca azul" : "Pegue o Fole na bancada sob a placa de gelo");
      this.later(0.8, () => s.say("Nara", "Lia, a balsa encostou na comporta baixa. São dois registros: um na praça da banca azul, outro na casa da boia.", 6));
      this.later(7.5, () => { if (!f.fole) s.say("Nara", "Tem um Fole na bancada do gelo, do lado da peixaria. Vai precisar contra a névoa.", 5); });
      s.pickups.push({ id: "dardos-passarela-f2", pos: { x: 22.5, y: 2.4, z: -7 }, kind: "dardos", amount: 24, taken: false });
    }
    if (!f.registro1) {
      // o primeiro Véu cobre a passagem baixa; a escada dá a rota por cima
      s.spawnCreature("veu", { x: 27, y: 1.65, z: 0 }, { tag: "veu-passagem", home: { ...F2_POINTS.veu1 }, leash: 1.4, hover: 2.25 });
      s.triggers.push({
        id: "veu-visto", min: { x: 14, y: -1, z: -8 }, max: { x: 24, y: 3, z: 8 }, once: true, fired: !!f.peixaria,
        onEnter: () => { f.peixaria = true; s.say("Nara", "Aquela fita no corredor é um Véu. Solta névoa e esconde o chão. Sopra com o Fole ou sobe a escada.", 6); },
      });
    }

    // 2 · Banca azul: luta e registro da praça
    this.arena = this.makeArena(WAVE_PRACA, PRACA_PERCHES, "praca");
    if (!f.registro1) {
      s.triggers.push({
        id: "praca", min: { x: 30.6, y: -1, z: -12 }, max: { x: 56, y: 6, z: 10 }, once: true, fired: false,
        onEnter: () => {
          if (f.registro1 || this.arena!.state !== "idle") return;
          this.arena!.start();
          s.emit({ type: "arenaStart" });
          s.setObjective("Gire o registro da praça (E) — parede leste");
          s.say("Nara", "Barulho na câmara fria! E tem coisa andando no telhado. O registro fica na parede leste.", 5);
        },
      });
      s.interactables.push({
        id: "registro1", pos: F2_POINTS.registro1, radius: 2.4, prompt: "Girar o registro da praça", enabled: () => !f.registro1,
        use: () => {
          if (f.registro1) return;
          f.registro1 = true;
          s.emit({ type: "valve", id: "registro1", pos: F2_POINTS.registro1 });
          this.later(0.9, () => { s.world.setEnabled("porta-corredor", false); s.emit({ type: "doorOpen", id: "porta-corredor", pos: { x: 56, y: 1.2, z: 0 } }); });
          s.setObjective("Siga pelo corredor de gelo até a casa da boia");
          s.say("Nara", "Primeiro registro aberto! A água baixou um palmo. Corredor de serviço liberado.", 5);
        },
      });
    } else {
      s.world.setEnabled("porta-corredor", false);
    }

    // 3 · Corredor de gelo
    s.pickups.push({ id: "fole-corredor", pos: { x: 60.5, y: 0, z: 0.9 }, kind: "fole", amount: 8, taken: false });
    s.pickups.push({ id: "curativo-corredor", pos: { x: 64.5, y: 0, z: -0.9 }, kind: "curativo", amount: 1, taken: false });
    s.triggers.push({
      id: "vitro", min: { x: 58, y: -1, z: -1.6 }, max: { x: 66, y: 3, z: 1.6 }, once: true, fired: !!f.abrigoB,
      onEnter: () => s.say("Nara", "Tá me vendo pelo vitrô? A proa tá parada na comporta. Mais um registro e a gente entra no canal.", 5),
    });
    s.triggers.push({
      id: "abrigo", min: { x: 70.6, y: -1, z: -1.4 }, max: { x: 75.8, y: 3, z: 4 }, once: true, fired: false,
      onEnter: () => {
        s.world.setEnabled("divisoria", true);
        const keep = s.creatures.filter((c) => c.pos.x >= 70);
        s.creatures.length = 0; s.creatures.push(...keep);
        s.clouds = s.clouds.filter((c) => c.pos.x >= 70);
        const first = !f.abrigoB;
        f.abrigoB = true;
        s.setObjective("Gire o registro da comporta na plataforma da casa da boia");
        s.applyShelterFloor();
        s.emit({ type: "save", point: "F2-B" });
        if (first) s.say("Nara", "Abrigo selado atrás de ti. O desenho na parede mostra o segundo registro: plataforma de cima, lado norte.", 6);
      },
    });
    if (point === "F2-B") { s.world.setEnabled("divisoria", true); s.setObjective("Gire o registro da comporta na plataforma da casa da boia"); }

    // 4 · Casa da boia
    s.pickups.push({ id: "fole-registro2", pos: { x: 98.2, y: 2.4, z: -9.1 }, kind: "fole", amount: 8, taken: false });
    this.arena2 = this.makeArena(WAVE_BOIA, BOIA_PERCHES, "boia");
    s.triggers.push({
      id: "boia", min: { x: 76.6, y: -1, z: -10 }, max: { x: 104, y: 6, z: 10 }, once: true, fired: false,
      onEnter: () => {
        if (this.arena2!.state !== "idle") return;
        this.arena2!.start();
        s.emit({ type: "arenaStart" });
        s.say("Nara", "Três alturas, Lia: um no ar, um na plataforma e os do chão. O registro tá lá em cima.", 5);
      },
    });
    s.interactables.push({
      id: "registro2", pos: F2_POINTS.registro2, radius: 2.4, prompt: "Girar o registro da comporta", enabled: () => this.gateT < 0,
      // nas travessias de fuga a interação é aceita mesmo com a fila cheia
      use: () => {
        if (this.gateT >= 0) return;
        this.gateT = 0; f.registro2 = true;
        s.emit({ type: "valve", id: "registro2", pos: F2_POINTS.registro2 });
        s.emit({ type: "gateStart" });
        s.setObjective("Atravesse a comporta");
        s.say("Nara", "Comporta abrindo! Oito segundos. Vai pela boia em forma de sino!", 4);
      },
    });

    // 5 · Doca das caixas
    s.triggers.push({
      id: "batente", min: { x: F2_POINTS.exitX, y: -1, z: -2 }, max: { x: 118, y: 4, z: 10 }, once: true, fired: false,
      onEnter: () => {
        if (this.exitDone || this.gateT < F2_POINTS.gateTime) return;
        this.exitDone = true;
        this.aliveAtExit = s.creatures.filter((c) => c.alive).length;
        s.done = true;
        s.emit({ type: "levelComplete", route: this.routeHigh ? "toldo" : "térreo", alive: this.aliveAtExit });
      },
    });
  }

  update(dt: number) {
    const s = this.sim;
    for (const t of [...this.timers]) { t.t -= dt; if (t.t <= 0) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); } }
    if (s.player.pos.y > 2 && s.player.pos.x > 2 && s.player.pos.x < 46) this.routeHigh = true;
    for (const ar of [this.arena, this.arena2]) {
      if (!ar) continue;
      ar.update(dt);
    }
    for (const id of this.arenaIds) {
      const c = s.creature(id);
      if (c && c.alive && c.type !== "veu" && c.noPathT > 5) s.reintroduce(c, F2_DOORS[c.door].spawn);
    }
    // comporta: 8 s, luz progride em quatro segmentos
    if (this.gateT >= 0 && this.gateT < F2_POINTS.gateTime) {
      this.gateT += dt;
      const seg = Math.min(4, Math.floor(this.gateT / (F2_POINTS.gateTime / 4)));
      while (this.segmentsLit < seg) { this.segmentsLit++; s.emit({ type: "gateSegment", n: this.segmentsLit }); }
      if (this.gateT >= F2_POINTS.gateTime) {
        s.world.setEnabled("comporta", false);
        s.emit({ type: "doorOpen", id: "comporta", pos: { x: 104, y: 1.5, z: 4 } });
        s.emit({ type: "gateOpen" });
        s.say("Nara", "Aberta! Cruza o batente que eu levo a balsa pro canal.", 3.5);
      }
    }
    s.vars.comporta = this.gateT < 0 ? 0 : Math.min(1, this.gateT / F2_POINTS.gateTime);
    s.vars.segmentos = this.segmentsLit;
  }

  diagnostics() {
    return {
      arena: `${this.arena?.state}/${this.arena2?.state}`, pending: (this.arena?.pending.length ?? 0) + (this.arena2?.pending.length ?? 0),
      block: this.gateT < 0 ? "registro 2 fechado" : this.gateT < F2_POINTS.gateTime ? `comporta ${(this.gateT / F2_POINTS.gateTime * 100).toFixed(0)}%` : "aberta",
      routeHigh: this.routeHigh, gateT: this.gateT, clouds: this.sim.clouds.length,
    };
  }
}
