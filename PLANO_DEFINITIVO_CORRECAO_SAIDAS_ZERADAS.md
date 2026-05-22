# PLANO DEFINITIVO: Correção de Saídas Zeradas no LMC quando há NFC-e

**Data:** 21/05/2026
**Engenheiro:** Análise como Engenheiro de Software Sênior - Área Fiscal SPED Combustíveis
**Baseado em:** Leitura completa do backend/server.js (~7200 linhas) + frontend LmcView/AnalisadorView

---

## 1. ENTENDIMENTO COMPLETO DO SISTEMA

### 1.1 Arquitetura do Fluxo de Dados

```
SPED Original (arquivo .txt)
    ↓ [Upload/Importação]
lmc_movimentacao (campos originais: estq_abert, vol_saidas, fech_fisico)
    ↓ [Otimização/Sincronização]
lmc_movimentacao (campos ajustados: estq_abert_ajustado, vol_saidas_ajustado, fech_fisico_ajustado)
    ↓ [Exportação SPED]
SPED Retificado (usa COALESCE: ajustado > original)
```

### 1.2 Funções que Modificam os Campos Ajustados

| Função | Linha | Trigger | O que faz |
|--------|-------|---------|-----------|
| `POST /api/lmc/confirmar-sincronizacao` | ~3480 | Usuário clica "Sincronizar" | Ajusta estq_abert_ajustado do 1º dia para = fech do mês anterior. Chama `calcularSincronizacaoPreview` que recalcula toda a cascata. |
| `POST /api/lmc/otimizador-matematico` | ~3570 | Usuário clica "Auto-Otimizar" ou "Distribuição Inteligente" | **MOTOR V7 (Curandeiro) + V5 (Trava) + V6 (Máxima)** — redistribui vol_saidas_ajustado para caber no estoque E respeitar ANP 0,60%. |
| `POST /api/lmc/ajustar-cascata` | ~5270 | Usuário edita uma saída e clica "Gravar c/ Cascata" | Propaga fech_fisico para dias seguintes respeitando ANP. |
| `POST /api/lmc/ajustar-lote` | ~5380 | Usuário edita saída/físico e clica "Gravar Ajuste" | Salva campos ajustados pontualmente (sem cascata). |
| `POST /api/lmc/corrigir-distribuicao` | ~3513 | Botão "Corrigir Distribuição" | Delta-shift: se abertura subiu +X, físico de todos os dias sobe +X. Saídas voltam ao original. |

### 1.3 Motor de Otimização — O Causador do Bug

**Localização:** `POST /api/lmc/otimizador-matematico` (linhas 3570-3880)

**Fluxo interno:**
1. **Linha 3642:** `aberturaInicialConsolidada` = estq_abert_ajustado do 1º dia (ou original)
2. **Linha 3664-3676 — MOTOR V7 (Curandeiro Analítico):**
   - Percorre dia a dia calculando `tempStock`
   - `maxSaidaPermitida = tempStock + entradas - 0.5`
   - **SE `saidaCalc > maxSaidaPermitida` → `saidaCalc = max(0, maxSaidaPermitida)`**
   - ← **AQUI está o bug: zera saídas quando tempStock = 0**
3. **Linha 3678-3722 — MOTOR V5 (Trava Venda Mínima):**
   - Calcula `vendaMaximaPossivel = totalEntradas + abertura - 0.5`
   - Se `targetReal > vendaMaximaPossivel` → limita
4. **Linha 3725-3782 — Loop Iterativo:**
   - Redistribui diferença entre `targetReal` e `currentTotalSaida`
   - **REDUÇÃO (diff < 0, linha 3764):** Rateio proporcional, com proteção `c.saidaCalc - 0.001`
   - ← **Nunca zera completamente** (mantém 0.001), mas isso ocorre DEPOIS do V7 que já zerou
5. **Linha 3784-3860 — Redistribuição por Tanque:**
   - Usa `pSaida = saidaOrig / totalSaidaOriginalDia` para ratear entre tanques
   - Se `totalSaidaOriginalDia = 0` (porque V7 zerou tudo) → `pSaida = 1/N`
6. **Linha 3788-3806 — Cap ANP por dia:**
   - `capPerda = escrCalc * 0.006/1.006`
   - `capGanho = escrCalc * 0.006/0.994`
   - `fisicoCalc = max(0, escrCalc + ganho - perda)`

### 1.4 Exportação SPED — Como Usa os Ajustados

**Localização:** `GET /api/exportar-sped/:id` (linhas 5444-6944)

