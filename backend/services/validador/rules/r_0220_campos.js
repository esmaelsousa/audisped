// CAD-0220-01 — Registro 0220 (fator de conversão) com nº de campos diferente do leiaute.
// O nº de campos DEPENDE do COD_VER do 0000 (comprovado em arquivos+PVA reais):
//   • = 015: 3 campos → `|0220|UNID|FAT|`            → split('|').length = 5
//   • ≥ 016: 4 campos → `|0220|UNID|FAT|X|`          → split('|').length = 6 (4º campo, em geral vazio).
// O ERP emite SEMPRE 4 campos. Evidências PVA: 2021 leiaute 015 → "esperado 3"; 2023 leiaute 017,
// 2025 leiaute 019, 2026 leiaute 020 → "esperado 4". Mapa: 2021=015,2022=016,2023=017,2024=018,2025=019,2026=020.
module.exports = {
    id: 'CAD-0220-01',
    bloco: '0',
    registro: '0220',
    titulo: 'Registro 0220 com nº de campos diferente do leiaute',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, o 0220 deve seguir o leiaute: leiaute 015 (2021) tem 3 campos (REG|UNID_CONV|FAT_CONV); a partir do leiaute 016 (2022) são 4 campos (último em branco). Ajuste o nº de pipes. (No nosso export já é normalizado automaticamente conforme a versão.)',
    detectar(model) {
        const erros = [];
        const is020 = String(model.versao || '') >= '016'; // ≥016 → 4 campos; 015 → 3
        const nCampos = is020 ? 4 : 3;          // contagem PVA (inclui REG)
        const splitLen = nCampos + 2;            // pipes nas pontas → split('|').length
        for (const l of (model.porReg.get('0220') || [])) {
            if (l.f.length !== splitLen) {
                const sugerido = is020
                    ? `|0220|${l.f[2] || ''}|${l.f[3] || ''}|${l.f[4] || ''}|`
                    : `|0220|${l.f[2] || ''}|${l.f[3] || ''}|`;
                erros.push({
                    bloco: '0', registro: '0220', linha: l.n, campo: '(estrutura)',
                    valorAtual: l.raw,
                    valorSugerido: sugerido,
                    detalhe: `Esperado ${nCampos} campos (leiaute ${model.versao || '?'}; split=${splitLen}); encontrado ${Math.max(0, l.f.length - 2)} campo(s) (split=${l.f.length}).`,
                });
            }
        }
        return erros;
    },
};
