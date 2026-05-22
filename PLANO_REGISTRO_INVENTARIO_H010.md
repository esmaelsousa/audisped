# PLANO — Correção do Registro de Inventário (Bloco H / H005 / H010 / H020)

## Contexto Legal

O Bloco H do SPED Fiscal (EFD-ICMS/IPI) representa o Registro de Inventário Físico.
Conforme o Guia Prático da EFD-ICMS/IPI e o Ajuste SINIEF 02/2009:

- O inventário de encerramento do exercício (31/12) deve ser informado **obrigatoriamente
  na EFD do mês de FEVEREIRO** do ano seguinte.
- O PVA emite **advertência** se a EFD de fevereiro não contiver um H005 com
  DT_INV = 31/12 do ano anterior e MOT_INV = 01.
- Postos de combustível que ajustam o LMC (registro 1300) de dezembro via
  Otimizador/Redistribuir alteram o fechamento físico — mas o H010 do arquivo
  de fevereiro permanece com os valores originais, gerando divergência.

---

## Estrutura Oficial do Bloco H

### Hierarquia

```
H001  (Abertura do Bloco H)
  H005  (Totais do Inventário — pode haver vários, um por motivo/data)
    H010  (Itens do Inventário — filho do H005)
      H020  (Informação Complementar — filho do H010, obrigatório quando MOT_INV 02 a 05)
  H990  (Encerramento do Bloco H)
```

### Registro H005 — Totais do Inventário

```
|H005|DT_INV|VL_INV|MOT_INV|
 pos:  0  1     2      3
```

| Campo | Descrição | Tipo | Obrigatório |
|-------|-----------|------|-------------|
| DT_INV | Data do inventário (formato DDMMAAAA) | N8 | Sim |
| VL_INV | Valor total do estoque | N(15,2) | Sim |
| MOT_INV | Motivo do inventário (tabela abaixo) | C2 | Sim |

### Tabela de Motivos (MOT_INV)

| Codigo | Motivo | Quando informar | H020 obrigatorio |
|--------|--------|-----------------|-------------------|
| 01 | No final do periodo | EFD de FEVEREIRO (inventario 31/12 ano anterior) | Nao |
| 02 | Mudanca de forma de tributacao ICMS | Mes em que ocorrer a mudanca | Sim |
| 03 | Baixa cadastral, paralisacao temporaria | Mes do evento | Sim |
| 04 | Alteracao de regime de pagamento | Mes da alteracao | Sim |
| 05 | Por determinacao dos fiscos | Quando solicitado | Sim |
| 06 | Controle de mercadorias ST (restituicao/ressarcimento) | Quando aplicavel | Nao |

### Registro H010 — Itens do Inventário

```
|H010|COD_ITEM|UNID|QTD|VL_UNIT|VL_ITEM|IND_PROP|COD_PART|TXT_COMPL|COD_CTA|
 pos:  0   1     2    3    4      5       6        7        8         9
```

| Campo | Descricao | Tipo | Obrigatorio |
|-------|-----------|------|-------------|
| COD_ITEM | Codigo do item (deve existir no 0200) | C60 | Sim |
| UNID | Unidade do item | C6 | Sim |
| QTD | Quantidade do estoque | N(15,3) | Sim |
| VL_UNIT | Valor unitario do item | N(15,6) | Sim |
| VL_ITEM | Valor total do item (QTD x VL_UNIT) | N(15,2) | Sim |
| IND_PROP | Indicador de propriedade (0=proprio, 1=terceiros posse propria, 2=proprio posse terceiros) | C1 | Sim |
| COD_PART | Codigo do participante (obrigatorio se IND_PROP = 1 ou 2) | C60 | OC |
| TXT_COMPL | Descricao complementar | C | OC |
| COD_CTA | Conta contabil do estoque | C | O (perfil A/B) |

**Regras de validacao H010:**
- COD_ITEM deve existir no registro 0200
- Se IND_PROP = 1 ou 2, COD_PART e obrigatorio (deve existir no 0150)
- COD_CTA e obrigatorio para EFD com perfil A ou B
- Nao pode haver H010 se VL_INV do H005 pai for zero

