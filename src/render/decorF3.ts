import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import * as TX from "./textures";
import { DM } from "./decor";
import { buildTearModel, signMesh } from "./models";

/**
 * Decoração da F3 (Casa das Bombas). Tudo apoiado: no piso, na parede (com placa de fixação)
 * ou pendurado no teto com suporte visível. Materiais compartilhados para a mesclagem estática.
 */
const M = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, make: () => T): T { let m = M.get(key); if (!m) { m = make(); M.set(key, m); } return m as T; }
const std = (key: string, o: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1, ...o }));
const basic = (key: string, o: THREE.MeshBasicMaterialParameters) => mat(key, () => new THREE.MeshBasicMaterial({ toneMapped: false, ...o }));

const F = {
  tank: () => std("f3tank", { color: 0x9aa49c, map: TX.texConcrete(), roughness: 0.8, metalness: 0.15 }),
  band: () => std("f3band", { color: 0x3a3226, metalness: 0.5, roughness: 0.6 }),
  paintGreen: () => std("f3green", { color: 0x2f5a4a, metalness: 0.35, roughness: 0.55 }),
  paintRed: () => std("f3red", { color: 0x7a2a22, metalness: 0.35, roughness: 0.55 }),
  gravel: () => std("f3gravel", { map: TX.texGravel(), roughness: 0.95 }),
  hazard: () => std("f3hazard", { map: TX.texHazard(), roughness: 0.7 }),
  water: () => std("f3water", { color: 0x1a2a2c, roughness: 0.3, metalness: 0.2, envMapIntensity: 0.6, transparent: true, opacity: 0.85 }),
  dark: () => std("f3dark", { color: 0x07090a, roughness: 1 }),
  dial: () => std("f3dial", { color: 0xd8d2c0, roughness: 0.6 }),
  needle: () => basic("f3needle", { color: 0x9a1a10 }),
  lampOff: () => std("f3lampoff", { color: 0x3a2020, roughness: 0.4 }),
  violet: () => basic("f3violet", { color: 0xc89bff }),
  chalkViolet: () => std("f3chalkv", { color: 0xb898e0, roughness: 0.95, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
};
const rb = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, r = 0.04) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.3)), m); o.position.set(x, y, z); return o; };
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const cyl = (r0: number, r1: number, h: number, seg: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); o.position.set(x, y, z); return o; };

type D = { kind: string; size?: { x: number; y: number; z: number }; text?: string; color?: number; id?: string; pos: { x: number; y: number; z: number } };

/** Mostrador redondo (vidro e ponteiro), voltado para +z. */
function dial(r: number): THREE.Group {
  const g = new THREE.Group();
  const rim = cyl(r, r, 0.05, 16, DM.brass()); rim.rotation.x = Math.PI / 2; g.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.86, 16), F.dial()); face.position.z = 0.027; g.add(face);
  const nd = box(r * 0.08, r * 0.75, 0.01, F.needle(), 0, r * 0.3, 0.032); nd.rotation.z = -0.6 + Math.random() * 1.2; g.add(nd);
  g.userData.needle = nd;
  return g;
}

