// D00 — abrir pela página inicial, iniciar e pausar cinco vezes; Lia fica na sala; retomar não dispara.
import { startServer, launch, sleep, waitFor, Report, SHOTS } from "./lib.mjs";

export async function run(url) {
  const R = new Report("d00");
  const { browser, page, errors } = await launch();
  try {
    await page.goto(url + "?debug=1&sala=d00");
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    const gpu = await page.evaluate(() => { const c = document.createElement("canvas").getContext("webgl2"); const e = c?.getExtension("WEBGL_debug_renderer_info"); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : "desconhecido"; });
    R.note(`máquina de automação: Chromium headless ${browser.version()} • GPU: ${gpu}`);
    await page.click('button[data-act="new"]');
    await waitFor(page, () => window.__fh.state === "playing", null, 15000, "jogando");
    R.check("menu → sala de teste pelo botão Novo jogo", true);
    const bounds = { minX: 0, maxX: 32, minZ: -14, maxZ: 14 };
    let inside = true, fired = false, frozen = true, menuOk = true;
    const keys = ["KeyW", "KeyA", "KeyS", "KeyD"];
    for (let i = 0; i < 5; i++) {
      // anda e olha com teclado/mouse reais, correndo contra as paredes
      await page.mouse.move(640 + (i % 2 ? 80 : -80), 360);
      await page.keyboard.down("ShiftLeft");
      await page.keyboard.down(keys[i % 4]);
      await sleep(1600);
      await page.keyboard.up(keys[i % 4]);
      await page.keyboard.up("ShiftLeft");
      // pausa com Esc
      await page.keyboard.press("Escape");
      await waitFor(page, () => window.__fh.state === "paused" && !document.getElementById("pause").classList.contains("hidden"), null, 5000, "pausa");
      const t0 = await page.evaluate(() => window.__fh.sim.t);
      await sleep(700);
      const t1 = await page.evaluate(() => window.__fh.sim.t);
      if (t1 !== t0) frozen = false;
      // retoma clicando em "Retomar" (o clique não pode virar disparo)
      await page.click('#pause button[data-act="resume"]');
      await sleep(400);
      const st = await page.evaluate(() => ({ s: window.__fh.state, p: window.__fh.sim.player.pos, shots: window.__fh.sim.stats.shots, ev: window.__fh.events().filter((e) => e.type === "shot" || e.type === "dry").length }));
      if (st.s !== "playing") menuOk = false;
      if (st.shots || st.ev) fired = true;
      const p = st.p;
      if (p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ || p.y < -0.1) inside = false;
      R.note(`ciclo ${i + 1}: Lia em (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), estado ${st.s}`);
    }
    R.check("cinco ciclos Esc → Retomar voltam ao jogo", menuOk);
    R.check("simulação congelada durante a pausa", frozen);
    R.check("Lia permanece dentro da sala", inside);
    R.check("retomar não dispara", !fired);
    // volta ao menu pela pausa
    await page.keyboard.press("Escape");
    await waitFor(page, () => window.__fh.state === "paused", null, 5000, "pausa");
    await page.click('#pause button[data-act="menu"]');
    await waitFor(page, () => window.__fh.state === "menu", null, 5000, "menu");
    R.check("Menu principal pela pausa", true);

    // na sala D01 (com a Agulha) o clique de Retomar também não gasta dardo
    await page.goto(url + "?debug=1&sala=d01");
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu d01");
    await page.click('button[data-act="new"]');
    await waitFor(page, () => window.__fh.state === "playing", null, 15000, "jogando d01");
    let mags = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Escape");
      await waitFor(page, () => window.__fh.state === "paused", null, 5000, "pausa");
      await page.click('#pause button[data-act="resume"]');
      await sleep(300);
      mags.push(await page.evaluate(() => window.__fh.sim.arsenal.ammo().mag));
    }
    R.check("com a Agulha equipada, cinco retomadas não gastam dardos", mags.every((m) => m === 24), mags.join(","));
    R.check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) { R.check("execução sem exceção", false, String(e)); }
  await browser.close();
  return R.save();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await startServer();
  const ok = await run(srv.url);
  srv.stop();
  process.exit(ok ? 0 : 1);
}
