// Arnês GOLDEN da Fase 1 (Injetor EFD-Contribuições).
// Garante que importar → montar de volta é BYTE-A-BYTE idêntico ao original,
// SEM injeção/correção. É a prova de segurança da fundação (round-trip).
//
// Uso: node backend/tests/contrib-roundtrip.test.js
//
// Regra: enquanto nada é injetado, o export tem que ser sha256-idêntico ao original.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { parseContribuicoes, montarArquivo } = require('../services/spedContribuicoesService');

const ARQ = path.join(__dirname, '..', '..', 'speds', 'EFD_PISCOFINS_CONTRIBUICOES_20260531_CASA DA BEBIDA.txt');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function main() {
  const original = fs.readFileSync(ARQ); // Buffer (bytes crus, latin-1)
  const txt = original.toString('latin1');

  const parsed = parseContribuicoes(txt);
  const rebuilt = montarArquivo(parsed);
  const rebuiltBuf = Buffer.from(rebuilt, 'latin1');

  // 1) mesmo tamanho em bytes
  assert.strictEqual(
    rebuiltBuf.length, original.length,
    `tamanho difere: reconstruído=${rebuiltBuf.length} vs original=${original.length}`
  );

  // 2) byte-a-byte idêntico (sha256)
  const hOrig = sha256(original);
  const hNew = sha256(rebuiltBuf);
  if (hNew !== hOrig) {
    // localiza o primeiro byte divergente para diagnóstico
    let i = 0;
    const min = Math.min(rebuiltBuf.length, original.length);
    while (i < min && rebuiltBuf[i] === original[i]) i++;
    assert.fail(`NÃO é byte-idêntico. sha256 orig=${hOrig} new=${hNew}. 1º byte divergente em ${i}: ` +
      `orig=${JSON.stringify(original.toString('latin1', Math.max(0,i-20), i+20))}`);
  }

  // 3) metadados básicos extraídos (não afetam o round-trip, mas provam o parser leu o 0000/0110)
  assert.ok(parsed.meta, 'parser não retornou meta');
  assert.strictEqual(parsed.meta.cnpj, '07520999000149', `CNPJ lido errado: ${parsed.meta.cnpj}`);
  assert.ok(parsed.meta.regime, `regime (0110) não lido: ${parsed.meta.regime}`);

  console.log(`✓ round-trip byte-idêntico OK — ${original.length} bytes, ${parsed.linhas.length} linhas, ` +
    `CNPJ ${parsed.meta.cnpj}, regime ${parsed.meta.regime}, sha256 ${hOrig.slice(0, 12)}…`);
}

main();
