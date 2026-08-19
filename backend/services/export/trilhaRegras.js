// backend/services/export/trilhaRegras.js
// Trilha das reescritas feitas pelo MOTOR DE REGRAS FISCAIS durante a exportação.
//
// POR QUE EXISTE: até 2026-08-18 o export aplicava as regras fiscais no C170 e trocava
// CST_ICMS/CFOP/CST_PIS/CST_COFINS **sem registrar nada** no changelog. Milhares de reescritas
// (medido: 18.858 de 26.178 itens de entrada num acervo real) não apareciam no relatório
// "o que foi corrigido" nem em lugar nenhum — foi exatamente isso que deixou uma regra larga
// demais reescrever CST 50 declarado pelo contador sem ninguém perceber por semanas.
// Nenhuma regra fiscal deve voltar a rodar sem esta trilha.
//
// AGRUPA em vez de emitir item a item: o Changelog espera correção em massa RESUMIDA
// (1 entrada com qtd=N + `itens` para o detalhe), senão o relatório vira uma lista de 18 mil linhas.
// A chave do grupo é (regra, campo, antes, depois) — é o que o contador precisa revisar:
// "a regra X trocou CST_PIS 50 por 73 em 5.935 itens".
//
// É SIDE-CHANNEL: só observa, nunca altera linha. O .txt continua byte-idêntico.

// item.<prop> → nome do campo como o contador o conhece no C170.
const CAMPOS = {
  cst_icms: 'CST_ICMS',
  cfop: 'CFOP',
  cst_pis: 'CST_PIS',
  cst_cofins: 'CST_COFINS',
};

const VAZIO = '(vazio)';
const rot = v => (v === '' || v == null) ? VAZIO : String(v);

/**
 * Coletor da trilha do motor de regras.
 * @param {{maxItensPorGrupo?: number}} opts maxItensPorGrupo limita o detalhe por grupo
 *        (o contador não lê 18 mil ocorrências; a contagem `qtd` continua exata).
 */
function criarColetorTrilha({ maxItensPorGrupo = 50 } = {}) {
  const grupos = new Map();

  return {
    /**
     * Registra o que uma passagem do motor mudou num item.
     * @param {Array} trilha entradas produzidas por aplicarRegrasFiscaisComLista com ctx.trilha
     * @param {{chv_nfe?: string, num_doc?: string, num_item?: string}} ref de onde veio o item
     */
    registrar(trilha, ref = {}) {
      if (!Array.isArray(trilha) || !trilha.length) return;
      for (const passo of trilha) {
        const antes = passo.antes || {};
        const depois = passo.depois || {};
        for (const prop of Object.keys(CAMPOS)) {
          if (antes[prop] === depois[prop]) continue;
          const chave = `${passo.id_regra}|${prop}|${rot(antes[prop])}|${rot(depois[prop])}`;
          let g = grupos.get(chave);
          if (!g) {
            g = {
              id_regra: passo.id_regra,
              nome: passo.nome || '(regra sem nome)',
              fundamento: passo.fundamento || '',
              campo: CAMPOS[prop],
              antes: rot(antes[prop]),
              depois: rot(depois[prop]),
              qtd: 0,
              itens: [],
            };
            grupos.set(chave, g);
          }
          g.qtd++;
          if (g.itens.length < maxItensPorGrupo) {
            const ident = ref.chv_nfe || (ref.num_doc ? `NF ${ref.num_doc}` : null);
            g.itens.push({
              chave: ident && ref.num_item ? `${ident} item ${ref.num_item}` : ident,
              antes: g.antes,
              depois: g.depois,
            });
          }
        }
      }
    },

    /** Nº de grupos distintos (regra × campo × antes→depois). */
    get grupos() { return grupos.size; },
    /** Nº total de campos reescritos. */
    get total() { return [...grupos.values()].reduce((s, g) => s + g.qtd, 0); },

    /** Despeja os grupos no Changelog do export. Idempotente-por-chamada: esvazia o coletor. */
    flush(changelog) {
      if (!changelog || typeof changelog.add !== 'function') { grupos.clear(); return 0; }
      let n = 0;
      // Maior primeiro: o grupo que mais reescreveu é o que o contador precisa ver antes.
      const ordenados = [...grupos.values()].sort((a, b) => b.qtd - a.qtd);
      for (const g of ordenados) {
        changelog.add({
          registro: 'C170',
          regraId: `REGRA-FISCAL-${g.id_regra}`,
          motivo: g.fundamento ? `${g.nome} (${g.fundamento})` : g.nome,
          escopo: 'campo',
          campo: g.campo,
          antes: g.antes,
          depois: g.depois,
          qtd: g.qtd,
          itens: g.itens.length ? g.itens : null,
          origem: 'fiscal',
          classe: 'fiscal-deterministico',
        });
        n++;
      }
      grupos.clear();
      return n;
    },
  };
}

module.exports = { criarColetorTrilha, CAMPOS };
