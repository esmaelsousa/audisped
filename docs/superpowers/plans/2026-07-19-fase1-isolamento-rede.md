# Fase 1 — Isolamento Multi-inquilino por Rede — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o backend escopar TODO acesso a dados por `rede`, de forma que um usuário `admin`/`escritorio` de uma rede nunca leia nem altere dados de outra rede (fim do IDOR entre inquilinos), sem alterar o comportamento do time interno (`super_admin`/`staff`) nem o SPED exportado.

**Architecture:** Enforcement por **middleware `scopeRede`** (recomendação do painel de especialistas, 2026-07-19): um porteiro roda depois de `authMiddleware`+`enrich` e antes do handler; resolve a rede DONA do recurso subindo a cadeia `recurso → empresa → rede_id` e responde 403 se não for a rede do ator. `super_admin`/`staff` (cross-tenant) e o token de serviço (`sys@local`) passam por bypass explícito. A garantia contra "esqueci uma rota" é um **teste de cobertura default-deny** que reprova qualquer rota de dados sem `scopeRede`. RLS foi descartado nesta fase (o substrato de conexão do monolito — 34 `pool.query`, ~1 `SET LOCAL` — faria a variável de tenant vazar entre requisições).

**Tech Stack:** Node/Express (backend/server.js, monolito), Postgres (`pg` Pool), testes como scripts `node` puros com `assert` (padrão em `backend/tests/*.test.js`).

## Global Constraints

- **Fluxo localhost-first:** implementar e TESTAR em localhost; **nada vai para git ou produção sem autorização explícita do Esmael.** Ver `[[fluxo-localhost-antes-git-prod]]`.
- **Backend local:** roda `node server.js` puro na porta 15435 (sem nodemon) → **reiniciar manualmente** após cada mudança no backend, senão testa código velho.
- **Não-regressão fiscal:** o SPED exportado deve ser **byte-idêntico** antes/depois. `scopeRede` roda ANTES do corpo da rota e NÃO altera nenhuma query do export — garantir que continue assim.
- **`regras_fiscais` é GLOBAL** (`id_empresa` NULL) e alimenta o export → **NUNCA** escopar por rede.
- **Bypass obrigatório:** `ROLES_CROSS_TENANT = ['super_admin','staff']` (todos internos hoje) e o token de serviço `email === 'sys@local'` (usado por `revalidar`/`relatorio`, server.js:6805/6907) passam sem escopo.
- **`empresas` não tem DDL no código** (vem do dump de produção) → migração usa `ALTER TABLE`, nunca `CREATE`.
- Rodar a suíte existente do validador a cada tarefa (`node backend/tests/validador-suite.js`) para garantir zero regressão.

---

## Estrutura de arquivos

- **Criar** `backend/migrations/2026-07-19-fase1-empresas-rede.js` — ALTER `empresas.rede_id` + backfill + índice.
- **Criar** `backend/scopeRede.js` — middleware `scopeRede(pool, tipo)` + `redeDoRecurso(pool, tipo, req)` + `ehBypass(ator, user)`.
- **Criar** `backend/routeScopeRegistry.js` — registro explícito: para cada rota de dados, qual variante de escopo aplicar; e a allowlist pública. Fonte única de verdade da cobertura.
- **Modificar** `backend/server.js` — montar `enrich` global nas rotas de dados; aplicar `scopeRede(...)` conforme o registro; list-scoping em `/api/empresas` e `/api/arquivos`; re-chavear a dedup (894-915) por `id_empresa`+rede.
- **Criar** testes: `backend/tests/scoperede-unit.test.js`, `backend/tests/scoperede-cobertura.test.js`, `backend/tests/scoperede-integracao.test.js`.

---

## Task 1: Migração — `empresas.rede_id` + backfill

**Files:**
- Create: `backend/migrations/2026-07-19-fase1-empresas-rede.js`
- Test: `backend/tests/migracao-empresas-rede.test.js`

