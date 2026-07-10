# Design — Lista suspensa de CEST no 0200 (DOC-0200-CEST-01)

**Data:** 2026-07-10
**Branch:** feat/redesign-validador
**Regra alvo:** `DOC-0200-CEST-01` — "CEST do 0200 não localizado na Tabela CEST (Conv. ICMS 142/2018)"

## Problema

O PVA rejeita o 0200 quando o CEST (campo 13) não existe na Tabela CEST. Caso real:
`|0200|363|GALAO 5 LITROS| | |UN|00|39233090| |39| |20,50|1708704|` — CEST **1708704** não
existe (confirmado: ausente na tabela `cest`). O PVA oferece uma **lista suspensa** com os CEST
disponíveis para o usuário escolher e corrigir. Hoje nosso sistema já detecta o erro e permite
corrigir **digitando** o CEST no campo livre; a melhoria é oferecer a **lista suspensa**.

## Objetivo

Trocar o campo de texto livre (só para este erro) por uma **lista suspensa**:
- abre com os CEST **sugeridos para o NCM** do produto;
- "🔍 não achei — buscar em todos" → filtra os 1.370 CEST por código/descrição;
- checkbox "produto sem ST (deixar vazio)" → salva CEST vazio (`permiteVazio`);
- "Salvar CEST" usa o mecanismo de correção que já existe (campo 13 → `val_correcoes` → export).

Mantém-se **ADV** (não promove a BLOQ) e `permiteVazio`.

### Fora de escopo
- Reintroduzir a validação CEST×NCM por prefixo na regra (removida por falsos-positivos; ver nota
  no topo de `r_cest_0200.js`). O filtro por NCM aqui é só **sugestão de UI**, não validação.
- Mudanças no export/correção (o CEST já é aplicado no download pelo `val_correcoes`).

## Dados disponíveis

Tabela `cest` (1.370 linhas): `cest` (7 díg.), `cest_fmt` (`17.087.04`), `ncm_prefix`,
`descricao`, `segmento`. O domínio (`dominio.js`) já a carrega (`cestSet`, `cestNcm`).

## Componentes e mudanças

### 1. `backend/services/validador/engine.js`
O objeto do erro é montado com um conjunto fixo de campos (não repassa campos arbitrários da regra).
Adicionar 1 campo genérico de contexto: `ncm: (a.ncm ?? null)`. Assim regras podem anexar o NCM
do item ao erro (usado pela UI do CEST). `null` para os demais erros.

### 2. `backend/services/validador/rules/r_cest_0200.js`
Em cada erro emitido, anexar `ncm: String(l.f[8] || '').trim()` (COD_NCM do 0200). Nada mais muda
(a detecção continua idêntica; `campoIdx=13`, `permiteVazio=true`, `chaveNatural=COD_ITEM`).

### 3. Endpoint novo `GET /api/validador/cest-sugeridos` (authMiddleware)
Dois modos (querystring):
- `?ncm=<ncm>` → CEST cujo `ncm_prefix` é prefixo do NCM do produto:
  `SELECT DISTINCT ON (cest) cest, cest_fmt, descricao, segmento FROM cest
   WHERE $1 LIKE ncm_prefix || '%' ORDER BY cest, id LIMIT 100`  ($1 = NCM só-dígitos).
- `?q=<termo>` → busca em todos: `WHERE cest ILIKE $1 OR descricao ILIKE $1`
  (`$1 = '%'||termo||'%'`), `ORDER BY cest LIMIT 50`. (termo com dígitos casa o código.)
- Retorno: `[{ cest, cest_fmt, descricao, segmento }]`. Sem tabela `cest` → `[]` (degradação segura).

### 4. Frontend `frontend/src/views/ValidadorView.vue`
- **Esconder o bloco genérico** "Corrigir no sistema" quando `regra_id === 'DOC-0200-CEST-01'`
  (`v-if="e.corrigivel && resultadoId && e.regra_id !== 'DOC-0200-CEST-01'"`) — evita 2 UIs.
- **Bloco CEST** (novo) para `DOC-0200-CEST-01`:
  - Ao abrir a ocorrência (`toggleOcc`): busca `?ncm=e.ncm` → popula `cestOpcoes[key]`.
  - `<select v-model="cestSel[key]">` com `option` = `{{ o.cest_fmt }} — {{ o.descricao }}`
    (value = `o.cest`, 7 díg.).
  - Toggle "🔍 não achei — buscar em todos" → input `cestBusca[key]`; ao buscar (botão/Enter),
    `?q=` repopula `cestOpcoes[key]` (marca a origem "busca").
  - Checkbox `cestSemST[key]` "produto sem ST (deixar vazio)" → desabilita o select; salva vazio.
  - Botão "Salvar CEST" → `salvarCest(e)`:
    - valor = `cestSemST ? '' : cestSel[key]`; se não é semST e vazio → aviso.
    - `POST /api/validador/corrigir` `{ id_sped_arquivo, regra_id, registro:'0200',
      chave_natural:e.chaveNatural, campo_idx:13, valor_original:e.valorAtual, valor_corrigido:valor }`.
    - `await carregarCorrecoes()`; msg "Correção salva. Re-validar para conferir."
- NCM do produto vem de `e.ncm` (via itens 1–2); `COD_ITEM` = `e.chaveNatural`.

## Fluxo de dados
```
Analisar → erro DOC-0200-CEST-01 (campoIdx=13, chaveNatural=COD_ITEM, ncm=39233090, valorAtual=CEST atual)
Abrir ocorrência → GET /cest-sugeridos?ncm=39233090 → popula <select>
(opcional) buscar → GET /cest-sugeridos?q=galao → repopula <select>
Salvar → POST /corrigir (campo 13) → val_correcoes
Re-validar → o CEST corrigido é marcado (supressão por campo já existente: registro::chave::13)
Exportar → aplicar() troca o campo 13 no 0200 → .txt com CEST válido
```

## Tratamento de erros / bordas
- **NCM sem CEST sugerido** (mapa incompleto): select vem vazio → o usuário usa "buscar em todos".
- **CEST vazio** (produto sem ST): checkbox → salva vazio (`permiteVazio` já suportado).
- **Tabela `cest` ausente/vazia**: endpoint retorna `[]`; a UI mostra "buscar em todos" (também vazio) —
  não quebra; usuário ainda pode digitar? (não; sem lista fica só o "sem ST". Aceitável: a regra já
  se auto-desliga sem domínio, então o erro nem apareceria.)
- **Busca com poucos caracteres**: exigir ≥ 2 chars antes de consultar (evita varrer 1.370).

## Testes
- **Suíte** (`validador-suite.js`): erro `DOC-0200-CEST-01` carrega `e.ncm` = NCM do produto
  (positivo: CEST inválido num 0200 com NCM X → `e.ncm === 'X'`).
- **Endpoint** (verificação contra o banco): `?ncm=39233090` retorna CEST plausíveis; `?q` acha por
  descrição; `?ncm` inexistente → `[]`.
- **SFC compila**; **golden** inalterado (nenhuma mudança no export).

## Critérios de aceite
1. No erro de CEST, aparece uma lista suspensa com os CEST do NCM do produto (não o campo de texto).
2. "Buscar em todos" acha qualquer CEST por código/descrição.
3. "Produto sem ST" salva CEST vazio.
4. Salvar grava correção reversível (campo 13); Re-validar marca como corrigido; download sai com o CEST.
5. Golden byte-idêntico (sem regressão no export).
