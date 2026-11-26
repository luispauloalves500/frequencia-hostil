import { box, type Box, type World } from "../core/world";
import type { Sim } from "../core/sim";
import type { Creature } from "../core/creatures";
import { ArenaDirector, type CreatureType } from "../core/waves";
import { BADALO, DIFFICULTY, ENCOUNTER } from "../config";
import { floor, stairs, wallX, wallZ } from "./build";
import type { Decor, LevelDef, LightDef } from "./types";
import type { V3 } from "../core/math";

const EAST = -Math.PI / 2, WEST = Math.PI / 2, NORTH = 0, SOUTH = Math.PI;

/** Rampa/escada subindo ao longo de X. */
/** Caixa só de colisão: o visual vem da decoração (tanque, bomba, bancada). */
function hid(b: Box): Box { b.noRender = true; return b; }

function stairsX(w: World, xBottom: number, xTop: number, z0: number, z1: number, height: number, steps: number, mat = "metal", y0 = 0) {
  const dir = Math.sign(xTop - xBottom), run = Math.abs(xTop - xBottom) / steps;
  for (let i = 0; i < steps; i++) {
    const xa = xBottom + dir * run * i, xb = xa + dir * run;
    w.add(box(Math.min(xa, xb), y0, z0, Math.max(xa, xb), y0 + (height * (i + 1)) / steps, z1, mat));
  }
}

/** Entradas identificáveis (portas, grelhas e alçapões) de F3. */
export const F3_DOORS: Record<string, { spawn: V3; door: V3; label: string; decor?: string }> = {
  grelha: { spawn: { x: 26.4, y: 0, z: 0 }, door: { x: 27.5, y: 0.6, z: 0 }, label: "Grelha do filtro (leste)", decor: "grelha-filtro" },
  rampa: { spawn: { x: 58.4, y: 0, z: -4.8 }, door: { x: 57.5, y: 1.2, z: -4.8 }, label: "Rampa de volta (oeste)", decor: "porta-rampa" },
  margem: { spawn: { x: 66, y: 0, z: 9.6 }, door: { x: 66, y: 1.4, z: 8 }, label: "Margem sul", decor: "porta-margem" },
  abertura: { spawn: { x: 70, y: 0, z: 2 }, door: { x: 70, y: 6, z: 2 }, label: "Abertura do teto", decor: "abertura-teto" },
  galeriaAlta: { spawn: { x: 64, y: 2.6, z: -7 }, door: { x: 64, y: 6, z: -7 }, label: "Alçapão da passarela", decor: "alcapao-passarela" },
  valaN: { spawn: { x: 100, y: 0, z: -13 }, door: { x: 100, y: 1.4, z: -14 }, label: "Vala norte", decor: "porta-vala-n" },
  valaS: { spawn: { x: 100, y: 0, z: 13 }, door: { x: 100, y: 1.4, z: 14 }, label: "Vala sul", decor: "porta-vala-s" },
};
export const GAL_PERCHES: V3[] = [{ x: 64, y: 2.6, z: -7 }, { x: 72, y: 2.6, z: -7 }, { x: 58, y: 2.6, z: -7 }];
/** Travessia da galeria baixa: dois Riscadores e um Estilhaço. */
export const WAVE_GALERIA: { type: CreatureType; door: string }[] = [
  { type: "riscador", door: "rampa" }, { type: "riscador", door: "margem" }, { type: "estilhaco", door: "galeriaAlta" },
];
/** Pico da curva em U: três Riscadores pela rampa; o Véu pela abertura 2 s depois do aviso da rampa. */
export const WAVE_PICO: { type: CreatureType; door: string }[] = [
  { type: "riscador", door: "rampa" }, { type: "riscador", door: "rampa" }, { type: "riscador", door: "rampa" },
];

export const F3_POINTS = {
  tear: { x: 5.25, y: 1.1, z: -4.9 },
  bomba1: { x: 48.2, y: 1.2, z: -6.6 },
  bomba2: { x: 77.9, y: 1.2, z: 6.2 },
  dispenser: { x: 86.6, y: 1.3, z: -12.2 },
  wellCenter: { x: 100, y: 0, z: 0 },
  plates: [{ x: 100, y: 0, z: -8.5 }, { x: 107.4, y: 0, z: 4.8 }, { x: 92.6, y: 0, z: 4.8 }] as V3[],
  batente: { x: 38.6, y: 0, z: 0 },
  curve: { x: 78, y: 2.6, z: -6 },
  exitX: 137,
  dispenserCooldown: 12,
};

