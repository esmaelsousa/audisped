const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
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
