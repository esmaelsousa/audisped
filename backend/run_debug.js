const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'audisped_db',
    password: '@820439',
    port: 5432,
});

async function run() {
    const result = await pool.query(`
      select 
        id,
        data_mov as data, 
        vol_saidas_ajustado as s, 
        estq_abert_ajustado as abr, 
        vol_entr as ent, 
        vol_escr_ajustado as descr,  
        fech_fisico_ajustado as fisico
      from lmc_movimentacao 
      where id_sped_arquivo = 9 and cod_item = '2'
      order by data_mov asc;
    `);

    console.table(result.rows.filter(r => parseFloat(r.fisico) > 5000));
    pool.end();
}
run();