function buildF3(w: World) {
  // 1 · Galeria dos filtros (x 0..28, z −6..6), teto 5
  floor(w, 0, -6, 28, 6, "concreto");
  wallX(w, 0, 28, -6, 5);
  wallX(w, 0, 28, 6, 5, [[24, 26]]);
  wallZ(w, -6, 6, 0, 5);
  wallZ(w, -6, 6, 28, 5, [[-1.5, 1.5]]);
  // tanques de filtro (laterais) e tanques baixos que estreitam a faixa central
  for (const x of [8, 13, 18, 23]) { hid(w.add(box(x - 0.9, 0, -5.8, x + 0.9, 3.4, -4.0, "metal"))); hid(w.add(box(x - 0.9, 0, 4.0, x + 0.9, 3.4, 5.8, "metal"))); }
  w.add(box(9.5, 0, 1.3, 25, 1.0, 3.9, "concreto", "solid", "leito-sul"));
  w.add(box(9.5, 0, -3.9, 25, 1.0, -1.3, "concreto", "solid", "leito-norte"));
  hid(w.add(box(4, 0, -5.8, 6.5, 0.95, -4.2, "metal", "solid", "bancada-tear")));
  // quadro 1 (porta aberta para experimentação)
  floor(w, 23, 6, 27, 9, "concreto");
  wallX(w, 23, 27, 9, 3.2); wallZ(w, 6, 9, 23, 3.2); wallZ(w, 6, 9, 27, 3.2);
  // grelha leste (Riscadores)
  floor(w, 28, -1.5, 30, 1.5, "metal");

  // 2 · Batente amarelo e bomba 1 (x 30..52, z −9..9), teto 7
  floor(w, 30, -9, 52, 9, "concreto");
  wallX(w, 28, 52, -9, 7); wallX(w, 28, 52, 9, 7);
  w.add(box(27.8, 0, -9, 28.2, 7, -6, "azulejo-parede")); w.add(box(27.8, 0, 6, 28.2, 7, 9, "azulejo-parede"));
  w.add(box(27.8, 5, -6, 28.2, 7, 6, "azulejo-parede"));
  wallZ(w, -9, 9, 52, 7, [[-1.5, 1.5]]);
  w.add(box(38, 0, -9, 39.2, 1.15, 5.2, "batente", "solid", "batente-1")); // batente de parede a parede; só o corredor lateral contorna
  w.add(box(30.5, 0, -8.7, 31.3, 1.15, -4.5, "batente", "solid", "batente-2"));
  // corredor lateral para alcançar o dorso (sul)
  w.add(box(33, 0, 5.2, 48, 3.2, 5.6, "azulejo-parede"));
  // bomba 1
  hid(w.add(box(48.6, 0, -8.8, 51.8, 2.6, -5.0, "metal", "solid", "bomba1")));
  // persiana da galeria baixa (o jato da bomba 1 a levanta)
  w.add(box(51.8, 0, -1.5, 52.2, 3, 1.5, "persiana", "solid", "persiana-galeria"));

  // 3 · Galeria baixa (x 52..80, z −8..8), teto 6
  floor(w, 52, -8, 80, 8, "concreto");
  wallX(w, 52, 80, -8, 6); wallX(w, 52, 80, 8, 6, [[64.5, 67.5]]);
  wallZ(w, -8, 8, 80, 6, [[-1.5, 1.5]]);
  // escada de serviço (revelada pelo jato) até a passarela norte (2,6 m)
  stairs(w, 52.4, 54.6, -1.8, -5.6, 2.6, 10, "metal");
  w.add(box(54.6, 0, -8, 80, 2.6, -5.6, "metal", "solid", "passarela-norte"));
  w.add(box(54.6, 2.6, -5.7, 74, 3.6, -5.55, "grade", "grate"));
  // curva em U (x 76..80) e escada que desce para o térreo, junto da porta do abrigo
  w.add(box(76, 0, -8, 80, 2.6, -3, "metal", "solid", "curva"));
  stairs(w, 76.4, 78.4, 2.6, -3, 2.6, 10, "metal");
  // rampa de volta: sobe do térreo (x 62) até o patamar da curva (x 74..76)
  stairsX(w, 62, 74, -5.5, -4.1, 2.4, 12, "metal");
  w.add(box(74, 0, -5.6, 76, 2.6, -3, "metal"));
  // nicho da porta da rampa (sob a passarela)
  w.add(box(54.6, 0, -5.6, 57.4, 2.4, -4.0, "azulejo-parede"));
  w.add(box(57.4, 0, -5.6, 57.6, 2.4, -4.0, "porta", "solid", "porta-rampa-folha"));
  // fileira de tanques: separa o corredor central (z −2..2) da margem sul
  for (const x of [58, 63, 69, 74]) hid(w.add(box(x - 1, 0, 2.4, x + 1, 2.2, 4.2, "metal")));
  // porta sul (margem)
  floor(w, 64, 8, 68, 11, "concreto");
  wallX(w, 64, 68, 11, 4); wallZ(w, 8, 11, 64, 4); wallZ(w, 8, 11, 68, 4);
  w.add(box(64.5, 0, 7.85, 67.5, 3, 8.15, "porta", "solid", "porta-margem"));
  // bomba 2
  hid(w.add(box(78.2, 0, 5.0, 79.8, 2.2, 7.8, "metal", "solid", "bomba2")));
  // porta do abrigo do poço (abre com as duas lâmpadas)
  w.add(box(79.8, 0, -1.5, 80.2, 3, 1.5, "porta", "solid", "porta-abrigo"));

  // 4 · Abrigo do poço F3-B (x 80..86, z −3..3)
  floor(w, 80, -3, 86, 3, "madeira");
  wallX(w, 80, 86, -3, 3.2); wallX(w, 80, 86, 3, 3.2);
  w.add(box(85.8, 0, -3, 86.2, 3.2, -1.5, "azulejo-parede")); w.add(box(85.8, 0, 1.5, 86.2, 3.2, 3, "azulejo-parede"));
  const div = w.add(box(79.85, 0, -1.5, 80.15, 3, 1.5, "persiana", "solid", "divisoria")); div.enabled = false;
  const gate = w.add(box(85.85, 0, -1.5, 86.15, 3, 1.5, "persiana", "solid", "porta-poco")); gate.enabled = false;
  w.add(box(81, 0, 2.2, 84, 0.45, 2.8, "madeira")); // catre

  // 5 · Poço de sucção (x 86..114, z −14..14), teto 9
  floor(w, 86, -14, 114, 14, "concreto");
  wallX(w, 86, 114, -14, 9, [[98.5, 101.5]]); wallX(w, 86, 114, 14, 9, [[98.5, 101.5]]);
  w.add(box(85.8, 0, -14, 86.2, 9, -3, "azulejo-parede")); w.add(box(85.8, 0, 3, 86.2, 9, 14, "azulejo-parede")); w.add(box(85.8, 3.2, -3, 86.2, 9, 3, "azulejo-parede"));
  wallZ(w, -14, 14, 114, 9, [[-1.5, 1.5]]);
  // grade em volta do poço central
  w.add(box(97.4, 0, -2.6, 102.6, 1.1, -2.4, "grade", "grate")); w.add(box(97.4, 0, 2.4, 102.6, 1.1, 2.6, "grade", "grate"));
  w.add(box(97.4, 0, -2.6, 97.6, 1.1, 2.6, "grade", "grate")); w.add(box(102.4, 0, -2.6, 102.6, 1.1, 2.6, "grade", "grate"));
  // patamar leste (1,2 m): a onda de piso não sobe
  w.add(box(110, 0, -6, 114, 1.2, 6, "metal", "solid", "patamar"));
  stairsX(w, 107.8, 110, -1.2, 1.2, 1.2, 4, "metal");
  // valas norte/sul (Riscadores da transição)
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -17 : 14, z1 = s < 0 ? -14 : 17;
    floor(w, 98, z0, 102, z1, "concreto");
    wallX(w, 98, 102, s < 0 ? -17 : 17, 4); wallZ(w, z0, z1, 98, 4); wallZ(w, z0, z1, 102, 4);
    w.add(box(98.5, 0, s * 14 - 0.15, 101.5, 3, s * 14 + 0.15, "grade", "grate", s < 0 ? "porta-vala-n" : "porta-vala-s"));
  }
  // grade vermelha do túnel (abre quando o chefe cai)
  w.add(box(113.8, 0, -1.5, 114.2, 3, 1.5, "grade", "grate", "grade-tunel"));

  // 6 · Túnel de inspeção (x 114..140, z −1.5..1.5), teto 3
  floor(w, 114, -1.5, 140, 1.5, "concreto");
  wallX(w, 114, 140, -1.5, 3, [], "concreto"); wallX(w, 114, 140, 1.5, 3, [], "concreto");
  wallZ(w, -1.5, 1.5, 140, 3, [], "concreto");
}

