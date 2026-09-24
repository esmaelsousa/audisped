# Pendências — controle de erros encontrados e sanados

Checklist vivo. Cada item traz **onde foi encontrado**, **quando**, e **quando foi sanado**.
Itens abertos ficam no topo. Ao fechar um, marque o `[x]` e preencha a data de sanado.

> Backlog anterior a setembro/2026 continua em `MEMORY.md` (seção "Planos pendentes") — este
> documento cobre o que foi levantado a partir da auditoria de 15/09/2026.

---

## 🔴 Abertos — bloqueiam entrega ou risco fiscal

- [ ] **PVA rejeita o CEST `0300100` (água mineral) — causa ainda desconhecida**
  `encontrado: 15/09/2026` · `sanado: —`
  Eu havia levantado a hipótese de **revogação**. A tabela oficial importada em 24/09 **desmente**:
  `03.001.00` está vigente desde 2018, sem data fim. Então a rejeição do PVA tem outra causa —
  provavelmente o par CEST×NCM ou CEST×descrição (água em garrafa de vidro ≠ embalagem de 20 L são
  CESTs diferentes dentro do segmento 03). A planilha não traz NCM, então essa carta não resolve.
  *Caso: POSTO PREÇO BOM, produto 3154599 AGUA MINERAL 20 L.*

- [ ] **`sincronizarNotasInjetadas` grava dado inválido (a FONTE do lixo)**
  `encontrado: 15/09/2026` · `sanado: —`
  Regrava o C170 a partir do XML do fornecedor mesmo em notas que já existem no `.txt`, gravando
  CSOSN no campo do CST e virando o 1º dígito da CFOP de saída sem mapear (`5929` → `1929`).
  O guard `_bancoContaminadoXml` (deployado 15/09) impede que isso chegue ao SPED exportado, mas
  **não corrige a origem** — cada novo sync de XML de fornecedor do Simples volta a produzir.

- [ ] **Linhas contaminadas já gravadas no banco**
  `encontrado: 15/09/2026` · `sanado: —`
  99 itens em 22 arquivos de 8 postos com CSOSN no `cst_icms` ou CFOP inexistente.
  Inofensivas hoje (o guard as descarta no export), mas seguem no `documentos_itens_c170` e
  contaminam análises internas.
  *CNPJs: 29922687000102, 04287217000185, 29494716000174, 50922123000158, 39496670000267,
  14018702000107, 22682761000103, 40658326000125.*

- [ ] **Fev/2026 do POSTO PREÇO BOM gerado com a opção errada**
  `encontrado: 23/09/2026` · `sanado: —`
  Arquivo `..._022026_v1_221_...` traz 27.671 C170 debaixo de C100 modelo 65 — o PVA rejeita
  (NFC-e escritura-se consolidada). Jan/2026 foi regerado e saiu limpo; fev ainda não.
  **Ação:** regerar no AutoSystem com a mesma opção usada em janeiro.
  *Não é bug nosso — é opção de exportação do ERP. Não é a versão: dez/2025 também é `v1_221` e
  está limpo.*

- [ ] **Reconciliar `main` com produção**
  `encontrado: 24/09/2026` · `sanado: parcial`
  `main` estava 55 commits atrás e com 11 commits próprios. Análise concluída:
  - 4 commits já tinham patch equivalente na branch (`git cherry`)
  - 6 tinham o conteúdo presente, aplicados como hot-patch sem commit
  - 1 genuinamente ausente (`e1b5d0d`, timeout de upload) → **portado em 24/09** (`86b0f35`)
  **Falta:** abrir o PR de `fix/chaves-duplicadas-e-leiaute-020` para `main` e resolver os
  conflitos com produção como árbitro. Enquanto não mergear, um `docker build` a partir do `main`
  apaga o que está rodando — foi o que apagou o Leads em julho/2026.

---

## 🟡 Abertos — incômodos, sem risco fiscal

- [ ] **Tela de Rentabilidade mostra número diferente do PDF**
  `encontrado: 23/09/2026` · `sanado: —`
  A rota `/pdf` sobrescreve o estoque final pelo `encerrantes_exportados`; a rota JSON que alimenta
  a tela não tem esse trecho e ainda usa outros nomes de campo (`estoque_final` × `final`).
  GASOLINA COMUM jan/2026: PDF 9.347,09 (correto, = SPED) × tela 9.128,93. **218,16 L.**

- [ ] **Encerrantes gravados em duplicidade no nov/2024**
  `encontrado: 15/09/2026` · `sanado: —`
  `encerrantes_bicos_exportados` tem o mesmo bico com duas formatações e valores distintos:
  `2` = 53.606,313 e `02` = 60.197,802. Falta normalizar a chave.
  *CNPJ 31422650000159.*

- [ ] **PDF de Posição do Estoque sem formatação pt-BR**
  `encontrado: 23/09/2026` · `sanado: —`
  Imprime `23670.01` em vez de `23.670,01`. Comportamento antigo, não introduzido agora.

