// authz.js — autorização de usuários (SaaS multi-inquilino).
// Núcleo de decisão em FUNÇÕES PURAS (testáveis sem DB): clamp de criação (§13.3)
// e gerência de alvo (§13.7). Capacidades por eixos ortogonais (§13.6), não hierarquia linear.

const ROLES = ['super_admin', 'admin', 'staff', 'escritorio'];
// 'demo' é role de SEED do ambiente de demonstração (DEMO_MODE=1): fora de ROLES de
// propósito — não é criável pela tela (papeisQuePodeCriar não a lista) e não tem
// nenhuma capacidade de gestão (canManageUsers/canManageBilling = false por não casar
// com super_admin/admin). Só o seed do banco demo a insere. O bloqueio de download é
// responsabilidade do middleware demoPaywall (guardado por DEMO_MODE).
// Papéis cross-tenant de DADOS: não pertencem a uma rede (rede_id = NULL).
const ROLES_CROSS_TENANT = ['super_admin', 'staff'];

// ---- eixos de capacidade ----
const canManageUsers = (ator) => !!ator && (ator.role === 'super_admin' || ator.role === 'admin');
const canManageBilling = (ator) => !!ator && ator.role === 'super_admin';

// Papéis que o ator pode CRIAR.
function papeisQuePodeCriar(ator) {
    if (!ator) return [];
    if (ator.role === 'super_admin') return [...ROLES];
    if (ator.role === 'admin') return ['escritorio'];
    return [];
}

// Resolve os campos efetivos de um novo usuário a partir do ATOR (nunca confia no body p/ role/rede).
//   Retorna { ok:true, campos:{ role, rede_id, modulos } } ou { ok:false, status, motivo }.
//   redeContratada = array de chaves de módulo contratadas pela rede-alvo (p/ interseção).
function resolverCamposNovoUsuario(ator, body = {}, redeContratada = []) {
    if (!canManageUsers(ator)) {
        return { ok: false, status: 403, motivo: 'Sem permissão para criar usuários.' };
    }
    const permitidos = papeisQuePodeCriar(ator);

    // role: se veio no body e não é permitido → 403 (escalonamento explícito). Se não veio → default.
    let role;
    if (body.role != null) {
        if (!permitidos.includes(body.role)) {
            return { ok: false, status: 403, motivo: `Papel '${body.role}' não permitido para este ator.` };
        }
        role = body.role;
    } else {
        role = 'escritorio';
    }

    // rede_id: derivada do papel + ator (jamais injeta em outro tenant).
    let rede_id;
    if (ROLES_CROSS_TENANT.includes(role)) {
        rede_id = null; // super_admin/staff não pertencem a rede
    } else if (ator.role === 'admin') {
        if (body.rede_id != null && Number(body.rede_id) !== Number(ator.rede_id)) {
            return { ok: false, status: 403, motivo: 'Admin não pode criar usuário em outra rede.' };
        }
        rede_id = ator.rede_id;
    } else { // super criando papel de rede
        if (body.rede_id == null) {
            return { ok: false, status: 400, motivo: 'rede_id obrigatório para papel de rede.' };
        }
        rede_id = Number(body.rede_id);
    }

    // modulos: interseção com o contratado da rede (clamp, nunca ⊃ do contratado).
    const pedidos = Array.isArray(body.modulos) ? body.modulos : [];
    const contratados = Array.isArray(redeContratada) ? redeContratada : [];
    const modulos = pedidos.filter((m) => contratados.includes(m));

    return { ok: true, campos: { role, rede_id, modulos } };
}

// Pode o ATOR desativar/resetar o ALVO? (§13.7 — igualdade estrita, nunca NULL-coalescing.)
function podeGerenciarAlvo(ator, alvo) {
    if (!ator || !alvo) return false;
    if (Number(ator.id) === Number(alvo.id)) return false; // nunca a si mesmo por este caminho
    if (ator.role === 'super_admin') return true;
    if (ator.role === 'admin') {
        return alvo.role === 'escritorio'
            && alvo.rede_id != null
            && Number(alvo.rede_id) === Number(ator.rede_id);
    }
    return false; // staff/escritorio não gerenciam ninguém
}

// ---- enrich: re-busca role/rede/status do BANCO por id (NUNCA do token) ----
// Cache curto p/ não bater no banco a cada request nem estourar o pool (MAX_HEAVY_OPS=5).
const _cacheAtor = new Map(); // id -> { ator, exp }
const CACHE_MS = 30000;

async function carregarAtor(pool, id) {
    const agora = Date.now();
    const hit = _cacheAtor.get(id);
    if (hit && hit.exp > agora) return hit.ator;
    const r = await pool.query(
        'SELECT id, role, rede_id, ativo, precisa_trocar_senha FROM usuarios WHERE id = $1', [id]);
    const ator = r.rows[0] || null;
    _cacheAtor.set(id, { ator, exp: agora + CACHE_MS });
    return ator;
}

function invalidarCacheAtor(id) {
    if (id == null) _cacheAtor.clear();
    else _cacheAtor.delete(Number(id));
}

// Middleware (roda DEPOIS do authMiddleware): popula req.ator = {id, role, rede_id, ativo, ...}.
function enrich(pool) {
    return async (req, res, next) => {
        try {
            const id = req.user && req.user.id;
            if (id == null) return res.status(401).json({ message: 'Sessão inválida.' });
            const ator = await carregarAtor(pool, id);
            if (!ator) return res.status(403).json({ message: 'Usuário não encontrado.' });
            if (ator.ativo === false) return res.status(403).json({ message: 'Usuário desativado.' });
            req.ator = ator;
            next();
        } catch (e) {
            res.status(500).json({ message: 'Erro de autorização.', error: e.message });
        }
    };
}

module.exports = {
    ROLES,
    ROLES_CROSS_TENANT,
    canManageUsers,
    canManageBilling,
    papeisQuePodeCriar,
    resolverCamposNovoUsuario,
    podeGerenciarAlvo,
    carregarAtor,
    invalidarCacheAtor,
    enrich,
};
