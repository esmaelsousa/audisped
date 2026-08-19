// APUR-E210-SALDO-01 — Apuração ICMS-ST (E210): o saldo deve refletir créditos × débitos ST.
// PVA: "Saldo credor de ICMS ST apurado incorretamente." Layout E210 (1-idx): f2 IND_MOV_ST,
// f3 VL_SLD_CRED_ANT_ST, f4 VL_DEVOL_ST, f5 VL_RESSARC_ST, f6 VL_OUT_CRED_ST, f7 VL_AJ_CREDITOS_ST,
// f8 VL_RETENCAO_ST, f9 VL_OUT_DEB_ST, f10 VL_AJ_DEBITOS_ST, f11 VL_SLD_DEV_ANT_ST, f12 VL_DEDUCOES_ST,
// f13 VL_ICMS_RECOL_ST, f14 VL_SLD_CRED_ST_TRANSPORTAR, f15 DEB_ESP_ST.
//   créditos = f3+f4+f5+f6+f7 ; débitos = f8+f9+f10
//   f11 = max(0, débitos − créditos)  ← SUBTOTAL derivado ("saldo devedor ANTES das deduções")
//   f13 = max(0, f11 − f12) ; f14 = max(0, créditos − débitos)
// O f11 NÃO entra na soma de débitos: ele É o subtotal. Somá-lo contava o ST 2× e a regra chegava
// a sugerir DOBRAR o imposto a recolher. Medido em 69 linhas E210 de 68 SPEDs reais: f11 é 0 ou
// igual ao subtotal em 100% dos casos, independente em NENHUM (backend/tests/e210-corpus.test.js).
// Mesma aritmética do export — services/export/e210Apuracao.js.
// jaCorrigidoNoExport (o streaming do export recompõe f13/f14). Caso: RAQUEL 09/2025 (crédito ST 352,00
// de entrada monofásica sem débito → f14 deve ser 352,00, vinha 0,00).
const c = (v) => Math.round((parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0) * 100);
const fmt = (ct) => (ct / 100).toFixed(2).replace('.', ',');

module.exports = {
    id: 'APUR-E210-SALDO-01',
    bloco: 'E',
    registro: 'E210',
    titulo: 'Apuração ICMS-ST (E210): saldo (a recolher / credor a transportar) incoerente com créditos × débitos',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, o saldo do E210 deve refletir a apuração ST: VL_SLD_DEV_ANT_ST = max(0, débitos − créditos), VL_ICMS_RECOL_ST = max(0, VL_SLD_DEV_ANT_ST − deduções) e VL_SLD_CRED_ST_TRANSPORTAR = max(0, créditos − débitos), onde créditos = f3..f7 e débitos = f8+f9+f10 (o f11 é subtotal derivado e NÃO entra na soma dos débitos).',
    detectar(model) {
        const erros = [];
        for (const l of model.linhas) {
            if (l.reg !== 'E210') continue;
            const f = l.f;
            if (f.length <= 14) continue; // E210 truncado/atípico
            const cred = c(f[3]) + c(f[4]) + c(f[5]) + c(f[6]) + c(f[7]);
            const deb = c(f[8]) + c(f[9]) + c(f[10]);
            const espSldDev = Math.max(0, deb - cred);          // f11: saldo devedor ANTES das deduções
            const espRecol = Math.max(0, espSldDev - c(f[12])); // f13: já deduzido
            const espTransp = Math.max(0, cred - deb);
            // f11 divergente do subtotal é ADV, não BLOQ: é campo derivado e o ERP frequentemente o
            // deixa zerado. O que importa fiscalmente (f13/f14) é apontado abaixo.
            if (c(f[11]) !== espSldDev) {
                erros.push({ bloco: 'E', registro: 'E210', linha: l.n, campo: 'VL_SLD_DEV_ANT_ST', campoIdx: 11, severidade: 'ADV', valorAtual: fmt(c(f[11])), valorSugerido: fmt(espSldDev), detalhe: `VL_SLD_DEV_ANT_ST (${fmt(c(f[11]))}) ≠ ${fmt(espSldDev)} = max(0, débitos ${fmt(deb)} − créditos ${fmt(cred)}). É campo DERIVADO (subtotal antes das deduções), não um débito próprio — não deve ser somado aos débitos.` });
            }
            if (c(f[13]) !== espRecol) {
                erros.push({ bloco: 'E', registro: 'E210', linha: l.n, campo: 'VL_ICMS_RECOL_ST', campoIdx: 13, severidade: 'BLOQ', valorAtual: fmt(c(f[13])), valorSugerido: fmt(espRecol), detalhe: `VL_ICMS_RECOL_ST (${fmt(c(f[13]))}) ≠ esperado ${fmt(espRecol)} = max(0, saldo devedor ${fmt(espSldDev)} − deduções ${f[12]}), com débitos ${fmt(deb)} = f8+f9+f10 e créditos ${fmt(cred)}.` });
            }
            if (c(f[14]) !== espTransp) {
                erros.push({ bloco: 'E', registro: 'E210', linha: l.n, campo: 'VL_SLD_CRED_ST_TRANSPORTAR', campoIdx: 14, severidade: 'BLOQ', valorAtual: fmt(c(f[14])), valorSugerido: fmt(espTransp), detalhe: `VL_SLD_CRED_ST_TRANSPORTAR (${fmt(c(f[14]))}) ≠ esperado ${fmt(espTransp)} = max(0, créditos ${fmt(cred)} − débitos ${fmt(deb)}).` });
            }
        }
        return erros;
    },
};
