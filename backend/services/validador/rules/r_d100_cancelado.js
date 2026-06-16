// DOC-D100-CANC-01 — D100 cancelado (COD_SIT 02/03) ou denegado (04) com campos além do permitido.
// PVA: "Para documento cancelado/denegado, somente informar COD_SIT, IND_OPER, COD_MOD e a chave."
// O ERP deixa COD_MUN_ORIG/DEST (e às vezes valores/datas) preenchidos. O export limpa tudo depois
// da chave (f10) → jaCorrigidoNoExport. D100: f6=COD_SIT, f10=CHV_CTE; campos após = f11.. (datas,
// valores, COD_MUN_ORIG f24, COD_MUN_DEST f25). Caso real: RAQUEL 08/2024, CT-e mod 57 COD_SIT 02.
const CANC = new Set(['02', '03', '04']);

module.exports = {
    id: 'DOC-D100-CANC-01',
    bloco: 'D',
    registro: 'D100',
    titulo: 'D100 cancelado/denegado com campos preenchidos além de COD_SIT/IND_OPER/COD_MOD/chave',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, documento cancelado (COD_SIT 02/03) ou denegado (04) deve informar SOMENTE COD_SIT, IND_OPER, COD_MOD e a chave. Os demais campos (COD_MUN, valores, datas) ficam em branco.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('D100') || [])) {
            if (!CANC.has(String(l.f[6] || '').trim())) continue;
            // algum campo após a chave (f10) está preenchido?
            let extra = '';
            for (let k = 11; k <= l.f.length - 2; k++) {
                if (String(l.f[k] || '').trim() !== '') { extra = l.f[k]; break; }
            }
            if (extra) {
                erros.push({ bloco: 'D', registro: 'D100', linha: l.n, campo: 'COD_MUN/valores', valorAtual: extra, valorSugerido: '(vazio)', detalhe: `Documento CANCELADO/DENEGADO (COD_SIT ${String(l.f[6]).trim()}) com campo(s) preenchido(s) após a chave (ex.: ${extra}). Só pode haver COD_SIT, IND_OPER, COD_MOD e a chave.` });
            }
        }
        return erros;
    },
};
