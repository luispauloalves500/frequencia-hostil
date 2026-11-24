# Antes × depois (1920×1080, qualidade Média, Chromium headless/SwiftShader)

O tempo de quadro com sync da GPU em SwiftShader é só um indicador de custo de pixel (GPU por software); em GPU real os números absolutos são muito menores.

| cena | métrica | antes | depois | Δ |
|---|---|---|---|---|
| menu | chamadas de desenho | 99 | 91 | −8% |
| menu | triângulos | 7538 | 8878 | +18% |
| menu | luzes pontuais ativas | 26 | 9 | −65% |
| menu | CPU JS ms/quadro (mediana) | 1.4 | 1.1 | −21% |
| menu | quadro c/ sync GPU ms (SwiftShader) | 449.2 | 346 | −23% |
| menu | alocação KB/quadro | 96.5 | 67.3 | −30% |
| bilheteria | chamadas de desenho | 258 | 204 | −21% |
| bilheteria | triângulos | 12159 | 12557 | +3% |
| bilheteria | luzes pontuais ativas | 26 | 13 | −50% |
| bilheteria | CPU JS ms/quadro (mediana) | 4.1 | 2.3 | −44% |
| bilheteria | quadro c/ sync GPU ms (SwiftShader) | 971.5 | 700.4 | −28% |
| bilheteria | alocação KB/quadro | 363.4 | 140.5 | −61% |
| praca | chamadas de desenho | 143 | 130 | −9% |
| praca | triângulos | 8672 | 9591 | +11% |
| praca | luzes pontuais ativas | 26 | 13 | −50% |
| praca | CPU JS ms/quadro (mediana) | 3.3 | 2 | −39% |
| praca | quadro c/ sync GPU ms (SwiftShader) | 782.5 | 598.8 | −23% |
| praca | alocação KB/quadro | 189.5 | 79.1 | −58% |
| embarque | chamadas de desenho | 51 | 47 | −8% |
| embarque | triângulos | 6190 | 7166 | +16% |
| embarque | luzes pontuais ativas | 26 | 5 | −81% |
| embarque | CPU JS ms/quadro (mediana) | 1.6 | 1.3 | −19% |
| embarque | quadro c/ sync GPU ms (SwiftShader) | 596.7 | 449.7 | −25% |
| embarque | alocação KB/quadro | 56.7 | 35.6 | −37% |

Menu pronto: 3277 → 2137 ms · F1 carregada: 118 → 164 ms · pacote JS: 734.4 kB (192.2 gzip) → 742 kB (194.7 gzip)

