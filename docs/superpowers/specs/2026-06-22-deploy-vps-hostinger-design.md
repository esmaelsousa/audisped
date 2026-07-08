# Deploy AudiSped na VPS Hostinger — Design & Runbook

**Data:** 2026-06-22
**VPS:** Ubuntu 24.04 · 2 vCPU · 8 GB RAM · 96 GB NVMe · IP `187.127.5.210`
**Projeto Docker:** `audisped`

---

## 1. Objetivo e escopo

Hospedar o AudiSped (backend Node/Express + frontend Vue 3 + PostgreSQL) numa VPS
para uso **interno do escritório** (você + equipe), de forma segura, com caminho aberto
para virar SaaS multi-cliente (postos) numa fase futura.

**Fora de escopo agora (fase 2):** isolamento multi-inquilino real (garantir que o posto A
nunca veja dado do posto B), planos/billing, onboarding de clientes externos. O deploy atual
não atrapalha essa evolução.

## 2. Arquitetura

```
internet ──443/80──▶ caddy (HTTPS) ──/api/*──▶ backend:15435 ──▶ db (postgres 16)
                                    └──/*──────▶ frontend (nginx, fallback SPA)
```

- **Borda:** Caddy. Termina HTTPS (Let's Encrypt automático quando houver domínio),
  serve o frontend e faz proxy de `/api` para o backend. Como front e API ficam no
  mesmo domínio, CORS deixa de ser problema.
- **backend** e **db** **não publicam porta no host** — só existem na rede interna
  `audisped-net`. Apenas o Caddy expõe 80/443.
- Containers: `audisped-db`, `audisped-backend`, `audisped-frontend`, `audisped-caddy`.

### Volumes / persistência
| Volume | Conteúdo |
|---|---|
| `pgdata` (named) | dados do PostgreSQL |
| `./data/uploads` (bind) | arquivos SPED + XML enviados (1,9 GB migrados) |
| `caddy_data` (named) | certificados HTTPS |

## 3. Arquivos de deploy (no repositório)

- `docker-compose.prod.yml` — stack `audisped` (db, backend, frontend, caddy)
- `Caddyfile` — borda; hoje `:80` por IP, pronto pra trocar pelo bloco do domínio
- `frontend/nginx.conf` — fallback SPA (Vue Router history mode) + gzip
- `.env.production.example` / `backend/.env.production.example` — templates SEM segredos

### Correções aplicadas para containerizar
1. `frontend/Dockerfile`: `npm install --include=dev` (vite/tailwind são devDeps e o build
   precisa deles, mesmo com `NODE_ENV=production`) + `COPY nginx.conf`.
2. `backend/Dockerfile`: base `node:20-slim`; `CMD ["node","server.js"]` (rodar via
   `npm start` deixava o npm como PID 1, que saía com código 0 em loop no container).
3. `docker-compose.prod.yml`: `init: true` no backend (encaminha sinais / evita zumbis,
   pois o app chama subprocessos de PDF).
4. `backend/package.json`: declaradas as deps usadas mas não listadas — `winston`,
   `axios`, `archiver` (resolviam do `node_modules` da raiz no ambiente local).
5. `frontend/src/views/ProfileView.vue`: base da API relativa (`''`) em vez de
   `http://localhost:3000`.

## 4. Segredos (criados direto na VPS, nunca no git)

- `/opt/audisped/.env` (compose, serviço db): `DB_USER`, `DB_DATABASE`, `DB_PASSWORD`.
- `/opt/audisped/backend/.env` (runtime): `DB_HOST=db`, `DB_PORT=5432`, `DB_*`, `PORT=15435`,
  `JWT_SECRET`, `CERT_ENCRYPTION_KEY`, tokens InfoSimples/EspiãoNFe.
- **`DB_PASSWORD`** e **`JWT_SECRET`**: gerados fortes na própria VPS (`openssl rand`).
- ⚠️ **`CERT_ENCRYPTION_KEY` foi REUSADA** do `.env` local — os certificados digitais já
  estão cifrados no banco com ela; trocá-la os tornaria indecifráveis. Validado:
  os 2 certificados (empresas 306 e 1759) decifram e abrem no node-forge na VPS.

## 5. Migração de dados executada

1. `pg_dump -Fc` do banco local (2,6 GB → dump de 146 MB) → restaurado com `pg_restore
   --no-owner --no-acl` no container `audisped-db`. **36 tabelas**, 37 empresas, 970 SPEDs,
   7 usuários, 2 certificados.
2. `rsync` de `backend/uploads` (1,9 GB / 1813 arquivos) → `/opt/audisped/data/uploads`.

## 6. Segurança

- Acesso SSH por **chave** (`~/.ssh/audisped_vps`). **TROCAR a senha de root** da VPS
  (foi usada uma vez só para instalar a chave) e considerar desabilitar login root por senha.
- Firewall **ufw** ativo: libera apenas 22, 80, 443.
- Backend/DB sem porta exposta no host.
- Pendência (hardening opcional): restringir CORS por env; backup externo (S3/Backblaze).

## 7. Operação

### Atualizar o sistema (deploy de nova versão)
```bash
cd /opt/audisped
# enviar código novo (do dev): rsync backend/ e frontend/ OU git pull se versionar
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f
```

### Ligar o HTTPS (quando o domínio estiver registrado)
1. Apontar um registro **A** do domínio (ex.: `audisped.SEU-DOMINIO.com.br`) para `187.127.5.210`.
2. No `Caddyfile`, trocar o bloco `:80 { ... }` pelo bloco com o nome do domínio
   (modelo comentado no próprio arquivo).
3. `docker compose -f docker-compose.prod.yml restart caddy` — o Caddy provisiona e renova
   o certificado Let's Encrypt automaticamente.

### Backup (a configurar — cron diário no host)
- `docker exec audisped-db pg_dump -U postgres audisped_db -Fc > /opt/audisped/backups/db_$(date +%F).dump`
- `tar czf /opt/audisped/backups/uploads_$(date +%F).tgz -C /opt/audisped/data uploads`
- Retenção (ex.: 7 diários / 4 semanais). Opcional: enviar para storage externo.

## 8. Verificação pós-migração

- Containers: db `healthy`, backend `running` (restarts=0), frontend/caddy `up`.
- `badlogin (POST /api/auth/login) → 401` (auth + DB + bcrypt OK, não 500).
- SPA deep-links (`/analisador`, `/validador`) → 200.
- Uploads: 1813 (VPS) = 1813 (local).
- Certificados: 2/2 decifram com a chave reusada e abrem no node-forge.
- Time de agentes (paridade total do banco · cobertura de API · frontend) — ver resultados
  na conversa de migração.
