# PLANO — Controle de Usuários, Multi-inquilino e Cobrança (SaaS)

> **Objetivo:** transformar o AudiSped de app de usuário único (todo logado vê tudo) num **SaaS multi-inquilino** com perfis de acesso, **isolamento de dados por cliente**, **módulos liberáveis** e **cobrança por CNPJ** — começando com gestão/cobrança **manual** e arquitetado para **automação via Asaas** (PIX/cartão + bloqueio/liberação automáticos) sem reescrever nada.
>
> **Branch sugerida:** `feat/controle-usuarios-saas`
> **Status:** PLANEJADO (nada implementado)

---

## 0. Decisões travadas (com o usuário)

| # | Decisão | Valor |
|---|---|---|
| 1 | Gateway de pagamento | **Asaas** (PIX + cartão + assinatura recorrente + webhook + NFS-e) |
| 2 | Granularidade do bloqueio | **por conta/rede** (uma fatura por rede = soma dos CNPJs ativos) |
| 3 | Carência / trial | **dias configuráveis por cliente** (campo na rede, não constante global) |
| 4 | Lançamento | **manual primeiro**, depois Asaas — porém schema/estado/hooks já **gateway-ready** |
| 5 | Unidade de cobrança | **CNPJ ativo** (o medidor); cobra-se por nº de CNPJs ativos da rede |
| 6 | Módulos | **toggles** (engine flexível) empacotados comercialmente em **planos** |
| 7 | Entitlement de módulo | no nível **rede** (aplica a todos os CNPJs dela) — _por-CNPJ fica como evolução_ |
| 8 | Escopo do Escritório | **todos os CNPJs da rede** no v1 (`usuario_empresas` reservado p/ escopo fino) |
| 9 | CNPJ entre redes | **`UNIQUE(cnpj, rede_id)`** — cada rede tem sua própria linha do CNPJ (resolve §12.4) |
| 10 | `de_para_xml` / `regras_fiscais` | **per-tenant** — herdam `rede_id` via `id_empresa` + backfill; `cad_cfops`/`ncm`/`cest`/`cad_*`/catálogo = **globais read-only** (write só super_admin) (resolve §12.6) |
| 11 | Autocadastro (`/api/auth/register`) | **FECHADO** — você/admin provisiona; sem signup público (resolve §12 risco médio) |

> Itens 6-8 são **assunções** confirmáveis; o resto é decisão explícita.

---

## 1. Ground truth (estado atual do código)

| Item | Onde | Situação |
|---|---|---|
| Tabela `usuarios` | `setup_db.js:17-23` | **plana**: id, nome, email, senha, criado_em — sem role/rede/módulos |
| `authMiddleware` | `server.js:132-148` | valida JWT, faz `req.user = decoded` (`{id,email}`); **sem role/tenant** |
| `GET /api/empresas` | `server.js:3014` | `SELECT * FROM empresas` — **retorna tudo a qualquer logado** |
| `empresas` | FK `id_empresa` em todo o schema (`setup_db.js`) | **sem dono/tenant**; empresas são globais |
| Auth routes | `/api/auth/login|register|profile` (`server.js ~132-206`) | login/cadastro abertos, sem papel |

**Conclusão:** zero isolamento de dados hoje. Esse é o trabalho central — e o de maior risco num SaaS pago (vazar dado fiscal de um cliente para outro = catástrofe jurídica/reputacional).

---

## 2. Modelo de dados

### 2.1 `redes` — a CONTA do cliente (tenant + cobrança)
```
id            SERIAL PK
nome          TEXT NOT NULL                      -- "Rede de Postos Y"
documento     TEXT                               -- CNPJ/CPF do responsável (pagador)
email_resp    TEXT
status        TEXT NOT NULL DEFAULT 'trial'      -- máquina de estados §4
plano         TEXT                               -- 'basico' | 'completo' | 'custom'
modulos_contratados JSONB NOT NULL DEFAULT '[]'  -- chaves de módulo liberadas à rede
trial_ate     DATE                               -- fim do teste (configurável)
dias_carencia INTEGER NOT NULL DEFAULT 5         -- tolerância pós-vencimento (configurável)
vencimento_dia INTEGER                           -- dia do mês da fatura
-- Preço & desconto (livre, por conta — sem tabela fixa; ver §2.7):
preco_por_cnpj NUMERIC(10,2)                     -- preço NEGOCIADO da conta (override do plano); null = usa o plano
desconto_pct   NUMERIC(5,2) DEFAULT 0            -- % off recorrente (ex.: 15.00)
desconto_valor NUMERIC(10,2) DEFAULT 0           -- R$ off recorrente (fixo por fatura)
desconto_ate   DATE                              -- desconto promocional com validade (null = permanente)
-- gateway-ready (null até a Fase 5):
asaas_customer_id     TEXT
asaas_subscription_id TEXT
criado_em, atualizado_em TIMESTAMP
```

