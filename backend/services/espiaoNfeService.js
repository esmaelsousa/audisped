const axios = require('axios');
const { Pool } = require('pg');
const logger = require('../logger');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { XMLParser } = require('fast-xml-parser');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

class EspiaoNfeService {
    constructor() {
        // Base URL conforme documentação v1-cloud
        this.baseUrl = 'https://api.espiaonfe.com.br/v1-cloud';
        this.cloudToken = process.env.ESPIAONFE_CLOUD_TOKEN;
        this.userToken = process.env.ESPIAONFE_USER_TOKEN;
    }

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'esp-cloud-token': this.cloudToken,
            'user-token': this.userToken
        };
    }

    /**
     * Sincroniza o resumo das notas (NF-e) de um período.
     * Trata a paginação automática via codigoProximaPagina.
     */
    async syncNotas(idEmpresa, dataInicio, dataFim) {
        const resEmp = await pool.query('SELECT cnpj FROM empresas WHERE id = $1', [idEmpresa]);
        if (resEmp.rows.length === 0) throw new Error('Empresa não encontrada.');
        const cnpj = resEmp.rows[0].cnpj.replace(/\D/g, '');

        try {
            logger.info(`Iniciando sincronização v1-cloud para CNPJ ${cnpj} (${dataInicio} a ${dataFim})`);
            
            let proximaPagina = '';
            let totalProcessadas = 0;
            let temMais = true;

            while (temMais) {
                const response = await axios.get(`${this.baseUrl}/consulta/periodo/nfe-resumo`, {
                    headers: this.getHeaders(),
                    params: {
                        cnpjCpf: cnpj,
                        dataInicial: dataInicio,
                        dataFinal: dataFim,
                        modelo: 55, // 55 = NF-e
                        codigoProximaPagina: proximaPagina
                    }
                });

                const dados = response.data.dados || [];
                proximaPagina = response.data.codigoProximaPagina;

                for (const nota of dados) {
                    const tipoOperacao = nota.tipoOperacao === 0 ? 'Entrada' : (nota.tipoOperacao === 1 ? 'Saída' : 'Desconhecido');
                    
                    await pool.query(`
                        INSERT INTO mde_cache (
                            id_empresa, chave_nfe, nsu, cnpj_emissor, nome_emissor, valor, data_emissao, status_manifesto, tipo_operacao
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        ON CONFLICT (chave_nfe) DO UPDATE SET
                            nome_emissor = EXCLUDED.nome_emissor,
                            valor = EXCLUDED.valor,
                            data_emissao = EXCLUDED.data_emissao,
                            status_manifesto = EXCLUDED.status_manifesto,
                            tipo_operacao = EXCLUDED.tipo_operacao
                    `, [
                        idEmpresa,
                        nota.chaveAcesso,
                        nota.nsu || '0',
                        nota.cnpjCpfEmitente,
                        nota.nomeEmitente,
                        nota.valorTotal ? nota.valorTotal.toString().replace(',', '.') : 0,
                        nota.dataEmissao,
                        nota.manifestacao || 'Identificada',
                        tipoOperacao
                    ]);
                    totalProcessadas++;
                }

                temMais = proximaPagina && proximaPagina.length > 0;
                
                if (temMais) {
                    //delay para evitar "API calls quota exceeded! maximum admitted 3 per 1s"
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            logger.info(`Sincronização EspiãoNFe concluída para CNPJ ${cnpj}: ${totalProcessadas} notas.`);

            return {
                message: `Sincronização concluída. ${totalProcessadas} notas encontradas.`,
                count: totalProcessadas
            };

        } catch (error) {
            const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            // "Não localizado" (404) = período sem notas no Espião Cloud → resultado VAZIO, não erro.
            const naoLocalizado = error.response?.status === 404 || /n[ãa]o\s+localizad/i.test(errorMsg);
            if (naoLocalizado) {
                logger.info(`EspiãoNFe: nenhuma nota localizada no período (empresa ${idEmpresa}).`);
                return { message: 'Nenhuma nota encontrada no Espião Cloud para este período. Verifique se a consulta automática desta empresa está ativa no painel.', count: 0 };
            }
            logger.error(`Erro na sincronização EspiãoNFe v1-cloud: ${errorMsg}`);
            throw new Error(`Falha na API v1-cloud: ${errorMsg}`);
        }
    }

    /**
     * Baixa, descompacta (Gzip) e armazena o XML de uma nota.
     */
    async downloadXml(idEmpresa, chaveNfe) {
        try {
            logger.info(`Baixando XML para chave ${chaveNfe}`);
            const response = await axios.get(`${this.baseUrl}/consulta/chave/xml`, {
                headers: this.getHeaders(),
                params: { chaveAcesso: chaveNfe }
            });

            let xmlContent = null;

            if (typeof response.data === 'string' && (response.data.includes('<nfeProc') || response.data.includes('<?xml'))) {
                // Formato retornado como string XML direta (v1-cloud atual)
                xmlContent = response.data;
            } else if (response.data && response.data.xml) {
                // Formato JSON com Base64 + Gzip
                const buffer = Buffer.from(response.data.xml, 'base64');
                xmlContent = zlib.gunzipSync(buffer).toString('utf-8');
            }

            if (xmlContent) {
                // Salva no banco
                await pool.query('UPDATE mde_cache SET xml_content = $1 WHERE chave_nfe = $2', [xmlContent, chaveNfe]);
                
                // Parse e extração de dados (Número, Série, Itens)
                await this.parseAndSaveXmlData(chaveNfe, xmlContent);
                
                // Salva no disco rígido
                await this.saveXmlToDisk(idEmpresa, chaveNfe, xmlContent);

                return xmlContent;
            }
            throw new Error('XML não disponível ou não encontrado na API.');
        } catch (error) {
            logger.error(`Erro ao processar XML ${chaveNfe}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Faz o parse do XML e salva numero, serie e itens no banco.
     */
    async parseAndSaveXmlData(chaveNfe, xmlContent) {
        try {
            const parser = new XMLParser({ ignoreAttributes: false });
            const jsonObj = parser.parse(xmlContent);

            // Tenta localizar a tag NFe em diferentes estruturas possíveis (nfeProc ou direto)
            const nfe = jsonObj.nfeProc ? jsonObj.nfeProc.NFe : jsonObj.NFe;
            if (!nfe) {
                logger.warn(`Estrutura NFe não encontrada no XML da chave ${chaveNfe}`);
                return;
            }

            const infNFe = nfe.infNFe;
            const ide = infNFe.ide;
            const numero = ide.nNF;
            const serie = ide.serie;

            // Produtos (tag det)
            let det = infNFe.det;
            if (!det) {
                det = [];
            } else if (!Array.isArray(det)) {
                det = [det];
            }
            
            const itens = det.map(d => ({
                prod: d.prod ? d.prod.xProd : 'PRODUTO NÃO IDENTIFICADO',
                ncm: d.prod ? d.prod.NCM : '',
                cfop: d.prod ? d.prod.CFOP : '',
                uCom: d.prod ? d.prod.uCom : '',
                qCom: d.prod ? d.prod.qCom : 0,
                vUnCom: d.prod ? d.prod.vUnCom : 0,
                vProd: d.prod ? d.prod.vProd : 0
            }));

            await pool.query(
                `UPDATE mde_cache SET 
                    numero_nfe = $1, 
                    serie = $2, 
                    itens_json = $3 
                WHERE chave_nfe = $4`,
                [numero, serie, JSON.stringify(itens), chaveNfe]
            );
            
            logger.info(`Dados extraídos do XML ${chaveNfe}: NF ${numero} Série ${serie} (${itens.length} itens)`);
        } catch (error) {
            logger.error(`Erro ao parsear XML ${chaveNfe}: ${error.message}`);
        }
    }

    /**
     * Salva o XML em uma estrutura de pastas no disco.
     */
    async saveXmlToDisk(idEmpresa, chaveNfe, xmlContent) {
        try {
            const resEmp = await pool.query('SELECT cnpj FROM empresas WHERE id = $1', [idEmpresa]);
            const cnpj = resEmp.rows[0]?.cnpj.replace(/\D/g, '') || 'desconhecido';
            
            // Pasta base: uploads/xmls/CNPJ/ANO-MES/
            // Extrai ano e mês da chave (posições 3 a 6: AAMM)
            const aa = chaveNfe.substring(2, 4);
            const mm = chaveNfe.substring(4, 6);
            const pastaPeriodo = `20${aa}-${mm}`;
            
            const dir = path.join(__dirname, '..', 'uploads', 'xmls', cnpj, pastaPeriodo);
            
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            const filePath = path.join(dir, `${chaveNfe}.xml`);
            fs.writeFileSync(filePath, xmlContent);
            
            logger.info(`XML salvo em disco: ${filePath}`);
        } catch (error) {
            logger.error(`Erro ao salvar XML no disco ${chaveNfe}: ${error.message}`);
        }
    }

    /**
     * Importação em lote por chaves de acesso.
     */
    async importarChavesLote(idEmpresa, chavesInput) {
        // Busca o CNPJ da empresa
        const resEmp = await pool.query('SELECT cnpj FROM empresas WHERE id = $1', [idEmpresa]);
        if (resEmp.rows.length === 0) throw new Error('Empresa não encontrada.');
        const cnpj = resEmp.rows[0].cnpj.replace(/\D/g, '');

        // Limpa e separa as chaves
        const chaves = chavesInput
            .split(/[,\s]+/)
            .map(c => c.trim())
            .filter(c => c.length === 44);
            
        if (chaves.length === 0) {
            throw new Error('Nenhuma chave de acesso válida (44 caracteres) encontrada.');
        }

        const resultados = [];
        
        for (const chave of chaves) {
            try {
                // 1. Garante que o registro existe no mde_cache (Placeholder)
                await pool.query(`
                    INSERT INTO mde_cache (id_empresa, chave_nfe, nsu, status_manifesto)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (chave_nfe) DO NOTHING
                `, [idEmpresa, chave, '0', 'Ciência da Operação']);

                // 2. Ciência da Operação (obrigatória para liberar XML)
                try {
                    await this.manifestar(chave, 'ciencia', cnpj);
                } catch (manifestError) {
                    logger.warn(`Aviso no manifesto da chave ${chave}: ${manifestError.message}`);
                    // Prossegue mesmo se o manifesto der erro (pode já estar manifestada)
                }
                
                // 3. Tenta baixar o XML
                let baixou = false;
                try {
                    // Pequeno delay para dar tempo ao Sefaz processar o manifesto
                    await new Promise(r => setTimeout(r, 1000));
                    await this.downloadXml(idEmpresa, chave);
                    baixou = true;
                } catch (e) {
                    logger.warn(`XML da chave ${chave} ainda não disponível para download imediato: ${e.message}`);
                }
                
                resultados.push({
                    chave,
                    status: 'Processada',
                    xml_baixado: baixou
                });
                
                // Delay entre chaves para respeitar cota
                await new Promise(r => setTimeout(r, 500));
            } catch (error) {
                resultados.push({
                    chave,
                    status: 'Erro',
                    mensagem: error.message
                });
            }
        }
        
        return {
            processadas: chaves.length,
            detalhes: resultados
        };
    }

    /**
     * Obtém o PDF (DANFE/DACTE) em Base64.
     */
    async downloadPdf(chaveNfe) {
        try {
            const response = await axios.get(`${this.baseUrl}/consulta/chave/pdf`, {
                headers: this.getHeaders(),
                params: { chaveAcesso: chaveNfe }
            });
            return response.data.pdf; // Retorna a string Base64 do PDF
        } catch (error) {
            logger.error(`Erro ao baixar PDF ${chaveNfe}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Realiza a manifestação do destinatário.
     */
    async manifestar(chaveNfe, tipoManifesto, cnpjCpf) {
        // Mapeamento de tipos amigáveis para códigos EspiãoNFe
        const mapaTipos = {
            'ciencia': '210210',
            'confirmacao': '210200',
            'desconhecimento': '210220',
            'nao_realizada': '210240'
        };

        const codigoManifesto = mapaTipos[tipoManifesto] || tipoManifesto;

        try {
            logger.info(`Realizando manifestação ${codigoManifesto} para nota ${chaveNfe} (CNPJ: ${cnpjCpf}) via EspiãoNFe`);
            
            const chaveLimpa = String(chaveNfe).replace(/\D/g, '');
            const cnpjLimpo = String(cnpjCpf).replace(/\D/g, '');

            if (chaveLimpa.length !== 44) {
                throw new Error(`A chave de acesso deve conter exatamente 44 dígitos. A chave informada possui ${chaveLimpa.length} dígitos.`);
            }

            const params = new URLSearchParams();
            params.append('cnpjCpf', cnpjLimpo);
            params.append('chaveAcesso', chaveLimpa);
            params.append('codigoManifestacao', codigoManifesto);

            const response = await axios.post(`${this.baseUrl}/manifestacao/nfe/manifestar`, params, { 
                headers: {
                    ...this.getHeaders(),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return response.data;
        } catch (error) {
            const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
            logger.error(`Erro ao manifestar nota ${chaveNfe} no EspiãoNFe: ${errorData}`);
            throw new Error(`Falha no manifesto: ${errorData}`);
        }
    }

    /**
     * Busca as notas armazenadas no cache local (mde_cache).
     */
    async getNotas(idEmpresa, params = {}) {
        const { status, query, limit = 100, offset = 0 } = params;
        let sql = `SELECT * FROM mde_cache WHERE id_empresa = $1`;
        const values = [idEmpresa];

        if (status && status !== 'todos') {
            sql += ` AND status_manifesto = $${values.length + 1}`;
            values.push(status);
        }

        if (query) {
            sql += ` AND (chave_nfe ILIKE $${values.length + 1} OR nome_emissor ILIKE $${values.length + 1})`;
            values.push(`%${query}%`);
        }

        sql += ` ORDER BY data_emissao DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
        values.push(limit, offset);

        const res = await pool.query(sql, values);
        return res.rows;
    }

    /**
     * Compara chaves vindo do Sped com o cache local.
     */
    async conferirFaltantes(idEmpresa, chavesSped) {
        const query = 'SELECT chave_nfe, xml_content IS NOT NULL as tem_xml FROM mde_cache WHERE id_empresa = $1 AND chave_nfe = ANY($2)';
        const res = await pool.query(query, [idEmpresa, chavesSped]);
        
        const encontradas = res.rows.map(r => r.chave_nfe);
        const comXml = res.rows.filter(r => r.tem_xml).map(r => r.chave_nfe);
        
        const faltantesBanco = chavesSped.filter(c => !encontradas.includes(c));
        const faltantesXml = encontradas.filter(c => !comXml.includes(c));
        
        return {
            total_arquivo: chavesSped.length,
            encontradas: encontradas.length - faltantesXml.length, // Apenas as que já têm XML
            faltantes: faltantesBanco.length + faltantesXml.length,
            todas_faltantes: [...faltantesBanco, ...faltantesXml]
        };
    }

    /**
     * Gera um ZIP com os XMLs solicitados.
     */
    async downloadBatchZip(idEmpresa, chaves, responseStream) {
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.on('error', (err) => {
            logger.error(`Erro ao gerar ZIP: ${err.message}`);
        });

        archive.pipe(responseStream);
        
        // Busca do banco o que já temos
        const query = 'SELECT chave_nfe, xml_content, status_manifesto FROM mde_cache WHERE id_empresa = $1 AND chave_nfe = ANY($2)';
        const dbRes = await pool.query(query, [idEmpresa, chaves]);
        
        const cacheMap = {};
        dbRes.rows.forEach(r => { cacheMap[r.chave_nfe] = r; });

        let totalArquivados = 0;

        for (const chave of chaves) {
            const registro = cacheMap[chave];
            let xml = registro?.xml_content;

            // Se não tem no banco, tenta baixar agora (On-the-fly)
            if (!xml) {
                try {
                    logger.info(`XML ausente no cache para ${chave}. Tentando download on-the-fly...`);
                    xml = await this.downloadXml(idEmpresa, chave);
                    // Delay para evitar estouro de cota (limit 3/s)
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (e) {
                    logger.warn(`Não foi possível obter XML para ${chave} durante o ZIP: ${e.message}`);
                }
            }

            if (xml) {
                archive.append(xml, { name: `${chave}.xml` });
                totalArquivados++;
            }
        }
        
        if (totalArquivados === 0) {
            archive.append('Nenhum XML disponível para as chaves solicitadas.\n\nMotivos possíveis:\n1. Notas de Entrada (Compra) exigem Manifesto (Ciência ou Confirmação) ANTES de liberar o XML completo.\n2. A nota pode ser muito recente e ainda não processada pela Sefaz.\n3. Erro de comunicação com o provedor EspiãoNFe.', { name: 'AVISO_IMPORTANTE.txt' });
        }
        
        await archive.finalize();
    }
}

module.exports = new EspiaoNfeService();

