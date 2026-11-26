// Malhas e triângulos por criatura (compactada): node tools/rigstats.mjs
import { startServer, launch, waitFor, openGame } from "../e2e/lib.mjs";
const srv = await startServer(4402);
const { browser, page } = await launch();
await openGame(page, srv.url, "?debug=1", "media");
console.log(JSON.stringify(await page.evaluate(() => window.__fh.rigStats())));
await browser.close(); srv.stop();
