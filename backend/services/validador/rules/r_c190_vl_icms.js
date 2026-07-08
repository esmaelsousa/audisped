// DOC-C190-VLICMS-01 (E-Auditoria 2481) — VL_ICMS do C190 inconsistente.
//
// ⚠️ FÓRMULA CORRIGIDA PELO PAINEL (cross-empresa 2026-07-08 §3 — REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   O E-Auditoria compara VL_ICMS(C190) com round(BC×ALIQ) — mas isso é FISCALMENTE ERRADO: o C190 é
//   analítico e o valor correto é VL_ICMS(C190) = Σ VL_ICMS(C170) do mesmo CST|CFOP|ALIQ. A comparação
//   com BC×ALIQ gera falso-positivo em massa em NF multi-item (arredondamento agregado legítimo),
//   monofásico (ad rem), redução (CST 20/70), diferimento (CST 51) e Simples. Portanto comparamos
//   contra Σ VL_ICMS(C170) — que só acusa quando o C190 realmente diverge dos seus itens.
//   SÓ-DETECÇÃO (nunca auto-corrigir): subir 1 centavo cascatearia para o E110 (não re-derivado no
//   export) e romperia a apuração. O conserto certo é regerar no ERP. Sem campoIdx (não auto-corrigível).
//   Conservador (espelha DOC-C190-01): só NF-e mod 55 não cancelada, e só quando a NF tem C170 e C190.
const { toCents, fromCents } = require('../money');
const na = (v) => String(parseFloat(String(v || '0').replace(',', '.')) || 0); // normaliza alíquota
const trinca = (cst, cfop, aliq) => `${(cst || '').trim()}|${(cfop || '').trim()}|${na(aliq)}`;

module.exports = {
    id: 'DOC-C190-VLICMS-01',
    refEAuditoria: '2481',
    bloco: 'C',
    registro: 'C190',
    titulo: 'VL_ICMS do C190 não corresponde à soma do VL_ICMS dos itens (C170)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o VL_ICMS do registro analítico C190 deve ser a soma do VL_ICMS dos itens (C170) da mesma combinação CST/CFOP/alíquota. Recalcule e regenere para que a apuração (E110) volte a bater.',
    detectar(model) {
        const erros = [];
        let cur = null;
        const flush = (doc) => {
            if (!doc || !doc.c100) return;
            if (doc.c100.f[5] !== '55') return;                              // só NF-e
            if (['02', '03', '04', '05'].includes(doc.c100.f[6])) return;    // cancelada/denegada
            if (!doc.c170.length || !doc.c190.length) return;                // precisa ter ambos p/ cruzar
            const somaC170 = new Map();
            for (const l of doc.c170) {
                const tr = trinca(l.f[10], l.f[11], l.f[14]);
                somaC170.set(tr, (somaC170.get(tr) || 0) + toCents(l.f[15]));
            }
            for (const c of doc.c190) {
                const tr = trinca(c.f[2], c.f[3], c.f[4]);
                if (!somaC170.has(tr)) continue;                             // ausência é o DOC-C190-01, não aqui
                const esperado = somaC170.get(tr);
                const declarado = toCents(c.f[7]);
                if (Math.abs(esperado - declarado) >= 1) {
                    erros.push({ bloco: 'C', registro: 'C190', linha: c.n, campo: 'VL_ICMS', valorAtual: c.f[7], detalhe: `VL_ICMS do C190 ${c.f[7]} ≠ Σ VL_ICMS dos itens ${fromCents(esperado)} (combinação ${tr.replace(/\|/g, '/')}, NF ${doc.c100.f[8] || '?'}).` });
                }
            }
        };
        for (const l of model.linhas) {
            if (l.reg === 'C100') { flush(cur); cur = { c100: l, c170: [], c190: [] }; }
            else if (cur && l.reg === 'C170') cur.c170.push(l);
            else if (cur && l.reg === 'C190') cur.c190.push(l);
            else if (l.reg[0] !== 'C') { flush(cur); cur = null; }
        }
        flush(cur);
        return erros;
    },
};
