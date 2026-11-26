import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Sim, SimEvent } from "../core/sim";
import type { Creature } from "../core/creatures";
import type { Box } from "../core/world";
import { World } from "../core/world";
import type { LevelDef } from "../levels/types";
import { BADALO, BEACON, CARAPACA, ESTILHACO, FOLE, RISCADOR, VEU, WEAPONS } from "../config";
import { dirFromYawPitch } from "../core/math";
import * as TX from "./textures";
import { LightPool } from "./lightPool";
import { buildAgulha, buildBadalo, buildBeaconDevice, buildCarapaca, buildEstilhaco, buildFerry, buildFoleModel, buildPickup, buildRiscador, buildTearModel, buildVeu, fishDoor, rimMat, signMesh, type CreatureRig, type WeaponView } from "./models";
import { buildExtraDecor, DM } from "./decor";

export type Quality = "baixa" | "media" | "alta";

interface MatDef { mat: THREE.Material; size: number }

function makeMaterials(): Record<string, MatDef> {
  const std = (map: THREE.Texture | null, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map: map ?? undefined, roughness: 0.7, metalness: 0.05, ...o });
  const wet = (seed: number, k: number) => { const t = TX.texWetRough(seed, k); t.colorSpace = THREE.NoColorSpace; return t; };
  const grate = std(TX.texGrate(), { transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
  return {
    // pisos molhados: mapa de rugosidade com poças e manchas (reflexos irregulares)
    azulejo: { mat: std(TX.texFloorTile(), { roughness: 0.55, roughnessMap: wet(5, 0.55), metalness: 0.12, envMapIntensity: 0.9 }), size: 2 },
    "azulejo-parede": { mat: std(TX.texWallTile(), { roughness: 0.45, envMapIntensity: 0.4 }), size: 4 },
    metal: { mat: std(TX.texMetal(), { metalness: 0.55, roughness: 0.45 }), size: 1 },
    concreto: { mat: std(TX.texConcrete(), { roughness: 0.85 }), size: 2 },
    madeira: { mat: std(TX.texWood(), { roughness: 0.75 }), size: 1.5 },
    grade: { mat: grate, size: 1 },
    vidro: { mat: new THREE.MeshStandardMaterial({ color: 0x6a8ca8, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.9, depthWrite: false }), size: 1 },
    persiana: { mat: std(TX.texShutter(), { metalness: 0.4, roughness: 0.55 }), size: 1.2 },
    porta: { mat: std(TX.texDoor(), { metalness: 0.4, roughness: 0.5 }), size: 2.5 },
    quiosque: { mat: std(TX.texKiosk(), { roughness: 0.6 }), size: 3 },
    armario: { mat: std(TX.texLocker(), { metalness: 0.4, roughness: 0.5 }), size: 2 },
    balcao: { mat: std(TX.texCounter(), { roughness: 0.6 }), size: 1.5 },
    teto: { mat: std(TX.texCeiling(), { roughness: 0.9 }), size: 2 },
    gelo: { mat: std(TX.texIce(), { roughness: 0.4, roughnessMap: wet(13, 0.7), metalness: 0.0, envMapIntensity: 0.7, color: 0xd0dce2 }), size: 3 },
    "gelo-parede": { mat: std(TX.texIceWall(), { roughness: 0.5, envMapIntensity: 0.5, color: 0xd6e0e6 }), size: 3 },
    toldo: { mat: std(TX.texAwning(), { roughness: 0.9 }), size: 2 },
    bancaAzul: { mat: std(TX.texBluePaint(), { roughness: 0.6 }), size: 2 },
    comporta: { mat: std(TX.texGate(), { metalness: 0.55, roughness: 0.55 }), size: 3 },
    batente: { mat: std(TX.texHazard(), { roughness: 0.7, metalness: 0.1 }), size: 1.2 },
  };
}

/** Brilho das luminárias (sem tone mapping): passa um pouco do limiar do bloom, brilha sem estourar. */
const FIXTURE_GLOW = 1.25;
/**
 * Luz pontual perto de parede ou piso estourava a superfície para branco (corredor baixo, placa de gelo).
 * Limita a intensidade pela distância até a superfície mais próxima, para que a radiância ali fique
 * perto de 1 (antes do tone mapping): o destaque continua claro, mas mantém textura e cor.
 */
export const LIGHT_SURFACE_CAP = 3.2;
export function capIntensity(i: number, p: { x: number; y: number; z: number }, w: World): number {
  let dmin = Infinity;
  for (const b of w.boxes) {
    if (b.kind === "ceiling" || b.noRender) continue;
    const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x), dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y), dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
    if (dy === 0 && b.min.y > p.y) continue;
    const d = Math.hypot(dx, dy, dz);
    // só superfícies abaixo ou ao lado (o teto logo acima recebe luz rasante)
    if (b.min.y >= p.y) continue;
    if (d < dmin) dmin = d;
  }
  if (!isFinite(dmin)) return i;
  return Math.min(i, LIGHT_SURFACE_CAP * Math.max(0.6, dmin) ** 1.6);
}

/** Geometria de caixa com UV em coordenadas de mundo (texturas contínuas entre peças). */
function worldBoxGeo(b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }, size: number): THREE.BufferGeometry {
  const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    if (nx > 0.5) uv.setXY(i, z / size, y / size);
    else if (ny > 0.5) uv.setXY(i, x / size, z / size);
    else uv.setXY(i, x / size, y / size);
  }
  return g;
}

