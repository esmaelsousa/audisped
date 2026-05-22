# RELATÓRIO DE-PARA: PVA (LMC Exportado) vs BANCO DE DADOS (Audisped)

**Empresa:** POSTO PRECO BOM II - CNPJ: 14.018.702/0001-07
**Periodo:** Nov/2023 a Set/2024
**Data da auditoria:** 21/05/2026
**Fonte PVA:** PDFs exportados pelo PVA (pasta speds/LMC.zip)
**Fonte BD:** PostgreSQL audisped_db (tabelas lmc_movimentacao + arquivos SPED 1300/1310/1320)

---

## RESUMO EXECUTIVO

| Indicador | Resultado |
|-----------|-----------|
| Registros de encerrantes (bico) comparados | **1.230** |
| Encerrantes divergentes | **1.229 (99,9%)** |
| Vendas por bico: iguais | **658 (53%)** |
| Vendas por bico: divergentes | **572 (47%)** |
| Volume vendas PVA total | **1.452.981 L** |
| Volume vendas BD total | **4.872.032 L** |
| Diferenca vendas total | **-3.419.052 L** |
| Compras (vol_entr) SPED vs BD | **0 divergencias (100% igual)** |
| Saidas (vol_saidas) SPED vs BD | **0 divergencias (100% igual)** |
| Estoque (SPED 1300 vs LMC banco) | **0 divergencias (100% igual)** |
| Estoque continuidade BD entre meses | **OK** (exceto 08->09/2024) |

---

## 1. COMPRAS (ENTRADAS): SPED vs BD

**Resultado: CORRETO - 0 divergencias em 1.675 registros comparados.**

O banco de dados mantem **exatamente** os mesmos valores de compras (vol_entr) e saidas (vol_saidas) que constam nos arquivos SPED originais (registro 1300), dia a dia, produto a produto, em todos os 11 meses auditados.

| Mes | Registros | Compras | Saidas | Status |
|-----|-----------|---------|--------|--------|
| 11/2023 | 150 | OK | OK | CORRETO |
| 12/2023 | 155 | OK | OK | CORRETO |
| 01/2024 | 155 | OK | OK | CORRETO |
| 02/2024 | 145 | OK | OK | CORRETO |
| 03/2024 | 155 | OK | OK | CORRETO |
| 04/2024 | 150 | OK | OK | CORRETO |
| 05/2024 | 155 | OK | OK | CORRETO |
| 06/2024 | 150 | OK | OK | CORRETO |
| 07/2024 | 155 | OK | OK | CORRETO |
| 08/2024 | 155 | OK | OK | CORRETO |
| 09/2024 | 150 | OK | OK | CORRETO |

---

## 2. VENDAS POR BICO: PVA vs BD - DIA A DIA

**Resultado: 572 divergencias de 1.230 registros (47%).**

### 2.1 Resumo por mes

| Mes | Iguais | Divergentes | % Divergente |
|-----|--------|-------------|--------------|
| 11/2023 | 37 | 72 | 66% |
| 12/2023 | 47 | 71 | 60% |
| 01/2024 | 95 | 24 | 20% |
| 02/2024 | 88 | 18 | 17% |
| 03/2024 | 89 | 25 | 22% |
| 04/2024 | 74 | 33 | 31% |
| 05/2024 | 64 | 48 | 43% |
| 06/2024 | 56 | 55 | 50% |
| 07/2024 | 55 | 63 | 53% |
| 08/2024 | 53 | 52 | 50% |
| 09/2024 | 0 | 111 | 100% |

### 2.2 Resumo por bico

| Bico | Produto | Qtd Diverg | Total Vendas PVA | Total Vendas BD | Diferenca |
|------|---------|------------|------------------|-----------------|-----------|
| 1 | Gasolina Comum | 239 | 563.221 L | 2.587.841 L | **-2.024.620 L** |
| 2 | Gasolina Comum | 196 | 311.037 L | 1.714.607 L | **-1.403.570 L** |
| 3 | Etanol | 31 | 3.009 L | 1.013 L | +1.996 L |
| 4 | Etanol | 17 | 13.320 L | 12.563 L | +757 L |
| 5 | Gas. Aditivada | 15 | 11.760 L | 12.381 L | -622 L |
| 6 | Gasolina Comum | 41 | 62.290 L | 54.195 L | +8.095 L |
| 7 | Diesel S10 | 15 | 10.729 L | 12.184 L | -1.455 L |
| 8 | Diesel B S500 | 18 | 2.844 L | 2.472 L | +372 L |

