// backend/services/export/e210Apuracao.js
// Apuração do ICMS-ST do registro E210 (EFD ICMS/IPI), extraída do endpoint de exportação.
//
// POR QUE EXISTE: a aritmética vivia dentro da closure do handler de /api/exportar-sped/:id, num
// arquivo de 11 mil linhas sem module.exports — não era require-able, então NUNCA teve teste.
// Foi assim que um erro que DOBRA o ICMS-ST a recolher sobreviveu em produção.
//
// LAYOUT (verificado byte a byte em arquivos reais: split('|') dá 17 tokens → f[1]..f[15]):
//   f[1]  REG = 'E210'
//   f[2]  IND_MOV_ST                  0 = sem movimento, 1 = com movimento
//   f[3]  VL_SLD_CRED_ANT_ST          ┐
//   f[4]  VL_DEVOL_ST                 │
//   f[5]  VL_RESSARC_ST               ├ CRÉDITOS
//   f[6]  VL_OUT_CRED_ST              │
//   f[7]  VL_AJ_CREDITOS_ST           ┘
//   f[8]  VL_RETENCAO_ST              ┐
//   f[9]  VL_OUT_DEB_ST               ├ DÉBITOS
//   f[10] VL_AJ_DEBITOS_ST            ┘
//   f[11] VL_SLD_DEV_ANT_ST           ← SUBTOTAL derivado (débitos − créditos), NÃO é débito próprio
//   f[12] VL_DEDUÇÕES_ST
//   f[13] VL_ICMS_RECOL_ST            = max(0, f[11] − f[12])
//   f[14] VL_SLD_CRED_ST_TRANSPORTAR  = max(0, créditos − débitos)
//   f[15] DEB_ESP_ST                  preservado (débito especial informado, não derivado)
//
// O ERRO CORRIGIDO: f[11] estava sendo somado junto de f[8]+f[9]+f[10] como se fosse mais um
// débito. Sendo ele o próprio subtotal, isso contava o ST DUAS VEZES e o VL_ICMS_RECOL_ST saía
// no dobro. Evidência no acervo: em 289 linhas E210 de 252 SPEDs reais, f[11] é 0 em 278 e igual
// a f[8] em 11 — independente em NENHUMA. Nas 11, a fórmula legada dobra o valor que o próprio
// contribuinte declarou (ex.: 885,47 → 1.770,94).

const parseSp = s => parseFloat((s || '0').replace(',', '.')) || 0;
const fmtSp = v => v.toFixed(2).replace('.', ',');

/**
 * Recalcula os campos derivados de um E210.
 *
 * @param {string[]} campos  linha do E210 já dividida por '|' (índices como no mapa acima)
 * @param {object}   opts
 * @param {number}   opts.somaRetST  VL_RETENCAO_ST acumulado do bloco C (grava em f[8])
 * @param {'corrigido'|'legado'} [opts.modo='corrigido']
 *        'legado' reproduz a fórmula que estava em produção. Existe SÓ para o teste de corpus
 *        quantificar a diferença sobre arquivos reais — o export nunca deve usá-lo.
 * @returns {string[]} NOVO array (não muta a entrada)
 */
function apurarE210(campos, { somaRetST, modo = 'corrigido' } = {}) {
  const f = campos.slice();
  if (somaRetST != null) f[8] = fmtSp(somaRetST);

  const credST = parseSp(f[3]) + parseSp(f[4]) + parseSp(f[5]) + parseSp(f[6]) + parseSp(f[7]);

  if (modo === 'legado') {
    // ⚠️ f[11] somado como débito: é a origem da duplicação. Mantido só para comparação.
    const debLegado = parseSp(f[8]) + parseSp(f[9]) + parseSp(f[10]) + parseSp(f[11]);
    f[2] = (credST > 0 || debLegado > 0) ? '1' : '0';
    f[13] = fmtSp(Math.max(0, debLegado - credST - parseSp(f[12])));
    f[14] = fmtSp(Math.max(0, credST - debLegado));
    return f;
  }

  const debST = parseSp(f[8]) + parseSp(f[9]) + parseSp(f[10]);
  const saldoDevedor = Math.max(0, debST - credST);

  f[2] = (credST > 0 || debST > 0) ? '1' : '0';
  f[11] = fmtSp(saldoDevedor);                                  // saldo devedor ANTES das deduções
  f[13] = fmtSp(Math.max(0, saldoDevedor - parseSp(f[12])));     // a recolher, já deduzido
  f[14] = fmtSp(Math.max(0, credST - debST));                    // saldo credor a transportar
  return f;
}

module.exports = { apurarE210, parseSp, fmtSp };
