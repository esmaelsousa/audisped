// Teste puro (sem DB/HTTP) do adaptador mde_cache → conciliar():
//   node backend/tests/conciliacao-mde.test.js
// Cobre a DETECÇÃO VERDADEIRA do Loop A (SEFAZ tem × SPED não tem = faltante) e a
// divergência de valor (Loop B), a partir dos dados vivos do EspiãoNFe (mde_cache),
// reaproveitando o mesmo conciliar() já usado pelo CSV.
const assert = require('assert');
const { conciliar, sefazShapeFromMdeCache } = require('../services/conciliacaoService');

let pass = 0, fail = 0; const fails = [];
const t = (nome, fn) => { try { fn(); pass++; } catch (e) { fail++; fails.push(`${nome} → ${e.message}`); } };

// chave de 44 dígitos: UF(2)+AAMM(4)+CNPJ(14)+resto(24). AAMM=2606 → competência 06/2026.
const CH = (cnpj14, suf) => ('35' + '2606' + cnpj14 + suf).padEnd(44, '0').slice(0, 44);
const FORN = '11222333000181';
const CH_OK  = CH(FORN, '5500100001');
const CH_FALT = CH(FORN, '5500100002');
const CH_DIV = CH(FORN, '5500100003');
const CH_SAIDA = CH(FORN, '5500100004');

// mde_cache (destinadas vivas da SEFAZ via EspiãoNFe): entradas + 1 saída (deve ser ignorada).
const mdeRows = [
    { chave_nfe: CH_OK,   numero: '1', valor: '1000.00', data_emissao: '2026-06-10', nome_emissor: 'FORN X', tipo_operacao: 'Entrada' },
    { chave_nfe: CH_FALT, numero: '2', valor: '500.00',  data_emissao: '2026-06-12', nome_emissor: 'FORN X', tipo_operacao: 'Entrada' },
    { chave_nfe: CH_DIV,  numero: '3', valor: '800.00',  data_emissao: '2026-06-14', nome_emissor: 'FORN X', tipo_operacao: 'Entrada' },
    { chave_nfe: CH_SAIDA,numero: '4', valor: '999.00',  data_emissao: '2026-06-15', nome_emissor: 'PROPRIA', tipo_operacao: 'Saída' },
];
// escrituração (documentos_c100 do SPED): tem OK (valor certo) e DIV (valor errado); NÃO tem FALT.
const escrituradas = [
    { chv_nfe: CH_OK,  num_doc: '1', vl_doc: '1000.00', periodo_apuracao: '2026-06-01', dt_doc: '10062026', dt_e_s: '10062026', fornecedor: 'FORN X' },
    { chv_nfe: CH_DIV, num_doc: '3', vl_doc: '700.00',  periodo_apuracao: '2026-06-01', dt_doc: '14062026', dt_e_s: '14062026', fornecedor: 'FORN X' },
];

const run = () => conciliar({ csv: sefazShapeFromMdeCache(mdeRows), escrituradas, cnpjEmpresa: '99999999999999', escopoYM: '202606' });

t('adaptador: shape compatível (invoices só entradas, saída excluída)', () => {
    const csv = sefazShapeFromMdeCache(mdeRows);
    assert.equal(csv.invoices.length, 3, 'saída deve ser ignorada (3 entradas)');
    assert.ok(csv.byChave.get(CH_OK), 'byChave indexado');
    assert.equal(csv.minYM, '202606'); assert.equal(csv.maxYM, '202606');
});
t('Loop A: faltante verdadeiro (SEFAZ tem, SPED não)', () => {
    const r = run();
    assert.equal(r.faltantes.length, 1, 'só CH_FALT');
    assert.equal(r.faltantes[0].chave, CH_FALT);
});
t('Loop B: divergência de valor detectada', () => {
    const r = run();
    assert.equal(r.divergencia_valor.length, 1);
    assert.equal(r.divergencia_valor[0].chave, CH_DIV);
    assert.equal(Math.round(r.divergencia_valor[0].dif), 100); // 800 SEFAZ − 700 SPED
});
t('nota OK não vira faltante nem divergência', () => {
    const r = run();
    assert.ok(!r.faltantes.some(f => f.chave === CH_OK));
    assert.ok(!r.divergencia_valor.some(d => d.chave === CH_OK));
});
t('saída própria não vira faltante', () => {
    const r = run();
    assert.ok(!r.faltantes.some(f => f.chave === CH_SAIDA));
});

console.log(`Conciliação mde_cache — ${pass} passou, ${fail} falhou (de ${pass + fail})`);
if (fail) { console.log('FALHAS:'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
