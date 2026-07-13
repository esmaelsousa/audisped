# Manual de Deploy — AudiSped (passo a passo, comando por comando)

> Guia para: **rodar os servidores locais**, **commitar**, **enviar pro GitHub**, **enviar pra VPS**, **fazer deploy** e **colocar em produção**.
> Cada comando vem com **o que ele faz** e **ONDE rodar**.

## Convenções (leia primeiro)
- **[LOCAL]** = no Terminal da **sua máquina (Mac)**, dentro da pasta do projeto.
- **[VPS]** = comando que roda **no servidor**. Aqui sempre via `ssh` (você dispara do seu Mac, mas ele executa lá).
- Pasta do projeto no seu Mac: `/Users/esmael/meus_sistemas/audisped`
- Servidor (VPS): `root@187.127.5.210` · chave SSH: `~/.ssh/audisped_vps` · pasta: `/opt/audisped`

> ⚠️ **`git push` NÃO faz deploy.** Enviar pro GitHub e colocar na VPS são **dois passos separados**. A produção só muda quando você roda os comandos da **Parte 5**.

---

## PARTE 1 — Rodar os servidores LOCAIS (desenvolvimento)

O sistema local tem **dois servidores**: o **backend** (Node, porta 15435) e o **frontend** (Vite, porta 5173). Precisa dos dois no ar. Use **dois terminais** (ou duas abas).

### 1.1 Backend  **[LOCAL]**
```bash
cd /Users/esmael/meus_sistemas/audisped/backend   # entra na pasta do backend
node server.js                                     # sobe o servidor da API
```
- Sobe em `http://localhost:15435`. Quando aparecer **"Servidor AudiSped online"** e **"Regras fiscais prontas"**, está pronto.
- Deixe esse terminal **aberto** (fechar = derruba o backend). Para parar: `Ctrl + C`.

### 1.2 Frontend  **[LOCAL]** (outro terminal)
```bash
cd /Users/esmael/meus_sistemas/audisped/frontend   # entra na pasta do frontend
npm run dev                                         # sobe o Vite (tela do sistema)
```
- Sobe em `http://localhost:5173`. Abra esse endereço no navegador.
- Para parar: `Ctrl + C`.

### 1.3 Conferir / parar (se precisar)  **[LOCAL]**
```bash
lsof -ti tcp:15435    # mostra o PID do backend (vazio = parado)
lsof -ti tcp:5173     # mostra o PID do frontend (vazio = parado)

# parar à força (se travou):
lsof -ti tcp:15435 | xargs kill -9     # mata o backend
lsof -ti tcp:5173  | xargs kill -9     # mata o frontend
```
> Dica: sempre abra **http://localhost:5173** (é o servidor de desenvolvimento, com recarga automática). Evite 4173/5180 — são versões antigas/paralelas.

---

## PARTE 2 — Commitar (salvar o trabalho no git local)  **[LOCAL]**

```bash
cd /Users/esmael/meus_sistemas/audisped   # SEMPRE na raiz do projeto pra comandos git

git status                                # mostra o que mudou/foi criado (nada foi salvo ainda)
git diff                                  # (opcional) vê as mudanças linha a linha
```
- `git status`: lista arquivos **modificados** (M) e **novos** (??). É seu "raio-x" antes de salvar.

```bash
git add -A                                # marca TUDO que mudou para o commit
# ou, para escolher arquivos específicos:
git add caminho/arquivo1 caminho/arquivo2
```
- `git add`: escolhe **o que** entra no commit (chamado "staging").

```bash
git commit -m "feat: descricao curta do que voce fez"
```
- `git commit`: **salva** um ponto na história do projeto (só no seu Mac ainda). O texto do `-m` descreve a mudança.

```bash
git log --oneline -5                      # confere os últimos 5 commits (o seu deve estar no topo)
```

---

## PARTE 3 — Enviar pro GitHub (backup/nuvem)  **[LOCAL]**

```bash
git push                                  # envia os commits da branch atual pro GitHub
```
- `git push`: sobe seus commits para o repositório remoto (`origin` = github.com/esmaelsousa/audisped). Serve de **backup e compartilhamento**. **Não** toca a VPS.

