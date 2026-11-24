import * as THREE from "three";

/**
 * Luzes pontuais da fase como "fontes virtuais" + um conjunto fixo de luzes reais.
 *
 * O three.js avalia TODAS as luzes visíveis em cada pixel de cada material iluminado; com
 * ~30 luzes na F1 isso dominava o custo de GPU. As fontes continuam na cena (para posição,
 * cor e animação), mas invisíveis; a cada quadro as K mais relevantes que tocam o frustum
 * são copiadas para K luzes reais. Uma luz cuja esfera de alcance está fora do frustum não
 * ilumina nenhum pixel visível, então descartá-la é exato; o limite K só entra em vistas
 * com mais de K esferas no frustum, e aí ficam as que alcançam a área mais próxima da câmera.
 * O número de luzes reais é sempre K, então os shaders nunca recompilam por causa disso.
 */
export class LightPool {
  readonly real: THREE.PointLight[] = [];
  private sources: { light: THREE.PointLight; pos: THREE.Vector3; w: number; score: number; inView: boolean }[] = [];
  private cand: LightPool["sources"] = [];
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private last = performance.now();
  private fresh = true;
  stats = { sources: 0, inFrustum: 0, used: 0 };

  constructor(parent: THREE.Object3D, public k: number) {
    for (let i = 0; i < 24; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.visible = i < k;
      parent.add(l);
      this.real.push(l);
    }
  }

  /** Muda K (só no carregamento/opção de qualidade: muda a contagem de luzes do shader). */
  setK(k: number) { this.k = k; this.real.forEach((l, i) => (l.visible = i < k)); this.fresh = true; }

  clear() { this.sources = []; this.cand = []; this.fresh = true; }

  /** Registra uma luz já posicionada na cena; ela passa a servir só como dado. */
  add(light: THREE.PointLight) {
    light.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3().setFromMatrixPosition(light.matrixWorld);
    light.visible = false;
    this.sources.push({ light, pos, w: 0, score: 0, inView: false });
  }

  update(camera: THREE.Camera) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const cp = camera.position;
    const cand = this.cand; cand.length = 0;
    for (const s of this.sources) {
      s.inView = false;
      if (s.light.intensity <= 1e-3) continue;
      this.sphere.center.copy(s.pos); this.sphere.radius = s.light.distance;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = s.pos.distanceTo(cp);
      // prioridade: o quanto a esfera de alcance se aproxima da câmera, depois a distância
      s.score = Math.max(0, d - s.light.distance) * 4 + d;
      cand.push(s);
    }
    cand.sort(byScore);
    const n = Math.min(this.k, cand.length);
    for (let i = 0; i < n; i++) cand[i].inView = true;
    for (const s of this.sources) {
      // entra suavemente (sem estalo) quando passa a ser uma das K; sai quando deixa de ser
      s.w = s.inView ? (this.fresh ? 1 : Math.min(1, s.w + dt * 6)) : 0;
    }
    this.fresh = false;
    for (let i = 0; i < this.k; i++) {
      const r = this.real[i];
      if (i < n) {
        const s = cand[i].light;
        r.position.copy(cand[i].pos); r.color.copy(s.color); r.distance = s.distance; r.decay = s.decay;
        r.intensity = s.intensity * cand[i].w;
      } else r.intensity = 0;
    }
    this.stats.sources = this.sources.length; this.stats.inFrustum = cand.length; this.stats.used = n;
  }
}
const byScore = (a: { score: number }, b: { score: number }) => a.score - b.score;
