# Plano de Implementação — Compatibilidade de Leiautes SPED Fiscal 2021–2026
> Criado em 18/03/2026 | Status: **Aguardando aprovação para início**

---

## Mapa de Versões (base da lógica condicional)

| Período | Leiaute (COD_VER) | Ato COTEPE | Principal mudança |
|---|---|---|---|
| 2021 | **015** | 44/2020 | C181, C186 (retorno ST) |
| 2022 | **016** | 2021 | 0210 descontinuado, D100 COD_MUN_ORIG obrigatório, Reg. 1601 novo |
| 2023 | **017** | 21/2022 | K010 obrigatório (simplificado/completo), K210/K215 opcionais |
| 2024 | **018** | 179/2023 | 1391 + 3 campos (etanol/usinas) |
| 2025 | **019** | 131/2024 | C700 energia/gás/NF3e, CT-e simplificado |
| 2026 | **020** | 79/2025 | 1310 campo 11 CAP_TANQUE, C100 VL_DOC flexível, C120 COD_DOC_IMP |

### Fontes oficiais consultadas

- NT 2025.001 v1.0 — Leiaute 020 (Ato COTEPE 79/2025)
- NT 2024.001 v1.0 — Leiaute 019 (Ato COTEPE 131/2024)
- NT 2023.001 v1.0 — Leiaute 018 (Ato COTEPE 179/2023)
- NT 2022.001 v1.0 — Leiaute 017 (Ato COTEPE 21/2022)
- NT 2021.001 — Leiaute 016
- NT 2020.001 — Leiaute 015 (Ato COTEPE 44/2020)
- Guias Práticos EFD-ICMS/IPI versões 3.0.4 a 3.2.1 (portal sped.rfb.gov.br)

---

## O que já está implementado

| Item | Arquivo | Status |
|---|---|---|
| Autocorreção `019 → 020` para anos ≥ 2026 (0000) | `server.js` linha 4124 | ✅ Feito |
| Campo 11 `CAP_TANQUE` no 1310 para leiaute 020 | `server.js` linhas 4051–4058 | ✅ Feito |
| Detecção de `layoutVersion` a partir do 0000 | `server.js` linha 4129 | ✅ Feito |

---

## O que precisa ser implementado

---

### FASE 1 — Correção automática de COD_VER por período *(crítico)*

**Arquivo:** `backend/services/spedCostureiraService.js` e `backend/server.js`

**Problema:**
Se o arquivo for de 2022 mas vier com `COD_VER = 015`, o PVA rejeita com "versão de leiaute inválida para o período". O software contábil do cliente pode gerar o arquivo com versão errada.

**Regra:**
```
Ano extraído de DT_INI (campo 4 do 0000, formato DDMMAAAA → posições 4-7):
  2021 → COD_VER = "015"
  2022 → COD_VER = "016"
  2023 → COD_VER = "017"
  2024 → COD_VER = "018"
  2025 → COD_VER = "019"
  2026 → COD_VER = "020"
```

**O que fazer:**

1. Em `spedCostureiraService.js` — dentro da função `costurarEAssinar`, após normalizar as linhas, localizar o registro `0000`, extrair o ano de `DT_INI` e corrigir o campo `COD_VER` automaticamente.

2. Em `server.js` — rota `/api/exportar-sped/:id` — expandir a lógica existente (que hoje só faz `019 → 020` para 2026) para cobrir todos os anos de 2021 a 2026.

**Implementação sugerida (spedCostureiraService.js):**
```js
// Mapa de versão de leiaute por ano
const LEIAUTE_POR_ANO = {
    2021: '015', 2022: '016', 2023: '017',
    2024: '018', 2025: '019', 2026: '020'
};

// Após filtrar linhas em branco, corrigir COD_VER no 0000
for (let i = 0; i < linhasOriginal.length; i++) {
    if (!linhasOriginal[i].startsWith('|0000|')) continue;
    const f = linhasOriginal[i].split('|');
    const dtIni = f[4]; // DDMMAAAA
    if (dtIni && dtIni.length === 8) {
        const ano = parseInt(dtIni.substring(4, 8));
        const versaoCorreta = LEIAUTE_POR_ANO[ano];
        if (versaoCorreta && f[2] !== versaoCorreta) {
            logger.info(`COD_VER corrigido: ${f[2]} → ${versaoCorreta} (período ${ano})`);
            f[2] = versaoCorreta;
            linhasOriginal[i] = f.join('|');
        }
    }
    break;
}
```

---

### FASE 2 — Filtrar registro 0210 a partir de 2022 *(importante)*

