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

    // Segunda passada: atualizar fechamentos de bloco e 9900 existentes
    const existentes9900 = new Set(); // regAlvo já cobertos por |9900|
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
                existentes9900.add(regAlvo);
            }
        }

        totalLinhasGeral++;
    }

    // Inserir |9900|REG|QTD| para tipos de registro que existem no arquivo
    // mas não têm cobertura no bloco 9 (ex: 0220 injetado após injeção original).
    const faltando = Object.keys(countsPorReg).filter(r => !existentes9900.has(r));
    if (faltando.length > 0) {
        const idx9990 = linhas.findIndex(l => l.startsWith('|9990|'));
        if (idx9990 !== -1) {
            const novas9900 = faltando.map(r => `|9900|${r}|${countsPorReg[r]}|`);
            linhas.splice(idx9990, 0, ...novas9900);

            const N = novas9900.length;
            totalLinhasGeral += N;
            counts['9'] += N;

            // |9900|9900| agora precisa refletir o total acrescido
            const novo9900Count = (countsPorReg['9900'] || 0) + N;
            for (let i = 0; i < linhas.length; i++) {
                if (linhas[i].startsWith('|9900|9900|')) {
                    linhas[i] = `|9900|9900|${novo9900Count}|`;
                    break;
                }
            }
            // Atualizar |9990| com o novo total do bloco 9
            for (let i = 0; i < linhas.length; i++) {
                if (linhas[i].startsWith('|9990|')) {
                    linhas[i] = `|9990|${counts['9']}|`;
                    break;
                }
            }
        }
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
 * Detecta C170 cujas unidades diferem do UNID_INV do 0200 correspondente e injeta
 * registros 0220 (conversão de unidade) como filhos do 0200, evitando o erro PVA:
 * "Se o campo de Unidade deste registro for diferente do campo Unidade do registro 0200,
 *  é obrigatório que o registro 0200 possua um filho 0220."
 */
function injetar0220ParaUnidadesDivergentes(linhas) {
    // Mapa: cod_item → unid_inv do 0200 presente no arquivo
    const unidade0200 = new Map();
    for (const l of linhas) {
        if (!l.startsWith('|0200|')) continue;
        const f = l.split('|');
        // Layout 0200: REG|COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|...
        if (f[2] && f[6]) unidade0200.set(f[2], f[6]);
    }

    if (unidade0200.size === 0) return;

    // Coleta unidades alternativas necessárias: cod_item → Set<unid_c170>
    const alternativas = new Map();
    for (const l of linhas) {
        if (!l.startsWith('|C170|')) continue;
        const f = l.split('|');
        // Layout C170: REG|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|...
        const codItem  = f[3];
        const unidC170 = f[6];
        const unidInv  = unidade0200.get(codItem);
        if (unidInv && unidC170 && unidC170 !== unidInv) {
            if (!alternativas.has(codItem)) alternativas.set(codItem, new Set());
            alternativas.get(codItem).add(unidC170);
        }
    }

    if (alternativas.size === 0) return;

    // Para cada 0200 com mismatch, encontra o fim dos filhos existentes e injeta 0220
    const filhos0200 = new Set(['0205', '0206', '0210', '0220']);
    for (let i = 0; i < linhas.length; i++) {
        if (!linhas[i].startsWith('|0200|')) continue;
        const codItem = linhas[i].split('|')[2];
        if (!alternativas.has(codItem)) continue;

        // Avança até o fim dos filhos já existentes do 0200
        let j = i + 1;
        const existing0220 = new Set();
        while (j < linhas.length) {
            const reg = (linhas[j].split('|')[1] || '');
            if (!filhos0200.has(reg)) break;
            if (reg === '0220') existing0220.add(linhas[j].split('|')[2]); // UNID_CONV já presente
            j++;
        }

        // Injeta 0220 apenas para unidades ainda não presentes
        const novos0220 = [];
        for (const unidAlt of alternativas.get(codItem)) {
            if (!existing0220.has(unidAlt)) {
                // |0220|UNID_CONV|FAT_CONV|COD_BARRA|  — 4 campos (COD_BARRA vazio), igual ao ERP.
                // O PVA exige os 4 campos; sem o último '|' dava "número de campos difere do leiaute".
                novos0220.push(`|0220|${unidAlt}|1,0000||`);
                logger.info(`0220 injetado: 0200[${codItem}] UNID_INV=${unidade0200.get(codItem)} ≠ C170 UNID=${unidAlt}`);
            }
        }
        if (novos0220.length > 0) {
            linhas.splice(j, 0, ...novos0220);
            i += novos0220.length; // ajusta índice para não reprocessar os recém-inseridos
        }
    }
}

/**
 * Gera o bloco E200 (Período da Apuração do ICMS-ST por UF) + E210 (Apuração) quando há
 * lançamento de ICMS-ST no arquivo (C170/C190 com VL_ICMS_ST > 0) e o bloco E200 está AUSENTE.
 * O PVA exige o E200 sempre que houver ICMS-ST; revendedor/substituído gera apuração ZERADA
 * (IND_MOV_ST=0). O VL_RETENCAO_ST real (se o contribuinte for substituto) é preenchido depois,
 * no recálculo do E210 durante a exportação. Inserido ANTES do recálculo de contadores, então
 * recalcularAssinaturasBlocos atualiza E990/9900/9990/9999 automaticamente.
 */
function injetarE200E210SeNecessario(linhas) {
    let temIcmsSt = false, temE200 = false, uf = '', dtIni = '', dtFin = '';
    for (const l of linhas) {
        if (!l || l[0] !== '|') continue;
        const f = l.split('|');
        const reg = f[1];
        if (reg === '0000') { dtIni = f[4] || ''; dtFin = f[5] || ''; uf = f[9] || ''; }
        else if (reg === 'E200') { temE200 = true; }
        else if (reg === 'C190' || reg === 'C590' || reg === 'D590') {
            // VL_ICMS_ST = campo 9 do C190/C590/D590
            if (parseFloat(String(f[9] || '0').replace(',', '.')) > 0) temIcmsSt = true;
        } else if (reg === 'C170') {
            // VL_ICMS_ST = campo 18 do C170
            if (parseFloat(String(f[18] || '0').replace(',', '.')) > 0) temIcmsSt = true;
        }
    }
    if (!temIcmsSt || temE200 || !uf) return;

    const idxE990 = linhas.findIndex(l => l.startsWith('|E990|'));
    if (idxE990 === -1) return; // sem bloco E aberto — não força estrutura

    // E200|UF|DT_INI|DT_FIN|  (4 campos) ; E210|IND_MOV_ST + 13 valores zerados (15 campos)
    const e200 = `|E200|${uf}|${dtIni}|${dtFin}|`;
    const e210 = `|E210|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`;
    linhas.splice(idxE990, 0, e200, e210);
    logger.info(`E200/E210 gerado (UF ${uf}, ${dtIni}-${dtFin}) — havia ICMS-ST sem bloco E200.`);
}

/**
 * Lógica central de processamento e injeção de registros no SPED.
 * Pode ser chamada tanto com linhas lidas do disco quanto com linhas já em memória.
 */
function processarLinhas(linhasOriginal, registrosBloco0, registrosBlocoC, chavesParaSubstituir = [], registrosBlocoD = []) {
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
                // filho de C100, mantém o estado de `pular`
            } else {
                // qualquer outro registro (C400, D100, etc.) encerra o pulo
                pular = false;
            }

            if (!pular) novasLinhas.push(linha);
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
                if (filhos.includes(prox)) { current++; } else { break; }
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

    // --- INJEÇÃO BLOCO D ---
    if (registrosBlocoD.length > 0) {
        const idxD990 = linhasOriginal.findIndex(l => l.startsWith('|D990|'));
        if (idxD990 !== -1) {
            // Bloco D já existe — injeta antes do fechamento D990
            linhasOriginal.splice(idxD990, 0, ...registrosBlocoD);
            // Garante que D001 indique movimento (IND_MOV=0)
            const idxD001 = linhasOriginal.findIndex(l => l.startsWith('|D001|'));
            if (idxD001 !== -1) linhasOriginal[idxD001] = '|D001|0|';
        } else {
            // Bloco D não existe — cria após C990
            const idxC990 = linhasOriginal.findIndex(l => l.startsWith('|C990|'));
            const blocoD = ['|D001|0|', ...registrosBlocoD, '|D990|0|'];
            const posInsercao = idxC990 !== -1 ? idxC990 + 1 : linhasOriginal.length;
            linhasOriginal.splice(posInsercao, 0, ...blocoD);
        }
    }

    recalcularE110(linhasOriginal);
    recalcularE210(linhasOriginal);
    injetar0220ParaUnidadesDivergentes(linhasOriginal);
    injetarE200E210SeNecessario(linhasOriginal);

    return recalcularAssinaturasBlocos(linhasOriginal);
}