- [ ] **6 registros órfãos de arquivo respondem 404**
  `encontrado: 23/09/2026` · `sanado: —`
  Arquivos 67, 68, 99, 100, 135, 138 (POSTO PREÇO BOM) com `id_empresa = null`, sem arquivo físico
  e sem produtos. O `JOIN empresas` não casa e toda rota que depende dele devolve 404.

---

## 🔴 Abertos — bloqueiam entrega ou risco fiscal

- [ ] **Deploy das tabelas CFOP/CEST e das 2 regras novas**
  `encontrado: 24/09/2026` · `sanado: —`
  Migração + `DOC-C170-CFOP-01` (existência/grupo) + `DOC-0200-CEST-02` (vigência) estão **só no
  localhost**. Produção segue com `cad_cfops` de 8 linhas e sem vigência de CEST.
  Exige rodar migração em banco de produção → precisa do seu OK.

- [ ] **Regra de DIREÇÃO do CFOP (saída em documento de entrada)**
  `encontrado: 24/09/2026` · `sanado: —`
  A tabela agora traz o tipo E/S. A medição achou **8 ocorrências** (`1102` num documento de
  saída, NF 14705). Eu quis olhar caso a caso antes de escrever a regra — é a mais larga das três
  e a de maior risco de falso-positivo.

- [ ] **Estoque de abertura NEGATIVO no LMC (−1,2 milhão de litros)**
  `encontrado: 24/09/2026` · `sanado: —`
  POSTO ÓRION (23079512000190) jul/2026: `|1300|1|01072026|-1277063,559|…`. Não é volume de
  tanque — parece contador acumulado escriturado com sinal trocado. **Anterior à migração de
  sistema**, então a cadeia já estava quebrada. Invalida o fechamento de julho como âncora.
  **Ação:** auditar os 10 meses (dez/2025 a ago/2026) dos dois postos e achar onde começou.

## ⏸️ Bloqueado por insumo de terceiro

- [ ] **Reconstruir o bloco 1 de ago/2026 — PIRAÍ e ÓRION (migração de sistema)**
  `encontrado: 24/09/2026` · `sanado: —`
  Os postos migraram de ERP; o sistema novo não exporta 1300/1310/1320. Sete meses anteriores
  tinham LMC completo. Diagnóstico: **o LMC nunca veio do bloco C** — era gerado dos
  **encerrantes das bombas**. Em julho o C190 já era consolidado (4 C170) e mesmo assim o 1300
  existia. Logo, não há como derivar das notas.
  Agosto entrega só: chave, data e valor (Piraí R$ 56.132 / Órion R$ 398.437 em CFOP 5405 único).
  **Falta:** litros por produto por dia. Qualquer uma destas resolve —
  (a) XMLs das NFC-e de agosto (8.030 chaves disponíveis nos arquivos; zero XMLs no nosso banco),
  (b) leitura dos encerrantes de agosto, (c) relatório de vendas por produto do sistema novo.
  Existe `PLANO_RECONSTRUCAO_LMC.md` pronto (Fonte A) — só falta o insumo.

- [ ] **Injeção dos XMLs de saída do POSTO PEDRO GÁS (03/2025)**
  `encontrado: 17/09/2026` · `sanado: —`
  3.788 NFC-e autorizadas (59.067,482 L, R$ 399.776,88) para um SPED cujo bloco C está vazio e o
  LMC está zerado. Conjunto validado como **completo**: 15,6 L/nota contra 16,6 L/nota de
  fevereiro, e o mapeamento bico→produto bate registro a registro com o 1370.
  **Travas:**
  1. Faltam as **entradas** (~48.000 L). Injetando só as saídas, 4 dos 5 tanques ficam negativos
     (GASOLINA COMUM −21.936 L). *Esmael vai buscar os XMLs.*
  2. Falta a **âncora dos encerrantes** em 01/03/2025. O mais recente no sistema é nov/2024.
     *Decidido usar o fechamento do SPED de fev/2025.*
  E110 zerado está **correto** (CST 60/61 + PIS/COFINS 04, `vICMS = 0,00` — monofásico).

---

## ✅ Sanados

- [x] **Tabelas oficiais de CFOP e CEST ausentes do banco**
  `encontrado: 15/09/2026` · `sanado: 24/09/2026` · `commit: 9dbd52d`
  `cad_cfops` tinha **8 linhas** feitas à mão, uma delas errada (`5405` marcado como entrada,
  sendo saída) → **686** oficiais com tipo E/S. `cest` ganhou vigência mantendo o `ncm_prefix`
  (mescla, não substituição) → 1.054 códigos.
  Achado de quebra: o CEST `1708704`, citado no comentário da nossa regra como exemplo de "não
  localizado", **é oficial** — só faltava na nossa tabela. Vínhamos gerando ADV indevida nele.

