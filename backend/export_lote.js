const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('[FATAL] JWT_SECRET não definido no ambiente.'); process.exit(1); }
const TOKEN = jwt.sign({ id: 1, nome: 'admin', email: 'admin@audisped.com' }, SECRET, { expiresIn: '24h' });

const IDS = [1326,1327,1328,1330,1331,1332,1333,1334,1520,1336,1337,1338,1340,1341,1343,1344,1345,1346,1347,1396,1397,1398,1399,1400,1401,1402,1403,1407,1408,1410,1411,1412,1413,1414,1415,1416,1417,1418,1419,1420,1421,1422,1423,1430,1431,1432,1433,1434,1435,1436,1437,1438,1439,1440,1441,1442,1443,1444,1445,1446];
const OUTPUT_DIR = '/Users/esmael/meus_sistemas/audisped/speds/lote';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function exportarArquivo(id, index) {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost', port: 15435,
            path: '/api/exportar-sped/' + id, method: 'GET',
            headers: { 'Authorization': 'Bearer ' + TOKEN }
        }, (res) => {
            const disposition = res.headers['content-disposition'] || '';
            const match = disposition.match(/filename=([^;]+)/);
            let filename = match ? decodeURIComponent(match[1]).replace(/[^a-zA-Z0-9_\-\.]/g, '_') : id + '.txt';
            if (!filename.endsWith('.txt')) filename += '.txt';
            const filePath = path.join(OUTPUT_DIR, filename);
            console.log('  DEBUG: disposition=' + disposition.substring(0,80) + ' → file=' + filename);
            const file = fs.createWriteStream(filePath);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log('[' + (index+1) + '/' + IDS.length + '] ' + filename + ' (HTTP ' + res.statusCode + ')');
                resolve();
            });
        });
        req.on('error', (e) => { console.error('ERRO id=' + id + ': ' + e.message); resolve(); });
        req.end();
    });
}

async function run() {
    console.log('Exportando ' + IDS.length + ' arquivos para ' + OUTPUT_DIR);
    console.log('Inicio: ' + new Date().toLocaleTimeString());
    for (let i = 0; i < IDS.length; i++) {
        await exportarArquivo(IDS[i], i);
        await new Promise(r => setTimeout(r, 3000)); // 3s entre cada
    }
    console.log('Fim: ' + new Date().toLocaleTimeString());
    console.log('CONCLUIDO!');
}
run();
