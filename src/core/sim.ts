import { BEACON, DIFFICULTY, FOLE, NEEDLE_MARK, PLAYER, RISCADOR, ESTILHACO, VEU, WEAPONS, type Difficulty, type WeaponId } from "../config";
import { Beacon } from "./beacon";
import { Creature, type CreatureCtx } from "./creatures";
import { dirFromYawPitch, distXZ, rng, type V3 } from "./math";
import { NavGrid } from "./nav";
import { PlayerBody, emptyInput, type MoveInput } from "./player";
import type { Checkpoint } from "./save";
import { Arsenal } from "./weapons";
import { World, rayBox, type Box } from "./world";
import type { CreatureType } from "./waves";
import type { LevelDef, LevelScript } from "../levels/types";

export interface FrameInput extends MoveInput {
  fireHeld: boolean;
  firePressed: boolean;
  altPressed: boolean;
  reload: boolean;
  beacon: boolean;
  interact: boolean;
  heal: boolean;
  slot: number | null;
}
export const emptyFrame = (): FrameInput => ({ ...emptyInput(), fireHeld: false, firePressed: false, altPressed: false, reload: false, beacon: false, interact: false, heal: false, slot: null });

export interface SimEvent { type: string; [k: string]: any }

export interface Interactable { id: string; pos: V3; radius: number; prompt: string; enabled: () => boolean; use: () => void; lockedPrompt?: () => string | null }
export type PickupKind = "dardos" | "curativo" | "fole";
/** munição de cada caixa (o pictograma identifica a arma) */
export const PICKUP_WEAPON: Partial<Record<PickupKind, WeaponId>> = { dardos: "agulha", fole: "fole" };
export interface Pickup { id: string; pos: V3; kind: PickupKind; amount: number; taken: boolean }
/** Nuvem do Véu: encobre a visão; o sopro do Fole a afasta por 3 s. */
export interface Cloud { id: number; owner: string; pos: V3; radius: number; age: number; life: number; clearT: number }
export interface RunStats { kills: number; shots: number; hits: number; deaths: number; damageTaken: number; time: number; pulses: number; foleShots: number; foleHits: number; sopros: number }
export interface Trigger { id: string; min: V3; max: V3; once: boolean; fired: boolean; onEnter: () => void }
export interface Latch { id: string; pos: V3; open: boolean; onOpen: () => void }
export interface Projectile { id: number; pos: V3; vel: V3; dmg: number; life: number; alive: boolean }

let projId = 1;
let cloudId = 1;

export class Sim {
  t = 0;
  world = new World();
  nav!: NavGrid;
  player = new PlayerBody();
  arsenal = new Arsenal();
  beacon = new Beacon();
  creatures: Creature[] = [];
  projectiles: Projectile[] = [];
  clouds: Cloud[] = [];
  /** estado numérico lido pela apresentação (progresso de comporta etc.); não é gravado */
  vars: Record<string, number> = {};
  interactables: Interactable[] = [];
  pickups: Pickup[] = [];
  triggers: Trigger[] = [];
  latches: Latch[] = [];
  events: SimEvent[] = [];
  hp = 100;
  medkits = 1;
  healT = -1;
  alive = true;
  done = false;
  objective = "";
  flags: Record<string, boolean> = {};
  point = "";
  script!: LevelScript;
  focus: Interactable | null = null;
  lastWindupStart = -10;
  beaconAim: { pos: V3; valid: boolean } | null = null;
  stats: RunStats = { kills: 0, shots: 0, hits: 0, deaths: 0, damageTaken: 0, time: 0, pulses: 0, foleShots: 0, foleHits: 0, sopros: 0 };
  rand: () => number;
  damageMul = 1;
  playTimeBase = 0;
  deathsBase = 0;
  /** limite de comuns ativos (diagnóstico) */
  maxActiveSeen = 0;
  private ctx: CreatureCtx;