**Interfaces:**
- Produces: `up(client)` — função async idempotente; após rodar, toda linha de `empresas` tem `rede_id` não-nulo apontando para a rede `default`, e existe índice `idx_empresas_rede`.

- [ ] **Step 1: Escrever o teste da migração (falha primeiro)**

```js
// backend/tests/migracao-empresas-rede.test.js
//   node backend/tests/migracao-empresas-rede.test.js   (precisa DB local)
const assert = require('assert');
const { Pool } = require('pg');
const { up } = require('../migrations/2026-07-19-fase1-empresas-rede');

(async () => {
  const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
  const c = await pool.connect();
  try {
    await up(c);
    await up(c); // idempotente: rodar 2x não quebra
    const col = await c.query(`SELECT 1 FROM information_schema.columns
      WHERE table_name='empresas' AND column_name='rede_id'`);
    assert.equal(col.rowCount, 1, 'empresas.rede_id deve existir');
    const nulos = await c.query(`SELECT count(*)::int n FROM empresas WHERE rede_id IS NULL`);
    assert.equal(nulos.rows[0].n, 0, 'nenhuma empresa pode ficar com rede_id NULL');
    const idx = await c.query(`SELECT 1 FROM pg_indexes WHERE indexname='idx_empresas_rede'`);
    assert.equal(idx.rowCount, 1, 'índice idx_empresas_rede deve existir');
    console.log('migracao-empresas-rede: OK');
  } finally { c.release(); await pool.end(); }
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node backend/tests/migracao-empresas-rede.test.js`
Expected: FAIL — `Cannot find module '../migrations/2026-07-19-fase1-empresas-rede'`

- [ ] **Step 3: Escrever a migração**

```js
// backend/migrations/2026-07-19-fase1-empresas-rede.js
// Fase 1 — adiciona empresas.rede_id e faz backfill para a rede 'default'.
// Idempotente. empresas vem do dump de produção → usamos ALTER, nunca CREATE.
async function up(client) {
  // 1) coluna nullable + FK (nullable primeiro; NOT NULL só depois do backfill validado)
  await client.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS rede_id INTEGER REFERENCES redes(id)`);
  // 2) garante a rede 'default' (mesma da migração de usuários)
  await client.query(`INSERT INTO redes (nome, status, modulos_contratados)
    SELECT 'default','ativa','[]'::jsonb WHERE NOT EXISTS (SELECT 1 FROM redes WHERE nome='default')`);
  // 3) backfill: toda empresa sem rede → default (time interno = 1 tenant)
  await client.query(`UPDATE empresas SET rede_id = (SELECT id FROM redes WHERE nome='default' LIMIT 1)
    WHERE rede_id IS NULL`);
  // 4) índice para o lookup do scopeRede
  await client.query(`CREATE INDEX IF NOT EXISTS idx_empresas_rede ON empresas(rede_id)`);
}
module.exports = { up };
if (require.main === module) {
  const { Pool } = require('pg');
  const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
  (async () => { const c = await pool.connect();
    try { await up(c); console.log('OK: empresas.rede_id + backfill'); }
    catch (e) { console.error('FALHA:', e.message); process.exitCode = 1; }
    finally { c.release(); await pool.end(); } })();
}
```

> **NÃO** aplicar `NOT NULL` ainda: só depois de validar num dump de produção que zero empresas ficam NULL (feito em produção sob autorização; em localhost o backfill já cobre 100%).

- [ ] **Step 4: Rodar a migração no banco local + o teste**

Run: `node backend/migrations/2026-07-19-fase1-empresas-rede.js && node backend/tests/migracao-empresas-rede.test.js`
Expected: `OK: empresas.rede_id + backfill` e depois `migracao-empresas-rede: OK`

- [ ] **Step 5: NÃO commitar ainda** — avisar Esmael e aguardar autorização (regra localhost-first). Quando autorizado: `git add backend/migrations/2026-07-19-fase1-empresas-rede.js backend/tests/migracao-empresas-rede.test.js && git commit -m "feat(fase1): empresas.rede_id + backfill (isolamento)"`

---

## Task 2: Middleware `scopeRede` + resolver (funções puras testáveis)

**Files:**
- Create: `backend/scopeRede.js`
- Test: `backend/tests/scoperede-unit.test.js`

**Interfaces:**
- Consumes: `pool` (pg Pool), `req.ator` (`{ role, rede_id }` do `enrich`), `req.user` (`{ id, email }` do JWT).
- Produces:
  - `ehBypass(ator, user) → boolean` — true se `super_admin`/`staff` ou token de serviço (`user.email === 'sys@local'`).
  - `redeDoRecurso(pool, tipo, req) → Promise<number|null|undefined>` — rede dona; `null` = recurso não existe; `undefined` = tipo sem id resolvível.
  - `scopeRede(pool, tipo) → middleware` — 403/404 ou `next()`.

- [ ] **Step 1: Escrever os testes unitários (falham primeiro)**

```js
// backend/tests/scoperede-unit.test.js
//   node backend/tests/scoperede-unit.test.js
const assert = require('assert');
const { ehBypass, redeDoRecurso, scopeRede } = require('../scopeRede');

