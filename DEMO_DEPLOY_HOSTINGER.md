# Deploy do Ambiente Demo na Hostinger — Passo a Passo

Manual detalhado para subir o `demo.audisped.com.br` na sua VPS (Docker + Caddy).
Complementa o [DEMO_SETUP.md](DEMO_SETUP.md) com os comandos exatos da Hostinger.

- **VPS:** 187.127.5.210 · **SSH:** `ssh -i ~/.ssh/audisped_vps root@187.127.5.210`
- **Raiz do projeto na VPS:** `/opt/audisped`
- **Caddy:** `/opt/audisped/Caddyfile` (bind-mount)
- Tempo estimado: ~20 min. Nada aqui toca o sistema de produção.

> ⚠️ Antes de tudo: o código do ambiente demo está no branch **`demo`** (commit `824f9e7`).
> Ele precisa chegar na VPS. Escolha UMA das formas no Passo 1.

---

## Impacto em produção — leia primeiro

**Resumo: praticamente zero.** O demo é um stack separado (contêineres, banco, volumes e
portas próprios). Subir/derrubar o demo NÃO mexe nos contêineres de produção. Pontos de
atenção (os únicos lugares que "encostam" no prod), todos controlados:

| Toca o prod? | O quê | Risco | Mitigação |
|---|---|---|---|
| ❌ Não | Contêineres/portas/volumes demo | — | nomes `audisped-demo-*`, portas 15436/8081, tag de imagem `:demo` |
| ⚠️ Só leitura | `extract-ref` faz `pg_dump` da referência (ncm/cest) do banco de prod | lê o banco de prod por segundos, **não escreve nada** | rodar em horário calmo |
| ⚠️ Cuidado | Passo 1 via git: **não** trocar o branch no diretório do prod | trocaria o código do prod | **use um diretório separado** (`/opt/audisped-demo`) — instruções abaixo |
| ⚠️ Cuidado | Passo 8 edita o **Caddyfile compartilhado** | erro de sintaxe falha o reload | `caddy validate` antes; o reload é atômico (se falhar, mantém o config atual) |
| ⚠️ Recurso | Um Postgres + Node + nginx extras rodando | consome RAM/CPU/disco da VPS | garanta folga de memória antes de subir |

Nada disso altera dado, imagem ou comportamento da produção se você seguir os passos.

---

## Passo 1 — Levar o código `demo` para a VPS (em diretório SEPARADO)

> Importante: **não** faça `git checkout demo` na pasta onde a produção roda — isso trocaria
> o código do prod. Use uma pasta dedicada `/opt/audisped-demo`.

**Opção A (git, recomendada):**
```bash
# no seu PC:
git push origin demo

# na VPS — clone/checkout em pasta PRÓPRIA:
ssh -i ~/.ssh/audisped_vps root@187.127.5.210
git clone -b demo /opt/audisped /opt/audisped-demo   # clone local do repo já existente
# (ou, se preferir do remoto:  git clone -b demo <url-do-remoto> /opt/audisped-demo)
cd /opt/audisped-demo
```

**Opção B (rsync do código, se a VPS não usa git):**
```bash
# no seu PC, da raiz do projeto:
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 'mkdir -p /opt/audisped-demo'
rsync -az -e "ssh -i ~/.ssh/audisped_vps" \
  backend/ frontend/ docker-compose.demo.yml demo/ DEMO_SETUP.md \
  root@187.127.5.210:/opt/audisped-demo/
```

> Nos passos seguintes, `cd /opt/audisped-demo` (a pasta do demo). Só o **Passo 8 (Caddy)**
> e o **Passo 9 (cron)** referenciam caminhos; ajuste-os para `/opt/audisped-demo`.

Confira que os arquivos chegaram:
```bash
ls /opt/audisped-demo/docker-compose.demo.yml /opt/audisped-demo/demo/reset.sh
ls /opt/audisped-demo/backend/demoPaywall.js /opt/audisped-demo/backend/demo-reset.js
```

---

## Passo 2 — DNS do subdomínio (registro.br)

No painel do **registro.br** (zona do `audisped.com.br`), adicione:

| Tipo | Nome | Valor |
|------|------|-------|
| A | `demo.audisped.com.br` | `187.127.5.210` |

A propagação leva de minutos a algumas horas. Cheque com:
```bash
dig +short demo.audisped.com.br    # deve retornar 187.127.5.210
```

---

## Passo 3 — Criar o `backend/.env.demo` (segredos NOVOS)

Na VPS:
```bash
cd /opt/audisped-demo
cp backend/.env.demo.example backend/.env.demo
nano backend/.env.demo
```
Preencha com valores **novos, diferentes da produção**:
- `JWT_SECRET=` → gere: `openssl rand -hex 32`
- `CERT_ENCRYPTION_KEY=` → gere: `openssl rand -hex 32`
- `DEMO_USER_PASSWORD=` → a senha do login compartilhado (ex.: `demo1234` ou outra)
- Os `*_TOKEN` deixe **vazios** (a demo não usa serviços externos pagos).

E exporte a senha do banco demo (usada pelo compose). Crie um `.env` na raiz OU exporte na sessão:
```bash
export DEMO_DB_PASSWORD='<uma-senha-forte-do-postgres-demo>'
```
> Dica: para o cron funcionar depois, é melhor colocar `DEMO_DB_PASSWORD=...` num arquivo
> `/opt/audisped/.env` (o `docker compose` lê `.env` da pasta automaticamente).

