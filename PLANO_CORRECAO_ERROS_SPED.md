# Plano de Implementação — Central de Erros e Correções SPED

> **Status:** Planejamento
> **Data:** 2026-03-30
> **Objetivo:** Ampliar capacidade de mapeamento e correção de erros do SPED, com relatório exportável, correção direta no Audisped e IA assistida.

---

## Visão Geral

Nova experiência no Analisador com três pilares:

1. **Visualização** — Todos os erros mapeados, organizados e navegáveis
2. **Correção** — Direto no Audisped com export do SPED corrigido
3. **Relatório** — Export para o cliente corrigir no ERP (PDF + Excel)

---

## Reestruturação de Páginas

### Antes
- `/analisador/:id` → erros + LMC + documentos misturados

### Depois
| Rota | Conteúdo |
|------|----------|
| `/analisador/:id` | **Central de Erros + Correções** (foco total) |
| `/lmc/:id` | Tudo de LMC (movido do Analisador) |
| `/documentos/:id` | NFs entradas/saídas + auditoria (nova página) |

---

## Fase 1 — Base Sólida (prioridade máxima)

### 1.1 Motor de Regras Expansível (Backend)

Criar uma arquitetura de regras onde **adicionar um novo erro = adicionar um arquivo de regra**, sem mexer no core.

```
/backend/rules/
  ├── index.js           ← orquestrador, carrega todas as regras
  ├── fiscal/
  │   ├── cst_cfop.js    ← regra: CST x CFOP incompatível
  │   ├── base_calculo.js
  │   └── ...
  ├── estrutura/
  │   ├── contadores.js  ← regra: contadores de bloco incorretos
  │   ├── hierarquia.js
  │   └── ...
  └── lmc/
      └── continuidade.js
```

**Interface de cada regra:**
```js
module.exports = {
  id: 'CST_CFOP_001',
  titulo: 'CST incompatível com CFOP',
  descricao: 'CST X não pode ser usado com CFOP XXXX',
  severidade: 'CRITICO' | 'AVISO',
  categoria: 'fiscal' | 'estrutura' | 'lmc' | 'xml',
  detectar: (linhas, contexto) => [...erros],
  sugestao: (erro) => 'string com sugestão',
  corrigir: (linha, valor_novo) => linha_corrigida  // opcional
}
```

### 1.2 Novo Layout do Analisador (Frontend)

**Estrutura da página `/analisador/:id`:**

```
┌─────────────────────────────────────────────────────┐
│  ANALISADOR — Empresa X | Período Jan/2025           │
│  [Rodar Análise]  [Exportar Relatório ▾]             │
├──────────┬──────────────────────────────────────────┤
│ FILTROS  │  LISTA DE ERROS                           │
│          │                                           │
│ Categoria│  ┌─────────────────────────────────────┐ │
│ □ Fiscal │  │ 🔴 CRÍTICO | CST_CFOP_001           │ │
│ □ Estrut │  │ Linha 1.423 — Registro C170          │ │
│ □ LMC    │  │ CST 00 incompatível com CFOP 1556    │ │
│          │  │ [Ver Detalhe] [Corrigir] [Ignorar]   │ │
│ Severidad│  └─────────────────────────────────────┘ │
│ □ Crítico│                                           │
│ □ Aviso  │  ┌─────────────────────────────────────┐ │
│          │  │ 🟡 AVISO | BASE_001                  │ │
│ Status   │  │ ...                                  │ │
│ □ Aberto │  └─────────────────────────────────────┘ │
│ □ Corrig │                                           │
│ □ Ignora │  Total: 47 erros (12 críticos, 35 avisos)│
└──────────┴──────────────────────────────────────────┘
```

**Modal de Detalhe/Correção:**
```
┌────────────────────────────────────────────────────────┐
│ Erro: CST incompatível com CFOP                        │
├────────────────────────────────────────────────────────┤
│ Registro:    C170 — Linha 1.423                        │
│ Campo:       CST_ICMS                                  │
│ Valor atual: 00                                        │
│ Sugestão IA: 40 (operação isenta, compatível c/ CFOP) │
│                                                        │
│ Valor corrigido: [____40____]  ← editável pelo usuário │
│                                                        │
│ ⚠️ Esta correção alterará o arquivo SPED exportado.   │
│    O arquivo original permanece intacto.               │
│                                                        │
│ [Cancelar]  [Ignorar Erro]  [Aplicar Correção]        │
└────────────────────────────────────────────────────────┘
```

### 1.3 Relatório de Erros (Export)

**Formatos:** Excel (.xlsx) + PDF

**Conteúdo do relatório:**
```
Cabeçalho:
- Empresa, CNPJ, Período, Data do relatório, Total de erros

Por erro:
- Código da regra
- Categoria / Severidade
- Linha no arquivo SPED
- Registro (ex: C170, E110)
- Campo com problema
- Valor atual
- Valor sugerido
- Instrução para corrigir no ERP
- Status (Aberto / Corrigido no Audisped / Ignorado)
```

