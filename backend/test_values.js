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
    const archId = 278;
    // Check fuel-related CFOPs in items
    const { rows: cfops } = await pool.query(`
        SELECT cfop, SUM(qtd) as total_qtd, SUM(vl_item) as total_valor
        FROM documentos_itens_c170 it
        JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
        WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '0'
        GROUP BY cfop;
    `, [archId]);
    console.log("Incoming CFOPs (items):", cfops);

    // Check products to identify fuels
    const { rows: prods } = await pool.query(`
        SELECT p.cod_item, p.descr_item, SUM(it.qtd) as total_qtd
        FROM documentos_itens_c170 it
        JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
        JOIN sped_produtos p ON c100.id_sped_arquivo = p.id_sped_arquivo AND it.cod_item = p.cod_item
        WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '0'
        GROUP BY p.cod_item, p.descr_item;
    `, [archId]);
    console.log("Incoming Products:", prods);

    process.exit(0);
}
run();
