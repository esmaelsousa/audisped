# PLANO — Validação e Correção do Registro 1320 (Encerrantes e Bicos)

**Criado em:** 2026-05-09
**Prioridade:** Alta — erro grave encontrado em arquivo real (Posto Timbau, out/2023)
**Princípio absoluto:** ZERO alteração em código/tabela existente — apenas adições

---

## Diagnóstico do Sistema Atual

### O que o sistema faz hoje com o 1320

| Fase | O que acontece | Onde no código |
|---|---|---|
| **Import** | Lê linhas 1320 → acumula em `pending1320s` (memória) → usa em PASS 3 para montar LMC | server.js ~l.5629 |
| **Banco** | **1320 NÃO é salvo em nenhuma tabela** — só `lmc_movimentacao` (1300 consolidado) | — |
| **Export** | Relê o arquivo original linha por linha — copia 1320 como veio do PVA | server.js ~l.5111 |
| **Validação** | **Nenhuma** — sem checagem de volume negativo, encerrante ou divergência | — |

### Erros confirmados que não são detectados hoje

| Erro | Gravidade | Detectado? |
|---|---|---|
| Volume negativo em bico (Leit. Ini = Leit. Fin, aferição > 0) | GRAVE | ❌ Não |
| Encerrante não-contínuo entre dias (salto > 0,050 L) | DIVERGENTE | ❌ Não |
| Soma dos bicos 1320 ≠ saída 1300 (diferença > 0,900 L) | DIVERGENTE | ❌ Não |

### Formato do Registro 1320 no SPED

```
|1320|NUM_BICO|NUM_LACRE_INI|NUM_LACRE_FIN|NUM_RESP|ENC_INI|ENC_FIN|QTD_AF|VOL|
  [0]   [1]       [2]           [3]           [4]      [5]    [6]     [7]    [8]  [9]
```

- `fields[2]` = Número do bico
- `fields[5]` = NUM_RESP (responsável)
- `fields[6]` = ENC_INI — leitura inicial do encerrante
- `fields[7]` = ENC_FIN — leitura final do encerrante
- `fields[8]` = QTD_AF — volume aferido (calibração)
- `fields[9]` = VOL — volume vendido (= ENC_FIN − ENC_INI − QTD_AF)

---

## Arquivos que Serão Impactados

| Arquivo | Tipo de mudança | Risco |
|---|---|---|
| `backend/server.js` — migration | Adicionar `CREATE TABLE IF NOT EXISTS sped_1320` | Zero — IF NOT EXISTS |
| `backend/server.js` — import | Adicionar INSERT em `sped_1320` após lógica existente | Mínimo — additive, mesma transação |
| `backend/server.js` — export | Adicionar lookup de correção antes de escrever linha 1320 | Baixo — fallback para original se sem correção |
| `backend/server.js` — novos endpoints | 2 novos GET/PUT — não tocam rotas existentes | Zero |
| `frontend/src/views/LmcView.vue` | Novo painel colapsável no final da tela | Mínimo — não toca componentes existentes |

---

## Fases de Implementação

---

### FASE 1 — Tabela `sped_1320` no banco

**Objetivo:** persistir os dados brutos do 1320 de cada arquivo importado.

**Regra de segurança:** `IF NOT EXISTS` — rodar migrations existentes não vai quebrar nada.

```sql
CREATE TABLE IF NOT EXISTS sped_1320 (
    id               SERIAL PRIMARY KEY,
    id_sped_arquivo  INTEGER NOT NULL REFERENCES sped_arquivos(id) ON DELETE CASCADE,
    data_mov         DATE    NOT NULL,
    cod_item         VARCHAR NOT NULL,
    num_tanque       VARCHAR NOT NULL,
    num_bico         VARCHAR NOT NULL,
    enc_ini          NUMERIC(15,3),          -- leitura inicial (ENC_INI)
    enc_fin          NUMERIC(15,3),          -- leitura final (ENC_FIN)
    qtd_af           NUMERIC(15,3) DEFAULT 0, -- aferição (QTD_AF)
    vol_bico         NUMERIC(15,3),          -- volume calculado (VOL)
    enc_ini_corrigido NUMERIC(15,3),         -- null = não corrigido
    enc_fin_corrigido NUMERIC(15,3),         -- null = não corrigido
    qtd_af_corrigido  NUMERIC(15,3),         -- null = não corrigido
    corrigido        BOOLEAN DEFAULT FALSE,
    UNIQUE (id_sped_arquivo, data_mov, cod_item, num_bico)
);
```

