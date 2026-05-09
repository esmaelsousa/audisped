# Plano de Implementação — Injetor SPED Contribuições (EFD-PIS/COFINS)

## Princípio arquitetural central

> **Tudo que é novo vai em arquivos/tabelas NOVOS. Arquivos existentes só recebem ADIÇÕES, nunca modificações em lógica já testada. Todas as funcionalidades existentes permanecem INTOCÁVEIS.**

---

## O que NÃO será tocado

| Arquivo | Status |
|---|---|
| `backend/services/xmlInjectorService.js` | INTOCÁVEL |
| `backend/services/cteInjectorService.js` | INTOCÁVEL |
| `backend/services/spedCostureiraService.js` | INTOCÁVEL |
| `backend/server.js` | Só recebe `app.use(contribuicoesRouter)` no final |
| Tabelas existentes (`documentos_c100`, `documentos_itens_c170`, etc.) | INTOCÁVEIS |
| Todas as views Vue existentes | INTOCÁVEIS |
| Router existente | Só adiciona 1 rota nova |

---

## Fase 0 — Persistir campos PIS/COFINS (única alteração em arquivo existente)

**Arquivo:** `backend/setup_db.js` — somente adição via ADD COLUMN IF NOT EXISTS

Colunas novas em `documentos_itens_c170`:
- `vbc_pis` NUMERIC
- `aliq_pis` NUMERIC
- `vl_pis` NUMERIC
- `vbc_cofins` NUMERIC
- `aliq_cofins` NUMERIC
- `vl_cofins` NUMERIC
- `nat_bc_cred` TEXT (natureza da base de crédito — padrão configurável por empresa)

O `spedContribuicoesService` terá função `enriquecerPisCofins(id_arquivo)` que lê XMLs
do `mde_cache` e popula esses campos via UPDATE. O `xmlInjectorService` não é alterado.

---

## Fase 1 — Parser do SPED Contribuições

**Arquivo novo:** `backend/services/spedContribuicoesService.js`

**Tabelas 100% novas** (prefixo `efd_contrib_` para nunca conflitar com existentes):
- `efd_contrib_arquivos` — controle (id, id_empresa, competencia, regime, path_original, dt_upload)
- `efd_contrib_blocos_raw` — blocos preservados como texto (0, A, F, M, P, 1, 9)
- `efd_contrib_c100` — C100 parseado com campos PIS/COFINS
- `efd_contrib_c170` — C170 com todos os campos de PIS/COFINS
- `efd_contrib_d100` — D100 parseado

**Endpoint novo:** `POST /api/contribuicoes/upload`
- Recebe: arquivo `.txt` + `id_empresa` + `regime` (01=não-cumulativo / 02=cumulativo)
- Faz: parseia, grava blocos no banco, retorna resumo (qtde NFs, período, regime)

---

## Fase 2 — Injetor de NF-e/CT-e no Contribuições

**Arquivo:** `backend/services/spedContribuicoesService.js` (função `injetar`)

Lê SOMENTE (sem escrever) das tabelas existentes:
- `documentos_c100` → cabeçalho das NFs
- `documentos_itens_c170` → itens com PIS/COFINS (campos populados na Fase 0)
- `documentos_d100` → CT-e

Registros gerados para o Contribuições:

| Registro | Descrição | Fonte |
|---|---|---|
| `C001` | Abertura Bloco C | Gerado |
| `C010` | Identificação da empresa | `config_empresa` |
| `C100` | Nota fiscal cabeçalho | `documentos_c100` |
| `C170` | Itens com PIS/COFINS completo | `documentos_itens_c170` |
| `C195` | Observação por CST/CFOP | Calculado dos C170 |
| `C990` | Encerramento Bloco C | Contagem de linhas |
| `D001/D100` | CT-e (Bloco D) | `documentos_d100` |

**Parâmetro `nat_bc_cred`:** valor padrão configurável por empresa antes do processamento,
com opção de sobrescrever por produto no De-Para existente.

**Endpoint novo:** `POST /api/contribuicoes/injetar/:id`
- Recebe: filtros (período, CNPJ emitente, IND_OPER)
- Retorna: preview das notas que serão injetadas + contagem

---

## Fase 3 — Exportação do arquivo

**Arquivo:** `backend/services/spedContribuicoesService.js` (função `exportar`)

Monta o arquivo final na ordem correta:
```
Bloco 0  → raw preservado do banco
Bloco A  → raw preservado do banco
Bloco C  → gerado na Fase 2
Bloco D  → gerado na Fase 2
Bloco F  → raw preservado do banco
Bloco M  → raw preservado do banco (PVA recalcula após importação)
Bloco P  → raw preservado do banco
Bloco 1  → raw preservado do banco
Bloco 9  → recalculado (9001, 9900 por bloco, 9999 total de linhas)
```

**Endpoint novo:** `GET /api/contribuicoes/exportar/:id`
- Retorna: download do `.txt` gerado

---

## Fase 4 — Frontend

**Arquivo novo:** `frontend/src/views/InjetorContribuicoesView.vue`

**Rota nova** em `frontend/src/router/index.js` (1 linha adicionada):
```js
{ path: '/injetor-contribuicoes', name: 'injetor-contribuicoes',
  component: () => import('../views/InjetorContribuicoesView.vue'),
  meta: { requiresAuth: true } }
```

**Telas da view:**
1. **Upload** — drag&drop do `.txt` + seleção de empresa + parâmetro de regime + nat_bc_cred padrão
2. **Revisão** — tabela das NFs que serão injetadas (IND_OPER, número, valor, PIS, COFINS)
3. **Ação** — botão "Injetar e Exportar" → download do arquivo `.txt`

Link no menu lateral (DashboardHub) com ícone de contribuições.

---

## Resumo do impacto por arquivo existente

| Arquivo | Tipo de mudança | Risco |
|---|---|---|
| `backend/setup_db.js` | ADD COLUMN IF NOT EXISTS | Zero |
| `backend/server.js` | 1 linha: `app.use(contribuicoesRouter)` | Zero |
| `frontend/src/router/index.js` | 1 rota nova no array | Zero |
| Todos os outros | Nenhuma alteração | Zero |

---

## Sequência de entregas estimada

| Fase | Escopo | Estimativa |
|---|---|---|
| Fase 0 | Migração de colunas no banco | 1 dia |
| Fase 1 | Parser + upload Contribuições | 2 dias |
| Fase 2 | Injetor C100/C170/D100 | 2 dias |
| Fase 3 | Exportador + recálculo Bloco 9 | 1 dia |
| Fase 4 | Frontend completo | 1 dia |

---

## Próximo passo

Aguardando aprovação para iniciar a implementação pela Fase 0 + Fase 1.