const LIGHTS: LightDef[] = [
  // galeria dos filtros: lâmpadas frias sobre os tanques, uma piscando
  { pos: { x: 4, y: 4.4, z: 0 }, color: 0xbfd8e8, intensity: 12, distance: 10 },
  { pos: { x: 13, y: 4.4, z: 0 }, color: 0xa8c8e0, intensity: 14, distance: 11, flicker: 0.25 },
  { pos: { x: 22, y: 4.4, z: 0 }, color: 0xbfd8e8, intensity: 12, distance: 10 },
  { pos: { x: 5.2, y: 3, z: -4.8 }, color: 0xc89bff, intensity: 6, distance: 5 }, // bancada do Tear
  { pos: { x: 25, y: 2.8, z: 7.6 }, color: 0xffb060, intensity: 8, distance: 6 }, // quadro 1
  // batente amarelo
  { pos: { x: 34, y: 6.2, z: 0 }, color: 0xffd8a0, intensity: 18, distance: 15 },
  { pos: { x: 45, y: 6.2, z: 0 }, color: 0xb0c8e0, intensity: 18, distance: 15, flicker: 0.15 },
  { pos: { x: 50, y: 4.2, z: -6.8 }, color: 0xff6a3a, intensity: 10, distance: 8, id: "luz-bomba1" },
  { pos: { x: 40, y: 2.8, z: 7.2 }, color: 0x8fb0c8, intensity: 6, distance: 7 }, // corredor lateral
  // galeria baixa
  { pos: { x: 58, y: 5.3, z: 0 }, color: 0x9fc8e0, intensity: 14, distance: 12 },
  { pos: { x: 69, y: 5.3, z: 0 }, color: 0x9fc8e0, intensity: 12, distance: 12, flicker: 0.3 },
  { pos: { x: 78, y: 5.0, z: -5 }, color: 0xffd08a, intensity: 10, distance: 9 }, // curva
  { pos: { x: 66, y: 5.0, z: 6 }, color: 0x8fb0c8, intensity: 8, distance: 8 },
  { pos: { x: 79, y: 4, z: 6.5 }, color: 0xff6a3a, intensity: 10, distance: 8, id: "luz-bomba2" },
  { pos: { x: 79.2, y: 3.6, z: -2.4 }, color: 0xe8f4ff, intensity: 0, distance: 6, id: "lampada-1" },
  { pos: { x: 79.2, y: 3.6, z: 2.4 }, color: 0xe8f4ff, intensity: 0, distance: 6, id: "lampada-2" },
  // abrigo
  { pos: { x: 83, y: 2.8, z: 0 }, color: 0xffa040, intensity: 16, distance: 8 },
  // poço
  { pos: { x: 92, y: 8.2, z: -8 }, color: 0x7fa8c8, intensity: 22, distance: 18 },
  { pos: { x: 108, y: 8.2, z: 8 }, color: 0x7fa8c8, intensity: 22, distance: 18 },
  { pos: { x: 92, y: 8.2, z: 8 }, color: 0x9fb8c8, intensity: 18, distance: 16, flicker: 0.1 },
  { pos: { x: 108, y: 8.2, z: -8 }, color: 0x9fb8c8, intensity: 18, distance: 16 },
  { pos: { x: 100, y: 3, z: 0 }, color: 0x4fd0b0, intensity: 10, distance: 8, flicker: 0.2 }, // brilho do poço
  { pos: { x: 87, y: 3, z: -12 }, color: 0x7ff6ff, intensity: 6, distance: 5 }, // dispensador
  { pos: { x: 113, y: 3.6, z: 0 }, color: 0xff3030, intensity: 12, distance: 8, id: "luz-tunel" },
  // túnel
  { pos: { x: 122, y: 2.7, z: 0 }, color: 0x8fb0c8, intensity: 6, distance: 8, flicker: 0.4 },
  { pos: { x: 138, y: 2.7, z: 0 }, color: 0xffc070, intensity: 10, distance: 9 }, // luz da rua pela boca de visita
];

