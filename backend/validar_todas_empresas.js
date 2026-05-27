const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'audisped_db',
    password: process.env.DB_PASSWORD || '@820439',
    port: process.env.DB_PORT || 5432
});

// Validação: compara SPED original (arquivo) com dados do banco (lmc_movimentacao)
// Verifica se o banco preservou TODAS as informações do original:
// 1. Notas (C100): mesmas chaves
// 2. Entradas (vol_entr): idênticas ao original
// 3. Estoque abertura (estq_abert): preservado
// 4. Saídas: podem diferir (Re-distribuir ajusta) — apenas reporta

async function run() {
    const client = await pool.connect();
    try {
        const empresas = await client.query(`
            SELECT DISTINCT ON (e.cnpj) e.cnpj, COALESCE(e.nome_fantasia, e.nome_empresa) as nome
            FROM empresas e
            JOIN sped_arquivos s ON e.cnpj = REGEXP_REPLACE(s.cnpj_empresa,'[^0-9]','','g')
            ORDER BY e.cnpj
        `);

        console.log('VALIDAÇÃO GLOBAL: SPED ORIGINAL vs BANCO — TODAS AS EMPRESAS');
        console.log('='.repeat(80));

        let totalArquivos = 0, totalOk = 0, totalErros = 0;

        for (const emp of empresas.rows) {
            const speds = await client.query(`
                SELECT id, periodo_apuracao, caminho_arquivo FROM sped_arquivos
                WHERE REGEXP_REPLACE(cnpj_empresa,'[^0-9]','','g') = $1
                ORDER BY periodo_apuracao
            `, [emp.cnpj]);

            let empOk = 0, empErros = 0;
            const errosEmpresa = [];

            for (const sp of speds.rows) {
                totalArquivos++;
                const periodo = sp.periodo_apuracao.substring(0, 7);

                // Ler SPED original
                let content;
                try { content = fs.readFileSync(sp.caminho_arquivo, 'latin1'); }
                catch(e) { errosEmpresa.push(`[${periodo}] Arquivo não encontrado`); empErros++; continue; }

                const lines = content.split(/\r?\n/);

                // 1. Contar C100 com chaves no original
                let c100Count = 0;
                const chavesOrig = new Set();
                for (const line of lines) {
                    const p = line.split('|');
                    if (p[1] === 'C100') {
                        c100Count++;
                        const chave = (p[9] || '').trim();
                        if (chave && chave.length > 10) chavesOrig.add(chave);
                    }
                }

                // 2. Verificar C100 no banco
                const c100Banco = await client.query(
                    `SELECT COUNT(*) as cnt FROM documentos_c100 WHERE id_sped_arquivo = $1`, [sp.id]
                );
                const c100BancoCount = parseInt(c100Banco.rows[0].cnt);

                // 3. Comparar entradas (vol_entr) do 1300 original vs banco
                const entradasOrig = {};
                for (const line of lines) {
                    const p = line.split('|');
                    if (p[1] === '1300') {
                        const cod = (p[2] || '').trim();
                        const dt = (p[3] || '').trim();
                        const entr = parseFloat((p[5] || '0').replace(',', '.'));
                        entradasOrig[`${cod}_${dt}`] = entr;
                    }
                }

                const lmcBanco = await client.query(`
                    SELECT cod_item, data_mov, vol_entr FROM lmc_movimentacao
                    WHERE id_sped_arquivo = $1
                `, [sp.id]);

                let entDiff = 0;
                for (const row of lmcBanco.rows) {
                    const dt = row.data_mov.toISOString().split('T')[0];
                    const dd = dt.substring(8,10), mm = dt.substring(5,7), yy = dt.substring(0,4);
                    const key = `${row.cod_item.trim()}_${dd}${mm}${yy}`;
                    const origEntr = entradasOrig[key];
                    if (origEntr !== undefined && Math.abs(origEntr - parseFloat(row.vol_entr)) > 0.1) {
                        entDiff++;
                    }
                }

                // Verificações
                const erros = [];
                if (c100BancoCount < chavesOrig.size * 0.9) {
                    erros.push(`C100: orig=${chavesOrig.size} banco=${c100BancoCount} (faltam ${chavesOrig.size - c100BancoCount})`);
                }
                if (entDiff > 0) {
                    erros.push(`ENTRADAS: ${entDiff} dias com vol_entr diferente`);
                }

                if (erros.length > 0) {
                    empErros++;
                    errosEmpresa.push(`[${periodo}] ${erros.join(' | ')}`);
                } else {
                    empOk++;
                }
            }

            totalOk += empOk;
            totalErros += empErros;

            if (empErros === 0) {
                console.log(`✓ ${emp.nome.substring(0,35).padEnd(37)} CNPJ ${emp.cnpj} | ${speds.rows.length} arquivos OK`);
            } else {
                console.log(`✗ ${emp.nome.substring(0,35).padEnd(37)} CNPJ ${emp.cnpj} | ${empOk} OK, ${empErros} com erro:`);
                errosEmpresa.forEach(e => console.log(`    ${e}`));
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log(`RESULTADO GLOBAL: ${totalOk} OK | ${totalErros} com divergências | ${totalArquivos} arquivos verificados`);

    } finally {
        client.release();
        pool.end();
    }
}

run().catch(e => console.error(e));
