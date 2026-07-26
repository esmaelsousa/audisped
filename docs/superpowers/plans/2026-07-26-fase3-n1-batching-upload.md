# Fase 3 (#6) — Batching N+1 no upload de SPED · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os ~530k inserts linha-a-linha do upload de SPED por inserts em lote (UNNEST), preservando 100% do conteúdo/ordem no banco e o export byte-idêntico.

**Architecture:** Extrai o bloco de inserts do `POST /api/upload` para um módulo isolado `services/upload/inserirDadosSped.js`. Uma rota dev hard-gated faz parse+insert+snapshot dentro de uma transação com ROLLBACK, permitindo um teste determinístico sem mutar o banco nem colidir com os ids golden. Depois reescreve o interior do módulo para UNNEST em lote.

**Tech Stack:** Node.js, Express, node-postgres (`pg`), sem dependências novas. Testes = scripts node (padrão do repo), rodados com o servidor local de pé.

## Global Constraints

- **Nada de git push / deploy / mudança em produção sem OK explícito do Esmael.** Fluxo: localhost → testar → autorizar. Commits locais são permitidos.
- **Export byte-idêntico é inegociável:** `node tests/golden-export.js check` (7 fixtures) deve ficar verde em toda task.
- **Validador:** `npm run test:validador` deve ficar 218/218 em toda task.
- **Sem dependência nova** (usar só `pg`, `crypto`, `fs`, `jsonwebtoken` já presentes).
- **Backend roda como `node server.js` puro (sem nodemon)** → após editar backend, reiniciar o servidor manualmente antes de rodar testes que batem no HTTP.
- **Transação única do upload preservada** (BEGIN em server.js:1107, COMMIT em 1253). Os inserts continuam todos dentro dela.
- **Tipos de coluna (do schema de produção, verificados 2026-07-26)** — usar exatamente estes casts no UNNEST:
  - `documentos_c100`: id_sped_arquivo int, ind_oper text, num_doc text, cod_mod text, cod_sit text, dt_doc date, dt_e_s date, vl_doc numeric, cod_part text, chv_nfe text
  - `documentos_itens_c170`: id_documento_c100 int, num_item int, cod_item text, qtd numeric, unid text, vl_item numeric, cst_icms text, cfop text, cst_pis text, cst_cofins text
  - `documentos_c190`: id_documento_c100 int, cst_icms text, cfop text, aliq_icms numeric, vl_opr numeric, vl_bc_icms numeric, vl_icms numeric
  - `sped_1320`: id_sped_arquivo int, data_mov date, cod_item text, num_tanque text, num_bico text, enc_ini numeric, enc_fin numeric, qtd_af numeric, vol_bico numeric
  - `documentos_d100`: id_sped_arquivo int, ind_oper text, num_doc text, cod_mod text, cod_sit text, dt_doc date, cfop text, vl_doc numeric, vl_icms numeric
  - `sped_participantes`: id_sped_arquivo int, cod_part text, nome text, cnpj text
  - `sped_produtos`: id_sped_arquivo int, cod_item text, descr_item text, ncm text
  - `lmc_movimentacao`: id_sped_arquivo int, cod_item text, num_tanque text ('0'), cap_tanque numeric (0), data_mov date, estq_abert numeric, vol_entr numeric, vol_saidas numeric, val_perda numeric, val_ganho numeric, estq_escr numeric, fech_fisico numeric

---

## File Structure

- **Create:** `backend/services/upload/inserirDadosSped.js` — dono único dos inserts do upload; exporta `inserirDadosSped(client, spedArquivoId, parsedData, logger)`.
- **Create:** `backend/services/upload/importSnapshot.dev.js` — helper de teste: monta o snapshot estrutural de um arquivo (counts + hash invariante a id) via queries de leitura.
- **Modify:** `backend/server.js` — (a) trocar o bloco de inserts (1182-1251) por uma chamada ao módulo; (b) adicionar rota dev hard-gated `POST /api/_dev/import-snapshot`.
- **Create:** `backend/tests/import-snapshot.js` — cliente do teste (baseline/check), modelado no `tests/golden-export.js`.
- **Create (gitignored):** `backend/tests/import-snapshot.manifest.json` — hashes de baseline (só hashes → commitável; ver Task 2 sobre o que vai pro git).

---

## Task 1: Extrair inserts para módulo + rota dev de snapshot (sem mudar comportamento)

**Files:**
- Create: `backend/services/upload/inserirDadosSped.js`
- Create: `backend/services/upload/importSnapshot.dev.js`
- Modify: `backend/server.js:1182-1251` (substituir bloco por chamada), e adicionar rota dev perto das outras rotas.
- Test: `backend/tests/golden-export.js`, `npm run test:validador`

