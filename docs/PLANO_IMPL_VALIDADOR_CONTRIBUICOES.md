# Plano de Implementação — Validador EFD-Contribuições (consolidado)

> Consolida as 4 specs por grupo (produzidas por agentes forenses sobre as **19 regras do PVA
> oficial**, ver [[CATALOGO_REGRAS_PVA_CONTRIBUICOES.md]]) num roteiro único de código.
> Specs detalhadas: `docs/ESPEC_VALIDADOR_BLOCO_M_CONTRIBUICOES.md`,
> `docs/ESPEC_VALIDADOR_CONTRIB_GRUPO_CST_CREDITO.md`,
> `docs/SPEC_VALIDADOR_CONTRIB_GRUPO_ALIQUOTA_BASE.md`, + grupo Estrutura (inline no catálogo).
> Alvo: `backend/services/contribuicoes/validadorContribuicoes.js` (read-only; **aponta, não corrige**).
> Data: 2026-07-18.

## 0. Descoberta que simplifica tudo
O `ID_CAMPO` do PVA (ex. `"37 - COD_CTA"`) **É o índice de `raw.split('|')`**. Então cada campo já
vem mapeado pela própria base. Confirmado byte-a-byte no dump real.

## 1. Pré-requisitos compartilhados (refatorar o loop ANTES das regras)
O v1 só itera `C170` e checa 3 coisas. Precisa evoluir para um **motor de varredura** que:
1. **Indexa o Bloco 0 antes do loop:** `map0200[COD_ITEM] = NCM` (NCM **não está no C170**, só `COD_ITEM` f3); guardar também `0000` (regime via 0110, TIPO_ESCRIT), `0500` presente?, `0100`/`0150`.
2. **Rastreia contexto** do `C100` (IND_OPER 0/1) para os C170/C175 filhos.
3. **Trata múltiplos registros por posição** (dicionário `POS[reg][campo]`), não só C170: C170, **C175** (índices próprios!), **D501/D505**, e os **M100/M105/M200/M210/M400/M410** (+ espelhos COFINS M5xx/M6xx/M8xx).
4. **É regime-aware** (0110): alíquota básica = 1,65/7,6 (não-cumulativo) vs 0,65/3,0 (cumulativo).
5. **Números:** helper `num()` (vírgula→ponto), comparação **em centavos inteiros** p/ somas; `VL = HALF-UP(BC×ALIQ, 2)`; `BC = VL_ITEM − VL_DESC`.
6. **Nunca** usar a alíquota de ICMS (C170 f14) como alíquota de PIS/COFINS.
7. **Guard-rails:** pular regras de Bloco M se não houver bloco M com movimento; COD_CTA condicional ao regime contábil (livro-caixa → não obrigatório).

## 2. As 19 regras — tabela mestra (prioridade de implementação)

