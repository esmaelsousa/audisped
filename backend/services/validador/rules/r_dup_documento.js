// DOC-DUP — Documento fiscal duplicado: mesma chave de acesso aparece em >1 C100 (NF-e)
// ou D100 (CT-e). Recorrente em postos pós-injeção de XML. PVA rejeita (duplicidade de chave).
module.exports = {
    id: 'DOC-DUP',
    bloco: 'C',
    registro: 'C100/D100',
    titulo: 'Documento fiscal duplicado (mesma chave de acesso)',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'Remova a duplicidade no ERP — a mesma NF-e/CT-e foi escriturada mais de uma vez. (No nosso export já é deduplicada por chave.)',
    detectar(model) {
        const erros = [];
        for (const [reg, ic] of [['C100', 9], ['D100', 10]]) {
            const visto = new Map();
            for (const l of (model.porReg.get(reg) || [])) {
                const ch = (l.f[ic] || '').replace(/\D/g, '');
                if (ch.length < 20) continue;
                if (visto.has(ch)) {
                    erros.push({ bloco: reg[0], registro: reg, linha: l.n, campo: 'CHV', valorAtual: ch, detalhe: `Chave duplicada (1ª ocorrência na linha ${visto.get(ch)}).` });
                } else {
                    visto.set(ch, l.n);
                }
            }
        }
        return erros;
    },
};
