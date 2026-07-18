// Coerência CST×base no registro C175 — a consolidação analítica de PIS/COFINS que os POSTOS
// usam no lugar do C170 (venda por cupom). Caso sintético determinístico.
// C175 split('|'): f5=CST_PIS, f6=VL_BC_PIS, f7=ALIQ_PIS, f10=VL_PIS, f11=CST_COFINS, f16=VL_COFINS.
//
// Uso: node backend/tests/contrib-validador-c175.test.js

const assert = require('assert');
const { validarContribuicoes } = require('../services/contribuicoes/validadorContribuicoes');

function main() {
  const parsed = {
    eol: '\r\n', trailingEol: true, meta: { regime: '1' },
    linhas: [
      // CST 01 COM base/valor → OK
      { num: 1, reg: 'C175', bloco: 'C', raw: '|C175|5102|100,00|0,00|01|100,00|1,6500| | |1,65|01|100,00|7,6000| | |7,60| | |' },
      // CST 01 SEM base/valor → deve apontar CST_SEM_BASE
      { num: 2, reg: 'C175', bloco: 'C', raw: '|C175|5102|100,00|0,00|01| | | | | |01| | | | | | | |' },
      // CST 06 (alíquota zero) com zeros → OK
      { num: 3, reg: 'C175', bloco: 'C', raw: '|C175|5405|100,00|0,00|06|0,00|0,0000| | |0,00|06|0,00|0,0000| | |0,00| | |' },
    ],
  };

  const r = validarContribuicoes(parsed);
  const semBase = r.apontamentos.filter(a => a.tipo === 'CST_SEM_BASE' && a.reg === 'C175');
  assert.strictEqual(semBase.length, 1, `esperado 1 CST_SEM_BASE em C175; veio ${semBase.length}`);
  assert.strictEqual(semBase[0].linha, 2, 'deve apontar a linha 2 (CST 01 sem base)');

  console.log('✓ validador C175 (coerência CST×base do consolidado de posto) OK');
}

main();
