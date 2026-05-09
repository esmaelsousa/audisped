# PLANO DE CORRECAO — EXPORTACAO REGISTRO 1300

Data: 09/05/2026
Arquivo de referencia: AUTO POSTO ESPLANADA LTDA (CNPJ 12.656.384/0002-65) — Jan/2022
Status: AGUARDANDO APROVACAO — Nenhuma alteracao sera aplicada sem autorizacao.

---

## DIAGNOSTICO — CAUSA RAIZ IDENTIFICADA

### O arquivo SPED original tem dados CORROMPIDOS nos tanques 1310 da Gasolina

O gerador original do SPED (sistema do posto ou contabilidade) confundiu
LEITURAS DE ENCERRANTES com ESTOQUES DE TANQUE. Exemplo real do dia 01/01/2022:

```
ORIGINAL — Gasolina (7084) dia 01/01:
  1300: ABERT=7.965,227  ESCR=7.377,381  FECH=0,000  (1300 correto no ABERT)
  1310 tank=18: ABERT=68.178,879  ← ENCERRANTE (nao eh estoque!)
  1310 tank=21: ABERT=-60.213,652 ← NEGATIVO ABSURDO (compensacao)
                Soma: 68178 + (-60213) = 7965 (bate com 1300, mas dados sao lixo)
```

A rotina de exportacao calcula PROPORCOES baseadas nos tanques originais:
- Tank 18: proporcao = 68178 / 7965 = 8.56 (proporcao > 1 — INVALIDA)
- Tank 21: proporcao = -60213 / 7965 = -7.56 (proporcao NEGATIVA)

Essas proporcoes absurdas corrompem toda a redistribuicao:
- Os valores exportados ficam inflados (ABERT exportado = 68.179 em vez de 7.965)
- PERDA e GANHO ficam NEGATIVOS (proporcao negativa * valor positivo = negativo)
- A continuidade quebra porque FECH fica em 67.817 em vez de 7.377

---

## ERROS ENCONTRADOS NA AUDITORIA

| # | Erro | Produto | Gravidade | Causa |
|---|---|---|---|---|
| 1 | VAL_AJ_PERDA e GANHO negativos (22 campos, 11 dias) | Gasolina | CRITICA | Proporcao negativa do tank 21 |
| 2 | Continuidade quebrada — 5 saltos criticos (até 63.703 L) | Gasolina | CRITICA | ABERT inflado pela redistribuicao |
| 3 | Continuidade quebrada — 22 saltos menores (3-8 L) | Gasolina | RELEVANTE | Proporcoes distorcidas |
| 4 | Continuidade quebrada — 28 quebras sistematicas (3-8 L) | Diesel Comum | RELEVANTE | FECH redistribuido difere do FECH do banco |
| 5 | Continuidade quebrada — 7 quebras menores (2-6 L) | Diesel S10 | RELEVANTE | Mesmo mecanismo do Diesel |

---

## CORRECOES PROPOSTAS

### CORRECAO 1 — Saneamento de PERDA/GANHO negativos
**Arquivo:** `backend/server.js`
**Funcao:** `flush1300Group()` — logo apos calcular realPerda e realGanho (linha ~5357)

**O que fazer:**
Apos somar realPerda e realGanho de todos os tanques, se algum for negativo,
recalcular baseado na relacao FECH vs ESCR:

```javascript
// Saneador: PERDA e GANHO nunca podem ser negativos no SPED
if (realPerda < 0 || realGanho < 0) {
    if (realFisico >= realEscr) {
        realPerda = 0;
        realGanho = Number((realFisico - realEscr).toFixed(3));
    } else {
        realPerda = Number((realEscr - realFisico).toFixed(3));
        realGanho = 0;
    }
}
```

**Risco:** Baixo. So atua quando ha negativos (que ja sao invalidos).
**Reversibilidade:** git revert do commit.

---

### CORRECAO 2 — Proporcoes absurdas na redistribuicao por tanques
**Arquivo:** `backend/server.js`
**Funcao:** `flush1300Group()` — calculo de pAbert, pSaida, pEntr (linhas ~5306-5308)

**O que fazer:**
Antes de usar as proporcoes, validar se sao saudaveis (entre 0 e 1).
Se alguma proporcao for > 1 ou < 0, usar distribuicao igualitaria:

```javascript
let pAbert = orig.abert > 0 ? (tOrigAbert / orig.abert) : (1 / pending1310s.length);
// Saneamento: proporcao invalida = tanques originais corrompidos
if (pAbert < 0 || pAbert > 1) pAbert = 1 / pending1310s.length;

let pSaida = orig.saida > 0 ? (tOrigSaida / orig.saida) : (1 / pending1310s.length);
if (pSaida < 0 || pSaida > 1) pSaida = 1 / pending1310s.length;

let pEntr = orig.entr > 0 ? (tOrigEntr / orig.entr) : (1 / pending1310s.length);
if (pEntr < 0 || pEntr > 1) pEntr = 1 / pending1310s.length;
```

**Risco:** Medio. Muda a distribuicao entre tanques, mas so quando os dados
originais sao invalidos (proporcao fora de 0-1).
**Reversibilidade:** git revert do commit.

---

### CORRECAO 3 — Continuidade na exportacao (propagacao FECH → ABERT)
**Arquivo:** `backend/server.js`
**Funcao:** Loop principal de exportacao, bloco 1300 (apos mapAjustes/mapBaseFisico)

