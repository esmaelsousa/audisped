const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

// Helper para ruído orgânico
function getRandomNoise(margin) {
    const noise = (Math.random() * 2 * margin) - margin;
    return noise;
}

async function runOptimization(arquivoId, codItem, targetVolume) {
    let client;
    try {
        client = await pool.connect();

        console.log(`\n>>> Iniciando Otimização LMC - Arquivo: ${arquivoId}, Item: ${codItem}, Alvo: ${targetVolume}L`);

        // 1. Obter capacidade do tanque
        const capRes = await client.query(`
            SELECT c.capacidade 
            FROM lmc_tanques_config c
            JOIN sped_arquivos a ON a.cnpj_empresa = c.cnpj
            WHERE a.id = $1 AND c.cod_item = $2
        `, [arquivoId, codItem]);
        const capacidadeTanque = capRes.rows.length > 0 ? parseFloat(capRes.rows[0].capacidade || 0) : 0;
        console.log(`Capacidade do Tanque: ${capacidadeTanque > 0 ? capacidadeTanque + 'L' : 'Não definida'}`);

        // 2. Buscar LMC para o item
        const res = await client.query(`
            SELECT * FROM lmc_movimentacao 
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            ORDER BY data_mov ASC
        `, [arquivoId, codItem]);

        const items = res.rows;
        if (items.length === 0) {
            console.log("❌ Nenhum registro de movimentação encontrado para este item.");
            return;
        }

        // 3. Somar volume antigo
        let volumeAntigoTotal = 0;
        items.forEach(i => {
            volumeAntigoTotal += parseFloat(i.vol_saidas || 0);
        });

        console.log(`Volume Original Total: ${volumeAntigoTotal.toFixed(3)} L`);
        console.log(`Volume Alvo: ${targetVolume.toFixed(3)} L`);

        const rFactor = volumeAntigoTotal > 0 ? (targetVolume / volumeAntigoTotal) : 1;
        console.log(`Fator de Ajuste: ${rFactor.toFixed(4)}`);

        // 4. Calcular Cascata com Persistência
        await client.query('BEGIN');
        
        let runningAbertura = parseFloat(items[0].estq_abert || 0);
        const limitRatio = 0.0045; // 0.45% de variação aceitável

        for (let i = 0; i < items.length; i++) {
            const row = items[i];
            const entradas = parseFloat(row.vol_entr || 0);
            const perda = parseFloat(row.val_perda || 0);
            const ganho = parseFloat(row.val_ganho || 0);
            const saidaOriginal = parseFloat(row.vol_saidas || 0);

            // 4.1 Nova Saída (Ajustada pelo fator)
            let novaSaida = saidaOriginal * rFactor;

            // 4.2 Cálculo do Estoque Escritural (E)
            let volBase = runningAbertura + entradas;
            let E = volBase - novaSaida - perda + ganho;

            // 4.3 Tratamento de Estouro de Tanque (Se E > Capacidade)
            if (capacidadeTanque > 0 && E > capacidadeTanque) {
                const excesso = E - (capacidadeTanque * 0.98); // Deixa 2% de folga
                novaSaida += excesso;
                E = volBase - novaSaida - perda + ganho;
            }

            // 4.4 Ruído Orgânico para o Físico (F')
            const margemSegura = volBase * limitRatio;
            let ruido = getRandomNoise(margemSegura);
            let F_linha = E + ruido;

            // Restrições finais
            if (F_linha < 0) F_linha = 0;
            if (capacidadeTanque > 0 && F_linha > capacidadeTanque) F_linha = capacidadeTanque - (Math.random() * 5);

            // 4.5 Persistência nas colunas _ajustado
            await client.query(`
                UPDATE lmc_movimentacao 
                SET vol_saidas_ajustado = $1, 
                    fech_fisico_ajustado = $2,
                    estq_abert_ajustado = $3
                WHERE id = $4
            `, [
                novaSaida, 
                F_linha, 
                runningAbertura, 
                row.id
            ]);

            // Avança para o próximo dia
            runningAbertura = F_linha;
        }

        await client.query('COMMIT');
        console.log(`✅ Otimização concluída e persistida com sucesso para o item ${codItem}.`);

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('❌ Erro durante a otimização:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

// Argumentos via CLI: node optimize_lmc.js <id_arquivo> <cod_item> <target_volume>
const args = process.argv.slice(2);
if (args.length < 3) {
    console.log("Uso: node optimize_lmc.js <id_arquivo> <cod_item> <target_volume>");
    process.exit(1);
}

runOptimization(parseInt(args[0]), args[1], parseFloat(args[2]));
