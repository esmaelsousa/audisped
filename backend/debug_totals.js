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
    const arquivoId = 278;
    const { rows: c100Total } = await pool.query(`
        SELECT SUM(vl_doc)::float8 as total_c100 
        FROM documentos_c100 
        WHERE id_sped_arquivo = $1 AND ind_oper = '1' AND cod_sit <> '02'
    `, [arquivoId]);

    const { rows: c190Total } = await pool.query(`
        SELECT SUM(vl_opr)::float8 as total_c190
        FROM documentos_c190 c190
        JOIN documentos_c100 c100 ON c190.id_documento_c100 = c100.id
        WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '1'
    `, [arquivoId]);

    console.log("Total C100 (Non-canceled):", c100Total[0].total_c100);
    console.log("Total C190 (vl_opr):", c190Total[0].total_c190);
    process.exit(0);
}
run();