const DECOR: Decor[] = [
  // 1 · galeria dos filtros
  { kind: "manhole", pos: { x: 1, y: 0, z: 2.5 } },
  { kind: "sign", pos: { x: 6, y: 3.9, z: -5.75 }, rot: NORTH, text: "CASA DAS BOMBAS • GALERIA DOS FILTROS", color: 0x9fd0e8 },
  ...[8, 13, 18, 23].flatMap((x) => [{ kind: "filterTank", pos: { x, y: 0, z: -4.9 } }, { kind: "filterTank", pos: { x, y: 0, z: 4.9 } }]),
  { kind: "filterBed", pos: { x: 17.25, y: 1.0, z: 2.6 }, size: { x: 15.5, y: 0, z: 2.6 } },
  { kind: "filterBed", pos: { x: 17.25, y: 1.0, z: -2.6 }, size: { x: 15.5, y: 0, z: 2.6 } },
  { kind: "tearBench", pos: { x: 5.25, y: 0, z: -5 }, size: { x: 2.5, y: 0.95, z: 1.6 }, id: "bancada-tear" },
  { kind: "lineMark", pos: { x: 14, y: 0, z: 0 }, size: { x: 0.6, y: 0, z: 2.4 } },
  { kind: "sign", pos: { x: 14, y: 2.2, z: -1.35 }, rot: NORTH, text: "LINHA DO TEAR → FAIXA NO PISO", color: 0xc89bff },
  { kind: "quadro", pos: { x: 25, y: 0, z: 8.6 }, rot: SOUTH, id: "quadro-1" },
  { kind: "sign", pos: { x: 25, y: 3.4, z: 5.85 }, rot: NORTH + Math.PI, text: "QUADRO 1", color: 0xffb060 },
  { kind: "floorGrate", pos: { x: 27.4, y: 0.01, z: 0 }, id: "grelha-filtro" },
  { kind: "pipes", pos: { x: 14, y: 4.4, z: -5.85 }, size: { x: 26, y: 0, z: 0 } },
  { kind: "pipes", pos: { x: 14, y: 4.4, z: 5.85 }, rot: Math.PI, size: { x: 26, y: 0, z: 0 } },
  { kind: "cables", pos: { x: 14, y: 4.85, z: 0.8 }, size: { x: 26, y: 0, z: 0 } },
  { kind: "puddle", pos: { x: 6, y: 0, z: 1.5 }, size: { x: 2.4, y: 0, z: 1.6 } },
  { kind: "puddle", pos: { x: 20, y: 0, z: 0 }, size: { x: 3, y: 0, z: 1.6 } },
  { kind: "grime", pos: { x: 26, y: 0, z: -2 }, size: { x: 2.4, y: 0, z: 1.6 } },
  { kind: "drip", pos: { x: 12, y: 4.9, z: 0.4 } }, { kind: "drip", pos: { x: 21, y: 4.9, z: -0.4 } },
  { kind: "arrow", pos: { x: 27.75, y: 2.4, z: 2.2 }, rot: EAST },
  // 2 · batente amarelo
  { kind: "sign", pos: { x: 40, y: 5.4, z: -8.75 }, rot: NORTH, text: "BOMBA 1 • BATENTE DE MANUTENÇÃO", color: 0xffd040 },
  { kind: "pump", pos: { x: 50.2, y: 0, z: -6.9 }, rot: EAST, size: { x: 3.7, y: 2.6, z: 3.1 }, id: "bomba1" },
  { kind: "sign", pos: { x: 48.4, y: 3.2, z: -8.75 }, rot: NORTH, text: "BOMBA 1", color: 0xffb060 },
  { kind: "gauges", pos: { x: 45, y: 2.2, z: -8.75 }, rot: NORTH, id: "mostrador-1" },
  { kind: "pipes", pos: { x: 40, y: 5.6, z: -8.85 }, size: { x: 22, y: 0, z: 0 } },
  { kind: "cables", pos: { x: 40, y: 6.85, z: -2 }, size: { x: 22, y: 0, z: 0 } },
  { kind: "hangLamp", pos: { x: 34, y: 5.7, z: 0 } }, { kind: "hangLamp", pos: { x: 45, y: 5.7, z: 0 } },
  { kind: "puddle", pos: { x: 43, y: 0, z: 2 }, size: { x: 4, y: 0, z: 3 } },
  { kind: "rubble", pos: { x: 32.5, y: 0, z: 6.6 } },
  // v0.6 • a turma da manutenção não saiu: garras, rastro, mochila e ordens de serviço no chão; setas e luzes de saída
  { kind: "clawMarks", pos: { x: 10, y: 1.5, z: -5.95 }, size: { x: 0, y: 1.1, z: 0 } },
  { kind: "clawMarks", pos: { x: 20, y: 1.4, z: 5.95 }, rot: SOUTH, size: { x: 0, y: 0.9, z: 0 } },
  { kind: "dragMark", pos: { x: 14, y: 0, z: 0.8 }, rot: WEST, size: { x: 0.6, y: 0, z: 5 } },
  { kind: "note", pos: { x: 22, y: 0, z: -2 } },
  { kind: "note", pos: { x: 44, y: 0, z: -3.5 } },
  { kind: "floorArrow", pos: { x: 24, y: 0, z: 0 }, rot: WEST },
  { kind: "exitLight", pos: { x: 27.75, y: 2.85, z: 2.2 }, rot: EAST },
  { kind: "exitLight", pos: { x: 79.75, y: 2.95, z: 0 }, rot: EAST },
  { kind: "crateStack", pos: { x: 46, y: 0, z: 7.6 } },
  { kind: "grime", pos: { x: 36, y: 0, z: -2 }, size: { x: 3, y: 0, z: 2 } },
  { kind: "jet", pos: { x: 51.2, y: 2.4, z: -4.8 }, id: "jato" },
  // 3 · galeria baixa
  { kind: "sign", pos: { x: 66, y: 5.2, z: -7.75 }, rot: NORTH, text: "GALERIA BAIXA • BOMBA 2 →", color: 0x9fd0e8 },
  ...[58, 63, 69, 74].map((x) => ({ kind: "filterTank", pos: { x, y: 0, z: 3.3 }, size: { x: 1.9, y: 2.2, z: 1.8 } })),
  { kind: "pump", pos: { x: 79, y: 0, z: 6.4 }, rot: EAST, size: { x: 2.7, y: 2.2, z: 1.5 }, id: "bomba2" },
  { kind: "sign", pos: { x: 79.75, y: 3.2, z: 6.4 }, rot: EAST, text: "BOMBA 2", color: 0xffb060 },
  { kind: "quadro", pos: { x: 79.6, y: 0, z: -4 }, rot: EAST, id: "quadro-2" },
  { kind: "doorFrame", pos: { x: 66, y: 0, z: 7.95 }, rot: SOUTH, id: "porta-margem-quadro" },
  { kind: "sign", pos: { x: 57.7, y: 2.1, z: -4.8 }, rot: WEST, text: "RAMPA", color: 0xffd08a },
  { kind: "hatchRoof", pos: { x: 70, y: 5.9, z: 2 }, id: "abertura-teto" },
  { kind: "hatchRoof", pos: { x: 64, y: 5.9, z: -7 }, id: "alcapao-passarela" },
  { kind: "wallLamp", pos: { x: 79.75, y: 3.6, z: -2.4 }, rot: EAST, id: "lampada-1-vis" },
  { kind: "wallLamp", pos: { x: 79.75, y: 3.6, z: 2.4 }, rot: EAST, id: "lampada-2-vis" },
  { kind: "cables", pos: { x: 66, y: 5.85, z: 1 }, size: { x: 26, y: 0, z: 0 } },
  { kind: "puddle", pos: { x: 62, y: 0, z: 0 }, size: { x: 5, y: 0, z: 2.6 } },
  { kind: "puddle", pos: { x: 72, y: 0, z: 6 }, size: { x: 4, y: 0, z: 2 } },
  { kind: "drip", pos: { x: 60, y: 5.9, z: 1 } }, { kind: "drip", pos: { x: 74, y: 5.9, z: -1 } },
  { kind: "arrow", pos: { x: 79.75, y: 2.5, z: 0 }, rot: EAST },
  // 4 · abrigo
  { kind: "shelterSign", pos: { x: 83, y: 2.5, z: -2.8 }, rot: NORTH, text: "ABRIGO DO POÇO", color: 0xffb050 },
  { kind: "cot", pos: { x: 82.5, y: 0, z: 1.8 } },
  { kind: "backpack", pos: { x: 84.1, y: 0, z: 1.1 }, rot: 0.8 },
  { kind: "wallDrawing", pos: { x: 84.5, y: 1.5, z: 2.8 }, rot: SOUTH, text: "PLACAS: N • SE • SO" },
  // 5 · poço de sucção
  { kind: "sign", pos: { x: 100, y: 7.2, z: -13.75 }, rot: NORTH, text: "POÇO DE SUCÇÃO", color: 0x7fe0c8 },
  { kind: "well", pos: { x: 100, y: 0, z: 0 }, id: "poco" },
  { kind: "railRing", pos: { x: 100, y: 8.6, z: 0 } },
  { kind: "plate", pos: { x: 100, y: 0, z: -8.5 }, id: "placa-0" },
  { kind: "plate", pos: { x: 107.4, y: 0, z: 4.8 }, id: "placa-1" },
  { kind: "plate", pos: { x: 92.6, y: 0, z: 4.8 }, id: "placa-2" },
  { kind: "dispenser", pos: { x: 86.25, y: 1.3, z: -12.2 }, rot: WEST, id: "dispensador" },
  { kind: "gauges", pos: { x: 113.75, y: 2.6, z: -4 }, rot: EAST, id: "mostrador-2" },
  { kind: "gauges", pos: { x: 113.75, y: 2.6, z: 4 }, rot: EAST, id: "mostrador-3" },
  { kind: "pipes", pos: { x: 100, y: 6.5, z: -13.85 }, size: { x: 28, y: 0, z: 0 } },
  { kind: "pipes", pos: { x: 100, y: 6.5, z: 13.85 }, rot: Math.PI, size: { x: 28, y: 0, z: 0 } },
  { kind: "doorFrame", pos: { x: 100, y: 0, z: -13.95 }, rot: NORTH, id: "porta-vala-n-quadro" },
  { kind: "doorFrame", pos: { x: 100, y: 0, z: 13.95 }, rot: SOUTH, id: "porta-vala-s-quadro" },
  { kind: "puddle", pos: { x: 94, y: 0, z: -6 }, size: { x: 4, y: 0, z: 3 } },
  { kind: "puddle", pos: { x: 106, y: 0, z: -2 }, size: { x: 3, y: 0, z: 4 } },
  { kind: "grime", pos: { x: 104, y: 0, z: 10 }, size: { x: 4, y: 0, z: 2 } },
  { kind: "drip", pos: { x: 96, y: 8.9, z: 6 } }, { kind: "drip", pos: { x: 105, y: 8.9, z: -7 } },
  { kind: "chain", pos: { x: 90, y: 9, z: 10 } }, { kind: "chain", pos: { x: 110, y: 9, z: -10 } },
  // 6 · túnel
  { kind: "tunnelWater", pos: { x: 127, y: 0, z: 0 }, size: { x: 26, y: 0, z: 3 }, id: "agua-tunel" },
  { kind: "manhole", pos: { x: 138.6, y: 0, z: 0 }, id: "boca-de-visita" },
  { kind: "cables", pos: { x: 127, y: 2.85, z: 1.1 }, size: { x: 26, y: 0, z: 0 } },
];

