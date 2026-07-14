// DOC-C190-CFOPUF-01 (E-Auditoria 2742) — CFOP incompatível com a UF do participante.
// O CFOP iniciado por 1 ou 5 é OPERAÇÃO INTERNA: a UF do participante (cliente/fornecedor) tem de
// ser a mesma do declarante. Se o participante está em outra UF com CFOP 1xxx/5xxx → aponta.
// É ADV: o próprio E-Auditor ressalva que operações PRESENCIAIS (venda no balcão a comprador de
// outra UF) são internas e usam CFOP 5 legitimamente — por isso orienta ("Verifique"), não bloqueia.
//
// Campos: C190 f[3]=CFOP (campo 03). Participante = COD_PART do C100 pai (f[4]) → 0150; a UF sai do
// COD_MUN do 0150 (f[8], 7 díg. IBGE; 2 primeiros = código da UF). Declarante = UF do 0000 (model.uf).
// Verificado no par casado arq 2028 (S CRUZ 09069475000109 01/2026): E-Auditor 2742 = 36 ocorrências.
const UF_COD = { RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53' };
const COD_UF = Object.fromEntries(Object.entries(UF_COD).map(([uf, cod]) => [cod, uf]));

module.exports = {
    id: 'DOC-C190-CFOPUF-01',
    bloco: 'C',
    registro: 'C190',
    titulo: 'CFOP interno (1/5) com participante de outra UF',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    refEAuditoria: '2742',
    instrucaoERP: 'No ERP, CFOP iniciado por 1 ou 5 é operação INTERNA (mesma UF). Se o cliente/fornecedor é de outra UF, use CFOP interestadual (inicia por 2 ou 6). Exceção: venda PRESENCIAL (balcão) a comprador de outra UF é operação interna e o CFOP 5 está correto — nesse caso, desconsidere.',
    detectar(model) {
        const declUF = String(model.uf || '').trim().toUpperCase();
        const declCod = UF_COD[declUF];
        if (!declCod) return []; // sem UF do declarante: não há como cruzar
        // COD_PART -> código de UF (2 díg.), só participantes do Brasil (COD_PAIS 1058)
        const partCod = new Map();
        for (const l of (model.porReg.get('0150') || [])) {
            const codPart = String(l.f[2] || '').trim();
            if (!codPart) continue;
            const pais = String(l.f[4] || '').trim();
            if (pais && pais !== '1058') continue; // exterior: usa CFOP 3/7, fora desta regra
            const c2 = String(l.f[8] || '').trim().slice(0, 2);
            if (c2 && COD_UF[c2]) partCod.set(codPart, c2);
        }
        const erros = [];
        let curPart = null, curDoc = '?';
        for (const l of model.linhas) {
            if (l.reg === 'C100') { curPart = String(l.f[4] || '').trim(); curDoc = String(l.f[8] || '').trim(); continue; }
            if (l.reg !== 'C190') continue;
            const cfop = String(l.f[3] || '').trim();
            if (!/^[15]\d{3}$/.test(cfop)) continue; // só CFOP interno (1xxx/5xxx)
            if (/929$/.test(cfop)) continue; // 1929/5929 = lançamento por ECF (venda presencial): interno por natureza, mesmo com participante de outra UF
            if (!curPart) continue;
            const pc = partCod.get(curPart);
            if (!pc || pc === declCod) continue; // sem UF definida (exterior/sem COD_MUN) ou mesma UF
            erros.push({
                bloco: 'C', registro: 'C190', linha: l.n, campo: 'CFOP', severidade: 'ADV',
                valorAtual: cfop,
                detalhe: `CFOP ${cfop} é operação interna (1ª casa 1/5), mas o participante ${curPart} está em ${COD_UF[pc]}, diferente da UF do declarante (${declUF}) — doc nº ${curDoc}. Se for venda presencial (balcão), é operação interna e pode ser desconsiderado.`,
            });
        }
        return erros;
    },
};
