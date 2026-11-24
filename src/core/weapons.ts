import { SWITCH_BUFFER, SWITCH_TIME, WEAPONS, type WeaponId } from "../config";

export interface AmmoState { mag: number; reserve: number }
export type FireResult = "shot" | "alt" | "dry" | "none";

/** Inventário e regras de disparo. Munição só é transferida ao concluir a recarga. */
export class Arsenal {
  owned = new Map<WeaponId, AmmoState>();
  current: WeaponId | null = null;
  state: "ready" | "reloading" | "switching" = "ready";
  timer = 0;
  cooldown = 0;
  bufferedFire: "primary" | "alt" | null = null;
  shotsFired = 0; // contadores para testes/diagnóstico
  ammoSpent = 0;
  dryClicks = 0;

  give(id: WeaponId, mag?: number, reserve?: number) {
    const d = WEAPONS[id];
    const had = this.owned.get(id);
    if (had) { had.reserve = Math.min(d.reserveMax, had.reserve + d.mag); return; }
    this.owned.set(id, { mag: mag ?? d.mag, reserve: Math.min(d.reserveMax, reserve ?? d.mag) });
    if (!this.current) { this.current = id; this.state = "ready"; }
  }

  ammo(id = this.current): AmmoState | undefined { return id ? this.owned.get(id) : undefined; }

  /** Adiciona à reserva, respeitando o máximo. Retorna quanto entrou. */
  addReserve(id: WeaponId, n: number): number {
    const a = this.owned.get(id); if (!a) return 0;
    const before = a.reserve;
    a.reserve = Math.min(WEAPONS[id].reserveMax, a.reserve + n);
    return a.reserve - before;
  }

  canReload(): boolean {
    const a = this.ammo(); if (!a || !this.current) return false;
    return this.state === "ready" && a.mag < WEAPONS[this.current].mag && a.reserve > 0;
  }

  reload(): boolean {
    if (!this.canReload()) return false;
    this.state = "reloading"; this.timer = WEAPONS[this.current!].reload;
    return true;
  }

  switchTo(id: WeaponId): boolean {
    if (!this.owned.has(id) || id === this.current) return false;
    // troca cancela a recarga sem transferir munição
    this.current = id; this.state = "switching"; this.timer = SWITCH_TIME; this.bufferedFire = null;
    return true;
  }

  clearIntent() { this.bufferedFire = null; }

  /** Tenta disparar. `held` indica gatilho segurado (cadência contínua). */
  fire(mode: "primary" | "alt"): FireResult {
    if (!this.current) return "none";
    if (this.state === "switching") {
      if (this.timer <= SWITCH_BUFFER) this.bufferedFire = mode;
      return "none";
    }
    if (this.state === "reloading") return "none";
    if (this.cooldown > 0) return "none";
    const d = WEAPONS[this.current];
    const a = this.owned.get(this.current)!;
    const cost = mode === "primary" ? 1 : d.altCost;
    if (a.mag < cost) {
      this.dryClicks++;
      this.cooldown = 0.25;
      if (mode === "primary" && a.reserve > 0) this.reload();
      return "dry";
    }
    a.mag -= cost;
    this.ammoSpent += cost;
    this.shotsFired++;
    this.cooldown = mode === "primary" ? 1 / d.rate : 0.35;
    return mode === "primary" ? "shot" : "alt";
  }

  /** Avança o tempo. Retorna eventos ocorridos. */
  update(dt: number): { reloaded?: boolean; ready?: boolean; buffered?: "primary" | "alt" } {
    const out: { reloaded?: boolean; ready?: boolean; buffered?: "primary" | "alt" } = {};
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.state === "reloading") {
      this.timer -= dt;
      if (this.timer <= 0) {
        const d = WEAPONS[this.current!];
        const a = this.owned.get(this.current!)!;
        const n = Math.min(d.mag - a.mag, a.reserve);
        a.mag += n; a.reserve -= n;
        this.state = "ready"; out.reloaded = true;
      }
    } else if (this.state === "switching") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "ready"; out.ready = true;
        if (this.bufferedFire) { out.buffered = this.bufferedFire; this.bufferedFire = null; }
      }
    }
    return out;
  }

  snapshot(): Record<string, AmmoState> {
    const o: Record<string, AmmoState> = {};
    for (const [k, v] of this.owned) o[k] = { ...v };
    return o;
  }
  restore(s: Record<string, AmmoState>, current?: WeaponId | null) {
    this.owned.clear();
    for (const k of Object.keys(s) as WeaponId[]) this.owned.set(k, { ...s[k] });
    this.current = current && this.owned.has(current) ? current : ((this.owned.keys().next().value as WeaponId) ?? null);
    this.state = "ready"; this.timer = 0; this.cooldown = 0; this.bufferedFire = null;
  }
}
