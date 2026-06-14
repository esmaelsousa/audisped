# PLANO — Reconstrução Total do LMC a partir do SPED Fiscal (com vendas, sem bloco 1)

> **Objetivo:** dado um SPED Fiscal que tem **vendas** (NFC-e / SAT / ECF e/ou NF-e) e **entradas** de combustível, porém **NÃO tem o bloco 1 (1300/1310/1320)**, reconstruir uma movimentação diária de combustíveis coerente e popular `lmc_movimentacao` — de modo que a tela **Impressão LMC** e (opcionalmente) o **export do bloco 1** funcionem como se o LMC original existisse.

> **Branch sugerida:** `feat/reconstrucao-lmc`
> **Status:** PLANEJADO (nada implementado)

---

## 1. Diagnóstico do estado atual (ancoragem no código)

Hoje o LMC é **lido**, não **reconstruído**:

| Etapa | Onde | O que faz |
|---|---|---|
| Upload | `server.js:495-568` | chama `parseSpedFile`, insere `lmc_movimentacao` (linha 564) |
| Parse bloco 1300 | `server.js:8454-8485` | extrai `estq_abert[4] vol_entr[5] vol_saidas[7] estq_escr[8] val_perda[9] val_ganho[10] fech_fisico[11]` por `cod_item`×`dt_fech` |
| Parse 1310/1320 | `server.js:8490-8505` | tanques e encerrantes por bico → `data.bicos`, tabela `sped_1320` |
| Impressão LMC | `server.js:5930-6271` + `lmc-pdf.js:9-280` | lê `lmc_movimentacao` (cols `_ajustado`), entradas de `documentos_c100/c170`, valor de venda de NFC-e por dia |

**Conclusão:** se o SPED não traz 1300, `data.lmc` fica vazio → `lmc_movimentacao` sem linhas → Impressão LMC não monta. Tudo que precisamos para reconstruir **já está no banco** (produtos 0200, entradas C100/C170, vendas), mas ninguém costura isso numa movimentação diária quando o bloco 1 falta.

---

## 2. Insumos disponíveis e fontes (o que já existe no banco)

| Insumo do LMC | Fonte primária | Fallback | Onde no código |
|---|---|---|---|
| **Produtos-combustível** | `sped_produtos` (0200) + filtro de termos | itens de venda C170 | `server.js:8446-8453`; filtro `server.js:5972-5978` (`GASOLINA/ETANOL/DIESEL/GNV/BIODIESEL/QUEROSENE/GLP/ALCOOL`) |
| **Entradas (volume/dia/produto)** | `documentos_c100`(mod 01/55, ind_oper 0) ⋈ `documentos_itens_c170` (CFOP 1/2/3) | — | query pronta `server.js:6064-6074` |
| **Saídas (VOLUME/dia/produto)** | **a definir — ver §3** | rateio do total | — |
| **Estoque inicial** | `encerrantes_exportados` (mês anterior) | H010/H020 → manual | schema `setup_db.js:260-286` |
| **Perda/ganho** | tolerância ANP 0,6% | zero | regra de fechamento |
| **Capacidade tanque** | `lmc_tanques_config` (cnpj×cod_item) | nula | `setup_db.js:152-158` |

> A query de vendas existente (`server.js:6098-6107`) soma **valor** (`vl_doc`) por dia — serve para o campo "valor de venda" do PDF, **mas não dá volume por produto**. O LMC precisa de **litros por produto por dia**. É o nó central — §3.

---

## 3. O nó central: de onde vem o VOLUME de venda por produto/dia

O LMC mede **litros**, não reais. Precisamos da saída diária em volume, por combustível. Três representações possíveis no SPED, em ordem de qualidade — a **Fase 0** detecta qual o arquivo usa:

