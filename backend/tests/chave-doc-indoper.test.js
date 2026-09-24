// backend/tests/chave-doc-indoper.test.js
//   node backend/tests/chave-doc-indoper.test.js   (unitário, sem DB)
//
// O export reescreve C100/C170/C190 a partir do banco usando mapas chaveados por
// num_doc + chv_nfe (+ item/trinca). Esse ERP escritura a MESMA nota duas vezes — saída (CFOP 5949)
// e entrada espelho (1949) — com a MESMA chave de acesso E o mesmo num_doc, então as duas colidiam
// no Map: a última inserida (a entrada) vencia e era aplicada sobre a que sobrevive ao dedup (a saída).
//
// Caso real: POSTO PREÇO BOM (10795278000156) 01/2026 — 52 chaves com 2+ C100. Na NF 89409 o item 2
// (ARLA) saía com CST 090 / CFOP 1949 (dados da entrada) enquanto o C190 seguia 000/5949 → órfão.
// 48 bloqueantes no Re-validar (24 DOC-C190-01 + 24 DOC-C170-C190-01).
//
// IND_OPER (0=entrada, 1=saída) separa as gêmeas: está no C100 do arquivo (campo 2) e na coluna
// ind_oper de documentos_c100, então serve aos dois lados. Este helper é a ÚNICA fonte da chave —
// antes a regra estava escrita duas vezes (ao montar o Map e ao casar no loop) e as duas podiam
// divergir em silêncio, que foi exatamente o que aconteceu.
const assert = require('assert');
const { chaveDocC100 } = require('../services/spedCostureiraService');

let ok = 0;
const t = (nome, fn) => { fn(); console.log('  ok —', nome); ok++; };

const CHV = '29260110795278000156550010000894091025855467';

console.log('chave-doc-indoper:');

t('gêmeas saída/entrada recebem chaves DIFERENTES', () => {
    assert.notEqual(chaveDocC100('1', '89409', CHV), chaveDocC100('0', '89409', CHV));
});

t('mesma nota, mesmo IND_OPER → mesma chave (o Map tem de casar)', () => {
    assert.equal(chaveDocC100('1', '89409', CHV), chaveDocC100('1', '89409', CHV));
});

t('IND_OPER entra na chave de forma estável', () => {
    assert.equal(chaveDocC100('1', '89409', CHV), `1_89409_${CHV}`);
    assert.equal(chaveDocC100('0', '89409', CHV), `0_89409_${CHV}`);
});

t('chave de acesso vazia (nota de papel) não quebra', () => {
    assert.equal(chaveDocC100('1', '89409', ''), '1_89409_');
    assert.equal(chaveDocC100('1', '89409', null), '1_89409_');
    assert.equal(chaveDocC100('1', '89409', undefined), '1_89409_');
});

t('IND_OPER ausente vira string vazia (não "undefined")', () => {
    assert.equal(chaveDocC100(null, '89409', CHV), `_89409_${CHV}`);
    assert.equal(chaveDocC100(undefined, '89409', CHV), `_89409_${CHV}`);
});

t('normaliza número vs string (o banco devolve string, o .txt também)', () => {
    assert.equal(chaveDocC100(1, '89409', CHV), chaveDocC100('1', '89409', CHV));
    assert.equal(chaveDocC100('1', 89409, CHV), chaveDocC100('1', '89409', CHV));
});

t('não confunde notas de num_doc diferente sob o mesmo IND_OPER', () => {
    assert.notEqual(chaveDocC100('1', '89409', CHV), chaveDocC100('1', '89411', CHV));
});

console.log(`\n${ok} casos ok`);
