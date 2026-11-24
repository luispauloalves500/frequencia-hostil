// D01 — um Riscador cai com três dardos; errar permite receber dano, morrer e repetir sem duplicar o inimigo.
import { startServer, launch, sleep, waitFor, Report, openGame, aim, click } from "./lib.mjs";

const riscadorCenter = () => { const c = window.__fh.sim.creatures.find((c) => c.alive); return c ? c.center() : null; };

export async function run(url) {
  const R = new Report("d01");
  const { browser, page, errors } = await launch();
  try {
    await openGame(page, url, "?debug=1&sala=d01");
    await page.click('button[data-act="new"]');
    await waitFor(page, () => window.__fh.state === "playing", null, 15000, "jogando");
    // movimentos do D01: corrida, deslize, salto e agachar com teclas reais
    const p0 = await page.evaluate(() => ({ ...window.__fh.sim.player.pos }));
    await page.evaluate(() => { window.__fh.sim.player.yaw = Math.PI; }); // olha para +Z (lado vazio da sala)
    await page.keyboard.down("KeyW"); await page.keyboard.down("ShiftLeft"); await sleep(700);
    const sprinting = await page.evaluate(() => window.__fh.sim.player.sprinting);
    await page.keyboard.down("ControlLeft");
    const sliding = await waitFor(page, () => window.__fh.sim.player.sliding, null, 2000, "deslize").catch(() => false);
    const slideDist = await waitFor(page, () => !window.__fh.sim.player.sliding, null, 3000, "fim do deslize").then(() => page.evaluate(() => window.__fh.sim.player.lastSlideDist)).catch(() => -1);
    await page.keyboard.up("ControlLeft"); await page.keyboard.up("ShiftLeft"); await page.keyboard.up("KeyW");
    await sleep(800);
    await page.keyboard.press("Space");
    const jumped = await waitFor(page, () => window.__fh.sim.player.pos.y > 0.3, null, 2000, "salto").catch(() => false);
    R.check("corrida com Shift", sprinting);
    R.check("deslize com Ctrl durante a corrida (até 3,8 m)", sliding && slideDist > 2 && slideDist <= 3.8 + 1e-6, `${Number(slideDist).toFixed(2)} m`);
    R.check("salto com Espaço", jumped);
    void p0;

    // três dardos (câmera lenta só para a mira automática acompanhar o salto do Riscador)
    await page.evaluate(() => window.__fh.setSpeed(0.25));
    const hp = [];
    for (let i = 0; i < 3; i++) {
      const c = await page.evaluate(riscadorCenter);
      await aim(page, c);
      await click(page);
      await waitFor(page, (n) => window.__fh.sim.stats.shots > n, i, 4000, "disparo").catch(() => {});
      await sleep(1000); // respeita a cadência de 5 disparos/s mesmo em câmera lenta
      hp.push(await page.evaluate(() => { const c = window.__fh.sim.creatures[0]; return { hp: c.hp, alive: c.alive }; }));
    }
    await page.evaluate(() => window.__fh.setSpeed(1));
    const st = await page.evaluate(() => ({ ...window.__fh.sim.stats, mag: window.__fh.sim.arsenal.ammo().mag }));
    R.note(`vida após cada dardo: ${hp.map((h) => h.hp).join(" → ")}`);
    R.check("vivo após 1 e 2 dardos", hp[0].alive && hp[1].alive);
    R.check("Riscador cai com o terceiro dardo", !hp[2].alive && st.kills === 1, `disparos ${st.shots}, acertos ${st.hits}`);
    R.check("cada disparo gastou um dardo", st.mag === 24 - st.shots, `pente ${st.mag}`);

    // errar de propósito, apanhar, morrer e repetir
    await page.click("body"); // sem efeito: o clique já está capturado
    await page.keyboard.press("Escape");
    await waitFor(page, () => window.__fh.state === "paused", null, 5000, "pausa");
    await page.click('#pause button[data-act="menu"]');
    await waitFor(page, () => window.__fh.state === "menu", null, 5000, "menu");
    await page.click('button[data-act="new"]');
    await waitFor(page, () => window.__fh.state === "playing", null, 15000, "jogando 2");
    for (let round = 1; round <= 2; round++) {
      await page.evaluate(() => { const s = window.__fh.sim; s.player.yaw = Math.PI; s.player.pitch = 0.6; }); // mira no teto
      for (let i = 0; i < 3; i++) { await click(page); await sleep(250); }
      const miss = await page.evaluate(() => ({ hits: window.__fh.sim.stats.hits, shots: window.__fh.sim.stats.shots }));
      await page.evaluate(() => window.__fh.setSpeed(4));
      await waitFor(page, () => window.__fh.state === "dead", null, 120000, "morte");
      await page.evaluate(() => window.__fh.setSpeed(1));
      const d = await page.evaluate(() => ({ hurts: window.__fh.events().filter((e) => e.type === "hurt").length, focus: document.activeElement?.id, visible: !document.getElementById("death").classList.contains("hidden") }));
      R.check(`rodada ${round}: errou (${miss.shots} disparos, ${miss.hits} acertos), recebeu dano e morreu`, miss.hits === 0 && d.hurts > 0 && d.visible, `${d.hurts} golpes`);
      R.check(`rodada ${round}: "Tentar novamente" em foco`, d.focus === "btnRetry");
      await page.evaluate(() => window.__fh.clearEvents());
      await page.keyboard.press("Enter");
      await waitFor(page, () => window.__fh.state === "playing" || window.__fh.state === "paused", null, 15000, "reinício");
      if (await page.evaluate(() => window.__fh.state === "paused")) await page.click("#clickResume");
      const n = await page.evaluate(() => ({ all: window.__fh.sim.creatures.length, alive: window.__fh.sim.creatures.filter((c) => c.alive).length, hp: window.__fh.sim.hp, mag: window.__fh.sim.arsenal.ammo().mag }));
      R.check(`rodada ${round}: reinício com um único Riscador, vida e pente restaurados`, n.all === 1 && n.alive === 1 && n.hp === 100 && n.mag === 24, JSON.stringify(n));
    }
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