**Regra de prioridade para cada campo do 1300:**
```javascript
// Linha 6459-6463:
const fisicoDb = (fisicoAj !== null && fisicoAj > 0) ? fisicoAj : fisicoOr;

// Linha 6410-6416 (ABERT):
if (fechAnterior !== undefined && fechAnterior > 0) {
    novoAbert = fechAnterior; // propagação
} else {
    novoAbert = oldAbert; // original do arquivo
}

// Linha 6430 (SAÍDA):
if (aj.vol_saidas_ajustado !== null) novoSaida = parseFloat(aj.vol_saidas_ajustado);
```

**Conclusão:** Na exportação, `vol_saidas_ajustado = 0` é usado diretamente. O SPED exportado terá saída = 0.

### 1.5 Validação ANP (Relatório de Erros)

**Localização:** Rota de análise, linha 2251-2264

```sql
COALESCE(lmc.vol_escr_ajustado, lmc.estq_escr) -- escritural
COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) -- físico
WHERE (ABS(escr - fech) / fech) > 0.006
```

---

## 2. DIAGNÓSTICO DO PROBLEMA

### 2.1 Cenário Real (Auto Posto Apache, ETANOL, Dez/2024)

```
Dia 20: tempStock = 309L, saída = 1.226L → maxPermitida = 308.7 → CORTOU para 308.7
Dia 21: tempStock = 0.5L, saída = 330L → maxPermitida = 0 → ZEROU
Dia 22-26: tempStock = 0.5L, saídas = 854~1.629L → maxPermitida = 0 → ZEROU TUDO
Dia 27: ENTRADA 10.000L → tempStock volta ao normal
```

**Causa:** O SPED original registra `fech_fisico = 4.089L` no dia 22 (medição real do tanque), provando que havia combustível. Porém a escrituração (abert+entr-saidas) não comporta isso. O tanque recebeu combustível sem nota fiscal de entrada.

### 2.2 Por que o Motor V7 não detecta isso

O Motor V7 usa apenas `tempStock` calculado (cascata escritural) e ignora:
- O `fech_fisico` original do SPED (que prova existência de combustível)
- A existência de NFC-e emitidas no dia (que prova que vendeu)
- Entradas futuras próximas (que provam reabastecimento)

### 2.3 Impacto Fiscal

- SPED declarado com `saídas = 0` em dias com 300+ NFC-e = **infração grave**
- A SEFAZ cruza NFC-e x LMC automaticamente
- Pode gerar auto de infração por omissão de saídas

---

## 3. PLANO DE IMPLEMENTAÇÃO

### FASE 1: Trava de Venda Mínima Baseada em NFC-e (CRÍTICA)

**Arquivo:** `backend/server.js`
**Localização:** MOTOR V7, linhas 3664-3676

**Regra:** Se um dia tem `saidaOrig > 0` (veio do SPED original com NFC-e), NUNCA pode ter `saidaCalc = 0`.

**Implementação:**
```javascript
// ANTES (linha 3671-3673):
if (c.saidaCalc > maxSaidaPermitida) {
    c.saidaCalc = Math.max(0, maxSaidaPermitida);
}

// DEPOIS:
if (c.saidaCalc > maxSaidaPermitida) {
    // Trava: se havia saída real (NFC-e), manter pelo menos 0.1% da venda original
    const minimoFiscal = c.saidaOrig > 0 ? Math.max(0.001, c.saidaOrig * 0.001) : 0;
    c.saidaCalc = Math.max(minimoFiscal, maxSaidaPermitida);
}
// Garantir que tempStock não fique negativo (permitir ligeiramente negativo para
// acomodar o mínimo fiscal — será corrigido pelo escudo ANP na exportação)
tempStock = tempStock + c.entradasOrig - c.saidaCalc;
```

**Efeito:** Dias com NFC-e sempre terão pelo menos 0.001L de saída. O estoque pode ficar "ligeiramente negativo" na cascata interna, mas o escudo ANP na exportação cuida disso.

### FASE 2: Redistribuição Retroativa do Deficit (ALTA)

**Arquivo:** `backend/server.js`
**Localização:** ENTRE o Motor V7 (3676) e o Motor V5 (3678)

**Lógica:** Quando dias são cortados para 0, redistribuir o corte para dias ANTERIORES que tinham folga.

