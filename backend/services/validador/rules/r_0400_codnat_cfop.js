// CAD-0400-CFOP-01 (E-Auditoria 2441) — COD_NAT do 0400 preenchido com um código CFOP.
// O 0400 é tabela de naturezas PRÓPRIAS do contribuinte; CFOP tem 4 dígitos começando por 1/2/3/5/6/7.
//
// PAINEL (cross-empresa 2026-07-08 §3 — REVISAO-CROSS-EMPRESA-2026-07-08.md): usar o CFOP como COD_NAT
// é LEGÍTIMO (não há vedação no Guia Prático) e o COD_NAT é FK referenciada por C100/C500/D100/D500 —
// recodificar isolado quebra a integridade e o PVA rejeita. Logo: SÓ-DETECÇÃO/INFO, NUNCA auto-corrigir
// (sem campoIdx). A UI pode agregar num único alerta por arquivo ("N naturezas do 0400 usam CFOP como código").
module.exports = {
    id: 'CAD-0400-CFOP-01',
    refEAuditoria: '2441',
    bloco: '0',
    registro: '0400',
    titulo: 'COD_NAT do 0400 preenchido com um código CFOP (prática válida; recodificar é opcional)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o COD_NAT do registro 0400 pode ser uma codificação própria da natureza da operação (não precisa ser um CFOP). Se quiser, recadastre com um código/descritivo interno — mas é opcional e o COD_NAT é referenciado pelos documentos.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('0400') || [])) {
            const c = String(l.f[2] || '').trim();
            if (/^[123567]\d{3}$/.test(c)) {
                erros.push({ linha: l.n, campo: 'COD_NAT', valorAtual: c, detalhe: `COD_NAT "${c}" parece um CFOP (${l.f[3] || ''}) — prática válida; recodificar é opcional.` });
            }
        }
        return erros;
    },
};