### 2.3 Origem das divergencias de vendas

A analise dia a dia revela dois tipos distintos de divergencia:

**TIPO 1 - Vendas deslocadas entre dias (Bicos 1 e 2 - Gasolina Comum):**
Exemplo Bico 1, Jan/2024:

| Data | PVA Vendas | BD Vendas | Diferenca | Observacao |
|------|------------|-----------|-----------|------------|
| 01/01/2024 | 0,000 | 1.807,750 | -1.807,750 | BD tem vendas, PVA nao |
| 02/01/2024 | 6.860,918 | 1.408,800 | +5.452,118 | PVA acumulou vendas do dia anterior |

O PVA mostra venda ZERO no dia 01/01, mas o BD registra 1.807 L. No dia seguinte, o PVA "compensa" com vendas muito maiores. Isso indica que o sistema distribui as vendas de forma diferente entre os dias, especialmente quando ha mudanca de encerrante.

**TIPO 2 - Pequenos arredondamentos (Bicos 3-8):**
A partir de Fev/2024, as divergencias nos bicos 3-8 sao muito pequenas (centesimos de litro), causadas por arredondamento na conversao encerrante -> vendas.

Exemplo Bico 7 (Diesel S10), Dez/2023:

| Data | PVA Vendas | BD Vendas | Diferenca |
|------|------------|-----------|-----------|
| 05/12/2023 | 807,728 | 807,750 | -0,022 |
| 23/12/2023 | 626,615 | 626,620 | -0,005 |
| 31/12/2023 | 216,052 | 216,050 | +0,002 |

Porem, no dia 15/12/2023: PVA=22,479 vs BD=1.052,460 — divergencia de 1.030 L. Isso indica que em determinados dias o BD tem encerrantes que "pulam" (diferenca de offset entre dias).

---

## 3. ENCERRANTES: OFFSET POR BICO (PVA - BD)

O PVA mostra encerrantes **maiores** que o BD em Nov-Dez/2023. A partir de Jan/2024, o offset cai drasticamente.

| Bico | Produto | Offset Medio Nov-Dez/2023 | Offset Medio Jan-Set/2024 | Queda na virada |
|------|---------|---------------------------|---------------------------|-----------------|
| 1 | Gasolina Comum | **+2.234.248** | +440.905 | -1.793.343 |
| 2 | Gasolina Comum | **+2.407.624** | +333.731 | -2.073.893 |
| 3 | Etanol | **+284.431** | -3.509 | -287.940 |
| 4 | Etanol | **+681.380** | -8.622 | -690.002 |
| 5 | Gas. Aditivada | **+732.182** | -14.184 | -746.366 |
| 6 | Gasolina Comum | **+1.302.095** | +2.076 | -1.300.019 |
| 7 | Diesel S10 | **+320.974** | +1.836 | -319.138 |
| 8 | Diesel B S500 | **+388.701** | +574 | -388.127 |

### 3.1 Transicao 31/12/2023 -> 01/01/2024

| Bico | Produto | PVA Fech 31/12 | BD Fech 31/12 | Offset Dez | PVA Abert 01/01 | BD Abert 01/01 | Offset Jan |
|------|---------|----------------|---------------|------------|-----------------|----------------|------------|
| 1 | Gas. Comum | 3.777.881 | 1.544.643 | **+2.233.238** | 1.544.643 | 1.544.643 | **0** |
| 2 | Gas. Comum | 3.534.442 | 1.127.859 | **+2.406.583** | 1.127.859 | 1.127.859 | **0** |
| 3 | Etanol | 487.970 | 203.538 | **+284.431** | 203.538 | 203.538 | **0** |
| 4 | Etanol | 1.173.029 | 491.649 | **+681.380** | 493.049 | 493.049 | **~0** |
| 5 | Gas. Aditiv. | 1.290.873 | 557.519 | **+733.354** | 576.111 | 572.745 | **3.366** |
| 6 | Gas. Comum | 2.516.089 | 1.213.992 | **+1.302.097** | 1.213.992 | 1.213.992 | **0** |
| 7 | Diesel S10 | 775.158 | 454.350 | **+320.808** | 458.156 | 456.264 | **1.892** |
| 8 | Diesel S500 | 651.882 | 263.181 | **+388.701** | 263.865 | 263.865 | **~0** |

---

## 4. ESTOQUE: PVA vs BD

