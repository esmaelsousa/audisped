// backend/tests/correcoes-chave-duplicada.test.js
//   node backend/tests/correcoes-chave-duplicada.test.js   (unitário, sem DB)
//
// A chaveNatural de C170/C190 é "CHV_NFE + #sufixo". Quando o ERP escritura a MESMA nota duas vezes
// — saída (CFOP 5949) e entrada espelho (1949), com a MESMA chave de acesso — a chave deixa de
// identificar um documento só, e uma correção gravada para o item de UMA delas era aplicada nas DUAS.
//
// Caso real: POSTO PREÇO BOM (10795278000156) 01/2026, arq 2598, NF 89409 item 2 (ARLA A GRANEL).
// A correção nasceu do item da ENTRADA (CST 090 / CFOP 1949, ALIQ 20,50 com BC e ICMS zerados —
// DOC-C170-ICMSSEMBASE-01, legítimo). Ao aplicar, ela também zerava a ALIQ do item da SAÍDA
// (CST 000 / CFOP 5949), que tinha BC 84,84 e ICMS 17,39 — item legitimamente tributado.
// Efeito: C170 ficava 000/5949/0 e o C190 seguia 000/5949/20,5 → órfão nos dois sentidos
// (DOC-C190-01 e DOC-C170-C190-01), e o SPED saía com alíquota zerada num item tributado.
// No arq 2598: 52 C100 de chave duplicada, 48 das 176 correções caindo nelas.
//
// Desambiguação: ORDEM de ocorrência da chave, o mesmo padrão já usado no H005 (ordinalH005) —
// a 1ª ocorrência mantém a chave (compatível com o que já está gravado) e a 2ª+ ganha "@N".
const assert = require('assert');
const { chaveNatural, aplicar, ordinalChaveC100 } = require('../services/validador/correcoes');

let ok = 0;
const t = (nome, fn) => { fn(); console.log('  ok —', nome); ok++; };

const CHV = '29260110795278000156550010000894091025855467';
// NF 89409 do arquivo real, recortada nos campos que importam.
const C100_SAIDA  = `|C100|1|0|10795278000156|55|00|001|89409|${CHV}|16012026|16012026|1740,30|2|0,00|0,00|1740,30|9|0,00|0,00|0,00|0,00|0,00||||||||`;
const C100_ENTRA  = `|C100|0|0|10795278000156|55|00|001|89409|${CHV}|16012026|16012026|1740,30|2|0,00|0,00|1740,30|9|0,00|0,00|0,00|0,00|0,00||||||||`;
const C170_SAIDA  = `|C170|2|50|ARLA A GRANEL|33,93600|L|84,84|0,00|0|000|5949|5949|84,84|20,50|17,39|0,00|0,00|0,00|0|`;
const C170_ENTRA  = `|C170|2|50|ARLA A GRANEL|33,93600|L|84,84|0,00|0|090|1949|1949|0,00|20,50|0,00|0,00|0,00|0,00|0|`;
const C190_SAIDA  = `|C190|000|5949|20,50|84,84|84,84|17,39|0,00|0,00|0,00|0,00||`;
const C190_ENTRA  = `|C190|090|1949|20,50|84,84|0,00|0,00|0,00|0,00|0,00|0,00||`;

const ALIQ = 14;                        // índice de ALIQ_ICMS no C170
const F = (l, i) => l.split('|')[i];

// Reconstrói as chaves do jeito que o engine faz ao varrer o arquivo (C100 + filhos, com ordinal).
function chavesDoArquivo(linhas) {
    const out = [];
    let cur = '';
    const cont = new Map();
    for (const l of linhas) {
        const f = l.split('|');
        if (f[1] === 'C100') cur = ordinalChaveC100(String(f[9] || '').replace(/\D/g, ''), cont);
        out.push({ reg: f[1], kn: chaveNatural(f[1], f, cur) });
    }
    return out;
}

console.log('correcoes-chave-duplicada:');

// 1. A chave precisa distinguir as duas notas gêmeas — senão nada abaixo é possível.
t('C170 das duas notas de mesma chave recebe chaveNatural DIFERENTE', () => {
    const k = chavesDoArquivo([C100_SAIDA, C170_SAIDA, C100_ENTRA, C170_ENTRA]).filter(x => x.reg === 'C170');
    assert.equal(k.length, 2);
    assert.notEqual(k[0].kn, k[1].kn, 'as gêmeas não podem compartilhar a chave');
});

