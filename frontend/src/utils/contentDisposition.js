// Lê o nome do arquivo do header Content-Disposition.
//
// Existe porque o nome do PDF de Posição do Estoque era montado NO FRONTEND, a partir de
// `arquivoInfo.periodo` (store). Com o navegador de meses o store não acompanha a troca de
// competência, e todo PDF saía com o mês em que a tela foi aberta — um relatório de JULHO baixava
// como "Posicao do Estoque_10795278000156_2026-01.pdf".
//
// O backend já manda o nome certo no header; a regra agora tem fonte ÚNICA (o servidor nomeia, o
// cliente obedece). Mesma lição do `chaveDocC100`: regra escrita em dois lugares diverge em silêncio.
//
// Requer `Access-Control-Expose-Headers: Content-Disposition` no backend — sem isso o navegador
// esconde o header em requisição cross-origin e cairíamos no fallback sem perceber.

/**
 * @param {string|null|undefined} header  valor bruto de Content-Disposition
 * @param {string} fallback  nome a usar quando o header não traz filename
 * @returns {string} nome do arquivo, sempre sem componente de caminho
 */
export function nomeDoContentDisposition(header, fallback) {
    const h = String(header || '');
    let nome = '';

    // filename* (RFC 5987) tem precedência: é o que carrega acentuação corretamente.
    const m5987 = h.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
    if (m5987) {
        try { nome = decodeURIComponent(m5987[2].trim()); }
        catch (_) { nome = ''; }   // percent-encoding quebrado → tenta o filename simples
    }

    if (!nome) {
        const m = h.match(/filename\s*=\s*"([^"]*)"/i) || h.match(/filename\s*=\s*([^;]+)/i);
        if (m) nome = m[1];
    }

    nome = String(nome || '').trim().replace(/^"|"$/g, '').trim();
    // Nunca deixa o servidor ditar diretório: fica só o último segmento.
    nome = nome.split(/[\\/]/).pop().trim();
    return nome || fallback;
}
