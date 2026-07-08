# Controle de Tasks — Catálogo E-Auditoria (Validação e Correção)

> Executando `2026-07-07-catalogo-eauditoria-correcao.md` + revisão cross-empresa do painel (`REVISAO-CROSS-EMPRESA-2026-07-08.md`).
> Branch: `feat/validador-sped`. **Commits SEGURADOS** — nada vai para o git até autorização (testar em localhost primeiro).
> Estratégia: **detecção reproduz o E-Auditoria** (par casado intacto); gates do painel = **severidade/categoria + elegibilidade de auto-correção**. **Toda auto-correção adiada** para a sessão localhost.

## Estado dos testes
- `validador-suite.js`: **168/168** ✅ (baseline era 137)
- `eauditoria-repro.js` (arquivo real POSTO CG): **10 ok / 0 falhas** ✅
- `golden-export.js`: 4 OK / 3 falha (HTTP 404 ambiental, = baseline — regras não tocam o export) ✅

## Onda 0 — Fundação ✅
| Task | Status |
|------|:------:|
| 0.1 money.js (centavos HALF-UP) | ✅ |
| 0.2 chaveNatural C190 + guard chave vazia (F4) | ✅ |
| 0.3 engine propaga refEAuditoria | ✅ |
| 0.4 arnês eauditoria-repro.js | ✅ |
| 0.5 chave C190 no export (F2/CROSS-EXPORT) | ⏳ **localhost** |

## Regras de DETECÇÃO (10) — todas ✅ (reproduzem o E-Auditoria no par casado)
| Regra | E-Aud | Veredito painel | Occ POSTO CG | Categoria | Status |
|------|:-----:|-----------------|:------------:|-----------|:------:|
| DOC-C100-VLDOC-01 | 2890 | PRECISA_GATE | ≥200 (~742) | 🟢 gateado | ✅ |
| DOC-C170-ICMSSEMBASE-01 | 2075 | PRECISA_GATE | 1 | 🟢 gateado | ✅ |
| DOC-C190-ICMSSEMBASE-01 | 2951 | PRECISA_GATE | 1 | 🟢 gateado (dep. 0.5) | ✅ |
| DOC-C190-REDBC-01 | 2800 | PRECISA_GATE | 1 | 🟢 gateado (dep. 0.5) | ✅ |
| EST-9900-REGBLC-01 | 2037 | PRECISA_GATE | 23 | 🟢 gateado (QTD) | ✅ |
| DOC-C190-VLICMS-01 | 2481 | SO_DETECCAO | **0**¹ | ⚪ alerta | ✅ |
| CAD-0400-CFOP-01 | 2441 | SO_DETECCAO | 3 | ⚪ alerta | ✅ |
| COMB-0206-1300-01 | 2321 | SO_DETECCAO | 2 | ⚪ alerta | ✅ |
| DOC-C170-CODCTA-01 | 2451 | SO_DETECCAO | 10 | ⚪ alerta² | ✅ |
| DOC-C100-5929-01 | 1003 | SO_DETECCAO | 31 | ⚪ alerta³ | ✅ |

¹ **Divergência PROPOSITAL do E-Auditoria (que acha 12):** a fórmula correta (Σ VL_ICMS dos C170, não `round(BC×ALIQ)`) mostra que os 12 são arredondamento agregado legítimo → 0 erros reais.
² POSTO CG **não tem 0500** → os 10 COD_CTA-vazio são legítimos; detalhe marca "pode desconsiderar".
³ Os 31 são todos **ADV** (monofásico legítimo, 0 BLOQ) — confirma o painel: sem bitributação.

**Cada regra carrega no cabeçalho o veredito + gate do painel** como TODO para quando ligarmos a auto-correção.

## Adiado para sessão LOCALHOST (precisa servidor + testes ao vivo)
| Item | Descrição |
|------|-----------|
| 0.5 / CROSS-EXPORT | Mover `correcoesSvc.aplicar` ANTES de `normalizarUsoConsumoCst90`/`zerarBaseMonofasicoEntrada` + dedup-merge + logar não-casamento |
| Auto-correção gateada | Coletor com os guards do painel (§2.1–2.6) por regra; flip das 🟢 para auto |
| corrigir-tudo + preview | Endpoint dry-run server-side + token + `lote_id` (undo em massa) + cap de escala + exclusão por regime |
| UI-1 | ValidadorView: cards por código+categoria + master "Corrigir tudo (só seguros)" com preview |

## Arquivos tocados (para revisão antes do commit)
**Novos:** `services/validador/money.js`, `tests/eauditoria-repro.js`, e 10 regras `rules/r_{c100_vl_doc,c170_icms_sem_base,c190_icms_sem_base,c190_red_bc,9900_regblc,c190_vl_icms,0400_codnat_cfop,0206_sem_1300,c170_cod_cta,c100_5929}.js`
**Modificados:** `services/validador/{correcoes.js,engine.js,rules/index.js}`, `tests/validador-suite.js`
**Docs:** `docs/superpowers/plans/{REVISAO-CROSS-EMPRESA-2026-07-08.md, PROGRESS-catalogo-eauditoria.md}` + adendo no plano principal
