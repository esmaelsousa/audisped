# Plano de Implementação — SPED Automático com XML
> Criado em 18/03/2026 | Status: **Aguardando aprovação para início**

---

## Objetivo

Ao carregar um arquivo SPED Fiscal, o sistema deve:
1. Extrair todas as chaves de NF-e de **Entrada** do arquivo
2. Sincronizar o período com a **SEFAZ** via EspiãoNFe e obter todas as notas emitidas contra o CNPJ
3. Comparar os dois conjuntos e identificar as **faltantes**
4. Fazer o **download automático dos XMLs** das notas faltantes

---

## Fluxo Completo

```
Upload SPED Fiscal (.txt)
        ↓
Sistema extrai todas as chaves de NF-e de Entrada
        ↓
Aciona EspiãoNFe → /consulta/periodo/nfe-resumo
(busca tudo que a SEFAZ tem para esse CNPJ no período)
        ↓
Comparação dos dois conjuntos:
  ✅ No SPED e na SEFAZ     → OK (XML disponível)
  🔴 Na SEFAZ, fora do SPED → FALTANTE (precisa baixar)
  ⚠️  No SPED, fora da SEFAZ → DIVERGÊNCIA (nota cancelada ou chave errada)
  ⚪  Tipo Saída              → Ignorada (emitida pela própria empresa)
        ↓
Download automático dos XMLs faltantes
(Envia Ciência da Operação → aguarda → baixa XML)
        ↓
Resultado final: XMLs disponíveis para todos os faltantes
```

---

## Limitação Importante

O download de XML de notas de **Entrada** exige que o destinatário manifeste a nota (mínimo: Ciência da Operação) para a SEFAZ liberar o XML completo.

- **Com certificado A1 configurado**: fluxo 100% automático
- **Sem certificado A1**: sistema baixa o resumo das notas, mas o XML completo pode estar indisponível

---

## O que já existe (não reescrever)

| Funcionalidade | Arquivo | Status |
|---|---|---|
| Upload SPED e extração de chaves por regex | `MdeView.vue → onSpedFileSelected` | ✅ Funciona |
| Comparação de chaves com banco local | `espiaoNfeService.conferirFaltantes` | ✅ Funciona |
| Modal de resultado (total / encontradas / faltantes) | `MdeView.vue` (modal conferência) | ✅ Funciona |
| Solicitação de captura em lote | `baixarFaltantesSped → importarChavesLote` | ✅ Funciona |
| Manifestação automática (Ciência) na captura | `importarChavesLote` | ✅ Funciona |
| Download ZIP de XMLs em lote | `downloadBatchZip` | ✅ Funciona |
| Sincronização por período (EspiãoNFe) | `syncNotas` | ✅ Funciona |
| SSE para streaming de logs em tempo real | `/api/logs/stream` | ✅ Funciona (reaproveitar) |

---

## O que está faltando ou quebrado

### PROBLEMA 1 — Comparação é só contra banco local, não contra a SEFAZ
**Situação atual:** `conferirFaltantes` checa apenas o `mde_cache` (notas já sincronizadas localmente).
**Problema:** se o período nunca foi sincronizado, o banco local está vazio e tudo aparece como faltante — sem confirmar na SEFAZ.
**Impacto:** resultado impreciso e confuso.

### PROBLEMA 2 — Rotas duplicadas sem uso
- `/api/espiao/conferir-sped` → usada pelo frontend, compara só contra `mde_cache`
- `/api/mde/check-sped` → existe mas nunca é chamada, compara contra `mde_cache` + `documentos_c100`
- `/api/mde/sync-missing` → duplica o que `/api/espiao/importar-lote` já faz

### PROBLEMA 3 — Fluxo "Comparar com SPED" está escondido e secundário
O botão "Conferir com SPED" está dentro da seção de "Importação por Chave". A visão do projeto é que esse fluxo seja o **ponto de entrada principal** da tela MD-e.

### PROBLEMA 4 — Resultado sem categorias claras
O modal atual mostra apenas 3 números e as 10 primeiras chaves faltantes. Não distingue:
- Notas sem XML vs notas sem registro
- Notas de Entrada vs Saída
- Notas que precisam de manifestação antes do download

### PROBLEMA 5 — Nenhum feedback de progresso durante captura em lote
O `importarChavesLote` processa uma nota por vez com delay de 500ms. Para 100+ notas isso leva minutos. O usuário vê apenas um alert ao final.

---

## Plano de Implementação — 4 Fases

---

### FASE 1 — Reorganizar o MD-e em torno do SPED
**Arquivo:** `frontend/src/views/MdeView.vue`

**O que fazer:**

