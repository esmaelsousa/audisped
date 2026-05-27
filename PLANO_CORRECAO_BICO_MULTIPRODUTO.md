# PLANO DE CORREÇÃO: Bico Multiproduto (Bomba Dupla)

**Data:** 27/05/2026
**Problema:** Bico compartilhado entre 2 combustíveis gera encerrante duplicado
**Empresa exemplo:** REDE JG SOUZA (34733564000155) - Set/2022
**Impacto:** Continuidade diária dos encerrantes quebrada

---

## 1. O QUE É O PROBLEMA

Postos com **bombas duplas** têm UM bico físico que abastece 2 combustíveis.
Exemplo: Bico 03 abastece ETANOL e DIESEL S10.

No SPED original, o bico 03 aparece em dois produtos:

```
|1300|7085 (ETANOL)|26/09/2022|...
  |1310|T679|...
    |1320|03|...|842.439|840.732|0|1.707|  ← vendas ETANOL

|1300|7087 (DIESEL)|26/09/2022|...
  |1310|T680|...
    |1320|03|...|842.439|840.732|0|1.707|  ← MESMOS encerrantes!
```

Os encerrantes são **IGUAIS** porque é a mesma bomba física.

## 2. COMO O EXPORTADOR FUNCIONA HOJE (ERRADO)

Processa cada produto em flush separado:

```
Flush 1: ETANOL dia 26
  → Bico 03: enc_inic = 841.096 (acumulado)
  → vendas = 1.707
  → enc_final = 841.096 + 1.707 = 842.803
  → encerrantesBombasMap[03] = 842.803  ← ATUALIZA

Flush 2: DIESEL S10 dia 26
  → Bico 03: enc_inic = 842.803 (pegou do ETANOL!)
  → vendas = 1.707 (mesmas vendas — mesmo bico)
  → enc_final = 842.803 + 1.707 = 844.510
  → encerrantesBombasMap[03] = 844.510  ← ATUALIZA DE NOVO!

RESULTADO: enc avançou 1.707 x 2 = 3.414 (DOBRO do real!)
```

## 3. COMO DEVE FICAR (CORRETO)

```
Flush 1: ETANOL dia 26
  → Bico 03: enc_inic = 841.096, vendas = 1.707, enc_final = 842.803
  → encerrantesBombasMap[03] = 842.803 ✓

Flush 2: DIESEL S10 dia 26
  → Bico 03: detecta MULTIPRODUTO (mesmo encAbertOrig do flush anterior)
  → enc_inic = enc_final = 842.803 (da cadeia, NÃO avança)
  → vendas = volume calculado pelo fator (para bater com 1310)
  → encerrantesBombasMap[03] = 842.803 (NÃO MUDA)

RESULTADO: enc avançou apenas 1.707 ✓

Dia 27:
  Flush ETANOL bico 03: enc_inic = 842.803 ✓ (continuidade OK)
```

## 4. ONDE ALTERAR NO CÓDIGO

**Arquivo:** `server.js`, `flush1300Group`, seção de processamento 1320

### 4.1 Alterar bicosProcessadosNesteFlush para armazenar encOrig

```javascript
// ANTES:
bicosProcessadosNesteFlush.set(bicoNum, volBicoCalculado);

// DEPOIS:
bicosProcessadosNesteFlush.set(bicoNum, { vendas: volBicoCalculado, encOrig: encAbertOrig });
```

### 4.2 Na detecção de duplicata, verificar multiproduto ANTES de zerar

```javascript
if (bicosProcessadosNesteFlush.has(bicoNum)) {
    const anterior = bicosProcessadosNesteFlush.get(bicoNum);

    // Bico multiproduto: mesmo bico já processado E mesmo enc_inic original
    // (prova que é a mesma bomba física em outro produto)
    const isMultiproduto = anterior && anterior.encOrig !== undefined
        && Math.abs(encAbertOrig - anterior.encOrig) < 0.01;

    if (isMultiproduto) {
        // Manter enc da cadeia acumulada, vendas proporcional ao tanque
        const encAtual = encerrantesBombasMap[bicoNum] || 0;
        bFields[9] = encAtual.toFixed(3).replace('.', ',');  // enc_inic
        bFields[8] = encAtual.toFixed(3).replace('.', ',');  // enc_final (mesmo = sem avançar)
        bFields[11] = volBicoCalculado.toFixed(3).replace('.', ',');  // vendas do fator
        bFields[10] = '0,000';
        linhas1310.push(bFields.join('|'));
        // NÃO atualizar encerrantesBombasMap (já avançou no 1º flush)
        continue;
    }

    // Duplicata normal (não multiproduto) — lógica existente
    ...
}
```

## 5. IMPACTO NAS FUNÇÕES EXISTENTES

| Função | Impacto | Motivo |
|--------|---------|--------|
| flush1300Group | ALTERA | Nova detecção de multiproduto |
| encerrantesBombasMap | NÃO | Continua global, só não avança 2x |
| bicosProcessadosNesteFlush | ALTERA | Armazena encOrig além de vendas |
| Bomba parada (Caso A/B/C) | NÃO | Detectada ANTES da duplicata |
| Fantasma (enc=0) | NÃO | Detectada ANTES da duplicata |
| Redistribuição tanques | NÃO | Atua no PASS 1 (antes dos bicos) |
| Escudo ANP | NÃO | Atua no PASS 2 (depois dos bicos) |
| calcularSincronizacaoPreview | NÃO | Função separada (Re-distribuir) |

**RISCO:** BAIXO — a condição `isMultiproduto` só dispara quando:
1. O bico já foi processado neste dia (bicosProcessadosNesteFlush)
2. O `encAbertOrig` é IGUAL ao do registro já processado (< 0.01 diferença)

Isso só acontece em bombas duplas reais. Bicos normais não satisfazem a condição.

## 6. COMO VALIDAR

**Caso de teste:** REDE JG SOUZA (34733564000155) Set/2022
- Bico 03: ETANOL (T679) + DIESEL S10 (T680)
- Bico 04: DIESEL S-500 (T677) + DIESEL S10 (T680)

Verificar após exportar:
1. Continuidade diária bico 03: enc_final dia N = enc_inic dia N+1
2. Continuidade diária bico 04: idem
3. 1320 x 1300: soma bicos = saída LMC
4. Outros postos sem bico multiproduto: comportamento inalterado

---

*Plano baseado em análise forense do SPED Set/2022 da REDE JG SOUZA.*
