import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Caixa com cantos arredondados (bisel): tira o aspecto de blocos das armas em primeira pessoa. */
function rbox(w: number, h: number, d: number, r = 0.008): THREE.BufferGeometry {
  const rr = Math.min(r, Math.min(w, h, d) * 0.3);
  return rr < 0.0015 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, rr);
}
import { remapUV, signAtlas, texFish, texGlow, texSign, texVeins } from "./textures";

const ceramic = () => new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.35, metalness: 0.05, flatShading: true, emissive: 0x000000 });
const darkCeramic = () => new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.5, flatShading: true });
export const rimMat = (color = 0x6ff0ff) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });

/**
 * Junta, por material, as peças fixas filhas diretas de `root` (as animadas ficam de fora): o mesmo desenho
 * com bem menos chamadas de desenho para as armas detalhadas.
 */
function mergeByMaterial(root: THREE.Object3D, keep: Set<THREE.Object3D>) {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const o of root.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || keep.has(m) || Array.isArray(m.material)) continue;
    const a = m.geometry.attributes;
    if (!a.position || !a.normal || !a.uv || Object.keys(a).length !== 3 || !m.geometry.index) continue;
    const arr = groups.get(m.material as THREE.Material) ?? []; arr.push(m); groups.set(m.material as THREE.Material, arr);
  }
  for (const [mat, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); }
    root.add(new THREE.Mesh(merged, mat));
  }
}

export type { CreatureRig } from "./creatures3d";
export { buildRiscador, buildEstilhaco, buildVeu, buildCarapaca, buildBadalo, compactRig } from "./creatures3d";

/** Agulha em primeira pessoa: trilho, aletas de dissipação, bobinas, mira com ponto e indicador de dardos. */
export function buildAgulha(): WeaponView {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x4c565e, roughness: 0.38, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.6, metalness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a7656, roughness: 0.45, metalness: 0.7 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.92 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x173238, emissive: 0x39d8ff, emissiveIntensity: 1.6, roughness: 0.2 });
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };
  // receptor
  add(root, rbox(0.07, 0.085, 0.42), body, 0, 0, 0);
  add(root, rbox(0.074, 0.02, 0.36), dark, 0, -0.045, -0.01);
  for (let i = 0; i < 5; i++) add(root, rbox(0.078, 0.022, 0.012), dark, 0, 0.02, -0.06 - i * 0.03); // aletas
  // ferrolho que recua no disparo
  const slide = new THREE.Group(); root.add(slide);
  add(slide, rbox(0.075, 0.03, 0.3), trim, 0, 0.055, -0.02);
  add(slide, rbox(0.02, 0.018, 0.04), dark, 0.04, 0.055, 0.09);
  // trilho e mira com ponto
  for (let i = 0; i < 6; i++) add(root, rbox(0.03, 0.008, 0.018), dark, 0, 0.074, -0.1 + i * 0.035);
  add(root, rbox(0.036, 0.034, 0.05), dark, 0, 0.094, 0.03);
  add(root, new THREE.CylinderGeometry(0.016, 0.016, 0.052, 10), dark, 0, 0.098, 0.03, Math.PI / 2);
  add(root, new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5040, toneMapped: false }), 0, 0.098, 0.004);
  add(root, rbox(0.015, 0.03, 0.02), trim, 0, 0.085, -0.15);
  // cano, bobinas e quebra-chama
  add(root, new THREE.CylinderGeometry(0.012, 0.016, 0.32, 8), body, 0, 0.01, -0.36, Math.PI / 2);
  add(root, new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8), trim, 0, 0.01, -0.5, Math.PI / 2);
  for (let i = 0; i < 3; i++) add(root, rbox(0.006, 0.05, 0.03), dark, 0, 0.01, -0.5, 0, 0, (i * Math.PI) / 3);
  const coils: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) coils.push(add(root, new THREE.TorusGeometry(0.03, 0.007, 6, 14), glow, 0, 0.01, -0.24 - i * 0.05));
  add(root, rbox(0.01, 0.01, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 }), -0.03, -0.025, -0.3); // cabo de energia
  // empunhadura, guarda-mato e coronha
  add(root, rbox(0.05, 0.12, 0.07), grip, 0, -0.09, 0.12, 0.3);
  add(root, new THREE.TorusGeometry(0.03, 0.006, 4, 10, Math.PI), dark, 0, -0.055, 0.07, 0, Math.PI / 2, 0);
  add(root, rbox(0.06, 0.05, 0.16), body, 0, -0.005, 0.27);
  add(root, rbox(0.066, 0.075, 0.03), grip, 0, -0.012, 0.35);
  add(root, rbox(0.03, 0.03, 0.02), trim, 0, 0.08, 0.1);
  // indicador de dardos (6 segmentos) no flanco esquerdo
  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) leds.push(add(root, rbox(0.004, 0.012, 0.018), new THREE.MeshBasicMaterial({ color: 0x39d8ff, toneMapped: false }), -0.037, 0.022, 0.05 - i * 0.024));
  // cápsula de dardos (sai na recarga)
  const magMat = new THREE.MeshStandardMaterial({ color: 0x0c2a30, emissive: 0x39d8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.85, roughness: 0.1 });
  const mag = new THREE.Group(); mag.position.set(0.045, 0.0, -0.06); root.add(mag);
  add(mag, new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), magMat, 0, 0, 0, Math.PI / 2);
  add(mag, new THREE.CylinderGeometry(0.029, 0.029, 0.02, 10), trim, 0, 0, 0.08, Math.PI / 2);
  // mãos/luvas
  const glove = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.95 });
  add(root, rbox(0.075, 0.07, 0.11), glove, 0, -0.1, 0.13, 0.3);
  add(root, rbox(0.09, 0.09, 0.32), sleeve, 0.02, -0.15, 0.33, 0.25);
  const hand = new THREE.Group(); hand.position.set(-0.03, -0.03, -0.24); root.add(hand);
  add(hand, rbox(0.07, 0.06, 0.1), glove, 0, 0, 0, 0, 0, 0.4);
  add(hand, rbox(0.085, 0.085, 0.36), sleeve, -0.07, -0.09, 0.19, 0.1, -0.55, 0.2);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.54); root.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow(), color: 0x8ff4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(0.18); flash.position.copy(muzzle.position); flash.visible = false; root.add(flash);
  mergeByMaterial(root, new Set<THREE.Object3D>([...coils, ...leds]));
  root.traverse((o) => { o.frustumCulled = false; });
  return { root, mag, coils, muzzle, flash, magMat, slide, leds, hand };
}