**Interfaces:**
- Produces: `inserirDadosSped(client, spedArquivoId, parsedData, logger) → Promise<{ dbWrites: number }>`. `parsedData` tem `{ documents, participants, produtos, bicos, lmc, blocoD }` (mesmas estruturas que o upload já monta; `lmc` é um `Map`, `blocoD` pode ser `undefined`).
- Produces: `montarSnapshot(client, spedArquivoId) → Promise<{ counts: object, hash: string }>` (em `importSnapshot.dev.js`).

- [ ] **Step 1: Criar o módulo com o bloco de inserts movido verbatim + contador**

Create `backend/services/upload/inserirDadosSped.js` com o conteúdo abaixo. É o bloco 1182-1251 do server.js movido **sem alterar a lógica** (mesmos SQL, mesmos ON CONFLICT), só embrulhado numa função e com um contador `dbWrites`:

```javascript
'use strict';

/**
 * Insere no banco os dados já parseados de um SPED (LMC/1320/D100/participantes/
 * produtos/C100-C170-C190). Movido verbatim do POST /api/upload (Fase 3 #6) para
 * isolar o caminho de escrita e permitir batching + teste determinístico.
 *
 * NÃO abre/fecha transação — o chamador controla BEGIN/COMMIT/ROLLBACK.
 * Retorna { dbWrites } = número de INSERTs emitidos (métrica anti-N+1).
 */
async function inserirDadosSped(client, spedArquivoId, parsedData, logger) {
    const { documents = [], participants = [], produtos = [], bicos = [], lmc } = parsedData;
    const blocoD = parsedData.blocoD || [];
    let dbWrites = 0;
    const q = (sql, params) => { dbWrites++; return client.query(sql, params); };

    // Inserir LMC (Bloco 1)
    if (lmc && typeof lmc.entries === 'function') {
        for (const [codItem, dailyMovements] of lmc.entries()) {
            for (const dayData of dailyMovements.values()) {
                await q(
                    `INSERT INTO lmc_movimentacao (id_sped_arquivo, cod_item, num_tanque, cap_tanque, data_mov, estq_abert, vol_entr, vol_saidas, val_perda, val_ganho, estq_escr, fech_fisico)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                    [spedArquivoId, codItem, '0', 0, dayData.date, dayData.estqAbert, dayData.volEntr, dayData.volSaidas, dayData.valPerda, dayData.valGanho, dayData.estqEscr, dayData.fechFisico]
                );
            }
        }
    }
    logger && logger.info('Passo 4: Dados LMC (Bloco 1) inseridos.');

    // Inserir registros 1320 (encerrantes por bico)
    if (bicos && bicos.length > 0) {
        for (const b of bicos) {
            await q(
                `INSERT INTO sped_1320 (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico, enc_ini, enc_fin, qtd_af, vol_bico)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico) DO NOTHING`,
                [spedArquivoId, b.data_mov, b.cod_item, b.num_tanque, b.num_bico, b.enc_ini, b.enc_fin, b.qtd_af, b.vol_bico]
            );
        }
        logger && logger.info(`Passo 4.1: Registros 1320 (${bicos.length} bicos) inseridos.`);
    }

    // Inserir Bloco D (D100)
    if (blocoD && blocoD.length > 0) {
        for (const d of blocoD) {
            await q(
                `INSERT INTO documentos_d100 (id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, cfop, vl_doc, vl_icms)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [spedArquivoId, d.ind_oper, d.num_doc, d.cod_mod, d.cod_sit, d.dt_doc, d.cfop, d.vl_doc, d.vl_icms]
            );
        }
        logger && logger.info(`Passo 4.5: Documentos do Bloco D (${blocoD.length}) inseridos.`);
    }

    // Inserir Participantes (0150)
    for (const p of participants) {
        await q(
            `INSERT INTO sped_participantes (id_sped_arquivo, cod_part, nome, cnpj) VALUES ($1, $2, $3, $4) ON CONFLICT (id_sped_arquivo, cod_part) DO NOTHING`,
            [spedArquivoId, p.cod_part, p.nome, p.cnpj]
        );
    }
    logger && logger.info('Passo 5: Participantes (0150) inseridos.');

    // Inserir Produtos (0200)
    for (const p of produtos) {
        await q(
            `INSERT INTO sped_produtos (id_sped_arquivo, cod_item, descr_item, ncm) VALUES ($1, $2, $3, $4) ON CONFLICT (id_sped_arquivo, cod_item) DO UPDATE SET ncm = EXCLUDED.ncm`,
            [spedArquivoId, p.cod_item, p.descr_item, p.ncm || null]
        );
    }
    logger && logger.info('Passo 5.5: Produtos (0200) inseridos.');

    // Inserir Documentos (C100, C170, C190)
    for (const doc of documents) {
        const docResult = await q(
            `INSERT INTO documentos_c100 (id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [spedArquivoId, doc.ind_oper, doc.num_doc, doc.cod_mod, doc.cod_sit, doc.dt_doc, doc.dt_e_s, doc.vl_doc, doc.cod_part, doc.chv_nfe]
        );
        const currentC100_id = docResult.rows[0].id;

        for (const item of (doc.items || [])) {
            await q(
                `INSERT INTO documentos_itens_c170 (id_documento_c100, num_item, cod_item, qtd, unid, vl_item, cst_icms, cfop, cst_pis, cst_cofins) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [currentC100_id, item.num_item, item.cod_item, item.qtd, item.unid, item.vl_item, item.cst_icms, item.cfop, item.cst_pis, item.cst_cofins]
            );
        }
        for (const ana of (doc.analytical || [])) {
            await q(
                `INSERT INTO documentos_c190 (id_documento_c100, cst_icms, cfop, aliq_icms, vl_opr, vl_bc_icms, vl_icms) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [currentC100_id, ana.cst, ana.cfop, ana.aliq, ana.vl_opr, ana.vl_bc_icms, ana.vl_icms]
            );
        }
    }
    logger && logger.info('Passo 6: Documentos (C100/C170/C190) inseridos.');

    return { dbWrites };
}

module.exports = { inserirDadosSped };
```

- [ ] **Step 2: Trocar o bloco no server.js pela chamada ao módulo**

No topo do server.js, junto dos outros requires (perto da linha 15), adicionar:

```javascript
const { inserirDadosSped } = require('./services/upload/inserirDadosSped');
```

Substituir **todo** o bloco de server.js:1182-1251 (do comentário `// Inserir LMC (Bloco 1)` até o `logger.info("Passo 6...")` inclusive) por:

```javascript
        // Inserção dos dados parseados (LMC/1320/D100/participantes/produtos/C100-C170-C190).
        // Movido para services/upload/inserirDadosSped.js (Fase 3 #6). Segue na mesma transação.
        const { dbWrites } = await inserirDadosSped(
            dbClient, sped_arquivo_id, { documents, participants, produtos, bicos, lmc, blocoD: parsedData.blocoD }, logger
        );
        logger.info(`Passo 6: inserirDadosSped emitiu ${dbWrites} escrita(s).`);
```

- [ ] **Step 3: Reiniciar o servidor e rodar o golden-export baseline (se ainda não existir) + check**

Se `tests/golden/manifest.json` já tem baseline, rode só o check. Se não, gere baseline primeiro.

Run (a partir de `backend/`, servidor reiniciado):
```bash
node tests/golden-export.js check
```
Expected: `[golden] resultado: N OK, 0 falha(s).` (todos idênticos — foi um move puro).

- [ ] **Step 4: Rodar o validador**

Run:
```bash
npm run test:validador
```
Expected: suíte 218/218 verde (0 falhas).

- [ ] **Step 5: Criar o helper de snapshot estrutural**

Create `backend/services/upload/importSnapshot.dev.js`:

```javascript
'use strict';
const crypto = require('crypto');

/**
 * Monta um snapshot ESTRUTURAL do que foi inserido para um sped_arquivo:
 *  - counts por tabela
 *  - hash sha256 invariante ao id absoluto (ordena por ordem de inserção via id
 *    relativo e faz hash só das colunas de negócio + linkagem pai→filho)
 * Usado pelo teste import-snapshot para provar que o batching não muda o conteúdo.
 */
async function montarSnapshot(client, spedArquivoId) {
    const counts = {};
    const one = async (label, sql) => {
        const r = await client.query(sql, [spedArquivoId]);
        return r.rows;
    };

    // C100 em ordem de inserção (id ASC = ordem dos documentos), sem expor o id absoluto.
    const c100 = await one('c100', `SELECT id, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe
        FROM documentos_c100 WHERE id_sped_arquivo = $1 ORDER BY id ASC`);
    const c170 = await client.query(`SELECT c.id_documento_c100, i.num_item, i.cod_item, i.qtd, i.unid, i.vl_item, i.cst_icms, i.cfop, i.cst_pis, i.cst_cofins
        FROM documentos_itens_c170 i JOIN documentos_c100 c ON c.id = i.id_documento_c100
        WHERE c.id_sped_arquivo = $1 ORDER BY i.id ASC`, [spedArquivoId]);
    const c190 = await client.query(`SELECT a.id_documento_c100, a.cst_icms, a.cfop, a.aliq_icms, a.vl_opr, a.vl_bc_icms, a.vl_icms
        FROM documentos_c190 a JOIN documentos_c100 c ON c.id = a.id_documento_c100
        WHERE c.id_sped_arquivo = $1 ORDER BY a.id ASC`, [spedArquivoId]);

    // Agrupa filhos por pai; substitui o id absoluto do pai por seu índice ordinal (invariante).
    const idxDe = new Map(c100.map((r, i) => [r.id, i]));
    const filhosC170 = c100.map(() => []);
    const filhosC190 = c100.map(() => []);
    for (const r of c170.rows) { const { id_documento_c100, ...biz } = r; filhosC170[idxDe.get(id_documento_c100)].push(biz); }
    for (const r of c190.rows) { const { id_documento_c100, ...biz } = r; filhosC190[idxDe.get(id_documento_c100)].push(biz); }
    const c100Canon = c100.map((r, i) => { const { id, ...biz } = r; return { biz, c170: filhosC170[i], c190: filhosC190[i] }; });

    const sib = async (sql) => (await client.query(sql, [spedArquivoId])).rows;
    const s1320 = await sib(`SELECT data_mov, cod_item, num_tanque, num_bico, enc_ini, enc_fin, qtd_af, vol_bico FROM sped_1320 WHERE id_sped_arquivo=$1 ORDER BY data_mov, cod_item, num_tanque, num_bico`);
    const d100 = await sib(`SELECT ind_oper, num_doc, cod_mod, cod_sit, dt_doc, cfop, vl_doc, vl_icms FROM documentos_d100 WHERE id_sped_arquivo=$1 ORDER BY num_doc, cod_mod, cfop`);
    const parts = await sib(`SELECT cod_part, nome, cnpj FROM sped_participantes WHERE id_sped_arquivo=$1 ORDER BY cod_part`);
    const prods = await sib(`SELECT cod_item, descr_item, ncm FROM sped_produtos WHERE id_sped_arquivo=$1 ORDER BY cod_item`);
    const lmc = await sib(`SELECT cod_item, num_tanque, cap_tanque, data_mov, estq_abert, vol_entr, vol_saidas, val_perda, val_ganho, estq_escr, fech_fisico FROM lmc_movimentacao WHERE id_sped_arquivo=$1 ORDER BY cod_item, data_mov`);

    counts.c100 = c100.length; counts.c170 = c170.rowCount; counts.c190 = c190.rowCount;
    counts.sped_1320 = s1320.length; counts.d100 = d100.length; counts.participantes = parts.length;
    counts.produtos = prods.length; counts.lmc = lmc.length;

    const canon = { c100: c100Canon, s1320, d100, parts, prods, lmc };
    // Normaliza numeric (Postgres devolve string) para string trim — determinístico.
    const hash = crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex');
    return { counts, hash };
}

module.exports = { montarSnapshot };
```

- [ ] **Step 6: Adicionar a rota dev hard-gated no server.js**

Perto das outras rotas (ex.: logo após a rota `/api/upload`, depois da linha ~1278), adicionar. **Três travas**: exige `ENABLE_DEV_SNAPSHOT=1`, 404 em produção, e whitelist de path para `tests/golden/`. Faz parse+insert+snapshot e **sempre ROLLBACK**:

```javascript
// ROTA DEV (Fase 3 #6): parse+insert+snapshot em transação com ROLLBACK. Zero mutação.
// Hard-gated: só existe com ENABLE_DEV_SNAPSHOT=1 e nunca em produção.
app.post('/api/_dev/import-snapshot', async (req, res) => {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEV_SNAPSHOT !== '1') {
        return res.sendStatus(404);
    }
    const { fixture } = req.body || {};
    if (!/^[0-9]+\.txt$/.test(String(fixture || ''))) return res.status(400).json({ message: 'fixture inválido' });
    const fixturePath = path.join(__dirname, 'tests', 'golden', fixture);
    if (!fs.existsSync(fixturePath)) return res.status(404).json({ message: 'fixture não encontrado' });

    const { montarSnapshot } = require('./services/upload/importSnapshot.dev');
    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');
        const parsed = await parseSpedFile(fixturePath, fixture);
        // empresa e arquivo temporários (serão descartados no ROLLBACK)
        const emp = await dbClient.query(
            `INSERT INTO empresas (cnpj, nome_empresa, rede_id) VALUES ($1,$2,(SELECT id FROM redes WHERE nome='default' LIMIT 1)) RETURNING id`,
            ['00000000000000', '__snapshot_tmp__']);
        const arq = await dbClient.query(
            `INSERT INTO sped_arquivos (nome_arquivo, cnpj_empresa, periodo_apuracao, id_empresa, caminho_arquivo) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [fixture, '00000000000000', parsed.fileInfo.periodo_apuracao, emp.rows[0].id, fixturePath]);
        const tempId = arq.rows[0].id;
        const { dbWrites } = await inserirDadosSped(dbClient, tempId, {
            documents: parsed.documents, participants: parsed.participants, produtos: parsed.produtos,
            bicos: parsed.bicos, lmc: parsed.lmc, blocoD: parsed.blocoD
        }, null);
        const snap = await montarSnapshot(dbClient, tempId);
        await dbClient.query('ROLLBACK');
        res.json({ ...snap, dbWrites });
    } catch (e) {
        try { await dbClient.query('ROLLBACK'); } catch (_) {}
        res.status(500).json({ message: e.message });
    } finally {
        dbClient.release();
    }
});
```

- [ ] **Step 7: Commit**

```bash
cd /Users/esmael/meus_sistemas/audisped
git add backend/services/upload/inserirDadosSped.js backend/services/upload/importSnapshot.dev.js backend/server.js
git commit -m "refactor(upload): extrai inserts p/ inserirDadosSped + rota dev de snapshot (move puro)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Teste import-snapshot (baseline sobre o código atual)

