// APUR-E210-SALDO-01 — Apuração ICMS-ST (E210): o saldo deve refletir créditos × débitos ST.
// PVA: "Saldo credor de ICMS ST apurado incorretamente." Layout E210 (1-idx): f2 IND_MOV_ST,
// f3 VL_SLD_CRED_ANT_ST, f4 VL_DEVOL_ST, f5 VL_RESSARC_ST, f6 VL_OUT_CRED_ST, f7 VL_AJ_CREDITOS_ST,
// f8 VL_RETENCAO_ST, f9 VL_OUT_DEB_ST, f10 VL_AJ_DEBITOS_ST, f11 VL_SLD_DEV_ANT_ST, f12 VL_DEDUCOES_ST,
// f13 VL_ICMS_RECOL_ST, f14 VL_SLD_CRED_ST_TRANSPORTAR, f15 DEB_ESP_ST.
//   créditos = f3+f4+f5+f6+f7 ; débitos = f8+f9+f10+f11
//   f13 = max(0, débitos − créditos − f12) ; f14 = max(0, créditos − débitos)
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
    instrucaoERP: 'No ERP, o saldo do E210 deve refletir a apuração ST: VL_ICMS_RECOL_ST = max(0, débitos − créditos − deduções) e VL_SLD_CRED_ST_TRANSPORTAR = max(0, créditos − débitos), onde créditos = f3..f7 e débitos = f8..f11.',
    detectar(model) {
        const erros = [];
        for (const l of model.linhas) {
            if (l.reg !== 'E210') continue;
            const f = l.f;
            if (f.length <= 14) continue; // E210 truncado/atípico
            const cred = c(f[3]) + c(f[4]) + c(f[5]) + c(f[6]) + c(f[7]);
            const deb = c(f[8]) + c(f[9]) + c(f[10]) + c(f[11]);
            const espRecol = Math.max(0, deb - cred - c(f[12]));
            const espTransp = Math.max(0, cred - deb);
            if (c(f[13]) !== espRecol) {
                // ⚠️ FALSO POSITIVO conhecido: alguns ERPs espelham a VL_RETENCAO_ST (f8) dentro do
                // VL_SLD_DEV_ANT_ST (f11) → a retenção entra 2× nos débitos e a regra sugeriria DOBRAR o
                // ICMS-ST a recolher. Se, removido o f11, o f13 declarado já fecha, o total está CORRETO e o
                // campo espúrio é o f11 — apontar o f11 (ADV), NUNCA sugerir aumentar o imposto.
                const dupF11 = c(f[8]) > 0 && c(f[8]) === c(f[11]);
                const espRecolSemF11 = Math.max(0, (c(f[8]) + c(f[9]) + c(f[10])) - cred - c(f[12]));
                if (dupF11 && c(f[13]) === espRecolSemF11) {
                    // AMBÍGUO: f11 == f8 tanto pode ser o ERP espelhando a retenção (duplicidade → f13 já certo)
                    // quanto um saldo devedor anterior REAL igual à retenção (→ f13 subdeclarado). Sem decidir
                    // por conta própria: ADV apresentando os dois cenários (não suprimir uma possível subdeclaração).
                    erros.push({ bloco: 'E', registro: 'E210', linha: l.n, campo: 'VL_SLD_DEV_ANT_ST', severidade: 'ADV', valorAtual: fmt(c(f[11])), detalhe: `VL_SLD_DEV_ANT_ST (${fmt(c(f[11]))}) é IGUAL à VL_RETENCAO_ST (${fmt(c(f[8]))}). Confira qual é o caso: (1) o ERP espelhou a retenção no f11 (duplicidade) → o VL_ICMS_RECOL_ST (${fmt(c(f[13]))}) já está correto, zere o f11; (2) o f11 é um saldo devedor anterior REAL → então o VL_ICMS_RECOL_ST deveria ser ${fmt(espRecol)} (recolher a mais ${fmt(espRecol - c(f[13]))}).` });
                } else {
                    erros.push({ bloco: 'E', registro: 'E210', linha: l.n, campo: 'VL_ICMS_RECOL_ST', campoIdx: 13, severidade: 'BLOQ', valorAtual: fmt(c(f[13])), valorSugerido: fmt(espRecol), detalhe: `VL_ICMS_RECOL_ST (${fmt(c(f[13]))}) ≠ esperado ${fmt(espRecol)} = max(0, débitos ${fmt(deb)} − créditos ${fmt(cred)} − deduções ${f[12]}).` });
                }
            }
            if (c(f[14]) !== espTransp) {
                erros.push({ bloco: 'E', registro: 'E210', linha: l.n, campo: 'VL_SLD_CRED_ST_TRANSPORTAR', campoIdx: 14, severidade: 'BLOQ', valorAtual: fmt(c(f[14])), valorSugerido: fmt(espTransp), detalhe: `VL_SLD_CRED_ST_TRANSPORTAR (${fmt(c(f[14]))}) ≠ esperado ${fmt(espTransp)} = max(0, créditos ${fmt(cred)} − débitos ${fmt(deb)}).` });
            }
        }
        return erros;
    },
};
