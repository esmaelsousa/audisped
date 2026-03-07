const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

async function setupDatabase() {
    const client = await pool.connect();
    try {
        console.log('Verificando/Criando tabela de usuários...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                senha VARCHAR(255) NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Tabela usuarios garantida.');

        // Garantir colunas de PIS/COFINS no C170 com tipo TEXT (sem limite)
        await client.query(`
            ALTER TABLE documentos_itens_c170 
            ALTER COLUMN cst_pis TYPE TEXT,
            ALTER COLUMN cst_cofins TYPE TEXT;
        `);
        await client.query(`
            ALTER TABLE documentos_itens_c170 
            ADD COLUMN IF NOT EXISTS cst_pis TEXT,
            ADD COLUMN IF NOT EXISTS cst_cofins TEXT;
        `);

        // Criar/Ajustar tabela para Bloco D com TEXT
        await client.query(`
            CREATE TABLE IF NOT EXISTS documentos_d100 (
                id SERIAL PRIMARY KEY,
                id_sped_arquivo INTEGER REFERENCES sped_arquivos(id),
                ind_oper CHAR(1),
                num_doc TEXT,
                cod_mod TEXT,
                cod_sit TEXT,
                dt_doc DATE,
                cfop TEXT,
                vl_doc NUMERIC(15,2),
                vl_icms NUMERIC(15,2)
            );
        `);
        // Criar/Ajustar tabela para LMC Movimentacao
        await client.query(`
            CREATE TABLE IF NOT EXISTS lmc_movimentacao (
                id SERIAL PRIMARY KEY,
                id_sped_arquivo INTEGER REFERENCES sped_arquivos(id),
                cod_item TEXT,
                num_tanque TEXT,
                cap_tanque NUMERIC(15,3),
                data_mov DATE,
                estq_abert NUMERIC(15,3),
                vol_entr NUMERIC(15,3),
                vol_saidas NUMERIC(15,3),
                vol_saidas_ajustado NUMERIC(15,3),
                val_perda NUMERIC(15,3),
                val_ganho NUMERIC(15,3),
                estq_escr NUMERIC(15,3),
                fech_fisico NUMERIC(15,3),
                fech_fisico_ajustado NUMERIC(15,3)
            );
        `);
        // Garantir que as novas colunas existam se a tabela já existir
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS cod_item TEXT`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS num_tanque TEXT`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS cap_tanque NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS data_mov DATE`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS estq_abert NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS vol_entr NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS vol_saidas NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS vol_saidas_ajustado NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS val_perda NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS val_ganho NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS estq_escr NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS fech_fisico NUMERIC(15,3)`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS fech_fisico_ajustado NUMERIC(15,3)`);

        // Garantir tipo TEXT nas colunas existentes
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN num_doc TYPE TEXT`);
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN cod_mod TYPE TEXT`);
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN cod_sit TYPE TEXT`);
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN cfop TYPE TEXT`);

        // Garantir colunas de ajuste no C100
        await client.query(`ALTER TABLE documentos_c100 ADD COLUMN IF NOT EXISTS vl_doc_ajustado NUMERIC(15,2);`);

        // Garantir colunas de ajuste no C190
        await client.query(`ALTER TABLE documentos_c190 ADD COLUMN IF NOT EXISTS vl_opr_ajustado NUMERIC(15,2);`);
        await client.query(`ALTER TABLE documentos_c190 ADD COLUMN IF NOT EXISTS vl_bc_icms_ajustado NUMERIC(15,2);`);
        await client.query(`ALTER TABLE documentos_c190 ADD COLUMN IF NOT EXISTS vl_icms_ajustado NUMERIC(15,2);`);

        // Tabela de configuração de capacidades de tanques (referenciada pelo validador 1300)
        await client.query(`
            CREATE TABLE IF NOT EXISTS lmc_tanques_config (
                id SERIAL PRIMARY KEY,
                cnpj TEXT NOT NULL,
                cod_item TEXT NOT NULL,
                capacidade NUMERIC(15,3),
                UNIQUE(cnpj, cod_item)
            );
        `);

        console.log('Estrutura de Auditoria Avançada estabilizada com colunas de ajuste e configurações de LMC.');
    } catch (err) {
        console.error('Erro ao configurar banco:', err);
    } finally {
        client.release();
        process.exit();
    }
}

setupDatabase();
