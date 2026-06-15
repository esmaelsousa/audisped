I found a discrepancy worth noting: the actual `de_para_xml` DDL in `setup_db.js` has only `novo_cfop` and `novo_cst` (not the fuller column set `cst_pis, cst_cofins, ncm, aliq_icms, bc_icms_override, conta_contabil` mentioned in the briefing). The plan will reflect the real schema. All three hardcoded-rule sites and the `/api/de-para` route pattern are confirmed. Now producing the consolidated plan.

# Plano de Implementação — Motor de Regras Fiscais Global (Audisped)

> **Status:** proposta para aprovação · **Branch sugerida:** `feat/motor-regras-fiscais` · **Autor:** Arquiteto-chefe
> **Objetivo:** eliminar a regra fiscal triplicada e hardcoded, separando **tradução de código de produto** (por fornecedor) de **regra fiscal** (universal), num motor único condição→ação aplicado na injeção e na exportação, com vigência, fundamento legal, prioridade, trilha de auditoria e simulador.

---

## 0. Verificação do código atual (linha de base confirmada)

A mesma regra fiscal **"CST ICMS 60/61 ⇒ PIS/COFINS 04"** está hardcoded em **3 lugares**:

| Local | Trecho confirmado |
|---|---|
| `services/xmlInjectorService.js:354-359` | `if (finalCst === '060' || finalCst === '061') { bcIcmsSt=bcIcmsStRet; vlIcmsSt=vlIcmsStRet; if(!m.cst_pis) cstPis='04'; if(!m.cst_cofins) cstCofins='04'; }` |
| `server.js:1234-1239` (`sincronizarNotasInjetadas`) | `_sitIcms = String(cstIcms).slice(-2); _ehMono = (60||61); _cstPis = _ehMono ? '04' : (item.cst_pis||'07')` |
| `server.js:6628-6635` (`normalizarLinha` do export) | `if ((sit==='60'||sit==='61') && (f[25]!=='04'||f[31]!=='04')) { f[25]='04'; f[31]='04'; }` |

**Correção factual importante (vs. o briefing):** a tabela `de_para_xml` real em `setup_db.js:163-175` tem **apenas** `cod_produto_interno, descricao_produto, novo_cfop, novo_cst` — **não** existem hoje as colunas `cst_pis, cst_cofins, ncm, aliq_icms, bc_icms_override, conta_contabil`. Logo, a "tributação no de-para" que precisa migrar resume-se a **`novo_cst` e `novo_cfop`**, e a migração é mais simples do que o briefing sugeria (não há colunas PIS/COFINS/alíquota para dropar — só decidir se `novo_cst` deixa de carregar tributação universal). Rotas-modelo `/api/de-para` confirmadas em `server.js:8317/8343/8390`. Nenhuma referência a `regras_fiscais` existe ainda.

---

## 1. Visão geral — De-Para de Produtos × Regras Fiscais

Hoje o `de_para_xml`, chaveado por `(id_empresa + cnpj_emissor + cod_produto_xml)`, mistura **duas responsabilidades**:

1. **Identidade do item** (legítima por fornecedor): traduzir o código/descrição do produto do XML do fornecedor para o código interno do posto.
2. **Tributação** (`novo_cst`/`novo_cfop`): que na esmagadora maioria dos casos é **regra universal** (ex.: "gasolina é monofásica → CST 61 → PIS/COFINS 04"), não algo que dependa de qual fornecedor emitiu.

Misturar as duas faz a mesma regra fiscal viver replicada em N linhas do `de_para_xml` (uma por fornecedor×produto) **e** triplicada em código. Mudar a lei = caçar dezenas de linhas e três `if`.

**Separação adotada:**

| | **De-Para de Produtos** | **Regras Fiscais (Motor)** |
|---|---|---|
| Escopo | Por empresa + fornecedor | **Global** (com exceções pontuais opcionais) |
| Chave | `(id_empresa, cnpj_emissor, cod_produto_xml)` | condição→ação por NCM/CST/CFOP/operação |
| Resolve | `cod_interno`, `descricao` | `cst_icms`, `cfop`, `cst_pis`, `cst_cofins`, BC/alíquota |
| Quando muda | Novo fornecedor/produto | Mudança de lei (vigência) |
| Fonte da verdade fiscal | ❌ (não mais) | ✅ |

**Ordem no pipeline de cada item:** (1) **De-Para de Produtos** resolve identidade (cod_interno/descrição/NCM) → (2) **Motor de Regras Fiscais** calcula tributação usando o NCM/tipo já normalizado.

**Compatibilidade durante a transição:** o `de_para_xml.novo_cst/novo_cfop`, quando explicitamente preenchido, continua tendo prioridade (conforme a memória do projeto e o comportamento atual) **enquanto durar o período de coexistência (dual-read)** — depois a fonte da verdade fiscal passa a ser o motor.

---

## 2. Modelo de dados final (DDL)

