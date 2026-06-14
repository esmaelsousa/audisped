// Suíte SISTEMÁTICA do Validador — PURA (sem banco, sem HTTP). Roda em qualquer lugar:
//   node tests/validador-suite.js
// Cobre: robustez do parser, contrato do engine, e POSITIVO + NEGATIVO de cada regra.
// Sai com código !=0 se algo falhar (CI-friendly). A integração com arquivos reais fica em
// validador-fleet.js (precisa de banco).
const assert = require('assert');
const { parseSped } = require('../services/validador/parser');
const { validar } = require('../services/validador/engine');
const regras = require('../services/validador/rules');
const { aplicar } = require('../services/validador/correcoes');

let pass = 0, fail = 0; const fails = [];
function t(nome, fn) { try { fn(); pass++; } catch (e) { fail++; fails.push(`${nome} → ${e.message}`); } }

// ---------- helpers ----------
const H = (linhas, { ver = '019', dtIni = '01012022', dtFin = '31012022' } = {}) =>
    [`|0000|${ver}|0|${dtIni}|${dtFin}|EMPRESA TESTE|11111111000191||BA|3550308|||A|0|`, ...linhas].join('\n');
const run = (txt) => validar(parseSped(txt));
const fires = (txt, id) => run(txt).erros.some(e => e.regra_id === id);
const firesDet = (txt, id, sub) => run(txt).erros.some(e => e.regra_id === id && (e.detalhe || '').includes(sub));
function dv(ch43) { let s = 0, p = 2; for (let i = ch43.length - 1; i >= 0; i--) { s += parseInt(ch43[i]) * p; p = p === 9 ? 2 : p + 1; } const r = s % 11; return (r === 0 || r === 1) ? 0 : 11 - r; }
const CHAVE = (b = '3521071111111111111155001000000123100000123') => b + dv(b);
const C100 = (chave, { part = 'PART1', mod = '55', sit = '00', num = '100' } = {}) =>
    `|C100|0|0|${part}|${mod}|${sit}|1|${num}|${chave}|01012022|01012022|100,00||0|100,00|0|0|0|0|0|18,00|0|0|0|0|`;
const C170 = ({ item = '1', cod = 'IT', cst = '000', cfop = '5102', aliq = '18,00' } = {}) =>
    `|C170|${item}|${cod}|DESC|1|UN|100,00|0|0|${cst}|${cfop}|100,00|0|${aliq}|0|0||||`;
const C190 = ({ cst = '000', cfop = '5102', aliq = '18,00' } = {}) =>
    `|C190|${cst}|${cfop}|${aliq}|100,00|100,00|18,00|0|0||`;
const r1300 = (cod, dt, ab, ent, disp, sai, escr, perda, ganho, fech) => `|1300|${cod}|${dt}|${ab}|${ent}|${disp}|${sai}|${escr}|${perda}|${ganho}|${fech}|`;
const r1310 = (tq, ab, ent, disp, sai, escr, perda, ganho, fech, cap = '') => `|1310|${tq}|${ab}|${ent}|${disp}|${sai}|${escr}|${perda}|${ganho}|${fech}|${cap}|`;

