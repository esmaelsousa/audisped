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
    [`|0000|${ver}|0|${dtIni}|${dtFin}|EMPRESA TESTE|11111111000191||BA|3550308||||A|0|`, ...linhas].join('\n');
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

// EST-NCAMPOS-01 (nº de campos por registro, gerado do catálogo/leiaute.json)
t('ncampos +: 0190 com 1 campo dispara (esperado 2)', () => assert.ok(fires(H(['|0190|UN|']), 'EST-NCAMPOS-01')));
t('ncampos -: 0190 com 2 campos não dispara', () => assert.ok(!fires(H(['|0190|UN|LITRO|']), 'EST-NCAMPOS-01')));
t('ncampos -: 0220 é excluído (tem regra dedicada CAD-0220-01)', () => assert.ok(!fires(H(['|0220|UN|1|']), 'EST-NCAMPOS-01')));
t('ncampos delta: 1310 em 020 exige 10 (CAP_TANQUE) → 9 dispara', () => assert.ok(fires(H(['|1310|1|2|3|4|5|6|7|8|9|'], { ver: '020', dtIni: '01012026', dtFin: '31012026' }), 'EST-NCAMPOS-01')));
t('ncampos -: 1310 em 019 com 9 campos não dispara', () => assert.ok(!fires(H(['|1310|1|2|3|4|5|6|7|8|9|']), 'EST-NCAMPOS-01')));

// CAD-0220-01 (nº de campos do 0220) — ≤018 → 3 campos; ≥019 → 4 campos (4º em geral vazio).
t('0220 +: leiaute 015 com 4 campos dispara (esperado 3)', () => assert.ok(fires(H(['|0220|LT|1,0000||'], { ver: '015' }), 'CAD-0220-01')));
t('0220 -: leiaute 015 com 3 campos não dispara', () => assert.ok(!fires(H(['|0220|UN|1|'], { ver: '015' }), 'CAD-0220-01')));
t('0220 -: leiaute 016 com 4 campos NÃO dispara (2022)', () => assert.ok(!fires(H(['|0220|CX|24||'], { ver: '016' }), 'CAD-0220-01')));
t('0220 +: leiaute 017 com 3 campos dispara (esperado 4 — posto exemplo 2023)', () => assert.ok(fires(H(['|0220|CX|6|'], { ver: '017' }), 'CAD-0220-01')));
t('0220 -: leiaute 017 com 4 campos NÃO dispara (2023)', () => assert.ok(!fires(H(['|0220|CX|6||'], { ver: '017' }), 'CAD-0220-01')));
t('0220 -: leiaute 019 com 4 campos NÃO dispara (posto exemplo 2025)', () => assert.ok(!fires(H(['|0220|CX|24||'], { ver: '019' }), 'CAD-0220-01')));
t('0220 +: leiaute 019 com 3 campos dispara (esperado 4)', () => assert.ok(fires(H(['|0220|CX|24|'], { ver: '019' }), 'CAD-0220-01')));
t('0220 -: leiaute 020 com 4 campos NÃO dispara (posto exemplo 2026)', () => assert.ok(!fires(H(['|0220|L|1||'], { ver: '020', dtIni: '01042026', dtFin: '30042026' }), 'CAD-0220-01')));
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

// DOC-0200-GTIN-01 (COD_BARRA não numérico)
t('codbarra +: COD_BARRA "SEM GTIN" dispara', () => assert.ok(fires(H(['|0200|CANETA|CANETA BIC|SEM GTIN| |UN|07|96081000||96||||']), 'DOC-0200-GTIN-01')));
t('codbarra +: marcado permiteVazio + sugere vazio', () => { const e = run(H(['|0200|CANETA|CANETA BIC|SEM GTIN| |UN|07|96081000||96||||'])).erros.find(x => x.regra_id === 'DOC-0200-GTIN-01'); assert.equal(e.permiteVazio, true); assert.equal(e.valorSugerido, ''); assert.equal(e.campoIdx, 4); });
t('codbarra -: COD_BARRA numérico (GTIN) não dispara', () => assert.ok(!fires(H(['|0200|P1|PROD|7891234567895| |UN|00|27101259||||||']), 'DOC-0200-GTIN-01')));
t('codbarra -: COD_BARRA vazio não dispara', () => assert.ok(!fires(H(['|0200|P1|PROD| | |UN|00|27101259||||||']), 'DOC-0200-GTIN-01')));
t('codbarra aplicar: correção vazia apaga o campo', () => { const l = ['|0200|CANETA|CANETA BIC|SEM GTIN| |UN|07|96081000||96||||']; aplicar(l, [{ registro: '0200', chave_natural: 'CANETA', campo_idx: 4, valor_corrigido: '' }]); assert.equal(l[0].split('|')[4], ''); });

// DOC-0200-CEST-01 (CEST inexistente / não casa NCM — usa model.dominio). 0200: f8=NCM, f13=CEST.
const DOM = { cestSet: new Set(['0600200']), cestNcm: new Map([['0600200', ['27101259']]]) };
const comDom = (linhas) => { const m = parseSped(H(linhas)); m.dominio = DOM; return validar(m).erros; };
t('cest +: CEST não localizado (1708704) dispara ADV', () => { const e = comDom(['|0200|P1|BOMBONA| | |UN|00|39233090| |39| |20,50|1708704|']).find(x => x.regra_id === 'DOC-0200-CEST-01'); assert.ok(e && e.severidade === 'ADV' && e.detalhe.includes('não localizado')); });
t('cest +: CEST malformado (5 díg) dispara BLOQ', () => { const e = comDom(['|0200|P1|X| | |UN|00|39233090| |39| |20,50|12345|']).find(x => x.regra_id === 'DOC-0200-CEST-01'); assert.ok(e && e.severidade === 'BLOQ'); });
t('cest -: CEST válido + NCM casa não dispara', () => assert.ok(!comDom(['|0200|P1|GASOLINA| | |L|00|27101259| |06| |18,00|0600200|']).some(e => e.regra_id === 'DOC-0200-CEST-01')));
t('cest -: CEST existe (não checamos NCM por prefixo) não dispara', () => assert.ok(!comDom(['|0200|P1|X| | |UN|00|39233090| |39| |20,50|0600200|']).some(e => e.regra_id === 'DOC-0200-CEST-01')));
t('cest -: sem CEST não dispara', () => assert.ok(!comDom(['|0200|P1|X| | |UN|00|39233090| |39| |20,50||']).some(e => e.regra_id === 'DOC-0200-CEST-01')));
t('cest -: sem domínio carregado não valida (degradação segura)', () => assert.ok(!fires(H(['|0200|P1|X| | |UN|00|39233090| |39| |20,50|9999999|']), 'DOC-0200-CEST-01')));
t('cest: erro carrega e.ncm (NCM do produto) p/ a lista suspensa', () => { const e = comDom(['|0200|P1|BOMBONA| | |UN|00|39233090| |39| |20,50|1708704|']).find(x => x.regra_id === 'DOC-0200-CEST-01'); assert.equal(e.ncm, '39233090'); });

// DOC-C190-01 (combinação C190 sem C170)
t('c190 +: combinação ausente no C170 dispara', () => assert.ok(fires(H([C100(CHAVE()), C170({ cfop: '5102' }), C190({ cfop: '5405' })]), 'DOC-C190-01')));
t('c190 -: combinação batendo com C170 não dispara', () => assert.ok(!fires(H([C100(CHAVE()), C170({ cfop: '5102' }), C190({ cfop: '5102' })]), 'DOC-C190-01')));

