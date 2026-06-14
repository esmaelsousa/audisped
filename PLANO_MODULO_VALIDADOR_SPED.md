# Plano de Implementação — Módulo VALIDADOR de SPED Fiscal

> **Status:** Planejamento | **Data:** 2026-06-14
> **Relacionados:** [CATALOGO_ERROS_SPED.md](CATALOGO_ERROS_SPED.md) (≈80 regras) · [PLANO_CORRECAO_ERROS_SPED.md](PLANO_CORRECAO_ERROS_SPED.md) (estratégia/QA/roadmap)
> **Princípio inviolável:** o módulo é **ADITIVO e ISOLADO** — não pode alterar o comportamento de nenhuma função atual (export, injeção, LMC, conciliação, análise).

---

## 1. Objetivo e escopo

**Objetivo:** ao importar um SPED Fiscal, o sistema o lê, roda **todas as regras** do catálogo varrendo **todos os blocos** (cobertura visível por bloco — o "X"), e entrega uma **página estilo PVA** com os erros **clicáveis** → cada erro mostra detalhe, **como corrigir no ERP do cliente** e a opção de **corrigir no nosso sistema** (o cliente decide auto ou manual). Ao final, o sistema **re-valida** e exporta um **SPED novo corrigido**.

**Está no escopo:** detecção (read-only) de erros por bloco; relatório navegável; instrução de correção no ERP; correção opt-in (auto/manual) via overrides; re-validação do arquivo final; export do corrigido (reusando o export atual).

**NÃO está no escopo (e por quê):**
- Reescrever totalizadores/estrutura → **o export já faz** (reusar, não duplicar).
- Garantir "100% do que o PVA pega" → validamos contra **N regras conhecidas** + cobertura por bloco; honestidade: o PVA pode ter validações que ainda não mapeamos (mostrar disclaimer e versão do catálogo).
- Corrigir mérito fiscal automaticamente sem confirmação → **proibido** (ver §6).

---

## 2. Questionando o seu pensamento (decisões de engenharia)

1. **"Sistema corrige e exporta SPED corrigido"** → **não criar motor de correção novo.** O export atual já corrige ~15 classes (X990, 0220, 0221, CFOP entrada, CST 61→60, uso/consumo x90, coerência 1300/1310, dedup C100/D100, CAP_TANQUE, E210 retenção ST, regras fiscais). O Validador **reusa o export** e só acrescenta as correções manuais como **dados (overrides)**. Construir um corretor paralelo = divergência garantida + risco às funções atuais.
2. **Validar o quê: o .txt original, o banco, ou o exportado?** → **validar os BYTES que serão transmitidos = a saída do export.** Lembrete do projeto: "Analisador lê o banco; export lê o .txt — camadas distintas, podem divergir". O PVA valida o `.txt`. Então: **2 passagens** — (a) valida o **original** (mostra os erros "como estão no ERP" + instrução de correção na origem); (b) valida o **exportado** (mostra o que sobra **depois** das nossas auto-correções). O que liberamos para download = o que validamos.
3. **"Não deixar passar nada"** é inalcançável literalmente; o honesto é **cobertura por bloco**: o relatório mostra, por bloco, quantas regras rodaram e quantos erros achou (o "X" = bloco varrido). Mais regra = mais cobertura, incrementalmente.
4. **A correção primária é no ERP, não no nosso export.** Corrigir só no nosso arquivo é "remendo de retificação" — mês que vem o ERP gera o mesmo erro. Por isso a **instrução de correção no ERP é obrigatória por regra**; a correção no nosso sistema é para **transmitir agora**.
5. **Nem todo erro é auto-corrigível.** Classificar cada regra (§6): estrutural-seguro (auto), fiscal-determinístico (sugestão, confirmar), mérito (manual/ERP). **Nunca** auto-corrigir campo fiscal silenciosamente.
6. **Reusar a detecção que já existe SEM tocá-la.** As detecções atuais (CRIT-*, `analisar-sintaxe`, validações-1320) vivem espalhadas e algumas **gravam no banco** (`/api/analisar` grava `erros_analise`). O Validador **não chama** essas com efeito colateral — reimplementa a detecção como **funções puras read-only** no novo módulo (detecção é barata e segura de duplicar; o perigoso de duplicar é a correção, que evitamos).

---

## 3. Arquitetura (isolada e reaproveitando o export)

```
                          ┌─────────────────────── MÓDULO VALIDADOR (novo, isolado) ──────────────────────┐
 Upload .txt  ─────────▶  │  parser (1 passagem → modelo indexado)                                         │
 (ou id_sped já no banco) │        │                                                                       │
                          │        ▼                                                                       │
                          │  RULE ENGINE (registry de regras puras, por bloco)  ── lê catálogo            │
                          │        │  cobertura por bloco (o "X")                                          │
                          │        ▼                                                                       │
                          │  RELATÓRIO (val_erros)  ── severidade, linha, campo, sugestão, instrução ERP   │
                          └──────────────┬─────────────────────────────────────────────────────────────────┘
                                         │  cliente decide: auto / manual / ignorar (por erro ou em lote)
                                         ▼
                          correções → OVERRIDES (val_correcoes + tabelas existentes de_para/sped_1320/lmc)
                                         │
                                         ▼
            ╔═══════ EXPORT ATUAL (reusado, NÃO duplicado) ═══════╗   ← já recalcula X990, dedup, 0220, CST61, x90…
            ║  /api/exportar-sped  + consumo OPT-IN de val_correcoes ║
            ╚════════════════════════┬═══════════════════════════════╝
                                     ▼  .txt final (bytes que vão ao Fisco)
                          RULE ENGINE roda DE NOVO no .txt final  →  gate: 0 BLOQUEANTES?
                                     │ sim
                                     ▼
                          Download do SPED corrigido + relatório (PDF/Excel)
```

**Componentes novos (todos isolados):**
| Camada | Item novo | Observação de isolamento |
|---|---|---|
| Backend service | `backend/services/validador/` (`parser.js`, `engine.js`, `rules/*.js`, `report.js`) | diretório novo; não importa nada que mute estado |
| Backend rotas | `/api/validador/*` (montadas num router próprio) | namespace novo; nenhuma rota existente alterada |
| Regras | 1 arquivo por regra (`rules/bloco_c/cst_cfop_aliq.js` …) | interface §5; espelha o catálogo |
| Banco | tabelas `val_execucoes`, `val_erros`, `val_correcoes` | prefixo `val_`; **nenhuma** tabela existente alterada |
| Frontend | `ValidadorView.vue` (rota `/validador/:id`) + componentes | rota nova; views atuais intocadas |
| Export | **reuso** do `/api/exportar-sped` + leitura **opt-in** de `val_correcoes` | única mudança no código existente — aditiva e protegida por testes (§10) |

