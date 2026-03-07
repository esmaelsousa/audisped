// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const readline = require('readline');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const logger = require('./logger');
const { logEmitter } = require('./logger'); // Importa o emissor de logs
const ExcelJS = require('exceljs');
const path = require('path');
const xml2js = require('xml2js');

const uploadDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const xmlUploadDir = path.resolve(__dirname, 'uploads/xml_temp');
if (!fs.existsSync(xmlUploadDir)) fs.mkdirSync(xmlUploadDir, { recursive: true });

const uploadXml = multer({ dest: xmlUploadDir });

const app = express();
const PORT = process.env.PORT || 15435;

app.use(cors());
app.use(express.json());

// --- ENDPOINT DE STREAMING DE LOGS (SSE) ---
app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const onLog = (msg) => {
        res.write(`data: ${JSON.stringify({ message: msg, timestamp: new Date().toISOString() })}\n\n`);
    };

    logEmitter.on('log', onLog);

    req.on('close', () => {
        logEmitter.removeListener('log', onLog);
    });
});

// Evita erro de favicon no navegador
app.get('/favicon.ico', (req, res) => res.status(204).end());

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const JWT_SECRET = process.env.JWT_SECRET || 'audisped-safira-token-secret-2025';

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(403).json({ message: 'Token inválido ou expirado.' });
    }
};

// --- ROTAS DE AUTENTICAÇÃO ---
app.post('/api/auth/register', async (req, res) => {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ message: 'Preencha todos os campos.' });

    const dbClient = await pool.connect();
    try {
        const hashedPassword = await bcrypt.hash(senha, 10);
        const query = 'INSERT INTO usuarios (nome, email, senha) VALUES ($1, $2, $3) RETURNING id, nome, email';
        const result = await dbClient.query(query, [nome, email, hashedPassword]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: 'Email já cadastrado.' });
        res.status(500).json({ message: 'Erro ao criar usuário.', error: err.message });
    } finally {
        dbClient.release();
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    const dbClient = await pool.connect();
    try {
        const query = 'SELECT * FROM usuarios WHERE email = $1';
        const result = await dbClient.query(query, [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(senha, user.senha))) {
            return res.status(401).json({ message: 'Email ou senha incorretos.' });
        }

        const token = jwt.sign({ id: user.id, nome: user.nome, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ token, user: { id: user.id, nome: user.nome, email: user.email } });
    } catch (err) {
        res.status(500).json({ message: 'Erro no servidor.', error: err.message });
    } finally {
        dbClient.release();
    }
});

const upload = multer({ dest: uploadDir });

