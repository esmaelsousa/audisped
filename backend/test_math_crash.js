require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool();

async function run() {
    const id_arquivo = 343; // current file uploaded by user
    const cod_item = '3'; // failed product
    const volume_alvo = 5000;

    // Simular a matematica exata da rota
    const { rows: items } = await pool.query(`SELECT * FROM lmc_movimentacao WHERE id_sped_arquivo = $1 AND cod_item = $2 ORDER BY data_mov ASC`, [id_arquivo, cod_item]);
    const capacidadeTanque = 0;

    let volumeAntigoTotal = 0;
    items.forEach(i => { volumeAntigoTotal += parseFloat(i.vol_saidas || 0); });
    const targetReal = parseFloat(volume_alvo);
    const rFactor = volumeAntigoTotal > 0 ? (targetReal / volumeAntigoTotal) : 1;
    const limitRatio = 0.0050;

    const aberturaInicial = parseFloat(items[0].estq_abert_ajustado ?? items[0].estq_abert ?? 0);
    let calcs = items.map(row => ({
        id: row.id,
        data_mov: row.data_mov,
        entradasOrig: parseFloat(row.vol_entr || 0),
        entradasCalc: parseFloat(row.vol_entr || 0),
        saidaOrig: parseFloat(row.vol_saidas || 0),
        saidaCalc: 0,
        abertCalc: 0,
        escrCalc: 0,
        fisicoCalc: 0,
        perdaCalc: 0,
        ganhoCalc: 0,
        isLocked: false
    }));

    let runningAbertura = aberturaInicial;
    for (let i = 0; i < calcs.length; i++) {
        let day = calcs[i];
        day.saidaCalc = day.saidaOrig;
        day.abertCalc = runningAbertura;
        day.escrCalc = day.abertCalc + day.entradasCalc - day.saidaCalc;
        day.fisicoCalc = day.escrCalc;
        runningAbertura = day.fisicoCalc;
    }

    let iter = 0;
    while (iter < 150) {
        iter++;
        let currentTotalSaida = calcs.reduce((acc, c) => acc + c.saidaCalc, 0);
        let diff = targetReal - currentTotalSaida;
        if (Math.abs(diff) <= 0.5) break;

        runningAbertura = aberturaInicial;
        let minFisicoFuturo = new Array(calcs.length);
        for (let i = 0; i < calcs.length; i++) {
            let day = calcs[i];
            day.abertCalc = runningAbertura;
            day.escrCalc = day.abertCalc + day.entradasCalc - day.saidaCalc;
            day.fisicoCalc = day.escrCalc;
            runningAbertura = day.fisicoCalc;
        }

        let minVal = Infinity;
        for (let i = calcs.length - 1; i >= 0; i--) {
            if (calcs[i].fisicoCalc < minVal) minVal = calcs[i].fisicoCalc;
            minFisicoFuturo[i] = minVal;
        }

        if (diff > 0) {
            let diasElegiveis = calcs.map((c, i) => ({ day: c, idx: i, minFuturo: minFisicoFuturo[i] }))
                .filter(x => !x.day.isLocked && x.minFuturo >= 0.5);
            if (diasElegiveis.length === 0) { console.log('ZEREI ELEGIVEIS diff > 0'); break; }
            let cotaIteracao = Math.max(diff * 0.2, 5);
            let maxDistribuir = Math.min(diff, cotaIteracao);
            let totalSalesElegiveis = diasElegiveis.reduce((acc, x) => acc + (x.day.saidaOrig > 0 ? x.day.saidaOrig : 1), 0);

            for (let x of diasElegiveis) {
                let proportion = (x.day.saidaOrig > 0 ? x.day.saidaOrig : 1) / totalSalesElegiveis;
                let tentativaTirar = maxDistribuir * proportion;
                let tirar = Math.min(tentativaTirar, minFisicoFuturo[x.idx]);
                x.day.saidaCalc += tirar;
                for (let j = x.idx; j < calcs.length; j++) {
                    minFisicoFuturo[j] -= tirar;
                }
            }
        } else {
            break;
        }
    }

    // Passo 4
    function getRandomNoise(margin) { return (Math.random() * 2 * margin) - margin; }

    const updates = [];
    runningAbertura = aberturaInicial;

    for (let i = 0; i < calcs.length; i++) {
        let day = calcs[i];
        day.abertCalc = runningAbertura;
        if (day.saidaCalc < 0) day.saidaCalc = 0;
        if (day.entradasCalc < 0) day.entradasCalc = 0;

        day.escrCalc = day.abertCalc + day.entradasCalc - day.saidaCalc;

        let volBase = day.abertCalc + day.entradasCalc;
        let margemRuidoL = volBase * (limitRatio * 0.8);
        let ruido = getRandomNoise(margemRuidoL);

        let fisicoSemLimit = day.escrCalc + ruido;
        if (fisicoSemLimit < 0) fisicoSemLimit = 0;

        let maxDiffANP = volBase * 0.0055;
        let diffCalculada = fisicoSemLimit - day.escrCalc;

        if (Math.abs(diffCalculada) > maxDiffANP) {
            if (diffCalculada < 0) diffCalculada = -maxDiffANP;
            else diffCalculada = maxDiffANP;
            fisicoSemLimit = day.escrCalc + diffCalculada;
        }

        if (capacidadeTanque > 0 && fisicoSemLimit > capacidadeTanque) {
            fisicoSemLimit = capacidadeTanque - 0.001;
        }

        day.fisicoCalc = parseFloat(fisicoSemLimit.toFixed(3));
        if (isNaN(day.fisicoCalc)) {
            console.log("CRASHED AT", day);
        }

        updates.push({ fisico: day.fisicoCalc });
        runningAbertura = day.fisicoCalc;
    }
    console.log(updates.slice(0, 5));
    process.exit();
}
run().catch(console.error);