---

## 4. Fluxo detalhado

1. **Carregar** o SPED (upload novo OU `id_sped_arquivo` já importado).
2. **Parse** em 1 passagem → modelo indexado (por bloco, por registro, por nota/chave, hierarquia pai/filho).
3. **Validação (original)** → roda todas as regras → grava `val_erros` (com `origem='ORIGINAL'`).
4. **Relatório estilo PVA** → página com erros agrupados por bloco + severidade, clicáveis.
5. **Por erro:** detalhe (registro, linha, campo, valor atual, sugestão), **como corrigir no ERP**, e ações: `[Corrigir aqui]` (se auto-corrigível) · `[Editar valor]` (manual) · `[Ignorar]`.
6. **Aplicar correções** → grava overrides (`val_correcoes` e/ou de_para/sped_1320/lmc). Original **nunca** é alterado.
7. **Exportar corrigido** → chama o **export atual** (que já aplica auto-correções + consome `val_correcoes`).
8. **Re-validação (final)** → roda as regras no `.txt` exportado → `val_erros` com `origem='EXPORTADO'`. **Download SEMPRE liberado** (decisão: não bloquear), mesmo com BLOQUEANTE — mas acompanha **relatório de erros + advertências** e **aviso legal** de que o cliente é responsável pela transmissão.
9. **Download** do SPED corrigido + relatório (PDF/Excel) com o antes/depois (erros bloqueantes e advertências separados).

---

## 5. Interface de regra (registry)

```js
module.exports = {
  id: 'DOC-C170-04',
  bloco: 'C',
  registro: 'C170',
  titulo: 'Combinação CST_ICMS × CFOP × ALIQ incompatível',
  severidade: 'BLOQ',                  // BLOQ | ADV
  classeCorrecao: 'fiscal-deterministico', // estrutural-seguro | fiscal-deterministico | manual
  jaCorrigidoNoExport: false,          // true = só EXIBE (export já resolve)
  detectar: (model) => [ { linha, registro, campo, valorAtual, contexto } ],
  sugerir: (erro, model) => ({ valorSugerido, justificativa }),
  instrucaoERP: (erro) => 'No ERP, ajuste o CST do produto X para 060 (revenda monofásica)…',
  corrigir: (erro, valorNovo) => ({ tabela:'val_correcoes', patch:{...} }) // opcional; gera OVERRIDE, não edita .txt
}
```
Engine: carrega todas as regras → `detectar` em todas → agrega cobertura por bloco. **Determinístico e auditável** (sem LLM no núcleo).

---

## 6. Classificação de correção (segurança fiscal)

| Classe | Exemplos | Auto-corrige? |
|---|---|---|
| **estrutural-seguro** | X990, 0220, dedup C100/D100, 0221, nº de campos | ✅ já no export; Validador só **exibe** como "corrigido automaticamente" |
| **fiscal-determinístico** | CST 61→60 pré-vigência, uso/consumo→x90, CFOP entrada inexistente, PIS/COFINS 04 | ⚠️ auto **com confirmação** (cliente liga/desliga); já há regras |
| **manual / ERP** | CEST/NCM errado, IE inválida, valor de item, mérito de CST | ❌ nunca auto; só instrução ERP + edição manual confirmada |

Regras: original sempre preservado; toda correção é **reversível** e tem **trilha** (`val_correcoes`: origem MANUAL/AUTO, usuário, data, valor_original→valor_corrigido). Campo fiscal **nunca** muda sem ação explícita do cliente.

---

## 7. UX — página estilo PVA (clicável)

- **Cabeçalho:** empresa, CNPJ, período, versão do catálogo, [Re-validar] [Exportar corrigido ▾].
- **Cobertura por bloco** (o "X"): chips `0 ✓ | C ⚠ 12 | D ✓ | E ⚠ 3 | 1 ✓ | H ✓ | 9 ✓` — verde = sem erro, âmbar/vermelho = nº de erros; mostra quantas regras rodaram por bloco.
- **Filtros:** bloco · severidade (BLOQ/ADV) · status (aberto/corrigido/ignorado) · classe de correção.
- **Lista clicável** → clicar leva ao **detalhe** (registro, linha nº, campo, valor atual, sugestão, instrução ERP, trecho do .txt com a linha destacada) + ações.
- **Barra de progresso:** "47 erros (12 bloqueantes) → 0 bloqueantes" antes de liberar export.
- Reusa o layout já desenhado no [PLANO_CORRECAO_ERROS_SPED.md](PLANO_CORRECAO_ERROS_SPED.md) (Fase 1).

---

## 8. Modelo de dados (tabelas novas, prefixo `val_`)

```sql
CREATE TABLE val_execucoes (
  id SERIAL PRIMARY KEY,
  id_sped_arquivo INT REFERENCES sped_arquivos(id),
  origem VARCHAR(12),        -- 'ORIGINAL' | 'EXPORTADO'
  versao_catalogo VARCHAR(20),
  total_erros INT, total_bloqueantes INT,
  cobertura_blocos JSONB,    -- { "C": {regras:18, erros:12}, ... }
  criado_em TIMESTAMP DEFAULT NOW()
);
CREATE TABLE val_erros (
  id SERIAL PRIMARY KEY,
  id_execucao INT REFERENCES val_execucoes(id),
  regra_id VARCHAR(40), bloco VARCHAR(2), registro VARCHAR(6),
  severidade VARCHAR(4), classe_correcao VARCHAR(24),
  linha_arquivo INT, campo VARCHAR(60),
  valor_atual TEXT, valor_sugerido TEXT, instrucao_erp TEXT,
  status VARCHAR(12) DEFAULT 'ABERTO'  -- ABERTO | CORRIGIDO | IGNORADO
);
CREATE TABLE val_correcoes (
  id SERIAL PRIMARY KEY,
  id_sped_arquivo INT, id_erro INT REFERENCES val_erros(id),
  regra_id VARCHAR(40), linha_arquivo INT, registro VARCHAR(6), campo VARCHAR(60),
  valor_original TEXT, valor_corrigido TEXT,
  origem VARCHAR(8),    -- MANUAL | AUTO
  usuario_id INT, criado_em TIMESTAMP DEFAULT NOW()
);
```
Nada disso altera tabelas existentes. O export passa a **ler** `val_correcoes` de forma **opt-in** (§10).

