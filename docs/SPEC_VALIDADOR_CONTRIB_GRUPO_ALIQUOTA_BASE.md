# Spec de Implementação — Validador EFD-Contribuições
## Grupo: ALÍQUOTA & BASE DE CÁLCULO

Fonte: PVA oficial (dump real `pva_inconsistencias.sql`), `docs/CATALOGO_REGRAS_PVA_CONTRIBUICOES.md`,
`docs/PARECER_FISCAL_CONTRIBUICOES.md`, v1 em `backend/services/contribuicoes/validadorContribuicoes.js`,
parser `backend/services/spedContribuicoesService.js`.

**SÓ ANÁLISE — não altera código.** Este grupo cobre 3 regras do PVA + 1 coerência CST×base geral.

---

### Layouts confirmados pelo dump real (split('|'), com campo [0]='' antes do 1º pipe)

**C170** (já no v1): `[1]=REG [2]=NUM_ITEM [4]=DESCR_COMPL [7]=VL_ITEM [8]=VL_DESC [10]=CST_ICMS?...`
Campos PIS/COFINS (ID_CAMPO 1-based = índice split): `[25]=CST_PIS [26]=VL_BC_PIS [27]=ALIQ_PIS%
[28]=QUANT_BC_PIS [29]=ALIQ_PIS_QUANT [30]=VL_PIS [31]=CST_COFINS [32]=VL_BC_COFINS [33]=ALIQ_COFINS%
[36]=VL_COFINS`. **[14]=ALIQ_ICMS — PROIBIDO usar como alíquota PIS/COFINS.**

**C175** (deduzido do CONTEUDO_LINHA real; ID_CAMPO "7 - ALIQ_PIS" ⇒ ALIQ_PIS no índice 7):
```
|C175|5405|20,00|0,00|01|20,00|0,6500| | |0,13|01|20,00|3,0000| | |0,60|002.2| |
 [1]  [2]  [3]  [4] [5] [6]  [7]  [8][9][10][11][12][13] [14][15][16] [17] [18]
REG  CFOP VL_ VL_ CST VL_ ALIQ Q_  A_ VL_ CST VL_ ALIQ Q_  A_  VL_ COD_ INFO
          OPR DESC PIS BC_ PIS% BC_ PIS PIS COF BC_ COF% BC_ COF COF  CTA  COMPL
                       PIS     PIS         (idx11)COF        COF
```
Índices: `[2]=CFOP [3]=VL_OPR [4]=VL_DESC [5]=CST_PIS [6]=VL_BC_PIS [7]=ALIQ_PIS% [10]=VL_PIS
[11]=CST_COFINS [12]=VL_BC_COFINS [13]=ALIQ_COFINS% [16]=VL_COFINS [17]=COD_CTA`.
⚠️ **Layout diferente do C170** — ALIQ_PIS em [7] no C175 vs [27] no C170. Exige branch por REG.

**M105/M505** (ID_CAMPO "4 - VL_BC_PIS_TOT" ⇒ índice 4):
```
|M105|01|50|37727,11|0,00|37727,11|37727,11| | |Aquisição de bens para revenda|
 [1]  [2][3]  [4]     [5]   [6]      [7]    [8][9]  [10]
REG NAT CST VL_BC_   VL_BC_ VL_BC_  VL_BC_ Q  Q  DESC_CRED
    BC_ PIS PIS_TOT  PIS_   PIS_NC  PIS
    CRED        (=[5]+[6]) CUM
```
`[2]=NAT_BC_CRED [3]=CST_PIS [4]=VL_BC_PIS_TOT [5]=VL_BC_PIS_CUM [6]=VL_BC_PIS_NC [7]=VL_BC_PIS`.
M505 idêntico para COFINS.

---

## REGRA 1 — MSG_ALIQ_BASICA (C175 e C170)

