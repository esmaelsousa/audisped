const fs = require('fs');
const pdf = require('pdf-parse');

let dataBuffer = fs.readFileSync('/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/speds/erro_auditoria.pdf');

pdf(dataBuffer).then(function(data) {
    console.log(data.text);
}).catch(function(error) {
    console.log("ERRO AO LER PDF:", error);
});
