// Decoração apoiada: nenhuma peça solta no ar em F1, F2 e F3 (cada uma encosta em piso, parede, teto ou suporte).
import { startServer, launch, waitFor, Report, openGame } from "./lib.mjs";

export async function run(url) {
  const R = new Report("props");
  const { browser, page, errors } = await launch();
  try {
    await openGame(page, url, "?debug=1", "media");
    for (const lv of ["F1", "F2", "F3"]) {
      await page.evaluate((lv) => window.__fh.start(lv), lv);
      await waitFor(page, (lv) => (window.__fh.state === "playing" || window.__fh.state === "paused") && window.__fh.sim?.level.id === lv, lv, 30000, lv);
      const r = await page.evaluate(() => ({ total: window.__fh.game.renderer.propReport.length, floating: window.__fh.floatingProps(), fixed: window.__fh.game.renderer.propReport.filter((p) => p.support.includes("(")) }));
      R.note(`${lv}: apoio acrescentado em ${r.fixed.length} peças — ` + r.fixed.map((p) => `${p.kind}${p.id ? "#" + p.id : ""}@${p.pos.x},${p.pos.y},${p.pos.z} → ${p.support}`).join(" ; "));
      R.check(`${lv}: ${r.total} peças de decoração, nenhuma solta no ar`, r.total > 0 && r.floating.length === 0, r.floating.map((p) => `${p.kind}${p.id ? "#" + p.id : ""} @${p.pos.x},${p.pos.y},${p.pos.z} [${p.min.join(",")}]→[${p.max.join(",")}]`).join(" ; "));
    }
    R.check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) { R.check("execução sem exceção", false, String(e)); }
  await browser.close();
  return R.save();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await startServer(4395);
  const ok = await run(srv.url);
  srv.stop();
  process.exit(ok ? 0 : 1);
}