**(1) O que o PVA checa.** Em item com CST tributável de alíquota básica (01/02), a alíquota
declarada tem de ser a básica do regime. No dump (750 ocorrências, C175, ID_CAMPO `7 - ALIQ_PIS`):
- `|C175|5405|20,00|0,00|01|20,00|`**`0,6500`**`| | |0,13|01|20,00|`**`3,0000`**`|...` → achado `0,6500`, **esperado `1,65`** (linha 190).
- `|C175|5405|35,00|1,75|01|33,25|0,6500|...|33,25|3,0000|...` (linha 360) — note BC=33,25=35,00−1,75 (desconto).

Interpretação fiscal crítica: `0,65 / 3,0` são as alíquotas do regime **CUMULATIVO** (lucro presumido).
O arquivo foi entregue como **NÃO-CUMULATIVO** (0110 COD_INC_TRIB=1), onde o correto é `1,65 / 7,6`.
Logo a regra é **dependente do REGIME** (registro 0110, já lido em `parser.meta.regime`).

**(2) Disparo:** `E` (erro). Alíquota errada distorce a apuração.

**(3) Detecção no parser.**
- Ler `regime = parsed.meta.regime` (0110 idx 2): `1`=não-cumul → básicas `PIS=1,65 COFINS=7,6`;
  `2`=cumul → `PIS=0,65 COFINS=3,0`; `3`=ambos → não cravar (avaliar por CST/tabela, pular ou advertir).
- Para cada **C170** (CST_PIS `f[25]`, ALIQ_PIS `f[27]`, CST_COF `f[31]`, ALIQ_COF `f[33]`) **e cada
  C175** (CST_PIS `f[5]`, ALIQ_PIS `f[7]`, CST_COF `f[11]`, ALIQ_COF `f[13]`):
  - Se CST ∈ {`01`,`02`} (alíquota básica com BC em valor) e ALIQ ≠ 0 e ALIQ ≠ `básica_do_regime`
    → apontar. Normalizar vírgula→ponto e comparar numérico (`1,65`≡`1,6500`; usar `Math.abs(a-b)<0,0001`).
  - CST `03` (alíquota por unidade) usa ALIQ_QUANT — **não** comparar contra 1,65/7,6 (pular).
  - CST `05` (ST) e `50-56` (crédito): a alíquota do crédito também é básica no não-cumul; aplicar
    a mesma checagem à ALIQ, mas severidade/rótulo "crédito".
- **NUNCA** comparar contra `f[14]` (ALIQ_ICMS do C170, ex. 27%). Só ALIQ_PIS/ALIQ_COFINS.

**(4) Severidade/prioridade:** ALTA / prioridade 1 (750 ocorrências, é o campeão do PVA).

**(5) v1 cobre?** NÃO. O v1 só tem `CST_SEM_BASE` (base/valor ausente) e nem lê C175 (itera só C170).
Falta: (a) ler C175; (b) comparar valor da alíquota contra a básica do regime; (c) usar `meta.regime`.

**(6) Armadilhas.**
- Alíquota do de-para **nunca** é a de ICMS (`f[14]`).
- 0,65/3,0 só é erro se o regime for não-cumulativo — no cumulativo é o correto (evitar falso positivo).
- Comparar como número, não string (`1,65` vs `1,6500`).
- C175 tem índices próprios (ALIQ em [7]/[13], não [27]/[33]).

---

## REGRA 1b — MSG_ALIQ_CREDITO_PRESUMIDO (C170) — vizinha, mesmo campo

**(1)** `|C170|1|AGUA MINERAL MELEVE 20L|...|60|0,00|`**`0,0000`**`|...` (linha 238, ID_CAMPO
`27 - ALIQ_PIS` e `33 - ALIQ_COFINS`): CST `60` com ALIQ `0,0000` onde o PVA esperava alíquota de
crédito presumido. `esperado=NULL` no dump (o PVA não crava o número, só sinaliza a incoerência).

