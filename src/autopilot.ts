import { DT, WEAPONS, type WeaponId } from "./config";
import type { Creature } from "./core/creatures";
import { angleDiff, yawTo, type V3 } from "./core/math";
import { emptyFrame, type FrameInput, type Sim } from "./core/sim";

/**
 * Piloto automático para os testes de navegador: dirige a simulação com as mesmas
 * entradas de um jogador (mover, olhar, atirar, lançar a baliza, interagir).
 */
export class Autopilot {
  goal: V3 | null = null;
  path: V3[] | null = null;
  repath = 0;
  fight = true;
  sprint = false;
  holdFire = false;
  stuckT = 0;
  lastPos: V3 | null = null;
  strafe = 1;
  strafeT = 0;
  queue: FrameInput[] = [];
  log: string[] = [];
  aimOverride: V3 | null = null;
  ignorePassive = true;
  accuracy = 1; // 1 = mira no centro; < 1 erra de propósito
  /** arma preferida (troca pela tecla numérica, como um jogador); sem munição, troca para a que tiver */
  weapon: WeaponId | null = null;
  /** Fole: só dispara de perto (o leque abre) */
  foleRange = 7;
  constructor(public sim: Sim) {}

  moveTo(p: V3, sprint = false) { this.goal = { ...p }; this.path = null; this.repath = 0; this.sprint = sprint; }
  stop() { this.goal = null; this.path = null; }
  arrived(r = 0.8) { return !this.goal || Math.hypot(this.sim.player.pos.x - this.goal.x, this.sim.player.pos.z - this.goal.z) < r; }
  push(f: Partial<FrameInput>) { this.queue.push({ ...emptyFrame(), ...f }); }

  aimAt(p: V3) {
    const s = this.sim, e = s.player.eyePos();
    s.player.yaw = yawTo(e, p);
    s.player.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z));
  }

  aimPoint = { x: 0, y: 0, z: 0 };
  target(): Creature | null {
    const s = this.sim; const e = s.player.eyePos();
    let best: Creature | null = null; let bd = 1e9;
    for (const c of s.creatures) {
      if (!c.alive || (this.ignorePassive && c.passive) || c.state === "emerging") continue;
      const d = Math.hypot(c.pos.x - e.x, c.pos.z - e.z);
      if (d > 32) continue;
      const head = c.center(); head.y += c.height * 0.3;
      const aimPt = !s.world.blocked(e, c.center(), ["solid", "grate", "ceiling"]) ? c.center() : !s.world.blocked(e, head, ["solid", "grate", "ceiling"]) ? head : null;
      if (!aimPt) continue;
      const threat = c.type === "riscador" ? (c.state === "windup" || c.state === "leap" ? -20 : 0) : (c.state === "aim" ? -6 : 0);
      if (d + threat < bd) { bd = d + threat; best = c; this.aimPoint = aimPt; }
    }
    return best;
  }

  /** Produz a entrada do próximo passo. */
  next(): FrameInput {
    if (this.queue.length) return this.queue.shift()!;
    const s = this.sim;
    const f = emptyFrame();
    const p = s.player;
    let moveYaw: number | null = null;
    if (this.goal && !this.arrived(0.5)) {
      this.repath -= DT;
      if (!this.path || this.repath <= 0) { this.path = s.nav.path(p.pos, this.goal) ?? [this.goal]; this.repath = 0.5; }
      while (this.path.length > 1 && Math.hypot(this.path[0].x - p.pos.x, this.path[0].z - p.pos.z) < 0.45) this.path.shift();
      const wp = this.path[0] ?? this.goal;
      moveYaw = yawTo(p.pos, wp);
      // detecção de travamento
      if (this.lastPos && Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z) < 0.002) this.stuckT += DT; else this.stuckT = 0;
      this.lastPos = { ...p.pos };
      if (this.stuckT > 0.6) { f.jump = true; this.path = null; this.stuckT = 0; }
    }
    const tgt = this.fight ? this.target() : null;
    // troca de arma: preferência do roteiro ou a que ainda tem munição
    const ars = s.arsenal;
    if (ars.state !== "switching" && ars.owned.size > 1) {
      const has = (id: WeaponId) => { const a = ars.owned.get(id); return !!a && a.mag + a.reserve > 0; };
      let want: WeaponId | null = this.weapon && ars.owned.has(this.weapon) && has(this.weapon) ? this.weapon : null;
      if (!want && ars.current && !has(ars.current)) want = ([...ars.owned.keys()] as WeaponId[]).find(has) ?? null;
      if (!want && ars.current === "fole" && tgt && Math.hypot(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z) > this.foleRange + 4 && has("agulha") && !this.weapon) want = "agulha";
      if (want && want !== ars.current) f.slot = WEAPONS[want].slot;
    }
    if (tgt) {
      const aim = { ...this.aimPoint };
      if (this.accuracy < 1) { aim.x += (1 - this.accuracy) * 2; aim.y += (1 - this.accuracy) * 1.5; }
      this.aimAt(aim);
      const a = s.arsenal.ammo();
      const far = s.arsenal.current === "fole" && Math.hypot(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z) > this.foleRange;
      if (far && this.goal === null) this.moveTo(tgt.pos);
      if (a && a.mag > 0 && !far) f.fireHeld = true;
      else if (a && a.reserve > 0) f.reload = true;
      // esquiva lateral contra salto ou linha de luz
      this.strafeT -= DT;
      if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 0.9; }
      const danger = (tgt.type === "riscador" && (tgt.state === "windup" || tgt.state === "leap")) || (tgt.type === "estilhaco" && tgt.state === "aim");
      if (danger || !this.goal) f.right = this.strafe;
    } else if (this.aimOverride) {
      this.aimAt(this.aimOverride);
    } else if (moveYaw !== null) {
      p.yaw += angleDiff(p.yaw, moveYaw) * 0.25; p.pitch *= 0.8;
    }
    if (moveYaw !== null) {
      // decompõe o rumo desejado no referencial da câmera
      const d = angleDiff(p.yaw, moveYaw);
      f.fwd = Math.cos(d); f.right = (tgt && f.right ? f.right * 0.6 : 0) - Math.sin(d);
      const l = Math.hypot(f.fwd, f.right); if (l > 1) { f.fwd /= l; f.right /= l; }
      f.sprint = this.sprint && !tgt && Math.abs(d) < 0.3;
    }
    if (!tgt && s.arsenal.ammo() && s.arsenal.ammo()!.mag < 12 && s.arsenal.ammo()!.reserve > 0) f.reload = true;
    if (this.holdFire) f.fireHeld = true;
    return f;
  }
}