### Fonte A — itens C170 das notas de saída (MELHOR)
NFC-e/NF-e de saída (`cod_mod` 65/55, `ind_oper` 1) **com C170 detalhado**: somar `i.qtd` por `cod_item` de combustível por `dt_doc`. Mesma estrutura da query de entradas, trocando o filtro de CFOP para saída (5xxx/6xxx) e `ind_oper='1'`.
→ **Venda diária REAL por produto.** LMC reconstruído fiel.

### Fonte B — itens de SAT/ECF (C800/C850/C860/C870, C400/C420/C425)
Cupons consolidados. Hoje o parser **não persiste** esses registros (o mapeamento não achou tabelas C800/C870/C400). Se o arquivo usa SAT sem C100+C170 por cupom, o volume por produto **não está no banco**.
→ Exige **estender o parser** (Fase opcional B) OU cair na Fonte C.

### Fonte C — rateio do total mensal (ÚLTIMO RECURSO)
Só temos valor total de venda (`server.js:6098-6107`). Estimar volume = valor ÷ preço médio (do C170 de entrada ou tabela), e distribuir pelos dias com **variação controlada, nunca aleatória livre** (teto = estoque disponível no dia; nunca negativa). É o cenário "estimado" — gera LMC plausível, não fiel.

> **Regra de produto:** marcar explicitamente na saída do JSON/PDF a fonte usada (`A_real | B_sat | C_rateio`) para auditoria. Nada de silenciar a estimativa.

---

## 4. Algoritmo de reconstrução (núcleo)

Para cada `cod_item` de combustível, ordenado por dia da competência:

```
estoque[dia_0]  = estoque_inicial            (§5)
para cada dia D do mês:
    entrada[D]  = Σ litros C170 entrada do produto em D        (Fonte entradas)
    saida[D]    = volume de venda do produto em D              (Fonte A/B/C)
    estq_abert[D] = (D==0) ? estoque_inicial : fech_fisico[D-1]
    estq_escr[D]  = estq_abert[D] + entrada[D] - saida[D]
    # AMARRA FÍSICA — invariante inegociável:
    assert estq_escr[D] >= -tolerância        (senão: realocar saída → ver §6)
    fech_fisico[D] = estq_escr[D]   (reconstrução não tem medição física)
    val_perda[D] = val_ganho[D] = 0           (ou distribuição ANP — §7)
grava lmc_movimentacao (uma linha por produto×dia)
```

Saída: popular `lmc_movimentacao` com as colunas **base** (`estq_abert, vol_entr, vol_saidas, estq_escr, fech_fisico, val_perda, val_ganho`). As colunas `*_ajustado` ficam NULL (a Impressão LMC já faz fallback base→ajustado).

---

## 5. Estoque inicial (o único furo real)

Cascata de resolução, parando no primeiro que existir:
1. **`encerrantes_exportados`** do mês anterior (mesmo CNPJ, competência −1, por `cod_item`) → continuidade automática.
2. **Inventário H010/H020** do próprio SPED (estoque declarado) — **parser não lê hoje**; adicionar leitura (Fase 1).
3. **Entrada manual** na UI: campo "estoque de abertura por produto" no primeiro mês reconstruído.

Resolvido o mês 1, os meses seguintes encadeiam sozinhos via `fech_fisico` → próximo `estq_abert`, e via `encerrantes_exportados` no export.

---

## 6. Tratamento da amarra física (estoque negativo)

Quando `estq_escr[D] < 0` (venda > disponível — típico de Fonte C ou de nota de entrada lançada em dia errado):
- **Fonte A (real):** não mexer no volume; sinalizar inconsistência (a venda real existe — o problema é a data de entrada). Registrar alerta, não falsear.
- **Fonte C (rateio):** rebalancear — empurrar o excedente para dias com estoque sobrando dentro do mês. Nunca deixar negativo no `lmc_movimentacao` final.
- Acumular alertas num array no JSON de resposta (padrão dos planos de saídas zeradas).

---

## 7. Perda/ganho e tolerância ANP

