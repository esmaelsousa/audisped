// CAD-0220-01 — Registro 0220 (fator de conversão) deve ter exatamente 3 campos:
// REG|UNID_CONV|FAT_CONV → linha `|0220|UNID|FAT|` → split('|') = 5 elementos.
// Pipe sobrando (`|0220|LT|1,0000||`) = 6 → PVA "nº de campos difere do leiaute (esperado 3)".
module.exports = {
    id: 'CAD-0220-01',
    bloco: '0',
    registro: '0220',
    titulo: 'Registro 0220 com nº de campos diferente do leiaute (esperado 3)',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, o 0220 deve ter 3 campos: REG|UNID_CONV|FAT_CONV. Remova o campo/pipe sobrando. (No nosso export já é normalizado automaticamente.)',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('0220') || [])) {
            if (l.f.length !== 5) {
                erros.push({
                    bloco: '0', registro: '0220', linha: l.n, campo: '(estrutura)',
                    valorAtual: l.raw,
                    valorSugerido: `|0220|${l.f[2] || ''}|${l.f[3] || ''}|`,
                    detalhe: `Esperado 3 campos (split=5); encontrado ${Math.max(0, l.f.length - 2)} campo(s) (split=${l.f.length}).`,
                });
            }
        }
        return erros;
    },
};
