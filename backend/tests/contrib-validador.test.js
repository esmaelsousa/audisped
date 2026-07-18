// Fase 2 — Validador (read-only) da EFD-Contribuições. Consome o parser + o
// classificador fiscal. NÃO gera nada — só APONTA. Ancorado no arquivo real
// (CASA DA BEBIDA original), onde conhecemos os erros de verdade:
//   - 4 saídas CST 01 (vinho/frisante/menta, linhas 114/135/136/167) SEM base → erro do PVA.
//   - 1 entrada CST 50 (crédito) a conferir (vedação monofásico/ST).
//
// Uso: node backend/tests/contrib-validador.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseContribuicoes } = require('../services/spedContribuicoesService');
const { validarContribuicoes } = require('../services/contribuicoes/validadorContribuicoes');

const ARQ = path.join(__dirname, '..', '..', 'speds', 'EFD_PISCOFINS_CONTRIBUICOES_20260531_CASA DA BEBIDA.txt');

function main() {
  const parsed = parseContribuicoes(fs.readFileSync(ARQ).toString('latin1'));
  const r = validarContribuicoes(parsed);

  // 1) Pega as 4 saídas CST 01 sem base (os erros reais do PVA neste arquivo).
  const semBase = r.apontamentos.filter(a => a.tipo === 'CST_SEM_BASE');
  const linhas = [...new Set(semBase.map(a => a.linha))].sort((a, b) => a - b);
  assert.deepStrictEqual(linhas, [114, 135, 136, 167], `CST_SEM_BASE deve apontar as 4 linhas CST 01; veio ${linhas}`);

  // 2) Sinaliza o crédito de entrada (CST 50) para conferir a vedação.
  assert.ok(r.apontamentos.some(a => a.tipo === 'CREDITO_ENTRADA'), 'deve sinalizar crédito em entrada (CST 50)');

  // 3) Resumo coerente (14 E/99 + 6 E/70 + 1 E/50 + 45 S/06 + 4 S/01 = 70 C170).
  assert.strictEqual(r.resumo.total_c170, 70, `total de C170 esperado 70; veio ${r.resumo.total_c170}`);
  assert.ok(Array.isArray(r.apontamentos) && r.apontamentos.length >= 5, 'deve haver apontamentos');

  // 4) read-only: o validador não muda o parsed.
  assert.strictEqual(parsed.linhas.length, 234, 'parser intacto (validador não altera nada)');

  console.log(`✓ validador OK — ${r.apontamentos.length} apontamentos; CST_SEM_BASE nas linhas ${linhas.join(',')}; ` +
    `${r.resumo.saidas} saídas / ${r.resumo.entradas} entradas`);
}

main();
