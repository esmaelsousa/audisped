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

module.exports = {
    injetarXmlEPersistir,
    gerarSpedFragmentado,
    costurarEAssinar,
    costurarEAssinarLinhas
};
