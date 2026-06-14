// DOC-C170-01 — COD_ITEM referenciado num C170 sem o cadastro 0200 correspondente.
// PVA: registro filho exige o item cadastrado. TRIM defensivo (SPED CHAR-fixo gera padding).
module.exports = {
    id: 'DOC-C170-01',
    bloco: 'C',
    registro: 'C170',
    titulo: 'Item (COD_ITEM) do C170 sem cadastro no 0200',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, todo item movimentado (C170) precisa estar cadastrado no registro 0200. Cadastre o COD_ITEM faltante.',
    detectar(model) {
        const itens0200 = new Set((model.porReg.get('0200') || []).map(l => String(l.f[2] || '').trim()));
        if (!itens0200.size) return []; // arquivo sem 0200 (não confundir com erro de item)
        const erros = [];
        const jaAvisado = new Set();
        for (const l of (model.porReg.get('C170') || [])) {
            const cod = String(l.f[3] || '').trim();
            if (cod && !itens0200.has(cod) && !jaAvisado.has(cod)) {
                jaAvisado.add(cod);
                erros.push({ bloco: 'C', registro: 'C170', linha: l.n, campo: 'COD_ITEM', valorAtual: cod, detalhe: `COD_ITEM "${cod}" usado no C170 não existe em nenhum 0200.` });
            }
        }
        return erros;
    },
};
