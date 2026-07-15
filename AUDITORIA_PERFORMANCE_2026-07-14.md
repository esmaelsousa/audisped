# AUDITORIA FORENSE DE PERFORMANCE — AudiSped (Produção)

**Data:** 2026-07-14 · **Ambiente:** VPS Hostinger `187.127.5.210` (`srv1776566`) · **Modo:** 100% READ-ONLY (nada foi alterado, reiniciado ou aplicado)
**Método:** SSH root + inspeção de código local + 4 agentes especialistas em paralelo (Banco, Backend, Frontend/Proxy, Logs/Infra). Evidências brutas preservadas no sandbox (`db_evidence.txt`, `db_findings.md`, `backend_findings.md`, `frontend_findings.md`, `logs_infra_findings.md`).

> **Aviso de honestidade:** o sistema estava **ocioso e com baixíssimo tráfego** durante toda a coleta (load 0.08, CPU 99% idle, 9/100 conexões). Portanto **NÃO há medição de latência sob carga real** — não existe APM, `pg_stat_statements` nem log de query lenta. Os gargalos abaixo são **estruturais/de código**, confirmados por evidência estática e por contadores acumulados de 21 dias; os que dependem de carga estão marcados como **HIPÓTESE/PROVÁVEL**. Onde não há dado, está escrito **DADOS INSUFICIENTES**.

---

## 1. RESUMO EXECUTIVO

O AudiSped roda numa VPS **saudável e fortemente subutilizada**: 2 vCPU, 7.8 GB RAM, disco SSD rápido (await ~0.2 ms, %util < 0.1%), 22 dias de uptime, **zero OOM, zero crash-loop, zero deadlock, zero lock travado, sem swap-thrash**. Do ponto de vista de *infra bruta*, sobra folga.

Os riscos reais de performance **não estão no hardware — estão no software e na configuração**, e só se manifestam sob **concorrência e nas operações pesadas** (upload/parse de SPED, exportação em lote, validador, injeção de XML). Os três pilares do problema:

1. **Backend single-thread bloqueado por I/O síncrono + parsing CPU-bound de arquivos SPED multi-MB** (`fs.readFileSync(...'latin1').split()`). Enquanto um export/validador roda, **toda** a aplicação (inclusive `/api/auth/login`) trava. Este é o **gargalo dominante** e a origem real do sintoma conhecido "*pool esgota com exportações em sequência rápida*".
2. **PostgreSQL com configuração de fábrica** (`shared_buffers=128 MB`, `work_mem=4 MB`, `random_page_cost=4`) para um banco de 2.5 GB → **cache hit de apenas 86.8%** (as 3 tabelas quentes têm 34–71% de hit no heap), sorts derramando **930 MB** em disco, e o pool da app (`max:120`) **excede** o limite do servidor (`max_connections=100`).
3. **Observabilidade praticamente inexistente** (sem métricas, APM, alertas, healthcheck de app, log de query lenta) — o sistema está "voando às cegas". Um bug de parse de data (`"a 31" → YYYY`) roda ~20×/semana **sem ninguém ver**.

**Nenhum problema P0/P1 de disponibilidade imediata.** As correções são de médio esforço e alto retorno; a maioria dos ganhos vem de **~5 ajustes de configuração** (reload/restart de Postgres e alinhamento de pool) e de **mover o parsing de SPED para fora do event-loop**.

---

## 2. NOTA GERAL DE PERFORMANCE

| Área | Nota | Justificativa resumida |
|---|---:|---|
| Infraestrutura (VPS/SO) | **78/100** | Recursos folgados e saudáveis; penalizada por **sem swap**, **sem limites de CPU/mem nos containers** e **sem rotação de logs Docker**. |
| Banco de Dados | **58/100** | Operacionalmente saudável (checkpoints/locks OK), mas **config de fábrica**: cache hit 86.8%, `shared_buffers` 128 MB, `work_mem` 4 MB, `random_page_cost` 4, índice de 327 MB sem uso, 6 FKs sem índice, sem `pg_stat_statements`. |
| Backend | **52/100** | **Bloqueio do event-loop por parse síncrono (P1)**, pool > `max_connections`, sem `statement_timeout`, N+1 em upload/de-para, listas sem paginação, 2º pool. Bons padrões de erro/semáforo, mas cobertura parcial. |
| Frontend | **72/100** | Code-splitting por rota e cache de assets corretos, same-origin; penalizado por **entry de 880 KB (261 KB gzip)** sem split de vendor, **sem Brotli**, fontes Google render-blocking. |
| Rede / APIs | **76/100** | HTTP/2 + gzip OK, mesma origem (sem preflight); faltam **Brotli** e **HTTP/3** (443/udp não publicado). |
| Observabilidade | **18/100** | **Quase zero:** sem APM/métricas/alertas/healthcheck de app, log de query lenta desligado, sem `pg_stat_statements`, logs Docker sem rotação. |
| Escalabilidade | **45/100** | Instância única, event-loop bloqueável, teto de pool, tabelas crescendo (3 tabelas = 96% do banco), sem bulkheads de container. |

