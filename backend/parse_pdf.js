const fs = require('fs');
const pdf = require('pdf-parse');

let dataBuffer = fs.readFileSync('../speds/erro_sped10.pdf');

pdf(dataBuffer).then(function (data) {
    console.log(data.text);
}).catch(console.error);
