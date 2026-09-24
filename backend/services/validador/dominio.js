// Domínio fiscal (tabelas de referência) para o Validador — carregado do Postgres e CACHEADO
// em memória (as tabelas ncm/cest mudam só quando reimportadas; restart recarrega).
// As regras são PURAS (detectar(model)); o endpoint anexa isto em model.dominio antes de validar.
// Sem as tabelas (banco sem ncm/cest) → retorna null → as regras de domínio se auto-desligam (degradação segura).
let _cache = null;

// O driver `pg` devolve coluna DATE como objeto Date — e `String(date).slice(0,10)` vira
// "Sat Dec 31", não "2020-12-31". A regra compara data como STRING (AAAA-MM-DD), então a
// conversão errada fazia o filtro nunca casar e a regra nunca disparar, em silêncio.
// Usa os componentes LOCAIS de propósito: `toISOString()` converte para UTC e, com o Brasil em
// -03, jogaria a meia-noite local do dia 31 para o dia 30.
function isoData(v) {
    if (v instanceof Date) {
        if (isNaN(v.getTime())) return '';   // Date inválida: '' é honesto, "Invalid Da" seria lixo
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    return String(v || '').slice(0, 10);   // já veio como 'AAAA-MM-DD'
}

async function carregarDominio(db) {
    if (_cache) return _cache;
    try {
        const ncmSet = new Set();
        const cestSet = new Set();
        const cestNcm = new Map(); // cest (7díg) -> [ncm_prefix...]
        const n = await db.query("SELECT codigo FROM ncm WHERE nivel = 8");
        for (const r of n.rows) ncmSet.add(r.codigo);
        // Vigência do CEST: é do CÓDIGO, então vale para todas as linhas dele (a tabela repete o
        // cest uma vez por ncm_prefix). Guardamos só o FIM — é o que permite dizer "revogado antes
        // desta competência". Sem data fim = vigente.
        const cestFim = new Map(); // cest (7díg) -> 'AAAA-MM-DD' | null
        const c = await db.query("SELECT cest, ncm_prefix, vigencia_fim FROM cest");
        for (const r of c.rows) {
            cestSet.add(r.cest);
            if (!cestNcm.has(r.cest)) cestNcm.set(r.cest, []);
            cestNcm.get(r.cest).push(r.ncm_prefix);
            if (r.vigencia_fim) cestFim.set(r.cest, isoData(r.vigencia_fim));
        }

        // CFOP: a tabela guarda TAMBÉM os cabeçalhos de grupo (1.000, 1.100, 1.150…) com
        // is_grupo=true. `cfopSet` = tudo que EXISTE na tabela; `cfopGrupo` = os que existem mas
        // NÃO podem ser usados como CFOP de item. Separado assim, a regra distingue "não existe"
        // de "é título de grupo" — mensagens diferentes, correções diferentes.
        const cfopSet = new Set(), cfopGrupo = new Set(), cfopTipo = new Map(); // codigo -> 'E' | 'S'
        try {
            const f = await db.query("SELECT codigo, tipo, is_grupo FROM cad_cfops WHERE codigo ~ '^[0-9]{4}$'");
            for (const r of f.rows) {
                cfopSet.add(r.codigo);
                if (r.is_grupo) cfopGrupo.add(r.codigo);
                if (r.tipo) cfopTipo.set(r.codigo, String(r.tipo).trim().toUpperCase());
            }
        } catch (_) { /* tabela ausente → cfopSet vazio → as regras de CFOP se auto-desligam */ }

        if (!cestSet.size && !ncmSet.size && !cfopSet.size) return null; // tabelas vazias → sem domínio
        _cache = { ncmSet, cestSet, cestNcm, cestFim, cfopSet, cfopGrupo, cfopTipo, carregadoEm: null };
        return _cache;
    } catch (e) {
        return null; // tabelas ausentes / erro → degradação segura
    }
}
function invalidarCache() { _cache = null; }

module.exports = { carregarDominio, invalidarCache, isoData };
