// Changelog do export — coletor das correções aplicadas no .txt, para o relatório "o que foi
// corrigido" (antes → depois, por bloco/registro). É um SIDE-CHANNEL: só registra, NUNCA altera
// as linhas → o .txt gerado continua byte-idêntico (mantém a garantia golden-file). As funções de
// correção recebem um `log` opcional e chamam log.add({...}) quando mudam algo; sem log → no-op.
// Correções em massa (dedup, recálculo de X990) entram RESUMIDAS (1 entrada), não item a item.
class Changelog {
    constructor() { this.entradas = []; }

    // e: { bloco?, registro, regraId?, motivo, escopo?, chave?, linha?, campo?, antes, depois, origem?, classe? }
    // e pode trazer `qtd` (>1) para uma correção AGRUPADA (ex.: 742 notas com o mesmo VL_OUT_DA→0,00
    // entram como 1 entrada com qtd=742, exibida como "×742" e contada corretamente nos totais).
    add(e) {
        if (!e || !e.registro) return;
        this.entradas.push({
            bloco: e.bloco || String(e.registro).charAt(0),
            registro: String(e.registro),
            regraId: e.regraId || '',
            refCatalogo: e.refCatalogo != null ? String(e.refCatalogo) : null,
            motivo: e.motivo || '',
            escopo: e.escopo || 'campo',          // campo | linha | registro | bloco | arquivo
            chave: e.chave != null ? String(e.chave) : null,
            linha: (e.linha != null && !isNaN(e.linha)) ? Number(e.linha) : null,
            campo: e.campo || '',
            antes: e.antes != null ? String(e.antes) : '',
            depois: e.depois != null ? String(e.depois) : '',
            origem: e.origem || 'auto',           // auto | fiscal | manual | injecao | remocao
            classe: e.classe || 'estrutural-seguro',
            qtd: (e.qtd != null && Number(e.qtd) > 0) ? Number(e.qtd) : 1,
            // detalhe por ocorrência (NF/chave, antes→depois) — para o relatório/PDF listarem item a item
            itens: Array.isArray(e.itens) && e.itens.length ? e.itens : null,
        });
    }

    // total REAL de campos corrigidos (soma das quantidades — grupos contam por ocorrência).
    get total() { return this.entradas.reduce((s, e) => s + (e.qtd || 1), 0); }

    // bloco → registro → [itens], com contagens (para a UI agrupada)
    agrupar() {
        const blocos = {};
        for (const e of this.entradas) {
            const q = e.qtd || 1;
            const b = blocos[e.bloco] || (blocos[e.bloco] = { bloco: e.bloco, total: 0, registros: {} });
            b.total += q;
            const r = b.registros[e.registro] || (b.registros[e.registro] = { registro: e.registro, total: 0, itens: [] });
            r.total += q; r.itens.push(e);
        }
        return Object.values(blocos)
            .map(b => ({ bloco: b.bloco, total: b.total, registros: Object.values(b.registros).sort((x, y) => x.registro.localeCompare(y.registro)) }))
            .sort((x, y) => x.bloco.localeCompare(y.bloco));
    }

    totais() {
        const porOrigem = {}, porClasse = {};
        for (const e of this.entradas) {
            const q = e.qtd || 1;
            porOrigem[e.origem] = (porOrigem[e.origem] || 0) + q;
            porClasse[e.classe] = (porClasse[e.classe] || 0) + q;
        }
        return { total: this.total, porOrigem, porClasse };
    }
}

module.exports = { Changelog };
