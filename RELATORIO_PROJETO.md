# Relatório de Análise do Projeto Audisped
> Gerado em: 2026-03-28

---

## 1. Estrutura de Pastas

```
audisped/
├── backend/
│   ├── server.js                  ← Servidor principal (monolítico, ~3.000+ linhas)
│   ├── server - Copia.js          ← RISCO: cópia ativa do servidor com código legado
│   ├── logger.js
│   ├── services/
│   │   ├── xmlInjectorService.js  ← Injeção de NF-e em SPED
│   │   ├── mdeService.js          ← Manifesto Destinatário (MD-e / SEFAZ)
│   │   └── sefazService.js        ← Comunicação com SEFAZ
│   ├── uploads/                   ← Arquivos enviados (centenas de hashes)
│   ├── uploads/xml_temp/          ← XMLs temporários
│   └── [~20 scripts de debug]     ← check_db*, test_*, debug_*, tmp_* (ver §4)
│
├── frontend/
│   ├── src/
│   │   ├── views/                 ← LmcView, ExploradorView, MdeView, ProfileView...
│   │   ├── router/
│   │   └── main.js
│   ├── dist/                      ← Build de produção
│   └── public/
│
├── venv_pdf/                      ← Ambiente Python (pdf parsing)
├── .env                           ← Variáveis de ambiente (backend)
├── package.json                   ← Root
└── [docs de planejamento .md/txt]
```

---

## 2. Dependências

### Backend (`backend/package.json`)
| Pacote | Versão | Uso |
|---|---|---|
| express | ^4.19.2 | Framework HTTP |
| pg | ^8.12.0 | PostgreSQL |
| jsonwebtoken | ^9.0.3 | Autenticação JWT |
| bcryptjs | ^3.0.3 | Hash de senhas |
| cors | ^2.8.5 | CORS |
| multer | ^1.4.5-lts.1 | Upload de arquivos |
| dotenv | ^17.2.2 | Variáveis de ambiente |
| fast-xml-parser | ^5.5.9 | Parse de NF-e/CT-e/XML |
| xml2js | ^0.6.2 | Parse XML (legado) |
| exceljs | ^4.4.0 | Geração de planilhas |
| pdfkit | ^0.17.2 | Geração de PDF |
| node-mde | ^0.14.13 | MD-e SEFAZ |
| node-forge | ^1.3.3 | Certificados digitais (A1) |
| pdf-parse | ^2.4.5 | Leitura de PDF |

### Frontend (`frontend/package.json`)
| Pacote | Versão | Uso |
|---|---|---|
| vue | ^3.5.0 | Framework UI |
| vue-router | ^4.5.1 | Roteamento SPA |
| axios | ^1.12.2 | Chamadas HTTP ao backend |
| apexcharts + vue3-apexcharts | ^5.6.0 | Gráficos (dashboard) |
| lucide-vue-next | ^0.575.0 | Ícones |
| tailwindcss | ^4.0.0 | CSS utilitário |
| vite | ^6.0.0 | Build tool |

---

## 3. Como o Frontend se Comunica com o Backend

### Arquitetura
```
[Vue 3 SPA] → axios → [Express REST API :15435] → [PostgreSQL]
                              ↓
                         [SEFAZ / node-mde]
```

### Mecanismo
- Frontend usa **axios** para todas as chamadas HTTP
- **Sem arquivo centralizado de configuração** (`baseURL` não encontrada em arquivo separado) — cada View provavelmente define o endpoint diretamente ou via variável de ambiente Vite
- Backend roda na porta **15435** (padrão via `process.env.PORT`)

### Autenticação JWT
1. Login via `POST /api/auth/login` → retorna token (expira em **12h**)
2. Frontend armazena o token (presumivelmente `localStorage`)
3. Todas as rotas protegidas exigem header: `Authorization: Bearer <token>`
4. O backend também aceita token via **query string** (`?token=...`) — ver §4

### Principais Grupos de Endpoints
| Prefixo | Função |
|---|---|
| `/api/auth/*` | Login, registro, perfil |
| `/api/upload` | Upload de arquivo SPED |
| `/api/analisar/:id` | Análise de SPED |
| `/api/cfops` | CRUD de CFOPs |
| `/api/mde/*` | MD-e / Manifesto SEFAZ |
| `/api/xml-injetor/*` | Injeção de NF-e em SPED |
| `/api/logs/stream` | SSE de logs em tempo real |
| `/api/lmc/*` | Livro de Movimentação de Combustíveis |
| `/api/dashboard/*` | Dados de dashboard |