// ================= PARSER (robustez) =================
t('parser: string vazia → modelo vazio, sem throw', () => { const m = parseSped(''); assert.equal(m.totalLinhas, 0); assert.equal(m.linhas.length, 0); });
t('parser: null → não quebra', () => { const m = parseSped(null); assert.equal(m.totalLinhas, 0); });
t('parser: undefined → não quebra', () => { const m = parseSped(undefined); assert.equal(m.totalLinhas, 0); });
t('parser: número → não quebra', () => { parseSped(12345); });
t('parser: linhas sem pipe são ignoradas', () => { const m = parseSped('lixo\nabc def\n\n   '); assert.equal(m.totalLinhas, 0); });
t('parser: linha só com pipes vazios é ignorada (reg vazio)', () => { const m = parseSped('||\n|||'); assert.equal(m.totalLinhas, 0); });
t('parser: CRLF e LF ambos funcionam', () => { const a = parseSped('|0000|x|\r\n|0001|0|'); const b = parseSped('|0000|x|\n|0001|0|'); assert.equal(a.totalLinhas, 2); assert.equal(b.totalLinhas, 2); });
t('parser: campos do 0000 extraídos', () => { const m = parseSped(H([])); assert.equal(m.versao, '019'); assert.equal(m.dtIni, '01012022'); assert.equal(m.cnpj, '11111111000191'); assert.equal(m.uf, 'BA'); assert.equal(m.periodoYM, '202201'); });
t('parser: sem 0000 → campos vazios, periodoYM vazio, sem throw', () => { const m = parseSped('|0001|0|\n|0990|2|'); assert.equal(m.versao, ''); assert.equal(m.periodoYM, ''); assert.equal(m.totalLinhas, 2); });
t('parser: porReg e blocos corretos', () => { const m = parseSped(H(['|C100|0|0|P|55|00|1|1|x|', '|C170|1|IT|'])); assert.equal(m.porReg.get('C100').length, 1); assert.ok(m.blocos.has('0')); assert.ok(m.blocos.has('C')); });

// ================= ENGINE (contrato) =================
t('engine: modelo vazio não quebra e retorna estrutura', () => {
    const r = run(H([]));
    assert.ok(r.resumo && typeof r.resumo.total === 'number');
    assert.ok(Array.isArray(r.erros));
    assert.ok(r.porBloco);
});
t('engine: regrasExecutadas == nº de regras registradas', () => { assert.equal(run(H([])).resumo.regrasExecutadas, regras.length); });
t('engine: toda regra tem id + detectar()', () => regras.forEach(r => { assert.ok(r.id, 'regra sem id'); assert.equal(typeof r.detectar, 'function', `${r.id} sem detectar`); }));
t('engine: nenhum id de regra duplicado', () => { const ids = regras.map(r => r.id); assert.equal(new Set(ids).size, ids.length); });
t('engine: regra que lança é isolada (não derruba o engine)', () => {
    const reg = require('../services/validador/rules');
    const fake = { id: 'FAKE-BOOM', bloco: '*', detectar() { throw new Error('boom'); } };
    reg.push(fake);
    try { const r = validar(parseSped(H([]))); assert.ok(r.erros.some(e => e.regra_id === 'FAKE-BOOM')); }
    finally { reg.pop(); }
});
t('engine: total == bloqueantes + advertencias', () => { const r = run(H(['|0220|LT|1,0000||'])); assert.equal(r.resumo.total, r.resumo.bloqueantes + r.resumo.advertencias); });

// ================= REGRAS: positivo + negativo =================

// EST-9XXX-CONT (contadores)
t('contadores +: 9999 errado dispara', () => assert.ok(fires(H(['|9999|999|']), 'EST-9XXX-CONT')));

// CAD-0220-01 (nº de campos do 0220) — ≤018 → 3 campos; ≥019 → 4 campos (4º em geral vazio).
t('0220 +: leiaute 015 com 4 campos dispara (esperado 3)', () => assert.ok(fires(H(['|0220|LT|1,0000||'], { ver: '015' }), 'CAD-0220-01')));
t('0220 -: leiaute 015 com 3 campos não dispara', () => assert.ok(!fires(H(['|0220|UN|1|'], { ver: '015' }), 'CAD-0220-01')));
t('0220 -: leiaute 019 com 4 campos NÃO dispara (RAQUEL 2025)', () => assert.ok(!fires(H(['|0220|CX|24||'], { ver: '019' }), 'CAD-0220-01')));
t('0220 +: leiaute 019 com 3 campos dispara (esperado 4)', () => assert.ok(fires(H(['|0220|CX|24|'], { ver: '019' }), 'CAD-0220-01')));
t('0220 -: leiaute 020 com 4 campos NÃO dispara (S CRUZ 2026)', () => assert.ok(!fires(H(['|0220|L|1||'], { ver: '020', dtIni: '01042026', dtFin: '30042026' }), 'CAD-0220-01')));
t('0220 +: leiaute 020 com 3 campos dispara (esperado 4)', () => assert.ok(fires(H(['|0220|L|1|'], { ver: '020', dtIni: '01042026', dtFin: '30042026' }), 'CAD-0220-01')));