---

## 9. Onde a correção entra no export (a única mudança no código atual)

- **Recomendado (Opção A):** o export passa a aplicar `val_correcoes` (override genérico linha/campo) **depois** do de-para e **antes** do recálculo dos X990 (que ele já faz). Mudança **aditiva**: com `val_correcoes` vazia, o output é **byte-idêntico** ao de hoje (garantido por teste golden-file, §10).
- Reusa as tabelas de override que já existem onde couber: `de_para_xml` (CST/CFOP por produto), `sped_1320.corrigido` (encerrantes), `lmc_*_ajustado` (estoque).
- **Rejeitado (Opção B):** patcher pós-export que reescreve o `.txt` e recalcula totais por conta própria → duplica o totalizador → divergência. Não fazer.

---

## 10. Garantia de NÃO-IMPACTO (a exigência nº 1) — checklist verificável

1. **Namespaces novos:** rotas `/api/validador/*`, serviço `services/validador/`, tabelas `val_*`, view `/validador/:id`. Nada existente é renomeado/movido.
2. **Detecção 100% read-only:** o engine só lê (.txt + queries SELECT). Zero INSERT/UPDATE em tabelas existentes.
3. **Única alteração no código atual = leitura opt-in de `val_correcoes` no export**, aditiva e protegida por:
   - **Teste golden-file (Sprint 0):** para N arquivos reais, `export(hoje) == export(com módulo, val_correcoes vazia)` byte a byte. Se um byte mudar, falha o CI.
   - **Feature flag** `VALIDADOR_OVERRIDES_ENABLED` (default ON só lê; vazia = no-op).
4. **Módulo desativável:** flag `MODULO_VALIDADOR=off` remove as rotas/menu; resto do sistema idêntico.
5. **Sem refactor das detecções atuais** (CRIT-*, analisar-sintaxe, validações-1320) — permanecem como estão; o engine reimplementa em funções puras próprias.
6. **Original imutável:** o Validador nunca escreve no `.txt` original nem em `documentos_*`/`lmc_movimentacao` (colunas base) — só em `val_*` e overrides já consumidos pelo export.
7. **Revisão de impacto:** PR do módulo com diff restrito aos arquivos novos + 1 trecho aditivo no export; checklist de "nenhuma assinatura de função existente mudou".

---

## 11. Fases

```
Sprint 0 — Pré-requisito: arnês de teste golden-file do export (prova de não-impacto) + tabelas val_*.
Sprint 1 — Parser + Rule Engine + registry; portar do catálogo as regras BLOQUEANTES estruturais
           (nº de campos, X990, hierarquia, 0220/0221, dedup) como DETECÇÃO read-only. Relatório JSON.
Sprint 2 — Frontend ValidadorView estilo PVA (cobertura por bloco, lista clicável, detalhe, instrução ERP).
Sprint 3 — Correção: val_correcoes + leitura opt-in no export + re-validação do .txt final + gate.
           Exibir "corrigido automaticamente" para o que o export já resolve.   [feito; falta o GATE → §15]
Sprint 4 — Regras fiscais/combustível do catálogo (CST×CFOP×ALIQ, C190 do C170, CST61, x90, monofásico).
Sprint 5 — Apuração (E110/E116/E210) — DETECÇÃO + cruzamentos (o que o PVA não vê).   [detalhe §14]
Sprint 5.1 — Geração assistida de obrigações: val_obrigacoes + emissão de E116/E250 no export.   [detalhe §16]
Sprint 6 — Relatório PDF/Excel (antes/depois) + trilha de auditoria.
Sprint 7+ — IA só para erros ambíguos (núcleo permanece determinístico).
```

---

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Módulo impactar o export | Teste golden-file byte a byte + flag + diff restrito (§10) |
| Validador divergir do PVA real | Validar os **bytes exportados**; amostragem manual no PVA; mostrar versão do catálogo |
| Auto-correção fiscal errada | Classe de correção; fiscal nunca auto sem confirmação; reversível + trilha |
| "Corrigimos e o ERP continua errado" | Instrução de correção no ERP **obrigatória** por regra (correção primária na origem) |
| Tabelas (CFOP/NCM/CEST/ANP/IBGE) desatualizadas → falso-erro | Tabelas versionadas por competência (Sprint 0) |
| SPED grande (28k+ linhas) lento | Parse 1 passagem + índices; relatório paginado/agrupado |
| Cliente transmitir com BLOQUEANTE | Download liberado por decisão de negócio, mas com **relatório de erros+advertências** e **aviso legal explícito**; original sempre preservado |

---

## 13. Decisões (confirmadas em 2026-06-14)

1. ✅ **Correção no export = Opção A** — o export passa a ler `val_correcoes` (override genérico) de forma aditiva e opt-in, byte-idêntico quando vazio (protegido por golden-file).
2. ✅ **Entrada: ambos** — valida arquivo **já importado** (id_sped, reusa banco) **ou** aceita **upload avulso** só para conferência (sem importar).
3. ✅ **Download sempre liberado** (não bloqueia mesmo com BLOQUEANTE), porém **gera relatório de erros + advertências** e aviso legal — o cliente decide transmitir.
4. ✅ **Módulo NOVO** (`/validador/:id`), reusando o layout da "Central de Erros"; implementar incrementalmente pelos sprints da §11.

---

## 14. Detalhamento do Sprint 5 — Apuração (Bloco E) + cruzamentos

> **Status:** Planejamento (detalhado em 2026-06-14). **Não implementado** — Sprints 0–4 prontos; este é o próximo maior buraco funcional.
> **Princípio (mantido):** detecção 100% **read-only** sobre o `.txt`; **nenhuma** correção fiscal automática silenciosa; o validador **re-soma de forma INDEPENDENTE** e **confronta** o que o export produziu (verificação adversarial), em vez de duplicar o motor de correção.

### 14.1 Por que este sprint (dor real)
Dois erros de apuração **recorrentes do PVA** já documentados no projeto, hoje **não detectados nem fechados** pelo validador:
- **E110 × E116:** SPED original de vários postos (APACHE/LUBRIGEGEU…) vem com `E110.VL_ICMS_RECOLHER > 0` e **0 registros E116** → PVA acusa "soma E116 ≠ E110". Decisão registrada: **ADIADO** (Esmael, 2026-06-01) por exigir `COD_REC`/DARE + regra de vencimento do ICMS-BA. O Sprint 5 retoma isso de forma estruturada.
- **E210 (ICMS-ST):** apuração ST **não soma o ICMS_ST das entradas** (C190 com CFOP 1xxx/2xxx) em alguns casos → `VL_OUT_CRED_ST=0` / `VL_SLD_CRED_ST_TRANSPORTAR` divergente (erros E210 citados nos arquivos POSTO FREITAS Abr/2021 e Mai/2023). Hoje o export já tenta somar (ver 14.2), mas **ninguém verifica** o resultado.

