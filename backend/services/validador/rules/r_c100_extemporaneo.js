// DOC-C100-DTES-01 — C100 com DT_E_S (data de entrada/saída) posterior à data final do período.
// PVA: "Data inválida. Informar data menor ou igual à data final do Registro 0000." (e o erro
// irmão "documento fora do período → usar COD_SIT extemporânea 01/03/07"). Caso de exemplo 08/2025:
// |C100|...|30082025|03092025|... — DT_E_S 03/09/2025 num arquivo de Ago/2025.
// Posições C100: f[6]=COD_SIT, f[10]=DT_DOC, f[11]=DT_E_S. DT_FIN = model.dtFin (DDMMYYYY).
// NÃO auto-corrigível: a data certa é decisão fiscal (lançar no mês correto, ou ajustar a DT_E_S
// p/ dentro do período usando COD_SIT extemporânea). Sugere a DT_DOC quando ela está no período.
const ymd = (d) => { const s = String(d || '').trim(); return s.length === 8 ? s.slice(4, 8) + s.slice(2, 4) + s.slice(0, 2) : ''; };
const fmt = (d) => (d && d.length === 8) ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}` : (d || '');

module.exports = {
    id: 'DOC-C100-DTES-01',
    bloco: 'C',
    registro: 'C100',
    titulo: 'C100 com DT_E_S posterior à data final do período (documento extemporâneo)',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, a data de entrada/saída (DT_E_S) do C100 deve ser ≤ data final do período. Documento cuja entrada ocorreu após o período deve ser lançado na EFD do mês correto; se for lançamento extemporâneo no período, ajuste a DT_E_S para dentro do mês e use COD_SIT 01/03/07.',
    detectar(model) {
        const erros = [];
        const fimY = ymd(model.dtFin);
        if (!fimY) return erros;
        for (const l of (model.porReg.get('C100') || [])) {
            const dtes = String(l.f[11] || '').trim();
            if (dtes.length === 8 && ymd(dtes) > fimY) {
                const dtDoc = String(l.f[10] || '').trim();
                const sug = (dtDoc.length === 8 && ymd(dtDoc) <= fimY) ? dtDoc : model.dtFin;
                erros.push({
                    bloco: 'C', registro: 'C100', linha: l.n, campo: 'DT_E_S', campoIdx: 11,
                    severidade: 'BLOQ', valorAtual: dtes, valorSugerido: sug,
                    detalhe: `DT_E_S ${fmt(dtes)} é posterior à data final do período (${fmt(model.dtFin)}). Use data ≤ DT_FIN (ex.: a própria DT_DOC ${fmt(dtDoc)}) ou lance no mês correto. COD_SIT atual: ${l.f[6] || '?'}.`,
                });
            }
        }
        return erros;
    },
};