> **Se for uma branch nova** (primeira vez), o git pede pra definir o "upstream":
> ```bash
> git push -u origin NOME-DA-BRANCH        # ex.: git push -u origin feat/minha-feature
> ```

---

## PARTE 4 — (opcional) Levar pro `main`  **[LOCAL]**

O `main` é o branch "oficial". Só leve pra lá quando o trabalho estiver testado.

```bash
git status -sb                            # confere a branch atual
git fetch origin                          # atualiza as referências do remoto
git log --oneline origin/main..HEAD       # mostra os commits que faltam entrar no main

# leva a branch atual pro main no GitHub (fast-forward, quando não há divergência):
git push origin SUA-BRANCH:main           # ex.: git push origin feat/redesign-validador:main
git branch -f main origin/main            # sincroniza o 'main' local com o remoto
```
- Se der erro de "non-fast-forward" (divergência), pare e me chame — aí precisa de merge com cuidado.

---

## PARTE 5 — DEPLOY na VPS (colocar em PRODUÇÃO) 🚀

> A pasta `/opt/audisped` **não é um repositório git** — o deploy é por **cópia do código** (não `git pull`).
> Método **seguro** (o que usamos): empacota só o código commitado com `git archive`, envia e extrai por cima, **sem tocar** o `.env`/uploads/certificados de produção. Depois rebuilda o Docker.

### Passo 5.0 — BACKUP (SEMPRE antes de qualquer deploy)  **[VPS via ssh]**
```bash
# Backup do BANCO (pg_dump comprimido):
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 \
  'docker exec audisped-db pg_dump -U postgres -d audisped_db --no-owner --no-acl | gzip -c > /opt/audisped/backups/db_$(date +%F_%H%M%S).sql.gz && ls -lh /opt/audisped/backups/db_*.sql.gz | tail -1'

# Backup do CÓDIGO atual da VPS (para rollback rápido):
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 \
  'cd /opt/audisped && tar czf backups/code_$(date +%F_%H%M%S).tgz --exclude=node_modules --exclude=dist backend frontend && ls -lh backups/code_*.tgz | tail -1'
```
- O 1º salva os **dados** (se algo der errado, você restaura). O 2º salva o **código antigo** (para voltar atrás).

### Passo 5.1 — Empacotar o código commitado  **[LOCAL]**
```bash
cd /Users/esmael/meus_sistemas/audisped
git archive --format=tar.gz -o /tmp/audisped_deploy.tgz HEAD backend frontend
```
- `git archive HEAD backend frontend`: cria um pacote com **exatamente o código commitado** do backend e frontend. Como `.env` e `node_modules` são "gitignored", eles **não entram** — é isso que torna o método seguro.

### Passo 5.2 — Verificar o pacote (segurança)  **[LOCAL]**
```bash
tar tzf /tmp/audisped_deploy.tgz | grep -E '\.env|node_modules'
```
- **O que esperar:** só pode aparecer `backend/.env.production.example` (um template sem segredos). Se aparecer um `.env` "puro" ou `node_modules`, **PARE** — não envie.

### Passo 5.3 — Enviar o pacote pra VPS  **[LOCAL]**
```bash
scp -i ~/.ssh/audisped_vps /tmp/audisped_deploy.tgz root@187.127.5.210:/opt/audisped/
```
- `scp`: copia o arquivo do seu Mac para a pasta `/opt/audisped` da VPS.

### Passo 5.4 — Extrair na VPS + PROVAR que o `.env` ficou intacto  **[VPS via ssh]**
```bash
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 '
  cd /opt/audisped
  ANTES=$(md5sum backend/.env | cut -d" " -f1)     # impressão digital do .env de produção
  tar xzf audisped_deploy.tgz                       # extrai o código novo por cima
  DEPOIS=$(md5sum backend/.env | cut -d" " -f1)
  [ "$ANTES" = "$DEPOIS" ] && echo "OK: .env de producao INTACTO" || echo "PERIGO: .env mudou!"
  rm -f audisped_deploy.tgz
'
```
- Extrair **não apaga** o `.env`, uploads nem certificados (eles não estão no pacote). Os dois `md5sum` **iguais** = prova de que a produção não foi mexida.