### 4.1 SPED 1300 vs LMC banco: IDENTICOS

Todos os campos de estoque (estq_abert, vol_entr, vol_disp, vol_saidas, estq_escr, val_perda, val_ganho, fech_fisico) sao **100% identicos** entre o arquivo SPED e a tabela lmc_movimentacao do banco, em todos os 1.675 registros dos 11 meses.

**Os dados de estoque, compras e saidas estao corretos no banco.**

### 4.2 Estoque PVA vs BD (Dez/2023 -> Jan/2024)

| Produto | PVA Fech 31/12 | BD Fech 31/12 | Diferenca | PVA Abert 01/01 | BD Abert 01/01 | Diferenca |
|---------|----------------|---------------|-----------|-----------------|----------------|-----------|
| Etanol | 5.208,945 | 5.016,528 | **+192** | 5.016,528 | 5.016,528 | **0** |
| Diesel S10 | 9.403,502 | 6.487,763 | **+2.916** | 6.487,763 | 6.487,763 | **0** |
| Gas. Aditivada | 8.596,241 | 13.812,305 | **-5.216** | 7.420,676 | 13.812,305 | **-6.392** |
| Gas. Comum | 39.563,298 | 25.708,597 | **+13.855** | 14.825,345 | 25.708,597 | **-10.883** |

**Nota:** O estoque do PVA (PDF) foi extraido de forma nao totalmente confiavel devido a quebras de pagina no PDF. Os valores de Gas. Aditivada e Gas. Comum podem estar incorretos na extracao do PVA. Os valores do BD (SPED 1300 = LMC) sao confiaveis.

### 4.3 Continuidade de estoque no BD

Perfeita em todas as transicoes exceto 08->09/2024:

| Produto | BD Fech 31/08 | BD Abert 01/09 | Diferenca |
|---------|---------------|----------------|-----------|
| Etanol | 3.411,759 | 3.370,102 | -41,657 |
| Diesel S10 | 5.402,332 | 5.330,431 | -71,901 |
| Gas. Aditivada | 787,739 | 763,515 | -24,224 |
| Diesel B S500 | 3.644,121 | 3.621,747 | -22,374 |
| Gas. Comum | 14.854,895 | 14.699,685 | -155,210 |

---

## 5. VEREDITO FINAL

| Item | Resultado | Detalhe |
|------|-----------|---------|
| Compras (entradas) | **CORRETO** | 0 divergencias em 1.675 registros. BD = SPED original. |
| Saidas (vol_saidas) | **CORRETO** | 0 divergencias. BD preserva valores originais. |
| Estoque (abert/fech) | **CORRETO** | BD = SPED original. Continuidade OK (exceto 08->09/2024). |
| Vendas por bico | **DIVERGENTE** | 572 de 1.230 registros (47%). Diferenca total: -3.419.052 L |
| Encerrantes | **DIVERGENTE** | 1.229 de 1.230 registros (99,9%). Offsets de ate 2,4 milhoes L |

### O que esta correto no sistema:
- Compras, saidas e estoque sao preservados fielmente do SPED original
- A continuidade de estoque entre meses e mantida (exceto uma transicao)

### O que esta errado no sistema:
- **Encerrantes (1320):** Os valores sao completamente diferentes dos originais. O sistema recalculou/substituiu os encerrantes, especialmente em Nov-Dez/2023.
- **Vendas por bico:** Como consequencia dos encerrantes errados, as vendas calculadas (enc_final - enc_inicial) tambem divergem. A divergencia e mais grave nos bicos 1 e 2 (Gasolina Comum) e em Nov-Dez/2023.

### Causa raiz:
Os arquivos SPED armazenados no banco foram **reimportados ou regenerados** em algum momento, usando encerrantes de base diferentes dos originais. O SPED que foi para o PVA (original) tinha encerrantes acumulados desde a instalacao das bombas. O SPED no banco tem encerrantes "resetados" a partir de uma base menor, provavelmente de uma retificacao ou reimportacao posterior.

### Acoes recomendadas:
1. Investigar quando e por que os SPEDs foram reimportados no banco
2. Corrigir a logica de exportacao dos encerrantes (registro 1320) para preservar valores originais
3. Verificar a quebra de estoque na transicao 08->09/2024
4. Priorizar correcao dos bicos 4, 5, 7, 8 que mantem offsets crescentes mesmo apos Jan/2024

---

*Relatorio gerado pelo sistema Audisped - Auditoria DE-PARA automatizada.*
