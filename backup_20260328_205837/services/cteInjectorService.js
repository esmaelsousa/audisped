const { XMLParser } = require('fast-xml-parser');
const logger = require('../logger');

// ─── Utilitários ────────────────────────────────────────────────────────────

function parseValor(v) {
    if (!v) return 0.0;
    const num = parseFloat(String(v).replace(',', '.'));
    return isNaN(num) ? 0.0 : num;
}

function formatSpedFloat(val, dec = 2) {
    if (val === undefined || val === null || isNaN(val)) return '0,00';
    return Number(val).toFixed(dec).replace('.', ',');
}

function formatDate(isoStr) {
    if (!isoStr) return '';
    const s = String(isoStr).substring(0, 10);
    const [y, m, d] = s.split('-');
    return `${d}${m}${y}`;
}

function limparCnpj(v) {
    return String(v || '').replace(/\D/g, '').padStart(14, '0');
}

// ─── Parser XML ──────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,      // false para evitar que a chave de 44 dígitos vire float (notação científica)
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => ['Comp', 'infQ', 'infNFe', 'infNF'].includes(name)
});

/**
 * Extrai o bloco de ICMS independente do CST (ICMS00, ICMS20, ICMS45, etc.)
 */
function extrairIcms(icmsNode) {
    if (!icmsNode) return { cst: '40', bc: 0, aliq: 0, vl: 0 };

    // Pega o primeiro filho que começar com "ICMS"
    const chave = Object.keys(icmsNode).find(k => k.startsWith('ICMS') || k === 'ICMSSN');
    if (!chave) return { cst: '40', bc: 0, aliq: 0, vl: 0 };

    const bloco = icmsNode[chave];
    return {
        cst  : String(bloco.CST || bloco.CSOSN || '40').padStart(2, '0'),
        bc   : parseValor(bloco.vBC),
        aliq : parseValor(bloco.pICMS),
        vl   : parseValor(bloco.vICMS),
    };
}

/**
 * Faz o parse de um XML de CT-e e retorna objeto estruturado.
 */
function parseCteXml(xmlContent) {
    try {
        const parsed = xmlParser.parse(xmlContent);

        // Suporta com ou sem wrapper cteProc
        const root   = parsed.cteProc || parsed;
        const cte    = root.CTe  || root.cte;
        const infCte = cte?.infCte;
        if (!infCte) throw new Error('Tag <infCte> não encontrada');

        const ide    = infCte.ide    || {};
        const emit   = infCte.emit   || {};
        const dest   = infCte.dest   || {};
        const vPrest = infCte.vPrest || {};
        const imp    = infCte.imp    || {};
        const prot   = root.protCTe?.infProt || {};

        const icms = extrairIcms(imp.ICMS);

        // Chave de acesso: do protocolo (mais confiável) ou atributo Id
        const chave = String(prot.chCTe || cte.infCte?.['@_Id'] || '').replace(/^CTe/, '');

        return {
            ok: true,
            // Identificação
            chave_acesso   : chave,
            numero         : String(ide.nCT   || '').padStart(9, '0'),
            serie          : String(ide.serie || '').padStart(3, '0'),
            cfop           : String(ide.CFOP  || ''),
            modelo         : String(ide.mod   || '57'),
            tp_cte         : String(ide.tpCTe ?? '0'),
            // Datas
            dt_doc         : String(ide.dhEmi || ide.dEmi || '').substring(0, 10),
            dt_autorizacao : String(prot.dhRecbto || '').substring(0, 10),
            // Protocolo
            protocolo      : String(prot.nProt || ''),
            cod_sit        : String(prot.cStat || '100') === '100' ? '00' : '02',
            // Destinatário (empresa que recebe a mercadoria transportada)
            cnpj_dest      : limparCnpj(dest.CNPJ || dest.CPF || ''),
            nome_dest      : String(dest.xNome || ''),
            // Emitente (transportadora)
            cnpj_emit      : limparCnpj(emit.CNPJ),
            nome_emit      : String(emit.xNome || ''),
            ie_emit        : String(emit.IE    || ''),
            uf_emit        : String(emit.enderEmit?.UF || ide.UFIni || ''),
            cod_mun_emit   : String(emit.enderEmit?.cMun || ''),
            end_emit       : String(emit.enderEmit?.xLgr || ''),
            num_emit       : String(emit.enderEmit?.nro  || ''),
            bairro_emit    : String(emit.enderEmit?.xBairro || ''),
            fone_emit      : String(emit.enderEmit?.fone || ''),
            // Municípios de origem/destino do serviço (obrigatórios para COD_MOD=57)
            cod_mun_orig   : String(ide.cMunIni || ''),
            cod_mun_dest   : String(ide.cMunFim || ''),
            // Valores
            vl_doc         : parseValor(vPrest.vTPrest),
            vl_rec         : parseValor(vPrest.vRec),
            // ICMS
            cst_icms       : icms.cst,
            vl_bc_icms     : icms.bc,
            aliq_icms      : icms.aliq,
            vl_icms        : icms.vl,
        };

    } catch (err) {
        logger.error('Erro ao parsear CT-e:', err.message);
        return { ok: false, erro: err.message };
    }
}

// ─── Gerador de Bloco D ──────────────────────────────────────────────────────

/**
 * Recebe array de CT-e já parseados e gera as linhas do Bloco D.
 */