**Files:**
- Create: `backend/tests/import-snapshot.js`
- Create: `backend/tests/import-snapshot.manifest.json` — **vai pro git** (só `{counts, hash, dbWrites}`, sem dado fiscal). Serve de baseline versionada. Obs.: os fixtures `tests/golden/*.txt` são gitignorados; num checkout limpo sem eles a rota dev retorna 404 — o baseline só é reproduzível na máquina que tem os golden .txt (mesma limitação do golden-export).

**Interfaces:**
- Consumes: rota `POST /api/_dev/import-snapshot` (Task 1) → `{ counts, hash, dbWrites }`.

- [ ] **Step 1: Escrever o teste (baseline/check), modelado no golden-export.js**

Create `backend/tests/import-snapshot.js`:

```javascript
#!/usr/bin/env node
/**
 * Arnês de NÃO-REGRESSÃO do caminho de inserção do upload (Fase 3 #6).
 * Chama a rota dev /api/_dev/import-snapshot (parse+insert+snapshot+ROLLBACK) para
 * fixtures golden e compara o hash estrutural + counts. Prova que o batching NÃO
 * muda o conteúdo do banco, e mede a queda de round-trips (dbWrites).
 *
 * Uso (backend/, com servidor de pé e ENABLE_DEV_SNAPSHOT=1):
 *   node tests/import-snapshot.js baseline   # captura referência
 *   node tests/import-snapshot.js check       # compara: hash idêntico + dbWrites menor
 *
 * Fixtures: 1326 (APACHE — bicos/1320/LMC) e 1898 (mais recente).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 15435;
const HOST = process.env.SNAP_HOST || `http://localhost:${PORT}`;
const FIXTURES = (process.env.SNAP_FIXTURES || '1326.txt,1898.txt').split(',').map(s => s.trim()).filter(Boolean);
const MANIFEST = path.join(__dirname, 'import-snapshot.manifest.json');