// DOC-CHV-DV (chave 44 + DV)
t('chave +: 43 dígitos dispara', () => assert.ok(fires(H([C100('1234567890123456789012345678901234567890123')]), 'DOC-CHV-DV')));
t('chave +: DV errado dispara', () => { const ch = CHAVE(); const ruim = ch.slice(0, 43) + ((parseInt(ch[43]) + 1) % 10); assert.ok(fires(H([C100(ruim)]), 'DOC-CHV-DV')); });
t('chave -: chave válida não dispara', () => assert.ok(!fires(H([C100(CHAVE())]), 'DOC-CHV-DV')));

// DOC-DUP (documento duplicado por chave)
t('dup +: dois C100 mesma chave dispara', () => { const ch = CHAVE(); assert.ok(fires(H([C100(ch, { num: '1' }), C100(ch, { num: '2' })]), 'DOC-DUP')); });
t('dup -: chaves diferentes não dispara', () => { const a = CHAVE('3521071111111111111155001000000123100000111'); const b = CHAVE('3521071111111111111155001000000123100000222'); assert.ok(!fires(H([C100(a), C100(b)]), 'DOC-DUP')); });

// EST-HIER-01 (filho órfão)
t('hierarquia +: C170 sem C100 antes dispara', () => assert.ok(fires(H([C170()]), 'EST-HIER-01')));
t('hierarquia +: 1310 sem 1300 antes dispara', () => assert.ok(fires(H([r1310('1', '10', '0', '10', '0', '10', '0', '0', '10')]), 'EST-HIER-01')));
t('hierarquia -: C100 antes de C170 não dispara', () => assert.ok(!fires(H([C100(CHAVE()), C170()]), 'EST-HIER-01')));

// COMB-CST-01 (CST 61 antes da vigência)
t('cst61 +: 061 em 2022 dispara', () => assert.ok(fires(H([C100(CHAVE()), C170({ cst: '061' })], { dtIni: '01012022', dtFin: '31012022' }), 'COMB-CST-01')));
t('cst61 -: 061 em 2023-06 não dispara', () => assert.ok(!fires(H([C100(CHAVE()), C170({ cst: '061' })], { dtIni: '01062023', dtFin: '30062023' }), 'COMB-CST-01')));

// DOC-C170-01 (COD_ITEM sem 0200)
t('item0200 +: C170 com cod ausente (havendo outros 0200) dispara', () => assert.ok(fires(H(['|0200|OUTRO|PROD|||UN|00|27101259||', C100(CHAVE()), C170({ cod: 'SEM200' })]), 'DOC-C170-01')));
t('item0200 -: 0200 presente não dispara', () => assert.ok(!fires(H(['|0200|COM200|PROD|||UN|00|27101259||', C100(CHAVE()), C170({ cod: 'COM200' })]), 'DOC-C170-01')));

// CAD-0150-07 (COD_PART sem 0150)
t('participante +: C100 com part sem 0150 dispara', () => assert.ok(fires(H([C100(CHAVE(), { part: 'FORNX' })]), 'CAD-0150-07')));
t('participante -: 0150 presente não dispara', () => assert.ok(!fires(H(['|0150|FORNX|FORN|1058|22222222000180||BA|1|||', C100(CHAVE(), { part: 'FORNX' })]), 'CAD-0150-07')));

// CAD-0200-03 (NCM)
t('ncm +: 0200 tipo 00 sem NCM dispara', () => assert.ok(fires(H(['|0200|P1|PROD|||UN|00||']), 'CAD-0200-03')));
t('ncm -: NCM de 8 dígitos não dispara', () => assert.ok(!fires(H(['|0200|P1|PROD|||UN|00|27101259||']), 'CAD-0200-03')));
t('ncm -: tipo 07 (uso/consumo) sem NCM não dispara', () => assert.ok(!fires(H(['|0200|P1|PROD|||UN|07||']), 'CAD-0200-03')));

