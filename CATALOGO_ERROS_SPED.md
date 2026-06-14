# Catálogo de Erros SPED Fiscal (EFD ICMS/IPI) — Postos de Combustível

> **Status:** Referência viva | **Data:** 2026-06-14
> **Origem:** orquestração de agentes (estrutura, apuração, combustíveis, PVA, benchmark E-Auditoria) + reconciliação com o código atual do Audisped.
> **Companheiro:** [PLANO_CORRECAO_ERROS_SPED.md](PLANO_CORRECAO_ERROS_SPED.md)

## Legenda
- **Severidade:** `BLOQ` = PVA rejeita (não assina/transmite) · `ADV` = advertência (transmite, mas risco de autuação).
- **Status no Audisped:** ✅ já implementado · 🟡 parcial / só em um fluxo · 🔴 a implementar.
- **Detecção** descreve como achar no `.txt` pipe-delimitado (`f[n]` = posição no split de `|`).

> **Nota de prioridade:** o eixo é **Severidade + recorrência em postos**, não "fiscal vs estrutura". Os `BLOQ` recorrentes vêm primeiro (cliente não consegue transmitir).

---

## Bloco 0 — Abertura e Cadastros

| ID | Reg | Erro | Detecção | Sev | Status | Obs/Correção |
|----|-----|------|----------|-----|--------|--------------|
| EST-0000-01 | 0000 | COD_VER incompatível com o período | `f[2]` vs faixa de vigência da DT_INI | BLOQ | 🟡 | Export transmuta 019→020 p/ 2026; falta tabela versão×competência genérica |
| EST-0000-02 | 0000 | Nº de campos do 0000 ≠ leiaute da versão | `split('|').length` vs esperado por COD_VER | BLOQ | 🔴 | |
| EST-0000-03 | 0000 | DT_INI/DT_FIN inválidas ou não cobrem 1 mês | validar datas; DT_FIN = último dia | BLOQ | 🔴 | |
| EST-0000-04 | 0000 | CNPJ do informante com DV inválido | módulo 11 dos 14 díg. | BLOQ | 🔴 | hoje só compara CNPJ da chave (posicional) |
| EST-0000-05 | 0000 | IE inválida para a UF | algoritmo de IE por UF | BLOQ | 🔴 | |
| EST-0000-06 | 0000 | COD_MUN inexistente na tabela IBGE (7 díg.) | 2 primeiros = UF; existir no IBGE | BLOQ | 🔴 | precisa tabela IBGE |
| CAD-0150-01 | 0150 | CNPJ **e** CPF preenchidos (ou ambos vazios p/ nacional) | exatamente um de `f[5]`/`f[6]` | BLOQ | 🔴 | |
| CAD-0150-02 | 0150 | CNPJ/CPF do participante com DV inválido | módulo 11 | BLOQ | 🔴 | |
| CAD-0150-03 | 0150 | IE do participante inválida p/ UF | IE×UF (ignorar ISENTO) | BLOQ | 🔴 | fornecedor "Desconhecido" pós-injeção é correlato |
| CAD-0150-07 | 0150 | Participante referenciado (C100/D100) **sem 0150** | COD_PART usado ∉ 0150 | BLOQ | ✅ | CRIT-C100-01 (`/api/analisar`) + injeção cria 0150 |
| CAD-0190-01 | 0190 | Unidade usada (0200/0220/C170/H010) não cadastrada | UNID ∉ conjunto 0190 | BLOQ | 🔴 | |
| CAD-0200-01 | 0200 | COD_ITEM duplicado | agrupar 0200 por `f[2]` | BLOQ | 🔴 | |
| CAD-0200-02 | 0200 | COD_ITEM referenciado sem 0200 | coletar usos vs 0200 | BLOQ | 🟡 | export preserva itens referenciados; falta detecção no analisador |
| CAD-0200-03 | 0200 | NCM ausente p/ mercadoria (combustível exige) | TIPO_ITEM ∉ {07..10,99} → NCM 8 díg. | BLOQ | ✅ | detecção em `analisar-sintaxe` (NCM < 8 díg.) |
| CAD-0200-04 | 0200 | NCM inexistente na TIPI | 8 díg. + existir na tabela | BLOQ | 🔴 | precisa tabela NCM |
| CAD-0200-06 | 0200 | CEST ausente/ inválido (7 díg.) p/ item ST | combustível tem CEST | BLOQ | 🔴 | precisa tabela CEST |
| CAD-0206-01 | 0206 | Combustível **sem 0206** (cód. ANP) | 0200 combustível sem filho 0206 | BLOQ | 🔴 | |
| CAD-0206-02 | 0206 | COD_PROD_ANP inexistente na tabela ANP (9 díg.) | validar contra tabela ANP vigente | BLOQ | 🔴 | precisa tabela ANP |
| CAD-0220-01 | 0220 | Nº de campos ≠ 3 (pipe sobrando) | `split` ≠ 5 | BLOQ | ✅ | `normalizarLinha` no export (fix recorrente) |
| CAD-0220-02 | 0220 | UNID_CONV não declarada no 0190 | UNID ∉ 0190 | BLOQ | 🔴 | |
| CAD-0221-01 | 0221 | COD_ITEM_ATOMICO órfão / mal-posicionado | 0221 sem 0200 pai TIPO 00 único | BLOQ | ✅ | `realocar0221` no export |

