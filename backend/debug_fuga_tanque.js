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
        data_mov, 
        vol_saidas_ajustado as "Vend", 
        estq_abert_ajustado as "Abe", 
        vol_entr as "Ent", 
        vol_escr_ajustado as "Escr",  
        val_perda_ajustado as "P",
        val_ganho_ajustado as "G",
        fech_fisico_ajustado as "Fis(Teto)"
      from lmc_movimentacao 
      where cod_item = '2' and data_mov like '%112025'
      order by data_mov asc LIMIT 10;
    `);
  
    console.table(result.rows);
    pool.end();
}
run();
