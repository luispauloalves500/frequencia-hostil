import { describe, expect, it } from "vitest";
import { BEACON, DT, WEAPONS } from "../src/config";
import { Beacon } from "../src/core/beacon";
import { Arsenal } from "../src/core/weapons";
import { MemoryKV, SaveStore } from "../src/core/save";
import { ArenaDirector } from "../src/core/waves";

const tick = (fn: (dt: number) => void, secs: number) => { for (let i = 0; i < Math.round(secs / DT); i++) fn(DT); };

describe("baliza de eco", () => {
  const from = { x: 0, y: 1.6, z: 0 };
  it("dois toques: lança e chama; recarga de 5 s com clique de pronta", () => {
    const b = new Beacon(); b.acquire();
    expect(b.press(from, { x: 0, y: 0, z: -10 })).toBe("thrown");
    tick((d) => b.update(d), BEACON.flightTime + 0.02);
    expect(b.state).toBe("armed");
    expect(b.press(from, null)).toBe("call");
    expect(b.inCallRange({ x: 0, y: 0, z: -16.9 })).toBe(true);
    expect(b.inCallRange({ x: 0, y: 0, z: -17.2 })).toBe(false); // 7 m medidos desde o emissor
    tick((d) => b.update(d), 2.45);
    expect(b.state).toBe("emitting");
    tick((d) => b.update(d), 0.07);
    expect(b.state).toBe("recharging");
    let ready = false;
    tick((d) => { if (b.update(d) === "ready") ready = true; }, 4.9);
    expect(ready).toBe(false);
    tick((d) => { if (b.update(d) === "ready") ready = true; }, 0.2);
    expect(ready).toBe(true); expect(b.state).toBe("ready");
  });
  it("mira inválida ou fora de 14 m mantém a carga", () => {
    const b = new Beacon(); b.acquire();
    expect(b.press(from, null)).toBe("invalid");
    expect(b.press(from, { x: 0, y: 0, z: -14.5 })).toBe("invalid");
    expect(b.state).toBe("ready");
  });
  it("armada e esquecida: recolhe após 6 s", () => {
    const b = new Beacon(); b.acquire();
    b.press(from, { x: 3, y: 0, z: 3 });
    tick((d) => b.update(d), BEACON.flightTime + 5.9);
    expect(b.state).toBe("armed");
    tick((d) => b.update(d), 0.2);
    expect(b.state).toBe("ready");
  });
  it("morte devolve a baliza pronta", () => {
    const b = new Beacon(); b.acquire(); b.press(from, { x: 1, y: 0, z: 1 });
    b.reset(); expect(b.state).toBe("ready");
  });
});