1. Criar **bloco principal "Análise do SPED"** no topo da tela com:
   - Área de upload drag-and-drop para o arquivo `.txt` do SPED Fiscal
   - Seleção de competência (mês/ano) detectada automaticamente do arquivo
   - Botão "Analisar SPED"

2. Remover o botão "Conferir com SPED" da seção de importação por chave

3. Substituir o **modal de conferência** por um **painel inline de resultados** com 4 categorias:
   - 🟢 **OK** — chaves no banco com XML disponível
   - 🟡 **Sem XML** — chaves no banco mas sem XML baixado
   - 🔴 **Faltantes** — chaves não encontradas no banco local
   - ⚪ **Saída** — notas emitidas pela própria empresa (sem ação necessária)

4. Ações em lote no painel:
   - "Sincronizar com SEFAZ" → aciona `syncEspiao` com datas do SPED
   - "Baixar XMLs faltantes" → baixa em lote as categorias 🟡 e 🔴
   - "Manifestar todas (Ciência)" → manifesta em lote as sem manifesto

---

### FASE 2 — Melhorar a comparação no backend
**Arquivo:** `backend/services/espiaoNfeService.js` + `backend/server.js`

**O que fazer:**

1. **Atualizar `conferirFaltantes`** para retornar 4 grupos:
```js
return {
  total_arquivo: N,
  ok: [...],        // no banco com XML
  sem_xml: [...],   // no banco sem XML
  faltantes: [...], // não estão no banco
  saida: [...]      // emitidas pela própria empresa (CNPJ emitente = CNPJ da empresa)
}
```

2. **Adicionar detecção Entrada/Saída** — comparar o CNPJ do emitente (posições 6–19 da chave de acesso) com o CNPJ da empresa. Se igual = Saída.

3. **Criar rota unificada** `/api/mde/analisar-sped` que:
   - Recebe as chaves extraídas do SPED
   - Executa `syncNotas` para o período detectado (traz o que a SEFAZ tem)
   - Compara SPED vs SEFAZ
   - Retorna os 4 grupos

4. **Remover rotas duplicadas:** `/api/mde/check-sped` e `/api/mde/sync-missing`

---

### FASE 3 — Captura com feedback em tempo real
**Arquivo:** `backend/server.js` + `frontend/src/views/MdeView.vue`

**O que fazer:**

1. **Criar endpoint SSE** `/api/mde/capturar-progresso` (reaproveita a mesma tecnologia de `/api/logs/stream`):
```
data: {"processadas": 5, "total": 47, "chave": "3521...", "status": "xml_ok"}
data: {"processadas": 6, "total": 47, "chave": "3522...", "status": "aguardando_sefaz"}
data: {"concluido": true, "sucessos": 44, "erros": 3}
```

2. **Barra de progresso no frontend:**
   - `X de Y notas processadas`
   - Status por nota: ✅ XML baixado / ⚠️ aguardando SEFAZ / ❌ erro
   - Botão "Cancelar" para interromper o lote

---

### FASE 4 — Tabela de notas enriquecida
**Arquivo:** `frontend/src/views/MdeView.vue`

**O que fazer:**

1. **Coluna "No SPED"** — badge indicando se a nota veio da análise do SPED carregado

2. **Coluna "Situação"** com 3 estados:
   - ✅ XML disponível
   - ⏳ Aguardando XML (manifestação enviada)
   - ❗ Ação necessária

3. **Filtro rápido "Ver apenas faltantes"** baseado no último SPED analisado

---

## Resumo de Arquivos Alterados

| Arquivo | Fase | O que muda |
|---|---|---|
| `frontend/src/views/MdeView.vue` | 1, 3, 4 | Reorganização do layout, painel de análise inline, barra de progresso, novos filtros e colunas |
| `backend/services/espiaoNfeService.js` | 2 | `conferirFaltantes` retorna 4 grupos + detecção Entrada/Saída |
| `backend/server.js` | 2, 3 | Nova rota `/api/mde/analisar-sped`, remoção de duplicatas, endpoint SSE de progresso |

---

## Ordem de Execução Sugerida

1. **FASE 2** primeiro (backend) — sem ela o frontend não tem dados corretos para exibir
2. **FASE 1** (frontend — reorganização e painel) — depende do backend da Fase 2
3. **FASE 3** (progresso em tempo real) — melhoria de UX, pode ficar para depois
4. **FASE 4** (tabela enriquecida) — melhoria de UX, pode ficar para depois

As fases 1 e 2 juntas já entregam o objetivo principal: **upload SPED → comparar com SEFAZ → baixar faltantes automaticamente.**

---

*Plano aguardando aprovação. Nenhuma alteração foi feita no código.*