**Por que separar colunas `_corrigido`?**
- Mantém o valor original do PVA inalterado para auditoria
- A correção é uma camada paralela — o original nunca é sobrescrito
- Se o usuário desfizer a correção → basta setar `corrigido = FALSE`

**Rollback desta fase:** `DROP TABLE IF EXISTS sped_1320;` — sem impacto em outras tabelas.

---

### FASE 2 — Gravar 1320 durante o import

**Onde inserir no código:** `server.js` — na seção de PASS 3, dentro do loop `for (let b = 0; b < bicosDesteTanque.length; b++)`, **após** a lógica existente de `encerrantesBombasMap` (linha ~5445). O código existente NÃO é tocado.

**Lógica (pseudo-código adicionado após o bloco existente):**

```javascript
// --- NOVO: Gravar 1320 no banco (additive, não altera lógica acima) ---
const encIniVal = parseFloat((bFields[6] || '0').replace(',', '.')) || null;
const encFinVal = parseFloat((bFields[7] || '0').replace(',', '.')) || null;
const qtdAfVal  = parseFloat((bFields[8] || '0').replace(',', '.')) || 0;
const volVal    = parseFloat((bFields[9] || '0').replace(',', '.')) || null;

await dbClient.query(`
    INSERT INTO sped_1320
        (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico,
         enc_ini, enc_fin, qtd_af, vol_bico)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id_sped_arquivo, data_mov, cod_item, num_bico) DO NOTHING
`, [
    sped_arquivo_id,
    dayData.date,          -- já disponível no contexto
    currentCodItem,        -- já disponível no contexto
    tanqueCod,             -- já disponível no loop
    bicoNum,               -- já disponível (bFields[2])
    encIniVal,
    encFinVal,
    qtdAfVal,
    volVal
]);
// --- FIM DO NOVO ---
```

**Proteção:** `ON CONFLICT DO NOTHING` — se o mesmo arquivo for reimportado, não duplica.

**Impacto no import atual:** nenhum — o INSERT ocorre na mesma transação que já existe. Se falhar → rollback já implementado pelo código existente.

**Atenção — arquivos já importados:**
Arquivos importados antes desta fase não terão dados em `sped_1320`. O usuário deve **reimportar** esses arquivos para ativar a validação neles. O sistema continua funcionando normalmente para arquivos sem dados em `sped_1320`.

---

### FASE 3 — Endpoint de Validação (somente leitura)

**Novo endpoint:** `GET /api/lmc/validacoes-1320/:id_arquivo`

**O que faz:** lê `sped_1320` e `lmc_movimentacao`, computa as 3 validações, retorna JSON. Zero escrita no banco.

**Validações computadas:**

#### V1 — Volume Negativo no Bico
```sql
SELECT data_mov, cod_item, num_bico, enc_ini, enc_fin, qtd_af, vol_bico
FROM sped_1320
WHERE id_sped_arquivo = $1
  AND vol_bico < 0
ORDER BY data_mov, cod_item, num_bico;
```

#### V2 — Encerrante Não-Contínuo entre Dias
```sql
SELECT
    a.cod_item,
    a.num_bico,
    a.data_mov AS data_anterior,
    b.data_mov AS data_atual,
    COALESCE(a.enc_fin_corrigido, a.enc_fin) AS fin_anterior,
    COALESCE(b.enc_ini_corrigido, b.enc_ini) AS ini_atual,
    ABS(COALESCE(b.enc_ini_corrigido, b.enc_ini) - COALESCE(a.enc_fin_corrigido, a.enc_fin)) AS diferenca
FROM sped_1320 a
JOIN sped_1320 b
    ON b.id_sped_arquivo = a.id_sped_arquivo
   AND b.cod_item = a.cod_item
   AND b.num_bico = a.num_bico
   AND b.data_mov = a.data_mov + INTERVAL '1 day'
WHERE a.id_sped_arquivo = $1
  AND ABS(COALESCE(b.enc_ini_corrigido, b.enc_ini) - COALESCE(a.enc_fin_corrigido, a.enc_fin)) > 0.05
ORDER BY a.data_mov, a.cod_item, a.num_bico;
```

