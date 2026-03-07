const { Pool } = require('pg');

async function run() {
  const pool = new Pool({ user: 'postgres', host: 'localhost', database: 'audisped_db', password: '@820439', port: 5432 });
  
  const aRes = await pool.query('SELECT id, cnpj_empresa FROM sped_arquivos ORDER BY id DESC LIMIT 1');
  const id_arquivo = aRes.rows[0].id;
  const cod_item = '4';
  const volume_alvo = 20000;
  
  console.log('Testando otimizador para arquivo %s, item %s, meta %s', id_arquivo, cod_item, volume_alvo);

  const capRes = await pool.query(`
      SELECT c.capacidade 
      FROM lmc_tanques_config c
      JOIN sped_arquivos a ON a.cnpj_empresa = c.cnpj
      WHERE a.id = $1 AND c.cod_item = $2
  `, [id_arquivo, cod_item]);
  
  console.log('Capacidade retornada:', capRes.rows);

  const resLmc = await pool.query(`
      SELECT * FROM lmc_movimentacao 
      WHERE id_sped_arquivo = $1 AND cod_item = $2
      ORDER BY data_mov ASC
  `, [id_arquivo, cod_item]);
  
  console.log('Registros para otimizacao:', resLmc.rows.length);
  pool.end();
}
run();
