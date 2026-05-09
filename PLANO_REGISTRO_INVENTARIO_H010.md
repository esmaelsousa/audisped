# PLANO — Correção do Registro de Inventário (Bloco H / H010)

## Problema

O SPED Fiscal de fevereiro em diante contém o Bloco H com o inventário de 31/12 do ano anterior.
Quando ajustamos o 1300 de dezembro via REDISTRIBUIR / AUTO / OTIMIZADOR, o fechamento físico
de dezembro muda — mas o H010 do arquivo de fevereiro não é atualizado, gerando divergência na
exportação.

Exemplo real observado:
| Data | Produto | H010 Original | Fech. Dez. Ajustado | Diferença |
|---|---|---|---|---|
| 29/02/2024 | ÓLEO DIESEL S-500 | 1.378,004 L | — | Divergente |

---

## Diagnóstico do Sistema Atual

- **Import**: H010 é lido apenas para gerar o alerta `h010_divergente_1300`. Não é salvo no banco.
- **Export** (`/api/exportar-sped/:id`): O Bloco H é copiado do arquivo original sem qualquer modificação.
- **Conclusão**: não há nenhum mecanismo hoje que corrija o H010 na exportação.

---

## Plano de Implementação

### Fase 1 — Armazenar H010 no banco (durante o import)

**Criar tabela:**
```sql
CREATE TABLE IF NOT EXISTS sped_h010 (
    id               SERIAL PRIMARY KEY,
    id_sped_arquivo  INTEGER NOT NULL REFERENCES sped_arquivos(id) ON DELETE CASCADE,
    cod_item         VARCHAR NOT NULL,
    unid             VARCHAR,
    qtd              NUMERIC(15,3),
    vl_unit          NUMERIC(15,6),
    vl_item          NUMERIC(15,2),
    ind_prop         VARCHAR,
    cod_part         VARCHAR,
    txt_compl        VARCHAR,
    cod_cta          VARCHAR,
    dt_inventario    DATE   -- vem do H005 (campo DT_INV)
);
```

**No parser do import** (função que processa linha a linha):
- Ao encontrar `H005`: capturar campo `DT_INV` (data do inventário, ex: `31122023`)
- Ao encontrar `H010`: inserir na tabela `sped_h010` com a data capturada do H005 pai

---

### Fase 2 — Buscar o fechamento ajustado de dezembro (no export)

Quando `/api/exportar-sped/:id` for chamado para um arquivo com H010:

1. Ler a `dt_inventario` do H005 do arquivo (geralmente `31/12/ano-anterior`)
2. Buscar no banco o arquivo do **mesmo CNPJ** com `periodo_apuracao` correspondente a dezembro daquele ano
3. Para cada `cod_item` presente no H010, executar:

```sql
SELECT cod_item,
       COALESCE(SUM(fech_fisico_ajustado), SUM(fech_fisico)) as fechamento_ajustado
FROM lmc_movimentacao
WHERE id_sped_arquivo = $id_dezembro
  AND cod_item = $cod_item
  AND data_mov::date = $dt_inventario  -- ex: 2023-12-31
GROUP BY cod_item;
```

4. Se houver múltiplos tanques (1310): somar todos os físicos do dia 31/12 → o H010 é sempre consolidado.

---

### Fase 3 — Substituir H010 na exportação

No loop de geração do arquivo (`for await (const line of rl)`), adicionar bloco para H010:

```
SE fields[1] === 'H010':
    cod_item  = fields[2]
    vl_unit   = parseFloat(fields[5])

    SE mapFechamentoDezembro.has(cod_item):
        qtd_novo      = mapFechamentoDezembro.get(cod_item)
        fields[4]     = qtd_novo.toFixed(3).replace('.', ',')         // QTD
        fields[6]     = (qtd_novo * vl_unit).toFixed(2).replace('.', ',')  // VL_ITEM (recalculado)

    pushLine(fields.join('|'))
    continue
```

Após percorrer todos os H010 filhos de um H005:
- Recalcular `VL_INV` do H005 = soma de todos os `VL_ITEM` dos H010 ajustados
- Reescrever a linha do H005 com o novo `VL_INV`

---

### Fase 4 — Aviso na UI antes de exportar

Em `LmcView.vue`, antes do botão EXPORTAR SPED, exibir painel de alerta se houver divergência H010:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠ Inventário H010 será corrigido na exportação                 │
│  Combustível          H010 Original   Fech. Dez. Ajustado   Δ  │
│  Óleo Diesel S-500    1.378,004 L     X.XXX,XXX L         Y L  │
└─────────────────────────────────────────────────────────────────┘
```

Mensagem: "O sistema corrigirá automaticamente o campo QTD do H010 e recalculará VL_INV do H005."

---

### Casos Especiais

| Situação | Tratamento |
|---|---|
| Dezembro do ano anterior não importado no sistema | Manter H010 original + alertar usuário |
| cod_item do H010 sem correspondência no LMC de dezembro | Manter H010 original para aquele item |
| Arquivo de janeiro com H010 (alguns PVAs incluem) | Aplicar a mesma lógica |
| H010 com `IND_PROP = '02'` (mercadoria de terceiros) | Não modificar — não é estoque próprio |

---

### Arquivos Impactados

| Arquivo | Mudança |
|---|---|
| `backend/server.js` — import | Gravar H005 data + H010 na tabela `sped_h010` |
| `backend/server.js` — export | Substituir QTD/VL_ITEM do H010 + recalcular VL_INV do H005 |
| `backend/server.js` — migrations | Criar tabela `sped_h010` |
| `frontend/src/views/LmcView.vue` | Painel de alerta H010 antes do export |

---

## Status

- [ ] Fase 1 — Tabela e import H010
- [ ] Fase 2 — Query fechamento dezembro ajustado
- [ ] Fase 3 — Substituição no export
- [ ] Fase 4 — Alerta UI

**Criado em:** 2026-05-08  
**Prioridade:** Média — aplicar em próxima janela de desenvolvimento
