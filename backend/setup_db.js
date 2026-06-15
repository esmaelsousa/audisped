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
        // Tabela de Configuração de CFOP/CST forçado
        await client.query(`
            CREATE TABLE IF NOT EXISTS config_tributaria (
                id SERIAL PRIMARY KEY,
                id_empresa INTEGER REFERENCES empresas(id),
                cfop_entrada TEXT,
                cst_icms_entrada TEXT,
                force_cst BOOLEAN DEFAULT true,
                UNIQUE(id_empresa, cfop_entrada)
            );
        `);

        // Tabela para De-Para de Produtos (Participante + Código Item Fornecedor -> Código Interno)
        await client.query(`
            CREATE TABLE IF NOT EXISTS mapeamento_produtos (
                id SERIAL PRIMARY KEY,
                id_empresa INTEGER REFERENCES empresas(id),
                cod_participante TEXT, -- CNPJ do fornecedor
                cod_item_fornecedor TEXT,
                cod_item_interno TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(id_empresa, cod_participante, cod_item_fornecedor)
            );
        `);

        // Tabela para De-Para de Participantes (CNPJ Fornecedor no XML -> Código Interno no SPED)
        await client.query(`
            CREATE TABLE IF NOT EXISTS mapeamento_participantes (
                id SERIAL PRIMARY KEY,
                id_empresa INTEGER REFERENCES empresas(id),
                cnpj_fornecedor TEXT,
                cod_participante_interno TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(id_empresa, cnpj_fornecedor)
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
        
        // Colunas de ajuste adicionais (do migrate_db.js)
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS val_perda_ajustado NUMERIC`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS val_ganho_ajustado NUMERIC`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS estq_abert_ajustado NUMERIC`);
        await client.query(`ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS vol_escr_ajustado NUMERIC`);

        // Garantir tipo TEXT nas colunas existentes
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN num_doc TYPE TEXT`);
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN cod_mod TYPE TEXT`);
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN cod_sit TYPE TEXT`);
        await client.query(`ALTER TABLE documentos_d100 ALTER COLUMN cfop TYPE TEXT`);

        // Garantir colunas de ajuste no C100 e D100
        await client.query(`ALTER TABLE documentos_c100 ADD COLUMN IF NOT EXISTS vl_doc_ajustado NUMERIC(15,2);`);
        await client.query(`ALTER TABLE documentos_c100 ADD COLUMN IF NOT EXISTS ind_oper CHARACTER VARYING(1);`);
        await client.query(`ALTER TABLE documentos_c100 ADD COLUMN IF NOT EXISTS chv_nfe CHARACTER VARYING(44);`);
        await client.query(`ALTER TABLE documentos_d100 ADD COLUMN IF NOT EXISTS ind_oper CHARACTER VARYING(1);`);
        await client.query(`ALTER TABLE documentos_d100 ADD COLUMN IF NOT EXISTS vl_icms NUMERIC(15,2);`);
        await client.query(`ALTER TABLE documentos_d100 ADD COLUMN IF NOT EXISTS chv_nfe CHARACTER VARYING(44);`);

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

        // Cadastro de lacres das bombas (registro 1360, injetado no export por CNPJ + série da bomba)
        await client.query(`
            CREATE TABLE IF NOT EXISTS lmc_lacres (
                id SERIAL PRIMARY KEY,
                cnpj TEXT NOT NULL,
                serie_bomba TEXT NOT NULL,
                num_lacre TEXT NOT NULL,
                dt_aplicacao TEXT,
                UNIQUE(cnpj, serie_bomba, num_lacre)
            );
        `);

        // Cadastro de credenciadoras (participantes do 1601) p/ injetar 0150 completo no export
        await client.query(`
            CREATE TABLE IF NOT EXISTS cad_credenciadoras (
                id SERIAL PRIMARY KEY,
                cnpj TEXT UNIQUE NOT NULL,
                nome TEXT,
                ie TEXT,
                cod_mun TEXT,
                endereco TEXT,
                num TEXT,
                bairro TEXT
            );
        `);

        // Cadastro de apuração do ICMS (E116): código de receita + dia de vencimento por CNPJ.
        // Usado para injetar o E116 ausente no export (quando o E110 tem ICMS a recolher e o ERP
        // não emitiu E116). O valor é calculado no export; aqui guarda-se só COD_REC + dia_vcto.
        await client.query(`
            CREATE TABLE IF NOT EXISTS cad_apuracao_e116 (
                id SERIAL PRIMARY KEY,
                cnpj TEXT UNIQUE NOT NULL,
                cod_rec TEXT NOT NULL,
                dia_vcto INTEGER DEFAULT 9
            );
        `);

        // Tabelas fiscais de referência (popular via scripts/importar_tabelas_fiscais.js):
        // ncm = NCM oficial vigente (Receita/Siscomex); cest = CEST↔NCM (Conv. 142/2018).
        await client.query(`
            CREATE TABLE IF NOT EXISTS ncm (
                codigo      TEXT PRIMARY KEY,
                codigo_fmt  TEXT,
                descricao   TEXT,
                nivel       INTEGER,
                data_inicio TEXT,
                data_fim    TEXT
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS cest (
                id          SERIAL PRIMARY KEY,
                cest        TEXT NOT NULL,
                cest_fmt    TEXT,
                ncm_prefix  TEXT NOT NULL,
                descricao   TEXT,
                segmento    TEXT,
                UNIQUE(cest, ncm_prefix)
            );
        `);

        // --- FASE 5: DE-PARA XML (PRODUTOS) ---
        await client.query(`
            CREATE TABLE IF NOT EXISTS de_para_xml (
                id SERIAL PRIMARY KEY,
                id_empresa INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
                cnpj_emissor TEXT NOT NULL,
                cod_produto_xml TEXT NOT NULL,
                cod_produto_interno TEXT,
                descricao_produto TEXT,
                novo_cfop TEXT,
                novo_cst TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(id_empresa, cnpj_emissor, cod_produto_xml)
            );
        `);

        // --- FASE 4: COFRE DE CERTIFICADOS A1 ---
        await client.query(`
            CREATE TABLE IF NOT EXISTS empresa_certificados (
                id SERIAL PRIMARY KEY,
                id_empresa INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
                pfx_base64 TEXT NOT NULL,
                senha_encriptada TEXT NOT NULL,
                validade_inicio TIMESTAMP,
                validade_fim TIMESTAMP,
                thumbprint TEXT,
                serial_number TEXT,
                emissor TEXT,
                ultimo_nsu_consultado TEXT DEFAULT '0',
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(id_empresa)
            );
        `);
        await client.query(`ALTER TABLE empresa_certificados ADD COLUMN IF NOT EXISTS ultimo_nsu_consultado TEXT DEFAULT '0';`);
        await client.query(`ALTER TABLE empresa_certificados ADD COLUMN IF NOT EXISTS periodicidade_sincronizacao INTEGER DEFAULT 0;`);

        // --- MANIFESTO DE DESTINATÁRIO (MD-e) CACHE ---
        await client.query(`
            CREATE TABLE IF NOT EXISTS mde_cache (
                id SERIAL PRIMARY KEY,
                id_empresa INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
                chave_nfe TEXT UNIQUE NOT NULL,
                nsu TEXT,
                cnpj_emissor TEXT,
                nome_emissor TEXT,
                valor NUMERIC(15,2),
                data_emissao TIMESTAMP,
                status_manifesto TEXT, 
                tipo_operacao TEXT,
                xml_content TEXT,
                numero_nfe TEXT,
                serie TEXT,
                itens_json JSONB,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS nsu TEXT;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS tipo_operacao TEXT;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS numero_nfe TEXT;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS serie TEXT;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS itens_json JSONB;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS cnpj_emissor TEXT;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS nome_emissor TEXT;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS valor NUMERIC(15,2);`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS data_emissao TIMESTAMP;`);
        await client.query(`ALTER TABLE mde_cache ADD COLUMN IF NOT EXISTS status_manifesto TEXT;`);


        // --- CADASTRO DE CFOPS ---
        await client.query(`
            CREATE TABLE IF NOT EXISTS cad_cfops (
                id SERIAL PRIMARY KEY,
                codigo TEXT NOT NULL UNIQUE,
                descricao TEXT,
                tipo TEXT, -- 'entrada' ou 'saida'
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Inserir CFOPs padrão se a tabela estiver vazia
        const cfopsExist = await client.query('SELECT COUNT(*) FROM cad_cfops');
        if (parseInt(cfopsExist.rows[0].count) === 0) {
            console.log('Populando CFOPs padrão...');
            const defaultCfops = [
                ['1102', 'Compra para comercialização', 'entrada'],
                ['1556', 'Compra de material para uso ou consumo', 'entrada'],
                ['1652', 'Compra de combustível ou lubrificante para consumo', 'entrada'],
                ['1551', 'Compra de bem para o ativo imobilizado', 'entrada'],
                ['1403', 'Compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária', 'entrada'],
                ['2102', 'Compra para comercialização (Outro Estado)', 'entrada'],
                ['2556', 'Compra de material para uso ou consumo (Outro Estado)', 'entrada']
            ];
            for (const [cod, desc, tipo] of defaultCfops) {
                await client.query('INSERT INTO cad_cfops (codigo, descricao, tipo) VALUES ($1, $2, $3)', [cod, desc, tipo]);
            }
        }

        // Tabela para persistir fechamentos realmente exportados (continuidade intermensal)
        await client.query(`
            CREATE TABLE IF NOT EXISTS encerrantes_exportados (
                id              SERIAL PRIMARY KEY,
                id_sped_arquivo INTEGER NOT NULL REFERENCES sped_arquivos(id) ON DELETE CASCADE,
                cnpj_empresa    TEXT NOT NULL,
                competencia     TEXT NOT NULL,
                cod_item        TEXT NOT NULL,
                fech_fisico_exportado NUMERIC(15,3) NOT NULL,
                dt_exportacao   TIMESTAMP DEFAULT NOW(),
                UNIQUE (cnpj_empresa, competencia, cod_item)
            );
        `);
        console.log('Tabela encerrantes_exportados garantida.');

        // Tabela para persistir encerrantes finais dos bicos (continuidade intermensal 1320)
        await client.query(`
            CREATE TABLE IF NOT EXISTS encerrantes_bicos_exportados (
                id              SERIAL PRIMARY KEY,
                cnpj_empresa    TEXT NOT NULL,
                competencia     TEXT NOT NULL,
                num_bico        TEXT NOT NULL,
                val_fecha       NUMERIC(15,3) NOT NULL,
                dt_exportacao   TIMESTAMP DEFAULT NOW(),
                UNIQUE (cnpj_empresa, competencia, num_bico)
            );
        `);
        console.log('Tabela encerrantes_bicos_exportados garantida.');

        // Registro 1320 (encerrantes por bico) — base para validacao fiscal de bicos.
        // Camada ADITIVA: guarda o 1320 ORIGINAL do arquivo + colunas paralelas _corrigido (auditor),
        // sem alterar lmc_movimentacao. Layout real do .txt: enc_fin[8], enc_ini[9], qtd_af[10], vol[11].
        await client.query(`
            CREATE TABLE IF NOT EXISTS sped_1320 (
                id                SERIAL PRIMARY KEY,
                id_sped_arquivo   INTEGER NOT NULL REFERENCES sped_arquivos(id) ON DELETE CASCADE,
                data_mov          DATE,
                cod_item          TEXT,
                num_tanque        TEXT,
                num_bico          TEXT,
                enc_ini           NUMERIC(15,3),
                enc_fin           NUMERIC(15,3),
                qtd_af            NUMERIC(15,3),
                vol_bico          NUMERIC(15,3),
                enc_ini_corrigido NUMERIC(15,3),
                enc_fin_corrigido NUMERIC(15,3),
                qtd_af_corrigido  NUMERIC(15,3),
                corrigido         BOOLEAN DEFAULT FALSE,
                UNIQUE (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico)
            );
        `);
        console.log('Tabela sped_1320 garantida.');

        console.log('Estrutura de Auditoria Avançada, Cofre A1 e Cadastro de CFOPs estabilizada.');
    } catch (err) {
        console.error('Erro ao configurar banco:', err);
    } finally {
        client.release();
        process.exit();
    }
}

setupDatabase();
