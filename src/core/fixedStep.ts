import { DT } from "../config";

/** Acumulador de tempo fixo: a simulação sempre avança em passos de 1/60 s. */
export class FixedStep {
  acc = 0;
  maxSteps = 8;
  clamp = 0.25;
  constructor(public dt = DT) {}
  /** Devolve quantos passos executar para um quadro de duração `frame`. */
  advance(frame: number): number {
    this.acc += Math.min(frame, this.clamp);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) { this.acc -= this.dt; n++; }
    if (n === this.maxSteps) this.acc = 0;
    return n;
  }
  get alpha() { return this.acc / this.dt; }
}