---

## Bloco C — Documentos Fiscais (NF-e / NFC-e)

| ID | Reg | Erro | Detecção | Sev | Status | Obs/Correção |
|----|-----|------|----------|-----|--------|--------------|
| DOC-C100-02 | C100 | CHV_NFE com **DV (44º díg.) inválido** | módulo 11 sobre 43 díg. | BLOQ | 🔴 | hoje só compara CNPJ posicional, não o DV |
| DOC-C100-04 | C100 | CNPJ/UF embutidos na chave ≠ emitente | `chave[6:20]`=CNPJ; `chave[0:2]`=cUF | BLOQ | ✅ | `analisar-sintaxe` (entradas, ind_emit=0) |
| DOC-C100-03 | C100 | Modelo da chave (pos.21-22) ≠ COD_MOD | substring vs `f[5]` | BLOQ | 🔴 | |
| DOC-C100-08 | C100 | Doc cancelado/denegado (COD_SIT 02-05) com valores/filhos | COD_SIT ∈{02..05} → zerar, sem C170/C190 | BLOQ | 🟡 | conciliação ignora canceladas; falta validar no SPED |
| DOC-C100-11 | C100 | VL_DOC ≠ soma itens + acessórios − desc. | comparar `f[12]` | ADV | 🔴 | |
| DOC-C100-12 | C100 | **Σ VL_BC_ICMS/VL_ICMS dos C190 ≠ C100** | somar C190 vs `f[22]/f[23]` etc. | BLOQ | 🟡 | detecta "C100 vs C190 valor divergente" (vl_opr) e "C100 sem C190"; falta BC/ICMS/ST |
| DOC-C100-15 | C100 | C100 **duplicado** (mesma chave) | agrupar por chave | BLOQ | ✅ | dedup C100 no export + injeção idempotente |
| DOC-C100-14 | C100 | IND_OPER incompatível com CFOP dos itens | 1º díg. CFOP vs `f[1]` | BLOQ | 🟡 | RTAX-C170-01 cobre parte (saída) |
| DOC-C170-01 | C170 | COD_ITEM não existe no 0200 | item ∉ 0200 | BLOQ | 🟡 | export preserva; falta detecção explícita |
| DOC-C170-03 | C170 | **CFOP inexistente** (1405, 1655…) | `f[11]` ∉ tabela CFOP | BLOQ | ✅ | `CFOP_ENTRADA_CORRIGIR` no export (1655→1652 etc.) |
| DOC-C170-04 / C190-01 | C170/C190 | **Combinação CST×CFOP×ALIQ** do C190 sem respaldo nos C170 | validar trinca C170↔C190 | BLOQ | 🟡 | correções de origem feitas; **C190 não é recalculado do C170 no export** (raiz do problema) |
| DOC-C170-05 | C170 | CST 61 em competência anterior à vigência monofásico | período < 2023-05/06 e CST x61 | BLOQ | ✅ | `_cst61to60` no export |
| DOC-C170-07 | C170 | VL_ITEM = 0 indevido (COD_SIT ∉ 06/07) | `f[7]`=0 | BLOQ | 🔴 | |
| DOC-C190-02 | C190 | **C190 duplicado** (mesma CST/CFOP/ALIQ na NF) | agrupar e fundir | BLOQ | 🟡 | fusão feita p/ x90 e 61→60; falta caso geral |
| DOC-C1xx | C113/C116 | Doc referenciado com chave/CNPJ divergente | validar referência | BLOQ | 🔴 | |

