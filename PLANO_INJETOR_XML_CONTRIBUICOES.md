# Plano — Injetor de XML (entrada e saída) no EFD-Contribuições (v2, corrigido)

> Este documento **substitui/corrige** o `PLANO_CONTRIBUICOES.md` (v1). Mantém o princípio de
> intocabilidade dele, mas conserta **lacunas críticas** descobertas (a) na correção manual real dos
> **94 erros do PVA** no arquivo da CASA DA BEBIDA (CNPJ 07520999000149, 05/2026) e (b) numa análise
> **bloco a bloco** por 6 agentes (orquestra) sobre os 3 arquivos reais + o injetor Fiscal.
> **Nada foi alterado no sistema — isto é só o plano.**

---

## 0. Princípio (mantido da v1)
Tudo novo em **arquivos/tabelas NOVOS**. Existentes só recebem ADIÇÕES pontuais. O injetor Fiscal
(`xmlInjectorService.js`, `spedCostureiraService.js`, `cteInjectorService.js`) e as tabelas
`documentos_*` permanecem **INTOCÁVEIS** — reaproveitamos **por cópia**, não in-place.

---

## 1. Descobertas-chave (o que muda em relação à v1)

| # | Descoberta (verificada nos arquivos reais) | Impacto |
|---|---|---|
| D1 | **C100 (29 campos) e C170 (38 campos) do Contribuições são byte-idênticos em layout ao do Fiscal**; o builder `c100LineFields`/`c170Fields` do `xmlInjectorService.js` (linhas ~539-568 e ~433-468) **já monta os 38 campos com PIS/COFINS**. | Reuso ALTO na geração de documentos. |
| D2 | **NÃO existe C190 no Contribuições** (é do Fiscal). E este perfil de ERP (HIPER) **não usa C180/C181/C185/C195** — é analítico direto C170→Bloco M. | Desligar o agregador C190; **remover C195 do escopo** (o plano v1 errou ao listá-lo). |
| D3 | **O ERP exporta SEM camada contábil**: sem registro **0500** e sem **COD_CTA** nos C170 (campo 37) e nos M400/M410/M800/M810 (campo 4). → **74 dos 94 erros**. | **Gap crítico da v1** (nem menciona). Tem de ser GERADO. |
| D4 | **Bloco M NÃO é "raw preservado"**: ao injetar, M400/M410/M800/M810 (Σ VL_ITEM dos C170 com CST 06) mudam (22.128,51 → 22.930,56) e M200/M600 com campo vazio **reprovam antes do Gerar Apuração**. | **Gap crítico da v1** ("PVA recalcula" não basta). Recalcular o M. |
| D5 | **Coerência CST × base**: itens CST_PIS/COFINS 01-05/50-56 exigem VL_BC+ALIQ+VL; 06-09 = zerados. 4 itens CST 01 sem base = **16 erros**. | Saneamento de CST antes de somar. |
| D6 | **0000 (14 campos, COD_VER 006) e 0200 (11 campos) do Contribuições têm layout DIFERENTE do Fiscal** (0000=15 campos/COD_VER 018; 0200=12 campos com ALIQ_ICMS). | Geradores próprios; **não** reusar os do Fiscal cegamente. |
| D7 | **Armadilha do registro inédito**: adicionar o 0500 cria uma **nova linha `\|9900\|0500\|1\|`** → +2 no 9999 (0500 + a 9900) e +1 no 9990/`\|9900\|9900\|`. A costureira Fiscal só cobre blocos 0/C/D/E/G/H/1/9 — **falta A/F/M/P**. | Estender o recálculo de fechamentos; regerar Bloco 9 por último. |
| D8 | **Regime importa** (registro 0110): cumulativo (sem M100/M105/M500/M505) × não-cumulativo (com crédito sobre entradas). O arquivo-teste é majoritariamente CST 06 (alíquota zero). | Motor **regime-aware**. |
| D9 | Encoding **latin1** (acentos em 0190/0400, ex.: "PEÇA", "SUBSTITUIÇÃO"). | Ler/gravar preservando bytes; não re-encodar. |

---

## 2. Decisão arquitetural central — **a pergunta que preciso te confirmar**

**Como tratar o Bloco M (apuração)?** Consenso dos agentes = **abordagem híbrida (recomendada):**

- **O injetor recalcula a parte SEGURA e determinística** (sem inventar imposto):
  - M400/M410/M800/M810 `VL_TOT_REC` = **Σ VL_ITEM dos C170 com CST 06** (PIS→M400, COFINS→M800);
  - **COD_CTA** nos M (campo 4) e **normaliza vazios → `0,00`** em M200/M600.
  - Isso faz o arquivo **importar** no PVA e é byte-correto p/ revenda monofásica/alíquota zero.
- **O que envolve apuração com débito/crédito real** (M210/M610 de venda tributada; M100/M105/M500/M505
  de crédito de entrada não-cumulativa) **NÃO é fabricado** — o usuário roda **"Gerar Apuração" no PVA**,
  que recomputa o Bloco M a partir dos documentos. O plano deixa isso **explícito** (a v1 não deixava).

