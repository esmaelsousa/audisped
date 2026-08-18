// backend/migrations/2026-08-18-regra-cst-pis-entrada-73.js
// Regras Fiscais — coerção do CST PIS/COFINS nas ENTRADAS de combustível/lubrificante.
//
// POR QUE UMA MIGRAÇÃO E NÃO O SEED:
//   seedRegrasFiscais() só insere com a tabela VAZIA (`if (n > 0) return 0`), porque a tela
//   de Regras Fiscais permite editar/desativar/EXCLUIR regras — um upsert automático por nome
//   ressuscitaria regra que o time interno apagou de propósito. Consequência: regra nova no
//   SEED nunca chega em banco já populado (local/demo/prod). Esta migração é o caminho
//   explícito e auditável para levá-la.
//
// O QUE FAZ (idempotente, pode rodar N vezes):
//   1. INSERE a regra "CST ICMS 60/61 ENTRADA ⇒ PIS/COFINS 73" se não existir (casa por nome).
//      Aquisição de combustível/lubrificante monofásico/ST é operação a alíquota zero na
//      ENTRADA → CST 73. O 04 é código de SAÍDA/revenda; o 50 é crédito vedado no monofásico.
//   2. Fecha a regra irmã "⇒ PIS/COFINS 04" em ind_oper='1' (só saída) quando ainda estiver
//      com ind_oper NULL. Era o UPDATE feito na mão no fix f1a0e0c; aqui vira reproduzível.
//      Sem isso a regra de saída também pegaria a entrada e sobrescreveria o 73 por 04.
//
// NÃO sobrescreve linha existente (descrição/prioridade/ativo ficam como o time interno deixou).
//
// APÓS RODAR: o processo do backend tem cache de regras em memória (_cache por competência|escopo,
// invalidado só pelo CRUD de /api/regras-fiscais). Reinicie/rebuilde o backend para o export
// enxergar a regra nova.
const NOME_ENTRADA_73 = 'Coerção combustível/lubrificante: CST ICMS 60/61 ENTRADA ⇒ PIS/COFINS 73';
const NOME_SAIDA_04   = 'Coerção combustível/lubrificante: CST ICMS 60/61 ⇒ PIS/COFINS 04';

async function up(client) {
  const ins = await client.query(
    `INSERT INTO regras_fiscais
       (nome, descricao, fundamento_legal, prioridade, ativo, confianca, escopo_aplicacao,
        dt_ini, ind_oper, cond_extra, acao_cst_pis, acao_cst_cofins, flag_para_no_match, criado_por)
     SELECT $1, $2, $3, 10, TRUE, 'alta', 'export',
            '2000-01-01', '0', $4::jsonb, '73', '73', FALSE, 'migracao 2026-08-18'
      WHERE NOT EXISTS (SELECT 1 FROM regras_fiscais WHERE nome = $1)`,
    [
      NOME_ENTRADA_73,
      'Aquisição de combustível/lubrificante monofásico/ST (CST ICMS 60/61) é operação a alíquota zero na ENTRADA → PIS/COFINS CST 73 (aquisição a alíquota zero). Nunca 04 (que é código de SAÍDA/revenda) nem 50 (crédito vedado no monofásico). Espelha a coerção de saída (⇒04). Escopo export p/ não colidir com as regras de injeção.',
      'Lei 9.718/98; Lei 10.485/02; LC 192/2022; IN RFB 2.121/22 (Tab. 4.3.3, CST 73)',
      JSON.stringify({ cst_origem_list: ['60', '61'] }),
    ]
  );

  const upd = await client.query(
    `UPDATE regras_fiscais SET ind_oper = '1', updated_at = CURRENT_TIMESTAMP
      WHERE nome = $1 AND ind_oper IS NULL`,
    [NOME_SAIDA_04]
  );

  return { inseridas: ins.rowCount, saidaFechada: upd.rowCount };
}

module.exports = { up, NOME_ENTRADA_73, NOME_SAIDA_04 };

if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
  (async () => { const c = await pool.connect();
    try { const r = await up(c); console.log(`OK: regra ENTRADA⇒73 inserida=${r.inseridas}, regra SAÍDA⇒04 fechada em ind_oper='1'=${r.saidaFechada}`); }
    catch (e) { console.error('FALHA:', e.message); process.exitCode = 1; }
    finally { c.release(); await pool.end(); } })();
}