/** Emissor da baliza (mão esquerda e mundo). */
export function buildBeaconDevice(): { root: THREE.Group; light: THREE.Mesh } {
  const root = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.6, metalness: 0.5 });
  const cer = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.55, metalness: 0.3, emissive: 0x0d3440, emissiveIntensity: 0.6 });
  const a = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 8), shell);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), cer); b.position.y = 0.09;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({ color: 0x7ff6ff }));
  light.position.set(0, 0.04, 0.065);
  const fins = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 4, 12), shell); fins.rotation.x = Math.PI / 2; fins.position.y = -0.03;
  root.add(a, b, light, fins);
  return { root, light };
}

export function buildPickup(kind: "dardos" | "curativo" | "fole" | "tear"): THREE.Group {
  const g = new THREE.Group();
  if (kind === "tear") {
    // carretel de fio do Tear: bobina violeta em caixa estreita
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3), new THREE.MeshStandardMaterial({ color: 0x2f2a3c, roughness: 0.6, metalness: 0.4 }));
    box.position.y = 0.13;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.44, 0.26, 0.32)), new THREE.LineBasicMaterial({ color: 0xc89bff }));
    edges.position.y = 0.13;
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.13), new THREE.MeshBasicMaterial({ map: texSign("╪ TEAR", "#d0a8ff", 512, 128), transparent: true }));
    icon.position.set(0, 0.15, 0.155);
    g.add(box, edges, icon);
  } else if (kind === "fole") {
    // caixa de cartuchos do Fole: lata âmbar com seis furos no tampo
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.34), new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.55, metalness: 0.5 }));
    box.position.y = 0.14;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.48, 0.28, 0.36)), new THREE.LineBasicMaterial({ color: 0xffb050 }));
    edges.position.y = 0.14;
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.14), new THREE.MeshBasicMaterial({ map: texSign("◆◆ FOLE", "#ffc070", 512, 128), transparent: true }));
    icon.position.set(0, 0.16, 0.175);
    g.add(box, edges, icon);
  } else if (kind === "dardos") {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.32), new THREE.MeshStandardMaterial({ color: 0x2c4650, roughness: 0.6, metalness: 0.4 }));
    box.position.y = 0.14;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.52, 0.3, 0.34)), new THREE.LineBasicMaterial({ color: 0x5ff0ff }));
    edges.position.y = 0.14;
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.14), new THREE.MeshBasicMaterial({ map: texSign("▮▮▮ DARDOS", "#7ff6ff", 512, 128), transparent: true }));
    icon.position.set(0, 0.16, 0.165);
    g.add(box, edges, icon);
  } else {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 4, 10), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.4 }));
    body.rotation.z = Math.PI / 2; body.position.y = 0.14;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.08, 12), new THREE.MeshBasicMaterial({ color: 0xffa23a }));
    band.rotation.z = Math.PI / 2; band.position.y = 0.14;
    g.add(body, band);
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color: kind === "dardos" ? 0x5ff0ff : kind === "fole" ? 0xffc070 : kind === "tear" ? 0xc89bff : 0xffa23a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.02;
  g.add(halo);
  g.userData.halo = halo;
  return g;
}

