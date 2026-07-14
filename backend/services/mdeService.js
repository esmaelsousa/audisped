const axios = require('axios');
const { Pool } = require('pg');
const crypto = require('crypto');
const logger = require('../logger');
const espiaoNfeService = require('./espiaoNfeService');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});

const ENCRYPTION_KEY = process.env.CERT_ENCRYPTION_KEY || 'audisped-master-key-security-2026-sefaz';

// Auto-migração idempotente das colunas do certificado (setup_db.js não roda no boot do servidor).
// Garante que o INSERT do saveCertificado tenha cnpj_cert/titular/data_validade. Memoizado.
let _certColsEnsured = false;
async function ensureCertColumns() {
    if (_certColsEnsured) return;
    await pool.query(`ALTER TABLE empresa_certificados ADD COLUMN IF NOT EXISTS data_validade TIMESTAMP;`);
    await pool.query(`ALTER TABLE empresa_certificados ADD COLUMN IF NOT EXISTS cnpj_cert TEXT;`);
    await pool.query(`ALTER TABLE empresa_certificados ADD COLUMN IF NOT EXISTS titular TEXT;`);
    _certColsEnsured = true;
}

class MdeService {
    decrypt(text) {
        try {
            const [ivHex, encryptedText] = text.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const encryptedBuffer = Buffer.from(encryptedText, 'hex');
            const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            let decrypted = decipher.update(encryptedBuffer);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString();
        } catch (err) {
            console.error('Erro ao descriptografar senha do certificado:', err);
            return null;
        }
    }

    async getCertificado(idEmpresa) {
        const res = await pool.query('SELECT * FROM empresa_certificados WHERE id_empresa = $1', [idEmpresa]);
        if (res.rows.length === 0) return null;
        
        const cert = res.rows[0];
        return {
            pfx: cert.pfx_base64,
            password: this.decrypt(cert.senha_encriptada),
            ultimoNsu: cert.ultimo_nsu_consultado || '0'
        };
    }

    async syncNotas(idEmpresa, dataInicio = null, dataFim = null) {
        try {
            // Usa o período informado (datas da tela); se ausente, cai nos últimos 30 dias.
            const hoje = new Date().toISOString().split('T')[0];
            const ini = dataInicio || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const fim = dataFim || hoje;

            logger.info(`Delegando syncNotas para EspiãoNFeService (Empresa: ${idEmpresa}, ${ini} a ${fim})`);
            const result = await espiaoNfeService.syncNotas(idEmpresa, ini, fim);
            
            return {
                mensagem: result.message,
                notasNovas: result.count
            };
        } catch (error) {
            logger.error(`Erro na sincronização via Espião: ${error.message}`);
            throw error;
        }
    }

