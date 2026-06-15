// INV-E116-01 — Σ E116.VL_OR (obrigações do ICMS a recolher) deve = E110.VL_ICMS_RECOLHER (f13) +
// DEB_ESP (f15). PVA: "O somatório dos 'Valor da obrigação a recolher' dos E116 não é igual à soma
// do 'Valor total de ICMS a recolher' e 'extra-apuração' do E110."
// 1 E116 com VL_OR divergente → o export AJUSTA (recalcularE116) → jaCorrigidoNoExport por-erro.
// E116 AUSENTE (caso comum) ou VÁRIOS E116 → MANUAL: exige código de receita (COD_REC) e vencimento
// (DT_VCTO), que variam por empresa/período e não dá p/ fabricar — informar no ERP / cadastro.
// Posições E110: f13 VL_ICMS_RECOLHER, f15 DEB_ESP. E116: f3 VL_OR.
const c = (v) => Math.round((parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0) * 100);
const fmt = (ct) => (ct / 100).toFixed(2).replace('.', ',');

module.exports = {
    id: 'INV-E116-01',
    bloco: 'E',
    registro: 'E110',
    titulo: 'Somatório dos E116 (a recolher) diferente do ICMS a recolher do E110',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'O somatório dos VL_OR dos registros E116 (obrigações a recolher) deve ser igual ao ICMS a recolher (VL_ICMS_RECOLHER) + débitos especiais (DEB_ESP) do E110. Informe/ajuste o E116 com o código de receita (COD_REC) e o vencimento (DT_VCTO) corretos.',
    detectar(model) {
        const erros = [];
        const grupos = [];
        let cur = null;
        for (const l of model.linhas) {
            if (l.reg === 'E110') { if (cur) grupos.push(cur); cur = { linha: l.n, f: l.f, e116: [] }; }
            else if (l.reg === 'E116' && cur) { cur.e116.push(l.f); }
        }
        if (cur) grupos.push(cur);
        for (const g of grupos) {
            const f = g.f;
            if (f.length <= 13) continue;
            const target = c(f[13]) + (f.length > 15 ? c(f[15]) : 0);
            const soma = g.e116.reduce((s, ff) => s + c(ff[3]), 0);
            if (soma === target) continue;
            const auto = g.e116.length === 1; // 1 E116 → o export ajusta o VL_OR
            erros.push({
                bloco: 'E', registro: 'E110', linha: g.linha, campo: '(E116 VL_OR)',
                severidade: 'BLOQ', jaCorrigidoNoExport: auto,
                valorAtual: fmt(soma), valorSugerido: fmt(target),
                detalhe: g.e116.length === 0
                    ? `Falta o registro E116: o ICMS a recolher do E110 é ${fmt(target)} mas não há E116. Informe o E116 (código de receita + vencimento) no ERP.`
                    : `Σ E116.VL_OR (${fmt(soma)}) ≠ ICMS a recolher + extra-apuração do E110 (${fmt(target)}).`,
            });
        }
        return erros;
    },
};