  constructor(public level: LevelDef, public difficulty: Difficulty = "normal", seed = 7) {
    this.rand = rng(seed);
    this.damageMul = DIFFICULTY[difficulty].damageTaken;
    const self = this;
    this.ctx = {
      t: 0, world: this.world, nav: null as any, playerPos: this.player.pos, playerEye: this.player.eyePos(), playerAlive: true, pulse: null,
      get lastWindupStart() { return self.lastWindupStart; },
      setLastWindup: (t) => { self.lastWindupStart = t; },
      hurtPlayer: (d, from, src) => self.hurt(d, from, src),
      emit: (e) => self.emit(e),
      fireProjectile: (from, dir, owner) => self.fireProjectile(from, dir, owner),
      spawnCloud: (owner, pos) => self.spawnCloud(owner, pos),
      dissipate: (owner) => self.dissipate(owner),
      hasCloud: (owner) => self.clouds.some((c) => c.owner === owner.id),
      others: this.creatures,
      rand: () => self.rand(),
    } as CreatureCtx;
  }

  emit(e: SimEvent) { this.events.push(e); }
  drain(): SimEvent[] { const e = this.events; this.events = []; return e; }

  /** (Re)monta o mundo da fase a partir de um ponto de retorno. */
  start(point: string, cp?: Checkpoint) {
    this.world = new World();
    this.level.build(this.world);
    this.nav = new NavGrid(this.world);
    this.nav.build();
    this.creatures.length = 0;
    this.projectiles = []; this.clouds = []; this.vars = {};
    this.interactables = []; this.pickups = []; this.triggers = []; this.latches = [];
    this.ctx.world = this.world; this.ctx.nav = this.nav;
    this.alive = true; this.done = false; this.healT = -1; this.lastWindupStart = -10;
    this.point = point;
    if (cp) {
      this.hp = cp.hp; this.medkits = cp.medkits; this.flags = { ...cp.flags }; this.objective = cp.objective;
      this.arsenal = new Arsenal(); this.arsenal.restore(cp.weapons, cp.current);
      this.beacon = new Beacon(); if (cp.hasBeacon) this.beacon.acquire();
      this.playTimeBase = cp.playTime;
      this.deathsBase = cp.deaths ?? 0;
      // contadores do capítulo continuam de onde o registro parou (resultado não zera ao Continuar)
      const b = cp.stats;
      if (b) { this.stats.kills = b.kills ?? 0; this.stats.shots = b.shots ?? 0; this.stats.hits = b.hits ?? 0; this.stats.pulses = b.pulses ?? 0; this.stats.damageTaken = b.damageTaken ?? 0; this.stats.foleShots = b.foleShots ?? 0; this.stats.foleHits = b.foleHits ?? 0; this.stats.sopros = b.sopros ?? 0; }
    } else {
      this.hp = PLAYER.maxHp; this.medkits = 1; this.flags = {}; this.arsenal = new Arsenal(); this.beacon = new Beacon();
    }
    const sp = this.level.spawns[point] ?? Object.values(this.level.spawns)[0];
    this.player.place(sp.pos, sp.yaw);
    this.script = this.level.script(this);
    this.script.start(point);
    this.emit({ type: "levelStart", point });
  }

  checkpoint(point: string): Checkpoint {
    return {
      phase: this.level.id, point, hp: Math.ceil(this.hp), medkits: this.medkits,
      weapons: this.arsenal.snapshot(), current: this.arsenal.current, hasBeacon: this.beacon.owned,
      objective: this.objective, flags: { ...this.flags }, difficulty: this.difficulty, playTime: this.playTimeBase + this.stats.time, deaths: this.deathsBase + this.stats.deaths,
      stats: { kills: this.stats.kills, shots: this.stats.shots, hits: this.stats.hits, pulses: this.stats.pulses, damageTaken: Math.round(this.stats.damageTaken), foleShots: this.stats.foleShots, foleHits: this.stats.foleHits, sopros: this.stats.sopros },
    };
  }