/**
 * Recalcula o registro E110 (apuração ICMS regular) com base nos registros analíticos do arquivo.
 *
 * Layout E110 (campos de dados):
 *  f[2]  VL_TOT_DEBITOS          ← calculado: soma VL_ICMS de C190/C590/D190/D590 CFOP 5xx/6xx
 *  f[4]  VL_TOT_AJ_DEBITOS       ← f[2] + f[3]
 *  f[6]  VL_TOT_CREDITOS         ← calculado: soma VL_ICMS de C190/C590/D190/D590 CFOP 1xx(≠1605)/2xx/3xx/5605
 *  f[8]  VL_TOT_AJ_CREDITOS      ← f[6] + f[7]
 *  f[11] VL_SLD_APURADO          ← f[4] + f[5] - f[8] - f[9] - f[10]
 *  f[13] VL_ICMS_RECOLHER        ← max(0, f[11] - f[12])
 *  f[14] VL_SLD_CREDOR_TRANSPORTAR ← max(0, f[12] - f[11])
 * Campos f[3],f[5],f[7],f[9],f[10],f[12],f[15] são preservados do original.
 */
function recalcularE110(linhas) {
    const idxE110 = linhas.findIndex(l => l.startsWith('|E110|'));
    if (idxE110 === -1) return;

    function parseSped(str) {
        return parseFloat((str || '0').replace(',', '.')) || 0;
    }
    function fmtSped(val) {
        return val.toFixed(2).replace('.', ',');
    }

    // Soma VL_ICMS de C190/C590/D190/D590 — mesmo algoritmo que o PVA usa para validar E110.
    // CFOP 1xx (exceto 1605), 2xx, 3xx, 5605 → crédito (entradas com ICMS)
    // CFOP 5xx (exceto 5605), 6xx             → débito (saídas com ICMS)
    let somaCreditos = 0;
    let somaDebitos  = 0;
    let sitAtual = '00';
    for (const l of linhas) {
        if (l.startsWith('|C100|') || l.startsWith('|C500|') ||
            l.startsWith('|D100|') || l.startsWith('|D500|')) {
            sitAtual = l.split('|')[6] || '00';
            continue;
        }

        if (!l.startsWith('|C190|') && !l.startsWith('|C590|') &&
            !l.startsWith('|D190|') && !l.startsWith('|D590|')) continue;

        // Documentos cancelados ou denegados não compõem apuração de ICMS
        if (['02', '03', '04', '05'].includes(sitAtual)) continue;

        const c = l.split('|');
        const cfop    = c[3] || '';
        const vlIcms  = parseSped(c[7]); // VL_ICMS está em c[7] nestes layouts
        if (cfop === '5605' || cfop.startsWith('2') || cfop.startsWith('3') ||
            (cfop.startsWith('1') && cfop !== '1605')) {
            somaCreditos += vlIcms;
        } else if ((cfop.startsWith('5') && cfop !== '5605') || cfop.startsWith('6') || cfop.startsWith('7')) {
            somaDebitos += vlIcms;
        }
    }

    const f = linhas[idxE110].split('|');

    const vlAjDebitos    = parseSped(f[3]);
    const vlEstornosCred = parseSped(f[5]);
    const vlAjCreditos   = parseSped(f[7]);
    const vlEstornosDeb  = parseSped(f[9]);
    const vlSldCredAnt   = parseSped(f[10]);
    const vlTotDed       = parseSped(f[12]);

    f[2]  = fmtSped(somaDebitos);
    f[4]  = fmtSped(vlAjDebitos);                  // VL_TOT_AJ_DEBITOS = soma dos E111 outros débitos (não inclui VL_TOT_DEBITOS)
    f[6]  = fmtSped(somaCreditos);
    f[8]  = fmtSped(vlAjCreditos);                 // VL_TOT_AJ_CREDITOS = soma dos E111 créditos (não inclui VL_TOT_CREDITOS)

    // VL_SLD_APURADO = VL_TOT_DEBITOS + VL_TOT_AJ_DEBITOS + VL_ESTORNOS_CRED
    //                - VL_TOT_CREDITOS - VL_TOT_AJ_CREDITOS - VL_ESTORNOS_DEB - VL_SLD_CRED_ANT_EX
    const rawSaldo = somaDebitos + parseSped(f[4]) + vlEstornosCred
                   - somaCreditos - parseSped(f[8]) - vlEstornosDeb - vlSldCredAnt;

    // VL_SLD_APURADO nunca pode ser negativo:
    //   rawSaldo > 0 → saldo devedor (empresa deve ICMS)
    //   rawSaldo <= 0 → saldo credor → f[11]=0, crédito vai para VL_SLD_CREDOR_TRANSPORTAR
    f[11] = fmtSped(Math.max(0, rawSaldo));

    const net = rawSaldo - vlTotDed;
    f[13] = fmtSped(Math.max(0,  net));       // VL_ICMS_RECOLHER: max(0, saldo devedor - deduções)
    f[14] = fmtSped(Math.max(0, -rawSaldo));  // VL_SLD_CREDOR_TRANSPORTAR: só > 0 quando credor

    linhas[idxE110] = f.join('|');
    logger.info(`E110 recalculado: VL_TOT_DEBITOS=${f[2]}, VL_TOT_CREDITOS=${f[6]}, VL_SLD_APURADO=${f[11]}, VL_ICMS_RECOLHER=${f[13]}, VL_SLD_CREDOR_TRANSPORTAR=${f[14]}`);
}

