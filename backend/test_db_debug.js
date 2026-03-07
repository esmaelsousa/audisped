require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool();
async function run() {
    try {
        const { rows } = await pool.query(`SELECT id, data_mov, estq_abert, estq_abert_ajustado, vol_entr, vol_entr_ajustado, vol_saidas, vol_saidas_ajustado, estq_escr, estq_escr_ajustado, fech_fisico, fech_fisico_ajustado, val_perda_ajustado, val_ganho_ajustado FROM lmc_movimentacao ORDER BY data_mov ASC LIMIT 5`);
        console.log(rows);
    } catch (e) {
        console.error(e);
    }
    process.exit();
}
run();
