import * as THREE from "three";
import { texFish, texGlow, texSign, texVeins } from "./textures";

const ceramic = () => new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.35, metalness: 0.05, flatShading: true, emissive: 0x000000 });
const darkCeramic = () => new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.5, flatShading: true });
export const rimMat = (color = 0x6ff0ff) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });

export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Object3D;
  legs: THREE.Object3D[];
  rims: THREE.Mesh[];
  crown: THREE.Object3D[];
  core: THREE.Mesh | null;
  /** cascas (lampejo de impacto pelo emissivo) */
  mats: THREE.MeshStandardMaterial[];
  mark: THREE.Object3D;
  beam?: THREE.Mesh;
  /** cabeça (reação a tiros altos) */
  head?: THREE.Object3D;
  /** peças que se estilhaçam ao morrer */
  pieces: THREE.Mesh[];
  /** Véu: saco que incha e fita ondulante */
  sac?: THREE.Mesh;
  ribbon?: THREE.Mesh;
  uniforms?: { uTime: { value: number }; uSwell: { value: number } };
  veinColor: THREE.Color;
}

/** Cristal vivo: casca facetada translúcida com veias de luz pulsando por baixo. */
function crystal(color: number, vein: number): THREE.MeshStandardMaterial {
  const veins = texVeins();
  return new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.15, flatShading: true, emissive: vein, emissiveMap: veins, emissiveIntensity: 1.4, envMapIntensity: 1.0 });
}

function leg(len1: number, len2: number, mat: THREE.Material, joint?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.026, len1, 4), mat);
  upper.position.y = -len1 / 2;
  const knee = new THREE.Group(); knee.position.y = -len1;
  if (joint) { const j = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), joint); knee.add(j); }
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.004, len2, 4), mat);
  lower.position.y = -len2 / 2;
  knee.add(lower);
  g.add(upper, knee);
  g.userData.knee = knee;
  return g;
}

function markRing(): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.95, depthTest: false }));
  m.renderOrder = 10;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 4, 24), new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.8, depthTest: false }));
  ring.rotation.x = Math.PI / 2; ring.renderOrder = 10;
  g.add(m, ring); g.visible = false;
  return g;
}

function collectPieces(body: THREE.Object3D, legs: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  body.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) out.push(m); });
  for (const l of legs) l.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) out.push(m); });
  return out;
}

/** Riscador: quadrúpede de cristal, carapaça facetada com espinhos translúcidos e veias ciano. */
export function buildRiscador(): CreatureRig {
  const root = new THREE.Group();
  const mat = crystal(0x7d97a2, 0x3fd8ff);
  const dmat = new THREE.MeshStandardMaterial({ color: 0x2c3236, roughness: 0.35, metalness: 0.3, flatShading: true });
  const body = new THREE.Group();
  body.position.y = 0.62;
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat);
  shell.scale.set(0.78, 0.52, 1.25);
  const ridge = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), mat); ridge.scale.set(0.35, 0.5, 1.5); ridge.position.set(0, 0.16, 0.05);
  const belly = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), dmat);
  belly.scale.set(0.8, 0.5, 1.1); belly.position.y = -0.1;
  const head = new THREE.Group(); head.position.set(0, 0.04, -0.5);
  const skull = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 5), mat); skull.rotation.x = -Math.PI / 2; skull.position.z = -0.12;
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.25), new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
  mouth.position.set(0, -0.07, -0.2);
  for (const side of [-1, 1]) {
    const mand = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28, 4), dmat); mand.rotation.set(-Math.PI / 2 + 0.2, 0, side * 0.35); mand.position.set(side * 0.1, -0.08, -0.3); head.add(mand);
    const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), new THREE.MeshBasicMaterial({ color: 0x9ff8ff, toneMapped: false })); eye.position.set(side * 0.09, 0.06, -0.12); head.add(eye);
  }
  head.add(skull, mouth);
  body.add(shell, ridge, belly, head);
  // espinhos translúcidos (vibram antes do ataque)
  const rims: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const rim = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.36 + (i % 3) * 0.08, 4, 1, true), rimMat());
    rim.position.set((i % 2 ? 0.08 : -0.08), 0.22, 0.38 - i * 0.15);
    rim.rotation.set(-0.55, 0, (i % 2 ? -0.25 : 0.25));
    body.add(rim); rims.push(rim);
  }
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), rimMat());
    fin.position.set(side * 0.3, 0.05, 0.05); fin.rotation.set(0, side * 0.2, side * 0.6);
    body.add(fin); rims.push(fin);
  }
  root.add(body);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.26, -0.35], [0.26, -0.35], [-0.26, 0.38], [0.26, 0.38]]) {
    const l = leg(0.42, 0.55, mat, dmat);
    l.position.set(x, 0.62, z);
    l.rotation.z = x > 0 ? 0.7 : -0.7;
    (l.userData.knee as THREE.Object3D).rotation.z = x > 0 ? -1.4 : 1.4;
    root.add(l); legs.push(l);
  }
  const mark = markRing(); mark.position.y = 1.35; root.add(mark);
  return { root, body, legs, rims, crown: [], core: null, mats: [mat], mark, head, pieces: collectPieces(body, legs), veinColor: new THREE.Color(0x3fd8ff) };
}

