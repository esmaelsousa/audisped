// EST-9900-REGBLC-01 (catálogo de referência 2037) — REG_BLC do 9900 aponta um registro que não existe no arquivo.
// O 9900 totaliza ocorrências de cada registro; não deve listar registro ausente.
//
// GATE DO PAINEL (cross-empresa 2026-07-08 §2.5 — REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   Severidade por QTD_REG_BLC (f3): QTD==0 (catálogo verboso com zeros, caso do POSTO CG) → ADV,
//   auto-remoção segura no export (só quando f3==0). QTD>0 e registro ausente → NÃO é lixo estrutural,
//   é POSSÍVEL OMISSÃO DE DOCUMENTOS (C500/D500/D100/K/G) → BLOQ, jamais auto-remover.
//   A remoção (só QTD==0) é passo do export (removerRegistros9900Ausentes) — BLOQUEADO até localhost.
module.exports = {
    id: 'EST-9900-REGBLC-01',
    refCatalogo: '2037',
    bloco: '9',
    registro: '9900',
    titulo: 'REG_BLC do 9900 não existe no arquivo',
    severidade: 'ADV',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o registro 9900 deve totalizar apenas registros presentes no arquivo. Regenere o bloco 9.',
    detectar(model) {
        const erros = [];
        const presentes = new Set([...model.porReg.keys()]);
        for (const l of (model.porReg.get('9900') || [])) {
            const reg = String(l.f[2] || '').trim();
            if (reg && reg !== '9900' && reg !== '9999' && !presentes.has(reg)) {
                const qtd = parseInt(String(l.f[3] || '0').replace(/\D/g, ''), 10) || 0;
                const sev = qtd > 0 ? 'BLOQ' : 'ADV';
                erros.push({
                    linha: l.n, campo: 'REG_BLC', valorAtual: reg, severidade: sev,
                    detalhe: qtd > 0
                        ? `9900 totaliza o registro "${reg}" com QTD ${qtd}, que não existe no arquivo — POSSÍVEL OMISSÃO DE DOCUMENTOS (não remover; verificar).`
                        : `9900 totaliza o registro "${reg}" (QTD 0), que não existe no arquivo — linha supérflua.`,
                });
            }
        }
        return erros;
    },
};