// DOC-C170-CFOP-01 (CFOP inválido no C170, ex.: 0061)
t('cfop-c170 +: CFOP 0061 dispara', () => assert.ok(fires(H([C100(CHAVE()), '|C170|1|1|GASOLINA|4000|L|21400,00|0,00|0|000|0061|1652|0,00|0,00|0,00|0,00|0,00|0,00|0|']), 'DOC-C170-CFOP-01')));
t('cfop-c170 +: sugere COD_NAT quando é CFOP válido', () => assert.ok(firesDet(H([C100(CHAVE()), '|C170|1|1|GASOLINA|4000|L|21400,00|0,00|0|000|0061|1652|0,00|']), 'DOC-C170-CFOP-01', '1652')));
t('cfop-c170 -: CFOP 1652 válido não dispara', () => assert.ok(!fires(H([C100(CHAVE()), '|C170|1|1|GASOLINA|4000|L|21400,00|0,00|0|061|1652||0,00|']), 'DOC-C170-CFOP-01')));

// COMB-1350-1360-01 (bomba 1350 sem lacre 1360)
t('1350-1360 +: bomba sem 1360 dispara', () => assert.ok(fires(H(['|1350|BOMBA1|MARCA|MOD|1|', '|1370|1|2|12|', '|1370|2|1|11|']), 'COMB-1350-1360-01')));
t('1350-1360 -: bomba com 1360 não dispara', () => assert.ok(!fires(H(['|1350|BOMBA1|MARCA|MOD|1|', '|1360|LACRE001|01012022|', '|1370|1|2|12|']), 'COMB-1350-1360-01')));
t('1350-1360 +: 2 bombas sem 1360 = 2 erros', () => { const r = run(H(['|1350|B1|M|MO|1|', '|1370|1|2|12|', '|1350|B2|M|MO|1|', '|1370|2|1|11|'])); assert.equal(r.erros.filter(e => e.regra_id === 'COMB-1350-1360-01').length, 2); });

// INV-1360-DATA-01 (DAT_APLICACAO do lacre < 01/01/2000)
t('1360-data +: ano 0205 dispara', () => assert.ok(fires(H(['|1350|B1|M|MO|1|', '|1360|I7651130-7|03120205|']), 'INV-1360-DATA-01')));
t('1360-data -: data válida (2016) não dispara', () => assert.ok(!fires(H(['|1350|B1|M|MO|1|', '|1360|G0829928-3|08082016|']), 'INV-1360-DATA-01')));
t('1360-data corrigível por NUM_LACRE (campoIdx 3)', () => { const e = run(H(['|1360|LX|03120205|'])).erros.find(x => x.regra_id === 'INV-1360-DATA-01'); assert.equal(e.campoIdx, 3); assert.equal(e.chaveNatural, 'LX'); assert.equal(e.corrigivel, true); });

// DOC-C100-DTES-01 (C100 DT_E_S > data final). H() usa DT_FIN=31012022.
t('c100-dtes +: DT_E_S 03022022 > 31012022 dispara', () => assert.ok(fires(H(['|C100|0|1|PART|55|00|1|100|' + CHAVE() + '|30012022|03022022|100,00|']), 'DOC-C100-DTES-01')));
t('c100-dtes -: DT_E_S dentro do período não dispara', () => assert.ok(!fires(H(['|C100|0|1|PART|55|00|1|100|' + CHAVE() + '|30012022|30012022|100,00|']), 'DOC-C100-DTES-01')));
t('c100-dtes sugere DT_DOC', () => assert.ok(firesDet(H(['|C100|0|1|PART|55|00|1|100|' + CHAVE() + '|30012022|03022022|100,00|']), 'DOC-C100-DTES-01', '30/01/2022')));

// COMB-LMC (negativo / coerência / vendas / CAP)
t('lmc +: estoque negativo dispara', () => assert.ok(firesDet(H([r1300('7085', '02012022', '50,000', '0,000', '50,000', '60,000', '-10,000', '0,000', '0,000', '-10,000')]), 'COMB-LMC', 'negativo')));
t('lmc +: FECH incoerente dispara', () => assert.ok(firesDet(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '99,000')]), 'COMB-LMC', 'FECH_FISICO')));
t('lmc +: 1320 VOL_VENDAS errado dispara', () => assert.ok(firesDet(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), '|1320|01||||||200,000|100,000|0,000|50,000|']), 'COMB-LMC', 'VOL_VENDAS')));
t('lmc +: CAP_TANQUE ausente em leiaute 020 dispara', () => assert.ok(firesDet(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000')], { ver: '020', dtIni: '01012026', dtFin: '31012026' }), 'COMB-LMC', 'CAP_TANQUE')));
t('cap -: leiaute 019 em 2026 NÃO dispara CAP (gate por leiaute, não período)', () => assert.ok(!firesDet(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000')], { ver: '019', dtIni: '01012026', dtFin: '31012026' }), 'COMB-LMC', 'CAP_TANQUE')));
t('cap: dedup por tanque — mesmo tanque em 2 dias = 1 achado', () => { const c = run(H([r1310('1', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '90,000', '0,000', '90,000', '5,000', '85,000', '0,000', '0,000', '85,000')], { ver: '020', dtIni: '01012026', dtFin: '31012026' })).erros.filter(e => e.regra_id === 'COMB-LMC' && (e.detalhe || '').includes('CAP_TANQUE')); assert.equal(c.length, 1); });
t('cap: agora é ADV (era BLOQ) — export injeta', () => { const e = run(H([r1310('1', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000')], { ver: '020', dtIni: '01012026', dtFin: '31012026' })).erros.find(x => x.regra_id === 'COMB-LMC' && (x.detalhe || '').includes('CAP_TANQUE')); assert.equal(e.severidade, 'ADV'); });
t('lmc -: 1300 coerente/positivo não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000')]), 'COMB-LMC')));

// COMB-LMC-CONT (continuidade entre dias)
t('continuidade +: abertura != fechamento do dia anterior dispara', () => assert.ok(fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1300('7084', '02012022', '95,000', '0,000', '95,000', '5,000', '90,000', '0,000', '0,000', '90,000')]), 'COMB-LMC-CONT')));
t('continuidade - (físico): abertura == FECH anterior não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1300('7084', '02012022', '90,000', '0,000', '90,000', '5,000', '85,000', '0,000', '0,000', '85,000')]), 'COMB-LMC-CONT')));
t('continuidade - (livro): abertura == ESCR anterior não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '5,000', '0,000', '85,000'), r1300('7084', '02012022', '90,000', '0,000', '90,000', '5,000', '85,000', '0,000', '0,000', '85,000')]), 'COMB-LMC-CONT')));

// COMB-1300-SUM (produto = soma dos tanques)
t('soma +: 1300 != Σ1310 dispara', () => assert.ok(fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '60,000', '0,000', '60,000', '5,000', '55,000', '0,000', '0,000', '55,000'), r1310('2', '30,000', '0,000', '30,000', '5,000', '25,000', '0,000', '0,000', '25,000')]), 'COMB-1300-SUM')));
t('soma -: 1300 == Σ1310 não dispara', () => assert.ok(!fires(H([r1300('7084', '01012022', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1310('1', '70,000', '0,000', '70,000', '7,000', '63,000', '0,000', '0,000', '63,000'), r1310('2', '30,000', '0,000', '30,000', '3,000', '27,000', '0,000', '0,000', '27,000')]), 'COMB-1300-SUM')));

// COMB-1310-ANP-01 (E-Aud 2033: variação físico×escritural > 0,6% ANP)
t('anp +: físico=0 (100%) dispara', () => assert.ok(fires(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '0,000', '100,000', '100,000', '0,000', '0,000'), r1310('201', '100,000', '0,000', '100,000', '0,000', '100,000', '100,000', '0,000', '0,000')]), 'COMB-1310-ANP-01')));
t('anp +: variação real 13,349% dispara', () => assert.ok(firesDet(H([r1300('7084', '02012026', '7751,116', '0,000', '7751,116', '1556,079', '6195,037', '826,970', '0,000', '5368,067'), r1310('201', '7751,116', '0,000', '7751,116', '1556,079', '6195,037', '826,970', '0,000', '5368,067')]), 'COMB-1310-ANP-01', '13,349%')));
t('anp +: erro é ADV, não BLOQ', () => { const e = run(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '0,000', '100,000', '100,000', '0,000', '0,000'), r1310('201', '100,000', '0,000', '100,000', '0,000', '100,000', '100,000', '0,000', '0,000')])).erros.find(x => x.regra_id === 'COMB-1310-ANP-01'); assert.equal(e.severidade, 'ADV'); });
t('anp M2: físico=0 rotula "medição ausente" (não "variação")', () => assert.ok(firesDet(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '0,000', '100,000', '100,000', '0,000', '0,000'), r1310('201', '100,000', '0,000', '100,000', '0,000', '100,000', '100,000', '0,000', '0,000')]), 'COMB-1310-ANP-01', 'medição ausente')));
t('anp -: físico=escritural não dispara', () => assert.ok(!fires(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '0,000', '100,000', '0,000', '0,000', '100,000'), r1310('201', '100,000', '0,000', '100,000', '0,000', '100,000', '0,000', '0,000', '100,000')]), 'COMB-1310-ANP-01')));
t('anp -: 0,5% (dentro do limite) não dispara', () => assert.ok(!fires(H([r1300('7084', '01012026', '1000,000', '0,000', '1000,000', '0,000', '1000,000', '5,000', '0,000', '995,000'), r1310('201', '1000,000', '0,000', '1000,000', '0,000', '1000,000', '5,000', '0,000', '995,000')]), 'COMB-1310-ANP-01')));
t('anp +: 0,7% (acima do limite) dispara', () => assert.ok(fires(H([r1300('7084', '01012026', '1000,000', '0,000', '1000,000', '0,000', '1000,000', '7,000', '0,000', '993,000'), r1310('201', '1000,000', '0,000', '1000,000', '0,000', '1000,000', '7,000', '0,000', '993,000')]), 'COMB-1310-ANP-01')));
t('anp -: 0,637% arredonda p/ 0,6% (tolerado, como o E-Auditor) não dispara', () => assert.ok(!fires(H([r1300('7084', '01012026', '3464,047', '0,000', '3464,047', '0,000', '3464,047', '22,074', '0,000', '3441,973'), r1310('204', '3464,047', '0,000', '3464,047', '0,000', '3464,047', '22,074', '0,000', '3441,973')]), 'COMB-1310-ANP-01')));

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