function load() { return fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { fixtures: {} }; }

async function snap(fixture) {
    const res = await fetch(`${HOST}/api/_dev/import-snapshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

(async () => {
    const mode = (process.argv[2] || 'check').toLowerCase();
    if (!['baseline', 'check'].includes(mode)) { console.error('Use baseline | check'); process.exit(2); }
    const manifest = load();
    let fail = 0;
    for (const fx of FIXTURES) {
        let r;
        try { r = await snap(fx); }
        catch (e) { console.log(`  ${fx}  ERRO: ${e.message}`); fail++; continue; }
        if (mode === 'baseline') {
            manifest.fixtures[fx] = { hash: r.hash, counts: r.counts, dbWrites: r.dbWrites };
            console.log(`  ${fx}  baseline — hash ${r.hash.slice(0, 16)}… | dbWrites=${r.dbWrites} | c100=${r.counts.c100} c190=${r.counts.c190}`);
        } else {
            const ref = manifest.fixtures[fx];
            if (!ref) { console.log(`  ${fx}  (sem baseline — rode baseline primeiro)`); fail++; continue; }
            const hashOk = ref.hash === r.hash;
            const rtOk = r.dbWrites <= 40 && r.dbWrites < ref.dbWrites; // batching: milhares → dezenas
            if (hashOk && rtOk) console.log(`  ${fx}  ✓ idêntico | dbWrites ${ref.dbWrites} → ${r.dbWrites}`);
            else {
                console.log(`  ${fx}  ✗ ${!hashOk ? `HASH DIVERGE (${ref.hash.slice(0,12)} ≠ ${r.hash.slice(0,12)})` : ''} ${!rtOk ? `dbWrites=${r.dbWrites} (baseline ${ref.dbWrites}; exigido ≤40 e < baseline)` : ''}`);
                fail++;
            }
        }
    }
    if (mode === 'baseline') { fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n'); console.log(`[snapshot] manifest salvo: ${MANIFEST}`); }
    console.log(`[snapshot] ${fail} falha(s).`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
```

- [ ] **Step 2: Reiniciar o servidor com a flag dev e capturar baseline**

Run (a partir de `backend/`):
```bash
# reiniciar o servidor com a flag ligada:
#   ENABLE_DEV_SNAPSHOT=1 node server.js   (em outro terminal)
node tests/import-snapshot.js baseline
```
Expected: duas linhas `baseline — hash …`, com `dbWrites` na casa dos milhares (ex.: `dbWrites=8000+`) para 1326. Sem falhas.

- [ ] **Step 3: Rodar check imediatamente (deve bater com o baseline recém-salvo)**

Run:
```bash
node tests/import-snapshot.js check
```
Expected: **FALHA no critério de round-trips** (`dbWrites` ainda é milhares, não ≤40) — isto é esperado agora; o hash bate mas o `rtOk` falha porque o batching ainda não foi feito. Confirma que o teste realmente exige a redução. (O hash idêntico confirma o snapshot estável.)

> Nota TDD: este é o "teste que falha primeiro". O hash já casa (mesmo código), mas o gate de `dbWrites ≤ 40` só passa depois do batching (Task 3).

- [ ] **Step 4: Commit**

```bash
cd /Users/esmael/meus_sistemas/audisped
git add backend/tests/import-snapshot.js backend/tests/import-snapshot.manifest.json
git commit -m "test(upload): arnês import-snapshot (baseline pré-batching) — Fase 3 #6

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Batching UNNEST em inserirDadosSped

**Files:**
- Modify: `backend/services/upload/inserirDadosSped.js` (reescrever o corpo; assinatura e retorno `{dbWrites}` inalterados)
- Test: `backend/tests/import-snapshot.js check`, `backend/tests/golden-export.js check`, `npm run test:validador`

**Interfaces:**
- Consome/produz: mesma assinatura `inserirDadosSped(client, spedArquivoId, parsedData, logger) → {dbWrites}` da Task 1.

- [ ] **Step 1: Reescrever o corpo de `inserirDadosSped` com UNNEST em lote**

Substituir o corpo da função (mantendo o cabeçalho, a assinatura, o `const q = ...` contador e o `return { dbWrites }`) por batelas UNNEST. Pontos-chave: (1) ids do C100 **reservados em bloco** da sequence para linkar filhos de forma determinística; (2) filhos montados em arrays planas na **mesma ordem** (doc→item) → ids seriais idênticos ao baseline; (3) dedup intra-lote para reproduzir a semântica dos `ON CONFLICT` (participantes/1320 = primeiro vence; produtos = último vence); (4) pular batela vazia. Corpo novo:

```javascript
async function inserirDadosSped(client, spedArquivoId, parsedData, logger) {
    const { documents = [], participants = [], produtos = [], bicos = [], lmc } = parsedData;
    const blocoD = parsedData.blocoD || [];
    let dbWrites = 0;
    const q = (sql, params) => { dbWrites++; return client.query(sql, params); };

    // ---- LMC (achata o Map em linhas) ----
    const lmcRows = [];
    if (lmc && typeof lmc.entries === 'function') {
        for (const [codItem, dailyMovements] of lmc.entries())
            for (const d of dailyMovements.values())
                lmcRows.push([codItem, d.date, d.estqAbert, d.volEntr, d.volSaidas, d.valPerda, d.valGanho, d.estqEscr, d.fechFisico]);
    }
    if (lmcRows.length) {
        const col = (i) => lmcRows.map(r => r[i]);
        await q(
            `INSERT INTO lmc_movimentacao (id_sped_arquivo, cod_item, num_tanque, cap_tanque, data_mov, estq_abert, vol_entr, vol_saidas, val_perda, val_ganho, estq_escr, fech_fisico)
             SELECT $1::int, cod_item, '0', 0, data_mov, estq_abert, vol_entr, vol_saidas, val_perda, val_ganho, estq_escr, fech_fisico
             FROM unnest($2::text[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[])
               AS t(cod_item, data_mov, estq_abert, vol_entr, vol_saidas, val_perda, val_ganho, estq_escr, fech_fisico)`,
            [spedArquivoId, col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7), col(8)]
        );
    }
    logger && logger.info(`Passo 4: LMC (${lmcRows.length}) inserido em lote.`);

    // ---- 1320 (dedup keep-first pela chave do ON CONFLICT) ----
    if (bicos && bicos.length) {
        const seen = new Set(); const rows = [];
        for (const b of bicos) {
            const k = `${b.data_mov}|${b.cod_item}|${b.num_tanque}|${b.num_bico}`;
            if (seen.has(k)) continue; seen.add(k);
            rows.push([b.data_mov, b.cod_item, b.num_tanque, b.num_bico, b.enc_ini, b.enc_fin, b.qtd_af, b.vol_bico]);
        }
        if (rows.length) {
            const col = (i) => rows.map(r => r[i]);
            await q(
                `INSERT INTO sped_1320 (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico, enc_ini, enc_fin, qtd_af, vol_bico)
                 SELECT $1::int, data_mov, cod_item, num_tanque, num_bico, enc_ini, enc_fin, qtd_af, vol_bico
                 FROM unnest($2::date[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[])
                   AS t(data_mov, cod_item, num_tanque, num_bico, enc_ini, enc_fin, qtd_af, vol_bico)
                 ON CONFLICT (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico) DO NOTHING`,
                [spedArquivoId, col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7)]
            );
        }
        logger && logger.info(`Passo 4.1: 1320 (${rows.length}) inserido em lote.`);
    }

    // ---- D100 ----
    if (blocoD && blocoD.length) {
        const col = (f) => blocoD.map(d => d[f]);
        await q(
            `INSERT INTO documentos_d100 (id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, cfop, vl_doc, vl_icms)
             SELECT $1::int, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, cfop, vl_doc, vl_icms
             FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::date[], $7::text[], $8::numeric[], $9::numeric[])
               AS t(ind_oper, num_doc, cod_mod, cod_sit, dt_doc, cfop, vl_doc, vl_icms)`,
            [spedArquivoId, col('ind_oper'), col('num_doc'), col('cod_mod'), col('cod_sit'), col('dt_doc'), col('cfop'), col('vl_doc'), col('vl_icms')]
        );
        logger && logger.info(`Passo 4.5: D100 (${blocoD.length}) inserido em lote.`);
    }

    // ---- Participantes 0150 (dedup keep-first = ON CONFLICT DO NOTHING) ----
    {
        const seen = new Set(); const rows = [];
        for (const p of participants) { if (seen.has(p.cod_part)) continue; seen.add(p.cod_part); rows.push([p.cod_part, p.nome, p.cnpj]); }
        if (rows.length) {
            const col = (i) => rows.map(r => r[i]);
            await q(
                `INSERT INTO sped_participantes (id_sped_arquivo, cod_part, nome, cnpj)
                 SELECT $1::int, cod_part, nome, cnpj FROM unnest($2::text[], $3::text[], $4::text[]) AS t(cod_part, nome, cnpj)
                 ON CONFLICT (id_sped_arquivo, cod_part) DO NOTHING`,
                [spedArquivoId, col(0), col(1), col(2)]
            );
        }
    }
    logger && logger.info('Passo 5: participantes inseridos em lote.');

    // ---- Produtos 0200 (dedup keep-LAST = ON CONFLICT DO UPDATE SET ncm) ----
    {
        const byCod = new Map();
        for (const p of produtos) byCod.set(p.cod_item, [p.cod_item, p.descr_item, p.ncm || null]); // último vence
        const rows = [...byCod.values()];
        if (rows.length) {
            const col = (i) => rows.map(r => r[i]);
            await q(
                `INSERT INTO sped_produtos (id_sped_arquivo, cod_item, descr_item, ncm)
                 SELECT $1::int, cod_item, descr_item, ncm FROM unnest($2::text[], $3::text[], $4::text[]) AS t(cod_item, descr_item, ncm)
                 ON CONFLICT (id_sped_arquivo, cod_item) DO UPDATE SET ncm = EXCLUDED.ncm`,
                [spedArquivoId, col(0), col(1), col(2)]
            );
        }
    }
    logger && logger.info('Passo 5.5: produtos inseridos em lote.');

    // ---- C100 (ids reservados em bloco) + C170/C190 (arrays planas na mesma ordem) ----
    if (documents.length) {
        // reserva N ids da sequence, em ordem, numa query
        const idsRes = await q(
            `SELECT nextval('documentos_c100_id_seq')::int AS id FROM generate_series(1, $1)`, [documents.length]
        );
        const ids = idsRes.rows.map(r => r.id);

        const c = (arr, f) => arr.map(x => x[f]);
        await q(
            `INSERT INTO documentos_c100 (id, id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe)
             SELECT id, $2::int, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe
             FROM unnest($1::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::date[], $8::date[], $9::numeric[], $10::text[], $11::text[])
               AS t(id, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe)`,
            [ids, spedArquivoId, c(documents, 'ind_oper'), c(documents, 'num_doc'), c(documents, 'cod_mod'), c(documents, 'cod_sit'), c(documents, 'dt_doc'), c(documents, 'dt_e_s'), c(documents, 'vl_doc'), c(documents, 'cod_part'), c(documents, 'chv_nfe')]
        );

        // filhos: montar arrays planas na ordem doc→item (idêntica ao laço original)
        const t170 = []; const t190 = [];
        documents.forEach((doc, i) => {
            const pid = ids[i];
            for (const it of (doc.items || [])) t170.push([pid, it.num_item, it.cod_item, it.qtd, it.unid, it.vl_item, it.cst_icms, it.cfop, it.cst_pis, it.cst_cofins]);
            for (const an of (doc.analytical || [])) t190.push([pid, an.cst, an.cfop, an.aliq, an.vl_opr, an.vl_bc_icms, an.vl_icms]);
        });
        if (t170.length) {
            const col = (k) => t170.map(r => r[k]);
            await q(
                `INSERT INTO documentos_itens_c170 (id_documento_c100, num_item, cod_item, qtd, unid, vl_item, cst_icms, cfop, cst_pis, cst_cofins)
                 SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::numeric[], $5::text[], $6::numeric[], $7::text[], $8::text[], $9::text[], $10::text[])`,
                [col(0), col(1), col(2), col(3), col(4), col(5), col(6), col(7), col(8), col(9)]
            );
        }
        if (t190.length) {
            const col = (k) => t190.map(r => r[k]);
            await q(
                `INSERT INTO documentos_c190 (id_documento_c100, cst_icms, cfop, aliq_icms, vl_opr, vl_bc_icms, vl_icms)
                 SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])`,
                [col(0), col(1), col(2), col(3), col(4), col(5), col(6)]
            );
        }
        logger && logger.info(`Passo 6: C100 (${documents.length}) / C170 (${t170.length}) / C190 (${t190.length}) inseridos em lote.`);
    }

    return { dbWrites };
}
```

- [ ] **Step 2: Reiniciar o servidor e rodar o import-snapshot check**

Run (servidor reiniciado com `ENABLE_DEV_SNAPSHOT=1`):
```bash
node tests/import-snapshot.js check
```
Expected: `✓ idêntico | dbWrites <milhares> → <≤ ~10>` para 1326 e 1898. **0 falhas.** (hash idêntico ao baseline **e** round-trips despencaram).

- [ ] **Step 3: Rodar o golden-export check (export byte-idêntico)**

Run:
```bash
node tests/golden-export.js check
```
Expected: todos OK, 0 falhas.

- [ ] **Step 4: Rodar o validador**

Run:
```bash
npm run test:validador
```
Expected: 218/218, 0 falhas.

- [ ] **Step 5: Commit**

```bash
cd /Users/esmael/meus_sistemas/audisped
git add backend/services/upload/inserirDadosSped.js
git commit -m "perf(upload): batching UNNEST dos inserts (N+1 → lote) — Fase 3 #6

