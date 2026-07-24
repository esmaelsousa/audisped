# Fase 2 — Console Super Admin (Onboarding de Redes) — Implementation Plan

**Goal:** Dar ao super_admin uma TELA pra onboardar cliente sem SQL: criar/editar **rede**, ver **contador de postos** por rede, **associar/mover postos (CNPJs/empresas)** a uma rede, e **criar o usuário admin** da rede.

**Architecture:** Reusa o que já existe: tabela `redes` (nome/documento/email_resp/status/...), `POST /api/admin/usuarios` (criar admin com clamp de rede via authz.js), e o padrão de rota admin (`authMiddleware`+`enrich`, checagem `super_admin`). Frontend: nova view no padrão da `UsuariosView.vue`. **Toda rota nova é registrada no `routeScopeRegistry.js`** (variante `self` = admin-only, não escopada por rede) pra manter o teste de cobertura default-deny verde.

**Tech Stack:** Node/Express (backend/server.js), Postgres (pg), Vue 3 (frontend), testes `node` puros com assert.

## Global Constraints
- **Localhost-first:** implementar e TESTAR em localhost; NADA vai a git/prod sem OK do Esmael.
- Backend local `node server.js` porta 15435 (sem nodemon) → reiniciar após mudança.
- **Rotas novas `/api/*` DEVEM entrar em `backend/routeScopeRegistry.js`** (senão `scoperede-cobertura.test.js` falha). Variante `self` p/ rotas super_admin-only (guardadas por checagem de papel, não por rede).
- **super_admin only:** todos os endpoints do Console exigem `req.ator.role === 'super_admin'` (staff NÃO gerencia redes). Retorno 403 caso contrário.
- Não regredir: `scoperede-cobertura`, `scoperede-unit`, `scoperede-integracao`, `validador-suite` (218) verdes.

---

## Task 1: Backend — CRUD de redes + contador de postos

**Files:** Modify `backend/server.js` (endpoints), `backend/routeScopeRegistry.js` (registrar rotas). Test: `backend/tests/redes-endpoints.test.js`.

**Endpoints (todos `authMiddleware, enrich` + guard `super_admin`):**
- `GET /api/admin/redes` (JÁ existe) → **estender** para retornar, por rede: `id, nome, documento, email_resp, status, criado_em` + `postos` (COUNT de empresas WHERE rede_id) + `usuarios` (COUNT usuarios WHERE rede_id).
- `POST /api/admin/redes` → cria rede `{ nome (obrigatório), documento, email_resp, status='ativa' }` → 201 com a rede.
- `PUT /api/admin/redes/:id` → edita `{ nome, documento, email_resp, status }`.
- `DELETE /api/admin/redes/:id` → só apaga se a rede **não tiver** postos nem usuários (senão 409 "rede tem postos/usuários vinculados"); nunca apaga a rede `default`.

- [ ] **Step 1: Teste (falha primeiro)** — `backend/tests/redes-endpoints.test.js`: sobe helpers ou testa as funções; cobre: criar rede (201), listar com contador, editar, DELETE bloqueado se tem posto (409), DELETE ok se vazia, e **não-super → 403** em todos. (seguir o estilo de `usuarios-endpoints.test.js`).
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar os 4 endpoints em server.js** (guard: `if (req.ator?.role !== 'super_admin') return res.status(403)...`). SQL parametrizado. GET com `LEFT JOIN LATERAL`/subselect pra contar postos/usuários.
- [ ] **Step 4: Registrar as rotas novas em `routeScopeRegistry.js`** (variante `self`) e rodar `scoperede-cobertura.test.js` até verde.
- [ ] **Step 5: Rodar redes-endpoints + cobertura + validador (218). NÃO commitar.**

## Task 2: Backend — associar/mover posto (empresa) a uma rede

**Files:** Modify `backend/server.js`, `backend/routeScopeRegistry.js`. Test: adicionar casos em `redes-endpoints.test.js`.

**Endpoints (super_admin only):**
- `PATCH /api/admin/empresas/:id/rede` → body `{ rede_id }` → valida que a rede existe → `UPDATE empresas SET rede_id=$1 WHERE id=$2`. Retorna a empresa atualizada. (move 1 posto.)
- `POST /api/admin/redes/:id/empresas` → body `{ ids: [empresaId...] }` → move VÁRIOS postos pra a rede de uma vez (atômico). Valida rede existe; ignora ids inexistentes ou reporta.

- [ ] **Step 1: Teste** — mover empresa pra rede B; confirmar no banco; mover em lote; rede inexistente → 400; não-super → 403.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar** os 2 endpoints (guard super_admin, SQL parametrizado, validação de rede).
- [ ] **Step 4: Registrar no routeScopeRegistry (`self`)** + cobertura verde.
- [ ] **Step 5: Rodar tudo verde. NÃO commitar.**

## Task 3: Frontend — Console de Redes (view + sidebar)

**Files:** Create `frontend/src/views/RedesView.vue`. Modify `frontend/src/router` (rota `/admin/redes`, guard super_admin), `frontend/src/components/shell/AppSidebar.vue` (item "Administração › Redes", só super).

**RedesView.vue:**
- Lista de redes (tabela): nome, documento, status, **nº de postos**, **nº de usuários**, ações.
- Botão "Nova rede" → modal (nome, documento, e-mail, status) → `POST /api/admin/redes`.
- Editar rede (modal) → `PUT`.
- Numa rede: painel de **postos** — lista os postos da rede + campo pra **associar** posto (buscar empresa por CNPJ/nome via `/api/empresas?busca=` e mover via `PATCH /api/admin/empresas/:id/rede`), e remover (mover de volta pra default).
- Atalho "Criar admin da rede" → reusa o fluxo de `POST /api/admin/usuarios` (role `admin`, `rede_id` = a rede) — pode linkar pra UsuariosView pré-preenchido ou modal inline.

- [ ] **Step 1: Criar RedesView.vue** (padrão visual da UsuariosView — Tailwind, UiButton, lucide icons).
- [ ] **Step 2: Rota `/admin/redes`** com guard `isSuper` no router; **item no AppSidebar** só quando `isSuper`.
- [ ] **Step 3: Build do frontend (`npm run build`) verde.**
- [ ] **Step 4: Smoke manual** (super_admin cria rede, associa posto, cria admin). NÃO commitar.

## Critérios de aceite
1. super_admin cria uma rede pela tela; ela aparece na lista com contador de postos = 0.
2. Associa um posto (empresa) à rede → contador vira 1; o posto some da rede default.
3. Cria um usuário `admin` da rede pela tela.
4. Esse admin loga e vê **só os postos da rede dele** (isolamento da Fase 1 — já validado).
5. Não-super_admin recebe 403 nos endpoints do Console e não vê o item no menu.
6. `scoperede-cobertura` verde (rotas novas registradas), `validador-suite` 218 verde.

## Fora de escopo (v1)
- Faturas/billing (NÃO-GO §13.8). Gestão fina de módulos contratados e trial/carência (Fase 2b). Auto-provisioning.
