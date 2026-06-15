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
- **E110 × E116:** SPED original de vários postos (posto de exemplo A/posto de exemplo B…) vem com `E110.VL_ICMS_RECOLHER > 0` e **0 registros E116** → PVA acusa "soma E116 ≠ E110". Decisão registrada: **ADIADO** (Esmael, 2026-06-01) por exigir `COD_REC`/DARE + regra de vencimento do ICMS-BA. O Sprint 5 retoma isso de forma estruturada.
- **E210 (ICMS-ST):** apuração ST **não soma o ICMS_ST das entradas** (C190 com CFOP 1xxx/2xxx) em alguns casos → `VL_OUT_CRED_ST=0` / `VL_SLD_CRED_ST_TRANSPORTAR` divergente (erros E210 citados nos arquivos do posto de exemplo Abr/2021 e Mai/2023). Hoje o export já tenta somar (ver 14.2), mas **ninguém verifica** o resultado.

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
- Rodando sobre os **originais legados** (postos de exemplo): a regra `APUR-E116-AUSENTE` reproduz exatamente os erros que o **PVA** apontou nesses arquivos (validação contra realidade conhecida).
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

### 17.7 Revisão adversarial (workflow multi-agente, 2026-06-14) — correções ao design
Uma revisão crítica independente encontrou uma **falha-raiz** que invalida o endereçamento "ingênuo" da Camada 3 e refina as três camadas:

- **FALHA-RAIZ — populações de linhas diferentes.** `engine.validar()` roda sobre `parseSped(.txt ORIGINAL)`; o export aplica `correcoesSvc.aplicar()` sobre `outputLines` = o array **pós-reconstrução** (dedup C100/D100 `server.js:6808+`; C170 reconstruído do banco; **C190 relabelado x90 + FUNDIDO por chave CST|CFOP|ALIQ** `server.js:8560-8606` / `spedCostureiraService.js:788-840`; 0221 realocado; leiaute 019→020). Logo, qualquer chave **ordinal** (C190) ou por **índice de campo** (leiaute) calculada sobre o original **diverge** do que o `aplicar` vê → o override pode **casar na linha ERRADA** (edit-fantasma que não some — é pior: cola no item errado e o cliente transmite). O padrão `ordinalH005` "funciona" só porque H005 **não é tocado** entre parse e export; C190 é.
- **MITIGAÇÃO ESTRUTURAL (obrigatória p/ Camada 3):** a árvore, o cálculo de `chaveNatural`+ordinal e o `editTier` devem ser computados sobre os **BYTES EXPORTADOS** (espelhar `/revalidar`: exporta internamente, reparseia), **nunca** sobre o `.txt` original. Assim engine-chave e aplicar-chave varrem a **mesma população** e o ordinal casa por construção. Custo: abrir a árvore (no modo edição) dispara um export interno (alguns segundos).
- **`editTier` é POR CÉLULA com contexto de valor, nunca por `(registro,campoIdx)` estático.** Ex.: C170 campo 10 (CST) é **VERMELHO read-only** quando o CFOP da linha ∈ {1407,1556,2407,2556} (x90 é autoritativo, `spedCostureiraService.js:789`) e **AMARELO** caso contrário. Uma tabela estática não expressa "vermelho só nesta linha".
- **C170 ↔ C190 atômico já no MVP de edição** (não no Full): editar CST/CFOP do C170 sem ajustar o C190 da mesma chave = rejeição garantida no PVA (o export **não recalcula** C190 a partir do C170). Ou edita o par junto, ou **bloqueia** o save com aviso.
- **Cache LRU do `model` + do resultado de `validar()`** por `(id_arquivo, mtime/hash)` é **pré-requisito do MVP**, não otimização: sem ele, cada expand-on-demand re-lê e re-parseia ~3 MB e re-roda 16 regras (posto de exemplo = 31.226 linhas; 14.829 C100 + 15.518 C190). Invalida ao salvar/deletar correção.
- **Whitelist explícita de `(registro,campoIdx)` editável** validada no `/corrigir` (hoje aceita `campo_idx` arbitrário, `server.js:5605`) — fora da whitelist, **rejeita**.
- **1320 permanece read-only enquanto `correcoes1320` existir** (`server.js:6850`, tabela `sped_1320`, aplicada **dentro** do motor LMC, antes do `aplicar`): dois canais de override do mesmo bico = o do `val_correcoes` (depois) **reverte silenciosamente** a correção feita pela tela dedicada. Unificar = migrar **e desligar** `correcoes1320` no mesmo passo.
- **`/revalidar` é cego ao ordinal-desync** — valida invariantes (somas, combinação CST/CFOP), não "meu valor foi para onde eu quis" (trocar VL_OPR entre dois C190 mantém a soma e passa). Adicionar **check de integridade de aplicação**: `aplicar` retorna nº de campos alterados; comparar com nº de correções ativas; se divergir, **acusar**.
- **Teste de aplicação cirúrgica** (além do golden-vazio): 1 override → diff do export = **exatamente** aquele campo, em **1** linha; caso adversarial obrigatório = NF com **duas C190 de mesma chave** CST|CFOP|ALIQ.
- **Edição em painel lateral/modal, não inline:** o virtual-scroll caseiro depende de **altura uniforme**; edição inline com diff é altura-variável e quebra a virtualização.

### 17.8 Impacto na decisão (e nas perguntas em aberto)
A revisão **reforça** a escolha de **Camadas 1 + 2 (read-only) primeiro** — o risco real da edição é maior e mais sutil do que parecia. Para a Camada 1, fica uma decisão de design: a árvore mostra o **`.txt` original** (o "meu arquivo" que o cliente reconhece — recomendado para visualização) ou os **bytes exportados** (o que vai ao Fisco). Recomendo: **Camada 1 sobre o original**; **Camada 2 (diff)** já traz o "depois"; **Camada 3 (edição) obrigatoriamente sobre o exportado**.

Perguntas que decidem a Camada 3, quando/se for priorizada:
1. O MVP de edição precisa **mesmo** de C190 editável (fonte nº 1 de risco: ordinal/fusão), ou corrigir CST/CFOP no C170 com o C190 ajustado junto já cobre o caso real?
2. Aceita que abrir a árvore-de-edição dispare um **export interno** (segundos) para endereçar sobre os bytes exportados?
3. Edição em **painel lateral** (não inline) — ok?
4. 1320 **read-only** até migrar e desligar `correcoes1320` — ok?
5. Multiusuário? Se outros auditores editam, a **trilha de auditoria** (quem/quando/o-quê) sobe para o MVP (um override mal-endereçado é responsabilidade fiscal de quem clicou).

---

## 18. Plano executável — CAMADA 1 (visualizador read-only de árvore + totalizadores)

> **Escopo:** clicar no bloco → expandir a árvore pai→filho de **todos os registros**, ver **campos nomeados** e os **totalizadores**, **sem editar**. Renderiza sobre o **`.txt` ORIGINAL** (o "meu arquivo" que o cliente reconhece — idêntico ao que `/analisar/:id` já lê). Detalhado por workflow multi-agente em 2026-06-15; ancorado no inventário real de registros do projeto.

### 18.1 Componentes (2 módulos + 2 rotas novos; edições em código existente são mínimas e aditivas)
| Arquivo | Novo/Alterado | Papel |
|---|---|---|
| `backend/services/validador/arvore.js` | **NOVO** | `montarArvore(model,resultado)` — 1 passada O(n) com pilha de ancestrais; `cascaColapsada`, `paginarFilhos`, rollup de erros por subárvore |
| `backend/services/validador/cache.js` | **NOVO** | LRU de `{model, resultado, arvore}` por `(id, mtime)`; `getModelo(id,cam)`, `invalidar(id)` |
| `backend/services/validador/layout/index.js` + `registros.js` | **NOVO** | dicionário de leiaute REG→campos **versionado** (fonte única de nomes de campo) |
| `backend/server.js` | **alterado (aditivo)** | 2 rotas GET novas (`~5591`) + **3 chamadas** `cache.invalidar(idArq)` em `/corrigir`, `DELETE /correcoes`, `/revalidar` |
| `backend/services/validador/rules/r_hierarquia.js` | **alterado (1 linha)** | `module.exports.PAIS` — expõe o mapa filho→[pais] (regra inalterada) |
| `frontend/src/components/ArvoreSped.vue` | **NOVO** | árvore achatada + virtual-scroll caseiro + painel lateral de campos + busca + totalizadores |
| `frontend/src/views/ValidadorView.vue` | **alterado (aditivo)** | nova **aba** "Estrutura/Árvore" (`const aba=ref('erros')`) ao lado da lista de erros |

`parser.js` e `engine.js` são **reusados sem alteração**.

