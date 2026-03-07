
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

async function testMath() {
    let client;
    try {
        client = await pool.connect();
        const arquivoId = 297;

        console.log(`--- Analisando Registro 10/01/2020 GASOLINA COMUM (Arquivo ${arquivoId}) ---`);

        const res = await client.query(`
            SELECT * FROM lmc_movimentacao 
            WHERE id_sped_arquivo = $1 
              AND cod_item = '1'
              AND data_mov = '2020-01-10'
        `, [arquivoId]);

        if (res.rows.length > 0) {
            const r = res.rows[0];
            console.log('--- CAMPOS ORIGINAIS ---');
            console.log('Estoque Abertura (C4):', r.estq_abert);
            console.log('Vol. Entradas (C5):', r.vol_entr);
            console.log('Vol. Saídas (C7):', r.vol_saidas);
            console.log('Estoque Escritural (C8):', r.estq_escr);
            console.log('Fechamento Físico (C11):', r.fech_fisico);

            const dif = parseFloat(r.fech_fisico) - parseFloat(r.estq_escr);
            const volumeBase = parseFloat(r.estq_abert) + parseFloat(r.vol_entr);
            const perc = (Math.abs(dif) / volumeBase) * 100;

            console.log('\n--- CÁLCULO ESTÁTICO (PADRÃO HTML) ---');
            console.log('Diferença (Físico - Escritural):', dif.toFixed(3));
            console.log('% ANP (Dif / (Abert + Entr)):', perc.toFixed(4) + '%');

        } else {
            console.log("Registro não encontrado!");
        }

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

testMath();
