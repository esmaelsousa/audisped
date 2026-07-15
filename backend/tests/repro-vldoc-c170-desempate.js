// tests/repro-vldoc-c170-desempate.js — DOC-C100-VLDOC-01: desempate pelo Σ C170.
// Padrão ambíguo VL_DOC==VL_MERC com adicional (frete/seguro): os itens (C170) dizem qual campo erra.
//   Cenário 1: Σ C170 = mercadoria MENOR → VL_MERC embutiu o adicional → AUTO (baixa VL_MERC, VL_DOC intacto).
//   Cenário 2: Σ C170 = VL_MERC cheio   → VL_DOC esqueceu o adicional → ASSISTIDO (ADV/manual).
//   Sem desempate                        → manual (duas hipóteses).
// Caso real: POSTO PREÇO BOM NF 634086 (VL_DOC=VL_MERC=26817,04, seguro 67,04, item gasolina 26750,00).
// Uso: node tests/repro-vldoc-c170-desempate.js
const regra = require('../services/validador/rules/r_c100_vl_doc');

// VL_MERC fixo em 26817,04 (o total embutido) — o que muda entre cenários é o valor do item (C170).
const C100 = '|C100|0|1|01125282001198|55|00|002|634086|29260101125282001198550020006340861246755303|08012026|09012026|26817,04|2|0,00|0,00|26817,04|1|0,00|67,04|0,00|0,00|0,00|0,00|0,00|0,00|||||';
const C170 = (vl) => `|C170|1|3|GASOLINA COMUM|5000,00000|L|${vl}|0,00|0|061|1652|1652|0,00|0,00|0,00|0,00|0,00|0,00|0|`;

function buildModel(lines) {
    const linhas = lines.map((s, i) => { const f = s.split('|'); return { n: i + 1, reg: f[1], f }; });
    const porReg = new Map();
    for (const l of linhas) { if (!porReg.has(l.reg)) porReg.set(l.reg, []); porReg.get(l.reg).push(l); }
    return { linhas, porReg, blocos: new Set(linhas.map(l => l.reg[0])) };
}

let fail = 0;
function check(cond, msg) { if (cond) console.log('  OK  ' + msg); else { console.error('  FAIL ' + msg); fail++; } }

// ---- Cenário 1: item = 26750,00 (mercadoria menor) → AUTO no VL_MERC ----
let e = regra.detectar(buildModel([C100, C170('26750,00')]));
check(e.length === 1, 'C1: 1 erro');
check(e[0] && e[0].campo === 'VL_MERC' && e[0].campoIdx === 16, 'C1: aponta VL_MERC (campo 16)');
check(e[0] && e[0].valorSugerido === '26750,00', 'C1: sugere VL_MERC 26750,00');
check(e[0] && e[0].severidade === 'BLOQ' && e[0].classeCorrecao === 'fiscal-deterministico', 'C1: BLOQ + fiscal-deterministico (auto)');

// ---- Cenário 2: item = 26817,04 (mercadoria cheia) → ASSISTIDO no VL_DOC ----
e = regra.detectar(buildModel([C100, C170('26817,04')]));
check(e.length === 1, 'C2: 1 erro');
check(e[0] && e[0].campo === 'VL_DOC' && e[0].campoIdx === 12, 'C2: aponta VL_DOC (campo 12)');
check(e[0] && e[0].valorSugerido === '26884,08', 'C2: sugere VL_DOC 26884,08 (26817,04 + 67,04)');
check(e[0] && e[0].severidade === 'ADV' && e[0].classeCorrecao === 'manual', 'C2: ADV + manual (assistido)');

// ---- Sem desempate: item = 26780,00 (não bate com nenhum) → manual ----
e = regra.detectar(buildModel([C100, C170('26780,00')]));
check(e.length === 1, 'C3: 1 erro');
check(e[0] && e[0].campo === 'VL_DOC/VL_MERC' && e[0].classeCorrecao === 'manual', 'C3: manual, duas hipóteses');

if (fail) { console.error('\nREPRO FALHOU: ' + fail + ' assert(s).'); process.exit(1); }
console.log('\nrepro-vldoc-c170-desempate: todos os asserts passaram.');
