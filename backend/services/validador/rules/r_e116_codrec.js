// DOC-E116-CODREC-01 — E116 com COD_REC (código de receita) vazio. PVA: "Campo obrigatório."
// O E116 EXISTE mas o ERP não preencheu o código de receita (f5). O export preenche com o COD_REC
// global 0767 (ICMS regime normal BA; override por CNPJ em cad_apuracao_e116) → jaCorrigidoNoExport.
// Layout E116 (1-idx): f2 COD_OR, f3 VL_OR, f4 DT_VCTO, f5 COD_REC, ..., f10 MES_REF.
module.exports = {
    id: 'DOC-E116-CODREC-01',
    bloco: 'E',
    registro: 'E116',
    titulo: 'E116 sem COD_REC (código de receita da obrigação de ICMS)',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, informe o código de receita (COD_REC) da obrigação de ICMS no registro E116 (BA: 0767 = ICMS regime normal). Sem ele a guia/obrigação fica sem identificação de receita.',
    detectar(model) {
        const erros = [];
        for (const l of model.linhas) {
            if (l.reg !== 'E116') continue;
            if (l.f.length > 5 && String(l.f[5] || '').trim() === '') {
                erros.push({ bloco: 'E', registro: 'E116', linha: l.n, campo: 'COD_REC', campoIdx: 5, severidade: 'BLOQ', valorAtual: '(vazio)', valorSugerido: '0767', detalhe: `COD_REC é obrigatório no E116 — vazio na obrigação de R$ ${l.f[3] || '?'} (venc. ${l.f[4] || '?'}, ref. ${l.f[10] || '?'}).` });
            }
        }
        return erros;
    },
};
