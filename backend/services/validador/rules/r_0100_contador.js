// DOC-0100-CONTADOR-01 — registro 0100 (contabilista) sem CPF e/ou CRC. PVA: "Campo obrigatório."
// O CPF (do contabilista responsável) e o CRC (registro no Conselho) são obrigatórios mesmo quando o
// CNPJ do escritório está preenchido. São DADOS EXTERNOS ao .txt (não inferíveis) → classe MANUAL: o
// cliente cadastra no ERP (ou num cadastro de contador, p/ injetar igual às credenciadoras). NÃO é
// auto-corrigido no export hoje (jaCorrigidoNoExport=false). Layout 0100 (1-idx): f2 NOME, f3 CPF,
// f4 CRC, f5 CNPJ, f6 CEP, ... Caso: CASA DA BEBIDA 05/2026 (0100 CONTABILIDADE sem CPF/CRC).
module.exports = {
    id: 'DOC-0100-CONTADOR-01',
    bloco: '0',
    registro: '0100',
    titulo: 'Contabilista (0100) sem CPF e/ou CRC',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, no cadastro do contabilista (registro 0100), informe o CPF do responsável e o número do CRC. São obrigatórios mesmo quando o CNPJ do escritório está preenchido.',
    detectar(model) {
        const erros = [];
        for (const l of model.linhas) {
            if (l.reg !== '0100') continue;
            const cpf = String(l.f[3] || '').trim();
            const crc = String(l.f[4] || '').trim();
            if (cpf === '') erros.push({ bloco: '0', registro: '0100', linha: l.n, campo: 'CPF', campoIdx: 3, severidade: 'BLOQ', valorAtual: '(vazio)', detalhe: 'CPF do contabilista responsável é obrigatório no 0100.' });
            if (crc === '') erros.push({ bloco: '0', registro: '0100', linha: l.n, campo: 'CRC', campoIdx: 4, severidade: 'BLOQ', valorAtual: '(vazio)', detalhe: 'CRC (registro no Conselho Regional de Contabilidade) é obrigatório no 0100.' });
        }
        return erros;
    },
};
