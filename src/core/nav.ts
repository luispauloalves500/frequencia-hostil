import type { V3 } from "./math";
import type { World } from "./world";

/** Grade navegável 2,5D gerada a partir das caixas do mundo. */
export class NavGrid {
  cell = 0.5;
  w = 0; h = 0;
  ox = 0; oz = 0;
  height!: Float32Array; // piso de cada célula (NaN = bloqueada)
  builtVersion = -1;
  constructor(public world: World, public clearance = 1.0, public agentR = 0.4) {}

  build() {
    const b = this.world.bounds;
    this.ox = b.minX; this.oz = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / this.cell);
    this.h = Math.ceil((b.maxZ - b.minZ) / this.cell);
    this.height = new Float32Array(this.w * this.h);
    // pré-filtra caixas por coluna para acelerar
    const boxes = this.world.boxes.filter((x) => x.enabled);
    for (let j = 0; j < this.h; j++) {
      const z = this.oz + (j + 0.5) * this.cell;
      const row = boxes.filter((bx) => bx.min.z - 0.6 < z && bx.max.z + 0.6 > z);
      for (let i = 0; i < this.w; i++) {
        const x = this.ox + (i + 0.5) * this.cell;
        let g = -Infinity;
        for (const bx of row) {
          if (bx.kind === "ceiling") continue;
          if (x < bx.min.x || x > bx.max.x || z < bx.min.z || z > bx.max.z) continue;
          if (bx.max.y <= 2.8 && bx.min.y < 1.5 && bx.max.y > g) g = bx.max.y;
        }
        let ok = g > -Infinity;
        if (ok) {
          const r = this.agentR, y0 = g + 0.5, y1 = g + this.clearance;
          for (const bx of row) {
            if (bx.max.y <= y0 || bx.min.y >= y1) continue;
            const cx = Math.max(bx.min.x, Math.min(x, bx.max.x));
            const cz = Math.max(bx.min.z, Math.min(z, bx.max.z));
            if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { ok = false; break; }
          }
        }
        this.height[j * this.w + i] = ok ? g : NaN;
      }
    }
    this.builtVersion = this.world.version;
  }

  ensure() { if (this.builtVersion !== this.world.version) this.build(); }

  idx(x: number, z: number) {
    const i = Math.floor((x - this.ox) / this.cell), j = Math.floor((z - this.oz) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }
  center(k: number): V3 {
    const i = k % this.w, j = Math.floor(k / this.w);
    return { x: this.ox + (i + 0.5) * this.cell, y: this.height[k], z: this.oz + (j + 0.5) * this.cell };
  }
  walkable(k: number) { return k >= 0 && !Number.isNaN(this.height[k]); }

  /** Célula navegável mais próxima (busca em anel), preferindo altura próxima de y. */
  nearest(p: V3, maxR = 6): number {
    const k0 = this.idx(p.x, p.z);
    if (this.walkable(k0) && Math.abs(this.height[k0] - p.y) < 1.2) return k0;
    const i0 = Math.floor((p.x - this.ox) / this.cell), j0 = Math.floor((p.z - this.oz) / this.cell);
    const R = Math.ceil(maxR / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= R; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const k = j * this.w + i;
        if (!this.walkable(k)) continue;
        const d = di * di + dj * dj + (this.height[k] - p.y) ** 2 * 8;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0 && r * r > bd) break;
    }
    return best;
  }

  private neighbors(k: number, out: number[]) {
    out.length = 0;
    const i = k % this.w, j = Math.floor(k / this.w);
    const h0 = this.height[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
      const n = nj * this.w + ni;
      if (!this.walkable(n) || Math.abs(this.height[n] - h0) > 0.5) continue;
      if (di && dj) {
        const a = j * this.w + ni, b = nj * this.w + i;
        if (!this.walkable(a) || !this.walkable(b)) continue;
        if (Math.abs(this.height[a] - h0) > 0.5 || Math.abs(this.height[b] - h0) > 0.5) continue;
      }
      out.push(n);
    }
  }

  /** A* entre dois pontos. Devolve lista de pontos (sem o inicial) ou null. */
  path(from: V3, to: V3, maxNodes = 6000): V3[] | null {
    this.ensure();
    const s = this.nearest(from, 3), g = this.nearest(to, 4);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.center(g)];
    const open = new MinHeap();
    const gScore = new Map<number, number>();
    const came = new Map<number, number>();
    const gc = this.center(g);
    const hf = (k: number) => { const c = this.center(k); return Math.hypot(c.x - gc.x, c.z - gc.z); };
    gScore.set(s, 0); open.push(s, hf(s));
    const nb: number[] = [];
    let n = 0;
    while (open.size) {
      const cur = open.pop();
      if (cur === g) break;
      if (++n > maxNodes) return null;
      const gc0 = gScore.get(cur)!;
      this.neighbors(cur, nb);
      for (const nk of nb) {
        const diag = (nk % this.w) !== (cur % this.w) && Math.floor(nk / this.w) !== Math.floor(cur / this.w);
        const ng = gc0 + (diag ? 1.414 : 1) * this.cell;
        if (ng < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, ng); came.set(nk, cur); open.push(nk, ng + hf(nk));
        }
      }
    }
    if (!came.has(g)) return null;
    const cells: number[] = [g];
    let c = g;
    while (came.has(c)) { c = came.get(c)!; if (c !== s) cells.push(c); }
    cells.reverse();
    // suavização: pula células enquanto a linha reta for navegável
    const pts = cells.map((k) => this.center(k));
    const out: V3[] = [];
    let anchor = this.center(s);
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineWalkable(anchor, pts[j])) j--;
      out.push(pts[j]); anchor = pts[j]; i = j + 1;
    }
    return out;
  }

  reachable(from: V3, to: V3): boolean { return this.path(from, to) !== null; }

  lineWalkable(a: V3, b: V3): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / (this.cell * 0.5));
    let prevH = this.height[this.idx(a.x, a.z)];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const k = this.idx(x, z);
      if (!this.walkable(k)) return false;
      if (Math.abs(this.height[k] - prevH) > 0.5) return false;
      prevH = this.height[k];
    }
    return true;
  }

  floorAt(x: number, z: number): number { const k = this.idx(x, z); return this.walkable(k) ? this.height[k] : NaN; }
}

class MinHeap {
  k: number[] = []; p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pr: number) {
    this.k.push(key); this.p.push(pr);
    let i = this.k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.p[par] <= this.p[i]) break;
      [this.k[par], this.k[i]] = [this.k[i], this.k[par]]; [this.p[par], this.p[i]] = [this.p[i], this.p[par]];
      i = par;
    }
  }
  pop(): number {
    const top = this.k[0];
    const lk = this.k.pop()!, lp = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l] < this.p[m]) m = l;
        if (r < this.k.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]]; [this.p[m], this.p[i]] = [this.p[i], this.p[m]];
        i = m;
      }
    }
    return top;
  }
}
