// Tabelas numéricas do GDD (Normal). Todos os valores em metros, segundos e pontos.
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

export const MOVE = {
  walk: 5.5,
  sprint: 8,
  crouch: 2.6,
  jumpHeight: 1.0,
  gravity: 22,
  slideDuration: 0.55,
  slideDistance: 3.8,
  slideCooldown: 1.2,
  radius: 0.35,
  standHeight: 1.75,
  crouchHeight: 1.0,
  eyeStand: 1.6,
  eyeCrouch: 0.85,
  stepHeight: 0.45,
  accelGround: 60,
  accelAir: 12,
};

export const PLAYER = {
  maxHp: 100,
  maxMedkits: 2,
  medkitHeal: 40,
  medkitTime: 0.6,
  shelterMinHp: 60,
  shelterMinNeedleReserve: 24,
};

export const BEACON = {
  throwRange: 14,
  callRadius: 7,
  callDuration: 2.5,
  armedTimeout: 6,
  recharge: 5,
  flightTime: 0.45,
};

export type WeaponId = "agulha" | "fole" | "tear" | "diapasao";

export interface WeaponDef {
  id: WeaponId;
  nome: string;
  slot: number;
  damage: number;
  rate: number; // disparos por segundo
  mag: number;
  reserveMax: number;
  reload: number;
  altCost: number;
  altNome: string;
  range: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  agulha: { id: "agulha", nome: "Agulha", slot: 1, damage: 16, rate: 5, mag: 24, reserveMax: 144, reload: 1.4, altCost: 3, altNome: "MARCA", range: 80 },
  fole: { id: "fole", nome: "Fole", slot: 2, damage: 8, rate: 1.4, mag: 8, reserveMax: 32, reload: 1.8, altCost: 2, altNome: "SOPRO", range: 20 },
  tear: { id: "tear", nome: "Tear", slot: 3, damage: 24, rate: 3, mag: 12, reserveMax: 60, reload: 1.6, altCost: 3, altNome: "LINHA", range: 60 },
  diapasao: { id: "diapasao", nome: "Diapasão", slot: 4, damage: 45, rate: 1.2, mag: 8, reserveMax: 32, reload: 2.0, altCost: 4, altNome: "ONDA", range: 40 },
};

export const NEEDLE_MARK = { duration: 4, bonus: 32 };
export const SWITCH_TIME = 0.45;
export const SWITCH_BUFFER = 0.12;

export const RISCADOR = {
  hp: 48,
  damage: 12,
  speed: 4.6,
  scratchTime: 0.5, // dois riscos no piso
  compressTime: 0.6,
  leapRange: 4,
  leapTime: 0.42,
  skidTime: 1.0,
  secondLeapDelay: 0.45,
  sightRange: 22,
  radius: 0.45,
  height: 0.9,
};

export const ESTILHACO = {
  hp: 64,
  damage: 14,
  speed: 3.2,
  aimTime: 0.9,
  projectileSpeed: 15,
  shotsBeforeMove: 2,
  cooldown: 1.3,
  sightRange: 30,
  radius: 0.45,
  height: 2.1,
};

export const ENCOUNTER = {
  maxActiveF1: 6,
  entryTelegraph: 1.0,
  minSpawnDistance: 6,
  pendingRetry: 1.0,
  wave2MinTime: 8,
  wave2MaxRemaining: 1,
  forgetTime: 3,
};

export const DIFFICULTY = {
  historia: { damageTaken: 0.7, reinforce: 1 },
  normal: { damageTaken: 1, reinforce: 1 },
  intenso: { damageTaken: 1.25, reinforce: 0.8 },
} as const;
export type Difficulty = keyof typeof DIFFICULTY;
