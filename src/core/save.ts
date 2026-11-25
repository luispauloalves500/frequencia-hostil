import type { AmmoState } from "./weapons";
import type { Difficulty, WeaponId } from "../config";

export const SAVE_VERSION = 1;

export interface Checkpoint {
  phase: string; // "F1" | "F2" ("F2P" = prévia antiga, migrada para "F2")
  point: string; // "F1-A" | "F1-B" | "F2-A" | "F2-B"
  hp: number;
  medkits: number;
  weapons: Record<string, AmmoState>;
  current: WeaponId | null;
  hasBeacon: boolean;
  objective: string;
  flags: Record<string, boolean>;
  difficulty: Difficulty;
  playTime: number;
  /** quedas acumuladas no capítulo (opcional para saves antigos) */
  deaths?: number;
  /** contadores do capítulo até este registro (resultado não zera ao Continuar) */
  stats?: { kills?: number; shots?: number; hits?: number; pulses?: number; damageTaken?: number; foleShots?: number; foleHits?: number; sopros?: number };
}

export interface SaveData {
  version: number;
  seq: number;
  savedAt: number;
  checkpoint: Checkpoint;
  completed: string[]; // fases concluídas
  unlocked: string[];
  stats?: Record<string, number>;
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export class MemoryKV implements KV {
  m = new Map<string, string>();
  failWrites = false;
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { if (this.failWrites) throw new Error("quota"); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function checksum(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function validCheckpoint(c: any): c is Checkpoint {
  return c && typeof c.phase === "string" && typeof c.point === "string" && typeof c.hp === "number" && c.hp > 0 && c.hp <= 100
    && typeof c.medkits === "number" && c.weapons && typeof c.weapons === "object" && typeof c.flags === "object";
}

/** Dois registros locais versionados. Grava no registro mais antigo e só promove após validar. */
export class SaveStore {
  static KEYS = ["fh.save.0", "fh.save.1"] as const;
  sessionOnly = false;
  private mem: SaveData | null = null;
  constructor(private kv: KV | null) { if (!kv) this.sessionOnly = true; }

  private readSlot(i: number): SaveData | null {
    if (!this.kv) return null;
    try {
      const raw = this.kv.getItem(SaveStore.KEYS[i]);
      if (!raw) return null;
      const env = JSON.parse(raw);
      if (typeof env.sum !== "number" || typeof env.body !== "string") return null;
      if (checksum(env.body) !== env.sum) return null;
      const d = JSON.parse(env.body) as SaveData;
      if (d.version !== SAVE_VERSION || !validCheckpoint(d.checkpoint)) return null;
      return d;
    } catch { return null; }
  }

  /** Último registro válido (o mais recente que passa na validação). */
  load(): SaveData | null {
    if (this.sessionOnly) return this.mem;
    const a = this.readSlot(0), b = this.readSlot(1);
    if (a && b) return a.seq >= b.seq ? a : b;
    return a ?? b ?? this.mem;
  }

  hasSave(): boolean { return this.load() !== null; }

  /** Grava. Retorna "ok" quando confirmado ou "session" quando só ficou em memória. */
  save(data: Omit<SaveData, "version" | "seq" | "savedAt">): "ok" | "session" {
    const prev = this.load();
    const full: SaveData = { ...data, version: SAVE_VERSION, seq: (prev?.seq ?? 0) + 1, savedAt: Date.now() };
    this.mem = JSON.parse(JSON.stringify(full));
    if (this.sessionOnly || !this.kv) return "session";
    const a = this.readSlot(0), b = this.readSlot(1);
    // escreve sobre o registro mais antigo/inválido, preservando o outro
    let slot = 0;
    if (!a) slot = 0; else if (!b) slot = 1; else slot = a.seq <= b.seq ? 0 : 1;
    try {
      const body = JSON.stringify(full);
      this.kv.setItem(SaveStore.KEYS[slot], JSON.stringify({ sum: checksum(body), body }));
      const back = this.readSlot(slot);
      if (!back || back.seq !== full.seq) throw new Error("verificação falhou");
      return "ok";
    } catch {
      this.sessionOnly = true;
      return "session";
    }
  }

  clear() { if (this.kv) for (const k of SaveStore.KEYS) this.kv.removeItem(k); this.mem = null; }
}

export function browserKV(): KV | null {
  try {
    const t = "__fh_probe";
    localStorage.setItem(t, "1"); localStorage.removeItem(t);
    return localStorage;
  } catch { return null; }
}
