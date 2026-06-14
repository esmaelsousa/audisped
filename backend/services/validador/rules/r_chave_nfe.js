// DOC-C100-02 / DOC-D100-01 — Chave de acesso eletrônica: 44 dígitos + dígito verificador
// (módulo 11). Valida C100 (NF-e/NFC-e, modelo 55/65) e D100 (CT-e, 57/67). Pula documentos
// cancelados/denegados (COD_SIT 02–05). PVA: "CNPJ base da chave não confere" / chave inválida.
function dvChave(ch43) {
    let soma = 0, peso = 2;
    for (let i = ch43.length - 1; i >= 0; i--) {
        soma += parseInt(ch43[i]) * peso;
        peso = (peso === 9) ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return (resto === 0 || resto === 1) ? 0 : 11 - resto;
}

module.exports = {
    id: 'DOC-CHV-DV',
    bloco: 'C',
    registro: 'C100/D100',
    titulo: 'Chave de acesso inválida (44 dígitos / dígito verificador)',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'Corrija a chave de acesso no ERP: 44 dígitos com DV (44º) válido. Em geral é digitação manual ou XML corrompido na origem.',
    detectar(model) {
        const erros = [];
        const docs = [
            { reg: 'C100', ic: 9, mods: ['55', '65'], is: 6 },
            { reg: 'D100', ic: 10, mods: ['57', '67'], is: 6 },
        ];
        for (const d of docs) {
            for (const l of (model.porReg.get(d.reg) || [])) {
                const mod = l.f[5];
                const sit = l.f[d.is];
                if (!d.mods.includes(mod)) continue;
                if (!['00', '06', '07', '08'].includes(sit)) continue; // pula cancelado/denegado
                const ch = (l.f[d.ic] || '').replace(/\D/g, '');
                if (ch.length !== 44) {
                    erros.push({ bloco: d.reg[0], registro: d.reg, linha: l.n, campo: 'CHV', valorAtual: l.f[d.ic] || '(vazio)', detalhe: `A chave deve ter 44 dígitos (tem ${ch.length}).` });
                    continue;
                }
                const calc = dvChave(ch.slice(0, 43));
                if (calc !== parseInt(ch[43])) {
                    erros.push({ bloco: d.reg[0], registro: d.reg, linha: l.n, campo: 'CHV', valorAtual: ch, valorSugerido: ch.slice(0, 43) + calc, detalhe: `Dígito verificador inválido (informado ${ch[43]}, correto ${calc}).` });
                }
            }
        }
        return erros;
    },
};
