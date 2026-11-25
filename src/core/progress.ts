import type { Checkpoint } from "./save";
import type { Difficulty } from "../config";
import { WEAPONS } from "../config";

/**
 * Registro de entrada da F2 a partir do estado com que a F1 terminou: vida, curativos, arsenal (pente e reserva),
 * arma em mãos e baliza seguem; tempo, quedas, contadores e flags do capítulo recomeçam.
 */
export function f2EntryFromF1(f1End: Checkpoint): Checkpoint {
  return { ...f1End, phase: "F2", point: "F2-A", objective: "", flags: {}, playTime: 0, deaths: 0, stats: undefined, weapons: JSON.parse(JSON.stringify(f1End.weapons)) };
}

/** Para repetição sem o registro da F1: o arsenal padrão de quem termina a F1. */
export function defaultF2Entry(difficulty: Difficulty): Checkpoint {
  return { phase: "F2", point: "F2-A", hp: 100, medkits: 1, weapons: { agulha: { mag: WEAPONS.agulha.mag, reserve: 72 } }, current: "agulha", hasBeacon: true, objective: "", flags: {}, difficulty, playTime: 0, deaths: 0 };
}

/** Saves da prévia antiga ("F2P") passam a abrir a F2 real no começo, mantendo o inventário. */
export function migrateCheckpoint(cp: Checkpoint): Checkpoint {
  return cp.phase === "F2P" ? f2EntryFromF1(cp) : cp;
}