let pass=0, fail=0; const fails=[];
const t=(n,fn)=>{try{fn();pass++;}catch(e){fail++;fails.push(`${n} → ${e.message}`);}};
const ta=async(n,fn)=>{try{await fn();pass++;}catch(e){fail++;fails.push(`${n} → ${e.message}`);}};

// pool falso: devolve rede conforme o SQL
const fakePool = (redePorId) => ({ query: async (_sql, params) => {
  const id = params[0]; const r = redePorId[id];
  return { rows: r === undefined ? [] : [{ rede_id: r }] };
}});

t('ehBypass: super_admin e staff passam', () => {
  assert.equal(ehBypass({role:'super_admin'}, {}), true);
  assert.equal(ehBypass({role:'staff'}, {}), true);
  assert.equal(ehBypass({role:'admin'}, {email:'a@b.com'}), false);
  assert.equal(ehBypass({role:'escritorio'}, {email:'a@b.com'}), false);
});
t('ehBypass: token de serviço (sys@local) passa', () => {
  assert.equal(ehBypass({role:'admin'}, {email:'sys@local'}), true);
});

(async () => {
  await ta('redeDoRecurso sped: sobe cadeia e devolve rede', async () => {
    const rede = await redeDoRecurso(fakePool({42: 7}), 'sped', {params:{id:'42'}});
    assert.equal(rede, 7);
  });
  await ta('redeDoRecurso sped inexistente → null', async () => {
    const rede = await redeDoRecurso(fakePool({}), 'sped', {params:{id:'999'}});
    assert.equal(rede, null);
  });
  await ta('scopeRede: ator de outra rede → 403', async () => {
    const mw = scopeRede(fakePool({42:7}), 'sped');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:3}, user:{email:'a@b'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(code, 403); assert.equal(called, false);
  });
  await ta('scopeRede: ator da mesma rede → next()', async () => {
    const mw = scopeRede(fakePool({42:7}), 'sped');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:7}, user:{email:'a@b'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(called, true); assert.equal(code, null);
  });
  await ta('scopeRede: super_admin → bypass (next sem query)', async () => {
    const mw = scopeRede(fakePool({}), 'sped');
    let called=false; const res={status(){return this;},json(){return this;}};
    await mw({ator:{role:'super_admin',rede_id:null}, user:{email:'x'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(called, true);
  });
  await ta('scopeRede: recurso inexistente → 404', async () => {
    const mw = scopeRede(fakePool({}), 'sped');
    let code=null; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:7}, user:{email:'a@b'}, params:{id:'999'}}, res, ()=>{});
    assert.equal(code, 404);
  });
  console.log(`\nscoperede-unit: ${pass} passaram, ${fail} falharam`);
  if (fail) { fails.forEach(f=>console.log('  ✗ '+f)); process.exit(1); }
})();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node backend/tests/scoperede-unit.test.js`
Expected: FAIL — `Cannot find module '../scopeRede'`

- [ ] **Step 3: Implementar `backend/scopeRede.js`**

```js
// backend/scopeRede.js — isolamento por rede (Fase 1). Ver plano 2026-07-19.
const { ROLES_CROSS_TENANT } = require('./authz');
const EMAIL_SERVICO = 'sys@local'; // token interno de revalidar/relatorio (server.js:6805/6907)

