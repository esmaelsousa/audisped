// INV-E110-01 — Apuração ICMS (E110): os totais de ajuste devem casar com os E111 e o saldo
// (f11/f13/f14) deve refletir a apuração. PVA: "O valor deve corresponder à soma dos valores de
// ajustes do registro E111 (outros débitos/créditos)". A NATUREZA do ajuste é a 4ª posição do
// COD_AJ_APUR (charAt(3), validado em arquivos BA reais): '0'→f4, '1'→f5, '2'→f8, '3'→f9.
// jaCorrigidoNoExport (recalcularE110 recompõe no download). Layout E110 (1-idx): 2 TOT_DEB,
// 3 AJ_DEB, 4 TOT_AJ_DEB, 5 ESTORNOS_CRED, 6 TOT_CRED, 7 AJ_CRED, 8 TOT_AJ_CRED, 9 ESTORNOS_DEB,
// 10 SLD_CREDOR_ANT, 11 SLD_APURADO, 12 TOT_DED, 13 ICMS_RECOLHER, 14 SLD_CREDOR_TRANSP, 15 DEB_ESP.
const c = (v) => Math.round((parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0) * 100);
const fmt = (ct) => (ct / 100).toFixed(2).replace('.', ',');
const NAT = { '0': 4, '1': 5, '2': 8, '3': 9 };

module.exports = {
    id: 'INV-E110-01',
    bloco: 'E',
    registro: 'E110',
    titulo: 'Apuração ICMS (E110): totais de ajuste/saldo incoerentes com os E111',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, os campos de ajuste do E110 (VL_TOT_AJ_DEBITOS/CREDITOS e estornos) devem ser a soma dos VL_AJ_APUR dos E111 por natureza (4ª posição do COD_AJ_APUR), e o saldo (apurado / ICMS a recolher / saldo credor a transportar) deve refletir a apuração.',
    detectar(model) {
        const erros = [];
        const grupos = [];
        let cur = null;
        for (const l of model.linhas) {
            if (l.reg === 'E110') { if (cur) grupos.push(cur); cur = { linha: l.n, f: l.f, soma: { 4: 0, 5: 0, 8: 0, 9: 0 }, tem: false }; }
            else if (l.reg === 'E111' && cur) { const campo = NAT[String(l.f[2] || '').charAt(3)]; if (campo) cur.soma[campo] += c(l.f[4]); cur.tem = true; }
        }
        if (cur) grupos.push(cur);
        for (const g of grupos) {
            const f = g.f;
            if (f.length <= 14) continue; // E110 truncado/atípico
            const exp = { 4: c(f[4]), 5: c(f[5]), 8: c(f[8]), 9: c(f[9]) };
            if (g.tem) { exp[4] = g.soma[4]; exp[5] = g.soma[5]; exp[8] = g.soma[8]; exp[9] = g.soma[9]; }
            const totDeb = c(f[2]) + c(f[3]) + exp[4] + exp[5];
            const totCred = c(f[6]) + c(f[7]) + exp[8] + exp[9];
            const base = totDeb - totCred - c(f[10]);
            const espMap = {
                4: exp[4], 5: exp[5], 8: exp[8], 9: exp[9],
                11: base >= 0 ? base : 0,
                // VL_ICMS_RECOLHER (13) = VL_SLD_APURADO (11) − VL_TOT_DED (12). NÃO somar DEB_ESP (15) —
                // é campo separado, recolhido via E116 (seria contado 2×). Alinhado ao recalcularE110 do export.
                13: base >= 0 ? Math.max(0, base - c(f[12])) : 0,
                14: base < 0 ? -base : 0,
            };
            const NOMES = { 4: 'VL_TOT_AJ_DEBITOS', 5: 'VL_ESTORNOS_CRED', 8: 'VL_TOT_AJ_CREDITOS', 9: 'VL_ESTORNOS_DEB', 11: 'VL_SLD_APURADO', 13: 'VL_ICMS_RECOLHER', 14: 'VL_SLD_CREDOR_TRANSPORTAR' };
            for (const k of [4, 5, 8, 9, 11, 13, 14]) {
                if (c(f[k]) !== espMap[k]) {
                    erros.push({
                        bloco: 'E', registro: 'E110', linha: g.linha, campo: NOMES[k], campoIdx: k,
                        severidade: 'BLOQ', valorAtual: fmt(c(f[k])), valorSugerido: fmt(espMap[k]),
                        detalhe: `${NOMES[k]} (${fmt(c(f[k]))}) ≠ esperado ${fmt(espMap[k])} (recalculado da soma dos E111 / cascata da apuração).`,
                    });
                }
            }
        }
        return erros;
    },
};