---

## Fase 2 — Correção Direta + Export do SPED Corrigido

### 2.1 Serviço de Correção de Linhas SPED (Backend)

```
/backend/services/sped-corrector/
  ├── index.js          ← aplica correções e recalcula totais
  ├── parser.js         ← lê o .txt SPED em estrutura de objetos
  ├── rebuilder.js      ← reconstrói o .txt após correções
  └── totalizador.js    ← recalcula |0990|, |9990|, |9999|, etc.
```

**Fluxo:**
```
1. Usuário aplica N correções (salvas no banco)
2. Usuário clica "Exportar SPED Corrigido"
3. Backend carrega arquivo original
4. Aplica todas as correções salvas linha por linha
5. Recalcula TODOS os contadores e totalizadores dos blocos afetados
6. Gera novo arquivo .txt
7. Frontend faz download do arquivo
8. Arquivo original permanece intocado no servidor
```

**Campos corretáveis na v1 (escopo limitado e seguro):**
- CST_ICMS, CST_PIS, CST_COFINS
- CFOP
- VL_BC_ICMS, VL_ICMS
- VL_BC_PIS, VL_PIS
- VL_BC_COFINS, VL_COFINS
- ALIQ_ICMS, ALIQ_PIS, ALIQ_COFINS

### 2.2 Rastreamento de Correções no Banco

```sql
CREATE TABLE correcoes_aplicadas (
  id              SERIAL PRIMARY KEY,
  id_sped_arquivo INT REFERENCES sped_arquivos(id),
  id_erro         INT REFERENCES erros_analise(id),
  regra_id        VARCHAR(50),
  linha_arquivo   INT,
  campo           VARCHAR(100),
  valor_original  TEXT,
  valor_corrigido TEXT,
  origem          VARCHAR(20), -- 'MANUAL', 'IA', 'REGRA_AUTO'
  usuario_id      INT,
  criado_em       TIMESTAMP DEFAULT NOW()
);
```

---

## Fase 3 — IA Assistida (após histórico suficiente)

### Premissas obrigatórias antes de ativar IA:
- Mínimo 500 correções manuais registradas na tabela `correcoes_aplicadas`
- IA **nunca** corrige silenciosamente — sempre apresenta sugestão para aprovação
- Toda sugestão da IA fica marcada como `origem = 'IA'` no banco

### Abordagem técnica:
- **Fase 3a**: Regras baseadas em padrões do histórico (sem LLM)
  - Ex: "sempre que CST=00 + CFOP=1556, sugerir CST=40"
  - Determinístico, auditável, sem custo de API
- **Fase 3b**: LLM (Claude API) para erros complexos/ambíguos
  - Enviar: tipo de erro + linha SPED + contexto fiscal
  - Receber: sugestão + justificativa
  - Nunca enviar dados sensíveis de cliente sem consentimento (LGPD)

---

## Novos Erros a Mapear (framework incremental)

A cada erro encontrado no PVA, criar uma nova regra seguindo o padrão:

| ID | Nome | Categoria | Status |
|----|------|-----------|--------|
| CST_CFOP_001 | CST x CFOP incompatível | fiscal | a implementar |
| CONT_001 | Contador de registros incorreto | estrutura | a implementar |
| CNPJ_001 | CNPJ divergente XML x SPED | xml | já existe |
| LMC_001 | Ruptura de continuidade LMC | lmc | já existe |
| ... | (adicionados incrementalmente) | ... | ... |

---

## Ordem de Entrega Sugerida

```
Sprint 1 — Motor de regras + novo layout visual do Analisador
Sprint 2 — Relatório Excel/PDF
Sprint 3 — Correção manual de campos + rastreamento no banco
Sprint 4 — Export do SPED corrigido (com recálculo de totais)
Sprint 5 — Mover LMC pro /lmc + nova página /documentos
Sprint 6+ — IA (sugestões baseadas em histórico)
```

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| SPED exportado inválido (totais errados) | Rodar PVA automatizado como validador antes do download |
| IA corrigir campo errado | IA = sugestão, nunca auto-apply. Confirmação obrigatória |
| Cliente enviar SPED corrigido com erro ao Fisco | Aviso legal explícito no modal de export. Arquivo original sempre preservado |
| Volume de erros deixar a página lenta | Paginação server-side + filtros obrigatórios antes de carregar |
| LGPD com dados enviados para LLM | Anonimizar CNPJ/CPF antes de enviar para API externa |

---

# Addendum (2026-06-14) — Análise da orquestra de agentes + curadoria sênior

