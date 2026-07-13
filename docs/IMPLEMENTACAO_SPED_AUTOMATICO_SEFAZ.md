# Implementação — SPED Automático × SEFAZ (Loops A e B)

> Data: 2026-07-11 · Plano: [`PLANO_SPED_AUTOMATICO_SEFAZ.md`](../PLANO_SPED_AUTOMATICO_SEFAZ.md)
> Documento função-a-função do que foi implementado nas fases F1→F5.

## 1. Resumo

Fecha os dois loops automáticos em cima da SEFAZ, reaproveitando o motor de conciliação e a injeção que já existiam:

- **Loop A — Faltante:** cruza SPED × SEFAZ (ao vivo, via EspiãoNFe) → detecta NF-e de entrada que falta no SPED → baixa o XML → injeta.
- **Loop B — Valor errado:** para uma nota com valor divergente, baixa o **XML real pela chave** → re-injeta substituindo a nota (mantém C100+C170+C190 consistentes).

**Insight central:** o `conciliar()` já produzia `faltantes` e `divergencia_valor`; só faltava a **fonte** (troca CSV↔EspiãoNFe) e a **ação** (baixar+injetar). Nada da lógica de conciliação/injeção foi reescrito.

---

## 2. Arquitetura

```
Fonte SEFAZ (plugável)                 Motor            Ação (CapturaProvider → injeção existente)
[CSV]     → parseSefazCsv ─┐
[EspiãoNFe]→ sefazShapeFromMdeCache ─┼→ conciliar() → faltantes ─────→ Loop A: baixarXmlPorChave → injetar
 (mde_cache)                         │              divergencia_valor → Loop B: baixarXmlPorChave → re-injetar (forceReplace)
```

Camadas novas: **fonte** (`sefazShapeFromMdeCache`), **provider agnóstico** (`capturaProvider`), **orquestração** (`capturarEInjetarPorChaves` + 3 endpoints), **UI** (botões na aba Conciliação).

---

## 3. Função a função

### 3.1 `backend/services/conciliacaoService.js`

**`sefazShapeFromMdeCache(rows)`** — L242 · *NOVA*
- **O quê:** adapta linhas do `mde_cache` (captura EspiãoNFe) para o **mesmo shape** que `parseSefazCsv` devolve, para alimentar `conciliar()` a partir da SEFAZ ao vivo (sem CSV).
- **Params:** `rows` — array de `{ chave_nfe, numero, valor, data_emissao, nome_emissor, tipo_operacao, situacao? }`.
- **Retorno:** `{ invoices[], byChave:Map, byNumero:Map, total, periodLabel, minYM, maxYM }` (idêntico ao `parseSefazCsv`).
- **Regras:** ignora `tipo_operacao='Saída'` (só entradas/destinadas); deriva competência de `data_emissao` via `compFromAnyDate`; `cnpjEmit` vem da chave. Reusa os helpers privados do módulo (`onlyDigits`, `parseNum`, `cnpjEmitFromChave`, `monthNames`).
- **Export:** adicionado a `module.exports` (L276) — agora `{ parseSefazCsv, conciliar, sefazShapeFromMdeCache }`.

### 3.2 `backend/services/captura/capturaProvider.js` — *ARQUIVO NOVO*

Camada agnóstica: os loops chamam SEMPRE `baixarXmlPorChave`, nunca um provedor direto.

**`espiaoProvider`** (objeto) — L16
- `baixarXmlPorChave(chave, { idEmpresa })` → `{ xml, origem:'espiao' }`. Usa `espiaoNfeService.downloadXml(idEmpresa, chave)`; valida que o XML contém `infNFe` (rejeita resumo).
- `manifestar(chave, tipo='ciencia', cnpjCpf)` → delega `espiaoNfeService.manifestar`.
- `suportaDescoberta = true`.

**`danfeRapidaProvider(apiKey?, { client=axios })`** (fábrica) — L33
- **Fallback de download por chave** (só ≤3 meses; NÃO descobre destinadas).
- `baixarXmlPorChave(chave)` → `GET https://api.danferapida.com.br/documents/b2b/search/:chave` com header `x-api-key`; retorna `{ xml: r.data.xmlCode, origem:'danfe_rapida' }`. Lança se sem `apiKey` ou sem `xmlCode`.
- `manifestar()` → lança (não suportado). `suportaDescoberta = false`.
- `client` é injetável (testes).

