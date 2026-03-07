// Simulacao do motor
let capacidadeTanque = 15000;
let limitCorte = capacidadeTanque * 0.99; // 14850
let calcs = [
  { entradasOrig: 10000, entradasCalc: 10000, saidaOrig: 5604, saidaCalc: 4518 },
  { entradasOrig: 5000, entradasCalc: 5000, saidaOrig: 4506, saidaCalc: 3633 }
];
let aberturaInicial = 10000; // assumindo
let precisaRecalcular = true;
let loopGuard = 0;
let estourouTanque = false;

while (precisaRecalcular && loopGuard < 10) {
    precisaRecalcular = false;
    loopGuard++;
    let runningAbertura = aberturaInicial;

    for (let i = 0; i < calcs.length; i++) {
        let day = calcs[i];
        day.abertCalc = runningAbertura;
        day.escrCalc = day.abertCalc + day.entradasCalc - day.saidaCalc;
        day.fisicoCalc = day.escrCalc;

        if (day.fisicoCalc > limitCorte) {
            estourouTanque = true;
            let excesso = (day.fisicoCalc - limitCorte) + 0.1;
            console.log(`Loop \${loopGuard} Dia \${i} estourou. Físico: \${day.fisicoCalc}, excesso: \${excesso}`);
            
            if (day.entradasCalc >= excesso) {
                day.entradasCalc -= excesso;
                console.log(`Abateu de entrada: nova entrada \${day.entradasCalc}`);
            } else {
                let residuo = excesso - day.entradasCalc;
                console.log(`Zerei entrada. Sobrou residuo: \${residuo}`);
                day.entradasCalc = 0;
                day.saidaCalc += residuo;
            }

            day.entradasCalc = parseFloat(day.entradasCalc.toFixed(3));
            day.saidaCalc = parseFloat(day.saidaCalc.toFixed(3));

            day.escrCalc = day.abertCalc + day.entradasCalc - day.saidaCalc;
            day.fisicoCalc = day.escrCalc;
            day.isLocked = true; 

            precisaRecalcular = true; 
        }
        runningAbertura = day.fisicoCalc;
    }
}
console.log('Result Squeeze:', calcs);
console.log('Loop guard:', loopGuard);

// Pass 4
let runningAbertura4 = aberturaInicial;
for (let i = 0; i < calcs.length; i++) {
    let day = calcs[i];
    day.abertCalc = runningAbertura4;
    day.escrCalc = day.abertCalc + day.entradasCalc - day.saidaCalc;
    let volBase = day.abertCalc + day.entradasCalc;
    let ruido = volBase * 0.002;
    let fisicoSemLimit = day.escrCalc + ruido;

    if (capacidadeTanque > 0 && fisicoSemLimit > capacidadeTanque) {
        console.log(`Pass 4 Day \${i} travado na boca do tanque.`);
        fisicoSemLimit = capacidadeTanque - 0.001; 
    }
    day.fisicoCalc = parseFloat(fisicoSemLimit.toFixed(3));
    runningAbertura4 = day.fisicoCalc;
}
console.log('Result Pass 4:', calcs);
