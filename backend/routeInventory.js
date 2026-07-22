// backend/routeInventory.js — inventário REAL de rotas do backend (Fase 1, isolamento por rede).
//
// Por que este módulo existe (achado do master, 2026-07-19):
//   O teste de cobertura original enumerava rotas com um regex sobre server.js e por isso
//   (a) NÃO enxergava sub-routers montados via `app.use('/prefix', require('./x')(...))`
//       → 2 rotas de DADOS do módulo EFD-Contribuições escapavam da classificação E do teste
//         (uma delas, GET /api/contribuicoes/exportar/:id, é um IDOR cross-tenant real);
//   (b) casava trechos COMENTADOS (ex.: o comentário em server.js que cita
//       app.get('/api/empresas')), inflando a contagem e mascarando renomeações.
//
// Solução: um inventário estático robusto que (1) remove comentários antes de casar e
// (2) segue os routers montados, lendo os arquivos de rota e prefixando com o mount-path.
// É estático de propósito (não sobe o servidor): não precisa de DB, não pendura processo,
// e roda como teste puro. Cobre os dois furos de regex-vs-AST sem bootar o monólito.

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = __dirname;
const METODOS = 'get|post|put|patch|delete';

// Remove comentários de bloco e de linha SEM corromper `://` (ex.: http://, chave 'a://b').
function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');            // /* ... */
  s = s.replace(/([^:])\/\/[^\n]*/g, '$1');                // ... // trailing (preserva `://`)
  s = s.replace(/^\s*\/\/[^\n]*/gm, '');                   // // linha inteira
  return s;
}

// Extrai as chamadas `<obj>.<metodo>('<rota>'` de um fonte já sem comentários.
function extrairRotas(strippedSrc, obj) {
  const re = new RegExp(`${obj}\\.(${METODOS})\\(\\s*'([^']*)'`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(strippedSrc))) out.push({ method: m[1].toUpperCase(), sub: m[2] });
  return out;
}

// Descobre sub-routers montados: `app.use('/prefix', require('./caminho')(...))`.
function extrairRoutersMontados(strippedSrc) {
  const re = /app\.use\(\s*'([^']+)'\s*,\s*require\(\s*'([^']+)'\s*\)/g;
  const out = [];
  let m;
  while ((m = re.exec(strippedSrc))) out.push({ mount: m[1], modulePath: m[2] });
  return out;
}

function juntar(mount, sub) {
  if (!sub || sub === '/') return mount;
  return mount + sub;
}

// Retorna [{ method, path, source }] com TODAS as rotas: as do server.js + as dos routers montados.
function inventariar(serverFile = path.join(BACKEND_DIR, 'server.js')) {
  const rawServer = fs.readFileSync(serverFile, 'utf8');
  const strippedServer = stripComments(rawServer);

  const rotas = extrairRotas(strippedServer, 'app').map(r => ({
    method: r.method, path: r.sub, source: path.basename(serverFile),
  }));

  for (const { mount, modulePath } of extrairRoutersMontados(strippedServer)) {
    let abs = path.resolve(BACKEND_DIR, modulePath);
    if (!abs.endsWith('.js')) abs += '.js';
    if (!fs.existsSync(abs)) continue; // router não-arquivo (raro) — ignora silenciosamente
    const strippedRouter = stripComments(fs.readFileSync(abs, 'utf8'));
    for (const r of extrairRotas(strippedRouter, 'router')) {
      rotas.push({ method: r.method, path: juntar(mount, r.sub), source: path.basename(abs) });
    }
  }
  return rotas;
}

// Chaves 'METHOD /path' (deduplicadas), na ordem de descoberta.
function chaves(serverFile) {
  const vistas = new Set();
  const out = [];
  for (const r of inventariar(serverFile)) {
    const k = `${r.method} ${r.path}`;
    if (!vistas.has(k)) { vistas.add(k); out.push(k); }
  }
  return out;
}

module.exports = { inventariar, chaves, stripComments };
