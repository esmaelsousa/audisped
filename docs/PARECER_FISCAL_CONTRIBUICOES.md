# Parecer Fiscal — Injetor/Validador EFD-Contribuições (PIS/COFINS)

> **Para quem:** o contador de registro do cliente.
> **O que é:** roteiro de dúvidas a confirmar + checklist para extrair o *de-para* de
> classificação (NCM/produto → CST PIS/COFINS) do **histórico do próprio cliente**.
> **O que NÃO é:** um conjunto de respostas fiscais impostas pelo sistema. A verdade final
> da classificação é do contador, por empresa. O sistema **espelha e confere consistência**,
> não decide o enquadramento.
> **Origem:** auditoria de 6 agentes especialistas PIS/COFINS sobre o arquivo real da CASA DA
> BEBIDA (05/2026) e o plano do módulo. Data: 2026-07-18.

---

## 1. Princípio adotado (por segurança do cliente)

O sistema **não** deriva o CST de uma tabela NCM "nacional" genérica. Ele usa um **de-para por
cliente**, alimentado pela forma como **este cliente já escriturou** em períodos anteriores
(EFD-Contribuições passadas + ECD). Motivo: na fiscalização, o que atrai malha é a
**inconsistência** entre períodos e entre obrigações (EFD × ECD × ECF) — não a escolha teórica
de um código. **Consistência com o histórico do cliente > regra de livro.**

O default do sistema é **conservador**: produto sem classificação confiável → **não credita e
não fabrica débito**; marca o item para revisão do contador.

---

## 2. Achado crítico (precisa de ciência)

O arquivo `..._INJETADO.txt` (correção manual anterior) **passou no PVA com 0 erros, mas está
fiscalmente incorreto**:
- Reclassificou **vinho/licor de CST 01 → 06** (subtributação: vinho/destilado **não** são do
  regime monofásico de bebidas frias — são tributação integral).
- Usou **CST 06** na cerveja, onde o tecnicamente aplicável à revenda monofásica seria **CST 04**.

**Lição:** *"0 erro no PVA" valida estrutura, não materialidade.* O PVA aceita CST×base
coerentes; ele **não** verifica se o CST é o correto para o produto. Por isso o critério de
aceite passa a ser **0 erro no PVA + conferência da materialidade por NCM revisada pelo contador**.

---

## 3. Perguntas para o contador confirmar (por empresa)

| # | Questão | Contexto legal | Precisamos de |
|---|---|---|---|
| Q1 | **Bebidas frias (cerveja 2203, refrigerante 2202, água 2201):** na revenda deste cliente, a saída é **alíquota zero (CST 06/04)** ou **tributada (CST 01/02)**? E a entrada **gera crédito**? | Lei 13.097/2015 (arts. 14-39) revogou o regime monofásico das bebidas frias e instituiu incidência por etapa; o tratamento do **varejo** varia por produto/elo. O cliente usou **CST 06** na cerveja. | Confirmar o CST de **saída** e se **credita na entrada**, por família (cerveja/refri/água). |
| Q2 | **Combustíveis (posto):** confirmar CST de saída da revenda = **04** (Revenda Monofásica a Alíq. Zero) e **entrada sem crédito** (CST 70). | Lei 9.718/98 arts. 4-6; Lei 10.865/04 art. 42. Monofásico pacífico. | Confirmação (esperado: 04 saída / 70 entrada). |
| Q3 | **Vinho, espumante, vermute, destilado, licor (2204-2208):** confirmar **tributação normal** (saída CST 01 com base; entrada CST 50 com crédito, no não-cumulativo). | Fora do rol de bebidas frias da Lei 13.097/2015; Lei 10.637/02 e 10.833/03 (1,65% / 7,6%). | Confirmação + **alíquotas** aplicáveis. |
| Q3a | **Base de cálculo da saída tributada:** BC = (VL_ITEM − desconto). **Excluir o ICMS da base** (STF RE 574.706)? | RE 574.706 ("tese do século"). Decisão do cliente/contador. | Sim/Não excluir ICMS da BC (flag por empresa; default = não excluir). |
| Q4 | **Registro 0500 / COD_CTA:** este cliente **mantém escrituração contábil (ECD)**? Se sim, qual **conta real** usar (a mesma do I050 da ECD)? | Se **lucro presumido em livro-caixa**, o COD_CTA **não é obrigatório** — o correto é **deixar em branco**, não inventar conta. | Regime contábil + conta(s) real(is) do plano de contas. |
| Q5 | **Crédito de entrada (não-cumulativo):** para quais **NCM/CFOP** este cliente **tem direito a crédito** de PIS/COFINS? | Rol taxativo (Lei 10.637/02 e 10.833/03 art. 3º); **vedação** de crédito na aquisição de monofásico/ST para revenda (art. 3º §2º II; Lei 10.865/04 art. 24). | Lista de itens/CFOP creditáveis (o resto = sem crédito). |