  /** Piso de recuperação dos abrigos (aplicado antes de gravar). */
  applyShelterFloor() {
    this.hp = Math.max(this.hp, PLAYER.shelterMinHp);
    const ag = this.arsenal.ammo("agulha");
    if (ag && ag.reserve < PLAYER.shelterMinNeedleReserve) ag.reserve = PLAYER.shelterMinNeedleReserve;
  }

  setObjective(text: string) { if (text !== this.objective) { this.objective = text; this.emit({ type: "objective", text }); } }
  say(who: string, text: string, dur = 4) { this.emit({ type: "subtitle", who, text, dur }); }

  spawnCreature(type: CreatureType, pos: V3, opts: Partial<Creature> = {}): Creature {
    const c = new Creature(type, { ...pos }, opts);
    this.creatures.push(c);
    const active = this.creatures.filter((x) => x.alive).length;
    this.maxActiveSeen = Math.max(this.maxActiveSeen, active);
    this.emit({ type: "spawn", id: c.id, ctype: type, pos: { ...pos } });
    return c;
  }
  activeCommons() { return this.creatures.filter((c) => c.alive).length; }
  creature(id: string) { return this.creatures.find((c) => c.id === id); }

  hurtLog: { t: number; src: string; dmg: number }[] = [];
  hurt(dmg: number, from: V3, src: string) {
    if (!this.alive || this.done) return;
    this.hurtLog.push({ t: this.t, src, dmg });
    const d = dmg * this.damageMul;
    this.hp -= d; this.stats.damageTaken += d;
    this.emit({ type: "hurt", dmg: d, from: { ...from }, src });
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false; this.stats.deaths++;
      this.arsenal.clearIntent(); this.healT = -1;
      this.emit({ type: "death", src });
    }
  }

  fireProjectile(from: V3, dir: V3, _owner: Creature) {
    const s = ESTILHACO.projectileSpeed;
    this.projectiles.push({ id: projId++, pos: { ...from }, vel: { x: dir.x * s, y: dir.y * s, z: dir.z * s }, dmg: ESTILHACO.damage, life: 4, alive: true });
    this.emit({ type: "estFire", pos: { ...from }, dir: { ...dir } });
  }

  spawnCloud(owner: Creature, pos: V3) {
    this.dissipate(owner);
    const c: Cloud = { id: cloudId++, owner: owner.id, pos: { ...pos }, radius: VEU.cloudRadius, age: 0, life: VEU.cloudTime, clearT: 0 };
    this.clouds.push(c);
    this.emit({ type: "cloud", id: c.id, pos: { ...pos }, radius: c.radius });
  }
  dissipate(owner: Creature) {
    const n = this.clouds.length;
    this.clouds = this.clouds.filter((c) => c.owner !== owner.id);
    if (this.clouds.length !== n) this.emit({ type: "cloudGone", owner: owner.id });
  }
  /** Densidade da névoa (0..1) num ponto — usada pela câmera e pelos testes. */
  cloudDensity(p: V3): number {
    let best = 0;
    for (const c of this.clouds) {
      if (c.clearT > 0) continue;
      const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
      if (d > c.radius || p.y > c.pos.y + 4) continue;
      const fadeIn = Math.min(1, c.age / 0.6), fadeOut = Math.min(1, (c.life - c.age) / 0.6);
      best = Math.max(best, Math.min(1, (1 - d / c.radius) * 1.8) * fadeIn * fadeOut);
    }
    return best;
  }

  /** Raio de disparo: primeira superfície sólida ou criatura. */
  traceShot(dirOverride?: V3): { point: V3; creature: Creature | null; t: number; normal: V3 | null } {
    const eye = this.player.eyePos();
    const dir = dirOverride ?? dirFromYawPitch(this.player.yaw, this.player.pitch);
    const range = this.arsenal.current ? WEAPONS[this.arsenal.current].range : 80;
    const wh = this.world.raycast(eye, dir, range, ["solid", "grate", "ceiling"]);
    let bestT = wh ? wh.t : range;
    let hitC: Creature | null = null;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const r = c.radius;
      const bx = { id: "", kind: "solid", mat: "", enabled: true, min: { x: c.pos.x - r, y: c.pos.y, z: c.pos.z - r }, max: { x: c.pos.x + r, y: c.pos.y + c.height, z: c.pos.z + r } } as Box;
      const h = rayBox(eye, dir, bx, bestT);
      if (h && h.t < bestT) { bestT = h.t; hitC = c; }
    }
    return { point: { x: eye.x + dir.x * bestT, y: eye.y + dir.y * bestT, z: eye.z + dir.z * bestT }, creature: hitC, t: bestT, normal: hitC ? null : wh && wh.t <= bestT + 1e-6 ? wh.normal : null };
  }

  private doFire(mode: "primary" | "alt") {
    const r = this.arsenal.fire(mode);
    if (r === "none") return;
    if (r === "dry") { this.emit({ type: "dry", mode, weapon: this.arsenal.current }); return; }
    const wid = this.arsenal.current!;
    if (wid === "fole") { if (r === "shot") this.fireFole(); else this.sopro(); return; }
    this.stats.shots++;
    const tr = this.traceShot();
    const eye = this.player.eyePos();
    if (r === "shot") {
      let dmg = WEAPONS[wid].damage;
      let marked = false;
      if (tr.creature) {
        // a marca só é consumida pelo próximo acerto primário da Agulha
        if (tr.creature.markT > 0 && wid === "agulha") { dmg += NEEDLE_MARK.bonus; tr.creature.markT = 0; marked = true; }
        this.stats.hits++;
        tr.creature.damage(dmg, this.ctx, eye, tr.point);
        if (!tr.creature.alive) this.stats.kills++;
      }
      this.emit({ type: "shot", weapon: wid, from: eye, to: tr.point, hit: tr.creature?.id ?? null, dmg: tr.creature ? dmg : 0, marked, normal: tr.normal, killed: tr.creature ? !tr.creature.alive : false });
    } else {
      if (tr.creature) { tr.creature.markT = NEEDLE_MARK.duration; this.stats.hits++; }
      this.emit({ type: "mark", weapon: wid, from: eye, to: tr.point, hit: tr.creature?.id ?? null });
    }
  }

  /** Fole primário: seis fragmentos, cada um com seu próprio impacto. */
  private fireFole() {
    const eye = this.player.eyePos();
    const yaw = this.player.yaw, pitch = this.player.pitch;
    const n = FOLE.pellets, sp = FOLE.spread;
    const pellets: { to: V3; hit: string | null; normal: V3 | null }[] = [];
    const dmgBy = new Map<Creature, number>();
    this.stats.foleShots++;
    const rot = (this.stats.foleShots * 0.7) % (Math.PI * 2);
    for (let i = 0; i < n; i++) {
      // um no centro e o resto em anel, girando a cada disparo (padrão determinístico)
      const a = rot + (i / (n - 1)) * Math.PI * 2, r = i === 0 ? 0 : sp * (0.75 + (i % 2) * 0.25);
      const dir = dirFromYawPitch(yaw + Math.cos(a) * r, pitch + Math.sin(a) * r);
      const tr = this.traceShot(dir);
      if (tr.creature) { dmgBy.set(tr.creature, (dmgBy.get(tr.creature) ?? 0) + WEAPONS.fole.damage); this.stats.foleHits++; }
      pellets.push({ to: tr.point, hit: tr.creature?.id ?? null, normal: tr.normal });
    }
    const hits: { id: string; dmg: number; killed: boolean }[] = [];
    for (const [c, d] of dmgBy) {
      const at = pellets.find((p) => p.hit === c.id)!.to;
      c.damage(d, this.ctx, eye, at);
      if (!c.alive) this.stats.kills++;
      hits.push({ id: c.id, dmg: d, killed: !c.alive });
    }
    this.emit({ type: "shot", weapon: "fole", from: eye, to: pellets[0].to, pellets, hits, hit: hits[0]?.id ?? null, dmg: hits.reduce((x, h) => x + h.dmg, 0), killed: hits.some((h) => h.killed), marked: false, normal: pellets[0].normal });
  }

  /** Sopro do Fole: empurra comuns leves por até 4 m e afasta a névoa do Véu por 3 s. Sem dano. */
  private sopro() {
    const p = this.player, eye = p.eyePos();
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const pushed: string[] = [];
    for (const c of this.creatures) {
      if (!c.alive || !c.light) continue;
      const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > FOLE.pushRange || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < FOLE.pushCone) continue;
      if (this.world.blocked(eye, c.center(), ["solid", "ceiling"])) continue;
      if (c.push({ x: dx / d, y: 0, z: dz / d }, this.ctx)) pushed.push(c.id);
    }
    const cleared: number[] = [];
    for (const cl of this.clouds) {
      const dx = cl.pos.x - p.pos.x, dz = cl.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      const inside = d < cl.radius;
      if (inside || (d < FOLE.clearRange + cl.radius * 0.5 && (dx * fx + dz * fz) / (d || 1) > 0.5)) { cl.clearT = FOLE.clearTime; cleared.push(cl.id); }
    }
    this.stats.sopros++;
    this.emit({ type: "sopro", from: eye, dir: { x: fx, y: 0, z: fz }, pushed, cleared });
  }

  /** Ponto de piso válido para a baliza na direção da mira. */
  computeBeaconAim(): { pos: V3; valid: boolean } | null {
    const eye = this.player.eyePos();
    const dir = dirFromYawPitch(this.player.yaw, this.player.pitch);
    const h = this.world.raycast(eye, dir, BEACON.throwRange + 6, ["solid", "grate", "ceiling"]);
    if (!h) return null;
    const p = { x: eye.x + dir.x * h.t, y: eye.y + dir.y * h.t, z: eye.z + dir.z * h.t };
    const floor = h.normal.y > 0.7 && h.box.kind !== "grate";
    const inRange = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) <= BEACON.throwRange;
    return { pos: p, valid: floor && inRange };
  }

  tick(dt: number, inp: FrameInput) {
    if (this.done) return;
    this.t += dt; this.stats.time += dt;
    this.ctx.t = this.t;
    const p = this.player;

    if (this.alive) {
      // trocar arma
      if (inp.slot) {
        const id = (Object.keys(WEAPONS) as WeaponId[]).find((k) => WEAPONS[k].slot === inp.slot);
        if (id && this.arsenal.switchTo(id)) this.emit({ type: "switch", weapon: id });
      }
      // movimento
      if (p.step(dt, inp, this.world)) this.emit({ type: "step", mat: this.groundMat(), sprint: p.sprinting });
      if (p.sliding && p.slideT <= dt + 1e-6) this.emit({ type: "slide" });
      // empurrar para fora das criaturas (desliza pela lateral da cápsula)
      for (const c of this.creatures) {
        if (!c.alive || c.state === "leap") continue;
        const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z, d = Math.hypot(dx, dz), min = c.radius + 0.35;
        if (d < min && d > 1e-4 && Math.abs(c.pos.y - p.pos.y) < 1.5) { p.pos.x = c.pos.x + (dx / d) * min; p.pos.z = c.pos.z + (dz / d) * min; this.world.resolveCylinder(p.pos, 0.35, p.pos.y + 0.45, p.pos.y + p.height); }
      }

      // armas
      const wu = this.arsenal.update(dt);
      if (wu.reloaded) this.emit({ type: "reloaded" });
      if (wu.buffered) this.doFire(wu.buffered);
      if (inp.reload && this.arsenal.reload()) { this.emit({ type: "reload", time: WEAPONS[this.arsenal.current!].reload }); }
      if (inp.altPressed) this.doFire("alt");
      if (inp.fireHeld || inp.firePressed) {
        if (p.sprinting) p.breakSprint();
        const before = this.arsenal.state;
        this.doFire("primary");
        if (before === "ready" && this.arsenal.state === "reloading") this.emit({ type: "reload", time: WEAPONS[this.arsenal.current!].reload, auto: true });
      }

      // cura
      if (inp.heal && this.healT < 0 && this.medkits > 0 && this.hp < PLAYER.maxHp) { this.healT = 0; this.emit({ type: "healStart" }); }
      if (this.healT >= 0) {
        this.healT += dt;
        if (this.healT >= PLAYER.medkitTime) {
          this.healT = -1; this.medkits--; this.hp = Math.min(PLAYER.maxHp, this.hp + PLAYER.medkitHeal);
          this.emit({ type: "healed" });
        }
      }
    }

    // baliza
    const bAim = this.beacon.state === "ready" && this.alive ? this.computeBeaconAim() : null;
    this.beaconAim = bAim;
    if (inp.beacon && this.alive && this.beacon.owned) {
      const r = this.beacon.press(p.eyePos(), bAim && bAim.valid ? bAim.pos : null);
      if (r === "thrown") this.emit({ type: "beaconThrow", from: p.eyePos(), to: { ...this.beacon.pos } });
      else if (r === "invalid") this.emit({ type: "beaconInvalid" });
      else if (r === "call") { this.stats.pulses++; this.emit({ type: "beaconCall", pos: { ...this.beacon.pos } }); }
    }
    const bu = this.beacon.update(dt);
    if (bu === "landed") this.emit({ type: "beaconLand", pos: { ...this.beacon.pos } });
    else if (bu === "expired") this.emit({ type: "beaconExpired" });
    else if (bu === "callEnd") this.emit({ type: "beaconCallEnd" });
    else if (bu === "ready") this.emit({ type: "beaconReady" });
    const pulse = this.beacon.state === "emitting" ? { pos: this.beacon.pos, radius: BEACON.callRadius } : null;
    if (pulse) {
      for (const l of this.latches) {
        if (l.open) continue;
        if (Math.hypot(l.pos.x - pulse.pos.x, l.pos.z - pulse.pos.z) <= pulse.radius && !this.world.blocked({ ...pulse.pos, y: pulse.pos.y + 0.4 }, l.pos, ["solid", "ceiling"])) {
          l.open = true; this.emit({ type: "latchOpen", id: l.id, pos: l.pos }); l.onOpen();
        }
      }
    }

    // criaturas
    this.ctx.playerPos = p.pos; this.ctx.playerEye = p.eyePos(); this.ctx.playerAlive = this.alive; this.ctx.pulse = pulse;
    this.ctx.others = this.creatures;
    this.nav.ensure();
    for (const c of this.creatures) c.update(dt, this.ctx);
    // nuvens do Véu
    if (this.clouds.length) {
      for (const cl of this.clouds) { cl.age += dt; cl.clearT = Math.max(0, cl.clearT - dt); }
      const n = this.clouds.length;
      this.clouds = this.clouds.filter((c) => c.age < c.life);
      if (n !== this.clouds.length) this.emit({ type: "cloudGone" });
    }

    // projéteis
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.life -= dt;
      const step = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z) * dt;
      const dir = { x: pr.vel.x / (step / dt), y: pr.vel.y / (step / dt), z: pr.vel.z / (step / dt) };
      const h = this.world.raycast(pr.pos, dir, step, ["solid", "grate", "ceiling"]);
      // jogador
      if (this.alive) {
        const r = 0.4;
        const pb = { id: "", kind: "solid", mat: "", enabled: true, min: { x: p.pos.x - r, y: p.pos.y, z: p.pos.z - r }, max: { x: p.pos.x + r, y: p.pos.y + p.height, z: p.pos.z + r } } as Box;
        const ph = rayBox(pr.pos, dir, pb, h ? h.t : step);
        if (ph) { pr.alive = false; this.hurt(pr.dmg, pr.pos, "estilhaco"); continue; }
      }
      if (h || pr.life <= 0) {
        pr.alive = false;
        if (h) this.emit({ type: "projHit", pos: { x: pr.pos.x + dir.x * h.t, y: pr.pos.y + dir.y * h.t, z: pr.pos.z + dir.z * h.t } });
        continue;
      }
      pr.pos.x += pr.vel.x * dt; pr.pos.y += pr.vel.y * dt; pr.pos.z += pr.vel.z * dt;
    }
    this.projectiles = this.projectiles.filter((x) => x.alive);
    // remove corpos antigos
    if (this.creatures.length > 24) {
      const keep = this.creatures.filter((c) => c.alive || c.deadT < 3);
      this.creatures.length = 0; this.creatures.push(...keep);
    }

    // a morte é resolvida antes de qualquer saída ou interação
    if (!this.alive) return;

    // coletas
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      if (Math.hypot(pk.pos.x - p.pos.x, pk.pos.z - p.pos.z) < 1.0 && Math.abs(pk.pos.y - p.pos.y) < 1.2) {
        const wpn = PICKUP_WEAPON[pk.kind];
        if (wpn) {
          if (!this.arsenal.owned.has(wpn)) continue;
          const n = this.arsenal.addReserve(wpn, pk.amount);
          if (n <= 0) continue;
          pk.taken = true; this.emit({ type: "pickup", kind: pk.kind, amount: n, id: pk.id });
        } else {
          if (this.medkits >= PLAYER.maxMedkits) continue;
          this.medkits++; pk.taken = true; this.emit({ type: "pickup", kind: pk.kind, amount: 1, id: pk.id });
        }
      }
    }

    // gatilhos
    for (const tr of this.triggers) {
      if (tr.once && tr.fired) continue;
      const inside = p.pos.x >= tr.min.x && p.pos.x <= tr.max.x && p.pos.z >= tr.min.z && p.pos.z <= tr.max.z && p.pos.y >= tr.min.y - 0.1 && p.pos.y <= tr.max.y;
      if (inside && !tr.fired) { tr.fired = true; tr.onEnter(); }
      else if (!inside && !tr.once) tr.fired = false;
    }

    // interação
    this.focus = null;
    const eye = p.eyePos();
    const look = dirFromYawPitch(p.yaw, p.pitch);
    let bestScore = -1;
    for (const it of this.interactables) {
      const dx = it.pos.x - eye.x, dy = it.pos.y - eye.y, dz = it.pos.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > it.radius) continue;
      const dot = (dx * look.x + dy * look.y + dz * look.z) / (d || 1);
      if (dot < 0.55 && d > 1.0) continue;
      if (dot > bestScore) { bestScore = dot; this.focus = it; }
    }
    if (inp.interact && this.focus && this.focus.enabled()) this.focus.use();
    else if (inp.interact && this.focus) this.emit({ type: "denied", id: this.focus.id });

    this.script.update(dt);
  }

  groundMat(): string {
    const p = this.player.pos;
    let best: Box | null = null;
    for (const b of this.world.boxes) {
      if (!b.enabled) continue;
      if (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z) continue;
      if (b.max.y > p.y + 0.05) continue;
      if (!best || b.max.y > best.max.y) best = b;
    }
    return best?.mat ?? "concreto";
  }

  /** Reintroduz comuns obrigatórios sem caminho válido por 5 s (mantém identidade e vida). */
  reintroduce(c: Creature, at: V3) {
    c.pos = { ...at }; c.path = null; c.noPathT = 0; c.set("emerging");
    this.emit({ type: "reintroduce", id: c.id, pos: { ...at } });
  }

  distTo(p: V3) { return distXZ(this.player.pos, p); }
}

export { RISCADOR };
