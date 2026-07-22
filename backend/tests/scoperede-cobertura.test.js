// backend/tests/scoperede-cobertura.test.js
//   node backend/tests/scoperede-cobertura.test.js   (teste puro, sem DB)
//
// Garantia DEFAULT-DENY do isolamento por rede (Fase 1): reprova qualquer rota /api/* que não
// esteja classificada no registro (ESCOPO) nem na allowlist (PUBLICAS). É o que impede que uma
// rota nova de dados suba sem escopo por esquecimento.
//
// O inventário vem de routeInventory.js (não de um regex local): inclui os sub-routers montados
// via app.use(...) e ignora código comentado — os dois furos que o master apontou no teste antigo.

const { chaves } = require('../routeInventory');
const { PUBLICAS, ESCOPO } = require('../routeScopeRegistry');

const VARIANTES = new Set(['empresa', 'sped', 'contrib', 'chave', 'cnpj', 'lista', 'global', 'self', 'write']);

const rotas = chaves();
const soApi = rotas.filter(r => r.split(' ')[1].startsWith('/api/'));

// 1) Cobertura para frente: toda rota /api/* tem que estar classificada ou pública.
const semClassificacao = soApi.filter(r => !PUBLICAS.has(r) && !(r in ESCOPO));

// 2) Higiene reversa: nenhuma chave do registro pode ser "fantasma" (rota que não existe mais).
const inventario = new Set(rotas);
const publicasFantasma = [...PUBLICAS].filter(k => !inventario.has(k));
const escopoFantasma = Object.keys(ESCOPO).filter(k => !inventario.has(k));

// 3) Sanidade: todo valor de ESCOPO é uma variante conhecida.
const variantesInvalidas = Object.entries(ESCOPO)
  .filter(([, v]) => !VARIANTES.has(v))
  .map(([k, v]) => `${k} → '${v}'`);

let falhou = false;

if (semClassificacao.length) {
  falhou = true;
  console.error('\nROTAS DE DADOS SEM CLASSIFICAÇÃO (classifique no registro ou marque pública):');
  semClassificacao.forEach(r => console.error('  ✗ ' + r));
}
if (publicasFantasma.length) {
  falhou = true;
  console.error('\nPUBLICAS aponta para rota inexistente (registro desatualizado):');
  publicasFantasma.forEach(r => console.error('  ✗ ' + r));
}
if (escopoFantasma.length) {
  falhou = true;
  console.error('\nESCOPO aponta para rota inexistente (registro desatualizado):');
  escopoFantasma.forEach(r => console.error('  ✗ ' + r));
}
if (variantesInvalidas.length) {
  falhou = true;
  console.error('\nVariante de escopo desconhecida:');
  variantesInvalidas.forEach(r => console.error('  ✗ ' + r));
}

// Resumo por variante (útil para auditoria humana).
const contagem = {};
for (const v of VARIANTES) contagem[v] = 0;
for (const v of Object.values(ESCOPO)) contagem[v]++;
const resumo = [...VARIANTES].map(v => `${v}=${contagem[v]}`).join('  ');

if (falhou) {
  console.error(`\nscoperede-cobertura: FALHOU — ${soApi.length} rotas /api, ${semClassificacao.length} sem classificação.`);
  process.exit(1);
}

console.log(`scoperede-cobertura: OK — ${rotas.length} rotas (${soApi.length} sob /api), todas classificadas.`);
console.log(`  PUBLICAS=${PUBLICAS.size}  |  ${resumo}`);
