import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
 * Uniforms compartilhados por todos os materiais de pele de uma criatura (ligados ao objeto de dissolução):
 * matriz inversa da raiz (feridas presas ao corpo), até 4 feridas e o contorno frio de leitura.
 */
export interface CreatureFx { rootInv: { value: THREE.Matrix4 }; wounds: { value: THREE.Vector4[] }; woundR: { value: number }; rim: { value: THREE.Color }; next: number }
const FX = new WeakMap<object, CreatureFx>();
export function fxOf(dis: { value: number }): CreatureFx {
  let f = FX.get(dis);
  if (!f) { f = { rootInv: { value: new THREE.Matrix4() }, wounds: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -99, 0, 0)) }, woundR: { value: 0.08 }, rim: { value: new THREE.Color(0x000000) }, next: 0 }; FX.set(dis, f); }
  return f;
}

/** Ruído de valor 3D barato (relevo da pele: poros, sulcos e placas). */
const NOISE = `
float fhH3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float fhN3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fhH3(i), fhH3(i + vec3(1, 0, 0)), f.x), mix(fhH3(i + vec3(0, 1, 0)), fhH3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(fhH3(i + vec3(0, 0, 1)), fhH3(i + vec3(1, 0, 1)), f.x), mix(fhH3(i + vec3(0, 1, 1)), fhH3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fhSkinH;`;

/**
 * Pele fosca com subsuperfície falsa, relevo procedural (sulcos de quitina ou poros), feridas que ficam
 * onde o tiro pegou, contorno frio (leitura em áreas claras) e dissolução com cinza e borda quente.
 * Todas as criaturas usam o mesmo programa (a mesma chave de cache); só os uniforms mudam.
 * detail: [escala do relevo, 0 = poros / 1 = sulcos de placa, força do relevo]
 */