---

## 4. Checklist — extrair o *de-para* do histórico do cliente

Para popular o de-para com segurança (e consistência), levantar dos **arquivos que o cliente já
transmitiu**:

- [ ] **Últimas 3-6 EFD-Contribuições** transmitidas → mapear, por **COD_ITEM/NCM**, qual
  **CST_PIS/CST_COFINS** de saída e de entrada o cliente usou (a fonte mais confiável).
- [ ] **ECD (registro I050)** → plano de contas real, para casar o **COD_CTA** (elimina o placeholder).
- [ ] **NCM verdadeira dos produtos** → do **XML das NF-e** (o campo NCM do SPED do ERP HIPER vem
  como `00`; não confiar nele).
- [ ] **Alíquotas** de PIS/COFINS por produto (regime cumulativo × não-cumulativo).
- [ ] Confirmar o **regime** (registro 0110) e se há **crédito** efetivamente apropriado.

---

## 5. Regras que o sistema já aplica (as pacíficas) + guardrails

**Classificação (as duas lentes do painel concordam):**
- Combustível (2710/2711) = monofásico → saída **CST 04**, entrada **CST 70 (sem crédito)**.
- Vinho/vermute/espumante/destilado/licor (2204-2208) = normal → saída **CST 01 (com base)**,
  entrada **CST 50 (crédito)**.
- **Bebidas frias (2201-2203) e todo NCM não confirmado = INDEFINIDO** → sistema **não crava**;
  aguarda Q1/de-para do contador.

**Guardrails inegociáveis (o sistema impõe):**
- Nunca transmitir com **COD_CTA placeholder** (export em 2 níveis: conferência × transmissão;
  transmissão **travada** até conta real).
- Nunca **creditar** compra de produto monofásico/ST para revenda.
- Nunca usar a **alíquota de ICMS** (f14 do C170, ex.: 27%) como alíquota de PIS/COFINS.
- **M200/M600 = 0,00** só é estado final quando não há item de débito (saída 01/02/03) nem de
  crédito (entrada 50-56); havendo, obrigar **"Gerar Apuração"** no PVA.
- **Trilha** de toda reclassificação (de X para Y e por quê) para o contador revisar/assinar.

---

## 6. Base legal citada (para conferência)

- **Não-cumulatividade / alíquotas 1,65% e 7,6%:** Lei 10.637/2002; Lei 10.833/2003.
- **Vedação de crédito (monofásico/ST na revenda):** Lei 10.833/2003 art. 3º §2º II; Lei
  10.637/2002 art. 3º §2º II; Lei 10.865/2004 art. 24; IN RFB 2.121/2022.
- **Combustíveis (monofásico/concentração):** Lei 9.718/1998 arts. 4-6; Lei 10.865/2004 art. 42;
  Lei 11.116/2005 (biodiesel/álcool).
- **Bebidas frias (novo regime pós-2015):** Lei 13.097/2015 arts. 14-39; Decreto 8.442/2015.
- **Tabela oficial de CST PIS/COFINS:** IN RFB 2.121/2022 (04 = revenda monofásica alíq. zero;
  06 = alíq. zero; 01 = alíq. básica; 50-56 = com crédito; 70-75 = sem crédito).
- **ICMS fora da base:** STF RE 574.706 (aplicação a critério do contador do cliente).
- **EFD-Contribuições (multa por informação inexata):** art. 57, III, MP 2.158-35/2001 (red. Lei
  12.766/2012). **Multa de ofício por crédito indevido/débito a menor:** Lei 9.430/1996 art. 44.
- **ECD (plano de contas I050):** IN RFB 2.003/2021.

> ⚠️ Parecer técnico de apoio, gerado por análise assistida. **Não substitui** a validação e a
> assinatura do contador de registro, a quem cabe a responsabilidade pela escrituração.
