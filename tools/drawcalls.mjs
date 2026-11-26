// Quebra das chamadas de desenho de um quadro por material/objeto — uso: node tools/drawcalls.mjs F1 x y z lx ly lz
import { chromium } from "playwright";
import { startServer, sleep, waitFor } from "../e2e/lib.mjs";
const [lvl, x, y, z, lx, ly, lz] = process.argv.slice(2);
const srv = await startServer(4398);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
await page.goto(srv.url + "?debug=1");
await waitFor(page, () => window.__fh?.state === "menu", null, 60000, "menu");
await page.evaluate((l) => { window.__fh.start(l); }, lvl);
await waitFor(page, (l) => window.__fh.sim?.level.id === l, lvl, 60000, "lvl");
await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); window.__fh.setSpeed(0); });
await sleep(1500);
await page.evaluate(({ p, look }) => { const s = window.__fh.sim; s.player.pos.x = p.x; s.player.pos.y = p.y; s.player.pos.z = p.z; window.__fh.aimAt(look); }, { p: { x: +x, y: +y, z: +z }, look: { x: +lx, y: +ly, z: +lz } });
await sleep(800);
const out = await page.evaluate(() => {
  const R = window.__fh.game.renderer, rr = R.renderer;
  // usa a lista de render do three: intercepta renderBufferDirect por um quadro
  const counts = {}, tris = {}; const orig = rr.renderBufferDirect.bind(rr);
  rr.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
    let o = object, path = [], top = object; while (o && o !== R.scene) { if (o.name) path.push(o.name); top = o; o = o.parent; }
    const tk = top.name || (top.userData?.creature ? "criatura" : top.isGroup ? `grupo(${top.children.length})` : top.type);
    const k = `${material.type}${material.transparent ? "/T" : ""}|${path[0] ?? "-"}|top:${tk}|${geometry.type}` + "|" + (material.color?.getHexString() ?? "");
    const tri = (group ? group.count : geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1); counts[k] = (counts[k] ?? 0) + 1; tris[k] = (tris[k] ?? 0) + tri; return orig(camera, scene, geometry, material, object, group);
  };
  return new Promise((res) => requestAnimationFrame(() => { for (const k in counts) { delete counts[k]; delete tris[k]; } requestAnimationFrame(() => { rr.renderBufferDirect = orig; res(Object.fromEntries(Object.keys(counts).map((k) => [k, [counts[k], Math.round(tris[k])]]))); }); }));
});
const by = process.env.BY === "tri" ? 1 : 0;
const arr = Object.entries(out).sort((a, b) => b[1][by] - a[1][by]);
console.log("total chamadas", arr.reduce((a, b) => a + b[1][0], 0), "triângulos", arr.reduce((a, b) => a + b[1][1], 0));
for (const [k, v] of arr.slice(0, Number(process.env.N ?? 40))) console.log(v[0], v[1], k);
await browser.close(); srv.stop();