function flesh(color: number, sss: number, dis: { value: number }, o: { wave?: { uTime: { value: number }; uSwell: { value: number } }; transparent?: boolean; opacity?: number; side?: THREE.Side; repeat?: number; detail?: [number, number, number] } = {}): THREE.MeshLambertMaterial {
  const map = texSkin();
  const m = new THREE.MeshLambertMaterial({ color, map, transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, depthWrite: !o.transparent });
  const uSss = { value: new THREE.Color(sss) };
  const edge = { value: new THREE.Color(sss).multiplyScalar(2.2) };
  const det = { value: new THREE.Vector3(...(o.detail ?? [11, 0.5, 0.22])) };
  const fx = fxOf(dis);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSss = uSss; sh.uniforms.uDis = dis; sh.uniforms.uEdge = edge; sh.uniforms.uDet = det;
    sh.uniforms.uRootInv = fx.rootInv; sh.uniforms.uWound = fx.wounds; sh.uniforms.uWoundR = fx.woundR; sh.uniforms.uRim = fx.rim;
    sh.vertexShader = "varying vec3 vDisP; varying vec3 vRootP; uniform mat4 uRootInv;\n" + (o.wave ? "uniform float uTime; uniform float uSwell;\n" : "") +
      sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vDisP = position;" + (o.wave ? WAVE : ""))
        .replace("#include <project_vertex>", "#include <project_vertex>\n  vRootP = (uRootInv * modelMatrix * vec4(transformed, 1.0)).xyz;");
    if (o.wave) { sh.uniforms.uTime = o.wave.uTime; sh.uniforms.uSwell = o.wave.uSwell; }
    sh.fragmentShader = "uniform vec3 uSss; uniform float uDis; uniform vec3 uEdge; uniform vec3 uDet; uniform vec4 uWound[4]; uniform float uWoundR; uniform vec3 uRim; varying vec3 vDisP; varying vec3 vRootP;\n" + NOISE + "\n" + sh.fragmentShader
      .replace("#include <map_fragment>", `#include <map_fragment>
  {
    vec3 q = vDisP * uDet.x;
    float n1 = fhN3(q), n2 = fhN3(q * 2.7 + 7.1);
    float ridge = 1.0 - abs(n1 * 2.0 - 1.0);
    fhSkinH = mix(n1 * 0.65 + n2 * 0.35, ridge * 0.75 + n2 * 0.25, uDet.y);
    diffuseColor.rgb *= 0.8 + 0.3 * fhSkinH; // sulcos escuros, placas claras
    // feridas: carne escura no centro, borda viva
    for (int i = 0; i < 4; i++) {
      float d = distance(vRootP, uWound[i].xyz) / (uWoundR * (0.7 + 0.6 * n2));
      float w = uWound[i].w * (1.0 - smoothstep(0.55, 1.0, d));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.025, 0.02), w);
    }
    // cinza antes de sumir
    float dnA = fract(sin(dot(floor(vDisP * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 0.6 + fract(sin(dot(floor(vDisP * 23.0), vec3(39.34, 11.13, 83.1))) * 9631.17) * 0.4;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.04, 0.035), step(0.001, uDis) * (1.0 - smoothstep(uDis + 0.08, uDis + 0.3, dnA)));
  }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
  {
    // relevo por derivadas (sem mapa de normal): poros/sulcos acompanham a luz
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    float dhx = dFdx(fhSkinH), dhy = dFdy(fhSkinH);
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
    float dt = dot(dpx, r1);
    vec3 grad = sign(dt) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(dt) * normal - grad * uDet.z);
  }`)
      .replace("#include <opaque_fragment>", `
  float dn = fract(sin(dot(floor(vDisP * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 0.6 + fract(sin(dot(floor(vDisP * 23.0), vec3(39.34, 11.13, 83.1))) * 9631.17) * 0.4;
  if (dn < uDis) discard;
  vec3 vdir = normalize(vViewPosition);
  float rimk = pow(1.0 - clamp(abs(dot(normalize(vNormal), vdir)), 0.0, 1.0), 2.5); // normal da malha (o relevo não acende o contorno)
  outgoingLight += uSss * (rimk * 0.45 + 0.05) * diffuseColor.rgb * 2.0;
  outgoingLight += uRim * pow(rimk, 2.2); // contorno frio: silhueta legível contra azulejo claro
  for (int i = 0; i < 4; i++) { float d = distance(vRootP, uWound[i].xyz) / uWoundR; outgoingLight += uEdge * 0.5 * uWound[i].w * smoothstep(0.6, 0.85, d) * (1.0 - smoothstep(0.85, 1.05, d)); }
  outgoingLight = mix(outgoingLight, uEdge * (1.2 + 0.6 * fhSkinH), step(dn, uDis + 0.07) * step(0.001, uDis));
  #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => (o.wave ? "flesh2-wave" : "flesh2");
  return m;
}

/** Detalhe que brilha (olho, fenda, núcleo): pequeno, sem tone mapping, entra no bloom com moderação. */
const glowMat = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.15), toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

const SPH = new THREE.SphereGeometry(1, 12, 8);
const SPH_LO = new THREE.SphereGeometry(1, 8, 6);
const SPH_HI = new THREE.SphereGeometry(1, 16, 12);
/** peças miúdas (vértebras, olhos, verrugas): o relevo vem do shader, não da malha */
const SPH_XS = new THREE.SphereGeometry(1, 6, 4);
/** cone (dente, espinho, garra) já posicionado e apontado */
function spike(r: number, len: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, seg = 5) {
  const o = new THREE.Mesh(new THREE.ConeGeometry(r, len, r < 0.016 ? Math.min(seg, 3) : seg, 1, r < 0.016), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o;
}
/** tendão/haste fina entre dois pontos */
function strand(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const d = b.clone().sub(a), L = d.length();
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, L, 4, 1, true), m);
  o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return o;
}
function ell(rx: number, ry: number, rz: number, m: THREE.Material, x = 0, y = 0, z = 0, lo = false) {
  const o = new THREE.Mesh(Math.max(rx, ry, rz) < 0.045 ? SPH_XS : lo ? SPH_LO : SPH, m); o.scale.set(rx, ry, rz); o.position.set(x, y, z); return o;
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
  // garra em gancho no pé e esporão no joelho
  knee.add(spike(r * 0.5, r * 2.6, joint, 0, -len2 - r * 0.9, -r * 0.6, -0.5));
  knee.add(spike(r * 0.35, r * 1.8, joint, 0, -len2 * 0.15, r * 0.9, 1.9));
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
  const tor = new THREE.Mesh(SPH_HI, chitin); tor.scale.set(0.27, 0.19, 0.4); tor.position.set(0, 0.02, 0.02); body.add(tor); // tórax (silhueta lisa)
  const abd = new THREE.Mesh(SPH_HI, chitin); abd.scale.set(0.22, 0.17, 0.3); abd.position.set(0, 0, 0.46); body.add(abd); // abdome
  for (let i = 0; i < 4; i++) { const band = ell(0.225 - i * 0.03, 0.035, 0.05, dark, 0, 0.04 - i * 0.012, 0.34 + i * 0.09, true); band.rotation.x = 0.35; body.add(band); } // anéis do abdome
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) body.add(spike(0.02, 0.1, dark, side * (0.26 - i * 0.015), -0.02, -0.15 + i * 0.17, 0, 0, side * -1.9)); // espinhos laterais
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
  for (let i = 0; i < 6; i++) head.add(spike(0.009, 0.05, dark, -0.05 + i * 0.02, -0.045, -0.27 + Math.abs(i - 2.5) * 0.008, Math.PI)); // dentes
  head.add(ell(0.12, 0.035, 0.07, chitin, 0, 0.085, -0.2)); // sobrancelha de quitina
  for (const side of [-1, 1]) {
    head.add(strand(new THREE.Vector3(side * 0.05, 0.08, -0.24), new THREE.Vector3(side * 0.2, 0.3, -0.5), 0.008, dark)); // antenas
    head.add(strand(new THREE.Vector3(side * 0.04, -0.07, -0.25), new THREE.Vector3(side * 0.07, -0.16, -0.33), 0.012, dark)); // palpos
  }
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
  for (let i = 0; i < 7; i++) { const v = ell(0.035, 0.03, 0.04, bone, 0, 0.36 - i * 0.12, 0.15 - Math.abs(i - 3) * 0.006, true); body.add(v); } // vértebras nas costas
  for (const side of [-1, 1]) body.add(strand(new THREE.Vector3(side * 0.13, -0.45, 0.02), new THREE.Vector3(side * 0.16, -0.1, 0.0), 0.022, dark)); // tendões do flanco
  for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.175 - i * 0.012, 0.016, 4, 10, Math.PI * 1.2), bone); r.position.set(0, 0.22 - i * 0.075, -0.02); r.rotation.set(Math.PI / 2, 0, -Math.PI * 0.1 + Math.PI); body.add(r); } // costelas
  body.add(ell(0.2, 0.13, 0.16, bone, 0, -0.5, 0, true)); // pelve
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.32, 7), dark); neck.position.y = 0.6; body.add(neck);
  const head = new THREE.Group(); head.position.y = 0.82;
  head.add(ell(0.12, 0.13, 0.16, bone, 0, 0.02, -0.04));
  head.add(ell(0.085, 0.04, 0.1, bone, 0, -0.09, -0.1, true)); // mandíbula
  for (let i = 0; i < 5; i++) head.add(spike(0.008, 0.045, bone, -0.04 + i * 0.02, -0.065, -0.17, Math.PI)); // dentes
  for (const side of [-1, 1]) head.add(ell(0.05, 0.02, 0.05, bone, side * 0.055, 0.1, -0.13, true)); // arcadas
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
    for (const k of [-1, 1]) fore.add(spike(0.012, 0.16, bone, k * 0.03, -0.06, 0.02, Math.PI - 0.4, 0, k * 0.5)); // dedos-gancho
    fore.add(ell(0.04, 0.04, 0.04, dark, 0, 0, 0, true)); // cotovelo
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
  for (let i = 0; i < 9; i++) { // filamentos finos entre os tentáculos e manchas no topo
    const a = (i / 9) * Math.PI * 2 + 0.3, L = 0.5 + (i % 3) * 0.25;
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.012, L, 4), sacMat); f.position.set(Math.cos(a) * 0.2, -0.15 - L / 2, Math.sin(a) * 0.2); f.rotation.set(Math.PI + Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15); body.add(f);
    const dot = ell(0.014, 0.014, 0.014, glowMat(0x7ff0d0, 0.85), Math.cos(a) * 0.17, 0.2, Math.sin(a) * 0.17, true); body.add(dot); accents.push(dot);
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const r = ell(0.03, 0.2, 0.03, sacMat, Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3, true); r.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); body.add(r); } // nervuras da membrana
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
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) { const p = ell(0.2, 0.24, 0.26, shell, side * 0.52, 0.05 - i * 0.02, -0.3 + i * 0.27, true); p.rotation.set(-0.2, 0, side * 0.5); body.add(p); } // placas laterais sobrepostas
  for (let i = 0; i < 5; i++) body.add(spike(0.05, 0.22 - Math.abs(i - 2) * 0.03, dark, 0, 0.56 - Math.abs(i - 2) * 0.05, -0.42 + i * 0.28, -0.5)); // cristas do dorso
  for (let i = 0; i < 6; i++) body.add(ell(0.05, 0.03, 0.05, dark, (i % 2 ? 1 : -1) * (0.2 + (i % 3) * 0.1), 0.42, -0.3 + i * 0.16, true)); // calos
  const head = new THREE.Group(); head.position.set(0, 0.05, -0.8);
  head.add(ell(0.26, 0.2, 0.26, shell, 0, 0, -0.08));
  for (const side of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 7), dark); horn.position.set(side * 0.2, 0.08, -0.22); horn.rotation.set(-1.2, 0, side * 0.5); head.add(horn); }
  for (const side of [-1, 1]) head.add(spike(0.05, 0.26, dark, side * 0.12, -0.12, -0.3, -1.9, 0, side * -0.35, 6)); // mandíbulas
  for (let i = 0; i < 7; i++) head.add(spike(0.014, 0.07, dark, -0.09 + i * 0.03, -0.1, -0.3 + Math.abs(i - 3) * 0.01, Math.PI)); // dentes
  head.add(ell(0.22, 0.06, 0.12, shell, 0, 0.15, -0.16)); // escudo da testa
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
  const shellMesh = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), shell); bell.add(shellMesh);
  const darkIn = flesh(0x241f1b, 0x5a2016, dissolve, { side: THREE.BackSide });
  const inner = new THREE.Mesh(new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.x * 0.93, p.y)), 16), darkIn); bell.add(inner);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const rib = ell(0.09, 1.1, 0.09, dark, Math.cos(a) * 1.05, 0.9, Math.sin(a) * 1.05, true); rib.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); bell.add(rib); }
  bell.add(ell(1.62, 0.12, 1.62, dark, 0, 0.03, 0, true)); // lábio do sino
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; bell.add(spike(0.07, 0.34 + (i % 3) * 0.08, dark, Math.cos(a) * 1.5, -0.12, Math.sin(a) * 1.5, Math.PI + Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25)); } // dentes da borda
  for (let i = 0; i < 16; i++) { const t = 0.25 + (i * 0.37) % 0.6, a = i * 2.39; const r = 0.35 + Math.pow(t, 1.6) * 1.25 + Math.sin(t * Math.PI) * 0.15; bell.add(ell(0.12, 0.08, 0.12, dark, Math.cos(a) * r, 2.2 - t * 2.2, Math.sin(a) * r, true)); } // cracas
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

/**
 * Junta as peças fixas de cada articulação que dividem material (placas, espinhos, juntas) numa
 * malha só — o mesmo visual com bem menos chamadas de desenho por criatura. Peças animadas
 * (as referenciadas pelo rig ou com userData) ficam separadas.
 */
export function compactRig(rig: CreatureRig): CreatureRig {
  const keep = new Set<THREE.Object3D>();
  const add = (v: unknown) => { if (v instanceof THREE.Object3D) keep.add(v); else if (Array.isArray(v)) v.forEach(add); };
  const acc = new Set<THREE.Object3D>(rig.accents.filter((a) => a !== rig.core));
  const rim = new Set<THREE.Object3D>(rig.rims);
  for (const [k, v] of Object.entries(rig)) if (k !== "accents" && k !== "rims") add(v);
  if (rig.core) keep.add(rig.core);
  // o joelho só é posado na montagem: pode ser achatado
  rig.root.traverse((o) => { if (Object.keys(o.userData).length) { keep.add(o); for (const [k, v] of Object.entries(o.userData)) if (k !== "knee") add(v); } });
  // grupos intermediários sem animação (ex.: joelho) são achatados no pai
  const flatten = (node: THREE.Object3D) => {
    for (const ch of [...node.children]) {
      flatten(ch);
      if ((ch as THREE.Group).isGroup && !keep.has(ch) && ch.visible) {
        ch.updateMatrix();
        for (const gc of [...ch.children]) { gc.updateMatrix(); gc.matrix.premultiply(ch.matrix); gc.matrix.decompose(gc.position, gc.quaternion, gc.scale); node.add(gc); }
        node.remove(ch);
      }
    }
  };
  flatten(rig.root);
  const visit = (node: THREE.Object3D) => {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const ch of node.children) {
      const m = ch as THREE.Mesh;
      if (!m.isMesh || keep.has(m) || m.children.length || Array.isArray(m.material) || !m.visible) continue;
      const g = m.geometry;
      const mat = m.material as THREE.MeshBasicMaterial;
      const k = `${acc.has(m) ? `acc:${mat.color.getHex()}:${mat.opacity}` : rim.has(m) ? `rim:${mat.color.getHex()}:${mat.opacity}` : mat.uuid}|${g.index ? "i" : "n"}|${Object.keys(g.attributes).sort().join(",")}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(m);
    }
    for (const ms of groups.values()) {
      if (ms.length < 2) continue;
      const geos = ms.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const one = new THREE.Mesh(merged, ms[0].material);
      one.castShadow = ms[0].castShadow; one.receiveShadow = ms[0].receiveShadow; one.renderOrder = ms[0].renderOrder;
      for (const m of ms) node.remove(m);
      node.add(one);
      if (acc.has(ms[0])) { rig.accents = rig.accents.filter((a) => !ms.includes(a)); rig.accents.push(one); }
      if (rim.has(ms[0])) { rig.rims = rig.rims.filter((a) => !ms.includes(a)); rig.rims.push(one); }
    }
    for (const ch of [...node.children]) visit(ch);
  };
  visit(rig.root);
  return rig;
}