#### V3 — Divergência 1320 × 1300
```sql
SELECT
    s.data_mov,
    s.cod_item,
    SUM(CASE WHEN s.corrigido THEN s.enc_fin_corrigido - s.enc_ini_corrigido - COALESCE(s.qtd_af_corrigido,0)
             ELSE s.vol_bico END) AS soma_bicos,
    m.vol_saidas AS saida_1300,
    ABS(SUM(CASE WHEN s.corrigido THEN s.enc_fin_corrigido - s.enc_ini_corrigido - COALESCE(s.qtd_af_corrigido,0)
                 ELSE s.vol_bico END) - m.vol_saidas) AS diferenca
FROM sped_1320 s
JOIN lmc_movimentacao m
    ON m.id_sped_arquivo = s.id_sped_arquivo
   AND m.cod_item = s.cod_item
   AND m.data_mov::date = s.data_mov
   AND m.num_tanque = '0'   -- registro consolidado do 1300
WHERE s.id_sped_arquivo = $1
GROUP BY s.data_mov, s.cod_item, m.vol_saidas
HAVING ABS(SUM(...) - m.vol_saidas) > 0.9
ORDER BY s.data_mov, s.cod_item;
```

**Resposta JSON:**
```json
{
  "total_erros": 3,
  "volumes_negativos": [...],
  "encerrantes_divergentes": [...],
  "divergencias_1320_1300": [...]
}
```

---

### FASE 4 — Endpoint de Correção (edição controlada)

**Novo endpoint:** `PUT /api/lmc/1320/:id_sped_arquivo/:cod_item/:num_bico/:data_mov`

**O que faz:** atualiza os campos `_corrigido` no registro `sped_1320`. Não toca `lmc_movimentacao` nem qualquer outra tabela.

**Corpo da requisição:**
```json
{
  "enc_ini_corrigido": 265037.379,
  "enc_fin_corrigido": 265134.944,
  "qtd_af_corrigido": 40.000
}
```

**Lógica:**
```javascript
// Calcula novo vol_bico a partir dos valores corrigidos
const vol_calculado = enc_fin_corrigido - enc_ini_corrigido - qtd_af_corrigido;

await pool.query(`
    UPDATE sped_1320
    SET enc_ini_corrigido = $1,
        enc_fin_corrigido = $2,
        qtd_af_corrigido  = $3,
        corrigido         = TRUE
    WHERE id_sped_arquivo = $4
      AND cod_item = $5
      AND num_bico = $6
      AND data_mov = $7
`, [enc_ini_corrigido, enc_fin_corrigido, qtd_af_corrigido,
    id_sped_arquivo, cod_item, num_bico, data_mov]);
```

**Proteção:** authMiddleware obrigatório — mesmo middleware de todas as rotas existentes.

---

### FASE 5 — Export usa correções do `sped_1320`

**Onde modificar:** endpoint `/api/exportar-sped/:id`, **antes** do loop principal que lê o arquivo.

**Passo 5a — Carregar mapa de correções (antes do loop):**
```javascript
// Carregar correções 1320 (se tabela existir e houver registros)
const correcoes1320 = new Map();
try {
    const cor = await pool.query(
        `SELECT data_mov::text, cod_item, num_bico,
                enc_ini_corrigido, enc_fin_corrigido, qtd_af_corrigido
         FROM sped_1320
         WHERE id_sped_arquivo = $1 AND corrigido = TRUE`,
        [id]
    );
    cor.rows.forEach(r => {
        const key = `${r.data_mov}|${r.cod_item}|${r.num_bico}`;
        correcoes1320.set(key, r);
    });
} catch (e) {
    // Tabela pode não existir em instâncias antigas → ignorar silenciosamente
    logger.warn('sped_1320 não disponível — exportando 1320 sem correções');
}
```

**Passo 5b — Aplicar correção ao escrever cada linha 1320:**

No loop que processa as linhas do arquivo original, onde o 1320 é escrito:
```javascript
// Dentro do loop de bicos 1320 (PASS 3, ~linha 5415)
const chaveCorrecao = `${dayData.date}|${currentCodItem}|${bicoNum}`;
if (correcoes1320.has(chaveCorrecao)) {
    const c = correcoes1320.get(chaveCorrecao);
    const volCorrigido = c.enc_fin_corrigido - c.enc_ini_corrigido - (c.qtd_af_corrigido || 0);
    // Substituir apenas os campos corrigidos — demais campos do bico inalterados
    bFields[6] = String(c.enc_ini_corrigido).replace('.', ',');
    bFields[7] = String(c.enc_fin_corrigido).replace('.', ',');
    bFields[8] = String(c.qtd_af_corrigido || 0).replace('.', ',');
    bFields[9] = volCorrigido.toFixed(3).replace('.', ',');
}
// O push/write existente continua igual
```

**Proteção principal:** se `correcoes1320` está vazio (sem correções ou tabela inexistente) → o `if` nunca entra → comportamento 100% idêntico ao atual.

---

### FASE 6 — Painel de Validação na UI (`LmcView.vue`)

