// Domínio fiscal (tabelas de referência) para o Validador — carregado do Postgres e CACHEADO
// em memória (as tabelas ncm/cest mudam só quando reimportadas; restart recarrega).
// As regras são PURAS (detectar(model)); o endpoint anexa isto em model.dominio antes de validar.
// Sem as tabelas (banco sem ncm/cest) → retorna null → as regras de domínio se auto-desligam (degradação segura).
let _cache = null;

async function carregarDominio(db) {
    if (_cache) return _cache;
    try {
        const ncmSet = new Set();
        const cestSet = new Set();
        const cestNcm = new Map(); // cest (7díg) -> [ncm_prefix...]
        const n = await db.query("SELECT codigo FROM ncm WHERE nivel = 8");
        for (const r of n.rows) ncmSet.add(r.codigo);
        const c = await db.query("SELECT cest, ncm_prefix FROM cest");
        for (const r of c.rows) {
            cestSet.add(r.cest);
            if (!cestNcm.has(r.cest)) cestNcm.set(r.cest, []);
            cestNcm.get(r.cest).push(r.ncm_prefix);
        }
        if (!cestSet.size && !ncmSet.size) return null; // tabelas vazias → sem domínio
        _cache = { ncmSet, cestSet, cestNcm, carregadoEm: null };
        return _cache;
    } catch (e) {
        return null; // tabelas ausentes / erro → degradação segura
    }
}
function invalidarCache() { _cache = null; }

module.exports = { carregarDominio, invalidarCache };
