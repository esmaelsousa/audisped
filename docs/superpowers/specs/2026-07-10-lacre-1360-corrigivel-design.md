# Design — Lacre 1360 corrigível no sistema (COMB-1350-1360-01)

**Data:** 2026-07-10
**Branch:** feat/redesign-validador
**Regra alvo:** `COMB-1350-1360-01` — "Bomba (1350) sem registro de lacres (1360) obrigatório"

## Problema

O PVA exige que toda BOMBA (registro `1350`) tenha ao menos um registro filho `1360`
(Lacres da bomba). Alguns ERPs emitem `1350` + `1370` sem os `1360`, gerando o erro
bloqueante "Registro filho obrigatório não foi informado. Registro 1360".

Hoje a regra é `classeCorrecao: 'manual'` — o Validador só instrui "corrigir no ERP".
O usuário **sabe e consegue digitar o número do lacre**; falta apenas um campo na tela
para preencher, como já existe para IE / CPF / CRC do contabilista.

Caso real que motivou (período 01/06/2026, 3 bombas sem 1360):

```
|1350|41420925|GILBARCO VEEDER-ROOT SOLUCOES INDUSTRIA E COMERCIO LTDA|PHR-2422|1|
|1350|41430925|GILBARCO VEEDER-ROOT SOLUCOES INDUSTRIA E COMERCIO LTDA|PHR-2422|1|
|1350|42000925|GILBARCO VEEDER-ROOT SOLUCOES INDUSTRIA E COMERCIO LTDA|PHR-2220|1|
```

## Objetivo

Tornar o erro **corrigível no sistema**, mantendo o texto "corrigir no ERP" ao lado.
Por bomba: dois campos — **nº do lacre** (`NUM_LACRE`) e **data de aplicação**
(`DAT_APLICACAO`, pré-preenchida com o 1º dia do período, editável). Ao salvar, o SPED
exportado passa a conter, sob aquela bomba, a linha `|1360|NUM_LACRE|DAT_APLICACAO|`.

### Fora de escopo
- Auto-preenchimento "adivinhado" do número do lacre (é dado físico externo — o usuário digita).
- Alterar o 1370 (bicos) ou qualquer outra hierarquia do bloco 1.
- Múltiplos lacres por bomba numa única ação (MVP: 1 lacre por bomba; PVA exige "ao menos um").

## Layout dos registros (referência)

- `1350` (bomba): `REG | SERIE(f2) | FABRICANTE(f3) | MODELO(f4) | TIPO_MEDICAO(f5)`
- `1360` (lacres): `REG | NUM_LACRE(f2) | DAT_APLICACAO(f3, DDMMAAAA ≥ 2000)`
- `1360` é filho de `1350`. `1370` (bicos) **não** satisfaz a obrigatoriedade do `1360`.

## Abordagem escolhida

**Estender `val_correcoes` com uma correção do tipo "inserir filho 1360".**

Reusa toda a infra existente: reversibilidade (`ativo=FALSE`), lote (`lote_id`),
changelog do relatório "o que foi corrigido", e o recálculo de totalizadores que o
export já faz. Coerente com o princípio do código: **"correção = dado, não código paralelo"**
(`backend/services/validador/correcoes.js`).

**Alternativa descartada:** tabela dedicada de lacres + injeção própria no export.
Duplicaria reversibilidade/changelog/skip e criaria um caminho de código paralelo ao
`aplicar()`, contra o princípio acima.

## Componentes e mudanças

### 1. `backend/services/validador/correcoes.js`

- **`chaveNatural`**: novo `case '1350'` → `String(f[2]||'').trim()` (SERIE). Chave estável
  por bomba (as 3 SERIE do caso são distintas: 41420925 / 41430925 / 42000925).
- **`aplicar()`**: nova **passada de inserção**, separada da passada de edição de campo.
  - Uma correção-insert é identificada por `campo_idx === 0` (hoje `aplicar` ignora
    `campo_idx ≤ 0` na edição — sentinela sem conflito) e `registro === '1360'`.
  - `valor_corrigido` = `"NUM_LACRE|DAT_APLICACAO"` (payload dos campos f2 e f3 da nova linha).
  - Algoritmo: varre `outputLines`; ao achar `|1350|` cuja SERIE (f[2]) == `chave_natural`
    da correção, faz `splice(i+1, 0, "|1360|NUM_LACRE|DAT_APLICACAO|")` — insere logo após
    o 1350 (antes dos 1370 daquela bomba; ordem entre filhos não é exigida pelo PVA).
  - Tabela de correções vazia (ou sem inserts) → **no-op** → export byte-idêntico (golden).
- **`logarAplicadas`** (changelog): trata inserts registrando
  "inserido 1360 (lacre `NUM_LACRE`, data `DAT_APLICACAO`) na bomba `SERIE`", sem coluna
  antes/depois de campo.

### 2. Totalizadores — sem mudança de código

`recalcularAssinaturasBlocos(linhas)` (em `spedCostureiraService.js`) roda **depois** de
`aplicar()` no export (server.js ~9402 → ~9437 → recalc). Ele:
- recomputa `1990` (contagem do bloco 1) incluindo os 1360 novos;
- recomputa `9900` por tipo de registro **e cria** `|9900|1360|N|` se não existia;
- recomputa `9999` (total geral).

