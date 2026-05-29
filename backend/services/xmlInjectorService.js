const logger = require('../logger');

// Últimos 2 dígitos de CST válidos no EFD ICMS/IPI
const SITUACOES_CST_VALIDAS = new Set(['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90']);

// CSOSN (Simples Nacional) → CST equivalente para o destinatário regular
const CSOSN_PARA_CST = {
    '101': '020', // com crédito de ICMS
    '102': '040', // sem permissão de crédito → isenta
    '103': '040',
    '201': '030', // ST + sem crédito
    '202': '030',
    '203': '030',
    '300': '040', // imune
    '400': '041', // não tributada / não contribuinte Simples
    '500': '060', // ICMS ST cobrado anteriormente
    '900': '090'  // outras
};

/**
 * Normaliza o CST/CSOSN para um código válido no EFD ICMS/IPI.
 * - Converte CSOSN (Simples Nacional) para CST equivalente
 * - Corrige situações inválidas (ex: '61' → '60')
 * - Preserva o dígito de origem (1º dígito) quando presente
 */
function normalizarCst(cst) {
    const cstStr = String(cst || '000').padStart(3, '0');

    // CSOSN do Simples Nacional (3 dígitos específicos como 101, 400, 500...)
    if (CSOSN_PARA_CST[cstStr]) {
        return CSOSN_PARA_CST[cstStr].padStart(3, '0');
    }

    // Verifica se os 2 últimos dígitos formam situação válida
    const situacao = cstStr.slice(-2);
    if (SITUACOES_CST_VALIDAS.has(situacao)) {
        return cstStr; // Válido
    }

    // Correções de situações próximas (comuns em XMLs com CST fora do padrão)
    const CORRECOES_SITUACAO = {
        '61': '60', // ICMS monofásico não standard → ST cobrada anteriormente
        '11': '10',
        '21': '20',
        '31': '30',
    };
    const correcao = CORRECOES_SITUACAO[situacao];
    if (correcao) {
        logger.warn(`CST '${cstStr}' inválido no EFD — corrigido para '${cstStr.slice(0, -2) + correcao}'`);
        return cstStr.slice(0, -2) + correcao;
    }

    logger.warn(`CST '${cstStr}' inválido no EFD — substituído por '000'`);
    return '000';
}

// Extrai e converte float do XML ou retorna zero seguro
function parseValor(v) {
    if (!v) return 0.0;
    const num = parseFloat(v);
    return isNaN(num) ? 0.0 : num;
}

// Formata para o padrão SPED Fiscal: duas decimais com vírgula (ou mais para QTD)
function formatSpedFloat(val, algarismos = 2) {
    if (val === undefined || val === null || isNaN(val)) return '0,00';
    return val.toFixed(algarismos).replace('.', ',');
}

// Remove os hífens e formata data DDMMAAAA -> AAAAMMDD ou vice versa
function formatDate(isoDateStr) {
    if (!isoDateStr) return '';
    // Recebe do XML 2021-01-10 -> SPED: DDMMAAAA
    const [y, m, d] = isoDateStr.substring(0, 10).split('-');
    return `${d}${m}${y}`;
}

/**
 * Função Core do Motor de Tributação.
 * Traduz JSON da NF-e para Strings de Linha SPED (Blocos 0 e C).
 */
