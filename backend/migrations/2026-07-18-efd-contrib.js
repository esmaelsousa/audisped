// Migração — tabelas do módulo EFD-Contribuições (Fase 1: round-trip).
// Idempotente. NÃO altera tabelas existentes (prefixo efd_contrib_, nunca conflita).
// Uso: node backend/migrations/2026-07-18-efd-contrib.js
//   ou docker exec audisped-backend node migrations/2026-07-18-efd-contrib.js

async function up(client) {
    // Controle do arquivo importado + metadados p/ remontagem byte-idêntica.
    await client.query(`
        CREATE TABLE IF NOT EXISTS efd_contrib_arquivos (
            id            SERIAL PRIMARY KEY,
            id_empresa    INTEGER,
            cnpj          TEXT,
            competencia   TEXT,            -- MM/AAAA (do 0000)
            regime        TEXT,            -- COD_INC_TRIB do 0110 (1 não-cumul., 2 cumul., 3 ambos)
            cod_ver       TEXT,
            dt_ini        TEXT,
            dt_fin        TEXT,
            nome_original TEXT,
            eol           TEXT NOT NULL DEFAULT E'\r\n',  -- terminador de linha preservado
            trailing_eol  BOOLEAN NOT NULL DEFAULT TRUE,  -- havia newline no fim do arquivo?
            total_linhas  INTEGER,
            sha256        TEXT,            -- hash do original (prova do round-trip)
            dt_upload     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Linhas cruas preservadas em ordem (a fonte de verdade da remontagem).
    await client.query(`
        CREATE TABLE IF NOT EXISTS efd_contrib_linhas (
            id         SERIAL PRIMARY KEY,
            id_arquivo INTEGER NOT NULL REFERENCES efd_contrib_arquivos(id) ON DELETE CASCADE,
            num_linha  INTEGER NOT NULL,
            reg        TEXT,
            bloco      TEXT,
            raw        TEXT NOT NULL
        );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_efd_contrib_linhas_arq ON efd_contrib_linhas(id_arquivo, num_linha);`);
}

module.exports = { up };

if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const { Pool } = require('pg');
    const pool = new Pool({
        user: (process.env.DB_USER || '').trim(),
        host: (process.env.DB_HOST || '').trim(),
        database: (process.env.DB_DATABASE || '').trim(),
        password: (process.env.DB_PASSWORD || '').trim(),
        port: parseInt((process.env.DB_PORT || '5432').trim()),
    });
    (async () => {
        const client = await pool.connect();
        try { await up(client); console.log('Migração efd_contrib OK.'); }
        catch (e) { console.error('Migração FALHOU:', e.message); process.exitCode = 1; }
        finally { client.release(); await pool.end(); }
    })();
}