export const F3: LevelDef = {
  id: "F3",
  nome: "F3 • Casa das Bombas",
  build: buildF3,
  spawns: {
    "F3-A": { pos: { x: 2.2, y: 0, z: 0.5 }, yaw: EAST },
    "F3-B": { pos: { x: 82.5, y: 0, z: -0.8 }, yaw: EAST },
  },
  lights: LIGHTS,
  decor: DECOR,
  ceilings: [
    { min: { x: 0, y: 5, z: -6 }, max: { x: 28, y: 5.2, z: 6 }, mat: "teto" },
    { min: { x: 23, y: 3.2, z: 6 }, max: { x: 27, y: 3.4, z: 9 }, mat: "teto" },
    { min: { x: 28, y: 7, z: -9 }, max: { x: 52, y: 7.2, z: 9 }, mat: "teto" },
    { min: { x: 52, y: 6, z: -8 }, max: { x: 80, y: 6.2, z: 8 }, mat: "teto" },
    { min: { x: 64, y: 4, z: 8 }, max: { x: 68, y: 4.2, z: 11 }, mat: "teto" },
    { min: { x: 80, y: 3.2, z: -3 }, max: { x: 86, y: 3.4, z: 3 }, mat: "teto" },
    { min: { x: 86, y: 9, z: -14 }, max: { x: 114, y: 9.2, z: 14 }, mat: "teto" },
    { min: { x: 98, y: 4, z: -17 }, max: { x: 102, y: 4.2, z: -14 }, mat: "teto" },
    { min: { x: 98, y: 4, z: 14 }, max: { x: 102, y: 4.2, z: 17 }, mat: "teto" },
    { min: { x: 114, y: 3, z: -1.5 }, max: { x: 140, y: 3.2, z: 1.5 }, mat: "teto" },
  ],
  env: {
    fogColor: 0x0a1214, fogDensity: 0.028, ambient: 0.28, hemiSky: 0x2a4a52, hemiGround: 0x0c0e0c, sky: false, rain: false, sea: false, music: "explore",
    outdoors: [],
  },
  script: (sim: Sim) => new F3Script(sim),
};

