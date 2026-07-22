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
