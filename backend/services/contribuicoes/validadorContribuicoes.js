// ============================================================================
// validadorContribuicoes — Validador READ-ONLY da EFD-Contribuições (Fase 2).
// ----------------------------------------------------------------------------
// NÃO gera nem altera nada — apenas APONTA. Consome o parser (spedContribuicoes
// Service.parseContribuicoes) e, quando houver NCM confiável, o classificador
// fiscal. É o irmão de MENOR RISCO do módulo (não transmite nada) e prova a
// inteligência fiscal antes de qualquer geração.
//
// v1 — checagens que dependem SÓ do arquivo (sem NCM):
//   (1) CST_SEM_BASE  — CST tributável/creditável (01-05/50-56) sem base/valor  → PVA reprova.
//   (2) BASE_INDEVIDA — CST de alíq. zero/sem crédito (04/06-09/70-75/98/99) com valor preenchido.
//   (3) CREDITO_ENTRADA — entrada (IND_OPER=0) com crédito (50-56): confirmar vedação monofásico/ST.
// As checagens por NATUREZA do produto (NCM → bucket → CST esperado) entram quando
// o de-para por cliente estiver populado (ver PARECER_FISCAL_CONTRIBUICOES.md).
//
// Layout C170 (split('|')): f2=NUM_ITEM, f4=DESCR, f25=CST_PIS, f26=VL_BC_PIS,
// f30=VL_PIS, f31=CST_COFINS, f32=VL_BC_COFINS, f36=VL_COFINS. C100 f2=IND_OPER.
// ============================================================================

'use strict';

const CST_TRIBUTAVEL = new Set(['01', '02', '03', '04', '05', '50', '51', '52', '53', '54', '55', '56']);
const CST_CREDITO = new Set(['50', '51', '52', '53', '54', '55', '56']);
const CST_ZERO = new Set(['04', '06', '07', '08', '09', '70', '71', '72', '73', '74', '75', '98', '99']);

// Posição do campo COD_CTA (conta contábil) no split('|') por registro — descoberto na base do PVA
// (o ID_CAMPO do PVA == índice do split). Ver docs/PLANO_IMPL_VALIDADOR_CONTRIBUICOES.md.
const POS_COD_CTA = { C170: 37, A170: 17, D501: 11, D505: 11, M400: 4, M410: 4, M800: 4, M810: 4 };

// Base/valor efetivamente preenchido (não vazio e não 0,00).
function temValor(s) {
  return !!s && String(s).replace(/[0.,\s]/g, '') !== '';
}

// CST tributável (01-05) que EXIGE base — 50-56 é crédito (base do crédito), tratado à parte.
const CST_EXIGE_BASE = new Set(['01', '02', '03', '04', '05']); // (04 não exige, ver abaixo)

