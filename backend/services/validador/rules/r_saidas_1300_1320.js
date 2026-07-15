// COMB-1300-1320-01 (catálogo de referência 2023) — VOL_SAIDAS do 1300 (campo 7) deve ser a soma das vendas por
// bico (VOL_VENDAS, campo 11 dos 1320) do mesmo produto/dia: [1300.f7 = Σ 1320.f11].
// ADV: divergências abaixo de ~1 litro são ARREDONDAMENTO legítimo (cada bico arredonda a 3 casas;
// a soma acumula sub-litro) — mesma lição do ref. 2481. Por isso aplicamos tolerância: o painel de auditoria
// usa tolerância R$0,00 e aponta todo sub-litro (no arq 2028 = 140 ocorrências, TODAS ≤ 0,013 L de
// arredondamento). Aqui só apontamos divergência REAL (acima da tolerância), evitando poluir com ruído.
//
// Campos: 1300 f[2]=COD_ITEM f[3]=DT f[7]=VOL_SAIDAS; 1320 f[11]=VOL_VENDAS (bico). Os 1320 são netos
// do 1300 (via 1310) — somam-se todos entre um 1300 e o próximo.
const num = (v) => { let s = String(v == null ? '' : v).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; };
const TOL = 0.05; // litros — absorve o arredondamento sub-litro dos bicos; omissão real é ≥ litros

module.exports = {
    id: 'COMB-1300-1320-01',
    bloco: '1',
    registro: '1300',
    titulo: 'VOL_SAIDAS do produto (1300) ≠ soma das vendas por bico (1320)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    refCatalogo: '2023',
    instrucaoERP: 'No LMC/ERP, o volume total de saídas do produto no dia (1300) deve ser a soma das vendas de todos os bicos daquele produto (1320). Divergências de poucos mililitros são arredondamento e podem ser ignoradas; diferenças acima de ~1 litro indicam venda de bico não somada ou saída lançada a mais/menos.',
    detectar(model) {
        const erros = [];
        let cur = null;   // { n, cod, dt, saidas } do 1300 corrente
        let somaBicos = 0;

        const flush = () => {
            if (!cur) return;
            const d = cur.saidas - somaBicos;
            if (Math.abs(d) > TOL) {
                erros.push({
                    bloco: '1', registro: '1300', linha: cur.n, campo: 'VOL_SAIDAS', severidade: 'ADV',
                    valorAtual: cur.saidas.toFixed(3), valorSugerido: somaBicos.toFixed(3),
                    detalhe: `Produto ${cur.cod}, dia ${cur.dt}: VOL_SAIDAS do 1300 (${cur.saidas.toFixed(3)}) ≠ soma das vendas por bico do 1320 (${somaBicos.toFixed(3)}), diferença ${d.toFixed(3)} L.`,
                });
            }
        };

        for (const l of model.linhas) {
            if (l.reg === '1300') {
                flush();
                cur = { n: l.n, cod: String(l.f[2] || '').trim(), dt: String(l.f[3] || '').trim(), saidas: num(l.f[7]) };
                somaBicos = 0;
            } else if (l.reg === '1320' && cur) {
                somaBicos += num(l.f[11]);
            } else if (l.reg !== '1310' && l.reg !== '1320') {
                flush(); cur = null; somaBicos = 0; // saiu da sequência diária do LMC
            }
        }
        flush();
        return erros;
    },
};
