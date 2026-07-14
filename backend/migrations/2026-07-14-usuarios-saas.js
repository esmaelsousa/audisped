// Migração incremental — Fatia 1 (Fundação de Usuários).
// Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS; backfill guardado
// por "ainda não há super_admin" (não clobbera papéis definidos depois).
//
// Uso (CLI):  node backend/migrations/2026-07-14-usuarios-saas.js
//   SUPER_ADMIN_EMAIL=... p/ escolher o super (default esmaelsousa@gmail.com).
// Uso (programático):  const { up } = require('./...'); await up(client, { superAdminEmail });

const ROLES = ['super_admin', 'admin', 'staff', 'escritorio'];

async function up(client, { superAdminEmail = 'esmaelsousa@gmail.com' } = {}) {
    // 1) redes (mínima / tenant-only) — precisa existir antes do FK em usuarios.rede_id.
    await client.query(`
        CREATE TABLE IF NOT EXISTS redes (
            id            SERIAL PRIMARY KEY,
            nome          TEXT NOT NULL,
            documento     TEXT,
            email_resp    TEXT,
            status        TEXT NOT NULL DEFAULT 'trial',
            trial_ate     DATE,
            dias_carencia INTEGER NOT NULL DEFAULT 5,
            modulos_contratados JSONB NOT NULL DEFAULT '[]'::jsonb,
            criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 2) trilha de auditoria (§12.2/§13.7).
    await client.query(`
        CREATE TABLE IF NOT EXISTS auditoria_seguranca (
            id         SERIAL PRIMARY KEY,
            ator_id    INTEGER,
            ator_role  TEXT,
            acao       TEXT NOT NULL,
            alvo_id    INTEGER,
            detalhe    JSONB,
            criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 3) colunas em usuarios (nullable/default → metadata-only; já NOT NULL onde há default).
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'escritorio';`);
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rede_id INTEGER REFERENCES redes(id);`);
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS modulos JSONB NOT NULL DEFAULT '[]'::jsonb;`);
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;`);
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS precisa_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE;`);

    // CHECK de papel válido (defesa em profundidade) — idempotente.
    await client.query(`
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_role_chk') THEN
                ALTER TABLE usuarios ADD CONSTRAINT usuarios_role_chk
                    CHECK (role IN ('super_admin','admin','staff','escritorio'));
            END IF;
        END $$;
    `);

    // 4) rede default (idempotente por nome).
    await client.query(`
        INSERT INTO redes (nome, status, modulos_contratados)
        SELECT 'default', 'ativa', '[]'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM redes WHERE nome = 'default');
    `);

    // 5) Backfill — só na 1ª vez (guardado por "ainda não há super_admin").
    //    Assim, papéis definidos DEPOIS (admin/escritorio criados no app) nunca são reescritos.
    const jaTemSuper = await client.query(`SELECT 1 FROM usuarios WHERE role = 'super_admin' LIMIT 1;`);
    let backfillAplicado = false;
    if (jaTemSuper.rowCount === 0) {
        // todos → staff (time interno), rede_id NULL
        await client.query(`UPDATE usuarios SET role = 'staff', rede_id = NULL;`);
        // o super escolhido
        const up = await client.query(
            `UPDATE usuarios SET role = 'super_admin', rede_id = NULL WHERE lower(email) = lower($1);`,
            [superAdminEmail]);
        if (up.rowCount === 0) {
            console.warn(`[migracao] AVISO: super_admin email "${superAdminEmail}" não encontrado em usuarios — nenhum super definido.`);
        }
        backfillAplicado = true;
    }

    return { backfillAplicado };
}

module.exports = { up, ROLES };

// CLI
if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const { Pool } = require('pg');
    const pool = new Pool({
        user: (process.env.DB_USER || '').trim(),
        host: (process.env.DB_HOST || '').trim(),
        database: (process.env.DB_DATABASE || '').trim(),
        password: (process.env.DB_PASSWORD || '').trim(),
        port: parseInt((process.env.DB_PORT || '5432').trim()),
    });
    (async () => {
        const client = await pool.connect();
        try {
            const r = await up(client, { superAdminEmail: (process.env.SUPER_ADMIN_EMAIL || 'esmaelsousa@gmail.com').trim() });
            console.log('Migração OK.', r);
        } catch (e) {
            console.error('Migração FALHOU:', e.message);
            process.exitCode = 1;
        } finally {
            client.release();
            await pool.end();
        }
    })();
}
