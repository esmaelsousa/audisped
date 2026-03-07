
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

// Helper para ruído orgânico
function getRandomNoise(margin) {
    // Math.random() retorna de 0 a 1.
    // Queremos de -margin a +margin
    const noise = (Math.random() * 2 * margin) - margin;
    return noise;
}

async function runOptimization(arquivoId, codItem, targetVolume) {
    let client;
    try {
        client = await pool.connect();

        // 1. Obter capacidade do tanque (se existir)
        const capRes = await client.query(`
            SELECT c.capacidade 
            FROM lmc_tanques_config c
            JOIN sped_arquivos a ON a.cnpj_empresa = c.cnpj
            WHERE a.id = $1 AND c.cod_item = $2
        `, [arquivoId, codItem]);
        const capacidadeTanque = capRes.rows.length > 0 ? parseFloat(capRes.rows[0].capacidade || 0) : 0;

        // 2. Buscar LMC para o item (ordenado por dia)
        const res = await client.query(`
            SELECT * FROM lmc_movimentacao 
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            ORDER BY data_mov ASC
        `, [arquivoId, codItem]);

        const items = res.rows;
        if (items.length === 0) {
            console.log("Nenhum registro encontrado.");
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
        console.log(`Fator de Redução/Aumento: ${rFactor.toFixed(4)}`);

        // 4. Aplicar em Cascata
        let runningAbertura = parseFloat(items[0].estq_abert || 0);
        const limitRatio = 0.0045; // 0.45% de variação orgânica

        console.log('\n--- SIMULAÇÃO DE OTIMIZAÇÃO ---');
        console.log('Data | Abertura | Entradas | Saídas(S\') | Escr(E) | Fisico(F\') | Ruído | Var(%) | Status');

        const updates = [];

        for (let i = 0; i < items.length; i++) {
            const row = items[i];
            const entradas = parseFloat(row.vol_entr || 0);
            const perda = parseFloat(row.val_perda || 0);
            const ganho = parseFloat(row.val_ganho || 0);
            const saidaOriginal = parseFloat(row.vol_saidas || 0);

            // Nova Saída
            let novaSaida = saidaOriginal * rFactor;

            // Tratamento de capacidade (opcional: se o tanque encher, forçamos mais saída e compensamos depois?)
            // O ideal é a matemática bruta primeiro:
            const volBase = runningAbertura + entradas;
            const E = volBase - novaSaida - perda + ganho;

            // Margem Limite para ruído (0.45% de VolBase)
            const margemSegura = volBase * limitRatio;
            let ruido = getRandomNoise(margemSegura);

            let F_linha = E + ruido;

            // Restrição 1: Não pode ser negativo
            if (F_linha < 0) {
                F_linha = 0;
                ruido = F_linha - E;
            }

            // Restrição 2: Não pode bater a capacidade do tanque (se definida)
            // Se houver capacidade e o Físico estourar, limitamos
            let excStatus = '';
            if (capacidadeTanque > 0 && F_linha > capacidadeTanque) {
                // Ao invés de estourar a capacidade, capamos no teto do tanque.
                // Mas perceba: se a F_linha bater a capacidade, teremos que recalcular o ruído
                // para ficar dentro do permitido. Se ainda assim estourar, o usuário precisará vender mais
                // ou ter um tanque maior.
                const difParaTeto = capacidadeTanque - E;
                // Ex: Se E já é > CapacidadeTanque, estamos em apuros (precisamos aumentar saída desse dia)
                if (difParaTeto < -margemSegura) {
                    excStatus = '[! ESTOURO DE TANQUE INEVITÁVEL !]';
                    // Vamos forçar a saída a subir para caber no tanque, para salvar o dia
                    const excessoAbsoluto = E - capacidadeTanque;
                    novaSaida += excessoAbsoluto + 1; // Força tirar combustivel
                    // recalcula E
                    const newE = volBase - novaSaida - perda + ganho;
                    F_linha = capacidadeTanque - (Math.random() * 10); // Ligeiramente abaixo do teto
                    ruido = F_linha - newE;
                } else if (difParaTeto < margemSegura) {
                    // Podemos salvar só ajustando o ruído para não passar
                    F_linha = capacidadeTanque - (Math.random() * 10);
                    ruido = F_linha - E;
                }
            }

            // E final se recalculado:
            const finalE = volBase - novaSaida - perda + ganho;

            const difLitre = F_linha - finalE;
            const varPerc = volBase > 0 ? (Math.abs(difLitre) / volBase) * 100 : 0;
            const dt = new Date(row.data_mov).toISOString().split('T')[0];

            console.log(`${dt} | ${runningAbertura.toFixed(0)} | ${entradas.toFixed(0)} | ${novaSaida.toFixed(1)} | ${finalE.toFixed(1)} | ${F_linha.toFixed(1)} | ${ruido.toFixed(1)} | ${varPerc.toFixed(2)}% | ${excStatus}`);

            updates.push({
                id: row.id,
                vol_saidas_ajustado: novaSaida,
                fech_fisico_ajustado: F_linha
            });

            // Prepara próximo dia
            runningAbertura = F_linha;
        }

        // Se quiser persistir no banco (por enquanto só visual)
        /*
        await client.query('BEGIN');
        for (const u of updates) {
            await client.query(
                'UPDATE lmc_movimentacao SET vol_saidas_ajustado = $1, fech_fisico_ajustado = $2 WHERE id = $3',
                [u.vol_saidas_ajustado, u.fech_fisico_ajustado, u.id]
            );
        }
        await client.query('COMMIT');
        */

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('Erro:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

// Supondo Arquivo ID 297, Combustível '1' (Gasolina Comum)
// A soma base de vendas deve ser próxima a 100k, vamos ver:
runOptimization(297, '1', 80000); 
