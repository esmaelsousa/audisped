const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function probe() {
    const client = await pool.connect();
    try {
        const tables = [
            'erros_analise',
            'documentos_c190',
            'documentos_itens_c170',
            'documentos_c100',
            'lmc_movimentacao',
            'documentos_d100',
            'sped_produtos',
            'sped_participantes',
            'vendas_combustiveis',
            'lmc_entrada',
            'sped_arquivos'
        ];

        for (const table of tables) {
            try {
                await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
                console.log(`Table ${table}: EXISTS`);
            } catch (e) {
                console.log(`Table ${table}: DOES NOT EXIST (${e.message})`);
            }
        }
    } finally {
        client.release();
        process.exit();
    }
}

probe();
