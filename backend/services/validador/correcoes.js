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
        const r = await db.query(`SELECT regra_id, registro, chave_natural, campo_idx, valor_corrigido FROM val_correcoes WHERE id_sped_arquivo = $1 AND ativo = TRUE`, [idArquivo]);
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
        case '0150':
        case '0200': return String(f[2] || '').trim();
        case 'C100': return String(f[9] || '').replace(/\D/g, '');
        case 'D100': return String(f[10] || '').replace(/\D/g, '');
        case 'C170': return curChaveC100 + '#' + String(f[2] || '').trim(); // chave da NF + NUM_ITEM
        case 'H005': return String(f[4] || '').trim() || 'unico'; // MOT_INV (estável; corrige DT_INV)
        default: return null; // registro ainda não suportado p/ correção por chave
    }
}

// Aplica as correções in-place em outputLines (array de linhas pipe). Retorna nº de campos alterados.
function aplicar(outputLines, correcoes) {
    if (!Array.isArray(outputLines) || !correcoes || !correcoes.length) return 0;
    const idx = new Map(); // "registro::chave_natural" -> [{campo_idx, valor_corrigido}]
    for (const c of correcoes) {
        const k = c.registro + '::' + c.chave_natural;
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(c);
    }
    let aplicadas = 0;
    let curChaveC100 = '';
    for (let i = 0; i < outputLines.length; i++) {
        const f = outputLines[i].split('|');
        const reg = f[1];
        if (reg === 'C100') curChaveC100 = String(f[9] || '').replace(/\D/g, '');
        const kn = chaveNatural(reg, f, curChaveC100);
        if (kn == null) continue;
        const cs = idx.get(reg + '::' + kn);
        if (!cs) continue;
        let mudou = false;
        for (const c of cs) {
            const ci = Number(c.campo_idx);
            if (Number.isInteger(ci) && ci > 0 && ci < f.length) { f[ci] = String(c.valor_corrigido); aplicadas++; mudou = true; }
        }
        if (mudou) outputLines[i] = f.join('|');
    }
    return aplicadas;
}

module.exports = { ensureTabela, buscarCorrecoes, chaveNatural, aplicar };
