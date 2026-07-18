# Especificação de Implementação — Validador EFD-Contribuições
## Grupo: CST / CRÉDITO / NATUREZA (o cerne fiscal)

Fonte das regras: base oficial do PVA (dump `pva/pva_inconsistencias.sql`, schema `pva/pva_tabelas.sql`).
Alvo de código: `backend/services/contribuicoes/validadorContribuicoes.js` (+ `classificadorFiscal.js`).

### Layout C170 canônico (verificado contra linhas reais do dump)
`split('|')` numa linha `|C170|...` (o índice 0 é a string vazia antes do 1º `|`):

| idx | campo | idx | campo |
|----|--------|----|--------|
| 1 | REG | 20 | CST_IPI |
| 2 | NUM_ITEM | 21 | COD_ENQ |
| **3** | **COD_ITEM** (→ 0200 p/ NCM) | 22-24 | VL_BC/ALIQ/VL_IPI |
| 4 | DESCR_COMPL | **25** | **CST_PIS** |
| 5 | QTD | **26** | VL_BC_PIS |
| 6 | UNID | **27** | **ALIQ_PIS (%)** |
| 7 | VL_ITEM | 28 | QUANT_BC_PIS |
| 8 | VL_DESC | 29 | ALIQ_PIS (R$) |
| 9 | IND_MOV | **30** | VL_PIS |
| 10 | CST_ICMS | **31** | **CST_COFINS** |
| **11** | **CFOP** | 32 | VL_BC_COFINS |
| 12 | COD_NAT | **33** | ALIQ_COFINS (%) |
| 13-15 | VL_BC/ALIQ/VL_ICMS | 34-35 | QUANT/ALIQ_COFINS R$ |
| 16-18 | ST | **36** | VL_COFINS |
| 19 | IND_APUR | **37** | COD_CTA |

> ⚠️ **NCM não está no C170.** Vem do `0200` (`COD_ITEM` → NCM). O validador precisa
> pré-indexar os `0200` do arquivo: `map0200[COD_ITEM] = { ncm, descr }`. Sem isso a
> regra de NCM-monofásico não roda.
> Direção: pega-se do `C100` pai (`f[2]=IND_OPER`: `0`=entrada, `1`=saída), como o v1 já faz.

---

## REGRA 1 — `NAT_CST_NCM_MONO` (MSG_COMPATIBILIDADE_NCM_TRIB_MONO)

**(1) O que o PVA checa.** Registro `C170`, campo `25 - CST_PIS` (e o gêmeo `31 - CST_COFINS`).
Rejeita **CST 50 (crédito básico) quando o NCM do item é monofásico**. É a regra que ratifica o cerne do parecer: entrada de produto monofásico **não gera crédito**.

**Exemplo real (dump, tabela `i_bd20260213190643`, 30 ocorr. / 1 arq — combustível):**
```
|C170|1|1| |5000,00000|L|27766,38|...|061|1652|1652|...|50|27766,38|1,6500| | |458,15|50|27766,38|7,6000| | |2110,24|39|
        └COD_ITEM=1          CST_ICMS┘ CFOP=1652(compra comb.) CST_PIS=50┘  CST_COFINS=50┘
```
CFOP 1652 = compra de combustível p/ comercialização; NCM 2710/2711 (monofásico); CST_PIS/COFINS 50 → PVA aponta.

**(2) Condição de disparo (tipo A = alerta).**
`dir === 'E'` **E** `CST_PIS ∈ {50..56}` (ou `CST_COFINS ∈ {50..56}`) **E** `bucket(NCM) === MONOFASICO`.

**(3) Detecção no nosso parser.**
- Resolver NCM: `ncm = map0200[ f[3] ]?.ncm`.
- `const cls = classificarNcm(ncm)` → `classificadorFiscal.classificarNcm`.
- Disparar se `cls.bucket === BUCKET.MONOFASICO` (confiança `ALTA`) e `CST_CREDITO.has(cstPis||cstCof)`.
- **Vínculo classificador:** é exatamente o `SEED_NCM` (2710/2711 → MONOFASICO). O de-para do cliente amplia o bucket; enquanto `INDEFINIDO`, **não** dispara (conservador — evita falso positivo).

**(4) Severidade/prioridade.** ALTA / P1. Crédito indevido = risco fiscal direto (glosa + multa).

**(5) v1 cobre?** Parcial. O v1 tem `CREDITO_ENTRADA` (dispara p/ QUALQUER crédito em entrada, severidade MÉDIA, genérico). Falta: cruzar com o **bucket NCM** para elevar a MONOFÁSICO→ALTA e dar a mensagem específica ("vedado creditar — Lei 10.833/03 art.3º §2º II", já presente no `regraCst`).