// --- ROTA DE UPLOAD (COMPLETA E ROBUSTA) ---
app.post('/api/upload', authMiddleware, upload.single('spedfile'), async (req, res) => {
    if (!req.file) {
        logger.warn('Tentativa de upload sem arquivo.');
        return res.status(400).send({ message: 'Nenhum arquivo foi enviado.' });
    }
    logger.info(`Recebido upload: ${req.file.originalname}, Path: ${req.file.path}, Size: ${req.file.size}`);
    const filePath = req.file.path;
    const dbClient = await pool.connect();
    try {
        logger.info("Passo 1: Analisando o arquivo SPED em memória...");
        const parsedData = await parseSpedFile(filePath, req.file.originalname);

        if (!parsedData) {
            throw new Error("A análise do arquivo SPED não retornou dados.");
        }
        const { fileInfo, documents, participants, lmc, produtos } = parsedData;

        logger.info(`Passo 2: Arquivo analisado. Iniciando transação...`);
        await dbClient.query('BEGIN');

        // --- LÓGICA MULTI-EMPRESA ---
        logger.info(`Passo 2.1: Verificando/Criando empresa (CNPJ: ${fileInfo.cnpj_empresa})`);
        const empresaQuery = `
            INSERT INTO empresas (cnpj, nome_empresa, nome_fantasia, uf) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (cnpj) 
            DO UPDATE SET 
                nome_empresa = EXCLUDED.nome_empresa,
                nome_fantasia = COALESCE(EXCLUDED.nome_fantasia, empresas.nome_fantasia)
            RETURNING id;
        `;
        const empresaResult = await dbClient.query(empresaQuery, [fileInfo.cnpj_empresa, fileInfo.nome_empresa, fileInfo.nome_fantasia, fileInfo.uf]);
        const id_empresa = empresaResult.rows[0].id;
        logger.info(`Passo 2.2: Empresa registrada com ID: ${id_empresa}.`);
        // --- FIM DA LÓGICA MULTI-EMPRESA ---

        // --- LÓGICA DE DUPLICATAS E SUBSCRITA ---
        const { overwrite } = req.query;
        const checkQuery = 'SELECT id FROM sped_arquivos WHERE cnpj_empresa = $1 AND periodo_apuracao = $2';
        const checkResult = await dbClient.query(checkQuery, [fileInfo.cnpj_empresa, fileInfo.periodo_apuracao]);

        if (checkResult.rows.length > 0) {
            const oldId = checkResult.rows[0].id;
            logger.info(`Período já existente (Arquivo ID: ${oldId}). Limpando dados antigos para Retificação/Sobrescrita automática...`);

            await dbClient.query('DELETE FROM erros_analise WHERE id_sped_arquivo = $1', [oldId]);
            await dbClient.query('DELETE FROM documentos_c190 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $1)', [oldId]);
            await dbClient.query('DELETE FROM documentos_itens_c170 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $1)', [oldId]);
            await dbClient.query('DELETE FROM documentos_c100 WHERE id_sped_arquivo = $1', [oldId]);
            await dbClient.query('DELETE FROM lmc_movimentacao WHERE id_sped_arquivo = $1', [oldId]);
            await dbClient.query('DELETE FROM documentos_d100 WHERE id_sped_arquivo = $1', [oldId]);
            await dbClient.query('DELETE FROM sped_produtos WHERE id_sped_arquivo = $1', [oldId]);
            await dbClient.query('DELETE FROM sped_participantes WHERE id_sped_arquivo = $1', [oldId]);
            await dbClient.query('DELETE FROM sped_arquivos WHERE id = $1', [oldId]);

            logger.info(`Dados do período ${fileInfo.periodo_apuracao} limpos. Pronto para nova versão.`);
        }

        const absPath = path.resolve(filePath);
        const arqQuery = 'INSERT INTO sped_arquivos (nome_arquivo, cnpj_empresa, periodo_apuracao, id_empresa, caminho_arquivo) VALUES ($1, $2, $3, $4, $5) RETURNING id';
        const arqResult = await dbClient.query(arqQuery, [fileInfo.nome_arquivo, fileInfo.cnpj_empresa, fileInfo.periodo_apuracao, id_empresa, absPath]);
        const sped_arquivo_id = arqResult.rows[0].id;
        logger.info(`Passo 3: Arquivo SPED registrado com ID: ${sped_arquivo_id}. Inserindo dados...`);

        // Inserir LMC (Bloco 1)
        for (const [codItem, dailyMovements] of lmc.entries()) {
            for (const dayData of dailyMovements.values()) {
                const lmcQuery = `
                    INSERT INTO lmc_movimentacao (id_sped_arquivo, cod_item, num_tanque, cap_tanque, data_mov, estq_abert, vol_entr, vol_saidas, val_perda, val_ganho, estq_escr, fech_fisico)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
                `;
                // Gravamos num_tanque = '0' e cap = 0 para a consolidacao 1300 global
                await dbClient.query(lmcQuery, [sped_arquivo_id, codItem, '0', 0, dayData.date, dayData.estqAbert, dayData.volEntr, dayData.volSaidas, dayData.valPerda, dayData.valGanho, dayData.estqEscr, dayData.fechFisico]);
            }
        }
        logger.info(`Passo 4: Dados LMC (Bloco 1) inseridos.`);

        // Inserir Bloco D (D100)
        if (parsedData.blocoD && parsedData.blocoD.length > 0) {
            for (const d of parsedData.blocoD) {
                const dQuery = `
                    INSERT INTO documentos_d100 
                    (id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, cfop, vl_doc, vl_icms)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `;
                await dbClient.query(dQuery, [sped_arquivo_id, d.ind_oper, d.num_doc, d.cod_mod, d.cod_sit, d.dt_doc, d.cfop, d.vl_doc, d.vl_icms]);
            }
            logger.info(`Passo 4.5: Documentos do Bloco D (${parsedData.blocoD.length}) inseridos.`);
        }

        // Inserir Participantes (0150)
        for (const p of participants) {
            const partQuery = 'INSERT INTO sped_participantes (id_sped_arquivo, cod_part, nome, cnpj) VALUES ($1, $2, $3, $4) ON CONFLICT (id_sped_arquivo, cod_part) DO NOTHING';
            await dbClient.query(partQuery, [sped_arquivo_id, p.cod_part, p.nome, p.cnpj]);
        }
        logger.info(`Passo 5: Participantes (0150) inseridos.`);

        // Inserir Produtos (0200)
        for (const p of produtos) {
            const prodQuery = 'INSERT INTO sped_produtos (id_sped_arquivo, cod_item, descr_item) VALUES ($1, $2, $3) ON CONFLICT (id_sped_arquivo, cod_item) DO NOTHING';
            await dbClient.query(prodQuery, [sped_arquivo_id, p.cod_item, p.descr_item]);
        }
        logger.info(`Passo 5.5: Produtos (0200) inseridos.`);

        // Inserir Documentos (C100, C170, C190)
        for (const doc of documents) {
            const docQuery = 'INSERT INTO documentos_c100 (id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id';
            const docResult = await dbClient.query(docQuery, [sped_arquivo_id, doc.ind_oper, doc.num_doc, doc.cod_mod, doc.cod_sit, doc.dt_doc, doc.dt_e_s, doc.vl_doc, doc.cod_part, doc.chv_nfe]);
            const currentC100_id = docResult.rows[0].id;

            for (const item of doc.items) {
                const itemQuery = 'INSERT INTO documentos_itens_c170 (id_documento_c100, num_item, cod_item, qtd, unid, vl_item, cst_icms, cfop, cst_pis, cst_cofins) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)';
                await dbClient.query(itemQuery, [currentC100_id, item.num_item, item.cod_item, item.qtd, item.unid, item.vl_item, item.cst_icms, item.cfop, item.cst_pis, item.cst_cofins]);
            }

            for (const ana of doc.analytical) {
                const anaQuery = 'INSERT INTO documentos_c190 (id_documento_c100, cst_icms, cfop, aliq_icms, vl_opr, vl_bc_icms, vl_icms) VALUES ($1, $2, $3, $4, $5, $6, $7)';
                await dbClient.query(anaQuery, [currentC100_id, ana.cst, ana.cfop, ana.aliq, ana.vl_opr, ana.vl_bc_icms, ana.vl_icms]);
            }
        }
        logger.info(`Passo 6: Documentos (C100/C170/C190) inseridos.`);

        await dbClient.query('COMMIT');
        logger.info("Passo 7: Transação confirmada. Enviando resposta de sucesso.");
        res.status(200).send({
            message: `Arquivo processado e salvo com sucesso!`,
            id_sped_arquivo: sped_arquivo_id,
            fileInfo: { ...fileInfo, id_empresa } // Adiciona o id_empresa na resposta
        });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        logger.error('--- ERRO FATAL DURANTE O PROCESSAMENTO ---', { message: error.message, stack: error.stack });
        res.status(500).send({ message: "Ocorreu um erro crítico ao processar o arquivo. Verifique o log do backend para detalhes.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
        logger.info('Processo de upload finalizado. Arquivo retido para futuras exportações.');
    }
});

// --- ROTA DE PARSER DE XMLs (INJETOR SPED FASE 1) ---
app.post('/api/xml-injector/parse', authMiddleware, uploadXml.array('xmlFiles', 200), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send({ message: 'Nenhum arquivo XML enviado.' });
    }

    logger.info(`Iniciando parse de ${req.files.length} arquivos XMLs enviados.`);
    const parsedNotes = [];
    const erros = [];

    const parser = new xml2js.Parser({ explicitArray: false }); // Para não transformar tags únicas em array

    for (const file of req.files) {
        try {
            const xmlData = fs.readFileSync(file.path, 'utf-8');
            const result = await parser.parseStringPromise(xmlData);

            // Verificar se é uma NF-e válida
            const nfeNode = result.nfeProc ? result.nfeProc.NFe : result.NFe;
            if (!nfeNode || !nfeNode.infNFe) {
                erros.push(`Arquivo ${file.originalname} não é um XML de NF-e válido.`);
                continue;
            }

            const inf = nfeNode.infNFe;

            // Emitente
            const emit = inf.emit;
            const emitente = {
                cnpj: emit.CNPJ,
                nome: emit.xNome,
                ie: emit.IE,
                cod_mun: emit.enderEmit ? emit.enderEmit.cMun : ''
            };

            // Dados da C100 (Nota)
            const ide = inf.ide;
            const tpNF = (ide.tpNF || '0').toString(); // 0=Entrada, 1=Saída

            const c100 = {
                chv_nfe: (inf.$.Id || '').replace('NFe', ''),
                ind_oper: tpNF, // 0=Entrada, 1=Saída
                ind_emit: tpNF === '1' ? '0' : '1', // 0=Própria (Saída), 1=Terceiros (Entrada)
                cod_mod: ide.mod,
                cod_sit: '00', // Documento Regular
                num_doc: ide.nNF,
                serie: ide.serie,
                dt_doc: ide.dhEmi.substring(0, 10), // YYYY-MM-DD
                dt_e_s: ide.dhEmi.substring(0, 10), // Idealmente hora da entrada, usando emissão como fallback
                vl_doc: inf.total.ICMSTot.vNF,
                ind_frt: ide.modFrete,
                vl_merc: inf.total.ICMSTot.vProd,
                vl_desc: inf.total.ICMSTot.vDesc
            };

            // Itens (C170)
            let detArray = inf.det;
            if (!Array.isArray(detArray)) detArray = [detArray]; // Se tiver só 1 item, força array

            const itens = detArray.map(det => {
                const prod = det.prod;
                const imposto = det.imposto;

                // Buscar CST do ICMS original (pode vir de vários grupos)
                let cstOringinal = '';
                if (imposto?.ICMS) {
                    const icmsNode = Object.values(imposto.ICMS)[0]; // ICMS00, ICMS40, etc
                    cstOringinal = (icmsNode.CST) ? icmsNode.CST : ((icmsNode.CSOSN) ? icmsNode.CSOSN : '000');
                }

                return {
                    num_item: det.$.nItem,
                    cod_item: prod.cProd,
                    descr_item: prod.xProd,
                    qtd: prod.qCom,
                    unid: prod.uCom,
                    vl_item: prod.vProd,
                    vl_desc: prod.vDesc || '0',
                    cfop_original: prod.CFOP,
                    cst_icms_original: cstOringinal
                };
            });

            parsedNotes.push({
                arquivo: file.originalname,
                emitente,
                c100,
                itens
            });

        } catch (e) {
            logger.error(`Erro ao parsear XML ${file.originalname}:`, e);
            erros.push(`Falha na leitura do arquivo ${file.originalname}`);
        } finally {
            // Limpa o arquivo físico após processar a memória
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        }
    }

    // --- FASE 2: MOTOR TRIBUTÁRIO ---
    const { transformarNotasEmSped } = require('./services/xmlInjectorService');
    // Em breve vamos resgatar cfop_padrao e forceCst do corpo da requisição (req.body)
    const userCfopPadrao = req.body.cfop_padrao || '1102'; // Fallback
    const forcarCst040 = req.body.forcar_uso_consumo === 'true' || req.body.forcar_uso_consumo === true;

    logger.info(`Iniciando Fase 2: Conversão Tributária (CFOP Base: ${userCfopPadrao}, CST040: ${forcarCst040})`);

    let spedDataPayload = null;
    try {
        spedDataPayload = transformarNotasEmSped(parsedNotes, userCfopPadrao, forcarCst040);
        logger.info(`Fase 2 Concluída. Geradas ${spedDataPayload.bloco0.length} linhas do Bloco 0 e ${spedDataPayload.blocoC.length} linhas do Bloco C.`);
    } catch (err) {
        logger.error(`Erro na geração de linhas do SPED da Fase 2:`, err);
        return res.status(500).json({ message: "Erro interno ao processar regras de negócio SPED no motor da Fase 2.", error: err.message });
    }

    // --- FASES 3 E 4: COSTUREIRA FÍSICA E RECÁLCULO DE BLOCOS ---
    const idSpedBase = req.body.id_sped_arquivo;
    if (idSpedBase) {
        try {
            logger.info(`Iniciando Fase 3 e 4: Injeção Física no SPED ID ${idSpedBase}`);
            const dbClient = await pool.connect();
            const fileQuery = await dbClient.query('SELECT nome_arquivo, caminho_arquivo, cnpj_empresa, periodo_apuracao FROM sped_arquivos WHERE id = $1', [idSpedBase]);
            dbClient.release();

            if (fileQuery.rows.length === 0) {
                return res.status(404).json({ message: 'Arquivo SPED Base não encontrado no banco de dados.' });
            }

            const spedBaseObj = fileQuery.rows[0];
            // caminho_arquivo pode ser string simples ou JSON (compatibilidade com versões antigas)
            let fullSpedPath = spedBaseObj.caminho_arquivo;
            try {
                const parsed = JSON.parse(spedBaseObj.caminho_arquivo);
                if (parsed && typeof parsed === 'object') {
                    fullSpedPath = Object.values(parsed)[0];
                }
            } catch (e) {
                // É uma string simples, usa diretamente
                fullSpedPath = spedBaseObj.caminho_arquivo;
            }

            if (!fs.existsSync(fullSpedPath)) {
                return res.status(404).json({ message: 'O arquivo SPED Físico não foi localizado no disco do servidor.' });
            }

            const { injetarXmlEPersistir } = require('./services/spedCostureiraService');
            const finalSpedString = await injetarXmlEPersistir(fullSpedPath, spedDataPayload);

            // Devolver como download
            const rawName = `${spedBaseObj.cnpj_empresa}_${spedBaseObj.periodo_apuracao}`;
            const safeName = rawName.replace(/[\s\/\\:*?"<>|]+/g, '_') + '.txt';
            res.setHeader('Content-disposition', `attachment; filename=${safeName}`);
            res.setHeader('Content-type', 'text/plain; charset=iso-8859-1');
            res.write(finalSpedString);
            return res.end();

        } catch (err) {
            logger.error(`Erro na Fase 3/4 da Injeção Física:`, err);
            return res.status(500).json({ message: "Erro interno ao injetar XMLs no arquivo matriz.", error: err.message });
        }
    }

    // Fallback: Se não mandou um ID base, devolve só o Log Analítico
    res.status(200).json({
        message: "Extração XML e Formatação (Fase 1 e 2) concluída com sucesso. SPED Físico não informado para injeção.",
        gerencial: {
            totalArquivosRecebidos: req.files.length,
            sucessoParsings: parsedNotes.length,
            falhaParsings: erros.length,
            erroFiles: erros,
            estatisticasTributarias: spedDataPayload.relatorio
        },
        payloadInjecao: spedDataPayload
    });
});

// --- ROTA DE ANÁLISE COM MOTOR REAL (PRESENTE) ---
app.post('/api/analisar/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de análise com ID inválido: ${req.params.id}`);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    logger.info(`Iniciando análise REAL para o arquivo ID: ${arquivoId}`);
    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');
        await dbClient.query('DELETE FROM erros_analise WHERE id_sped_arquivo = $1', [arquivoId]);

        const erros = [];

        // REGRA 1B: Continuidade Intermensal de Estoque (Fase 19)
        // SAVEPOINT para isolar falhas desta regra sem abortar toda a transação
        try {
            await dbClient.query('SAVEPOINT sp_intermensal');
            const intermensalQuery = `
                WITH mes_atual AS (
                    SELECT id, cnpj_empresa, TO_DATE(LEFT(periodo_apuracao, 10), 'YYYY-MM-DD') as dt_inicio
                    FROM sped_arquivos WHERE id = $1
                ),
                mes_anterior_arquivo AS (
                    SELECT sa.id, sa.cnpj_empresa, sa.periodo_apuracao
                    FROM sped_arquivos sa
                    JOIN mes_atual ma ON sa.cnpj_empresa = ma.cnpj_empresa
                    WHERE TO_DATE(RIGHT(sa.periodo_apuracao, 10), 'YYYY-MM-DD') = (ma.dt_inicio - INTERVAL '1 day')::DATE
                    ORDER BY sa.id DESC LIMIT 1
                ),
                fechamento_anterior AS (
                    SELECT cod_item, num_tanque, fech_fisico
                    FROM (
                        SELECT cod_item, num_tanque, fech_fisico, data_mov,
                               ROW_NUMBER() OVER (PARTITION BY cod_item, num_tanque ORDER BY data_mov DESC) as rn
                        FROM lmc_movimentacao
                        WHERE id_sped_arquivo = (SELECT id FROM mes_anterior_arquivo LIMIT 1)
                          AND fech_fisico IS NOT NULL AND fech_fisico::numeric > 0
                    ) t WHERE rn = 1
                ),
                abertura_atual AS (
                    SELECT cod_item, num_tanque, estq_abert, data_mov
                    FROM (
                        SELECT cod_item, num_tanque, estq_abert, data_mov,
                               ROW_NUMBER() OVER (PARTITION BY cod_item, num_tanque ORDER BY data_mov ASC) as rn
                        FROM lmc_movimentacao
                        WHERE id_sped_arquivo = $1
                    ) t WHERE rn = 1
                )
                SELECT a.cod_item, p.descr_item as nome_combustivel, a.num_tanque, a.estq_abert, f.fech_fisico as fech_mes_anterior, a.data_mov,
                       ma.periodo_apuracao as periodo_anterior
                FROM abertura_atual a
                JOIN fechamento_anterior f ON a.cod_item = f.cod_item AND f.num_tanque = a.num_tanque
                LEFT JOIN sped_produtos p ON a.cod_item = p.cod_item AND p.id_sped_arquivo = $1
                LEFT JOIN mes_anterior_arquivo ma ON 1=1
                WHERE ABS(a.estq_abert::numeric - f.fech_fisico::numeric) > 0.5;
            `;

            const resIntermensal = await dbClient.query(intermensalQuery, [arquivoId]);
            await dbClient.query('RELEASE SAVEPOINT sp_intermensal');
            for (const row of resIntermensal.rows) {
                const diff = Math.abs(parseFloat(row.estq_abert) - parseFloat(row.fech_mes_anterior));
                const base = parseFloat(row.fech_mes_anterior) || 1;
                const perc = (diff / base) * 100;
                const isCritical = perc > 0.60;
                erros.push({
                    tipo_erro: isCritical ? 'CRITICAL' : 'WARNING',
                    regra_id: 'CRIT-1300-02',
                    titulo_erro: isCritical ? 'Quebra Crítica Intermensal (Abertura Falsa)' : 'Pequena Divergência Intermensal',
                    descricao_erro: `Combustível: **${row.nome_combustivel}**, Tanque ${row.num_tanque}. Abertura no dia ${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} (${row.estq_abert} L) diverge do fechamento real do mês passado (${row.fech_mes_anterior} L) em **${perc.toFixed(2)}%**.`,
                    sugestao_correcao: 'O estoque inicial deste mês DEVE ser exatamente o final do mês anterior.',
                    linha_arquivo: 0,
                    conteudo_linha: `${row.nome_combustivel} | Ant: ${row.fech_mes_anterior}L -> Atual: ${row.estq_abert}L | Δ ${diff.toFixed(3)}L`,
                    data_erro: row.data_mov,
                    cod_item_erro: row.cod_item,
                    num_tanque_erro: row.num_tanque
                });
            }
        } catch (errIntermensal) {
            await dbClient.query('ROLLBACK TO SAVEPOINT sp_intermensal');
            await dbClient.query('RELEASE SAVEPOINT sp_intermensal');
            logger.warn('Regra CRIT-1300-02 ignorada (sem mês anterior ou coluna faltando):', errIntermensal.message);
        }





        // REGRA 1: Continuidade de Estoque (Flexibilizada conforme sugestão do cliente)
        const continuidadeQuery = `
            WITH estoque_diario AS (
                SELECT 
                    lmc.cod_item, COALESCE(p.descr_item, lmc.cod_item) as nome_combustivel,
                    lmc.num_tanque, lmc.data_mov, 
                    COALESCE(lmc.estq_abert_ajustado, lmc.estq_abert) as estq_abert,
                    COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) as fech_fisico,
                    (COALESCE(lmc.estq_abert_ajustado, lmc.estq_abert) + COALESCE(lmc.vol_entr_ajustado, lmc.vol_entr)) as base_calculo,
                    LAG(COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico), 1, '0.0') OVER (PARTITION BY lmc.cod_item, lmc.num_tanque ORDER BY lmc.data_mov) as fech_dia_anterior
                FROM lmc_movimentacao lmc
                LEFT JOIN sped_produtos p ON lmc.id_sped_arquivo = p.id_sped_arquivo AND lmc.cod_item = p.cod_item
                WHERE lmc.id_sped_arquivo = $1
            )
            SELECT * FROM estoque_diario 
            WHERE ABS(estq_abert::numeric - fech_dia_anterior::numeric) > 0.5 -- Ignora micro-diferenças < 0.5L
              AND fech_dia_anterior::numeric > 0;
        `;
        const resContinuidade = await dbClient.query(continuidadeQuery, [arquivoId]);
        for (const row of resContinuidade.rows) {
            const diff = Math.abs(parseFloat(row.estq_abert) - parseFloat(row.fech_dia_anterior));
            const base = parseFloat(row.base_calculo) || 1;
            const perc = (diff / base) * 100;

            // Só torna CRÍTICO se fugir do padrão ANP de 0.6%
            if (perc > 0.60) {
                erros.push({
                    tipo_erro: 'CRITICAL', regra_id: 'CRIT-1300-01', titulo_erro: 'Quebra Crítica de Continuidade no Estoque',
                    descricao_erro: `Combustível: **${row.nome_combustivel}**, Tanque ${row.num_tanque} em ${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}: O estoque de abertura (${row.estq_abert}) diverge do fechamento anterior (${row.fech_dia_anterior}) em **${perc.toFixed(2)}%**.`,
                    sugestao_correcao: 'Diferença acima da tolerância legal de 0,6%. Verifique erros de digitação ou vazamentos não registrados.',
                    linha_arquivo: 0, conteudo_linha: `|1300|${row.num_tanque}|${row.estq_abert}|${row.fech_dia_anterior}|...`,
                    data_erro: row.data_mov, cod_item_erro: row.cod_item, num_tanque_erro: row.num_tanque
                });
            } else if (diff > 1.0) { // Pequeno aviso para diferenças entre 1L e 0.6%
                erros.push({
                    tipo_erro: 'WARNING', regra_id: 'WARN-1300-01', titulo_erro: 'Pequena Divergência de Continuidade',
                    descricao_erro: `Combustível: **${row.nome_combustivel}** em ${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}: Diferença de ${diff.toFixed(3)} L (${perc.toFixed(2)}%) entre abertura e fechamento anterior.`,
                    sugestao_correcao: 'Diferença dentro da margem de 0,6%, mas digna de nota para ajuste fino.',
                    linha_arquivo: 0, conteudo_linha: `|1300|...|Δ ${diff.toFixed(3)}L`,
                    data_erro: row.data_mov, cod_item_erro: row.cod_item, num_tanque_erro: row.num_tanque
                });
            }
        }

        // REGRA 2: Estoque Final > Capacidade
        const capacidadeQuery = `
            SELECT 
                lmc.cod_item, COALESCE(p.descr_item, lmc.cod_item) as nome_combustivel, 
                lmc.num_tanque, lmc.data_mov, 
                COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) as fech_fisico, 
                COALESCE(cfg.capacidade, lmc.cap_tanque) as cap_tanque
            FROM lmc_movimentacao lmc
            LEFT JOIN sped_produtos p ON lmc.id_sped_arquivo = p.id_sped_arquivo AND lmc.cod_item = p.cod_item
            LEFT JOIN sped_arquivos arq ON lmc.id_sped_arquivo = arq.id
            LEFT JOIN lmc_tanques_config cfg ON cfg.cnpj = arq.cnpj_empresa AND cfg.cod_item = lmc.cod_item
            WHERE lmc.id_sped_arquivo = $1 
              AND COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) > COALESCE(cfg.capacidade, lmc.cap_tanque) 
              AND COALESCE(cfg.capacidade, lmc.cap_tanque) > 0;
        `;
        const resCapacidade = await dbClient.query(capacidadeQuery, [arquivoId]);
        for (const row of resCapacidade.rows) {
            erros.push({
                tipo_erro: 'CRITICAL', regra_id: 'CRIT-1310-01', titulo_erro: 'Estoque Final Excede a Capacidade do Tanque',
                descricao_erro: `Combustível: **${row.nome_combustivel}**, Tanque ${row.num_tanque} em ${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}: O estoque final (${row.fech_fisico} L) é maior que a capacidade do tanque (${row.cap_tanque} L).`,
                sugestao_correcao: 'Verificar a medição física ou a capacidade informada do tanque.',
                linha_arquivo: 0, conteudo_linha: `|1310|${row.num_tanque}|${row.fech_fisico}|Capacidade: ${row.cap_tanque}|`,
                data_erro: row.data_mov, cod_item_erro: row.cod_item, num_tanque_erro: row.num_tanque
            });
        }

        // REGRA 3: Variação de Estoque > 0,60%
        const variacaoQuery = `
            SELECT 
                lmc.cod_item, COALESCE(p.descr_item, lmc.cod_item) as nome_combustivel, 
                lmc.num_tanque, lmc.data_mov, 
                COALESCE(lmc.vol_escr_ajustado, lmc.estq_escr) as estq_escr, 
                COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) as fech_fisico, 
                (COALESCE(lmc.estq_abert_ajustado, lmc.estq_abert) + COALESCE(lmc.vol_entr_ajustado, lmc.vol_entr)) as base_calculo
            FROM lmc_movimentacao lmc
            LEFT JOIN sped_produtos p ON lmc.id_sped_arquivo = p.id_sped_arquivo AND lmc.cod_item = p.cod_item
            WHERE lmc.id_sped_arquivo = $1 
              AND (COALESCE(lmc.estq_abert_ajustado, lmc.estq_abert) + COALESCE(lmc.vol_entr_ajustado, lmc.vol_entr)) > 0 
              AND (ABS(COALESCE(lmc.vol_escr_ajustado, lmc.estq_escr) - COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico)) / (COALESCE(lmc.estq_abert_ajustado, lmc.estq_abert) + COALESCE(lmc.vol_entr_ajustado, lmc.vol_entr))) > 0.006;
        `;
        const resVariacao = await dbClient.query(variacaoQuery, [arquivoId]);
        for (const row of resVariacao.rows) {
            const estqEscrNum = parseFloat(row.estq_escr);
            const fechFisicoNum = parseFloat(row.fech_fisico);
            const baseCalculoNum = parseFloat(row.base_calculo);
            const variacao = fechFisicoNum - estqEscrNum; // Negativo = Perda, Positivo = Ganho
            const percentual = (Math.abs(variacao) / baseCalculoNum) * 100;
            erros.push({
                tipo_erro: 'CRITICAL',
                regra_id: 'CRIT-1310-02',
                titulo_erro: 'Variação de Estoque Acima da Tolerância (0,60%)',
                descricao_erro: `Combustível: **${row.nome_combustivel}** (Tanque ${row.num_tanque}) em ${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}: Variação de **${percentual.toFixed(2)}%** excede o limite legal da ANP.`,
                sugestao_correcao: 'Esta é uma infração grave. Verificar medições, possíveis vazamentos ou aferições e justificar a perda/ganho imediatamente.',
                linha_arquivo: 0,
                conteudo_linha: `Est. Escritural: ${estqEscrNum.toFixed(3)} L | Fech. Físico: ${fechFisicoNum.toFixed(3)} L | Diferença: ${variacao.toFixed(3)} L`,
                data_erro: row.data_mov, cod_item_erro: row.cod_item, num_tanque_erro: row.num_tanque
            });
        }

        // REGRA 6: Estoque Negativo
        const negativoQuery = `
            SELECT 
                lmc.cod_item, COALESCE(p.descr_item, lmc.cod_item) as nome_combustivel, 
                lmc.num_tanque, lmc.data_mov, 
                COALESCE(lmc.vol_escr_ajustado, lmc.estq_escr) as estq_escr, 
                COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) as fech_fisico
            FROM lmc_movimentacao lmc
            LEFT JOIN sped_produtos p ON lmc.id_sped_arquivo = p.id_sped_arquivo AND lmc.cod_item = p.cod_item
            WHERE lmc.id_sped_arquivo = $1 
              AND (COALESCE(lmc.vol_escr_ajustado, lmc.estq_escr) < -0.01 OR COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) < -0.01);
        `;
        const resNegativo = await dbClient.query(negativoQuery, [arquivoId]);
        for (const row of resNegativo.rows) {
            erros.push({
                tipo_erro: 'CRITICAL', regra_id: 'CRIT-1310-04', titulo_erro: 'Estoque Negativo Detectado',
                descricao_erro: `Combustível: **${row.nome_combustivel}** (Tanque ${row.num_tanque}) em ${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}: Saldo negativo identificado (Escritural: ${row.estq_escr} | Físico: ${row.fech_fisico}).`,
                sugestao_correcao: 'Verifique se há notas de entrada não lançadas ou erros catastróficos de medição.',
                linha_arquivo: 0, conteudo_linha: `|1310|${row.num_tanque}|Fisico: ${row.fech_fisico}|Escr: ${row.estq_escr}|`,
                data_erro: row.data_mov, cod_item_erro: row.cod_item, num_tanque_erro: row.num_tanque
            });
        }

        // REGRA 4: Participante não Cadastrado
        const participanteQuery = `
            SELECT 
                doc.num_doc, 
                doc.cod_part, 
                doc.dt_doc
            FROM documentos_c100 doc
            WHERE doc.id_sped_arquivo = $1
              AND doc.cod_part IS NOT NULL
              AND doc.cod_part != ''
              AND doc.cod_part NOT IN (
                  SELECT p.cod_part 
                  FROM sped_participantes p 
                  WHERE p.id_sped_arquivo = $1
              );
        `;
        const resParticipante = await dbClient.query(participanteQuery, [arquivoId]);
        for (const row of resParticipante.rows) {
            erros.push({
                tipo_erro: 'CRITICAL',
                regra_id: 'CRIT-C100-01',
                titulo_erro: 'Participante não Cadastrado no Registro 0150',
                descricao_erro: `O documento fiscal **Nº ${row.num_doc}** (data: ${new Date(row.dt_doc).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}) utiliza o código de participante **${row.cod_part}**, que não foi encontrado na tabela de participantes (Registro 0150) deste arquivo.`,
                sugestao_correcao: 'Adicione um Registro 0150 para o participante ou corrija o código no documento fiscal.',
                linha_arquivo: 0,
                conteudo_linha: `|C100|...|${row.cod_part}|...|${row.num_doc}|...`,
                data_erro: row.dt_doc,
                cod_item_erro: null,
                num_tanque_erro: null
            });
        }

        // REGRA 5: Confronto Total do Mês: Notas de Entrada vs Volume Recebido LMC
        const notasVsLmcQuery = `
            WITH notas_entrada AS (
                SELECT 
                    item.cod_item, 
                    SUM(item.qtd) as volume_nota
                FROM documentos_c100 c100
                JOIN documentos_itens_c170 item ON item.id_documento_c100 = c100.id
                WHERE c100.id_sped_arquivo = $1 
                  AND c100.ind_oper = '0' 
                  AND (item.cfop LIKE '165%' OR item.cfop LIKE '265%')
                GROUP BY item.cod_item
            ),
            lmc_entrada AS (
                SELECT 
                    cod_item,
                    SUM(COALESCE(vol_entr_ajustado, vol_entr)) as volume_lmc
                FROM lmc_movimentacao
                WHERE id_sped_arquivo = $1
                GROUP BY cod_item
            )
            SELECT 
                COALESCE(n.cod_item, l.cod_item) as cod_item,
                COALESCE(p.descr_item, n.cod_item, l.cod_item) as nome_combustivel,
                COALESCE(n.volume_nota, 0) as volume_nota,
                COALESCE(l.volume_lmc, 0) as volume_lmc
            FROM notas_entrada n
            FULL OUTER JOIN lmc_entrada l ON n.cod_item = l.cod_item
            LEFT JOIN sped_produtos p ON p.id_sped_arquivo = $1 AND p.cod_item = COALESCE(n.cod_item, l.cod_item)
            WHERE ABS(COALESCE(n.volume_nota, 0)::numeric - COALESCE(l.volume_lmc, 0)::numeric) > 0.1;
        `;
        const resNotasVsLmc = await dbClient.query(notasVsLmcQuery, [arquivoId]);
        for (const row of resNotasVsLmc.rows) {
            const volNota = parseFloat(row.volume_nota);
            const volLmc = parseFloat(row.volume_lmc);
            const diff = Math.abs(volNota - volLmc);
            erros.push({
                tipo_erro: 'CRITICAL',
                regra_id: 'CRIT-1310-03',
                titulo_erro: 'Divergência entre Total de NF-e de Entrada e Recebimento no LMC (Mês)',
                descricao_erro: `Combustível: **${row.nome_combustivel}**. O volume total de entrada pelas NFes no arquivo (${volNota.toFixed(2)} L) diverge do volume total de recebimento declarado no LMC (${volLmc.toFixed(2)} L).`,
                sugestao_correcao: 'Verifique se faltam notas de entrada (CFOP 165x/265x) ou se há volumes de recebimento indevidos lançados no LMC.',
                linha_arquivo: 0,
                conteudo_linha: `Total NFs: ${volNota.toFixed(2)} L\nTotal LMC: ${volLmc.toFixed(2)} L\nDiferença: ${diff.toFixed(2)} L`,
                data_erro: null,
                cod_item_erro: row.cod_item,
                num_tanque_erro: null
            });
        }

        // REGRA 6: Validação Tributária (CST vs CFOP em operações de Combustíveis)
        const cstCfopQuery = `
            WITH vendas_combustiveis AS (
                SELECT 
                    c100.num_doc,
                    c100.dt_doc,
                    c100.chv_nfe,
                    item.num_item,
                    item.cod_item,
                    item.cfop,
                    item.cst_icms,
                    item.vl_item
                FROM documentos_c100 c100
                JOIN documentos_itens_c170 item ON item.id_documento_c100 = c100.id
                WHERE c100.id_sped_arquivo = $1 
                  AND c100.ind_oper = '1' 
                  AND (item.cfop LIKE '_65_' OR item.cfop LIKE '_66_')
                  AND item.cst_icms IN ('000', '020', '040', '041', '090')
            )
            SELECT
                v.num_doc,
                v.dt_doc,
                v.chv_nfe,
                v.num_item,
                v.cod_item,
                p.descr_item,
                v.cfop,
                v.cst_icms,
                v.vl_item
            FROM vendas_combustiveis v
            LEFT JOIN sped_produtos p ON p.id_sped_arquivo = $1 AND p.cod_item = v.cod_item;
        `;
        const resCstCfop = await dbClient.query(cstCfopQuery, [arquivoId]);
        for (const row of resCstCfop.rows) {
            erros.push({
                tipo_erro: 'WARNING',
                regra_id: 'RTAX-C170-01',
                titulo_erro: 'Tributação Incompatível: Venda de Combustível sem ICMS-ST',
                descricao_erro: `O combustível **${row.descr_item || row.cod_item}** foi faturado na NF-e **Nº ${row.num_doc}** com CFOP **${row.cfop}** (Grupo de Combustíveis/Lubrificantes), mas utilizando o CST de ICMS **${row.cst_icms}** (Tributação Integral/Outros). Varejo de combustíveis possui regime de Substituição Tributária (ex: CST 060 ou 500).`,
                sugestao_correcao: 'Revise o cadastro tributário do produto no Frente de Caixa. O uso de CST 000 em revenda de combustível pode gerar bi-tributação de ICMS.',
                linha_arquivo: 0,
                conteudo_linha: `NF-e: ${row.num_doc} | Chave: ${row.chv_nfe}\nItem: ${row.num_item} | CFOP: ${row.cfop} | CST: ${row.cst_icms} | Valor: R$ ${parseFloat(row.vl_item).toFixed(2)}`,
                data_erro: row.dt_doc,
                cod_item_erro: row.cod_item,
                num_tanque_erro: null
            });
        }

        // REGRA 7: Auditoria de Quebra de Sequência de Documentos Fiscais
        const quebraSeqQuery = `
            WITH notas_saida AS (
                SELECT 
                    cod_mod,
                    COALESCE(SUBSTRING(chv_nfe, 35, 3), '0') as ser,
                    CAST(num_doc AS bigint) as num_doc,
                    dt_doc
                FROM documentos_c100
                WHERE id_sped_arquivo = $1 
                  AND ind_oper = '1'
                  AND num_doc ~ '^[0-9]+$'
            ),
            notas_com_lag AS (
                SELECT 
                    cod_mod,
                    ser,
                    num_doc,
                    dt_doc,
                    LAG(num_doc) OVER (PARTITION BY cod_mod, ser ORDER BY num_doc) as num_doc_anterior
                FROM notas_saida
            )
            SELECT 
                cod_mod,
                ser,
                (num_doc_anterior + 1) as gap_inicio,
                (num_doc - 1) as gap_fim,
                dt_doc
            FROM notas_com_lag
            WHERE num_doc_anterior IS NOT NULL 
              AND num_doc > num_doc_anterior + 1
            ORDER BY cod_mod, ser, gap_inicio;
        `;
        const resQuebraSeq = await dbClient.query(quebraSeqQuery, [arquivoId]);
        for (const row of resQuebraSeq.rows) {
            const gapSize = parseInt(row.gap_fim) - parseInt(row.gap_inicio) + 1;
            erros.push({
                tipo_erro: 'WARNING',
                regra_id: 'RSEQ-C100-01',
                titulo_erro: 'Quebra de Sequência na Numeração de Notas Fiscais',
                descricao_erro: `Foi detectada uma quebra de sequência nas emissões (Modelo ${row.cod_mod}, Série ${row.ser}). Os documentos de **Nº ${row.gap_inicio}** até **Nº ${row.gap_fim}** (total de ${gapSize} notas) estão faltando no SPED.`,
                sugestao_correcao: 'Verifique se essas notas foram canceladas, inutilizadas ou se houve falha no envio para a contabilidade. Em caso de inutilização, devem constar nos registros correspondentes.',
                linha_arquivo: 0,
                conteudo_linha: `Modelo: ${row.cod_mod} | Série: ${row.ser}\nFaltam do: ${row.gap_inicio} ao ${row.gap_fim}`,
                data_erro: row.dt_doc,
                cod_item_erro: null,
                num_tanque_erro: null
            });
        }

        // REGRA 8: Notas de Entrada de Emissão Própria (Cruzamento 0000 vs C100)
        const notasPropriasQuery = `
            SELECT c.num_doc, c.dt_doc, c.chv_nfe, c.cod_part
            FROM documentos_c100 c
            JOIN sped_participantes p ON c.id_sped_arquivo = p.id_sped_arquivo AND c.cod_part = p.cod_part
            JOIN sped_arquivos a ON c.id_sped_arquivo = a.id
            JOIN empresas e ON a.id_empresa = e.id
            WHERE c.id_sped_arquivo = $1 
              AND c.ind_oper = '0'
              AND p.cnpj = e.cnpj
              AND c.cod_sit = '00';
        `;
        const resNotasProprias = await dbClient.query(notasPropriasQuery, [arquivoId]);
        for (const row of resNotasProprias.rows) {
            erros.push({
                tipo_erro: 'WARNING',
                regra_id: 'RTAX-C100-02',
                titulo_erro: 'Nota de Entrada de Emissão Própria Detectada',
                descricao_erro: `A NF-e **Nº ${row.num_doc}** foi lançada como entrada, mas o CNPJ do emitente é o mesmo da empresa declarante.`,
                sugestao_correcao: 'Verifique se trata-se de uma nota de devolução emitida por você mesmo ou se houve erro no lançamento do participante.',
                linha_arquivo: 0,
                conteudo_linha: `Nota: ${row.num_doc} | Chave: ${row.chv_nfe}`,
                data_erro: row.dt_doc,
                cod_item_erro: null,
                num_tanque_erro: null
            });
        }

        // REGRA 9: Integridade de Estoque LMC (Estoque Final D-1 vs Inicial D) - Flexibilizada
        const estoqueSequencialQuery = `
            WITH estoque_diario AS (
                SELECT 
                    data_mov,
                    cod_item,
                    SUM(estq_abert) as est_inic,
                    SUM(vol_entr) as volume_entr_dia,
                    SUM(estq_escr) as est_fim,
                    LAG(SUM(estq_escr)) OVER (PARTITION BY cod_item ORDER BY data_mov) as est_fim_anterior
                FROM lmc_movimentacao
                WHERE id_sped_arquivo = $1
                GROUP BY data_mov, cod_item
            )
            SELECT ed.*, p.descr_item 
            FROM estoque_diario ed
            LEFT JOIN sped_produtos p ON ed.cod_item = p.cod_item AND p.id_sped_arquivo = $1
            WHERE ed.est_fim_anterior IS NOT NULL 
              AND ABS(ed.est_inic - ed.est_fim_anterior) > 0.5; -- Ignora micro-diferenças
        `;
        const resEstoqueSeq = await dbClient.query(estoqueSequencialQuery, [arquivoId]);
        for (const row of resEstoqueSeq.rows) {
            const diff = parseFloat(row.est_inic) - parseFloat(row.est_fim_anterior);
            const absoluteDiff = Math.abs(diff);
            const baseEstoque = parseFloat(row.est_fim_anterior) || 1;
            const perc = (absoluteDiff / baseEstoque) * 100;
            const statusDiferenca = diff > 0 ? 'sobra' : 'falta';
            const nomeProduto = row.descr_item || row.cod_item;

            const isCritical = perc > 0.60;

            erros.push({
                tipo_erro: isCritical ? 'CRITICAL' : 'WARNING',
                regra_id: 'RSEQ-1300-01',
                titulo_erro: isCritical ? 'Quebra Crítica de Continuidade' : 'Pequena Divergência de Continuidade',
                descricao_erro: `No dia **${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}**, o estoque inicial (${row.est_inic} L) diverge do estoque final anterior (${row.est_fim_anterior} L) em **${perc.toFixed(2)}%**.`,
                sugestao_correcao: isCritical
                    ? 'Diferença acima do limite legal de 0,6%. Corrija os registros diários do LMC.'
                    : 'Divergência leve identificada (dentro dos 0,6%). Monitore para evitar acúmulo de perdas.',
                linha_arquivo: 0,
                conteudo_linha: `${nomeProduto} | Diferença: ${absoluteDiff.toFixed(3)} L (${statusDiferenca}) | Esperado: ${row.est_fim_anterior} | Informado: ${row.est_inic}`,
                data_erro: row.data_mov,
                cod_item_erro: row.cod_item,
                num_tanque_erro: null
            });
        }

        // REGRA 10: PIS/COFINS Monofásico (Combustíveis)
        const pisCofinsQuery = `
            SELECT c100.num_doc, c100.dt_doc, item.num_item, item.cod_item, item.cst_pis, item.cst_cofins, p.descr_item
            FROM documentos_c100 c100
            JOIN documentos_itens_c170 item ON item.id_documento_c100 = c100.id
            LEFT JOIN sped_produtos p ON item.cod_item = p.cod_item AND p.id_sped_arquivo = c100.id_sped_arquivo
            WHERE c100.id_sped_arquivo = $1 
              AND c100.ind_oper = '1'
              AND (item.cfop LIKE '_65_' OR item.cfop LIKE '_66_')
              AND (item.cst_pis NOT IN ('04', '06') OR item.cst_cofins NOT IN ('04', '06'));
        `;
        const resPisCofins = await dbClient.query(pisCofinsQuery, [arquivoId]);
        for (const row of resPisCofins.rows) {
            const nomeProduto = row.descr_item || row.cod_item;
            erros.push({
                tipo_erro: 'WARNING',
                regra_id: 'RTAX-C170-02',
                titulo_erro: 'CST de PIS/COFINS Incorreto para Combustíveis',
                descricao_erro: `O produto **${nomeProduto}** na nota **${row.num_doc}** está com CST PIS: ${row.cst_pis} / COFINS: ${row.cst_cofins}. Para combustíveis monofásicos, o correto na venda é 04 ou 06.`,
                sugestao_correcao: 'Altere o cadastro de PIS/COFINS do produto para Alíquota Zero ou Monofásico para evitar tributação indevida.',
                linha_arquivo: 0,
                conteudo_linha: `Produto: ${nomeProduto} | PIS: ${row.cst_pis} | COFINS: ${row.cst_cofins}`,
                data_erro: row.dt_doc,
                cod_item_erro: row.cod_item,
                num_tanque_erro: null
            });
        }

        // REGRA 11: Auditoria do Bloco D (Transporte - D100)
        const blocoDQuery = `
            SELECT d.num_doc, d.dt_doc, d.cod_mod, d.cfop, d.vl_doc, d.vl_icms
            FROM documentos_d100 d
            WHERE d.id_sped_arquivo = $1 
              AND d.vl_icms > 0 
              AND (d.cfop NOT LIKE '135%' AND d.cfop NOT LIKE '235%');
        `;
        const resBlocoD = await dbClient.query(blocoDQuery, [arquivoId]);
        for (const row of resBlocoD.rows) {
            erros.push({
                tipo_erro: 'WARNING',
                regra_id: 'RTAX-D100-01',
                titulo_erro: 'Crédito de ICMS em Frete com CFOP Inadequado',
                descricao_erro: `O D100 (CT-e) **Nº ${row.num_doc}** possui destaque de ICMS (R$ ${parseFloat(row.vl_icms).toFixed(2)}), mas utiliza o CFOP **${row.cfop}**. Para tomada de crédito de frete sobre compras, o CFOP deve ser iniciado em 1.35x ou 2.35x.`,
                sugestao_correcao: 'Revise se a operação dá direito a crédito e se o CFOP foi escriturado corretamente.',
                linha_arquivo: 0,
                conteudo_linha: `CT-e: ${row.num_doc} | CFOP: ${row.cfop} | Valor ICMS: R$ ${parseFloat(row.vl_icms).toFixed(2)}`,
                data_erro: row.dt_doc,
                cod_item_erro: null,
                num_tanque_erro: null
            });
        }

        // Insere todos os erros no banco com padronização de data para ISO
        for (const erro of erros) {
            const queryInsert = `
                INSERT INTO erros_analise(
                    id_sped_arquivo, tipo_erro, regra_id, titulo_erro, descricao_erro,
                    sugestao_correcao, linha_arquivo, conteudo_linha,
                    data_erro, cod_item_erro, num_tanque_erro
                ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
            `;
            // Normaliza data para String YYYY-MM-DD para evitar problemas de fuso
            const dataNormalizada = erro.data_erro ? (erro.data_erro instanceof Date ? erro.data_erro.toISOString().split('T')[0] : erro.data_erro) : null;

            await dbClient.query(queryInsert, [
                arquivoId, erro.tipo_erro, erro.regra_id, erro.titulo_erro, erro.descricao_erro,
                erro.sugestao_correcao, erro.linha_arquivo, erro.conteudo_linha,
                dataNormalizada, erro.cod_item_erro, erro.num_tanque_erro
            ]);
        }

        await dbClient.query('COMMIT');
        logger.info(`Análise concluída para o arquivo ID: ${arquivoId}. ${erros.length} erros salvos.`);

        res.status(200).send({ message: "Análise concluída com sucesso." });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        logger.error('--- ERRO AO EXECUTAR ANÁLISE ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao executar análise.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA PARA BUSCAR ERROS (PRESENTE) ---
app.get('/api/erros/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de buscar erros com ID inválido: ${req.params.id} `);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }
    logger.info(`Buscando erros para o arquivo ID: ${arquivoId} `);
    const dbClient = await pool.connect();
    try {
        const { rows } = await dbClient.query('SELECT * FROM erros_analise WHERE id_sped_arquivo = $1', [arquivoId]);
        logger.info(`Encontrados ${rows.length} erros para o arquivo ID: ${arquivoId} `);
        res.status(200).json(rows);
    } catch (error) {
        logger.error('--- ERRO AO BUSCAR ERROS ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao buscar erros.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ENDPOINTS DE HISTÓRICO E GESTÃO ---

// Listar todas as empresas com filtros inteligentes
app.get('/api/empresas', authMiddleware, async (req, res) => {
    const { busca } = req.query;
    const dbClient = await pool.connect();
    try {
        let query = 'SELECT * FROM empresas';
        let params = [];

        if (busca) {
            query += ' WHERE nome_empresa ILIKE $1 OR nome_fantasia ILIKE $1 OR cnpj ILIKE $1';
            params.push(`%${busca}%`);
        }

        query += ' ORDER BY nome_empresa ASC';
        const { rows } = await dbClient.query(query, params);
        res.json(rows);
    } catch (error) {
        logger.error('Erro ao listar empresas:', error);
        res.status(500).send("Erro ao carregar empresas.");
    } finally {
        dbClient.release();
    }
});

// Listar TODOS os arquivos (para o Injetor Global) - filtra para mostrar apenas arquivos físicos existentes
app.get('/api/arquivos', authMiddleware, async (req, res) => {
    const dbClient = await pool.connect();
    try {
        const query = `
            SELECT a.id, a.nome_arquivo, a.periodo_apuracao, a.data_upload, a.caminho_arquivo, e.nome_empresa
            FROM sped_arquivos a
            LEFT JOIN empresas e ON a.id_empresa = e.id
            WHERE a.caminho_arquivo IS NOT NULL
            ORDER BY a.data_upload DESC
        `;
        const { rows } = await dbClient.query(query);

        // Filtra apenas arquivos que existem fisicamente no disco
        const arquivosValidos = rows.filter(row => {
            try {
                return fs.existsSync(row.caminho_arquivo);
            } catch (e) {
                return false;
            }
        }).map(row => ({
            id: row.id,
            nome_arquivo: row.nome_arquivo,
            periodo_apuracao: row.periodo_apuracao,
            data_upload: row.data_upload,
            nome_empresa: row.nome_empresa
        }));

        res.json(arquivosValidos);
    } catch (error) {
        logger.error('Erro ao listar todos os arquivos:', error);
        res.status(500).send("Erro ao carregar arquivos.");
    } finally {
        dbClient.release();
    }
});

// Listar arquivos (períodos) de uma empresa específica
app.get('/api/arquivos/:id_empresa', authMiddleware, async (req, res) => {
    const idEmpresa = parseInt(req.params.id_empresa);
    const dbClient = await pool.connect();
    try {
        const query = `
            SELECT id, nome_arquivo, periodo_apuracao, data_upload 
            FROM sped_arquivos 
            WHERE id_empresa = $1 
            ORDER BY data_upload DESC
        `;
        const { rows } = await dbClient.query(query, [idEmpresa]);
        res.json(rows);
    } catch (error) {
        logger.error('Erro ao listar períodos:', error);
        res.status(500).send("Erro ao carregar histórico da empresa.");
    } finally {
        dbClient.release();
    }
});

// Buscar metadados de um arquivo específico para carregar análise
app.get('/api/arquivo/info/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    const dbClient = await pool.connect();
    try {
        const query = `
            SELECT a.*, e.nome_empresa, e.cnpj as cnpj_real, e.uf
            FROM sped_arquivos a
            JOIN empresas e ON a.id_empresa = e.id
            WHERE a.id = $1
        `;
        const { rows } = await dbClient.query(query, [arquivoId]);
        if (rows.length === 0) return res.status(404).send("Arquivo não encontrado.");

        const arq = rows[0];
        res.json({
            id: arq.id,
            nome: arq.nome_arquivo,
            periodo: arq.periodo_apuracao,
            cnpj: arq.cnpj_real,
            empresa: arq.nome_empresa,
            uf: arq.uf,
            id_empresa: arq.id_empresa
        });
    } catch (error) {
        logger.error('Erro ao carregar info do arquivo:', error);
        res.status(500).send("Erro ao carregar dados do arquivo.");
    }
});

// --- RELATÓRIO DO LMC DIÁRIO ---
app.get('/api/lmc/:id_sped', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_sped);
    const dbClient = await pool.connect();
    try {
        const query = `
            WITH notas_entrada AS (
                SELECT 
                    item.cod_item, 
                    c100.dt_e_s as data_entrada,
                    SUM(item.qtd) as volume_nota,
                    json_agg(
                        json_build_object(
                            'num_doc', c100.num_doc,
                            'dt_doc', c100.dt_doc,
                            'qtd', item.qtd,
                            'fornecedor', COALESCE(part.nome, 'Não Informado')
                        )
                    ) as nfs_detalhadas
                FROM documentos_c100 c100
                JOIN documentos_itens_c170 item ON item.id_documento_c100 = c100.id
                LEFT JOIN sped_participantes part ON part.cod_part = c100.cod_part AND part.id_sped_arquivo = c100.id_sped_arquivo
                WHERE c100.id_sped_arquivo = $1 
                  AND c100.ind_oper = '0' 
                  AND (
                      item.cfop LIKE '165%' OR 
                      item.cfop LIKE '265%' OR 
                      item.cfop LIKE '065%' OR 
                      item.cfop LIKE '65%' OR
                      item.cfop LIKE '116%' OR 
                      item.cfop LIKE '216%'
                  )
                GROUP BY item.cod_item, c100.dt_e_s
            ),
            lmc_entrada AS (
                SELECT 
                    cod_item,
                    data_mov,
                    SUM(estq_abert) as estq_abert,
                    SUM(vol_entr) as vol_entr,
                    SUM(vol_entr_ajustado) as vol_entr_ajustado,
                    SUM(vol_saidas) as vol_saidas,
                    SUM(vol_saidas_ajustado) as vol_saidas_ajustado,
                    SUM(val_perda) as val_perda,
                    SUM(val_perda_ajustado) as val_perda_ajustado,
                    SUM(val_ganho) as val_ganho,
                    SUM(val_ganho_ajustado) as val_ganho_ajustado,
                    SUM(estq_escr) as estq_escr,
                    SUM(fech_fisico) as fech_fisico,
                    SUM(fech_fisico_ajustado) as fech_fisico_ajustado,
                    SUM(estq_abert_ajustado) as estq_abert_ajustado,
                    SUM(vol_escr_ajustado) as vol_escr_ajustado
                FROM lmc_movimentacao
                WHERE id_sped_arquivo = $1
                GROUP BY cod_item, data_mov
            )
            SELECT 
                COALESCE(l.cod_item, n.cod_item) as cod_item,
                COALESCE(p.descr_item, l.cod_item, n.cod_item) as nome_combustivel,
                COALESCE(l.data_mov, n.data_entrada) as data_movimento,
                COALESCE(l.estq_abert, 0) as estq_abert,
                COALESCE(l.vol_entr, 0) as vol_entr_lmc,
                l.vol_entr_ajustado,
                COALESCE(n.volume_nota, 0) as volume_nota,
                COALESCE(n.nfs_detalhadas, '[]'::json) as nfs_detalhadas,
                COALESCE(l.vol_saidas, 0) as vol_saidas,
                l.vol_saidas_ajustado,
                COALESCE(l.val_perda, 0) as val_perda,
                l.val_perda_ajustado,
                COALESCE(l.val_ganho, 0) as val_ganho,
                l.val_ganho_ajustado,
                COALESCE(l.estq_escr, 0) as estq_escr,
                COALESCE(l.fech_fisico, 0) as fech_fisico,
                l.fech_fisico_ajustado,
                l.estq_abert_ajustado,
                l.vol_escr_ajustado,
                COALESCE(cfg.capacidade, 0) as capacidade_tanque
            FROM lmc_entrada l
            FULL OUTER JOIN notas_entrada n ON l.cod_item = n.cod_item AND (l.data_mov::date = n.data_entrada::date)
            LEFT JOIN sped_produtos p ON p.id_sped_arquivo = $1 AND p.cod_item = COALESCE(l.cod_item, n.cod_item)
            LEFT JOIN sped_arquivos arq ON arq.id = $1
            LEFT JOIN lmc_tanques_config cfg ON cfg.cnpj = arq.cnpj_empresa AND cfg.cod_item = COALESCE(l.cod_item, n.cod_item)
            ORDER BY nome_combustivel, data_movimento;
        `;
        const { rows } = await dbClient.query(query, [arquivoId]);

        // Agrupar por combustível para calcular cascata
        const porCombustivel = {};
        rows.forEach(row => {
            if (!porCombustivel[row.cod_item]) porCombustivel[row.cod_item] = [];
            porCombustivel[row.cod_item].push(row);
        });

        const lmcFinal = [];

        Object.keys(porCombustivel).forEach(codItem => {
            const items = porCombustivel[codItem].sort((a, b) => new Date(a.data_movimento) - new Date(b.data_movimento));

            items.forEach((row) => {
                // FASE 21: Priorizar estoque de abertura ajustado (âncora) se existir
                const abertOriginal = row.estq_abert_ajustado !== null ? parseFloat(row.estq_abert_ajustado) : parseFloat(row.estq_abert || 0);
                const entr = parseFloat(row.vol_entr_lmc || 0);
                const saida = row.vol_saidas_ajustado !== null ? parseFloat(row.vol_saidas_ajustado) : parseFloat(row.vol_saidas || 0);
                const fisico = row.fech_fisico_ajustado !== null ? parseFloat(row.fech_fisico_ajustado) : parseFloat(row.fech_fisico || 0);
                const cap = parseFloat(row.capacidade_tanque || 0);

                const perda_orig = parseFloat(row.val_perda || 0);
                const ganho_orig = parseFloat(row.val_ganho || 0);

                // AUDITORIA ESTÁTICA (PADRÃO FISCAL):
                // O Escritural para auditoria usa o C8 literal do SPED se não houver ajuste manual.
                // Se houver ajuste (rateio), recalculamos: ABERT + ENTR - NOVA_SAIDA
                const escrCalculadoBase = abertOriginal + entr - saida;
                const escrSpedOriginal = parseFloat(row.estq_escr || 0);

                // ESCRITURAL FINAL: Se houver ajuste manual de saída, gera novo estoque. 
                // Se não, usa o que está no arquivo (C8).
                const escrFinal = (row.vol_saidas_ajustado !== null) ? escrCalculadoBase : escrSpedOriginal;

                // DIFERENÇA = FÍSICO - ESCRITURAL (Igual ao Validador HTML)
                const diffLitre = fisico - escrFinal;

                // % ANP = (MOD(DIF) / (ABERT+ENTR)) * 100
                const volumeBase = abertOriginal + entr;
                const varPerc = volumeBase > 0 ? (Math.abs(diffLitre) / volumeBase) * 100 : 0;

                let status = 'CONFORME';
                if (varPerc > 0.60) status = 'FORA LIMITE';
                if (escrFinal < -0.01 || fisico < -0.01) status = 'NEGATIVO';
                if (cap > 0 && fisico > cap) status = 'EXCESSO';

                lmcFinal.push({
                    ...row,
                    estq_abert_final: abertOriginal,
                    vol_saidas_final: saida,
                    fech_fisico_final: fisico,
                    estq_escr_final: escrFinal,
                    val_perda: perda_orig,
                    val_ganho: ganho_orig,
                    variacao_litros: diffLitre,
                    variacao_percentual: varPerc,
                    status_anp: status
                });
            });
        });

        res.json(lmcFinal);
    } catch (error) {
        logger.error('Erro ao processar visão do LMC:', error);
        res.status(500).send("Erro ao processar as métricas do LMC.");
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE OVERRIDE DO ESTOQUE INICIAL (FASE 20) ---
app.post('/api/lmc/update-estoque-inicial', authMiddleware, async (req, res) => {
    logger.info('[DEBUG REQ] /api/lmc/update-estoque-inicial Body:', req.body);
    const { id_arquivo, cod_item, novo_estoque } = req.body;

    if (!id_arquivo || !cod_item || novo_estoque === undefined) {
        return res.status(400).json({ error: "Parâmetros incompletos (id_arquivo, cod_item, novo_estoque)" });
    }

    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');

        // Garante que a coluna de ajuste exista
        await dbClient.query('ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS estq_abert_ajustado NUMERIC(15,3);');

        // Encontra a primeira data válida do LMC para este item neste SPED
        const resFirstDay = await dbClient.query(`
            SELECT data_mov 
            FROM lmc_movimentacao
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            ORDER BY data_mov ASC
            LIMIT 1
        `, [id_arquivo, cod_item]);

        if (resFirstDay.rows.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: "Nenhum LMC encontrado para este produto no mês." });
        }

        const dataPrimeiroDia = resFirstDay.rows[0].data_mov;

        // Atualiza a abertura de TODOS os registros LMC desse dia (todos os tanques)
        await dbClient.query(`
            UPDATE lmc_movimentacao
            SET estq_abert_ajustado = $3
            WHERE id_sped_arquivo = $1 AND cod_item = $2 AND data_mov = $4
        `, [id_arquivo, cod_item, parseFloat(novo_estoque), dataPrimeiroDia]);

        await dbClient.query('COMMIT');

        logger.info(`Estoque inicial do produto ${cod_item} no arquivo ${id_arquivo} ajustado para ${novo_estoque} L (todos os tanques do dia 1).`);
        res.json({ message: "Estoque Inicial ancorado com sucesso!" });
    } catch (e) {
        await dbClient.query('ROLLBACK');
        logger.error("Erro ao atualizar estoque inicial: ", e);
        res.status(500).json({ error: "Erro interno ao salvar novo estoque de abertura." });
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE OTIMIZAÇÃO MATEMÁTICA LMC COM RUÍDO ORGÂNICO ---
function getRandomNoise(margin) {
    return (Math.random() * 2 * margin) - margin;
}

app.post('/api/lmc/otimizador-matematico', authMiddleware, async (req, res) => {
    const { id_arquivo, cod_item, volume_alvo } = req.body;

    if (!id_arquivo || !cod_item || !volume_alvo) {
        return res.status(400).json({ error: "Parâmetros incompletos (id_arquivo, cod_item, volume_alvo)" });
    }

    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');

        // 1. Obter capacidade total dos tanques
        const capRes = await dbClient.query(`
            SELECT SUM(c.capacidade) as capacidade_total
            FROM lmc_tanques_config c
            JOIN sped_arquivos a ON a.cnpj_empresa = c.cnpj
            WHERE a.id = $1 AND c.cod_item = $2
        `, [id_arquivo, cod_item]);
        const capacidadeTotal = parseFloat(capRes.rows[0]?.capacidade_total || 0);

        // 2. Buscar LMC agrupado por dia (Consolidado)
        const resLmcConsolidado = await dbClient.query(`
            SELECT 
                data_mov,
                SUM(vol_entr) as vol_entr,
                SUM(vol_saidas) as vol_saidas,
                SUM(estq_abert) as estq_abert,
                SUM(estq_abert_ajustado) as estq_abert_ajustado
            FROM lmc_movimentacao 
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            GROUP BY data_mov
            ORDER BY data_mov ASC
        `, [id_arquivo, cod_item]);

        const dailyItems = resLmcConsolidado.rows;
        if (dailyItems.length === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: "Nenhum registro LMC encontrado." });
        }

        // 3. Buscar todos os registros originais para redistribuição final
        const resLmcOriginal = await dbClient.query(`
            SELECT id, data_mov, vol_saidas, vol_entr, estq_abert, fech_fisico
            FROM lmc_movimentacao 
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            ORDER BY data_mov ASC, num_tanque ASC
        `, [id_arquivo, cod_item]);
        const originalRows = resLmcOriginal.rows;

        // 4. Calcular Otimização no Consolidado Diário
        const volumeAntigoTotal = dailyItems.reduce((acc, i) => acc + parseFloat(i.vol_saidas || 0), 0);
        const limitRatio = 0.0050;

        const aberturaInicialConsolidada = parseFloat(dailyItems[0].estq_abert_ajustado ?? dailyItems[0].estq_abert ?? 0);

        let calcs = dailyItems.map(row => ({
            data_mov: row.data_mov,
            entradasOrig: parseFloat(row.vol_entr || 0),
            saidaOrig: parseFloat(row.vol_saidas || 0),
            saidaCalc: parseFloat(row.vol_saidas || 0),
            abertCalc: 0,
            escrCalc: 0,
            fisicoCalc: 0
        }));

        // 4.0 MOTOR V7: Curandeiro Analítico (Saneador Profilático)
        // Resolve erros bizarros do PDV original onde Venda Original > Estoque Físico.
        // Tira o volume impossível do dia, forçando o motor iterativo a recolocar esse volume em dias válidos.
        let tempStock = aberturaInicialConsolidada;
        for (let i = 0; i < calcs.length; i++) {
            let c = calcs[i];
            let maxSaidaPermitida = tempStock + c.entradasOrig - 0.5; // Deixa 0.5 de fundo de tanque
            if (c.saidaCalc > maxSaidaPermitida) {
                // Secou além do tolerável! Corta a venda.
                c.saidaCalc = Math.max(0, maxSaidaPermitida);
            }
            tempStock = tempStock + c.entradasOrig - c.saidaCalc;
        }

        // 4.1 MOTOR V5: Trava Inviolável de Venda Mínima (Física + ANP)
        // Calculamos quanto de combustível entra no mês e quanto cabe no tanque.
        // Se a venda for muito baixa, o tanque transborda (teoria).

        let targetReal = parseFloat(volume_alvo);
        let infoTrava = "";

        if (capacidadeTotal > 0) {
            let totalEntradasMes = calcs.reduce((acc, c) => acc + c.entradasOrig, 0);
            let margemSegurancaANP = 0.0055; // 0.55% para ficar abaixo dos 0.60%

            // Equação: Abertura + Entradas - Vendas - Perda/Ganho = Final
            // Para ser mácimo estoque (transbordar), o Ganho deve ser máximo.
            // Venda Mínima = Abertura Inicial + Total Entradas - (Capacidade Tanque * (1 + Margem))
            // Mas precisamos checar o PICO acumulado, não só o final do mês.

            let picoAcumulado = 0;
            let currentTempStock = aberturaInicialConsolidada;
            let totalVendaMinimaNecessaria = 0;

            for (let c of calcs) {
                currentTempStock += c.entradasOrig;
                // Se o estoque sem vender nada passar da capacidade, a diferença TEM que ser vendida
                if (currentTempStock > capacidadeTotal * (1 + margemSegurancaANP)) {
                    let excedente = currentTempStock - (capacidadeTotal * 0.98); // Alvo de 98%
                    totalVendaMinimaNecessaria += excedente;
                    currentTempStock -= excedente;
                }
            }

            if (targetReal < totalVendaMinimaNecessaria) {
                targetReal = totalVendaMinimaNecessaria;
                infoTrava = `Venda mínima ajustada para ${targetReal.toFixed(2)}L para não transbordar o tanque e cumprir a lei de 0,6% da ANP.`;
            }

            // MOTOR V6: Trava de Venda Máxima (Estoque Negativo)
            // Não se pode vender o que não se tem.
            let vendaMaximaPossivel = totalEntradasMes + aberturaInicialConsolidada - 0.5;
            if (targetReal > vendaMaximaPossivel) {
                targetReal = vendaMaximaPossivel;
                infoTrava = `Venda máxima ajustada para ${targetReal.toFixed(2)}L, pois seu estoque físico não suporta o valor solicitado.`;
            }
        }
        let iter = 0;
        while (iter < 100) {
            iter++;
            let currentTotalSaida = calcs.reduce((acc, c) => acc + c.saidaCalc, 0);
            let diff = targetReal - currentTotalSaida;

            if (Math.abs(diff) <= 0.5) break;

            // Recalcula cascata
            let runningAbertura = aberturaInicialConsolidada;
            let minFisicoFuturo = [];
            for (let i = 0; i < calcs.length; i++) {
                calcs[i].abertCalc = runningAbertura;
                calcs[i].escrCalc = calcs[i].abertCalc + calcs[i].entradasOrig - calcs[i].saidaCalc;
                calcs[i].fisicoCalc = calcs[i].escrCalc; // Simplificação inicial
                runningAbertura = calcs[i].fisicoCalc;
            }

            let minVal = Infinity;
            for (let i = calcs.length - 1; i >= 0; i--) {
                if (calcs[i].fisicoCalc < minVal) minVal = calcs[i].fisicoCalc;
                minFisicoFuturo[i] = minVal;
            }

            if (diff > 0) {
                let elegiveis = calcs.map((c, i) => ({ c, i, min: minFisicoFuturo[i] })).filter(x => x.min > 0.01);
                if (elegiveis.length === 0) break;
                // Aumento proporcional em vez de linear
                let totalAumentavel = elegiveis.reduce((s, x) => s + (x.min - 0.01), 0);
                if (totalAumentavel <= 0) break;

                for (let x of elegiveis) {
                    let peso = (x.min - 0.01) / totalAumentavel;
                    let cotaProporcional = diff * peso;

                    let maxTirar = Math.min(cotaProporcional, x.min - 0.01); // Margem de segurança de hardware minimizada
                    if (maxTirar > 0) {
                        x.c.saidaCalc += maxTirar;
                    }
                }
            } else {
                // REDUÇÃO DA VENDA: Rateio Proporcional pelo peso do dia, sem excluir micro-vendas
                let elegiveis = calcs.filter(c => c.saidaCalc > 0.001);
                if (elegiveis.length === 0) break;

                let totalSaindoNessesDias = elegiveis.reduce((s, c) => s + c.saidaCalc, 0);
                if (totalSaindoNessesDias <= 0) break;

                let diffAbs = Math.abs(diff);

                for (let c of elegiveis) {
                    let peso = c.saidaCalc / totalSaindoNessesDias;
                    let cotaProporcional = diffAbs * peso;

                    // Nunca zera a venda, deixa um rastro microscópico se for o caso
                    c.saidaCalc -= Math.min(cotaProporcional, c.saidaCalc - 0.001);
                }
            }
        }

        // 5. Redistribuir e Salvar (Volta para os tanques originais com cascata rigorosa)
        const updates = [];
        const lastClosingByTank = new Map(); // Para rastrear a cascata por tanque individual

        for (let i = 0; i < calcs.length; i++) {
            const dayCalc = calcs[i];
            const rowsDoDia = originalRows.filter(r => r.data_mov.getTime() === dayCalc.data_mov.getTime());

            let totalSaidaOriginalDia = rowsDoDia.reduce((acc, r) => acc + parseFloat(r.vol_saidas || 0), 0);
            let totalFisicoOriginalDia = rowsDoDia.reduce((acc, r) => acc + parseFloat(r.fech_fisico || 0), 0);

            // Re-calcula escritural consolidado para o dia com base na abertura real acumulada
            dayCalc.abertCalc = i === 0 ? aberturaInicialConsolidada : calcs[i - 1].fisicoCalc;
            dayCalc.escrCalc = dayCalc.abertCalc + dayCalc.entradasOrig - dayCalc.saidaCalc;

            // Aplica ruído no consolidado do dia proporcional ao volume disponível
            let volBase = dayCalc.abertCalc + dayCalc.entradasOrig;
            let maxDiffANP = volBase * 0.0055;
            let ruido = getRandomNoise(volBase * 0.003); // Ruído leve para parecer orgânico
            if (ruido > maxDiffANP) ruido = maxDiffANP;
            if (ruido < -maxDiffANP) ruido = -maxDiffANP;

            dayCalc.fisicoCalc = Math.max(0.5, dayCalc.escrCalc + ruido);
            if (capacidadeTotal > 0 && dayCalc.fisicoCalc > capacidadeTotal) {
                dayCalc.fisicoCalc = capacidadeTotal * 0.99;
            }

            rowsDoDia.forEach(r => {
                // Rateio Seguro: se original for zero, divide igualmente
                let pSaida = totalSaidaOriginalDia > 0 ? (parseFloat(r.vol_saidas || 0) / totalSaidaOriginalDia) : (1 / rowsDoDia.length);
                let pFisico = totalFisicoOriginalDia > 0 ? (parseFloat(r.fech_fisico || 0) / totalFisicoOriginalDia) : (1 / rowsDoDia.length);

                let sAjustada = dayCalc.saidaCalc * pSaida;
                let fAjustado = dayCalc.fisicoCalc * pFisico;

                // CASCATA POR TANQUE: Abertura hoje = Fechamento físico ajustado de ontem
                let aAjustada = lastClosingByTank.get(r.num_tanque);
                // Se for o primeiro dia do arquivo, usamos a abertura original do tanque
                if (aAjustada === undefined) aAjustada = parseFloat(r.estq_abert || 0);

                let eAjustada = parseFloat(r.vol_entr || 0);
                let escrTanque = Math.max(0, aAjustada + eAjustada - sAjustada);

                let diffPardaGanho = fAjustado - escrTanque;

                updates.push({
                    id: r.id,
                    abertura: aAjustada,
                    saida: sAjustada,
                    fisico: fAjustado,
                    perda: diffPardaGanho < 0 ? Math.abs(diffPardaGanho) : 0,
                    ganho: diffPardaGanho > 0 ? diffPardaGanho : 0,
                    escritural: escrTanque
                });

                // Atualiza o mapa para o dia seguinte
                lastClosingByTank.set(r.num_tanque, fAjustado);
            });
        }

        // Executar updates persistindo TODAS as colunas ajustadas
        for (const up of updates) {
            await dbClient.query(`
                UPDATE lmc_movimentacao 
                SET estq_abert_ajustado = $1,
                    vol_saidas_ajustado = $2, 
                    fech_fisico_ajustado = $3,
                    val_perda_ajustado = $4, 
                    val_ganho_ajustado = $5,
                    vol_escr_ajustado = $6,
                    vol_entr_ajustado = vol_entr -- Espelhamos a entrada por segurança
                WHERE id = $7
            `, [up.abertura, up.saida, up.fisico, up.perda, up.ganho, up.escritural, up.id]);
        }

        await dbClient.query('COMMIT');
        res.json({
            success: true,
            message: infoTrava || "Distribuição recalculada com inteligência de segurança ANP!",
            trava_anp: !!infoTrava
        });

    } catch (error) {
        await dbClient.query('ROLLBACK');
        logger.error("ERRO OTIMIZADOR V2:", error);
        res.status(500).json({ error: "Falha no motor matemático de recálculo." });
    } finally {
        dbClient.release();
    }
});

// Deletar um arquivo (período) e todos os seus dados vinculados
/**
 * Helper reutilizável para excluir um arquivo SPED e todas as suas dependências.
 * Usa try-catch individual para evitar que a ausência de uma tabela trave o processo.
 */
async function deleteSpedFile(arquivoId, dbClient) {
    const tabelas = [
        { name: 'erros_analise', col: 'id_sped_arquivo' },
        { name: 'documentos_c190', custom: `DELETE FROM documentos_c190 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $1)` },
        { name: 'documentos_itens_c170', custom: `DELETE FROM documentos_itens_c170 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $1)` },
        { name: 'documentos_c100', col: 'id_sped_arquivo' },
        { name: 'lmc_movimentacao', col: 'id_sped_arquivo' },
        { name: 'documentos_d100', col: 'id_sped_arquivo' },
        { name: 'sped_produtos', col: 'id_sped_arquivo' },
        { name: 'sped_participantes', col: 'id_sped_arquivo' }
    ];

    for (const tab of tabelas) {
        const sql = tab.custom ? tab.custom : `DELETE FROM ${tab.name} WHERE ${tab.col} = $1`;
        await dbClient.query(sql, [arquivoId]);
    }

    // Por fim, exclui o arquivo mestre
    await dbClient.query('DELETE FROM sped_arquivos WHERE id = $1', [arquivoId]);
}

app.delete('/api/periodo/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');
        await deleteSpedFile(arquivoId, dbClient);
        await dbClient.query('COMMIT');
        res.json({ message: "Período e dados residuais excluídos com sucesso." });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        logger.error('Erro ao excluir período:', error);
        res.status(500).send("Erro ao processar exclusão.");
    } finally {
        dbClient.release();
    }
});

app.post('/api/periodo/bulk-delete', authMiddleware, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "IDs não fornecidos para exclusão em lote." });
    }

    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');
        for (const id of ids) {
            await deleteSpedFile(parseInt(id), dbClient);
        }
        await dbClient.query('COMMIT');
        res.json({ message: `${ids.length} períodos excluídos com sucesso.` });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        logger.error('Erro na exclusão em lote:', error);
        res.status(500).json({ message: "Erro ao processar exclusão de alguns arquivos.", error: error.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE CONSULTA DE DOCUMENTOS DE ENTRADA (PRESENTE) ---
app.get('/api/documentos/entradas/:id_arquivo', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de buscar documentos com ID inválido: ${req.params.id_arquivo} `);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }
    logger.info(`Buscando documentos de entrada para o arquivo ID: ${arquivoId} `);
    const dbClient = await pool.connect();
    try {
        const query = `
            SELECT doc.id, doc.num_doc, doc.dt_doc, doc.dt_e_s, doc.vl_doc, part.nome as nome_fornecedor,
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'cod_item', item.cod_item,
                            'descr_item', p.descr_item,
                            'qtd', item.qtd,
                            'unid', item.unid,
                            'vl_item', item.vl_item,
                            'cfop', item.cfop,
                            'cst_icms', item.cst_icms
                        ) ORDER BY item.num_item
                    ) 
                       FROM documentos_itens_c170 AS item
                       LEFT JOIN sped_produtos AS p 
                           ON item.cod_item = p.cod_item 
                           AND p.id_sped_arquivo = doc.id_sped_arquivo
                       WHERE item.id_documento_c100 = doc.id
                ),
                '[]'::json) AS itens
            FROM documentos_c100 AS doc
            LEFT JOIN sped_participantes AS part ON doc.cod_part = part.cod_part AND doc.id_sped_arquivo = part.id_sped_arquivo
            WHERE doc.id_sped_arquivo = $1 AND doc.ind_oper = '0'
            ORDER BY doc.dt_e_s, doc.num_doc;
