import type { V3 } from "../core/math";
import type { World } from "../core/world";
import type { Sim } from "../core/sim";

export interface LightDef { pos: V3; color: number; intensity: number; distance: number; flicker?: number; id?: string; on?: boolean; shadow?: boolean }
export interface Decor { kind: string; pos: V3; rot?: number; size?: V3; color?: number; text?: string; id?: string; data?: any }

export interface LevelEnv {
  fogColor: number;
  fogDensity: number;
  ambient: number;
  hemiSky: number;
  hemiGround: number;
  sky: boolean;
  rain: boolean;
  sea: boolean;
  music: string;
  /** áreas com chuva: [x0, z0, x1, z1, piso] (padrão: as de F1) */
  rainRects?: [number, number, number, number, number][];
  /** plano do mar/canal: centro e tamanho (padrão: o de F1) */
  seaRect?: { x: number; z: number; w: number; d: number };
  /** cais com postes e lampiões (F1) */
  quay?: boolean;
  /** áreas a céu aberto (ambiente sonoro externo) */
  outdoors?: [number, number, number, number][];
  /** câmera do menu/visual da balsa */
  ferryPath?: boolean;
}

export interface LevelDef {
  id: string;
  nome: string;
  build(world: World): void;
  spawns: Record<string, { pos: V3; yaw: number }>;
  lights: LightDef[];
  decor: Decor[];
  ceilings: { min: V3; max: V3; mat: string }[];
  env: LevelEnv;
  script(sim: Sim): LevelScript;
}

export interface LevelScript {
  start(point: string): void;
  update(dt: number): void;
  diagnostics?(): Record<string, unknown>;
}
