// backend/migrations/2026-09-24-tabelas-cfop-cest.js
//
// Popula as tabelas oficiais de CFOP e CEST, a partir das planilhas que o Esmael forneceu
// (CEST.xlsx / CFOP.xlsx — normalizadas em migrations/dados/tabelas-fiscais.json).
//
// POR QUE:
//   • `cad_cfops` tinha **8 linhas** feitas à mão, e uma delas errada (5405 marcado como 'entrada',
//     sendo saída). Com isso a regra DOC-C170-CFOP-01 só conseguia validar o FORMATO
//     (/^[123567]\d{3}$/) — e o CFOP 1929, que NÃO EXISTE na tabela oficial, passava batido.
//     Foi ele que gerou C190 órfão no POSTO PREÇO BOM (ver docs/PENDENCIAS.md).
//   • `cest` tinha 1.048 códigos com ncm_prefix, mas SEM vigência. Sem isso não dá para detectar
//     um CEST revogado usado numa competência posterior.
//
// DECISÕES:
//   • CEST é MESCLA, não substituição: a planilha traz vigência mas NÃO traz NCM, e o nosso
//     ncm_prefix é informação que já custou a ser reunida. Código e vigência vêm da planilha
//     (é a fonte); o ncm_prefix permanece.
//   • CFOP é substituição: 8 linhas caseiras contra 686 oficiais.
//   • Guardamos TAMBÉM os 73 cabeçalhos de grupo (1.000, 1.100, 1.150…), marcados com
//     `is_grupo = true`. Assim nada se perde e a REGRA decide se aceita ou não — em vez de a
//     migração decidir por ela. Discriminador: campo "Nat. operacao" = false na planilha, que
//     coincide exatamente com os códigos terminados em 00/50.
//
// Idempotente: ALTER ... IF NOT EXISTS + upsert por código. Rodar de novo não estraga nada.
const path = require('path');

async function up(client) {
  const dados = require(path.join(__dirname, 'dados', 'tabelas-fiscais.json'));

  // ── CFOP ────────────────────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS cad_cfops (
      id SERIAL PRIMARY KEY, codigo TEXT, descricao TEXT, tipo TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    )`);
  for (const [col, tipo] of [['codigo_fmt', 'TEXT'], ['nome', 'TEXT'], ['is_grupo', 'BOOLEAN DEFAULT FALSE']]) {
    await client.query(`ALTER TABLE cad_cfops ADD COLUMN IF NOT EXISTS ${col} ${tipo}`);
  }
  // `codigo` precisa ser único para o upsert. Antes de criar o índice, remove duplicatas
  // (a tabela antiga não tinha unique e pode ter repetido).
  await client.query(`DELETE FROM cad_cfops a USING cad_cfops b WHERE a.id > b.id AND a.codigo = b.codigo`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cad_cfops_codigo ON cad_cfops (codigo)`);

  let nCfop = 0;
  for (const c of dados.cfop) {
    await client.query(
      `INSERT INTO cad_cfops (codigo, codigo_fmt, nome, descricao, tipo, is_grupo)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (codigo) DO UPDATE SET
         codigo_fmt = EXCLUDED.codigo_fmt, nome = EXCLUDED.nome,
         descricao  = EXCLUDED.descricao,  tipo = EXCLUDED.tipo,
         is_grupo   = EXCLUDED.is_grupo`,
      [c.codigo, c.codigo_fmt, c.nome, c.descricao, c.tipo, c.is_grupo]);
    nCfop++;
  }

  // ── CEST ────────────────────────────────────────────────────────────────────
  // A tabela existente tem uma linha POR (cest, ncm_prefix) — um CEST com vários NCMs ocupa
  // várias linhas. A vigência é do CÓDIGO, então vale para todas as linhas daquele cest.
  for (const [col, tipo] of [['vigencia_inicio', 'DATE'], ['vigencia_fim', 'DATE'], ['cest_fmt', 'TEXT']]) {
    await client.query(`ALTER TABLE cest ADD COLUMN IF NOT EXISTS ${col} ${tipo}`);
  }
  let nCestAtualizados = 0, nCestNovos = 0;
  for (const c of dados.cest) {
    const r = await client.query(
      `UPDATE cest SET vigencia_inicio = $2, vigencia_fim = $3,
                       cest_fmt = COALESCE(cest_fmt, $4),
                       descricao = COALESCE(NULLIF(descricao,''), $5)
         WHERE cest = $1`,
      [c.cest, c.vig_ini, c.vig_fim, c.cest_fmt, c.descricao]);
    if (r.rowCount > 0) { nCestAtualizados += r.rowCount; continue; }
    // CEST da tabela oficial que ainda não temos (6 códigos). `ncm_prefix` é NOT NULL e a planilha
    // não traz NCM → entra como '' (= "NCM desconhecido"), o que é honesto e não quebra nada: a
    // checagem CEST×NCM por prefixo foi REMOVIDA da regra por gerar falso-positivo em massa
    // (ver cabeçalho de rules/r_cest_0200.js), e a de EXISTÊNCIA só usa o código.
    // Um desses 6 é o `1708704`, citado no comentário daquela regra como exemplo de "não
    // localizado" — ele É oficial, nós é que não tínhamos. Vínhamos gerando ADV indevida nele.
    await client.query(
      `INSERT INTO cest (cest, cest_fmt, descricao, ncm_prefix, vigencia_inicio, vigencia_fim)
       VALUES ($1,$2,$3,'',$4,$5)`,
      [c.cest, c.cest_fmt, c.descricao, c.vig_ini, c.vig_fim]);
    nCestNovos++;
  }

  return { nCfop, nCestAtualizados, nCestNovos };
}

module.exports = { up };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { Pool } = require('pg');
  const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
  });
  (async () => {
    const c = await pool.connect();
    try {
      const r = await up(c);
      console.log(`OK: ${r.nCfop} CFOP | CEST ${r.nCestAtualizados} linha(s) atualizada(s), ${r.nCestNovos} código(s) novo(s)`);
    } catch (e) { console.error('FALHOU:', e.message); process.exitCode = 1; }
    finally { c.release(); await pool.end(); }
  })();
}
