# Pendências — controle de erros encontrados e sanados

Checklist vivo. Cada item traz **onde foi encontrado**, **quando**, e **quando foi sanado**.
Itens abertos ficam no topo. Ao fechar um, marque o `[x]` e preencha a data de sanado.

> Backlog anterior a setembro/2026 continua em `MEMORY.md` (seção "Planos pendentes") — este
> documento cobre o que foi levantado a partir da auditoria de 15/09/2026.

---

## 🔴 Abertos — bloqueiam entrega ou risco fiscal

- [ ] **Tabela CEST desatualizada**
  `encontrado: 15/09/2026` · `sanado: —`
  Nossa tabela (1.370 registros) considera o CEST `0300100` válido para NCM `22011000`; o PVA
  rejeita. A regra `DOC-0200-CEST-01` não acusa porque valida contra a nossa tabela.
  **Trava:** preciso da tabela CEST vigente (o PVA exporta, ou o Confaz publica). Não reconstruo de
  memória — errar um código gera erro em massa na frota.
  *Caso: POSTO PREÇO BOM, produto 3154599 AGUA MINERAL 20 L.*

- [ ] **CFOP inexistente passa na validação**
  `encontrado: 15/09/2026` · `sanado: —`
  `DOC-C170-CFOP-01` valida só o FORMATO (`/^[123567]\d{3}$/`). O CFOP `1929` tem 4 dígitos e
  começa com 1, então passa — mas não existe na tabela.
  **Trava:** preciso da tabela CFOP oficial. Mesmo motivo do item acima.

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

## ⏸️ Bloqueado por insumo de terceiro

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
