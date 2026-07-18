# Catálogo de Regras do PVA — EFD-Contribuições (extraído da base oficial)

> **Origem:** base de dados MySQL do **PVA validador oficial** (fornecida pelo Esmael, `docs/mysql.zip`).
> As tabelas de **referência** (`cst_pis`, `cfop_credito`, `anp`…) são `ENGINE=MEMORY` — carregadas em
> runtime dos recursos do programa; **vazias no datadir frio** (dado não recuperável). O ouro estava nas
> tabelas **`inconsistencia`** (MyISAM) de **46 arquivos reais** processados: **1.118 apontamentos** →
> **19 regras distintas** (`ID_MENSAGEM`). Extração forense feita em container MariaDB descartável (VPS,
> já removido). Data: 2026-07-18.
>
> **Uso:** espinha dorsal do nosso **validador de EFD-Contribuições** (aterrado no que o PVA de fato
> aponta). Cruza com o parecer do painel PIS/COFINS ([[PARECER_FISCAL_CONTRIBUICOES.md]]).

## Estrutura de um apontamento (tabela `inconsistencia`)
`TIPO` (E=erro / A=advertência) · `ID_MENSAGEM` (id da regra) · `NOME_REGISTRO` · `ID_CAMPO` ·
`VALOR_CAMPO` (achado) · `VALOR_ESPERADO_CAMPO` (esperado) · `CONTEUDO_LINHA` · `NUMERO_LINHA` · `PARAMETROS_MENSAGEM`.

## As 19 regras (por frequência real)

| # | ID_MENSAGEM | Tipo | Registros | Campo (ex.) | Exemplo achado → esperado | Ocorr. | Arqs |
|---|---|---|---|---|---|---|---|
| 1 | **MSG_ALIQ_BASICA** | E | C175 | ALIQ_PIS | `0,6500` → **`1,65`** | 750 | 1 |
| 2 | **MSG_OBRIGATORIO_COD_CTA** | E | A170,C170,D501,D505,M400,M410,M800,M810 | COD_CTA | vazio → obrigatório | 201 | 7 |
| 3 | **MSG_COMPATIBILIDADE_CFOP_CRED** | A | C170 | CST_PIS | CST `50` incompatível c/ CFOP | 72 | 4 |
| 4 | **MSG_COMPATIBILIDADE_NCM_TRIB_MONO** | A | C170 | CST_PIS | CST `50` (crédito) em NCM **monofásico** | 30 | 1 |
| 5 | **MSG_PREENCHIMENTO_0900** | A | 0900 | — | demonstrativo 0900 | 25 | 25 |
| 6 | **MSG_OBRIGATORIO_M205_M605** | E | M200,M600 | — | falta M205/M605 (detalhe da contrib.) | 12 | 6 |
| 7 | **MSG_CONTRIBUICAO_NAO_DEVE_EXISTIR** | E | M210,M610 | REG | débito onde não deveria haver | 4 | 2 |
| 8 | **MSG_OPERACAO_DIREITO_CREDITO** | A | D501,D505 | CST_PIS | CST `99` × direito a crédito | 4 | 1 |
| 9 | **MSG_VL_BC_PIS_TOT_M105** | E | M105,M505 | VL_BC_PIS_TOT | `391322,47` → **`358506,95`** (soma) | 4 | 2 |
| 10 | **MSG_ALIQ_CREDITO_PRESUMIDO** | E | C170 | ALIQ_PIS | `0,0000` (crédito presumido) | 2 | 1 |
| 11 | **MSG_CALCULAR_CONTRIBUICAO** | E | M210,M610 | — | contribuição a calcular | 2 | 1 |
| 12 | **MSG_CALCULAR_CREDITO** | E | M100,M500 | — | crédito a calcular | 2 | 1 |
| 13 | **MSG_DETALHAR_BASE_CALC_CREDITO** | E | M105,M505 | — | detalhar base do crédito | 2 | 1 |
| 14 | **MSG_OBRIGATORIO_NUM_REC_ANTERIOR** | E | 0000 | NUM_REC_ANTERIOR | recibo anterior obrigatório | 2 | 2 |
| 15 | **MSG_REGISTRO_OBRIGATORIO** | E | M200,M600 | — | registro obrigatório ausente | 2 | 1 |
| 16 | **MSG_CAMPO_OBRIGATORIO** | E | 0100 | CPF | campo obrigatório vazio | 1 | 1 |
| 17 | **MSG_GERA_M410_M810** | A | M410 | — | deve gerar M410/M810 | 1 | 1 |
| 18 | **MSG_OBRIGATORIO_DESC_CRED** | E | M105 | DESC_CRED | descrição do crédito obrigatória | 1 | 1 |
| 19 | **MSG_VALIDA_IE** | E | 0150 | IE | IE inválida (`4585710`) | 1 | 1 |

## Leitura fiscal (cruzamento com o painel) — o que confirma
- **#4 `MSG_COMPATIBILIDADE_NCM_TRIB_MONO`**: o **próprio PVA rejeita crédito (CST 50) em NCM monofásico** → confirma o cerne do parecer (não creditar entrada de monofásico). É a regra que valida nosso classificador NCM→bucket.
- **#3 `MSG_COMPATIBILIDADE_CFOP_CRED`**: CFOP × direito a crédito → a tabela `cfop_credito` (com coluna `nat_bc_cred`) é a fonte.
- **#7 `MSG_CONTRIBUICAO_NAO_DEVE_EXISTIR`**: débito indevido (ex.: alíquota zero gerando contribuição) → nosso `BASE_INDEVIDA`/CST 04-06.
- **#2 `MSG_OBRIGATORIO_COD_CTA`**: 0500/COD_CTA → já mapeado (decisão #2 do parecer).
- **#1 `MSG_ALIQ_BASICA`** e **#10 `MSG_ALIQ_CREDITO_PRESUMIDO`**: alíquota correta (1,65/7,6; presumido) → nosso `CST_SEM_BASE` + regra de alíquota (nunca a de ICMS).
- **Bloco M (#6,#9,#11,#12,#13,#15,#17,#18)**: apuração/detalhamento — deferido ao "Gerar Apuração" (decisão #1), mas o validador deve **apontar** a ausência.

## Cobertura atual do nosso validador (v1) vs. o PVA
- ✅ já cobrimos (equivalente): `CST_SEM_BASE` ~ parte de #1/#10; `CREDITO_ENTRADA` ~ #4 (quando tivermos o de-para NCM); `BASE_INDEVIDA` ~ #7.
- ⬜ a implementar: #2 COD_CTA, #3 CFOP×crédito (via `cfop_credito`), #4 NCM×monofásico (via de-para NCM), #6/#9/#11-#13/#15/#17/#18 Bloco M, #14/#16/#19 obrigatórios/IE, #5 0900, #8 D501/D505.

## Fontes/artefatos
- Dump completo (1.118 apontamentos): `pva_inconsistencias.sql` (scratchpad; ~603 KB).
- Schema das 99 tabelas de referência: `pva_tabelas.sql` (útil p/ modelagem; ex.: `cfop_credito.nat_bc_cred`, `cst_pis(codigo,descricao,dt_ini,dt_fin)`).
- ⚠️ `docs/mysql.zip` (102 MB) **não deve ir pro git** (base de terceiro/RFB + peso). Manter fora do versionamento.