---

## Bloco D — CT-e (frete de combustível)

| ID | Reg | Erro | Detecção | Sev | Status | Obs |
|----|-----|------|----------|-----|--------|-----|
| DOC-D100-01 | D100 | CHV_CTE sem 44 díg./DV inválido/modelo ≠57,67 | regex + DV + `chave[20:22]` | BLOQ | 🔴 | |
| DOC-D100-06 | D100 | Σ VL_BC_ICMS/VL_ICMS dos D190 ≠ D100 | somar filhos vs mestre | BLOQ | 🔴 | |
| DOC-D100-08 | D100 | D100 duplicado (mesma chave) | agrupar por CHV_CTE | BLOQ | ✅ | dedup D100 no export |
| DOC-D190-02 | D190 | D190 duplicado / órfão | trinca + pai imediato | BLOQ | 🔴 | |

---

## Bloco E — Apuração ICMS / ST / IPI

| ID | Reg | Erro | Detecção | Sev | Status | Obs |
|----|-----|------|----------|-----|--------|-----|
| AP-E110-03 | E110 | VL_TOT_DEBITOS ≠ Σ VL_ICMS C190/C590 saída | somar CFOP 5/6 | BLOQ | 🟡 | `recalcularE110` existe; export **não** recalcula E110 (decisão atual) |
| AP-E110-05 | E110 | Crédito ICMS indevido sobre combustível CST 60/61 | f[6]>0 com NCM 2710/2711/2207 ST | BLOQ(fiscal) | 🟡 | `flag_bloqueia_credito_st` na injeção; falta validar no analisador |
| AP-E110-10 / E116-01 | E110/E116 | **E116 ausente havendo ICMS a recolher** | f[13]>0 e 0 E116 | BLOQ | 🔴 | recorrente (APACHE/LUBRIGEGEU); **adiado** — exige COD_REC/DARE BA + vencimento |
| AP-E116-02 | E116 | Σ VL_OR dos E116 ≠ E110 (f13+f15) | somar f[3] dos E116 | BLOQ | 🔴 | |
| AP-E111-01/02 | E111 | COD_AJ_APUR inválido / 3º char ≠ 0 (próprio) | tabela 5.1.1 da UF | BLOQ | 🔴 | |
| AP-E210-02 | E210 | VL_RETENCAO_ST ≠ Σ VL_ICMS_ST dos C190 saída | somar com filtro COD_SIT | BLOQ | ✅ | recalculado no export (~server.js 8259) |
| AP-E210-03 | E210 | **Crédito ST inflado** (ST de entrada CST 60 não some) | f[4]/f[5]/f[6] sem respaldo | BLOQ(fiscal) | 🔴 | **gap conhecido — Plano ICMS Tributário Fase 3** |
| AP-E210-05 | E210 | VL_SLD_CRED_ST_TRANSPORTAR fora de fórmula | aplicar fórmula do campo 14 | BLOQ | 🔴 | bug "ST a transportar = 0" |
| AP-E250-02 | E250 | Σ VL_OR E250 ≠ E210 (f13+f15) | somar | BLOQ | 🔴 | |
| AP-E500-01 | E500 | Bloco IPI presente em não-contribuinte (posto) | existir E500+ | BLOQ | 🔴 | posto não apura IPI |

---

## Bloco 1 — Combustíveis / LMC

