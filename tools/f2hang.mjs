import { chromium } from "playwright";
import { startServer, sleep, waitFor } from "../e2e/lib.mjs";
const srv = await startServer(4399);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const errors = []; page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); }); page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(srv.url + "?debug=1");
await waitFor(page, () => window.__fh?.state === "menu", null, 60000, "menu");
await page.evaluate(() => { window.__fh.start("F2"); });
await waitFor(page, () => window.__fh.sim?.level.id === "F2", null, 60000, "F2");
await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); g.sim.damageMul = 0; window.__n = 0; const o = g.frame.bind(g); g.frame = (t) => { window.__n++; return o(t); }; window.__fh.setSpeed(0); });
const place = (p, look) => page.evaluate(({ p, look }) => { const s = window.__fh.sim; s.player.pos.x = p.x; s.player.pos.y = p.y; s.player.pos.z = p.z; window.__fh.aimAt(look); }, { p, look });
for (const [p, l] of [[{ x: 3, y: 0, z: 1 }, { x: 20, y: 1.2, z: 1 }], [{ x: 36, y: 0, z: 6 }, { x: 52, y: 1.4, z: -4 }], [{ x: 80, y: 0, z: 2 }, { x: 100, y: 2, z: 2 }]]) {
  await place(p, l);
  for (let i = 0; i < 4; i++) { await sleep(5000); console.log(JSON.stringify(p), "quadros", await page.evaluate(() => window.__n), errors.slice(-2)); }
}
await browser.close(); srv.stop();
