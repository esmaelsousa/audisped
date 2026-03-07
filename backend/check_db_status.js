
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

async function checkDb() {
    let client;
    try {
        client = await pool.connect();
        console.log('--- Amostra de Registros LMC Arquivo 294 ---');
        const dataRes = await client.query(`
            SELECT id, cod_item, data_mov, estq_abert, vol_entr, vol_saidas, val_perda, val_ganho, estq_escr, fech_fisico 
            FROM lmc_movimentacao 
            WHERE id_sped_arquivo = 294
            LIMIT 10;
        `);
        console.table(dataRes.rows);

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

checkDb();