### 2.2 `empresas` (CNPJ) — a LINHA FATURÁVEL
```
+ rede_id      INTEGER REFERENCES redes(id)
+ status       TEXT NOT NULL DEFAULT 'ativo'      -- 'ativo' | 'suspenso' | 'arquivado'  (faturável = ativo)
+ ativado_em   TIMESTAMP
+ suspenso_em  TIMESTAMP
-- Decisão #9: trocar o UNIQUE global de cnpj por composto (cada rede tem sua linha):
--   DROP CONSTRAINT <unique_cnpj_atual>;  ADD CONSTRAINT empresas_cnpj_rede_uk UNIQUE (cnpj, rede_id);
--   → o upsert do /api/upload (L520) passa a casar por (cnpj, rede_id) — nunca anexa ao tenant errado.
```

### 2.3 `usuarios`
```
+ role     TEXT NOT NULL DEFAULT 'escritorio'     -- 'super_admin' | 'admin' | 'escritorio'
+ rede_id  INTEGER REFERENCES redes(id)           -- NULL p/ super_admin
+ modulos  JSONB NOT NULL DEFAULT '[]'            -- grants do usuário (⊆ rede.modulos_contratados)
+ ativo    BOOLEAN NOT NULL DEFAULT TRUE
```

### 2.4 `usuario_empresas` (M:N — opcional, escopo fino do escritório)
```
usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE
PRIMARY KEY (usuario_id, empresa_id)
```
> Vazio = escritório vê **todos** os CNPJs da rede (v1). Preenchido = só os designados (evolução).

### 2.5 `faturas` — billing (manual no v1, Asaas na Fase 5; MESMA forma)
```
id            SERIAL PK
rede_id       INTEGER REFERENCES redes(id)
competencia   TEXT                                -- 'YYYY-MM'
qtd_cnpjs     INTEGER                             -- CNPJs ativos cobrados
preco_unitario NUMERIC(10,2)                      -- SNAPSHOT do preço/CNPJ no fechamento (imutável)
desconto_aplicado NUMERIC(10,2) DEFAULT 0         -- SNAPSHOT do desconto desta fatura
valor         NUMERIC(10,2)                       -- = qtd_cnpjs*preco_unitario - desconto_aplicado (congelado)
status        TEXT NOT NULL DEFAULT 'aberta'      -- 'aberta'|'paga'|'vencida'|'cancelada'
vencimento    DATE
pago_em       TIMESTAMP
-- gateway-ready:
asaas_invoice_id TEXT
link_pagamento   TEXT                             -- checkout PIX/cartão (Asaas)
criado_em     TIMESTAMP
```

### 2.6 Registro de módulos (fonte ÚNICA — usada pelo backend E pelo sidebar)
`backend/modulos.js` (novo) exporta o catálogo canônico:
```
analisador*      Auditoria (Motor)        core
validador        Validador SPED           sellable
catalogo*        Catálogo de Regras       core
conciliacao      Conciliação SEFAZ/XML    sellable
rentabilidade    Posição de Estoque       sellable
injetor_xml      Injetor XML (venda)      sellable
injetor_cte      Injetor CTe              sellable
de_para          De-Para XML              sellable
regras_fiscais   Regras Fiscais           sellable
cfops            Cadastro de CFOPs        sellable
livro_lmc        Livro LMC                sellable
impressao_lmc    Impressão LMC            sellable
manifesto_nfe    Manifesto NFe (MDe)      sellable
```
`*` core = sempre disponível p/ conta ativa. O front (AppSidebar) lê a mesma chave p/ exibir/ocultar.

### 2.7 Preços e descontos — SEM tabela fixa
Princípio: **plano = preço de REFERÊNCIA, não lei.** Cada conta tem preço/desconto **negociáveis livremente**.

