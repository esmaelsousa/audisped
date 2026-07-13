> ⚠️ **SUPERSEDED (2026-07-11):** unificado em [`PLANO_SPED_AUTOMATICO_SEFAZ.md`](PLANO_SPED_AUTOMATICO_SEFAZ.md). Mantido só como histórico.

# Plano de Implementação: MD-e (Manifestação de Destinatário) com API EspiãoNFe v1-cloud

ESTE PLANO FOI ATUALIZADO COM BASE NA DOCUMENTAÇÃO SWAGGER V1-CLOUD DO ESPIÃO NFE.

> [!IMPORTANT]
> **Diferenciação MD-e vs MDF-e**: 
> A documentação fornecida foca em NF-e, CT-e e Manifestação (**MD-e**). O **MDF-e** (Manifesto Eletrônico de Documentos Fiscais - Mod 58) não consta nesta API. Este plano foca na Auditoria de Notas Faltantes (NF-e/CT-e) e na Ciência/Manifestação dos documentos destinados ao cliente.

## 1. Objetivo
Transformar o Audisped em uma central de inteligência fiscal capaz de:
1. Consultar na SEFAZ (via EspiãoNFe) todas as notas emitidas contra o CNPJ da empresa.
2. Cruzar com o SPED carregado para identificar notas faltantes.
3. Baixar os XMLs dessas notas (tratando compactação Gzip/Base64).
4. Realizar a Manifestação (Ciência da Operação / Confirmação).
5. Injetar as notas faltantes no arquivo SPED.

## 2. Detalhes Técnicos da API (EspiãoNFe v1-cloud)
- **Base URL**: `https://api.espiaonfe.com.br`
- **Autenticação (Headers)**:
  - `esp-cloud-token`: Token da conta.
  - `user-token`: Token do usuário.
- **Formato do XML**: Recebido como String em Base64 e compactado em Gzip (requer buffer/zlib no backend).

## 3. Checklist de Implementação

### [x] Fase 1: Análise e Diagnóstico
- [x] Avaliar endpoints do Swagger v1-cloud.
- [x] Identificar necessidade de descompactação Gzip.
- [x] Mapear campos de retorno da NF-e (Chave, Emitente, Valor, Situação, Manifestação).

### [ ] Fase 2: Backend - Evolução do `espiaoNfeService.js`
- [ ] **Ajustar Endpoints**: Mudar para o padrão `/v1-cloud/...` conforme documentação.
- [ ] **Tratamento de XML**: Implementar função para decodificar Base64 e descompactar Gzip antes de salvar no banco ou injetar no SPED.
- [ ] **Paginação**: Implementar loop caso `codigoProximaPagina` venha preenchido na consulta por período.
- [ ] **Download de PDF**: Adicionar suporte ao endpoint `/v1-cloud/consulta/chave/pdf` para exibir o DANFE/DACTE no frontend.

### [ ] Fase 3: Auditoria e Cruzamento (Matching)
- [ ] Criar lógica que compara o campo `possuiXml` do retorno da API com o que foi encontrado no arquivo SPED txt.
- [ ] Diferenciar notas de "Entrada" e "Saída" (Campo `tipoOperacao`).

### [ ] Fase 4: Manifestação de Notas
- [ ] Criar endpoint `POST /api/espiao/manifestar`.
- [ ] Integrar com o endpoint `/v1-cloud/manifestacao/nfe/manifestar`.
- [ ] Permitir manifestação em lote (Ciência da Operação automática antes do download do XML completo).

### [ ] Fase 5: UI (Vue.js)
- [ ] Atualizar `MdeView.vue` para exibir o status real de manifestação vindo da API.
- [ ] Adicionar botão para "Baixar PDF" direto da API.
- [ ] Indicador visual de notas que "Existem na SEFAZ mas não estão no SPED".

## 4. Endpoints Chave a Utilizar
| Recurso | Método | Endpoint | Finalidade |
| :--- | :--- | :--- | :--- |
| **Resumo NF-e** | GET | `/v1-cloud/consulta/periodo/nfe-resumo` | Lista notas destino no mês. |
| **XML por Chave** | GET | `/v1-cloud/consulta/chave/xml` | Baixa o XML (Gzip/Base64). |
| **PDF por Chave** | GET | `/v1-cloud/consulta/chave/pdf` | Baixa o PDF do documento. |
| **Manifestação** | POST | `/v1-cloud/manifestacao/nfe/manifestar` | Realiza a Ciência/Confirmação. |
| **Resgate XML** | POST | `/v1-cloud/resgatexml/chaves-acesso` | Força a recuperação de notas antigas. |

---

## 5. Próximos Passos Imediatos
1. Configurar o `zlib` no Node.js para processar os XMLs da API.
2. Testar o endpoint de manifesto com uma nota de teste em ambiente de produção (Ciência da Operação).
3. Criar o frontend de "Cruzamento Inteligente" (Matching SPED vs API).