| ID | Reg | Erro | Detecção | Sev | Status | Obs |
|----|-----|------|----------|-----|--------|-----|
| COMB-1300-03 | 1300 | FECH ≠ ESCR − PERDA + GANHO | fórmula campo 11 | BLOQ | ✅ | `enforcarCoerencia1300` no export |
| COMB-1300-04 | 1300 | Volume negativo | qualquer campo < 0 | BLOQ | ✅ | CRIT-1310-04 (escr/fisico negativo) |
| COMB-1300-09 | 1300 | Continuidade dia-a-dia (FECH dia D ≠ ABERT D+1) | encadear por produto | ADV/BLOQ-fisco | ✅ | CRIT-1300-01/02 |
| COMB-1300-10 | 1300 | GNV lançado no 1300 | COD_ITEM = GNV | ADV | 🔴 | Guia: GNV não entra no LMC |
| COMB-1310-01 | 1310 | **CAP_TANQUE ausente a partir de 01/2026** | comp≥2026-01 e f[11] vazio | BLOQ | ✅ | preenche/aborta no export (2026) |
| COMB-1310-03 | 1310 | Σ FECH dos 1310 ≠ FECH do 1300 | somar filhos | BLOQ | 🟡 | coerência tratada; falta validação cruzada explícita |
| COMB-1310-07 | 1310 | Estoque físico > capacidade do tanque | f[11] < f[10] | ADV | ✅ | CRIT-1310-01 |
| COMB-1310-02 | 1310 | Nº de campos ≠ leiaute do período | 10 (≤2025) / 11 (≥2026) | BLOQ | 🟡 | CAP tratado; falta validar contagem ≤2025 |
| COMB-1320-01 | 1320 | VOL_VENDAS ≠ FECHA − ABERT − AFERI | fórmula | BLOQ | ✅ | CRIT-1320-01/02/03 |
| COMB-1320-02 | 1320 | Encerrante "anda para trás" sem virada de contador | FECHA<ABERT sem par zero | BLOQ | 🟡 | detecta volume negativo; falta tratar virada |
| COMB-1320-03 | 1320 | Ruptura de continuidade de encerrante entre meses | FECHA(N) ≠ ABERT(N+1) por bico | ADV/fisco | ✅ | validações-1320 |
| COMB-1320-05 | 1320 | Σ VOL_VENDAS bicos ≠ VOL_SAIDAS do 1310 | somar | BLOQ | ✅ | divergência 1320 vs 1300 |
| COMB-CST-01 | C170/C190 | CST 61 antes da vigência | ver DOC-C170-05 | BLOQ | ✅ | `_cst61to60` |
| COMB-CST-05 | C170/C190 | Uso/consumo (CFOP 1407/1556…) sem CST x90 | CFOP uso/consumo + CST≠x90 | BLOQ | ✅ | `normalizarUsoConsumoCst90` |
| COMB-PC-01 | C170 | Combustível CST 60/61 sem PIS/COFINS 04 | CST ICMS∈{60,61} e PIS/COFINS≠04 | ADV | ✅ | regra prio-10 do `regrasFiscaisService` |

---

## Bloco H — Inventário

| ID | Reg | Erro | Detecção | Sev | Status | Obs |
|----|-----|------|----------|-----|--------|-----|
| COMB-H010-01 | H010 | Inventário 31/12 ausente na EFD de **fevereiro** | comp=fev sem bloco H | BLOQ | 🔴 | regra de competência |
| COMB-H010-03 | H010 | QTD/VL_ITEM zerado/negativo | ≤ 0 | BLOQ | 🟡 | cruza H010×1300 em `analisar-sintaxe` |
| H010×1300 | H010 | Estoque H010 ≠ fechamento físico do 1300 | tolerância 0,5 | BLOQ | ✅ | `analisar-sintaxe` |

---

## Bloco 9 — Contadores e integridade estrutural

