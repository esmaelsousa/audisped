// Migração incremental — adiciona a role 'demo' ao CHECK de usuarios.role.
// A role 'demo' é usada SOMENTE no ambiente de demonstração (DEMO_MODE=1):
// usuário sem capacidade de gestão, cujo download de deliverables é barrado pelo
// middleware demoPaywall. Ver docs/superpowers/specs/2026-07-18-ambiente-demo-prospects-design.md
//
// Idempotente: recria a constraint apenas se ela ainda não contempla 'demo'.
// Uso (CLI):  node backend/migrations/2026-07-18-role-demo.js
// Uso (programático):  const { up } = require('./2026-07-18-role-demo'); await up(client);

async function up(client) {
    // Recria a CHECK incluindo 'demo'. DROP + ADD é seguro: só valida linhas existentes,
    // e todas as roles atuais continuam válidas no novo conjunto.
    await client.query(`
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_role_chk') THEN
                ALTER TABLE usuarios DROP CONSTRAINT usuarios_role_chk;
            END IF;
            ALTER TABLE usuarios ADD CONSTRAINT usuarios_role_chk
                CHECK (role IN ('super_admin','admin','staff','escritorio','demo'));
        END $$;
    `);
}

module.exports = { up };

if (require.main === module) {
    const { Pool } = require('pg');
    // Mesma forma de conexão do server.js/demo-reset.js (DB_* individuais).
    const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
    });
    (async () => {
        const client = await pool.connect();
        try {
            await up(client);
            console.log("OK: role 'demo' habilitada no CHECK de usuarios.role.");
        } catch (e) {
            console.error('FALHA na migração role-demo:', e.message);
            process.exitCode = 1;
        } finally {
            client.release();
            await pool.end();
        }
    })();
}