Modelo **híbrido**: colunas tipadas para os critérios "quentes" (indexáveis e usados em ~95% das regras de posto) + `JSONB` para condições/ações raras ou futuras (sem `ALTER TABLE`).

```sql
-- ============================================================
-- MOTOR DE REGRAS FISCAIS (GLOBAL) — setup_db.js
-- ============================================================
CREATE TABLE IF NOT EXISTS regras_fiscais (
    id                  SERIAL PRIMARY KEY,
    nome                TEXT NOT NULL,
    descricao           TEXT,
    fundamento_legal    TEXT,
    prioridade          INTEGER NOT NULL DEFAULT 100,   -- menor número = avaliada primeiro
    ativo               BOOLEAN NOT NULL DEFAULT TRUE,
    confianca           TEXT NOT NULL DEFAULT 'media',   -- 'alta'|'media'|'baixa' (governança)

    -- Vigência por COMPETÊNCIA do SPED (nunca por data de cadastro)
    dt_ini              DATE NOT NULL DEFAULT '2000-01-01',
    dt_fim              DATE,                            -- NULL = vigente indefinidamente

    -- ---------- CONDIÇÕES (colunas tipadas; NULL = curinga; AND entre elas) ----------
    ind_oper            CHAR(1),        -- '0' entrada / '1' saída / NULL ambos
    ncm_prefix          TEXT,           -- LIKE 'ncm_prefix%' (ex.: '2710','271019','2711','2207','3403')
    cst_icms_origem     TEXT,           -- casa pelos 2 últimos dígitos do CST do XML/SPED
    cfop_origem         TEXT,           -- casa por prefixo
    tipo_produto        TEXT,           -- 'COMBUSTIVEL'|'ETANOL'|'GLP'|'GNV'|'LUBRIFICANTE'|'OUTRO'
    regime              TEXT,           -- 'NORMAL'|'SIMPLES' (do destinatário) / NULL ambos

    -- Escopo opcional p/ EXCEÇÃO (NULL = global)
    id_empresa          INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
    cnpj_emissor        TEXT,
    uf_origem           CHAR(2),

    cond_extra          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {ncm_list:[...], cst_origem_list:[...], vl_item_min, modelo,...}

    -- ---------- AÇÕES (NULL = mantém) ----------
    acao_cst_icms       TEXT,           -- 2 dígitos (situação); origem preservada pelo motor
    acao_cfop           TEXT,
    acao_cst_pis        TEXT,
    acao_cst_cofins     TEXT,
    acao_aliq_icms      NUMERIC(7,4),
    acao_bc_icms_mode   TEXT,           -- 'XML'|'ZERO'|'ST_RET'|'OVERRIDE'
    acao_bc_icms_valor  NUMERIC(15,2),

    -- Flags de efeito colateral no arquivo
    flag_zera_icms      BOOLEAN DEFAULT FALSE,   -- VL_ICMS=0, BC_ICMS=0 (sem crédito ST/monofásico)
    flag_usar_st_ret    BOOLEAN DEFAULT FALSE,   -- BC/VL ST = vBCSTRet/vICMSSTRet do XML
    flag_soma_ipi_st_custo BOOLEAN DEFAULT FALSE,-- uso/consumo: incorpora IPI+ST ao VL_ITEM
    flag_bloqueia_credito_st BOOLEAN DEFAULT FALSE,-- não somar em E110/E210
    flag_para_no_match  BOOLEAN DEFAULT TRUE,    -- TRUE = first-match; FALSE = acumula
    flag_apenas_alerta  BOOLEAN DEFAULT FALSE,   -- regra de VALIDAÇÃO (diagnostica, não aplica)
    acao_extra          JSONB NOT NULL DEFAULT '{}'::jsonb,

    criado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    criado_por          TEXT
);

CREATE INDEX IF NOT EXISTS idx_regras_fiscais_match
    ON regras_fiscais (ativo, ind_oper, prioridade) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_regras_fiscais_escopo
    ON regras_fiscais (id_empresa, cnpj_emissor) WHERE ativo = TRUE;

-- ============================================================
-- TRILHA DE AUDITORIA (qual regra bateu em cada item)
-- ============================================================
CREATE TABLE IF NOT EXISTS regras_fiscais_aplicacao (
    id                  BIGSERIAL PRIMARY KEY,
    id_regra            INTEGER REFERENCES regras_fiscais(id) ON DELETE SET NULL,
    id_sped_arquivo     INTEGER,
    chv_nfe             TEXT,
    num_item            INTEGER,
    origem              TEXT NOT NULL,        -- 'INJECAO'|'SYNC'|'EXPORT'|'SIMULADOR'
    competencia         DATE,
    valores_antes       JSONB,
    valores_depois      JSONB,
    nome_regra_snapshot TEXT,
    fundamento_snapshot TEXT,
    criado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rfa_arquivo ON regras_fiscais_aplicacao (id_sped_arquivo, chv_nfe);

-- ============================================================
-- TRILHA DE EDIÇÃO DA PRÓPRIA REGRA (criar/editar/ativar/reordenar)
-- ============================================================
CREATE TABLE IF NOT EXISTS regras_fiscais_historico (
    id          BIGSERIAL PRIMARY KEY,
    id_regra    INTEGER,
    acao        TEXT NOT NULL,     -- 'CRIAR'|'EDITAR'|'ATIVAR'|'DESATIVAR'|'DUPLICAR'|'REORDENAR'|'EXCLUIR'|'CONFLITO_OK'
    snapshot    JSONB,
    diff        JSONB,
    autor       TEXT,
    criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Por que híbrido e não JSONB puro:** o motor avalia milhares de itens por exportação. `ind_oper`, `ncm_prefix`, `cst_icms_origem` aparecem em quase toda regra de combustível e precisam de filtro SQL/índice. Os critérios raros (UF, faixa de valor, listas de NCM/CST) ficam em `cond_extra` e são avaliados em memória só sobre as candidatas já pré-filtradas — evitando o anti-padrão de varrer JSONB no universo inteiro.

---

## 3. Motor `aplicarRegrasFiscais` (novo módulo)

Novo arquivo: `backend/services/regrasFiscaisService.js`. Função única, importada pelos três pontos.

### 3.1 Princípios

- **Pré-carregamento por competência (1 query por export/injeção, não por item):** carrega todas as regras `ativo=TRUE` vigentes na competência, ordenadas por **especificidade** (regra com `id_empresa`/`cnpj_emissor` vence a global de mesma prioridade) e depois `prioridade ASC, id ASC`. Cache em memória keyed por competência.
- **Vigência por COMPETÊNCIA do SPED**, nunca `new Date()`: derivada do `0000` (DT_INI) no export e da competência do SPED-base/`dt_doc` na injeção. NF de 12/2021 reinjetada hoje usa regras de 12/2021. Assim o CST 61 monofásico (Conv. 199/2022, efeitos 01/05/2023 e 01/06/2023) simplesmente **não casa** em competências anteriores — sem `if` de data no código.
- **First-match com acumulação opcional:** a primeira regra que casa aplica suas ações; se `flag_para_no_match=TRUE` (padrão), para; se `FALSE`, aplica e continua (ex.: regra de ICMS + regra só de PIS/COFINS).
- **Ação só sobrescreve quando não-nula** (`NULL` = "mantém o que veio") → acumulação não zera o que regra anterior setou.
- **Preservação do dígito de origem do CST:** ação grava 2 dígitos de situação; o motor recompõe `origem(1) + situação(2)` a partir do `orig` do item (importado vira `161`, nacional `061`). Regra transversal de prioridade máxima.
- **Regras de validação (`flag_apenas_alerta`)** não mutam o item; empurram um alerta em `ctx.alertas[]` (ex.: "C170×C190 incoerente", "CST×CFOP inválido"). Diagnóstico, não aplicação cega.

### 3.2 Contrato

```js
// regrasFiscaisService.js
let _cacheRegras = null, _cacheComp = null;