> Produzido por orquestração de 7 agentes (estrutura, apuração ICMS/ST, combustíveis/LMC, o que o PVA valida, benchmark E-Auditoria/CheckSped/SAAM, inventário do código atual, matriz de testes QA). **Nenhuma linha de código foi alterada** — só análise e planejamento.
> **Catálogo completo de erros (≈80 regras, com status ✅/🟡/🔴): [CATALOGO_ERROS_SPED.md](CATALOGO_ERROS_SPED.md).**

## 1. Crítica ao plano (questionando o pensamento)

1. **Não construir um `sped-corrector` paralelo (Fase 2.1).** O sistema **já corrige** dezenas de erros no motor de export: totalizadores X990/9900/9999, dedup C100/D100, CFOP de entrada inexistente, CST 61→60, uso/consumo→x90, coerência 1300/1310, realocação 0221, normalização 0220, CAP_TANQUE 2026, E210 VL_RETENCAO_ST. Um novo serviço que "reescreve linhas e recalcula totais" **duplica e vai divergir** do export. → **Correção deve ser DADO, não código paralelo:** correções manuais entram como overrides (igual já existe `sped_1320.corrigido`, `lmc_*_ajustado`, `de_para_xml`) que o **export consome**. A "Central de Erros" *expõe* o que o export já faz como "correções automáticas aplicadas".
2. **"Rodar PVA automatizado como validador" é inviável.** O PVA é Java desktop, sem CLI oficial confiável. → **Validador interno** (motor de regras) cobrindo exatamente as classes que o PVA bloqueia (mapeadas no catálogo) + **amostragem manual** no PVA. Não prometer automação do PVA.
3. **O maior valor não é só o que o PVA bloqueia — é o que ele NÃO vê.** O PVA confere aritmética/domínio/DV, mas **não detecta omissão de documento, não cruza com a SEFAZ e não julga mérito fiscal**. O diferencial (e o que mais protege o posto de autuação) são os **cruzamentos**: EFD×SEFAZ (já temos), ST/ressarcimento/E116/E210, EFD×EFD-Contribuições. Priorizar isso **acima** da UI.
4. **Priorize por SEVERIDADE, não por categoria.** O eixo certo é `BLOQUEANTE` (cliente não transmite) vs `ADVERTÊNCIA`. A tabela do plano ("fiscal/estrutura/lmc") é organização, não prioridade. Ver "Top prioridades" no catálogo.
5. **A IA (Fase 3) está superdimensionada.** O `regrasFiscaisService` **já é** a "Fase 3a" (regras determinísticas baseadas em padrão fiscal, vigência por competência). A maioria das correções de posto é determinística — não precisa de 500 correções nem LLM. Rebaixar a IA/LLM para "casos ambíguos raros".
6. **Risco invisível no plano: ZERO testes automatizados.** Não há jest/vitest/cypress (só scripts ad-hoc `test_optimize.js`, `test_keys.js`). Antes de "corrigir mais", blindar os fixes recorrentes com **testes de regressão golden-file** (original → export → checar invariantes: X990 fecha, 0220=3 campos, sem 0221 órfão, sem CFOP de entrada inválido, CST 61 só pós-vigência). Senão, reintroduzimos erros já resolvidos.
7. **Falta infra de tabelas versionadas** (CFOP/CST/NCM/CEST/ANP/IBGE/IE) por competência. O próprio PVA rejeita códigos novos quando desatualizado; nosso validador precisa de tabelas datadas — senão geramos **falso-erro** ou deixamos passar.

## 2. Reconciliação — o que JÁ existe (não re-planejar)

Detecção (`/api/analisar`, `analisar-sintaxe`, validações-1320): C100×C190 valor, C100 sem C190, salto de numeração, CNPJ da chave (posicional), NCM<8, bico multi-tanque, H010×1300, continuidade 1300 (CRIT-1300-01/02), capacidade/variação/negativo do 1310 (CRIT-1310-01/02/04), participante sem 0150 (CRIT-C100-01), NF entrada×LMC, CST×CFOP de venda (RTAX-C170-01), sequência de saídas, emissão própria, lacunas LMC.
Correção automática (export/injeção): X990/9900/9999, dedup C100/D100, 0220, 0221, CFOP entrada inexistente, CST 61→60, uso/consumo→x90, coerência 1300/1310, CAP_TANQUE, E210 retenção ST, motor de regras (CST 60/61⇒PIS/COFINS 04; monofásico).
**Gaps confirmados:** DV de chave/CNPJ; E116 a partir do E110; recálculo de E110 e de C190 no export; crédito ST de entrada (Fase 3); CEST/ANP/IE/IBGE contra tabela; EFD×EFD-Contribuições; status SEFAZ por chave.

## 3. O que o PVA valida × NÃO valida (resumo para a estratégia)