// DOC-C190-01 (combinação C190 sem C170)
t('c190 +: combinação ausente no C170 dispara', () => assert.ok(fires(H([C100(CHAVE()), C170({ cfop: '5102' }), C190({ cfop: '5405' })]), 'DOC-C190-01')));
t('c190 -: combinação batendo com C170 não dispara', () => assert.ok(!fires(H([C100(CHAVE()), C170({ cfop: '5102' }), C190({ cfop: '5102' })]), 'DOC-C190-01')));

// COMB-LMC (negativo / coerência / vendas / CAP)
t('lmc +: estoque negativo dispara', () => assert.ok(firesDet(H([r1300('7085', '02012022', '50,000', '0,000', '50,000', '60,000', '-10,000', '0,000', '0,000', '-10,000')]), 'COMB-LMC', 'negativo')));
t('lmc +: FECH incoerente dispara', () => assert.ok(firesDet(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '99,000')]), 'COMB-LMC', 'FECH_FISICO')));
t('lmc +: 1320 VOL_VENDAS errado dispara', () => assert.ok(firesDet(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), '|1320|01||||||200,000|100,000|0,000|50,000|']), 'COMB-LMC', 'VOL_VENDAS')));
t('lmc +: CAP_TANQUE ausente em 2026 dispara', () => assert.ok(firesDet(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000')], { ver: '020', dtIni: '01012026', dtFin: '31012026' }), 'COMB-LMC', 'CAP_TANQUE')));
t('lmc -: 1300 coerente/positivo não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000')]), 'COMB-LMC')));

