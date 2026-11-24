export interface V3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const clone = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distXZ = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Direção de visão a partir de yaw/pitch (yaw 0 olha para -Z). */
export const dirFromYawPitch = (yaw: number, pitch: number): V3 => ({
  x: -Math.sin(yaw) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: -Math.cos(yaw) * Math.cos(pitch),
});
export const yawTo = (from: V3, to: V3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
export const angleDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

/** RNG determinístico (mulberry32) para que testes e execuções sejam reproduzíveis. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