- [x] **CFOP inexistente passava na validação**
  `encontrado: 15/09/2026` · `sanado: 24/09/2026` · `commit: d412fdd`
  `DOC-C170-CFOP-01` só validava FORMATO, e o `1929` (4 dígitos, começa em 1) passava. Agora checa
  existência e cabeçalho de grupo, com mensagens separadas. Sem tabela carregada, degrada para só
  o formato.

- [x] **CEST revogado usado em competência posterior era invisível**
  `encontrado: 24/09/2026` · `sanado: 24/09/2026` · `commit: d412fdd`
  Regra nova `DOC-0200-CEST-02` (ADV). Medido na frota: 27 ocorrências em 3 códigos, todas com
  cara de erro real. **Bug que o teste não pegou:** `pg` devolve DATE como objeto `Date` e
  `String(d).slice(0,10)` virava `"Sat Dec 31"` — a regra nunca disparava, em silêncio. O teste
  passava porque eu montara o Map com strings. Extraído `isoData()` com teste próprio.


- [x] **C190 órfão: export reescrevia o C170 sem realinhar o analítico**
  `encontrado: 15/09/2026` · `sanado: 15/09/2026` (prod) · `commit: 4a56830`
  `realinharC190ComC170`. Arq 2521: 21 erros do PVA → 0.

- [x] **Contaminação por XML de fornecedor do Simples**
  `encontrado: 15/09/2026` · `sanado: 15/09/2026` (prod) · `commit: 4a56830`
  `_bancoContaminadoXml` descarta CSOSN inequívoco e CFOP inexistente. 99 itens, 8 postos.
  Lição: **o sinal confiável é o CST, não a CFOP** — CSOSN 500 aparece com CFOP válida.

- [x] **Dedup de C100 não abatia o ICMS do E110**
  `encontrado: 15/09/2026` · `sanado: 15/09/2026` (prod) · `commit: 4a56830`
  Arq 2350: 52 duplicados carregando exatamente 48,99. Afetava 21 arquivos.
  Decisão do Esmael ciente de que **reduz o ICMS a recolher**.

- [x] **Validador cego para C170 sem C190 (direção inversa)**
  `encontrado: 15/09/2026` · `sanado: 15/09/2026` (prod) · `commit: 4a56830`
  13 dos 21 erros de um relatório do PVA eram desse lado. Regra `DOC-C170-C190-01`.

- [x] **Correção vazando entre notas gêmeas (`val_correcoes`)**
  `encontrado: 22/09/2026` · `sanado: 22/09/2026` · `commit: 4a56830`
  `ordinalChaveC100`. A correção do item da entrada zerava a alíquota do item da SAÍDA, que era
  tributado. De quebra fechou o buraco da chave `#2` em notas sem chave de acesso.

- [x] **Colisão de chave nos mapas do export (`chaveDocC100`)**
  `encontrado: 22/09/2026` · `sanado: 22/09/2026` · `commit: 4a56830`
  `num_doc + chv_nfe` não identificam um documento — a nota é escriturada duas vezes (saída 5949 +
  entrada espelho 1949). Arq 2186: 48 bloqueantes → 0.

- [x] **PDF de estoque podia divergir do SPED sem avisar**
  `encontrado: 23/09/2026` · `sanado: 23/09/2026` · `commit: 4a56830`
  Sem `encerrantes_exportados` o PDF caía no `lmc_movimentacao`. Agora: ou tem lastro, ou 409.
  Reversível por `PDF_ESTOQUE_EXIGIR_LASTRO=false`.

- [x] **Nome do PDF com o mês errado**
  `encontrado: 23/09/2026` · `sanado: 23/09/2026` · `commit: 38f0a41`
  Um PDF de julho baixava como `..._2026-01.pdf`. O backend já mandava o nome certo; faltava expor
  o `Content-Disposition` no CORS e o frontend ler.

- [x] **Leiaute 018 não era transmutado para 020**
  `encontrado: 24/09/2026` · `sanado: 24/09/2026` · `commit: 4a56830`
  A condição testava `=== '019'`. POSTO PIRAÍ II 08/2026 → 156 erros no PVA.
  `versaoAlvoLeiaute` compara por ordem. **Validado no PVA pelo Esmael.**

- [x] **Produção rodando hot-patch fora do git**
  `encontrado: 15/09/2026` · `sanado: 24/09/2026`
  Cinco correções viviam só dentro do container. Agora em commits e no GitHub.
  Descoberto no processo: prod tinha 2 assuntos **inline** que na branch já eram módulos
  (`services/export/` não existia) — subir só o `server.js` teria quebrado o export.

---

## Como este documento é mantido

Atualizar ao **encontrar** (novo item, data de encontrado) e ao **sanar** (marcar, data, commit).
O que estiver aqui não depende de memória de sessão.