**O que fazer:**
Manter um mapa `ultimoFechPorProduto` que armazena o FECH_FISICO exportado de cada
produto. Ao processar o proximo dia, forcar ESTQ_ABERT = ultimo FECH exportado:

```javascript
// Antes do loop:
const ultimoFechExportado = new Map(); // cod_item -> fech_fisico

// Dentro do bloco 1300, apos calcular novoAbert:
const fechAnterior = ultimoFechExportado.get(codItem);
if (fechAnterior !== undefined && fechAnterior > 0) {
    novoAbert = Number(fechAnterior.toFixed(3));
    fields[4] = novoAbert.toFixed(3).replace('.', ',');
    // Recalcular disp, escr, fisico com o novo abert
    const disp = Number((novoAbert + entr).toFixed(3));
    fields[6] = disp.toFixed(3).replace('.', ',');
    const escr = Number((disp - novoSaida).toFixed(3));
    fields[8] = escr.toFixed(3).replace('.', ',');
    fisico = Number((escr - novoPerda + novoGanho).toFixed(3));
    if (fisico < 0) fisico = Math.max(0, escr);
    fields[11] = fisico.toFixed(3).replace('.', ',');
}

// Apos escrever o 1300 (no flush ou no pushLine):
// Extrair o FECH_FISICO final da linha exportada e armazenar
ultimoFechExportado.set(codItem, fisicoExportado);
```

**Risco:** Medio-alto. Muda ESTQ_ABERT de todos os dias (exceto dia 01).
Pode causar cascata em outros campos. Testar com cuidado.
**Reversibilidade:** git revert do commit.

**Nota:** Esta correcao precisa ser feita APOS as correcoes 1 e 2, pois
depende do FECH correto de cada dia para propagar.

---

## ORDEM DE IMPLEMENTACAO

```
Passo 1: git checkout -b fix/sped-export-1300-sanitize
Passo 2: Aplicar CORRECAO 1 (saneamento PERDA/GANHO negativos)
Passo 3: Aplicar CORRECAO 2 (proporcoes absurdas nos tanques)
Passo 4: Testar exportacao — verificar se negativos sumiram
Passo 5: Aplicar CORRECAO 3 (propagacao continuidade FECH→ABERT)
Passo 6: Exportar SPED corrigido em arquivo SEPARADO
Passo 7: Rodar auditoria automatizada no novo SPED
Passo 8: Apresentar resultado para aprovacao
```

---

## TESTES OBRIGATORIOS

### Antes de cada correcao
- [ ] Verificar que o servidor inicia sem erros de sintaxe
- [ ] Exportar o SPED do arquivo 1154 e salvar como v_antes.txt

### Apos cada correcao
- [ ] Exportar o SPED do arquivo 1154 e salvar como v_apos_correcaoN.txt
- [ ] Rodar auditoria no SPED gerado verificando:
  - [ ] Matematica 1300 (VOL_DISP, ESTQ_ESCR, FECH_FISICO)
  - [ ] PERDA >= 0 e GANHO >= 0 em todos os registros
  - [ ] Continuidade (ABERT dia N = FECH dia N-1, tolerancia 2L)
  - [ ] ANP <= 0,62% em todos os registros
  - [ ] 1320 x 1300 (soma bicos = vendas LMC)
  - [ ] 1310 x 1300 (soma tanques = FECH_FISICO)

### Teste de regressao
- [ ] Exportar pelo menos 2 outros arquivos de postos DIFERENTES
      para garantir que a correcao nao quebrou nada

---

## ARQUIVOS IMPACTADOS

| Arquivo | Funcao/Trecho | Tipo de alteracao |
|---|---|---|
| `backend/server.js` | `flush1300Group()` linhas ~5295-5370 | Saneamento de proporcoes e negativos |
| `backend/server.js` | Bloco 1300 (mapAjustes) linhas ~5538-5595 | Propagacao de continuidade |
| `backend/server.js` | Bloco 1300 (mapBaseFisico) linhas ~5596-5630 | Propagacao de continuidade |

Nenhum outro arquivo sera alterado.
Nenhum dado do banco sera modificado.

---

## RISCOS

| Risco | Probabilidade | Impacto | Mitigacao |
|---|---|---|---|
| Correcao de proporcao muda distribuicao entre tanques | Media | Medio | So ativa para proporcoes invalidas (< 0 ou > 1) |
| Propagacao de FECH→ABERT em cascata altera saidas e perdas | Media | Alto | Testar em arquivo isolado antes |
| Saneamento de negativos pode violar ANP 0,60% | Baixa | Medio | Verificar ANP apos cada correcao |
| Outro posto com tanques multi pode ser afetado | Baixa | Alto | Testar em 2+ postos diferentes |

---

## GARANTIA DE REVERSIBILIDADE

1. Branch separada (`fix/sped-export-1300-sanitize`)
2. Commits atomicos por correcao (1 commit por fix)
3. Checkpoint git antes de cada alteracao
4. SPED corrigido gerado em arquivo SEPARADO (nunca sobrescreve o original)
5. Arquivo SPED original no banco NUNCA sera alterado
6. Dados do banco (lmc_movimentacao) NAO serao modificados
7. Rollback total: `git revert HEAD~N` ou `git checkout main -- backend/server.js`

---

## STATUS

**Nenhuma alteracao foi aplicada.**
**Este plano aguarda aprovacao antes de qualquer implementacao.**

Para aprovar: informe "pode implementar" ou "aprovado".
Para ajustar: informe quais pontos deseja modificar.
