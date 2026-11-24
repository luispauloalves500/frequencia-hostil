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
