import { ENCOUNTER, ESTILHACO, RISCADOR } from "../config";
import { angleDiff, distXZ, yawTo, type V3 } from "./math";
import type { NavGrid } from "./nav";
import type { World } from "./world";
import type { CreatureType } from "./waves";

export interface CreatureCtx {
  t: number;
  world: World;
  nav: NavGrid;
  playerPos: V3; // pés
  playerEye: V3;
  playerAlive: boolean;
  /** pulso ativo da baliza */
  pulse: { pos: V3; radius: number } | null;
  lastWindupStart: number;
  setLastWindup(t: number): void;
  hurtPlayer(dmg: number, from: V3, src: string): void;
  emit(ev: any): void;
  fireProjectile(from: V3, dir: V3, owner: Creature): void;
  others: Creature[];
  rand(): number;
}

export type CState =
  | "emerging" | "idle" | "patrol" | "chase" | "circle" | "windup" | "leap" | "skid"
  | "lured" | "search" | "aim" | "reposition" | "hop" | "dead";

let nextId = 1;

export class Creature {
  id: string;
  hp: number;
  maxHp: number;
  state: CState = "idle";
  stateT = 0;
  yaw = 0;
  vel: V3 = { x: 0, y: 0, z: 0 };
  path: V3[] | null = null;
  repathT = 0;
  aware = false;
  lastKnown: V3 | null = null;
  lostT = 0;
  markT = 0;
  hitFlash = 0;
  home: V3;
  patrolTarget: V3 | null = null;
  lureTarget: V3 | null = null;
  lureHoldT = 0;
  leapFrom: V3 = { x: 0, y: 0, z: 0 };
  leapTo: V3 = { x: 0, y: 0, z: 0 };
  leapHit = false;
  shots = 0;
  aimDir: V3 = { x: 0, y: 0, z: -1 };
  perches: V3[] = [];
  perchIdx = 0;
  passive = false; // só reage a som (demonstração)
  relentless = false; // arena: nunca esquece Lia, procura nova posição
  wave = 0;
  door = "";
  noPathT = 0;
  deadT = 0;
  slowT = 0;
  lungeSide = 1;
  anim = 0; // fase de animação
  heardPulse = -1;
  tag = "";

  constructor(public type: CreatureType, public pos: V3, opts: Partial<Creature> = {}) {
    this.id = `${type}-${nextId++}`;
    this.maxHp = this.hp = type === "riscador" ? RISCADOR.hp : ESTILHACO.hp;
    this.home = { ...pos };
    Object.assign(this, opts);
  }

  get alive() { return this.state !== "dead"; }
  get radius() { return this.type === "riscador" ? RISCADOR.radius : ESTILHACO.radius; }
  get height() { return this.type === "riscador" ? RISCADOR.height : ESTILHACO.height; }
  get speed() { return this.type === "riscador" ? RISCADOR.speed : ESTILHACO.speed; }
  /** Centro aproximado do corpo (alvo para mira) */
  center(): V3 { return { x: this.pos.x, y: this.pos.y + this.height * 0.55, z: this.pos.z }; }
  /** Ataque já anunciado não é interrompido pela baliza. */
  get committed() { return this.state === "windup" || this.state === "leap" || (this.state === "aim" && this.stateT > 0); }

  set(s: CState) { this.state = s; this.stateT = 0; }

  damage(n: number, ctx: CreatureCtx, from?: V3) {
    if (!this.alive) return;
    this.hp -= n; this.hitFlash = 0.12;
    if (from && !this.aware) { this.aware = true; this.lastKnown = { ...ctx.playerPos }; if (this.state === "idle" || this.state === "patrol") this.set("chase"); }
    if (this.hp <= 0) { this.hp = 0; this.set("dead"); this.deadT = 0; ctx.emit({ type: "kill", id: this.id, ctype: this.type, pos: this.center() }); }
  }

  canSee(ctx: CreatureCtx, range: number): boolean {
    if (!ctx.playerAlive) return false;
    const eye = { x: this.pos.x, y: this.pos.y + this.height * 0.8, z: this.pos.z };
    if (distXZ(eye, ctx.playerPos) > range) return false;
    return !ctx.world.blocked(eye, ctx.playerEye, ["solid", "ceiling"]);
  }