function validarContribuicoes(parsed) {
  const apontamentos = [];
  // Se há registro 0500 (plano de contas), COD_CTA é exigível; senão, ADVERTIR (pode ser livro-caixa).
  const temEscrituracaoContabil = parsed.linhas.some(l => l.reg === '0500');
  const regime = parsed.meta ? parsed.meta.regime : null; // 0110: 1=não-cumulativo, 2=cumulativo, 3=ambos
  let indOper = null;
  let totalC170 = 0, saidas = 0, entradas = 0;

  for (const l of parsed.linhas) {
    if (l.reg === 'C100') {
      indOper = (l.raw.split('|')[2] || '').trim(); // 0=entrada, 1=saída
      continue;
    }

    // ---- MSG_OBRIGATORIO_COD_CTA (PVA): COD_CTA vazio nos registros que o exigem ----
    if (POS_COD_CTA[l.reg] !== undefined) {
      const cc = (l.raw.split('|')[POS_COD_CTA[l.reg]] || '').trim();
      if (cc === '') {
        apontamentos.push({
          tipo: 'COD_CTA_OBRIGATORIO', id_mensagem: 'MSG_OBRIGATORIO_COD_CTA', severidade: 'ALTA',
          linha: l.num, reg: l.reg, id_campo: 'COD_CTA',
          detalhe: `COD_CTA (conta contábil) vazio no ${l.reg} — obrigatório quando há escrituração contábil (registro 0500).` +
            (temEscrituracaoContabil ? '' : ' 0500 ausente: confirmar com o contador se a PJ mantém contabilidade (se livro-caixa, não é obrigatório).'),
        });
      }
    }

    if (l.reg !== 'C170') continue;

    const f = l.raw.split('|');
    const dir = indOper === '1' ? 'S' : 'E';
    const item = (f[4] || '').trim().slice(0, 40);
    totalC170++;
    if (dir === 'S') saidas++; else entradas++;

    const cstPis = (f[25] || '').trim(), bcPis = f[26], vlPis = f[30];
    const cstCof = (f[31] || '').trim(), bcCof = f[32], vlCof = f[36];

    // (1) CST tributável/creditável SEM base/valor (D5) — o erro clássico do PVA.
    // 01-05 e 50-56 exigem base+valor; 04 é alíquota zero (não exige) → fica fora.
    const exige = (cst) => (CST_EXIGE_BASE.has(cst) && cst !== '04') || CST_CREDITO.has(cst);
    const semBasePis = exige(cstPis) && !temValor(bcPis) && !temValor(vlPis);
    const semBaseCof = exige(cstCof) && !temValor(bcCof) && !temValor(vlCof);
    if (semBasePis || semBaseCof) {
      const quais = [semBasePis ? 'PIS' : null, semBaseCof ? 'COFINS' : null].filter(Boolean).join('/');
      apontamentos.push({
        tipo: 'CST_SEM_BASE', severidade: 'ALTA', linha: l.num, reg: 'C170', direcao: dir, cst: cstPis || cstCof,
        detalhe: `${item}: CST ${quais} tributável/creditável (${cstPis || cstCof}) sem base/valor — o PVA reprova e a apuração fica errada. Preencher a base (nunca rebaixar para 06).`,
      });
    }

    // (2) CST de alíquota zero / sem crédito COM valor preenchido (incoerência inversa).
    const zeroComValorPis = CST_ZERO.has(cstPis) && temValor(vlPis);
    if (zeroComValorPis) {
      apontamentos.push({
        tipo: 'BASE_INDEVIDA', severidade: 'MEDIA', linha: l.num, reg: 'C170', direcao: dir, cst: cstPis,
        detalhe: `${item}: CST ${cstPis} (alíquota zero/sem crédito) com valor de PIS preenchido — incoerente; zerar ou revisar o CST.`,
      });
    }

    // (3) Crédito em ENTRADA. No regime CUMULATIVO (0110=2) NÃO existe crédito → VEDADO (ALTA).
    //     No não-cumulativo, depende (vedado se monofásico/ST) → MEDIA (confirmar via de-para NCM).
    if (dir === 'E' && (CST_CREDITO.has(cstPis) || CST_CREDITO.has(cstCof))) {
      const cumulativo = regime === '2';
      apontamentos.push({
        tipo: 'CREDITO_ENTRADA', severidade: cumulativo ? 'ALTA' : 'MEDIA', linha: l.num, reg: 'C170', direcao: dir, cst: cstPis,
        detalhe: cumulativo
          ? `Entrada com crédito (CST ${cstPis}) em "${item}" num arquivo de regime CUMULATIVO (0110=2): crédito de PIS/COFINS é VEDADO no cumulativo — reclassificar sem crédito (ex.: CST 70/98).`
          : `Entrada com crédito (CST ${cstPis}) em "${item}": confirmar direito a crédito — é VEDADO creditar aquisição de produto monofásico/ST para revenda (Lei 10.833/03 art. 3º §2º II).`,
      });
    }
  }

  const porSeveridade = apontamentos.reduce((acc, a) => { acc[a.severidade] = (acc[a.severidade] || 0) + 1; return acc; }, {});
  return {
    resumo: {
      total_c170: totalC170, saidas, entradas,
      apontamentos: apontamentos.length, por_severidade: porSeveridade,
      cnpj: parsed.meta?.cnpj, competencia: parsed.meta?.competencia, regime: parsed.meta?.regime,
    },
    apontamentos,
  };
}

module.exports = { validarContribuicoes };
