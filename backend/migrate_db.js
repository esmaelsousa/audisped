const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'audisped_db',
  password: '@820439',
  port: 5432,
});

async function migrate() {
  try {
    console.log('Iniciando migração manual...');
    await pool.query(\`
      ALTER TABLE lmc_movimentacao 
      ADD COLUMN IF NOT EXISTS val_perda_ajustado NUMERIC,
      ADD COLUMN IF NOT EXISTS val_ganho_ajustado NUMERIC,
      ADD COLUMN IF NOT EXISTS estq_abert_ajustado NUMERIC,
      ADD COLUMN IF NOT EXISTS vol_escr_ajustado NUMERIC;
    \`);
    console.log('MIGRACAO_OK');
    process.exit(0);
  } catch (err) {
    console.log('MIGRACAO_ERRO: ' + err.message);
    process.exit(1);
  }
}
migrate();
