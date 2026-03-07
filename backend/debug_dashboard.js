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
    const arquivoId = 278; // Feb/2020
    const dbClient = await pool.connect();
    try {
        const entradasQuery = `
            SELECT 
                c190.cfop,
                SUM(c190.vl_opr)::float8 as total_operacao,
                SUM(c190.vl_bc_icms)::float8 as total_base_icms,
                SUM(c190.vl_icms)::float8 as total_icms
            FROM documentos_c190 c190
            JOIN documentos_c100 c100 ON c190.id_documento_c100 = c100.id
            WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '0'
            GROUP BY c190.cfop
            ORDER BY c190.cfop;
        `;
        const saidasQuery = `
            SELECT 
                c190.cfop,
                SUM(c190.vl_opr)::float8 as total_operacao,
                SUM(c190.vl_bc_icms)::float8 as total_base_icms,
                SUM(c190.vl_icms)::float8 as total_icms
            FROM documentos_c190 c190
            JOIN documentos_c100 c100 ON c190.id_documento_c100 = c100.id
            WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '1'
            GROUP BY c190.cfop
            ORDER BY c190.cfop;
        `;

        const [resEntradas, resSaidas] = await Promise.all([
            dbClient.query(entradasQuery, [arquivoId]),
            dbClient.query(saidasQuery, [arquivoId])
        ]);

        console.log("Entradas rows:", resEntradas.rows);
        console.log("Saidas rows:", resSaidas.rows);

        const totalEntradas = resEntradas.rows.reduce((acc, row) => acc + (row.total_operacao || 0), 0);
        const totalSaidas = resSaidas.rows.reduce((acc, row) => acc + (row.total_operacao || 0), 0);

        console.log("Calculated totalEntradas:", totalEntradas);
        console.log("Calculated totalSaidas:", totalSaidas);

    } catch (error) {
        console.error("Error:", error);
    } finally {
        dbClient.release();
        process.exit(0);
    }
}
run();
