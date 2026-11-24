import type { V3 } from "./math";

/** solid: bloqueia tudo. grate: bloqueia passagem e tiros, deixa passar som e visão.
 *  water/decal: sem colisão. ceiling: bloqueia, mas é ignorado ao procurar piso navegável. */
export type BoxKind = "solid" | "grate" | "ceiling";

export interface Box {
  id: string;
  min: V3;
  max: V3;
  kind: BoxKind;
  mat: string; // material visual / passo
  enabled: boolean;
  noRender?: boolean;
}

export interface RayHit { t: number; box: Box; normal: V3 }

export class World {
  boxes: Box[] = [];
  private byId = new Map<string, Box>();
  version = 0;
  bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };

  add(b: Box) {
    this.boxes.push(b);
    this.byId.set(b.id, b);
    this.bounds.minX = Math.min(this.bounds.minX, b.min.x);
    this.bounds.maxX = Math.max(this.bounds.maxX, b.max.x);
    this.bounds.minZ = Math.min(this.bounds.minZ, b.min.z);
    this.bounds.maxZ = Math.max(this.bounds.maxZ, b.max.z);
    return b;
  }
  get(id: string) { return this.byId.get(id); }
  setEnabled(id: string, on: boolean) {
    const b = this.byId.get(id);
    if (b && b.enabled !== on) { b.enabled = on; this.version++; }
  }

  /** Altura do piso mais alto sob um círculo, com topo até maxTop. */
  groundAt(x: number, z: number, r: number, maxTop: number): number {
    let g = -Infinity;
    for (const b of this.boxes) {
      if (!b.enabled) continue;
      if (b.max.y > maxTop) continue;
      if (x + r <= b.min.x || x - r >= b.max.x || z + r <= b.min.z || z - r >= b.max.z) continue;
      if (b.max.y > g) g = b.max.y;
    }
    return g;
  }

  /** Empurra um cilindro vertical para fora das caixas que ocupam o intervalo [y0,y1]. */
  resolveCylinder(p: V3, r: number, y0: number, y1: number): { hit: boolean; nx: number; nz: number } {
    let hit = false, nx = 0, nz = 0;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const b of this.boxes) {
        if (!b.enabled) continue;
        if (b.max.y <= y0 || b.min.y >= y1) continue;
        const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-10) {
          // centro dentro da caixa: sai pelo lado mais próximo
          const pen = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z];
          const i = pen.indexOf(Math.min(...pen));
          if (i === 0) { p.x = b.min.x - r; dx = -1; dz = 0; }
          else if (i === 1) { p.x = b.max.x + r; dx = 1; dz = 0; }
          else if (i === 2) { p.z = b.min.z - r; dx = 0; dz = -1; }
          else { p.z = b.max.z + r; dx = 0; dz = 1; }
        } else {
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          p.x = cx + dx * r; p.z = cz + dz * r;
        }
        hit = any = true; nx = dx; nz = dz;
      }
      if (!any) break;
    }
    return { hit, nx, nz };
  }

  /** Há alguma caixa ocupando o volume de um cilindro? */
  overlapsCylinder(x: number, z: number, r: number, y0: number, y1: number, kinds?: BoxKind[]): boolean {
    for (const b of this.boxes) {
      if (!b.enabled) continue;
      if (kinds && !kinds.includes(b.kind)) continue;
      if (b.max.y <= y0 || b.min.y >= y1) continue;
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }

  raycast(o: V3, d: V3, maxT: number, kinds: BoxKind[] = ["solid", "grate", "ceiling"]): RayHit | null {
    let best: RayHit | null = null;
    for (const b of this.boxes) {
      if (!b.enabled || !kinds.includes(b.kind)) continue;
      const h = rayBox(o, d, b, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = { t: h.t, box: b, normal: h.normal };
    }
    return best;
  }

  /** Segmento bloqueado pelas caixas dos tipos indicados (padrão: só paredes sólidas). */
  blocked(a: V3, b: V3, kinds: BoxKind[] = ["solid", "ceiling"]): boolean {
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const L = Math.hypot(d.x, d.y, d.z);
    if (L < 1e-6) return false;
    d.x /= L; d.y /= L; d.z /= L;
    return this.raycast(a, d, L - 1e-3, kinds) !== null;
  }
}

export function rayBox(o: V3, d: V3, b: Box, maxT: number): { t: number; normal: V3 } | null {
  let tmin = 0, tmax = maxT;
  let nAxis = -1, nSign = 0;
  const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    const od = o[a], dd = d[a];
    if (Math.abs(dd) < 1e-9) {
      if (od < b.min[a] || od > b.max[a]) return null;
      continue;
    }
    let t1 = (b.min[a] - od) / dd, t2 = (b.max[a] - od) / dd;
    let s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = i; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis < 0) return { t: 0, normal: { x: 0, y: 1, z: 0 } }; // começou dentro
  const n = { x: 0, y: 0, z: 0 };
  n[axes[nAxis]] = nSign;
  return { t: tmin, normal: n };
}

let autoId = 0;
export function box(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  mat = "concreto", kind: BoxKind = "solid", id?: string,
): Box {
  return {
    id: id ?? `b${autoId++}`,
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
    kind, mat, enabled: true,
  };
}