**Preço efetivo por CNPJ da conta:**
```
base      = redes.preco_por_cnpj  ??  planos.preco_cnpj         (override negociado vence o plano)
efetivo   = base
            - (base * desconto_pct/100)        se desconto_pct  > 0
            - (desconto_valor / qtd_cnpjs)     se desconto_valor > 0   (rateio, ou aplica no total da fatura)
            (desconto só vale enquanto desconto_ate ∈ futuro/null)
fatura.valor = qtd_cnpjs * efetivo
```
Camadas de desconto suportadas, combináveis:
- **Override de preço** (`preco_por_cnpj`) — o "preço negociado" cru daquele cliente.
- **% recorrente** (`desconto_pct`) — ex.: 15% off todo mês.
- **R$ recorrente** (`desconto_valor`) — abatimento fixo por fatura.
- **Promo com validade** (`desconto_ate`) — ex.: "3 meses com 50%"; após a data, volta ao cheio.
- *(opcional, Fase 2/5)* **cupons** (`cupons`: codigo, tipo, valor, validade, max_uso) p/ campanhas — aplicável na fatura/assinatura.

**Integridade:** cada `fatura` guarda **snapshot** de `preco_unitario` + `desconto_aplicado` + `valor` (congelados). Mudar o desconto da conta depois **não** altera faturas já emitidas — só as próximas.

**Asaas (Fase 5):** a assinatura recebe o **valor efetivo já calculado** (você manda o preço negociado pro gateway); o Asaas ainda tem desconto nativo (ex.: por pagamento antecipado) que pode somar a isso. Nada disso é tabela fixa — é por conta.

---

## 3. Autorização no backend (o NÚCLEO)

> Regra de ouro: **permissão é no backend, não no menu.** O sidebar é só UX.

Cadeia de middlewares (compõe sobre o `authMiddleware` existente):
1. `requireAuth` — já existe (`server.js:132`). **Enriquecer** `req.user` com `role` e `rede_id` (re-buscar do banco; ver §3.1).
2. `requireActiveAccount` — `rede.status ∉ {suspensa, cancelada}`; senão **402 + redirect ao Portal Financeiro**. Super admin faz bypass.
3. `requireRole(min)` — hierarquia `super_admin > admin > escritorio`.
4. `requireModule('livro_lmc')` — módulo no **grant do usuário** E no **contratado da rede**.
5. `scopeRede` — injeta `req.redeId` (do **token**, nunca do cliente); toda query de dados filtra por `rede_id` (via `empresas.rede_id`). Super admin: bypass / escolhe rede (impersonação).
6. **DELETE** — exige `role ≥ admin` (escritório bloqueado de excluir).

### 3.1 JWT — o que embutir
Embutir **`{id, role, rede_id}`** (estáveis). **NÃO embutir** `modulos` nem `status` (mudam): re-buscar por request (cache curto, ex. 30s) — senão um cliente **suspenso com token válido** mantém acesso até expirar. A suspensão tem que valer **na hora**.

### 3.2 Rotas a tocar (todas as de dados)
`/api/empresas`, `/api/arquivos/*`, `/api/analisar/*`, `/api/validador/*`, `/api/documentos/*`, `/api/lmc/*`, `/api/exportar-sped/*`, `/api/inject-xml*`, `/api/de-para`, `/api/cfops`, `/api/regras-fiscais/*`, `/api/conciliacao/*`, `/api/mde/*`, … → **todas** passam por `scopeRede` + `requireModule` conforme o caso. Inventariar e cobrir **100%** (uma rota esquecida = vazamento).

---

## 4. Máquina de estados de acesso (a espinha — manual hoje, Asaas amanhã)

`redes.status`:
```
            trial ──(trial_ate vence, sem pgto)──► em_atraso
            trial ──(pagou/ativou)──────────────► ativa
            ativa ──(fatura vence)──────────────► em_atraso
        em_atraso ──(pagou)─────────────────────► ativa
        em_atraso ──(passou dias_carencia)──────► suspensa   ◄── BLOQUEIA acesso
         suspensa ──(pagou)─────────────────────► ativa      ◄── LIBERA automático
   (qualquer) ──(cancelamento)──────────────────► cancelada
```
- **Quem LÊ o estado:** `requireActiveAccount` (Fase 1). `suspensa`/`cancelada` → redirect ao Portal Financeiro.
- **Quem VIRA o estado:**
  - **v1 (manual):** você, no Console Super Admin (botão suspender/ativar; lançar fatura paga).
  - **Fase 5 (auto):** **webhook do Asaas** vira o MESMO estado.
