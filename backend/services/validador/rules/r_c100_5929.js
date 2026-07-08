// DOC-C100-5929-01 (E-Auditoria 1003) — CFOP 5929/6929 (nota espelho de operação já tributada em
// ECF/cupom) NÃO deve ter valor da operação, alíquota, base ou ICMS no C190.
//
// SÓ-DETECÇÃO (decisão do cliente + painel §3 — REVISAO-CROSS-EMPRESA-2026-07-08.md): a correção (zerar)
// conflita com o importador5929Service (que preenche 5929 zeradas) e, no POSTO CG, as 31 ocorrências são
// CST 061 com VL_OPR legítimo (monofásico) — zerar destruiria VL_OPR e criaria o bloqueante
// C100.VL_DOC ≠ Σ C190.VL_OPR. Nunca auto-corrigir (sem campoIdx). O painel distingue sinal FORTE
// (VL_ICMS ou ALIQ ≠ 0 → possível bitributação) do FRACO (VL_OPR sozinho → valor informativo legítimo);
// a severidade reflete isso.
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C100-5929-01',
    refEAuditoria: '1003',
    bloco: 'C',
    registro: 'C190',
    titulo: 'CFOP 5929/6929 com valor/alíquota/base/ICMS diferentes de zero',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'CFOP 5929/6929 acoberta operação já tributada (ECF/cupom): valor da operação, alíquota, base e ICMS devem ser 0 (exceto MG/RN/SC). Atenção: pode conflitar com a injeção de valores 5929 (monofásico).',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C190') || [])) {
            const f = l.f;
            const cfop = String(f[3] || '').trim();
            if (cfop === '5929' || cfop === '6929') {
                const aliq = parseFloat(String(f[4] || '0').replace(',', '.')) || 0;
                const forte = aliq !== 0 || toCents(f[7]) !== 0;                // ICMS/ALIQ ≠ 0 → possível bitributação
                if (forte || toCents(f[5]) !== 0 || toCents(f[6]) !== 0) {
                    erros.push({
                        linha: l.n, campo: 'CFOP 5929/6929', valorAtual: `${cfop} ICMS ${f[7]}`, severidade: forte ? 'BLOQ' : 'ADV',
                        detalhe: forte
                            ? `CFOP ${cfop} com ICMS ${f[7]} / alíq ${f[4]} — indício de bitributação (deveriam ser 0).`
                            : `CFOP ${cfop} com VL_OPR ${f[5]} (ICMS/alíq zerados) — provável monofásico/injeção 5929 legítimo; verificar.`,
                    });
                }
            }
        }
        return erros;
    },
};
