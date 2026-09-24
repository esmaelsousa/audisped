// backend/tests/leiaute-versao-periodo.test.js
//   node backend/tests/leiaute-versao-periodo.test.js   (unitário, sem DB)
//
// O leiaute 020 vale para PERÍODOS a partir de jan/2026. Muitos ERPs ainda emitem em leiaute antigo,
// e o PVA reprova logo no 0000: "A versão de leiaute apresentada não é válida para o período
// informado" — e, em cascata, todo 1310 vira "número de campos difere do leiaute" (020 tem o
// CAP_TANQUE a mais). O export já transmutava, mas só de '019', com igualdade exata.
//
// Caso real: POSTO PIRAÍ II (09172184000222) 08/2026 chegou em leiaute **018** — a condição
// `=== '019'` não pegou, o arquivo saiu em 018 e o PVA devolveu 156 erros (1 de versão + 155 de
// 1310). Medido no arquivo: dos 52 registros presentes, SÓ o 1310 muda de 018 para 020 (9 → 10
// campos); os outros 43 catalogados já são válidos em 020. Logo, transmutar é seguro desde que o
// CAP_TANQUE do 1310 seja preenchido — o que a regra de 2026 do export já faz.
const assert = require('assert');
const { versaoAlvoLeiaute } = require('../services/spedCostureiraService');

let ok = 0;
const t = (nome, fn) => { fn(); console.log('  ok —', nome); ok++; };

console.log('leiaute-versao-periodo:');

t('018 em 2026 → transmuta para 020 (o caso do PIRAÍ II)', () => {
    assert.equal(versaoAlvoLeiaute('018', '01082026'), '020');
});

t('019 em 2026 → transmuta (comportamento que já existia)', () => {
    assert.equal(versaoAlvoLeiaute('019', '01012026'), '020');
});

t('017 e anteriores em 2026 → também transmuta', () => {
    assert.equal(versaoAlvoLeiaute('017', '01032026'), '020');
    assert.equal(versaoAlvoLeiaute('015', '01032026'), '020');
});

t('já em 020 → não mexe', () => {
    assert.equal(versaoAlvoLeiaute('020', '01082026'), null);
});

t('versão MAIS NOVA que 020 → não rebaixa', () => {
    assert.equal(versaoAlvoLeiaute('021', '01082026'), null);
    assert.equal(versaoAlvoLeiaute('100', '01082026'), null);
});

// A fronteira é o PERÍODO, não a data de hoje. 2025 fica no leiaute declarado: lá o 1310 não tem
// CAP_TANQUE e transmutar quebraria o registro ("esperado 10, informado 11").
t('2025 e anteriores → NÃO transmuta, qualquer que seja a versão', () => {
    assert.equal(versaoAlvoLeiaute('018', '01122025'), null);
    assert.equal(versaoAlvoLeiaute('019', '01082025'), null);
    assert.equal(versaoAlvoLeiaute('015', '01012020'), null);
});

t('2027+ continua alvo do 020 (até existir leiaute novo)', () => {
    assert.equal(versaoAlvoLeiaute('019', '01032027'), '020');
});

// Fail-safe: entrada suja não pode virar transmutação silenciosa de um arquivo que não entendemos.
t('versão vazia ou não numérica → não mexe', () => {
    assert.equal(versaoAlvoLeiaute('', '01082026'), null);
    assert.equal(versaoAlvoLeiaute(null, '01082026'), null);
    assert.equal(versaoAlvoLeiaute('abc', '01082026'), null);
    assert.equal(versaoAlvoLeiaute('18', '01082026'), null, 'sem zero à esquerda não é COD_VER válido');
});

t('data inválida → não mexe', () => {
    assert.equal(versaoAlvoLeiaute('018', ''), null);
    assert.equal(versaoAlvoLeiaute('018', '0108202'), null);
    assert.equal(versaoAlvoLeiaute('018', null), null);
});

console.log(`\n${ok} casos ok`);