- `em_atraso` = acesso ainda liberado, com **banner de aviso** (dentro da carência).
- Job diário avalia faturas vencidas → `ativa→em_atraso→suspensa` conforme `dias_carencia`.

> **Princípio:** mesma máquina de estados, dois acionadores. Plugar o Asaas depois é só o webhook chamar o transition já existente. **Zero reescrita.**

---

## 5. Fases de implementação

| Fase | Entrega | Arquivos | Risco |
|---|---|---|---|
| **0. Modelo + migração** | tabelas `redes`/`faturas`/`usuario_empresas`; colunas em `empresas`/`usuarios`; **backfill** (rede "default", todas as empresas → default+ativo, seu user → super_admin) | `setup_db.js`, migração incremental | médio (**dados de produção** — incremental, com backup, nunca dump-restore) |
| **1. Isolamento + estados (backend)** | enriquecer `req.user`; middlewares §3; `scopeRede` em **TODAS** as rotas; `requireActiveAccount`; transitions §4 (toggle manual) | `server.js`, `backend/modulos.js`, `backend/authz.js` (novo) | **alto — o núcleo de segurança** |
| **2. Console Super Admin** | CRUD redes/CNPJs; status; `modulos_contratados`; `trial_ate`/`dias_carencia`; **contador de CNPJs ativos** (base de cobrança); faturas manuais | nova view + rotas `/api/admin/*` | médio |
| **3. Admin do cliente** | admin gerencia escritório da rede + **distribui módulos** (⊆ contratado); criar/desativar usuário | view "Usuários" + rotas | médio |
| **4. Front gating + Portal Financeiro** | sidebar/rotas por role+módulos; esconder "excluir" do escritório; **guard que redireciona p/ Portal quando `suspensa`**; Portal lista faturas (manual no v1) | `AppSidebar.vue`, `router`, nova `PortalFinanceiroView.vue`, `store` | baixo |
| **5. Automação Asaas** | customer/subscription por rede; **webhook → transition**; reconciliação (poll de segurança); checkout **PIX/cartão** no Portal; emissão **NFS-e**; régua de cobrança | `backend/asaasService.js` (novo), `/api/webhooks/asaas`, Portal | médio-alto |

> **Entregar até a Fase 4 já é um SaaS vendável** com gestão manual: você cria a rede, adiciona CNPJs, define módulos/trial, suspende quem não pagou, e o cliente vê o Portal com as faturas. A Fase 5 só **liga o piloto automático**.

---

## 6. Hooks "gateway-ready" reservados desde o v1
Para a Fase 5 ser plug-in e não cirurgia:
- Colunas `asaas_customer_id`/`asaas_subscription_id` (redes) e `asaas_invoice_id`/`link_pagamento` (faturas) já existem (null no v1).
- `faturas` já tem a **forma final** — manual preenche os mesmos campos que o Asaas preencherá.
- Rota `POST /api/webhooks/asaas` **reservada** (stub no v1).
- A máquina de estados §4 é **idêntica** p/ manual e automático.
- Secrets do Asaas seguem o padrão de `/opt/audisped/backend/.env` (como `CERT_ENCRYPTION_KEY`/`JWT_SECRET`).

---

## 7. Integração Asaas (Fase 5) — desenho