### 14.2 O que o EXPORT já faz vs. o que FALTA (mapa factual)
Pipeline de apuração no export: `spedCostureiraService.js:393-398` → `recalcularE110` → `recalcularE210` → `injetarE200E210SeNecessario`.

| Registro | Export hoje | Lacuna que o Sprint 5 ataca |
|---|---|---|
| **E110** | `recalcularE110` (`spedCostureiraService.js:414-485`) recalcula **in-place** débito/crédito a partir de C190/C590/D190/D590; **não cria** E110 se ausente; **preserva** ajustes E111 (f[3]/f[5]/f[7]/f[9]). O streaming **não** recalcula E110 (`server.js:7132-7137`) para "não quebrar a validação E111". | Validar a **aritmética** do E110 (saldo, recolher, transportar) e a **coerência com Σ E111**; detectar **E110 ausente** quando há movimento. |
| **E111/E115** | Apenas **preservados** (não parseados, não conferidos). | Conferir `VL_TOT_AJ_DEBITOS (f[4]) = Σ E111 débito` e `VL_TOT_AJ_CREDITOS (f[8]) = Σ E111 crédito`. |
| **E116** | **Inexistente** — nunca gerado, somado nem validado. Única menção: mapa pai-filho em `r_hierarquia.js:9`. | **Detectar** `Σ E116.VL_OR ≠ E110.VL_ICMS_RECOLHER` e **E116 ausente** com recolher > 0 (o erro adiado). |
| **E210** | `recalcularE210` (`:500-601`) recalcula ST in-place; **soma ICMS_ST de C190 CFOP 1xx/2xx → `VL_OUT_CRED_ST` (f[6])** (`:517-531`, `:582`). Há um **2º** recálculo no streaming (`server.js:8348-8411`) com fórmula **diferente** para `f[14]`. | Verificar a soma ST de forma independente + **sinalizar a divergência entre os dois recálculos**. |
| **E220/E250** | E220 lido para ajustes; **E250** (ST a recolher) **não tratado**. | Detectar `Σ E250.VL_OR ≠ E210.VL_ICMS_RECOL_ST` e E250 ausente. |

**Banco:** não há tabelas de bloco E (`sped_e110/e116/e210`); apuração só existe em memória sobre o `.txt`. → O validador tem **tudo no `.txt` parseado** (E1xx/E2xx + C190/D190 com `VL_ICMS` c[7], `VL_ICMS_ST` c[9], CFOP c[3], e COD_SIT do pai) para reimplementar as somas como **regra**.

### 14.3 Regras novas do Sprint 5 (registry `rules/bloco_e/*.js`)

| id | registro | título | sev. | classe |
|---|---|---|---|---|
| `APUR-E110-DEB` | E110 | `VL_TOT_DEBITOS` ≠ Σ ICMS débito (C190/C590/D190/D590, CFOP 5/6/7) | BLOQ | fiscal-determinístico (já corrigido no export → exibir) |
| `APUR-E110-CRED` | E110 | `VL_TOT_CREDITOS` ≠ Σ ICMS crédito (CFOP 1/2/3) | BLOQ | idem |
| `APUR-E110-ARIT` | E110 | Saldo/recolher/transportar incoerentes (`f11/f13/f14` vs fórmula) | BLOQ | estrutural-seguro (export recalcula) |
| `APUR-E110-E111` | E110 | `VL_TOT_AJ_DEB/CRED` (f4/f8) ≠ Σ ajustes E111 | BLOQ | manual (ajuste é mérito) |
| `APUR-E110-AUSENTE` | E110 | há movimento de ICMS mas **não existe E110** | BLOQ | manual/ERP |
| `APUR-E116-SOMA` | E116 | `Σ E116.VL_OR` ≠ `E110.VL_ICMS_RECOLHER` | BLOQ | **manual** (ver 14.5) |
| `APUR-E116-AUSENTE` | E116 | `VL_ICMS_RECOLHER>0` e **0 E116** (o erro adiado) | BLOQ | **manual/semi-auto** (14.5) |
| `APUR-E210-OUTCRED` | E210 | `VL_OUT_CRED_ST` não inclui Σ ICMS_ST das entradas (C190 CFOP 1/2) | BLOQ | fiscal-determinístico (export soma → exibir/conferir) |
| `APUR-E210-ARIT` | E210 | `VL_SLD_CRED_ST_TRANSPORTAR`/`VL_ICMS_RECOL_ST` incoerentes | BLOQ | estrutural-seguro |
| `APUR-E250-SOMA` | E250 | `Σ E250.VL_OR` ≠ `E210.VL_ICMS_RECOL_ST` | BLOQ | manual (14.5) |

Severidade default **BLOQ** (PVA rejeita), exceto onde a competência/leiaute tornar o campo opcional → **ADV**.

### 14.4 Detalhe das regras-chave

**`APUR-E110-DEB` / `APUR-E110-CRED`** — reimplementa, como verificação, a mesma soma do export:
- débito = Σ `VL_ICMS` (c[7]) de C190/C590/D190/D590 com CFOP de saída (1º díg. 5/6/7, exceto 5605), ignorando docs com COD_SIT 02–05 (cancelado/denegado);
- crédito = idem para CFOP de entrada (1/2/3, exceto 1605/2605/5605);
- comparar com `E110.f[2]`/`f[6]` (tolerância R$0,01). **Se o validador roda sobre o `.txt` EXPORTADO**, essas devem fechar (export recalcula) → divergência aqui = **bug do nosso export** (sinal de alerta valioso). Rodando sobre o **original**, a divergência é erro do ERP → instrução de correção na origem.

**`APUR-E116-SOMA` / `APUR-E116-AUSENTE`** — `Σ E116.f[2]` deve igualar `E110.f[13]`. Se faltam E116, listar o valor que precisa ser declarado. **Esta é a dívida adiada de 2026-06-01** → tratamento em 14.5.