**(2)** `E`. **(3)** CST de crédito presumido (60-66, quando aplicável) com ALIQ zero. **(4)** MÉDIA /
prioridade 3. **(5)** v1 não cobre. **(6)** Só 2 ocorrências; depende de tabela de CST presumido —
tratar como advertência, não recomendar valor.

---

## REGRA 2 — MSG_VL_BC_PIS_TOT_M105 / (VL_BC_COFINS_TOT_M505)

**(1) O que o PVA checa.** No M105/M505, `VL_BC_PIS_TOT` (índice 4) deve bater com a **soma das bases
dos itens** que compõem aquele crédito (mesmo NAT_BC_CRED + CST). Dump (M105/M505, ID_CAMPO
`4 - VL_BC_PIS_TOT` / `4 - VL_BC_COFINS_TOT`):
- `|M105|01|50|`**`37727,11`**`|0,00|37727,11|37727,11| | |Aquisição de bens para revenda|` →
  achado `37727,11`, **esperado `37361,19`** (linha 34184). Diferença = **365,92**.
- `|M105|01|50|`**`391322,47`**`|...` → esperado **`358506,95`** (linha 82294). Dif = 32815,52.

**Achado forense:** a diferença `365,92` é exatamente a base do item
`|C170|1|550| |2,00000|CX|365,92|...|50|365,92|1,6500|...|42102|` que o PVA reprovou em
**MSG_COMPATIBILIDADE_CFOP_CRED** (CST 50 incompatível com o CFOP). Ou seja: o total M105 incluiu
base de item **inelegível** ao crédito; o esperado = total − bases inelegíveis. A regra 2 é
**consequência** das regras #3/#4 (CFOP×crédito, NCM monofásico).

**(2) Disparo:** `E`.

**(3) Detecção no parser.** Duas camadas:
- **Coerência interna (barata, sempre):** `VL_BC_PIS_TOT (f[4]) == VL_BC_PIS_CUM (f[5]) +
  VL_BC_PIS_NC (f[6])`, com tolerância ±0,01. Nos exemplos bate (0,00+37727,11=37727,11) — então
  este teste sozinho NÃO pega o erro; serve de sanidade.
- **Soma dos itens (reproduz o PVA):** agrupar entradas creditáveis por CST de crédito e somar
  `VL_BC_PIS` dos C170/C175 (entrada, CST ∈ 50-56), comparar com Σ `VL_BC_PIS_TOT` dos M105.
  Aritmética: somar em **centavos inteiros** (parse `"37727,11"`→ 3772711) para evitar erro de float;
  comparar `Σitens` vs `Σ M105`. Divergência ⇒ apontar, e **detalhar** que a causa provável são
  itens marcados nas regras #3/#4 (crédito indevido inflando a base).
- HALF-UP 2 casas só é relevante ao **recompor** valores (VL=BC×ALIQ); aqui é soma pura de bases.

**(4) Severidade/prioridade:** ALTA / prioridade 2 (erro de apuração; crédito a maior = risco fiscal,
multa Lei 9.430/96 art. 44). Poucas ocorrências (4) mas alto impacto financeiro.

**(5) v1 cobre?** NÃO — v1 nem entra no bloco M. Falta: parsear M105/M505, montar a soma de bases
das entradas creditáveis, cruzar. Exige correlacionar item→crédito (aproximação: agregado por CST).

**(6) Armadilhas.**
- Não confundir `VL_BC_PIS_TOT` [4] com `VL_BC_PIS` [7] (no exemplo coincidem, mas semanticamente
  TOT = CUM+NC).
- Somar em inteiros (centavos); nunca `parseFloat` acumulado.
- O "esperado" do PVA exclui itens inelegíveis — para reproduzir 100% precisa das regras #3/#4;
  sem elas, reporte a divergência de soma e aponte para revisão do crédito (não crave o número).
- Reprocessar após corrigir #3/#4 (o erro tende a sumir sozinho).

---

## REGRA 3 — Coerência CST × base (geral) — endurece o v1 existente