// COMB-1350-1360-01: o erro carrega chaveNatural = SERIE da bomba (chaveNatural case '1350'),
// usada pela UI e pela supressão p/ casar o lacre cadastrado (lmc_lacres) à bomba.
t('1350-1360 erro carrega chaveNatural = SERIE da bomba', () => {
    const e = run(H(['|1350|41420925|GILBARCO|PHR-2422|1|', '|1370|1|2|12|'])).erros.find(x => x.regra_id === 'COMB-1350-1360-01');
    assert.equal(e.chaveNatural, '41420925');
});

// INV-E110-01 (apuração ICMS E110 = Σ E111 por natureza + cascata). COD_AJ_APUR 4ª pos: 0=déb, 2=créd.
const E110z = '|E110|100,00|0|0,00|0|0,00|0|0,00|0|0|0,00|0|0,00|0,00|0|';
t('e110 +: f4/f8 zerados com E111 dispara', () => assert.ok(fires(H([E110z, '|E111|BA009999|DIFAL|50,00|', '|E111|BA020003|CIAP|30,00|']), 'INV-E110-01')));
t('e110 + sugere soma do E111 (50,00 débito)', () => assert.ok(firesDet(H([E110z, '|E111|BA009999|DIFAL|50,00|', '|E111|BA020003|CIAP|30,00|']), 'INV-E110-01', '50,00')));
t('e110 -: E110 coerente sem E111 não dispara', () => assert.ok(!fires(H(['|E110|100,00|0|0,00|0|0,00|0|0,00|0|0|100,00|0|100,00|0,00|0|']), 'INV-E110-01')));
t('e110 -: E110 coerente COM E111 (totais e saldo certos) não dispara', () => assert.ok(!fires(H(['|E110|100,00|0|50,00|0|0,00|0|30,00|0|0|120,00|0|120,00|0,00|0|', '|E111|BA009999|DIFAL|50,00|', '|E111|BA020003|CIAP|30,00|']), 'INV-E110-01')));