> Ou seja: MVP = receita CST 06 (caso CASA DA BEBIDA) sai 100% pronto. Casos com débito/crédito saem
> "importáveis" e o PVA fecha a apuração. **Confirme se aceita esse corte** (alternativa: computar M210/
> M610/M100/M500 também — bem mais complexo e arriscado fiscalmente; não recomendo no MVP).

---

## 3. Arquitetura — reuso vs novo

### Reaproveitável do Fiscal (por CÓPIA para o módulo novo)
- `extractNfeData` (parse do XML) — **já extrai PIS/COFINS por item** (cst_pis, vbc_pis, ppis, vpis, cst_cofins, vbc_cofins, pcofins, vcofins). Nenhuma mudança no parser.
- `validarXmls` / `parsePeriodoSped` / `dataForaPeriodo` / `limparCnpjStr` — validação CNPJ × período. **AS-IS.**
- Builders `c100LineFields` (29 campos) e `c170Fields` (38 campos) — **layout idêntico**; só **ligar COD_NAT (f12) e COD_CTA (f37)** e **desligar o agregador C190**.
- Dedup por `chv_nfe` (chavesExistentes / pularDuplicados / forceReplace). **AS-IS.**
- Padrão de Maps de Bloco 0 (`map0150`/`map0190`/`map0200`) e merge raw+gerado.
- `salvarNfeCompleta` (XML cru p/ viewer). **AS-IS.**
- Padrão de `recalcularAssinaturasBlocos` (9900/9990/9999 + inserção de 9900 inédito) — **estender** para A/F/M/P.

### 100% novo — `backend/services/spedContribuicoesService.js`
- `parseContribuicoes(txt)` — parser (C170 38 campos; blocos 0/A/C/D/F/M/P/1/9).
- `gerador0000Contrib` / `gerador0200Contrib` — layouts próprios (D6).
- `garantir0500(linhas, empresa)` — injeta 1 conta contábil placeholder (`COD_CTA` configurável, default `"1"`) quando ausente.
- `aplicarCodCta(linhas, codCta)` — carimba COD_CTA em **todo C170 (f37)** e nos **M400/M410/M800/M810 (f4)** vazios.
- `sanearCstPisCofins(linhas, regime)` — coerência CST × base (D5): 06-09 zerados; 01-05/50-56 com BC/ALIQ/VL (do XML/de-para) ou reclassificação confirmada.
- `recalcularBlocoM(linhas, regime)` — M400/M410/M800/M810 = Σ VL_ITEM por CST 06; normaliza M200/M600 → 0,00 (Seção 2).
- `recalcularFechamentosContrib(linhas)` — X990 de **0/A/C/D/F/M/P/1** + Bloco 9 (9900 por registro, 9990, 9999) regerado **por último**, tratando a armadilha D7.
- `injetar()` / `exportar()` — pipeline (copiado do Fiscal) que costura tudo na ordem **0,A,C,D,F,M,P,1,9**.

### Tabelas novas (prefixo `efd_contrib_`, nunca conflita)
- `efd_contrib_arquivos` (id, id_empresa, competencia, **regime** lido do 0110, path, dt_upload)
- `efd_contrib_blocos_raw` (blocos preservados: 0,A,D,F,P,1 como texto)
- `efd_contrib_c100`, `efd_contrib_c170` (com PIS/COFINS + cod_nat + cod_cta)
- `efd_contrib_plano_contas` (id_empresa, cod_cta, nome, **conta real configurável** vs placeholder)

> ⚠️ **Correção da Fase 0 da v1:** a v1 propunha adicionar colunas PIS/COFINS em `documentos_itens_c170`
> (tabela do Fiscal) — **contradiz a própria regra de intocabilidade** e é desnecessário (o XML é lido na
> hora). Persistir em `efd_contrib_c170`, **não** alterar a tabela Fiscal.

---

## 4. Especificação bloco a bloco (resumo das specs dos agentes)

### Bloco 0 (cadastros)
- **Raw preservado:** 0000, 0001, 0100, 0110, 0140, 0400 (preservar bytes — D9).
- **Merge (raw + gerado/dedup):** 0150 (por CNPJ), 0190 (por UNID), 0200 (por COD_ITEM — dedup obrigatório).
- **Gerado/garantido:** **0500** → `|0500|<DT_INI>|04|A|1|1|CONTA CONTABIL GENERICA (PLACEHOLDER - REVISAR)|||` (COD_NAT_CC=04, IND_CTA=A obrigatórios).
- Garantir 0400 para qualquer COD_NAT novo que um C170 referencie.