/**
 * Recalcula o registro E210 (apuração ICMS ST) com base nos C190 do arquivo.
 *
 * Layout E210 conforme PVA vigente (validado pelo relatório de erros do PVA):
 *  f[6]  VL_OUT_CRED_ST   ← soma VL_ICMS_ST de C190 CFOP 1xx/2xx + E220 créditos
 *  f[8]  VL_RETENCAO_ST   ← calculado: soma VL_ICMS_ST de C190/C590/C690/D590/D690 CFOP 5xx/6xx + C791
 *                            (campo 8 per PVA — NÃO é VL_TOTAL_CRED_ST)
 *  f[13] VL_TOTAL_DEB_ST        ← f[8]+f[9]+f[10]+f[11]+f[12]
 *  f[14] VL_SLD_CRED_ST_TRANSPORTAR ← max(0, VL_TOTAL_CRED_ST - f[13])
 *  f[15] VL_SLD_DEV_ST          ← max(0, f[13] - VL_TOTAL_CRED_ST)
 *                            onde VL_TOTAL_CRED_ST = f[3]+f[4]+f[5]+f[6]+f[7]
 * Campos f[3],f[4],f[5],f[7],f[9],f[10],f[11],f[12] são preservados do original.
 */
function recalcularE210(linhas) {
    const idxE210 = linhas.findIndex(l => l.startsWith('|E210|'));
    if (idxE210 === -1) return;

    function parseSped(str) {
        return parseFloat((str || '0').replace(',', '.')) || 0;
    }
    function fmtSped(val) {
        return val.toFixed(2).replace('.', ',');
    }

    // Layout E210 (per PVA validado):
    // f[3]=VL_SLD_CRED_ANT_ST  f[4]=VL_DEVOL_ST      f[5]=VL_RESSARC_ST
    // f[6]=VL_OUT_CRED_ST      f[7]=VL_AJ_CRED_ST    f[8]=VL_RETENCAO_ST       ← CALCULAR
    // f[9]=VL_SLD_DEV_ANT_ST   f[10]=VL_DEB_ST        f[11]=VL_OUT_DEB_ST
    // f[12]=VL_AJ_DEB_ST       f[13]=VL_TOTAL_DEB_ST  f[14]=VL_SLD_CRED_ST_TRANSPORTAR  f[15]=VL_SLD_DEV_ST

    // VL_OUT_CRED_ST: soma VL_ICMS_ST de C190 CFOP 1xx/2xx (compras com ST no crédito)
    let somaEntrada = 0;
    let sitAtualEntrada = '00';
    for (const l of linhas) {
        if (l.startsWith('|C100|')) {
            sitAtualEntrada = l.split('|')[6] || '00';
            continue;
        }
        if (!l.startsWith('|C190|')) continue;
        if (['02', '03', '04', '05'].includes(sitAtualEntrada)) continue;

        const c = l.split('|');
        const cfop = c[3] || '';
        if (cfop.startsWith('1') || cfop.startsWith('2')) somaEntrada += parseSped(c[9]);
    }

    // E220 créditos adicionais (IND_AJ_ST iniciando com 'T')
    let somaE220Cred = 0;
    for (const l of linhas) {
        if (!l.startsWith('|E220|')) continue;
        const c = l.split('|');
        if ((c[2] || '').toUpperCase().startsWith('T')) somaE220Cred += parseSped(c[3]);
    }

    // VL_RETENCAO_ST: calculado igual ao PVA — soma VL_ICMS_ST de C190/C590/C690/D590/D690
    // onde CFOP começa com 5 ou 6, mais C791 (usando CFOP do pai C790).
    // Calcular (não preservar) garante que o valor sempre bate com a validação do PVA (erro 1937).
    let somaRetencao = 0;
    let currentC790Cfop = '';
    let sitAtualRetencao = '00';
    for (const l of linhas) {
        if (l.startsWith('|C100|') || l.startsWith('|C500|') || l.startsWith('|C600|') ||
            l.startsWith('|D100|') || l.startsWith('|D500|') || l.startsWith('|D600|')) {
            sitAtualRetencao = l.split('|')[6] || '00';
            continue;
        }

        if (l.startsWith('|C790|')) {
            const c = l.split('|');
            currentC790Cfop = c[3] || '';
        } else if (l.startsWith('|C791|')) {
            if (currentC790Cfop.startsWith('5') || currentC790Cfop.startsWith('6')) {
                const c = l.split('|');
                somaRetencao += parseSped(c[3]); // VL_ICMS_ST do C791
            }
        } else if (
            l.startsWith('|C190|') || l.startsWith('|C590|') ||
            l.startsWith('|C690|') || l.startsWith('|D590|') || l.startsWith('|D690|')
        ) {
            if (['02', '03', '04', '05'].includes(sitAtualRetencao)) continue;

            const c = l.split('|');
            const cfop = c[3] || '';
            if (cfop.startsWith('5') || cfop.startsWith('6')) somaRetencao += parseSped(c[9]);
        }
    }

    const f = linhas[idxE210].split('|');

    const vlSldCredAnt = parseSped(f[3]);
    const vlDevol      = parseSped(f[4]);
    const vlRessarc    = parseSped(f[5]);
    const vlAjCred     = parseSped(f[7]);

    // VL_OUT_CRED_ST: outros créditos ST (entradas CFOP 1xx/2xx + E220)
    f[6]  = fmtSped(somaEntrada + somaE220Cred);

    // VL_RETENCAO_ST (campo 8 per PVA): soma VL_ICMS_ST de C190/C590/C690/D590/D690 CFOP 5xx/6xx + C791
    // ATENÇÃO: PVA valida campo 8 como VL_RETENCAO_ST, não VL_TOTAL_CRED_ST
    f[8]  = fmtSped(somaRetencao);

    // VL_TOTAL_CRED_ST: calculado internamente para VL_SLD_DEV_ST, não ocupa campo próprio nesta versão do layout
    const vlTotalCredST = vlSldCredAnt + vlDevol + vlRessarc + parseSped(f[6]) + vlAjCred;

    // VL_TOTAL_DEB_ST = f[8..12] (f[13] no layout correto)
    const vlTotalDebST = parseSped(f[8]) + parseSped(f[9]) + parseSped(f[10]) + parseSped(f[11]) + parseSped(f[12]);
    f[13] = fmtSped(vlTotalDebST);
    // VL_SLD_CRED_ST_TRANSPORTAR: quando créditos superam débitos, transporta para mês seguinte
    f[14] = fmtSped(Math.max(0, vlTotalCredST - vlTotalDebST));
    // VL_SLD_DEV_ST: quando débitos superam créditos, valor a recolher
    f[15] = fmtSped(Math.max(0, vlTotalDebST - vlTotalCredST));

    linhas[idxE210] = f.join('|');
    logger.info(`E210 recalculado: VL_OUT_CRED_ST=${f[6]}, VL_RETENCAO_ST(f8)=${f[8]}, VL_TOTAL_DEB_ST=${f[13]}, VL_SLD_CRED_TRANSP=${f[14]}, VL_SLD_DEV_ST=${f[15]}`);
}

