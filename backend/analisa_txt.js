const fs = require('fs');

const fileBuffer = fs.readFileSync('/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/speds/RETIFICADO_SPED_FISCAL-9.txt', 'latin1');
const lines = fileBuffer.split('\n');

const violations = [];

for (const line of lines) {
    if (line.startsWith('|1300|2|') || line.startsWith('|1310|')) {
        const parts = line.split('|');
        // Para 1300, parts[2] é o codigo '2'
        if (parts[1] === '1300' && parts[2] === '2') {
            const data = parts[3];
            const fisico = parseFloat(parts[10].replace(',', '.'));
            if (fisico > 5000) {
                violations.push({ line, tipo: '1300', data, fisico });
            }
        } else if (parts[1] === '1310') {
            // precisaríamos saber de qual 1300 é, mas vamos assumir que o anterior era 1300|2 pra simplificar se a numeração for sequencial, mas 1310 nao tem cod item. 
            // Vamos olhar apenas pro Fech_Fisico no 1310 (parts[10])
            const fisico = parseFloat(parts[10].replace(',', '.'));
            if (fisico > 5000) {
                violations.push({ line, tipo: '1310', tanque: parts[2], fisico });
            }
        }
    }
}

console.log(`Encontradas ${violations.length} violações > 5000:`);
console.table(violations.slice(0, 20));
