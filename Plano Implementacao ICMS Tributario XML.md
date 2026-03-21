# Plano de Implementação — Dados Tributários ICMS no Injetor XML

**Data de criação:** 2026-03-19
**Status:** Pendente (não implementado — sistema em produção)
**Prioridade:** Alta — sem impacto no funcionamento atual

---

## Contexto

Ao injetar XMLs de NF-e como entradas no SPED, os dados tributários reais do ICMS (base de cálculo, alíquota, valor) não estão sendo corretamente transportados para os registros C170 e C190. Isso afeta principalmente:

- **CST 10** (Tributado + ST → CFOP 5401/5403 → entrada 1401/1403): C170 com BC=0 e ICMS=0
- **CST 60** (ST já paga → CFOP 5405 → entrada 1405): C190 com ST=0,00

---

## Diagnóstico

### O que `extractNfeData` já extrai por item:
| Campo interno | XML origem | Status |
|---|---|---|
| `vbc_icms` | `icmsNode.vBC` | ✅ Extraído |
| `vicms` | `icmsNode.vICMS + vFCP` | ✅ Extraído, **mas nunca usado no C170!** |
| `picms` | `icmsNode.pICMS` | ✅ Extraído |
| `vbc_icms_st` | `icmsNode.vBCST` | ✅ Extraído |
| `vicms_st` | `icmsNode.vICMSST + vFCPST` | ✅ Extraído |
| `vbc_icms_st_ret` | `icmsNode.vBCSTRet` | ❌ **NÃO extraído** |
| `vicms_st_ret` | `icmsNode.vICMSSTRet` | ❌ **NÃO extraído** |
| `picms_st` | `icmsNode.pICMSST` | ❌ **NÃO extraído** |

### Bug no `transformarNotasEmSped`:

```js
// Linha ~375 — bcIcmsCalculado = 0 para qualquer CST diferente de '000' ou '020'
const bcIcmsCalculado = (finalCst === '000' || finalCst === '020') ? (vlItem - descItem + ...) : 0;
```

- **CST 10:** `bcIcmsCalculado = 0` → `vIcmsCalc = 0` → C170/C190 com BC=0 e ICMS=0
- **CST 60:** `vbc_icms_st` e `vicms_st` = 0 porque o XML usa `vBCSTRet`/`vICMSSTRet` (campos não extraídos)
- O campo `vlIcms` (lido na linha 316) é lido mas nunca escrito em lugar algum — ignorado silenciosamente

---

## Fase 1 — `backend/server.js`: Extrair campos faltantes (CST 60)

**Função:** `extractNfeData()` — linha ~764

Adicionar logo após a extração de `vFCPST`:
```js
// Novos: valores para CST 60 (ST retida anteriormente)
const vBCSTRet   = parseValorNFe(icmsNode.vBCSTRet);
const vICMSSTRet = parseValorNFe(icmsNode.vICMSSTRet);
const pICMSST    = parseValorNFe(icmsNode.pICMSST);
```

Incluir no objeto retornado (~linha 804):
```js
vbc_icms_st_ret: vBCSTRet,
vicms_st_ret:    vICMSSTRet,
picms_st:        pICMSST,
```

---

## Fase 2 — `backend/services/xmlInjectorService.js`: Usar valores reais do XML

**Função:** `transformarNotasEmSped()` — linhas 322–377

### 2a. Extrair campos novos vindos do XML
```js
let bcIcmsXml    = parseValor(item.vbc_icms);       // já disponível, mas não usado
let vlIcmsXml    = parseValor(item.vicms);           // já disponível mas ignorado
let bcIcmsStRet  = parseValor(item.vbc_icms_st_ret); // NOVO
let vlIcmsStRet  = parseValor(item.vicms_st_ret);    // NOVO
```

### 2b. Substituir cálculo de `bcIcms`

**Hoje:**
```js
const bcIcmsCalculado = (finalCst === '000' || finalCst === '020') ? (vlItem - descItem + ...) : 0;
const bcIcms = (m && m.bc_icms_override != null) ? m.bc_icms_override : bcIcmsCalculado;
```

