// DOC-0100-CONTADOR-01 — registro 0100 (contabilista) sem CPF, CRC e/ou EMAIL. PVA: "Campo obrigatório."
// O CPF (do contabilista responsável), o CRC (registro no Conselho) e o EMAIL são obrigatórios mesmo
// quando o CNPJ do escritório está preenchido. São DADOS EXTERNOS ao .txt (não inferíveis) → classe
// MANUAL: o cliente cadastra no ERP (ou num cadastro de contador, p/ injetar igual às credenciadoras).
// NÃO é auto-corrigido no export hoje (jaCorrigidoNoExport=false). Layout 0100 (1-idx): f2 NOME, f3 CPF,
// f4 CRC, f5 CNPJ, f6 CEP, f7 END, f8 NUM, f9 COMPL, f10 BAIRRO, f11 FONE, f12 FAX, f13 EMAIL, f14 COD_MUN.
// Casos: CASA DA BEBIDA 05/2026 (0100 CONTABILIDADE sem CPF/CRC); AUTO POSTO AMARAL 06/2026 arq 1833
// (EMAIL vazio → PVA "13 - EMAIL: Campo obrigatório." — nosso validador passava por não checar o f13).
module.exports = {
    id: 'DOC-0100-CONTADOR-01',
    bloco: '0',
    registro: '0100',
    titulo: 'Contabilista (0100) sem CPF, CRC e/ou EMAIL',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, no cadastro do contabilista (registro 0100), informe o CPF do responsável, o número do CRC e o e-mail. São obrigatórios mesmo quando o CNPJ do escritório está preenchido.',
    detectar(model) {
        const erros = [];
        for (const l of model.linhas) {
            if (l.reg !== '0100') continue;
            const cpf = String(l.f[3] || '').trim();
            const crc = String(l.f[4] || '').trim();
            const email = String(l.f[13] || '').trim();
            if (cpf === '') erros.push({ bloco: '0', registro: '0100', linha: l.n, campo: 'CPF', campoIdx: 3, severidade: 'BLOQ', valorAtual: '(vazio)', detalhe: 'CPF do contabilista responsável é obrigatório no 0100.' });
            if (crc === '') erros.push({ bloco: '0', registro: '0100', linha: l.n, campo: 'CRC', campoIdx: 4, severidade: 'BLOQ', valorAtual: '(vazio)', detalhe: 'CRC (registro no Conselho Regional de Contabilidade) é obrigatório no 0100.' });
            if (email === '') erros.push({ bloco: '0', registro: '0100', linha: l.n, campo: 'EMAIL', campoIdx: 13, severidade: 'BLOQ', valorAtual: '(vazio)', detalhe: 'EMAIL do contabilista é obrigatório no 0100 (o PVA acusa "13 - EMAIL: Campo obrigatório.").' });
        }
        return erros;
    },
};