- **Bloqueia:** estrutura/leiaute (nº de campos, `|` no conteúdo, hierarquia, ordem, X990/9900/9999), domínio (CFOP/CST/NCM/CEST/IBGE/ANP/unidade), datas, **DV** (CNPJ/CPF/IE/chave), soma filho×mestre (C190↔C100, D190↔D100, 1310↔1300), combinação CST×CFOP×ALIQ, apuração aritmética (E110/E116/E210/E250), referências (0150/0190/0200).
- **Advertência (transmite):** NCM "duvidoso", coerências fracas, E113.
- **NÃO faz:** cruzar com a SEFAZ, detectar omissão de nota, julgar mérito fiscal, recalcular C190 a partir do C170. **← é aqui que o Audisped agrega valor.**

## 4. Benchmark (E-Auditoria / CheckSped / SAAM)

Funcionalidades com maior retorno para postos (detalhe e fontes em [CATALOGO_ERROS_SPED.md](CATALOGO_ERROS_SPED.md)):
- **EFD × NF-e SEFAZ por chave** (faltante/cancelada/denegada/valor divergente) — modelo CheckSped (baixa XML pela chave). Já temos base (conciliação CSV + MDe).
- **Cruzamento ST/ressarcimento × E210 + saldo** — núcleo fiscal do posto; é o nosso gap da Fase 3.
- **EFD × inventário (Bloco H) / estoque negativo** — alinha com LMC 1300/1320.
- **EFD × EFD-Contribuições** (PIS/COFINS 04 na revenda monofásica).
- **Correção em lote / editor estilo Excel + reconversão TXT**, **trilha de auditoria**, **captura automática de SPED no e-CAC**, **recuperação de créditos (5 anos)**.

## 5. Plano de Testes QA (matriz resumida)

**Achado crítico: não há nenhum teste automatizado no projeto.** Recomendação prioritária: suíte de **regressão golden-file** do export (proteger os fixes recorrentes) + testes de unidade do `conciliacaoService` e `regrasFiscaisService`.

Funcionalidades a cobrir e cenários de fronteira (matriz completa nas anotações da orquestra): Upload/parse (arquivo sem 0000, UTF-8 vs latin1, CNPJ×empresa divergente, multi-mês, reupload/idempotência); Analisador (sem C100, corrigir-item id inválido, re-análise idempotente, SSE sem cleanup); Injetor XML/CTe (chave inválida, período divergente, duplicata + `forceReplace`, 200+ XMLs, **`analyzeOnly` que persiste quando há `id_sped_arquivo`** — ver achado da sessão); Conciliação (CSV vazio/cabeçalho diferente/`;`vs`,`/BOM, multi-mês, escopo período do SPED); LMC/otimizador (target>capacidade, estoque negativo, mês 1 dia, concorrência em confirmar-sincronizacao); Export (idempotência byte a byte do não-modificado, **IDOR `exportar-sped/:id` + token na query string**, 9999 correto); MDe/EspiãoNFe (certificado expirado, SEFAZ offline, chaves != 44, IDOR delete-notas); NFe Completa (chave inexistente, sem IPI, CT-e no endpoint de NF-e).
**Riscos transversais que geram SPED inválido:** injeção duplicada, X990 defasado, estoque negativo pós-otimizador, CNPJ divergente, campo numérico NaN por parse de string vazia.

## 6. Catálogo de Erros Mapeados

→ **[CATALOGO_ERROS_SPED.md](CATALOGO_ERROS_SPED.md)** (≈80 regras por bloco: 0, C, D, E, 1, H, 9 + cruzamentos externos), cada uma com **detecção no .txt**, **severidade (BLOQ/ADV)**, **status no Audisped (✅/🟡/🔴)** e **correção**. Substitui a tabela embrionária "Novos Erros a Mapear" acima.

## 7. Roadmap repriorizado (substitui "Ordem de Entrega")

```
Sprint 0 — Arnês de testes de regressão (golden-file do export) + tabelas versionadas (CFOP/CST/NCM/CEST/ANP/IBGE).  ← pré-requisito, hoje inexistente
Sprint 1 — Motor de regras como CATÁLOGO (carrega CATALOGO_ERROS_SPED.md como regras); expor no Analisador o que o export já corrige.
Sprint 2 — BLOQUEANTES recorrentes que faltam: nº de campos genérico, DV (chave/CNPJ), C190 recalculado do C170, dedup/órfão geral.
Sprint 3 — Apuração: E116 (do E110) + E250 + crédito ST de entrada (ICMS Tributário Fase 3) + recálculo E110 no export.
Sprint 4 — Cruzamentos (o que o PVA não vê): status SEFAZ por chave; EFD×EFD-Contribuições.
Sprint 5 — Relatório (Excel/PDF) + correção manual via overrides (sem corrector paralelo) + trilha de auditoria.
Sprint 6+ — IA só para casos ambíguos (o determinístico já cobre a maioria).
```

