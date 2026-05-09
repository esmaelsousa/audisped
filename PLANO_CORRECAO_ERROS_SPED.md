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
