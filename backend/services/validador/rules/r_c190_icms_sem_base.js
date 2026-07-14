// DOC-C190-ICMSSEMBASE-01 (E-Auditoria 2951) — C190 com ALIQ_ICMS > 0 mas VL_BC_ICMS ou VL_ICMS = 0.
// Espelho analítico do 2075.
//
// ⚠️ GATE DE AUTO-CORREÇÃO (painel cross-empresa 2026-07-08 §2.3 — REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   DETECÇÃO reproduz o E-Auditoria (OR). A AUTO-CORREÇÃO (zerar ALIQ) exige no coletor:
//     - f6(BC)==0 **E** f7(ICMS)==0 **E** f9(ICMS_ST)==0  (AND, não OR — o OR arrasta diferimento/suspensão
//       que têm base>0 e VL_ICMS=0 legítimos), f5(VL_OPR)>0;
//     - CST (f2) NÃO terminar em 50 (suspensão) nem 51 (diferimento);
//     - CFOP uso/consumo (1556/2556/1407/2407) ou par casado com o 2075 da mesma NF.
//   ‼️ BLOQUEADO até o FIX DE ORDEM DO EXPORT (Task 0.5 / CROSS-EXPORT-C190 §2.0): hoje o export
//   relabela/funde o C190 ANTES de aplicar val_correcoes → a correção de C190 é descartada em silêncio.
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C190-ICMSSEMBASE-01',
    refEAuditoria: '2951',
    bloco: 'C',
    registro: 'C190',
    titulo: 'ALIQ_ICMS > 0 no C190 com base/valor de ICMS zerados',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, se a combinação CST/CFOP/alíquota do C190 não credita ICMS, a alíquota deve ser 0. Caso contrário, informe base e valor de ICMS.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C190') || [])) {
            const f = l.f;
            const aliq = parseFloat(String(f[4] || '0').replace(',', '.')) || 0;
            if (aliq > 0 && (toCents(f[6]) === 0 || toCents(f[7]) === 0)) {
                // CST 50 (suspensão) / 51 (diferimento): base>0 e VL_ICMS=0 são LEGÍTIMOS → não é bloqueante
                // nem se sugere zerar a alíquota; sinaliza como ADV para conferência.
                const cst = String(f[2] || '').trim();
                const suspDif = cst.endsWith('50') || cst.endsWith('51');
                if (suspDif) {
                    erros.push({ linha: l.n, campo: 'ALIQ_ICMS', campoIdx: 4, severidade: 'ADV', valorAtual: f[4], detalhe: `C190 ALIQ ${f[4]}% com BC ${f[6]} / VL_ICMS ${f[7]} — CST ${cst} (suspensão/diferimento): VL_ICMS=0 pode ser legítimo, confira (não zere a alíquota automaticamente).` });
                } else {
                    erros.push({ linha: l.n, campo: 'ALIQ_ICMS', campoIdx: 4, valorSugerido: '0,00', detalhe: `C190 ALIQ ${f[4]}% com BC ${f[6]} / VL_ICMS ${f[7]} (CST ${cst}, CFOP ${f[3]}).` });
                }
            }
        }
        return erros;
    },
};