### Registro H020 — Informacao Complementar do Inventario

```
|H020|CST_ICMS|BC_ICMS|VL_ICMS|
 pos:  0   1      2       3
```

| Campo | Descricao | Tipo | Obrigatorio |
|-------|-----------|------|-------------|
| CST_ICMS | Codigo da Situacao Tributaria do ICMS | N3 | Sim |
| BC_ICMS | Base de calculo do ICMS | N(15,2) | OC |
| VL_ICMS | Valor do ICMS | N(15,2) | OC |

**Regra**: H020 e obrigatorio quando MOT_INV do H005 pai for 02, 03, 04 ou 05.
Para MOT_INV = 01 (inventario final) e 06 (ST), o H020 nao e exigido.

---

## Problema no Sistema Atual

### Diagnostico

1. **Import**: O H010 e lido apenas para gerar o alerta `h010_divergente_1300`
   (linhas 649-652 do server.js). Nao e salvo no banco. O MOT_INV do H005
   nao e capturado.

2. **Export**: Ja existe codigo (linhas 5976-5995 do server.js) que reescreve
   QTD e VL_ITEM do H010 usando `mapFechFinalLmc`. Porem:
   - Usa `COALESCE(fech_fisico_ajustado, fech_fisico)` que pode estar **inflado**
   - Nao distingue MOT_INV (aplica para qualquer motivo, nao apenas 01)
   - Nao recalcula VL_INV do H005 pai
   - Nao preserva/trata H020 quando presente
   - Nao usa `encerrantes_exportados` (tabela de fechamentos realmente exportados)

3. **Cruzamento 1300 x H010** (linhas 720-730): Soma todos os H010 e compara
   com o ultimo 1300. Funciona como alerta, mas nao corrige.

### Exemplo real

| Data | Produto | H010 Original | Fech. Dez. Ajustado | Diferenca |
|------|---------|---------------|---------------------|-----------|
| 31/12/2023 | OLEO DIESEL S-500 | 1.378,004 L | (a verificar) | Divergente |

---

## Plano de Implementacao

> **Principio**: Nao criar tabelas desnecessarias. O codigo de export (linhas
> 5976-5995) ja existe — sera **corrigido e expandido**, nao duplicado.

---

### Fase 0 — Tabela no banco (setup_db.js)

**Arquivo**: `backend/setup_db.js` — adicao via `CREATE TABLE IF NOT EXISTS`

```sql
CREATE TABLE IF NOT EXISTS sped_h010 (
    id               SERIAL PRIMARY KEY,
    id_sped_arquivo  INTEGER NOT NULL REFERENCES sped_arquivos(id) ON DELETE CASCADE,
    cod_item         TEXT NOT NULL,
    unid             TEXT,
    qtd              NUMERIC(15,3),
    vl_unit          NUMERIC(15,6),
    vl_item          NUMERIC(15,2),
    ind_prop         TEXT DEFAULT '0',
    cod_part         TEXT,
    txt_compl        TEXT,
    cod_cta          TEXT,
    dt_inventario    DATE,
    mot_inv          TEXT DEFAULT '01'
);
```

**Justificativa dos campos**:
- `dt_inventario` — vem do H005 pai (DT_INV), necessario para saber DE QUAL
  dezembro buscar o fechamento
- `mot_inv` — vem do H005 pai (MOT_INV), necessario para decidir SE deve
  aplicar a correcao (so para 01)

**NAO sera criada tabela para H020**: o H020 sera preservado inalterado na
exportacao (pass-through). Se no futuro for necessario manipula-lo, a tabela
sera criada nesse momento.

---

### Fase 1 — Armazenar H005/H010 no import (server.js — rota de import)

No parser de importacao (funcao que processa o arquivo SPED linha a linha):

