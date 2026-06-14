// Registry de regras do Validador. Adicionar um erro = adicionar um arquivo aqui.
// Cada regra: { id, bloco, registro, titulo, severidade('BLOQ'|'ADV'),
//   classeCorrecao('estrutural-seguro'|'fiscal-deterministico'|'manual'),
//   jaCorrigidoNoExport(bool), detectar(model)->[{linha,campo,valorAtual,detalhe,...}], instrucaoERP }
module.exports = [
    require('./r_contadores'),     // EST-9XXX: X990 / 9900 / 9999
    require('./r_0220_campos'),    // CAD-0220-01: nº de campos do 0220
    require('./r_chave_nfe'),      // DOC-C100-02 / D100-01: chave 44 díg. + DV
    require('./r_dup_documento'),  // DOC-DUP: C100/D100 duplicado por chave
    require('./r_hierarquia'),     // EST-HIER-01: registro filho órfão
];
