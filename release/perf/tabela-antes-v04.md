| cena | métrica | antes | v04 | Δ |
|---|---|---|---|---|
| menu | chamadas de desenho | 99 | 80 | −19% |
| menu | triângulos | 7538 | 8626 | +14% |
| menu | shaders compilados durante a amostra | - | 0 |  |
| menu | luzes pontuais ativas | 26 | 9 | −65% |
| menu | programas de shader | 25 | 63 | +152% |
| menu | CPU JS ms/quadro (mediana) | 1.4 | 1.2 | −14% |
| menu | quadro c/ sync GPU ms (SwiftShader) | 449.2 | 326.9 | −27% |
| menu | alocação KB/quadro | 96.5 | 72.6 | −25% |
| bilheteria | chamadas de desenho | 258 | 238 | −8% |
| bilheteria | triângulos | 12159 | 13120 | +8% |
| bilheteria | shaders compilados durante a amostra | - | 0 |  |
| bilheteria | luzes pontuais ativas | 26 | 13 | −50% |
| bilheteria | programas de shader | 33 | 72 | +118% |
| bilheteria | CPU JS ms/quadro (mediana) | 4.1 | 2.5 | −39% |
| bilheteria | quadro c/ sync GPU ms (SwiftShader) | 971.5 | 658.7 | −32% |
| bilheteria | alocação KB/quadro | 363.4 | 172.9 | −52% |
| praca | chamadas de desenho | 143 | 129 | −10% |
| praca | triângulos | 8672 | 9332 | +8% |
| praca | shaders compilados durante a amostra | - | 0 |  |
| praca | luzes pontuais ativas | 26 | 13 | −50% |
| praca | programas de shader | 33 | 72 | +118% |
| praca | CPU JS ms/quadro (mediana) | 3.3 | 1.9 | −42% |
| praca | quadro c/ sync GPU ms (SwiftShader) | 782.5 | 553.4 | −29% |
| praca | alocação KB/quadro | 189.5 | 82.7 | −56% |
| embarque | chamadas de desenho | 51 | 34 | −33% |
| embarque | triângulos | 6190 | 6690 | +8% |
| embarque | shaders compilados durante a amostra | - | 0 |  |
| embarque | luzes pontuais ativas | 26 | 5 | −81% |
| embarque | programas de shader | 33 | 72 | +118% |
| embarque | CPU JS ms/quadro (mediana) | 1.6 | 1.3 | −19% |
| embarque | quadro c/ sync GPU ms (SwiftShader) | 596.7 | 405.2 | −32% |
| embarque | alocação KB/quadro | 56.7 | 27.8 | −51% |

Cenas novas em v04 (sem equivalente em antes):

| cena | chamadas de desenho | triângulos | shaders compilados durante a amostra | luzes pontuais ativas | programas de shader | CPU JS ms/quadro (mediana) | quadro c/ sync GPU ms (SwiftShader) | alocação KB/quadro |
|---|---|---|---|---|---|---|---|---|
| f2Peixaria | 259 | 15670 | 0 | 13 | 76 | 2.6 | 551.9 | 119.4 |
| f2Praca | 202 | 14087 | 0 | 13 | 76 | 2 | 576.5 | 79.3 |
| f2Nevoa | 231 | 14392 | 0 | 13 | 77 | 2.2 | 726.6 | 98.5 |
| f2Boia | 105 | 10201 | 0 | 12 | 77 | 1.6 | 532.7 | 46.4 |

Menu pronto: 3277 → 3968 ms · F1 carregada: 118 → 156 ms · F2 carregada: 154 ms · pacote JS: 734.4 kB (192.2 gzip) → 806.7 kB (213.6 gzip)

