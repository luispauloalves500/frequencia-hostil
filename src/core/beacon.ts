import { BEACON } from "../config";
import type { V3 } from "./math";

export type BeaconState = "none" | "ready" | "flying" | "armed" | "emitting" | "recharging";

/** Baliza de eco: Q lança (pronta → armada), Q de novo chama (armada → emitindo → recarga). */
export class Beacon {
  state: BeaconState = "none";
  pos: V3 = { x: 0, y: 0, z: 0 };
  from: V3 = { x: 0, y: 0, z: 0 };
  timer = 0;
  pulses = 0;

  acquire() { if (this.state === "none") this.state = "ready"; }
  reset() { if (this.state !== "none") { this.state = "ready"; this.timer = 0; } }
  get owned() { return this.state !== "none"; }

  /** Q pressionado. `target` é o ponto de piso válido mirado (ou null). */
  press(from: V3, target: V3 | null): "thrown" | "invalid" | "call" | "none" {
    if (this.state === "ready") {
      if (!target) return "invalid";
      const d = Math.hypot(target.x - from.x, target.z - from.z);
      if (d > BEACON.throwRange) return "invalid";
      this.from = { ...from }; this.pos = { ...target };
      this.state = "flying"; this.timer = BEACON.flightTime;
      return "thrown";
    }
    if (this.state === "armed") {
      this.state = "emitting"; this.timer = BEACON.callDuration; this.pulses++;
      return "call";
    }
    return "none";
  }

  /** Avança o tempo e devolve a transição ocorrida, se houver. */
  update(dt: number): "landed" | "expired" | "callEnd" | "ready" | null {
    if (this.state === "none" || this.state === "ready") return null;
    this.timer -= dt;
    if (this.timer > 0) return null;
    switch (this.state) {
      case "flying": this.state = "armed"; this.timer = BEACON.armedTimeout; return "landed";
      case "armed": this.state = "ready"; this.timer = 0; return "expired";
      case "emitting": this.state = "recharging"; this.timer = BEACON.recharge; return "callEnd";
      case "recharging": this.state = "ready"; this.timer = 0; return "ready";
    }
    return null;
  }

  /** Fração de 0..1 para o anel junto à mira. */
  ringFraction(): number {
    switch (this.state) {
      case "armed": return this.timer / BEACON.armedTimeout;
      case "emitting": return this.timer / BEACON.callDuration;
      case "recharging": return 1 - this.timer / BEACON.recharge;
      default: return 1;
    }
  }

  /** Ponto escuta o chamado? (distância medida desde o emissor; oclusão é verificada fora) */
  inCallRange(p: V3): boolean {
    return this.state === "emitting" && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) <= BEACON.callRadius && Math.abs(p.y - this.pos.y) < 4;
  }
}
