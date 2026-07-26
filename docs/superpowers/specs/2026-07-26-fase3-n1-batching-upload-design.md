# Fase 3 (#6) — Batching dos inserts N+1 no upload de SPED

**Data:** 2026-07-26
**Origem:** AUDITORIA_PERFORMANCE_2026-07-14.md, gargalo #6 ("N+1 em upload / de-para / cascata")
**Autor:** Esmael + Claude
**Status:** Design aprovado (aguardando revisão do spec)

## Contexto e evidência

Reavaliação de performance com `pg_stat_statements` (janela ~11 dias, reset 2026-07-15) mostrou que **o Postgres não é o gargalo** — o TOP por tempo é o `pg_dump` noturno (COPY TO stdout), não carga de app. O único padrão de app comprovado por dado duro é o **N+1 de escrita no upload**:

| Loop | calls (11d) | ms/call | site atual |
|---|---|---|---|
| `INSERT documentos_c190` | **253.150** | 0,1 | server.js:1247 |
| `INSERT documentos_c100` | **249.447** | 0,1 | server.js:1237 |
| `INSERT sped_1320` | 15.784 | 0,1 | ~server.js:1198 |
| `INSERT sped_participantes` | 4.519 | 0,1 | server.js:1223 |
| `INSERT documentos_itens_c170` | 3.448 | 0,1 | server.js:1242 |
| `INSERT sped_produtos` | 2.659 | 0,1 | server.js:1230 |