**`APUR-E210-OUTCRED`** — somar `VL_ICMS_ST` (c[9]) dos C190 com CFOP 1/2 e confrontar com a parcela esperada em `E210.f[6] VL_OUT_CRED_ST` (o export já injeta isso em `:582`). Verificar também `VL_SLD_CRED_ST_TRANSPORTAR` (saldo credor ST do período → transporta p/ o mês seguinte). **Atenção monofásico:** créditos de CST 60 (combustível ST já retido) **não** geram crédito ressarcível comum — o cruzamento precisa filtrar por CST/CFOP para não inflar o ST (alinha com o pendente "Plano ICMS Tributário XML Fase 3").

### 14.5 O nó do E116/E250 — por que NÃO é auto-corrigível (e o caminho)
Gerar E116/E250 **não é determinístico só com o `.txt`**: exige dados de negócio externos — `COD_REC` (código de receita do ICMS-BA / DARE), `DT_VCTO` (regra de vencimento por UF/competência/regime) e eventual `NUM_PROC`. Portanto:
- **Detecção:** sempre (regra read-only acusa a falta/divergência) — **entra já no Sprint 5**.
- **Correção:** **classe manual** por padrão (instrução: "lance a obrigação no ERP/portal com COD_REC e vencimento corretos"). Opcional **semi-automático** num passo futuro: uma tabela de overrides de obrigação (`val_obrigacoes`: competência, COD_REC, regra de vencimento por UF) que o export consumiria para **emitir** o E116/E250 — **fora do escopo do Sprint 5** (sinalizar como Sprint 5.1), pois envolve calendário fiscal e não pode ser chutado.
- Enquanto isso, **respeitar a decisão de 2026-06-01**: a regra `APUR-E116-AUSENTE` nasce com **flag de competência** e pode ser **silenciada** (ADV em vez de BLOQ) por configuração, para não poluir o relatório dos arquivos legados onde o cliente já optou por adiar.

### 14.6 Risco "dois cérebros" (validador × export) — usar a favor
O validador re-soma E110/E210 com lógica **própria**, paralela a `recalcularE110/E210`. Isso é o risco de divergência que sempre acompanha duplicação — **mas aqui é desejável**: como o validador roda sobre os **bytes exportados** (§3, item 2), ele vira um **verificador independente** do export. Mitigações:
- as constantes compartilhadas (listas de CFOP débito/crédito, CST que não creditam, COD_SIT cancelado) ficam num **único módulo** `rules/bloco_e/_apuracao_base.js`, **espelhando** (com teste) as listas do export — sem importar o export (mantém isolamento);
- **teste cruzado** (Sprint 5 / arnês): para os arquivos golden, `export → revalidar` deve dar **0 divergência de apuração**; qualquer divergência é bug de um dos lados e **falha o CI**. Fecha justamente o gap nº 1 levantado na auditoria do módulo.

### 14.7 Cruzamentos que "o PVA não vê" (bônus do sprint)
Validações de **coerência econômica** além da sintaxe do PVA, todas como **ADV** (não bloqueiam, orientam):
- `VL_ICMS_RECOLHER` do E110 vs. **somatório das guias/E116** já pagas (quando informadas) — aponta recolhimento a maior/menor.
- **Crédito ST acumulado** crescendo mês a mês sem ressarcimento (`VL_SLD_CRED_ST_TRANSPORTAR` monotônico) — sinaliza ressarcimento/abatimento esquecido.
- **Saídas tributadas sem débito** correspondente no E110 e **entradas com crédito** de CST que não credita (60/10/30) — incoerência CST×apuração.
- Coerência **E110 ↔ Bloco 1 (LMC)**: combustível monofásico (CST 61/60) **não** deve gerar débito/crédito ICMS comum no E110 — cruza com as regras de combustível do Sprint 4.

### 14.8 Posições de campo (referência — confirmar contra o leiaute da competência)
**E110** (split `|`, `f[1]=REG`): `f2`VL_TOT_DEBITOS `f3`VL_AJ_DEBITOS `f4`VL_TOT_AJ_DEBITOS `f5`VL_ESTORNOS_CRED `f6`VL_TOT_CREDITOS `f7`VL_AJ_CREDITOS `f8`VL_TOT_AJ_CREDITOS `f9`VL_ESTORNOS_DEB `f10`VL_SLD_CRED_ANT `f11`VL_SLD_APURADO `f12`VL_TOT_DED `f13`VL_ICMS_RECOLHER `f14`VL_SLD_CREDOR_TRANSPORTAR `f15`DEB_ESP. (fonte: `spedCostureiraService.js:404-482`)
**E116:** `f2`VL_OR `f3`DT_VCTO `f4`COD_REC `f5`NUM_PROC `f6`IND_PROC `f7`PROC `f8`TXT_COMPL `f9`MES_REF.
**E111:** `f2`COD_AJ_APUR (o tipo deb/cred/estorno vem da tabela 5.1.1 pelo código) `f3`DESCR_COMPL_AJ `f4`VL_AJ_APUR.
**E210** (ICMS-ST, 15 campos; o export injeta a ST das entradas em `VL_OUT_CRED_ST`): `f2`IND_MOV_ST `f3`VL_SLD_CRED_ANT_ST `f4`VL_DEVOL_ST `f5`VL_RESSARC_ST `f6`VL_OUT_CRED_ST `f7`VL_AJ_CREDITOS_ST `f8`VL_RETENCAO_ST `f9`VL_OUT_DEB_ST `f10`VL_AJ_DEBITOS_ST `f11`VL_SLD_DEV_ANT_ST `f12`VL_DEDUCOES_ST `f13`VL_ICMS_RECOL_ST `f14`VL_SLD_CRED_ST_TRANSPORTAR `f15`DEB_ESP_ST. ⚠️ A numeração varia por versão de leiaute — a regra deve ler as posições **da versão do `0000`** (como o export faz), não fixar índices. (fonte: `spedCostureiraService.js:500-601`; 2º recálculo `server.js:8348-8411`)
**E250:** `f2`VL_OR `f3`DT_VCTO `f4`COD_REC `f5`NUM_PROC `f6`IND_PROC `f7`PROC `f8`TXT_COMPL `f9`MES_REF.

### 14.9 Entregáveis e ordem
1. `rules/bloco_e/_apuracao_base.js` (listas CFOP/CST/COD_SIT + parser de posições por versão de leiaute).
2. Regras E110 (DEB/CRED/ARIT/E111/AUSENTE) — começar por DEB/CRED/ARIT (mais determinísticas).
3. Regras E210 (OUTCRED/ARIT) reusando a base ST.
4. Regras E116/E250 (SOMA/AUSENTE) com flag de competência (14.5).
5. Cruzamentos ADV (14.7).
6. Teste cruzado export↔validador no arnês golden (14.6).

