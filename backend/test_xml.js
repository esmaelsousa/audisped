const fs = require('fs');
const xml2js = require('xml2js');

const parseValorNFe = (val) => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    const cleanStr = String(val).replace(',', '.').trim();
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? 0 : parsed;
};

const extractNfeData = (nfeNode) => {
    if (!nfeNode || !nfeNode.infNFe) return null;
    const inf = nfeNode.infNFe;
    const ide = inf.ide;
    const emit = inf.emit;
    const dest = inf.dest;
    const total = inf.total?.ICMSTot;

    let detArray = inf.det;
    if (!Array.isArray(detArray)) detArray = [detArray];

    const itens = detArray.map(det => {
        const prod = det.prod;
        const imposto = det.imposto;
        
        let cstIcms = '000';
        let vBC = 0, pICMS = 0, vICMS = 0;
        let vBCST = 0, vICMSST = 0;
        let vIPI = 0, cstIPI = '99';

        if (imposto?.ICMS) {
            const icmsNode = Object.values(imposto.ICMS)[0];
            cstIcms = icmsNode.CST || icmsNode.CSOSN || '000';
            vBC = parseValorNFe(icmsNode.vBC);
            pICMS = parseValorNFe(icmsNode.pICMS);
            vICMS = parseValorNFe(icmsNode.vICMS);
            vBCST = parseValorNFe(icmsNode.vBCST);
            vICMSST = parseValorNFe(icmsNode.vICMSST);
        }

        if (imposto?.IPI?.IPITrib) {
            vIPI = parseValorNFe(imposto.IPI.IPITrib.vIPI);
            cstIPI = imposto.IPI.IPITrib.CST || '99';
        }

        return {
            num_item: det.$ ? det.$.nItem : '?',
            cod_item: prod.cProd,
            descr_item: prod.xProd,
            cfop: prod.CFOP,
            ucom: prod.uCom,
            qcom: parseValorNFe(prod.qCom),
            vuncom: parseValorNFe(prod.vUnCom),
            vprod: parseValorNFe(prod.vProd),
            vdesc: parseValorNFe(prod.vDesc),
            voutro: parseValorNFe(prod.vOutro),
            vfrete: parseValorNFe(prod.vFrete),
            vseg: parseValorNFe(prod.vSeg),
            vunid: parseValorNFe(prod.vUnCom),
            cst_icms: cstIcms,
            vbc_icms: vBC,
            vicms: vICMS,
            picms: pICMS,
            cst_ipi: cstIPI,
            vipi: vIPI,
            cst_pis: imposto?.PIS?.PISAliq?.CST || imposto?.PIS?.PISNT?.CST || '01',
            vpis: parseValorNFe(imposto?.PIS?.PISAliq?.vPIS),
            cst_cofins: imposto?.COFINS?.COFINSAliq?.CST || imposto?.COFINS?.COFINSNT?.CST || '01',
            vcofins: parseValorNFe(imposto?.COFINS?.COFINSAliq?.vCOFINS)
        };
    });

    return {
        emitente: {
            cnpj: emit.CNPJ || emit.CPF,
            nome: emit.xNome,
            ie: emit.IE,
            cod_mun: emit.enderEmit?.cMun
        },
        destinatario: {
            cnpj: dest?.CNPJ || dest?.CPF,
            nome: dest?.xNome
        },
        c100: {
            chv_nfe: inf.$ ? inf.$.Id?.replace('NFe', '') : '?',
            num_doc: ide.nNF,
            serie: ide.serie,
            mod: ide.mod || '55',
            dt_doc: ide.dhEmi ? ide.dhEmi.substring(0, 10) : '',
            dt_e_s: ide.dhSaiEnt ? ide.dhSaiEnt.substring(0, 10) : (ide.dhEmi ? ide.dhEmi.substring(0, 10) : ''),
            vl_doc: parseValorNFe(total?.vNF),
            vl_merc: parseValorNFe(total?.vProd),
            vl_desc: parseValorNFe(total?.vDesc),
            vl_outros: parseValorNFe(total?.vOutro),
            vl_frete: parseValorNFe(total?.vFrete),
            vl_seguro: parseValorNFe(total?.vSeg),
            vl_bc_icms: parseValorNFe(total?.vBC),
            vl_icms: parseValorNFe(total?.vICMS),
            vl_bc_st: parseValorNFe(total?.vBCST),
            vl_icms_st: parseValorNFe(total?.vST),
            vl_ipi: parseValorNFe(total?.vIPI),
            vl_pis: parseValorNFe(total?.vPIS),
            vl_cofins: parseValorNFe(total?.vCOFINS),
            ind_pgto: ide.indPag || '0', 
            ind_emit: '1', 
            ind_oper: '0', 
            cod_sit: '00'
        },
        itens
    };
};

const xmlPath = '/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/speds/exemplo.xml';
const xmlData = fs.readFileSync(xmlPath, 'utf-8');
const parser = new xml2js.Parser({ explicitArray: false });

parser.parseString(xmlData, (err, result) => {
    if (err) {
        console.error('Error parsing XML:', err);
        return;
    }
    const nfeNode = result.nfeProc ? result.nfeProc.NFe : result.NFe;
    const data = extractNfeData(nfeNode);
    console.log(JSON.stringify(data, null, 2));
});
