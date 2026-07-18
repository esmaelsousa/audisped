// Testes do middleware demoPaywall (bloqueio de download no ambiente de demonstração).
//   node backend/tests/demo-paywall.test.js
//
// Regra: quando DEMO_MODE=1, as rotas de DELIVERABLE (SPED .txt corrigido, LMC impresso,
// injetores que devolvem .txt) respondem 402 e NÃO executam o handler. Fora do DEMO_MODE
// (produção), o middleware é transparente (chama next, zero efeito) — não-regressão.

const assert = require('assert');
const demoPaywall = require('../demoPaywall');

let pass = 0, fail = 0; const fails = [];
const t = (nome, fn) => { try { fn(); pass++; } catch (e) { fail++; fails.push(`${nome} → ${e.message}`); } };

// req/res/next falsos, minimalistas.
function mkRes() {
    return {
        statusCode: null, body: null, nextCalled: false,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    };
}
function run(envDemo) {
    const prev = process.env.DEMO_MODE;
    if (envDemo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = envDemo;
    const res = mkRes();
    let nextCalled = false;
    demoPaywall({}, res, () => { nextCalled = true; });
    process.env.DEMO_MODE = prev; // restaura
    return { res, nextCalled };
}

t('DEMO_MODE=1 → 402 com paywall:true e NÃO chama next', () => {
    const { res, nextCalled } = run('1');
    assert.equal(res.statusCode, 402, 'deveria responder 402');
    assert.equal(nextCalled, false, 'NÃO deveria chamar next (handler não roda)');
    assert.ok(res.body && res.body.paywall === true, 'corpo deve marcar paywall:true');
    assert.ok(res.body.erro && /assine/i.test(res.body.erro), 'mensagem deve orientar a assinar');
});

t('sem DEMO_MODE (produção) → transparente: chama next e NÃO responde', () => {
    const { res, nextCalled } = run(undefined);
    assert.equal(nextCalled, true, 'deveria chamar next em produção');
    assert.equal(res.statusCode, null, 'não deveria responder nada');
});

t('DEMO_MODE=0 (desligado explicitamente) → transparente', () => {
    const { res, nextCalled } = run('0');
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
});

// ---- resumo ----
console.log(`\ndemo-paywall: ${pass} passaram, ${fail} falharam`);
if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
