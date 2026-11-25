// Tabela antes/depois a partir de release/perf/*.json — uso: node tools/perf-table.mjs [antes] [depois]
import { readFileSync } from "node:fs";
const [a = "antes", d = "depois"] = process.argv.slice(2);
const A = JSON.parse(readFileSync(`release/perf/${a}.json`)), D = JSON.parse(readFileSync(`release/perf/${d}.json`));
const cols = [["drawCalls", "chamadas de desenho"], ["triangles", "triângulos"], ["programsNewDuringSample", "shaders compilados durante a amostra"], ["lightsOn", "luzes pontuais ativas"], ["programs", "programas de shader"], ["jsMsMedian", "CPU JS ms/quadro (mediana)"], ["frameMsWithGpuSyncMedian", "quadro c/ sync GPU ms (SwiftShader)"], ["heapKBPerFrame", "alocação KB/quadro"]];
const pct = (x, y) => (x ? `${y < x ? "−" : "+"}${Math.abs(Math.round((y - x) / x * 100))}%` : "");
let s = `| cena | métrica | ${a} | ${d} | Δ |\n|---|---|---|---|---|\n`;
for (const sc of Object.keys(A.scenes)) { if (!D.scenes[sc]) continue; for (const [k, n] of cols) s += `| ${sc} | ${n} | ${A.scenes[sc][k] ?? "-"} | ${D.scenes[sc][k] ?? "-"} | ${pct(A.scenes[sc][k], D.scenes[sc][k])} |\n`; }
const only = Object.keys(D.scenes).filter((k) => !A.scenes[k]);
if (only.length) {
  s += `\nCenas novas em ${d} (sem equivalente em ${a}):\n\n| cena | ${cols.map((c) => c[1]).join(" | ")} |\n|---|${cols.map(() => "---").join("|")}|\n`;
  for (const sc of only) s += `| ${sc} | ${cols.map(([k]) => D.scenes[sc][k] ?? "-").join(" | ")} |\n`;
}
s += `\nMenu pronto: ${A.menuReadyMs} → ${D.menuReadyMs} ms · F1 carregada: ${A.f1LoadMs} → ${D.f1LoadMs} ms${D.f2LoadMs ? ` · F2 carregada: ${D.f2LoadMs} ms` : ""} · pacote JS: ${A.bundle[0].kB} kB (${A.bundle[0].gzipKB} gzip) → ${D.bundle[0].kB} kB (${D.bundle[0].gzipKB} gzip)\n`;
console.log(s);