**Critério:** 90–100 excelente / 70–89 bom com ajustes / 50–69 requer atenção estrutural / < 50 crítico. Notas ponderadas por evidência confirmada; áreas sem dado de carga não foram penalizadas por suposição.

---

## 3. MAPA DA ARQUITETURA REAL

```text
                          Internet (bots/brute-force de fundo)
                                    │
                         DNS: audisped.com.br / www  ✅
                              app.audisped.com.br  ❌ (NXDOMAIN — sem registro A)
                                    │
                    ┌───────────────▼───────────────┐
                    │  audisped-caddy (Caddy 2-alpine)│  0.0.0.0:80/443 tcp
                    │  TLS/ACME · encode gzip zstd    │  (443/udp NÃO publicado → sem H3)
                    │  reverse_proxy /api → backend   │  sem security headers
                    └───────┬────────────────┬────────┘
                            │ (resto)        │ (/api/*)
              ┌─────────────▼──────┐   ┌─────▼──────────────────────┐
              │ audisped-frontend  │   │ audisped-backend           │
              │ nginx 1.30.3       │   │ Node "node server.js"       │
              │ Vue3+Vite6 estático│   │ Express + pg Pool (max 120) │
              │ :80                │   │ monolito ~10.6k LOC, 129 rot│  :15435
              └────────────────────┘   └─────┬───────────┬──────────┘
                                             │           │ 2º pool (espiaoNfe, max 10)
                                       ┌─────▼──────┐    │
                                       │ audisped-db│    └──► APIs externas:
                                       │ Postgres 16│         Resend (e-mail),
                                       │ .14-alpine │         SEFAZ/MDe, EspiãoNFe
                                       │ 2541 MB    │         (sem timeout/retry visível)
                                       │ max_conn100│
                                       └────────────┘
   Sidecar host: monarx-agent (scanner de malware da Hostinger — NÃO é monitoramento)
   Sem: Redis/fila/cache · sem Prometheus/Grafana/Sentry · sem swap · containers sem limites
```

---

## 4. INVENTÁRIO DA VPS

| Item | Valor | Evidência |
|---|---|---|
| SO | Ubuntu 24.04.4 LTS, kernel 6.8.0-124 | `uname -a`, `/etc/os-release` |
| CPU | 2 vCPU AMD EPYC 9354P @ 2.0 GHz (1 thread/core) | `lscpu` |
| RAM | 7.8 GiB (965 MiB usados, 6.1 GiB buff/cache, **6.8 GiB disponíveis**) | `free -h` |
| Swap | **0 B (nenhum)** — `vm.swappiness=60` sem efeito | `swapon --show` |
| Disco | `/dev/sda1` 96 GB, **16 GB usados (17%)**, inodes 2% | `df -h`, `df -i` |
| I/O disco | SSD rápido: `r_await 0.17 ms`, `w_await 0.34 ms`, `%util 0.01–0.10%` | `iostat -dx` |
| Load / CPU | **0.08 / 0.07 / 0.08**; vmstat **99–100% idle**, 0 em run-queue | `/proc/loadavg`, `vmstat` |
| File descriptors | 1504 abertos (sistema); **`ulimit -n = 1024`** no shell root | `/proc/sys/fs/file-nr`, `ulimit -a` |
| OOM / zumbis / svc falhos | **nenhum** | `dmesg`, `ps`, `systemctl --failed` |
| Uptime | 22 dias | `uptime` |
| Portas expostas | 22 (ssh), 80/443 (docker-proxy→caddy) | `ss -tlnp` |
| Containers | 4: caddy (3sem), db (3sem, healthy), frontend+backend (recriados há ~12 min — **redeploy manual, não crash**) | `docker ps`, `docker inspect` |
| Limites de container | **Memory=0, NanoCpus=0 em TODOS** (sem limite); healthcheck só no db | `docker inspect` |
| Docker disk | Imagens 1.28 GB · Volumes 2.9 GB · **Build cache 4.5 GB (3.82 GB recuperável)** | `docker system df` |