// INV-E116-01 (Σ E116.VL_OR = E110 f13 ICMS_RECOLHER + f15 DEB_ESP). E110 coerente p/ não acionar INV-E110-01.
const E110ok = '|E110|120,00|0|0,00|0|0,00|0|0,00|0|0|120,00|0|120,00|0,00|0|'; // f13=120,00
t('e116 +: E116 ausente com ICMS a recolher dispara', () => assert.ok(fires(H([E110ok]), 'INV-E116-01')));
t('e116 +: Σ E116 ≠ f13 dispara', () => assert.ok(fires(H([E110ok, '|E116|000|99,99|09022022|0759|||||012022|']), 'INV-E116-01')));
t('e116 -: Σ E116 == f13 não dispara', () => assert.ok(!fires(H([E110ok, '|E116|000|120,00|09022022|0759|||||012022|']), 'INV-E116-01')));
t('e116 sem cadastro: ausente → manual (jaCorrigidoNoExport=false)', () => { const m = parseSped(H([E110ok])); const e = validar(m).erros.find(x => x.regra_id === 'INV-E116-01'); assert.ok(e && e.jaCorrigidoNoExport === false); });
t('e116 cadOk: ausente + COD_REC cadastrado → jaCorrigidoNoExport=true', () => { const m = parseSped(H([E110ok])); m.apuracaoE116CadOk = true; const e = validar(m).erros.find(x => x.regra_id === 'INV-E116-01'); assert.ok(e && e.jaCorrigidoNoExport === true); });
t('recalcularE116: ajusta VL_OR do único E116 ao f13', () => { const { recalcularE116 } = require('../services/spedCostureiraService'); const l = [E110ok, '|E116|000|99,99|09022022|0759|||||012022|']; recalcularE116(l); assert.equal(l[1].split('|')[3], '120,00'); });
t('injetarE116: vencimento=último dia da apuração, MES_REF=competência, COD_REC informado', () => { const { injetarE116SeNecessario } = require('../services/spedCostureiraService'); const l = ['|0000|019|0|01052026|31052026|EMP|11111111000191||BA|1|2910800|||A|A|', E110ok, '|E990|3|']; const n = injetarE116SeNecessario(l, '0767'); const e = l.find(x => x.split('|')[1] === 'E116'); assert.equal(n, 1); assert.equal(e, '|E116|000|120,00|31052026|0767|||||052026|'); });
t('garantirRegistros9900: insere 9900 p/ registro sem entrada (E116)', () => { const { garantirRegistros9900 } = require('../services/spedCostureiraService'); const l = ['|E110|0|', '|E116|000|1,00|31052026|0767|||||052026|', '|9900|E110|1|', '|9900|9900|4|', '|9900|9990|1|', '|9900|9999|1|', '|9990|6|', '|9999|8|']; const n = garantirRegistros9900(l); assert.equal(n, 1); const idxE116 = l.findIndex(x => x.startsWith('|9900|E116|')); assert.ok(idxE116 !== -1); });
t('garantirRegistros9900: no-op quando todos têm 9900', () => { const { garantirRegistros9900 } = require('../services/spedCostureiraService'); const l = ['|E110|0|', '|9900|E110|1|', '|9900|9900|2|', '|9900|9990|1|', '|9990|4|']; assert.equal(garantirRegistros9900(l), 0); });
t('contadores: tipo presente sem entrada 9900 → "necessário totalizar"', () => { const mk = (reg, ...rest) => ({ reg, n: 1, f: ['', reg, ...rest] }); const linhas = [mk('E110', '0'), mk('E116', '000'), mk('9900', 'E110', '1'), mk('9999', '2')]; const porReg = new Map(); for (const l of linhas) { if (!porReg.has(l.reg)) porReg.set(l.reg, []); porReg.get(l.reg).push(l); } const erros = require('../services/validador/rules/r_contadores').detectar({ linhas, porReg, totalLinhas: 4, blocos: ['E', '9'] }); assert.ok(erros.some(e => e.detalhe.includes('totalizar os registros do tipo E116'))); });

// DOC-C191-FCP-01 (VL_FCP_RET do C191 só com CST x60/500 no C190 pai)
t('c191 +: VL_FCP_RET com C190 pai CST 040 dispara', () => assert.ok(fires(H(['|C190|040|1949|0,00|8,00|0|0|0|0||', '|C191|0,00|0,00|0,15|']), 'DOC-C191-FCP-01')));
t('c191 -: VL_FCP_RET com C190 pai CST 060 (x60) não dispara', () => assert.ok(!fires(H(['|C190|060|1403|0,00|385|0|0|0|0||', '|C191|0,00|0,00|8,61|']), 'DOC-C191-FCP-01')));
t('c191 -: VL_FCP_RET zero não dispara', () => assert.ok(!fires(H(['|C190|040|1949|0,00|8|0|0|0|0||', '|C191|0,00|0,00|0,00|']), 'DOC-C191-FCP-01')));
t('corrigirC191FcpRet: zera quando pai não é x60/500', () => { const { corrigirC191FcpRet } = require('../services/spedCostureiraService'); const l = ['|C190|040|1949|0,00|8,00|0|0|0|0||', '|C191|0,00|0,00|0,15|']; corrigirC191FcpRet(l); assert.equal(l[1], '|C191|0,00|0,00|0,00|'); });
t('corrigirC191FcpRet: preserva quando pai é x60', () => { const { corrigirC191FcpRet } = require('../services/spedCostureiraService'); const l = ['|C190|060|1403|0,00|385|0|0|0|0||', '|C191|0,00|0,00|8,61|']; corrigirC191FcpRet(l); assert.equal(l[1], '|C191|0,00|0,00|8,61|'); });

// DOC-D100-EMIT-01 (IND_EMIT=1 terceiros + IND_OPER de saída)
const D100e = (oper, emit) => `|D100|${oper}|${emit}|CNPJ|57|00|001||1|chave|05052022|05052022|0||30,00|0|9|0|0|0|0||0|x|`;
t('d100emit +: IND_EMIT=1 + IND_OPER=1 dispara', () => assert.ok(fires(H([D100e('1', '1')]), 'DOC-D100-EMIT-01')));
t('d100emit -: IND_EMIT=1 + IND_OPER=0 não dispara', () => assert.ok(!fires(H([D100e('0', '1')]), 'DOC-D100-EMIT-01')));
t('d100emit -: IND_EMIT=0 não dispara', () => assert.ok(!fires(H([D100e('1', '0')]), 'DOC-D100-EMIT-01')));
t('corrigirD100: CFOP saída → IND_EMIT=0 (IND_OPER intacto)', () => { const { corrigirD100IndEmitOper } = require('../services/spedCostureiraService'); const l = [D100e('1', '1'), '|D190|060|5353|0,00|30|0|0|0|0||']; corrigirD100IndEmitOper(l); const f = l[0].split('|'); assert.equal(f[3], '0'); assert.equal(f[2], '1'); });
t('corrigirD100: CFOP entrada → IND_OPER=0 (IND_EMIT intacto)', () => { const { corrigirD100IndEmitOper } = require('../services/spedCostureiraService'); const l = [D100e('1', '1'), '|D190|060|1353|0,00|30|0|0|0|0||']; corrigirD100IndEmitOper(l); const f = l[0].split('|'); assert.equal(f[2], '0'); assert.equal(f[3], '1'); });

// DOC-D100-CANC-01 (cancelado/denegado com campos além da chave)
const D100canc = '|D100|1|0| |57|02|001| |2061|CHAVE| | | | | | | | | | | | | |2917508|2906873|';
t('d100canc +: cancelado (02) com COD_MUN dispara', () => assert.ok(fires(H([D100canc]), 'DOC-D100-CANC-01')));
t('d100canc -: cancelado (02) só com chave não dispara', () => assert.ok(!fires(H(['|D100|1|0| |57|02|001| |2061|CHAVE|']), 'DOC-D100-CANC-01')));
t('d100canc -: não-cancelado (00) com COD_MUN não dispara', () => assert.ok(!fires(H(['|D100|1|0| |57|00|001| |2061|CHAVE| | | | | | | | | | | | | |2917508|2906873|']), 'DOC-D100-CANC-01')));
t('corrigirD100Cancelado: limpa campos após a chave, mantém chave/COD_SIT', () => { const { corrigirD100Cancelado } = require('../services/spedCostureiraService'); const l = [D100canc]; corrigirD100Cancelado(l); const f = l[0].split('|'); assert.equal(f[24], ''); assert.equal(f[25], ''); assert.equal(f[10], 'CHAVE'); assert.equal(f[6], '02'); });

// DOC-0200-DUP-01 (COD_ITEM duplicado no 0200)
t('0200dup +: COD_ITEM repetido dispara', () => assert.ok(fires(H(['|0200|TBG|TBG| | |PC|07|73069090| |73| |0,00| |', '|0200|TBG|TBG| | |PC|07|73069090| |73| |0,00| |']), 'DOC-0200-DUP-01')));
t('0200dup -: COD_ITEM único não dispara', () => assert.ok(!fires(H(['|0200|A|A| | |PC|07|73069090| |73| |0,00| |', '|0200|B|B| | |PC|07|73069090| |73| |0,00| |']), 'DOC-0200-DUP-01')));
t('dedupar0200: remove repetido, mantém o 1º', () => { const { dedupar0200 } = require('../services/spedCostureiraService'); const l = ['|0200|TBG|TBG|x|', '|0220|UN|1||', '|0200|TBG|TBG|x|', '|0220|UN|1||']; const n = dedupar0200(l); assert.equal(n, 1); assert.equal(l.filter(x => x.startsWith('|0200|')).length, 1); });

