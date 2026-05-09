# Plano de Correção de Segurança — Audisped
> Baseado no Relatório de Vulnerabilidades (2026-03-28)

---

## Visão Geral

| Item | Severidade | Tipo | Arquivo |
|---|---|---|---|
| S1 — CORS Aberto | 🔴 Crítico | Configuração | `backend/server.js` |
| S2 — JWT_SECRET Hardcoded | 🔴 Crítico | Credencial exposta | `backend/server.js` |
| S3 — Token via Query String | 🔴 Crítico | Vazamento de token | `backend/server.js` |
| S4 — Sem Helmet | 🟠 Alto | Headers HTTP | `backend/server.js` + `package.json` |
| S5 — Sem Rate Limiting | 🟠 Alto | Brute Force | `backend/server.js` + `package.json` |
| S6 — err.message Exposto | 🟠 Alto | Info Disclosure | `backend/server.js` |
| S7 — Upload sem filtro | 🟠 Alto | File Upload | `backend/server.js` |
| S8 — server - Copia.js | 🟡 Médio | Arquivo legado | `backend/` |
| S9 — Scripts de debug | 🟡 Médio | Exposição de estrutura | `backend/` |
| S10 — Sem validação de schema | 🟡 Médio | Input Validation | `backend/server.js` |

---

## S1 — CORS Totalmente Aberto

### Como está ANTES
```js
// backend/server.js — linha ~34
app.use(cors());
```
Aceita requisições de **qualquer origem** (`*`). Um site malicioso pode fazer chamadas autenticadas à API se o usuário estiver logado (CSRF via CORS).

### Como ficará DEPOIS
```js
const allowedOrigins = [
    'http://localhost:5173',   // Dev frontend
    'http://localhost:4173',   // Preview frontend
    process.env.FRONTEND_URL   // Produção (ex: https://audisped.com.br)
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Origem não permitida pelo CORS'));
        }
    },
    credentials: true
}));
```

### O que mudará
- `app.use(cors())` → `app.use(cors({ origin: [...] }))` com lista de origens permitidas
- Adicionar `FRONTEND_URL=https://seu-dominio.com` no `.env`
- Requests de origens não listadas serão bloqueadas com erro CORS

### Passos de implementação
1. Adicionar `FRONTEND_URL` no `backend/.env`
2. Substituir `app.use(cors())` no `server.js`
3. Testar em dev: frontend em `localhost:5173` deve continuar funcionando
4. Testar bloqueio: requisição de `http://evil.com` deve ser rejeitada

---

## S2 — JWT_SECRET com Fallback Hardcoded

### Como está ANTES
```js
// backend/server.js — linha ~69
const JWT_SECRET = process.env.JWT_SECRET || 'audisped-safira-token-secret-2025';
```
Se o `.env` não for carregado (falha silenciosa, deploy incorreto, container sem env), o segredo vira **público e fixo**. Qualquer pessoa que conheça essa string pode forjar tokens válidos indefinidamente.

### Como ficará DEPOIS
```js
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET não definido. Configure o arquivo .env antes de iniciar.');
    process.exit(1);
}
```
O servidor **recusa iniciar** se o segredo não estiver configurado — falha explícita em vez de falha silenciosa.

### O que mudará
- Remoção do fallback `|| 'audisped-safira-token-secret-2025'`
- Adição de verificação obrigatória com `process.exit(1)`
- O `.env` já tem `JWT_SECRET` configurado — nenhuma mudança em produção
- Tokens existentes gerados com o segredo antigo expiram naturalmente (12h)

### Passos de implementação
1. Localizar linha `const JWT_SECRET = process.env.JWT_SECRET || ...` no `server.js`
2. Substituir pelo bloco de verificação obrigatória
3. Confirmar que `JWT_SECRET` está no `.env` (já está)
4. Reiniciar o servidor e verificar que sobe normalmente
5. Remover o valor hardcoded do histórico do git se já foi commitado: `git log --all -S "audisped-safira"`

---

## S3 — Token JWT via Query String

### Como está ANTES
```js
// backend/server.js — authMiddleware (~linha 71)
const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
```
Permite autenticar passando o token na URL: `GET /api/arquivos?token=eyJ...`

**Riscos:**
- Token fica gravado nos **logs de acesso do servidor** (nginx, apache, cloudflare)
- Token fica no **histórico do browser**
- Token vaza no **cabeçalho Referer** se a página fizer qualquer request externo
- Tokens em URLs são indexados por proxies corporativos