---

## 5. BASELINE DE PERFORMANCE

### Infra (ponto no tempo, sistema ocioso)
CPU idle 99–100% · Load 0.08 · RAM disponível 6.8 GB · Swap 0 · I/O util < 0.1% · rede 28 TCP (2 estab), retransmissões baixas.

### Aplicação
**DADOS INSUFICIENTES para P50/P75/P90/P95/P99, RPS e taxa de erro** — não há APM, log de acesso com tempo, nem `pg_stat_statements`. TTFB medido foi ~10 ms **em loopback** (exclui rede real). Caddy registrou **apenas 4× HTTP 502 em 168 h** (DNS transitório do Docker durante o recreate; auto-curados) e **nenhum 503/504**.

### Banco (contadores acumulados desde 2026-06-23, ~21 dias — janela válida)
| Métrica | Valor | Leitura |
|---|---|---|
| Cache hit ratio (global) | **86.8%** | Baixo (alvo > 99%) |
| Cache hit heap por tabela | c100 **50.9%** · c190 71.6% · erros_analise **33.6%** | 3 tabelas quentes fora do buffer |
| Temp files / bytes | **51 / 930 MB** | Sorts derramando em disco (`work_mem` baixo) |
| Deadlocks | 0 | Limpo |
| Conexões | 9/100 (1 active, 3 idle) | Folgado (mas teto do pool é problema) |
| Checkpoints | 6310 timed vs **4** requested | Saudável |
| `buffers_backend` vs `_checkpoint` | 623.465 vs 91.042 | **Backends auto-evictando 6.8× — assinatura de `shared_buffers` pequeno** |
| `wal_buffers_full` | 180.861 (~97% das escritas WAL) | WAL buffer pequeno sob bursts |

---

## 6. FLUXOS CRÍTICOS

| Fluxo | Camada dominante | Diagnóstico (evidência) |
|---|---|---|
| Login | Backend/DB | Rate-limit presente; risco = ficar **atrás** de um export bloqueante (Cadeia 1). |
| Upload SPED (`POST /api/upload`) | **Backend CPU/IO** | `readFileSync` síncrono + **insert linha-a-linha** (N+1, `server.js:836-862`) → milhares de round-trips por arquivo. |
| Análise (`/api/analisar/:id`) | DB + Backend | Semáforo + único `statement_timeout`; varre c100/erros_analise mal-cacheadas. |
| Exportação (`/api/exportar-sped/:id`) | **Backend CPU/IO** | Handler ~2400 LOC, `SELECT *`, parse síncrono, streaming; guardado por semáforo. |
| Validador / Injetor XML | **Backend CPU/IO** | Reparse do SPED do disco, **NÃO** guardado pelo semáforo → concorrência livre. |
| Listagens (`/api/documentos/*`, `/api/arquivos`, `/api/lmc`) | DB + serialização | **Sem LIMIT**; `json_agg` de todos os filhos; `fs.existsSync` por linha em `/api/arquivos`. |
| Export em lote (`export_lote.js`) | Backend/DB | Pool **próprio** fora do semáforo → soma de backends contra o teto de 100. |

*Tempo por camada não quebrável sem instrumentação (ver Limitações).*

---

## 7. TOP 10 MAIORES PROBLEMAS