**Onde adicionar:** após o último card de totais, antes do botão EXPORTAR SPED — novo bloco colapsável.

**Não toca nenhum componente existente** — é um `<div>` novo posicionado abaixo do que já existe.

**Comportamento:**
1. Ao selecionar um arquivo no LMC → chama `GET /api/lmc/validacoes-1320/:id`
2. Se `total_erros === 0` → não exibe o painel (invisível)
3. Se `total_erros > 0` → exibe painel em vermelho com as inconsistências

**Layout do painel:**
```
┌────────────────────────────────────────────────────────────────────┐
│  ❌ Inconsistências no Registro 1320                   [▼ Detalhar]│
│                                                                     │
│  VOLUMES NEGATIVOS                                                  │
│  Data         Produto   Bico   Enc. Ini    Enc. Fin    Aferição  Vol│
│  25/10/2023   Etanol    01     265.094,944 265.094,944  40,000  -40 │
│                                                               [✏ Corrigir] │
│                                                                     │
│  ENCERRANTES DIVERGENTES                                            │
│  Produto  Bico  Dia Ant.   Dia Atual  Fin Ant.    Ini Atual   Δ    │
│  Etanol   01    24/10      25/10      265.037,379 265.094,944 +57,5 │
│                                                                     │
│  DIVERGÊNCIAS 1320 × 1300                                          │
│  Data         Produto   Saída 1300  Soma Bicos   Δ      %           │
│  25/10/2023   Etanol    442,259     344,694      -97,565 22,06%     │
└────────────────────────────────────────────────────────────────────┘
```

**Modal de correção (ao clicar ✏ Corrigir):**
```
┌──────────────────────────────────────────────────────┐
│  Corrigir Bico 01 — Etanol — 25/10/2023              │
│                                                      │
│  Encerrante Inicial:  [_265.037,379_]  (original: 265.094,944) │
│  Encerrante Final:    [_265.134,944_]  (original: 265.094,944) │
│  Aferição:            [___40,000___]   (original: 40,000)      │
│                                                      │
│  Volume calculado: 57,565 L  ✅                      │
│                                                      │
│  [Cancelar]                       [Salvar Correção]  │
└──────────────────────────────────────────────────────┘
```

---

## Ordem de Implementação (sequencial, cada fase independente)

| Fase | O que faz | Pode entregar isolada? |
|---|---|---|
| **1** | Criar tabela `sped_1320` | ✅ Sim — sem impacto |
| **2** | Gravar 1320 no import | ✅ Sim — import funciona igual, só grava a mais |
| **3** | Endpoint de validação | ✅ Sim — só leitura |
| **4** | Endpoint de correção | ✅ Sim — só escreve em tabela nova |
| **5** | Export usa correções | ✅ Sim — fallback seguro se sem correções |
| **6** | Painel UI | ✅ Sim — componente novo |

---

## Casos Especiais e Proteções

| Situação | Tratamento |
|---|---|
| Arquivo importado antes da Fase 1/2 | `sped_1320` vazio → export/validação ignoram silenciosamente |
| Tabela `sped_1320` não existe (instância antiga) | `try/catch` no export → usa original sem correção |
| Usuário desfaz correção | `PUT` com `corrigido = FALSE` → export volta ao original |
| Múltiplos bicos no mesmo tanque | Cada bico tem sua própria chave única (cod_item + num_bico + data_mov) |
| Dias sem movimento (sem 1320) | Nenhum registro inserido — validação retorna OK por ausência |
| Reimport do mesmo arquivo | `ON CONFLICT DO NOTHING` → dados originais preservados, correções mantidas |

---

## O que NÃO será feito (proteções explícitas)

- ❌ Não alterar `lmc_movimentacao` — os dados do 1300 não são tocados
- ❌ Não alterar `sped_arquivos` — nenhuma coluna nova na tabela principal
- ❌ Não modificar a lógica de `encerrantesBombasMap` existente
- ❌ Não auto-corrigir sem intervenção do usuário — o sistema sugere, o usuário decide
- ❌ Não modificar o comportamento de REDISTRIBUIR / AUTO / OTIMIZADOR
- ❌ Não bloquear o export se houver erros — apenas avisar (usuário tem autonomia)

---

## Status

- [ ] Fase 1 — Tabela `sped_1320`
- [ ] Fase 2 — Gravar 1320 no import
- [ ] Fase 3 — Endpoint de validação
- [ ] Fase 4 — Endpoint de correção
- [ ] Fase 5 — Export com correções
- [ ] Fase 6 — Painel UI

**Estimativa:** 6–8h de desenvolvimento distribuídas em 2 sessões.