### 18.2 Rota 1 — casca colapsada: `GET /api/validador/arvore/:id`
Só o esqueleto navegável: blocos → **pais de 1º nível** (filhos diretos do `X001`) com **contagens** e **erros agregados por subárvore**. **Nunca** serializa `model.linhas`; netos (C170/C190 — 14k+ no posto de exemplo) entram **só como contagem**.
```json
{ "arquivo": {"id":1833,"versao":"020","periodo":"01052026-31052026","totalLinhas":31402},
  "resumo": {"total":47,"bloqueantes":12,"blocosPresentes":["0","1","9","C","D","E","H"]},
  "totalizadores": { "x990":[{"bloco":"C","reg990":"C990","declarado":28078,"contado":28077,"ok":false}],
                     "r9900":[{"reg":"C170","declarado":14500,"contado":14500,"ok":true}],
                     "r9999":{"declarado":31402,"contado":31402,"ok":true}, "todosOk":false },
  "blocos": [ { "bloco":"C","noAbertura":{"n":500,"reg":"C001"},"totalLinhas":28078,
     "errosSubarvore":31,"bloqueantesSubarvore":8,"filhosPorReg":{"C100":1420,"C500":12},
     "pais":[ {"n":501,"reg":"C100","descricao":"NF-e nº 12345 mod55 sit00","chaveNatural":"29220…001",
        "campos":[{"idx":8,"nome":"NUM_DOC","valor":"12345"},{"idx":9,"nome":"CHV_NFE","valor":"29220…"}],
        "filhosCount":45,"filhosPorReg":{"C170":42,"C190":3},"errosSubarvore":2,"bloqueantesSubarvore":1} ],
     "paisTotal":1420,"paisOffset":0,"paisLimit":200,"paisTemMais":true } ],
  "orfaos":[{"n":8801,"reg":"C170","regraId":"EST-HIER-01"}],
  "errosSemLinha":[{"regraId":"EST-9XXX-CONT","detalhe":"C990 difere"}] }
```
Pais de blocos com milhares de filhos (1420 C100) são **paginados já na casca** (`paisLimit` default 200, `paisTemMais`).

### 18.3 Rota 2 — expand-on-demand: `GET /api/validador/arvore/:id/filhos?registro=&chave=&offset=&limit=`
Carrega os filhos de **um** pai sob demanda (default `limit=200`, max 1000). Identificação do pai por `chaveNatural` quando existe; **fallback `?linha=NNN`** quando `chaveNatural==null`. Reusa a mesma rota para paginar pais de bloco (`?bloco=C&offset=200`). Cada filho traz `{n, reg, descricao, chaveNatural?, campos:[{idx,nome,valor}], filhosCount, errosNaLinha, erros:[…]}`.

### 18.4 Cache LRU (`cache.js`) — PRÉ-REQUISITO, não otimização
posto de exemplo = 31.226 linhas / 3 MB (14.829 C100 + 15.518 C190). Sem cache, cada clique re-leria 3 MB + re-rodaria as 16 regras → derrete. Solução: LRU `id → {mtimeMs, model, resultado, arvore}` (parse + `validar` + `montarArvore` **uma vez**), evict por `lastHit`, `MAX≈8`.
- **Invalidação é EXPLÍCITA**, não por mtime: a Camada 1 lê o `.txt` original (mtime imutável), mas correções vivem em `val_correcoes` → é obrigatório `cache.invalidar(idArq)` em `/corrigir`, `DELETE /correcoes`, `/revalidar`.

### 18.5 Montagem da árvore (`arvore.js`) — 1 passada O(n) com pilha de ancestrais
Reusa `PAIS` de `r_hierarquia.js` (fonte única do grafo). Para cada linha: `0000`/`X001` (≠0000, termina em `001`) abre nova subárvore (zera a pilha); senão **desempilha até o PRIMEIRO ancestral ACEITO** de `PAIS[reg]` (não assume o topo imediato — pode pular níveis); se nenhum aceito → **órfão** (= reproduz `EST-HIER-01`). Rollup bottom-up de `errosSubarvore`/`bloqueantesSubarvore` usando `erros[].linha` (já existe no engine). Cadeias reais: `C001→C100→C170/C190`; `0001→0150/0200→0205/0206/0221`; `1001→1300→1310→1320→1321`; `E001→E100→E110→E111/E116`.
- **Erros sem linha** (`linha:null`: X990 ausente, falha interna de regra) vão para `errosSemLinha` (balde de bloco/arquivo) para não sumirem da UI.

