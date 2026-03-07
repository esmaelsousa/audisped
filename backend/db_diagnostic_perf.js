const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function diagnostic() {
    const client = await pool.connect();
    try {
        console.log('--- DIAGNÓSTICO DE VOLUMETRIA ---');
        const tables = [
            'sped_arquivos', 'erros_analise', 'documentos_c100',
            'documentos_c190', 'documentos_itens_c170', 'lmc_movimentacao',
            'documentos_d100', 'sped_produtos', 'sped_participantes'
        ];

        for (const table of tables) {
            const res = await client.query(`SELECT count(*) FROM ${table}`);
            console.log(`Tabela ${table.padEnd(25)}: ${res.rows[0].count} registros`);
        }

        console.log('\n--- VERIFICANDO ÍNDICES NAS CHAVES ESTRANGEIRAS ---');
        const indexQueries = [
            { table: 'erros_analise', col: 'id_sped_arquivo' },
            { table: 'documentos_c100', col: 'id_sped_arquivo' },
            { table: 'lmc_movimentacao', col: 'id_sped_arquivo' },
            { table: 'documentos_d100', col: 'id_sped_arquivo' },
            { table: 'sped_produtos', col: 'id_sped_arquivo' },
            { table: 'sped_participantes', col: 'id_sped_arquivo' },
            { table: 'documentos_c113', col: 'id_documento_c100' },
            { table: 'documentos_c190', col: 'id_documento_c100' },
            { table: 'documentos_itens_c170', col: 'id_documento_c100' }
        ];

        for (const q of indexQueries) {
            const res = await client.query(`
                SELECT count(*) 
                FROM pg_indexes 
                WHERE tablename = $1 AND indexdef LIKE $2
            `, [q.table, `%(${q.col})%`]);

            const hasIndex = parseInt(res.rows[0].count) > 0;
            console.log(`Tabela ${q.table.padEnd(25)} Coluna ${q.col}: ${hasIndex ? '✅ COM ÍNDICE' : '❌ SEM ÍNDICE'}`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        process.exit();
    }
}

diagnostic();