describe("Agulha", () => {
  it("pente 24, cadência 5/s, cada disparo gasta 1", () => {
    const a = new Arsenal(); a.give("agulha", 24, 24);
    let shots = 0;
    tick((d) => { a.update(d); if (a.fire("primary") === "shot") shots++; }, 1.0);
    expect(shots).toBeGreaterThanOrEqual(5); expect(shots).toBeLessThanOrEqual(6);
    expect(a.ammo()!.mag).toBe(24 - shots);
    expect(a.ammoSpent).toBe(shots);
  });
  it("recarga de 1,4 s só transfere munição ao concluir", () => {
    const a = new Arsenal(); a.give("agulha", 10, 30);
    expect(a.reload()).toBe(true);
    tick((d) => a.update(d), 1.3);
    expect(a.ammo()).toEqual({ mag: 10, reserve: 30 });
    tick((d) => a.update(d), 0.12);
    expect(a.ammo()).toEqual({ mag: 24, reserve: 16 });
  });
  it("trocar de arma cancela a recarga sem transferir", () => {
    const a = new Arsenal(); a.give("agulha", 4, 30); a.give("fole", 8, 8);
    a.reload(); tick((d) => a.update(d), 0.7);
    a.switchTo("fole"); tick((d) => a.update(d), 2);
    expect(a.ammo("agulha")).toEqual({ mag: 4, reserve: 30 });
  });
  it("secundário gasta 3; pente abaixo do custo dá clique seco e conserva munição", () => {
    const a = new Arsenal(); a.give("agulha", 4, 0);
    expect(a.fire("alt")).toBe("alt");
    expect(a.ammo()!.mag).toBe(1);
    tick((d) => a.update(d), 0.5);
    expect(a.fire("alt")).toBe("dry");
    expect(a.ammo()!.mag).toBe(1);
    expect(a.ammoSpent).toBe(3);
  });
  it("pente vazio: clique seco sem impacto e recarga automática se houver reserva", () => {
    const a = new Arsenal(); a.give("agulha", 0, 24);
    expect(a.fire("primary")).toBe("dry");
    expect(a.state).toBe("reloading");
  });
  it("clique guardado nos últimos 120 ms da troca dispara quando a arma fica pronta", () => {
    const a = new Arsenal(); a.give("agulha", 24, 0); a.give("fole", 8, 8);
    a.switchTo("fole");
    tick((d) => a.update(d), 0.2);
    expect(a.fire("primary")).toBe("none"); expect(a.bufferedFire).toBe(null); // cedo demais
    tick((d) => a.update(d), 0.17);
    a.fire("primary"); expect(a.bufferedFire).toBe("primary");
    let buffered: string | undefined;
    tick((d) => { const r = a.update(d); if (r.buffered) buffered = r.buffered; }, 0.2);
    expect(buffered).toBe("primary");
    a.switchTo("agulha"); tick((d) => a.update(d), 0.4); a.fire("primary"); a.clearIntent();
    expect(a.bufferedFire).toBe(null);
  });
  it("reserva respeita o máximo de 144", () => {
    const a = new Arsenal(); a.give("agulha", 24, 140);
    expect(a.addReserve("agulha", 24)).toBe(4);
    expect(a.ammo()!.reserve).toBe(WEAPONS.agulha.reserveMax);
  });
});

describe("salvamento", () => {
  const cp = { phase: "F1", point: "F1-B", hp: 72, medkits: 1, weapons: { agulha: { mag: 20, reserve: 48 } }, current: "agulha" as const, hasBeacon: true, objective: "x", flags: { trinco: true }, difficulty: "normal" as const, playTime: 100 };
  it("grava em dois registros e carrega o mais recente", () => {
    const kv = new MemoryKV(); const s = new SaveStore(kv);
    expect(s.save({ checkpoint: { ...cp, point: "F1-A" }, completed: [], unlocked: ["F1"] })).toBe("ok");
    expect(s.save({ checkpoint: cp, completed: [], unlocked: ["F1"] })).toBe("ok");
    expect(kv.getItem(SaveStore.KEYS[0])).not.toBeNull(); expect(kv.getItem(SaveStore.KEYS[1])).not.toBeNull();
    const re = new SaveStore(kv).load()!;
    expect(re.checkpoint.point).toBe("F1-B"); expect(re.checkpoint.weapons.agulha.reserve).toBe(48);
  });
  it("gravação interrompida: carrega a última cópia válida", () => {
    const kv = new MemoryKV(); const s = new SaveStore(kv);
    s.save({ checkpoint: { ...cp, point: "F1-A" }, completed: [], unlocked: ["F1"] });
    s.save({ checkpoint: cp, completed: [], unlocked: ["F1"] });
    // corrompe o registro mais recente
    const newest = [0, 1].find((i) => JSON.parse(JSON.parse(kv.getItem(SaveStore.KEYS[i])!).body).checkpoint.point === "F1-B")!;
    kv.setItem(SaveStore.KEYS[newest], kv.getItem(SaveStore.KEYS[newest])!.slice(0, 40));
    expect(new SaveStore(kv).load()!.checkpoint.point).toBe("F1-A");
  });
  it("sem armazenamento: mantém a sessão em memória", () => {
    const kv = new MemoryKV(); kv.failWrites = true;
    const s = new SaveStore(kv);
    expect(s.save({ checkpoint: cp, completed: [], unlocked: ["F1"] })).toBe("session");
    expect(s.load()!.checkpoint.point).toBe("F1-B");
    const none = new SaveStore(null);
    expect(none.save({ checkpoint: cp, completed: [], unlocked: [] })).toBe("session");
  });
});