function ehBypass(ator, user) {
  if (ator && ROLES_CROSS_TENANT.includes(ator.role)) return true;   // super_admin/staff
  if (user && user.email === EMAIL_SERVICO) return true;             // token de serviço
  return false;
}

// Resolve a rede DONA do recurso pedido. null = não existe; undefined = tipo sem id.
async function redeDoRecurso(pool, tipo, req) {
  const p = req.params || {};
  if (tipo === 'empresa') {
    const id = p.id_empresa ?? p.id;
    if (id == null) return undefined;
    const r = await pool.query('SELECT rede_id FROM empresas WHERE id = $1', [id]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  if (tipo === 'sped') { // :id_sped/:id_arquivo/:id → arquivo → empresa → rede
    const id = p.id_sped ?? p.id_arquivo ?? p.id;
    if (id == null) return undefined;
    const r = await pool.query(
      `SELECT e.rede_id FROM sped_arquivos s JOIN empresas e ON e.id = s.id_empresa WHERE s.id = $1`, [id]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  throw new Error(`scopeRede: tipo desconhecido '${tipo}'`);
}

function scopeRede(pool, tipo) {
  return async (req, res, next) => {
    try {
      if (ehBypass(req.ator, req.user)) return next();
      if (!req.ator || req.ator.rede_id == null)
        return res.status(403).json({ erro: 'Sessão sem rede definida.' });
      const redeDona = await redeDoRecurso(pool, tipo, req);
      if (redeDona === undefined) return res.status(400).json({ erro: 'Recurso não identificado.' });
      if (redeDona === null) return res.status(404).json({ erro: 'Recurso não encontrado.' });
      if (redeDona !== req.ator.rede_id) return res.status(403).json({ erro: 'Sem acesso a este recurso.' });
      return next();
    } catch (e) { return res.status(500).json({ erro: 'Falha na verificação de acesso.' }); }
  };
}

module.exports = { ehBypass, redeDoRecurso, scopeRede, EMAIL_SERVICO };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node backend/tests/scoperede-unit.test.js`
Expected: `scoperede-unit: 8 passaram, 0 falharam`

- [ ] **Step 5: Commit (após autorização)** — `git commit -m "feat(fase1): middleware scopeRede + resolver (unit-tested)"`

---

## Task 3: Registro de rotas + `enrich` global (fonte de verdade da cobertura)

**Files:**
- Create: `backend/routeScopeRegistry.js`
- Modify: `backend/server.js` (montar `enrich` antes das rotas de dados)

**Interfaces:**
- Produces:
  - `PUBLICAS` — Set de `'METHOD /path'` das 8 rotas públicas (allowlist default-deny).
  - `ESCOPO` — mapa `'METHOD /path' → 'empresa'|'sped'|'chave'|'cnpj'|'lista'|'global'` para cada rota de dados. `'global'` = rota sem dado de tenant (ex.: tabelas de referência ncm/cest, motor de regras global).

- [ ] **Step 1: Extrair o inventário real de rotas**

Run:
```bash
cd backend && node -e "const s=require('fs').readFileSync('server.js','utf8');
const re=/app\.(get|post|put|patch|delete)\('([^']+)'/g; let m,out=[];
while((m=re.exec(s))) out.push(m[1].toUpperCase()+' '+m[2]);
require('fs').writeFileSync('/tmp/rotas.txt', out.join('\n')); console.log(out.length+' rotas -> /tmp/rotas.txt')"
```
Expected: `133 rotas -> /tmp/rotas.txt`

- [ ] **Step 2: Escrever `backend/routeScopeRegistry.js` classificando CADA rota**

Classificar consultando `/tmp/rotas.txt` e o corpo de cada rota no `server.js`. Regras de classificação:
- Rota em `PUBLICAS` (8): `POST /api/auth/register|login|forgot-password|reset-password`, `POST /api/demo-lead`, `GET /api/logs/stream`, `GET /favicon.ico`, `GET /api/empresas` (vira `'lista'`, ver Task 5).
- Param `:id_empresa` (ou `:id` que é empresa) → `'empresa'`.
- Param `:id_sped`/`:id_arquivo`/`:id` que referencia arquivo → `'sped'`.
- Param `:cnpj` → `'cnpj'` (Task 7).
- Param `:chave` → `'chave'` (Task 7).
- Rotas de referência/global sem tenant (ex.: `GET /api/ncm`, motor de regras global) → `'global'` (documentar por que cada uma é global).

```js
// backend/routeScopeRegistry.js — fonte única da cobertura de isolamento (Fase 1).
// Toda rota de dados TEM que estar aqui; o teste de cobertura reprova qualquer omissão.
const PUBLICAS = new Set([
  'POST /api/auth/register', 'POST /api/auth/login',
  'POST /api/auth/forgot-password', 'POST /api/auth/reset-password',
  'POST /api/demo-lead', 'GET /api/logs/stream', 'GET /favicon.ico',
]);
// Preencher TODAS as demais rotas de dados aqui (exemplos reais confirmados):
const ESCOPO = {
  'GET /api/empresas': 'lista',
  'GET /api/exportar-sped/:id': 'sped',
  'GET /api/lmc/:id_sped': 'sped',
  'POST /api/analisar/:id': 'sped',
  'GET /api/resumo/:id_arquivo': 'sped',
  'POST /api/validador/analisar/:id': 'sped',
  // ... (classificar as ~120 restantes de /tmp/rotas.txt) ...
};
module.exports = { PUBLICAS, ESCOPO };
```

> Este passo é trabalho de classificação linha a linha (não gerar automático às cegas). Cada rota `'global'` exige uma justificativa em comentário (por que não tem dado de tenant).

- [ ] **Step 3: Montar `enrich` global nas rotas de dados no `server.js`**

Localizar onde os middlewares globais são aplicados (após `const enrich = authz.enrich(pool)`, server.js:154) e montar `enrich` para todas as rotas `/api/*` exceto as públicas:

```js
// server.js — logo após a definição de enrich (linha ~155)
// Popula req.ator (role/rede do banco) em TODA rota de dados. Públicas não precisam.
const { PUBLICAS } = require('./routeScopeRegistry');
app.use('/api', (req, res, next) => {
  const chave = `${req.method} ${req.baseUrl || ''}${req.path}`;
  if (PUBLICAS.has(`${req.method} /api${req.path}`)) return next();
  return enrich(req, res, next);
});
```
> Ajustar o casamento de path ao roteamento real (Express normaliza `req.path`). Validar que `req.ator` fica definido numa rota de dados e ausente numa pública.

- [ ] **Step 4: Teste rápido de fumaça do enrich global**

Run (com backend reiniciado): logar como super_admin, `GET /api/empresas` → 200; sem token → 401.
Expected: rotas de dados exigem token; `req.ator` presente (verificar via log temporário).

- [ ] **Step 5: Commit (após autorização)** — `git commit -m "feat(fase1): registro de rotas + enrich global"`

---

## Task 4: Teste de cobertura default-deny (a garantia)

**Files:**
- Create: `backend/tests/scoperede-cobertura.test.js`

**Interfaces:**
- Consumes: `PUBLICAS`, `ESCOPO` do registro; a lista real de rotas do `server.js`.

- [ ] **Step 1: Escrever o teste de cobertura**

```js
// backend/tests/scoperede-cobertura.test.js
//   node backend/tests/scoperede-cobertura.test.js
const assert = require('assert');
const fs = require('fs');
const { PUBLICAS, ESCOPO } = require('../routeScopeRegistry');

const src = fs.readFileSync(__dirname + '/../server.js', 'utf8');
const re = /app\.(get|post|put|patch|delete)\('([^']+)'/g;
const rotas = []; let m;
while ((m = re.exec(src))) rotas.push(`${m[1].toUpperCase()} ${m[2]}`);

const semClassificacao = rotas.filter(r =>
  r.split(' ')[1].startsWith('/api/') && !PUBLICAS.has(r) && !(r in ESCOPO));

if (semClassificacao.length) {
  console.error('ROTAS DE DADOS SEM scopeRede (classifique no registro ou marque pública):');
  semClassificacao.forEach(r => console.error('  ✗ ' + r));
  process.exit(1);
}
console.log(`scoperede-cobertura: OK — ${rotas.length} rotas, todas classificadas`);
```

- [ ] **Step 2: Rodar — vai FALHAR listando as rotas ainda não classificadas**

Run: `node backend/tests/scoperede-cobertura.test.js`
Expected: FAIL listando as rotas `/api/*` que faltam no `ESCOPO`. **Esta lista é o roteiro do Step 3.**

- [ ] **Step 3: Completar o `ESCOPO` até o teste passar**

Classificar cada rota apontada, editando `backend/routeScopeRegistry.js`. Repetir Step 2↔3 até verde.

- [ ] **Step 4: Verde**

Run: `node backend/tests/scoperede-cobertura.test.js`
Expected: `scoperede-cobertura: OK — 133 rotas, todas classificadas`

- [ ] **Step 5: Commit (após autorização)** — `git commit -m "test(fase1): cobertura default-deny de isolamento"`

---

## Task 5: Aplicar `scopeRede` nas rotas + list-scoping

**Files:**
- Modify: `backend/server.js` (adicionar `scopeRede(pool, tipo)` na cadeia de cada rota conforme `ESCOPO`; filtrar listas por rede)

**Interfaces:**
- Consumes: `scopeRede` (Task 2), `ESCOPO` (Task 3).

- [ ] **Step 1: Aplicar `scopeRede` nas rotas `'empresa'` e `'sped'`**

Para cada rota com variante `'empresa'`/`'sped'` no registro, inserir o middleware na cadeia:
```js
// antes:
app.get('/api/exportar-sped/:id', authMiddleware, async (req,res) => { ... });
// depois:
app.get('/api/exportar-sped/:id', authMiddleware, scopeRede(pool,'sped'), async (req,res) => { ... });
```
(`enrich` já roda global via Task 3; `scopeRede` usa `req.ator`.)

- [ ] **Step 2: List-scoping em `/api/empresas`**

`GET /api/empresas` (server.js:~3378, hoje `SELECT * FROM empresas` sem filtro) passa a filtrar por rede — exceto bypass:
```js
app.get('/api/empresas', authMiddleware, async (req, res) => {
  const dbClient = await safeConnect(res); if (!dbClient) return;
  try {
    const { ehBypass } = require('./scopeRede');
    const bypass = ehBypass(req.ator, req.user);
    let query = 'SELECT * FROM empresas'; const params = [];
    const cond = [];
    if (!bypass) { params.push(req.ator.rede_id); cond.push(`rede_id = $${params.length}`); }
    if (req.query.busca) { params.push(`%${req.query.busca}%`);
      cond.push(`(nome_empresa ILIKE $${params.length} OR nome_fantasia ILIKE $${params.length} OR cnpj ILIKE $${params.length})`); }
    if (cond.length) query += ' WHERE ' + cond.join(' AND ');
    query += ' ORDER BY nome_empresa ASC';
    const { rows } = await dbClient.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).send('Erro ao carregar empresas.'); }
  finally { dbClient.release(); }
});
```
Aplicar o mesmo padrão de list-scoping em `/api/arquivos` (join a `empresas` por `id_empresa`, filtrar por `rede_id`).

- [ ] **Step 3: Reiniciar o backend e rodar cobertura + validador**

Run: reiniciar `node server.js`; `node backend/tests/scoperede-cobertura.test.js && node backend/tests/validador-suite.js`
Expected: cobertura OK e validador sem regressão.

- [ ] **Step 4: Commit (após autorização)** — `git commit -m "feat(fase1): aplica scopeRede nas rotas + list-scoping"`

---

## Task 6: Fechar o write-path IDOR (dedup por `id_empresa`)

**Files:**
- Modify: `backend/server.js:894-915` (upload/dedup de `sped_arquivos`)

**Interfaces:** nenhuma nova; corrige a chave de dedup.

- [ ] **Step 1: Escrever o teste de integração do write-path**

```js
// dentro de backend/tests/scoperede-integracao.test.js (Task 8) — cenário:
// Rede A tem arquivo (CNPJ X, período P). Rede B sobe o MESMO CNPJ/período.
// ESPERADO: o upload da Rede B NÃO apaga o arquivo da Rede A (dedup escopado por empresa/rede).
```

- [ ] **Step 2: Re-chavear a dedup**

Hoje (server.js:894): `SELECT id FROM sped_arquivos WHERE cnpj_empresa = $1 AND periodo_apuracao = $2` e depois DELETE. O `cnpj_empresa` é TEXT e não distingue rede. Trocar a chave para incluir a empresa/rede do upload:
```js
// a empresa do upload já é resolvida no fluxo (idEmpresa). Dedup passa a ser por id_empresa:
const checkQuery = 'SELECT id FROM sped_arquivos WHERE id_empresa = $1 AND periodo_apuracao = $2';
// ... usar idEmpresa no lugar de cnpj_empresa na checagem e no DELETE subsequente.
```
> A resolução de `idEmpresa` do upload deve respeitar a rede do ator (empresa criada/vinculada na rede correta). Garantir que o `INSERT` (915) grave `id_empresa` da rede do ator.

- [ ] **Step 3: Rodar o teste de write-path**

Run: `node backend/tests/scoperede-integracao.test.js`
Expected: o upload da Rede B não afeta o arquivo da Rede A.

- [ ] **Step 4: Commit (após autorização)** — `git commit -m "fix(fase1): dedup de sped_arquivos por id_empresa (write-path IDOR)"`

---

## Task 7: Resolvers `:chave` / `:cnpj` + colunas de tenant nas tabelas cnpj-keyed

**Files:**
- Modify: `backend/scopeRede.js` (adicionar variantes `'chave'` e `'cnpj'`)
- Create: `backend/migrations/2026-07-19-fase1-cnpj-keyed-rede.js` (rede_id/id_empresa em `lmc_tanques_config`, `lmc_lacres`, `cad_credenciadoras`, `cad_apuracao_e116`, `encerrantes_exportados`; `UNIQUE(rede_id, cnpj)` em `cad_credenciadoras`)

**Interfaces:**
- Produces: `redeDoRecurso` cobre `'chave'` (chave NFe → arquivo → empresa → rede) e `'cnpj'` (cnpj → empresa da rede).

- [ ] **Step 1: Teste unitário das variantes `chave`/`cnpj`** (mesmo estilo do Task 2, com fakePool que resolve chave→rede e cnpj→rede). Ver falhar.

- [ ] **Step 2: Migração das tabelas cnpj-keyed**

```js
// backend/migrations/2026-07-19-fase1-cnpj-keyed-rede.js
async function up(client) {
  for (const t of ['lmc_tanques_config','lmc_lacres','cad_credenciadoras','cad_apuracao_e116','encerrantes_exportados'])
    await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS rede_id INTEGER REFERENCES redes(id)`);
  // backfill: rede da empresa dona (via cnpj → empresas.rede_id)
  await client.query(`UPDATE cad_credenciadoras c SET rede_id = e.rede_id
    FROM empresas e WHERE e.cnpj = c.cnpj AND c.rede_id IS NULL`);
  // CNPJ de credenciadora repete legitimamente entre redes → UNIQUE por rede
  await client.query(`ALTER TABLE cad_credenciadoras DROP CONSTRAINT IF EXISTS cad_credenciadoras_cnpj_key`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_credenciadoras_rede_cnpj
    ON cad_credenciadoras(rede_id, cnpj)`);
}
module.exports = { up };
```
> ⚠️ `cad_credenciadoras`/`cad_apuracao_e116` são ESCRITAS no fluxo de export/injeção (§13.7) → o escopo dessas rotas não pode travar escrita de sistema; usar bypass de serviço quando aplicável.

- [ ] **Step 3: Implementar as variantes no `redeDoRecurso`** (chave→arquivo→empresa→rede via lookup da chave; cnpj→empresas.rede_id da rede do ator). Rodar unit → verde.

- [ ] **Step 4: Aplicar `scopeRede(pool,'chave'|'cnpj')` nas rotas correspondentes** (nfe-completa/:chave server.js:4925, conciliacao/itens-nf/:chave 6321, rotas :cnpj 5674/5805).

- [ ] **Step 5: Commit (após autorização)** — `git commit -m "feat(fase1): resolvers chave/cnpj + tenant nas tabelas cnpj-keyed"`

---

## Task 8: Suíte adversarial + não-regressão do export

**Files:**
- Create: `backend/tests/scoperede-integracao.test.js`

**Interfaces:** usa o servidor real (subir instância de teste) + 2 usuários (`admin` Rede A, `admin` Rede B) + dados semeados.

- [ ] **Step 1: Semear 2 redes com 1 empresa/arquivo cada** (via SQL de setup do teste).

- [ ] **Step 2: Teste "Rede A → recurso Rede B = 403" para TODAS as variantes**

```js
// para cada rota :param, com token da Rede A pedindo recurso da Rede B → 403;
// pedindo o próprio recurso → 200. Inclui :id_empresa, :id_sped, :chave, :cnpj.
```

- [ ] **Step 3: Teste de write-path (Task 6)** — Rede B não apaga arquivo da Rede A.

- [ ] **Step 4: Não-regressão do export byte-idêntico**

```js
// exportar o MESMO arquivo antes e depois do scopeRede ligado (como super_admin/bypass)
// e comparar byte-a-byte. Deve ser idêntico (o guard roda antes do corpo, não toca queries).
```

- [ ] **Step 5: Rodar tudo verde + suíte do validador**

Run: `node backend/tests/scoperede-unit.test.js && node backend/tests/scoperede-cobertura.test.js && node backend/tests/scoperede-integracao.test.js && node backend/tests/validador-suite.js`
Expected: tudo verde.

- [ ] **Step 6: Commit (após autorização)** — `git commit -m "test(fase1): suíte adversarial de isolamento + nao-regressao export"`

---

## Critérios de aceite (antes de expor multi-tenant — §13.9 do plano-mãe)

1. `admin` Rede A → recurso Rede B → **403** em TODAS as rotas `:param` (incl. `:chave`, `:cnpj`).
2. `super_admin`/`staff` (time interno) continuam vendo tudo (bypass) — zero mudança operacional.
3. `revalidar`/`relatorio` (token `sys@local`) continuam funcionando (bypass de serviço).
4. Rede B **não** apaga a escrituração da Rede A ao subir o mesmo CNPJ/período (write-path).
5. **Export byte-idêntico** antes/depois (não-regressão fiscal) — golden test verde.
6. Teste de cobertura verde (100% das rotas de dados com `scopeRede` ou na allowlist).
7. Zero empresa com `rede_id` NULL (validado em dump antes de qualquer `NOT NULL`).

## Fora de escopo (fases seguintes)

- `requireActiveAccount` + máquina de estados (ativa/suspensa/cancelada) → Fase 1b.
- Console Super Admin (CRUD redes/CNPJs/faturas) → Fase 2.
- Distribuição de módulos → Fase 3. Portal Financeiro → Fase 4. Asaas → Fase 5.
- RLS como 2ª camada (belt-and-suspenders) → depois de unificar a camada de acesso a dados.