async function carregarRegras(dbClient, competencia) {
  if (_cacheComp === competencia && _cacheRegras) return _cacheRegras;
  const { rows } = await dbClient.query(`
    SELECT * FROM regras_fiscais
    WHERE ativo = TRUE AND flag_apenas_alerta = FALSE
      AND dt_ini <= $1 AND (dt_fim IS NULL OR dt_fim >= $1)
    ORDER BY (CASE WHEN id_empresa IS NOT NULL OR cnpj_emissor IS NOT NULL THEN 0 ELSE 1 END),
             prioridade ASC, id ASC`, [competencia]);
  _cacheRegras = rows; _cacheComp = competencia; return rows;
}

function casa(regra, item, ctx) {
  if (regra.ind_oper && regra.ind_oper !== ctx.ind_oper) return false;
  if (regra.ncm_prefix && !String(item.ncm||'').startsWith(regra.ncm_prefix)) return false;
  if (regra.cst_icms_origem &&
      String(regra.cst_icms_origem).slice(-2) !== String(item.cst_icms||'').slice(-2)) return false;
  if (regra.cfop_origem && !String(item.cfop||'').startsWith(regra.cfop_origem)) return false;
  if (regra.tipo_produto && regra.tipo_produto !== item.tipo_produto) return false;
  if (regra.regime && regra.regime !== ctx.regime_dest) return false;
  if (regra.id_empresa && regra.id_empresa !== ctx.id_empresa) return false;
  if (regra.cnpj_emissor &&
      regra.cnpj_emissor.replace(/\D/g,'') !== (ctx.cnpj_emissor||'').replace(/\D/g,'')) return false;
  if (regra.uf_origem && regra.uf_origem !== ctx.uf_origem) return false;
  return avaliarCondExtra(regra.cond_extra, item, ctx); // ncm_list, cst_origem_list, faixas...
}

