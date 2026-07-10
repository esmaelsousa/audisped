// Validador — correções (overrides) que o cliente aplica e que o EXPORT consome.
// Princípio: o export NÃO reescreve a lógica de correção; ele só aplica os overrides desta
// tabela ANTES do recálculo de totalizadores. Com a tabela vazia → no-op → export byte-idêntico
// (garantido pelo arnês golden). Correção = DADO, não código paralelo.

async function ensureTabela(db) {
    await db.query(`
        CREATE TABLE IF NOT EXISTS val_correcoes (
            id SERIAL PRIMARY KEY,
            id_sped_arquivo INTEGER NOT NULL,
            regra_id      VARCHAR(40),
            registro      VARCHAR(8)  NOT NULL,
            chave_natural TEXT        NOT NULL,
            campo_idx     INTEGER     NOT NULL,
            valor_original  TEXT,
            valor_corrigido TEXT       NOT NULL,
            origem        VARCHAR(10) DEFAULT 'MANUAL',
            usuario_id    INTEGER,
            ativo         BOOLEAN     DEFAULT TRUE,
            criado_em     TIMESTAMP   DEFAULT NOW()
        )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_val_correcoes_arq ON val_correcoes (id_sped_arquivo) WHERE ativo`);
}

async function buscarCorrecoes(db, idArquivo) {
    try {
        const r = await db.query(`SELECT regra_id, registro, chave_natural, campo_idx, valor_corrigido, valor_original, origem FROM val_correcoes WHERE id_sped_arquivo = $1 AND ativo = TRUE`, [idArquivo]);
        return r.rows;
    } catch (e) {
        // Se a tabela ainda não existe (boot incompleto), trata como "sem correções" — nunca quebra o export.
        return [];
    }
}

// Chave natural de uma linha (para casar a correção independentemente do nº da linha, que muda
// no export por dedup/normalização). curChaveC100 = chave do C100 corrente (p/ filhos C1xx).
function chaveNatural(reg, f, curChaveC100) {
    switch (reg) {
        case '0000': return 'unico';
        // 0100 (contabilista): chaveado por CNPJ do escritório (f5) → NOME (f2) → único. Passa verbatim
        // no export (não reconstruído) → chave estável p/ editar CPF (f3)/CRC (f4) via val_correcoes.
        case '0100': return String(f[5] || '').replace(/\D/g, '') || String(f[2] || '').trim() || 'unico';
        case '0150':
        case '0200': return String(f[2] || '').trim();
        case 'C100': return String(f[9] || '').replace(/\D/g, '');
        case 'D100': return String(f[10] || '').replace(/\D/g, '');
        case 'C170': return curChaveC100 + '#' + String(f[2] || '').trim(); // chave da NF + NUM_ITEM
        case 'H005': return String(f[4] || '').trim() || 'unico'; // MOT_INV (estável; corrige DT_INV)
        case '1350': return String(f[2] || '').trim() || 'unico'; // SERIE da bomba (erro COMB-1350-1360-01 → chaveNatural=SERIE, casa o lacre de lmc_lacres)
        case '1360': return String(f[2] || '').trim() || 'unico'; // NUM_LACRE (corrige DT_APLICACAO)
        case 'C190': { // analítico: chave da NF + CST|CFOP|ALIQ (única por NF). Aplica correção de VL_ICMS/ALIQ/VL_RED_BC.
            const aliq = String(parseFloat(String(f[4] || '0').replace(',', '.')) || 0);
            return curChaveC100 + '#' + String(f[2] || '').trim() + '|' + String(f[3] || '').trim() + '|' + aliq;
        }
        default: return null; // registro ainda não suportado p/ correção por chave
    }
}

// H005 não tem chave única no SPED (MOT_INV pode repetir entre inventários do mesmo arquivo).
// Para uma correção manual de um inventário NÃO vazar para outro H005 de mesmo MOT_INV,
// desambiguamos por ORDEM de ocorrência: a 1ª ocorrência mantém a chave (MOT_INV) — compatível
// com correções já gravadas — e a 2ª+ recebe sufixo "#N". O contador é mantido pelo chamador,
// que varre o arquivo na mesma ordem (engine ao gerar a chave do erro, aplicar ao casar).
function ordinalH005(kn, contador) {
    const c = (contador.get(kn) || 0) + 1;
    contador.set(kn, c);
    return c > 1 ? kn + '#' + c : kn;
}

