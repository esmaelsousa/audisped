// Changelog do export — coletor das correções aplicadas no .txt, para o relatório "o que foi
// corrigido" (antes → depois, por bloco/registro). É um SIDE-CHANNEL: só registra, NUNCA altera
// as linhas → o .txt gerado continua byte-idêntico (mantém a garantia golden-file). As funções de
// correção recebem um `log` opcional e chamam log.add({...}) quando mudam algo; sem log → no-op.
// Correções em massa (dedup, recálculo de X990) entram RESUMIDAS (1 entrada), não item a item.
class Changelog {
    constructor() { this.entradas = []; }

    // e: { bloco?, registro, regraId?, motivo, escopo?, chave?, linha?, campo?, antes, depois, origem?, classe? }
    add(e) {
        if (!e || !e.registro) return;
        this.entradas.push({
            bloco: e.bloco || String(e.registro).charAt(0),
            registro: String(e.registro),
            regraId: e.regraId || '',
            motivo: e.motivo || '',
            escopo: e.escopo || 'campo',          // campo | linha | registro | bloco | arquivo
            chave: e.chave != null ? String(e.chave) : null,
            linha: (e.linha != null && !isNaN(e.linha)) ? Number(e.linha) : null,
            campo: e.campo || '',
            antes: e.antes != null ? String(e.antes) : '',
            depois: e.depois != null ? String(e.depois) : '',
            origem: e.origem || 'auto',           // auto | fiscal | manual | injecao | remocao
            classe: e.classe || 'estrutural-seguro',
        });
    }

    get total() { return this.entradas.length; }

    // bloco → registro → [itens], com contagens (para a UI agrupada)
    agrupar() {
        const blocos = {};
        for (const e of this.entradas) {
            const b = blocos[e.bloco] || (blocos[e.bloco] = { bloco: e.bloco, total: 0, registros: {} });
            b.total++;
            const r = b.registros[e.registro] || (b.registros[e.registro] = { registro: e.registro, total: 0, itens: [] });
            r.total++; r.itens.push(e);
        }
        return Object.values(blocos)
            .map(b => ({ bloco: b.bloco, total: b.total, registros: Object.values(b.registros).sort((x, y) => x.registro.localeCompare(y.registro)) }))
            .sort((x, y) => x.bloco.localeCompare(y.bloco));
    }

    totais() {
        const porOrigem = {}, porClasse = {};
        for (const e of this.entradas) {
            porOrigem[e.origem] = (porOrigem[e.origem] || 0) + 1;
            porClasse[e.classe] = (porClasse[e.classe] || 0) + 1;
        }
        return { total: this.total, porOrigem, porClasse };
    }
}

module.exports = { Changelog };
