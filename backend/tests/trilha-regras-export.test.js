// backend/tests/trilha-regras-export.test.js
//   node backend/tests/trilha-regras-export.test.js   (não precisa de DB nem de servidor)
//
// Cobre a trilha das reescritas do motor de regras no export. Roda offline de propósito:
// exercitar isso pelo endpoint exigiria GET /api/exportar-sped/:id, que GRAVA em
// encerrantes_exportados e reescreve âncora de continuidade de cadeia real.
const assert = require('assert');
const { criarColetorTrilha } = require('../services/export/trilhaRegras');
const { Changelog } = require('../services/validador/changelog');
const rf = require('../services/regrasFiscaisService');

const REGRA_ENTRADA_73 = {
  id: 16, nome: 'Coerção ENTRADA 60/61 ⇒ 73', fundamento_legal: 'Lei 9.718/98',
  prioridade: 10, ind_oper: '0', cond_extra: { cst_origem_list: ['60', '61'] },
  acao_cst_pis: '73', acao_cst_cofins: '73', flag_para_no_match: false,
};
const REGRA_SAIDA_04 = {
  id: 1, nome: 'Coerção SAÍDA 60/61 ⇒ 04', fundamento_legal: 'Lei 10.485/02',
  prioridade: 10, ind_oper: '1', cond_extra: { cst_origem_list: ['60', '61'] },
  acao_cst_pis: '04', acao_cst_cofins: '04', flag_para_no_match: false,
};

function run(nome, fn) { fn(); console.log('  ok —', nome); }

console.log('trilha-regras-export:');

// 1. O caso que motivou tudo: reescrita de CST declarado precisa aparecer na trilha.
run('registra a reescrita de CST_PIS/CST_COFINS com a regra que a causou', () => {
  const col = criarColetorTrilha();
  const item = { num_item: '1', cst_icms: '061', cfop: '1652', cst_pis: '50', cst_cofins: '50' };
  const trilha = [];
  rf.aplicarRegrasFiscaisComLista(item, [REGRA_ENTRADA_73], { ind_oper: '0', trilha });
  col.registrar(trilha, { chv_nfe: '29260712345678000199550010000001231000001234', num_item: '1' });

  assert.equal(col.total, 2, 'CST_PIS e CST_COFINS = 2 campos reescritos');
  assert.equal(col.grupos, 2, 'um grupo por campo');

  const cl = new Changelog();
  assert.equal(col.flush(cl), 2);
  const pis = cl.entradas.find(e => e.campo === 'CST_PIS');
  assert.ok(pis, 'CST_PIS tem que estar no changelog');
  assert.equal(pis.registro, 'C170');
  assert.equal(pis.antes, '50');
  assert.equal(pis.depois, '73');
  assert.equal(pis.regraId, 'REGRA-FISCAL-16', 'a entrada tem que apontar a REGRA que mudou');
  assert.ok(pis.motivo.includes('Lei 9.718/98'), 'motivo tem que carregar o fundamento legal');
  assert.equal(pis.origem, 'fiscal');
  assert.equal(pis.itens[0].chave, '29260712345678000199550010000001231000001234 item 1');
});

// 2. Massa: 3 mil itens não podem virar 3 mil linhas de relatório.
run('agrupa correção em massa em 1 entrada com qtd exata', () => {
  const col = criarColetorTrilha();
  for (let i = 0; i < 3000; i++) {
    const item = { num_item: String(i + 1), cst_icms: '060', cfop: '1652', cst_pis: '', cst_cofins: '' };
    const trilha = [];
    rf.aplicarRegrasFiscaisComLista(item, [REGRA_ENTRADA_73], { ind_oper: '0', trilha });
    col.registrar(trilha, { num_doc: String(i + 1), num_item: item.num_item });
  }
  const cl = new Changelog();
  col.flush(cl);
  assert.equal(cl.entradas.length, 2, '2 entradas (CST_PIS e CST_COFINS), não 6000');
  assert.equal(cl.total, 6000, 'mas o TOTAL contado tem que ser exato');
  const pis = cl.entradas.find(e => e.campo === 'CST_PIS');
  assert.equal(pis.qtd, 3000);
  assert.equal(pis.antes, '(vazio)', 'campo vazio tem que ser legível no relatório');
  assert.equal(pis.itens.length, 50, 'detalhe limitado a 50 ocorrências');
});

