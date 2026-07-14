// Integração dos endpoints de usuários (Fatia 1) — sobe o server real numa porta de teste,
// forja tokens com o JWT_SECRET (enrich re-busca role/rede do banco por id) e valida os aceites
// §13.3 (clamp) e §13.7 (alvo). Semeia e limpa seus próprios dados (padrão it_%@test.local).
//   node backend/tests/usuarios-endpoints.test.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const assert = require('assert');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const JWT_SECRET = process.env.JWT_SECRET || 'audisped-safira-token-secret-2025';
const PORT = 15999;
const BASE = `http://127.0.0.1:${PORT}`;
const SUF = `it_${process.pid}`;
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
    const redeA = (await client.query(`INSERT INTO redes (nome, status, modulos_contratados) VALUES ('IT_REDE_A','ativa','["validador","conciliacao"]'::jsonb) RETURNING id`)).rows[0].id;
    const redeB = (await client.query(`INSERT INTO redes (nome, status, modulos_contratados) VALUES ('IT_REDE_B','ativa','[]'::jsonb) RETURNING id`)).rows[0].id;
    const senha = await bcrypt.hash('x', 4);
    const mk = async (email, role, rede) => (await client.query(
        `INSERT INTO usuarios (nome,email,senha,role,rede_id,ativo) VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
        ['IT', email, senha, role, rede])).rows[0].id;
    const idSuper = await mk(`${SUF}_super@test.local`, 'super_admin', null);
    const idStaff = await mk(`${SUF}_staff@test.local`, 'staff', null);
    const idAdminA = await mk(`${SUF}_adminA@test.local`, 'admin', redeA);
    const idAdminA2 = await mk(`${SUF}_adminA2@test.local`, 'admin', redeA);
    const idEscrA = await mk(`${SUF}_escrA@test.local`, 'escritorio', redeA);
    const idEscrB = await mk(`${SUF}_escrB@test.local`, 'escritorio', redeB);

    const child = spawn('node', ['server.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) } });
    let serverErr = '';
    child.stderr.on('data', (d) => { serverErr += d.toString(); });
    child.stdout.on('data', () => {});

    try {
        await esperarServidor();

        // §13.2: register fechado
        await t('POST /api/auth/register → 410 (fechado)', async () => {
            const r = await api('POST', '/api/auth/register', tok(idSuper), { nome: 'x', email: `${SUF}_reg@test.local`, senha: 'y' });
            assert.equal(r.status, 410);
        });

        // §13.3: clamp
        await t('staff POST /api/admin/usuarios → 403', async () => {
            const r = await api('POST', '/api/admin/usuarios', tok(idStaff), { nome: 'x', email: `${SUF}_c1@test.local`, senha: 'y' });
            assert.equal(r.status, 403);
        });
        await t('ACEITE admin POST role=super_admin → 403', async () => {
            const r = await api('POST', '/api/admin/usuarios', tok(idAdminA), { nome: 'x', email: `${SUF}_c2@test.local`, senha: 'y', role: 'super_admin' });
            assert.equal(r.status, 403);
        });
        await t('admin POST rede_id=<outra> → 403', async () => {
            const r = await api('POST', '/api/admin/usuarios', tok(idAdminA), { nome: 'x', email: `${SUF}_c3@test.local`, senha: 'y', rede_id: redeB });
            assert.equal(r.status, 403);
        });
        await t('admin POST válido → 201 escritorio na própria rede, sem senha no corpo', async () => {
            const r = await api('POST', '/api/admin/usuarios', tok(idAdminA), { nome: 'Novo', email: `${SUF}_created@test.local`, senha: 'segredo', modulos: ['validador', 'injetor_xml'] });
            assert.equal(r.status, 201);
            const j = await r.json();
            assert.equal(j.role, 'escritorio');
            assert.equal(Number(j.rede_id), Number(redeA));
            assert.ok(!('senha' in j), 'não deve vazar senha');
            assert.deepEqual(j.modulos, ['validador']); // interseção com contratado da rede A
        });

        // escopo de listagem
        await t('GET /api/admin/usuarios: admin vê só a própria rede', async () => {
            const r = await api('GET', '/api/admin/usuarios', tok(idAdminA));
            assert.equal(r.status, 200);
            const j = await r.json();
            const emails = j.map((u) => u.email);
            assert.ok(emails.includes(`${SUF}_escrA@test.local`), 'devia ver escritorio da rede A');
            assert.ok(!emails.includes(`${SUF}_escrB@test.local`), 'NÃO devia ver escritorio da rede B');
        });

        // §13.7: reset-senha
        await t('admin reset escritorio própria rede → 200 + senha temporária', async () => {
            const r = await api('POST', `/api/admin/usuarios/${idEscrA}/reset-senha`, tok(idAdminA));
            assert.equal(r.status, 200);
            const j = await r.json();
            assert.ok(j.senhaTemporaria && j.senhaTemporaria.length >= 6);
            const chk = await client.query('SELECT precisa_trocar_senha FROM usuarios WHERE id=$1', [idEscrA]);
            assert.equal(chk.rows[0].precisa_trocar_senha, true);
        });
        await t('admin reset admin-par mesma rede → 403 (takeover lateral §13.7)', async () => {
            const r = await api('POST', `/api/admin/usuarios/${idAdminA2}/reset-senha`, tok(idAdminA));
            assert.equal(r.status, 403);
        });
        await t('admin reset escritorio de OUTRA rede → 403', async () => {
            const r = await api('POST', `/api/admin/usuarios/${idEscrB}/reset-senha`, tok(idAdminA));
            assert.equal(r.status, 403);
        });

        // desativar
        await t('admin desativa escritorio própria rede → 200 ativo=false', async () => {
            const r = await api('PATCH', `/api/admin/usuarios/${idEscrA}/desativar`, tok(idAdminA));
            assert.equal(r.status, 200);
            const chk = await client.query('SELECT ativo FROM usuarios WHERE id=$1', [idEscrA]);
            assert.equal(chk.rows[0].ativo, false);
        });
        await t('admin reativa escritorio própria rede → 200 ativo=true', async () => {
            const r = await api('PATCH', `/api/admin/usuarios/${idEscrA}/ativar`, tok(idAdminA));
            assert.equal(r.status, 200);
            const chk = await client.query('SELECT ativo FROM usuarios WHERE id=$1', [idEscrA]);
            assert.equal(chk.rows[0].ativo, true);
        });

        // GET /api/admin/redes (dropdown do super)
        await t('super GET /api/admin/redes → 200 lista com as redes', async () => {
            const r = await api('GET', '/api/admin/redes', tok(idSuper));
            assert.equal(r.status, 200);
            const j = await r.json();
            assert.ok(Array.isArray(j));
            assert.ok(j.some((x) => x.nome === 'IT_REDE_A'), 'devia listar IT_REDE_A');
        });
        await t('admin GET /api/admin/redes → 403 (só super)', async () => {
            const r = await api('GET', '/api/admin/redes', tok(idAdminA));
            assert.equal(r.status, 403);
        });

        // /api/auth/me enriquecido (front precisa do papel no boot)
        await t('GET /api/auth/me devolve role + rede_id do ator', async () => {
            const r = await api('GET', '/api/auth/me', tok(idAdminA));
            assert.equal(r.status, 200);
            const j = await r.json();
            assert.equal(j.role, 'admin');
            assert.equal(Number(j.rede_id), Number(redeA));
            assert.ok('precisa_trocar_senha' in j);
        });

        // Fluxo força-troca: PUT /api/auth/profile zera precisa_trocar_senha e login reflete
        await t('PUT /api/auth/profile (nova senha) zera precisa_trocar_senha e login reflete', async () => {
            await client.query('UPDATE usuarios SET precisa_trocar_senha = TRUE WHERE id = $1', [idEscrB]);
            const r = await api('PUT', '/api/auth/profile', tok(idEscrB),
                { nome: 'IT', email: `${SUF}_escrB@test.local`, senha: 'novaSenha123' });
            assert.equal(r.status, 200);
            const chk = await client.query('SELECT precisa_trocar_senha FROM usuarios WHERE id = $1', [idEscrB]);
            assert.equal(chk.rows[0].precisa_trocar_senha, false);
            const login = await api('POST', '/api/auth/login', null, { email: `${SUF}_escrB@test.local`, senha: 'novaSenha123' });
            assert.equal(login.status, 200);
            const lj = await login.json();
            assert.equal(lj.precisa_trocar_senha, false);
            assert.equal(lj.user.role, 'escritorio');
        });
    } catch (e) {
        fail++; fails.push(`FATAL → ${e.message}\n--- stderr do server ---\n${serverErr.slice(-800)}`);
    } finally {
        child.kill('SIGKILL');
        await limpar(client);
        client.release();
        await pool.end();
    }

    console.log(`\nusuarios-endpoints: ${pass} passaram, ${fail} falharam`);
    if (fail) { console.error(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
    console.log('OK');
})();
