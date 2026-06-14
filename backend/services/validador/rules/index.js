// Registry de regras do Validador. Adicionar um erro = adicionar um arquivo aqui.
// Cada regra: { id, bloco, registro, titulo, severidade('BLOQ'|'ADV'),
//   classeCorrecao('estrutural-seguro'|'fiscal-deterministico'|'manual'),
//   jaCorrigidoNoExport(bool), detectar(model)->[{linha,campo,valorAtual,detalhe,...}], instrucaoERP }
module.exports = [
    // Estruturais (Sprint 1)
    require('./r_contadores'),         // EST-9XXX: X990 / 9900 / 9999
    require('./r_0220_campos'),        // CAD-0220-01: nº de campos do 0220
    require('./r_chave_nfe'),          // DOC-CHV-DV: chave 44 díg. + DV
    require('./r_dup_documento'),      // DOC-DUP: C100/D100 duplicado por chave
    require('./r_hierarquia'),         // EST-HIER-01: registro filho órfão
    // Fiscais/cadastrais (Sprint 4)
    require('./r_cst61_competencia'),  // COMB-CST-01: CST 61 antes da vigência monofásica
    require('./r_item_0200'),          // DOC-C170-01: COD_ITEM sem 0200
    require('./r_participante_0150'),  // CAD-0150-07: COD_PART sem 0150
    require('./r_ncm_0200'),           // CAD-0200-03: mercadoria sem NCM válido
    require('./r_c190_x_c170'),        // DOC-C190-01: combinação CST/CFOP/ALIQ do C190 sem C170
    require('./r_bloco1_lmc'),         // COMB-LMC: 1300/1310/1320 — negativo, coerência, vendas, CAP
    require('./r_continuidade_lmc'),   // COMB-LMC-CONT: fechamento físico ≠ abertura do dia seguinte
    require('./r_reconciliacao_1300_1310'), // COMB-1300-SUM: total do produto ≠ soma dos tanques
    require('./r_h005_data'),          // INV-H005-01: DT_INV do inventário > data final do período
];
