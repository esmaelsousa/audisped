// backend/tests/e210-corpus.test.js
//   node backend/tests/e210-corpus.test.js     (T2: precisa do DB local e dos .txt em disco)
//
// T2 — roda a apuração do E210 sobre TODOS os SPEDs reais disponíveis e compara três valores:
//   DECLARADO  o que o contribuinte escriturou no arquivo original
//   LEGADO     o que a fórmula que estava em produção produzia
//   CORRIGIDO  o que a fórmula nova produz
//
// Escopo deliberado: mantém f[8] como veio no arquivo (NÃO simula o somaRetST do bloco C).
// Isso ISOLA o efeito da mudança de fórmula. O acumulador do bloco C tem bugs próprios já
// catalogados (ST nas entradas zerando VL_RETENCAO_ST; acumulador global em arquivo multi-UF)
// e misturá-los aqui tornaria impossível atribuir qualquer diferença.
//
// Offline por necessidade: exercitar isso pelo endpoint exigiria GET /api/exportar-sped/:id,
// que GRAVA em encerrantes_exportados e reescreve âncora de continuidade de cadeia real.
const assert = require('assert');
const fs = require('fs');
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { apurarE210, parseSp } = require('../services/export/e210Apuracao');

(async () => {
  const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
  });
  const { rows } = await pool.query('SELECT id, nome_arquivo, caminho_arquivo FROM sped_arquivos ORDER BY id');
  await pool.end();

  let arquivos = 0, linhas = 0, divergentes = 0;
  let inflacaoLegado = 0;      // R$ a mais que o legado mandava recolher, vs o corrigido
  let f11IndependenteFora = 0; // f11 que NÃO é 0 nem o subtotal — mataria a premissa da correção
  const amostras = [];

  for (const a of rows) {
    if (!a.caminho_arquivo || !fs.existsSync(a.caminho_arquivo)) continue;
    let conteudo;
    try { conteudo = fs.readFileSync(a.caminho_arquivo, 'latin1'); } catch (e) { continue; }
    if (conteudo.indexOf('|E210|') === -1) continue;
    arquivos++;

    for (const raw of conteudo.split('\n')) {
      if (!raw.startsWith('|E210|')) continue;
      const f = raw.replace(/[\r\n]+$/, '').split('|');
      if (f.length < 16) continue;
      linhas++;

      const declF13 = parseSp(f[13]);
      const legado = apurarE210(f, { modo: 'legado' });
      const corrig = apurarE210(f, {});
      const legF13 = parseSp(legado[13]);
      const corF13 = parseSp(corrig[13]);

      // INVARIANTE 1 — a correção só pode REDUZIR o que se recolhe (ela remove uma duplicação).
      // Se alguma linha subisse, a premissa "f11 é subtotal" estaria errada e o fix seria perigoso.
      assert.ok(corF13 <= legF13 + 0.005,
        `${a.nome_arquivo}: corrigido (${corF13}) MAIOR que legado (${legF13}) em\n  ${raw.trim()}`);

      // INVARIANTE 2 — onde f[11] original é 0, as duas fórmulas têm que coincidir (efeito isolado).
      const cred = parseSp(f[3]) + parseSp(f[4]) + parseSp(f[5]) + parseSp(f[6]) + parseSp(f[7]);
      const deb = parseSp(f[8]) + parseSp(f[9]) + parseSp(f[10]);
      if (parseSp(f[11]) === 0) {
        assert.ok(Math.abs(corF13 - legF13) < 0.005,
          `${a.nome_arquivo}: f11=0 mas as fórmulas divergiram em\n  ${raw.trim()}`);
      }

      // Mede a premissa central: f[11] é sempre 0 ou o subtotal (débitos − créditos)?
      const subtotal = Math.max(0, deb - cred);
      const f11 = parseSp(f[11]);
      if (f11 !== 0 && Math.abs(f11 - subtotal) > 0.005 && Math.abs(f11 - parseSp(f[8])) > 0.005) {
        f11IndependenteFora++;
        if (amostras.length < 5) amostras.push(`  [f11 INDEPENDENTE] ${a.nome_arquivo}: ${raw.trim()}`);
      }

      if (Math.abs(corF13 - legF13) >= 0.005) {
        divergentes++;
        inflacaoLegado += (legF13 - corF13);
        // INVARIANTE 3 — nas linhas que mudam, o corrigido tem que reproduzir o DECLARADO.
        // É a prova de que quem quebrava o arquivo do contribuinte era a fórmula antiga.
        assert.ok(Math.abs(corF13 - declF13) < 0.005,
          `${a.nome_arquivo}: corrigido ${corF13} ≠ declarado ${declF13} em\n  ${raw.trim()}`);
        if (amostras.length < 12) {
          amostras.push(`  ${a.nome_arquivo}: declarado ${declF13.toFixed(2)} | legado ${legF13.toFixed(2)} | corrigido ${corF13.toFixed(2)}`);
        }
      }
    }
  }

  console.log('e210-corpus (T2):');
  console.log(`  arquivos com E210: ${arquivos} | linhas E210: ${linhas}`);
  console.log(`  linhas em que a correção muda o VL_ICMS_RECOL_ST: ${divergentes}`);
  console.log(`  ICMS-ST inflado pela fórmula legada: R$ ${inflacaoLegado.toFixed(2)}`);
  console.log(`  linhas com f11 INDEPENDENTE (refutariam a premissa): ${f11IndependenteFora}`);
  if (amostras.length) { console.log('  amostras:'); amostras.forEach(s => console.log(s)); }

  assert.ok(linhas > 0, 'corpus vazio — sem E210 em disco, o teste não prova nada');
  assert.equal(f11IndependenteFora, 0,
    'existe f11 independente: a premissa "f11 é subtotal derivado" NÃO se sustenta neste corpus');

  console.log('e210-corpus (T2): OK');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
