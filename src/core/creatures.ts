import { BADALO, CARAPACA, ENCOUNTER, ESTILHACO, FOLE, RISCADOR, VEU } from "../config";
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
  /** Véu: solta a nuvem e a desfaz ao cair */
  spawnCloud(owner: Creature, pos: V3): void;
  dissipate(owner: Creature): void;
  hasCloud(owner: Creature): boolean;
  others: Creature[];
  rand(): number;
}

export type CState =
  | "emerging" | "idle" | "patrol" | "chase" | "circle" | "windup" | "leap" | "skid"
  | "lured" | "search" | "aim" | "reposition" | "hop" | "dead"
  | "swell" | "recover" | "drift" | "pushed"
  // Carapaça
  | "stomp" | "charge" | "open" | "stun"
  // Badalo
  | "hang" | "intro" | "tilt" | "drop" | "stuck" | "rise" | "waveWarn" | "wave";

const STATS: Record<CreatureType, { hp: number; radius: number; height: number; speed: number }> = {
  riscador: RISCADOR, estilhaco: ESTILHACO, veu: VEU, carapaca: CARAPACA,
  badalo: { hp: BADALO.hp, radius: BADALO.radius, height: BADALO.height, speed: BADALO.moveSpeed },
};

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
  /** Véu: raio de coleira em torno de `home` */
  leash = 6;
  /** Véu: altura do centro do corpo acima do piso */
  hover = VEU.hover;
  /** reação ao último impacto (só visual): altura relativa 0..1, lado −1..1 */
  flinch = { h: 0.5, side: 0, t: 0, n: 0 };
  pushFrom: V3 = { x: 0, y: 0, z: 0 };
  pushDir: V3 = { x: 0, y: 0, z: 0 };
  /** Carapaça: direção travada da investida e distância percorrida */
  chargeDir: V3 = { x: 0, y: 0, z: -1 };
  chargeDist = 0;
  /** último multiplicador de dano aplicado (placa fechada, carcaça) — para a resposta visual */
  lastMul = 1;
  /** Badalo: placas ressonantes, ponto travado e controle de ciclo */
  plates: V3[] = [];
  lockPos: V3 | null = null;
  lockSrc: "lia" | "baliza" | "demo" = "lia";
  locked = false;
  altWave = false;
  halfDone = false;
  waveR = 0;
  waveHit = false;
  stuckOn = -1;
  cycles = 0;
  private resume: CState = "chase";

  constructor(public type: CreatureType, public pos: V3, opts: Partial<Creature> = {}) {
    this.id = `${type}-${nextId++}`;
    this.maxHp = this.hp = STATS[type].hp;
    this.home = { ...pos };
    Object.assign(this, opts);
    if (type === "veu") { this.state = "drift"; }
    if (type === "badalo") { this.state = "hang"; this.pos.y = this.home.y + BADALO.hangY; }
  }

  get alive() { return this.state !== "dead"; }
  get radius() { return STATS[this.type].radius; }
  get height() { return STATS[this.type].height; }
  get speed() { return STATS[this.type].speed; }
  /** chefe: não conta no teto de comuns */
  get boss() { return this.type === "badalo"; }
  /** comuns leves: o sopro do Fole os empurra */
  get light() { return this.type === "riscador" || this.type === "veu"; }
  /** Centro aproximado do corpo (alvo para mira) */
  center(): V3 { return { x: this.pos.x, y: this.pos.y + this.height * 0.55, z: this.pos.z }; }
  /** Ataque já anunciado não é interrompido pela baliza. */
  get committed() { return this.state === "windup" || this.state === "leap" || (this.state === "aim" && this.stateT > 0) || this.state === "pushed" || this.state === "stomp" || this.state === "charge"; }

  /** Sopro do Fole: desloca até `dist` metros na direção dada, conservando a colisão. */
  push(dir: V3, ctx: CreatureCtx) {
    if (!this.alive || !this.light) return false;
    this.resume = this.type === "veu" ? "recover" : "chase";
    if (this.type === "riscador" && (this.state === "leap")) return false;
    this.pushFrom = { ...this.pos }; this.pushDir = { ...dir };
    this.path = null; this.lureTarget = null;
    this.set("pushed");
    this.aware = true; this.lastKnown = { ...ctx.playerPos };
    return true;
  }

  set(s: CState) { this.state = s; this.stateT = 0; }

  /** Multiplicador de dano: placa fechada da Carapaça (de frente) e carcaça do Badalo. */
  damageMul(from?: V3): number {
    if (this.type === "badalo") return this.state === "stuck" ? 1 : BADALO.shellMul;
    if (this.type === "carapaca" && from && this.state !== "open") {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dx = from.x - this.pos.x, dz = from.z - this.pos.z, l = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / l > 0.1) return CARAPACA.frontMul; // de frente, placa fechada
    }
    return 1;
  }

  damage(n: number, ctx: CreatureCtx, from?: V3, at?: V3) {
    if (!this.alive) return;
    this.lastMul = this.damageMul(from);
    n *= this.lastMul;
    this.hp -= n; this.hitFlash = 0.12;
    if (at) {
      // local do impacto para a reação visual (cabeça, corpo, pernas; lado)
      const h = Math.max(0, Math.min(1, (at.y - this.pos.y) / this.height));
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const side = Math.max(-1, Math.min(1, ((at.x - this.pos.x) * c - (at.z - this.pos.z) * s) / Math.max(0.2, this.radius)));
      this.flinch = { h, side, t: 0.32, n: this.flinch.n + 1 };
    }
    if (from && !this.aware && !this.boss) { this.aware = true; this.lastKnown = { ...ctx.playerPos }; if (this.state === "idle" || this.state === "patrol") this.set("chase"); }
    if (this.hp <= 0) {
      this.hp = 0; this.set("dead"); this.deadT = 0;
      if (this.type === "veu") ctx.dissipate(this); // ao cair, o Véu desfaz a nuvem na hora
      ctx.emit({ type: "kill", id: this.id, ctype: this.type, pos: this.center() });
    }
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
    this.flinch.t = Math.max(0, this.flinch.t - dt);
    if (this.state === "dead") { this.deadT += dt; return; }
    if (this.state === "pushed") { this.updatePushed(dt, ctx); return; }
    if (this.type === "veu") { this.updateVeu(dt, ctx); return; }
    if (this.type === "badalo") { this.updateBadalo(dt, ctx); return; }
    if (this.state === "emerging") { if (this.stateT > 0.8) { this.aware = true; this.lastKnown = { ...ctx.playerPos }; this.set(this.type === "estilhaco" ? "reposition" : "chase"); } return; }
    if (this.type === "carapaca") { this.updateCarapaca(dt, ctx); return; }

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

  private updatePushed(dt: number, ctx: CreatureCtx) {
    // desaceleração: percorre FOLE.pushDist em FOLE.pushTime
    const T = FOLE.pushTime;
    const k0 = Math.min(1, (this.stateT - dt) / T), k1 = Math.min(1, this.stateT / T);
    const f = (k: number) => 1 - (1 - k) * (1 - k);
    const step = (f(k1) - f(k0)) * FOLE.pushDist;
    const p = { x: this.pos.x + this.pushDir.x * step, y: this.pos.y, z: this.pos.z + this.pushDir.z * step };
    ctx.world.resolveCylinder(p, this.radius * 0.8, this.pos.y + 0.3, this.pos.y + this.height);
    if (this.type === "veu") { this.pos.x = p.x; this.pos.z = p.z; }
    else {
      const fh = ctx.nav.floorAt(p.x, p.z);
      if (!Number.isNaN(fh) && Math.abs(fh - this.pos.y) < 0.8) { this.pos.x = p.x; this.pos.z = p.z; this.pos.y = fh; }
      else if (Number.isNaN(fh)) { /* borda: para */ } else { this.pos.x = p.x; this.pos.z = p.z; }
    }
    this.anim += step * 2;
    if (this.stateT >= T + 0.25) { this.path = null; this.set(this.resume); }
  }

  /** Véu: patrulha flutuando, incha (1,2 s), solta a nuvem e recupera (2 s). Ignora a baliza. */
  private updateVeu(dt: number, ctx: CreatureCtx) {
    const sees = this.perceive(ctx, 18);
    const floorAt = (x: number, z: number) => { const f = ctx.nav.floorAt(x, z); return Number.isNaN(f) ? this.home.y : f; };
    const want = floorAt(this.home.x, this.home.z) + this.hover - VEU.height / 2;
    this.pos.y += (want - this.pos.y) * Math.min(1, dt * 2);
    this.anim += dt;
    const d = distXZ(this.pos, ctx.playerPos);
    const fly = (tx: number, tz: number, sp: number) => {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, l = Math.hypot(dx, dz);
      if (l < 0.05) return;
      const st = Math.min(l, sp * dt);
      const p = { x: this.pos.x + (dx / l) * st, y: this.pos.y, z: this.pos.z + (dz / l) * st };
      ctx.world.resolveCylinder(p, this.radius, this.pos.y, this.pos.y + this.height);
      this.pos.x = p.x; this.pos.z = p.z;
      this.yaw += angleDiff(this.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 3);
    };
    switch (this.state) {
      case "swell":
        this.faceTo(ctx.playerPos, dt, 3);
        if (this.stateT >= VEU.swellTime) {
          ctx.spawnCloud(this, { x: this.pos.x, y: floorAt(this.pos.x, this.pos.z), z: this.pos.z });
          this.set("recover");
        }
        break;
      case "recover":
        if (this.stateT >= VEU.recoverTime) this.set("drift");
        break;
      default: {
        // deriva junto à coleira; com Lia por perto, se aproxima até a borda da coleira
        let tx = this.home.x + Math.cos(this.anim * 0.4) * Math.min(1.2, this.leash), tz = this.home.z + Math.sin(this.anim * 0.5) * Math.min(1.2, this.leash);
        if (this.aware && ctx.playerAlive) {
          const hx = ctx.playerPos.x - this.home.x, hz = ctx.playerPos.z - this.home.z, hl = Math.hypot(hx, hz) || 1;
          const r = Math.min(this.leash, Math.max(0, hl - 3));
          tx = this.home.x + (hx / hl) * r; tz = this.home.z + (hz / hl) * r;
        }
        fly(tx, tz, this.aware ? VEU.speed : VEU.speed * 0.4);
        if (this.aware && !ctx.hasCloud(this) && d < VEU.triggerRange && this.stateT > 0.6) {
          this.set("swell");
          ctx.emit({ type: "veuSwell", id: this.id, pos: this.center() });
        }
        if (!sees && this.aware) { this.lostT += dt; if (this.lostT > ENCOUNTER.forgetTime * 2 && !this.relentless) this.aware = false; }
      }
    }
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

  /** Carapaça: anda até ter linha, bate as patas 1 s, investe em linha reta. Batente abre as placas 2,5 s. */
  private updateCarapaca(dt: number, ctx: CreatureCtx) {
    const C = CARAPACA;
    const sees = this.perceive(ctx, C.sightRange);
    const d = distXZ(this.pos, ctx.playerPos);
    const dy = Math.abs(ctx.playerPos.y - this.pos.y);
    switch (this.state) {
      case "idle": case "patrol": case "search": case "chase": case "lured": {
        if (!this.aware) {
          if (!this.patrolTarget || distXZ(this.pos, this.patrolTarget) < 0.6 || this.stateT > 7) {
            const a = ctx.rand() * Math.PI * 2, r = 1 + ctx.rand() * 2;
            this.patrolTarget = { x: this.home.x + Math.cos(a) * r, y: this.home.y, z: this.home.z + Math.sin(a) * r };
            this.path = null; this.stateT = 0;
          }
          this.moveAlong(ctx, this.patrolTarget, dt, 0.5);
          break;
        }
        if (sees && d < C.triggerRange && d > 2.2 && dy < 1 && this.stateT > 0.6) {
          this.set("stomp"); ctx.emit({ type: "carStomp", id: this.id, pos: { ...this.pos } });
          break;
        }
        const tgt = sees ? ctx.playerPos : this.lastKnown ?? ctx.playerPos;
        if (d > 1.6) this.moveAlong(ctx, tgt, dt, 1); else this.faceTo(ctx.playerPos, dt, 4);
        if (!sees) { this.lostT += dt; if (this.lostT > ENCOUNTER.forgetTime && !this.relentless) { this.aware = false; this.set("patrol"); } }
        break;
      }
      case "stomp": {
        if (this.stateT < C.stompTime * 0.75) this.faceTo(ctx.playerPos, dt, 5);
        this.anim += dt * 9;
        if (this.stateT >= C.stompTime) {
          const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
          this.chargeDir = { x: fx, y: 0, z: fz }; this.chargeDist = 0; this.leapHit = false;
          this.set("charge"); ctx.emit({ type: "carCharge", id: this.id, pos: { ...this.pos }, dir: { ...this.chargeDir } });
        }
        break;
      }
      case "charge": {
        const step = C.chargeSpeed * (this.slowT > 0 ? 0.5 : 1) * dt;
        const o = { x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z };
        const h = ctx.world.raycast(o, this.chargeDir, step + this.radius, ["solid", "grate"]);
        // tromba em Lia no caminho
        if (!this.leapHit && ctx.playerAlive && d < this.radius + 0.5 && dy < 1.2) { this.leapHit = true; ctx.hurtPlayer(C.damage, this.pos, "carapaca"); }
        if (h) {
          const adv = Math.max(0, h.t - this.radius);
          this.pos.x += this.chargeDir.x * adv; this.pos.z += this.chargeDir.z * adv;
          const batente = h.box.id.startsWith("batente");
          ctx.emit({ type: "carSlam", id: this.id, pos: { ...this.pos }, batente });
          if (batente) { this.set("open"); ctx.emit({ type: "carOpen", id: this.id, pos: this.center() }); }
          else this.set("stun");
          break;
        }
        const nx = this.pos.x + this.chargeDir.x * step, nz = this.pos.z + this.chargeDir.z * step;
        const fh = ctx.nav.floorAt(nx, nz);
        if (Number.isNaN(fh) || Math.abs(fh - this.pos.y) > 0.6) { this.set("stun"); ctx.emit({ type: "carSlam", id: this.id, pos: { ...this.pos }, batente: false }); break; }
        this.pos.x = nx; this.pos.z = nz; this.pos.y = fh;
        this.chargeDist += step; this.anim += step * 2.5;
        if (this.chargeDist >= C.chargeMax) this.set("recover");
        break;
      }
      case "open": if (this.stateT >= C.openTime) { this.set("recover"); ctx.emit({ type: "carClose", id: this.id }); } break;
      case "stun": if (this.stateT >= C.stunTime) this.set("recover"); break;
      case "recover": this.faceTo(ctx.playerPos, dt, 2.5); if (this.stateT >= C.recover) { this.path = null; this.set("chase"); } break;
      default: this.set(this.aware ? "chase" : "patrol");
    }
  }

  /**
   * Badalo: balança pendurado, inclina 1,2 s e trava o ponto (Lia, ou um chamado da baliza a até 7 m da
   * projeção do corpo). Cai: numa placa ressonante fica preso e expõe o órgão 3 s; fora dela, impacto de 3 m.
   * A 50% ou menos alterna o mergulho com uma onda de piso anunciada por três anéis.
   */
  private updateBadalo(dt: number, ctx: CreatureCtx) {
    const B = BADALO, floorY = this.home.y, hangY = floorY + B.hangY;
    const toward = (x: number, z: number, sp: number) => {
      const dx = x - this.pos.x, dz = z - this.pos.z, l = Math.hypot(dx, dz);
      if (l < 1e-3) return;
      const st = Math.min(l, sp * dt); this.pos.x += (dx / l) * st; this.pos.z += (dz / l) * st;
    };
    const keepIn = () => { // não sai do raio do trilho em torno do poço
      const dx = this.pos.x - this.home.x, dz = this.pos.z - this.home.z, l = Math.hypot(dx, dz), R = 10;
      if (l > R) { this.pos.x = this.home.x + (dx / l) * R; this.pos.z = this.home.z + (dz / l) * R; }
    };
    if (!this.halfDone && this.hp <= this.maxHp * 0.5) { this.halfDone = true; ctx.emit({ type: "badaloHalf", id: this.id }); }
    this.anim += dt;
    switch (this.state) {
      case "hang": this.pos.y += (hangY - this.pos.y) * Math.min(1, dt * 3); break; // adormecido
      case "intro": {
        // demonstração gratuita: uma batida cai sozinha sobre a placa norte
        if (!this.lockPos) { this.lockPos = { ...this.plates[0] }; this.lockSrc = "demo"; this.locked = true; ctx.emit({ type: "badaloTilt", id: this.id, pos: { ...this.lockPos }, src: "demo" }); ctx.emit({ type: "badaloLock", id: this.id, pos: { ...this.lockPos }, src: "demo" }); }
        toward(this.lockPos.x, this.lockPos.z, B.moveSpeed * 2);
        if (this.stateT >= 1.6) this.set("drop");
        break;
      }
      case "idle": {
        this.pos.y += (hangY - this.pos.y) * Math.min(1, dt * 3);
        toward(ctx.playerPos.x, ctx.playerPos.z, B.moveSpeed * 0.35); keepIn();
        if (this.stateT >= B.cycleGap && ctx.playerAlive) {
          this.cycles++;
          const half = this.hp <= this.maxHp * 0.5;
          if (half && this.altWave) { this.set("waveWarn"); ctx.emit({ type: "badaloWaveWarn", id: this.id, pos: { x: this.pos.x, y: floorY, z: this.pos.z } }); }
          else { this.lockPos = null; this.locked = false; this.set("tilt"); ctx.emit({ type: "badaloTilt", id: this.id, pos: { x: this.pos.x, y: floorY, z: this.pos.z }, radius: B.hearRadius }); }
          if (half) this.altWave = !this.altWave;
        }
        break;
      }
      case "tilt": {
        // segue o alvo e trava aos 60% da inclinação: dá tempo de sair da placa depois da trava
        if (!this.locked) {
          const p = ctx.pulse;
          if (p && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) <= B.hearRadius) { this.lockPos = { x: p.pos.x, y: floorY, z: p.pos.z }; this.lockSrc = "baliza"; }
          else { this.lockPos = { x: ctx.playerPos.x, y: floorY, z: ctx.playerPos.z }; this.lockSrc = "lia"; }
          toward(this.lockPos.x, this.lockPos.z, B.moveSpeed); keepIn();
          if (this.stateT >= B.tiltTime * 0.6) { this.locked = true; ctx.emit({ type: "badaloLock", id: this.id, pos: { ...this.lockPos }, src: this.lockSrc }); }
        } else toward(this.lockPos!.x, this.lockPos!.z, B.moveSpeed * 3);
        if (this.stateT >= B.tiltTime) this.set("drop");
        break;
      }
      case "drop": {
        const k = Math.min(1, this.stateT / B.dropTime);
        toward(this.lockPos!.x, this.lockPos!.z, 30);
        this.pos.y = hangY + (floorY - hangY) * k * k;
        if (k >= 1) {
          this.pos.y = floorY;
          this.stuckOn = this.plates.findIndex((pl) => Math.hypot(pl.x - this.pos.x, pl.z - this.pos.z) <= B.plateRadius);
          if (this.stuckOn >= 0) { this.set("stuck"); ctx.emit({ type: "badaloStuck", id: this.id, pos: { ...this.pos }, plate: this.stuckOn, src: this.lockSrc }); }
          else {
            ctx.emit({ type: "badaloSlam", id: this.id, pos: { ...this.pos }, radius: B.impactRadius });
            if (ctx.playerAlive && distXZ(this.pos, ctx.playerPos) <= B.impactRadius && ctx.playerPos.y < floorY + 1) ctx.hurtPlayer(B.impactDamage, this.pos, "badalo");
            this.set("rise");
          }
        }
        break;
      }
      case "stuck": if (this.stateT >= B.stuckTime) { this.set("rise"); ctx.emit({ type: "badaloRise", id: this.id }); } break;
      case "rise": {
        const k = Math.min(1, this.stateT / B.riseTime);
        this.pos.y = floorY + (hangY - floorY) * (1 - (1 - k) * (1 - k));
        if (k >= 1) this.set("idle");
        break;
      }
      case "waveWarn": {
        this.pos.y += (hangY - 0.8 - this.pos.y) * Math.min(1, dt * 4);
        if (this.stateT >= B.waveWarn) { this.waveR = 0; this.waveHit = false; this.set("wave"); ctx.emit({ type: "badaloWave", id: this.id, pos: { x: this.pos.x, y: floorY, z: this.pos.z } }); }
        break;
      }
      case "wave": {
        this.waveR += B.waveSpeed * dt;
        const dd = distXZ(this.pos, ctx.playerPos);
        // a onda corre pelo piso: pular ou estar no patamar evita
        if (!this.waveHit && ctx.playerAlive && Math.abs(dd - this.waveR) < B.waveBand && ctx.playerPos.y < floorY + 0.3) { this.waveHit = true; ctx.hurtPlayer(B.waveDamage, { x: this.pos.x, y: floorY, z: this.pos.z }, "badaloOnda"); }
        if (this.waveR >= B.waveMax) this.set("idle");
        break;
      }
      default: this.set("idle");
    }
  }
}