### Como ficará DEPOIS
```js
// Apenas Authorization: Bearer no header
const authHeader = req.headers['authorization'];
const token = authHeader && authHeader.split(' ')[1];
```
Somente o header `Authorization: Bearer <token>` é aceito.

### O que mudará
- Remover `|| req.query.token` do `authMiddleware`
- Verificar se algum componente do frontend usa `?token=` nas URLs (buscar no código do frontend)
- Se houver, corrigir para usar o header correto via axios interceptor

### Passos de implementação
1. Localizar `authMiddleware` no `server.js`
2. Remover `|| req.query.token`
3. Buscar no frontend: `grep -r "token=" frontend/src/` — se encontrar, corrigir para header
4. Testar: chamada com `?token=` deve retornar 401
5. Testar: chamada com `Authorization: Bearer` deve continuar funcionando

---

## S4 — Sem Helmet (Headers HTTP de Segurança)

### Como está ANTES
O backend não envia nenhum header de segurança HTTP. Um atacante pode:
- Fazer o browser interpretar arquivos como outro tipo MIME (`X-Content-Type-Options` ausente)
- Embutir a aplicação em um iframe malicioso (`X-Frame-Options` ausente)
- Forçar conexão HTTP insegura (`Strict-Transport-Security` ausente)
- Executar scripts inline via XSS (`Content-Security-Policy` ausente)

### Como ficará DEPOIS
O servidor passará a enviar automaticamente:
```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-XSS-Protection: 0
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'
```

### O que mudará
- Instalar o pacote `helmet`
- Adicionar `app.use(helmet())` antes de qualquer rota no `server.js`
- Nenhuma mudança no banco ou no frontend

### Passos de implementação
```bash
cd backend
npm install helmet
```
```js
// server.js — adicionar após os requires, antes de app.use(cors())
const helmet = require('helmet');
app.use(helmet());
```
1. Instalar dependência
2. Adicionar no topo do `server.js`, antes do `cors`
3. Reiniciar servidor
4. Verificar headers: `curl -I http://localhost:15435/favicon.ico` deve mostrar os novos headers

---

## S5 — Sem Rate Limiting (Brute Force no Login)

### Como está ANTES
```
POST /api/auth/login  → sem limite de tentativas
POST /api/auth/register → sem limite de tentativas
```
Um atacante pode tentar milhares de senhas por segundo sem ser bloqueado. Com o JWT_SECRET hardcoded (S2) e o CORS aberto (S1), o risco é ainda maior.

### Como ficará DEPOIS
- Login: máximo **10 tentativas** por IP a cada 15 minutos
- Registro: máximo **5 cadastros** por IP a cada hora
- Excedido o limite: HTTP 429 `"Muitas tentativas. Tente novamente em 15 minutos."`

### O que mudará
- Instalar `express-rate-limit`
- Criar limiters específicos para auth
- Rotas de dados (CFOPs, arquivos, etc.) não são afetadas

### Passos de implementação
```bash
cd backend
npm install express-rate-limit
```
```js
// server.js — adicionar após helmet
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10,
    message: { message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 5,
    message: { message: 'Limite de cadastros atingido. Tente novamente em 1 hora.' }
});

app.post('/api/auth/login', authLimiter, async (req, res) => { ... });
app.post('/api/auth/register', registerLimiter, async (req, res) => { ... });
```
1. Instalar dependência
2. Criar os limiters no início do arquivo
3. Aplicar nas rotas de login e registro
4. Testar: 11ª tentativa de login deve retornar 429

---

## S6 — `err.message` Exposto nas Respostas de Erro

### Como está ANTES
Em dezenas de rotas no `server.js`:
```js
res.status(500).json({ message: 'Erro no servidor.', error: err.message });
```
Exemplos de mensagens que podem vazar:
- `"relation \"sped_arquivos\" does not exist"` → revela estrutura do banco
- `"connect ECONNREFUSED 127.0.0.1:5432"` → revela IP/porta do banco
- `"invalid input syntax for type integer"` → revela tipo de dado esperado

### Como ficará DEPOIS
Em produção, apenas a mensagem genérica é retornada ao cliente. O detalhe é logado internamente:
```js
// Em vez de:
res.status(500).json({ message: 'Erro no servidor.', error: err.message });

// Usar:
logger.error(`[ROTA] ${req.method} ${req.path} — ${err.message}`);
res.status(500).json({ message: 'Erro interno. Contate o suporte.' });
```

