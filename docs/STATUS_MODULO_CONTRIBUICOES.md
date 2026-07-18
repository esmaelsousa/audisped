# Módulo EFD-Contribuições (PIS/COFINS) — STATUS & PLANO detalhado

> **Documento-mestre** do módulo. Consolida onde estamos, o que foi feito e o que falta.
> Branch: **`feat/contribuicoes`** (a partir de `main` = produção). Última atualização: 2026-07-18.
> Blueprint fiscal: `PLANO_INJETOR_XML_CONTRIBUICOES.md` (v2). Roteiro do validador: `PLANO_IMPL_VALIDADOR_CONTRIBUICOES.md`.

---

## 1. Objetivo e princípio
Módulo **duplo — injetor + validador** de EFD-Contribuições. Ordem de entrega: **validador primeiro**
(read-only, risco zero), **injetor depois** (gera arquivo). Núcleo fiscal (classificador NCM→CST) é
**compartilhado** pelos dois.

**Princípio de blindagem:** tudo novo em arquivos/tabelas NOVOS (`efd_contrib_*`,
`services/contribuicoes/*`); existentes só recebem adição mínima. Nada do Fiscal/LMC/validador ICMS é tocado.

**Princípio fiscal (parecer do painel):** o software **não é autoridade fiscal** — usa **de-para por
cliente** (do histórico dele) e **default conservador** (na dúvida, não credita/não tributa). O gabarito
de validação é o **PVA oficial** (regras extraídas) + a **materialidade por NCM** (contador assina).

---

## 2. Estado atual (resumo executivo)
| Camada | Estado |
|---|---|
| Fase 1 — parser round-trip (importar→exportar byte-idêntico) | ✅ FEITO |
| Fase 2 — classificador fiscal NCM→bucket→CST (núcleo compartilhado) | ✅ FEITO |
| Validador read-only — motor + 4 regras (COD_CTA, crédito regime-aware, coerência CST×base C170/C175) | ✅ EM ANDAMENTO (base sólida) |
| Extração forense do PVA oficial → catálogo de 19 regras | ✅ FEITO |
| Parecer fiscal + specs de implementação (4 grupos) + plano consolidado | ✅ FEITO |
| Injetor (geração C100/C170/0500/Bloco M) | ⏸️ NÃO INICIADO (segurado até validador maduro + de-para) |
| Frontend (tela do validador/injetor) | ⏸️ NÃO INICIADO |

**Testes:** 6 (`contrib-*.test.js`), **todos verdes** (5 sem banco + 1 de persistência com banco).
**Pegada:** nada instalado, produção intacta, `mysql.zip`/SPEDs reais no `.gitignore`.

---

## 3. Artefatos (o que existe e o que faz)

### Código (backend)
| Arquivo | Papel |
|---|---|
| `services/spedContribuicoesService.js` | Parser (`parseContribuicoes`→{linhas,meta}), `montarArquivo` (round-trip), persistência (`salvarArquivo`/`exportarArquivo`). |
| `services/contribuicoes/classificadorFiscal.js` | Núcleo fiscal: `classificarNcm` (NCM→bucket), `regraCst` (bucket×direção→CST). Default conservador (INDEFINIDO). |
| `services/contribuicoes/validadorContribuicoes.js` | Validador read-only: motor multi-registro + regras (aponta, não corrige). |
| `routes/contribuicoesRouter.js` | Endpoints `POST /api/contribuicoes/upload`, `GET /api/contribuicoes/exportar/:id` (factory `(pool, authMiddleware)`). |
| `migrations/2026-07-18-efd-contrib.js` | Tabelas `efd_contrib_arquivos` + `efd_contrib_linhas` (idempotente; rodada no banco local). |
| `server.js` | +1 linha: `app.use('/api/contribuicoes', ...)`. Único toque no existente. |

### Testes
`contrib-roundtrip`, `contrib-persist` (com DB), `contrib-classificador`, `contrib-validador` (CASA DA BEBIDA), `contrib-validador-posto` (POSTO CG), `contrib-validador-c175` (sintético). Fixtures reais = gitignored (pulam se ausentes).