/**
 * Injeta os novos registros calculados da Fase 2 dentro de um arquivo SPED txt (lê do disco).
 */
function costurarEAssinar(arquivoSpedPath, registrosBloco0, registrosBlocoC, chavesParaSubstituir = [], registrosBlocoD = []) {
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
                resolve(processarLinhas(linhasOriginal, registrosBloco0, registrosBlocoC, chavesParaSubstituir, registrosBlocoD));
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Versão in-memory de costurarEAssinar — recebe linhas já carregadas em memória.
 * Usada para encadear múltiplos grupos de injeção sem acessos adicionais ao disco.
 */
function costurarEAssinarLinhas(linhasJaLidas, registrosBloco0, registrosBlocoC, chavesParaSubstituir = [], registrosBlocoD = []) {
    try {
        return Promise.resolve(processarLinhas([...linhasJaLidas], registrosBloco0, registrosBlocoC, chavesParaSubstituir, registrosBlocoD));
    } catch (err) {
        return Promise.reject(err);
    }
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

    injetarE200E210SeNecessario(linhas);
    // Recalcula todas as contagens (incluindo os 9900 que acabamos de criar)
    const linhasFinais = recalcularAssinaturasBlocos(linhas);
    return linhasFinais.join('\r\n') + '\r\n';
}

/**
 * Wrapper de exportação da injeção que pode ser chamado diretamente na Rota REST
 */
async function injetarXmlEPersistir(fullSpedPath, dataPayloadFase2, chavesParaSubstituir = []) {
    const linhasProcessadas = await costurarEAssinar(fullSpedPath, dataPayloadFase2.bloco0, dataPayloadFase2.blocoC, chavesParaSubstituir, dataPayloadFase2.blocoD || []);

    // Gerar um ArrayBuffer/String ou Salvar temporário
    const joinedSped = linhasProcessadas.join('\r\n') + '\r\n'; // EOF Break no fim
    return joinedSped;
}

/**
 * Reposiciona registros 0221 (item atômico) para que cada um seja filho DIRETO
 * do seu 0200 correto — aquele cujo COD_ITEM == COD_ITEM_ATOMICO do 0221.
 *
 * Corrige o erro do PVA:
 *   "O valor deve existir no campo COD_ITEM de um registro pai 0200 com TIPO_ITEM
 *    '00 - Mercadoria para Revenda' e que possua um único registro filho 0221 com
 *    o COD_ITEM_ATOMICO igual ao campo COD_ITEM do registro pai."
 *
 * Trata DOIS mecanismos que geram esse erro:
 *  (a) ERP emite o 0221 fora de ordem (após OUTRO 0200) → o PVA o associa ao 0200
 *      anterior errado. Movemos o 0221 para o fim do grupo de filhos do seu 0200 correto.
 *  (b) O filtro de 0200 do export remove um item SEM MOVIMENTO, mas o 0221 daquele item
 *      fica órfão (0200 inexistente). Nesse caso o 0221 é DESCARTADO (inválido p/ o PVA;
 *      o item já não está no arquivo, então não há dado fiscal a preservar).
 * Garante "um único" 0221 por 0200 (se o pai já tem um, o realocado é descartado).
 * Quando não há nada a corrigir, retorna o array original (byte-idêntico). Contagens do
 * bloco 0 são recalculadas no fim do export (não dependem desta função).
 */
function realocar0221(linhas) {
    // 1) COD_ITEM -> existe 0200?
    const cods0200 = new Set();
    for (const l of linhas) {
        const f = l.split('|');
        if (f[1] === '0200') cods0200.add(f[2]);
    }
    if (cods0200.size === 0) return linhas;

    // 2) Classifica cada 0221: descartar órfão (0200 inexistente), realocar (0200 existe
    //    mas o 0221 está sob outro pai) ou manter (já sob o pai correto).
    const childRegs = new Set(['0205', '0206', '0210', '0220', '0221']);
    const idxRemover = new Set();  // 0221 a remover (órfãos a descartar + os a realocar)
    const porCodMover = new Map(); // COD_ITEM_ATOMICO -> linha 0221 a reinserir (só os que têm 0200)
    let paiAtual = null;
    for (let i = 0; i < linhas.length; i++) {
        const f = linhas[i].split('|');
        const reg = f[1];
        if (reg === '0200') { paiAtual = f[2]; continue; }
        if (reg === '0221') {
            const codAtomico = f[2];
            if (!cods0200.has(codAtomico)) {
                // órfão: o 0200 do item não existe (ex.: item sem movimento foi filtrado
                // do export) → o 0221 é inválido p/ o PVA; descartar (não reinserir).
                idxRemover.add(i);
            } else if (codAtomico !== paiAtual) {
                // fora de lugar, mas o 0200 correto existe → remover e realocar sob ele.
                idxRemover.add(i);
                if (!porCodMover.has(codAtomico)) porCodMover.set(codAtomico, linhas[i]);
            }
            // else: já está sob o pai correto → mantém intacto
        }
    }
    if (idxRemover.size === 0) return linhas; // nada a corrigir → byte-idêntico

    // 3) Remove os 0221 marcados e reinsere os realocáveis ao fim do grupo de filhos do seu 0200
    const semOrfaos = linhas.filter((_, i) => !idxRemover.has(i));
    const resultado = [];
    for (let i = 0; i < semOrfaos.length; i++) {
        resultado.push(semOrfaos[i]);
        const f = semOrfaos[i].split('|');
        if (f[1] === '0200') {
            const cod = f[2];
            let j = i + 1;
            let jaTem0221 = false;
            while (j < semOrfaos.length && childRegs.has(semOrfaos[j].split('|')[1])) {
                if (semOrfaos[j].split('|')[1] === '0221') jaTem0221 = true;
                resultado.push(semOrfaos[j]);
                j++;
            }
            // insere o 0221 realocado apenas se este 0200 ainda não tem um (regra "único")
            if (!jaTem0221 && porCodMover.has(cod)) resultado.push(porCodMover.get(cod));
            porCodMover.delete(cod);
            i = j - 1;
        }
    }
    return resultado;
}

/**
 * Normaliza entradas de USO/CONSUMO (CFOP 1407/1556/2407/2556) para CST_ICMS = x90 ("Outras"),
 * preservando o dígito de origem. Uso/consumo não gera crédito de ICMS (LC 87/96), então 90 é o
 * CST tecnicamente correto; 040 (isenta) só caberia em operação realmente isenta.
 *
 * Aplica em C170 (CST = campo 10) E C190 (CST = campo 2) para os dois baterem, evitando o erro PVA
 * "combinação CST_ICMS, CFOP, ALIQ_ICMS inválida". Depois, faz MERGE de C190 que passaram a ter a
 * mesma chave (CST|CFOP|ALIQ) dentro da mesma NF, somando os campos de valor (5..11) — o C190 é,
 * por definição, um único registro por chave.
 *
 * Se nenhum C170/C190 de uso/consumo precisa mudar, retorna o array original (byte-idêntico).
 * Não altera contagens diretamente — os totalizadores são recalculados no fim do export.
 */
function normalizarUsoConsumoCst90(linhas) {
    const USO = new Set(['1407', '1556', '2407', '2556']);
    const cst90 = (cst) => { const s = String(cst || '').padStart(3, '0'); return s.slice(0, 1) + '90'; };

    // 1) Relabel CST -> x90 em C170 e C190 de uso/consumo
    let mudou = false;
    for (let i = 0; i < linhas.length; i++) {
        const f = linhas[i].split('|');
        if (f[1] === 'C170' && f.length > 11 && USO.has(f[11])) {
            const novo = cst90(f[10]);
            if (f[10] !== novo) { f[10] = novo; linhas[i] = f.join('|'); mudou = true; }
        } else if (f[1] === 'C190' && f.length > 4 && USO.has(f[3])) {
            const novo = cst90(f[2]);
            if (f[2] !== novo) { f[2] = novo; linhas[i] = f.join('|'); mudou = true; }
        }
    }
    if (!mudou) return linhas; // nada de uso/consumo a normalizar → byte-idêntico

    // 2) Merge de C190 com a MESMA chave (CST|CFOP|ALIQ) dentro de cada NF (entre C100s)
    const out = [];
    let i = 0;
    while (i < linhas.length) {
        if (linhas[i].split('|')[1] !== 'C100') { out.push(linhas[i]); i++; continue; }
        out.push(linhas[i]); // o próprio C100
        let j = i + 1;
        const bloco = [];
        const idxPorChave = new Map(); // CST|CFOP|ALIQ -> índice em 'bloco'
        while (j < linhas.length && linhas[j].split('|')[1] !== 'C100') {
            const g = linhas[j].split('|');
            if (g[1] === 'C190') {
                const chave = `${g[2]}|${g[3]}|${g[4]}`;
                if (idxPorChave.has(chave)) {
                    const ex = bloco[idxPorChave.get(chave)].split('|');
                    for (let k = 5; k <= 11; k++) {
                        const a = parseFloat(String(ex[k] || '0').replace(',', '.')) || 0;
                        const b = parseFloat(String(g[k] || '0').replace(',', '.')) || 0;
                        ex[k] = (a + b).toFixed(2).replace('.', ',');
                    }
                    bloco[idxPorChave.get(chave)] = ex.join('|'); // funde a duplicata (não a adiciona)
                } else {
                    idxPorChave.set(chave, bloco.length);
                    bloco.push(linhas[j]);
                }
            } else {
                bloco.push(linhas[j]);
            }
            j++;
        }
        for (const b of bloco) out.push(b);
        i = j;
    }
    return out;
}

/**
 * Garante a coerência interna dos registros 1300 (produto) e 1310 (tanque):
 *   FECH_FISICO = ESTQ_ESCR - VAL_PERDA + VAL_GANHO   (regra do PVA).
 *
 * O motor de 1300 do export (flush1300Group) trava as saídas para o estoque não
 * ficar negativo (deixa ~0,001) mas mantém a perda original da LMC; quando a perda
 * excede o estoque travado, FECH ≠ ESCR-PERDA+GANHO e o PVA acusa
 * "Estoque de Fechamento deve ser igual ao Estoque Escritural menos Perda mais Ganho".
 *
 * Aqui, para cada 1300/1310 INCOERENTE, recalculamos PERDA/GANHO a partir de
 * (ESCR - FECH) — que é a definição fiscal de perda/ganho — MANTENDO o FECH (a
 * abertura do dia seguinte = FECH do anterior, então a cascata fica intacta).
 * Registros já coerentes não são tocados (byte-idêntico).
 *
 * Campos: 1300 → ESCR[8] PERDA[9] GANHO[10] FECH[11]; 1310 → ESCR[7] PERDA[8] GANHO[9] FECH[10].
 */
function enforcarCoerencia1300(linhas) {
    const num = (s) => parseFloat(String(s == null ? '0' : s).replace(',', '.')) || 0;
    const fmt = (v) => v.toFixed(3).replace('.', ',');
    for (let i = 0; i < linhas.length; i++) {
        const f = linhas[i].split('|');
        let iEscr, iPerda, iGanho, iFech;
        if (f[1] === '1300') { iEscr = 8; iPerda = 9; iGanho = 10; iFech = 11; }
        else if (f[1] === '1310') { iEscr = 7; iPerda = 8; iGanho = 9; iFech = 10; }
        else continue;
        if (f.length <= iFech) continue; // registro atípico/truncado: não mexe
        const escr = num(f[iEscr]), perda = num(f[iPerda]), ganho = num(f[iGanho]), fech = num(f[iFech]);
        const alvo = Number((escr - perda + ganho).toFixed(3));
        if (Math.abs(alvo - fech) <= 0.0005) continue; // já coerente → byte-idêntico
        const diff = Number((escr - fech).toFixed(3)); // ESCR - FECH = PERDA líquida
        f[iPerda] = fmt(diff > 0 ? diff : 0);
        f[iGanho] = fmt(diff < 0 ? -diff : 0);
        linhas[i] = f.join('|');
    }
    return linhas;
}

// ── Coerência Bloco H (inventário): VL_INV do H005 = Σ VL_ITEM dos H010 filhos ──────
// O export reescreve QTD/VL_ITEM de H010 de combustível para o estoque FÍSICO ajustado
// do LMC (server.js ~7978), mudando a soma dos itens — mas o total do H005 (VL_INV) não
// era recalculado, ficando defasado. PVA: "O valor total do estoque (VL_INV do H005) deve
// ser igual à soma dos valores dos itens (VL_ITEM) dos H010". VL_INV é um total DERIVADO →
// recalcula = Σ VL_ITEM dos H010 entre este H005 e o próximo H005 (H020 NÃO soma; H010 de
// split por IND_PROP somam todos). Só mexe quando o H005 tem ≥1 H010 (não zera total de
// inventário sem itens — completude é outro check). No-op byte-idêntico quando não há Bloco
// H ou o total já bate. Layout: H005 |H005|DT_INV|VL_INV|MOT_INV| (f[3]); H010 ...VL_ITEM=f[6].
function recalcularVlInvH005(linhas) {
    const num = (s) => parseFloat(String(s == null ? '0' : s).replace(',', '.')) || 0;
    let h005Idx = -1, somaCents = 0, nItens = 0;
    const fechar = () => {
        if (h005Idx < 0 || nItens === 0) return;
        const f = linhas[h005Idx].split('|');
        if (f.length > 3 && Math.round(num(f[3]) * 100) !== somaCents) {
            f[3] = (somaCents / 100).toFixed(2).replace('.', ',');
            linhas[h005Idx] = f.join('|');
        }
    };
    for (let i = 0; i < linhas.length; i++) {
        const reg = linhas[i].split('|')[1];
        if (reg === 'H005') { fechar(); h005Idx = i; somaCents = 0; nItens = 0; }
        else if (reg === 'H010' && h005Idx >= 0) {
            somaCents += Math.round(num(linhas[i].split('|')[6]) * 100);
            nItens++;
        }
    }
    fechar();
    return linhas;
}

// ── Injeção do registro 1360 (Lacres das bombas) ───────────────────────────────────
// O PVA exige ≥1 registro 1360 (Lacres) como filho de cada 1350 (bomba/medidor). Muitos
// ERPs omitem (caso CABECEIRINHA). A partir do cadastro lmc_lacres (CNPJ + série da bomba),
// injetamos o 1360 logo APÓS o 1350 e ANTES dos 1370 (bicos) — a hierarquia é 1350→1360→1370.
// NÃO duplica: se o 1350 já tem ao menos um 1360, pula. Layout: 1350 |1350|SERIE|FABR|MODELO|TIPO|
// (série = f[2]); 1360 |1360|NUM_LACRE|DT_APLICACAO| (data DDMMYYYY). mapLacres: Map<serie,[{num,dt}]>.
// Muta in-place; retorna nº de 1360 injetados (0 = byte-idêntico).
function injetarLacres1360(linhas, mapLacres) {
    if (!mapLacres || mapLacres.size === 0) return 0;
    let injetados = 0;
    for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].split('|')[1] !== '1350') continue;
        const serie = String(linhas[i].split('|')[2] || '').trim();
        const lacres = mapLacres.get(serie);
        if (!lacres || !lacres.length) continue;
        // Já há 1360 entre este 1350 e o próximo 1350? então não injeta (evita duplicar).
        let temLacre = false;
        for (let j = i + 1; j < linhas.length; j++) {
            const r = linhas[j].split('|')[1];
            if (r === '1350') break;
            if (r === '1360') { temLacre = true; break; }
        }
        if (temLacre) continue;
        const novos = lacres.map(l => `|1360|${String(l.num || '').trim()}|${String(l.dt || '').trim()}|`);
        linhas.splice(i + 1, 0, ...novos);
        injetados += novos.length;
        i += novos.length; // pula os recém-inseridos
    }
    return injetados;
}

