// DOC-0200-DUP-01 — COD_ITEM duplicado no registro 0200. PVA: "Duplicidade de ocorrência da chave
// COD_ITEM." Cada produto deve ter um único 0200. O export deduplica (mantém o 1º, remove os repetidos
// + filhos) → jaCorrigidoNoExport. 0200 f2 = COD_ITEM. Caso real: RAQUEL 10/2022 (2 × "TBG 42,00MM...").
module.exports = {
    id: 'DOC-0200-DUP-01',
    bloco: '0',
    registro: '0200',
    titulo: 'COD_ITEM duplicado no 0200 (produto repetido)',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, cada produto deve ter um único cadastro 0200 (COD_ITEM único). Remova/funda os cadastros duplicados.',
    detectar(model) {
        const erros = [];
        const vistos = new Map();
        for (const l of (model.porReg.get('0200') || [])) {
            const cod = String(l.f[2] || '').trim();
            if (!cod) continue;
            if (vistos.has(cod)) {
                erros.push({ bloco: '0', registro: '0200', linha: l.n, campo: 'COD_ITEM', valorAtual: cod, detalhe: `COD_ITEM "${cod}" duplicado no 0200 (1ª ocorrência na linha ${vistos.get(cod)}). Cada produto deve ter um único 0200.` });
            } else vistos.set(cod, l.n);
        }
        return erros;
    },
};
