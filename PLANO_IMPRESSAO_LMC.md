# PLANO: Impressão do LMC — Modelo AutoSystem

**Data:** 27/05/2026
**Modelo base:** AutoSystem PRO (Linx Sistemas) — formato formulário fiscal
**Objetivo:** Gerar PDF do LMC para impressão/fiscalização

---

## 1. LAYOUT DO FORMULÁRIO (1 página por dia/combustível)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                              Fl. nr. X  │
│ LIVRO DE MOVIMENTAÇÃO DE COMBUSTÍVEIS (LMC)                             │
│ Empresa: [RAZÃO SOCIAL]  CNPJ: [XX.XXX.XXX/XXXX-XX]  IE: [XXXXXXXXX]  │
├──────────────────────────────────┬───────────────────────────────────────┤
│ 1) Produto: [COMBUSTÍVEL]        │ 2) Data: [DD/MM/YYYY]               │
├──────────────────────────────────┴───────────────────────────────────────┤
│ 3) Estoque de Abertura (Medição Física no início do dia)                │
│ TQ) [t1]    TQ) [t2]    TQ) [t3]    TQ) [t4]    TQ) [t5]    TQ) [t6] │
│ [val1]      [val2]      [val3]      [val4]      [val5]      [val6]     │
│                                                  3.1) Estoque Abertura │
│                                                       [TOTAL]          │
├──────────────────────────────────────────────────────────────────────────┤
│ 4) Volume Recebido no dia (em litros)    │ 4.1) Nr. TQ. Descarga       │
│                                          │ 4.2) Volume Recebido        │
│ [Lista de NF-e de entrada com volumes]   │ 4.3) Total Recebido [TOTAL] │
│                                          │ 4.4) Vol. Disponível        │
│                                          │      (3.1 + 4.3) [TOTAL]    │
├──────────────────────────────────────────────────────────────────────────┤
│ 5) Volume Vendido no dia (em litros)                                    │
│ 5.1) Tanque  5.2) Bico  5.3) +Fechamento   5.4) -Abertura             │
│ [TQ]         [BICO]     [ENC_FINAL]         [ENC_INICIAL]              │
│                          5.5) -Aferições   5.6) =Vendas Bico           │
│                          [AFER]            [VENDAS]                     │
│                                                                         │
│ 10) Valor Vendas R$                 │ 5.7) Vendas no dia [TOTAL]       │
│ Valor médio preço/litro             │                                   │
│ 10.1) Valor Vendas dia [R$]         │ 6) Estoque Escritural             │
│                                     │    (4.4 - 5.7) [ESCR]            │
│ 10.2) Valor Acumulado mês [R$]      │ 7) Estoque Fechamento             │
│                                     │    (9.1) [FECH]                   │
│ 11) Venda em litros no mês [L]      │ 8) Perdas + Sobras               │
│                                     │    [PERDA/GANHO]                  │
├──────────────────────────────────────────────────────────────────────────┤
│ 13) Observações                     │ 12) Destinado à Fiscalização      │
│                                     │     ANP                           │
│ Bico XX R$ X,XXX                    │                                   │
│ Bico XX R$ X,XXX                    │                                   │
│                                     │     OUTROS ÓRGÃOS FISCAIS         │
│                                     │                                   │
├──────────────────────────────────────────────────────────────────────────┤
│ Conciliação dos Estoques                                                │
│ 9)                                                             9.1)Total│
│ Fechamento TQ)[val] TQ)[val] TQ)[val] TQ)[val] TQ)[val] TQ)[val] [TOT]│
│ Físico                                                                  │
├──────────────────────────────────────────────────────────────────────────┤
│ (*) ATENÇÃO - SE O RESULTADO FOR NEGATIVO, PODE ESTAR HAVENDO           │
│ VAZAMENTO PARA O MEIO AMBIENTE.                                         │
├──────────────────────────────────────────────────────────────────────────┤
│ Audisped - audisped.com.br              [RAZÃO SOCIAL] - [DATA] Pág X/Y│
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. FILTROS (Modal no frontend)

| Filtro | Tipo | Opções |
|--------|------|--------|
| Combustível | Dropdown | "Todos" / selecionar um específico |
| Data início | Date picker | Primeiro dia do período (default) |
| Data fim | Date picker | Último dia do período (default) |
| Formato | Toggle | "Formulário" (AutoSystem) / "Resumo" (tabela) |

---

## 3. FONTE DOS DADOS

### Por página (1 dia + 1 combustível):

