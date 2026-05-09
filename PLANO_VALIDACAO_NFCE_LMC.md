# PLANO DE IMPLEMENTAÇÃO — VALIDAÇÃO NFC-e x LMC (Registro 1300)

**Data de criação:** 09/05/2026  
**Status:** Aguardando implementação  
**Prioridade:** Alta — risco fiscal de notificação por dias com NFC-e sem saída no LMC

---

## CONTEXTO E OBJETIVO

O sistema já faz redistribuição automática do LMC respeitando o limite ANP de 0,60%.
O problema: durante a redistribuição, o motor pode zerar a saída de um dia que possui
NFC-e modelo 65 emitida. Isso cria divergência fiscal: o documento diz que houve venda,
o LMC diz que não houve.

**Regra fiscal obrigatória:**
> Se existe C100 modelo 65 com VL_DOC > 0 em um dia → o Registro 1300 DEVE ter
> vol_saidas > 0 nesse dia.

---

## PRINCÍPIO DE IMPLEMENTAÇÃO

**Não modificar nenhuma função existente.**
Toda a nova lógica entra em arquivos separados, controlada por feature flag.
O comportamento atual fica 100% preservado enquanto a flag estiver desligada.

---

## ESTRUTURA DE ARQUIVOS NOVOS

```
backend/
  validacoes/
    nfce_lmc.js       ← verificarDiasProtegidos() — somente leitura
    resolver_lmc.js   ← algoritmo de resolução automática (look-back)
  server.js           ← INALTERADO (apenas +5 linhas com feature flag)
```

---

## PEÇA 1 — verificarDiasProtegidos (nfce_lmc.js)

Função somente leitura. Cruza documentos_c100 (NFC-e 65) com lmc_movimentacao.
Retorna: dias com NFC-e, dias com LMC zerado, dias problemáticos (intersecção).

```javascript
async function verificarDiasProtegidos(pool, idSpedArquivo) {
  const nfceDias = await pool.query(`
    SELECT DISTINCT
      TO_CHAR(dt_doc, 'DDMMYYYY') AS data_mov,
      COUNT(*)                    AS qtde_nfce,
      SUM(vl_doc)                 AS valor_total
    FROM documentos_c100
    WHERE id_sped_arquivo = $1
      AND cod_mod = '65'
      AND vl_doc > 0
    GROUP BY dt_doc
    ORDER BY dt_doc
  `, [idSpedArquivo]);

  const lmcZerado = await pool.query(`
    SELECT
      data_mov,
      cod_item,
      COALESCE(vol_saidas_ajustado, vol_saidas) AS saida_atual
    FROM lmc_movimentacao
    WHERE id_sped_arquivo = $1
      AND COALESCE(vol_saidas_ajustado, vol_saidas) = 0
  `, [idSpedArquivo]);

  const diasProblema = nfceDias.rows.filter(nf =>
    lmcZerado.rows.some(lmc => lmc.data_mov === nf.data_mov)
  );

  return {
    diasProtegidos: nfceDias.rows,
    diasProblema:   diasProblema,
    temProblema:    diasProblema.length > 0
  };
}

module.exports = { verificarDiasProtegidos };
```

---

## PEÇA 2 — Endpoint de diagnóstico (somente leitura)

Adicionar em server.js (não modifica nada existente):

```javascript
// GET /api/lmc/diagnostico-nfce/:id
app.get('/api/lmc/diagnostico-nfce/:id', async (req, res) => {
  const { verificarDiasProtegidos } = require('./validacoes/nfce_lmc');
  const resultado = await verificarDiasProtegidos(pool, req.params.id);
  return res.json(resultado);
});
```

---

## PEÇA 3 — Feature flag no confirmar-sincronizacao

Adicionar APENAS estas linhas no TOPO do handler existente (antes do código atual):

```javascript
// --- VALIDAÇÃO NFC-e (feature flag) ---
const VALIDAR_NFCE = process.env.VALIDAR_NFCE_LMC === 'true';
if (VALIDAR_NFCE) {
  const { verificarDiasProtegidos } = require('./validacoes/nfce_lmc');
  const diagnostico = await verificarDiasProtegidos(pool, idArquivo);
  if (diagnostico.temProblema) {
    return res.status(422).json({
      tipo: 'NFCE_SEM_LMC',
      avisos: diagnostico.diasProblema
    });
  }
}
// --- FIM VALIDAÇÃO NFC-e ---
// ... código existente continua inalterado abaixo
```

Flag no .env (começa desligada):
```
VALIDAR_NFCE_LMC=false
```

---

## PEÇA 4 — Algoritmo de resolução automática (resolver_lmc.js)

### Três causas e três resoluções automáticas:

#### CAUSA 1 — Estoque zero no dia protegido → Look-back
Busca para trás um dia doador com estoque sobrando.
Reduz saída do doador em δ. Estoque flui para o dia protegido.

#### CAUSA 2 — ANP forçou o zero → Absorção por perdas distribuídas
Distribui a perda necessária nos N dias anteriores em fatias iguais.
Cada dia absorve uma fração dentro do limite 0,60% ANP.

