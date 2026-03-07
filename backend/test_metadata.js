require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});
async function run() {
    const archId = 275;
    const { rows } = await pool.query(`SELECT num_doc, vl_doc, dt_doc FROM documentos_c100 WHERE id_sped_arquivo = $1 AND num_doc = '677'`, [archId]);
    console.log("NF 677 (arch 275):", rows);
    process.exit(0);
}
run();
