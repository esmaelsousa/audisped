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
