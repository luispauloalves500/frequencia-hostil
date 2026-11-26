// Roda os testes de aceite D00 → D05 em ordem contra o build de produção (vite preview).
import { startServer } from "./lib.mjs";
const srv = await startServer();
const results = {};
for (const m of ["d00", "d01", "d02", "d03", "d04", "d05"]) {
  console.log(`\n=== ${m.toUpperCase()} ===`);
  const mod = await import(`./${m}.mjs`);
  results[m] = await mod.run(srv.url);
}
srv.stop();
console.log("\nResumo:", Object.entries(results).map(([k, v]) => `${k.toUpperCase()} ${v ? "OK" : "FALHOU"}`).join(" • "));
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
