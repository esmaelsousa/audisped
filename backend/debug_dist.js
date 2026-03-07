require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool();
async function run() {
    const { rows } = await pool.query(`SELECT data_mov, estq_abert_ajustado, vol_entr_ajustado, vol_saidas_ajustado, estq_escr_ajustado, fech_fisico_ajustado, val_perda_ajustado FROM lmc_movimentacao WHERE data_mov >= '2025-11-01' ORDER BY data_mov ASC LIMIT 5`);
    console.log(rows);
    process.exit();
}
run();