---

## 4. Vulnerabilidades de Segurança

### CRÍTICO

#### 🔴 CORS Totalmente Aberto
```js
app.use(cors()); // Aceita qualquer origem
```
**Risco:** Qualquer domínio pode fazer requisições autenticadas ao backend.
**Correção:** Restringir para origens específicas:
```js
app.use(cors({ origin: ['http://localhost:5173', 'https://seu-dominio.com'] }));
```

#### 🔴 JWT_SECRET com Fallback Hardcoded
```js
const JWT_SECRET = process.env.JWT_SECRET || 'audisped-safira-token-secret-2025';
```
**Risco:** Se `.env` não estiver configurado, o segredo é público e previsível. Qualquer pessoa pode forjar tokens.
**Correção:** Remover o fallback — lançar erro se `JWT_SECRET` não estiver definido.

#### 🔴 Token JWT via Query String
```js
const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
```
**Risco:** Tokens em URLs ficam em logs de servidor, histórico do browser, e cabeçalhos de referer.
**Correção:** Remover `req.query.token`. Usar apenas `Authorization: Bearer`.

---

### ALTO

#### 🟠 Sem `helmet` (cabeçalhos HTTP de segurança ausentes)
O backend não usa `helmet`. Cabeçalhos como `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` estão ausentes.
**Correção:**
```bash
npm install helmet
```
```js
const helmet = require('helmet');
app.use(helmet());
```

#### 🟠 Sem Rate Limiting
Endpoints de login (`/api/auth/login`) e registro não têm proteção contra brute force.
**Correção:**
```bash
npm install express-rate-limit
```
```js
const rateLimit = require('express-rate-limit');
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
```

#### 🟠 `err.message` exposto nas respostas de erro
```js
res.status(500).json({ message: 'Erro no servidor.', error: err.message });
```
**Risco:** Stack traces e detalhes internos expostos ao cliente — facilita reconhecimento de vulnerabilidades.
**Correção:** Em produção, logar o erro internamente e retornar apenas uma mensagem genérica.

#### 🟠 Upload sem validação de tipo de arquivo
`multer` está configurado sem restrição de `fileFilter` ou `mimetype`. Qualquer arquivo pode ser enviado.
**Correção:** Adicionar filtro:
```js
fileFilter: (req, file, cb) => {
  if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt'))
    cb(null, true);
  else cb(new Error('Tipo inválido'), false);
}
```

---

### MÉDIO

#### 🟡 Arquivo `server - Copia.js` no repositório
Cópia do servidor com código legado. Pode conter credenciais, lógica desatualizada ou vulnerabilidades já corrigidas no servidor principal.
**Correção:** Remover do repositório e do servidor.

#### 🟡 ~20 scripts de debug no backend
Arquivos como `check_db_status.js`, `test_injection_complex.js`, `tmp_query_db.js`, `debug_*.js` estão na pasta do backend em produção.
**Risco:** Expõem estrutura interna do banco, podem ser executados acidentalmente.
**Correção:** Mover para pasta `dev-tools/` fora do deploy ou adicionar ao `.gitignore`.

#### 🟡 Sem validação de schema no `req.body`
Campos como `nome`, `email`, `senha`, `codigo`, `tipo` são usados diretamente sem validação de tipo/formato.
**Correção:** Usar `joi` ou `zod` para validar entradas.

---

### BAIXO

#### 🟢 SQL: queries parametrizadas — OK
As queries PostgreSQL usam `$1, $2...` parametrizados corretamente. **Não há SQL injection** detectada.

#### 🟢 Senhas com bcrypt — OK
`bcryptjs` é usado corretamente para hash e comparação de senhas.

#### 🟢 Arquivos `.env` não commitados — OK
O `.env` existe em `backend/.env` mas (aparentemente) não está no repositório git.

---

## 5. Resumo de Prioridades

| Prioridade | Item |
|---|---|
| 🔴 Crítico | CORS aberto, JWT_SECRET hardcoded, token em query string |
| 🟠 Alto | Sem helmet, sem rate limiting, erros expostos, upload sem filtro |
| 🟡 Médio | `server - Copia.js`, scripts de debug em produção, sem validação de schema |
