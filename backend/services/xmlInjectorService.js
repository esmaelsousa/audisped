const logger = require('../logger');

// Extrai e converte float do XML ou retorna zero seguro
function parseValor(v) {
    if (!v) return 0.0;
    const num = parseFloat(v);
    return isNaN(num) ? 0.0 : num;
}

// Formata para o padrão SPED Fiscal: duas decimais com vírgula
function formatSpedFloat(val, algarismos = 2) {
    if (isNaN(val)) return '0,00';
    return val.toFixed(algarismos).replace('.', ',');
}

// Remove os hífens e formata data DDMMAAAA -> AAAAMMDD ou vice versa
function formatDate(isoDateStr) {
    if (!isoDateStr) return '';
    // Recebe do XML 2021-01-10 -> SPED: 10012021
    const [y, m, d] = isoDateStr.substring(0, 10).split('-');
    return `${d}${m}${y}`;
}

/**
 * Função Core do Motor de Tributação.
 * Traduz JSON da NF-e para Strings de Linha SPED (Blocos 0 e C).
 */
function transformarNotasEmSped(parsedNotes, userCfop, forceCst040) {
    let linhasBloco0 = [];
    let linhasBlocoC = [];

    let totalNotas = 0;
    let totalValorCompras = 0;

    let codItemInterno = 9000; // Caso queiramos anonimizar os códigos dos produtos

    for (const nota of parsedNotes) {
        totalNotas++;
        // --- 0150: PARTICIPANTE / EMITENTE ---
        // |REG|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|END|NUM|COMPL|BAIRRO|
        // Usamos o próprio CNPJ como COD_PART para garantir unicidade
        const cnpjLimpo = (nota.emitente.cnpj || '').replace(/\D/g, '');
        const emitLine = `|0150|${cnpjLimpo}|${nota.emitente.nome || 'FORNECEDOR'}|01058|${cnpjLimpo}||${nota.emitente.ie || ''}|${nota.emitente.cod_mun || ''}||||||`;
        linhasBloco0.push(emitLine);

        // --- C100: CABEÇALHO DA NOTA ---
        const vlTotalDoc = parseValor(nota.c100.vl_doc);
        const vlMercadoria = parseValor(nota.c100.vl_merc);
        const vlDesc = parseValor(nota.c100.vl_desc);
        const vlFrt = parseValor(nota.c100.ind_frt); // se for 0, 1, 2...

        if (nota.c100.ind_oper === '0') {
            totalValorCompras += vlTotalDoc;
        }

        // |REG|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|VL_PIS|VL_COFINS|COD_INF|
        // Total: 29 campos (sem contar o pipe inicial vazio)
        const c100Line = [
            '',                                        // pipe inicial
            'C100',                                    // 1. REG
            nota.c100.ind_oper || '0',                 // 2. IND_OPER (0=Entrada, 1=Saída)
            nota.c100.ind_emit || '1',                 // 3. IND_EMIT (0=Própria, 1=Terceiros)
            cnpjLimpo,                                 // 4. COD_PART
            nota.c100.cod_mod || '55',                 // 5. COD_MOD
            '00',                                      // 6. COD_SIT
            nota.c100.serie || '1',                    // 7. SER
            nota.c100.num_doc,                         // 8. NUM_DOC
            nota.c100.chv_nfe,                         // 9. CHV_NFE
            formatDate(nota.c100.dt_doc),              // 10. DT_DOC
            formatDate(nota.c100.dt_e_s),              // 11. DT_E_S
            formatSpedFloat(vlTotalDoc),               // 12. VL_DOC
            '0',                                       // 13. IND_PGTO
            formatSpedFloat(vlDesc),                   // 14. VL_DESC
            '0',                                       // 15. VL_ABAT_NT
            formatSpedFloat(vlMercadoria),             // 16. VL_MERC
            '0',                                       // 17. IND_FRT (0=Contratação por Conta do Emitente)
            '0,00',                                    // 18. VL_FRT
            '0,00',                                    // 19. VL_SEG
            '0,00',                                    // 20. VL_OUT_DA
            '0,00',                                    // 21. VL_BC_ICMS
            '0,00',                                    // 22. VL_ICMS
            '0,00',                                    // 23. VL_BC_ICMS_ST
            '0,00',                                    // 24. VL_ICMS_ST
            '0,00',                                    // 25. VL_RED_BC
            '0,00',                                    // 26. VL_IPI
            '0,00',                                    // 27. VL_PIS
            '0,00',                                    // 28. VL_COFINS
            '',                                        // 29. COD_INF
            '',                                        // trailing pipe
        ].join('|');
        linhasBlocoC.push(c100Line);

        // Hash Map de Consolidação (Para o C190)
        const agregadorC190 = new Map();

        // --- C170: ITENS E O MOTOR FISCAL ---
        for (const item of nota.itens) {
            let finalCfop = userCfop || item.cfop_original || '1102';
            let finalCst = item.cst_icms_original || '000';

            let vlItem = parseValor(item.vl_item);
            let descItem = parseValor(item.vl_desc);
            let baseIcms = 0;
            let aliquotaIcms = 0;
            let valorIcms = 0;

            // REGRA MAGNA DO USUÁRIO
            if (finalCfop === '1556' && forceCst040) {
                finalCst = '040';
                baseIcms = 0;
                aliquotaIcms = 0;
                valorIcms = 0;
            }

            // Produtos no bloco 0
            const codUnit = item.unid || 'UN';
            const codProdutoNfe = item.cod_item || (codItemInterno++).toString();
            linhasBloco0.push(`|0190|${codUnit}|Unidade Extraida Nfe|`);
            const linha0200 = [
                '',
                '0200',
                codProdutoNfe,
                item.descr_item,
                '', // COD_BARRA
                '', // COD_ANT_ITEM
                codUnit, // UNID_INV
                '00', // TIPO_ITEM
                '', // COD_NCM
                '', // EX_IPI
                '', // COD_GEN
                '', // COD_LST
                '', // ALIQ_ICMS
                '', // CEST
                '' // trailing pipe
            ].join('|');
            linhasBloco0.push(linha0200);

            // |REG|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|COD_NAT|
            // |VL_BC_ICMS|ALIQ_ICMS|VL_ICMS|VL_BC_ICMS_ST|ALIQ_ST|VL_ICMS_ST|IND_APUR|CST_IPI|COD_ENQ|
            // |VL_BC_IPI|ALIQ_IPI|VL_IPI|CST_PIS|VL_BC_PIS|ALIQ_PIS_PERC|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|
            // |CST_COFINS|VL_BC_COFINS|ALIQ_COFINS_PERC|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|VL_ABAT_NT|
            // Total: 38 campos
            const c170Line = [
                '',                                               // pipe inicial
                'C170',                                           // 1. REG
                item.num_item,                                    // 2. NUM_ITEM
                codProdutoNfe,                                    // 3. COD_ITEM
                '',                                               // 4. DESCR_COMPL
                formatSpedFloat(parseValor(item.qtd), 5),         // 5. QTD
                codUnit,                                          // 6. UNID
                formatSpedFloat(vlItem),                          // 7. VL_ITEM
                formatSpedFloat(descItem),                        // 8. VL_DESC
                nota.c100.ind_oper === '1' ? '1' : '0',           // 9. IND_MOV (1=Saída, 0=Entrada)
                finalCst,                                         // 10. CST_ICMS
                finalCfop,                                        // 11. CFOP
                '',                                               // 12. COD_NAT
                formatSpedFloat(baseIcms),                        // 13. VL_BC_ICMS
                formatSpedFloat(aliquotaIcms),                    // 14. ALIQ_ICMS
                formatSpedFloat(valorIcms),                       // 15. VL_ICMS
                '0,00',                                           // 16. VL_BC_ICMS_ST
                '0,00',                                           // 17. ALIQ_ST
                '0,00',                                           // 18. VL_ICMS_ST
                '0',                                              // 19. IND_APUR (0=Apuração mensal)
                '',                                               // 20. CST_IPI (Zerado a pedido do dev)
                '',                                               // 21. COD_ENQ (vazio para não-IPI)
                '0,00',                                           // 22. VL_BC_IPI
                '0,00',                                           // 23. ALIQ_IPI
                '0,00',                                           // 24. VL_IPI
                '99',                                             // 25. CST_PIS (99=Outras operações)
                '0,00',                                           // 26. VL_BC_PIS
                '0,00',                                           // 27. ALIQ_PIS_PERC
                '0,00',                                           // 28. QUANT_BC_PIS
                '0,00',                                           // 29. ALIQ_PIS_QUANT
                '0,00',                                           // 30. VL_PIS
                '99',                                             // 31. CST_COFINS (99=Outras operações)
                '0,00',                                           // 32. VL_BC_COFINS
                '0,00',                                           // 33. ALIQ_COFINS_PERC
                '0,00',                                           // 34. QUANT_BC_COFINS
                '0,00',                                           // 35. ALIQ_COFINS_QUANT
                '0,00',                                           // 36. VL_COFINS
                '',                                               // 37. COD_CTA
                '0,00',                                           // 38. VL_ABAT_NT
                '',                                               // trailing pipe
            ].join('|');
            linhasBlocoC.push(c170Line);

            // AGREGAR PARA O C190
            const keyAgregacao = `${finalCst}_${finalCfop}_${aliquotaIcms}`;
            if (!agregadorC190.has(keyAgregacao)) {
                agregadorC190.set(keyAgregacao, {
                    cst: finalCst,
                    cfop: finalCfop,
                    aliq: aliquotaIcms,
                    vl_opr: 0,
                    vl_bc_icms: 0,
                    vl_icms: 0
                });
            }
            const agg = agregadorC190.get(keyAgregacao);
            agg.vl_opr += (vlItem - descItem);
            agg.vl_bc_icms += baseIcms;
            agg.vl_icms += valorIcms;
        }

        // --- C190: ANALÍTICO DA NOTA ---
        // |REG|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|COD_OBS|
        // Total: 12 campos
        for (const [key, agg] of agregadorC190.entries()) {
            const c190Line = [
                '',
                'C190',
                agg.cst,                             // CST_ICMS
                agg.cfop,                            // CFOP
                formatSpedFloat(agg.aliq),           // ALIQ_ICMS
                formatSpedFloat(agg.vl_opr),         // VL_OPR
                formatSpedFloat(agg.vl_bc_icms),     // VL_BC_ICMS
                formatSpedFloat(agg.vl_icms),        // VL_ICMS
                '0,00',                              // VL_BC_ICMS_ST
                '0,00',                              // VL_ICMS_ST
                '0,00',                              // VL_RED_BC
                '0,00',                              // VL_IPI
                '',                                  // COD_OBS
                '',                                  // trailing pipe
            ].join('|');
            linhasBlocoC.push(c190Line);
        }
    }

    // Limpar duplicações do Bloco 0 (Ex: várias notas com mesmo fornecedor ou unidade, cria strings idênticas)
    linhasBloco0 = [...new Set(linhasBloco0)];

    return {
        bloco0: linhasBloco0,
        blocoC: linhasBlocoC,
        relatorio: {
            totalNotas,
            totalValorCompras: formatSpedFloat(totalValorCompras)
        }
    };
}

module.exports = {
    transformarNotasEmSped
};
