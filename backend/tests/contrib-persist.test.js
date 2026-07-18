// Integração Fase 1: prova que gravar as linhas no banco e exportar de volta
// preserva os bytes (latin-1 via TEXT do Postgres). Golden através do banco.
//
// Uso: node backend/tests/contrib-persist.test.js   (usa o banco local via backend/.env)

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { parseContribuicoes, salvarArquivo, exportarArquivo } = require('../services/spedContribuicoesService');

const ARQ = path.join(__dirname, '..', '..', 'speds', 'EFD_PISCOFINS_CONTRIBUICOES_20260531_CASA DA BEBIDA.txt');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function main() {
  const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
  });

  let id = null;
  try {
    const original = fs.readFileSync(ARQ);
    const parsed = parseContribuicoes(original.toString('latin1'));

    id = await salvarArquivo(pool, {
      id_empresa: null,
      nome_original: 'TESTE_ROUNDTRIP.txt',
      parsed,
      sha256: sha256(original),
    });
    assert.ok(id, 'salvarArquivo não retornou id');

    const out = await exportarArquivo(pool, id);
    assert.ok(out, 'exportarArquivo retornou vazio');
    const rebuilt = Buffer.from(out.conteudo, 'latin1');

    assert.strictEqual(rebuilt.length, original.length, `tamanho difere via banco: ${rebuilt.length} vs ${original.length}`);
    assert.ok(rebuilt.equals(original), 'conteúdo via banco NÃO é byte-idêntico');

    console.log(`✓ persistência round-trip OK — id=${id}, ${rebuilt.length} bytes idênticos via banco`);
  } finally {
    if (id) await pool.query('DELETE FROM efd_contrib_arquivos WHERE id=$1', [id]); // cascata apaga as linhas
    await pool.end();
  }
}

main().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
