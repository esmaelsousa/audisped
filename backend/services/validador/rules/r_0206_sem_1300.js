// COMB-0206-1300-01 (E-Auditoria 2321) — produto com registro 0206 (código ANP) que não possui
// movimentação no LMC (nenhum 1300 com o mesmo COD_ITEM). Típico de lubrificantes: têm 0206 mas
// não são combustíveis controlados pelo LMC.
//
// GATE DO PAINEL (cross-empresa 2026-07-08 §3 — REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   (a) SÓ roda se o arquivo mantém LMC (≥1 registro 1300) — senão é distribuidora/TRR/não-posto ou
//       período sem LMC e TODO 0206 viraria falso positivo. [aplicado — não muda o POSTO CG, que tem 1300]
//   (b) o painel sugere restringir a combustível AUTOMOTIVO (ANP/NCM); NÃO aplicado à detecção para
//       preservar a paridade com o E-Auditoria (os 2 do POSTO CG são lubrificantes) — a ressalva vai no
//       detalhe. SÓ-DETECÇÃO/alerta: nunca auto-gerar 1300 (fabricaria movimentação de LMC ilegal).
module.exports = {
    id: 'COMB-0206-1300-01',
    refEAuditoria: '2321',
    bloco: '0',
    registro: '0206',
    titulo: 'Produto com 0206 (ANP) sem movimentação no 1300 (LMC)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP: se o produto com código ANP (0206) for combustível de revenda, gere o 1300/1310/1370 (LMC). Se for lubrificante/óleo/GLP não sujeito ao LMC, o alerta pode ser desconsiderado.',
    detectar(model) {
        if (!(model.porReg.get('1300') || []).length) return []; // gate (a): sem LMC no arquivo → não avalia
        const itens1300 = new Set((model.porReg.get('1300') || []).map(l => String(l.f[2] || '').trim()));
        const erros = [];
        let codItem = null;   // COD_ITEM do 0200 pai corrente
        const jaAvisado = new Set();
        for (const l of model.linhas) {
            if (l.reg === '0200') codItem = String(l.f[2] || '').trim();
            else if (l.reg === '0206' && codItem != null) {
                if (!itens1300.has(codItem) && !jaAvisado.has(codItem)) {
                    jaAvisado.add(codItem);
                    erros.push({ linha: l.n, campo: 'COD_ANP', valorAtual: String(l.f[2] || '').trim(), detalhe: `Produto ${codItem} tem 0206 (ANP ${l.f[2] || '?'}) mas nenhum 1300 (LMC) — se for lubrificante/GLP fora do LMC, desconsidere.` });
                }
            } else if (l.reg[0] !== '0') codItem = null; // saiu do bloco 0
        }
        return erros;
    },
};
