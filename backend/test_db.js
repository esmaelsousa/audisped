const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'audisped_db',
    password: '@820439',
    port: 5432,
});

async function run() {
    const res = await pool.query("SELECT id_sped_arquivo, num_tanque, cod_item, cap_tanque FROM lmc_movimentacao WHERE id_sped_arquivo = 9 AND cap_tanque > 0 LIMIT 10;");
    console.table(res.rows);
    pool.end();
}
run();