Round-trips do upload de milhares para dezenas. Conteúdo do banco byte-idêntico
(import-snapshot + golden-export + validador 218/218). worker_threads (#1) fica gateado.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Validação final (rodar após Task 3)

- [ ] `node tests/import-snapshot.js check` → hash idêntico + dbWrites ≤ 40 e menor que baseline (1326 e 1898).
- [ ] `node tests/golden-export.js check` → 7 fixtures byte-idênticos.
- [ ] `npm run test:validador` → 218/218.
- [ ] Upload manual de um SPED real pela tela → Analisador (Notas/entradas/saídas) visualmente inalterado.
- [ ] **NÃO** commitar além do escopo, **NÃO** pushar/deployar sem OK do Esmael.

## Notas de decisão

- **LMC entrou no batching** (além da lista original do spec) porque, sem ele, o resíduo de ~centenas de inserts por arquivo impediria de bater o critério "milhares → dezenas". Mesmo padrão UNNEST, coberto pelo golden-export (que lê `lmc_movimentacao` no fallback do 1300/1320).
- **Ids do C100 reservados em bloco** (`nextval … generate_series`) em vez de confiar na ordem do `RETURNING` — determinístico e mantém os ids seriais idênticos ao baseline (filhos montados na mesma ordem doc→item).
- **Dedup intra-lote** reproduz a semântica exata dos `ON CONFLICT` (participantes/1320 = primeiro vence; produtos = último vence) — sem isso o `DO UPDATE` erraria com chave repetida no mesmo statement.
- **Rota dev hard-gated** (`ENABLE_DEV_SNAPSHOT=1`, 404 em prod, whitelist de path) — necessária porque `parseSpedFile` é inline no server.js (chama `parseFloatSped`/`formatDate`/`transformarCtesEmSped`) e extraí-la seria invasivo demais neste corte.
- **worker_threads (#1) permanece fora/gateado** — decisão do Esmael 2026-07-26; só após load-test/medição de event-loop lag.
