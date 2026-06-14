// COMB-LMC-CONT — Continuidade do LMC por PRODUTO (1300): a ESTQ_ABERT de um dia deve ser o
// fechamento do dia anterior. Duas convenções de ERP são válidas e ambas aceitas:
//   • físico:  ABERT[D+1] = FECH_FISICO[D]
//   • livro:   ABERT[D+1] = ESTQ_ESCR[D]   (a perda/ganho do dia não carrega p/ a abertura do livro)
// Só acusa quando a abertura não casa com NENHUMA das duas (estoque mudou entre dias sem lançamento).
//
// Por que SÓ por produto (não por tanque): verificado em arquivos reais que a continuidade por
// TANQUE (1310) quebra de forma legítima por transferência entre tanques do mesmo produto
// (remanejamento) — o total do produto se conserva, mas o tanque individual sobe/desce. Logo,
// 1310 geraria falso-positivo; o sinal confiável é o total do produto (1300).
// Posições 1300: f2=COD_ITEM f3=DT_FECH f4=ESTQ_ABERT f8=ESTQ_ESCR f11=FECH_FISICO.
const num = (v) => { let s = String(v == null ? '' : v).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; };
const ymd = (dt) => { const s = String(dt || '').trim(); return s.length === 8 ? s.slice(4, 8) + s.slice(2, 4) + s.slice(0, 2) : s; }; // DDMMYYYY -> YYYYMMDD
const TOL = 0.01;

module.exports = {
    id: 'COMB-LMC-CONT',
    bloco: '1',
    registro: '1300',
    titulo: 'Quebra de continuidade do LMC (abertura ≠ fechamento do dia anterior)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No LMC/ERP, a abertura de cada dia (por produto) deve ser igual ao fechamento do dia anterior — físico (FECH_FISICO) ou escritural (ESTQ_ESCR). Se não casar com nenhum, houve acerto de estoque não escriturado entre os dias; confira aferições, perdas/ganhos e lançamentos.',
    detectar(model) {
        const erros = [];
        const porItem = new Map();
        for (const l of (model.porReg.get('1300') || [])) {
            if (l.f.length <= 11) continue;
            const cod = String(l.f[2] || '').trim();
            if (!porItem.has(cod)) porItem.set(cod, []);
            porItem.get(cod).push({ n: l.n, dt: l.f[3], abert: num(l.f[4]), escr: num(l.f[8]), fech: num(l.f[11]) });
        }
        for (const [cod, arr] of porItem) {
            arr.sort((a, b) => { const ka = ymd(a.dt), kb = ymd(b.dt); return ka < kb ? -1 : (ka > kb ? 1 : 0); });
            for (let i = 1; i < arr.length; i++) {
                const ab = arr[i].abert, pf = arr[i - 1].fech, pe = arr[i - 1].escr;
                if (Math.abs(ab - pf) <= TOL || Math.abs(ab - pe) <= TOL) continue; // casa com físico OU livro
                erros.push({
                    bloco: '1', registro: '1300', linha: arr[i].n, campo: 'ESTQ_ABERT', severidade: 'ADV',
                    valorAtual: String(ab), valorSugerido: pf.toFixed(3),
                    detalhe: `Produto ${cod}: abertura de ${arr[i].dt} (${ab}) ≠ fechamento de ${arr[i - 1].dt} (físico ${pf} / escritural ${pe}); diferença ${(ab - pf).toFixed(3)}.`,
                });
            }
        }
        return erros;
    },
};
