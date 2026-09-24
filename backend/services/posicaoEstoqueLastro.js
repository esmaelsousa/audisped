// Posição do Estoque — regra de LASTRO.
//
// O PDF tem de espelhar o SPED exportado. O estoque final do SPED é o FECH_FISICO do 1300, que o
// export grava em `encerrantes_exportados`. O PDF sobrescreve o `final` de cada linha por esse
// valor — e essa sobrescrita é condicional: quando a competência nunca foi exportada não existe
// linha, a sobrescrita não acontece e o documento sai com o número do `lmc_movimentacao`.
//
// Os dois NÃO são iguais. Medido em 01/2026 do POSTO PREÇO BOM (10795278000156), GASOLINA COMUM:
//   encerrantes_exportados → 9.347,09  (== SPED exportado)
//   lmc_movimentacao       → 9.128,93
// 218,16 L de diferença, sem qualquer aviso no PDF. Nessa empresa 6 das 14 competências estão sem
// encerrante; com o navegador de meses virou um clique chegar numa delas.
//
// Por isso o PDF passa a ter só dois estados: IGUAL ao SPED, ou não sai. `avaliarLastro` decide —
// é pura, sem IO, e a rota apenas obedece ao veredito.
//
// Reversível sem deploy: PDF_ESTOQUE_EXIGIR_LASTRO=false faz a rota ignorar o bloqueio e voltar ao
// comportamento antigo (gerar com o fallback do lmc). A avaliação continua rodando e marcando a
// `fonte` de cada linha, então a tela segue sabendo o que é lastreado e o que não é.

// Um item só precisa de lastro se ele de fato aparece no PDF. A rota descarta linhas sem estoque e
// sem movimento (`inicial > 0 || entradas > 0 || saídas > 0 || final > 0`); replicamos o mesmo
// critério para um produto de loja zerado não travar a emissão.
const _n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
function entraNoPdf(r) {
    return _n(r.inicial) > 0 || _n(r.entradas) > 0 || _n(r['saídas']) > 0 || _n(r.saidas) > 0 || _n(r.final) > 0;
}

/**
 * SÓ produtos do LMC podem divergir do SPED. O bloco 1 escritura apenas COMBUSTÍVEL; os itens de
 * loja (aditivos, lubrificantes, conveniência) aparecem no PDF com compra e venda, mas não existem
 * no 1300 e nunca terão encerrante — exigir lastro deles bloquearia 100% das competências. Foi
 * exatamente o que a primeira versão desta regra fez: 8 de 8 meses barrados, inclusive 01/2026, que
 * está perfeito. `produtosLmc` é a fronteira entre "tem contraparte no SPED" e "não tem".
 *
 * @param {Array<object>} linhas  linhas da query do PDF (cod_item, descr_item, inicial, final, …)
 * @param {Map<string,number>} finalMap  cod_item (TRIM) -> fech_fisico_exportado da competência
 * @param {Set<string>} produtosLmc  cod_item (TRIM) com movimentação no LMC deste arquivo.
 *   `null`/ausente → fail-closed: exige lastro de todos (não sabemos quem é combustível).
 * @returns {{ok:boolean, linhas:Array<object>, semLastro:Array<{cod_item:string,descr_item:string}>}}
 *   `linhas` é uma CÓPIA com `final` sobrescrito quando há lastro e `fonte` em cada uma:
 *   'sped' (veio do encerrante exportado) · 'lmc' (fallback, diverge) · 'n/a' (fora do bloco 1).
 *   `ok=false` quando ALGUM combustível não tem encerrante — um basta para invalidar o documento,
 *   porque o leitor não tem como saber qual linha é confiável.
 */
function avaliarLastro(linhas, finalMap, produtosLmc) {
    const out = [];
    const semLastro = [];
    for (const r of (linhas || [])) {
        const cod = String(r.cod_item == null ? '' : r.cod_item).trim();
        const tem = finalMap && finalMap.has(cod);
        const doLmc = !produtosLmc || produtosLmc.has(cod);   // sem a lista → trata como LMC (fail-closed)
        const copia = Object.assign({}, r, { fonte: tem ? 'sped' : (doLmc ? 'lmc' : 'n/a') });
        if (tem) copia.final = finalMap.get(cod);            // o SPED manda
        else if (doLmc && entraNoPdf(r)) semLastro.push({ cod_item: cod, descr_item: r.descr_item });
        out.push(copia);
    }
    return { ok: semLastro.length === 0, linhas: out, semLastro };
}

// Flag de reversão. Ausente ou qualquer valor ≠ 'false' → exige lastro (padrão seguro).
const exigirLastro = () => String(process.env.PDF_ESTOQUE_EXIGIR_LASTRO || '').toLowerCase() !== 'false';

module.exports = { avaliarLastro, exigirLastro, entraNoPdf };
