# RELATÓRIO DE AUDITORIA - POSTO PRECO BOM II
**CNPJ:** 14.018.702/0001-07
**Razão Social:** MARCOS AURELIO ARAUJO DOS SANTOS
**Período auditado:** Nov/2023 a Set/2024
**Fonte dos dados:** PDFs do LMC exportados pelo PVA (pasta speds/LMC.zip)
**Data da auditoria:** 21/05/2026

---

## 1. RESUMO EXECUTIVO

A auditoria dos arquivos LMC exportados pelo PVA do SPED Fiscal revelou **irregularidades graves e sistemáticas** nos encerrantes das bombas de combustível da empresa POSTO PRECO BOM II.

### Achados principais:
| Indicador | Resultado |
|---|---|
| Divergências de encerrantes entre meses | **45 ocorrências** |
| Quebras de continuidade dia-a-dia | **164 ocorrências** |
| Maior divergência (12/2023 → 01/2024) | **-8.326.110 litros** (soma de todos os bicos) |
| Bicos afetados sistematicamente | 4, 5, 7 e 8 (todos os meses) |
| Bicos afetados pontualmente | 1, 2, 3 e 6 (apenas na virada 12/2023 → 01/2024) |

---

## 2. AUDITORIA DE ENCERRANTES - CONTINUIDADE ENTRE MESES

A regra fiscal exige que o **encerrante de abertura** de um mês seja **igual ao encerrante de fechamento** do mês anterior. Qualquer diferença indica manipulação, troca de bomba ou erro de escrituração.

### 2.1 Transição 12/2023 → 01/2024 (CRÍTICA)

**TODOS os 8 bicos apresentaram divergência massiva**, com quedas de centenas de milhares a milhões de litros:

| Bico | Produto | Fech 31/12/2023 | Abert 01/01/2024 | Diferença |
|---|---|---|---|---|
| 1 | Gasolina Comum | 3.777.881,151 | 1.544.642,840 | **-2.233.238,311** |
| 2 | Gasolina Comum | 3.534.441,901 | 1.127.858,930 | **-2.406.582,971** |
| 3 | Etanol | 487.969,569 | 203.538,110 | **-284.431,459** |
| 4 | Etanol | 1.173.028,644 | 493.049,372 | **-679.979,272** |
| 5 | Gas. Aditivada | 1.290.872,558 | 576.111,029 | **-714.761,529** |
| 6 | Gasolina Comum | 2.516.088,844 | 1.213.991,580 | **-1.302.097,264** |
| 7 | Diesel S10 | 775.158,464 | 458.156,270 | **-317.002,194** |
| 8 | Diesel B S500 | 651.882,015 | 263.865,246 | **-388.016,769** |

**Observação:** Os valores que constam na consulta do usuário (Fech 31/12/2023 e Abert 01/01/2024) foram **CONFIRMADOS** nos PDFs do PVA. As divergências são **VERÍDICAS**.

### 2.2 Divergências em TODAS as transições de mês

| Transição | Bicos afetados | Soma das diferenças |
|---|---|---|
| 11/2023 → 12/2023 | 4 (bicos 4,5,7,8) | +25.922 L |
| **12/2023 → 01/2024** | **8 (TODOS)** | **-8.326.110 L** |
| 01/2024 → 02/2024 | 3 (bicos 4,5,7) | +16.045 L |
| 02/2024 → 03/2024 | 4 (bicos 4,5,7,8) | +11.910 L |
| 03/2024 → 04/2024 | 5 (bicos 4,5,6,7,8) | +52.096 L |
| 04/2024 → 05/2024 | 5 (bicos 4,5,6,7,8) | +14.467 L |
| 05/2024 → 06/2024 | 4 (bicos 4,5,7,8) | +20.354 L |
| 06/2024 → 07/2024 | 4 (bicos 4,5,7,8) | +16.345 L |
| 07/2024 → 08/2024 | 4 (bicos 4,5,7,8) | +26.000 L |
| 08/2024 → 09/2024 | 4 (bicos 4,5,7,8) | +29.552 L |

**Padrão identificado:**
- **Bicos 4, 5, 7 e 8** possuem divergências **CRÔNICAS** em TODAS as transições de mês, sempre com valores POSITIVOS (abertura > fechamento anterior) - indica que há vendas entre o fechamento de um mês e a abertura do seguinte que não estão sendo contabilizadas em nenhum dos dois meses.
- **Bicos 1, 2, 3 e 6** só apresentaram divergência na virada 12/2023→01/2024, com valores NEGATIVOS massivos - indica reset/troca de encerrante.

---

## 3. AUDITORIA DE CONTINUIDADE DIA-A-DIA