### 18.6 Dicionário de leiaute (`validador/layout/`) — fonte única de nomes, versionada
Para mostrar `CST_ICMS` em vez de `campo 9`. API estável consumida por árvore **e** (incrementalmente) pelas regras:
```
layout.nome(reg, idx, ctx) -> 'CAP_TANQUE'     // idx = índice f[] do parser; campos[0] === f[2]
layout.campos(reg, ctx) / layout.def(reg, ctx) / layout.parents(reg) / layout.label(reg,f,ctx)
```
- **Versionado por `(REG, faixa de COD_VER/competência)`** — obrigatório: `0220` (3↔4 campos no corte 018/019), `1310` (+`CAP_TANQUE` em 020/2026), o próprio `0000`, e indício no `E210`. Resolução: escolhe a versão cujo `[verMin,verMax]` contém `ctx.versao` (compare com pad `'019'`); fallback = versão mais recente.
- **Fallback determinístico:** REG desconhecido ou idx fora do range → `campo ${idx-1}` (nunca inventar nome).
- **Seed de ALTA confiança (~18 registros, extraídos do código com `arquivo:linha`):** 0000, 0150, 0200, 0220, 1300, 1310, 1320, 1350, 1360, 1601, C100, C170, C190, D100, H005, H010, E110, E210, 9900/X990/9999. **Lacuna (~40 registros, sem nomes no código → caem no fallback até completar com o leiaute oficial):** bloco K, G, C5xx/C6xx, D170/D190/D200, E111–E116, B990 etc.
- **Metadado `autoCorrigivel` por campo** (derivado da flag `jaCorrigidoNoExport`: 0220, X990/9900/9999, CST61, CFOP C170, CAP_TANQUE) → a árvore mostra "corrigido automaticamente" (prepara a Camada 2).
- **Migração das regras é incremental e de baixo risco:** trocam o literal `'CAP_TANQUE'` por `layout.nome(reg,idx,ctx)` arquivo a arquivo, **sem mudar `detectar()`** (passa a receber `ctx={versao,periodoYM}`).

### 18.7 Componente `ArvoreSped.vue` (virtual-scroll caseiro)
- **Lista ACHATADA**: cada pai/filho expandido = **1 linha de altura fixa** (`ROW_H`); janela calculada por `scrollTop`. Usar `<div>` com height fixo, **não** `<table>/<tr>/colspan`.
- **Campos abrem em PAINEL LATERAL/modal**, nunca inline (linha-expand de altura variável quebraria a virtualização).
- **`Set` O(1) de expandidos**, **reatribuído** (`new Set([...])`) a cada toggle para disparar o recompute do flat (padrão já usado em `AnalisadorView.vue:299-301`).
- **Fetch lazy** dos filhos (cache local por pai); badges de erro por nó; **busca** por REG/valor (busca server-side ou no cache — nó não-renderizado não aparece num filtro puramente client-side da lista virtual). **Painel de totalizadores** (X990/9900/9999) com ✓/✗.

### 18.8 Riscos herdados da revisão adversarial (§17.7) aplicáveis à Camada 1
- **Off-by-one `f[2]=campos[0]`** (lembrar `f[1]=REG` e o `''` final do parser) → teste unitário casando `layout.nome` com as posições já provadas nas regras.
- **Render sobre o ORIGINAL** é a decisão certa para *visualizar*; a Camada 3 (edição) **exigirá** os bytes exportados (registrado).
- **Dívida do dicionário:** os nomes da lacuna (~40 regs) precisam do leiaute oficial; até lá, fallback seguro. Documentar proveniência em `layout/seed_from_rules.md`.

### 18.9 Critérios de aceite e esforço
- Abrir um SPED de 31k linhas, navegar por bloco **sem travar** (casca + lazy + cache); ver **campos nomeados** nos ~18 registros do seed e fallback nos demais; **totalizadores** conferem (✓/✗ batem com `r_contadores`); badges de erro por nó batem com a lista de erros atual; **órfãos** aparecem (= `EST-HIER-01`).
- **Isolamento:** 2 módulos + 2 rotas GET novos; únicas edições aditivas = expor `PAIS` (1 linha), 3 `cache.invalidar()`, e a aba na `ValidadorView`. A aba nova **não** altera o fluxo de erros/correção que já existe.
- **Esforço:** seed (~18 regs) + API layout = baixo-médio; árvore O(n) + endpoints paginados + cache = médio; `ArvoreSped.vue` = médio.

---

## 19. Dashboard / Resumo do SPED carregado (DOCUMENTOS, apurações, blocos)

> **Pedido (2026-06-15):** uma tela de resumo do SPED com detalhamento máximo — notas de **entrada** e **saída** (nº, fornecedor, data, valor, produtos, quantidade, impostos) sob o nome **DOCUMENTOS** (Bloco C, separado entrada/saída), **apuração de ICMS** detalhada, **apuração de IPI**, **CIAP** (Bloco G), **Bloco H** (inventário) e cartões-resumo dos demais blocos.

