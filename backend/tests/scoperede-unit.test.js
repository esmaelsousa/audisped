// backend/tests/scoperede-unit.test.js
//   node backend/tests/scoperede-unit.test.js
const assert = require('assert');
const { ehBypass, redeDoRecurso, scopeRede, emailReservado, coletarIds } = require('../scopeRede');

let pass=0, fail=0; const fails=[];
const t=(n,fn)=>{try{fn();pass++;}catch(e){fail++;fails.push(`${n} → ${e.message}`);}};
const ta=async(n,fn)=>{try{await fn();pass++;}catch(e){fail++;fails.push(`${n} → ${e.message}`);}};

// pool falso: devolve rede conforme o SQL
const fakePool = (redePorId) => ({ query: async (_sql, params) => {
  const id = params[0]; const r = redePorId[id];
  return { rows: r === undefined ? [] : [{ rede_id: r }] };
}});

// pool falso flexível, indexado pelo 1º parâmetro (String(params[0])):
//   valor number  → 1 linha  { rede_id }        (empresa/sped/chave/cnpj single)
//   valor array   → N linhas [{ rede_id }, ...]  (chave/cnpj AMBÍGUO → múltiplas redes)
//   ausente       → 0 linhas                     (inexistente)
// Cada CHAMADA é resolvida isoladamente pelo params[0], então serve p/ multi-id (uma chamada/id).
const poolMap = (m) => ({ query: async (_sql, params) => {
  const v = m[String(params[0])];
  if (v === undefined) return { rows: [] };
  return { rows: (Array.isArray(v) ? v : [v]).map(rede_id => ({ rede_id })) };
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
  await ta('redeDoRecurso contrib: arquivo EFD-Contribuições → rede da empresa', async () => {
    const rede = await redeDoRecurso(fakePool({77: 4}), 'contrib', {params:{id:'77'}});
    assert.equal(rede, 4);
  });
  await ta('redeDoRecurso contrib inexistente/sem empresa → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(fakePool({}), 'contrib', {params:{id:'999'}});
    assert.equal(rede, null);
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

  // ================= EXTRAÇÃO por CORPO / QUERY / MULTI-ID (coletarIds) =================
  t('coletarIds: pega id do CORPO (req.body)', () => {
    const ids = coletarIds({ body:{ id_sped_arquivo: 55 } }, ['id_sped_arquivo','id_sped','id_arquivo','arquivoId','ids','id']);
    assert.deepEqual(ids, [55]);
  });
  t('coletarIds: pega id da QUERY (req.query)', () => {
    const ids = coletarIds({ query:{ id_empresa: '9' } }, ['id_empresa','id']);
    assert.deepEqual(ids, ['9']);
  });
  t('coletarIds: UNIÃO de params + body + query (dedup)', () => {
    const ids = coletarIds({ params:{ id:1 }, body:{ id_arquivo:2 }, query:{ id_sped:1 } },
      ['id_sped','id_arquivo','id']);
    assert.deepEqual(new Set(ids), new Set([1,2]));
  });
  t('coletarIds: array de objetos itens[].id_arquivo', () => {
    const ids = coletarIds({ body:{ itens:[{id_arquivo:10},{id_arquivo:20}] } }, ['id_arquivo']);
    assert.deepEqual(new Set(ids), new Set([10,20]));
  });
  t('coletarIds: array de escalares ids[] (bulk-delete)', () => {
    const ids = coletarIds({ body:{ ids:[3,4,5] } }, ['ids','id']);
    assert.deepEqual(new Set(ids), new Set([3,4,5]));
  });
  t('coletarIds: mapeamentos[].id_empresa (upsert em lote)', () => {
    const ids = coletarIds({ body:{ mapeamentos:[{id_empresa:7},{id_empresa:8}] } }, ['id_empresa','id']);
    assert.deepEqual(new Set(ids), new Set([7,8]));
  });
  t('coletarIds: sem nenhum campo → vazio', () => {
    assert.deepEqual(coletarIds({ body:{ foo:1 }, params:{}, query:{} }, ['id']), []);
  });

  await ta('redeDoRecurso sped por CORPO: id_sped_arquivo no body', async () => {
    const rede = await redeDoRecurso(poolMap({ '55': 4 }), 'sped', { body:{ id_sped_arquivo: 55 } });
    assert.equal(rede, 4);
  });
  await ta('redeDoRecurso empresa por QUERY: id_empresa na query', async () => {
    const rede = await redeDoRecurso(poolMap({ '9': 2 }), 'empresa', { query:{ id_empresa:'9' } });
    assert.equal(rede, 2);
  });

  // -------- multi-id: só passa se TODOS os ids forem da MESMA rede --------
  await ta('redeDoRecurso multi-id: todos na mesma rede → devolve a rede', async () => {
    const rede = await redeDoRecurso(poolMap({ '10':7, '20':7 }), 'sped', { body:{ itens:[{id_arquivo:10},{id_arquivo:20}] } });
    assert.equal(rede, 7);
  });
  await ta('redeDoRecurso multi-id: ids em redes DIFERENTES → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({ '10':7, '20':9 }), 'sped', { body:{ ids:[10,20] } });
    assert.equal(rede, null);
  });
  await ta('redeDoRecurso multi-id: UM id inexistente → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({ '10':7 }), 'sped', { body:{ updates:[{id_sped:10},{id_sped:20}] } });
    assert.equal(rede, null);
  });
  await ta('scopeRede multi-id: ids mistos (própria + de outra rede) → 403, sem next()', async () => {
    const mw = scopeRede(poolMap({ '10':7, '20':9 }), 'sped');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:7}, user:{email:'a@b'}, body:{ itens:[{id_arquivo:10},{id_arquivo:20}] }, params:{}}, res, ()=>{called=true;});
    assert.equal(called, false); assert.ok(code===403||code===404, `esperado 403/404, veio ${code}`);
  });

  // ================= CHAVE (chave NF-e → binding → rede) =================
  await ta('redeDoRecurso chave: chave de 44 dígitos com 1 binding → rede', async () => {
    const chv = '1'.repeat(44);
    const rede = await redeDoRecurso(poolMap({ [chv]: 3 }), 'chave', { params:{ chave: chv } });
    assert.equal(rede, 3);
  });
  await ta('redeDoRecurso chave: :chave_nfe (alias) também resolve', async () => {
    const chv = '2'.repeat(44);
    const rede = await redeDoRecurso(poolMap({ [chv]: 5 }), 'chave', { params:{ chave_nfe: chv } });
    assert.equal(rede, 5);
  });
  await ta('redeDoRecurso chave: SEM binding (só cache global) → null (fail-closed, nunca cross-tenant)', async () => {
    const chv = '3'.repeat(44);
    const rede = await redeDoRecurso(poolMap({}), 'chave', { params:{ chave: chv } });
    assert.equal(rede, null);
  });
  await ta('redeDoRecurso chave: binding em DUAS redes → null (ambíguo, fail-closed)', async () => {
    const chv = '4'.repeat(44);
    const rede = await redeDoRecurso(poolMap({ [chv]: [1,2] }), 'chave', { params:{ chave: chv } });
    assert.equal(rede, null);
  });
  await ta('redeDoRecurso chave: chave malformada (<44) → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({ '123':9 }), 'chave', { params:{ chave: '123' } });
    assert.equal(rede, null);
  });

  // ================= CNPJ (posto) — e a armadilha da credenciadora =================
  await ta('redeDoRecurso cnpj: CNPJ do posto resolve para a rede da empresa', async () => {
    const rede = await redeDoRecurso(poolMap({ '11222333000181': 6 }), 'cnpj', { params:{ cnpj:'11.222.333/0001-81' } });
    assert.equal(rede, 6);
  });
  await ta('redeDoRecurso cnpj por CORPO: cnpj no body', async () => {
    const rede = await redeDoRecurso(poolMap({ '11222333000181': 6 }), 'cnpj', { body:{ cnpj:'11222333000181' } });
    assert.equal(rede, 6);
  });
  await ta('redeDoRecurso cnpj: mesmo CNPJ em DUAS redes → null (ambíguo, fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({ '11222333000181': [1,2] }), 'cnpj', { body:{ cnpj:'11222333000181' } });
    assert.equal(rede, null);
  });
  await ta('redeDoRecurso cnpj: CNPJ de CREDENCIADORA (não é posto) → null (fail-closed)', async () => {
    // credenciadoras[].cnpj cai no bucket cnpj mas NÃO casa com nenhuma empresa → deny
    const rede = await redeDoRecurso(poolMap({}), 'cnpj', { body:{ credenciadoras:[{ cnpj:'99888777000166' }] } });
    assert.equal(rede, null);
  });

  // ================= RESOLVERS INDIRETOS (Onda 3) =================
  // depara: DELETE /api/de-para/:id — de_para_xml.id → id_empresa → rede.
  await ta('redeDoRecurso depara: de_para_xml.id → rede da empresa dona', async () => {
    const rede = await redeDoRecurso(poolMap({ '31': 6 }), 'depara', { params:{ id:'31' } });
    assert.equal(rede, 6);
  });
  await ta('redeDoRecurso depara inexistente → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({}), 'depara', { params:{ id:'999' } });
    assert.equal(rede, null);
  });
  await ta('scopeRede depara: ator de outra rede → 403 (não 404 fantasma)', async () => {
    const mw = scopeRede(poolMap({ '31':6 }), 'depara');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:2}, user:{email:'a@b'}, params:{id:'31'}}, res, ()=>{called=true;});
    assert.equal(code, 403); assert.equal(called, false);
  });
  await ta('scopeRede depara: ator dono → next()', async () => {
    const mw = scopeRede(poolMap({ '31':6 }), 'depara');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:6}, user:{email:'a@b'}, params:{id:'31'}}, res, ()=>{called=true;});
    assert.equal(called, true); assert.equal(code, null);
  });

  // correcao: DELETE /api/validador/correcoes/:idCorrecao — val_correcoes.id → arquivo → empresa → rede.
  await ta('redeDoRecurso correcao: val_correcoes.id → rede (via :idCorrecao)', async () => {
    const rede = await redeDoRecurso(poolMap({ '88': 3 }), 'correcao', { params:{ idCorrecao:'88' } });
    assert.equal(rede, 3);
  });
  await ta('redeDoRecurso correcao inexistente → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({}), 'correcao', { params:{ idCorrecao:'999' } });
    assert.equal(rede, null);
  });
  await ta('scopeRede correcao: ator de outra rede → 403', async () => {
    const mw = scopeRede(poolMap({ '88':3 }), 'correcao');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:9}, user:{email:'a@b'}, params:{idCorrecao:'88'}}, res, ()=>{called=true;});
    assert.equal(code, 403); assert.equal(called, false);
  });

  // item: POST /api/corrigir-item — corpo { tipo, id_item }; tabela por tipo → rede.
  await ta('redeDoRecurso item C170: id_item → rede (via documento → arquivo → empresa)', async () => {
    const rede = await redeDoRecurso(poolMap({ '100': 5 }), 'item', { body:{ tipo:'C170', id_item:100 } });
    assert.equal(rede, 5);
  });
  await ta('redeDoRecurso item LMC: id_item → rede', async () => {
    const rede = await redeDoRecurso(poolMap({ '200': 8 }), 'item', { body:{ tipo:'LMC', id_item:200 } });
    assert.equal(rede, 8);
  });
  await ta('redeDoRecurso item sem tipo → undefined (400 recurso não identificado)', async () => {
    const rede = await redeDoRecurso(poolMap({ '100':5 }), 'item', { body:{ id_item:100 } });
    assert.equal(rede, undefined);
  });
  await ta('redeDoRecurso item tipo desconhecido → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({ '100':5 }), 'item', { body:{ tipo:'ZZZ', id_item:100 } });
    assert.equal(rede, null);
  });
  await ta('redeDoRecurso item inexistente → null (fail-closed)', async () => {
    const rede = await redeDoRecurso(poolMap({}), 'item', { body:{ tipo:'C100', id_item:999 } });
    assert.equal(rede, null);
  });
  await ta('scopeRede item: ator de outra rede → 403', async () => {
    const mw = scopeRede(poolMap({ '100':5 }), 'item');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:1}, user:{email:'a@b'}, body:{tipo:'C170', id_item:100}, params:{}}, res, ()=>{called=true;});
    assert.equal(code, 403); assert.equal(called, false);
  });
  await ta('scopeRede item: ator dono → next()', async () => {
    const mw = scopeRede(poolMap({ '100':5 }), 'item');
    let code=null,called=false; const res={status(c){code=c;return this;},json(){return this;}};
    await mw({ator:{role:'admin',rede_id:5}, user:{email:'a@b'}, body:{tipo:'C170', id_item:100}, params:{}}, res, ()=>{called=true;});
    assert.equal(called, true); assert.equal(code, null);
  });

  console.log(`\nscoperede-unit: ${pass} passaram, ${fail} falharam`);
  if (fail) { fails.forEach(f=>console.log('  ✗ '+f)); process.exit(1); }
})();
