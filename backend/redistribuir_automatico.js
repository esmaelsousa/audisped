/**
 * Re-distribuir Automatico
 *
 * Executa a sincronizacao de estoque (Re-distribuir) para todos os arquivos
 * de uma empresa, em ordem cronologica. Garante que:
 *   1) O fechamento do mes anterior vira abertura do mes atual
 *   2) O Motor V7 redistribui saidas/perdas/ganhos corretamente
 *   3) Os valores _ajustado ficam prontos para exportacao
 *
 * Uso:
 *   node redistribuir_automatico.js --cnpj 09153856000171
 *   node redistribuir_automatico.js --cnpj 09153856000171 --dry-run
 *   node redistribuir_automatico.js --cnpj 09153856000171 --ids 1326,1327,1328
 *
 * --cnpj OBRIGATORIO: CNPJ da empresa (com ou sem mascara)
 * --ids  OPCIONAL:    limitar a IDs especificos
 * --dry-run OPCIONAL: apenas mostra o que faria, sem alterar nada
 */

const http = require('http');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'audisped-safira-token-secret-2025';
const TOKEN = jwt.sign({ id: 1, nome: 'admin', email: 'admin@audisped.com' }, SECRET, { expiresIn: '24h' });
const HOST = 'localhost';
const PORT = process.env.PORT || 15435;

// ── Parse argumentos ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
const CNPJ_FILTRO = getArg('--cnpj');
const IDS_FILTRO = getArg('--ids') ? getArg('--ids').split(',').map(Number) : null;
const DRY_RUN = args.includes('--dry-run');

if (!CNPJ_FILTRO) {
    console.error('ERRO: --cnpj e obrigatorio.\n');
    console.error('Uso: node redistribuir_automatico.js --cnpj 09153856000171 [--dry-run] [--ids 1,2,3]');
    process.exit(1);
}