// COMB-LMC-CONT (continuidade entre dias)
t('continuidade +: abertura != fechamento do dia anterior dispara', () => assert.ok(fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1300('7084', '02012022', '95,000', '0,000', '95,000', '5,000', '90,000', '0,000', '0,000', '90,000')]), 'COMB-LMC-CONT')));
t('continuidade - (físico): abertura == FECH anterior não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1300('7084', '02012022', '90,000', '0,000', '90,000', '5,000', '85,000', '0,000', '0,000', '85,000')]), 'COMB-LMC-CONT')));
t('continuidade - (livro): abertura == ESCR anterior não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '5,000', '0,000', '85,000'), r1300('7084', '02012022', '90,000', '0,000', '90,000', '5,000', '85,000', '0,000', '0,000', '85,000')]), 'COMB-LMC-CONT')));

// COMB-1300-SUM (produto = soma dos tanques)
t('soma +: 1300 != Σ1310 dispara', () => assert.ok(fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '60,000', '0,000', '60,000', '5,000', '55,000', '0,000', '0,000', '55,000'), r1310('2', '30,000', '0,000', '30,000', '5,000', '25,000', '0,000', '0,000', '25,000')]), 'COMB-1300-SUM')));
t('soma -: 1300 == Σ1310 não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '70,000', '0,000', '70,000', '7,000', '63,000', '0,000', '0,000', '63,000'), r1310('2', '30,000', '0,000', '30,000', '3,000', '27,000', '0,000', '0,000', '27,000')]), 'COMB-1300-SUM')));

// INV-H005-01 (data do inventário > data final do período)
t('h005 +: DT_INV posterior ao DT_FIN dispara', () => assert.ok(fires(H(['|H005|15022022|100,00|01|']), 'INV-H005-01')));
t('h005 +: DT_INV vazia dispara', () => assert.ok(fires(H(['|H005||100,00|01|']), 'INV-H005-01')));
t('h005 -: DT_INV = DT_FIN não dispara', () => assert.ok(!fires(H(['|H005|31012022|100,00|01|']), 'INV-H005-01')));
t('h005 - (extemporâneo): DT_INV de período anterior não dispara', () => assert.ok(!fires(H(['|H005|31122021|100,00|01|']), 'INV-H005-01')));

// INV-H010-01 (VL_INV do H005 = Σ VL_ITEM dos H010). DT_INV=31012022 (=DT_FIN) p/ não acionar INV-H005-01.
const H010 = (cod, vlItem) => `|H010|${cod}|UN|1,000|${vlItem}|${vlItem}|0|||1||`;
t('h010 +: VL_INV ≠ Σ VL_ITEM dispara', () => assert.ok(fires(H(['|H005|31012022|100,00|01|', H010('A', '10,00'), H010('B', '20,00')]), 'INV-H010-01')));
t('h010 -: VL_INV = Σ VL_ITEM não dispara', () => assert.ok(!fires(H(['|H005|31012022|30,00|01|', H010('A', '10,00'), H010('B', '20,00')]), 'INV-H010-01')));
t('h010 -: H005 sem H010 (fora de escopo) não dispara', () => assert.ok(!fires(H(['|H005|31012022|100,00|01|']), 'INV-H010-01')));
t('h010 +: soma com centavos (arredondamento) confere', () => assert.ok(fires(H(['|H005|31012022|0,30|01|', H010('A', '0,10'), H010('B', '0,15')]), 'INV-H010-01')));
t('h010 -: split por IND_PROP soma todos os H010 do produto', () => assert.ok(!fires(H(['|H005|31012022|50,00|01|', '|H010|A|UN|1,000|30,00|30,00|0|||1||', '|H010|A|UN|1,000|20,00|20,00|2|||1||']), 'INV-H010-01')));
t('h010 sugerido = Σ VL_ITEM', () => assert.ok(firesDet(H(['|H005|31012022|100,00|01|', H010('A', '10,00'), H010('B', '20,00')]), 'INV-H010-01', '30,00')));

// Colisão de chaveNatural do H005 (MOT_INV repetido) — desambiguação por ocorrência.
t('h005 chaveNatural: 2 H005 mesmo MOT_INV → chaves distintas (01, 01#2)', () => {
    const r = run(H(['|H005|31012022|10,00|01|', H010('A', '30,00'), '|H005|31012022|20,00|01|', H010('B', '40,00')]));
    const ch = r.erros.filter(e => e.regra_id === 'INV-H010-01').map(e => e.chaveNatural).sort();
    assert.deepEqual(ch, ['01', '01#2']);
});
t('aplicar: H005 mesmo MOT_INV — correção 01 só na 1ª ocorrência (não vaza)', () => {
    const l = ['|H005|31012022|10,00|01|', '|H005|31012022|20,00|01|'];
    aplicar(l, [{ registro: 'H005', chave_natural: '01', campo_idx: 2, valor_corrigido: 'AAA' }]);
    assert.equal(l[0].split('|')[2], 'AAA');
    assert.equal(l[1].split('|')[2], '31012022');
});
t('aplicar: H005 mesmo MOT_INV — correção 01#2 só na 2ª ocorrência', () => {
    const l = ['|H005|31012022|10,00|01|', '|H005|31012022|20,00|01|'];
    aplicar(l, [{ registro: 'H005', chave_natural: '01#2', campo_idx: 2, valor_corrigido: 'BBB' }]);
    assert.equal(l[0].split('|')[2], '31012022');
    assert.equal(l[1].split('|')[2], 'BBB');
});
t('aplicar: H005 único keyed 01 (compat. com correções já gravadas) ainda aplica', () => {
    const l = ['|H005|31012022|10,00|01|'];
    const n = aplicar(l, [{ registro: 'H005', chave_natural: '01', campo_idx: 2, valor_corrigido: 'ZZZ' }]);
    assert.equal(n, 1);
    assert.equal(l[0].split('|')[2], 'ZZZ');
});

// ---------- resultado ----------
console.log(`\nValidador — suíte unitária: ${pass} passou, ${fail} falhou (de ${pass + fail})`);
if (fail) { console.log('\nFALHAS:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✓ tudo verde');