**`getProvider(nome?, opts?)`** — L57
- Resolve o provider por nome (default `env CAPTURA_PROVIDER` ou `'espiao'`). `'danfe_rapida'` → `danfeRapidaProvider(opts.apiKey)`.

### 3.3 `backend/server.js` (novas funções e rotas, após a rota `sefaz-csv`)

**`getProvider`** importado — L5768.

**`_mesesComSped(rows)`** — L5771 · *helper*
- Deriva `Set` de competências `YYYYMM` com SPED importado (aceita `YYYY-MM-DD` e `DDMMAAAA`). Usado pela detecção ao vivo.

**`_escopoDePeriodo(periodo)`** — L5781 · *helper*
- Extrai `YYYYMM` de `sped_arquivos.periodo_apuracao` (escopo = competência do SPED aberto).

**`capturarEInjetarPorChaves({ idArquivo, idEmpresa, cnpjEmpresa, chaves, substituir, userCfop, tentarManifestar })`** — L5790 · *núcleo dos Loops A/B*
- **O quê:** para cada chave, baixa o XML (via `getProvider().baixarXmlPorChave`), faz parse (`xml2js`) + `extractNfeData`, e injeta no SPED reaproveitando **exatamente** o caminho do `/api/xml-injector/parse`.
- **Passos:** (1) resolve `fullSpedPath` de `sped_arquivos.caminho_arquivo` (aceita JSON-map); (2) lê o C100 do `.txt` p/ saber chaves existentes; (3) baixa+parseia cada chave — se o download falhar e `tentarManifestar`, chama `provider.manifestar(chave,'ciencia')` e tenta 1x de novo; (4) `chavesParaSubstituir` = (se `substituir`) as baixadas que já existem no SPED; (5) `transformarNotasEmSped(pool, notas, { userCfop:'1102', chavesExistentes, pularDuplicados:!substituir, idEmpresa })`; (6) `injetarXmlEPersistir(fullSpedPath, payload, chavesParaSubstituir)` → grava `latin1`; (7) `sincronizarNotasInjetadas` + `processarAtualizacaoLmcPosInjecao` (mesmos do parse).
- **Retorno:** `{ spedBaseObj, injetadas, substituidas, total_linhas, resultados:[{chave, ok, motivo?, valor?}] }`.
- **Erros:** anexa `.status` (404 se SPED não achado/arquivo ausente) para o handler HTTP.

**`POST /api/conciliacao/sefaz-live`** — L5858 · *Loop A/B: DETECÇÃO ao vivo*
- **Body:** `{ id_empresa, cnpj, id_arquivo?, sync?, data_inicio?, data_fim? }`.
- **Fluxo:** se `sync='true'`, chama `espiaoNfeService.syncNotas` (grava `mde_cache`); lê `mde_cache` (entradas, `data_emissao` normalizada com `to_char`); `sefazShapeFromMdeCache` → `conciliar(...)` com `escrituradas` (mesma SQL de `documentos_c100 ind_oper='0' cod_mod='55'`), `mesesComSped`, `escopoYM` (do `id_arquivo`).
- **Resposta:** mesmo objeto da conciliação CSV + `fonte:'espiao'`; `aviso` se o cache estiver vazio.

**`POST /api/conciliacao/aplicar-faltantes`** — L5908 · *Loop A: ação*
- **Body:** `{ id_arquivo, id_empresa, cnpj, chaves:[...], cfop_padrao?, manifestar? }`.
- Chama `capturarEInjetarPorChaves({ substituir:false, tentarManifestar })`. **Resposta:** `{ message, injetadas, resultados[] , ... }`.

**`POST /api/conciliacao/corrigir-divergentes`** — L5928 · *Loop B: ação*
- **Body:** igual ao de faltantes. Chama `capturarEInjetarPorChaves({ substituir:true })` → re-injeta substituindo a nota errada pelo XML real. **Resposta:** `{ message, substituidas, resultados[], ... }`.

### 3.4 `frontend/src/views/AnalisadorView.vue` (aba Conciliação)

**Refs novas** — L419-421: `concilActionLoading`, `concilActionMsg`, `idEmpresaAtiva()` (=`empresaSelecionada.id`).

**`conciliarSefazLive()`** — L474
- POST `/api/conciliacao/sefaz-live` `{ id_empresa, cnpj, id_arquivo?, sync:true }` → seta `concilResult`. É o botão **"⚡ Conferir com SEFAZ (ao vivo)"** (sem CSV).

**`_chavesValidasConcil(arr)`** — helper: extrai chaves de 44 dígitos de um balde.

