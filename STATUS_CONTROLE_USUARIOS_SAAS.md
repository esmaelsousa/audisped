# STATUS — Controle de Usuários, Multi-inquilino e Cobrança (SaaS)

**Atualizado:** 2026-07-19
**Blueprint:** `PLANO_CONTROLE_USUARIOS_SAAS.md` (6 fases, 0–5)
**Estado geral:** 🟡 **Single-tenant seguro** — base de usuários pronta e em produção; **falta a Fase 1 (isolamento por rede)** para virar multi-inquilino com cliente pagante.

> ⚠️ **Regra de ouro (do próprio plano, §8):** sem o isolamento no backend (Fase 1), o multi-inquilino é "teatro de segurança". **NÃO liberar acesso a cliente externo (admin/escritório de rede) antes da Fase 1.** Hoje o sistema é usado com segurança apenas pelo time interno.

---

## Placar por fase

| Fase | Entrega | Status |
|---|---|---|
| **0 — Modelo + migração** | tabelas + colunas + backfill | 🟡 **Parcial** |
| **1 — Isolamento + estados (backend)** | `scopeRede` em todas as rotas, `requireActiveAccount`, transições | 🔴 **Não feito (o núcleo)** |
| **2 — Console Super Admin** | CRUD redes/CNPJs, contador de CNPJs, faturas manuais | 🔴 **Não feito** |
| **3 — Admin do cliente** | gerenciar usuários + distribuir módulos | 🟡 **Parcial** |
| **4 — Front gating + Portal Financeiro** | gating por papel/módulo + Portal de faturas | 🟡 **Parcial** |
| **5 — Automação Asaas** | assinatura/webhook/PIX/NFS-e | 🔴 **Não feito** |

---

## ✅ O que JÁ foi feito (implementado e em produção)

### Fundação de usuários (Fatias 1–3 — deployadas em prod 2026-07-14)
- **Schema** (`backend/setup_db.js` + `backend/migrations/2026-07-14-usuarios-saas.js`):
  - Tabelas `redes` (mínima), `auditoria_seguranca`.
  - Colunas em `usuarios`: `role`, `rede_id`, `modulos` (jsonb), `ativo`, `precisa_trocar_senha` + CHECK de papel válido.
  - Backfill: Esmael → `super_admin`; demais → `staff`; rede `default` criada.
- **Autorização** (`backend/authz.js`) — capacidades ortogonais, funções puras testáveis:
  - `canManageUsers` (super/admin), `canManageBilling` (só super).
  - `resolverCamposNovoUsuario` (clamp server-side §13.3), `podeGerenciarAlvo` (§13.7).
  - `enrich(pool)` — re-busca role/rede do banco por id (cache 30s), sem confiar no token.
  - Papéis: `super_admin | admin | staff | escritorio | demo`.
- **Endpoints de usuários** (admin/super):
  - `POST/GET /api/admin/usuarios`, `PATCH .../:id/{ativar,desativar}`, `POST .../:id/reset-senha`.
  - `/api/auth/register` → **410** (cadastro público fechado).
  - `login` devolve `precisa_trocar_senha` + `role`; `/api/auth/me` enriquecido; `profile` inclui `role` (senão o gating quebra).
- **Telas (Vue)**: `UsuariosView.vue` (rota `/usuarios`, guard super/admin), `TrocarSenhaView.vue` (força-troca no 1º login), gating de sidebar por papel (`isSuper`, `podeGerenciarUsuarios`).
- **Testes** (verdes): `usuarios-authz` (18), `migracao-usuarios-saas` (7), `usuarios-endpoints` (15).

### Auto-serviço de senha (Fatia 3 — deployada 2026-07-14)
- Tabela `password_reset_tokens` + `mailService.js` (Resend via REST).
- `POST /api/auth/forgot-password` (rate-limit, anti-enumeração) e `POST /api/auth/reset-password`.
- Telas `EsqueciSenhaView.vue` + `RedefinirSenhaView.vue` (rotas públicas).
- ⚠️ **Falta só a chave**: `RESEND_API_KEY` em produção (sem ela, o link é só logado, não enviado).

### PASSO 0 — Hotfix de segurança (§13.2)
- `authMiddleware` nas rotas antes abertas + `register` fechado + login/register respondendo 401/410.

### Extras desta sessão (2026-07-18/19)
- **Role `demo`** (`backend/migrations/2026-07-18-role-demo.js`) + `demoPaywall` — usada no ambiente de demonstração (`demo.audisped.com.br`), sem capacidades de gestão. Ver `DEMO_SETUP.md`.
- **Captura de leads + tela Leads** (admin): landing → `POST /api/demo-lead` grava em `demo_leads` + libera credenciais demo; `GET /api/admin/demo-leads` lista.
- **Gestão de leads (deploy prod 2026-07-19)**: coluna `notas` de acompanhamento (salva ao sair do campo), `PATCH` e `DELETE /api/admin/demo-leads/:id`, botões de nota e excluir em `LeadsView.vue`.

---

## 🔴 O que FALTA (e por que importa)

### Fase 1 — Isolamento por rede (o bloqueio para cliente pagante)
- `scopeRede` e `requireActiveAccount`: **0 usos** em `backend/server.js`. As ~118 rotas de dados **não filtram por `rede_id`** → um cliente externo veria/mexeria em dados de outro (IDOR entre inquilinos).
- Ownership-check em 3 variantes (§13.5) e `rede_id` nas tabelas cnpj-keyed.
- Máquina de estados de acesso (`ativa/suspensa/cancelada`) com toggle manual.
- **Pré-requisitos técnicos (§13.1–13.6)** antes de expor multi-tenant: `regras_fiscais` fora do per-tenant; dedup por `id_empresa` + `UNIQUE`/`ON CONFLICT`; clamp de provisioning; contradições reconciliadas.

### Fase 0 — Resto do modelo
- Tabelas `faturas` e `usuario_empresas`: **não existem**.
- Colunas `rede_id` e `status` em `empresas`: **não existem** (empresas ainda é global, sem dono/rede).

### Fase 2 — Console Super Admin
- CRUD de redes/CNPJs, **contador de CNPJs ativos** (base de cobrança) e faturas manuais: **não existem** (só há um `GET /api/admin/redes` de leitura).

### Fase 3 — Resto
- Admin do cliente **distribuir módulos** (⊆ contratado) ao escritório da rede: **não feito** (o CRUD de usuários existe; a distribuição de módulos não).

### Fase 4 — Portal Financeiro
- `PortalFinanceiroView.vue` + guard que redireciona conta `suspensa`: **não existe**.

### Fase 5 — Automação Asaas
- Assinatura/customer por rede, webhook `PAYMENT_CONFIRMED` → transição, checkout PIX/cartão, NFS-e, régua de cobrança: **não iniciado**. Billing em **NÃO-GO** até a auditoria §13.8.

---

## 🎯 Próximo passo recomendado

Implementar a **Fase 1 (isolamento por rede)** — é o que torna o produto **seguro o suficiente para o primeiro cliente pagante**. Ordem do plano (§13.9): Fase 0 (completar modelo) → **Fase 1 (isolamento)** → Fase 2/3 → Fase 4 → Fase 5.

O esforço real está em **tocar ~118 rotas com ownership-check** e nas 2 decisões de schema (CNPJ por rede; per-tenant vs global). Até a Fase 4 já é um **SaaS vendável** com gestão manual; a Fase 5 só liga o piloto automático.
