// DOC-C170-C190-01 — direção INVERSA da DOC-C190-01: combinação CST_ICMS/CFOP/ALIQ de um ITEM (C170)
// que não existe em nenhum registro analítico (C190) da mesma NF. PVA: "Campo inválido. Informar a
// combinação CST_ICMS, CFOP, ALIQ_ICMS no registro de Itens" — a mesma mensagem dos dois lados.
//
// POR QUE EXISTE: o PVA cobra o casamento nos DOIS sentidos, e só tínhamos o sentido C190→C170.
// No relatório real do PVA do POSTO PREÇO BOM (CNPJ 50922123000158, 03/2026, arq 2521), dos 21 erros
// **13 eram deste lado** (C170 060/1652 e 400/1929 sem analítico) — invisíveis para o Validador.
// Quem produz o desencontro é o export, ao reescrever CST/CFOP do C170 a partir de
// documentos_itens_c170 sem realinhar o C190; por isso a regra rende principalmente no "Re-validar"
// (que valida o SPED exportado), e não no "Analisar" (que lê o .txt cru, em geral já casado).
//
// Mesmos gates CONSERVADORES da regra irmã: só NF-e (mod 55), não cancelada, e só quando a NF tem
// C170 E C190 (perfil B / NFC-e podem ter analítico sem item → não cruza, evita falso-positivo).
// Posições: C170 → CST f[10], CFOP f[11], ALIQ f[14]; C190 → CST f[2], CFOP f[3], ALIQ f[4].
const na = (v) => String(parseFloat(String(v || '0').replace(',', '.')) || 0); // normaliza alíquota
const trinca = (cst, cfop, aliq) => `${(cst || '').trim()}|${(cfop || '').trim()}|${na(aliq)}`;

module.exports = {
    id: 'DOC-C170-C190-01',
    bloco: 'C',
    registro: 'C170',
    titulo: 'Combinação CST/CFOP/ALIQ do item (C170) sem analítico (C190) correspondente',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, todo item (C170) tem de estar refletido na tributação analítica (C190): cada combinação CST/CFOP/alíquota dos itens precisa existir em um C190 da mesma nota. Acerte o CST/CFOP dos itens (ou do analítico) e regenere.',
    detectar(model) {
        const erros = [];
        let cur = null;
        const flush = (doc) => {
            if (!doc || !doc.c100) return;
            if (doc.c100.f[5] !== '55') return;                        // só NF-e
            if (['02', '03', '04', '05'].includes(doc.c100.f[6])) return; // cancelada/denegada
            if (!doc.c170.length || !doc.c190.length) return;           // precisa ter ambos p/ cruzar
            const setC190 = new Set(doc.c190.map(l => trinca(l.f[2], l.f[3], l.f[4])));
            const visto = new Set();
            for (const i of doc.c170) {
                const tr = trinca(i.f[10], i.f[11], i.f[14]);
                if (!setC190.has(tr) && !visto.has(tr)) {
                    visto.add(tr);
                    erros.push({ bloco: 'C', registro: 'C170', linha: i.n, campo: 'CST/CFOP/ALIQ', valorAtual: tr.replace(/\|/g, ' / '), detalhe: `Combinação ${tr.replace(/\|/g, '/')} do item ${i.f[2] || '?'} não existe em nenhum analítico (C190) da NF nº ${doc.c100.f[8] || '?'}.` });
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
