import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

export const SHOTS = new URL("../release/screenshots/", import.meta.url).pathname;
export const REPORTS = new URL("../release/reports/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true }); mkdirSync(REPORTS, { recursive: true });

export async function startServer(port = 4391) {
  if (process.env.FH_URL) return { url: process.env.FH_URL, stop() {} };
  const p = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--port", String(port), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe", detached: true });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) break; } catch { /* ainda subindo */ }
    if (Date.now() - t0 > 20000) throw new Error("preview não subiu: " + out);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url: `http://localhost:${port}/`, stop: () => { try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill(); } } };
}

export async function launch() {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { browser, ctx, page, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(page, fn, arg, timeout = 60000, label = "condição") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await sleep(100);
  }
  throw new Error(`timeout esperando ${label}`);
}

export class Report {
  constructor(name) { this.name = name; this.checks = []; this.notes = []; }
  check(label, ok, detail = "") { this.checks.push({ label, ok: !!ok, detail }); console.log(`${ok ? "✔" : "✘"} ${label}${detail ? " — " + detail : ""}`); }
  note(s) { this.notes.push(s); console.log("  · " + s); }
  get ok() { return this.checks.every((c) => c.ok); }
  save() { writeFileSync(REPORTS + this.name + ".json", JSON.stringify({ name: this.name, ok: this.ok, checks: this.checks, notes: this.notes, at: new Date().toISOString() }, null, 2)); return this.ok; }
}

/** Abre o jogo com a qualidade pedida gravada nas opções (como faria o menu de Opções). */
export async function openGame(page, url, query = "?debug=1", quality = "baixa") {
  await page.goto(url + query);
  await page.evaluate((q) => { const o = JSON.parse(localStorage.getItem("fh.options") || "{}"); o.quality = q; localStorage.setItem("fh.options", JSON.stringify(o)); }, quality);
  await page.reload();
  await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
}
export const state = (page) => page.evaluate(() => window.__fh.state);
/** Equivale a mover o mouse até o ponto; o disparo usa clique real do mouse. */
export const aim = (page, p) => page.evaluate((p) => window.__fh.aimAt(p), p);
export async function click(page, button = "left") { await page.mouse.down({ button }); await sleep(90); await page.mouse.up({ button }); }
export async function key(page, code, hold = 90) { await page.keyboard.down(code); await sleep(hold); await page.keyboard.up(code); }
export async function goto(page, p, timeout = 60000, sprint = false) {
  await page.evaluate(({ p, sprint }) => { const a = window.__fh.autopilot(); a.fight = false; a.moveTo(p, sprint); }, { p, sprint });
  await waitFor(page, () => window.__fh.game.auto?.arrived(0.8), null, timeout, `chegar em ${p.x},${p.z}`);
  await page.evaluate(() => window.__fh.manual());
}
export async function runPlan(page, name, arg, timeout = 600000) {
  await page.evaluate(({ name, arg }) => window.__fh.runPlan(name, arg), { name, arg });
  await waitFor(page, () => window.__fh.plan?.done || window.__fh.state === "dead" || window.__fh.state === "result", null, timeout, `roteiro ${name}`);
  return page.evaluate(() => window.__fh.plan);
}
