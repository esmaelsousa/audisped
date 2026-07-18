# Especificação de Implementação — Validador EFD-Contribuições · GRUPO BLOCO M / APURAÇÃO

Fonte: `docs/CATALOGO_REGRAS_PVA_CONTRIBUICOES.md`, dump real `pva_inconsistencias.sql`,
`backend/services/contribuicoes/validadorContribuicoes.js` (v1) e `spedContribuicoesService.js`.

Estratégia (parecer, decisão #1): **débito/crédito real (M210/M610/M100/M500) é DEFERIDO ao
"Gerar Apuração" do PVA — nosso injetor NÃO fabrica**. Portanto TODAS as regras deste grupo são
**apontamentos read-only** (o validador APONTA a incoerência/ausência; nunca corrige). Severidade
default `AVISO` (não bloqueia export), exceto onde o próprio PVA marca ERRO estrutural.

---

## 0. Layout dos registros M (posições reais, `raw.split('|')`, p[0]='' p[1]=REG)

Confirmado byte-a-byte no dump. PIS (M1xx/M2xx/M4xx) e COFINS (M5xx/M6xx/M8xx) são espelhos.

### M100 — Crédito PIS do período · `|M100|COD_CRED|IND_CRED_ORI|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_CRED|VL_AJUS_ACRES|VL_AJUS_REDUC|VL_CRED_DIF|VL_CRED_DISP|IND_DESC_CRED|VL_CRED_DESC|SLD_CRED|`
Real: `|M100|101|0|604455,83|1,6500| | |9973,52|0,00|0,00|0,00|9973,52|0|9973,52|0,00|`
→ p[2]=COD_CRED, p[4]=VL_BC_PIS, p[5]=ALIQ_PIS, **p[8]=VL_CRED**, p[14]=SLD_CRED. (M500 idem, ALIQ 7,6000)

### M105 — Detalhe da base do crédito PIS · `|M105|NAT_BC_CRED|CST_PIS|VL_BC_PIS_TOT|VL_BC_PIS_CUM|VL_BC_PIS_NC|VL_BC_PIS|QUANT_BC_PIS_TOT|QUANT_BC_PIS|DESC_CRED|`
Real: `|M105|01|50|37727,11|0,00|37727,11|37727,11| | |Aquisição de bens para revenda|`
→ p[2]=NAT_BC_CRED, p[3]=CST_PIS, **p[4]=VL_BC_PIS_TOT**, p[6]=VL_BC_PIS_NC, p[7]=VL_BC_PIS, **p[10]=DESC_CRED**.
Caso vazio (regra #18): `|M105|13|50|8200,00| |8200,00|8200,00| |0,000| |` (p[10] vazio). (M505 idem)

### M200 — Consolidação PIS · `|M200|VL_TOT_CONT_NC_PER|VL_TOT_CRED_DESC|VL_TOT_CRED_DESC_ANT|VL_TOT_CONT_NC_DEV|VL_RET_NC|VL_OUT_DED_NC|VL_CONT_NC_REC|VL_TOT_CONT_CUM_PER|VL_RET_CUM|VL_OUT_DED_CUM|VL_CONT_CUM_REC|VL_TOT_CONT_REC|`
Real: `|M200|15,89|0,00|0,00|15,89|0,00|0,00|15,89|0,00|0,00|0,00|0,00|15,89|`
→ p[2]=VL_TOT_CONT_NC_PER, p[5]=VL_TOT_CONT_NC_DEV, **p[8]=VL_CONT_NC_REC**, p[12]=VL_CONT_CUM_REC, **p[13]=VL_TOT_CONT_REC**. (M600 idem)

### M210 — Detalhe débito PIS · `|M210|COD_CONT|VL_REC_BRT|VL_BC_CONT|VL_AJUS_ACRES_BC|VL_AJUS_REDUC_BC|VL_BC_CONT_AJUS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_CONT_APUR|VL_AJUS_ACRES|VL_AJUS_REDUC|VL_CONT_DIFER|VL_CONT_DIFER_ANT|VL_CONT_PER|COD_CTA|`
Real: `|M210|01|39603,00|39003,95|0,00|0,00|39003,95|0,6500| | |253,53|0,00|0,00|0,00|0,00|253,53| |`
→ p[2]=COD_CONT, p[3]=VL_REC_BRT, **p[4]=VL_BC_CONT**, p[7]=VL_BC_CONT_AJUS, p[8]=ALIQ_PIS, **p[11]=VL_CONT_APUR**, **p[16]=VL_CONT_PER**. (M610 espelho, ALIQ_COFINS em p[8])
Caso "não calculou" (regra #11): `|M210|31|37402,25|...|0,6500|...|0,00|...|0,00| |` (base>0, VL_CONT_APUR=0,00)

### M400/M800 — Receita por CST (isenta/não-trib) · `|M400|CST_PIS|VL_TOT_REC|COD_CTA|DESC_COMPL|`
Real: `|M400|04|334041,09| | |` → p[2]=CST, **p[3]=VL_TOT_REC**.

### M410/M810 — Detalhe receita por natureza · `|M410|NAT_REC|VL_REC|COD_CTA|DESC_COMPL|`
Real: `|M410|001|1176525,28| | |` → p[2]=NAT_REC, **p[3]=VL_REC**, p[4]=COD_CTA.

**Pré-processamento sugerido:** antes das regras, indexar `parsed.linhas` em buckets por REG
(`porReg = { M100:[], M105:[], M200:[], ... }`). Cada regra opera sobre esses buckets. Todos os
valores decimais via helper `num(s)` = `parseFloat(String(s||'').replace(/\./g,'').replace(',','.'))||0`.
Note que M200/M600 **não têm chave** — há N ocorrências por arquivo (uma por consolidação), então
associação M200↔M205/M210 é **posicional/sequencial** (M205 e M210 vêm logo após seu M200 no bloco).

---

## Regra #6 — MSG_OBRIGATORIO_M205_M605 (M200/M600) · ERRO · prio 6 · 12 ocorr / 6 arqs

1. **O que o PVA checa:** todo M200 (M600) com contribuição do período apurada (`VL_TOT_CONT_NC_PER`
   ou `VL_TOT_CONT_CUM_PER` > 0, isto é p[2]>0 ou p[9]>0) EXIGE ao menos um M205 (M605) que detalha
   a contribuição por código de receita. M205 é filho obrigatório de M200 quando há o que pagar/detalhar.
2. **Disparo:** E (erro estrutural — a mais frequente do grupo, 12 ocorrências).
3. **Detecção:** para cada `M200`, se `num(p[2])>0 || num(p[9])>0` e **não existe M205 associado**
   (nenhum `M205` entre este M200 e o próximo M200/M210/M400), apontar. Espelho: M600→M605.
   Como o parser não gera filiação, use varredura sequencial: ao encontrar M200, olhe as linhas
   seguintes até o próximo registro de nível ≥ M200; se nenhuma for M205, dispara.
4. **Severidade/prioridade:** ERRO estrutural / prioridade 6 (a maior do grupo — implementar 1º).
5. **v1 cobre?** NÃO — v1 não olha bloco M.
6. **Deferir ao PVA:** o "Gerar Apuração" normalmente cria M205 junto com M200. Se o arquivo do
   cliente já tem M200 sem M205, é sinal de escrituração manual/parcial → APONTAR "rodar Gerar
   Apuração no PVA". Não fabricar M205.

---

## Regra #15 — MSG_REGISTRO_OBRIGATORIO (M200/M600) · ERRO · prio 1 · 2 ocorr

1. **O que checa:** M200 (e M600) são **obrigatórios** quando o bloco M existe / há operações no
   período. Ausência total do registro de consolidação.
2. **Disparo:** E.
3. **Detecção:** se há registros de apuração no bloco M (existe M210/M100/M400 **ou** o bloco M foi
   aberto — presença de qualquer `M001` com IND_MOV=0/"tem dados") e **`porReg.M200.length===0`**,
   apontar "M200 obrigatório ausente". Idem M600. Guardar contra falso-positivo em arquivo sem
   bloco M (IND_MOV=1 / sem movimento).
4. **Severidade/prioridade:** ERRO / prio 1.
5. **v1 cobre?** NÃO.
6. **Deferir:** M200 é saída direta do Gerar Apuração → apontar para rodá-lo.

---

## Regra #7 — MSG_CONTRIBUICAO_NAO_DEVE_EXISTIR (M210/M610) · ERRO · prio 2 · 4 ocorr

1. **O que checa:** débito apurado onde NÃO deveria haver — ex.: M210 com `VL_CONT_APUR>0` sobre
   base cujo COD_CONT/CST corresponde a operação de **alíquota zero / não-tributada** (o painel liga
   isto a `BASE_INDEVIDA` / CST 04-06). Contribuição existindo indevidamente.
2. **Disparo:** E (campo REG).
3. **Detecção:** para cada M210 (M610): se `num(VL_CONT_APUR p[11])>0` **e** o COD_CONT (p[2]) /
   alíquota (p[8]) indicam receita de alíquota zero (ALIQ_PIS = `0,00` mas VL_CONT_APUR>0, ou COD_CONT
   de faixa não-tributada). Cruzar com CST_ZERO (`04,06,07,08,09,70-75,98,99`) já definido no v1.
   Heurística mínima viável: `ALIQ==0 && VL_CONT_APUR>0` → dispara.
4. **Severidade/prioridade:** ERRO / prio 2.
5. **v1 cobre?** NÃO no bloco M (v1 tem CST_ZERO mas só em C170).
6. **Deferir:** apontar; a correção da apuração é do PVA. Reforça o parecer (não gerar débito em monofásico/alíquota zero).

---

## Regra #11 — MSG_CALCULAR_CONTRIBUICAO (M210/M610) · ERRO · prio 1 · 2 ocorr

1. **O que checa:** há base (`VL_BC_CONT>0`) mas a contribuição **não foi calculada**
   (`VL_CONT_APUR=0`). Falta multiplicar base × alíquota.
2. **Disparo:** E. Exemplo real: `|M210|31|37402,25|...|0,6500|...|0,00|...` (base 37402,25, apur 0,00).
3. **Detecção:** por M210/M610: `num(VL_BC_CONT p[4])>0 && num(VL_CONT_APUR p[11])===0 && ALIQ p[8]>0`
   → apontar "contribuição a calcular (base > 0, valor apurado zerado)".
4. **Severidade/prioridade:** ERRO / prio 1.
5. **v1 cobre?** NÃO.
6. **Deferir:** apontar; recalcular é do Gerar Apuração.

---

## Regra #12 — MSG_CALCULAR_CREDITO (M100/M500) · ERRO · prio 1 · 2 ocorr

1. **O que checa:** há base de crédito (`VL_BC_PIS>0`) mas `VL_CRED=0` — crédito não calculado.
2. **Disparo:** E.
3. **Detecção:** por M100/M500: `num(VL_BC_PIS p[4])>0 && num(VL_CRED p[8])===0 && ALIQ p[5]>0`
   → apontar "crédito a calcular".
4. **Severidade/prioridade:** ERRO / prio 1.
5. **v1 cobre?** NÃO.
6. **Deferir:** apontar; recálculo do crédito é do PVA (parecer: crédito só sobre entrada com direito).

---

## Regra #13 — MSG_DETALHAR_BASE_CALC_CREDITO (M105/M505) · ERRO · prio 1 · 2 ocorr

1. **O que checa:** M100/M500 com crédito exige M105/M505 detalhando a base por NAT_BC_CRED+CST;
   e/ou a soma dos M105 deve bater com M100 (relaciona-se com #9 MSG_VL_BC_PIS_TOT_M105).
2. **Disparo:** E.
3. **Detecção:** (a) se existe M100 com `VL_BC_PIS>0` e **nenhum M105** associado → "detalhar base
   do crédito". (b) opcional cruzamento de soma: `Σ M105.VL_BC_PIS (p[7]) ≈ M100.VL_BC_PIS (p[4])`
   (tolerância 0,01) — divergência = apontar (é o conteúdo da #9). Espelho M505↔M500.
4. **Severidade/prioridade:** ERRO / prio 1.
5. **v1 cobre?** NÃO.
6. **Deferir:** apontar; PVA gera M105.

---

## Regra #18 — MSG_OBRIGATORIO_DESC_CRED (M105 · campo DESC_CRED) · ERRO · prio 1 · 1 ocorr

1. **O que checa:** campo `DESC_CRED` (p[10]) do M105 vazio quando é obrigatório.
   Real vazio: `|M105|13|50|8200,00| |8200,00|8200,00| |0,000| |`. Preenchido: `...|Aquisição de bens para revenda|`.
2. **Disparo:** E (campo).
3. **Detecção:** por M105 (e M505 por simetria): se `!temValor(p[10])` (usar o helper `temValor` já
   existente no v1, mas aqui trata-se de texto — trocar por `String(p[10]||'').trim()===''`) → apontar
   "DESC_CRED obrigatório". Reportar NAT_BC_CRED (p[2]) e CST (p[3]) para localização.
4. **Severidade/prioridade:** ERRO / prio 1.
5. **v1 cobre?** NÃO.
6. **Deferir:** campo textual — apontar; poderia até ser autopreenchível no futuro, mas fora do escopo (parecer: só apontar).

---

## Regra #17 — MSG_GERA_M410_M810 (M410) · AVISO · prio 1 · 1 ocorr

1. **O que checa:** M400 (M800) presente com receita por CST **deve gerar** o detalhamento M410
   (M810) por natureza de receita — e a soma dos M410 deve bater o VL_TOT_REC do M400.
2. **Disparo:** A (advertência/alerta).
3. **Detecção:** para cada M400 com `VL_TOT_REC (p[3])>0`: se não existe M410 associado → apontar
   "deve gerar M410". Adicional: `Σ M410.VL_REC (p[3]) ≈ M400.VL_TOT_REC` por CST (tolerância 0,01).
   Espelho M800→M810.
4. **Severidade/prioridade:** AVISO / prio 1.
5. **v1 cobre?** NÃO.
6. **Deferir:** M410 é saída do Gerar Apuração → apontar para rodá-lo.

---

## Resumo de implementação

| Ordem | Regra | Registros | Condição-gatilho (posições) | Sev |
|---|---|---|---|---|
| 1 | #6 MSG_OBRIGATORIO_M205_M605 | M200/M600 | M200 c/ p[2]>0 ou p[9]>0 sem M205 seguinte | ERRO |
| 2 | #7 MSG_CONTRIBUICAO_NAO_DEVE_EXISTIR | M210/M610 | p[8](ALIQ)==0 && p[11](VL_CONT_APUR)>0 | ERRO |
| 3 | #15 MSG_REGISTRO_OBRIGATORIO | M200/M600 | bloco M c/ dados e porReg.M200.length==0 | ERRO |
| 4 | #11 MSG_CALCULAR_CONTRIBUICAO | M210/M610 | p[4]>0 && p[11]==0 && p[8]>0 | ERRO |
| 5 | #12 MSG_CALCULAR_CREDITO | M100/M500 | p[4]>0 && p[8]==0 && p[5]>0 | ERRO |
| 6 | #13 MSG_DETALHAR_BASE_CALC_CREDITO | M105/M505 | M100 c/ p[4]>0 sem M105; ou Σm105 ≠ m100 | ERRO |
| 7 | #18 MSG_OBRIGATORIO_DESC_CRED | M105/M505 | p[10] textual vazio | ERRO |
| 8 | #17 MSG_GERA_M410_M810 | M410/M810 | M400 p[3]>0 sem M410; ou Σm410 ≠ m400 | AVISO |

**Notas transversais:**
- Todos os apontamentos devem carregar `mensagem_pva` = ID_MENSAGEM oficial (para casar com o relatório do PVA), `registro`, `linha` (índice no arquivo) e `sugestao` = "Rodar Gerar Apuração no PVA" (regras estruturais) ou o campo faltante.
- **Deferir ≠ ignorar:** nenhuma regra deste grupo escreve no .txt; o injetor de contribuições (Fase seguinte) NÃO fabrica M100/M210/etc. O validador só sinaliza para o operador rodar o Gerar Apuração e reimportar.
- Guard-rail de falso-positivo: pular TODAS as regras M se o arquivo não tem bloco M com movimento (0000/IND_MOV ou ausência de M001 com dados) — evita alarmar EFD sem apuração (ex.: só receita monofásica sem débito).
- Reaproveitar helpers do v1: `temValor`, sets `CST_ZERO`. Adicionar `num()` decimal e o índice `porReg`.
