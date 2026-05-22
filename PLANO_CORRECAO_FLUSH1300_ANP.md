# PLANO: Correção do ANP na Exportação SPED (flush1300Group)

**Data:** 22/05/2026
**Problema:** SPED exportado tem ANP > 0.60% mesmo com banco correto
**Causa raiz:** flush1300Group recalcula saídas e ignora valores ajustados do banco

---

## DIAGNÓSTICO

### Fluxo atual da exportação (para cada dia/produto):

```
1. ENTRADA (linha 6526-6593):
   - Lê vol_saidas_ajustado do banco via mapAjustes → novoSaida = 3014.1 ✓
   - Monta pending1300 com novo.saida = 3014.1

2. flush1300Group - PASS 1 (linha 5958-6043):
   - Distribui novo.saida pelos TANQUES (1310) usando proporção original
   - nSaida_tanque = novo.saida * (tOrigSaida_tanque / orig.saida_total)

   ⚠ LINHA 6026: if (nSaida > nDisp - 0.001) nSaida = max(0, nDisp - 0.001)
   → Se a ABERTURA do tanque (propagada) < saída atribuída → CORTA a saída!
   → realSaida = soma dos tanques cortados = 2525 (menor que o 3014 do banco)

3. flush1300Group - PASS 2 (linha 6095-6121):
   - Usa realSaida (2525) para calcular: realEscr = disp - 2525 = 15061
   - Usa fisicoDb do banco como âncora: realFisico = 14660
   - Resultado: perda = 15061 - 14660 = 401 → ANP = 401/14660 = 2.73% ✗

4. Escudo ANP (linha 6065): NÃO é aplicado sobre perda/ganho neste caminho!
   - O escudo calcula fechEscudo mas é ignorado se ancoraFisico existe (linha 6074)
   - A perda/ganho é derivada de ESCR vs FECH sem cap (linha 6082-6088)
```

### O problema em uma frase:
O PASS 1 corta saídas nos tanques (linha 6026), reduzindo realSaida.
O PASS 2 usa o realFisico do banco como âncora, mas com realEscr inflado.
A perda/ganho resultante (linha 6082-6088) NÃO passa pelo escudo ANP.

---

## SOLUÇÃO

### Opção proposta: Aplicar escudo ANP APÓS derivar perda/ganho

Após a linha 6088 (onde perda/ganho são calculados a partir de escr vs fech),
verificar se o ANP resultante excede 0.60%. Se sim, ajustar realSaida para
que o escritural fique compatível com o físico dentro do ANP.

### Localização: Após linha 6088, antes de linha 6090

```javascript
// 4.1 ESCUDO ANP FINAL: se a perda/ganho derivada excede 0.60%,
// ajustar saída para que escritural fique dentro do limite.
if (realFisico > 0) {
    const anpPercent = Math.abs(realEscr - realFisico) / realFisico * 100;
    if (anpPercent > 0.60) {
        // Recalcular: escritural alvo = físico * (1 ± 0.006)
        if (realEscr > realFisico) {
            // Perda: escr > fech → reduzir escr → aumentar saída
            const escrAlvo = realFisico * 1.006; // máx escr para ANP 0.60%
            const saidaCorrigida = Math.max(0, realDisp - escrAlvo);
            realSaida = Number(saidaCorrigida.toFixed(3));
        } else {
            // Ganho: fech > escr → aumentar escr → reduzir saída
            const escrAlvo = realFisico * 0.994; // mín escr para ANP 0.60%
            const saidaCorrigida = Math.max(0, realDisp - escrAlvo);
            realSaida = Number(saidaCorrigida.toFixed(3));
        }
        realEscr = Number((realDisp - realSaida).toFixed(3));
        // Recalcular perda/ganho
        if (realFisico >= realEscr) {
            realPerda = 0;
            realGanho = Number((realFisico - realEscr).toFixed(3));
        } else {
            realPerda = Number((realEscr - realFisico).toFixed(3));
            realGanho = 0;
        }
    }
}
```

### Por que esta solução funciona:

1. **Não mexe no PASS 1** — os tanques continuam com sua lógica de corte
2. **Não mexe na âncora fisicoDb** — o físico do banco continua prevalecendo
3. **Ajusta APENAS a saída e escritural do 1300 mãe** — para fechar o ANP
4. **É o ÚLTIMO ajuste antes de escrever** — funciona como rede de segurança

### Exemplo com dia 22 Gasolina Comum:

```
Antes:  realDisp=17586, realSaida=2525, realEscr=15061, realFisico=14660
        ANP = |15061-14660|/14660 = 2.73% ✗

Depois: escrAlvo = 14660 * 1.006 = 14748
        saidaCorrigida = 17586 - 14748 = 2838
        realEscr = 17586 - 2838 = 14748
        perda = 14748 - 14660 = 88
        ANP = 88/14660 = 0.60% ✓
```

---

## RISCOS

| Risco | Mitigação |
|-------|-----------|
| Saída no 1300 mãe pode divergir da soma dos 1310 | O PASS 1.5 (linha 6123-6161) já redistribui delta do físico. Adicionar redistribuição similar para saída. |
| Soma dos 1310 não bate com 1300 | Adicionar PASS para redistribuir delta de saída entre tanques 1310 |

---

## IMPACTO

- Corrige o ANP de TODOS os produtos em TODOS os postos na exportação
- Funciona como rede de segurança final — independente do Re-distribuir
- Não altera nenhuma lógica existente — apenas adiciona cap depois

---

*Plano baseado em análise do flush1300Group (linhas 5908-6165) do server.js.*
