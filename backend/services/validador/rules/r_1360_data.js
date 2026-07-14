// INV-1360-DATA-01 — DAT_APLICACAO (campo 3 do 1360 — Lacres da bomba) deve ser uma data válida
// ≥ 01/01/2000. PVA: "A data deverá ser maior ou igual a 01/01/2000." Caso de exemplo 05/2026:
// |1360|I7651130-7|03120205| → ano "0205" (provável erro de digitação de 03/12/2005 ou similar).
// EDITÁVEL: o usuário informa a data correta (DDMMAAAA) em "Corrigir no sistema". corrigível
// campoIdx=3, chaveNatural=NUM_LACRE (f[2]). Não auto-corrige (não dá p/ adivinhar a data certa).
// Posições 1360: f2 NUM_LACRE, f3 DT_APLICACAO (DDMMAAAA).
const ymd = (d) => { const s = String(d || '').trim(); return s.length === 8 ? s.slice(4, 8) + s.slice(2, 4) + s.slice(0, 2) : ''; };
const fmt = (d) => (d && d.length === 8) ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}` : (d || '');

module.exports = {
    id: 'INV-1360-DATA-01',
    bloco: '1',
    registro: '1360',
    titulo: 'Data de aplicação do lacre (1360) inválida (deve ser ≥ 01/01/2000)',
    severidade: 'BLOQ',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP/LMC, a data de aplicação do lacre (DAT_APLICACAO do 1360) deve ser uma data real no formato DDMMAAAA, com ano ≥ 2000. Corrija a data do lacre.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('1360') || [])) {
            const dt = String(l.f[3] || '').trim();
            const y = ymd(dt);
            // valida faixa real de mês/dia (não só length + ano) — datas impossíveis (30/02, 32/01) não passam
            let dataReal = false;
            if (dt.length === 8) {
                const dd = +dt.slice(0, 2), mm = +dt.slice(2, 4), yy = +dt.slice(4, 8);
                const dObj = new Date(yy, mm - 1, dd);
                dataReal = mm >= 1 && mm <= 12 && dd >= 1 && dObj.getMonth() === mm - 1 && dObj.getDate() === dd;
            }
            const invalida = dt.length !== 8 || !y || y < '20000101' || !dataReal;
            if (invalida) {
                erros.push({
                    bloco: '1', registro: '1360', linha: l.n, campo: 'DT_APLICACAO', campoIdx: 3,
                    severidade: 'BLOQ', valorAtual: dt || '(vazio)',
                    detalhe: `DAT_APLICACAO ${dt.length === 8 ? fmt(dt) : `"${dt}"`} inválida — deve ser uma data real (DDMMAAAA) com ano ≥ 2000.`,
                });
            }
        }
        return erros;
    },
};