// recalcularE110: VL_ICMS_RECOLHER = SLD_APURADO - TOT_DED (NÃO soma DEB_ESP)
t('e110 f13: não soma DEB_ESP (f15) ao ICMS a recolher', () => { const { recalcularE110 } = require('../services/spedCostureiraService'); const l = ['|E110|840,78|0,00|0,00|0,00|28,46|0,00|0,00|2,11|176,65|0|0,00|0|0,00|2,11|']; recalcularE110(l); const f = l[0].split('|'); assert.equal(f[11], '633,56'); assert.equal(f[13], '633,56'); });

// zerarBaseMonofasicoEntrada: CST 02/15/53/61 em entrada → VL_BC_ICMS/VL_BC_ICMS_ST=0 (ALIQ=0 só p/ 61); preserva VL_ICMS/VL_ICMS_ST
t('monofásico: C170 CST 61 entrada zera BC/ALIQ/BC_ST, preserva VL_ICMS e VL_ICMS_ST', () => { const { zerarBaseMonofasicoEntrada } = require('../services/spedCostureiraService'); const l = ['|C170|1|3|ORIGINAL ETANOL|3000,00000|L|11032,80|0,00|0|061|1652|1652|11032,80|12,86|1418,82|13770,00|0,00|352,00|0| | |0,00|0,00|0,00|04| |']; const n = zerarBaseMonofasicoEntrada(l); const f = l[0].split('|'); assert.equal(n, 1); assert.equal(f[13], '0,00'); assert.equal(f[14], '0,00'); assert.equal(f[16], '0,00'); assert.equal(f[15], '1418,82'); assert.equal(f[18], '352,00'); });
t('monofásico: C190 CST 61 entrada zera BC/BC_ST, preserva ALIQ/VL_ICMS/VL_ICMS_ST', () => { const { zerarBaseMonofasicoEntrada } = require('../services/spedCostureiraService'); const l = ['|C190|061|1652|12,86|11032,80|11032,80|1418,82|13770,00|352,00|0,00|0,00| |']; const n = zerarBaseMonofasicoEntrada(l); const f = l[0].split('|'); assert.equal(n, 1); assert.equal(f[6], '0,00'); assert.equal(f[8], '0,00'); assert.equal(f[4], '12,86'); assert.equal(f[7], '1418,82'); assert.equal(f[9], '352,00'); });
t('monofásico: no-op em SAÍDA (CFOP 5) e em CST não monofásico', () => { const { zerarBaseMonofasicoEntrada } = require('../services/spedCostureiraService'); const saida = '|C190|061|5652|12,86|100,00|100,00|12,86|0,00|0,00|0,00|0,00| |'; const naoMonof = '|C190|000|1652|18,00|100,00|100,00|18,00|0,00|0,00|0,00|0,00| |'; const l = [saida, naoMonof]; assert.equal(zerarBaseMonofasicoEntrada(l), 0); assert.equal(l[0], saida); assert.equal(l[1], naoMonof); });

// preencherE116CodRecVazio: preenche COD_REC (f5) vazio; no-op quando já preenchido ou sem codRec
t('E116 COD_REC: preenche f5 vazio com o COD_REC informado', () => { const { preencherE116CodRecVazio } = require('../services/spedCostureiraService'); const l = ['|E116|000|91,50|01062026| | | | | |052026|']; const n = preencherE116CodRecVazio(l, '0767'); assert.equal(n, 1); assert.equal(l[0].split('|')[5], '0767'); });
t('E116 COD_REC: no-op quando f5 já preenchido', () => { const { preencherE116CodRecVazio } = require('../services/spedCostureiraService'); const orig = '|E116|000|91,50|01062026|0767| | | | |052026|'; const l = [orig]; assert.equal(preencherE116CodRecVazio(l, '0759'), 0); assert.equal(l[0], orig); });
t('E116 COD_REC: no-op sem codRec', () => { const { preencherE116CodRecVazio } = require('../services/spedCostureiraService'); const orig = '|E116|000|91,50|01062026| | | | | |052026|'; const l = [orig]; assert.equal(preencherE116CodRecVazio(l, ''), 0); assert.equal(l[0], orig); });

// chaveNatural 0100 (contabilista) — editável por CNPJ do escritório (p/ corrigir CPF/CRC)
t('chaveNatural: 0100 resolve por CNPJ do escritório', () => { const { chaveNatural } = require('../services/validador/correcoes'); assert.equal(chaveNatural('0100', '|0100|CONTABILIDADE| | |13937073000156|44695000|'.split('|')), '13937073000156'); });
t('chaveNatural: 0100 cai p/ NOME quando sem CNPJ', () => { const { chaveNatural } = require('../services/validador/correcoes'); assert.equal(chaveNatural('0100', '|0100|JOAO CONTADOR| | | |'.split('|')), 'JOAO CONTADOR'); });

// DOC-0100-CONTADOR-01 — CPF/CRC/EMAIL obrigatórios no 0100 (PVA "Campo obrigatório.")
const O0100 = (cpf = '69798176553', crc = '123', email = 'contador@x.com') => `|0100|ELIAS NUNES DA PURIFICACAO|${cpf}|${crc}|14825524000126|47700000|RUA 26 DE JULHO|782| |SAO JOAO| | |${email}|2928208|`;
t('0100 contador +: EMAIL vazio dispara', () => { assert.ok(firesDet(H([O0100('69798176553', '123', ' ')]), 'DOC-0100-CONTADOR-01', 'EMAIL')); });
t('0100 contador +: CPF vazio dispara', () => { assert.ok(firesDet(H([O0100(' ', '123', 'x@x.com')]), 'DOC-0100-CONTADOR-01', 'CPF')); });
t('0100 contador +: CRC vazio dispara', () => { assert.ok(firesDet(H([O0100('69798176553', ' ', 'x@x.com')]), 'DOC-0100-CONTADOR-01', 'CRC')); });
t('0100 contador -: CPF+CRC+EMAIL preenchidos não dispara', () => { assert.ok(!fires(H([O0100()]), 'DOC-0100-CONTADOR-01')); });

// ---------- money.js (E-Auditoria) ----------
const money = require('../services/validador/money');
t('money.toCents parseia vírgula e milhar', () => {
    assert.strictEqual(money.toCents('639,32'), 63932);
    assert.strictEqual(money.toCents('1.377.049,87'), 137704987);
    assert.strictEqual(money.toCents(''), 0);
});
t('money.icmsCents usa HALF-UP (1,025 -> 1,03)', () => {
    assert.strictEqual(money.icmsCents(500, money.aliqBp('20,50')), 103); // 5,00*20,5% = 1,025 -> 1,03
    assert.strictEqual(money.icmsCents(63932, money.aliqBp('20,50')), 13106); // 131,0606 -> 131,06
});
t('money.fromCents formata', () => {
    assert.strictEqual(money.fromCents(13106), '131,06');
    assert.strictEqual(money.fromCents(103), '1,03');
    assert.strictEqual(money.fromCents(0), '0,00');
});