async function transformarCtesEmSped(dbClient, parsedCtes, options = {}) {
    const {
        pularDuplicados  = true,
        chavesExistentes = [],
        idEmpresa        = null,
        analyzeOnly      = false,
    } = options;

    const setChaves  = new Set(chavesExistentes);
    const map0150    = new Map();
    const linhasD    = [];

    let totalCtes    = 0;
    let totalPulados = 0;
    let totalFrete   = 0;

    const ctesProcessados = [];

    for (const cte of parsedCtes) {
        if (!cte.ok) continue;

        // Duplicidade
        if (pularDuplicados && cte.chave_acesso && setChaves.has(cte.chave_acesso)) {
            totalPulados++;
            logger.info(`CT-e ${cte.numero} ignorado — duplicado.`);
            continue;
        }

        totalCtes++;
        totalFrete += cte.vl_doc;

        // ── 0150: Participante (emitente = transportadora) ──────────────────
        if (cte.cnpj_emit && !map0150.has(cte.cnpj_emit)) {
            const reg0150 = [
                '', '0150',
                cte.cnpj_emit,                   // COD_PART  (2)
                cte.nome_emit || 'TRANSPORTADORA', // NOME     (3)
                '1058',                           // COD_PAIS  (4)
                cte.cnpj_emit,                   // CNPJ      (5)
                '',                              // CPF       (6)
                cte.ie_emit,                     // IE        (7)
                cte.cod_mun_emit,                // COD_MUN   (8)
                '',                              // SUFRAMA   (9)
                cte.end_emit || 'NAO INFORMADO', // END       (10) obrigatório
                cte.num_emit || 'SN',            // NUM       (11)
                '',                              // COMPL     (12)
                cte.bairro_emit || '',           // BAIRRO    (13)
                ''
            ].join('|');
            map0150.set(cte.cnpj_emit, reg0150);
        }

        // ── D100: Cabeçalho do CT-e ─────────────────────────────────────────
        // |D100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC
        // |CHV_CTE|DT_DOC|DT_A_P|TP_CT-e|CHAVE_CTE_REF|VL_DOC|VL_DESC
        // |IND_FRT|VL_SERV|VL_BC_ICMS|VL_ICMS|VL_NT|COD_INF|COD_CTA|
        const d100 = [
            '',
            'D100',
            '0',                          // IND_OPER: 0=entrada (posto recebe o serviço)
            '1',                          // IND_EMIT: 1=terceiros
            cte.cnpj_emit,                // COD_PART
            '57',                         // COD_MOD
            cte.cod_sit,                  // COD_SIT: 00=regular
            String(cte.serie).replace(/^0+/, '') || '1',  // SER
            '',                           // SUB
            String(parseInt(cte.numero) || 0), // NUM_DOC (sem zeros à esquerda)
            cte.chave_acesso,             // CHV_CTE
            formatDate(cte.dt_doc),       // DT_DOC
            formatDate(cte.dt_autorizacao || cte.dt_doc), // DT_A_P
            cte.tp_cte,                   // TP_CT-e: 0=normal
            '',                           // CHAVE_CTE_REF
            formatSpedFloat(cte.vl_doc),  // VL_DOC
            '0,00',                       // VL_DESC
            '0',                          // IND_FRT: 0=por conta do remetente
            formatSpedFloat(cte.vl_doc),  // VL_SERV
            formatSpedFloat(cte.vl_bc_icms), // VL_BC_ICMS
            formatSpedFloat(cte.vl_icms),    // VL_ICMS
            '0,00',                       // VL_NT
            '',                           // COD_INF
            '',                           // COD_CTA
            cte.cod_mun_orig,             // COD_MUN_ORIG (campo 24 — obrigatório CT-e)
            cte.cod_mun_dest,             // COD_MUN_DEST (campo 25 — obrigatório CT-e)
            ''
        ].join('|');

        // ── D190: Analítico ─────────────────────────────────────────────────
        // CFOP padrão de entrada para CT-e: 1353 (Aquisição de serviço de transporte).
        const cfopEntrada = '1353';

        const d190 = [
            '',
            'D190',
            cte.cst_icms.padStart(3, '0'), // CST_ICMS (3 dígitos no Bloco D)
            cfopEntrada,
            formatSpedFloat(cte.aliq_icms),
            formatSpedFloat(cte.vl_doc),
            formatSpedFloat(cte.vl_bc_icms),
            formatSpedFloat(cte.vl_icms),
            '0,00',   // VL_RED_BC
            '',       // COD_OBS
            ''
        ].join('|');

        if (!analyzeOnly) {
            linhasD.push(d100);
            linhasD.push(d190);
        }

        // Para preview no frontend
        ctesProcessados.push({
            chave        : cte.chave_acesso,
            numero       : cte.numero,
            serie        : cte.serie,
            emitente     : cte.nome_emit,
            cnpj_emit    : cte.cnpj_emit,
            cfop         : cte.cfop,
            dt_doc       : cte.dt_doc,
            vl_doc       : cte.vl_doc,
            vl_icms      : cte.vl_icms,
            aliq_icms    : cte.aliq_icms,
            cst_icms     : cte.cst_icms,
            linhas_geradas: analyzeOnly ? [] : [d100, d190],
        });
    }

    return {
        blocoD: linhasD,
        map0150,
        ctesProcessados,
        relatorio: {
            totalCtes,
            totalPulados,
            totalFrete: formatSpedFloat(totalFrete),
        }
    };
}

module.exports = { parseCteXml, transformarCtesEmSped };
