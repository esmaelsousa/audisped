# LP /05 — Audisped no estilo appmax, com nossas cores

**Data:** 2026-07-18 · **Branch:** feat/contribuicoes · **Status:** aprovado (design em chat)

## Objetivo
Nova landing page para `www.audisped.com.br/05`, inspirada na ESTRUTURA e no "sentimento fintech premium" de https://appmax.com.br, mas 100% com a identidade visual do Audisped. Página única, HTML+CSS+JS inline, auto-contida. Publicada primeiro como preview (Artifact); deploy na VPS em `/05` só após OK do Esmael.

## Decisões travadas
- **Copy:** nova e mais vendedora, tom fintech, foco em donos de posto + contadores/fiscais. CTA por WhatsApp (`wa.me/5574991985228`).
- **Tecnologia:** HTML estático único (sem framework), servido pelo nginx em `/05`. Encaixa no padrão existente `landing/{01,02,03}` → `landing/05/index.html`.
- **Publicação:** preview via Artifact primeiro. Deploy VPS só com aprovação.

## Tradução appmax → Audisped
| appmax | Audisped |
|--------|----------|
| Roxo `#9b6afa` (acento dominante) | Bronze `#E0902F` |
| Preto-arroxeado `#0e0820` (fundos dark) | Grafite `#1C232A` / ink `#121820` |
| Verde só sucesso | Verde-conforme `#3C7B58` (status OK) |
| — | Vermelho-multa `#AE3A33` (erro/dor fiscal) |
| Inter (700/800, tracking negativo) | Archivo (900, letter-spacing −.02em) |
| — (sem mono) | IBM Plex Mono (rótulos técnicos) |
| Glow roxo atrás dos mockups | Glow bronze radial |
| Botões pill roxos | Botões pill gradiente bronze `135deg #B56C1E→#8F5316` |
| Cards radius 24px, sombras difusas | Idem |
| Mockups "vivos" (barras/radar/chat) | Painel de validação animado / radar de cruzamento |

## Sistema visual
- Fundos full-width alternando claro (`#F3F5F4`, creme `#FFF7EE`) ↔ escuro (`#1C232A`, `#121820`).
- Container leitura ~760px; blocos ~1140px; muito respiro vertical.
- Movimento: IntersectionObserver reveals on-scroll, marquee infinito, mockups animados leves. `prefers-reduced-motion` respeitado.
- Acessibilidade: foco de teclado visível, responsivo até mobile.

## Mapa da página (topo→base)
1. Nav fixo — wordmark Audi·**Sped** + links + CTA WhatsApp (pill bronze)
2. Hero 2 colunas — headline "Largue o PVA. Entregue o SPED sem multa." + subhead + CTAs; à direita painel de validação animado (erros → "Conforme", contador de regras)
3. Marquee de módulos/integrações (EFD-ICMS · EFD-Contribuições · LMC · SEFAZ · E-Auditor · ANP · AutoSystem…)
4. Features alternadas texto↔mockup: "Acha o que o PVA não mostra" · "Corrige e exporta pronto" (antes/depois) · "LMC e encerrantes no automático"
5. Bloco escuro — Cruzamento SEFAZ × escrituração (animação radar de divergências)
6. Bloco — EFD-Contribuições (PIS/COFINS, módulo novo)
7. Grade "Tudo num lugar" — cards de módulos com ícones
8. Storytelling — "Feito por quem vive posto e SPED"
9. Passo-a-passo em 3 passos — Importe → Valide → Exporte corrigido
10. Números/prova — regras ativas, erros corrigidos, sem PVA
11. CTA final escuro com glow bronze
12. Footer escuro multi-coluna

## Fora de escopo
- Não altera a LP atual (`landing/index.html`) nem o app.
- Sem backend novo; formulários levam ao WhatsApp/app existentes.

## Verificação
- Preview no Artifact aprovado pelo Esmael.
- Responsivo (mobile), sem scroll horizontal, foco visível, reduced-motion.
- Deploy VPS `/05` só após OK.