### 14.10 Critérios de aceite
- Rodando sobre os **arquivos golden exportados**: **0 divergência** E110-DEB/CRED/ARIT e E210-OUTCRED/ARIT (prova de que validador e export concordam).
- Rodando sobre os **originais legados** (APACHE/LUBRIGEGEU/POSTO FREITAS): a regra `APUR-E116-AUSENTE` reproduz exatamente os erros que o **PVA** apontou nesses arquivos (validação contra realidade conhecida).
- `APUR-E116-AUSENTE` **silenciável** por competência (respeita o adiamento de 2026-06-01) sem afetar as demais regras.
- Nenhuma alteração em função existente; tudo em `rules/bloco_e/*` + registro no `rules/index.js` (aditivo).

---

## 15. Detalhamento — pendência do Sprint 3: o GATE de download

> **Estado atual:** o ciclo já fecha — `POST /api/validador/revalidar/:id` **re-exporta internamente** (`fetch /api/exportar-sped/:id`) e valida os **bytes reais** que iriam ao Fisco (`resultado.validadoSobre='exportado'`). Falta só o **gate**: o passo que confronta o cliente com os erros **residuais** antes de baixar.

### 15.1 Que tipo de gate (alinhar com a decisão §13.3)
A decisão de negócio é **"download sempre liberado"** (mesmo com BLOQUEANTE). Logo o gate **não é um bloqueio rígido** — é um **gate de consentimento informado** (soft gate):
- antes de o download começar, o sistema **re-valida o exportado** e, se houver **BLOQUEANTES residuais**, abre um **modal de confirmação** com a lista resumida + **aviso legal** ("você está transmitindo um arquivo com N erros que o PVA tende a rejeitar; a responsabilidade pela entrega é sua");
- o cliente confirma **"Baixar mesmo assim"** ou **"Voltar e corrigir"**;
- **0 bloqueantes** → download direto, sem modal (caminho feliz).

> Por que não bloquear de verdade: há erros legados que o cliente **opta** por transmitir (ex.: E116 adiado, E110×E116 do ERP) — travar o download inviabilizaria o uso real. O gate **educa e registra**, não impede.

### 15.2 Onde mora (sem mexer no export)
Tudo no **frontend** + reuso do endpoint já existente:
1. `baixarCorrigido()` deixa de abrir a URL direto; passa a **chamar `revalidar` primeiro** (que já roda sobre os bytes exportados).
2. Se `resumo.bloqueantes > 0` → abre o modal (componente novo `GateDownloadModal.vue`); senão, dispara o `window.open` do export.
3. O texto do modal lista `regra_id · registro · linha` dos bloqueantes (já vêm no retorno do `revalidar`).
4. **Trilha:** registrar a confirmação ("baixou com N bloqueantes em DT") — campo novo em `val_execucoes` (`baixado_com_bloqueantes INT`, `confirmado_em TIMESTAMP`) **ou**, até existir `val_execucoes`, um log no servidor. Nenhuma alteração no export.

### 15.3 Critérios de aceite
- Arquivo **sem** bloqueantes residuais → download **sem** modal (não atrapalha o fluxo bom).
- Arquivo **com** bloqueantes → modal aparece, lista correta, e **só** baixa após confirmação explícita.
- O gate usa **exclusivamente** o resultado do `revalidar` (bytes exportados) — nunca a validação do original (senão mostraria erros que o export já corrigiu).
- Zero alteração em `/api/exportar-sped` e no `spedCostureiraService` (o gate é 100% camada de UI + endpoint já existente).

---

## 16. Detalhamento — Sprint 5.1: geração assistida de E116/E250 (`val_obrigacoes`)

> **Pré-condição:** Sprint 5 entregue (a **detecção** `APUR-E116-*` / `APUR-E250-*` já acusa a falta/divergência). O 5.1 dá o passo seguinte: **emitir** os registros faltantes — mas só com **dados que o cliente confirma**, nunca chutados.

### 16.1 Por que é um sprint separado (e não auto-correção do 5)
Gerar um E116/E250 exige 3 dados que **não existem no `.txt`** e **não podem ser inferidos**:
1. **`COD_REC`** — código de receita do ICMS (varia por UF, tipo: ICMS normal, ST, DIFAL, FECP…). Na BA são códigos da SEFAZ-BA/DARE.
2. **`DT_VCTO`** — vencimento, que depende de **calendário fiscal** (UF + regime + competência; ex.: ICMS normal x dia do mês seguinte, ST em prazo distinto).
3. **`VL_OR`** — em geral = `E110.VL_ICMS_RECOLHER` (próprio) / `E210.VL_ICMS_RECOL_ST` (ST), mas pode haver **parcelamento** (vários E116) → exige decisão do cliente.

Chutar qualquer um desses gera **DARE errado / pagamento na data errada** — risco fiscal real. Por isso: **configuração explícita + confirmação**, modelo igual ao dos outros overrides (correção = **dado**, não código).

### 16.2 Modelo de dados (nova tabela `val_obrigacoes`, prefixo `val_`, isolada)
```sql
CREATE TABLE val_obrigacoes (
  id SERIAL PRIMARY KEY,
  id_sped_arquivo INT REFERENCES sped_arquivos(id),
  tipo VARCHAR(6),            -- 'E116' (ICMS próprio) | 'E250' (ICMS-ST)
  vl_or NUMERIC(15,2) NOT NULL,
  dt_vcto DATE NOT NULL,
  cod_rec VARCHAR(20) NOT NULL,
  num_proc VARCHAR(40), ind_proc VARCHAR(2), proc TEXT, txt_compl TEXT,
  mes_ref VARCHAR(6),        -- AAAAMM
  origem VARCHAR(10) DEFAULT 'MANUAL',  -- MANUAL | TABELA (preenchido pelo calendário)
  usuario_id INT, ativo BOOLEAN DEFAULT TRUE, criado_em TIMESTAMP DEFAULT NOW()
);
```
**Tabela de apoio (catálogo configurável, não código):** `val_calendario_fiscal` (UF, tipo_obrigacao, cod_rec_padrao, regra_vencimento) → o sistema **sugere** `COD_REC`/`DT_VCTO`; o cliente **edita/confirma**. Sem entrada no calendário → campos **obrigatórios manuais** (nunca auto).