**Arquivo:** `backend/services/spedCostureiraService.js`

**Problema:**
O registro `0210` (insumos/componentes de produto) foi **descontinuado no leiaute 016 (2022)**. Se o arquivo original do contábil ainda tiver esse registro para períodos a partir de 2022, o PVA emite erro de estrutura inválida.

**Solução:**
Após detectar o ano do período (já obtido na Fase 1), remover todas as linhas `|0210|` do `linhasOriginal` quando o ano for ≥ 2022.

**Implementação sugerida:**
```js
if (ano >= 2022) {
    const antes = linhasOriginal.length;
    linhasOriginal = linhasOriginal.filter(l => !l.startsWith('|0210|'));
    const removidas = antes - linhasOriginal.length;
    if (removidas > 0) logger.info(`0210 descontinuado: ${removidas} linhas removidas (leiaute 016+)`);
}
```

---

### FASE 3 — K010 obrigatório a partir de 2023 *(médio)*

**Arquivo:** `backend/server.js` — rota `/api/exportar-sped/:id`

**Problema:**
A partir do leiaute 017 (2023), todo arquivo com Bloco K precisa do registro `K010` logo após `K001`. Ele indica se o leiaute é simplificado (`IND_TP_LEIAUTE = 0`) ou completo (`IND_TP_LEIAUTE = 1`). Se o arquivo original não tiver K010 e o leiaute for ≥ 017, o PVA rejeita.

**Solução:**
Na rota de exportação, ao encontrar o registro `K001`, verificar se `K010` aparece como próximo registro. Se não aparecer e o leiaute for ≥ 017, injetar `|K010|0|` (simplificado) imediatamente após `K001`.

**Registros afetados:**
- `K010` — Tipo de leiaute (obrigatório a partir de 2023 quando Bloco K presente)
- `K210` e `K215` — Desmontagem — dispensados no leiaute simplificado

---

### FASE 4 — Registros C181 e C186 para retorno ST *(baixa prioridade)*

**Arquivo:** `backend/services/xmlInjectorService.js`

**Problema:**
Os registros `C181` (informações complementares ST — quantidade) e `C186` (informações complementares ST — valor) existem desde o leiaute 015 (2021). Atualmente o sistema nunca os gera. Para notas com operação de retorno de ST (substituição tributária), a ausência desses registros torna a escrituração incompleta — não causa erro de validação imediato, mas pode gerar autuação em fiscalização.

**Solução:**
Detectar no XML da NF-e se há `ICMS ST` com operação de retorno. Se sim, gerar os registros `C181`/`C186` após o `C180` correspondente.

> **Prioridade:** Baixa — implementar apenas se o cliente tiver operações de retorno ST. Não causa erro de validação de estrutura.

---

### FASE 5 — D100 COD_MUN_ORIG a partir de 2022 *(não aplicável para postos)*

**Impacto:** Zero para empresas que não operam com transporte (CT-e, modelo 57/63/67).

O campo `COD_MUN_ORIG` (campo 24 do D100) passou a ser obrigatório para saídas a partir de 2022. Como o sistema de injeção trabalha com NF-e de mercadoria (Bloco C), não é afetado.

---

## Resumo de Prioridades

| Fase | Impacto | Complexidade | Arquivos | Status |
|---|---|---|---|---|
| **FASE 1** — COD_VER automático por período | 🔴 Alto | Baixa | `spedCostureiraService.js`, `server.js` | ⏳ Aguardando |
| **FASE 2** — Remover 0210 em 2022+ | 🟠 Médio | Baixa | `spedCostureiraService.js` | ⏳ Aguardando |
| **FASE 3** — K010 obrigatório 2023+ | 🟠 Médio | Média | `server.js` | ⏳ Aguardando |
| **FASE 4** — C181/C186 retorno ST | 🟡 Baixo | Alta | `xmlInjectorService.js` | ⏳ Aguardando |
| **FASE 5** — D100 COD_MUN_ORIG | ⚪ N/A postos | — | — | 🚫 Ignorar |

---

## Ordem de Execução Sugerida

1. **FASE 1 + FASE 2 juntas** — resolvem de uma vez a compatibilidade estrutural para 2021–2026 com poucas linhas de código e alto impacto imediato
2. **FASE 3** — antes de processar arquivos de 2023 em diante que tenham Bloco K
3. **FASE 4** — apenas se aparecerem inconsistências em fiscalização de clientes com operações de retorno ST

---

*Plano aguardando aprovação. Nenhuma alteração foi feita no código até o momento.*