`;
        const { rows } = await dbClient.query(query, [arquivoId]);
        logger.info(`Encontrados ${rows.length} documentos de entrada para o arquivo ID: ${arquivoId} `);
        res.status(200).json(rows);
    } catch (error) {
        logger.error('--- ERRO AO BUSCAR DOCUMENTOS ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao buscar documentos.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA DE CONSULTA DE DOCUMENTOS DE SAÍDA (PRESENTE) ---
app.get('/api/documentos/saidas/:id_arquivo', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de buscar documentos de saída com ID inválido: ${req.params.id_arquivo} `);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    logger.info(`Buscando documentos de SAÍDA para o arquivo ID: ${arquivoId} `);
    const dbClient = await pool.connect();
    try {
        const query = `
            SELECT doc.id, doc.num_doc, doc.dt_doc, doc.dt_e_s, doc.vl_doc, part.nome as nome_fornecedor,
    COALESCE((SELECT json_agg(json_build_object(
        'cst_icms', ana.cst_icms, 'cfop', ana.cfop, 'aliq_icms', ana.aliq_icms,
        'vl_opr', ana.vl_opr, 'vl_bc_icms', ana.vl_bc_icms, 'vl_icms', ana.vl_icms
    ) ORDER BY ana.cfop) 
                   FROM documentos_c190 AS ana 
                   WHERE ana.id_documento_c100 = doc.id), '[]'::json) AS analytical
            FROM documentos_c100 AS doc
            LEFT JOIN sped_participantes AS part ON doc.cod_part = part.cod_part AND doc.id_sped_arquivo = part.id_sped_arquivo
            WHERE doc.id_sped_arquivo = $1 AND doc.ind_oper = '1'
            ORDER BY doc.dt_e_s, doc.num_doc;
`;
        const { rows } = await dbClient.query(query, [arquivoId]);
        logger.info(`Encontrados ${rows.length} documentos de SAÍDA para o arquivo ID: ${arquivoId} `);
        res.status(200).json(rows);
    } catch (error) {
        logger.error('--- ERRO AO BUSCAR DOCUMENTOS DE SAÍDA ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao buscar documentos.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA DE CONSULTA ANALITICA DE NF (C100 + C170 + C190) ---
app.get('/api/documentos/auditoria/nf/:id_arquivo', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) {
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    // Suportar busca/filtro e paginação opcional futuramente
    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;

    const dbClient = await pool.connect();
    try {
        // Buscamos o C100 com o Participante acoplado
        // E usamos subqueries (ou json_agg) para injetar o C190 e o C170 dentro de cada C100
        const query = `
            SELECT 
                doc.id, 
                doc.num_doc, 
                doc.ind_oper, 
                doc.dt_doc, 
                doc.dt_e_s, 
                doc.vl_doc::float8 AS vl_doc,
                part.nome as nome_fornecedor,
                part.cnpj as cnpj_fornecedor,
                
                -- Agrupando o Registro Analítico C190 (com FK correta)
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'cst_icms', r190.cst_icms,
                            'cfop', r190.cfop,
                            'aliq_icms', r190.aliq_icms::float8,
                            'vl_opr', r190.vl_opr::float8,
                            'vl_bc_icms', r190.vl_bc_icms::float8,
                            'vl_icms', r190.vl_icms::float8
                        )
                    )
                    FROM documentos_c190 AS r190
                    WHERE r190.id_documento_c100 = doc.id),
                '[]'::json) AS consolidacao_c190,

                -- Agrupando os Itens da Nota C170 (com FK correta e sped_produtos)
                COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'num_item', item.num_item,
                            'cod_item', item.cod_item,
                            'descr_item', COALESCE(p.descr_item, item.cod_item),
                            'qtd', item.qtd::float8,
                            'unid', item.unid,
                            'vl_item', item.vl_item::float8,
                            'cfop', item.cfop,
                            'cst_icms', item.cst_icms
                        ) ORDER BY item.num_item
                    ) 
                    FROM documentos_itens_c170 AS item
                    LEFT JOIN sped_produtos AS p 
                        ON item.cod_item = p.cod_item 
                        AND p.id_sped_arquivo = doc.id_sped_arquivo
                    WHERE item.id_documento_c100 = doc.id),
                '[]'::json) AS itens_c170

            FROM documentos_c100 AS doc
            LEFT JOIN sped_participantes AS part 
                ON doc.cod_part = part.cod_part 
                AND doc.id_sped_arquivo = part.id_sped_arquivo
            WHERE doc.id_sped_arquivo = $1 AND doc.ind_oper = '0'
            ORDER BY doc.dt_e_s DESC, doc.num_doc DESC
            LIMIT $2 OFFSET $3;
        `;

        const { rows } = await dbClient.query(query, [arquivoId, limit, offset]);
        res.status(200).json(rows);
    } catch (error) {
        logger.error('Erro na consulta analítica de NFs (C100/170/190):', error);
        res.status(500).json({ message: "Erro ao buscar NFs detalhadas.", error: error.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE CONSULTA DE NF DE SAIDA (MODELO 55 e 65) ---
app.get('/api/documentos/auditoria/saidas/:id_arquivo', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    const modelo = req.query.modelo || '55';
    if (isNaN(arquivoId)) return res.status(400).send({ message: "ID de arquivo inválido." });

    const dbClient = await pool.connect();
    try {
        if (modelo === '65') {
            // MODELO 65 (NFC-e): Agrupado por CFOP + lista de NFs dentro de cada grupo
            const query = `
                SELECT
                    r190.cfop,
                    r190.cst_icms,
                    COUNT(DISTINCT doc.id)::int   AS total_notas,
                    SUM(COALESCE(r190.vl_opr_ajustado, r190.vl_opr))::float8      AS total_vl_opr,
                    SUM(COALESCE(r190.vl_bc_icms_ajustado, r190.vl_bc_icms))::float8  AS total_vl_bc_icms,
                    SUM(COALESCE(r190.vl_icms_ajustado, r190.vl_icms))::float8     AS total_vl_icms,
                    json_agg(
                        json_build_object(
                            'id',           doc.id,
                            'id_c190',      r190.id,
                            'num_doc',      doc.num_doc,
                            'dt_doc',       doc.dt_doc,
                            'vl_doc',       COALESCE(doc.vl_doc_ajustado, doc.vl_doc)::float8,
                            'vl_doc_original', doc.vl_doc::float8,
                            'vl_doc_ajustado', doc.vl_doc_ajustado::float8,
                            'vl_opr',       COALESCE(r190.vl_opr_ajustado, r190.vl_opr)::float8,
                            'vl_opr_ajustado', r190.vl_opr_ajustado::float8,
                            'vl_bc_icms',   COALESCE(r190.vl_bc_icms_ajustado, r190.vl_bc_icms)::float8,
                            'vl_bc_icms_ajustado', r190.vl_bc_icms_ajustado::float8,
                            'vl_icms',      COALESCE(r190.vl_icms_ajustado, r190.vl_icms)::float8,
                            'vl_icms_ajustado', r190.vl_icms_ajustado::float8,
                            'nome_cliente', COALESCE(part.nome, 'Consumidor Final'),
                            'cnpj_cliente', part.cnpj
                        ) ORDER BY doc.dt_doc DESC
                    ) AS notas
                FROM documentos_c100 AS doc
                JOIN documentos_c190 AS r190 ON r190.id_documento_c100 = doc.id
                LEFT JOIN sped_participantes AS part
                    ON doc.cod_part = part.cod_part AND doc.id_sped_arquivo = part.id_sped_arquivo
                WHERE doc.id_sped_arquivo = $1
                    AND doc.ind_oper = '1'
                    AND (doc.cod_mod = '65' OR r190.cfop = '5929') -- CFOP 5929 (Mod 55) entra aqui por ser consolidado de cupom
                GROUP BY r190.cfop, r190.cst_icms
                ORDER BY total_vl_opr DESC;
            `;
            const { rows } = await dbClient.query(query, [arquivoId]);
            return res.status(200).json(rows);
        } else {
            // MODELO 55 (NF-e de Saída): retorna nota por nota com C190 e C170
            const limit = parseInt(req.query.limit) || 1000;
            const offset = parseInt(req.query.offset) || 0;
            const query = `
                SELECT
                    doc.id, doc.num_doc, doc.dt_doc, doc.dt_e_s,
                    COALESCE(doc.vl_doc_ajustado, doc.vl_doc)::float8 AS vl_doc,
                    doc.vl_doc::float8 AS vl_doc_original,
                    doc.vl_doc_ajustado::float8 AS vl_doc_ajustado,
                    COALESCE(part.nome, 'Não Identificado') AS nome_cliente,
                    part.cnpj AS cnpj_cliente,
                    COALESCE(
                        (SELECT json_agg(json_build_object(
                            'id',         r190.id,
                            'cst_icms',   r190.cst_icms, 'cfop', r190.cfop,
                            'aliq_icms',  r190.aliq_icms::float8,
                            'vl_opr',     COALESCE(r190.vl_opr_ajustado, r190.vl_opr)::float8,
                            'vl_opr_ajustado', r190.vl_opr_ajustado::float8,
                            'vl_bc_icms', COALESCE(r190.vl_bc_icms_ajustado, r190.vl_bc_icms)::float8,
                            'vl_bc_icms_ajustado', r190.vl_bc_icms_ajustado::float8,
                            'vl_icms',    COALESCE(r190.vl_icms_ajustado, r190.vl_icms)::float8,
                            'vl_icms_ajustado', r190.vl_icms_ajustado::float8
                        )) FROM documentos_c190 r190 WHERE r190.id_documento_c100 = doc.id),
                    '[]'::json) AS consolidacao_c190,
                    COALESCE(
                        (SELECT json_agg(json_build_object(
                            'num_item', item.num_item, 'cod_item', item.cod_item,
                            'descr_item', COALESCE(p.descr_item, item.cod_item),
                            'qtd', item.qtd::float8, 'unid', item.unid,
                            'vl_item', item.vl_item::float8,
                            'cfop', item.cfop, 'cst_icms', item.cst_icms
                        ) ORDER BY item.num_item)
                        FROM documentos_itens_c170 item
                        LEFT JOIN sped_produtos p ON item.cod_item = p.cod_item AND p.id_sped_arquivo = doc.id_sped_arquivo
                        WHERE item.id_documento_c100 = doc.id),
                    '[]'::json) AS itens_c170
                FROM documentos_c100 AS doc
                LEFT JOIN sped_participantes AS part
                    ON doc.cod_part = part.cod_part AND doc.id_sped_arquivo = part.id_sped_arquivo
                WHERE doc.id_sped_arquivo = $1 AND doc.ind_oper = '1' AND doc.cod_mod = '55'
                ORDER BY doc.dt_doc DESC, doc.num_doc DESC
                LIMIT $2 OFFSET $3;
            `;
            const { rows } = await dbClient.query(query, [arquivoId, limit, offset]);
            return res.status(200).json(rows);
        }
    } catch (error) {
        logger.error('Erro na consulta de NFs de Saída:', error);
        res.status(500).json({ message: "Erro ao buscar NFs de Saída.", error: error.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTA PARA LISTAR EMPRESAS (PRESENTE) ---
app.get('/api/empresas', authMiddleware, async (req, res) => {
    logger.info('Recebida requisição para listar empresas.');
    const dbClient = await pool.connect();
    try {
        const query = `SELECT id, cnpj, nome_empresa, uf FROM empresas ORDER BY nome_empresa; `;
        const { rows } = await dbClient.query(query);
        logger.info(`Encontradas ${rows.length} empresas.`);
        res.status(200).json(rows);
    } catch (error) {
        logger.error('--- ERRO AO BUSCAR EMPRESAS ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao buscar empresas no banco de dados.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA PARA LISTAR ARQUIVOS POR EMPRESA (PRESENTE) ---
app.get('/api/arquivos/empresa/:id_empresa', authMiddleware, async (req, res) => {
    const idEmpresa = parseInt(req.params.id_empresa);
    if (isNaN(idEmpresa)) {
        logger.warn(`Tentativa de buscar arquivos com ID de empresa inválido: ${req.params.id_empresa} `);
        return res.status(400).send({ message: "ID de empresa inválido." });
    }

    logger.info(`Buscando arquivos para a empresa ID: ${idEmpresa} `);
    const dbClient = await pool.connect();
    try {
        const query = `
            SELECT id, nome_arquivo, periodo_apuracao, data_upload 
            FROM sped_arquivos 
            WHERE id_empresa = $1 
            ORDER BY data_upload DESC;
`;
        const { rows } = await dbClient.query(query, [idEmpresa]);
        logger.info(`Encontrados ${rows.length} arquivos para a empresa ID: ${idEmpresa} `);
        res.status(200).json(rows);
    } catch (error) {
        logger.error('--- ERRO AO BUSCAR ARQUIVOS POR EMPRESA ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao buscar arquivos no banco de dados.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA DE RESUMO (PRESENTE) ---
app.get('/api/resumo/:id_arquivo', async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de buscar resumo com ID inválido: ${req.params.id_arquivo} `);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    logger.info(`Buscando resumo gerencial para o arquivo ID: ${arquivoId} `);
    const dbClient = await pool.connect();
    try {
        const entradasQuery = `
            SELECT 
                c190.cfop,
                SUM(c190.vl_opr)::float8 as total_operacao,
                SUM(c190.vl_bc_icms)::float8 as total_base_icms,
                SUM(c190.vl_icms)::float8 as total_icms
            FROM documentos_c190 c190
            JOIN documentos_c100 c100 ON c190.id_documento_c100 = c100.id
            WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '0'
            GROUP BY c190.cfop
            ORDER BY c190.cfop;
        `;
        const saidasQuery = `
            SELECT 
                c190.cfop,
                SUM(c190.vl_opr)::float8 as total_operacao,
                SUM(c190.vl_bc_icms)::float8 as total_base_icms,
                SUM(c190.vl_icms)::float8 as total_icms
            FROM documentos_c190 c190
            JOIN documentos_c100 c100 ON c190.id_documento_c100 = c100.id
            WHERE c100.id_sped_arquivo = $1 
              AND c100.ind_oper = '1'
            GROUP BY c190.cfop
            ORDER BY total_operacao DESC;
        `;

        const combustivelQuery = `
            SELECT 
                tipo,
                SUM(total_litros) as total_litros,
                SUM(total_valor) as total_valor
            FROM (
                SELECT 
                    CASE 
                        WHEN p.descr_item ILIKE '%GASOLINA%' THEN 'GASOLINA'
                        WHEN p.descr_item ILIKE '%ETANOL%' OR p.descr_item ILIKE '%ALCOOL%' THEN 'ETANOL'
                        WHEN p.descr_item ILIKE '%DIESEL%' THEN 'DIESEL'
                        ELSE 'OUTROS'
                    END as tipo,
                    it.qtd::float8 as total_litros,
                    it.vl_item::float8 as total_valor
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                JOIN sped_produtos p ON c100.id_sped_arquivo = p.id_sped_arquivo AND it.cod_item = p.cod_item
                WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '0'
            ) sub
            WHERE tipo <> 'OUTROS'
            GROUP BY tipo;
        `;

        // Busca totais globais (independente de filtro de modelo para o card do topo)
        const totalsQuery = `
            SELECT 
                COALESCE(SUM(CASE WHEN ind_oper = '0' THEN vl_doc ELSE 0 END), 0)::float8 as total_entradas,
                COALESCE(SUM(CASE WHEN ind_oper = '1' THEN vl_doc ELSE 0 END), 0)::float8 as total_saidas
            FROM documentos_c100 
            WHERE id_sped_arquivo = $1 AND cod_sit <> '02';
        `;

        // Busca Resumo de Estoque (LMC)
        const estoqueResumoQuery = `
            WITH product_bounds AS (
                SELECT 
                    cod_item,
                    MIN(data_mov) as first_date,
                    MAX(data_mov) as last_date
                FROM lmc_movimentacao
                WHERE id_sped_arquivo = $1
                GROUP BY cod_item
            ),
            initial_stock AS (
                SELECT l.cod_item, SUM(l.estq_abert) as estq_abert
                FROM lmc_movimentacao l
                JOIN product_bounds pb ON l.cod_item = pb.cod_item AND l.data_mov = pb.first_date
                WHERE l.id_sped_arquivo = $1
                GROUP BY l.cod_item
            ),
            final_stock AS (
                SELECT l.cod_item, SUM(COALESCE(l.fech_fisico_ajustado, l.fech_fisico)) as fech_fisico
                FROM lmc_movimentacao l
                JOIN product_bounds pb ON l.cod_item = pb.cod_item AND l.data_mov = pb.last_date
                WHERE l.id_sped_arquivo = $1
                GROUP BY l.cod_item
            ),
            sums AS (
                SELECT 
                    cod_item,
                    SUM(COALESCE(vol_entr_ajustado, vol_entr)) as total_entradas,
                    SUM(COALESCE(vol_saidas_ajustado, vol_saidas)) as total_saidas
                FROM lmc_movimentacao
                WHERE id_sped_arquivo = $1
                GROUP BY cod_item
            )
            SELECT 
                s.cod_item,
                COALESCE(p.descr_item, s.cod_item) as nome_combustivel,
                COALESCE(i.estq_abert, 0)::float8 as estoque_inicial,
                COALESCE(s.total_entradas, 0)::float8 as entradas,
                COALESCE(s.total_saidas, 0)::float8 as saidas,
                COALESCE(f.fech_fisico, 0)::float8 as estoque_final
            FROM sums s
            LEFT JOIN initial_stock i ON s.cod_item = i.cod_item
            LEFT JOIN final_stock f ON s.cod_item = f.cod_item
            LEFT JOIN sped_produtos p ON p.id_sped_arquivo = $1 AND p.cod_item = s.cod_item;
        `;

        const [resEntradas, resSaidas, resComb, resTotals, resEstq] = await Promise.all([
            dbClient.query(entradasQuery, [arquivoId]),
            dbClient.query(saidasQuery, [arquivoId]),
            dbClient.query(combustivelQuery, [arquivoId]),
            dbClient.query(totalsQuery, [arquivoId]),
            dbClient.query(estoqueResumoQuery, [arquivoId])
        ]);

        const totals = resTotals.rows[0] || { total_entradas: 0, total_saidas: 0 };

        // Processar estoque e variações
        const estoqueResumo = resEstq.rows.map(row => {
            const esperado = row.estoque_inicial + row.entradas - row.saidas;
            const variacao = row.estoque_final - esperado;
            const variacao_perc = row.estoque_inicial + row.entradas > 0
                ? (Math.abs(variacao) / (row.estoque_inicial + row.entradas)) * 100
                : 0;

            return {
                ...row,
                esperado,
                variacao,
                variacao_perc,
                status: variacao_perc > 0.6 ? 'CRITICAL' : (variacao_perc > 0.4 ? 'WARNING' : 'OK')
            };
        });

        // Processar resumo de combustíveis
        const resumoCombustiveis = resComb.rows.map(c => ({
            ...c,
            custo_medio: c.total_litros > 0 ? (c.total_valor / c.total_litros) : 0
        }));

        res.status(200).json({
            total_entradas: totals.total_entradas || 0,
            total_saidas: totals.total_saidas || 0,
            entradasPorCFOP: resEntradas.rows,
            saidasPorCFOP: resSaidas.rows,
            resumoCombustiveis: resumoCombustiveis,
            estoqueResumo: estoqueResumo
        });

    } catch (error) {
        logger.error('--- ERRO AO BUSCAR RESUMO GERENCIAL ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao buscar resumo no banco de dados.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA DE RESUMO DE ESTOQUE (NOVA - PARA CORREÇÃO DO 404) ---
app.get('/api/estoque-resumo/:id_arquivo', async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) {
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    const dbClient = await pool.connect();
    try {
        const query = `
SELECT
lmc.cod_item as cod_item,
    p.descr_item as produto,
    lmc.fech_fisico as estoque_final,
    lmc.data_mov,
    EXISTS(
        SELECT 1 FROM erros_analise e 
                    WHERE e.id_sped_arquivo = $1 
                    AND e.cod_item_erro = lmc.cod_item
                    AND e.data_erro = lmc.data_mov
    ) as tem_anomalia
            FROM lmc_movimentacao lmc
            LEFT JOIN sped_produtos p ON lmc.id_sped_arquivo = p.id_sped_arquivo AND lmc.cod_item = p.cod_item
            WHERE lmc.id_sped_arquivo = $1
              AND lmc.data_mov = (SELECT MAX(data_mov) FROM lmc_movimentacao WHERE id_sped_arquivo = $1)
            ORDER BY p.descr_item;
`;
        const { rows } = await dbClient.query(query, [arquivoId]);
        res.status(200).json(rows);
    } catch (error) {
        logger.error('--- ERRO AO BUSCAR RESUMO DE ESTOQUE ---', { message: error.message });
        res.status(500).json({ message: "Erro ao buscar resumo de estoque.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});


// --- CONFIGURAÇÃO DE CAPACIDADE DE TANQUES (LMC) ---

// Buscar configurações de tanques para um CNPJ
app.get('/api/lmc/tanques-config/:cnpj', authMiddleware, async (req, res) => {
    const cnpj = req.params.cnpj;
    const dbClient = await pool.connect();
    try {
        const result = await dbClient.query(
            'SELECT cod_item, capacidade FROM lmc_tanques_config WHERE cnpj = $1',
            [cnpj]
        );
        res.json(result.rows);
    } catch (error) {
        logger.error('Erro ao buscar configurações de tanques:', error);
        res.status(500).json({ message: "Erro ao buscar configurações de tanques." });
    } finally {
        dbClient.release();
    }
});

// Salvar/Atualizar configurações de tanques
app.post('/api/lmc/tanques-config', authMiddleware, async (req, res) => {
    const { cnpj, configs } = req.body; // configs: [{ cod_item: '...', capacidade: 123 }, ...]
    if (!cnpj || !Array.isArray(configs)) {
        return res.status(400).json({ message: "Dados inválidos." });
    }

    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');
        for (const item of configs) {
            await dbClient.query(
                `INSERT INTO lmc_tanques_config (cnpj, cod_item, capacidade)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (cnpj, cod_item) 
                 DO UPDATE SET capacidade = EXCLUDED.capacidade`,
                [cnpj, item.cod_item, item.capacidade]
            );
        }
        await dbClient.query('COMMIT');
        res.json({ message: "Configurações salvas com sucesso." });
    } catch (error) {
        await dbClient.query('ROLLBACK');
        logger.error('Erro ao salvar configurações de tanques:', error);
        res.status(500).json({ message: "Erro ao salvar configurações de tanques." });
    } finally {
        dbClient.release();
    }
});


// --- ROTA DE RESUMO POR PARTICIPANTE (PRESENTE) ---
app.get('/api/resumo/participante/:id_arquivo', async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de buscar resumo de participante com ID inválido: ${req.params.id_arquivo} `);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    logger.info(`Buscando resumo por participante para o arquivo ID: ${arquivoId} `);
    const dbClient = await pool.connect();
    try {
        // Query para Entradas (ind_oper = '0')
        const entradasQuery = `
SELECT
doc.cod_part,
    part.nome as nome_fornecedor,
    SUM(doc.vl_doc) as total_comprado
            FROM documentos_c100 doc
            LEFT JOIN sped_participantes part ON doc.cod_part = part.cod_part AND doc.id_sped_arquivo = part.id_sped_arquivo
            WHERE doc.id_sped_arquivo = $1 AND doc.ind_oper = '0'
            GROUP BY doc.cod_part, part.nome
            ORDER BY total_comprado DESC;
`;

        // Query para Saídas (ind_oper = '1')
        const saidasQuery = `
SELECT
doc.cod_part,
    part.nome as nome_cliente,
    SUM(doc.vl_doc) as total_vendido
            FROM documentos_c100 doc
            LEFT JOIN sped_participantes part ON doc.cod_part = part.cod_part AND doc.id_sped_arquivo = part.id_sped_arquivo
            WHERE doc.id_sped_arquivo = $1 AND doc.ind_oper = '1'
            GROUP BY doc.cod_part, part.nome
            ORDER BY total_vendido DESC;
`;

        const [resEntradas, resSaidas] = await Promise.all([
            dbClient.query(entradasQuery, [arquivoId]),
            dbClient.query(saidasQuery, [arquivoId])
        ]);

        res.status(200).json({
            comprasPorFornecedor: resEntradas.rows,
            vendasPorCliente: resSaidas.rows
        });

    } catch (error) {
        logger.error('--- ERRO AO BUSCAR RESUMO POR PARTICIPANTE ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao buscar resumo no banco de dados.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA DE GERAÇÃO DE DOSSIÊ PDF (NOVA) ---
app.get('/api/relatorio/dossie/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if (isNaN(arquivoId)) return res.status(400).send({ message: "ID inválido." });

    const dbClient = await pool.connect();
    try {
        // 1. Buscar dados do arquivo e empresa
        const arqRes = await dbClient.query(`
            SELECT a.nome_arquivo, a.periodo_apuracao, e.nome_empresa, e.cnpj 
            FROM sped_arquivos a 
            JOIN empresas e ON a.id_empresa = e.id 
            WHERE a.id = $1`, [arquivoId]);

        if (arqRes.rows.length === 0) return res.status(404).send({ message: "Arquivo não encontrado." });
        const { nome_empresa, cnpj, periodo_apuracao, nome_arquivo } = arqRes.rows[0];

        // 2. Buscar erros críticos
        const errosRes = await dbClient.query('SELECT * FROM erros_analise WHERE id_sped_arquivo = $1 ORDER BY tipo_erro, data_erro', [arquivoId]);
        const erros = errosRes.rows;

        // 3. Gerar PDF
        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Dossie_Audisped_${arquivoId}.pdf`);
        doc.pipe(res);

        // --- CABEÇALHO ---
        doc.fillColor('#0ea5e9').fontSize(26).text('AUDISPED 2.0', { align: 'center' });
        doc.fillColor('#64748b').fontSize(10).text('RELATÓRIO TÉCNICO DE CONFORMIDADE FISCAL', { align: 'center' });
        doc.moveDown(2);

        // --- INFO EMPRESA ---
        doc.fillColor('#1e293b').fontSize(14).text('DADOS DA AUDITORIA', { underline: true });
        doc.fontSize(10).moveDown(0.5);
        doc.text(`Empresa: ${nome_empresa}`);
        doc.text(`CNPJ: ${cnpj}`);
        doc.text(`Período: ${periodo_apuracao}`);
        doc.text(`Arquivo Original: ${nome_arquivo}`);
        doc.moveDown(2);

        // --- RESUMO EXECUTIVO ---
        const criticos = erros.filter(e => e.tipo_erro === 'CRITICAL').length;
        const avisos = erros.filter(e => e.tipo_erro === 'WARNING').length;

        doc.rect(50, doc.y, 500, 80).fill('#f8fafc').stroke('#e2e8f0');
        doc.fillColor('#1e293b').fontSize(12).text('RESUMO DE RISCOS', 60, doc.y + 15);
        doc.fontSize(10).text(`Total de Inconsistências Críticas: ${criticos}`, 60, doc.y + 15);
        doc.text(`Avisos de Atenção: ${avisos}`, 60, doc.y + 10);
        doc.moveDown(3);

        // --- DETALHAMENTO DE ERROS ---
        doc.fillColor('#1e293b').fontSize(14).text('DETALHAMENTO DE INCONSISTÊNCIAS', { underline: true });
        doc.moveDown();

        if (erros.length === 0) {
            doc.fillColor('#22c55e').fontSize(10).text('Nenhuma inconsistência detectada. O arquivo está em conformidade com as regras analisadas.');
        } else {
            erros.forEach((err, index) => {
                // Checar se precisa de nova página
                if (doc.y > 650) doc.addPage();

                doc.fillColor(err.tipo_erro === 'CRITICAL' ? '#ef4444' : '#f59e0b')
                    .fontSize(11).text(`${index + 1}. [${err.tipo_erro}] ${err.titulo_erro}`);

                doc.fillColor('#334155').fontSize(9).text(`Descrição: ${err.descricao_erro.replace(/\*\*/g, '')}`, { indent: 15 });
                doc.fillColor('#64748b').text(`Sugestão: ${err.sugestao_correcao}`, { indent: 15 });
                doc.moveDown(0.8);
            });
        }

        // --- RODAPÉ ---
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            doc.fontSize(8).fillColor('#94a3b8').text(
                'Este relatório é um documento técnico gerado automaticamente pelo sistema AudiSped. Valide as informações antes de retificar o SPED.',
                50, 750, { align: 'center', width: 500 }
            );
        }

        doc.end();
        logger.info(`PDF gerado com sucesso para arquivo ID: ${arquivoId}`);

    } catch (error) {
        logger.error('Erro ao gerar PDF:', error);
        if (!res.headersSent) res.status(500).send({ message: "Erro ao gerar PDF." });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- ROTA DE EXPORTAÇÃO EXCEL (FASE 5) ---
app.get('/api/relatorio/excel/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    const dbClient = await pool.connect();
    try {
        const query = `
            SELECT e.*, a.nome_arquivo, emp.nome_empresa, emp.cnpj
            FROM erros_analise e
            JOIN sped_arquivos a ON e.id_sped_arquivo = a.id
            JOIN empresas emp ON a.id_empresa = emp.id
            WHERE e.id_sped_arquivo = $1
            ORDER BY e.tipo_erro, e.id;
        `;
        const { rows } = await dbClient.query(query, [arquivoId]);
        if (rows.length === 0) return res.status(404).send("Nenhum erro encontrado.");

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Auditoria Audisped');

        // Cabeçalho
        sheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Tipo', key: 'tipo_erro', width: 15 },
            { header: 'Regra', key: 'regra_id', width: 15 },
            { header: 'Título', key: 'titulo_erro', width: 40 },
            { header: 'Descrição', key: 'descricao_erro', width: 60 },
            { header: 'Sugestão', key: 'sugestao_correcao', width: 60 },
            { header: 'Código Item', key: 'cod_item_erro', width: 15 },
            { header: 'Data', key: 'data_erro', width: 15 }
        ];

        // Estilização do cabeçalho
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

        rows.forEach(row => {
            sheet.addRow({
                id: row.id,
                tipo_erro: row.tipo_erro,
                regra_id: row.regra_id,
                titulo_erro: row.titulo_erro,
                descricao_erro: row.descricao_erro.replace(/\*\*/g, ''), // Limpa negrito markdown
                sugestao_correcao: row.sugestao_correcao,
                cod_item_erro: row.cod_item_erro,
                data_erro: row.data_erro ? new Date(row.data_erro).toLocaleDateString('pt-BR') : ''
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Auditoria_${arquivoId}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        logger.error('Erro ao gerar Excel:', error);
        res.status(500).send("Erro interno ao gerar planilha.");
    } finally {
        dbClient.release();
    }
});


// --- ROTA PARA CORREÇÃO DE ITEM (MÁQUINA DE CURA) ---
app.post('/api/corrigir-item', authMiddleware, async (req, res) => {
    const { tipo, id_item, novos_valores } = req.body;
    // novos_valores: { cst_icms: '060', cfop: '5656' } etc.

    if (!tipo || !id_item || !novos_valores) return res.status(400).send({ message: "Dados incompletos." });

    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');

        if (tipo === 'C170') {
            const fields = Object.keys(novos_valores).map((key, i) => `${key} = $${i + 2}`).join(', ');
            const values = Object.values(novos_valores);
            await dbClient.query(`UPDATE documentos_itens_c170 SET ${fields} WHERE id = $1`, [id_item, ...values]);
        } else if (tipo === 'C100') {
            const fields = Object.keys(novos_valores).map((key, i) => `${key} = $${i + 2}`).join(', ');
            const values = Object.values(novos_valores);
            await dbClient.query(`UPDATE documentos_c100 SET ${fields} WHERE id = $1`, [id_item, ...values]);
        } else if (tipo === 'C190') {
            const fields = Object.keys(novos_valores).map((key, i) => `${key} = $${i + 2}`).join(', ');
            const values = Object.values(novos_valores);
            await dbClient.query(`UPDATE documentos_c190 SET ${fields} WHERE id = $1`, [id_item, ...values]);
        } else if (tipo === 'LMC') {
            const fields = Object.keys(novos_valores).map((key, i) => `${key} = $${i + 2}`).join(', ');
            const values = Object.values(novos_valores);
            await dbClient.query(`UPDATE lmc_movimentacao SET ${fields} WHERE id = $1`, [id_item, ...values]);
        }

        await dbClient.query('COMMIT');
        logger.info(`Item ${id_item} (${tipo}) corrigido com sucesso.`);
        res.status(200).send({ message: "Correção aplicada com sucesso." });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        logger.error('Erro ao corrigir item:', error);
        res.status(500).send({ message: "Erro ao aplicar correção.", error: error.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE CORREÇÃO EM MASSA (FASE 5) ---
app.post('/api/corrigir-massa', authMiddleware, async (req, res) => {
    const { id_arquivo, regra_id, novos_valores } = req.body;
    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');
        logger.info(`Iniciando correção em massa para regra ${regra_id} no arquivo ${id_arquivo}`);

        if (regra_id === 'RTAX-C170-01') {
            const errorItemsQuery = `
                SELECT DISTINCT cod_item_erro 
                FROM erros_analise 
                WHERE id_sped_arquivo = $1 AND regra_id = $2 AND cod_item_erro IS NOT NULL
            `;
            const { rows } = await dbClient.query(errorItemsQuery, [id_arquivo, regra_id]);
            const codigosItens = rows.map(r => r.cod_item_erro);

            if (codigosItens.length > 0) {
                const updateQuery = `
                    UPDATE documentos_itens_c170 
                    SET cst_icms = $1 
                    WHERE cod_item = ANY($2)
                      AND id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $3)
                `;
                await dbClient.query(updateQuery, [novos_valores.cst_icms, codigosItens, id_arquivo]);
            }
        }

        await dbClient.query('COMMIT');
        res.status(200).send({ message: "Correção em massa aplicada com sucesso." });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        logger.error('Erro na correção em massa:', error);
        res.status(500).json({ message: "Erro ao aplicar correção em massa.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- FIM DOS AJUSTES LMC ---


// --- SALVAR AJUSTE NO LMC ---
app.post('/api/lmc/ajustar', authMiddleware, async (req, res) => {
    const { id_sped, cod_item, data_mov, vol_saidas_ajustado } = req.body;

    if (!id_sped || !cod_item || !data_mov) {
        return res.status(400).send({ message: "Dados insuficientes para atualização." });
    }

    const dbClient = await pool.connect();
    try {
        const query = `
            UPDATE lmc_movimentacao 
            SET vol_saidas_ajustado = $1, fech_fisico_ajustado = $2
            WHERE id_sped_arquivo = $3 AND cod_item = $4 AND data_mov = $5
        `;
        await dbClient.query(query, [
            vol_saidas_ajustado === null ? null : parseFloat(vol_saidas_ajustado),
            req.body.fech_fisico_ajustado === undefined ? null : parseFloat(req.body.fech_fisico_ajustado),
            parseInt(id_sped),
            cod_item,
            data_mov
        ]);
        res.status(200).send({ message: "Ajuste salvo com sucesso!" });
    } catch (error) {
        logger.error('Erro ao ajustar LMC:', error);
        res.status(500).send("Erro ao salvar o ajuste.");
    } finally {
        dbClient.release();
    }
});

// --- ROTA BULK RATEIO LMC ---
app.post('/api/lmc/ajustar-lote', authMiddleware, async (req, res) => {
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates)) {
        return res.status(400).send({ message: "Payload inválido para lote." });
    }

    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');

        for (const row of updates) {
            const query = `
                UPDATE lmc_movimentacao 
                SET vol_saidas_ajustado = $1, fech_fisico_ajustado = $2
                WHERE id_sped_arquivo = $3 AND cod_item = $4 AND data_mov = $5
            `;
            await dbClient.query(query, [
                row.vol_saidas_ajustado === null ? null : parseFloat(row.vol_saidas_ajustado),
                row.fech_fisico_ajustado === null ? null : parseFloat(row.fech_fisico_ajustado),
                parseInt(row.id_sped),
                row.cod_item,
                row.data_mov
            ]);
        }

        await dbClient.query('COMMIT');
        res.status(200).send({ message: "Ajustes em lote salvos com sucesso!" });
    } catch (error) {
        await dbClient.query('ROLLBACK');
        logger.error('Erro ao ajustar LMC em lote:', error);
        res.status(500).send("Erro ao salvar os ajustes.");
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE EXPORTAÇÃO RETIFICADA (FASE 10) ---
app.get('/api/exportar-sped/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    const dbClient = await pool.connect();

    try {
        // 1. Buscar info do arquivo e ajustes
        const arqInfo = await dbClient.query('SELECT * FROM sped_arquivos WHERE id = $1', [arquivoId]);
        if (arqInfo.rows.length === 0) return res.status(404).send('Arquivo não encontrado.');

        const pathOrig = arqInfo.rows[0].caminho_arquivo;
        if (!pathOrig || !fs.existsSync(pathOrig)) {
            return res.status(400).send('O arquivo físico original não foi localizado no servidor para retificação (Upload antigo).');
        }

        const ajustes = await dbClient.query(`
            SELECT data_mov, cod_item, 
                   vol_saidas_ajustado, fech_fisico_ajustado,
                   val_perda_ajustado, val_ganho_ajustado,
                   estq_abert_ajustado, vol_escr_ajustado,
                   vol_entr_ajustado
            FROM lmc_movimentacao 
            WHERE id_sped_arquivo = $1 
              AND (vol_saidas_ajustado IS NOT NULL OR fech_fisico_ajustado IS NOT NULL OR estq_abert_ajustado IS NOT NULL OR vol_entr_ajustado IS NOT NULL)
        `, [arquivoId]);

        // Criar um mapa de consulta rápida [data_iso + cod_item]
        const mapAjustes = new Map();
        ajustes.rows.forEach(r => {
            const d = new Date(r.data_mov);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            const key = `${y}-${m}-${day}_${r.cod_item}`;
            mapAjustes.set(key, r);
        });

        // 1.2 Buscar configs de capacidades e ajustes C100/C190 para este arquivo
        const configs = await dbClient.query('SELECT cod_item, capacidade FROM lmc_tanques_config WHERE cnpj = $1', [arqInfo.rows[0].cnpj_empresa]);
        const mapCapacidades = new Map(configs.rows.map(r => [r.cod_item, parseFloat(r.capacidade)]));

        const ajustesC100 = await dbClient.query('SELECT num_doc, vl_doc_ajustado, chv_nfe FROM documentos_c100 WHERE id_sped_arquivo = $1 AND vl_doc_ajustado IS NOT NULL', [arquivoId]);
        const mapC100 = new Map(ajustesC100.rows.map(r => [r.num_doc + '_' + (r.chv_nfe || ''), r.vl_doc_ajustado]));

        const ajustesC190 = await dbClient.query(`
            SELECT r190.id, r190.cst_icms, r190.cfop, r190.aliq_icms, r190.vl_opr_ajustado, r190.vl_bc_icms_ajustado, r190.vl_icms_ajustado, doc.num_doc, doc.chv_nfe
            FROM documentos_c190 r190
            JOIN documentos_c100 doc ON r190.id_documento_c100 = doc.id
            WHERE doc.id_sped_arquivo = $1 AND (r190.vl_opr_ajustado IS NOT NULL OR r190.vl_bc_icms_ajustado IS NOT NULL OR r190.vl_icms_ajustado IS NOT NULL)
        `, [arquivoId]);
        const mapC190 = new Map(ajustesC190.rows.map(r => [`${r.num_doc}_${r.chv_nfe || ''}_${r.cst_icms}_${r.cfop}_${parseFloat(r.aliq_icms).toFixed(2)}`, r]));

        // 2. Processar o arquivo original e substituir pipes
        logger.info(`Iniciando exportação retificada: Arquivo ID ${arquivoId}, Path: ${pathOrig}`);
        const fileStream = fs.createReadStream(pathOrig, { encoding: 'latin1' }); // SPED é ISO-8859-1 (latin1)
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        const rawName = `${arqInfo.rows[0].cnpj_empresa}_${arqInfo.rows[0].periodo_apuracao}`;
        const safeName = rawName.replace(/[\s\/\\:*?"<>|]+/g, '_') + '.txt';
        res.setHeader('Content-disposition', `attachment; filename=${safeName}`);
        res.setHeader('Content-type', 'text/plain; charset=iso-8859-1');

        let linesProcessed = 0;
        let changesApplied = 0;
        let lastC100 = { numDoc: '', chvNfe: '' };

        let pending1300 = null;
        let pending1310s = [];
        let layoutVersion = '019'; // Default para 2025 e anteriores

        const flush1300Group = () => {
            if (!pending1300) return;
            // Escreve a linha 1300 ajustada
            res.write(pending1300.line + '\r\n');

            if (pending1310s.length === 0) {
                pending1300 = null;
                return;
            }

            const { orig, novo } = pending1300;
            let sumAbert = 0, sumSaida = 0, sumPerda = 0, sumGanho = 0, sumEntr = 0;

            for (let i = 0; i < pending1310s.length; i++) {
                let tk = pending1310s[i];
                let isLast = (i === pending1310s.length - 1);

                let tOrigAbert = parseFloat((tk[3] || '0').replace(',', '.'));
                let tOrigEntr = parseFloat((tk[4] || '0').replace(',', '.'));
                let tOrigSaida = parseFloat((tk[6] || '0').replace(',', '.'));

                // Proporções baseadas no movimento original por tanque
                let pAbert = orig.abert > 0 ? (tOrigAbert / orig.abert) : (1 / pending1310s.length);
                let pSaida = orig.saida > 0 ? (tOrigSaida / orig.saida) : (1 / pending1310s.length);
                let pEntr = orig.entr > 0 ? (tOrigEntr / orig.entr) : (1 / pending1310s.length);

                let nAbert, nSaida, nPerda, nGanho, nEntr;

                if (isLast) {
                    // O último tanque absorve a diferença de arredondamento (Soma Zero Total)
                    nAbert = Number((novo.abert - sumAbert).toFixed(3));
                    nSaida = Number((novo.saida - sumSaida).toFixed(3));
                    nPerda = Number((novo.perda - sumPerda).toFixed(3));
                    nGanho = Number((novo.ganho - sumGanho).toFixed(3));
                    nEntr = Number((novo.entr - sumEntr).toFixed(3));

                    // ESCUDO FINAL ANP NO EXPORT (Blindagem de Redirecionamento)
                    let baseTanque = nAbert + nEntr;
                    let maxDesvioPermitido = baseTanque * 0.0055;

                    if (nPerda > maxDesvioPermitido) nPerda = Number(maxDesvioPermitido.toFixed(3));
                    if (nGanho > maxDesvioPermitido) nGanho = Number(maxDesvioPermitido.toFixed(3));

                } else {
                    nAbert = Number((novo.abert * pAbert).toFixed(3));
                    nSaida = Number((novo.saida * pSaida).toFixed(3));
                    nEntr = Number((novo.entr * pEntr).toFixed(3));
                    nPerda = Number((novo.perda * pAbert).toFixed(3));
                    nGanho = Number((novo.ganho * pAbert).toFixed(3));

                    sumAbert = Number((sumAbert + nAbert).toFixed(3));
                    sumSaida = Number((sumSaida + nSaida).toFixed(3));
                    sumPerda = Number((sumPerda + nPerda).toFixed(3));
                    sumGanho = Number((sumGanho + nGanho).toFixed(3));
                    sumEntr = Number((sumEntr + nEntr).toFixed(3));
                }

                // Lógica de Identificação do Tanque + Capacidade para o Leiaute 020
                let tanqueCod = tk[2];
                let capTanque = 0;
                if (mapCapacidades && mapCapacidades.has(tanqueCod)) {
                    capTanque = mapCapacidades.get(tanqueCod);
                } else if (mapCapacidades && pending1300 && pending1300.orig && pending1300.orig.codItem) {
                    capTanque = mapCapacidades.get(pending1300.orig.codItem) || 0;
                }

                // Cálculo do disponível e final usando APENAS valores já arredondados (Efeito Calculadora)
                let nDisp = Number((nAbert + nEntr).toFixed(3));
                let nEscr = Number((nDisp - nSaida).toFixed(3));
                let nFisico = Number((nEscr - nPerda + nGanho).toFixed(3));

                if (nFisico < 0) nFisico = 0;

                // Formatação rigorosa dos campos de estoque (Efeito Calculadora)
                tk[3] = nAbert.toFixed(3).replace('.', ',');
                tk[4] = nEntr.toFixed(3).replace('.', ',');
                tk[5] = nDisp.toFixed(3).replace('.', ',');
                tk[6] = nSaida.toFixed(3).replace('.', ',');
                tk[7] = nEscr.toFixed(3).replace('.', ',');
                tk[8] = nPerda.toFixed(3).replace('.', ',');
                tk[9] = nGanho.toFixed(3).replace('.', ',');
                tk[10] = nFisico.toFixed(3).replace('.', ',');

                if (layoutVersion === '020') {
                    // Layout 020 (Ato COTEPE 79/2025): 11 campos de dados + 2 pipes vazios laterais (Length = 13)
                    tk[11] = capTanque > 0 ? Math.round(capTanque).toString() : '';
                    tk.length = 13;
                    tk[12] = '';
                } else {
                    // Layout 019 ou anterior: 10 campos de dados + 2 pipes vazios laterais (Length = 12)
                    tk.length = 12;
                    tk[11] = '';
                }

                res.write(tk.join('|') + '\r\n');
            }

            pending1300 = null;
            pending1310s = [];
        };

        for await (const line of rl) {
            linesProcessed++;
            const fields = line.split('|').map(v => v.replace(/\r$/, '')); // Sanear carriage return imediato

            // --- BLOCO 0000 (AUTOCORREÇÃO E DETECÇÃO DE LEIAUTE) ---
            if (fields.length >= 2 && fields[1] === '0000') {
                let current_version = fields[2];
                let date_start = fields[4]; // DDMMYYYY

                if (date_start && date_start.length === 8) {
                    let year = parseInt(date_start.substring(4, 8), 10);
                    if (year >= 2026 && current_version === '019') {
                        fields[2] = '020'; // Transmuta silenciosamente para salvar a importação no PVA
                        changesApplied++;
                    }
                }
                layoutVersion = fields[2]; // Define a regra para o restante do arquivo
                res.write(fields.join('|') + '\r\n');
                continue;
            }

            // --- BLOCO 1300 ---
            if (fields.length >= 2 && fields[1] === '1300') {
                flush1300Group(); // Descarrega agrupamento anterior 1300/1310 se houver

                const codItem = fields[2];
                const dtMovStr = fields[3];

                if (dtMovStr && dtMovStr.length === 8) {
                    const formattedDate = `${dtMovStr.substring(4, 8)}-${dtMovStr.substring(2, 4)}-${dtMovStr.substring(0, 2)}`;
                    const key = `${formattedDate}_${codItem}`;

                    // Lemos os valores antigos globais do 1300
                    const oldAbert = parseFloat((fields[4] || '0').replace(',', '.'));
                    const oldEntr = parseFloat((fields[5] || '0').replace(',', '.'));
                    const oldSaida = parseFloat((fields[7] || '0').replace(',', '.'));

                    if (mapAjustes.has(key)) {
                        const aj = mapAjustes.get(key);
                        changesApplied++;

                        let novoAbert = Number(oldAbert.toFixed(3));
                        if (aj.estq_abert_ajustado !== null) novoAbert = Number(parseFloat(aj.estq_abert_ajustado).toFixed(3));
                        fields[4] = novoAbert.toFixed(3).replace('.', ',');

                        let entr = Number(oldEntr.toFixed(3));
                        if (aj.vol_entr_ajustado !== null && aj.vol_entr_ajustado !== undefined) {
                            entr = Number(parseFloat(aj.vol_entr_ajustado).toFixed(3));
                        }
                        fields[5] = entr.toFixed(3).replace('.', ',');

                        const disp = Number((novoAbert + entr).toFixed(3));
                        fields[6] = disp.toFixed(3).replace('.', ',');

                        let novoSaida = Number(oldSaida.toFixed(3));
                        if (aj.vol_saidas_ajustado !== null) novoSaida = Number(parseFloat(aj.vol_saidas_ajustado).toFixed(3));
                        fields[7] = novoSaida.toFixed(3).replace('.', ',');

                        const escr = Number((disp - novoSaida).toFixed(3));
                        fields[8] = escr.toFixed(3).replace('.', ',');

                        let novoPerda = 0;
                        if (aj.val_perda_ajustado !== null) novoPerda = Number(parseFloat(aj.val_perda_ajustado).toFixed(3));
                        fields[9] = novoPerda.toFixed(3).replace('.', ',');

                        let novoGanho = 0;
                        if (aj.val_ganho_ajustado !== null) novoGanho = Number(parseFloat(aj.val_ganho_ajustado).toFixed(3));
                        fields[10] = novoGanho.toFixed(3).replace('.', ',');

                        const fisico = Number((escr - novoPerda + novoGanho).toFixed(3));
                        fields[11] = fisico.toFixed(3).replace('.', ',');

                        if (fields.length < 13) while (fields.length < 13) fields.push('');
                        else if (fields[fields.length - 1] !== '') fields[fields.length - 1] = '';

                        // Guarda no buffer para os tanques (1310) usarem o mesmo total arredondado
                        pending1300 = {
                            line: fields.join('|'),
                            orig: { abert: oldAbert, saida: oldSaida, entr: oldEntr, codItem: codItem },
                            novo: { abert: novoAbert, saida: novoSaida, perda: novoPerda, ganho: novoGanho, entr: entr }
                        };
                        continue; // Importante: não faz res.write aqui
                    }
                }
            }

            // --- BLOCO 1310 (Acumula no buffer se tivermos modificado o 1300) ---
            if (fields.length >= 2 && fields[1] === '1310' && pending1300) {
                pending1310s.push(fields);
                continue;
            }

            // Qualquer outro bloco (ou 1310 sem modificação no 1300), libera buffer primeiro
            flush1300Group();
            // Ajuste C100
            if (fields.length >= 2 && fields[1] === 'C100') {
                const numDoc = fields[8];
                const chvNfe = fields[9];
                lastC100 = { numDoc, chvNfe };

                const key = `${numDoc}_${chvNfe}`;
                if (mapC100.has(key)) {
                    fields[12] = parseFloat(mapC100.get(key)).toFixed(2).replace('.', ',');
                    changesApplied++;
                    res.write(fields.join('|') + '\r\n');
                    continue;
                }
            }

            // Ajuste C190
            if (fields.length >= 2 && fields[1] === 'C190') {
                const cst = fields[2];
                const cfop = fields[3];
                const aliq = parseFloat(fields[4].replace(',', '.')).toFixed(2);
                const key = `${lastC100.numDoc}_${lastC100.chvNfe || ''}_${cst}_${cfop}_${aliq}`;

                if (mapC190.has(key)) {
                    const aj = mapC190.get(key);
                    if (aj.vl_opr_ajustado !== null) fields[5] = parseFloat(aj.vl_opr_ajustado).toFixed(2).replace('.', ',');
                    if (aj.vl_bc_icms_ajustado !== null) fields[6] = parseFloat(aj.vl_bc_icms_ajustado).toFixed(2).replace('.', ',');
                    if (aj.vl_icms_ajustado !== null) fields[7] = parseFloat(aj.vl_icms_ajustado).toFixed(2).replace('.', ',');

                    changesApplied++;
                    res.write(fields.join('|') + '\r\n');
                    continue;
                }
            }

            res.write(line + '\r\n');
        }

        // Descarregar buffer residual se o arquivo terminar em um bloco 1310 ajustado
        flush1300Group();

        logger.info(`Exportação concluída: ${linesProcessed} linhas lidas, ${changesApplied} ajustes aplicados.`);
        res.end();

    } catch (error) {
        logger.error('Erro CRÍTICO na exportação SPED:', error);
        // Se já começamos a escrever os headers, não podemos dar res.status()
        if (!res.headersSent) {
            res.status(500).send('Erro interno ao processar exportação.');
        } else {
            res.end();
        }
    } finally {
        dbClient.release();
    }
});

// --- **ROTA DE EXCLUSÃO (OTIMIZADA ASSÍNCRONA)** ---
app.delete('/api/arquivo/:id', async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de exclusão com ID inválido: ${req.params.id} `);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    logger.info(`Recebida requisição para excluir arquivo ID: ${arquivoId}. Iniciando exclusão em background...`);

    // Responde ao Frontend IMEDIATAMENTE (Desacopla o processamento)
    // O usuário não precisa ficar olhando a tela travada enquanto o PG varre 2 milhões de linhas.
    res.status(200).send({
        message: "O pedido de exclusão foi recebido e está ocorrendo em segundo plano. O arquivo sumirá em breve."
    });

    // Função de Exclusão Autônoma (Sem travar o Event Loop e sem bloquear transação inteira)
    setImmediate(async () => {
        try {
            // Passo 1: Excluir os dados em formato de "Poda" por partes (evitando Timeout e bloqueio da tabela toda)
            logger.info(`[Job Exclusão] SPED ${arquivoId}: Apagando Itens Filhos do C100...`);
            await pool.query('DELETE FROM documentos_itens_c170 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $1)', [arquivoId]);
            await pool.query('DELETE FROM documentos_c190 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $1)', [arquivoId]);

            logger.info(`[Job Exclusão] SPED ${arquivoId}: Apagando Dados Primários...`);
            await pool.query('DELETE FROM documentos_c100 WHERE id_sped_arquivo = $1', [arquivoId]);
            await pool.query('DELETE FROM lmc_movimentacao WHERE id_sped_arquivo = $1', [arquivoId]);
            await pool.query('DELETE FROM sped_produtos WHERE id_sped_arquivo = $1', [arquivoId]);
            await pool.query('DELETE FROM sped_participantes WHERE id_sped_arquivo = $1', [arquivoId]);
            await pool.query('DELETE FROM erros_analise WHERE id_sped_arquivo = $1', [arquivoId]);

            // Passo 3: Excluir o arquivo "pai" (Isso irá sumir da UI)
            logger.info(`[Job Exclusão] SPED ${arquivoId}: Apagando ROOT...`);
            await pool.query('DELETE FROM sped_arquivos WHERE id = $1', [arquivoId]);

            logger.info(`[Job Exclusão CONCLUÍDO] Arquivo ID: ${arquivoId} obliterado completamente.`);
        } catch (error) {
            logger.error(`[Job Exclusão FALHA] Erro fatal limpando Lixo SPED ${arquivoId}:`, error);
        }
    });
});


// --- FUNÇÕES AUXILIARES (COM A CORREÇÃO DEFINITIVA) ---
const parseFloatSped = (str) => parseFloat((str || "0").replace(',', '.')) || 0;

function formatDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return null;
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4);
    try {
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
        if (isNaN(date.getTime()) || date.getUTCDate() !== parseInt(day)) {
            logger.warn(`Data inválida detectada e ignorada: ${dateStr}`);
            return null;
        }
        return `${year}-${month}-${day}`;
    } catch (e) {
        logger.warn(`Data inválida encontrada: ${dateStr}`);
        return null;
    }
}

function parseSpedFile(filePath, originalFilename) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(filePath, { encoding: 'latin1' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        const data = {
            fileInfo: { nome_arquivo: originalFilename },
            documents: [],
            participants: [],
            blocoD: [],
            lmc: new Map(),
            produtos: []
        };
        let currentC100 = null;
        let current1300 = null;
        let lineCounter = 0;

        rl.on('error', (err) => {
            logger.error(`Erro ao ler o stream do arquivo na linha ${lineCounter} `, err);
            reject(err);
        });

        rl.on('line', (line) => {
            lineCounter++;
            try {
                const fields = line.split('|');
                if (fields.length < 2) return;
                const reg = fields[1];

                if (reg === '0000') {
                    data.fileInfo.cnpj_empresa = fields[7];
                    data.fileInfo.nome_empresa = fields[6];
                    data.fileInfo.uf = fields[9];
                    data.fileInfo.periodo_apuracao = `${formatDate(fields[4])} a ${formatDate(fields[5])}`;
                } else if (reg === '0005') {
                    data.fileInfo.nome_fantasia = fields[2];
                } else if (reg === '0150') {
                    data.participants.push({ cod_part: fields[2], nome: fields[3], cnpj: fields[5] });
                } else if (reg === '0200') {
                    data.produtos.push({ cod_item: fields[2], descr_item: fields[3] });
                } else if (reg === '1300') {
                    // *** REGISTRO CONSOLIDADO (A SOLUÇÃO REAL) ***
                    // O cliente informou que o LMC precisa bater os totais. 
                    // No bloco 1300, a estrutura é:
                    // 0 = (vazio), 1 = 1300, 2 = cod_item, 3 = dt_fech, 4 = estq_abert, 5 = vol_entr, 
                    // 6 = vol_disp, 7 = vol_saidas, 8 = estq_escr, 9 = val_perda, 10 = val_ganho, 11 = fech_fisico

                    const p = fields;
                    const codItem = p[2];
                    const dtFech = p[3];

                    if (!data.lmc.has(codItem)) data.lmc.set(codItem, new Map());
                    const dateObject = new Date(`${dtFech.substring(4)}-${dtFech.substring(2, 4)}-${dtFech.substring(0, 2)}T12:00:00Z`);

                    // Tratamento seguro de fallback de tamanho de array do cliente
                    const finalFisico = p.length > 11 ? p[11] : p[8];

                    // A métrica que importa para o LMC no índice 7 do Guia Prático
                    current1300 = {
                        date: dateObject,
                        estqAbert: parseFloatSped(p[4]),
                        volEntr: parseFloatSped(p[5]),
                        volSaidas: parseFloatSped(p[7]),  // <-- O Índice Correto!
                        valPerda: parseFloatSped(p[9]),
                        valGanho: parseFloatSped(p[10]),
                        estqEscr: parseFloatSped(p[8]),
                        fechFisico: parseFloatSped(finalFisico),
                        tanks: []
                    };
                    data.lmc.get(codItem).set(dtFech, current1300);
                } else if (reg === '1310' && current1300) {
                    // Ignoramos a divisão em tanques do 1310 para calcular quebras 
                    // globais porque a métrica fiscal do SPED exige Fechamento Total vs Notas Fiscais
                } else if (reg === 'C100') {
                    currentC100 = {
                        ind_oper: fields[2], num_doc: fields[8], cod_mod: fields[5],
                        cod_sit: fields[6], dt_doc: formatDate(fields[10]), dt_e_s: formatDate(fields[11]),
                        vl_doc: parseFloatSped(fields[12]), cod_part: fields[4], chv_nfe: fields[9],
                        items: [], analytical: []
                    };
                    data.documents.push(currentC100);
                } else if (reg === 'C170' && currentC100) {
                    currentC100.items.push({
                        num_item: parseInt(fields[2]), cod_item: fields[3], qtd: parseFloatSped(fields[5]),
                        unid: fields[6], vl_item: parseFloatSped(fields[7]), cst_icms: fields[9], cfop: fields[10],
                        cst_pis: fields[25], cst_cofins: fields[30]
                    });
                } else if (reg === 'C190' && currentC100) {
                    currentC100.analytical.push({
                        cst: fields[2], cfop: fields[3], aliq: parseFloatSped(fields[4]), vl_opr: parseFloatSped(fields[5]),
                        vl_bc_icms: parseFloatSped(fields[6]), vl_icms: parseFloatSped(fields[7])
                    });
                } else if (reg === 'D100') {
                    data.blocoD.push({
                        ind_oper: fields[2], num_doc: fields[9], cod_mod: fields[5], cod_sit: fields[6],
                        dt_doc: formatDate(fields[11]), cfop: fields[14], vl_doc: parseFloatSped(fields[15]),
                        vl_icms: parseFloatSped(fields[22])
                    });
                }
            } catch (e) {
                logger.warn(`AVISO: Linha malformada ignorada(linha ${lineCounter}): ${line} `, e);
            }
        });

        rl.on('close', () => {
            logger.info('Leitura do arquivo concluída com sucesso.');
            resolve(data);
        });
    });
}

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Servidor AudiSped online em http://0.0.0.0:${PORT} (acessível na rede local)`);
});