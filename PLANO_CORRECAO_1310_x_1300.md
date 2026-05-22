# PLANO — Correcao da Divergencia 1310 x 1300 (FECH_FISICO)

## Problema

Ao exportar o SPED, o FECH_FISICO do registro 1300 (mae) nao bate com a soma
dos FECH_FISICO dos registros 1310 (tanques filhos). O arquivo original esta
perfeito — o erro e introduzido pelo processo de exportacao.

Exemplo real (CNPJ 09153856000171, Janeiro/2025, dia 01/01, GASOLINA 7084):

| Registro | FECH_FISICO | Origem |
|----------|-------------|--------|
| 1300 mae | 91.730,806 | Recalculado no PASS 2 (ancora/escudo ANP) |
| 1310 tanque 692 | 36.380,818 | Calculado no PASS 1 (proporcional) |
| 1310 tanque 691 | 55.574,209 | Calculado no PASS 1 (proporcional) |
| Soma 1310 | **91.955,027** | |
| Diferenca | **+224,221** | |

Afeta: todos os 4 produtos, todos os 31 dias do mes = **124 divergencias**.

---

## Causa Raiz

A funcao `flush1300Group()` (server.js, linhas 5579-5870) tem 3 passes:

### PASS 1 (linhas 5629-5694) — Calcula valores por tanque
- Distribui ABERT, SAIDA, ENTR, PERDA, GANHO do 1300 pelos tanques via proporcao
- Calcula `nFisico = nEscr - nPerda + nGanho` para cada tanque
- Acumula `realFisico += nFisico` (soma dos tanques)

### PASS 2 (linhas 5696-5777) — Recalcula o 1300 mae
- Recalcula `realEscr = realDisp - realSaida`
- Aplica escudo ANP: `fechEscudo = escudoAnpMae(realAbert, realEntr, realEscr, 0, 0)`
- Tenta ancora do banco: `ancoraFisico = novo.fisicoDb`
- Se ancora dentro de 0.60% → `realFisico = ancoraFisico`
- Se ancora fora → `realFisico = fechEscudo`
- Deriva PERDA/GANHO a partir do novo realFisico
- **ESCREVE o 1300 com o novo realFisico**

### PASS 3 (linhas 5786-5870) — Imprime os 1310 filhos
- Imprime cada tanque usando `curated.nFisico` (valor do PASS 1)
- **NAO redistribui a diferenca criada no PASS 2**

### O que acontece

```
PASS 1: realFisico = sum(nFisico dos tanques) = 91.955,027  (soma correta dos tanques)
PASS 2: realFisico = 91.730,806                              (ancora do banco ou escudo ANP)
PASS 3: imprime tanques com os valores do PASS 1             (91.955,027)

Resultado: 1300.FECH = 91.730,806 vs sum(1310.FECH) = 91.955,027 → diff = 224,221
```

O PASS 2 muda o `realFisico` do mae SEM redistribuir essa diferenca para os
filhos. Isso viola a regra fundamental do SPED:

> **FECH_FISICO do 1300 DEVE ser igual a soma dos FECH_FISICO dos 1310 filhos.**

---

## Solucao

### Principio

Apos o PASS 2 definir o `realFisico` final do 1300 mae, redistribuir a
diferenca proporcionalmente entre os tanques 1310, de modo que
`sum(1310.FECH) == 1300.FECH` sempre.

### Onde inserir o codigo

Entre o PASS 2 (linha 5777, apos escrever o 1300) e o PASS 3 (linha 5786,
antes de imprimir os 1310). Na verdade, ANTES de escrever o 1300 (pushLine)
e ANTES do PASS 3.

O ponto exato e entre a linha 5777 (fields1300[11] = realFisico) e a
linha 5779 (pushLine). Ou, mais precisamente, apos definir realFisico e
realPerda/realGanho finais (linha 5749), e antes do PASS 2 que escreve o 1300.

### Logica da redistribuicao (PASS 1.5)

```
// Apos PASS 2 definir realFisico final, ANTES de escrever qualquer linha:

let somaFisicoTanques = 0;
for (const tk of pending1310s) {
    somaFisicoTanques += tk._curated.nFisico;
}

let deltaFisico = realFisico - somaFisicoTanques;

// Se a diferenca for significativa (> 0.001), redistribuir
if (Math.abs(deltaFisico) > 0.001 && pending1310s.length > 0) {
    // Redistribui proporcionalmente pelo peso de cada tanque
    let somaRedist = 0;
    for (let i = 0; i < pending1310s.length; i++) {
        let tk = pending1310s[i];
        let isLast = (i === pending1310s.length - 1);

        if (isLast) {
            // Ultimo tanque absorve residuo de arredondamento
            let ajuste = deltaFisico - somaRedist;
            tk._curated.nFisico = Number((tk._curated.nFisico + ajuste).toFixed(3));
        } else {
            let peso = somaFisicoTanques > 0
                ? (tk._curated.nFisico / somaFisicoTanques)
                : (1 / pending1310s.length);
            let ajuste = Number((deltaFisico * peso).toFixed(3));
            tk._curated.nFisico += ajuste;
            somaRedist += ajuste;
        }

        // Recalcular PERDA/GANHO do tanque para manter formula PVA:
        // FECH = ESCR - PERDA + GANHO
        if (tk._curated.nFisico >= tk._curated.nEscr) {
            tk._curated.nPerda = 0;
            tk._curated.nGanho = Number((tk._curated.nFisico - tk._curated.nEscr).toFixed(3));
        } else {
            tk._curated.nPerda = Number((tk._curated.nEscr - tk._curated.nFisico).toFixed(3));
            tk._curated.nGanho = 0;
        }
    }
}

// Agora sim, escrever o 1300 mae e depois os 1310 (PASS 3)
```

