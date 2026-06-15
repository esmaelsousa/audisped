#!/usr/bin/env node
/**
 * Importa as tabelas fiscais de referência (NCM oficial + CEST↔NCM) para o Postgres.
 * - NCM: JSON oficial da Receita/Siscomex (autoritativo, tabela vigente).
 * - CEST: tabela CEST↔NCM (Conv. ICMS 142/2018; fonte secundária Contabilizei, por segmento).
 * Idempotente: recria as tabelas e recarrega (TRUNCATE + INSERT). Rodar de backend/:  node scripts/importar_tabelas_fiscais.js
 * Base para: validação de CEST (existe + casa com o NCM) e NCM (existe) + futuros cadastros fiscais por NCM.
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });

const NCM_URL = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';
const CEST_URL = 'https://www.contabilizei.com.br/contabilidade-online/cest-ncm/';
const UA = { 'User-Agent': 'Mozilla/5.0' };
const digits = (s) => String(s || '').replace(/\D/g, '');

async function criarTabelas(db) {
    await db.query(`CREATE TABLE IF NOT EXISTS ncm (
        codigo      TEXT PRIMARY KEY,         -- só dígitos (2/4/6/8); 8 = NCM final
        codigo_fmt  TEXT,                     -- com pontos (ex.: 3923.30.90)
        descricao   TEXT,
        nivel       INTEGER,                  -- nº de dígitos (8 = item final)
        data_inicio TEXT,
        data_fim    TEXT
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_ncm_nivel ON ncm(nivel)`);
    await db.query(`CREATE TABLE IF NOT EXISTS cest (
        id          SERIAL PRIMARY KEY,
        cest        TEXT NOT NULL,            -- 7 dígitos
        cest_fmt    TEXT,                     -- com pontos (ex.: 06.001.00)
        ncm_prefix  TEXT NOT NULL,            -- dígitos do NCM/SH (pode ser prefixo: 2,4,6,8)
        descricao   TEXT,
        segmento    TEXT,                     -- 2 primeiros dígitos do CEST
        UNIQUE(cest, ncm_prefix)
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_cest_cest ON cest(cest)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_cest_ncm ON cest(ncm_prefix)`);
}

async function importarNcm(db) {
    const r = await fetch(NCM_URL, { headers: UA });
    if (!r.ok) throw new Error('NCM HTTP ' + r.status);
    const j = await r.json();
    const arr = j.Nomenclaturas || [];
    await db.query('TRUNCATE ncm');
    let n = 0, batch = [];
    const flush = async () => {
        if (!batch.length) return;
        const cols = [];
        batch.forEach((row) => cols.push(row.cod, row.fmt, row.desc, row.nivel, row.di, row.df));
        const placeholders = batch.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`).join(',');
        await db.query(`INSERT INTO ncm (codigo,codigo_fmt,descricao,nivel,data_inicio,data_fim) VALUES ${placeholders} ON CONFLICT (codigo) DO NOTHING`, cols);
        n += batch.length; batch = [];
    };
    for (const it of arr) {
        const cod = digits(it.Codigo);
        if (!cod) continue;
        batch.push({ cod, fmt: it.Codigo, desc: it.Descricao || '', nivel: cod.length, di: it.Data_Inicio || '', df: it.Data_Fim || '' });
        if (batch.length >= 400) await flush();
    }
    await flush();
    return n;
}

async function importarCest(db) {
    const r = await fetch(CEST_URL, { headers: UA });
    if (!r.ok) throw new Error('CEST HTTP ' + r.status);
    const html = await r.text();
    await db.query('TRUNCATE cest');
    // linhas: <tr> <td>NN.NNN.NN</td> <td>ITEM</td> <td>NCM/SH</td> <td>DESCRIÇÃO</td> </tr>
    const re = /<tr[^>]*>\s*<td[^>]*>\s*(\d{2}\.\d{3}\.\d{2})\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
    const strip = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, '').replace(/\s+/g, ' ').trim();
    let m, n = 0, seen = new Set();
    while ((m = re.exec(html)) !== null) {
        const cestFmt = m[1]; const cest = digits(cestFmt);
        const ncmPrefix = digits(m[3]); if (!ncmPrefix) continue;
        const desc = strip(m[4]).slice(0, 400);
        const key = cest + '|' + ncmPrefix; if (seen.has(key)) continue; seen.add(key);
        await db.query(`INSERT INTO cest (cest,cest_fmt,ncm_prefix,descricao,segmento) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cest,ncm_prefix) DO NOTHING`,
            [cest, cestFmt, ncmPrefix, desc, cest.slice(0, 2)]);
        n++;
    }
    return n;
}

(async () => {
    const db = await pool.connect();
    try {
        await criarTabelas(db);
        const nNcm = await importarNcm(db);
        const nCest = await importarCest(db);
        const ncmFinal = (await db.query("SELECT count(*)::int c FROM ncm WHERE nivel=8")).rows[0].c;
        console.log(`✓ ncm: ${nNcm} registros (${ncmFinal} NCM finais de 8 dígitos)`);
        console.log(`✓ cest: ${nCest} relações CEST↔NCM`);
    } catch (e) { console.error('ERRO:', e.message); process.exitCode = 1; }
    finally { db.release(); await pool.end(); }
})();
