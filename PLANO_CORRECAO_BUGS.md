# Plano de Correção de Bugs — Audisped
> Baseado no Relatório de Testes (2026-03-28) | 6 bugs identificados

---

## Visão Geral

| Bug | Severidade | Módulo Afetado | Arquivo |
|---|---|---|---|
| #1 | 🟠 Alto | Análise SPED | `backend/server.js` |
| #2 | 🟠 Alto | Dashboard (frontend) | `frontend/src/views/` |
| #3 | 🟠 Alto | Explorador (frontend) | `frontend/src/views/ExploradorView.vue` |
| #4 | 🟡 Médio | Exportação SPED | `backend/server.js` |
| #5 | 🟡 Médio | MD-e Sync | `backend/server.js` |
| #6 | 🔴 Crítico | XML Injector | `frontend/src/views/` + `backend/server.js` |

---

## BUG #6 — CRÍTICO: Typo na rota XML Injector

### Como está ANTES
O frontend chama `/api/xml-injetor` (português, sem "c"), mas o backend registrou todas as rotas como `/api/xml-injector` (inglês, com "c"):
```
Frontend chama:   POST /api/xml-injetor/parse          → 404 Not Found
Frontend chama:   POST /api/xml-injetor/analyze-items  → 404 Not Found
Frontend chama:   POST /api/xml-injetor/standalone     → 404 Not Found

Backend tem:      POST /api/xml-injector/parse          ← nunca alcançado
Backend tem:      POST /api/xml-injector/analyze-items  ← nunca alcançado
Backend tem:      POST /api/xml-injector/standalone     ← nunca alcançado
```
**Impacto:** O módulo inteiro de injeção de NF-e em SPED está inacessível pelo frontend.

### Como ficará DEPOIS
Todas as chamadas do frontend usarão `/api/xml-injector` (com "c"), alinhado com o backend:
```
Frontend chama:   POST /api/xml-injector/parse          → 200 OK
Frontend chama:   POST /api/xml-injector/analyze-items  → 200 OK
Frontend chama:   POST /api/xml-injector/standalone     → 200 OK
```

### O que mudará
- **Arquivo:** Localizar todas as views do frontend que fazem chamadas axios para `/xml-injetor`
- **Ação:** Substituir globalmente `xml-injetor` → `xml-injector` nos arquivos `.vue` e `.js` do frontend
- **Verificação:** Nenhuma alteração no backend necessária (já está correto)

### Passos de implementação
1. Buscar no frontend: `grep -r "xml-injetor" frontend/src/`
2. Substituir em cada arquivo encontrado: `/api/xml-injetor` → `/api/xml-injector`
3. Rebuild do frontend: `npm run build`
4. Testar: `POST /api/xml-injector/parse` com um XML de NF-e real

---

## BUG #1 — ALTO: Análise retorna sucesso para arquivo inexistente

### Como está ANTES
`POST /api/analisar/99999` (ID que não existe no banco) retorna:
```json
{ "message": "Análise concluída com sucesso." }
```
O backend inicia o processo de análise sem verificar se o `id` existe na tabela `sped_arquivos`. Qualquer ID numérico é aceito silenciosamente — a análise roda "em vazio" e reporta sucesso.

**Impacto:** Frontend exibe "sucesso" ao usuário quando na verdade nada foi analisado. Dados podem ficar inconsistentes.

### Como ficará DEPOIS
`POST /api/analisar/99999` retornará:
```json
{ "message": "Arquivo não encontrado." }
```
com status HTTP **404**.

### O que mudará
- **Arquivo:** `backend/server.js` — rota `app.post('/api/analisar/:id', ...)`
- **Ação:** Adicionar query de verificação no início do handler, antes de qualquer processamento:
```js
// ANTES da lógica de análise, inserir:
const arquivoId = parseInt(req.params.id);
const check = await pool.query('SELECT id FROM sped_arquivos WHERE id = $1', [arquivoId]);
if (check.rows.length === 0) {
    return res.status(404).json({ message: 'Arquivo não encontrado.' });
}
```

### Passos de implementação
1. Localizar a rota `app.post('/api/analisar/:id'` no `server.js` (~linha 1878)
2. Adicionar verificação de existência antes do bloco principal
3. Testar: `POST /api/analisar/99999` deve retornar 404
4. Testar: `POST /api/analisar/673` deve continuar funcionando normalmente