// ── Coerência da Apuração ICMS (E110) a partir dos ajustes E111 ─────────────────────
// PVA: VL_TOT_AJ_DEBITOS (f4) = Σ E111 "outros débitos"; VL_TOT_AJ_CREDITOS (f8) = Σ "outros
// créditos"; VL_ESTORNOS_CRED (f5)=Σ estorno créd; VL_ESTORNOS_DEB (f9)=Σ estorno déb. A NATUREZA
// do ajuste é a 4ª posição do COD_AJ_APUR (validado em 4/4 arquivos BA reais via charAt(3); a 3ª
// posição falhou 0/4): '0'→f4, '1'→f5, '2'→f8, '3'→f9. Recalcula esses 4 e, EM CASCATA, o saldo:
//   base = (f2+f3+f4+f5) - (f6+f7+f8+f9) - f10(saldo credor anterior).
//   base>=0 (devedor): f11(SLD_APURADO)=base, f13(ICMS_RECOLHER)=max(0,base-f12+f15), f14=0.
//   base<0  (credor):  f11=0, f13=0, f14(SLD_CREDOR_TRANSPORTAR)=-base.
// Só altera o campo cujo VALOR (em centavos) muda → no-op byte-idêntico quando já coerente
// (validado: 379/400 arquivos da frota INALTERADOS; corrige os 21 que esqueceram de totalizar o E111).
// Layout E110 (1-idx): 2 TOT_DEB,3 AJ_DEB,4 TOT_AJ_DEB,5 ESTORNOS_CRED,6 TOT_CRED,7 AJ_CRED,
// 8 TOT_AJ_CRED,9 ESTORNOS_DEB,10 SLD_CREDOR_ANT,11 SLD_APURADO,12 TOT_DED,13 ICMS_RECOLHER,
// 14 SLD_CREDOR_TRANSPORTAR,15 DEB_ESP. E111: 2 COD_AJ_APUR, 4 VL_AJ_APUR.
function recalcularE110(linhas) {
    const c = (v) => Math.round((parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0) * 100);
    const fmt = (ct) => (ct / 100).toFixed(2).replace('.', ',');
    const NAT = { '0': 4, '1': 5, '2': 8, '3': 9 };
    let i110 = -1, soma = null;
    const fechar = () => {
        if (i110 < 0 || !soma) return;
        const f = linhas[i110].split('|');
        if (f.length <= 14) return; // E110 truncado/atípico: não mexe
        let mudou = false;
        const setF = (k, val) => { if (c(f[k]) !== val) { f[k] = fmt(val); mudou = true; } };
        if (soma.tem) { setF(4, soma[4]); setF(5, soma[5]); setF(8, soma[8]); setF(9, soma[9]); }
        const totDeb = c(f[2]) + c(f[3]) + c(f[4]) + c(f[5]);
        const totCred = c(f[6]) + c(f[7]) + c(f[8]) + c(f[9]);
        const base = totDeb - totCred - c(f[10]);
        if (base >= 0) { setF(11, base); setF(13, Math.max(0, base - c(f[12]) + c(f[15]))); setF(14, 0); }
        else { setF(11, 0); setF(13, 0); setF(14, -base); }
        if (mudou) linhas[i110] = f.join('|');
    };
    for (let i = 0; i < linhas.length; i++) {
        const reg = linhas[i].split('|')[1];
        if (reg === 'E110') { fechar(); i110 = i; soma = { 4: 0, 5: 0, 8: 0, 9: 0, tem: false }; }
        else if (reg === 'E111' && soma) {
            const ff = linhas[i].split('|');
            const campo = NAT[String(ff[2] || '').charAt(3)];
            if (campo) soma[campo] += c(ff[4]);
            soma.tem = true;
        }
    }
    fechar();
    return linhas;
}

