// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const readline = require('readline');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 15435;

app.use(cors());
app.use(express.json());

// --- Configuração da Conexão com o Banco de Dados PostgreSQL ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// --- Configuração do Multer ---
const upload = multer({ dest: 'uploads/' });

// --- Rota de Upload (Aprimorada para salvar participantes) ---
app.post('/api/upload', upload.single('spedfile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send({ message: 'Nenhum arquivo foi enviado.' });
  }

  console.log(`Arquivo ${req.file.originalname} recebido. Processando...`);
  const filePath = req.file.path;
  const dbClient = await pool.connect();

  try {
    const { fileInfo, documents, participants } = await parseSpedFile(filePath, req.file.originalname);
    
    await dbClient.query('BEGIN');

    const arqQuery = 'INSERT INTO sped_arquivos (nome_arquivo, cnpj_empresa, periodo_apuracao) VALUES ($1, $2, $3) RETURNING id';
    const arqResult = await dbClient.query(arqQuery, [fileInfo.nome_arquivo, fileInfo.cnpj_empresa, fileInfo.periodo_apuracao]);
    const sped_arquivo_id = arqResult.rows[0].id;

    for (const p of participants) {
        const partQuery = 'INSERT INTO sped_participantes (id_sped_arquivo, cod_part, nome, cnpj) VALUES ($1, $2, $3, $4) ON CONFLICT (id_sped_arquivo, cod_part) DO NOTHING';
        await dbClient.query(partQuery, [sped_arquivo_id, p.cod_part, p.nome, p.cnpj]);
    }

    let C170_count = 0;
    for (const doc of documents) {
      const docQuery = 'INSERT INTO documentos_c100 (id_sped_arquivo, num_doc, cod_mod, cod_sit, dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id';
      const docResult = await dbClient.query(docQuery, [sped_arquivo_id, doc.num_doc, doc.cod_mod, doc.cod_sit, doc.dt_doc, doc.dt_e_s, doc.vl_doc, doc.cod_part, doc.chv_nfe]);
      const currentC100_id = docResult.rows[0].id;
      
      for (const item of doc.items) {
        const itemQuery = 'INSERT INTO documentos_itens_c170 (id_documento_c100, num_item, cod_item, qtd, unid, vl_item, cst_icms, cfop) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
        await dbClient.query(itemQuery, [currentC100_id, item.num_item, item.cod_item, item.qtd, item.unid, item.vl_item, item.cst_icms, item.cfop]);
        C170_count++;
      }
    }

    await dbClient.query('COMMIT');
    res.status(200).send({
      message: `Arquivo processado e salvo no banco de dados!`,
      id_sped_arquivo: sped_arquivo_id
    });
  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Erro durante o processamento do arquivo:', error);
    res.status(500).send({ message: "Ocorreu um erro ao processar o arquivo.", error: error.message });
  } finally {
    dbClient.release();
    fs.unlinkSync(filePath);
    console.log('Processo finalizado.');
  }
});

// --- ROTA PARA INICIAR A ANÁLISE DE ERROS ---
app.post('/api/analisar/:id', async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if(isNaN(arquivoId)){
        return res.status(400).send({ message: "ID de arquivo inválido."});
    }

    console.log(`Iniciando análise para o arquivo ID: ${arquivoId}`);
    const dbClient = await pool.connect();
    try {
        await dbClient.query('BEGIN');
        await dbClient.query('DELETE FROM erros_analise WHERE id_sped_arquivo = $1', [arquivoId]);

        const erroExemplo = {
            id_sped_arquivo: arquivoId,
            tipo_erro: 'CRITICAL',
            regra_id: 'EXEMPLO-001',
            titulo_erro: 'Erro de Exemplo Simulado',
            descricao_erro: 'Esta é uma descrição de um erro encontrado pelo motor de análise no backend.',
            sugestao_correcao: 'Verificar os dados de origem e reprocessar o arquivo.',
            linha_arquivo: 1,
            conteudo_linha: '|0000|EXEMPLO DE LINHA|'
        };

        const query = 'INSERT INTO erros_analise (id_sped_arquivo, tipo_erro, regra_id, titulo_erro, descricao_erro, sugestao_correcao, linha_arquivo, conteudo_linha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
        await dbClient.query(query, Object.values(erroExemplo));
        
        await dbClient.query('COMMIT');
        console.log(`Análise concluída para o arquivo ID: ${arquivoId}. Erros salvos.`);
        res.status(200).send({ message: "Análise concluída com sucesso. Erros salvos no banco de dados."});

    } catch(error) {
        await dbClient.query('ROLLBACK');
        console.error("Erro ao executar análise:", error);
        res.status(500).json({ message: "Erro ao executar análise.", error: error.message });
    } finally {
        dbClient.release();
    }
});

// --- ROTA PARA BUSCAR OS ERROS DE UMA ANÁLISE ---
app.get('/api/erros/:id', async (req, res) => {
    const arquivoId = parseInt(req.params.id);
    if(isNaN(arquivoId)){
        return res.status(400).send({ message: "ID de arquivo inválido."});
    }
    
    console.log(`Buscando erros para o arquivo ID: ${arquivoId}`);
    const dbClient = await pool.connect();
    try {
        const { rows } = await dbClient.query('SELECT * FROM erros_analise WHERE id_sped_arquivo = $1', [arquivoId]);
        res.status(200).json(rows);
    } catch(error) {
        console.error("Erro ao buscar erros:", error);
        res.status(500).json({ message: "Erro ao buscar erros.", error: error.message });
    } finally {
        dbClient.release();
    }
});


// --- Funções Auxiliares e Servidor ---
const parseFloatSped = (str) => parseFloat((str || "0").replace(',', '.')) || 0;
function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return null;
  const day = dateStr.substring(0, 2);
  const month = dateStr.substring(2, 4);
  const year = dateStr.substring(4);
  return `${year}-${month}-${day}`;
}
async function parseSpedFile(filePath, originalFilename) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  const fileInfo = { nome_arquivo: originalFilename };
  const documents = [];
  const participants = [];
  let currentC100 = null;

  for await (const line of rl) {
    const fields = line.split('|');
    const reg = fields[1];
    if (reg === '0000') {
      fileInfo.cnpj_empresa = fields[7];
      fileInfo.periodo_apuracao = `${fields[4]} a ${fields[5]}`;
    } else if (reg === '0150') {
      participants.push({ cod_part: fields[2], nome: fields[3], cnpj: fields[5] });
    } else if (reg === 'C100') {
      currentC100 = {
        num_doc: fields[8], cod_mod: fields[5], cod_sit: fields[6],
        dt_doc: formatDate(fields[10]), dt_e_s: formatDate(fields[11]),
        vl_doc: parseFloatSped(fields[12]), cod_part: fields[4], chv_nfe: fields[9],
        items: []
      };
      documents.push(currentC100);
    } else if (reg === 'C170' && currentC100) {
      currentC100.items.push({
        num_item: parseInt(fields[2]), cod_item: fields[3], qtd: parseFloatSped(fields[5]),
        unid: fields[6], vl_item: parseFloatSped(fields[7]), cst_icms: fields[9], cfop: fields[10]
      });
    }
  }
  return { fileInfo, documents, participants };
}

app.listen(PORT, () => {
  console.log(`Servidor AudiSped rodando na porta ${PORT}. Acesse http://localhost:${PORT}`);
});