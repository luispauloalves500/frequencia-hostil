// D05 — F2 → F3 com o inventário da F2 (botão do resultado); F3 completa: Tear na faixa dos filtros,
// Carapaça no batente, passarela/curva em U (pico), bomba 2, abrigo F3-B, Badalo pelos dois métodos
// (posição e baliza), saída; reabrir em F3-B; resultado com estatísticas do Tear e do chefe.
import { startServer, launch, sleep, waitFor, Report, openGame, SHOTS } from "./lib.mjs";
import { mkdirSync } from "node:fs";

const DIR = SHOTS + "v0.5/d05/";
mkdirSync(DIR, { recursive: true });

async function snap(page, name, before) {
  const sp = await page.evaluate(() => window.__fh.game.timeScale);
  await page.evaluate(() => { window.__fh.setSpeed(0); document.getElementById("diag").style.visibility = "hidden"; });
  if (before) await page.evaluate(before);
  await sleep(1100);
  await page.screenshot({ path: DIR + name });
  await page.evaluate(() => { document.getElementById("diag").style.visibility = ""; });
  await page.evaluate((s) => window.__fh.setSpeed(s), sp);
}

async function runWithShots(page, name, arg, speed, shots, timeout = 900000) {
  await page.evaluate(({ name, arg, speed }) => { window.__fh.setSpeed(speed); window.__fh.runPlan(name, arg); }, { name, arg, speed });
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => ({ s: window.__fh.state, plan: window.__fh.plan }));
    if (st.plan?.done || st.s === "result" || st.s === "dead") break;
    if (Date.now() - t0 > timeout) throw new Error(`roteiro ${name} não terminou`);
    for (const sh of shots) {
      if (sh.done) continue;
      if (await page.evaluate(sh.when)) { if (sh.file) await snap(page, sh.file, sh.before); if (sh.then) await sh.then(); sh.done = true; }
    }
    await sleep(100);
  }
  await page.evaluate(() => window.__fh.setSpeed(1));
  return page.evaluate(() => window.__fh.plan);
}

const saveSnapshot = (page) => page.evaluate(() => ({ a: localStorage.getItem("fh.save.0"), b: localStorage.getItem("fh.save.1") }));
const restoreSnapshot = (page, s) => page.evaluate((s) => { for (const [k, v] of [["fh.save.0", s.a], ["fh.save.1", s.b]]) v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }, s);