// Nome legível do campo (por registro:índice) para o relatório "o que foi corrigido".
const CAMPO_NOME = {
    'C100:12': 'VL_DOC', 'C100:16': 'VL_MERC', 'C100:20': 'VL_OUT_DA',
    'C170:10': 'CST_ICMS', 'C170:11': 'CFOP', 'C170:13': 'VL_BC_ICMS', 'C170:14': 'ALIQ_ICMS', 'C170:15': 'VL_ICMS', 'C170:37': 'COD_CTA',
    'C190:2': 'CST_ICMS', 'C190:3': 'CFOP', 'C190:4': 'ALIQ_ICMS', 'C190:6': 'VL_BC_ICMS', 'C190:7': 'VL_ICMS', 'C190:10': 'VL_RED_BC',
    '0000:10': 'IE', '0100:3': 'CPF (contabilista)', '0100:4': 'CRC', '0100:13': 'EMAIL (contabilista)', '0400:3': 'COD_NAT',
};
const nomeCampo = (reg, i) => CAMPO_NOME[`${reg}:${i}`] || ('campo ' + i);
// Descrição legível da regra do Validador (para o motivo no relatório).
const REGRA_DESC = {
    'DOC-C100-VLDOC-01': 'VL_DOC do C100 divergente (despesa acessória espúria zerada)',
    'DOC-C170-ICMSSEMBASE-01': 'ICMS/alíquota do C170 sem base tributável',
    'DOC-C190-ICMSSEMBASE-01': 'ICMS/alíquota do C190 sem base tributável',
    'DOC-C190-REDBC-01': 'VL_RED_BC sem redução de base de cálculo',
    'CADASTRO': 'Correção de dado cadastral (IE / contabilista)',
};
// Registra no changelog as correções aplicadas, AGRUPADAS por (registro, campo, valor, regra, origem)
// — ex.: 742 notas com o mesmo VL_OUT_DA→0,00 viram 1 linha "×742" (rica e legível, sem 742 linhas).
function logarAplicadas(lista, log) {
    const grupos = new Map();
    for (const a of lista) {
        const k = `${a.registro}|${a.campo_idx}|${a.depois}|${a.regra_id}|${a.origem}`;
        const g = grupos.get(k) || { registro: a.registro, campo_idx: a.campo_idx, depois: a.depois, regra_id: a.regra_id, origem: a.origem, qtd: 0, antes: new Set() };
        g.qtd++; g.antes.add(a.antes);
        grupos.set(k, g);
    }
    for (const g of grupos.values()) {
        const lote = g.origem === 'LOTE';
        const antes = g.antes.size === 1 ? [...g.antes][0] : `${g.qtd} valores`;
        log.add({
            registro: g.registro,
            regraId: g.regra_id || '',
            campo: nomeCampo(g.registro, g.campo_idx),
            antes, depois: g.depois,
            origem: 'manual',
            classe: 'fiscal-deterministico',
            qtd: g.qtd,
            motivo: `${REGRA_DESC[g.regra_id] || g.regra_id || 'correção do Validador'} — ${lote ? '“Corrigir todas as seguras”' : 'correção manual'}${g.qtd > 1 ? ` · ${g.qtd} ocorrência(s)` : ''}`,
        });
    }
}

// Aplica as correções in-place em outputLines (array de linhas pipe). Retorna nº de campos alterados.
// Se `log` (Changelog) for passado, registra o que foi aplicado (agrupado) para o relatório.
function aplicar(outputLines, correcoes, log) {
    if (!Array.isArray(outputLines) || !correcoes || !correcoes.length) return 0;
    const idx = new Map(); // "registro::chave_natural" -> [{campo_idx, valor_corrigido, ...}]
    for (const c of correcoes) {
        const k = c.registro + '::' + c.chave_natural;
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(c);
    }
    let aplicadas = 0;
    const aplicadasList = [];
    let curChaveC100 = '';
    const h005Cont = new Map();
    for (let i = 0; i < outputLines.length; i++) {
        const f = outputLines[i].split('|');
        const reg = f[1];
        if (reg === 'C100') curChaveC100 = String(f[9] || '').replace(/\D/g, '');
        let kn = chaveNatural(reg, f, curChaveC100);
        if (reg === 'H005' && kn != null) kn = ordinalH005(kn, h005Cont);
        if (kn == null || kn === '') continue; // [F4] nunca casar chave vazia (C100 de papel/avulsa) → correção na NF errada
        const cs = idx.get(reg + '::' + kn);
        if (!cs) continue;
        let mudou = false;
        for (const c of cs) {
            const ci = Number(c.campo_idx);
            if (Number.isInteger(ci) && ci > 0 && ci < f.length) {
                const antesReal = f[ci];
                f[ci] = String(c.valor_corrigido); aplicadas++; mudou = true;
                aplicadasList.push({ registro: c.registro, campo_idx: ci, antes: (c.valor_original != null ? String(c.valor_original) : antesReal), depois: String(c.valor_corrigido), regra_id: c.regra_id || '', origem: c.origem || 'MANUAL' });
            }
        }
        if (mudou) outputLines[i] = f.join('|');
    }
    if (log && aplicadasList.length) logarAplicadas(aplicadasList, log);
    return aplicadas;
}

module.exports = { ensureTabela, buscarCorrecoes, chaveNatural, ordinalH005, aplicar };
