// COMB-1310-ANP-01 (catálogo de referência 2033) — Variação entre estoque FÍSICO (fechamento) e ESCRITURAL
// de cada tanque (1310) acima do limite ANP de 0,6% (art. 5º da Portaria DNC nº 26, de 13.11.1992).
// É ALERTA (ADV): não é rejeição do PVA — o painel de auditoria o trata como "indício para início de possível
// ação fiscal" (perda/ganho de produto além da volatilidade tolerada, ou físico não medido).
//
// Fórmula do painel de auditoria (reproduzida byte-a-byte): percentual = |ESTQ_ESCR − FECH_FISICO| / ESTQ_ESCR.
// Dispara quando percentual > 0,6%. Campos do 1310 (mesmo mapeamento de r_reconciliacao_1300_1310):
//   f[2]=NUM_TANQUE  f[7]=ESTQ_ESCR (campo 7)  f[10]=FECH_FISICO (campo 10).
// Ref. hierárquica exibida pelo painel de auditoria: COD_ITEM + DT do 1300 pai imediato.
//
// Verificado no par casado arq 2028 (S CRUZ / AUTO POSTO DA CHAPADA 09069475000109, 01/2026):
// painel de auditoria 2033 = 146 ocorrências (109 com físico=0 → 100%; o restante variação real de 0,7%–403%).
// ⚠️ Cross-empresa: ERPs que não medem o físico deixam FECH_FISICO=0 → 100% em todos os tanques;
// é o próprio indício que o painel de auditoria aponta. Como é ADV, nunca bloqueia — só orienta.
const num = (v) => { let s = String(v == null ? '' : v).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; };

module.exports = {
    id: 'COMB-1310-ANP-01',
    bloco: '1',
    registro: '1310',
    titulo: 'Variação físico × escritural do tanque (1310) acima de 0,6% (padrão ANP)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    refCatalogo: '2033',
    instrucaoERP: 'No LMC/ERP, a diferença entre o estoque físico (fechamento) e o escritural de cada tanque não pode passar de 0,6% (ANP — art. 5º da Portaria DNC 26/1992). Se o físico está zerado, registre a medição real do tanque; se há perda/ganho acima de 0,6%, apure a causa (aferição, evaporação, vazamento). É indício de ação fiscal, não erro de estrutura.',
    detectar(model) {
        const erros = [];
        let paiCod = '?', paiDt = '?';
        for (const l of model.linhas) {
            if (l.reg === '1300') { paiCod = String(l.f[2] || '').trim() || '?'; paiDt = String(l.f[3] || '').trim() || '?'; continue; }
            if (l.reg !== '1310') continue;
            if (l.f.length <= 10) continue; // 1310 sem o campo FECH_FISICO (f10) — não calcula
            const escr = num(l.f[7]);
            const fisico = num(l.f[10]);
            if (Math.abs(escr) < 0.001) continue; // sem base escritural: percentual indefinido
            const perc = Math.abs(escr - fisico) / Math.abs(escr);
            // O painel de auditoria arredonda o percentual para 1 casa decimal (a precisão do "0,6%" da norma
            // ANP) e só aponta se > 0,6%. Assim 0,637% arredonda p/ 0,6% (tolerado) e 0,783% p/ 0,8%
            // (apontado) — reproduzido byte-a-byte contra o arq 2028 (146 ocorrências). Inferido de um
            // caso-fronteira; se um arquivo futuro contrariar, revisar aqui.
            const pctArred = Math.round(perc * 1000) / 10; // perc→% com 1 casa
            if (pctArred > 0.6) {
                const tq = String(l.f[2] || '').trim();
                // Categoria distinta: físico=0 é AUSÊNCIA DE MEDIÇÃO (75% dos casos do par casado), não uma
                // variação volumétrica real — o painel de auditoria mistura as duas sob o mesmo código; nós rotulamos.
                const semFisico = Math.abs(fisico) < 0.001;
                erros.push({
                    bloco: '1', registro: '1310', linha: l.n, campo: 'ESTQ_ESCR/FECH_FISICO', severidade: 'ADV',
                    valorAtual: `${escr.toFixed(3)} / ${fisico.toFixed(3)}`,
                    detalhe: semFisico
                        ? `Tanque ${tq} (produto ${paiCod}, dia ${paiDt}): estoque FÍSICO não informado (medição ausente) — escritural ${escr.toFixed(3)} L, físico 0,000. Registre a medição real do tanque no LMC; sem o físico não há como aferir a variação ANP.`
                        : `Tanque ${tq} (produto ${paiCod}, dia ${paiDt}): diferença físico × escritural de ${(perc * 100).toFixed(3).replace('.', ',')}% (escritural ${escr.toFixed(3)}, físico ${fisico.toFixed(3)}) acima do limite ANP de 0,6%.`,
                });
            }
        }
        return erros;
    },
};