describe("arena da catraca", () => {
  function harness() {
    const alive = new Map<string, boolean>(); let n = 0; let dist = 20;
    const telegraphs: string[] = [];
    const d = new ArenaDirector(
      [{ type: "riscador", door: "oficina" }, { type: "riscador", door: "oficina" }, { type: "estilhaco", door: "superior" }],
      [{ type: "riscador", door: "oficina" }, { type: "riscador", door: "oficina" }, { type: "riscador", door: "oficina" }, { type: "estilhaco", door: "leste" }],
      {
        activeCount: () => [...alive.values()].filter(Boolean).length,
        distanceToDoor: () => dist,
        telegraph: (door) => telegraphs.push(door),
        spawn: () => { const id = `c${n++}`; alive.set(id, true); return id; },
        isAlive: (id) => !!alive.get(id),
      });
    return { d, alive, telegraphs, setDist: (v: number) => (dist = v) };
  }
  it("abertura rápida: onda 2 espera 8 s e ocorre uma vez", () => {
    const h = harness(); h.d.start();
    tick((dt) => h.d.update(dt), 1.1);
    expect(h.alive.size).toBe(3);
    for (const k of h.alive.keys()) h.alive.set(k, false); // os três caem antes dos 8 s
    tick((dt) => h.d.update(dt), 5);
    expect(h.d.wave2Started).toBe(false);
    tick((dt) => h.d.update(dt), 2.0);
    expect(h.d.wave2Started).toBe(true);
    expect(h.d.wave2StartTime).toBeGreaterThanOrEqual(8);
    tick((dt) => h.d.update(dt), 3);
    expect(h.alive.size).toBe(7); // 5 Riscadores e 2 Estilhaços no total
    tick((dt) => h.d.update(dt), 10);
    expect(h.alive.size).toBe(7);
    expect(h.d.spawnLog.filter((s) => s.wave === 2).length).toBe(4);
  });
  it("volta por cima: com dois vivos a onda 2 não entra; com um vivo entra; painel bloqueado até o fim", () => {
    const h = harness(); h.d.start();
    tick((dt) => h.d.update(dt), 12);
    expect(h.d.wave2Started).toBe(false);
    h.alive.set("c0", false);
    tick((dt) => h.d.update(dt), 0.5);
    expect(h.d.wave2Started).toBe(false); // restam dois
    h.alive.set("c2", false);
    tick((dt) => h.d.update(dt), 0.1);
    expect(h.d.wave2Started).toBe(true);
    tick((dt) => h.d.update(dt), 3);
    expect(h.d.panelUnlocked()).toBe(false);
    for (const k of h.alive.keys()) if (k !== "c1") h.alive.set(k, false);
    tick((dt) => h.d.update(dt), 1);
    expect(h.d.panelUnlocked()).toBe(false); // ainda há um da onda 1
    h.alive.set("c1", false);
    tick((dt) => h.d.update(dt), 0.1);
    expect(h.d.panelUnlocked()).toBe(true);
  });
  it("entrada avisa por 1 s e respeita distância mínima de 6 m", () => {
    const h = harness(); h.setDist(3); h.d.start();
    tick((dt) => h.d.update(dt), 0.9);
    expect(h.telegraphs.length).toBe(3); expect(h.alive.size).toBe(0);
    tick((dt) => h.d.update(dt), 3);
    expect(h.alive.size).toBe(0); // Lia perto demais: fila pendente
    h.setDist(10); tick((dt) => h.d.update(dt), 1.1);
    expect(h.alive.size).toBe(3);
  });
});
