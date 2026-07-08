// Importador de valores de notas CFOP 5929 ("venda com cupom") — Analisador.
// Notas 5929 (NF-e mod 55 espelho de cupom) vêm ZERADAS no SPED de origem (vl_doc=0, vl_opr=0).
// Este módulo lê o relatório de NOTAS EMITIDAS do ERP (CSV/TXT) e casa por NÚMERO+SÉRIE com as
// notas 5929 do arquivo, devolvendo um relatório classificado. A GRAVAÇÃO (overrides em
// vl_doc_ajustado / vl_opr_ajustado) é feita no endpoint; o EXPORT já aplica esses overrides
// automaticamente (server.js ~8585 C100, ~8669 C190). Original preservado → reversível.
//
// PURO: sem IO e sem banco. Determinístico e testável.

// "1.773,65" / "43" / "30183,3" -> número. Aceita também ponto-decimal já normalizado.
function brNum(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return NaN;
    // BR: tem vírgula → vírgula é decimal e ponto é milhar. Sem vírgula → ponto é decimal.
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Parser do relatório do ERP. Encontra a linha de cabeçalho (Número;Série;Modelo;…;Valor;Situação),
// mapeia as colunas por NOME (robusto a TXT/CSV e a colunas a mais/menos) e lê as linhas de dados
// até o "Total". Retorna { linhas:[{num,serie,modelo,emissao,dest,cfop,valor,situacao}], total, count, ignoradas }.
function parseRelatorio5929(content) {
    const raw = String(content).split(/\r?\n/);
    // delimitador: ; predominante (formato do exemplo); fallback p/ tab
    const delim = (raw.join('\n').match(/;/g) || []).length >= (raw.join('\n').match(/\t/g) || []).length ? ';' : '\t';

    // acha o cabeçalho. Detecção robusta a encoding: 'modelo' e 'valor' não têm acento, então
    // sobrevivem a latin1/utf-8; o número da nota ("Número") pode vir acentuado e mangled.
    let hdrIdx = -1, cols = null;
    for (let i = 0; i < raw.length; i++) {
        const cells = raw[i].split(delim).map(norm);
        const temValor = cells.some(c => c.includes('valor'));
        const temAncora = cells.some(c => c === 'modelo' || c.startsWith('numero') || c.includes('mero'));
        if (temValor && temAncora) { hdrIdx = i; cols = cells; break; }
    }
    if (hdrIdx < 0) throw new Error('cabeçalho não encontrado (esperado uma linha com "Modelo" e "Valor").');

    const findCol = (...alts) => cols.findIndex(c => alts.some(a => c === a || c.startsWith(a)));
    // Por nome (latin1 ok); fallback p/ posição fixa do layout padrão
    // (Número;Série;Modelo;Emissão;Destinatário;Forma;CFOP;Natureza;Valor;Situação) — robusto a encoding.
    const at = (byName, fixed) => (byName >= 0 ? byName : fixed);
    const iNum = at(findCol('numero') >= 0 ? findCol('numero') : cols.findIndex(c => c.includes('mero')), 0);
    const iSerie = at(findCol('serie'), 1);
    const iModelo = at(findCol('modelo'), 2);
    const iEmiss = at(findCol('emissao') >= 0 ? findCol('emissao') : cols.findIndex(c => c.includes('miss')), 3);
    const iDest = findCol('destinatario', 'cliente');
    const iCfop = findCol('cfop');
    const iValor = at(cols.findIndex(c => c.includes('valor')), cols.length - 2);
    const iSit = at(findCol('situacao', 'status') >= 0 ? findCol('situacao', 'status') : cols.findIndex(c => c.includes('itua')), cols.length - 1);

    const linhas = [];
    let total = 0, ignoradas = 0;
    for (let i = hdrIdx + 1; i < raw.length; i++) {
        const l = raw[i];
        if (!l || /^total/i.test(l.trim())) continue;
        const c = l.split(delim);
        if (c.length <= iValor) continue;
        const num = String(c[iNum] || '').trim();
        if (!num || !/^\d+$/.test(num)) continue;
        const valor = brNum(c[iValor]);
        if (isNaN(valor)) continue;
        const situacao = String(iSit >= 0 ? c[iSit] : 'APROVADA').trim();
        // só notas válidas (aprovadas/autorizadas); descarta cancelada/rejeitada/denegada
        if (!/aprovad|autoriz/i.test(situacao)) { ignoradas++; continue; }
        linhas.push({
            num,
            serie: String(iSerie >= 0 ? c[iSerie] : '').trim(),
            modelo: String(iModelo >= 0 ? c[iModelo] : '55').trim(),
            emissao: String(iEmiss >= 0 ? c[iEmiss] : '').trim(),
            dest: String(iDest >= 0 ? c[iDest] : '').trim(),
            cfop: String(iCfop >= 0 ? c[iCfop] : '').replace(/\D/g, ''),
            valor,
            situacao,
        });
        total += valor;
    }
    return { linhas, total: +total.toFixed(2), count: linhas.length, ignoradas };
}

// Casa as linhas do relatório com as notas 5929 do banco.
// notasDb: [{ id, num_doc, serie_chave, chv_nfe, qtd_c190 }] (uma por C100).
// Retorna baldes: casadas (1 C190 → injetável), multiC190 (precisa revisão), orfas (não está no SPED),
// noSpedSemCsv (no SPED mas não veio no relatório).
function casar(linhasRel, notasDb) {
    const dbByNum = new Map();
    for (const n of notasDb) {
        const k = String(n.num_doc).trim();
        if (!dbByNum.has(k)) dbByNum.set(k, []);
        dbByNum.get(k).push(n);
    }
    const casadas = [], multiC190 = [], orfas = [];
    const usados = new Set();
    for (const r of linhasRel) {
        const cand = dbByNum.get(r.num);
        if (!cand || !cand.length) { orfas.push(r); continue; }
        // desambigua por série quando houver mais de uma com o mesmo número
        let nota = cand.length === 1 ? cand[0]
            : (cand.find(x => parseInt(x.serie_chave, 10) === parseInt(r.serie || '-1', 10)) || cand[0]);
        usados.add(nota.id);
        const reg = { ...r, id: nota.id, chv_nfe: nota.chv_nfe, qtd_c190: nota.qtd_c190 };
        // TODAS as notas existentes no SPED são aplicáveis. As de múltiplos C190 também entram:
        // o valor total é lançado numa única linha C190 (a 1ª, menor id) e 0 nas demais, mantendo
        // C100 = Σ C190 (o relatório só traz o total da nota, sem quebra por CST). multiC190 é
        // listado à parte só para o usuário poder revisar a quebra por CST se quiser.
        casadas.push(reg);
        if (nota.qtd_c190 > 1) multiC190.push(reg);
    }
    const noSpedSemCsv = notasDb.filter(n => !usados.has(n.id));
    const somaCasadas = +casadas.reduce((s, x) => s + x.valor, 0).toFixed(2);
    const somaMulti = +multiC190.reduce((s, x) => s + x.valor, 0).toFixed(2);
    return {
        casadas, multiC190, orfas, noSpedSemCsv,
        resumo: {
            relTotalNotas: linhasRel.length,
            relValorTotal: +linhasRel.reduce((s, x) => s + x.valor, 0).toFixed(2),
            dbTotalNotas: notasDb.length,
            casadas: casadas.length, somaCasadas,
            multiC190: multiC190.length, somaMulti,
            orfas: orfas.length,
            noSpedSemCsv: noSpedSemCsv.length,
        },
    };
}

module.exports = { parseRelatorio5929, casar, brNum };
