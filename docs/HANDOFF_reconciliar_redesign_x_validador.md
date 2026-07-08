# Handoff — Reconciliar o REDESIGN (produção) com o VALIDADOR (localhost)

> Documento de contexto + plano de ação para o agente que vai corrigir a divergência
> entre o localhost e a produção (VPS). **Leia tudo antes de rodar qualquer comando.**
> Data do diagnóstico: 2026-07-08.

---

## 1. TL;DR — o que aconteceu

Não houve perda de dados nem bug. O que houve foi **branches paralelos + deploy de um branch diferente do que está aberto no localhost**:

1. O `feat/validador-sped` foi desenvolvido até **16/jun** (HEAD `ff734d9`).
2. A partir dele foi criado o `feat/redesign-ui`, que recebeu **9 commits só de frontend** (novo visual "padrão Aferição": casca, sidebar, topbar, todas as views migradas), terminando **23/jun** (HEAD `e95c4e3`).
3. **O deploy na VPS (23/jun) foi feito a partir do `feat/redesign-ui`.** Portanto **produção = redesign** (visual novo).
4. No diretório de trabalho principal você voltou para o `feat/validador-sped` (visual **antigo**, HEAD de 16/jun) e continuou trabalhando — hoje com **35 arquivos não-commitados** (a maior parte é backend do validador). O redesign ficou isolado no worktree `.worktrees/redesign-ui`.

**Resultado:** localhost mostra o visual **antigo**; a VPS mostra o **redesign**. Por isso parecem "totalmente diferentes".

---

## 2. Evidências (ground truth — verificado)

### Produção = `feat/redesign-ui` (confirmado por md5, byte-a-byte)

| Arquivo | Produção (VPS `/opt/audisped/frontend/src`) | `feat/redesign-ui` | `feat/validador-sped` (localhost atual) |
|---|---|---|---|
| `App.vue` | `12bdef698cbdf840abd1e3bf8ddbc4f9` | ✅ igual | ❌ `5dc921b861a1d51856ed467cc7b7abc4` |
| `views/AnalisadorView.vue` | `2c9f429808b729dab1d33e34c56dba8c` | ✅ igual | ❌ `740854cb68034daf5222c21aef30157a` |
| `views/LoginView.vue` | `b5c96d00f6c52e5d63ce4e0936cbd3a6` | ✅ igual | ❌ `22da7bba6284fb3c6bb686e00d82bd86` |
| `views/ValidadorView.vue` | `9e5ef4778836899b0eca2e8ec01097b3` | ✅ igual | ❌ `bcc525f65f1d16a3b1d5b6535b682988` |
| `main.js` / `router/index.js` | iguais nos dois | ✅ | ✅ (não mudaram) |

### Infra / datas

- VPS: `srv1776566` / IP `187.127.5.210` / SSH `~/.ssh/audisped_vps` / projeto em **`/opt/audisped`** (deploy por **cópia de arquivos, SEM `.git`** — por isso o histórico "sumia").
- Containers (Docker) buildados **23/jun 19:39** (`Up 2 weeks`): `audisped-frontend`, `audisped-backend`, `audisped-caddy`, `audisped-db` (postgres 16, healthy). Dump do banco: `/opt/audisped/audisped.dump` (23/jun). Backups em `/opt/audisped/backups`.
- Fontes do frontend em produção: mtime **23/jun 18:56** (bate com o redesign).

### Relação entre os branches

- `git rev-list --left-right --count feat/validador-sped...feat/redesign-ui` → **`0  9`**.
  Ou seja: **`feat/redesign-ui` CONTÉM 100% do `feat/validador-sped` (até 16/jun) + 9 commits.** Produção não perdeu nada do validador **que estava commitado** até 16/jun.

### O redesign é FRONTEND-ONLY (chave da estratégia)

`git diff --stat feat/validador-sped..feat/redesign-ui` → **32 arquivos, todos em `frontend/`**. Zero arquivo de `backend/`. Os 9 commits:

```
e95c4e3 feat(redesign): reconstrói menu lateral completo no padrão Aferição
6e253e0 feat(redesign): migra todas as views e componentes p/ design system Aferição
db8799d fix(redesign): achados da revisao (origem/gauge, breakpoint, login, DRY)
7611391 feat(redesign): AnalisadorView adota o sistema Afericao nos resultados
4701859 feat(redesign): LoginView no sistema Afericao
00134b3 feat(redesign): componentes do Analisador (regua, totalizador, cobertura, ocorrencias)
ad17293 feat(redesign): casca Aferição (sidebar, topbar, App.vue responsivo)
92fce4e fix(redesign): aliasa tokens antigos p/ nao quebrar telas nao migradas
c3b264f feat(redesign): tokens e fontes do sistema Aferição
```

