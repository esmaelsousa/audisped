
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

async function checkDuplicates() {
    let client;
    try {
        client = await pool.connect();
        console.log('--- Verificando Arquivos no Banco de Dados ---');
        const res = await client.query(`
            SELECT id, nome_arquivo, cnpj_empresa, periodo_apuracao 
            FROM sped_arquivos 
            ORDER BY id DESC 
            LIMIT 20;
        `);
        console.table(res.rows);

        console.log('\n--- Verificando LMC para o último arquivo ---');
        if (res.rows.length > 0) {
            const lastId = res.rows[0].id;
            const lmcRes = await client.query('SELECT COUNT(*) FROM lmc_movimentacao WHERE id_sped_arquivo = $1', [lastId]);
            console.log(`Arquivo ID ${lastId} possui ${lmcRes.rows[0].count} registros LMC.`);

            const janFile = res.rows.find(r => r.periodo_apuracao === '012020');
            if (janFile) {
                const lmcJan = await client.query('SELECT COUNT(*) FROM lmc_movimentacao WHERE id_sped_arquivo = $1', [janFile.id]);
                console.log(`Arquivo Janeiro (ID ${janFile.id}) possui ${lmcJan.rows[0].count} registros LMC.`);
            }
        }

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

checkDuplicates();
