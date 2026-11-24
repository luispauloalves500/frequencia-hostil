// Tabela antes/depois a partir de release/perf/*.json
import { readFileSync } from "node:fs";
const A = JSON.parse(readFileSync("release/perf/antes.json")), D = JSON.parse(readFileSync("release/perf/depois.json"));
const cols = [["drawCalls", "chamadas de desenho"], ["triangles", "triângulos"], ["lightsOn", "luzes pontuais ativas"], ["jsMsMedian", "CPU JS ms/quadro (mediana)"], ["frameMsWithGpuSyncMedian", "quadro c/ sync GPU ms (SwiftShader)"], ["heapKBPerFrame", "alocação KB/quadro"]];
const pct = (a, d) => (a ? `${d < a ? "−" : "+"}${Math.abs(Math.round((d - a) / a * 100))}%` : "");
let s = "| cena | métrica | antes | depois | Δ |\n|---|---|---|---|---|\n";
for (const sc of Object.keys(A.scenes)) for (const [k, n] of cols) s += `| ${sc} | ${n} | ${A.scenes[sc][k]} | ${D.scenes[sc][k]} | ${pct(A.scenes[sc][k], D.scenes[sc][k])} |\n`;
s += `\nMenu pronto: ${A.menuReadyMs} → ${D.menuReadyMs} ms · F1 carregada: ${A.f1LoadMs} → ${D.f1LoadMs} ms · pacote JS: ${A.bundle[0].kB} kB (${A.bundle[0].gzipKB} gzip) → ${D.bundle[0].kB} kB (${D.bundle[0].gzipKB} gzip)\n`;
console.log(s);