### Documentação (docs/)
| Doc | Conteúdo |
|---|---|
| `STATUS_MODULO_CONTRIBUICOES.md` | **este** (mestre). |
| `PLANO_INJETOR_XML_CONTRIBUICOES.md` | Blueprint fiscal v2 (injetor). |
| `PLANO_IMPL_VALIDADOR_CONTRIBUICOES.md` | Roteiro consolidado do validador (19 regras). |
| `CATALOGO_REGRAS_PVA_CONTRIBUICOES.md` | As 19 regras extraídas da base do PVA oficial. |
| `PARECER_FISCAL_CONTRIBUICOES.md` | Parecer p/ o contador (Q1–Q5, checklist do de-para, base legal). |
| `ESPEC_VALIDADOR_BLOCO_M_CONTRIBUICOES.md` / `..._GRUPO_CST_CREDITO.md` / `SPEC_..._ALIQUOTA_BASE.md` | Specs de implementação por grupo (dos agentes forenses). |

### Commits (branch `feat/contribuicoes`)
`15cd78a` Fase 1 · `714e82d` classificador · `e7f0172` validador v1 + parecer · `a2caddb` catálogo PVA · `2c4f85a` plano+specs · `b3a0aa1` motor+COD_CTA · `443a7b5` regime-aware · `ddfb18d` C175.

---

## 4. O que está FEITO (detalhado)

### 4.1 Fase 1 — Round-trip (commit `15cd78a`)
Importa o `.txt` (latin-1, CRLF), preserva tudo como raw, exporta **byte-a-byte idêntico** (`sha256`
igual). Prova a fundação sem risco. Migração + endpoints + arnês golden (`contrib-roundtrip`, `contrib-persist`).

### 4.2 Fase 2 — Classificador fiscal (commit `714e82d`)
`classificarNcm(ncm)` → `{bucket, confianca}`; `regraCst(bucket, direcao)` → `{cst, exigeBase, credita, aviso}`.
Seed **só do incontestável**: combustível 2710/2711 = MONOFÁSICO (saída CST 04, entrada CST 70 sem crédito);
vinho/destilado 2204-2208 = NORMAL (saída CST 01, entrada CST 50). **Bebidas frias 2201-2203 = INDEFINIDO**
(disputado pós Lei 13.097/2015 — aguarda contador). Default conservador.

### 4.3 Validador read-only — regras já implementadas
| Regra | Detecção | Ancorada |
|---|---|---|
| `CST_SEM_BASE` (coerência D5) | CST 01-05/50-56 sem base/valor — em **C170 e C175** | 4 no CASA DA BEBIDA (114/135/136/167) |
| `BASE_INDEVIDA` | CST 04/06-09/70-75 com valor preenchido — C170 e C175 | — |
| `CREDITO_ENTRADA` (regime-aware) | entrada CST 50-56; **cumulativo (0110=2) = VEDADO/ALTA**, não-cumul = MEDIA | POSTO CG (CST 50 em cumulativo) |
| `COD_CTA_OBRIGATORIO` (`MSG_OBRIGATORIO_COD_CTA`) | COD_CTA vazio em C170 f37/A170 f17/M400-M810 f4/D501-D505 f11; condicional ao 0500 | **74** no CASA DA BEBIDA = igual ao PVA |

Motor: `POS[reg]` (ID_CAMPO do PVA == índice do `split('|')`), contexto C100 (IND_OPER), regime (0110),
helper `coerenciaCstBase` reutilizável. **0 falso-positivo** em 7500+ C175 reais de 2 postos.

### 4.4 Inteligência fiscal capturada (fontes)
- **Painel PIS/COFINS (6 agentes):** parecer legal → as 4 decisões revisadas (§5).
- **Base do PVA oficial (`docs/mysql.zip`):** extração forense → **19 regras** (`ID_MENSAGEM`) de 46 arquivos reais. Confirma o painel (ex.: PVA rejeita crédito em NCM monofásico).
- **Arquivos reais:** CASA DA BEBIDA (bebidas, regime 1, C170), AUTO POSTO AMARAL + POSTO CG (postos, regime 2, C175).

---

## 5. Decisões fiscais (revisadas pós-painel — valem estas)
1. **Bloco M = híbrido:** recalcula só o seguro (M400/M800 por CST); débito/crédito real → "Gerar Apuração" do PVA.
2. **0500 = placeholder "REVISAR":** só p/ conferência; **transmissão travada** até conta real. Se lucro presumido livro-caixa, COD_CTA não é obrigatório (não inventar).
3. **Crédito de entrada:** **default SEM crédito**; crédito só via de-para NCM. Nunca copiar CST do XML de compra.
4. **CST 01 tributar:** princípio correto (não rebaixar p/ 06), gatilho por **NCM**, BC=VL_ITEM−VL_DESC, **nunca** a alíquota de ICMS.
- **Núcleo:** de-para NCM (bucket) × direção → CST, default conservador. Consistência com o histórico do cliente > regra nacional.

