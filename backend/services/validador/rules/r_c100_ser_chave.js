// DOC-C100-SER-01 — SÉRIE (campo 7 do C100) deve ser igual à série embutida na CHAVE de acesso.
// PVA (BLOQ): "O campo série que compõe a chave do documento fiscal eletrônico deverá ser igual ao
// campo Série informado no registro." A chave da NF-e/NFC-e (44 díg.) traz a série nas posições 23-25
// (índice 22..25). A chave é a identidade canônica do documento → o correto é alinhar SER à chave.
// Caso real: POSTO PREÇO BOM (10795278000156, 01/2026) — 1 C100 com SER=000 e chave série=001.
// C100: f5=COD_MOD, f6=COD_SIT, f7=SER, f9=CHV_NFE. Corrigido no download (corrigirSerChave).
const serDaChave = (ch) => ch.slice(22, 25); // 3 díg., zero-padded (formato do SPED, ex.: "001")

module.exports = {
    id: 'DOC-C100-SER-01',
    bloco: 'C',
    registro: 'C100',
    titulo: 'Série do C100 diferente da série contida na chave de acesso',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, a série do documento (campo SER) deve ser a mesma série que compõe a chave de acesso (posições 23 a 25 da chave). O sistema alinha SER à chave no download.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C100') || [])) {
            const mod = String(l.f[5] || '').trim();
            const sit = String(l.f[6] || '').trim();
            if (!['55', '65'].includes(mod)) continue;                          // só NF-e/NFC-e têm chave de 44 díg.
            if (!['00', '01', '06', '07', '08'].includes(sit)) continue;        // pula cancelado/denegado (02-05)
            const ch = String(l.f[9] || '').replace(/\D/g, '');
            if (ch.length !== 44) continue;                                      // chave inválida → é a regra DOC-CHV-DV
            const ser = String(l.f[7] || '').trim();
            const serCh = serDaChave(ch);
            if (parseInt(ser || '-1', 10) !== parseInt(serCh, 10)) {
                erros.push({
                    bloco: 'C', registro: 'C100', linha: l.n, campo: 'SER', campoIdx: 7,
                    valorAtual: ser || '(vazio)', valorSugerido: serCh,
                    detalhe: `SER informado "${ser || '(vazio)'}" ≠ série da chave "${serCh}". A chave é a identidade do documento; corrigido para "${serCh}" no download.`,
                });
            }
        }
        return erros;
    },
};
