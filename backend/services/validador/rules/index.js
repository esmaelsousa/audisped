// Registry de regras do Validador. Adicionar um erro = adicionar um arquivo aqui.
// Cada regra: { id, bloco, registro, titulo, severidade('BLOQ'|'ADV'),
//   classeCorrecao('estrutural-seguro'|'fiscal-deterministico'|'manual'),
//   jaCorrigidoNoExport(bool), detectar(model)->[{linha,campo,valorAtual,detalhe,...}], instrucaoERP }
module.exports = [
    // Estruturais (Sprint 1)
    require('./r_contadores'),         // EST-9XXX: X990 / 9900 / 9999
    require('./r_ncampos_catalogo'),   // EST-NCAMPOS-01: nº de campos por registro (gerado do catálogo/leiaute.json)
    require('./r_0220_campos'),        // CAD-0220-01: nº de campos do 0220
    require('./r_chave_nfe'),          // DOC-CHV-DV: chave 44 díg. + DV
    require('./r_dup_documento'),      // DOC-DUP: C100/D100 duplicado por chave
    require('./r_hierarquia'),         // EST-HIER-01: registro filho órfão
    // Fiscais/cadastrais (Sprint 4)
    require('./r_cst61_competencia'),  // COMB-CST-01: CST 61 antes da vigência monofásica
    require('./r_item_0200'),          // DOC-C170-01: COD_ITEM sem 0200
    require('./r_participante_0150'),  // CAD-0150-07: COD_PART (C100/D100) sem 0150
    require('./r_participante_0150_1601'), // CAD-0150-08: COD_PART do 1601 sem 0150
    require('./r_ncm_0200'),           // CAD-0200-03: mercadoria sem NCM válido
    require('./r_c190_x_c170'),        // DOC-C190-01: combinação CST/CFOP/ALIQ do C190 sem C170
    require('./r_cfop_c170_invalido'), // DOC-C170-CFOP-01: CFOP inválido no C170 (ex.: 0061)
    require('./r_bloco1_equipamentos_lmc'), // COMB-1350-1360-01: bomba (1350) sem lacre (1360)
    require('./r_c100_extemporaneo'),  // DOC-C100-DTES-01: C100 com DT_E_S > data final do período
    require('./r_e110_apuracao'),      // INV-E110-01: E110 (totais de ajuste/saldo) ≠ Σ E111
    require('./r_e116_apuracao'),      // INV-E116-01: Σ E116 (a recolher) ≠ ICMS a recolher do E110
    require('./r_cod_barra_0200'),     // DOC-0200-GTIN-01: COD_BARRA do 0200 não numérico (ex.: "SEM GTIN")
    require('./r_cest_0200'),          // DOC-0200-CEST-01: CEST inexistente na tabela CEST / não casa NCM (usa model.dominio)
    require('./r_1360_data'),          // INV-1360-DATA-01: DAT_APLICACAO do lacre (1360) < 01/01/2000
    require('./r_bloco1_lmc'),         // COMB-LMC: 1300/1310/1320 — negativo, coerência, vendas, CAP
    require('./r_continuidade_lmc'),   // COMB-LMC-CONT: fechamento físico ≠ abertura do dia seguinte
    require('./r_reconciliacao_1300_1310'), // COMB-1300-SUM: total do produto ≠ soma dos tanques
    require('./r_variacao_anp_1310'),  // COMB-1310-ANP-01 (E-Aud 2033): variação físico×escritural do tanque > 0,6% ANP (ADV)
    require('./r_h005_data'),          // INV-H005-01: DT_INV do inventário > data final do período
    require('./r_h010_inventario'),    // INV-H010-01: VL_INV do H005 ≠ soma dos VL_ITEM dos H010
    require('./r_c191_fcp'),           // DOC-C191-FCP-01: VL_FCP_RET do C191 sem CST x60/500 no C190 pai
    require('./r_d100_indemit'),       // DOC-D100-EMIT-01: D100 emitido por terceiros (IND_EMIT=1) com IND_OPER de saída
    require('./r_d100_cancelado'),     // DOC-D100-CANC-01: D100 cancelado/denegado com campos além de COD_SIT/IND_OPER/COD_MOD/chave
    require('./r_0200_dup'),           // DOC-0200-DUP-01: COD_ITEM duplicado no 0200
    require('./r_monofasico_bc'),      // DOC-MONOF-BC-01: CST monofásico (02/15/53/61) em entrada com base de ICMS/ST
    require('./r_e210_saldo'),         // APUR-E210-SALDO-01: saldo do E210 (recolher/credor a transportar) incoerente
    require('./r_e116_codrec'),        // DOC-E116-CODREC-01: E116 sem COD_REC (código de receita) — preenchido no export
    require('./r_0100_contador'),      // DOC-0100-CONTADOR-01: 0100 (contabilista) sem CPF/CRC (manual — dado externo)
    // Catálogo E-Auditoria (2026-07-07/08) — detecção reproduz o E-Auditoria; gates de auto-correção
    // no coletor (localhost), ver docs/superpowers/plans/REVISAO-CROSS-EMPRESA-2026-07-08.md.
    require('./r_c100_vl_doc'),        // DOC-C100-VLDOC-01 (E-Aud 2890): VL_DOC ≠ total apurado
    require('./r_c170_icms_sem_base'), // DOC-C170-ICMSSEMBASE-01 (E-Aud 2075): ALIQ>0 sem base
    require('./r_c190_icms_sem_base'), // DOC-C190-ICMSSEMBASE-01 (E-Aud 2951): ALIQ>0 sem base
    require('./r_c190_red_bc'),        // DOC-C190-REDBC-01 (E-Aud 2800): VL_RED_BC × CST
    require('./r_9900_regblc'),        // EST-9900-REGBLC-01 (E-Aud 2037): REG_BLC ausente no 9900
    require('./r_c190_vl_icms'),       // DOC-C190-VLICMS-01 (E-Aud 2481): VL_ICMS(C190) ≠ Σ VL_ICMS(C170)
    require('./r_0400_codnat_cfop'),   // CAD-0400-CFOP-01 (E-Aud 2441): COD_NAT com CFOP (só-detecção)
    require('./r_0206_sem_1300'),      // COMB-0206-1300-01 (E-Aud 2321): produto ANP sem LMC (só-detecção)
    require('./r_c170_cod_cta'),       // DOC-C170-CODCTA-01 (E-Aud 2451): COD_CTA vazio (só-detecção)
    require('./r_c100_5929'),          // DOC-C100-5929-01 (E-Aud 1003): 5929/6929 com valores (só-detecção)
    require('./r_cfop_uf_participante'), // DOC-C190-CFOPUF-01 (E-Aud 2742): CFOP interno 1/5 com participante de outra UF (ADV)
    require('./r_sequencia_nf_c100'),  // DOC-C100-SEQ-01 (E-Aud 4028): intervalo na sequência numérica de NF próprias (ADV)
    require('./r_saidas_1300_1320'),   // COMB-1300-1320-01 (E-Aud 2023): VOL_SAIDAS(1300) ≠ Σ VOL_VENDAS(1320), tolerância anti-arredondamento (ADV)
];