// 3. Grupos separados por (antes → depois): 50→73 e 70→73 não podem virar um bolo só.
run('separa grupos por valor de origem', () => {
  const col = criarColetorTrilha();
  for (const cst of ['50', '50', '70']) {
    const item = { num_item: '1', cst_icms: '061', cfop: '1652', cst_pis: cst, cst_cofins: cst };
    const trilha = [];
    rf.aplicarRegrasFiscaisComLista(item, [REGRA_ENTRADA_73], { ind_oper: '0', trilha });
    col.registrar(trilha, {});
  }
  const cl = new Changelog();
  col.flush(cl);
  const pis = cl.entradas.filter(e => e.campo === 'CST_PIS');
  assert.equal(pis.length, 2, '50→73 e 70→73 são grupos distintos');
  assert.equal(pis.find(e => e.antes === '50').qtd, 2);
  assert.equal(pis.find(e => e.antes === '70').qtd, 1);
});

// 4. Não pode registrar o que não mudou (ruído no relatório destrói a utilidade dele).
run('não registra nada quando nenhuma regra casa', () => {
  const col = criarColetorTrilha();
  const item = { num_item: '1', cst_icms: '090', cfop: '1556', cst_pis: '99', cst_cofins: '99' };
  const trilha = [];
  rf.aplicarRegrasFiscaisComLista(item, [REGRA_ENTRADA_73, REGRA_SAIDA_04], { ind_oper: '0', trilha });
  col.registrar(trilha, {});
  assert.equal(col.total, 0);
  const cl = new Changelog();
  assert.equal(col.flush(cl), 0);
  assert.equal(cl.entradas.length, 0);
});

run('não registra regra que casou mas não alterou valor', () => {
  const col = criarColetorTrilha();
  const item = { num_item: '1', cst_icms: '061', cfop: '1652', cst_pis: '73', cst_cofins: '73' };
  const trilha = [];
  rf.aplicarRegrasFiscaisComLista(item, [REGRA_ENTRADA_73], { ind_oper: '0', trilha });
  assert.equal(trilha.length, 1, 'a regra casou (a trilha do motor registra o casamento)');
  col.registrar(trilha, {});
  assert.equal(col.total, 0, 'mas nada mudou, então não vai para o changelog');
});

// 5. Atribuição por regra: com 2 regras casando, cada uma responde pelo que ELA mudou.
run('atribui cada campo à regra que realmente o mudou', () => {
  const R_CFOP = { id: 99, nome: 'Ajusta CFOP', prioridade: 5, acao_cfop: '1653', flag_para_no_match: false };
  const col = criarColetorTrilha();
  const item = { num_item: '1', cst_icms: '061', cfop: '1652', cst_pis: '50', cst_cofins: '50' };
  const trilha = [];
  rf.aplicarRegrasFiscaisComLista(item, [R_CFOP, REGRA_ENTRADA_73], { ind_oper: '0', trilha });
  col.registrar(trilha, {});
  const cl = new Changelog();
  col.flush(cl);
  const cfop = cl.entradas.find(e => e.campo === 'CFOP');
  const pis = cl.entradas.find(e => e.campo === 'CST_PIS');
  assert.equal(cfop.regraId, 'REGRA-FISCAL-99', 'CFOP é da regra 99');
  assert.equal(cfop.antes, '1652'); assert.equal(cfop.depois, '1653');
  assert.equal(pis.regraId, 'REGRA-FISCAL-16', 'CST_PIS é da regra 16, não da 99');
  assert.equal(cl.entradas.filter(e => e.regraId === 'REGRA-FISCAL-99').length, 1,
    'a regra 99 NÃO pode levar a culpa do que a 16 mudou');
});

// 6. Contrato de side-channel: sem changelog, não pode explodir (export não pode quebrar por causa da trilha).
run('flush sem changelog é no-op seguro', () => {
  const col = criarColetorTrilha();
  const item = { num_item: '1', cst_icms: '061', cfop: '1652', cst_pis: '50', cst_cofins: '50' };
  const trilha = [];
  rf.aplicarRegrasFiscaisComLista(item, [REGRA_ENTRADA_73], { ind_oper: '0', trilha });
  col.registrar(trilha, {});
  assert.equal(col.flush(null), 0);
  assert.equal(col.total, 0, 'flush esvazia o coletor');
});

console.log('trilha-regras-export: OK — 7 casos');
