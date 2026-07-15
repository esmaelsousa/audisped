// DOC-C100-SEQ-01 (catálogo de referência 4028) — Intervalo na sequência numérica de notas fiscais próprias.
// ALERTA (ADV): o painel de auditoria considera a combinação (NUM_DOC + COD_MOD + SÉRIE) das notas de EMISSÃO
// PRÓPRIA (IND_EMIT=0) com SÉRIE preenchida; ordena por número e aponta cada salto na sequência.
// Não bloqueia: pode ser bloco diferente, nota inutilizada/denegada ou lançamento faltando.
//
// Campos C100: f[3]=IND_EMIT, f[5]=COD_MOD, f[7]=SER, f[8]=NUM_DOC. Notas de terceiros (IND_EMIT=1)
// e notas sem série NÃO entram na análise (regra do próprio painel de auditoria). Canceladas/denegadas ocupam
// número (não são lacuna) → contam como presentes.
// Verificado no par casado arq 2028 (S CRUZ 09069475000109 01/2026): painel de auditoria 4028 = 17 ocorrências.
module.exports = {
    id: 'DOC-C100-SEQ-01',
    bloco: 'C',
    registro: 'C100',
    titulo: 'Intervalo na sequência numérica de notas fiscais próprias',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    refCatalogo: '4028',
    instrucaoERP: 'No ERP, verifique se todas as notas fiscais próprias da série foram lançadas. Intervalos podem ser: notas de outro bloco, numeração inutilizada/denegada, ou notas realmente não escrituradas. Confirme que IND_EMIT=0 (própria) e a SÉRIE estão corretos; se o intervalo for legítimo, desconsidere.',
    detectar(model) {
        // (COD_MOD|SER) -> Map(NUM_DOC -> linha)
        const grupos = new Map();
        for (const l of (model.porReg.get('C100') || [])) {
            if (String(l.f[3] || '').trim() !== '0') continue;   // só emissão própria
            const ser = String(l.f[7] || '').trim();
            if (!ser) continue;                                   // sem série: fora da análise
            const num = parseInt(String(l.f[8] || '').trim(), 10);
            if (!Number.isFinite(num)) continue;
            const key = `${String(l.f[5] || '').trim()}|${ser}`;
            if (!grupos.has(key)) grupos.set(key, new Map());
            const m = grupos.get(key);
            if (!m.has(num)) m.set(num, l.n);
        }
        const erros = [];
        for (const [key, m] of grupos) {
            const [mod, ser] = key.split('|');
            const nums = [...m.keys()].sort((a, b) => a - b);
            for (let i = 1; i < nums.length; i++) {
                const de = nums[i - 1], ate = nums[i];
                if (ate - de > 1) {
                    erros.push({
                        bloco: 'C', registro: 'C100', linha: m.get(ate), campo: 'NUM_DOC', severidade: 'ADV',
                        valorAtual: `${de} → ${ate}`,
                        detalhe: `Intervalo na numeração (modelo ${mod}, série ${ser}): do documento ${de} até ${ate} falta(m) ${ate - de - 1} nota(s). Se todas foram lançadas, ou são de outro bloco/inutilizadas/denegadas, desconsidere.`,
                    });
                }
            }
        }
        return erros;
    },
};
