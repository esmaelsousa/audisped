// capturaProvider.js — camada AGNÓSTICA de captura de XML de NF-e por chave.
// Objetivo: os loops (A: baixar faltante; B: re-injetar divergente) chamam SEMPRE esta interface,
// nunca um provedor direto. Assim trocar EspiãoNFe ↔ Danfe Rápida ↔ outro é configuração, não código.
//
// Interface do provider:
//   baixarXmlPorChave(chave, { idEmpresa }) -> { xml: string, origem: string }
//   manifestar(chave, tipo='ciencia', cnpjCpf)  (opcional; alguns não suportam)
//   suportaDescoberta: boolean   (se lista destinadas por CNPJ; Danfe Rápida = false)
//
// Seleção via env CAPTURA_PROVIDER ('espiao' | 'danfe_rapida'); default 'espiao'.

const axios = require('axios');
const espiaoNfeService = require('../espiaoNfeService');

// --- Provider EspiãoNFe: usa o serviço já integrado (download + manifestação + descoberta). ---
const espiaoProvider = {
    nome: 'espiao',
    suportaDescoberta: true,
    async baixarXmlPorChave(chave, { idEmpresa } = {}) {
        const xml = await espiaoNfeService.downloadXml(idEmpresa, chave);
        if (!xml || typeof xml !== 'string' || !xml.includes('infNFe')) {
            throw new Error(`EspiãoNFe não retornou XML completo para a chave ${chave}`);
        }
        return { xml, origem: 'espiao' };
    },
    async manifestar(chave, tipo = 'ciencia', cnpjCpf) {
        return espiaoNfeService.manifestar(chave, tipo, cnpjCpf);
    },
};

// --- Provider Danfe Rápida: FALLBACK de download por chave (só nota ≤3 meses; NÃO descobre destinadas). ---
// `client` injetável para teste. `apiKey` de env DANFE_RAPIDA_API_KEY.
function danfeRapidaProvider(apiKey = process.env.DANFE_RAPIDA_API_KEY, { client = axios } = {}) {
    const base = 'https://api.danferapida.com.br';
    return {
        nome: 'danfe_rapida',
        suportaDescoberta: false,
        async baixarXmlPorChave(chave) {
            if (!apiKey) throw new Error('DANFE_RAPIDA_API_KEY não configurada');
            const r = await client.get(`${base}/documents/b2b/search/${chave}`, {
                headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
                timeout: 30000,
            });
            const xml = r && r.data && r.data.xmlCode;
            if (!xml || typeof xml !== 'string' || !xml.includes('infNFe')) {
                throw new Error(`Danfe Rápida não retornou xmlCode completo para a chave ${chave}`);
            }
            return { xml, origem: 'danfe_rapida' };
        },
        async manifestar() {
            throw new Error('Danfe Rápida não realiza manifestação do destinatário (só download por chave).');
        },
    };
}

// Fábrica: resolve o provider por nome (default env CAPTURA_PROVIDER ou 'espiao').
function getProvider(nome, opts = {}) {
    const escolhido = nome || process.env.CAPTURA_PROVIDER || 'espiao';
    if (escolhido === 'danfe_rapida') return danfeRapidaProvider(opts.apiKey, opts);
    return espiaoProvider;
}

module.exports = { getProvider, espiaoProvider, danfeRapidaProvider };