**`_postAcaoConcil(url, chaves)`** — L494: POST helper com `{ id_arquivo, id_empresa, cnpj, chaves }`.

**`aplicarFaltantes()`** — L502 · *Loop A (UI)*
- Coleta as chaves dos `faltantes`, confirma, POST `/aplicar-faltantes`, e **reconfere** (`conciliarSefazLive`). Botão **"⬇️ Baixar + injetar faltantes"** no cabeçalho da tabela de faltantes.

**`corrigirDivergentes()`** — L518 · *Loop B (UI)*
- Coleta as chaves de `divergencia_valor`, confirma (avisa que substitui), POST `/corrigir-divergentes`, reconfere. Botão **"🔧 Corrigir do XML real"** no cabeçalho da tabela de divergências.

**Template:** botão "Conferir ao vivo" na barra de ações; `concilActionMsg` e selo "via EspiãoNFe"; botões de ação nos cabeçalhos das tabelas de faltantes e divergência (desabilitados sem SPED aberto).

---

## 4. Contrato HTTP (resumo)

| Método | Rota | Body | Faz |
|---|---|---|---|
| POST | `/api/conciliacao/sefaz-live` | `{id_empresa,cnpj,id_arquivo?,sync?}` | Detecta faltantes/divergências ao vivo (EspiãoNFe) |
| POST | `/api/conciliacao/aplicar-faltantes` | `{id_arquivo,id_empresa,cnpj,chaves[]}` | Loop A: baixa XML + injeta |
| POST | `/api/conciliacao/corrigir-divergentes` | `{id_arquivo,id_empresa,cnpj,chaves[]}` | Loop B: baixa XML real + re-injeta |

Todas exigem `authMiddleware`. Reusam `/api/conciliacao/sefaz-csv` (CSV) que continua funcionando.

---

## 5. Testes (verificado)

- **`backend/tests/conciliacao-mde.test.js`** — 5/5: adaptador só-entradas, faltante verdadeiro, divergência de valor, nota OK, saída ignorada.
- **`backend/tests/captura-provider.test.js`** — 6/6: default espiao, descoberta, download Danfe (mock), erros (sem key / sem xmlCode / manifestar não suportado).
- `node --check backend/server.js` OK; SFC `AnalisadorView.vue` **compila** e expõe os bindings novos.

## 6. Configuração (variáveis de ambiente)

- `ESPIAONFE_CLOUD_TOKEN`, `ESPIAONFE_USER_TOKEN` — já usados pelo EspiãoNFe.
- `CAPTURA_PROVIDER` — `espiao` (default) ou `danfe_rapida`.
- `DANFE_RAPIDA_API_KEY` — só se usar o fallback Danfe Rápida.

## 7. Como usar (fluxo)

1. Abrir o SPED da empresa no Analisador → aba **Conciliação**.
2. Clicar **"⚡ Conferir com SEFAZ (ao vivo)"** (sincroniza e cruza) — ou subir o CSV como antes.
3. Na tabela **Faltantes** → **"Baixar + injetar faltantes"** (Loop A).
4. Na tabela **Divergência de valor** → **"Corrigir do XML real"** (Loop B). Reconfere automaticamente.

## 8. Verificado × pendente de validação AO VIVO

- ✅ **Verificado (unit/compilação):** detecção (F1), provider (F2), sintaxe do server, compilação da UI.
- ⚠️ **Precisa de validação ao vivo** (exige servidor + banco + token EspiãoNFe + SPED real): os 3 endpoints ponta a ponta (download real, injeção real no `.txt`, re-injeção com substituição). A injeção reusa o caminho já provado do `/api/xml-injector/parse`, mas o **encadeamento** (baixar→injetar) só foi exercitado em unidade.
- ⚠️ **Limites SEFAZ (não são bug):** janela de ~3 meses; XML completo exige Ciência; não rodar captura em paralelo com outro sistema sobre o mesmo certificado (cStat 656).

## 9. Deploy

Alterações de **backend exigem reiniciar o servidor** (`node server.js`). Frontend exige **build** (`npm run build`). Ver [`MANUAL_DEPLOY.md`](../MANUAL_DEPLOY.md).

## Próximos refinamentos (não bloqueiam)
- Seleção por linha (checkbox) em vez de "todos do balde".
- Barra de progresso (SSE) durante o download em lote.
- Provider Danfe Rápida como fallback automático quando o EspiãoNFe falhar no download por chave.
