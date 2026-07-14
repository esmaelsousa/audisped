// DOC-C100-VLDOC-01 (E-Auditoria 2890) — VL_DOC do C100 diverge do total apurado.
// VL_DOC = VL_MERC − VL_DESC − VL_ABAT_NT + VL_FRT + VL_SEG + VL_OUT_DA + VL_ICMS_ST + VL_IPI.
// GATE POR IND_EMIT (revisão fiscal F1): em EMISSÃO PRÓPRIA (f[3]=='0', típico NFC-e mod 65)
// o VL_DOC é o vNF AUTORIZADO na SEFAZ e NÃO é recomputável dos componentes.
//   • própria + divergência ISOLADA em VL_OUT_DA (VL_DOC==VL_MERC e delta==VL_OUT_DA) → sugere zerar VL_OUT_DA (campo 20);
//   • própria com padrão atípico → ADV/manual;
//   • terceiros (f[3]=='1') → sugere recompor VL_DOC (campo 12).
// Ignora cancelados/denegados (COD_SIT 02/03/04/05).
//
// ⚠️ GATE DE AUTO-CORREÇÃO (painel cross-empresa 2026-07-08 §2.1 — ver docs/superpowers/plans/REVISAO-CROSS-EMPRESA-2026-07-08.md):
//   DETECÇÃO roda em toda a base (reproduz o E-Auditoria). A AUTO-CORREÇÃO (quando ligada no localhost)
//   NÃO pode aplicar cegamente — o C100 não tem campo p/ FCP-ST / ICMS desonerado / importação, então a
//   identidade legitimamente não fecha em distribuidoras/ST/desoneração. Guards obrigatórios no coletor:
//     - PRÓPRIA (zerar VL_OUT_DA): só quando VL_DOC == Σ VL_OPR dos C190 da MESMA NF, VL_ICMS_ST==0,
//       sem CST/CSOSN de ST, chave 44 válida (mod 55/65) e tolerância = ±0,01 × nº itens;
//     - TERCEIROS (recompor VL_DOC): NÃO auto quando VL_ICMS_ST≠0 / indício de FCP-ST / desoneração / importação;
//       idealmente só quando VL_DOC recomposto == vNF do XML (documentos_c100). Fora disso → manual.
const { toCents, fromCents } = require('../money');
module.exports = {
    id: 'DOC-C100-VLDOC-01',
    refEAuditoria: '2890',
    bloco: 'C',
    registro: 'C100',
    titulo: 'VL_DOC do C100 diverge do total apurado (merc−desc−abat+frete+seg+desp+ICMS-ST+IPI)',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o valor total do documento (VL_DOC) deve ser Σ mercadorias − desconto − abatimento não tributado + frete + seguro + outras despesas + ICMS-ST + IPI. Em NFC-e de emissão própria o VL_DOC é o valor autorizado na SEFAZ; acerte a origem (ex.: outras despesas acessórias espúrias) e regenere.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C100') || [])) {
            const f = l.f;
            if (f.length < 26) continue;
            if (['02', '03', '04', '05'].includes(String(f[6] || '').trim())) continue; // cancelada/denegada
            const vlMerc = toCents(f[16]), vlOut = toCents(f[20]);
            const calc = vlMerc - toCents(f[14]) - toCents(f[15]) + toCents(f[18]) + toCents(f[19]) + vlOut + toCents(f[24]) + toCents(f[25]);
            const decl = toCents(f[12]);
            if (Math.abs(calc - decl) < 1) continue;
            const propria = String(f[3] || '').trim() === '0';
            const base = { linha: l.n, valorAtual: f[12], detalhe: `VL_DOC declarado ${f[12]} ≠ apurado ${fromCents(calc)} (dif ${fromCents(Math.abs(calc - decl))}) na NF ${f[8] || '?'}.` };
            if (!propria) {
                // ⚠️ FALSO POSITIVO conhecido (validado contra 4 vNF reais da SEFAZ): quando o ERP grava o
                // TOTAL da nota em VL_MERC (que já inclui frete/despesas) e AINDA preenche VL_FRT à parte, o
                // frete é contado 2× e recompor o VL_DOC o INFLA — sendo que o VL_DOC declarado já é o vNF.
                // Nesse padrão o campo errado é o VL_MERC (deveria ser o vProd), não o VL_DOC.
                const adicionais = toCents(f[18]) + toCents(f[19]) + vlOut + toCents(f[24]) + toCents(f[25]);
                if (decl === vlMerc && (calc - decl) === adicionais && adicionais > 0) {
                    // AMBÍGUO sem o XML (registros byte-idênticos): (a) VL_MERC embutiu o total → reduzir VL_MERC;
                    // ou (b) o VL_DOC esqueceu de somar frete/IPI → inflar o VL_DOC. Não decidir sozinho: ADV com
                    // as duas hipóteses cruzadas ao vNF. Nunca fiscal-deterministico, nunca sugerir VL_MERC negativo.
                    const mercCerto = vlMerc - adicionais + toCents(f[14]) + toCents(f[15]);
                    erros.push({ ...base, campo: 'VL_DOC/VL_MERC', severidade: 'ADV', classeCorrecao: 'manual', detalhe: base.detalhe + ` Confira contra o vNF do XML: se o vNF = ${f[12]}, o VL_MERC embutiu o total (ajuste o VL_MERC para ${mercCerto >= 0 ? fromCents(mercCerto) : '(revisar)'}); se o vNF = ${fromCents(calc)}, o VL_DOC esqueceu frete/despesas (ajuste o VL_DOC).` });
                } else {
                    // divergência genuína — sem o XML não dá pra afirmar o VL_DOC certo → ADV/manual (não inflar)
                    erros.push({ ...base, campo: 'VL_DOC', campoIdx: 12, valorSugerido: fromCents(calc), severidade: 'ADV', classeCorrecao: 'manual', detalhe: base.detalhe + ' Terceiros: confira o VL_DOC contra o vNF do XML antes de corrigir (recompor pode inflar um VL_DOC já correto).' });
                }
            } else if (decl === vlMerc && (calc - decl) === vlOut && vlOut !== 0) {
                // Correção é no VL_OUT_DA (campo 20), NÃO no VL_DOC → "Valor atual" tem de mostrar o VL_OUT_DA (f[20]), não o VL_DOC (f[12]).
                erros.push({ ...base, valorAtual: f[20], campo: 'VL_OUT_DA', campoIdx: 20, valorSugerido: '0,00', severidade: 'BLOQ', classeCorrecao: 'fiscal-deterministico', detalhe: base.detalhe + ` Emissão própria: VL_DOC=vNF (${f[12]}) preservado; a despesa acessória VL_OUT_DA (${f[20]}) espúria é que vai a 0,00.` });
            } else {
                erros.push({ ...base, campo: 'VL_DOC', severidade: 'ADV', classeCorrecao: 'manual', detalhe: base.detalhe + ' Emissão própria: VL_DOC é o vNF autorizado na SEFAZ — conferir contra o XML antes de corrigir.' });
            }
        }
        return erros;
    },
};