---

## 6. As 19 regras do PVA — status
| Regra (PVA) | Reg | Prioridade | Status |
|---|---|---|---|
| MSG_OBRIGATORIO_COD_CTA | C170/A170/D/M | P1 | ✅ implementada |
| (coerência CST×base) | C170/**C175** | P3 | ✅ implementada |
| (crédito em cumulativo) | C170 | — | ✅ (extra ao PVA) |
| MSG_COMPATIBILIDADE_NCM_TRIB_MONO | C170 | P1 | ⬜ (precisa de-para NCM + index 0200) |
| MSG_COMPATIBILIDADE_CFOP_CRED | C170 | P1 | ⬜ (precisa whitelist cfop_credito) |
| MSG_ALIQ_BASICA | C175/C170 | P1 | ⬜ (regime-aware; sintético) |
| MSG_ALIQ_CREDITO_PRESUMIDO | C170 | P2 | ⬜ (CST 60-66 ALIQ 0) |
| MSG_OBRIGATORIO_NUM_REC_ANTERIOR | 0000 | P2 | ⬜ (f3 retificadora & f5 vazio) |
| MSG_OBRIGATORIO_M205_M605 | M200/M600 | P2 | ⬜ (Bloco M) |
| MSG_CONTRIBUICAO_NAO_DEVE_EXISTIR | M210/M610 | P2 | ⬜ (Bloco M) |
| MSG_VL_BC_PIS_TOT_M105 | M105/M505 | P2 | ⬜ (soma de bases) |
| MSG_OPERACAO_DIREITO_CREDITO | D501/D505 | P3 | ⬜ |
| MSG_CAMPO_OBRIGATORIO | 0100 | P3 | ⬜ (CPF) |
| MSG_VALIDA_IE | 0150 | P3 | ⬜ (precisa tabela IE/UF) |
| MSG_CALCULAR_CONTRIBUICAO / _CREDITO / _DETALHAR_BASE / _DESC_CRED / _REGISTRO_OBRIGATORIO / _GERA_M410 | M* | P3/P4 | ⬜ (Bloco M) |
| MSG_PREENCHIMENTO_0900 | 0900 | P4 | ⬜ (registro ausente) |

Detalhe de cada uma (posições, gatilhos, exemplos reais): ver `PLANO_IMPL_VALIDADOR_CONTRIBUICOES.md` + as 3 specs por grupo.

---

## 7. O que FALTA (detalhado e priorizado)

### 7.1 Validador — regras SEM dependência externa (dá pra seguir sozinho, test-first)
- **ALIQ_BASICA (P1):** comparar ALIQ_PIS/COFINS contra a **básica do regime** (não-cumul 1,65/7,6; cumul 0,65/3,0) em C175 e C170; nunca a de ICMS. Teste sintético (arquivos reais são corretos).
- **ALIQ_CREDITO_PRESUMIDO (P2):** CST 60-66 com ALIQ 0,0000.
- **Bloco M (P2/P3, 8 regras):** M205/M605 obrigatório, contribuição indevida, VL_BC_TOT (soma), calcular contrib/crédito, detalhar base, DESC_CRED, registro obrigatório, gera M410. Todas read-only (aponta ausência/incoerência; geração deferida ao PVA). Guard-rail: pular se não há Bloco M com movimento.
- **Obrigatórios estruturais (P2/P3):** NUM_REC_ANTERIOR (0000 f3='1' & f5 vazio), CAMPO_OBRIGATORIO (0100 CPF f3), PREENCHIMENTO_0900 (registro ausente).

### 7.2 Validador — regras COM dependência de dados (precisam de você)
- **NCM×monofásico (P1):** exige o **de-para NCM** (bucket) confirmado pelo contador + indexar `0200` (NCM não está no C170, só COD_ITEM). Hoje o bucket só cobre o incontestável; bebidas frias = INDEFINIDO.
- **CFOP×crédito (P1):** exige a **whitelist `cfop_credito`** (código + `nat_bc_cred`). ⚠️ A tabela do PVA era `MEMORY` (veio vazia) — **temos que semear a nossa** do leiaute oficial / histórico do cliente.
- **VALIDA_IE (P3):** exige tabela dos **27 algoritmos de DV de IE por UF** + COD_MUN→UF.

### 7.3 Injetor (Fase 3-5 do blueprint) — SEGURADO
Não iniciar antes do validador maduro + de-para assinado. Escopo (v2): gerador C100/C170 (reuso Fiscal por
cópia), 0150/0190/0200 merge, 0500/COD_CTA, `recalcularBlocoM` (genérico por CST), `sanearCstPisCofins`,
`recalcularFechamentosContrib` (A/F/M/P + Bloco 9), costura ordem 0,A,C,D,F,M,P,1,9. Trava de transmissão
(2 níveis). Refazer o **golden** da CASA DA BEBIDA sob as regras corretas (o `_INJETADO.txt` atual está fiscalmente contaminado).

### 7.4 Frontend
`InjetorContribuicoesView.vue` (ou uma tela de validador): upload → lista de apontamentos → (injetor) preview → exportar. 1 rota nova. Registrar módulo `contribuicoes` no gating por plano ([[cockpit-hub]]).

---

## 8. Dependências de DADOS (checklist para o Esmael/contador)
- [ ] **De-para NCM→bucket** por cliente (do histórico: EFDs anteriores + ECD I050). Resolve NCM×monofásico e bebidas frias (Q1 do parecer).
- [ ] **Whitelist `cfop_credito`** (CFOPs que dão crédito + `nat_bc_cred`). Do leiaute oficial / histórico.
- [ ] **Tabela IE por UF** (27 algoritmos de dígito verificador) + COD_MUN→UF.
- [ ] **Regime contábil por empresa** (mantém ECD?) — condiciona COD_CTA (Q4 do parecer).
- [ ] Confirmações fiscais do parecer (Q1–Q5): bebidas frias, CST 04 vs 06, base c/ ou sem ICMS (RE 574.706), obrigatoriedade do 0500.

---

## 9. Descobertas importantes (não esquecer)
1. **Postos escrituram via `C175`, não `C170`** (venda por cupom → consolidação analítica por CST). O validador C170-only era quase cego ao público principal. C175 agora coberto.
2. **Base do PVA:** tabelas de referência são `ENGINE=MEMORY` (vazias no disco); só as `inconsistencia` (MyISAM) têm dado. A whitelist `cfop_credito` NÃO sai do dump.
3. **ID_CAMPO do PVA == índice do `split('|')`** — mapeamento de campos de graça.
4. O `_INJETADO.txt` (correção manual que "passou no PVA") está **fiscalmente errado** (subtributou vinho/licor 01→06; cerveja em 06 devia ser 04). "0 erro no PVA" ≠ correto.
5. Combustível/bebida fria = **monofásico**: revenda sem crédito, saída alíquota zero (CST 04). Vinho/destilado (2204-2208) = tributação normal.

---

## 10. Como continuar (roteiro test-first)
1. Seguir as regras **sem dep externa** (§7.1), uma a uma: RED (teste ancorado no dump/arquivo real ou sintético) → GREEN (mínimo) → commit.
2. Em paralelo, coletar as **deps de dados** (§8) com o contador.
3. Quando o de-para NCM e a whitelist chegarem: implementar NCM×monofásico e CFOP×crédito (P1).
4. Validador maduro + de-para assinado → **destravar o injetor** (Fase 3-5).
5. Frontend + gating por plano.

## 11. Como rodar/testar
- Testes (sem banco): `node backend/tests/contrib-{roundtrip,classificador,validador,validador-posto,validador-c175}.test.js`.
- Persistência (com banco local): `node backend/tests/contrib-persist.test.js`.
- Migração: `node backend/migrations/2026-07-18-efd-contrib.js`.
- Endpoints (backend up): `POST /api/contribuicoes/upload` (campo `contribfile`), `GET /api/contribuicoes/exportar/:id`.

## 12. Guardrails / riscos
- Validador é **read-only** (nunca corrige/gera). Injetor segurado.
- **Nunca** transmitir com COD_CTA placeholder; **nunca** creditar monofásico; **nunca** usar alíquota de ICMS.
- "0 erro no PVA" é necessário, não suficiente — exige materialidade por NCM revisada pelo contador.
- Fixtures reais e `mysql.zip` fora do git (dado sensível).
