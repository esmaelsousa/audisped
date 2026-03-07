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
function costurarEAssinar(arquivoSpedPath, registrosBloco0, registrosBlocoC) {
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
                // --- INJEÇÃO BLOCO 0: Respeitar hierarquia por tipo de registro ---
                // Separar os novos registros por tipo
                const novos0150 = registrosBloco0.filter(l => l.startsWith('|0150|'));
                const novos0190 = registrosBloco0.filter(l => l.startsWith('|0190|'));
                const novos0200 = registrosBloco0.filter(l => l.startsWith('|0200|'));

                // Função auxiliar: encontra o último índice de um tipo de registro no Bloco 0
                function ultimoIndice(prefixo) {
                    let idx = -1;
                    for (let i = 0; i < linhasOriginal.length; i++) {
                        if (linhasOriginal[i].startsWith('|0990|')) break; // Fim do Bloco 0
                        if (linhasOriginal[i].startsWith(prefixo)) idx = i;
                    }
                    return idx;
                }

                // Injeta 0200 depois do último 0200 existente (ou antes do 0990)
                // Fazemos de baixo pra cima para não deslocar os índices
                function injetarAposUltimo(novosRegistros, prefixo, fallbackPrefixo) {
                    if (novosRegistros.length === 0) return;
                    let idx = ultimoIndice(prefixo);
                    if (idx === -1) {
                        // Não existe tipo no arquivo, busca posição do tipo anterior como fallback
                        idx = fallbackPrefixo ? ultimoIndice(fallbackPrefixo) : -1;
                    }
                    if (idx === -1) {
                        // Último recurso: injeta antes do 0990
                        idx = linhasOriginal.findIndex(l => l.startsWith('|0990|'));
                        if (idx === -1) idx = linhasOriginal.length - 1;
                        linhasOriginal.splice(idx, 0, ...novosRegistros);
                    } else {
                        linhasOriginal.splice(idx + 1, 0, ...novosRegistros);
                    }
                }

                // Ordem correta: 0150 → 0190 → 0200 (injetar de baixo pra cima para não deslocar)
                injetarAposUltimo(novos0200, '|0200|', '|0190|');
                injetarAposUltimo(novos0190, '|0190|', '|0150|');
                injetarAposUltimo(novos0150, '|0150|', null);

                // --- INJEÇÃO BLOCO C: antes do C990 ---
                let idxC990 = linhasOriginal.findIndex(l => l.startsWith('|C990|'));

                if (idxC990 !== -1 && registrosBlocoC.length > 0) {
                    linhasOriginal.splice(idxC990, 0, ...registrosBlocoC);
                } else if (idxC990 === -1 && registrosBlocoC.length > 0) {
                    let novaInjecaoPos = linhasOriginal.findIndex(l => l.startsWith('|0990|')) + 1;
                    const blocoCCompleto = [
                        '|C001|0|',
                        ...registrosBlocoC,
                        '|C990|0|'
                    ];
                    linhasOriginal.splice(novaInjecaoPos, 0, ...blocoCCompleto);
                }

                // Fase 4: Recalculo de assinaturas
                const linhasFinais = recalcularAssinaturasBlocos(linhasOriginal);
                resolve(linhasFinais);
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Wrapper de exportação da injeção que pode ser chamado diretamente na Rota REST
 */
async function injetarXmlEPersistir(fullSpedPath, dataPayloadFase2) {
    const linhasProcessadas = await costurarEAssinar(fullSpedPath, dataPayloadFase2.bloco0, dataPayloadFase2.blocoC);

    // Gerar um ArrayBuffer/String ou Salvar temporário
    const joinedSped = linhasProcessadas.join('\r\n') + '\r\n'; // EOF Break no fim
    return joinedSped;
}

module.exports = {
    injetarXmlEPersistir
};
