// D03 — do menu à catraca, morrer na onda 2, fechar e reabrir em F1-B e concluir pelos dois caminhos; resultado de F1.
import { startServer, launch, sleep, waitFor, Report, openGame, SHOTS } from "./lib.mjs";

async function snap(page, name) {
  const sp = await page.evaluate(() => window.__fh.game.timeScale);
  await page.evaluate(() => { window.__fh.setSpeed(0); document.getElementById("diag").style.visibility = "hidden"; }); // congela a simulação; a cena continua desenhando
  await sleep(900);
  await page.screenshot({ path: SHOTS + name });
  await page.evaluate(() => { document.getElementById("diag").style.visibility = ""; });
  await page.evaluate((s) => window.__fh.setSpeed(s), sp);
}

/** Roda um roteiro e tira fotos quando as condições aparecem. */
async function runWithShots(page, name, arg, speed, shots, timeout = 900000) {
  await page.evaluate(({ name, arg, speed }) => { window.__fh.setSpeed(speed); window.__fh.runPlan(name, arg); }, { name, arg, speed });
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => ({ s: window.__fh.state, plan: window.__fh.plan }));
    if (st.plan?.done || st.s === "result") break;
    if (Date.now() - t0 > timeout) throw new Error(`roteiro ${name} não terminou`);
    for (const sh of shots) {
      if (sh.done) continue;
      if (await page.evaluate(sh.when)) { if (sh.before) await page.evaluate(sh.before); await snap(page, sh.file); sh.done = true; }
    }
    await sleep(120);
  }
  await page.evaluate(() => window.__fh.setSpeed(1));
  return page.evaluate(() => window.__fh.plan);
}

const saveSnapshot = (page) => page.evaluate(() => ({ a: localStorage.getItem("fh.save.0"), b: localStorage.getItem("fh.save.1") }));
const restoreSnapshot = (page, s) => page.evaluate((s) => { for (const [k, v] of [["fh.save.0", s.a], ["fh.save.1", s.b]]) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }, s);

async function continueAndCheck(R, page, label) {
  const info = await page.evaluate(() => ({ enabled: !document.getElementById("btnContinue").disabled, text: document.getElementById("continueInfo").textContent }));
  R.check(`${label}: menu oferece Continuar em F1-B`, info.enabled && info.text.includes("F1-B"), info.text);
  await page.click("#btnContinue");
  await waitFor(page, () => window.__fh.state === "playing", null, 20000, "retomar em F1-B");
  const st = await page.evaluate(() => {
    const s = window.__fh.sim, sc = s.script;
    return { pos: s.player.pos, hp: s.hp, reserve: s.arsenal.ammo("agulha")?.reserve, mag: s.arsenal.ammo("agulha")?.mag, beacon: s.beacon.state, arena: sc.arena.state, spawns: sc.arena.spawnLog.length, divider: s.world.get("divisoria").enabled, creatures: s.creatures.filter((c) => c.alive).length, obj: s.objective };
  });
  R.check(`${label}: volta no abrigo F1-B com divisória fechada`, Math.hypot(st.pos.x - 58.4, st.pos.z - 5) < 1 && st.divider, JSON.stringify(st.pos));
  R.check(`${label}: ondas rearmadas (arena parada, nenhum inimigo vivo)`, st.arena === "idle" && st.spawns === 0 && st.creatures === 0);
  R.check(`${label}: piso do abrigo (vida ≥ 60, reserva ≥ 24, baliza pronta)`, st.hp >= 60 && st.reserve >= 24 && st.beacon === "ready", `vida ${st.hp}, ${st.mag}/${st.reserve}`);
  return st;
}