export async function run(url) {
  const R = new Report("d05");
  const { browser, ctx, errors } = await launch();
  let page = await ctx.newPage();
  const allErrors = errors;
  const hook = (p) => {
    p.addInitScript(() => { window.__saves = () => ["fh.save.0", "fh.save.1"].map((k) => localStorage.getItem(k)).filter(Boolean).map((x) => JSON.parse(JSON.parse(x).body)); });
    p.on("console", (m) => { if (m.type() === "error") allErrors.push(m.text()); }); p.on("pageerror", (e) => allErrors.push(String(e)));
  };
  hook(page);
  try {
    await openGame(page, url, "?debug=1", "media");
    await page.evaluate(() => { localStorage.removeItem("fh.save.0"); localStorage.removeItem("fh.save.1"); });
    await page.reload();
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    const ver = await page.evaluate(() => document.getElementById("buildTag").textContent);
    R.check("versão v0.6.0 • D06 no menu", ver.includes("0.6.0") && ver.includes("D06"), ver);

    // ---- 1. F2 a partir do abrigo F2-B (inventário fora do padrão) → resultado → F3
    const f2cp = { phase: "F2", point: "F2-B", hp: 71, medkits: 2, weapons: { agulha: { mag: 20, reserve: 90 }, fole: { mag: 6, reserve: 14 } }, current: "fole", hasBeacon: true, objective: "", flags: { fole: true, registro1: true }, difficulty: "normal", playTime: 1250, deaths: 1, stats: { kills: 25, shots: 160, hits: 100, pulses: 3, damageTaken: 80, sopros: 2, foleShots: 8, foleHits: 20 } };
    await page.evaluate((cp) => window.__fh.startWith("F2", "F2-B", cp), f2cp);
    await waitFor(page, () => window.__fh.state === "playing" || window.__fh.state === "paused", null, 30000, "F2-B");
    await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); });
    const f2 = await runWithShots(page, "f2Boia", "", 2, []);
    R.note("F2-B: " + f2.log.join(" | "));
    await waitFor(page, () => window.__fh.state === "result", null, 60000, "resultado F2");
    const end2 = await page.evaluate(() => ({ inv: window.__fh.sim.arsenal.snapshot(), kits: window.__fh.sim.medkits, btn: document.getElementById("btnNext").textContent, dis: document.getElementById("btnNext").disabled, saves: window.__saves().map((d) => d.checkpoint), unlocked: window.__saves().map((d) => d.unlocked) }));
    const entry = end2.saves.find((c) => c.phase === "F3" && c.point === "F3-A");
    R.check("resultado da F2 libera “Seguir para a casa das bombas”", !end2.dis && /bombas/i.test(end2.btn), end2.btn);
    R.check("entrada da F3 salva com o inventário da F2 (Fole incluído) e F3 desbloqueada", !!entry && JSON.stringify(entry.weapons) === JSON.stringify(end2.inv) && end2.unlocked.some((u) => u.includes("F3")), JSON.stringify({ inv: end2.inv, entry: entry?.weapons }));
    await page.click("#btnNext");
    await waitFor(page, () => window.__fh.state === "playing" && window.__fh.sim.level.id === "F3", null, 30000, "F3");
    const st3 = await page.evaluate(() => { const s = window.__fh.sim; return { inv: s.arsenal.snapshot(), beacon: s.beacon.owned, kits: s.medkits, obj: s.objective, tear: s.arsenal.owned.has("tear") }; });
    R.check("F3 começa com o inventário da F2 (Agulha, Fole, baliza, curativos; sem Tear)", JSON.stringify(st3.inv) === JSON.stringify(end2.inv) && st3.beacon && st3.kits === end2.kits && !st3.tear, JSON.stringify(st3));
    R.check("objetivo inicial da F3 (Tear)", /Tear/.test(st3.obj), st3.obj);
    await snap(page, "01-f3-galeria-filtros.png", () => { const s = window.__fh.sim; s.player.yaw = -1.5708; s.player.pitch = -0.05; });

    // ---- 2. F3 completa pela passarela, Badalo alternando os métodos
    let snapF3B = null;
    const full = await runWithShots(page, "f3", "passarela/alterna", 2, [
      { file: "02-tear-bancada.png", when: () => window.__fh.sim.flags.tear && window.__fh.sim.arsenal.current === "tear" && window.__fh.game.renderer.switchAnim <= 0 },
      { file: "03-linha-do-tear.png", when: () => window.__fh.sim.tearLines.length > 0 },
      { file: "04-carapaca-batente.png", when: () => window.__fh.sim.creatures.some((c) => c.type === "carapaca" && c.alive && (c.state === "open" || c.state === "charge")), before: () => { const s = window.__fh.sim; const c = s.creatures.find((c) => c.type === "carapaca"); if (c) window.__fh.aimAt(c.center()); } },
      { file: "05-bomba-1-jato.png", when: () => window.__fh.sim.flags.bomba1 && window.__fh.game.renderer.jetT > 0.8 },
      { file: "06-galeria-curva-pico.png", when: () => window.__fh.sim.flags.pico && window.__fh.sim.creatures.some((c) => c.alive && c.state !== "emerging" && c.type !== "badalo"), before: () => { const s = window.__fh.sim; const c = s.creatures.find((c) => c.alive && c.state !== "emerging" && c.type !== "badalo"); if (c) window.__fh.aimAt(c.center()); } },
      { when: () => window.__saves().some((d) => d.checkpoint.point === "F3-B"), then: async () => { snapF3B = await saveSnapshot(page); } },
      { file: "07-badalo-entrada.png", when: () => window.__fh.sim.script.bossStarted && window.__fh.sim.script.boss.state === "intro" && window.__fh.sim.script.boss.stateT > 0.5, before: () => window.__fh.aimAt({ x: 100, y: 3, z: -6 }) },
      { file: "08-badalo-cravado.png", when: () => { const b = window.__fh.sim.script.boss; return b && b.alive && b.state === "stuck" && b.stateT > 0.4; }, before: () => { const b = window.__fh.sim.script.boss; window.__fh.aimAt({ x: b.pos.x, y: 1, z: b.pos.z }); } },
      { file: "09-badalo-onda.png", when: () => { const b = window.__fh.sim.script.boss; return b && b.alive && b.state === "wave" && b.waveR > 3; }, before: () => { const b = window.__fh.sim.script.boss; window.__fh.aimAt({ x: b.pos.x, y: 0.5, z: b.pos.z }); } },
      { file: "10-tunel-saida.png", when: () => window.__fh.sim.player.pos.x > 118 },
    ], 1200000);
    R.note("F3: " + full.log.join(" | "));
    R.check("roteiro F3 concluído", !full.error && (full.ok || (await page.evaluate(() => window.__fh.state)) === "result"), full.error);
    R.check("Tear: linha na faixa dos filtros pegou um Riscador", full.data.linePlaced === true && full.data.lineHits >= 1, `${full.data.linePlaced} ${full.data.lineHits}`);
    R.check("Carapaça trombou no batente (placas abertas) e caiu", full.data.carapacaOpens >= 1 && full.data.carapacaKilled === true, String(full.data.carapacaOpens));
    R.check("passarela até a curva em U (pico)", full.data.pico === true);
    R.check("Badalo: queda na placa pela posição e pela baliza; uma transição", full.data.stuck?.lia >= 1 && full.data.stuck?.baliza >= 1 && full.data.transitions === 1, JSON.stringify(full.data.stuck) + " t" + full.data.transitions);
    await waitFor(page, () => window.__fh.state === "result", null, 60000, "resultado F3");
    const res = await page.evaluate(() => ({ r: window.__fhResult, table: document.getElementById("resTable").innerText, title: document.getElementById("resTitle").textContent, next: document.getElementById("btnNext").disabled }));
    R.check("resultado da F3 (rota, Badalo, Tear) e F4 em breve", res.title.includes("Casa das Bombas") && res.table.includes("Badalo") && res.table.includes("Tear") && res.next, res.table.replace(/\n/g, " • "));
    await sleep(600);
    await page.screenshot({ path: DIR + "11-resultado-f3.png" });

    // ---- 3. reabrir em F3-B
    R.check("abrigo F3-B foi salvo durante a corrida", !!snapF3B);
    await page.close();
    page = await ctx.newPage(); hook(page);
    await page.goto(url + "?debug=1");
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    await restoreSnapshot(page, snapF3B);
    await page.reload();
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    const info = await page.evaluate(() => document.getElementById("continueInfo").textContent);
    R.check("menu oferece Continuar na F3-B", info.includes("F3") && info.includes("F3-B"), info);
    await page.click("#btnContinue");
    await waitFor(page, () => window.__fh.state === "playing" || window.__fh.state === "paused", null, 30000, "F3-B");
    await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); });
    const rb = await page.evaluate(() => { const s = window.__fh.sim; const b = s.script.boss; return { point: s.point, tear: !!s.arsenal.ammo("tear"), b2: !!s.flags.bomba2, door: s.world.get("porta-abrigo")?.enabled, bossHp: b?.hp, bossMax: b?.maxHp }; });
    R.check("F3-B reabre com Tear, bomba 2 ligada, abrigo aberto e chefe inteiro", rb.point === "F3-B" && rb.tear && rb.b2 && rb.door === false && rb.bossHp === rb.bossMax, JSON.stringify(rb));
    await snap(page, "12-f3b-reaberto.png");
    // seleção de fase mostra F3
    await page.evaluate(() => window.__fh.game.toMenu());
    await page.evaluate(() => { window.__fh.game.buildSelect(); });
    const sel = await page.evaluate(() => [...document.querySelectorAll("#selectList button")].map((b) => `${b.textContent}|${b.disabled}`));
    R.check("seleção de fase: F3 liberada para repetição", sel.some((x) => x.startsWith("F3") && x.endsWith("false")), sel.join(" ; "));
    R.check("sem erros no console", allErrors.length === 0, allErrors.slice(0, 3).join(" | "));
  } catch (e) {
    R.check("execução sem exceção", false, String(e));
    try { await page.screenshot({ path: DIR + "zz-falha-d05.png" }); R.note(JSON.stringify(await page.evaluate(() => ({ s: window.__fh.state, plan: window.__fh.plan, p: window.__fh.sim?.player.pos })))); } catch {}
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
