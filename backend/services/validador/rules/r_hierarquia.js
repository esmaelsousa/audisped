// EST-HIER-01 — Registro filho órfão: um registro filho aparece sem que seu registro pai
// tenha ocorrido antes no arquivo. PVA: "exige a existência de um Registro Pai quando houver
// um Registro Filho". Conservador: só sinaliza quando NENHUM pai válido apareceu antes.
const PAIS = {
    C170: ['C100'], C190: ['C100'], C171: ['C170'], C175: ['C170'],
    '0205': ['0200'], '0206': ['0200'], '0221': ['0200'],
    1310: ['1300'], 1320: ['1310'], 1321: ['1320'], 1370: ['1350'],
    D190: ['D100'],
    E110: ['E100'], E111: ['E110'], E112: ['E111'], E113: ['E111'], E115: ['E111'], E116: ['E110'],
    E210: ['E200'], E220: ['E210'], E250: ['E210'],
    H010: ['H005'],
};

module.exports = {
    id: 'EST-HIER-01',
    bloco: '*',
    registro: '(vários)',
    titulo: 'Registro filho órfão (sem registro pai antes)',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o registro filho deve estar vinculado a um pai (ex.: C170 dentro de uma C100; 0206 dentro de um 0200). Regerar o arquivo costuma resolver.',
    detectar(model) {
        const erros = [];
        const visto = new Set();
        for (const l of model.linhas) {
            const pais = PAIS[l.reg];
            if (pais && !pais.some(p => visto.has(p))) {
                erros.push({ bloco: l.reg[0], registro: l.reg, linha: l.n, campo: '', valorAtual: l.reg, detalhe: `${l.reg} sem ${pais.join(' / ')} anterior no arquivo.` });
            }
            visto.add(l.reg);
        }
        return erros;
    },
};
