import * as THREE from "three";
import { texSkin } from "./textures";

/**
 * Criaturas do Coro (v0.5): orgânicas e foscas. Pele/quitina com placas e poros (Lambert: sem
 * especular nem reflexo de ambiente, mais barato que o Standard), um leve tom de carne nas bordas
 * (subsuperfície falsa) e brilho só em detalhes pequenos (olhos, fendas, núcleo).
 * Morte: o corpo desaba e se desfaz (dissolução por ruído com borda quente), sem peças voando.
 */
export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Object3D;
  legs: THREE.Object3D[];
  /** detalhes que acendem na preparação do ataque (fendas, coroa interna) */
  rims: THREE.Mesh[];
  /** coroa do Estilhaço / placas do peito da Carapaça */
  crown: THREE.Object3D[];
  core: THREE.Mesh | null;
  /** materiais de pele (lampejo de impacto pelo emissivo) */
  mats: THREE.MeshLambertMaterial[];
  mark: THREE.Object3D;
  beam?: THREE.Mesh;
  head?: THREE.Object3D;
  /** Véu: saco que incha e fita ondulante */
  sac?: THREE.Mesh;
  ribbon?: THREE.Mesh;
  uniforms?: { uTime: { value: number }; uSwell: { value: number } };
  veinColor: THREE.Color;
  /** 0 = inteiro, 1 = dissolvido (compartilhado pelos materiais da criatura) */
  dissolve: { value: number };
  /** detalhes brilhantes (somem na morte) */
  accents: THREE.Mesh[];
}

const WAVE = `
  float k = clamp(-position.y / 2.6, 0.0, 1.0);
  transformed.x += sin(position.y * 2.6 + uTime * 3.1) * 0.22 * k + sin(uTime * 1.3) * 0.05;
  transformed.z += cos(position.y * 1.9 + uTime * 2.3) * 0.18 * k * (1.0 + uSwell);`;

/**
 * Pele fosca com subsuperfície falsa e dissolução. Todas as criaturas usam o mesmo programa
 * (a mesma chave de cache); só os uniforms mudam por criatura.
 */
