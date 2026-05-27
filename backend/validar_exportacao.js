const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'audisped_db',
    password: process.env.DB_PASSWORD || '@820439',
    port: process.env.DB_PORT || 5432
});

const EXPORT_DIR = '/Users/esmael/meus_sistemas/audisped/speds/APACHE';
const CNPJ = '09153856000171';

function parseSped(content) {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    const result = { c100: [], c100_chaves: new Set(), r1300: {} };

    for (const line of lines) {
        const p = line.split('|');
        if (p.length < 3) continue;
        const reg = p[1];

        if (reg === 'C100') {
            result.c100.push(p);
            const chave = (p[9] || '').trim();
            if (chave && chave.length > 10) result.c100_chaves.add(chave);
        }
        if (reg === '1300') {
            // |1300|cod_item|dt_fech|estq_abert|vol_entr|vol_disp|vol_saidas|estq_escr|...
            const cod = (p[2] || '').trim();
            const dt = (p[3] || '').trim();
            const key = `${cod}_${dt}`;
            const saida = parseFloat((p[7] || '0').replace(',', '.'));
            const entr = parseFloat((p[5] || '0').replace(',', '.'));
            result.r1300[key] = { saida, entr, cod, dt };
        }
    }
    return result;
}

async function run() {
    const client = await pool.connect();
    try {
        const speds = await client.query(`
            SELECT id, periodo_apuracao, caminho_arquivo FROM sped_arquivos
            WHERE cnpj_empresa = $1 AND periodo_apuracao >= '2021-01' AND periodo_apuracao < '2026-01'
            ORDER BY periodo_apuracao
        `, [CNPJ]);

        const exportFiles = fs.readdirSync(EXPORT_DIR).filter(f => f.endsWith('.txt')).sort();

        console.log('VALIDAÇÃO: SPED ORIGINAL vs EXPORTADO — AUTO POSTO APACHE');
        console.log('='.repeat(80));

        let totalOk = 0, totalErros = 0;
        const errosGlobais = { chavesFaltando: 0, saidasDiff: 0, entDiff: 0 };

        // Mapear exportados por período (MM-YYYY no nome)
        const exportMap = {};
        for (const f of exportFiles) {
            const m = f.match(/(\d{2})-(\d{4})/);
            if (m) exportMap[`${m[2]}-${m[1]}`] = f; // YYYY-MM
        }

        for (const sp of speds.rows) {
            const periodo = sp.periodo_apuracao.substring(0, 7); // YYYY-MM
            const exportFile = exportMap[periodo];

            if (!exportFile) {
                console.log(`[${periodo}] ⚠ SEM ARQUIVO EXPORTADO`);
                totalErros++;
                continue;
            }

            let origContent;
            try { origContent = fs.readFileSync(sp.caminho_arquivo, 'latin1'); }
            catch(e) { console.log(`[${periodo}] ERRO lendo original`); totalErros++; continue; }

            const expContent = fs.readFileSync(path.join(EXPORT_DIR, exportFile), 'latin1');
            const orig = parseSped(origContent);
            const exp = parseSped(expContent);

            const erros = [];

            // 1. NOTAS: verificar se TODAS as chaves do original estão no exportado
            const chavesFalt = [...orig.c100_chaves].filter(c => !exp.c100_chaves.has(c));
            if (chavesFalt.length > 0) {
                erros.push(`NOTAS FALTANDO: ${chavesFalt.length} chaves NF-e do original ausentes no exportado`);
                errosGlobais.chavesFaltando += chavesFalt.length;
            }

            // 2. ENTRADAS: comparar vol_entr por dia/produto
            let entDiff = 0;
            for (const [key, orig1300] of Object.entries(orig.r1300)) {
                const exp1300 = exp.r1300[key];
                if (exp1300 && Math.abs(orig1300.entr - exp1300.entr) > 0.1) {
                    entDiff++;
                }
            }
            if (entDiff > 0) {
                erros.push(`ENTRADAS: ${entDiff} dias com vol_entr diferente`);
                errosGlobais.entDiff += entDiff;
            }

            // 3. SAÍDAS: comparar (podem diferir pelo Re-distribuir, isso é ESPERADO)
            let saidaDiff = 0;
            let totalSaidaOrig = 0, totalSaidaExp = 0;
            for (const [key, orig1300] of Object.entries(orig.r1300)) {
                const exp1300 = exp.r1300[key];
                totalSaidaOrig += orig1300.saida;
                if (exp1300) {
                    totalSaidaExp += exp1300.saida;
                    if (Math.abs(orig1300.saida - exp1300.saida) > 0.1) saidaDiff++;
                }
            }

            // Resumo do mês
            if (erros.length === 0) {
                const saidaInfo = saidaDiff > 0 ? ` (saídas ajustadas: ${saidaDiff} dias)` : '';
                console.log(`[${periodo}] ✓ OK — ${orig.c100_chaves.size} notas, ${Object.keys(orig.r1300).length} dias LMC${saidaInfo}`);
                totalOk++;
            } else {
                console.log(`[${periodo}] ✗ DIVERGÊNCIAS:`);
                erros.forEach(e => console.log(`  ⚠ ${e}`));
                totalErros++;
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log(`RESULTADO: ${totalOk} OK | ${totalErros} com divergências`);
        console.log(`Notas faltando: ${errosGlobais.chavesFaltando} | Entradas diff: ${errosGlobais.entDiff}`);
        console.log('\nNOTA: Diferenças de SAÍDA são ESPERADAS (Re-distribuir ajusta vendas).');
        console.log('O importante é: NOTAS e ENTRADAS devem ser 100% iguais.');

    } finally {
        client.release();
        pool.end();
    }
}

run().catch(e => console.error(e));
