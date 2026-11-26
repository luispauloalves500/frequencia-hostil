import * as THREE from "three";
import * as TX from "./textures";
import { signMesh, buildFoleModel } from "./models";
import { buildF3Decor } from "./decorF3";

/**
 * Decoração de cenário de F2 e do acabamento de F1. Materiais compartilhados (cache) para que a
 * mesclagem estática junte as peças sem id numa única chamada de desenho por material.
 */
const M = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, make: () => T): T { let m = M.get(key); if (!m) { m = make(); M.set(key, m); } return m as T; }
const std = (key: string, o: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1, ...o }));
const basic = (key: string, o: THREE.MeshBasicMaterialParameters) => mat(key, () => new THREE.MeshBasicMaterial({ toneMapped: false, ...o }));

export const DM = {
  steel: () => std("steel", { color: 0x5d666c, metalness: 0.7, roughness: 0.38 }),
  darkSteel: () => std("darkSteel", { color: 0x262c30, metalness: 0.6, roughness: 0.5 }),
  rust: () => std("rust", { color: 0x6a3e26, metalness: 0.4, roughness: 0.8 }),
  wood: () => std("woodDecor", { map: TX.texWood(), roughness: 0.78 }),
  crate: () => std("crate", { map: TX.texWood(), color: 0x9a8668, roughness: 0.85 }),
  blue: () => std("bluePaint", { map: TX.texBluePaint(), roughness: 0.6 }),
  ice: () => std("iceBlock", { color: 0x9fbac6, roughness: 0.55, metalness: 0.0, transparent: false, envMapIntensity: 0.45 }), // gelo picado fosco (não espelha as lâmpadas)
  fish: () => std("fishSkin", { color: 0x8c9ea6, roughness: 0.25, metalness: 0.5 }),
  fishRed: () => std("fishRed", { color: 0xa0503c, roughness: 0.3, metalness: 0.3 }),
  canvas: () => std("awningCanvas", { map: TX.texAwning(), roughness: 0.9, side: THREE.DoubleSide }),
  rubber: () => std("rubber", { color: 0x15181a, roughness: 0.95 }),
  brass: () => std("brass", { color: 0xb08a3a, metalness: 0.9, roughness: 0.32 }),
  paper: () => std("paper", { color: 0xd8ccae, roughness: 0.95 }),
  puddle: () => std("puddle", { color: 0x3a4850, roughness: 0.03, metalness: 0.7, envMapIntensity: 2.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  grime: () => std("grime", { color: 0x3a342a, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  cloth: () => std("cloth", { color: 0x4f5a3a, roughness: 0.95 }),
  lampWarm: () => basic("lampWarm", { color: 0xffd8a0 }),
  lampCold: () => basic("lampCold", { color: 0xd8f0ff }),
  glassCold: () => std("glassCold", { color: 0x9ec8d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }),
};

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const cyl = (r0: number, r1: number, h: number, seg: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); o.position.set(x, y, z); return o; };

/** Peixe estilizado (duas pirâmides + cauda), deitado. */
function fishMesh(m: THREE.Material, len = 0.42): THREE.Mesh {
  const g = new THREE.OctahedronGeometry(0.5, 0); g.scale(len, len * 0.22, len * 0.32);
  return new THREE.Mesh(g, m);
}

/** Poça irregular: forma orgânica achatada, reflexiva. */
function puddleShape(w: number, d: number, seed: number) {
  const r = (() => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const sh = new THREE.Shape(); const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, k = 0.75 + r() * 0.35;
    const x = Math.cos(a) * w * 0.5 * k, y = Math.sin(a) * d * 0.5 * k;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);
  return g;
}

export interface DecorCtx { lights: THREE.PointLight[] }

/** Monta a decoração dos tipos novos. Devolve false se o tipo não é daqui. */
export function buildExtraDecor(g: THREE.Group, d: { kind: string; size?: { x: number; y: number; z: number }; text?: string; color?: number; id?: string; pos: { x: number; y: number; z: number } }, ctx: DecorCtx): boolean {
  const S = d.size;
  switch (d.kind) {
    case "stall": { // banca de peixe: gelo picado, peixes, placa de preço
      g.add(box(3.3, 0.06, 1.55, DM.steel(), 0, 1.03, 0));
      const ice = box(3.1, 0.08, 1.35, DM.ice(), 0, 1.1, 0); g.add(ice);
      for (let i = 0; i < 9; i++) { const f = fishMesh(i % 4 === 0 ? DM.fishRed() : DM.fish()); f.position.set(-1.3 + (i % 5) * 0.62 + (i > 4 ? 0.3 : 0), 1.17, i > 4 ? 0.3 : -0.3); f.rotation.y = (i * 0.7) % 1.2 - 0.6; g.add(f); }
      for (const x of [-1.6, 1.6]) g.add(cyl(0.03, 0.03, 1.6, 6, DM.steel(), x, 1.85, 0.7));
      g.add(box(3.4, 0.05, 0.05, DM.steel(), 0, 2.64, 0.7));
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.2), DM.paper()); tag.position.set(0.9, 1.25, 0.69); g.add(tag);
      return true;
    }
    case "iceBench": { // bancada sob a placa de gelo; o Fole fica em cima até ser pego
      g.add(box(3, 0.08, 1.4, DM.steel(), 0, 0.95, 0));
      const slab = box(1.6, 0.18, 0.9, DM.ice(), 0.6, 1.08, 0); g.add(slab);
      const fole = buildFoleModel().root; fole.traverse((o) => { o.frustumCulled = true; }); fole.scale.setScalar(1.6); fole.position.set(-0.4, 1.06, 0); fole.rotation.set(0, 0.5, Math.PI / 2); g.add(fole);
      const glow = new THREE.PointLight(0x7fe0ff, 2.5, 3, 2); glow.position.set(-0.4, 1.5, 0); g.add(glow); ctx.lights.push(glow);
      g.userData.items = [fole]; g.userData.glow = glow;
      return true;
    }
    case "hangLamp": { // lâmpada pendurada com cúpula
      g.add(cyl(0.006, 0.006, 1.0, 4, DM.darkSteel(), 0, 0.55, 0));
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.22, 12, 1, true), DM.steel()); shade.position.y = 0.0; g.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), DM.lampCold()); bulb.position.y = -0.08; g.add(bulb);
      g.position.y += 0.1;
      return true;
    }
    case "fishCrates": { // caixas plásticas de peixe empilhadas
      const cm = std("fishCrate", { color: 0x3f6f8a, roughness: 0.55 });
      for (let i = 0; i < 3; i++) { const c = box(0.7, 0.28, 0.5, cm, (i % 2) * 0.1, 0.14 + i * 0.29, (i % 2) * 0.06); c.rotation.y = i * 0.12; g.add(c); }
      const f = fishMesh(DM.fish(), 0.36); f.position.set(0.1, 0.92, 0); g.add(f);
      return true;
    }
    case "puddle": {
      const m = new THREE.Mesh(puddleShape(S?.x ?? 2, S?.z ?? 2, Math.floor(d.pos.x * 13 + d.pos.z * 7) | 1), DM.puddle());
      m.position.y = 0.012; g.add(m);
      return true;
    }
    case "grime": { // mancha de sujeira/umidade no piso
      const m = new THREE.Mesh(puddleShape(S?.x ?? 2, S?.z ?? 2, Math.floor(d.pos.x * 7 + d.pos.z * 3) | 1), DM.grime());
      m.position.y = 0.01; g.add(m);
      return true;
    }
    case "poster": {
      const t = d.text ?? "";
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), std(`poster:${t}`, { map: TX.texSign(t, "#" + (d.color ?? 0xe8d9b0).toString(16).padStart(6, "0"), 256, 128), roughness: 0.9, color: 0xb0a890 }));
      p.rotation.z = 0.04; g.add(p);
      return true;
    }
    case "cables": { // feixe de cabos e eletrocalha sob o teto
      const L = S?.x ?? 10;
      g.add(box(L, 0.08, 0.3, DM.darkSteel(), 0, 0, 0));
      for (let i = 0; i < 3; i++) { const c = cyl(0.025, 0.025, L, 5, DM.rubber(), 0, -0.08 - i * 0.04, -0.08 + i * 0.08); c.rotation.z = Math.PI / 2; g.add(c); }
      return true;
    }
    case "awning": { // toldo inclinado com franja
      const w = S?.x ?? 6, dd = S?.z ?? 4;
      const a = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), DM.canvas()); a.rotation.x = -Math.PI / 2 + 0.06; a.position.y = 0.06; g.add(a);
      for (let i = 0; i < Math.floor(w / 0.5); i++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.22), DM.canvas()); f.position.set(-w / 2 + 0.25 + i * 0.5, -0.06, dd / 2); g.add(f); }
      return true;
    }
    case "blueStall": { // balcão da banca azul com balança e caixas
      const sc = box(0.5, 0.06, 0.4, DM.steel(), -1.5, 1.14, 0); g.add(sc);
      g.add(cyl(0.18, 0.18, 0.04, 14, DM.steel(), -1.5, 1.32, 0));
      g.add(box(0.12, 0.2, 0.12, DM.darkSteel(), -1.5, 1.22, 0));
      for (let i = 0; i < 6; i++) { const f = fishMesh(DM.fish(), 0.5); f.position.set(-0.5 + i * 0.5, 1.16, (i % 2) * 0.4 - 0.2); f.rotation.y = i; g.add(f); }
      g.add(box(6.2, 0.1, 0.1, DM.blue(), 0, 1.12, 1.55));
      return true;
    }
    case "hatchRoof": case "vent": { // alçapão/respiro no teto (abre quando algo entra)
      const frame = box(1.5, 0.12, 1.5, DM.darkSteel(), 0, 0, 0); g.add(frame);
      const lid = new THREE.Group(); lid.position.set(-0.7, -0.08, 0);
      const plate = box(1.35, 0.06, 1.35, d.kind === "vent" ? DM.steel() : DM.rust(), 0.68, 0, 0); lid.add(plate);
      if (d.kind === "vent") for (let i = 0; i < 5; i++) lid.add(box(1.2, 0.08, 0.05, DM.darkSteel(), 0.68, -0.04, -0.5 + i * 0.25));
      g.add(lid); g.userData.lid = lid; g.userData.open = 0; g.userData.vib = 0;
      return true;
    }
    case "valve": { // registro: roda de manobra com haste e plaqueta
      g.add(cyl(0.06, 0.06, 0.4, 8, DM.darkSteel(), 0, 0, 0.0).rotateX(Math.PI / 2));
      const wheel = new THREE.Group(); wheel.position.z = 0.2;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 24), std("valveRed", { color: 0xb02a1c, metalness: 0.4, roughness: 0.5 })); wheel.add(rim);
      for (let i = 0; i < 3; i++) { const s = box(0.6, 0.04, 0.04, std("valveRed", {}), 0, 0, 0); s.rotation.z = (i * Math.PI) / 3; wheel.add(s); }
      wheel.add(cyl(0.07, 0.07, 0.08, 10, DM.brass(), 0, 0, 0).rotateX(Math.PI / 2));
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4020, toneMapped: false })); led.position.set(0.42, 0.3, 0.05);
      g.add(wheel, led, box(1.0, 1.0, 0.06, DM.darkSteel(), 0, 0, -0.06));
      g.userData.wheel = wheel; g.userData.led = led; g.userData.turn = 0;
      return true;
    }
    case "skylight": { // claraboia com vidros sujos (luar)
      const w = S?.x ?? 8, dd = S?.z ?? 3;
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), basic("skyGlass", { color: 0x2a4058, transparent: true, opacity: 0.55, depthWrite: false })); gl.rotation.x = Math.PI / 2; gl.position.y = -0.02; g.add(gl);
      for (let i = 0; i <= Math.floor(w / 2); i++) g.add(box(0.08, 0.1, dd, DM.darkSteel(), -w / 2 + i * 2, -0.06, 0));
      return true;
    }
    case "iceRack": { // prateleira com blocos de gelo
      for (const y of [0.4, 1.0, 1.6]) g.add(box(1.8, 0.05, 0.5, DM.steel(), 0, y, 0));
      for (const x of [-0.88, 0.88]) g.add(box(0.05, 1.9, 0.5, DM.steel(), x, 0.95, 0));
      for (let i = 0; i < 6; i++) g.add(box(0.5, 0.3, 0.4, DM.ice(), -0.55 + (i % 3) * 0.55, 0.58 + Math.floor(i / 3) * 0.6, 0));
      return true;
    }
    case "wallDrawing": {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), basic(`draw:${d.text}`, { map: TX.texWallDrawing(d.text ?? ""), transparent: true, depthWrite: false, opacity: 0.9, toneMapped: true }));
      g.add(m);
      return true;
    }
    case "gateSegments": { // quatro segmentos de luz da comporta (acendem durante os 8 s)
      const segs: THREE.Mesh[] = [];
      g.add(box(2.4, 0.5, 0.08, DM.darkSteel(), 0, 0, -0.04));
      for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.05), new THREE.MeshBasicMaterial({ color: 0x401010, toneMapped: false })); s.position.set(-0.84 + i * 0.56, 0, 0.02); g.add(s); segs.push(s); }
      g.userData.segs = segs;
      return true;
    }
    case "buoyBell": { // boia em forma de sino (a saída)
      const body = new THREE.Group();
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 1.6, 16, 1, true), std("buoyRed", { color: 0xb8401c, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide })); bell.position.y = 1.1;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), std("buoyRed", {})); cap.position.y = 1.9;
      const band = cyl(0.62, 0.7, 0.18, 16, std("buoyWhite", { color: 0xd8d4c8, roughness: 0.6 }), 0, 0.9, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 14), DM.rust()); ring.position.y = 2.3;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), basic("buoyLamp", { color: 0xffd040 })); lamp.position.y = 2.1;
      body.add(bell, cap, band, ring, lamp);
      g.add(body, cyl(0.95, 0.95, 0.2, 16, DM.darkSteel(), 0, 0.1, 0));
      g.userData.swingBody = body;
      return true;
    }
    case "chain": { // corrente pendurada do teto
      const n = 12;
      for (let i = 0; i < n; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 4, 8), DM.rust()); l.position.y = -i * 0.1; l.rotation.y = (i % 2) * Math.PI / 2; g.add(l); }
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 10, Math.PI * 1.4), DM.rust()); hook.position.y = -n * 0.1 - 0.1; g.add(hook);
      return true;
    }
    case "crateStack": {
      g.add(box(1.4, 1.4, 1.4, DM.crate(), 0, 0.7, 0));
      const top = box(1.0, 0.8, 1.0, DM.crate(), 0.15, 1.8, -0.1); top.rotation.y = 0.3; g.add(top);
      g.add(box(1.45, 0.06, 1.45, DM.rust(), 0, 1.0, 0));
      return true;
    }
    case "bollard": {
      g.add(cyl(0.22, 0.26, 0.7, 10, DM.darkSteel(), 0, 0.35, 0));
      g.add(cyl(0.32, 0.32, 0.12, 10, DM.darkSteel(), 0, 0.72, 0));
      const rope = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 14), std("rope", { color: 0x8a7a5a, roughness: 0.95 })); rope.rotation.x = Math.PI / 2; rope.position.y = 0.5; g.add(rope);
      return true;
    }
    case "pumpHouse": { // casa das bombas (F3) ao fundo, além do canal
      const wall = std("pumpWall", { map: TX.texConcrete(), color: 0x8a8a80, roughness: 0.9 });
      g.add(box(26, 14, 16, wall, 0, 7, 0));
      g.add(box(8, 10, 8, wall, -6, 19, 0));
      g.add(cyl(1.1, 1.4, 12, 10, DM.rust(), 8, 20, 2));
      const winM = basic("pumpWin", { color: 0xffb060 });
      for (let i = 0; i < 5; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), winM); w.position.set(-9 + i * 4.5, 9, 8.02); g.add(w); }
      return true;
    }
    case "bench": {
      g.add(box(1.8, 0.06, 0.45, DM.wood(), 0, 0.45, 0));
      g.add(box(1.8, 0.4, 0.05, DM.wood(), 0, 0.72, -0.22));
      for (const x of [-0.8, 0.8]) g.add(box(0.06, 0.45, 0.45, DM.darkSteel(), x, 0.22, 0));
      return true;
    }
    case "luggage": { // malas abandonadas
      g.add(box(0.7, 0.45, 0.25, std("bagBrown", { color: 0x5a3a22, roughness: 0.8 }), 0, 0.23, 0));
      const b = box(0.55, 0.35, 0.22, std("bagGreen", { color: 0x2f4a3a, roughness: 0.85 }), 0.5, 0.18, 0.3); b.rotation.y = 0.7; g.add(b);
      g.add(box(0.3, 0.04, 0.04, DM.darkSteel(), 0, 0.5, 0));
      return true;
    }
    case "pipes": { // tubulação na parede (ao longo de x local)
      const L = S?.x ?? 6;
      for (let i = 0; i < 2; i++) { const p = cyl(0.07 + i * 0.03, 0.07 + i * 0.03, L, 8, i ? DM.rust() : DM.steel(), 0, i * 0.24, 0); p.rotation.z = Math.PI / 2; g.add(p); }
      for (let k = 0; k <= Math.floor(L / 2); k++) g.add(box(0.06, 0.5, 0.2, DM.darkSteel(), -L / 2 + k * 2, 0.1, -0.08));
      return true;
    }
    case "trash": { // lixo e papéis no chão
      for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.22 + (i % 3) * 0.08, 0.3), DM.paper()); p.rotation.set(-Math.PI / 2, 0, i * 1.3); p.position.set(Math.cos(i * 2.1) * 0.6, 0.015 + i * 0.001, Math.sin(i * 1.7) * 0.5); g.add(p); }
      const can = cyl(0.04, 0.04, 0.12, 8, DM.steel(), 0.3, 0.04, -0.2); can.rotation.z = Math.PI / 2; g.add(can);
      return true;
    }
    case "barrier": { // cavalete listrado
      const st = std("barrierStripe", { color: 0xd8a020, roughness: 0.6 });
      g.add(box(1.6, 0.18, 0.05, st, 0, 0.85, 0));
      g.add(box(1.6, 0.1, 0.05, DM.darkSteel(), 0, 0.6, 0));
      for (const x of [-0.7, 0.7]) { const l = box(0.05, 1.0, 0.05, DM.darkSteel(), x, 0.48, 0); g.add(l); }
      return true;
    }
    case "vendor": { // máquina de bilhetes/vending (com tela acesa)
      g.add(box(0.9, 1.9, 0.7, std("vendBody", { color: 0x2e3d48, metalness: 0.5, roughness: 0.4 }), 0, 0.95, 0));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), basic("vendScreen", { color: 0x4fb0d0 })); scr.position.set(0, 1.35, 0.36); g.add(scr);
      g.add(box(0.6, 0.06, 0.1, DM.darkSteel(), 0, 0.7, 0.38));
      return true;
    }
    case "rubble": { // entulho: azulejos soltos e pedaços de concreto
      const cm = std("rubble", { map: TX.texConcrete(), roughness: 0.9 });
      for (let i = 0; i < 7; i++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + (i % 3) * 0.06, 0), cm); r.position.set(Math.cos(i * 1.9) * 0.6, 0.06, Math.sin(i * 2.3) * 0.4); r.rotation.set(i, i * 2, 0); g.add(r); }
      return true;
    }
  }
  return buildF3Decor(g, d, ctx);
}

export { signMesh };