export function buildF3Decor(g: THREE.Group, d: D, ctx: { lights: THREE.PointLight[] }): boolean {
  const S = d.size;
  switch (d.kind) {
    case "filterTank": { // tanque de decantação: casco de concreto, cintas, tampa e tubo até o teto
      const r = S ? Math.min(S.x, S.z) * 0.5 : 0.88, h = S?.y ?? 3.4;
      g.add(cyl(r, r * 1.04, h, 18, F.tank(), 0, h / 2, 0));
      for (const y of [0.3, h * 0.5, h - 0.25]) g.add(cyl(r * 1.03, r * 1.03, 0.08, 18, F.band(), 0, y, 0));
      g.add(cyl(r * 0.92, r * 0.92, 0.1, 16, DM.darkSteel(), 0, h + 0.05, 0));
      const top = S ? 0 : 5 - h - 0.1; // na galeria dos filtros o tubo sobe até o teto (5 m)
      if (top > 0.2) { g.add(cyl(0.09, 0.09, top, 8, DM.rust(), r * 0.4, h + 0.1 + top / 2, 0)); g.add(box(0.5, 0.06, 0.3, DM.darkSteel(), r * 0.4, 4.97, 0)); }
      g.add(cyl(0.12, 0.12, 0.3, 10, DM.steel(), 0, 0.5, r + 0.08)).rotation.x = Math.PI / 2;
      return true;
    }
    case "filterBed": { // superfície do leito filtrante (o volume é a caixa sólida do nível)
      const w = S?.x ?? 10, dd = S?.z ?? 2.6;
      const pg = new THREE.PlaneGeometry(w - 0.1, dd - 0.1); const uv = pg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 2.5, uv.getY(i) * dd / 2.5);
      const p = new THREE.Mesh(pg, F.gravel()); p.rotation.x = -Math.PI / 2; p.position.y = 0.012; g.add(p);
      // mureta de concreto junto da faixa
      g.add(box(w, 0.14, 0.12, DM.darkSteel(), 0, 0.07, (d.pos.z > 0 ? -1 : 1) * (dd / 2 - 0.06)));
      return true;
    }
    case "tearBench": { // bancada de manutenção na parede norte; o Tear em cima até ser pego
      const W = S?.x ?? 2.4, Dp = S?.z ?? 1.4, H = S?.y ?? 0.95;
      g.add(rb(W, 0.08, Dp, DM.steel(), 0, H - 0.04, 0));
      for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-Dp / 2 + 0.08, Dp / 2 - 0.08]) g.add(box(0.06, H - 0.08, 0.06, DM.darkSteel(), x, (H - 0.08) / 2, z));
      g.add(box(W - 0.1, 0.05, Dp - 0.1, DM.darkSteel(), 0, 0.25, 0));
      g.add(box(W, 1.2, 0.05, std("pegboard", { color: 0x5a5448, roughness: 0.9 }), 0, H + 0.7, -Dp / 2 + 0.03));
      const tear = buildTearModel().root; tear.traverse((o) => { o.frustumCulled = true; }); tear.scale.setScalar(1.6); tear.position.set(-0.1, (S?.y ?? 0.95) + 0.1, 0.1); tear.rotation.set(0, 0.4, Math.PI / 2); g.add(tear);
      const glow = new THREE.PointLight(0xc89bff, 2.2, 3, 2); glow.position.set(0, 1.6, 0.4); g.add(glow); ctx.lights.push(glow);
      const tag = signMesh("TEAR • FIO DE CONTENÇÃO", 0xc89bff, 1.3); tag.position.set(0, (S?.y ?? 0.95) + 1.1, -(S?.z ?? 1.4) / 2 + 0.06); g.add(tag);
      g.userData.items = [tear]; g.userData.glow = glow;
      return true;
    }
    case "lineMark": { // marca de giz no piso: onde esticar a linha
      for (const dz of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(S?.x ?? 0.6, 0.06), F.chalkViolet()); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.014, dz * (S?.z ?? 2.4) * 0.25); g.add(m); }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, (S?.z ?? 2.4) * 0.6), F.chalkViolet()); m.rotation.x = -Math.PI / 2; m.position.y = 0.014; g.add(m);
      return true;
    }
    case "quadro": { // armário elétrico de piso (encostado na parede)
      g.add(rb(1.1, 2.0, 0.42, F.paintGreen(), 0, 1.0, -0.21));
      g.add(box(1.0, 1.8, 0.02, DM.darkSteel(), 0, 1.05, 0.005));
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), basic(`qlamp-${d.id}`, { color: 0xff7a30 })); lamp.position.set(0.35, 1.8, 0.03); g.add(lamp);
      const handle = box(0.05, 0.22, 0.05, DM.steel(), 0.4, 1.1, 0.04); g.add(handle);
      g.add(cyl(0.05, 0.05, 3, 8, DM.darkSteel(), -0.4, 3.5, -0.3)); // eletroduto até o teto
      g.userData.lamp = lamp;
      return true;
    }
    case "floorGrate": { // grelha de piso do filtro (respiradouro por onde os Riscadores sobem)
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.6), F.dark()); dark.rotation.x = -Math.PI / 2; dark.position.y = 0.002; g.add(dark);
      const gr = box(1.2, 0.04, 2.7, std("f3grate", { map: TX.texGrate(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }), 0, 0.02, 0); g.add(gr);
      g.userData.grate = gr;
      return true;
    }
    case "pump": { // bomba: base, motor horizontal, voluta, volante (gira ao ligar), lâmpada de estado
      const w = S?.x ?? 3.6, h = S?.y ?? 2.6, dd = S?.z ?? 3.0;
      g.add(rb(w, 0.35, dd, DM.darkSteel(), 0, 0.175, 0, 0.06));
      const motor = cyl(h * 0.32, h * 0.32, w * 0.62, 20, F.paintGreen(), -w * 0.12, 0.35 + h * 0.34, -dd * 0.1); motor.rotation.z = Math.PI / 2; g.add(motor);
      for (let i = 0; i < 6; i++) { const fin = cyl(h * 0.34, h * 0.34, 0.03, 20, DM.darkSteel(), -w * 0.4 + i * w * 0.1, 0.35 + h * 0.34, -dd * 0.1); fin.rotation.z = Math.PI / 2; g.add(fin); }
      const vol = new THREE.Mesh(new THREE.TorusGeometry(h * 0.22, h * 0.12, 10, 20), F.paintRed()); vol.position.set(w * 0.32, 0.35 + h * 0.34, -dd * 0.1); vol.rotation.y = Math.PI / 2; g.add(vol);
      g.add(cyl(0.16, 0.16, h, 10, DM.rust(), w * 0.32, 0.35 + h * 0.34 + h / 2, -dd * 0.1));
      // volante na frente (+z): Lia gira para ligar
      const wheel = new THREE.Group(); wheel.position.set(0, 0.35 + h * 0.38, dd / 2 + 0.06);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 20), F.paintRed()); wheel.add(rim);
      for (let i = 0; i < 3; i++) { const sp = box(0.62, 0.035, 0.035, DM.steel()); sp.rotation.z = (i * Math.PI) / 3; wheel.add(sp); }
      g.add(wheel, cyl(0.04, 0.04, 0.3, 8, DM.steel(), 0, 0.35 + h * 0.38, dd / 2 - 0.1)).children.at(-1)!.rotation.x = Math.PI / 2;
      g.add(rb(0.5, 0.5 + h * 0.38, 0.3, DM.darkSteel(), 0, (0.5 + h * 0.38) / 2, dd / 2 - 0.25));
      // lâmpada de estado embutida na frente do pedestal do volante (antes ficava no ar diante da base)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), basic(`plamp-${d.id}`, { color: 0xff3a20 })); lamp.position.set(0.16, 0.5, dd / 2 - 0.07); g.add(lamp);
      g.add(cyl(0.085, 0.085, 0.05, 10, DM.darkSteel(), 0.16, 0.5, dd / 2 - 0.085)).children.at(-1)!.rotation.x = Math.PI / 2;
      // plaqueta na face da base
      const tag = signMesh(d.id === "bomba2" ? "BOMBA 2" : "BOMBA 1", 0xffb060, Math.min(0.9, w * 0.3)); tag.scale.y = 0.8; tag.position.set(-w * 0.25, 0.175, dd / 2 + 0.006); g.add(tag);
      g.userData.wheel = wheel; g.userData.lamp = lamp;
      return true;
    }
    case "jet": { // bocal do jato (sai da lateral da bomba 1)
      const n = cyl(0.09, 0.14, 0.4, 10, DM.brass()); n.rotation.x = Math.PI / 2; n.position.z = 0.2; g.add(n);
      g.add(cyl(0.18, 0.18, 0.05, 10, DM.darkSteel(), 0, 0, 0.02)).children.at(-1)!.rotation.x = Math.PI / 2;
      // cano de alimentação: cotovelo atrás do flange e descida até o piso, com placa de fixação na parede
      const hy = d.pos.y;
      g.add(cyl(0.11, 0.11, 0.16, 10, DM.rust(), 0, 0, -0.06)).children.at(-1)!.rotation.x = Math.PI / 2;
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), DM.rust())).children.at(-1)!.position.set(0, 0, -0.14);
      g.add(cyl(0.11, 0.11, hy, 10, DM.rust(), 0, -hy / 2, -0.14));
      g.add(box(0.36, 0.36, 0.03, DM.darkSteel(), 0, 0, -0.005));
      return true;
    }
    case "gauges": { // painel de manômetros na parede, com placa e tubos até a parede
      g.add(rb(1.3, 0.7, 0.06, DM.darkSteel(), 0, 0, -0.2));
      for (const x of [-0.6, 0.6]) g.add(box(0.06, 0.06, 0.2, DM.darkSteel(), x, 0, -0.1)); // espaçadores até a parede
      const ds: THREE.Group[] = [];
      [-0.4, 0, 0.4].forEach((x) => { const dd = dial(0.15); dd.position.set(x, 0.05, -0.15); g.add(dd); ds.push(dd); g.add(cyl(0.025, 0.025, 0.5, 6, DM.brass(), x, -0.45, -0.17)); });
      g.userData.dials = ds;
      return true;
    }
    case "wallLamp": { // arandela com grade; acende com a bomba 2
      g.add(box(0.22, 0.32, 0.04, DM.darkSteel(), 0, 0, 0.02));
      g.add(box(0.06, 0.06, 0.22, DM.darkSteel(), 0, 0, 0.13));
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), F.lampOff()); bulb.position.set(0, 0, 0.3); g.add(bulb);
      const cage = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), std("cage", { color: 0x222, wireframe: true })); cage.position.copy(bulb.position); g.add(cage);
      g.userData.bulb = bulb;
      return true;
    }
    case "well": { // poço central: boca de concreto, água escura funda
      g.add(cyl(2.35, 2.35, 0.12, 32, DM.darkSteel(), 0, 0.02, 0));
      const water = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), F.water()); water.rotation.x = -Math.PI / 2; water.position.y = 0.09; g.add(water);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.12, 8, 40), F.tank()); rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim);
      return true;
    }
    case "railRing": { // trilho circular no teto: o Badalo corre nele; tirantes até a laje
      const ring = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.09, 6, 72), DM.darkSteel()); ring.rotation.x = Math.PI / 2; g.add(ring);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.add(box(0.06, 0.42, 0.06, DM.darkSteel(), Math.cos(a) * 8.5, 0.2, Math.sin(a) * 8.5)); }
      const hub = cyl(0.5, 0.5, 0.3, 16, DM.rust(), 0, 0.25, 0); g.add(hub);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; const arm = box(8.5, 0.08, 0.1, DM.darkSteel(), Math.cos(a) * 4.25, 0.3, Math.sin(a) * 4.25); arm.rotation.y = -a; g.add(arm); }
      return true;
    }
    case "plate": { // placa de pressão (o sino crava aqui): disco de aço e anel de advertência
      g.add(cyl(1.7, 1.75, 0.04, 32, DM.steel(), 0, 0.02, 0));
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.7, 32), F.hazard()); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.045; g.add(ring);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(cyl(0.05, 0.05, 0.02, 6, DM.darkSteel(), Math.cos(a) * 1.2, 0.05, Math.sin(a) * 1.2)); }
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.25, 16), basic(`platelamp-${d.id}`, { color: 0x401010 })); lamp.rotation.x = -Math.PI / 2; lamp.position.y = 0.046; g.add(lamp);
      g.userData.lamp = lamp;
      return true;
    }
    case "dispenser": { // dispensador de dardos na parede (recarga com intervalo)
      g.add(rb(0.7, 1.0, 0.36, F.paintGreen(), 0, 0, 0.18));
      g.add(box(0.4, 0.1, 0.1, DM.darkSteel(), 0, -0.25, 0.38));
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), basic(`displamp`, { color: 0x40ff70 })); lamp.position.set(0.22, 0.38, 0.37); g.add(lamp);
      const tag = signMesh("DARDOS", 0x7ff6ff, 0.5); tag.position.set(0, 0.25, 0.365); g.add(tag);
      g.add(box(0.12, 1.3, 0.12, DM.darkSteel(), 0, -1.15, 0.12)); // coluna até o piso
      g.userData.lamp = lamp;
      return true;
    }
    case "tunnelWater": { // lâmina d'água do túnel; escoa quando o chefe cai
      const p = new THREE.Mesh(new THREE.PlaneGeometry(S?.x ?? 20, S?.z ?? 3), F.water()); p.rotation.x = -Math.PI / 2; p.position.y = 0.22; g.add(p);
      g.userData.water = p;
      return true;
    }
    case "manhole": { // tampa de visita no piso; a da saída tem escada até a boca no teto
      const lid = cyl(0.5, 0.5, 0.04, 20, DM.rust(), 0, 0.02, 0); g.add(lid);
      for (let i = -2; i <= 2; i++) g.add(box(0.8, 0.012, 0.04, DM.darkSteel(), 0, 0.045, i * 0.15));
      if (d.id === "boca-de-visita") {
        lid.position.set(-0.6, 0.02, 0.4);
        for (const z of [-0.25, 0.25]) g.add(box(0.05, 3, 0.05, DM.steel(), 1.25, 1.5, z));
        for (let y = 0.3; y < 3; y += 0.3) g.add(box(0.04, 0.04, 0.5, DM.steel(), 1.25, y, 0));
        const sky = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), basic("manholeSky", { color: 0xb8d8e8 })); sky.rotation.x = Math.PI / 2; sky.position.set(1.0, 2.98, 0); g.add(sky);
      }
      return true;
    }
  }
  return false;
}
