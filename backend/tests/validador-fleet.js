#!/usr/bin/env node
// Teste em FROTA do Validador (read-only): roda parser+engine numa amostra diversa de
// EMPRESAS e PERÍODOS do banco e agrega os resultados. Serve para flagrar falso-positivo
// (regra que dispara em quase tudo) e validar cobertura. Não grava nada; lê os .txt do disco.
// Uso (de backend/):  FLEET_N=30 node tests/validador-fleet.js
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const { parseSped } = require('../services/validador/parser');
const { validar } = require('../services/validador/engine');

const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
const N = parseInt(process.env.FLEET_N || '30');
// Regras que LEGITIMAMENTE disparam em arquivos reais (achados verdadeiros). Qualquer outra regra
// disparando numa amostra real é "canário" de FALSO-POSITIVO (ou um achado novo a investigar).
const PODE_DISPARAR = new Set(['CAD-0220-01', 'DOC-DUP', 'COMB-LMC', 'COMB-LMC-CONT']);

const resolverCam = (c) => { try { const j = JSON.parse(c); if (j && typeof j === 'object') return Object.values(j)[0]; } catch (_) {} return c; };
const ym = (p) => { const m = (p || '').match(/(\d{4})-(\d{2})/); return m ? `${m[1]}-${m[2]}` : (p || '').slice(0, 7); };

(async () => {
    const r = await pool.query(`SELECT id, cnpj_empresa, periodo_apuracao, caminho_arquivo FROM sped_arquivos WHERE caminho_arquivo IS NOT NULL ORDER BY cnpj_empresa, periodo_apuracao`);
    // Agrupa por empresa e escolhe períodos variados (1º, meio, último) para ALTERNAR empresa+período.
    const porEmpresa = new Map();
    for (const row of r.rows) { if (!porEmpresa.has(row.cnpj_empresa)) porEmpresa.set(row.cnpj_empresa, []); porEmpresa.get(row.cnpj_empresa).push(row); }
    const amostra = [];
    for (const [, arr] of porEmpresa) {
        const idxs = arr.length <= 1 ? [0] : (arr.length <= 3 ? [0, arr.length - 1] : [0, Math.floor(arr.length / 2), arr.length - 1]);
        for (const i of idxs) amostra.push(arr[i]);
    }
    // intercala empresas (round-robin) para garantir diversidade no corte por N
    amostra.sort((a, b) => ym(a.periodo_apuracao).localeCompare(ym(b.periodo_apuracao)));
    const sel = amostra.slice(0, N);

    const agg = {}; let comArq = 0, semArq = 0, erroParse = 0, internas = 0; const canarioHits = [];
    const empresasVistas = new Set();
    console.log(`id     CNPJ            período  ver  linhas  tot bloq  regras`);
    for (const a of sel) {
        const cam = resolverCam(a.caminho_arquivo);
        if (!cam || !fs.existsSync(cam)) { semArq++; continue; }
        comArq++; empresasVistas.add(a.cnpj_empresa);
        let model, res;
        try { model = parseSped(fs.readFileSync(cam, 'latin1')); res = validar(model); }
        catch (e) { erroParse++; console.log(`#${a.id} ${a.cnpj_empresa} ERRO parse: ${e.message}`); continue; }
        const byRule = {};
        for (const e of res.erros) { byRule[e.regra_id] = (byRule[e.regra_id] || 0) + 1; agg[e.regra_id] = (agg[e.regra_id] || 0) + 1; if (/falha interna/i.test(e.titulo || '')) internas++; }
        for (const id of Object.keys(byRule)) if (!PODE_DISPARAR.has(id)) canarioHits.push({ id, file: a.id, cnpj: a.cnpj_empresa, periodo: ym(a.periodo_apuracao), n: byRule[id] });
        const regras = Object.entries(byRule).map(([k, v]) => `${k}:${v}`).join(' ') || '✅ limpo';
        console.log(`${String(a.id).padEnd(6)} ${a.cnpj_empresa.padEnd(15)} ${ym(a.periodo_apuracao)} ${String(model.versao).padStart(3)} ${String(model.totalLinhas).padStart(7)} ${String(res.resumo.total).padStart(4)} ${String(res.resumo.bloqueantes).padStart(4)}  ${regras}`);
    }
    console.log(`\n=== ${comArq} arquivos de ${empresasVistas.size} empresas | ${semArq} sem arquivo físico | ${erroParse} erro de parse ===`);
    console.log('Frequência por regra (nº de ocorrências somadas):');
    for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1])) console.log(`   ${k}: ${v}`);
    console.log(`Empresas no banco: ${porEmpresa.size}`);

    // ---- GATE DE REGRESSÃO ----
    let ok = true;
    if (erroParse > 0) { console.log(`\n✗ ${erroParse} erro(s) de parse`); ok = false; }
    if (internas > 0) { console.log(`✗ ${internas} falha(s) interna(s) de regra (engine isolou, mas há bug numa regra)`); ok = false; }
    if (canarioHits.length) {
        ok = false;
        console.log(`✗ regras CANÁRIO dispararam em arquivo real (investigar — falso-positivo OU achado novo):`);
        for (const h of canarioHits) console.log(`   ${h.id} ×${h.n} em #${h.file} ${h.cnpj} ${h.periodo}`);
    } else {
        console.log(`\n✓ nenhuma regra canário disparou (0 falso-positivo nas ${comArq} amostras). Esperadas (achados reais): ${[...PODE_DISPARAR].join(', ')}`);
    }
    await pool.end();
    if (!ok) process.exit(1);
    console.log('✓ frota verde');
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });
