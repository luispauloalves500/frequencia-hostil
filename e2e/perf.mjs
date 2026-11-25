// Mede custos determinísticos por cena (antes/depois da otimização).
// uso: node e2e/perf.mjs <rótulo> [qualidade]
import { chromium } from "playwright";
import { startServer, sleep, waitFor } from "./lib.mjs";
import { mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const label = process.argv[2] ?? "atual";
const quality = process.argv[3] ?? "media";
const ROOT = new URL("..", import.meta.url).pathname;
const OUT = ROOT + "release/perf/"; const SH = ROOT + "release/screenshots/perf/";
mkdirSync(OUT, { recursive: true }); mkdirSync(SH, { recursive: true });

const srv = await startServer(Number(process.env.PORT ?? 4391));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const t0 = Date.now();
await page.goto(srv.url + "?debug=1");
await waitFor(page, () => window.__fh?.state === "menu", null, 60000, "menu");
const menuReadyMs = Date.now() - t0;
await page.evaluate((q) => { localStorage.clear(); localStorage.setItem("fh.options", JSON.stringify({ quality: q, perf: "max" })); }, quality);
await page.reload();
await waitFor(page, () => window.__fh?.state === "menu", null, 60000, "menu");
// instrumentação: info acumulada por quadro, tempo de JS e tempo com sincronização da GPU (proxy de custo de pixel)
await page.evaluate(() => {
  const g = window.__fh.game, R = g.renderer, gl = R.renderer.getContext();
  R.renderer.info.autoReset = false;
  const px = new Uint8Array(4);
  window.__perf = { on: false, js: [], sync: [], heap: [], calls: [], tris: [] };
  const orig = g.frame.bind(g);
  g.frame = (now) => {
    const P = window.__perf;
    if (!P.on) return orig(now);
    R.renderer.info.reset();
    const h0 = performance.memory.usedJSHeapSize;
    const a = performance.now();
    orig(now);
    const b = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c = performance.now();
    const h1 = performance.memory.usedJSHeapSize;
    P.js.push(b - a); P.sync.push(c - a); if (h1 > h0) P.heap.push(h1 - h0); else P.heap.push(0);
    P.calls.push(R.renderer.info.render.calls); P.tris.push(R.renderer.info.render.triangles);
  };
});

async function measure(scene, frames = 40) {
  await sleep(1500);
  await page.evaluate(() => { window.gc?.(); const P = window.__perf; P.js = []; P.sync = []; P.heap = []; P.calls = []; P.tris = []; P.on = true; });
  await waitFor(page, (n) => window.__perf.js.length >= n, frames, 300000, "quadros");
  const r = await page.evaluate(() => {
    const P = window.__perf; P.on = false;
    const R = window.__fh.game.renderer, info = R.renderer.info;
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    let lights = 0, lightsOn = 0, meshes = 0, visibleMeshes = 0, points = 0;
    R.scene.traverse((o) => { if (o.isLight && !o.isAmbientLight && !o.isHemisphereLight) { lights++; if (o.visible && o.intensity > 0) lightsOn++; } if (o.isMesh) { meshes++; if (o.visible) visibleMeshes++; } if (o.isPoints || o.isLineSegments) points++; });
    return {
      drawCalls: Math.round(avg(P.calls)), triangles: Math.round(avg(P.tris)),
      programs: info.programs?.length ?? null, geometries: info.memory.geometries, textures: info.memory.textures,
      pointLightsInScene: lights, lightsOn, meshes, visibleMeshes, pointsAndLines: points,
      jsMsMedian: +med(P.js).toFixed(2), jsMsAvg: +avg(P.js).toFixed(2),
      frameMsWithGpuSyncMedian: +med(P.sync).toFixed(1),
      heapKBPerFrame: +(avg(P.heap) / 1024).toFixed(1),
      lightPool: { ...R.lightPool.stats }, pixelRatio: R.renderer.getPixelRatio(), drawingBuffer: `${R.renderer.domElement.width}x${R.renderer.domElement.height}`,
    };
  });
  await page.evaluate(() => { document.getElementById("diag").style.visibility = "hidden"; });
  await sleep(300);
  await page.screenshot({ path: `${SH}${label}-${scene}.jpg`, type: "jpeg", quality: 90 });
  await page.evaluate(() => { document.getElementById("diag").style.visibility = ""; });
  console.log(scene, JSON.stringify(r));
  return r;
}

const out = { label, quality, at: new Date().toISOString(), menuReadyMs, scenes: {} };
out.scenes.menu = await measure("menu");

// F1 do menu
await page.click('button[data-act="new"]'); await page.click('button[data-diff="normal"]');
await waitFor(page, () => window.__fh.state === "playing", null, 60000, "F1");
out.f1LoadMs = Math.round(await page.evaluate(() => window.__fhLastLoadMs));
const place = (p, look) => page.evaluate(({ p, look }) => { const s = window.__fh.sim; s.player.pos.x = p.x; s.player.pos.y = p.y; s.player.pos.z = p.z; s.player.vel && (s.player.vel.x = s.player.vel.y = s.player.vel.z = 0); window.__fh.aimAt(look); }, { p, look });
await page.evaluate(() => { const s = window.__fh.sim; s.damageMul = 0; });

// bilheteria
await page.evaluate(() => window.__fh.setSpeed(0));
await place({ x: 27, y: 0, z: -1.5 }, { x: 36, y: 1.3, z: 3 });
out.scenes.bilheteria = await measure("bilheteria");

// praça no meio da onda
await page.evaluate(() => window.__fh.setSpeed(4));
await place({ x: 65, y: 0, z: 5 }, { x: 78, y: 1.4, z: -1 });
await waitFor(page, () => window.__fh.sim.t > 12 && window.__fh.sim.creatures.filter((c) => c.alive && c.state !== "emerging" && c.tag?.startsWith("onda")).length >= 2, null, 300000, "onda ativa");
await page.evaluate(() => window.__fh.setSpeed(0));
await place({ x: 65, y: 0, z: 6 }, { x: 77, y: 1.2, z: 3 });
out.scenes.praca = await measure("praca");

// embarque
await place({ x: 90, y: 0, z: 4.7 }, { x: 100, y: 1.5, z: 4.7 });
out.scenes.embarque = await measure("embarque");

// F2 • Mercado Afogado (cenas novas da v0.4; não existem nos rótulos antigos)
if (process.env.F2 !== "0") {
  await page.evaluate(() => { window.__fh.setSpeed(1); window.__fh.start("F2"); });
  await waitFor(page, () => window.__fh.sim?.level.id === "F2" && (window.__fh.state === "playing" || window.__fh.state === "paused"), null, 60000, "F2");
  await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); g.sim.damageMul = 0; });
  out.f2LoadMs = Math.round(await page.evaluate(() => window.__fhLastLoadMs));
  await page.evaluate(() => window.__fh.setSpeed(0));
  await place({ x: 3, y: 0, z: 1 }, { x: 20, y: 1.2, z: 1 });
  out.scenes.f2Peixaria = await measure("f2-peixaria");
  await place({ x: 36, y: 0, z: 6 }, { x: 52, y: 1.4, z: -4 });
  out.scenes.f2Praca = await measure("f2-praca");
  // névoa do Véu: uma nuvem completa perto da câmera
  await page.evaluate(() => { const s = window.__fh.sim; const v = s.creatures.find((c) => c.type === "veu"); if (v) { s.spawnCloud(v, { x: 26, y: 0, z: 0 }); } });
  await place({ x: 20, y: 0, z: 0.5 }, { x: 30, y: 1.2, z: 0 });
  out.scenes.f2Nevoa = await measure("f2-nevoa");
  await place({ x: 80, y: 0, z: 2 }, { x: 100, y: 2, z: 2 });
  out.scenes.f2Boia = await measure("f2-boia");
}

// pacote
const assets = ROOT + "dist/assets/";
out.bundle = readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => { const b = readFileSync(assets + f); return { file: f, kB: +(b.length / 1024).toFixed(1), gzipKB: +(gzipSync(b).length / 1024).toFixed(1) }; });
out.consoleErrors = errors;
writeFileSync(`${OUT}${label}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ menuReadyMs, f1LoadMs: out.f1LoadMs, bundle: out.bundle, errors: errors.length }));
await browser.close(); srv.stop();