/** Partículas em arrays fixos: nenhuma alocação por emissão ou por quadro. */
class ParticlePool {
  points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private posA: Float32Array; private colA: Float32Array; private sizeA: Float32Array;
  // estado de simulação (estrutura de arrays)
  private p: Float32Array; private v: Float32Array; private c: Float32Array;
  private life: Float32Array; private max: Float32Array; private size: Float32Array; private grav: Float32Array;
  private n = 0;
  private tc = new THREE.Color();
  constructor(private cap: number, additive: boolean) {
    this.posA = new Float32Array(cap * 3); this.colA = new Float32Array(cap * 3); this.sizeA = new Float32Array(cap);
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.c = new Float32Array(cap * 3);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.size = new Float32Array(cap); this.grav = new Float32Array(cap);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.posA, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.colA, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TX.texGlow() } },
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * 320.0 / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: additive
        ? `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC*t.a*1.6, t.a); }`
        : `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-0.5; if (abs(p.x)+abs(p.y) > 0.5) discard; gl_FragColor = vec4(vC,1.0); }`,
      vertexColors: true, transparent: additive, depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
  get count() { return this.n; }
  emit(p: THREE.Vector3, n: number, color: number, speed: number, life: number, size: number, grav = 9, dirBias?: THREE.Vector3) {
    this.tc.set(color);
    for (let k = 0; k < n; k++) {
      let i: number;
      if (this.n < this.cap) i = this.n++;
      else { // cheio: substitui a partícula mais perto do fim
        let best = 0; for (let j = 1; j < this.n; j++) if (this.life[j] < this.life[best]) best = j; i = best;
      }
      let vx = Math.random() - 0.5, vy = Math.random() - 0.2, vz = Math.random() - 0.5;
      const l = Math.hypot(vx, vy, vz) || 1, m = (speed * (0.4 + Math.random() * 0.8)) / l;
      vx *= m; vy *= m; vz *= m;
      if (dirBias) { vx += dirBias.x * speed * 0.6; vy += dirBias.y * speed * 0.6; vz += dirBias.z * speed * 0.6; }
      const i3 = i * 3;
      this.p[i3] = p.x; this.p[i3 + 1] = p.y; this.p[i3 + 2] = p.z;
      this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
      this.c[i3] = this.tc.r; this.c[i3 + 1] = this.tc.g; this.c[i3 + 2] = this.tc.b;
      this.life[i] = life; this.max[i] = life; this.size[i] = size * (0.6 + Math.random() * 0.8); this.grav[i] = grav;
    }
  }
  update(dt: number) {
    let k = 0;
    const P = this.p, V = this.v, C = this.c;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const i3 = i * 3, k3 = k * 3;
      V[i3 + 1] -= this.grav[i] * dt;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      if (P[i3 + 1] < 0.01 && this.grav[i] > 0) { P[i3 + 1] = 0.01; V[i3] *= 0.3; V[i3 + 1] *= 0.3; V[i3 + 2] *= 0.3; }
      // compacta no lugar (mantém a ordem)
      if (k !== i) {
        P[k3] = P[i3]; P[k3 + 1] = P[i3 + 1]; P[k3 + 2] = P[i3 + 2];
        V[k3] = V[i3]; V[k3 + 1] = V[i3 + 1]; V[k3 + 2] = V[i3 + 2];
        C[k3] = C[i3]; C[k3 + 1] = C[i3 + 1]; C[k3 + 2] = C[i3 + 2];
        this.max[k] = this.max[i]; this.size[k] = this.size[i]; this.grav[k] = this.grav[i];
      }
      this.life[k] = life;
      const f = life / this.max[k];
      this.posA[k3] = P[k3]; this.posA[k3 + 1] = P[k3 + 1]; this.posA[k3 + 2] = P[k3 + 2];
      this.colA[k3] = C[k3] * f; this.colA[k3 + 1] = C[k3 + 1] * f; this.colA[k3 + 2] = C[k3 + 2] * f;
      this.sizeA[k] = this.size[k];
      k++;
    }
    this.n = k;
    this.geo.setDrawRange(0, k);
    if (k) {
      (this.geo.attributes.position as THREE.BufferAttribute).clearUpdateRanges(); (this.geo.attributes.position as THREE.BufferAttribute).addUpdateRange(0, k * 3);
      (this.geo.attributes.color as THREE.BufferAttribute).clearUpdateRanges(); (this.geo.attributes.color as THREE.BufferAttribute).addUpdateRange(0, k * 3);
      (this.geo.attributes.size as THREE.BufferAttribute).clearUpdateRanges(); (this.geo.attributes.size as THREE.BufferAttribute).addUpdateRange(0, k);
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
/** Altura do trilho circular do teto (F3): o talo do Badalo sai daqui. */
const BADALO_RAIL_Y = 8.6;
const FOLE_MAG = 8;
const WHITE = new THREE.Color(0xffffff);

interface CreatureView { rig: CreatureRig; c: Creature; shadow: THREE.Mesh; dying: number; dropY?: number }

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  vmScene = new THREE.Scene();
  vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  quality: Quality = "media";
  levelRoot = new THREE.Group();
  dynRoot = new THREE.Group();
  mats = makeMaterials();
  dynamicBoxes = new Map<string, { mesh: THREE.Mesh; box: Box; open: number; vib: number; base: THREE.Vector3 }>();
  lights: { light: THREE.PointLight; base: number; cap?: number; flicker: number; id?: string; target: number; fixture?: THREE.Mesh }[] = [];
  creatures = new Map<string, CreatureView>();
  pickups = new Map<string, THREE.Group>();
  sparks = new ParticlePool(900, true);
  shards = new ParticlePool(500, false);
  tracers: { line: THREE.Mesh; life: number }[] = [];
  projectiles = new Map<number, THREE.Sprite>();
  beaconWorld = buildBeaconDevice();
  rangeRing: THREE.Mesh;
  aimRing: THREE.Mesh;
  pulseRings: THREE.Mesh[] = [];
  rain: THREE.LineSegments | null = null;
  rainTime = { value: 0 };
  seaTime = { value: 0 };
  rainRects: [number, number, number, number, number][] = [];
  private rainPick: (u: number) => [number, number, number, number, number] = () => this.rainRects[0];
  sea: THREE.Mesh | null = null;
  ferry: THREE.Group | null = null;
  decorById = new Map<string, THREE.Object3D>();
  drips: THREE.Vector3[] = [];
  /** névoas do Véu: sprites de fumaça por nuvem (um material por nuvem, programa compartilhado) */
  cloudViews = new Map<number, { g: THREE.Group; mat: THREE.SpriteMaterial; sprites: THREE.Sprite[]; age: number; gone: number; r: number }>();
  private liveClouds = new Set<number>();
  vmAgulha = buildAgulha();
  vmFole = buildFoleModel();
  vmTear = buildTearModel();
  vm: WeaponView = this.vmAgulha;
  /** linhas do Tear no piso (fio esticado) e prévia da linha */
  private tearViews = new Map<number, THREE.Mesh>();
  private tearPreview!: THREE.Mesh;
  /** alvo travado do Badalo (anel no piso) e onda de choque */
  private badaloTarget!: THREE.Mesh;
  private waveRing!: THREE.Mesh;
  private jetT = 0;
  /** sopro: o leque recua e o fole comprime */
  soproAnim = 0;
  private vmWeapon: string | null = null;
  vmBeacon = buildBeaconDevice();
  vmLight = new THREE.PointLight(0xffffff, 2, 3);
  muzzleLight = new THREE.PointLight(0x7ff6ff, 0, 6, 2);
  lightPool!: LightPool;
  level: LevelDef | null = null;
  time = 0;
  shake = 0;
  reduceShake = false;
  recoil = 0;
  reloadAnim = 0;
  reloadDur = 1;
  switchAnim = 0;
  throwAnim = 0;
  healAnim = 0;
  landDip = 0;
  bobT = 0;
  fov = 75;
  hitFlashes: { c: string; t: number }[] = [];
  private tmpV = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpCol = new THREE.Color();
  private seenIds = new Set<string>();
  private liveProj = new Set<number>();
  menuMode = false;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.levelRoot, this.dynRoot, this.sparks.points, this.shards.points, this.muzzleLight);
    this.lightPool = new LightPool(this.scene, 12);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pm.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.25;
    // baliza no mundo
    this.beaconWorld.root.visible = false; this.scene.add(this.beaconWorld.root);
    const ringMat = (c: number) => new THREE.MeshBasicMaterial({ map: TX.texRing(), color: c, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false });
    this.rangeRing = new THREE.Mesh(new THREE.PlaneGeometry(BEACON.callRadius * 2, BEACON.callRadius * 2), ringMat(0x7ff6ff));
    this.rangeRing.rotation.x = -Math.PI / 2; this.rangeRing.visible = false; this.scene.add(this.rangeRing);
    this.aimRing = new THREE.Mesh(new THREE.PlaneGeometry(BEACON.callRadius * 2, BEACON.callRadius * 2), ringMat(0x9fffb0));
    this.aimRing.rotation.x = -Math.PI / 2; this.aimRing.visible = false; this.scene.add(this.aimRing);
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.22, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, forceSinglePass: true, transparent: true, depthWrite: false }));
    this.aimRing.add(marker); marker.rotation.x = 0; marker.position.z = 0.01;
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      r.rotation.x = -Math.PI / 2; r.visible = false; this.scene.add(r); this.pulseRings.push(r);
    }
    // viewmodel
    this.vmScene.add(this.vmCamera);
    this.vmCamera.add(this.vmAgulha.root, this.vmFole.root, this.vmTear.root);
    this.vmTear.root.position.set(0.17, -0.18, -0.36); this.vmTear.root.scale.setScalar(0.9); this.vmTear.root.visible = false;
    this.vmAgulha.root.position.set(0.17, -0.17, -0.34);
    this.vmFole.root.position.set(0.17, -0.19, -0.34); this.vmFole.root.scale.setScalar(0.78); this.vmFole.root.visible = false;
    {
      const tm = new THREE.MeshBasicMaterial({ color: 0xc89bff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.tearPreview = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.08), tm.clone()); this.tearPreview.rotation.x = -Math.PI / 2; this.tearPreview.visible = false;
      const rg = new THREE.RingGeometry(0.92, 1, 48); rg.rotateX(-Math.PI / 2);
      this.badaloTarget = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false })); this.badaloTarget.visible = false;
      const wg = new THREE.RingGeometry(0.9, 1, 64); wg.rotateX(-Math.PI / 2);
      this.waveRing = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0xffb080, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); this.waveRing.visible = false;
      this.scene.add(this.tearPreview, this.badaloTarget, this.waveRing);
    }
    for (const v of [this.vmAgulha, this.vmFole, this.vmTear]) { v.mag.userData.p0 = v.mag.position.clone(); if (v.hand) v.hand.userData.p0 = v.hand.position.clone(); }
    this.vmCamera.add(this.vmBeacon.root);
    // baliza menor na mão esquerda: não cobre a mira nem a metade esquerda da tela
    this.vmBeacon.root.position.set(-0.25, -0.22, -0.42);
    this.vmBeacon.root.scale.setScalar(0.5);
    this.vmScene.add(new THREE.HemisphereLight(0x8fb0d0, 0x202020, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(1, 2, 1); this.vmScene.add(key);
    this.vmCamera.add(this.vmLight); this.vmLight.position.set(0.3, 0.3, 0);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.lightPool.setK(q === "alta" ? 16 : q === "media" ? 12 : 10);
    this.applyPixelRatio();
  }

  /** Escala de resolução interna (1 = nativa da qualidade). Só o modo automático a reduz. */
  renderScale = 1;
  setRenderScale(k: number) {
    k = Math.max(0.6, Math.min(1, Math.round(k * 20) / 20));
    if (k === this.renderScale) return;
    this.renderScale = k; this.applyPixelRatio();
  }
  private applyPixelRatio() {
    const q = this.quality;
    const pr = q === "baixa" ? 0.75 : Math.min(window.devicePixelRatio || 1, q === "alta" ? 2 : 1.25);
    this.renderer.setPixelRatio(pr * this.renderScale);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    if (this.quality !== "baixa") {
      if (!this.composer) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.38, 0.45, 1.0);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      }
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    } else if (this.composer) { this.composer.dispose(); this.composer = null; }
  }

  clearLevel() {
    const disposeTree = (o: THREE.Object3D) => o.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    disposeTree(this.levelRoot); disposeTree(this.dynRoot);
    this.levelRoot.clear(); this.dynRoot.clear();
    for (const m of this.tearViews.values()) m.removeFromParent(); this.tearViews.clear();
    this.badaloTarget.visible = false; this.waveRing.visible = false; this.tearPreview.visible = false; this.jetT = 0;
    this.dynamicBoxes.clear(); this.lights = []; this.lightPool.clear(); this.creatures.clear(); this.pickups.clear(); this.decorById.clear();
    for (const s of this.projectiles.values()) s.removeFromParent(); this.projectiles.clear();
    for (const t of this.tracers) { t.line.removeFromParent(); this.tracerFree.push(t.line); } this.tracers = [];
    this.sparks.clear(); this.shards.clear();
    this.rain = null; this.sea = null; this.ferry = null; this.drips = [];
    for (const cv of this.cloudViews.values()) cv.g.removeFromParent(); this.cloudViews.clear();
  }

  /** Monta a cena estática da fase. */
  buildLevel(level: LevelDef, world?: World) {
    this.clearLevel();
    this.level = level;
    const w = world ?? (() => { const x = new World(); level.build(x); return x; })();
    const env = level.env;
    this.scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);
    this.scene.background = new THREE.Color(env.fogColor);
    this.levelRoot.add(new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.ambient * 2.2));
    // caixas estáticas mescladas por material
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const b of w.boxes) {
      if (b.noRender) continue; // só colisão: o visual vem da decoração
      const md = this.mats[b.mat] ?? this.mats.concreto;
      const dynamic = !b.id.startsWith("b");
      const geo = worldBoxGeo(b, md.size);
      if (dynamic) {
        const center = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
        geo.translate(-center.x, -center.y, -center.z);
        const mesh = new THREE.Mesh(geo, md.mat);
        mesh.position.copy(center);
        mesh.receiveShadow = true;
        this.dynRoot.add(mesh);
        this.dynamicBoxes.set(b.id, { mesh, box: b, open: b.enabled ? 0 : 1, vib: 0, base: center.clone() });
        continue;
      }
      if (!groups.has(b.mat)) groups.set(b.mat, []);
      groups.get(b.mat)!.push(geo);
    }
    for (const c of level.ceilings) {
      const geo = worldBoxGeo(c, this.mats.teto.size);
      if (!groups.has("teto")) groups.set("teto", []);
      groups.get("teto")!.push(geo);
    }
    for (const [mat, geos] of groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, (this.mats[mat] ?? this.mats.concreto).mat);
      mesh.receiveShadow = true;
      if (mat === "vidro") mesh.renderOrder = 5;
      this.levelRoot.add(mesh);
    }
    // luzes
    const fixtureMats = new Map<string, THREE.MeshBasicMaterial>();
    for (const l of level.lights) {
      const pl = new THREE.PointLight(l.color, 0, l.distance * 1.3, 1.6);
      pl.position.set(l.pos.x, l.pos.y, l.pos.z);
      // luminárias sem id dividem material por cor (e depois são mescladas); as com id mudam de cor em jogo
      const fkey = `${l.color}|${l.intensity > 0}`;
      const fmat = l.id ? new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color).multiplyScalar(l.intensity > 0 ? FIXTURE_GLOW : 0.1), toneMapped: false })
        : (fixtureMats.get(fkey) ?? fixtureMats.set(fkey, new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color).multiplyScalar(l.intensity > 0 ? FIXTURE_GLOW : 0.1), toneMapped: false })).get(fkey)!);
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.16), fmat);
      if (l.id) fixture.userData.keep = true;
      fixture.position.set(l.pos.x, l.pos.y + 0.12, l.pos.z);
      this.levelRoot.add(pl, fixture);
      this.lightPool.add(pl);
      const cap = capIntensity(1e9, l.pos, w);
      this.lights.push({ light: pl, base: Math.min(cap, l.intensity * 2.2), cap, flicker: l.flicker ?? 0, id: l.id, target: l.intensity > 0 ? 1 : 0, fixture });
    }
    // céu, mar e chuva
    if (env.sky) {
      const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), new THREE.MeshBasicMaterial({ map: TX.texSky(), side: THREE.BackSide, fog: false }));
      this.levelRoot.add(sky);
      const moon = new THREE.DirectionalLight(0x6f8fc0, 0.6); moon.position.set(-40, 60, -80); this.levelRoot.add(moon);
      const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.texGlow(), color: 0xc8d8ff, fog: false, depthWrite: false }));
      moonDisc.position.set(-90, 120, -240); moonDisc.scale.setScalar(36); this.levelRoot.add(moonDisc);
    }
    if (env.sea) {
      const sg = new THREE.PlaneGeometry(320, 130, 64, 26);
      const sr = env.seaRect;
      if (sr) { sg.dispose(); }
      const sg2 = sr ? new THREE.PlaneGeometry(sr.w, sr.d, 64, 26) : sg;
      sg2.rotateX(-Math.PI / 2); sg2.translate(sr ? sr.x : 50, -1.2, sr ? sr.z : -76);
      const seaMat = new THREE.MeshStandardMaterial({ color: 0x0b2230, roughness: 0.18, metalness: 0.6, envMapIntensity: 1.2 });
      // ondas no shader (mesma fórmula de antes, normal analítica): nada de recalcular malha na CPU
      seaMat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.seaTime;
        sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader
          .replace("#include <beginnormal_vertex>", `
  float wx = position.x * 0.15 + uTime * 0.9, wz = position.z * 0.21 + uTime * 0.7;
  vec3 objectNormal = normalize(vec3(-0.15 * 0.18 * cos(wx), 1.0, 0.21 * 0.14 * sin(wz)));
  #ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
  #endif`)
          .replace("#include <begin_vertex>", "#include <begin_vertex>\n  transformed.y += sin(wx) * 0.18 + cos(wz) * 0.14;");
      };
      this.sea = new THREE.Mesh(sg2, seaMat);
      this.sea.frustumCulled = false;
      this.levelRoot.add(this.sea);
    }
    if (env.sea && (env.quay ?? !env.seaRect)) {
      const quay = new THREE.Mesh(new THREE.BoxGeometry(110, 1, 5), this.mats.concreto.mat); quay.position.set(50, -0.7, -11.7); this.levelRoot.add(quay);
      for (let i = 0; i < 10; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.8, 8), this.mats.metal.mat); post.position.set(4 + i * 10, -0.2, -13.4); this.levelRoot.add(post);
      }
      for (let i = 0; i < 4; i++) {
        const lamp = new THREE.PointLight(0xffb060, 18, 18, 1.6); lamp.position.set(10 + i * 26, 5, -13.5); this.levelRoot.add(lamp); this.lightPool.add(lamp);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.5), this.mats.metal.mat); pole.position.set(10 + i * 26, 2.2, -13.6); this.levelRoot.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xffc070, toneMapped: false })); bulb.position.set(10 + i * 26, 5, -13.5); this.levelRoot.add(bulb);
      }
    }
    if (env.rain) {
      // chuva animada no shader de vértice: nenhuma atualização de buffer por quadro
      this.rainRects = env.rainRects ?? [[62, -9, 88, 9, 0], [-10, -60, 110, -9.4, -1.2]];
      const areaW = this.rainRects.map((r) => Math.max(1, (r[2] - r[0]) * (r[3] - r[1])) ** 0.5);
      const areaSum = areaW.reduce((a, b) => a + b, 0);
      this.rainPick = (u: number) => { let acc = 0; for (let i = 0; i < areaW.length; i++) { acc += areaW[i] / areaSum; if (u <= acc) return this.rainRects[i]; } return this.rainRects[areaW.length - 1]; };
      const N = this.quality === "baixa" ? 700 : 1800;
      const pos = new Float32Array(N * 6), drop = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        const r = env.rainRects ? this.rainPick(Math.random()) : this.rainRects[Math.random() < 0.45 ? 0 : 1];
        const x = r[0] + Math.random() * (r[2] - r[0]), z = r[1] + Math.random() * (r[3] - r[1]);
        const floorY = r[4];
        pos.set([x, 0, z, x + 0.03, 0.45, z + 0.02], i * 6);
        const y0 = Math.random() * 20;
        drop.set([y0, floorY, y0, floorY], i * 4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aDrop", new THREE.BufferAttribute(drop, 2));
      const mat = new THREE.LineBasicMaterial({ color: 0x8fa8c0, transparent: true, opacity: 0.35, depthWrite: false });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.rainTime;
        sh.vertexShader = "uniform float uTime;\nattribute vec2 aDrop;\n" + sh.vertexShader.replace("#include <begin_vertex>",
          "#include <begin_vertex>\n  float span = 20.0 - aDrop.y;\n  transformed.y += aDrop.y + mod(aDrop.x - uTime * 16.0, span);");
      };
      this.rain = new THREE.LineSegments(g, mat);
      this.rain.frustumCulled = false;
      this.levelRoot.add(this.rain);
    }
    // decoração (cada peça precisa encostar em algo: piso, parede, teto ou suporte)
    this.propWorld = w; this.propReport = [];
    for (const d of level.decor) this.buildDecor(d);
    this.sparks.clear(); this.shards.clear();
    this.mergeStatic();
    this.warmup();
  }

  /**
   * Mescla malhas estáticas e opacas da decoração (sem id), postes, luminárias etc. por material.
   * Mesmo desenho, bem menos chamadas de desenho.
   */
  private mergeStatic() {
    this.levelRoot.updateMatrixWorld(true);
    const dyn = new Set<THREE.Object3D>();
    for (const g of this.decorById.values()) g.traverse((o) => dyn.add(o));
    if (this.ferry) this.ferry.traverse((o) => dyn.add(o));
    const groups = new Map<string, { mat: THREE.Material; meshes: THREE.Mesh[] }>();
    this.levelRoot.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || dyn.has(m) || m.userData.keep || m === this.sea || m.parent === this.levelRoot && m.geometry.attributes.position.count > 5000) return;
      const mat = m.material as THREE.Material;
      if (Array.isArray(m.material) || mat.transparent || !m.visible || m.renderOrder !== 0) return;
      const g = m.geometry; const a = g.attributes;
      if (!a.position || !a.normal || !a.uv || Object.keys(a).length !== 3 || g.morphAttributes.position) return;
      // só malhas fora de grupos animados; o próprio objeto e ancestrais precisam ser visíveis
      let p: THREE.Object3D | null = m.parent, ok = true;
      while (p && p !== this.levelRoot) { if (!p.visible) { ok = false; break; } p = p.parent; }
      if (!ok) return;
      const key = mat.uuid + (g.index ? "i" : "n");
      if (!groups.has(key)) groups.set(key, { mat, meshes: [] });
      groups.get(key)!.meshes.push(m);
    });
    for (const { mat, meshes } of groups.values()) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); }
      const mm = new THREE.Mesh(merged, mat);
      mm.matrixAutoUpdate = false;
      this.levelRoot.add(mm);
    }
    // grupos que ficaram vazios saem da cena
    for (const c of [...this.levelRoot.children]) if (c.type === "Group" && c.children.length === 0 && !dyn.has(c)) c.removeFromParent();
  }

  /** Compila os shaders de tudo o que pode aparecer na fase durante o carregamento (sem engasgos na primeira aparição). */
  private warmup() {
    const tmp = new THREE.Group();
    const r = buildRiscador(), e = buildEstilhaco(), vu = buildVeu();
    tmp.add(r.root, e.root, vu.root);
    if (this.level?.id === "F3") { const ca = buildCarapaca(), ba = buildBadalo(); tmp.add(ca.root, ba.root); for (const m of [...ca.rims, ...ba.rims]) m.visible = true; }
    for (const o of [this.tearPreview, this.badaloTarget, this.waveRing]) if (!o.visible) { o.visible = true; tmp.userData.hideAfter = [...(tmp.userData.hideAfter ?? []), o]; }
    tmp.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.texSmoke(), transparent: true, opacity: 0.5, depthWrite: false })));
    if (e.beam) { e.beam.visible = true; tmp.add(e.beam); }
    for (const m of [...r.rims, ...e.rims]) m.visible = true;
    r.mark.visible = true; e.mark.visible = true;
    tmp.add(new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    tmp.add(new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })));
    tmp.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.texGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    tmp.add(buildPickup("dardos"), buildPickup("curativo"), buildPickup("fole"), buildPickup("tear"));
    const vis: THREE.Object3D[] = [];
    for (const id of ["seta-comporta"]) { const a = this.decorById.get(id); if (a && !a.visible) { a.visible = true; vis.push(a); } }
    for (const o of [this.beaconWorld.root, this.rangeRing, this.aimRing, ...this.pulseRings]) if (!o.visible) { o.visible = true; vis.push(o); }
    this.scene.add(tmp);
    try {
      this.renderer.compile(this.scene, this.camera);
      const vv = [this.vmAgulha.root, this.vmFole.root, this.vmTear.root, this.vmBeacon.root, this.vmAgulha.flash, this.vmFole.flash, this.vmTear.flash].filter((o) => !o.visible);
      vv.forEach((o) => (o.visible = true));
      this.renderer.compile(this.vmScene, this.vmCamera);
      vv.forEach((o) => (o.visible = false));
    } catch { /* sem contexto (testes) */ }
    for (const o of vis) o.visible = false;
    for (const o of (tmp.userData.hideAfter ?? []) as THREE.Object3D[]) o.visible = false;
    this.scene.remove(tmp);
    tmp.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== this.tracerGeo) m.geometry.dispose(); });
  }

  private buildDecor(d: { kind: string; pos: { x: number; y: number; z: number }; rot?: number; size?: { x: number; y: number; z: number }; color?: number; text?: string; id?: string }) {
    const g = new THREE.Group();
    g.position.set(d.pos.x, d.pos.y, d.pos.z);
    g.rotation.y = d.rot ?? 0;
    g.name = d.kind;
    switch (d.kind) {
      case "sign": case "shelterSign": {
        const m = signMesh(d.text ?? "", d.color ?? 0xffffff);
        g.add(m);
        const pl = new THREE.PointLight(d.color ?? 0xffffff, 3, 4, 2); pl.position.z = 0.4; g.add(pl); g.userData.vlights = [pl];
        break;
      }
      case "arrow": {
        const shape = new THREE.Shape(); shape.moveTo(-0.3, -0.1); shape.lineTo(0.1, -0.1); shape.lineTo(0.1, -0.25); shape.lineTo(0.4, 0); shape.lineTo(0.1, 0.25); shape.lineTo(0.1, 0.1); shape.lineTo(-0.3, 0.1);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }));
        m.rotation.y = Math.PI / 2; g.add(m);
        g.userData.pulse = true;
        break;
      }
      case "chalk": {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: TX.texChalk(), transparent: true, depthWrite: false, opacity: 0.85 }));
        m.rotation.x = -Math.PI / 2; m.position.y = 0.012; g.add(m);
        break;
      }
      case "bell": {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.28, 0.4, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), this.mats.metal.mat); arm.position.set(0, 0.25, -0.3);
        g.add(bell, arm); g.userData.swing = 0;
        break;
      }
      case "hatch": case "doorFrame": {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.12), new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: 0.6 }));
        frame.position.y = 1.2;
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.08), this.mats.porta.mat);
        door.position.set(0, 1.08, 0.08);
        const warn = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.12), new THREE.MeshBasicMaterial({ color: 0xff6030, toneMapped: false }));
        warn.position.set(0, 2.3, 0.13);
        g.add(frame, door, warn);
        g.userData.door = door; g.userData.vib = 0; g.userData.open = 0;
        break;
      }
      case "latch": {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.15), new THREE.MeshStandardMaterial({ color: 0x4a5258, metalness: 0.6, roughness: 0.4 }));
        const grille = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.9 }));
        grille.position.set(0, 0.05, 0.08);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.035), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }));
        led.position.set(0, -0.17, 0.08);
        g.add(box, grille, led); g.userData.led = led;
        break;
      }
      case "glassShards": {
        for (let i = 0; i < 14; i++) {
          const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.05 + Math.random() * 0.08), new THREE.MeshStandardMaterial({ color: 0x9fc0d0, transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.8 }));
          s.position.set((Math.random() - 0.5) * 5, 0.02 + Math.random() * 0.02, (Math.random() - 0.5) * 3);
          s.rotation.set(Math.random() * 3, Math.random() * 3, 0);
          g.add(s);
        }
        const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 0.06), this.mats.metal.mat); frame.position.y = 1.4; g.add(frame);
        for (let i = 0; i < 5; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.05), this.mats.metal.mat); bar.position.set(-3 + i * 1.5, 0.75, 0); bar.rotation.z = i === 2 ? 0.4 : 0; g.add(bar); }
        break;
      }
      case "cot": {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.8), new THREE.MeshStandardMaterial({ color: 0x4f5a3a, roughness: 0.9 })); c.position.y = 0.45; g.add(c);
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), this.mats.madeira.mat); crate.position.set(1.6, 0.25, 0.2); g.add(crate);
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.25, 8), new THREE.MeshBasicMaterial({ color: 0xffb050, toneMapped: false })); lamp.position.set(1.6, 0.65, 0.2); g.add(lamp);
        break;
      }
      case "panel": {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.18), new THREE.MeshStandardMaterial({ color: 0x3a4248, metalness: 0.6, roughness: 0.4 }));
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshBasicMaterial({ map: TX.texSign("BLOQUEADO", "#ff4040", 512, 256), toneMapped: false }));
        screen.position.set(0, 0.12, 0.1);
        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0xd04020 }));
        lever.position.set(0.22, -0.25, 0.14);
        g.add(box, screen, lever); g.userData.screen = screen; g.userData.lever = lever;
        // marcador acima dos obstáculos
        const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xff4040, toneMapped: false }));
        beacon.position.set(0, 0.9, 0.3); g.add(beacon); g.userData.marker = beacon;
        break;
      }
      case "gateLight": {
        const bars = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.05), mat); b1.rotation.z = 0.7;
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.05), mat); b2.rotation.z = -0.7;
        bars.add(b1, b2);
        const arrow = new THREE.Group();
        const am = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.05), am);
        const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), am); s2.position.set(0.2, 0.12, 0); s2.rotation.z = -0.7;
        const s3 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), am); s3.position.set(0.2, -0.12, 0); s3.rotation.z = 0.7;
        arrow.add(s1, s2, s3); arrow.visible = false;
        g.add(bars, arrow); g.userData.bars = bars; g.userData.arrow = arrow;
        break;
      }
      case "turnstile": {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1, 10), this.mats.metal.mat); post.position.y = 0.5;
        g.add(post);
        for (let i = 0; i < 3; i++) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8), this.mats.metal.mat); arm.rotation.z = Math.PI / 2; arm.rotation.y = (i * Math.PI * 2) / 3; arm.position.y = 0.95; arm.translateX(0.4); g.add(arm); }
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); top.position.y = 1.05; g.add(top);
        break;
      }
      case "fish": { const f = fishDoor(); f.position.y = 0; g.add(f); g.position.y = d.pos.y; break; }
      case "window": {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(d.size?.x ?? 2, d.size?.y ?? 1), new THREE.MeshBasicMaterial({ color: 0x1a2a40, transparent: true, opacity: 0.5 }));
        g.add(m);
        break;
      }
      case "lockerLia": {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.6), this.mats.armario.mat);
        door.position.set(0.62, 1.0, 0.25); door.rotation.y = -1.1;
        const glow = new THREE.PointLight(0x7ff6ff, 4, 3, 2); glow.position.set(0, 1.4, 0.4);
        const gun = buildAgulha().root; gun.traverse((o) => { o.frustumCulled = true; }); gun.scale.setScalar(1.6); gun.rotation.set(0, Math.PI / 2, Math.PI / 2.2); gun.position.set(0, 1.25, 0.1);
        const bea = buildBeaconDevice().root; bea.position.set(0.25, 0.5, 0.1); bea.scale.setScalar(1.6);
        g.add(door, glow, gun, bea);
        g.userData.items = [gun, bea]; g.userData.glow = glow; g.userData.vlights = [glow];
        break;
      }
      case "drip": { this.drips.push(new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z)); break; }
      case "ferry": { const f = buildFerry(); g.add(f); this.ferry = g; break; }
      default: {
        const vl: THREE.PointLight[] = [];
        if (buildExtraDecor(g, d, { lights: vl })) { if (vl.length) g.userData.vlights = vl; }
        break;
      }
      case "dock": {
        for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), this.mats.madeira.mat); p.position.set(-14 + i * 6, -1, -6); g.add(p); }
        const plank = new THREE.Mesh(new THREE.BoxGeometry(36, 0.3, 3), this.mats.madeira.mat); plank.position.set(1, 0.9, -6); g.add(plank);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0x8a7a5a })); rope.position.set(-6, 0.2, -14); rope.rotation.set(1.2, 0, 0.3); g.add(rope);
        break;
      }
    }
    this.levelRoot.add(g);
    this.checkProp(d, g);
    for (const l of (g.userData.vlights ?? []) as THREE.PointLight[]) this.lightPool.add(l);
    if (d.id) this.decorById.set(d.id, g);
    if (d.id === "seta-comporta") g.visible = false; // acende quando a comporta abre
  }

  private propWorld: World | null = null;
  /** Peças de decoração e o apoio encontrado (piso/parede/teto); "" = solta no ar. */
  propReport: { kind: string; id?: string; pos: { x: number; y: number; z: number }; min: number[]; max: number[]; support: string }[] = [];
  private checkProp(d: { kind: string; id?: string; pos: { x: number; y: number; z: number } }, g: THREE.Object3D) {
    const w = this.propWorld; if (!w || !this.level) return;
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld); bb.union(b); } });
    if (bb.isEmpty()) return;
    const eps = 0.06;
    const hit = (b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) =>
      bb.min.x <= b.max.x + eps && bb.max.x >= b.min.x - eps && bb.min.y <= b.max.y + eps && bb.max.y >= b.min.y - eps && bb.min.z <= b.max.z + eps && bb.max.z >= b.min.z - eps;
    // portas, persianas e grades que abrem não servem de apoio (a peça ficaria no ar com a porta aberta)
    const fixed = w.boxes.filter((b) => b.id.startsWith("b") || !(b.mat === "porta" || b.mat === "persiana" || b.kind === "grate"));
    const find = () => {
      for (const b of fixed) if (hit(b)) return b.max.y <= bb.min.y + eps ? "piso" : b.min.y >= bb.max.y - eps ? "teto" : "parede";
      for (const c of this.level!.ceilings) if (hit(c)) return "teto";
      if (bb.min.y < -0.5) return "água"; // balsa, cais e casa de bombas no mar
      return "";
    };
    let support = find();
    if (!support) support = this.fixFloating(d, g, bb, w);
    this.propReport.push({ kind: d.kind, id: d.id, pos: d.pos, min: bb.min.toArray().map((v) => +v.toFixed(2)), max: bb.max.toArray().map((v) => +v.toFixed(2)), support });
  }

  /**
   * Peça solta: encosta na parede se estiver a poucos centímetros; senão ganha suporte visível —
   * hastes até o teto (ou laje acima) ou pés até o piso/bancada logo abaixo; por fim, um braço até a parede.
   */
  private fixFloating(d: { kind: string }, g: THREE.Object3D, bb: THREE.Box3, w: World): string {
    const all = [...w.boxes, ...this.level!.ceilings];
    const ovY = (b: { min: { y: number }; max: { y: number } }) => b.min.y < bb.max.y && b.max.y > bb.min.y;
    // 1) parede a até 35 cm: encosta
    let best = 0.35, move: [number, number] | null = null;
    for (const b of w.boxes) {
      if (!ovY(b) || !(b.id.startsWith("b") || !(b.mat === "porta" || b.mat === "persiana" || b.kind === "grate"))) continue;
      const ovX = b.min.x < bb.max.x && b.max.x > bb.min.x, ovZ = b.min.z < bb.max.z && b.max.z > bb.min.z;
      if (ovX) { const g1 = b.min.z - bb.max.z, g2 = bb.min.z - b.max.z; if (g1 >= 0 && g1 < best) { best = g1; move = [0, g1 - 0.005]; } if (g2 >= 0 && g2 < best) { best = g2; move = [0, -(g2 - 0.005)]; } }
      if (ovZ) { const g1 = b.min.x - bb.max.x, g2 = bb.min.x - b.max.x; if (g1 >= 0 && g1 < best) { best = g1; move = [g1 - 0.005, 0]; } if (g2 >= 0 && g2 < best) { best = g2; move = [-(g2 - 0.005), 0]; } }
    }
    if (move) { g.position.x += move[0]; g.position.z += move[1]; bb.translate(new THREE.Vector3(move[0], 0, move[1])); return "parede (encostada)"; }
    // 2) suporte vertical: abaixo (placas e setas sobre bancada/piso perto) ou acima (teto/laje)
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const over = (b: { min: { x: number; z: number }; max: { x: number; z: number } }, x: number, z: number) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;
    let up = Infinity, down = Infinity;
    for (const b of all) { if (!over(b, cx, cz)) continue; if (b.min.y >= bb.max.y - 0.01) up = Math.min(up, b.min.y - bb.max.y); if (b.max.y <= bb.min.y + 0.01) down = Math.min(down, bb.min.y - b.max.y); }
    const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
    const ends: [number, number][] = d.kind === "hangLamp" || d.kind === "gateLight" ? [[cx, cz]] : sx >= sz ? [[bb.min.x + sx * 0.15, cz], [bb.max.x - sx * 0.15, cz]] : [[cx, bb.min.z + sz * 0.15], [cx, bb.max.z - sz * 0.15]];
    const rodMat = DM.darkSteel();
    const rods = (y0: number, len: number) => { for (const [x, z] of ends) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len + 0.04, 5), rodMat); r.position.set(x, y0 + len / 2, z); this.levelRoot.add(r); } };
    const signLike = d.kind === "sign" || d.kind === "arrow" || d.kind === "panel";
    if (signLike && down <= 1.4) { rods(bb.min.y - down, down); return "piso (pés)"; }
    if (up <= 5) { rods(bb.max.y, up); return "teto (hastes)"; }
    if (down <= 3) { rods(bb.min.y - down, down); return "piso (pés)"; }
    // cenário distante (fora da área jogável) sobre o mar: base de concreto até abaixo da linha d'água
    const wb = w.bounds;
    if (bb.min.x > wb.maxX || bb.max.x < wb.minX || bb.min.z > wb.maxZ || bb.max.z < wb.minZ) {
      const h = bb.min.y + 2.2;
      const base = new THREE.Mesh(new THREE.BoxGeometry(sx * 1.02, h, sz * 1.02), this.mats.concreto.mat);
      base.position.set(cx, bb.min.y - h / 2, cz); this.levelRoot.add(base);
      return "piso (base)";
    }
    return "";
  }

  /** Reage aos eventos da simulação (efeitos visuais). */
  onEvents(evs: SimEvent[], sim: Sim) {
    for (const e of evs) {
      switch (e.type) {
        case "shot": if (e.weapon === "fole") { this.foleShot(e); break; } if (e.weapon === "tear") { this.tearShot(e); break; } // fallthrough para a Agulha
        // eslint-disable-next-line no-fallthrough
        case "mark": {
          const from = this.vm.muzzle.getWorldPosition(new THREE.Vector3());
          // muzzle no espaço do viewmodel → aproxima no mundo a partir da câmera
          const cam = this.camera;
          const off = new THREE.Vector3(0.17, -0.15, -0.6).applyQuaternion(cam.quaternion);
          from.copy(cam.position).add(off);
          const to = new THREE.Vector3(e.to.x, e.to.y, e.to.z);
          this.addTracer(from, to, e.type === "mark" ? 0xb0ffd0 : 0x7ff6ff, e.type === "mark" ? 0.03 : 0.018);
          this.recoil = 1; this.vmAgulha.flash.visible = true; this.vmAgulha.flash.material.rotation = Math.random() * 6;
          this.muzzleLight.color.set(0x7ff6ff); this.muzzleLight.position.copy(from); this.muzzleLight.intensity = 6;
          if (e.hit) {
            this.shards.emit(to, e.killed ? 4 : 9, 0xe8e0d0, 3.5, 0.6, 0.05, 9);
            this.sparks.emit(to, 6, e.marked ? 0x9fffd0 : 0x7ff6ff, 4, 0.25, 0.12, 2);
            this.hitFlashes.push({ c: e.hit, t: 0.1 });
          } else if (e.normal) {
            const n = new THREE.Vector3(e.normal.x, e.normal.y, e.normal.z);
            this.sparks.emit(to, 8, 0xbff8ff, 3, 0.35, 0.09, 6, n);
            this.shards.emit(to, 3, 0x777777, 2, 0.5, 0.03, 9, n);
          }
          break;
        }
        case "kill": {
          const p = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
          this.shards.emit(p, 26, 0x4a2e28, 3, 0.9, 0.06, 10); // respingo escuro (orgânico)
          this.sparks.emit(p, 10, e.ctype === "estilhaco" || e.ctype === "carapaca" ? 0xffa060 : e.ctype === "veu" ? 0x7ff0d0 : 0x7ff6ff, 2, 0.5, 0.12, 1);
          this.shake = Math.max(this.shake, 0.15);
          break;
        }
        case "hurt": this.shake = Math.max(this.shake, 0.5); break;
        case "land": this.sparks.emit(new THREE.Vector3(e.pos.x, e.pos.y + 0.05, e.pos.z), 10, 0xffffff, 2.5, 0.3, 0.06, 6); break;
        case "scratch": case "scratch2": this.sparks.emit(new THREE.Vector3(e.pos.x, e.pos.y + 0.03, e.pos.z), 14, 0xffc080, 2.5, 0.35, 0.07, 6); break;
        case "projHit": this.sparks.emit(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z), 18, 0xff9050, 4, 0.4, 0.14, 4); break;
        case "reload": this.reloadAnim = e.time; this.reloadDur = e.time; break;
        case "switch": this.switchAnim = 0.45; break;
        case "beaconThrow": this.throwAnim = 0.4; break;
        case "healStart": this.healAnim = 0.6; break;
        case "doorOpen": {
          for (const k of [e.id, e.id + "-quadro"]) { const d = this.decorById.get(k); if (d) d.userData.opening = true; }
          if (e.id === "comporta") this.shake = Math.max(this.shake, 0.35);
          break;
        }
        case "doorVibrate": {
          const key = e.decor ?? (e.door === "superior" ? "porta-superior" : e.door === "leste" ? "porta-leste" : e.door === "alcapao" ? "alcapao" : "porta-oficina");
          const dyn = this.dynamicBoxes.get(key);
          if (dyn) dyn.vib = 1.2;
          for (const k of [key, key + "-quadro"]) { const d = this.decorById.get(k); if (d) d.userData.vib = 1.2; }
          this.sparks.emit(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z), 10, 0xffa050, 2, 0.8, 0.06, 3);
          break;
        }
        case "latchOpen": { const d = this.decorById.get("trinco"); if (d) (d.userData.led.material as THREE.MeshBasicMaterial).color.set(0x40ff70); break; }
        case "bell": { const d = this.decorById.get("sino"); if (d) d.userData.swing = 1; break; }
        case "lightOn": { this.lampOn(e.id); const l = this.lights.find((x) => x.id === e.id); if (l) { l.target = 1; l.base = Math.min(20, l.cap ?? 20); (l.fixture!.material as THREE.MeshBasicMaterial).color.set(0xe8f4ff).multiplyScalar(FIXTURE_GLOW); } break; }
        case "panel": {
          const p = this.decorById.get("painel");
          if (p) { (p.userData.screen.material as THREE.MeshBasicMaterial).map = TX.texSign("LIBERADO →", "#60ff90", 512, 256); (p.userData.screen.material as THREE.MeshBasicMaterial).needsUpdate = true; p.userData.lever.rotation.x = 0.9; (p.userData.marker.material as THREE.MeshBasicMaterial).color.set(0xffffff); }
          const gl = this.decorById.get("luz-portao"); if (gl) { gl.userData.bars.visible = false; gl.userData.arrow.visible = true; }
          const lc = this.lights.find((x) => x.id === "luz-catraca"); if (lc) lc.light.color.set(0xe8fff0);
          break;
        }
        case "arenaCleared": {
          const p = this.decorById.get("painel");
          if (p) { (p.userData.screen.material as THREE.MeshBasicMaterial).map = TX.texSign("PRESSIONE", "#ffffff", 512, 256); (p.userData.screen.material as THREE.MeshBasicMaterial).needsUpdate = true; p.userData.ready = true; }
          break;
        }
        case "equip": if (e.what === "tear") { this.hideBench("bancada-tear"); break; } if (e.what === "fole") { const b = this.decorById.get("bancada-fole"); if (b) { for (const it of b.userData.items) it.visible = false; b.userData.glow.intensity = 0.3; } break; } else { const l = this.decorById.get("armario-lia"); if (l) { for (const it of l.userData.items) it.visible = false; l.userData.glow.intensity = 0.5; } break; }
        case "levelStart": { // estado restaurado de um registro (ex.: F2-B com o registro da praça já aberto)
          for (const id of ["registro1", "registro2"]) { const d = this.decorById.get(id); if (d && sim.flags[id]) { (d.userData.led.material as THREE.MeshBasicMaterial).color.set(0x40ff70); d.userData.wheel.rotation.z = 2.4; } }
          if (sim.flags.tear) this.hideBench("bancada-tear");
          for (const id of ["bomba1", "bomba2"]) if (sim.flags[id]) { const d = this.decorById.get(id); if (d?.userData.lamp) (d.userData.lamp.material as THREE.MeshBasicMaterial).color.set(0x40ff70); const l = this.lights.find((x) => x.id === `luz-${id}`); if (l) l.light.color.set(0x8fffb0); }
          if (sim.flags.bomba2) for (const id of ["lampada-1", "lampada-2"]) this.lampOn(id);
          if (sim.flags.fole) { const b = this.decorById.get("bancada-fole"); if (b) { for (const it of b.userData.items) it.visible = false; b.userData.glow.intensity = 0.3; } }
          break;
        }
        case "sopro": {
          this.soproAnim = 0.5;
          const dir = this.tmpB.set(e.dir.x, 0.05, e.dir.z);
          for (let i = 1; i <= 6; i++) {
            this.tmpA.set(e.from.x + e.dir.x * i * 0.9, e.from.y - 0.25, e.from.z + e.dir.z * i * 0.9);
            this.sparks.emit(this.tmpA, 3, 0xcfe8e4, 2.5, 0.35, 0.16, 0, dir);
          }
          this.shake = Math.max(this.shake, 0.12);
          break;
        }
        case "cloud": { this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y, e.pos.z), 16, 0x9fe8d8, 2, 0.6, 0.2, -0.5); break; }
        case "veuSwell": { this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y, e.pos.z), 10, 0x7ff0d8, 1.2, 0.8, 0.12, -0.3); break; }
        case "valve": {
          const d = this.decorById.get(e.id);
          if (d) { d.userData.turning = 1.1; (d.userData.led.material as THREE.MeshBasicMaterial).color.set(0x40ff70); }
          this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y, e.pos.z), 12, 0xd0e8ff, 1.5, 0.5, 0.08, 4);
          break;
        }
        case "gateStart": { const d = this.decorById.get("segmentos"); if (d) d.userData.active = true; const l = this.lights.find((x) => x.id === "luz-comporta"); if (l) l.light.color.set(0xffa030); break; }
        case "gateSegment": {
          const d = this.decorById.get("segmentos");
          if (d) { const seg = d.userData.segs[e.n - 1] as THREE.Mesh; if (seg) (seg.material as THREE.MeshBasicMaterial).color.set(0x50ff80); d.userData.lit = e.n; }
          this.shake = Math.max(this.shake, 0.08);
          break;
        }
        case "gateOpen": {
          const d = this.decorById.get("segmentos"); if (d) d.userData.active = false;
          const l = this.lights.find((x) => x.id === "luz-comporta"); if (l) { l.light.color.set(0x60ff90); l.target = 1; }
          const a = this.decorById.get("seta-comporta"); if (a) a.visible = true;
          break;
        }
        case "pickup": { const g = this.pickups.get(e.id); if (g) { this.sparks.emit(g.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 14, e.kind === "dardos" ? 0x7ff6ff : e.kind === "fole" ? 0xffc070 : 0xffb050, 2, 0.5, 0.1, -1); } break; }
        case "tearLine": {
          const a = new THREE.Vector3(e.a.x, e.y + 0.03, e.a.z), b = new THREE.Vector3(e.b.x, e.y + 0.03, e.b.z);
          const len = a.distanceTo(b);
          const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc89bff).multiplyScalar(1.4), toneMapped: false, transparent: true }));
          m.position.copy(a).add(b).multiplyScalar(0.5);
          m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
          // estacas nas pontas
          for (const sx of [-0.5, 0.5]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.18, 6), m.material); st.position.set(sx * len, 0.06, 0); m.add(st); }
          this.scene.add(m); this.tearViews.set(e.id, m);
          for (const pt of [a, b]) this.sparks.emit(pt, 8, 0xc89bff, 1.5, 0.35, 0.08, 4);
          break;
        }
        case "tearLineHit": { this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y + 0.2, e.pos.z), 16, 0xd8b8ff, 3, 0.4, 0.09, 4); this.hitFlashes.push({ c: e.cid, t: 0.1 }); break; }
        case "tearLineEnd": { const m = this.tearViews.get(e.id); if (m) { m.userData.fade = 0.4; } break; }
        case "carStomp": { this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y + 0.05, e.pos.z), 14, 0x9a8a70, 2.2, 0.6, 0.12, 5); this.nearShake(e.pos, 0.25); break; }
        case "carCharge": { this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y + 0.05, e.pos.z), 10, 0x9a8a70, 3, 0.5, 0.12, 5); break; }
        case "carSlam": { this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y + 0.7, e.pos.z), 26, e.batente ? 0xffd040 : 0xffc080, 4, 0.5, 0.1, 6); this.shards.emit(this.tmpA, 12, 0x6a6458, 3, 0.8, 0.06, 9); this.nearShake(e.pos, 0.6); break; }
        case "carOpen": { this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y, e.pos.z), 12, 0xffa060, 1.5, 0.6, 0.1, 1); break; }
        case "badaloLock": { this.badaloTarget.visible = true; this.badaloTarget.position.set(e.pos.x, e.pos.y + 0.05, e.pos.z); this.badaloTarget.scale.setScalar(BADALO.impactRadius); (this.badaloTarget.material as THREE.MeshBasicMaterial).color.set(e.src === "baliza" ? 0x7ff6ff : 0xff6040); break; }
        case "badaloSlam": case "badaloStuck": {
          this.badaloTarget.visible = false;
          const p = this.tmpA.set(e.pos.x, e.pos.y + 0.1, e.pos.z);
          for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; this.tmpB.set(Math.cos(a), 0.15, Math.sin(a)); this.sparks.emit(this.tmpV.set(p.x + Math.cos(a) * 1.6, p.y, p.z + Math.sin(a) * 1.6), 2, 0xa89880, 4, 0.6, 0.16, 4, this.tmpB); }
          this.shards.emit(p, 20, 0x5a5448, 4, 0.9, 0.07, 9);
          this.nearShake(e.pos, 1.0);
          if (e.type === "badaloStuck") { const d = this.decorById.get(`placa-${e.plate}`); if (d?.userData.lamp) (d.userData.lamp.material as THREE.MeshBasicMaterial).color.set(0xffd040); }
          break;
        }
        case "badaloRise": { for (let i = 0; i < 3; i++) { const d = this.decorById.get(`placa-${i}`); if (d?.userData.lamp) (d.userData.lamp.material as THREE.MeshBasicMaterial).color.set(0x401010); } break; }
        case "badaloWave": { this.nearShake(e.pos, 0.5); break; }
        case "badaloHalf": { this.shards.emit(this.tmpA.set(e.pos?.x ?? 100, 2, e.pos?.z ?? 0), 30, 0x5a5448, 4, 1, 0.08, 9); this.shake = Math.max(this.shake, 0.4); break; }
        case "bossStart": { this.shake = Math.max(this.shake, 0.3); break; }
        case "bossDead": { this.shake = Math.max(this.shake, 0.8); this.badaloTarget.visible = false; this.waveRing.visible = false; break; }
        case "pump": {
          const d = this.decorById.get(e.id);
          if (d) { d.userData.turning = 1.4; if (d.userData.lamp) (d.userData.lamp.material as THREE.MeshBasicMaterial).color.set(0x40ff70); }
          const l = this.lights.find((x) => x.id === `luz-${e.id}`); if (l) l.light.color.set(0x8fffb0);
          this.sparks.emit(this.tmpA.set(e.pos.x, e.pos.y, e.pos.z), 12, 0xd0e8ff, 1.5, 0.5, 0.08, 4);
          this.shake = Math.max(this.shake, 0.2);
          break;
        }
        case "jet": { this.jetT = 1.6; break; }
        case "dispense": { const d = this.decorById.get(e.id); if (d) { d.userData.blink = 0.6; this.sparks.emit(d.getWorldPosition(this.tmpA).add(this.tmpB.set(0.4, -0.25, 0)), 10, 0x7ff6ff, 1.2, 0.4, 0.07, 3); } break; }
        case "lightColor": { const l = this.lights.find((x) => x.id === e.id); if (l) { l.light.color.set(e.color); (l.fixture!.material as THREE.MeshBasicMaterial).color.set(e.color).multiplyScalar(FIXTURE_GLOW); } break; }
        case "beaconCall": {
          const p = new THREE.Vector3(e.pos.x, e.pos.y + 0.2, e.pos.z);
          this.sparks.emit(p, 20, 0xbff8ff, 3, 0.6, 0.12, 0);
          break;
        }
      }
    }
  }

  private nearShake(p: { x: number; y: number; z: number }, k: number) {
    const d = this.camera.position.distanceTo(this.tmpV.set(p.x, p.y, p.z));
    this.shake = Math.max(this.shake, k * Math.max(0, 1 - d / 18));
  }
  private hideBench(id: string) { const b = this.decorById.get(id); if (b) { for (const it of b.userData.items) it.visible = false; b.userData.glow.intensity = 0.3; } }
  /** Arandela decorativa que acompanha a luz de mesmo id (lampada-1 → lampada-1-vis). */
  private lampOn(id: string) { const d = this.decorById.get(`${id}-vis`); if (d?.userData.bulb) { const b = d.userData.bulb as THREE.Mesh; b.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe0a0).multiplyScalar(FIXTURE_GLOW), toneMapped: false }); } }

  /** Tear: fio violeta que atravessa até dois alvos. */
  private tearShot(e: any) {
    const cam = this.camera;
    const from = this.tmpA.set(0.17, -0.17, -0.6).applyQuaternion(cam.quaternion).add(cam.position);
    const to = this.tmpB.set(e.to.x, e.to.y, e.to.z);
    this.addTracer(from, to, 0xc89bff, 0.014);
    for (const h of e.hits as { id: string; killed: boolean; at: { x: number; y: number; z: number } }[]) {
      this.hitFlashes.push({ c: h.id, t: 0.1 });
      this.sparks.emit(this.tmpV.set(h.at.x, h.at.y, h.at.z), 8, (e.mul ?? 1) < 0.5 ? 0xffe0a0 : 0xd8b8ff, 3.5, 0.3, 0.1, 2);
      this.shards.emit(this.tmpV, h.killed ? 4 : 8, 0x6a4a40, 3, 0.6, 0.05, 9);
    }
    if (!e.hits.length && e.normal) { this.tmpV.set(e.normal.x, e.normal.y, e.normal.z); this.sparks.emit(to, 8, 0xd8b8ff, 3, 0.35, 0.08, 6, this.tmpV); }
    this.recoil = 1; this.vmTear.flash.visible = true; this.vmTear.flash.material.rotation = Math.random() * 6;
    this.muzzleLight.color.set(0xc89bff); this.muzzleLight.position.copy(from); this.muzzleLight.intensity = 7;
    this.shake = Math.max(this.shake, 0.08);
  }

  /** Fole: seis traçantes curtos em leque, cada fragmento com seu impacto. */
  private foleShot(e: any) {
    const cam = this.camera;
    const from = this.tmpA.set(0.17, -0.17, -0.6).applyQuaternion(cam.quaternion).add(cam.position);
    for (const pl of e.pellets as { to: { x: number; y: number; z: number }; hit: string | null; normal: { x: number; y: number; z: number } | null }[]) {
      const to = this.tmpB.set(pl.to.x, pl.to.y, pl.to.z);
      this.addTracer(from, to, 0xffc070, 0.012);
      if (pl.hit) this.sparks.emit(to, 3, 0xffb060, 3, 0.25, 0.1, 2);
      else if (pl.normal) { this.tmpV.set(pl.normal.x, pl.normal.y, pl.normal.z); this.sparks.emit(to, 3, 0xffd8a0, 2.5, 0.3, 0.07, 6, this.tmpV); this.shards.emit(to, 1, 0x777777, 2, 0.5, 0.03, 9, this.tmpV); }
    }
    for (const h of e.hits as { id: string; killed: boolean }[]) {
      this.hitFlashes.push({ c: h.id, t: 0.1 });
      const pl = (e.pellets as any[]).find((p) => p.hit === h.id);
      if (pl) this.shards.emit(this.tmpB.set(pl.to.x, pl.to.y, pl.to.z), h.killed ? 4 : 10, 0xe8e0d0, 3.5, 0.6, 0.05, 9);
    }
    this.recoil = 1; this.vmFole.flash.visible = true; this.vmFole.flash.material.rotation = Math.random() * 6;
    this.muzzleLight.color.set(0xffb060); this.muzzleLight.position.copy(from); this.muzzleLight.intensity = 9;
    this.shake = Math.max(this.shake, 0.18);
  }

  /** Névoa do Véu: ~14 sprites de fumaça que giram devagar; o sopro os empurra para fora. */
  private syncClouds(sim: Sim, dt: number) {
    const live = this.liveClouds; live.clear();
    for (const cl of sim.clouds) {
      live.add(cl.id);
      let v = this.cloudViews.get(cl.id);
      if (!v) {
        const mat = new THREE.SpriteMaterial({ map: TX.texSmoke(), color: 0x9fb8b0, transparent: true, opacity: 0, depthWrite: false });
        const g = new THREE.Group(); g.position.set(cl.pos.x, 0, cl.pos.z);
        const sprites: THREE.Sprite[] = [];
        const n = this.quality === "baixa" ? 9 : 14;
        for (let i = 0; i < n; i++) {
          const sp = new THREE.Sprite(mat);
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, r = cl.radius * (0.2 + Math.random() * 0.7);
          sp.position.set(Math.cos(a) * r, cl.pos.y - 1.6 + Math.random() * 2.6, Math.sin(a) * r);
          sp.userData.p0 = sp.position.clone(); sp.userData.ph = Math.random() * 6;
          sp.scale.setScalar(2.4 + Math.random() * 1.8);
          sp.renderOrder = 3;
          g.add(sp); sprites.push(sp);
        }
        this.scene.add(g);
        v = { g, mat, sprites, age: 0, gone: 0, r: cl.radius };
        this.cloudViews.set(cl.id, v);
      }
      v.age += dt;
      const clear = cl.clearT > 0 ? Math.min(1, cl.clearT / FOLE.clearTime * 1.4) : 0; // 1 logo após o sopro
      const lifeK = Math.min(1, v.age / 0.6) * Math.min(1, Math.max(0, (cl.life - cl.age) / 0.8));
      v.mat.opacity = 0.55 * lifeK * (1 - clear * 0.85);
      this.updateCloudSprites(v, clear, dt);
    }
    for (const [id, v] of this.cloudViews) {
      if (live.has(id)) continue;
      v.gone += dt;
      v.mat.opacity = Math.max(0, v.mat.opacity - dt * 1.2);
      this.updateCloudSprites(v, Math.min(1, v.gone * 2), dt);
      if (v.mat.opacity <= 0) { v.g.removeFromParent(); v.mat.dispose(); this.cloudViews.delete(id); }
    }
  }
  /** Tear (linhas e prévia), alvo e onda do Badalo, jato da bomba, dispensador e água do túnel. */
  private syncF3(sim: Sim, dt: number) {
    const t = this.time;
    for (const [id, m] of this.tearViews) {
      const mm = m.material as THREE.MeshBasicMaterial;
      if (m.userData.fade !== undefined) { m.userData.fade -= dt; mm.opacity = Math.max(0, m.userData.fade / 0.4); if (m.userData.fade <= 0) { m.removeFromParent(); m.geometry.dispose(); this.tearViews.delete(id); } }
      else { mm.opacity = 0.75 + Math.sin(t * 18 + id) * 0.25; m.position.y += Math.sin(t * 40) * 0.0005; }
    }
    // prévia: onde a linha vai ficar (verde-violeta válida, vermelha curta inválida)
    const aim = sim.tearAim, ar = sim.arsenal, am = ar.ammo("tear");
    const show = !!aim && ar.current === "tear" && ar.state === "ready" && !!am && am.mag >= WEAPONS.tear.altCost && sim.alive && !this.menuMode;
    this.tearPreview.visible = show;
    if (show && aim) {
      const len = Math.max(0.3, Math.hypot(aim.b.x - aim.a.x, aim.b.z - aim.a.z));
      this.tearPreview.position.set((aim.a.x + aim.b.x) / 2, aim.a.y + 0.03, (aim.a.z + aim.b.z) / 2);
      this.tearPreview.rotation.set(-Math.PI / 2, 0, Math.atan2(-(aim.b.z - aim.a.z), aim.b.x - aim.a.x));
      this.tearPreview.scale.set(aim.valid ? len : 0.4, 1, 1);
      const pm = this.tearPreview.material as THREE.MeshBasicMaterial;
      pm.color.set(aim.valid ? 0xc89bff : 0xff5050); pm.opacity = aim.valid ? 0.35 + Math.sin(t * 6) * 0.1 : 0.3;
    }
    // Badalo: alvo travado e onda
    const boss = sim.creatures.find((c) => c.type === "badalo" && c.alive);
    if (boss) {
      if (this.badaloTarget.visible) { (this.badaloTarget.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 20) * 0.3; }
      const wave = boss.state === "wave" || boss.state === "waveWarn";
      this.waveRing.visible = wave;
      if (wave) {
        const fy = sim.nav.floorAt(boss.pos.x, boss.pos.z);
        this.waveRing.position.set(boss.pos.x, (Number.isNaN(fy) ? boss.pos.y : fy) + 0.06, boss.pos.z);
        const r = boss.state === "wave" ? Math.max(0.5, boss.waveR) : 1.6 + Math.sin(t * 30) * 0.15;
        this.waveRing.scale.setScalar(r);
        (this.waveRing.material as THREE.MeshBasicMaterial).color.set(boss.state === "wave" ? 0xffb080 : 0xff5030);
        (this.waveRing.material as THREE.MeshBasicMaterial).opacity = boss.state === "wave" ? 0.85 : 0.5 + Math.sin(t * 24) * 0.3;
      }
    } else { this.waveRing.visible = false; }
    // jato da bomba 1: spray que levanta a persiana
    if (this.jetT > 0) {
      this.jetT -= dt;
      const j = this.decorById.get("jato");
      if (j) { const p = j.getWorldPosition(this.tmpA); for (let i = 0; i < 4; i++) this.sparks.emit(p, 2, 0xcfe8f0, 6, 0.5, 0.12, 9, this.tmpB.set(0.3 + Math.random() * 0.2, 0.25, 0.9)); }
    }
    const disp = this.decorById.get("dispensador");
    if (disp?.userData.lamp) {
      const ready = (sim.script as any)?.dispenserT !== undefined ? (sim.script as any).dispenserT <= 0 : true;
      disp.userData.blink = Math.max(0, (disp.userData.blink ?? 0) - dt);
      (disp.userData.lamp.material as THREE.MeshBasicMaterial).color.set(disp.userData.blink > 0 ? (Math.sin(t * 30) > 0 ? 0xffffff : 0x40ff70) : ready ? 0x40ff70 : 0xff7030);
    }
    const water = this.decorById.get("agua-tunel");
    if (water?.userData.water) (water.userData.water as THREE.Mesh).position.y = 0.02 + 0.2 * (sim.vars.agua ?? 1);
  }

  private updateCloudSprites(v: { sprites: THREE.Sprite[]; age: number }, push: number, dt: number) {
    const t = this.time;
    for (const sp of v.sprites) {
      const p0 = sp.userData.p0 as THREE.Vector3, ph = sp.userData.ph as number;
      const k = 1 + push * 1.6;
      const a = t * 0.15 + ph;
      sp.position.set(p0.x * k + Math.sin(a) * 0.4, p0.y + Math.sin(t * 0.5 + ph) * 0.15, p0.z * k + Math.cos(a) * 0.4);
      sp.material.rotation += dt * 0.02;
    }
  }

  /** Traçantes reaproveitados: uma geometria unitária escalada, sem criar malha por disparo. */
  private tracerGeo = (() => { const g = new THREE.CylinderGeometry(1, 0.4, 1, 5, 1, true); g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2); return g; })();
  private tracerFree: THREE.Mesh[] = [];
  addTracer(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number) {
    const len = from.distanceTo(to);
    const m = this.tracerFree.pop() ?? new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    (m.material as THREE.MeshBasicMaterial).color.set(color); (m.material as THREE.MeshBasicMaterial).opacity = 0.9;
    m.scale.set(width, width, len);
    m.position.copy(from); m.lookAt(to);
    this.scene.add(m);
    this.tracers.push({ line: m, life: 0.09 });
  }

  /** Sincroniza malhas com o estado da simulação. */
  sync(sim: Sim, dt: number, opts: { reduceFlashes: boolean }) {
    this.time += dt;
    const t = this.time;
    // câmera
    const p = sim.player;
    const eye = p.eyePos();
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (p.grounded && speed > 0.5 && !p.sliding) this.bobT += dt * speed * 1.6;
    const bob = Math.sin(this.bobT) * 0.035 * Math.min(1, speed / 5.5);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.reduceShake ? this.shake * 0.2 : this.shake;
    this.camera.position.set(eye.x + (Math.random() - 0.5) * sh * 0.08, eye.y + bob - this.landDip + (Math.random() - 0.5) * sh * 0.08, eye.z + (Math.random() - 0.5) * sh * 0.08);
    const roll = p.sliding ? 0.06 : 0;
    this.camera.rotation.set(p.pitch, p.yaw, roll);
    if (this.camera.fov !== this.fov + (p.sprinting ? 6 : 0) + (p.sliding ? 9 : 0)) {
      const target = this.fov + (p.sprinting ? 6 : 0) + (p.sliding ? 9 : 0);
      this.camera.fov += (target - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    // portas e caixas dinâmicas
    for (const [id, d] of this.dynamicBoxes) {
      const want = d.box.enabled ? 0 : 1;
      d.open += (want - d.open) * Math.min(1, dt * 5);
      d.vib = Math.max(0, d.vib - dt);
      const h = d.box.max.y - d.box.min.y;
      const rise = id === "divisoria" ? h : h * 0.95;
      d.mesh.position.set(d.base.x + (d.vib > 0 ? Math.sin(t * 70) * 0.03 : 0), d.base.y + d.open * rise, d.base.z + (d.vib > 0 ? Math.cos(t * 63) * 0.03 : 0));
      d.mesh.visible = d.open < 0.98;
    }
    // decoração animada
    for (const [id, g] of this.decorById) {
      if (g.userData.swing !== undefined) { g.userData.swing = Math.max(0, g.userData.swing - dt * 0.6); g.children[0].rotation.z = Math.sin(t * 9) * 0.35 * g.userData.swing; }
      if (g.userData.door) {
        g.userData.vib = Math.max(0, (g.userData.vib ?? 0) - dt);
        if (g.userData.opening) g.userData.open = Math.min(1, g.userData.open + dt * 2);
        const door = g.userData.door as THREE.Mesh;
        door.position.y = 1.08 + g.userData.open * 2.0;
        door.position.x = g.userData.vib > 0 ? Math.sin(t * 80) * 0.04 : 0;
      }
      if (id === "painel" && g.userData.marker) { g.userData.marker.rotation.y += dt * 2; g.userData.marker.position.y = 0.9 + Math.sin(t * 3) * 0.06; }
      if (g.userData.pulse) g.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
      if (id === "luz-portao" && g.userData.arrow.visible) g.userData.arrow.position.x = Math.sin(t * 5) * 0.08;
      if (g.userData.lid) { // alçapões/respiros: abrem para baixo quando algo entra
        g.userData.vib = Math.max(0, (g.userData.vib ?? 0) - dt);
        if (g.userData.opening) g.userData.open = Math.min(1, g.userData.open + dt * 1.6);
        g.userData.lid.rotation.z = -g.userData.open * 1.7 + (g.userData.vib > 0 ? Math.sin(t * 70) * 0.05 : 0);
      }
      if (g.userData.turning > 0) { g.userData.turning -= dt; g.userData.wheel.rotation.z += dt * 7 * Math.min(1, g.userData.turning * 2); }
      if (g.userData.swingBody) { g.userData.swingBody.rotation.z = Math.sin(t * 0.8) * 0.05; g.userData.swingBody.rotation.x = Math.cos(t * 0.6) * 0.04; g.userData.swingBody.position.y = Math.sin(t * 0.9) * 0.05; }
      if (g.userData.active && g.userData.segs) { // próximo segmento pisca enquanto a comporta abre
        const nx = g.userData.segs[g.userData.lit ?? 0] as THREE.Mesh | undefined;
        if (nx) (nx.material as THREE.MeshBasicMaterial).color.set(Math.sin(t * 14) > 0 ? 0xffa030 : 0x401010);
      }
    }
    if (this.ferry) { this.ferry.position.y = Math.sin(t * 0.6) * 0.15 - 1.2; this.ferry.rotation.z = Math.sin(t * 0.45) * 0.008; }

    // luzes (oscilação de lâmpadas)
    for (const l of this.lights) {
      let f = 1;
      if (l.flicker) { const n = Math.sin(t * 13.1 + l.base) * Math.sin(t * 7.3 + l.base * 2); f = n > 1 - l.flicker ? 0.25 : 1; }
      const target = l.base * l.target * f;
      l.light.intensity += (target - l.light.intensity) * Math.min(1, dt * 12);
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 80);

    // criaturas
    const seen = this.seenIds; seen.clear();
    for (const c of sim.creatures) {
      seen.add(c.id);
      let v = this.creatures.get(c.id);
      if (!v) {
        const rig = c.type === "riscador" ? buildRiscador() : c.type === "veu" ? buildVeu() : c.type === "carapaca" ? buildCarapaca() : c.type === "badalo" ? buildBadalo() : buildEstilhaco();
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(c.type === "riscador" ? 0.6 : c.type === "carapaca" ? 0.95 : c.type === "badalo" ? 1.7 : 0.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: c.type === "veu" ? 0.25 : 0.45, depthWrite: false }));
        shadow.rotation.x = -Math.PI / 2;
        this.dynRoot.add(rig.root, shadow);
        if (rig.beam) this.scene.add(rig.beam);
        v = { rig, c, shadow, dying: 0 };
        this.creatures.set(c.id, v);
      }
      this.animateCreature(v, sim, dt);
    }
    for (const [id, v] of this.creatures) {
      if (!seen.has(id)) { v.rig.root.removeFromParent(); v.shadow.removeFromParent(); v.rig.beam?.removeFromParent(); this.creatures.delete(id); }
    }

    // projéteis
    const live = this.liveProj; live.clear();
    for (const pr of sim.projectiles) {
      live.add(pr.id);
      let s = this.projectiles.get(pr.id);
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.texGlow(), color: 0xff8a40, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        s.scale.setScalar(0.55); this.scene.add(s); this.projectiles.set(pr.id, s);
      }
      s.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      if (Math.random() < 0.6) this.sparks.emit(s.position, 1, 0xff7030, 0.3, 0.3, 0.14, 0);
    }
    for (const [id, s] of this.projectiles) if (!live.has(id)) { s.removeFromParent(); this.projectiles.delete(id); }

    // coletas
    for (const pk of sim.pickups) {
      let g = this.pickups.get(pk.id);
      if (!g) { g = buildPickup(pk.kind); g.position.set(pk.pos.x, pk.pos.y, pk.pos.z); this.dynRoot.add(g); this.pickups.set(pk.id, g); }
      g.visible = !pk.taken;
      g.children[0].position.y = 0.14 + Math.sin(t * 2 + pk.pos.x) * 0.04;
      (g.userData.halo as THREE.Mesh).scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    }

    // baliza
    const b = sim.beacon;
    const bw = this.beaconWorld.root;
    if (b.state === "flying") {
      const k = 1 - Math.max(0, b.timer) / BEACON.flightTime;
      bw.visible = true;
      bw.position.set(b.from.x + (b.pos.x - b.from.x) * k, b.from.y + (b.pos.y - b.from.y) * k + Math.sin(k * Math.PI) * 1.2, b.from.z + (b.pos.z - b.from.z) * k);
      bw.rotation.x += dt * 12;
    } else if (b.state === "armed" || b.state === "emitting") {
      bw.visible = true; bw.position.set(b.pos.x, b.pos.y + 0.07, b.pos.z); bw.rotation.set(0, t, 0);
      const blink = b.state === "emitting" ? (Math.sin(t * 30) > 0 ? 1 : 0.2) : (Math.sin(t * 6) > 0.6 ? 1 : 0.15);
      (this.beaconWorld.light.material as THREE.MeshBasicMaterial).color.setRGB(0.5 * blink, blink, blink);
    } else bw.visible = false;
    this.rangeRing.visible = b.state === "armed" || b.state === "emitting";
    if (this.rangeRing.visible) {
      this.rangeRing.position.set(b.pos.x, b.pos.y + 0.03, b.pos.z);
      (this.rangeRing.material as THREE.MeshBasicMaterial).opacity = b.state === "emitting" ? 0.9 : 0.45 + Math.sin(t * 4) * 0.1;
      this.rangeRing.rotation.z += dt * 0.3;
    }
    const aim = sim.beaconAim;
    this.aimRing.visible = !!aim && b.state === "ready" && !this.menuMode;
    if (aim && this.aimRing.visible) {
      this.aimRing.position.set(aim.pos.x, aim.pos.y + 0.04, aim.pos.z);
      (this.aimRing.material as THREE.MeshBasicMaterial).color.set(aim.valid ? 0x9fffb0 : 0xff5050);
      (this.aimRing.material as THREE.MeshBasicMaterial).opacity = aim.valid ? 0.5 : 0.35;
      this.aimRing.scale.setScalar(aim.valid ? 1 : 0.12);
    }
    for (let i = 0; i < this.pulseRings.length; i++) {
      const r = this.pulseRings[i];
      r.visible = b.state === "emitting";
      if (r.visible) {
        const ph = ((t * 1.3 + i / 3) % 1);
        r.position.set(b.pos.x, b.pos.y + 0.08 + ph * 0.6, b.pos.z);
        r.scale.setScalar(0.3 + ph * BEACON.callRadius);
        (r.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * (opts.reduceFlashes ? 0.4 : 0.85);
      }
    }

    this.syncClouds(sim, dt);
    this.syncF3(sim, dt);
    // goteiras
    for (const dp of this.drips) if (Math.random() < dt * 1.5) this.sparks.emit(dp, 1, 0x9fc0d8, 0.05, Math.sqrt((2 * Math.max(0.5, dp.y)) / 9.8) + 0.1, 0.06, 9.8);
    // traçantes e partículas
    for (const tr of this.tracers) { tr.life -= dt; (tr.line.material as THREE.MeshBasicMaterial).opacity = Math.max(0, tr.life / 0.09); }
    for (let i = this.tracers.length - 1; i >= 0; i--) { const tr = this.tracers[i]; if (tr.life <= 0) { tr.line.removeFromParent(); this.tracerFree.push(tr.line); this.tracers.splice(i, 1); } }
    this.sparks.update(dt); this.shards.update(dt);

    // chuva: o shader anima; aqui só os respingos, na mesma taxa média de antes
    this.rainTime.value += dt;
    if (this.rain) {
      const n = (this.rain.geometry.attributes.position.count / 2) * dt * (16 / 19) * 0.08;
      let k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      while (k-- > 0) {
        const r = this.level?.env.rainRects ? this.rainPick(Math.random()) : this.rainRects[Math.random() < 0.45 ? 0 : 1];
        const z = r[1] + Math.random() * (r[3] - r[1]);
        if (r[4] < 0) continue; // respingos só onde há piso visível
        this.tmpV.set(r[0] + Math.random() * (r[2] - r[0]), r[4] + 0.02, z);
        this.sparks.emit(this.tmpV, 1, 0x6080a0, 0.6, 0.2, 0.05, 3);
      }
    }
    this.seaTime.value = t;

    this.updateViewmodel(sim, dt, speed);
  }

  private animateCreature(v: CreatureView, sim: Sim, dt: number) {
    const { rig, c } = v;
    const t = this.time;
    rig.root.position.set(c.pos.x, c.type === "badalo" ? BADALO_RAIL_Y : c.pos.y, c.pos.z);
    rig.root.rotation.y = c.yaw;
    v.shadow.position.set(c.pos.x, (Number.isNaN(sim.nav.floorAt(c.pos.x, c.pos.z)) ? c.pos.y : sim.nav.floorAt(c.pos.x, c.pos.z)) + 0.02, c.pos.z);
    let flash = 0;
    for (const h of this.hitFlashes) if (h.c === c.id) { flash = Math.max(flash, h.t / 0.1); }
    // pele fosca: um acerto acende a carne por um instante (emissivo), os detalhes pulsam devagar
    const prepGlow = c.state === "windup" || c.state === "swell" || c.state === "charge" || c.state === "stomp" || c.state === "tilt" || c.state === "waveWarn" || (c.state === "aim" && c.stateT >= 0) ? 1 : 0;
    for (const m of rig.mats) { m.emissive.setRGB(flash * 0.55, flash * 0.4, flash * 0.35); }
    for (let i = this.hitFlashes.length - 1; i >= 0; i--) if ((this.hitFlashes[i].t -= dt / Math.max(1, this.creatures.size)) <= 0) this.hitFlashes.splice(i, 1);
    rig.mark.visible = c.markT > 0 && c.alive;
    if (rig.mark.visible) rig.mark.rotation.y += dt * 3;
    if (!c.alive) {
      // morte orgânica: as pernas cedem, o corpo desaba no piso e se desfaz (borda quente), sem peças voando
      if (v.dying === 0) { for (const a of rig.accents) a.visible = false; for (const r of rig.rims) r.visible = false; if (rig.beam) rig.beam.visible = false; v.dropY = rig.body.position.y; }
      v.dying += dt;
      const k = Math.min(1, v.dying / 0.55), ease = k * k * (3 - 2 * k);
      if (c.type === "veu") { rig.body.position.y = v.dropY! * (1 - ease) + 0.15 * ease; rig.body.rotation.x = ease * 1.2; if (rig.sac) rig.sac.scale.set(1 - ease * 0.5, 0.8 * (1 - ease * 0.6), 1 - ease * 0.5); }
      else if (c.type === "badalo") { this.placeBadalo(rig, c); rig.body.rotation.z = Math.sin(v.dying * 3) * 0.05 * (1 - k); rig.head!.rotation.x = 0.45 * ease; rig.head!.position.y -= 0.0; }
      else {
        const floorK = c.type === "estilhaco" ? 0.3 : c.type === "carapaca" ? 0.45 : 0.18;
        rig.body.position.y = v.dropY! * (1 - ease) + floorK * ease;
        rig.body.rotation.z = (c.flinch.side || 1) * ease * (c.type === "estilhaco" ? 1.3 : 0.25);
        rig.body.rotation.x = ease * (c.type === "estilhaco" ? 0.4 : 0.15);
        rig.body.scale.set(1 + ease * 0.08, 1 - ease * 0.25, 1);
        for (const l of rig.legs) { l.rotation.z += ((l.position.x >= 0 ? 1.45 : -1.45) - l.rotation.z) * Math.min(1, dt * 8); l.position.y = 0.62 * (1 - ease) + floorK * ease; }
      }
      const dis = Math.max(0, Math.min(1.05, (v.dying - (c.type === "badalo" ? 2.5 : 0.7)) / (c.type === "badalo" ? 3 : 1.1)));
      rig.dissolve.value = dis;
      v.shadow.visible = dis < 0.5; (v.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - ease * 0.4);
      rig.mark.visible = false;
      return;
    }
    rig.dissolve.value = 0;
    rig.root.scale.setScalar(c.state === "emerging" ? Math.min(1, 0.3 + c.stateT) : 1);
    const prep = c.state === "windup" || (c.state === "aim" && c.stateT >= 0) || c.state === "stomp" || c.state === "charge" || c.state === "tilt" || c.state === "waveWarn";
    const vib = prep ? Math.sin(t * 90) * 0.06 : 0;
    for (let i = 0; i < rig.rims.length; i++) {
      const r = rig.rims[i];
      const m = r.material as THREE.MeshBasicMaterial;
      m.opacity = prep ? 1 : 0.25 + Math.sin(t * 2.2 + i + c.pos.x) * 0.12;
      r.scale.set(1 + vib, 1 + (prep ? Math.abs(vib) * 3 : 0), 1);
      m.color.copy(rig.veinColor).multiplyScalar(prep ? 1.6 + prepGlow * 0.2 : 0.9);
    }
    const fl = c.flinch.t > 0 ? c.flinch.t / 0.32 : 0;
    if (c.type === "veu") { this.animateVeu(v, fl); return; }
    if (c.type === "carapaca") { this.animateCarapaca(v, fl); return; }
    if (c.type === "badalo") { this.animateBadalo(v, sim, fl); return; }
    if (c.type === "riscador") {
      const gait = c.anim * 2.2;
      rig.legs.forEach((l, i) => { l.rotation.x = Math.sin(gait + (i % 3 === 0 ? 0 : Math.PI)) * 0.5; });
      let sy = 1, sz = 1, by = 0.62;
      if (c.state === "windup") {
        const k = c.stateT < RISCADOR.scratchTime ? 0 : Math.min(1, (c.stateT - RISCADOR.scratchTime) / RISCADOR.compressTime);
        sy = 1 - k * 0.35; sz = 1 + k * 0.15; by = 0.62 - k * 0.2;
        if (c.stateT < RISCADOR.scratchTime) rig.legs[0].rotation.x = Math.sin(t * 30) * 0.8;
      } else if (c.state === "leap") { sy = 0.8; sz = 1.35; by = 0.7; rig.legs.forEach((l) => (l.rotation.x = -0.9)); }
      else if (c.state === "skid") { by = 0.5; rig.body.rotation.x = 0.15; }
      else rig.body.rotation.x = 0;
      rig.body.scale.set(1, sy, sz); rig.body.position.y = by + Math.sin(c.anim * 4) * 0.02;
      // reação ao impacto: tranco para trás, cabeça joga quando o tiro é alto
      rig.body.rotation.z = c.flinch.side * fl * 0.35;
      rig.body.position.z = fl * 0.12;
      if (rig.head) rig.head.rotation.x = c.flinch.h > 0.55 ? -fl * 0.7 : fl * 0.2;
    } else {
      const open = c.state === "aim" && c.stateT >= 0 ? Math.min(1, c.stateT / 0.3) : 0;
      rig.crown.forEach((cr, i) => { cr.rotation.x = 0.1 + open * 0.9 + Math.sin(t * 40 + i) * open * 0.04; });
      rig.legs.forEach((l, i) => { l.rotation.x = (i === 2 ? 0.3 : 0) + Math.sin(c.anim * 2 + i * 2) * 0.35; });
      rig.body.position.y = 1.15 + Math.sin(t * 2) * 0.03;
      rig.body.rotation.x = -fl * 0.3 * (c.flinch.h > 0.6 ? 1.4 : 0.8);
      rig.body.rotation.z = c.flinch.side * fl * 0.25;
      if (fl > 0) rig.crown.forEach((cr, i) => { cr.rotation.x += Math.sin(t * 60 + i) * fl * 0.25; });
      (rig.core!.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.5 + open * 0.5, 0.25 + open * 0.6);
      const beam = rig.beam!;
      beam.visible = c.state === "aim" && c.stateT >= 0 && c.stateT < ESTILHACO.aimTime;
      if (beam.visible) {
        const muzzle = this.tmpA.set(c.pos.x, c.pos.y + c.height * 0.85, c.pos.z);
        const dir = this.tmpB.set(c.aimDir.x, c.aimDir.y, c.aimDir.z);
        const hit = sim.world.raycast(muzzle, c.aimDir, 60, ["solid", "grate", "ceiling"]);
        const pd = Math.hypot(muzzle.x - sim.player.pos.x, muzzle.y - sim.player.pos.y - 1.2, muzzle.z - sim.player.pos.z);
        const len = Math.min(hit ? hit.t : 60, pd + 1.5);
        beam.position.copy(muzzle).addScaledVector(dir, len / 2);
        beam.quaternion.setFromUnitVectors(UP, dir);
        const k = c.stateT / ESTILHACO.aimTime;
        beam.scale.set(1 + k * 3, len, 1 + k * 3);
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.45 + k * 0.5 + Math.sin(t * 50) * 0.1;
      }
    }
  }

  /** Carapaça: marcha pesada; pisoteio antes da investida; placas do peito abrem depois de trombar no batente. */
  private animateCarapaca(v: CreatureView, fl: number) {
    const { rig, c } = v;
    const t = this.time;
    const charge = c.state === "charge", stomp = c.state === "stomp";
    const gait = c.anim * (charge ? 3.2 : 1.6);
    rig.legs.forEach((l, i) => { l.rotation.x = Math.sin(gait + (i === 0 || i === 3 ? 0 : Math.PI)) * (charge ? 0.55 : 0.35); });
    let by = 0.95, rx = 0, rz = 0;
    if (stomp) { const k = Math.sin(c.stateT * 14); by += Math.max(0, k) * 0.08; rig.legs[c.stateT * 7 % 2 < 1 ? 0 : 1].rotation.x = -0.6 * Math.max(0, k); rx = -0.06; }
    if (charge) { rx = 0.16; by = 0.88; }
    let open = 0;
    if (c.state === "open") open = Math.min(1, c.stateT / 0.25) * (c.stateT > CARAPACA.openTime - 0.3 ? Math.max(0, (CARAPACA.openTime - c.stateT) / 0.3) : 1);
    if (c.state === "stun") { rz = Math.sin(t * 22) * 0.07 * Math.max(0, 1 - c.stateT / CARAPACA.stunTime); by = 0.85; }
    if (c.state === "open") { by = 0.82 + Math.sin(t * 5) * 0.02; rx = -0.08; }
    rig.crown.forEach((cr) => { const side = cr.userData.side as number; cr.rotation.y = -side * 1.05 * open; });
    (rig.core!.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.55 + open * 0.4, 0.3 + open * 0.4);
    rig.core!.scale.set(0.12 + open * 0.08, 0.1 + open * 0.06, 0.05);
    rig.body.position.y = by + Math.sin(c.anim * 3) * 0.015;
    rig.body.rotation.x = rx - fl * 0.18;
    rig.body.rotation.z = rz + c.flinch.side * fl * 0.12;
    if (rig.head) rig.head.rotation.x = stomp ? Math.sin(c.stateT * 14) * 0.12 : 0;
  }

  /** Badalo: corre no trilho do teto; o sino desce pelo talo, crava e expõe o órgão. */
  private placeBadalo(rig: CreatureRig, c: Creature) {
    const drop = Math.max(2.4, BADALO_RAIL_Y - c.pos.y);
    rig.head!.position.y = -drop;
    const L = Math.max(0.2, drop - 2.2);
    for (const ch of rig.body.children) {
      const base = ch.userData.stretch as number | undefined;
      if (!base) continue;
      ch.scale.y = L / base;
      ch.position.y = -L / 2;
    }
    rig.mark.position.y = -drop + 1.2;
  }
  private animateBadalo(v: CreatureView, sim: Sim, fl: number) {
    const { rig, c } = v;
    const t = this.time;
    this.placeBadalo(rig, c);
    const bell = rig.head!, organ = rig.crown[0];
    let swayX = Math.sin(t * 0.7 + c.pos.x) * 0.025, swayZ = Math.cos(t * 0.55) * 0.025;
    if (c.state === "tilt") {
      const k = Math.min(1, c.stateT / BADALO.tiltTime);
      const tgt = c.lockPos ?? sim.player.pos;
      const dx = tgt.x - c.pos.x, dz = tgt.z - c.pos.z, l = Math.hypot(dx, dz) || 1;
      // inclina o talo em direção ao alvo (no espaço do root, que gira com o yaw)
      const cy = Math.cos(-c.yaw), sy = Math.sin(-c.yaw);
      const lx = (dx * cy - dz * sy) / l, lz = (dx * sy + dz * cy) / l;
      swayZ = -lx * 0.12 * k + Math.sin(t * 30) * 0.01 * k; swayX = lz * 0.12 * k;
    }
    if (c.state === "waveWarn") { const k = Math.min(1, c.stateT / BADALO.waveWarn); bell.rotation.y += 0.02; swayX += Math.sin(t * 60) * 0.012 * k; }
    rig.body.rotation.x = swayX - fl * 0.03;
    rig.body.rotation.z = swayZ + c.flinch.side * fl * 0.03;
    const stuck = c.state === "stuck";
    // cravado: a borda levanta de um lado e o órgão pulsa, exposto
    const lift = stuck ? Math.min(1, c.stateT / 0.3) * (c.stateT > BADALO.stuckTime - 0.4 ? Math.max(0, (BADALO.stuckTime - c.stateT) / 0.4) : 1) : 0;
    bell.rotation.x = lift * 0.32;
    bell.position.y += lift * 0.25;
    organ.position.y = 0.35 - lift * 0.15;
    organ.scale.setScalar(1 + lift * (0.08 + Math.sin(t * 9) * 0.05));
    (rig.core!.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.75 + lift * 0.25, 0.55 + lift * 0.35);
    const sh = v.shadow; const h = Math.max(0, c.pos.y - (sim.nav.floorAt(c.pos.x, c.pos.z) || 0));
    (sh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - Math.min(0.75, h / 6));
    sh.scale.setScalar(1 + h * 0.12);
  }

  /** Véu: a fita ondula no shader, o saco incha antes de soltar a névoa e murcha depois. */
  private animateVeu(v: CreatureView, fl: number) {
    const { rig, c } = v;
    const t = this.time;
    const u = rig.uniforms!;
    u.uTime.value = t + c.pos.x;
    const swell = c.state === "swell" ? Math.min(1, c.stateT / VEU.swellTime) : 0;
    const recover = c.state === "recover" ? 1 - Math.min(1, c.stateT / VEU.recoverTime) : 0;
    u.uSwell.value = swell;
    const k = 1 + swell * 0.9 - recover * 0.35;
    rig.sac!.scale.set(k + Math.sin(t * 40) * swell * 0.04, (0.8 + Math.sin(t * 1.7) * 0.05) * k, k);
    rig.body.position.y = 0.65 + Math.sin(t * 1.4 + c.pos.z) * 0.12;
    rig.body.rotation.z = Math.sin(t * 0.9) * 0.12 + c.flinch.side * fl * 0.5;
    rig.body.rotation.x = -fl * 0.4;
    if (c.state === "pushed") rig.body.rotation.x += 0.5;
  }

  private updateViewmodel(sim: Sim, dt: number, speed: number) {
    const cur = sim.arsenal.current;
    const has = !!cur;
    if (cur !== this.vmWeapon) {
      this.vmWeapon = cur;
      this.vm = cur === "fole" ? this.vmFole : cur === "tear" ? this.vmTear : this.vmAgulha;
      this.vmAgulha.flash.visible = false; this.vmFole.flash.visible = false; this.vmTear.flash.visible = false;
    }
    this.vmAgulha.root.visible = has && sim.alive && this.vm === this.vmAgulha;
    this.vmFole.root.visible = has && sim.alive && this.vm === this.vmFole;
    this.vmTear.root.visible = has && sim.alive && this.vm === this.vmTear;
    this.vmBeacon.root.visible = sim.beacon.owned && sim.alive && (sim.beacon.state === "ready" || sim.beacon.state === "recharging");
    if (!has) return;
    const vm = this.vm, fole = vm === this.vmFole;
    const p = sim.player;
    this.recoil = Math.max(0, this.recoil - dt * (fole ? 6 : 12));
    if (this.recoil < 0.6) vm.flash.visible = false;
    this.reloadAnim = Math.max(0, this.reloadAnim - dt);
    this.switchAnim = Math.max(0, this.switchAnim - dt);
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    this.healAnim = Math.max(0, this.healAnim - dt);
    this.soproAnim = Math.max(0, this.soproAnim - dt);
    const bob = Math.sin(this.bobT) * 0.012 * Math.min(1, speed / 5.5);
    const bobX = Math.cos(this.bobT * 0.5) * 0.012 * Math.min(1, speed / 5.5);
    const rc = this.recoil;
    // Agulha: coice curto e seco; Fole: coice longo que joga o cano para cima e para trás
    let x = (fole ? 0.16 : 0.17) + bobX, y = (fole ? -0.18 : -0.17) + bob - (fole ? rc * 0.02 : 0), z = (fole ? -0.36 : -0.34) + rc * (fole ? 0.09 : 0.045);
    let rx = rc * (fole ? 0.32 : 0.09), ry = 0, rz = fole ? -rc * 0.06 : 0;
    if (p.sprinting) { x += 0.04; y -= 0.05; ry = 0.6; rz = 0.25; rx = -0.15; }
    if (p.sliding) { rz = -0.3; }
    // recarga: a cápsula sai por baixo, a mão de apoio busca outra e encaixa
    let magY = 0, magZ = 0, handY = 0, handZ = 0;
    if (this.reloadAnim > 0) {
      const k = 1 - this.reloadAnim / this.reloadDur;
      const s = Math.sin(k * Math.PI);
      rz += s * (fole ? 0.35 : 0.7); y -= s * 0.06; rx += s * 0.2;
      if (k < 0.3) magY = -(k / 0.3) * 0.16;
      else if (k < 0.55) { magY = -0.3; handY = -((k - 0.3) / 0.25) * 0.12; }
      else if (k < 0.85) { const u = (k - 0.55) / 0.3; magY = -0.16 * (1 - u); handY = -0.12 * (1 - u); handZ = 0.1 * u; }
      else { const u = (k - 0.85) / 0.15; handZ = 0.1 * (1 - u); z += Math.sin(u * Math.PI) * 0.015; } // encaixe
    }
    const m0 = vm.mag.userData.p0 as THREE.Vector3;
    vm.mag.position.set(m0.x, m0.y + magY, m0.z + magZ);
    vm.mag.visible = magY > -0.29;
    if (vm.hand) { const h0 = vm.hand.userData.p0 as THREE.Vector3; vm.hand.position.set(h0.x, h0.y + handY, h0.z + handZ); }
    if (fole && vm.hand) vm.hand.position.z += Math.max(0, rc - 0.3) * 0.08; // bombeia depois do disparo
    if (vm.slide) vm.slide.position.z = Math.min(1, rc * 1.4) * 0.04;
    if (vm.bellows) vm.bellows.scale.z = 1 - rc * 0.35 - Math.sin(Math.min(1, this.soproAnim / 0.5) * Math.PI) * 0.45;
    if (this.soproAnim > 0) { const s = Math.sin((this.soproAnim / 0.5) * Math.PI); z += s * 0.05; rx -= s * 0.12; }
    if (this.switchAnim > 0) y -= Math.sin((this.switchAnim / 0.45) * Math.PI) * 0.25;
    if (this.healAnim > 0) { y -= 0.12; rx -= 0.4; }
    vm.root.position.set(x, y, z);
    vm.root.rotation.set(rx, ry, rz);
    const a = sim.arsenal.ammo();
    if (a) {
      const max = WEAPONS[sim.arsenal.current!]?.mag ?? (fole ? FOLE_MAG : 24);
      const f = a.mag / max;
      vm.magMat.emissiveIntensity = 0.2 + f * 1.4;
      if (!fole) vm.mag.scale.y = 0.4 + f * 0.6;
      // indicadores acesos: um por fração do pente
      const n = vm.leds.length;
      const lit = Math.ceil(f * n - 1e-6);
      const low = f <= 0.25;
      for (let i = 0; i < n; i++) {
        const m = vm.leds[i].material as THREE.MeshBasicMaterial;
        const on = i < lit;
        const blink = low && on && Math.sin(this.time * 12) < 0;
        if (on && !blink) m.color.set(low ? 0xff5040 : fole ? 0xffa040 : vm === this.vmTear ? 0xb07aff : 0x39d8ff); else m.color.set(0x0b1418);
      }
    }
    const glowK = this.reloadAnim > 0 ? 0.3 : 1;
    vm.coils.forEach((c, i) => ((c.material as THREE.MeshStandardMaterial).emissiveIntensity = (1.2 + Math.sin(this.time * 6 + i) * 0.4 + this.recoil * 3) * glowK));
    // baliza na mão esquerda
    const ty = -0.19 - (this.throwAnim > 0 ? Math.sin((this.throwAnim / 0.4) * Math.PI) * 0.1 : 0) + bob;
    this.vmBeacon.root.position.set(-0.25, ty - 0.04, -0.42);
    const ready = sim.beacon.state === "ready";
    (this.vmBeacon.light.material as THREE.MeshBasicMaterial).color.set(ready ? 0x7ff6ff : 0x305060);
    // luz do viewmodel aproxima a iluminação local
    let best = 0; const col = this.tmpCol.set(0x8fa0b0);
    for (const l of this.lights) {
      const d = l.light.position.distanceTo(this.camera.position);
      const w = l.light.intensity / (1 + d * d * 0.3);
      if (w > best) { best = w; col.copy(l.light.color); }
    }
    this.vmLight.color.lerp(col, Math.min(1, dt * 3));
    this.vmLight.intensity = 1.2 + Math.min(2.5, best * 0.3) + this.muzzleLight.intensity * 0.3;
  }

  /** Câmera do menu: vista da praça e da balsa. */
  menuCamera(dt: number) {
    this.time += dt;
    const t = this.time * 0.05;
    this.camera.position.set(74 + Math.sin(t) * 6, 2.2 + Math.sin(t * 0.8) * 0.3, -15.5);
    this.camera.rotation.set(0.02, 0.45 + Math.sin(t * 0.7) * 0.12, 0);
    this.vmAgulha.root.visible = false; this.vmFole.root.visible = false; this.vmTear.root.visible = false; this.vmBeacon.root.visible = false;
    for (const l of this.lights) {
      let f = 1;
      if (l.flicker) { const n = Math.sin(this.time * 13.1 + l.base) * Math.sin(this.time * 7.3 + l.base * 2); f = n > 1 - l.flicker ? 0.25 : 1; }
      l.light.intensity = l.base * l.target * f;
    }
    if (this.ferry) this.ferry.position.y = Math.sin(this.time * 0.6) * 0.15 - 1.2;
    this.rainTime.value += dt;
    this.sparks.update(dt); this.shards.update(dt);
  }

  render() {
    this.lightPool.update(this.camera);
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    if (!this.menuMode) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
      this.renderer.autoClear = true;
    }
  }

  /** Projeta um ponto do mundo na tela (para indicadores do HUD). */
  project(p: { x: number; y: number; z: number }): { x: number; y: number; behind: boolean } {
    this.tmpV.set(p.x, p.y, p.z).project(this.camera);
    const behind = this.tmpV.z > 1;
    return { x: (this.tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-this.tmpV.y * 0.5 + 0.5) * window.innerHeight, behind };
  }

  lookDir() { return dirFromYawPitch(this.camera.rotation.y, this.camera.rotation.x); }
}