    async manifestar(idEmpresa, chaveNfe, tipoEvento = 'ciencia') {
        try {
            logger.info(`Delegando manifestação ${tipoEvento} para EspiãoNFeService (Nota: ${chaveNfe})`);
            
            // Busca o CNPJ da empresa
            const resEmp = await pool.query('SELECT cnpj FROM empresas WHERE id = $1', [idEmpresa]);
            if (resEmp.rows.length === 0) throw new Error('Empresa não encontrada.');
            const cnpjCpf = resEmp.rows[0].cnpj.replace(/\D/g, '');

            // O Espião utiliza nomes de eventos diferentes em seu mapeamento interno,
            // mas o mdeService já recebia 'ciencia', 'confirmacao', etc.
            const result = await espiaoNfeService.manifestar(chaveNfe, tipoEvento, cnpjCpf);
            
            const statusMap = {
                'ciencia': 'Ciência da Operação',
                'confirmacao': 'Confirmação da Operação',
                'desconhecimento': 'Desconhecimento da Operação',
                'nao_realizada': 'Operação não Realizada'
            };

            // Atualiza o cache local para refletir a manifestação
            await pool.query(`
                UPDATE mde_cache SET status_manifesto = $1 
                WHERE chave_nfe = $2
            `, [statusMap[tipoEvento] || tipoEvento, chaveNfe]);

            // Se for Ciência ou Confirmação, tenta baixar o XML automaticamente para exibir produtos
            if (tipoEvento === 'ciencia' || tipoEvento === 'confirmacao') {
                try {
                    await espiaoNfeService.downloadXml(idEmpresa, chaveNfe);
                } catch (xmlError) {
                    logger.warn(`Manifesto OK, mas erro ao baixar XML: ${xmlError.message}`);
                }
            }

            return {
                success: true,
                mensagem: `Manifesto ${statusMap[tipoEvento] || tipoEvento} registrado com sucesso via Espião.`,
                data: result
            };
        } catch (error) {
            const errorMsg = error.message.toLowerCase();
            // CStat 573 = Duplicidade de evento
            if (errorMsg.includes('573') || errorMsg.includes('duplicidade de evento')) {
                const statusMap = {
                    'ciencia': 'Ciência da Operação',
                    'confirmacao': 'Confirmação da Operação',
                    'desconhecimento': 'Desconhecimento da Operação',
                    'nao_realizada': 'Operação não Realizada'
                };
                
                logger.info(`Nota ${chaveNfe} já possuía o evento na SEFAZ (Duplicidade). Atualizando cache local para ${tipoEvento}.`);
                await pool.query(`
                    UPDATE mde_cache SET status_manifesto = $1 
                    WHERE chave_nfe = $2
                `, [statusMap[tipoEvento] || tipoEvento, chaveNfe]);

                return {
                    success: true,
                    mensagem: `O manifesto já constava na SEFAZ. Status atualizado para ${statusMap[tipoEvento] || tipoEvento}.`,
                    data: { cStat: 573, xMotivo: 'Rejeicao: Duplicidade de evento' }
                };
            }

            if (errorMsg.includes('chave de acesso não encontrada')) {
                throw new Error("A Sefaz/EspiãoNFe não localizou esta nota como destinada a este CNPJ. Notas de saída (emitidas por você) ou chaves não sincronizadas não podem ser manifestadas.");
            }

            logger.error(`Erro ao manifestar via Espião: ${error.message}`);
            throw error;
        }
    }

    async getNotas(idEmpresa, params = {}) {
        // Agora delega para o EspiaoNfeService, que já busca do mde_cache compartilhado
        return await espiaoNfeService.getNotas(idEmpresa, params);
    }

    async getXml(chaveNfe) {
        const res = await pool.query('SELECT xml_content FROM mde_cache WHERE chave_nfe = $1', [chaveNfe]);
        if (res.rows.length === 0) return null;
        return res.rows[0].xml_content;
    }

    async importarChave(idEmpresa, chaveNfe) {
        try {
            logger.info(`Iniciando importação por chave via Espião: ${chaveNfe}`);
            const result = await espiaoNfeService.importarChavesLote(idEmpresa, chaveNfe);
            
            return {
                success: true,
                mensagem: "Importação por chave iniciada via Espião NF-e. O XML será processado em breve.",
                chave: chaveNfe,
                detalhes: result.detalhes
            };
        } catch (error) {
            logger.error(`Erro ao importar por chave via Espião: ${error.message}`);
            throw new Error(`Erro ao importar nota via Espião: ${error.message}`);
        }
    }

    // Lê o certificado e compara com o CNPJ da empresa. NÃO persiste e NÃO lança por regra de negócio
    // (só lança .code='CERT_PARSE' p/ senha/arquivo inválidos). Usado no preview e dentro do save.
    async analisarCertificado(idEmpresa, pfxBase64, senha) {
        const certInfo = require('./certInfo');
        const info = certInfo.lerCertificado(pfxBase64, senha);
        const val = certInfo.avaliarValidade(info.validadeFim);
        const resEmp = await pool.query('SELECT cnpj FROM empresas WHERE id = $1', [idEmpresa]);
        const cnpjEmpresa = String(resEmp.rows[0]?.cnpj || '').replace(/\D/g, '');
        return {
            titular: info.titular,
            cnpjCert: info.cnpj,
            cnpjEmpresa,
            semCnpj: !info.cnpj,
            confere: !!info.cnpj && info.cnpj === cnpjEmpresa,
            validadeInicio: info.validadeInicio,
            validadeFim: info.validadeFim,
            diasParaVencer: val.diasParaVencer,
            vencido: val.vencido,
            perto: val.perto,
        };
    }

