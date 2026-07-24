// backend/tests/scoperede-integracao.test.js
//   cd backend && node -r dotenv/config tests/scoperede-integracao.test.js   (precisa DB local)
//
// Teste ADVERSARIAL de isolamento por rede (Fase 1, Task 8 — EXAUSTIVO).
// Prova, contra o BACKEND REAL, para CADA variante de posse do scopeRede:
//   (empresa, sped, chave, cnpj, indiretos [item/correcao/depara], write [upload/empresa/contrib])
//     - admin da Rede A → PRÓPRIO recurso (Rede A)  → 200
//     - admin da Rede A → recurso da Rede B          → 403  (IDOR cross-tenant fechado)
//     - super_admin (ROLES_CROSS_TENANT) → recurso de QUALQUER rede → 200 (bypass)
//   + write-path: Rede B NÃO apaga/sobrescreve escrituração da Rede A ao subir o mesmo CNPJ.
//   + GOLDEN não-regressão: export byte-idêntico entre o caminho de BYPASS (super_admin) e o
//     caminho de DONO legítimo (scopeRede resolve a cadeia e libera) — prova que o guard, que roda
//     ANTES do corpo, NÃO altera 1 byte do SPED exportado.
//
// Semeia 2 redes + 1 empresa/arquivo/admin cada + 1 super_admin + recursos-filho de cada variante,
// sobe o server numa PORTA DEDICADA (não colide com o dev em 15435), roda, DERRUBA o processo e
// LIMPA os dados semeados no finally — SEMPRE, mesmo em falha.

const assert = require('assert');
const http = require('http');
const fs = require('fs');
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

// CNPJs NUMÉRICOS (14 dígitos) — obrigatórios p/ a variante 'cnpj' (o resolver normaliza p/ dígitos
// e exige >=11). Prefixo 9999... é implausível p/ posto real → 0 colisão (verificado no DB de teste).
const CNPJ_A = '99990000000001';
const CNPJ_B = '99990000000002';
const CRLF = '\r\n';

// Chave NF-e de 44 dígitos, ÚNICA por rede (embute o CNPJ da empresa → nunca colide entre A e B nem
// com dado real). O resolver 'chave' liga a chave à rede via mde_cache.id_empresa.
const mkChave = (cnpj) => (cnpj + '355001000000000119999888877666').slice(0, 44);
const CHAVE_A = mkChave(CNPJ_A);
const CHAVE_B = mkChave(CNPJ_B);

// SPED mínimo (só 0000+9999) com o CNPJ passado no cabeçalho (fields[7]). Basta para o write-path:
// o guard de rede dispara no CNPJ, ANTES de qualquer dedup/insert de filhos.
const spedTxt = (cnpj) => `|0000|017|0|01012026|31012026|EMPRESA|${cnpj}|X|SP|${CRLF}|9999|2|${CRLF}`;
// EFD-Contribuições mínima (0000 com CNPJ em fields[9], não casa com as empresas semeadas).
const contribTxt = () => `|0000|005|0|0|0|0|01012026|31012026|EMPRESA|11222333000181|SP|${CRLF}|9999|2|${CRLF}`;

// --- HTTP helper JSON (sem dependências externas) ---
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

// --- HTTP helper RAW (bytes) — usado pelo golden do export (comparação byte-a-byte) ---
function reqRaw(method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
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

const seeded = { redes: [], empresas: [], arquivos: [], usuarios: [], mde: [] };

// multipart/form-data manual (sem libs) — bytes em latin-1, compatível com multer (disk e memory).
function uploadMultipart(method, urlPath, token, { fields = {}, files = [] }) {
  const boundary = '----scoperedeIT' + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const [k, v] of Object.entries(fields))
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`, 'latin1'));
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${f.field}"; filename="${f.filename}"${CRLF}Content-Type: text/plain${CRLF}${CRLF}`, 'latin1'));
    chunks.push(Buffer.from(f.content, 'latin1'));
    chunks.push(Buffer.from(CRLF, 'latin1'));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'latin1'));
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { let b; try { b = JSON.parse(d); } catch { b = d; } resolve({ status: res.statusCode, body: b }); }); });
    rq.on('error', reject); rq.write(body); rq.end();
  });
}

