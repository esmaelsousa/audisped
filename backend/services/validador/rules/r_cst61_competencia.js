// COMB-CST-01 — CST_ICMS terminando em 61 (monofásico, Conv. ICMS 199/2022) em competência
// anterior à vigência. CST 61 só passou a existir a partir de 2023-05 (diesel/biodiesel/GLP) e
// 2023-06 (gasolina/etanol). Conservador: qualquer x61 ANTES de 2023-05 é inválido (não existia).
// O export já rebaixa 61→60 nesse caso (_cst61to60); aqui é a DETECÇÃO.
const ehCst61 = (cst) => { const c = (cst || '').trim(); return c.length >= 2 && c.slice(-2) === '61'; };

module.exports = {
    id: 'COMB-CST-01',
    bloco: 'C',
    registro: 'C170/C190',
    titulo: 'CST_ICMS 61 (monofásico) em competência anterior à vigência',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, em competências anteriores a 05/2023 o combustível com ICMS-ST usa CST 60 (não 61). O CST 61 (monofásico) só vale a partir de 05/2023 (diesel/GLP) e 06/2023 (gasolina/etanol).',
    detectar(model) {
        const erros = [];
        const ym = model.periodoYM;
        if (!ym || ym >= '202305') return erros; // só competências < 2023-05 (61 não existia)
        for (const l of (model.porReg.get('C170') || [])) {
            if (ehCst61(l.f[10])) erros.push({ bloco: 'C', registro: 'C170', linha: l.n, campo: 'CST_ICMS', campoIdx: 10, valorAtual: l.f[10], valorSugerido: l.f[10].slice(0, -2) + '60', detalhe: `CST ${l.f[10]} (monofásico) não existia na competência ${ym.slice(4)}/${ym.slice(0, 4)}.` });
        }
        for (const l of (model.porReg.get('C190') || [])) {
            if (ehCst61(l.f[2])) erros.push({ bloco: 'C', registro: 'C190', linha: l.n, campo: 'CST_ICMS', campoIdx: 2, valorAtual: l.f[2], valorSugerido: l.f[2].slice(0, -2) + '60', detalhe: `CST ${l.f[2]} (monofásico) não existia na competência ${ym.slice(4)}/${ym.slice(0, 4)}.` });
        }
        return erros;
    },
};