function aplicarAcoes(regra, item) {
  if (regra.acao_cst_icms)   item.cst_icms   = comporComOrigem(item.cst_icms, regra.acao_cst_icms);
  if (regra.acao_cfop)       item.cfop       = regra.acao_cfop;
  if (regra.acao_cst_pis)    item.cst_pis    = regra.acao_cst_pis;
  if (regra.acao_cst_cofins) item.cst_cofins = regra.acao_cst_cofins;
  if (regra.acao_aliq_icms != null) item.aliq_icms = Number(regra.acao_aliq_icms);
  if (regra.acao_bc_icms_mode)      item._bc_mode  = regra.acao_bc_icms_mode;
  if (regra.flag_zera_icms)            { item.vl_icms = 0; item.bc_icms = 0; item.aliq_icms = 0; }
  if (regra.flag_usar_st_ret)          item._usar_st_ret = true;
  if (regra.flag_soma_ipi_st_custo)    item._soma_ipi_st_custo = true;
  if (regra.flag_bloqueia_credito_st)  item._bloqueia_credito_st = true;
}

/**
 * @param item {ncm, cst_icms, cfop, cst_pis, cst_cofins, aliq_icms, orig, tipo_produto, num_item...}
 * @param ctx  {dbClient, competencia, ind_oper, id_empresa, cnpj_emissor, regime_dest,
 *              uf_origem, origem, chv_nfe, trilha:[], alertas:[]}
 */