// ---------- chaveNatural C190 + blindagem de chave vazia (E-Auditoria F4) ----------
t('chaveNatural do C190 = chaveC100#CST|CFOP|ALIQ', () => {
    const { chaveNatural } = require('../services/validador/correcoes');
    const f = '|C190|000|1102|20,50|1086,84|639,32|131,05|0,00|0,00|0,00|0,00||'.split('|');
    assert.strictEqual(chaveNatural('C190', f, 'CHV44'), 'CHV44#000|1102|20.5');
});
t('chave vazia (C100 mod 01 sem chave) não é corrigível', () => {
    const semChv = '|C100|0|1|PART|01|00|1|500||01012022|01012022|100,00||0|100,00|0|0|0|0|0|18,00|0|0|0|0|';
    const r = run(H([semChv]));
    assert.ok(r.erros.every(e => e.registro !== 'C100' || e.corrigivel === false));
});

// ---------- engine propaga refEAuditoria ----------
t('engine propaga refEAuditoria da regra', () => {
    const regrasMod = require('../services/validador/rules');
    regrasMod.push({ id: 'TMP-REF', bloco: 'C', registro: 'C100', titulo: 't', refEAuditoria: '9999',
        detectar: () => [{ linha: 1, campo: 'x', detalhe: 'd' }] });
    const r = validar({ linhas: [], porReg: new Map(), blocos: new Set(['C']) });
    regrasMod.pop();
    const e = r.erros.find(x => x.regra_id === 'TMP-REF');
    assert.ok(e && e.refEAuditoria === '9999');
});

// ---------- DOC-C100-VLDOC-01 (E-Aud 2890) ----------
const C100vd = (vldoc, merc, out, emit = '0') => `|C100|1|${emit}||65|00|001|80138|CHV|03062026|03062026|${vldoc}|2|0,00|0,00|${merc}|9|0,00|0,00|${out}|0,00|0,00|0,00|0,00|0,00|`;
t('2890 dispara quando VL_DOC ignora VL_OUT_DA', () => {
    assert.ok(fires(H([C100vd('2903,78', '2903,78', '156,78')]), 'DOC-C100-VLDOC-01'));
});
t('2890 NÃO dispara quando VL_DOC bate', () => {
    assert.ok(!fires(H([C100vd('3060,56', '2903,78', '156,78')]), 'DOC-C100-VLDOC-01'));
});
t('2890 emissão PRÓPRIA (VL_DOC==VL_MERC, delta==VL_OUT_DA) → zera VL_OUT_DA (campo 20), não toca VL_DOC', () => {
    const e = run(H([C100vd('2903,78', '2903,78', '156,78', '0')])).erros.find(x => x.regra_id === 'DOC-C100-VLDOC-01');
    assert.strictEqual(e.campoIdx, 20);
    assert.strictEqual(e.valorSugerido, '0,00');
    assert.strictEqual(e.classeCorrecao, 'fiscal-deterministico');
});
t('2890 emissão de TERCEIROS → recompõe VL_DOC (campo 12)', () => {
    const e = run(H([C100vd('2903,78', '2903,78', '156,78', '1')])).erros.find(x => x.regra_id === 'DOC-C100-VLDOC-01');
    assert.strictEqual(e.campoIdx, 12);
    assert.strictEqual(e.valorSugerido, '3060,56');
});

// ---------- DOC-C170-ICMSSEMBASE-01 (E-Aud 2075) ----------
const C170ub = `|C170|1|X|BICO|1|PC|100,00|0,00|0|090|1556|1556|0,00|20,50|0,00|0,00|0,00|0,00|0|||0,00|0,00|0,00|04||||||04|||`;
t('2075 dispara: ALIQ 20,50 com BC 0 e ICMS 0', () => {
    assert.ok(fires(H([C100(CHAVE()), C170ub]), 'DOC-C170-ICMSSEMBASE-01'));
});
t('2075 sugere zerar a alíquota (campo 14)', () => {
    const e = run(H([C100(CHAVE()), C170ub])).erros.find(x => x.regra_id === 'DOC-C170-ICMSSEMBASE-01');
    assert.strictEqual(e.campoIdx, 14);
    assert.strictEqual(e.valorSugerido, '0,00');
});

// ---------- DOC-C190-ICMSSEMBASE-01 (E-Aud 2951) ----------
const C190ub = `|C190|090|1556|20,50|100,00|0,00|0,00|0,00|0,00|0,00|0,00||`;
t('2951 dispara: C190 ALIQ 20,50 com BC 0', () => {
    assert.ok(fires(H([C100(CHAVE()), C190ub]), 'DOC-C190-ICMSSEMBASE-01'));
});
t('2951 sugere zerar alíquota (campo 4)', () => {
    const e = run(H([C100(CHAVE()), C190ub])).erros.find(x => x.regra_id === 'DOC-C190-ICMSSEMBASE-01');
    assert.strictEqual(e.campoIdx, 4);
});

// ---------- DOC-C190-REDBC-01 (E-Aud 2800) ----------
const C190red = `|C190|090|1556|20,50|100,00|0,00|0,00|0,00|0,00|1146,82|0,00||`;
t('2800 dispara: VL_RED_BC com CST 090', () => {
    assert.ok(fires(H([C100(CHAVE(), { sit: '00' }), C190red]), 'DOC-C190-REDBC-01'));
});
t('2800 NÃO dispara com CST x20', () => {
    const c190ok = `|C190|020|1556|20,50|100,00|50,00|10,25|0,00|0,00|50,00|0,00||`;
    assert.ok(!fires(H([C100(CHAVE(), { sit: '00' }), c190ok]), 'DOC-C190-REDBC-01'));
});

// ---------- EST-9900-REGBLC-01 (E-Aud 2037) ----------
t('2037 dispara p/ 9900 de registro ausente (D100)', () => {
    assert.ok(fires(H(['|9900|D100|5|', '|9900|C100|1|']), 'EST-9900-REGBLC-01'));
});
t('2037 NÃO dispara p/ 9900 de registro presente', () => {
    assert.ok(!fires(H([C100(CHAVE()), '|9900|C100|1|']), 'EST-9900-REGBLC-01'));
});
t('2037 severidade por QTD (painel §2.5): QTD>0 ausente → BLOQ (omissão); QTD 0 → ADV', () => {
    const r = run(H(['|9900|D100|5|', '|9900|C500|0|']));
    const eD = r.erros.find(e => e.regra_id === 'EST-9900-REGBLC-01' && (e.detalhe || '').includes('D100'));
    const eC = r.erros.find(e => e.regra_id === 'EST-9900-REGBLC-01' && (e.detalhe || '').includes('C500'));
    assert.strictEqual(eD.severidade, 'BLOQ');
    assert.strictEqual(eC.severidade, 'ADV');
});

