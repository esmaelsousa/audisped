// DOC-C170-CODCTA-01 (E-Auditoria 2451) — COD_CTA (código da conta analítica) vazio no C170.
// Campo "OC" (obrigatório se houver informação).
//
// GATE DO PAINEL (cross-empresa 2026-07-08 §2.6 — REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   Se o arquivo NÃO tem 0500 (plano de contas na EFD), COD_CTA vazio é 100% LEGÍTIMO — preencher geraria
//   erro PVA "0500 inexistente". SÓ-DETECÇÃO, NUNCA auto-preencher (sem campoIdx; não há conta a inventar).
//   Detecta reproduzindo o E-Auditoria (todos os C170 sem COD_CTA), mas quando não há 0500 a mensagem
//   deixa claro que é legítimo/desconsiderável. A UI pode agregar num alerta por arquivo.
module.exports = {
    id: 'DOC-C170-CODCTA-01',
    refEAuditoria: '2451',
    bloco: 'C',
    registro: 'C170',
    titulo: 'COD_CTA (conta analítica) não informado no C170',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, informe a conta contábil (COD_CTA) do item no C170 conforme o plano de contas (0500). Se a EFD não mantém o registro 0500, o COD_CTA pode ficar vazio (o alerta pode ser desconsiderado).',
    detectar(model) {
        const temPlanoContas = (model.porReg.get('0500') || []).length > 0;
        const erros = [];
        for (const l of (model.porReg.get('C170') || [])) {
            if (String(l.f[37] || '').trim() === '') {
                erros.push({
                    linha: l.n, campo: 'COD_CTA', valorAtual: '(vazio)',
                    detalhe: temPlanoContas
                        ? `Item ${l.f[2] || '?'} (${l.f[3] || '?'}) sem conta analítica (COD_CTA) — informe conforme o 0500.`
                        : `Item ${l.f[2] || '?'} (${l.f[3] || '?'}) sem COD_CTA — arquivo SEM 0500 (plano de contas): vazio é legítimo, pode desconsiderar.`,
                });
            }
        }
        return erros;
    },
};
