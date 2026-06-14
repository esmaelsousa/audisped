// Validador SPED — parser PURO (sem IO, sem banco). Recebe o conteúdo .txt (latin1) e
// devolve um modelo indexado para as regras. Não altera nada; só lê.
function parseSped(content) {
    const linhas = [];
    const porReg = new Map();
    let versao = '', dtIni = '', dtFin = '', cnpj = '', uf = '';
    let n = 0;
    for (const r of String(content).split(/\r?\n/)) {
        if (!r || r[0] !== '|') continue;
        const f = r.split('|');           // f[0]='' , f[1]=REG, …, último '' (pipe final)
        const reg = f[1];
        if (!reg) continue;
        n++;
        const obj = { n, raw: r, reg, f };
        linhas.push(obj);
        if (!porReg.has(reg)) porReg.set(reg, []);
        porReg.get(reg).push(obj);
        if (reg === '0000') {
            versao = f[2] || '';
            dtIni = f[4] || '';
            dtFin = f[5] || '';
            cnpj = (f[7] || '').replace(/\D/g, '');
            uf = f[9] || '';
        }
    }
    const periodoYM = (dtIni && dtIni.length === 8) ? (dtIni.slice(4, 8) + dtIni.slice(2, 4)) : '';
    const blocos = new Set(linhas.map(l => l.reg[0]));
    return { versao, dtIni, dtFin, cnpj, uf, periodoYM, linhas, porReg, blocos, totalLinhas: linhas.length };
}

module.exports = { parseSped };