// ---------- DOC-C190-VLICMS-01 (E-Aud 2481) — fórmula CORRETA do painel: C190 vs Σ VL_ICMS(C170) ----------
const C170vi = (item, cst, cfop, aliq, vlIcms) => `|C170|${item}|IT${item}|DESC|1|UN|100,00|0|0|${cst}|${cfop}|0|100,00|${aliq}|${vlIcms}|0|0||||0,00|0,00|0,00|04||||||04|||`;
t('2481 dispara: VL_ICMS do C190 ≠ Σ VL_ICMS dos C170 (mesmo CST|CFOP|ALIQ)', () => {
    const c190 = `|C190|000|1102|20,50|200,00|200,00|99,99|0|0|0,00|0,00||`; // ΣC170=41,00, C190=99,99
    assert.ok(fires(H([C100(CHAVE()), C170vi('1', '000', '1102', '20,50', '20,50'), C170vi('2', '000', '1102', '20,50', '20,50'), c190]), 'DOC-C190-VLICMS-01'));
});
t('2481 NÃO dispara quando C190 = Σ C170 (mesmo com round(BC×ALIQ) diferente — arredondamento legítimo)', () => {
    const c190 = `|C190|000|1102|20,50|5,00|5,00|1,02|0|0|0,00|0,00||`; // ΣC170=1,02 (=C190), embora round(5,00×20,5%)=1,03
    assert.ok(!fires(H([C100(CHAVE()), C170vi('1', '000', '1102', '20,50', '0,51'), C170vi('2', '000', '1102', '20,50', '0,51'), c190]), 'DOC-C190-VLICMS-01'));
});

// ---------- CAD-0400-CFOP-01 (E-Aud 2441) ----------
t('2441 dispara p/ COD_NAT 1652', () => {
    assert.ok(fires(H(['|0400|1652|COMPRA DE COMBUSTIVEL|']), 'CAD-0400-CFOP-01'));
});
t('2441 NÃO dispara p/ código próprio 001', () => {
    assert.ok(!fires(H(['|0400|001|VENDA BALCAO|']), 'CAD-0400-CFOP-01'));
});
t('2441 é SÓ-DETECÇÃO (nunca corrigível: COD_NAT é FK)', () => {
    const e = run(H(['|0400|1652|COMPRA DE COMBUSTIVEL|'])).erros.find(x => x.regra_id === 'CAD-0400-CFOP-01');
    assert.strictEqual(e.campoIdx, null);        // engine normaliza campoIdx ausente → null
    assert.strictEqual(e.corrigivel, false);     // sem campoIdx → não corrigível
    assert.strictEqual(e.classeCorrecao, 'manual');
});

// ---------- COMB-0206-1300-01 (E-Aud 2321) ----------
t('2321 dispara p/ produto com 0206 sem 1300', () => {
    const txt = H(['|0200|46|LUBRAX|||||27||||', '|0206|620501001|', r1300('1', '01062026', '0', '0', '0', '0', '0', '0', '0', '0')]);
    assert.ok(fires(txt, 'COMB-0206-1300-01'));
});
t('2321 NÃO dispara quando o produto tem 1300', () => {
    const txt = H(['|0200|1|GASOLINA|||||27||||', '|0206|320101001|', r1300('1', '01062026', '0', '0', '0', '0', '0', '0', '0', '0')]);
    assert.ok(!fires(txt, 'COMB-0206-1300-01'));
});
t('2321 gate (a): arquivo SEM nenhum 1300 → não dispara (distribuidora/sem LMC)', () => {
    assert.ok(!fires(H(['|0200|46|LUBRAX|||||27||||', '|0206|620501001|']), 'COMB-0206-1300-01'));
});

// ---------- DOC-C170-CODCTA-01 (E-Aud 2451) ----------
const C170semCta = `|C170|1|4|GASOLINA|1|L|100,00|0,00|0|061|1652|1652|0,00|0,00|0,00|0,00|0,00|0,00|0|||0,00|0,00|0,00|04||||||04||||`;
t('2451 dispara quando COD_CTA vazio', () => {
    assert.ok(fires(H([C100(CHAVE()), C170semCta]), 'DOC-C170-CODCTA-01'));
});
t('2451 sem 0500 → detalhe marca legítimo e não é corrigível', () => {
    const e = run(H([C100(CHAVE()), C170semCta])).erros.find(x => x.regra_id === 'DOC-C170-CODCTA-01');
    assert.ok(/leg[íi]timo|desconsider/i.test(e.detalhe));
    assert.strictEqual(e.campoIdx, null);
});

// ---------- DOC-C100-5929-01 (E-Aud 1003) ----------
t('1003 dispara p/ 5929 com ICMS', () => {
    const c190 = `|C190|061|5929|20,50|9574,80|160,00|32,80|0,00|0,00|0,00|0,00||`;
    assert.ok(fires(H([C100(CHAVE()), c190]), 'DOC-C100-5929-01'));
});
t('1003 NÃO dispara p/ 5929 zerado', () => {
    const c190 = `|C190|061|5929|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00||`;
    assert.ok(!fires(H([C100(CHAVE()), c190]), 'DOC-C100-5929-01'));
});
t('1003 M4: NF com split 060/061 (2 C190 5929) = 1 achado por documento', () => {
    const a = `|C190|060|5929|0,00|100,00|0,00|0,00|0,00|0,00|0,00|0,00||`;
    const b = `|C190|061|5929|0,00|150,00|0,00|0,00|0,00|0,00|0,00|0,00||`;
    assert.equal(run(H([C100(CHAVE()), a, b])).erros.filter(e => e.regra_id === 'DOC-C100-5929-01').length, 1);
});
t('1003 M4: se qualquer C190 é FORTE (ICMS≠0), o documento é BLOQ', () => {
    const fraco = `|C190|060|5929|0,00|100,00|0,00|0,00|0,00|0,00|0,00|0,00||`;
    const forte = `|C190|061|5929|20,50|9574,80|160,00|32,80|0,00|0,00|0,00|0,00||`;
    const e = run(H([C100(CHAVE()), fraco, forte])).erros.find(x => x.regra_id === 'DOC-C100-5929-01');
    assert.equal(e.severidade, 'BLOQ');
});

// ---------- COMB-1300-1320-01 (E-Aud 2023: VOL_SAIDAS 1300 ≠ Σ VOL_VENDAS 1320) ----------
const r1320v = (vendas) => `|1320|01||||||0,000|0,000|0,000|${vendas}|`;
t('2023 +: VOL_SAIDAS != Σ bicos (diff real) dispara', () => assert.ok(fires(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1320v('5,000')]), 'COMB-1300-1320-01')));
t('2023 -: VOL_SAIDAS == Σ bicos não dispara', () => assert.ok(!fires(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '10,000', '90,000', '0,000', '0,000', '90,000'), r1320v('10,000')]), 'COMB-1300-1320-01')));
t('2023 -: diferença de arredondamento (0,005 L) é tolerada', () => assert.ok(!fires(H([r1300('7084', '01012026', '100,000', '0,000', '100,000', '14,405', '85,595', '0,000', '0,000', '85,595'), r1320v('14,410')]), 'COMB-1300-1320-01')));