// POST JSON helper (corpo) — usado por corrigir-item.
function postJson(urlPath, token, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const data = JSON.stringify(payload);
    const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { let b; try { b = JSON.parse(d); } catch { b = d; } resolve({ status: res.statusCode, body: b }); }); });
    rq.on('error', reject); rq.write(data); rq.end();
  });
}

async function preLimpar() {
  // Defensivo: remove qualquer resíduo TAG de uma execução anterior interrompida.
  await pool.query(`DELETE FROM usuarios WHERE email LIKE $1`, [TAG + '%']);
  await pool.query(`DELETE FROM de_para_xml WHERE cod_produto_xml LIKE $1`, [TAG + '%']);
  await pool.query(`DELETE FROM mde_cache WHERE id_empresa IN (SELECT id FROM empresas WHERE cnpj IN ($1,$2))`, [CNPJ_A, CNPJ_B]);
  await pool.query(`DELETE FROM efd_contrib_linhas WHERE id_arquivo IN (SELECT id FROM efd_contrib_arquivos WHERE id_empresa IN (SELECT id FROM empresas WHERE cnpj IN ($1,$2)))`, [CNPJ_A, CNPJ_B]);
  await pool.query(`DELETE FROM efd_contrib_arquivos WHERE id_empresa IN (SELECT id FROM empresas WHERE cnpj IN ($1,$2))`, [CNPJ_A, CNPJ_B]);
  await pool.query(`DELETE FROM val_correcoes WHERE id_sped_arquivo IN (SELECT id FROM sped_arquivos WHERE cnpj_empresa IN ($1,$2))`, [CNPJ_A, CNPJ_B]);
  await pool.query(`DELETE FROM documentos_c100 WHERE id_sped_arquivo IN (SELECT id FROM sped_arquivos WHERE cnpj_empresa IN ($1,$2))`, [CNPJ_A, CNPJ_B]);
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

  // --- variante 'chave': mde_cache liga chave → id_empresa → rede. Com xml_content p/ o handler
  //     GET /api/mde/xml/:chave_nfe devolver 200 no caminho liberado. ---
  const mA = (await pool.query(`INSERT INTO mde_cache (id_empresa, chave_nfe, xml_content) VALUES ($1,$2,$3) RETURNING id`, [eA, CHAVE_A, '<nfeA/>'])).rows[0].id;
  const mB = (await pool.query(`INSERT INTO mde_cache (id_empresa, chave_nfe, xml_content) VALUES ($1,$2,$3) RETURNING id`, [eB, CHAVE_B, '<nfeB/>'])).rows[0].id;
  seeded.mde.push(mA, mB);

  // --- variante 'depara' (indireto): de_para_xml.id → id_empresa → rede.
  //     2 por rede: 1 p/ os testes do adminA (own/cross), 1 p/ o bypass do super_admin. ---
  const dA_own = (await pool.query(`INSERT INTO de_para_xml (id_empresa, cnpj_emissor, cod_produto_xml) VALUES ($1,$2,$3) RETURNING id`, [eA, CNPJ_A, TAG + 'pAown'])).rows[0].id;
  const dB_cross = (await pool.query(`INSERT INTO de_para_xml (id_empresa, cnpj_emissor, cod_produto_xml) VALUES ($1,$2,$3) RETURNING id`, [eB, CNPJ_B, TAG + 'pBcross'])).rows[0].id;
  const dA_byp = (await pool.query(`INSERT INTO de_para_xml (id_empresa, cnpj_emissor, cod_produto_xml) VALUES ($1,$2,$3) RETURNING id`, [eA, CNPJ_A, TAG + 'pAbyp'])).rows[0].id;
  const dB_byp = (await pool.query(`INSERT INTO de_para_xml (id_empresa, cnpj_emissor, cod_produto_xml) VALUES ($1,$2,$3) RETURNING id`, [eB, CNPJ_B, TAG + 'pBbyp'])).rows[0].id;

  // --- variante 'correcao' (indireto): val_correcoes.id → id_sped_arquivo → arquivo → empresa → rede.
  //     2 por rede (own/cross + bypass). ---
  const mkCorr = async (arq) => (await pool.query(`INSERT INTO val_correcoes (id_sped_arquivo, regra_id, registro, chave_natural, campo_idx, valor_corrigido, ativo) VALUES ($1,'TEST','C100','k',1,'x',true) RETURNING id`, [arq])).rows[0].id;
  const cA_own = await mkCorr(aA);
  const cB_cross = await mkCorr(aB);
  const cA_byp = await mkCorr(aA);
  const cB_byp = await mkCorr(aB);

  // --- variante 'item' (indireto): documentos_c100.id → id_sped_arquivo → rede
  //     (alvo de POST /api/corrigir-item tipo 'C100'). ---
  const docA = (await pool.query(`INSERT INTO documentos_c100 (id_sped_arquivo, num_doc) VALUES ($1,'1') RETURNING id`, [aA])).rows[0].id;
  const docB = (await pool.query(`INSERT INTO documentos_c100 (id_sped_arquivo, num_doc) VALUES ($1,'1') RETURNING id`, [aB])).rows[0].id;

  // --- GOLDEN do export: escolhe um sped_arquivos REAL do DB cujo arquivo físico exista (menor
  //     tamanho p/ export rápido) e semeia um admin na rede DONA dele. Isso permite exercitar o
  //     caminho de DONO legítimo (resolver da cadeia) e compará-lo, byte-a-byte, com o bypass. ---
  let goldenId = null, goldenRede = null;
  {
    const cand = await pool.query(
      `SELECT s.id, s.caminho_arquivo, e.rede_id FROM sped_arquivos s
         JOIN empresas e ON e.id = s.id_empresa
        WHERE s.caminho_arquivo IS NOT NULL AND e.rede_id IS NOT NULL
        ORDER BY s.id DESC LIMIT 300`);
    let best = null;
    for (const row of cand.rows) {
      let pth = row.caminho_arquivo;
      try { const parsed = JSON.parse(pth); if (parsed && typeof parsed === 'object') pth = Object.values(parsed)[0]; } catch { /* string simples */ }
      try {
        if (pth && fs.existsSync(pth)) {
          const sz = fs.statSync(pth).size;
          if (!best || sz < best.sz) best = { id: row.id, rede: row.rede_id, sz };
        }
      } catch { /* ignora */ }
    }
    if (best) {
      goldenId = best.id; goldenRede = best.rede;
      const uG = (await pool.query(`INSERT INTO usuarios (nome, email, senha, role, rede_id, ativo) VALUES ('goldenAdmin',$1,$2,'admin',$3,true) RETURNING id`, [TAG + 'golden@test.local', hash, goldenRede])).rows[0].id;
      seeded.usuarios.push(uG);
    }
  }

  return { rA, rB, eA, eB, aA, aB, docA, docB,
    dA_own, dB_cross, dA_byp, dB_byp, cA_own, cB_cross, cA_byp, cB_byp,
    goldenId, goldenRede };
}