Nada manual. Confirmado por leitura do código.

### 3. `backend/services/validador/rules/r_bloco1_equipamentos_lmc.js`

- Erro passa a carregar metadados p/ a UI e a correção:
  - `chave`: SERIE da bomba (f[2] do 1350).
  - `serie`, `fabricante`, `modelo`: p/ rotular o card ("Bomba 41420925 · GILBARCO PHR-2422").
  - `corrigivel: true` (o front renderiza os inputs).
- `classeCorrecao` continua `'manual'` (dado externo) e `jaCorrigidoNoExport: false`;
  a `instrucaoERP` (texto "corrigir no ERP") permanece.

### 4. Supressão na re-validação

O servidor já marca como corrigidos os erros com `val_correcoes` ativa
(server.js ~5970). Estender o casamento para o erro COMB-1350-1360-01: se existe correção
ativa `registro='1360'`, `campo_idx=0` com `chave_natural == SERIE` da bomba, o erro é
suprimido/marcado como corrigido. Assim "Re-validar" não reacusa a bomba já lacrada.

### 5. Endpoint

Reusar `POST /api/validador/corrigir` (server.js ~6026). Payload:
`{ id_sped_arquivo, regra_id:'COMB-1350-1360-01', registro:'1360', chave_natural:SERIE,
   campo_idx:0, valor_original:'', valor_corrigido:"NUM_LACRE|DAT_APLICACAO" }`.
Validação server-side: `NUM_LACRE` não vazio; `DAT_APLICACAO` = 8 dígitos DDMMAAAA com
ano ≥ 2000 (mesma checagem da regra `INV-1360-DATA-01`). Erro amigável se inválido.

### 6. Frontend `frontend/src/views/ValidadorView.vue`

- No card da ocorrência do erro corrigível de lacre: dois inputs —
  **Nº do lacre** (texto) e **Data de aplicação** (pré-preenchida com o 1º dia do período
  do arquivo, ex.: `01/06/2026`, editável) — e botão **Salvar lacre**.
- Data pré-preenchida derivada de `resultado` (DT_INI do 0000 / período). Formato de
  exibição DD/MM/AAAA; convertido p/ DDMMAAAA no envio.
- Mensagem de sucesso: "Lacre salvo. Clique em Re-validar; o SPED exportado já sai com o
  1360." O texto "corrigir no ERP" continua visível ao lado (não é removido).
- Reaproveita o padrão de `salvarCadastro` (axios + authHeader + `carregarCorrecoes`).

## Fluxo de dados

```
Usuário digita lacre+data → POST /api/validador/corrigir (campo_idx=0, chave=SERIE)
  → INSERT val_correcoes (ativo=TRUE)
Re-validar → engine detecta na ORIGINAL, servidor suprime erro c/ correção ativa
Exportar → buscarCorrecoes → aplicar() insere |1360|lacre|data| após o |1350| da SERIE
  → recalcularAssinaturasBlocos conserta 1990/9900(+cria 1360)/9999
  → .txt final com o 1360; PVA aceita
Desfazer → val_correcoes.ativo=FALSE (individual) ou lote → export volta sem o 1360
```

## Tratamento de erros / bordas

- **SERIE duplicada** entre duas bombas: no caso real são distintas; se houver duplicata,
  a inserção casaria em ambas — mitigar inserindo por ocorrência (contador de SERIE) se
  aparecer (análogo ao `ordinalH005`). MVP: assume SERIE única (validar na detecção; se
  duplicada, degrada para "manual" com aviso).
- **Data inválida**: rejeitada no endpoint (não grava) e no front (não envia).
- **Correção vazia / tabela vazia**: `aplicar()` no-op → golden byte-idêntico.
- **Bomba não encontrada no export** (SERIE sumiu): insert é ignorado (log de aviso), não quebra.

## Testes

- **Unit `aplicar` (novo)**: insere `1360` após o `1350` da SERIE certa; 3 bombas → 3
  inserts nos lugares certos; correções vazias → array inalterado (no-op).
- **Suíte do validador** (`backend/tests/validador-suite.js`): erro COMB-1350-1360-01 vira
  `corrigivel:true` com `chave=SERIE`; com correção ativa, some da lista.
- **Golden** (arnês existente): sem correção → byte-idêntico; com correção → `.txt` contém
  `|1360|...|`, `9900`/`1990`/`9999` corretos, `|9900|1360|` presente, e re-exportar +
  revalidar → 0 erros COMB-1350-1360-01. Usar o arquivo do caso (3 bombas / 06-2026).

## Critérios de aceite

1. Na tela do Validador, o erro de bomba sem 1360 mostra, por bomba, campos de lacre +
   data (pré-preenchida) e botão salvar — junto do texto "corrigir no ERP".
2. Salvar grava correção reversível em `val_correcoes`.
3. Re-validar não reacusa a bomba já lacrada.
4. Exportar produz `.txt` com o `1360` sob a bomba e totalizadores corretos; PVA aceita.
5. Desfazer (individual e por lote) remove o 1360 do export.
6. Golden byte-idêntico quando não há correção de lacre.