| ID | Reg | Erro | Detecção | Sev | Status | Obs |
|----|-----|------|----------|-----|--------|-----|
| EST-X990-01 | X990 | Fechamento de bloco ≠ nº de linhas | contar por bloco | BLOQ | ✅ | recálculo de TODOS os X990 no export (fix recorrente) |
| EST-9900-01 | 9900 | REG×QTD incorreto | contar por registro | BLOQ | ✅ | recomputado no export |
| EST-9999-01 | 9999 | Total de linhas ≠ arquivo | contar tudo | BLOQ | ✅ | recomputado no export |
| EST-HIER-01 | todos | Registro órfão (filho sem pai) | validar hierarquia | BLOQ | 🟡 | casos pontuais (0205/0221); falta validador geral |
| EST-CAMPO-01 | todos | Nº de campos ≠ leiaute (genérico) | `split.length` por registro×versão | BLOQ | 🟡 | só 0220 hoje; **generalizar** é alto valor |
| EST-DEC-01 | todos | Separador decimal `.` em vez de `,` / não-numérico | regex em campos de valor | BLOQ | 🔴 | |
| EST-PIPE-01 | todos | Caractere `|` dentro de conteúdo de campo | detectar campo extra | BLOQ | 🔴 | causa clássica de "nº de campos" |

---

## Cruzamentos externos — o que o PVA **NÃO** valida (maior valor de auditoria)

| ID | Cruzamento | Descrição | Sev (risco) | Status | Obs |
|----|-----------|-----------|-------------|--------|-----|
| CRUZ-SEFAZ-01 | EFD × NF-e SEFAZ | Nota destinada na SEFAZ **não escriturada** (omissão) | Alto (autuação) | ✅ | conciliação CSV + MDe/EspiãoNFe |
| CRUZ-SEFAZ-02 | EFD × SEFAZ | Nota escriturada **cancelada/denegada** na SEFAZ | Alto | 🟡 | conciliação trata canceladas do CSV; falta consultar status na SEFAZ por chave (modelo CheckSped) |
| CRUZ-SEFAZ-03 | EFD × XML | Valor/CFOP escriturado ≠ XML real | Médio | 🟡 | divergência de valor na conciliação; falta comparar item a item com XML |
| CRUZ-CONTRIB-01 | EFD ICMS × EFD-Contribuições | Doc/valor/item divergente entre as duas EFDs; PIS/COFINS 04 | Médio | 🔴 | PLANO_CONTRIBUICOES (pendente) |
| CRUZ-GIA-01 | EFD × GIA-ST / apuração estadual | ST/ressarcimento × E210; saldo ST | Alto (posto) | 🔴 | núcleo fiscal do posto |
| CRUZ-MERITO-01 | Mérito fiscal | CST/CFOP "válido" no PVA mas materialmente errado | Médio | 🟡 | regras de combustível cobrem parte |

---

## Top prioridades (BLOQUEANTE + recorrência em postos) — o que falta

1. **Generalizar "nº de campos ≠ leiaute" (EST-CAMPO-01)** por registro×versão — hoje só 0220. Pega uma classe inteira de rejeições.
2. **DV da chave NF-e/CT-e e DV de CNPJ/CPF (DOC-C100-02, EST-0000-04)** — validação barata, erro caro.
3. **E116 a partir do E110 (AP-E116-01)** e **E250 a partir do E210** — rejeição recorrente; exige COD_REC/vencimento por UF.
4. **Crédito de ST/ICMS indevido sobre combustível (AP-E210-03, AP-E110-05)** — gap fiscal real (Plano ICMS Fase 3).
5. **C190 recalculado a partir do C170 no export** — elimina a raiz dos erros "combinação CST/CFOP/ALIQ".
6. **Tabelas versionadas (CFOP/CST/NCM/CEST/ANP/IBGE/IE)** por competência — base p/ EST-0000-06, CAD-0200-04/06, CAD-0206-02.
7. **Status SEFAZ por chave (CRUZ-SEFAZ-02)** estilo CheckSped — cancelada/denegada/não encontrada.

> Itens marcados **(confirmar)** nos relatórios dos agentes (numeração de campos por COD_VER; lista fechada de CFOPs de entrada de combustível; vigência exata de CST 61 por produto) devem ser checados contra a tabela/Guia da competência antes de virar regra BLOQUEANTE.