---

## BUG #2 — ALTO: Rotas `/api/dashboard/*` não existem

### Como está ANTES
O frontend chama rotas de dashboard que não existem no backend:
```
GET /api/dashboard/resumo?id_empresa=1  → 404 HTML "Cannot GET /api/dashboard/resumo"
GET /api/dashboard/mensal?id_empresa=1  → 404 HTML "Cannot GET /api/dashboard/mensal"
```
As rotas reais no backend são:
```
GET /api/resumo/:id_arquivo             ← retorna totais + breakdown CFOP
GET /api/estoque-resumo/:id_arquivo     ← retorna estoques com anomalias
GET /api/resumo/participante/:id_arquivo ← retorna compras por fornecedor
```
**Impacto:** A tela de Dashboard provavelmente renderiza vazia ou com erro de carregamento.

### Como ficará DEPOIS
O frontend chamará as rotas corretas usando um arquivo de arquivo selecionado:
```
GET /api/resumo/:id_arquivo             → dados financeiros
GET /api/estoque-resumo/:id_arquivo     → estoques
GET /api/resumo/participante/:id_arquivo → fornecedores
```

### O que mudará
- **Opção A (recomendada):** Corrigir as chamadas axios no frontend para usar as rotas reais
  - Localizar a view de Dashboard em `frontend/src/views/`
  - Substituir `/api/dashboard/resumo` → `/api/resumo/:id`
  - Substituir `/api/dashboard/mensal` → montar com dados de `/api/resumo/:id`
- **Opção B (alternativa):** Criar aliases no backend apontando para as rotas existentes
  - Adicionar em `server.js`: `app.get('/api/dashboard/resumo', ...)` que internamente chama a lógica de `/api/resumo/:id`

### Passos de implementação
1. Abrir a view de Dashboard: `frontend/src/views/DashboardView.vue` (ou equivalente)
2. Mapear cada chamada axios para a rota correta
3. Ajustar o parâmetro: dashboard usa `id_empresa`, mas `/api/resumo` usa `id_arquivo` — verificar se precisa buscar o último arquivo da empresa primeiro via `/api/arquivos/empresa/:id_empresa`
4. Testar a tela de Dashboard com dados reais

---

## BUG #3 — ALTO: Rotas `/api/explorador/*` não existem

### Como está ANTES
`ExploradorView.vue` chama rotas que não existem:
```
GET /api/explorador/documentos/1     → 404 "Cannot GET /api/explorador/documentos/1"
GET /api/explorador/participantes/1  → 404 "Cannot GET /api/explorador/participantes/1"
GET /api/explorador/produtos/1       → 404 "Cannot GET /api/explorador/produtos/1"
```
As rotas reais no backend são:
```
GET /api/documentos/entradas/:id_arquivo
GET /api/documentos/saidas/:id_arquivo
GET /api/documentos/auditoria/nf/:id_arquivo
```
**Impacto:** O módulo Explorador de Documentos não carrega dados — tela em branco ou erro.

### Como ficará DEPOIS
`ExploradorView.vue` chamará diretamente as rotas `/api/documentos/*`:
```
GET /api/documentos/entradas/:id     → ✅ retorna NFs de entrada com itens
GET /api/documentos/saidas/:id       → ✅ retorna NFs de saída com itens
GET /api/documentos/auditoria/nf/:id → ✅ retorna auditoria completa
```

### O que mudará
- **Arquivo:** `frontend/src/views/ExploradorView.vue`
- **Ação:** Substituir todas as chamadas axios de `/api/explorador/*` para `/api/documentos/*`
  ```js
  // ANTES:
  axios.get(`/api/explorador/documentos/${id}`)
  // DEPOIS:
  axios.get(`/api/documentos/entradas/${id}`)
  ```
- Mapear participantes: verificar se existe `/api/resumo/participante/:id` (testado e funcional)
- Mapear produtos: verificar `/api/relatorio/rentabilidade/:id` (testado e funcional)

### Passos de implementação
1. Abrir `frontend/src/views/ExploradorView.vue`
2. Listar todas as chamadas axios
3. Mapear cada uma para a rota correta do backend
4. Ajustar o tratamento de resposta se a estrutura do JSON for diferente
5. Testar com `id_arquivo = 673`

---

## BUG #4 — MÉDIO: Rota de exportação `/api/exportar/:id` não existe

