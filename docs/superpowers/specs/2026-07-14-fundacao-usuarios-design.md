# Fatia 1 — Fundação de Usuários (backend + schema)

> Deriva de `PLANO_CONTROLE_USUARIOS_SAAS.md` (Fase 0 parcial + provisioning §13.3 + reset-senha §12.2).
> **Branch:** `feat/controle-usuarios-saas` · **Ambiente:** localhost primeiro; deploy só após aprovação do Esmael.
> **Base já pronta:** PASSO 0 (§13.2, commit `1d41742`) já mergeado no HEAD.

## 1. Fronteiras

**Entra:** schema `usuarios`+`redes`+`auditoria_seguranca`, migração incremental idempotente + backfill,
`backend/authz.js` (enriquecer `req.user` por id + capacidades), endpoints admin de usuário, reset de senha
temporária. Testado **localmente** com backup/dump.

**Fica de fora (fatias futuras):** varredura de isolamento das ~118 rotas (`scopeRede`/ownership-check),
`requireActiveAccount`/máquina de estados, `empresas.rede_id` + dedup por `id_empresa`, billing (NÃO-GO §13.8),
`backend/modulos.js` completo, tela Vue + force-troca no login. PASSO 0 (hotfix CORS/rotas abertas) já feito.

## 2. Schema (`setup_db.js` + migração incremental)

### `redes` (mínima / tenant-only)
```
id            SERIAL PK
nome          TEXT NOT NULL
documento     TEXT
email_resp    TEXT
status        TEXT NOT NULL DEFAULT 'trial'
trial_ate     DATE
dias_carencia INTEGER NOT NULL DEFAULT 5
modulos_contratados JSONB NOT NULL DEFAULT '[]'
criado_em, atualizado_em TIMESTAMP DEFAULT now()
```
(colunas de preço/desconto/Asaas ficam para a fatia de billing — ALTER ADD COLUMN nullable depois.)

### `usuarios` (colunas adicionadas — nullable/default → metadata-only)
```
+ role     TEXT    NOT NULL DEFAULT 'escritorio'   -- super_admin | admin | staff | escritorio
+ rede_id  INTEGER REFERENCES redes(id)            -- NULL para super_admin e staff
+ modulos  JSONB   NOT NULL DEFAULT '[]'
+ ativo    BOOLEAN NOT NULL DEFAULT TRUE
+ precisa_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE
```

### `auditoria_seguranca` (trilha — §12.2/§13.7)
```
id          SERIAL PK
ator_id     INTEGER                 -- quem fez
ator_role   TEXT
acao        TEXT NOT NULL           -- 'criar_usuario' | 'desativar_usuario' | 'reset_senha'
alvo_id     INTEGER                 -- usuário afetado
detalhe     JSONB
criado_em   TIMESTAMP DEFAULT now()
```

### Migração + backfill (ordem inegociável: ADD nullable → UPDATE → travar)
1. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` (idempotente).
2. Cria rede `default` se não existir.
3. Backfill: Esmael → `role='super_admin', rede_id=NULL`; demais usuários atuais → `role='staff', rede_id=NULL`.
4. `SET NOT NULL` só em `role` e `ativo` (já têm default; `rede_id` continua nullable — super/staff têm NULL).
5. Validar num **dump local** antes de qualquer VPS.

## 3. `backend/authz.js` (novo)

- `enrichUser(req)`: a partir de `req.user.id` (do token) **re-busca do banco** `role, rede_id, ativo,
  precisa_trocar_senha` (cache ~30s, sem estourar o pool `MAX_HEAVY_OPS=5`). Nunca confia em role/rede do token
  → tokens atuais `{id,nome,email}` ficam forward-compatible.
- Capacidades ortogonais (§13.6), não hierarquia linear:
  - `canManageUsers(ator)` — super_admin (qualquer rede) ou admin (própria rede).
  - `canManageBilling(ator)` — só super_admin.
  - `isServiceToken(req)` — claim `{svc:'internal'}` (bypass de serviço; não usado nesta fatia mas reservado).
- `requireAuth` = `authMiddleware` atual + passo de enrich (exposto para as rotas admin).

## 4. Endpoints

- **`POST /api/admin/usuarios`** (substitui `/register`): **clamp server-side (§13.3)** — ignora
  `role`/`rede_id`/`modulos` do body, deriva do ator. Admin só cria `escritorio` na **própria** rede; super cria
  qualquer papel/rede; `modulos = interseção(body, rede.modulos_contratados)`. Registra em `auditoria_seguranca`.
  **Aceite:** `admin POST role=super_admin → 403`.
- **`GET /api/admin/usuarios`** — lista escopada: super/staff → todas; admin → só a própria rede.
- **`PATCH /api/admin/usuarios/:id/desativar`** — soft (`ativo=false`); admin só alvo `escritorio` da própria rede
  (igualdade estrita §13.7); nunca se auto-desativa. Auditado.
- **`POST /api/admin/usuarios/:id/reset-senha`** — gera senha temporária (bcrypt) + `precisa_trocar_senha=true`,
  devolve a temporária **uma vez**; admin só reseta `escritorio` da própria rede (igualdade estrita);
  staff/escritorio não resetam ninguém. Auditado.
- **`/api/auth/register`** → **410 Gone** apontando para `/api/admin/usuarios` (mantém compat sem escalonamento).
- **`/api/auth/login`** → passa a retornar `precisa_trocar_senha` (front usará na próxima fatia).
- **`PUT /api/auth/profile`** → ao trocar senha, zera `precisa_trocar_senha`.

## 5. Testes & ambiente

- **Local-first**: migração+backfill no banco local; validar num dump antes de VPS. Sem deploy nesta fatia.
- `backend/tests/usuarios-authz.test.js` (script node, padrão do repo) cobrindo os aceites:
  - clamp: `admin POST role=super_admin → 403`; `admin POST rede_id=<outra> → ignora/usa a própria`.
  - escopo de `GET`: admin não vê usuário de outra rede.
  - reset: `admin reset em admin-par → 403`; `admin reset em escritorio da própria rede → 200`.
  - backfill idempotente: rodar migração 2× não duplica rede default nem altera papéis.
- Suíte existente (`npm run test:validador:all` + golden export) deve continuar verde (não-regressão).

## 6. Critérios de aceite (mínimos desta fatia)

1. `admin POST /api/admin/usuarios role=super_admin` → **403**.
2. `admin` cria/lista/reseta **só** `escritorio` da **própria** rede; super faz tudo; staff/escritorio não gerenciam.
3. Backfill: Esmael=super_admin(NULL), demais atuais=staff(NULL), rede `default` criada; **idempotente**.
4. `/api/auth/register` responde 410; nenhum caminho de auto-provisionar papel elevado.
5. Suíte existente permanece verde.