### 19.0 O que JÁ existe (NÃO duplicar) — verificado no código
Boa parte do "detalhamento de notas" **já está pronta no Analisador** (lê o BANCO):
- **AnalisadorView** abas `dashboard` (`AnalisadorView.vue:2253` — Entradas/Saídas/Consumo, "DETALHAR CRÉDITOS"), `notas` (entradas: fornecedor, NUM_DOC, DT_DOC, VL_DOC + itens com CFOP/CST/produto), `saidas` (Notas de Saída + **Resumo por CFOP**: CST_ICMS / VL_OPR / VL_BC_ICMS / VL_ICMS).
- Endpoints: `/api/documentos/entradas/:id` (`server.js:4396`), `/api/documentos/saidas/:id` (`:4444`), `/api/documentos/nfe-completa/:chave` (`:4566`), `/api/resumo/:id` (`:4828`, agrega `documentos_c190` por CFOP p/ entradas `ind_oper=0` e saídas `=1`), `/api/resumo/participante/:id` (`:5802`), `/api/estoque-resumo/:id` (`:4996`).
- Dados no banco: `documentos_c100`, `documentos_itens_c170`, `documentos_c190`, `sped_produtos` (descr/NCM), `sped_participantes` (fornecedor), `lmc_movimentacao`.

**Lacunas reais (NÃO existem hoje como tela):** apuração **ICMS (E110)** como demonstrativo (débitos/créditos/ajustes E111/saldo/recolher); apuração **ST (E210)** detalhada; apuração **IPI** (E520/E530); **CIAP (G)**; **Inventário H** como demonstrativo (há `estoque-resumo`, mas não o H005/H010 do arquivo). Esses blocos **nem são parseados com nomes** hoje (§18.6, lacuna do dicionário).

### 19.1 Questionando o seu pensamento (3 pontos)
1. **Duplicação com o Analisador.** "Detalhar entradas/saídas com fornecedor/data/valor/produtos/qtd/impostos" **já existe** nas abas `notas`/`saidas`/`dashboard`. Reconstruir no Validador é retrabalho e cria **duas verdades**. → A novidade do Validador não deve ser *re-listar notas*, e sim **resumir fielmente o `.txt` carregado** (ver ponto 2) e **cobrir as lacunas** (apurações/CIAP/H).
2. **Banco × `.txt` — camadas distintas (lição registrada na memória).** O Analisador lê o **banco** (`documentos_c100`…); o Validador parseia o **`.txt`**. Eles **divergem** (injeção, dedup, reconstrução do export). Um "dashboard do SPED" no Validador só tem valor se refletir **exatamente o arquivo carregado** (o que vai ao Fisco) — então deve agregar a partir do **modelo já parseado da Camada 1**, não do banco. Esse é o diferencial: o Analisador resume *o banco*; o Validador resume *o arquivo*.
3. **"Máximo de detalhamento" × performance/usabilidade.** Despejar 15 mil C190 + 14 mil C170 numa página trava (posto de exemplo, §18). Dashboard bom = **KPIs/agregados no topo + drill-down** (reusando a árvore/lazy da Camada 1), não um dump plano. "Máximo detalhe" mora no **drill-down**, não na primeira tela.

### 19.2 Proposta (melhor que a original): "Resumo do Arquivo" derivado do `.txt` (reusa Camada 1)
Uma aba **"Resumo"** na ValidadorView, alimentada por **um** endpoint `GET /api/validador/resumo/:id` que agrega o **mesmo `model` cacheado** (`cache.js`, §18.4) em **uma passada** — fiel ao `.txt`, sem reconstruir pipeline nem tocar o banco.

