// ============================================================================
// classificadorFiscal — núcleo fiscal PIS/COFINS COMPARTILHADO (injetor + validador)
// ----------------------------------------------------------------------------
// Deriva o CST PIS/COFINS a partir da NATUREZA DO PRODUTO (bucket por NCM) x
// DIREÇÃO da operação — NÃO do regime isolado nem do CST cru do XML.
// Regras vindas do parecer do painel PIS/COFINS (ver memory/contribuicoes-modulo.md).
//
// PRINCÍPIO CONSERVADOR (blindagem contra multa):
//   - NCM fora do de-para (ou lixo "00" do SPED, ou disputada) => INDEFINIDO.
//   - INDEFINIDO NÃO crava CST: o consumidor decide (validador ALERTA, injetor BLOQUEIA).
//   - Entrada nunca credita por default; saída nunca "inventa" débito por default.
//
// ⚠️ O de-para NC->bucket abaixo é SEED PROVISÓRIO, só com o INCONTESTÁVEL (as duas
//    lentes do painel concordam). O DISPUTADO (bebidas frias 2201-2203, pós Lei
//    13.097/2015: monofásico CST 04 x tributado CST 01) fica INDEFINIDO até o
//    CONTADOR confirmar. A verdade final do de-para é do contador, por empresa.
// ============================================================================

'use strict';

const BUCKET = Object.freeze({
  MONOFASICO: 'MONOFASICO',        // combustível; bebida fria (a confirmar) — revenda: saída CST 04, entrada sem crédito
  NORMAL: 'NORMAL',                // tributação normal não-cumulativa — saída CST 01 (com base), entrada CST 50 (crédito)
  ALIQ_ZERO_LEI: 'ALIQ_ZERO_LEI',  // alíquota zero por lei específica (não monofásico) — saída CST 06
  ISENTA: 'ISENTA',                // isenta/suspensão — saída CST 07/08/09 (depende)
  ST_SEM_CREDITO: 'ST_SEM_CREDITO',// substituição/ sem crédito
  INDEFINIDO: 'INDEFINIDO',        // sem classificação confiável → tratar conservador (revisar com contador)
});

// SEED de-para por prefixo NCM de 4 dígitos (posição). SÓ o incontestável.
// Bebidas frias 2201/2202/2203 DELIBERADAMENTE fora (disputado → INDEFINIDO).
const SEED_NCM = {
  // Combustíveis (monofásico/concentrado — revenda a alíquota zero). Settled.
  '2710': BUCKET.MONOFASICO,
  '2711': BUCKET.MONOFASICO,
  // Vinhos, vermutes, espumantes, destilados e licores (tributação integral). Settled.
  '2204': BUCKET.NORMAL,
  '2205': BUCKET.NORMAL,
  '2206': BUCKET.NORMAL,
  '2207': BUCKET.NORMAL,
  '2208': BUCKET.NORMAL,
};

// classificarNcm(ncm) → { bucket, confianca, prefixo }
// confianca: 'ALTA' (seed incontestável) | 'NENHUMA' (indefinido/desconhecido)
function classificarNcm(ncm) {
  const d = String(ncm || '').replace(/\D/g, '');
  if (d.length < 4) return { bucket: BUCKET.INDEFINIDO, confianca: 'NENHUMA', prefixo: d };
  const p4 = d.slice(0, 4);
  const b = SEED_NCM[p4];
  if (b) return { bucket: b, confianca: 'ALTA', prefixo: p4 };
  return { bucket: BUCKET.INDEFINIDO, confianca: 'NENHUMA', prefixo: p4 };
}

// regraCst(bucket, direcao) → { cst, exigeBase, credita, aviso }
// direcao: 'S' (saída, IND_OPER=1) | 'E' (entrada, IND_OPER=0)
// exigeBase: precisa de VL_BC + ALIQ + VL preenchidos (senão PVA acusa "CST sem base").
// credita: a entrada gera crédito (só NORMAL). cst=null => engine não decide (revisar).
function regraCst(bucket, direcao) {
  const S = direcao === 'S';
  switch (bucket) {
    case BUCKET.MONOFASICO:
      // Saída de revenda monofásica = CST 04 (não 06). Entrada = vedado creditar → CST 70.
      return S
        ? { cst: '04', exigeBase: false, credita: false, aviso: '' }
        : { cst: '70', exigeBase: false, credita: false, aviso: 'revenda monofásica: vedado creditar (Lei 10.833/03 art.3º §2º II)' };
    case BUCKET.NORMAL:
      return S
        ? { cst: '01', exigeBase: true, credita: false, aviso: '' }
        : { cst: '50', exigeBase: true, credita: true, aviso: '' };
    case BUCKET.ALIQ_ZERO_LEI:
      return S
        ? { cst: '06', exigeBase: false, credita: false, aviso: '' }
        : { cst: '70', exigeBase: false, credita: false, aviso: '' };
    case BUCKET.ISENTA:
      return S
        ? { cst: null, exigeBase: false, credita: false, aviso: 'isenção/suspensão (07/08/09) depende da hipótese legal — confirmar com contador' }
        : { cst: '70', exigeBase: false, credita: false, aviso: '' };
    case BUCKET.ST_SEM_CREDITO:
      return { cst: '70', exigeBase: false, credita: false, aviso: 'sem direito a crédito' };
    case BUCKET.INDEFINIDO:
    default:
      // Engine NÃO decide: consumidor trata (validador alerta, injetor bloqueia).
      return { cst: null, exigeBase: false, credita: false,
        aviso: 'produto sem classificação NCM confiável — requer de-para do contador (não cravar CST; default: sem crédito / não tributar)' };
  }
}

module.exports = { BUCKET, classificarNcm, regraCst, SEED_NCM };
