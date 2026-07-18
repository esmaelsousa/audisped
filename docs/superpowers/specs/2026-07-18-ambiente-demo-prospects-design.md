# Spec — Ambiente de Demonstração para Prospects (`demo.audisped.com.br`)

**Data:** 2026-07-18
**Autor:** Esmael + Claude
**Status:** desenho aprovado, aguardando plano de implementação

---

## 1. Problema

Hoje qualquer usuário logado enxerga (e pode apagar/exportar) **todos os postos reais** — `/api/empresas` faz `SELECT * FROM empresas` sem nenhum filtro por usuário/rede ([server.js:3249](../../../backend/server.js)), e as ~118 rotas de dados não são escopadas (Fase 1 do SaaS não feita).

Precisamos de um **ambiente de teste** onde um prospect experimente o produto por completo — com o **SPED fiscal real dele** — sem tocar em dado de cliente e sem levar embora o deliverable de graça.

## 2. Decisões travadas (com o usuário)

1. **Ambiente separado**, isolado por **infraestrutura** (não por filtro de código). O backend demo fisicamente não alcança o banco de produção.
2. **Base única compartilhada**, com **reset diário** + **reset sob demanda**. Risco de dois prospects se cruzarem no mesmo dia é **aceito** (mitigar agendando demos 1 a 1).
3. **Login compartilhado único** (`demo@audisped.com.br`), role nova `demo`.
4. **Seed vazio de dado de cliente** — o prospect traz o próprio SPED. Só tabelas de **referência** (públicas) são copiadas do prod.
5. **Paywall = o download**. O prospect vive o produto inteiro na tela; o **SPED corrigido `.txt`** e o **LMC impresso** ficam atrás do paywall. Os PDFs de **prova** (correções, dossiê, rentabilidade) são **liberados**, **em detalhe completo** — risco de reconstrução manual **aceito** (inviável em SPED real de centenas de correções).

## 3. Fluxo do prospect (experiência-alvo)

```
sobe SPED real  ->  corrige LMC  ->  injeta XML  ->  confere Analisador
   ->  roda Validador (corrige tudo, MOSTRA o que corrigiu na tela)
   ->  ✅ baixa PDF do que foi corrigido (prova)
   ->  ❌ NÃO baixa o SPED fiscal corrigido (.txt)   [paywall: 402 "Assine para baixar"]
   ->  ❌ NÃO baixa o LMC impresso (PDF do livro)     [paywall]
```

## 4. Arquitetura

Segundo stack no **mesmo VPS** (187.127.5.210), fisicamente separado do real:

