// backend/tests/dedup-c100-e110.test.js
//   node backend/tests/dedup-c100-e110.test.js   (unitário, sem DB)
//
// O export remove C100 duplicados (chave repetida) E SEUS FILHOS — inclusive os C190, que carregam
// ICMS somado no VL_TOT_DEBITOS do E110. Até 2026-09-15 o E110 não era abatido, então o arquivo saía
// com Σ analíticos < E110 e o PVA barrava: "O valor deve ser igual à soma do campo VL_ICMS dos
// registros C190/C320/... para CFOP iniciado por 5, 6, 7 e CFOP 1605".
//
// Caso real: POSTO PREÇO BOM (10795278000156) 01/2026, arq 2350 — 52 duplicados carregando
// exatamente 48,99 de ICMS; o PVA esperava 40.550,29 e o E110 declarava 40.599,28.
const assert = require('assert');
const { deduparC100, recalcularE110 } = require('../services/spedCostureiraService');

let ok = 0;
const t = (nome, fn) => { fn(); console.log('  ok —', nome); ok++; };
const F = (l, i) => l.split('|')[i];

const CH = (n) => String(n).padStart(44, '0');
const C100 = (ch) => `|C100|1|1||55|00|001|1|${ch}|01012026|01012026|100,00|0|0,00|0,00|100,00|9|0,00|0,00|0,00|0,00|0,00||||||||`;
const C170 = (cfop) => `|C170|1|P1||1,00000|UN|100,00|0,00|0|000|${cfop}||100,00|18,00|18,00|0,00|0,00|0,00|0|`;
const C190 = (cfop, icms) => `|C190|000|${cfop}|18,00|100,00|100,00|${icms}|0,00|0,00|0,00|0,00||`;
// E110 real do arq 2350: 40599,28 débitos − 22417,01 créditos = 18182,27 apurado/a recolher.
const E110 = (deb) => `|E110|${deb}|0,00|0,00|0,00|22417,01|0,00|0,00|0,00|0,00|18182,27|0,00|18182,27|0,00|0,00|`;

console.log('dedup-c100-e110:');

// 1. Nada duplicado → array ORIGINAL (mesma referência) e E110 intacto. Garantia p/ o golden.
t('sem duplicado → byte-idêntico e E110 intacto', () => {
    const L = [C100(CH(1)), C170('5102'), C190('5102', '18,00'), E110('40599,28')];
    const r = deduparC100(L);
    assert.strictEqual(r.linhas, L, 'deveria devolver a MESMA referência');
    assert.equal(r.removidos, 0);
    assert.equal(r.icmsAbatido, 0);
});

// 2. O caso que motivou: duplicado de SAÍDA → remove e abate o ICMS do VL_TOT_DEBITOS.
t('duplicado de saída → remove os filhos e abate o ICMS do E110', () => {
    const L = [C100(CH(1)), C170('5102'), C190('5102', '18,00'),
               C100(CH(1)), C170('5102'), C190('5102', '18,00'),   // ← duplicado
               E110('40599,28')];
    const r = deduparC100(L);
    assert.equal(r.removidos, 1);
    assert.equal(r.icmsAbatido, 1800);                       // centavos
    assert.equal(r.linhas.filter(l => F(l, 1) === 'C100').length, 1);
    assert.equal(r.linhas.filter(l => F(l, 1) === 'C190').length, 1);
    assert.equal(F(r.linhas.find(l => F(l, 1) === 'E110'), 2), '40581,28'); // 40599,28 − 18,00
});

// 3. Duplicado de ENTRADA não entra no VL_TOT_DEBITOS → remove, mas NÃO abate.
t('duplicado de entrada (CFOP 1102) → remove sem abater', () => {
    const L = [C100(CH(2)), C170('1102'), C190('1102', '18,00'),
               C100(CH(2)), C170('1102'), C190('1102', '18,00'),
               E110('40599,28')];
    const r = deduparC100(L);
    assert.equal(r.removidos, 1);
    assert.equal(r.icmsAbatido, 0);
    assert.equal(F(r.linhas.find(l => F(l, 1) === 'E110'), 2), '40599,28'); // intacto
});

// 4. CFOP 1605 é a exceção de entrada que o PVA manda somar.
t('CFOP 1605 conta como débito e É abatido', () => {
    const L = [C100(CH(3)), C190('1605', '5,00'), C100(CH(3)), C190('1605', '5,00'), E110('100,00')];
    const r = deduparC100(L);
    assert.equal(r.icmsAbatido, 500);
    assert.equal(F(r.linhas.find(l => F(l, 1) === 'E110'), 2), '95,00');
});

// 5. Chave de acesso VAZIA nunca é deduplicada (notas distintas sem chave não podem fundir).
t('chave vazia → não deduplica', () => {
    const semCh = `|C100|1|1||55|00|001|1||01012026|01012026|100,00|0|0,00|0,00|100,00|9|0,00|0,00|0,00|0,00|0,00||||||||`;
    const L = [semCh, C190('5102', '18,00'), semCh, C190('5102', '18,00'), E110('100,00')];
    const r = deduparC100(L);
    assert.strictEqual(r.linhas, L);
    assert.equal(r.removidos, 0);
});

// 6. Mais de um E110 → remove o duplicado mas NÃO abate: não dá para saber a qual apuração pertence.
t('dois E110 → remove sem abater (não adivinha a apuração)', () => {
    const L = [C100(CH(4)), C190('5102', '18,00'), C100(CH(4)), C190('5102', '18,00'),
               E110('100,00'), E110('200,00')];
    const r = deduparC100(L);
    assert.equal(r.removidos, 1);
    assert.equal(r.icmsAbatido, 0);
    assert.equal(F(r.linhas.filter(l => F(l, 1) === 'E110')[0], 2), '100,00');
});

// 7. Cascata completa: após o abatimento o recalcularE110 refaz saldo apurado e ICMS a recolher.
//    Reproduz o arq 2350: 48,99 abatidos → 40550,29 débitos → 18133,28 apurado/a recolher.
t('cascata: abatimento → VL_SLD_APURADO e VL_ICMS_RECOLHER acompanham', () => {
    const L = [C100(CH(5)), C190('5102', '48,99'), C100(CH(5)), C190('5102', '48,99'), E110('40599,28')];
    const r = deduparC100(L);
    assert.equal(r.icmsAbatido, 4899);
    recalcularE110(r.linhas);
    const e = r.linhas.find(l => F(l, 1) === 'E110').split('|');
    assert.equal(e[2], '40550,29', 'VL_TOT_DEBITOS');
    assert.equal(e[11], '18133,28', 'VL_SLD_APURADO');
    assert.equal(e[13], '18133,28', 'VL_ICMS_RECOLHER');
});

// 8. Linhas que não são registro (vazias / lixo) passam intactas — o export chama isto sobre fileLines.
t('linhas não-registro passam intactas', () => {
    const L = ['', C100(CH(6)), C190('5102', '1,00'), '', C100(CH(6)), C190('5102', '1,00'), E110('10,00'), ''];
    const r = deduparC100(L);
    assert.equal(r.removidos, 1);
    assert.equal(r.linhas.filter(l => l === '').length, 3);
});

console.log(`\n${ok} casos ok`);
