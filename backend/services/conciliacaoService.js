// conciliacaoService.js
// Conciliação "Relação de NF-e da SEFAZ (CSV)" × escrituração de ENTRADAS (documentos_c100).
// Porta fiel da lógica do HTML "Central de Conciliação Fiscal", com as correções:
//   - matching primário por CHAVE (44 díg.); fallback numero+CNPJ emitente (nunca numero puro);
//   - ignora notas CANCELADAS/DENEGADAS do CSV (não viram "faltante");
//   - nota emitida pela PRÓPRIA empresa numa relação de destinadas = USO/CONSUMO (emitente==destinatário):
//     NÃO é descartada — é entrada legítima; vira faltante (marcada uso_consumo) se não escriturada;
//   - "encontrada" é avaliada contra TODA a escrituração da empresa (qualquer competência),
//     para que uma nota lançada em mês diferente vire "divergência de competência" e não "faltante".

const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '');

// Remove BOM (UTF-8 lido como latin1 = "ï»¿") e aspas que envolvem o campo ("153000" → 153000).
// CSVs "aspados" (ex.: reexportados pelo Excel) quebravam a leitura do valor (parseFloat('"153000"')=NaN→0).
function stripCell(s) {
    let v = String(s == null ? '' : s);
    v = v.replace(/^﻿/, '').replace(/^ï»¿/, '').trim();
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1).replace(/""/g, '"');
    return v.trim();
}

