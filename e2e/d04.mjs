// D04 — F1 → F2 com o inventário da F1; F2 por baixo (Fole contra a névoa do Véu), registro 1, abrigo F2-B,
// registro 2 com 8 s e quatro segmentos, saída com um comum vivo; reabrir em F2-B; F2 por cima com a Agulha.
import { startServer, launch, sleep, waitFor, Report, openGame, SHOTS } from "./lib.mjs";
import { mkdirSync } from "node:fs";

const DIR = SHOTS + "v0.4/";
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
  const R = new Report("d04");
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
    R.check("versão v0.4.0 • D04 no menu", ver.includes("0.4.0") && ver.includes("D04"), ver);

    // ---- 1. F1 (a partir do abrigo F1-B, com um inventário fora do padrão) → F2
    const f1cp = { phase: "F1", point: "F1-B", hp: 77, medkits: 2, weapons: { agulha: { mag: 19, reserve: 61 } }, current: "agulha", hasBeacon: true, objective: "", flags: { armario: true, persiana: true, trinco: true, abrigoB: true, tutorial: true }, difficulty: "normal", playTime: 312, deaths: 0, stats: { kills: 3, shots: 40, hits: 25, pulses: 1, damageTaken: 20 } };
    await page.evaluate((cp) => window.__fh.startWith("F1", "F1-B", cp), f1cp);
    await waitFor(page, () => window.__fh.state === "playing" || window.__fh.state === "paused", null, 30000, "F1-B");
    await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); });
    await snap(page, "01-f1-acabamento-praca.png", () => { const s = window.__fh.sim; s.player.pos.x = 61.5; s.player.pos.z = 4.5; s.player.yaw = -1.75; s.player.pitch = -0.12; });
    const f1 = await runWithShots(page, "finish", "terreo", 2, []);
    R.note("F1: " + f1.log.join(" | "));
    await waitFor(page, () => window.__fh.state === "result", null, 30000, "resultado F1");
    const end1 = await page.evaluate(() => ({ inv: window.__fh.sim.arsenal.snapshot(), hp: Math.ceil(window.__fh.sim.hp), kits: window.__fh.sim.medkits, saves: window.__saves().map((d) => d.checkpoint) }));
    const entry = end1.saves.find((c) => c.phase === "F2" && c.point === "F2-A");
    R.check("F1 concluída: entrada da F2 salva com o inventário da F1", !!entry && JSON.stringify(entry.weapons) === JSON.stringify(end1.inv), JSON.stringify({ inv: end1.inv, entry: entry?.weapons }));
    await page.click("#btnNext");
    await waitFor(page, () => window.__fh.state === "playing" && window.__fh.sim.level.id === "F2", null, 30000, "F2");
    const st2 = await page.evaluate(() => { const s = window.__fh.sim; return { inv: s.arsenal.snapshot(), cur: s.arsenal.current, beacon: s.beacon.owned, hp: Math.ceil(s.hp), kits: s.medkits, obj: s.objective, t: s.playTimeBase }; });
    R.check("F2 começa com o inventário da F1 (Agulha, pente/reserva, baliza, vida, curativos)", JSON.stringify(st2.inv) === JSON.stringify(end1.inv) && st2.cur === "agulha" && st2.beacon && st2.kits === end1.kits && st2.hp === entry.hp, JSON.stringify(st2));
    R.check("objetivo inicial da F2", st2.obj.includes("Fole"), st2.obj);

    // ---- 2. F2 por baixo com o Fole
    let snapF2B = null;
    const low = await runWithShots(page, "f2", "baixo", 2, [
      { file: "02-f2-peixaria.png", when: () => window.__fh.sim.player.pos.x > 9 && window.__fh.sim.player.pos.x < 12 },
      { file: "03-fole-pego.png", when: () => window.__fh.sim.flags.fole && window.__fh.sim.arsenal.current === "fole" && window.__fh.game.renderer.switchAnim <= 0 },
      { file: "04-veu-nevoa.png", when: () => { const s = window.__fh.sim; return s.clouds.length > 0 && s.clouds[0].age > 0.6 && s.clouds[0].clearT <= 0; } },
      { file: "05-sopro.png", when: () => window.__fh.game.renderer.soproAnim > 0.25 },
      { file: "06-praca-banca-azul-luta.png", when: () => { const s = window.__fh.sim; const ar = s.script.arena; return ar && ar.state !== "idle" && s.creatures.filter((c) => c.alive && c.state !== "emerging" && c.type !== "veu").length >= 2; }, before: () => { const s = window.__fh.sim; const c = s.creatures.find((c) => c.alive && c.state !== "emerging" && c.type !== "veu"); if (c) window.__fh.aimAt(c.center()); } },
      { when: () => window.__saves().some((d) => d.checkpoint.point === "F2-B"), then: async () => { snapF2B = await saveSnapshot(page); } },
      { file: "07-casa-da-boia.png", when: () => window.__fh.sim.player.pos.x > 82 && window.__fh.sim.player.pos.y > 2 },
      { file: "08-comporta-abrindo.png", when: () => (window.__fh.sim.script.segmentsLit ?? 0) >= 2, before: () => window.__fh.aimAt({ x: 103.7, y: 5.6, z: 4 }) },
    ]);
    R.note("F2 (baixo): " + low.log.join(" | "));
    R.check("roteiro F2 por baixo concluído", !low.error && (low.ok || (await page.evaluate(() => window.__fh.state)) === "result"), low.error);
    R.check("Fole pego na bancada sob a placa de gelo", low.data.foleMag === 8, String(low.data.foleMag));
    R.check("névoa do Véu cobre a passagem e o sopro a afasta", low.data.densityBefore > 0.3 && low.data.densityAfterSopro === 0, `${low.data.densityBefore} → ${low.data.densityAfterSopro}`);
    R.check("rota baixa com o Fole (Véu derrubado com o Fole)", low.data.lowRoute === true && low.data.veuKilledBy === "fole", `${low.data.lowRoute} ${low.data.veuKilledBy}`);
    R.check("registro 2: objetivo vira “Atravesse a comporta” durante a abertura", low.data.objectiveDuringGate === "Atravesse a comporta", low.data.objectiveDuringGate);
    R.check("abertura de 8 s com a luz em quatro segmentos", low.data.gateSecs >= 7.9 && low.data.gateSecs <= 8.3 && low.data.segments === 4, `${low.data.gateSecs} s, ${low.data.segments} segmentos`);
    await waitFor(page, () => window.__fh.state === "result", null, 30000, "resultado F2");
    const res = await page.evaluate(() => ({ r: window.__fhResult, table: document.getElementById("resTable").innerText, title: document.getElementById("resTitle").textContent, next: document.getElementById("btnNext").disabled }));
    R.check("cruzou a saída com um comum ainda vivo", res.r.level === "F2" && res.r.alive >= 1, `vivos: ${res.r.alive}`);
    R.check("resultado da F2 (rota, vivos na saída, Fole, sopros)", res.title.includes("Mercado Afogado") && res.table.includes("Por baixo") && res.table.includes("Sopros") && res.next, res.table.replace(/\n/g, " • "));
    await sleep(600);
    await page.screenshot({ path: DIR + "09-resultado-f2.png" });

    // ---- 3. reabrir em F2-B
    R.check("abrigo F2-B foi salvo durante a corrida", !!snapF2B);
    await page.close();
    page = await ctx.newPage(); hook(page);
    await page.goto(url + "?debug=1");
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    await restoreSnapshot(page, snapF2B);
    await page.reload();
    await waitFor(page, () => window.__fh?.state === "menu", null, 30000, "menu");
    const info = await page.evaluate(() => document.getElementById("continueInfo").textContent);
    R.check("menu oferece Continuar na F2-B", info.includes("F2") && info.includes("F2-B"), info);
    await page.click("#btnContinue");
    await waitFor(page, () => window.__fh.state === "playing" || window.__fh.state === "paused", null, 30000, "F2-B");
    await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); });
    const rb = await page.evaluate(() => { const s = window.__fh.sim, r = window.__fh.game.renderer; const led = r.decorById.get("registro1")?.userData.led.material.color.getHex(); return { point: s.point, pos: s.player.pos, reg1: !!s.flags.registro1, corredor: s.world.get("porta-corredor")?.enabled, led, fole: s.arsenal.ammo("fole") }; });
    R.check("F2-B reabre com o primeiro registro aberto (porta do corredor liberada, LED verde)", rb.point === "F2-B" && rb.reg1 && rb.corredor === false && rb.led === 0x40ff70, JSON.stringify(rb));
    await snap(page, "10-f2b-reaberto.png");

    // ---- 4. F2 por cima com a Agulha (nova corrida a partir da entrada)
    await page.evaluate(() => window.__fh.start("F2"));
    await waitFor(page, () => (window.__fh.state === "playing" || window.__fh.state === "paused") && window.__fh.sim.point === "F2-A" && window.__fh.sim.t < 2, null, 30000, "F2-A");
    await page.evaluate(() => { const g = window.__fh.game; g.state = "playing"; g.show(null); });
    const high = await runWithShots(page, "f2", "cima", 2, [
      { file: "11-rota-alta-toldo.png", when: () => window.__fh.sim.player.pos.y > 2 && window.__fh.sim.player.pos.x > 24 && window.__fh.sim.player.pos.x < 30 },
      { file: "12-agulha-cristal.png", when: () => { const s = window.__fh.sim; return s.arsenal.current === "agulha" && s.creatures.some((c) => c.alive && c.type !== "veu" && c.state !== "emerging" && Math.hypot(c.pos.x - s.player.pos.x, c.pos.z - s.player.pos.z) < 9); }, before: () => { const s = window.__fh.sim; const c = s.creatures.find((c) => c.alive && c.type !== "veu" && c.state !== "emerging"); if (c) window.__fh.aimAt(c.center()); } },
    ]);
    R.note("F2 (cima): " + high.log.join(" | "));
    R.check("rota alta com a Agulha (escada, passarela, toldo)", !high.error && high.data.routeHigh === true, high.error || "");
    await waitFor(page, () => window.__fh.state === "result", null, 30000, "resultado F2 (cima)");
    const res2 = await page.evaluate(() => window.__fhResult);
    R.check("F2 concluída por cima com comum vivo na saída", res2.route === "toldo" && res2.alive >= 1, JSON.stringify({ route: res2.route, alive: res2.alive }));
    R.check("sem erros no console", allErrors.length === 0, allErrors.slice(0, 3).join(" | "));
  } catch (e) {
    R.check("execução sem exceção", false, String(e));
    try { await page.screenshot({ path: DIR + "zz-falha-d04.png" }); R.note(JSON.stringify(await page.evaluate(() => ({ s: window.__fh.state, plan: window.__fh.plan, p: window.__fh.sim?.player.pos })))); } catch {}
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
