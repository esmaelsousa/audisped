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
const sefazService = require('./services/sefazService');
const mdeService = require('./services/mdeService');
const espiaoNfeService = require('./services/espiaoNfeService');
const { runOptimization } = require('./test_optimize');
const { parseNfeCompleta, ensureNfeCompletaTable, salvarNfeCompleta, buscarNfeCompleta } = require('./nfe-completa');
const regrasFiscais = require('./services/regrasFiscaisService');

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
    max: 120,                      // aumentado para suportar exportações em lote sem esgotamento
    connectionTimeoutMillis: 30000, // 30s de espera por conexão (antes 20s)
    idleTimeoutMillis: 15000,      // libera conexões ociosas mais rápido (antes 30s)
});

// Handler global de erros do pool (evita crash silencioso em conexões perdidas)
pool.on('error', (err) => {
    logger.error('Erro inesperado no pool PostgreSQL:', { message: err.message, stack: err.stack });
});

// Rede de segurança: captura rejeições não tratadas para evitar crash do processo
process.on('unhandledRejection', (reason, promise) => {
    logger.error('UnhandledRejection capturada (processo NÃO será encerrado):', {
        message: reason?.message || String(reason),
        stack: reason?.stack
    });
});

// Helper: pool.connect() seguro — retorna null + responde 503 se pool esgotado
async function safeConnect(res) {
    try {
        return await pool.connect();
    } catch (err) {
        logger.error('Pool esgotado — conexão não disponível:', err.message);
        if (res && !res.headersSent) {
            res.status(503).json({ message: 'Servidor sobrecarregado. Tente novamente em alguns segundos.' });
        }
        return null;
    }
}

// Helper: ROLLBACK seguro — nunca lança exceção (evita crash do processo)
async function safeRollback(client) {
    try { if (client) await client.query('ROLLBACK'); } catch (_) { /* conexão já quebrada */ }
}

// Semáforo de concorrência para rotas pesadas (análise + exportação).
// Limita operações simultâneas para evitar esgotamento do pool de conexões.
const MAX_HEAVY_OPS = 5;
let heavyOpsRunning = 0;
const heavyOpsQueue = [];

function acquireHeavySlot() {
    return new Promise((resolve) => {
        if (heavyOpsRunning < MAX_HEAVY_OPS) {
            heavyOpsRunning++;
            resolve();
        } else {
            heavyOpsQueue.push(resolve);
        }
    });
}

function releaseHeavySlot() {
    if (heavyOpsQueue.length > 0) {
        const next = heavyOpsQueue.shift();
        next(); // próximo na fila ganha o slot (heavyOpsRunning permanece igual)
    } else {
        heavyOpsRunning--;
    }
}

const JWT_SECRET = process.env.JWT_SECRET || 'audisped-safira-token-secret-2025';

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) {
        logger.warn(`[AUTH] Token não fornecido para ${req.method} ${req.path}`);
        return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        logger.debug(`[AUTH] Token válido para usuário ${decoded.id || decoded.email}`);
        next();
    } catch (err) {
        logger.warn(`[AUTH] Token inválido: ${err.message} para ${req.method} ${req.path}`);
        res.status(403).json({ message: 'Token inválido ou expirado.' });
    }
};

// --- ROTAS DE AUTENTICAÇÃO ---
app.post('/api/auth/register', async (req, res) => {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ message: 'Preencha todos os campos.' });

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const query = 'SELECT id, nome, email FROM usuarios WHERE id = $1';
        const result = await dbClient.query(query, [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Usuário não encontrado.' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar dados do usuário.', error: err.message });
    } finally {
        dbClient.release();
    }
});

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
    const { nome, email, senha } = req.body;
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        let query;
        let params;
        if (senha) {
            const hashedPassword = await bcrypt.hash(senha, 10);
            query = 'UPDATE usuarios SET nome = $1, email = $2, senha = $3 WHERE id = $4 RETURNING id, nome, email';
            params = [nome, email, hashedPassword, req.user.id];
        } else {
            query = 'UPDATE usuarios SET nome = $1, email = $2 WHERE id = $3 RETURNING id, nome, email';
            params = [nome, email, req.user.id];
        }
        const result = await dbClient.query(query, params);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: 'Email já está em uso por outro usuário.' });
        res.status(500).json({ message: 'Erro ao atualizar perfil.', error: err.message });
    } finally {
        dbClient.release();
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const query = 'SELECT * FROM usuarios WHERE email = $1';
        const result = await dbClient.query(query, [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(senha, user.senha))) {
            return res.status(401).json({ message: 'Email ou senha incorretos.' });
        }

        const token = jwt.sign({ id: user.id, nome: user.nome, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, nome: user.nome, email: user.email } });
    } catch (err) {
        res.status(500).json({ message: 'Erro no servidor.', error: err.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTAS PARA GESTÃO DE CFOPS ---
app.get('/api/cfops', authMiddleware, async (req, res) => {
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const result = await dbClient.query('SELECT * FROM cad_cfops ORDER BY codigo ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar CFOPs.', error: err.message });
    } finally {
        dbClient.release();
    }
});

app.post('/api/cfops', authMiddleware, async (req, res) => {
    const { codigo, descricao, tipo = 'entrada' } = req.body;
    if (!codigo) return res.status(400).json({ message: 'Código do CFOP é obrigatório.' });

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const query = 'INSERT INTO cad_cfops (codigo, descricao, tipo) VALUES ($1, $2, $3) RETURNING *';
        const result = await dbClient.query(query, [codigo, descricao, tipo]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: 'CFOP já cadastrado.' });
        res.status(500).json({ message: 'Erro ao cadastrar CFOP.', error: err.message });
    } finally {
        dbClient.release();
    }
});

app.put('/api/cfops/:id', authMiddleware, async (req, res) => {
    const { codigo, descricao, tipo } = req.body;
    if (!codigo) return res.status(400).json({ message: 'Código do CFOP é obrigatório.' });
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const result = await dbClient.query(
            'UPDATE cad_cfops SET codigo=$1, descricao=$2, tipo=$3 WHERE id=$4 RETURNING *',
            [codigo, descricao, tipo || 'entrada', req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'CFOP não encontrado.' });
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ message: 'Código já existe em outro CFOP.' });
        res.status(500).json({ message: 'Erro ao atualizar CFOP.', error: err.message });
    } finally {
        dbClient.release();
    }
});

app.delete('/api/cfops/:id', authMiddleware, async (req, res) => {
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('DELETE FROM cad_cfops WHERE id = $1', [req.params.id]);
        res.json({ message: 'CFOP excluído com sucesso.' });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao excluir CFOP.', error: err.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTAS DO MANIFESTO DE DESTINATÁRIO (MD-e) ---
app.get('/api/mde/sync/:id_empresa', authMiddleware, async (req, res) => {
    try {
        const result = await mdeService.syncNotas(req.params.id_empresa);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao sincronizar notas.', error: err.message });
    }
});

app.get('/api/mde/notas/:id_empresa', authMiddleware, async (req, res) => {
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    const { inicio, fim } = req.query;
    try {
        let query = 'SELECT * FROM mde_cache WHERE id_empresa = $1';
        let params = [req.params.id_empresa];
        let pIdx = 2;

        if (inicio) {
            query += ` AND data_emissao >= $${pIdx++}`;
            params.push(inicio);
        }
        if (fim) {
            query += ` AND data_emissao <= $${pIdx++}`;
            params.push(`${fim} 23:59:59`);
        }

        query += ' ORDER BY data_emissao DESC';
        const result = await dbClient.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar notas.', error: err.message });
    } finally {
        dbClient.release();
    }
});


app.get('/api/mde/xml/:chave_nfe', authMiddleware, async (req, res) => {
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const result = await dbClient.query(`
            SELECT xml_content FROM mde_cache 
            WHERE chave_nfe = $1
        `, [req.params.chave_nfe]);
        
        if (result.rows.length === 0 || !result.rows[0].xml_content) {
            return res.status(404).json({ message: 'XML não encontrado ou ainda não baixado.' });
        }
        
        res.json({ xml: result.rows[0].xml_content });
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar XML.', error: err.message });
    } finally {
        dbClient.release();
    }
});

app.post('/api/mde/manifestar', authMiddleware, async (req, res) => {
    const { id_empresa, chave_nfe, evento } = req.body;
    try {
        const result = await mdeService.manifestar(id_empresa, chave_nfe, evento);
        res.json(result);
    } catch (err) {
        const isBusinessError = err.statusCode === 422 || err.message.includes('não localizou') || err.message.includes('Notas de saída');
        res.status(isBusinessError ? 422 : 500).json({ message: err.message, error: err.message });
    }
});

app.post('/api/mde/importar-chave', authMiddleware, async (req, res) => {
    const { id_empresa, chave } = req.body;
    try {
        // Se houver vírgula ou espaço, trata como lote via Espião
        if (chave.includes(',') || chave.includes(' ') || chave.includes('\n')) {
            const result = await espiaoNfeService.importarChavesLote(id_empresa, chave);
            return res.json(result);
        }
        
        const result = await mdeService.importarChave(id_empresa, chave);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao importar nota por chave.', error: err.message });
    }
});
app.post('/api/mde/delete-notas', authMiddleware, async (req, res) => {
    const { id_empresa, chaves } = req.body;
    if (!id_empresa || !chaves || !Array.isArray(chaves) || chaves.length === 0) {
        return res.status(400).json({ message: 'Empresa e lista de chaves são obrigatórias.' });
    }

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('BEGIN');
        const query = 'DELETE FROM mde_cache WHERE id_empresa = $1 AND chave_nfe = ANY($2)';
        const result = await dbClient.query(query, [id_empresa, chaves]);
        await dbClient.query('COMMIT');
        res.json({ message: `${result.rowCount} nota(s) excluída(s) com sucesso.` });
    } catch (err) {
        await safeRollback(dbClient);
        res.status(500).json({ message: 'Erro ao excluir notas.', error: err.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTAS DO ESPIÃO NFE ---
app.get('/api/espiao/sync/:id_empresa', authMiddleware, async (req, res) => {
    const { id_empresa } = req.params;
    const { inicio, fim } = req.query;
    try {
        const result = await espiaoNfeService.syncNotas(id_empresa, inicio || null, fim || null);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao sincronizar via EspiãoNFe.', error: err.message });
    }
});

app.get('/api/espiao/notas/:id_empresa', authMiddleware, async (req, res) => {
    try {
        const notas = await espiaoNfeService.getNotas(req.params.id_empresa, req.query);
        res.json(notas);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar notas do EspiãoNFe.', error: err.message });
    }
});

app.post('/api/espiao/importar-lote', authMiddleware, async (req, res) => {
    const { id_empresa, chaves } = req.body;
    try {
        const result = await espiaoNfeService.importarChavesLote(id_empresa, chaves);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao importar lote de chaves.', error: err.message });
    }
});

app.post('/api/espiao/conferir-sped', authMiddleware, async (req, res) => {
    const { id_empresa, chaves } = req.body;
    try {
        const result = await espiaoNfeService.conferirFaltantes(id_empresa, chaves);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao conferir chaves do Sped.', error: err.message });
    }
});

app.post('/api/espiao/download-zip', authMiddleware, async (req, res) => {
    const { id_empresa, chaves } = req.body;
    try {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="xmls.zip"');
        await espiaoNfeService.downloadBatchZip(id_empresa, chaves, res);
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ message: 'Erro ao gerar ZIP de download.', error: err.message });
        }
    }
});

app.get('/api/espiao/download-xml/:id_empresa/:chave', authMiddleware, async (req, res) => {
    const { id_empresa, chave } = req.params;
    try {
        const xml = await espiaoNfeService.downloadXml(id_empresa, chave);
        res.set('Content-Type', 'text/xml');
        res.send(xml);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao baixar XML.', error: err.message });
    }
});

app.post('/api/mde/certificado', authMiddleware, async (req, res) => {
    const { id_empresa, pfx_base64, senha, nsu, periodicidade } = req.body;
    try {
        const result = await mdeService.saveCertificado(id_empresa, pfx_base64, senha, nsu, periodicidade);
        res.json(result);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

app.get('/api/mde/certificado/:id_empresa', authMiddleware, async (req, res) => {
    try {
        const result = await mdeService.getStatusCertificado(req.params.id_empresa);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao buscar status do certificado.' });
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        logger.info("Passo 1: Analisando o arquivo SPED em memória...");
        const parsedData = await parseSpedFile(filePath, req.file.originalname);

        if (!parsedData) {
            throw new Error("A análise do arquivo SPED não retornou dados.");
        }
        const { fileInfo, documents, participants, lmc, produtos, bicos } = parsedData;

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

        // Inserir registros 1320 (encerrantes por bico) — base para validacao fiscal de bicos
        if (bicos && bicos.length > 0) {
            for (const b of bicos) {
                await dbClient.query(
                    `INSERT INTO sped_1320 (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico, enc_ini, enc_fin, qtd_af, vol_bico)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                     ON CONFLICT (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico) DO NOTHING`,
                    [sped_arquivo_id, b.data_mov, b.cod_item, b.num_tanque, b.num_bico, b.enc_ini, b.enc_fin, b.qtd_af, b.vol_bico]
                );
            }
            logger.info(`Passo 4.1: Registros 1320 (${bicos.length} bicos) inseridos.`);
        }

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
            const prodQuery = 'INSERT INTO sped_produtos (id_sped_arquivo, cod_item, descr_item, ncm) VALUES ($1, $2, $3, $4) ON CONFLICT (id_sped_arquivo, cod_item) DO UPDATE SET ncm = EXCLUDED.ncm';
            await dbClient.query(prodQuery, [sped_arquivo_id, p.cod_item, p.descr_item, p.ncm || null]);
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

        // Detecta lacunas no LMC (Registro 1300) — alerta não-bloqueante por produto.
        const avisosLmc = validarCompletudeLmc1300(lmc, fileInfo.periodo_apuracao, produtos);
        if (avisosLmc.tem_lacuna) {
            const totLac = avisosLmc.produtos.filter(p => p.dias_faltantes.length > 0).length;
            logger.warn(`LMC INCOMPLETO: ${totLac} produto(s) com dias faltantes em ${fileInfo.periodo_apuracao}.`);
        }

        res.status(200).send({
            message: `Arquivo processado e salvo com sucesso!`,
            id_sped_arquivo: sped_arquivo_id,
            fileInfo: { ...fileInfo, id_empresa }, // Adiciona o id_empresa na resposta
            avisos_lmc: avisosLmc
        });

    } catch (error) {
        if (dbClient) await safeRollback(dbClient);
        logger.error('--- ERRO FATAL DURANTE O PROCESSAMENTO ---', { message: error.message, stack: error.stack });
        res.status(500).send({ message: "Ocorreu um erro crítico ao processar o arquivo. Verifique o log do backend para detalhes.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
        logger.info('Processo de upload finalizado. Arquivo retido para futuras exportações.');
    }
});

// ==============================================================================
//  ROTA: /api/arquivos/analisar-sintaxe (Validador Fiscal Rápido)
//  Objetivo: Varrer o arquivo e aplicar heurísticas da Malha Fina sem gravar no DB
// ==============================================================================
app.post('/api/arquivos/analisar-sintaxe', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        let filePath;
        const { id_arquivo } = req.body;

        if (id_arquivo) {
            const dbRes = await pool.query('SELECT caminho_arquivo FROM sped_arquivos WHERE id = $1', [id_arquivo]);
            if (dbRes.rows.length === 0) return res.status(404).send({ message: "Arquivo não encontrado para análise automática." });
            filePath = dbRes.rows[0].caminho_arquivo;
        } else if (req.file) {
            filePath = req.file.path;
        } else {
            return res.status(400).send({ message: "Nenhum arquivo ou ID enviado para análise sintática." });
        }

        logger.info(`Iniciando Validação de Malha Fina Sintática: ${filePath}`);

        const fileBuffer = fs.readFileSync(filePath, 'latin1');
        const lines = fileBuffer.split(/\r?\n/);

        let infractions = {
            c100_valores_divergentes: [],
            c100_sem_c190: [],
            c100_saltos_enumeracao: [],
            h010_divergente_1300: [],
            cfop_suspeitos: [],
            bicos_duplicados_1320: [],
            chv_nfe_cnpj_divergente: []
        };

        // CNPJ do informante (extraído do registro 0000)
        let cnpjInformante = '';

        // Cache state machines durante leitura sequencial
        let activeC100 = null;
        let activeC190Sum = 0;
        let lastC100NfeNumber = null;

        let lastLmcFisico = 0;
        let inventarioH010Fisico = 0;

        // Detecção de bicos duplicados: bico aparece em mais de um tanque no mesmo dia/produto
        let current1300 = null;       // { dt, codItem, linha }
        let current1310Tanque = null; // número do tanque corrente
        // Map: "DD/MM/YYYY_COD_ITEM" -> Map<bico, [{tanque, vol, linha}]>
        const bicoPorDiaProduto = new Map();

        // Mapa de Produtos (COD_ITEM -> { descr, ncm, cest })
        const produtoMap = new Map();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const parts = line.split('|');

            // --- Bloco 0: Registro 0000 (CNPJ do informante) ---
            if (parts[1] === '0000' && parts.length > 7) {
                cnpjInformante = (parts[7] || '').replace(/\D/g, '');
            }

            // --- Bloco 0: Cadastros ---
            if (parts[1] === '0200') {
                const cod = parts[2];
                const descr = parts[3];
                const ncm = (parts[8] || '').trim();
                produtoMap.set(cod, { descr, ncm });

                if (!ncm || ncm.length < 8) {
                    infractions.cfop_suspeitos.push({
                        linha: i + 1,
                        alerta: `Produto [${cod}] ${descr} está com NCM inválido ou ausente: ${ncm || 'VAZIO'}`
                    });
                }
            }

            // --- Bloco 1: LMC (Pegar ultimo fisico do periodo) ---
            if (parts[1] === '1300') {
                // Em SPED, podem haver varios 1300, vamos guardar e reescrever o ultimo do mes
                let fisicoStr = parts[11];
                if (fisicoStr) lastLmcFisico = parseFloat(fisicoStr.replace(',', '.'));
                // Rastrear para detecção de bicos duplicados
                const dt = parts[3] || '';
                const dtFmt = dt.length === 8 ? `${dt.substring(0,2)}/${dt.substring(2,4)}/${dt.substring(4,8)}` : dt;
                current1300 = { dt: dtFmt, codItem: parts[2], linha: i + 1 };
                current1310Tanque = null;
            }

            if (parts[1] === '1310') {
                current1310Tanque = parts[2];
            }

            if (parts[1] === '1320' && current1300 && current1310Tanque) {
                const bicoNum = parts[2];
                const volVendas = parseFloat((parts[11] || '0').replace(',', '.'));
                const chave = `${current1300.dt}_${current1300.codItem}`;
                if (!bicoPorDiaProduto.has(chave)) bicoPorDiaProduto.set(chave, new Map());
                const bicoMap = bicoPorDiaProduto.get(chave);
                if (!bicoMap.has(bicoNum)) bicoMap.set(bicoNum, []);
                bicoMap.get(bicoNum).push({ tanque: current1310Tanque, vol: volVendas, linha: i + 1 });
            }

            // --- Bloco H: Inventário ---
            if (parts[1] === 'H010') {
                // Identifica combustiveis pelo COD_ITEM
                inventarioH010Fisico += parseFloat((parts[4] || '0').replace(',', '.'));
            }

            // --- Bloco C: Documentos (NFE e NFCe) ---
            if (parts[1] === 'C100') {
                // Ao abrir um novo C100, checar se o Anterior fechou a matemática com seus C190 filhos
                if (activeC100) {
                    if (Math.abs(activeC100.vl_doc - activeC190Sum) > 1.0) {
                        infractions.c100_valores_divergentes.push({
                            linha: activeC100.linha,
                            num_doc: activeC100.num_doc,
                            valor_capa: activeC100.vl_doc,
                            soma_c190: activeC190Sum,
                            diferenca: (activeC100.vl_doc - activeC190Sum).toFixed(2)
                        });
                    }
                    if (activeC190Sum === 0 && activeC100.vl_doc > 0) {
                        infractions.c100_sem_c190.push({ linha: activeC100.linha, num_doc: activeC100.num_doc });
                    }
                }

                // Detecção de CNPJ divergente na chave NF-e/NFC-e
                const chvNfe = parts[9] || '';
                const indEmit = parts[3] || '';
                if (cnpjInformante && chvNfe.length === 44 && indEmit === '0') {
                    const cnpjChave = chvNfe.substring(6, 20);
                    if (cnpjChave !== cnpjInformante) {
                        infractions.chv_nfe_cnpj_divergente.push({
                            linha: i + 1,
                            num_doc: parts[8] || '',
                            modelo: parts[5] === '65' ? 'NFC-e' : 'NF-e',
                            cnpj_chave: cnpjChave,
                            cnpj_informante: cnpjInformante,
                            alerta: `CNPJ da chave (${cnpjChave}) difere do informante (${cnpjInformante})`
                        });
                    }
                }

                // Iniciar escopo do novo C100
                const num_doc = parts[8];
                const vl_doc = parseFloat((parts[12] || '0').replace(',', '.'));

                // Quebra/Salto de Nfe
                let currNum = parseInt(num_doc, 10);
                if (lastC100NfeNumber && (currNum - lastC100NfeNumber > 1) && (currNum - lastC100NfeNumber < 50)) {
                    // Ex: pulou do 150 pro 155
                    infractions.c100_saltos_enumeracao.push({
                        ultimo_visto: lastC100NfeNumber,
                        salto_identificado: currNum
                    });
                }
                lastC100NfeNumber = currNum;

                activeC100 = { linha: i + 1, num_doc, vl_doc };
                activeC190Sum = 0; // zera pro novo pai
            }

            // --- Itens Diários e Totalizador C190 ---
            if (parts[1] === 'C190') {
                let vl_opr = parseFloat((parts[5] || '0').replace(',', '.'));
                let cfop = parts[3];
                let cst = parts[2];
                activeC190Sum += vl_opr;

                // Heurística de CFOP de Devolução x CST
                if (['1202', '2202', '1411'].includes(cfop) && cst === '060') {
                    infractions.cfop_suspeitos.push({
                        linha: i + 1,
                        nf: activeC100 ? activeC100.num_doc : 'Desconhecida',
                        alerta: `CFOP ${cfop} de devolução requer CST tributado, encontrado CST ${cst}`
                    });
                }
            }
        }

        // Finaliza o loop checando o último C100 q ficou aberto
        if (activeC100) {
            if (Math.abs(activeC100.vl_doc - activeC190Sum) > 1.0) {
                infractions.c100_valores_divergentes.push({
                    linha: activeC100.linha, num_doc: activeC100.num_doc,
                    valor_capa: activeC100.vl_doc, soma_c190: activeC190Sum,
                    diferenca: (activeC100.vl_doc - activeC190Sum).toFixed(2)
                });
            }
        }

        // Detecção de bicos duplicados entre tanques
        for (const [chave, bicoMap] of bicoPorDiaProduto) {
            for (const [bicoNum, ocorrencias] of bicoMap) {
                if (ocorrencias.length > 1) {
                    const [dt, codItem] = chave.split('_');
                    const descr = produtoMap.has(codItem) ? produtoMap.get(codItem).descr : codItem;
                    const tanques = ocorrencias.map(o => o.tanque);
                    const vols = ocorrencias.map(o => o.vol.toFixed(3));
                    infractions.bicos_duplicados_1320.push({
                        data: dt,
                        produto: descr,
                        cod_item: codItem,
                        bico: bicoNum,
                        tanques: tanques.join(', '),
                        volumes: vols.join(', '),
                        alerta: `Bico ${bicoNum} aparece em ${ocorrencias.length} tanques (${tanques.join(', ')}) no mesmo dia — possivel duplicacao no arquivo original`
                    });
                }
            }
        }

        // Cruzamento 1300 vs H010
        if (lastLmcFisico > 0 && inventarioH010Fisico > 0) {
            if (Math.abs(lastLmcFisico - inventarioH010Fisico) > 0.5) {
                infractions.h010_divergente_1300.push({
                    erro: "Inventário (Bloco H) difere do último Estoque Físico de LMC Mês (1300)",
                    estoque_lmc: lastLmcFisico,
                    estoque_inventario: inventarioH010Fisico,
                    diferenca: (lastLmcFisico - inventarioH010Fisico).toFixed(3)
                });
            }
        }

        res.status(200).send({
            message: "Análise Sintática finalizada",
            infractions
        });

    } catch (error) {
        logger.error('Erro ao analisar sintaxe do arquivo: ', error);
        res.status(500).send({ message: "Erro ao processar auditoria estática.", error: error.message });
    }
});


// --- ROTA DE PARSER DE XMLs (INJETOR SPED FASE 1) ---

const parseValorNFe = (val) => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    const cleanStr = String(val).replace(',', '.').trim();
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? 0 : parsed;
};

// --- HELPERS DE VALIDAÇÃO DE CNPJ/PERÍODO ---
function limparCnpjStr(s) { return String(s || '').replace(/\D/g, '').padStart(14, '0'); }

function parsePeriodoSped(periodoStr) {
    // Aceita o formato REAL do sistema "YYYY-MM-DD a YYYY-MM-DD" e o legado "DD/MM/YYYY a DD/MM/YYYY".
    // (Bug anterior: só tratava DD/MM/YYYY -> com YYYY-MM-DD as datas viravam null e dataForaPeriodo
    //  retornava sempre false, desligando a validacao de periodo.)
    const partes = String(periodoStr || '').split(' a ');
    const parseData = (s) => {
        const t = (s || '').trim();
        let y, m, d;
        if (t.includes('-')) { [y, m, d] = t.split('-').map(Number); }      // YYYY-MM-DD
        else if (t.includes('/')) { [d, m, y] = t.split('/').map(Number); } // DD/MM/YYYY
        else return null;
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d);
    };
    return { inicio: parseData(partes[0] || ''), fim: parseData(partes[1] || partes[0] || '') };
}

function dataForaPeriodo(dtStr, periodo) {
    if (!dtStr || !periodo.inicio || !periodo.fim) return false;
    // Parse YYYY-MM-DD em horário local para evitar erros de fuso (UTC vs local)
    const [y, m, d] = dtStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt < periodo.inicio || dt > periodo.fim;
}

function validarXmls(itens, cnpjSped, periodoSped, forcePeriodo) {
    // itens: [{ arquivo, cnpjDest, dtDoc }]
    // forcePeriodo=true: usuário confirmou o alerta e permite XMLs fora do período
    const bloqueados = [];
    const avisos = [];
    const periodo = parsePeriodoSped(periodoSped);
    for (const item of itens) {
        const cnpjXml = limparCnpjStr(item.cnpjDest);
        const cnpjBase = limparCnpjStr(cnpjSped);
        if (cnpjXml && cnpjBase && cnpjXml !== cnpjBase) {
            bloqueados.push({ arquivo: item.arquivo, cnpj_xml: cnpjXml, cnpj_sped: cnpjBase });
        } else if (!forcePeriodo && dataForaPeriodo(item.dtDoc, periodo)) {
            avisos.push({ arquivo: item.arquivo, data_xml: item.dtDoc, periodo_sped: periodoSped });
        }
    }
    return { bloqueados, avisos };
}

// Detecta lacunas no LMC (Registro 1300) — ex: SPED com lançamentos só até dia 27,
// faltando 28, 29, 30, 31. Granularidade por produto (combustíveis distintos podem
// ter movimentação em dias diferentes). Retorna estrutura para alerta não-bloqueante.
// periodoApuracao formato: "YYYY-MM-DD a YYYY-MM-DD" (gerado por parseSpedFile).
function validarCompletudeLmc1300(lmcMap, periodoApuracao, produtos) {
    const partes = String(periodoApuracao || '').split(' a ');
    if (partes.length !== 2) return { tem_lacuna: false, produtos: [] };

    const [yi, mi, di] = partes[0].split('-').map(Number);
    const [yf, mf, df] = partes[1].split('-').map(Number);
    if (!yi || !yf) return { tem_lacuna: false, produtos: [] };

    const inicio = new Date(Date.UTC(yi, mi - 1, di));
    const fim    = new Date(Date.UTC(yf, mf - 1, df));

    const diasPeriodo = [];
    for (let d = new Date(inicio); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
        diasPeriodo.push(d.toISOString().slice(0, 10));
    }

    const descMap = new Map();
    for (const p of (produtos || [])) descMap.set(p.cod_item, p.descr_item);

    const resultadoProdutos = [];
    let temLacuna = false;

    for (const [codItem, daily] of (lmcMap || new Map()).entries()) {
        const diasComLmc = new Set();
        for (const dayData of daily.values()) {
            if (dayData.date instanceof Date) {
                diasComLmc.add(dayData.date.toISOString().slice(0, 10));
            }
        }

        const diasFaltantes = diasPeriodo.filter(d => !diasComLmc.has(d));
        if (diasFaltantes.length > 0) temLacuna = true;

        resultadoProdutos.push({
            cod_item: codItem,
            descr_item: descMap.get(codItem) || codItem,
            total_dias_periodo: diasPeriodo.length,
            total_dias_com_lmc: diasComLmc.size,
            dias_faltantes: diasFaltantes,
            ultimo_dia_com_lmc: [...diasComLmc].sort().pop() || null
        });
    }

    return {
        tem_lacuna: temLacuna,
        periodo: periodoApuracao,
        total_dias_periodo: diasPeriodo.length,
        produtos: resultadoProdutos
    };
}

// --- HELPERS LMC PÓS-INJEÇÃO DE XML ---
const NCM_COMBUSTIVEL_MAP = {
    '27101259': 'GASOLINA',
    '27101912': 'GASOLINA ADITIVADA',
    '27101921': 'OLEO DIESEL',
    '27101922': 'OLEO DIESEL S10',
    '22071000': 'ALCOOL ETILICO',
    '22071090': 'ALCOOL ETILICO HIDRATADO',
    '22071010': 'ALCOOL ETILICO ANIDRO',
    '27112100': 'GAS NATURAL',
};
const CFOP_COMBUSTIVEL_SET = new Set(['1652', '2652', '1653', '2653']);

function mapNcmCodItemSped(spedPath) {
    // Lê registros 0200 do arquivo SPED e retorna Map<ncm → cod_item[]>
    const map = new Map();
    try {
        const lines = fs.readFileSync(spedPath, 'latin1').split(/\r?\n/);
        for (const line of lines) {
            if (!line.startsWith('|0200|')) continue;
            const p = line.split('|');
            const cod = (p[2] || '').trim();
            const ncm = (p[8] || '').replace(/\D/g, '');
            if (cod && ncm) {
                if (!map.has(ncm)) map.set(ncm, []);
                if (!map.get(ncm).includes(cod)) map.get(ncm).push(cod);
            }
        }
    } catch (_) {}
    return map;
}

function detectarCombustivelNfe(parsedNotes) {
    // Retorna itens de combustível encontrados nas NF-es parseadas
    // Usa dt_doc (data de emissão da NF) como data de entrada no LMC
    const result = [];
    for (const nota of parsedNotes) {
        const dtDoc = nota.c100?.dt_doc || '';
        for (const item of (nota.itens || [])) {
            const ncm = String(item.ncm || '').replace(/\D/g, '');
            const cfop = String(item.cfop || '');
            if (NCM_COMBUSTIVEL_MAP[ncm] || CFOP_COMBUSTIVEL_SET.has(cfop)) {
                result.push({
                    dt_doc: dtDoc,
                    ncm,
                    cfop,
                    qcom: parseFloat(item.qcom || 0),
                    descr: item.descr_item || NCM_COMBUSTIVEL_MAP[ncm] || 'Combustivel',
                    cnpj_emissor: nota.emitente?.cnpj || null,
                    cod_produto_xml: item.cod_item || null,
                });
            }
        }
    }
    return result;
}

async function atualizarEntradaLmcXml(dbClient, id_arquivo, cod_item, data_mov) {
    // Recalcula vol_entr_ajustado como soma das NFs reais registradas (não acumula incrementalmente).
    // Nunca altera vol_entr (dado original do SPED).
    const somaRes = await dbClient.query(`
        SELECT COALESCE(SUM(i.qtd), 0) as total_nfs
        FROM documentos_c100 c
        JOIN documentos_itens_c170 i ON i.id_documento_c100 = c.id
        WHERE c.id_sped_arquivo = $1
          AND c.ind_oper = '0'
          AND COALESCE(c.dt_e_s, c.dt_doc) = $2
          AND i.cod_item = $3
          AND (i.cfop LIKE '110%' OR i.cfop LIKE '210%'
               OR i.cfop LIKE '165%' OR i.cfop LIKE '265%' OR i.cfop LIKE '065%'
               OR i.cfop LIKE '116%' OR i.cfop LIKE '216%')
    `, [id_arquivo, data_mov, cod_item]);

    const totalNfs = parseFloat(somaRes.rows[0].total_nfs) || 0;

    // Atualiza linha consolidada (num_tanque = '0')
    const res = await dbClient.query(`
        UPDATE lmc_movimentacao
        SET vol_entr_ajustado = $1,
            estq_escr         = estq_abert + vol_entr - vol_saidas,
            vol_escr_ajustado = COALESCE(estq_abert_ajustado, estq_abert)
                                + $1
                                - COALESCE(vol_saidas_ajustado, vol_saidas)
        WHERE id_sped_arquivo = $2 AND cod_item = $3 AND data_mov = $4 AND num_tanque = '0'
        RETURNING id
    `, [totalNfs, id_arquivo, cod_item, data_mov]);

    if (res.rowCount === 0) return false;

    // Distribui igualmente entre tanques individuais
    const tankRows = await dbClient.query(`
        SELECT id FROM lmc_movimentacao
        WHERE id_sped_arquivo = $1 AND cod_item = $2 AND data_mov = $3 AND num_tanque != '0'
    `, [id_arquivo, cod_item, data_mov]);

    if (tankRows.rows.length > 0) {
        const perTank = totalNfs / tankRows.rows.length;
        for (const row of tankRows.rows) {
            await dbClient.query(`
                UPDATE lmc_movimentacao
                SET vol_entr_ajustado = $1,
                    estq_escr         = estq_abert + vol_entr - vol_saidas,
                    vol_escr_ajustado = COALESCE(estq_abert_ajustado, estq_abert)
                                        + $1
                                        - COALESCE(vol_saidas_ajustado, vol_saidas)
                WHERE id = $2
            `, [perTank, row.id]);
        }
    }
    return true;
}

// Após injeção de XMLs, sincroniza os C100/C170 no banco usando dt_doc como data de entrada.
// Garante que a NF apareça no LMC e no Analisador do período onde foi injetada.
async function sincronizarNotasInjetadas(pool, id_arquivo, parsedNotes, spedFilePath = null) {
    if (!parsedNotes || parsedNotes.length === 0) return;
    const dbClient = await safeConnect(null);
    if (!dbClient) return;

    // Pré-indexa o C190 por chave a partir do arquivo final (fonte da verdade): garante que o
    // analítico no banco bata 100% com o .txt exportado (evita "SEM C190" na tela de auditoria).
    const c190PorChave = new Map();
    try {
        if (spedFilePath && fs.existsSync(spedFilePath)) {
            let chaveAtual = null;
            for (const line of fs.readFileSync(spedFilePath, 'latin1').split(/\r?\n/)) {
                if (!line || line[0] !== '|') continue;
                const f = line.split('|');
                if (f[1] === 'C100') {
                    chaveAtual = f[9] || null;
                } else if (f[1] === 'C190' && chaveAtual) {
                    if (!c190PorChave.has(chaveAtual)) c190PorChave.set(chaveAtual, []);
                    // C190: f[2]=CST, f[3]=CFOP, f[4]=ALIQ, f[5]=VL_OPR, f[6]=VL_BC_ICMS, f[7]=VL_ICMS
                    c190PorChave.get(chaveAtual).push({
                        cst: f[2], cfop: f[3],
                        aliq: parseFloat((f[4] || '0').replace(',', '.')) || 0,
                        vlOpr: parseFloat((f[5] || '0').replace(',', '.')) || 0,
                        vlBc: parseFloat((f[6] || '0').replace(',', '.')) || 0,
                        vlIcms: parseFloat((f[7] || '0').replace(',', '.')) || 0
                    });
                }
            }
        }
    } catch (e) { logger.warn('sincronizarNotasInjetadas: falha ao indexar C190 do arquivo: ' + e.message); }

    try {
        for (const nota of parsedNotes) {
            if (!nota.c100?.chv_nfe && !nota.c100?.num_doc) continue;
            const c = nota.c100;
            const dtDoc = c.dt_doc || null;       // data de emissão (YYYY-MM-DD)
            const dtEs  = dtDoc;                  // usa emissão como data de entrada

            // Reinjeção/forceReplace: remove a versão anterior desta nota no banco para regravar
            // com os dados atualizados (CST do De-Para, etc). ON DELETE CASCADE limpa C170/C190.
            await dbClient.query(
                `DELETE FROM documentos_c100
                 WHERE id_sped_arquivo = $1
                   AND (chv_nfe = $2 OR (num_doc = $3 AND chv_nfe IS NULL))`,
                [id_arquivo, c.chv_nfe || null, c.num_doc || null]
            );

            // Resolve cod_part pelo CNPJ do emitente
            let codPart = nota.emitente?.cnpj || null;
            if (codPart) {
                const partRes = await dbClient.query(
                    `SELECT cod_part FROM sped_participantes
                     WHERE id_sped_arquivo = $1
                       AND REGEXP_REPLACE(cnpj,'[^0-9]','','g') = REGEXP_REPLACE($2,'[^0-9]','','g')
                     LIMIT 1`,
                    [id_arquivo, codPart]
                );
                if (partRes.rowCount > 0) {
                    codPart = partRes.rows[0].cod_part;
                } else {
                    // Cria o participante (0150) no banco para a tela de Notas não exibir "Desconhecido"
                    await dbClient.query(
                        `INSERT INTO sped_participantes (id_sped_arquivo, cod_part, nome, cnpj)
                         VALUES ($1,$2,$3,$4) ON CONFLICT (id_sped_arquivo, cod_part) DO NOTHING`,
                        [id_arquivo, codPart, (nota.emitente?.nome || ('FORNECEDOR ' + codPart)), codPart]
                    );
                }
            }

            const vlDoc = parseFloat((c.vl_doc || '0').toString().replace(',', '.')) || 0;
            const insC100 = await dbClient.query(
                `INSERT INTO documentos_c100
                    (id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe)
                 VALUES ($1,'0',$2,$3,'00',$4,$5,$6,$7,$8)
                 RETURNING id`,
                [id_arquivo, c.num_doc, c.mod || '55', dtDoc, dtEs, vlDoc, codPart, c.chv_nfe || null]
            );
            const c100Id = insC100.rows[0].id;

            // Insere itens C170
            // Suporta dois formatos de campo: extractNfeData (qcom/vprod/ucom/cfop/cst_icms)
            // e o parser inline legado (qtd/vl_item/unid/cfop_original/cst_icms_original)
            const cnpjEmitente = (nota.emitente?.cnpj || '').replace(/\D/g, '');
            let numItem = 1;
            for (const item of (nota.itens || [])) {
                const rawQtd  = item.qtd  ?? item.qcom  ?? '0';
                const rawVlIt = item.vl_item ?? item.vprod ?? '0';
                const qtd  = parseFloat(rawQtd.toString().replace(',', '.'))  || 0;
                const vlIt = parseFloat(rawVlIt.toString().replace(',', '.')) || 0;
                const unid = item.unid || item.ucom || 'UN';
                let cstIcms = item.cst_icms_original || item.cst_icms || '000';

                // Resolve cod_item, cfop e cst via de_para_xml (mesmo lookup que xmlInjectorService usa)
                let codItemFinal = item.cod_item;
                let cfop = item.cfop_original || item.cfop || '1102';
                if (cnpjEmitente) {
                    const deparaRes = await dbClient.query(
                        `SELECT cod_interno, novo_cfop, novo_cst FROM de_para_xml
                         WHERE cnpj_emissor = $1 AND cod_produto_xml = $2 LIMIT 1`,
                        [cnpjEmitente, item.cod_item]
                    );
                    if (deparaRes.rowCount > 0) {
                        const dep = deparaRes.rows[0];
                        if (dep.cod_interno) codItemFinal = dep.cod_interno;
                        if (dep.novo_cfop)   cfop = dep.novo_cfop;
                        if (dep.novo_cst)    cstIcms = dep.novo_cst;   // De-Para tem prioridade sobre o CST original
                    } else {
                        // Fallback: converte CFOP da perspectiva do emitente para destinatário (5xxx→1xxx, 6xxx→2xxx)
                        const cfopStr = String(cfop);
                        if (cfopStr.startsWith('5')) cfop = '1' + cfopStr.slice(1);
                        else if (cfopStr.startsWith('6')) cfop = '2' + cfopStr.slice(1);
                    }
                }

                // Combustível/lubrificante com ICMS cobrado anteriormente/monofásico (CST 60/61):
                // PIS/COFINS deve ser CST 04 (monofásica - revenda a alíquota zero), nunca 07 (isenta).
                const _sitIcms = String(cstIcms).slice(-2);
                const _ehMono = (_sitIcms === '60' || _sitIcms === '61');
                const _cstPis    = _ehMono ? '04' : (item.cst_pis    || '07');
                const _cstCofins = _ehMono ? '04' : (item.cst_cofins || '07');
                await dbClient.query(
                    `INSERT INTO documentos_itens_c170
                        (id_documento_c100, num_item, cod_item, qtd, unid, vl_item, cst_icms, cfop, cst_pis, cst_cofins)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                    [c100Id, numItem++, codItemFinal, qtd, unid, vlIt, cstIcms, cfop, _cstPis, _cstCofins]
                );
            }

            // Grava o analítico C190 (extraído do arquivo final) para a tela de auditoria não exibir "SEM C190"
            const c190s = (c.chv_nfe && c190PorChave.get(c.chv_nfe)) || [];
            for (const a of c190s) {
                await dbClient.query(
                    `INSERT INTO documentos_c190
                        (id_documento_c100, cst_icms, cfop, aliq_icms, vl_opr, vl_bc_icms, vl_icms)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [c100Id, a.cst, a.cfop, a.aliq, a.vlOpr, a.vlBc, a.vlIcms]
                );
            }
        }
    } catch (err) {
        logger.warn('sincronizarNotasInjetadas: erro ao sincronizar C100/C170:', err.message);
    } finally {
        dbClient.release();
    }
}

// Regra "seguir o físico": a entrada do LMC pertence ao dia em que os encerrantes/fechamento
// físico (1300/1310 do SPED) registraram a descarga. É comum a NF ser emitida num dia (dt_doc)
// e a mercadoria entrar no tanque em outro (ex.: NF 29/04, descarga 30/04). Se o físico já lançou
// uma entrada de volume equivalente deste produto num dia próximo, a injeção NÃO deve criar um
// lançamento ajustado no dt_doc — isso duplicaria o volume (fantasma na data da NF + real na
// data física). Retorna a data física (YYYY-MM-DD) encontrada, ou null se a entrada não consta
// do físico (caso em que a injeção lança normalmente, pois é entrada genuinamente faltante).
async function fisicoJaRegistrouEntrada(dbClient, id_arquivo, cod_item, dataMov, qcom) {
    const WINDOW_DIAS = 3;                              // tolerância de dias entre emissão e descarga
    const tol = Math.max(5, qcom * 0.01);              // tolerância de volume (1% ou 5 L)
    const r = await dbClient.query(`
        SELECT data_mov, vol_entr
          FROM lmc_movimentacao
         WHERE id_sped_arquivo = $1 AND cod_item = $2 AND num_tanque = '0'
           AND vol_entr > 0
           AND data_mov BETWEEN ($3::date - ($4 || ' days')::interval)
                            AND ($3::date + ($4 || ' days')::interval)
         ORDER BY ABS(EXTRACT(EPOCH FROM (data_mov::date - $3::date)))`,
        [id_arquivo, cod_item, dataMov, WINDOW_DIAS]);
    for (const row of r.rows) {
        if (Math.abs(parseFloat(row.vol_entr) - qcom) <= tol) {
            const d = new Date(row.data_mov);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    return null;
}

async function processarAtualizacaoLmcPosInjecao(poolOrClient, id_arquivo, spedPath, parsedNotes, periodoSped) {
    const combustiveis = detectarCombustivelNfe(parsedNotes);
    if (combustiveis.length === 0) return [];

    const ncmMap = mapNcmCodItemSped(spedPath);
    const atualizados = [];
    const dbClient = await poolOrClient.connect();

    // Calcula data de fallback: primeiro dia do período do SPED
    // Usado quando o XML é de outro mês (ex: NF de jan injetada em fev)
    let dataFallback = null;
    if (periodoSped) {
        const periodo = parsePeriodoSped(periodoSped);
        if (periodo.inicio) {
            const d = periodo.inicio;
            dataFallback = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }

    try {
        await dbClient.query('BEGIN');

        for (const item of combustiveis) {
            if (item.qcom <= 0) continue;
            // Resolve o cod_item ESPECÍFICO via De-Para (cod_interno) — evita atualizar produtos
            // irmãos do mesmo NCM (ex: gasolina comum x aditivada) e códigos crus do XML órfãos.
            let candidatos = [];
            if (item.cnpj_emissor && item.cod_produto_xml) {
                const dpr = await dbClient.query(
                    `SELECT cod_interno FROM de_para_xml
                     WHERE REGEXP_REPLACE(cnpj_emissor,'[^0-9]','','g') = REGEXP_REPLACE($1,'[^0-9]','','g')
                       AND cod_produto_xml = $2 AND cod_interno IS NOT NULL AND cod_interno <> '' LIMIT 1`,
                    [item.cnpj_emissor, item.cod_produto_xml]
                );
                if (dpr.rows.length) candidatos = [dpr.rows[0].cod_interno];
            }
            if (candidatos.length === 0) candidatos = ncmMap.get(item.ncm) || []; // fallback: mapeamento por NCM
            if (candidatos.length === 0) {
                atualizados.push({ ...item, cod_item: null, status: 'ncm_sem_mapeamento' });
                continue;
            }
            for (const cod_item of candidatos) {
                let dataMov = item.dt_doc;
                // Seguir o físico: se a descarga já consta dos encerrantes num dia próximo, não
                // duplica — o LMC mantém a entrada física e a injeção só corrige o documento (C100/C170).
                const diaFisico = await fisicoJaRegistrouEntrada(dbClient, id_arquivo, cod_item, dataMov, item.qcom);
                if (diaFisico) {
                    atualizados.push({ ...item, cod_item, dt_doc: diaFisico, status: 'ja_no_fisico' });
                    continue;
                }
                let ok = await atualizarEntradaLmcXml(dbClient, id_arquivo, cod_item, dataMov);
                // Se a data do XML não existe no LMC (período diferente), tenta o 1º dia do período
                if (!ok && dataFallback && dataFallback !== dataMov) {
                    ok = await atualizarEntradaLmcXml(dbClient, id_arquivo, cod_item, dataFallback);
                    if (ok) dataMov = dataFallback;
                }
                atualizados.push({ ...item, cod_item, dt_doc: dataMov, status: ok ? 'atualizado' : 'data_nao_encontrada' });
            }
        }

        await dbClient.query('COMMIT');
    } catch (e) {
        await safeRollback(dbClient);
        logger.error('[LMC pós-injeção] Erro ao atualizar entradas:', e.message);
    } finally {
        dbClient.release();
    }

    return atualizados;
}
// --- FIM HELPERS LMC PÓS-INJEÇÃO ---

// --- HELPER PARA EXTRAIR DADOS DO XML DA NF-e ---
const extractNfeData = (nfeNode) => {
    if (!nfeNode || !nfeNode.infNFe) return null;
    const inf = nfeNode.infNFe;
    const ide = inf.ide;
    const emit = inf.emit;
    const dest = inf.dest;

    // Tenta múltiplos caminhos para o nó de totais (compatibilidade com diferentes versões de NF-e)
    const totalBlock = inf.total || {};
    const total = totalBlock.ICMSTot || totalBlock.totNFe || totalBlock.Tot || totalBlock || {};

    let detArray = inf.det || [];
    if (!Array.isArray(detArray)) detArray = [detArray];

    const itens = detArray.filter(det => det && det.prod).map(det => {
        const prod = det.prod;
        const imposto = det.imposto;
        
        // Extração básica de impostos
        let cstIcms = '000';
        let vBC = 0, pICMS = 0, vICMS = 0;
        let vBCST = 0, vICMSST = 0;
        let vIPI = 0, cstIPI = '99';

        if (imposto?.ICMS) {
            const icmsNode = Object.values(imposto.ICMS)[0];
            if (icmsNode && typeof icmsNode === 'object') {
                cstIcms = icmsNode.CST || icmsNode.CSOSN || '000';
                vBC = parseValorNFe(icmsNode.vBC);
                pICMS = parseValorNFe(icmsNode.pICMS);
                vICMS = parseValorNFe(icmsNode.vICMS);
                vBCST = parseValorNFe(icmsNode.vBCST);
                vICMSST = parseValorNFe(icmsNode.vICMSST);

                // Novos campos ICMS ST Retido / Mantido
                const vBCSTRet = parseValorNFe(icmsNode.vBCSTRet);
                const vICMSSTRet = parseValorNFe(icmsNode.vICMSSTRet);
                const pST = parseValorNFe(icmsNode.pST || icmsNode.pICMSST);
                const vBCSTDest = parseValorNFe(icmsNode.vBCSTDest);
                const vICMSSTDest = parseValorNFe(icmsNode.vICMSSTDest);

                // Adicionando FCP e FCPST
                const vFCP = parseValorNFe(icmsNode.vFCP);
                const vFCPST = parseValorNFe(icmsNode.vFCPST);
                vICMS += vFCP; // No SPED, vICMS costuma englobar vFCP se for para o mesmo CST
                vICMSST += vFCPST;

                // Armazenamos no objeto do item para uso posterior no C170
                det.extractedIcms = {
                    vBCSTRet,
                    vICMSSTRet,
                    pST,
                    vBCSTDest,
                    vICMSSTDest
                };
            }
        }

        let vBCIPI = 0, pIPI = 0;
        if (imposto?.IPI?.IPITrib) {
            vIPI = parseValorNFe(imposto.IPI.IPITrib.vIPI);
            vBCIPI = parseValorNFe(imposto.IPI.IPITrib.vBC);
            pIPI = parseValorNFe(imposto.IPI.IPITrib.pIPI);
            cstIPI = imposto.IPI.IPITrib.CST || '99';
        }

        const pisNode = imposto?.PIS?.PISAliq || imposto?.PIS?.PISNT || imposto?.PIS?.PISOutr || {};
        const cofinsNode = imposto?.COFINS?.COFINSAliq || imposto?.COFINS?.COFINSNT || imposto?.COFINS?.COFINSOutr || {};

        return {
            num_item: det.$?.nItem || String(detArray.indexOf(det) + 1),
            cod_item: prod.cProd,
            descr_item: prod.xProd,
            ncm: prod.NCM || prod.ncm || '',
            cfop: prod.CFOP,
            ucom: prod.uCom || 'UN',
            qcom: parseValorNFe(prod.qCom),
            vuncom: parseValorNFe(prod.vUnCom),
            vprod: parseValorNFe(prod.vProd),
            vdesc: parseValorNFe(prod.vDesc),
            voutro: parseValorNFe(prod.vOutro),
            vfrete: parseValorNFe(prod.vFrete),
            vseg: parseValorNFe(prod.vSeg),
            vunid: parseValorNFe(prod.vUnCom),
            cst_icms: cstIcms,
            vbc_icms: vBC,
            vicms: vICMS,
            picms: pICMS,
            vbc_icms_st: vBCST,
            vicms_st: vICMSST,
            cst_ipi: cstIPI,
            vbc_ipi: vBCIPI,
            pipi: pIPI,
            vipi: vIPI,
            cst_pis: pisNode.CST || '07',
            vbc_pis: parseValorNFe(pisNode.vBC),
            ppis: parseValorNFe(pisNode.pPIS),
            vpis: parseValorNFe(pisNode.vPIS),
            cst_cofins: cofinsNode.CST || '07',
            vbc_cofins: parseValorNFe(cofinsNode.vBC),
            pcofins: parseValorNFe(cofinsNode.pCOFINS),
            vcofins: parseValorNFe(cofinsNode.vCOFINS),
            vipidevol: parseValorNFe(prod.vIPIDevol || det.impostoDevol?.IPI?.vIPIDevol),
            // Campos adicionais ICMS ST Retido / Mantido
            vbc_icms_st_ret: det.extractedIcms?.vBCSTRet || 0,
            vicms_st_ret: det.extractedIcms?.vICMSSTRet || 0,
            picms_st: det.extractedIcms?.pST || 0,
            vbc_st_dest: det.extractedIcms?.vBCSTDest || 0,
            vicms_st_dest: det.extractedIcms?.vICMSSTDest || 0
        };
    });

    // Calcula vl_doc do bloco total; se vier zerado ou indefinido, soma os itens como fallback
    let vlDocFromTotal = parseValorNFe(total.vNF);
    let vlMercFromTotal = parseValorNFe(total.vProd);

    if (!vlDocFromTotal || vlDocFromTotal === 0) {
        // Fallback: soma itens (vProd - vDesc + vFrete + vSeg + vOutro + vIPI + vICMSST + vFCP + vIPIDevol)
        vlDocFromTotal = itens.reduce((acc, it) => {
            return acc + 
                (it.vprod || 0) - 
                (it.vdesc || 0) + 
                (it.vfrete || 0) + 
                (it.vseg || 0) + 
                (it.voutro || 0) + 
                (it.vipi || 0) + 
                (it.vicms_st || 0) +
                (it.vipidevol || 0);
        }, 0);
        console.warn(`[extractNfeData] vl_doc do bloco total era 0 ou ausente. Calculado via soma de itens: ${vlDocFromTotal.toFixed(2)}`);
    }
    if (!vlMercFromTotal || vlMercFromTotal === 0) {
        vlMercFromTotal = itens.reduce((acc, it) => acc + it.vprod, 0);
    }

    return {
        emitente: {
            cnpj: emit.CNPJ || emit.CPF,
            nome: emit.xNome,
            ie: emit.IE,
            cod_mun: emit.enderEmit?.cMun,
            x_lgr: emit.enderEmit?.xLgr || '',
            nro: emit.enderEmit?.nro || '',
            x_cpl: emit.enderEmit?.xCpl || '',
            x_bairro: emit.enderEmit?.xBairro || ''
        },
        destinatario: {
            cnpj: dest?.CNPJ || dest?.CPF,
            nome: dest?.xNome
        },
        c100: {
            chv_nfe: inf.$.Id?.replace('NFe', ''),
            num_doc: ide.nNF,
            serie: ide.serie,
            mod: ide.mod || '55',
            dt_doc: (ide.dhEmi || ide.dEmi) ? (ide.dhEmi || ide.dEmi).substring(0, 10) : '',
            dt_e_s: (ide.dhSaiEnt || ide.dSaiEnt) ? (ide.dhSaiEnt || ide.dSaiEnt).substring(0, 10) : ((ide.dhEmi || ide.dEmi) ? (ide.dhEmi || ide.dEmi).substring(0, 10) : ''),
            vl_doc: vlDocFromTotal,
            vl_merc: vlMercFromTotal,
            vl_desc: parseValorNFe(total.vDesc),
            vl_outros: parseValorNFe(total.vOutro),
            vl_frete: parseValorNFe(total.vFrete),
            vl_seguro: parseValorNFe(total.vSeg),
            vl_bc_icms: parseValorNFe(total.vBC),
            vl_icms: parseValorNFe(total.vICMS),
            vl_bc_st: parseValorNFe(total.vBCST),
            vl_icms_st: parseValorNFe(total.vST),
            vl_ipi: parseValorNFe(total.vIPI),
            vl_pis: parseValorNFe(total.vPIS),
            vl_cofins: parseValorNFe(total.vCOFINS),
            ind_pgto: ide.indPag || '0', 
            ind_emit: '1', 
            ind_oper: '0', 
            cod_sit: '00'
        },
        itens
    };
};

// --- ANALISAR ITENS DOS XMLS (PRÉ-INJEÇÃO) ---
app.post('/api/xml-injector/analyze-items', authMiddleware, uploadXml.array('xmlFiles', 200), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send({ message: 'Nenhum arquivo XML enviado.' });
    }

    try {
        const parsedNotes = [];
        const parser = new xml2js.Parser({ explicitArray: false });

        for (const file of req.files) {
            try {
                const xmlData = fs.readFileSync(file.path, 'utf-8');
                const result = await parser.parseStringPromise(xmlData);
                if (!result) continue;

                const nfeNode = result.nfeProc ? result.nfeProc.NFe : result.NFe;
                if (!nfeNode) continue;
                
                const notaData = extractNfeData(nfeNode);
                if (notaData) {
                    notaData.arquivo = file.originalname;
                    parsedNotes.push(notaData);
                }
            } catch (err) {
                console.error(`Erro ao processar arquivo ${file.originalname}:`, err);
            } finally {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
        }

        const { transformarNotasEmSped } = require('./services/xmlInjectorService');
        const userCfopPadrao = req.body.cfop_padrao || '1102';
        const idEmpresa = req.body.id_empresa;
        const result = await transformarNotasEmSped(pool, parsedNotes, { 
            userCfop: userCfopPadrao, 
            analyzeOnly: true,
            idEmpresa: idEmpresa 
        }); 

        res.json({
            itens: result.itensDetectados,
            totalNotas: parsedNotes.length,
            notas: parsedNotes.map(n => ({
                numero: n.c100.num_doc,
                data: n.c100.dt_doc,
                valor: n.c100.vl_doc,
                arquivo: n.arquivo
            }))
        });

    } catch (error) {
        console.error('Erro na análise de XML:', error);
        res.status(500).json({ message: 'Erro ao analisar arquivos.', error: error.message });
    }
});


// --- SALVAR MAPEAMENTOS EM LOTE (DE-PARA) ---
app.post('/api/xml-injector/save-de-para-batch', authMiddleware, async (req, res) => {
    const { mapeamentos } = req.body;
    if (!mapeamentos || !Array.isArray(mapeamentos)) {
        return res.status(400).json({ error: 'Mapeamentos inválidos.' });
    }

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('BEGIN');
        
        await dbClient.query(`
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS ncm VARCHAR(20);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS cod_interno VARCHAR(60);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS conta_contabil VARCHAR(60);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS aliq_icms NUMERIC(10,4);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS bc_icms_override NUMERIC(15,2);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS cst_pis TEXT;
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS cst_cofins TEXT;
        `);

        const query = `
            INSERT INTO de_para_xml (id_empresa, cnpj_emissor, cod_produto_xml, novo_cfop, novo_cst, descricao_produto, ncm, cod_interno, conta_contabil, aliq_icms, bc_icms_override, cst_pis, cst_cofins)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id_empresa, cnpj_emissor, cod_produto_xml)
            DO UPDATE SET
                novo_cfop = EXCLUDED.novo_cfop,
                novo_cst = EXCLUDED.novo_cst,
                descricao_produto = EXCLUDED.descricao_produto,
                ncm = COALESCE(NULLIF(EXCLUDED.ncm, ''), de_para_xml.ncm),
                cod_interno = COALESCE(NULLIF(EXCLUDED.cod_interno, ''), de_para_xml.cod_interno),
                conta_contabil = COALESCE(NULLIF(EXCLUDED.conta_contabil, ''), de_para_xml.conta_contabil),
                aliq_icms = COALESCE(EXCLUDED.aliq_icms, de_para_xml.aliq_icms),
                bc_icms_override = COALESCE(EXCLUDED.bc_icms_override, de_para_xml.bc_icms_override),
                cst_pis = COALESCE(NULLIF(EXCLUDED.cst_pis, ''), de_para_xml.cst_pis),
                cst_cofins = COALESCE(NULLIF(EXCLUDED.cst_cofins, ''), de_para_xml.cst_cofins),
                updated_at = CURRENT_TIMESTAMP
        `;

        for (const m of mapeamentos) {
            await dbClient.query(query, [
                m.id_empresa,
                m.cnpj_emissor,
                m.cod_produto_xml,
                m.novo_cfop,
                m.novo_cst,
                m.descricao_produto,
                m.ncm,
                m.cod_interno,
                m.conta_contabil,
                m.aliq_icms || null,
                m.bc_icms_override || null,
                m.cst_pis || null,
                m.cst_cofins || null
            ]);
        }

        await dbClient.query('COMMIT');
        res.json({ success: true, count: mapeamentos.length });
    } catch (err) {
        await safeRollback(dbClient);
        console.error('Erro ao salvar batch de-para:', err);
        res.status(500).json({ error: 'Erro ao salvar mapeamentos.' });
    } finally {
        dbClient.release();
    }
});

app.post('/api/xml-injector/parse', authMiddleware, uploadXml.array('xmlFiles', 200), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send({ message: 'Nenhum arquivo XML enviado.' });
    }

    const parser = new xml2js.Parser({ explicitArray: false });
    const parsedNotes = [];
    const erros = [];
    const xmlsBrutos = []; // guarda o XML cru p/ persistir a NFe completa (viewer "Cálculo do Imposto")

    for (const file of req.files) {
        try {
            const xmlData = fs.readFileSync(file.path, 'utf-8');
            const result = await parser.parseStringPromise(xmlData);
            const nfeNode = result.nfeProc ? result.nfeProc.NFe : result.NFe;

            const notaData = extractNfeData(nfeNode);
            if (notaData) {
                notaData.arquivo = file.originalname;
                parsedNotes.push(notaData);
                xmlsBrutos.push(xmlData);
            } else {
                erros.push(`Arquivo ${file.originalname} não é um XML de NF-e válido.`);
            }
        } catch (e) {
            erros.push(`Falha no arquivo ${file.originalname}: ${e.message}`);
        } finally {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
    }

    if (parsedNotes.length === 0) {
        return res.status(400).json({ message: 'Nenhuma nota válida encontrada nos XMLs.', erros });
    }

    // Persiste o XML/parse completo de cada NFe (best-effort, não bloqueia a injeção)
    Promise.allSettled(xmlsBrutos.map(x => salvarNfeCompleta(pool, x))).catch(() => {});

    try {
        const { transformarNotasEmSped } = require('./services/xmlInjectorService');
        const idSpedBase = req.body.id_sped_arquivo;
        let chavesExistentes = [];
        let chavesParaSubstituir = [];
        const forceReplace = req.body.forceReplace === 'true' || req.body.forceReplace === true;
        
        let spedBaseObj = null;
        let fullSpedPath = null;

        if (idSpedBase) {
            try {
                // Obter caminho do arquivo primeiro
                const fileQuery = await pool.query('SELECT nome_arquivo, caminho_arquivo, cnpj_empresa, periodo_apuracao FROM sped_arquivos WHERE id = $1', [idSpedBase]);

                if (fileQuery.rows.length === 0) {
                    return res.status(404).json({ message: 'Arquivo SPED Base não encontrado no banco de dados.' });
                }

                spedBaseObj = fileQuery.rows[0];
                fullSpedPath = spedBaseObj.caminho_arquivo;
                try {
                    const parsed = JSON.parse(spedBaseObj.caminho_arquivo);
                    if (parsed && typeof parsed === 'object') {
                        fullSpedPath = Object.values(parsed)[0];
                    }
                } catch (e) {
                    fullSpedPath = spedBaseObj.caminho_arquivo;
                }

                if (!fs.existsSync(fullSpedPath)) {
                    return res.status(404).json({ message: 'O arquivo SPED Físico não foi localizado no disco do servidor para validação.' });
                }

                // Lê o arquivo para buscar as chaves existentes e evitar duplicadas
                const fileContent = fs.readFileSync(fullSpedPath, 'latin1');
                const lines = fileContent.split(/\r?\n/);
                const mapKeys = new Map();
                for (const line of lines) {
                    if (line.startsWith('|C100|')) {
                        const params = line.split('|');
                        const chave = params[9];
                        if (chave) {
                            mapKeys.set(chave, {
                                chv_nfe: chave,
                                num_doc: params[8],
                                dt_doc: params[10],   // data da NF (DDMMAAAA)
                                dt_e_s: params[11],   // data de entrada/saída (DDMMAAAA)
                                vl_doc: params[12]
                            });
                        }
                    }
                }
                
                chavesExistentes = Array.from(mapKeys.keys());

                if (!forceReplace && !req.body.analyzeOnly) {
                    const duplicadas = [];
                    for (const nota of parsedNotes) {
                        const chaveXML = nota.c100?.chv_nfe;
                        if (chaveXML && mapKeys.has(chaveXML)) {
                            const found = mapKeys.get(chaveXML);
                            duplicadas.push({
                                chv_nfe: found.chv_nfe,
                                num_doc: found.num_doc,
                                dt_doc: found.dt_doc,        // data da NF que JÁ está no SPED
                                dt_e_s: found.dt_e_s,        // data de entrada que JÁ está no SPED
                                valor: found.vl_doc,         // valor que JÁ está no SPED
                                valor_novo: nota.c100?.vl_doc // valor do XML (para comparação)
                            });
                        }
                    }

                    const isPularDuplicados = req.body.pular_duplicados === 'true' || req.body.pular_duplicados === true;

                    if (duplicadas.length > 0 && !isPularDuplicados) {
                        return res.status(409).json({
                            message: 'Atenção: A(s) seguinte(s) Nota(s) Fiscais já existem neste SPED e estão prontas para serem substituídas:',
                            duplicadas
                        });
                    }
                } else if (forceReplace) {
                    // Collect which keys we are actually going to replace
                    for (const nota of parsedNotes) {
                        const chaveXML = nota.c100?.chv_nfe;
                        if (chaveXML && mapKeys.has(chaveXML)) {
                            chavesParaSubstituir.push(chaveXML);
                        }
                    }
                }
            } catch (errKey) {
                console.error('Erro ao buscar chaves existentes:', errKey);
            }
        }

        // --- VALIDAÇÃO DE PERÍODO ---
        if (spedBaseObj && !req.body.analyzeOnly) {
            const forcePeriodo = req.body.force_periodo === 'true';
            const itensVal = parsedNotes.map(nota => ({
                arquivo: nota.arquivo,
                cnpjDest: nota.destinatario?.cnpj,
                dtDoc: nota.c100?.dt_doc
            }));
            const { bloqueados, avisos: avisosP } = validarXmls(itensVal, spedBaseObj.cnpj_empresa, spedBaseObj.periodo_apuracao, forcePeriodo);
            if (bloqueados.length > 0) {
                return res.status(422).json({
                    tipo: 'cnpj_divergente',
                    message: `${bloqueados.length} XML(s) com CNPJ destinatário diferente da empresa do SPED.`,
                    bloqueados
                });
            }
            if (avisosP.length > 0) {
                return res.status(422).json({
                    tipo: 'periodo_divergente',
                    message: `${avisosP.length} XML(s) com data fora do período auditado.`,
                    periodo_sped: spedBaseObj.periodo_apuracao,
                    avisos: avisosP
                });
            }
        }
        // --- FIM VALIDAÇÃO DE PERÍODO ---

        const options = {
            userCfop: req.body.cfop_padrao || '1102',
            forcarUsoConsumo: req.body.forcar_uso_consumo === 'true' || req.body.forcar_uso_consumo === true || req.body.forceCst040 === 'true' || req.body.forceCst040 === true,
            ajusteIpi: req.body.ajuste_ipi === 'true' || req.body.ajuste_ipi === true,
            ajusteIcms: req.body.ajuste_icms === 'true' || req.body.ajuste_icms === true,
            itemMapping: req.body.item_mapping ? JSON.parse(req.body.item_mapping) : [],
            analyzeOnly: req.body.analyzeOnly === 'true' || req.body.analyzeOnly === true,
            pularDuplicados: (!forceReplace && (req.body.pular_duplicados === 'true' || req.body.pular_duplicados === true)),
            chavesExistentes,
            idEmpresa: req.body.id_empresa
        };

        const spedDataPayload = await transformarNotasEmSped(pool, parsedNotes, options);

        if (idSpedBase && fullSpedPath && spedBaseObj) {
            try {
                const { injetarXmlEPersistir } = require('./services/spedCostureiraService');
                const finalSpedString = await injetarXmlEPersistir(fullSpedPath, spedDataPayload, chavesParaSubstituir);

                fs.writeFileSync(fullSpedPath, finalSpedString, { encoding: 'latin1' });
                const totalLinhas = finalSpedString.split('\n').length;

                // Sincroniza C100/C170 no banco PRIMEIRO — o LMC abaixo soma a entrada a partir do C170 gravado.
                await sincronizarNotasInjetadas(pool, idSpedBase, parsedNotes, fullSpedPath);

                // Atualiza entradas de combustível no LMC (lê o C170 já sincronizado)
                const lmcAtualizados = await processarAtualizacaoLmcPosInjecao(pool, idSpedBase, fullSpedPath, parsedNotes, spedBaseObj?.periodo_apuracao);

                return res.json({
                    message: 'Injeção concluída com sucesso.',
                    detalhes: {
                        sped_id: idSpedBase,
                        nome_arquivo: spedBaseObj.nome_arquivo,
                        periodo: spedBaseObj.periodo_apuracao,
                        total_xml_injetados: parsedNotes.length,
                        total_linhas_sped: totalLinhas,
                        estatisticas: spedDataPayload.relatorio,
                        lmc_atualizados: lmcAtualizados
                    },
                    erros
                });
            } catch (err) {
                console.error('Erro na Injeção Física:', err);
                return res.status(500).json({ message: "Erro ao injetar no arquivo físico.", error: err.message });
            }
        }

        // Senão, retorna apenas o payload processado
        res.json({
            bloco0: spedDataPayload.bloco0,
            blocoC: spedDataPayload.blocoC,
            itensDetectados: spedDataPayload.itensDetectados,
            gerencial: spedDataPayload.gerencial,
            relatorio: spedDataPayload.relatorio,
            erros
        });

    } catch (err) {
        console.error('Erro ao processar SPED:', err);
        res.status(500).json({ message: 'Erro no processamento SPED Fiscal.' });
    }
});

// --- INJEÇÃO EM GRUPOS (múltiplos CFOPs em uma única requisição, sem loop frontend) ---
app.post('/api/injetar-grupos', authMiddleware, uploadXml.any(), async (req, res) => {
    let gruposConfig;
    try {
        gruposConfig = JSON.parse(req.body.grupos_config || '[]');
    } catch (e) {
        return res.status(400).json({ message: 'grupos_config inválido.' });
    }

    const idSpedBase = req.body.id_sped_arquivo;
    if (!idSpedBase) return res.status(400).json({ message: 'id_sped_arquivo é obrigatório.' });
    if (gruposConfig.length === 0) return res.status(400).json({ message: 'Nenhum grupo configurado.' });

    const allTempFiles = req.files || [];
    const limparTemps = () => {
        allTempFiles.forEach(f => { try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {} });
    };

    try {
        const fileQuery = await pool.query(
            'SELECT nome_arquivo, caminho_arquivo, cnpj_empresa, periodo_apuracao FROM sped_arquivos WHERE id = $1',
            [idSpedBase]
        );

        if (fileQuery.rows.length === 0) { limparTemps(); return res.status(404).json({ message: 'Arquivo SPED não encontrado.' }); }

        const spedBaseObj = fileQuery.rows[0];
        let fullSpedPath = spedBaseObj.caminho_arquivo;
        try {
            const parsed = JSON.parse(spedBaseObj.caminho_arquivo);
            if (parsed && typeof parsed === 'object') fullSpedPath = Object.values(parsed)[0];
        } catch (e) {}

        if (!fs.existsSync(fullSpedPath)) {
            limparTemps();
            return res.status(404).json({ message: 'Arquivo SPED físico não encontrado no disco.' });
        }

        const { transformarNotasEmSped } = require('./services/xmlInjectorService');
        const { costurarEAssinar, costurarEAssinarLinhas } = require('./services/spedCostureiraService');
        const parser = new xml2js.Parser({ explicitArray: false });

        // Carrega chaves já existentes no SPED para controle de duplicatas entre grupos
        const chavesExistentes = new Set();
        for (const line of fs.readFileSync(fullSpedPath, 'latin1').split(/\r?\n/)) {
            if (line.startsWith('|C100|')) {
                const chave = line.split('|')[9];
                if (chave) chavesExistentes.add(chave);
            }
        }

        // --- VALIDAÇÃO DE CNPJ E PERÍODO ---
        const forcePeriodo = req.body.force_periodo === 'true';
        const { cnpj_empresa, periodo_apuracao } = spedBaseObj;
        const itensValidacao = [];
        const xmlsBrutosGrupos = []; // XML cru das NFes p/ persistir a NFe completa (viewer)
        const parser2 = new xml2js.Parser({ explicitArray: false });
        for (const f of allTempFiles) {
            try {
                const xmlData = fs.readFileSync(f.path, 'utf-8');
                const result = await parser2.parseStringPromise(xmlData);
                const nfeNode = result.nfeProc ? result.nfeProc.NFe : result.NFe;
                const nota = extractNfeData(nfeNode);
                if (nota) {
                    itensValidacao.push({
                        arquivo: f.originalname,
                        cnpjDest: nota.destinatario?.cnpj,
                        dtDoc: nota.c100?.dt_doc
                    });
                    xmlsBrutosGrupos.push(xmlData);
                }
            } catch (_) {}
        }
        const { bloqueados, avisos } = validarXmls(itensValidacao, cnpj_empresa, periodo_apuracao, forcePeriodo);
        if (bloqueados.length > 0) {
            limparTemps();
            return res.status(422).json({
                tipo: 'cnpj_invalido',
                message: `${bloqueados.length} XML(s) rejeitado(s): CNPJ do destinatário não corresponde ao CNPJ do SPED (${limparCnpjStr(cnpj_empresa)}).`,
                bloqueados
            });
        }
        if (avisos.length > 0) {
            limparTemps();
            return res.status(422).json({
                tipo: 'periodo_divergente',
                message: `${avisos.length} XML(s) com data fora do período auditado.`,
                periodo_sped: periodo_apuracao,
                avisos
            });
        }
        // --- FIM VALIDAÇÃO ---

        // Persiste o XML/parse completo de cada NFe (best-effort, não bloqueia a injeção)
        Promise.allSettled(xmlsBrutosGrupos.map(x => salvarNfeCompleta(pool, x))).catch(() => {});

        const resultadosGrupos = [];
        let totalInjetados = 0;
        let linhasAtuais = null; // array de linhas em memória, atualizado a cada grupo
        const todasNotasInjetadas = []; // acumula notas de todos os grupos para LMC

        for (let i = 0; i < gruposConfig.length; i++) {
            const config = gruposConfig[i];
            const grupoFiles = allTempFiles.filter(f => f.fieldname === `grupo_${i}_xmlFiles`);

            if (grupoFiles.length === 0) {
                resultadosGrupos.push({ grupo: i + 1, status: 'sem_arquivos', injetados: 0 });
                continue;
            }

            const parsedNotes = [];
            const errosParseGrupo = [];
            for (const file of grupoFiles) {
                try {
                    const xmlData = fs.readFileSync(file.path, 'utf-8');
                    const result = await parser.parseStringPromise(xmlData);
                    const nfeNode = result.nfeProc ? result.nfeProc.NFe : result.NFe;
                    const notaData = extractNfeData(nfeNode);
                    if (notaData) { notaData.arquivo = file.originalname; parsedNotes.push(notaData); }
                    else { errosParseGrupo.push(`${file.originalname}: estrutura de NF-e não reconhecida`); }
                } catch (e) {
                    errosParseGrupo.push(`${file.originalname}: ${e.message}`);
                    logger.warn(`[injetar-grupos] Falha ao parsear XML do grupo ${i + 1}: ${e.message}`);
                }
            }

            if (parsedNotes.length === 0) {
                resultadosGrupos.push({ grupo: i + 1, status: 'nenhuma_nota_valida', injetados: 0, erros: errosParseGrupo, arquivos_enviados: grupoFiles.length });
                continue;
            }

            // Identifica duplicatas para este grupo
            const duplicatasDoGrupo = parsedNotes.filter(n => chavesExistentes.has(n.c100?.chv_nfe));
            const duplicadasGrupo = duplicatasDoGrupo.length;

            // forceReplace: substitui as NFs duplicadas (remove do SPED e reinjecta com novo CFOP)
            const forceReplace = config.forceReplace === true || config.forceReplace === 'true';
            const chavesParaSubstituirGrupo = forceReplace
                ? duplicatasDoGrupo.map(n => n.c100?.chv_nfe).filter(Boolean)
                : [];

            // Idempotência por padrão: NUNCA injeta C100 cuja chave já existe no SPED base.
            // (Antes, com pularDuplicados desligado, reinjetar a mesma nota gerava C100 duplicado.)
            // forceReplace remove a antiga (via chavesParaSubstituirGrupo) e reinjeta com o novo CFOP.
            const notasParaInjetar = forceReplace
                ? parsedNotes
                : parsedNotes.filter(n => !chavesExistentes.has(n.c100?.chv_nfe));

            if (notasParaInjetar.length === 0) {
                resultadosGrupos.push({ grupo: i + 1, status: 'todas_duplicadas', injetados: 0, duplicadas: duplicadasGrupo, dica: 'Ative "Substituir Existentes" no grupo para reinjetar com o novo CFOP.' });
                continue;
            }

            const options = {
                userCfop: config.cfop || '1102',
                forceUserCfop: true, // CFOP do grupo tem prioridade sobre qualquer mapeamento De-Para
                forcarUsoConsumo: config.forcarUsoConsumo === true,
                ajusteIpi: config.ajusteIpi === true,
                ajusteIcms: config.ajusteIcms === true,
                itemMapping: [],
                pularDuplicados: false,
                chavesExistentes: Array.from(chavesExistentes),
                idEmpresa: req.body.id_empresa
            };

            const spedDataPayload = await transformarNotasEmSped(pool, notasParaInjetar, options);

            if (linhasAtuais === null) {
                // Primeiro grupo: lê do disco
                linhasAtuais = await costurarEAssinar(fullSpedPath, spedDataPayload.bloco0, spedDataPayload.blocoC, chavesParaSubstituirGrupo);
            } else {
                // Grupos seguintes: opera em memória
                linhasAtuais = await costurarEAssinarLinhas(linhasAtuais, spedDataPayload.bloco0, spedDataPayload.blocoC, chavesParaSubstituirGrupo);
            }

            // Registra chaves injetadas para controle de duplicatas nos próximos grupos
            notasParaInjetar.forEach(n => { if (n.c100?.chv_nfe) chavesExistentes.add(n.c100.chv_nfe); });
            todasNotasInjetadas.push(...notasParaInjetar);
            totalInjetados += notasParaInjetar.length;
            resultadosGrupos.push({
                grupo: i + 1,
                status: 'ok',
                injetados: notasParaInjetar.length,
                duplicadas_puladas: forceReplace ? 0 : duplicadasGrupo,
                erros_parse: errosParseGrupo.length ? errosParseGrupo : undefined
            });
        }

        if (linhasAtuais === null) {
            limparTemps();
            const todasDuplicadas = resultadosGrupos.every(g => g.status === 'todas_duplicadas');
            const mensagem = todasDuplicadas
                ? 'Todos os XMLs já existem no SPED. Desative "Pular Duplicadas" no grupo ou use "Forçar Substituição" no modo de injeção normal.'
                : 'Nenhum grupo com XMLs válidos foi processado.';
            return res.status(400).json({ message: mensagem, grupos: resultadosGrupos });
        }

        // Grava resultado final no disco — única escrita, independente do número de grupos
        const finalStr = linhasAtuais.join('\r\n') + '\r\n';
        fs.writeFileSync(fullSpedPath, finalStr, { encoding: 'latin1' });

        // Sincroniza C100/C170 no banco PRIMEIRO — o LMC abaixo soma a entrada a partir do C170 gravado.
        await sincronizarNotasInjetadas(pool, idSpedBase, todasNotasInjetadas, fullSpedPath);

        // Atualiza entradas de combustível no LMC (lê o C170 já sincronizado)
        const lmcAtualizados = await processarAtualizacaoLmcPosInjecao(pool, idSpedBase, fullSpedPath, todasNotasInjetadas, spedBaseObj.periodo_apuracao);

        limparTemps();
        return res.json({
            message: 'Grupos injetados com sucesso.',
            detalhes: {
                sped_id: idSpedBase,
                nome_arquivo: spedBaseObj.nome_arquivo,
                total_xml_injetados: totalInjetados,
                total_linhas_sped: linhasAtuais.length,
                grupos: resultadosGrupos,
                lmc_atualizados: lmcAtualizados
            }
        });

    } catch (err) {
        limparTemps();
        console.error('Erro em /api/injetar-grupos:', err);
        res.status(500).json({ message: 'Erro ao processar grupos de injeção.', error: err.message });
    }
});

// --- NOVO: GERAÇÃO DE SPED COMPLETO (STANDALONE) APENAS COM XMLs ---
app.post('/api/xml-injector/standalone', authMiddleware, uploadXml.array('xmlFiles', 200), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send({ message: 'Nenhum arquivo XML enviado.' });
    }

    try {
        let companyCnpj = "";
        if (req.body.id_empresa) {
            try {
                const empRes = await pool.query('SELECT cnpj FROM empresas WHERE id = $1', [req.body.id_empresa]);
                if (empRes.rows.length > 0) companyCnpj = empRes.rows[0].cnpj.replace(/\D/g, '');
            } catch (err) {
                logger.error('Erro ao buscar CNPJ da empresa:', err);
            }
        }

        const parser = new xml2js.Parser({ explicitArray: false });
        const parsedNotes = [];
        const erros = [];

        for (const file of req.files) {
            try {
                const xmlData = fs.readFileSync(file.path, 'utf-8');
                const result = await parser.parseStringPromise(xmlData);
                const nfeNode = result.nfeProc ? result.nfeProc.NFe : result.NFe;
                if (!nfeNode || !nfeNode.infNFe) {
                    erros.push(`Arquivo ${file.originalname} não é um XML de NF-e válido.`);
                    continue;
                }
                const inf = nfeNode.infNFe;
                const emit = inf.emit;
                const emitente = {
                    cnpj: emit.CNPJ,
                    nome: emit.xNome,
                    ie: emit.IE,
                    cod_mun: emit.enderEmit ? emit.enderEmit.cMun : ''
                };
                const ide = inf.ide;
                const tpNF = (ide.tpNF || '0').toString();
                const emitCnpj = (emit.CNPJ || '').replace(/\D/g, '');
                let ind_oper, ind_emit;

                if (companyCnpj && emitCnpj !== companyCnpj) {
                    ind_oper = '0';
                    ind_emit = '1';
                } else {
                    ind_oper = tpNF;
                    ind_emit = '0';
                }

                const c100 = {
                    chv_nfe: (inf.$.Id || '').replace('NFe', ''),
                    ind_oper,
                    ind_emit,
                    cod_mod: ide.mod,
                    cod_sit: '00',
                    num_doc: ide.nNF,
                    serie: ide.serie,
                    dt_doc: ide.dhEmi.substring(0, 10),
                    dt_e_s: ide.dhEmi.substring(0, 10),
                    vl_doc: inf.total.ICMSTot.vNF,
                    ind_frt: ide.modFrete,
                    vl_merc: inf.total.ICMSTot.vProd,
                    vl_desc: inf.total.ICMSTot.vDesc
                };
                let detArray = inf.det;
                if (!Array.isArray(detArray)) detArray = [detArray];
                const itens = detArray.map((det, idx) => {
                    const prod = det.prod;
                    const imposto = det.imposto;
                    let cstOringinal = '';
                    if (imposto?.ICMS) {
                        const icmsNode = Object.values(imposto.ICMS)[0];
                        cstOringinal = (icmsNode.CST) ? icmsNode.CST : ((icmsNode.CSOSN) ? icmsNode.CSOSN : '000');
                    }
                    return {
                        num_item: det.$?.nItem || String(idx + 1),
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
                parsedNotes.push({ arquivo: file.originalname, emitente, c100, itens });
            } catch (e) {
                erros.push(`Falha na leitura do arquivo ${file.originalname}`);
            } finally {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
        }

        const { transformarNotasEmSped } = require('./services/xmlInjectorService');
        const options = {
            userCfop: req.body.cfop_padrao || '1102',
            forcarUsoConsumo: req.body.forcar_uso_consumo === 'true' || req.body.forcar_uso_consumo === true,
            ajusteIpi: req.body.ajuste_ipi === 'true' || req.body.ajuste_ipi === true,
            ajusteIcms: req.body.ajuste_icms === 'true' || req.body.ajuste_icms === true,
            itemMapping: req.body.item_mapping ? JSON.parse(req.body.item_mapping) : [],
            idEmpresa: req.body.id_empresa
        };
        
        const spedDataPayload = await transformarNotasEmSped(pool, parsedNotes, options);
        
        const { gerarSpedFragmentado } = require('./services/spedCostureiraService');
        const finalSpedString = gerarSpedFragmentado(spedDataPayload.bloco0, spedDataPayload.blocoC);

        res.setHeader('Content-Type', 'text/plain; charset=latin1');
        res.setHeader('Content-Disposition', `attachment; filename=sped_standalone_${new Date().toISOString().split('T')[0]}.txt`);
        return res.status(200).send(Buffer.from(finalSpedString, 'latin1'));

    } catch (error) {
        logger.error(`Erro na geração do SPED standalone:`, error);
        return res.status(500).json({ message: "Erro interno na geração do arquivo standalone.", error: error.message });
    }
});

// --- ROTA DE ANÁLISE COM MOTOR REAL (PRESENTE) ---
app.post('/api/analisar/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de análise com ID inválido: ${req.params.id}`);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    logger.info(`Iniciando análise REAL para o arquivo ID: ${arquivoId}`);
    await acquireHeavySlot();
    const dbClient = await safeConnect(res);
    if (!dbClient) { releaseHeavySlot(); return; }
    try {
        await dbClient.query('BEGIN');
        // Limita cada query a 30s para evitar congelamento do event loop em SPEDs grandes
        await dbClient.query('SET LOCAL statement_timeout = 30000');
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
            LEFT JOIN lmc_tanques_config cfg ON REGEXP_REPLACE(cfg.cnpj, '[^0-9]', '', 'g') = REGEXP_REPLACE(arq.cnpj_empresa, '[^0-9]', '', 'g') AND cfg.cod_item = lmc.cod_item
            WHERE lmc.id_sped_arquivo = $1
              AND cfg.capacidade IS NOT NULL
              AND cfg.capacidade > 0
              AND COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) > cfg.capacidade;
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

        // REGRA 3: Variação de Estoque > 0,60% (base: Fechamento Físico)
        const variacaoQuery = `
            SELECT
                lmc.cod_item, COALESCE(p.descr_item, lmc.cod_item) as nome_combustivel,
                lmc.num_tanque, lmc.data_mov,
                COALESCE(lmc.vol_escr_ajustado, lmc.estq_escr) as estq_escr,
                COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) as fech_fisico,
                (COALESCE(lmc.estq_abert_ajustado, lmc.estq_abert) + COALESCE(lmc.vol_entr_ajustado, lmc.vol_entr)) as vol_disponivel,
                COALESCE(lmc.vol_saidas_ajustado, lmc.vol_saidas) as vol_saidas,
                COALESCE(lmc.estq_abert_ajustado, lmc.estq_abert) as estq_abert
            FROM lmc_movimentacao lmc
            LEFT JOIN sped_produtos p ON lmc.id_sped_arquivo = p.id_sped_arquivo AND lmc.cod_item = p.cod_item
            WHERE lmc.id_sped_arquivo = $1
              AND COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico) > 0
              AND (ABS(COALESCE(lmc.vol_escr_ajustado, lmc.estq_escr) - COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico)) / COALESCE(lmc.fech_fisico_ajustado, lmc.fech_fisico)) > 0.006;
        `;
        const resVariacao = await dbClient.query(variacaoQuery, [arquivoId]);
        for (const row of resVariacao.rows) {
            const estqEscrNum = parseFloat(row.estq_escr);
            const fechFisicoNum = parseFloat(row.fech_fisico);
            const variacao = fechFisicoNum - estqEscrNum;
            const percentual = (Math.abs(variacao) / fechFisicoNum) * 100;
            const limiteLitros = fechFisicoNum * 0.006;
            const excessoLitros = Math.abs(variacao) - limiteLitros;
            erros.push({
                tipo_erro: 'CRITICAL',
                regra_id: 'CRIT-1310-02',
                titulo_erro: 'Variação de Estoque Acima da Tolerância (0,60%)',
                descricao_erro: `Combustível: **${row.nome_combustivel}** (Tanque ${row.num_tanque}) em ${new Date(row.data_mov).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}: Variação de **${percentual.toFixed(2)}%** sobre o fechamento físico excede o limite ANP. Excesso: ${excessoLitros.toFixed(3)} L acima do permitido (${limiteLitros.toFixed(3)} L).`,
                sugestao_correcao: 'Esta é uma infração grave. Verificar medições, possíveis vazamentos ou aferições e justificar a perda/ganho imediatamente.',
                linha_arquivo: 0,
                conteudo_linha: `Est. Abertura: ${parseFloat(row.estq_abert).toFixed(3)} L | Vol. Disponível: ${parseFloat(row.vol_disponivel).toFixed(3)} L | Saídas: ${parseFloat(row.vol_saidas).toFixed(3)} L | Escritural: ${estqEscrNum.toFixed(3)} L | Fech. Físico: ${fechFisicoNum.toFixed(3)} L | Perda/Ganho: ${variacao.toFixed(3)} L | % ANP: ${percentual.toFixed(4)}% | Limite: ${limiteLitros.toFixed(3)} L`,
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
        const PALAVRAS_COMBUSTIVEL = ['GASOLINA', 'ETANOL', 'ÁLCOOL', 'ALCOOL', 'DIESEL', 'GNV', 'GLP', 'QUEROSENE', 'BIODIESEL'];
        for (const row of resNotasVsLmc.rows) {
            const nomeProduto = (row.nome_combustivel || '').toUpperCase();
            if (!PALAVRAS_COMBUSTIVEL.some(k => nomeProduto.includes(k))) continue;
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

        // REGRAS 12-14: Validacao de encerrantes por bico (Registro 1320) — usa sped_1320 (1320 cru importado)
        try {
            const r1320 = await dbClient.query(
                `SELECT data_mov, cod_item, num_tanque, num_bico,
                        COALESCE(enc_ini_corrigido, enc_ini) AS enc_ini,
                        COALESCE(enc_fin_corrigido, enc_fin) AS enc_fin,
                        COALESCE(qtd_af_corrigido, qtd_af) AS qtd_af,
                        CASE WHEN corrigido
                             THEN (COALESCE(enc_fin_corrigido,enc_fin) - COALESCE(enc_ini_corrigido,enc_ini) - COALESCE(qtd_af_corrigido,0))
                             ELSE vol_bico END AS vol_bico
                 FROM sped_1320 WHERE id_sped_arquivo = $1
                 ORDER BY cod_item, num_bico, data_mov`, [arquivoId]);
            const bicos1320 = r1320.rows;
            const fmtD = (d) => d ? (d instanceof Date ? d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : String(d)) : '';
            const n3 = (v) => Number(v || 0).toFixed(3);

            // CRIT-1320-01: volume negativo no bico
            for (const b of bicos1320) {
                if (Number(b.vol_bico) < -0.001) {
                    erros.push({
                        tipo_erro: 'CRITICAL', regra_id: 'CRIT-1320-01',
                        titulo_erro: 'Volume negativo no bico (1320)',
                        descricao_erro: `O bico **${b.num_bico}** (produto ${b.cod_item}, tanque ${b.num_tanque || '-'}) apresentou VOLUME NEGATIVO de ${n3(b.vol_bico)} L em ${fmtD(b.data_mov)}: encerrante final (${n3(b.enc_fin)}) menor que inicial (${n3(b.enc_ini)}) + aferição (${n3(b.qtd_af)}).`,
                        sugestao_correcao: 'Revise as leituras ENC_INI/ENC_FIN e a aferição QTD_AF deste bico no dia.',
                        linha_arquivo: 0,
                        conteudo_linha: `Bico ${b.num_bico} | ENC_INI ${n3(b.enc_ini)} | ENC_FIN ${n3(b.enc_fin)} | AFERI ${n3(b.qtd_af)} | VOL ${n3(b.vol_bico)}`,
                        data_erro: b.data_mov, cod_item_erro: b.cod_item, num_tanque_erro: b.num_tanque
                    });
                }
            }
            // CRIT-1320-02: encerrante nao-continuo entre DIAS CONSECUTIVOS (mesmo produto+bico)
            const _diffDias = (x, y) => Math.round((new Date(y) - new Date(x)) / 86400000);
            for (let i = 1; i < bicos1320.length; i++) {
                const a = bicos1320[i - 1], c = bicos1320[i];
                if (a.cod_item === c.cod_item && a.num_bico === c.num_bico && _diffDias(a.data_mov, c.data_mov) === 1) {
                    const salto = Math.abs(Number(c.enc_ini) - Number(a.enc_fin));
                    if (salto > 0.05) {
                        erros.push({
                            tipo_erro: 'WARNING', regra_id: 'CRIT-1320-02',
                            titulo_erro: 'Encerrante não-contínuo entre dias (1320)',
                            descricao_erro: `O bico **${c.num_bico}** (produto ${c.cod_item}) teve salto de ${n3(salto)} L entre o encerrante final do dia anterior (${n3(a.enc_fin)}) e o inicial do dia ${fmtD(c.data_mov)} (${n3(c.enc_ini)}). O inicial de um dia deve igualar o final do dia anterior.`,
                            sugestao_correcao: 'Corrija a leitura do encerrante inicial para dar continuidade ao bico.',
                            linha_arquivo: 0,
                            conteudo_linha: `Bico ${c.num_bico} | Fim ant ${n3(a.enc_fin)} | Ini atual ${n3(c.enc_ini)} | salto ${n3(salto)}`,
                            data_erro: c.data_mov, cod_item_erro: c.cod_item, num_tanque_erro: c.num_tanque
                        });
                    }
                }
            }
            // CRIT-1320-03: soma dos bicos (1320) diverge da saida consolidada (1300)
            if (bicos1320.length > 0) {
                const isoD = (d) => (d instanceof Date ? d.toISOString().split('T')[0] : String(d).substring(0, 10));
                const somaPorDiaProduto = new Map();
                for (const b of bicos1320) {
                    const k = `${String(b.cod_item).trim()}|${isoD(b.data_mov)}`;
                    somaPorDiaProduto.set(k, (somaPorDiaProduto.get(k) || 0) + Number(b.vol_bico));
                }
                const saidas1300 = await dbClient.query(
                    `SELECT cod_item, data_mov, vol_saidas AS saida
                     FROM lmc_movimentacao WHERE id_sped_arquivo = $1 AND num_tanque = '0'`, [arquivoId]);
                for (const s of saidas1300.rows) {
                    const k = `${String(s.cod_item).trim()}|${isoD(s.data_mov)}`;
                    if (somaPorDiaProduto.has(k)) {
                        const somaBicos = somaPorDiaProduto.get(k);
                        const diff = Math.abs(somaBicos - Number(s.saida));
                        if (diff > 0.9) {
                            erros.push({
                                tipo_erro: 'WARNING', regra_id: 'CRIT-1320-03',
                                titulo_erro: 'Soma dos bicos (1320) diverge da saída (1300)',
                                descricao_erro: `Produto ${String(s.cod_item).trim()} em ${fmtD(s.data_mov)}: soma das vendas dos bicos (1320) = ${n3(somaBicos)} L, mas a saída consolidada do 1300 = ${n3(s.saida)} L (diferença ${n3(diff)} L).`,
                                sugestao_correcao: 'Verifique se todos os bicos foram informados e se as vendas batem com o total do dia.',
                                linha_arquivo: 0,
                                conteudo_linha: `Soma 1320 ${n3(somaBicos)} | Saída 1300 ${n3(s.saida)} | dif ${n3(diff)}`,
                                data_erro: s.data_mov, cod_item_erro: String(s.cod_item).trim(), num_tanque_erro: null
                            });
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn('Validação 1320 (CRIT-1320) ignorada: ' + e.message);
        }

        // Insere todos os erros no banco com padronização de data para ISO
        if (erros.length > 0) {
            const chunkSize = 1000;
            for (let i = 0; i < erros.length; i += chunkSize) {
                const chunk = erros.slice(i, i + chunkSize);
                const values = [];
                const params = [];
                let pIndex = 1;
                
                for (const erro of chunk) {
                    const dataNormalizada = erro.data_erro ? (erro.data_erro instanceof Date ? erro.data_erro.toISOString().split('T')[0] : erro.data_erro) : null;
                    values.push(`($${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++}, $${pIndex++})`);
                    
                    params.push(
                        arquivoId, 
                        erro.tipo_erro, 
                        erro.regra_id, 
                        erro.titulo_erro, 
                        erro.descricao_erro,
                        erro.sugestao_correcao, 
                        erro.linha_arquivo, 
                        erro.conteudo_linha,
                        dataNormalizada, 
                        erro.cod_item_erro, 
                        erro.num_tanque_erro
                    );
                }
                
                const queryInsert = `
                    INSERT INTO erros_analise(
                        id_sped_arquivo, tipo_erro, regra_id, titulo_erro, descricao_erro,
                        sugestao_correcao, linha_arquivo, conteudo_linha,
                        data_erro, cod_item_erro, num_tanque_erro
                    ) VALUES ${values.join(', ')};
                `;
                
                await dbClient.query(queryInsert, params);
            }
        }

        await dbClient.query('COMMIT');
        logger.info(`Análise concluída para o arquivo ID: ${arquivoId}. ${erros.length} erros salvos.`);

        res.status(200).send({ message: "Análise concluída com sucesso." });

    } catch (error) {
        if (dbClient) await safeRollback(dbClient);
        logger.error('--- ERRO AO EXECUTAR ANÁLISE ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao executar análise.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
        releaseHeavySlot();
    }
});

// --- Validação de encerrantes por bico (Registro 1320) — somente leitura ---
app.get('/api/lmc/validacoes-1320/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if (isNaN(arquivoId)) return res.status(400).json({ message: 'ID inválido.' });
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const r = await dbClient.query(
            `SELECT data_mov, cod_item, num_tanque, num_bico,
                    COALESCE(enc_ini_corrigido, enc_ini) AS enc_ini,
                    COALESCE(enc_fin_corrigido, enc_fin) AS enc_fin,
                    COALESCE(qtd_af_corrigido, qtd_af) AS qtd_af,
                    CASE WHEN corrigido THEN (COALESCE(enc_fin_corrigido,enc_fin)-COALESCE(enc_ini_corrigido,enc_ini)-COALESCE(qtd_af_corrigido,0)) ELSE vol_bico END AS vol_bico,
                    corrigido
             FROM sped_1320 WHERE id_sped_arquivo=$1 ORDER BY cod_item, num_bico, data_mov`, [arquivoId]);
        const bicos = r.rows;
        const isoD = (d) => (d instanceof Date ? d.toISOString().split('T')[0] : String(d).substring(0, 10));
        const volumes_negativos = bicos.filter(b => Number(b.vol_bico) < -0.001);
        const encerrantes_divergentes = [];
        const _ddDias = (x, y) => Math.round((new Date(y) - new Date(x)) / 86400000);
        for (let i = 1; i < bicos.length; i++) {
            const a = bicos[i - 1], c = bicos[i];
            if (a.cod_item === c.cod_item && a.num_bico === c.num_bico && _ddDias(a.data_mov, c.data_mov) === 1) {
                const salto = Math.abs(Number(c.enc_ini) - Number(a.enc_fin));
                if (salto > 0.05) encerrantes_divergentes.push({ ...c, fim_anterior: Number(a.enc_fin), ini_atual: Number(c.enc_ini), salto: Number(salto.toFixed(3)) });
            }
        }
        const soma = new Map();
        for (const b of bicos) { const k = `${String(b.cod_item).trim()}|${isoD(b.data_mov)}`; soma.set(k, (soma.get(k) || 0) + Number(b.vol_bico)); }
        const sd = await dbClient.query(`SELECT cod_item, data_mov, vol_saidas AS saida FROM lmc_movimentacao WHERE id_sped_arquivo=$1 AND num_tanque='0'`, [arquivoId]);
        const divergencias_1320_1300 = [];
        for (const s of sd.rows) {
            const k = `${String(s.cod_item).trim()}|${isoD(s.data_mov)}`;
            if (soma.has(k)) {
                const sb = soma.get(k), diff = Math.abs(sb - Number(s.saida));
                if (diff > 0.9) divergencias_1320_1300.push({ cod_item: String(s.cod_item).trim(), data_mov: s.data_mov, soma_bicos: Number(sb.toFixed(3)), saida_1300: Number(Number(s.saida).toFixed(3)), diferenca: Number(diff.toFixed(3)) });
            }
        }
        res.json({ total_erros: volumes_negativos.length + encerrantes_divergentes.length + divergencias_1320_1300.length, volumes_negativos, encerrantes_divergentes, divergencias_1320_1300 });
    } catch (e) { logger.warn('validacoes-1320: ' + e.message); res.status(500).json({ message: 'Erro ao validar 1320.', error: e.message }); }
    finally { if (dbClient) dbClient.release(); }
});

// --- Correção manual de um bico (1320) — grava camada paralela _corrigido, sem tocar o original ---
app.post('/api/lmc/1320-corrigir', authMiddleware, async (req, res) => {
    const { id_sped_arquivo, cod_item, num_bico, num_tanque, data_mov, enc_ini_corrigido, enc_fin_corrigido, qtd_af_corrigido } = req.body || {};
    if (!id_sped_arquivo || !cod_item || !num_bico || !data_mov) return res.status(400).json({ message: 'Parâmetros obrigatórios: id_sped_arquivo, cod_item, num_bico, data_mov.' });
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const params = [enc_ini_corrigido, enc_fin_corrigido, qtd_af_corrigido, id_sped_arquivo, cod_item, num_bico, data_mov];
        let sql = `UPDATE sped_1320 SET enc_ini_corrigido=$1, enc_fin_corrigido=$2, qtd_af_corrigido=$3, corrigido=TRUE
                   WHERE id_sped_arquivo=$4 AND cod_item=$5 AND num_bico=$6 AND data_mov=$7`;
        if (num_tanque != null) { sql += ' AND num_tanque=$8'; params.push(num_tanque); }
        const upd = await dbClient.query(sql, params);
        if (upd.rowCount === 0) return res.status(404).json({ message: 'Bico/dia não encontrado no 1320.' });
        res.json({ message: 'Correção registrada. Reexporte o SPED para aplicá-la.', atualizados: upd.rowCount });
    } catch (e) { res.status(500).json({ message: 'Erro ao corrigir 1320.', error: e.message }); }
    finally { if (dbClient) dbClient.release(); }
});

// --- ROTA PARA BUSCAR ERROS (PRESENTE) ---
app.get('/api/erros/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if (isNaN(arquivoId)) {
        logger.warn(`Tentativa de buscar erros com ID inválido: ${req.params.id} `);
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }
    logger.info(`Buscando erros para o arquivo ID: ${arquivoId} `);
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const query = `
            SELECT a.id, a.nome_arquivo, a.periodo_apuracao, a.data_upload, a.caminho_arquivo, e.nome_empresa, e.cnpj as cnpj_empresa
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
            nome_empresa: row.nome_empresa,
            cnpj_empresa: row.cnpj_empresa
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
    logger.info(`[GET /api/arquivos/:id_empresa] Recebido: id_empresa=${idEmpresa}, usuário=${req.user?.id || 'anônimo'}`);

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const query = `
            SELECT id, nome_arquivo, periodo_apuracao, data_upload
            FROM sped_arquivos
            WHERE id_empresa = $1
            ORDER BY data_upload DESC
        `;
        const { rows } = await dbClient.query(query, [idEmpresa]);
        logger.info(`[GET /api/arquivos/:id_empresa] Sucesso! Retornando ${rows.length} arquivos para empresa ${idEmpresa}`);
        res.json(rows);
    } catch (error) {
        logger.error(`[GET /api/arquivos/:id_empresa] Erro ao listar períodos (empresa ${idEmpresa}):`, error);
        res.status(500).send("Erro ao carregar histórico da empresa.");
    } finally {
        dbClient.release();
    }
});

// Buscar metadados de um arquivo específico para carregar análise
app.get('/api/arquivo/info/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

// --- CONTINUIDADE DE ESTOQUE ENTRE MESES ---
// Compara o fechamento físico ajustado do mês anterior com a abertura do mês atual.
// Retorna divergências por combustível para exibição na UI.
app.get('/api/lmc/continuidade/:id_sped', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_sped);
    if (isNaN(arquivoId)) return res.status(400).json({ error: 'ID inválido' });
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        // Arquivo anterior = mesmo CNPJ (normalizado, sem máscara), período mais recente antes deste
        const query = `
            WITH
            atual AS (
                SELECT id, cnpj_empresa, periodo_apuracao,
                       REGEXP_REPLACE(cnpj_empresa, '[^0-9]', '', 'g') AS cnpj_num
                FROM sped_arquivos WHERE id = $1
            ),
            arquivo_anterior AS (
                SELECT sa.id, sa.periodo_apuracao
                FROM sped_arquivos sa, atual
                WHERE REGEXP_REPLACE(sa.cnpj_empresa, '[^0-9]', '', 'g') = atual.cnpj_num
                  AND sa.id != $1
                  AND sa.periodo_apuracao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                  AND atual.periodo_apuracao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                  AND LEFT(sa.periodo_apuracao, 7) < LEFT(atual.periodo_apuracao, 7)
                ORDER BY LEFT(sa.periodo_apuracao, 7) DESC
                LIMIT 1
            ),
            -- Fechamento fisico do mes anterior (ajustado pelo laboratorio, ou original do SPED).
            -- Usa COALESCE(fech_fisico_ajustado, fech_fisico): o que o laboratorio exibe como
            -- fechamento final apos otimizacao. Se nao houve otimizacao, usa o valor bruto do SPED.
            -- Filtra pela data de fechamento do periodo para suportar arquivos anuais com
            -- multiplos registros 1300 por produto.
            -- TRIM defensivo: alguns SPEDs gravam COD_ITEM como CHAR fixo com padding,
            -- o que quebraria o JOIN cross-arquivo abaixo (ver caso arquivo 1190 / mar 2022).
            fechamento_ant AS (
                SELECT DISTINCT ON (TRIM(m.cod_item))
                    TRIM(m.cod_item) AS cod_item,
                    COALESCE(m.fech_fisico_ajustado::numeric, m.fech_fisico::numeric) AS fechamento
                FROM lmc_movimentacao m
                CROSS JOIN arquivo_anterior aa
                WHERE m.id_sped_arquivo = aa.id
                  AND m.data_mov::date <= SPLIT_PART(aa.periodo_apuracao, ' a ', 2)::date
                ORDER BY TRIM(m.cod_item), m.data_mov DESC
            ),
            -- Abertura do mes atual: primeiro registro dentro do periodo do arquivo atual.
            abertura_atual AS (
                SELECT DISTINCT ON (TRIM(sub.cod_item))
                    TRIM(sub.cod_item) AS cod_item,
                    COALESCE(sub.estq_abert_ajustado::numeric, sub.estq_abert::numeric, 0) AS abertura
                FROM lmc_movimentacao sub
                CROSS JOIN atual
                WHERE sub.id_sped_arquivo = $1
                  AND sub.data_mov::date >= SPLIT_PART(atual.periodo_apuracao, ' ', 1)::date
                ORDER BY TRIM(sub.cod_item), sub.data_mov ASC
            )
            SELECT
                a.cod_item,
                TRIM(p.descr_item) AS nome,
                ROUND(f.fechamento::numeric, 3) AS fechamento_anterior,
                ROUND(a.abertura::numeric, 3) AS abertura_atual,
                ROUND((a.abertura - f.fechamento)::numeric, 3) AS diferenca,
                (SELECT periodo_apuracao FROM arquivo_anterior) AS periodo_anterior
            FROM abertura_atual a
            JOIN fechamento_ant f ON a.cod_item = f.cod_item
            LEFT JOIN sped_produtos p ON TRIM(p.cod_item) = a.cod_item AND p.id_sped_arquivo = $1
            WHERE f.fechamento IS NOT NULL
              AND ABS(a.abertura - f.fechamento) > 0.1
            ORDER BY ABS(a.abertura - f.fechamento) DESC
        `;

        // Verifica se existe arquivo anterior (mesmo que sem divergência)
        const prevCheck = await dbClient.query(`
            SELECT sa.id FROM sped_arquivos sa
            JOIN sped_arquivos aa ON aa.id = $1
            WHERE REGEXP_REPLACE(sa.cnpj_empresa, '[^0-9]', '', 'g') = REGEXP_REPLACE(aa.cnpj_empresa, '[^0-9]', '', 'g')
              AND sa.id != $1
              AND sa.periodo_apuracao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
              AND aa.periodo_apuracao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
              AND LEFT(sa.periodo_apuracao, 7) < LEFT(aa.periodo_apuracao, 7)
            LIMIT 1
        `, [arquivoId]);

        const result = await dbClient.query(query, [arquivoId]);
        res.json({
            tem_mes_anterior: prevCheck.rows.length > 0,
            divergencias: result.rows
        });
    } catch (e) {
        logger.error('Erro ao verificar continuidade LMC:', e);
        res.status(500).json({ error: e.message });
    } finally {
        dbClient.release();
    }
});

// --- DIAGNÓSTICO DE COMPLETUDE DO LMC (Registro 1300) ---
// Detecta dias do período de apuração que não têm lançamento 1300, por produto.
// Usado para alertar quando o SPED foi gerado com LMC incompleto (ex.: parou no dia 27).
app.get('/api/lmc/diagnostico-completude/:id', authMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID inválido.' });

        const arqRes = await pool.query(
            `SELECT periodo_apuracao FROM sped_arquivos WHERE id = $1`, [id]
        );
        if (arqRes.rowCount === 0) return res.status(404).json({ message: 'Arquivo não encontrado.' });

        const periodo = String(arqRes.rows[0].periodo_apuracao || '');
        const partes = periodo.split(' a ');
        if (partes.length !== 2) return res.json({ tem_lacuna: false, periodo, produtos: [] });

        const dataIni = partes[0].trim();
        const dataFim = partes[1].trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIni) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
            return res.json({ tem_lacuna: false, periodo, produtos: [] });
        }

        // Lista dias com 1300 por produto (linha consolidada num_tanque='0').
        const dq = await pool.query(`
            SELECT
                TRIM(lmc.cod_item) AS cod_item,
                COALESCE(TRIM(p.descr_item), TRIM(lmc.cod_item)) AS descr_item,
                ARRAY_AGG(DISTINCT TO_CHAR(lmc.data_mov::date, 'YYYY-MM-DD')
                          ORDER BY TO_CHAR(lmc.data_mov::date, 'YYYY-MM-DD')) AS dias_com_lmc
            FROM lmc_movimentacao lmc
            LEFT JOIN sped_produtos p
              ON TRIM(p.cod_item) = TRIM(lmc.cod_item) AND p.id_sped_arquivo = lmc.id_sped_arquivo
            WHERE lmc.id_sped_arquivo = $1
              AND lmc.num_tanque = '0'
            GROUP BY TRIM(lmc.cod_item), TRIM(p.descr_item)
        `, [id]);

        // Gera lista de dias do período (UTC para evitar fuso).
        const [yi, mi, di] = dataIni.split('-').map(Number);
        const [yf, mf, df] = dataFim.split('-').map(Number);
        const inicio = new Date(Date.UTC(yi, mi - 1, di));
        const fim    = new Date(Date.UTC(yf, mf - 1, df));
        const diasPeriodo = [];
        for (let d = new Date(inicio); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
            diasPeriodo.push(d.toISOString().slice(0, 10));
        }

        let temLacuna = false;
        const produtos = dq.rows.map(row => {
            const setLmc = new Set(row.dias_com_lmc || []);
            const faltantes = diasPeriodo.filter(d => !setLmc.has(d));
            if (faltantes.length > 0) temLacuna = true;
            return {
                cod_item: row.cod_item,
                descr_item: row.descr_item,
                total_dias_periodo: diasPeriodo.length,
                total_dias_com_lmc: setLmc.size,
                dias_faltantes: faltantes,
                ultimo_dia_com_lmc: [...setLmc].sort().pop() || null
            };
        });

        res.json({
            tem_lacuna: temLacuna,
            periodo,
            total_dias_periodo: diasPeriodo.length,
            produtos
        });
    } catch (err) {
        logger.error('Erro em /api/lmc/diagnostico-completude:', err);
        res.status(500).json({ message: err.message });
    }
});

// --- RELATÓRIO DO LMC DIÁRIO ---
app.get('/api/lmc/:id_sped', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_sped);
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const query = `
            WITH ncm_to_lmc AS (
                -- Para cada prefixo NCM (6 dígitos), mapeia para o cod_item com mais entradas no LMC
                -- Isso permite resolver GASA/GASC/AEHC para o cod_item canônico do posto
                SELECT DISTINCT ON (LEFT(sp.ncm, 6))
                    LEFT(sp.ncm, 6) as ncm_prefix,
                    lmc_cnt.cod_item
                FROM (
                    SELECT cod_item, COUNT(*) FILTER (WHERE vol_entr > 0) as entr_count
                    FROM lmc_movimentacao
                    WHERE id_sped_arquivo = $1
                    GROUP BY cod_item
                ) lmc_cnt
                JOIN sped_produtos sp ON sp.cod_item = lmc_cnt.cod_item AND sp.id_sped_arquivo = $1
                WHERE sp.ncm IS NOT NULL AND length(sp.ncm) >= 6
                ORDER BY LEFT(sp.ncm, 6), lmc_cnt.entr_count DESC, lmc_cnt.cod_item
            ),
            items_in_lmc AS (
                SELECT DISTINCT cod_item FROM lmc_movimentacao WHERE id_sped_arquivo = $1
            ),
            notas_raw AS (
                SELECT
                    -- Usa cod_item direto se já existe no LMC; só recorre ao NCM quando não existe
                    CASE WHEN item.cod_item IN (SELECT cod_item FROM items_in_lmc)
                         THEN item.cod_item
                         ELSE COALESCE(ncm_map.cod_item, item.cod_item)
                    END as cod_item_resolved,
                    COALESCE(c100.dt_e_s, c100.dt_doc) as data_entrada,
                    item.qtd,
                    c100.num_doc,
                    c100.dt_doc,
                    COALESCE(part.nome, 'Não Informado') as fornecedor
                FROM documentos_c100 c100
                JOIN documentos_itens_c170 item ON item.id_documento_c100 = c100.id
                LEFT JOIN sped_participantes part ON part.cod_part = c100.cod_part AND part.id_sped_arquivo = c100.id_sped_arquivo
                LEFT JOIN sped_produtos sp ON sp.cod_item = item.cod_item AND sp.id_sped_arquivo = c100.id_sped_arquivo
                LEFT JOIN ncm_to_lmc ncm_map ON ncm_map.ncm_prefix = LEFT(sp.ncm, 6)
                WHERE c100.id_sped_arquivo = $1
                  AND c100.ind_oper = '0'
                  AND (
                      item.cfop LIKE '110%' OR
                      item.cfop LIKE '210%' OR
                      item.cfop LIKE '165%' OR
                      item.cfop LIKE '265%' OR
                      item.cfop LIKE '065%' OR
                      item.cfop LIKE '116%' OR
                      item.cfop LIKE '216%' OR
                      (LEFT(sp.ncm, 4) IN ('2710', '2207', '2711')
                       AND item.cod_item IN (
                           SELECT cod_item FROM lmc_movimentacao WHERE id_sped_arquivo = $1
                       ))
                  )
            ),
            notas_entrada AS (
                SELECT
                    cod_item_resolved as cod_item,
                    data_entrada,
                    SUM(qtd) as volume_nota,
                    json_agg(
                        json_build_object(
                            'num_doc', num_doc,
                            'dt_doc', dt_doc,
                            'qtd', qtd,
                            'fornecedor', fornecedor
                        )
                    ) as nfs_detalhadas
                FROM notas_raw
                GROUP BY cod_item_resolved, data_entrada
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
                COALESCE(cfg.capacidade, 0) as capacidade_tanque,
                (l.cod_item IS NOT NULL) as has_lmc_row
            FROM lmc_entrada l
            FULL OUTER JOIN notas_entrada n ON l.cod_item = n.cod_item AND (l.data_mov::date = n.data_entrada::date)
            LEFT JOIN sped_produtos p ON p.id_sped_arquivo = $1 AND p.cod_item = COALESCE(l.cod_item, n.cod_item)
            LEFT JOIN sped_arquivos arq ON arq.id = $1
            LEFT JOIN lmc_tanques_config cfg ON REGEXP_REPLACE(cfg.cnpj, '[^0-9]', '', 'g') = REGEXP_REPLACE(arq.cnpj_empresa, '[^0-9]', '', 'g') AND cfg.cod_item = COALESCE(l.cod_item, n.cod_item)
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

                // ESCRITURAL FINAL: sempre recalculado (ABERT + ENTR - SAÍDA)
                const escrFinal = escrCalculadoBase;

                // DIFERENÇA = FÍSICO - ESCRITURAL
                const diffLitre = fisico - escrFinal;

                // % ANP = ABS(Perda/Ganho) / Fechamento Físico × 100
                const varPerc = fisico > 0 ? (Math.abs(diffLitre) / fisico) * 100 : 0;
                const limiteLitros = fisico > 0 ? parseFloat((fisico * 0.006).toFixed(3)) : 0;
                const excessoLitros = parseFloat(Math.max(0, Math.abs(diffLitre) - limiteLitros).toFixed(3));
                const volDisponivel = abertOriginal + entr;

                let status = 'CONFORME';
                if (fisico <= 0) status = 'ERRO DE BASE / FECHAMENTO FÍSICO ZERADO';
                else if (varPerc >= 0.61) status = 'FORA LIMITE';
                if (cap > 0 && fisico > cap) status = 'EXCESSO';
                if (escrFinal < -0.01 || fisico < -0.01) status = 'NEGATIVO';

                lmcFinal.push({
                    ...row,
                    estq_abert_final: abertOriginal,
                    vol_saidas_final: saida,
                    fech_fisico_final: fisico,
                    estq_escr_final: escrFinal,
                    vol_disponivel: volDisponivel,
                    val_perda: perda_orig,
                    val_ganho: ganho_orig,
                    variacao_litros: diffLitre,
                    variacao_percentual: varPerc,
                    variacao_percentual_disponivel: volDisponivel > 0 ? parseFloat(((Math.abs(diffLitre) / volDisponivel) * 100).toFixed(4)) : 0,
                    limite_litros: limiteLitros,
                    excesso_litros: excessoLitros,
                    excesso: cap > 0 && fisico > cap ? parseFloat((fisico - cap).toFixed(3)) : 0,
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
            await safeRollback(dbClient);
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
        await safeRollback(dbClient);
        logger.error("Erro ao atualizar estoque inicial: ", e);
        res.status(500).json({ error: "Erro interno ao salvar novo estoque de abertura." });
    } finally {
        dbClient.release();
    }
});

// ─── HELPER: calcula a distribuição de sincronização sem salvar no banco ────────
async function calcularSincronizacaoPreview(dbClient, id_arquivo, cod_item, novo_estoque) {
    // TRIM defensivo: o frontend envia cod_item normalizado, mas o banco pode ter
    // padding em arquivos legados (CHAR fixo de 60). Compara TRIM-em-TRIM em todas as queries.
    const codTrim = String(cod_item || '').trim();
    // 1. Capacidade configurada
    const capRes = await dbClient.query(`
        SELECT SUM(c.capacidade) as cap
        FROM lmc_tanques_config c
        JOIN sped_arquivos a ON REGEXP_REPLACE(a.cnpj_empresa,'[^0-9]','','g') = REGEXP_REPLACE(c.cnpj,'[^0-9]','','g')
        WHERE a.id = $1 AND TRIM(c.cod_item) = $2
    `, [id_arquivo, codTrim]);
    const capacidadeTotal = parseFloat(capRes.rows[0]?.cap || 0);

    // 2. Dados consolidados por dia (originais)
    const { rows: dailyItems } = await dbClient.query(`
        SELECT data_mov,
               SUM(vol_entr)    as vol_entr,
               SUM(vol_saidas)  as vol_saidas,
               SUM(estq_abert)  as estq_abert,
               SUM(fech_fisico) as fech_fisico,
               SUM(val_perda)   as val_perda,
               SUM(val_ganho)   as val_ganho
        FROM lmc_movimentacao
        WHERE id_sped_arquivo = $1 AND TRIM(cod_item) = $2
        GROUP BY data_mov ORDER BY data_mov ASC
    `, [id_arquivo, codTrim]);

    if (dailyItems.length === 0) throw new Error('Nenhum registro LMC encontrado.');

    // 3. Todos os registros originais (por tanque)
    const { rows: originalRows } = await dbClient.query(`
        SELECT id, data_mov, vol_saidas, vol_entr, estq_abert, fech_fisico,
               val_perda, val_ganho, num_tanque
        FROM lmc_movimentacao
        WHERE id_sped_arquivo = $1 AND TRIM(cod_item) = $2
        ORDER BY data_mov ASC, num_tanque ASC
    `, [id_arquivo, codTrim]);

    // Normalizar datas para comparação (converter para string ISO date para evitar diferenças de timezone)
    const normalizeDate = (d) => {
        if (!d) return null;
        if (typeof d === 'string') return d.split('T')[0];
        return d.toISOString().split('T')[0];
    };

    // Mapear dailyItems com datas normalizadas
    const dailyItemsNormalized = dailyItems.map(d => ({
        ...d,
        data_mov_normalized: normalizeDate(d.data_mov)
    }));

    // Mapear originalRows com datas normalizadas
    const originalRowsNormalized = originalRows.map(r => ({
        ...r,
        data_mov_normalized: normalizeDate(r.data_mov)
    }));

    const totalVendasOrig = dailyItems.reduce((s, r) => s + parseFloat(r.vol_saidas || 0), 0);
    const fechamentoAntes = dailyItems[dailyItems.length - 1];
    const aberturaAntes = parseFloat(dailyItems[0].estq_abert || 0);
    const ajustes = [];

    // 4. Abertura inicial (sem mínimo artificial — tanque pode estar vazio)
    let aberturaInicialConsolidada = Math.max(0, novo_estoque);

    // 5. Inicializa estrutura de cálculo por dia
    let calcs = dailyItemsNormalized.map(row => ({
        data_mov: row.data_mov,
        data_mov_normalized: row.data_mov_normalized,
        entradasOrig: parseFloat(row.vol_entr || 0),
        saidaOrig: parseFloat(row.vol_saidas || 0),
        saidaCalc: parseFloat(row.vol_saidas || 0),
        fisicoOrig: parseFloat(row.fech_fisico || 0),
        abertOrig: parseFloat(row.estq_abert || 0),
        perdaOrig: parseFloat(row.val_perda || 0),
        ganhoOrig: parseFloat(row.val_ganho || 0),
        abertCalc: 0, escrCalc: 0, fisicoCalc: 0
    }));

    // 6. Distribuição proporcional por segmentos com busca binária.
    //    Segmento = período entre entradas de combustível.
    //    Para cada segmento, busca o MAIOR fator de venda que não zera nenhum dia.
    //    Garante: nenhum dia com NFC-e fica zerado, cascata nunca negativa, ANP ≤ 0,60%.
    //    Vendas distribuídas com peso proporcional ao original (padrão real do posto).

    // 6.1 Identificar segmentos (períodos entre entradas)
    const segmentos = [];
    let segInicio = 0;
    for (let i = 0; i < calcs.length; i++) {
        if (i > 0 && calcs[i].entradasOrig > 0) {
            segmentos.push({ ini: segInicio, fim: i - 1 });
            segInicio = i;
        }
    }
    segmentos.push({ ini: segInicio, fim: calcs.length - 1 });

    // 6.2 Função auxiliar: roda cascata num segmento e retorna stock final + resultados
    const cascataSegmento = (stockIni, seg, saidas) => {
        let stock = stockIni;
        const result = [];
        for (let i = 0; i < seg.length; i++) {
            const c = seg[i];
            const disp = stock + c.entradasOrig;
            let sf = saidas[i];
            // Cap capacidade: se excede, aumentar saída
            if (capacidadeTotal > 0 && (disp - sf) > capacidadeTotal * 0.994) {
                sf = Number((disp - capacidadeTotal * 0.994).toFixed(3));
            }
            // Saída não pode exceder disponível
            if (sf > disp - 0.001) sf = Math.max(0, Number((disp - 0.001).toFixed(3)));
            const escr = Math.max(0, Number((disp - sf).toFixed(3)));
            const capPerda = escr * (0.006 / 1.006);
            const capGanho = escr * (0.006 / 0.994);
            const perda = Math.min(c.perdaOrig, capPerda);
            const ganho = Math.min(c.ganhoOrig, capGanho);
            let fech = Math.max(0, Number((escr + ganho - perda).toFixed(3)));
            if (capacidadeTotal > 0 && fech > capacidadeTotal * 0.99)
                fech = Number((capacidadeTotal * 0.99).toFixed(3));
            result.push({ sf, escr, fech });
            stock = fech;
        }
        return { stockFinal: stock, result };
    };

    // 6.3 Processar cada segmento com busca binária do fator ideal
    let stockAtual = aberturaInicialConsolidada;

    for (const { ini, fim } of segmentos) {
        const seg = calcs.slice(ini, fim + 1);
        const nSeg = seg.length;
        const diasVendaIdx = [];
        for (let j = 0; j < nSeg; j++) {
            if (seg[j].saidaOrig > 0) diasVendaIdx.push(j);
        }
        const vendasOrig = diasVendaIdx.reduce((s, j) => s + seg[j].saidaOrig, 0);

        if (vendasOrig <= 0 || diasVendaIdx.length === 0) {
            // Segmento sem vendas — só passar cascata com saída 0
            const saidas = new Array(nSeg).fill(0);
            const { stockFinal, result } = cascataSegmento(stockAtual, seg, saidas);
            for (let j = 0; j < nSeg; j++) {
                seg[j].saidaCalc = result[j].sf;
                seg[j].abertCalc = j === 0 ? stockAtual : result[j - 1].fech;
                seg[j].escrCalc = result[j].escr;
                seg[j].fisicoCalc = result[j].fech;
            }
            stockAtual = stockFinal;
            continue;
        }

        // Busca binária: encontrar o MAIOR fator (0..1) onde nenhum dia zera
        let fatorMin = 0.0, fatorMax = 1.0;
        let melhorResult = null;

        for (let biter = 0; biter < 30; biter++) {
            const fator = (fatorMin + fatorMax) / 2;
            const saidas = new Array(nSeg).fill(0);
            for (const j of diasVendaIdx) {
                saidas[j] = Number((seg[j].saidaOrig * fator).toFixed(3));
            }

            const { stockFinal, result } = cascataSegmento(stockAtual, seg, saidas);

            // Verificar se algum dia com venda ficou com saída insignificante
            // Mínimo = pelo menos 1L ou 0.5% da venda original (o que for maior)
            let algumZerado = false;
            for (const j of diasVendaIdx) {
                const minimoAceitavel = Math.max(1.0, seg[j].saidaOrig * 0.005);
                if (result[j].sf < minimoAceitavel) {
                    algumZerado = true;
                    break;
                }
            }

            if (algumZerado) {
                fatorMax = fator; // Reduzir
            } else {
                fatorMin = fator; // Pode aumentar
                melhorResult = { result, stockFinal, saidas };
            }
        }

        // Aplicar melhor resultado encontrado (ou fallback com mínimo)
        if (melhorResult) {
            for (let j = 0; j < nSeg; j++) {
                seg[j].saidaCalc = melhorResult.result[j].sf;
                seg[j].abertCalc = j === 0 ? stockAtual : melhorResult.result[j - 1].fech;
                seg[j].escrCalc = melhorResult.result[j].escr;
                seg[j].fisicoCalc = melhorResult.result[j].fech;
            }
            stockAtual = melhorResult.stockFinal;
        } else {
            // Fallback: mínimo simbólico por dia
            const saidas = new Array(nSeg).fill(0);
            for (const j of diasVendaIdx) {
                saidas[j] = Math.max(0.001, Number((seg[j].saidaOrig * 0.001).toFixed(3)));
            }
            const { stockFinal, result } = cascataSegmento(stockAtual, seg, saidas);
            for (let j = 0; j < nSeg; j++) {
                seg[j].saidaCalc = result[j].sf;
                seg[j].abertCalc = j === 0 ? stockAtual : result[j - 1].fech;
                seg[j].escrCalc = result[j].escr;
                seg[j].fisicoCalc = result[j].fech;
            }
            stockAtual = stockFinal;
        }
    }

    // 6.4 Trava fiscal final: rede de segurança
    for (let c of calcs) {
        if (c.saidaCalc <= 0 && c.saidaOrig > 0) {
            c.saidaCalc = Math.max(0.001, Number((c.saidaOrig * 0.001).toFixed(3)));
            logger.warn(`[TRAVA FISCAL SYNC] Dia ${c.data_mov_normalized} (cod_item=${codTrim}): saída forçada para ${c.saidaCalc}L.`);
        }
    }

    // 9. Fase final: cascata com ruído ANP e rateio por tanque
    const updates = [];
    const lastClosingByTank = new Map();

    for (let i = 0; i < calcs.length; i++) {
        const dayCalc = calcs[i];
        const rowsDoDia = originalRowsNormalized.filter(r => r.data_mov_normalized === dayCalc.data_mov_normalized);

        // CAMADA 3: Validação de Integridade - Detecta problema imediatamente
        if (rowsDoDia.length === 0) {
            const erro = `[CASCATA CRÍTICO] Nenhum registro encontrado para data ${dayCalc.data_mov_normalized} (cod_item=${cod_item}, arquivo=${id_arquivo}). Verifique sincronização de timezone ou integridade do banco.`;
            logger.error(erro);
            throw new Error(erro);
        }

        const totalSaidaOrig = rowsDoDia.reduce((s, r) => s + parseFloat(r.vol_saidas || 0), 0);

        // PROTEÇÃO 2: Verificação de Sanidade - Alerta se dados parecem anômalos
        if (totalSaidaOrig === 0 && rowsDoDia.length > 0) {
            logger.warn(`[CASCATA SANIDADE] Aviso: Nenhuma saída registrada para ${dayCalc.data_mov_normalized} (cod_item=${cod_item}). Distribuindo rateio igualmente entre ${rowsDoDia.length} tanque(s).`);
        }

        // abertCalc, saidaCalc, escrCalc e fisicoCalc já calculados pela cascata direta acima.

        // Rateio por tanque: distribui o fisicoCalc consolidado proporcionalmente
        // pelo físico original de cada tanque. Isso garante que SUM(fAjustado) == dayCalc.fisicoCalc,
        // evitando divergência entre a cascata do backend e a cascata do frontend.
        const totalFisicoOrig = rowsDoDia.reduce((s, r) => s + parseFloat(r.fech_fisico || 0), 0);

        // PROTEÇÃO 2: Continuação - Alerta se físico original for zero
        if (totalFisicoOrig === 0 && rowsDoDia.length > 0) {
            logger.warn(`[CASCATA SANIDADE] Aviso: Nenhum fechamento registrado para ${dayCalc.data_mov_normalized} (cod_item=${cod_item}). Distribuindo rateio igualmente entre ${rowsDoDia.length} tanque(s).`);
        }

        rowsDoDia.forEach(r => {
            const pSaida  = totalSaidaOrig  > 0 ? parseFloat(r.vol_saidas  || 0) / totalSaidaOrig  : 1 / rowsDoDia.length;
            const pFisico = totalFisicoOrig > 0 ? parseFloat(r.fech_fisico || 0) / totalFisicoOrig : 1 / rowsDoDia.length;
            const sAjustada = dayCalc.saidaCalc  * pSaida;
            const fAjustado = dayCalc.fisicoCalc * pFisico;  // SUM(fAjustado) == fisicoCalc ✓

            let aAjustada = lastClosingByTank.get(r.num_tanque);
            if (aAjustada === undefined) {
                const totAbertDia = rowsDoDia.reduce((s, x) => s + parseFloat(x.estq_abert || 0), 0);
                const peso = totAbertDia > 0 ? parseFloat(r.estq_abert || 0) / totAbertDia : 1 / rowsDoDia.length;
                aAjustada = aberturaInicialConsolidada * peso;
            }

            const escrTanque = Math.max(0, aAjustada + parseFloat(r.vol_entr || 0) - sAjustada);
            const diffPG     = fAjustado - escrTanque;

            updates.push({
                id: r.id,
                abertura: aAjustada, saida: sAjustada, fisico: fAjustado,
                perda: diffPG < 0 ? Math.abs(diffPG) : 0,
                ganho: diffPG > 0 ? diffPG           : 0,
                escritural: escrTanque
            });

            lastClosingByTank.set(r.num_tanque, fAjustado);
        });
    }

    // PROTEÇÃO 3: Validação de Integridade da Cascata
    const aberturaPrimeiroDia = aberturaInicialConsolidada;
    const fechamentoUltimoDia = calcs[calcs.length - 1].fisicoCalc;

    if (aberturaPrimeiroDia > 0 && fechamentoUltimoDia < 0.5) {
        logger.warn(`[CASCATA INTEGRIDADE] ⚠️  Fechamento final crítico: ${fechamentoUltimoDia.toFixed(3)}L (mínimo obrigatório=0.5L). Possível erro de entrada/saída no SPED. Revise os dados.`);
        ajustes.push(`Atenção crítica: Fechamento final muito baixo (${fechamentoUltimoDia.toFixed(3)}L). Verifique integridade das entradas e saídas.`);
    }

    // 10. Monta resumo para o preview
    const fechamentoDepois = calcs[calcs.length - 1].fisicoCalc;
    const totalVendasDepois = calcs.reduce((s, c) => s + c.saidaCalc, 0);

    const dias = calcs.map(c => ({
        data: c.data_mov,
        vendas_antes: parseFloat(c.saidaOrig.toFixed(3)),
        vendas_depois: parseFloat(c.saidaCalc.toFixed(3)),
        estoque_antes: parseFloat(c.fisicoOrig.toFixed(3)),
        estoque_depois: parseFloat(c.fisicoCalc.toFixed(3))
    }));

    return {
        cod_item,
        resumo: {
            abertura_antes:   parseFloat(aberturaAntes.toFixed(3)),
            abertura_depois:  parseFloat(aberturaInicialConsolidada.toFixed(3)),
            vendas_antes:     parseFloat(totalVendasOrig.toFixed(3)),
            vendas_depois:    parseFloat(totalVendasDepois.toFixed(3)),
            fechamento_antes: parseFloat((parseFloat(fechamentoAntes.fech_fisico) || 0).toFixed(3)),
            fechamento_depois: parseFloat(fechamentoDepois.toFixed(3)),
            capacidade:       capacidadeTotal,
            target_calculado: parseFloat(totalVendasDepois.toFixed(3))
        },
        ajustes,
        dias,
        updates // usado pelo endpoint de confirmação
    };
}

// ─── PREVIEW: mostra o antes/depois sem salvar ───────────────────────────────
app.post('/api/lmc/preview-sincronizacao', authMiddleware, async (req, res) => {
    const { itens } = req.body; // [{ id_arquivo, cod_item, novo_estoque }]
    if (!itens || !itens.length) return res.status(400).json({ error: 'Parâmetros inválidos.' });

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const previews = [];
        for (const item of itens) {
            const preview = await calcularSincronizacaoPreview(dbClient, item.id_arquivo, item.cod_item, parseFloat(item.novo_estoque));
            previews.push(preview);
        }
        res.json({ previews });
    } catch (e) {
        logger.error('Erro no preview de sincronização:', e);
        res.status(500).json({ error: e.message });
    } finally {
        dbClient.release();
    }
});

// ─── CONFIRMAR: calcula e salva em transação única ───────────────────────────
app.post('/api/lmc/confirmar-sincronizacao', authMiddleware, async (req, res) => {
    const { itens } = req.body; // [{ id_arquivo, cod_item, novo_estoque }]
    if (!itens || !itens.length) return res.status(400).json({ error: 'Parâmetros inválidos.' });

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('BEGIN');
        await dbClient.query('ALTER TABLE lmc_movimentacao ADD COLUMN IF NOT EXISTS estq_abert_ajustado NUMERIC(15,3)');

        for (const item of itens) {
            const { updates } = await calcularSincronizacaoPreview(dbClient, item.id_arquivo, item.cod_item, parseFloat(item.novo_estoque));
            for (const up of updates) {
                await dbClient.query(`
                    UPDATE lmc_movimentacao
                    SET estq_abert_ajustado = $1, vol_saidas_ajustado = $2, fech_fisico_ajustado = $3,
                        val_perda_ajustado = $4, val_ganho_ajustado = $5, vol_escr_ajustado = $6,
                        vol_entr_ajustado = vol_entr
                    WHERE id = $7
                `, [up.abertura, up.saida, up.fisico, up.perda, up.ganho, up.escritural, up.id]);
            }
        }

        await dbClient.query('COMMIT');
        res.json({ success: true, message: `${itens.length} produto(s) sincronizados e redistribuídos com sucesso.` });
    } catch (e) {
        await safeRollback(dbClient);
        logger.error('Erro ao confirmar sincronização:', e);
        res.status(500).json({ error: e.message });
    } finally {
        dbClient.release();
    }
});

// ─── CORRIGIR DISTRIBUIÇÃO: aplica delta-shift (abertura nova - abertura original) ─
// Abordagem definitiva: se abertura subiu +X, físico de TODOS os dias sobe +X.
// Saídas voltam ao original. Preserva os padrões ANP originais dia a dia.
app.post('/api/lmc/corrigir-distribuicao', authMiddleware, async (req, res) => {
    const { id_arquivo, cod_item } = req.body;
    if (!id_arquivo || !cod_item) return res.status(400).json({ error: 'Parâmetros inválidos.' });

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        // Lê a abertura já sincronizada no 1º dia
        const abertRes = await dbClient.query(`
            SELECT COALESCE(SUM(estq_abert_ajustado), SUM(estq_abert)) AS abertura,
                   SUM(estq_abert_ajustado) AS abertura_ajustada_raw
            FROM lmc_movimentacao
            WHERE id_sped_arquivo = $1 AND cod_item = $2
              AND data_mov = (SELECT MIN(data_mov) FROM lmc_movimentacao WHERE id_sped_arquivo = $1 AND cod_item = $2)
        `, [id_arquivo, cod_item]);

        const aberturaAjustada = parseFloat(abertRes.rows[0]?.abertura || 0);
        const temAjuste = abertRes.rows[0]?.abertura_ajustada_raw !== null;

        if (!temAjuste) {
            return res.status(400).json({ error: 'Nenhuma abertura sincronizada encontrada. Sincronize o estoque inicial primeiro.' });
        }

        // Reutiliza o motor de distribuição (que respeita capacidade e escritural ≥ 0)
        // targetFechamento = físico real do SPED → saídas absorvem o excesso da nova abertura
        const { updates, resumo } = await calcularSincronizacaoPreview(dbClient, id_arquivo, cod_item, aberturaAjustada);

        await dbClient.query('BEGIN');
        for (const up of updates) {
            await dbClient.query(`
                UPDATE lmc_movimentacao
                SET estq_abert_ajustado = $1,
                    vol_saidas_ajustado = $2,
                    fech_fisico_ajustado = $3,
                    val_perda_ajustado = $4,
                    val_ganho_ajustado = $5,
                    vol_escr_ajustado = $6,
                    vol_entr_ajustado = vol_entr
                WHERE id = $7
            `, [up.abertura, up.saida, up.fisico, up.perda, up.ganho, up.escritural, up.id]);
        }
        await dbClient.query('COMMIT');

        logger.info(`Correcao distribuicao: arquivo=${id_arquivo} cod_item=${cod_item} abertura=${aberturaAjustada.toFixed(3)} vendas_antes=${resumo.vendas_antes.toFixed(3)} vendas_depois=${resumo.vendas_depois.toFixed(3)}`);
        res.json({ success: true, resumo });
    } catch (e) {
        await safeRollback(dbClient);
        logger.error('Erro ao corrigir distribuição:', e);
        res.status(500).json({ error: e.message });
    } finally {
        dbClient.release();
    }
});

app.post('/api/lmc/otimizador-matematico', authMiddleware, async (req, res) => {
    const { id_arquivo, cod_item, volume_alvo, auto } = req.body;

    if (!id_arquivo || !cod_item) {
        return res.status(400).json({ error: "Parâmetros incompletos (id_arquivo, cod_item)" });
    }

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
                SUM(vol_entr)            as vol_entr,
                SUM(vol_saidas)          as vol_saidas,
                SUM(estq_abert)          as estq_abert,
                SUM(estq_abert_ajustado) as estq_abert_ajustado,
                SUM(fech_fisico)         as fech_fisico,
                SUM(val_perda)           as val_perda,
                SUM(val_ganho)           as val_ganho
            FROM lmc_movimentacao
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            GROUP BY data_mov
            ORDER BY data_mov ASC
        `, [id_arquivo, cod_item]);

        const dailyItems = resLmcConsolidado.rows;
        if (dailyItems.length === 0) {
            await safeRollback(dbClient);
            return res.status(404).json({ error: "Nenhum registro LMC encontrado." });
        }

        // 3. Buscar todos os registros originais para redistribuição final
        const resLmcOriginal = await dbClient.query(`
            SELECT id, data_mov, vol_saidas, vol_entr, estq_abert, fech_fisico, num_tanque
            FROM lmc_movimentacao
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            ORDER BY data_mov ASC, num_tanque ASC
        `, [id_arquivo, cod_item]);

        // Normalizar datas para comparação (converter para string ISO date para evitar diferenças de timezone)
        const normalizeDate = (d) => {
            if (!d) return null;
            if (typeof d === 'string') return d.split('T')[0];
            return d.toISOString().split('T')[0];
        };

        const originalRows = resLmcOriginal.rows.map(r => ({
            ...r,
            data_mov_normalized: normalizeDate(r.data_mov)
        }));

        // Mapear dailyItems com datas normalizadas
        const dailyItemsNormalized = dailyItems.map(d => ({
            ...d,
            data_mov_normalized: normalizeDate(d.data_mov)
        }));

        // 4. Calcular Otimização no Consolidado Diário

        let aberturaInicialConsolidada = parseFloat(dailyItemsNormalized[0].estq_abert_ajustado ?? dailyItemsNormalized[0].estq_abert ?? 0);

        // NOVA TRAVA: Blindagem contra Lixo do PDV (Ex: SPED com Estoque Negativo já no dia 01)
        // O caso "CHAPADA_02_2026" começa com o dia 1 registrando -17L de estoque de fechamento.
        // O algoritmo matemático quebra por não aceitar estoques impossíveis.
        if (aberturaInicialConsolidada < 0) {
            logger.warn(`[MOTOR MATEMATICO] ATENÇÃO: Identificado Estoque Inicial Consolidado Negativo (${aberturaInicialConsolidada}L). Resetando sumariamente para 0.5L para viabilizar as cascatas.`);
            aberturaInicialConsolidada = 0.5;
        }

        let calcs = dailyItemsNormalized.map(row => ({
            data_mov: row.data_mov,
            data_mov_normalized: row.data_mov_normalized,
            entradasOrig: parseFloat(row.vol_entr   || 0),
            saidaOrig:    parseFloat(row.vol_saidas || 0),
            saidaCalc:    parseFloat(row.vol_saidas || 0),
            fisicoOrig:   parseFloat(row.fech_fisico || 0),
            perdaOrig:    parseFloat(row.val_perda   || 0),
            ganhoOrig:    parseFloat(row.val_ganho   || 0),
            abertCalc: 0, escrCalc: 0, fisicoCalc: 0
        }));

        // 4.0 MOTOR V7: Curandeiro Analítico (Saneador Profilático)
        // Resolve erros bizarros do PDV original onde Venda Original > Estoque Físico.
        // Tira o volume impossível do dia, forçando o motor iterativo a recolocar esse volume em dias válidos.
        // CORREÇÃO: Nunca zera saída completamente se o SPED original tinha venda (NFC-e comprova).
        let tempStock = aberturaInicialConsolidada;
        for (let i = 0; i < calcs.length; i++) {
            let c = calcs[i];
            let maxSaidaPermitida = tempStock + c.entradasOrig - 0.5; // Deixa 0.5 de fundo de tanque
            if (c.saidaCalc > maxSaidaPermitida) {
                // Trava fiscal: se havia saída real no SPED (NFC-e), manter mínimo simbólico
                const minimoFiscal = c.saidaOrig > 0 ? Math.max(0.001, c.saidaOrig * 0.001) : 0;
                c.saidaCalc = Math.max(minimoFiscal, maxSaidaPermitida);
            }
            tempStock = tempStock + c.entradasOrig - c.saidaCalc;
            // FASE 3: Âncora — se medição real do tanque (fech_fisico original) > estoque calculado,
            // usar a medição como piso (houve entrada não declarada, combustível real existia)
            if (c.fisicoOrig > tempStock && c.fisicoOrig > 0 && c.saidaOrig > 0) {
                tempStock = c.fisicoOrig;
            }
        }

        // 4.1 MOTOR V5: Trava Inviolável de Venda Mínima (Física + ANP)
        // Calculamos quanto de combustível entra no mês e quanto cabe no tanque.
        // Se a venda for muito baixa, o tanque transborda (teoria).

        // Auto-mode: usa soma das vendas originais do SPED quando não há volume_alvo
        const totalVendasOriginais = calcs.reduce((s, c) => s + c.saidaOrig, 0);
        let targetReal = (auto || !volume_alvo)
            ? totalVendasOriginais
            : parseFloat(volume_alvo);
        let infoTrava = auto ? "Auto-otimização: volume alvo calculado automaticamente das vendas originais." : "";

        if (capacidadeTotal > 0) {
            let totalEntradasMes = calcs.reduce((acc, c) => acc + c.entradasOrig, 0);
            let margemSegurancaANP = 0.0055; // 0.55% para ficar abaixo dos 0.60%

            // Equação: Abertura + Entradas - Vendas - Perda/Ganho = Final
            // Para ser mácimo estoque (transbordar), o Ganho deve ser máximo.
            // Venda Mínima = Abertura Inicial + Total Entradas - (Capacidade Tanque * (1 + Margem))
            // Mas precisamos checar o PICO acumulado, não só o final do mês.

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

        // 4.2 TRAVA FISCAL: Nenhum dia com venda real (NFC-e) pode ter saída zerada
        // Aplica APÓS toda a redistribuição iterativa como rede de segurança final.
        for (let c of calcs) {
            if (c.saidaCalc <= 0 && c.saidaOrig > 0) {
                c.saidaCalc = Math.max(0.001, c.saidaOrig * 0.001);
                logger.warn(`[TRAVA FISCAL] Dia ${c.data_mov_normalized} (cod_item=${cod_item}): saída era 0 mas SPED original=${c.saidaOrig.toFixed(3)}L. Forçado mínimo=${c.saidaCalc.toFixed(3)}L.`);
            }
        }

        // 5. Redistribuir e Salvar (Volta para os tanques originais com cascata rigorosa)
        const updates = [];
        const lastClosingByTank = new Map(); // Para rastrear a cascata por tanque individual

        for (let i = 0; i < calcs.length; i++) {
            const dayCalc = calcs[i];
            const rowsDoDia = originalRows.filter(r => r.data_mov_normalized === dayCalc.data_mov_normalized);

            let totalSaidaOriginalDia = rowsDoDia.reduce((acc, r) => acc + parseFloat(r.vol_saidas || 0), 0);
            let totalFisicoOriginalDia = rowsDoDia.reduce((acc, r) => acc + parseFloat(r.fech_fisico || 0), 0);

            // Recalcula cascata com abertura real acumulada via fisicoCalc anterior
            dayCalc.abertCalc = i === 0 ? aberturaInicialConsolidada : calcs[i - 1].fisicoCalc;
            dayCalc.escrCalc  = Math.max(0, dayCalc.abertCalc + dayCalc.entradasOrig - dayCalc.saidaCalc);

            // Cap ANP correto: % = |diff|/físico ≤ 0,60%
            // capPerda: perdaNova/(escrCalc − perdaNova) ≤ 0.006 → cap = escrCalc × 0.006/1.006
            // capGanho: ganhoNovo/(escrCalc + ganhoNovo) ≤ 0.006 → cap = escrCalc × 0.006/0.994
            const capPerdaOtim = dayCalc.escrCalc * (0.006 / 1.006);
            const capGanhoOtim = dayCalc.escrCalc * (0.006 / 0.994);
            const perdaNovaOtim = Math.min(dayCalc.perdaOrig, capPerdaOtim);
            const ganhoNovoOtim = Math.min(dayCalc.ganhoOrig, capGanhoOtim);
            dayCalc.fisicoCalc = Math.max(0, dayCalc.escrCalc + ganhoNovoOtim - perdaNovaOtim);
            if (capacidadeTotal > 0 && dayCalc.fisicoCalc > capacidadeTotal * 0.99) {
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
                if (aAjustada === undefined) {
                    // Primeiro dia: distribui aberturaInicialConsolidada proporcionalmente
                    // pelos tanques, respeitando ajustes do SINCRONIZAR (evita loop de divergência).
                    const totalAbertDia = rowsDoDia.reduce((sum, x) => sum + parseFloat(x.estq_abert || 0), 0);
                    const peso = totalAbertDia > 0 ? parseFloat(r.estq_abert || 0) / totalAbertDia : (1 / rowsDoDia.length);
                    aAjustada = aberturaInicialConsolidada * peso;
                }

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

        // PROTEÇÃO 3: Validação de Integridade da Cascata (segunda função)
        const aberturaPrimeiroDiaOtim = aberturaInicialConsolidada;
        const fechamentoUltimoDiaOtim = calcs[calcs.length - 1].fisicoCalc;

        if (aberturaPrimeiroDiaOtim > 0 && fechamentoUltimoDiaOtim < 0.5) {
            logger.warn(`[OTIMIZADOR INTEGRIDADE] ⚠️  Fechamento final crítico: ${fechamentoUltimoDiaOtim.toFixed(3)}L (mínimo obrigatório=0.5L). Possível erro de entrada/saída no SPED. Revise os dados.`);
            infoTrava = `Atenção crítica: Fechamento final muito baixo (${fechamentoUltimoDiaOtim.toFixed(3)}L). Verifique integridade das entradas e saídas.`;
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
        await safeRollback(dbClient);
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('BEGIN');
        await deleteSpedFile(arquivoId, dbClient);
        await dbClient.query('COMMIT');
        res.json({ message: "Período e dados residuais excluídos com sucesso." });
    } catch (error) {
        if (dbClient) await safeRollback(dbClient);
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('BEGIN');
        for (const id of ids) {
            await deleteSpedFile(parseInt(id), dbClient);
        }
        await dbClient.query('COMMIT');
        res.json({ message: `${ids.length} períodos excluídos com sucesso.` });
    } catch (error) {
        if (dbClient) await safeRollback(dbClient);
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
                doc.chv_nfe,
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

// --- NFe COMPLETA (todos os campos + Cálculo do Imposto) por chave de acesso ---
// Fontes (nesta ordem): tabela nfe_completa (persistida na injeção) → pasta speds/ → mde_cache/espiao.
// Quando não há XML, devolve fonte='sped' e nfe=null (frontend mostra o que há do C100/C170/C190).
app.get('/api/documentos/nfe-completa/:chave', authMiddleware, async (req, res) => {
    const chave = String(req.params.chave || '').replace(/\D/g, '');
    if (chave.length !== 44) {
        return res.status(400).json({ message: 'Chave de acesso inválida (esperados 44 dígitos).' });
    }
    try {
        const r = await buscarNfeCompleta(pool, chave, { spedsDir: path.join(__dirname, '..', 'speds') });
        return res.status(200).json({ chave, fonte: r.fonte, nfe: r.nfe, motivo: r.motivo || null });
    } catch (e) {
        logger.error('[nfe-completa] erro:', e.message);
        return res.status(500).json({ message: 'Erro ao montar a NFe completa.', error: e.message });
    }
});

// --- ROTA DE CONSULTA DE NF DE SAIDA (MODELO 55 e 65) ---
app.get('/api/documentos/auditoria/saidas/:id_arquivo', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    const modelo = req.query.modelo || '55';
    if (isNaN(arquivoId)) return res.status(400).send({ message: "ID de arquivo inválido." });

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

// ROTA REMOVIDA: duplicata de app.get('/api/empresas') definida anteriormente (~linha 2484).
// Em Express, apenas a primeira definição é usada. Esta era código morto.

// --- ROTA PARA CRIAR EMPRESA ---
app.post('/api/empresas', authMiddleware, async (req, res) => {
    logger.info('Recebida requisição para CRIAR empresa.');
    const { cnpj, nome_empresa, uf, nome_fantasia } = req.body;

    if (!cnpj || !nome_empresa) {
        return res.status(400).json({ message: 'CNPJ e Nome da Empresa são obrigatórios.' });
    }

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('BEGIN');
        
        // Verificar se CNPJ já existe
        const verificaCnpj = await dbClient.query('SELECT id FROM empresas WHERE cnpj = $1', [cnpj]);
        if (verificaCnpj.rows.length > 0) {
            await safeRollback(dbClient);
            return res.status(400).json({ message: 'Já existe uma empresa cadastrada com este CNPJ.' });
        }

        const query = `
            INSERT INTO empresas (cnpj, nome_empresa, uf, nome_fantasia)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const params = [cnpj, nome_empresa, uf || null, nome_fantasia || null];
        const { rows } = await dbClient.query(query, params);

        await dbClient.query('COMMIT');
        logger.info(`Empresa criada com sucesso ID: ${rows[0].id}`);
        res.status(201).json(rows[0]);
    } catch (error) {
        await safeRollback(dbClient);
        logger.error('--- ERRO AO CRIAR EMPRESA ---', { message: error.message, stack: error.stack });
        res.status(500).json({ message: "Erro ao criar empresa no banco de dados.", error: error.message });
    } finally {
        dbClient.release();
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

// --- ROTA PARA EXCLUIR EMPRESA ---
app.delete('/api/empresas/:id', authMiddleware, async (req, res) => {
    const idEmpresa = parseInt(req.params.id);
    const { cascade } = req.query; // se true, exclui tudo da empresa

    if (isNaN(idEmpresa)) {
        return res.status(400).send({ message: "ID de empresa inválido." });
    }

    logger.info(`Recebida requisição para excluir empresa ID: ${idEmpresa}, cascade: ${cascade}`);
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query('BEGIN');

        // Busca o CNPJ antes de excluir para limpar lmc_tanques_config
        const empresaRes = await dbClient.query('SELECT cnpj FROM empresas WHERE id = $1', [idEmpresa]);
        if (empresaRes.rowCount === 0) {
            await safeRollback(dbClient);
            return res.status(404).json({ message: "Empresa não encontrada." });
        }
        const cnpjEmpresa = empresaRes.rows[0].cnpj;

        if (cascade === 'true') {
            const filesResult = await dbClient.query('SELECT id FROM sped_arquivos WHERE id_empresa = $1', [idEmpresa]);
            const fileIds = filesResult.rows.map(row => row.id);

            if (fileIds.length > 0) {
                // 1. Erros de análise
                await dbClient.query('DELETE FROM erros_analise WHERE id_sped_arquivo = ANY($1::int[])', [fileIds]);
                
                // 2. Itens e Registros vinculados a Documentos C100 (via subquery de documentos)
                await dbClient.query('DELETE FROM documentos_itens_c170 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = ANY($1::int[]))', [fileIds]);
                await dbClient.query('DELETE FROM documentos_c190 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = ANY($1::int[]))', [fileIds]);
                
                // 3. Documentos mestres
                await dbClient.query('DELETE FROM documentos_c100 WHERE id_sped_arquivo = ANY($1::int[])', [fileIds]);
                await dbClient.query('DELETE FROM documentos_d100 WHERE id_sped_arquivo = ANY($1::int[])', [fileIds]);
                
                // 4. LMC, Produtos e Participantes
                await dbClient.query('DELETE FROM lmc_movimentacao WHERE id_sped_arquivo = ANY($1::int[])', [fileIds]);
                await dbClient.query('DELETE FROM sped_produtos WHERE id_sped_arquivo = ANY($1::int[])', [fileIds]);
                await dbClient.query('DELETE FROM sped_participantes WHERE id_sped_arquivo = ANY($1::int[])', [fileIds]);
                
                // 5. Arquivos SPED
                await dbClient.query('DELETE FROM sped_arquivos WHERE id_empresa = $1', [idEmpresa]);
            }

            // 6. Dados específicos da empresa (fora dos arquivos)
            await dbClient.query('DELETE FROM empresa_certificados WHERE id_empresa = $1', [idEmpresa]);
            if (cnpjEmpresa) {
                await dbClient.query('DELETE FROM lmc_tanques_config WHERE cnpj = $1', [cnpjEmpresa]);
            }
        }

        const deleteResult = await dbClient.query('DELETE FROM empresas WHERE id = $1 RETURNING id', [idEmpresa]);
        
        await dbClient.query('COMMIT');
        logger.info(`Empresa ID: ${idEmpresa} excluída com sucesso.`);
        res.status(200).json({ message: 'Empresa excluída com sucesso.' });
    } catch (error) {
        if (dbClient) await safeRollback(dbClient);
        logger.error(`Erro ao excluir empresa ID ${idEmpresa}:`, error);
        res.status(500).json({ message: "Erro ao excluir empresa.", error: error.message });
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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


// --- ROTA DE RENTABILIDADE E POSIÇÃO DE ESTOQUE (PRO) ---
app.get('/api/relatorio/rentabilidade/:id_arquivo', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) {
        return res.status(400).send({ message: "ID de arquivo inválido." });
    }

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const query = `
            WITH params AS (
                SELECT id_empresa FROM sped_arquivos WHERE id = $1
            ),
            vendas_periodo AS (
                SELECT 
                    it.cod_item,
                    SUM(it.qtd::float8) as qtd_vendida,
                    SUM(it.vl_item::float8) as total_venda
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '1'
                GROUP BY it.cod_item
            ),
            compras_periodo AS (
                SELECT 
                    it.cod_item,
                    SUM(it.qtd::float8) as qtd_comprada,
                    SUM(it.vl_item::float8) as total_compra
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '0'
                GROUP BY it.cod_item
            ),
            ultima_venda AS (
                -- Preço unitário da última venda conhecida da empresa (global)
                SELECT DISTINCT ON (it.cod_item)
                    it.cod_item,
                    (it.vl_item::float8 / NULLIF(it.qtd::float8, 0)) as preco_unitario
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                JOIN sped_arquivos a ON c100.id_sped_arquivo = a.id
                WHERE a.id_empresa = (SELECT id_empresa FROM params)
                  AND c100.ind_oper = '1'
                  AND it.qtd > 0
                ORDER BY it.cod_item, c100.dt_doc DESC, c100.id DESC
            ),
            ultima_compra AS (
                -- Preço unitário da última compra conhecida da empresa (global)
                SELECT DISTINCT ON (it.cod_item)
                    it.cod_item,
                    (it.vl_item::float8 / NULLIF(it.qtd::float8, 0)) as preco_unitario
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                JOIN sped_arquivos a ON c100.id_sped_arquivo = a.id
                WHERE a.id_empresa = (SELECT id_empresa FROM params)
                  AND c100.ind_oper = '0'
                  AND it.qtd > 0
                ORDER BY it.cod_item, c100.dt_doc DESC, c100.id DESC
            ),
            estoque_lmc AS (
                SELECT 
                    lmc.cod_item,
                    (SELECT SUM(e1.estq_abert::float8) FROM lmc_movimentacao e1 
                     WHERE e1.id_sped_arquivo = $1 AND e1.cod_item = lmc.cod_item 
                     AND e1.data_mov = (SELECT MIN(data_mov) FROM lmc_movimentacao WHERE id_sped_arquivo = $1 AND cod_item = lmc.cod_item)) as estoque_inicial_lmc,
                    (SELECT SUM(COALESCE(e2.fech_fisico_ajustado, e2.fech_fisico)::float8) FROM lmc_movimentacao e2 
                     WHERE e2.id_sped_arquivo = $1 AND e2.cod_item = lmc.cod_item 
                     AND e2.data_mov = (SELECT MAX(data_mov) FROM lmc_movimentacao WHERE id_sped_arquivo = $1 AND cod_item = lmc.cod_item)) as estoque_final_lmc,
                    SUM(COALESCE(vol_saidas_ajustado, vol_saidas)::float8) as qtd_vendida_lmc
                FROM lmc_movimentacao lmc
                WHERE lmc.id_sped_arquivo = $1
                GROUP BY lmc.cod_item
            )
            SELECT 
                p.cod_item,
                p.descr_item as produto,
                COALESCE(v.qtd_vendida, l.qtd_vendida_lmc, 0) as qtd_vendida,
                COALESCE(l.estoque_inicial_lmc, 0) as estoque_inicial,
                COALESCE(l.estoque_final_lmc, 0) as estoque_final,
                v.total_venda,
                c.total_compra,
                c.qtd_comprada,
                uv.preco_unitario as preco_ultima_venda,
                uc.preco_unitario as preco_ultima_compra,
                l.qtd_vendida_lmc
            FROM sped_produtos p
            LEFT JOIN vendas_periodo v ON p.cod_item = v.cod_item
            LEFT JOIN compras_periodo c ON p.cod_item = c.cod_item
            LEFT JOIN estoque_lmc l ON p.cod_item = l.cod_item
            LEFT JOIN ultima_venda uv ON p.cod_item = uv.cod_item
            LEFT JOIN ultima_compra uc ON p.cod_item = uc.cod_item
            WHERE p.id_sped_arquivo = $1
            ORDER BY p.descr_item;
        `;

        const { rows } = await dbClient.query(query, [arquivoId]);

        const relatorio = rows.map(r => {
            // Prioridade Custo: Média do mês -> Se 0, Última Compra conhecida
            const custoMedio = r.qtd_comprada > 0 ? (r.total_compra / r.qtd_comprada) : (r.preco_ultima_compra || 0);

            return {
                codigo: r.cod_item,
                produto: r.produto,
                grupo: r.estoque_inicial > 0 || r.estoque_final > 0 || r.qtd_vendida_lmc > 0 ? 'COMBUSTÍVEIS' : 'OUTROS',
                estoque_inicial: r.estoque_inicial,
                qtd_comprada: r.qtd_comprada,
                qtd_vendida: r.qtd_vendida,
                estoque_final: r.estoque_final,
                custo_medio: custoMedio,
                usou_historico_custo: r.qtd_comprada <= 0 && r.preco_ultima_compra > 0
            };
        }).filter(r => r.qtd_vendida > 0 || r.estoque_final > 0 || r.estoque_inicial > 0 || r.qtd_comprada > 0);

        res.status(200).json(relatorio);
    } catch (error) {
        logger.error('--- ERRO AO GERAR RELATÓRIO DE RENTABILIDADE ---', { message: error.message });
        res.status(500).json({ message: "Erro ao processar rentabilidade.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});
app.get('/api/relatorio/rentabilidade/:id_arquivo/pdf', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    const { grupo } = req.query; // Captura o filtro de grupo enviado pelo frontend
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        // 1. Buscar Informações da Empresa e Arquivo
        const fileQuery = `
            SELECT a.periodo_apuracao, e.nome_empresa, e.cnpj 
            FROM sped_arquivos a
            JOIN empresas e ON a.id_empresa = e.id
            WHERE a.id = $1
        `;
        const fileRes = await dbClient.query(fileQuery, [arquivoId]);
        if (fileRes.rows.length === 0) return res.status(404).send("Arquivo não encontrado.");
        const info = fileRes.rows[0];

        // 2. Buscar Dados do Relatório
        const dataQuery = `
            WITH params AS (SELECT id_empresa FROM sped_arquivos WHERE id = $1),
            vendas_periodo AS (
                SELECT it.cod_item, SUM(it.qtd::float8) as qtd, SUM(it.vl_item::float8) as total
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '1'
                GROUP BY it.cod_item
            ),
            compras_periodo AS (
                SELECT it.cod_item, SUM(it.qtd::float8) as qtd, SUM(it.vl_item::float8) as total
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                WHERE c100.id_sped_arquivo = $1 AND c100.ind_oper = '0'
                GROUP BY it.cod_item
            ),
            ultima_compra AS (
                SELECT DISTINCT ON (it.cod_item) it.cod_item, (it.vl_item::float8 / NULLIF(it.qtd::float8, 0)) as preco
                FROM documentos_itens_c170 it
                JOIN documentos_c100 c100 ON it.id_documento_c100 = c100.id
                JOIN sped_arquivos a ON c100.id_sped_arquivo = a.id
                WHERE a.id_empresa = (SELECT id_empresa FROM params) AND c100.ind_oper = '0' AND it.qtd > 0
                ORDER BY it.cod_item, c100.dt_doc DESC, c100.id DESC
            ),
            estoque_lmc AS (
                SELECT lmc.cod_item,
                    (SELECT SUM(e1.estq_abert::float8) FROM lmc_movimentacao e1 WHERE e1.id_sped_arquivo = $1 AND e1.cod_item = lmc.cod_item AND e1.data_mov = (SELECT MIN(data_mov) FROM lmc_movimentacao WHERE id_sped_arquivo = $1 AND cod_item = lmc.cod_item)) as inicial,
                    (SELECT SUM(COALESCE(e2.fech_fisico_ajustado, e2.fech_fisico)::float8) FROM lmc_movimentacao e2 WHERE e2.id_sped_arquivo = $1 AND e2.cod_item = lmc.cod_item AND e2.data_mov = (SELECT MAX(data_mov) FROM lmc_movimentacao WHERE id_sped_arquivo = $1 AND cod_item = lmc.cod_item)) as final,
                    SUM(COALESCE(vol_saidas_ajustado, vol_saidas)::float8) as saidas_lmc
                FROM lmc_movimentacao lmc
                WHERE lmc.id_sped_arquivo = $1
                GROUP BY lmc.cod_item
            )
            SELECT p.cod_item, p.descr_item, COALESCE(l.inicial, 0) as inicial, 
                   COALESCE(c.qtd, 0) as entradas, COALESCE(v.qtd, l.saidas_lmc, 0) as saídas, COALESCE(l.final, 0) as final,
                   COALESCE(c.total / NULLIF(c.qtd, 0), uc.preco, 0) as custo_medio,
                   CASE WHEN l.cod_item IS NOT NULL THEN 'COMBUSTÍVEIS' ELSE 'OUTROS' END as grupo_item
            FROM sped_produtos p
            LEFT JOIN vendas_periodo v ON p.cod_item = v.cod_item
            LEFT JOIN compras_periodo c ON p.cod_item = c.cod_item
            LEFT JOIN estoque_lmc l ON p.cod_item = l.cod_item
            LEFT JOIN ultima_compra uc ON p.cod_item = uc.cod_item
            WHERE p.id_sped_arquivo = $1
            ORDER BY p.descr_item
        `;
        const { rows } = await dbClient.query(dataQuery, [arquivoId]);

        // Aplicar filtro de grupo e limpar itens sem movimentação/estoque
        let data = rows.filter(r => r.inicial > 0 || r.entradas > 0 || r.saídas > 0 || r.final > 0);
        if (grupo && grupo !== 'TODOS') {
            data = data.filter(r => r.grupo_item === grupo);
        }

        // 3. Gerar o PDF
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Posicao_Estoque_${info.cnpj}.pdf`);
        doc.pipe(res);

        // Cabeçalho
        doc.font('Helvetica-Bold').fontSize(16).text('POSIÇÃO DO ESTOQUE', { align: 'center' });
        doc.moveDown(0.2);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#059669').text(grupo ? `Filtro: ${grupo}` : 'Filtro: TODOS', { align: 'center' });
        doc.fillColor('#000000').moveDown(0.5);

        doc.fontSize(10).font('Helvetica').text(`Empresa: ${info.nome_empresa}`, { align: 'left' });
        doc.text(`CNPJ: ${info.cnpj}`);
        doc.text(`Período: ${info.periodo_apuracao}`);
        doc.moveDown();
        doc.rect(30, doc.y, 535, 1).fill('#cbd5e1');
        doc.moveDown();

        // Tabela
        const startX = 30;
        const colWidths = [60, 180, 60, 60, 60, 60, 55];
        const headers = ['Código', 'Produto', 'Est. Inic.', 'Entradas', 'Vendas', 'Est. Final', 'Custo (M)'];

        // Desenhar Header da Tabela
        let currentY = doc.y;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569');
        headers.forEach((h, i) => {
            const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
            doc.text(h, x, currentY, { width: colWidths[i], align: i > 1 ? 'right' : 'left' });
        });
        doc.moveDown(0.5);
        doc.rect(30, doc.y, 535, 0.5).fill('#f1f5f9');
        doc.moveDown(0.5);

        // Linhas da Tabela
        doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
        data.forEach((row, idx) => {
            if (doc.y > 750) {
                doc.addPage();
                // Repetir cabeçalho da tabela em nova página (opcional, mas bom)
                currentY = 30;
                doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569');
                headers.forEach((h, i) => {
                    const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
                    doc.text(h, x, currentY, { width: colWidths[i], align: i > 1 ? 'right' : 'left' });
                });
                doc.moveDown(0.8);
                doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
            }

            currentY = doc.y;

            // Fundo zebrado
            if (idx % 2 === 0) {
                doc.rect(30, currentY - 2, 535, 12).fill('#f8fafc').fillColor('#1e293b');
            }

            const vals = [
                row.cod_item,
                row.descr_item.substring(0, 35),
                row.inicial.toFixed(2),
                row.entradas.toFixed(2),
                row.saídas.toFixed(2),
                row.final.toFixed(2),
                'R$ ' + row.custo_medio.toFixed(2)
            ];

            vals.forEach((v, i) => {
                const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
                doc.text(v, x, currentY, { width: colWidths[i], align: i > 1 ? 'right' : 'left' });
            });
            doc.moveDown(1.2);
        });

        doc.end();
    } catch (error) {
        logger.error('Erro na exportação de PDF:', error);
        res.status(500).send("Erro interno ao gerar PDF.");
    } finally {
        dbClient.release();
    }
});

// --- CONFIGURAÇÃO DE CAPACIDADE DE TANQUES (LMC) ---

// Buscar configurações de tanques para um CNPJ
app.get('/api/lmc/tanques-config/:cnpj', authMiddleware, async (req, res) => {
    const cnpj = req.params.cnpj;
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

// Sugerir capacidades de tanques a partir dos registros 1310 do arquivo SPED original
app.get('/api/lmc/tanques-sugeridos/:id_arquivo', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_arquivo);
    if (isNaN(arquivoId)) return res.status(400).json({ message: 'ID inválido.' });

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const arqInfo = await dbClient.query('SELECT caminho_arquivo FROM sped_arquivos WHERE id = $1', [arquivoId]);
        if (!arqInfo.rows.length) return res.status(404).json({ message: 'Arquivo não encontrado.' });

        let pathFile = arqInfo.rows[0].caminho_arquivo;
        try {
            const parsed = JSON.parse(pathFile);
            if (parsed && typeof parsed === 'object') pathFile = Object.values(parsed)[0];
        } catch (e) { /* string simples */ }

        if (!pathFile || !fs.existsSync(pathFile)) return res.json([]);

        const fileContent = fs.readFileSync(pathFile, 'latin1');
        const lines = fileContent.split(/\r?\n/);

        let layoutVersion = '019';
        let currentCodItem = null;
        const capsPorItem = {}; // { cod_item: { num_tanque: maxCap } }

        for (const line of lines) {
            if (!line || !line.startsWith('|')) continue;
            const f = line.split('|');
            const reg = f[1];

            if (reg === '0000') {
                layoutVersion = f[2] || '019';
            } else if (reg === '1300') {
                currentCodItem = f[2] || null;
            } else if (reg === '1310' && currentCodItem) {
                const numTanque = f[2];
                // CAP_TANQUE existe apenas no layout 020 (campo f[11])
                const cap = layoutVersion >= '020' ? (parseFloat(f[11]) || 0) : 0;
                if (cap > 0) {
                    if (!capsPorItem[currentCodItem]) capsPorItem[currentCodItem] = {};
                    // Guarda a maior capacidade vista para esse tanque (mesmo tanque aparece todos os dias)
                    capsPorItem[currentCodItem][numTanque] = Math.max(
                        capsPorItem[currentCodItem][numTanque] || 0,
                        cap
                    );
                }
            }
        }

        // Soma as capacidades de cada tanque para obter a capacidade total por combustível
        const result = Object.entries(capsPorItem).map(([cod_item, tanques]) => ({
            cod_item,
            capacidade: Object.values(tanques).reduce((sum, c) => sum + c, 0)
        }));

        res.json(result);
    } catch (err) {
        logger.error('Erro ao sugerir capacidades de tanques:', err);
        res.status(500).json({ message: 'Erro ao ler capacidades do SPED.' });
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
        await safeRollback(dbClient);
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
        if (dbClient) await safeRollback(dbClient);
        logger.error('Erro ao corrigir item:', error);
        res.status(500).send({ message: "Erro ao aplicar correção.", error: error.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE CORREÇÃO EM MASSA (FASE 5) ---
app.post('/api/corrigir-massa', authMiddleware, async (req, res) => {
    const { id_arquivo, regra_id, novos_valores } = req.body;
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
        if (dbClient) await safeRollback(dbClient);
        logger.error('Erro na correção em massa:', error);
        res.status(500).json({ message: "Erro ao aplicar correção em massa.", error: error.message });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// --- AJUSTAR VENDA DE UM DIA COM CASCATA ---
app.post('/api/lmc/ajustar-cascata', authMiddleware, async (req, res) => {
    const { id_sped, cod_item, data_mov, vol_saidas_ajustado } = req.body;
    if (!id_sped || !cod_item || !data_mov || vol_saidas_ajustado === undefined) {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        // Busca todos os dias do produto ordenados
        const { rows } = await dbClient.query(`
            SELECT id, data_mov,
                   COALESCE(estq_abert_ajustado, estq_abert)   AS abertura,
                   COALESCE(vol_entr_ajustado, vol_entr)        AS entradas,
                   COALESCE(vol_saidas_ajustado, vol_saidas)    AS saidas,
                   val_perda, val_ganho,
                   COALESCE(estq_abert, 0) AS estq_abert_orig,
                   COALESCE(vol_entr, 0)   AS vol_entr_orig
            FROM lmc_movimentacao
            WHERE id_sped_arquivo = $1 AND cod_item = $2
            ORDER BY data_mov ASC
        `, [id_sped, cod_item]);

        const alvo = new Date(data_mov).toISOString().split('T')[0];
        const editIndex = rows.findIndex(r => {
            const d = new Date(r.data_mov);
            return d.toISOString().split('T')[0] === alvo;
        });
        if (editIndex === -1) return res.status(404).json({ error: 'Dia não encontrado.' });

        await dbClient.query('BEGIN');

        let prevFisico = null;
        for (let i = editIndex; i < rows.length; i++) {
            const row = rows[i];
            const novaAbertura = i === editIndex
                ? parseFloat(row.abertura)
                : prevFisico;
            const entradas = parseFloat(row.entradas);

            // Saída: usa o novo valor no dia editado, mantém o atual nos demais
            let saida = i === editIndex
                ? parseFloat(vol_saidas_ajustado)
                : parseFloat(row.saidas);

            // Garante que saída não deixa estoque negativo (mínimo 0.5 L)
            const maxSaida = Math.max(0, novaAbertura + entradas - 0.5);
            saida = Math.min(saida, maxSaida);

            // ANP: escritural calculado antes do cap para usar como base correta
            const escritural  = Math.max(0, novaAbertura + entradas - saida);

            // Cap correto para % = |diff| / físico ≤ 0,60%:
            //   perda: perdaNova / (escritural − perdaNova) ≤ 0.006 → cap = escritural × 0.006/1.006
            //   ganho: ganhoNovo / (escritural + ganhoNovo) ≤ 0.006 → cap = escritural × 0.006/0.994
            const baseOrig = parseFloat(row.estq_abert_orig) + parseFloat(row.vol_entr_orig);
            const volBase  = novaAbertura + entradas;
            const pctPerda = baseOrig > 0 ? parseFloat(row.val_perda || 0) / baseOrig : 0;
            const pctGanho = baseOrig > 0 ? parseFloat(row.val_ganho || 0) / baseOrig : 0;
            const capPerda = escritural * (0.006 / 1.006);
            const capGanho = escritural * (0.006 / 0.994);
            const perdaNova = Math.min(pctPerda * volBase, capPerda);
            const ganhoNovo = Math.min(pctGanho * volBase, capGanho);

            const novoFisico  = Math.max(0, escritural + (ganhoNovo - perdaNova));

            await dbClient.query(`
                UPDATE lmc_movimentacao
                SET estq_abert_ajustado  = $1,
                    vol_saidas_ajustado  = $2,
                    fech_fisico_ajustado = $3,
                    val_perda_ajustado   = $4,
                    val_ganho_ajustado   = $5,
                    vol_escr_ajustado    = $6
                WHERE id = $7
            `, [novaAbertura, saida, novoFisico, perdaNova, ganhoNovo, escritural, row.id]);

            prevFisico = novoFisico;
        }

        // PROTEÇÃO 3: Validação de Integridade da Cascata Manual
        const aberturaPrimeiroDiaCascata = parseFloat(rows[0].abertura || 0);
        const fechamentoUltimoDiaCascata = prevFisico;

        if (aberturaPrimeiroDiaCascata > 0 && fechamentoUltimoDiaCascata < 0.5) {
            logger.warn(`[CASCATA MANUAL INTEGRIDADE] ⚠️  Fechamento final crítico: ${fechamentoUltimoDiaCascata.toFixed(3)}L (mínimo obrigatório=0.5L). A alteração resultou em estoque crítico. Revise a saída ajustada.`);
        }

        await dbClient.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await safeRollback(dbClient);
        logger.error('Erro em ajustar-cascata:', e);
        res.status(500).json({ error: e.message });
    } finally {
        dbClient.release();
    }
});

// --- FIM DOS AJUSTES LMC ---


// --- SALVAR AJUSTE NO LMC ---
app.post('/api/lmc/ajustar', authMiddleware, async (req, res) => {
    const { id_sped, cod_item, data_mov, vol_saidas_ajustado } = req.body;

    if (!id_sped || !cod_item || !data_mov) {
        return res.status(400).send({ message: "Dados insuficientes para atualização." });
    }

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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

    const dbClient = await safeConnect(res);
    if (!dbClient) return;
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
        await safeRollback(dbClient);
        logger.error('Erro ao ajustar LMC em lote:', error);
        res.status(500).send("Erro ao salvar os ajustes.");
    } finally {
        dbClient.release();
    }
});

// --- ROTAS DE OBSERVAÇÕES DO LMC ---
app.get('/api/lmc/observacoes/:id_sped', authMiddleware, async (req, res) => {
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const r = await dbClient.query(
            'SELECT cod_item, data_mov, observacao FROM lmc_observacoes WHERE id_sped_arquivo = $1 ORDER BY data_mov, cod_item',
            [parseInt(req.params.id_sped)]
        );
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
    finally { dbClient.release(); }
});

app.post('/api/lmc/observacoes', authMiddleware, async (req, res) => {
    const { id_sped_arquivo, cod_item, data_mov, observacao } = req.body;
    if (!id_sped_arquivo || !cod_item || !data_mov) return res.status(400).json({ error: 'Parâmetros obrigatórios' });
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        await dbClient.query(`
            INSERT INTO lmc_observacoes (id_sped_arquivo, cod_item, data_mov, observacao)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id_sped_arquivo, cod_item, data_mov)
            DO UPDATE SET observacao = $4
        `, [id_sped_arquivo, cod_item.trim(), data_mov, observacao || '']);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
    finally { dbClient.release(); }
});

// --- ROTA DE IMPRESSÃO DO LMC (PDF modelo AutoSystem) ---
app.get('/api/lmc/imprimir/:id_sped', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id_sped);
    if (isNaN(arquivoId)) return res.status(400).json({ error: 'ID inválido' });

    const combustivelFiltro = req.query.combustivel || 'todos';
    const dataInicio = req.query.data_inicio || null;
    const dataFim = req.query.data_fim || null;
    const folhaInicial = parseInt(req.query.folha_inicial || '1');

    const dbClient = await safeConnect(res);
    if (!dbClient) return;

    try {
        const PDFDocument = require('pdfkit');
        const { gerarPaginaLMC } = require('./lmc-pdf');

        // 1. Info da empresa
        const arqRes = await dbClient.query('SELECT * FROM sped_arquivos WHERE id = $1', [arquivoId]);
        if (arqRes.rows.length === 0) return res.status(404).json({ error: 'Arquivo não encontrado' });
        const arq = arqRes.rows[0];
        const cnpj = arq.cnpj_empresa.replace(/\D/g, '');

        const empRes = await dbClient.query('SELECT * FROM empresas WHERE cnpj = $1', [cnpj]);
        const emp = empRes.rows[0] || {};
        const empresa = {
            razao_social: emp.nome_empresa || 'N/A',
            cnpj: cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
            ie: 'N/A'
        };

        // Buscar IE do SPED original
        try {
            const spContent = fs.readFileSync(arq.caminho_arquivo, 'latin1');
            const m0005 = spContent.match(/\|0005\|[^|]*\|/);
            const m0000 = spContent.match(/\|0000\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|([^|]*)\|/);
            if (m0000) empresa.ie = m0000[1] || 'N/A';
        } catch(_) {}

        // 2. Produtos/combustíveis disponíveis
        // Nomes dos produtos — filtrar apenas combustíveis
        const prodNomes = {};
        const nomesRes = await dbClient.query('SELECT DISTINCT TRIM(cod_item) as cod_item, descr_item FROM sped_produtos WHERE id_sped_arquivo = $1', [arquivoId]);
        const termosCombustivel = ['GASOLINA', 'ETANOL', 'DIESEL', 'GNV', 'BIODIESEL', 'QUEROSENE', 'GLP', 'ALCOOL'];
        nomesRes.rows.forEach(r => {
            const nome = (r.descr_item || '').toUpperCase();
            if (termosCombustivel.some(t => nome.includes(t))) {
                prodNomes[r.cod_item.trim()] = r.descr_item;
            }
        });

        let prodQuery = `SELECT DISTINCT TRIM(cod_item) as cod_item FROM lmc_movimentacao WHERE id_sped_arquivo = $1`;
        const prodParams = [arquivoId];
        if (combustivelFiltro !== 'todos') {
            prodQuery += ` AND TRIM(cod_item) = $2`;
            prodParams.push(combustivelFiltro.trim());
        }
        const produtos = await dbClient.query(prodQuery, prodParams);

        // 3. Dados LMC por dia/produto
        let lmcQuery = `
            SELECT data_mov, cod_item, num_tanque,
                COALESCE(estq_abert_ajustado::numeric, estq_abert::numeric) as estq_abert,
                COALESCE(vol_entr_ajustado::numeric, vol_entr::numeric) as vol_entr,
                COALESCE(vol_saidas_ajustado::numeric, vol_saidas::numeric) as vol_saidas,
                COALESCE(fech_fisico_ajustado::numeric, fech_fisico::numeric) as fech_fisico,
                COALESCE(val_perda_ajustado::numeric, val_perda::numeric) as val_perda,
                COALESCE(val_ganho_ajustado::numeric, val_ganho::numeric) as val_ganho
            FROM lmc_movimentacao WHERE id_sped_arquivo = $1
        `;
        const lmcParams = [arquivoId];
        if (combustivelFiltro !== 'todos') {
            lmcQuery += ` AND TRIM(cod_item) = $2`;
            lmcParams.push(combustivelFiltro.trim());
        }
        if (dataInicio) { lmcQuery += ` AND data_mov >= $${lmcParams.length + 1}`; lmcParams.push(dataInicio); }
        if (dataFim) { lmcQuery += ` AND data_mov <= $${lmcParams.length + 1}`; lmcParams.push(dataFim); }
        lmcQuery += ` ORDER BY data_mov, cod_item, num_tanque`;
        const lmcRowsRaw = await dbClient.query(lmcQuery, lmcParams);
        // Filtrar apenas combustíveis (produtos que estão em prodNomes)
        const lmcRows = { rows: lmcRowsRaw.rows.filter(r => prodNomes[r.cod_item.trim()]) };

        // 4. Encerrantes (1320) do SPED original
        const bicosData = {};
        try {
            const spContent = fs.readFileSync(arq.caminho_arquivo, 'latin1');
            const lines = spContent.split(/\r?\n/);
            let curr1300Dt = '', curr1300Cod = '', currTanque = '';
            for (const line of lines) {
                const p = line.split('|');
                if (p[1] === '1300') { curr1300Dt = p[3]; curr1300Cod = (p[2]||'').trim(); }
                if (p[1] === '1310') { currTanque = p[2]; }
                if (p[1] === '1320' && curr1300Dt) {
                    const key = `${curr1300Dt}_${curr1300Cod}`;
                    if (!bicosData[key]) bicosData[key] = [];
                    bicosData[key].push({
                        tanque: currTanque, num: p[2],
                        enc_final: parseFloat((p[8]||'0').replace(',','.')),
                        enc_inicial: parseFloat((p[9]||'0').replace(',','.')),
                        aferição: parseFloat((p[10]||'0').replace(',','.')),
                        vendas: parseFloat((p[11]||'0').replace(',','.'))
                    });
                }
            }
        } catch(_) {}

        // 5. Agrupar LMC por dia/produto
        const diasProdutos = new Map();
        for (const row of lmcRows.rows) {
            const dt = row.data_mov.toISOString().split('T')[0];
            const cod = row.cod_item.trim();
            const key = `${dt}_${cod}`;
            if (!diasProdutos.has(key)) diasProdutos.set(key, { dt, cod, tanques: [], total: null });
            const dp = diasProdutos.get(key);

            if (row.num_tanque === '0' || dp.tanques.length === 0) {
                dp.total = {
                    abertura: parseFloat(row.estq_abert), entradas: parseFloat(row.vol_entr),
                    saidas: parseFloat(row.vol_saidas), fechamento: parseFloat(row.fech_fisico),
                    perda: parseFloat(row.val_perda), ganho: parseFloat(row.val_ganho)
                };
            }
            if (row.num_tanque !== '0') {
                dp.tanques.push({
                    num: row.num_tanque, abertura: parseFloat(row.estq_abert),
                    fechamento: parseFloat(row.fech_fisico)
                });
            }
        }

        // 6. NF-e de entrada por dia/produto (notas de compra de combustível)
        const entradasMap = {};
        try {
            const combustiveisCods = Object.keys(prodNomes);
            if (combustiveisCods.length > 0) {
                const entRes = await dbClient.query(`
                    SELECT c.dt_doc, c.num_doc, COALESCE(c.dt_e_s, c.dt_doc) as dt_entrada,
                           TRIM(i.cod_item) as cod_item, SUM(i.qtd::numeric) as volume
                    FROM documentos_c100 c
                    JOIN documentos_itens_c170 i ON c.id = i.id_documento_c100
                    WHERE c.id_sped_arquivo = $1
                      AND c.cod_mod IN ('01','55')
                      AND SUBSTRING(i.cfop, 1, 1) IN ('1','2','3')
                    GROUP BY c.dt_doc, c.num_doc, dt_entrada, i.cod_item
                    ORDER BY dt_entrada, c.num_doc
                `, [arquivoId]);

                for (const row of entRes.rows) {
                    const cod = row.cod_item.trim();
                    if (!prodNomes[cod]) continue; // filtrar só combustíveis
                    const dt = row.dt_entrada;
                    if (!dt) continue;
                    const dtStr = dt.toISOString().split('T')[0];
                    const key = `${dtStr}_${cod}`;
                    if (!entradasMap[key]) entradasMap[key] = [];
                    entradasMap[key].push({
                        num_doc: row.num_doc,
                        volume: parseFloat(row.volume)
                    });
                }
            }
        } catch(e) { logger.warn('Erro ao buscar NF-e entrada para LMC PDF:', e.message); }

        // 6.4 Valor de vendas por dia (NFC-e totais + distribuição proporcional por volume LMC)
        const nfceTotalDia = {};
        const lmcTotalDia = {};
        const lmcProdDia = {};
        try {
            // Total NFC-e por dia
            const nfceRes = await dbClient.query(`
                SELECT dt_doc, SUM(vl_doc::numeric) as total
                FROM documentos_c100
                WHERE id_sped_arquivo = $1 AND cod_mod = '65' AND ind_oper = '1'
                GROUP BY dt_doc
            `, [arquivoId]);
            for (const row of nfceRes.rows) {
                if (!row.dt_doc) continue;
                nfceTotalDia[row.dt_doc.toISOString().split('T')[0]] = parseFloat(row.total);
            }
            // Total litros LMC por dia (todos os combustíveis somados) e por produto
            const lmcTotRes = await dbClient.query(`
                SELECT data_mov, TRIM(cod_item) as cod_item, SUM(vol_saidas::numeric) as litros
                FROM lmc_movimentacao
                WHERE id_sped_arquivo = $1 AND num_tanque = '0'
                GROUP BY data_mov, cod_item
            `, [arquivoId]);
            for (const row of lmcTotRes.rows) {
                const dtStr = row.data_mov.toISOString().split('T')[0];
                const cod = row.cod_item.trim();
                if (!prodNomes[cod]) continue;
                const litros = parseFloat(row.litros);
                lmcProdDia[`${dtStr}_${cod}`] = litros;
                lmcTotalDia[dtStr] = (lmcTotalDia[dtStr] || 0) + litros;
            }
        } catch(e) { logger.warn('Erro ao buscar totais NFC-e para LMC PDF:', e.message); }

        // 6.5 Observações do LMC
        const obsMap = {};
        try {
            const obsRes = await dbClient.query(
                'SELECT cod_item, data_mov, observacao FROM lmc_observacoes WHERE id_sped_arquivo = $1',
                [arquivoId]
            );
            obsRes.rows.forEach(r => {
                const dt = r.data_mov.toISOString().split('T')[0];
                obsMap[`${dt}_${r.cod_item.trim()}`] = r.observacao;
            });
        } catch(_) {}

        // 7. Gerar PDF
        const doc = new PDFDocument({ size: 'A4', margin: 30, bufferPages: true, autoFirstPage: true });
        res.setHeader('Content-Type', 'application/pdf');
        const nomeEmpresa = (emp.nome_fantasia || emp.nome_empresa || 'LMC')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').substring(0, 25);
        res.setHeader('Content-Disposition', `inline; filename=LMC_${nomeEmpresa}_${arq.periodo_apuracao.substring(0,7)}.pdf`);
        doc.pipe(res);

        let pageNum = folhaInicial;
        let litrosAcumulado = {};
        let valorAcumulado = {};

        for (const [key, dp] of diasProdutos) {
            if (pageNum > folhaInicial) doc.addPage();

            const dd = dp.dt.substring(8,10), mm = dp.dt.substring(5,7), yy = dp.dt.substring(0,4);
            const dataFormatada = `${dd}/${mm}/${yy}`;
            const dtSped = `${dd}${mm}${yy}`;

            const est = dp.total || { abertura: 0, entradas: 0, saidas: 0, fechamento: 0, perda: 0, ganho: 0 };
            est.disponivel = est.abertura + est.entradas;
            est.escritural = est.disponivel - est.saidas;

            // Acumulado de litros no mês por produto
            if (!litrosAcumulado[dp.cod]) litrosAcumulado[dp.cod] = 0;
            litrosAcumulado[dp.cod] += est.saidas;

            // Valor das vendas do dia — proporcional ao volume do produto no total NFC-e
            const nfceTotal = nfceTotalDia[dp.dt] || 0;
            const litrosProd = lmcProdDia[`${dp.dt}_${dp.cod}`] || est.saidas;
            const litrosDia = lmcTotalDia[dp.dt] || 1;
            const valorDia = litrosDia > 0 ? nfceTotal * (litrosProd / litrosDia) : 0;
            const precoMedio = litrosProd > 0 ? valorDia / litrosProd : 0;
            if (!valorAcumulado[dp.cod]) valorAcumulado[dp.cod] = 0;
            valorAcumulado[dp.cod] += valorDia;

            const bicos = bicosData[`${dtSped}_${dp.cod}`] || [];

            gerarPaginaLMC(doc, {
                empresa,
                combustivel: { nome: prodNomes[dp.cod] || dp.cod, cod: dp.cod },
                data: dataFormatada,
                tanques: dp.tanques.length > 0 ? dp.tanques : [{ num: '1', abertura: est.abertura, fechamento: est.fechamento }],
                bicos: bicos.map(b => ({ ...b, preco: precoMedio > 0 ? precoMedio : null })),
                estoque: est,
                entradas: entradasMap[`${dp.dt}_${dp.cod}`] || [],
                observacao: obsMap[`${dp.dt}_${dp.cod}`] || '',
                vendas: { valor_dia: valorDia || null, valor_acumulado: valorAcumulado[dp.cod] || null, preco_medio: precoMedio || null, litros_acumulado: litrosAcumulado[dp.cod] }
            }, pageNum);

            pageNum++;
        }

        if (diasProdutos.size === 0) {
            doc.fontSize(14).text('Nenhum dado de LMC encontrado para os filtros selecionados.', 40, 100);
        }

        doc.end();

    } catch (error) {
        logger.error('Erro ao gerar PDF do LMC:', error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTA DE EXPORTAÇÃO RETIFICADA (FASE 10) ---
app.get('/api/exportar-sped/:id', authMiddleware, async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    await acquireHeavySlot();
    const dbClient = await safeConnect(res);
    if (!dbClient) { releaseHeavySlot(); return; }

    try {
        // 1. Buscar info do arquivo e ajustes
        const arqInfo = await dbClient.query('SELECT * FROM sped_arquivos WHERE id = $1', [arquivoId]);
        if (arqInfo.rows.length === 0) return res.status(404).send('Arquivo não encontrado.');

        let pathOrig = arqInfo.rows[0].caminho_arquivo;
        // caminho_arquivo pode ser JSON string {"sped":"/path/..."} (uploads antigos) ou string simples
        try {
            const parsed = JSON.parse(pathOrig);
            if (parsed && typeof parsed === 'object') {
                pathOrig = Object.values(parsed)[0];
            }
        } catch (e) {
            // É string simples, usa diretamente
        }
        if (!pathOrig || !fs.existsSync(pathOrig)) {
            return res.status(400).send('O arquivo físico original não foi localizado no servidor para retificação (Upload antigo).');
        }

        const ajustes = await dbClient.query(`
            SELECT data_mov, cod_item,
                   vol_saidas_ajustado, fech_fisico_ajustado, fech_fisico,
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

        // 1.1b Mapa base: fech_fisico do banco para TODOS os registros (garante FECH_FISICO correto
        //       mesmo em arquivos onde o original tem VAL_AJ_PERDA = ESTQ_ESCR → FECH = 0)
        const allLmcFech = await dbClient.query(`
            SELECT data_mov, cod_item,
                   COALESCE(fech_fisico_ajustado::numeric, fech_fisico::numeric, 0) AS fech_fisico
            FROM lmc_movimentacao WHERE id_sped_arquivo = $1
        `, [arquivoId]);
        const mapBaseFisico = new Map();
        allLmcFech.rows.forEach(r => {
            const d = new Date(r.data_mov);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            mapBaseFisico.set(`${y}-${m}-${day}_${r.cod_item}`, parseFloat(r.fech_fisico || 0));
        });

        // 1.2 Buscar configs de capacidades e ajustes C100/C190 para este arquivo
        const configs = await dbClient.query('SELECT cod_item, capacidade FROM lmc_tanques_config WHERE cnpj = $1', [arqInfo.rows[0].cnpj_empresa]);
        const mapCapacidades = new Map(); // Mantido vazio por compatibilidade
        const mapCapacidadesPorItem = new Map();
        configs.rows.forEach(r => {
            const cap = parseFloat(r.capacidade);
            if (r.cod_item) mapCapacidadesPorItem.set(r.cod_item, cap);
        });
        const ajustesC100 = await dbClient.query('SELECT num_doc, vl_doc_ajustado, chv_nfe FROM documentos_c100 WHERE id_sped_arquivo = $1 AND vl_doc_ajustado IS NOT NULL', [arquivoId]);
        const mapC100 = new Map(ajustesC100.rows.map(r => [r.num_doc + '_' + (r.chv_nfe || ''), r.vl_doc_ajustado]));

        const ajustesC190 = await dbClient.query(`
            SELECT r190.id, r190.cst_icms, r190.cfop, r190.aliq_icms, r190.vl_opr_ajustado, r190.vl_bc_icms_ajustado, r190.vl_icms_ajustado, doc.num_doc, doc.chv_nfe
            FROM documentos_c190 r190
            JOIN documentos_c100 doc ON r190.id_documento_c100 = doc.id
            WHERE doc.id_sped_arquivo = $1 AND (r190.vl_opr_ajustado IS NOT NULL OR r190.vl_bc_icms_ajustado IS NOT NULL OR r190.vl_icms_ajustado IS NOT NULL)
        `, [arquivoId]);
        const mapC190 = new Map(ajustesC190.rows.map(r => [`${r.num_doc}_${r.chv_nfe || ''}_${r.cst_icms}_${r.cfop}_${parseFloat(r.aliq_icms).toFixed(2)}`, r]));

        const c170Itens = await dbClient.query(`
            SELECT doc.num_doc, doc.chv_nfe, item.num_item, item.cod_item, item.cst_icms, item.cfop, item.cst_pis, item.cst_cofins
            FROM documentos_itens_c170 item
            JOIN documentos_c100 doc ON item.id_documento_c100 = doc.id
            WHERE doc.id_sped_arquivo = $1
        `, [arquivoId]);
        const mapC170 = new Map(c170Itens.rows.map(r => [`${r.num_doc}_${r.chv_nfe || ''}_${r.num_item}_${r.cod_item}`, r]));

        // 1.3 Coletar COD_ITEMs referenciados em outros blocos (C170 e LMC 1300)
        // O validador do SPED exige que todo 0200 tenha ao menos uma referência em outro bloco.
        const itensC170 = await dbClient.query(
            'SELECT DISTINCT cod_item FROM documentos_itens_c170 WHERE id_documento_c100 IN (SELECT id FROM documentos_c100 WHERE id_sped_arquivo = $1)',
            [arquivoId]
        );
        const itensLmc = await dbClient.query(
            'SELECT DISTINCT cod_item FROM lmc_movimentacao WHERE id_sped_arquivo = $1',
            [arquivoId]
        );
        // Pré-scan do arquivo: coleta COD_ITEMs referenciados em QUALQUER registro
        // que não seja 0200/0206 — cobre H010 (inventário), D170, G110, K200, etc.
        // Mapas de posição do COD_ITEM por tipo de registro:
        //   posição 2 (pf[2]): H010, 1300, G110, K200, K210, K220, K230, K235, K250, K255
        //   posição 3 (pf[3]): C170, C176, D170, D500, D201, D205
        const REG_CODITEM_POS2 = new Set(['H010','1300','G110','K200','K210','K220','K230','K235','K250','K255']);
        const REG_CODITEM_POS3 = new Set(['C170','C176','D170','D500','D201','D205']);
        const codItensArquivoExtra = new Set();
        // Conta ocorrências de H010 por cod_item — usado para reescrever QTD do inventário
        // apenas quando o produto tem 1 único H010 (evita quebrar splits por IND_PROP).
        const h010CountByCod = new Map();
        // Detecta presença de 0000 e dias com 1300 no arquivo de origem.
        let temReg0000 = false;
        const dias1300NoArquivo = new Set();
        {
            // Pré-scan via readFileSync: evita problema de file descriptor em FUSE/Google Drive
            // onde dois createReadStream consecutivos ao mesmo arquivo fazem o segundo começar
            // do meio, perdendo o bloco 0 (0000, 0001, 0200, etc.) do SPED exportado.
            const prescanContent = fs.readFileSync(pathOrig, 'latin1');
            const prescanLines = prescanContent.split(/\r?\n/);
            for (const pl of prescanLines) {
                if (pl.trim() === '') continue;
                const pf = pl.split('|');
                if (pf.length < 3) continue;
                const reg = pf[1];
                if (reg === '0000') temReg0000 = true;
                // TRIM defensivo: SPEDs CHAR-fixo gravam cod_item com padding. Sem TRIM o set
                // fica com versão padded e o filtro 0200 abaixo não reconhece o item, omitindo
                // todos os 0200/0206 no arquivo exportado (rejeitado pelo PVA).
                if (REG_CODITEM_POS2.has(reg) && pf[2]) codItensArquivoExtra.add(String(pf[2]).trim());
                if (REG_CODITEM_POS3.has(reg) && pf[3]) codItensArquivoExtra.add(String(pf[3]).trim());
                if (reg === 'H010' && pf[2]) {
                    const k = String(pf[2]).trim();
                    h010CountByCod.set(k, (h010CountByCod.get(k) || 0) + 1);
                }
                if (reg === '1300' && pf[3] && pf[3].length === 8) {
                    const dt = pf[3];
                    dias1300NoArquivo.add(`${dt.substring(4,8)}-${dt.substring(2,4)}-${dt.substring(0,2)}`);
                }
            }
        }

        // Bloqueio: arquivo de origem sem registro 0000 não pode gerar SPED válido.
        // Devolve 422 com mensagem clara em vez de produzir um arquivo quebrado.
        if (!temReg0000) {
            logger.error(`[Export] Arquivo ${arquivoId} não contém registro 0000. Export abortado.`);
            return res.status(422).send('Arquivo SPED de origem inválido: registro 0000 ausente. Reimporte o arquivo correto antes de exportar.');
        }
        // Aviso de lacuna no 1300 é emitido mais abaixo, após `periodoApuracao` ser definido.

        // Mapa de fech_fisico final do LMC por cod_item (último dia do período).
        // Usado para reescrever QTD/VL_ITEM do H010 e fechar a "Posição do Estoque"
        // com o estoque final do LMC ajustado.
        const fechFinalLmc = await dbClient.query(`
            SELECT DISTINCT ON (TRIM(cod_item)) TRIM(cod_item) AS cod_item,
                   COALESCE(fech_fisico_ajustado::numeric, fech_fisico::numeric, 0) AS fech
            FROM lmc_movimentacao
            WHERE id_sped_arquivo = $1
            ORDER BY TRIM(cod_item), data_mov DESC
        `, [arquivoId]);
        const mapFechFinalLmc = new Map();
        fechFinalLmc.rows.forEach(r => {
            const f = parseFloat(r.fech);
            if (f >= 0) mapFechFinalLmc.set(r.cod_item, f);
        });

        const codItensReferenciados = new Set([
            ...itensC170.rows.map(r => String(r.cod_item).trim()),
            ...itensLmc.rows.map(r => String(r.cod_item).trim()),
            ...codItensArquivoExtra
        ]);
        logger.info(`[Export 0200] ${codItensReferenciados.size} COD_ITEMs referenciados (DB+arquivo) para o arquivo ID ${arquivoId}.`);

        // 2. Processar o arquivo original e substituir pipes
        logger.info(`Iniciando exportação retificada: Arquivo ID ${arquivoId}, Path: ${pathOrig}`);
        // Leitura via readFileSync + split: elimina bug de FUSE/Google Drive onde
        // createReadStream começava do meio do arquivo (perdia bloco 0 inteiro).
        const fileContent = fs.readFileSync(pathOrig, 'latin1');
        let fileLines = fileContent.split(/\r?\n/);

        // Deduplicar D100 (CT-e duplicados no arquivo original)
        {
            const d100Keys = new Set();
            let skipD100 = false;
            const dedupLines = [];
            let dedupCount = 0;
            for (const line of fileLines) {
                if (!line || !line.startsWith('|')) { dedupLines.push(line); continue; }
                const reg = line.split('|')[1];
                if (reg === 'D100') {
                    const f = line.split('|');
                    const key = `${f[9]}_${f[5]}_${f[6]}_${f[7]}_${f[8]}_${f[10]}_${f[4]}`;
                    if (d100Keys.has(key)) { skipD100 = true; dedupCount++; continue; }
                    d100Keys.add(key);
                    skipD100 = false;
                } else if (skipD100 && reg && reg.startsWith('D') && reg > 'D100' && reg < 'D200') {
                    continue;
                } else { skipD100 = false; }
                dedupLines.push(line);
            }
            if (dedupCount > 0) {
                fileLines = dedupLines;
                logger.info(`[Export] Removidos ${dedupCount} D100 duplicados do arquivo ${arquivoId}.`);
            }
        }

        // Deduplicar C100 por chave de acesso (NF-e reinjetada gera C100 repetido no arquivo).
        // Espelha o dedup de D100: remove a 2ª+ ocorrência de uma chave e seus filhos C1xx (C170/C190 etc).
        // Chave de acesso vazia NUNCA é deduplicada (evita fundir notas distintas sem chave).
        {
            const c100Keys = new Set();
            let skipC100 = false;
            const dedupLines = [];
            let dedupCount = 0;
            for (const line of fileLines) {
                if (!line || !line.startsWith('|')) { dedupLines.push(line); continue; }
                const reg = line.split('|')[1];
                if (reg === 'C100') {
                    const chave = (line.split('|')[9] || '').trim();
                    if (chave && c100Keys.has(chave)) { skipC100 = true; dedupCount++; continue; }
                    if (chave) c100Keys.add(chave);
                    skipC100 = false;
                } else if (skipC100 && reg && reg.startsWith('C') && reg > 'C100' && reg < 'C200') {
                    continue;
                } else { skipC100 = false; }
                dedupLines.push(line);
            }
            if (dedupCount > 0) {
                fileLines = dedupLines;
                logger.info(`[Export] Removidos ${dedupCount} C100 duplicados (chave repetida) do arquivo ${arquivoId}.`);
            }
        }

        const cnpjArq = String(arqInfo.rows[0].cnpj_empresa || '').replace(/\D/g, '');
        const periodoApuracao = String(arqInfo.rows[0].periodo_apuracao || '');

        // OPÇÃO A: correções manuais do 1320 (auditor) entram como BASE do recálculo do bico.
        // Map key = 'YYYY-MM-DD|cod_item|num_bico'. Map vazio => export 100% idêntico ao atual.
        const correcoes1320 = new Map();
        try {
            const _c1320 = await dbClient.query(
                `SELECT data_mov, cod_item, num_bico, enc_ini_corrigido, enc_fin_corrigido, qtd_af_corrigido
                 FROM sped_1320 WHERE id_sped_arquivo = $1 AND corrigido = TRUE`, [arquivoId]);
            for (const c of _c1320.rows) {
                const iso = (c.data_mov instanceof Date) ? c.data_mov.toISOString().split('T')[0] : String(c.data_mov).substring(0, 10);
                correcoes1320.set(`${iso}|${String(c.cod_item || '').trim()}|${String(c.num_bico || '').trim()}`, {
                    enc_ini: Number(c.enc_ini_corrigido || 0),
                    enc_fin: Number(c.enc_fin_corrigido || 0),
                    qtd_af: Number(c.qtd_af_corrigido || 0)
                });
            }
            if (correcoes1320.size > 0) logger.info(`[Export] ${correcoes1320.size} correção(ões) manuais de 1320 carregadas.`);
        } catch (e) { logger.warn('[Export] sped_1320 indisponível (sem correções 1320): ' + e.message); }
        // periodo_apuracao formato: "YYYY-MM-DD a YYYY-MM-DD"
        let periodoIniArq = '';
        let periodoFimArq = '';
        let periodoLabel = '';
        const partesArq = periodoApuracao.split(' a ');
        if (partesArq.length === 2) {
            const [a0, m0, d0] = partesArq[0].trim().split('-');
            const [a1, m1, d1] = partesArq[1].trim().split('-');
            if (d0 && m0 && a0) periodoIniArq = `${d0}${m0}${a0}`;
            if (d1 && m1 && a1) periodoFimArq = `${d1}${m1}${a1}`;
            if (a0 && m0) periodoLabel = `${m0}-${a0}`;
        }
        // Buscar nome fantasia ou razão social da empresa
        let nomeArquivo = '';
        try {
            const empRes = await dbClient.query(
                `SELECT COALESCE(nome_fantasia, nome_empresa) as nome FROM empresas WHERE cnpj = $1`,
                [cnpjArq]
            );
            if (empRes.rows.length > 0 && empRes.rows[0].nome) {
                // Limpar: sem acentos, sem caracteres especiais, sem espaços (underscore)
                nomeArquivo = empRes.rows[0].nome
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
                    .replace(/[^a-zA-Z0-9]/g, '_')                   // só letras, números, _
                    .replace(/_+/g, '_')                              // múltiplos _ → um só
                    .replace(/^_|_$/g, '')                            // remove _ no início/fim
                    .substring(0, 30)                                 // máximo 30 caracteres
                    .toUpperCase();
            }
        } catch (_) { /* fallback: sem nome */ }
        const safeName = nomeArquivo && periodoLabel
            ? `${cnpjArq}_${nomeArquivo}_${periodoLabel}.txt`
            : periodoLabel
                ? `${cnpjArq}_${periodoLabel}.txt`
                : `${cnpjArq}_${periodoApuracao.replace(/[\s\/\\:*?"<>|]+/g, '_')}.txt`;
        res.setHeader('Content-disposition', `attachment; filename=${encodeURIComponent(safeName)}`);
        res.setHeader('Content-type', 'text/plain; charset=iso-8859-1');

        // Detecta lacuna no 1300 do arquivo de origem (não bloqueia — apenas alerta no log
        // e no header X-Export-Lmc-Lacuna). Usa dias1300NoArquivo coletado no pré-scan.
        if (periodoApuracao && periodoApuracao.includes(' a ')) {
            const [pIni, pFim] = periodoApuracao.split(' a ').map(s => s.trim());
            if (/^\d{4}-\d{2}-\d{2}$/.test(pIni) && /^\d{4}-\d{2}-\d{2}$/.test(pFim)) {
                const [yi, mi, di] = pIni.split('-').map(Number);
                const [yf, mf, df] = pFim.split('-').map(Number);
                const ini = new Date(Date.UTC(yi, mi - 1, di));
                const fim = new Date(Date.UTC(yf, mf - 1, df));
                const faltantes = [];
                for (let d = new Date(ini); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
                    const iso = d.toISOString().slice(0, 10);
                    if (!dias1300NoArquivo.has(iso)) faltantes.push(iso);
                }
                if (faltantes.length > 0) {
                    logger.warn(`[Export] LMC INCOMPLETO no arquivo ${arquivoId}: ${faltantes.length} dia(s) sem 1300 (${faltantes.slice(0,5).join(', ')}${faltantes.length > 5 ? '…' : ''}).`);
                    res.setHeader('X-Export-Lmc-Lacuna', JSON.stringify({ total: faltantes.length, dias: faltantes }));
                }
            }
        }

        let linesProcessed = 0;
        let changesApplied = 0;
        let lastC100 = { numDoc: '', chvNfe: '' };

        let encerrantesBombasMap = {}; // Rastreador global contínuo (Bico -> Último Encerrante Final)
        const ultimoEncOrigPorBico = new Map(); // Bico -> enc_inic original do último processamento (detecção multiproduto)

        // ── Fix B: período do arquivo (DDMMYYYY) para autocorreção de COD_SIT ──
        // Convertidos para Date (UTC) no bloco 0000 para comparação com DT_E_S
        let periodoIniDate = null; // Date UTC do primeiro dia do período
        let periodoFimDate = null; // Date UTC do último dia do período
        // ── Fix C: rastrear 0150 presentes e CNPJs referenciados no 1601 ──
        const set0150CnpjsPresentes = new Set(); // CNPJs que já têm 0150 no arquivo
        const map1601Participantes = new Map();  // CNPJ -> { cod_part, nome } vindos do 1601

        let pending1300 = null;
        let pending1310s = [];
        let pending1320s = {}; // Dicionário de Bicos { "idxAfericao": [array of fields...], ... }
        let layoutVersion = '019'; // Default para 2025 e anteriores
        // Correção 3: propagar continuidade — ABERT do dia N = FECH exportado do dia N-1
        const ultimoFechExportado = new Map(); // cod_item -> fech_fisico

        // Correção 4: continuidade INTERMENSAL — ABERT do 1º dia do mês = FECH do último dia
        // do mês anterior do mesmo CNPJ. Prioridade:
        //   1) encerrantes_exportados (garante ABERT = FECH exportado do mês anterior)
        //   2) lmc_movimentacao (fallback quando não há exportação anterior)
        // A âncora na flush1300Group garante que o FECH exportado = valor do banco,
        // eliminando a inflação do escudo ANP.
        if (cnpjArq && periodoApuracao) {
            const competenciaAtual = periodoApuracao.substring(0, 7); // 'YYYY-MM'
            const [anoAt, mesAt] = competenciaAtual.split('-').map(Number);
            const mesAnterior = mesAt === 1
                ? `${anoAt - 1}-12`
                : `${anoAt}-${String(mesAt - 1).padStart(2, '0')}`;
            const cnpjNum = cnpjArq.replace(/\D/g, '');

            // Fonte 1: encerrantes realmente exportados (garante continuidade entre arquivos)
            const resExportados = await dbClient.query(`
                SELECT cod_item, fech_fisico_exportado AS fech
                FROM encerrantes_exportados
                WHERE cnpj_empresa = $1 AND competencia = $2
            `, [cnpjNum, mesAnterior]);
            resExportados.rows.forEach(r => {
                const f = parseFloat(r.fech);
                if (f > 0) ultimoFechExportado.set(r.cod_item.trim(), f);
            });
            if (resExportados.rowCount > 0) {
                logger.info(`[Export 1300] Continuidade intermensal: ${resExportados.rowCount} fechamentos do mês anterior (encerrantes_exportados) para arquivo ${arquivoId}.`);
            }

            // Fonte 2 (fallback): lmc_movimentacao — só para produtos sem exportação anterior
            const fechMesAnt = await dbClient.query(`
                WITH atual AS (
                    SELECT REGEXP_REPLACE($1,'[^0-9]','','g') AS cnpj_num,
                           LEFT($2, 7) AS ym
                ),
                arquivo_anterior AS (
                    SELECT sa.id, sa.periodo_apuracao
                    FROM sped_arquivos sa, atual
                    WHERE REGEXP_REPLACE(sa.cnpj_empresa,'[^0-9]','','g') = atual.cnpj_num
                      AND sa.id <> $3
                      AND sa.periodo_apuracao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                      AND LEFT(sa.periodo_apuracao, 7) < atual.ym
                    ORDER BY LEFT(sa.periodo_apuracao, 7) DESC
                    LIMIT 1
                )
                SELECT DISTINCT ON (TRIM(m.cod_item))
                    TRIM(m.cod_item) AS cod_item,
                    CASE
                        WHEN COALESCE(m.fech_fisico_ajustado::numeric, 0) > 0 THEN m.fech_fisico_ajustado::numeric
                        WHEN m.fech_fisico::numeric > 0 THEN m.fech_fisico::numeric
                        ELSE 0
                    END AS fech
                FROM lmc_movimentacao m
                CROSS JOIN arquivo_anterior aa
                WHERE m.id_sped_arquivo = aa.id
                  AND m.data_mov::date <= SPLIT_PART(aa.periodo_apuracao, ' a ', 2)::date
                ORDER BY TRIM(m.cod_item), m.data_mov DESC
            `, [cnpjArq, periodoApuracao, arquivoId]);
            fechMesAnt.rows.forEach(r => {
                const codItem = r.cod_item.trim();
                if (!ultimoFechExportado.has(codItem)) {
                    const f = parseFloat(r.fech);
                    if (f > 0) ultimoFechExportado.set(codItem, f);
                }
            });
            if (fechMesAnt.rowCount > 0 && resExportados.rowCount === 0) {
                logger.info(`[Export 1300] Continuidade intermensal (fallback lmc): ${fechMesAnt.rowCount} fechamentos do mês anterior para arquivo ${arquivoId}.`);
            }

            // Continuidade intermensal dos BICOS (1320): carrega VAL_FECHA do último dia do mês anterior
            const resBicosAnt = await dbClient.query(`
                SELECT num_bico, val_fecha
                FROM encerrantes_bicos_exportados
                WHERE cnpj_empresa = $1 AND competencia = $2
            `, [cnpjNum, mesAnterior]);
            resBicosAnt.rows.forEach(r => {
                const v = parseFloat(r.val_fecha);
                if (v > 0) encerrantesBombasMap[r.num_bico] = v;
            });
            if (resBicosAnt.rowCount > 0) {
                logger.info(`[Export 1320] Continuidade bicos: ${resBicosAnt.rowCount} encerrantes do mês anterior para arquivo ${arquivoId}.`);
            }
        }

        // ── MVP Motor de Regras Fiscais (Fase 1: ENFORCEMENT só no export) ──
        // Antes deste MVP o loop era passthrough; o "na unha" CST 60/61⇒PIS/COFINS 04 só existia na
        // injeção/sync. Aqui o export passa a aplicar as Regras Fiscais (cadastro global) na emissão.
        // ensure+seed na própria rota (idempotente) elimina a corrida com o boot fire-and-forget.
        const _compRegras = ((periodoApuracao || '').slice(0, 7) || '2000-01') + '-01';
        let regrasExport = [];
        try {
            await regrasFiscais.ensureTabelasRegras(dbClient);
            await regrasFiscais.seedRegrasFiscais(dbClient);
            regrasExport = await regrasFiscais.carregarRegras(dbClient, _compRegras, 'export');
        } catch (e) {
            logger.warn('[Export] Falha ao carregar regras fiscais (mantendo .txt como veio): ' + e.message);
        }
        if (regrasExport.length === 0) {
            // Sem regras carregadas o enforcement NÃO ocorre — avisa (não silencioso).
            logger.warn(`[Export] NENHUMA regra fiscal aplicada (competência ${_compRegras}). C170 emitido como veio.`);
            if (!res.headersSent) res.setHeader('X-Regras-Fiscais', 'nao-aplicadas');
        }
        // NOTA: a trilha (antes/depois por item) NÃO é coletada no export — ainda não há
        // feature de auditoria que a leia/persista (tabela regras_fiscais_aplicacao não recebe
        // INSERT). Passar ctx.trilha aqui só alocaria 2 snapshots por C170 casado, descartados
        // no fim do export. Quando a auditoria existir, reabilitar passando { trilha } abaixo.

        // Buffer de output: acumula todas as linhas para recalcular 9900/0990/9999 ao final
        const outputLines = [];
        // CFOPs de uso/consumo (entrada): quando o C170 do .txt já está nesses CFOPs, o
        // "forçar uso/consumo" foi aplicado na injeção e é AUTORITATIVO — o export não pode
        // deixá-lo ser revertido pelos valores CRUS de documentos_itens_c170 (que guarda
        // CSOSN do fornecedor Simples como CST e CFOP de saída com o 1º dígito virado → inválido).
        const CFOP_USO_CONSUMO = new Set(['1407', '1556', '2407', '2556']);
        // Normaliza linhas na emissão (cobre qualquer origem, inclusive notas injetadas antes dos fixes):
        //  • 0220: EXATAMENTE 4 campos (REG|UNID_CONV|FAT_CONV|COD_BARRA|) — PVA exige 4.
        //  • C170: aplica as Regras Fiscais (ex.: CST ICMS 60/61 ⇒ PIS/COFINS 04) via motor global.
        const normalizarLinha = (l) => {
            if (typeof l !== 'string') return l;
            if (l.startsWith('|0220|')) {
                const f = l.split('|');
                return `|0220|${f[2] || ''}|${f[3] || ''}|${f[4] || ''}|`;
            }
            if (l.startsWith('|C170|') && regrasExport.length) {
                const f = l.split('|'); // [10]=CST_ICMS, [11]=CFOP, [25]=CST_PIS, [31]=CST_COFINS
                if (f.length < 32) return l; // C170 truncado/atípico: não fabricar índices
                const item = { num_item: f[2], cst_icms: f[10], cfop: f[11], cst_pis: f[25], cst_cofins: f[31] };
                regrasFiscais.aplicarRegrasFiscaisComLista(item, regrasExport, { origem: 'EXPORT' });
                if (item.cst_icms !== f[10] || item.cfop !== f[11] || item.cst_pis !== f[25] || item.cst_cofins !== f[31]) {
                    f[10] = item.cst_icms; f[11] = item.cfop; f[25] = item.cst_pis; f[31] = item.cst_cofins;
                    return f.join('|');
                }
            }
            return l;
        };
        const pushLine = (l) => outputLines.push(normalizarLinha(l));
        // Flag para pular registros filhos (0205, 0206) de um 0200 que foi omitido
        let skipNext0206 = false;

        // ── Recálculo de E210 VL_RETENCAO_ST durante exportação ─────────────
        // Bloco C sempre precede Bloco E. Acumulamos somaRetST ao ler os
        // registros analíticos, com o mesmo filtro de COD_SIT do PVA.
        // E110 NÃO é recalculado aqui — o arquivo já tem E110 correto pós-injeção
        // e a recalculação quebraria a validação E111 "outros débitos".
        let somaRetST = 0;       // E210: VL_RETENCAO_ST acumulado
        let sitExportST = '00';  // COD_SIT do pai atual (para filtro, igual ao PVA)
        let c790CfopExport = ''; // CFOP do C790 pai (para C791)
        const parseSp = s => parseFloat((s || '0').replace(',', '.')) || 0;
        const fmtSp   = v => v.toFixed(2).replace('.', ',');
        // ─────────────────────────────────────────────────────────────────────

        const flush1300Group = () => {
            if (!pending1300) return;

            if (pending1310s.length === 0) {
                // Âncora para registros SEM tanques filhos: se fisicoDb existe, reescrever FECH na linha
                if (novo.fisicoDb !== null && novo.fisicoDb !== undefined && novo.fisicoDb > 0) {
                    const flds = pending1300.line.split('|');
                    const fechLinha = parseFloat((flds[11] || '0').replace(',', '.'));
                    if (Math.abs(fechLinha - novo.fisicoDb) > 0.01) {
                        const escrLinha = parseFloat((flds[8] || '0').replace(',', '.'));
                        const abertLinha = parseFloat((flds[4] || '0').replace(',', '.'));
                        const entrLinha = parseFloat((flds[5] || '0').replace(',', '.'));
                        let p2 = 0, g2 = 0;
                        if (novo.fisicoDb >= escrLinha) { g2 = Number((novo.fisicoDb - escrLinha).toFixed(3)); }
                        else { p2 = Number((escrLinha - novo.fisicoDb).toFixed(3)); }
                        const blind2 = escudoAnpMae(abertLinha, entrLinha, escrLinha, p2, g2);
                        flds[9] = blind2.perda.toFixed(3).replace('.', ',');
                        flds[10] = blind2.ganho.toFixed(3).replace('.', ',');
                        flds[11] = blind2.fisico.toFixed(3).replace('.', ',');
                        pending1300.line = flds.join('|');
                        changesApplied++;
                    }
                }
                // Se não há tanques/filhos, escreve a global diretamente
                pushLine(pending1300.line);
                // Correção 3: armazenar FECH exportado para propagação
                if (pending1300.orig && pending1300.orig.codItem) {
                    const flds = pending1300.line.split('|');
                    const fExportado = parseFloat((flds[11] || '0').replace(',', '.'));
                    if (fExportado > 0) ultimoFechExportado.set(pending1300.orig.codItem, fExportado);
                }
                pending1300 = null;
                return;
            }

            const { orig, novo } = pending1300;

            // Nota: a prioridade de ABERT já é resolvida na entrada do 1300:
            // 1) FECH exportado do dia anterior, 2) abert_adj do banco, 3) original do arquivo.
            // Não forçar orig.abert aqui — o banco (Re-distribuir) tem o valor correto.

            let sumAbert = 0, sumSaida = 0, sumPerda = 0, sumGanho = 0, sumEntr = 0;

            // PASS 1: Totalizadores REAIS blindados pós-escudo ANP
            let realAbert = 0, realEntr = 0, realDisp = 0, realSaida = 0, realEscr = 0, realPerda = 0, realGanho = 0, realFisico = 0;

            for (let i = 0; i < pending1310s.length; i++) {
                let tk = pending1310s[i];
                let isLast = (i === pending1310s.length - 1);

                let tOrigAbert = parseFloat((tk[3] || '0').replace(',', '.'));
                let tOrigEntr = parseFloat((tk[4] || '0').replace(',', '.'));
                let tOrigSaida = parseFloat((tk[6] || '0').replace(',', '.'));

                // Proporções baseadas no movimento original por estoque global
                let pAbert = orig.abert > 0 ? (tOrigAbert / orig.abert) : (1 / pending1310s.length);
                let pEntr = orig.entr > 0 ? (tOrigEntr / orig.entr) : (1 / pending1310s.length);

                // SAÍDA: quando orig.saida = 0, distribuir apenas para tanques que
                // possuem bicos (1320). Tanques de armazenamento puro (sem bicos)
                // recebem saída = 0, evitando divergência 1320 x 1300.
                let pSaida;
                if (orig.saida > 0) {
                    pSaida = tOrigSaida / orig.saida;
                } else {
                    const tanqueCod = tk[2];
                    const temBicos = (pending1320s[tanqueCod] || []).length > 0;
                    const tanquesComBicos = pending1310s.filter(t => (pending1320s[t[2]] || []).length > 0).length;
                    pSaida = temBicos && tanquesComBicos > 0 ? (1 / tanquesComBicos) : 0;
                }

                // Correção 2: proporção inválida = tanques originais corrompidos (encerrantes como estoque)
                if (pAbert < 0 || pAbert > 1) pAbert = 1 / pending1310s.length;
                if (pSaida < 0 || pSaida > 1) pSaida = 1 / pending1310s.length;
                if (pEntr < 0 || pEntr > 1) pEntr = 1 / pending1310s.length;

                let nAbert, nSaida, nPerda, nGanho, nEntr;

                if (isLast) {
                    nAbert = Number((novo.abert - sumAbert).toFixed(3));
                    nEntr = Number((novo.entr - sumEntr).toFixed(3));
                    // Saída: se este tanque (último) não tem bicos E orig.saida era 0,
                    // toda a saída já foi atribuída aos tanques com bicos → este recebe 0.
                    const lastTanqueCod = tk[2];
                    const lastTemBicos = (pending1320s[lastTanqueCod] || []).length > 0;
                    if (!lastTemBicos && orig.saida <= 0 && sumSaida >= novo.saida - 0.01) {
                        nSaida = 0;
                    } else {
                        nSaida = Number((novo.saida - sumSaida).toFixed(3));
                    }
                    nPerda = Number((novo.perda - sumPerda).toFixed(3));
                    nGanho = Number((novo.ganho - sumGanho).toFixed(3));

                    // ESCUDO FINAL ANP NO EXPORT
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

                    // Escudo ANP por tanque intermediário (antes só o último tinha)
                    let baseTanqueInt = nAbert + nEntr;
                    let maxDesvioInt = baseTanqueInt * 0.0055;
                    if (nPerda > maxDesvioInt) nPerda = Number(maxDesvioInt.toFixed(3));
                    if (nGanho > maxDesvioInt) nGanho = Number(maxDesvioInt.toFixed(3));

                    sumAbert += nAbert; sumSaida += nSaida; sumPerda += nPerda; sumGanho += nGanho; sumEntr += nEntr;
                }

                // Saneamento contra heranças negativas
                if (nAbert < 0) nAbert = 0.5;

                let nDisp = Number((nAbert + nEntr).toFixed(3));
                // Escudo por tanque: saída nunca excede disponível (dados legados ou arredondamento)
                if (nSaida > nDisp - 0.001) nSaida = Math.max(0, Number((nDisp - 0.001).toFixed(3)));
                let nEscr = Number((nDisp - nSaida).toFixed(3));
                let nFisico = Number((nEscr - nPerda + nGanho).toFixed(3));

                if (nFisico < 0) {
                    nFisico = Math.max(0, nEscr);
                }

                tk._curated = { nAbert, nEntr, nDisp, nSaida, nEscr, nPerda, nGanho, nFisico, tOrigSaida };

                realAbert += nAbert;
                realEntr += nEntr;
                realDisp += nDisp;
                realSaida += nSaida;
                realEscr += nEscr;
                realPerda += nPerda;
                realGanho += nGanho;
                realFisico += nFisico;
            }

            // ── Redistribuição de excesso entre tanques ─────────────────────
            // Quando um tanque teve saída cortada (nSaida < proporcional) porque
            // nDisp era insuficiente, transferir o excesso para tanques com folga.
            // Sem isso, realSaida < novo.saida → escritural inflado → ANP estoura.
            if (realSaida < novo.saida - 0.01 && pending1310s.length > 1) {
                const deficit = Number((novo.saida - realSaida).toFixed(3));
                let restante = deficit;
                // Tanques com folga E bicos ativos (não transferir para bomba parada)
                for (const tk of pending1310s) {
                    if (restante <= 0.01) break;
                    const c = tk._curated;
                    const tanqueCodR = tk[2];
                    // Verificar se tanque tem bicos ativos (não todos parados/omitidos)
                    const bicosDoTanque = pending1320s[tanqueCodR] || [];
                    const temBicoAtivo = bicosDoTanque.some(bf => {
                        const ef = parseFloat((bf[8] || '0').replace(',', '.'));
                        const ei = parseFloat((bf[9] || '0').replace(',', '.'));
                        const vv = parseFloat((bf[11] || '0').replace(',', '.'));
                        return vv > 0 || Math.abs(ef - ei) > 0.01;
                    });
                    if (!temBicoAtivo) continue; // Tanque sem bico ativo → pular
                    const folga = c.nDisp - c.nSaida - 0.001;
                    if (folga > 1) {
                        const transferir = Math.min(restante, folga);
                        c.nSaida = Number((c.nSaida + transferir).toFixed(3));
                        c.nEscr = Number((c.nDisp - c.nSaida).toFixed(3));
                        // Recalcular perda/ganho com escudo ANP
                        const baseT = c.nAbert + c.nEntr;
                        const maxDevT = baseT * 0.0055;
                        if (c.nEscr >= c.nFisico) {
                            c.nPerda = Math.min(Number((c.nEscr - c.nFisico).toFixed(3)), maxDevT);
                            c.nGanho = 0;
                            c.nFisico = Number((c.nEscr - c.nPerda).toFixed(3));
                        } else {
                            c.nGanho = Math.min(Number((c.nFisico - c.nEscr).toFixed(3)), maxDevT);
                            c.nPerda = 0;
                            c.nFisico = Number((c.nEscr + c.nGanho).toFixed(3));
                        }
                        restante = Number((restante - transferir).toFixed(3));
                    }
                }
                // Recalcular totais reais
                realSaida = 0; realEscr = 0; realPerda = 0; realGanho = 0; realFisico = 0;
                realAbert = 0; realEntr = 0; realDisp = 0;
                for (const tk of pending1310s) {
                    const c = tk._curated;
                    realAbert += c.nAbert; realEntr += c.nEntr; realDisp += c.nDisp;
                    realSaida += c.nSaida; realEscr += c.nEscr;
                    realPerda += c.nPerda; realGanho += c.nGanho; realFisico += c.nFisico;
                }
            }

            // ── Recálculo consistente do 1300 mãe ──────────────────────────
            // Recalcula ESCR a partir dos totais primários (não soma dos tanques)
            // e decide FECH: âncora (banco) se dentro do ANP, ou escudo se fora.

            // 1. ESCR = DISP - SAIDAS (recalculado, não soma distorcida dos tanques)
            realDisp = Number((realAbert + realEntr).toFixed(3));
            realEscr = Number((realDisp - realSaida).toFixed(3));

            // ABERT: já resolvido na entrada do 1300 (prioridade: propagação > abert_adj > original).
            // Não sobrescrever com orig.abert aqui.

            // 2. Escudo ANP: calcula FECH seguro (PERDA/GANHO ≤ 0.55%)
            const blindMae = escudoAnpMae(realAbert, realEntr, realEscr, 0, 0);
            let fechEscudo = blindMae.fisico;

            // 3. Âncora: FECH do banco prevalece quando disponível E dentro do ANP.
            // Se a âncora gera ANP > 0.60% (ex: saída cortada inflou escritural),
            // usar o escudo ANP para garantir conformidade.
            const ancoraFisico = (novo.fisicoDb !== null && novo.fisicoDb !== undefined && novo.fisicoDb > 0)
                ? Number(novo.fisicoDb.toFixed(3)) : null;

            if (ancoraFisico !== null) {
                // Verificar se a âncora fica dentro do ANP com o escritural atual
                const anpAncora = realEscr > 0 ? (Math.abs(realEscr - ancoraFisico) / ancoraFisico * 100) : 0;
                if (anpAncora <= 0.60) {
                    realFisico = ancoraFisico;
                } else {
                    // Âncora gera ANP > 0.60% → usar escudo ANP
                    realFisico = fechEscudo;
                }
            } else {
                // Sem âncora → usar escudo como fallback
                realFisico = fechEscudo;
            }

            // 4. PERDA/GANHO derivados de ESCR vs FECH (garante fórmula PVA)
            if (realFisico >= realEscr) {
                realPerda = 0;
                realGanho = Number((realFisico - realEscr).toFixed(3));
            } else {
                realPerda = Number((realEscr - realFisico).toFixed(3));
                realGanho = 0;
            }

            // 5. Saneador final
            if (realPerda < 0) realPerda = 0;
            if (realGanho < 0) realGanho = 0;
            // ──────────────────────────────────────────────────────────────

            // PASS 2: Sobrescreve o 1300 Mãe — usa valores recalculados
            let fields1300 = pending1300.line.split('|');
            // Fix ABERT: no 1º dia, usa soma dos ABERTs originais dos 1310 (imune ao FUSE cache)
            if (!ultimoFechExportado.has(orig.codItem) && pending1310s.length > 0) {
                let _somaAbOrig = 0;
                for (const _tk of pending1310s) _somaAbOrig += parseFloat((_tk[3] || '0').replace(',', '.'));
                if (_somaAbOrig > 0 && realAbert > _somaAbOrig * 1.3) {
                    realAbert = Number(_somaAbOrig.toFixed(3));
                    realDisp = Number((realAbert + realEntr).toFixed(3));
                    realEscr = Number((realDisp - realSaida).toFixed(3));
                    const _bf = escudoAnpMae(realAbert, realEntr, realEscr, 0, 0);
                    const _af = (novo.fisicoDb !== null && novo.fisicoDb !== undefined && novo.fisicoDb > 0) ? Number(novo.fisicoDb.toFixed(3)) : null;
                    if (_af !== null && realEscr > 0 && (Math.abs(_af - realEscr) / (_af > 0 ? _af : 1) * 100) <= 0.60) {
                        realFisico = _af;
                    } else { realFisico = _bf.fisico; }
                    if (realFisico >= realEscr) { realPerda = 0; realGanho = Number((realFisico - realEscr).toFixed(3)); }
                    else { realPerda = Number((realEscr - realFisico).toFixed(3)); realGanho = 0; }
                }
            }
            // ESCUDO ANP FINAL: rede de segurança APÓS todos os recálculos (PASS 1, PASS 2).
            // Se perda/ganho resultante excede 0.60%, ajusta saída para que escritural
            // fique dentro do limite. Última barreira antes de escrever no SPED.
            if (realFisico > 0 && realEscr > 0) {
                const _anpPct = Math.abs(realEscr - realFisico) / realFisico * 100;
                if (_anpPct > 0.60) {
                    logger.info(`[ESCUDO ANP FINAL] ${orig.codItem} dt=${pending1300.line.split('|')[3]}: realDisp=${realDisp.toFixed(1)} realSaida=${realSaida.toFixed(1)} realEscr=${realEscr.toFixed(1)} realFisico=${realFisico.toFixed(1)} ANP=${_anpPct.toFixed(2)}% → CORRIGINDO`);
                }
                if (_anpPct > 0.60) {
                    if (realEscr > realFisico) {
                        const _escrAlvo = Number((realFisico * 1.006).toFixed(3));
                        realSaida = Math.max(0, Number((realDisp - _escrAlvo).toFixed(3)));
                    } else {
                        const _escrAlvo = Number((realFisico * 0.994).toFixed(3));
                        realSaida = Math.max(0, Number((realDisp - _escrAlvo).toFixed(3)));
                    }
                    realEscr = Number((realDisp - realSaida).toFixed(3));
                    if (realFisico >= realEscr) {
                        realPerda = 0;
                        realGanho = Number((realFisico - realEscr).toFixed(3));
                    } else {
                        realPerda = Number((realEscr - realFisico).toFixed(3));
                        realGanho = 0;
                    }
                }
            }

            fields1300[4] = realAbert.toFixed(3).replace('.', ',');
            fields1300[5] = realEntr.toFixed(3).replace('.', ',');
            fields1300[6] = realDisp.toFixed(3).replace('.', ',');
            fields1300[7] = realSaida.toFixed(3).replace('.', ',');
            fields1300[8] = realEscr.toFixed(3).replace('.', ',');
            fields1300[9] = realPerda.toFixed(3).replace('.', ',');
            fields1300[10] = realGanho.toFixed(3).replace('.', ',');
            fields1300[11] = realFisico.toFixed(3).replace('.', ',');

            // ── PASS 1.5: Redistribuir delta FECH entre tanques 1310 ─────────
            // O PASS 2 pode ter alterado realFisico (via âncora/escudo ANP)
            // sem atualizar os tanques. Isso gera 1300.FECH != sum(1310.FECH).
            // Aqui redistribuímos a diferença proporcionalmente para que batem.
            if (pending1310s.length > 0) {
                let somaFisicoTanques = 0;
                for (const tk of pending1310s) somaFisicoTanques += tk._curated.nFisico;
                const deltaFisico = realFisico - somaFisicoTanques;

                if (Math.abs(deltaFisico) > 0.001) {
                    let somaRedist = 0;
                    for (let i = 0; i < pending1310s.length; i++) {
                        const tk = pending1310s[i];
                        const isLast = (i === pending1310s.length - 1);

                        let ajuste;
                        if (isLast) {
                            ajuste = Number((deltaFisico - somaRedist).toFixed(3));
                        } else {
                            const peso = somaFisicoTanques > 0
                                ? (tk._curated.nFisico / somaFisicoTanques)
                                : (1 / pending1310s.length);
                            ajuste = Number((deltaFisico * peso).toFixed(3));
                            somaRedist += ajuste;
                        }

                        tk._curated.nFisico = Math.max(0, Number((tk._curated.nFisico + ajuste).toFixed(3)));

                        // Recalcular PERDA/GANHO para manter fórmula PVA: FECH = ESCR - PERDA + GANHO
                        if (tk._curated.nFisico >= tk._curated.nEscr) {
                            tk._curated.nPerda = 0;
                            tk._curated.nGanho = Number((tk._curated.nFisico - tk._curated.nEscr).toFixed(3));
                        } else {
                            tk._curated.nPerda = Number((tk._curated.nEscr - tk._curated.nFisico).toFixed(3));
                            tk._curated.nGanho = 0;
                        }
                    }
                }
            }
            // ──────────────────────────────────────────────────────────────────

            // PASS 3: Finaliza tanques 1310, acumula somas para reescrever 1300
            // A 1300 é emitida DEPOIS dos 1310 com a soma exata, eliminando
            // qualquer divergência por arredondamento ou saneador.
            let soma1310 = { abert: 0, entr: 0, disp: 0, saida: 0, escr: 0, perda: 0, ganho: 0, fisico: 0 };
            const linhas1310 = []; // buffer para emitir depois da 1300
            const bicosProcessadosNesteFlush = new Map(); // bico -> vendas (evita contar duplicado 2x)

            for (let i = 0; i < pending1310s.length; i++) {
                let tk = pending1310s[i];
                let curated = tk._curated;

                let tanqueCod = tk[2];
                let capTanque = 0;
                if (mapCapacidades && mapCapacidades.has(tanqueCod)) {
                    capTanque = mapCapacidades.get(tanqueCod);
                } else if (mapCapacidadesPorItem && pending1300 && pending1300.orig && pending1300.orig.codItem) {
                    capTanque = mapCapacidadesPorItem.get(pending1300.orig.codItem) || 0;
                }

                // Saneador 1310: PERDA/GANHO negativos nos tanques filhos
                let tkPerda = curated.nPerda;
                let tkGanho = curated.nGanho;
                let tkFisico = curated.nFisico;
                if (tkPerda < 0 || tkGanho < 0) {
                    if (tkFisico >= curated.nEscr) {
                        tkPerda = 0;
                        tkGanho = Number((tkFisico - curated.nEscr).toFixed(3));
                    } else {
                        tkPerda = Number((curated.nEscr - tkFisico).toFixed(3));
                        tkGanho = 0;
                    }
                    tkFisico = Number((curated.nEscr - tkPerda + tkGanho).toFixed(3));
                }

                // Acumula somas dos valores FINAIS dos tanques
                soma1310.abert += curated.nAbert;
                soma1310.entr += curated.nEntr;
                soma1310.disp += curated.nDisp;
                soma1310.saida += curated.nSaida;
                soma1310.escr += curated.nEscr;
                soma1310.perda += tkPerda;
                soma1310.ganho += tkGanho;
                soma1310.fisico += tkFisico;

                tk[3] = curated.nAbert.toFixed(3).replace('.', ',');
                tk[4] = curated.nEntr.toFixed(3).replace('.', ',');
                tk[5] = curated.nDisp.toFixed(3).replace('.', ',');
                tk[6] = curated.nSaida.toFixed(3).replace('.', ',');
                tk[7] = curated.nEscr.toFixed(3).replace('.', ',');
                tk[8] = tkPerda.toFixed(3).replace('.', ',');
                tk[9] = tkGanho.toFixed(3).replace('.', ',');
                tk[10] = tkFisico.toFixed(3).replace('.', ',');

                if (layoutVersion === '020') {
                    const capOrigTk = tk[11] || ''; // Preserva o valor original do arquivo como fallback
                    tk[11] = capTanque > 0 ? Math.round(capTanque).toString() : capOrigTk;
                    tk.length = 13;
                    tk[12] = '';
                } else {
                    tk.length = 12;
                    tk[11] = '';
                }

                linhas1310.push(tk.join('|'));

                // Sincronização e gravação do 1320
                let bicosDesteTanque = pending1320s[tanqueCod] || [];

                // Calcula a soma REAL dos VOL_VENDAS originais dos bicos.
                // Usar essa soma (não tOrigSaida do 1310) como base do fator evita
                // que encerrantes corrompidos (ex: dígito faltante) propaguem volumes
                // absurdos — a proporção de cada bico no total é preservada.
                let somaBicosOriginal = 0;
                for (let b = 0; b < bicosDesteTanque.length; b++) {
                    const v = parseFloat((bicosDesteTanque[b][11] || '0').replace(',', '.'));
                    if (v > 0) somaBicosOriginal += v;
                }
                let fatorOtimizacao = 1;
                if (somaBicosOriginal > 0) {
                    fatorOtimizacao = curated.nSaida / somaBicosOriginal;
                } else if (curated.tOrigSaida > 0) {
                    fatorOtimizacao = curated.nSaida / curated.tOrigSaida;
                }

                let volBicoAcumulado = 0;
                for (let b = 0; b < bicosDesteTanque.length; b++) {
                    let bFields = bicosDesteTanque[b];
                    let isUltimoBico = (b === bicosDesteTanque.length - 1);

                    let bicoNum = bFields[2];

                    let encFechaOrig = parseFloat((bFields[8] || '0').replace(',', '.'));
                    let encAbertOrig = parseFloat((bFields[9] || '0').replace(',', '.'));
                    let volAferiOrig = parseFloat((bFields[10] || '0').replace(',', '.'));
                    let volVendasOrig = parseFloat((bFields[11] || '0').replace(',', '.'));

                    // OPÇÃO A: se o auditor corrigiu este bico/dia, os valores corrigidos viram a base do recálculo.
                    if (correcoes1320.size > 0) {
                        const _cor = correcoes1320.get(`${formatDate(pending1300.line.split('|')[3] || '')}|${String(orig.codItem || '').trim()}|${String(bicoNum || '').trim()}`);
                        if (_cor) {
                            encAbertOrig = _cor.enc_ini;
                            encFechaOrig = _cor.enc_fin;
                            volAferiOrig = _cor.qtd_af;
                            volVendasOrig = Number((_cor.enc_fin - _cor.enc_ini - _cor.qtd_af).toFixed(3));
                        }
                    }

                    // 0) Bomba parada: enc_inic == enc_final no SPED original (não vendeu nada).
                    //    Pode ser: intervenção (mesmo tanque tem outro registro real do mesmo bico),
                    //    bico compartilhado entre tanques, ou dia sem vendas (feriado).
                    const isBombaParada = encFechaOrig > 0 && Math.abs(encFechaOrig - encAbertOrig) < 0.01 && volVendasOrig === 0;
                    if (isBombaParada) {
                        // Caso A: mesmo bico tem registro REAL no MESMO tanque (intervenção)
                        const mesmoBicoMesmoTanqueReal = bicosDesteTanque.some(bf => {
                            if (bf === bFields) return false;
                            if (bf[2] !== bicoNum) return false;
                            const vv = parseFloat((bf[11] || '0').replace(',', '.'));
                            const ef = parseFloat((bf[8] || '0').replace(',', '.'));
                            const ei = parseFloat((bf[9] || '0').replace(',', '.'));
                            return vv > 0 || Math.abs(ef - ei) > 0.01;
                        });
                        if (mesmoBicoMesmoTanqueReal) {
                            continue; // OMITIR — registro real do mesmo bico/tanque será processado
                        }
                        // Caso B: mesmo bico existe em OUTRO tanque
                        const outroTanqueTemMesmoBico = Object.entries(pending1320s).some(([tCod, bicos]) => {
                            if (tCod === tanqueCod) return false;
                            return bicos.some(bf => bf[2] === bicoNum);
                        });
                        if (outroTanqueTemMesmoBico) {
                            continue; // OMITIR — outro tanque processará o mesmo bico
                        }
                        // Caso C: único registro deste bico (feriado/dia sem vendas)
                        // Processamento normal com enc acumulado e vendas=0
                    }

                    // 1) Entrada fantasma (todos os campos zero):
                    //    - Se o MESMO bico tem outro registro REAL neste tanque/dia: OMITIR o fantasma.
                    //    - Se TODOS os bicos são fantasma E o tanque tem SAÍDA > 0:
                    //      converter este fantasma em entrada real (absorve o volume).
                    //    - Se há outros bicos REAIS (outro número): preencher encerrantes e manter.
                    if (encFechaOrig === 0 && encAbertOrig === 0 && volAferiOrig === 0 && volVendasOrig === 0) {
                        // Verificar se existe OUTRO registro do MESMO bico com dados reais
                        const mesmoBicoReal = bicosDesteTanque.some(bf => {
                            if (bf === bFields) return false; // não comparar consigo mesmo
                            const bNum = bf[2];
                            if (bNum !== bicoNum) return false;
                            const f = parseFloat((bf[8] || '0').replace(',', '.'));
                            const v = parseFloat((bf[11] || '0').replace(',', '.'));
                            return f > 0 || v > 0;
                        });

                        if (mesmoBicoReal) {
                            // Mesmo bico tem registro real → OMITIR este fantasma completamente
                            continue;
                        }

                        const todosFantasma = bicosDesteTanque.every(bf => {
                            const f = parseFloat((bf[8] || '0').replace(',', '.'));
                            const a = parseFloat((bf[9] || '0').replace(',', '.'));
                            const af = parseFloat((bf[10] || '0').replace(',', '.'));
                            const v = parseFloat((bf[11] || '0').replace(',', '.'));
                            return f === 0 && a === 0 && af === 0 && v === 0;
                        });

                        if (todosFantasma && curated.nSaida > 0) {
                            // Converter fantasma em entrada real: absorve toda a saída do tanque
                            volVendasOrig = curated.nSaida;
                            // continua o processamento normal abaixo
                        } else {
                            // Fantasma com outros bicos reais: preencher encerrantes e pular
                            const encAtual = encerrantesBombasMap[bicoNum];
                            if (encAtual !== undefined && encAtual > 0) {
                                bFields[8] = encAtual.toFixed(3).replace('.', ',');
                                bFields[9] = encAtual.toFixed(3).replace('.', ',');
                            }
                            linhas1310.push(bFields.join('|'));
                            continue;
                        }
                    }

                    // 2) Troca de produto ENTRE FLUSHES: mesmo bico processado em outro produto
                    //    (flush diferente, mesmo dia). Detectado via Map GLOBAL ultimoEncOrigPorBico.
                    if (!bicosProcessadosNesteFlush.has(bicoNum) && ultimoEncOrigPorBico.has(bicoNum)) {
                        const encOrigAnterior = ultimoEncOrigPorBico.get(bicoNum);
                        logger.info(`[MULTIPRODUTO CHECK] bico=${bicoNum} encAbertOrig=${encAbertOrig} encOrigAnterior=${encOrigAnterior} diff=${Math.abs(encAbertOrig - encOrigAnterior).toFixed(3)}`);
                        if (Math.abs(encAbertOrig - encOrigAnterior) < 0.01) {
                            // Multiproduto: mesmo bico, mesmo enc_inic → troca de produto
                            // Emitir com enc_inic=enc_final=acumulado e vendas=0
                            // (PVA exige pelo menos um 1320 por 1310)
                            const encAtual = encerrantesBombasMap[bicoNum] || 0;
                            bFields[9] = encAtual.toFixed(3).replace('.', ',');
                            bFields[8] = encAtual.toFixed(3).replace('.', ',');
                            bFields[11] = '0,000';
                            bFields[10] = '0,000';
                            linhas1310.push(bFields.join('|'));
                            continue;
                        }
                    }

                    // 3) Duplicata / Troca de produto DENTRO do mesmo flush.
                    if (bicosProcessadosNesteFlush.has(bicoNum)) {
                        const anterior = bicosProcessadosNesteFlush.get(bicoNum);

                        // 2a) Troca de produto (bico multiproduto): mesmo bico, mesmo enc_inic original.
                        //     O posto trocou o combustível do bico no meio do período.
                        //     O encerrante já avançou no 1º produto → NÃO avançar de novo.
                        //     Emitir com enc_inic = enc_final = acumulado atual, vendas do fator.
                        const isMultiproduto = anterior && anterior.encOrig !== undefined
                            && Math.abs(encAbertOrig - anterior.encOrig) < 0.01;

                        if (isMultiproduto) {
                            const encAtual = encerrantesBombasMap[bicoNum] || 0;
                            bFields[9] = encAtual.toFixed(3).replace('.', ',');
                            bFields[8] = encAtual.toFixed(3).replace('.', ',');
                            bFields[11] = volVendasOrig > 0
                                ? Number((volVendasOrig * (curated.nSaida > 0 ? curated.nSaida / (curated.tOrigSaida || curated.nSaida) : 0)).toFixed(3)).toString().replace('.', ',')
                                : '0,000';
                            bFields[10] = '0,000';
                            linhas1310.push(bFields.join('|'));
                            // NÃO atualizar encerrantesBombasMap (já avançou no 1º produto)
                            continue;
                        }

                        // 2b) Duplicata normal: zerar vendas se anterior tinha vendas
                        const anteriorEraFantasma = anterior && anterior.vendas === 0;
                        if (!anteriorEraFantasma) {
                            bFields[11] = '0,000';
                            bFields[10] = '0,000';
                        }
                        const encAtual = encerrantesBombasMap[bicoNum] || 0;
                        bFields[9] = encAtual.toFixed(3).replace('.', ',');
                        bFields[8] = encAtual.toFixed(3).replace('.', ',');
                        linhas1310.push(bFields.join('|'));
                        continue;
                    }

                    let volBicoOriginal = volVendasOrig;
                    let volBicoCalculado = 0;

                    if (isUltimoBico) {
                        volBicoCalculado = Number((curated.nSaida - volBicoAcumulado).toFixed(3));
                        if (volBicoCalculado < 0) volBicoCalculado = 0;
                    } else {
                        volBicoCalculado = Number(((volBicoOriginal > 0 ? volBicoOriginal : 0) * fatorOtimizacao).toFixed(3));
                        volBicoAcumulado += volBicoCalculado;
                    }

                    // Saneador: volume de venda nunca pode ser negativo
                    if (volBicoCalculado < 0) volBicoCalculado = 0;

                    let volAferido = volAferiOrig;
                    let encInicialReal = encerrantesBombasMap[bicoNum] !== undefined
                        ? encerrantesBombasMap[bicoNum]
                        : encAbertOrig;

                    // Aritmética inteira (mililitros) para eliminar erro de ponto flutuante.
                    const mlAbert = Math.round(encInicialReal * 1000);
                    const mlVendas = Math.round(volBicoCalculado * 1000);
                    const mlAferi = Math.round(volAferido * 1000);
                    let mlFecha = mlAbert + mlVendas + mlAferi;

                    // Simula o cálculo do validador (float): FECHA - ABERT - AFERI.
                    // Se der negativo (-0.000), bumpa FECHA em 0.001 para corrigir.
                    let fechaF = mlFecha / 1000;
                    let abertF = mlAbert / 1000;
                    let aferiF = mlAferi / 1000;
                    if ((fechaF - abertF - aferiF) < 0) {
                        mlFecha += 1;
                        fechaF = mlFecha / 1000;
                    }

                    const encFinalNovo = fechaF;
                    const volVendasFinal = (mlFecha - mlAbert - mlAferi) / 1000;

                    bFields[9] = abertF.toFixed(3).replace('.', ',');
                    bFields[8] = encFinalNovo.toFixed(3).replace('.', ',');
                    bFields[11] = (volVendasFinal < 0 ? 0 : volVendasFinal).toFixed(3).replace('.', ',');

                    encerrantesBombasMap[bicoNum] = encFinalNovo;
                    bicosProcessadosNesteFlush.set(bicoNum, { vendas: volBicoCalculado, encOrig: encAbertOrig });
                    ultimoEncOrigPorBico.set(bicoNum, encAbertOrig); // global: detecção multiproduto entre flushes

                    linhas1310.push(bFields.join('|'));
                }
            }

            // ── PASS 3.5: Ajustar 1310 quando bicos multiproduto zeraram vendas ──
            // Recalcula a saída de cada 1310 baseada na soma real dos 1320 emitidos.
            // Sem isso, 1310.saida ≠ Σ(1320.vendas) quando bicos foram zerados.
            if (linhas1310.length > 0) {
                // Agrupar linhas1310 por tipo: 1310 (tanques) e 1320 (bicos)
                let currentTk1310Idx = -1;
                const tk1310Indices = []; // índices dos 1310 em linhas1310
                const tk1320VendasPorTanque = []; // soma vendas 1320 por tanque

                for (let li = 0; li < linhas1310.length; li++) {
                    const lParts = linhas1310[li].split('|');
                    if (lParts[1] === '1310') {
                        currentTk1310Idx = li;
                        tk1310Indices.push(li);
                        tk1320VendasPorTanque.push(0);
                    } else if (lParts[1] === '1320' && tk1310Indices.length > 0) {
                        const v = parseFloat((lParts[11] || '0').replace(',', '.'));
                        tk1320VendasPorTanque[tk1320VendasPorTanque.length - 1] += v;
                    }
                }

                // Ajustar saída do 1310 para bater com soma dos 1320
                let somaSaidaAjustada = 0;
                for (let ti = 0; ti < tk1310Indices.length; ti++) {
                    const idx = tk1310Indices[ti];
                    const tkParts = linhas1310[idx].split('|');
                    const saidaTk = parseFloat((tkParts[6] || '0').replace(',', '.'));
                    const somaBicos = Number(tk1320VendasPorTanque[ti].toFixed(3));

                    if (Math.abs(saidaTk - somaBicos) > 0.01) {
                        // Ajustar saída do 1310 para = soma dos 1320
                        tkParts[6] = somaBicos.toFixed(3).replace('.', ',');
                        // Recalcular escritural, perda/ganho, físico
                        const abert = parseFloat((tkParts[3] || '0').replace(',', '.'));
                        const entr = parseFloat((tkParts[4] || '0').replace(',', '.'));
                        const disp = abert + entr;
                        const escr = Math.max(0, Number((disp - somaBicos).toFixed(3)));
                        tkParts[5] = Number((disp).toFixed(3)).toString().replace('.', ',');
                        tkParts[7] = escr.toFixed(3).replace('.', ',');
                        // Físico: manter o original ou recalcular com escudo ANP
                        const fisico = parseFloat((tkParts[10] || '0').replace(',', '.'));
                        let perda = 0, ganho = 0;
                        if (fisico >= escr) { ganho = Number((fisico - escr).toFixed(3)); }
                        else { perda = Number((escr - fisico).toFixed(3)); }
                        // Escudo ANP por tanque
                        const maxDev = disp * 0.0055;
                        if (perda > maxDev) { perda = Number(maxDev.toFixed(3)); }
                        if (ganho > maxDev) { ganho = Number(maxDev.toFixed(3)); }
                        const fisicoFinal = Number((escr - perda + ganho).toFixed(3));
                        tkParts[8] = perda.toFixed(3).replace('.', ',');
                        tkParts[9] = ganho.toFixed(3).replace('.', ',');
                        tkParts[10] = fisicoFinal.toFixed(3).replace('.', ',');
                        linhas1310[idx] = tkParts.join('|');
                    }
                    somaSaidaAjustada += somaBicos;
                }

                // Recalcular soma1310 com valores ajustados
                soma1310 = { abert: 0, entr: 0, disp: 0, saida: 0, escr: 0, perda: 0, ganho: 0, fisico: 0 };
                for (const l of linhas1310) {
                    const p = l.split('|');
                    if (p[1] === '1310') {
                        soma1310.abert += parseFloat((p[3] || '0').replace(',', '.'));
                        soma1310.entr += parseFloat((p[4] || '0').replace(',', '.'));
                        soma1310.disp += parseFloat((p[5] || '0').replace(',', '.'));
                        soma1310.saida += parseFloat((p[6] || '0').replace(',', '.'));
                        soma1310.escr += parseFloat((p[7] || '0').replace(',', '.'));
                        soma1310.perda += parseFloat((p[8] || '0').replace(',', '.'));
                        soma1310.ganho += parseFloat((p[9] || '0').replace(',', '.'));
                        soma1310.fisico += parseFloat((p[10] || '0').replace(',', '.'));
                    }
                }
            }

            // ── PASS 4: Emitir 1300 com soma exata dos 1310 finalizados ──────
            // Garante 1300 = Σ(1310) sem divergência de arredondamento.
            if (pending1310s.length > 0) {
                // Arredonda as somas para 3 casas
                for (const k of Object.keys(soma1310)) soma1310[k] = Number(soma1310[k].toFixed(3));

                // NÃO aplicar escudo ANP aqui: cada tanque já tem escudo individual
                // (PASS 1, linhas de blindagem per-tank). Aplicar novamente na soma
                // quebraria 1300 ≠ Σ(1310), que é justamente o bug sendo corrigido.

                fields1300[4] = soma1310.abert.toFixed(3).replace('.', ',');
                fields1300[5] = soma1310.entr.toFixed(3).replace('.', ',');
                fields1300[6] = soma1310.disp.toFixed(3).replace('.', ',');
                fields1300[7] = soma1310.saida.toFixed(3).replace('.', ',');
                fields1300[8] = soma1310.escr.toFixed(3).replace('.', ',');
                fields1300[9] = soma1310.perda.toFixed(3).replace('.', ',');
                fields1300[10] = soma1310.ganho.toFixed(3).replace('.', ',');
                fields1300[11] = soma1310.fisico.toFixed(3).replace('.', ',');

                realFisico = soma1310.fisico; // atualiza para propagação de continuidade
            }

            pushLine(fields1300.join('|'));

            // Correção 3: armazenar FECH exportado para propagação de continuidade
            if (pending1300.orig && pending1300.orig.codItem && realFisico > 0) {
                ultimoFechExportado.set(pending1300.orig.codItem, realFisico);
            }

            // Emitir linhas 1310 e 1320 (já calculadas e bufferizadas)
            for (const linha of linhas1310) pushLine(linha);

            pending1300 = null;
            pending1310s = [];
            pending1320s = {};
        };

        let last1300CodItem = null; // FIX: track the item code from the parent 1300 for direct 1310 processing

        // Escudo ANP final sobre o 1300 (mãe). Limite legal é 0,60%; usamos 0,55% como
        // margem para arredondamento. Aplicado em todos os caminhos de export do 1300
        // (mapAjustes, mapBaseFisico e flush com 1310). Sem isso, ajustes do laboratório
        // ou correções derivadas podiam exportar perda/ganho > 0,60% e o PVA acusava
        // "ANP acima do limite".
        const escudoAnpMae = (abert, entr, escr, perda, ganho) => {
            const base = (abert || 0) + (entr || 0);
            const limite = base * 0.0055;
            let p = perda || 0, g = ganho || 0;
            if (base > 0) {
                if (p > limite) p = Number(limite.toFixed(3));
                if (g > limite) g = Number(limite.toFixed(3));
            }
            let f = Number(((escr || 0) - p + g).toFixed(3));
            if (f < 0) f = 0;
            return { perda: p, ganho: g, fisico: f };
        };

        for (const line of fileLines) {
            // Ignorar linhas em branco (alguns SPEDs têm \r\n\r\n entre linhas)
            if (line.trim() === '') continue;
            linesProcessed++;
            const fields = line.split('|').map(v => v.replace(/\r$/, '')); // Sanear carriage return imediato

            // --- BLOCO 0200 (FILTRAR ITENS SEM REFERÊNCIA) ---
            if (fields.length >= 2 && fields[1] === '0200') {
                // TRIM no comparador: cod_item no arquivo pode vir padded (CHAR fixo) e a Set
                // está normalizada com TRIM. Sem isso, NENHUM 0200 é reconhecido e todos são
                // omitidos do export, gerando arquivo sem cadastro de produtos.
                const codItem = String(fields[2] || '').trim();
                if (codItensReferenciados.size > 0 && !codItensReferenciados.has(codItem)) {
                    // Item não referenciado em nenhum outro bloco — omitir para evitar erro PVA
                    // Também marca para pular o filho 0206 imediatamente após
                    skipNext0206 = true;
                    continue;
                }
                skipNext0206 = false;
                pushLine(line);
                continue;
            }

            // --- BLOCO 0205 (FILHO DO 0200 — omitir se o pai foi omitido) ---
            if (fields.length >= 2 && fields[1] === '0205') {
                if (skipNext0206) continue; // pai 0200 foi omitido → pular 0205 órfão
                pushLine(line);
                continue;
            }

            // --- BLOCO 0206 (FILHO DO 0200 — omitir se o pai foi omitido) ---
            if (fields.length >= 2 && fields[1] === '0206') {
                if (skipNext0206) {
                    skipNext0206 = false;
                    continue;
                }
                pushLine(line);
                continue;
            }

            // --- BLOCO 0000 (AUTOCORREÇÃO E DETECÇÃO DE LEIAUTE) ---
            if (fields.length >= 2 && fields[1] === '0000') {
                let current_version = fields[2];
                let date_start = fields[4]; // DDMMYYYY
                let date_end   = fields[5]; // DDMMYYYY

                if (date_start && date_start.length === 8) {
                    let year = parseInt(date_start.substring(4, 8), 10);
                    if (year >= 2026 && current_version === '019') {
                        fields[2] = '020'; // Transmuta silenciosamente para salvar a importação no PVA
                        changesApplied++;
                    }
                    // Fix B: captura período para autocorreção de COD_SIT
                    const dd0 = date_start.substring(0,2), mm0 = date_start.substring(2,4), yy0 = date_start.substring(4,8);
                    periodoIniDate = new Date(Date.UTC(parseInt(yy0), parseInt(mm0)-1, parseInt(dd0)));
                }
                if (date_end && date_end.length === 8) {
                    const dd1 = date_end.substring(0,2), mm1 = date_end.substring(2,4), yy1 = date_end.substring(4,8);
                    periodoFimDate = new Date(Date.UTC(parseInt(yy1), parseInt(mm1)-1, parseInt(dd1)));
                }
                layoutVersion = fields[2]; // Define a regra para o restante do arquivo
                pushLine(fields.join('|'));
                continue;
            }

            // --- BLOCO 0150 (Fix C: registrar CNPJs presentes) ---
            if (fields.length >= 2 && fields[1] === '0150') {
                const cnpj0150 = (fields[5] || '').replace(/\D/g, '');
                if (cnpj0150.length >= 11) set0150CnpjsPresentes.add(cnpj0150);
                pushLine(line);
                continue;
            }

            // --- BLOCO H010 (Posição do Estoque / Inventário) ---
            // Reescreve QTD e VL_ITEM do inventário para casar com o fech_fisico final do LMC
            // (estoque ajustado). Sem isso, o H010 sai com o valor original do SPED, divergindo
            // dos ajustes feitos via Otimizador/Sincronizador no LMC.
            // Layout H010: |H010|COD_ITEM|UNID|QTD|VL_UNIT|VL_ITEM|IND_PROP|...|
            //                pos:  0   1     2    3    4      5       6        7+
            if (fields.length >= 2 && fields[1] === 'H010') {
                const codH010 = String(fields[2] || '').trim();
                const fechAlvo = mapFechFinalLmc.get(codH010);
                const ocorrencias = h010CountByCod.get(codH010) || 0;
                if (fechAlvo !== undefined && ocorrencias === 1) {
                    const qtdOriginal = parseFloat((fields[4] || '0').replace(',', '.'));
                    if (Math.abs(qtdOriginal - fechAlvo) > 0.001) {
                        const vlUnit = parseFloat((fields[5] || '0').replace(',', '.'));
                        const novoQtd = Number(fechAlvo.toFixed(3));
                        const novoVlItem = Number((novoQtd * vlUnit).toFixed(2));
                        fields[4] = novoQtd.toFixed(3).replace('.', ',');
                        fields[6] = novoVlItem.toFixed(2).replace('.', ',');
                        changesApplied++;
                        pushLine(fields.join('|'));
                        continue;
                    }
                }
                // Sem fech no LMC, ou múltiplos H010 (split por IND_PROP) — passa direto.
                pushLine(line);
                continue;
            }

            // --- BLOCO 1300 ---
            if (fields.length >= 2 && fields[1] === '1300') {
                flush1300Group(); // Descarrega agrupamento anterior 1300/1310 se houver

                const codItem = fields[2];
                last1300CodItem = codItem; // Save the code for direct 1310 passes
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

                        // ABERT: prioridade → 1) FECH exportado do dia anterior (propagação)
                        //                    → 2) estq_abert_ajustado do banco (Re-distribuir calculou)
                        //                    → 3) ABERT original do arquivo (fallback)
                        const fechAnterior = ultimoFechExportado.get(codItem);
                        let novoAbert;
                        if (fechAnterior !== undefined && fechAnterior > 0) {
                            novoAbert = Number(fechAnterior.toFixed(3));
                        } else if (aj.estq_abert_ajustado !== null && aj.estq_abert_ajustado !== undefined && parseFloat(aj.estq_abert_ajustado) > 0) {
                            novoAbert = Number(parseFloat(aj.estq_abert_ajustado).toFixed(3));
                        } else {
                            novoAbert = Number(oldAbert.toFixed(3));
                        }
                        if (novoAbert < 0) novoAbert = 0.5;
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
                        // Escudo de exportação: saída nunca pode exceder disponível (evita ESTQ_ESCR negativo)
                        if (novoSaida > disp - 0.001) novoSaida = Math.max(0, Number((disp - 0.001).toFixed(3)));
                        fields[7] = novoSaida.toFixed(3).replace('.', ',');

                        const escr = Number((disp - novoSaida).toFixed(3));
                        fields[8] = escr.toFixed(3).replace('.', ',');

                        let novoPerda = 0;
                        if (aj.val_perda_ajustado !== null) novoPerda = Number(parseFloat(aj.val_perda_ajustado).toFixed(3));

                        let novoGanho = 0;
                        if (aj.val_ganho_ajustado !== null) novoGanho = Number(parseFloat(aj.val_ganho_ajustado).toFixed(3));

                        // Escudo ANP final: blinda perda/ganho ≤ 0,55% sobre (abert+entr).
                        const blindADJ = escudoAnpMae(novoAbert, entr, escr, novoPerda, novoGanho);
                        novoPerda = blindADJ.perda;
                        novoGanho = blindADJ.ganho;
                        let fisico = blindADJ.fisico;

                        fields[9]  = novoPerda.toFixed(3).replace('.', ',');
                        fields[10] = novoGanho.toFixed(3).replace('.', ',');
                        fields[11] = fisico.toFixed(3).replace('.', ',');

                        if (fields.length < 13) while (fields.length < 13) fields.push('');
                        else if (fields[fields.length - 1] !== '') fields[fields.length - 1] = '';

                        // fisicoDb: âncora para flush1300Group.
                        // fech_fisico_ajustado SEMPRE prevalece — é o valor do otimizador/laboratório.
                        const fisicoAj = (aj.fech_fisico_ajustado !== null && aj.fech_fisico_ajustado !== undefined)
                            ? Number(parseFloat(aj.fech_fisico_ajustado).toFixed(3)) : null;
                        const fisicoOr = (aj.fech_fisico !== undefined && aj.fech_fisico !== null)
                            ? Number(parseFloat(aj.fech_fisico).toFixed(3)) : null;
                        const fisicoDb = (fisicoAj !== null && fisicoAj > 0) ? fisicoAj : fisicoOr;

                        // Guarda no buffer para os tanques (1310) usarem o mesmo total arredondado
                        pending1300 = {
                            line: fields.join('|'),
                            orig: { abert: oldAbert, saida: oldSaida, entr: oldEntr, codItem: codItem },
                            novo: { abert: novoAbert, saida: novoSaida, perda: novoPerda, ganho: novoGanho, entr: entr, fisico: fisico, fisicoDb: fisicoDb }
                        };
                        continue; // Importante: não faz res.write aqui
                    } else if (mapBaseFisico.has(key)) {
                        // Sem ajuste do usuário, mas o banco tem fech_fisico (LMC base).
                        // Cobre 2 padrões de bug:
                        //  (a) VAL_AJ_PERDA = ESTQ_ESCR → FECH = 0 no SPED original.
                        //  (b) Abertura do 1º dia do mês não bate com FECH do mês anterior
                        //      (Correção 4: continuidade intermensal).
                        const fisicoBase = mapBaseFisico.get(key);
                        const fisicoOrig = parseFloat((fields[11] || '0').replace(',', '.'));
                        const fechAntBase = ultimoFechExportado.get(codItem);
                        const fechFisicoZerado = (fisicoOrig === 0 && fisicoBase > 0);
                        const aberturaSemContinuidade = (fechAntBase !== undefined && fechAntBase > 0 && Math.abs(oldAbert - fechAntBase) > 0.5);
                        if (fechFisicoZerado || aberturaSemContinuidade) {
                            // Correção 3+4: propagar continuidade
                            let abertCorr = parseFloat((fields[4] || '0').replace(',', '.'));
                            if (fechAntBase !== undefined && fechAntBase > 0) {
                                abertCorr = Number(fechAntBase.toFixed(3));
                                fields[4] = abertCorr.toFixed(3).replace('.', ',');
                            }
                            const entrCorr = parseFloat((fields[5] || '0').replace(',', '.'));
                            const dispCorr = Number((abertCorr + entrCorr).toFixed(3));
                            fields[6] = dispCorr.toFixed(3).replace('.', ',');
                            const saidaCorr = parseFloat((fields[7] || '0').replace(',', '.'));
                            const escrCorr = Number((dispCorr - saidaCorr).toFixed(3));
                            fields[8] = escrCorr.toFixed(3).replace('.', ',');
                            // Alvo do físico: o que o banco tem como base; se vier zero mas o
                            // original era válido, mantém o original.
                            const fisicoAlvo = fisicoBase > 0 ? fisicoBase : (fisicoOrig > 0 ? fisicoOrig : escrCorr);
                            // Deriva PERDA/GANHO reais a partir do físico alvo
                            // para que a fórmula do PVA bata: FECH = ESCR - PERDA + GANHO
                            let corrigidoPerda = 0;
                            let corrigidoGanho = 0;
                            if (fisicoAlvo <= escrCorr) {
                                corrigidoPerda = Number((escrCorr - fisicoAlvo).toFixed(3));
                            } else {
                                corrigidoGanho = Number((fisicoAlvo - escrCorr).toFixed(3));
                            }
                            // Escudo ANP final: derivação por base de banco também é blindada.
                            const blindBase = escudoAnpMae(abertCorr, entrCorr, escrCorr, corrigidoPerda, corrigidoGanho);
                            corrigidoPerda = blindBase.perda;
                            corrigidoGanho = blindBase.ganho;
                            const fisicoFinal = blindBase.fisico;
                            fields[9]  = corrigidoPerda.toFixed(3).replace('.', ',');
                            fields[10] = corrigidoGanho.toFixed(3).replace('.', ',');
                            fields[11] = fisicoFinal.toFixed(3).replace('.', ',');
                            if (fields.length < 13) while (fields.length < 13) fields.push('');
                            else if (fields[fields.length - 1] !== '') fields[fields.length - 1] = '';
                            changesApplied++;
                            const abert = abertCorr;
                            const entr = entrCorr;
                            const saida = saidaCorr;
                            pending1300 = {
                                line: fields.join('|'),
                                orig: { abert, saida, entr, codItem },
                                novo: { abert, saida, perda: corrigidoPerda, ganho: corrigidoGanho, entr }
                            };
                            continue;
                        }
                    }
                }
            }

            // --- BLOCO 1300 (PASSAGEM DIRETA): sem ajuste no banco, sem fech_fisico zerado.
            // Apenas propaga continuidade (ABERT = FECH do dia anterior exportado) e armazena FECH.
            if (fields.length >= 2 && fields[1] === '1300' && !pending1300) {
                const codItemDirect = fields[2];
                const fechAntDirect = ultimoFechExportado.get(codItemDirect);
                const abertOrig = parseFloat((fields[4] || '0').replace(',', '.'));
                const fechOrig = parseFloat((fields[11] || '0').replace(',', '.'));

                if (fechAntDirect !== undefined && fechAntDirect > 0 && Math.abs(abertOrig - fechAntDirect) > 0.5) {
                    // Continuidade quebrada: propagar FECH anterior como ABERT
                    const novoAbert = Number(fechAntDirect.toFixed(3));
                    fields[4] = novoAbert.toFixed(3).replace('.', ',');
                    const entr = parseFloat((fields[5] || '0').replace(',', '.'));
                    const disp = Number((novoAbert + entr).toFixed(3));
                    fields[6] = disp.toFixed(3).replace('.', ',');
                    const saida = parseFloat((fields[7] || '0').replace(',', '.'));
                    let safeS = saida;
                    if (safeS > disp - 0.001) safeS = Math.max(0, Number((disp - 0.001).toFixed(3)));
                    fields[7] = safeS.toFixed(3).replace('.', ',');
                    const escr = Number((disp - safeS).toFixed(3));
                    fields[8] = escr.toFixed(3).replace('.', ',');
                    const perdaOrig = parseFloat((fields[9] || '0').replace(',', '.'));
                    const ganhoOrig = parseFloat((fields[10] || '0').replace(',', '.'));
                    const blind = escudoAnpMae(novoAbert, entr, escr, perdaOrig, ganhoOrig);
                    fields[9] = blind.perda.toFixed(3).replace('.', ',');
                    fields[10] = blind.ganho.toFixed(3).replace('.', ',');
                    fields[11] = blind.fisico.toFixed(3).replace('.', ',');
                    if (fields.length < 13) while (fields.length < 13) fields.push('');
                    changesApplied++;
                    const fExport = blind.fisico;
                    ultimoFechExportado.set(codItemDirect, fExport);
                    pending1300 = {
                        line: fields.join('|'),
                        orig: { abert: abertOrig, saida, entr, codItem: codItemDirect },
                        novo: { abert: novoAbert, saida: safeS, perda: blind.perda, ganho: blind.ganho, entr }
                    };
                    continue;
                }

                // Sem quebra de continuidade no 1300, mas se existem encerrantes de bicos
                // carregados (intermensal), bufferizar para que os 1320 passem pelo
                // processamento de encerrantesBombasMap (sem isso, bicos passam direto
                // com valores originais e a cadeia intermensal de bicos quebra).
                if (Object.keys(encerrantesBombasMap).length > 0) {
                    const entr = parseFloat((fields[5] || '0').replace(',', '.'));
                    const saida = parseFloat((fields[7] || '0').replace(',', '.'));
                    pending1300 = {
                        line: fields.join('|'),
                        orig: { abert: abertOrig, saida, entr, codItem: codItemDirect },
                        novo: { abert: abertOrig, saida, perda: parseFloat((fields[9] || '0').replace(',', '.')), ganho: parseFloat((fields[10] || '0').replace(',', '.')), entr }
                    };
                    if (fechOrig > 0) ultimoFechExportado.set(codItemDirect, fechOrig);
                    continue;
                }

                // Sem encerrantes de bicos: armazenar FECH para propagação futura
                if (fechOrig > 0) ultimoFechExportado.set(codItemDirect, fechOrig);
            }

            // --- BLOCO 1310 (Acumula no buffer se tivermos modificado o 1300) ---
            if (fields.length >= 2 && fields[1] === '1310' && pending1300) {
                pending1310s.push(fields);
                continue;
            }

            // --- BLOCO 1310 (Passagem direta: 1300 pai NÃO foi modificado, mas layout 020 exige CAP_TANQUE) ---
            if (fields.length >= 2 && fields[1] === '1310' && layoutVersion === '020') {
                // O arquivo original é v019 (10 campos de dados). Precisamos adicionar o CAP_TANQUE.
                // Formato v019: |1310|NUM|ABERT|ENTR|DISP|SAIDA|ESCR|PERDA|GANHO|FISICO|  (12 elementos split)
                // Formato v020: |1310|NUM|ABERT|ENTR|DISP|SAIDA|ESCR|PERDA|GANHO|FISICO|CAP|  (13 elementos split)
                const tanqueCodDirect = fields[2];
                let capTanqueDirect = 0;
                if (mapCapacidades && mapCapacidades.has(tanqueCodDirect)) {
                    capTanqueDirect = mapCapacidades.get(tanqueCodDirect);
                } else if (mapCapacidadesPorItem && last1300CodItem) { // FIX: Use the fallback if the tank ID isn't linked
                    capTanqueDirect = mapCapacidadesPorItem.get(last1300CodItem) || 0;
                }
                // Garante que o array tem exatamente 13 posições
                while (fields.length < 12) fields.push('');
                const capOrigDirect = fields[11] || ''; // Preserva o valor original do arquivo como fallback
                fields[11] = capTanqueDirect > 0 ? Math.round(capTanqueDirect).toString() : capOrigDirect;
                fields.length = 13;
                fields[12] = '';
                pushLine(fields.join('|'));
                changesApplied++;
                continue;
            }

            // --- BLOCO 1320 (Aferição e Bicos atrelados ao 1310 anterior) ---
            if (fields.length >= 2 && fields[1] === '1320' && pending1300) {
                // Pega o número do tanque lido no último registro 1310 armazenado com sucesso
                if (pending1310s.length > 0) {
                    let lastTanqueNum = pending1310s[pending1310s.length - 1][2];
                    if (!pending1320s[lastTanqueNum]) pending1320s[lastTanqueNum] = [];
                    pending1320s[lastTanqueNum].push(fields);
                }
                continue;
            }

            // Qualquer outro bloco (ou bloco que não esteja vinculado à modificação no 1300), libera buffer primeiro
            flush1300Group();
            // ── Fix B (inline): corrige COD_SIT="07" para "00" quando DT_E_S está dentro do período ──
            // Executado ANTES do rastreamento de sitExportST para garantir consistência
            if (fields.length >= 2 && fields[1] === 'C100' &&
                fields[6] === '07' && periodoIniDate && periodoFimDate &&
                fields[11] && fields[11].length === 8) {
                const dEs = fields[11];
                const dtEs = new Date(Date.UTC(
                    parseInt(dEs.substring(4,8)),
                    parseInt(dEs.substring(2,4)) - 1,
                    parseInt(dEs.substring(0,2))
                ));
                if (dtEs >= periodoIniDate && dtEs <= periodoFimDate) {
                    fields[6] = '00';
                    changesApplied++;
                    logger.info(`[Fix B] COD_SIT corrigido 07->00 para NF ${fields[8]} (DT_E_S ${dEs} dentro do período)`);
                }
            }

            // Rastreia COD_SIT do documento pai (C100/D100/etc.) para filtro E210
            if (fields.length >= 2 &&
                (fields[1] === 'C100' || fields[1] === 'C500' || fields[1] === 'C600' ||
                 fields[1] === 'D100' || fields[1] === 'D500' || fields[1] === 'D600')) {
                sitExportST = fields[6] || '00'; // COD_SIT está em c[6] para todos esses
            }

            // Ajuste C100
            if (fields.length >= 2 && fields[1] === 'C100') {
                const numDoc = fields[8];
                const chvNfe = fields[9];
                lastC100 = { numDoc, chvNfe };

                const key = `${numDoc}_${chvNfe}`;
                if (mapC100.has(key)) {
                    fields[12] = parseFloat(mapC100.get(key)).toFixed(2).replace('.', ',');
                    changesApplied++;
                    pushLine(fields.join('|'));
                    continue;
                }
            }

            // Ajuste C170
            if (fields.length >= 2 && fields[1] === 'C170') {
                const numItem = fields[2];
                const codItem = fields[3];
                const key = `${lastC100.numDoc}_${lastC100.chvNfe || ''}_${numItem}_${codItem}`;

                // Fix A (inline): sanitiza IND_MOV para evitar "0,00"/"1,00" que desalinha campos no PVA
                let c170Modified = false;
                if (fields.length > 9) {
                    const rawIndMov = fields[9];
                    const sanitized = (parseInt(rawIndMov, 10) === 1) ? '1' : '0';
                    if (rawIndMov !== sanitized) {
                        fields[9] = sanitized;
                        changesApplied++;
                        c170Modified = true;
                    }
                }

                if (mapC170.has(key)) {
                    const row = mapC170.get(key);
                    let mapChanged = false;

                    // GUARD: o C170 do .txt já reflete o de-para / forçar-uso-consumo aplicado na
                    // injeção. Se o CFOP do .txt é uso/consumo (forçado), esse valor é autoritativo —
                    // NÃO deixar documentos_itens_c170 (valores crus do XML) reverter para CSOSN/CFOP
                    // inválido. Sem o forçado, mantém o comportamento anterior (aplica o de-para do banco).
                    const ehForcadoUsoConsumo = CFOP_USO_CONSUMO.has(fields[11]);

                    if (!ehForcadoUsoConsumo) {
                        if (row.cst_icms && fields[10] !== row.cst_icms) {
                            fields[10] = String(row.cst_icms).padStart(3, '0');
                            mapChanged = true;
                        }
                        if (row.cfop && fields[11] !== row.cfop) {
                            fields[11] = String(row.cfop).padStart(4, '0');
                            mapChanged = true;
                        }
                        if (row.cst_pis && fields[25] !== row.cst_pis && fields.length > 25) {
                            fields[25] = String(row.cst_pis).padStart(2, '0');
                            mapChanged = true;
                        }
                        if (row.cst_cofins && fields[31] !== row.cst_cofins && fields.length > 31) {
                            fields[31] = String(row.cst_cofins).padStart(2, '0');
                            mapChanged = true;
                        }
                    }
                    if (mapChanged) {
                        changesApplied++;
                        c170Modified = true;
                    }
                }

                if (c170Modified) {
                    pushLine(fields.join('|'));
                    continue;
                }
            }

            // Ajuste C190 + acúmulo VL_ICMS_ST para E210 (com filtro COD_SIT)
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
                }
                // Acumula VL_ICMS_ST para E210 VL_RETENCAO_ST (filtro COD_SIT = igual ao PVA)
                if (!['02', '03', '04', '05'].includes(sitExportST)) {
                    const cfopC190 = fields[3] || '';
                    if (cfopC190.startsWith('5') || cfopC190.startsWith('6')) {
                        somaRetST += parseSp(fields[9]);
                    }
                }
                pushLine(fields.join('|'));
                continue;
            }

            // Acúmulo VL_ICMS_ST de C590/C690/D590/D690 para E210 (com filtro COD_SIT)
            if (fields.length >= 2 &&
                (fields[1] === 'C590' || fields[1] === 'C690' ||
                 fields[1] === 'D590' || fields[1] === 'D690')) {
                if (!['02', '03', '04', '05'].includes(sitExportST)) {
                    const cfopAn = fields[3] || '';
                    if (cfopAn.startsWith('5') || cfopAn.startsWith('6')) {
                        somaRetST += parseSp(fields[9]);
                    }
                }
                // Falls through to default write
            }

            // Rastreamento C790/C791 para E210 VL_RETENCAO_ST
            if (fields.length >= 2 && fields[1] === 'C790') {
                c790CfopExport = fields[3] || '';
                // Falls through to default write
            }
            if (fields.length >= 2 && fields[1] === 'C791') {
                if (!['02', '03', '04', '05'].includes(sitExportST) &&
                    (c790CfopExport.startsWith('5') || c790CfopExport.startsWith('6'))) {
                    somaRetST += parseSp(fields[3]);
                }
                // Falls through to default write
            }

            // E210: recalcula VL_RETENCAO_ST (f[8] per PVA) e campos derivados in-place.
            // VL_TOTAL_CRED_ST = f[3]+f[4]+f[5]+f[6]+f[7] — calculado mas não ocupa campo próprio.
            // E110 não é recalculado aqui — arquivo já correto pós-injeção.
            if (fields.length >= 2 && fields[1] === 'E210') {
                const f = fields;
                f[2]  = somaRetST > 0 ? '1' : '0'; // IND_MOV_ST: 1 só se há ST retido em saídas
                f[8]  = fmtSp(somaRetST); // VL_RETENCAO_ST = soma C190/C590/etc CFOP 5xx/6xx VL_ICMS_ST
                const vlTotalCredST = parseSp(f[3]) + parseSp(f[4]) + parseSp(f[5]) + parseSp(f[6]) + parseSp(f[7]);
                f[14] = fmtSp(parseSp(f[8]) + parseSp(f[9]) + parseSp(f[10]) + parseSp(f[11]) + parseSp(f[12]) + parseSp(f[13]));
                f[15] = fmtSp(Math.max(0, parseSp(f[14]) - vlTotalCredST));
                pushLine(f.join('|'));
                continue;
            }

            // ── Fix C: coleta participantes do 1601 para verificação de 0150 ──
            if (fields.length >= 2 && fields[1] === '1601') {
                // |1601|COD_PART|... (campos: 1=REG, 2=COD_PART)
                // Busca na tabela sped_participantes o CNPJ deste participante
                const codPart1601 = fields[2] || '';
                if (codPart1601 && !map1601Participantes.has(codPart1601)) {
                    map1601Participantes.set(codPart1601, { cod_part: codPart1601 });
                }
            }

            pushLine(line);
        }

        // Descarregar buffer residual se o arquivo terminar em um bloco 1310 ajustado
        flush1300Group();

        // ── Persistir fechamentos realmente exportados (continuidade intermensal) ──
        // Salva o FECH_FISICO final de cada produto na tabela encerrantes_exportados.
        // Na exportação do mês seguinte, esses valores terão prioridade sobre lmc_movimentacao.
        if (cnpjArq && periodoIniArq && ultimoFechExportado.size > 0) {
            const compExp = `${periodoIniArq.substring(4,8)}-${periodoIniArq.substring(2,4)}`; // YYYY-MM
            const cnpjNum = cnpjArq.replace(/\D/g, '');
            for (const [codItem, fech] of ultimoFechExportado.entries()) {
                try {
                    await dbClient.query(`
                        INSERT INTO encerrantes_exportados
                            (id_sped_arquivo, cnpj_empresa, competencia, cod_item, fech_fisico_exportado)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (cnpj_empresa, competencia, cod_item)
                        DO UPDATE SET fech_fisico_exportado = EXCLUDED.fech_fisico_exportado,
                                      dt_exportacao = NOW(),
                                      id_sped_arquivo = EXCLUDED.id_sped_arquivo
                    `, [arquivoId, cnpjNum, compExp, codItem, fech]);
                } catch (eEnc) {
                    logger.warn(`[Export] Erro ao salvar encerrante exportado ${codItem}:`, eEnc.message);
                }
            }
            logger.info(`[Export 1300] Salvos ${ultimoFechExportado.size} fechamentos exportados em encerrantes_exportados (${compExp}).`);
        }

        // ── Persistir encerrantes finais dos BICOS (continuidade intermensal 1320) ──
        if (cnpjArq && periodoIniArq && Object.keys(encerrantesBombasMap).length > 0) {
            const compExp = `${periodoIniArq.substring(4,8)}-${periodoIniArq.substring(2,4)}`;
            const cnpjNum = cnpjArq.replace(/\D/g, '');
            let savedBicos = 0;
            for (const [numBico, valFecha] of Object.entries(encerrantesBombasMap)) {
                try {
                    await dbClient.query(`
                        INSERT INTO encerrantes_bicos_exportados
                            (cnpj_empresa, competencia, num_bico, val_fecha)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (cnpj_empresa, competencia, num_bico)
                        DO UPDATE SET val_fecha = EXCLUDED.val_fecha,
                                      dt_exportacao = NOW()
                    `, [cnpjNum, compExp, numBico, valFecha]);
                    savedBicos++;
                } catch (eBico) {
                    logger.warn(`[Export 1320] Erro ao salvar encerrante bico ${numBico}:`, eBico.message);
                }
            }
            logger.info(`[Export 1320] Salvos ${savedBicos} encerrantes de bicos em encerrantes_bicos_exportados (${compExp}).`);
        }

        // ── Fix C (pós-loop): injeta 0150 para CNPJs do 1601 que estão ausentes ──
        if (map1601Participantes.size > 0) {
            // Busca CNPJs dos participantes do 1601 na tabela sped_participantes
            const codPartsList = [...map1601Participantes.keys()];
            let participantes1601 = [];
            try {
                const res1601 = await dbClient.query(
                    'SELECT cod_part, nome, cnpj FROM sped_participantes WHERE id_sped_arquivo = $1 AND cod_part = ANY($2)',
                    [arquivoId, codPartsList]
                );
                participantes1601 = res1601.rows;
            } catch (e) {
                logger.warn('[Fix C] Erro ao buscar participantes 1601 no banco:', e.message);
            }

            for (const part of participantes1601) {
                const cnpjLimpo = (part.cnpj || '').replace(/\D/g, '');
                if (!cnpjLimpo || set0150CnpjsPresentes.has(cnpjLimpo)) continue;

                // Determina COD_MUN a partir do arquivo ou usa padrão
                const nomePart = (part.nome || 'FORNECEDOR COMBUSTIVEL').toUpperCase().substring(0, 60);
                // Formato 0150: |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|END|NUM|COMPL|BAIRRO|
                const nova0150 = `|0150|${part.cod_part}|${nomePart}|1058|${cnpjLimpo}||ISENTO|||||||`;

                // Insere a nova linha 0150 antes do 0990 no outputLines
                const idx0990 = outputLines.findIndex(l => l.split('|')[1] === '0990');
                if (idx0990 !== -1) {
                    outputLines.splice(idx0990, 0, nova0150);
                } else {
                    // Fallback: insere após o último 0150 existente
                    let lastIdx0150 = -1;
                    for (let i = outputLines.length - 1; i >= 0; i--) {
                        if (outputLines[i].split('|')[1] === '0150') { lastIdx0150 = i; break; }
                    }
                    outputLines.splice(lastIdx0150 !== -1 ? lastIdx0150 + 1 : 0, 0, nova0150);
                }
                set0150CnpjsPresentes.add(cnpjLimpo);
                changesApplied++;
                logger.info(`[Fix C] 0150 injetado para participante 1601: ${part.cod_part} / CNPJ: ${cnpjLimpo}`);
            }
        }

        // ── Normalizar uso/consumo → CST x90 (C170 e C190 coerentes) ───────────
        // Entrada de uso/consumo (CFOP 1407/1556/2407/2556) não gera crédito de ICMS →
        // CST_ICMS = x90 ("Outras"). Aplica em C170 e C190 (e funde C190 duplicado),
        // evitando o erro PVA de combinação CST/CFOP/ALIQ. Decisão fiscal do contribuinte.
        {
            const { normalizarUsoConsumoCst90 } = require('./services/spedCostureiraService');
            const _normUso = normalizarUsoConsumoCst90(outputLines);
            if (_normUso !== outputLines) {
                outputLines.length = 0;
                for (const _l of _normUso) outputLines.push(_l);
            }
        }

        // ── Normalizar 0221 (item atômico): cada um sob o seu 0200 correto ─────
        // Alguns ERPs emitem o 0221 fora de ordem (após outro 0200) → o PVA o trata
        // como órfão e rejeita: "COD_ITEM_ATOMICO ... deve existir no COD_ITEM de um
        // 0200 pai ... com um único filho 0221". Reposiciona antes do recálculo.
        {
            const { realocar0221 } = require('./services/spedCostureiraService');
            const _ord0221 = realocar0221(outputLines);
            if (_ord0221 !== outputLines) {
                outputLines.length = 0;
                for (const _l of _ord0221) outputLines.push(_l);
            }
        }

        // ── Recalcular TODOS os totalizadores antes de escrever ────────────────
        // Após dedup C100/D100, injeção de 0220, filtros 0200/0206 e demais
        // ajustes, as contagens originais do arquivo ficam incorretas. Recalcula
        // 9900 (por registro), os fechamentos de bloco X990 (0990/B990/C990/D990/
        // E990/G990/H990/K990/1990/9990) e o 9999 a partir das LINHAS FINAIS —
        // fonte única de verdade. Antes, C990/D990/etc. eram escritos verbatim e
        // ficavam defasados (ex.: C990 = +1 após a dedup de um C100 → erro PVA
        // "Quantidade de linhas do bloco C ... não confere").
        const regCountMap = new Map();
        const blockLineCount = {}; // 1º caractere do registro → nº de linhas do bloco
        for (const l of outputLines) {
            const parts = l.split('|');
            if (parts.length >= 2 && parts[1]) {
                const reg = parts[1];
                regCountMap.set(reg, (regCountMap.get(reg) || 0) + 1);
                const bloco = reg.charAt(0);
                blockLineCount[bloco] = (blockLineCount[bloco] || 0) + 1;
            }
        }
        const totalLines = outputLines.length;
        // Registro de fechamento de bloco → caractere do bloco que ele totaliza
        const fechamentoBloco = {
            '0990': '0', 'B990': 'B', 'C990': 'C', 'D990': 'D', 'E990': 'E',
            'G990': 'G', 'H990': 'H', 'K990': 'K', '1990': '1', '9990': '9'
        };

        for (const l of outputLines) {
            const parts = l.split('|');
            const reg = parts[1];
            if (parts.length >= 4 && reg === '9900') {
                // |9900|REGISTRO|QTD| — atualiza QTD com a contagem real do registro
                parts[3] = String(regCountMap.get(parts[2]) || 0);
                res.write(parts.join('|') + '\r\n');
            } else if (parts.length >= 3 && fechamentoBloco[reg] !== undefined) {
                // |X990|QTD_LIN_X| — total de linhas do bloco X (inclui o próprio X990)
                parts[2] = String(blockLineCount[fechamentoBloco[reg]] || 0);
                res.write(parts.join('|') + '\r\n');
            } else if (parts.length >= 3 && reg === '9999') {
                // |9999|QTD_LIN| — total de linhas do arquivo
                parts[2] = String(totalLines);
                res.write(parts.join('|') + '\r\n');
            } else {
                res.write(l + '\r\n');
            }
        }
        // ──────────────────────────────────────────────────────────────────────

        logger.info(`Exportação concluída: ${linesProcessed} linhas lidas, ${changesApplied} ajustes aplicados, ${outputLines.length} linhas escritas.`);
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
        releaseHeavySlot();
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
            produtos: [],
            bicos: []   // registros 1320 (encerrantes por bico) crus do arquivo
        };
        let currentC100 = null;
        let current1300 = null;
        const ctx1320 = { codItem: null, dataMov: null, numTanque: null }; // contexto p/ vincular 1320
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
                    // TRIM defensivo: alguns SPEDs gravam campos como CHAR fixo com padding (60 chars).
                    // Sem o TRIM, JOINs cross-arquivo e queries por igualdade quebram silenciosamente.
                    data.produtos.push({
                        cod_item:   String(fields[2] || '').trim(),
                        descr_item: String(fields[3] || '').trim(),
                        ncm: (fields[8] || '').replace(/\D/g, '')
                    });
                } else if (reg === '1300') {
                    // *** REGISTRO CONSOLIDADO (A SOLUÇÃO REAL) ***
                    // O cliente informou que o LMC precisa bater os totais. 
                    // No bloco 1300, a estrutura é:
                    // 0 = (vazio), 1 = 1300, 2 = cod_item, 3 = dt_fech, 4 = estq_abert, 5 = vol_entr, 
                    // 6 = vol_disp, 7 = vol_saidas, 8 = estq_escr, 9 = val_perda, 10 = val_ganho, 11 = fech_fisico

                    const p = fields;
                    // TRIM defensivo (CHAR fixo com padding) — chave dos Maps abaixo precisa estar
                    // normalizada para casar com sped_produtos.cod_item (também TRIM-ado em 0200).
                    const codItem = String(p[2] || '').trim();
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
                    // Contexto para os registros 1310/1320 que seguem este 1300
                    ctx1320.codItem = codItem;
                    ctx1320.dataMov = formatDate(dtFech); // 'YYYY-MM-DD'
                    ctx1320.numTanque = null;
                } else if (reg === '1310' && current1300) {
                    // Guardamos o tanque corrente para vincular aos 1320 seguintes
                    // (continuamos ignorando o 1310 para o LMC consolidado)
                    ctx1320.numTanque = String(fields[2] || '').trim();
                } else if (reg === '1320' && current1300 && ctx1320.codItem) {
                    // Encerrantes por bico. Layout real: [2]=bico, [8]=enc_fin, [9]=enc_ini, [10]=qtd_af, [11]=vol
                    data.bicos.push({
                        data_mov: ctx1320.dataMov,
                        cod_item: ctx1320.codItem,
                        num_tanque: ctx1320.numTanque,
                        num_bico: String(fields[2] || '').trim(),
                        enc_ini: parseFloatSped(fields[9]),
                        enc_fin: parseFloatSped(fields[8]),
                        qtd_af: parseFloatSped(fields[10]),
                        vol_bico: parseFloatSped(fields[11])
                    });
                } else if (reg === 'C100') {
                    currentC100 = {
                        ind_oper: fields[2], num_doc: fields[8], cod_mod: fields[5],
                        cod_sit: fields[6], dt_doc: formatDate(fields[10]), dt_e_s: formatDate(fields[11]),
                        vl_doc: parseFloatSped(fields[12]), cod_part: fields[4], chv_nfe: fields[9],
                        items: [], analytical: []
                    };
                    data.documents.push(currentC100);
                } else if (reg === 'C170' && currentC100) {
                    // TRIM defensivo: C170 também sofre padding em SPEDs CHAR-fixo.
                    currentC100.items.push({
                        num_item: parseInt(fields[2]),
                        cod_item: String(fields[3] || '').trim(),
                        qtd: parseFloatSped(fields[5]),
                        unid: String(fields[6] || '').trim(),
                        vl_item: parseFloatSped(fields[7]),
                        cst_icms: String(fields[10] || '').trim(),
                        cfop: String(fields[11] || '').trim(),
                        cst_pis: String(fields[25] || '').trim(),
                        cst_cofins: String(fields[31] || '').trim()
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
// --- ENDPOINT OTIMIZAÇÃO DE LMC ---
app.post('/api/lmc/optimize', authMiddleware, async (req, res) => {
    const { arquivoId, codItem, targetVolume } = req.body;
    
    if (!arquivoId || !codItem || !targetVolume) {
        return res.status(400).json({ message: 'Parâmetros obrigatórios ausentes: arquivoId, codItem, targetVolume' });
    }

    try {
        logger.info(`Iniciando otimização LMC para arquivo ${arquivoId}, item ${codItem}, alvo ${targetVolume}`);
        const result = await runOptimization(arquivoId, codItem, targetVolume);
        
        if (result && result.success) {
            logger.info(`Otimização LMC finalizada com sucesso. Linhas atualizadas: ${result.updates}`);
            res.json(result);
        } else {
            res.status(400).json({ message: 'Otimização concluída, mas sem confirmação de sucesso.', result });
        }
    } catch (error) {
        logger.error(`Erro na otimização: ${error.message}`);
        res.status(500).json({ message: 'Erro interno ao tentar otimizar LMC', error: error.message });
    }
});

// --------------------------------------------------------------------------
// ENDPOINTS: REGRAS FISCAIS (cadastro global condição→ação) — CRUD + simulador.
// NÃO toca a injeção/export; só lê/grava a tabela e invalida o cache do motor.
// --------------------------------------------------------------------------
const REGRA_CAMPOS = ['nome','descricao','fundamento_legal','prioridade','ativo','confianca','escopo_aplicacao','dt_ini','dt_fim','ind_oper','ncm_prefix','cst_icms_origem','cfop_origem','tipo_produto','regime','id_empresa','cnpj_emissor','uf_origem','cond_extra','acao_cst_icms','acao_cfop','acao_cst_pis','acao_cst_cofins','acao_aliq_icms','acao_bc_icms_mode','acao_bc_icms_valor','flag_zera_icms','flag_usar_st_ret','flag_soma_ipi_st_custo','flag_bloqueia_credito_st','flag_para_no_match','flag_apenas_alerta','acao_extra'];
const REGRA_JSONB = new Set(['cond_extra', 'acao_extra']);
function montarRegra(body) {
    const cols = [], vals = [];
    for (const c of REGRA_CAMPOS) {
        if (!(c in body)) continue;
        let v = body[c];
        if (REGRA_JSONB.has(c)) v = (v == null) ? '{}' : (typeof v === 'string' ? v : JSON.stringify(v));
        if (v === '') v = null;
        cols.push(c); vals.push(v);
    }
    return { cols, vals };
}

app.get('/api/regras-fiscais', authMiddleware, async (req, res) => {
    try {
        await regrasFiscais.ensureTabelasRegras(pool);
        const { ativo, escopo } = req.query;
        let q = 'SELECT * FROM regras_fiscais WHERE 1=1';
        const p = [];
        if (ativo === 'true' || ativo === 'false') { p.push(ativo === 'true'); q += ` AND ativo = $${p.length}`; }
        if (escopo) { p.push(escopo); q += ` AND escopo_aplicacao = $${p.length}`; }
        q += ' ORDER BY prioridade ASC, id ASC';
        const { rows } = await pool.query(q, p);
        res.status(200).json(rows);
    } catch (e) {
        logger.error('[regras-fiscais] erro:', e.message);
        res.status(500).json({ message: 'Erro ao listar regras fiscais.', error: e.message });
    }
});

app.post('/api/regras-fiscais', authMiddleware, async (req, res) => {
    try {
        await regrasFiscais.ensureTabelasRegras(pool);
        if (!req.body.nome) return res.status(400).json({ message: 'Nome é obrigatório.' });
        const { cols, vals } = montarRegra(req.body);
        const ph = cols.map((_, i) => `$${i + 1}`).join(',');
        const { rows } = await pool.query(`INSERT INTO regras_fiscais (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals);
        regrasFiscais.invalidarCache();
        res.status(201).json(rows[0]);
    } catch (e) {
        logger.error('[regras-fiscais POST] erro:', e.message);
        res.status(500).json({ message: 'Erro ao criar regra.', error: e.message });
    }
});

app.put('/api/regras-fiscais/:id', authMiddleware, async (req, res) => {
    try {
        const { cols, vals } = montarRegra(req.body);
        if (!cols.length) return res.status(400).json({ message: 'Nada para atualizar.' });
        const set = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        vals.push(req.params.id);
        const { rows } = await pool.query(`UPDATE regras_fiscais SET ${set}, updated_at = CURRENT_TIMESTAMP WHERE id = $${vals.length} RETURNING *`, vals);
        if (!rows.length) return res.status(404).json({ message: 'Regra não encontrada.' });
        regrasFiscais.invalidarCache();
        res.status(200).json(rows[0]);
    } catch (e) {
        logger.error('[regras-fiscais PUT] erro:', e.message);
        res.status(500).json({ message: 'Erro ao atualizar regra.', error: e.message });
    }
});

app.patch('/api/regras-fiscais/:id/ativar', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('UPDATE regras_fiscais SET ativo = NOT ativo, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Regra não encontrada.' });
        regrasFiscais.invalidarCache();
        res.status(200).json(rows[0]);
    } catch (e) {
        res.status(500).json({ message: 'Erro ao ativar/desativar.', error: e.message });
    }
});

app.post('/api/regras-fiscais/:id/duplicar', authMiddleware, async (req, res) => {
    try {
        const orig = await pool.query('SELECT * FROM regras_fiscais WHERE id = $1', [req.params.id]);
        if (!orig.rows.length) return res.status(404).json({ message: 'Regra não encontrada.' });
        const r = orig.rows[0];
        r.nome = `${r.nome} (cópia)`; r.ativo = false;
        const { cols, vals } = montarRegra(r);
        const ph = cols.map((_, i) => `$${i + 1}`).join(',');
        const { rows } = await pool.query(`INSERT INTO regras_fiscais (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals);
        regrasFiscais.invalidarCache();
        res.status(201).json(rows[0]);
    } catch (e) {
        res.status(500).json({ message: 'Erro ao duplicar.', error: e.message });
    }
});

app.delete('/api/regras-fiscais/:id', authMiddleware, async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM regras_fiscais WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ message: 'Regra não encontrada.' });
        regrasFiscais.invalidarCache();
        res.status(200).json({ message: 'Regra excluída.' });
    } catch (e) {
        res.status(500).json({ message: 'Erro ao excluir.', error: e.message });
    }
});

// Simulador: aplica as regras vigentes a um item de exemplo SEM persistir e SEM tocar arquivo.
app.post('/api/regras-fiscais/simular', authMiddleware, async (req, res) => {
    try {
        await regrasFiscais.ensureTabelasRegras(pool);
        const { item = {}, competencia, escopo = 'ambos' } = req.body;
        const comp = (competencia && /^\d{4}-\d{2}/.test(competencia)) ? (competencia.slice(0, 7) + '-01') : '2000-01-01';
        const regras = await regrasFiscais.carregarRegras(pool, comp, escopo);
        const antes = { cst_icms: item.cst_icms, cfop: item.cfop, cst_pis: item.cst_pis, cst_cofins: item.cst_cofins };
        const trilha = [];
        const depois = { ...item };
        regrasFiscais.aplicarRegrasFiscaisComLista(depois, regras, { origem: 'SIMULADOR', ind_oper: item.ind_oper, cnpj_emissor: item.cnpj_emissor, trilha });
        res.status(200).json({ antes, depois: { cst_icms: depois.cst_icms, cfop: depois.cfop, cst_pis: depois.cst_pis, cst_cofins: depois.cst_cofins }, trilha, competencia: comp, total_regras: regras.length });
    } catch (e) {
        logger.error('[regras-fiscais simular] erro:', e.message);
        res.status(500).json({ message: 'Erro ao simular.', error: e.message });
    }
});

// --------------------------------------------------------------------------
// ENDPOINTS: DE-PARA XML
// --------------------------------------------------------------------------

app.get('/api/de-para', async (req, res) => {
    try {
        const { cnpj, id_empresa } = req.query;
        let query = 'SELECT * FROM de_para_xml WHERE 1=1';
        let params = [];
        
        if (id_empresa) {
            params.push(id_empresa);
            query += ` AND id_empresa = $${params.length}`;
        }

        if (cnpj) {
            params.push(cnpj);
            query += ` AND cnpj_emissor = $${params.length}`;
        }
        
        query += ' ORDER BY cnpj_emissor, cod_produto_xml';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar de-para:', err);
        res.status(500).json({ error: 'Erro interno buscador de-para' });
    }
});

app.post('/api/de-para', async (req, res) => {
    try {
        const { id_empresa, cnpj_emissor, cod_produto_xml, novo_cfop, novo_cst, descricao_produto, cod_interno,
                aliq_icms, bc_icms_override, cst_pis, cst_cofins } = req.body;

        if (!id_empresa || !cnpj_emissor || !cod_produto_xml) {
            return res.status(400).json({ error: 'Empresa, CNPJ e Código do Produto são obrigatórios' });
        }

        await pool.query(`
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS ncm VARCHAR(20);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS cod_interno VARCHAR(60);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS conta_contabil VARCHAR(60);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS aliq_icms NUMERIC(10,4);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS bc_icms_override NUMERIC(15,2);
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS cst_pis TEXT;
            ALTER TABLE de_para_xml ADD COLUMN IF NOT EXISTS cst_cofins TEXT;
        `);

        const query = `
            INSERT INTO de_para_xml (id_empresa, cnpj_emissor, cod_produto_xml, novo_cfop, novo_cst, descricao_produto, cod_interno, aliq_icms, bc_icms_override, cst_pis, cst_cofins)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id_empresa, cnpj_emissor, cod_produto_xml)
            DO UPDATE SET
                novo_cfop = EXCLUDED.novo_cfop,
                novo_cst = EXCLUDED.novo_cst,
                descricao_produto = EXCLUDED.descricao_produto,
                cod_interno = COALESCE(NULLIF(EXCLUDED.cod_interno, ''), de_para_xml.cod_interno),
                aliq_icms = COALESCE(EXCLUDED.aliq_icms, de_para_xml.aliq_icms),
                bc_icms_override = COALESCE(EXCLUDED.bc_icms_override, de_para_xml.bc_icms_override),
                cst_pis = COALESCE(NULLIF(EXCLUDED.cst_pis, ''), de_para_xml.cst_pis),
                cst_cofins = COALESCE(NULLIF(EXCLUDED.cst_cofins, ''), de_para_xml.cst_cofins),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;

        const result = await pool.query(query, [
            id_empresa, cnpj_emissor, cod_produto_xml, novo_cfop, novo_cst, descricao_produto, cod_interno,
            aliq_icms || null, bc_icms_override || null, cst_pis || null, cst_cofins || null
        ]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao salvar de-para:', err);
        res.status(500).json({ error: 'Erro interno ao salvar de-para' });
    }
});

app.delete('/api/de-para/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM de_para_xml WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao deletar de-para:', err);
        res.status(500).json({ error: 'Erro interno ao deletar de-para' });
    }
});

// --- FASE: CONFERÊNCIA SPED vs MD-E ---
app.post('/api/mde/check-sped', authMiddleware, async (req, res) => {
    try {
        const { chaves, id_empresa } = req.body;
        if (!chaves || !Array.isArray(chaves)) return res.status(400).json({ error: 'Lista de chaves inválida' });

        const result = await pool.query(`
            SELECT chave_nfe FROM mde_cache WHERE id_empresa = $1 AND chave_nfe = ANY($2)
            UNION
            SELECT chv_nfe as chave_nfe FROM documentos_c100 dc 
            JOIN sped_arquivos sa ON dc.id_sped_arquivo = sa.id
            WHERE sa.id_empresa = $1 AND dc.chv_nfe = ANY($2)
        `, [id_empresa, chaves]);

        const chavesEncontradas = result.rows.map(r => r.chave_nfe);
        const chavesFaltantes = chaves.filter(c => !chavesEncontradas.includes(c));

        res.json({
            total_arquivo: chaves.length,
            encontradas: chavesEncontradas.length,
            faltantes: chavesFaltantes.length,
            lista_faltantes: chavesFaltantes
        });
    } catch (err) {
        logger.error('Erro na conferência Sped:', err);
        res.status(500).json({ error: 'Falha ao processar conferência' });
    }
});

app.post('/api/mde/sync-missing', authMiddleware, async (req, res) => {
    try {
        const { chaves, id_empresa } = req.body;
        if (!chaves || !Array.isArray(chaves)) return res.status(400).json({ error: 'Lista de chaves inválida' });

        logger.info(`Solicitada captura de ${chaves.length} chaves faltantes via EspiãoNFe na empresa ${id_empresa}`);
        
        // Realmente chama o serviço para importar as chaves
        const result = await espiaoNfeService.importarChavesLote(id_empresa, chaves);
        
        res.json({ 
            success: true, 
            message: `${chaves.length} chaves enviadas para fila de captura via EspiãoNFe.`,
            detalhes: result.detalhes
        });
    } catch (err) {
        logger.error('Erro ao sincronizar faltantes:', err);
        res.status(500).json({ error: 'Falha ao iniciar sincronização' });
    }
});

// ─── CT-e INJECTOR ────────────────────────────────────────────────────────────

/**
 * POST /api/cte-injector/analyze
 * Recebe XMLs de CT-e, faz parse e retorna preview sem gravar nada.
 * Body (multipart): xmlFiles[] + id_empresa (opcional)
 */
app.post('/api/cte-injector/analyze', authMiddleware, uploadXml.array('xmlFiles', 500), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'Nenhum arquivo XML enviado.' });
    }
    const limparTemps = () => req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
    try {
        const { parseCteXml, transformarCtesEmSped } = require('./services/cteInjectorService');

        const parsedCtes = req.files.map(f => {
            try {
                const xml = fs.readFileSync(f.path, 'utf-8');
                logger.info(`[DIAG] arquivo=${f.originalname} tamanho=${xml.length} inicio=${JSON.stringify(xml.substring(0, 120))}`);
                const parsed = parseCteXml(xml);
                if (!parsed.ok) logger.warn(`CT-e parse falhou [${f.originalname}]: ${parsed.erro}`);
                return parsed;
            } catch (err) {
                logger.warn(`CT-e parse exception [${f.originalname}]: ${err.message}`);
                return { ok: false, erro: err.message };
            }
        });

        const erros = parsedCtes
            .filter(p => !p.ok)
            .slice(0, 5)
            .map(p => p.erro || 'erro desconhecido');

        const resultado = await transformarCtesEmSped(pool, parsedCtes, { analyzeOnly: true });
        limparTemps();
        return res.json({
            ctes: resultado.ctesProcessados,
            relatorio: resultado.relatorio,
            erros,
        });
    } catch (err) {
        limparTemps();
        logger.error('Erro em /api/cte-injector/analyze:', err);
        return res.status(500).json({ message: 'Erro ao analisar CT-e.', error: err.message });
    }
});

/**
 * POST /api/cte-injector/inject
 * Injeta CT-es em um arquivo SPED existente (Bloco D: D100 + D190)
 * Body (multipart): xmlFiles[] + id_arquivo (ID do SPED base)
 */
app.post('/api/cte-injector/inject', authMiddleware, uploadXml.array('xmlFiles', 500), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'Nenhum arquivo XML enviado.' });
    }
    const limparTemps = () => req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
    try {
        const idArquivo = parseInt(req.body.id_arquivo);
        if (isNaN(idArquivo)) {
            limparTemps();
            return res.status(400).json({ message: 'id_arquivo inválido.' });
        }

        // Busca o arquivo SPED base
        const arqRes = await pool.query('SELECT caminho_arquivo, cnpj_empresa, periodo_apuracao FROM sped_arquivos WHERE id = $1', [idArquivo]);
        if (arqRes.rows.length === 0) {
            limparTemps();
            return res.status(404).json({ message: 'Arquivo SPED não encontrado.' });
        }
        const { caminho_arquivo: spedPath, cnpj_empresa, periodo_apuracao } = arqRes.rows[0];

        // Monta nome: CNPJ_DDMMAAAA_DDMMAAAA.txt  (ex: 23294731000192_01122020_31122020.txt)
        // periodo_apuracao está no formato "01/12/2020 a 31/12/2020"
        const cnpjLimpo = String(cnpj_empresa || '').replace(/\D/g, '');
        const partes    = String(periodo_apuracao || '').split(' a ');
        const periodoIni = (partes[0] || '').replace(/\D/g, ''); // "01122020"
        const periodoFim = (partes[1] || partes[0] || '').replace(/\D/g, ''); // "31122020"
        const nomeArquivo = `${cnpjLimpo}_${periodoIni}_${periodoFim}.txt`;

        const { parseCteXml, transformarCtesEmSped } = require('./services/cteInjectorService');
        const { costurarEAssinar } = require('./services/spedCostureiraService');

        const parsedCtes = req.files.map((f, idx) => {
            try {
                const xml = fs.readFileSync(f.path, 'utf-8');
                const cte = parseCteXml(xml);
                cte._arquivo = req.files[idx].originalname;
                return cte;
            } catch (err) {
                return { ok: false, erro: err.message, _arquivo: req.files[idx].originalname };
            }
        });

        // --- VALIDAÇÃO DE CNPJ E PERÍODO ---
        const forcePeriodoCte = req.body.force_periodo === 'true';
        const itensCteVal = parsedCtes.filter(c => c.ok).map(c => ({
            arquivo: c._arquivo,
            cnpjDest: c.cnpj_dest,
            dtDoc: c.dt_doc
        }));
        const { bloqueados: bloqCte, avisos: avisosCte } = validarXmls(itensCteVal, cnpj_empresa, periodo_apuracao, forcePeriodoCte);
        if (bloqCte.length > 0) {
            limparTemps();
            return res.status(422).json({
                tipo: 'cnpj_invalido',
                message: `${bloqCte.length} CT-e(s) rejeitado(s): CNPJ do destinatário não corresponde ao CNPJ do SPED (${limparCnpjStr(cnpj_empresa)}).`,
                bloqueados: bloqCte
            });
        }
        if (avisosCte.length > 0) {
            limparTemps();
            return res.status(422).json({
                tipo: 'periodo_divergente',
                message: `${avisosCte.length} CT-e(s) com data fora do período auditado.`,
                periodo_sped: periodo_apuracao,
                avisos: avisosCte
            });
        }
        // --- FIM VALIDAÇÃO ---

        const resultado = await transformarCtesEmSped(pool, parsedCtes, { analyzeOnly: false });

        // Converte map0150 em array de linhas
        const novos0150 = [...resultado.map0150.values()].map(l => l.startsWith('|') ? l : `|${l}`);

        const linhasFinais = await costurarEAssinar(
            spedPath,
            novos0150,   // Bloco 0: participantes transportadoras
            [],          // Bloco C: sem NF-e nesta injeção
            [],          // sem substituição de chaves
            resultado.blocoD,
        );

        limparTemps();
        const spedContent = linhasFinais.join('\r\n') + '\r\n';
        res.setHeader('Content-Type', 'text/plain; charset=latin1');
        res.setHeader('Content-Disposition', `attachment; filename=${nomeArquivo}`);
        return res.status(200).send(Buffer.from(spedContent, 'latin1'));

    } catch (err) {
        limparTemps();
        logger.error('Erro em /api/cte-injector/inject:', err);
        return res.status(500).json({ message: 'Erro ao injetar CT-e no SPED.', error: err.message });
    }
});

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Servidor AudiSped online em http://0.0.0.0:${PORT} (acessível na rede local)`);
    // Garante a tabela de cache da NFe completa (viewer "Cálculo do Imposto")
    ensureNfeCompletaTable(pool)
        .then(() => logger.info('Tabela nfe_completa pronta.'))
        .catch(e => logger.warn('Falha ao garantir nfe_completa: ' + e.message));
    // Motor de Regras Fiscais: garante tabelas + seed das regras de alta confiança
    regrasFiscais.ensureTabelasRegras(pool)
        .then(() => regrasFiscais.seedRegrasFiscais(pool))
        .then(n => logger.info(`Regras fiscais prontas${n ? ` (seed: ${n} regras)` : ''}.`))
        .catch(e => logger.warn('Falha ao garantir regras_fiscais: ' + e.message));
});