    async saveCertificado(idEmpresa, pfxBase64, password, ultimoNsu = '0', periodicidade = 0) {
        const fmt = (c) => c ? String(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '—';
        try {
            await ensureCertColumns(); // auto-migra colunas se faltarem (self-healing)
            const rel = await this.analisarCertificado(idEmpresa, pfxBase64, password);
            // Regras (decididas): bloqueia CNPJ divergente e certificado vencido; avisa se perto de vencer.
            if (rel.semCnpj) { const e = new Error('O certificado não contém CNPJ (parece ser um e-CPF). Envie o e-CNPJ da empresa.'); e.status = 422; e.code = 'SEM_CNPJ'; throw e; }
            if (!rel.confere) { const e = new Error(`Este certificado é do CNPJ ${fmt(rel.cnpjCert)}, mas a empresa selecionada é ${fmt(rel.cnpjEmpresa)}. Selecione a empresa/certificado correto.`); e.status = 422; e.code = 'CNPJ_DIVERGENTE'; throw e; }
            if (rel.vencido) { const e = new Error(`Certificado VENCIDO em ${rel.validadeFim.toLocaleDateString('pt-BR')}. Renove o A1 antes de cadastrar.`); e.status = 422; e.code = 'VENCIDO'; throw e; }

            const iv = crypto.randomBytes(16);
            const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            let encrypted = cipher.update(password);
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const senhaEncriptada = iv.toString('hex') + ':' + encrypted.toString('hex');

            await pool.query(`
                INSERT INTO empresa_certificados (id_empresa, pfx_base64, senha_encriptada, data_validade, cnpj_cert, titular, ultimo_nsu_consultado, periodicidade_sincronizacao)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id_empresa) DO UPDATE SET
                    pfx_base64 = EXCLUDED.pfx_base64,
                    senha_encriptada = EXCLUDED.senha_encriptada,
                    data_validade = EXCLUDED.data_validade,
                    cnpj_cert = EXCLUDED.cnpj_cert,
                    titular = EXCLUDED.titular,
                    ultimo_nsu_consultado = EXCLUDED.ultimo_nsu_consultado,
                    periodicidade_sincronizacao = EXCLUDED.periodicidade_sincronizacao
            `, [idEmpresa, pfxBase64, senhaEncriptada, rel.validadeFim, rel.cnpjCert, rel.titular, ultimoNsu, periodicidade]);

            return {
                success: true,
                cnpj: rel.cnpjCert,
                titular: rel.titular,
                validade: rel.validadeFim,
                dias_para_vencer: rel.diasParaVencer,
                aviso: rel.perto ? `Atenção: o certificado vence em ${rel.diasParaVencer} dia(s) (${rel.validadeFim.toLocaleDateString('pt-BR')}).` : null,
                mensagem: `Certificado salvo. Válido até ${rel.validadeFim.toLocaleDateString('pt-BR')}.`
            };
        } catch (err) {
            if (err.status) throw err; // regra de negócio (422) ou já mapeado: preserva
            console.error('Erro detalhado ao processar certificado:', err.message);
            const e = new Error(err.code === 'CERT_PARSE' ? err.message : `Falha no certificado: ${err.message}`);
            e.status = 400; e.code = err.code || 'CERT_PARSE';
            throw e;
        }
    }

    async getStatusCertificado(idEmpresa) {
        const res = await pool.query('SELECT data_validade, ultimo_nsu_consultado, periodicidade_sincronizacao FROM empresa_certificados WHERE id_empresa = $1', [idEmpresa]);
        if (res.rows.length === 0) return { configurado: false };
        
        return {
            configurado: true,
            validade: res.rows[0].data_validade,
            ultimo_nsu: res.rows[0].ultimo_nsu_consultado || '0',
            periodicidade: res.rows[0].periodicidade_sincronizacao || 0
        };
    }
}

module.exports = new MdeService();