```
Variavel de estado: let h005Atual = { dtInv: null, motInv: null }

AO ENCONTRAR H005:
    h005Atual.dtInv  = parseDateDDMMAAAA(fields[2])  // ex: 31122023 -> 2023-12-31
    h005Atual.motInv = fields[4] || '01'

AO ENCONTRAR H010:
    INSERT INTO sped_h010 (
        id_sped_arquivo, cod_item, unid, qtd, vl_unit, vl_item,
        ind_prop, cod_part, txt_compl, cod_cta, dt_inventario, mot_inv
    ) VALUES (
        arquivoId, fields[2], fields[3], fields[4], fields[5], fields[6],
        fields[7], fields[8], fields[9], fields[10],
        h005Atual.dtInv, h005Atual.motInv
    )
```

**Regra**: O H010 herda `dt_inventario` e `mot_inv` do H005 imediatamente
anterior (relacao pai-filho no SPED e posicional).

---

### Fase 2 — Corrigir a busca de fechamento no export (server.js — rota de export)

**Substituir** a query `fechFinalLmc` (linhas 5406-5412) que alimenta o
`mapFechFinalLmc` usado pelo H010.

Logica atual (ERRADA):
```sql
COALESCE(fech_fisico_ajustado::numeric, fech_fisico::numeric, 0) AS fech
```

Logica corrigida (3 fontes, por prioridade):

```
FONTE 1 — encerrantes_exportados (fechamento REALMENTE exportado de dezembro)
    SELECT cod_item, fech_fisico_exportado AS fech
    FROM encerrantes_exportados
    WHERE cnpj_empresa = $cnpj AND competencia = $competencia_dezembro

FONTE 2 — lmc_movimentacao (fallback, prioriza fech_fisico original)
    SELECT DISTINCT ON (TRIM(cod_item))
        TRIM(cod_item) AS cod_item,
        CASE
            WHEN fech_fisico::numeric > 0 THEN fech_fisico::numeric
            ELSE COALESCE(fech_fisico_ajustado::numeric, 0)
        END AS fech
    FROM lmc_movimentacao
    WHERE id_sped_arquivo = $id_arquivo_dezembro
      AND data_mov::date = $dt_inventario
    ORDER BY TRIM(cod_item), data_mov DESC

FONTE 3 — H010 original do arquivo (fallback final)
    Manter o valor que ja esta no arquivo, sem modificar.
```

**Para determinar `$competencia_dezembro`**:
- Ler o H005 do arquivo sendo exportado
- Extrair DT_INV (ex: 31122023 -> competencia = '2023-12')
- Buscar o arquivo do mesmo CNPJ com periodo_apuracao contendo '2023-12'

**Regra critica**: So aplicar a correcao quando:
- MOT_INV do H005 = **01** (inventario final do exercicio)
- DT_INV aponta para **31/12** de algum ano
- O arquivo de dezembro do mesmo CNPJ existe no sistema

Para MOT_INV = 02 a 06, o H010 passa **inalterado**.

---

### Fase 3 — Corrigir o bloco H010 no export (server.js — linhas 5976-5995)

**Expandir** o codigo existente. Nao duplicar.