**(6) Dependências.** `map0200` (COD_ITEM→NCM) + `classificadorFiscal` populado. Para além de 2710/2711, precisa do **de-para NCM do cliente** (tabelas PVA de referência: `ncm_aliq_mono_difer`, `ncm_aliq_mono_unid`).

---

## REGRA 2 — `NAT_CST_CFOP_CRED` (MSG_COMPATIBILIDADE_CFOP_CRED)

**(1) O que o PVA checa.** `C170`, campo `25 - CST_PIS` / `31 - CST_COFINS`. Rejeita **CST 50 (crédito) quando o CFOP da operação não confere direito a crédito** — mesmo que o NCM não seja monofásico. A fonte-verdade do PVA é a tabela `cfop_credito(codigo, nat_bc_cred, dt_ini, dt_fin)`.

**Exemplos reais (72 ocorr. / 4 arqs):**
```
|C170|1|471| |3,00000|GL|177,00|...|090|1949|1949|...|50|177,00|1,6500|...|2,92|50|...|13,45|31102|   → CFOP 1949
|C170|1|550| |2,00000|CX|365,92|...|060|1910|1910|...|50|365,92|1,6500|...|6,04|50|...|27,81|42102|   → CFOP 1910
```
CFOP 1949 (outra entrada não especificada) e 1910 (entrada de bonificação/doação) **não** dão crédito → CST 50 aponta.

**(2) Condição de disparo (tipo A).**
`dir === 'E'` **E** `CST ∈ {50..56}` **E** `CFOP (f[11]) ∉ whitelist_credito`.

**(3) Detecção.**
- `const cfop = f[11].trim()`.
- Consultar tabela `cfop_credito` local. **Se o CFOP não estiver na lista de CFOPs que geram crédito → aponta.**
- **⚠️ Achado de dependência:** no dump a tabela `cfop_credito` **está VAZIA** (é `ENGINE=MEMORY`, populada em runtime pelo PVA). **Não dá para extrair a whitelist do dump.** Precisamos **semear nossa própria tabela** de CFOPs creditáveis (ex.: 1101/1102/1111/1116/1117/1401/1556/1651/1653… — compras p/ industrialização/revenda/insumo) com a coluna `nat_bc_cred` (natureza da BC do crédito, `varchar(2)`; ex. `01`=bens p/ revenda, `02`=insumos). CFOPs de bonificação/transferência s/ ônus/uso e consumo (1910, 1949, 1552, 1557…) ficam **fora**.
- Regra prática combinada: se `bucket === MONOFASICO` já cai na Regra 1; a Regra 2 pega o **restante** (crédito em CFOP não-creditável independente do NCM).

**(4) Severidade/prioridade.** ALTA / P1 (é a 3ª mais frequente do dump — 72 ocorr.).

**(5) v1 cobre?** Não especificamente. Falta a whitelist de CFOP. O `CREDITO_ENTRADA` do v1 mascara parte disso, mas sem precisão (não sabe distinguir CFOP creditável de não-creditável).

**(6) Dependências.** Nova tabela `cfop_credito` própria (seed + `nat_bc_cred`), com vigência (`dt_ini/dt_fin`) como no schema PVA. Este é o principal item de dados a construir para o grupo.

---

## REGRA 3 — `NAT_CST_DIREITO_CRED` (MSG_OPERACAO_DIREITO_CREDITO)

**(1) O que o PVA checa.** Registros **`D501` (PIS) / `D505` (COFINS)** — serviços de comunicação/transporte (bloco D), campo `2 - CST_PIS`/`CST_COFINS`. Aponta CST **`99`** (e `98`) numa operação que **daria direito a crédito** — ou seja, CST "outras operações / sem direito" onde a natureza do doc. permitiria crédito.

**Exemplos reais (4 ocorr. / 1 arq):**
```
|D501|99|99,90| |0,00|0,0000|0,00| |     ← CST_PIS=99, VL_BC=0,00, ALIQ=0,0000
|D505|99|99,90| |0,00|0,0000|0,00| |     ← CST_COFINS=99
|D501|98|99,90|01|0,00|0,0000|0,00| |    ← CST 98
```
Layout `D501`: `|D501|CST_PIS|VL_ITEM|NAT_BC_CRED|VL_BC_PIS|ALIQ_PIS|VL_PIS|COD_CTA|` → `split('|')`: **f[2]=CST_PIS**, f[3]=VL_ITEM, f[4]=NAT_BC_CRED, f[5]=VL_BC_PIS, f[6]=ALIQ_PIS, f[7]=VL_PIS. `D505` idem com CST_COFINS em f[2].

**(2) Condição de disparo (tipo A).**
Registro `D500` pai indica documento com **direito a crédito** (serviço tomado de comunicação/transporte) **E** o `D501/D505` filho traz `CST ∈ {98,99}` (sem crédito) **E** `VL_ITEM > 0`.
Simplificação segura p/ v2: `reg ∈ {D501,D505}` **E** `CST ∈ {98,99}` **E** `f[3](VL_ITEM) > 0` → **alerta** ("operação com CST sem crédito; confirmar se não caberia crédito 50/53").

