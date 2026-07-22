// backend/tests/scoperede-unit.test.js
//   node backend/tests/scoperede-unit.test.js
const assert = require('assert');
const { ehBypass, redeDoRecurso, scopeRede, emailReservado } = require('../scopeRede');

let pass=0, fail=0; const fails=[];
const t=(n,fn)=>{try{fn();pass++;}catch(e){fail++;fails.push(`${n} → ${e.message}`);}};
const ta=async(n,fn)=>{try{await fn();pass++;}catch(e){fail++;fails.push(`${n} → ${e.message}`);}};

// pool falso: devolve rede conforme o SQL
const fakePool = (redePorId) => ({ query: async (_sql, params) => {
  const id = params[0]; const r = redePorId[id];
  return { rows: r === undefined ? [] : [{ rede_id: r }] };
}});

t('ehBypass: super_admin e staff passam', () => {
  assert.equal(ehBypass({role:'super_admin'}, {}), true);
  assert.equal(ehBypass({role:'staff'}, {}), true);
  assert.equal(ehBypass({role:'admin'}, {email:'a@b.com'}), false);
  assert.equal(ehBypass({role:'escritorio'}, {email:'a@b.com'}), false);
});
t('ehBypass: token de serviço (claim svc ASSINADO) passa', () => {
  assert.equal(ehBypass({role:'admin'}, {svc:'validador'}), true);
});
// SEGURANÇA (bloqueador): o bypass NÃO pode confiar em email — email é spoofável
// (criação de usuário / PUT profile). Um email 'sys@local' forjado deve falhar.
t('ehBypass: email sys@local forjado NÃO passa (vetor de forja fechado)', () => {
  assert.equal(ehBypass({role:'admin'}, {email:'sys@local'}), false);
  assert.equal(ehBypass({role:'escritorio'}, {email:'sys@local'}), false);
});
t('emailReservado: sys@local e não-endereços são reservados; email normal é livre', () => {
  assert.equal(emailReservado('sys@local'), true);
  assert.equal(emailReservado('SYS@LOCAL'), true);      // case-insensitive
  assert.equal(emailReservado('validador'), true);       // não-endereço
  assert.equal(emailReservado(''), true);
  assert.equal(emailReservado(null), true);
  assert.equal(emailReservado('demo@audisped.com.br'), false);
});

(async () => {
  await ta('redeDoRecurso sped: sobe cadeia e devolve rede', async () => {
    const rede = await redeDoRecurso(fakePool({42: 7}), 'sped', {params:{id:'42'}});
    assert.equal(rede, 7);
  });
  await ta('redeDoRecurso sped inexistente → null', async () => {
    const rede = await redeDoRecurso(fakePool({}), 'sped', {params:{id:'999'}});
    assert.equal(rede, null);
  });
  await ta('redeDoRecurso empresa: resolve rede da empresa', async () => {
    const rede = await redeDoRecurso(fakePool({5: 2}), 'empresa', {params:{id_empresa:'5'}});
    assert.equal(rede, 2);
  });
  await ta('redeDoRecurso: sem id no param → undefined (tipo sem id resolvível)', async () => {
    const rede = await redeDoRecurso(fakePool({}), 'sped', {params:{}});
    assert.equal(rede, undefined);
  });
  await ta('scopeRede: ator de outra rede → 403', async () => {
    const mw = scopeRede(fakePool({42:7}), 'sped');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:3}, user:{email:'a@b'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(code, 403); assert.equal(called, false);
  });
  await ta('scopeRede: ator da mesma rede → next()', async () => {
    const mw = scopeRede(fakePool({42:7}), 'sped');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:7}, user:{email:'a@b'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(called, true); assert.equal(code, null);
  });
  await ta('scopeRede: super_admin → bypass (next sem query)', async () => {
    const mw = scopeRede(fakePool({}), 'sped');
    let called=false; const res={status(){return this;},json(){return this;}};
    await mw({ator:{role:'super_admin',rede_id:null}, user:{email:'x'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(called, true);
  });
  await ta('scopeRede: staff → bypass (cross-tenant interno)', async () => {
    const mw = scopeRede(fakePool({}), 'sped');
    let called=false,code=null; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'staff',rede_id:null}, user:{email:'x'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(called, true); assert.equal(code, null);
  });
  await ta('scopeRede: recurso inexistente → 404', async () => {
    const mw = scopeRede(fakePool({}), 'sped');
    let code=null; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:7}, user:{email:'a@b'}, params:{id:'999'}}, res, ()=>{});
    assert.equal(code, 404);
  });
  await ta('scopeRede: ator NÃO-bypass com rede_id null → 403 (sessão sem rede)', async () => {
    const mw = scopeRede(fakePool({42:7}), 'sped');
    let code=null,called=false,body=null;
    const res={status(c){code=c;return this;},json(b){body=b;return this;}};
    await mw({ator:{role:'admin',rede_id:null}, user:{email:'a@b'}, params:{id:'42'}}, res, ()=>{called=true;});
    assert.equal(code, 403); assert.equal(called, false);
    assert.ok(/rede/i.test(body.erro), 'mensagem deve citar rede');
  });
  await ta('scopeRede: tipo sem id no param → 400 (recurso não identificado)', async () => {
    const mw = scopeRede(fakePool({}), 'sped');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:7}, user:{email:'a@b'}, params:{}}, res, ()=>{called=true;});
    assert.equal(code, 400); assert.equal(called, false);
  });
  console.log(`\nscoperede-unit: ${pass} passaram, ${fail} falharam`);
  if (fail) { fails.forEach(f=>console.log('  ✗ '+f)); process.exit(1); }
})();