- **Modelo:** 1 `customer` Asaas por **rede**; 1 `subscription` recorrente com valor = `qtd_cnpjs_ativos × preço` (ou plano). Cobra-se a conta, não o CNPJ avulso (decisão #2).
- **Webhook** (`PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_RECEIVED`, …) → atualiza `faturas.status` → dispara transition §4 (`suspensa→ativa` ou `ativa→em_atraso`).
- **Riscos do webhook (o coração):** assinatura verificada + **idempotência** + **job de reconciliação** (consulta Asaas periodicamente como rede de segurança — webhook perdido = cliente pagou e ficou bloqueado) + **botão liberar manual** (suporte).
- **Portal Financeiro:** lista faturas (do banco, espelhadas do Asaas) + botão **Pagar** que abre o **checkout do Asaas** (tokeniza cartão / gera QR PIX). Você **não** desenha tela de cartão (PCI fica no Asaas).
- **NFS-e:** Asaas emite nota de serviço da sua receita (configurar).
- **PIX:** confirmação em segundos via webhook → "libera automático" funciona de fato.

---

## 8. Migração e produção (cuidados)

- VPS **já em produção** com a equipe usando → migração **incremental** (ALTER ADD COLUMN nullable; backfill em UPDATE), **com backup do banco antes**. **Nunca** dump-restore por cima (apagaria dados de produção — ver memória de deploy).
- Backfill Fase 0: criar rede "default", `UPDATE empresas SET rede_id=<default>, status='ativo'`; `UPDATE usuarios SET role='admin', rede_id=<default>`; seu usuário → `role='super_admin', rede_id=NULL`.
- Ordem inegociável: **Fase 0 e 1 antes de qualquer tela bonita.** A tentação é fazer "selecionar módulos" primeiro — é o verniz; sem o isolamento no backend, é teatro de segurança.

---

## 9. Critérios de aceite

1. Escritório/Admin da Rede A **não acessa** nenhum dado da Rede B — nem pela UI, nem batendo na API direto (testar com token forjado de outra rede).
2. Conta `suspensa` → **toda** rota de dados responde bloqueio + Portal; reverter para `ativa` libera na hora.
3. `requireModule` nega rota cujo módulo não está no grant do usuário **e** no contratado da rede.
4. Escritório recebe **403 em DELETE**; Admin consegue.
5. Contador de "CNPJs ativos por rede" bate com a fatura.
6. Super admin enxerga/gerencia todas as redes; transition manual funciona.
7. (Fase 5) webhook `PAYMENT_CONFIRMED` de uma fatura `suspensa` → conta volta a `ativa` sem ação humana; webhook duplicado é idempotente.

---

## 10. Próximo passo recomendado
Implementar a **Fase 0 (modelo + migração)** numa branch própria, **localmente primeiro** (validar o backfill no banco local), e só então promover à VPS com backup. Antes de tocar produção, rodar o backfill num dump de teste. A Fase 1 (isolamento) vem logo em seguida — é o que torna o produto **seguro o suficiente para ter o primeiro cliente pagante**.

---

## 11. Extensibilidade — como entra um MÓDULO NOVO (ex.: Validador SPED Contribuições)

> Requisito de design: **criar módulo não pode mexer no engine de licença/cobrança.** O segredo é separar **capacidade (código)** de **empacotamento comercial (dados)**, unidos pela **chave** do módulo.

### Capacidade — no CÓDIGO (vem junto com a feature)
- Registra a `chave` no catálogo `backend/modulos.js` (categoria `core`|`sellable`).
- As rotas novas usam `requireModule('chave')` + `scopeRede`.
- O sidebar ganha o item lendo a **mesma chave**.
- Como `redes.modulos_contratados` e `usuarios.modulos` são **arrays JSONB de chaves**, adicionar um módulo **NÃO exige migração de schema** — é só mais uma string no array. **(É exatamente por isso que o design é JSONB, e não colunas booleanas por módulo.)**

### Empacotamento — em DADOS (decisão comercial, SEM deploy)
Tabela `planos` (chave, nome, `preco_cnpj`, `modulos` jsonb) + `preco_addon` por módulo. No Console você decide se o módulo novo é:
- **(a) incluso num plano** → adiciona a chave ao `modulos` do plano; quem é desse plano passa a ter, sem custo extra;
- **(b) add-on pago por CNPJ** → define `preco_addon`; quem ativar paga a mais;
- **(c) novo tier/plano**.

### Fluxo concreto — Validador SPED Contribuições (`validador_contribuicoes`)
1. Desenvolve a feature (já há `PLANO_VALIDADOR_CONTRIBUICOES.md`).
2. Backend: rotas com `requireModule('validador_contribuicoes')` + `scopeRede`; +1 entrada em `backend/modulos.js`.
3. Front: item no sidebar gated pela chave.
4. Comercial (no Console, **sem deploy**): põe a chave no plano "Completo" **ou** marca como add-on R$X/CNPJ.
5. Pronto: redes/usuários com a chave veem e usam; o resto, não. A cobrança ajusta sozinha pelo empacotamento.

➡️ **O engine de licença/cobrança nunca muda quando você cria módulo.** Só (i) declara a capacidade no código e (ii) empacota o preço nos dados. Vale p/ Contribuições, MDF-e, ICMS, ou qualquer evolução.

### Comportamento no Console (flag por conta)
O Console renderiza um **checklist de módulos a partir do catálogo**, e os checkboxes de cada conta refletem o array `modulos_contratados` daquela rede. Consequência:
- **Módulo novo aparece automaticamente** no checklist de **todas** as contas (novas E antigas), assim que a versão com o módulo sobe (o mesmo deploy que lança a feature — sem passo extra).
- **Default OFF para `sellable`** em contas existentes (opt-in): adicionar um módulo **não** o entrega de graça a todos — você liga manualmente para quem quiser/pagar. **Default ON só para `core`.**
- Ligar/desligar é **1 clique por conta** (vira/desvira a chave no array) — sem deploy, vale na hora (o middleware lê o estado atual).
- *(opcional)* **planos** funcionam como template: ao criar uma conta nova, pré-marcam as flags do plano escolhido — mas a verdade do acesso é sempre o `modulos_contratados` da conta.

### Ressalva — dimensão de cobrança
O modelo cobra por **CNPJ ativo** (flat/plano + add-on). Se um módulo futuro precisar de **outra métrica** (por documento processado, por consulta SEFAZ, por usuário), isso é **extensão do billing** (nova dimensão de medição) — não resolvido só pelo toggle. O catálogo já segura a **disponibilidade**; a métrica nova entra no módulo de cobrança quando surgir.

---

## 12. Avaliação por time de agentes — correções OBRIGATÓRIAS para 100%

Veredito consolidado: arquitetura **sólida e implementável sem quebrar o atual** — mas o plano **como estava NÃO era 100%**. 5 agentes auditaram contra o código real (confiança média ~82%; revisor adversarial em 62% — achou os campos minados). As correções abaixo viram **pré-requisito** e passam a fazer parte do plano.

### 🔴 Críticos (sem isso, vaza ou quebra)
1. **Ownership-check por OBJETO, não só filtro de lista.** `scopeRede` filtrando `GET /api/empresas` não basta: rotas pesadas pegam `:id_arquivo`/`:id_sped`/`:id` da URL e **não fazem JOIN com `empresas`** (`/api/resumo/:id_arquivo` L4828, `/api/lmc/:id_sped` L3305, `/api/validador/analisar/:id` L5953, `/api/exportar-sped/:id`, `/api/analisar/:id` L2257). → **Toda** rota com `:id` precisa checar dono (`JOIN sped_arquivos→empresas WHERE empresas.rede_id = req.redeId`) antes de servir. Muda de "filtrar listas" para "validar dono em cada acesso" — o maior ajuste.
2. **Fechar rotas SEM `authMiddleware` ANTES de escopar** (públicas hoje, confirmado): `/api/resumo/:id_arquivo` (4828), `/api/estoque-resumo/:id_arquivo` (4996), `/api/resumo/participante/:id_arquivo` (6285), **`DELETE /api/arquivo/:id` (9509)**, `GET/POST/DELETE /api/de-para` (9866/9892/9939). O DELETE sem auth é o pior. + remover a 2ª definição morta de `/api/empresas` (L4685).
3. **Backfill 100% + `SET NOT NULL` + teste em dump.** Empresa/arquivo com `rede_id` NULL **some** sob `WHERE rede_id=$1`. Garantir cobertura total, depois travar NOT NULL.
4. **`empresas.cnpj` é UNIQUE global** → duas redes não podem ter o mesmo CNPJ, e `/api/upload` faz upsert por CNPJ (L520) → upload de uma rede pode **anexar silenciosamente** ao CNPJ de outra. **Decisão de schema:** UNIQUE composto `(cnpj, rede_id)` ou compartilhamento explícito. Sem isso, a "linha faturável por rede" não existe de verdade.

### 🟠 Altos
5. **Bypass do super_admin explícito.** `WHERE empresas.rede_id = NULL` retorna 0 linhas → você (super, rede_id NULL) ficaria **sem ver nada**. Toda query escopada precisa de ramo `if super_admin: sem filtro` (+ impersonação por header). O token interno do export (`tokenInterno`, L6090, usado por `/api/validador/revalidar`) precisa de bypass, senão revalidar quebra.
6. **Tabelas GLOBAIS — decidir escopo:** `cad_cfops`, `ncm`, `cest`, `cad_credenciadoras`, `cad_apuracao_e116`, catálogo do validador → provável **global read-only** (write só super_admin). **MAS `de_para_xml` e `regras_fiscais` são o coração das correções de export (memória itens 14/18/20/21)** — se virarem per-tenant sem backfill, o export **regride aos valores crus do XML**. Decisão explícita obrigatória.
7. **Re-buscar role/rede/status do banco (NUNCA do token).** Tokens ativos antigos (`{id,email}`, validade 24h) não têm role/rede; ler do token dá `undefined`. Reforçar como regra inquebrável + cache 30s (não estourar o pool, `MAX_HEAVY_OPS=5`).
8. **`GET /api/me` (novo)** devolve role + `rede.status` + módulos efetivos (status/módulos não vão no JWT); front chama no boot/foco. + **interceptor axios 402 → /portal-financeiro** (suspensão no meio da sessão). `/login` e `/portal-financeiro` ficam fora do gate (no-loop).

### 🟡 Cobrança (guardas que faltavam)
9. **Clamp na matemática:** `efetivo = max(0, base − descontos)`; `desconto_aplicado = min(desconto, valor_cheio)`; exigir `qtd_cnpjs>0` e base resolvível (erro explícito, não R$0 silencioso). Travar **ordem** (% depois R$) e **rateio no total**.
10. **Idempotência & integridade já no v1:** tabela `webhook_events(asaas_event_id PK)` (Asaas manda `evt_…` + header `asaas-access-token`); `UNIQUE(rede_id, competencia)` em `faturas` (evita fatura dupla job×webhook); campo `forma_pagamento`; mapear `PAYMENT_OVERDUE→vencida`.
11. **Estados:** trial vence **por data** (`trial_ate`), não por fatura; volta a `ativa` só com **zero faturas vencidas**; definir se `cancelada` reativa; job diário **idempotente por data** (`vencimento + dias_carencia < hoje`).

### ✅ Confirmado sólido (pelos agentes, com simulação)
- **Front não regride** na transição: o gate **auto-desliga** se o `usuario` ainda estiver no formato antigo — zero impacto até o backfill (10/10 casos simulados).
- **Isolamento É possível** via `empresas.rede_id` + ownership-check (token forjado de outra rede não vazou na simulação).
- **Asaas confirmado:** assinatura RECURRENT + PIX/cartão + webhooks `PAYMENT_CONFIRMED/RECEIVED/OVERDUE` + NFS-e.
- **Máquina de estados de 2 acionadores** (manual/webhook) é o acerto central; `requireActiveAccount` é aditivo e não toca o `authMiddleware` atual.
- Migração é metadata-only no PG (sem rewrite/lock pesado); snapshot de desconto congela faturas corretamente.

### Conclusão
Com 🔴/🟠/🟡 incorporados, o plano **funciona 100% sem impactar funções atuais**. Sem eles, ao pé da letra, **isola a listagem mas deixa IDOR + rotas públicas + colisão de CNPJ + de-para global** — inaceitável num SaaS pago. Os ajustes são conhecidos e tratáveis; o esforço real está em **tocar ~118 rotas com ownership-check** (Fase 1) e nas **2 decisões de schema** (CNPJ por rede; `de_para`/`regras_fiscais` per-tenant).

### 12.1 Decisões fechadas pós-avaliação (com o usuário)
- **§12.4 → resolvido:** `empresas` ganha `UNIQUE(cnpj, rede_id)` (cada rede tem sua linha do CNPJ). O upsert do upload casa por `(cnpj, rede_id)`.
- **§12.6 → resolvido:** `de_para_xml` e `regras_fiscais` viram **per-tenant** (coluna `rede_id`, herdada via `id_empresa` no backfill; export passa a ler o de-para/regra DA REDE). ⚠️ **O backfill desses dois é inegociável** — sem `rede_id` neles, o export regride aos valores crus do XML (memória itens 14/18/20/21). `cad_cfops`/`ncm`/`cest`/`cad_credenciadoras`/`cad_apuracao_e116`/catálogo do validador = **globais read-only** (escrita só super_admin).
- **Autocadastro → resolvido:** `/api/auth/register` **fechado**; criação de usuário só por super_admin (cria admins/redes) e admin (cria escritório da sua rede).
- Demais itens 🔴/🟠/🟡 do §12 seguem como pré-requisitos técnicos da Fase 0/1 (não dependem de decisão comercial).

**Status do plano: FECHADO e seguro para iniciar a Fase 0.**