export class F3Script {
  arenaGal: ArenaDirector | null = null;
  arenaPico: ArenaDirector | null = null;
  arenaIds = new Set<string>();
  timers: { t: number; fn: () => void }[] = [];
  boss: Creature | null = null;
  bossStarted = false;
  bossDead = false;
  bossT = 0;
  transitions = 0;
  dispenserT = 0;
  dispensed = 0;
  exitDone = false;
  route: "passarela" | "margem" = "margem";
  stuckBy: Record<string, number> = { lia: 0, baliza: 0, demo: 0 };
  carapacaOpened = 0;
  private carPrev = "";
  water = 1;
  private seenEv = new WeakSet<object>();
  constructor(private sim: Sim) {}
  later(t: number, fn: () => void) { this.timers.push({ t, fn }); }

  private makeArena(wave: { type: CreatureType; door: string }[], perches: V3[], tag: string) {
    const s = this.sim;
    const ar = new ArenaDirector(wave, [], {
      activeCount: () => s.activeCommons(),
      distanceToDoor: (d) => s.distTo(F3_DOORS[d].spawn),
      telegraph: (d) => s.emit({ type: "doorVibrate", door: d, decor: F3_DOORS[d].decor, pos: F3_DOORS[d].door, label: F3_DOORS[d].label }),
      spawn: (type, d) => this.spawnAt(type, d, tag, perches),
      isAlive: (id) => !!s.creature(id)?.alive,
    }, DIFFICULTY[s.difficulty].reinforce);
    ar.maxActive = ENCOUNTER.maxActiveF3;
    return ar;
  }

  private spawnAt(type: CreatureType, d: string, tag: string, perches: V3[] = []) {
    const s = this.sim, door = F3_DOORS[d];
    const leaf = d === "margem" ? "porta-margem" : d === "rampa" ? "porta-rampa-folha" : d === "valaN" ? "porta-vala-n" : d === "valaS" ? "porta-vala-s" : null;
    if (leaf && s.world.get(leaf)?.enabled) { s.world.setEnabled(leaf, false); s.emit({ type: "doorOpen", id: leaf, pos: door.door }); }
    if (door.decor) s.emit({ type: "doorOpen", id: door.decor, pos: door.door });
    const jit = d === "margem" || d === "valaN" || d === "valaS" ? (s.rand() - 0.5) * 2 : 0;
    const pos = { x: door.spawn.x + jit, y: door.spawn.y, z: door.spawn.z };
    const opts: Partial<Creature> = { tag, door: d, relentless: true, perches: type === "estilhaco" ? perches : [] };
    if (type === "veu") Object.assign(opts, { home: { x: 72, y: 0, z: 0 }, leash: 6, hover: 3.2 });
    const c = s.spawnCreature(type, pos, opts);
    if (type === "veu") { c.pos.y = 2.8; c.aware = true; } else c.set("emerging");
    this.arenaIds.add(c.id);
    return c.id;
  }

