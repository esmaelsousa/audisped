// DOC-C170-CFOP-01 — CFOP do C170 (campo 11) inválido. CFOP válido = 4 dígitos começando em
// 1/2/3 (entrada) ou 5/6/7 (saída). Caso real (CABECEIRINHA 388): importação legada off-by-one
// gravou '0061' (o CST escrito no campo CFOP) em documentos_itens_c170, e o export reaplicava
// isso por cima do .txt correto → PVA "CFOP inválido" + "combinação CST/CFOP/ALIQ do C190 sem item".
// O export já corrige (guard anti-off-by-one ignora o banco corrompido e confia no .txt) →
// jaCorrigidoNoExport=true. Posições C170: f[10]=CST_ICMS, f[11]=CFOP, f[12]=COD_NAT.
const CFOP_OK = (v) => /^[1-7]\d{3}$/.test(String(v || '').trim());

module.exports = {
    id: 'DOC-C170-CFOP-01',
    bloco: 'C',
    registro: 'C170',
    titulo: 'CFOP inválido no item (C170, campo 11)',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, o CFOP do item (C170) deve ter 4 dígitos começando em 1/2/3 (entrada) ou 5/6/7 (saída). Um valor como "0061" é um CST gravado no campo errado (deslocamento de coluna).',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C170') || [])) {
            const cfop = String(l.f[11] || '').trim();
            if (CFOP_OK(cfop)) continue;
            const codNat = String(l.f[12] || '').trim();
            const sug = CFOP_OK(codNat) ? codNat : '';
            erros.push({
                bloco: 'C', registro: 'C170', linha: l.n, campo: 'CFOP', campoIdx: 11,
                severidade: 'BLOQ',
                valorAtual: cfop || '(vazio)',
                valorSugerido: sug || undefined,
                detalhe: `CFOP "${cfop}" inválido (deve ter 4 dígitos iniciando em 1/2/3/5/6/7).` +
                    (sug ? ` Provável CFOP correto: ${sug} (estava no COD_NAT por deslocamento de campo).` : ''),
            });
        }
        return erros;
    },
};
