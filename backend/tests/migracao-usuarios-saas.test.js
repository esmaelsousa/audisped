// Testa a migração incremental + backfill (Fatia 1) contra o banco LOCAL.
//   node backend/tests/migracao-usuarios-saas.test.js
// Idempotente: pode rodar N vezes. Requer DB local acessível (.env).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const assert = require('assert');
const { Pool } = require('pg');
const { up } = require('../migrations/2026-07-14-usuarios-saas');

const SUPER_EMAIL = 'esmaelsousa@gmail.com';
const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

async function cols(client) {
    const r = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='usuarios'");
    return r.rows.map((x) => x.column_name);
}

(async () => {
    const client = await pool.connect();
    let pass = 0, fail = 0; const fails = [];
    const t = async (nome, fn) => { try { await fn(); pass++; } catch (e) { fail++; fails.push(`${nome} → ${e.message}`); } };
    try {
        // ---- 1ª execução ----
        await up(client, { superAdminEmail: SUPER_EMAIL });

        await t('usuarios ganhou role/rede_id/modulos/ativo/precisa_trocar_senha', async () => {
            const c = await cols(client);
            ['role', 'rede_id', 'modulos', 'ativo', 'precisa_trocar_senha'].forEach((col) =>
                assert.ok(c.includes(col), `faltou coluna ${col}`));
        });
        await t('tabela redes existe com rede default', async () => {
            const r = await client.query("SELECT count(*)::int n FROM redes WHERE nome='default'");
            assert.equal(r.rows[0].n, 1);
        });
        await t('tabela auditoria_seguranca existe', async () => {
            const r = await client.query("SELECT to_regclass('public.auditoria_seguranca') t");
            assert.ok(r.rows[0].t);
        });
        await t('Esmael é o único super_admin, rede_id NULL', async () => {
            const r = await client.query("SELECT id, email, rede_id FROM usuarios WHERE role='super_admin'");
            assert.equal(r.rows.length, 1);
            assert.equal(r.rows[0].email.toLowerCase(), SUPER_EMAIL);
            assert.equal(r.rows[0].rede_id, null);
        });
        await t('demais usuários viraram staff com rede_id NULL', async () => {
            const r = await client.query(
                "SELECT count(*)::int n FROM usuarios WHERE role='staff' AND rede_id IS NULL");
            const tot = await client.query("SELECT count(*)::int n FROM usuarios");
            assert.equal(r.rows[0].n, tot.rows[0].n - 1); // todos menos o super
        });

        // ---- 2ª execução (idempotência) ----
        await up(client, { superAdminEmail: SUPER_EMAIL });
        await t('idempotente: continua 1 rede default', async () => {
            const r = await client.query("SELECT count(*)::int n FROM redes WHERE nome='default'");
            assert.equal(r.rows[0].n, 1);
        });
        await t('idempotente: continua 1 super_admin', async () => {
            const r = await client.query("SELECT count(*)::int n FROM usuarios WHERE role='super_admin'");
            assert.equal(r.rows[0].n, 1);
        });
    } finally {
        client.release();
        await pool.end();
    }
    console.log(`\nmigracao-usuarios-saas: ${pass} passaram, ${fail} falharam`);
    if (fail) { console.error(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
    console.log('OK');
})();