async function limpar() {
  // Ordem respeita FKs: filhos → arquivos → empresas → redes. Inclui os artefatos criados
  // pelos uploads do write-path (novos sped_arquivos/efd_contrib por id_empresa das empresas seed).
  if (seeded.usuarios.length) await pool.query(`DELETE FROM usuarios WHERE id = ANY($1)`, [seeded.usuarios]);
  if (seeded.empresas.length) {
    await pool.query(`DELETE FROM mde_cache WHERE id_empresa = ANY($1)`, [seeded.empresas]);
    await pool.query(`DELETE FROM efd_contrib_linhas WHERE id_arquivo IN (SELECT id FROM efd_contrib_arquivos WHERE id_empresa = ANY($1))`, [seeded.empresas]);
    await pool.query(`DELETE FROM efd_contrib_arquivos WHERE id_empresa = ANY($1)`, [seeded.empresas]);
    await pool.query(`DELETE FROM val_correcoes WHERE id_sped_arquivo IN (SELECT id FROM sped_arquivos WHERE id_empresa = ANY($1))`, [seeded.empresas]);
    await pool.query(`DELETE FROM documentos_c100 WHERE id_sped_arquivo IN (SELECT id FROM sped_arquivos WHERE id_empresa = ANY($1))`, [seeded.empresas]);
    await pool.query(`DELETE FROM de_para_xml WHERE id_empresa = ANY($1)`, [seeded.empresas]);
    await pool.query(`DELETE FROM sped_arquivos WHERE id_empresa = ANY($1)`, [seeded.empresas]);
  }
  if (seeded.empresas.length) await pool.query(`DELETE FROM empresas WHERE id = ANY($1)`, [seeded.empresas]);
  if (seeded.redes.length) await pool.query(`DELETE FROM redes WHERE id = ANY($1)`, [seeded.redes]);
}

