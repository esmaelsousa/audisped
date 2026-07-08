// DOC-C170-ICMSSEMBASE-01 (E-Auditoria 2075) — C170 com ALIQ_ICMS > 0 mas VL_BC_ICMS ou VL_ICMS = 0.
// Caso típico: item de uso/consumo (CFOP 1556/1407…) que herdou a alíquota mas não tem crédito.
//
// ⚠️ GATE DE AUTO-CORREÇÃO (painel cross-empresa 2026-07-08 §2.2 — REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   DETECÇÃO reproduz o E-Auditoria (dispara com OR: BC==0 OU VL_ICMS==0). Mas a AUTO-CORREÇÃO
//   (zerar ALIQ) só é segura no SUBCONJUNTO genuinamente não-creditante — senão destrói crédito real
//   de distribuidora (CST 00/20 com ALIQ>0 e BC zerada por glitch → o certo é PREENCHER a base, não zerar).
//   Guards obrigatórios no coletor: f13(BC)==0 E f15(ICMS)==0 E f18(VL_ICMS_ST)==0 E CFOP uso/consumo
//   (1556/2556/1407/2407) E CST não-monofásico (excluir x02/x15/x53/x61, 060) E não CSOSN 500.
//   Quando só um dos dois é zero: f13==0 & f15>0 → crédito real (preencher base); f13>0 & f15==0 →
//   diferimento/redução (CST 20/51) → nunca zerar. Tudo isso fica como MANUAL até ligar a correção.
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C170-ICMSSEMBASE-01',
    refEAuditoria: '2075',
    bloco: 'C',
    registro: 'C170',
    titulo: 'ALIQ_ICMS > 0 no C170 com base/valor de ICMS zerados',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, se o item não credita ICMS (uso/consumo), a alíquota do ICMS no C170 deve ser 0. Se credita, informe base e valor do ICMS.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C170') || [])) {
            const f = l.f;
            if (aliqPos(f[14]) && (toCents(f[13]) === 0 || toCents(f[15]) === 0)) {
                erros.push({ linha: l.n, campo: 'ALIQ_ICMS', campoIdx: 14, valorAtual: f[14], valorSugerido: '0,00', detalhe: `ALIQ_ICMS ${f[14]}% com BC ${f[13]} / VL_ICMS ${f[15]} — item ${f[3] || '?'} (CFOP ${f[11]}).` });
            }
        }
        return erros;
    },
};
function aliqPos(v) { return (parseFloat(String(v || '0').replace(',', '.')) || 0) > 0; }