/** Estilhaço: alto, coroa de placas de cristal que abre e mostra a linha de luz; veias âmbar. */
export function buildEstilhaco(): CreatureRig {
  const root = new THREE.Group();
  const mat = crystal(0xa08c78, 0xff8a3a);
  const dmat = new THREE.MeshStandardMaterial({ color: 0x302a26, roughness: 0.4, metalness: 0.3, flatShading: true });
  const body = new THREE.Group();
  body.position.y = 1.15;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.95, 6), mat);
  const ribs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.5, 6, 1, true), dmat); ribs.position.y = -0.05; ribs.scale.set(1.08, 1, 1.08);
  const pelvis = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), dmat); pelvis.position.y = -0.52; pelvis.scale.y = 0.6;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.3, 5), dmat); neck.position.y = 0.6;
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), new THREE.MeshBasicMaterial({ color: 0xff8040 }));
  core.position.y = 0.82;
  const head = new THREE.Group(); head.position.y = 0.82; // a coroa e o núcleo formam a "cabeça"
  body.add(torso, ribs, pelvis, neck, core, head);
  for (const side of [-1, 1]) { // braços-lâmina
    const arm = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.7, 4), mat); arm.position.set(side * 0.3, 0.1, 0.05); arm.rotation.set(0.2, 0, side * 2.9); body.add(arm);
  }
  const crown: THREE.Object3D[] = [];
  for (let i = 0; i < 7; i++) {
    const piv = new THREE.Group();
    piv.position.y = 0.78; piv.rotation.y = (i / 7) * Math.PI * 2;
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 3), mat);
    shard.position.set(0, 0.27, 0.12);
    const edge = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.6, 3, 1, true), rimMat(0xffb070));
    edge.position.copy(shard.position);
    piv.add(shard, edge);
    piv.rotation.x = 0.1;
    body.add(piv); crown.push(piv);
  }
  const rims: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.8), rimMat(0xffb070));
    plate.position.set(side * 0.22, 0.05, 0); plate.rotation.y = side * 0.4;
    body.add(plate); rims.push(plate);
  }
  root.add(body);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.18, 0.05], [0.18, 0.05], [0, -0.2]]) {
    const l = leg(0.45, 0.6, mat, dmat);
    l.position.set(x, 0.66, z);
    l.rotation.z = x * 1.2; l.rotation.x = z * 1.5;
    (l.userData.knee as THREE.Object3D).rotation.x = 0.5;
    root.add(l); legs.push(l);
  }
  const mark = markRing(); mark.position.y = 2.45; root.add(mark);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = false;
  return { root, body, legs, rims, crown, core, mats: [mat], mark, beam, head, pieces: collectPieces(body, legs), veinColor: new THREE.Color(0xff8a3a) };
}