---

## 3. Os 35 arquivos não-commitados no localhost (só existem na sua máquina)

Estão no worktree principal (`/Users/esmael/meus_sistemas/audisped`), sobre o `feat/validador-sped`. **Não estão em nenhum branch nem na produção.** Categorizados:

### A) Backend do VALIDADOR — trabalho real, valioso, NÃO está em produção → **merge LIMPO** (redesign não toca backend)
- Modificados: `backend/services/validador/correcoes.js`, `backend/services/validador/engine.js`, `backend/services/validador/rules/index.js`, `backend/tests/validador-suite.js`, `backend/package.json`, `backend/.dockerignore`, `backend/Dockerfile`
- Novos: `backend/services/importador5929Service.js`, `backend/services/validador/money.js`, `backend/tests/eauditoria-repro.js`
- **10 regras novas:** `r_0206_sem_1300.js`, `r_0400_codnat_cfop.js`, `r_9900_regblc.js`, `r_c100_5929.js`, `r_c100_vl_doc.js`, `r_c170_cod_cta.js`, `r_c170_icms_sem_base.js`, `r_c190_icms_sem_base.js`, `r_c190_red_bc.js`, `r_c190_vl_icms.js` (todos em `backend/services/validador/rules/`)

### B) Frontend — ⚠️ **ZONA DE CONFLITO**
- `frontend/src/views/AnalisadorView.vue`, `frontend/src/views/InjetorXmlView.vue`, `frontend/src/views/ProfileView.vue`
- **São exatamente 3 arquivos que o redesign TAMBÉM reescreveu pesado** (AnalisadorView mudou ~1565 linhas, InjetorXmlView ~444, ProfileView ~184). Suas edições foram feitas na versão ANTIGA. Copiar cru por cima do redesign **apagaria o redesign nessas 3 telas.** → exige merge 3-vias manual.
- `frontend/Dockerfile`, `frontend/nginx.conf` (o redesign NÃO tocou nesses → sem conflito).

### C) Infra / deploy (provavelmente criados na migração de 22–23/jun; a VPS já tem versões funcionando)
- `.env.production.example`, `backend/.env.production.example`, `Caddyfile`, `docker-compose.prod.yml`, `frontend/nginx.conf`
- ⚠️ Conferir contra `/opt/audisped/{docker-compose.prod.yml,Caddyfile}` antes de assumir que são idênticos (podem ter sido editados à mão no servidor).

### D) Docs / planos (sem risco)
- `DIAGRAMAS_SAAS.md`, `PLANO_CONTROLE_USUARIOS_SAAS.md`, `PLANO_INJETAR_XML_SAIDA.md`, `PLANO_INJETOR_XML_CONTRIBUICOES.md`, `PLANO_VALIDADOR_CONTRIBUICOES.md`, `docs/`

> **Consequência importante:** produção roda o backend do validador **como estava em 16/jun** — está **SEM** as 10 regras novas, o `importador5929Service.js`, o `money.js` e os ajustes de `correcoes.js`/`engine.js`. Depois de reconciliar, um redeploy leva essas melhorias para a VPS.

---

## 4. Objetivo da correção

Um **único branch** que tenha, ao mesmo tempo:
- o **redesign** (frontend, igual à produção), e
- **todo o backend do validador** (incluindo os 35 arquivos não-commitados),

para que o **localhost fique igual à produção no visual** e ainda por cima **à frente** no validador. Depois (opcional) redeployar para a VPS ganhar as regras novas.

---

## 5. PLANO DE AÇÃO (passo a passo, seguro)

> Rodar tudo a partir do worktree principal: `/Users/esmael/meus_sistemas/audisped`.
> **Nunca** apagar o worktree `.worktrees/redesign-ui` — ele é o espelho da produção.

### Passo 0 — Rede de segurança (NÃO PULAR)
```bash
cd /Users/esmael/meus_sistemas/audisped
git status                      # confirmar os 35 arquivos
git add -A
git commit -m "wip(validador): backend (10 regras, importador5929, money) + edits nas 3 views + infra/docs"
git branch backup/validador-wip-2026-07-08   # ponto de restauração imutável
git log -1 --format="%H %s"     # anotar o hash do WIP
```
Agora `git status` deve estar limpo. Nada mais pode ser perdido.

