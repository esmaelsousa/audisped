// backend/migrations/2026-07-19-fase1-indices-scope.js
// Fase 1 — índices de suporte ao isolamento por rede (scopeRede / list-scoping).
//
// Pendência apontada no plano: o list-scoping e as resoluções de escopo do tipo 'sped'
// (sped_arquivos → empresa → rede) fazem JOIN/filtro por sped_arquivos.id_empresa. Sem
// índice nessa FK o Postgres cai em seq scan a cada verificação de acesso. Este índice
// cobre o caminho arquivo→empresa que o scopeRede percorre em TODA rota 'sped'.
//
// Idempotente (IF NOT EXISTS). ALTER/CREATE INDEX apenas — nunca recria tabelas.
async function up(client) {
  // FK sped_arquivos.id_empresa: usada pelo JOIN empresas do scopeRede('sped') e pelo
  // list-scoping de GET /api/arquivos (filtro por rede via empresas.rede_id).
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_sped_arquivos_empresa ON sped_arquivos(id_empresa)`
  );
}
module.exports = { up };
if (require.main === module) {
  const { Pool } = require('pg');
  const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
  (async () => { const c = await pool.connect();
    try { await up(c); console.log('OK: idx_sped_arquivos_empresa'); }
    catch (e) { console.error('FALHA:', e.message); process.exitCode = 1; }
    finally { c.release(); await pool.end(); } })();
}