Consolida `CST_SEM_BASE` e `BASE_INDEVIDA` do v1, agora **também no C175** e ligada às alíquotas.

**(1) O que checar.**
- **CST com incidência** (`01`,`02`,`03`,`05`,`50-56`): exigem **BC + ALIQ + VL** preenchidos e
  coerentes. `04`,`06-09`,`70-75`,`98`,`99`: exigem **zeros** (BC/ALIQ/VL = 0 ou vazio).
- **Coerência aritmética** (nova): para CST com base, `VL ≈ HALF-UP(BC × ALIQ%/100, 2)`.
  Ex. C175 linha 190: BC 20,00 × 0,65% = 0,13 ✓ (o VL bate; o erro está na ALIQ, pego pela Regra 1).

**(2) Disparo:** `E` para "com incidência sem base" (PVA reprova); `A`/MÉDIA para "zero com valor".

**(3) Detecção.** Reusar `CST_TRIBUTAVEL`/`CST_CREDITO`/`CST_ZERO` do v1. **Corrigir bug do v1:**
`CST_EXIGE_BASE` inclui `'04'` e depois exclui via `cst !== '04'` — manter, mas `04` é alíquota zero
(não exige base) e **não** deve estar em CST_TRIBUTAVEL para fins de "exige base". Adicionar branch
C175 (índices [5]/[6]/[7]/[10] PIS, [11]/[12]/[13]/[16] COFINS). Checagem aritmética VL=BC×ALIQ com
**HALF-UP 2 casas** (`Math.round(bc*aliq/100*100 + 1e-9)/100`; validar arredondamento comercial).

**(4) Severidade/prioridade:** ALTA (sem base) / MÉDIA (zero com valor) — prioridade 2-3.

**(5) v1 cobre?** PARCIAL. Cobre C170 sem-base e zero-com-valor. Falta: **C175**; **checagem
aritmética VL=BC×ALIQ**; e conectar com a Regra 1 (alíquota errada).

**(6) Armadilhas.**
- **BC = VL_ITEM − VL_DESC** (nunca VL_ITEM cheio). C170: `f[7]−f[8]`. C175: `f[3]−f[4]`.
- CST `03` é por unidade (QUANT_BC×ALIQ_QUANT) — não aplicar VL=BC×ALIQ% nele.
- Nunca "rebaixar" CST tributável para 06 para silenciar o erro (guardrail do parecer): apontar,
  não sugerir zerar a base.
- Desconto: item com desconto (ex. linha 360: 35,00−1,75=33,25) tem BC = líquido; validar contra o
  líquido, não contra VL_OPR bruto.

---

## Resumo de implementação (para o coder)

| Regra | REG | Campos (split) | Conta | Sev | v1 |
|---|---|---|---|---|---|
| 1 MSG_ALIQ_BASICA | C170, **C175** | C170 [25/27][31/33]; C175 [5/7][11/13] | ALIQ == básica_do_regime(0110) | ALTA/P1 | não |
| 1b ALIQ_CRED_PRESUMIDO | C170 | [25/27][31/33] | CST presumido c/ ALIQ 0 → advertir | MÉDIA/P3 | não |
| 2 VL_BC_PIS_TOT_M105 | M105/M505 | [4]=TOT, [5]+[6] | TOT==CUM+NC (sanidade) **e** TOT==Σ bases itens creditáveis (centavos int) | ALTA/P2 | não |
| 3 CST×base geral | C170, **C175** | idem regra 1 + BC/VL | com incidência⇒BC+ALIQ+VL; zero⇒zeros; VL=HALF-UP(BC×ALIQ) | ALTA/MÉDIA | parcial |

Constantes reaproveitáveis do v1: `CST_TRIBUTAVEL`, `CST_CREDITO`, `CST_ZERO`, `temValor()`.
Novos utilitários necessários: `parseNum('37727,11')→centavos`, `aliqBasica(regime)→{pis,cofins}`,
`branch por REG` (C170 vs C175), `iterar bloco M` no loop principal do validador.
