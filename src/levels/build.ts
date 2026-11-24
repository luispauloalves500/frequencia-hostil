import { box, type BoxKind, type World } from "../core/world";

export const T = 0.4; // espessura de parede

/** Parede ao longo de X (em z fixo) com vãos [a,b]. */
export function wallX(w: World, x0: number, x1: number, z: number, h: number, gaps: [number, number][] = [], mat = "azulejo-parede", y0 = 0, kind: BoxKind = "solid") {
  const segs = cut(x0, x1, gaps);
  for (const [a, b] of segs) w.add(box(a, y0, z - T / 2, b, y0 + h, z + T / 2, mat, kind));
  // vergas acima dos vãos
  for (const [a, b] of gaps) if (h > 3) w.add(box(a, y0 + 3, z - T / 2, b, y0 + h, z + T / 2, mat, kind));
}
/** Parede ao longo de Z (em x fixo) com vãos [a,b]. */
export function wallZ(w: World, z0: number, z1: number, x: number, h: number, gaps: [number, number][] = [], mat = "azulejo-parede", y0 = 0, kind: BoxKind = "solid") {
  const segs = cut(z0, z1, gaps);
  for (const [a, b] of segs) w.add(box(x - T / 2, y0, a, x + T / 2, y0 + h, b, mat, kind));
  for (const [a, b] of gaps) if (h > 3) w.add(box(x - T / 2, y0 + 3, a, x + T / 2, y0 + h, b, mat, kind));
}
function cut(a0: number, a1: number, gaps: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cur = a0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > cur) out.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (cur < a1) out.push([cur, a1]);
  return out;
}
export function floor(w: World, x0: number, z0: number, x1: number, z1: number, mat = "azulejo", top = 0) {
  w.add(box(x0, top - 0.5, z0, x1, top, z1, mat));
}
/** Escada subindo na direção indicada. */
export function stairs(w: World, x0: number, x1: number, zBottom: number, zTop: number, height: number, steps: number, mat = "metal") {
  const dir = Math.sign(zTop - zBottom);
  const run = Math.abs(zTop - zBottom) / steps;
  for (let i = 0; i < steps; i++) {
    const za = zBottom + dir * run * i, zb = za + dir * run;
    w.add(box(x0, 0, za, x1, (height * (i + 1)) / steps, zb, mat));
  }
}
