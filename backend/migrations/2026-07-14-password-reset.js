// Migração — tabela de tokens de "esqueci minha senha" (auto-serviço).
// Idempotente. Uso: node backend/migrations/2026-07-14-password-reset.js
//   ou docker exec audisped-backend node migrations/2026-07-14-password-reset.js

async function up(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id         SERIAL PRIMARY KEY,
            usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL,               -- sha256 do token cru (nunca guardamos o cru)
            expira_em  TIMESTAMP NOT NULL,
            usado      BOOLEAN NOT NULL DEFAULT FALSE,
            criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_prt_usuario ON password_reset_tokens(usuario_id);`);
}

module.exports = { up };

if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const { Pool } = require('pg');
    const pool = new Pool({
        user: (process.env.DB_USER || '').trim(),
        host: (process.env.DB_HOST || '').trim(),
        database: (process.env.DB_DATABASE || '').trim(),
        password: (process.env.DB_PASSWORD || '').trim(),
        port: parseInt((process.env.DB_PORT || '5432').trim()),
    });
    (async () => {
        const client = await pool.connect();
        try { await up(client); console.log('Migração password_reset OK.'); }
        catch (e) { console.error('Migração FALHOU:', e.message); process.exitCode = 1; }
        finally { client.release(); await pool.end(); }
    })();
}