async function aplicarRegrasFiscais(item, ctx) {
  const regras = await carregarRegras(ctx.dbClient, ctx.competencia);
  const antes = snapshot(item);
  for (const regra of regras) {
    if (!casa(regra, item, ctx)) continue;
    aplicarAcoes(regra, item);
    ctx.trilha.push({ id_regra: regra.id, nome: regra.nome, fundamento: regra.fundamento_legal,
                      num_item: item.num_item, chv_nfe: ctx.chv_nfe, origem: ctx.origem,
                      antes, depois: snapshot(item) });
    if (regra.flag_para_no_match) break;
  }
  return item;
}
module.exports = { aplicarRegrasFiscais, carregarRegras, invalidarCache: () => { _cacheRegras = null; } };
```

> O `comporComOrigem(cstOrig, situacao2dig)` espelha o `normalizarCst` atual (preserva o 1º dígito). `invalidarCache()` é chamado pelos endpoints CRUD ao salvar/ativar regra.

### 3.3 Trilha e simulador

- **Trilha de aplicação:** cada match grava em `regras_fiscais_aplicacao` (`id_regra`, snapshots de nome/fundamento congelados, `valores_antes/depois`, `origem`, `competencia`). Persistir em **batch** ao fim da injeção/export (insert multi-row). Na tela de Notas: *"CST 060→061 por Regra #12 'Monofásico Conv.199/2022'"*.
- **Simulador:** `POST /api/regras-fiscais/simular` roda `aplicarRegrasFiscais` com `origem:'SIMULADOR'` **sem persistir e sem mutar arquivo**; retorna a **cadeia de avaliação** (regra que venceu, as que não casaram e por quê, as não alcançadas) + antes→depois por campo. Variante "explain": injeta uma regra-rascunho na lista carregada para ver impacto antes de salvar.

---

## 4. Pontos de integração e migração

### 4.1 Onde plugar (substituindo as 3 cópias)

| Ponto | Local hoje | Mudança |
|---|---|---|
| **Injeção** | `services/xmlInjectorService.js:354-359` (loop dos itens) | Após resolver `finalCfop/finalCst/cstPis/cstCofins` pelo De-Para de Produto, montar `item` e `await aplicarRegrasFiscais(item, ctx)`. **Remover** o bloco `if (finalCst==='060'||'061')`. Aplicar `_usar_st_ret`/`flag_zera_icms` aos campos do C170. |
| **Sync banco** | `server.js:1234-1239` | Carregar regras **1× antes do loop** (hoje há lookup por item). Substituir `_ehMono ? '04'` pela chamada ao motor. |
| **Exportação** | `server.js:6622-6637` (`normalizarLinha`) | Parsear o `\|C170\|` → `item`, `aplicarRegrasFiscais(item, {origem:'EXPORT'})`, reescrever a linha. Mantém normalização mesmo em notas antigas. Pré-carregar regras antes do loop (padrão de `recalcularE110/E210`); com cache quente, fica síncrono na prática. |
| **Pós-processamento** | export (recálculo C190/E110/E210) | Após o motor mexer em CST/CFOP/ALIQ, **recalcular C190** por `(CST, CFOP, ALIQ)` e **filtrar CST 60/61 do crédito de ST** em E110/E210 (regras `flag_bloqueia_credito_st`). |

`ctx` recebe o mesmo `dbClient` que `transformarNotasEmSped`/`sincronizarNotasInjetadas` já usam.

### 4.2 API

Novos endpoints, espelhando `/api/de-para` (`server.js:8317+`):
`GET /api/regras-fiscais` (lista+filtros) · `POST` (criar) · `PUT /:id` · `DELETE /:id` · `POST /:id/duplicar` · `PATCH /:id/ativar` · `POST /reordenar` · `POST /simular` · `GET /:id/trilha` · `GET /conflitos`.

### 4.3 Migração do `de_para_xml` (idempotente)

1. **Seed das regras-base** de combustível (item 6) — independe do de_para; vem do domínio.
2. **Agrupamento:** `SELECT novo_cst, novo_cfop, COUNT(*) ... GROUP BY` no `de_para_xml WHERE novo_cst IS NOT NULL`. Combinações repetidas entre fornecedores já são cobertas por regra global → confirmam o seed.
3. **Exceções genuínas por fornecedor** (poucas) que não casam em regra global viram **regra de exceção** com `id_empresa`/`cnpj_emissor` preenchidos (mais específica vence).
4. **Coexistência (dual-read):** o motor, sob flag de transição, ainda lê `de_para_xml.novo_cst/novo_cfop` se nenhuma regra casar; loga *"regra ausente, usando legado de_para"* para mapear gaps.
5. **Validação de regressão:** rodar `validar_todas_empresas.js` antes/depois e exigir **byte-equivalência** do `.txt` para postos de exemplo. Se o motor produz o mesmo arquivo dos 3 hacks, a migração é segura.
6. **Limpeza:** quando o log de "regra ausente" zerar, parar de ler `novo_cst/novo_cfop` (mantê-los NULL); o `de_para_xml` fica só identidade. UNIQUE permanece.

Script novo: `backend/migrar_depara_para_regras.js` (espelha `export_lote.js`).

---

## 5. Menu/UX (resumo)

**Menu** novo de 1º nível **"Cadastros Fiscais"** (ícone `ClipboardList`/`Scale`):
- **Regras Fiscais** (`Scale`) — global, motor condição→ação.
- **De-Para de Produtos** (`ArrowLeftRight`) — por fornecedor, só tradução de código (tela atual, agora limpa de tributação).
- *Tabelas de Apoio* (futuro): NCM/CEST, CFOPs autorizados.

A separação visual reforça a fronteira para o contador: *código do produto ≠ tributação*.

**Tela Regras Fiscais (lista):** colunas **Prio (handle de arraste = precedência), Nome, Quando, Então, Vigência, Status (pill verde/cinza/âmbar), Ações (⏻ ativar · ⧉ duplicar · ✎ editar)**. "Quando/Então" em linguagem natural (*"NCM 2710* + CFOP 1652 → CST 61, PIS/COFINS 04"*), nunca JSON. Banner âmbar de conflito quando há sobreposição de cobertura gravando o **mesmo campo com valores diferentes**.

**Formulário (drawer):** seções *Identificação · Vigência & Fundamento · QUANDO (condições com operadores `igual a`/`está em`/`começa com`) · ENTÃO (checkboxes; CST sempre em combo código+descrição, nunca campo livre) · Pré-visualização viva em PT-BR · Conflitos · botões "Testar em uma NF" / Salvar*. **Clonar > criar do zero** (gasolina→diesel→GLP variam pouco).

**Simulador:** entrada por item avulso / colar XML-chave / buscar NF do banco; mostra **antes→depois por campo** e a **cadeia de avaliação completa** (venceu / não casou e por quê / não alcançada).

**Conflitos:** conflito ≠ erro; 3 níveis (badge na lista, aviso inline no form, painel comparativo lado a lado). Conceito de **"regra sombreada"** (nunca alcançada). Botão *"Ignorar (marcar OK)"* registra na trilha.

**Trilha:** imutável, exportável (CSV/PDF), liga regra → uso real (N exportações/injeções, drill-down nos SPEDs). Argumento de defesa fiscal.

---

## 6. Conjunto de regras SEED (consolidado e deduplicado)

As 54 regras recebidas continham **muitas duplicatas** (gasolina/diesel monofásico aparecia ~6×; lubrificante ~4×; CST 10→60 ~3×; PIS/COFINS 04 ~3×; conversão CFOP, C170×C190 e bloqueio de crédito ST repetidos). Consolidei em **24 regras canônicas**, sem conflito, ordenadas por prioridade. Convenção: `acao_cst_icms` em 2 dígitos de situação (a origem é recomposta pelo motor); `*` = prefixo NCM. Regras de baixa confiança marcadas **(revisar)** ficam `ativo=FALSE` no seed.

> **Validação/transversais primeiro (prioridade baixa-número = roda antes), depois aplicação.** As de validação têm `flag_apenas_alerta` quando não devem mutar; a coerção 60/61→04 é aplicada de fato.

| Prio | Nome | ind_oper | Condição (QUANDO) | Ação (ENTÃO) | Fundamento | Conf. |
|---:|---|:--:|---|---|---|:--:|
| 5 | Preservar dígito de origem do CST (Tabela A) | ambos | qualquer alteração de situação do CST | CST final = orig(1) + situação(2); não zerar origem | Ajuste SINIEF 20/2012; Res. Senado 13/2012 | alta |
| 8 | Coerência C170×C190 (rebuild analítico) | ambos | após mudar CST/CFOP/ALIQ de itens | recalcular C190 por (CST,CFOP,ALIQ); recontar 1990/9900; **não** colapsar 60≠61 | Guia Prático EFD | alta |
| 10 | **Coerção combustível/lubrificante: CST ICMS 60/61 ⇒ PIS/COFINS 04** *(rede de segurança — substitui os 3 hacks)* | ambos | CST ICMS termina em 60 ou 61 e PIS/COFINS ≠ 04 (NCM 2710/2711/2207/3403) | `cst_pis=04`, `cst_cofins=04`, zerar BC/ALIQ/VL PIS-COFINS | Lei 9.718/98; Lei 10.485/02; IN RFB 2.121/22 (Tab.4.3.3) | alta |
| 20 | Bloquear crédito de ICMS em CST 60/61 (E110/E210) | entrada | CST resultante 60/61 (NCM 2710/2711/2207/3403) | `flag_zera_icms` (VL_ICMS=0, BC=0); `flag_bloqueia_credito_st`; preservar vBCSTRet/vICMSSTRet | LC 87/96 art.20/33; Conv. 142/2018; 199/2022 | alta |
| 30 | **Gasolina/Diesel/Biodiesel monofásico — entrada** | entrada (0) | NCM `2710*` (gasolina/diesel), `3826*` (B100); CST orig 02/10/15/30/53/60/61/70; competência ≥ 2023-05-01 (diesel) / 2023-06-01 (gasolina) | `cst_icms=61`, `cfop=1653` (2653 interest.), `cst_pis=04`, `cst_cofins=04`, `flag_usar_st_ret` | Conv. ICMS 199/2022; LC 192/2022; Ato COTEPE 76/22 | alta |
| 31 | **GLP/GNV monofásico — entrada** | entrada | NCM `2711*`; CST orig 02/10/15/30/53/60/61/70; competência ≥ 2023-05-01 (GLP) | `cst_icms=61`, `cfop=1653`/`2653`, `cst_pis=04`, `cst_cofins=04`, `flag_usar_st_ret` | Conv. 199/2022 + 15/2023; LC 192/2022 | alta |
| 32 | **Etanol combustível monofásico — entrada** *(revisar UF)* | entrada | NCM `2207.10*`/`2207.20*`; CST orig 02/10/30/60/61; competência ≥ 2023-06-01 | `cst_icms=61`, `cfop=1653`, `cst_pis=04`, `cst_cofins=04`, `flag_usar_st_ret` | Conv. 199/2022; Conv. 15/2023 | **média (revisar)** |
| 40 | **Conversão ST: fornecedor CST 10/30/70 ⇒ substituído CST 60 — entrada** | entrada | CST orig 10/30/70/90; CFOP orig 5401/5403/5405/6401/6403; produto **não** monofásico (NCM ≠ combustível auto) | `cst_icms=60`, `cfop=1403`/`2403`, `flag_zera_icms`, `flag_usar_st_ret` | Conv. 142/2018; 110/2007; LC 87/96 | alta |
| 41 | **Lubrificantes (NCM 2710.19.3*/3403) — ST ICMS 60 + PIS/COFINS 04** | entrada | NCM `271019.3*`, `3403*`; CST orig 10/30/60/70 | `cst_icms=60`, `cfop=1653`, `cst_pis=04`, `cst_cofins=04`, `flag_usar_st_ret`, `flag_zera_icms` | Conv. 110/2007; Lei 10.485/02 | alta |
| 42 | Etanol/produtos sob ST clássica — entrada (UF não migrada) *(revisar)* | entrada | NCM `2207*`; CST orig 10/30/60/70; UF mantém ST | `cst_icms=60`, `cfop=1653`, `cst_pis=04`, `cst_cofins=04`, `flag_usar_st_ret` | Conv. 110/2007; protocolos estaduais | **média (revisar)** |
| 43 | Mercadoria de conveniência sob ST (bebidas/cigarros) — entrada *(revisar PIS/COFINS por NCM)* | entrada | NCM `2202*`,`2203*`,`2402*`,`2105*`,`2106*`; CST orig 10/30/60/70 | `cst_icms=60`, `cfop=1403`, `flag_zera_icms` (PIS/COFINS mantém XML) | Conv. 142/2018; Lei 13.097/2015 | **média (revisar)** |
| 50 | Querosene aviação (QAV) / iluminante — entrada *(atípico)* | entrada | NCM `27101911`,`27101912` | `cst_icms=60`, `cst_pis=04`, `cst_cofins=04`, `flag_usar_st_ret` | Lei 10.560/02; Conv. 110/2007 | **baixa (revisar)** |
| 55 | Aquisição de **ativo imobilizado** — entrada (crédito 1/48 CIAP) *(depende do regime)* | entrada | CFOP orig 5551/6551/1406/1408 | `cst_icms=00`, `cfop=1551`/`2551`, `cst_pis=50`, `cst_cofins=50`; **não** creditar ICMS integral (sinalizar CIAP/bloco G) | LC 87/96 art.20 §5; Lei 10.833/03 | **média (revisar)** |
| 60 | **Uso e consumo do posto** — entrada sem crédito | entrada | flag `forcar_uso_consumo` e/ou CFOP orig de uso/consumo | `cst_icms=90`, `cfop=1556`/`2556`, `cst_pis=07`, `cst_cofins=07`, `flag_soma_ipi_st_custo`, `flag_zera_icms` | LC 87/96 art.33,I; Lei 10.637/02; 10.833/03 | alta |
| 61 | Combustível para frota própria (uso/consumo) *(raro)* | entrada | NCM `2710*`/`2711*`; CST orig 60/61; finalidade uso próprio | `cst_icms=61`, `cfop=1556`/`2556`, `cst_pis=04`, `cst_cofins=04`, `flag_zera_icms` | LC 87/96 art.33; Conv. 199/2022 | **média (revisar)** |
| 65 | Simples Nacional: combustível ⇒ CSOSN 500 + PIS/COFINS 04 *(depende do regime)* | ambos | `regime=SIMPLES`; NCM `2710*`/`2711*`/`2207*` | `cst_icms=500` (CSOSN), `cst_pis=04`, `cst_cofins=04` | LC 123/2006; Res. CGSN 140/2018 | **média (revisar)** |
| 66 | CSOSN do fornecedor Simples ⇒ CST do destinatário regular | entrada | CST orig 101/102/103/201/202/203/300/400/500/900 | mapear: 101→020(cred. vCredICMSSN), 102/103→040, 201/202/203/500→060, 300→040, 400→041, 900→090 | Res. CGSN 140/2018; Guia Prático EFD | alta |
| 70 | Mercadoria comum tributada p/ revenda (conveniência) — entrada c/ crédito *(depende do regime)* | entrada | CST orig 00/20; CFOP orig 5101/5102/6101/6102; NCM não-combustível | `cst_icms=00`, `cfop=1102`/`2102`, `cst_pis=50`, `cst_cofins=50` (manter BC do XML) | LC 87/96 art.19-20 | **média (revisar)** |
| 72 | Aditivos/ARLA 32 — NÃO forçar PIS/COFINS 04 (contra-regra) | ambos | NCM `3102*`(ARLA/ureia), `3811*`(aditivos); CST orig 00 | `cst_pis=01`, `cst_cofins=01` (não zerar) | Lei 10.637/02; 10.833/03 | alta |
| 75 | Devolução de venda de combustível — entrada | entrada | NCM `2710*`/`2711*`/`2207*`; CFOP orig 1410/1411/2410/2411; CST orig 60/61 | manter CST ICMS; `cst_pis=04`, `cst_cofins=04` | Ajuste SINIEF; Conv. 110/2007 | **média (revisar)** |
| 80 | Conversão estrutural CFOP saída→entrada interna (fallback) | entrada | CFOP orig `5*` (op. interna), sem regra específica casada | `cfop`: 5→1 preservando natureza (5102→1102, 5405→1403, 5656→1653) | Conv. s/n 1970; Ajuste SINIEF | alta |
| 81 | Conversão estrutural CFOP saída→entrada interestadual (fallback) | entrada | CFOP orig `6*`, sem regra específica casada | `cfop`: 6→2 (6102→2102, 6404→2403, 6656→2653) | Conv. s/n 1970; Ajuste SINIEF | alta |
| 85 | **Saída (revenda na bomba) combustível monofásico — CST 61** | saída (1) | NCM `2710*`/`2711*`/`2207*` monofásicos; CFOP orig 5656/5667 | `cst_icms=61`, `cfop=5656`, `cst_pis=04`, `cst_cofins=04`, sem débito ICMS | Conv. 199/2022; Lei 9.718/98 | alta |
| 86 | Saída de produto sob ST — substituído (CST 60) | saída | NCM `2710*`/`3403*` (lubrificante/ST); CFOP orig 5405/5656 | `cst_icms=60`, `cfop=5405`/`5656`, `cst_pis=04`, `cst_cofins=04`, sem novo débito/retenção | Conv. 142/2018; 110/2007 | alta |
| 90 | Saída de mercadoria não-combustível tributada (loja) — CST 00 *(depende do regime)* | saída | NCM não-combustível; CFOP orig 5102/6102 | `cst_icms=00`, `cfop=5102`, `cst_pis=01`, `cst_cofins=01` (Simples→CSOSN) | RICMS estadual; LC 87/96 | **média (revisar)** |

**Regras de validação (não-aplicação — `flag_apenas_alerta=TRUE`):**

| Nome | ind_oper | Quando | Alerta | Fundamento | Conf. |
|---|:--:|---|---|---|:--:|
| Combinação CST×CFOP inválida no EFD | ambos | CFOP 1403/2403 com CST ∉{60,…}; CFOP 1653 com CST ∉{60,61} | sugerir correção (não aplicar cego) | Guia Prático EFD; validações PVA | média |
| E200/E210 só p/ substituto | saída | saída com VL_ICMS_ST>0 e CST 10/30/70 | gerar E200/E210 só se houver ST retido; posto revendedor → IND_MOV_ST=0 | Conv. 142/2018; LC 87/96 | alta |

**Decisões de deduplicação aplicadas:**
- 6 variantes de "gasolina/diesel/GLP monofásico" → **Prio 30 + 31** (separadas por NCM 2710 vs 2711, pois efeitos têm datas distintas).
- 4 variantes de "lubrificante" → **Prio 41**.
- 3 variantes "CST 10→60" → **Prio 40**.
- 3 variantes "PIS/COFINS 04" → unificadas na coerção **Prio 10** (rede de segurança que substitui os 3 hacks).
- "C170×C190" e "preservar origem" e "bloqueio crédito ST" eram repetidas → **Prio 8, 5, 20**.
- Itens marcados **(revisar)** (etanol por UF, QAV, ativo imobilizado, Simples, devolução, conveniência) entram com `ativo=FALSE` e `confianca` registrada — o contador ativa após validar no simulador.

---

## 7. Fases de entrega e riscos

**Fase 0 — Fundação (sem mudar comportamento).** DDL das 3 tabelas em `setup_db.js`; `regrasFiscaisService.js` com `aplicarRegrasFiscais`, cache e trilha; seed das regras de **alta confiança** (Prio 5–90 não-revisar). Critério: rodar `aplicarRegrasFiscais` em **shadow mode** no export (calcula e loga, não escreve) e comparar com a saída atual — **byte-equivalência** nas 4 empresas de referência.

**Fase 1 — MVP (cutover de 1 ponto).** Trocar `normalizarLinha` (export, `server.js:6628`) pelo motor. É o ponto mais isolado e o que valida regressão direto no `.txt`. Manter os hacks de injeção/sync ligados. Validar com `validar_todas_empresas.js`.

**Fase 2 — Injeção + Sync.** Plugar o motor em `xmlInjectorService.js:354` e `server.js:1234`, **removendo** os hacks. Dual-read do `de_para_xml.novo_cst/novo_cfop` ativo. Validar reinjeção idempotente (posto de exemplo) e fornecedor "Desconhecido" (sped_participantes).

**Fase 3 — UI.** Menu "Cadastros Fiscais", tela lista (drag-and-drop de prioridade), formulário com pré-visualização viva, simulador e CRUD `/api/regras-fiscais`. Limpar a tela De-Para de tributação.

**Fase 4 — Migração e limpeza.** `migrar_depara_para_regras.js`; ativar regras (revisar) após validação; quando o log "regra ausente" zerar, desligar dual-read; parar de ler `novo_cst/novo_cfop`. Painel de conflitos + trilha exportável.

**Riscos e mitigações:**
- **Quebra de byte-equivalência no `.txt`** (PVA sensível) → shadow mode + `validar_todas_empresas.js` obrigatório em cada fase; cutover ponto-a-ponto.
- **Vigência mal derivada** (usar `new Date()` em vez da competência) → testes específicos reinjetando NF de 2021 e conferindo que regra de 2023 não casa.
- **`normalizarLinha` é síncrono e o motor é `async`** → pré-carregar regras antes do loop e usar caminho síncrono com cache quente (sem `await` ao banco por linha).
- **Pool de conexões esgota em export em sequência** (já conhecido) → 1 query de regras por arquivo, cache por competência; persistência da trilha em batch.
- **Regras (revisar) aplicadas cedo demais** → entram `ativo=FALSE`; só o contador ativa via simulador.
- **C190 dessincronizado do C170** (bug histórico) → Prio 8 obrigatória após qualquer ação; recontar 1990/9900.
- **Conflito/sombreamento silencioso** → detector de conflitos na UI + first-match explícito; "marcar OK" registra na trilha.

**Arquivos tocados:** `backend/services/regrasFiscaisService.js` (novo) · `backend/setup_db.js` (DDL) · `backend/services/xmlInjectorService.js:354-359` · `backend/server.js:1234-1239`, `:6622-6637`, e novos endpoints `/api/regras-fiscais*` (~`:8317`) · `backend/migrar_depara_para_regras.js` (novo) · frontend: nova view de Regras Fiscais + item de menu.