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

## Onda 1 — Correção em LOTE (corrigir todas as seguras) ✅ LOCALHOST
Provado ponta-a-ponta no arquivo REAL `...POSTOCG..._REJEITADO.txt` (id 2017, 202606, leiaute 020):
- **Endpoint** `POST /api/validador/corrigir-lote/:id` (`dry_run` = preview; sem = aplica em `lote_id`) + `DELETE /:id/:loteId` (desfaz o lote). server.js ~6043.
- **Gate `_loteGateSeguro`** (painel §2.1): auto = BLOQ + corrigível + `fiscal-deterministico` + com sugestão, e POR REGRA: 2890 só `campoIdx=20` (VL_OUT_DA próprio) com chave 44 válida e `VL_ICMS_ST=0` (o recompute de VL_DOC de terceiros, campoIdx 12, fica MANUAL); 2075/2951/2800 determinísticos. 9900/⚪ NÃO entram.
- **Prova:** preview=741 (`2890:739, 2075:1, 2951:1`); revalidar **742→3 bloqueantes** (os 3 = terceiros, retidos p/ manual); **desfazer restaura 811/742/69 idêntico**.
- **Display fix 2890** confirmado ao vivo: L107 = `6,43 → 0,00` (VL_OUT_DA), VL_DOC `116,68` preservado.
- **Frontend** ValidadorView: botão "Corrigir todas as seguras" (Wand2) → **modal de PRÉVIA** (total + por-regra + exemplos) → "Aplicar" → revalida; chip "↩ desfazer último lote". SFC compila.
- Nada commitado (git segurado). Nada tocado na VPS.

## Onda 2 — Fix uso/consumo x90 (C190 órfão) ✅ LOCALHOST + PAINEL FISCAL
Erro reportado: `DOC-C190-01` "combinação 090/1556/20,50 do C190 sem item C170" (NF 59235, brita uso/consumo).
- **Causa-raiz (engenharia):** a chave da correção do C190 inclui o CST; o export relabela CST (uso/consumo 020→090, monofásico 61→60) ANTES de `correcoesSvc.aplicar` (server.js 9330 vs 9402) → correção de C190 vinda do Analisar/lote (chave com CST original) NÃO casa após o relabel → C170 zera (chave por item), C190 não → órfão.
- **Painel fiscal (Workflow, 5 especialistas + relator, consenso 5/5):** uso/consumo (CFOP 1407/1556/2407/2556) NÃO credita ICMS (LC 87/96 art. 20 §1º + art. 33, I → diferido até 2033) → **CST 090** com ICMS próprio zerado; preservar VL_OPR e ST. Fix = **Opção B** (zerar em lockstep no relabel); rejeitaram C (colide chave) e A (redundante). Parecer em `tasks/woy0aiaa3.output` + `wf_d1327110-23a`.
- **Implementado** (`spedCostureiraService.js` `normalizarUsoConsumoCst90`): ao relabelar p/ x90, zera ICMS próprio EM LOCKSTEP — C170 f13/f14/f15; C190 f4/f6/f7/f10 — só se ≠0 (byte-estável), preservando VL_OPR(f5) e ST(f8/f9). **Gate de ST refinado:** pula linha só quando `VL_ICMS_ST≠0` (valor real de ST). ⚠️ O painel sugeriu pular todo CST-ST 10/30/60/70, mas o **golden #1326 revelou** que os x60 de uso/consumo da base têm VL_ICMS_ST=0 (sem valor a preservar, já aceitos como x90) → gate mira o VALOR real de ST, não o dígito → protege ST de verdade sem reclassificar arquivos aceitos.
- **Provado:** NF 59235 órfão=0 **por construção** (sem band-aid); Caso A (060+ST 14,40) preserva 060+ST; Caso B (060 sem ST) → 090; idempotente; golden **4 OK byte-idêntico**; suíte 168/168; repro 10/10. As 2 correções manuais de C190 do usuário (23:17) ficaram **redundantes**.
- **Pendente relacionado:** o monofásico (61→60) sofre do MESMO mismatch de chave; hoje coberto por `zerarBaseMonofasicoEntrada`; se surgir órfão de C190 monofásico via correção manual, aplicar a mesma filosofia lockstep. Nada commitado; VPS intocada.

## Ainda pendente
| Item | Descrição | Status |
|------|-----------|:------:|
| 0.5 / CROSS-EXPORT | Ordem `correcoesSvc.aplicar` × `normalizarUsoConsumoCst90`/`zerarBaseMonofasicoEntrada` + dedup-merge C190 | ⏳ (o lote 2951/2890 aplicou OK na ordem atual; verificar casos com uso/consumo/monofásico) |
| UI cards por categoria | ValidadorView: agrupar por código+categoria 🟢/🟡/⚪/✅ (hoje é lista) | ⏳ opcional |
| Cap de escala / regime | Limitar auto por porte + exclusão por regime (Simples etc.) no coletor | ⏳ (gate atual já é conservador) |

## Arquivos tocados (para revisão antes do commit)
**Novos:** `services/validador/money.js`, `tests/eauditoria-repro.js`, e 10 regras `rules/r_{c100_vl_doc,c170_icms_sem_base,c190_icms_sem_base,c190_red_bc,9900_regblc,c190_vl_icms,0400_codnat_cfop,0206_sem_1300,c170_cod_cta,c100_5929}.js`
**Modificados:** `services/validador/{correcoes.js,engine.js,rules/index.js}`, `tests/validador-suite.js`
**Docs:** `docs/superpowers/plans/{REVISAO-CROSS-EMPRESA-2026-07-08.md, PROGRESS-catalogo-eauditoria.md}` + adendo no plano principal
