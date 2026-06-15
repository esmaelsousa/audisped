// DOC-0200-CEST-01 — CEST (campo 13 do 0200) deve EXISTIR na tabela CEST (Conv. ICMS 142/2018).
// Caso ITATIAIA: CEST 1708704 (NCM 3923) → não localizado → ADV. Usa model.dominio (carregado do banco
// pelo endpoint: dominio.cestSet). Sem domínio carregado → não valida (degradação segura, p/ a suíte pura).
// Editável: o usuário apaga (produto sem ST) ou corrige o CEST. Posições 0200: f[8]=COD_NCM, f[13]=CEST.
//
// DECISÃO (anti-falso-positivo): a verificação CEST×NCM por PREFIXO foi REMOVIDA. Ela disparava em massa
// (29 ADV só na RAQUEL) com falsos-positivos — ex.: CEST 06.007.00 (combustíveis/lubrificantes) × NCM 3819
// (fluido de freio) é par legítimo, mas nossa lista de prefixos NCM por CEST é incompleta/granular demais.
// Além disso o próprio Conv. 142/2018 diz que a aplicabilidade do CEST depende da DESCRIÇÃO, não só do NCM.
// Só reintroduzir com casamento ciente da descrição + prefixos NCM 100% conferidos contra os anexos oficiais.
const digits = (s) => String(s || '').replace(/\D/g, '');

module.exports = {
    id: 'DOC-0200-CEST-01',
    bloco: '0',
    registro: '0200',
    titulo: 'CEST do 0200 não localizado na Tabela CEST (Conv. ICMS 142/2018)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o CEST do produto deve ser um código válido da Tabela CEST (Conv. ICMS 142/2018) e corresponder ao NCM. Se o produto NÃO é de substituição tributária, deixe o CEST em branco.',
    detectar(model) {
        const dom = model.dominio;
        if (!dom || !dom.cestSet || !dom.cestSet.size) return []; // tabela não carregada → não valida
        const erros = [];
        for (const l of (model.porReg.get('0200') || [])) {
            const cestRaw = String(l.f[13] || '').trim();
            if (!cestRaw) continue; // sem CEST é válido (nem todo produto tem ST)
            const cest = digits(cestRaw);
            if (cest.length !== 7) {
                erros.push({ bloco: '0', registro: '0200', linha: l.n, campo: 'CEST', campoIdx: 13, severidade: 'BLOQ', permiteVazio: true, valorAtual: cestRaw, valorSugerido: '', detalhe: `CEST "${cestRaw}" não tem 7 dígitos.` });
                continue;
            }
            if (!dom.cestSet.has(cest)) {
                // ADVERTÊNCIA (não BLOQ): nossa tabela CEST pode não estar 100% completa — não bloquear
                // um CEST válido por estar faltando na base. O usuário confirma/apaga. (Promover a BLOQ
                // quando a tabela for conferida 100% contra os anexos oficiais.)
                erros.push({ bloco: '0', registro: '0200', linha: l.n, campo: 'CEST', campoIdx: 13, severidade: 'ADV', permiteVazio: true, valorAtual: cestRaw, valorSugerido: '', detalhe: `CEST ${cestRaw} não localizado na Tabela CEST (Conv. 142/2018). Confirme o CEST; se o produto não é de substituição tributária, deixe vazio.` });
                continue;
            }
            // CEST existe na tabela → OK. (NÃO conferimos CEST×NCM por prefixo — vide nota no topo do arquivo.)
        }
        return erros;
    },
};