// ── Helpers HTTP ──────────────────────────────────────────────────────────────
function httpGet(path) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: HOST, port: PORT, path, method: 'GET',
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                try { resolve(JSON.parse(body)); } catch { resolve(body); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function httpPost(path, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http.request({
            hostname: HOST, port: PORT, path, method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + TOKEN,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                try { resolve(JSON.parse(body)); } catch { resolve(body); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// ── Buscar arquivos ordenados por periodo ─────────────────────────────────────
async function listarArquivos() {
    const res = await httpGet('/api/arquivos');
    let arquivos = res;
    if (!Array.isArray(arquivos)) {
        // Pode ser {arquivos: [...]} ou similar
        arquivos = res.arquivos || res.data || [];
    }

    // Filtrar por CNPJ se especificado
    if (CNPJ_FILTRO) {
        const cnpjNum = CNPJ_FILTRO.replace(/\D/g, '');
        arquivos = arquivos.filter(a => (a.cnpj_empresa || '').replace(/\D/g, '') === cnpjNum);
    }

    // Filtrar por IDs se especificado
    if (IDS_FILTRO) {
        arquivos = arquivos.filter(a => IDS_FILTRO.includes(a.id));
    }

    // Ordenar por CNPJ + periodo (cronologico)
    arquivos.sort((a, b) => {
        const cnpjA = (a.cnpj_empresa || '').replace(/\D/g, '');
        const cnpjB = (b.cnpj_empresa || '').replace(/\D/g, '');
        if (cnpjA !== cnpjB) return cnpjA.localeCompare(cnpjB);
        const pA = (a.periodo_apuracao || '').substring(0, 7);
        const pB = (b.periodo_apuracao || '').substring(0, 7);
        return pA.localeCompare(pB);
    });

    return arquivos;
}

// ── Processar um arquivo ──────────────────────────────────────────────────────
async function processarArquivo(arq, index, total) {
    const cnpj = (arq.cnpj_empresa || '').replace(/\D/g, '');
    const periodo = (arq.periodo_apuracao || '').substring(0, 7);
    const label = `[${index + 1}/${total}] ID=${arq.id} CNPJ=${cnpj} ${periodo}`;

    // 1. Verificar continuidade (divergencias entre meses)
    let continuidade;
    try {
        continuidade = await httpGet(`/api/lmc/continuidade/${arq.id}`);
    } catch (e) {
        console.log(`${label} — ERRO ao verificar continuidade: ${e.message}`);
        return { id: arq.id, status: 'erro_continuidade', erro: e.message };
    }

    const divergencias = continuidade.divergencias || [];

    if (divergencias.length === 0) {
        console.log(`${label} — Sem divergencias, estoque ja esta OK`);
        return { id: arq.id, status: 'sem_divergencia' };
    }

    // 2. Mostrar divergencias encontradas
    console.log(`${label} — ${divergencias.length} divergencia(s):`);
    for (const d of divergencias) {
        const nome = d.nome || d.cod_item;
        console.log(`    ${nome}: fech.anterior=${d.fechamento_anterior} → abert.atual=${d.abertura_atual} (dif=${d.diferenca})`);
    }

    if (DRY_RUN) {
        return { id: arq.id, status: 'dry_run', divergencias: divergencias.length };
    }

    // 3. Confirmar sincronizacao (Re-distribuir)
    const itens = divergencias.map(d => ({
        id_arquivo: arq.id,
        cod_item: d.cod_item,
        novo_estoque: parseFloat(d.fechamento_anterior)
    }));

    try {
        const resultado = await httpPost('/api/lmc/confirmar-sincronizacao', { itens });
        console.log(`${label} — Re-distribuido com sucesso: ${resultado.message || 'OK'}`);
        return { id: arq.id, status: 'redistribuido', divergencias: divergencias.length };
    } catch (e) {
        console.log(`${label} — ERRO ao re-distribuir: ${e.message}`);
        return { id: arq.id, status: 'erro_redistribuicao', erro: e.message };
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('='.repeat(70));
    console.log('  RE-DISTRIBUIR AUTOMATICO — Sincronizacao de Estoque em Lote');
    console.log('='.repeat(70));
    if (DRY_RUN) console.log('  ** MODO DRY-RUN: nenhuma alteracao sera feita **\n');
    console.log(`  Empresa (CNPJ): ${CNPJ_FILTRO}`);
    if (IDS_FILTRO) console.log(`  Filtro IDs: ${IDS_FILTRO.join(', ')}`);
    console.log(`  Servidor: ${HOST}:${PORT}`);
    console.log('');

    let arquivos;
    try {
        arquivos = await listarArquivos();
    } catch (e) {
        console.error('ERRO ao listar arquivos. O servidor esta rodando?');
        console.error(e.message);
        process.exit(1);
    }

    if (arquivos.length === 0) {
        console.log('Nenhum arquivo encontrado para os filtros informados.');
        process.exit(0);
    }

    console.log(`Processando ${arquivos.length} arquivo(s) em ordem cronologica...\n`);

    const resultados = [];
    for (let i = 0; i < arquivos.length; i++) {
        const r = await processarArquivo(arquivos[i], i, arquivos.length);
        resultados.push(r);
        // Delay entre arquivos para nao sobrecarregar
        if (i < arquivos.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    // ── Resumo ────────────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('  RESUMO');
    console.log('='.repeat(70));
    const sem = resultados.filter(r => r.status === 'sem_divergencia').length;
    const red = resultados.filter(r => r.status === 'redistribuido').length;
    const dry = resultados.filter(r => r.status === 'dry_run').length;
    const erros = resultados.filter(r => r.status.startsWith('erro'));

    console.log(`  Total processados:    ${resultados.length}`);
    console.log(`  Sem divergencia:      ${sem}`);
    console.log(`  Re-distribuidos:      ${red}`);
    if (dry > 0) console.log(`  Dry-run (pendentes):  ${dry}`);
    if (erros.length > 0) {
        console.log(`  Com erro:             ${erros.length}`);
        erros.forEach(e => console.log(`    ID=${e.id}: ${e.erro}`));
    }
    console.log('');

    if (red > 0 && !DRY_RUN) {
        console.log('  Os arquivos redistribuidos ja estao prontos para exportacao.');
        console.log('  Use export_lote.js para exportar em seguida.');
    }
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
