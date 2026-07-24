// Integração dos endpoints do Console de Redes (Fase 2) — sobe o server real numa porta de teste,
// forja tokens com o JWT_SECRET (enrich re-busca role/rede do banco por id) e valida:
//   - CRUD de redes (criar/listar-com-contador/editar/DELETE bloqueado 409/DELETE ok),
//   - associar posto (1) e em lote, rede inexistente → 400, e não-super → 403 em TODOS.
// Semeia e limpa seus próprios dados (redes IT_REDE_%, empresas por CNPJ marcado, usuários it_%).
//   cd backend && node -r dotenv/config tests/redes-endpoints.test.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const assert = require('assert');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const JWT_SECRET = process.env.JWT_SECRET || 'audisped-safira-token-secret-2025';
const PORT = 15998;
const BASE = `http://127.0.0.1:${PORT}`;
const SUF = `it_${process.pid}`;
const CNPJ_PREFIX = '99999'; // marca dos CNPJs de teste (13 dígitos após = 14 no total)
const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

const tok = (id) => jwt.sign({ id, nome: 'IT', email: `${id}@it` }, JWT_SECRET, { expiresIn: '1h' });
const api = (method, path, token, body) => fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
});

async function limpar(client) {
    await client.query(`DELETE FROM empresas WHERE cnpj LIKE '${CNPJ_PREFIX}%'`);
    await client.query(`DELETE FROM usuarios WHERE email LIKE 'it\\_%@test.local'`);
    await client.query(`DELETE FROM redes WHERE nome LIKE 'IT\\_REDE\\_%'`);
}

async function esperarServidor(ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(`${BASE}/api/empresas`); if (r.status) return true; } catch (_) {}
        await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('servidor não subiu a tempo');
}

