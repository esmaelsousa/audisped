// COMB-1350-1360-01 — Bloco 1 (LMC): toda BOMBA (1350) deve ter ao menos um registro 1360
// (Lacres da bomba) como filho. PVA: "Registro filho obrigatório não foi informado. Registro 1360".
// Hierarquia: 1350 (pai) → 1360 (lacres) + 1370 (bicos), ambos filhos do 1350. Alguns ERPs emitem
// 1350 + 1370 SEM os 1360 (caso de exemplo (arq 388): 2×1350, 0×1360, 4×1370 → 2 erros).
// NÃO é auto-corrigível: o 1360 exige NUM_LACRE + DT_APLICACAO (nº físico do lacre/selo), dado que
// não existe no arquivo nem no banco — fabricar seria inventar dado fiscal. Correção manual no ERP/LMC.
module.exports = {
    id: 'COMB-1350-1360-01',
    bloco: '1',
    registro: '1350',
    titulo: 'Bomba (1350) sem registro de lacres (1360) obrigatório',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP/LMC, cada bomba/medidor (1350) precisa de ao menos um registro 1360 (Lacres da bomba), com NUM_LACRE e DT_APLICACAO. Informe os lacres de cada bomba.',
    detectar(model) {
        const erros = [];
        let cur = null; // 1350 corrente { linha, lacres, raw }
        const fechar = () => {
            if (cur && cur.lacres === 0) {
                erros.push({
                    bloco: '1', registro: '1350', linha: cur.linha, campo: '(filho 1360)',
                    severidade: 'BLOQ', valorAtual: cur.raw,
                    detalhe: 'Bomba (1350) sem nenhum registro 1360 (Lacres) — filho obrigatório pelo PVA.',
                });
            }
        };
        for (const l of model.linhas) {
            if (l.reg === '1350') { fechar(); cur = { linha: l.n, lacres: 0, raw: l.raw }; }
            else if (l.reg === '1360' && cur) { cur.lacres++; }
            // 1370 (bicos) NÃO satisfaz a obrigatoriedade do 1360.
        }
        fechar();
        return erros;
    },
};