/** Véu: flutuador em fita. Um saco translúcido que incha e uma fita longa que ondula (no shader). */
export function buildVeu(): CreatureRig {
  const root = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uSwell: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xbfd6d0, roughness: 0.3, metalness: 0.05, emissive: 0x5fe8c8, emissiveMap: texVeins(), emissiveIntensity: 0.7, transparent: true, opacity: 0.82, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uSwell = uniforms.uSwell;
    sh.vertexShader = "uniform float uTime; uniform float uSwell;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
  float k = clamp(-position.y / 2.6, 0.0, 1.0);
  transformed.x += sin(position.y * 2.6 + uTime * 3.1) * 0.22 * k + sin(uTime * 1.3) * 0.05;
  transformed.z += cos(position.y * 1.9 + uTime * 2.3) * 0.18 * k * (1.0 + uSwell);`);
  };
  const body = new THREE.Group(); body.position.y = 1.0;
  const sacMat = new THREE.MeshStandardMaterial({ color: 0x9fc8c0, roughness: 0.2, emissive: 0x5fe8c8, emissiveMap: texVeins(), emissiveIntensity: 1.0, transparent: true, opacity: 0.7, depthWrite: false, flatShading: true });
  const sac = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), sacMat); sac.scale.set(1, 0.8, 1);
  const ribbonGeo = new THREE.PlaneGeometry(0.42, 2.6, 1, 24); ribbonGeo.translate(0, -1.3, 0);
  const ribbon = new THREE.Mesh(ribbonGeo, mat); ribbon.position.y = -0.1;
  const ribbon2 = new THREE.Mesh(ribbonGeo, mat); ribbon2.position.set(0.12, -0.05, 0.05); ribbon2.rotation.y = 1.3; ribbon2.scale.set(0.7, 0.75, 1);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0x9ffff0, toneMapped: false }));
  body.add(sac, ribbon, ribbon2, core);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.4, 4), sacMat); const a = (i / 4) * Math.PI * 2; f.position.set(Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3); f.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); body.add(f); }
  root.add(body);
  const mark = markRing(); mark.position.y = 1.7; root.add(mark);
  return { root, body, legs: [], rims: [], crown: [], core, mats: [sacMat], mark, head: sac, pieces: collectPieces(body, []), sac, ribbon, uniforms, veinColor: new THREE.Color(0x5fe8c8) };
}

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
  add(root, new THREE.BoxGeometry(0.07, 0.085, 0.42), body, 0, 0, 0);
  add(root, new THREE.BoxGeometry(0.074, 0.02, 0.36), dark, 0, -0.045, -0.01);
  for (let i = 0; i < 5; i++) add(root, new THREE.BoxGeometry(0.078, 0.022, 0.012), dark, 0, 0.02, -0.06 - i * 0.03); // aletas
  // ferrolho que recua no disparo
  const slide = new THREE.Group(); root.add(slide);
  add(slide, new THREE.BoxGeometry(0.075, 0.03, 0.3), trim, 0, 0.055, -0.02);
  add(slide, new THREE.BoxGeometry(0.02, 0.018, 0.04), dark, 0.04, 0.055, 0.09);
  // trilho e mira com ponto
  for (let i = 0; i < 6; i++) add(root, new THREE.BoxGeometry(0.03, 0.008, 0.018), dark, 0, 0.074, -0.1 + i * 0.035);
  add(root, new THREE.BoxGeometry(0.036, 0.034, 0.05), dark, 0, 0.094, 0.03);
  add(root, new THREE.CylinderGeometry(0.016, 0.016, 0.052, 10), dark, 0, 0.098, 0.03, Math.PI / 2);
  add(root, new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5040, toneMapped: false }), 0, 0.098, 0.004);
  add(root, new THREE.BoxGeometry(0.015, 0.03, 0.02), trim, 0, 0.085, -0.15);
  // cano, bobinas e quebra-chama
  add(root, new THREE.CylinderGeometry(0.012, 0.016, 0.32, 8), body, 0, 0.01, -0.36, Math.PI / 2);
  add(root, new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8), trim, 0, 0.01, -0.5, Math.PI / 2);
  for (let i = 0; i < 3; i++) add(root, new THREE.BoxGeometry(0.006, 0.05, 0.03), dark, 0, 0.01, -0.5, 0, 0, (i * Math.PI) / 3);
  const coils: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) coils.push(add(root, new THREE.TorusGeometry(0.03, 0.007, 6, 14), glow, 0, 0.01, -0.24 - i * 0.05));
  add(root, new THREE.BoxGeometry(0.01, 0.01, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 }), -0.03, -0.025, -0.3); // cabo de energia
  // empunhadura, guarda-mato e coronha
  add(root, new THREE.BoxGeometry(0.05, 0.12, 0.07), grip, 0, -0.09, 0.12, 0.3);
  add(root, new THREE.TorusGeometry(0.03, 0.006, 4, 10, Math.PI), dark, 0, -0.055, 0.07, 0, Math.PI / 2, 0);
  add(root, new THREE.BoxGeometry(0.06, 0.05, 0.16), body, 0, -0.005, 0.27);
  add(root, new THREE.BoxGeometry(0.066, 0.075, 0.03), grip, 0, -0.012, 0.35);
  add(root, new THREE.BoxGeometry(0.03, 0.03, 0.02), trim, 0, 0.08, 0.1);
  // indicador de dardos (6 segmentos) no flanco esquerdo
  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) leds.push(add(root, new THREE.BoxGeometry(0.004, 0.012, 0.018), new THREE.MeshBasicMaterial({ color: 0x39d8ff, toneMapped: false }), -0.037, 0.022, 0.05 - i * 0.024));
  // cápsula de dardos (sai na recarga)
  const magMat = new THREE.MeshStandardMaterial({ color: 0x0c2a30, emissive: 0x39d8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.85, roughness: 0.1 });
  const mag = new THREE.Group(); mag.position.set(0.045, 0.0, -0.06); root.add(mag);
  add(mag, new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), magMat, 0, 0, 0, Math.PI / 2);
  add(mag, new THREE.CylinderGeometry(0.029, 0.029, 0.02, 10), trim, 0, 0, 0.08, Math.PI / 2);
  // mãos/luvas
  const glove = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.95 });
  add(root, new THREE.BoxGeometry(0.075, 0.07, 0.11), glove, 0, -0.1, 0.13, 0.3);
  add(root, new THREE.BoxGeometry(0.09, 0.09, 0.32), sleeve, 0.02, -0.15, 0.33, 0.25);
  const hand = new THREE.Group(); hand.position.set(-0.03, -0.03, -0.24); root.add(hand);
  add(hand, new THREE.BoxGeometry(0.07, 0.06, 0.1), glove, 0, 0, 0, 0, 0, 0.4);
  add(hand, new THREE.BoxGeometry(0.085, 0.085, 0.36), sleeve, -0.07, -0.09, 0.19, 0.1, -0.55, 0.2);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.54); root.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow(), color: 0x8ff4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(0.18); flash.position.copy(muzzle.position); flash.visible = false; root.add(flash);
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

export function buildPickup(kind: "dardos" | "curativo" | "fole"): THREE.Group {
  const g = new THREE.Group();
  if (kind === "fole") {
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
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color: kind === "dardos" ? 0x5ff0ff : kind === "fole" ? 0xffc070 : 0xffa23a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false }));
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

export function signMesh(text: string, color: number, width?: number): THREE.Mesh {
  const hex = "#" + color.toString(16).padStart(6, "0");
  const w = width ?? Math.max(1.4, text.length * 0.2);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.32), new THREE.MeshBasicMaterial({ map: texSign(text, hex), toneMapped: false }));
  return m;
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
  add(root, new THREE.BoxGeometry(0.085, 0.1, 0.26), body, 0, 0, 0.06);
  add(root, new THREE.BoxGeometry(0.06, 0.13, 0.08), body, 0, -0.1, 0.16, 0.35);
  add(root, new THREE.BoxGeometry(0.07, 0.07, 0.14), body, 0, -0.01, 0.26);
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
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; vents.push(add(root, new THREE.BoxGeometry(0.008, 0.03, 0.05), glow, Math.cos(a) * 0.06, 0.005 + Math.sin(a) * 0.06, -0.47, 0, 0, a)); }
  // indicador de cartuchos (8 luzes) no flanco
  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) leds.push(add(root, new THREE.BoxGeometry(0.006, 0.012, 0.014), new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false }), 0.044, 0.03, 0.12 - i * 0.02));
  // tubo de munição sob o cano (vira o "mag" para a recarga)
  const magMat = new THREE.MeshStandardMaterial({ color: 0x3a2410, emissive: 0xffa040, emissiveIntensity: 0.6, roughness: 0.4 });
  const mag = add(root, new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), magMat, 0, -0.06, -0.15, Math.PI / 2);
  // alça de bombear e mão esquerda
  const hand = new THREE.Group(); hand.position.set(0, -0.07, -0.22); root.add(hand);
  add(hand, new THREE.BoxGeometry(0.07, 0.05, 0.1), body, 0, 0, 0);
  const glove = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.95 });
  add(hand, new THREE.BoxGeometry(0.08, 0.07, 0.1), glove, -0.02, -0.04, 0, 0, 0, 0.4);
  add(hand, new THREE.BoxGeometry(0.085, 0.085, 0.36), sleeve, -0.08, -0.09, 0.18, 0.1, -0.55, 0.2);
  add(root, new THREE.BoxGeometry(0.075, 0.07, 0.11), glove, 0, -0.11, 0.17, 0.3);
  add(root, new THREE.BoxGeometry(0.09, 0.09, 0.32), sleeve, 0.02, -0.16, 0.37, 0.25);
  const coils = [...vents];
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, -0.52); root.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow(), color: 0xffc080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(0.3); flash.position.copy(muzzle.position); flash.visible = false; root.add(flash);
  root.traverse((o) => { o.frustumCulled = false; });
  return { root, mag, coils, muzzle, flash, magMat, leds, bellows, hand, vents };
}