  start(point: string) {
    const s = this.sim, f = s.flags;
    if (point === "F3-B") { f.tear = true; f.bomba1 = true; f.bomba2 = true; f.abrigoB = true; f.pico = true; }

    // 1 · Galeria dos filtros: o Tear na bancada; dois Riscadores na faixa em momentos diferentes
    if (!f.tear) {
      s.interactables.push({
        id: "tear", pos: F3_POINTS.tear, radius: 2.6, prompt: "Pegar o Tear", enabled: () => !f.tear,
        use: () => {
          if (f.tear) return;
          f.tear = true;
          s.arsenal.give("tear");
          if (s.arsenal.switchTo("tear")) s.emit({ type: "switch", weapon: "tear" });
          s.emit({ type: "equip", what: "tear" });
          s.setObjective("Atravesse a galeria dos filtros");
          s.say("Nara", "Esse é o Tear. O fio atravessa um e pega o de trás. Botão direito estica uma linha no piso: quem pisa, sente.", 6);
        },
      });
    }
    if (point === "F3-A") {
      s.setObjective(f.tear ? "Atravesse a galeria dos filtros" : "Pegue o Tear na bancada da galeria");
      this.later(0.8, () => s.say("Nara", "Casa das Bombas, Lia. A água cobre os trilhos de serviço. Liga as duas bombas e a gente passa.", 6));
      s.pickups.push({ id: "curativo-quadro1", pos: { x: 24.2, y: 0, z: 7.8 }, kind: "curativo", amount: 1, taken: false });
      s.pickups.push({ id: "dardos-filtros", pos: { x: 3, y: 0, z: 4.6 }, kind: "dardos", amount: 24, taken: false });
      s.triggers.push({
        id: "faixa", min: { x: 9, y: -1, z: -1.4 }, max: { x: 26, y: 3, z: 1.4 }, once: true, fired: false,
        onEnter: () => {
          s.say("Nara", "Faixa estreita. Viu a marca no piso? Estica a linha ali e deixa eles virem.", 5);
          s.emit({ type: "doorVibrate", door: "grelha", decor: "grelha-filtro", pos: F3_DOORS.grelha.door, label: F3_DOORS.grelha.label });
          this.later(1.1, () => this.spawnAt("riscador", "grelha", "filtro"));
          this.later(7.5, () => { s.emit({ type: "doorVibrate", door: "grelha", decor: "grelha-filtro", pos: F3_DOORS.grelha.door, label: F3_DOORS.grelha.label }); this.later(1.1, () => this.spawnAt("riscador", "grelha", "filtro")); });
        },
      });
    }

    // 2 · Batente amarelo: a Carapaça sozinha; a bomba 1 revela a escada de serviço
    if (!f.bomba1) {
      const car = s.spawnCreature("carapaca", { x: 46, y: 0, z: -1.5 }, { tag: "carapaca", home: { x: 45, y: 0, z: -2.5 } });
      car.yaw = WEST;
      s.triggers.push({
        id: "batente", min: { x: 29, y: -1, z: -9 }, max: { x: 52, y: 5, z: 9 }, once: true, fired: false,
        onEnter: () => {
          s.setObjective("Ligue a bomba 1 (parede norte)");
          s.say("Nara", "Carapaça. Placa grossa na frente. Faz ela trombar no batente amarelo: as placas abrem. Ou pega pelas costas.", 6);
        },
      });
      s.interactables.push({
        id: "bomba1", pos: F3_POINTS.bomba1, radius: 2.4, prompt: "Ligar a bomba 1", enabled: () => !f.bomba1,
        use: () => {
          if (f.bomba1) return;
          f.bomba1 = true;
          s.emit({ type: "pump", id: "bomba1", pos: F3_POINTS.bomba1 });
          this.later(0.8, () => { s.world.setEnabled("persiana-galeria", false); s.emit({ type: "doorOpen", id: "persiana-galeria", pos: { x: 52, y: 1.4, z: 0 } }); s.emit({ type: "jet", id: "jato" }); });
          s.setObjective("Suba pela escada de serviço e ligue a bomba 2");
          s.say("Nara", "Bomba 1 respondeu! O jato levantou a persiana. Tem uma escada de serviço logo atrás.", 5);
        },
      });
    } else {
      s.world.setEnabled("persiana-galeria", false);
    }

    // 3 · Galeria baixa: travessia (2 Riscadores + Estilhaço) e o pico na curva em U
    this.arenaGal = this.makeArena(WAVE_GALERIA, GAL_PERCHES, "galeria");
    this.arenaPico = this.makeArena(WAVE_PICO, [], "pico");
    if (!f.bomba2) {
      s.pickups.push({ id: "curativo-galeria", pos: { x: 60, y: 2.6, z: -6.8 }, kind: "curativo", amount: 1, taken: false });
      s.pickups.push({ id: "tear-galeria", pos: { x: 76.8, y: 0, z: 3 }, kind: "tear", amount: 12, taken: false });
      s.triggers.push({
        id: "galeria", min: { x: 52.6, y: -1, z: -8 }, max: { x: 80, y: 6, z: 8 }, once: true, fired: false,
        onEnter: () => {
          if (this.arenaGal!.state !== "idle") return;
          this.arenaGal!.start();
          s.emit({ type: "arenaStart" });
          s.say("Nara", "Barulho na rampa e na porta sul. Alinha eles no corredor ou segue pela margem.", 5);
        },
      });
      s.triggers.push({
        id: "pico", min: { x: 76, y: 2.0, z: -8 }, max: { x: 80, y: 4, z: -1 }, once: true, fired: !!f.pico,
        onEnter: () => {
          if (f.pico) return;
          f.pico = true; this.route = "passarela";
          this.arenaPico!.start();
          // o aviso da rampa antecede o da abertura em 2 s
          this.later(2, () => { s.emit({ type: "doorVibrate", door: "abertura", decor: "abertura-teto", pos: F3_DOORS.abertura.door, label: F3_DOORS.abertura.label }); this.later(1.1, () => this.spawnAt("veu", "abertura", "pico")); });
          s.say("Nara", "Na curva! Três pela rampa de volta — e alguma coisa na abertura de cima.", 5);
        },
      });
      s.interactables.push({
        id: "bomba2", pos: F3_POINTS.bomba2, radius: 2.4, prompt: "Ligar a bomba 2", enabled: () => !f.bomba2,
        // travessia: aceita mesmo com a fila cheia
        use: () => {
          if (f.bomba2) return;
          f.bomba2 = true;
          s.emit({ type: "pump", id: "bomba2", pos: F3_POINTS.bomba2 });
          this.later(0.7, () => s.emit({ type: "lightOn", id: "lampada-1" }));
          this.later(1.4, () => { s.emit({ type: "lightOn", id: "lampada-2" }); s.world.setEnabled("porta-abrigo", false); s.emit({ type: "doorOpen", id: "porta-abrigo", pos: { x: 80, y: 1.4, z: 0 } }); });
          s.setObjective("Entre no abrigo do poço");
          s.say("Nara", "As duas bombas! Duas lâmpadas acesas — o abrigo do poço abriu. Corre!", 5);
        },
      });
    } else {
      s.world.setEnabled("porta-abrigo", false);
      s.emit({ type: "lightOn", id: "lampada-1" }); s.emit({ type: "lightOn", id: "lampada-2" });
    }

    // 4 · Abrigo do poço (F3-B)
    s.triggers.push({
      id: "abrigo", min: { x: 80.6, y: -1, z: -2.8 }, max: { x: 85.6, y: 3, z: 2.8 }, once: true, fired: false,
      onEnter: () => {
        s.world.setEnabled("divisoria", true);
        const keep = s.creatures.filter((c) => c.pos.x >= 80);
        s.creatures.length = 0; s.creatures.push(...keep);
        s.clouds = s.clouds.filter((c) => c.pos.x >= 80);
        const first = !f.abrigoB;
        f.abrigoB = true;
        s.setObjective("Desça ao poço de sucção");
        s.applyShelterFloor();
        s.emit({ type: "save", point: "F3-B" });
        if (first) s.say("Nara", "Abrigo do poço. Tem um sino lá embaixo, pendurado... imitando a bomba parada. Recarrega antes.", 6);
      },
    });
    if (point === "F3-B") { s.world.setEnabled("divisoria", true); s.setObjective("Desça ao poço de sucção"); }

    // 5 · Poço de sucção: o Badalo
    this.boss = s.spawnCreature("badalo", { ...F3_POINTS.wellCenter }, { tag: "badalo", plates: F3_POINTS.plates.map((p) => ({ ...p })), home: { ...F3_POINTS.wellCenter } });
    s.triggers.push({
      id: "poco", min: { x: 87.5, y: -1, z: -14 }, max: { x: 114, y: 6, z: 14 }, once: true, fired: false,
      onEnter: () => {
        if (this.bossStarted) return;
        this.bossStarted = true;
        s.world.setEnabled("porta-poco", true);
        s.emit({ type: "doorClose", id: "porta-poco" });
        this.boss!.set("intro");
        s.emit({ type: "bossStart", id: this.boss!.id, name: "Badalo" });
        s.emit({ type: "arenaStart" });
        s.setObjective("Derrube o Badalo: faça-o cair nas placas e acerte o órgão");
        s.say("Nara", "Olha a placa norte! Quando ele bate numa placa, o órgão aparece. Atira ali.", 5);
      },
    });
    s.interactables.push({
      id: "dispensador", pos: F3_POINTS.dispenser, radius: 2.2, prompt: "Dispensador de dardos (+24)",
      enabled: () => this.dispenserT <= 0 && !!s.arsenal.owned.get("agulha"),
      lockedPrompt: () => (this.dispenserT > 0 ? `Dispensador recarregando: ${Math.ceil(this.dispenserT)} s` : null),
      use: () => {
        if (this.dispenserT > 0) return;
        const n = s.arsenal.addReserve("agulha", 24);
        this.dispenserT = F3_POINTS.dispenserCooldown; this.dispensed++;
        s.emit({ type: "pickup", kind: "dardos", amount: n, id: "dispensador" });
        s.emit({ type: "dispense", id: "dispensador" });
      },
    });

    // 6 · Saída de inspeção
    s.triggers.push({
      id: "saida", min: { x: F3_POINTS.exitX, y: -1, z: -1.5 }, max: { x: 140, y: 3, z: 1.5 }, once: true, fired: false,
      onEnter: () => {
        if (this.exitDone || !this.bossDead) return;
        this.exitDone = true;
        s.done = true;
        s.emit({ type: "levelComplete", route: this.route, boss: +this.bossT.toFixed(1), stuck: { ...this.stuckBy } });
      },
    });
    s.triggers.push({
      id: "eco", min: { x: 124, y: -1, z: -1.5 }, max: { x: 128, y: 3, z: 1.5 }, once: true, fired: false,
      onEnter: () => { if (this.bossDead) s.say("Nara (eco)", "...as duas bombas... corre... o abrigo do poço abriu...", 4); },
    });
  }

