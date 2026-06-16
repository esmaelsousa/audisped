// DOC-MONOF-BC-01 — CST monofásico de combustível (final 02/15/53/61) em ENTRADA não tem base de
// ICMS regular nem de ST (Conv. ICMS 199/2022). PVA: "Se IND_OPER do C100 = 0 e CST_ICMS terminar em
// 02/15/53/61, VL_BC_ICMS e VL_BC_ICMS_ST devem ser 0; para CST 61 a ALIQ_ICMS deve ser 0."
// O ERP costuma preencher base/alíquota como se fosse tributada → ADVERTÊNCIA do PVA. O export zera
// (zerarBaseMonofasicoEntrada) → jaCorrigidoNoExport. VL_ICMS/VL_ICMS_ST são PRESERVADOS (o PVA não os
// zera; o VL_ICMS_ST alimenta o crédito do E210). C170: f10=CST f11=CFOP f13=VL_BC_ICMS f14=ALIQ_ICMS
// f16=VL_BC_ICMS_ST. C190: f2=CST f3=CFOP f6=VL_BC_ICMS f8=VL_BC_ICMS_ST. Caso: RAQUEL 09/2025 (ETANOL 061).
const num = (v) => parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0;
const FINAIS = new Set(['02', '15', '53', '61']);
const ehMonof = (cst) => { const s = String(cst || '').trim(); return s.length === 3 && FINAIS.has(s.slice(-2)); };
const ehEntrada = (cfop) => '123'.includes(String(cfop || '').trim().charAt(0));

module.exports = {
    id: 'DOC-MONOF-BC-01',
    bloco: 'C',
    registro: 'C170',
    titulo: 'CST monofásico (02/15/53/61) em entrada com base de ICMS/ST preenchida',
    severidade: 'ADV',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: true,
    instrucaoERP: 'No ERP, combustível monofásico (CST 02/15/53/61) em entrada não tem base de ICMS regular nem de ST: deixe VL_BC_ICMS e VL_BC_ICMS_ST zerados (e a alíquota de ICMS zerada para o CST 61). A tributação monofásica usa quantidade × alíquota ad rem, não base × alíquota.',
    detectar(model) {
        const erros = [];
        for (const l of model.linhas) {
            if (l.reg !== 'C170' && l.reg !== 'C190') continue;
            const f = l.f;
            const cst = l.reg === 'C170' ? f[10] : f[2];
            const cfop = l.reg === 'C170' ? f[11] : f[3];
            if (!ehMonof(cst) || !ehEntrada(cfop)) continue;
            const final61 = String(cst).trim().slice(-2) === '61';
            const alvos = l.reg === 'C170'
                ? [[13, 'VL_BC_ICMS', false], [14, 'ALIQ_ICMS', true], [16, 'VL_BC_ICMS_ST', false]]
                : [[6, 'VL_BC_ICMS', false], [8, 'VL_BC_ICMS_ST', false]];
            for (const [idx, nome, so61] of alvos) {
                if (so61 && !final61) continue;
                if (f.length > idx && num(f[idx]) !== 0) {
                    erros.push({ bloco: 'C', registro: l.reg, linha: l.n, campo: nome, campoIdx: idx, severidade: 'ADV', valorAtual: f[idx], valorSugerido: '0,00', detalhe: `${nome} (${f[idx]}) deve ser 0 — CST monofásico ${String(cst).trim()} em entrada (CFOP ${String(cfop).trim()}) não tem base de ICMS/ST.` });
                }
            }
        }
        return erros;
    },
};
