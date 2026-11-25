// Fotos rápidas de pontos fixos (verificação visual): node e2e/look.mjs <saida> <fase> x,y,z,yaw,pitch[,ponto] ...
import { startServer, launch, sleep, waitFor, openGame } from "./lib.mjs";
const [out, level, ...poses] = process.argv.slice(2);
const srv = await startServer(4393);
const { browser, page, errors } = await launch();
try {
  await openGame(page, srv.url, "?debug=1", process.env.Q ?? "media");
  const point = poses[0]?.split(",")[5];
  await page.evaluate(({ level, point }) => window.__fh.start(level, point), { level, point });
  await waitFor(page, () => window.__fh.state === "playing" || window.__fh.state === "paused", null, 30000, "fase");
  await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); document.getElementById("diag").style.visibility = "hidden"; });
  if (process.env.SETUP) await page.evaluate(process.env.SETUP);
  for (let i = 0; i < poses.length; i++) {
    const [x, y, z, yaw, pitch] = poses[i].split(",").map(Number);
    await page.evaluate(({ x, y, z, yaw, pitch }) => { const s = window.__fh.sim; s.player.pos.x = x; s.player.pos.y = y; s.player.pos.z = z; s.player.vel.x = s.player.vel.z = 0; s.player.yaw = yaw; s.player.pitch = pitch; }, { x, y, z, yaw, pitch });
    if (process.env.EACH) await page.evaluate(process.env.EACH);
    await sleep(Number(process.env.WAIT ?? 1500));
    await page.screenshot({ path: `${out}-${i}.png` });
  }
  console.log("erros:", errors.length ? errors.slice(0, 5).join(" | ") : 0);
} finally { await browser.close(); srv.stop(); }
