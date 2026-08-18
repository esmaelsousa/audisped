// backend/tests/migracao-regra-cst-pis-entrada-73.test.js
//   node backend/tests/migracao-regra-cst-pis-entrada-73.test.js   (precisa DB local)
//
// Roda TUDO dentro de uma transação com ROLLBACK no fim: apaga a regra ENTRADA⇒73 e
// devolve a regra SAÍDA⇒04 para ind_oper NULL (o estado "banco de antes do fix"), roda a
// migração e confere. Nada é gravado no banco de verdade.
const assert = require('assert');
require('dotenv').config();
const { Pool } = require('pg');
const { up, NOME_ENTRADA_73, NOME_SAIDA_04 } = require('../migrations/2026-08-18-regra-cst-pis-entrada-73');
const rf = require('../services/regrasFiscaisService');

// C170 de entrada de combustível como vem do SPED do cliente: CST ICMS 061, PIS/COFINS 04.
const itemEntrada = () => ({ num_item: '1', cst_icms: '061', cfop: '1652', cst_pis: '04', cst_cofins: '04' });
const itemSaida   = () => ({ num_item: '1', cst_icms: '061', cfop: '5656', cst_pis: '',   cst_cofins: '' });
// Uso/consumo (CST 090): fora do cond_extra 60/61 — a migração não pode encostar.
const itemOutro   = () => ({ num_item: '1', cst_icms: '090', cfop: '1556', cst_pis: '99', cst_cofins: '99' });

(async () => {
  const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Estado "antes do fix": sem a regra de entrada e com a de saída valendo p/ entrada E saída.
    await c.query('DELETE FROM regras_fiscais WHERE nome = $1', [NOME_ENTRADA_73]);
    await c.query('UPDATE regras_fiscais SET ind_oper = NULL WHERE nome = $1', [NOME_SAIDA_04]);
    rf.invalidarCache();

    // Baseline: sem a migração, a entrada é coagida a 04 pela regra de saída (o bug).
    const antes = itemEntrada();
    rf.aplicarRegrasFiscaisComLista(antes, await rf.carregarRegras(c, '2026-01-01', 'export'), { ind_oper: '0' });
    assert.equal(antes.cst_pis, '04', 'baseline: sem a migração a entrada vira/segue 04');

    // --- migração ---
    const r1 = await up(c);
    assert.equal(r1.inseridas, 1, 'primeira execução deve inserir a regra ENTRADA⇒73');
    assert.equal(r1.saidaFechada, 1, "primeira execução deve fechar a regra de saída em ind_oper='1'");

    const r2 = await up(c); // idempotente: rodar 2x não duplica nem re-atualiza
    assert.equal(r2.inseridas, 0, 'segunda execução não pode inserir de novo');
    assert.equal(r2.saidaFechada, 0, 'segunda execução não pode reescrever a regra de saída');

    const dup = await c.query('SELECT count(*)::int n FROM regras_fiscais WHERE nome = $1', [NOME_ENTRADA_73]);
    assert.equal(dup.rows[0].n, 1, 'não pode existir regra duplicada');

    const reg = await c.query(
      `SELECT prioridade, ativo, escopo_aplicacao, ind_oper, cond_extra, acao_cst_pis, acao_cst_cofins
         FROM regras_fiscais WHERE nome = $1`, [NOME_ENTRADA_73]);
    const g = reg.rows[0];
    assert.equal(g.escopo_aplicacao, 'export', "escopo deve ser 'export'");
    assert.equal(g.ind_oper, '0', "ind_oper deve ser '0' (entrada)");
    assert.equal(g.ativo, true, 'regra deve entrar ativa');
    assert.equal(g.acao_cst_pis, '73');
    assert.equal(g.acao_cst_cofins, '73');
    assert.deepEqual(g.cond_extra, { cst_origem_list: ['60', '61'] });

    const saida = await c.query('SELECT ind_oper FROM regras_fiscais WHERE nome = $1', [NOME_SAIDA_04]);
    assert.equal(saida.rows[0].ind_oper, '1', "regra de saída deve ficar em ind_oper='1'");

    // --- comportamento do motor com as regras já migradas ---
    rf.invalidarCache();
    const regras = await rf.carregarRegras(c, '2026-01-01', 'export');

    const e = itemEntrada();
    rf.aplicarRegrasFiscaisComLista(e, regras, { ind_oper: '0' });
    assert.equal(e.cst_pis, '73', 'entrada 061: CST PIS deve virar 73');
    assert.equal(e.cst_cofins, '73', 'entrada 061: CST COFINS deve virar 73');

    const s = itemSaida();
    rf.aplicarRegrasFiscaisComLista(s, regras, { ind_oper: '1' });
    assert.equal(s.cst_pis, '04', 'saída 061: CST PIS segue 04 (não pode regredir)');
    assert.equal(s.cst_cofins, '04', 'saída 061: CST COFINS segue 04');

    const o = itemOutro();
    rf.aplicarRegrasFiscaisComLista(o, regras, { ind_oper: '0' });
    assert.equal(o.cst_pis, '99', 'entrada CST 090 (uso/consumo) não pode ser tocada');

    console.log('migracao-regra-cst-pis-entrada-73: OK');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    rf.invalidarCache(); // o cache viu linhas da transação desfeita
    c.release(); await pool.end();
  }
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