export function buildFerry(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x5a2a22, roughness: 0.7, metalness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xb9b6ab, roughness: 0.6 });
  const h = new THREE.Mesh(new THREE.BoxGeometry(44, 4, 11), hull); h.position.y = 1.5;
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 4, 3, 1, false, 0, Math.PI), hull); bow.rotation.y = -Math.PI / 2; bow.position.set(-22, 1.5, 0); bow.scale.set(1, 1, 1.4);
  const deck1 = new THREE.Mesh(new THREE.BoxGeometry(30, 3, 9.5), white); deck1.position.set(2, 5, 0);
  const deck2 = new THREE.Mesh(new THREE.BoxGeometry(14, 2.4, 8), white); deck2.position.set(6, 7.7, 0);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.3, 4, 10), new THREE.MeshStandardMaterial({ color: 0xc8a030, roughness: 0.6 })); funnel.position.set(9, 10.5, 0);
  g.add(h, bow, deck1, deck2, funnel);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1a120c });
  for (let i = 0; i < 18; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), winMat);
    w.position.set(-12 + i * 1.6, 5.2, 4.76);
    g.add(w);
    if (i % 3 !== 1) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.8), shadowMat); // passageiros cobrindo as janelas
      p.position.set(-12 + i * 1.6 + (i % 2 ? 0.2 : -0.2), 5.05, 4.77);
      g.add(p);
    }
  }
  for (let i = 0; i < 7; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), winMat); w.position.set(1 + i * 1.7, 7.8, 4.01); g.add(w); }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6), white); mast.position.set(-6, 9.5, 0); g.add(mast);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xff3030 })); lamp.position.set(-6, 12.6, 0); g.add(lamp);
  g.userData.lamp = lamp;
  return g;
}

let atlasBasic: THREE.MeshBasicMaterial | null = null;
/** Material único das placas (atlas): todas viram uma chamada de desenho depois da mesclagem. */
function signAtlasMat(tex: THREE.Texture) { return atlasBasic ??= new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); }
export function signMesh(text: string, color: number, width?: number): THREE.Mesh {
  const hex = "#" + color.toString(16).padStart(6, "0");
  const w = width ?? Math.max(1.4, text.length * 0.2);
  const geo = new THREE.PlaneGeometry(w, 0.32);
  const at = signAtlas(text, hex);
  if (at) { remapUV(geo, at.uv); return new THREE.Mesh(geo, signAtlasMat(at.tex)); }
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texSign(text, hex), toneMapped: false }));
}

export function fishDoor(): THREE.Group {
  const g = new THREE.Group();
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshStandardMaterial({ color: 0x24333c, roughness: 0.5, metalness: 0.5 }));
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: texFish(), toneMapped: false }));
  icon.position.set(0, 0.35, 0.01);
  door.position.y = -0.2;
  g.add(door, icon);
  return g;
}

