
const { transformarNotasEmSped } = require('./services/xmlInjectorService');

async function testInjection() {
    console.log('--- TESTE DE INJEÇÃO SPED VIA XML (COM DESCONTO/FRETE) ---');

    // Mock de uma nota extraída via extractNfeData
    const mockNotes = [
        {
            emitente: {
                cnpj: '12345678000199',
                nome: 'AUTO POSTO TESTE LTDA',
                ie: '123456789',
                cod_mun: '3550308'
            },
            c100: {
                chv_nfe: '35260312345678000199550010000001231000001234',
                num_doc: '123',
                serie: '1',
                mod: '55',
                dt_doc: '2026-03-10',
                dt_e_s: '2026-03-10',
                vl_doc: 1050.00, // 1000 produto - 50 desconto + 100 frete? Não, vamos fazer:
                // 1000 prod, 50 desc, 20 frete, 10 icms, 5 ipi = 1000 - 50 + 20 + 10 + 5?
                // Vamos simplificar para o teste: 1000 mercadoria, 50 desconto, 30 frete. Total = 980.
                vl_merc: 1000.00,
                vl_desc: 50.00,
                vl_frete: 30.00,
                ind_pgto: '0',
                ind_emit: '1',
                ind_oper: '0',
                cod_sit: '00'
            },
            itens: [
                {
                    num_item: '1',
                    cod_item: 'P001',
                    descr_item: 'PRODUTO TESTE COM DESCONTO',
                    vprod: 1000.00,
                    vdesc: 50.00,
                    vfrete: 30.00,
                    qcom: 10,
                    ucom: 'UN',
                    cfop: '1102',
                    cst_icms: '000',
                    picms: 18.00,
                    vicms: 171.00, // (1000 - 50 + 30) * 0.18 = 980 * 0.18 = 176.4. Vamos usar 171 fixo para ver se o motor aceita ou recalcula.
                    vuncom: 100.00
                }
            ]
        }
    ];

    const options = {
        userCfop: '1102',
        analyzeOnly: false
    };

    try {
        const result = await transformarNotasEmSped(null, mockNotes, options);
        
        console.log('\nEstatísticas:');
        console.log(JSON.stringify(result.gerencial.estatisticas, null, 2));

        console.log('\nLinhas C100 Geradas:');
        result.blocoC.filter(l => l.startsWith('|C100|')).forEach(l => console.log(l));

        console.log('\nLinhas C170 Geradas:');
        result.blocoC.filter(l => l.startsWith('|C170|')).forEach(l => console.log(l));

        console.log('\nLinhas C190 Geradas:');
        result.blocoC.filter(l => l.startsWith('|C190|')).forEach(l => console.log(l));

        console.log('\nItens Detectados (Preview):');
        console.log(JSON.stringify(result.itensDetectados, null, 2));

    } catch (err) {
        console.error('Falha no teste:', err);
    }
}

testInjection();