| # | Problema | Sev. | Conf. | Evidência | Impacto | Causa raiz | Correção (recomendação) | Esforço | Benefício |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Parse SPED síncrono bloqueia o event-loop** | P1 | CONFIRMADA | ~25× `fs.readFileSync(...'latin1').split()` + parse linha-a-linha em rotas (`server.js:915,1266,1989,2185,5587…`) | Durante export/validador **toda** a app trava (login, health) | Node single-thread + I/O e CPU síncronos na thread de request | `fs.promises`/streaming + **`worker_threads`** para parsing | Alto | **Elimina o principal travamento sob carga** |
| 2 | **Pool `max:120` > `max_connections:100`** | P1 | CONFIRMADA | `server.js:61-70` vs `SHOW max_connections=100` (verificado) | Sob burst, Postgres recusa → `safeConnect` 503 | Pool dimensionado acima do servidor + 2º pool (+10) + `export_lote` (pool próprio) | Alinhar: pool ≤ ~40–90 **ou** subir `max_connections` (após `shared_buffers`) | Baixo | Remove teto de 503 em lote |
| 3 | **`shared_buffers=128 MB` p/ banco de 2.5 GB** | P2 | CONFIRMADA | `pg_settings`; heap hit c100 51% / erros_analise 34%; `buffers_backend` 623k vs 91k | Cada análise/export paga I/O de disco nas 3 tabelas quentes | Config de fábrica do `postgres:16-alpine` | Subir para **512 MB–1 GB** (~25% RAM) + `effective_io_concurrency 1→100` (restart) | Baixo | Cache hit 86.8% → ~98%+; menos I/O |
| 4 | **Sem `statement_timeout` global** | P2 | CONFIRMADA | só `server.js:2506` tem; demais 235 queries livres | Query lenta/travada segura a conexão do pool indefinidamente | Ausência de default no pool | `options:'-c statement_timeout=30000'` no pool | Baixo | Corta cascata de exaustão de pool |
| 5 | **Zero observabilidade** (APM/métricas/alerta/healthcheck/slow-log) | P2 | CONFIRMADA | `docker ps` sem stack de monitoramento; `log_min_duration_statement=-1`; `pg_stat_statements` ausente; crontab vazio | Regressões e bugs invisíveis (ex.: bug "a 31" 20×/sem) | Nunca instrumentado | Healthcheck de app + uptime externo + `pg_stat_statements` + slow-log 500 ms + (futuro) node_exporter/Prometheus | Médio | Torna o resto **diagnosticável** |
| 6 | **N+1 em upload / de-para / cascata** | P2 | CONFIRMADA | insert linha-a-linha `836-862`; de-para por item dentro do loop de nota `1447→1459`; UPDATE por linha `7197,7311` | Milhares de round-trips por operação | Loop com query por iteração | `INSERT … VALUES` multi-linha / `COPY`; pré-carregar mapa de-para; update em lote | Médio | Import/injeção muito mais rápidos |
| 7 | **Listagens sem paginação + `fs.existsSync` por linha** | P2 | CONFIRMADA | `/api/documentos/entradas|saidas/:id` (sem LIMIT, `json_agg` de todos os filhos); `/api/arquivos:3290` stat síncrono por arquivo | Payload gigante + bloqueio de event-loop O(arquivos) | Falta de keyset/limit; stat na thread de request | Paginação keyset + remover/assíncrono o stat | Médio | Menos payload, menos bloqueio |
| 8 | **Índice `idx_chv_nfe` de 327 MB sem uso** | P2 | PROVÁVEL | `idx_scan=0` em 21 dias; 68% dos bytes de índice da c100 | Disco morto + peso em todo INSERT/UPDATE da c100 + disputa de cache | Índice criado p/ dedup que hoje não é usado nessa via | **Verificar** uso de `chv_nfe`; se 0, `DROP INDEX CONCURRENTLY` | Baixo | Libera 327 MB, acelera import |
| 9 | **`work_mem=4 MB` + `random_page_cost=4` (SSD)** | P3 | CONFIRMADA | 930 MB temp files; `erros_analise` seq-scan 36× (41.5 M tuplas) | Sorts em disco; planner evita index scan | Config de fábrica | `work_mem 16–32 MB` (reload) + `random_page_cost 1.1` (SSD) | Baixo | Menos spill; melhores planos |
| 10 | **Entry frontend 880 KB (261 KB gzip), sem Brotli/vendor-split** | P3 | CONFIRMADA | `dist/assets/index-*.js 880.834 B`; `encode gzip zstd` (sem `br`); sem `manualChunks` | 1ª visita mais lenta; cache invalida a cada deploy | Vite sem `manualChunks`; `reportCompressedSize:false` esconde o aviso | `manualChunks` (vendor/apexcharts) + habilitar **Brotli** no Caddy | Baixo | ~20–40% menos bytes na 1ª visita |