| Componente | Detalhe |
|---|---|
| `audisped-demo-db` | Postgres próprio, banco **`audisped_demo_db`**, `DATABASE_URL` distinta. Nunca compartilha o `audisped_db` de produção. |
| `audisped-demo-backend` | **Mesma imagem** do backend, com `DEMO_MODE=1` e `DATABASE_URL` do demo. Volume de uploads próprio (`/opt/audisped/demo/uploads`). |
| Caddy | Novo bloco `demo.audisped.com.br` → container demo (auto Let's Encrypt, como o `app`). |

**Isolamento garantido pela infra:** o container demo só tem credencial do banco demo. Bug de código = afeta só o descartável. Zero mudança nas rotas de produção.

## 5. Banco demo — o que nasce dentro

Estrutura criada com `node setup_db.js` (já inclui todas as tabelas + colunas de migração + seed de `cad_cfops`/`cad_credenciadoras`).

- 🔴 **Dado de cliente — NÃO copiar** (nasce vazio, o prospect preenche): `empresas`, `sped_*`, `documentos_d`, `lmc_movimentacao`, `lmc_tanques_config`, `lmc_lacres`, `encerrantes_*`, `mapeamento_participantes`, `mapeamento_produtos`, `empresa_certificados`, `mde_cache`, `val_*`, `usuarios` reais, `redes`, `auditoria_seguranca`, `password_reset_tokens`.
- 🟢 **Referência — copiar do prod** (público, sem isso o Validador quebra): `ncm`, `cest`. `cad_cfops`/`cad_credenciadoras` já vêm do `setup_db.js`.
- ⚠️ **Verificar na implementação** se são regra global (copiar) ou por-cliente (deixar vazio): `config_tributaria`, `de_para_xml`, `cad_apuracao_e`, `mapeamento_produtos`.

**Extração inofensiva** do prod: `pg_dump --data-only --table=ncm --table=cest ... audisped_db > ref.sql` → aplica no `audisped_demo_db`. Nenhuma linha de dado de cliente sai da produção.

**Usuário seed:** um único `demo@audisped.com.br`, `role='demo'`, `ativo=true`, senha compartilhada conhecida.

## 6. O paywall (núcleo)

Regra: **role `demo` vê tudo na tela (rotas JSON), mas não extrai o deliverable.**

### 6.1 Nova role `demo`
- Adicionar `demo` ao CHECK de `usuarios.role` (hoje `super_admin|admin|staff|escritorio`).
- Em [authz.js](../../../backend/authz.js): `demo` tem **zero** capacidades de gestão (`canManageUsers=false`, etc.).

### 6.2 Bloqueio de saída — duas camadas

**Camada A — rede automática (pega todo SPED `.txt`):**
Middleware global que, quando `req.user.role === 'demo'`, intercepta a resposta: se o `Content-Type` for `text/plain` (charset latin1 — assinatura dos exports de SPED em [server.js:2481](../../../backend/server.js), 7688, 10811) **com** `Content-Disposition: attachment`, responde **402** `{ erro: "Assine para baixar o arquivo corrigido", paywall: true }`. Cobre todos os exports de SPED **presentes e futuros** sem depender de lista.

**Camada B — bloqueio explícito (deliverables que não são `.txt`):**
Middleware `bloquearSaidaDemo` montado nas rotas de deliverable que **não** caem na Camada A:
- `GET /api/lmc/imprimir/:id_sped` (7411) — LMC impresso (PDF).

### 6.3 Explicitamente LIBERADO para `demo` (prova de valor)
`/api/validador/relatorio-correcoes/:id` (6771, PDF detalhado), `/api/relatorio/dossie/:id` (6967), `/api/relatorio/rentabilidade/:id/pdf` (5392), posição de estoque (5465), Excel de auditoria (7060), e **todas as rotas JSON de tela** (findings do validador, LMC, notas, dashboard, SpedPreview).

> Ativação por flag: o middleware só age quando `DEMO_MODE=1` **e** `role='demo'`. Em produção não existe role `demo` → comportamento inalterado. Golden test garante não-regressão.

## 7. Reset

Volta a base ao estado seed (§5): schema + referência + 1 usuário demo, zero dado de cliente.

- **Diário (cron 03:00):** `TRUNCATE` das tabelas 🔴 (com `CASCADE`/ordem de FK) + `rm -rf` dos SPEDs subidos no volume demo + recria o usuário `demo` se sumiu. **Não** dropa o banco (preserva `ncm`/`cest`).
- **Sob demanda:** script `demo-reset.sh` (mesma lógica) e endpoint `POST /api/demo/reset` restrito a `super_admin` (para zerar antes de uma call).

## 8. Mudanças no código (mínimas, sem tocar produção)

1. `demo` no CHECK de `usuarios.role` — migração incremental idempotente.
2. Middleware da Camada A (global, guardado por `DEMO_MODE`) + `bloquearSaidaDemo` na rota do LMC — em `server.js`/`backend/authz.js`.
3. Endpoint `POST /api/demo/reset` (só `DEMO_MODE`).
4. Infra: serviço `audisped-demo-*` no `docker-compose`, bloco Caddy, cron, `demo-reset.sh`, script de extração de referência.

Nada disso altera o caminho de produção (tudo atrás de `DEMO_MODE=1` / `role='demo'`, que não existem no prod).

## 9. Testes

- **Paywall bloqueia:** `role=demo` recebe **402** em `/api/exportar-sped/:id`, SPED standalone, `.txt` contribuições e `/api/lmc/imprimir/:id`.
- **Paywall libera:** `role=demo` recebe **200** no PDF de correções, dossiê, rentabilidade e nas rotas JSON de tela.
- **Não-regressão (prod):** role não-demo recebe **200** em todas as rotas de export (golden test — export idêntico antes/depois).
- **Reset:** após rodar, banco volta ao seed (0 empresas, 1 usuário `demo`, `ncm`/`cest` intactos, volume de uploads limpo).
- **Isolamento infra:** container demo com `DATABASE_URL` do prod removida — não há conexão possível ao `audisped_db`.

## 10. Critérios de aceite

1. `demo@audisped` sobe SPED real, corrige LMC, injeta XML, roda o validador e **vê tudo na tela**.
2. Baixa o **PDF de correções** (200) mas recebe **402** ao tentar baixar o **SPED `.txt`** e o **LMC impresso**.
3. Reset diário (e sob demanda) devolve a base ao seed vazio.
4. Produção intocada: nenhuma role `demo`, nenhum `DEMO_MODE` → export e todas as rotas funcionam como hoje (golden test verde).
5. O backend demo comprovadamente não alcança o banco de produção.

## 11. Fora de escopo (explícito)

- Isolamento multi-inquilino real (Fase 1 do SaaS) — **não** é isto; este ambiente é descartável e single-user.
- Base isolada por prospect / reset por sessão — risco de cruzamento **aceito**.
- Auto-cadastro self-service — decidido login compartilhado único.
- Cobrança/gateway (Asaas) — a demo apenas mostra o paywall como texto ("Assine para baixar"); o fluxo de assinatura é outro projeto.
