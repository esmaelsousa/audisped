// backend/tests/posicao-estoque-lastro.test.js
//   node backend/tests/posicao-estoque-lastro.test.js   (unitário, sem DB)
//
// O PDF de Posição do Estoque só espelha o SPED porque SOBRESCREVE o estoque final com o
// `encerrantes_exportados` da competência. Isso é um `if`: quando a competência NÃO foi exportada
// não há linha, a sobrescrita não acontece e o PDF entrega o valor do `lmc_movimentacao` — que
// diverge. Medido em 01/2026 do POSTO PREÇO BOM: GASOLINA COMUM 9.347,09 (SPED) × 9.128,93 (lmc),
// 218,16 L de diferença, sem aviso nenhum no documento.
//
// Nessa empresa 6 das 14 competências não têm encerrante. Com o navegador de meses virou um clique
// chegar num mês desses, então a regra passa a ser explícita: ou o valor tem LASTRO no encerrante
// exportado, ou o PDF não sai. Nunca "parece certo e está errado".
//
// `avaliarLastro` é pura e decide sozinha; a rota só obedece. Reversível por env:
// PDF_ESTOQUE_EXIGIR_LASTRO=false volta ao comportamento antigo (gera com fallback).
const assert = require('assert');
const { avaliarLastro } = require('../services/posicaoEstoqueLastro');

let ok = 0;
const t = (nome, fn) => { fn(); console.log('  ok —', nome); ok++; };

// linhas como a query do PDF devolve; finalMap = encerrantes_exportados daquela competência
const R = (cod, final) => ({ cod_item: cod, descr_item: 'P' + cod, final });

console.log('posicao-estoque-lastro:');

t('todos os produtos com encerrante → libera e marca fonte=sped', () => {
    const r = avaliarLastro([R('2', 1), R('3', 2)], new Map([['2', 24601.116], ['3', 9347.087]]), new Set(['2','3']));
    assert.equal(r.ok, true);
    assert.deepEqual(r.semLastro, []);
    assert.equal(r.linhas[0].final, 24601.116, 'final vem do encerrante, não da linha');
    assert.equal(r.linhas[1].final, 9347.087);
    assert.ok(r.linhas.every(l => l.fonte === 'sped'));
});

t('competência SEM encerrante → bloqueia e lista os produtos', () => {
    const r = avaliarLastro([R('2', 111), R('3', 222)], new Map(), new Set(['2','3']));
    assert.equal(r.ok, false);
    assert.deepEqual(r.semLastro.map(x => x.cod_item), ['2', '3']);
    assert.ok(r.linhas.every(l => l.fonte === 'lmc'), 'sem encerrante a fonte é lmc');
});

t('encerrante PARCIAL → bloqueia (um produto sem lastro basta)', () => {
    const r = avaliarLastro([R('2', 1), R('3', 2)], new Map([['2', 24601.116]]), new Set(['2','3']));
    assert.equal(r.ok, false);
    assert.deepEqual(r.semLastro.map(x => x.cod_item), ['3']);
    assert.equal(r.linhas[0].fonte, 'sped');
    assert.equal(r.linhas[1].fonte, 'lmc');
});

t('produto zerado e sem movimento não exige lastro (não entra no PDF)', () => {
    const r = avaliarLastro([R('2', 1), { cod_item: '9', descr_item: 'LOJA', final: 0, inicial: 0, entradas: 0, saídas: 0 }],
        new Map([['2', 10]]), new Set(['2']));
    assert.equal(r.ok, true, 'item sem estoque e sem movimento não pode travar o PDF');
    assert.deepEqual(r.semLastro, []);
});

// O flagrante da auditoria: exigir lastro de TODA linha bloqueava 100% das competências, porque os
// ~126 itens de loja (aditivos, lubrificantes) têm compra e venda no PDF mas NUNCA terão encerrante
// — o bloco 1 do SPED só escritura combustível. Só quem está no LMC pode divergir do SPED.
t('produto de LOJA com movimento NÃO exige lastro (não existe no bloco 1)', () => {
    const loja = { cod_item: '3154883', descr_item: 'ORBI ADITIVO', inicial: 0, entradas: 12, 'saídas': 5, final: 7 };
    const r = avaliarLastro([R('2', 1), loja], new Map([['2', 24601.116]]), new Set(['2']));
    assert.equal(r.ok, true, 'item fora do LMC não pode travar a emissão');
    assert.deepEqual(r.semLastro, []);
    assert.equal(r.linhas[1].fonte, 'n/a', 'loja não tem fonte de SPED');
});

t('combustível do LMC sem encerrante BLOQUEIA, mesmo com loja ao lado', () => {
    const loja = { cod_item: '9', descr_item: 'LOJA', inicial: 0, entradas: 12, 'saídas': 5, final: 7 };
    const r = avaliarLastro([R('2', 1), R('3', 2), loja], new Map([['2', 10]]), new Set(['2', '3']));
    assert.equal(r.ok, false);
    assert.deepEqual(r.semLastro.map(x => x.cod_item), ['3']);
});

t('sem a lista de produtos do LMC, exige de todos (fail-closed)', () => {
    const r = avaliarLastro([R('2', 1)], new Map(), null);
    assert.equal(r.ok, false, 'na dúvida, bloqueia');
});

t('cod_item com espaços casa com a chave do encerrante (o banco guarda com TRIM)', () => {
    const r = avaliarLastro([R('  8041  ', 1)], new Map([['8041', 52284.249]]), new Set(['8041']));
    assert.equal(r.ok, true);
    assert.equal(r.linhas[0].final, 52284.249);
});

t('lista vazia → libera (nada a lastrear)', () => {
    const r = avaliarLastro([], new Map(), new Set());
    assert.equal(r.ok, true);
    assert.deepEqual(r.linhas, []);
});

t('não muta o array recebido', () => {
    const orig = [R('2', 111)];
    const copia = JSON.parse(JSON.stringify(orig));
    avaliarLastro(orig, new Map([['2', 999]]), new Set(['2']));
    assert.deepEqual(orig, copia, 'a entrada tem de ficar intacta');
});

t('encerrante zero é lastro válido (tanque vazio ≠ ausência de dado)', () => {
    const r = avaliarLastro([R('2', 500)], new Map([['2', 0]]), new Set(['2']));
    assert.equal(r.ok, true);
    assert.equal(r.linhas[0].final, 0);
    assert.equal(r.linhas[0].fonte, 'sped');
});

console.log(`\n${ok} casos ok`);