**A) DOCUMENTOS (Bloco C) — entradas × saídas: LINKAR ao Analisador (decisão do Esmael, 2026-06-15).**
O detalhamento de notas **já existe e é rico no Analisador** — então **não reconstruir**. O Validador entrega só o que é dele e **deep-linka** o resto:
- **No Validador:** uma **faixa de KPIs fiel ao `.txt`** (derivada do `model` cacheado): nº de documentos entrada/saída, Σ VL_DOC, Σ VL_ICMS, Σ VL_ICMS_ST, Σ VL_IPI, Σ VL_PIS/COFINS, distribuição por CFOP/CST. Serve para **conferir o arquivo × banco** (se o KPI do `.txt` diverge do Analisador, há sinal de injeção/dedup — valor de auditoria).
- **Botões de deep-link** "Ver notas de **entrada** / **saída** / **resumo** no Analisador" → navegam para `/analisador/<id>?tab=notas|saidas|dashboard` (mesmo arquivo), abrindo as abas que já fazem fornecedor/data/valor/produtos/qtd/impostos e o Resumo por CFOP.
- **Ajuste mínimo necessário** (aditivo): hoje a `AnalisadorView` cai sempre na aba `dashboard`; passar a honrar `route.query.tab` (1 linha no `onMounted`, lendo `route.query.tab` antes do default). A rota já é `/analisador/:id?` e já lê `route.params.id`.
- Resultado: zero duplicação de pipeline; o Validador acrescenta a **conferência `.txt`×banco** e manda o usuário ao detalhamento que já existe.

**B) Apuração ICMS (E110) — demonstrativo (LACUNA):** débitos (f2) / ajustes (E111) / estornos / créditos (f6) / saldo apurado (f11) / deduções / **a recolher (f13)** / saldo credor a transportar (f14), com o **cross-check** Σ C190 (a mesma conta do **Sprint 5 / §14**) → o dashboard e a validação compartilham o cálculo. Mostra também a relação **E110 × E116** (a recolher × obrigações).

**C) Apuração ST (E210), IPI (E520/E530), CIAP (Bloco G/G110), Inventário (Bloco H — H005/H010):** demonstrativos genéricos, **"vazio quando não há"** (postos de combustível normalmente **não** têm IPI nem CIAP; o layout precisa existir, mas a tela mostra "sem movimento"). Inventário H: lista H010 (COD_ITEM→`0200`, QTD, VL_UNIT, VL_ITEM) + total, e o `MOT_INV`/`DT_INV` do H005.

**D) Demais blocos (0/1/9/D/K/B):** **cartão-resumo** — contagem de registros, totalizador (X990) e ✓/✗ de conferência; **sem** detalhamento (você já indicou que não precisa).

**E) Relatório "Registros Fiscais" modelo PVA — Entradas e Saídas (o Esmael gosta deste; 2026-06-15).**
Reproduzir o relatório do Visualizador PVA *"Registros Fiscais dos Documentos de Entradas de Mercadorias e Aquisição de Serviços"* (e o simétrico de **Saídas**). É **100% derivável do `.txt`** (C100 + C190 + 0150 + 0000) → entregável ideal do dashboard fiel ao arquivo. É **mais completo** que o "Resumo por CFOP" atual do Analisador (acrescenta detalhe por documento, ICMS-ST, IPI, redução de BC e o layout/impressão do PVA), logo **não é duplicação** — complementa o link da letra (A).
- **Cabeçalho:** Contribuinte/CNPJ/IE/Período/UF/Município ← `0000` (+ `0005` p/ município/IE quando houver).
- **Nível 1 — por documento (C100 entrada `IND_OPER=0` / saída `=1`):** Data Entrada=`DT_E_S`(f11), Data Emissão=`DT_DOC`(f10), Nr.Doc=`NUM_DOC`(f8), Modelo=`COD_MOD`(f5), Série=`SER`(f7), Situação=`COD_SIT`(f6); CNPJ/IE/UF/Município/Razão Social ← participante `0150` (via `COD_PART` f4).
- **Nível 2 — linhas fiscais do documento (C190):** CST_ICMS(f2) · CFOP(f3) · Alíquota(f4) · Valor Operação=`VL_OPR`(f5) · BC ICMS=`VL_BC_ICMS`(f6) · Valor ICMS=`VL_ICMS`(f7) · BC ICMS ST=`VL_BC_ICMS_ST`(f8) · Valor ICMS ST=`VL_ICMS_ST`(f9) · Redução BC=`VL_RED_BC`(f10) · Valor IPI=`VL_IPI`(f11). Subtotal por documento agrupado por (CST,CFOP).
- **RESUMO — TOTAIS:** agrupado por **(CST, CFOP, Alíquota)** somando VL_OPR, BC_ICMS, VL_ICMS, BC_ST, VL_ST, IPI, RedBC + **linha TOTAL geral**. (Confere com o exemplo real do posto de exemplo 08/2025: TOTAL Operação «valor» / BC ICMS «valor» / Valor ICMS «valor».)
- **Diferenças do relatório de SAÍDAS** (modelo PVA *"Registros Fiscais dos Documentos de Saídas de Mercadorias e Prestação de Serviços"*, validado contra o exemplo real do posto de exemplo 08/2025 — TOTAL Operação «valor» / BC ICMS «valor» / Valor ICMS «valor»):
  - **RESUMO-TOTAIS agrupa por (Situação, CST, CFOP, Alíquota)** — a **Situação** (`COD_SIT` do C100, ex.: `00`=regular, `08`=regime especial/norma específica) é **dimensão extra** que não aparece no de entradas. Canceladas/denegadas (`COD_SIT` 02–05) **fora** dos totais (espelha o export).
  - **Campos de equipamento/numeração** (saídas de NFC-e/cupom — postos têm muito mod 65/2D): `Nº caixa` / `ECF/SAT`, `Série`/`Subsérie`, numeração `Inicial→Final` (COO). Vêm do C100 (`SER` f7, `NUM_DOC` f8, `COD_MOD` f5) e, quando houver ECF, dos registros C400/C405 (equipamento) — **renderizar quando presentes**, ocultar quando não (NF-e mod 55 não tem caixa/COO).