let child;
let pass = 0, fail = 0; const fails = [];
const check = (nome, cond, detalhe) => { if (cond) pass++; else { fail++; fails.push(`${nome} — ${detalhe}`); } };

(async () => {
  try {
    assert.equal(CHAVE_A.length, 44, 'CHAVE_A deve ter 44 dígitos');
    assert.equal(CHAVE_B.length, 44, 'CHAVE_B deve ter 44 dígitos');
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

    let r;

    // ================= VARIANTE 'empresa' (resolve por id_empresa) =================
    r = await req('GET', `/api/arquivos/${ids.eA}`, tA);
    check('empresa/próprio (A→A) → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/arquivos/${ids.eB}`, tA);
    check('empresa/cross (A→B) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('GET', `/api/arquivos/${ids.eA}`, tB);
    check('empresa/cross simetria (B→A) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('GET', `/api/arquivos/${ids.eA}`, tS);
    check('empresa/bypass super_admin → A → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/arquivos/${ids.eB}`, tS);
    check('empresa/bypass super_admin → B → 200', r.status === 200, `veio ${r.status}`);

    // ================= VARIANTE 'sped' (resolve por arquivo) =================
    r = await req('GET', `/api/arquivo/info/${ids.aA}`, tA);
    check('sped/próprio (A→A) → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/arquivo/info/${ids.aB}`, tA);
    check('sped/cross (A→B) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('GET', `/api/arquivo/info/${ids.aB}`, tB);
    check('sped/próprio simetria (B→B) → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/arquivo/info/${ids.aA}`, tS);
    check('sped/bypass super_admin → A → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/arquivo/info/${ids.aB}`, tS);
    check('sped/bypass super_admin → B → 200', r.status === 200, `veio ${r.status}`);

    // ================= VARIANTE 'chave' (resolve por chave NF-e → mde_cache → empresa → rede) =========
    r = await req('GET', `/api/mde/xml/${CHAVE_A}`, tA);
    check('chave/próprio (A→A) → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/mde/xml/${CHAVE_B}`, tA);
    check('chave/cross (A→B) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('GET', `/api/mde/xml/${CHAVE_A}`, tB);
    check('chave/cross simetria (B→A) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('GET', `/api/mde/xml/${CHAVE_A}`, tS);
    check('chave/bypass super_admin → A → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/mde/xml/${CHAVE_B}`, tS);
    check('chave/bypass super_admin → B → 200', r.status === 200, `veio ${r.status}`);

    // ================= VARIANTE 'cnpj' (resolve por CNPJ → empresas.rede_id) =================
    r = await req('GET', `/api/lmc/tanques-config/${CNPJ_A}`, tA);
    check('cnpj/próprio (A→A) → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/lmc/tanques-config/${CNPJ_B}`, tA);
    check('cnpj/cross (A→B) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('GET', `/api/lmc/tanques-config/${CNPJ_A}`, tB);
    check('cnpj/cross simetria (B→A) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('GET', `/api/lmc/tanques-config/${CNPJ_A}`, tS);
    check('cnpj/bypass super_admin → A → 200', r.status === 200, `veio ${r.status}`);
    r = await req('GET', `/api/lmc/tanques-config/${CNPJ_B}`, tS);
    check('cnpj/bypass super_admin → B → 200', r.status === 200, `veio ${r.status}`);

    // ================= VARIANTE 'item' (indireto: documentos_c100 → arquivo → rede) =================
    // POST /api/corrigir-item (corpo { tipo, id_item }). Idempotente (num_doc='2') → seguro repetir.
    r = await postJson('/api/corrigir-item', tA, { tipo: 'C100', id_item: ids.docB, novos_valores: { num_doc: '2' } });
    check('item/cross (A→docB) → 403', r.status === 403, `veio ${r.status}`);
    r = await postJson('/api/corrigir-item', tA, { tipo: 'C100', id_item: ids.docA, novos_valores: { num_doc: '2' } });
    check('item/próprio (A→docA) → 200', r.status === 200, `veio ${r.status}`);
    r = await postJson('/api/corrigir-item', tS, { tipo: 'C100', id_item: ids.docA, novos_valores: { num_doc: '3' } });
    check('item/bypass super_admin → docA → 200', r.status === 200, `veio ${r.status}`);
    r = await postJson('/api/corrigir-item', tS, { tipo: 'C100', id_item: ids.docB, novos_valores: { num_doc: '3' } });
    check('item/bypass super_admin → docB → 200', r.status === 200, `veio ${r.status}`);

    // ================= VARIANTE 'correcao' (indireto: val_correcoes → arquivo → rede) =================
    // DELETE /api/validador/correcoes/:idCorrecao. Cross ANTES (não apaga); depois own; bypass em rows dedicadas.
    r = await req('DELETE', `/api/validador/correcoes/${ids.cB_cross}`, tA);
    check('correcao/cross (A→cB) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('DELETE', `/api/validador/correcoes/${ids.cA_own}`, tA);
    check('correcao/próprio (A→cA) → 200', r.status === 200, `veio ${r.status}`);
    r = await req('DELETE', `/api/validador/correcoes/${ids.cA_byp}`, tS);
    check('correcao/bypass super_admin → cA → 200', r.status === 200, `veio ${r.status}`);
    r = await req('DELETE', `/api/validador/correcoes/${ids.cB_byp}`, tS);
    check('correcao/bypass super_admin → cB → 200', r.status === 200, `veio ${r.status}`);

    // ================= VARIANTE 'depara' (indireto: de_para_xml → empresa → rede) =================
    // DELETE /api/de-para/:id. Cross ANTES; depois own; bypass em rows dedicadas.
    r = await req('DELETE', `/api/de-para/${ids.dB_cross}`, tA);
    check('depara/cross (A→dB) → 403', r.status === 403, `veio ${r.status}`);
    r = await req('DELETE', `/api/de-para/${ids.dA_own}`, tA);
    check('depara/próprio (A→dA) → 200', r.status === 200, `veio ${r.status}`);
    r = await req('DELETE', `/api/de-para/${ids.dA_byp}`, tS);
    check('depara/bypass super_admin → dA → 200', r.status === 200, `veio ${r.status}`);
    r = await req('DELETE', `/api/de-para/${ids.dB_byp}`, tS);
    check('depara/bypass super_admin → dB → 200', r.status === 200, `veio ${r.status}`);

    // ================= WRITE-PATH (bucket 'write') =================
    // 1) Rede B tenta subir SPED do CNPJ da Rede A (mesmo período) → 403 e o arquivo da A INTACTO.
    const antes = (await pool.query(`SELECT count(*)::int n FROM sped_arquivos WHERE id = $1`, [ids.aA])).rows[0].n;
    r = await uploadMultipart('POST', '/api/upload', tB, { files: [{ field: 'spedfile', filename: 'b.txt', content: spedTxt(CNPJ_A) }] });
    check('write/upload cross (B sobe CNPJ_A) → 403', r.status === 403, `veio ${r.status} (${JSON.stringify(r.body).slice(0, 120)})`);
    const depois = (await pool.query(`SELECT count(*)::int n FROM sped_arquivos WHERE id = $1`, [ids.aA])).rows[0].n;
    check('write/upload cross NÃO apagou arquivo da Rede A', antes === 1 && depois === 1, `arquivo aA: antes=${antes} depois=${depois}`);

    // 2) Rede A sobe SPED do PRÓPRIO CNPJ → 200 (empresa/rede casam).
    r = await uploadMultipart('POST', '/api/upload', tA, { files: [{ field: 'spedfile', filename: 'a.txt', content: spedTxt(CNPJ_A) }] });
    check('write/upload próprio (A sobe CNPJ_A) → 200', r.status === 200 || r.status === 201, `veio ${r.status} (${JSON.stringify(r.body).slice(0, 120)})`);

    // 3) Contrib: Rede B faz upload com id_empresa da Rede A → 403.
    r = await uploadMultipart('POST', '/api/contribuicoes/upload', tB, {
      fields: { id_empresa: String(ids.eA) },
      files: [{ field: 'contribfile', filename: 'c.txt', content: contribTxt() }],
    });
    check('write/contrib cross (B usa id_empresa da A) → 403', r.status === 403, `veio ${r.status} (${JSON.stringify(r.body).slice(0, 120)})`);
    // 4) Contrib: Rede A faz upload com o PRÓPRIO id_empresa → 200.
    r = await uploadMultipart('POST', '/api/contribuicoes/upload', tA, {
      fields: { id_empresa: String(ids.eA) },
      files: [{ field: 'contribfile', filename: 'c.txt', content: contribTxt() }],
    });
    check('write/contrib próprio (A usa id_empresa da A) → 200', r.status === 200, `veio ${r.status} (${JSON.stringify(r.body).slice(0, 120)})`);

    // ================= GOLDEN — export byte-idêntico (não-regressão fiscal) =================
    // O scopeRede roda ANTES do corpo do export. Provamos que ele NÃO altera 1 byte do SPED:
    //   referência = export via super_admin (caminho de BYPASS: next() imediato, sem query)
    //   verificado = export via DONO legítimo (caminho do resolver: sobe arquivo→empresa→rede, libera)
    // Se o guard tocasse req/res/queries, os bytes divergiriam. Byte-idêntico = não-regressão provada.
    if (ids.goldenId) {
      const lg = await login(TAG + 'golden@test.local');
      const tG = lg.token;
      check('golden: login do dono da rede real', !!tG, 'login goldenAdmin não devolveu token');
      const ref = await reqRaw('GET', `/api/exportar-sped/${ids.goldenId}`, tS);  // bypass (super_admin)
      const own = await reqRaw('GET', `/api/exportar-sped/${ids.goldenId}`, tG);  // resolver (dono)
      check('golden: export via super_admin (referência) → 200', ref.status === 200, `veio ${ref.status}`);
      check('golden: export via dono (scopeRede ATIVO) → 200', own.status === 200, `veio ${own.status}`);
      check('golden: SPED byte-idêntico (scopeRede não alterou o export)',
        ref.status === 200 && own.status === 200 && ref.buf.length > 0 && ref.buf.equals(own.buf),
        `ref=${ref.buf.length}B own=${own.buf.length}B iguais=${ref.status === 200 && own.status === 200 && ref.buf.equals(own.buf)}`);
    } else {
      check('golden: arquivo real com físico disponível no DB de teste', false,
        'nenhum sped_arquivos com caminho físico existente encontrado — golden não pôde rodar');
    }

    console.log(`\nscoperede-integracao: ${pass} passaram, ${fail} falharam`);
    if (fail) fails.forEach((f) => console.log('  ✗ ' + f));
  } catch (e) {
    fail++;
    console.error('scoperede-integracao: ERRO —', e.stack || e.message);
  } finally {
    if (child && !child.killed) { child._killedByTest = true; child.kill('SIGKILL'); }
    try { await limpar(); } catch (e) { console.error('falha ao limpar seed:', e.message); }
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
