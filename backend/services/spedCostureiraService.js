const fs = require('fs');
const readline = require('readline');
const logger = require('../logger');

/**
 * Recalcula as contagens de todos os blocos do arquivo de acordo com as regras do PVA.
 * @param {Array<string>} linhas Array de linhas do SPED
 */
function recalcularAssinaturasBlocos(linhas) {
    let counts = {
        '0': 0, 'C': 0, 'D': 0, 'E': 0, 'G': 0, 'H': 0, '1': 0, '9': 0
    };

    // Contagem por tipo de registro (para o 9900)
    const countsPorReg = {};

    // Primeira passada: contar blocos e registros individuais
    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        if (!linha || !linha.startsWith('|')) continue;

        const fields = linha.split('|');
        const reg = fields[1];
        if (!reg) continue;

        const blocoId = reg.charAt(0);
        if (counts[blocoId] !== undefined) {
            counts[blocoId]++;
        }

        // Conta cada tipo de registro para o 9900
        if (!countsPorReg[reg]) countsPorReg[reg] = 0;
        countsPorReg[reg]++;
    }

    // Segunda passada: atualizar fechamentos de bloco e 9900
    let totalLinhasGeral = 0;

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        if (!linha || !linha.startsWith('|')) continue;

        const fields = linha.split('|');
        const reg = fields[1];

        if (reg === '0990') {
            linhas[i] = `|0990|${counts['0']}|`;
        } else if (reg === 'C990') {
            linhas[i] = `|C990|${counts['C']}|`;
        } else if (reg === 'D990') {
            linhas[i] = `|D990|${counts['D']}|`;
        } else if (reg === 'E990') {
            linhas[i] = `|E990|${counts['E']}|`;
        } else if (reg === 'G990') {
            linhas[i] = `|G990|${counts['G']}|`;
        } else if (reg === 'H990') {
            linhas[i] = `|H990|${counts['H']}|`;
        } else if (reg === '1990') {
            linhas[i] = `|1990|${counts['1']}|`;
        } else if (reg === '9990') {
            linhas[i] = `|9990|${counts['9']}|`;
        } else if (reg === '9900') {
            // Atualiza cada linha |9900|REG_X|QTD| com a contagem real
            const regAlvo = fields[2];
            if (regAlvo && countsPorReg[regAlvo] !== undefined) {
                linhas[i] = `|9900|${regAlvo}|${countsPorReg[regAlvo]}|`;
            }
        }

        totalLinhasGeral++;
    }

    // Atualiza 9999 com total geral
    for (let i = linhas.length - 1; i >= 0; i--) {
        if (linhas[i].startsWith('|9999|')) {
            linhas[i] = `|9999|${totalLinhasGeral}|`;
            break;
        }
    }

    return linhas;
}

/**
 * Injeta os novos registros calculados da Fase 2 dentro de um array do SPED txt.
 */
