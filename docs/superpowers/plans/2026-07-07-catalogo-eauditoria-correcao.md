# Catálogo E-Auditoria — Validação e Correção Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revisado por time fiscal/SPED em 2026-07-07** (12 falhas incorporadas, F1 crítica). Ver a seção "Revisão do time fiscal/SPED". Este é um **catálogo vivo** — cresce a cada novo arquivo validado (ver seção final "Catálogo Vivo").

**Goal:** Fazer o Validador SPED detectar e (onde determinístico) corrigir o catálogo de ocorrências do **E-Auditoria**, começando pelo conjunto verificado no par casado POSTO CG (arquivo `docs/39778541000180_POSTO_CG_06-2026.txt` × relatório `docs/analise posto campos.pdf`).

**Architecture:** Zero mudança de arquitetura. Cada código E-Auditoria vira um arquivo `backend/services/validador/rules/r_*.js` no contrato existente (`{id, refEAuditoria, bloco, registro, titulo, severidade, classeCorrecao, jaCorrigidoNoExport, detectar(model), instrucaoERP}`), registrado em `rules/index.js`. Correções determinísticas expõem `campoIdx` + `valorSugerido`; são persistidas em `val_correcoes` (via `POST /api/validador/corrigir` ou o novo bulk `corrigir-tudo`) e aplicadas pelo export (`correcoes.aplicar`). Duas extensões pequenas na base: `chaveNatural` passa a suportar **C190** e um helper de dinheiro em centavos com arredondamento **HALF-UP**.

**Tech Stack:** Node.js (CommonJS), sem dependências novas. Testes: `node tests/validador-suite.js` (puro, sem banco) + novo `node tests/eauditoria-repro.js` (lê a fixture real). Golden de export: `node tests/golden-export.js`.

## Global Constraints

- **Aritmética monetária SEMPRE em centavos inteiros com arredondamento HALF-UP.** `round()`/`toFixed` nativos usam banker's rounding e o subtrair floats perde a diferença de 1 centavo (ex.: `131.06 - 131.05 = 0.00999…`). Verificado: o E-Auditoria usa HALF-UP (5,00 × 20,5% = 1,025 → **1,03**). Toda comparação de valor usa `Math.abs(a_cents - b_cents) >= 1`.
- **Índices de campo são 1-based sobre o pipe** (`f[0]===''`, `f[1]===REG`). Iguais ao número de campo do E-Auditoria (ex.: C190 campo 07 = `f[7]` = VL_ICMS).
- **Correção = DADO, não código paralelo.** Com `val_correcoes` vazia o export é byte-idêntico (garantido por `tests/golden-export.js`). Nenhuma regra nova pode alterar o export com a tabela vazia.
- **Fixture de regressão é dado de cliente** e pode não estar versionada. O teste `eauditoria-repro.js` faz *skip* gracioso se `docs/39778541000180_POSTO_CG_06-2026.txt` não existir (nunca quebra CI).
- **Severidade:** `BLOQ` para inconsistência fiscal corrigível; `ADV` para alerta/detecção sem correção automática.
- **`classeCorrecao`:** `'fiscal-deterministico'` (tem `valorSugerido`), `'manual'` (usuário decide), `'estrutural-seguro'`.

---

## Revisão do time fiscal/SPED (2026-07-07)

Um time de 4 especialistas (estrutura EFD, apuração, semântica E-Auditoria, arquitetura) confrontou este plano com o SPED e o PDF do par casado; 16 falhas distintas passaram por verificação adversarial → **12 confirmadas/parciais, todas incorporadas abaixo** (1 rejeitada). As mudanças estão aplicadas inline nas Tasks; este índice é o rastro de auditoria.

| # | Sev | Falha | Onde foi corrigido |
|---|-----|-------|--------------------|
| **F1** | 🔴 crítica | 2890 auto-reescreveria VL_DOC de **742 NFC-e próprias**, inflando o faturamento em **R$12.005,29** e rompendo VL_DOC=ΣVL_OPR (o componente errado é o VL_OUT_DA espúrio, não o VL_DOC) | Task 1.1: gate por `IND_EMIT` — própria zera VL_OUT_DA (campo 20); terceiros recompõem VL_DOC (campo 12); própria atípica → manual |
| **F2** | 🟠 alta | O export relabela/funde C190 (`server.js:9219`) **antes** do `aplicar` (`:9291`) → correções de C190 **descartadas** silenciosamente | Nova **Task 0.5** (gate da Onda 1): aplicar contra C190 original + pós-passe de relabel/fusão |
| **F3** | 🟠 alta | 2481 sobe VL_ICMS sem re-derivar o E110 (recalcularE110 ativa não re-soma C190) → ΣC190≠E110 | Task 1.2: rebaixado a **detecção/manual** (fora do `corrigir-tudo`) |
| **F4** | 🟠 alta | `chaveNatural('C100')=''` em NF de papel/avulsa → casaria **toda** C100 sem chave no export | Task 0.2 Step 3b: guards em `engine.js:61`, `aplicar` e `corrigir-tudo` |
| **F5** | 🟡 média | O export **não remove** os 23 `\|9900\|REG\|` de registro ausente (só recomputa contagens) | Task 2.2: `jaCorrigidoNoExport=false` + passo `removerRegistros9900Ausentes` |
| **F6** | 🟡 média | No caminho **granular** (`/corrigir`), 2075 (C170) e 2951 (C190) são a mesma operação e podem ser aplicados isolados → dessincronia | Aplicar o **par atômico** (C170+C190 da mesma NF) no `/api/validador/corrigir`, ou recusar isolado — ver nota em Task 1.3/1.4 |
| **F7** | 🟡 média | `corrigir-tudo` desativava/sobrescrevia correção **MANUAL** do usuário (AUTO>MANUAL) | Task 1.5: `manualSet` guard + `UPDATE ... AND origem='AUTO'` |
| **F8** | 🟡 média | Só havia golden com `val_correcoes` vazia; faltava teste **pós-correção** | Task 2.7 Step 3b: 2ª camada do arnês (aplicar→re-validar→sem bloqueante novo) |
| **F9** | ⚪ baixa | `spedCostureiraService.js:414` tem `recalcularE110` **morta** (sombreada pela :962) — induz "reativar" e regride a frota | Higiene: remover a função morta (nota em Onda 0/Task 1.2) |
| **F10** | ⚪ baixa | 4028: o gap 89↔60 é **definição de intervalo** (1 occ por gap), não filtro de SIT 04/05 (descontinuados) | Nota da Onda 3 reescrita |
| **F11** | ⚪ baixa | Zerar ALIQ do C190 (2951) pode gerar **C190 duplicado** `CST\|CFOP\|0,00` | Nota da Onda 3: dedup-merge de C190 após `aplicar` |
| **F12** | ⚪ baixa | 275/283 omitiam os campos **ad rem** 28/29/34/35 → PVA acusaria QUANT_BC×ALIQ≠0 com VL=0 | Nota da Onda 3: zerar bloco PIS/COFINS completo |

> **F6 (detalhe):** no POSTO CG as linhas 70 (C170) e 71 (C190) são a MESMA operação de uso/consumo (CFOP 1556, ALIQ 20,50) e disparam 2075+2951 separados; o `corrigir-tudo` já os aplica juntos (após Task 0.2), mas o endpoint granular `POST /api/validador/corrigir` deve gravar o par (mesmo `curChaveC100`, mesma `CST|CFOP|ALIQ`) atomicamente — ou recusar a aplicação isolada com mensagem clara.
> **F9 (detalhe):** a `recalcularE110` viva é a de `spedCostureiraService.js:962` (só re-soma E111); a de `:414` (que somaria C190) é inalcançável por hoisting. Removê-la evita que alguém "reative a :414" como fix do E110 — abordagem que regride 21+ arquivos da frota (comentário :958).

---

## Apêndice A — Catálogo verificado (par casado POSTO CG)

Contagens conferidas byte-a-byte contra `docs/analise posto campos.pdf` (COMERCIO DE DERIVADO DE PETROLEO CAMPOS, CNPJ 39778541000180, 01–30/06/2026, leiaute 020). `f[n]` = campo 1-based no pipe.

| E-Aud | Registro | Regra nova (id) | Lógica de detecção | Correção | Occ esperado | Onda |
|------|----------|-----------------|--------------------|----------|-------------:|:---:|
| 2890 | C100 | `DOC-C100-VLDOC-01` | `f12 ≠ f16−f14−f15+f18+f19+f20+f24+f25` (centavos) | própria: `f20=0` · terceiros: `f12=calc`⁴ | ≥200 (~742)¹ | 1 |
| 2481 | C190 | `DOC-C190-VLICMS-01` | `f7 ≠ round_halfup(f6×f4/100)` | detecção (ADV)⁵ | 12 | 1 |
| 2075 | C170 | `DOC-C170-ICMSSEMBASE-01` | `f14>0 && (f13==0 || f15==0)` | `f14 = 0,00`⁶ | 1 | 1 |
| 2951 | C190 | `DOC-C190-ICMSSEMBASE-01` | `f4>0 && (f6==0 || f7==0)` | `f4 = 0,00`⁶ | 1 | 1 |
| 2800 | C190 | `DOC-C190-REDBC-01` | `f10>0 && CST[-2:]∉{20,70} && C100.f6∈{00,01}` | `f10 = 0,00` | 1 | 2 |
| 2441 | 0400 | `CAD-0400-CFOP-01` | `f2` casa `/^[123567]\d{3}$/` | manual (recodificar) | 3 | 2 |
| 2037 | 9900 | `EST-9900-REGBLC-01` | `f2` (REG_BLC) ausente no arquivo | export² | 23 | 2 |
| 2451 | C170 | `DOC-C170-CODCTA-01` | `f37` (COD_CTA) vazio | manual/config | 10 | 2 |
| 2321 | 0206×1300 | `COMB-0206-1300-01` | 0200 com filho 0206 cujo COD_ITEM não aparece em nenhum 1300 | manual | 2 | 2 |
| 1003 | C100×C190 | `DOC-C100-5929-01` | C190 CFOP∈{5929,6929} com `f4|f5|f6|f7 ≠ 0` | alerta³ | 31 | 2 |

¹ O PDF corta em 200 ocorrências/código; o motor acha 742 (excluindo canceladas). Aceite = `>= 200`.
² **[Revisão F5]** O export só RECOMPUTA contagens do 9900 — NÃO remove linhas `|9900|REG|` de registro ausente. Logo `jaCorrigidoNoExport=false` + passo dedicado no export (`removerRegistros9900Ausentes`). Ver Task 2.2.
³ Decisão fiscal do cliente: **não** auto-zerar 5929/6929 (conflita com `importador5929Service`). Só sinaliza.
⁴ **[Revisão F1 — CRÍTICO]** 2890 é gateado por IND_EMIT: emissão própria (NFC-e) tem VL_DOC = vNF autorizado na SEFAZ e **nunca** é reescrito; quando a divergência é VL_OUT_DA espúrio, zera-se VL_OUT_DA (campo 20). Só terceiros recompõem VL_DOC (campo 12).
⁵ **[Revisão F3]** 2481 vira **detecção (ADV/manual)** — não entra no `corrigir-tudo`: subir VL_ICMS 1 centavo cascatearia para o E110/apuração, que o export não re-deriva (ΣC190≠E110). O usuário aplica manual se quiser; a tolerância sub-centavo é aceitável.
⁶ **[Revisão F6/F11]** 2075/2951 são o MESMO item de uso/consumo — corrigir sempre o PAR (C170+C190) atomicamente; ao zerar a ALIQ do C190, o export precisa re-fundir C190 de mesma CST|CFOP para não gerar duplicata. Ver Task 1.3/1.4 e a nota de export.