**Novo:** Prioridade: override De-Para > XML direto > fórmula
```js
const bcIcmsFormula = (finalCst === '000' || finalCst === '020')
    ? (vlItem - descItem + vFrete + vSeg + vOutro)
    : 0;
const bcIcmsBase = (bcIcmsXml > 0) ? bcIcmsXml : bcIcmsFormula;
const bcIcms = (m && m.bc_icms_override != null) ? m.bc_icms_override : bcIcmsBase;
```

### 2c. Substituir cálculo de `vIcmsCalc`

**Hoje:**
```js
const vIcmsCalc = (bcIcms * aliqIcms) / 100;
```

**Novo:** Usar XML quando disponível e sem override manual de alíquota
```js
const vIcmsCalc = (vlIcmsXml > 0 && !(m && m.aliq_icms != null))
    ? vlIcmsXml
    : (bcIcms * aliqIcms) / 100;
```

### 2d. Tratar CST 60 — BC e Valor ST retida

Logo após as linhas que leem `bcIcmsSt` e `vlIcmsSt` (~linha 325):
```js
// Para CST 60/61: ST paga anteriormente usa campos de "retida", não os de débito
const cstSit = parseInt(String(finalCst).slice(-2));
if ((cstSit === 60 || cstSit === 61) && bcIcmsSt === 0) {
    bcIcmsSt = bcIcmsStRet;
    vlIcmsSt = vlIcmsStRet;
}
```

### 2e. Corrigir `ajusteIcms` para zerar `bcIcms` também

O bloco `if (ajusteIcms)` atual zera `vlIcms` e `aliqIcms` mas não `bcIcms`.
Com a mudança, `bcIcms` virá do XML e pode ser > 0. Adicionar:
```js
if (ajusteIcms) {
    vlIcms    = 0;
    aliqIcms  = 0;
    bcIcmsXml = 0; // NOVO: garante que BC também fica 0
}
```

---

## Fase 3 — `backend/services/spedCostureiraService.js`: Filtrar CST 60 no E210

**Função:** `recalcularE210()`

C190 com CST 60 terá `VL_ICMS_ST` preenchido (informativo), mas não deve gerar crédito no E210.
Adicionar filtro no loop de soma:
```js
// Só soma ST de CST 10/30/70 (crédito efetivo), não CST 60 (informativo — ressarcimento via E220)
const cstC190 = c[3] || '';
if (cstC190.endsWith('60')) continue;
```

---

## Resumo dos Arquivos a Modificar

| Arquivo | Função | Mudança |
|---|---|---|
| `backend/server.js` | `extractNfeData()` | +3 campos: `vbc_icms_st_ret`, `vicms_st_ret`, `picms_st` |
| `backend/services/xmlInjectorService.js` | `transformarNotasEmSped()` | Lógica BC/ICMS do XML, tratamento CST 60 |
| `backend/services/spedCostureiraService.js` | `recalcularE210()` | Filtro CST 60 no crédito ST |

**Frontend:** nenhuma mudança necessária.

---

## Impacto por Fluxo

| Cenário | Antes | Depois |
|---|---|---|
| CST 000, CFOP 1102 com vBC no XML | BC recalculado pela fórmula | BC do XML (mais preciso) |
| CST 000, CFOP 1102 sem vBC (= 0) | BC pela fórmula | BC pela fórmula (fallback, sem mudança) |
| CST 10, CFOP 1401/1403 | **BC=0, ICMS=0** | BC e ICMS reais do XML |
| CST 60, CFOP 1405 | **ST=0,00** | ST retida real do XML |
| De-Para com `aliq_icms_override` | ICMS recalculado | ICMS pelo override (não muda) |
| `forcarUsoConsumo` CFOP 1556 | Zera tudo | Continua zerando tudo (não afeta) |
| `ajusteIcms = true` | Zera ICMS/aliq, BC pode ficar > 0 | Zera BC também (corrigido) |

---

## Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Notas CST 000 com BC diferente do recalculado | BC muda para valor real do XML | Tecnicamente correto; sem ação necessária |
| Notas já injetadas com BC=0 no SPED | Não são reprocessadas automaticamente | Usuário reinjeta se necessário |
| CST 60 alimentando E210 indevidamente | Crédito ST inflado | Filtrar CST 60 em `recalcularE210` (Fase 3) |
| De-Para sem `bc_icms_override` mas com `aliq_icms_override` | BC agora do XML (antes 0 para CST 10) | Comportamento correto — BC real + alíquota override |
