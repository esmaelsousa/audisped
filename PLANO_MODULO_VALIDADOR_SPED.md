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
           Exibir "corrigido automaticamente" para o que o export já resolve.
Sprint 4 — Regras fiscais/combustível do catálogo (CST×CFOP×ALIQ, C190 do C170, CST61, x90, monofásico).
Sprint 5 — Apuração (E110/E116/E210) + cruzamentos (o que o PVA não vê).
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