**Layouts (índices 1-based):**
- **C100:** 12=VL_DOC, 14=VL_DESC, 15=VL_ABAT_NT, 16=VL_MERC, 18=VL_FRT, 19=VL_SEG, 20=VL_OUT_DA, 24=VL_ICMS_ST, 25=VL_IPI, 6=COD_SIT, 5=COD_MOD, 3=IND_EMIT, 9=CHV_NFE, 8=NUM_DOC.
- **C170:** 9=IND_MOV, 10=CST_ICMS, 11=CFOP, 13=VL_BC_ICMS, 14=ALIQ_ICMS, 15=VL_ICMS, 37=COD_CTA, 2=NUM_ITEM.
- **C190:** 2=CST_ICMS, 3=CFOP, 4=ALIQ_ICMS, 5=VL_OPR, 6=VL_BC_ICMS, 7=VL_ICMS, 10=VL_RED_BC.
- **0400:** 2=COD_NAT. **9900:** 2=REG_BLC. **0206:** 2=COD_ANP (filho do 0200; pai define COD_ITEM). **1300:** 2=COD_ITEM.

---

## Addendum 2026-07-08 — Fluxo "auditoria-primeiro" (decisões de produto)

Confirmado com o usuário: o import **nunca** corrige sozinho. O fluxo é **auditar → escolher → aplicar → revalidar**, e boa parte já existe (`analisar` = auditoria; `corrigir`/`skip`/`correcoes` DELETE = seleção/undo). Decisões:

1. **"Corrigir tudo" = só o subconjunto SEGURO** (determinístico + gateado), **nunca** "todo erro detectado". É exatamente o filtro do `coletarCorrecoesAuto` (Task 1.5): `classeCorrecao==='fiscal-deterministico'` + `corrigivel` + `!jaCorrigidoNoExport` + `valorSugerido`. Os manuais/alertas (2481, 2441, 2451, 1003, 2321…) **ficam de fora** e só aparecem com a instrução ERP. Rótulo do botão: *"Corrigir os N seguros (M exigem revisão)"*.
2. **Auditoria agrupada por CÓDIGO E-Auditoria + CATEGORIA de ação**, não lista plana (só o 2890 tem ~742 occ). Categorias: 🟢 auto-corrigível · 🟡 manual (instrução ERP) · ⚪ só alerta · ✅ já corrigido no export. **Seleção por REGRA**, não por ocorrência.
3. **Preview obrigatório antes do bulk**: um *dry-run* mostra o diff agrupado (`{regra_id, occ, campo, de→para}`) e pede confirmação; só então grava `val_correcoes`. Reversível pelo DELETE já existente.

**Impacto no plano:** backend das Ondas 0–2 **inalterado**. Duas tasks novas:
- **Task 1.6** — endpoint `POST /api/validador/corrigir-tudo/:id?dry_run=1` (ou rota `…/preview`) que retorna `coletarCorrecoesAuto` agrupado por `regra_id`, **sem** escrever no banco (fonte única da verdade do preview = a mesma coleta do apply).
- **Task UI-1** — `ValidadorView.vue`: cards por código+categoria, botão por regra e o master "Corrigir tudo (só seguros)" com modal de preview→confirmação. Depende das regras das Ondas 1–2 existirem (algo a exibir) + Task 1.6.

## Onda 0 — Fundação

### Task 0.1: Helper monetário em centavos (HALF-UP)

**Files:**
- Create: `backend/services/validador/money.js`
- Test: `backend/tests/validador-suite.js` (append)

**Interfaces:**
- Produces: `toCents(v)->int`, `fromCents(c)->'X,XX'`, `aliqBp(v)->int`, `icmsCents(bcCents,aliqBp)->int`

- [ ] **Step 1: Escrever o teste que falha** — em `tests/validador-suite.js`, antes da linha final de sumário, adicionar:

