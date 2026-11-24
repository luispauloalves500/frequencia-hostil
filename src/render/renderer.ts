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
import { BEACON, ESTILHACO, RISCADOR } from "../config";
import { dirFromYawPitch } from "../core/math";
import * as TX from "./textures";
import { LightPool } from "./lightPool";
import { buildAgulha, buildBeaconDevice, buildEstilhaco, buildFerry, buildPickup, buildRiscador, fishDoor, rimMat, signMesh, type CreatureRig } from "./models";

export type Quality = "baixa" | "media" | "alta";

interface MatDef { mat: THREE.Material; size: number }

function makeMaterials(): Record<string, MatDef> {
  const std = (map: THREE.Texture | null, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map: map ?? undefined, roughness: 0.7, metalness: 0.05, ...o });
  const grate = std(TX.texGrate(), { transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
  return {
    azulejo: { mat: std(TX.texFloorTile(), { roughness: 0.28, metalness: 0.12, envMapIntensity: 0.6 }), size: 2 },
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
  };
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

interface CreatureView { rig: CreatureRig; c: Creature; shadow: THREE.Mesh; dying: number }

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
  lights: { light: THREE.PointLight; base: number; flicker: number; id?: string; target: number; fixture?: THREE.Mesh }[] = [];
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
  rainRects: [number, number, number, number][] = [];
  sea: THREE.Mesh | null = null;
  ferry: THREE.Group | null = null;
  decorById = new Map<string, THREE.Object3D>();
  vm = buildAgulha();
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
    this.renderer.toneMappingExposure = 1.15;
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
    this.vmCamera.add(this.vm.root);
    this.vm.root.position.set(0.17, -0.17, -0.34);
    this.vmCamera.add(this.vmBeacon.root);
    this.vmBeacon.root.position.set(-0.27, -0.24, -0.42);
    this.vmBeacon.root.scale.setScalar(0.7);
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
        this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.5, 0.82);
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
    this.dynamicBoxes.clear(); this.lights = []; this.lightPool.clear(); this.creatures.clear(); this.pickups.clear(); this.decorById.clear();
    for (const s of this.projectiles.values()) s.removeFromParent(); this.projectiles.clear();
    for (const t of this.tracers) { t.line.removeFromParent(); this.tracerFree.push(t.line); } this.tracers = [];
    this.sparks.clear(); this.shards.clear();
    this.rain = null; this.sea = null; this.ferry = null;
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
      const fmat = l.id ? new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color).multiplyScalar(l.intensity > 0 ? 1.5 : 0.1), toneMapped: false })
        : (fixtureMats.get(fkey) ?? fixtureMats.set(fkey, new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color).multiplyScalar(l.intensity > 0 ? 1.5 : 0.1), toneMapped: false })).get(fkey)!);
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.16), fmat);
      if (l.id) fixture.userData.keep = true;
      fixture.position.set(l.pos.x, l.pos.y + 0.12, l.pos.z);
      this.levelRoot.add(pl, fixture);
      this.lightPool.add(pl);
      this.lights.push({ light: pl, base: l.intensity * 2.2, flicker: l.flicker ?? 0, id: l.id, target: l.intensity > 0 ? 1 : 0, fixture });
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
      sg.rotateX(-Math.PI / 2); sg.translate(50, -1.2, -76);
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
      this.sea = new THREE.Mesh(sg, seaMat);
      this.sea.frustumCulled = false;
      this.levelRoot.add(this.sea);
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
      this.rainRects = [[62, -9, 88, 9], [-10, -60, 110, -9.4]];
      const N = this.quality === "baixa" ? 700 : 1800;
      const pos = new Float32Array(N * 6), drop = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        const r = this.rainRects[Math.random() < 0.45 ? 0 : 1];
        const x = r[0] + Math.random() * (r[2] - r[0]), z = r[1] + Math.random() * (r[3] - r[1]);
        const floorY = z < -9.4 ? -1.2 : 0;
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
    // decoração
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
    const r = buildRiscador(), e = buildEstilhaco();
    tmp.add(r.root, e.root);
    if (e.beam) { e.beam.visible = true; tmp.add(e.beam); }
    for (const m of [...r.rims, ...e.rims]) m.visible = true;
    r.mark.visible = true; e.mark.visible = true;
    tmp.add(new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    tmp.add(new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })));
    tmp.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.texGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    tmp.add(buildPickup("dardos"), buildPickup("curativo"));
    const vis: THREE.Object3D[] = [];
    for (const o of [this.beaconWorld.root, this.rangeRing, this.aimRing, ...this.pulseRings]) if (!o.visible) { o.visible = true; vis.push(o); }
    this.scene.add(tmp);
    try {
      this.renderer.compile(this.scene, this.camera);
      const vv = [this.vm.root, this.vmBeacon.root, this.vm.flash].filter((o) => !o.visible);
      vv.forEach((o) => (o.visible = true));
      this.renderer.compile(this.vmScene, this.vmCamera);
      vv.forEach((o) => (o.visible = false));
    } catch { /* sem contexto (testes) */ }
    for (const o of vis) o.visible = false;
    this.scene.remove(tmp);
    tmp.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== this.tracerGeo) m.geometry.dispose(); });
  }

  private buildDecor(d: { kind: string; pos: { x: number; y: number; z: number }; rot?: number; size?: { x: number; y: number; z: number }; color?: number; text?: string; id?: string }) {
    const g = new THREE.Group();
    g.position.set(d.pos.x, d.pos.y, d.pos.z);
    g.rotation.y = d.rot ?? 0;
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
        const gun = buildAgulha().root; gun.scale.setScalar(1.6); gun.rotation.set(0, Math.PI / 2, Math.PI / 2.2); gun.position.set(0, 1.25, 0.1);
        const bea = buildBeaconDevice().root; bea.position.set(0.25, 0.5, 0.1); bea.scale.setScalar(1.6);
        g.add(door, glow, gun, bea);
        g.userData.items = [gun, bea]; g.userData.glow = glow; g.userData.vlights = [glow];
        break;
      }
      case "drip": { g.userData.drip = true; break; }
      case "ferry": { const f = buildFerry(); g.add(f); this.ferry = g; break; }
      case "dock": {
        for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), this.mats.madeira.mat); p.position.set(-14 + i * 6, -1, -6); g.add(p); }
        const plank = new THREE.Mesh(new THREE.BoxGeometry(36, 0.3, 3), this.mats.madeira.mat); plank.position.set(1, 0.9, -6); g.add(plank);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0x8a7a5a })); rope.position.set(-6, 0.2, -14); rope.rotation.set(1.2, 0, 0.3); g.add(rope);
        break;
      }
    }
    this.levelRoot.add(g);
    for (const l of (g.userData.vlights ?? []) as THREE.PointLight[]) this.lightPool.add(l);
    if (d.id) this.decorById.set(d.id, g);
  }

  /** Reage aos eventos da simulação (efeitos visuais). */
  onEvents(evs: SimEvent[], sim: Sim) {
    for (const e of evs) {
      switch (e.type) {
        case "shot": case "mark": {
          const from = this.vm.muzzle.getWorldPosition(new THREE.Vector3());
          // muzzle no espaço do viewmodel → aproxima no mundo a partir da câmera
          const cam = this.camera;
          const off = new THREE.Vector3(0.17, -0.15, -0.6).applyQuaternion(cam.quaternion);
          from.copy(cam.position).add(off);
          const to = new THREE.Vector3(e.to.x, e.to.y, e.to.z);
          this.addTracer(from, to, e.type === "mark" ? 0xb0ffd0 : 0x7ff6ff, e.type === "mark" ? 0.03 : 0.018);
          this.recoil = 1; this.vm.flash.visible = true; this.vm.flash.material.rotation = Math.random() * 6;
          this.muzzleLight.position.copy(from); this.muzzleLight.intensity = 6;
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
          this.shards.emit(p, 40, 0xe0d8c8, 5, 1.2, 0.07, 10);
          this.sparks.emit(p, 22, e.ctype === "estilhaco" ? 0xffa060 : 0x7ff6ff, 4, 0.6, 0.18, 1);
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
          const d = this.decorById.get(e.id);
          if (d) d.userData.opening = true;
          break;
        }
        case "doorVibrate": {
          const key = e.door === "superior" ? "porta-superior" : e.door === "leste" ? "porta-leste" : e.door === "alcapao" ? "alcapao" : "porta-oficina";
          const dyn = this.dynamicBoxes.get(key);
          if (dyn) dyn.vib = 1.2;
          const d = this.decorById.get(key); if (d) d.userData.vib = 1.2;
          this.sparks.emit(new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z), 10, 0xffa050, 2, 0.8, 0.06, 3);
          break;
        }
        case "latchOpen": { const d = this.decorById.get("trinco"); if (d) (d.userData.led.material as THREE.MeshBasicMaterial).color.set(0x40ff70); break; }
        case "bell": { const d = this.decorById.get("sino"); if (d) d.userData.swing = 1; break; }
        case "lightOn": { const l = this.lights.find((x) => x.id === e.id); if (l) { l.target = 1; l.base = 20; (l.fixture!.material as THREE.MeshBasicMaterial).color.set(0xe8f4ff).multiplyScalar(1.5); } break; }
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
        case "equip": { const l = this.decorById.get("armario-lia"); if (l) { for (const it of l.userData.items) it.visible = false; l.userData.glow.intensity = 0.5; } break; }
        case "pickup": { const g = this.pickups.get(e.id); if (g) { this.sparks.emit(g.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 14, e.kind === "dardos" ? 0x7ff6ff : 0xffb050, 2, 0.5, 0.1, -1); } break; }
        case "beaconCall": {
          const p = new THREE.Vector3(e.pos.x, e.pos.y + 0.2, e.pos.z);
          this.sparks.emit(p, 20, 0xbff8ff, 3, 0.6, 0.12, 0);
          break;
        }
      }
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
        const rig = c.type === "riscador" ? buildRiscador() : buildEstilhaco();
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(c.type === "riscador" ? 0.6 : 0.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
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
        const r = this.rainRects[Math.random() < 0.45 ? 0 : 1];
        const z = r[1] + Math.random() * (r[3] - r[1]);
        this.tmpV.set(r[0] + Math.random() * (r[2] - r[0]), 0.02, z);
        this.sparks.emit(this.tmpV, 1, 0x6080a0, 0.6, 0.2, 0.05, 3);
      }
    }
    this.seaTime.value = t;

    this.updateViewmodel(sim, dt, speed);
  }

  private animateCreature(v: CreatureView, sim: Sim, dt: number) {
    const { rig, c } = v;
    const t = this.time;
    rig.root.position.set(c.pos.x, c.pos.y, c.pos.z);
    rig.root.rotation.y = c.yaw;
    v.shadow.position.set(c.pos.x, (Number.isNaN(sim.nav.floorAt(c.pos.x, c.pos.z)) ? c.pos.y : sim.nav.floorAt(c.pos.x, c.pos.z)) + 0.02, c.pos.z);
    let flash = false;
    for (const h of this.hitFlashes) if (h.c === c.id) { flash = true; break; }
    for (const m of rig.mats) m.emissive.setRGB(flash ? 0.9 : 0, flash ? 0.95 : 0, flash ? 1 : 0);
    for (let i = this.hitFlashes.length - 1; i >= 0; i--) if ((this.hitFlashes[i].t -= dt / Math.max(1, this.creatures.size)) <= 0) this.hitFlashes.splice(i, 1);
    rig.mark.visible = c.markT > 0 && c.alive;
    if (rig.mark.visible) rig.mark.rotation.y += dt * 3;
    if (!c.alive) {
      v.dying += dt;
      const k = Math.min(1, v.dying / 0.6);
      rig.body.rotation.z = k * 1.3; rig.body.position.y = (c.type === "riscador" ? 0.62 : 1.15) * (1 - k * 0.8);
      rig.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, v.dying - 1.2) * 0.8));
      for (const r of rig.rims) (r.material as THREE.MeshBasicMaterial).opacity = 0.1;
      if (rig.beam) rig.beam.visible = false;
      v.shadow.visible = v.dying < 2;
      return;
    }
    rig.root.scale.setScalar(c.state === "emerging" ? Math.min(1, 0.3 + c.stateT) : 1);
    const prep = c.state === "windup" || (c.state === "aim" && c.stateT >= 0);
    const vib = prep ? Math.sin(t * 90) * 0.06 : 0;
    for (let i = 0; i < rig.rims.length; i++) {
      const r = rig.rims[i];
      const m = r.material as THREE.MeshBasicMaterial;
      m.opacity = prep ? 0.95 : 0.35 + Math.sin(t * 3 + i) * 0.1;
      r.scale.set(1 + vib, 1 + (prep ? Math.abs(vib) * 3 : 0), 1);
      m.color.set(c.type === "riscador" ? (prep ? 0xffffff : 0x6ff0ff) : (prep ? 0xffe0a0 : 0xffb070));
    }
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
    } else {
      const open = c.state === "aim" && c.stateT >= 0 ? Math.min(1, c.stateT / 0.3) : 0;
      rig.crown.forEach((cr, i) => { cr.rotation.x = 0.1 + open * 0.9 + Math.sin(t * 40 + i) * open * 0.04; });
      rig.legs.forEach((l, i) => { l.rotation.x = (i === 2 ? 0.3 : 0) + Math.sin(c.anim * 2 + i * 2) * 0.35; });
      rig.body.position.y = 1.15 + Math.sin(t * 2) * 0.03;
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

  private updateViewmodel(sim: Sim, dt: number, speed: number) {
    const has = !!sim.arsenal.current;
    this.vm.root.visible = has && sim.alive;
    this.vmBeacon.root.visible = sim.beacon.owned && sim.alive && (sim.beacon.state === "ready" || sim.beacon.state === "recharging");
    if (!has) return;
    const p = sim.player;
    this.recoil = Math.max(0, this.recoil - dt * 12);
    if (this.recoil < 0.6) this.vm.flash.visible = false;
    this.reloadAnim = Math.max(0, this.reloadAnim - dt);
    this.switchAnim = Math.max(0, this.switchAnim - dt);
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    this.healAnim = Math.max(0, this.healAnim - dt);
    const bob = Math.sin(this.bobT) * 0.012 * Math.min(1, speed / 5.5);
    const bobX = Math.cos(this.bobT * 0.5) * 0.012 * Math.min(1, speed / 5.5);
    let x = 0.17 + bobX, y = -0.17 + bob, z = -0.34 + this.recoil * 0.045;
    let rx = this.recoil * 0.09, ry = 0, rz = 0;
    if (p.sprinting) { x += 0.04; y -= 0.05; ry = 0.6; rz = 0.25; rx = -0.15; }
    if (p.sliding) { rz = -0.3; }
    if (this.reloadAnim > 0) {
      const k = 1 - this.reloadAnim / this.reloadDur;
      const s = Math.sin(k * Math.PI);
      rz += s * 0.7; y -= s * 0.06; rx += s * 0.2;
      this.vm.mag.position.y = -s * 0.12;
    } else this.vm.mag.position.y = 0;
    if (this.switchAnim > 0) y -= Math.sin((this.switchAnim / 0.45) * Math.PI) * 0.25;
    if (this.healAnim > 0) { y -= 0.12; rx -= 0.4; }
    this.vm.root.position.set(x, y, z);
    this.vm.root.rotation.set(rx, ry, rz);
    const a = sim.arsenal.ammo();
    if (a) {
      const f = a.mag / 24;
      this.vm.magMat.emissiveIntensity = 0.2 + f * 1.4;
      this.vm.mag.scale.y = 0.4 + f * 0.6;
    }
    this.vm.coils.forEach((c, i) => ((c.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2 + Math.sin(this.time * 6 + i) * 0.4 + this.recoil * 3));
    // baliza na mão esquerda
    const ty = -0.2 - (this.throwAnim > 0 ? Math.sin((this.throwAnim / 0.4) * Math.PI) * 0.1 : 0) + bob;
    this.vmBeacon.root.position.set(-0.27, ty - 0.04, -0.42);
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
    this.vm.root.visible = false; this.vmBeacon.root.visible = false;
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