### Passo 1 — Branch de integração a partir do redesign (= produção)
```bash
# NÃO dá pra 'git checkout feat/redesign-ui' aqui (já está no worktree .worktrees/redesign-ui).
# Cria um branch novo a partir dele — permitido:
git switch -c feat/redesign+validador feat/redesign-ui
```

### Passo 2 — Trazer o validador para dentro do redesign
```bash
git merge feat/validador-sped --no-ff -m "merge: validador (backend + 3 views) sobre o redesign"
```
Esperado: **conflito APENAS em 3 arquivos** — `frontend/src/views/AnalisadorView.vue`, `InjetorXmlView.vue`, `ProfileView.vue`. Todo o backend (regras, `importador5929`, `money.js`, `correcoes.js`, `engine.js`, testes) entra **sem conflito**, assim como `frontend/Dockerfile` e `frontend/nginx.conf`.

### Passo 3 — Resolver os 3 conflitos de view (merge 3-vias manual)
Para **cada** um dos 3 arquivos:
1. **Base = versão do REDESIGN** (o layout novo é o que vale visualmente).
2. Descobrir a intenção funcional das suas edições antigas:
   ```bash
   git diff ff734d9 backup/validador-wip-2026-07-08 -- frontend/src/views/AnalisadorView.vue
   ```
   (esse diff é exatamente o que você mudou na versão antiga.)
3. **Reaplicar só o comportamento** (lógica/handlers/campos) sobre a estrutura redesenhada — não colar o HTML antigo por cima.
4. ⚠️ Antes de reaplicar, checar se o redesign **já incorporou** aquela mudança (ele reescreveu essas views em 23/jun e pode já conter tweaks anteriores). Se já tiver, descartar o delta.
5. `git add <arquivo>` conforme resolve. Ao terminar os 3: `git commit`.

### Passo 4 — Verificação (obrigatória antes de dizer "pronto")
```bash
# Backend: a suíte do validador tem que passar
cd backend && node tests/validador-suite.js     # esperado: suíte verde (ex.: 64/64)
node --check services/validador/rules/index.js  # regras carregam
cd ..
# Frontend: builda e sobe
cd frontend && npm install && npm run build      # sem erro de compilação
```
Depois subir o dev (backend + frontend) e **conferir visualmente que o localhost está igual à produção** (sidebar/topbar padrão Aferição) **e** que o Analisador/Validador continua funcionando com as regras novas.

### Passo 5 — Deploy opcional (leva as regras novas + confirma paridade)
Só depois de tudo verde. Os artefatos de deploy já existem na VPS (`/opt/audisped/docker-compose.prod.yml`, `Caddyfile`, `backup.sh`). Rebuildar as imagens a partir do `feat/redesign+validador` e publicar. **Fazer backup do banco antes** (`/opt/audisped/backup.sh` já existe; o dump de 23/jun está em `/opt/audisped/audisped.dump`).

---

## 6. Guardrails — o que NÃO fazer
- ❌ **NÃO** rodar `git checkout .` / `git stash drop` / `git reset --hard` antes do Passo 0 (perde os 35 arquivos).
- ❌ **NÃO** apagar `.worktrees/redesign-ui` (é o espelho fiel da produção; referência para o merge).
- ❌ **NÃO** copiar `AnalisadorView.vue`/`InjetorXmlView.vue`/`ProfileView.vue` do branch antigo por cima do redesign — apaga o visual novo dessas telas.
- ❌ **NÃO** redeployar antes da suíte do validador passar e do build do frontend fechar.
- ❌ **NÃO** assumir que os arquivos de infra locais == VPS; comparar antes.

## 7. Restaurar se algo der errado
```bash
git merge --abort                         # cancela o merge em andamento
git switch feat/validador-sped            # volta pro estado com seu WIP commitado
# tudo continua salvo em: backup/validador-wip-2026-07-08
```

## 8. Apêndice — comandos de verificação usados no diagnóstico
```bash
# md5 em produção:
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 \
  'for f in App.vue main.js router/index.js views/AnalisadorView.vue views/LoginView.vue views/ValidadorView.vue; do md5sum /opt/audisped/frontend/src/$f; done'
# md5 local (comparar com cada worktree):
for f in App.vue main.js router/index.js views/AnalisadorView.vue views/LoginView.vue views/ValidadorView.vue; do md5 -q "frontend/src/$f"; done
```