export interface WeaponView {
  root: THREE.Group; mag: THREE.Object3D; coils: THREE.Mesh[]; muzzle: THREE.Object3D; flash: THREE.Sprite; magMat: THREE.MeshStandardMaterial;
  /** peças animadas */
  slide?: THREE.Object3D; leds: THREE.Mesh[]; bellows?: THREE.Object3D; hand?: THREE.Object3D; vents?: THREE.Mesh[];
}

/** Fole: espingarda de fole — boca larga com seis aletas, fole de couro que comprime no disparo, ferragens de latão. */
export function buildFoleModel(): WeaponView {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.5, metalness: 0.55 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xa8843c, roughness: 0.35, metalness: 0.85 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.85, metalness: 0.0, flatShading: true });
  const glow = new THREE.MeshStandardMaterial({ color: 0x40220c, emissive: 0xffa040, emissiveIntensity: 1.4, roughness: 0.3 });
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); parent.add(o); return o; };
  // receptor e coronha curta
  add(root, rbox(0.085, 0.1, 0.26), body, 0, 0, 0.06);
  add(root, rbox(0.06, 0.13, 0.08), body, 0, -0.1, 0.16, 0.35);
  add(root, rbox(0.07, 0.07, 0.14), body, 0, -0.01, 0.26);
  // fole sanfonado (anima no disparo)
  const bellows = new THREE.Group(); bellows.position.set(0, 0.005, -0.12); root.add(bellows);
  for (let i = 0; i < 5; i++) add(bellows, new THREE.CylinderGeometry(0.05 + (i % 2) * 0.012, 0.05 + (i % 2) * 0.012, 0.028, 8), leather, 0, 0, -i * 0.026, Math.PI / 2);
  add(root, new THREE.TorusGeometry(0.055, 0.009, 6, 14), brass, 0, 0.005, -0.1);
  add(root, new THREE.TorusGeometry(0.055, 0.009, 6, 14), brass, 0, 0.005, -0.26);
  // cano e boca em leque com seis aletas
  add(root, new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), body, 0, 0.005, -0.34, Math.PI / 2);
  const bell = add(root, new THREE.CylinderGeometry(0.075, 0.035, 0.09, 12, 1, true), brass, 0, 0.005, -0.46, Math.PI / 2);
  (bell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const vents: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; vents.push(add(root, rbox(0.008, 0.03, 0.05), glow, Math.cos(a) * 0.06, 0.005 + Math.sin(a) * 0.06, -0.47, 0, 0, a)); }
  // indicador de cartuchos (8 luzes) no flanco
  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) leds.push(add(root, rbox(0.006, 0.012, 0.014), new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false }), 0.044, 0.03, 0.12 - i * 0.02));
  // tubo de munição sob o cano (vira o "mag" para a recarga)
  const magMat = new THREE.MeshStandardMaterial({ color: 0x3a2410, emissive: 0xffa040, emissiveIntensity: 0.6, roughness: 0.4 });
  const mag = add(root, new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), magMat, 0, -0.06, -0.15, Math.PI / 2);
  // alça de bombear e mão esquerda
  const hand = new THREE.Group(); hand.position.set(0, -0.07, -0.22); root.add(hand);
  add(hand, rbox(0.07, 0.05, 0.1), body, 0, 0, 0);
  const glove = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.95 });
  add(hand, rbox(0.08, 0.07, 0.1), glove, -0.02, -0.04, 0, 0, 0, 0.4);
  add(hand, rbox(0.085, 0.085, 0.36), sleeve, -0.08, -0.09, 0.18, 0.1, -0.55, 0.2);
  add(root, rbox(0.075, 0.07, 0.11), glove, 0, -0.11, 0.17, 0.3);
  add(root, rbox(0.09, 0.09, 0.32), sleeve, 0.02, -0.16, 0.37, 0.25);
  const coils = [...vents];
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, -0.52); root.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow(), color: 0xffc080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(0.3); flash.position.copy(muzzle.position); flash.visible = false; root.add(flash);
  root.traverse((o) => { o.frustumCulled = false; });
  mergeByMaterial(root, new Set<THREE.Object3D>([...vents, ...leds]));
  root.traverse((o) => { o.frustumCulled = false; });
  return { root, mag, coils, muzzle, flash, magMat, leds, bellows, hand, vents };
}


