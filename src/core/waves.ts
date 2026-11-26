import { ENCOUNTER } from "../config";

export type CreatureType = "riscador" | "estilhaco" | "veu" | "carapaca" | "badalo";
export interface WaveEntry { type: CreatureType; door: string }

export interface ArenaHooks {
  /** número de comuns vivos no mundo */
  activeCount(): number;
  /** distância de Lia até a porta */
  distanceToDoor(door: string): number;
  /** porta começa a vibrar (aviso) */
  telegraph(door: string, wave: number): void;
  /** cria a criatura e devolve seu id */
  spawn(type: CreatureType, door: string, wave: number): string;
  isAlive(id: string): boolean;
}

interface Pending { entry: WaveEntry; wave: number; telegraphT: number; retryT: number; telegraphed: boolean }

/**
 * Arena da catraca. Onda 1 ao cruzar a soleira. Onda 2 uma única vez, após >= 8 s
 * e quando restar no máximo um inimigo da onda 1. Painel liga quando a fila esvazia e
 * o último inimigo das duas ondas cai.
 */
export class ArenaDirector {
  state: "idle" | "wave1" | "wave2" | "cleared" = "idle";
  t = 0;
  wave2Started = false;
  wave2StartTime = -1;
  pending: Pending[] = [];
  ids: { id: string; wave: number }[] = [];
  spawnLog: { type: CreatureType; door: string; wave: number; t: number }[] = [];
  telegraphLog: { door: string; wave: number; t: number }[] = [];
  maxActive = ENCOUNTER.maxActiveF1;

  constructor(public wave1: WaveEntry[], public wave2: WaveEntry[], private hooks: ArenaHooks, private reinforceScale = 1) {}

  start() {
    if (this.state !== "idle") return;
    this.state = "wave1"; this.t = 0;
    this.queue(this.wave1, 1);
  }

  private queue(entries: WaveEntry[], wave: number) {
    for (const e of entries) this.pending.push({ entry: e, wave, telegraphT: 0, retryT: 0, telegraphed: false });
  }

  aliveOf(wave: number) { return this.ids.filter((i) => i.wave === wave && this.hooks.isAlive(i.id)).length; }
  remainingWave1() { return this.aliveOf(1) + this.pending.filter((p) => p.wave === 1).length; }

  panelUnlocked() { return this.state === "cleared"; }

  blockReason(): string {
    if (this.state === "idle") return "arena não iniciada";
    if (this.state === "cleared") return "liberado";
    if (this.pending.length) return `entradas pendentes: ${this.pending.length}`;
    const alive = this.ids.filter((i) => this.hooks.isAlive(i.id)).length;
    if (!this.wave2Started) return `aguardando onda 2 (${alive} vivos)`;
    return `inimigos vivos: ${alive}`;
  }

  update(dt: number) {
    if (this.state === "idle" || this.state === "cleared") return;
    this.t += dt;

    // gatilho da onda 2 (uma única vez)
    if (!this.wave2Started && this.t >= ENCOUNTER.wave2MinTime * this.reinforceScale && this.remainingWave1() <= ENCOUNTER.wave2MaxRemaining) {
      this.wave2Started = true; this.wave2StartTime = this.t; this.state = "wave2";
      this.queue(this.wave2, 2);
    }

    // entradas: cada porta avisa por >= 1 s; libera respeitando teto e distância mínima
    for (const p of [...this.pending]) {
      if (!p.telegraphed) {
        p.telegraphed = true;
        this.hooks.telegraph(p.entry.door, p.wave);
        this.telegraphLog.push({ door: p.entry.door, wave: p.wave, t: this.t });
      }
      p.telegraphT += dt;
      if (p.telegraphT < ENCOUNTER.entryTelegraph) continue;
      p.retryT -= dt;
      if (p.retryT > 0) continue;
      if (this.hooks.activeCount() >= this.maxActive || this.hooks.distanceToDoor(p.entry.door) < ENCOUNTER.minSpawnDistance) {
        p.retryT = ENCOUNTER.pendingRetry;
        continue;
      }
      const id = this.hooks.spawn(p.entry.type, p.entry.door, p.wave);
      this.ids.push({ id, wave: p.wave });
      this.spawnLog.push({ type: p.entry.type, door: p.entry.door, wave: p.wave, t: this.t });
      this.pending.splice(this.pending.indexOf(p), 1);
    }

    if (this.wave2Started && this.pending.length === 0 && this.ids.every((i) => !this.hooks.isAlive(i.id))) {
      this.state = "cleared";
    }
  }
}