(async () => {
    const client = await pool.connect();
    let pass = 0, fail = 0; const fails = [];
    const t = async (nome, fn) => { try { await fn(); pass++; console.log(`  ✓ ${nome}`); } catch (e) { fail++; fails.push(`${nome} → ${e.message}`); console.log(`  ✗ ${nome}`); } };

    // seed
    await limpar(client);
    const redeA = (await client.query(`INSERT INTO redes (nome, status, modulos_contratados) VALUES ('IT_REDE_A','ativa','[]'::jsonb) RETURNING id`)).rows[0].id;
    const redeB = (await client.query(`INSERT INTO redes (nome, status, modulos_contratados) VALUES ('IT_REDE_B','ativa','[]'::jsonb) RETURNING id`)).rows[0].id;
    const senha = await bcrypt.hash('x', 4);
    const mk = async (email, role, rede) => (await client.query(
        `INSERT INTO usuarios (nome,email,senha,role,rede_id,ativo) VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
        ['IT', email, senha, role, rede])).rows[0].id;
    const idSuper = await mk(`${SUF}_super@test.local`, 'super_admin', null);
    const idStaff = await mk(`${SUF}_staff@test.local`, 'staff', null);
    const idAdminA = await mk(`${SUF}_adminA@test.local`, 'admin', redeA);
    // empresas de teste na redeA (para os testes de mover)
    const mkEmp = async (cnpj, rede) => (await client.query(
        `INSERT INTO empresas (cnpj, nome_empresa, rede_id) VALUES ($1,$2,$3) RETURNING id`,
        [cnpj, 'IT EMP', rede])).rows[0].id;
    const emp1 = await mkEmp(`${CNPJ_PREFIX}000000001`, redeA);
    const emp2 = await mkEmp(`${CNPJ_PREFIX}000000002`, redeA);
    const emp3 = await mkEmp(`${CNPJ_PREFIX}000000003`, redeA);

    const child = spawn('node', ['server.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) } });
    let serverErr = '';
    child.stderr.on('data', (d) => { serverErr += d.toString(); });
    child.stdout.on('data', () => {});

    let redeCriadaId = null;
    try {
        await esperarServidor();

        // ---------- não-super → 403 em TODOS os endpoints do Console ----------
        await t('staff GET /api/admin/redes → 403', async () => {
            assert.equal((await api('GET', '/api/admin/redes', tok(idStaff))).status, 403);
        });
        await t('admin GET /api/admin/redes → 403', async () => {
            assert.equal((await api('GET', '/api/admin/redes', tok(idAdminA))).status, 403);
        });
        await t('staff POST /api/admin/redes → 403', async () => {
            assert.equal((await api('POST', '/api/admin/redes', tok(idStaff), { nome: 'IT_REDE_X' })).status, 403);
        });
        await t('admin POST /api/admin/redes → 403', async () => {
            assert.equal((await api('POST', '/api/admin/redes', tok(idAdminA), { nome: 'IT_REDE_X' })).status, 403);
        });
        await t('staff PUT /api/admin/redes/:id → 403', async () => {
            assert.equal((await api('PUT', `/api/admin/redes/${redeA}`, tok(idStaff), { nome: 'IT_REDE_A' })).status, 403);
        });
        await t('staff DELETE /api/admin/redes/:id → 403', async () => {
            assert.equal((await api('DELETE', `/api/admin/redes/${redeB}`, tok(idStaff))).status, 403);
        });
        await t('admin PATCH /api/admin/empresas/:id/rede → 403', async () => {
            assert.equal((await api('PATCH', `/api/admin/empresas/${emp1}/rede`, tok(idAdminA), { rede_id: redeB })).status, 403);
        });
        await t('staff POST /api/admin/redes/:id/empresas → 403', async () => {
            assert.equal((await api('POST', `/api/admin/redes/${redeB}/empresas`, tok(idStaff), { ids: [emp1] })).status, 403);
        });
        await t('sem token GET /api/admin/redes → 401', async () => {
            assert.equal((await api('GET', '/api/admin/redes', null)).status, 401);
        });

        // ---------- CRUD ----------
        await t('super POST /api/admin/redes → 201 cria rede', async () => {
            const r = await api('POST', '/api/admin/redes', tok(idSuper), { nome: 'IT_REDE_NOVA', documento: '12345678000199', email_resp: 'resp@it.local' });
            assert.equal(r.status, 201);
            const j = await r.json();
            assert.equal(j.nome, 'IT_REDE_NOVA');
            assert.equal(j.documento, '12345678000199');
            assert.equal(j.status, 'ativa'); // default
            assert.ok(j.id);
            redeCriadaId = j.id;
        });
        await t('super POST /api/admin/redes sem nome → 400', async () => {
            assert.equal((await api('POST', '/api/admin/redes', tok(idSuper), { documento: 'x' })).status, 400);
        });

        await t('super GET /api/admin/redes → lista com contador de postos/usuários', async () => {
            const r = await api('GET', '/api/admin/redes', tok(idSuper));
            assert.equal(r.status, 200);
            const j = await r.json();
            const a = j.find((x) => x.id === redeA);
            assert.ok(a, 'devia listar IT_REDE_A');
            assert.equal(a.postos, 3, 'redeA tem 3 postos semeados');
            assert.equal(a.usuarios, 1, 'redeA tem 1 usuário (adminA)');
            const nova = j.find((x) => x.id === redeCriadaId);
            assert.equal(nova.postos, 0, 'rede nova sem postos');
            assert.equal(nova.usuarios, 0, 'rede nova sem usuários');
        });

        await t('super PUT /api/admin/redes/:id → edita nome/status', async () => {
            const r = await api('PUT', `/api/admin/redes/${redeCriadaId}`, tok(idSuper), { nome: 'IT_REDE_EDIT', status: 'suspensa' });
            assert.equal(r.status, 200);
            const j = await r.json();
            assert.equal(j.nome, 'IT_REDE_EDIT');
            assert.equal(j.status, 'suspensa');
            const chk = await client.query('SELECT nome, status FROM redes WHERE id=$1', [redeCriadaId]);
            assert.equal(chk.rows[0].nome, 'IT_REDE_EDIT');
            assert.equal(chk.rows[0].status, 'suspensa');
        });
        await t('super PUT /api/admin/redes/:id inexistente → 404', async () => {
            assert.equal((await api('PUT', '/api/admin/redes/99999999', tok(idSuper), { nome: 'X' })).status, 404);
        });

        // ---------- DELETE ----------
        await t('super DELETE rede com postos → 409', async () => {
            const r = await api('DELETE', `/api/admin/redes/${redeA}`, tok(idSuper));
            assert.equal(r.status, 409);
            const chk = await client.query('SELECT count(*)::int n FROM redes WHERE id=$1', [redeA]);
            assert.equal(chk.rows[0].n, 1, 'rede NÃO foi excluída');
        });
        await t('super DELETE rede default → 409 (nunca apaga)', async () => {
            const r = await api('DELETE', '/api/admin/redes/1', tok(idSuper));
            assert.equal(r.status, 409);
        });
        await t('super DELETE rede vazia → 200 excluída', async () => {
            const r = await api('DELETE', `/api/admin/redes/${redeCriadaId}`, tok(idSuper));
            assert.equal(r.status, 200);
            const chk = await client.query('SELECT count(*)::int n FROM redes WHERE id=$1', [redeCriadaId]);
            assert.equal(chk.rows[0].n, 0, 'rede excluída do banco');
        });

        // ---------- associar posto ----------
        await t('super PATCH /api/admin/empresas/:id/rede → move 1 posto p/ redeB', async () => {
            const r = await api('PATCH', `/api/admin/empresas/${emp1}/rede`, tok(idSuper), { rede_id: redeB });
            assert.equal(r.status, 200);
            const chk = await client.query('SELECT rede_id FROM empresas WHERE id=$1', [emp1]);
            assert.equal(Number(chk.rows[0].rede_id), Number(redeB));
        });
        await t('super PATCH empresa p/ rede inexistente → 400', async () => {
            assert.equal((await api('PATCH', `/api/admin/empresas/${emp2}/rede`, tok(idSuper), { rede_id: 99999999 })).status, 400);
        });
        await t('super PATCH empresa inexistente → 404', async () => {
            assert.equal((await api('PATCH', '/api/admin/empresas/99999999/rede', tok(idSuper), { rede_id: redeB })).status, 404);
        });

        await t('super POST /api/admin/redes/:id/empresas → move em lote p/ redeB', async () => {
            const r = await api('POST', `/api/admin/redes/${redeB}/empresas`, tok(idSuper), { ids: [emp2, emp3] });
            assert.equal(r.status, 200);
            const j = await r.json();
            assert.equal(j.movidas, 2);
            const chk = await client.query('SELECT count(*)::int n FROM empresas WHERE id = ANY($1::int[]) AND rede_id=$2', [[emp2, emp3], redeB]);
            assert.equal(chk.rows[0].n, 2, 'ambas movidas p/ redeB');
        });
        await t('super POST lote p/ rede inexistente → 400 (nada muda)', async () => {
            const r = await api('POST', '/api/admin/redes/99999999/empresas', tok(idSuper), { ids: [emp1] });
            assert.equal(r.status, 400);
        });
        await t('super POST lote sem ids → 400', async () => {
            assert.equal((await api('POST', `/api/admin/redes/${redeB}/empresas`, tok(idSuper), { ids: [] })).status, 400);
        });
    } catch (e) {
        fail++; fails.push(`FATAL → ${e.message}\n--- stderr do server ---\n${serverErr.slice(-800)}`);
    } finally {
        child.kill('SIGKILL');
        await limpar(client);
        client.release();
        await pool.end();
    }

    console.log(`\nredes-endpoints: ${pass} passaram, ${fail} falharam`);
    if (fail) { console.error(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
    console.log('OK');
})();
