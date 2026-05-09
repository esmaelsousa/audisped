# Plano de Implementação — Continuidade de Encerrantes entre Meses

## Problema a resolver

Ao exportar um arquivo SPED, o sistema recalcula os encerrantes dos bicos
(registros 1320) com base nos ajustes feitos no LMC. Porém, o encerrante
inicial do **primeiro dia de cada mês** sempre parte do valor que estava no
arquivo SPED original — não do valor final exportado do mês anterior.

Isso gera descontinuidade entre os arquivos exportados de meses consecutivos,
que pode ser detectada em uma auditoria ANP cruzando o encerrante final de
dezembro com o encerrante inicial de janeiro.

---

## Princípio arquitetural

> **Tudo que é novo vai em arquivos/tabelas NOVOS. Arquivos existentes só
> recebem ADIÇÕES mínimas. Nenhuma lógica existente é modificada.**

---

## O que NÃO será tocado

| Arquivo | Status |
|---|---|
| Lógica de exportação existente (`flush1300Group`) | INTOCÁVEL |
| Lógica de recálculo 1310/1320 | INTOCÁVEL |
| `lmc_movimentacao` e todas as tabelas existentes | INTOCÁVEIS |
| Todas as views Vue existentes | INTOCÁVEIS |
| `spedCostureiraService.js`, `xmlInjectorService.js` | INTOCÁVEIS |

---

## Fase 0 — Nova tabela no banco

**Arquivo:** `backend/setup_db.js` — somente adição via `CREATE TABLE IF NOT EXISTS`

```sql
CREATE TABLE IF NOT EXISTS encerrantes_exportados (
    id              SERIAL PRIMARY KEY,
    id_sped_arquivo INTEGER NOT NULL REFERENCES sped_arquivos(id) ON DELETE CASCADE,
    cnpj_empresa    TEXT NOT NULL,
    competencia     TEXT NOT NULL,        -- formato 'YYYY-MM'
    num_bico        TEXT NOT NULL,        -- identificador do bico (campo [2] do 1320)
    encerrante_final NUMERIC(15,3) NOT NULL,
    dt_exportacao   TIMESTAMP DEFAULT NOW(),
    UNIQUE (cnpj_empresa, competencia, num_bico)
);
```

**Por que UNIQUE em (cnpj, competencia, num_bico):** cada exportação do mesmo
mês sobrescreve os valores anteriores — sempre prevalece a última exportação.

---

## Fase 1 — Salvar encerrantes ao exportar

**Arquivo:** `backend/server.js` — somente ADIÇÃO após o loop de exportação
existente, sem tocar na lógica do `flush1300Group`.

Após o `for await (const line of rl)` terminar, o `encerrantesBombasMap`
contém os encerrantes finais de cada bico. Adicionar:

```js
// Após o loop de exportação — persiste os encerrantes finais para o próximo mês
if (Object.keys(encerrantesBombasMap).length > 0) {
    const competencia = periodoIniArq
        ? `${periodoIniArq.substring(4,8)}-${periodoIniArq.substring(2,4)}`
        : null;
    if (competencia) {
        for (const [numBico, encFinal] of Object.entries(encerrantesBombasMap)) {
            await dbClient.query(`
                INSERT INTO encerrantes_exportados
                    (id_sped_arquivo, cnpj_empresa, competencia, num_bico, encerrante_final)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (cnpj_empresa, competencia, num_bico)
                DO UPDATE SET encerrante_final = EXCLUDED.encerrante_final,
                              dt_exportacao = NOW(),
                              id_sped_arquivo = EXCLUDED.id_sped_arquivo
            `, [arquivoId, cnpjArq, competencia, numBico, encFinal]);
        }
    }
}
```

---

## Fase 2 — Pré-carregar encerrantes do mês anterior ao exportar

**Arquivo:** `backend/server.js` — somente ADIÇÃO antes do loop de exportação.

Antes do `for await (const line of rl)`, adicionar:

```js
// Pré-carrega encerrantes finais do mês anterior para garantir continuidade
if (periodoIniArq) {
    const competenciaAtual = `${periodoIniArq.substring(4,8)}-${periodoIniArq.substring(2,4)}`;
    const [ano, mes] = competenciaAtual.split('-').map(Number);
    const mesAnterior = mes === 1
        ? `${ano - 1}-12`
        : `${ano}-${String(mes - 1).padStart(2, '0')}`;

    const resEnc = await dbClient.query(`
        SELECT num_bico, encerrante_final
        FROM encerrantes_exportados
        WHERE cnpj_empresa = $1 AND competencia = $2
    `, [cnpjArq, mesAnterior]);

    resEnc.rows.forEach(r => {
        encerrantesBombasMap[r.num_bico] = parseFloat(r.encerrante_final);
    });
}
```

**Efeito:** o `encerrantesBombasMap` já começa populado com os encerrantes
finais do mês anterior. A lógica existente (linha 5551) já faz:

```js
let encInicialReal = encerrantesBombasMap[bicoNum] !== undefined
    ? encerrantesBombasMap[bicoNum]   // ← usará o valor do mês anterior
    : encInicialOriginal;             // ← fallback se não houver mês anterior
```

Nenhuma linha do `flush1300Group` precisa ser alterada.

---

## Fase 3 — Indicador visual no frontend (opcional)

**Arquivo novo:** nenhum — apenas uma linha de resposta extra no endpoint
de exportação.

Ao final do export, incluir no header da resposta ou em um log:

```js
res.setHeader('X-Encerrantes-Continuidade',
    resEnc.rows.length > 0 ? 'propagados' : 'originais');
```

O frontend pode exibir um badge discreto informando se a exportação usou
encerrantes propagados do mês anterior ou os valores originais do SPED.

---

## Resumo do impacto por arquivo existente

| Arquivo | Tipo de mudança | Risco |
|---|---|---|
| `backend/setup_db.js` | CREATE TABLE IF NOT EXISTS | Zero |
| `backend/server.js` | 2 blocos de código adicionados (antes e depois do loop) | Mínimo |
| Todos os outros | Nenhuma alteração | Zero |

---

## Comportamento esperado após implementação

| Cenário | Antes | Depois |
|---|---|---|
| Exportar janeiro sem mês anterior | Usa encerrante original do SPED | Igual (fallback) |
| Exportar fevereiro após exportar janeiro | Descontinuidade | Encerrante inicial de fev = final exportado de jan |
| Reexportar janeiro | Sobrescreve registro na tabela | Novo fev usará o encerrante da nova exportação de jan |
| Deletar arquivo do banco | `ON DELETE CASCADE` remove os encerrantes | Sem dados órfãos |

---

## Sequência de entrega estimada

| Fase | Escopo | Estimativa |
|---|---|---|
| Fase 0 | Nova tabela no banco | 30 min |
| Fase 1 | Salvar encerrantes ao exportar | 1 hora |
| Fase 2 | Pré-carregar encerrantes do mês anterior | 1 hora |
| Fase 3 | Indicador visual (opcional) | 30 min |

---

## Próximo passo

Aguardando aprovação para iniciar a implementação pela Fase 0 + Fase 1 + Fase 2.
