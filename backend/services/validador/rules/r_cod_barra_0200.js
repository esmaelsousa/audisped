// DOC-0200-GTIN-01 — COD_BARRA (campo 4 do 0200) deve ser NUMÉRICO (GTIN) ou VAZIO.
// PVA: "Código de barras inválido" quando o campo contém texto (ex.: "SEM GTIN", o próprio nome
// do produto). Caso de exemplo 01/2023: |0200|CANETA BIC CRISTAL|...|SEM GTIN|...
// É EDITÁVEL pelo usuário: apagar o texto (deixa vazio = produto sem GTIN, válido) OU digitar um
// GTIN. corrigível por campo (campoIdx=4, chaveNatural=COD_ITEM); permiteVazio (apagar é a correção
// comum). NÃO auto-corrige (jaCorrigidoNoExport=false) — o usuário decide apagar ou informar o GTIN.
// Posições 0200: f2 COD_ITEM, f3 DESCR_ITEM, f4 COD_BARRA.
// GTIN válido: 8/12/13/14 dígitos com dígito verificador mod-10 (pesos 3/1 da direita p/ esquerda).
function gtinValido(s) {
    if (!/^\d+$/.test(s)) return false;
    if (![8, 12, 13, 14].includes(s.length)) return false;
    const d = s.split('').map(Number);
    const check = d.pop();
    let soma = 0, w = 3;
    for (let i = d.length - 1; i >= 0; i--) { soma += d[i] * w; w = (w === 3 ? 1 : 3); }
    return ((10 - (soma % 10)) % 10) === check;
}
module.exports = {
    id: 'DOC-0200-GTIN-01',
    bloco: '0',
    registro: '0200',
    titulo: 'Código de barras (COD_BARRA) inválido no 0200 — deve ser numérico (GTIN) ou vazio',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o Código de Barras (GTIN) do produto deve conter apenas o número do GTIN (8/12/13/14 dígitos) ou ficar VAZIO quando o produto não tem GTIN. Remova textos como "SEM GTIN".',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('0200') || [])) {
            const cb = String(l.f[4] || '').trim();
            if (cb === '') continue;
            if (!/^\d+$/.test(cb)) {
                erros.push({
                    bloco: '0', registro: '0200', linha: l.n, campo: 'COD_BARRA', campoIdx: 4,
                    severidade: 'BLOQ', permiteVazio: true, valorAtual: cb, valorSugerido: '',
                    detalhe: `COD_BARRA "${cb}" não é numérico. Deve ser um GTIN (só dígitos) ou ficar VAZIO (produto sem código de barras).`,
                });
            } else if (!gtinValido(cb)) {
                // numérico porém não forma um GTIN válido (comprimento ∉ {8,12,13,14} ou DV incorreto) →
                // o PVA também rejeita. ADV (não BLOQ) para não inundar de bloqueantes em bases reais.
                erros.push({
                    bloco: '0', registro: '0200', linha: l.n, campo: 'COD_BARRA', campoIdx: 4,
                    severidade: 'ADV', permiteVazio: true, valorAtual: cb, valorSugerido: '',
                    detalhe: `COD_BARRA "${cb}" não é um GTIN válido (comprimento deve ser 8/12/13/14 e o dígito verificador conferir). Corrija o GTIN ou deixe VAZIO.`,
                });
            }
        }
        return erros;
    },
};
