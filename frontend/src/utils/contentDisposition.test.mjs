// frontend/src/utils/contentDisposition.test.mjs
//   node frontend/src/utils/contentDisposition.test.mjs
//
// O nome do PDF de Posição do Estoque era montado NO FRONTEND a partir de `arquivoInfo.periodo`
// (store). Com o navegador de meses o store não acompanha a troca, e todo PDF saía com o mês em que
// a tela foi aberta: um relatório de JULHO baixava como "..._2026-01.pdf". O backend já mandava o
// nome certo no Content-Disposition — faltava o frontend LER (e o CORS expor o header).
//
// Regra passa a ter fonte única: o backend nomeia, o frontend obedece. Fallback só se o header não
// vier (proxy que remove, CORS mal configurado), e aí é melhor um nome genérico do que um mês errado.
import assert from 'node:assert';
import { nomeDoContentDisposition } from './contentDisposition.js';

let ok = 0;
const t = (nome, fn) => { fn(); console.log('  ok —', nome); ok++; };

console.log('contentDisposition:');

t('extrai o nome entre aspas (formato que o backend usa)', () => {
    assert.equal(
        nomeDoContentDisposition('attachment; filename="Posicao do Estoque_10795278000156_2026-07.pdf"', 'fb.pdf'),
        'Posicao do Estoque_10795278000156_2026-07.pdf');
});

t('o mês vem do header, não do fallback — é o bug que originou isto', () => {
    const h = 'attachment; filename="Posicao do Estoque_10795278000156_2026-07.pdf"';
    assert.ok(nomeDoContentDisposition(h, 'Posicao do Estoque_10795278000156_2026-01.pdf').endsWith('2026-07.pdf'));
});

t('aceita sem aspas', () => {
    assert.equal(nomeDoContentDisposition('attachment; filename=relatorio.pdf', 'fb.pdf'), 'relatorio.pdf');
});

t('prefere filename* (RFC 5987) e decodifica', () => {
    assert.equal(
        nomeDoContentDisposition("attachment; filename=\"x.pdf\"; filename*=UTF-8''Posi%C3%A7%C3%A3o.pdf", 'fb.pdf'),
        'Posição.pdf');
});

t('header ausente ou vazio → fallback', () => {
    assert.equal(nomeDoContentDisposition(null, 'fb.pdf'), 'fb.pdf');
    assert.equal(nomeDoContentDisposition('', 'fb.pdf'), 'fb.pdf');
    assert.equal(nomeDoContentDisposition('attachment', 'fb.pdf'), 'fb.pdf');
});

t('ignora caminho embutido (não deixa o servidor ditar pasta)', () => {
    assert.equal(nomeDoContentDisposition('attachment; filename="../../etc/passwd"', 'fb.pdf'), 'passwd');
    assert.equal(nomeDoContentDisposition('attachment; filename="C:\\\\tmp\\\\x.pdf"', 'fb.pdf'), 'x.pdf');
});

t('filename* malformado cai no filename simples, não quebra', () => {
    assert.equal(
        nomeDoContentDisposition("attachment; filename=\"bom.pdf\"; filename*=UTF-8''%E0%A4%A", 'fb.pdf'),
        'bom.pdf');
});

t('espaços em volta são aparados', () => {
    assert.equal(nomeDoContentDisposition('attachment; filename =  " a b.pdf " ', 'fb.pdf'), 'a b.pdf');
});

console.log(`\n${ok} casos ok`);
