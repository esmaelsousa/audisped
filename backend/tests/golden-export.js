#!/usr/bin/env node
/**
 * Arnês GOLDEN-FILE do export de SPED.
 *
 * Objetivo (Sprint 0 do Módulo Validador): PROVAR que mudanças de código NÃO alteram
 * o arquivo .txt exportado. Captura o resultado do export atual em N arquivos reais
 * (baseline) e, depois de qualquer alteração, re-exporta e compara byte a byte (check).
 * Se um único byte mudar, o `check` falha (exit 1) — é a garantia de não-impacto.
 *
 * NÃO altera código existente: chama o endpoint /api/exportar-sped já existente via HTTP.
 *
 * Uso (a partir de backend/, com o servidor rodando):
 *   GOLDEN_IDS="1898,1326,609" node tests/golden-export.js baseline   # salva referência
 *   node tests/golden-export.js check                                  # compara com a referência
 *
 * Sem GOLDEN_IDS: reusa os IDs do manifest (se existir) ou pega uma amostra recente.
 *
 * Observação: exportar grava `encerrantes_exportados` da competência (mesmo efeito de um
 * export normal feito pelo usuário). Rode em arquivos já exportados; é idempotente.
 *
 * Os .txt de referência ficam em tests/golden/ e são GITIGNORADOS (contêm dado fiscal).
 * Só o manifest.json (hashes sha256) vai para o git — suficiente para o `check` e sem vazar dados.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const PORT = process.env.PORT || 15435;
const HOST = process.env.GOLDEN_HOST || `http://localhost:${PORT}`;
const SECRET = process.env.JWT_SECRET; // V3: sem literal; lê do .env (sobrevive à rotação do segredo)
if (!SECRET) { console.error('[golden] defina JWT_SECRET no .env'); process.exit(1); }
const DIR = path.join(__dirname, 'golden');
const MANIFEST = path.join(DIR, 'manifest.json');

const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
});

function loadManifest() {
    if (fs.existsSync(MANIFEST)) return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    return { gerado_em: null, host: HOST, arquivos: {} };
}

async function pickIds() {
    if (process.env.GOLDEN_IDS) return process.env.GOLDEN_IDS.split(',').map(s => parseInt(s.trim())).filter(Boolean);
    const m = loadManifest();
    const fromManifest = Object.keys(m.arquivos).map(Number);
    if (fromManifest.length) return fromManifest;
    // fallback: amostra de arquivos recentes (que tenham caminho físico no disco)
    const r = await pool.query('SELECT id, caminho_arquivo FROM sped_arquivos ORDER BY id DESC LIMIT 30');
    const ids = [];
    for (const row of r.rows) {
        let cam = row.caminho_arquivo;
        try { const j = JSON.parse(cam); if (j && typeof j === 'object') cam = Object.values(j)[0]; } catch (_) {}
        if (cam && fs.existsSync(cam)) ids.push(row.id);
        if (ids.length >= 5) break;
    }
    return ids;
}

async function exportar(id, token) {
    const res = await fetch(`${HOST}/api/exportar-sped/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()); // bytes exatos (latin1) que iriam ao Fisco
}

(async () => {
    const mode = (process.argv[2] || 'check').toLowerCase();
    if (!['baseline', 'check'].includes(mode)) { console.error('Modo inválido. Use baseline | check'); process.exit(2); }
    fs.mkdirSync(DIR, { recursive: true });
    const token = jwt.sign({ id: 1, nome: 'golden', email: 'golden@local' }, SECRET, { expiresIn: '2h' });
    const manifest = loadManifest();
    const ids = await pickIds();
    if (!ids.length) { console.error('Nenhum arquivo para testar (defina GOLDEN_IDS).'); await pool.end(); process.exit(2); }

    console.log(`[golden] modo=${mode} | host=${HOST} | ${ids.length} arquivo(s): ${ids.join(', ')}`);
    let fail = 0, ok = 0;
    for (const id of ids) {
        let buf;
        try { buf = await exportar(id, token); }
        catch (e) { console.log(`  #${id}  ERRO no export: ${e.message}`); fail++; continue; }
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        const meta = await pool.query('SELECT nome_arquivo FROM sped_arquivos WHERE id=$1', [id]);
        const label = (meta.rows[0]?.nome_arquivo || '').slice(0, 50);

        if (mode === 'baseline') {
            fs.writeFileSync(path.join(DIR, `${id}.txt`), buf);
            manifest.arquivos[id] = { sha256: hash, bytes: buf.length, label };
            console.log(`  #${id}  baseline salvo — ${buf.length} bytes — ${hash.slice(0, 16)}…  (${label})`);
            ok++;
        } else {
            const ref = manifest.arquivos[id];
            if (!ref) { console.log(`  #${id}  (sem baseline — rode 'baseline' primeiro)`); continue; }
            if (ref.sha256 === hash && ref.bytes === buf.length) { console.log(`  #${id}  ✓ OK — idêntico (${buf.length} bytes)`); ok++; }
            else {
                console.log(`  #${id}  ✗ DIVERGE — baseline ${ref.bytes}b ${ref.sha256.slice(0, 12)} ≠ atual ${buf.length}b ${hash.slice(0, 12)}`);
                fail++;
            }
        }
    }
    if (mode === 'baseline') {
        manifest.gerado_em = new Date().toISOString();
        manifest.host = HOST;
        fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
        console.log(`[golden] manifest atualizado: ${MANIFEST}`);
    }
    console.log(`[golden] resultado: ${ok} OK, ${fail} falha(s).`);
    await pool.end();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