- **Saída em tela + impressão/PDF** no layout do PVA (casa com o Sprint 6 / relatório PDF) — o cliente reconhece o formato. Os **dois** relatórios (Entradas e Saídas) compartilham o mesmo motor de agregação, mudando só (lado `IND_OPER`, dimensões do resumo, colunas de equipamento).
- **Tudo do `model` cacheado** (uma passada): join intra-`.txt` C190→C100→0150 (+C400/C405 p/ ECF nas saídas). Sinaliza divergência `.txt`×banco quando o KPI não bate com o Analisador (auditoria).

---

## 20. Ordem segura de implementação (por onde começar)

> Princípio: cada passo é **read-only e isolado** primeiro; só toca o export muito depois, sempre atrás do **golden-file**. Cada passo entrega valor sozinho e pode parar sem quebrar nada.

| Passo | Entrega | Risco | Depende de |
|---|---|---|---|
| **0. Pré-flight** | Branch `feat/validador-sped`; rodar `golden-export.js baseline` em ~5 arquivos reais representativos (rede de segurança do export) | nenhum | — |
| **1. Relatório "Registros Fiscais" (Entradas+Saídas)** (§19E) | Endpoint read-only `GET /api/validador/registros-fiscais/:id?tipo=` + componente + impressão PVA. **1º entregável** (100% do `.txt`, reconhecido) | **nenhum** (read-only) | parser (pronto) |
| **2. Dicionário de leiaute** `validador/layout/` (§18.6) | Fonte única REG→campos versionada (seed ~18 regs) | nenhum | — |
| **3. Cache LRU + árvore (Camada 1)** (§18) | `cache.js`, `arvore.js`, 2 rotas, `ArvoreSped.vue` virtualizado | nenhum (read-only) | 2 |
| **4. Dashboard: apurações + cartões** (§19 B–D) | Demonstrativos E110/E210/IPI/CIAP/H + cartões; deep-link Analisador (§19A) | nenhum (read-only) | 1,2 |
| **5. Diff "antes→depois" (Camada 2)** (§17.2) | Diff original×exportado + selos "auto-corrigido" | baixo (usa `/revalidar`) | 3 |
| **6. Sprint 5 — detecção apuração** (§14) | Regras `APUR-E110/E116/E210/E250` (read-only) | nenhum | 2 |
| **7. Gate Sprint 3** (§15) | Modal de consentimento pré-download | baixo (UI) | — |
| **8. Edição (Camada 3) / obrigações 5.1** (§17.3,§16) | Edição gated + `val_obrigacoes` — **só com golden + endereçamento sobre bytes exportados** | **médio/alto** | golden, 3 |

**Regra de ouro entre passos:** nada que mude o `.txt` exportado entra sem o golden-file passar (passo 0). Passos 1–6 não tocam o export. Reiniciar o servidor (`node server.js` puro) após mudanças no backend.

> **Passo 1.5 — Catálogo de Regras visível (§21):** logo após o Passo 1; read-only, mínimo, alta transparência.

---

## 21. Catálogo de Regras visível (transparência: "validado contra o quê")

> **Objetivo:** a tela mostra o **catálogo de regras** com que o SPED está sendo validado — o cliente vê exatamente *contra o quê* o arquivo foi conferido, por bloco, com severidade e instrução. Materializa a "honestidade" do §1/§3 (cobertura conhecida + versão do catálogo; o PVA pode ter validações ainda não mapeadas).

