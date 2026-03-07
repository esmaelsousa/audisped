
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

async function checkRouteLogic() {
    let client;
    try {
        client = await pool.connect();
        const arquivoId = 297;

        const query = `
            WITH notas_entrada AS (
                SELECT 
                    item.cod_item,
                    c100.dt_e_s as data_entrada,
                    SUM(item.qtd) as volume_nota,
                    json_agg(json_build_object(
                        'num_doc', c100.num_doc,
                        'data', c100.dt_e_s,
                        'qtd', item.qtd,
                        'fornecedor', part.nome
                    )) as nfs_detalhadas
                FROM documentos_itens_c170 item
                JOIN documentos_c100 c100 ON item.id_documento_c100 = c100.id
                LEFT JOIN sped_participantes part ON part.cod_part = c100.cod_part AND part.id_sped_arquivo = c100.id_sped_arquivo
                WHERE c100.id_sped_arquivo = $1 
                  AND c100.ind_oper = '0' 
                  AND (
                      item.cfop LIKE '165%' OR 
                      item.cfop LIKE '265%' OR 
                      item.cfop LIKE '065%' OR 
                      item.cfop LIKE '65%' OR
                      item.cfop LIKE '116%' OR 
                      item.cfop LIKE '216%'
                  )
                GROUP BY item.cod_item, c100.dt_e_s
            ),
            lmc_entrada AS (
                SELECT 
                    cod_item,
                    data_mov,
                    SUM(estq_abert) as estq_abert,
                    SUM(vol_entr) as vol_entr,
                    SUM(vol_saidas) as vol_saidas,
                    SUM(vol_saidas_ajustado) as vol_saidas_ajustado,
                    SUM(val_perda) as val_perda,
                    SUM(val_ganho) as val_ganho,
                    SUM(estq_escr) as estq_escr,
                    SUM(fech_fisico) as fech_fisico,
                    SUM(fech_fisico_ajustado) as fech_fisico_ajustado
                FROM lmc_movimentacao
                WHERE id_sped_arquivo = $1
                GROUP BY cod_item, data_mov
            )
            SELECT 
                COALESCE(l.cod_item, n.cod_item) as cod_item,
                COALESCE(p.descr_item, l.cod_item, n.cod_item) as nome_combustivel,
                COALESCE(l.data_mov, n.data_entrada) as data_movimento,
                COALESCE(l.estq_abert, 0) as estq_abert,
                COALESCE(l.vol_entr, 0) as vol_entr_lmc,
                COALESCE(n.volume_nota, 0) as volume_nota,
                COALESCE(n.nfs_detalhadas, '[]'::json) as nfs_detalhadas,
                COALESCE(l.vol_saidas, 0) as vol_saidas,
                l.vol_saidas_ajustado,
                COALESCE(l.val_perda, 0) as val_perda,
                COALESCE(l.val_ganho, 0) as val_ganho,
                COALESCE(l.estq_escr, 0) as estq_escr,
                COALESCE(l.fech_fisico, 0) as fech_fisico,
                l.fech_fisico_ajustado,
                COALESCE(cfg.capacidade, 0) as capacidade_tanque
            FROM lmc_entrada l
            FULL OUTER JOIN notas_entrada n ON l.cod_item = n.cod_item AND (l.data_mov::date = n.data_entrada::date)
            LEFT JOIN sped_produtos p ON p.id_sped_arquivo = $1 AND p.cod_item = COALESCE(l.cod_item, n.cod_item)
            LEFT JOIN sped_arquivos arq ON arq.id = $1
            LEFT JOIN lmc_tanques_config cfg ON cfg.cnpj = arq.cnpj_empresa AND cfg.cod_item = COALESCE(l.cod_item, n.cod_item)
            ORDER BY nome_combustivel, data_movimento;
        `;

        const { rows } = await client.query(query, [arquivoId]);

        const porCombustivel = {};
        rows.forEach(row => {
            if (!porCombustivel[row.cod_item]) porCombustivel[row.cod_item] = [];
            porCombustivel[row.cod_item].push(row);
        });

        const lmcFinal = [];
        Object.keys(porCombustivel).forEach(codItem => {
            const items = porCombustivel[codItem].sort((a, b) => new Date(a.data_movimento) - new Date(b.data_movimento));
            let runningAbertura = null;

            items.forEach((row, index) => {
                const abertOriginal = parseFloat(row.estq_abert || 0);
                const abertCascata = index === 0 ? abertOriginal : runningAbertura;
                const saida = row.vol_saidas_ajustado !== null ? parseFloat(row.vol_saidas_ajustado) : parseFloat(row.vol_saidas || 0);
                const fisico = row.fech_fisico_ajustado !== null ? parseFloat(row.fech_fisico_ajustado) : parseFloat(row.fech_fisico || 0);
                const entr = parseFloat(row.vol_entr_lmc || 0);
                const cap = parseFloat(row.capacidade_tanque || 0);
                const perda_orig = parseFloat(row.val_perda || 0);
                const ganho_orig = parseFloat(row.val_ganho || 0);

                const escrCalculadoBase = abertCascata + entr - saida;
                const escrSpedOriginal = parseFloat(row.estq_escr || 0);
                const escrFinal = (row.vol_saidas_ajustado !== null) ? (escrCalculadoBase - perda_orig + ganho_orig) : escrSpedOriginal;

                const diffLitre = fisico - escrFinal;
                const volumeBase = abertCascata + entr;
                const varPerc = volumeBase > 0 ? (Math.abs(diffLitre) / volumeBase) * 100 : 0;
                runningAbertura = fisico;

                let status = 'CONFORME';
                if (varPerc > 0.60) status = 'FORA LIMITE';
                if (escrFinal < -0.01 || fisico < -0.01) status = 'NEGATIVO';
                if (cap > 0 && fisico > cap) status = 'EXCESSO';

                lmcFinal.push({
                    ...row,
                    estq_abert_final: abertCascata,
                    vol_saidas_final: saida,
                    fech_fisico_final: fisico,
                    estq_escr_final: escrFinal,
                    val_perda: perda_orig,
                    val_ganho: ganho_orig,
                    variacao_litros: diffLitre,
                    variacao_percentual: varPerc,
                    status_anp: status
                });
            });
        });

        console.log(`LMC Final gerado: ${lmcFinal.length} linhas.`);
        if (lmcFinal.length > 0) {
            console.table(lmcFinal.slice(0, 10));
        }

    } catch (err) {
        console.error('ERRO NA LÓGICA DA ROTA:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

checkRouteLogic();