/**
 * Tear: tear de mão — dois braços em forquilha com o fio de luz esticado entre eles, carretel violeta
 * (o "pente" que sai na recarga) e doze contas que mostram as cargas.
 */
export function buildTearModel(): WeaponView {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x3c3a44, roughness: 0.45, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.7, metalness: 0.05 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x7a7c84, roughness: 0.35, metalness: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x2a1840, emissive: 0xb07aff, emissiveIntensity: 1.5, roughness: 0.3 });
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); parent.add(o); return o; };
  // corpo, cabo de madeira e coronha curta
  add(root, rbox(0.07, 0.08, 0.34, 0.012), body, 0, 0, 0);
  add(root, rbox(0.05, 0.13, 0.07, 0.012), wood, 0, -0.1, 0.12, 0.3);
  add(root, rbox(0.06, 0.075, 0.16, 0.014), wood, 0, -0.02, 0.24);
  // forquilha: dois braços e o fio esticado
  for (const side of [-1, 1]) {
    add(root, new THREE.CylinderGeometry(0.011, 0.014, 0.26, 8), steel, side * 0.045, 0.01, -0.28, Math.PI / 2, 0, 0);
    add(root, new THREE.SphereGeometry(0.016, 8, 6), steel, side * 0.045, 0.01, -0.41);
  }
  const coils: THREE.Mesh[] = [];
  coils.push(add(root, new THREE.CylinderGeometry(0.0035, 0.0035, 0.09, 6), glow, 0, 0.01, -0.41, 0, 0, Math.PI / 2));
  coils.push(add(root, new THREE.CylinderGeometry(0.0025, 0.0025, 0.24, 6), glow, 0, 0.01, -0.3, Math.PI / 2, 0, 0));
  // pentes guia
  for (let i = 0; i < 4; i++) add(root, rbox(0.1, 0.012, 0.012, 0.004), steel, 0, 0.012, -0.18 - i * 0.055);
  // carretel (sai na recarga)
  const magMat = new THREE.MeshStandardMaterial({ color: 0x241634, emissive: 0xb07aff, emissiveIntensity: 0.8, roughness: 0.4 });
  const mag = add(root, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 14), magMat, 0, 0.07, 0.03, 0, 0, Math.PI / 2);
  add(root, new THREE.TorusGeometry(0.037, 0.006, 6, 16), steel, 0.027, 0.07, 0.03, 0, Math.PI / 2, 0);
  add(root, new THREE.TorusGeometry(0.037, 0.006, 6, 16), steel, -0.027, 0.07, 0.03, 0, Math.PI / 2, 0);
  // contas das cargas (12) no flanco
  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) leds.push(add(root, new THREE.SphereGeometry(0.0055, 6, 4), new THREE.MeshBasicMaterial({ color: 0xb07aff, toneMapped: false }), 0.038, -0.012, 0.13 - i * 0.017));
  // mão de apoio e mangas
  const hand = new THREE.Group(); hand.position.set(0, -0.06, -0.12); root.add(hand);
  const glove = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.95 });
  add(hand, rbox(0.08, 0.06, 0.1, 0.02), glove, -0.015, -0.01, 0, 0, 0, 0.4);
  add(hand, new THREE.CapsuleGeometry(0.042, 0.28, 4, 8), sleeve, -0.08, -0.07, 0.18, Math.PI / 2 + 0.1, -0.55, 0.2);
  add(root, rbox(0.07, 0.07, 0.1, 0.02), glove, 0, -0.11, 0.14, 0.3);
  add(root, new THREE.CapsuleGeometry(0.045, 0.26, 4, 8), sleeve, 0.02, -0.16, 0.34, Math.PI / 2 + 0.25, 0, 0);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.42); root.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow(), color: 0xc8a0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(0.16); flash.position.copy(muzzle.position); flash.visible = false; root.add(flash);
  mergeByMaterial(root, new Set<THREE.Object3D>([...coils, ...leds, mag]));
  root.traverse((o) => { o.frustumCulled = false; });
  return { root, mag, coils, muzzle, flash, magMat, leds, hand };
}
