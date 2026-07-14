// DOC-C191-FCP-01 — VL_FCP_RET (C191 campo 4) só pode ser preenchido se o CST_ICMS do registro PAI
// (C190) for x60 (ICMS já retido por ST) ou CSOSN 500. PVA: "O campo somente pode ser preenchido se
// o campo CST_ICMS do seu registro pai C190 possuir valor igual x60 ou 500." O FCP RETIDO por ST não
// se aplica a item não-ST → o export zera (jaCorrigidoNoExport). C191 = |C191|VL_FCP_OP|VL_FCP_ST|
// VL_FCP_RET| (f2/f3/f4); C190 f2 = CST_ICMS. Caso real: RAQUEL 05/2022, C191 0,15 sob C190 CST 040.
const num = (v) => parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0;
const ehST = (s) => { s = String(s || '').trim(); return (s.length === 3 && s.endsWith('60')) || s === '500'; };

module.exports = {
    id: 'DOC-C191-FCP-01',
    bloco: 'C',
    registro: 'C191',
    titulo: 'VL_FCP_RET do C191 preenchido sem CST x60/500 no C190 pai',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, o FCP retido (VL_FCP_RET) só vale para itens com ICMS-ST (CST x60 ou CSOSN 500). Para os demais CST, o campo deve ficar zerado.',
    detectar(model) {
        const erros = [];
        let cstPai = '';
        for (const l of model.linhas) {
            if (l.reg === 'C100') { cstPai = ''; continue; }
            if (l.reg === 'C190') { cstPai = String(l.f[2] || '').trim(); continue; }
            if (l.reg === 'C191' && l.f.length > 4) {
                // NB: detecção e export (corrigirC191FcpRet) zeram o VL_FCP_RET fora de x60/500. Um tratamento
                // ST-aware (não zerar quando o C190 pai tem VL_ICMS_ST>0) exige alinhar detecção + export juntos —
                // pendente (ver auditoria 2026-07-14). Mantido consistente com o export por ora.
                if (num(l.f[4]) !== 0 && !ehST(cstPai)) {
                    erros.push({ bloco: 'C', registro: 'C191', linha: l.n, campo: 'VL_FCP_RET', campoIdx: 4, valorAtual: l.f[4], valorSugerido: '0,00', detalhe: `VL_FCP_RET (${l.f[4]}) só pode ser preenchido se o CST do C190 pai for x60 ou 500 — o pai tem CST ${cstPai || '(?)'}. ` });
                }
            }
        }
        return erros;
    },
};
