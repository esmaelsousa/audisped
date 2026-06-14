// INV-H005-01 — Inventário (H005): DT_INV deve ser MENOR OU IGUAL à data final do período
// (DT_FIN do registro 0000). PVA: "Data inválida. Informar data menor ou igual à data final do
// Registro 0000." (data do inventário no futuro = rejeição). Data de período ANTERIOR é válida
// (inventário extemporâneo), então só acusamos DT_INV > DT_FIN (ou ausente/malformada).
// Posições: H005 f2=DT_INV f3=VL_INV f4=MOT_INV ; DT_FIN = model.dtFin (DDMMYYYY, do 0000 f5).
const ymd = (d) => { const s = String(d || '').trim(); return s.length === 8 ? s.slice(4, 8) + s.slice(2, 4) + s.slice(0, 2) : ''; };
const fmt = (d) => (d && d.length === 8) ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}` : (d || '');

module.exports = {
    id: 'INV-H005-01',
    bloco: 'H',
    registro: 'H005',
    titulo: 'Data do inventário (H005) posterior à data final do período',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, a data do inventário (DT_INV do H005) tem de ser MENOR OU IGUAL à data final da escrituração (DT_FIN do 0000). Ajuste para uma data dentro do período (em geral o último dia do mês).',
    detectar(model) {
        const erros = [];
        const dtFin = String(model.dtFin || '').trim();
        const fimY = ymd(dtFin);
        for (const l of (model.porReg.get('H005') || [])) {
            const dtInv = String(l.f[2] || '').trim();
            if (dtInv.length !== 8) {
                erros.push({ bloco: 'H', registro: 'H005', linha: l.n, campo: 'DT_INV', campoIdx: 2, severidade: 'BLOQ', valorAtual: dtInv || '(vazio)', valorSugerido: dtFin, detalhe: `DT_INV ausente ou malformada (esperado DDMMYYYY).` });
                continue;
            }
            if (fimY && ymd(dtInv) > fimY) {
                erros.push({ bloco: 'H', registro: 'H005', linha: l.n, campo: 'DT_INV', campoIdx: 2, severidade: 'BLOQ', valorAtual: dtInv, valorSugerido: dtFin, detalhe: `DT_INV ${fmt(dtInv)} é posterior à data final do período (${fmt(dtFin)}). PVA exige data ≤ DT_FIN do 0000.` });
            }
        }
        return erros;
    },
};