### Cuidados para nao gerar novos erros

1. **Formula PVA dos tanques**: Ao ajustar nFisico do 1310, PERDA e GANHO
   devem ser rederivados (FECH = ESCR - PERDA + GANHO). O codigo acima ja faz isso.

2. **nFisico negativo**: Se o ajuste for grande e negativo, um tanque pequeno
   pode ficar com nFisico < 0. Tratar com `Math.max(0, ...)` e jogar o excedente
   para o proximo tanque.

3. **Escudo ANP por tanque**: O PASS 1 ja tem escudo ANP individual (linhas
   5655-5660) para o ultimo tanque. Apos a redistribuicao, o escudo ANP INDIVIDUAL
   NAO deve ser reaplicado — o escudo ANP ja foi aplicado no nivel mae (PASS 2).
   Os tanques sao LIVRES para ter PERDA/GANHO maiores que 0.60% individualmente,
   desde que o MAE esteja dentro do limite.

4. **Arredondamento**: O ultimo tanque absorve o residuo (`deltaFisico - somaRedist`)
   para garantir igualdade exata.

5. **Tanque unico**: Se ha apenas 1 tanque (7085, 7087, 7126 neste arquivo),
   nFisico do tanque = realFisico do mae. Nao precisa de proporcao.

6. **1320 (bicos)**: Os bicos sao filhos do 1310 e usam `curated.nSaida`,
   nao `curated.nFisico`. A redistribuicao do FECH nao afeta os bicos.
   Os encerrantes dos bicos continuam corretos.

---

## Impacto nos Arquivos

| Arquivo | Mudanca | Risco |
|---------|---------|-------|
| `backend/server.js` — flush1300Group() | Adicionar ~25 linhas entre PASS 2 e PASS 3 | Baixo |
| Todos os outros | Nenhuma | Zero |

---

## Validacao pos-implementacao

Para cada dia, para cada produto:
```
FECH_FISICO do 1300 == soma dos FECH_FISICO dos 1310 filhos
```

Tolerancia: 0.001 litros (arredondamento de 3 casas decimais)

Comando de verificacao (rodar no arquivo exportado):
```bash
# Extrair 1300 e somar 1310 filhos, comparar
awk -F'|' '
/^\|1300\|/ { cod=$3; dt=$4; fech1300=$12; sum1310=0; next }
/^\|1310\|/ { sum1310 += $11; next }
/^\|1300\|/ || /^\|[^1]/ {
    if (cod != "" && fech1300+0 != sum1310+0) {
        diff = fech1300 - sum1310;
        if (diff > 0.002 || diff < -0.002)
            printf "%s %s FECH=%s SOMA1310=%s DIFF=%.3f\n", dt, cod, fech1300, sum1310, diff
    }
    cod=""
}
' arquivo_exportado.txt
```

Resultado esperado apos correcao: **nenhuma linha de saida** (zero divergencias).

---

## Resumo visual do fluxo corrigido

```
PASS 1:  Calcula valores por tanque (proporcional)
            ↓
         sum(nFisico) = S1

PASS 2:  Recalcula 1300 mae (ancora/escudo ANP)
            ↓
         realFisico = R (pode ser diferente de S1)

PASS 1.5 (NOVO):  delta = R - S1
                   Redistribui delta entre tanques
                   sum(nFisico ajustado) = R  ← GARANTIDO
            ↓
PASS 3:  Escreve 1310 com nFisico ajustado
         Escreve 1320 (bicos) — inalterado
```

---

## Status

- [ ] Implementar PASS 1.5 (redistribuicao)
- [ ] Testar com arquivo 09153856000171_20250101_20250131
- [ ] Validar: zero divergencias 1310 x 1300
- [ ] Validar: ANP mae continua <= 0.60%
- [ ] Validar: formula PVA dos tanques (FECH = ESCR - PERDA + GANHO)
- [ ] Validar: encerrantes 1320 nao afetados

**Criado em:** 11/05/2026
**Prioridade:** Alta — afeta validacao PVA
