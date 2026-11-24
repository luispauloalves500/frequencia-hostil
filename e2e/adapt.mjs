// Verifica a resolução adaptativa: em "auto" cai quando lento; em "max" fica 1.
import { chromium } from "playwright";
import { startServer, sleep, waitFor } from "./lib.mjs";
const srv = await startServer();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const run = async (perf) => {
  await page.goto(srv.url + "?debug=1");
  await page.evaluate((perf) => { localStorage.clear(); localStorage.setItem("fh.options", JSON.stringify({ quality: "media", perf })); }, perf);
  await page.reload();
  await waitFor(page, () => window.__fh?.state === "menu", null, 60000, "menu");
  const opt = await page.evaluate(() => document.getElementById("optPerf")?.value);
  await page.click('button[data-act="new"]'); await page.click('button[data-diff="normal"]');
  await waitFor(page, () => window.__fh.state === "playing", null, 60000, "F1");
  await page.evaluate(() => { window.__fh.sim.damageMul = 0; window.__fh.setSpeed(0); });
  await sleep(20000);
  const r = await page.evaluate(() => ({ scale: window.__fh.game.renderer.renderScale, pr: window.__fh.game.renderer.renderer.getPixelRatio() }));
  console.log(perf, "select=", opt, JSON.stringify(r));
  return r;
};
const a = await run("auto"), m = await run("max");
const ok = a.scale < 1 && m.scale === 1 && errors.length === 0;
console.log(ok ? "ADAPT OK" : "ADAPT FALHOU", errors);
await browser.close(); srv.stop(); process.exit(ok ? 0 : 1);
