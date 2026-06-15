// EST-NCAMPOS-01 — GERA, a partir do catálogo de leiaute (catalogo/leiaute.json), a checagem de
// "nº de campos do registro confere com o leiaute" para TODOS os registros de posto, version-aware.
// PVA: "O número de campos informado no registro difere do número de campos especificado no leiaute."
// É o único check que sai com segurança SÓ do conjunto-de-campos (count, não posição → imune ao
// caveat de ordem C170/E210). Validado na frota: 49/50 registros com 0 divergência; só o 0220 diverge
// (erros reais de leiaute 015), e o 0220 tem regra dedicada (CAD-0220-01) com auto-correção → excluído aqui.
// nCampos = campos de DADOS (sem REG); no .txt, split('|').length = nCampos + 3 (pipe inicial, REG, dados, pipe final).
// Deltas por versão no catálogo (ex.: 1310 → 10 campos no leiaute 020 por causa do CAP_TANQUE).
const CAT = require('../catalogo/leiaute.json').registros;
const DEDICADOS = new Set(['0220']); // já coberto por regra própria (sugestão/auto-correção)
function expectedN(reg, ver) {
    const e = CAT[reg];
    if (!e) return null;
    let n = e.nCampos;
    if (e.nCamposPorVersao && e.nCamposPorVersao[ver] != null) n = e.nCamposPorVersao[ver];
    return n;
}

module.exports = {
    id: 'EST-NCAMPOS-01',
    bloco: '*',
    registro: '(catálogo)',
    titulo: 'Número de campos do registro diferente do leiaute',
    severidade: 'BLOQ',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o registro deve ter exatamente o número de campos do leiaute da versão (verifique pipes "|" a mais ou a menos).',
    detectar(model) {
        const erros = [];
        const ver = String(model.versao || '');
        for (const l of model.linhas) {
            const reg = l.reg;
            if (!CAT[reg] || DEDICADOS.has(reg)) continue;
            const n = expectedN(reg, ver);
            if (n == null) continue;
            const real = l.f.length - 3; // nº de campos de dados no .txt
            if (real !== n) {
                erros.push({
                    bloco: reg[0], registro: reg, linha: l.n, campo: '(estrutura)',
                    severidade: 'BLOQ', valorAtual: String(real), valorSugerido: String(n),
                    detalhe: `Registro ${reg}: tem ${real} campo(s), o leiaute ${ver || '?'} exige ${n}.`,
                });
            }
        }
        return erros;
    },
};
