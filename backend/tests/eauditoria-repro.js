// tests/eauditoria-repro.js — REGRESSÃO DE PAR CASADO.
// Roda o Validador no SPED do POSTO CG e confere contagens contra o relatório E-Auditoria
// "analise posto campos.pdf" (39778541000180, 06/2026). Cada número foi verificado byte-a-byte.
// Uso: node tests/eauditoria-repro.js   (skip se a fixture de cliente não estiver presente)
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { parseSped } = require('../services/validador/parser');
const { validar } = require('../services/validador/engine');

const FIX = path.join(__dirname, '..', '..', 'docs', '39778541000180_POSTO_CG_06-2026.txt');
if (!fs.existsSync(FIX)) { console.log('SKIP eauditoria-repro: fixture ausente (' + FIX + ')'); process.exit(0); }

const model = parseSped(fs.readFileSync(FIX, 'latin1'));
const r = validar(model);
const byId = {};
for (const e of r.erros) byId[e.regra_id] = (byId[e.regra_id] || 0) + 1;

// EXPECT: [regra_id, comparador, valor]. 'eq' = igual; 'gte' = >=.
const EXPECT = [
    // preenchido conforme as regras entram (Ondas 1 e 2)
    ['DOC-C100-VLDOC-01', 'gte', 200], // E-Auditoria corta em 200; motor acha ~742
    ['DOC-C170-ICMSSEMBASE-01', 'eq', 1],
    ['DOC-C190-ICMSSEMBASE-01', 'eq', 1],
    ['DOC-C190-REDBC-01', 'eq', 1],
    ['EST-9900-REGBLC-01', 'eq', 23],
    // DIVERGE de PROPÓSITO do E-Auditoria (que acha 12): a fórmula correta (Σ VL_ICMS dos C170) mostra
    // que os 12 são arredondamento agregado legítimo (VL_ICMS=ΣC170 ≠ round(BC×ALIQ)) — não erro.
    // Ver painel §3. Se voltar a 0 → OK; se disparar, é C190 realmente inconsistente com seus itens.
    ['DOC-C190-VLICMS-01', 'eq', 0],
    ['CAD-0400-CFOP-01', 'eq', 3],
    ['COMB-0206-1300-01', 'eq', 2],
    ['DOC-C170-CODCTA-01', 'eq', 10],
    ['DOC-C100-5929-01', 'eq', 31],
];
let pass = 0, fail = 0;
for (const [id, op, val] of EXPECT) {
    const got = byId[id] || 0;
    const ok = op === 'gte' ? got >= val : got === val;
    if (ok) pass++; else { fail++; console.error(`FAIL ${id}: esperado ${op} ${val}, obtido ${got}`); }
}
console.log(`eauditoria-repro: ${pass} ok, ${fail} falhas (regras disparadas: ${Object.keys(byId).length})`);
process.exit(fail ? 1 : 0);
