// DOC-C190-REDBC-01 (E-Auditoria 2800) — VL_RED_BC do C190 preenchido com CST que não é de redução.
// Regra: se VL_RED_BC > 0 e COD_SIT do C100 pai ∈ {00,01}, o 2º-3º dígitos do CST devem ser 20 ou 70.
//
// ⚠️ GATE DE AUTO-CORREÇÃO (painel cross-empresa 2026-07-08 §2.4 — REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   DETECÇÃO reproduz o E-Auditoria. A AUTO-CORREÇÃO (zerar VL_RED_BC) exige no coletor:
//     - f6(BC)==0 **E** f7(ICMS)==0 (sem redução real → é ruído); se 0<f6<f5 ou f7>0 há redução GENUÍNA
//       → reclassificar CST p/ 020/070 ou MANUAL, NUNCA zerar;
//     - f2 é CST da Tabela B (excluir CSOSN 101/102/.../900 — o teste do 2 últimos díg. confunde CSOSN 900→'00');
//     - excluir CST terminando em 90 (aceita RED_BC legítimo) e 51 (diferimento);
//     - preferir IND_OPER='1' (saída própria; não mexer em entrada-espelho).
//   ‼️ BLOQUEADO até o FIX DE ORDEM DO EXPORT (Task 0.5 / CROSS-EXPORT-C190): correção de C190 é
//   descartada em silêncio hoje.
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C190-REDBC-01',
    refEAuditoria: '2800',
    bloco: 'C',
    registro: 'C190',
    titulo: 'VL_RED_BC no C190 incompatível com o CST (deve ser x20/x70)',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, VL_RED_BC só se aplica a CST de redução de base (2º-3º dígitos 20 ou 70). Para uso/consumo (x90) zere a redução, ou reclassifique o CST.',
    detectar(model) {
        const erros = [];
        let sit = '';
        for (const l of model.linhas) {
            if (l.reg === 'C100') sit = String(l.f[6] || '').trim();
            else if (l.reg === 'C190') {
                const f = l.f;
                const cst = String(f[2] || '').trim();
                if (toCents(f[10]) > 0 && !['20', '70'].includes(cst.slice(-2)) && ['00', '01'].includes(sit)) {
                    erros.push({ linha: l.n, campo: 'VL_RED_BC', campoIdx: 10, valorAtual: f[10], valorSugerido: '0,00', detalhe: `VL_RED_BC ${f[10]} exige CST x20/x70; CST atual ${cst} (CFOP ${f[3]}).` });
                }
            } else if (l.reg[0] !== 'C') sit = '';
        }
        return erros;
    },
};