```
VARIAVEIS DE ESTADO (antes do loop principal):
    let h005Buffer = null       // Guarda a linha do H005 para recalcular VL_INV
    let h005VlInvAcum = 0       // Acumula VL_ITEM dos H010 filhos
    let h005MotInv = null       // MOT_INV do H005 corrente
    let h005DtInv = null        // DT_INV do H005 corrente
    let mapFechDezembro = null  // Map<cod_item, fech> — carregado sob demanda

AO ENCONTRAR H005:
    // Descarregar H005 anterior (se houver) com VL_INV recalculado
    flushH005()

    h005DtInv  = fields[2]     // DDMMAAAA
    h005MotInv = fields[4]     // MOT_INV
    h005VlInvAcum = 0

    // Carregar fechamentos de dezembro sob demanda (so para MOT_INV = 01 + DT_INV = 31/12)
    SE h005MotInv === '01' E h005DtInv termina em '12XXXX' (dia 31/12):
        SE mapFechDezembro === null:
            mapFechDezembro = carregarFechamentosDezembro(cnpjArq, h005DtInv)

    // NAO escrever H005 agora — guardar no buffer para reescrever VL_INV ao final
    h005Buffer = fields

AO ENCONTRAR H010:
    cod_item = TRIM(fields[2])
    ind_prop = fields[7] || '0'

    SE h005MotInv === '01' E ind_prop === '0' E mapFechDezembro tem cod_item:
        fechAlvo = mapFechDezembro.get(cod_item)
        qtdOriginal = parseFloat(fields[4])

        SE Math.abs(qtdOriginal - fechAlvo) > 0.001:
            vlUnit = parseFloat(fields[5])
            novoQtd = fechAlvo
            novoVlItem = novoQtd * vlUnit

            fields[4] = formatarNumero(novoQtd, 3)     // QTD
            fields[6] = formatarNumero(novoVlItem, 2)   // VL_ITEM
            changesApplied++

    // Acumular VL_ITEM para recalcular VL_INV do H005 pai
    h005VlInvAcum += parseFloat(fields[6])

    pushLine(fields.join('|'))
    continue

AO ENCONTRAR H020:
    // Pass-through — nao modificar
    pushLine(line)
    continue

FUNCAO flushH005():
    SE h005Buffer !== null:
        h005Buffer[3] = formatarNumero(h005VlInvAcum, 2)   // VL_INV recalculado
        pushLine(h005Buffer.join('|'))
        h005Buffer = null
        h005VlInvAcum = 0

// IMPORTANTE: Chamar flushH005() tambem:
//   - Antes do proximo H005 (ja coberto acima)
//   - Ao encontrar H990 (encerramento do Bloco H)
//   - No flush final pos-loop (junto com flush1300Group)
```

---

### Fase 4 — Alerta na UI antes de exportar (opcional)

**Arquivo**: `frontend/src/views/LmcView.vue`

Antes do botao EXPORTAR SPED, exibir painel de alerta se:
- O arquivo e de fevereiro
- Existem H010 salvos no banco para este arquivo
- O fechamento de dezembro (ajustado ou exportado) difere do QTD do H010

```
+---------------------------------------------------------------+
|  Inventario H010 sera corrigido na exportacao                  |
|  Combustivel          H010 Original   Fech. Dez.   Diferenca  |
|  Oleo Diesel S-500    1.378,004 L     X.XXX,XXX L    Y L      |
+---------------------------------------------------------------+
|  O sistema corrigira QTD do H010 e recalculara VL_INV do H005 |
+---------------------------------------------------------------+
```

**Endpoint auxiliar** (somente leitura):
```
GET /api/preview-h010-correcao/:id
```
Retorna lista de produtos com divergencia H010 vs fechamento dezembro.

---

## Casos Especiais

| Situacao | Tratamento |
|----------|------------|
| MOT_INV = 01 (inventario final 31/12) | Aplicar correcao: QTD = fech dezembro exportado |
| MOT_INV = 02 (mudanca tributacao) | NAO corrigir — so itens com mudanca tributaria |
| MOT_INV = 03, 04, 05 (inventarios especiais) | NAO corrigir — passar H010 original |
| MOT_INV = 06 (ST restituicao/ressarcimento) | NAO corrigir — logica propria |
| IND_PROP = 0 (estoque proprio) | Aplicar correcao |
| IND_PROP = 1 (terceiros em posse propria) | NAO corrigir — nao e estoque nosso |
| IND_PROP = 2 (proprio em posse de terceiros) | NAO corrigir — estoque em custodia |
| Dezembro nao importado no sistema | Manter H010 original + log de aviso |
| Dezembro importado mas nao exportado | Fallback para lmc_movimentacao.fech_fisico |
| Dezembro exportado (encerrantes_exportados existe) | Usar fech_fisico_exportado (prioridade 1) |
| cod_item no H010 sem correspondencia no LMC | Manter H010 original para aquele item |
| Multiplos H010 para mesmo cod_item (split por IND_PROP) | So corrigir o de IND_PROP = 0 |
| Arquivo de janeiro com H010 | Aplicar mesma logica se MOT_INV = 01 e DT_INV = 31/12 |
| H020 presente (MOT_INV 02-05) | Pass-through — preservar inalterado |
| VL_INV do H005 = 0 | NAO gerar H010 (regra do PVA) |
| COD_CTA ausente (perfil A/B) | Preservar o que vier no original — nao inventar |