### O que mudará
- Buscar todas as ocorrências de `error: err.message` no `server.js`
- Substituir por logging interno + mensagem genérica ao cliente
- O logger já existe (`logger.error`) — sem mudança de infraestrutura

### Passos de implementação
1. Contar ocorrências: `grep -c "error: err.message" backend/server.js`
2. Substituição global no `server.js`:
   - Antes: `res.status(500).json({ message: '...', error: err.message })`
   - Depois: adicionar `logger.error(...)` e remover `error: err.message` do JSON
3. Manter `err.message` apenas em rotas de **desenvolvimento** (`NODE_ENV !== 'production'`)
4. Testar que erros reais ainda aparecem nos logs do servidor

---

## S7 — Upload de Arquivo sem Validação de Tipo

### Como está ANTES
```js
// server.js
const upload = multer({ dest: uploadDir });
const uploadXml = multer({ dest: xmlUploadDir });
```
Sem `fileFilter`. Qualquer arquivo pode ser enviado: `.exe`, `.php`, `.sh`, scripts maliciosos, arquivos gigantes.

### Como ficará DEPOIS
```js
const spedFileFilter = (req, file, cb) => {
    const allowed = ['.txt', '.sped'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Tipo de arquivo não permitido: ${ext}. Envie apenas .txt`), false);
};

const xmlFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xml') cb(null, true);
    else cb(new Error(`Tipo de arquivo não permitido: ${ext}. Envie apenas .xml`), false);
};

const upload = multer({
    dest: uploadDir,
    fileFilter: spedFileFilter,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB máx
});

const uploadXml = multer({
    dest: xmlUploadDir,
    fileFilter: xmlFileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB máx por arquivo
});
```

### O que mudará
- Adição de `fileFilter` nas duas instâncias do `multer`
- Adição de `limits.fileSize` para evitar DoS por arquivos gigantes
- Arquivos inválidos retornam 400 com mensagem descritiva
- Arquivos válidos continuam processados normalmente

### Passos de implementação
1. Localizar as duas definições de `multer` no `server.js`
2. Adicionar os filtros conforme acima
3. Testar: envio de `.exe` deve retornar 400
4. Testar: envio de `.txt` SPED deve continuar funcionando

---

## S8 — Remover `server - Copia.js`

### Como está ANTES
Existe `backend/server - Copia.js` — uma cópia do servidor com código legado. Este arquivo:
- Pode conter credenciais ou segredos antigos
- Tem código que não recebeu as correções aplicadas no `server.js` principal
- Pode ser executado acidentalmente (`node "server - Copia.js"`)
- Confunde quem lê o código (qual é o verdadeiro?)

### Como ficará DEPOIS
O arquivo não existirá mais no repositório nem no servidor.

### O que mudará
- Deleção do arquivo `backend/server - Copia.js`
- Adição de `server - Copia.js` no `.gitignore` (prevenção)

### Passos de implementação
1. Confirmar que `server - Copia.js` não é usado por nenhum script: `grep -r "server - Copia" .`
2. Deletar: `rm "backend/server - Copia.js"`
3. Adicionar ao `.gitignore`: `*Copia*`
4. Commit: `git rm "backend/server - Copia.js"`

---

## S9 — Scripts de Debug em Produção

### Como está ANTES
~20 arquivos de debug estão na pasta `backend/`:
```
check_db_status.js, check_columns.js, check_cols.js
test_injection_complex.js, test_keys.js, test_keys_3.js
debug_*.js, tmp_query_db.js, tmp_list_tables.js
analisa_txt.js, optimize_lmc.js, find_empresa.js
verify_continuidade.js (na raiz)
backup_db.sh (na raiz)
```
**Riscos:**
- Revelam nomes de tabelas, colunas e estrutura interna do banco
- Podem ser executados por qualquer pessoa com acesso ao servidor
- `backup_db.sh` pode conter credenciais do banco em texto puro

### Como ficará DEPOIS
Todos os scripts de debug movidos para `dev-tools/` (fora do deploy) e listados no `.gitignore`:
```
audisped/
├── backend/
│   ├── server.js       ← apenas arquivos de produção
│   ├── logger.js
│   └── services/
└── dev-tools/          ← scripts de debug (não vai para produção)
    ├── check_db_status.js
    ├── test_injection_complex.js
    └── ...
