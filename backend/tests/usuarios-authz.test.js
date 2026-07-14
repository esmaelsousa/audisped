// Testes das funções puras de autorização de usuários (clamp §13.3 + alvo §13.7).
//   node backend/tests/usuarios-authz.test.js
const assert = require('assert');
const {
    ROLES,
    canManageUsers,
    canManageBilling,
    papeisQuePodeCriar,
    resolverCamposNovoUsuario,
    podeGerenciarAlvo,
} = require('../authz');

let pass = 0, fail = 0; const fails = [];
const t = (nome, fn) => { try { fn(); pass++; } catch (e) { fail++; fails.push(`${nome} → ${e.message}`); } };

const superA = { id: 1, role: 'super_admin', rede_id: null };
const adminA = { id: 2, role: 'admin', rede_id: 10 };
const staffA = { id: 3, role: 'staff', rede_id: null };
const escrA = { id: 4, role: 'escritorio', rede_id: 10 };

// ---- capacidades (eixos ortogonais §13.6) ----
t('canManageUsers: super e admin sim; staff e escritorio não', () => {
    assert.equal(canManageUsers(superA), true);
    assert.equal(canManageUsers(adminA), true);
    assert.equal(canManageUsers(staffA), false);
    assert.equal(canManageUsers(escrA), false);
});
t('canManageBilling: só super', () => {
    assert.equal(canManageBilling(superA), true);
    assert.equal(canManageBilling(adminA), false);
    assert.equal(canManageBilling(staffA), false);
});
t('papeisQuePodeCriar: admin só escritorio; super todos', () => {
    assert.deepEqual(papeisQuePodeCriar(adminA), ['escritorio']);
    assert.deepEqual(papeisQuePodeCriar(superA).sort(), [...ROLES].sort());
    assert.deepEqual(papeisQuePodeCriar(staffA), []);
});

// ---- clamp de criação (§13.3) ----
t('ACEITE: admin POST role=super_admin → 403', () => {
    const r = resolverCamposNovoUsuario(adminA, { role: 'super_admin' }, []);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
});
t('admin POST rede_id=<outra> → 403 (não injeta em outro tenant)', () => {
    const r = resolverCamposNovoUsuario(adminA, { rede_id: 99 }, []);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
});
t('admin sem role no body → cria escritorio na própria rede', () => {
    const r = resolverCamposNovoUsuario(adminA, { nome: 'X' }, ['validador', 'conciliacao']);
    assert.equal(r.ok, true);
    assert.equal(r.campos.role, 'escritorio');
    assert.equal(r.campos.rede_id, 10);
});
t('modulos são interseção com o contratado da rede (clamp)', () => {
    const r = resolverCamposNovoUsuario(adminA, { modulos: ['validador', 'injetor_xml'] }, ['validador', 'conciliacao']);
    assert.equal(r.ok, true);
    assert.deepEqual(r.campos.modulos, ['validador']); // injetor_xml não está no contratado
});
t('super cria admin em rede específica', () => {
    const r = resolverCamposNovoUsuario(superA, { role: 'admin', rede_id: 20 }, []);
    assert.equal(r.ok, true);
    assert.equal(r.campos.role, 'admin');
    assert.equal(r.campos.rede_id, 20);
});
t('super cria staff → rede_id NULL (cross-tenant)', () => {
    const r = resolverCamposNovoUsuario(superA, { role: 'staff', rede_id: 20 }, []);
    assert.equal(r.ok, true);
    assert.equal(r.campos.role, 'staff');
    assert.equal(r.campos.rede_id, null);
});
t('super cria admin SEM rede_id → 400 (rede obrigatória p/ papel de rede)', () => {
    const r = resolverCamposNovoUsuario(superA, { role: 'admin' }, []);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
});
t('staff não pode criar usuário → 403', () => {
    const r = resolverCamposNovoUsuario(staffA, { nome: 'X' }, []);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
});

// ---- gerência de alvo (desativar / reset-senha §13.7) ----
t('admin gerencia escritorio da própria rede', () => {
    assert.equal(podeGerenciarAlvo(adminA, { id: 4, role: 'escritorio', rede_id: 10 }), true);
});
t('admin NÃO gerencia admin-par da mesma rede (takeover lateral §13.7)', () => {
    assert.equal(podeGerenciarAlvo(adminA, { id: 5, role: 'admin', rede_id: 10 }), false);
});
t('admin NÃO gerencia escritorio de OUTRA rede', () => {
    assert.equal(podeGerenciarAlvo(adminA, { id: 6, role: 'escritorio', rede_id: 20 }), false);
});
t('admin NÃO gerencia alvo com rede_id NULL (nunca NULL-coalescing §13.7)', () => {
    assert.equal(podeGerenciarAlvo(adminA, { id: 7, role: 'escritorio', rede_id: null }), false);
});
t('super gerencia qualquer um', () => {
    assert.equal(podeGerenciarAlvo(superA, { id: 8, role: 'admin', rede_id: 20 }), true);
});
t('staff não gerencia ninguém', () => {
    assert.equal(podeGerenciarAlvo(staffA, { id: 4, role: 'escritorio', rede_id: 10 }), false);
});
t('ninguém se auto-gerencia via este caminho', () => {
    assert.equal(podeGerenciarAlvo(adminA, { id: adminA.id, role: 'admin', rede_id: 10 }), false);
});

// ---- resumo ----
console.log(`\nusuarios-authz: ${pass} passaram, ${fail} falharam`);
if (fail) { console.error(fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
console.log('OK');