function flesh(color: number, sss: number, dis: { value: number }, o: { wave?: { uTime: { value: number }; uSwell: { value: number } }; transparent?: boolean; opacity?: number; side?: THREE.Side; repeat?: number } = {}): THREE.MeshLambertMaterial {
  const map = texSkin();
  const m = new THREE.MeshLambertMaterial({ color, map, transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, depthWrite: !o.transparent });
  const uSss = { value: new THREE.Color(sss) };
  const edge = { value: new THREE.Color(sss).multiplyScalar(2.2) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSss = uSss; sh.uniforms.uDis = dis; sh.uniforms.uEdge = edge;
    sh.vertexShader = "varying vec3 vDisP;\n" + (o.wave ? "uniform float uTime; uniform float uSwell;\n" : "") + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vDisP = position;" + (o.wave ? WAVE : ""));
    if (o.wave) { sh.uniforms.uTime = o.wave.uTime; sh.uniforms.uSwell = o.wave.uSwell; }
    sh.fragmentShader = "uniform vec3 uSss; uniform float uDis; uniform vec3 uEdge; varying vec3 vDisP;\n" + sh.fragmentShader.replace("#include <opaque_fragment>", `
  float dn = fract(sin(dot(floor(vDisP * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 0.6 + fract(sin(dot(floor(vDisP * 23.0), vec3(39.34, 11.13, 83.1))) * 9631.17) * 0.4;
  if (dn < uDis) discard;
  vec3 vdir = normalize(vViewPosition);
  float rimk = pow(1.0 - clamp(abs(dot(normal, vdir)), 0.0, 1.0), 2.5);
  outgoingLight += uSss * (rimk * 0.45 + 0.05) * diffuseColor.rgb * 2.0;
  outgoingLight = mix(outgoingLight, uEdge, step(dn, uDis + 0.07) * step(0.001, uDis));
  #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => (o.wave ? "flesh-wave" : "flesh");
  return m;
}

/** Detalhe que brilha (olho, fenda, núcleo): pequeno, sem tone mapping, entra no bloom com moderação. */
const glowMat = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.15), toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

const SPH = new THREE.SphereGeometry(1, 14, 10);
const SPH_LO = new THREE.SphereGeometry(1, 8, 6);
function ell(rx: number, ry: number, rz: number, m: THREE.Material, x = 0, y = 0, z = 0, lo = false) {
  const o = new THREE.Mesh(lo ? SPH_LO : SPH, m); o.scale.set(rx, ry, rz); o.position.set(x, y, z); return o;
}
function seg(r0: number, r1: number, len: number, m: THREE.Material) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 7, 1), m); o.position.y = -len / 2; return o;
}

/** Perna articulada: coxa, joelho (bola) e canela afinando até a garra. */
function leg(len1: number, len2: number, r: number, mat: THREE.Material, joint: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(seg(r, r * 0.7, len1, mat));
  const knee = new THREE.Group(); knee.position.y = -len1;
  knee.add(ell(r * 1.05, r * 1.05, r * 1.05, joint, 0, 0, 0, true));
  knee.add(seg(r * 0.7, r * 0.18, len2, mat));
  g.add(knee);
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

/** Riscador: quadrúpede magro de quitina cinza-terra, ventre de carne clara, quatro olhos ciano. */
export function buildRiscador(): CreatureRig {
  const dissolve = { value: 0 };
  const root = new THREE.Group();
  const chitin = flesh(0x6d6258, 0x8a3a2c, dissolve);
  const dark = flesh(0x3a332e, 0x5a2a22, dissolve);
  const belly = flesh(0xa88478, 0xc04a3a, dissolve);
  const body = new THREE.Group(); body.position.y = 0.62;
  body.add(ell(0.27, 0.19, 0.4, chitin, 0, 0.02, 0.02)); // tórax
  body.add(ell(0.22, 0.17, 0.3, chitin, 0, 0.0, 0.46)); // abdome
  body.add(ell(0.2, 0.1, 0.5, belly, 0, -0.09, 0.15)); // ventre
  for (let i = 0; i < 4; i++) { const p = ell(0.24 - i * 0.02, 0.07, 0.15, dark, 0, 0.16 - i * 0.01, -0.22 + i * 0.2, true); p.rotation.x = -0.25; body.add(p); } // placas do dorso
  const rims: THREE.Mesh[] = [], accents: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) { // espinhos do dorso e fendas que acendem na preparação
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16 + (i % 2) * 0.05, 5), dark); sp.position.set(0, 0.22, -0.2 + i * 0.16); sp.rotation.x = -0.6; body.add(sp);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.025), glowMat(0x3fd8ff, 0.5)); slit.position.set(0, 0.19 - i * 0.008, -0.13 + i * 0.16); slit.rotation.x = -0.25; body.add(slit); rims.push(slit);
  }
  const head = new THREE.Group(); head.position.set(0, 0.03, -0.42);
  head.add(ell(0.13, 0.1, 0.2, chitin, 0, 0, -0.1));
  head.add(ell(0.1, 0.05, 0.16, dark, 0, 0.07, -0.08, true));
  for (const side of [-1, 1]) {
    const mand = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.24, 6), dark); mand.rotation.set(-Math.PI / 2 + 0.25, 0, side * 0.35); mand.position.set(side * 0.07, -0.06, -0.3); head.add(mand);
    for (const k of [0, 1]) { const eye = ell(0.018, 0.018, 0.018, glowMat(0x9ff8ff), side * (0.06 + k * 0.025), 0.05 - k * 0.02, -0.2 + k * 0.05, true); head.add(eye); accents.push(eye); }
  }
  const mouth = ell(0.07, 0.015, 0.05, glowMat(0xff6a3a, 0.8), 0, -0.06, -0.26, true); head.add(mouth); accents.push(mouth);
  body.add(head);
  root.add(body);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.24, -0.3], [0.24, -0.3], [-0.24, 0.36], [0.24, 0.36]]) {
    const l = leg(0.42, 0.55, 0.035, chitin, dark);
    l.position.set(x, 0.62, z);
    l.rotation.z = x > 0 ? 0.7 : -0.7;
    (l.userData.knee as THREE.Object3D).rotation.z = x > 0 ? -1.4 : 1.4;
    root.add(l); legs.push(l);
  }
  const mark = markRing(); mark.position.y = 1.35; root.add(mark);
  return { root, body, legs, rims, crown: [], core: null, mats: [chitin, dark, belly], mark, head, veinColor: new THREE.Color(0x3fd8ff), dissolve, accents };
}

/** Estilhaço: alto e magro, costelas à mostra, coroa de placas de osso que abre e revela a garganta acesa. */
export function buildEstilhaco(): CreatureRig {
  const dissolve = { value: 0 };
  const root = new THREE.Group();
  const bone = flesh(0x8a7a66, 0x9a4a2a, dissolve);
  const dark = flesh(0x3d332b, 0x6a2c1c, dissolve);
  const meat = flesh(0x9a5a4c, 0xd0603a, dissolve);
  const body = new THREE.Group(); body.position.y = 1.15;
  body.add(ell(0.2, 0.46, 0.16, dark, 0, 0, 0)); // tronco
  body.add(ell(0.15, 0.3, 0.1, meat, 0, 0.02, -0.08)); // peito de carne
  for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.17 - i * 0.012, 0.018, 5, 14, Math.PI * 1.2), bone); r.position.set(0, 0.18 - i * 0.1, -0.02); r.rotation.set(Math.PI / 2, 0, -Math.PI * 0.1 + Math.PI); body.add(r); } // costelas
  body.add(ell(0.2, 0.13, 0.16, bone, 0, -0.5, 0, true)); // pelve
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.32, 7), dark); neck.position.y = 0.6; body.add(neck);
  const head = new THREE.Group(); head.position.y = 0.82;
  head.add(ell(0.12, 0.13, 0.16, bone, 0, 0.02, -0.04));
  const core = new THREE.Mesh(SPH_LO, new THREE.MeshBasicMaterial({ color: 0xff8040, toneMapped: false })); core.scale.setScalar(0.07); core.position.set(0, -0.03, -0.13);
  head.add(core);
  body.add(head);
  const accents: THREE.Mesh[] = [core];
  for (const side of [-1, 1]) {
    const eye = ell(0.016, 0.016, 0.016, glowMat(0xffb070), side * 0.05, 0.07, -0.17, true); head.add(eye); accents.push(eye);
    const arm = new THREE.Group(); arm.position.set(side * 0.24, 0.3, 0); arm.rotation.set(0.15, 0, side * 0.25);
    const up = seg(0.04, 0.03, 0.42, dark); arm.add(up);
    const fore = new THREE.Group(); fore.position.y = -0.42; fore.rotation.x = -0.4; arm.add(fore);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.5, 6), bone); blade.position.y = -0.25; blade.rotation.x = Math.PI; fore.add(blade);
    body.add(arm);
  }
  // coroa: placas de osso em leque; a face interna tem uma fenda âmbar que acende ao mirar
  const crown: THREE.Object3D[] = [], rims: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const piv = new THREE.Group();
    piv.position.y = 0.86; piv.rotation.y = (i / 7) * Math.PI * 2;
    const plate = ell(0.06, 0.24, 0.025, bone, 0, 0.22, 0.1, true);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.01), glowMat(0xffb070, 0.5)); slit.position.set(0, 0.22, 0.072);
    piv.add(plate, slit); piv.rotation.x = 0.1;
    body.add(piv); crown.push(piv); rims.push(slit);
  }
  root.add(body);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.18, 0.05], [0.18, 0.05], [0, -0.2]]) {
    const l = leg(0.45, 0.6, 0.045, dark, bone);
    l.position.set(x, 0.66, z);
    l.rotation.z = x * 1.2; l.rotation.x = z * 1.5;
    (l.userData.knee as THREE.Object3D).rotation.x = 0.5;
    root.add(l); legs.push(l);
  }
  const mark = markRing(); mark.position.y = 2.45; root.add(mark);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = false;
  return { root, body, legs, rims, crown, core, mats: [bone, dark, meat], mark, beam, head, veinColor: new THREE.Color(0xff8a3a), dissolve, accents };
}

/** Véu: medusa de membrana fosca (saco de carne translúcido) com fita ondulante no shader. */
export function buildVeu(): CreatureRig {
  const dissolve = { value: 0 };
  const root = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uSwell: { value: 0 } };
  const ribbonMat = flesh(0x8fa29a, 0x5a8a7a, dissolve, { wave: uniforms, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  ribbonMat.forceSinglePass = true;
  const sacMat = flesh(0xa6b2a8, 0x7aa898, dissolve, { transparent: true, opacity: 0.9 });
  const body = new THREE.Group(); body.position.y = 1.0;
  const sac = ell(0.34, 0.27, 0.34, sacMat); 
  const ribbonGeo = new THREE.PlaneGeometry(0.42, 2.6, 1, 24); ribbonGeo.translate(0, -1.3, 0);
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat); ribbon.position.y = -0.1;
  const ribbon2 = new THREE.Mesh(ribbonGeo, ribbonMat); ribbon2.position.set(0.12, -0.05, 0.05); ribbon2.rotation.y = 1.3; ribbon2.scale.set(0.7, 0.75, 1);
  const core = new THREE.Mesh(SPH_LO, new THREE.MeshBasicMaterial({ color: 0x8ff0d8, toneMapped: false })); core.scale.setScalar(0.07);
  body.add(sac, ribbon, ribbon2, core);
  const accents: THREE.Mesh[] = [core];
  for (let i = 0; i < 5; i++) { // manchas luminosas na membrana
    const a = (i / 5) * Math.PI * 2;
    const dot = ell(0.022, 0.022, 0.022, glowMat(0x7ff0d0, 0.85), Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3, true); body.add(dot); accents.push(dot);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.36, 5), sacMat); f.position.set(Math.cos(a) * 0.28, -0.18, Math.sin(a) * 0.28); f.rotation.set(Math.PI + Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4); body.add(f);
  }
  root.add(body);
  const mark = markRing(); mark.position.y = 1.7; root.add(mark);
  return { root, body, legs: [], rims: [], crown: [], core, mats: [sacMat, ribbonMat], mark, head: sac, sac, ribbon, uniforms, veinColor: new THREE.Color(0x5fe8c8), dissolve, accents };
}

/**
 * Carapaça (F3): besta pesada e baixa. Duas placas cobrem o peito (abrem 2,5 s após bater num batente
 * e mostram a carne viva); dorso de quitina com placas sobrepostas e um ponto claro entre elas.
 */
export function buildCarapaca(): CreatureRig {
  const dissolve = { value: 0 };
  const root = new THREE.Group();
  const shell = flesh(0x5c5a4e, 0x6a3a26, dissolve);
  const dark = flesh(0x2f2c26, 0x4a2418, dissolve);
  const meat = flesh(0xa0584a, 0xe0603a, dissolve);
  const body = new THREE.Group(); body.position.y = 0.95;
  body.add(ell(0.62, 0.48, 0.85, dark, 0, 0, 0.1)); // massa do corpo
  for (let i = 0; i < 5; i++) { const p = ell(0.64 - Math.abs(i - 2) * 0.06, 0.2, 0.3, shell, 0, 0.36 - Math.abs(i - 2) * 0.04, -0.45 + i * 0.28); p.rotation.x = -0.3; body.add(p); } // dorso
  body.add(ell(0.34, 0.3, 0.2, meat, 0, -0.05, -0.62)); // peito (exposto quando as placas abrem)
  const head = new THREE.Group(); head.position.set(0, 0.05, -0.8);
  head.add(ell(0.26, 0.2, 0.26, shell, 0, 0, -0.08));
  for (const side of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 7), dark); horn.position.set(side * 0.2, 0.08, -0.22); horn.rotation.set(-1.2, 0, side * 0.5); head.add(horn); }
  const accents: THREE.Mesh[] = [];
  for (const side of [-1, 1]) { const eye = ell(0.025, 0.02, 0.02, glowMat(0xffc060), side * 0.13, 0.06, -0.31, true); head.add(eye); accents.push(eye); }
  body.add(head);
  // placas do peito em pivôs laterais (rotation.y abre)
  const crown: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(side * 0.42, -0.05, -0.62);
    const plate = ell(0.36, 0.38, 0.07, shell, -side * 0.2, 0, -0.06); plate.rotation.y = side * 0.25;
    piv.add(plate); piv.userData.side = side;
    body.add(piv); crown.push(piv);
  }
  const core = new THREE.Mesh(SPH_LO, glowMat(0xffa050)); core.scale.set(0.12, 0.1, 0.05); core.position.set(0, -0.05, -0.8); body.add(core); accents.push(core);
  // fendas do dorso (o ponto fraco de trás) acendem quando ele investe
  const rims: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.03), glowMat(0xffa050, 0.5)); s.position.set(0, 0.5, 0.05 + i * 0.28); s.rotation.x = -0.3; body.add(s); rims.push(s); }
  root.add(body);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.6], [0.55, 0.6]]) {
    const l = leg(0.5, 0.55, 0.09, dark, shell);
    l.position.set(x, 0.95, z);
    l.rotation.z = x > 0 ? 0.45 : -0.45;
    (l.userData.knee as THREE.Object3D).rotation.z = x > 0 ? -0.9 : 0.9;
    root.add(l); legs.push(l);
  }
  const mark = markRing(); mark.position.y = 2.0; root.add(mark);
  return { root, body, legs, rims, crown, core, mats: [shell, dark, meat], mark, head, veinColor: new THREE.Color(0xffa050), dissolve, accents };
}

/**
 * Badalo (chefe F3): massa em forma de sino pendurada por tendões no teto. Carcaça grossa de
 * quitina; por baixo, o órgão claro (exposto quando o sino cai sobre uma placa).
 */
export function buildBadalo(): CreatureRig {
  const dissolve = { value: 0 };
  const root = new THREE.Group();
  const shell = flesh(0x56524a, 0x5a2a1c, dissolve);
  const dark = flesh(0x2c2924, 0x3a1a12, dissolve);
  const meat = flesh(0xb07060, 0xf07050, dissolve);
  const body = new THREE.Group(); // pivô do balanço no teto (root fica no teto)
  const bell = new THREE.Group(); bell.position.y = -4.2; body.add(bell);
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; const y = 2.2 - t * 2.2; const r = 0.35 + Math.pow(t, 1.6) * 1.25 + Math.sin(t * Math.PI) * 0.15; prof.push(new THREE.Vector2(r, y)); }
  const shellMesh = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), shell); bell.add(shellMesh);
  const darkIn = flesh(0x241f1b, 0x5a2016, dissolve, { side: THREE.BackSide });
  const inner = new THREE.Mesh(new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.x * 0.93, p.y)), 16), darkIn); bell.add(inner);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const rib = ell(0.09, 1.1, 0.09, dark, Math.cos(a) * 1.05, 0.9, Math.sin(a) * 1.05, true); rib.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); bell.add(rib); }
  bell.add(ell(1.62, 0.12, 1.62, dark, 0, 0.03, 0, true)); // lábio do sino
  // órgão claro sob a borda
  const organ = new THREE.Group(); organ.position.y = 0.35; bell.add(organ);
  organ.add(ell(0.5, 0.42, 0.5, meat, 0, 0, 0));
  const core = new THREE.Mesh(SPH_LO, glowMat(0xffd0a0)); core.scale.setScalar(0.22); core.position.y = -0.25; organ.add(core);
  const accents: THREE.Mesh[] = [core];
  // tendões até o teto
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; const t = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 2.4, 6), dark); t.position.set(Math.cos(a) * 0.25, -1.1, Math.sin(a) * 0.25); t.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); t.userData.stretch = 2.4; body.add(t); }
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 2.2, 8), shell); stalk.position.y = -3.0; stalk.userData.stretch = 2.2; body.add(stalk);
  // anéis do dorso acendem na inclinação
  const rims: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.62 + i * 0.32, 0.025, 4, 28), glowMat(0xffb080, 0.45)); r.rotation.x = Math.PI / 2; r.position.y = 1.55 - i * 0.5; bell.add(r); rims.push(r); }
  root.add(body);
  const mark = markRing(); mark.position.y = -4.6; root.add(mark);
  return { root, body, legs: [], rims, crown: [organ], core, mats: [shell, dark, meat, darkIn], mark, head: bell, veinColor: new THREE.Color(0xffb080), dissolve, accents };
}
