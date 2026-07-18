// Fase 2 — núcleo fiscal compartilhado (injetor + validador).
// Classificador: NCM -> bucket fiscal; (bucket x direção) -> CST PIS/COFINS.
// Regras vindas do parecer do painel PIS/COFINS (ver contribuicoes-modulo.md).
// PRINCIPIO: default CONSERVADOR — NCM desconhecida => INDEFINIDO (nao inventa
// tributacao nem credito; o consumidor decide: validador ALERTA, injetor BLOQUEIA).
//
// Uso: node backend/tests/contrib-classificador.test.js

const assert = require('assert');
const { classificarNcm, regraCst, BUCKET } = require('../services/contribuicoes/classificadorFiscal');

function main() {
  // ---- NCM -> bucket. Seed SÓ com o incontestável (as 2 lentes concordam);
  //      o disputado (bebidas frias) fica INDEFINIDO até o contador confirmar. ----
  // Incontestável:
  assert.strictEqual(classificarNcm('27101259').bucket, BUCKET.MONOFASICO, 'gasolina 2710 = monofasico (settled)');
  assert.strictEqual(classificarNcm('22042100').bucket, BUCKET.NORMAL, 'vinho 2204 = tributacao normal (settled)');
  assert.strictEqual(classificarNcm('22089000').bucket, BUCKET.NORMAL, 'licor/menta 2208 = tributacao normal (settled)');
  assert.strictEqual(classificarNcm('27101259').confianca, 'ALTA', 'seed incontestavel = confianca ALTA');

  // DISPUTADO entre as lentes (Lei 13.097/2015) => INDEFINIDO, nunca cravar 04 vs 01 sem contador:
  assert.strictEqual(classificarNcm('22030000').bucket, BUCKET.INDEFINIDO, 'cerveja 2203 = REVISAR (monofasico? tributado?)');
  assert.strictEqual(classificarNcm('22021000').bucket, BUCKET.INDEFINIDO, 'refrigerante 2202 = REVISAR');
  assert.strictEqual(classificarNcm('22011000').bucket, BUCKET.INDEFINIDO, 'agua 2201 = REVISAR');

  // NCM desconhecida / vazia / lixo => INDEFINIDO (conservador)
  assert.strictEqual(classificarNcm('49019900').bucket, BUCKET.INDEFINIDO, 'NCM fora do de-para = indefinido');
  assert.strictEqual(classificarNcm('').bucket, BUCKET.INDEFINIDO, 'NCM vazia = indefinido');
  assert.strictEqual(classificarNcm('00').bucket, BUCKET.INDEFINIDO, 'NCM lixo "00" do SPED = indefinido');
  assert.strictEqual(classificarNcm('49019900').confianca, 'NENHUMA', 'indefinido tem confianca NENHUMA');

  // ---- (bucket x direção) -> CST  (S = saida/1, E = entrada/0) ----
  // SAIDA
  assert.strictEqual(regraCst(BUCKET.MONOFASICO, 'S').cst, '04', 'saida monofasico = CST 04 (revenda aliq zero), nao 06');
  assert.strictEqual(regraCst(BUCKET.MONOFASICO, 'S').exigeBase, false, 'monofasico saida sem base');
  assert.strictEqual(regraCst(BUCKET.NORMAL, 'S').cst, '01', 'saida normal = CST 01 tributado');
  assert.strictEqual(regraCst(BUCKET.NORMAL, 'S').exigeBase, true, 'normal saida exige BC/ALIQ');
  assert.strictEqual(regraCst(BUCKET.ALIQ_ZERO_LEI, 'S').cst, '06', 'saida aliq zero por lei = CST 06');
  // ENTRADA
  assert.strictEqual(regraCst(BUCKET.MONOFASICO, 'E').cst, '70', 'entrada monofasico p/ revenda = CST 70 SEM credito');
  assert.strictEqual(regraCst(BUCKET.MONOFASICO, 'E').credita, false, 'monofasico entrada NAO credita (vedacao)');
  assert.strictEqual(regraCst(BUCKET.NORMAL, 'E').cst, '50', 'entrada normal creditavel = CST 50');
  assert.strictEqual(regraCst(BUCKET.NORMAL, 'E').credita, true, 'normal entrada credita');

  // INDEFINIDO: engine NAO decide sozinha — sinaliza revisao, default sem credito/sem debito
  const sInd = regraCst(BUCKET.INDEFINIDO, 'S');
  assert.strictEqual(sInd.cst, null, 'saida indefinida nao crava CST');
  assert.ok(/de-para|contador|revis/i.test(sInd.aviso || ''), 'saida indefinida avisa revisao');
  const eInd = regraCst(BUCKET.INDEFINIDO, 'E');
  assert.strictEqual(eInd.credita, false, 'entrada indefinida NAO credita por default (conservador)');

  console.log('✓ classificador fiscal OK — NCM->bucket e bucket x direcao->CST (default conservador)');
}

main();
