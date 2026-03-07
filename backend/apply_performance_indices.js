const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function applyIndices() {
    const client = await pool.connect();
    try {
        console.log('--- APLICANDO ÍNDICES DE PERFORMANCE ---');

        const queries = [
            'CREATE INDEX IF NOT EXISTS idx_c100_arquivo ON documentos_c100 (id_sped_arquivo)',
            'CREATE INDEX IF NOT EXISTS idx_c190_documento ON documentos_c190 (id_documento_c100)',
            'CREATE INDEX IF NOT EXISTS idx_c170_documento ON documentos_itens_c170 (id_documento_c100)',
            'CREATE INDEX IF NOT EXISTS idx_lmc_arquivo ON lmc_movimentacao (id_sped_arquivo)',
            'CREATE INDEX IF NOT EXISTS idx_produtos_arquivo ON sped_produtos (id_sped_arquivo)',
            'CREATE INDEX IF NOT EXISTS idx_participantes_arquivo ON sped_participantes (id_sped_arquivo)'
        ];

        for (const sql of queries) {
            console.log(`Executando: ${sql}...`);
            await client.query(sql);
        }

        console.log('✅ Todos os índices foram aplicados com sucesso!');

    } catch (e) {
        console.error('❌ Erro ao aplicar índices:', e);
    } finally {
        client.release();
        process.exit();
    }
}

applyIndices();