// ── Coerência E116 (obrigações do ICMS a recolher) × E110 ───────────────────────────
// PVA: Σ E116.VL_OR (f3) = E110.VL_ICMS_RECOLHER (f13) + DEB_ESP (f15). Quando há UM E116 no grupo
// do E110 e o VL_OR diverge do total (ex.: após recalcularE110 mudar o f13), ajusta o VL_OR.
// NÃO cria E116 ausente (exigiria COD_REC/DT_VCTO fiscais que variam por empresa/período e não
// temos) nem mexe quando há VÁRIOS E116 (ambíguo) — esses casos são detectados pela regra INV-E116-01.
// Roda DEPOIS de recalcularE110. Só altera valor que muda → no-op byte-idêntico quando já coerente.
// Layout E116: f2 COD_OR, f3 VL_OR, f4 DT_VCTO, f5 COD_REC, ...
function recalcularE116(linhas) {
    const c = (v) => Math.round((parseFloat(String(v == null ? '0' : v).replace(',', '.')) || 0) * 100);
    const fmt = (ct) => (ct / 100).toFixed(2).replace('.', ',');
    let i = 0;
    while (i < linhas.length) {
        if (linhas[i].split('|')[1] !== 'E110') { i++; continue; }
        const f110 = linhas[i].split('|');
        const target = (f110.length > 13 ? c(f110[13]) : 0) + (f110.length > 15 ? c(f110[15]) : 0);
        const e116idx = [];
        let j = i + 1;
        for (; j < linhas.length; j++) {
            const r = linhas[j].split('|')[1];
            if (r === 'E110') break;
            if (r === 'E116') e116idx.push(j);
        }
        if (e116idx.length === 1) { // único E116 → ajusta o VL_OR ao total apurado
            const f = linhas[e116idx[0]].split('|');
            if (f.length > 3 && c(f[3]) !== target) { f[3] = fmt(target); linhas[e116idx[0]] = f.join('|'); }
        }
        i = j;
    }
    return linhas;
}

module.exports = {
    injetarXmlEPersistir,
    gerarSpedFragmentado,
    costurarEAssinar,
    costurarEAssinarLinhas,
    realocar0221,
    normalizarUsoConsumoCst90,
    enforcarCoerencia1300,
    recalcularVlInvH005,
    injetarLacres1360,
    recalcularE110,
    recalcularE116
};
