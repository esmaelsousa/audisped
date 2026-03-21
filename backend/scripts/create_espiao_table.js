const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('Criando tabela espiao_nfe_cache...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS espiao_nfe_cache (
                id SERIAL PRIMARY KEY,
                id_empresa INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
                chave_nfe TEXT UNIQUE NOT NULL,
                numero_nfe TEXT,
                serie_nfe TEXT,
                cnpj_emissor TEXT,
                nome_emissor TEXT,
                valor NUMERIC(15,2),
                data_emissao TIMESTAMP,
                status_nfe TEXT, -- 'Autorizada', 'Cancelada', etc
                xml_content TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Tabela espiao_nfe_cache criada com sucesso.');
    } catch (err) {
        console.error('Erro ao criar tabela:', err);
    } finally {
        client.release();
        process.exit();
    }
}

run();
