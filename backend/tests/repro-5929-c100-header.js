// tests/repro-5929-c100-header.js — REPRO do bug DOC-C100-5929-01.
// corrigir5929Bitributacao zera o ICMS do C190 (espelho de ECF) e decrementa o E110, MAS
// esquecia de ajustar o cabeçalho C100 (campos 21 VL_BC_ICMS / 22 VL_ICMS) → soma(C190) ≠ C100
// → PVA: "soma VL_ICMS dos analíticos deve ser igual ao C100". Caso real: POSTO PREÇO BOM
// (10795278000156, 01/2026), 125 notas 5929 p/ TRANSPORTES FRILEM. Uso: node tests/repro-5929-c100-header.js
const assert = require('assert');
const { corrigir5929Bitributacao } = require('../services/spedCostureiraService');

const num = (v) => parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0;

// C100 saída própria (IND_OPER=1) com parcela tributada: campo 21 VL_BC_ICMS=113,15, campo 22 VL_ICMS=23,20
const C100_5929 = '|C100|1|0|41700890000121|55|08|001|88775|29260110795278000156550010000887751025717100|01012026|01012026|2480,50|2|0,00|0,00|2480,50|9|0,00|0,00|0,00|113,15|23,20|0,00|0,00|0,00|1,48|6,84|||';
const C190_000  = '|C190|000|5929|20,50|113,15|113,15|23,20|0,00|0,00|0,00|0,00|';   // tributada-integral FORTE → será zerada
const C190_061  = '|C190|061|5929|0,00|2367,35|0,00|0,00|0,00|0,00|0,00|0,00|';       // monofásico, já 0 → intocada
// Gate de cupom: precisa de ao menos uma NFC-e (mod 65) no arquivo
const C100_CUPOM = '|C100|1|1|9999999999|65|00|001|1|CHVCUPOM|01012026|01012026|10,00|0|0,00|0,00|10,00|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|||';
const E110 = '|E110|1000,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|1000,00|1000,00|0,00|';

const entrada = [C100_5929, C190_000, C190_061, C100_CUPOM, E110];
const out = corrigir5929Bitributacao(entrada.slice(), 'BA', null);

// Localiza o C100 do 5929 e seus C190 na saída
const c100 = out.find(l => l.includes('0000887751025717100'));
const c190s = out.filter(l => l.startsWith('|C190|') && l.split('|')[3] === '5929');
const somaBC   = c190s.reduce((s, l) => s + num(l.split('|')[6]), 0);
const somaIcms = c190s.reduce((s, l) => s + num(l.split('|')[7]), 0);
const h = c100.split('|');

let fail = 0;
function check(cond, msg) { if (cond) { console.log('  OK  ' + msg); } else { console.error('  FAIL ' + msg); fail++; } }

console.log('C190 (5929) após correção:'); c190s.forEach(l => console.log('   ' + l));
console.log('C100 após correção: VL_BC_ICMS(21)=' + h[21] + '  VL_ICMS(22)=' + h[22]);

// 1) o C190 tributado foi zerado e relabelado x90 (comportamento já existente, anti-bitributação)
check(somaIcms < 0.005 && somaBC < 0.005, 'soma dos C190 5929 ficou zerada (ICMS espelho de ECF removido)');
// 2) NÚCLEO DO BUG: o cabeçalho C100 deve bater com a soma dos C190 (invariante do PVA)
check(Math.abs(num(h[21]) - somaBC) < 0.005, 'C100.VL_BC_ICMS == soma C190.VL_BC_ICMS (' + h[21] + ' vs ' + somaBC.toFixed(2) + ')');
check(Math.abs(num(h[22]) - somaIcms) < 0.005, 'C100.VL_ICMS == soma C190.VL_ICMS (' + h[22] + ' vs ' + somaIcms.toFixed(2) + ')');
// 3) E110 decrementado (regressão do comportamento existente)
const e110 = out.find(l => l.startsWith('|E110|'));
check(Math.abs(num(e110.split('|')[2]) - (1000 - 23.20)) < 0.005, 'E110.VL_TOT_DEBITOS decrementado em 23,20');

if (fail) { console.error('\nREPRO FALHOU: ' + fail + ' assert(s).'); process.exit(1); }
console.log('\nrepro-5929-c100-header: todos os asserts passaram.');
