co
# PLANO DE CORREÇÃO: Continuidade LMC e Encerrantes na Exportação SPED

**Data:** 21/05/2026
**Baseado em:** Auditoria PRECO BOM II + Auto Posto Apache (Amaral)
**Objetivo:** Corrigir o sistema para que os SPEDs exportados mantenham continuidade perfeita de estoque e encerrantes entre meses.

---

## PROBLEMAS IDENTIFICADOS

### Problema 1: Mistura de campos originais e ajustados
O sistema possui dois conjuntos de campos no `lmc_movimentacao`:
- **Originais:** `estq_abert`, `vol_saidas`, `fech_fisico`, `vol_entr`
- **Ajustados:** `estq_abert_ajustado`, `vol_saidas_ajustado`, `fech_fisico_ajustado`, `vol_entr_ajustado`

Na exportação do SPED, o sistema usa valores ajustados para ALGUNS produtos e originais para outros, quebrando a continuidade.

**Exemplo real (PRECO BOM II):**
- GAS. COMUM original fech=26.267 vs ajustado=14.840 (diferença de 11.427 L)
- GAS. ADITIVADA original fech=14.401 vs ajustado=7.421 (diferença de 6.980 L)
- ETANOL: original = ajustado (sem problema)

### Problema 2: Verificação de continuidade na direção errada
O sistema verifica a continuidade comparando o fechamento de Jan/2024 com a abertura de Dez/2023, ao invés de comparar o fechamento de Nov/2023 com a abertura de Dez/2023.

### Problema 3: Encerrantes (1320) recalculados
Conforme auditoria do PRECO BOM II, os encerrantes exportados nos registros 1320 são diferentes dos originais importados. O sistema aplica um "offset" que varia por bico e por período, causando:
- 1.229 de 1.230 registros divergentes (99,9%)
- Diferença total de vendas: -3.419.052 L

### Problema 4: Quebra de continuidade de estoque entre meses
Na transição entre SPEDs exportados, o `fech_fisico` do último dia do mês anterior não corresponde ao `estq_abert` do primeiro dia do mês seguinte.

---

## PLANO DE CORREÇÃO

### FASE 1: Diagnóstico do código de exportação

**1.1 Localizar a lógica de exportação SPED**
- Arquivo: `backend/server.js` (ou módulo de exportação SPED)
- Buscar: funções que geram registros 1300, 1310, 1320
- Identificar: onde o sistema decide entre usar campos originais vs ajustados

**1.2 Mapear o fluxo de dados**
- Como os dados fluem: importação SPED → lmc_movimentacao → exportação SPED
- Em que momento os campos `_ajustado` são preenchidos
- Qual lógica decide quando usar original vs ajustado

### FASE 2: Correção da exportação de estoque (1300/1310)

**2.1 Padronizar a fonte de dados**
- REGRA: A exportação DEVE usar SEMPRE o mesmo conjunto de campos (ou sempre original, ou sempre ajustado)
- Se usar ajustados, garantir que `estq_abert_ajustado` do dia 01 do mês atual = `fech_fisico_ajustado` do último dia do mês anterior
- Se usar originais, garantir a mesma regra

**2.2 Implementar validação de continuidade pré-exportação**
Antes de exportar o SPED, o sistema deve verificar:
```
Para cada produto combustível:
  fech_fisico[último_dia_mês_anterior] == estq_abert[primeiro_dia_mês_atual]
```
Se não bater, o sistema deve:
- Alertar o usuário com os valores divergentes
- Oferecer opção de ajustar automaticamente (abertura = fechamento anterior)
- NÃO exportar até que a continuidade esteja garantida

**2.3 Garantir continuidade ao recalcular ajustes**
Quando o sistema calcula `fech_fisico_ajustado`:
- Deve recalcular em cadeia: se ajustou o mês N, ajustar também mês N+1, N+2, etc.
- O `estq_abert_ajustado` do mês N+1 deve SEMPRE ser igual ao `fech_fisico_ajustado` do mês N

### FASE 3: Correção da exportação de encerrantes (1320)

**3.1 Preservar encerrantes originais**
- Os registros 1320 devem usar os valores de encerrante ORIGINAIS do SPED importado
- Não recalcular nem substituir enc_final e enc_inicial
- Se necessário ajustar, manter um campo separado e documentar a mudança

**3.2 Garantir continuidade de encerrantes entre meses**
```
Para cada bico:
  enc_final[último_dia_mês_anterior] == enc_inicial[primeiro_dia_mês_atual]
```

**3.3 Validação de vendas (vol_vendas)**
```
Para cada bico/dia:
  vol_vendas == enc_final - enc_inicial - vol_aferição
```

### FASE 4: Correção da verificação de continuidade

**4.1 Corrigir a direção da verificação**
O sistema deve verificar continuidade na ordem CRONOLÓGICA:
- Fech de Mês N (último dia) → Abert de Mês N+1 (primeiro dia)
- NÃO comparar meses na ordem inversa

**4.2 Implementar verificação em cascata**
Ao exportar o mês N, verificar automaticamente:
1. Abert mês N == Fech mês N-1
2. Enc_inicial bico dia 01 mês N == Enc_final bico último dia mês N-1
3. Se houver divergência, alertar ANTES de gerar o arquivo

### FASE 5: Testes e validação

**5.1 Criar suite de testes automatizados**
- Teste de continuidade de estoque entre TODOS os meses de uma empresa
- Teste de continuidade de encerrantes entre TODOS os meses
- Teste de vendas = enc_final - enc_inicial
- Teste de vol_saidas LMC vs volume NFC-e por produto/dia

**5.2 Auditoria retroativa**
- Rodar a verificação em TODAS as empresas do sistema
- Gerar relatório de divergências
- Priorizar correção das empresas com mais irregularidades

---

## IMPACTO DA CORREÇÃO

| Item | Antes | Depois |
|------|-------|--------|
| Estoque entre meses | Divergente (campos misturados) | Contínuo (campo padronizado) |
| Encerrantes entre meses | 99,9% divergentes | 100% contínuos |
| Vendas por bico | 47% divergentes | Corretas (baseadas em encerrantes preservados) |
| Verificação de continuidade | Direção invertida | Ordem cronológica |
| Validação pré-exportação | Inexistente | Bloqueante (não exporta com erro) |

---

## ARQUIVOS A INVESTIGAR

1. `backend/server.js` - Lógica de exportação SPED (registros 1300, 1310, 1320)
2. Funções que calculam campos `_ajustado` na tabela `lmc_movimentacao`
3. Endpoint de exportação SPED (rota da API)
4. Lógica de verificação de continuidade (se existir)

---

## PRIORIDADE

1. **CRÍTICA:** Padronizar uso de campos original vs ajustado na exportação
2. **CRÍTICA:** Preservar encerrantes originais no 1320
3. **ALTA:** Implementar validação pré-exportação
4. **ALTA:** Corrigir direção da verificação de continuidade
5. **MÉDIA:** Testes automatizados
6. **MÉDIA:** Auditoria retroativa de todas as empresas

---

*Plano gerado com base na auditoria DE-PARA de PRECO BOM II e Auto Posto Apache.*