  private onBossEvents() {
    const s = this.sim, b = this.boss!;
    for (const e of s.events) {
      if (e.id !== b.id || this.seenEv.has(e)) continue;
      this.seenEv.add(e);
      if (e.type === "badaloStuck") this.stuckBy[e.src] = (this.stuckBy[e.src] ?? 0) + 1;
      if (e.type === "badaloHalf") {
        // um par de Riscadores entra uma única vez na transição (até dois comuns na sala)
        this.transitions++;
        s.say("Nara", "Ele tá rachando! Vem coisa pelas valas — usa o Tear no acesso.", 4);
        for (const d of ["valaN", "valaS"]) {
          s.emit({ type: "doorVibrate", door: d, decor: d === "valaN" ? "porta-vala-n-quadro" : "porta-vala-s-quadro", pos: F3_DOORS[d].door, label: F3_DOORS[d].label });
          this.later(1.1, () => { if (!this.bossDead && s.activeCommons() < BADALO.maxCommons) this.spawnAt("riscador", d, "transicao"); });
        }
      }
    }
  }

  update(dt: number) {
    const s = this.sim;
    for (const t of [...this.timers]) { t.t -= dt; if (t.t <= 0) { this.timers.splice(this.timers.indexOf(t), 1); t.fn(); } }
    this.arenaGal?.update(dt); this.arenaPico?.update(dt);
    for (const id of this.arenaIds) {
      const c = s.creature(id);
      if (c && c.alive && c.type !== "veu" && c.noPathT > 5) s.reintroduce(c, F3_DOORS[c.door].spawn);
    }
    this.dispenserT = Math.max(0, this.dispenserT - dt);
    const b = this.boss;
    if (b && this.bossStarted && !this.bossDead) {
      this.bossT += dt;
      this.onBossEvents();
      if (!b.alive) {
        this.bossDead = true;
        // cancela onda e reforços pendentes; os mostradores caem e o túnel drena
        this.timers.length = 0;
        for (const c of s.creatures) if (c.alive && c.tag === "transicao") s.forceKill(c);
        s.world.setEnabled("grade-tunel", false);
        s.emit({ type: "doorOpen", id: "grade-tunel", pos: { x: 114, y: 1.4, z: 0 } });
        s.emit({ type: "bossDead", id: b.id });
        s.emit({ type: "lightColor", id: "luz-tunel", color: 0xe8f4ff });
        s.setObjective("Siga pelo túnel de inspeção até a boca de visita");
        s.say("Nara", "Parou! Os mostradores foram a zero... o túnel tá secando. Vai pela inspeção!", 5);
      }
    }
    for (const c of s.creatures) if (c.type === "carapaca") { if (c.state === "open" && this.carPrev !== "open") this.carapacaOpened++; this.carPrev = c.state; }
    // nível da água no túnel acompanha o chefe: cheio enquanto vive, drena em ~4 s depois
    this.water = this.bossDead ? Math.max(0, this.water - dt / 4) : 1;
    s.vars.agua = this.water;
    s.vars.bossHp = b ? b.hp / b.maxHp : 0;
    s.vars.dispenser = this.dispenserT;
  }

  diagnostics() {
    const b = this.boss;
    return {
      arena: `${this.arenaGal?.state}/${this.arenaPico?.state}`, boss: b ? `${b.state} ${Math.ceil(b.hp)}/${b.maxHp}` : "-",
      transitions: this.transitions, stuck: this.stuckBy, water: +this.water.toFixed(2), route: this.route,
    };
  }
}
