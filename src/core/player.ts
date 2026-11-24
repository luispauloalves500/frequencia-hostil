import { MOVE } from "../config";
import type { V3 } from "./math";
import type { World } from "./world";

export interface MoveInput {
  fwd: number; // -1..1
  right: number; // -1..1
  jump: boolean; // borda de subida
  sprint: boolean; // segurado
  crouch: boolean; // segurado
  crouchPressed: boolean; // borda
}

export const emptyInput = (): MoveInput => ({ fwd: 0, right: 0, jump: false, sprint: false, crouch: false, crouchPressed: false });

export class PlayerBody {
  pos: V3 = { x: 0, y: 0, z: 0 }; // pés
  vel: V3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  grounded = true;
  crouching = false;
  sprinting = false;
  sliding = false;
  slideT = 0;
  slideCd = 0;
  slideDir = { x: 0, z: 0 };
  sprintSuppress = 0; // após disparar, a corrida termina até soltar/apertar de novo
  height = MOVE.standHeight;
  eye = MOVE.eyeStand;
  groundMat = "azulejo";
  stepAcc = 0;
  /** distância percorrida no último deslize (para testes) */
  lastSlideDist = 0;
  private slideStart = { x: 0, z: 0 };

  place(p: V3, yaw = 0) {
    this.pos = { ...p }; this.vel = { x: 0, y: 0, z: 0 }; this.yaw = yaw; this.pitch = 0;
    this.sliding = false; this.crouching = false; this.sprinting = false; this.slideCd = 0;
    this.height = MOVE.standHeight; this.eye = MOVE.eyeStand; this.grounded = true;
  }

  eyePos(): V3 { return { x: this.pos.x, y: this.pos.y + this.eye, z: this.pos.z }; }

  /** Cancela a corrida (disparo). A corrida só volta depois de soltar o Shift. */
  breakSprint() { this.sprinting = false; this.sprintSuppress = 1; }

  canStand(w: World): boolean {
    return !w.overlapsCylinder(this.pos.x, this.pos.z, MOVE.radius * 0.95, this.pos.y + MOVE.crouchHeight - 0.01, this.pos.y + MOVE.standHeight);
  }

  /** Retorna true quando um passo deve soar. */
  step(dt: number, inp: MoveInput, w: World): boolean {
    if (!inp.sprint) this.sprintSuppress = 0;
    this.slideCd = Math.max(0, this.slideCd - dt);

    // direção desejada no plano (diagonal normalizada)
    let ix = inp.right, iz = -inp.fwd;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // yaw 0 olha para -Z; direita = +X
    const wx = ix * c + iz * s;
    const wz = -ix * s + iz * c;
    const moving = il > 0.01;

    // corrida
    this.sprinting = inp.sprint && this.sprintSuppress === 0 && inp.fwd > 0.2 && !this.crouching && !this.sliding;

    // deslize
    if (inp.crouchPressed && this.sprinting && this.grounded && this.slideCd <= 0 && !this.sliding) {
      this.sliding = true; this.slideT = 0;
      const l = Math.hypot(wx, wz) || 1;
      this.slideDir = { x: wx / l, z: wz / l };
      this.slideStart = { x: this.pos.x, z: this.pos.z };
      this.sprinting = false;
    }

    // agachar / altura
    let wantCrouch = inp.crouch && !this.sprinting;
    if (this.sliding) wantCrouch = true;
    if (!wantCrouch && this.crouching && !this.canStand(w)) wantCrouch = true;
    this.crouching = wantCrouch;
    const targetH = this.crouching ? MOVE.crouchHeight : MOVE.standHeight;
    this.height = targetH;
    const targetEye = this.crouching ? MOVE.eyeCrouch : MOVE.eyeStand;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 14);

    // velocidade horizontal
    if (this.sliding) {
      this.slideT += dt;
      const T = MOVE.slideDuration;
      const avg = MOVE.slideDistance / T;
      // velocidade decrescente: começa em 1.33x a média e termina em 0.67x
      const k = 1.333 - 0.666 * Math.min(1, this.slideT / T);
      this.vel.x = this.slideDir.x * avg * k;
      this.vel.z = this.slideDir.z * avg * k;
      if (this.slideT >= T) {
        this.sliding = false; this.slideCd = MOVE.slideCooldown;
        this.lastSlideDist = Math.hypot(this.pos.x - this.slideStart.x, this.pos.z - this.slideStart.z);
      }
    } else {
      const speed = this.sprinting ? MOVE.sprint : this.crouching ? MOVE.crouch : MOVE.walk;
      const tx = moving ? wx * speed : 0, tz = moving ? wz * speed : 0;
      const acc = (this.grounded ? MOVE.accelGround : MOVE.accelAir) * dt;
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const dl = Math.hypot(dx, dz);
      if (dl <= acc) { this.vel.x = tx; this.vel.z = tz; }
      else { this.vel.x += (dx / dl) * acc; this.vel.z += (dz / dl) * acc; }
    }

    // pulo
    if (inp.jump && this.grounded && !this.sliding) {
      if (this.crouching && this.canStand(w)) this.crouching = false;
      this.vel.y = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);
      this.grounded = false;
    }

    // vertical
    this.vel.y -= MOVE.gravity * dt;
    const prevY = this.pos.y;
    this.pos.y += this.vel.y * dt;

    // teto
    if (this.vel.y > 0 && w.overlapsCylinder(this.pos.x, this.pos.z, MOVE.radius * 0.9, prevY + this.height, this.pos.y + this.height)) {
      this.pos.y = prevY; this.vel.y = 0;
    }

    // horizontal com colisão (degraus pequenos são ignorados como parede)
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const y0 = this.grounded ? this.pos.y + MOVE.stepHeight : Math.max(prevY, this.pos.y) + 0.02;
    const r = w.resolveCylinder(this.pos, MOVE.radius, y0, this.pos.y + this.height);
    if (r.hit) {
      // remove componente da velocidade contra a parede (desliza)
      const vn = this.vel.x * r.nx + this.vel.z * r.nz;
      if (vn < 0) { this.vel.x -= vn * r.nx; this.vel.z -= vn * r.nz; }
    }

    // piso
    const g = w.groundAt(this.pos.x, this.pos.z, MOVE.radius * 0.7, this.grounded ? this.pos.y + MOVE.stepHeight + 0.001 : Math.max(prevY, this.pos.y) + 0.03);
    if (this.vel.y <= 0 && g > -Infinity && this.pos.y <= g + (this.grounded ? MOVE.stepHeight : 0)) {
      this.pos.y = g; this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > g + 0.001) {
      this.grounded = false;
    }
    if (this.pos.y < -20) { this.pos.y = 0; }

    // passos
    if (this.grounded && !this.sliding) {
      this.stepAcc += Math.hypot(this.pos.x - ox, this.pos.z - oz);
      const stride = this.sprinting ? 2.4 : this.crouching ? 1.4 : 1.9;
      if (this.stepAcc > stride) { this.stepAcc = 0; return true; }
    }
    return false;
  }
}
