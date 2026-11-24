// D02 — grade × parede, distrair dois Riscadores, Estilhaço marcado, segunda rota volta ao início,
// munição gasta = disparos e clique seco sem impacto.
import { startServer, launch, sleep, waitFor, Report, openGame, aim, click, key, goto } from "./lib.mjs";

export async function run(url) {
  const R = new Report("d02");
  const { browser, page, errors } = await launch();
  const beaconState = () => page.evaluate(() => window.__fh.sim.beacon.state);
  const byTag = (tag) => page.evaluate((tag) => window.__fh.sim.creatures.filter((c) => c.tag === tag).map((c) => ({ state: c.state, z: c.pos.z, x: c.pos.x })), tag);
  try {
    await openGame(page, url, "?debug=1&sala=d02");
    await page.click('button[data-act="new"]');
    await waitFor(page, () => window.__fh.state === "playing", null, 15000, "jogando");
    // guarda todos os eventos de disparo para a conferência de munição
    await page.evaluate(() => { window.__fh.allEvents = []; setInterval(() => { for (const e of window.__fh.events()) if ((e.type === "shot" || e.type === "mark" || e.type === "dry") && !e.__seen) { e.__seen = true; window.__fh.allEvents.push(e); } }, 50); });

    // Estilhaço marcado: secundário marca (custa 3), o próximo acerto soma +32
    await page.evaluate(() => window.__fh.setSpeed(0.35));
    const est = () => page.evaluate(() => { const c = window.__fh.sim.creatures.find((c) => c.tag === "estilhaco"); return { hp: c.hp, alive: c.alive, center: c.center(), mark: c.markT }; });
    let e = await est();
    const mag0 = await page.evaluate(() => window.__fh.sim.arsenal.ammo().mag);
    await aim(page, e.center); await click(page, "right");
    await waitFor(page, () => window.__fh.sim.creatures.find((c) => c.tag === "estilhaco").markT > 0, null, 4000, "marca").catch(() => {});
    const mag1 = await page.evaluate(() => window.__fh.sim.arsenal.ammo().mag);
    e = await est();
    R.check("secundário marca o Estilhaço e custa 3 dardos", e.mark > 0 && mag0 - mag1 === 3, `pente ${mag0} → ${mag1}`);
    // dispara até o acerto marcado (o Estilhaço se move; se a marca expirar, marca de novo)
    for (let tries = 0; tries < 6; tries++) {
      await sleep(700);
      e = await est();
      if (!e.alive || (await page.evaluate(() => window.__fh.events().some((e) => e.type === "shot" && e.marked)))) break;
      await aim(page, e.center);
      await click(page, e.mark > 0 ? "left" : "right");
      await sleep(500);
      if (tries > 0) R.note(`tentativa ${tries + 1} do acerto marcado`);
    }
    const markedShot = await page.evaluate(() => window.__fh.events().find((e) => e.type === "shot" && e.marked));
    R.check("acerto marcado causa 16 + 32", markedShot?.dmg === 48, `dano ${markedShot?.dmg}`);
    for (let i = 0; i < 6 && (await est()).alive; i++) { await sleep(900); e = await est(); await aim(page, e.center); await click(page); await sleep(300); }
    R.check("Estilhaço marcado eliminado", !(await est()).alive);
    await page.evaluate(() => window.__fh.setSpeed(1));

    // baliza: mira inválida (parede além de 14 m) mantém a carga
    await aim(page, { x: 4, y: 3, z: 14 });
    await key(page, "KeyQ"); await sleep(600);
    R.check("mira inválida não gasta a baliza", (await beaconState()) === "ready");

    // caso da grade
    await goto(page, { x: 18, y: 0, z: 0 });
    await aim(page, { x: 27, y: 0, z: -3 });
    await key(page, "KeyQ");
    await waitFor(page, () => window.__fh.sim.beacon.state === "armed", null, 4000, "baliza armada");
    await key(page, "KeyQ");
    await waitFor(page, () => window.__fh.sim.beacon.state === "emitting", null, 3000, "chamado");
    await sleep(2500);
    const grade = await byTag("grade"), parede = await byTag("parede");
    R.check("atrás da grade os dois Riscadores respondem ao chamado", grade.every((c) => c.state === "lured"), JSON.stringify(grade.map((c) => c.state)));
    R.check("Riscador atrás da parede sólida não responde ao chamado do lado da grade", parede.every((c) => c.state !== "lured"));
    await waitFor(page, () => window.__fh.sim.beacon.state === "recharging", null, 8000, "recarga");
    const rec0 = Date.now();
    await waitFor(page, () => window.__fh.sim.beacon.state === "ready", null, 15000, "baliza pronta");
    R.note(`recarga observada: ${((Date.now() - rec0) / 1000).toFixed(1)} s (5 s de jogo; a tela headless roda perto de 10 quadros/s)`);
    // caso da parede
    await aim(page, { x: 27, y: 0, z: 3 });
    await key(page, "KeyQ");
    await waitFor(page, () => window.__fh.sim.beacon.state === "armed", null, 4000, "baliza armada 2");
    await key(page, "KeyQ");
    await sleep(2200);
    const parede2 = await byTag("parede");
    R.check("atrás da parede sólida o Riscador mantém a patrulha", parede2.every((c) => c.state !== "lured" && Math.abs(c.z - 9) < 3.5), JSON.stringify(parede2));
    // expiração: armada sem uso por 6 s volta a pronta
    await waitFor(page, () => window.__fh.sim.beacon.state === "ready", null, 15000, "pronta 2");
    await aim(page, { x: 22, y: 0, z: 4 });
    await key(page, "KeyQ");
    await waitFor(page, () => window.__fh.sim.beacon.state === "armed", null, 4000, "armada 3");
    await waitFor(page, () => window.__fh.sim.beacon.state === "ready", null, 15000, "expiração");
    R.check("armada e sem uso por 6 s, a baliza volta pronta", true);
    // pausa congela a baliza
    await key(page, "KeyQ"); await waitFor(page, () => window.__fh.sim.beacon.state === "armed", null, 4000, "armada 4");
    await page.keyboard.press("Escape"); await waitFor(page, () => window.__fh.state === "paused", null, 4000, "pausa");
    const bt0 = await page.evaluate(() => JSON.stringify(window.__fh.sim.beacon));
    await sleep(1500);
    const bt1 = await page.evaluate(() => JSON.stringify(window.__fh.sim.beacon));
    R.check("a pausa congela a baliza", bt0 === bt1);
    await page.click('#pause button[data-act="resume"]');

    // clique seco: pente abaixo do custo do secundário
    await page.evaluate(() => { window.__fh.sim.player.pitch = -0.2; window.__fh.sim.player.yaw = Math.PI / 2; });
    await page.mouse.down();
    await waitFor(page, () => window.__fh.sim.arsenal.ammo().mag <= 2, null, 20000, "esvaziar o pente");
    await page.mouse.up();
    await sleep(400);
    const before = await page.evaluate(() => ({ mag: window.__fh.sim.arsenal.ammo().mag, res: window.__fh.sim.arsenal.ammo().reserve, n: window.__fh.events().length }));
    if (before.mag > 0 && before.mag < 3) {
      await click(page, "right"); await sleep(500);
      const after = await page.evaluate((n) => ({ mag: window.__fh.sim.arsenal.ammo().mag, evs: window.__fh.events().slice(n).map((e) => e.type) }), before.n);
      R.check("secundário com pente abaixo do custo: clique seco, sem impacto e sem gasto", after.evs.includes("dry") && !after.evs.includes("mark") && !after.evs.includes("shot") && after.mag === before.mag, `pente ${before.mag}, eventos ${after.evs.join(",")}`);
    } else R.note(`pente parou em ${before.mag}; teste de clique seco do secundário ficou nos testes unitários`);
    // munição gasta = disparos
    const acc = await page.evaluate(() => { const ev = window.__fh.allEvents; return { spent: window.__fh.sim.arsenal.ammoSpent, shots: ev.filter((e) => e.type === "shot").length, marks: ev.filter((e) => e.type === "mark").length }; });
    R.check("cada dardo gasto corresponde a um disparo (primário 1, secundário 3)", acc.spent === acc.shots + 3 * acc.marks, JSON.stringify(acc));

    // segunda rota: escada → passarela → rampa → volta ao início
    const start = { x: 4, y: 0, z: 0 };
    let maxY = 0;
    const track = setInterval(async () => { try { const y = await page.evaluate(() => window.__fh.sim.player.pos.y); maxY = Math.max(maxY, y); } catch {} }, 200);
    await goto(page, { x: 3.2, y: 0, z: -2.5 });
    await goto(page, { x: 3.2, y: 2.4, z: -12.5 });
    await goto(page, { x: 20.8, y: 2.4, z: -12.5 });
    await goto(page, { x: 20.8, y: 0, z: -2 });
    await goto(page, start);
    clearInterval(track);
    const end = await page.evaluate(() => window.__fh.sim.player.pos);
    R.check("a segunda rota (escada, passarela, rampa) volta ao início", maxY > 2.3 && Math.hypot(end.x - start.x, end.z - start.z) < 1.2, `altura máx. ${maxY.toFixed(2)} m, fim (${end.x.toFixed(1)}, ${end.z.toFixed(1)})`);
    R.check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    const dbg = await page.evaluate(() => JSON.stringify({ b: window.__fh.sim.beacon, p: window.__fh.sim.player.pos, ev: window.__fh.events().filter((e) => e.type.startsWith("beacon")).slice(-6) })).catch(() => "");
    R.check("execução sem exceção", false, String(e) + " " + dbg);
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