// ---------- DOC-C100-SEQ-01 (E-Aud 4028: intervalo na sequência numérica de NF próprias) ----------
const CSEQ = (mod, ser, num, emit = '0', sit = '00') => `|C100|1|${emit}|P|${mod}|${sit}|${ser}|${num}|${CHAVE()}|01012022|01012022|100,00|`;
t('4028 +: gap na série própria dispara', () => assert.ok(fires(H([CSEQ('65', '5', '100'), CSEQ('65', '5', '102')]), 'DOC-C100-SEQ-01')));
t('4028 -: números consecutivos não dispara', () => assert.ok(!fires(H([CSEQ('65', '5', '100'), CSEQ('65', '5', '101')]), 'DOC-C100-SEQ-01')));
t('4028 -: notas de terceiros (IND_EMIT=1) não entram', () => assert.ok(!fires(H([CSEQ('65', '5', '100', '1'), CSEQ('65', '5', '102', '1')]), 'DOC-C100-SEQ-01')));
t('4028 -: notas sem série não entram', () => assert.ok(!fires(H([CSEQ('65', '', '100'), CSEQ('65', '', '102')]), 'DOC-C100-SEQ-01')));
t('4028 -: modelos diferentes não se misturam na sequência', () => assert.ok(!fires(H([CSEQ('55', '5', '100'), CSEQ('65', '5', '102')]), 'DOC-C100-SEQ-01')));

// ---------- DOC-C190-CFOPUF-01 (E-Aud 2742: CFOP interno 1/5 com participante de outra UF) ----------
// H() declara UF=BA. 0150 com COD_MUN 3550308 = SP (35); 2921708 = BA (29).
const P0150 = (part, codMun, pais = '1058') => `|0150|${part}|FORN|${pais}|${part}|||${codMun}||END|1||B|`;
t('2742 +: CFOP 5 com participante SP (declarante BA) dispara', () => assert.ok(fires(H([P0150('PSP', '3550308'), C100(CHAVE(), { part: 'PSP' }), C190({ cfop: '5929' })]), 'DOC-C190-CFOPUF-01')));
t('2742 -: CFOP 5 com participante BA (mesma UF) não dispara', () => assert.ok(!fires(H([P0150('PBA', '2921708'), C100(CHAVE(), { part: 'PBA' }), C190({ cfop: '5929' })]), 'DOC-C190-CFOPUF-01')));
t('2742 -: CFOP 6 (interestadual) com participante SP não dispara', () => assert.ok(!fires(H([P0150('PSP', '3550308'), C100(CHAVE(), { part: 'PSP' }), C190({ cfop: '6929' })]), 'DOC-C190-CFOPUF-01')));
t('2742 -: participante do exterior (COD_PAIS≠1058) não dispara', () => assert.ok(!fires(H([P0150('PEX', '', '2496'), C100(CHAVE(), { part: 'PEX' }), C190({ cfop: '5929' })]), 'DOC-C190-CFOPUF-01')));

// ---------- changelog: detalhe item-a-item preservado sob o grupo (relatório "o que foi corrigido") ----------
// Duas NFs corrigidas no MESMO campo→mesmo valor agrupam em 1 entrada ×2, mas cada item (chave/antes)
// deve ficar em `itens[]` para o relatório e o PDF listarem NF a NF (não só "×2").
t('changelog: aplicar agrupa mas retém itens[] com a chave de cada NF', () => {
    const { Changelog } = require('../services/validador/changelog');
    const log = new Changelog();
    const l = ['|0200|AAA|DESC A|11111| |UN|07|96081000||96||||', '|0200|BBB|DESC B|22222| |UN|07|96081000||96||||'];
    aplicar(l, [
        { registro: '0200', chave_natural: 'AAA', campo_idx: 4, valor_corrigido: '', regra_id: 'DOC-X', origem: 'MANUAL' },
        { registro: '0200', chave_natural: 'BBB', campo_idx: 4, valor_corrigido: '', regra_id: 'DOC-X', origem: 'MANUAL' },
    ], log);
    const ent = log.entradas.find(e => e.registro === '0200');
    assert.ok(ent, 'deve existir entrada 0200 no changelog');
    assert.equal(ent.qtd, 2, 'grupo conta as 2 ocorrências');
    assert.ok(Array.isArray(ent.itens), 'entrada deve trazer itens[]');
    assert.equal(ent.itens.length, 2, 'itens deve listar cada NF corrigida');
    assert.deepEqual(ent.itens.map(i => i.chave).sort(), ['AAA', 'BBB'], 'cada item guarda sua chave');
    assert.deepEqual(ent.itens.map(i => i.antes).sort(), ['11111', '22222'], 'cada item guarda seu antes');
});

// ---------- relatório: agrupar pendências (erros restantes após as correções) ----------
t('agruparPendencias: agrupa por regra, BLOQ primeiro, conta e lista cada item', () => {
    const { agruparPendencias } = require('../services/validador/relatorioCorrecoes-pdf');
    const g = agruparPendencias([
        { regra_id: 'A', registro: '1300', severidade: 'ADV', detalhe: 'd1' },
        { regra_id: 'A', registro: '1300', severidade: 'ADV', detalhe: 'd2' },
        { regra_id: 'B', registro: 'C170', severidade: 'BLOQ', detalhe: 'd3' },
    ]);
    assert.equal(g.length, 2, 'duas regras');
    assert.equal(g[0].regra_id, 'B', 'BLOQ vem primeiro');
    assert.equal(g[0].severidade, 'BLOQ');
    const a = g.find(x => x.regra_id === 'A');
    assert.equal(a.total, 2, 'conta as 2 ocorrências');
    assert.equal(a.itens.length, 2, 'lista cada item');
    assert.deepEqual(a.itens.map(i => i.detalhe), ['d1', 'd2']);
});
t('agruparPendencias: lista vazia → []', () => {
    const { agruparPendencias } = require('../services/validador/relatorioCorrecoes-pdf');
    assert.deepEqual(agruparPendencias([]), []);
    assert.deepEqual(agruparPendencias(null), []);
});

// ---------- relatório: agrupar correções por "correção sugerida" (cards estilo E-Auditor) ----------
t('agruparPorSugestao: junta por regra, expande itens NF-a-NF, soma total', () => {
    const { agruparPorSugestao } = require('../services/validador/relatorioCorrecoes-pdf');
    const agrupado = [
        { bloco: 'C', total: 3, registros: [
            { registro: 'C170', total: 2, itens: [
                { registro: 'C170', regraId: 'USO-CONSUMO-X90', campo: 'CST_ICMS', antes: '060', depois: '090', origem: 'fiscal', qtd: 2, motivo: 'uso/consumo', itens: [
                    { chave: 'NF1', antes: '060', depois: '090' }, { chave: 'NF2', antes: '060', depois: '090' } ] } ] },
            { registro: 'C190', total: 1, itens: [
                { registro: 'C190', regraId: 'USO-CONSUMO-X90', campo: 'CST_ICMS', antes: '060', depois: '090', origem: 'fiscal', qtd: 1, motivo: 'uso/consumo' } ] } ] },
    ];
    const cards = agruparPorSugestao(agrupado);
    assert.equal(cards.length, 1, 'mesma regra → 1 card');
    assert.equal(cards[0].regraId, 'USO-CONSUMO-X90');
    assert.equal(cards[0].total, 3, 'soma qtd (2 + 1)');
    assert.equal(cards[0].correcoes.length, 3, '2 expandidos por NF + 1 sem itens');
    assert.equal(cards[0].correcoes[0].chave, 'NF1');
    assert.equal(cards[0].correcoes[2].chave, null, 'entrada sem itens vira 1 linha sem chave');
    assert.ok(typeof cards[0].descricao === 'string' && cards[0].descricao.length > 0, 'tem descrição legível');
});

// ---------- resultado ----------
console.log(`\nValidador — suíte unitária: ${pass} passou, ${fail} falhou (de ${pass + fail})`);
if (fail) { console.log('\nFALHAS:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('✓ tudo verde');
