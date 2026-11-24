# FREQUÊNCIA HOSTIL — D03 (F1 • Última Chamada)

FPS de ficção científica para navegador. Lia Vilar atravessa o terminal de Porto do Sal até a catraca de serviço enquanto o Coro caça qualquer som. Arte procedural/low-poly e som sintetizado em WebAudio, tudo original.

**Jogar:** https://luispauloalves500.github.io/frequencia-hostil/

## Controles
| Ação | Tecla |
|---|---|
| Andar | WASD / setas |
| Correr | Shift (atirar encerra a corrida e já dispara) |
| Saltar | Espaço |
| Agachar / deslizar (correndo) | Ctrl ou C |
| Agulha: primário / secundário (marca, custa 3) | Botão esquerdo / direito |
| Recarregar | R |
| Trocar arma | 1–4 / roda do mouse |
| Baliza: lançar / chamar | Q / Q de novo |
| Interagir | E |
| Curativo | F |
| Pausa | Esc |
| Diagnóstico | F3 |

## Marcos
- **D00** — menu, sala de teste, captura do mouse, movimento, pausa/retomar/menu.
- **D01** — corrida, salto, agachar, deslize, Agulha (24/144, 1,4 s de recarga), vida, Riscador, morte e reinício.
- **D02** — baliza de dois toques, grade × parede sólida, Estilhaço, marca da Agulha, duas rotas na sala.
- **D03** — F1 completa: vestiário, bilheteria, guichê, abrigo F1-B, praça da catraca com duas ondas, embarque, retornos F1-A/F1-B, resultado, primeiro pacote de arte/HUD/som.

Salas de teste: `?sala=d00`, `?sala=d01`, `?sala=d02`.

## Desenvolvimento
```
npm ci
npm test          # vitest: regras de movimento, deslize, baliza, armas, save, ondas, F1 simulada
npm run build     # tsc + vite
npm run e2e       # Playwright (Chromium headless) — aceite D00 → D03 contra o build
```
O modo `?debug=1` emula a captura do mouse e expõe `window.__fh` para a automação; o fluxo normal não muda.
