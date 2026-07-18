// Validador em arquivo real de POSTO (regime cumulativo). Fixture: docs/sped_pis_cofins_POSTO CG...
// POSTO CG é regime 2 (cumulativo) e tem 1 entrada CST 50 (crédito) — VEDADO no cumulativo → ALTA.
// Pula se o fixture não estiver presente (arquivo real de cliente, fora do git).
//
// Uso: node backend/tests/contrib-validador-posto.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseContribuicoes } = require('../services/spedContribuicoesService');
const { validarContribuicoes } = require('../services/contribuicoes/validadorContribuicoes');

const ARQ = path.join(__dirname, '..', '..', 'docs', 'sped_pis_cofins_POSTO CG_detalhado_062026_v1_211.txt');

function main() {
  if (!fs.existsSync(ARQ)) {
    console.log('· fixture POSTO CG ausente — teste pulado (ok em checkout sem os SPEDs reais).');
    return;
  }
  const parsed = parseContribuicoes(fs.readFileSync(ARQ).toString('latin1'));
  const r = validarContribuicoes(parsed);

  assert.strictEqual(parsed.meta.regime, '2', 'POSTO CG deve ser regime cumulativo (0110=2)');

  const cred = r.apontamentos.filter(a => a.tipo === 'CREDITO_ENTRADA');
  assert.strictEqual(cred.length, 1, `esperado 1 crédito de entrada (CST 50); veio ${cred.length}`);
  // No regime CUMULATIVO o crédito é vedado → severidade ALTA e mensagem específica.
  assert.strictEqual(cred[0].severidade, 'ALTA', 'crédito em regime cumulativo deve ser ALTA (vedado)');
  assert.ok(/cumulativo/i.test(cred[0].detalhe), 'a mensagem deve mencionar a vedação no regime cumulativo');

  console.log(`✓ validador POSTO (cumulativo) OK — crédito de entrada CST 50 marcado como VEDADO (ALTA)`);
}

main();
