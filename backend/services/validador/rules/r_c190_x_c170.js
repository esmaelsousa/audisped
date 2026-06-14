// DOC-C190-01 — Combinação CST_ICMS/CFOP/ALIQ do C190 (analítico) sem item (C170) correspondente
// na mesma NF. PVA: "Informar a combinação CST_ICMS/CFOP/ALIQ_ICMS no registro de Itens".
// Campeã de erros pós-injeção/relabel. CONSERVADOR: só NF-e (mod 55), não cancelada, e só quando
// a NF TEM C170 (perfil B / NFC-e podem ter C190 sem C170 → não cruza, evita falso-positivo).
// Posições: C170 → CST f[10], CFOP f[11], ALIQ f[14]; C190 → CST f[2], CFOP f[3], ALIQ f[4].
const na = (v) => String(parseFloat(String(v || '0').replace(',', '.')) || 0); // normaliza alíquota
const trinca = (cst, cfop, aliq) => `${(cst || '').trim()}|${(cfop || '').trim()}|${na(aliq)}`;

module.exports = {
    id: 'DOC-C190-01',
    bloco: 'C',
    registro: 'C190',
    titulo: 'Combinação CST/CFOP/ALIQ do C190 sem item (C170) correspondente',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, a tributação analítica (C190) tem de refletir os itens (C170): cada combinação CST/CFOP/alíquota do C190 precisa existir em pelo menos um item. Acerte o CST/CFOP dos itens e regenere.',
    detectar(model) {
        const erros = [];
        let cur = null;
        const flush = (doc) => {
            if (!doc || !doc.c100) return;
            if (doc.c100.f[5] !== '55') return;                       // só NF-e
            if (['02', '03', '04', '05'].includes(doc.c100.f[6])) return; // cancelada/denegada
            if (!doc.c170.length || !doc.c190.length) return;          // precisa ter ambos p/ cruzar
            const setC170 = new Set(doc.c170.map(l => trinca(l.f[10], l.f[11], l.f[14])));
            const visto = new Set();
            for (const c of doc.c190) {
                const tr = trinca(c.f[2], c.f[3], c.f[4]);
                if (!setC170.has(tr) && !visto.has(tr)) {
                    visto.add(tr);
                    erros.push({ bloco: 'C', registro: 'C190', linha: c.n, campo: 'CST/CFOP/ALIQ', valorAtual: tr.replace(/\|/g, ' / '), detalhe: `Combinação ${tr.replace(/\|/g, '/')} do C190 não existe em nenhum item (C170) da NF nº ${doc.c100.f[8] || '?'}.` });
                }
            }
        };
        for (const l of model.linhas) {
            if (l.reg === 'C100') { flush(cur); cur = { c100: l, c170: [], c190: [] }; }
            else if (cur && l.reg === 'C170') cur.c170.push(l);
            else if (cur && l.reg === 'C190') cur.c190.push(l);
            else if (l.reg[0] !== 'C') { flush(cur); cur = null; } // saiu do bloco C
        }
        flush(cur);
        return erros;
    },
};