```js
// ---------- money.js (E-Auditoria) ----------
const money = require('../services/validador/money');
t('money.toCents parseia vírgula e milhar', () => {
    assert.strictEqual(money.toCents('639,32'), 63932);
    assert.strictEqual(money.toCents('1.377.049,87'), 137704987);
    assert.strictEqual(money.toCents(''), 0);
});
t('money.icmsCents usa HALF-UP (1,025 -> 1,03)', () => {
    assert.strictEqual(money.icmsCents(500, money.aliqBp('20,50')), 103); // 5,00*20,5% = 1,025 -> 1,03
    assert.strictEqual(money.icmsCents(63932, money.aliqBp('20,50')), 13106); // 131,0606 -> 131,06
});
t('money.fromCents formata', () => {
    assert.strictEqual(money.fromCents(13106), '131,06');
    assert.strictEqual(money.fromCents(103), '1,03');
    assert.strictEqual(money.fromCents(0), '0,00');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL — `Cannot find module '../services/validador/money'`

- [ ] **Step 3: Implementar `money.js`**

```js
// services/validador/money.js — aritmética monetária em CENTAVOS inteiros com HALF-UP
// (padrão fiscal / E-Auditoria). Evita o erro de ponto flutuante do round() nativo, que usa
// banker's rounding e perde a diferença de 1 centavo em subtrações de float.
function toCents(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    const neg = /^-/.test(s);
    const clean = s.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'); // "1.234,56"->"1234.56"
    const f = parseFloat(clean);
    if (!isFinite(f)) return 0;
    const c = Math.round(Math.abs(f) * 100);
    return neg ? -c : c;
}
function fromCents(c) {
    const n = Math.round(Number(c) || 0);
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    return sign + Math.floor(a / 100) + ',' + String(a % 100).padStart(2, '0');
}
// alíquota "20,50" -> basis points inteiros 2050 (2 casas). Evita float no produto BC×alíq.
function aliqBp(v) {
    const s = String(v == null ? '' : v).trim().replace(/\./g, '').replace(',', '.');
    const f = parseFloat(s);
    return isFinite(f) ? Math.round(f * 100) : 0;
}
// VL_ICMS apurado (centavos) = BC(centavos) × alíq / 100, HALF-UP. bcCents×bp/10000.
function icmsCents(bcCents, aliqBpVal) {
    return Math.round((bcCents * aliqBpVal) / 10000);
}
module.exports = { toCents, fromCents, aliqBp, icmsCents };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node tests/validador-suite.js`
Expected: PASS (sumário sem `fail`)

- [ ] **Step 5: Commit**

```bash
git add backend/services/validador/money.js backend/tests/validador-suite.js
git commit -m "feat(validador): helper monetário em centavos HALF-UP (base p/ regras E-Auditoria)"
```

### Task 0.2: `chaveNatural` suporta C190 + blindagem de chave vazia

**Files:**
- Modify: `backend/services/validador/correcoes.js:37-52` (função `chaveNatural`, novo case C190) e `aplicar` (~L83, guard chave vazia)
- Modify: `backend/services/validador/engine.js:61` (`corrigivel` exige chave não-vazia)
- Test: `backend/tests/validador-suite.js` (append)

**Interfaces:**
- Consumes: `chaveNatural(reg, f, curChaveC100)`
- Produces: chave de C190 = `curChaveC100 + '#' + CST + '|' + CFOP + '|' + aliqNorm`

- [ ] **Step 1: Teste que falha** — em `tests/validador-suite.js`:

```js
const { chaveNatural } = require('../services/validador/correcoes');
t('chaveNatural do C190 = chaveC100#CST|CFOP|ALIQ', () => {
    const f = '|C190|000|1102|20,50|1086,84|639,32|131,05|0,00|0,00|0,00|0,00||'.split('|');
    assert.strictEqual(chaveNatural('C190', f, 'CHV44'), 'CHV44#000|1102|20.5');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL — recebido `null` (C190 cai no `default`)

- [ ] **Step 3: Implementar** — em `correcoes.js`, dentro do `switch (reg)` do `chaveNatural`, adicionar antes do `default:`:

```js
        case 'C190': { // analítico: chave da NF + CST|CFOP|ALIQ (única por NF). Aplica correção de VL_ICMS/ALIQ/VL_RED_BC.
            const aliq = String(parseFloat(String(f[4] || '0').replace(',', '.')) || 0);
            return curChaveC100 + '#' + String(f[2] || '').trim() + '|' + String(f[3] || '').trim() + '|' + aliq;
        }
```

- [ ] **Step 3b: Blindar chave natural VAZIA [Revisão F4 — CRÍTICO]** — `chaveNatural('C100')` retorna `''` para NF de papel/avulsa/produtor (mod 01/1B/04 sem chave de 44 díg.). Hoje `engine.js:61` marca `corrigivel=true` (`''!=null`) e no export `idx.get('C100::')` casaria com TODA linha C100 sem chave → correção aplicada na NF errada. Fechar em 3 pontos:

  (a) `engine.js:61` — exigir chave não-vazia:
```js
        e.corrigivel = !!(e.chaveNatural != null && e.chaveNatural !== '' && e.campoIdx != null);
```
  (b) `correcoes.js` no `aplicar` (~L83) — trocar `if (kn == null) continue;` por:
```js
        if (kn == null || kn === '') continue;
```
  (c) o endpoint `corrigir-tudo` (Task 1.5 Step 5, antes do INSERT) já ganha o guard `if (!c.chave_natural) continue;` — espelha o `/api/validador/corrigir` (server.js ~6013 valida `chave`).

  Teste (append em `validador-suite.js`):
```js
t('chave vazia (C100 mod 01 sem chave) não é corrigível', () => {
    const semChv = '|C100|0|1|PART|01|00|1|500||01012022|01012022|100,00||0|100,00|0|0|0|0|0|18,00|0|0|0|0|';
    const r = run(H([semChv]));
    assert.ok(r.erros.every(e => e.registro !== 'C100' || e.corrigivel === false));
});
```

- [ ] **Step 4: Rodar e ver passar** (+ garantir que nada quebrou)

Run: `cd backend && node tests/validador-suite.js && node tests/golden-export.js`
Expected: PASS nos dois (golden byte-idêntico)

- [ ] **Step 5: Commit**

```bash
git add backend/services/validador/correcoes.js backend/tests/validador-suite.js
git commit -m "feat(validador): chaveNatural suporta C190 (habilita correção de VL_ICMS/ALIQ/VL_RED_BC)"
```

### Task 0.3: Propagar `refEAuditoria` no engine

**Files:**
- Modify: `backend/services/validador/engine.js:17-34` (montagem do objeto erro)
- Test: `backend/tests/validador-suite.js` (append)

**Interfaces:**
- Produces: cada `erro` passa a ter `refEAuditoria` (string|null) — o código interno do E-Auditoria equivalente.

- [ ] **Step 1: Teste que falha:**

```js
t('engine propaga refEAuditoria da regra', () => {
    const fakeModel = { linhas: [], porReg: new Map(), blocos: new Set(['C']) };
    const regrasMod = require('../services/validador/rules');
    // regra fake temporária
    regrasMod.push({ id: 'TMP-REF', bloco: 'C', registro: 'C100', titulo: 't', refEAuditoria: '9999',
        detectar: () => [{ linha: 1, campo: 'x', detalhe: 'd' }] });
    const r = validar({ linhas: [], porReg: new Map(), blocos: new Set(['C']) });
    regrasMod.pop();
    const e = r.erros.find(x => x.regra_id === 'TMP-REF');
    assert.ok(e && e.refEAuditoria === '9999');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL — `e.refEAuditoria` é `undefined`

- [ ] **Step 3: Implementar** — em `engine.js`, no objeto `erros.push({...})`, adicionar a linha:

```js
                refEAuditoria: (regra.refEAuditoria || null),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node tests/validador-suite.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/validador/engine.js backend/tests/validador-suite.js
git commit -m "feat(validador): engine propaga refEAuditoria (rastreio código E-Auditoria)"
```

### Task 0.4: Arnês de regressão do par casado

**Files:**
- Create: `backend/tests/eauditoria-repro.js`

**Interfaces:**
- Produces: script CLI que roda o validador na fixture do POSTO CG e confere `contagem por regra_id`. Faz *skip* se a fixture não existir.

- [ ] **Step 1: Criar o arnês** (começa validando só a infraestrutura; as asserções por regra entram nas Tasks seguintes):

```js
// tests/eauditoria-repro.js — REGRESSÃO DE PAR CASADO.
// Roda o Validador no SPED do POSTO CG e confere contagens contra o relatório E-Auditoria
// "analise posto campos.pdf" (39778541000180, 06/2026). Cada número foi verificado byte-a-byte.
// Uso: node tests/eauditoria-repro.js   (skip se a fixture de cliente não estiver presente)
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { parseSped } = require('../services/validador/parser');
const { validar } = require('../services/validador/engine');

const FIX = path.join(__dirname, '..', '..', 'docs', '39778541000180_POSTO_CG_06-2026.txt');
if (!fs.existsSync(FIX)) { console.log('SKIP eauditoria-repro: fixture ausente (' + FIX + ')'); process.exit(0); }

const model = parseSped(fs.readFileSync(FIX, 'latin1'));
const r = validar(model);
const byId = {};
for (const e of r.erros) byId[e.regra_id] = (byId[e.regra_id] || 0) + 1;

// EXPECT: [regra_id, comparador, valor]. 'eq' = igual; 'gte' = >=.
const EXPECT = [
    // preenchido conforme as regras entram (Ondas 1 e 2)
];
let pass = 0, fail = 0;
for (const [id, op, val] of EXPECT) {
    const got = byId[id] || 0;
    const ok = op === 'gte' ? got >= val : got === val;
    if (ok) pass++; else { fail++; console.error(`FAIL ${id}: esperado ${op} ${val}, obtido ${got}`); }
}
console.log(`eauditoria-repro: ${pass} ok, ${fail} falhas (regras disparadas: ${Object.keys(byId).length})`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Rodar** (deve passar vazio ou skipar)

Run: `cd backend && node tests/eauditoria-repro.js`
Expected: `eauditoria-repro: 0 ok, 0 falhas ...` (ou `SKIP` se rodando fora da máquina do cliente)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/eauditoria-repro.js
git commit -m "test(validador): arnês de regressão do par casado E-Auditoria (POSTO CG)"
```

### Task 0.5: Estabilidade da chaveNatural do C190 no export [Revisão F2 — CRÍTICO, gate da Onda 1]

**Problema (verificado):** o export roda `normalizarUsoConsumoCst90` (relabel CST→x90 + **fusão** de C190 por `CST|CFOP|ALIQ`) em `server.js:9219`, **ANTES** de `correcoesSvc.aplicar` em `server.js:9291`. A `chaveNatural` do C190 (Task 0.2) = `curChaveC100#CST|CFOP|ALIQ` foi calculada pelo engine sobre o SPED **ORIGINAL**. Se, no momento do `aplicar`, as linhas C190 já foram relabeladas (61→60, uso/consumo→x90) e/ou fundidas, a chave não casa → as correções de C190 são **silenciosamente descartadas**. Pior: os relabels 61→60 e CFOP-entrada 1655→1652 ocorrem DENTRO de `normalizarLinha` no `pushLine` (já aplicados quando `outputLines` existe) — então **só mover `aplicar` para antes de `:9219` é insuficiente**.

**Files:** Modify `backend/server.js` (ordem do export ~9219/9291), `backend/services/spedCostureiraService.js` (extrair relabels para pós-passe).

- [ ] **Step 1:** Mapear a ordem real — confirmar em `server.js` as posições de `normalizarUsoConsumoCst90` (:9219), os relabels em `normalizarLinha` (61→60, CFOP-entrada) e `correcoesSvc.aplicar` (:9291).
- [ ] **Step 2:** Garantir que `aplicar` rode contra C190 com CST/CFOP/ALIQ **originais** (a chave que o engine gravou). Preferido: montar `outputLines` cru → `correcoesSvc.aplicar(val_correcoes)` → **pós-passe** de relabel/fusão (`normalizarUsoConsumoCst90` + 61→60 + CFOP-entrada extraídos de `normalizarLinha`) → recount X990. Alternativa: reindexar as `val_correcoes` de C190 pela chave pós-relabel antes de aplicar.
- [ ] **Step 3: Teste** — exportar o POSTO CG com uma correção de C190 em `val_correcoes` (ex.: 2800 `VL_RED_BC=0`) e conferir que o `.txt` final **reflete** a correção (não foi descartada) e que não surge C190 duplicado.
- [ ] **Step 4: Commit.**

> **Gate:** enquanto o export não honrar a chave do C190, as correções de C190 (2800; e 2951 quando migrar para auto) **não** devem ser marcadas auto-aplicáveis — mantê-las como detecção. (O 2481 já é manual por F3; o 2890/2075 corrigem C100/C170, fora deste risco.)

---

## Onda 1 — Auto-correção determinística

Cada regra desta onda expõe `campoIdx` + `valorSugerido` e é `corrigivel` pelo engine. A aplicação em massa vem na Task 1.5. **[Revisão]** Exceção: o **2481** (Task 1.2) fica como **detecção/manual** (não entra no `corrigir-tudo`, ver F3) e o **2890** (Task 1.1) é **gateado por IND_EMIT** (própria zera VL_OUT_DA; terceiros recompõem VL_DOC, ver F1). Auto-aplicados de fato pelo `corrigir-tudo`: 2890-próprias (campo 20), 2890-terceiros (campo 12), 2075, 2951, 2800.

### Task 1.1: `DOC-C100-VLDOC-01` (E-Auditoria 2890) — VL_DOC ≠ apurado

**Files:**
- Create: `backend/services/validador/rules/r_c100_vl_doc.js`
- Modify: `backend/services/validador/rules/index.js` (registrar)
- Test: `backend/tests/validador-suite.js` + `backend/tests/eauditoria-repro.js`

**Interfaces:**
- Consumes: `money.toCents/fromCents`
- Produces: erro `{regra_id:'DOC-C100-VLDOC-01', campoIdx:12, valorSugerido}`

- [ ] **Step 1: Teste sintético (pos+neg) em `validador-suite.js`:**

```js
// DOC-C100-VLDOC-01 (2890): VL_DOC = merc-desc-abat+frete+seg+desp+ICMS_ST+IPI.
// GATE por IND_EMIT (f3, revisão fiscal F1): própria (0) NÃO reescreve VL_DOC (é o vNF autorizado
// na SEFAZ); quando a divergência é só VL_OUT_DA espúrio, zera VL_OUT_DA (campo 20). Terceiros (1) recompõe VL_DOC (campo 12).
const C100vd = (vldoc, merc, out, emit = '0') => `|C100|1|${emit}||65|00|001|80138|CHV|03062026|03062026|${vldoc}|2|0,00|0,00|${merc}|9|0,00|0,00|${out}|0,00|0,00|0,00|0,00|0,00|`;
t('2890 dispara quando VL_DOC ignora VL_OUT_DA', () => {
    assert.ok(fires(H([C100vd('2903,78', '2903,78', '156,78')]), 'DOC-C100-VLDOC-01'));
});
t('2890 NÃO dispara quando VL_DOC bate', () => {
    assert.ok(!fires(H([C100vd('3060,56', '2903,78', '156,78')]), 'DOC-C100-VLDOC-01'));
});
t('2890 emissão PRÓPRIA (VL_DOC==VL_MERC, delta==VL_OUT_DA) → zera VL_OUT_DA (campo 20), não toca VL_DOC', () => {
    const e = run(H([C100vd('2903,78', '2903,78', '156,78', '0')])).erros.find(x => x.regra_id === 'DOC-C100-VLDOC-01');
    assert.strictEqual(e.campoIdx, 20);
    assert.strictEqual(e.valorSugerido, '0,00');
    assert.strictEqual(e.classeCorrecao, 'fiscal-deterministico');
});
t('2890 emissão de TERCEIROS → recompõe VL_DOC (campo 12)', () => {
    const e = run(H([C100vd('2903,78', '2903,78', '156,78', '1')])).erros.find(x => x.regra_id === 'DOC-C100-VLDOC-01');
    assert.strictEqual(e.campoIdx, 12);
    assert.strictEqual(e.valorSugerido, '3060,56');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL — regra não existe

- [ ] **Step 3: Implementar `r_c100_vl_doc.js`:**

```js
// DOC-C100-VLDOC-01 (E-Auditoria 2890) — VL_DOC do C100 diverge do total apurado.
// VL_DOC = VL_MERC − VL_DESC − VL_ABAT_NT + VL_FRT + VL_SEG + VL_OUT_DA + VL_ICMS_ST + VL_IPI.
// GATE POR IND_EMIT (revisão fiscal F1 — CRÍTICO): em EMISSÃO PRÓPRIA (f[3]=='0', típico NFC-e mod 65)
// o VL_DOC é o vNF AUTORIZADO na SEFAZ e NÃO é recomputável dos componentes — reescrevê-lo em massa
// inflaria o faturamento declarado e romperia VL_DOC=Σ VL_OPR dos C190 (verificado: 742/742 NFC-e do
// POSTO CG têm VL_DOC==VL_MERC==ΣVL_OPR e a divergência == VL_OUT_DA espúrio, Σ R$12.005,29). Então:
//   • própria + divergência ISOLADA em VL_OUT_DA (VL_DOC==VL_MERC e delta==VL_OUT_DA) → zera VL_OUT_DA (campo 20);
//   • própria com padrão atípico → ADV/manual (só o XML autorizado resolve);
//   • terceiros (f[3]=='1') → recompõe VL_DOC (campo 12), legítimo.
// Ignora cancelados/denegados (COD_SIT 02/03/04/05).
const { toCents, fromCents } = require('../money');
module.exports = {
    id: 'DOC-C100-VLDOC-01',
    refEAuditoria: '2890',
    bloco: 'C',
    registro: 'C100',
    titulo: 'VL_DOC do C100 diverge do total apurado (merc−desc−abat+frete+seg+desp+ICMS-ST+IPI)',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o valor total do documento (VL_DOC) deve ser Σ mercadorias − desconto − abatimento não tributado + frete + seguro + outras despesas + ICMS-ST + IPI. Em NFC-e de emissão própria o VL_DOC é o valor autorizado na SEFAZ; acerte a origem (ex.: outras despesas acessórias espúrias) e regenere.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C100') || [])) {
            const f = l.f;
            if (f.length < 26) continue;
            if (['02', '03', '04', '05'].includes(String(f[6] || '').trim())) continue; // cancelada/denegada
            const vlMerc = toCents(f[16]), vlOut = toCents(f[20]);
            const calc = vlMerc - toCents(f[14]) - toCents(f[15]) + toCents(f[18]) + toCents(f[19]) + vlOut + toCents(f[24]) + toCents(f[25]);
            const decl = toCents(f[12]);
            if (Math.abs(calc - decl) < 1) continue;
            const propria = String(f[3] || '').trim() === '0';
            const base = { linha: l.n, valorAtual: f[12], detalhe: `VL_DOC declarado ${f[12]} ≠ apurado ${fromCents(calc)} (dif ${fromCents(Math.abs(calc - decl))}) na NF ${f[8] || '?'}.` };
            if (!propria) {
                erros.push({ ...base, campo: 'VL_DOC', campoIdx: 12, valorSugerido: fromCents(calc), severidade: 'BLOQ', classeCorrecao: 'fiscal-deterministico' });
            } else if (decl === vlMerc && (calc - decl) === vlOut && vlOut !== 0) {
                erros.push({ ...base, campo: 'VL_OUT_DA', campoIdx: 20, valorSugerido: '0,00', severidade: 'BLOQ', classeCorrecao: 'fiscal-deterministico', detalhe: base.detalhe + ' Emissão própria: VL_DOC=vNF; despesa acessória (VL_OUT_DA) espúria → zerada.' });
            } else {
                erros.push({ ...base, campo: 'VL_DOC', severidade: 'ADV', classeCorrecao: 'manual', detalhe: base.detalhe + ' Emissão própria: VL_DOC é o vNF autorizado na SEFAZ — conferir contra o XML antes de corrigir.' });
            }
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar em `rules/index.js`** — adicionar na seção Fiscais:

```js
    require('./r_c100_vl_doc'),        // DOC-C100-VLDOC-01 (E-Aud 2890): VL_DOC ≠ total apurado
```

- [ ] **Step 5: Asserção de regressão** — em `tests/eauditoria-repro.js`, no array `EXPECT`, adicionar:

```js
    ['DOC-C100-VLDOC-01', 'gte', 200], // E-Auditoria corta em 200; motor acha ~742
```

- [ ] **Step 6: Rodar tudo e ver passar**

Run: `cd backend && node tests/validador-suite.js && node tests/eauditoria-repro.js && node tests/golden-export.js`
Expected: PASS nos três

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_c100_vl_doc.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): DOC-C100-VLDOC-01 (E-Aud 2890) VL_DOC≠apurado + auto-correção"
```

### Task 1.2: `DOC-C190-VLICMS-01` (E-Auditoria 2481) — VL_ICMS ≠ BC×alíq

**Files:**
- Create: `backend/services/validador/rules/r_c190_vl_icms.js`
- Modify: `rules/index.js`
- Test: `validador-suite.js` + `eauditoria-repro.js`

**Interfaces:**
- Consumes: `money.toCents/fromCents/aliqBp/icmsCents`
- Produces: erro `{campoIdx:7, valorSugerido}`

- [ ] **Step 1: Teste sintético:**

```js
// DOC-C190-VLICMS-01 (2481): VL_ICMS = round_halfup(BC × alíq)
const C190v = (bc, aliq, vlicms) => `|C190|000|1102|${aliq}|1086,84|${bc}|${vlicms}|0,00|0,00|0,00|0,00||`;
t('2481 dispara em BC 5,00 x 20,5% (halfup 1,03) declarado 1,02', () => {
    assert.ok(fires(H([C100(CHAVE()), C190v('5,00', '20,50', '1,02')]), 'DOC-C190-VLICMS-01'));
});
t('2481 NÃO dispara quando VL_ICMS = BC×alíq', () => {
    assert.ok(!fires(H([C100(CHAVE()), C190v('639,32', '20,50', '131,06')]), 'DOC-C190-VLICMS-01'));
});
t('2481 sugere half-up', () => {
    const e = run(H([C100(CHAVE()), C190v('5,00', '20,50', '1,02')])).erros.find(x => x.regra_id === 'DOC-C190-VLICMS-01');
    assert.strictEqual(e.valorSugerido, '1,03');
    assert.strictEqual(e.campoIdx, 7);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL

- [ ] **Step 3: Implementar `r_c190_vl_icms.js`:**

```js
// DOC-C190-VLICMS-01 (E-Auditoria 2481) — VL_ICMS do C190 ≠ Base de Cálculo × Alíquota.
// Arredondamento HALF-UP em centavos (o E-Auditoria arredonda 1,025 -> 1,03).
// [Revisão F3] DETECÇÃO (ADV/manual), FORA do corrigir-tudo: subir VL_ICMS em 1 centavo muda a Σ
// débitos/créditos e o export NÃO re-deriva o E110 a partir dos C190 (recalcularE110 ativa em
// spedCostureiraService.js:962 só re-soma E111) → ΣC190≠E110 (o PVA, no máximo, ADVERTE; o E-Auditoria
// nem audita bloco E neste par). Mantém campoIdx/valorSugerido para aplicação MANUAL consciente; a
// tolerância de arredondamento sub-centavo agregado é aceitável. Só migrar p/ auto quando o export
// passar a ressomar C190→E110 (ver Task 1.2 nota + regra diagnóstica r_e110_c190).
const { toCents, fromCents, aliqBp, icmsCents } = require('../money');
module.exports = {
    id: 'DOC-C190-VLICMS-01',
    refEAuditoria: '2481',
    bloco: 'C',
    registro: 'C190',
    titulo: 'VL_ICMS do C190 não corresponde a Base de Cálculo × Alíquota',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o VL_ICMS do registro analítico C190 deve ser Base de Cálculo × Alíquota (arredondado). Recalcule e regenere para que a apuração (E110) volte a bater com a soma dos C190.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C190') || [])) {
            const f = l.f;
            const bp = aliqBp(f[4]);
            const bc = toCents(f[6]);
            if (bp <= 0 || bc <= 0) continue;
            const calc = icmsCents(bc, bp);
            const decl = toCents(f[7]);
            if (Math.abs(calc - decl) >= 1) {
                erros.push({ linha: l.n, campo: 'VL_ICMS', campoIdx: 7, valorAtual: f[7], valorSugerido: fromCents(calc), detalhe: `VL_ICMS ${f[7]} ≠ BC×alíq ${fromCents(calc)} (BC ${f[6]} × ${f[4]}%, dif ${fromCents(Math.abs(calc - decl))}).` });
            }
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar em `index.js`:**

```js
    require('./r_c190_vl_icms'),       // DOC-C190-VLICMS-01 (E-Aud 2481): VL_ICMS ≠ BC×alíq
```

- [ ] **Step 5: Regressão** — em `eauditoria-repro.js` `EXPECT`:

```js
    ['DOC-C190-VLICMS-01', 'eq', 12],
```

- [ ] **Step 6: Rodar tudo**

Run: `cd backend && node tests/validador-suite.js && node tests/eauditoria-repro.js`
Expected: PASS (2481 = 12)

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_c190_vl_icms.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): DOC-C190-VLICMS-01 (E-Aud 2481) VL_ICMS≠BC×alíq half-up + correção"
```

### Task 1.3: `DOC-C170-ICMSSEMBASE-01` (2075) — alíquota sem base no C170

**Files:**
- Create: `backend/services/validador/rules/r_c170_icms_sem_base.js`
- Modify: `rules/index.js`
- Test: `validador-suite.js` + `eauditoria-repro.js`

**Interfaces:**
- Produces: erro `{campoIdx:14, valorSugerido:'0,00'}` (zera ALIQ_ICMS — uso/consumo sem crédito)

- [ ] **Step 1: Teste sintético** (helper `C170` do suite usa aliq no índice correto):

```js
// DOC-C170-ICMSSEMBASE-01 (2075): ALIQ_ICMS>0 mas BC/VL_ICMS=0 (uso/consumo mal escriturado)
const C170ub = `|C170|1|X|BICO|1|PC|100,00|0,00|0|090|1556|1556|0,00|20,50|0,00|0,00|0,00|0,00|0|||0,00|0,00|0,00|04||||||04|||`;
t('2075 dispara: ALIQ 20,50 com BC 0 e ICMS 0', () => {
    assert.ok(fires(H([C100(CHAVE()), C170ub]), 'DOC-C170-ICMSSEMBASE-01'));
});
t('2075 sugere zerar a alíquota (campo 14)', () => {
    const e = run(H([C100(CHAVE()), C170ub])).erros.find(x => x.regra_id === 'DOC-C170-ICMSSEMBASE-01');
    assert.strictEqual(e.campoIdx, 14);
    assert.strictEqual(e.valorSugerido, '0,00');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL

- [ ] **Step 3: Implementar `r_c170_icms_sem_base.js`:**

```js
// DOC-C170-ICMSSEMBASE-01 (E-Auditoria 2075) — C170 com ALIQ_ICMS > 0 mas VL_BC_ICMS ou VL_ICMS = 0.
// Caso típico: item de uso/consumo (CFOP 1556/1407…) que herdou a alíquota mas não tem crédito.
// Correção (decisão do cliente): zerar a ALIQ_ICMS (uso/consumo não credita ICMS).
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C170-ICMSSEMBASE-01',
    refEAuditoria: '2075',
    bloco: 'C',
    registro: 'C170',
    titulo: 'ALIQ_ICMS > 0 no C170 com base/valor de ICMS zerados',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, se o item não credita ICMS (uso/consumo), a alíquota do ICMS no C170 deve ser 0. Se credita, informe base e valor do ICMS.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C170') || [])) {
            const f = l.f;
            if (aliqPos(f[14]) && (toCents(f[13]) === 0 || toCents(f[15]) === 0)) {
                erros.push({ linha: l.n, campo: 'ALIQ_ICMS', campoIdx: 14, valorAtual: f[14], valorSugerido: '0,00', detalhe: `ALIQ_ICMS ${f[14]}% com BC ${f[13]} / VL_ICMS ${f[15]} — item ${f[3] || '?'} (CFOP ${f[11]}).` });
            }
        }
        return erros;
    },
};
function aliqPos(v) { return (parseFloat(String(v || '0').replace(',', '.')) || 0) > 0; }
```

- [ ] **Step 4: Registrar em `index.js`:**

```js
    require('./r_c170_icms_sem_base'), // DOC-C170-ICMSSEMBASE-01 (E-Aud 2075): ALIQ>0 sem base
```

- [ ] **Step 5: Regressão** — `eauditoria-repro.js`:

```js
    ['DOC-C170-ICMSSEMBASE-01', 'eq', 1],
```

- [ ] **Step 6: Rodar tudo**

Run: `cd backend && node tests/validador-suite.js && node tests/eauditoria-repro.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_c170_icms_sem_base.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): DOC-C170-ICMSSEMBASE-01 (E-Aud 2075) alíquota sem base + correção"
```

### Task 1.4: `DOC-C190-ICMSSEMBASE-01` (2951) — alíquota sem base no C190

**Files:**
- Create: `backend/services/validador/rules/r_c190_icms_sem_base.js`
- Modify: `rules/index.js`
- Test: `validador-suite.js` + `eauditoria-repro.js`

**Interfaces:**
- Produces: erro `{campoIdx:4, valorSugerido:'0,00'}` (zera ALIQ_ICMS do C190)

- [ ] **Step 1: Teste sintético:**

```js
// DOC-C190-ICMSSEMBASE-01 (2951): C190 ALIQ>0 com BC/VL_ICMS = 0 (espelho do 2075 no analítico)
const C190ub = `|C190|090|1556|20,50|100,00|0,00|0,00|0,00|0,00|0,00|0,00||`;
t('2951 dispara: C190 ALIQ 20,50 com BC 0', () => {
    assert.ok(fires(H([C100(CHAVE()), C190ub]), 'DOC-C190-ICMSSEMBASE-01'));
});
t('2951 sugere zerar alíquota (campo 4)', () => {
    const e = run(H([C100(CHAVE()), C190ub])).erros.find(x => x.regra_id === 'DOC-C190-ICMSSEMBASE-01');
    assert.strictEqual(e.campoIdx, 4);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL

- [ ] **Step 3: Implementar `r_c190_icms_sem_base.js`:**

```js
// DOC-C190-ICMSSEMBASE-01 (E-Auditoria 2951) — C190 com ALIQ_ICMS > 0 mas VL_BC_ICMS ou VL_ICMS = 0.
// Espelho analítico do 2075. Correção: zerar a ALIQ_ICMS do C190 (uso/consumo não credita).
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C190-ICMSSEMBASE-01',
    refEAuditoria: '2951',
    bloco: 'C',
    registro: 'C190',
    titulo: 'ALIQ_ICMS > 0 no C190 com base/valor de ICMS zerados',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, se a combinação CST/CFOP/alíquota do C190 não credita ICMS, a alíquota deve ser 0. Caso contrário, informe base e valor de ICMS.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C190') || [])) {
            const f = l.f;
            const aliq = parseFloat(String(f[4] || '0').replace(',', '.')) || 0;
            if (aliq > 0 && (toCents(f[6]) === 0 || toCents(f[7]) === 0)) {
                erros.push({ linha: l.n, campo: 'ALIQ_ICMS', campoIdx: 4, valorAtual: f[4], valorSugerido: '0,00', detalhe: `C190 ALIQ ${f[4]}% com BC ${f[6]} / VL_ICMS ${f[7]} (CST ${f[2]}, CFOP ${f[3]}).` });
            }
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar em `index.js`:**

```js
    require('./r_c190_icms_sem_base'), // DOC-C190-ICMSSEMBASE-01 (E-Aud 2951): ALIQ>0 sem base
```

- [ ] **Step 5: Regressão** — `eauditoria-repro.js`:

```js
    ['DOC-C190-ICMSSEMBASE-01', 'eq', 1],
```

- [ ] **Step 6: Rodar tudo**

Run: `cd backend && node tests/validador-suite.js && node tests/eauditoria-repro.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_c190_icms_sem_base.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): DOC-C190-ICMSSEMBASE-01 (E-Aud 2951) alíquota sem base + correção"
```

### Task 1.5: Aplicar correções sugeridas em massa

**Files:**
- Create: `backend/services/validador/autofix.js`
- Modify: `backend/server.js` (novo endpoint `POST /api/validador/corrigir-tudo/:id`, ao lado de `/corrigir` ~6008)
- Test: `backend/tests/validador-suite.js` (append — teste puro do autofix via `aplicar`)

**Interfaces:**
- Consumes: `validar(model).erros`, `correcoes.aplicar`
- Produces: `coletarCorrecoesAuto(resultado) -> [{registro, chave_natural, campo_idx, valor_original, valor_corrigido, regra_id}]`

- [ ] **Step 1: Teste puro** — o autofix coleta só o que é determinístico e `corrigivel`, e a correção, aplicada por `aplicar`, muda o arquivo:

```js
// autofix: coleta correções determinísticas e aplica via correcoes.aplicar
const { coletarCorrecoesAuto } = require('../services/validador/autofix');
t('autofix coleta 2890 e aplicar corrige o VL_DOC', () => {
    const txt = H([`|C100|1|0||65|00|001|80138|${CHAVE()}|03062026|03062026|2903,78|2|0,00|0,00|2903,78|9|0,00|0,00|156,78|0,00|0,00|0,00|0,00|0,00|`]);
    const model = parseSped(txt);
    const resultado = validar(model);
    const corrs = coletarCorrecoesAuto(resultado).map(c => ({ registro: c.registro, chave_natural: c.chave_natural, campo_idx: c.campo_idx, valor_corrigido: c.valor_corrigido }));
    // Emissão própria (NFC-e): a correção do 2890 zera VL_OUT_DA (campo 20), NÃO reescreve VL_DOC (campo 12).
    assert.ok(corrs.some(c => c.registro === 'C100' && c.campo_idx === 20 && c.valor_corrigido === '0,00'));
    const linhas = txt.split('\n');
    aplicar(linhas, corrs);
    const c100 = linhas.find(l => l.startsWith('|C100|'));
    assert.strictEqual(c100.split('|')[20], '0,00');
    assert.strictEqual(c100.split('|')[12], '2903,78'); // VL_DOC preservado (é o vNF autorizado)
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node tests/validador-suite.js`
Expected: FAIL — `autofix` não existe

- [ ] **Step 3: Implementar `autofix.js`:**

```js
// services/validador/autofix.js — coleta as correções DETERMINÍSTICAS sugeridas pelas regras
// (classeCorrecao 'fiscal-deterministico', com valorSugerido e corrigivel) no formato de val_correcoes.
// Puro: não toca banco nem HTTP. A persistência/aplicação fica no endpoint e no export.
function coletarCorrecoesAuto(resultado) {
    const out = [];
    for (const e of (resultado.erros || [])) {
        if (e.classeCorrecao !== 'fiscal-deterministico') continue;
        if (e.jaCorrigidoNoExport) continue;         // export já resolve
        if (!e.corrigivel) continue;                 // sem chaveNatural/campoIdx
        if (e.valorSugerido == null || e.valorSugerido === '') continue;
        out.push({
            registro: e.registro,
            chave_natural: e.chaveNatural,
            campo_idx: e.campoIdx,
            valor_original: (e.valorAtual != null ? String(e.valorAtual) : null),
            valor_corrigido: String(e.valorSugerido),
            regra_id: e.regra_id,
        });
    }
    return out;
}
module.exports = { coletarCorrecoesAuto };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node tests/validador-suite.js`
Expected: PASS

- [ ] **Step 5: Endpoint bulk em `server.js`** — logo após o handler `POST /api/validador/corrigir` (fecha ~6041), adicionar:

```js
// Aplica TODAS as correções determinísticas sugeridas (Onda 1 E-Auditoria) de uma vez.
app.post('/api/validador/corrigir-tudo/:id', authMiddleware, async (req, res) => {
    const idArq = parseInt(req.params.id);
    if (isNaN(idArq)) return res.status(400).json({ message: 'ID inválido.' });
    const dbClient = await safeConnect(res);
    if (!dbClient) return;
    try {
        const r = await dbClient.query('SELECT caminho_arquivo FROM sped_arquivos WHERE id = $1', [idArq]);
        if (!r.rows.length) return res.status(404).json({ message: 'Arquivo não encontrado.' });
        let cam = r.rows[0].caminho_arquivo;
        try { const j = JSON.parse(cam); if (j && typeof j === 'object') cam = Object.values(j)[0]; } catch (_) {}
        if (!cam || !fs.existsSync(cam)) return res.status(400).json({ message: 'Arquivo físico não localizado.' });
        const model = require('./services/validador/parser').parseSped(fs.readFileSync(cam, 'latin1'));
        model.dominio = await require('./services/validador/dominio').carregarDominio(dbClient);
        const resultado = require('./services/validador/engine').validar(model);
        const corrs = require('./services/validador/autofix').coletarCorrecoesAuto(resultado);
        const correcoesSvc = require('./services/validador/correcoes');
        await correcoesSvc.ensureTabela(dbClient);
        // [Revisão F7] respeitar correções MANUAIS ativas do usuário (precedência MANUAL > AUTO).
        const manuais = await dbClient.query(`SELECT registro, chave_natural, campo_idx FROM val_correcoes WHERE id_sped_arquivo=$1 AND origem='MANUAL' AND ativo=TRUE`, [idArq]);
        const manualSet = new Set(manuais.rows.map(m => `${m.registro}|${m.chave_natural}|${m.campo_idx}`));
        await dbClient.query('BEGIN');
        let n = 0, puladas = 0;
        for (const c of corrs) {
            if (!c.chave_natural) { puladas++; continue; }                                                    // [F4] nunca casar chave vazia
            if (manualSet.has(`${c.registro}|${c.chave_natural}|${c.campo_idx}`)) { puladas++; continue; }      // [F7] não sobrescreve MANUAL
            await dbClient.query(`UPDATE val_correcoes SET ativo=FALSE WHERE id_sped_arquivo=$1 AND registro=$2 AND chave_natural=$3 AND campo_idx=$4 AND origem='AUTO' AND ativo=TRUE`, [idArq, c.registro, c.chave_natural, c.campo_idx]);
            await dbClient.query(`INSERT INTO val_correcoes (id_sped_arquivo, regra_id, registro, chave_natural, campo_idx, valor_original, valor_corrigido, origem, usuario_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'AUTO',$8)`, [idArq, c.regra_id, c.registro, c.chave_natural, c.campo_idx, c.valor_original, c.valor_corrigido, req.user?.id || null]);
            n++;
        }
        await dbClient.query('COMMIT');
        res.json({ ok: true, aplicadas: n, puladas });
    } catch (e) {
        await safeRollback(dbClient);
        logger.error('Erro no corrigir-tudo:', e);
        res.status(500).json({ message: 'Erro ao aplicar correções: ' + e.message });
    } finally {
        dbClient.release();
    }
});
```

- [ ] **Step 6: Fumaça do endpoint** — subir o servidor e aplicar no arquivo do POSTO CG (id no banco), depois exportar e re-validar:

Run: `cd backend && node -e "require('./services/validador/autofix'); console.log('autofix ok')"`
Expected: `autofix ok` (sanidade do require). Teste HTTP real: `POST /api/validador/corrigir-tudo/<id>` → `{ok:true, aplicadas:N, puladas:P}` com **N≈745** (742 do 2890 em VL_OUT_DA/campo 20 + 2075 + 2951 + 2800). O **2481 NÃO entra** (é manual por F3) e nenhum VL_DOC de emissão própria é reescrito (F1). As de C190 (2951/2800) só surtem efeito no `.txt` após a Task 0.5 (F2).

- [ ] **Step 7: Golden sem regressão** (val_correcoes vazia → export byte-idêntico):

Run: `cd backend && node tests/golden-export.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/services/validador/autofix.js backend/server.js backend/tests/validador-suite.js
git commit -m "feat(validador): autofix + endpoint corrigir-tudo (aplica correções determinísticas E-Auditoria)"
```

---

## Onda 2 — Detecção (com correção assistida onde seguro)

### Task 2.1: `CAD-0400-CFOP-01` (2441) — COD_NAT preenchido com CFOP

**Files:** Create `rules/r_0400_codnat_cfop.js`; Modify `rules/index.js`; Test suite + repro.

- [ ] **Step 1: Teste sintético:**

```js
// CAD-0400-CFOP-01 (2441): COD_NAT do 0400 não pode ser um CFOP
t('2441 dispara p/ COD_NAT 1652', () => {
    assert.ok(fires(H(['|0400|1652|COMPRA DE COMBUSTIVEL|']), 'CAD-0400-CFOP-01'));
});
t('2441 NÃO dispara p/ código próprio 001', () => {
    assert.ok(!fires(H(['|0400|001|VENDA BALCAO|']), 'CAD-0400-CFOP-01'));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd backend && node tests/validador-suite.js` → FAIL

- [ ] **Step 3: Implementar `r_0400_codnat_cfop.js`:**

```js
// CAD-0400-CFOP-01 (E-Auditoria 2441) — COD_NAT do 0400 preenchido com um código CFOP.
// O 0400 é tabela de naturezas PRÓPRIAS do contribuinte; CFOP tem 4 dígitos começando por 1/2/3/5/6/7.
module.exports = {
    id: 'CAD-0400-CFOP-01',
    refEAuditoria: '2441',
    bloco: '0',
    registro: '0400',
    titulo: 'COD_NAT do 0400 preenchido com um código CFOP',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o COD_NAT do registro 0400 é uma codificação própria da natureza da operação — não um CFOP. Recadastre com um código/descritivo interno.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('0400') || [])) {
            const c = String(l.f[2] || '').trim();
            if (/^[123567]\d{3}$/.test(c)) {
                erros.push({ linha: l.n, campo: 'COD_NAT', valorAtual: c, detalhe: `COD_NAT "${c}" parece um CFOP (${l.f[3] || ''}).` });
            }
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar** em `index.js`: `require('./r_0400_codnat_cfop'), // CAD-0400-CFOP-01 (E-Aud 2441)`

- [ ] **Step 5: Regressão** — `eauditoria-repro.js`: `['CAD-0400-CFOP-01', 'eq', 3],`

- [ ] **Step 6: Rodar tudo** — `cd backend && node tests/validador-suite.js && node tests/eauditoria-repro.js` → PASS

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_0400_codnat_cfop.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): CAD-0400-CFOP-01 (E-Aud 2441) COD_NAT com CFOP"
```

### Task 2.2: `EST-9900-REGBLC-01` (2037) — REG_BLC do 9900 ausente

**Files:** Create `rules/r_9900_regblc.js`; Modify `rules/index.js`; Test suite + repro.

- [ ] **Step 1: [Revisão F5 — RESOLVIDO] O export NÃO remove os 9900 ausentes** — verificado: `garantirRegistros9900` (spedCostureiraService.js:1083-1112) só ADICIONA 9900 faltantes (`filter(!tem9900.has(r))`); não há filtro inverso, e o recount (server.js ~9446) só ajusta contagens. As 23 linhas `|9900|REG|0|` de registro ausente sobrevivem ao export. Portanto `jaCorrigidoNoExport=false` e é preciso um passo dedicado (Step 4b). Confirmar (opcional) exportando o POSTO CG e conferindo que ainda há `|9900|D100|` no `.txt`.

- [ ] **Step 2: Teste sintético:**

```js
// EST-9900-REGBLC-01 (2037): 9900 lista REG_BLC que não existe no arquivo
t('2037 dispara p/ 9900 de registro ausente (D100)', () => {
    assert.ok(fires(H(['|9900|D100|5|', '|9900|C100|1|']), 'EST-9900-REGBLC-01'));
});
t('2037 NÃO dispara p/ 9900 de registro presente', () => {
    assert.ok(!fires(H([C100(CHAVE()), '|9900|C100|1|']), 'EST-9900-REGBLC-01'));
});
```

- [ ] **Step 3: Rodar e ver falhar** — FAIL

- [ ] **Step 4: Implementar `r_9900_regblc.js`** (ajustar `jaCorrigidoNoExport` conforme Step 1):

```js
// EST-9900-REGBLC-01 (E-Auditoria 2037) — REG_BLC do 9900 aponta um registro que não existe no arquivo.
// O 9900 totaliza ocorrências de cada registro; não deve listar registro ausente.
// [Revisão F5] jaCorrigidoNoExport=false: o export só recomputa contagens (garantirRegistros9900 só
// ADICIONA faltantes) — a remoção das linhas 9900 ausentes é feita por um passo dedicado no export (Step 4b).
module.exports = {
    id: 'EST-9900-REGBLC-01',
    refEAuditoria: '2037',
    bloco: '9',
    registro: '9900',
    titulo: 'REG_BLC do 9900 não existe no arquivo',
    severidade: 'ADV',
    classeCorrecao: 'estrutural-seguro',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, o registro 9900 deve totalizar apenas registros presentes no arquivo. Regenere o bloco 9.',
    detectar(model) {
        const erros = [];
        const presentes = new Set([...model.porReg.keys()]);
        for (const l of (model.porReg.get('9900') || [])) {
            const reg = String(l.f[2] || '').trim();
            if (reg && reg !== '9900' && reg !== '9999' && !presentes.has(reg)) {
                erros.push({ linha: l.n, campo: 'REG_BLC', valorAtual: reg, detalhe: `9900 totaliza o registro "${reg}", que não existe no arquivo.` });
            }
        }
        return erros;
    },
};
```

- [ ] **Step 4b: Passo de export que remove os 9900 ausentes [Revisão F5]** — como a regra é `estrutural-seguro` sem `campoIdx` (o `aplicar()` só faz override de campo e nem cobre 9900), a limpeza é um passo do costureiro. Em `spedCostureiraService.js` adicionar `removerRegistros9900Ausentes(linhas)` e chamá-lo ANTES de `garantirRegistros9900`/recount (server.js ~9418):

```js
// Remove linhas |9900|REG|qtd| cujo REG não existe no arquivo (E-Auditoria 2037). Idempotente.
function removerRegistros9900Ausentes(linhas) {
    const presentes = new Set(linhas.map(l => l.split('|')[1]).filter(Boolean));
    let removidas = 0;
    const out = linhas.filter(l => {
        const f = l.split('|');
        if (f[1] !== '9900') return true;
        const reg = String(f[2] || '').trim();
        if (reg && reg !== '9900' && reg !== '9999' && !presentes.has(reg)) { removidas++; return false; }
        return true;
    });
    return { linhas: out, removidas };
}
```
Depois disso o recount do bloco 9 (9990/9999) já roda sobre as linhas finais — sem defasagem. Teste: exportar o POSTO CG e conferir 0 linhas `|9900|<reg>|` de registro ausente + 9990/9999 coerentes.

- [ ] **Step 5: Registrar** em `index.js`: `require('./r_9900_regblc'), // EST-9900-REGBLC-01 (E-Aud 2037)`

- [ ] **Step 6: Regressão** — `eauditoria-repro.js`: `['EST-9900-REGBLC-01', 'eq', 23],`

- [ ] **Step 7: Rodar tudo** → PASS (2037 = 23)

- [ ] **Step 8: Commit**

```bash
git add backend/services/validador/rules/r_9900_regblc.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): EST-9900-REGBLC-01 (E-Aud 2037) REG_BLC ausente no 9900"
```

### Task 2.3: `DOC-C170-CODCTA-01` (2451) — COD_CTA vazio no C170

**Files:** Create `rules/r_c170_cod_cta.js`; Modify `rules/index.js`; Test suite + repro.

- [ ] **Step 1: Teste sintético:**

```js
// DOC-C170-CODCTA-01 (2451): COD_CTA (campo 37) do C170 vazio
const C170semCta = `|C170|1|4|GASOLINA|1|L|100,00|0,00|0|061|1652|1652|0,00|0,00|0,00|0,00|0,00|0,00|0|||0,00|0,00|0,00|04||||||04||||`;
t('2451 dispara quando COD_CTA vazio', () => {
    assert.ok(fires(H([C100(CHAVE()), C170semCta]), 'DOC-C170-CODCTA-01'));
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL

- [ ] **Step 3: Implementar `r_c170_cod_cta.js`:**

```js
// DOC-C170-CODCTA-01 (E-Auditoria 2451) — COD_CTA (código da conta analítica) vazio no C170.
// Campo "OC" (obrigatório se houver informação). Correção manual: depende do plano de contas do cliente.
module.exports = {
    id: 'DOC-C170-CODCTA-01',
    refEAuditoria: '2451',
    bloco: 'C',
    registro: 'C170',
    titulo: 'COD_CTA (conta analítica) não informado no C170',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, informe a conta contábil (COD_CTA) do item no C170 conforme o plano de contas (0500).',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C170') || [])) {
            if (String(l.f[37] || '').trim() === '') {
                erros.push({ linha: l.n, campo: 'COD_CTA', campoIdx: 37, valorAtual: '(vazio)', detalhe: `Item ${l.f[2] || '?'} (${l.f[3] || '?'}) sem conta analítica (COD_CTA).` });
            }
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar** em `index.js`: `require('./r_c170_cod_cta'), // DOC-C170-CODCTA-01 (E-Aud 2451)`

- [ ] **Step 5: Regressão** — `eauditoria-repro.js`: `['DOC-C170-CODCTA-01', 'eq', 10],`

- [ ] **Step 6: Rodar tudo** → PASS (2451 = 10)

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_c170_cod_cta.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): DOC-C170-CODCTA-01 (E-Aud 2451) COD_CTA vazio"
```

### Task 2.4: `DOC-C190-REDBC-01` (2800) — VL_RED_BC incompatível com CST

**Files:** Create `rules/r_c190_red_bc.js`; Modify `rules/index.js`; Test suite + repro.

**Interfaces:** Produces erro `{campoIdx:10, valorSugerido:'0,00'}` (zera VL_RED_BC quando o CST não é de redução).

- [ ] **Step 1: Teste sintético** (precisa do C100 pai com COD_SIT 00):

```js
// DOC-C190-REDBC-01 (2800): VL_RED_BC>0 exige CST x20/x70; senão inconsistente
const C190red = `|C190|090|1556|20,50|100,00|0,00|0,00|0,00|0,00|1146,82|0,00||`;
t('2800 dispara: VL_RED_BC com CST 090', () => {
    assert.ok(fires(H([C100(CHAVE(), { sit: '00' }), C190red]), 'DOC-C190-REDBC-01'));
});
t('2800 NÃO dispara com CST x20', () => {
    const c190ok = `|C190|020|1556|20,50|100,00|50,00|10,25|0,00|0,00|50,00|0,00||`;
    assert.ok(!fires(H([C100(CHAVE(), { sit: '00' }), c190ok]), 'DOC-C190-REDBC-01'));
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL

- [ ] **Step 3: Implementar `r_c190_red_bc.js`:**

```js
// DOC-C190-REDBC-01 (E-Auditoria 2800) — VL_RED_BC do C190 preenchido com CST que não é de redução.
// Regra: se VL_RED_BC > 0 e COD_SIT do C100 pai ∈ {00,01}, o 2º-3º dígitos do CST devem ser 20 ou 70.
// Correção (uso/consumo): zerar VL_RED_BC (alternativa fiscal = reclassificar o CST).
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C190-REDBC-01',
    refEAuditoria: '2800',
    bloco: 'C',
    registro: 'C190',
    titulo: 'VL_RED_BC no C190 incompatível com o CST (deve ser x20/x70)',
    severidade: 'BLOQ',
    classeCorrecao: 'fiscal-deterministico',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP, VL_RED_BC só se aplica a CST de redução de base (2º-3º dígitos 20 ou 70). Para uso/consumo (x90) zere a redução, ou reclassifique o CST.',
    detectar(model) {
        const erros = [];
        let sit = '';
        for (const l of model.linhas) {
            if (l.reg === 'C100') sit = String(l.f[6] || '').trim();
            else if (l.reg === 'C190') {
                const f = l.f;
                const cst = String(f[2] || '').trim();
                if (toCents(f[10]) > 0 && !['20', '70'].includes(cst.slice(-2)) && ['00', '01'].includes(sit)) {
                    erros.push({ linha: l.n, campo: 'VL_RED_BC', campoIdx: 10, valorAtual: f[10], valorSugerido: '0,00', detalhe: `VL_RED_BC ${f[10]} exige CST x20/x70; CST atual ${cst} (CFOP ${f[3]}).` });
                }
            } else if (l.reg[0] !== 'C') sit = '';
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar** em `index.js`: `require('./r_c190_red_bc'), // DOC-C190-REDBC-01 (E-Aud 2800)`

- [ ] **Step 5: Regressão** — `eauditoria-repro.js`: `['DOC-C190-REDBC-01', 'eq', 1],`

- [ ] **Step 6: Rodar tudo** → PASS (2800 = 1)

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_c190_red_bc.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): DOC-C190-REDBC-01 (E-Aud 2800) VL_RED_BC×CST + correção"
```

### Task 2.5: `COMB-0206-1300-01` (2321) — produto com 0206 sem movimento no 1300

**Files:** Create `rules/r_0206_sem_1300.js`; Modify `rules/index.js`; Test suite + repro.

**Nota de semântica (verificada):** o texto do E-Auditoria diz "não foram detectados 1300", mas as ocorrências são **por produto**: um 0200 que tem filho 0206 (código ANP) cujo COD_ITEM não aparece em nenhum 1300. No POSTO CG são os itens 14 e 46 (lubrificantes) → 2 ocorrências.

- [ ] **Step 1: Teste sintético:**

```js
// COMB-0206-1300-01 (2321): 0200 com 0206 cujo COD_ITEM não está em nenhum 1300
t('2321 dispara p/ produto com 0206 sem 1300', () => {
    const txt = H(['|0200|46|LUBRAX|||||27||||', '|0206|620501001|', r1300('1', '01062026', '0', '0', '0', '0', '0', '0', '0', '0')]);
    assert.ok(fires(txt, 'COMB-0206-1300-01'));
});
t('2321 NÃO dispara quando o produto tem 1300', () => {
    const txt = H(['|0200|1|GASOLINA|||||27||||', '|0206|320101001|', r1300('1', '01062026', '0', '0', '0', '0', '0', '0', '0', '0')]);
    assert.ok(!fires(txt, 'COMB-0206-1300-01'));
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL

- [ ] **Step 3: Implementar `r_0206_sem_1300.js`:**

```js
// COMB-0206-1300-01 (E-Auditoria 2321) — produto com registro 0206 (código ANP) que não possui
// movimentação no LMC (nenhum 1300 com o mesmo COD_ITEM). Típico de lubrificantes: têm 0206 mas
// não são combustíveis controlados pelo LMC. Alerta (o fisco pode dispensar — ver dica do E-Auditoria).
module.exports = {
    id: 'COMB-0206-1300-01',
    refEAuditoria: '2321',
    bloco: '0',
    registro: '0206',
    titulo: 'Produto com 0206 (ANP) sem movimentação no 1300 (LMC)',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'No ERP: se o produto com código ANP (0206) for combustível de revenda, gere o 1300/1310/1370 (LMC). Se for lubrificante/óleo não sujeito ao LMC, o alerta pode ser desconsiderado.',
    detectar(model) {
        const itens1300 = new Set((model.porReg.get('1300') || []).map(l => String(l.f[2] || '').trim()));
        const erros = [];
        let codItem = null;   // COD_ITEM do 0200 pai corrente
        const jaAvisado = new Set();
        for (const l of model.linhas) {
            if (l.reg === '0200') codItem = String(l.f[2] || '').trim();
            else if (l.reg === '0206' && codItem != null) {
                if (!itens1300.has(codItem) && !jaAvisado.has(codItem)) {
                    jaAvisado.add(codItem);
                    erros.push({ linha: l.n, campo: 'COD_ANP', valorAtual: String(l.f[2] || '').trim(), detalhe: `Produto ${codItem} tem 0206 (ANP ${l.f[2] || '?'}) mas nenhum 1300 (movimentação LMC).` });
                }
            } else if (l.reg[0] !== '0') codItem = null; // saiu do bloco 0
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar** em `index.js`: `require('./r_0206_sem_1300'), // COMB-0206-1300-01 (E-Aud 2321)`

- [ ] **Step 5: Regressão** — `eauditoria-repro.js`: `['COMB-0206-1300-01', 'eq', 2],`

- [ ] **Step 6: Rodar tudo** → PASS (2321 = 2)

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_0206_sem_1300.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): COMB-0206-1300-01 (E-Aud 2321) produto ANP sem LMC"
```

### Task 2.6: `DOC-C100-5929-01` (1003) — 5929/6929 com valores (detecção apenas)

**Files:** Create `rules/r_c100_5929.js`; Modify `rules/index.js`; Test suite + repro.

**Decisão do cliente:** **não** auto-zerar (conflita com `importador5929Service`, que preenche valores em 5929 zeradas). Só sinaliza. Sem `campoIdx`.

- [ ] **Step 1: Teste sintético:**

```js
// DOC-C100-5929-01 (1003): CFOP 5929/6929 no C190 com valores não zerados
t('1003 dispara p/ 5929 com ICMS', () => {
    const c190 = `|C190|061|5929|20,50|9574,80|160,00|32,80|0,00|0,00|0,00|0,00||`;
    assert.ok(fires(H([C100(CHAVE()), c190]), 'DOC-C100-5929-01'));
});
t('1003 NÃO dispara p/ 5929 zerado', () => {
    const c190 = `|C190|061|5929|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00||`;
    assert.ok(!fires(H([C100(CHAVE()), c190]), 'DOC-C100-5929-01'));
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL

- [ ] **Step 3: Implementar `r_c100_5929.js`:**

```js
// DOC-C100-5929-01 (E-Auditoria 1003) — CFOP 5929/6929 (nota espelho de operação já tributada em
// ECF/cupom) NÃO deve ter valor da operação, alíquota, base ou ICMS no C190. DETECÇÃO APENAS:
// a correção (zerar) conflita com o importador5929Service (que preenche 5929 zeradas) → decisão do cliente.
const { toCents } = require('../money');
module.exports = {
    id: 'DOC-C100-5929-01',
    refEAuditoria: '1003',
    bloco: 'C',
    registro: 'C190',
    titulo: 'CFOP 5929/6929 com valor/alíquota/base/ICMS diferentes de zero',
    severidade: 'ADV',
    classeCorrecao: 'manual',
    jaCorrigidoNoExport: false,
    instrucaoERP: 'CFOP 5929/6929 acoberta operação já tributada (ECF/cupom): valor da operação, alíquota, base e ICMS devem ser 0 (exceto MG/RN/SC). Atenção: pode conflitar com a injeção de valores 5929.',
    detectar(model) {
        const erros = [];
        for (const l of (model.porReg.get('C190') || [])) {
            const f = l.f;
            const cfop = String(f[3] || '').trim();
            if (cfop === '5929' || cfop === '6929') {
                const aliq = parseFloat(String(f[4] || '0').replace(',', '.')) || 0;
                if (aliq !== 0 || toCents(f[5]) !== 0 || toCents(f[6]) !== 0 || toCents(f[7]) !== 0) {
                    erros.push({ linha: l.n, campo: 'CFOP 5929/6929', valorAtual: `${cfop} ICMS ${f[7]}`, detalhe: `CFOP ${cfop} com alíq ${f[4]} / BC ${f[6]} / ICMS ${f[7]} — deveriam ser 0.` });
                }
            }
        }
        return erros;
    },
};
```

- [ ] **Step 4: Registrar** em `index.js`: `require('./r_c100_5929'), // DOC-C100-5929-01 (E-Aud 1003) detecção`

- [ ] **Step 5: Regressão** — `eauditoria-repro.js`: `['DOC-C100-5929-01', 'eq', 31],`

- [ ] **Step 6: Rodar tudo** → PASS (1003 = 31)

- [ ] **Step 7: Commit**

```bash
git add backend/services/validador/rules/r_c100_5929.js backend/services/validador/rules/index.js backend/tests/validador-suite.js backend/tests/eauditoria-repro.js
git commit -m "feat(validador): DOC-C100-5929-01 (E-Aud 1003) 5929/6929 com valores (detecção)"
```

### Task 2.7: Fechamento da Onda 2 — validar o par casado completo

- [ ] **Step 1: Rodar a regressão completa** e conferir os 10 códigos verificados:

Run: `cd backend && node tests/eauditoria-repro.js`
Expected: `eauditoria-repro: 10 ok, 0 falhas` (DOC-C100-VLDOC-01≥200, DOC-C190-VLICMS-01=12, DOC-C170-ICMSSEMBASE-01=1, DOC-C190-ICMSSEMBASE-01=1, DOC-C190-REDBC-01=1, CAD-0400-CFOP-01=3, EST-9900-REGBLC-01=23, DOC-C170-CODCTA-01=10, COMB-0206-1300-01=2, DOC-C100-5929-01=31)

- [ ] **Step 2: Suíte + golden**

Run: `cd backend && node tests/validador-suite.js && node tests/golden-export.js`
Expected: PASS nos dois

- [ ] **Step 3: Fumaça ponta-a-ponta** — via `POST /api/validador/analisar/:id` no arquivo POSTO CG (id no banco) → conferir que os 10 `regra_id` aparecem em `erros[]` com `refEAuditoria` preenchido; depois `POST /api/validador/corrigir-tudo/:id` → `aplicadas≈745`; re-`analisar` → os determinísticos aparecem como `corrigidoPeloUsuario`.

- [ ] **Step 3b: Teste AUTOMATIZADO pós-correção [Revisão F8]** — além da fumaça HTTP, adicionar ao arnês um teste que faz `parse → validar → coletarCorrecoesAuto → aplicar(linhas) → re-parse → re-validar` sobre a fixture POSTO CG e assere que **não surge nenhum bloqueante NOVO**: `DOC-C190-01` mantém a contagem original, VL_DOC das NFC-e próprias fica **intacto** (F1), e nenhum C190 duplicado aparece (F11). É a 2ª camada do arnês (a 1ª, `eauditoria-repro.js`, só mede detecção sobre o ORIGINAL; `golden-export.js` só prova byte-idêntico com `val_correcoes` vazia). Ver "Catálogo Vivo".

- [ ] **Step 4: Commit (marco)**

```bash
git commit --allow-empty -m "test(validador): par casado POSTO CG reproduz 10 códigos E-Auditoria (Ondas 1-2)"
```

---

## Onda 3 — Expansão (plano separado)

Estes códigos **não têm par casado** no POSTO CG (só aparecem no relatório do MONUMENTO) ou exigem tabela/reconciliação adicional. Devem virar um **plano próprio** (`docs/superpowers/plans/AAAA-MM-DD-eauditoria-onda3.md`) após a Onda 2 estabilizar. Resumo do que fica pendente:

- **`2436` (C170 CST×CFOP)** — no POSTO CG o E-Auditoria marcou **todos os 10 C170**; os campos afetados citados são 11/25/31 (CFOP, CST_PIS, CST_COFINS), sugerindo checagem de CST de PIS/COFINS × CFOP, não CST_ICMS. **Requer a matriz oficial de compatibilidade do E-Auditoria** — tarefa de pesquisa antes de implementar (evitar falso-positivo com o monofásico 061/1652 gerado pelo nosso próprio export; alinhar com `r_cst61_competencia` e `r_monofasico_bc`). Aceite: reproduzir os 10 flags.
- **`4028` (C100 sequência de NF)** — ALERTA (a própria Dica manda desconsiderar quando tudo está lançado). **[Revisão F10]** Detecção: agrupar por `(NUM_DOC + COD_MOD + SER)`, somente `IND_EMIT=0`, **ignorar série vazia** (`SER=''`), e contar **1 ocorrência POR INTERVALO/gap** (cada "Ocorrência" do relatório = 1 intervalo; ex. MONUMENTO Ocorr.1 741364→741367 = 2 faltantes = 1 ocorrência). **NÃO** usar filtro de `COD_SIT` 04/05 — são descontinuados desde jan/2023 e o arquivo (06/2026) tem tudo `SIT=00`, então o filtro removeria 0 linhas. O gap 89→60 vem da **definição de intervalo** (contar por gap, não por nota faltante), não de filtro de situação. Aceite: reconciliar para 60.
- **`2973` (multa Lei 8.218)** — aviso legal boilerplate, **não implementar** (nada a detectar/corrigir).
- **`2951`/`2075` no export [Revisão F11]** — ao zerar a ALIQ do C190 (que compõe a chave `CST|CFOP|ALIQ`), pode-se gerar **duas** C190 `CST|CFOP|0,00` na mesma NF (a corrigida + uma genuinamente não tributada) → C190 **duplicado** que o PVA rejeita. Após `correcoesSvc.aplicar` (server.js:9291) rodar um passe **dedicado de dedup-merge** de C190 por NF (fundir chaves `CST|CFOP|ALIQ` iguais somando campos 5..11). Reinvocar `normalizarUsoConsumoCst90` não resolve (early-return em spedCostureiraService.js:804 quando não há relabel). Depende da Task 0.5.
- **Somente no MONUMENTO (12):** `45` (IE DV por UF — novo helper `ieDV.js`), `275`/`283` (PIS/COFINS devem ser 0 por CST) **[Revisão F12] — tratar como DETECÇÃO primeiro (é Alerta); ao auto-corrigir, zerar o BLOCO COMPLETO: PIS = campos 26/27/28/29/30 e COFINS = 32/33/34/35/36, incluindo os ad rem 28/29/34/35 (postos usam PIS/COFINS por quantidade), senão QUANT_BC×ALIQ_REAIS≠0 com VL zerado → PVA acusa; só marcar auto após obter um par casado (SPED+PDF) do MONUMENTO**, `2431`/`2432` (Σ PIS/COFINS itens ≠ C100 — centavos), `2760` (IND_MOV × CFOP), `2405` (CST×CFOP em ST), `2089` (C190 CFOP energia/comunicação/transporte — lista fixa), `2742` (C190 CFOP interno 1/5 × UF do participante no 0150), `2034` (produto do tanque 1300/1310 ≠ 1370), `1637` (sequência de NF entre meses — precisa competências vizinhas do banco), `1753` (0206 ausente para item combustível).

---

## Self-Review

**1. Cobertura do catálogo verificado:** os 10 códigos reproduzidos byte-a-byte no POSTO CG têm task dedicada (2890→1.1, 2481→1.2, 2075→1.3, 2951→1.4, 2441→2.1, 2037→2.2, 2451→2.3, 2800→2.4, 2321→2.5, 1003→2.6). Fundação (money, C190 chaveNatural, refEAuditoria, arnês) na Onda 0. Aplicação em massa na 1.5. ✔
**2. Placeholders:** cada task tem código completo, comandos e saída esperada; nenhuma referência a tipo/função indefinida (money.js e autofix.js definidos antes do uso). ✔
**3. Consistência de tipos:** `coletarCorrecoesAuto` lê `chaveNatural`/`campoIdx`/`valorSugerido`/`classeCorrecao`/`corrigivel` exatamente como o engine os produz (engine.js:26-33,61). `campoIdx` de cada regra corresponde ao índice 1-based usado pelo `aplicar` (correcoes.js:88-89). ✔
**4. Não-regressão:** toda onda roda `tests/golden-export.js` (val_correcoes vazia → export byte-idêntico) além da suíte e do arnês de par casado. ✔
**5. Revisão fiscal incorporada:** as 12 falhas confirmadas (F1–F12) estão aplicadas nas Tasks e indexadas em "Revisão do time fiscal/SPED". ✔

---

## Catálogo Vivo — o catálogo E-Auditoria está SEMPRE em expansão

Este plano é o **ponto de partida** de um catálogo que cresce a cada novo SPED/relatório validado. O E-Auditoria tem centenas de códigos; mapeamos aqui os que aparecem nos arquivos reais que passam pelo sistema, e **novos arquivos revelarão novos códigos** — cada um vira uma linha do catálogo, uma regra e um caso de regressão. Trate o catálogo como fonte viva, não como entrega fechada.

**Fonte única versionada.** Promover o Apêndice A para um arquivo próprio `docs/superpowers/catalogo-eauditoria.md` com cabeçalho `catalog_version` e um changelog por código. Cada linha é a tupla canônica: `{E-Aud, registro, regra_id, refEAuditoria, lógica f[n], correção, occ esperado por fixture, onda, status: detecção|auto|advisory}`.

**Onboarding de um código novo — checklist disciplinado pela regra do PAR CASADO:**
1. **Exigir o par** — SPED `.txt` + relatório E-Auditoria da MESMA empresa/competência, sob `backend/tests/fixtures/<cnpj>_<AAAAMM>/` (com *skip* gracioso quando o dado do cliente não estiver versionado). Sem par casado, o código fica em "Onda N — pendentes sem par casado" (nunca é declarado implementado).
2. **Reproduzir a contagem byte-a-byte** (awk/CLI) e registrar o número no arnês.
3. **Criar `r_*.js`** com `refEAuditoria`, `classeCorrecao` e `jaCorrigidoNoExport` **medidos** (nunca default otimista — foi exatamente o erro F5).
4. **Decidir auto vs advisory por GATE FISCAL explícito** (IND_EMIT, competência, CFOP uso/consumo) e **casar contra o XML** quando o campo for vNF autorizado (lição F1). Onde a correção cascateia para apuração sem o export re-derivar, fica advisory (lição F3).
5. **Só então marcar auto-corrigível** — e apenas se o export honrar a chave (Task 0.5 / F2).

**Arnês de regressão em DUAS camadas, keyed por fixture** (uma entrada por código a cada onboarding):
- **Detecção** — `eauditoria-repro.js` com `EXPECT[código] = occ` por arquivo.
- **Pós-correção** (o que hoje falta, F8) — para cada fixture: `parse → validar → coletarCorrecoesAuto → aplicar → re-parse → re-validar → exportar` e assere **"nenhum bloqueante novo"**: `DOC-C190-01` estável, `E110 = ΣC190`, `VL_DOC = ΣVL_OPR`, sem C190 duplicado — além do `golden-export` nos dois modos (val_correcoes vazia = byte-idêntico; com correções = PVA-clean).

**Regra de crescimento auditável:** cada PR adiciona **1 código = 1 linha na tabela + 1 regra + 1 fixture + 2 asserts (detecção e pós-correção) + entrada no changelog "verificado contra `<arquivo>`"**. Nenhuma correção é declarada "resolvida" sem o arquivo exportado ter passado no seu próprio arnês. Assim o catálogo cresce de forma incremental e provada, e cada código carrega a prova do arquivo que o validou.

**Próximos arquivos a validar (fila viva):** MONUMENTO 01/2026 (par casado dos 12 códigos exclusivos + 2436/4028), e todo novo SPED que o cliente rodar no E-Auditoria. Cada relatório novo → rodar o diff de códigos contra este catálogo → os inéditos entram na fila de onboarding.