Cada INSERT custa 0,1ms **no banco**; a dor é a quantidade de round-trips (~530k) e o tempo preso no event-loop single-thread do Node. Todos os laços vivem na mesma transação do `POST /api/upload` ([server.js:1088-1278](../../../backend/server.js#L1088-L1278)), COMMIT em 1253.

## Escopo

**Dentro:** batear os inserts do laço de upload — a cascata C100→C170→C190 (server.js:1236-1250) e os laços irmãos sped_1320, documentos_d100, sped_participantes (0150), sped_produtos (0200). Tudo em **localhost**, sem git/prod sem OK explícito (fluxo localhost→testar→autorizar).

**Fora (decisão do Esmael, 2026-07-26):**
- **#1 parse SPED em worker_threads** — gateado até um load-test / medição de event-loop lag. O stall global é estrutural mas nunca foi medido sob carga (auditoria foi ociosa).
- Sites de baixo volume citados pelo relatório (de-para por item, UPDATE lmc cascata = 1.362 calls). Os números de linha do relatório (1447/7197/7311) **derivaram** — o server.js cresceu de ~10k→11.322 linhas; hoje apontam para outro código. Fonte da verdade = `pg_stat_statements`.
- Quick-wins de config de produção (alinhar `pool.max`↔`max_connections`, `shared_buffers`, dropar o índice morto `idx_chv_nfe` de 348MB). São ops de prod, recomendação separada.

## Abordagem — C (UNNEST bulk insert)

Trocar cada laço `for … await query` por **um** `INSERT … SELECT * FROM unnest($1::tipo[], …)` por tabela, passando cada coluna como uma array. Vantagens sobre multi-row VALUES: uma array-param por coluna dribla o limite de 65535 params/statement (sem necessidade de chunk para o volume por arquivo), e a ordem do `unnest`/`RETURNING` é preservada.

### Cascata C100 → C170/C190 (o nó técnico)

O C100 é SERIAL e os filhos dependem do id gerado. Sequência:

1. **C100 em lote com RETURNING id**, na ordem do array `documents`:
   ```sql
   INSERT INTO documentos_c100 (id_sped_arquivo, ind_oper, num_doc, cod_mod, cod_sit,
       dt_doc, dt_e_s, vl_doc, cod_part, chv_nfe)
   SELECT * FROM unnest($1::int[], $2::text[], …)
   RETURNING id
   ```
   Postgres preserva a ordem do `unnest` no `RETURNING` → `rows[i].id` corresponde a `documents[i]`.
2. Construir arrays **planas** dos filhos: para cada doc `i` com `id_i`, expandir seus `items` (C170) e `analytical` (C190) com o pai `id_i`.
3. **C170 em lote** e **C190 em lote** via `unnest`, usando as arrays planas.

### Laços irmãos

`unnest` bulk preservando **exatamente** os `ON CONFLICT` atuais:
- sped_1320: `ON CONFLICT (id_sped_arquivo, data_mov, cod_item, num_tanque, num_bico) DO NOTHING`
- sped_participantes: `ON CONFLICT (id_sped_arquivo, cod_part) DO NOTHING`
- sped_produtos: `ON CONFLICT (id_sped_arquivo, cod_item) DO UPDATE SET ncm = EXCLUDED.ncm`
- documentos_d100: sem conflito (insert direto)

Tudo permanece **dentro da mesma transação** (COMMIT em 1253 intacto); rollback atômico preservado.

## Correção / garantia byte-idêntico

- **Export não é afetado:** `/api/exportar-sped` lê o **.txt físico** (`caminho_arquivo` → `readFileSync`), não estas tabelas. O batching não pode mudar os bytes exportados.
- **Analisador é o que importa:** ~30 rotas leem `documentos_c100/c190/c170` (Analisador, agregados CFOP). Como o batching insere **as mesmas linhas na mesma ordem**, os ids saem monotônicos na mesma sequência de antes → resultados de query idênticos.
- **Risco de ordem:** o único requisito é preservar a ordem de inserção (arrays na ordem dos loops originais). Coberto pelo teste de snapshot.

## Testes (TDD)

Escrever o teste **antes** do refactor, capturar baseline no código atual, refatorar, exigir idêntico.

1. **NOVO — `tests/import-snapshot.test.js`:** importa fixtures SPED via o caminho de upload, e faz snapshot de:
   - contagem de linhas por tabela (c100/c170/c190/1320/d100/participantes/produtos)
   - sha256 de `SELECT … FROM documentos_c100 c JOIN c170 JOIN c190 WHERE id_sped_arquivo=X ORDER BY c100.id, c170.num_item, c190.cst_icms, c190.cfop` (conteúdo + ordem)
   - saída das queries agregadas do Analisador (ex.: soma CFOP por c190)
   - **contador de round-trips:** envolver `client.query` e contar chamadas `INSERT` durante o import.
   Baseline (código atual) → refactor → `assert` idêntico nos snapshots **e** contagem de INSERTs caindo de milhares → dezenas.
   **Fixtures:** **1326** (APACHE — bicos/1320/LMC, caso mais complexo) **+ 1898** (mais recente, forma diferente), cobrindo bordas da cascata (nota sem C170, C100 sem C190).
2. **`node tests/golden-export.js check`** — export byte-idêntico sobre o **conjunto inteiro** do manifest (7 fixtures); deve ficar verde trivialmente (belt-and-suspenders).
3. **`npm run test:validador`** — suíte 218/218 verde.

Fixtures disponíveis em `tests/golden/` (1085, 1326=APACHE 01/2021, 1546, 1662, 1873, 1897, 1898).

**Nota:** NÃO depender do `pg_stat_statements` no localhost (é config de prod, pode não estar instalado). A prova de round-trips vem do contador instrumentado no teste.

## Rollback e risco

- Mudança confinada ao laço de upload em `server.js` (um arquivo). Rollback = `git checkout`.
- **Risco: Baixo.** Só localhost; sem commit/push/deploy sem OK explícito do Esmael.
- Restart manual do backend após a mudança (roda como `node server.js` puro, sem nodemon).

## Critérios de aceite

- [ ] `tests/import-snapshot.test.js` verde (idêntico antes/depois).
- [ ] `node tests/golden-export.js check` verde.
- [ ] `npm run test:validador` 218/218.
- [ ] Round-trips do upload de um arquivo: de milhares → dezenas (medido pelo contador de queries instrumentado no teste).
- [ ] Comportamento do Analisador visualmente inalterado num upload de teste real.
