const fs = require('fs');

const fileBuffer = fs.readFileSync('/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/speds/RETIFICADO_SPED_FISCAL-10.txt', 'latin1');
const lines = fileBuffer.split('\n');

console.log("Dias relatados c/ quebra de regra ANP no Etanol:");
for (const line of lines) {
    if (line.startsWith('|1300|2|1511') || line.startsWith('|1300|2|2211') || line.startsWith('|1300|2|2911')) {
        console.log(line);
    }
}