**Implementação (nova função após linha 3676):**
```javascript
// MOTOR V7.1: Redistribuição Retroativa de Deficit
// Se dias ficaram com saída << original por falta de estoque,
// reduzir proporcionalmente dias anteriores que tinham sobra
let diasDeficitarios = calcs.filter((c, i) =>
    c.saidaOrig > 10 && c.saidaCalc < c.saidaOrig * 0.10
);

if (diasDeficitarios.length > 0) {
    let totalDeficit = diasDeficitarios.reduce((s, c) => s + (c.saidaOrig - c.saidaCalc), 0);

    // Dias que podem ceder: tinham saída calculada ≥ 90% da original
    let diasDoadores = calcs.filter(c => c.saidaCalc >= c.saidaOrig * 0.90 && c.saidaCalc > 50);

    if (diasDoadores.length > 0 && totalDeficit > 0) {
        let totalDoavel = diasDoadores.reduce((s, c) => s + c.saidaCalc * 0.25, 0); // max 25% de cada
        let fatorReducao = Math.min(1, totalDeficit / totalDoavel);

        for (let d of diasDoadores) {
            let cessao = d.saidaCalc * 0.25 * fatorReducao;
            d.saidaCalc -= cessao;
        }

        // Recalcular tempStock do zero
        let recalcStock = aberturaInicialConsolidada;
        for (let c of calcs) {
            let maxS = recalcStock + c.entradasOrig - 0.5;
            // Dias deficitários ganham de volta proporcionalmente
            if (c.saidaOrig > 10 && c.saidaCalc < c.saidaOrig * 0.10) {
                let novaMax = Math.max(c.saidaCalc, Math.min(c.saidaOrig, maxS));
                c.saidaCalc = novaMax;
            } else if (c.saidaCalc > maxS) {
                c.saidaCalc = Math.max(c.saidaOrig * 0.001, maxS);
            }
            recalcStock = recalcStock + c.entradasOrig - c.saidaCalc;
        }
    }
}
```

**Efeito:** Em vez de 5 dias com saída=0 e 20 dias normais, teremos 25 dias com saída reduzida proporcionalmente. Nenhum dia fica zerado.

### FASE 3: Âncora no Fechamento Físico Original (MÉDIA)

**Arquivo:** `backend/server.js`
**Localização:** Motor V7, cálculo do `tempStock`

**Princípio:** O `fech_fisico` original do SPED é uma medição REAL do tanque. Se o SPED diz que havia 4.089L no tanque no dia 22, então havia. Usar isso como piso do estoque.

**Implementação:**
```javascript
// No loop do Motor V7, após calcular tempStock:
tempStock = tempStock + c.entradasOrig - c.saidaCalc;

// ÂNCORA: se o fech_fisico original > tempStock calculado,
// significa que houve entrada não declarada (combustível real no tanque)
if (c.fisicoOrig > tempStock && c.fisicoOrig > 0 && c.saidaOrig > 0) {
    // O tanque realmente tinha esse combustível (medição física prova)
    // Ajustar tempStock para refletir a realidade
    tempStock = c.fisicoOrig;
}
```

**Efeito:** Quando o SPED original mostra fechamento físico alto (tanque cheio), o motor aceita isso como "entrada implícita" e não zera as saídas dos dias seguintes.

**Risco:** Pode gerar ganho > 0,60% se a diferença for grande. Mitigado pelo escudo ANP na Fase 5.

### FASE 4: Validação Pós-Cascata (ALTA)

**Arquivo:** `backend/server.js`
**Localização:** Após o loop iterativo (linha ~3782), antes de "5. Redistribuir e Salvar"

**Regra:** Nenhum dia com `saidaOrig > 0` pode ficar com `saidaCalc = 0` ao final de TODA a otimização.

**Implementação:**
```javascript
// TRAVA FINAL: Verificação de integridade fiscal
// Nenhum dia com venda real pode sair zerado
for (let c of calcs) {
    if (c.saidaCalc <= 0 && c.saidaOrig > 0) {
        // Forçar saída mínima: 0.1% da original ou 0.001L
        c.saidaCalc = Math.max(0.001, c.saidaOrig * 0.001);
        logger.warn(`[TRAVA FISCAL] Dia ${c.data_mov_normalized} tinha saída=0 mas SPED original=${c.saidaOrig.toFixed(3)}L. Forçado mínimo=${c.saidaCalc.toFixed(3)}L.`);
    }
}
```

### FASE 5: Escudo ANP na Exportação para Dias com Estoque Negativo (MÉDIA)

**Arquivo:** `backend/server.js`
**Localização:** `flush1300Group`, linhas 5785-6260

**Problema derivado:** Se a Fase 1-4 mantiver saídas em dias sem estoque escritural suficiente, o escritural pode ficar negativo. O escudo ANP já existe mas precisa tratar esse caso.

**O escudo ANP existente (escudoAnpMae) já faz:**
```javascript
// Se perda > 0.55% da base → limita
// Se ganho > 0.55% da base → limita
```

**Ajuste necessário:** Quando `escrCalc < 0` (escritural negativo após manter saída mínima):
```javascript
// Na exportação (flush1300Group), se escrCalc < 0:
// Significa que mantivemos saída em dia sem estoque (correto fiscalmente)
// Solução: transformar o negativo em "ganho" (entrada implícita)
if (realEscr < 0) {
    // O tanque tinha combustível real (fech_fisico > 0 no original)
    // Ajustar: saída = min(saída, disponível) para o SPED
    // O excesso será absorvido pelo ganho ANP (limitado a 0.60%)
    realSaida = Math.max(0, realDisp - 0.001);
    realEscr = Math.max(0.001, realDisp - realSaida);
}
```

