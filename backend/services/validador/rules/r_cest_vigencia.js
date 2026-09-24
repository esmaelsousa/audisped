// DOC-0200-CEST-02 — CEST REVOGADO antes da competência do arquivo.
//
// Irmã da DOC-0200-CEST-01 (que só checa EXISTÊNCIA). O Conv. ICMS 142/2018 e seus ajustes
// revogam códigos: um CEST legítimo em 2019 pode ter sido extinto em 2020. Escriturar um código
// revogado numa competência posterior é erro — e era invisível para nós até 24/09/2026, quando a
// tabela oficial com vigência foi importada (a nossa tinha só código + NCM).
//
// Medido na frota no dia da importação: 27 ocorrências em 3 códigos, todas com cara de erro real —
//   0100400 (fim 2020-12-31) — BOMBONA GOLPACK, usado em arquivos de 2022 e 2025
//   1700200 / 1700300 (fim 2022-12-31) — CHOC PRESTIGIO / CHOC BATOM, usados em 2023 e 2026
//
// Comparamos contra a DATA INICIAL do período (0000 f[4], DDMMAAAA): se o código foi revogado
// ANTES do início da competência, ele não podia estar ali. Um código revogado NO MEIO do mês não
// dispara — a operação pode ter ocorrido enquanto ainda valia, e acusar seria falso-positivo.
//
// ADV, não BLOQ: a tabela pode estar incompleta ou a revogação ter regra de transição que não
// conhecemos. O usuário confirma. Promover a BLOQ só depois de rodar um tempo sem falso-positivo.
// Sem `dominio.cestFim` carregado → não valida (degradação segura). Posições 0200: f[13]=CEST.
const digits = (s) => String(s || '').replace(/\D/g, '');

// DDMMAAAA → AAAA-MM-DD (comparável como string). Vazio se não tiver 8 dígitos.
function isoDeSped(d) {
    const s = digits(d);
    return s.length === 8 ? `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : '';
}

module.exports = {
    id: 'DOC-0200-CEST-02',
    bloco: '0',
    registro: '0200',
    titulo: 'CEST revogado antes da competência do arquivo',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o CEST do produto foi revogado pelo Confaz antes desta competência. Atualize o cadastro para o CEST vigente do item (ou deixe em branco, se o produto deixou de ser de substituição tributária).',
    detectar(model) {
        const dom = model.dominio;
        if (!dom || !dom.cestFim || !dom.cestFim.size) return [];
        const inicio = isoDeSped(model.dtIni);
        if (!inicio) return [];

        const erros = [];
        for (const l of (model.porReg.get('0200') || [])) {
            const bruto = String(l.f[13] || '').trim();
            if (!bruto) continue;                       // sem CEST é válido (nem todo produto tem ST)
            const cest = digits(bruto);
            const fim = dom.cestFim.get(cest);
            if (!fim) continue;                          // sem data fim = vigente
            if (!(fim < inicio)) continue;               // revogado durante/depois → não acusa

            erros.push({
                bloco: '0', registro: '0200', linha: l.n,
                campo: 'CEST', campoIdx: 13, permiteVazio: true,
                valorAtual: bruto, valorSugerido: '',
                ncm: String(l.f[8] || '').trim(),
                detalhe: `CEST ${bruto} foi revogado em ${fim}, antes do início desta escrituração (${inicio}) — produto "${String(l.f[3] || '').trim().slice(0, 40)}". Atualize para o CEST vigente ou deixe vazio se o item não é mais de substituição tributária.`,
            });
        }
        return erros;
    },
};
