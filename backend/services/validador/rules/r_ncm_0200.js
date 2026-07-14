// CAD-0200-03 — Mercadoria/insumo (0200) sem NCM válido (8 dígitos). Combustível exige NCM.
// Conservador: só exige NCM p/ TIPO_ITEM de mercadoria/insumo (00,01,02,03,04,05,06,10);
// pula 07 (uso/consumo), 08 (ativo), 09 (serviço) e 99 (outras) p/ evitar falso-positivo.
const TIPOS_EXIGEM_NCM = new Set(['00', '01', '02', '03', '04', '05', '06', '10']);
const NCM_PLACEHOLDER = new Set(['00000000', '99999999']); // 8 dígitos porém não é NCM real (PVA rejeita)

module.exports = {
    id: 'CAD-0200-03',
    bloco: '0',
    registro: '0200',
    titulo: 'Mercadoria (0200) sem NCM válido (8 dígitos)',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, informe o NCM (8 dígitos) do produto no cadastro (registro 0200). Obrigatório para mercadorias e insumos; combustível tem NCM (ex.: gasolina 27101259).',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('0200') || [])) {
            const tipo = String(l.f[7] || '').trim();
            if (!TIPOS_EXIGEM_NCM.has(tipo)) continue;
            const ncm = String(l.f[8] || '').replace(/\D/g, '');
            const placeholder = NCM_PLACEHOLDER.has(ncm);
            if (ncm.length !== 8 || placeholder) {
                erros.push({ bloco: '0', registro: '0200', linha: l.n, campo: 'COD_NCM', campoIdx: 8, valorAtual: l.f[8] || '(vazio)', detalhe: `Item "${String(l.f[2] || '').trim()}" (TIPO_ITEM ${tipo}) com NCM inválido — ${placeholder ? `"${ncm}" não é um NCM real (placeholder).` : 'esperado 8 dígitos.'}` });
            }
        }
        return erros;
    },
};
