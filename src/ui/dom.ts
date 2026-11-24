/**
 * Escritas no DOM só quando o valor muda. O HUD atualizava ~25 propriedades por quadro
 * (inclusive innerHTML), o que força recálculo de estilo/layout mesmo sem mudança visível.
 */
const els = new Map<string, HTMLElement>();
const last = new Map<string, string>();
export const el = (id: string) => { let e = els.get(id); if (!e || !e.isConnected) { e = document.getElementById(id)!; els.set(id, e); } return e; };
const changed = (key: string, v: string) => { if (last.get(key) === v) return false; last.set(key, v); return true; };
export const text = (id: string, v: string) => { if (changed(id + "|t", v)) el(id).textContent = v; };
export const html = (id: string, v: string) => { if (changed(id + "|h", v)) el(id).innerHTML = v; };
export const style = (id: string, prop: string, v: string) => { if (changed(id + "|s" + prop, v)) (el(id).style as any)[prop] = v; };
export const attr = (id: string, name: string, v: string) => { if (changed(id + "|a" + name, v)) el(id).setAttribute(name, v); };
export const cls = (id: string, name: string, on: boolean) => { if (changed(id + "|c" + name, on ? "1" : "0")) el(id).classList.toggle(name, on); };
/** Para elementos sem id (ex.: itens de lista). */
export function elStyle(e: HTMLElement, prop: string, v: string) { const k = "__" + prop; if ((e as any)[k] !== v) { (e as any)[k] = v; (e.style as any)[prop] = v; } }
export function elCls(e: HTMLElement, name: string, on: boolean) { const k = "__c" + name; if ((e as any)[k] !== on) { (e as any)[k] = on; e.classList.toggle(name, on); } }
/** Esquece o cache (quando outro código mexe nos mesmos elementos). */
export const resetDomCache = () => last.clear();
