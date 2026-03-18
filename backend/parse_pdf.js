const fs = require('fs');
const { PDFParse } = require('pdf-parse');

(async () => {
    try {
        let dataBuffer = fs.readFileSync('/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/speds/erro 1300 e 1310.pdf');
        const parser = new PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        await parser.destroy();
        console.log(result.text);
    } catch (error) {
        console.error("Erro processando PDF:", error);
    }
})();