Reconstrução pura **não tem medição física**, então o default honesto é `fech_fisico = estq_escr` (perda/ganho = 0). Opção: se o estoque inicial veio de inventário (H010) e há um físico final conhecido, distribuir a diferença como perda/ganho **dentro do limite ANP 0,6%**; acima disso, alertar em vez de mascarar (mesma filosofia do escudo ANP do motor V7).

---

## 8. Fases de implementação

| Fase | Entrega | Arquivos | Risco |
|---|---|---|---|
| **0. Diagnóstico de fontes** | endpoint `GET /api/lmc/reconstruir/:id_sped/diagnostico` → diz se há bloco 1, se há C170 de saída (Fonte A), se há estoque inicial (continuidade/H010), e qual fonte de volume será usada | `server.js`, novo `backend/lmcReconstrucaoService.js` | baixo (read-only) |
| **1. Estoque inicial** | resolver cascata §5; parser de **H010/H020**; campo manual no front | `server.js:8406+` (parse H), `setup_db.js` (tabela inventário se preciso) | médio |
| **2. Núcleo (Fonte A)** | algoritmo §4 com venda real de C170 saída; grava `lmc_movimentacao` | `lmcReconstrucaoService.js` | médio |
| **3. UI** | botão "Reconstruir LMC" em `LmcView.vue`/`ImpressaoLmcView.vue`; mostra fonte usada + alertas | `frontend/src/views/*` | baixo |
| **4. (opc.) Fonte B** | estender parser p/ C800/C850/C870/C400 → volume por produto do SAT/ECF | `server.js:8506+` | alto |
| **5. (opc.) Fonte C** | rateio do total mensal com variação controlada + amarra física §6 | `lmcReconstrucaoService.js` | médio |
| **6. (opc.) Gerar bloco 1** | a partir do `lmc_movimentacao` reconstruído, sintetizar 1300/1310/1320 no export (para o SPED ficar autocontido) | costura no export `server.js` | alto |

> Entregar até a Fase 3 já resolve o caso real "SPED com NFC-e detalhada, sem LMC → Impressão LMC funcional". Fases 4-6 são extensões.

---

## 9. Critérios de aceite

1. SPED **com** bloco 1 → reconstrução **não roda** (ou roda e bate com o original litro-a-litro: teste de regressão).
2. SPED **sem** bloco 1, **com** C170 de saída → `lmc_movimentacao` populada; Impressão LMC abre; **nenhum dia com estoque negativo**; Σ saídas reconstruídas = Σ vendas do C170.
3. Estoque inicial ausente → UI **bloqueia** e pede o valor (não inventa silenciosamente).
4. Fonte usada (`A/B/C`) sempre visível na resposta e no rodapé do PDF.
5. Continuidade: reconstruir Jan e depois Fev → `estq_abert(Fev) == fech_fisico(Jan)`.

---

## 10. Riscos e decisões em aberto

- **SAT/ECF sem item por produto (Fonte B):** muitos postos emitem cupom consolidado. Confirmar numa amostra real quantos arquivos caem nesse caso antes de investir na Fase 4.
- **Preço médio para Fonte C:** de onde? (C170 de entrada do mês, ou tabela de preços ANP?). Decidir só se Fonte C for necessária.
- **Reconstrução vs. fiscalização:** LMC reconstruído por Fonte A é venda real agregada (defensável); por Fonte C é estimativa (frágil sob cruzamento com encerrantes). Documentar a natureza no PDF.
- **Não duplicar com o motor V7:** o V7 reconstrói **encerrantes** a partir do LMC existente; este plano reconstrói o **LMC** a partir das vendas. São camadas distintas — não misturar.

---

### Próximo passo recomendado
Implementar a **Fase 0 (diagnóstico)** primeiro: roda read-only num `id_sped` real (ex.: um arquivo sem bloco 1) e responde, sem efeito colateral, qual fonte de volume está disponível e se há estoque inicial. Isso valida o plano contra dados reais antes de escrever qualquer gravação.