### 16.3 Onde entra no export (ponto já validado, aditivo)
O export aplica `val_correcoes` em `server.js:8559-8561` e **só depois** recalcula `9900 / X990 / 9999` (`:8580+`, mapa `fechamentoBloco` em `:8613`). A emissão de E116/E250 entra **no mesmo ponto** (logo após `val_correcoes`, antes do recálculo):
1. ler `val_obrigacoes` ativas do arquivo (mesmo padrão `buscarCorrecoes`);
2. montar as linhas `|E116|...|` / `|E250|...|` e **inseri-las após o E110/E210 correspondente** no `outputLines`;
3. o recálculo existente de `E990 / 9900 / 9999` **já absorve** as novas linhas → contagem correta **sem tocar no totalizador** (é exatamente o que o item 16 da memória garante: todos os X990 recomputados das linhas finais).
- **Vazio → no-op → byte-idêntico** (mantém a garantia golden-file do §10).
- **Idempotência:** se já existir E116/E250 "casando" (mesmo COD_REC + VL_OR + DT_VCTO) na competência, **não duplica** (dedup por chave natural, como C100/D100).

### 16.4 Fluxo de UX
1. Sprint 5 acusa `APUR-E116-AUSENTE` (R$ X a declarar).
2. No detalhe do erro, botão **"Lançar obrigação (E116)"** → formulário pré-preenchido: `VL_OR = E110.VL_ICMS_RECOLHER`, `COD_REC`/`DT_VCTO` **sugeridos** pelo `val_calendario_fiscal` (editáveis), opção **"parcelar"** (gera N linhas).
3. Salvar → grava `val_obrigacoes` → **Re-validar** → `APUR-E116-SOMA` fecha (Σ E116 = E110) → erro some.
4. Exportar → as linhas saem no `.txt`.

### 16.5 Riscos e salvaguardas
| Risco | Salvaguarda |
|---|---|
| COD_REC/vencimento errado → DARE/pagamento errado | **Nunca auto**; sugestão do calendário **sempre editável + confirmação**; classe **manual** |
| Duplicar E116/E250 já existente | dedup por chave natural (COD_REC+VL_OR+DT_VCTO+MES_REF) no ponto de injeção |
| Quebrar contagem E990/9900/9999 | injeção **antes** do recálculo X990 (já existente) → contagem automática |
| Reintroduzir o caso "adiado 2026-06-01" | 5.1 é **opt-in por arquivo**; sem `val_obrigacoes` lançada, nada muda (continua só detectando, silenciável por competência) |
| Parcelamento / multi-guias | suportado por **N linhas** em `val_obrigacoes` (a soma é que precisa fechar com o E110/E210) |

### 16.6 Escopo e fronteira
- **No 5.1:** E116 (ICMS próprio) e E250 (ICMS-ST) a partir do `VL_ICMS_RECOLHER`/`VL_ICMS_RECOL_ST`, com calendário **configurável** e confirmação.
- **Fora do 5.1 (futuro):** integração com emissão real de DARE/portal SEFAZ, parcelamento automático com juros, E115/E111 (ajustes de mérito — permanecem manuais/ERP).
- **Decisão a confirmar com o Esmael antes de codar:** popular `val_calendario_fiscal` para a **BA** (códigos de receita ICMS normal e ST + regra de vencimento) — é **dado fiscal**, não código; sem isso, o 5.1 funciona em modo 100% manual.

---

## 17. Detalhamento — Árvore genealógica de registros (estilo PVA): VISUALIZAR → DIFF → EDITAR

> **Origem (2026-06-14):** hoje o Validador mostra os blocos só como **chips** (cobertura), sem o conteúdo. Pedido: clicar no bloco e expandir a **árvore pai→filho** dos registros, como no PVA. A conversa evoluiu para **3 camadas** de risco crescente — implementar **nesta ordem**, parando onde o valor já estiver entregue.

### 17.0 Questionando o pensamento "editar QUALQUER valor e salvar" (honestidade de engenharia)
A ideia inicial era editar qualquer campo de qualquer registro e salvar. **Não recomendo começar por aí**, por 4 razões concretas (todas verificadas no código):
1. **O export RECONSTRÓI a maioria dos blocos a partir do banco**, não passa o `.txt` verbatim: C170 vem de `documentos_itens_c170`; E110/E210 são recalculados (`spedCostureiraService.js:414-485`/`:500-601`); C100/D100 são deduplicados; 0220/0221/x90/CST61 são normalizados. Um valor "editado na árvore" que não passe pelo mecanismo de override seria **silenciosamente sobrescrito** no download — pior que não editar (dá falsa sensação de correção).
2. **O endereçamento estável só existe para 6 registros.** `correcoes.js:chaveNatural` resolve chave estável apenas para `0000/0150/0200/C100/D100/C170`; todo o resto (C190, 1300/1310/1320, E110/E116/E210…) retorna `null` → hoje é `corrigivel:false`. "Editar qualquer campo" exige um **endereçamento universal** que sobreviva a dedup/reordenação/reconstrução — engenharia não trivial (Camada 3).
3. **Edição parcial cria inconsistência nova.** Mudar `VL_ICMS` de um C170 sem ajustar o C190 e o E110 correspondentes gera um arquivo que o PVA rejeita por **outro** motivo. Edição livre sem re-validação obrigatória troca um erro por outro.
4. **Segurança fiscal (§6):** campo fiscal não muda sem ação explícita + classe de correção. Edição livre irrestrita é o oposto disso.

**Minha recomendação:** entregar primeiro o **visualizador read-only (Camada 1)** + o **diff do que foi auto-corrigido (Camada 2)** — juntos resolvem ~90% do valor (transparência total: "o que tem no meu SPED" e "o que vocês corrigiram") com **risco ~zero**. A edição manual (Camada 3) entra depois, **gated por classe de campo** e **re-validação obrigatória**, nunca como "edite qualquer coisa".

### 17.1 Camada 1 — VISUALIZADOR read-only (MVP, é o que o cliente pediu agora)
Clicar no bloco → expandir a árvore **pai→filho** de **todos os registros**, com **campos nomeados** e os **totalizadores**, **sem editar**.

