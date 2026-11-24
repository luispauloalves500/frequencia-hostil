import * as THREE from "three";
import { texFish, texGlow, texSign } from "./textures";

const ceramic = () => new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.35, metalness: 0.05, flatShading: true, emissive: 0x000000 });
const darkCeramic = () => new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.5, flatShading: true });
export const rimMat = (color = 0x6ff0ff) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Object3D;
  legs: THREE.Object3D[];
  rims: THREE.Mesh[];
  crown: THREE.Object3D[];
  core: THREE.Mesh | null;
  mats: THREE.MeshStandardMaterial[];
  mark: THREE.Object3D;
  beam?: THREE.Mesh;
}

function leg(len1: number, len2: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, len1, 5), mat);
  upper.position.y = -len1 / 2;
  const knee = new THREE.Group(); knee.position.y = -len1;
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.008, len2, 5), mat);
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

/** Riscador: quadrúpede de pernas finas, casca cerâmica com bordas translúcidas. */
export function buildRiscador(): CreatureRig {
  const root = new THREE.Group();
  const mat = ceramic();
  const dmat = darkCeramic();
  const body = new THREE.Group();
  body.position.y = 0.62;
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat);
  shell.scale.set(0.75, 0.5, 1.25);
  const belly = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), dmat);
  belly.scale.set(0.8, 0.5, 1.1); belly.position.y = -0.1;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 5), mat);
  head.rotation.x = -Math.PI / 2; head.position.set(0, 0.04, -0.62);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.25), new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
  mouth.position.set(0, -0.03, -0.7);
  body.add(shell, belly, head, mouth);
  // bordas finas e translúcidas (vibram antes do ataque)
  const rims: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const rim = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.38 + i * 0.03, 3, 1, true), rimMat());
    rim.position.set(0, 0.2, 0.35 - i * 0.18);
    rim.rotation.x = -0.5;
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
    const l = leg(0.42, 0.55, dmat);
    l.position.set(x, 0.62, z);
    l.rotation.z = x > 0 ? 0.7 : -0.7;
    (l.userData.knee as THREE.Object3D).rotation.z = x > 0 ? -1.4 : 1.4;
    root.add(l); legs.push(l);
  }
  const mark = markRing(); mark.position.y = 1.35; root.add(mark);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return { root, body, legs, rims, crown: [], core: null, mats: [mat], mark };
}

/** Estilhaço: alto, coroa de placas que abre e mostra a linha de luz. */
export function buildEstilhaco(): CreatureRig {
  const root = new THREE.Group();
  const mat = ceramic();
  mat.color.set(0xcfc7b4);
  const dmat = darkCeramic();
  const body = new THREE.Group();
  body.position.y = 1.15;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.95, 6), mat);
  const pelvis = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), dmat); pelvis.position.y = -0.52; pelvis.scale.y = 0.6;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.3, 5), dmat); neck.position.y = 0.6;
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), new THREE.MeshBasicMaterial({ color: 0xff8040 }));
  core.position.y = 0.82;
  body.add(torso, pelvis, neck, core);
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
    const l = leg(0.45, 0.6, dmat);
    l.position.set(x, 0.66, z);
    l.rotation.z = x * 1.2; l.rotation.x = z * 1.5;
    (l.userData.knee as THREE.Object3D).rotation.x = 0.5;
    root.add(l); legs.push(l);
  }
  const mark = markRing(); mark.position.y = 2.45; root.add(mark);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = false;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return { root, body, legs, rims, crown, core, mats: [mat], mark, beam };
}

/** Agulha em primeira pessoa. */
export function buildAgulha(): { root: THREE.Group; mag: THREE.Mesh; coils: THREE.Mesh[]; muzzle: THREE.Object3D; flash: THREE.Sprite; magMat: THREE.MeshStandardMaterial } {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.45, metalness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xa8865a, roughness: 0.5, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x173238, emissive: 0x39d8ff, emissiveIntensity: 1.6, roughness: 0.2 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); root.add(m); return m;
  };
  add(new THREE.BoxGeometry(0.07, 0.085, 0.42), body, 0, 0, 0);
  add(new THREE.BoxGeometry(0.075, 0.03, 0.3), trim, 0, 0.055, -0.02);
  add(new THREE.CylinderGeometry(0.012, 0.016, 0.32, 8), body, 0, 0.01, -0.36, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8), trim, 0, 0.01, -0.5, Math.PI / 2);
  const coils: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) coils.push(add(new THREE.TorusGeometry(0.03, 0.007, 6, 14), glow, 0, 0.01, -0.24 - i * 0.05));
  add(new THREE.BoxGeometry(0.05, 0.12, 0.07), body, 0, -0.09, 0.12, 0.3);
  add(new THREE.BoxGeometry(0.06, 0.05, 0.16), body, 0, -0.005, 0.27);
  add(new THREE.BoxGeometry(0.015, 0.03, 0.02), trim, 0, 0.085, -0.12);
  add(new THREE.BoxGeometry(0.03, 0.03, 0.02), trim, 0, 0.08, 0.1);
  const magMat = new THREE.MeshStandardMaterial({ color: 0x0c2a30, emissive: 0x39d8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.85, roughness: 0.1 });
  const mag = add(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), magMat, 0.045, 0.0, -0.06, Math.PI / 2);
  // mãos/luvas
  const glove = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.95 });
  add(new THREE.BoxGeometry(0.075, 0.07, 0.11), glove, 0, -0.1, 0.13, 0.3);
  add(new THREE.BoxGeometry(0.09, 0.09, 0.32), sleeve, 0.02, -0.15, 0.33, 0.25);
  add(new THREE.BoxGeometry(0.07, 0.06, 0.1), glove, -0.03, -0.03, -0.24, 0, 0, 0.4);
  add(new THREE.BoxGeometry(0.085, 0.085, 0.36), sleeve, -0.1, -0.12, -0.05, 0.1, -0.55, 0.2);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.54); root.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow(), color: 0x8ff4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.setScalar(0.18); flash.position.copy(muzzle.position); flash.visible = false; root.add(flash);
  root.traverse((o) => { o.frustumCulled = false; });
  return { root, mag, coils, muzzle, flash, magMat };
}

/** Emissor da baliza (mão esquerda e mundo). */
export function buildBeaconDevice(): { root: THREE.Group; light: THREE.Mesh } {
  const root = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.6, metalness: 0.3 });
  const cer = new THREE.MeshStandardMaterial({ color: 0xe6dfd0, roughness: 0.3 });
  const a = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 8), shell);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), cer); b.position.y = 0.09;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({ color: 0x7ff6ff }));
  light.position.set(0, 0.04, 0.065);
  const fins = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 4, 12), shell); fins.rotation.x = Math.PI / 2; fins.position.y = -0.03;
  root.add(a, b, light, fins);
  return { root, light };
}

export function buildPickup(kind: "dardos" | "curativo"): THREE.Group {
  const g = new THREE.Group();
  if (kind === "dardos") {
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
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color: kind === "dardos" ? 0x5ff0ff : 0xffa23a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
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
