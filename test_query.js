require('dotenv').config({ path: 'backend/.env' });
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function run() {
    try {
        const res = await pool.query('SELECT id, periodo_apuracao FROM sped_arquivos LIMIT 1');
        if (res.rows.length > 0) {
            const id = res.rows[0].id;
            console.log("Testing with ID:", id, "Periodo:", res.rows[0].periodo_apuracao);
            
            const q = `
                WITH mes_atual AS (
                    SELECT id, cnpj_empresa, TO_DATE(LEFT(periodo_apuracao, 10), 'DD/MM/YYYY') as dt_inicio
                    FROM sped_arquivos WHERE id = $1
                ),
                mes_anterior_arquivo AS (
                    SELECT sa.id, sa.cnpj_empresa, sa.periodo_apuracao
                    FROM sped_arquivos sa
                    JOIN mes_atual ma ON sa.cnpj_empresa = ma.cnpj_empresa
                    WHERE TO_DATE(RIGHT(sa.periodo_apuracao, 10), 'DD/MM/YYYY') = (ma.dt_inicio - INTERVAL '1 day')::DATE
                    ORDER BY sa.id DESC LIMIT 1
                )
                SELECT * FROM mes_anterior_arquivo;
            `;
            await pool.query(q, [id]);
            console.log("Query success!");
        } else {
            console.log("No sped files found");
        }
    } catch (e) {
        console.error("SQL Error:", e);
    } finally {
        await pool.end();
    }
}
run();