| Prio | Regra (nossa) | PVA ID_MENSAGEM | Reg | Campo(s) (split) | Gatilho | Sev | v1 |
|---|---|---|---|---|---|---|---|
| **P1** | credito_ncm_monofasico | MSG_COMPATIBILIDADE_NCM_TRIB_MONO | C170 | f25/f31 CST; NCM via 0200 | entrada CST 50-56 em NCM monofásico (bucket) | A | parcial |
| **P1** | credito_cfop_incompativel | MSG_COMPATIBILIDADE_CFOP_CRED | C170 | f11 CFOP, f25 CST | CST 50-56 em CFOP fora da whitelist creditável | A | não |
| **P1** | cod_cta_obrigatorio | MSG_OBRIGATORIO_COD_CTA | A170,C170,D501,D505,M400/410/800/810 | 17/37/11/4 | campo vazio (se há escrit. contábil) | E | não |
| **P1** | aliquota_basica | MSG_ALIQ_BASICA | C175,C170 | C175 f7/f13; C170 f27/f33 | ALIQ ≠ básica do regime (0110) | E | não |
| **P2** | aliq_credito_presumido | MSG_ALIQ_CREDITO_PRESUMIDO | C170 | f25/f31 CST, f27/f33 ALIQ | CST 60-66 com ALIQ 0,0000 | E | não |
| **P2** | num_rec_anterior | MSG_OBRIGATORIO_NUM_REC_ANTERIOR | 0000 | f3 TIPO_ESCRIT, f5 | retificadora (f3='1') e f5 vazio | E | não |
| **P2** | m205_m605_obrigatorio | MSG_OBRIGATORIO_M205_M605 | M200/M600 | — | M200/M600 sem M205/M605 | E | não |
| **P2** | contribuicao_indevida | MSG_CONTRIBUICAO_NAO_DEVE_EXISTIR | M210/M610 | — | débito onde não deveria | E | não |
| **P2** | vl_bc_tot_m105 | MSG_VL_BC_PIS_TOT_M105 | M105/M505 | f4 VL_BC_TOT | total ≠ Σ bases creditáveis | E | não |
| **P3** | cst_sem_base / base_indevida | (coerência CST×base) | C170,**C175** | CST/BC/ALIQ/VL | CST 01-05/50-56 sem base; 04/06-09/70-75 com valor | E | **parcial** (falta C175 + aritmética) |
| **P3** | direito_credito_D | MSG_OPERACAO_DIREITO_CREDITO | D501/D505 | f2 CST | CST 98/99 onde caberia crédito | A | não |
| **P3** | campo_obrigatorio | MSG_CAMPO_OBRIGATORIO | 0100 | f3 CPF | vazio | E | não |
| **P3** | valida_ie | MSG_VALIDA_IE | 0150 | f7 IE, f8 COD_MUN | DV inválido p/ UF | E | não |
| **P3** | calcular_contribuicao | MSG_CALCULAR_CONTRIBUICAO | M210/M610 | f4 BC, f8 ALIQ, f11 APUR | BC>0 & APUR=0 & ALIQ>0 | E | não |
| **P3** | calcular_credito | MSG_CALCULAR_CREDITO | M100/M500 | f4 BC, f5 ALIQ, f8 VL | crédito a calcular | E | não |
| **P3** | detalhar_base_credito | MSG_DETALHAR_BASE_CALC_CREDITO | M105/M505 | — | falta detalhamento | E | não |
| **P4** | desc_cred_obrigatorio | MSG_OBRIGATORIO_DESC_CRED | M105 | f10 DESC_CRED | vazio | E | não |
| **P4** | registro_m_obrigatorio | MSG_REGISTRO_OBRIGATORIO | M200/M600 | — | ausente | E | não |
| **P4** | gera_m410 | MSG_GERA_M410_M810 | M410 | — | deve gerar | A | não |
| **P4** | preenchimento_0900 | MSG_PREENCHIMENTO_0900 | 0900 | — | registro ausente | A | não |

## 3. Fases de entrega (test-first, gate = arquivo real CASA DA BEBIDA)
- **F2.1 — motor de varredura** (pré-requisitos §1): index 0200/0000/0500, contexto C100, `POS[reg]`, `num()`, regime. Manter os 3 checks do v1 passando.
- **F2.2 — P1** (as 4 de maior impacto: NCM-mono, CFOP-cred, COD_CTA, ALIQ_BASICA). Aqui entra a dependência de **dados** (§4).
- **F2.3 — P2/P3** (crédito presumido, Bloco M núcleo, C175, D501/D505, obrigatórios).
- **F2.4 — P4** (advertências residuais).
Cada regra: teste ancorado no `pva_inconsistencias.sql` (o PVA já nos deu o gabarito: linha real + achado→esperado).

## 4. Dependências de DADOS (o que falta, além de código)
1. **Whitelist `cfop_credito`** (`codigo`, `nat_bc_cred`, `dt_ini/dt_fin`) — a tabela do PVA é MEMORY (veio vazia). **Semear a nossa** (do leiaute oficial / histórico do cliente). Bloqueia `credito_cfop_incompativel`.
2. **De-para NCM→bucket** (classificadorFiscal) — hoje só o incontestável; bebidas frias INDEFINIDO. Contador confirma. Bloqueia parte de `credito_ncm_monofasico`.
3. **Tabela de validação de IE por UF** (27 algoritmos módulo-11) + COD_MUN→UF. Bloqueia `valida_ie`.
4. **Regime contábil por empresa** (mantém ECD?) — condiciona `cod_cta_obrigatorio` (parecer Q4).

## 5. Alinhamento com o parecer/painel
Tudo **read-only** (aponta, não gera). O gabarito é o **PVA oficial** (19 regras) + o **parecer legal** (materialidade por NCM). Critério de aceite = detectar os mesmos apontamentos que o PVA gerou nos 46 arquivos reais, **e** não gerar falso-positivo onde o PVA não apontou.
