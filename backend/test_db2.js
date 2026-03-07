const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'audisped_db',
    password: '@820439',
    port: 5432,
});

async function run() {
    const res = await pool.query("SELECT * FROM lmc_tanques_config;");
    console.table(res.rows);
    const res2 = await pool.query("SELECT id, cnpj_empresa FROM sped_arquivos WHERE id = 9;");
    console.table(res2.rows);
    pool.end();
}
run();