async function transformarNotasEmSped(dbClient, parsedNotes, options = {}) {
    const {
        userCfop = '1102',
        forceUserCfop = false, // quando true, o CFOP do grupo tem prioridade sobre o De-Para
        forcarUsoConsumo = false, 
        ajusteIpi = false,
        ajusteIcms = false,
        analyzeOnly = false,
        itemMapping = [], 
        pularDuplicados = false,
        chavesExistentes = [], 
        idEmpresa = null
    } = options;

    let linhasBloco0 = [];
    let linhasBlocoC = [];

    const map0150 = new Map();
    const map0190 = new Map();
    const map0200 = new Map();

    let totalNotas = 0;
    let totalPuladas = 0;
    let totalValorCompras = 0;

    let codItemInterno = 9000; 

    // --- CARREGAR MAPEAMENTOS (DE-PARA) SE HOUVER dbClient ---
    const mapeamentos = new Map();
    
    // 1. Prioridade: Mapeamento Manual do Frontend
    if (itemMapping && Array.isArray(itemMapping)) {
        for (const item of itemMapping) {
            const key = `${(item.cnpj_emissor || '').replace(/\D/g, '')}_${item.codigo}`;
            mapeamentos.set(key, {
                novo_cfop: item.cfop_alvo,
                novo_cst: item.cst_alvo || '000',
                conta_contabil: item.conta_contabil,
                descricao_produto: item.descricao,
                ncm: item.ncm,
                cod_interno: item.cod_interno,
                aliq_icms: item.aliq_icms != null ? item.aliq_icms : null,
                bc_icms_override: item.bc_icms_override != null ? item.bc_icms_override : null,
                cst_pis: item.cst_pis || null,
                cst_cofins: item.cst_cofins || null
            });
        }
    }

    // 2. Complemento: Mapeamento do Banco de Dados (se não estiver no manual)
    if (dbClient) {
        try {
            const cnpjs = [...new Set(parsedNotes.map(n => (n.emitente.cnpj || '').replace(/\D/g, '')))];
            if (cnpjs.length > 0) {
                const query = `
                    SELECT cnpj_emissor, cod_produto_xml, novo_cfop, novo_cst, conta_contabil, descricao_produto, ncm, cod_interno,
                           aliq_icms, bc_icms_override, cst_pis, cst_cofins
                    FROM de_para_xml
                    WHERE cnpj_emissor = ANY($1)
                `;
                const res = await dbClient.query(query, [cnpjs]);
                for (const row of res.rows) {
                    const key = `${row.cnpj_emissor}_${row.cod_produto_xml}`;
                    if (!mapeamentos.has(key)) {
                        mapeamentos.set(key, {
                            novo_cfop: row.novo_cfop,
                            novo_cst: row.novo_cst,
                            conta_contabil: row.conta_contabil,
                            descricao_produto: row.descricao_produto,
                            ncm: row.ncm,
                            cod_interno: row.cod_interno,
                            aliq_icms: row.aliq_icms != null ? parseFloat(row.aliq_icms) : null,
                            bc_icms_override: row.bc_icms_override != null ? parseFloat(row.bc_icms_override) : null,
                            cst_pis: row.cst_pis || null,
                            cst_cofins: row.cst_cofins || null
                        });
                    }
                }
                logger.info(`Carregados ${res.rowCount} mapeamentos De-Para do BD.`);
            }

            // Lógica para buscar dados da empresa e gerar registros 0000, 0005, 0100
            let empresaData = {
                cnpj: '00000000000000',
                nome_empresa: 'EMPRESA EXEMPLO LTDA',
                uf: 'SP',
                nome_fantasia: 'EXEMPLO'
            };

            if (idEmpresa && dbClient) {
                try {
                    const res = await dbClient.query('SELECT * FROM empresas WHERE id = $1', [idEmpresa]);
                    if (res.rows.length > 0) {
                        empresaData = res.rows[0];
                    }
                } catch (err) {
                    console.error('Erro ao buscar dados da empresa para o Bloco 0:', err);
                }
            }

            // --- REGISTRO 0000: ABERTURA DO ARQUIVO DIGITAL E IDENTIFICAÇÃO DA ENTIDADE ---
            // 01-REG | 02-COD_VER | 03-COD_FIN | 04-DT_INI | 05-DT_FIN | 06-NOME | 07-CNPJ | 08-CPF | 09-UF | 10-IE | 11-COD_MUN | 12-IM | 13-SUFRAMA | 14-IND_PERFIL | 15-IND_ATIV
            const reg0000 = [
                '',
                '0000',
                '018', // Versão do layout (018 para 2024 onwards)
                '0',   // Original
                '01012025', // Ajustar dinamicamente depois
                '31012025', // Ajustar dinamicamente depois
                empresaData.nome_empresa.toUpperCase(),
                empresaData.cnpj.replace(/\D/g, ''),
                '',
                empresaData.uf.toUpperCase(),
                '', // IE (Placeholder)
                '3550308', // Cód Município (Placeholder: São Paulo)
                '', // IM
                '', // SUFRAMA
                'A', // Perfil A
                '1', // Outros (Atividade Industrial ou equiparada)
                ''
            ];
            linhasBloco0.push(reg0000.join('|'));

            // --- REGISTRO 0005: DADOS COMPLEMENTARES DA ENTIDADE ---
            // 01-REG | 02-FANTASIA | 03-CEP | 04-END | 05-NUM | 06-COMPL | 07-BAIRRO | 08-FONE | 09-FAX | 10-EMAIL
            const reg0005 = [
                '',
                '0005',
                (empresaData.nome_fantasia || empresaData.nome_empresa).toUpperCase(),
                '00000000', // CEP Placeholder
                'LOGRADOURO EXEMPLO',
                'S/N',
                '',
                'CENTRO',
                '',
                '',
                '',
                ''
            ];
            linhasBloco0.push(reg0005.join('|'));

            // --- REGISTRO 0100: DADOS DO CONTABILISTA ---
            // 01-REG | 02-NOME | 03-CPF | 04-CRC | 05-CNPJ | 06-CEP | 07-END | 08-NUM | 09-COMPL | 10-BAIRRO | 11-FONE | 12-FAX | 13-EMAIL | 14-COD_MUN
            const reg0100 = [
                '',
                '0100',
                'CONTADOR EXEMPLO',
                '00000000000',
                'SP000000O0',
                '',
                '00000000',
                'END CONTADOR',
                '123',
                '',
                'CENTRO',
                '',
                '',
                'contador@exemplo.com',
                '3550308',
                ''
            ];
            linhasBloco0.push(reg0100.join('|'));
        } catch (err) {
            logger.error('Erro ao carregar mapeamentos De-Para do BD:', err);
        }
    }

    const setChaves = new Set(chavesExistentes);

    for (const nota of parsedNotes) {
        // Verificação de duplicidade
        if (pularDuplicados && nota.c100.chv_nfe && setChaves.has(nota.c100.chv_nfe)) {
            totalPuladas++;
            logger.info(`Nota ${nota.c100.num_doc} ignorada por duplicidade (já existe no SPED).`);
            continue;
        }

        if (!nota.itens || nota.itens.length === 0) {
            logger.warn(`Nota ${nota.c100.num_doc} (Chave: ${nota.c100.chv_nfe}) ignorada pois não possui itens (causaria erro de filho obrigatório).`);
            continue;
        }

        totalNotas++;
        const cnpjLimpo = (nota.emitente.cnpj || '').replace(/\D/g, '');
        const notaLinhas = []; // Captura as linhas desta nota específica

        const vlTotalDoc = parseValor(nota.c100.vl_doc);
        const vlMercadoria = parseValor(nota.c100.vl_merc);
        const vlDesc = parseValor(nota.c100.vl_desc);

        if (nota.c100.ind_oper === '0') {
            totalValorCompras += vlTotalDoc;
        }

        // --- 0150: PARTICIPANTE / EMITENTE ---
        const end = nota.emitente.x_lgr || '';
        const num = nota.emitente.nro || '';
        const compl = nota.emitente.x_cpl || '';
        const bairro = nota.emitente.x_bairro || '';

        const emitLineFields = [
            '', '0150', cnpjLimpo, nota.emitente.nome || 'FORNECEDOR', '01058', cnpjLimpo, '', 
            nota.emitente.ie || '', nota.emitente.cod_mun || '', '', end, num, compl, bairro, ''
        ];
        const emitLine = emitLineFields.join('|');
        if (!analyzeOnly) {
            map0150.set(cnpjLimpo, emitLine);
        }

        // --- C100: CABEÇALHO DA NOTA ---
        const agregadorC190 = new Map();
        const bufferedC170s = [];
        
        let somaVlBcIcms = 0;
        let somaVlIcms = 0;
        let somaVlBcSt = 0;
        let somaVlIcmsSt = 0;
        let somaVlIpi = 0;
        let somaVlMerc = 0;

        // --- C170: ITENS ---
        for (const item of nota.itens) {
            const mKey = `${cnpjLimpo}_${item.cod_item}`;
            const m = mapeamentos.get(mKey);

            let finalCfop = (m && !forceUserCfop) ? m.novo_cfop : (userCfop || item.cfop || item.cfop_original || '1102');
            let finalCst = m ? m.novo_cst : (item.cst_icms || item.cst_icms_original || '000');
            finalCst = normalizarCst(finalCst);
            let contaContabil = m ? m.conta_contabil : '';

            // Importante: usar os campos reais que o extractNfeData produz (vprod, vdesc, etc)
            let vlItem = parseValor(item.vprod);
            let descItem = parseValor(item.vdesc);
            let vlIpi = parseValor(item.vipi);
            let vlIcms = parseValor(item.vicms);
            let aliqIcms = (m && m.aliq_icms != null) ? m.aliq_icms : parseValor(item.picms);


            // Novos campos extraídos (BCs e Alíquotas)
            let bcIpi = parseValor(item.vbc_ipi);
            let aliqIpi = parseValor(item.pipi);
            let bcIcmsSt = parseValor(item.vbc_icms_st);
            let vlIcmsSt = parseValor(item.vicms_st);

            // Novos campos extraídos conforme Plano Fase 2
            let bcIcmsXml = parseValor(item.vbc_icms);
            let vlIcmsXml = parseValor(item.vicms);
            let bcIcmsStRet = parseValor(item.vbc_icms_st_ret);
            let vlIcmsStRet = parseValor(item.vicms_st_ret);

            let cstPis = (m && m.cst_pis) ? m.cst_pis : (item.cst_pis || '07');
            let bcPis = parseValor(item.vbc_pis);
            let aliqPis = parseValor(item.ppis);
            let vlPis = parseValor(item.vpis);
            let cstCofins = (m && m.cst_cofins) ? m.cst_cofins : (item.cst_cofins || '07');
            let bcCofins = parseValor(item.vbc_cofins);
            let aliqCofins = parseValor(item.pcofins);
            let vlCofins = parseValor(item.vcofins);
            let vIpiDevol = parseValor(item.vipidevol);

            // Extração de valores acessórios
            let vFrete = parseValor(item.vfrete);
            let vSeg = parseValor(item.vseg);
            let vOutro = parseValor(item.voutro);

            // Se for CST 60 ou 61, usamos os valores retidos como base de ST no C170
            if (finalCst === '060' || finalCst === '061') {
                bcIcmsSt = bcIcmsStRet;
                vlIcmsSt = vlIcmsStRet;
            }

            // Ajustes de Custo (Premium Feature)
            if (ajusteIpi) {
                vlItem += vlIpi;
                vlIpi = 0; 
                bcIpi = 0;
                aliqIpi = 0;
            }
            if (ajusteIcms) {
                // Ao ajustar ICMS para custo, zeramos tanto o valor quanto a base destacada
                vlIcms = 0;
                aliqIcms = 0;
                bcIcmsXml = 0; // Evita que a BC original apareça no SPED
            }

            if (forcarUsoConsumo && finalCfop === '1556') {
                // De-Para tem prioridade sobre o CST: só força 040 (isento) quando NÃO há novo_cst configurado.
                if (!(m && m.novo_cst)) finalCst = '040';
                vlItem += vlIcmsSt;
                vlItem += vlIpi;
                vlItem += vIpiDevol;
                
                vlIcms = 0;
                aliqIcms = 0;
                bcIcmsSt = 0;
                vlIcmsSt = 0;
                vlIpi = 0;
                bcIpi = 0;
                aliqIpi = 0;
                vIpiDevol = 0;
                bcIcmsXml = 0;
                vlIcmsXml = 0; // zera tb a fonte que vIcmsCalc lê (senão item tributado mantém ICMS em CST isento/uso-consumo)
            }

            // Prioridade para Base de ICMS do XML, senão calcula.
            // CSTs que admitem BC: 00, 10, 20, 70 (simplificado)
            const cstComBase = ['000', '010', '020', '070', '090'].includes(finalCst);
            const bcIcmsCalculado = cstComBase ? (vlItem - descItem + vFrete + vSeg + vOutro) : 0;
            
            const bcIcms = (m && m.bc_icms_override != null) 
                ? m.bc_icms_override 
                : (bcIcmsXml > 0 ? bcIcmsXml : bcIcmsCalculado);
            
            // Valor do ICMS: Prioriza XML se não houver override de alíquota pelo De-Para
            const vIcmsCalc = (m && m.aliq_icms != null) 
                ? (bcIcms * aliqIcms) / 100 
                : (vlIcmsXml > 0 ? vlIcmsXml : (bcIcms * aliqIcms) / 100);

            const codUnit = item.ucom || 'UN';
            const codProdutoNfe = (m && m.cod_interno) ? m.cod_interno : (item.cod_item || (codItemInterno++).toString());
            const descricaoFinal = m && m.descricao_produto ? m.descricao_produto : item.descr_item;
            const ncmFinal = m && m.ncm ? m.ncm : (item.ncm || '');

            const reg0190 = ['', '0190', codUnit, 'Unidade Extraida Nfe', ''].join('|');
            const reg0200 = ['', '0200', codProdutoNfe, descricaoFinal, '', '', codUnit, '00', ncmFinal, '', '', '', '', '', ''].join('|');
            
            if (!analyzeOnly) {
                map0190.set(codUnit, reg0190);
                map0200.set(codProdutoNfe, reg0200);
            }

            // Correção CST_IPI para entradas
            let finalCstIpi = item.cst_ipi || '99';
            if (finalCfop.startsWith('1') || finalCfop.startsWith('2') || finalCfop.startsWith('3')) {
                if (parseInt(finalCstIpi) >= 50) {
                    finalCstIpi = '49';
                }
            }

            // QTD deve ser > 0; se o XML vier com 0, usa 1,0 como mínimo seguro
            const qtd = parseValor(item.qcom);
            const qtdFinal = qtd > 0 ? qtd : 1.0;

            const c170Fields = [
                '', 'C170', item.num_item, codProdutoNfe, '',
                formatSpedFloat(qtdFinal, 5),
                codUnit, 
                formatSpedFloat(vlItem), 
                formatSpedFloat(descItem), 
                nota.c100.ind_oper === '1' ? '1' : '0', 
                finalCst, 
                finalCfop, 
                '', 
                formatSpedFloat(bcIcms), 
                formatSpedFloat(aliqIcms), 
                formatSpedFloat(vIcmsCalc), 
                formatSpedFloat(bcIcmsSt), 
                '0,00', 
                formatSpedFloat(vlIcmsSt), 
                '0', 
                finalCstIpi, 
                '', 
                formatSpedFloat(bcIpi), 
                formatSpedFloat(aliqIpi), 
                formatSpedFloat(vlIpi), 
                cstPis, 
                formatSpedFloat(bcPis), 
                formatSpedFloat(aliqPis), 
                '0,00', 
                '0,00', 
                formatSpedFloat(vlPis), 
                cstCofins, 
                formatSpedFloat(bcCofins), 
                formatSpedFloat(aliqCofins), 
                '0,00', 
                '0,00', 
                formatSpedFloat(vlCofins), 
                contaContabil, formatSpedFloat(vIpiDevol), ''
            ];
            const c170Line = c170Fields.join('|');
            bufferedC170s.push(c170Line);

            const keyAg = `${finalCst}_${finalCfop}_${aliqIcms}`;
            if (!agregadorC190.has(keyAg)) {
                agregadorC190.set(keyAg, { 
                    cst: finalCst, 
                    cfop: finalCfop, 
                    aliq: aliqIcms, 
                    vl_opr: 0, 
                    vl_bc_icms: 0, 
                    vl_icms: 0, 
                    vl_bc_st: 0,
                    vl_icms_st: 0,
                    vl_ipi: 0 
                });
            }
            const agg = agregadorC190.get(keyAg);
            // Valor da Operação no C190: Valor Produto - Desconto + Acréscimos (Frete, Seg, Outro) + ST + IPI + IpiDevol
            // Isso deve bater exatamente com o VL_DOC do C100
            const valorOperacaoItem = (vlItem - descItem + vFrete + vSeg + vOutro + vlIcmsSt + vlIpi + vIpiDevol);
            
            agg.vl_opr += valorOperacaoItem;
            agg.vl_bc_icms += bcIcms;
            agg.vl_icms += vIcmsCalc;
            agg.vl_bc_st += bcIcmsSt;
            agg.vl_icms_st += vlIcmsSt;
            agg.vl_ipi += vlIpi;

            // Totais para o Cabeçalho C100
            somaVlBcIcms += bcIcms;
            somaVlIcms += vIcmsCalc;
            somaVlBcSt += bcIcmsSt;
            somaVlIcmsSt += vlIcmsSt;
            somaVlIpi += vlIpi;
            somaVlMerc += vlItem;
        }

        // --- C190 (Cálculo do VL_DOC final baseado na soma dos analíticos) ---
        const c190LinesParaNota = [];
        let vlDocCalculado = 0;
        for (const [key, agg] of agregadorC190.entries()) {
            vlDocCalculado += agg.vl_opr;
            const c190Line = [
                '', 'C190', agg.cst, agg.cfop, 
                formatSpedFloat(agg.aliq), 
                formatSpedFloat(agg.vl_opr), 
                formatSpedFloat(agg.vl_bc_icms), 
                formatSpedFloat(agg.vl_icms), 
                formatSpedFloat(agg.vl_bc_st), 
                formatSpedFloat(agg.vl_icms_st), 
                '0,00', 
                formatSpedFloat(agg.vl_ipi), 
                '', ''
            ].join('|');
            c190LinesParaNota.push(c190Line);
        }

        // Fallback: se a nota não tiver itens, gera um C190 sintético para satisfazer a obrigatoriedade
        if (c190LinesParaNota.length === 0) {
            const vlDoc = parseValor(nota.c100.vl_doc) || 0;
            vlDocCalculado = vlDoc;
            if (vlDoc > 0) {
                const fallbackC190 = ['', 'C190', '000', userCfop, '0,00',
                    formatSpedFloat(vlDoc), '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '', ''].join('|');
                c190LinesParaNota.push(fallbackC190);
            }
        }

        // --- Geração Final C100 (Usando o total calculado dos itens para não dar erro de validação) ---
        const c100LineFields = [
            '', 'C100', 
            nota.c100.ind_oper || '0', 
            nota.c100.ind_emit || '1', 
            cnpjLimpo, 
            nota.c100.mod || '55', 
            nota.c100.cod_sit || '00', 
            nota.c100.serie || '1', 
            nota.c100.num_doc, 
            nota.c100.chv_nfe, 
            formatDate(nota.c100.dt_doc), 
            formatDate(nota.c100.dt_e_s), 
            formatSpedFloat(vlDocCalculado), // Agora bate 100% com o C190
            nota.c100.ind_pgto || '0', 
            formatSpedFloat(vlDesc), 
            '0,00', 
            formatSpedFloat(somaVlMerc), 
            '0', 
            formatSpedFloat(nota.c100.vl_frete), 
            formatSpedFloat(nota.c100.vl_seguro), 
            formatSpedFloat(nota.c100.vl_outros), 
            formatSpedFloat(somaVlBcIcms), 
            formatSpedFloat(somaVlIcms), 
            formatSpedFloat(somaVlBcSt), 
            formatSpedFloat(somaVlIcmsSt), 
            formatSpedFloat(somaVlIpi), 
            formatSpedFloat(nota.c100.vl_pis), 
            formatSpedFloat(nota.c100.vl_cofins), 
            '0,00', '', ''
        ];
        const c100Line = c100LineFields.join('|');

        if (!analyzeOnly) {
            linhasBlocoC.push(c100Line);
            linhasBlocoC.push(...bufferedC170s);
            linhasBlocoC.push(...c190LinesParaNota);
        }
        
        notaLinhas.push(c100Line); 
        notaLinhas.push(...bufferedC170s);
        notaLinhas.push(...c190LinesParaNota);



        // Armazena as linhas na nota para o frontend consumir
        nota.generatedLinesPreview = notaLinhas;
    }

    // Coletar itens detectados para o Frontend
    const itensDetectados = [];
    const itensVistos = new Set();
    const notasProcessadasResult = [];

    for (const nota of parsedNotes) {
        if (!nota.generatedLinesPreview) continue; // Pula nota ignorada por duplicidade se houver

        const cnpjFornecedor = (nota.emitente.cnpj || '').replace(/\D/g, '');
        
        // Dados para o resumo por nota no frontend
        notasProcessadasResult.push({
            chave: nota.c100.chv_nfe,
            numero: nota.c100.num_doc,
            emitente: nota.emitente.nome || 'FORNECEDOR',
            valor_total: parseValor(nota.c100.vl_doc),
            data: nota.c100.dt_doc,
            linhas_geradas: nota.generatedLinesPreview
        });

        for (const item of nota.itens) {
            const mappingKey = `${cnpjFornecedor}_${item.cod_item}`;
            // Se estiver apenas analisando para mapeamento, mostramos o item para cada nota diferente
            const displayKey = analyzeOnly 
                ? `${cnpjFornecedor}_${item.cod_item}_${nota.c100.num_doc}`
                : mappingKey;

            if (!itensVistos.has(displayKey)) {
                itensVistos.add(displayKey);
                
                const mapping = mapeamentos.get(mappingKey);
                itensDetectados.push({
                    cnpj_fornecedor: cnpjFornecedor,
                    nome_fornecedor: nota.emitente.nome || 'FORNECEDOR',
                    cod_produto_xml: item.cod_item,
                    descricao_produto: item.descr_item,
                    ncm: item.ncm || '',
                    cfop_atual: mapping ? mapping.novo_cfop : (userCfop || item.cfop || item.cfop_original || '1102'),
                    cst_atual: mapping ? mapping.novo_cst : (item.cst_icms || item.cst_icms_original || '000'),
                    conta_contabil: mapping ? mapping.conta_contabil : '',
                    isMapped: !!mapping,
                    cod_interno: mapping ? mapping.cod_interno : null,
                    cod_item_sugerido: (analyzeOnly && !mapping) ? await sugerirCodInterno(dbClient, idEmpresa, item.ncm, item.descr_item) : null,
                    // Novos campos solicitados pelo usuário
                    numero_nota: nota.c100.num_doc,
                    data_nota: nota.c100.dt_doc,
                    valor_unitario: item.vuncom,
                    valor_total: item.vprod,
                    desconto: item.vdesc,
                    frete: item.vfrete,
                    // Campos de tributação do XML (para pré-preencher o De-Para)
                    aliq_icms: item.picms != null ? parseValor(item.picms) : 0,
                    cst_pis: item.cst_pis || '07',
                    cst_cofins: item.cst_cofins || '07',
                    vl_ipi: item.vipi || 0,
                    vl_pis: item.vpis || 0,
                    vl_cofins: item.vcofins || 0,
                    vl_icms: item.vicms || 0,
                    bc_icms: item.vbc_icms != null ? parseValor(item.vbc_icms) : 0,
                    vl_icms_st: item.vicms_st || 0,
                    bc_icms_st: item.vbc_icms_st != null ? parseValor(item.vbc_icms_st) : 0,
                    // Novos campos de ST Retido / Destino (CST 60 / CSOSN 500)
                    vbc_st_ret: item.vbc_st_ret || 0,
                    vicms_st_ret: item.vicms_st_ret || 0,
                    p_st: item.p_st || 0,
                    vbc_st_dest: item.vbc_st_dest || 0,
                    vicms_st_dest: item.vicms_st_dest || 0,
                    // Valores do mapeamento salvo (se houver override)
                    aliq_icms_override: mapping ? mapping.aliq_icms : null,
                    bc_icms_override: mapping ? mapping.bc_icms_override : null,
                    cst_pis_override: mapping ? mapping.cst_pis : null,
                    cst_cofins_override: mapping ? mapping.cst_cofins : null
                });
            }
        }
    }

    if (!analyzeOnly) {
        linhasBloco0.push(...map0150.values());
        linhasBloco0.push(...map0190.values());
        linhasBloco0.push(...map0200.values());
    }

    return {
        bloco0: linhasBloco0,
        blocoC: linhasBlocoC,
        itensDetectados,
        gerencial: {
            notas_processadas: notasProcessadasResult,
            estatisticas: {
                totalNotas,
                totalPuladas,
                valorTotalGeral: totalValorCompras,
                totalValorCompras: formatSpedFloat(totalValorCompras),
                totalLinhasBloco0: linhasBloco0.length,
                totalLinhasBlocoC: linhasBlocoC.length
            }
        },
        relatorio: {
            totalNotas,
            totalPuladas,
            totalValorCompras: formatSpedFloat(totalValorCompras)
        }
    };
}

/**
 * Busca sugestão de código interno no SPED da empresa
 */
async function sugerirCodInterno(dbClient, idEmpresa, ncm, descricao) {
    if (!dbClient || !idEmpresa || !ncm) return null;

    try {
        // Tenta buscar por NCM exato e descrição similar
        // Se o banco tiver pg_trgm, o operador <-> ajuda muito. 
        // Caso contrário, usamos um LIKE básico.
        const query = `
            SELECT p.cod_item
            FROM sped_produtos p
            JOIN sped_arquivos a ON p.id_sped_arquivo = a.id
            WHERE a.id_empresa = $1
              AND p.cod_ncm = $2
            ORDER BY similarity(p.descr_item, $3) DESC
            LIMIT 1
        `;
        const res = await dbClient.query(query, [idEmpresa, ncm, descricao]);
        if (res.rows.length > 0) return res.rows[0].cod_item;
        
        // Segunda tentativa: Apenas NCM
        const queryNcm = `
            SELECT p.cod_item
            FROM sped_produtos p
            JOIN sped_arquivos a ON p.id_sped_arquivo = a.id
            WHERE a.id_empresa = $1
              AND p.cod_ncm = $2
            LIMIT 1
        `;
        const resNcm = await dbClient.query(queryNcm, [idEmpresa, ncm]);
        return resNcm.rows.length > 0 ? resNcm.rows[0].cod_item : null;

    } catch (err) {
        // Se similarity falhar (falta pg_trgm), tenta busca simples
        try {
            const queryFallback = `
                SELECT p.cod_item
                FROM sped_produtos p
                JOIN sped_arquivos a ON p.id_sped_arquivo = a.id
                WHERE a.id_empresa = $1
                  AND p.cod_ncm = $2
                  AND p.descr_item ILIKE $3
                LIMIT 1
            `;
            const firstWord = (descricao || '').split(' ')[0];
            const resFallback = await dbClient.query(queryFallback, [idEmpresa, ncm, `%${firstWord}%`]);
            return resFallback.rows.length > 0 ? resFallback.rows[0].cod_item : null;
        } catch (e) {
            return null;
        }
    }
}

module.exports = {
    transformarNotasEmSped
};