  hearsPulse(ctx: CreatureCtx): boolean {
    if (!ctx.pulse) return false;
    const p = ctx.pulse.pos;
    if (Math.hypot(this.pos.x - p.x, this.pos.z - p.z) > ctx.pulse.radius) return false;
    // paredes sólidas bloqueiam o pulso; grades e água rasa deixam passar
    const a = { x: this.pos.x, y: this.pos.y + 0.6, z: this.pos.z };
    const b = { x: p.x, y: p.y + 0.4, z: p.z };
    return !ctx.world.blocked(a, b, ["solid", "ceiling"]);
  }

  /** Último ponto alcançável junto ao emissor, distribuindo destinos entre criaturas. */
  findLurePoint(ctx: CreatureCtx, emitter: V3): V3 | null {
    const nav = ctx.nav; nav.ensure();
    const s = nav.nearest(this.pos, 2);
    if (s < 0) return null;
    const claimed = ctx.others.filter((o) => o !== this && o.alive && o.lureTarget).map((o) => o.lureTarget!);
    const seen = new Set<number>([s]);
    const q = [s];
    let best = s, bestScore = Infinity;
    const maxCells = 2500;
    while (q.length && seen.size < maxCells) {
      const k = q.shift()!;
      const c = nav.center(k);
      const d = Math.hypot(c.x - emitter.x, c.z - emitter.z) + Math.abs(c.y - emitter.y) * 0.5;
      let pen = 0;
      for (const cl of claimed) { const dd = Math.hypot(cl.x - c.x, cl.z - c.z); if (dd < 1.3) pen += (1.3 - dd) * 3; }
      const score = Math.max(d, 1.1) + pen;
      if (score < bestScore) { bestScore = score; best = k; }
      const i = k % nav.w, j = Math.floor(k / nav.w);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nav.w || nj >= nav.h) continue;
        const n = nj * nav.w + ni;
        if (seen.has(n) || !nav.walkable(n) || Math.abs(nav.height[n] - nav.height[k]) > 0.5) continue;
        seen.add(n); q.push(n);
      }
    }
    return nav.center(best);
  }

  private moveAlong(ctx: CreatureCtx, target: V3, dt: number, speedMul = 1): boolean {
    this.repathT -= dt;
    if (!this.path || this.repathT <= 0) {
      this.path = ctx.nav.path(this.pos, target);
      this.repathT = 0.35 + ctx.rand() * 0.2;
      if (!this.path) { this.noPathT += 0.35; return false; }
      this.noPathT = 0;
    }
    if (!this.path.length) return true;
    const wp = this.path[0];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) { this.path.shift(); return this.path.length === 0; }
    const sp = this.speed * speedMul * (this.slowT > 0 ? 0.5 : 1);
    const step = Math.min(d, sp * dt);
    let nx = this.pos.x + (dx / d) * step, nz = this.pos.z + (dz / d) * step;
    // separação
    for (const o of ctx.others) {
      if (o === this || !o.alive) continue;
      const ox = nx - o.pos.x, oz = nz - o.pos.z;
      const od = Math.hypot(ox, oz), min = this.radius + o.radius;
      if (od > 0.001 && od < min && Math.abs(o.pos.y - this.pos.y) < 1.5) { nx += (ox / od) * (min - od) * 0.5; nz += (oz / od) * (min - od) * 0.5; }
    }
    const p = { x: nx, y: this.pos.y, z: nz };
    ctx.world.resolveCylinder(p, this.radius * 0.8, this.pos.y + 0.5, this.pos.y + this.height);
    const fh = ctx.nav.floorAt(p.x, p.z);
    if (!Number.isNaN(fh) && Math.abs(fh - this.pos.y) < 0.8) { this.pos.x = p.x; this.pos.z = p.z; this.pos.y += (fh - this.pos.y) * Math.min(1, dt * 14); }
    else { this.pos.x = p.x; this.pos.z = p.z; }
    const ty = Math.atan2(-(dx), -(dz));
    this.yaw += angleDiff(this.yaw, ty) * Math.min(1, dt * 10);
    this.anim += step * 3;
    return false;
  }

  private faceTo(p: V3, dt: number, rate = 8) { this.yaw += angleDiff(this.yaw, yawTo(this.pos, p)) * Math.min(1, dt * rate); }

  update(dt: number, ctx: CreatureCtx) {
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.markT = Math.max(0, this.markT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    if (this.state === "dead") { this.deadT += dt; return; }
    if (this.state === "emerging") { if (this.stateT > 0.8) { this.aware = true; this.lastKnown = { ...ctx.playerPos }; this.set(this.type === "estilhaco" ? "reposition" : "chase"); } return; }

    // distração: espécies sensíveis atendem ao pulso se não houver ataque anunciado
    if (ctx.pulse && !this.committed && this.state !== "hop" && this.hearsPulse(ctx)) {
      if (this.state !== "lured") {
        this.lureTarget = this.findLurePoint(ctx, ctx.pulse.pos);
        this.path = null;
        this.set("lured");
        ctx.emit({ type: "lured", id: this.id, pos: { ...this.pos } });
      }
      this.lureHoldT = 1.6;
    }

    if (this.type === "riscador") this.updateRiscador(dt, ctx);
    else this.updateEstilhaco(dt, ctx);
  }

  private perceive(ctx: CreatureCtx, range: number): boolean {
    if (this.passive) return false;
    const sees = this.canSee(ctx, range);
    if (sees) { this.aware = true; this.lastKnown = { ...ctx.playerPos }; this.lostT = 0; }
    return sees;
  }

  private updateLured(dt: number, ctx: CreatureCtx): boolean {
    if (this.state !== "lured") return false;
    if (this.lureTarget) {
      const arrived = distXZ(this.pos, this.lureTarget) < 0.3 || this.moveAlong(ctx, this.lureTarget, dt, 1.15);
      if (arrived) {
        this.anim += dt * 6;
        if (ctx.pulse) this.faceTo(ctx.pulse.pos, dt);
        if (!this.leapHit) { this.leapHit = true; ctx.emit({ type: "lureArrive", id: this.id, pos: { ...this.pos } }); }
      }
    }
    if (!ctx.pulse) {
      this.lureHoldT -= dt;
      if (this.lureHoldT <= 0) {
        this.lureTarget = null; this.leapHit = false;
        if (this.passive) { this.set("idle"); return true; }
        this.set(this.aware ? "search" : "patrol");
      }
    }
    return true;
  }

  private updateRiscador(dt: number, ctx: CreatureCtx) {
    if (this.updateLured(dt, ctx)) return;
    const sees = this.perceive(ctx, 22);
    const d = distXZ(this.pos, ctx.playerPos);
    const dy = Math.abs(ctx.playerPos.y - this.pos.y);
    switch (this.state) {
      case "idle":
      case "patrol": {
        if (sees || this.aware) { this.set("chase"); break; }
        if (!this.patrolTarget || distXZ(this.pos, this.patrolTarget) < 0.5 || this.stateT > 6) {
          const a = ctx.rand() * Math.PI * 2, r = this.passive ? 0.4 + ctx.rand() * 0.8 : 1 + ctx.rand() * 2;
          this.patrolTarget = { x: this.home.x + Math.cos(a) * r, y: this.home.y, z: this.home.z + Math.sin(a) * r };
          this.path = null; this.stateT = 0;
        }
        this.moveAlong(ctx, this.patrolTarget, dt, 0.35);
        break;
      }
      case "search": {
        if (sees) { this.set("chase"); break; }
        if (this.relentless && ctx.playerAlive) this.lastKnown = { ...ctx.playerPos };
        const tgt = this.lastKnown ?? this.home;
        if (distXZ(this.pos, tgt) < 0.8 || this.moveAlong(ctx, tgt, dt, 0.8)) {
          this.lostT += dt;
          if (this.lostT > ENCOUNTER.forgetTime) { this.aware = false; this.lastKnown = null; this.home = { ...this.pos }; this.set("patrol"); }
        }
        break;
      }
      case "chase": {
        if (!ctx.playerAlive) { this.set("patrol"); break; }
        if (!sees) {
          this.lostT += dt;
          if (this.lostT > 0.5) { this.set("search"); break; }
        }
        const free = sees && dy < 1.3 && !ctx.world.blocked(
          { x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z },
          { x: ctx.playerPos.x, y: ctx.playerPos.y + 0.5, z: ctx.playerPos.z }, ["solid", "grate", "ceiling"]);
        if (free && d < RISCADOR.leapRange + 0.6) {
          if (ctx.t - ctx.lastWindupStart >= RISCADOR.secondLeapDelay) {
            ctx.setLastWindup(ctx.t);
            this.set("windup");
            ctx.emit({ type: "scratch", id: this.id, pos: { ...this.pos } });
            break;
          }
          this.set("circle"); this.lungeSide = ctx.rand() < 0.5 ? -1 : 1;
          break;
        }
        this.moveAlong(ctx, this.lastKnown ?? ctx.playerPos, dt);
        if (this.noPathT > 2 && sees) this.set("circle");
        break;
      }
      case "circle": {
        // circula até um ponto lateral e pode preparar o salto 0,45 s depois do primeiro
        const px = ctx.playerPos.x - this.pos.x, pz = ctx.playerPos.z - this.pos.z;
        const pl = Math.hypot(px, pz) || 1;
        const side = { x: ctx.playerPos.x + (-pz / pl) * 3 * this.lungeSide - (px / pl) * 1.5, y: ctx.playerPos.y, z: ctx.playerPos.z + (px / pl) * 3 * this.lungeSide - (pz / pl) * 1.5 };
        this.moveAlong(ctx, side, dt, 0.9);
        this.faceTo(ctx.playerPos, dt);
        if (this.stateT > 0.35) this.set("chase");
        break;
      }
      case "windup": {
        this.faceTo(ctx.playerPos, dt, 12);
        const T = RISCADOR.scratchTime + RISCADOR.compressTime;
        if (this.stateT >= RISCADOR.scratchTime && this.stateT - dt < RISCADOR.scratchTime) ctx.emit({ type: "scratch2", id: this.id, pos: { ...this.pos } });
        if (this.stateT >= T) {
          // trava destino no fim da compressão
          const dx = ctx.playerPos.x - this.pos.x, dz = ctx.playerPos.z - this.pos.z;
          const dl = Math.hypot(dx, dz) || 1;
          const reach = Math.min(RISCADOR.leapRange, dl + 0.4);
          const to = { x: this.pos.x + (dx / dl) * reach, y: this.pos.y, z: this.pos.z + (dz / dl) * reach };
          const p = { ...to };
          ctx.world.resolveCylinder(p, this.radius, this.pos.y + 0.4, this.pos.y + 1.2);
          this.leapFrom = { ...this.pos }; this.leapTo = p; this.leapHit = false;
          this.set("leap");
          ctx.emit({ type: "leap", id: this.id, pos: { ...this.pos } });
        }
        break;
      }
      case "leap": {
        const t = Math.min(1, this.stateT / RISCADOR.leapTime);
        this.pos.x = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * t;
        this.pos.z = this.leapFrom.z + (this.leapTo.z - this.leapFrom.z) * t;
        const fh = ctx.nav.floorAt(this.pos.x, this.pos.z);
        const base = Number.isNaN(fh) ? this.leapFrom.y : fh;
        this.pos.y = base + Math.sin(t * Math.PI) * 0.9;
        if (!this.leapHit && ctx.playerAlive) {
          const pd = distXZ(this.pos, ctx.playerPos);
          if (pd < this.radius + 0.45 && Math.abs(ctx.playerPos.y - this.pos.y) < 1.4) {
            this.leapHit = true;
            ctx.hurtPlayer(RISCADOR.damage, this.pos, "riscador");
          }
        }
        if (t >= 1) { this.pos.y = base; this.set("skid"); ctx.emit({ type: "land", id: this.id, pos: { ...this.pos } }); }
        break;
      }
      case "skid": {
        // derrapa por 1 s ao pousar: janela de resposta
        const k = Math.max(0, 1 - this.stateT / RISCADOR.skidTime);
        const dx = this.leapTo.x - this.leapFrom.x, dz = this.leapTo.z - this.leapFrom.z;
        const dl = Math.hypot(dx, dz) || 1;
        const p = { x: this.pos.x + (dx / dl) * k * 2.2 * dt, y: this.pos.y, z: this.pos.z + (dz / dl) * k * 2.2 * dt };
        ctx.world.resolveCylinder(p, this.radius * 0.8, this.pos.y + 0.4, this.pos.y + 1);
        if (!Number.isNaN(ctx.nav.floorAt(p.x, p.z))) { this.pos.x = p.x; this.pos.z = p.z; }
        if (this.stateT >= RISCADOR.skidTime) { this.set("chase"); this.path = null; }
        break;
      }
    }
  }

  private updateEstilhaco(dt: number, ctx: CreatureCtx) {
    if (this.updateLured(dt, ctx)) return;
    const sees = this.perceive(ctx, ESTILHACO.sightRange);
    switch (this.state) {
      case "idle":
      case "patrol":
        if (sees || this.aware) this.set("aim");
        break;
      case "search": {
        if (this.stateT < 0) { this.faceTo(ctx.playerPos, dt, 6); break; }
        if (sees) { this.set("aim"); break; }
        const tgt = this.perches.length ? this.perches[this.perchIdx % this.perches.length] : this.home;
        if (distXZ(this.pos, tgt) > 0.6) this.moveAlong(ctx, tgt, dt);
        if (this.relentless && this.stateT > 2.5 && this.perches.length > 1) {
          this.perchIdx = (this.perchIdx + 1) % this.perches.length; this.path = null; this.set("reposition"); break;
        }
        if (!this.relentless && this.stateT > ENCOUNTER.forgetTime + 2) { this.aware = false; this.set("idle"); }
        break;
      }
      case "chase":
      case "reposition": {
        const target = this.perches.length ? this.perches[this.perchIdx % this.perches.length] : this.home;
        const arrived = distXZ(this.pos, target) < 0.6 || this.moveAlong(ctx, target, dt);
        if (this.state === "reposition" && !arrived && this.noPathT > 0.6 && distXZ(this.pos, target) < 30) {
          // sem caminho até o próximo poleiro: salta
          this.leapFrom = { ...this.pos }; this.leapTo = { ...target }; this.set("hop"); break;
        }
        if (arrived) this.set(sees ? "aim" : "search");
        else if (sees && this.stateT > 2.5) this.set("aim");
        break;
      }
      case "hop": {
        const t = Math.min(1, this.stateT / 0.9);
        this.pos.x = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * t;
        this.pos.z = this.leapFrom.z + (this.leapTo.z - this.leapFrom.z) * t;
        this.pos.y = this.leapFrom.y + (this.leapTo.y - this.leapFrom.y) * t + Math.sin(t * Math.PI) * 2.2;
        if (t >= 1) { this.path = null; this.noPathT = 0; this.set(sees ? "aim" : "search"); }
        break;
      }
      case "aim": {
        // abre a coroa e mostra a linha de luz por 0,9 s; trava a direção ao soltar
        const muzzle = { x: this.pos.x, y: this.pos.y + this.height * 0.85, z: this.pos.z };
        if (this.stateT < ESTILHACO.aimTime) {
          if (this.stateT === dt || this.stateT <= dt + 1e-6) ctx.emit({ type: "estAim", id: this.id, pos: muzzle });
          const tgt = { x: ctx.playerEye.x, y: ctx.playerEye.y - 0.35, z: ctx.playerEye.z };
          const dx = tgt.x - muzzle.x, dy = tgt.y - muzzle.y, dz = tgt.z - muzzle.z;
          const l = Math.hypot(dx, dy, dz) || 1;
          this.aimDir = { x: dx / l, y: dy / l, z: dz / l };
          this.faceTo(ctx.playerPos, dt, 10);
          if (!sees && this.stateT > 0.25) { this.set("search"); this.lastKnown = { ...ctx.playerPos }; }
          break;
        }
        ctx.fireProjectile(muzzle, this.aimDir, this);
        this.shots++;
        if (this.shots % ESTILHACO.shotsBeforeMove === 0 && this.perches.length > 1) {
          this.perchIdx = (this.perchIdx + 1 + Math.floor(ctx.rand() * (this.perches.length - 1))) % this.perches.length;
          this.path = null;
          this.set("reposition");
        } else {
          this.set("search");
          this.stateT = -ESTILHACO.cooldown; // pausa antes de mirar de novo
        }
        break;
      }
    }
  }
}
