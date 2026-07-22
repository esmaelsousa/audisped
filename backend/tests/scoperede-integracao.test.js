// backend/tests/scoperede-integracao.test.js
//   cd backend && node -r dotenv/config tests/scoperede-integracao.test.js   (precisa DB local)
//
// Teste ADVERSARIAL de isolamento por rede (Fase 1, Task 8 — amostra empresa/sped).
// Prova, contra o BACKEND REAL, que:
//   - admin da Rede A → recurso da Rede B  → 403  (empresa E sped)
//   - admin da Rede A → PRÓPRIO recurso     → 200  (empresa E sped)
//   - simetria: admin B → recurso A → 403; próprio B → 200
//   - super_admin (bypass cross-tenant) → recurso de QUALQUER rede → 200
//
// Semeia 2 redes + 1 empresa + 1 arquivo + 1 admin em cada (e 1 super_admin), sobe o server
// numa PORTA DEDICADA (não colide com o dev em 15435), roda, DERRUBA o processo e LIMPA os
// dados semeados no finally — SEMPRE, mesmo em falha.

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const TEST_PORT = 15911; // porta isolada do dev (15435) → não derruba servidor local em uso
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const SENHA = 'scoperede-test-123';
const TAG = '__scoperede_it__'; // marcador p/ limpeza

const pool = new Pool({
  user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

// --- HTTP helper (sem dependências externas) ---
function req(method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { let body; try { body = JSON.parse(data); } catch { body = data; } resolve({ status: res.statusCode, body }); });
    });
    r.on('error', reject);
    r.end();
  });
}

async function esperarServidor(tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try { const r = await req('GET', '/favicon.ico'); if (r.status) return true; } catch { /* ainda subindo */ }
    await new Promise((s) => setTimeout(s, 500));
  }
  throw new Error('servidor de teste não respondeu a tempo');
}

async function login(email) {
  const r = new URL(BASE + '/api/auth/login');
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ email, senha: SENHA });
    const rq = http.request({ hostname: r.hostname, port: r.port, path: r.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('login resp inválida: ' + d)); } }); });
    rq.on('error', reject); rq.write(payload); rq.end();
  });
}

const seeded = { redes: [], empresas: [], arquivos: [], usuarios: [] };

const CNPJ_A = 'ZZSCPA00000001'; // 14 chars (empresas.cnpj é varchar(14)); prefixo improvável de colidir
const CNPJ_B = 'ZZSCPB00000001';

async function preLimpar() {
  // Defensivo: remove qualquer resíduo TAG de uma execução anterior interrompida.
  await pool.query(`DELETE FROM usuarios WHERE email LIKE $1`, [TAG + '%']);
  await pool.query(`DELETE FROM sped_arquivos WHERE cnpj_empresa IN ($1,$2)`, [CNPJ_A, CNPJ_B]);
  await pool.query(`DELETE FROM empresas WHERE cnpj IN ($1,$2)`, [CNPJ_A, CNPJ_B]);
  await pool.query(`DELETE FROM redes WHERE nome LIKE $1`, [TAG + '%']);
}

async function semear() {
  const hash = bcrypt.hashSync(SENHA, 8);
  const rA = (await pool.query(`INSERT INTO redes (nome, status) VALUES ($1,'ativa') RETURNING id`, [TAG + 'A'])).rows[0].id;
  const rB = (await pool.query(`INSERT INTO redes (nome, status) VALUES ($1,'ativa') RETURNING id`, [TAG + 'B'])).rows[0].id;
  seeded.redes.push(rA, rB);

  const eA = (await pool.query(`INSERT INTO empresas (cnpj, nome_empresa, rede_id) VALUES ($1,$2,$3) RETURNING id`, [CNPJ_A, 'EMPRESA A', rA])).rows[0].id;
  const eB = (await pool.query(`INSERT INTO empresas (cnpj, nome_empresa, rede_id) VALUES ($1,$2,$3) RETURNING id`, [CNPJ_B, 'EMPRESA B', rB])).rows[0].id;
  seeded.empresas.push(eA, eB);

  const aA = (await pool.query(`INSERT INTO sped_arquivos (nome_arquivo, cnpj_empresa, periodo_apuracao, id_empresa) VALUES ($1,$2,'2026-01',$3) RETURNING id`, [TAG + 'arqA.txt', CNPJ_A, eA])).rows[0].id;
  const aB = (await pool.query(`INSERT INTO sped_arquivos (nome_arquivo, cnpj_empresa, periodo_apuracao, id_empresa) VALUES ($1,$2,'2026-01',$3) RETURNING id`, [TAG + 'arqB.txt', CNPJ_B, eB])).rows[0].id;
  seeded.arquivos.push(aA, aB);

  const uA = (await pool.query(`INSERT INTO usuarios (nome, email, senha, role, rede_id, ativo) VALUES ('adminA',$1,$2,'admin',$3,true) RETURNING id`, [TAG + 'adminA@test.local', hash, rA])).rows[0].id;
  const uB = (await pool.query(`INSERT INTO usuarios (nome, email, senha, role, rede_id, ativo) VALUES ('adminB',$1,$2,'admin',$3,true) RETURNING id`, [TAG + 'adminB@test.local', hash, rB])).rows[0].id;
  const uS = (await pool.query(`INSERT INTO usuarios (nome, email, senha, role, rede_id, ativo) VALUES ('super',$1,$2,'super_admin',NULL,true) RETURNING id`, [TAG + 'super@test.local', hash])).rows[0].id;
  seeded.usuarios.push(uA, uB, uS);

  return { rA, rB, eA, eB, aA, aB };
}

