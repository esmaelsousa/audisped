// authz.js — autorização de usuários (SaaS multi-inquilino).
// Núcleo de decisão em FUNÇÕES PURAS (testáveis sem DB): clamp de criação (§13.3)
// e gerência de alvo (§13.7). Capacidades por eixos ortogonais (§13.6), não hierarquia linear.

const ROLES = ['super_admin', 'admin', 'staff', 'escritorio'];
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

module.exports = {
    ROLES,
    ROLES_CROSS_TENANT,
    canManageUsers,
    canManageBilling,
    papeisQuePodeCriar,
    resolverCamposNovoUsuario,
    podeGerenciarAlvo,
};