---

## 8. CADEIAS DE CAUSALIDADE (o *porquê*)

### Cadeia 1 — O travamento sob carga (o gargalo dominante)
```
Endpoint pesado (export / validador / upload)
  → fs.readFileSync(arquivo SPED multi-MB, 'latin1') + .split() + parse linha-a-linha   [F15, CONFIRMADO]
  → EVENT-LOOP do Node (thread única) bloqueado durante TODA a request
  → TODAS as outras requisições (login, health, listagens) param na fila
  → a conexão do pool fica presa o tempo todo (sem statement_timeout)                    [F3, CONFIRMADO]
  → em lote: export_lote.js (pool próprio) + validador/injetor NÃO guardados pelo semáforo [F2/F4, CONFIRMADO]
  → nº de backends tende a 120 (pool) > 100 (max_connections)                             [F1, CONFIRMADO]
  → Postgres recusa "remaining connection slots" → safeConnect responde 503
```
**Isto explica o sintoma histórico "pool esgota com exportações em sequência rápida".** Confiança: **ALTA** (código + `max_connections=100` verificado). O que falta é a *magnitude* sob carga (sem load test em produção).

### Cadeia 2 — I/O de disco desnecessário no banco
```
Análise/Export varre documentos_c100 (663 MB heap) e erros_analise (743 MB heap)
  → shared_buffers de apenas 128 MB não comporta as tabelas quentes                       [F2, CONFIRMADO]
  → heap cache hit cai p/ 51% (c100) e 34% (erros_analise); backends auto-evictam (623k)
  → páginas lidas do disco a cada varredura + work_mem 4 MB derrama sorts (930 MB temp)   [F6, CONFIRMADO]
  → random_page_cost=4 num SSD faz o planner preferir seq scan (erros_analise: 36 scans)  [F3-db, PROVÁVEL]
```
Hoje o disco é rápido e ocioso, então a latência fica **escondida**; sob concorrência ela **soma** com a Cadeia 1. Confiança: **ALTA** na config, **PROVÁVEL** no impacto de latência (sem `pg_stat_statements`).

### Cadeia 3 — Cegueira operacional
```
Sem pg_stat_statements + slow-query log off + sem APM/métricas/alerta                     [F2/F9, CONFIRMADO]
  → impossível ranquear queries lentas ou ver tendência de memória/latência
  → bug de parse de data ("a 31" → YYYY) roda ~20×/semana sem ser notado                  [F4, CONFIRMADO]
  → esta própria auditoria não consegue produzir o "TOP 20 queries" por falta do dado
```
Confiança: **ALTA**.

---

## 9. RELATÓRIO POR CAMADA (resumo; detalhe nos arquivos de evidência)

**VPS / SO —** Saudável e ocioso. Riscos: **sem swap** (sem colchão para picos de RAM), `ulimit -n 1024` no shell (verificar limite efetivo do container Node), nenhum limite de CPU/mem por container.

**Docker —** 4 containers estáveis; **sem `mem_limit`/`cpus`** (um container pode consumir a VPS toda — sem bulkhead), **healthcheck só no db**, **logs `json-file` sem rotação** (creep de disco), build cache de 4.5 GB recuperável.

