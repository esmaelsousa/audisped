# PLANO DE CORREÇÃO: Saídas zeradas no LMC quando há NFC-e

**Data:** 21/05/2026
**Problema:** O motor de otimização ANP zera as saídas em dias que possuem NFC-e reais
**Empresa exemplo:** AUTO POSTO APACHE (09.153.856/0001-71) - Dez/2024, dias 22-26/12
**Impacto:** SPED exportado declara 0 litros vendidos em dias com 300+ NFC-e

---

## CAUSA RAIZ IDENTIFICADA

### Localização no código: `server.js`, linhas 3664-3676 (MOTOR V7: Curandeiro Analítico)

```javascript
// MOTOR V7: Curandeiro Analítico (Saneador Profilático)
let tempStock = aberturaInicialConsolidada;
for (let i = 0; i < calcs.length; i++) {
    let c = calcs[i];
    let maxSaidaPermitida = tempStock + c.entradasOrig - 0.5;
    if (c.saidaCalc > maxSaidaPermitida) {
        c.saidaCalc = Math.max(0, maxSaidaPermitida);  // ← AQUI: zera a saída
    }
    tempStock = tempStock + c.entradasOrig - c.saidaCalc;
}
```

### O que acontece:

1. O sistema calcula o estoque disponível dia a dia (`tempStock`)
2. Quando o estoque acumulado chega a ~0 (tanque "seco"), o motor corta as saídas para 0
3. Isso acontece porque o SPED original tem **entradas (compras) não declaradas** — o tanque recebeu combustível mas não há nota de entrada no SPED
4. Na realidade, o combustível existia (as NFC-e provam que vendeu), mas o estoque escritural não comporta

### Exemplo real (ETANOL - Apache, Dez/2024):

| Dia | Estoque calc. | Entrada | Saída orig | Saída ajustada | Problema |
|-----|---------------|---------|------------|----------------|----------|
| 20/12 | 309 | 0 | 1.226 | 1.226 | OK (ainda tem) |
| 21/12 | 0,5 | 0 | 330 | 308,7 | CORTOU parcial |
| 22/12 | 0,5 | 0 | 854 | **0** | ZEROU! (336 NFC-e no dia) |
| 23/12 | 0,5 | 0 | 1.629 | **0** | ZEROU! |
| 24/12 | 0,5 | 0 | 1.292 | **0** | ZEROU! |
| 25/12 | 0,5 | 0 | 623 | **0** | ZEROU! |
| 26/12 | 0,5 | 0 | 740 | **0** | ZEROU! |
| 27/12 | 9.643 | 10.000 | 357 | 357 | Entrou combustível, voltou |

O tanque ficou "seco" de 21 a 26/12 na escrituração, mas na prática vendeu normalmente (havia combustível). A entrada de 10.000L só aparece dia 27.

---

## SOLUÇÃO PROPOSTA

### Princípio: Nunca zerar saídas em dias com NFC-e comprovada

O sistema deve respeitar a realidade fiscal: se existem NFC-e emitidas num dia, houve venda. O estoque escritural deve se ajustar à realidade, não o contrário.

### Fase 1: Detectar entradas não declaradas (fantasmas)

Quando o motor detecta que `tempStock` vai para zero mas ainda há saídas (NFC-e), isso indica que houve uma entrada não declarada. O sistema deve:

1. Calcular o **deficit** = total de saídas nos dias sem estoque
2. Identificar a **próxima entrada** real (no exemplo: 10.000L dia 27)
3. **Antecipar** parte da entrada para os dias anteriores, ou **redistribuir** as saídas preservando um mínimo por dia

### Fase 2: Implementar "Venda Mínima por NFC-e"

**Regra nova:** Se um dia possui NFC-e no SPED (documentos_c100 com cod_mod='65'), a `vol_saidas_ajustado` NUNCA pode ser zero.

```
Para cada dia com NFC-e:
  venda_minima = MAX(saida_original * 0.01, 0.001)  // pelo menos 0,1% da venda real
```

Isso garante que o SPED exportado SEMPRE mostra alguma saída quando há nota fiscal.

### Fase 3: Redistribuição inteligente do deficit

Em vez de cortar saídas para zero nos dias sem estoque, o motor deve:

**Opção A - Redistribuir para trás (preferível):**
- Quando detectar que dias futuros ficarão sem estoque, REDUZIR proporcionalmente as saídas dos dias ANTERIORES (que tinham estoque de sobra)
- Isso "espalha" o corte por mais dias, mantendo todas as saídas > 0