---

## Passo 4 — Subir o stack demo

```bash
cd /opt/audisped-demo
docker compose -f docker-compose.demo.yml up -d --build
```
Confira os 3 contêineres de pé:
```bash
docker ps | grep audisped-demo
# esperado: audisped-demo-db, audisped-demo-backend, audisped-demo-frontend
```
Se `demo-backend` reiniciar em loop, veja o log: `docker logs audisped-demo-backend --tail 50`
(normalmente é `.env.demo` faltando um segredo ou `DEMO_DB_PASSWORD` não exportado).

---

## Passo 5 — Criar o schema no banco demo

O container roda `node server.js` (não cria schema no boot). Rode à mão:
```bash
docker exec audisped-demo-backend node setup_db.js
```
Deve terminar sem erro (cria todas as tabelas + o CHECK já com a role `demo`).

---

## Passo 6 — Copiar a referência (`ncm`/`cest`) da produção

Pegue a connection string da produção do seu `backend/.env` de prod
(`DB_USER`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_PASSWORD`). Monte a `PROD_URL`.

O container `audisped-demo-db` (postgres:16-alpine) já tem `pg_dump` e `psql`.
Rode a cópia POR DENTRO dele (evita expor portas):
```bash
docker exec audisped-demo-db sh -c \
  "pg_dump 'postgres://USUARIO:SENHA@HOST_PROD:5432/audisped_db' \
     --data-only --no-owner --table=ncm --table=cest \
   | psql -U demo -d audisped_demo_db -v ON_ERROR_STOP=1"
```
> Se o Postgres de produção roda no HOST (não em container), use como `HOST_PROD` o IP
> da VPS na rede docker (`172.17.0.1`) ou `host.docker.internal`. Se roda em container,
> use o nome do serviço/rede dele.

Confira que carregou:
```bash
docker exec audisped-demo-db psql -U demo -d audisped_demo_db -c "SELECT count(*) FROM ncm; SELECT count(*) FROM cest;"
```

---

## Passo 7 — Seed inicial (cria o usuário demo, zera o resto)

```bash
cd /opt/audisped-demo
./demo/reset.sh
```
Saída esperada: "Usuário demo pronto: demo@audisped.com.br (role demo)." + "RESET concluído."

> A trava de segurança confirma `DEMO_MODE=1` e `DB_DATABASE` contendo `demo` — se
> apontasse para produção, o script **recusa** e aborta.

---

## Passo 8 — Publicar no Caddy (TLS automático)

Edite o Caddyfile da VPS e cole o bloco de `demo/Caddyfile.demo-snippet`:
```bash
nano /opt/audisped/Caddyfile
# cole o bloco 'demo.audisped.com.br { ... }' ao lado do bloco app.audisped.com.br
```
Valide ANTES de recarregar (evita derrubar o prod por erro de sintaxe):
```bash
# se o Caddy roda em container:
docker exec <nome-do-caddy> caddy validate --config /etc/caddy/Caddyfile   # 1º valida
docker exec <nome-do-caddy> caddy reload   --config /etc/caddy/Caddyfile   # 2º recarrega (atômico)
# ou reinicie o serviço do Caddy conforme seu compose
```
Se o `validate` acusar erro, corrija o bloco antes de recarregar — o config atual (prod) continua no ar.
O cert Let's Encrypt sobe sozinho assim que o DNS do Passo 2 propagar.

---

## Passo 9 — Agendar o reset diário (cron)

```bash
crontab -e
# adicione a linha:
0 3 * * *  cd /opt/audisped-demo && ./demo/reset.sh >> /var/log/audisped-demo-reset.log 2>&1
```

---

## Passo 10 — Testar (checklist de aceite)

Abra `https://demo.audisped.com.br` e logue com `demo@audisped.com.br` / (senha do Passo 3).

- [ ] Sobe um SPED real → corrige LMC → injeta XML → confere Analisador → roda o Validador. **Tudo aparece na tela.**
- [ ] Baixar o **PDF de correções** → funciona (200).
- [ ] Tentar baixar o **SPED corrigido (.txt)** → bloqueia com **402** e mensagem "Assine para baixar".
- [ ] Tentar baixar o **LMC impresso** → bloqueia (402).
- [ ] `./demo/reset.sh` → base volta ao zero (0 empresas, só o usuário demo).
- [ ] **Produção intacta**: `https://app.audisped.com.br` continua exportando SPED normalmente.

---

## Reset antes de uma demonstração ao vivo
```bash
ssh -i ~/.ssh/audisped_vps root@187.127.5.210 "cd /opt/audisped-demo && ./demo/reset.sh"
```

## Solução de problemas rápida
| Sintoma | Causa provável | Ação |
|---|---|---|
| `demo-backend` reinicia | falta segredo no `.env.demo` ou `DEMO_DB_PASSWORD` | `docker logs audisped-demo-backend` |
| Validador não acha NCM/CEST | Passo 6 não rodou | refazer a cópia de referência |
| 402 no PDF de correções | middleware montado em rota errada | conferir; PDFs de prova NÃO devem ter `demoPaywall` |
| `reset.sh` recusa | `DB_DATABASE` sem 'demo' ou `DEMO_MODE≠1` | é a trava de segurança funcionando; conferir env do container |
| Sem HTTPS | DNS não propagou | `dig +short demo.audisped.com.br`; aguardar |