export async function run(url) {
  const R = new Report("d03");
  const { browser, ctx, errors } = await launch();
  let page = await ctx.newPage();
  const allErrors = errors;
  const hook = (p) => {
    p.addInitScript(() => { window.__saves = () => ["fh.save.0", "fh.save.1"].map((k) => localStorage.getItem(k)).filter(Boolean).map((x) => JSON.parse(JSON.parse(x).body)); }); p.on("console", (m) => { if (m.type() === "error") allErrors.push(m.text()); }); p.on("pageerror", (e) => allErrors.push(String(e))); };
  hook(page);
  try {
    await openGame(page, url, "?debug=1", "media");
    await page.evaluate(() => { localStorage.removeItem("fh.save.0"); localStorage.removeItem("fh.save.1"); });
    await page.reload();
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    await sleep(2500);
    await page.screenshot({ path: SHOTS + "01-menu.png" });
    R.check("menu inicial sem save: Continuar desabilitado", await page.evaluate(() => document.getElementById("btnContinue").disabled));

    // Novo jogo → Normal
    await page.click('button[data-act="new"]');
    await page.click('button[data-diff="normal"]');
    await waitFor(page, () => window.__fh.state === "playing", null, 30000, "F1-A");
    const loadMs = await page.evaluate(() => window.__fhLastLoadMs);
    R.note(`carregamento de F1: ${Math.round(loadMs)} ms (headless, SwiftShader)`);
    await waitFor(page, () => !document.getElementById("toast").classList.contains("hidden") || document.getElementById("toast").textContent.includes("salvo"), null, 5000, "toast").catch(() => {});
    const save0 = await page.evaluate(() => window.__saves().map((d) => d.checkpoint.point));
    R.check("entrada do capítulo salva em F1-A", save0.includes("F1-A"), JSON.stringify(save0));

    // tutorial até o abrigo F1-B, com fotos
    const tut = await runWithShots(page, "tutorial", undefined, 2, [
      { file: "02-f1-bilheteria.png", when: () => window.__fh.sim.player.pos.x > 25.5 && window.__fh.sim.player.pos.x < 29, before: () => { window.__fh.aimAt({ x: 34, y: 1.4, z: 3.5 }); } },
      { file: "03-baliza-chamado.png", when: () => window.__fh.sim.beacon.state === "emitting" && window.__fh.sim.beacon.timer < 1.9 },
    ]);
    R.note("roteiro tutorial: " + tut.log.join(" | "));
    R.check("vestiário → armário → corredor agachado → bilheteria (baliza no giz abre o trinco) → guichê → F1-B", tut.ok && tut.done && !tut.error, tut.error);
    R.check("passou sob a persiana agachado", tut.data.crouchedUnderShutter === true);
    R.check("Riscadores da demonstração atraídos pelo chamado", tut.data.demoLured >= 1, String(tut.data.demoLured));
    const saveB = await page.evaluate(() => window.__saves().some((d) => d.checkpoint.point === "F1-B"));
    R.check("abrigo F1-B salvo", saveB);

    // praça: morrer na onda 2
    const die = await runWithShots(page, "dieWave2", undefined, 1.5, [
      { file: "04-praca-catraca-luta.png", when: () => { const s = window.__fh.sim; const h = s.creatures.filter((c) => c.alive && c.state !== "emerging"); const ar = s.script.arena; return ar && ar.state !== "idle" && h.length >= 2 && s.player.pos.x > 64; }, before: () => { const s = window.__fh.sim; const c = s.creatures.find((c) => c.alive && c.state !== "emerging"); if (c) window.__fh.aimAt(c.center()); } },
    ]);
    R.note("roteiro morte: " + die.log.join(" | "));
    await waitFor(page, () => window.__fh.state === "dead", null, 20000, "tela de morte");
    const death = await page.evaluate(() => ({ wave2: window.__fh.sim.script.arena.wave2Started, focus: document.activeElement?.id, info: document.getElementById("deathInfo").textContent }));
    R.check("Lia morre depois do aviso da onda 2", death.wave2, death.info);
    R.check("tela de morte com “Tentar novamente” em foco", death.focus === "btnRetry");
    const snapB = await saveSnapshot(page);

    // fecha a aba e reabre
    await page.close();
    page = await ctx.newPage(); hook(page);
    await page.goto(url + "?debug=1");
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu reaberto");
    await continueAndCheck(R, page, "reabrir (térreo)");

    // conclui pelo térreo
    const t1 = await runWithShots(page, "finish", "terreo", 1.5, []);
    R.note("roteiro térreo: " + t1.log.join(" | "));
    await waitFor(page, () => window.__fh.state === "result", null, 30000, "resultado");
    const res1 = await page.evaluate(() => ({ r: window.__fhResult, table: document.getElementById("resTable").innerText, focus: document.activeElement?.textContent }));
    R.check("concluiu pelo térreo e exibiu o resultado de F1", res1.r.route === "térreo" && res1.table.includes("térreo") && res1.r.deathsTotal >= 1, res1.table.replace(/\n/g, " • "));
    await sleep(600);
    await page.screenshot({ path: SHOTS + "05-resultado-f1.png" });
    const after = await page.evaluate(() => { const d = window.__saves(); return { f2: d.some((x) => x.checkpoint.phase === "F2" && x.checkpoint.point === "F2-A"), unlocked: d.some((x) => x.unlocked.includes("F2") && x.completed.includes("F1")) }; });
    R.check("fim de capítulo salvo (entrada da F2 gravada, F2 desbloqueada)", after.f2 && after.unlocked);
    await page.click('#result button[data-act="next"]');
    await waitFor(page, () => window.__fh.state === "playing" && window.__fh.sim.level.id === "F2", null, 30000, "F2");
    R.check("“Seguir para o mercado” abre a F2 • Mercado Afogado", true);

    // segunda volta: restaura o registro de F1-B e conclui pela passarela
    await page.close();
    page = await ctx.newPage(); hook(page);
    await page.goto(url + "?debug=1");
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    await restoreSnapshot(page, snapB);
    await page.reload();
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    await continueAndCheck(R, page, "reabrir (passarela)");
    const t2 = await runWithShots(page, "finish", "passarela", 1.5, []);
    R.note("roteiro passarela: " + t2.log.join(" | "));
    await waitFor(page, () => window.__fh.state === "result", null, 30000, "resultado 2");
    const res2 = await page.evaluate(() => ({ r: window.__fhResult, table: document.getElementById("resTable").innerText, darts: window.__fh.sim.pickups.find((p) => p.id === "dardos-passarela").taken }));
    R.check("concluiu pela passarela (escada, dardos, rampa) e exibiu o resultado", res2.r.route === "passarela" && res2.darts, res2.table.replace(/\n/g, " • "));
    await page.screenshot({ path: SHOTS + "06-resultado-f1-passarela.png" });
    R.check("sem erros no console", allErrors.length === 0, allErrors.slice(0, 3).join(" | "));
  } catch (e) {
    R.check("execução sem exceção", false, String(e));
    try { await page.screenshot({ path: SHOTS + "zz-falha-d03.png" }); R.note(JSON.stringify(await page.evaluate(() => ({ s: window.__fh.state, plan: window.__fh.plan, p: window.__fh.sim?.player.pos })))); } catch {}
  }
  await browser.close();
  return R.save();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await startServer();
  const ok = await run(srv.url);
  srv.stop();
  process.exit(ok ? 0 : 1);
}