**(3) Detecção.** Estender o loop para tratar `D501`/`D505` (hoje o v1 só olha `C170`). Parser já entrega `l.reg` e `l.raw`. Sem NCM (bloco D é serviço, não mercadoria) → decisão por CST + presença de valor.

**(4) Severidade/prioridade.** MÉDIA / P3 (só 4 ocorr.; volume baixo, mas é crédito potencial perdido, não risco de multa).

**(5) v1 cobre?** Não — v1 ignora bloco D. Falta o ramo `D501/D505`.

**(6) Dependências.** Nenhuma externa. Opcional: `nat_bc_cred` (f[4]) para refinar a mensagem.

---

## REGRA 4 — `NAT_ALIQ_CRED_PRESUMIDO` (MSG_ALIQ_CREDITO_PRESUMIDO)

**(1) O que o PVA checa.** `C170`, campo `27 - ALIQ_PIS` (e `33 - ALIQ_COFINS`). Para CST de **crédito presumido (60–66)**, a alíquota **não pode ser `0,0000`** — tem de trazer a alíquota presumida aplicável.

**Exemplo real (2 ocorr. / 1 arq):**
```
|C170|1|AGUA MINERAL MELEVE 20L| |1,00000|UN|9,00|...|060|1407|1407|...|60|0,00|0,0000| | |0,00|60|0,00|0,0000| | |0,00| |
                                            CST_ICMS┘ CFOP1407  CST_PIS=60┘ ALIQ=0,0000┘  CST_COFINS=60┘ ALIQ=0,0000┘
```
CST_PIS/COFINS = **60** (crédito presumido) com `ALIQ = 0,0000` → PVA aponta ("informar alíquota do crédito presumido").

**(2) Condição de disparo (tipo E = erro).**
`CST_PIS ∈ {60,61,62,63,64,65,66}` **E** `ALIQ_PIS (f[27]) == 0,0000`. Idem COFINS (f[33]).

**(3) Detecção.**
- Novo Set `CST_CRED_PRESUMIDO = {60..66}`.
- `if (CST_CRED_PRESUMIDO.has(cstPis) && !temValor(f[27])) → aponta` (reutiliza `temValor`).
- **⚠️ Cuidado (nuance do nosso domínio):** a memória "CST 61 monofásico é correto — não trocar p/ 60" refere-se a **CST_ICMS** (campo f[10]), **outro campo**. Aqui é **CST_PIS/COFINS** (f[25]/f[31]). Não confundir: no PIS/COFINS, 60–66 são presumidos e exigem alíquota.

**(4) Severidade/prioridade.** ALTA / P2 (é tipo E — o PVA **reprova**, bloqueia entrega; volume baixo mas trava a transmissão).

**(5) v1 cobre?** Parcial/invertido. O `CST_SEM_BASE` do v1 cobre 01–05/50–56, **não** 60–66. E o `BASE_INDEVIDA`/`CST_ZERO` do v1 **não inclui 60–66**, então hoje passa batido. Falta o ramo presumido.

**(6) Dependências.** Nenhuma externa (checa só CST + alíquota do próprio C170). Para sugerir a alíquota correta (correção, fora do escopo read-only), precisaria da tabela de alíquotas presumidas por NCM.

---

## Resumo de implementação (grupo)

| Regra | tipo | reg | campos | severidade | v1 | falta principal |
|-------|------|-----|--------|-----------|----|-----------------|
| NAT_CST_NCM_MONO | A | C170 | f25/f31 + NCM(0200) | ALTA/P1 | parcial (CREDITO_ENTRADA genérico) | `map0200` + bucket MONOFASICO |
| NAT_CST_CFOP_CRED | A | C170 | f25/f31 + f11(CFOP) | ALTA/P1 | não | **tabela `cfop_credito` própria (VAZIA no dump)** |
| NAT_CST_DIREITO_CRED | A | D501/D505 | f2(CST) + f3(VL) | MÉDIA/P3 | não (ignora bloco D) | ramo D501/D505 |
| NAT_ALIQ_CRED_PRESUMIDO | E | C170 | f27/f33 + f25/f31 | ALTA/P2 | não (60–66 fora dos Sets) | Set 60–66 + check alíquota |

**Pré-requisito comum:** indexar `0200` (COD_ITEM→NCM) numa passada antes do loop, e estender o loop atual (só `C170`) para também casar `D501`/`D505`.

**Maior dependência de dados:** semear a tabela `cfop_credito` (`codigo`, `nat_bc_cred`, `dt_ini`, `dt_fin`) — o PVA a popula em runtime, então o dump não a traz. Sem ela, a Regra 2 não tem whitelist.
