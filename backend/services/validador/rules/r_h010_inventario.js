// INV-H010-01 — Bloco H (inventário): VL_INV do H005 deve ser igual à soma dos VL_ITEM
// dos H010 filhos (os H010 que seguem o H005 até o próximo H005). PVA: "O valor total do
// estoque (VL_INV do Registro H005) deve ser igual à soma dos valores dos itens (VL_ITEM)
// dos Registros H010."
// VL_INV é um total DERIVADO; o nosso export reescreve QTD/VL_ITEM dos H010 de combustível
// p/ o estoque físico ajustado do LMC e recalcula o VL_INV no download (recalcularVlInvH005)
// → jaCorrigidoNoExport. H020 NÃO soma; H010 de split por IND_PROP somam todos.
// Posições: H005 f2=DT_INV f3=VL_INV f4=MOT_INV ; H010 f2=COD_ITEM f3=UNID f4=QTD f5=VL_UNIT f6=VL_ITEM.
const num = (v) => parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0;
const fmt = (cents) => (cents / 100).toFixed(2).replace('.', ',');

module.exports = {
    id: 'INV-H010-01',
    bloco: 'H',
    registro: 'H005',
    titulo: 'Total do inventário (VL_INV do H005) diferente da soma dos itens (VL_ITEM dos H010)',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, o VL_INV do H005 deve ser exatamente a soma dos VL_ITEM de todos os H010 daquele inventário. (No nosso export o total é recalculado automaticamente no download.)',
    detectar(model) {
        const erros = [];
        const grupos = [];
        let cur = null;
        for (const l of model.linhas) {
            if (l.reg === 'H005') {
                if (cur) grupos.push(cur);
                cur = { linha: l.n, vlCents: Math.round(num(l.f[3]) * 100), somaCents: 0, n: 0 };
            } else if (l.reg === 'H010' && cur) {
                cur.somaCents += Math.round(num(l.f[6]) * 100);
                cur.n++;
            }
        }
        if (cur) grupos.push(cur);
        for (const g of grupos) {
            if (g.n === 0) continue; // H005 sem H010 → fora do escopo (completude é outro check)
            if (g.somaCents !== g.vlCents) {
                erros.push({
                    bloco: 'H', registro: 'H005', linha: g.linha, campo: 'VL_INV', campoIdx: 3,
                    severidade: 'BLOQ',
                    valorAtual: fmt(g.vlCents), valorSugerido: fmt(g.somaCents),
                    detalhe: `VL_INV (${fmt(g.vlCents)}) ≠ soma dos ${g.n} VL_ITEM dos H010 (${fmt(g.somaCents)}). PVA exige VL_INV = Σ VL_ITEM.`,
                });
            }
        }
        return erros;
    },
};