---

## Arquivos Impactados

| Arquivo | Tipo de Mudanca | Risco |
|---------|-----------------|-------|
| `backend/setup_db.js` | CREATE TABLE IF NOT EXISTS sped_h010 | Zero |
| `backend/server.js` — import | Inserir H005 data/motivo + H010 na tabela | Baixo |
| `backend/server.js` — export (linhas 5976-5995) | Expandir logica existente com filtro MOT_INV, fontes priorizadas, recalculo VL_INV do H005 | Medio |
| `frontend/src/views/LmcView.vue` | Painel de alerta H010 (opcional) | Baixo |
| Todos os outros arquivos | Nenhuma alteracao | Zero |

---

## Ordem de Execucao

| Fase | Escopo | Dependencia |
|------|--------|-------------|
| Fase 0 | Criar tabela sped_h010 | Nenhuma |
| Fase 1 | Gravar H005/H010 no import | Fase 0 |
| Fase 2 | Corrigir query de fechamento dezembro | Nenhuma (usa encerrantes_exportados ja existente) |
| Fase 3 | Expandir logica H010 no export | Fase 2 |
| Fase 4 | Alerta UI (opcional) | Fase 1 |

---

## Comportamento Esperado Apos Implementacao

| Cenario | Antes | Depois |
|---------|-------|--------|
| Exportar fev com H010, dezembro exportado | H010 com QTD original (divergente) | QTD = fech dezembro exportado |
| Exportar fev com H010, dezembro importado mas nao exportado | H010 com QTD original | QTD = fech_fisico original do LMC dezembro |
| Exportar fev com H010, dezembro nao importado | H010 com QTD original | H010 inalterado + log de aviso |
| Exportar fev com MOT_INV = 02 | H010 modificado indevidamente | H010 inalterado (correto) |
| Reexportar dezembro | N/A | encerrantes_exportados atualizado, proximo fev usara valor novo |
| VL_INV do H005 | Nao recalculado (divergente dos H010 corrigidos) | Recalculado = soma VL_ITEM dos H010 |

---

## Validacoes PVA que devem passar

- H005 de fevereiro com DT_INV = 31/12 e MOT_INV = 01 (sem advertencia)
- H010.COD_ITEM existe no 0200 (ja garantido pelo filtro existente)
- H010.VL_ITEM = QTD x VL_UNIT (recalculado)
- H005.VL_INV = soma dos VL_ITEM dos H010 filhos (recalculado)
- H020 presente quando MOT_INV = 02 a 05 (preservado do original)
- COD_CTA preenchido para perfil A/B (preservado do original)

---

## Referencias Legais

- Guia Pratico EFD-ICMS/IPI (Versao 2.0.21+) — Receita Federal
- Ajuste SINIEF 02/2009 — instituiu a EFD
- Cartilha Bloco H Inventario — SEFAZ/CE (2024)
- ATO COTEPE/ICMS 09/2008 — leiaute do SPED Fiscal

---

## Status

- [ ] Fase 0 — Tabela sped_h010
- [ ] Fase 1 — Import H005/H010
- [ ] Fase 2 — Query fechamento dezembro (priorizar encerrantes_exportados)
- [ ] Fase 3 — Expandir logica H010 no export + recalcular VL_INV do H005
- [ ] Fase 4 — Alerta UI (opcional)

**Revisado em:** 11/05/2026
**Versao:** 2.0 (corrigido com regras oficiais MOT_INV, H020, prioridade de fontes)
**Prioridade:** Media — aplicar em proxima janela de desenvolvimento
