# Ambiente de Demonstração (`demo.audisped.com.br`) — Runbook

Sandbox descartável para prospects testarem o produto com o **SPED real deles**, sem
tocar em dado de cliente e sem levar o deliverable. Design completo em
[`docs/superpowers/specs/2026-07-18-ambiente-demo-prospects-design.md`](docs/superpowers/specs/2026-07-18-ambiente-demo-prospects-design.md).

## Como funciona (resumo)
- Stack **separado** (`docker-compose.demo.yml`): `demo-db` (Postgres próprio) + `demo-backend` (`DEMO_MODE=1`) + `demo-frontend`. O backend demo **não alcança** o banco de produção — isolamento por infraestrutura.
- Banco **vazio de dado de cliente**; só as tabelas de referência (`ncm`, `cest`) são copiadas do prod. O prospect sobe o SPED dele.
- **Paywall** (`backend/demoPaywall.js`): com `DEMO_MODE=1`, as rotas de deliverable respondem **402**:
  - `GET /api/exportar-sped/:id` (SPED fiscal corrigido `.txt`)
  - `GET /api/lmc/imprimir/:id_sped` (LMC impresso)
  - `POST /api/xml-injector/standalone` e `POST /api/cte-injector/inject` (injetores que devolvem `.txt`)
  - **Liberado** (prova de valor): PDF de correções, dossiê, rentabilidade e todas as telas.
- **Login compartilhado**: `demo@audisped.com.br` (role `demo`, sem capacidades). Senha em `DEMO_USER_PASSWORD`.
- **Reset**: diário (cron) + sob demanda (`./demo/reset.sh`).

## Provisionamento (uma vez)

1. **DNS** (registro.br): `A demo.audisped.com.br -> 187.127.5.210`.
2. **Env**: `cp backend/.env.demo.example backend/.env.demo` e preencher `JWT_SECRET` e `CERT_ENCRYPTION_KEY` com valores **NOVOS** (não os de produção). Exportar `DEMO_DB_PASSWORD` (e opcional `DEMO_DB_USER`) no shell/`.env` do compose.
3. **Subir o stack**:
   ```bash
   DEMO_DB_PASSWORD='<senha-forte>' docker compose -f docker-compose.demo.yml up -d --build
   ```
4. **Criar o schema** no banco demo:
   ```bash
   docker exec audisped-demo-backend node setup_db.js
   ```
5. **Copiar a referência** (`ncm`/`cest`) do prod para o demo:
   ```bash
   PROD_URL='postgres://<user>:<pass>@<host>:5432/audisped_db' \
   DEMO_URL='postgres://demo:<DEMO_DB_PASSWORD>@127.0.0.1:<porta-demo-db>/audisped_demo_db' \
   ./demo/extract-ref.sh
   ```
   (Se o `demo-db` não estiver exposto, rode o `psql`/`pg_dump` de dentro da rede docker ou exponha a porta temporariamente.)
6. **Seed inicial** (cria o usuário demo e zera o resto):
   ```bash
   ./demo/reset.sh
   ```
7. **Caddy**: colar o bloco de `demo/Caddyfile.demo-snippet` no `/opt/audisped/Caddyfile` e recarregar o Caddy. O cert TLS sobe sozinho quando o DNS propagar.

## Reset diário (cron)

Na VPS, agendar o reset das 03:00 (ajuste o caminho do repo):
```cron
0 3 * * *  cd /opt/audisped && ./demo/reset.sh >> /var/log/audisped-demo-reset.log 2>&1
```

## Reset sob demanda (antes de uma call)
```bash
./demo/reset.sh
```

## Verificação pós-deploy (aceite)
- `demo@audisped` loga e sobe um SPED → corrige LMC/valida → **vê tudo na tela**.
- Baixar **PDF de correções** → 200. Baixar **SPED `.txt`** ou **LMC impresso** → **402** (`{ paywall: true }`).
- `./demo/reset.sh` → banco volta ao seed (0 empresas, 1 usuário demo, `ncm`/`cest` intactos, uploads limpos).
- **Produção intocada**: nenhuma role `demo`, `DEMO_MODE` ausente → exports funcionam normalmente.

## Segurança / travas
- `demo-reset.js` **recusa** rodar se `DEMO_MODE != 1` ou se `DB_DATABASE` não contiver `demo` — impossível zerar produção por engano.
- `extract-ref.sh` **recusa** destino cujo `DEMO_URL` não contenha `demo`.
- `backend/.env.demo` tem segredos → **não commitar** (está no `.gitignore`).
