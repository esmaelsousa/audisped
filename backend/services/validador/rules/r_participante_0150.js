// CAD-0150-07 — COD_PART referenciado em C100/D100 sem o cadastro 0150 do participante.
// NFC-e (mod 65) de saída costuma vir sem COD_PART (consumidor) → ignora vazio.
module.exports = {
    id: 'CAD-0150-07',
    bloco: '0',
    registro: '0150',
    titulo: 'Participante (COD_PART) referenciado sem cadastro no 0150',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, todo participante citado em documentos (C100/D100) precisa estar no registro 0150 (cadastro do fornecedor/cliente).',
    detectar(model) {
        const part0150 = new Set((model.porReg.get('0150') || []).map(l => String(l.f[2] || '').trim()));
        const erros = [];
        const jaAvisado = new Set();
        for (const [reg, ic] of [['C100', 4], ['D100', 4]]) {
            for (const l of (model.porReg.get(reg) || [])) {
                const cp = String(l.f[ic] || '').trim();
                if (cp && !part0150.has(cp) && !jaAvisado.has(reg + cp)) {
                    jaAvisado.add(reg + cp);
                    erros.push({ bloco: reg[0], registro: reg, linha: l.n, campo: 'COD_PART', valorAtual: cp, detalhe: `COD_PART "${cp}" usado em ${reg} não existe em nenhum 0150.` });
                }
            }
        }
        return erros;
    },
};