### Como está ANTES
```
GET /api/exportar/1  → 404 Not Found
```
Não existe rota de exportação/download do arquivo SPED processado no backend.

### Como ficará DEPOIS
```
GET /api/exportar/:id  → 200 OK  (download do arquivo .txt SPED)
```

### O que mudará
- **Arquivo:** `backend/server.js`
- **Ação:** Adicionar nova rota que busca o `caminho_arquivo` da tabela `sped_arquivos` e envia o arquivo:
```js
app.get('/api/exportar/:id', authMiddleware, async (req, res) => {
    const dbClient = await pool.connect();
    try {
        const result = await dbClient.query(
            'SELECT caminho_arquivo, nome_arquivo FROM sped_arquivos WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Arquivo não encontrado.' });
        const { caminho_arquivo, nome_arquivo } = result.rows[0];
        res.download(caminho_arquivo, nome_arquivo);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao exportar arquivo.' });
    } finally {
        dbClient.release();
    }
});
```

### Passos de implementação
1. Adicionar a rota no `server.js`
2. Verificar se `caminho_arquivo` é um path absoluto válido no servidor
3. Testar: `GET /api/exportar/673` deve retornar download do arquivo

---

## BUG #5 — MÉDIO: MD-e Sync retorna HTTP 500 sem certificado

### Como está ANTES
Quando uma empresa não tem certificado A1 configurado:
```
GET /api/mde/sync/1  → HTTP 500 Internal Server Error
```
O erro ocorre porque `mdeService.syncNotas()` tenta acessar o certificado e lança uma exceção não tratada. O catch do express retorna 500 com `err.message` exposto.

### Como ficará DEPOIS
```
GET /api/mde/sync/1  → HTTP 400 Bad Request
{ "message": "Empresa sem certificado A1 configurado. Acesse Configurações > Certificado." }
```

### O que mudará
- **Arquivo:** `backend/server.js` — rota `app.get('/api/mde/sync/:id_empresa', ...)`
- **Ação:** Adicionar verificação de certificado antes de chamar o serviço:
```js
app.get('/api/mde/sync/:id_empresa', authMiddleware, async (req, res) => {
    try {
        // Verificar certificado antes de sincronizar
        const status = await mdeService.getStatusCertificado(req.params.id_empresa);
        if (!status || !status.configurado) {
            return res.status(400).json({
                message: 'Empresa sem certificado A1 configurado. Acesse Configurações > Certificado.'
            });
        }
        const result = await mdeService.syncNotas(req.params.id_empresa);
        res.json(result);
    } catch (err) {
        logger.error(`[MDE] Erro no sync: ${err.message}`);
        res.status(500).json({ message: 'Erro ao sincronizar notas.' }); // sem err.message
    }
});
```

### Passos de implementação
1. Localizar a rota `app.get('/api/mde/sync/:id_empresa'` (~linha 229 do server.js)
2. Adicionar verificação de certificado configurado
3. Testar: empresa sem certificado deve retornar 400 com mensagem amigável
4. Testar: empresa com certificado deve continuar sincronizando normalmente

---

## Ordem de Execução Recomendada

| Ordem | Bug | Motivo |
|---|---|---|
| 1º | **Bug #6** | Crítico — módulo inteiro inacessível, correção simples (typo) |
| 2º | **Bug #3** | Alto — ExploradorView em branco, correção direta de URLs |
| 3º | **Bug #2** | Alto — Dashboard em branco, requer mapeamento de rotas |
| 4º | **Bug #1** | Alto — bug silencioso no analisar, 3 linhas de código |
| 5º | **Bug #5** | Médio — UX ruim no MDE, fácil de corrigir |
| 6º | **Bug #4** | Médio — funcionalidade nova (exportar) |

---

## Critérios de Aceite (Definition of Done)

- [ ] Bug #6: `POST /api/xml-injector/parse` retorna 200 pelo frontend
- [ ] Bug #3: ExploradorView carrega documentos de entrada e saída
- [ ] Bug #2: Dashboard exibe dados financeiros e estoques
- [ ] Bug #1: `POST /api/analisar/99999` retorna 404
- [ ] Bug #5: `GET /api/mde/sync/1` (sem cert.) retorna 400 com mensagem
- [ ] Bug #4: `GET /api/exportar/673` faz download do arquivo SPED