async function limpar() {
  // Ordem respeita FKs: usuarios/arquivos → empresas → redes.
  if (seeded.usuarios.length) await pool.query(`DELETE FROM usuarios WHERE id = ANY($1)`, [seeded.usuarios]);
  if (seeded.arquivos.length) await pool.query(`DELETE FROM sped_arquivos WHERE id = ANY($1)`, [seeded.arquivos]);
  if (seeded.empresas.length) await pool.query(`DELETE FROM empresas WHERE id = ANY($1)`, [seeded.empresas]);
  if (seeded.redes.length) await pool.query(`DELETE FROM redes WHERE id = ANY($1)`, [seeded.redes]);
}

let child;
let pass = 0, fail = 0; const fails = [];
const check = (nome, cond, detalhe) => { if (cond) pass++; else { fail++; fails.push(`${nome} — ${detalhe}`); } };

(async () => {
  try {
    await preLimpar();
    const ids = await semear();

    // Sobe o backend numa porta dedicada.
    child = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(TEST_PORT), DEMO_MODE: '0' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('exit', (code) => { if (code && code !== 0 && !child._killedByTest) console.error('[server saiu code=' + code + ']\n' + stderr.slice(-800)); });

    await esperarServidor();

    const la = await login(TAG + 'adminA@test.local');
    const lb = await login(TAG + 'adminB@test.local');
    const ls = await login(TAG + 'super@test.local');
    assert.ok(la.token && lb.token && ls.token, 'os 3 logins têm que devolver token');
    const tA = la.token, tB = lb.token, tS = ls.token;

    // ---- empresa: admin A ----
    let r;
    r = await req('GET', `/api/arquivos/${ids.eA}`, tA);
    check('empresa/próprio (A→A)', r.status === 200, `esperado 200, veio ${r.status}`);
    r = await req('GET', `/api/arquivos/${ids.eB}`, tA);
    check('empresa/cross (A→B)', r.status === 403, `esperado 403, veio ${r.status}`);

    // ---- sped: admin A ----
    r = await req('GET', `/api/arquivo/info/${ids.aA}`, tA);
    check('sped/próprio (A→A)', r.status === 200, `esperado 200, veio ${r.status}`);
    r = await req('GET', `/api/arquivo/info/${ids.aB}`, tA);
    check('sped/cross (A→B)', r.status === 403, `esperado 403, veio ${r.status}`);

    // ---- simetria: admin B ----
    r = await req('GET', `/api/arquivos/${ids.eA}`, tB);
    check('empresa/cross (B→A)', r.status === 403, `esperado 403, veio ${r.status}`);
    r = await req('GET', `/api/arquivo/info/${ids.aB}`, tB);
    check('sped/próprio (B→B)', r.status === 200, `esperado 200, veio ${r.status}`);

    // ---- bypass: super_admin vê qualquer rede ----
    r = await req('GET', `/api/arquivo/info/${ids.aB}`, tS);
    check('bypass super_admin → sped rede B', r.status === 200, `esperado 200, veio ${r.status}`);
    r = await req('GET', `/api/arquivos/${ids.eA}`, tS);
    check('bypass super_admin → empresa rede A', r.status === 200, `esperado 200, veio ${r.status}`);

    console.log(`\nscoperede-integracao: ${pass} passaram, ${fail} falharam`);
    if (fail) fails.forEach((f) => console.log('  ✗ ' + f));
  } catch (e) {
    fail++;
    console.error('scoperede-integracao: ERRO —', e.message);
  } finally {
    if (child && !child.killed) { child._killedByTest = true; child.kill('SIGKILL'); }
    try { await limpar(); } catch (e) { console.error('falha ao limpar seed:', e.message); }
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