```

### O que mudará
- Criação da pasta `dev-tools/` na raiz
- Movimentação de todos os scripts de debug
- Adição de `dev-tools/` ao `.gitignore` (opcional — ou manter mas nunca deployar)
- `backup_db.sh` e `verify_continuidade.js` (raiz) também movidos

### Passos de implementação
1. Criar pasta: `mkdir dev-tools`
2. Listar scripts: `ls backend/*.js | grep -v server.js | grep -v logger.js`
3. Mover scripts de debug para `dev-tools/`
4. Verificar se algum script é importado pelo `server.js`: `grep -r "require.*check\|require.*test\|require.*debug\|require.*tmp" backend/server.js`
5. Atualizar `.gitignore`

---

## S10 — Sem Validação de Schema no `req.body`

### Como está ANTES
Campos do body são usados diretamente sem validação:
```js
const { nome, email, senha } = req.body;
// Sem verificar: email é válido? senha tem mínimo de caracteres? nome tem tamanho razoável?
```
Isso permite:
- Cadastro com `email: "não-é-email"` ou `email: null`
- Senhas de 1 caractere
- Campos com 10.000 caracteres sobrecarregando o banco

### Como ficará DEPOIS
Validação explícita antes de processar cada rota crítica:
```js
// Exemplo para /api/auth/register:
const { nome, email, senha } = req.body;
if (!nome || typeof nome !== 'string' || nome.trim().length < 2 || nome.length > 100)
    return res.status(400).json({ message: 'Nome inválido (2-100 caracteres).' });
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ message: 'Email inválido.' });
if (!senha || senha.length < 6 || senha.length > 128)
    return res.status(400).json({ message: 'Senha deve ter entre 6 e 128 caracteres.' });
```

### O que mudará
- Adição de validações explícitas nas rotas de criação/edição de dados
- Prioridade: `/api/auth/register`, `/api/auth/profile`, `/api/cfops`, `/api/empresas`
- Sem nova dependência (validação manual) — ou instalar `zod`/`joi` para escalabilidade futura

### Passos de implementação
1. Listar rotas que recebem `req.body` com dados críticos
2. Adicionar validações básicas (tipo, tamanho, formato) em cada uma
3. Testar com valores inválidos: `email: "abc"`, `senha: "1"`, `nome: ""`
4. Testar que valores válidos continuam funcionando

---

## Ordem de Execução Recomendada

| Ordem | Item | Esforço | Impacto |
|---|---|---|---|
| 1º | **S2** — JWT_SECRET hardcoded | 5 min | Crítico — impede forja de tokens |
| 2º | **S3** — Token via query string | 5 min | Crítico — para vazamento em logs |
| 3º | **S8** — Deletar server - Copia.js | 2 min | Médio — remove vetor de confusão |
| 4º | **S4** — Instalar Helmet | 10 min | Alto — headers de segurança imediatos |
| 5º | **S5** — Rate Limiting | 15 min | Alto — bloqueia brute force |
| 6º | **S1** — Restringir CORS | 15 min | Crítico — requer saber domínio de produção |
| 7º | **S7** — Filtro de upload | 20 min | Alto — bloqueia uploads maliciosos |
| 8º | **S6** — Ocultar err.message | 30 min | Alto — múltiplos locais no server.js |
| 9º | **S9** — Mover scripts debug | 20 min | Médio — limpeza organizacional |
| 10º | **S10** — Validação de schema | 60 min | Médio — múltiplas rotas |

**Tempo total estimado: ~3 horas**

---

## Critérios de Aceite (Definition of Done)

- [ ] S1: Request de `http://evil.com` retorna erro CORS
- [ ] S2: Servidor recusa iniciar sem `JWT_SECRET` no `.env`
- [ ] S3: `GET /api/arquivos?token=xxx` retorna 401
- [ ] S4: `curl -I localhost:15435` mostra `X-Frame-Options` e `X-Content-Type-Options`
- [ ] S5: 11ª tentativa de login retorna HTTP 429
- [ ] S6: Erro 500 não contém `err.message` na resposta JSON
- [ ] S7: Upload de `.exe` retorna HTTP 400
- [ ] S8: `server - Copia.js` não existe mais no repositório
- [ ] S9: Nenhum script `check_*`, `test_*`, `debug_*` na pasta `backend/`
- [ ] S10: `POST /api/auth/register` com email inválido retorna 400 descritivo