function costurarEAssinar(arquivoSpedPath, registrosBloco0, registrosBlocoC, chavesParaSubstituir = []) {
    return new Promise((resolve, reject) => {
        const inputStream = fs.createReadStream(arquivoSpedPath, { encoding: 'latin1' });
        const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

        let linhasOriginal = [];

        rl.on('line', (line) => {
            linhasOriginal.push(line);
        });

        rl.on('error', (err) => {
            reject(err);
        });

        rl.on('close', () => {
            try {
                // Normaliza o arquivo removendo linhas em branco (alguns softwares contábeis
                // geram SPED com \r\n\r\n entre linhas, o que causaria CRLF duplo na saída)
                linhasOriginal = linhasOriginal.filter(l => l.trim() !== '');

                // Extrai a data final do período a partir do registro 0000 (campo 5, formato DDMMAAAA)
                let dtFimPeriodo = null;
                for (const l of linhasOriginal) {
                    if (l.startsWith('|0000|')) {
                        const f = l.split('|');
                        if (f[5] && f[5].length === 8) dtFimPeriodo = f[5]; // ex: "31012021"
                        break;
                    }
                }

                // Corrige registros H005 com DT_INV após a data final do período
                if (dtFimPeriodo) {
                    for (let i = 0; i < linhasOriginal.length; i++) {
                        if (!linhasOriginal[i].startsWith('|H005|')) continue;
                        const f = linhasOriginal[i].split('|');
                        const dtInv = f[2]; // DDMMAAAA
                        if (dtInv && dtInv.length === 8) {
                            // Converte DDMMAAAA → número comparável AAAAMMDD
                            const toNum = d => parseInt(d.substring(4, 8) + d.substring(2, 4) + d.substring(0, 2));
                            if (toNum(dtInv) > toNum(dtFimPeriodo)) {
                                f[2] = dtFimPeriodo;
                                linhasOriginal[i] = f.join('|');
                                logger.info(`H005 DT_INV corrigida: ${dtInv} → ${dtFimPeriodo}`);
                            }
                        }
                    }
                }

                if (chavesParaSubstituir && chavesParaSubstituir.length > 0) {
                    let novasLinhas = [];
                    let pular = false;
                    for (let i = 0; i < linhasOriginal.length; i++) {
                        const linha = linhasOriginal[i];
                        if (!linha || !linha.startsWith('|')) { novasLinhas.push(linha); continue; }
                        
                        const fields = linha.split('|');
                        const reg = fields[1];
                        
                        if (reg === 'C100') {
                            const chave = fields[9]; // chv_nfe
                            pular = chavesParaSubstituir.includes(chave);
                        } else if (reg && reg.startsWith('C1')) {
                            // C1xx are children of C100, we keep `pular` as true if we are skipping the parent C100
                            // Note: C100 itself is caught above. 
                        } else {
                            // Any other record (C400, C500, C001, C990, D100, etc.) resets `pular`
                            pular = false; 
                        }
                        
                        if (!pular) {
                            novasLinhas.push(linha);
                        }
                    }
                    linhasOriginal = novasLinhas;
                }

                // --- CONFIGURAÇÃO DE HIERARQUIA ---
                const HIERARQUIA = {
                    '0150': ['0175'],
                    '0200': ['0205', '0206', '0210', '0220'],
                    'C100': ['C101', 'C110', 'C111', 'C112', 'C113', 'C114', 'C115', 'C116', 'C120', 'C130', 'C140', 'C141', 'C170', 'C171', 'C172', 'C173', 'C174', 'C175', 'C176', 'C177', 'C178', 'C179', 'C190', 'C191', 'C195', 'C197'],
                };


                function ultimoIndiceBloco(linhas, bloco) {
                    for (let i = linhas.length - 1; i >= 0; i--) {
                        if (linhas[i].startsWith(`|${bloco}`)) return i;
                    }
                    return -1;
                }

                // --- PREPARAÇÃO DOS DADOS ---
                const existentes0150 = new Set();
                const existentes0190 = new Set();
                const existentes0200 = new Set();

                for (const l of linhasOriginal) {
                    if (l.startsWith('|0150|')) existentes0150.add(l.split('|')[2]);
                    if (l.startsWith('|0190|')) existentes0190.add(l.split('|')[2]);
                    if (l.startsWith('|0200|')) existentes0200.add(l.split('|')[2]);
                }

                const novos0150 = registrosBloco0.filter(l => l.startsWith('|0150|') && !existentes0150.has(l.split('|')[2]));
                const novos0190 = registrosBloco0.filter(l => l.startsWith('|0190|') && !existentes0190.has(l.split('|')[2]));
                const novos0200 = registrosBloco0.filter(l => l.startsWith('|0200|') && !existentes0200.has(l.split('|')[2]));

                // --- INJEÇÃO BLOCO 0 ---
                const injetar = (novos, prefixo) => {
                    if (novos.length === 0) return;
                    
                    let lastIdx = -1;
                    for (let i = 0; i < linhasOriginal.length; i++) {
                        if (linhasOriginal[i].startsWith(`|${prefixo}|`)) lastIdx = i;
                    }

                    if (lastIdx !== -1) {
                        const filhos = HIERARQUIA[prefixo] || [];
                        let current = lastIdx;
                        while (current + 1 < linhasOriginal.length) {
                            const prox = (linhasOriginal[current + 1].split('|')[1] || '');
                            if (filhos.includes(prox)) {
                                current++;
                            } else {
                                break;
                            }
                        }
                        linhasOriginal.splice(current + 1, 0, ...novos);
                    } else {
                        let idxInjecao = linhasOriginal.findIndex(l => {
                            const reg = l.split('|')[1];
                            if (!reg || reg.length !== 4) return false;
                            if (reg[0] !== prefixo[0]) return false;
                            return reg > prefixo;
                        });
                        
                        if (idxInjecao === -1) {
                            const bloco = prefixo[0];
                            idxInjecao = linhasOriginal.findIndex(l => l.startsWith(`|${bloco}990|`));
                        }
                        
                        if (idxInjecao === -1) {
                            idxInjecao = ultimoIndiceBloco(linhasOriginal, prefixo[0]);
                        }
                        
                        if (idxInjecao !== -1) {
                            linhasOriginal.splice(idxInjecao, 0, ...novos);
                        } else {
                            // Fallback total: antes do 9900/9999
                            const pos9999 = linhasOriginal.findIndex(l => l.startsWith('|9999|'));
                            linhasOriginal.splice(pos9999 !== -1 ? pos9999 : linhasOriginal.length, 0, ...novos);
                        }
                    }
                };

                injetar(novos0150, '0150');
                injetar(novos0190, '0190');
                injetar(novos0200, '0200');

                // --- INJEÇÃO BLOCO C ---
                if (registrosBlocoC.length > 0) {
                    const idxC990 = linhasOriginal.findIndex(l => l.startsWith('|C990|'));
                    if (idxC990 !== -1) {
                        injetar(registrosBlocoC, 'C100');
                    } else {
                        // Se o bloco C não existe no arquivo original (ex: empresa sem movimento anterior)
                        const pos0990 = linhasOriginal.findIndex(l => l.startsWith('|0990|'));
                        // No SPED ICMS/IPI, o Bloco C vem logo após o Bloco 0 (e seu fechamento 0990)
                        const blocoC = ['|C001|0|', ...registrosBlocoC, '|C990|0|'];
                        linhasOriginal.splice(pos0990 + 1, 0, ...blocoC);
                    }
                }

                const linhasFinais = recalcularAssinaturasBlocos(linhasOriginal);
                resolve(linhasFinais);
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Gera um conteúdo de arquivo SPED contendo apenas os blocos 0 e C extraídos,
 * útil quando não há um arquivo base para injeção.
 */
function gerarSpedFragmentado(registrosBloco0, registrosBlocoC) {
    const linhas = [];
    
    // Header 0000 Simplificado (AUDISPED EJETADO)
    linhas.push("|0000|015|0|01012026|31012026|AUDISPED STANDALONE EJECTION|00000000000000||MT|EXEMPLO|5103403|||A|1|");
    
    // Bloco 0
    linhas.push(...registrosBloco0);
    if (!linhas.some(l => l.startsWith("|0990|"))) {
        linhas.push("|0990|0|"); 
    }
    
    // Bloco C
    linhas.push("|C001|0|");
    linhas.push(...registrosBlocoC);
    linhas.push("|C990|0|"); 
    
    // Bloco 9 (Mínimo necessário para recalcularAssinaturas funcionar e gerar algo legível)
    linhas.push("|9001|0|");
    // Placeholders que serão preenchidos pelo recalcularAssinaturasBlocos
    const regsUnicos = [...new Set(linhas.map(l => l.split('|')[1]))];
    regsUnicos.forEach(r => {
        if (r && r !== '9900' && r !== '9990' && r !== '9999' && r !== '') {
            linhas.push(`|9900|${r}|1|`);
        }
    });
    linhas.push("|9900|9900|1|");
    linhas.push("|9900|9990|1|");
    linhas.push("|9900|9999|1|");

    linhas.push("|9990|0|");
    linhas.push("|9999|0|");

    // Recalcula todas as contagens (incluindo os 9900 que acabamos de criar)
    const linhasFinais = recalcularAssinaturasBlocos(linhas);
    return linhasFinais.join('\r\n') + '\r\n';
}

/**
 * Wrapper de exportação da injeção que pode ser chamado diretamente na Rota REST
 */
async function injetarXmlEPersistir(fullSpedPath, dataPayloadFase2, chavesParaSubstituir = []) {
    const linhasProcessadas = await costurarEAssinar(fullSpedPath, dataPayloadFase2.bloco0, dataPayloadFase2.blocoC, chavesParaSubstituir);

    // Gerar um ArrayBuffer/String ou Salvar temporário
    const joinedSped = linhasProcessadas.join('\r\n') + '\r\n'; // EOF Break no fim
    return joinedSped;
}

module.exports = {
    injetarXmlEPersistir,
    gerarSpedFragmentado
};