### FASE 6: Log e Relatório de Dias Afetados (BAIXA)

**Arquivo:** `backend/server.js`
**Localização:** Final do otimizador-matematico

**Implementação:** Incluir no response JSON um array de alertas:
```javascript
const alertasDiasZerados = calcs
    .filter(c => c.saidaCalc < c.saidaOrig * 0.01 && c.saidaOrig > 10)
    .map(c => ({
        data: c.data_mov_normalized,
        saida_original: c.saidaOrig,
        saida_ajustada: c.saidaCalc,
        motivo: 'Estoque insuficiente na cascata'
    }));

// Incluir no response:
res.json({
    success: true,
    message: '...',
    alertas_dias_cortados: alertasDiasZerados
});
```

---

## 4. ORDEM DE IMPLEMENTAÇÃO

| # | Fase | Prioridade | Complexidade | Risco |
|---|------|-----------|--------------|-------|
| 1 | Trava Venda Mínima (V7) | CRÍTICA | Baixa (3 linhas) | Baixo |
| 4 | Validação Pós-Cascata | ALTA | Baixa (5 linhas) | Baixo |
| 2 | Redistribuição Retroativa | ALTA | Média (30 linhas) | Médio |
| 3 | Âncora Fech Físico | MÉDIA | Baixa (5 linhas) | Médio (pode gerar ganho>ANP) |
| 5 | Escudo ANP Export | MÉDIA | Média (10 linhas) | Baixo |
| 6 | Log/Relatório | BAIXA | Baixa | Nenhum |

**Recomendação:** Implementar Fase 1 + Fase 4 primeiro (solução imediata com 8 linhas), testar com Apache Dez/2024, depois implementar Fases 2 e 3.

---

## 5. TESTES DE VALIDAÇÃO

### 5.1 Caso de teste: Auto Posto Apache, Dez/2024, ETANOL (7085)
- **Antes:** dias 22-26 com `vol_saidas_ajustado = 0`
- **Depois:** dias 22-26 com `vol_saidas_ajustado > 0` (mesmo que mínimo)
- **Verificar:** ANP ≤ 0,60% em todos os dias do mês

### 5.2 Caso de teste: PRECO BOM II, Gas. Aditivada, Dez/2022
- **Antes:** dia 31 com ANP 99,99%
- **Depois:** dia 31 com ANP ≤ 0,60%

### 5.3 Regressão
- Exportar SPED de um mês sem problemas → deve permanecer inalterado
- Verificar que nenhum estoque fica negativo no SPED exportado
- Verificar que NFC-e x LMC saídas não tem dia com 0 (quando há notas)

---

## 6. FUNÇÕES AUXILIARES EXISTENTES QUE DEVEM SER PRESERVADAS

| Função | Propósito | Não alterar |
|--------|-----------|-------------|
| `escudoAnpMae()` | Limita perda/ganho a 0,55% na exportação | Core ANP |
| `flush1300Group()` | Monta 1300 final com âncora fisicoDb | Lógica de exportação |
| `calcularSincronizacaoPreview()` | Preview de sincronização | UI |
| Loop iterativo (3725-3782) | Redistribui diff entre targetReal e atual | Preservar proteção 0.001 |
| MOTOR V5 (3678-3722) | Trava de transbordo/venda máxima | Segurança |
| MOTOR V6 (3716-3722) | Trava de estoque negativo | Segurança |
| Continuidade intermensal (5684-5765) | Garante ABERT = FECH anterior | Exportação |

---

## 7. RESUMO EXECUTIVO

**O bug:** O Motor V7 (Curandeiro Analítico) calcula estoque em cascata e zera saídas quando o estoque acumulado chega a zero. Ele ignora o fech_fisico original (medição real do tanque) e a existência de NFC-e.

**A solução:**
1. Nunca zerar saída quando há venda real no SPED original (Fase 1)
2. Redistribuir o deficit para dias anteriores (Fase 2)
3. Usar fechamento físico original como piso do estoque (Fase 3)
4. Validação final garantindo zero dias zerados com NFC-e (Fase 4)

**Impacto:** 8 linhas de código resolvem o problema imediato (Fases 1+4). 30 linhas adicionais melhoram a distribuição (Fases 2+3).

---

*Plano elaborado com base em leitura completa do server.js (7200 linhas), frontend (LmcView.vue + AnalisadorView.vue), e simulação com dados reais de Auto Posto Apache e PRECO BOM II.*
