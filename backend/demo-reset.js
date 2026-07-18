// demo-reset.js — RESET (e seed) do ambiente de demonstração.
//
// Devolve o banco demo ao estado inicial: apaga TODO dado de cliente, preserva as
// tabelas de REFERÊNCIA, limpa os arquivos SPED subidos e (re)cria o usuário demo.
// É idempotente: serve tanto pra inicializar quanto pro reset diário/sob-demanda.
//
// SEGURANÇA: só roda se DEMO_MODE=1. Recusa qualquer banco cujo nome não contenha
// 'demo'. É proibido por construção rodar isto contra produção.
//
// Uso (dentro do container demo):
//   docker exec audisped-demo-backend node demo-reset.js
// Cron diário e reset sob-demanda chamam exatamente esta linha.

const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Tabelas de REFERÊNCIA a PRESERVAR (público, não é dado de cliente).
// Se a demo precisar das regras globais de de-para/tributação p/ o validador brilhar,
// acrescente aqui E no demo-extract-ref.sh: 'de_para_xml','config_tributaria','mapeamento_produtos'.
const KEEP = ['ncm', 'cest', 'cad_cfops', 'cad_credenciadoras'];

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL || 'demo@audisped.com.br';
const DEMO_NOME = process.env.DEMO_USER_NOME || 'Demonstração';
const DEMO_SENHA = process.env.DEMO_USER_PASSWORD || 'demo1234';

async function main() {
    // ---- travas de segurança ----
    if (process.env.DEMO_MODE !== '1') {
        throw new Error('RECUSADO: demo-reset só roda com DEMO_MODE=1 (proteção contra produção).');
    }
    const dbName = process.env.DB_DATABASE || '';
    if (!/demo/i.test(dbName)) {
        throw new Error(`RECUSADO: DB_DATABASE ('${dbName}') não contém 'demo' — não parece o banco demo. Abortado.`);
    }

    // Mesma forma de conexão do server.js (DB_* individuais).
    const pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
    });
    const client = await pool.connect();
    try {
        // 1) TRUNCATE dinâmico: tudo, menos a keep-list.
        const { rows } = await client.query(
            `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
        );
        const alvos = rows
            .map(r => r.tablename)
            .filter(t => !KEEP.includes(t));

        if (alvos.length) {
            const lista = alvos.map(t => `"${t}"`).join(', ');
            await client.query(`TRUNCATE ${lista} RESTART IDENTITY CASCADE;`);
        }
        console.log(`Limpo: ${alvos.length} tabelas truncadas; preservadas: ${KEEP.join(', ')}.`);

        // 2) Apaga os arquivos SPED/XML subidos pelo prospect.
        const uploadDir = path.resolve(__dirname, 'uploads');
        limparDiretorio(uploadDir, ['xml_temp']); // recria a subpasta de trabalho depois
        const xmlTemp = path.join(uploadDir, 'xml_temp');
        if (!fs.existsSync(xmlTemp)) fs.mkdirSync(xmlTemp, { recursive: true });
        console.log('Uploads limpos.');

        // 3) (Re)cria o usuário demo — login compartilhado, role sem capacidades.
        const hash = await bcrypt.hash(DEMO_SENHA, 10);
        await client.query(
            `INSERT INTO usuarios (nome, email, senha, role, ativo, precisa_trocar_senha)
             VALUES ($1, $2, $3, 'demo', TRUE, FALSE)
             ON CONFLICT (email) DO UPDATE
               SET senha = EXCLUDED.senha, role = 'demo', ativo = TRUE, precisa_trocar_senha = FALSE`,
            [DEMO_NOME, DEMO_EMAIL, hash]
        );
        console.log(`Usuário demo pronto: ${DEMO_EMAIL} (role demo).`);
        console.log('RESET concluído.');
    } finally {
        client.release();
        await pool.end();
    }
}

// Remove o conteúdo de dir, exceto as subpastas em `manter`.
function limparDiretorio(dir, manter = []) {
    if (!fs.existsSync(dir)) return;
    for (const nome of fs.readdirSync(dir)) {
        if (manter.includes(nome)) {
            limparDiretorio(path.join(dir, nome)); // esvazia por dentro
            continue;
        }
        fs.rmSync(path.join(dir, nome), { recursive: true, force: true });
    }
}

main().catch(e => { console.error(e.message); process.exit(1); });
