// DOC-D100-EMIT-01 — D100 com IND_EMIT=1 (emitido por terceiros) e IND_OPER≠0 (saída) é incoerente.
// PVA (ADVERTÊNCIA): "Documento fiscal emitido por terceiros deverá ter indicador de operação = Zero
// (entradas)." O export resolve de forma CFOP-aware (D190): CFOP saída (5/6/7) → emissão própria
// (IND_EMIT=0); CFOP entrada (1/2/3) → IND_OPER=0. D100: f2=IND_OPER, f3=IND_EMIT. Caso real:
// RAQUEL 05/2022 — 16 CT-e (mod 57) CFOP 5353 com IND_EMIT=1 (são saídas próprias → IND_EMIT=0).
module.exports = {
    id: 'DOC-D100-EMIT-01',
    bloco: 'D',
    registro: 'D100',
    titulo: 'D100 emitido por terceiros (IND_EMIT=1) com IND_OPER de saída',
    severidade: 'ADV',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, documento emitido por terceiros (IND_EMIT=1) é entrada (IND_OPER=0). Se o documento é de emissão própria (saída), ajuste IND_EMIT=0. O sistema corrige pelo CFOP no download.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('D100') || [])) {
            const indOper = String(l.f[2] || '').trim();
            const indEmit = String(l.f[3] || '').trim();
            if (indEmit === '1' && indOper !== '0') {
                erros.push({ bloco: 'D', registro: 'D100', linha: l.n, campo: 'IND_EMIT', campoIdx: 3, valorAtual: indEmit, detalhe: `Documento emitido por terceiros (IND_EMIT=1) com IND_OPER=${indOper} (saída). Doc de terceiros é entrada (IND_OPER=0); se for saída própria, IND_EMIT=0. Corrigido no download pelo CFOP.` });
            }
        }
        return erros;
    },
};