#### CAUSA 3 — Cascata distribuiu mal → Transferência entre adjacentes
Identifica dia vizinho com excesso. Transfere δ litros para o dia protegido.
Recalcula cascata a partir do dia doador.

### Fórmula do δ mínimo (proporcional ao C190):

```
         valor_C190_dia_protegido
δ = ──────────────────────────── × saída_total_mensal_produto
      valor_C190_total_do_mês
```

Esta fórmula é matematicamente defensável perante o Fisco:
distribui litros proporcionalmente ao faturamento fiscal do dia,
sem necessidade de converter Reais em Litros diretamente.

### Fluxo do algoritmo:

```
1. Detectar dias protegidos com saída = 0
2. Para cada dia problemático:
   a. Calcular δ pela fórmula proporcional C190
   b. Diagnosticar causa (estoque, ANP, cascata)
   c. Tentar resolução automática correspondente
   d. Verificar: ANP ok? Estoque positivo? → aceita
   e. Se não resolver: marcar como ENTRADA_INSUFICIENTE
3. Retornar plano de correção (sem aplicar ainda)
4. Frontend mostra preview ao usuário
5. Usuário confirma → chama /api/lmc/ajustar-lote existente
```

### O que o usuário vê após resolução automática:

```
✅ AJUSTE AUTOMÁTICO CALCULADO
────────────────────────────────────────────────────────
  2 dias corrigidos automaticamente:

  03/01 · Gasolina · 171L transferidos de 02/01 (cascata)
  10/01 · Diesel   ·  85L recuados de 09/01 (estoque)

  1 dia requer ação manual:
  22/02 · Etanol   · Estoque insuficiente
  → Verifique NF-e de abastecimento antes de 22/02

  Total mensal preservado ✓  |  ANP máximo: 0,43% ✓
────────────────────────────────────────────────────────
  [Aplicar correções automáticas]  [Revisar manualmente]
```

---

## TABELAS ENVOLVIDAS (já existem no banco)

| Tabela | Uso | Colunas chave |
|---|---|---|
| `documentos_c100` | Fonte NFC-e 65 | `cod_mod`, `dt_doc`, `vl_doc`, `id_sped_arquivo` |
| `lmc_movimentacao` | LMC Registro 1300 | `data_mov`, `vol_saidas_ajustado`, `id_sped_arquivo` |
| `documentos_itens_c170` | Itens (só NF-e 55) | `cod_item`, `qtd`, `cfop` |

---

## FUNÇÕES EXISTENTES — NÃO MODIFICAR

| Função | Linha | Motivo para não tocar |
|---|---|---|
| `atualizarEntradaLmcXml` | ~840 | Núcleo das entradas — quebra cascata se alterada |
| `sincronizarNotasInjetadas` | ~897 | Orquestra injeção XML inteira |
| `calcularSincronizacaoPreview` | ~2944 | Motor matemático principal |
| `confirmar-sincronizacao` | ~3173 | Apenas +5 linhas no topo com flag |
| `ajustar-cascata` | ~5062 | Usado para aplicar correções do resolver |
| `ajustar-lote` | ~5189 | Usado para aplicar correções do resolver |

---

## SEQUÊNCIA SEGURA DE IMPLANTAÇÃO

```
Semana 1:
  [ ] Criar backend/validacoes/nfce_lmc.js
  [ ] Criar endpoint GET /api/lmc/diagnostico-nfce/:id
  [ ] Testar em SPEDs reais (somente leitura, risco zero)

Semana 2:
  [ ] Criar backend/validacoes/resolver_lmc.js
  [ ] Implementar algoritmo look-back (Causa 1)
  [ ] Testar cálculo sem salvar nada

Semana 3:
  [ ] Implementar absorção ANP (Causa 2)
  [ ] Implementar transferência adjacente (Causa 3)
  [ ] Testar os 3 algoritmos com SPEDs reais

Semana 4:
  [ ] Adicionar +5 linhas com flag no confirmar-sincronizacao
  [ ] Deploy com VALIDAR_NFCE_LMC=false (inativo)
  [ ] Testar em ambiente de homologação com flag=true

Semana 5:
  [ ] Ligar flag em produção para 1 SPED piloto
  [ ] Validar resultado
  [ ] Ligar para todos se OK
```

---

## RISCOS RESIDUAIS

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Flag ligada antes de testar | Baixa | .env separado por ambiente |
| Query SQL com formato de data errado | Média | Testar formatos DDMMYYYY vs DATE |
| δ proporcional distorcido por variação de preço | Baixa | Tolerável — não é cálculo de imposto |
| Caso sem doador (estoque insuficiente) | Real | Não bloqueia, apenas informa |

---

## OBSERVAÇÕES FINAIS DO AUDITOR

1. A validação C190/C100 CFOP 5656 confirma EXISTÊNCIA de venda, não VOLUME.
2. O δ proporcional é matematicamente defensável mas não é o volume real vendido.
3. O objetivo é validação fiscal do SPED, não auditoria volumétrica precisa.
4. C175 não existe nestes SPEDs. C171 existe apenas para entradas (NF-e 55).
5. A abordagem não requer preço por litro — usa proporção relativa do C190.
6. Dias sem nenhuma NFC-e podem ter saída zero no LMC sem problema fiscal.