### Passo 5.5 — Rebuild + subir (aqui vai AO AR)  **[VPS via ssh]**
```bash
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 \
  'cd /opt/audisped && docker compose -f docker-compose.prod.yml up -d --build'
```
- `docker compose up -d --build`: **reconstrói** as imagens do backend e frontend com o código novo e **substitui** os containers.
- **Segurança:** se o build falhar, os containers **antigos continuam rodando** (sem tirar o ar). Só troca se o build der certo.

### Passo 5.6 — Verificar o deploy  **[VPS via ssh]**
```bash
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 '
  docker compose -f docker-compose.prod.yml ps                         # containers: devem estar Up / db healthy
  docker inspect -f "restart count: {{.RestartCount}}" audisped-backend # deve ser 0 (sem crash-loop)
  docker logs audisped-backend 2>&1 | tail -5                          # deve ter "Servidor AudiSped online"
  echo "frontend: $(curl -s -o /dev/null -w %{http_code} http://localhost/)"          # 200
  echo "login inválido: $(curl -s -o /dev/null -w %{http_code} -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"x@x.com\",\"senha\":\"z\"}")"  # 401
'
```
- **Esperado:** containers `Up`, `db healthy`, restart count `0`, backend "online", frontend `200`, login inválido `401` (e **não** 500).

### Passo 5.7 — Teste final no navegador  **[você]**
Abra **http://187.127.5.210** → faça login → use uma tela real (ex.: Validador). Só você confirma o fluxo com seu login.

---

## PARTE 6 — ROLLBACK (voltar atrás se der problema)  **[VPS via ssh]**

```bash
# 1) Voltar o CÓDIGO para a versão anterior (use o code_<data>.tgz mais recente ANTES do deploy):
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 \
  'cd /opt/audisped && ls -t backups/code_*.tgz | head -3'          # ver os backups de código

ssh -i ~/.ssh/audisped_vps root@187.127.5.210 \
  'cd /opt/audisped && tar xzf backups/code_AAAA-MM-DD_HHMMSS.tgz && docker compose -f docker-compose.prod.yml up -d --build'

# 2) (só se o BANCO foi corrompido) restaurar o dump:
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 \
  'zcat /opt/audisped/backups/db_AAAA-MM-DD_HHMMSS.sql.gz | docker exec -i audisped-db psql -U postgres -d audisped_db'
```
> Troque `AAAA-MM-DD_HHMMSS` pelo nome real do backup. Restaurar banco é raro — só se houve mudança de dados que quebrou.

---

## PARTE 7 — Ligar HTTPS (quando tiver domínio) — futuro  **[VPS via ssh]**
1. Aponte um registro **A** do domínio (ex.: `app.seudominio.com.br`) para `187.127.5.210`.
2. No `/opt/audisped/Caddyfile`, troque o bloco `:80 { ... }` pelo bloco com o nome do domínio (há modelo comentado no arquivo).
3. `docker compose -f docker-compose.prod.yml restart caddy` — o Caddy provisiona o certificado Let's Encrypt sozinho.

---

## Apêndice — Comandos úteis de diagnóstico  **[VPS via ssh]**
```bash
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 'docker compose -f /opt/audisped/docker-compose.prod.yml ps'      # status
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 'docker logs -f audisped-backend'                                 # logs do backend ao vivo (Ctrl+C sai)
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 'df -h / | tail -1'                                               # espaço em disco
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 'ls -lht /opt/audisped/backups | head'                            # backups existentes
```

---

## Resumo do fluxo completo (a receita)
1. Desenvolve local (Parte 1) → 2. `git add`/`commit` (Parte 2) → 3. `git push` (Parte 3) → 4. leva pro `main` (Parte 4) →
5. **Backup** (5.0) → empacota (5.1) → **verifica** (5.2) → envia (5.3) → extrai provando .env intacto (5.4) → **rebuild** (5.5) → verifica (5.6) → testa no navegador (5.7).
Deu ruim? **Parte 6 (rollback)**.
