// CAD-0150-08 — COD_PART referenciado no registro 1601 (totais por instrumento de
// pagamento, ex.: maquininha/cartão) sem o cadastro 0150 do participante.
// O PVA exige: "Código inválido. Informar código no Registro 0150" — todo COD_PART
// citado em 1601 precisa ter um 0150 correspondente. A regra irmã CAD-0150-07 só
// cobre C100/D100; esta cobre o 1601 (COD_PART em f[2]).
// jaCorrigidoNoExport: o export injeta o 0150 faltante (deriva CNPJ do próprio COD_PART
// quando ele é um CNPJ/CPF e recupera o nome de sped_participantes em qualquer arquivo).
module.exports = {
    id: 'CAD-0150-08',
    bloco: '1',
    registro: '1601',
    titulo: 'Participante (COD_PART) do 1601 referenciado sem cadastro no 0150',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, a instituição/credenciadora de pagamento citada no registro 1601 (cartão/maquininha) precisa estar cadastrada no registro 0150. Cadastre o COD_PART faltante.',
    detectar(model) {
        const part0150 = new Set((model.porReg.get('0150') || []).map(l => String(l.f[2] || '').trim()));
        const erros = [];
        const jaAvisado = new Set();
        for (const l of (model.porReg.get('1601') || [])) {
            const cp = String(l.f[2] || '').trim();
            if (cp && !part0150.has(cp) && !jaAvisado.has(cp)) {
                jaAvisado.add(cp);
                erros.push({
                    bloco: '1', registro: '1601', linha: l.n,
                    campo: 'COD_PART', campoIdx: 2, valorAtual: cp,
                    detalhe: `COD_PART "${cp}" usado no 1601 não existe em nenhum 0150.`,
                });
            }
        }
        return erros;
    },
};