// 2. Compatibilidade: a 1ª ocorrência mantém a chave antiga (correções já gravadas seguem casando).
t('1ª ocorrência mantém a chave antiga (retrocompatível)', () => {
    const k = chavesDoArquivo([C100_SAIDA, C170_SAIDA, C190_SAIDA]);
    assert.equal(k[0].kn, CHV);
    assert.equal(k[1].kn, CHV + '#2');
    assert.equal(k[2].kn, CHV + '#000|5949|20.5');
});

// 3. O BUG: correção do item da ENTRADA não pode tocar no item da SAÍDA.
t('correção da entrada NÃO vaza para o item da saída', () => {
    const linhas = [C100_SAIDA, C170_SAIDA, C190_SAIDA, C100_ENTRA, C170_ENTRA, C190_ENTRA];
    const kn = chavesDoArquivo(linhas).filter(x => x.reg === 'C170')[1].kn; // chave do item da ENTRADA
    const n = aplicar(linhas, [{ regra_id: 'DOC-C170-ICMSSEMBASE-01', registro: 'C170', chave_natural: kn, campo_idx: ALIQ, valor_corrigido: '0,00' }]);
    assert.equal(n, 1, 'deveria alterar UM campo só');
    assert.equal(F(linhas[1], ALIQ), '20,50', 'a SAÍDA tributada tem de ficar intacta');
    assert.equal(F(linhas[4], ALIQ), '0,00', 'a ENTRADA é que deveria ser zerada');
});

// 4. O outro sentido: correção da saída não vaza para a entrada.
t('correção da saída NÃO vaza para o item da entrada', () => {
    const linhas = [C100_SAIDA, C170_SAIDA, C100_ENTRA, C170_ENTRA];
    const kn = chavesDoArquivo(linhas).filter(x => x.reg === 'C170')[0].kn; // chave do item da SAÍDA
    const n = aplicar(linhas, [{ registro: 'C170', chave_natural: kn, campo_idx: ALIQ, valor_corrigido: '0,00' }]);
    assert.equal(n, 1);
    assert.equal(F(linhas[1], ALIQ), '0,00');
    assert.equal(F(linhas[3], ALIQ), '20,50', 'a entrada tem de ficar intacta');
});

// 5. O C190 sofre do mesmo mal (a chave dele também começa pela chave da NF).
t('C190: correção da entrada NÃO vaza para o analítico da saída', () => {
    const linhas = [C100_SAIDA, C190_SAIDA, C100_ENTRA, C190_ENTRA];
    const kn = chavesDoArquivo(linhas).filter(x => x.reg === 'C190')[1].kn;
    const n = aplicar(linhas, [{ registro: 'C190', chave_natural: kn, campo_idx: 4, valor_corrigido: '0,00' }]);
    assert.equal(n, 1);
    assert.equal(F(linhas[1], 4), '20,50', 'analítico da saída intacto');
    assert.equal(F(linhas[3], 4), '0,00');
});

// 6. Nota única (o caso normal, esmagadora maioria) continua funcionando como sempre.
t('nota sem gêmea: comportamento inalterado', () => {
    const linhas = [C100_SAIDA, C170_SAIDA];
    const n = aplicar(linhas, [{ registro: 'C170', chave_natural: CHV + '#2', campo_idx: ALIQ, valor_corrigido: '0,00' }]);
    assert.equal(n, 1);
    assert.equal(F(linhas[1], ALIQ), '0,00');
});

// 7. Três ocorrências da mesma chave — o contador não pode saturar em 2.
t('3ª ocorrência também recebe chave própria', () => {
    const k = chavesDoArquivo([C100_SAIDA, C170_SAIDA, C100_ENTRA, C170_ENTRA, C100_SAIDA, C170_SAIDA])
        .filter(x => x.reg === 'C170').map(x => x.kn);
    assert.equal(new Set(k).size, 3, 'as três têm de ser distintas');
});

// 8. Chave vazia (nota de papel/avulsa) não pode virar âncora de ordinal nem casar correção.
t('chave vazia não deduplica nem casa', () => {
    const semCh = `|C100|1|0|10795278000156|55|00|001|89409||16012026|16012026|1740,30|2|0,00|0,00|1740,30|9|0,00|0,00|0,00|0,00|0,00||||||||`;
    const linhas = [semCh, C170_SAIDA, semCh, C170_ENTRA];
    const n = aplicar(linhas, [{ registro: 'C170', chave_natural: '#2', campo_idx: ALIQ, valor_corrigido: '0,00' }]);
    assert.equal(n, 0, 'chave vazia nunca casa');
    assert.equal(F(linhas[1], ALIQ), '20,50');
    assert.equal(F(linhas[3], ALIQ), '20,50');
});

console.log(`\n${ok} casos ok`);
