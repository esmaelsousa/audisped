// COMB-1300-SUM — Reconciliação produto × tanques: cada campo do 1300 (totais do produto no dia)
// deve ser a SOMA dos 1310 (tanques daquele produto/dia). É um snapshot do mesmo dia, então não
// sofre a ambiguidade de transferência entre tanques (que afeta a continuidade entre dias).
// Verificado em 1829 registros reais (13 arquivos): maxΔ = 0,000 em todos os 8 campos → ruído de
// arredondamento nulo. Logo, qualquer divergência é inconsistência interna real (BLOQ; agregação
// determinística que o PVA valida).
// Mapeamento (1300 fX → 1310 fY), 8 campos: ABERT(4→3) ENTR(5→4) DISP(6→5) SAIDAS(7→6) ESCR(8→7) PERDA(9→8) GANHO(10→9) FECH(11→10).
const num = (v) => { let s = String(v == null ? '' : v).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; };
const TOL = 0.01;
const CAMPOS = ['ESTQ_ABERT', 'VOL_ENTR', 'VOL_DISP', 'VOL_SAIDAS', 'ESTQ_ESCR', 'VAL_AJ_PERDA', 'VAL_AJ_GANHO', 'FECH_FISICO'];

module.exports = {
    id: 'COMB-1300-SUM',
    bloco: '1',
    registro: '1300',
    titulo: 'Total do produto (1300) ≠ soma dos tanques (1310)',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No LMC/ERP, os valores do produto (registro 1300) devem ser exatamente a soma dos seus tanques (1310) no mesmo dia. Recalcule os totais do 1300 a partir dos 1310 — em geral falta um tanque ou há um valor digitado no produto que não bate com a soma.',
    detectar(model) {
        const erros = [];
        let cur = null;   // { n, cod, dt, v:[8] } do 1300 corrente
        let sum = null;   // { cnt, v:[8] } da soma dos 1310 filhos

        const flush = () => {
            if (!cur || !sum || sum.cnt === 0) return; // sem 1300 ou sem tanques: não reconcilia
            const diverg = [];
            for (let k = 0; k < 8; k++) {
                const d = cur.v[k] - sum.v[k];
                if (Math.abs(d) > TOL) diverg.push({ campo: CAMPOS[k], a: cur.v[k], s: sum.v[k], d });
            }
            if (diverg.length) {
                const det = diverg.map(x => `${x.campo} (1300=${x.a} vs Σtanques=${x.s.toFixed(3)}, Δ=${x.d.toFixed(3)})`).join('; ');
                erros.push({
                    bloco: '1', registro: '1300', linha: cur.n, campo: diverg[0].campo, severidade: 'BLOQ',
                    valorAtual: String(diverg[0].a), valorSugerido: diverg[0].s.toFixed(3),
                    detalhe: `Produto ${cur.cod}, dia ${cur.dt}: ${det}.`,
                });
            }
        };

        for (const l of model.linhas) {
            if (l.reg === '1300') {
                flush();
                if (l.f.length <= 11) { cur = null; sum = null; continue; }
                cur = { n: l.n, cod: String(l.f[2] || '').trim(), dt: l.f[3], v: [num(l.f[4]), num(l.f[5]), num(l.f[6]), num(l.f[7]), num(l.f[8]), num(l.f[9]), num(l.f[10]), num(l.f[11])] };
                sum = { cnt: 0, v: [0, 0, 0, 0, 0, 0, 0, 0] };
            } else if (l.reg === '1310' && cur) {
                if (l.f.length <= 10) continue;
                sum.cnt++;
                for (let k = 0; k < 8; k++) sum.v[k] += num(l.f[3 + k]);
            } else if (l.reg === '1320') {
                // pertence ao 1310 corrente — ignora
            } else {
                flush(); cur = null; sum = null; // saiu da sequência diária do LMC
            }
        }
        flush();
        return erros;
    },
};