### Bloco C (documentos) — núcleo
- **C100** por nota (reuso ~100% do builder Fiscal). **C170** por item (38 campos) preenchendo **COD_NAT (f12)** e **COD_CTA (f37)**; **sem C190**.
- CST PIS/COFINS do `de_para_xml` (cst_pis/cst_cofins) com fallback do XML; valores BC/ALIQ/VL do XML.
- Posições críticas: f7=VL_ITEM, f10=CST_ICMS, f11=CFOP, f12=COD_NAT, f25=CST_PIS, f26=VL_BC_PIS, f27=ALIQ_PIS, f30=VL_PIS, f31=CST_COFINS, f36=VL_COFINS, **f37=COD_CTA**, f38=VL_ABAT_NT.
- **Entrada (ind_oper=0) vs saída (ind_oper=1):** o fluxo Fiscal é focado em entrada; aqui há **saídas próprias** (33 de 38 no real) que alimentam M400. Cobrir os dois.

### Bloco M (apuração) — ver Seção 2
- Recalcular M400/M410/M800/M810 (Σ CST06) + COD_CTA; normalizar M200/M600 → 0,00; recontar M990.
- M210/M610/M100/M500 → **deferir ao "Gerar Apuração" do PVA** (não fabricar).

### Blocos A / D / F / P / 1
- **Raw preservado** (A001/A990, F001/F990, 1001/1990, P se houver). Recontar X990 só se o bloco mudar de tamanho.
- **Bloco D (CT-e):** se injetar D100, inserir D010, virar D001 IND_MOV→0, recontar D990, e **COD_CTA no D100** (o `cteInjectorService` grava vazio hoje).

### Bloco 9 (controle) — **última etapa do export**
- Regerar inteiro: 9001 + uma `9900` por tipo de registro (com a contagem real, **incluindo `\|9900\|0500\|`**) + 9990 + 9999.
- `9990` conta **todas** as linhas que começam com `9` (inclui o próprio 9999). `|9900|9900|` é auto-referente (ponto-fixo → regerar, não fazer patch).

---

## 5. Os 94 erros do PVA → como o injetor os previne (rastreabilidade)

| Erro real (qtd) | Causa | Prevenção no injetor |
|---|---|---|
| COD_CTA obrigatório (74) | sem 0500 / COD_CTA | `garantir0500` + `aplicarCodCta` (C170 f37 + M f4) |
| CST 01 sem base/alíquota (16) | tributado sem BC/ALIQ | `sanearCstPisCofins` (preenche ou reclassifica c/ confirmação) |
| M200/M600 campo vazio (2) | numérico em branco | `recalcularBlocoM` normaliza → `0,00` |
| (recorrente) "linhas do bloco não conferem" | X990/9900 defasados | `recalcularFechamentosContrib` (estende A/F/M/P) |

---

## 6. Fases de entrega (revisadas)

| Fase | Escopo | Observação |
|---|---|---|
| **1. Parser + upload** | `spedContribuicoesService.parseContribuicoes` + `POST /api/contribuicoes/upload` (grava blocos + lê **regime** do 0110) | tabelas `efd_contrib_*` |
| **2. Gerador de documentos** | C100/C170 (reuso Fiscal) + 0150/0190/0200 merge + **0500/COD_CTA** + COD_NAT | sem C190/C195 |
| **3. Apuração segura + saneamento** | `recalcularBlocoM` (Σ CST06, M200/M600→0,00) + `sanearCstPisCofins` | débito/crédito → PVA |
| **4. Costura + export** | `recalcularFechamentosContrib` (A/F/M/P + Bloco 9) + ordem 0,A,C,D,F,M,P,1,9 + `GET /api/contribuicoes/exportar/:id` | arnês golden (byte-idêntico se nada injetado) |
| **5. Frontend** | `InjetorContribuicoesView.vue` (upload → preview entrada/saída → injetar+exportar) + rota + link | 1 rota nova |

Cada fase com **gate de validação no PVA** sobre o arquivo real da CASA DA BEBIDA (esperado: 0 erros).

---

## 7. Pontos a confirmar com você (antes de implementar)

1. **Estratégia do Bloco M** (Seção 2): aceita o híbrido (recalcula CST 06 + defere débito/crédito ao "Gerar Apuração")? Ou quer que o injetor compute toda a apuração?
2. **Conta contábil (0500):** placeholder genérico configurável por empresa está ok (você aponta a conta real depois), ou já quer um cadastro de plano de contas por empresa na Fase 1?
3. **Escopo de regime:** começo só pelo **cumulativo/alíquota-zero** (caso atual) e trato **não-cumulativo (crédito de entrada)** numa fase posterior?
4. **CST 01 (tributado):** quando o XML não traz base, a regra é **calcular BC=VL_ITEM** ou **reclassificar** (como fizemos manualmente para 06)? Precisa ser por de-para.

---

## 8. Riscos
- **Apuração com débito/crédito** fabricada incorretamente → risco fiscal. Mitigação: deferir ao PVA (Seção 2).
- **Layouts divergentes** (0000/0200) → registro inválido. Mitigação: geradores próprios + golden test.
- **Conta contábil placeholder** num arquivo oficial → mitigação: nome "REVISAR" + cadastro de conta real por empresa.
- **Reuso por cópia** duplica código do Fiscal → manutenção. Mitigação: extrair utils comuns (parse XML) p/ módulo compartilhado, sem tocar no Fiscal.