Dentro de cada mês, o encerrante de abertura de um dia deve ser igual ao de fechamento do dia anterior. Foram encontradas **164 quebras** distribuídas assim:

| Mês | Quebras dia-a-dia |
|---|---|
| 11/2023 | 15 |
| 12/2023 | 16 |
| 01/2024 | 16 |
| 02/2024 | 12 |
| 03/2024 | 18 |
| 04/2024 | 18 |
| 05/2024 | 16 |
| 06/2024 | 15 |
| 07/2024 | 16 |
| 08/2024 | 9 |
| 09/2024 | 13 |

**Observação:** Estas quebras dia-a-dia ocorrem porque o LMC do PVA apresenta dados apenas para os dias com movimentação. Dias sem movimentação (domingos, feriados) são omitidos, e entre esses dias podem haver vendas registradas nos encerrantes que não constam no LMC daquele período. Os bicos mais afetados são **4, 5, 7 e 8** - os mesmos que apresentam divergências mensais.

---

## 4. AUDITORIA DE ESTOQUE

### 4.1 Estoque: Fechamento 31/12/2023 vs Abertura 01/01/2024

| Produto | Fech 31/12/2023 (L) | Abert 01/01/2024 (L) | Diferença (L) |
|---|---|---|---|
| Etanol | 5.208,945 | 5.016,528 | **-192,417** |
| Diesel S10 | 9.403,502 | 6.487,763 | **-2.915,739** |
| Gasolina Comum | 39.563,298 | 14.825,345 | **-24.737,953** |

**Os valores informados pelo usuário para Etanol (-192,417 L) foram CONFIRMADOS nos PDFs do PVA.**

A diferença de estoque indica que houve consumo/venda entre o fechamento do último dia de dezembro e o primeiro registro de janeiro sem a devida entrada no LMC.

---

## 5. DIAGNÓSTICO

### 5.1 Sobre a divergência massiva 12/2023 → 01/2024

A queda simultânea de TODOS os 8 bicos na virada do ano, com reduções que variam de 284 mil a 2,4 milhões de litros, aponta para uma das seguintes causas:

1. **Troca/reset completo de todos os encerrantes das bombas** - Pode ter ocorrido manutenção/calibração de todas as bombas na virada do ano, com reset dos contadores.
2. **Retificação do SPED** - O contribuinte pode ter retificado os SPEDs a partir de janeiro/2024, usando novos valores de encerrante, sem retroagir a correção para dezembro/2023.
3. **Mudança de sistema/concentrador** - Troca do sistema de automação das bombas que gerou novos encerrantes base.

### 5.2 Sobre as divergências crônicas (bicos 4, 5, 7 e 8)

As divergências POSITIVAS consistentes em TODOS os meses nos bicos 4, 5, 7 e 8 indicam:

- Há dias com vendas que **não estão sendo registrados** no LMC
- O encerrante avança entre o último dia registrado de um mês e o primeiro dia do mês seguinte, mas esse volume não aparece em nenhum dos dois meses
- Isso pode configurar **omissão de receita fiscal**

---

## 6. VEREDITO

### As informações fornecidas são VERÍDICAS.

Os dados de encerrantes (Final 31/12/2023 e Inicial 01/01/2024) que o usuário apresentou **existem nos PDFs do LMC exportados pelo PVA** e foram confirmados por esta auditoria. As divergências são reais e documentadas.

### Classificação da gravidade:

| Item | Gravidade | Descrição |
|---|---|---|
| Reset de encerrantes 12/2023→01/2024 | **CRÍTICA** | Todos os 8 bicos com queda de 8,3 milhões de litros nos encerrantes |
| Divergências crônicas bicos 4,5,7,8 | **ALTA** | Omissão sistemática de vendas entre meses (todos os meses) |
| Quebras dia-a-dia | **MÉDIA** | 164 descontinuidades nos encerrantes diários |
| Divergência de estoque | **ALTA** | Estoque de abertura 01/2024 menor que fechamento 12/2023 |

### Recomendações:

1. **Solicitar justificativa formal** ao contribuinte sobre o reset de encerrantes na virada 12/2023→01/2024 (laudos de manutenção, notas de intervenção em bombas)
2. **Verificar as intervenções** - Se houve troca de bomba, deve haver registro no INMETRO e laudo de aferição
3. **Apurar o volume não contabilizado** entre os meses nos bicos 4, 5, 7 e 8 - pode representar vendas omitidas
4. **Cruzar com NFCe/NFe** - Verificar se os volumes vendidos nos encerrantes correspondem às notas emitidas
5. **Solicitar retificação** dos SPEDs para que haja continuidade perfeita dos encerrantes

---

*Relatório gerado automaticamente pelo sistema Audisped.*