### 21.1 Fonte (já existe, é só expor)
O registry `backend/services/validador/rules/index.js` já carrega cada regra com metadados: `id`, `bloco`, `registro`, `titulo`, `severidade` (BLOQ/ADV), `classeCorrecao` (estrutural-seguro/fiscal-determinístico/manual), `jaCorrigidoNoExport`, `instrucaoERP`. O `CATALOGO_ERROS_SPED.md` (~80 regras) é a **referência completa** — inclui regras ainda **planejadas** (não implementadas).

### 21.2 Backend (read-only, isolado)
- `GET /api/validador/catalogo` → lista `[{ id, bloco, registro, titulo, severidade, classeCorrecao, jaCorrigidoNoExport, instrucaoERP, status }]`, onde `status` = `'ativa'` (está no registry, realmente roda) ou `'planejada'` (consta no catálogo `.md` mas ainda não implementada). Inclui `versaoCatalogo` e contagens por bloco/severidade.
- A lista de `'ativa'` vem do próprio registry (uma volta no array); as `'planejada'` de um índice mínimo derivado do `CATALOGO_ERROS_SPED.md` (ou uma constante versionada) — **honestidade**: mostrar o que ainda **não** cobrimos.

### 21.3 Frontend
- Aba/painel **"Catálogo de Regras"** na `ValidadorView`: tabela **filtrável** por bloco · severidade · classe · status (ativa/planejada); cada linha expande para detalhe (o que detecta, instrução ERP, se é **auto-corrigida no export**).
- No relatório de validação, o selo já existente *"Validado contra N regra(s) do catálogo"* passa a **linkar** para esta aba e a mostrar **N ativas de M no catálogo (vX)** — deixa explícito o que roda vs o que falta.
- Marcar visualmente: `BLOQ`/`ADV`, classe de correção, e badge "auto no export" para `jaCorrigidoNoExport`.

### 21.4 Isolamento e aceite
- Rota nova read-only + aba nova; nada existente alterado; reusa o registry (sem importar nada que mute estado).
- **Aceite:** a aba lista todas as regras ativas com bloco/severidade/instrução; o contador "N ativas de M" bate com o registry; filtros funcionam; nenhuma escrita.

### 19.3 Arquitetura e isolamento
- **Fonte única:** `GET /api/validador/resumo/:id` agrega o `model` do **cache da Camada 1** (parse 1×). Reusa `layout/` (§18.6) para nomes e `r_hierarquia` para o grafo. Para blocos cujos nomes ainda estão na lacuna do dicionário, o demonstrativo correspondente fica em "esqueleto" até o leiaute ser semeado.
- **Quando o banco bastar** (ex.: visão idêntica à do Analisador), **linkar** para a aba existente em vez de reimplementar — evita a 2ª verdade.
- **Isolamento:** rota nova read-only + aba nova; nada existente alterado; reusa cache/parser/engine. Compõe com §18 (mesmo `model`, mesmo cache).

### 19.4 Critérios de aceite
- Abrir um SPED e ver, **fiel ao `.txt`**: KPIs de entradas/saídas, demonstrativo E110 com cross-check Σ C190 batendo (ou divergência sinalizada = erro do Sprint 5), inventário H, e cartões dos demais blocos — **sem travar** em 31k linhas (KPIs imediatos, detalhe sob drill-down).
- **Não** duplica o Analisador: as notas detalhadas reusam componentes/dados onde couber; o que é novo é o **resumo fiel ao arquivo** + as **apurações/CIAP/H** que hoje não têm tela.
- IPI/CIAP aparecem como "sem movimento" quando ausentes, sem erro.

> **Decisão (confirmada pelo Esmael, 2026-06-15):** **DOCUMENTOS = LINKAR ao Analisador** (deep-link `/analisador/<id>?tab=notas|saidas|dashboard`), pois lá já há detalhamento rico de notas; o Validador só acrescenta a **faixa de KPIs fiel ao `.txt`** (conferência arquivo×banco). O **trabalho novo** do dashboard concentra-se em: (1) o **relatório "Registros Fiscais" modelo PVA** de Entradas e Saídas (letra E — fiel ao `.txt`, mais completo que o resumo do Analisador, com impressão/PDF — **bom candidato a 1º entregável**, pois é 100% derivável do `.txt` e reconhecido pelo cliente); e (2) as **lacunas que não existem em lugar nenhum**: apuração **ICMS (E110)**, **ST (E210)**, **IPI (E520/E530)**, **CIAP (G)** e **Inventário (H)**, mais os cartões-resumo dos demais blocos. Único ajuste em código existente: `AnalisadorView` honrar `route.query.tab` (1 linha, aditivo).