| Campo LMC | Fonte no banco | Tabela |
|-----------|---------------|--------|
| 1) Produto | descr_item | sped_produtos |
| 2) Data | data_mov | lmc_movimentacao |
| 3) Estoque Abertura por TQ | estq_abert (por num_tanque) | lmc_movimentacao |
| 3.1) Estoque Abertura total | COALESCE(estq_abert_ajustado, estq_abert) consolidado | lmc_movimentacao |
| 4) Volume Recebido | COALESCE(vol_entr_ajustado, vol_entr) | lmc_movimentacao |
| 4.1) NF-e entrada | num_doc, dt_doc, qtd | documentos_c100 + c170 |
| 5.1-5.6) Bicos | enc_final, enc_inicial, aferição, vendas | SPED arquivo (1320) |
| 5.7) Vendas dia | COALESCE(vol_saidas_ajustado, vol_saidas) | lmc_movimentacao |
| 6) Escritural | disp - saidas | calculado |
| 7) Fechamento | COALESCE(fech_fisico_ajustado, fech_fisico) | lmc_movimentacao |
| 8) Perdas/Sobras | COALESCE(val_perda_ajustado, val_perda) / val_ganho | lmc_movimentacao |
| 9) Conciliação TQ | fech_fisico por tanque | lmc_movimentacao |
| 10) Valor R$ | SUM(vl_doc) das NFC-e do dia/produto | documentos_c100 |
| 11) Venda mês acumulada | SUM(vol_saidas) até o dia | lmc_movimentacao |
| Preço por litro | vl_doc / qtd (média) | documentos_c100 + c170 |

---

## 4. IMPLEMENTAÇÃO

### 4.1 Backend

**Dependência:** `pdfkit` (geração de PDF em Node.js)

**Nova rota:** `GET /api/lmc/imprimir/:id_sped`

**Query params:**
- `combustivel` — cod_item ou "todos" (default: todos)
- `data_inicio` — YYYY-MM-DD (default: primeiro dia do período)
- `data_fim` — YYYY-MM-DD (default: último dia do período)
- `formato` — "formulario" ou "resumo" (default: formulario)

**Fluxo:**
1. Buscar info da empresa (razão social, CNPJ, IE)
2. Buscar LMC consolidado por dia/produto (campos ajustados)
3. Buscar LMC por tanque (para seção 3 e 9)
4. Buscar 1320 do SPED (encerrantes por bico)
5. Buscar NFC-e por dia/produto (valor R$, preço)
6. Buscar NF-e de entrada por dia/produto (vol_entr)
7. Para cada dia/combustível: gerar 1 página do formulário
8. Retornar PDF

### 4.2 Frontend

**Arquivo:** `LmcView.vue`

**Novo botão:** "IMPRIMIR LMC" (ao lado de "EXPORTAR SPED")

**Modal:**
- Dropdown combustível (preenchido com combustíveis do arquivo)
- Date range picker (início e fim)
- Toggle formato (Formulário / Resumo)
- Botão "Gerar PDF" → abre em nova aba
- Botão "Baixar PDF"

### 4.3 Formato Resumo (alternativo)

Tabela compacta — todo o mês em 1-2 páginas:

```
LIVRO DE MOVIMENTAÇÃO DE COMBUSTÍVEIS — RESUMO MENSAL
Empresa: [RAZÃO SOCIAL]  CNPJ: [XX.XXX.XXX/XXXX-XX]  Período: [MM/YYYY]

COMBUSTÍVEL: ETANOL (cod. 2)
┌──────────┬──────────┬──────────┬──────────┬──────────┬─────────┬─────────┬──────────┐
│   DATA   │  ABERT   │  ENTR    │  SAÍDAS  │   ESCR   │  PERDA  │  GANHO  │   FECH   │
├──────────┼──────────┼──────────┼──────────┼──────────┼─────────┼─────────┼──────────┤
│01/01/2024│ 5.016,53 │    0,00  │   503,69 │ 4.512,83 │  26,92  │   0,00  │ 4.485,92 │
│02/01/2024│ 4.485,92 │    0,00  │   421,33 │ 4.064,59 │  24,23  │   0,00  │ 4.040,36 │
│...       │          │          │          │          │         │         │          │
│TOTAIS    │          │15.000,00 │12.543,21 │          │ 123,45  │  67,89  │          │
└──────────┴──────────┴──────────┴──────────┴──────────┴─────────┴─────────┴──────────┘
% ANP mensal: 0,45%
```

---

## 5. ORDEM DE IMPLEMENTAÇÃO

| # | Tarefa | Complexidade | Tempo est. |
|---|--------|-------------|------------|
| 1 | Instalar pdfkit | Baixa | 5 min |
| 2 | Query de dados (LMC + tanques + bicos + NFC-e) | Média | 1h |
| 3 | Layout formulário AutoSystem em pdfkit | Alta | 3h |
| 4 | Layout resumo tabela | Média | 1h |
| 5 | Rota API `/api/lmc/imprimir` | Média | 1h |
| 6 | Modal + botão no frontend | Média | 1h |
| 7 | Testes com diferentes postos/períodos | Média | 1h |

---

## 6. IMPACTO

- **Nenhuma alteração** nas funções existentes
- Nova rota + nova dependência (pdfkit)
- Novo botão/modal no frontend
- Dados vêm do banco (mesmos que a tela LMC já mostra)

---

*Plano baseado no modelo AutoSystem PRO (Linx Sistemas) extraído do PDF lmc autosystem.pdf*
