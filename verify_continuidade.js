const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function verificarContinuidade() {
    try {
        // 1. Verificar se existe MARCOS AURELIO no banco
        console.log('\n=== VERIFICANDO MARCOS AURELIO ===\n');
        const empresaResult = await pool.query(
            "SELECT id, nome_empresa FROM empresas WHERE nome_empresa ILIKE '%MARCOS%' LIMIT 5"
        );
        
        if (empresaResult.rows.length === 0) {
            console.log('❌ Nenhuma empresa com "MARCOS" encontrada');
            process.exit(1);
        }
        
        const empresa = empresaResult.rows[0];
        console.log(`✓ Empresa encontrada: ${empresa.nome_empresa} (ID: ${empresa.id})\n`);
        
        // 2. Verificar SPEDs de 2025
        console.log('=== SPEDs DE 2025 ===\n');
        const spedsResult = await pool.query(
            `SELECT id, periodo_apuracao FROM sped_arquivos 
             WHERE id_empresa = $1 AND periodo_apuracao LIKE '2025%' 
             ORDER BY periodo_apuracao`,
            [empresa.id]
        );
        
        if (spedsResult.rows.length === 0) {
            console.log('❌ Nenhum SPED de 2025 encontrado para MARCOS AURELIO');
            process.exit(1);
        }
        
        console.log(`✓ ${spedsResult.rows.length} SPEDs encontrados:\n`);
        const speds = spedsResult.rows;
        speds.forEach(s => console.log(`   ${s.periodo_apuracao} (ID: ${s.id})`));
        
        // 3. Verificar dados LMC para cada SPED
        console.log('\n=== DADOS LMC ===\n');
        for (const sped of speds) {
            const lmcCount = await pool.query(
                'SELECT COUNT(*) as cnt FROM lmc_movimentacao WHERE id_sped_arquivo = $1',
                [sped.id]
            );
            console.log(`${sped.periodo_apuracao}: ${lmcCount.rows[0].cnt} registros LMC`);
        }
        
        // 4. Verificar continuidade entre meses
        console.log('\n=== CONTINUIDADE DE ESTOQUE ===\n');
        
        for (let i = 0; i < speds.length - 1; i++) {
            const mesAtual = speds[i];
            const mesProximo = speds[i + 1];
            
            console.log(`\n${mesAtual.periodo_apuracao} → ${mesProximo.periodo_apuracao}:`);
            
            // Pegar último registro de combustível do mês anterior
            const fimMesAtual = await pool.query(
                `SELECT cod_item, descricao, fech_fisico_ajustado 
                 FROM lmc_movimentacao 
                 WHERE id_sped_arquivo = $1 AND fech_fisico_ajustado IS NOT NULL
                 ORDER BY data_movimento DESC 
                 LIMIT 10`,
                [mesAtual.id]
            );
            
            if (fimMesAtual.rows.length === 0) {
                console.log('   ⚠️  Sem dados LMC no final do mês anterior');
                continue;
            }
            
            // Pegar primeiro registro de combustível do mês seguinte
            const inicioMesProximo = await pool.query(
                `SELECT cod_item, descricao, estq_abert_ajustado 
                 FROM lmc_movimentacao 
                 WHERE id_sped_arquivo = $1 AND estq_abert_ajustado IS NOT NULL
                 ORDER BY data_movimento ASC 
                 LIMIT 10`,
                [mesProximo.id]
            );
            
            if (inicioMesProximo.rows.length === 0) {
                console.log('   ⚠️  Sem dados LMC no início do mês seguinte');
                continue;
            }
            
            // Comparar por cod_item
            let hasDiscrepancies = false;
            for (const itemAtual of fimMesAtual.rows) {
                const itemProximo = inicioMesProximo.rows.find(r => r.cod_item === itemAtual.cod_item);
                if (itemProximo) {
                    const diff = Math.abs(itemAtual.fech_fisico_ajustado - itemProximo.estq_abert_ajustado);
                    if (diff > 0.5) {
                        console.log(`   ⚠️  Item ${itemAtual.cod_item} (${itemAtual.descricao})`);
                        console.log(`       Fechamento ${mesAtual.periodo_apuracao}: ${itemAtual.fech_fisico_ajustado}L`);
                        console.log(`       Abertura ${mesProximo.periodo_apuracao}: ${itemProximo.estq_abert_ajustado}L`);
                        console.log(`       Diferença: ${diff.toFixed(2)}L`);
                        hasDiscrepancies = true;
                    }
                }
            }
            
            if (!hasDiscrepancies) {
                console.log('   ✓ Continuidade OK');
            }
        }
        
        await pool.end();
    } catch (err) {
        console.error('Erro:', err.message);
        process.exit(1);
    }
}

verificarContinuidade();