**Reverse proxy (Caddy) —** TLS/HTTP2/gzip OK. Faltam: **Brotli**, **HTTP/3** (443/udp não publicado), **security headers** (HSTS/CSP/X-Frame/nosniff/Referrer). **`app.audisped.com.br` sem registro A** → ACME falha em loop (risco de rate-limit no Let's Encrypt).

**Backend —** Ver Top-10 (#1,#2,#4,#6,#7). Positivos: `pool.on('error')`, `unhandledRejection`, `safeConnect`/`safeRollback`, semáforo `MAX_HEAVY_OPS=5` **correto e sem leak** — mas cobre só 2 de ~8 rotas pesadas. Sem cache de resposta/consulta (só cache de authz). Chamadas externas (Resend/SEFAZ/EspiãoNFe) sem timeout/retry visível.

**Frontend —** Vue 3 + Vite 6, **code-splitting por rota** e **cache de assets (hash + 1y immutable)** corretos, same-origin (sem preflight), sem polling. Penalidades: entry 880 KB sem `manualChunks`, apexcharts 518 KB, fontes Google render-blocking (10 pesos).

**APIs / Rede —** HTTP/2 + gzip funcionando, retransmissões baixas. Sem Brotli/H3.

**PostgreSQL —** Ver §11.

**Observabilidade —** Ver Top-10 #5. É a área mais fraca (18/100).

---

## 10. AUDITORIA FORENSE — MEMÓRIA / CPU / I/O / CONCORRÊNCIA / LOGS

- **Memória:** backend RSS **87 MB** estável, **sem sinal de leak**; 6.8 GB livres. Risco: **sem swap**.
- **CPU:** 99% idle; nenhum processo CPU-bound persistente. Risco latente = parse SPED (Cadeia 1) satura **1 core** durante a operação.
- **I/O:** disco ocioso e rápido; a "pressão" real é **lógica** (cache miss do Postgres, Cadeia 2), não física.
- **Concorrência:** **0 deadlock, 0 lock não-concedido, 0 idle-in-transaction, 0 long-running.** As 3 conexões idle são pooler benigno. Único risco = teto de pool (Cadeia 1).
- **Logs:** `to_date` "a 31" (~20×/sem, P3 — bug de código); 1 query quebrada `column "public.redes" does not exist` em 14/07 19:29 (**verificar vs item SQLi V14 pendente**); 4× 502 transitório; logs Docker sem rotação.

---

## 11. AUDITORIA FORENSE DO POSTGRESQL

**Rankings (janela de 21 dias):**
- **Maiores tabelas:** documentos_c100 **1146 MB** · erros_analise **786 MB** · documentos_c190 **545 MB** (as 3 = **96% do banco**) · lmc_movimentacao 19 MB · sped_1320 9.2 MB.
- **Mais varredas em seq scan:** `erros_analise` (**36 scans, 41.5 M tuplas lidas**, índice `idx_id_sped_arquivo` só escolhido 483×) — candidata a retenção/partição.
- **Índices sem uso:** **`idx_chv_nfe` (327 MB, 0 scans)** — verificar e dropar.
- **Índices duplicados/redundantes:** **nenhum** (76 índices / 39 tabelas — limpo).
- **FKs sem índice de apoio (6):** `sped_arquivos.id_empresa` (crítico — coluna de tenant, tabela mais quente por blocos), `documentos_d100.id_sped_arquivo`, `espiao_nfe_cache.id_empresa`, `mde_cache.id_empresa`, `usuarios.rede_id`, `encerrantes_exportados.id_sped_arquivo`.
- **Bloat:** proxy por dead-tuples — baixo em geral (< 3%), exceto **`erros_analise` 8.2%** (maior do banco).
- **WAL:** `wal_buffers_full` 180.861 → subir `wal_buffers` 4 MB → 16 MB.
- **Config de fábrica a ajustar:** `shared_buffers` 128 MB, `work_mem` 4 MB, `random_page_cost` 4, `effective_io_concurrency` 1, `wal_buffers` 4 MB.
- **`pg_stat_statements` NÃO instalado** → **impossível produzir TOP-20 queries reais** (maior lacuna de dado).

**TOP-20 queries (lentas / custo / frequência): DADOS INSUFICIENTES** — sem `pg_stat_statements` e com slow-log desligado, não há como ranquear por evidência. Recomendação forte de instalar antes da próxima auditoria.

---

## 12. MATRIZ DE PRIORIZAÇÃO

| Prioridade | Problema | Impacto | Esforço | Risco de aplicar | Quadrante |
|---|---|---|---|---|---|
| P1 | #2 Alinhar pool ↔ `max_connections` + `statement_timeout` | Alto | Baixo | Baixo | **QUICK WIN** |
| P2 | #3 `shared_buffers`/`eic`/`work_mem`/`rpc`/`wal_buffers` | Alto | Baixo | Médio (restart) | **QUICK WIN** |
| P2 | #5 `pg_stat_statements` + slow-log + healthcheck + uptime | Alto | Médio | Baixo | **QUICK WIN** |
| P2 | #8 Dropar `idx_chv_nfe` (após verificação) | Médio | Baixo | Baixo | **QUICK WIN** |
| P2 | Índice em `sped_arquivos(id_empresa)` (`CONCURRENTLY`) | Médio | Baixo | Baixo | **QUICK WIN** |
| P2 | Brotli + `manualChunks` + security headers (Caddy/Vite) | Médio | Baixo | Baixo | **QUICK WIN** |
| P2 | Registro A `app.audisped.com.br` (ou remover do Caddyfile) | Médio | Baixo | Baixo | **QUICK WIN** |
| P1 | #1 Parse SPED em `worker_threads`/streaming | Alto | Alto | Médio | **ESTRATÉGICO** |
| P2 | #6 Batch de N+1 (upload/de-para/cascata) | Alto | Médio | Médio | **ESTRATÉGICO** |
| P2 | #7 Paginação keyset das listagens + remover `existsSync` | Médio | Médio | Baixo | **ESTRATÉGICO** |
| P3 | Limites de container + rotação de log Docker + swap | Médio | Baixo | Baixo | **SECUNDÁRIA** |
| P3 | Corrigir bug de data "a 31"; unificar 2º pool | Médio | Baixo | Baixo | **SECUNDÁRIA** |
| P3 | HTTP/3, self-host de fontes, retenção `erros_analise` | Baixo | Médio | Baixo | **BAIXA** |

---

## 13. ROADMAP DE OTIMIZAÇÃO (apenas recomendação — nada aplicar sem janela)

**FASE 1 — Correções críticas (janela curta)**
1. Alinhar `pool.max` ↔ `max_connections` e adicionar `statement_timeout` no pool (Top-10 #2/#4). *Deploy de código.*
2. Ajustar `postgresql.conf`: `shared_buffers` 768 MB, `effective_cache_size` 5 GB, `work_mem` 24 MB, `maintenance_work_mem` 256 MB, `random_page_cost` 1.1, `effective_io_concurrency` 200, `wal_buffers` 16 MB → **restart do db em janela**.

**FASE 2 — Quick wins**
3. Instalar `pg_stat_statements` + `log_min_duration_statement=500ms`; healthcheck do backend; monitor de uptime externo.
4. Verificar e dropar `idx_chv_nfe` (`CONCURRENTLY`); criar `sped_arquivos(id_empresa)` (`CONCURRENTLY`).
5. Caddy: `encode zstd br gzip` + bloco `header` (HSTS/nosniff/Referrer/frame-ancestors); Vite: `manualChunks` (vendor/apexcharts) e reativar aviso de bundle.
6. DNS: criar A de `app.audisped.com.br` (ou removê-lo do Caddyfile) para parar o loop de ACME.

**FASE 3 — Otimização estrutural (código)**
7. Mover parsing de SPED para `worker_threads`/streaming (Top-10 #1) — remove o travamento do event-loop.
8. Eliminar N+1 (Top-10 #6): `COPY`/insert multi-linha no upload; pré-carregar de-para; update em lote na cascata.
9. Paginar listagens (keyset) e remover `fs.existsSync` por linha (Top-10 #7).
10. Rotear **todas** as rotas pesadas pelo `acquireHeavySlot`; unificar o 2º pool; timeout/retry nas chamadas externas.

**FASE 4 — Escalabilidade**
11. `mem_limit`/`cpus` por container (bulkheads) + rotação de log Docker + swap de 2–4 GB.
12. Cache TTL em memória para tabelas de referência (cfops/catálogo/tabelas fiscais); avaliar retenção/partição de `erros_analise`.

**FASE 5 — Observabilidade contínua**
13. node_exporter + Prometheus + Grafana + alertas (CPU/mem/pool/erro 5xx/latência); error tracking (Sentry).

---

## 14. RESULTADO ESPERADO (estimativas — marcadas como tal)

| Melhoria | Métrica | Estimativa | Base |
|---|---|---|---|
| `shared_buffers` 128 MB → 768 MB | Cache hit | 86.8% → **~98%+** (ESTIMATIVA) | 3 tabelas quentes passam a caber no buffer; comparação técnica |
| `work_mem` 4 → 24 MB | Temp files | **Queda forte** dos 930 MB de spill (ESTIMATIVA) | sorts param de derramar |
| Parse em worker_threads | Latência de terceiros sob export | **Deixa de haver stall global** (QUALITATIVO, ALTA confiança) | remove bloqueio de event-loop |
| Pool alinhado + `statement_timeout` | 503 em lote | **Elimina** o teto de exaustão (ALTA confiança) | causa raiz confirmada |
| Batch de N+1 no upload | Round-trips/arquivo | **Milhares → dezenas** (ESTIMATIVA) | insert linha-a-linha → `COPY` |
| Brotli + `manualChunks` | Bytes 1ª visita | 261 KB → **~160–200 KB** (ESTIMATIVA) | Brotli-11 ~20% < gzip + split de vendor |
| Dropar `idx_chv_nfe` | Disco + writes c100 | **−327 MB** e menos custo de INSERT (CONFIRMADO no tamanho) | `pg_relation_size` |

*Sem carga real medível, os ganhos de latência absoluta permanecem estimativas. Reexecutar com `pg_stat_statements` + APM para números finais.*

---

## 15. RISCOS TÉCNICOS

- **Alto:** parse síncrono de SPED torna o backend **frágil sob concorrência** — um único export longo degrada todos os usuários (Cadeia 1).
- **Alto:** subir `shared_buffers` sem cuidar do teto de RAM **sem swap** pode aproximar de OOM em pico → **provisionar swap antes**.
- **Médio:** `app.audisped.com.br` sem cert válido — se for o host oficial da app, usuários pegam erro de TLS; e o loop de ACME arrisca rate-limit do Let's Encrypt.
- **Médio:** ausência total de alerta = incidente só é descoberto pelo usuário reclamando.
- **Cruzamento de segurança (fora do escopo de perf, mas visto):** query `column "public.redes" does not exist` sugere input não sanitizado — **verificar contra o item SQLi V14 pendente** do `PLANO_CORRECAO_SEGURANCA`.

---

## 16. LIMITAÇÕES DA AUDITORIA

1. **Sistema ocioso durante a coleta** → sem P50–P99, RPS, taxa de erro sob carga.
2. **`pg_stat_statements` ausente e slow-log desligado** → sem TOP-20 queries reais.
3. **Sem load test** (proibido em produção) → magnitudes de latência são estimativas.
4. **Logs do backend só voltam ~16 min** (recreate do container zerou o json-log) → sem histórico pré-deploy.
5. **Sem métricas históricas** → sem tendência de memória/CPU/latência.
6. **Bloat estimator** não rodou (erro de transporte) → usado proxy por dead-tuples.
7. **TTFB medido em loopback** → não reflete rede real; domínio dá NXDOMAIN externo.

---

## 17. DADOS AINDA A COLETAR (para fechar a auditoria)

- Instalar `pg_stat_statements` + slow-log 500 ms e **coletar 1–2 semanas** → TOP-20 queries reais.
- APM/RUM (Web Vitals de campo: LCP/FCP/INP) → validar hipóteses do frontend.
- Load test em **staging/réplica** (nunca em produção) replicando 5–10 exports concorrentes → medir o ponto de exaustão do pool e o stall do event-loop.
- `EXPLAIN (ANALYZE)` das queries de análise/export **com dados reais** (após capturar o SQL exato).
- Confirmar limite efetivo de file descriptors do container Node sob carga.

---

## 18. CONCLUSÃO TÉCNICA FINAL

O AudiSped **não tem problema de hardware** — tem **folga de sobra** de CPU, RAM e disco, e opera de forma limpa e estável (sem crashes, OOM, deadlocks ou leaks). O que limita a performance é **arquitetura de aplicação e configuração**, e concentra-se em **três alavancas de alto retorno**:

1. **Tirar o parsing de SPED do event-loop** (worker_threads/streaming) — acaba com o travamento global sob carga.
2. **Tunar o Postgres e alinhar o pool** (5 parâmetros de config + teto de conexões) — quick win de baixo esforço e alto impacto, elimina os 503 em lote e o I/O desnecessário.
3. **Instrumentar** (pg_stat_statements + slow-log + healthcheck + alertas) — transforma um sistema cego num diagnosticável, e é pré-requisito para medir tudo o mais.

Executadas as Fases 1–2 (majoritariamente configuração, baixo risco) e depois a Fase 3 (código), o sistema ganha resiliência sob concorrência sem necessidade de mais hardware. **Prioridade nº 1 de curto prazo, porém: instalar observabilidade** — sem ela, toda otimização futura continua sendo feita no escuro.

> **Nenhuma alteração foi realizada. Todas as recomendações exigem uma janela de manutenção e validação prévia (idealmente em réplica/staging).**
```
```
