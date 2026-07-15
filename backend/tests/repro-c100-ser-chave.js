// tests/repro-c100-ser-chave.js — DOC-C100-SER-01: SER do C100 ≠ série contida na chave.
// PVA: "O campo série que compõe a chave deverá ser igual ao campo Série informado no registro."
// Caso real: POSTO PREÇO BOM (10795278000156, 01/2026), NUM_DOC 89278, SER=000 vs chave série=001.
// Uso: node tests/repro-c100-ser-chave.js
const regra = require('../services/validador/rules/r_c100_ser_chave');
const { corrigirSerChave } = require('../services/spedCostureiraService');

// C100 com SER=000 mas chave (posições 23-25) = 001
const CHV = '29260110795278000156550010000892781025838224';
const C100_BAD = `|C100|1|0|10795278000156|55|08|000|89278|${CHV}|03012026|03012026|1406,90|2|0,00|0,00|1406,90|9|0,00|0,00|0,00|37,50|7,69|0,00|0,00|0,00|0,49|2,27|||`;
// C100 já coerente (SER=001) — não deve ser tocado nem acusado
const C100_OK  = `|C100|1|0|10795278000156|55|08|001|89279|29260110795278000156550010000892791025838225|03012026|03012026|10,00|2|0,00|0,00|10,00|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|||`;
// C100 cancelado (COD_SIT 02) com SER divergente — NÃO deve ser acusado (pula cancelado)
const C100_CANC = `|C100|1|0|10795278000156|55|02|000|89280|29260110795278000156550010000892801025838226|03012026|03012026|0,00|2|0,00|0,00|0,00|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|||`;

let fail = 0;
function check(cond, msg) { if (cond) console.log('  OK  ' + msg); else { console.error('  FAIL ' + msg); fail++; } }

// ---- 1) DETECÇÃO ----
const mkLinha = (s, n) => ({ n, f: s.split('|') });
const model = { porReg: new Map([['C100', [mkLinha(C100_BAD, 4447), mkLinha(C100_OK, 4460), mkLinha(C100_CANC, 4470)]]]) };
const erros = regra.detectar(model);
check(erros.length === 1, 'detecta exatamente 1 erro (só o SER=000)');
check(erros[0] && erros[0].linha === 4447 && erros[0].valorSugerido === '001' && erros[0].campoIdx === 7,
    'erro aponta linha 4447, campo SER (7), valorSugerido "001"');

// ---- 2) CORREÇÃO ----
const linhas = [C100_BAD, C100_OK, C100_CANC];
const n = corrigirSerChave(linhas, null);
check(n === 1, 'corrige exatamente 1 C100');
check(linhas[0].split('|')[7] === '001', 'C100 ruim: SER 000 → 001');
check(linhas[1] === C100_OK, 'C100 já coerente fica byte-idêntico');
check(linhas[2] === C100_CANC, 'C100 cancelado não é tocado');
// idempotência
check(corrigirSerChave(linhas.slice(), null) === 0, 'idempotente: rodar de novo não muda nada');

if (fail) { console.error('\nREPRO FALHOU: ' + fail + ' assert(s).'); process.exit(1); }
console.log('\nrepro-c100-ser-chave: todos os asserts passaram.');
