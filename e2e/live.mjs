// Verifica a página publicada: HTTP 200 e carregamento sem erros no console.
import { launch, sleep, waitFor } from "./lib.mjs";
const url = process.argv[2];
const r = await fetch(url); console.log("HTTP", r.status);
const { browser, page, errors } = await launch();
const failed = [];
page.on("requestfailed", (q) => failed.push(q.url()));
page.on("response", (q) => { if (q.status() >= 400) failed.push(q.status() + " " + q.url()); });
await page.goto(url);
await waitFor(page, () => !document.getElementById("menu").classList.contains("hidden") && document.getElementById("buildTag").textContent.length > 0, null, 30000, "menu");
await page.click('button[data-act="new"]'); await page.click('button[data-diff="normal"]');
await sleep(4000);
const st = await page.evaluate(() => ({ build: document.getElementById("buildTag").textContent, hud: !document.getElementById("hud").classList.contains("hidden"), resume: !document.getElementById("clickResume").classList.contains("hidden") }));
await page.screenshot({ path: new URL("../release/screenshots/live-check.png", import.meta.url).pathname });
console.log(JSON.stringify(st), "erros:", errors.length, errors.slice(0, 5), "falhas de rede:", failed);
await browser.close();
process.exit(r.status === 200 && errors.length === 0 && failed.length === 0 ? 0 : 1);