function parseNum(s) {
    if (s === undefined || s === null) return 0;
    s = s.toString().trim().replace(/[R$\s]/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    return parseFloat(s) || 0;
}

// Competência 'MM/YYYY' a partir de qualquer formato de data comum no CSV.
function compFromAnyDate(s) {
    if (!s) return '';
    s = s.toString().trim();
    let m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return m[2] + '/' + m[3];
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);        if (m) return m[2] + '/' + m[1];
    m = s.match(/(\d{2})-(\d{2})-(\d{4})/);        if (m) return m[2] + '/' + m[3];
    return '';
}
const ymFromComp = (comp) => comp ? (comp.split('/')[1] + comp.split('/')[0]) : ''; // 'MM/YYYY' -> 'YYYYMM'
const normHeader = (h) => (h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const monthNames = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const compLabel = (comp) => { if (!comp) return 'N/A'; const p = comp.split('/'); return monthNames[parseInt(p[0])] + '/' + p[1]; };
// Formata a data de emissão escriturada (dt_doc do C100) em DD/MM/AAAA. Aceita Date (pg), ISO ou DDMMAAAA.
function fmtDtDoc(d) {
    if (!d) return '';
    if (d instanceof Date) {
        return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    }
    const s = String(d);
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    m = s.match(/^(\d{2})(\d{2})(\d{4})$/);     if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    return s;
}
// CNPJ do emitente embutido na chave de acesso (posições 7–20, índice 6..20).
const cnpjEmitFromChave = (chave) => { const c = onlyDigits(chave); return c.length >= 20 ? c.substring(6, 20) : ''; };
const isCanceladaDenegada = (sit) => {
    const s = (sit || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.includes('cancel') || s.includes('deneg');
};

/**
 * Lê o conteúdo (string já decodificada em latin1) de um CSV da SEFAZ.
 * @returns { invoices, byChave, byNumero, total, periodLabel, minYM, maxYM }
 */
function parseSefazCsv(content) {
    const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('Arquivo SEFAZ vazio ou sem dados.');
    const headerLine = lines[0];
    const delim = (headerLine.split(';').length >= headerLine.split(',').length) ? ';' : ',';
    const header = headerLine.split(delim).map(h => normHeader(stripCell(h)));
    // Guard: recusa o PRÓPRIO resultado exportado (colunas "Categoria" + "Valor / Detalhe"), subido por engano.
    if (header.some(h => h.includes('categoria')) && header.some(h => h.includes('detalhe'))) {
        throw new Error('Este arquivo é um RESULTADO exportado do sistema (tem coluna "Categoria" / "Valor / Detalhe"), não a "Relação de NF-e" da SEFAZ. Baixe o CSV no portal da SEFAZ e suba esse.');
    }
    const find = (...keys) => { for (const k of keys) { const i = header.findIndex(h => h.includes(k)); if (i > -1) return i; } return -1; };
    const col = {
        num:        find('numero nf', 'numero nfe', 'numero', 'nf-e', 'nfe', 'numero do documento', 'num'),
        chave:      find('chave de acesso', 'chave'),
        valor:      find('valor total da nota', 'valor nota', 'valor total', 'valor'),
        data:       find('data de emissao', 'data emissao', 'data da emissao', 'emissao', 'data'),
        fornecedor: find('razao social emitente', 'razao social', 'emitente', 'fornecedor', 'nome'),
        situacao:   find('situacao', 'status')
    };
    const invoices = []; const byChave = new Map(); const byNumero = new Map();
    let total = 0, minYM = null, maxYM = null;
    for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(delim).map(stripCell);
        if (c.length < 3) continue;
        const numero = col.num > -1 ? onlyDigits(c[col.num]) : '';
        const chave  = col.chave > -1 ? onlyDigits(c[col.chave]) : '';
        if (!numero && !chave) continue;
        const valor = col.valor > -1 ? parseNum(c[col.valor]) : 0;
        const dataRaw = col.data > -1 ? (c[col.data] || '').trim() : '';
        const fornecedor = col.fornecedor > -1 ? (c[col.fornecedor] || '').trim() : 'N/A';
        const situacao = col.situacao > -1 ? (c[col.situacao] || '').trim() : '';
        const comp = compFromAnyDate(dataRaw);
        if (comp) { const ym = ymFromComp(comp); if (!minYM || ym < minYM) minYM = ym; if (!maxYM || ym > maxYM) maxYM = ym; }
        const inv = {
            numero, chave, valor, situacao, fornecedor,
            data: dataRaw.split(' ')[0], comp,
            cnpjEmit: cnpjEmitFromChave(chave)
        };
        invoices.push(inv); total += valor;
        if (chave && chave.length >= 20) byChave.set(chave, inv);
        if (numero && !byNumero.has(numero)) byNumero.set(numero, inv);
    }
    let periodLabel = '';
    if (minYM && maxYM) {
        const fmt = ym => monthNames[parseInt(ym.substring(4, 6))] + '/' + ym.substring(0, 4);
        periodLabel = minYM === maxYM ? fmt(minYM) : fmt(minYM) + ' a ' + fmt(maxYM);
    }
    return { invoices, byChave, byNumero, total, periodLabel, minYM, maxYM };
}

/**
 * Cruza o CSV da SEFAZ com a escrituração (entradas mod 55) já no banco.
 * @param {object} p
 * @param {object} p.csv        resultado de parseSefazCsv
 * @param {Array}  p.escrituradas linhas do banco: { chv_nfe, num_doc, vl_doc, periodo_apuracao, dt_doc, fornecedor, cnpj_fornecedor }
 * @param {string} p.cnpjEmpresa CNPJ (14 díg.) da empresa informante (p/ detectar saída)
 * @returns baldes + totais
 */
function conciliar({ csv, escrituradas, cnpjEmpresa, mesesComSped, escopoYM, incluirCanceladas }) {
    const cnpjEmp = onlyDigits(cnpjEmpresa);
    const minYM = csv.minYM, maxYM = csv.maxYM;
    // escopoYM (YYYYMM): quando definido (período do SPED aberto), concilia SÓ esse mês — útil p/
    // CSV semestral. As demais notas do CSV são ignoradas (não viram "faltante" nem "sem SPED").
    const escopo = escopoYM || null;
    // Competências (YYYYMM) que possuem SPED importado para a empresa. Notas do CSV cujo mês
    // NÃO está coberto não podem ser conferidas (sem escrituração) → não viram "faltante".
    const cobertura = mesesComSped instanceof Set ? mesesComSped : new Set(mesesComSped || []);
    const inRange = (ym) => escopo ? (ym === escopo) : ((!minYM || !maxYM) ? true : (ym && ym >= minYM && ym <= maxYM));

    // Índice da escrituração por chave (toda competência) e por numero+cnpjEmit (fallback).
    const escrByChave = new Map();
    const escrByNumEmit = new Map();
    const escrList = [];
    for (const r of escrituradas) {
        const chave = onlyDigits(r.chv_nfe);
        const numero = onlyDigits(r.num_doc);
        const valor = parseNum(r.vl_doc);
        // competência onde foi escriturada (do período do arquivo): "YYYY-MM-DD a ..." -> YYYYMM
        const pm = (r.periodo_apuracao || '').match(/(\d{4})-(\d{2})-\d{2}/);
        const periodoYM = pm ? (pm[1] + pm[2]) : '';
        const cnpjEmit = cnpjEmitFromChave(chave);
        const item = { chave, numero, valor, periodoYM, cnpjEmit, dtDoc: r.dt_doc, dtES: r.dt_e_s, fornecedor: r.fornecedor || r.cnpj_fornecedor || 'N/A' };
        escrList.push(item);
        if (chave && chave.length >= 20 && !escrByChave.has(chave)) escrByChave.set(chave, item);
        if (numero && cnpjEmit) { const k = numero + '|' + cnpjEmit; if (!escrByNumEmit.has(k)) escrByNumEmit.set(k, item); }
    }

    const faltantes = [], divergencia_valor = [], divergencia_competencia = [], sem_sped = [], canceladas = [];
    let ignoradas_canceladas = 0, uso_consumo = 0, fora_escopo = 0;
    const csvChaves = new Set();

    for (const inv of csv.invoices) {
        const invYM = ymFromComp(inv.comp);
        if (escopo) {
            // Escopo no período do SPED aberto: nota de outro mês do CSV é ignorada (não é faltante).
            if (invYM && invYM !== escopo) { fora_escopo++; continue; }
        } else if (invYM && !cobertura.has(invYM)) {
            // Sem escopo fixo: mês sem SPED importado → balde "sem_sped" (não é faltante).
            sem_sped.push({ numero: inv.numero, chave: inv.chave, comp: compLabel(inv.comp), data: inv.data, valor: inv.valor, fornecedor: inv.fornecedor });
            continue;
        }
        if (inv.chave && inv.chave.length >= 20) csvChaves.add(inv.chave);
        if (isCanceladaDenegada(inv.situacao)) {
            ignoradas_canceladas++;
            canceladas.push({ numero: inv.numero, chave: inv.chave, comp: compLabel(inv.comp), data: inv.data, valor: inv.valor, fornecedor: inv.fornecedor });
            if (!incluirCanceladas) continue; // padrão: desconsiderar canceladas (não viram faltante)
        }
        // Emitente == empresa numa relação de destinadas = nota de USO/CONSUMO (emitente=destinatário).
        // NÃO descartar: é entrada legítima que deve ser escriturada. Apenas marca para a UI distinguir.
        const usoConsumo = !!(cnpjEmp && inv.cnpjEmit && inv.cnpjEmit === cnpjEmp);
        if (usoConsumo) uso_consumo++;

        let hit = (inv.chave && inv.chave.length >= 20) ? escrByChave.get(inv.chave) : null;
        if (!hit && inv.numero && inv.cnpjEmit) hit = escrByNumEmit.get(inv.numero + '|' + inv.cnpjEmit);

        if (!hit) {
            faltantes.push({ numero: inv.numero, chave: inv.chave, comp: compLabel(inv.comp), valor: inv.valor, data: inv.data, fornecedor: inv.fornecedor, uso_consumo: usoConsumo });
            continue;
        }
        if (Math.abs(inv.valor - hit.valor) > 0.01) {
            divergencia_valor.push({ numero: inv.numero, chave: inv.chave, fornecedor: inv.fornecedor, valorSefaz: inv.valor, valorSped: hit.valor, dif: inv.valor - hit.valor, data: inv.data, dataSped: fmtDtDoc(hit.dtES) || fmtDtDoc(hit.dtDoc) || '' });
        }
        const csvYM = ymFromComp(inv.comp);
        if (csvYM && hit.periodoYM && csvYM !== hit.periodoYM) {
            const fmt = (ym) => ym ? (monthNames[parseInt(ym.substring(4, 6))] + '/' + ym.substring(0, 4)) : 'N/A';
            // Lançada noutra competência: NÃO é omissão (a NF está escriturada, só em outro mês).
            // dataSped = data exata de ENTRADA (dt_e_s) do C100 escriturado. Sem ela, cai p/ a
            // competência (mês) — nunca p/ dt_doc, que é a emissão e enganaria ("lançada=emitida").
            const dataSped = fmtDtDoc(hit.dtES) || fmt(hit.periodoYM);
            divergencia_competencia.push({ numero: inv.numero, chave: inv.chave, fornecedor: inv.fornecedor, valor: inv.valor, data: inv.data, compSefaz: fmt(csvYM), compSped: fmt(hit.periodoYM), dataSped });
        }
    }

    // Extras: escriturado dentro do range do CSV cuja chave não aparece no CSV.
    const extras = [];
    for (const e of escrList) {
        if (!e.chave || e.chave.length < 20) continue;
        if (csvChaves.has(e.chave)) continue;
        if (!inRange(e.periodoYM)) continue;
        extras.push({ numero: e.numero, chave: e.chave, comp: e.periodoYM ? (monthNames[parseInt(e.periodoYM.substring(4, 6))] + '/' + e.periodoYM.substring(0, 4)) : 'N/A', data: fmtDtDoc(e.dtDoc), valor: e.valor, fornecedor: e.fornecedor });
    }

    const totalSefazValido = csv.invoices
        .filter(i => !isCanceladaDenegada(i.situacao))
        .reduce((a, i) => a + i.valor, 0);

    // Meses do período do CSV que NÃO têm SPED importado (para alertar o usuário).
    const enumMonths = (a, b) => {
        const out = []; if (!a || !b) return out;
        let y = parseInt(a.substring(0, 4)), m = parseInt(a.substring(4, 6));
        const ey = parseInt(b.substring(0, 4)), em = parseInt(b.substring(4, 6));
        while (y < ey || (y === ey && m <= em)) { out.push(String(y) + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } if (out.length > 120) break; }
        return out;
    };
    const csvMonths = enumMonths(minYM, maxYM);
    const fmtMes = (ym) => monthNames[parseInt(ym.substring(4, 6))] + '/' + ym.substring(0, 4);
    // Com escopo no período do SPED, não há "sem SPED" (o mês conferido tem SPED por definição).
    const meses_sem_sped = escopo ? [] : csvMonths.filter(m => !cobertura.has(m)).map(fmtMes);
    const sem_sped_total = !escopo && csvMonths.length > 0 && csvMonths.every(m => !cobertura.has(m));

    return {
        periodo: csv.periodLabel,
        periodo_escopo: escopo ? fmtMes(escopo) : null,
        totais: {
            sefaz_notas: csv.invoices.length,
            sefaz_valido: csv.invoices.length - ignoradas_canceladas - fora_escopo,
            sefaz_valor: totalSefazValido,
            escrituradas_no_range: escrList.filter(e => inRange(e.periodoYM)).length,
            faltantes: faltantes.length,
            faltantes_valor: faltantes.reduce((a, f) => a + (Number(f.valor) || 0), 0),
            divergencia_valor: divergencia_valor.length,
            divergencia_competencia: divergencia_competencia.length,
            extras: extras.length,
            sem_sped: sem_sped.length,
            fora_escopo,
            ignoradas_canceladas, uso_consumo,
            canceladas: canceladas.length
        },
        incluiu_canceladas: !!incluirCanceladas,
        meses_sem_sped, sem_sped_total,
        faltantes, divergencia_valor, divergencia_competencia, extras, sem_sped, canceladas
    };
}

/**
 * Adapta linhas do `mde_cache` (captura EspiãoNFe live) para o MESMO shape do parseSefazCsv,
 * para alimentar conciliar() a partir da SEFAZ ao vivo (sem CSV manual). Só considera ENTRADAS
 * (destinadas). Colunas esperadas do mde_cache: chave_nfe, numero, valor, data_emissao,
 * nome_emissor, tipo_operacao ('Entrada'|'Saída'|'Desconhecido'), status_manifesto.
 * @returns { invoices, byChave, byNumero, total, periodLabel, minYM, maxYM }  (idêntico ao parseSefazCsv)
 */
function sefazShapeFromMdeCache(rows) {
    const invoices = []; const byChave = new Map(); const byNumero = new Map();
    let total = 0, minYM = null, maxYM = null;
    for (const r of (rows || [])) {
        // Ignora emissões próprias (saídas): a conciliação de entradas cruza destinadas × C100 (ind_oper=0).
        const tipo = (r.tipo_operacao || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (tipo.startsWith('said')) continue;
        const chave = onlyDigits(r.chave_nfe);
        const numero = onlyDigits(r.numero || '');
        if (!numero && !chave) continue;
        const valor = parseNum(r.valor);
        const dataRaw = (r.data_emissao || '').toString().trim();
        const fornecedor = (r.nome_emissor || '').toString().trim() || 'N/A';
        // mde_cache não guarda situação cancelada/denegada; se um dia guardar, mapear aqui.
        const situacao = (r.situacao || '').toString().trim();
        const comp = compFromAnyDate(dataRaw);
        if (comp) { const ym = ymFromComp(comp); if (ym) { if (!minYM || ym < minYM) minYM = ym; if (!maxYM || ym > maxYM) maxYM = ym; } }
        const inv = {
            numero, chave, valor, situacao, fornecedor,
            data: dataRaw.split(' ')[0].split('T')[0], comp,
            cnpjEmit: cnpjEmitFromChave(chave)
        };
        invoices.push(inv); total += valor;
        if (chave && chave.length >= 20) byChave.set(chave, inv);
        if (numero && !byNumero.has(numero)) byNumero.set(numero, inv);
    }
    let periodLabel = '';
    if (minYM && maxYM) {
        const fmt = ym => monthNames[parseInt(ym.substring(4, 6))] + '/' + ym.substring(0, 4);
        periodLabel = minYM === maxYM ? fmt(minYM) : fmt(minYM) + ' a ' + fmt(maxYM);
    }
    return { invoices, byChave, byNumero, total, periodLabel, minYM, maxYM };
}

module.exports = { parseSefazCsv, conciliar, sefazShapeFromMdeCache };