**Backend (novo, aditivo):** `GET /api/validador/arvore/:id` (e variação upload) que devolve o **modelo em árvore** — reusa `validador/parser.js` (já produz `linhas` + `porReg`) e o mapa pai→filho de `validador/rules/r_hierarquia.js`. Resposta (paginável por bloco):
```
{ blocos: [ { bloco:'0', registros:[
    { reg:'0000', linha:1, campos:[{nome:'COD_VER',valor:'019'},…], filhos:[…] },
    { reg:'0150', linha:42, campos:[…], filhos:[{reg:'0175',…}] }, … ] } ],
  totalizadores: { '0990':…, 'C990':…, '9900':[{reg,qtd}], '9999':… },
  errosPorLinha: { 42:[{regra_id,severidade}] } }   // reusa o engine p/ badge no nó
```
- **Dicionário de campos (requisito real):** para mostrar campos **nomeados** (não `f[7]`) é preciso uma tabela `REG → [nomes de campo]` **por versão de leiaute**. Hoje os nomes estão **espalhados e hardcoded** dentro das regras (ex.: posições do 1300/1310 em `r_bloco1_lmc.js`, do E110 no export). **Entregável do MVP:** consolidar isso num `validador/layout/` (dicionário REG→campos, com a versão do `0000`). Sem nomes, a árvore vira "campo 7 = 12345" (pouco útil). **É o maior custo do MVP** — mas reaproveitável por todas as camadas e pelas regras.
- **Frontend:** componente `ArvoreSped.vue` — árvore **virtualizada** (expand-on-demand; nunca renderizar 28k nós de uma vez). Cada nó: `REG · descrição · (n filhos) · badge de erro`. Clicar expande os filhos; clicar no registro abre os **campos nomeados** (read-only). Busca por REG/valor. Painel separado de **totalizadores** (X990/9900/9999) com conferência visual (✓ se a contagem bate).
- **Risco:** ~zero (só leitura do `.txt` parseado). Reusa parser + engine + hierarquia já existentes.

### 17.2 Camada 2 — DIFF "antes → depois" das correções automáticas
Mostrar, para tudo que o sistema corrige sozinho (X990, 0220/0221, CFOP entrada, CST 61→60, uso/consumo→x90, dedup C100/D100, coerência 1300/1310, CAP_TANQUE, E210…), **como estava** × **como ficou** + **qual regra** causou.
- **Como obter:** o `revalidar` **já re-exporta** o `.txt` final (`fetch /api/exportar-sped/:id`). Computa-se um **diff registro-a-registro entre o ORIGINAL e o EXPORTADO** (alinhando por chave natural quando há; por posição/ordinal quando não há) e **atribui** cada mudança à regra/correção responsável (o export já conhece o que normalizou; expor um changelog estruturado fortalece a atribuição).
- **UI:** na árvore (Camada 1), o nó alterado ganha selo **"corrigido automaticamente"**; ao expandir mostra `valor original → valor final` lado a lado. Lista-resumo "N campos corrigidos automaticamente" no topo.
- **Valor:** mata a desconfiança ("o que vocês mexeram?") e é a **fronteira visível** entre o que o sistema corrige (determinístico, seguro) e o que só o cliente pode mexer.
- **Risco:** ~zero (read-only; usa endpoints existentes).

### 17.3 Camada 3 — EDIÇÃO manual de campo (opcional, posterior, COM travas)
Só aqui o cliente edita um valor e salva. **Não** é "edite qualquer coisa": é edição **endereçada + classificada + re-validada**.
- **Endereçamento universal:** generalizar `chaveNatural` para QUALQUER registro via **chave do pai + tipo de registro + ordinal dentro do pai** (estende o padrão atual `chaveC100#NUM_ITEM`). Ex.: C190 → `chaveC100#C190#<idx>`; 1310 → `COD_ITEM#DT#NUM_TANQUE`; E110 → `unico-por-apuracao`. Tem de **sobreviver** ao dedup/reordenação/reconstrução do export (testar no arnês golden).
- **Classes de campo (trava de segurança):**
  - **seguro** (cadastral textual: descrição 0200, nome participante) → edição direta;
  - **derivado** (totalizadores, somas E110/E210, contagens 9900) → **bloqueado** para edição (são recalculados pelo export; editar não tem efeito) — a árvore mostra "calculado automaticamente";
  - **perigoso** (CST/CFOP/ALIQ/valores fiscais) → edição **com confirmação** + aviso de impacto + **re-validação obrigatória** antes de liberar download.
- **Persistência:** reusa `val_correcoes` (override genérico linha/campo, aplicado em `server.js:8559` antes do recálculo X990 em `:8580`). Original sempre imutável; diff + trilha (usuário/data/valor_original→corrigido).
- **Re-validação obrigatória:** todo save dispara `revalidar` (valida os bytes exportados) — o cliente vê se a edição **fechou** o erro ou **abriu** outro.
- **Risco:** médio/alto — por isso é a última camada e gated.

### 17.4 Performance (vale para todas as camadas)
Arquivos de 28k+ linhas. **Nunca** materializar a árvore inteira no DOM: árvore **virtualizada** + **expand-on-demand** (carrega filhos do nó ao abrir) + **paginação por bloco** no endpoint. Contagem/badges agregados no backend (1 passada do parser/engine, que já é O(n)).

### 17.5 Isolamento / não-impacto (mantém o princípio do módulo)
- Endpoints **novos** `/api/validador/arvore/*` (read-only) + componente **novo** `ArvoreSped.vue`; nada existente é alterado.
- Camadas 1 e 2 **não escrevem nada** (só leem `.txt` parseado + bytes exportados).
- Camada 3 reusa `val_correcoes` (já consumido opt-in pelo export; vazio = byte-idêntico — garantia golden-file §10).
- O `validador/layout/` (dicionário de campos) é **aditivo** e passa a ser fonte única reaproveitada pelas regras.

### 17.6 Ordem de entrega e critérios de aceite
1. **`validador/layout/`** (dicionário REG→campos por versão) — pré-requisito do MVP.
2. **Camada 1** (endpoint árvore + `ArvoreSped.vue` virtualizada + totalizadores). Aceite: abrir um SPED de 28k linhas, navegar a árvore por bloco sem travar, ver campos nomeados e totalizadores; badges de erro batem com a lista de erros atual.
3. **Camada 2** (diff antes/depois + selos na árvore). Aceite: para um arquivo que o export corrige, cada correção aparece como `original→final` atribuída à regra; soma confere com `changesApplied`.
4. **Camada 3** (edição gated) — só se/quando o Esmael priorizar; aceite inclui teste de endereçamento no arnês golden e re-validação obrigatória.

> **Decisão recomendada:** congelar o escopo imediato em **Camadas 1 + 2** (visualização read-only + diff do auto-corrigido). A edição livre (Camada 3) fica planejada, mas **não** é o próximo passo — o ganho dela é menor e o risco é o maior do módulo.
