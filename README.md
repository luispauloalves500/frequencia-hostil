# FREQUÊNCIA HOSTIL — D04 (F1 • Última Chamada + F2 • Mercado Afogado)

FPS de ficção científica para navegador. Lia Vilar atravessa o terminal de Porto do Sal até a catraca de serviço e depois o mercado de peixe alagado até a comporta baixa, enquanto o Coro caça qualquer som. Arte procedural/low-poly e som sintetizado em WebAudio, tudo original.

**Jogar:** https://luispauloalves500.github.io/frequencia-hostil/

## Controles
| Ação | Tecla |
|---|---|
| Andar | WASD / setas |
| Correr | Shift (atirar encerra a corrida e já dispara) |
| Saltar | Espaço |
| Agachar / deslizar (correndo) | Ctrl ou C |
| Agulha: primário / secundário (marca, custa 3) | Botão esquerdo / direito |
| Fole: leque de 6 fragmentos / sopro (custa 2: empurra comuns leves e afasta a névoa do Véu) | Botão esquerdo / direito |
| Recarregar | R |
| Trocar arma | 1–4 / roda do mouse |
| Baliza: lançar / chamar | Q / Q de novo |
| Tear: esticar linha no piso | botão direito (com o Tear, tecla 3) |
| Interagir | E |
| Curativo | F |
| Pausa | Esc |
| Diagnóstico | F3 |

## Marcos
- **D00** — menu, sala de teste, captura do mouse, movimento, pausa/retomar/menu.
- **D01** — corrida, salto, agachar, deslize, Agulha (24/144, 1,4 s de recarga), vida, Riscador, morte e reinício.
- **D02** — baliza de dois toques, grade × parede sólida, Estilhaço, marca da Agulha, duas rotas na sala.
- **D03** — F1 completa: vestiário, bilheteria, guichê, abrigo F1-B, praça da catraca com duas ondas, embarque, retornos F1-A/F1-B, resultado, primeiro pacote de arte/HUD/som.
- **D04 (v0.4.0)** — F2 • Mercado Afogado: Fole e Véu; rota baixa (névoa, Fole) e rota alta (escada, passarela e toldo, Agulha); praça da banca azul com registro 1; corredor de gelo e abrigo F2-B; casa da boia com o registro 2 (8 s de abertura, luz em quatro segmentos, objetivo “Atravesse a comporta”); saída possível com comuns vivos; resultado da F2. A F2 começa com o inventário com que a F1 terminou. Também: F1 com piso molhado/sujo, cabos, cartazes, lâmpadas pendentes e goteiras; Agulha e Fole detalhados em primeira pessoa (coice, recarga animada, indicadores de pente acesos); Riscador e Estilhaço de “cristal vivo” (veias que pulsam, lampejo e tranco ao levar tiro, estilhaçam ao morrer); baliza menor na mão; o tempo do resultado não zera mais ao Continuar.
- **D05 (v0.5.0)** — F3 • Casa das Bombas: o resultado da F2 leva à F3 com o inventário. Tear (3ª arma: o botão direito estica uma linha no piso que fere o que passa por ela; o tiro atravessa alvos); Riscadores nos filtros; Carapaça (carga contra o batente, abre as placas do peito); bomba 1 (jato) e persiana; galeria com rota pela passarela ou pela margem; bomba 2 e abrigo do poço F3-B; chefe **Badalo** no trilho do teto (crava o sino nas placas — derrubado pela baliza ou ao errar a Lia —, onda de choque, meia-vida com transição, barra de vida); túnel de saída e resultado da F3. Também: luz sem estouro (lâmpadas e reflexos domados), criaturas orgânicas e foscas com morte orgânica (desabam e se desfazem), nenhuma peça de decoração solta no ar (verificação automática `e2e/props.mjs`), armas com cantos arredondados e menos chamadas de desenho (atlas de placas/cartazes, criaturas e decoração mescladas por material).

- **D06 (v0.6.0)** — fases e inimigos refinados. Criaturas com mais detalhe sem nenhuma chamada de desenho a mais: pele com relevo procedural, sulcos escuros e borda fria (o Riscador se destaca nas áreas claras), placas, dentes, tendões, espinhos, garras e fendas que brilham; respiração e espasmos em repouso, cabeça que abaixa antes do bote, marcas de ferida onde o tiro acerta e dissolução com brasas. Fases F1–F3 com narrativa ambiental (marcas de garra, rastros, mochilas e bilhetes largados), setas no piso e luzes de saída, poeira suspensa em volta do jogador (1 chamada de desenho), sons ambientes (gotas, rangido de cano, gemido distante) e verificação de peças soltas por malha (botões, lâmpadas, placas e luminárias; luminárias ganharam tirantes/hastes).

Salas de teste: `?sala=d00`, `?sala=d01`, `?sala=d02`.

## Desempenho (v0.3.1; v0.5: −21% a −45% de chamadas de desenho — ver release/perf/tabela-v04-v05.md; v0.6: release/perf/tabela-v05-v06.md)

Opções → **Desempenho**: *Automático* (padrão) reduz a resolução interna em passos de 10% (até 60%) só quando os quadros passam de ~21 ms por alguns segundos e volta sozinho para 100% quando sobra folga; *Resolução máxima fixa* nunca mexe. O visual padrão é o mesmo de antes.

O que deixou o jogo mais leve, sem cortar gráficos:
- **Pool de luzes**: as ~30 luzes pontuais da fase viram fontes virtuais; a cada quadro só as que tocam o campo de visão são copiadas para 12 luzes reais (16 no Alto, 10 no Baixo), com transição suave. O custo por pixel cai pela metade ou mais.
- **Chuva e mar na GPU** (shader), sem reescrever buffers no processador a cada quadro.
- **Zero recompilação por quadro**: materiais transparentes de dupla face (contornos das criaturas, anéis) passam a desenhar em um passe só — o three.js recompilava os parâmetros desses materiais duas vezes por quadro.
- **Menos lixo na memória**: partículas em vetores fixos, traçantes reaproveitados, vetores temporários, HUD que só escreve no DOM quando o valor muda.
- **Decoração estática mesclada** por material (menos chamadas de desenho) e **shaders pré-compilados** no carregamento (sem travadinhas na primeira vez que algo aparece).

Medição: `node e2e/perf.mjs <rótulo>` grava `release/perf/<rótulo>.json` e capturas em `release/screenshots/perf/`; `node tools/perf-table.mjs` compara antes/depois e `python3 tools/side-by-side.py` monta os comparativos.

## Desenvolvimento
```
npm ci
npm test          # vitest: movimento, deslize, baliza, armas, save, ondas, F1 e F2 simuladas, F1→F2
npm run build     # tsc + vite
npm run e2e       # Playwright (Chromium headless) — aceite D00 → D04 contra o build
```
O modo `?debug=1` emula a captura do mouse e expõe `window.__fh` para a automação; o fluxo normal não muda.
