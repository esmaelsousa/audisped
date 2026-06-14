#!/usr/bin/env node
// CLI de demonstração do Validador (Sprint 1). NÃO é endpoint — só roda o engine sobre um
// arquivo e imprime o relatório. Uso (a partir de backend/):
//   node services/validador/cli.js <id_sped>        (lê caminho_arquivo no banco)
//   node services/validador/cli.js /caminho/arq.txt (upload avulso)
require('dotenv').config();
const fs = require('fs');
const { parseSped } = require('./parser');
const { validar } = require('./engine');

const NOME_BLOCO = {
    '0': 'Bloco 0 (Cadastros)', 'C': 'Bloco C (NF-e/NFC-e)', 'D': 'Bloco D (CT-e)',
    'E': 'Bloco E (Apuração)', 'G': 'Bloco G (CIAP)', 'H': 'Bloco H (Inventário)',
    'K': 'Bloco K (Produção)', '1': 'Bloco 1 (Combustíveis/LMC)', '9': 'Bloco 9 (Controle)',
    '*': 'Estrutural (multi-bloco)',
};

async function resolverConteudo(arg) {
    if (/^\d+$/.test(arg)) {
        const { Pool } = require('pg');
        const pool = new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT });
        const r = await pool.query('SELECT caminho_arquivo, nome_arquivo FROM sped_arquivos WHERE id=$1', [parseInt(arg)]);
        await pool.end();
        if (!r.rows.length) throw new Error(`Arquivo id ${arg} não encontrado.`);
        let cam = r.rows[0].caminho_arquivo;
        try { const j = JSON.parse(cam); if (j && typeof j === 'object') cam = Object.values(j)[0]; } catch (_) {}
        if (!cam || !fs.existsSync(cam)) throw new Error('Arquivo físico não encontrado: ' + cam);
        return { nome: r.rows[0].nome_arquivo, content: fs.readFileSync(cam, 'latin1') };
    }
    return { nome: arg, content: fs.readFileSync(arg, 'latin1') };
}

(async () => {
    const arg = process.argv[2];
    if (!arg) { console.error('Uso: node services/validador/cli.js <id_sped | caminho.txt>'); process.exit(2); }
    const { nome, content } = await resolverConteudo(arg);
    const model = parseSped(content);
    console.log(`Arquivo: ${nome}`);
    console.log(`Versão leiaute: ${model.versao || '?'} | Período: ${model.dtIni}–${model.dtFin} | CNPJ: ${model.cnpj} | linhas: ${model.totalLinhas}`);

    const r = validar(model);

    console.log(`\n=== COBERTURA POR BLOCO ([X] = varrido) ===`);
    for (const b of r.resumo.blocosPresentes) {
        const pb = r.porBloco[b];
        const flag = pb.erros ? (pb.bloqueantes ? '🔴' : '🟡') : '✅';
        console.log(`  [X] ${flag} ${NOME_BLOCO[b] || ('Bloco ' + b)}: ${pb.erros} ocorrência(s)${pb.bloqueantes ? ` (${pb.bloqueantes} bloqueante)` : ''}`);
    }
    console.log(`\n=== RESUMO: ${r.resumo.total} ocorrências — ${r.resumo.bloqueantes} BLOQUEANTES, ${r.resumo.advertencias} advertência(s) | ${r.resumo.regrasExecutadas} regras executadas ===`);

    const LIM = 40;
    for (const e of r.erros.slice(0, LIM)) {
        console.log(`\n[${e.severidade}] ${e.regra_id} — ${e.titulo}`);
        console.log(`   ${e.registro} • linha ${e.linha ?? '-'} • ${e.detalhe}`);
        if (e.valorSugerido !== undefined && e.valorSugerido !== '') console.log(`   sugestão: ${e.valorSugerido}`);
    }
    if (r.erros.length > LIM) console.log(`\n… +${r.erros.length - LIM} ocorrência(s) (saída truncada).`);
})().catch(e => { console.error('ERRO:', e.message); process.exit(2); });
