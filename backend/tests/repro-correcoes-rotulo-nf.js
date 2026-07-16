// tests/repro-correcoes-rotulo-nf.js — rótulo NF+data+item da lista "Correções a aplicar".
// A chave_natural (44 díg. + #item) vira "NF <nNF> · <dd/mm/aaaa> · item <n>"; a data vem do C100.
// Uso: node tests/repro-correcoes-rotulo-nf.js
const assert = require('assert');
const { parseChaveNF, fmtDataSped, mapaC100, enriquecerComNF } = require('../services/validador/correcoes');

let fail = 0;
function check(cond, msg) { if (cond) console.log('  OK  ' + msg); else { console.error('  FAIL ' + msg); fail++; } }

// chave de NF real (POSTO PRECO BOM): nNF = pos 26-34 = 000588542 → 588542
const CH = '29260144899325000123550020005885421442095046';
// ---- parseChaveNF ----
check(parseChaveNF(CH + '#1').num === '588542', 'parse nNF = 588542');
check(parseChaveNF(CH + '#3').item === '3', 'parse item = 3 (C170)');
check(parseChaveNF(CH + '#1|1652|2').item === '1', 'parse item = 1 (C190 com CFOP|ALIQ)');
check(parseChaveNF(CH).item === null, 'sem #item → item null (C100)');
check(parseChaveNF('3154599') === null, 'chave de produto 0200 (não-NF) → null');

// ---- fmtDataSped ----
check(fmtDataSped('08012026') === '08/01/2026', 'data DDMMAAAA → DD/MM/AAAA');
check(fmtDataSped('') === '', 'data vazia → vazio');

// ---- mapaC100 (DT_DOC + adicionais frete/seguro/despesas) ----
const raw = [
    `|C100|0|1|44899325000123|55|00|002|588542|${CH}|08012026|09012026|53634,08|2|0,00|0,00|53634,08|1|0,00|134,08|0,00|0,00|0,00|0,00|0,00|0,00|`,
    '|C170|1|1|GASOLINA|10000|L|53500,00|0,00|0|061|1652|',
    '|0200|3154599|AGUA|',
].join('\n');
const mapa = mapaC100(raw);
check(mapa.get(CH) && mapa.get(CH).dt === '08012026', 'mapa chave44 → DT_DOC');
check(mapa.get(CH) && mapa.get(CH).seg === '134,08', 'mapa chave44 → VL_SEG (adicional)');

// ---- enriquecerComNF ----
const rows = [
    { chave_natural: CH + '#1', valor_original: '2,00', valor_corrigido: '0,00' },   // C170 item 1
    { chave_natural: CH + '#2', valor_original: '2,00', valor_corrigido: '0,00' },   // C170 item 2
    { chave_natural: '3154599', valor_original: '', valor_corrigido: '0300100' },    // produto 0200 (não-NF)
    { chave_natural: CH, regra_id: 'DOC-C100-VLDOC-01', campo_idx: 16, valor_original: '53634,08', valor_corrigido: '53500,00' }, // VLDOC
];
enriquecerComNF(rows, mapa);
check(rows[0].nf_num === '588542' && rows[0].nf_data === '08/01/2026' && rows[0].nf_item === '1', 'linha C170 #1 enriquecida (NF 588542 · 08/01/2026 · item 1)');
check(rows[1].nf_item === '2', 'linha C170 #2 → item 2');
check(rows[2].nf_num === undefined, 'linha 0200 (não-NF) passa intacta (sem nf_num)');
check(rows[3].nf_ajuste_tipo === 'seguro' && rows[3].nf_ajuste_valor === '134,08', 'VLDOC: identifica o adicional embutido (seguro R$134,08)');

if (fail) { console.error('\nFALHOU: ' + fail + ' assert(s).'); process.exit(1); }
console.log('\nrepro-correcoes-rotulo-nf: todos os asserts passaram.');