**Opção B - Antecipar a entrada:**
- Se a próxima entrada real é próxima (ex: 5 dias), antecipar parcialmente
- `tempStock += entrada_futura * fator_antecipacao`
- Ajustar a entrada no dia real para (entrada - antecipado)
- RISCO: muda o dia da entrada no SPED

**Opção C - Usar o fech_fisico original como âncora:**
- O SPED original mostra fech_fisico > 0 nesses dias (ex: 4.089, 2.516, etc.)
- Isso prova que havia estoque REAL no tanque
- Usar esses valores como estoque disponível ao invés de calcular pela cascata

### Fase 4: Implementação no código

**Arquivo:** `backend/server.js`

**Local 1 - Motor V7 (linha 3664-3676):**
Modificar para nunca cortar abaixo de um mínimo quando há saída original:

```javascript
// ANTES:
if (c.saidaCalc > maxSaidaPermitida) {
    c.saidaCalc = Math.max(0, maxSaidaPermitida);
}

// DEPOIS:
if (c.saidaCalc > maxSaidaPermitida) {
    // Nunca zera completamente se havia saída real
    const minimoVenda = c.saidaOrig > 0 ? Math.max(0.001, c.saidaOrig * 0.01) : 0;
    c.saidaCalc = Math.max(minimoVenda, maxSaidaPermitida);
}
```

**Local 2 - Após o Motor V7, antes do Motor V5 (linha ~3677):**
Adicionar detecção de "gap de estoque" e redistribuição:

```javascript
// DETECTOR DE GAP: Se dias consecutivos tiveram saída cortada,
// redistribuir o corte para dias anteriores que tinham folga
let diasCortados = calcs.filter(c => c.saidaCalc < c.saidaOrig * 0.1 && c.saidaOrig > 10);
if (diasCortados.length > 0) {
    let totalCortado = diasCortados.reduce((s, c) => s + (c.saidaOrig - c.saidaCalc), 0);
    let diasComFolga = calcs.filter(c => c.saidaCalc >= c.saidaOrig * 0.9);
    if (diasComFolga.length > 0) {
        // Redistribuir: tirar um pouco de cada dia com folga
        let porDia = totalCortado / diasComFolga.length;
        for (let d of diasComFolga) {
            let maxReduzir = d.saidaCalc * 0.3; // no máximo 30% de redução
            d.saidaCalc -= Math.min(porDia, maxReduzir);
        }
        // Devolver aos dias cortados proporcionalmente
        let recalcStock = aberturaInicialConsolidada;
        for (let c of calcs) {
            let maxS = recalcStock + c.entradasOrig - 0.5;
            if (c.saidaCalc > maxS) c.saidaCalc = Math.max(c.saidaOrig * 0.01, maxS);
            recalcStock = recalcStock + c.entradasOrig - c.saidaCalc;
        }
    }
}
```

**Local 3 - Validação pós-cascata (novo):**
Após todas as otimizaç��es, verificar se algum dia com NFC-e ficou com saída zero:

```javascript
// TRAVA FINAL: Dias com NFC-e não podem ter saída zero
// (requer consulta ao banco: documentos_c100 com cod_mod='65' por dia)
for (let c of calcs) {
    if (c.saidaCalc === 0 && c.saidaOrig > 0) {
        // Forçar saída mínima simbólica
        c.saidaCalc = Math.max(0.001, c.saidaOrig * 0.001);
    }
}
```

### Fase 5: Testes

1. Testar com Auto Posto Apache Dez/2024 — verificar que dias 22-26 mantêm saída > 0
2. Testar que o ANP continua respeitado (≤ 0,60%)
3. Testar que o estoque nunca fica negativo no SPED exportado
4. Testar com outros postos que tenham o mesmo padrão

---

## PRIORIDADE

1. **CRÍTICA:** Implementar trava que nunca zera saída quando há saída original > 0
2. **ALTA:** Redistribuição inteligente do deficit (espalhar corte)
3. **MÉDIA:** Detecção automática de entradas fantasma
4. **BAIXA:** Relatório de dias com NFC-e vs saída LMC

---

## RISCOS

- Se forçar vendas sem estoque, o escritural pode ficar negativo → precisa do escudo ANP ajustar perda/ganho
- Se redistribuir demais, outros dias podem ficar com ANP > 0,60%
- O fech_fisico do SPED original (4.089L no dia 22) prova que o tanque tinha combustível — usar como âncora é a abordagem mais segura

---

*Plano baseado na análise do Motor V7 (Curandeiro Analítico) e simulação com dados reais.*
