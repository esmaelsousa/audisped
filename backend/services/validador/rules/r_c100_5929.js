// DOC-C100-5929-01 (catálogo de referência 1003) — CFOP 5929/6929 (nota espelho de operação já tributada em
// ECF/cupom) NÃO deve ter valor da operação, alíquota, base ou ICMS no C190.
//
// SÓ-DETECÇÃO (decisão do cliente + painel §3 — REVISAO-CROSS-EMPRESA-2026-07-08.md): a correção (zerar)
// conflita com o importador5929Service (que preenche 5929 zeradas) e, no POSTO CG, as 31 ocorrências são
// CST 061 com VL_OPR legítimo (monofásico) — zerar destruiria VL_OPR e criaria o bloqueante
// C100.VL_DOC ≠ Σ C190.VL_OPR. Nunca auto-corrigir (sem campoIdx). O painel distingue sinal FORTE
// (VL_ICMS ou ALIQ ≠ 0 → possível bitributação) do FRACO (VL_OPR sozinho → valor informativo legítimo);
// a severidade reflete isso.
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C100-5929-01',
    refCatalogo: '1003',
    bloco: 'C',
    registro: 'C190',
    titulo: 'CFOP 5929/6929 com valor/alíquota/base/ICMS diferentes de zero',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'CFOP 5929/6929 acoberta operação já tributada (ECF/cupom): valor da operação, alíquota, base e ICMS devem ser 0 (exceto MG/RN/SC). Atenção: pode conflitar com a injeção de valores 5929 (monofásico).',
    // Conta por DOCUMENTO (C100), não por linha C190: uma NF com split CST 060/061 tem 2 C190 5929 e
    // era contada 2×; o painel de auditoria conta 1× por documento. Agregação: 1 achado por C100 com ≥1 C190
    // qualificado; se qualquer linha for FORTE (ICMS/alíq≠0), o documento é FORTE. Reproduz 57=57 (arq 2028).
    detectar(model) {
        const erros = [];
        // Exceção fiscal: em MG/RN/SC o CFOP 5929/6929 carrega valor/alíquota/ICMS legitimamente →
        // o sinal FORTE (bitributação) vira ADV nesses estados, não BLOQ.
        const ufExcecao = ['MG', 'RN', 'SC'].includes(String(model.uf || '').toUpperCase());
        let cur = null; // { linha, num, forte:{cfop,icms,aliq}|null, fraco:{cfop,vlopr}|null }
        const flush = () => {
            if (!cur) return;
            const e = cur.forte, w = cur.fraco;
            if (e) erros.push({ linha: cur.linha, campo: 'CFOP 5929/6929', valorAtual: `${e.cfop} ICMS ${e.icms}`, severidade: ufExcecao ? 'ADV' : 'BLOQ', detalhe: `NF nº ${cur.num}: CFOP ${e.cfop} com ICMS ${e.icms} / alíq ${e.aliq}${ufExcecao ? ` — em ${String(model.uf).toUpperCase()} o 5929/6929 pode carregar ICMS legitimamente; confira.` : ' — indício de bitributação (deveriam ser 0).'}` });
            else if (w) erros.push({ linha: cur.linha, campo: 'CFOP 5929/6929', valorAtual: `${w.cfop} VL_OPR ${w.vlopr}`, severidade: 'ADV', detalhe: `NF nº ${cur.num}: CFOP ${w.cfop} com VL_OPR ${w.vlopr} (ICMS/alíq zerados) — provável monofásico/injeção 5929 legítimo; verificar.` });
        };
        for (const l of model.linhas) {
            if (l.reg === 'C100') { flush(); cur = { linha: l.n, num: String(l.f[8] || '').trim(), forte: null, fraco: null }; continue; }
            if (l.reg !== 'C190' || !cur) continue;
            const f = l.f;
            const cfop = String(f[3] || '').trim();
            if (cfop !== '5929' && cfop !== '6929') continue;
            const aliq = parseFloat(String(f[4] || '0').replace(',', '.')) || 0;
            const isForte = aliq !== 0 || toCents(f[7]) !== 0;              // ICMS/ALIQ ≠ 0 → possível bitributação
            if (!(isForte || toCents(f[5]) !== 0 || toCents(f[6]) !== 0)) continue;
            if (isForte) { if (!cur.forte) cur.forte = { cfop, icms: f[7], aliq: f[4] }; }
            else if (!cur.fraco) cur.fraco = { cfop, vlopr: f[5] };
        }
        flush();
        return erros;
    },
};
