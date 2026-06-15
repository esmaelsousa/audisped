// EST-9XXX — Totalizadores/contadores: 9999 (total de linhas), X990 (linhas do bloco),
// 9900 (registros por tipo). Recalcula do arquivo e compara com o declarado. PVA: "Quantidade
// de linhas do bloco não confere". O export já recomputa isto (jaCorrigidoNoExport).
const blocoDe = (reg) => reg[0];

module.exports = {
    id: 'EST-9XXX-CONT',
    bloco: '9',
    registro: '9900/X990/9999',
    titulo: 'Totalizador/contador não confere',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'Regerar o arquivo no ERP — os registros 9900, X990 (0990/C990/…) e 9999 devem refletir a contagem real de linhas. Ocorre tipicamente após edição manual do .txt.',
    detectar(model) {
        const erros = [];
        const { linhas, porReg, totalLinhas, blocos } = model;

        // 9999 — total de linhas do arquivo (inclui 0000 e 9999)
        const l9999 = (porReg.get('9999') || [])[0];
        if (l9999) {
            const decl = parseInt(l9999.f[2]);
            if (decl !== totalLinhas) erros.push({ bloco: '9', registro: '9999', linha: l9999.n, campo: 'QTD_LIN', valorAtual: String(l9999.f[2]), valorSugerido: String(totalLinhas), detalhe: `9999 declara ${decl} linhas; o arquivo tem ${totalLinhas}.` });
        }

        // X990 — total de linhas de cada bloco presente (inclui X001, X990 e, no bloco 9, o 9999;
        // confirmado contra arquivo real válido: o 9990 conta TODAS as linhas do bloco 9).
        for (const b of blocos) {
            const reg990 = b + '990';
            const cont = linhas.filter(l => blocoDe(l.reg) === b).length;
            const l990 = (porReg.get(reg990) || [])[0];
            if (!l990) { erros.push({ bloco: b, registro: reg990, linha: null, campo: '', valorAtual: '(ausente)', valorSugerido: String(cont), detalhe: `Bloco ${b} presente, mas sem registro de fechamento ${reg990}.` }); continue; }
            const decl = parseInt(l990.f[2]);
            if (decl !== cont) erros.push({ bloco: b, registro: reg990, linha: l990.n, campo: 'QTD_LIN', valorAtual: String(l990.f[2]), valorSugerido: String(cont), detalhe: `${reg990} declara ${decl}; o bloco ${b} tem ${cont} linhas.` });
        }

        // 9900 — quantidade de registros por tipo
        for (const l of (porReg.get('9900') || [])) {
            const reg = l.f[2];
            const decl = parseInt(l.f[3]);
            const cont = (porReg.get(reg) || []).length;
            if (cont !== decl) erros.push({ bloco: '9', registro: '9900', linha: l.n, campo: 'QTD_REG', valorAtual: `${reg}=${l.f[3]}`, valorSugerido: `${reg}=${cont}`, detalhe: `9900 declara ${decl} registro(s) ${reg}; o arquivo tem ${cont}.` });
        }

        // 9900 COMPLETO — TODO tipo de registro presente precisa de uma entrada 9900 (PVA:
        // "É necessário totalizar os registros do tipo X no bloco 9"). Ocorre quando se injeta
        // um registro de tipo novo (ex.: E116/1360) sem a linha 9900 correspondente. O export
        // (garantirRegistros9900) insere a entrada que falta → jaCorrigidoNoExport.
        const tipos9900 = new Set((porReg.get('9900') || []).map(l => l.f[2]));
        for (const reg of porReg.keys()) {
            if (tipos9900.has(reg)) continue;
            const cont = (porReg.get(reg) || []).length;
            erros.push({ bloco: '9', registro: '9900', linha: null, campo: 'REG', valorAtual: '(ausente)', valorSugerido: `${reg}=${cont}`, detalhe: `É necessário totalizar os registros do tipo ${reg} no bloco 9 (não há |9900|${reg}|; o arquivo tem ${cont}).` });
        }
        return erros;
    },
};
