# Análise Técnica do Sistema Audisped

> Auditoria de código **somente-leitura** — gerada por análise multi-agente, função a função, do código real.
> 27/27 unidades de código analisadas (22 backend + 5 frontend) · 33 agentes · Data: 2026-05-29.

---

## Índice

- 1. Visao Geral & Arquitetura
- 2. Ingestao e Motor de Auditoria SPED
- 3. LMC - Livro de Movimentacao de Combustiveis
- 4. Motor de Exportacao SPED V7
- 5. Fiscais Acessorios: MDe, Espiao, Injetores XML/CTe, De-Para
- 6. Frontend (Vue)
- Anexo: Mapa Condensado de Módulos

---

## 1. Visao Geral & Arquitetura

### 1.1. Proposito do Sistema

O **Audisped** e um sistema de **auditoria fiscal especializado em postos de combustivel**. Ele resolve um problema concreto da revenda varejista de combustiveis: garantir a coerencia entre tres universos de dados que, na pratica, raramente fecham entre si:

1. **O SPED Fiscal (EFD ICMS/IPI)** efetivamente escriturado e entregue pelo contribuinte;
2. **O movimento fisico real** dos tanques e bicos (encerrantes), consolidado no **LMC — Livro de Movimentacao de Combustiveis**, documento obrigatorio da ANP;
3. **A realidade documental na SEFAZ** (NF-e de entrada/compra e NF-e/NFC-e de saida que existem de fato no fisco).

A partir desse cruzamento, o Audisped executa quatro grandes papeis:

- **Importar e parsear** o arquivo SPED `.txt` (blocos 0, C, D e 1) para um modelo relacional em Postgres (B4).
- **Auditar** o LMC e a escrituracao com 11+ regras fiscais — continuidade de estoque, variacao ANP 0,6%, capacidade de tanque, estoque negativo, participante nao cadastrado, CST x CFOP em venda de combustivel, quebra de sequencia de numeracao, PIS/COFINS monofasico, credito de ICMS sobre frete CT-e etc. (B8).
- **Corrigir e reconstruir**: ancorar estoque de abertura, redistribuir vendas matematicamente, otimizar a cascata diaria para caber no limite ANP, injetar XMLs de NF-e/CT-e omitidos no arquivo SPED, e aplicar de-para de CFOP/CST (B6, B7, B11, B12, B15, B20, B21, B22).
- **Reexportar** um SPED retificado, valido perante o PVA, com o Bloco 1 (1300/1310/1320) recalculado e a continuidade intermensal de encerrantes preservada (B17, B18, B19).

O eixo fiscal central de todo o sistema e o **registro 1300 (Movimentacao Diaria de Combustiveis)** e seus filhos **1310 (por tanque)** e **1320 (por bico/encerrante)**, cruzados com os documentos de entrada **C100/C170** e com a regra de variacao da ANP de **0,60%**.

### 1.2. Stack Tecnologico

| Camada | Tecnologia | Observacoes |
|---|---|---|
| Backend | **Node.js + Express** (monolito) | Servidor unico em `backend/server.js`, rotas REST sob `/api/*` |
| Banco de dados | **PostgreSQL** (driver `pg`) | Pool de conexoes `max: 120`, `connectionTimeoutMillis: 30000`, `idleTimeoutMillis: 15000` |
| Autenticacao | **JWT** (`jsonwebtoken`) + **bcryptjs** | `authMiddleware` em `server.js:129`, token via header `Authorization` ou `query.token` |
| Upload | **multer** | `upload.single('spedfile')` para SPED, `uploadXml` para XMLs (NF-e/CT-e) |
| Parse XML | **xml2js** (`explicitArray:false`) e **fast-xml-parser** | xml2js no Injetor; fast-xml-parser nos services de MDe/Espiao/CT-e |
| Geracao de relatorios | **pdfkit** (PDF) e **exceljs** (Excel) | Dossie de inconsistencias, posicao de estoque, PDF do LMC |
| Logging | **Winston** + `logEmitter` (SSE) | `backend/logger.js`, stream em `GET /api/logs/stream` |
| Criptografia de certificado | **node-forge** (PKCS#12) + **crypto** (AES-256-CBC + scryptSync) | Senha do `.pfx` armazenada cifrada |
| Compressao/empacotamento | **zlib** (gunzip de XML base64+gzip), **archiver** (ZIP streaming) | Download em lote de XMLs |
| HTTP externo | **axios** | Integracao com a API comercial EspiaoNFe |
| Busca textual | extensao Postgres **pg_trgm** (`similarity`) | Sugestao de codigo interno no de-para, com fallback `ILIKE` |
| Config | **dotenv** (`.env`) | Tokens EspiaoNFe, credenciais de banco |
| Frontend | **Vue 3** (Composition API + `<script setup>`) | SPA com `vue-router` (`createWebHistory`), `axios`, `lucide-vue-next`, Tailwind, `vue3-apexcharts` |
| Integracao DFe | **API EspiaoNFe v1-cloud** (`api.espiaonfe.com.br`) | Provedor terceirizado de Distribuicao DF-e / MDe |
| Scripts Python auxiliares | `mailbox`, `pdfplumber`, `zipfile`, `csv` | Coleta de DACTE/CT-e do Thunderbird (standalone, nao acoplados ao Node) |

### 1.3. Arquitetura Geral

O sistema e um **monolito backend Express + Postgres** com um **frontend SPA Vue 3** desacoplado, consumindo a API via axios.

```
                          ┌──────────────────────────────────────────────┐
                          │            FRONTEND (Vue 3 SPA)                │
                          │  App + Router (guarda JWT) + store + api.js    │
                          │  Views: Analisador, LMC, Injetores, MDe,       │
                          │         Explorador, CFOP, Rentabilidade        │
                          └───────────────────────┬──────────────────────┘
                                                   │ HTTP /api/* (axios + JWT)
                          ┌───────────────────────┴──────────────────────┐
                          │           BACKEND MONOLITO (server.js)         │
                          │  authMiddleware · safeConnect/safeRollback ·   │
                          │  acquireHeavySlot/releaseHeavySlot (MAX=5)     │
                          │                                                │
                          │  ┌───────── Modulos de rota ──────────┐        │
                          │  │ Upload/Parse SPED · Auditoria ·     │        │
                          │  │ LMC core/estoque/otimizador ·       │        │
                          │  │ Injetor XML/CTe · MDe/Espiao ·      │        │
                          │  │ Relatorios · Exportacao SPED V7     │        │
                          │  └────────────────────────────────────┘        │
                          │  ┌──────────── Services ──────────────┐         │
                          │  │ xmlInjectorService ·                │         │
                          │  │ spedCostureiraService ·             │         │
                          │  │ cteInjectorService ·                │         │
                          │  │ mdeService → espiaoNfeService ·      │         │
                          │  │ sefazService · test_optimize        │         │
                          │  └────────────────────────────────────┘         │
                          │  ┌────── lmc-pdf.js (PDF do LMC) ─────┐          │
                          └──────┬───────────────────────────┬────┘         │
                                 │                            │
                       ┌─────────┴────────┐         ┌─────────┴─────────┐
                       │   PostgreSQL     │         │  API EspiaoNFe    │
                       │  (pool max 120)  │         │   (DFe / MDe)     │
                       └──────────────────┘         └───────────────────┘
```

#### Pilares transversais do backend

Todo o codigo de rota se apoia em um pequeno conjunto de helpers de infraestrutura definidos no topo de `server.js`:

| Helper | Local | Funcao |
|---|---|---|
| `safeConnect(res)` | `server.js:83` | Obtem conexao do pool; responde **HTTP 503** se o pool estiver esgotado |
| `safeRollback(client)` | `server.js:96` | Rollback que **nunca lanca** excecao (seguro em `catch`/`finally`) |
| `acquireHeavySlot` / `releaseHeavySlot` | semaforo `MAX_HEAVY_OPS=5` | Limita operacoes pesadas simultaneas (auditoria, exportacao) para nao esgotar o pool |
| `authMiddleware` | `server.js:129` | Valida JWT (header `Authorization` ou `query.token`) |
| `pool` | `pg.Pool` global | `max: 120`, timeouts conforme MEMORY |

> **Padrao operacional conhecido:** sob exportacoes em sequencia rapida, o pool pode esgotar (vide MEMORY). O semaforo de heavy ops mitiga, mas o script `redistribuir_automatico.js` processa arquivos em **ordem cronologica** justamente para preservar a continuidade de encerrantes sem disparar concorrencia excessiva.

### 1.4. Mapa de Modulos

O monolito esta logicamente segmentado em **22 unidades de backend (B1–B22)** e **5 unidades de frontend (F1–F5)**.

#### Backend — fundacao e integracao fiscal externa

| Unidade | Responsabilidade |
|---|---|
| **B1** | Infra/bootstrap (pool, multer, Winston, SSE), auth (JWT+bcrypt), CRUD CFOPs, schema do banco (`setup_db.js`) |
| **B2** | Rotas MDe e Espiao NF-e: sync SEFAZ, manifestacao, download/import de XML, conferencia contra C100, certificado A1 |
| **B3** | Services `mdeService` (fachada) → `espiaoNfeService` (motor real) + `sefazService` (cripto/metadados PFX) |

#### Backend — ingestao e auditoria

| Unidade | Responsabilidade |
|---|---|
| **B4** | Upload e parsing do SPED `.txt` (blocos 0/C/D/1), upsert multi-empresa por CNPJ, retificacao de periodo |
| **B5** | Malha Fina **sintatica** — `POST /api/arquivos/analisar-sintaxe` (auditoria estatica de texto, sem gravar) |
| **B8** | **Motor de Auditoria** — `POST /api/analisar/:id` (11+ regras) e `GET /api/erros/:id` |
| **B9** | CRUD de empresas/arquivos, listagem de documentos de entrada/saida, exclusao transacional com cascade manual |

#### Backend — Injetor de XML/CT-e (reconstrucao do SPED)

| Unidade | Responsabilidade |
|---|---|
| **B6** | Rotas do Injetor XML: analise de itens, de-para, agrupamento, geracao de C100/C170/C190 |
| **B7** | `xmlInjectorService` — motor de transformacao NF-e → registros SPED (blocos 0 e C), de-para, recalculo ICMS/IPI/ST |
| **B21** | `spedCostureiraService` — injeta registros no SPED preservando hierarquia, recalcula X990/9900/9990/9999, E110/E210 |
| **B22** | `cteInjectorService` — injecao de CT-e (Bloco D: D100/D190) + extratores Python de DACTE |

#### Backend — LMC (nucleo de combustivel)

| Unidade | Responsabilidade |
|---|---|
| **B10** | LMC core: continuidade intermensal, diagnostico de completude 1300, montagem do LMC diario |
| **B11** | LMC estoque/sincronizacao: ancora de abertura, redistribuicao de vendas, colunas espelho `*_ajustado` |
| **B12** | Otimizador matematico — `POST /api/lmc/otimizador-matematico` (fecha cascata dentro do ANP 0,6%) |
| **B14** | Config/sugestao de capacidade de tanque por CNPJ, resumo por participante, dossie PDF/Excel |
| **B15** | Correcoes/ajustes LMC: correcao manual e em massa, ajuste em cascata, observacoes (campo 13) |
| **B16** | `lmc-pdf.js` — geracao do PDF do LMC no modelo AutoSystem PRO (Linx) |

#### Backend — relatorios e exportacao

| Unidade | Responsabilidade |
|---|---|
| **B13** | Relatorios: resumo gerencial, resumo de estoque, rentabilidade/custo medio, PDF de posicao de estoque |
| **B17** | **Exportacao V7 — Parte A**: carregamento de ajustes, pre-scan, dedup D100, closure `flush1300Group` |
| **B18** | **Exportacao V7 — Parte B**: nucleo de redistribuicao de vendas (`flush1300Group`, PASS 1–4) |
| **B19** | **Exportacao V7 — Parte C**: recalc 1300/1310/1320, recontagem 0990/1990/9999, montagem TXT, gravacao de encerrantes |
| **B20** | Rotas finais (exclusao em background, otimizacao, de-para, MDe x SPED, injecao CTe) + `redistribuir_automatico.js` |

#### Frontend

| Unidade | Responsabilidade |
|---|---|
| **F1** | Core Vue: App/shell, router com guarda JWT, `store.js` (sessao + contexto de auditoria), `api.js`, Login/Perfil/Home/Hub |
| **F2** | **AnalisadorView** — tela central de auditoria com 7 abas (Upload, Dashboard, Auditoria LMC, Alertas, Malha Fina, Notas, Saidas) |
| **F3** | Views LMC: `LmcView` (Raio-X vs Laboratorio), `ImpressaoLmcView`, `StockAnalysis` |
| **F4** | Views dos Injetores XML/CTe e De-Para |
| **F5** | Views MDe, Explorador, CFOP, Rentabilidade e `SpedPreview` |

### 1.5. Principais Fluxos de Dados Ponta a Ponta

#### Fluxo 1 — Importacao e auditoria do SPED

```
Upload .txt (F2 AnalisadorView)
   → POST /api/upload (B4: multer upload.single('spedfile'))
   → parseSpedFile (server.js:7753) le linha-a-linha (pipe-delimited, latin1)
   → grava em transacao: empresas, sped_arquivos, sped_participantes (0150),
     sped_produtos (0200), documentos_c100/c170/c190, documentos_d100,
     lmc_movimentacao (1300/1310/1320)
   → POST /api/analisar/:id (B8) aplica 11+ regras → grava erros_analise (CRITICAL/WARNING)
   → GET /api/erros/:id + GET /api/resumo/:id + GET /api/estoque-resumo/:id (F2 popula abas)
```

#### Fluxo 2 — Correcao do LMC e exportacao do SPED retificado

```
Auditor ancora estoque / redistribui (F2/F3)
   → POST /api/lmc/update-estoque-inicial, /api/lmc/ajustar-cascata,
     /api/lmc/preview-sincronizacao → /api/lmc/confirmar-sincronizacao (Motor V7),
     /api/lmc/otimizador-matematico (B11/B12/B15)
   → grava colunas espelho *_ajustado em lmc_movimentacao (preserva o original do SPED)
   → GET /api/exportar-sped/:id (B17→B18→B19, Motor Exportacao V7)
        Parte A: carrega ajustes + encerrantes_exportados do mes anterior, pre-scan
        Parte B: flush1300Group reescreve 1300/1310/1320 com escudo ANP 0,55%,
                 redistribuicao entre tanques, tratamento de bico (parado/fantasma/multiproduto/duplicata)
        Parte C: reconcilia 1300=Σ1310 e 1310.SAIDA=Σ1320, recalcula 9900/0990/1990/9999,
                 monta nome CNPJ_FANTASIA_MM-YYYY.txt, grava encerrantes_exportados / encerrantes_bicos_exportados
   → download do TXT retificado
```

> A leitura a jusante (visao do LMC, validacoes, PDF, exportacao) sempre usa `COALESCE(coluna_ajustado, coluna_original)`, de modo que a correcao do auditor nunca destroi o dado original do SPED — caracteristica central do design.

#### Fluxo 3 — Injecao de notas omitidas (NF-e / CT-e)

```
Upload de XMLs (F4 InjetorXmlView / InjetorCteView)
   → POST /api/xml-injector/parse (server.js:1551) → extractNfeData parseia NF-e
   → POST /api/xml-injector/analyze-items (server.js:1425) sugere de-para
   → POST /api/xml-injector/save-de-para-batch (server.js:1483) grava de_para_xml
   → transformarNotasEmSped (B7) gera linhas dos blocos 0 e C com de-para aplicado
   → spedCostureiraService.costurarEAssinar (B21) injeta no SPED, recalcula X990/9900/9990/9999, E110/E210
   → sincronizarNotasInjetadas + processarAtualizacaoLmcPosInjecao atualizam C100/C170 e LMC
   (CT-e: POST /api/cte-injector/analyze e /inject → cteInjectorService → Bloco D D100/D190)
```

#### Fluxo 4 — Conferencia documental contra a SEFAZ (MDe / Espiao NF-e)

```
Cadastro do certificado A1 (.pfx) por empresa (F5 MdeView)
   → POST /api/mde/certificado (B2) — node-forge valida PKCS#12, senha cifrada (AES-256-CBC)
   → GET /api/mde/sync/:id / GET /api/espiao/sync/:id → espiaoNfeService consome API EspiaoNFe
   → resumo + XML completos gravados em mde_cache (itens_json JSONB)
   → manifestacao (Ciencia/Confirmacao/Desconhecimento/Op. nao Realizada): POST /api/mde/manifestar
   → POST /api/espiao/conferir-sped cruza chaves CHV_NFE do C100 (SPED) contra mde_cache
     → identifica notas presentes na SEFAZ mas ausentes do SPED → alimenta o Injetor (Fluxo 3)
```

### 1.6. Panorama do Esquema do Banco

O schema e criado/migrado por **`setup_db.js`** (B1). As tabelas centrais e seus papeis fiscais:

#### Identidade e sessao

| Tabela | Papel |
|---|---|
| `usuarios` | Autenticacao (bcrypt + JWT) |
| `empresas` | Identificacao do contribuinte (registro **0000**: `cnpj`, `nome_empresa`) |
| `sped_arquivos` | Cada arquivo SPED importado (`id`, `id_empresa`/`cnpj_empresa`, `periodo_apuracao`, `caminho_arquivo`, `nome_arquivo`) |

#### Documentos fiscais (blocos 0, C e D)

| Tabela | Registro SPED | Papel |
|---|---|---|
| `sped_participantes` | **0150** | Fornecedores/clientes (`cod_part`, `nome`, `cnpj`) |
| `sped_produtos` | **0200** | Cadastro de itens/combustivel (`cod_item`, `descr_item`) |
| `documentos_c100` | **C100** | Capa da NF-e/NFC-e (`ind_oper`, `vl_doc`, `cod_mod` 55/65, `cod_sit`, `dt_doc`, `chv_nfe`) |
| `documentos_itens_c170` | **C170** | Itens da nota (`cod_item`, `qtd`, `vl_item`, NCM/CFOP/CST) |
| `documentos_c190` | **C190** | Analitico por CST/CFOP/aliquota (`cfop`, `vl_opr`, `vl_bc_icms`, `vl_icms`) |
| `documentos_d100` | **D100** | CT-e modelo 57 (frete; credito de ICMS / `IND_OPER=0`, `IND_EMIT=1`) |

#### LMC — nucleo de combustivel

| Tabela | Registro SPED | Papel |
|---|---|---|
| `lmc_movimentacao` | **1300/1310/1320** | Movimentacao diaria por combustivel/tanque/bico. Colunas originais (`estq_abert`, `vol_entr`, `vol_saidas`, `fech_fisico`, `val_perda`, `val_ganho`, `num_tanque`, `data_mov`) **+** colunas espelho `*_ajustado` (`estq_abert_ajustado`, `vol_saidas_ajustado`, `fech_fisico_ajustado`, `val_perda_ajustado`, `val_ganho_ajustado`, `vol_escr_ajustado`, `vol_entr_ajustado`) |
| `lmc_tanques_config` | apoio **1310** | Capacidade fisica do tanque por CNPJ (UNIQUE `cnpj, cod_item`); alimenta a regra CRIT-1310-01 e o escudo ANP |
| `lmc_observacoes` | campo 13 do LMC | Observacoes editaveis por dia/produto |
| `vendas_combustiveis` | apoio | Vendas usadas em ajustes de saidas |

#### Resultados de auditoria

| Tabela | Papel |
|---|---|
| `erros_analise` | Divergencias detectadas (`tipo_erro` CRITICAL/WARNING, `regra_id`, `titulo_erro`, `descricao_erro`, `sugestao_correcao`, `cod_item_erro`, `data_erro`, `id_sped_arquivo`) |

#### Tributacao, de-para e injecao

| Tabela | Papel |
|---|---|
| `cad_cfops` | Cadastro de CFOPs usado no de-para de XML e na geracao de C100/C190 |
| `config_tributaria` | Configuracao tributaria por empresa |
| `mapeamento_produtos` / `mapeamento_participantes` | De-para legado de produtos/participantes |
| `de_para_xml` | De-para de injecao (`cnpj_emissor` + `cod_produto_xml` → `novo_cfop`, `novo_cst`, `conta_contabil`, `ncm`, `cod_interno`, `aliq_icms`, `bc_icms_override`, `cst_pis`, `cst_cofins`) |

#### Integracao SEFAZ / MDe

| Tabela | Papel |
|---|---|
| `mde_cache` | Cache de NF-e da SEFAZ (`chave_nfe` UNIQUE, `nsu`, `cnpj_emissor`, `valor`, `data_emissao`, `status_manifesto`, `tipo_operacao`, `xml_content`, `itens_json` JSONB) |
| `empresa_certificados` | Certificado A1 por empresa (`id_empresa` UNIQUE, `pfx_base64`, `senha_encriptada`, `data_validade`, `ultimo_nsu_consultado`, `periodicidade_sincronizacao`) |

#### Continuidade intermensal (exportacao V7)

| Tabela | Papel |
|---|---|
| `encerrantes_exportados` | Persiste o **fechamento fisico** final por produto/mes; vira a **abertura** do mes seguinte na exportacao |
| `encerrantes_bicos_exportados` | Persiste os **encerrantes por bico** para continuidade crescente entre meses |

> **Relacao chave:** `empresas (1) → sped_arquivos (N) → {documentos_c100/c170/c190, documentos_d100, lmc_movimentacao, erros_analise}`. A exclusao de periodo/empresa (B9) faz **cascade manual transacional** dessas tabelas filhas — note que `lmc_observacoes` e `encerrantes_exportados` **nao sao limpas** na exclusao (vide B9), por design de continuidade historica.

### 1.7. Observacoes Arquiteturais Relevantes

- **Design "ajustado nao destrutivo":** o original do SPED nunca e sobrescrito; toda correcao vive em colunas `*_ajustado` lidas via `COALESCE`. Isso permite reauditoria e comparacao SPED original vs exportado.
- **`mdeService` e uma fachada (adapter):** delega praticamente toda a logica de MDe ao `espiaoNfeService`, que por sua vez consome a API comercial EspiaoNFe. O `sefazService` restou como utilitario isolado de cripto de senha e leitura de metadados PFX.
- **Malha Fina sintatica (B5) e puramente textual:** le o TXT em latin1 com maquinas de estado e nao usa o modelo ja parseado no Postgres (exceto para localizar o caminho do arquivo) — auditoria estrutural independente da importacao.
- **Inconsistencia conhecida no frontend:** `XmlTributacaoView` referencia `POST /api/inject-xml-v2`, rota **inexistente** no backend (vide F4) — ponto de atencao para evolucao.
- **Capacidade de tanque nao vem confiavel no SPED:** e persistida manualmente em `lmc_tanques_config`, com sugestao automatica a partir do campo `CAP_TANQUE` do 1310 no layout 020 (B14).

---

## 2. Ingestao e Motor de Auditoria SPED

Esta seção descreve o pipeline completo de processamento do SPED Fiscal (EFD ICMS/IPI) no Audisped, desde o upload do arquivo `.txt` até a geração de erros de auditoria fiscal, passando pela persistência em PostgreSQL, pela análise de sintaxe ("malha fina sintática") e pelo CRUD de empresas, arquivos e documentos. Todo o código discutido reside em `backend/server.js`.

O fluxo macro é:

```
Upload .txt (multipart)
   └─> parseSpedFile (streaming latin1, máquina de estados por registro)
         └─> Persistência transacional (BEGIN/COMMIT) em PostgreSQL
               ├─> Análise de Sintaxe (POST /api/arquivos/analisar-sintaxe) — leitura textual, não grava
               └─> Motor de Auditoria (POST /api/analisar/:id) — 11+ regras fiscais -> erros_analise
                     └─> Leitura de erros (GET /api/erros/:id) e CRUD de empresas/arquivos/documentos
```

---

### 2.1. Upload e Parsing do SPED Fiscal

O ponto de entrada é a rota protegida `POST /api/upload` (`backend/server.js:493-641`), que combina `authMiddleware` com `multer` (`upload.single('spedfile')`, destino `backend/uploads`). O processamento ocorre em uma única transação PostgreSQL, com uma sequência rígida de passos:

| Passo | Linhas | Operação |
|---|---|---|
| 1. Validação | 493-641 | Rejeita com 400 se o arquivo estiver ausente |
| 2. Conexão | — | `safeConnect(res)` obtém conexão do pool; 503 se esgotado |
| 3. Parsing | — | `parseSpedFile()` desestrutura `fileInfo`/`documents`/`participants`/`lmc`/`produtos` |
| 4. Transação | — | `BEGIN` |
| 5. UPSERT empresa | — | `INSERT ... ON CONFLICT (cnpj) DO UPDATE` preservando `nome_fantasia` via `COALESCE` (lógica multi-empresa) |
| 6. Duplicata/retificação | 539-547 | Busca `sped_arquivos` por `(cnpj_empresa, periodo_apuracao)`; se existe, DELETE em cascata manual |
| 7. INSERT arquivo | — | Grava `sped_arquivos` com caminho absoluto retido |
| 8. Grava LMC | — | Itera `Map<codItem, Map<dia, dados>>`; um INSERT por produto/dia em `lmc_movimentacao` com `num_tanque='0'`, `cap_tanque=0` |
| 9-11. Blocos auxiliares | — | D100; participantes (`ON CONFLICT DO NOTHING`); produtos (`ON CONFLICT DO UPDATE ncm`) |
| 12. Grava C100 | — | C100 + loop aninhado de C170 e C190, com `RETURNING id` do C100 para a FK |
| 13. COMMIT | — | Confirma a transação |
| 14. Completude LMC | 620 | `validarCompletudeLmc1300()` pós-commit (alerta NÃO-bloqueante) |

A rede de segurança transacional é fornecida por `safeConnect`/`safeRollback` (`backend/server.js:83-98`): `safeConnect` devolve `null` e responde 503 ("Servidor sobrecarregado") quando o pool (`max: 120`) esgota; `safeRollback` executa `ROLLBACK` dentro de `try/catch` vazio para nunca lançar exceção secundária se a conexão já estiver quebrada. Em caso de erro, o fluxo cai em `safeRollback` + 500; o `finally` faz `dbClient.release()` mas **não apaga o arquivo físico** — ele é retido para reuso por exportações/injeções futuras via `caminho_arquivo`.

#### 2.1.1. O parser `parseSpedFile`

`parseSpedFile` (`backend/server.js:7753-7877`) é um parser por *streaming*: usa `fs.createReadStream` com encoding `'latin1'` (ISO-8859-1, correto para o SPED, que escreve acentuação em Latin1) combinado com `readline` e `crlfDelay: Infinity` (trata CRLF). Para cada linha faz `split('|')`, ignora linhas com menos de 2 campos e usa `fields[1]` como tipo de registro, implementando uma **máquina de estados por registro**:

| Registro | Conteúdo extraído |
|---|---|
| `0000` | Cadastro: `cnpj=f[7]`, `nome=f[6]`, `uf=f[9]`, `periodo_apuracao='DT_INI a DT_FIN'` (via `formatDate` de `f[4]`/`f[5]`) |
| `0005` | `nome_fantasia=f[2]` |
| `0150` | Participante: `cod_part`/`nome`/`cnpj` |
| `0200` | Produto: `cod_item`/`descr_item` (trim), `ncm` com `replace(/\D/g,'')` (remove não-dígitos) |
| `1300` | **Registro consolidado do LMC** (detalhado abaixo) |
| `1310` | **IGNORADO deliberadamente** (linhas 7831-7833) |
| `C100` | NF-e: `ind_oper`/`num_doc`/`cod_mod`/`cod_sit`/`dt_doc`/`dt_e_s`/`vl_doc`/`cod_part`/`chv_nfe`; vira `currentC100` com arrays `items`/`analytical` |
| `C170` | Item da NF: `num_item`/`cod_item`/`qtd`/`unid`/`vl_item`/`cst_icms[10]`/`cfop[11]`/`cst_pis[25]`/`cst_cofins[31]` (todos trim) |
| `C190` | Analítico por CST/CFOP/alíquota: `cst[2]`/`cfop[3]`/`aliq[4]`/`vl_opr[5]`/`vl_bc_icms[6]`/`vl_icms[7]` |
| `D100` | Frete/CT-e: `ind_oper`/`num_doc[9]`/`cod_mod`/`cod_sit`/`dt_doc[11]`/`cfop[14]`/`vl_doc[15]`/`vl_icms[22]` |

O registro `1300` (movimentação diária de combustíveis, base do LMC) é o foco fiscal central: extrai `cod_item=f[2]` (trim), `dt_fech=f[3]`, `estqAbert=f[4]`, `volEntr=f[5]`, `volSaidas=f[7]`, `estqEscr=f[8]`, `valPerda=f[9]`, `valGanho=f[10]`, `fechFisico=f[11]` (com fallback `p[8]` se o array vier curto). A data é montada **inline** via `Date` UTC 12:00:00Z e os dados são armazenados em `lmc[codItem][dtFech]` (Map aninhado), mantendo `current1300` como estado.

Cada iteração de linha é envolvida em `try/catch`: uma linha malformada é logada como WARN e ignorada, garantindo resiliência — uma linha quebrada não aborta o arquivo inteiro. O parser resolve `data` no evento `close`.

**Decisão fiscal estruturante:** o sistema confia integralmente no `1300` (consolidado diário) e **descarta o `1310`/`1320`** (detalhe por tanque/bico/encerrante) durante o parsing. O LMC é gravado como consolidado global com `num_tanque='0'`. O comentário no código justifica que a métrica fiscal relevante é o Fechamento Total vs NF, não por tanque. Essa escolha é a raiz dos fallbacks documentados (encerrantes, bicos compartilhados etc.).

#### 2.1.2. Helpers de normalização

- **`parseFloatSped`** (`backend/server.js:7733`): converte número do SPED (decimal com vírgula, ex. `'1234,56'`) para float JS via `(str||'0').replace(',','.')` + `parseFloat`, com fallback `||0`. Trata campos vazios/nulos retornando 0. **Armadilha:** `replace(',','.')` troca apenas a primeira vírgula; funciona porque o SPED não usa separador de milhar, mas um campo `'1.234,56'` quebraria (`'1.234'` viraria `1.234`).
- **`formatDate`** (`backend/server.js:7735-7751`): converte data SPED `DDMMAAAA` (8 chars) para ISO `'YYYY-MM-DD'`. Valida `length===8`, monta `Date.UTC`, checa `NaN` e `date.getUTCDate()===day` (detecta overflow de datas inválidas tipo 31/02), retornando `null` quando inválida. Usado em `periodo_apuracao`, `dt_doc`/`dt_e_s` de C100 e `dt_doc` de D100 — **mas não no `1300`**, cuja data é montada manualmente inline e **sem validação** (inconsistência: um `dt_fech` malformado gera `Invalid Date` silenciosamente armazenado no Map).

#### 2.1.3. Validação de completude do LMC

`validarCompletudeLmc1300` (`backend/server.js:934-984`) detecta **lacunas** no LMC: dias do período de apuração sem registro `1300` por produto. Parseia `periodoApuracao` no formato `'YYYY-MM-DD a YYYY-MM-DD'`, gera o array de todos os dias do período (loop UTC) e, para cada produto no Map `lmc`, compara os dias com registro contra os dias do período. Marca `tem_lacuna=true` se algum produto tem dias faltantes e retorna, por produto: `total_dias_periodo`, `total_dias_com_lmc`, `dias_faltantes[]`, `ultimo_dia_com_lmc`.

É um **alerta NÃO-bloqueante**, chamado após o COMMIT (linha 620): mesmo com LMC incompleto o arquivo é gravado, gerando apenas WARN. Fiscalmente, o LMC de um posto deve conter movimentação diária de todos os dias do mês para cada combustível; dias faltantes indicam livro incompleto, mas a auditoria pode prosseguir com o "livro furado".

#### 2.1.4. Riscos conhecidos do upload/parsing

- O `1310`/`1320` ser ignorado perde toda granularidade de tanque/encerrante já no upload.
- O DELETE em cascata manual (linhas 539-547) depende da ordem de exclusão e de FKs corretas; **não apaga** `lmc_observacoes`, `lmc_estoque_abertura`, `encerrantes` nem `mde_cache`, podendo deixar órfãos após retificação.
- INSERTs em loop individual (um query por linha) para milhares de notas seguram a conexão por muito tempo dentro de uma única transação, contribuindo para esgotar o pool.
- `fileInfo.cnpj_empresa` não tem fallback: se o `0000` estiver ausente/malformado, o `cnpj` fica `undefined`.
- O `try/catch` por linha engole erros silenciosamente — um C100 quebrado faz a NF inteira sumir sem aviso ao usuário.
- A chave de sobrescrita `(cnpj_empresa, periodo_apuracao)` é literal: dois envios com mesmo CNPJ/período mas strings de data distintas no `0000` não são detectados como duplicata, criando registro paralelo.
- O arquivo temporário nunca é deletado (`finally` só faz `release`) — uploads acumulam em `backend/uploads` indefinidamente, e o caminho absoluto no banco quebra se o arquivo for movido/limpo.

---

### 2.2. Análise de Sintaxe SPED (Malha Fina Sintática)

A rota `POST /api/arquivos/analisar-sintaxe` (`backend/server.js:647-878`), protegida por `authMiddleware` e `multer` (`upload.single('file')`), realiza uma auditoria **estática puramente textual** do SPED, sem gravar nada no banco. Diferentemente do motor de auditoria, ela **não usa o modelo já parseado no PostgreSQL** — relê o arquivo `.txt` diretamente do filesystem.

**Resolução do arquivo** (linhas 649-660): se o body trouxer `id_arquivo`, faz `SELECT caminho_arquivo FROM sped_arquivos WHERE id=$1` (modo "análise automática"); senão usa `req.file.path` do upload; senão 400. A leitura (664-665) usa `fs.readFileSync(filePath,'latin1')` + `split(/\r?\n/)` — carrega o arquivo inteiro em memória (sem streaming). É a única interação dessa rota com o banco.

A estrutura `infractions` (linhas 667-675) agrupa as infrações em **7 buckets**:

| Bucket | Significado |
|---|---|
| `c100_valores_divergentes` | `VL_DOC` da capa difere da soma dos `VL_OPR` dos C190 (> R$ 1,00) |
| `c100_sem_c190` | Capa com valor mas sem nenhum analítico C190 |
| `c100_saltos_enumeracao` | Gap na sequência de `NUM_DOC` |
| `h010_divergente_1300` | Estoque físico final do LMC vs inventário Bloco H |
| `cfop_suspeitos` | CFOP de devolução x CST + NCM inválido (bucket reutilizado) |
| `bicos_duplicados_1320` | Mesmo NUM_BICO em mais de uma ocorrência no dia/produto |
| `chv_nfe_cnpj_divergente` | CNPJ embutido na chave de 44 dígitos ≠ CNPJ do informante |

O estado sequencial (linhas 678-695) inclui `cnpjInformante`, `activeC100`, `activeC190Sum`, `lastC100NfeNumber`, `lastLmcFisico`, `inventarioH010Fisico`, `current1300`, `current1310Tanque`, `bicoPorDiaProduto` (Map `chave -> Map<bico, [ocorrências]>`) e `produtoMap`.

#### 2.2.1. Validações por registro

- **`0000`** (701-704): com `parts.length>7`, extrai `parts[7]` (CNPJ do informante, removendo não-dígitos) — base de comparação contra a chave de NF-e.
- **`0200`** (707-719): captura `cod=parts[2]`, `descr=parts[3]`, `ncm=parts[8]` (trim) em `produtoMap`. **Regra:** NCM deve ter 8 dígitos; se `!ncm` ou `ncm.length<8`, gera alerta em `cfop_suspeitos` (bucket semanticamente errado). Não valida existência na TIPI nem se os caracteres são dígitos (`'1234ABCD'` passaria).
- **`1300`** (721-731): lê `parts[11]` como estoque físico e atualiza `lastLmcFisico`. **Armadilha grave:** `lastLmcFisico` é sobrescrito a cada `1300` na ordem textual, então "último" = último 1300 que aparece no arquivo, de **qualquer produto** — não o estoque final de um combustível específico. Também formata `parts[3]` (`DDMMAAAA->DD/MM/AAAA`) e seta `current1300={dt, codItem=parts[2], linha}`, zerando `current1310Tanque`. Risco adicional: `parts[11]` pode ser `VOL_AFERICAO` no leiaute oficial, e não o fechamento real.
- **`1310`** (733-735): seta `current1310Tanque=parts[2]` (NUM_TANQUE). Não valida hierarquia — `1310` órfão (sem `1300` anterior) faz os `1320` subsequentes serem silenciosamente ignorados (e a quebra de hierarquia não é reportada).
- **`1320`** (737-745): com `current1300` e `current1310Tanque` setados, lê `bicoNum=parts[2]`, `volVendas=parseFloat(parts[11])`, `chave=dt_codItem` e acumula em `bicoPorDiaProduto`. Objetivo: detectar o mesmo NUM_BICO em mais de um tanque no mesmo dia/produto (padrão de "bicos compartilhados").
- **`H010`** (747-751): acumula `inventarioH010Fisico += parseFloat(parts[4])` (QTD). **Problema:** soma **indiscriminadamente** todos os H010, sem filtrar combustível por COD_ITEM/NCM (o comentário diz que filtra, mas não filtra) — inclui loja de conveniência, inflando o inventário.

#### 2.2.2. Validações do Bloco C

- **C100** (754-805): ao abrir uma capa, executa quatro ações:
  1. **Fecha o C100 anterior** (756-769): se `|vl_doc - somaC190| > 1.0`, registra `c100_valores_divergentes`; se `somaC190===0 && vl_doc>0`, registra `c100_sem_c190`. Tolerância fixa de R$ 1,00.
  2. **Validação de chave NF-e** (771-786): com `cnpjInformante` setado, `chvNfe.length===44` e `indEmit==='0'` (emissão própria), extrai `cnpjChave=chvNfe.substring(6,20)` (CNPJ do emitente, posições 7-20 da chave); se `cnpjChave !== cnpjInformante`, registra `chv_nfe_cnpj_divergente`, derivando o modelo de `parts[5]` (`'65'?'NFC-e':'NF-e'`).
  3. **Salto de numeração** (792-801): se `currNum - lastC100NfeNumber > 1 && < 50`, registra `c100_saltos_enumeracao`. A faixa 1..49 evita falsos positivos de mudança de série; porém **mistura entradas e saídas** (notas de fornecedores diversos), gerando ruído.
  4. **Novo escopo**: `num_doc=parts[8]`, `vl_doc=parseFloat(parts[12])`, reinicia `activeC100` e `activeC190Sum=0`.
- **C190 + heurística CFOP/CST** (807-822): acumula `activeC190Sum += vl_opr` (`parts[5]`). Heurística (815-821): se `cfop ∈ {1202,2202,1411}` (devoluções) **e** `cst==='060'` (ICMS por ST), registra `cfop_suspeitos` ("CFOP de devolução requer CST tributado"). Regra discutível — CST 060 pode ser legítimo em regime de ST, gerando falso positivo.

#### 2.2.3. Verificações pós-loop

- **Fechamento do último C100** (826-834): repete `|vl_doc - somaC190|>1.0`, mas **NÃO** repete a checagem `c100_sem_c190` que existe no fechamento dentro do loop (766-768) — **bug de simetria**: o último C100 do arquivo, se tiver valor e nenhum C190, não é reportado como "sem C190".
- **Bicos duplicados** (836-855): para cada bico com `ocorrências.length>1`, monta alerta com data, produto, cod_item, bico, lista de tanques e volumes. **Armadilha:** `length>1` não garante tanques distintos — o mesmo bico aparecendo 2× no mesmo tanque (multiproduto/flush) dispara falso positivo, embora a mensagem afirme "N tanques".
- **Cruzamento 1300 vs H010** (857-867): se `lastLmcFisico>0 && inventarioH010Fisico>0 && |lastLmcFisico - inventarioH010Fisico|>0.5`, registra `h010_divergente_1300`. **Problema composto:** compara o último 1300 de qualquer produto contra a soma de todos os H010 (incluindo não-combustíveis) — só válido em posto monoproduto sem loja.

A rota responde sempre 200 quando processa, com 404 (id inexistente), 400 (sem arquivo/id) e 500 (exceção genérica, 874-877). **Nota de segurança:** o `id_arquivo` não é filtrado por dono/usuário (`req.user`) no SELECT, configurando um IDOR potencial — qualquer usuário autenticado lê o caminho e o conteúdo de qualquer SPED.

---

### 2.3. Motor de Auditoria SPED

A rota `POST /api/analisar/:id` (`backend/server.js:2095-2111`) é o núcleo da auditoria fiscal. Ao receber o ID de um arquivo SPED já persistido, executa **11+ regras de validação** sobre os dados normalizados no banco, classificando cada divergência como `CRITICAL` ou `WARNING` e gravando em `erros_analise`. A rota `GET /api/erros/:id` apenas devolve os erros já persistidos.

#### 2.3.1. Envelope transacional

O envelope (`backend/server.js:2095-2111`) implementa proteções de concorrência:

1. Valida o ID (`parseInt`; 400 se NaN).
2. Adquire um slot do **semáforo de operações pesadas** (`acquireHeavySlot`, máx. 5 simultâneas) **antes** de conectar — protege contra esgotamento do pool.
3. `safeConnect` (503 + `null` se o pool estourar; libera o slot e retorna).
4. `BEGIN` + `statement_timeout=30000ms` LOCAL (evita travar o event loop em SPEDs grandes).
5. `DELETE` de todos os `erros_analise` do arquivo — torna a análise **idempotente** (sempre recomeça do zero).

Todos os achados são acumulados num array `erros` em memória; cada regra é uma query SQL que retorna apenas as linhas divergentes, e o JS pós-processa (percentuais, classificação, textos com Markdown `**negrito**` e datas pt-BR UTC).

#### 2.3.2. Catálogo de regras de auditoria

| Regra | Código | Linhas | Conceito fiscal | Classificação |
|---|---|---|---|---|
| 1B | `CRIT-1300-02` | 2114-2182 | Continuidade **intermensal** (abertura falsa) | CRITICAL se >0,60%, senão WARNING |
| 1 | `CRIT-1300-01`/`WARN-1300-01` | 2188-2230 | Continuidade **diária** de estoque | CRITICAL/WARNING |
| 2 | `CRIT-1310-01` | 2232-2257 | Estoque final > capacidade do tanque | CRITICAL |
| 3 | `CRIT-1310-02` | 2259-2293 | Variação de estoque > 0,60% (ANP) | CRITICAL |
| 6 (estoque) | `CRIT-1310-04` | 2295-2316 | Estoque negativo | CRITICAL |
| 4 | `CRIT-C100-01` | 2318-2348 | Participante não cadastrado no 0150 | CRITICAL |
| 5 | `CRIT-1310-03` | 2350-2401 | NF-e entrada vs recebimento LMC (mês) | CRITICAL |
| 6 (tributária) | `RTAX-C170-01` | 2403-2449 | CST x CFOP em venda de combustível | WARNING |
| 7 | `RSEQ-C100-01` | 2451-2499 | Quebra de sequência de numeração | WARNING |
| 8 | `RTAX-C100-02` | 2501-2527 | Nota de entrada de emissão própria | WARNING |
| 9 | `RSEQ-1300-01` | 2529-2574 | Integridade sequencial agregada por produto | CRITICAL/WARNING |
| 10 | `RTAX-C170-02` | 2576-2602 | PIS/COFINS monofásico | WARNING |
| 11 | `RTAX-D100-01` | 2604-2626 | Crédito de ICMS em frete (CT-e) | WARNING |

**REGRA 1B — Continuidade Intermensal** (2114-2182): detecta "abertura falsa" — o estoque inicial do mês deve ser exatamente o fechamento físico do último dia do mês anterior. Roda dentro de um `SAVEPOINT (sp_intermensal)` para não abortar a transação se não houver mês anterior. CTEs: `mes_atual` (período do arquivo), `mes_anterior_arquivo` (SPED do mesmo CNPJ cujo `RIGHT(periodo,10) = dt_inicio - 1 dia`), `fechamento_anterior` (último `fech_fisico>0` por `(cod_item, num_tanque)` via `ROW_NUMBER` DESC) e `abertura_atual` (primeiro `estq_abert` via `ROW_NUMBER` ASC). JOIN por `cod_item+num_tanque`, filtro `ABS(diff)>0,5 L`. No JS, `perc = diff/base*100` (base = fech anterior ou 1) e classifica CRITICAL se `perc>0,60%`.

**REGRA 1 — Continuidade Diária** (2188-2230): usa `LAG(fech_fisico) OVER (PARTITION BY cod_item, num_tanque ORDER BY data_mov)` para obter o fechamento do dia anterior, com `COALESCE(campo_ajustado, campo_original)` em `estq_abert`/`fech_fisico`/`vol_entr` (prioriza valores do motor de redistribuição). Filtra `ABS(estq_abert - fech_dia_anterior)>0,5 E fech_dia_anterior>0`. CRITICAL se `perc>0,60%`; WARNING se `diff>1,0 L`; entre 0,5 e 1,0 L sem ultrapassar 0,6% nenhum erro é gerado.

**REGRA 2 — Capacidade do Tanque** (2232-2257): JOIN com `lmc_tanques_config` casando CNPJ normalizado (`REGEXP_REPLACE` em ambos os lados) + `cod_item`, usando `COALESCE(cfg.capacidade, lmc.cap_tanque)`. Dispara quando `cfg.capacidade NOT NULL && >0 && fech_fisico>capacidade`. Sempre CRITICAL. **Gotcha:** se não houver config e `cap_tanque` for 0/NULL, estouros passam despercebidos.

**REGRA 3 — Variação ANP 0,60%** (2259-2293): núcleo da auditoria. Compara escritural (`vol_escr_ajustado`/`estq_escr`) com físico (`fech_fisico_ajustado`/`fech_fisico`), filtrando `fech_fisico>0 E ABS(escritural-físico)/físico > 0,006`. Calcula `variacao = físico - escritural`, `percentual = ABS(variacao)/físico*100`, `limiteLitros = físico*0,006`, `excessoLitros`. Sempre CRITICAL com `conteudo_linha` detalhado. Reflete a tolerância ANP de 0,6% de variação volumétrica; acima disso é infração grave (vazamento, venda sem nota, erro de aferição).

**REGRA 6 (estoque) — Estoque Negativo** (2295-2316): saldo escritural OU físico `< -0,01 L` (tolerância de ruído), com `COALESCE` ajustados. Sempre CRITICAL — estoque negativo é fiscalmente impossível (saídas sem entrada correspondente).

**REGRA 4 — Participante não Cadastrado** (2318-2348): integridade referencial C100 → 0150. Seleciona `documentos_c100` com `cod_part` não vazio que **não existe** em `sped_participantes` do mesmo arquivo. Sempre CRITICAL — todo `cod_part` referenciado deve ter um 0150, sob pena de rejeição no PVA.

**REGRA 5 — NF-e Entrada vs LMC** (2350-2401): confronto mensal agregado entre a soma de `qtd` dos C170 de entrada (`ind_oper='0'`, CFOP `LIKE '165%' OR '265%'`) por `cod_item` e a soma de `vol_entr` (ajustado) do LMC por `cod_item`, via `FULL OUTER JOIN`, filtro `ABS(diferença)>0,1 L`. No JS, segundo filtro por `PALAVRAS_COMBUSTIVEL` (GASOLINA/ETANOL/ÁLCOOL/DIESEL/GNV/GLP/QUEROSENE/BIODIESEL). Sempre CRITICAL.

**REGRA 6 (tributária) — CST x CFOP** (2403-2449): itens C170 de saída (`ind_oper='1'`) com CFOP de combustível (`LIKE '_65_' OR '_66_'`) cujo CST ICMS está em `('000','020','040','041','090')`. WARNING — o varejo opera sob ST, esperando CST 060/500; CST 000 gera bitributação.

**REGRA 7 — Quebra de Sequência** (2451-2499): lacunas na numeração de NF de saída (`ind_oper='1'`, `num_doc` numérico via regex). Extrai série via `SUBSTRING(chv_nfe, 35, 3)`, usa `LAG(num_doc) PARTITION BY (cod_mod, ser) ORDER BY num_doc`; reporta quando `num_doc > anterior+1`. WARNING. **Atenção:** ordena por `num_doc` (não por data), e NFC-e sem chave cai em série `'0'`.

**REGRA 8 — Entrada de Emissão Própria** (2501-2527): notas de entrada (`ind_oper='0'`) cujo CNPJ do participante = CNPJ do declarante (JOIN `sped_participantes → sped_arquivos → empresas`, `p.cnpj = e.cnpj` **literal**) e `cod_sit='00'`. WARNING — normalmente devolução de venda ou erro de cadastro.

**REGRA 9 — Integridade Sequencial Agregada** (2529-2574): variante da REGRA 1 agregando por `(data_mov, cod_item)` com `SUM` de todos os tanques, comparando `est_inic` com `LAG(est_fim)`. **Importante:** usa os campos **ORIGINAIS** (`estq_abert`/`estq_escr`/`vol_entr`) **sem** `COALESCE` com os ajustados — diverge das REGRAS 1 e 3 e pode gerar falsos positivos após a redistribuição do motor V7.

**REGRA 10 — PIS/COFINS Monofásico** (2576-2602): itens C170 de saída com CFOP de combustível cujo `cst_pis` NÃO está em `('04','06')` **OU** `cst_cofins` NÃO está em `('04','06')`. WARNING — combustíveis são monofásicos; na revenda espera-se CST 04/06.

**REGRA 11 — Crédito de ICMS em Frete** (2604-2626): `documentos_d100` (CT-e) com `vl_icms>0` cujo CFOP NÃO começa com `'135'` nem `'235'`. WARNING — crédito de ICMS sobre frete exige CFOP 1.35x/2.35x.

#### 2.3.3. Persistência e liberação de recursos

A persistência (`backend/server.js:2628-2666`) insere todos os erros em `erros_analise` em **chunks de 1000** (`INSERT` multi-VALUES com placeholders `$1..$N`) para não exceder o limite de parâmetros do PostgreSQL. Normaliza `data_erro` para ISO e persiste 11 colunas por erro: `id_sped_arquivo`, `tipo_erro`, `regra_id`, `titulo_erro`, `descricao_erro`, `sugestao_correcao`, `linha_arquivo`, `conteudo_linha`, `data_erro`, `cod_item_erro`, `num_tanque_erro`.

O fechamento (`backend/server.js:2668-2681`) faz `COMMIT`; no `catch`, `safeRollback` + 500; no `finally`, **sempre** libera a conexão (`dbClient.release()`) e o slot do semáforo (`releaseHeavySlot()`), garantindo que falhas não vazem conexões nem travem a fila.

A rota `GET /api/erros/:id` (`backend/server.js:2684-2703`) é leitura simples: valida ID, `safeConnect`, `SELECT * FROM erros_analise WHERE id_sped_arquivo=$1`, libera no `finally`. Sem transação, semáforo ou paginação.

#### 2.3.4. Inconsistências conhecidas do motor

- **Valores ajustados vs originais:** REGRAS 1, 2, 3 e 6(estoque) usam `COALESCE(ajustado, original)`; a REGRA 9 usa **só os originais** — após a redistribuição V7, gera falsos positivos e diverge da REGRA 1.
- **Sobreposição:** REGRA 1 (por tanque) e REGRA 9 (agregada por produto) auditam o mesmo conceito de continuidade — podem reportar o mesmo problema duas vezes com classificações diferentes.
- **Numeração de comentários colidente:** existem duas "REGRA 6" (estoque negativo e CST x CFOP).
- **Comparação de CNPJ inconsistente:** REGRA 2 normaliza via `REGEXP_REPLACE`; REGRA 8 compara literalmente — máscara diferente faz a REGRA 8 falhar silenciosamente.
- **`statement_timeout` LOCAL de 30s:** uma regra lenta pode estourar o timeout e abortar **toda** a transação (exceto a 1B, isolada em SAVEPOINT).
- **`perc` com base `|| 1`** (REGRAS 1B/9): quando o fechamento anterior é 0, o percentual é calculado sobre 1L, gerando valores absurdos.
- **Markdown embutido** em `descricao_erro` (`**...**`): acoplamento com o frontend, que precisa renderizá-lo.

---

### 2.4. CRUD de Empresas, Arquivos e Documentos

Esta camada é a espinha dorsal de navegação: o usuário escolhe a empresa (0000), seleciona um período/arquivo e consulta entradas, saídas e visões analíticas a partir do `id_sped_arquivo`. Todas as rotas usam `authMiddleware` e o padrão `safeConnect`/`safeRollback`.

#### 2.4.1. Listagens e metadados

| Rota | Linhas | O que faz |
|---|---|---|
| `GET /api/empresas` | 2708-2730 | Lista empresas (cadastro 0000); `busca` aplica `ILIKE` em nome/fantasia/CNPJ; ordena por `nome_empresa` |
| `GET /api/arquivos` | 2733-2769 | Lista **todos** os SPEDs (Injetor Global); LEFT JOIN com empresas; filtra `caminho_arquivo IS NOT NULL` e descarta via `fs.existsSync` os ausentes no disco |
| `GET /api/arquivos/:id_empresa` | 2772-2794 | Lista períodos de uma empresa; **não valida** `isNaN` (id inválido retorna lista vazia) |
| `GET /api/arquivo/info/:id` | 2797-2825 | Metadados (id, nome, período, cnpj, empresa, uf, id_empresa) via INNER JOIN; **vaza conexão** (sem `finally`/`release`) |
| `GET /api/arquivos/empresa/:id_empresa` | 4406-4432 | **Duplicata funcional** de `/api/arquivos/:id_empresa`, mas valida `isNaN` (400) |

#### 2.4.2. Consulta e auditoria de documentos

| Rota | Linhas | O que faz |
|---|---|---|
| `GET /api/documentos/entradas/:id_arquivo` | 4090-4135 | C100 entrada (`ind_oper='0'`) + itens C170 via `json_agg` (descrição via `sped_produtos`, nome do fornecedor via `sped_participantes`) |
| `GET /api/documentos/saidas/:id_arquivo` | 4138-4171 | C100 saída (`ind_oper='1'`) + registro **analítico C190** via `json_agg` (saídas de posto são consolidadas por CFOP) |
| `GET /api/documentos/auditoria/nf/:id_arquivo` | 4174-4254 | Consulta analítica de NF de entrada juntando C100 + C190 + C170 (casts `::float8`); paginação `limit`/`offset` |
| `GET /api/documentos/auditoria/saidas/:id_arquivo` | 4257-4359 | Auditoria de saída com modos `modelo` 55/65; modelo 65 agrupa por `(cfop, cst_icms)` usando **valores ajustados** (`COALESCE(vl_*_ajustado, vl_*)`), incluindo CFOP 5929; expõe original vs ajustado lado a lado |

As rotas de leitura acoplam o cabeçalho C100 com seus filhos via subqueries `json_agg`, resolvem descrições de produto por LEFT JOIN com `sped_produtos` (de-para `cod_item`) e nome do participante via `sped_participantes` (`cod_part + id_sped_arquivo`), com casts `::float8` para evitar `numeric` como string. A coluna `*_ajustado` existe porque o motor recalcula vendas a partir de encerrantes/bicos para fechar o LMC e a variação ANP de 0,6%, então a auditoria mostra valor declarado vs valor ajustado.

#### 2.4.3. Escrita e exclusão transacional

| Rota/Helper | Linhas | O que faz |
|---|---|---|
| `POST /api/empresas` | 4365-4403 | Cria empresa; valida `cnpj`/`nome_empresa`; checa duplicidade por igualdade **exata** de CNPJ (sem normalização nem dígito verificador); 201 |
| `DELETE /api/periodo/:id` | 4047-4063 | Exclui período individual via `deleteSpedFile` em transação (atômico) |
| `POST /api/periodo/bulk-delete` | 4065-4087 | Exclusão em lote (uma transação, tudo-ou-nada); ids não-numéricos viram NaN e não casam nada silenciosamente |
| `DELETE /api/empresas/:id` | 4435-4501 | Exclui empresa com cascade opcional (`?cascade=true`); apaga tabelas filhas via `ANY($1::int[])` + `empresa_certificados` e `lmc_tanques_config` |
| `deleteSpedFile` (helper) | 4026-4045 | Apaga em ordem de FK: `erros_analise`, C190/C170 (subquery nos C100), C100, `lmc_movimentacao`, D100, produtos, participantes, e por fim `sped_arquivos` |

O `deleteSpedFile` (`backend/server.js:4026-4045`) **não abre transação própria** — depende do chamador (`DELETE /api/periodo/:id` e `bulk-delete`). Garante remoção de toda a escrita fiscal de um período respeitando FKs, mas **não apaga** `lmc_observacoes` (campo 13 do LMC) nem `encerrantes_exportados`, deixando órfãos ao excluir/reimportar um período.

#### 2.4.4. Gotchas estruturais do CRUD

- `GET /api/arquivo/info/:id` (2797-2825) **não tem `finally`/`release`** — vaza conexão a cada chamada, esgotando o pool sob carga (consistente com o padrão "Pool esgota com exportações em sequência rápida").
- Nem `deleteSpedFile` nem o cascade de empresa limpam `lmc_observacoes` ou `encerrantes_exportados` — órfãos que podem reaparecer/colidir ao reimportar, contribuindo para encerrantes inconsistentes.
- `POST /api/empresas` checa duplicidade de CNPJ por string exata (sem máscara/dígito verificador, sem `UNIQUE` constraint) — `'12.345...'` e `'12345...'` passam como distintos e quebram o JOIN com `lmc_tanques_config` (que normaliza via `REGEXP_REPLACE`); há race condition teórica `SELECT → INSERT`.
- O cascade de `DELETE /api/empresas` **reimplementa manualmente** a lógica de `deleteSpedFile` (acrescentando `empresa_certificados` e `lmc_tanques_config`) — duas implementações de exclusão que podem divergir.
- Duas rotas redundantes listam arquivos por empresa (2772 e 4406) com SELECT idêntico, com validação `isNaN` inconsistente entre elas.
- O alias `nome_fornecedor` é usado também para saídas (cliente) — naming enganoso na API.
- Paginação `limit`/`offset` sem teto máximo nas rotas de auditoria — `limit=999999` é aceito, gerando payloads/`json_agg` pesados.

---

## 3. LMC - Livro de Movimentacao de Combustiveis

### 3.1. Visao geral e conceitos fiscais

O LMC (Livro de Movimentacao de Combustiveis) e o documento diario obrigatorio da ANP para postos revendedores varejistas. No SPED Fiscal, ele e materializado pelos registros do Bloco 1: o **1300** (movimentacao consolidada por combustivel/dia), o **1310** (movimentacao por tanque) e o **1320** (volume de vendas por bico/encerrante). O subsistema LMC do Audisped importa esses registros para a tabela `lmc_movimentacao` e, sobre ela, oferece tres familias de funcionalidades: **diagnostico/leitura** (continuidade entre meses, deteccao de lacunas, montagem do livro diario), **ajuste matematico** (ancoragem de abertura, redistribuicao de vendas, otimizador ANP, correcoes em cascata) e **relatorios/impressao** (resumos gerenciais, dossie PDF/Excel e o PDF do LMC no modelo AutoSystem PRO da Linx).

Conceitos fiscais centrais que permeiam todo o modulo:

- **Encerrantes**: a leitura mecanica/eletronica do bico de bomba (VAL_FECHA = fechamento e VAL_ABERT = abertura no registro 1320). A venda real de cada bico e `Fechamento - Abertura - Afericoes`.
- **Bicos e tanques**: o bico (1320) e a unidade de venda; o tanque (1310) e a unidade de armazenamento. Um produto/combustivel (1300) pode ter varios tanques, e um tanque pode ter varios bicos. A capacidade fisica do tanque (CAP_TANQUE) e o teto que o estoque nunca pode ultrapassar.
- **Estoque de abertura** (`estq_abert`): medicao fisica no inicio do dia. Por continuidade fiscal, a abertura do mes deve casar com o fechamento fisico do mes anterior.
- **Fechamento fisico** (`fech_fisico`): medicao fisica (regua/encerrante) no fim do dia.
- **Estoque escritural**: o estoque "de livro", calculado como `abertura + entradas - saidas`.
- **Perdas e Ganhos**: a diferenca entre fisico e escritural. Negativo indica perda (possivel vazamento/evaporacao/sonegacao); positivo indica sobra/ganho.
- **Variacao ANP 0,6%**: a portaria da ANP tolera variacao fisico-x-escritural de ate **0,6%** sobre o volume. Acima disso o estoque esta fora de conformidade.
- **Colunas `*_ajustado`**: colunas-espelho (`estq_abert_ajustado`, `vol_saidas_ajustado`, `fech_fisico_ajustado`, `val_perda_ajustado`, `val_ganho_ajustado`, `vol_escr_ajustado`, `vol_entr_ajustado`) que armazenam o resultado dos motores de ajuste **sem destruir o dado original** do SPED. Toda a leitura downstream usa `COALESCE(coluna_ajustado, coluna_original)`, de modo que o ajuste prevalece quando existe.

### 3.2. Dados core: continuidade, completude e montagem do livro

Tres rotas GET formam o nucleo de leitura/diagnostico (`backend/server.js`).

| Rota | Linhas | O que faz |
|------|--------|-----------|
| `GET /api/lmc/continuidade/:id_sped` | `server.js:2830-2921` | Verifica se a abertura do mes atual casa com o fechamento fisico do mes anterior |
| `GET /api/lmc/diagnostico-completude/:id` | `server.js:2926-2996` | Detecta dias do periodo sem registro 1300 consolidado |
| `GET /api/lmc/:id_sped` | `server.js:2999-3199` | Monta o LMC diario consolidado por combustivel com cascata escritural e variacao ANP |

#### 3.2.1. Continuidade intermensal (`server.js:2830-2921`)

A regra fiscal e que o estoque de **abertura** de um periodo deve igualar o estoque de **fechamento fisico** do periodo imediatamente anterior do mesmo CNPJ. A rota implementa isso com CTEs encadeadas:

1. `atual` le CNPJ e `periodo_apuracao` do `id_sped`, normalizando o CNPJ via `REGEXP_REPLACE` (remove mascara).
2. `arquivo_anterior` busca o SPED do **mesmo CNPJ normalizado** com periodo (`LEFT(periodo,7)` = YYYY-MM) estritamente menor, ordenado desc com `LIMIT 1` — pega o mes imediatamente anterior; valida o formato com regex `^[0-9]{4}-[0-9]{2}-[0-9]{2}`.
3. `fechamento_ant` pega por produto (`DISTINCT ON TRIM(cod_item)`) o ultimo fechamento fisico do mes anterior, usando `COALESCE(fech_fisico_ajustado, fech_fisico)` — prioriza o valor pos-otimizacao.
4. `abertura_atual` pega por produto o primeiro registro do mes atual, usando `COALESCE(estq_abert_ajustado, estq_abert, 0)`.

O `SELECT` final faz **INNER JOIN** por `cod_item` entre abertura e fechamento, expoe `divergencia = abertura_atual - fechamento_anterior` arredondada a 3 casas, filtra `ABS > 0.1` litro e ordena pela maior divergencia. Um `prevCheck` separado informa `tem_mes_anterior=true` mesmo quando os estoques batem. Retorna `{tem_mes_anterior, divergencias}`.

**Fragilidades conhecidas:**
- O INNER JOIN faz produtos que existem so num dos meses (combustivel novo, descontinuado ou que mudou de `cod_item`) **nao aparecerem** — falso negativo de continuidade. O `TRIM` cobre padding de `CHAR` mas nao mudanca real de codigo.
- A data de fechamento usa `SPLIT_PART(periodo,' a ',2)` enquanto a de abertura usa `SPLIT_PART(periodo,' ',1)` — separadores inconsistentes, fragil se o formato do periodo variar.
- `LEFT(periodo,7)` assume formato mensal YYYY-MM-DD; arquivos anuais/nao-mensais quebram a selecao do "mes anterior".
- Misturar mes otimizado com mes nao otimizado (`fech_fisico_ajustado` x `estq_abert_ajustado`) pode refletir o estado de otimizacao e nao um problema real de continuidade.

#### 3.2.2. Diagnostico de completude (`server.js:2926-2996`)

Detecta lacunas: dias do periodo de apuracao **sem lancamento consolidado 1300**, por produto (caso tipico de SPED gerado pela metade). Passos: le `periodo_apuracao`; faz split por `' a '` esperando exatamente 2 partes (senao `tem_lacuna=false`, degradacao graciosa); valida ambas as datas com regex; consulta `lmc_movimentacao` filtrando `num_tanque='0'` (a linha **consolidada** por produto, equivalente ao 1300, e nao as analiticas 1310/1320), agregando `ARRAY_AGG DISTINCT` dos dias com LMC; gera em JS o calendario completo do periodo via `Date.UTC` (intencionalmente UTC para evitar drift de fuso); para cada produto monta um `Set` e calcula `faltantes`. Retorna por produto `total_dias_periodo`, `total_dias_com_lmc`, `dias_faltantes` e `ultimo_dia_com_lmc`.

**Fragilidades:** depende exclusivamente de `num_tanque='0'` — se o importador so gerou linhas analiticas, **todos os dias aparecem como faltantes** (falso positivo). Nao considera feriados/posto fechado como dias legitimos de nao-operacao, podendo gerar alarme falso. Diferente das outras duas rotas, usa `pool.query` direto (sem `safeConnect`/`release`), entao sob pool esgotado estoura 500 em vez de 503 amigavel.

#### 3.2.3. Montagem do LMC diario (`server.js:2999-3199`)

Monta o livro consolidado por combustivel cruzando a movimentacao fisica (1300/1310/1320) com as NF-e de entrada (C100/C170). A estrutura SQL e composta por CTEs:

- **`ncm_to_lmc`**: de-para NCM(6 digitos)→`cod_item`. Para cada prefixo NCM escolhe o `cod_item` do LMC com **mais entradas** (`vol_entr>0`), resolvendo notas que usam codigo de produto (GASA/GASC/AEHC) diferente do `cod_item` canonico do posto.
- **`items_in_lmc`**: produtos distintos presentes no LMC.
- **`notas_raw`**: le C100 (`ind_oper='0'` = ENTRADA) JOIN C170, resolvendo o `cod_item` (proprio se ja existe no LMC, senao via de-para NCM); filtra por CFOP de compra/entrada de combustivel (`LIKE '110%','210%','165%','265%','065%','116%','216%'`) OU por NCM iniciando em `2710` (derivados de petroleo), `2207` (alcool etilico) ou `2711` (GLP/GNV) desde que o `cod_item` esteja no LMC; data = `COALESCE(dt_e_s, dt_doc)`; fornecedor via `sped_participantes`.
- **`notas_entrada`**: agrupa por `cod_item` resolvido e data, somando volume e agregando JSON com detalhes das NFs.
- **`lmc_entrada`**: agrega a movimentacao fisica por `cod_item`/`data_mov` somando todas as colunas (originais e `_ajustado`).

O `SELECT` final faz **FULL OUTER JOIN** entre `lmc_entrada` e `notas_entrada` (por `cod_item`+data), garantindo que aparecam tanto dias com LMC sem nota quanto dias com nota sem LMC; traz a capacidade via `lmc_tanques_config` (match por CNPJ normalizado + `cod_item`).

**Cascata calculada em JS (linha a linha, por produto ordenado por data):**

```
abertura      = COALESCE(estq_abert_ajustado, estq_abert)   // FASE 21: prioriza ancora
saida         = COALESCE(vol_saidas_ajustado, vol_saidas)
fisico        = COALESCE(fech_fisico_ajustado, fech_fisico)
escritural    = abertura + entrada - saida                  // sempre recalculado
diff (litros) = fisico - escritural
%ANP          = ABS(diff) / fisico * 100
limite_litros = fisico * 0,006                              // tolerancia ANP 0,6%
excesso       = max(0, ABS(diff) - limite)
vol_disponivel= abertura + entrada
```

Status atribuido sequencialmente: `ERRO DE BASE` se `fisico<=0`; `FORA LIMITE` se `%ANP>=0.61`; `EXCESSO` se `cap>0 e fisico>cap` (transbordo); `NEGATIVO` se escritural ou fisico `< -0.01`. A precedencia efetiva e **NEGATIVO > EXCESSO > (FORA LIMITE / ERRO DE BASE)**.

**Fragilidades:**
- O FULL OUTER JOIN casa por `(cod_item, data)`: uma NF-e cuja data de entrada nao coincide com o lancamento fisico gera **duas linhas separadas** (so-nota e so-LMC) em vez de uma conciliada.
- O escritural usa `COALESCE(l.vol_entr,0)` (entrada **nao** ajustada) enquanto abertura e saida usam as versoes ajustadas — mistura ajustado/nao-ajustado pode produzir diff inconsistente.
- O de-para `ncm_to_lmc` escolhe o `cod_item` de maior volume para um NCM6; postos com dois produtos do mesmo NCM6 (ex.: dois diesel) podem ter a nota atribuida ao produto errado.
- O limiar de status (`0.61`) diverge conceitualmente do `limite_litros` (`0,006`): 0,60% exatos passam como CONFORME.
- `lmc_tanques_config` faz match por `cod_item` **exato** (sem `TRIM`) enquanto outras CTEs usam `TRIM` — padding de `CHAR` quebra o join da capacidade e desativa a deteccao de EXCESSO.
- Um registro com `fisico=0` e escritural negativo termina como `NEGATIVO`, mascarando o `ERRO DE BASE`.

### 3.3. Estoque e sincronizacao: ancoragem, redistribuicao e correcao

Este conjunto permite ao auditor **ancorar** o estoque de abertura de um produto/mes e, a partir desse valor, redistribuir matematicamente as vendas e os fechamentos diarios de cada tanque, gravando colunas `*_ajustado` (`server.js:3202-3684`).

| Rota / helper | Linhas | O que faz |
|---------------|--------|-----------|
| `POST /api/lmc/update-estoque-inicial` | `server.js:3202-3252` | Ancora a abertura (dia 1) sem aplicar cascata |
| `calcularSincronizacaoPreview` | `server.js:3254-3570` | Motor de redistribuicao (busca binaria por segmento) |
| `POST /api/lmc/preview-sincronizacao` | `server.js:3572-3592` | Calcula previa sem gravar |
| `POST /api/lmc/confirmar-sincronizacao` | `server.js:3594-3627` | Persiste a redistribuicao (recalcula) |
| `POST /api/lmc/corrigir-distribuicao` | `server.js:3629-3684` | Reaplica o motor usando a abertura ja ancorada |

#### 3.3.1. Ancoragem da abertura (`server.js:3202-3252`)

Recebe `{id_arquivo, cod_item, novo_estoque}` (`novo_estoque===undefined` rejeita, mas 0 e valido). Em transacao: garante a coluna `estq_abert_ajustado` via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (DDL dentro do `BEGIN`), busca a **primeira** `data_mov` do produto (dia 1) e faz `UPDATE estq_abert_ajustado = novo_estoque` para **todos os tanques** desse dia. Fixa a abertura do 1300/1310 do dia 1; **nao** aplica cascata — a redistribuicao fica nas rotas seguintes.

#### 3.3.2. Motor de redistribuicao (`server.js:3254-3570`)

O nucleo `calcularSincronizacaoPreview(dbClient, id_arquivo, cod_item, novo_estoque)`:

1. `TRIM(cod_item)=$2` defensivo para casar legado `CHAR(60)`.
2. `capacidadeTotal` = `SUM(capacidade)` de `lmc_tanques_config` join `sped_arquivos` por CNPJ **normalizado** (`REGEXP_REPLACE`).
3. `dailyItems` = consolidado por dia somando `vol_entr/vol_saidas/estq_abert/fech_fisico/val_perda/val_ganho`.
4. `originalRows` = registros por tanque (data ASC, `num_tanque` ASC); `normalizeDate` corta o `T` para evitar drift de timezone.
5. **Segmentacao** entre entradas de combustivel: corta segmento quando ha entrada a partir do 2o dia — cada chegada de carga reinicia o ciclo.
6. **`cascataSegmento`**: para cada dia `disp = stock + entradas`; a capacidade forca **aumentar** a saida se `(disp-sf) > cap*0.994`; `sf` limitado a `disp-0.001` (nunca vender mais que o disponivel); perda/ganho capados pelo teto ANP — `capPerda = escr*0.006/1.006`, `capGanho = escr*0.006/0.994` (algebra para que apos a variacao o resultado fique exatamente no limite 0,6%); `fech` capado a `cap*0.99`.
7. **Busca binaria por segmento** (30 iteracoes) do maior fator 0..1 aplicado proporcionalmente as vendas originais tal que nenhum dia com venda fique abaixo de `max(1L, 0,5% da venda original)` — evita "dia zerado com NFC-e".
8. Fallback de minimo simbolico (`saidaOrig*0.001`) e **trava fiscal** final (`0,001L` se havia venda original).
9. **Cascata por tanque**: rateia o fisico consolidado proporcional ao `fech_fisico` original de cada tanque (garante `SUM(fAjustado)==fisicoCalc`); abertura do tanque = fechamento do dia anterior do mesmo tanque (`lastClosingByTank`); no 1o dia rateia a abertura ancorada por peso de `estq_abert`; `escrTanque = abert+entr-saida`; `diffPG` vira perda ou ganho por tanque.

Retorna `resumo` (antes/depois), array `dias` e array `updates` (por id) consumido pelos endpoints de gravacao.

#### 3.3.3. Preview / confirmar / corrigir

- **`preview-sincronizacao`** chama o motor por item e devolve `{previews}` sem gravar.
- **`confirmar-sincronizacao`** persiste em transacao multi-item, gravando `estq_abert_ajustado`, `vol_saidas_ajustado`, `fech_fisico_ajustado`, `val_perda_ajustado`, `val_ganho_ajustado`, `vol_escr_ajustado` e **copiando** `vol_entr_ajustado = vol_entr` (entradas nao mudam — sao fixadas pelas NF-e/C100). **Recalcula** o motor (nao confia no preview anterior).
- **`corrigir-distribuicao`** le `SUM(estq_abert_ajustado)` do 1o dia; bloqueia se nao houve ancoragem previa (`Sincronize o estoque inicial primeiro`). O comentario declara intencao de "delta-shift" (subir o fisico de todos os dias preservando as saidas originais), **mas na pratica reusa o mesmo motor de busca binaria** — as saidas sao reescaladas, nao restauradas.

**Fragilidades:**
- **Dobra de volume:** `dailyItems` soma todos os `num_tanque` **inclusive a linha consolidada `'0'`**; se existirem simultaneamente as linhas por tanque e a linha `'0'`, o consolidado soma o dobro do volume real.
- **DDL em transacao:** `ALTER TABLE ADD COLUMN IF NOT EXISTS` a cada chamada adquire lock no catalogo (fragil sob concorrencia; deveria estar so no setup).
- **Inconsistencia de `cod_item`:** `update-estoque-inicial`/`corrigir-distribuicao` usam `cod_item = $2` (igualdade exata) enquanto o motor usa `TRIM(cod_item)` — em legado com padding a ancora pode nao atualizar nada enquanto o preview encontra registros.
- O comentario "delta-shift / saidas voltam ao original" e enganoso — pode mascarar subdeclaracao de saidas.
- `capacidadeTotal=0` (sem config ou CNPJ que nao casa) **desativa silenciosamente** todos os caps de capacidade.
- Ancorar manualmente o dia 1 pode quebrar a continuidade intermensal sem revalidacao.
- Os endpoints recebem `id_arquivo`/`cod_item` do body **sem checar ownership** alem do `authMiddleware` generico.

### 3.4. Otimizador matematico (`POST /api/lmc/otimizador-matematico`)

A rota `server.js:3686-4019` recalcula matematicamente os numeros do LMC de um item/combustivel, ajustando vendas, aberturas, fechamentos, perdas e ganhos para que a cascata feche dentro da variacao ANP de 0,6%, sem transbordar a capacidade nem gerar estoque negativo. Trabalha sobre o consolidado diario, encontra o volume total de vendas mais coerente e redistribui de volta para cada tanque. Recebe `{id_arquivo, cod_item, volume_alvo?, auto?}`; e atomica (`BEGIN`/`COMMIT`, `ROLLBACK` em erro).

| Passo | Linhas | O que faz |
|-------|--------|-----------|
| Cabecalho/validacao/setup | `3686-3697` | Valida `id_arquivo`+`cod_item`; `safeConnect`; `BEGIN` |
| 1 — Capacidade total | `3698-3705` | `SUM(capacidade)` por CNPJ — teto fisico das travas |
| 2 — LMC consolidado por dia | `3707-3728` | Soma todos os tanques do produto por `data_mov` |
| 3 — Registros por tanque + normalizacao | `3730-3754` | Granularidade por tanque para o rateio final |
| 4 — Abertura inicial + blindagem | `3756-3778` | `estq_abert_ajustado ?? estq_abert ?? 0`; abertura `<0` vira `0.5L` |
| 4.0 — Motor V7 (curandeiro analitico) | `3780-3799` | Saneia vendas impossiveis preservando minimo NFC-e; ancora no fisico |
| 4.1 — `targetReal` + travas V5/V6 | `3801-3846` | Venda minima (transbordo) e maxima (estoque disponivel) |
| 4.1b — Loop de convergencia | `3847-3905` | Ate 100 iteracoes, tolerancia 0,5L, redistribuicao proporcional |
| 4.2 — Trava fiscal NFC-e | `3907-3914` | Dia com venda comprovada nunca fica com saida zero |
| 5 — Redistribuicao por tanque + cap ANP | `3916-3979` | Cascata por tanque com cap de perda/ganho 0,6% |
| 5b — Protecao 3 | `3981-3988` | Avisa (nao corrige) se fechamento final caiu abaixo de 0,5L |
| 6 — Persistencia | `3990-4003` | `UPDATE` das colunas `*_ajustado` |
| 7 — COMMIT/resposta/erro | `4005-4019` | Retorna `{success, message, trava_anp}` |

**Detalhamento dos motores:**

- **V7 / Curandeiro Analitico** (`3780-3799`): percorre os dias em cascata; `maxSaidaPermitida = tempStock + entradas - 0.5` (mantem 0,5L de fundo de tanque). Se a venda original excede o estoque disponivel (erro classico de PDV), corta a saida, mas com trava fiscal: se havia venda real (`saidaOrig>0`, comprovada por NFC-e) preserva `minimoFiscal = max(0.001, saidaOrig*0.001)`. A **Fase 3 Ancora** (`3796`): se o fechamento fisico original supera o calculado e `fisicoOrig>0` e `saidaOrig>0`, adota a medicao fisica como piso (interpretacao: combustivel real existia na regua).
- **V5 (venda minima / transbordo)** (`3801-3846`): so roda se `capacidadeTotal>0`. `margemSegurancaANP=0.0055` (0,55%, abaixo do limite legal). Simula a cascata sem vender; quando o estoque pico ultrapassa `capacidade*(1+0.0055)`, calcula `excedente = estoque - capacidade*0.98` e soma a `totalVendaMinimaNecessaria`, elevando `targetReal` se necessario (senao o tanque transborda).
- **V6 (venda maxima)**: `vendaMaximaPossivel = entradas + abertura - 0.5`; limita `targetReal` (nao se vende o que nao se tem).
- **Loop de convergencia** (`3847-3905`): a cada passo `diff = targetReal - currentTotalSaida`; converge se `|diff|<=0.5L`. Calcula `minFisicoFuturo[i]` (varredura reversa) = quanto se pode aumentar a venda no dia `i` sem deixar dia futuro negativo. Se `diff>0` distribui o aumento proporcional ao folego; se `diff<0` rateia a reducao proporcional ao peso da venda, nunca zerando.
- **Cap ANP por tanque** (`3931-3937`): `capPerdaOtim = escrCalc*(0.006/1.006)`, `capGanhoOtim = escrCalc*(0.006/0.994)` — algebra correta porque a variacao e medida sobre o fisico. `fisicoCalc` final capado em `capacidadeTotal*0.99`.

**Persistencia** (`3990-4003`): loop de `UPDATE` gravando as 6 colunas `*_ajustado` e espelhando `vol_entr_ajustado = vol_entr`. `trava_anp` no JSON permite ao frontend destacar quando o alvo de venda foi alterado por imposicao legal/fisica.

**Fragilidades:**
- **JOIN de CNPJ cru** no passo 1 (`a.cnpj_empresa = c.cnpj`) — enquanto a funcao irma `calcularSincronizacaoPreview` usa `REGEXP_REPLACE`. Se um lado estiver mascarado, `capacidadeTotal=0` e **todas as travas V5/V6 e o cap de transbordo desligam silenciosamente**.
- `cod_item` sem `TRIM` nos passos 1-3 (legado com padding nao casa).
- **Convergencia nao garantida:** com poucos dias elegiveis o loop faz `break` sem atingir o alvo, sem aviso (so a Protecao 3 detecta fechamento `<0,5L`).
- **Reset de estoque negativo para 0,5L** (`3765`) descarta o volume negativo original sem trilha alem de um warn.
- **Transbordo residual por tanque:** o cap consolidado em `capacidade*0.99` nao verifica a capacidade individual de cada tanque no rateio.
- **Duas reconstrucoes divergentes:** o loop 4.1b usa `fisicoCalc = escrCalc` (ignora perda/ganho) enquanto o passo 5 recalcula com cap ANP — leve inconsistencia entre alvo planejado e gravado.
- Comentarios com typos ('mACIMO', 'PArDA', 'diffPArdaGanho') dificultam manutencao.
- N `UPDATE`s sequenciais numa transacao longa contribuem para o esgotamento de pool conhecido.

### 3.5. Correcoes e ajustes em cascata (`server.js:5320-5604`)

Rotas que aplicam correcoes fiscais sobre dados ja importados — correcao manual de documentos/LMC, correcao em massa de CST e ajuste manual de saidas com propagacao em cascata.

| Rota | Linhas | O que faz |
|------|--------|-----------|
| `POST /api/corrigir-item` | `5320-5359` | Correcao manual de um registro (C170/C100/C190/LMC) |
| `POST /api/corrigir-massa` | `5362-5399` | Correcao em lote de CST por regra de auditoria |
| `POST /api/lmc/ajustar-cascata` | `5402-5499` | Ajuste de saida de um dia com propagacao dia a dia |
| `POST /api/lmc/ajustar` | `5505-5534` | Ajuste pontual de um dia, **sem** cascata |
| `POST /api/lmc/ajustar-lote` | `5537-5573` | Versao bulk do ajuste pontual |
| `GET /api/lmc/observacoes/:id_sped` | `5576-5587` | Le observacoes (campo 13 do LMC) |
| `POST /api/lmc/observacoes` | `5589-5604` | Upsert de observacao por (arquivo, item, data) |

#### 3.5.1. Correcao manual e em massa

**`corrigir-item`** (`5320-5359`) roteia o `tipo` para uma de 4 tabelas (C170, C100, C190, LMC) e monta um `UPDATE` dinamico: as chaves de `novos_valores` viram colunas interpoladas (`${key} = $N`) e os valores vao parametrizados. Corrige tributacao errada apontada na analise (ex.: CST 000 indevido sob ST, deveria ser 060/500). **Nao recalcula o C190 nem dependencias** quando altera C170/C100.

**`corrigir-massa`** (`5362-5399`) implementa **somente** a regra `RTAX-C170-01` (Tributacao Incompativel: venda de combustivel com CFOP do grupo mas CST de tributacao integral). Busca `cod_item_erro` distintos marcados com a regra em `erros_analise` e faz `UPDATE` de `cst_icms` para esses itens no arquivo. Qualquer `regra_id` diferente e **no-op silencioso** que ainda retorna 200.

#### 3.5.2. Ajuste em cascata (`server.js:5402-5499`)

Recebe `{id_sped, cod_item, data_mov, vol_saidas_ajustado}`. Le todos os dias do produto ordenados por `data_mov` ASC com `COALESCE(ajustado, original)`. Localiza `editIndex` por data normalizada (`toISOString().split('T')[0]`). A partir do dia editado:

```
abertura (dia editado) = abertura do proprio dia
abertura (dias seguintes) = prevFisico (fechamento fisico do dia anterior)  // CASCATA
maxSaida = max(0, abertura + entradas - 0,5)                                 // estoque min 0,5L
escritural = max(0, abertura + entradas - saida)
pctPerda = val_perda_orig / baseOrig ; pctGanho = val_ganho_orig / baseOrig  // baseOrig = estq_abert_orig + vol_entr_orig
capPerda = escritural*(0,006/1,006) ; capGanho = escritural*(0,006/0,994)    // teto ANP 0,6%
fisico = max(0, escritural + ganhoNovo - perdaNova)
prevFisico = fisico  // vira abertura do proximo dia
```

Grava as 6 colunas `*_ajustado`. A **Protecao 3** (`5482-5488`) so loga warning se a abertura do 1o dia for `>0` e o fechamento do ultimo `<0,5` — nao bloqueia.

**`ajustar`** (`5505-5534`) e o ajuste pontual simples: `UPDATE` apenas de `vol_saidas_ajustado` e `fech_fisico_ajustado` por `id_sped_arquivo+cod_item+data_mov` (afeta **todas** as linhas/tanques do dia), sem transacao, sem propagar continuidade. **`ajustar-lote`** (`5537-5573`) e a versao bulk numa unica transacao.

**Fragilidades criticas:**
- **SQL injection em `corrigir-item`:** os **nomes de coluna** vem de `Object.keys(novos_valores)` e sao interpolados sem whitelist (os valores estao parametrizados). Mitigado apenas pelo JWT.
- `corrigir-item` nao valida o `tipo` (tipo desconhecido faz COMMIT e retorna 200 sem alterar nada — falso positivo).
- Alterar `cst_icms`/`cfop` no C170 **nao recalcula o C190** — risco de inconsistencia C170 x C190 na exportacao.
- **`ajustar-cascata` achata multi-tanque:** o SELECT pega todas as linhas do produto (consolidado `'0'` **e** tanques individuais) ordenadas so por `data_mov`, **sem PARTITION por `num_tanque`** — se houver mais de uma linha por data, a cascata encadeia tanques diferentes como dias sequenciais, corrompendo `prevFisico→abertura`.
- `ajustar-cascata` **nao recalcula `vol_entr_ajustado`**; se `atualizarEntradaLmcXml` (`server.js:1041-1094`) rodar depois, sobrescreve `vol_escr_ajustado` — dependencia de ordem fragil.
- Dias apos o editado tem a venda **silenciosamente truncada** por `max(abertura+entradas-0,5)`, mascarando vendas declaradas nos encerrantes.
- `ajustar`/`ajustar-lote` aplicam o **mesmo** valor a todas as linhas do dia (consolidado + cada tanque), sobrescrevendo dados por tanque com valor agregado.
- Comparacao de datas via `toISOString()` (UTC) pode deslocar o dia (off-by-one) se `data_mov` vier com hora/fuso.

### 3.6. Configuracao de tanques e capacidade

A capacidade fisica do tanque nao vem confiavel no SPED (so existe no campo `CAP_TANQUE` do 1310 a partir do leiaute **020**), entao o sistema a persiste manualmente em `lmc_tanques_config` (`server.js:4991-5103`). Essa capacidade alimenta a regra `CRIT-1310-01` (estoque final nao pode exceder a capacidade) e os motores de redistribuicao/otimizador.

| Rota | Linhas | O que faz |
|------|--------|-----------|
| `GET /api/lmc/tanques-config/:cnpj` | `4991-5007` | Le capacidades configuradas por `cod_item` |
| `GET /api/lmc/tanques-sugeridos/:id_arquivo` | `5009-5072` | Sugere capacidade lendo `CAP_TANQUE` do SPED em disco |
| `POST /api/lmc/tanques-config` | `5074-5103` | UPSERT em lote por `(cnpj, cod_item)` |

A **sugestao** (`5009-5072`) le o `.txt` SPED original em disco (encoding `latin1`), captura a versao do leiaute no 0000 (default `'019'`), fixa o `cod_item` corrente nos registros 1300 e, nos 1310, le `NUM_TANQUE` (`f[2]`) e `CAP_TANQUE` (`f[11]`, **so existe no leiaute 020**). Usa `Math.max` por tanque (o mesmo tanque repete todo dia no 1310) e soma as capacidades distintas por combustivel — formato compativel com `lmc_tanques_config` (por `cod_item`, nao por tanque). O **UPSERT** (`5074-5103`) usa `ON CONFLICT (cnpj, cod_item) DO UPDATE SET capacidade = EXCLUDED.capacidade`.

**Fragilidades:**
- A sugestao usa `parseFloat(f[11])` **sem `replace(',','.')`** — se o EFD usar virgula decimal (padrao BR), `15000,500` vira `15000` (perde casas), inconsistente com os demais parsings.
- `tanques-config` (GET e POST) compara/grava o CNPJ **literal sem `REGEXP_REPLACE`**, enquanto os consumidores (CRIT-1310 em `~2242`, motor em `~3121`) normalizam o CNPJ — risco de gravar com mascara e a auditoria nao casar, ou criar duas linhas logicas que escapam do `UNIQUE`.
- A sugestao confia que `CAP_TANQUE` esta sempre em `f[11]` (correto no layout atual, mas fragil a mudancas) e retorna `[]` (200) quando o arquivo nao existe em disco — o frontend nao distingue "sem capacidade no SPED" de "arquivo apagado".
- POST nao valida `capacidade` numerica/positiva nem `cod_item` nao-vazio (permite lixo que zera/inverte o teto).

### 3.7. Relatorios gerenciais e fiscais (`server.js:4504-4986`)

Quatro rotas GET combinam o SPED (C100/C170/C190) com o LMC para entregar resumo gerencial, posicao de estoque, rentabilidade e PDF de posicao.

| Rota | Linhas | O que faz |
|------|--------|-----------|
| `GET /api/resumo/:id_arquivo` | `4504-4669` | Resumo de entradas/saidas por CFOP + combustiveis + estoque com variacao ANP |
| `GET /api/estoque-resumo/:id_arquivo` | `4672-4707` | Posicao de estoque do ultimo dia com flag de anomalia |
| `GET /api/relatorio/rentabilidade/:id_arquivo` | `4711-4832` | Custo medio/rentabilidade por produto |
| `GET /api/relatorio/rentabilidade/:id_arquivo/pdf` | `4833-4986` | PDF de Posicao de Estoque (PDFKit) |

O **resumo** (`4504-4669`) roda 5 queries em paralelo (`Promise.all`): entradas/saidas agrupadas por CFOP no C190; classificacao de combustivel por `descr_item` (ILIKE `%GASOLINA%`→GASOLINA, `%ETANOL%`/`%ALCOOL%`→ETANOL, `%DIESEL%`→DIESEL, else OUTROS); totais por `ind_oper` excluindo cancelados (`cod_sit='02'`); e a CTE de estoque (`4575-4619`) que soma `estq_abert` do primeiro dia (inicial), `COALESCE(fech_fisico_ajustado, fech_fisico)` do ultimo dia (final) e entradas/saidas `*_ajustado` do periodo, agregados por `cod_item`. Em JS calcula `esperado = inicial + entradas - saidas`, `variacao = final - esperado`, `variacao_perc = abs(variacao)/(inicial+entradas)*100` e classifica status: **>0,6% CRITICAL**, **>0,4% WARNING** (heuristica interna, nao limite legal), senao OK.

A **rentabilidade** (`4711-4832`) calcula custo medio ponderado das compras (CMV simplificado) com **fallback de preco** pela ultima compra/venda historica da empresa inteira (CTEs `DISTINCT ON (cod_item)` cross-arquivo, `4744-4769`); identifica combustiveis pela **presenca no LMC** (criterio mais robusto que ILIKE). O **PDF** (`4833-4986`) gera a Posicao de Estoque A4 com colunas [Codigo, Produto, Est.Inic., Entradas, Vendas, Est.Final, Custo(M)], linhas zebradas e quebra de pagina em `doc.y>750`.

**Fragilidades:**
- **Inconsistencia de fonte:** `/api/resumo` usa `COALESCE(fech_fisico_ajustado, fech_fisico)` mas `/api/estoque-resumo` usa `fech_fisico` puro — dois relatorios podem mostrar estoque final divergente para o mesmo arquivo.
- O estoque **inicial** usa sempre `estq_abert` (nunca `estq_abert_ajustado`), apesar de o ajuste de abertura existir e ser usado na exportacao — relatorios ignoram a ancora aplicada.
- `/api/resumo` e `/api/estoque-resumo` **nao tem `authMiddleware`** (rotas publicas) — exposicao de dados fiscais sem token.
- `variacao_perc` com denominador `(inicial+entradas)`: se ambos forem 0 retorna 0, mascarando saidas sem estoque/entrada.
- A classificacao por ILIKE agrupa "GASOLINA ADITIVADA" e "DIESEL S10/S500" juntos; descricoes atipicas caem em OUTROS.
- No PDF, `descr_item.substring(0,35)` lanca `TypeError` se a descricao for `null` (SELECT do PDF nao envolve `descr_item` em `COALESCE`); a coluna "Vendas" mistura saidas C170 (litros NF-e) com saidas LMC (encerrantes) via `COALESCE(v.qtd, l.saidas_lmc, 0)`.
- `Promise.all` no resumo: se uma das 5 queries falha, todas abortam num 500 generico sem indicar qual.

### 3.8. Dossie, Excel e resumo por participante (`server.js:5106-5316`)

| Rota | Linhas | O que faz |
|------|--------|-----------|
| `GET /api/resumo/participante/:id_arquivo` | `5106-5160` | Compras por fornecedor e vendas por cliente (C100) |
| `GET /api/relatorio/dossie/:id` | `5162-5253` | PDF do dossie tecnico de conformidade (PDFKit) |
| `GET /api/relatorio/excel/:id` | `5255-5316` | Planilha XLSX dos erros de auditoria (ExcelJS) |

O **resumo por participante** (`5106-5160`) agrega `vl_doc` do C100 por `cod_part`/nome (`LEFT JOIN sped_participantes`), separando `ind_oper='0'` (compras) e `'1'` (vendas). O **dossie PDF** (`5162-5253`) lista os erros de `erros_analise` classificados em CRITICAL (vermelho) vs WARNING (ambar), com resumo de riscos e detalhamento (descricao e sugestao de correcao). O **Excel** (`5255-5316`) exporta os mesmos erros com colunas ID/Tipo/Regra/Titulo/Descricao/Sugestao/Codigo Item/Data.

**Fragilidades:**
- `resumo/participante` **nao tem `authMiddleware`** e soma `vl_doc` bruto **sem filtrar `cod_sit`** (inclui notas canceladas), usando `vl_doc` e nao `vl_doc_ajustado`.
- O dossie cria `PDFDocument` **sem `bufferPages:true`** mas o rodape usa `bufferedPageRange()`/`switchToPage()` — o rodape provavelmente nao e emitido (count 0).
- O bloco RESUMO DE RISCOS usa `doc.y+offset` tres vezes seguidas (`doc.y` avancando entre os `text()`) — textos podem se sobrepor.
- PDF e Excel chamam `descricao_erro.replace`/`sugestao` **sem null-guard** (`TypeError` se o campo for `null`).
- O Excel nao inclui `num_tanque_erro` nem `conteudo_linha`/`linha_arquivo` (perde o detalhe do tanque), seleciona `nome_empresa`/`cnpj` mas nunca os usa, e usa `parseInt` sem `isNaN` (id invalido cai em 404, nao 400).

### 3.9. Impressao do LMC — PDF no modelo AutoSystem PRO (Linx)

O modulo `backend/lmc-pdf.js` (281 linhas) e a rota `GET /api/lmc/imprimir/:id_sped` (`server.js:5607-5881`) geram o PDF do LMC reproduzindo fielmente o layout do AutoSystem PRO da Linx: **uma folha por combinacao dia+combustivel**, com os campos numerados de 1 a 13.

| Item | Arquivo:linhas | O que faz |
|------|----------------|-----------|
| `GET /api/lmc/imprimir/:id_sped` | `server.js:5607-5881` | Monta e transmite o PDF |
| `formatNum` | `lmc-pdf.js:4-7` | Formata numero no padrao BR (virgula decimal, ponto de milhar) |
| `gerarPaginaLMC` | `lmc-pdf.js:9-278` | Renderiza uma folha do LMC no PDFKit |

#### 3.9.1. Montagem (`server.js:5607-5881`)

Le query params (`combustivel` default `'todos'`, `data_inicio`, `data_fim`, `folha_inicial` default 1). Busca `sped_arquivos` (404 se nao existe), normaliza CNPJ e busca a razao social em `empresas`. Le a **IE diretamente do SPED em disco** (latin1) capturando o 9o campo do registro 0000 (fragil — ver fragilidades). Monta `prodNomes` filtrando `sped_produtos` por termos de combustivel (GASOLINA/ETANOL/DIESEL/GNV/BIODIESEL/QUEROSENE/GLP/ALCOOL), restringindo o LMC aos combustiveis da ANP e excluindo lubrificantes/conveniencia.

A **query principal** le estoque/entradas/saidas/fechamento/perda/ganho de `lmc_movimentacao` com `COALESCE(*_ajustado, *)` (sempre prioriza o ajustado). Os **encerrantes 1320** sao relidos do SPED em disco: a varredura mantem contexto (`curr1300Dt`/`curr1300Cod`/`currTanque`) e para cada 1320 monta `bicosData` com `enc_final` (`p[8]`=VAL_FECHA), `enc_inicial` (`p[9]`=VAL_ABERT), afericao (`p[10]`=VOL_AFERI) e vendas (`p[11]`=VOL_VENDAS). O LMC e agrupado em `diasProdutos` Map(`dt_cod` → `{tanques[], total}`): a linha `num_tanque='0'` e o **total consolidado**; as demais sao os tanques fisicos. As **NF-e de entrada** (C100+C170, `cod_mod IN ('01','55')`, CFOP iniciando em 1/2/3) alimentam o campo 4 via `entradasMap`. O **valor de vendas** vem do total NFC-e do dia (`cod_mod='65'`, `ind_oper='1'`) **rateado proporcionalmente** pelo volume de cada produto (`valorDia = nfceTotal * litrosProd/litrosDia`).

#### 3.9.2. Renderizacao da folha (`lmc-pdf.js:9-278`)

`gerarPaginaLMC` desenha o formulario ANP em A4, layout 2 colunas (40% direita / 60% esquerda), distribuindo a sobra vertical entre o bloco 4 (Recebimento, 35%) e o 13 (Observacoes, 65%). Os campos:

- **Cabecalho:** titulo LMC + Empresa/CNPJ/IE + "Fl. nr." (numeracao sequencial do livro fisico).
- **1) Produto** e **2) Data**.
- **3) Estoque de Abertura:** ate 6 tanques (num + abertura) e **3.1) total**.
- **4) Volume Recebido:** lista NF-e de entrada; 4.1 Nr.TQ Descarga, 4.2 Volume Recebido, 4.3 Total Recebido, 4.4 Vol.Disponivel (`3.1+4.3`).
- **5) Volume Vendido por bico:** tabela de 6 colunas — 5.1 Tanque, 5.2 Bico, 5.3 +Fechamento, 5.4 -Abertura, 5.5 -Afericoes, 5.6 =Vendas Bico (**`Vendas = Fechamento - Abertura - Afericoes`**, a logica do encerrante). 5.7 Vendas no dia.
- **6) Estoque Escritural** (`4.4-5.7`); **7) Estoque de Fechamento** (`=9.1`).
- **8) Perdas+Sobras** (`ganho - perda`; positivo=sobra, negativo=perda/possivel vazamento).
- **9) Conciliacao dos Estoques** (fechamento fisico por tanque + 9.1 total).
- **10) Valor Vendas R$** + preco medio/litro + 10.1 valor do dia + 10.2 acumulado no mes.
- **11) Uso do Revendedor** (litros acumulados no mes); **12) Destinado a Fiscalizacao**; **13) Observacoes** (preco por bico + texto livre de `lmc_observacoes`).
- **Aviso** em negrito: resultado negativo de perdas/sobras pode indicar vazamento ambiental (alerta ANP). **Rodape:** marca Audisped + razao social + data/hora + nº pagina.

**Fragilidades:**
- O SPED em disco e lido **duas vezes** por requisicao (`fs.readFileSync` sincrono, linhas 5639 e 5691) — bloqueia o event loop e dobra a I/O.
- A extracao da IE por indice posicional fixo no 0000 e fragil a variacoes de versao do guia EFD.
- **Divergencia encerrante x saida ajustada:** os bicos (5.6) vem do SPED **original** no disco, enquanto saidas (5.7) vem de `lmc_movimentacao` com `*_ajustado`; se o motor alterou volumes, a soma dos bicos **nao bate** com as vendas do dia.
- `litrosProd` usa `SUM(vol_saidas)` **sem `COALESCE`** para ajustado (linha 5787), divergindo da query principal — duas fontes de litros para o mesmo dia/produto.
- Ordenacao **textual** de `num_tanque` pode embaralhar tanques de 2 digitos (`'10'` ordena entre `'1'` e `'2'`); o agrupamento (linha 5721) pode gravar um tanque como total **e** como tanque se for o primeiro registro retornado.
- O valor de vendas e **estimado** por rateio NFC-e; postos que vendem por NF-e modelo 55 (ou sem NFC-e) terao o campo 10 zerado.
- Apenas **6 tanques** sao renderizados (abertura e conciliacao); produtos com mais tanques tem tanques omitidos (embora 3.1/9.1 mantenham o total).
- A tabela de bicos (linha 153) nao tem limite de altura — muitos bicos podem invadir o bloco 10. O fallback de tanques (linha 5858) cria um tanque ficticio `'1'` se a lista vier vazia, mascarando dados incompletos do 1310.

### 3.10. Helpers transversais e dependencias

Todo o subsistema LMC compartilha tres helpers de infraestrutura (`server.js:83-147`):

- **`safeConnect(res)`** (`83-93`): obtem conexao do pool; em pool esgotado responde **503** "Servidor sobrecarregado" e retorna `null` (as rotas fazem `if (!dbClient) return`). Relevante porque o pool esgota em exportacoes em sequencia rapida.
- **`safeRollback(client)`** (`96-98`): `ROLLBACK` envolto em try/catch silencioso, para nunca derrubar o processo se a conexao ja quebrou.
- **`authMiddleware`** (`129-147`): valida JWT (header `Authorization Bearer` ou `?token`); 401 sem token, 403 se invalido. **Aplicado de forma inconsistente** — ausente em `/api/resumo`, `/api/estoque-resumo` e `/api/resumo/participante`.

O schema das tabelas centrais esta em `setup_db.js` (`lmc_movimentacao` em `92-130`, `lmc_tanques_config` em `152-158`); as colunas `*_ajustado` sao criadas em `setup_db.js`/`migrate_db.js`. A funcao `atualizarEntradaLmcXml` (`server.js:1041-1094`) mantem `vol_entr_ajustado`/`vol_escr_ajustado` a partir das NF-e de entrada por uma via paralela aos motores de ajuste — fonte de uma dependencia de ordem de execucao com a cascata. O frontend `frontend/src/views/InjetorXmlView.vue` (pagina Impressao LMC) consome estas rotas. Os consumidores finais de todas as colunas `*_ajustado` sao o **PDF do LMC** (`lmc-pdf.js`) e o **exportador SPED** (que reescreve os registros 1300/1310/1320 do Bloco 1 via `COALESCE(*_ajustado, original)`).

---

## 4. Motor de Exportacao SPED V7

Esta secao documenta o componente mais critico do Audisped: o motor que **retifica** um arquivo SPED Fiscal (EFD ICMS/IPI) original e devolve um TXT corrigido para download. Todo o motor vive em uma unica rota — `GET /api/exportar-sped/:id` em `backend/server.js` — com helpers e closures internas no mesmo escopo. A funcao auxiliar de geracao dos campos (`escudoAnpMae`) e a closure central (`flush1300Group`) sao definidas dentro do corpo da rota, e o estado de continuidade (encerrantes de bicos, fechamento por produto) e mantido em `Map`s locais que sobrevivem por todo o loop linha-a-linha.

O motor opera em tres tempos:

1. **Parte A** — carregamento de ajustes do banco, pre-scan do arquivo, deduplicacao de D100 e montagem do estado.
2. **Parte B** — o nucleo: a closure `flush1300Group` que reescreve o Bloco 1 do LMC (1300/1310/1320) em quatro passes (PASS 1 a 4, mais PASS 1.5 e 3.5), aplicando escudo ANP, ancora no fechamento fisico e tratamento de bicos patologicos.
3. **Parte C** — finalizacao: reconciliacao matematica, recontagem dos totalizadores estruturais (9900/0990/1990/9999), injecao de 0150 faltantes, montagem do TXT e persistencia da continuidade intermensal.

A montante do motor existe a **rota de redistribuicao (Re-distribuir / Motor V7)** que grava os campos `*_ajustado` em `lmc_movimentacao` — e dela que o motor de exportacao colhe a "ancora" (`novo.fisicoDb`). A jusante existe o **script de redistribuicao automatica** (`redistribuir_automatico.js`) que orquestra a sincronizacao de continuidade em lote.

---

### 4.1 Conceitos fiscais fundamentais

Todo o motor obedece a aritmetica do LMC (Livro de Movimentacao de Combustiveis) validada pelo PVA:

| Conceito | Formula / regra |
|----------|-----------------|
| Disponivel | `DISP = ABERT + ENTR` |
| Escritural | `ESCR = DISP - SAIDA` |
| Fechamento fisico | `FECH = ESCR - PERDA + GANHO` |
| Encerrante de bico | `ENC_FINAL = ENC_INIC + VOL_VENDAS + VOL_AFERICAO` (hodometro acumulativo) |
| Consistencia tanque | `1310.VOL_SAIDAS = Σ(1320.VOL_VENDAS)` |
| Consistencia produto | `1300 = Σ(1310)` |
| Continuidade diaria | `ABERT(dia N) = FECH(dia N-1)` |
| Continuidade intermensal | `ABERT(1o dia do mes) = FECH(ultimo dia do mes anterior)` |
| Limite legal ANP | variacao volumetrica de perda/ganho ≤ **0,60%** |

O numero 0,60% e o limite legal da ANP que o PVA valida ("variacao acima do permitido"). O motor aplica internamente uma **margem operacional de 0,55% (`0.0055`)** nos escudos por-tanque, para absorver erro de arredondamento e nunca chegar colado no teto. A checagem final do 1300 mae, porem, compara contra 0,60% — entao 0,55% (tanque) e 0,60% (mae) coexistem no codigo, o que pode gerar pequena inconsistencia entre `Σ(1310)` e o limite estrito do 1300.

---

### 4.2 Layout dos registros do Bloco 1

```
1300 |1300|COD_ITEM|DT|ESTQ_ABERT(4)|VOL_ENTR(5)|VOL_DISP(6)|VOL_SAIDAS(7)|ESTQ_ESCR(8)|VOL_PERDA(9)|VOL_GANHO(10)|FECH_FISICO(11)|
1310 |1310|...|...(3..10)...|CAP_TANQUE(11 — somente layout 020)|
1320 |1320|NUM_BICO(2)|...|VAL_FECHA(8)|VAL_ABERTURA(9)|VOL_AFERIDOS(10)|VOL_VENDAS(11)|
```

O **layout 019** (vigencia ate 2025) tem o 1310 com 12 posicoes; o **layout 020** (vigencia 2026+) acrescenta o campo `CAP_TANQUE` no 1310 (13 posicoes). O motor autodetecta e transmuta o layout no registro 0000 (ver 4.10).

---

### 4.3 Abertura da rota e governanca de pool

`server.js:5884-5908` — A rota e autenticada (`authMiddleware`), faz `parseInt` do `:id`, adquire um slot do semaforo de operacoes pesadas via `acquireHeavySlot()` (limite `MAX_HEAVY_OPS=5`, para nao esgotar o pool de 120 conexoes) e obtem `dbClient` via `safeConnect(res)`. Busca `sped_arquivos` por id (404 se inexistente). Resolve `caminho_arquivo`, que pode ser JSON `{"sped":"/path"}` (uploads antigos) ou string simples — faz `JSON.parse` defensivo em try/catch e pega `Object.values(parsed)[0]`. Se o arquivo fisico nao existe (`fs.existsSync`) retorna 400.

> **GOTCHA (vazamento de pool):** o `release` do heavy slot e do `dbClient` fica no `finally` da Parte C. Os returns precoces 404/400/422 (`server.js:5893`, `5906`, `6030`) ocorrem ANTES do try que possui esse finally — se nao houver release nesses paths, o semaforo de heavy ops (max 5) vaza e trava exportacoes. Isto e coerente com o padrao conhecido "pool esgota com exportacoes em sequencia rapida".

---

### 4.4 Carregamento de ajustes do banco (Parte A)

O motor monta uma serie de `Map`s a partir do banco antes de tocar no arquivo. Esses ajustes sao a saida do Motor Re-distribuir (que recalcula saidas/fechamento/abertura por dia/produto para que o LMC feche dentro da variacao ANP).

| Map | Origem | Linhas | Conteudo |
|-----|--------|--------|----------|
| `mapAjustes` | `lmc_movimentacao` (com algum `*_ajustado` NOT NULL) | `5909-5929` | `vol_saidas_ajustado`, `fech_fisico_ajustado`, `estq_abert_ajustado`, `vol_entr_ajustado`, `val_perda_ajustado`, `val_ganho_ajustado`, `vol_escr_ajustado`. Chave `YYYY-MM-DD_cod_item` (UTC) |
| `mapBaseFisico` | TODOS os registros LMC | `5931-5945` | `COALESCE(fech_fisico_ajustado, fech_fisico, 0)` — garante FECH correto mesmo quando o original tinha `VAL_AJ_PERDA = ESTQ_ESCR` (FECH=0) |
| `mapCapacidadesPorItem` | `lmc_tanques_config` | `5947-5954` | capacidade por `cod_item` (usada no campo 11 do 1310 no layout 020) |
| `mapC100` | `documentos_c100` (`vl_doc_ajustado` NOT NULL) | `5955-5972` | valor total da NF-e ajustado. Chave `num_doc_chvnfe` |
| `mapC190` | `documentos_c190 JOIN c100` | `5955-5972` | ajustes `vl_opr/vl_bc_icms/vl_icms`. Chave composta `num_doc_chvnfe_cst_cfop_aliq(2 casas)` |
| `mapC170` | `documentos_itens_c170 JOIN c100` | `5955-5972` | CST ICMS/PIS/COFINS e CFOP por item. Chave `num_doc_chvnfe_num_item_cod_item` |

Todas as chaves de data usam `getUTC*` para evitar shift de timezone no `data_mov`. A chave de C190 com `aliq.toFixed(2)` e a estrategia de de-para para casar a linha analitica correta por CST/CFOP/aliquota.

> **GOTCHA (capacidade por produto):** `mapCapacidades` permanece **sempre vazio** (mantido so por compatibilidade); toda capacidade vem de `mapCapacidadesPorItem`, que e por COD_ITEM, **nao por tanque fisico**. Se um produto tem multiplos tanques de capacidades diferentes, todos recebem a mesma capacidade no campo 11 do 1310 (layout 020) — incorreto no mundo real.

---

### 4.5 Pre-scan do arquivo, bloqueios e deduplicacao D100

#### Pre-scan de COD_ITEMs referenciados

`server.js:5974-6024` — O arquivo e lido inteiro com `fs.readFileSync(path, 'latin1')` e dividido por linha. Para cada linha (exceto 0200/0206) coleta COD_ITEMs em posicoes que variam por registro:

- posicao `pf[2]`: H010 / 1300 / G110 / K200 / K210 / K220 / K230 / K235 / K250 / K255
- posicao `pf[3]`: C170 / C176 / D170 / D500 / D201 / D205

Aplica `String().trim()` defensivo, porque SPEDs gravados em CHAR-fixo trazem o cod_item com padding — sem trim o filtro de 0200 omitiria todos os produtos e o PVA rejeitaria por cadastro sem referencia. Conta `h010CountByCod` para so reescrever a QTD do inventario quando ha um unico H010 (evita quebrar splits por IND_PROP). Detecta `temReg0000` e coleta `dias1300NoArquivo` (data DDMMAAAA → YYYY-MM-DD).

A logica fiscal por tras da uniao completa de fontes: o validador do PVA exige que todo registro 0200 (cadastro de produto) tenha pelo menos uma referencia em outro bloco.

A uniao final de COD_ITEMs referenciados (`codItensReferenciados`) e montada em `server.js:6050-6055` como o `Set` de `cod_item` (trim) de C170 + LMC + extras do pre-scan. Esse conjunto-mestre decide depois, no loop principal, se cada 0200 e mantido ou omitido.

#### Bloqueios e alertas

| Verificacao | Linhas | Comportamento |
|-------------|--------|---------------|
| Ausencia de 0000 | `6026-6032` | **422 bloqueante** — sem o cabecalho obrigatorio nenhum SPED e valido (evita gerar TXT a partir de origem invalida, ex. cache FUSE/Google Drive que perdeu o bloco 0) |
| `fechFinalLmc` / `mapFechFinalLmc` | `6034-6048` | `SELECT DISTINCT ON (TRIM(cod_item)) ... ORDER BY data_mov DESC` — ultimo fechamento do periodo por produto, usado para reescrever QTD/VL_ITEM do H010 (inventario). So entra se `fech >= 0` |
| Lacuna no 1300 | `6130-6149` | **Alerta nao-bloqueante** — itera dia a dia do periodo; dias ausentes em `dias1300NoArquivo` viram `logger.warn` + header `X-Export-Lmc-Lacuna {total, dias}`. Exporta LMC incompleto mesmo assim |

#### Leitura do arquivo e deduplicacao de D100

`server.js:6057-6088` — Le o arquivo com `fs.readFileSync(pathOrig, 'latin1')` e `split(/\r?\n/)`. O comentario do codigo explica a escolha: `createReadStream` em FUSE/Google Drive comecava do meio do arquivo, perdendo o bloco 0. Em seguida deduplica CT-e (D100) duplicados: monta chave com os campos `f[9], f[5], f[6], f[7], f[8], f[10], f[4]`; se ja vista, ativa `skipD100` e pula tambem os filhos D101-D199 (`reg > 'D100' && reg < 'D200'`) ate o proximo D100.

> **GOTCHA (dedup fragil):** a deteccao de filhos usa comparacao lexical de string `reg > 'D100' && reg < 'D200'`. Funciona para D1xx mas depende de ordenacao de string; registros fora de ordem entre D100 e D200 de outro documento nao duplicado poderiam ser pulados enquanto `skipD100` permanece ativo (so e resetado ao achar o proximo D100).

---

### 4.6 Estado do loop e continuidade intermensal

`server.js:6151-6254` — Antes do loop principal, o motor inicializa todo o estado de continuidade:

- `encerrantesBombasMap` — `bico → ultimo encerrante final` (rastreador continuo de hodometro)
- `ultimoEncOrigPorBico` — `bico → enc_inic original` (deteccao de multiproduto entre flushes)
- `ultimoFechExportado` — `cod_item → fech` (continuidade entre dias e meses)
- `set0150CnpjsPresentes` / `map1601Participantes` — Fix C (cadastro 0150 vs CNPJ referenciado em 1601)
- `pending1300` / `pending1310s` / `pending1320s` — buffers do grupo LMC
- `layoutVersion` default `'019'`

A **continuidade intermensal** calcula o mes anterior (com rollover Janeiro→Dezembro do ano anterior) e popula `ultimoFechExportado` por **tres prioridades** (`server.js:6179-6254`):

1. **Fonte 1 — `encerrantes_exportados`**: `SELECT` por `cnpj_empresa + competencia = mesAnterior` (`f > 0`). Garante que o ABERT do 1o dia do mes atual = FECH realmente **exportado** no mes anterior, evitando inflacao do escudo ANP.
2. **Fonte 2 — fallback `lmc_movimentacao`**: CTE que acha o arquivo SPED anterior do mesmo CNPJ (`REGEXP_REPLACE` para comparar so digitos; `LEFT(periodo,7) < ym`) e pega `DISTINCT ON (cod_item)` o ultimo `fech_fisico_ajustado>0` ou `fech_fisico>0`. So para produtos sem registro na Fonte 1.
3. **Encerrantes de bicos — `encerrantes_bicos_exportados`**: carrega `num_bico → val_fecha` do mes anterior em `encerrantesBombasMap`.

> **GOTCHA (ordem cronologica):** `encerrantes_exportados` so e confiavel se as exportacoes foram feitas em ordem cronologica. Exportar fora de ordem deixa a tabela inconsistente. O fallback assume formato exato `'YYYY-MM-DD a ...'` no `LEFT(periodo,7)`.

#### Buffer de saida e helpers

`server.js:6256-6272` — `outputLines` acumula tudo (para recalcular 9900/0990/9999 ao final), `pushLine` enfileira, `skipNext0206` pula filhos de 0200 omitido. Estado de recalculo de E210 durante a leitura: `somaRetST`, `sitExportST`, `c790CfopExport`. Comentario importante: **E110 NAO e recalculado neste ponto** — o arquivo ja tem E110 correto pos-injecao e recalcular quebraria a validacao E111 "outros debitos". Helpers `parseSp` (string virgula → float) e `fmtSp` (float → string 2 casas virgula).

---

### 4.7 A montante: redistribuicao de vendas com busca binaria por segmento

> Este bloco vive na **rota de redistribuicao/sincronizacao do LMC** (`server.js:3334-3469`), nao dentro do `flush1300Group`. Mas e o que alimenta a ancora (`novo.fisicoDb`) consumida no export, e e o que a arquitetura chama de "busca binaria por segmento".

A logica (passo a passo):

**6.1 — Particionamento em segmentos** (`~3334`): o array `calcs` (dias do mes para um cod_item) e particionado em SEGMENTOS delimitados por entradas de combustivel. Cada vez que `calcs[i].entradasOrig > 0` fecha um segmento e abre outro. Logica fiscal: dentro de um segmento sem reabastecimento o estoque so cai, entao o estoque inicial limita o total de vendas distribuivel.

**6.2 — `cascataSegmento`** (`~3352-3377`): roda a cascata diaria:
```
disp = stock + entradasOrig
(se ESCR > 99,4% da capacidade do tanque → aumenta a saida)
saida = min(saida, disp - 0.001)            // nunca vender mais que o disponivel
escr = disp - saida
capPerda = escr * 0.006 / 1.006
capGanho = escr * 0.006 / 0.994
fech = escr + ganho - perda
fech = min(fech, 99% da capacidade)
stock(proximo dia) = fech                    // ABERT(N) = FECH(N-1)
```

**6.3 — Busca binaria de 30 iteracoes**: para cada segmento com vendas, busca o **fator multiplicador** (`0..1`) aplicado proporcionalmente as saidas originais de cada dia. Testa o fator, roda a cascata, e verifica se algum dia com NFC-e (`saidaOrig>0`) ficou abaixo do minimo aceitavel — `max(1L, 0,5% da venda original)`. Se zerou um dia de venda real, reduz `fatorMax`; senao guarda `melhorResult` e sobe `fatorMin`. **Objetivo fiscal:** achar o MAIOR fator que nao zera nenhum dia de venda real — preserva o padrao de vendas do posto e impede o cenario "NFC-e exportada mas saida zero no LMC" (cruzamento NFC-e x LMC).

**6.4 — Trava fiscal final**: qualquer dia com `saidaOrig>0` mas `saidaCalc<=0` recebe um minimo simbolico (0,1% da venda, `>=0.001L`) com `warn`.

> **GOTCHA:** em segmento com estoque inicial muito baixo, o minimo `max(1.0, saidaOrig*0.005)` pode nunca achar fator que satisfaca todos os dias → cai no fallback (0,1%), que ainda mantem dias de venda muito reduzidos, possivelmente divergindo das NFC-e reais.

O resultado dessa rota e gravado em `estq_abert_ajustado / vol_saidas_ajustado / fech_fisico_ajustado` em `lmc_movimentacao` — exatamente os campos que o export le em `mapAjustes` / `mapBaseFisico`.

---

### 4.8 O nucleo: `flush1300Group`

A closure `flush1300Group` (`server.js:6274-6996`) e o coracao do motor. Ela e chamada sempre que o loop principal troca de grupo 1300 (ou ao final do arquivo) e descarrega o grupo `pending1300 + pending1310s + pending1320s` acumulado, garantindo as cinco invariantes do LMC:

1. `Σ(1310) = 1300` (por produto)
2. `Σ(1320.vendas) = 1310.saida` (por tanque)
3. perda/ganho ≤ limite ANP (escudo)
4. encerrantes de bicos continuos e crescentes (dia a dia e entre meses)
5. `FECH` = ancora do banco quando isso nao viola o ANP

#### 4.8.1 Caminho SEM tanques filhos (1300 global, sem 1310)

`server.js:6274-6307` — Se `pending1310s` esta vazio: se `novo.fisicoDb > 0` e diverge do FECH da linha (campo 11) por `> 0.01`, recalcula perda/ganho (campos 9/10) a partir de ESCR (campo 8) vs `fisicoDb`, aplica `escudoAnpMae(abert, entr, escr, p, g)` e reescreve os campos 9/10/11. Emite a linha via `pushLine` e propaga `ultimoFechExportado[codItem] = fech` para continuidade.

#### 4.8.2 PASS 1 — rateio proporcional dos tanques 1310

`server.js:6309-6412` — Distribui os totais `novo` (do banco/cascata) entre os tanques. Para cada 1310 calcula proporcoes contra o movimento ORIGINAL: `pAbert = tOrigAbert/orig.abert`, `pEntr`, `pSaida`.

- **Regra de saida sem movimento original:** quando `orig.saida == 0`, distribui saida APENAS para tanques que possuem bicos (1320); tanques de armazenamento puro recebem `saida = 0`, evitando divergencia 1320 x 1300.
- **Proporcoes invalidas:** proporcoes fora de `[0,1]` (sintoma de encerrante gravado como estoque) caem para rateio igualitario `1/n`.
- **Ultimo tanque:** recebe o **residuo** (`novo.X - somaParcial`) para fechar a conta exata; os demais usam a proporcao.
- **Escudo ANP por tanque:** `maxDesvio = (nAbert + nEntr) * 0.0055`; perda e ganho saturados nesse limite — em TODOS os tanques (antes so o ultimo tinha escudo).
- **Saneadores:** `nAbert<0 → 0.5`; `nSaida ≤ nDisp - 0.001`; `nFisico<0 → max(0, nEscr)`.

Cada tanque grava `tk._curated` com os valores curados; o motor acumula os totais `real*`.

#### 4.8.3 Redistribuicao de excesso de saida entre tanques

`server.js:6414-6464` — Se `realSaida < novo.saida - 0.01` (deficit porque algum tanque teve saida cortada por falta de disponivel) **e** ha `> 1` tanque, transfere o deficit para tanques com **folga** (`nDisp - nSaida > 1`) **e com bico ATIVO** (algum 1320 com `vendas>0` ou `enc_final != enc_inic`).

> **CRITICO:** nunca transfere para tanque com bomba parada — isso criaria saida sem encerrante correspondente. Apos transferir, recalcula ESCR e perda/ganho com escudo ANP (`min` com `maxDevT`) e re-totaliza os `real*`. Sem essa redistribuicao, `realSaida < novo.saida` → escritural inflado → ANP estoura.

> **GOTCHA:** a redistribuicao so roda com `pending1310s.length > 1`. Com um unico tanque que teve saida cortada, o deficit nao e tratado aqui; o escritural permanece inflado ate o ESCUDO ANP FINAL ajustar a saida (que pode reduzir a saida total exportada abaixo da venda real/NFC-e).

#### 4.8.4 Recalculo do 1300 mae — ANCORA vs ESCUDO ANP

`server.js:6466-6559` — Esta e a **decisao central** do motor. Recalcula a partir dos totais primarios (nao da soma distorcida):
```
realDisp = realAbert + realEntr
realEscr = realDisp - realSaida
fechEscudo = escudoAnpMae(...)          // FECH seguro, perda/ganho ≤ 0,55%
ancoraFisico = novo.fisicoDb            // valor do banco/otimizador
```

**Decisao ancora vs escudo:** se `ancoraFisico` existe e a variacao ANP entre `realEscr` e a ancora (`|realEscr - ancora| / ancora * 100`) `≤ 0,60%`, usa a **ancora** (FECH = banco, prevalece o estoque real). Senao usa `fechEscudo` (forca conformidade ANP). Em seguida deriva perda/ganho de ESCR vs FECH (`FECH ≥ ESCR → ganho`, senao `perda`) e saneia negativos.

**Fix ABERT do 1o dia** (`6517-6533`): no primeiro dia do periodo (sem `ultimoFechExportado`), se `realAbert` ficou inflado `> 130%` da soma dos ABERTs originais dos 1310 (sintoma de cache FUSE), reverte para a soma original e recalcula FECH via escudo/ancora. Imune ao cache que poderia ter inflado a abertura.

**ESCUDO ANP FINAL** (`6537-6559`): ultima barreira. Se `|realEscr - realFisico| / realFisico * 100 > 0,60%`, **AJUSTA A SAIDA** (`realSaida = realDisp - escrAlvo`, com `escrAlvo = fisico*1.006` ou `fisico*0.994`) para forcar o escritural dentro do limite, recalcula `realEscr` e perda/ganho, e loga `[ESCUDO ANP FINAL]`.

> **GOTCHA (descasamento de saida):** o ESCUDO ANP FINAL muda `realSaida` mas NAO atualiza os 1310/1320 nem `realDisp`/encerrantes naquele ponto — depende do PASS 3.5 e PASS 4 para reconciliar. Se um bico ja foi fixado, pode haver leve descasamento entre `VOL_SAIDAS` do 1300 e a soma real dos encerrantes. Alem disso, quando ha tanques filhos o PASS 4 sobrescreve o 1300 com `Σ(1310)`, podendo descartar esse ajuste de saida — diferenca de comportamento entre o caminho com filhos e sem filhos.

#### 4.8.5 PASS 1.5 — redistribuir delta FECH entre os 1310

`server.js:6570-6608` — Como o PASS 2 pode ter mudado `realFisico` (ancora/escudo) sem mexer nos tanques, gera `1300.FECH != Σ(1310.FECH)`. Calcula `deltaFisico = realFisico - Σ(nFisico)` e, se `|delta| > 0.001`, distribui proporcionalmente ao `nFisico` de cada tanque (ultimo recebe residuo), reajusta `nFisico ≥ 0` e recalcula perda/ganho mantendo a formula PVA.

> **GOTCHA:** ao saturar `nFisico` em `max(0, ...)`, o PASS 1.5 pode reintroduzir divergencia que so e corrigida no PASS 4 (que reescreve `1300 = Σ(1310)`). Na pratica e parcialmente redundante com o PASS 4, gastando processamento.

#### 4.8.6 PASS 3 — finalizar 1310 e processar bicos 1320

`server.js:6611-6885` — O trecho mais denso do motor. Para cada tanque finaliza o 1310 (saneia perda/ganho negativos, acumula `soma1310`, grava campos 3..10; no layout 020 grava `CAP_TANQUE` no campo 11 com `length=13`, no 019 `length=12`). Depois processa os bicos.

**Fator de otimizacao dos bicos:**
```
fatorOtimizacao = curated.nSaida / somaBicosOriginal
```
Usa a soma real dos `VOL_VENDAS` originais dos bicos (e nao `tOrigSaida`) como base, para que encerrantes corrompidos nao propaguem volumes absurdos e a proporcao de cada bico seja preservada. Quando `somaBicosOriginal = 0`, cai para `nSaida/tOrigSaida`; se ambos forem 0, fica 1.

**Casos especiais por bico (em ordem de avaliacao):**

| # | Caso | Condicao | Tratamento |
|---|------|----------|------------|
| 0 | **BOMBA PARADA** | `enc_inic == enc_final`, `vendas == 0`, `enc_fecha > 0` | **Caso A** — mesmo bico tem registro real no MESMO tanque (intervencao) → OMITE o parado. **Caso B** — mesmo bico existe em OUTRO tanque (compartilhado) → OMITE (outro tanque processa). **Caso C** — unico registro do bico (feriado) → processa normal com enc acumulado e `vendas=0` |
| 1 | **ENTRADA FANTASMA** | todos os 4 campos = 0 | OMITE se mesmo bico tem registro real; OU se TODOS sao fantasma e ha `saida>0` converte um em entrada real (absorve toda a `nSaida`); OU preenche `enc_inic=enc_final` do `encerrantesBombasMap` e mantem (PVA exige ≥1 1320 por 1310) |
| 2 | **MULTIPRODUTO entre flushes** | `ultimoEncOrigPorBico` global; `enc_inic` igual ao anterior | emite `enc_inic = enc_final = acumulado`, `vendas = 0` (o encerrante ja avancou no 1o produto) |
| 3 | **DUPLICATA / multiproduto no flush** | `bicosProcessadosNesteFlush` | multiproduto → enc travado, `vendas = volVendasOrig*fator`; duplicata normal → zera vendas (a menos que o anterior fosse fantasma) |

**Calculo normal do bico (aritmetica inteira em mililitros):** o ultimo bico do tanque recebe o residuo (`nSaida - acumulado`), os demais recebem `volVendasOrig * fator`. Para eliminar erro de ponto flutuante, usa `Math.round(* 1000)`:
```
mlFecha = mlAbert + mlVendas + mlAferi
// simula o calculo float do validador:
if ((fecha - abert - aferi) < 0) mlFecha += 1   // bump de +1ml (0.001L)
```
O bump de +1ml simula o calculo float do PVA para que ele nao acuse venda negativa.

Ao final de cada bico, atualiza `encerrantesBombasMap[bico] = encFinal` (continuidade), `bicosProcessadosNesteFlush` e `ultimoEncOrigPorBico`.

> **GOTCHAS do PASS 3:**
> - A deteccao de multiproduto usa `Math.abs(encAbertOrig - encOrigAnterior) < 0.01`. Dois produtos diferentes com encerrantes coincidentemente proximos seriam tratados como multiproduto, zerando vendas indevidamente (padrao conhecido "troca de produto no bico → falso positivo de continuidade por produto").
> - O caso `todosFantasma && nSaida>0` faz o primeiro bico fantasma absorver TODA a `nSaida`; com multiplos fantasmas convertidos ha risco de dupla contagem (o ramo intermediario multiplica por `fator` calculado sobre `somaBicosOriginal=0`).
> - Bicos compartilhados entre tanques (ex. Apache bico 02 nos tanques 691/692) dependem do Caso B; se AMBOS os tanques tiverem registro real do mesmo bico no mesmo dia, ou se ambos omitirem, ha risco de dupla contagem ou de o bico sumir do export.
> - O bump de +1ml so corrige `-0.000`; se o erro de float for maior (`-0.001`) pode nao bastar para o validador aceitar.

#### 4.8.7 PASS 3.5 — ajustar 1310.SAIDA = Σ(1320)

`server.js:6887-6959` — Repara a inconsistencia `1310.saida != Σ(1320.vendas)` que surge quando bicos foram zerados (multiproduto/duplicata). Reagrupa as `linhas1310`, soma os `VOL_VENDAS` dos 1320 por tanque e, se a saida do 1310 (campo 6) diverge `> 0.01` da soma dos bicos, reescreve `1310.saida = Σ(1320)`, recalcula DISP/ESCR/perda/ganho/FISICO com escudo ANP por tanque (`maxDev = disp*0.0055`). Recalcula `soma1310` lendo as linhas ja ajustadas. Garante a regra do PVA `1310.VOL_SAIDAS = Σ(VOL_VENDAS)`.

#### 4.8.8 PASS 4 — emitir 1300 com Σ(1310) exata e propagar

`server.js:6961-6996` — Reescreve os campos 4..11 do 1300 com `soma1310` (arredondada a 3 casas), garantindo `1300 = Σ(1310)` sem divergencia. **NAO reaplica escudo ANP na soma** (cada tanque ja tem o seu; reaplicar quebraria a igualdade). Atualiza `realFisico = soma1310.fisico`, faz `pushLine` do 1300, propaga `ultimoFechExportado[codItem] = realFisico` e emite todas as linhas 1310/1320 bufferizadas. **Ordem de emissao: 1300 antes dos 1310/1320** (hierarquia do SPED). Reseta `pending1300/1310s/1320s`.

#### Pipeline completo do `flush1300Group`

```
                       ┌──── pending1310s vazio? ──── SIM → 4.8.1 (ancora + escudo no 1300 global)
                       │
trocou de grupo 1300 ──┤ NAO
                       ▼
       PASS 1 (4.8.2)  → rateio proporcional + escudo por tanque
       redistrib. (4.8.3) → excesso de saida p/ tanques com bico ativo
       recalc mae (4.8.4) → ancora vs escudo ANP + ESCUDO ANP FINAL (ajusta saida)
       PASS 1.5 (4.8.5) → delta FECH distribuido nos 1310
       PASS 3 (4.8.6)  → finaliza 1310 + bicos 1320 (bomba parada/fantasma/multiproduto/duplicata, ml inteiro)
       PASS 3.5 (4.8.7)→ 1310.saida = Σ(1320)
       PASS 4 (4.8.8)  → 1300 = Σ(1310) + emite + propaga continuidade
```

---

### 4.9 O escudo ANP — `escudoAnpMae`

`server.js:7005-7016` — Helper central da conformidade ANP, aplicado em todos os caminhos de export do 1300 (`mapAjustes`, `mapBaseFisico` e flush com 1310):

```js
function escudoAnpMae(abert, entr, escr, perda, ganho) {
  const base = abert + entr;
  const limite = base * 0.0055;        // 0,55%, margem abaixo do teto legal 0,60%
  if (base > 0) { perda = min(perda, limite); ganho = min(ganho, limite); }
  const fisico = max(0, escr - perda + ganho);   // formula PVA do LMC
  return { perda, ganho, fisico };
}
```

Garante que nenhuma perda/ganho exportada exceda a variacao tolerada — evitando a rejeicao do PVA "ANP acima do limite".

> **GOTCHAS:**
> - O helper (`const`) e definido na linha 7005, **DEPOIS** de `flush1300Group` (6274) que o invoca. So funciona porque `flush1300Group` so e **chamado** no loop iniciado em `7018`, apos a definicao. Se a ordem de chamada mudasse, daria `ReferenceError` (temporal dead zone).
> - O denominador do limite e `base = abert + entr` (disponivel), mas o limite legal da ANP e calculado sobre o ESCRITURAL/FECHAMENTO. Para tanque com muita entrada e pouco estoque, o limite fica mais permissivo que o estrito 0,60% sobre o escritural.

---

### 4.10 Loop principal — blocos 0xxx, H010 e bufferizacao do 1300

`server.js:7018-7099` — O loop varre `fileLines`, ignora linhas em branco e trata os blocos iniciais:

| Registro | Linhas | Acao |
|----------|--------|------|
| **0200** | `7018+` | omite item nao referenciado em `codItensReferenciados`; marca `skipNext0206` para pular 0205/0206 orfaos (evita erro PVA de cadastro sem uso) |
| **0000** | `7018+` | autocorrecao de leiaute: se `periodo >= 2026` e versao `'019'`, **transmuta para `'020'`** (salva importacao no PVA); captura `periodoIni/Fim` (Fix B, COD_SIT); define `layoutVersion` |
| **0150** | `7018+` | registra CNPJs presentes em `set0150CnpjsPresentes` (Fix C) |
| **H010** | `7018+` | reescreve QTD/VL_ITEM para casar com o `fech_fisico` final do LMC (`mapFechFinalLmc`), alinhando o inventario aos ajustes do otimizador |

A bufferizacao do grupo LMC ocorre em tres ramos ao encontrar um 1300:

| Ramo | Linhas | Condicao | Comportamento |
|------|--------|----------|---------------|
| **mapAjustes** | `7119-7206` | ha ajuste do usuario | ABERT por prioridade (`FECH propagado > estq_abert_ajustado > original`; `<0 → 0,5`); `ENTR = vol_entr_ajustado`; `DISP = ABERT+ENTR`; `SAIDA = vol_saidas_ajustado` (escudo `SAIDA ≤ DISP-0,001`); `ESCR = DISP-SAIDA`; perda/ganho blindados por `escudoAnpMae`; `fisicoDb = fech_fisico_ajustado>0 ? : fech_fisico`. Bufferiza em `pending1300` com `orig/novo` (inclui `fisicoDb`) e nao escreve direto |
| **mapBaseFisico** | `7207-7266` | sem ajuste, mas com fech base no banco | corrige (a) FECH=0 no original quando `VAL_AJ_PERDA=ESTQ_ESCR`; (b) abertura do 1o dia divergindo `>0,5` do FECH anterior. Propaga `ABERT = FECH anterior`, recalcula DISP/ESCR, deriva perda/ganho do `fisicoAlvo` e blinda com escudo. Bufferiza (sem `fisicoDb` explicito) |
| **passagem direta** | `7268-7354` | sem ajuste e sem fech zerado | se continuidade quebrada (`ABERT` diverge `>0,5` do FECH anterior) propaga e bufferiza; se ha `encerrantesBombasMap` carregado bufferiza mesmo sem mudar valores (para os 1320 passarem pelo processamento de encerrantes); senao apenas guarda FECH para propagacao. Tambem injeta `CAP_TANQUE` em 1310 diretos no layout 020 |

Ao encontrar cada novo 1300, o loop primeiro faz `flush1300Group()` do grupo anterior, depois monta a chave `data+cod_item` e bufferiza o atual.

---

### 4.11 Finalizacao (Parte C)

#### 4.11.1 Flush residual e persistencia da continuidade

`server.js:7537-7561` — Apos o loop, faz o flush do buffer residual (arquivo terminando em 1310/1320). Depois, para cada `cod_item` em `ultimoFechExportado`, executa:
```sql
INSERT INTO encerrantes_exportados (...) VALUES (...)
ON CONFLICT (cnpj_empresa, competencia, cod_item)
DO UPDATE SET fech_fisico_exportado = ..., dt_exportacao = NOW(), id_sped_arquivo = ...
```
A `competencia` (YYYY-MM) e derivada de `periodoIniArq`. Grava o FECH **realmente exportado** (pos-escudo/ancora) para que a exportacao do mes seguinte use esse valor como ABERT, com prioridade sobre `lmc_movimentacao`.

`server.js:7563-7584` — Analogamente, para cada `num_bico` em `encerrantesBombasMap`, faz UPSERT em `encerrantes_bicos_exportados` (`ON CONFLICT (cnpj_empresa, competencia, num_bico)`), garantindo a continuidade monotonica dos 1320 no mes seguinte (`enc_inic do dia 1 = val_fecha do ultimo dia do mes anterior`).

> **GOTCHAS:**
> - A persistencia depende de `periodoIniArq` ter sido parseado de `periodo_apuracao` (formato `'... a ...'`). Se o formato divergir, `periodoIniArq` fica vazio e a continuidade NAO e gravada.
> - O `ON CONFLICT` sobrescreve `id_sped_arquivo`: reexportar um arquivo antigo do mesmo CNPJ/competencia "rouba" a posse do registro de continuidade.
> - `ultimoFechExportado` e gravado em multiplos pontos (flush sem filhos `6303`, passagem direta `7298/7319/7324`, flush com filhos `6987`). Se os 1300 do mesmo cod_item nao estiverem em ordem cronologica no arquivo, o ultimo FECH gravado pode nao ser o do ultimo dia, corrompendo o ABERT do mes seguinte.

#### 4.11.2 Fix C — injecao de 0150 ausentes

`server.js:7586-7626` — Para os `COD_PART` coletados nos registros 1601 (consolidacao de combustiveis por participante), busca o CNPJ em `sped_participantes`; se o CNPJ nao consta em `set0150CnpjsPresentes`, injeta uma linha 0150 imediatamente ANTES do 0990 em `outputLines` (fallback: apos o ultimo 0150). Monta com `COD_PAIS=1058` (Brasil) e `IE=ISENTO`. O PVA exige que todo COD_PART referenciado tenha o cadastro 0150 correspondente.

> **GOTCHA:** o template do 0150 usa `COD_MUN` vazio (string vazia entre os pipes) e `IE=ISENTO` fixo — pode gerar 0150 incompleto se o PVA exigir COD_MUN para o participante.

#### 4.11.3 Recontagem 9900 / 0990 / 1990 / 9999 e montagem do TXT

`server.js:7628-7673` — Em dois loops sobre `outputLines`:

1. **Contagem:** monta `regCountMap` (contagem por tipo de registro), `block0LineCount` (registros que comecam com `'0'`), `block1LineCount` (comecam com `'1'`); `totalLines = outputLines.length`.
2. **Reescrita + streaming:** reescreve os totalizadores e faz `res.write(linha + '\r\n')`:
   - **9900** — campo 3 = contagem real do registro nomeado no campo 2
   - **0990** — campo 2 = `block0LineCount`
   - **1990** — campo 2 = `block1LineCount` (recontagem do bloco 1 apos os ajustes de LMC)
   - **9999** — campo 2 = `totalLines`

Os contadores estruturais precisam refletir a contagem real apos as omissoes (0200/0205/0206) e insercoes (0150), senao o PVA rejeita por divergencia de contagem.

> **GOTCHAS:**
> - **Charset:** o header declara `iso-8859-1` (`Content-type text/plain; charset=iso-8859-1`), mas as linhas sao escritas com `res.write(string + '\r\n')` SEM encoding explicito — Node usa UTF-8 por padrao para strings. Caracteres acentuados (nomes em 0150, razao social) podem sair em UTF-8 dentro de um arquivo declarado latin1, corrompendo a acentuacao no PVA. Outras rotas usam `Buffer.from(str, 'latin1')`; aqui nao.
> - **9900/9990 nao gerados:** apenas 9900/0990/1990/9999 sao reescritos. Se a injecao de 0150 criar a necessidade de um 9900 que ainda nao existia, ele NAO e gerado; o codigo so atualiza 9900 ja presentes. O `9990` nao e recalculado (assumido constante).
> - A contagem `block0/block1` usa `startsWith('0')` / `startsWith('1')` — inclui corretamente 0990 e 1990 nas proprias contagens (o leiaute exige autocontagem), mas e fragil a qualquer registro cujo codigo comece por '0'/'1' fora do bloco respectivo.

#### 4.11.4 Nome do arquivo de saida

`server.js:6090-6128` — Constroi `safeName`. Normaliza CNPJ (so digitos) e parseia `periodo_apuracao` (`'YYYY-MM-DD a YYYY-MM-DD'`) em `periodoIniArq/FimArq` (DDMMYYYY) e `periodoLabel` (MM-YYYY). Busca `COALESCE(nome_fantasia, nome_empresa)` em `empresas` pelo CNPJ, normaliza `NFD` removendo diacriticos, troca nao-alfanumericos por `_`, colapsa `_`, corta a 30 chars e uppercase. Monta `safeName = CNPJ_NOME_MM-YYYY.txt`. Seta `Content-Disposition: attachment` com `encodeURIComponent(safeName)`.

#### 4.11.5 Finalizacao e liberacao de recursos

`server.js:7672-7687` — Loga linhas lidas / ajustes aplicados / linhas escritas; `res.end()`. No `catch`: se os headers ja foram enviados (streaming iniciado) so faz `res.end()` (nao da `res.status`); senao retorna 500. No `finally`: `dbClient.release()` + `releaseHeavySlot()`.

> **GOTCHA (streaming sem rollback):** se ocorrer erro APOS o primeiro `res.write`, nao ha como retornar 500 — o cliente recebe um TXT truncado sem indicacao clara de falha (so `res.end()`).

---

### 4.12 A "costureira" do arquivo — `spedCostureiraService.js`

Embora a rota de exportacao reescreva o LMC de um SPED ja existente, a **costureira** (`backend/services/spedCostureiraService.js`) e o componente irmao que monta/remonta o arquivo SPED **injetando** registros novos (blocos 0, C e D gerados a partir de XMLs de NF-e/NFC-e/CT-e) preservando a hierarquia pai-filho e recalculando todos os totalizadores. E o componente que garante que o arquivo remontado continue valido perante o PVA apos injecao de documentos.

#### Funcoes principais

| Funcao | Linhas | Papel |
|--------|--------|-------|
| `recalcularAssinaturasBlocos(linhas)` | `9-115` | recalcula TODOS os contadores do SPED: X990 (0990/C990/D990/E990/G990/H990/1990/9990), 9900 (inventario de quantidade por tipo de registro) e 9999 (total de linhas) |
| `injetar0220ParaUnidadesDivergentes(linhas)` | `123-183` | injeta o filho 0220 (fator de conversao) no 0200 quando a UNID do C170 difere da UNID_INV |
| `processarLinhas(...)` | `189-361` | nucleo da costura: normaliza, corrige H005, substitui por chave, deduplica bloco 0, injeta hierarquicamente, reapura E110/E210 |
| `injetar(novos, prefixo)` | `277-318` | closure interna que insere registros respeitando hierarquia e ordem numerica do bloco |
| `recalcularE110(linhas)` | `376-447` | reapura ICMS proprio a partir dos C190/C590/D190/D590 |
| `recalcularE210(linhas)` | `462-563` | reapura ICMS-ST (VL_OUT_CRED_ST, VL_RETENCAO_ST) |
| `costurarEAssinar(path, ...)` | `568-591` | versao que le do disco (stream latin1 + readline) |
| `costurarEAssinarLinhas(linhas, ...)` | `597-603` | versao in-memory (encadeia multiplos grupos sem reler o disco) |
| `gerarSpedFragmentado(...)` | `609-645` | gera SPED standalone (header dummy) quando nao ha base — so para visualizacao |
| `injetarXmlEPersistir(...)` | `650-656` | wrapper async chamado pela rota REST |

#### Recalculo de assinaturas (`9-115`)

Implementa exatamente os registros de totalizacao do EFD em tres tempos: (1ª passada, `18-34`) conta registros por bloco em `counts[]` e por tipo em `countsPorReg[]`; (2ª passada, `40-73`) reescreve cada fechamento de bloco e cada `|9900|REG|QTD|`, acumulando `totalLinhasGeral`; (insercao 9900 faltantes, `77-104`) para registros sem linha 9900 (ex. 0220 recem-injetado), cria `|9900|REG|QTD|` antes do `|9990|`, incrementa `totalLinhasGeral` e `counts['9']`, atualiza `|9900|9900|` e reescreve `|9990|`; (atualiza 9999, `107-112`) varre de tras pra frente e seta `|9999|totalLinhasGeral|`.

#### Hierarquia e injecao (`248-318`)

O mapa pai→filhos cobre `0150→0175`, `0200→0205/0206/0210/0220` e `C100→C101..C197`. A closure `injetar` tem dois caminhos: (A) ja existe registro do prefixo — localiza o ULTIMO, avanca pelos filhos declarados e faz `splice` apos o ultimo filho (um novo 0200 entra depois dos 0220 do 0200 anterior; um novo C100 depois dos C170/C190 do anterior); (B) nao existe — acha o primeiro registro do MESMO bloco lexicograficamente maior, ou antes do fechamento `Xbb990`, ou no fim. A comparacao `'0190' > '0150'` funciona porque os codigos tem largura fixa de 4 e mesmo prefixo de bloco.

#### Reapuracao E110 / E210

- **E110 (`376-447`):** soma o ICMS dos analiticos C190/C590/D190/D590, rastreando `sitAtual` (`f[6]` de C100/C500/D100/D500) e ignorando docs cancelados/denegados (sit 02/03/04/05). Classifica CFOP: CREDITO se `=5605`, comeca com 2 ou 3, ou comeca com 1 (exceto 1605); DEBITO se comeca com 5 (exceto 5605), 6 ou 7. Reescreve VL_TOT_DEBITOS/CREDITOS e deriva `rawSaldo`; `VL_SLD_APURADO = max(0, rawSaldo)`, ICMS a recolher e saldo credor nunca negativos.
- **E210 (`462-563`):** reapura ICMS-ST. VL_OUT_CRED_ST = entradas (C190 CFOP 1xx/2xx) + E220 com `IND_AJ_ST` iniciando em `'T'`; VL_RETENCAO_ST = saidas (C190/C590/C690/D590/D690 CFOP 5xx/6xx) + C791 quando o C790 pai tem CFOP 5xx/6xx. Comentarios internos avisam que o PVA valida o campo 8 como VL_RETENCAO_ST (nao VL_TOTAL_CRED_ST) — escolha deliberada para casar com o validador (erro 1937).

> **GOTCHAS da costureira:**
> - **Fator de conversao 0220 hardcoded em `1,0000`** (`linha 174`): assume conversao 1:1; se a unidade alternativa real tiver fator diferente (ex. CX = 12 UN) a quantidade convertida fica errada (passa na validacao estrutural, mas distorce quantidades).
> - E110/E210 reapuram SOMENTE a partir de analiticos; arquivos so com registros consolidados zerariam debitos/creditos.
> - `recalcularE110` apenas PRESERVA os ajustes E111 (`f[4]`, `f[8]`) do original — se os E111 mudarem apos injecao, o E110 nao recaptura.
> - `gerarSpedFragmentado` emite header 0000 totalmente dummy (`AUDISPED STANDALONE EJECTION`, CNPJ zerado): NAO e fiscalmente valido.

---

### 4.13 Redistribuicao automatica em lote — `redistribuir_automatico.js`

`backend/redistribuir_automatico.js` (1-231) e o script CLI que orquestra a sincronizacao de continuidade (Re-distribuir, Motor V7) em lote para todos os arquivos de uma empresa, em ordem cronologica.

| Bloco | Linhas | Funcao |
|-------|--------|--------|
| bootstrap / args | `20-42` | gera JWT proprio (`JWT_SECRET` env ou fallback hardcoded), parse de `--cnpj` (obrigatorio), `--ids`, `--dry-run` |
| `httpGet/httpPost` | `45-85` | wrappers HTTP nativos com `Authorization: Bearer`; `statusCode>=400 → reject` |
| `listarArquivos` | `88-118` | `GET /api/arquivos`, filtra por CNPJ/IDs, ordena por `CNPJ + LEFT(periodo_apuracao,7)` |
| `processarArquivo` | `121-168` | por arquivo: `GET /api/lmc/continuidade/:id` → se ha divergencias, monta `{id_arquivo, cod_item, novo_estoque: fechamento_anterior}` e `POST /api/lmc/confirmar-sincronizacao` (dispara o Motor V7) |
| `main` | `171-230` | processa sequencialmente com **delay de 2000ms** entre arquivos (para nao esgotar o pool); resumo final |

O **contrato de continuidade** consumido pelo script vive em `GET /api/lmc/continuidade/:id_sped` (`server.js:2830-2890`): uma CTE que acha o arquivo anterior (mesmo CNPJ normalizado, periodo `LEFT(...,7)` imediatamente menor), pega o fechamento fisico do ultimo dia do mes anterior por produto (`DISTINCT ON cod_item TRIM`, `COALESCE(fech_fisico_ajustado, fech_fisico)`) e a abertura do mes atual, retornando `fechamento_anterior`, `abertura_atual` e `diferenca`.

A **ordem cronologica e essencial:** o fechamento de cada mes precisa estar redistribuido antes de virar abertura do mes seguinte. Por isso `listarArquivos` ordena por competencia e `main` processa estritamente em sequencia.

> **GOTCHAS:**
> - `JWT_SECRET` tem fallback hardcoded (`'audisped-safira-token-secret-2025'`) e gera token admin `id=1` — se o server usa o mesmo fallback, qualquer um com o script autentica como admin.
> - `novo_estoque = parseFloat(d.fechamento_anterior)`; se a continuidade retornar `null/undefined` (produto sem dado no mes anterior), vira `NaN` e e enviado ao `confirmar-sincronizacao` — depende da validacao do endpoint destino.
> - O delay de 2s entre arquivos e o mitigante conhecido para o padrao "pool esgota com exportacoes em sequencia rapida".

---

### 4.14 Fluxo de dados consolidado

```
                       ┌─────────────────────── ENTRADA ───────────────────────┐
                       │                                                        │
  Motor Re-distribuir  │   lmc_movimentacao (estq_abert/vol_saidas/fech_fisico  │
  (busca binaria 6.x)  │       _ajustado)  ─── mapAjustes / mapBaseFisico       │
                       │   encerrantes_exportados / encerrantes_bicos_exportados│
                       │       (continuidade intermensal)                       │
                       │   documentos_c100/c170/c190  ─── mapC100/C170/C190      │
                       │   lmc_tanques_config  ─── mapCapacidadesPorItem         │
                       │   empresas (nome p/ arquivo)                            │
                       │   ARQUIVO SPED fisico (fs.readFileSync latin1)          │
                       └────────────────────────┬───────────────────────────────┘
                                                 ▼
   PRE-SCAN: COD_ITEMs referenciados, 0000, dias1300, dedup D100
                                                 ▼
   LOOP linha-a-linha → 0000 (transmuta 019→020) / 0200 (omite orfaos) / H010 (QTD do LMC)
                      → 1300/1310/1320 bufferizados em pending* → flush1300Group:
                         PASS 1 → redistrib → recalc mae (ancora vs escudo) → PASS 1.5
                         → PASS 3 (bicos) → PASS 3.5 → PASS 4 (1300 = Σ1310)
                      → C100/C170/C190/E210 ajustados inline
                                                 ▼
   POS-LOOP: persiste FECH e encerrantes (encerrantes_exportados / _bicos_exportados),
             injeta 0150 faltantes (Fix C), recalcula 9900/0990/1990/9999
                                                 ▼
   ┌──────────────────────────── SAIDA ────────────────────────────┐
   │  res.write linha-a-linha + '\r\n'  →  TXT (delimitado por |)   │
   │  Content-Disposition: CNPJ_NOME_MM-YYYY.txt  (iso-8859-1)      │
   │  Header X-Export-Lmc-Lacuna (alerta de LMC incompleto)        │
   └───────────────────────────────────────────────────────────────┘
```

A continuidade (FECH e encerrantes) persistida ao final realimenta a Fonte 1 da proxima exportacao mensal, fechando o ciclo: **o FECH exportado de um mes vira a ABERT do mes seguinte**.

---

### 4.15 Sintese das invariantes garantidas pelo Motor V7

1. `1300 = Σ(1310)` — garantido pelo PASS 4 (reescreve o 1300 com a soma exata dos tanques).
2. `1310.VOL_SAIDAS = Σ(1320.VOL_VENDAS)` — garantido pelo PASS 3.5.
3. Perda/ganho ≤ 0,60% (margem operacional 0,55% por tanque) — garantido pelo `escudoAnpMae` em todos os passes e pelo ESCUDO ANP FINAL no 1300 mae.
4. `FECH` = ancora do banco quando compativel com o ANP; senao FECH seguro do escudo — decisao central do PASS 2 (4.8.4).
5. Encerrantes de bicos continuos e crescentes (dia a dia via `encerrantesBombasMap`; entre meses via `encerrantes_bicos_exportados`) — garantido pelo PASS 3 com aritmetica inteira em mililitros.
6. `ABERT(N) = FECH(N-1)` e `ABERT(1o dia mes) = FECH(ultimo dia mes anterior)` — garantido por `ultimoFechExportado` e pela carga de continuidade intermensal de tres fontes.
7. Contadores estruturais (9900/0990/1990/9999) coerentes apos omissoes e insercoes — garantido pela recontagem final.

Arquivo principal: `/Users/esmael/meus_sistemas/audisped/backend/server.js` (rota `GET /api/exportar-sped/:id`, linhas 5884-7687). Componentes irmaos: `/Users/esmael/meus_sistemas/audisped/backend/services/spedCostureiraService.js` e `/Users/esmael/meus_sistemas/audisped/backend/redistribuir_automatico.js`.

---

## 5. Fiscais Acessorios: MDe, Espiao, Injetores XML/CTe, De-Para

Esta seção documenta o conjunto de funcionalidades fiscais acessórias do Audisped: a Manifestação do Destinatário (MD-e) e o "Espião NF-e" (consulta SEFAZ via provedor terceirizado), a injeção de XML de NF-e modelo 55 nos blocos `C` do SPED, a injeção de CT-e modelo 57 no bloco `D`, o cadastro de-para de produtos e os extratores Python de DACTE/CT-e. Em conjunto, esses módulos sustentam a auditoria de completude documental (cruzamento SPED × SEFAZ) e a escrituração assistida de documentos de entrada (compras de combustível e frete) que alimentam o LMC e a apuração de ICMS.

### 5.1. Arquitetura geral e camadas

O fluxo está dividido em três camadas:

- **Rotas REST** (`backend/server.js`) — expostas ao frontend (`MdeView.vue`, `InjetorXmlView.vue`, `ExploradorDeDocumentos.vue`, `XmlTributacaoView.vue`), todas protegidas (na maioria) por `authMiddleware`.
- **Services de integração e transformação** — `services/mdeService.js` (fachada), `services/espiaoNfeService.js` (motor real SEFAZ), `services/sefazService.js` (utilitário órfão de certificado), `services/xmlInjectorService.js` (motor de tributação NF-e→SPED), `services/cteInjectorService.js` (motor CT-e→Bloco D) e `services/spedCostureiraService.js` (costura física e reapuração).
- **Scripts Python standalone** (`backend/scripts/*.py`) — coleta de XMLs/DACTEs de e-mail e extração de chaves de acesso, não acoplados ao Node.

Helpers transversais em `server.js:83-147`: `safeConnect` tenta `pool.connect()` e responde `503 Servidor sobrecarregado` retornando `null` quando o pool esgota (mitigação do problema de esgotamento de pool); `safeRollback` faz `ROLLBACK` sem nunca lançar; `authMiddleware` valida JWT do header `Authorization: Bearer` **ou** de `query.token`. Nenhuma das rotas verifica se o `req.user` tem direito ao `id_empresa` do path/body — **não há autorização por tenant**, apenas autenticação.

---

### 5.2. MD-e e Espião NF-e

#### 5.2.1. Modelo conceitual

A Manifestação do Destinatário (MD-e, NT 2012/002) é o evento pelo qual o destinatário de uma NF-e declara à SEFAZ a sua posição sobre a operação. O Audisped trabalha com os quatro eventos oficiais:

| Evento | Código | Significado |
|---|---|---|
| Ciência da Operação | `210210` | Libera o download do XML completo da NF-e de entrada |
| Confirmação da Operação | `210200` | Confirma a operação |
| Desconhecimento da Operação | `210220` | Declara desconhecimento |
| Operação não Realizada | `210240` | Operação não concretizada |

Regra fiscal central: **sem Ciência ou Confirmação, o destinatário só vê o resumo da nota** — o XML completo (com itens, NCM, CFOP) só é liberado após a manifestação. Os códigos estão em `espiaoNfeService.js:329-368` (`manifestar`, mapa `mapaTipos`).

A integração originalmente seria direta com a SEFAZ via certificado A1; **hoje o `mdeService` é apenas uma fachada (adapter) que delega quase tudo para o `espiaoNfeService`**, que consome a API comercial EspiãoNFe (`api.espiaonfe.com.br/v1-cloud`), autenticada por dois tokens de ambiente (`ESPIAONFE_CLOUD_TOKEN` / `ESPIAONFE_USER_TOKEN`) em headers `esp-cloud-token` / `user-token` (`espiaonfeService.js:19-33`). A sincronização real usa o **CNPJ** da empresa, não o certificado — o PFX/NSU armazenados ficam praticamente sem uso (dívida técnica/legado).

#### 5.2.2. Rotas REST

| Rota | Linhas (`server.js`) | O que faz |
|---|---|---|
| `GET /api/mde/sync/:id_empresa` | `297-304` | Sincroniza notas com janela **FIXA de 30 dias** (delega a `mdeService.syncNotas`) |
| `GET /api/mde/notas/:id_empresa` | `306-332` | Lê `mde_cache` com filtros opcionais `inicio`/`fim` sobre `data_emissao` |
| `GET /api/mde/xml/:chave_nfe` | `335-354` | Retorna `xml_content` do cache (404 se ausente/NULL); **não busca on-the-fly** |
| `POST /api/mde/manifestar` | `356-365` | Manifesta evento; mapeia erros de negócio para `422` |
| `POST /api/mde/importar-chave` | `367-381` | Importa chave única ou lote (heurística por vírgula/espaço/quebra) |
| `POST /api/mde/delete-notas` | `382-402` | Exclui notas em lote (transação + escopo por `id_empresa`) |
| `GET /api/espiao/sync/:id_empresa` | `405-414` | Sincroniza com **período do cliente** (`inicio`/`fim`) — rota correta para competências antigas |
| `GET /api/espiao/notas/:id_empresa` | `416-423` | Lista com filtros `status`, `query` (ILIKE), `limit`/`offset` |
| `POST /api/espiao/importar-lote` | `425-433` | Importa lote de chaves |
| `POST /api/espiao/conferir-sped` | `435-443` | Cruza chaves do SPED (`C100`) contra o cache |
| `POST /api/espiao/download-zip` | `445-456` | Streama ZIP dos XMLs (archiver) |
| `GET /api/espiao/download-xml/:id_empresa/:chave` | `458-467` | Baixa XML único **sempre da API** |
| `POST /api/mde/certificado` | `469-477` | Salva certificado A1 (.pfx) |
| `GET /api/mde/certificado/:id_empresa` | `479-486` | Status do certificado (sem expor senha/PFX) |
| `POST /api/mde/check-sped` | `7991-8017` | Conferência MDe × SPED via UNION (`mde_cache` ∪ `documentos_c100`) |
| `POST /api/mde/sync-missing` | `8019-8038` | Dispara `importarChavesLote` para chaves faltantes |

> **Armadilha de período.** A rota `GET /api/mde/sync` fixa uma janela de 30 dias em `mdeService.js:51-55` — inútil para auditar competências SPED antigas (ex.: Ago/2022 das empresas analisadas). Para isso é obrigatório usar `GET /api/espiao/sync` com `inicio`/`fim`.

#### 5.2.3. Motor de sincronização (`EspiaoNfeService.syncNotas`, `espiaoNfeService.js:39-113`)

Resolve o CNPJ da empresa e chama `GET /consulta/periodo/nfe-resumo` com `modelo=55` (NF-e), paginando via `codigoProximaPagina` em `while(temMais)`. Para cada nota faz **UPSERT** em `mde_cache` (`ON CONFLICT chave_nfe DO UPDATE`) gravando: chave, NSU, CNPJ/nome do emitente, `valorTotal` (vírgula→ponto), `data_emissao`, `status_manifesto` (campo `manifestacao` da API, fallback `'Identificada'`) e `tipo_operacao` derivado de `tipoOperacao` (`0`→Entrada, `1`→Saída, outro→Desconhecido). Há um `delay` de 1s entre páginas para respeitar a cota de **3 requisições por 1s** da API.

Armadilhas:
- **Modelo fixo `55`** — NFC-e (65) e CT-e (57) **não** entram no cache; cruzamentos de frete via MDe ficam de fora.
- Faz **1 INSERT por nota** dentro do loop, sem batch nem transação — lento e não-atômico em períodos grandes.
- `tipoOperacao` Entrada/Saída vem da semântica da API terceira, **não do CFOP real**.

#### 5.2.4. Manifestação (`mdeService.manifestar`, `mdeService.js:67-138`)

Busca o CNPJ em `empresas`, limpa pontuação e delega a `espiaoNfeService.manifestar(chave, tipo, cnpj)`. Em sucesso, atualiza `mde_cache.status_manifesto` via `statusMap` (`ciencia`→`'Ciência da Operação'`, etc). Para `ciencia`/`confirmacao` dispara `downloadXml` automaticamente (coerente com a regra de que a Ciência libera o XML); falha no download é apenas `warn`.

Tratamentos fiscais importantes:
- **CStat 573 (Rejeição: Duplicidade de evento)** é tratado como sucesso idempotente — quando a SEFAZ já tem o evento registrado, sincroniza o status local em vez de erro.
- Converte `'chave de acesso não encontrada'` em mensagem de negócio explicando que **notas de saída** ou não sincronizadas não podem ser manifestadas. A rota mapeia essas mensagens (`'não localizou'`, `'Notas de saída'`) e `err.statusCode===422` para HTTP `422`.

A chamada HTTP real (`espiaoNfeService.manifestar`, `:329-368`) valida que a chave limpa tenha exatamente 44 dígitos e faz `POST application/x-www-form-urlencoded` com `cnpjCpf`, `chaveAcesso`, `codigoManifestacao`. Como usa `replace(/\D/g)` na chave, uma chave com letras seria corrompida silenciosamente em vez de rejeitada.

#### 5.2.5. Importação por chave e download de XML

`EspiaoNfeService.importarChavesLote` (`espiaoNfeService.js:241-308`) implementa o pipeline **placeholder → Ciência → download**:

1. `split(/[,\s]+/)` e filtra tokens com **exatamente 44 caracteres**;
2. INSERT placeholder (`ON CONFLICT DO NOTHING`) com status inicial `'Ciência da Operação'`;
3. `manifestar(chave,'ciencia',cnpj)` — falha é só `warn` (pode já estar manifestada);
4. aguarda 1s e tenta `downloadXml`; marca `xml_baixado`;
5. `delay` de 500ms entre chaves (cota).

> **Gotcha fiscal.** O placeholder grava status `'Ciência da Operação'` **antes** de manifestar; se a Ciência real falhar (apenas `warn`), o cache afirma uma manifestação que **não ocorreu na SEFAZ**.

`downloadXml` (`:118-154`) faz `GET /consulta/chave/xml` e detecta dois formatos: (a) string contendo `<nfeProc` ou `<?xml`; (b) JSON `{xml: base64+gzip}` descomprimido via `zlib.gunzipSync`. Persiste em `xml_content`, chama `parseAndSaveXmlData` e `saveXmlToDisk`.

`parseAndSaveXmlData` (`:159-207`) usa `fast-xml-parser`, localiza `nfeProc.NFe` ou `NFe`, lê `infNFe.ide.nNF`/`.serie` e mapeia cada `det` extraindo `xProd`, `NCM`, `CFOP`, `uCom`, `qCom`, `vUnCom`, `vProd` para `itens_json` (JSONB). **São exatamente os campos necessários para o futuro cruzamento item-a-item com C170/C190** e validação de combustíveis (ANP/LMC). Erros de parse são apenas logados (catch silencioso) — a nota fica sem `itens_json`/`numero`/`serie` sem alertar o usuário; não trata schema de CT-e.

`saveXmlToDisk` (`:212-236`) grava em `uploads/xmls/{CNPJ}/{AAAA-MM}/{chave}.xml`, **derivando ano/mês das posições 2-6 da própria chave** (AAMM = competência de emissão), o que organiza o acervo por período de escrituração. Assume século 20xx (`'20'+AA`) — quebra em 2100.

#### 5.2.6. Conferência SPED × SEFAZ (`EspiaoNfeService.conferirFaltantes`, `espiaoNfeService.js:398-414`)

Consulta `mde_cache` por `id_empresa` e `chave_nfe = ANY(chavesSped)`, retornando `chave + (xml_content IS NOT NULL) AS tem_xml`. Classifica:

- **`faltantesBanco`** — chaves do SPED ausentes do cache (escrituradas mas não vistas na SEFAZ → possível nota inexistente/cancelada/fraude);
- **`faltantesXml`** — presentes mas sem XML (precisam de manifestação/download);
- **`encontradas`** — no retorno significa "encontradas **com** XML" (`encontradas.length - faltantesXml.length`).

> **Gotchas.** (1) O nome `encontradas` é contraintuitivo (só as com XML). (2) Uma nota de **saída** no `C100` nunca terá XML baixável por MD-e, logo saídas escrituradas sempre aparecem como faltantes (falso positivo se a lista de chaves do SPED incluir saídas).

A rota alternativa `POST /api/mde/check-sped` (`server.js:7991-8017`) faz a conferência por UNION direto no banco (`mde_cache` ∪ `documentos_c100.chv_nfe` dos arquivos da empresa), mas o UNION **não normaliza/trim a chave** — chaves gravadas com padding ou sem trim podem gerar falso-faltante.

#### 5.2.7. Export em lote (`downloadBatchZip`, `espiaoNfeService.js:419-464`)

Cria `archiver` nível 9 e faz pipe no `responseStream`. Busca em lote o cache, usa XML do cache ou tenta `downloadXml` on-the-fly (delay 500ms). Se `totalArquivados===0`, anexa `AVISO_IMPORTANTE.txt` explicando que notas de **entrada** exigem Manifesto (Ciência/Confirmação) antes de liberar o XML. Erros por chave são engolidos (`warn`) — o ZIP pode sair parcial sem listar o que faltou; e o handler `archive.on('error')` só loga (não rejeita `finalize()`), podendo deixar o cliente com ZIP truncado.

#### 5.2.8. Certificado digital A1 (`mdeService.saveCertificado`, `mdeService.js:168-210`)

Usa `node-forge` para validar o `.pfx` (`pkcs12FromAsn1` com a senha; senha errada → exceção → HTTP `400`) e extrair a validade (`certBag.cert.validity.notAfter`, pegando apenas o **primeiro** certBag — pode pegar o cert errado em PFX com cadeia). A senha é cifrada em **AES-256-CBC** com chave derivada por `scryptSync(ENCRYPTION_KEY,'salt',32)` e IV aleatório, no formato `ivHex:cipherHex`. UPSERT em `empresa_certificados`. `decrypt`/`getCertificado` (`:19-45`) revertem a cifra; `ultimo_nsu_consultado` é o NSU do serviço de Distribuição de DFe.

> **Riscos de segurança do certificado:**
> - `ENCRYPTION_KEY` e `JWT_SECRET` têm **fallback hardcoded** (`'audisped-master-key-security-2026-sefaz'` no mdeService; `'audisped-safira-token-secret-2025'` no script de redistribuição);
> - **salt fixo `'salt'`** em `scryptSync` anula parte do propósito do scrypt;
> - o **PFX é guardado em base64 em claro** no banco — exposição do certificado se o banco vazar;
> - token aceito via `query.token` vaza em logs/Referer.

#### 5.2.9. Inconsistências de manutenção (MDe/SEFAZ)

- **Incompatibilidade de criptografia.** `mdeService` deriva a chave com `scryptSync(KEY,'salt',32)`; `sefazService` (`:12-31`) usa `Buffer.from(KEY.padEnd(32).slice(0,32))` e default de `ENCRYPTION_KEY` diferente. **São esquemas incompatíveis** — `sefazService.decrypt` nunca lê o que `mdeService.saveCertificado` cifrou.
- **Código morto.** `sefazService` (incluindo `getCertificateMetadata`, `:36-76`) está importado mas **nenhum método é chamado** em lugar nenhum — duplicação que confunde manutenção.
- **Bug de schema.** `saveCertificado`/`getStatusCertificado` referenciam a coluna `data_validade`, mas `setup_db.js` cria `empresa_certificados` com `validade_inicio`/`validade_fim`. Depende de `ALTER TABLE` externo não visto nesses arquivos, senão quebra em runtime.
- **Vazamento cross-tenant.** `GET /api/mde/xml/:chave_nfe` e `mdeService.getXml` (`:145-149`) **não filtram por `id_empresa`** e `chave_nfe` é `UNIQUE global` — qualquer usuário autenticado lê o XML/itens de qualquer empresa só conhecendo a chave (impressa na DANFE). Os UPDATEs de `status_manifesto`/`xml_content` também não têm `WHERE id_empresa`.
- **Pools redundantes.** `mdeService` e `espiaoNfeService` instanciam cada um seu próprio `Pool` pg, além do pool central — `safeConnect`/`MAX_HEAVY_OPS` não protegem as queries dos services, agravando o esgotamento de pool relatado na MEMORY.

---

### 5.3. Injetor de XML de NF-e (Blocos 0 e C)

#### 5.3.1. Propósito

Recebe XMLs de NF-e modelo 55 e os transforma em registros SPED EFD ICMS/IPI dos blocos `0` (0150/0190/0200) e `C` (C100 cabeçalho, C170 itens, C190 analítico). Suporta: (a) análise de itens para montar o de-para; (b) injeção física dentro de um arquivo SPED existente (costura), com recálculo de E110/E210 e assinaturas; (c) injeção de múltiplos grupos (CFOPs) numa requisição; (d) geração de SPED standalone só com XMLs. Após a injeção, atualiza entradas de combustível no LMC e sincroniza C100/C170 no banco.

#### 5.3.2. Rotas REST

| Rota | Linhas (`server.js`) | O que faz |
|---|---|---|
| `POST /api/xml-injector/analyze-items` | `1425-1479` | Analisa até 200 XMLs (`analyzeOnly:true`), retorna `itensDetectados` para montar de-para; não persiste |
| `POST /api/xml-injector/save-de-para-batch` | `1483-1549` | UPSERT em lote de mapeamentos em `de_para_xml` (com `ALTER TABLE` runtime) |
| `POST /api/xml-injector/parse` | `1551-1758` | Injeção física principal num SPED base, com detecção de duplicatas (409) e validação CNPJ/período (422) |
| `POST /api/injetar-grupos` | `1761-1971` | Injeção de múltiplos grupos (CFOP por grupo) numa única requisição |
| `POST /api/xml-injector/standalone` | `1974-2092` | Gera um SPED novo só a partir de XMLs (download .txt latin1) |
| `GET /api/de-para` | `7906-7930` | Lista `de_para_xml` (filtros `id_empresa`/`cnpj`) — **SEM authMiddleware** |
| `POST /api/de-para` | `7932-7977` | UPSERT de-para com `ALTER TABLE` runtime — **SEM authMiddleware** |
| `DELETE /api/de-para/:id` | `7979-7988` | Remove de-para por id — **SEM authMiddleware** |

#### 5.3.3. Fluxo de injeção física (`POST /api/xml-injector/parse`, `server.js:1551-1758`)

1. Parseia XMLs (`extractNfeData`), separa erros.
2. Se `idSpedBase`: busca `sped_arquivos` (nome, caminho, `cnpj_empresa`, `periodo_apuracao`); resolve o caminho físico (`caminho_arquivo` pode ser JSON — pega `Object.values()[0]`); valida existência no disco.
3. Lê o SPED em **latin1**, varre linhas `|C100|` e monta `Map` de chaves existentes (`params[9]=chv_nfe`) para deduplicação.
4. **Detecção de duplicatas**: se `!forceReplace && !analyzeOnly` e há chaves repetidas e não é `pular_duplicados` → retorna **409** listando as notas que seriam substituídas. Se `forceReplace` → coleta `chavesParaSubstituir`.
5. **Validação de período/CNPJ** via `validarXmls`: bloqueia **422 `cnpj_divergente`** se CNPJ destinatário ≠ CNPJ do SPED; avisa **422 `periodo_divergente`** se `dt_doc` fora do período, salvo `force_periodo`.
6. Monta `options` (userCfop, `forcarUsoConsumo`/`forceCst040`, `ajusteIpi`, `ajusteIcms`, `itemMapping`, `pularDuplicados`, `chavesExistentes`, `idEmpresa`).
7. `transformarNotasEmSped` gera `bloco0`/`blocoC`.
8. `injetarXmlEPersistir` costura no arquivo físico (substituindo chaves), grava em latin1.
9. `processarAtualizacaoLmcPosInjecao` atualiza entradas de combustível no LMC.
10. `sincronizarNotasInjetadas` grava C100/C170 no banco (`dt_doc` como `dt_e_s`).

Sem `idSpedBase`, retorna o payload (`bloco0`, `blocoC`, `itensDetectados`, `gerencial`, `relatorio`) sem persistir.

A rota `POST /api/injetar-grupos` (`:1761-1971`) processa cada grupo com `forceUserCfop:true` (o CFOP do grupo **sempre** prevalece sobre o de-para). O **primeiro grupo lê do disco** (`costurarEAssinar`) e os seguintes operam em memória (`costurarEAssinarLinhas`), com **única escrita ao final** (`linhasAtuais.join`). A validação CNPJ/período de **todos** os XMLs ocorre antes de processar qualquer grupo (reparseando os XMLs — desperdício de I/O).

#### 5.3.4. Parser canônico (`extractNfeData`, `server.js:1245-1422`)

Produz `{emitente, destinatario, c100, itens}`. Por item extrai CST/CSOSN (do primeiro nó de ICMS, `Object.values(imposto.ICMS)[0]`), BC/pICMS/vICMS, ST (`vBCST`/`vICMSST`), ST retido (`vBCSTRet`/`vICMSSTRet`/`pST`, relevante a CST 60), FCP/FCPST somados a vICMS/vICMSST, IPI (`vIPI`/`vBC`/`pIPI`/CST default 99), PIS/COFINS (default CST `'07'`) e `vIPIDevol`. O `c100` traz `chv_nfe` (Id sem `'NFe'`), `num_doc`, `serie`, `mod` (default 55), `dt_doc`/`dt_e_s` (de `dhEmi`/`dEmi`/`dhSaiEnt`). **Fallback importante**: se `vNF` vier 0/ausente, recalcula `vl_doc` somando itens (`vProd - vDesc + vFrete + vSeg + vOutro + vIPI + vICMSST + vIPIDevol`).

> **Gotcha estrutural.** `extractNfeData` fixa `c100.ind_emit='1'` e `c100.ind_oper='0'` (**sempre entrada de terceiro**, `server.js:1417`). As rotas `parse`/`injetar-grupos` não diferenciam saída — apenas o `standalone` calcula `ind_oper`/`ind_emit` corretamente comparando emitente vs CNPJ da empresa. NF-e própria de saída via XML não seria tratada corretamente.

#### 5.3.5. Motor de tributação (`transformarNotasEmSped`, `xmlInjectorService.js:82-681`)

É o núcleo da geração. Carrega de-para em **duas prioridades**: (1) `itemMapping` manual do frontend (chave `CNPJ_codProduto`); (2) complemento via `de_para_xml` do banco para os CNPJs das notas (sem sobrescrever o manual). Cada mapeamento traz `novo_cfop`, `novo_cst`, `conta_contabil`, `descricao_produto`, `ncm`, `cod_interno`, `aliq_icms`, `bc_icms_override`, `cst_pis`, `cst_cofins`.

Por nota: pula duplicatas (`pularDuplicados`+`chavesExistentes`), pula notas sem itens (evita C100 sem filho obrigatório), gera `0150` (participante/emitente, `cod_pais` `01058`).

Por item (`C170`), a resolução fiscal:
- **`finalCfop`** = de-para (salvo `forceUserCfop`) → `userCfop` → CFOP do XML → `'1102'`.
- **`finalCst`** via `normalizarCst` (converte CSOSN→CST, corrige 61→60 etc.).
- **BC ICMS** = `bc_icms_override` do de-para → `vBC` do XML se >0 → cálculo `(vlItem - desc + frete + seg + outro)` apenas para CSTs `000/010/020/070/090`.
- **vICMS** = override de alíquota → vICMS do XML se >0 → `BC*aliq/100`.
- **Ajustes de custo**: `ajusteIpi` incorpora IPI ao item e zera o IPI; `ajusteIcms` zera ICMS/BC; `forcarUsoConsumo` + CFOP `1556` força CST `040` e incorpora ST+IPI+IPIDevol ao custo (uso/consumo não credita).
- **CST 060/061** usa os valores ST **retidos**.
- **CST_IPI ≥ 50 em entrada** é forçado a `49` (CSTs IPI 50-55 são de saída).
- **QTD mínima `1,0`** se o XML vier com `qCom=0`.

A agregação **C190** é por chave `CST_CFOP_aliq`, somando `vl_opr` (= `vlItem - desc + frete + seg + outro + ST + IPI + IPIDevol`). **O `vl_doc` do C100 é recalculado como a soma dos `vl_opr` dos C190** (`vlDocCalculado`), garantindo batimento C100 × C190 — substitui o `vNF` real do XML. Gera ainda `0190` (unidade) e `0200` (produto, com `cod_interno` do de-para, ou cód do XML, ou contador `9000+`). Retorna `bloco0`/`blocoC`/`itensDetectados`/`gerencial`/`relatorio`.

#### 5.3.6. Normalização CST/CSOSN (`normalizarCst`, `xmlInjectorService.js:3-55`)

`CSOSN_PARA_CST` traduz o Simples Nacional para o CST de 3 dígitos que o destinatário (regime normal) deve escriturar — o emitente do Simples emite com CSOSN, mas **o EFD do destinatário não aceita CSOSN**:

| CSOSN | CST | CSOSN | CST |
|---|---|---|---|
| 101 | 020 | 300 | 040 |
| 102/103 | 040 | 400 | 041 |
| 201/202/203 | 030 | 500 | 060 |
| | | 900 | 090 |

Valida os 2 últimos dígitos contra `SITUACOES_CST_VALIDAS` (`00,10,20,30,40,41,50,51,60,70,90`), preservando o 1º dígito (origem). `CORRECOES_SITUACAO` conserta XML mal formado (61→60, 11→10, 21→20, 31→30). Fallback `'000'`.

> **Gotcha.** O fallback silencioso para `'000'` (tributada integral) pode transformar mercadoria isenta/ST/diferida em tributada e gerar **crédito de ICMS indevido**. O mapeamento `101→020` ("com crédito" → "tributada com redução de BC") pode não refletir o crédito real do Simples.

#### 5.3.7. Persistência pós-injeção

`sincronizarNotasInjetadas` (`server.js:1098-1189`) grava C100/C170 no banco. Resolve `cod_part` via `sped_participantes`, insere `documentos_c100` com `ind_oper='0'` **fixo** (entrada), `dt_doc`=`dt_e_s`. Suporta dois formatos de campo (canônico `qcom/vprod` e legado `qtd/vl_item`). Resolve `cod_item`/CFOP via `de_para_xml`; fallback de CFOP converte ótica emitente→destinatário (`5xxx→1xxx`, `6xxx→2xxx`). **`cst_pis`/`cst_cofins` gravados FIXO `'07'`**, ignorando o XML e o de-para — diverge do C170 do arquivo físico. Erros são apenas logados (não falham a injeção).

`processarAtualizacaoLmcPosInjecao` (`server.js:986-1241`) atualiza o LMC: `detectarCombustivelNfe` identifica combustível por **NCM** (`NCM_COMBUSTIVEL_MAP`: 27101259 gasolina, 27101921 diesel, 22071000 álcool, 27112100 GNV) **ou CFOP** (1652/2652/1653/2653). `atualizarEntradaLmcXml` **recalcula** `vol_entr_ajustado` em `lmc_movimentacao` como `SUM(qtd)` das NFs reais na data/cod_item (não acumula incrementalmente; nunca altera `vol_entr` original), atualiza `estq_escr`/`vol_escr_ajustado` e **distribui o volume igualmente entre tanques** (`perTank = total/N`). Fallback: NF de outro mês cai no 1º dia do período do SPED.

> **Gotchas LMC.** A distribuição igualitária entre tanques de capacidades diferentes distorce o estoque por tanque e a variação ANP por bico; o fallback de período lança a entrada em data que não corresponde à entrada física real; `QTD` forçada a `1,0` quando `qCom=0` injeta 1 litro fictício no LMC.

#### 5.3.8. Sugestão de código interno (`sugerirCodInterno`, `xmlInjectorService.js:686-736`)

Sugere o `cod_item` (registro 0200) já usado pela empresa para um produto novo, casando por **NCM** em três tentativas: (1) JOIN `sped_produtos × sped_arquivos` por NCM exato ordenado por `similarity(descr_item, descrição)` (extensão `pg_trgm`); (2) só NCM exato; (3) fallback `ILIKE '%primeira_palavra%'` se `pg_trgm` indisponível. Reaproveita o COD_ITEM existente, evitando duplicar produto no Bloco 0 e mantendo continuidade de inventário.

#### 5.3.9. Riscos do standalone e placeholders do Bloco 0

Os registros `0000`/`0005`/`0100` gerados em `transformarNotasEmSped` são **placeholders fixos perigosos**: versão `'018'`, `DT_INI`/`DT_FIN` cravadas `01012025`/`31012025` (comentário "ajustar depois"), `COD_MUN` sempre `'3550308'` (São Paulo) independente da UF, IE/IM vazios, perfil `'A'`, contador fictício. Na injeção física não importam (o arquivo base já os tem), mas no **standalone produzem cabeçalho fictício/inválido para o PVA**. Pior: `gerarSpedFragmentado` usa `0000` com versão `'015'`, município `5103403` (MT) e datas `01012026`/`31012026` — incoerente com o service. O standalone gera arquivo só com blocos `0` e `C` (sem `E`/apuração), que o PVA reprovaria como arquivo completo.

#### 5.3.10. Costura e reapuração (`spedCostureiraService.js`)

`processarLinhas`/`costurarEAssinar`/`costurarEAssinarLinhas`/`injetarXmlEPersistir` (`:189-361, 568-656`) inserem os registros no SPED existente respeitando hierarquia. Removem linhas em branco, corrigem `H005 DT_INV` posterior ao fim do período, removem `C100`+filhos das `chavesParaSubstituir` (máquina de estado por registro) e injetam `0150/0190/0200/blocoC`. `costurarEAssinar` lê do disco (stream latin1); `costurarEAssinarLinhas` opera em memória.

`recalcularE110`/`recalcularE210` (`:376-563`) reapuram após a injeção:
- **E110 (ICMS regular)** soma `VL_ICMS` dos C190/C590/D190/D590 — CFOP `1xx`(≠1605)/`2xx`/`3xx`/`5605` = crédito; `5xx`(≠5605)/`6xx`/`7xx` = débito; ignora docs cancelados/denegados (`cod_sit` 02/03/04/05). Calcula `VL_SLD_APURADO`, `VL_ICMS_RECOLHER`, `VL_SLD_CREDOR_TRANSPORTAR`.
- **E210 (ICMS ST)** apura `VL_OUT_CRED_ST`, `VL_RETENCAO_ST`, `VL_TOTAL_DEB_ST` e saldos.

> **Por que reapurar.** A injeção de notas de entrada com ICMS gera **crédito** que altera a apuração — sem reapurar, o PVA acusaria erro de batimento. A reapuração lê todos os C190/C590/D190 do arquivo (idempotente por leitura total).

---

### 5.4. Injetor de CT-e (Bloco D — D100/D190)

#### 5.4.1. Propósito

Injeta Conhecimentos de Transporte eletrônicos (CT-e, modelo 57) no SPED, gerando o Bloco D (D100 cabeçalho + D190 analítico) e os participantes-transportadora (0150). O foco fiscal é o **crédito de ICMS sobre o frete** das compras de combustível, com escrituração correta do tomador de serviço (`IND_OPER=0`, `IND_EMIT=1`).

#### 5.4.2. Rotas REST

| Rota | Linhas (`server.js`) | O que faz |
|---|---|---|
| `POST /api/cte-injector/analyze` | `8047-8085` | Preview sem gravar (`analyzeOnly:true`); até 500 XMLs; retorna `ctes` + `relatorio` |
| `POST /api/cte-injector/inject` | `8092-8185` | Injeta D100/D190 num SPED base e devolve `.txt` latin1 costurado |

#### 5.4.3. Parser (`parseCteXml`, `cteInjectorService.js:61-128`)

Configuração crítica do `XMLParser`: `parseTagValue:false` e `parseAttributeValue:false` são **deliberados** para impedir que a chave de 44 dígitos vire float/notação científica (perda de precisão) — decisão fiscal correta. `isArray` força `['Comp','infQ','infNFe','infNF']`.

O parser: tolera wrapper `cteProc` ou `CTe` nu; exige `infCte`; lê `ide`/`emit`/`dest`/`vPrest`/`imp` e `protCTe.infProt`; pega a chave de `prot.chCTe` com fallback no `@_Id` (sem prefixo `CTe`); `DT_DOC` de `dhEmi`/`dEmi` (suporta CT-e 3.00 e versões antigas); `cod_sit` = `'00'` se `cStat==='100'` (autorizado), senão `'02'`; identifica `cMunIni`/`cMunFim` (obrigatórios no D100 para modelo 57: `COD_MUN_ORIG`/`COD_MUN_DEST`); valores `vTPrest`/`vRec`; ICMS via `extrairIcms`.

`extrairIcms` (`:42-56`) acha o grupo de ICMS independente do CST (ICMS00/20/45/60/90/SN), com default fiscal CST `'40'` (isento) quando ausente, lendo `vBC`/`pICMS`/`vICMS`.

#### 5.4.4. Geração do Bloco D (`transformarCtesEmSped`, `cteInjectorService.js:135-271`)

Por CT-e: ignora os com `ok:false`; deduplica por chave contra `chavesExistentes` (Set); acumula `totalCtes`/`totalFrete`; gera `0150` (transportadora, 1× por CNPJ, `COD_PAIS` `1058`, `END`/`NUM` com fallback `'NAO INFORMADO'`/`'SN'`); gera `D100` (`IND_OPER='0'` entrada, `IND_EMIT='1'` terceiro, `COD_MOD='57'`, `COD_SIT`, `SER`, `NUM_DOC`, `CHV_CTE`, `DT_DOC`, `DT_A_P`, `TP_CTE`, `VL_DOC`=vTPrest, `IND_FRT='0'`, `VL_SERV`, `VL_BC_ICMS`, `VL_ICMS`, e campos 24/25 `COD_MUN_ORIG`/`COD_MUN_DEST`); gera `D190` analítico com **CFOP FIXO `'1353'`** (aquisição de serviço de transporte — entrada), `CST_ICMS` `padStart(3)`, alíquota, `VL_OPR`=vTPrest.

#### 5.4.5. Validação e costura (`POST /api/cte-injector/inject`, `server.js:8092-8185`)

Busca `sped_arquivos`, monta nome de saída `CNPJ_DDMMAAAA_DDMMAAAA.txt` (do `periodo_apuracao`). `validarXmls` compara `cnpj_dest` do CT-e com `cnpj_empresa` do SPED → **bloqueio 422 `cnpj_invalido`** se divergir; `dt_doc` fora do período → **422 `periodo_divergente`** salvo `force_periodo`. Se passar, `transformarCtesEmSped(analyzeOnly:false)` gera `blocoD`+`map0150`, e `costurarEAssinar(spedPath, novos0150, [], [], blocoD)` injeta os registros antes do `D990` (ou cria o bloco D após `C990`), força `D001 IND_MOV=0`, recalcula `E110` (somando `VL_ICMS` de D190 CFOP `1xx`≠1605 como **crédito** — é assim que o frete vira crédito de ICMS), `E210`, `0220`, e por fim `recalcularAssinaturasBlocos` atualiza `0990/D990/9900/9990/9999`. Devolve `.txt` latin1.

#### 5.4.6. Gotchas fiscais do injetor CT-e

- **CFOP hardcoded `'1353'`** (`:223`): todo CT-e vira aquisição de serviço de transporte de entrada. O CFOP real (`ide.CFOP`) é lido em `cte.cfop` mas **ignorado** no D190. CT-e tomado em outra UF (deveria ser `2.353`) ou de outra natureza fica com CFOP errado e gera **crédito potencialmente indevido** na E110.
- **`IND_FRT` hardcoded `'0'`** (`:209`): assume sempre frete por conta do remetente, sem ler o responsável real.
- **`COD_SIT` colapsa qualquer `cStat != 100` em `'02'` (cancelado)**: `cStat 150` (autorizado fora de prazo) deveria ser `'00'`; denegados (110/301/302) deveriam ser `'04'`.
- **Deduplicação inexistente no inject**: `transformarCtesEmSped` recebe `chavesExistentes` default `[]` e a rota `/inject` **não popula esse array** — a dedup só atua dentro do mesmo lote, não contra CT-e já escriturados no SPED base. Risco de D100 duplicado.
- **All-or-nothing por período**: se **qualquer** XML estiver fora do período (`avisosCte.length>0`), o lote inteiro é abortado (422) em vez de injetar os válidos.
- `limparCnpj` faz `padStart(14,'0')` mesmo recebendo CPF de 11 dígitos — gera "CNPJ" falso para destinatário pessoa física.
- `dbClient` é parâmetro de `transformarCtesEmSped` mas **nunca é usado** (assinatura `async` enganosa).
- `parseCteXml` não valida dígito verificador nem o tamanho de 44 da chave.
- `cte-injector/analyze` loga os primeiros 120 chars do XML cru (`[DIAG]`) — **vaza dados fiscais sensíveis em log**.

#### 5.4.7. Módulo órfão de auditoria (`auditoriaService.js:2-34`)

`detectarAnomaliasEstoque` recebe registros `1310` (saldo diário por tanque) e detecta (1) estoque parado (`ESTQ_INI>10` e `QTDE_SAIDA===0`, gravidade Alta) e (2) quebra excessiva (`VAL_PERDA/QTDE_SAIDA > 0.006` = 0,6%, gravidade Média). **Está MORTO**: sem `module.exports` e sem importadores. Espelha de forma simplificada e desatualizada a auditoria ANP 0,6% que de fato roda no `server.js` — manutenção pode editá-lo achando que tem efeito.

---

### 5.5. De-Para de produtos

#### 5.5.1. Conceito fiscal

O de-para (`de_para_xml`) é a **regra de negócio central** da injeção de NF-e: traduz o produto/operação da ótica do **fornecedor** para a ótica fiscal do **destinatário**. Corrige CFOP (ex.: de revenda `5656`/`6656` para entrada), CST ICMS, alíquota, base override, conta contábil, NCM, código interno e CST PIS/COFINS, por produto+emissor específico.

#### 5.5.2. Persistência (`POST /api/xml-injector/save-de-para-batch`, `server.js:1483-1549` e `POST /api/de-para`, `:7932-7977`)

Abre transação, executa `ALTER TABLE ADD COLUMN IF NOT EXISTS` para garantir as colunas (`ncm`, `cod_interno`, `conta_contabil`, `aliq_icms`, `bc_icms_override`, `cst_pis`, `cst_cofins`) — **migração de schema embutida em runtime no caminho quente** — e faz **UPSERT** com `ON CONFLICT (id_empresa, cnpj_emissor, cod_produto_xml)` usando `COALESCE(NULLIF(...),'')` para não sobrescrever valor existente com vazio. `novo_cfop`/`novo_cst` são sobrescritos sempre; os demais campos só quando não-vazios.

#### 5.5.3. Consumo

O de-para é carregado por `transformarNotasEmSped` (segunda prioridade após o `itemMapping` manual) e por `sincronizarNotasInjetadas` (resolução de `cod_item`/CFOP). A tabela é também lida/escrita pelas rotas CRUD `GET/POST/DELETE /api/de-para` (`:7906-7988`).

> **Gotchas de-para.** (1) As três rotas `/api/de-para` estão **sem `authMiddleware`**. (2) O `ALTER TABLE` a cada request gera custo de lock/latência e mascara o schema real (deveria ser feito na inicialização). (3) `bc_icms_override` definido sem `aliq_icms` (ou vice-versa) pode produzir `aliq × bc ≠ valor` em CSTs com redução de base.

---

### 5.6. Extratores Python de DACTE/CT-e

Conjunto de scripts standalone (`backend/scripts/*.py`), **não acoplados ao Node**, para coleta manual de documentos a partir de e-mails locais do Thunderbird e extração de chaves de acesso, produzindo insumos para confronto com a SEFAZ e posterior injeção.

| Script | O que faz | Saída |
|---|---|---|
| `extrator_cte_email.py` | Varre os `mbox` do Thunderbird (INBOX/Sent/Arquivo Morto), aceita `.xml` direto ou dentro de `.zip` em memória; detecta CT-e por `<cteProc>`/`<infCte>`/`<CTe>`; extrai chave/competência/CNPJ-emitente/`vTPrest` por **regex** | `~/Desktop/XMLs_CTE/AAAA/MM/CHAVE.xml`, `chaves_cte.txt`, `relatorio_cte.csv` (BOM utf-8-sig) |
| `extrator_dacte_pdf.py` | Salva anexos PDF DACTE + XML **só do INBOX**, filtrando por assunto (`PALAVRAS_CHAVE = ['ct-e','cte','carregamento','dacte']`) e data ≥ 2020-01-01 | `~/Desktop/DACTEs_CTE/AAAA/MM/` (organizado pela **data do e-mail**) |
| `extrair_chaves_dacte.py` | Lê recursivamente os PDFs com `pdfplumber`, extrai chaves de 44 dígitos (regex compacta e de 11 grupos), classifica modelo pela posição 20-21 (`57`=CT-e, `55`=NF-e), UF e AAMM; **filtra só modelo 57** | `chaves_cte.txt` (só CT-e), CSV completo (CT-e+NF-e) |

#### 5.6.1. Fluxo de uso

O fluxo Python é **paralelo e manual**: `mbox` Thunderbird → XMLs/DACTEs em `~/Desktop` → `chaves_cte.txt`/CSV. Essas chaves servem para baixar os XMLs oficiais na SEFAZ (por CNPJ) ou alimentar o "Espião NF-e", e os XMLs coletados são posteriormente subidos no injetor de CT-e.

#### 5.6.2. Gotchas dos extratores

- **Caminho do perfil Thunderbird hardcoded** (`8t4v17v8.default-release`) e saída fixa em `~/Desktop` — não portável.
- **Extração de CT-e por regex** (não DOM): quebra com namespaces prefixados (ex.: `<cte:emit>`); o CNPJ do emitente pega o primeiro `<CNPJ>` do bloco `<emit>`.
- `extrator_dacte_pdf.py` agrupa por **data do e-mail**, não pela competência do CT-e — um CT-e reenviado cairia na pasta do mês errado; o filtro por assunto pode perder CT-e sem palavra-chave ou capturar falsos positivos.
- `extrair_chaves_dacte.py`: a regex de 11 grupos exige separadores entre **todos** os grupos; DACTEs com layout/quebra de linha diferente podem não casar (lista "PDFs sem chave").

---

### 5.7. Síntese de riscos transversais

| Risco | Onde | Impacto |
|---|---|---|
| Vazamento cross-tenant | `GET /api/mde/xml/:chave_nfe`, `mdeService.getXml` | Qualquer usuário lê XML de qualquer empresa pela chave da DANFE |
| Falta de autorização por tenant | `authMiddleware` (todas as rotas) | Usuário A opera dados da empresa de B |
| Rotas sem auth | `DELETE /api/arquivo/:id`, `GET/POST/DELETE /api/de-para` | Exclusão/escrita destrutiva sem autenticação |
| Segredos hardcoded | `ENCRYPTION_KEY`, `JWT_SECRET`, salt fixo `'salt'`, PFX em claro | Comprometimento de certificado/token |
| CFOP fixo `1353` no D190 | `cteInjectorService.js:223` | Crédito de ICMS sobre frete potencialmente indevido na E110 |
| `ind_oper`/`cst_pis`/`cst_cofins` fixos | `extractNfeData`, `sincronizarNotasInjetadas` | Saída via XML mal tratada; CST divergente entre banco e arquivo |
| Janela fixa 30 dias | `mdeService.syncNotas` | Não audita competências antigas (usar `/api/espiao/sync`) |
| `ALTER TABLE` runtime | rotas de-para | DDL no caminho quente, schema mascarado |
| Pools pg redundantes | services MDe/Espião/optimize | Esgotamento de pool (alinhado à MEMORY) |
| Código morto/duplicado | `sefazService`, `auditoriaService.js` | Manutenção sobre código sem efeito |
| Incompatibilidade de cripto / bug de schema | `mdeService` vs `sefazService`; coluna `data_validade` | Falha silenciosa de descriptografia; quebra em runtime |

---

## 6. Frontend (Vue)

O frontend do Audisped é uma SPA construída em **Vue 3** com **Composition API** (`<script setup>`), roteamento via **vue-router** (`createWebHistory`), cliente HTTP **axios** com interceptors globais, ícones **lucide-vue-next**, gráficos **vue3-apexcharts** e estilização **Tailwind** (tokens de marca `brand-accent`, `naval`, `brand-surface`). O estado global **não** usa Pinia/Vuex: é um conjunto de `ref` reativos exportados de um módulo (`store.js`), padrão "store-as-module". A persistência de sessão e contexto é feita em `localStorage`.

### 6.1. Arquitetura do Core

#### Shell visual e menu lateral — `App.vue`

`App.vue:1-27` é o componente raiz. Importa do store o estado reativo (`empresaSelecionada`, `arquivoInfo`, `token`, `usuario`, `logout`) e define `handleLogout()`, que chama `logout()` (limpa token, usuário, arquivo e empresa) e redireciona via `router.push('/login')`.

O template (`App.vue:29-206`) renderiza a sidebar (`<aside v-if="token">`) somente quando autenticado. O cabeçalho mostra o nome do usuário (link `/perfil`), botão de logout e um "Context Header" com a empresa ativa (`empresaSelecionada.nome_empresa`) e link **Trocar Cliente** para `/`. O bloco `<nav v-if="empresaSelecionada">` lista os módulos fiscais:

| # | Item | Rota | Habilitação |
|---|------|------|-------------|
| 1 | Hub Central | `/dashboard/:id` | sempre (exact-active) |
| 2 | Injetor de XMLs | `/injetor-xml` | sempre |
| 3 | Injetor CT-e | `/injetor-cte` | sempre |
| 4 | De-Para (XML) | `/de-para` | sempre |
| 5 | Cadastro de CFOPs | `/cfops` | sempre |
| 6 | Manifesto (NFe) | `/mde` | sempre |
| 7 | Auditoria (Motor) | `/analisador` | sempre |
| 8 | Livro LMC | `/lmc/:arquivoInfo.id` | **só com `arquivoInfo`** (senão `opacity-40`, title "Carregue um SPED no Hub Central") |
| 9 | Impressão LMC | `/impressao-lmc` | **sempre** (não depende de `arquivoInfo`) |
| 10 | Posição de Estoque | `/rentabilidade/:arquivoInfo.id` | **só com `arquivoInfo`** |
| 11 | Gestão de Arquivos | `/empresa/:empresaSelecionada.id` | sempre |
| 12 | Meu Perfil | `/perfil` | sempre |

O footer "SPED em Memória" (`v-if="arquivoInfo"`) mostra `arquivoInfo.nome` e `arquivoInfo.periodo` com indicador verde pulsante. **Livro LMC** e **Posição de Estoque** dependem de um SPED carregado porque derivam de leituras de bombas/encerrantes (registros 1300/1310/1320) e do estoque; **Impressão LMC** está sempre habilitada (tem seus próprios filtros e pré-seleciona o contexto).

#### Roteamento e guarda de autenticação — `router/index.js`

O router (`router/index.js:1-103`) usa `createWebHistory(import.meta.env.BASE_URL)`. Importa de forma **eager** (síncrona) as views `EmpresasView` (= `HomeView.vue`), `ExploradorView`, `AnalisadorView` e `LoginView`; as demais são **lazy-loaded** via `import()` dinâmico.

| Rota | Nome / View | Auth |
|------|-------------|------|
| `/login` | login / LoginView | pública |
| `/` | home / HomeView (EmpresasView) | requiresAuth |
| `/dashboard/:id` | dashboard-cliente / DashboardHubView | requiresAuth |
| `/injetor-xml` | InjetorXmlView | requiresAuth |
| `/injetor-cte` | InjetorCteView | requiresAuth |
| `/analisador/:id?` | AnalisadorView (eager) | requiresAuth |
| `/empresa/:id` | historico-empresa / ExploradorView | requiresAuth |
| `/lmc/:id` | LmcView | requiresAuth |
| `/rentabilidade/:id` | RentabilidadeView | requiresAuth |
| `/de-para` | de-para-xml / DeParaXmlView | requiresAuth |
| `/xml-tributacao/:id?` | XmlTributacaoView | requiresAuth (**órfã**: não está no menu nem no hub) |
| `/mde` | MdeView (Manifesto) | requiresAuth |
| `/perfil` | ProfileView | requiresAuth |
| `/cfops` | CfopView | requiresAuth |
| `/impressao-lmc` | ImpressaoLmcView | requiresAuth |

Os `:id` geralmente referem-se ao **id do arquivo SPED** (`id_sped`) — exceto `/dashboard/:id` e `/empresa/:id`, que usam o **id da empresa**.

A guarda global `router.beforeEach` (`router/index.js:106-112`) redireciona a `/login` quando a rota destino tem `meta.requiresAuth` e `token.value` é falsy; caso contrário libera com `next()`. A validação é puramente client-side: apenas checa **presença** do token (não valida assinatura/expiração do JWT); a expiração é detectada pelo interceptor 401/403 do axios. **Não existe rota catch-all (404)** — paths inválidos caem em rota não resolvida do vue-router.

#### Estado global — `store.js`

Helpers de acesso seguro ao `localStorage` (`store.js:4-28`) protegidos por `typeof localStorage !== 'undefined'`: `getStorageItem` faz `JSON.parse` com `try/catch` (retornando o valor bruto se falhar), `setStorageItem` remove a chave se `value` for null, grava string direto ou `JSON.stringify` caso contrário.

Refs exportados (`store.js:30-41`):
- **Sessão**: `token` (string crua), `usuario` (objeto).
- **Contexto de auditoria**: `arquivoInfo` (`{id, nome, periodo, ...}`), `empresaSelecionada` (`{id, cnpj, nome_empresa, nome_fantasia, uf}`), `idArquivoSped` (id do SPED, lido cru sem `JSON.parse` — fica string).
- **Resultado da auditoria (apenas em memória)**: `auditErros` (`[]`), `auditResumoGerencial` (null), `auditResumoEstoque` (`[]`).

Setters e mutações:
- `setArquivoInfo` / `setIdArquivoSped` / `setEmpresaSelecionada` (`store.js:44-64`): definem o **contexto** que habilita o menu fiscal. `setArquivoInfo` propaga `info.id` para `setIdArquivoSped`, mantendo os dois ids sincronizados ao definir.
- `setAuth` / `setUsuario` / `resetArquivoSped` / `logout` (`store.js:66-92`): `setAuth` persiste token+usuário; `resetArquivoSped` zera `arquivoInfo`, `idArquivoSped` e os três estados de auditoria; `logout` faz `setAuth('', null)` + `resetArquivoSped()` + `setEmpresaSelecionada(null)`.

> **Atenção (dessincronização):** `idArquivoSped` e `arquivoInfo.id` guardam o mesmo id, mas são gerenciados separadamente (`idArquivoSped` lido cru, sem parse). E `logout()` persiste `token=''` (string vazia, falsy) em vez de remover a chave.

#### Bootstrap e cliente HTTP — `main.js` / `api.js`

`main.js:1-24` define `axios.defaults.timeout = 30000ms` e um **interceptor de request** que injeta `Authorization: Bearer ${token}` em toda requisição quando há token (sobrescrevendo header pré-existente) e faz `delete config.headers.Authorization` quando não há (evita enviar "Bearer " vazio). O **interceptor de response** (`main.js:26-39`) trata **401 ou 403**: se a rota atual não for `/login`, chama `logout()` e `router.push('/login')`. O bootstrap (`main.js:41-43`) é `createApp(App).use(router).mount('#app')`.

`api.js:1-2` define `export const API_BASE_URL = ''` (caminhos relativos `/api/...`, assumindo mesmo host/proxy do backend).

> **Atenção:** o interceptor trata 401 e 403 de forma idêntica com logout total — um 403 legítimo de autorização desloga o auditor indevidamente. E `ProfileView.vue` **não** usa `API_BASE_URL`: usa `import.meta.env.VITE_API_URL || 'http://localhost:3000'` e passa `Authorization` manualmente, divergindo do padrão relativo (pode apontar para `localhost:3000` em produção se `VITE_API_URL` não estiver setado).

#### Telas de sessão — Login e Perfil

**LoginView** (`LoginView.vue:19-43`, template `46-110`): tela combinada login/cadastro (toggle `isLogin`). `handleSubmit` faz `POST /api/auth/${endpoint}` (`login` ou `register`). Em login: `setAuth(response.data.token, response.data.user)` + `router.push('/')`. Não há recuperação de senha nem validação de força. Endpoints: `POST /api/auth/login`, `POST /api/auth/register`.

**ProfileView** (`ProfileView.vue:28-58`, template `61-217`): edita o perfil. Valida `senha === confirmarSenha` no front e faz `PUT /api/auth/profile` com `{nome, email, senha: senha||undefined}`. O badge **"Administrador do Sistema"** é hardcoded (não reflete o role real), e o botão "Alterar Foto" é decorativo. Endpoint: `PUT /api/auth/profile`.

---

### 6.2. Tela "Gestor de Clientes" (Home) — `HomeView.vue`

Rota `/`. Lista as empresas (clientes) derivadas do registro **0000** dos SPEDs processados.

- **`carregarEmpresas`** (`HomeView.vue:34-54`): `onMounted` chama `GET /api/empresas`. Usa um `safetyTimer` de 15s que força `loading=false` (defesa contra spinner travado) e ignora 401/403 (tratados pelo interceptor global).
- **`empresasFiltradas`** (computed, `56-64`): filtro reativo por `nome_empresa`, `nome_fantasia` ou `cnpj` (substring; CNPJ por dígitos crus).
- **`selecionarEmpresa`** (`66-69`): `setEmpresaSelecionada(empresa)` + `router.push('/dashboard/${empresa.id}')`. Define o cliente ativo que habilita o menu lateral.
- **`confirmDelete` / `deletarEmpresa`** (`73-98`): `DELETE /api/empresas/:id?cascade=true` — exclusão **em cascata** que apaga todos os SPEDs, XMLs e NFs vinculados (irreversível).
- **`criarEmpresa`** (`100-120`): normaliza CNPJ (remove não-dígitos) e UF (uppercase) e faz `POST /api/empresas`.
- Template (`123-381`): busca, botões "Nova Empresa" e "Processar Novo SPED" (`router.push('/analisador')`), tabela responsiva de clientes, modais de criação/exclusão e toast.

**Endpoints:** `GET /api/empresas`, `POST /api/empresas`, `DELETE /api/empresas/:id?cascade=true`.

> **Atenção:** `selecionarEmpresa` **não reseta** `arquivoInfo`/`idArquivoSped` — ao trocar de empresa, o SPED em memória da anterior permanece, deixando LMC/Posição de Estoque apontando para um `id_sped` possivelmente de outra empresa. Excluir a empresa ativa também não limpa o contexto (contexto órfão). O cadastro não valida dígito verificador de CNPJ nem UF válida.

---

### 6.3. Hub de Operações por Cliente — `DashboardHubView.vue`

Rota `/dashboard/:id`. Guard no setup (`DashboardHubView.vue:1-65`): se `!empresaSelecionada.value`, `router.push('/')` — o `:id` da rota **não é lido**, confia-se exclusivamente no store. Monta um array de cards de módulos:

1. **Injetor de XMLs** (`/injetor-xml`, sempre ativo, tag Operacional);
2. **Livro LMC** (`/lmc/:arquivoInfo.id`, ativo **só com `arquivoInfo`**, senão route `#` e warning "Requer SPED carregado");
3. **Auditoria Avançada** (`/analisador`, tag Análise);
4. **Gestão de SPEDs** (`/empresa/:empresaSelecionada.id`).

`navigateTo(modulo)` só navega se `active` e `route != '#'`. O template (`67-142`) renderiza breadcrumb (Clientes > nome_empresa), título "Hub de Operações" com CNPJ, e grid de cards (inativos em `opacity-60 cursor-not-allowed`).

> **Atenção (divergência de navegação):** o Hub mostra apenas **4 módulos**, enquanto o menu lateral tem ~11. Injetor CT-e, De-Para, CFOP, MDe, Impressão LMC e Posição de Estoque só são acessíveis pela sidebar.

---

### 6.4. Tela Analisador (Motor de Auditoria) — `AnalisadorView.vue`

Rotas `/analisador` e `/analisador/:id`. É a **tela central de auditoria** do SPED Fiscal: recebe o upload do TXT (EFD ICMS/IPI), dispara o motor no backend e apresenta os resultados em **7 abas** — Upload, Dashboard gerencial, Auditoria LMC, Alertas, Malha Fina, Notas e Saídas NF. Também concentra todas as correções manuais e exportações.

#### Upload e leitura local do cabeçalho

- **`parseSpedHeader` / `verificarSequenciaPeriodo`** (`AnalisadorView.vue:744-819`): leem localmente os primeiros 2000 bytes do arquivo em `latin1`, fazem `split('|')` da 1ª linha (registro **0000**) e extraem `DT_INI` (`parts[3]`, formato DDMMYYYY) e CNPJ (`parts[7]`). Buscam a empresa (`GET /api/empresas?busca=`) e seus arquivos (`GET /api/arquivos/:empresaId`), localizam o último período e verificam se o novo arquivo é o mês imediatamente seguinte; se não for, disparam modal de confirmação (importar fora de ordem quebra a continuidade do LMC e os encerrantes).
- **`handleSpedFile` / `executarUpload`** (`822-928`): `executarUpload` conecta o SSE de logs, faz `POST /api/upload` (multipart) com `onUploadProgress`. Trata **HTTP 409** (duplicata): se a mensagem inclui "REPARADO" usa o `arquivo_id` reparado; senão pergunta se quer sobrescrever (`?overwrite=true`, avisando que apaga ajustes de LMC). Se `response.avisos_lmc.tem_lacuna`, abre o modal de LMC incompleto.
- **`connectToLogStream`** (`40-66`): abre um `EventSource` (SSE) para `GET /api/logs/stream`, empurra mensagens para `terminalLogs` (console live) com auto-scroll.

#### Disparo da auditoria

**`runAnalysis`** (`930-965`): `POST /api/analisar/:id` (executa o motor) e depois `Promise.all` de três GETs — `GET /api/erros/:id` (infrações de regra), `GET /api/resumo/:id` (resumo gerencial: total_saidas, total_entradas, resumoCombustiveis, saidasPorCFOP, estoqueResumo) e `GET /api/estoque-resumo/:id` (com `.catch → []`). Grava em `auditErros`, `auditResumoGerencial`, `auditResumoEstoque`. `shouldRedirect` controla se troca para a aba dashboard (false em recálculos após edição).

**`onMounted`** (`635-670`): roteamento por id histórico (`/analisador/:id`) — reconstrói o estado global (`setIdArquivoSped`, `setArquivoInfo`, `setEmpresaSelecionada`) a partir de `GET /api/arquivo/info/:id` e dispara `runAnalysis()`; usa cache se o arquivo já estiver no store com `auditResumoGerencial`.

#### Aba Alertas e estimativas

- **`errosPorTipo` / `availableErrorGroups` / `filteredAuditErros`** (`967-995`): agrupam erros pelas sub-abas. O **registro SPED** é extraído de `regra_id` via `split('-')[1]` (ex.: `CRIT-1310-01` → grupo `1310`; `RTAX-C170-01` → `C170`). Convenção de `regra_id`: `PREFIXO-REGISTRO-NN`.
- **`economiaEstimada`** (`997-1010`): estima ICMS-ST em duplicidade filtrando a regra `RTAX-C170-01`, extraindo `Valor: R$ X` por regex e multiplicando por 0,18.

#### Aba Malha Fina (sintaxe estrutural)

**`runSyntaxAnalysis`** (`274-290`): `POST /api/arquivos/analisar-sintaxe`. Popula 7 categorias de infrações estruturais (template `1122-1275`): `c100_valores_divergentes` (capa C100 vs soma C190), `c100_sem_c190`, `c100_saltos_enumeracao` (omissão de notas por salto de `num_doc`), `h010_divergente_1300` (inventário Bloco H010 vs estoque LMC 1300), `cfop_suspeitos` (vícios NCM/CEST/CFOP), `bicos_duplicados_1320` (mesmo bico em dois tanques no 1320) e `chv_nfe_cnpj_divergente` (CNPJ da chave NF-e/NFC-e ≠ CNPJ do informante no 0000).

#### Aba Notas e Saídas

- **`loadNotasAnaliticas`** (`186-200`): `GET /api/documentos/auditoria/nf/:id` — NF de **entrada** com conciliação tríplice C100 (capa) ↔ C190 (analítico por CST/CFOP/alíquota) ↔ C170 (itens).
- **`loadSaidasMod55` / `loadSaidasMod65`** (`233-262`): `GET /api/documentos/auditoria/saidas/:id?modelo=55|65`. Modelo 55 = NF-e nota a nota; modelo 65 = NFC-e **agrupada** por CFOP+CST. Guard de cache só busca se o array estiver vazio.
- **`openNfEdit` / `saveNfEdit`** (`119-161`): edição de valores fiscais de NF de saída. `saveNfEdit` faz **dois POSTs sequenciais** para `POST /api/corrigir-item`: um para o C100 (`vl_doc_ajustado`) e outro para o C190 (`vl_opr`/`vl_bc_icms`/`vl_icms` ajustados) — padrão de coluna-sombra `_ajustado`.

#### Aba Auditoria LMC

- **`loadLmcDetailed`** (`293-315`): `Promise.all` de `GET /api/lmc/:id` (movimentação diária) + `GET /api/lmc/tanques-config/:cnpj` (capacidades), depois `checkContinuidade()`.
- **`filteredLmc`** (computed, `319-332`): mantém **apenas combustíveis** cujo nome contém uma palavra de `COMBUSTIVEIS_LMC` (GASOLINA/ETANOL/ÁLCOOL/DIESEL/GNV/GLP/QUEROSENE/BIODIESEL), excluindo aditivos/lubrificantes; aplica filtros de busca, data e `onlyErrors`.
- **`lmcKpis`** (computed, `344-417`): núcleo analítico. Calcula por combustível: `estoqueInicial`, `totalEntradas`, `totalSaidas` e a **quebra líquida mensal**. Busca o **último fechamento físico não-zero** do mês para evitar falsas quebras de 100%, e calcula `variacaoMensalPerc = |quebraLiquida|/totalSaidas*100` (regra ANP: até **0,6%** do volume vendido).
- **`openLmcConfig` / `saveLmcConfig`** (`419-478`): modal de capacidade de tanques. Lista só produtos com `has_lmc_row===true` (registro real no 1300) e busca sugestões dos registros **1310** via `GET /api/lmc/tanques-sugeridos/:id`; grava em `POST /api/lmc/tanques-config`.
- **`openOtimizador` / `startOtimizacao`** (`480-512`): `POST /api/lmc/otimizador-matematico` com `{id_arquivo, cod_item, volume_alvo}` — reconstrói medições para atingir um volume-alvo aplicando "ruído orgânico" dentro da variação legal (o modal cita 0,55%).
- **`toggleEditSaida` / `saveEditSaida`** (`522-552`): edição de saída diária "em cascata" via `POST /api/lmc/ajustar-cascata` (alterar a venda de um dia recalcula o estoque/fechamento dos dias subsequentes).
- **`checkContinuidade` / `sincronizarEstoque` / `sincronizarTodos`** (`558-595`): `GET /api/lmc/continuidade/:id` retorna `{tem_mes_anterior, divergencias[]}`; sincronização sobrescreve a abertura atual com o fechamento físico do mês anterior via `POST /api/lmc/update-estoque-inicial`.
- **`saveInitialStock`** (`597-630`): edição do estoque inicial via `POST /api/lmc/update-estoque-inicial`, recalculando toda a cascata.
- Template da tabela diária (`1750-1998`): accordion por combustível com KPIs inline e colunas Data, Capacidade, Est.Inicial, Entradas, Saídas (editável), Escritural, Físico, Diferença(L), Var%, Excesso e **Status ANP** com 4 estados: CONFORME, FORA LIMITE (>0,6%), EXCESSO (estoque > capacidade) e NEGATIVO.

#### Correções de CST e exportações

- **`applyBulkCorrection` / `applyCorrection`** (`698-737`): `POST /api/corrigir-massa` (regra `RTAX-C170-01` forçando `cst_icms='060'` — ICMS-ST cobrado anteriormente) e `POST /api/corrigir-item` (tipo C170, CST manual).
- **`downloadDossie` / `downloadSpedRetificado` / `downloadExcel`** (`673-696`): via `window.open` com **token na querystring** — `GET /api/relatorio/dossie/:id`, `GET /api/exportar-sped/:id` (TXT EFD corrigido), `GET /api/relatorio/excel/:id`.

> **Atenção:** (1) bug de cache nas saídas — `saveNfEdit` zera apenas `saidasMod65`, então editar uma NF-e modelo 55 não atualiza a tela; (2) `saveNfEdit` não tem transação entre C100 e C190; (3) `applyCorrection` não envia header de auth; (4) o **otimizador matemático** efetivamente reescreve vendas/encerrantes para mascarar quebras (risco fiscal/legal), e o modal cita 0,55% enquanto a regra ANP é 0,6%; (5) token JWT exposto na URL das exportações.

---

### 6.5. Livro LMC — `LmcView.vue`

Rota `/lmc/:id`. Tela central do LMC diário por combustível, reconstruído do SPED (blocos 1300/1310/1320 + NF-e C100). Opera com **dois motores de cálculo paralelos**.

- **`onMounted`** (`LmcView.vue:26-51`): resolve o id via `route.params.id` ou `arquivoInfo`; restaura o contexto via `GET /api/arquivo/info/:id` quando o store diverge; chama `loadData` e `carregarPeriodos`.
- **`loadData`** (`148-193`): usa `AbortController` para cancelar requests anteriores ao navegar entre meses; `GET /api/lmc/:id` (timeout 60s). Parseia `nfs_detalhadas` (NF-e C100, string JSON ou array) e inicializa `edit_value = vol_saidas_ajustado ?? vol_saidas` e `fisico_edit_value = fech_fisico_ajustado ?? fech_fisico` (a UI sempre parte do valor ajustado se existir).
- **`combustiveis`** (computed, `198-216`): filtra por `COMBUSTIVEIS_KEYWORDS` **e** exige ao menos uma linha real no 1300 (`has_lmc_row=true`) — impede que aditivos com "GASOLINA"/"DIESEL" no nome apareçam como combustível sujeito a LMC/ANP.

#### Motor 1 (Raio-X) e Motor 2 (Laboratório) — `recalcularTudo` (`220-347`)

Núcleo de cálculo. Itera por `cod_item`, ordena por `data_movimento` e processa cada dia (async via `setTimeout 0` para não travar a UI). Linhas fantasmas (`has_lmc_row===false`: NF-e C100 sem 1310/1320 correspondente) recebem objetos zerados e **não entram na cascata**.

- **Motor 1 — Raio-X** (espelho do SPED original): `escrRaioX = estq_abert + entradas - saidaSped`; `difTeoricaRaioX = fech_fisico - escrRaioX`; `percentual = |dif|/fisico*100`; `ultrapassou_limite` quando `fisico>0` e `percentual >= 0,61`; `is_negativo` se escritural ou físico `< -0,01`.
- **Motor 2 — Laboratório** (cascata dinâmica de camuflagem): `aberturaLab` = `estq_abert_ajustado` do banco (âncora pós-Otimizar/Redistribuir), senão `runningAberturaLab` (propaga edição manual), senão `estq_abert`. Quando há edição (`cascadeModified`), recalcula o físico escalando perda/ganho por um fator, com **CAPs derivados algebricamente** para garantir `|dif|/fisico <= 0,60%` (`capPerda = escrLab*0,006/1,006`; `capGanho = escrLab*0,006/0,994`). O fechamento de um dia vira a abertura do seguinte (`runningAberturaLab = fisicoLab`).

#### Edições, otimização e continuidade

| Função | Linhas | Endpoint | O que faz |
|--------|--------|----------|-----------|
| `salvarAjuste` | 462-486 | `POST /api/lmc/ajustar-lote` | ajuste avulso de uma linha (grava `null` se igual ao original) |
| `salvarSaidaComCascata` | 489-523 | `POST /api/lmc/ajustar-cascata` | salva saída e propaga cascata; recarga silenciosa |
| `corrigirDistribuicao` | 373-387 | `POST /api/lmc/corrigir-distribuicao` | realinha cascata mantendo teto ANP |
| `rodarAutoOtimizador` | 389-409 | `POST /api/lmc/otimizador-matematico` (`auto:true`) | distribui automaticamente; força `viewMode='lab'` |
| `rodarOtimizador` | 411-438 | `POST /api/lmc/otimizador-matematico` (`volume_alvo`) | otimiza para volume meta; alerta `estouro_tanque` |
| `abrirPreviewSincronizacao` | 78-103 | `POST /api/lmc/preview-sincronizacao` | simula alinhar abertura ao fechamento do mês anterior e redistribui |
| `confirmarSincronizacao` | 105-125 | `POST /api/lmc/confirmar-sincronizacao` | persiste a redistribuição |
| `salvarLoteRateio` / `confirmarGravar` | 562-597 | `POST /api/lmc/ajustar-lote` | consolida todos os dias do combustível |
| `exportarSped` | 648-703 | `GET /api/exportar-sped/:id` (blob, Bearer) | TXT EFD retificado com 1300/1310/1320 ajustados |

- **`totais`** (computed, `440-453`): agrega compras, NF-e (`volume_nota`), vendas declaradas (original) vs vendas ajustadas (lab), perdas/ganhos e `variacaoLiquida = perdas - ganhos`.
- **`distribuicaoInconsistente`** (computed, `360-369`): só no modo Laboratório; sinaliza divergência > 1L entre a abertura salva (`estq_abert_ajustado`) e a calculada pela cascata (aciona o banner que chama `corrigirDistribuicao`).
- **`carregarPeriodos` / `navPeriodo`** (`608-632`): `GET /api/arquivos/:idEmpresa`, monta labels Mês/Ano de `periodo_apuracao` (formato `YYYY-MM`) e navega com `router.push('/lmc/:id')`.

O template (`706-1362`) traz a barra "Distribuição Inteligente" (AUTO, Meta Volume + OTIMIZAR 1300, GRAVAR, EXPORTAR SPED), cards de totais, banner de continuidade, abas de combustível com toggle **Raio-X/Laboratório**, tabela progressiva por dia com inputs editáveis de Saídas/Físico, master-detail "Composição Tributária de Entrada (NF-e C100)" e modal Teleport de prévia de sincronização.

> **Atenção:** a definição de **% ANP diverge entre telas** — `LmcView` usa `|dif|/fech_fisico` (denominador = físico do dia) enquanto a `ImpressaoLmcView` usa `|perdas-ganhos|/saidas`. O limite é codificado como `>= 0,61` mas os CAPs usam `0,006` (0,60%). O match por `cod_item+data` (`salvarSaidaComCascata`) assume 1 linha por combustível/dia (com bicos compartilhados pega só a primeira). `aplicarRateioInteligente` (`526-559`) parece código órfão (usa `metaVendas`, não usado nos controles visíveis).

---

### 6.6. Impressão LMC — `ImpressaoLmcView.vue`

Rota `/impressao-lmc`. Monta filtros e um resumo por combustível (layout 2 colunas) e dispara a geração do PDF do LMC (modelo idêntico ao AutoSystem PRO).

- **`onMounted`** (`ImpressaoLmcView.vue:23-41`): `GET /api/empresas`, pré-seleciona empresa/arquivo do contexto da store e encadeia `carregarArquivos → carregarCombustiveis`.
- **`carregarArquivos`** (`43-52`): `GET /api/arquivos/:empresa`, ordenado por `periodo_apuracao`.
- **`carregarCombustiveis`** (`54-89`): `GET /api/lmc/:arquivo`, extrai combustíveis únicos filtrando por termos no nome e define `dataInicio`/`dataFim` de `periodo_apuracao` (split por `' a '`, formato `DD/MM/YYYY a DD/MM/YYYY`). **Não exige `has_lmc_row`** (diferente do LmcView).
- **`carregarResumo`** (`93-132`): reconstrói o resumo por combustível somando `entradas`, `saidas`, `perdas`, `ganhos` e contando dias; `aberturaInicial` = primeiro `estq_abert_final ?? estq_abert`; `fechamentoFinal` = último `fech_fisico_final ?? fech_fisico`.
- **`salvarObservacao`** (`134-156`): grava o **Campo 13 (Observações)** iterando **dia a dia** (`POST /api/lmc/observacoes` por dia) para o `cod_item` escolhido (ou o primeiro se "todos").
- **`gerarPDF`** (`158-177`): monta querystring (`combustivel`, `data_inicio`, `data_fim`, `folha_inicial>1`) e a URL `GET /api/lmc/imprimir/:id` com **token na query**. Abre `window.open('about:blank')` **antes** de qualquer `await` (anti-popup-blocker), salva a observação e navega a janela já aberta.

O template (`180-349`) usa grid de 5 colunas: à esquerda (2/5) os filtros (empresa, período, combustível, datas, nº folha, observação) e o botão Gerar PDF; à direita (3/5) os cards de resumo por combustível com badge **% ANP** (`|perdas-ganhos|/saidas*100`, verde ≤0,6% / vermelho >0,6%), grid Est.Inicial/Entradas/Saídas/Est.Final, segunda linha Perdas/Ganhos/Variação/Dias, e barra dark com totais gerais.

> **Atenção:** faz `GET /api/lmc/:id` **duas vezes** (carregarCombustiveis e carregarResumo). O resumo soma perdas/ganhos dos campos **originais** mas abertura/saídas/fechamento dos campos `*_final` (possível inconsistência com o PDF). O badge % ANP usa denominador diferente do `LmcView`. `salvarObservacao` faz ~30 POSTs sequenciais e pode gerar datas off-by-one por fuso.

> **Nota — StockAnalysis (`StockAnalysis.vue`):** componente "Análise Forense de Estoque" por tanque/bico que é apenas um **esqueleto/placeholder** — `data = ref([])` nunca é populado por nenhuma API, então a tela sempre exibe "Nenhum dado selecionado ou disponível".

---

### 6.7. Injetor de XMLs (NF-e) — `InjetorXmlView.vue`

Rota `/injetor-xml`. Faz upload de XMLs de NF-e de entrada, aplica regras de De-Para e injeta as notas retroativamente nos registros **C100/C170/C190** de um SPED já importado (ou gera um SPED standalone). Alimenta o LMC como efeito colateral (entradas de combustível por NCM/data → campo 4.1/4.2).

- **`loadCfops`** (`InjetorXmlView.vue:45-61`): `GET /api/cfops` com fallback hardcoded de 4 CFOPs de entrada — **1102** (revenda, gera crédito), **1556** (uso/consumo, sem crédito), **1652** (combustível ST, contribuinte substituído) e **1551** (imobilizado).
- **Modo Grupos** (`criarGrupo`/`toggleModoGrupos`/`handleGrupoFiles`, `76-106`): segmenta lotes de XML com parâmetros fiscais distintos por grupo (CFOP, `forcarUsoConsumo`, `ajusteIpi`, `ajusteIcms`, `pularDuplicados`, `forceReplace`). **`ejetarTodosGrupos`** (`108-198`): monta um único FormData com `grupo_${i}_xmlFiles` + JSON `grupos_config` e faz `POST /api/injetar-grupos`. Trata `cnpj_invalido`, `periodo_divergente` (modal) e erros por grupo.
- **`parseXmls(forceReplace)`** (`303-391`): fluxo simples (não-grupos). FormData com `cfop_padrao`, `forcar_uso_consumo`, `ajuste_ipi`, `ajuste_icms`, `pular_duplicados`, `item_mapping` (JSON do De-Para) e `id_sped_arquivo` → `POST /api/xml-injector/parse`. Trata **HTTP 409** (duplicadas, lista `num_doc`+`chv_nfe` 44 dígitos e oferece substituir via recursão), `cnpj_divergente` e `periodo_divergente`.
- **`simularInjecao`** (`393-437`): mesmo endpoint com `analyzeOnly='true'` (sandbox em memória) → alimenta o componente `SpedPreview`.
- **`standaloneExport`** (`445-485`): `POST /api/xml-injector/standalone` (blob) — gera um SPED novo só com os XMLs.
- **`analyzeItems`** (`487-537`): `POST /api/xml-injector/analyze-items` → mapeia o response para o modelo do front (`cfop_alvo ← cfop_atual`, `cst_alvo ← cst_atual||'000'`, `cod_interno ← cod_item_sugerido`), com `cst_pis`/`cst_cofins` default **'07'** (operação isenta, típico da tributação monofásica de combustível). Abre o modal de De-Para.
- **`saveBatchDePara`** (`539-577`): `POST /api/xml-injector/save-de-para-batch` — persiste as regras por CNPJ emissor + código de produto.
- **`exibirLogLmc`** (`201-217`): renderiza o efeito sobre o LMC (`lmc_atualizados`): `atualizado` (entradas inseridas), `ncm_sem_mapeamento` (combustível sem mapeamento) e `data_nao_encontrada`.
- **`confirmarForcePeriodo`** (`226-262`): reenvia o FormData pendente com `force_periodo='true'`.

O modal De-Para (template `968-1122`) é uma tabela editável por item: Código/Descrição, NCM, Cód. Interno (botão "Sugerido"), CFOP Alvo (select), CST ICMS, Alíquota % ICMS, BC ICMS override, CST PIS/COFINS e Conta Contábil, com botões "Salvar de-para no Banco" e "Utilizar nesta Injeção".

**Endpoints:** `POST /api/xml-injector/parse`, `/analyze-items`, `/save-de-para-batch`, `/standalone`, `POST /api/injetar-grupos`, `GET /api/cfops`, `GET /api/exportar-sped/:id`.

---

### 6.8. Injetor CT-e — `InjetorCteView.vue`

Rota `/injetor-cte`. Faz upload de XMLs de **CT-e** (frete) e os injeta no **Bloco D** (D100/D190) de um SPED importado.

- **`analisar`** (`InjetorCteView.vue:56-81`): `POST /api/cte-injector/analyze` (multipart) → `res.data.ctes` + relatório `{totalCtes, totalPulados, totalFrete}`. `fase='analisado'`.
- **`injetar` / `_executarInjecao`** (`96-147`): exige `idSpedBase`, FormData (`xmlFiles`, `id_arquivo`, `pularDuplicados`) → `POST /api/cte-injector/inject` com `responseType='blob'` (o backend devolve o SPED inteiro já com o Bloco D para download). Trata erro vindo como Blob via `JSON.parse(await data.text())` para extrair `cnpj_invalido` ou `periodo_divergente`. `fase='injetado'`.
- **`confirmarForcePeriodo`** (`88-94`): reenvia `_pendingFdCte` com `force_periodo='true'`.

A tabela de CT-es (template `274-305`) exibe Número, Emitente (transportadora), Data, CFOP (tipicamente 1352/1353/2352), Frete, ICMS e CST — refletindo D100/D190.

**Endpoints:** `POST /api/cte-injector/analyze`, `POST /api/cte-injector/inject`.

---

### 6.9. De-Para (XML) — `DeParaXmlView.vue`

Rota `/de-para`. CRUD persistente das regras de De-Para por empresa (as mesmas que o modal do Injetor grava em lote).

- **`loadRules` / `saveRule` / `confirmDelete`** (`DeParaXmlView.vue:64-139`): `GET /api/de-para?id_empresa=`, `POST /api/de-para` (upsert por `id_empresa+cnpj_emissor+cod_produto_xml`), `DELETE /api/de-para/:id`. Campos: `cnpj_emissor`, `cod_produto_xml`, `descricao_produto`, `novo_cfop`, `novo_cst` (ICMS, ex.: 060 = ICMS-ST), `aliq_icms`, `bc_icms_override`, `cst_pis`, `cst_cofins`.
- **`filteredRules`** (computed, `46-54`): filtro client-side por `cnpj_emissor`, `cod_produto_xml` e `descricao_produto`.

**Endpoints:** `GET /api/de-para`, `POST /api/de-para`, `DELETE /api/de-para/:id`.

> **Atenção (segurança):** as rotas `/api/de-para` (GET/POST/DELETE) **não usam authMiddleware** no backend (`server.js:7906/7932/7979`) — qualquer requisição sem token lê/escreve/apaga regras de qualquer `id_empresa` (IDOR). Além disso, o `POST /api/de-para` executa `ALTER TABLE ADD COLUMN IF NOT EXISTS` em **toda** chamada de gravação (DDL em caminho quente).

---

### 6.10. XML Tributação (wizard) — `XmlTributacaoView.vue`

Rota `/xml-tributacao/:id?` (**órfã**: não está no menu lateral nem no hub). Wizard "Analista Premium AI" de 4 passos (Upload → Mapeamento → Config Custo → Resultado).

- **`analyzeFiles` / `startInjection` / `saveRuleLocal` / `dowloadSpedFragment`** (`XmlTributacaoView.vue:149-246`): chamam `POST /api/inject-xml-v2` (analyzeOnly e injeção real); `saveRuleLocal` faz `POST /api/de-para`; `dowloadSpedFragment` concatena `results.bloco0 + results.blocoC`.
- **`addCfop` / `removeCfop` / `fetchCfops`** (`96-130`): gestão de CFOPs via `GET/POST /api/cfops` e `DELETE /api/cfops/:id`, alimentando um `<datalist>` de autocomplete.

> **Atenção (crítico):** o endpoint `POST /api/inject-xml-v2` **não existe no backend** (confirmado por grep em `backend/server.js` e `backend/`). A view inteira está **quebrada/órfã** — `analyzeFiles` e `startInjection` sempre caem no catch genérico. É código morto que aparenta ser um fluxo válido na navegação.

---

### 6.11. Manifesto / MD-e — `MdeView.vue`

Rota `/mde`. Captura, manifestação e download de NF-e emitidas contra o CNPJ da empresa (SEFAZ/EspiãoNFe), além de conferência das chaves contra um arquivo SPED.

- **Setup** (`MdeView.vue:1-59`, `284-299`): refs de `notas`, `filterStatus`, `searchQuery`, `certStatus` (certificado A1), `pfxFile`/`pfxSenha`/`pfxUltimoNsu`/`pfxPeriodicidade`, datas do Espião, `selectedNotas`, `conferenciaResult`. `onMounted` redireciona a `/` sem empresa; senão chama `fetchNotas()` + `checkCertStatus()` e inicializa datas nos últimos 30 dias.
- **`syncNotas` / `syncEspiao`** (`326-341`, `61-85`): `GET /api/mde/sync/:id_empresa` (consulta SEFAZ a partir do último NSU, via certificado A1) e `GET /api/espiao/sync/:id?inicio&fim` (captura retroativa via EspiãoNFe). A SEFAZ entrega ~90 dias e exige consumo incremental do NSU; o Espião recupera períodos antigos.
- **`importarPorChave`** (`87-112`): `POST /api/mde/importar-chave` (textarea com chaves de 44 dígitos; split no backend).
- **`manifestar`** (`343-370`): `POST /api/mde/manifestar` com `{id_empresa, chave_nfe, evento}`. Mapeia os 4 eventos: **Ciência (210210)**, **Confirmação (210200)**, **Desconhecimento (210220)**, **Operação não Realizada (210240)**. O fluxo exige primeiro Ciência; notas de Saída (emitidas pelo próprio contribuinte) não podem ser manifestadas (badge EMITIDA).
- **`onSpedFileSelected`** (`172-221`): lê um SPED local via `FileReader`, extrai chaves com regex `/[0-9]{44}/` e faz `POST /api/espiao/conferir-sped` → `{total_arquivo, encontradas, faltantes, todas_faltantes}` (cobertura: quais chaves do SPED ainda não têm XML no banco).
- **`baixarFaltantesSped`** (`223-242`): `POST /api/espiao/importar-lote` (chaves faltantes).
- **`downloadZip` / `downloadSingleXml` / `viewXml`** (`114-143`, `252-282`): `POST /api/espiao/download-zip` (blob), `GET /api/espiao/download-xml/:id/:chave` (blob), `GET /api/mde/xml/:chave`. O download de XML só aparece quando o status é Confirmação/Ciência e há `xml_content` (a SEFAZ só libera o XML completo após manifestação).
- **`deleteSelectedNotas`** (`145-170`): `POST /api/mde/delete-notas`.
- **`checkCertStatus` / `saveCertificado` / `fileToBase64`** (`408-466`, `428-433`): `GET /api/mde/certificado/:id` e `POST /api/mde/certificado` com o `.pfx` (A1, PKCS#12) convertido em base64, senha, NSU inicial e periodicidade do scheduler.
- **`filteredNotas` / `getStatusColor`** (`372-406`): filtro por `searchQuery` e `filterStatus` ("pendente" agrupa ausência de status / "Identificada" / "Sem manifestação").

**Endpoints:** `GET /api/mde/sync/:id`, `GET /api/mde/notas/:id`, `POST /api/mde/importar-chave`, `POST /api/mde/manifestar`, `GET /api/mde/xml/:chave`, `GET/POST /api/mde/certificado`, `POST /api/mde/delete-notas`, `GET /api/espiao/sync/:id`, `POST /api/espiao/conferir-sped`, `POST /api/espiao/importar-lote`, `POST /api/espiao/download-zip`, `GET /api/espiao/download-xml/:id/:chave`.

> **Atenção (bugs concretos):** vários ícones lucide usados no template **não são importados** no script (ShieldCheck, AlertCircle, Filter, Zap, Calendar, Clock, CheckCircle2, XCircle, X, ChevronLeft/Right) — aparecem vazios. A ref `isConferenciaModalOpen` é referenciada (`200`, `237`, template `947`/`959`) mas **nunca declarada** com `ref()` — o modal de conferência nunca abre corretamente. A regex `/[0-9]{44}/` (sem flag `g`) pega só a 1ª chave por linha e aceita qualquer sequência de 44 dígitos (pode capturar chaves de CT-e/MDF-e/NFC-e como NF-e).

---

### 6.12. Explorador de SPEDs — `ExploradorView.vue`

Rota `/empresa/:id`. Histórico dos arquivos SPED importados por empresa, agrupado por ano/período.

- **`onMounted`** (`ExploradorView.vue:38-74`): `Promise.all` de `GET /api/empresas` + `GET /api/arquivos/:empresaId`. Ordena por `periodo_apuracao` decrescente (`toNum` extrai `ano*100+mês` de strings `YYYY-MM-DD`), expande o ano mais recente e usa `safetyTimer` de 15s.
- **`getAno` / `formatPeriodo` / `formatData`** (`23-36`): formatação (período `YYYY-MM-DD` → `MM/YYYY`; também trata `MMYYYY`).
- **Computeds** (`76-101`): `anosDisponiveis` (Set ordenado desc), `arquivosFiltrados` (busca por nome/período + filtro de ano), `arquivosPorAno` (agrupado por ano).
- **Exclusão** (`deletarArquivo` / `deletarVariosArquivos` / `confirmarDelete`, `109-150`): `DELETE /api/periodo/:id` (single) ou `POST /api/periodo/bulk-delete` (lote) — remove o SPED inteiro e seus dados derivados (irreversível).
- **`toggleSelecao` / `selecionarTudo` / `abrirAnalise` / `toggleAno`** (`103-162`): seleção múltipla e expansão de anos; `abrirAnalise` navega para `/analisador/:id`.

**Endpoints:** `GET /api/empresas`, `GET /api/arquivos/:empresaId`, `DELETE /api/periodo/:id`, `POST /api/periodo/bulk-delete`.

> **Nota:** o componente `ExploradorDeDocumentos.vue` (`9-33`, `GET /api/documentos/entradas/:id`) é a versão **legada/crua** (HTML+CSS sem Tailwind, sem header Authorization) que lista documentos de entrada (C100 `ind_oper='0'`) mas ignora os itens C170 agregados pelo backend — provável código duplicado em relação ao Explorador moderno.

---

### 6.13. Cadastro de CFOPs — `CfopView.vue`

Rota `/cfops`. CRUD do cadastro de CFOPs usados como de-para na injeção/geração de XMLs.

- **`loadCfops` / `iniciarNovo` / `iniciarEdicao` / `salvar` / `excluir`** (`CfopView.vue:33-100`): `GET /api/cfops`, `POST /api/cfops` (novo) ou `PUT /api/cfops/:id` (edição) com `{codigo, descricao, tipo}`, `DELETE /api/cfops/:id`. `tipo ∈ {entrada, saida, ambos}`. Valida apenas presença de `codigo`.
- **`filteredCfops` / `notify`** (`20-31`): filtro por código/descrição e toast (3.5s).

**Endpoints:** `GET/POST/PUT/DELETE /api/cfops`.

> **Atenção:** o input de código tem `maxlength=10` (CFOP real tem 4 dígitos), sem checagem de formato numérico nem coerência entre o prefixo (entrada 1/2/3, saída 5/6/7) e o campo `tipo`.

---

### 6.14. Rentabilidade / Posição de Estoque — `RentabilidadeView.vue`

Rota `/rentabilidade/:id`. Relatório que cruza entradas/saídas (C100/C170) com o estoque do LMC.

- **`loadRentabilidade`** (`RentabilidadeView.vue:14-27`): `GET /api/relatorio/rentabilidade/:id`. O backend cruza vendas (C170 com `C100.ind_oper='1'`), compras (`ind_oper='0'`), última venda/compra e estoque LMC, retornando por produto: `estoque_inicial`, `qtd_comprada`, `qtd_vendida` (`COALESCE(C170, LMC, 0)`), `estoque_final`, `custo_medio` (com flag `usou_historico_custo`) e `grupo` (COMBUSTÍVEIS / OUTROS).
- **`exportPDF`** (`29-50`): `GET /api/relatorio/rentabilidade/:id/pdf?grupo=<grupoAtivo>` (blob) → download `posicao_estoque_<grupo>_<id>.pdf`.
- **`filteredData` / `stats`** (`52-80`): filtro por grupo e busca; `formatNumber` em litros, com `estoque_final` negativo destacado em vermelho.

**Endpoints:** `GET /api/relatorio/rentabilidade/:id`, `GET /api/relatorio/rentabilidade/:id/pdf`.

> **Atenção:** `qtd_vendida` mistura fontes (C170 e LMC) via COALESCE — combustível vendido por NFC-e fora do C170 só aparece se vier do LMC. Os cards `stats` somam sobre `relatorio.value` (global), **não** sobre `filteredData`, então os totais ignoram o filtro ativo. `loadRentabilidade` não passa `Authorization` (depende do interceptor global), mas `exportPDF` passa — inconsistência no mesmo componente.

---

### 6.15. Preview de SPED — `SpedPreview.vue`

Componente (modal) usado pelo Injetor de XMLs para simular a geração de um SPED a partir de XMLs antes de efetivar.

- **Props / computeds** (`SpedPreview.vue:20-44`): recebe `data = {gerencial:{notas_processadas, estatisticas}, itensDetectados}`. `estatisticas` expõe `totalNotas`, `valorTotalGeral`, `totalLinhasBloco0` (cadastros: 0000, 0150, 0200) e `totalLinhasBlocoC` (C100/C170).
- **`saveMapping`** (`50-76`): `POST /api/de-para` com `{id_empresa, cnpj_emissor, cod_produto_xml, novo_cfop, novo_cst, descricao_produto, ncm}` — persiste o De-Para que será aplicado em gerações futuras; marca `item.isMapped=true`.
- **`toggleNota` / `copyToClipboard`** (`77-92`, template `174-199`): expande as `linhas_geradas` (registros SPED textuais) de uma nota num terminal escuro; aba De-Para com inputs editáveis de CFOP (maxlength 4) e CST (maxlength 3).

**Endpoints:** `POST /api/de-para`.

> **Atenção:** o `apiClient` é criado uma única vez no setup via `axios.create` capturando `token.value` no momento da carga — **não é reativo** a renovação de token (requests De-Para podem ir com token expirado após sessão longa). Além disso, `baseURL` é vazio (same-origin), divergindo do uso de `API_BASE_URL` nos demais componentes.

---

## Anexo: Mapa Condensado de Módulos

### B1 — Infra, Auth, CFOP & Setup DB — Stack, segurança, pool Postgres e esquema do banco

Esta é a camada de fundação do Audisped, um sistema de auditoria fiscal para postos de combustível que importa SPED Fiscal (EFD ICMS/IPI) e XML de NF-e, audita o LMC (Livro de Movimentação de Combustíveis) e reexporta SPED corrigido. O trecho cobre o bootstrap do servidor Express (imports, pool PostgreSQL, upload via multer, logging Winston, SSE de logs), a segurança/autenticação (JWT + bcrypt), o CRUD de cadastro de CFOPs (usado para classificar entradas/saídas no de-para de XML e na geração de C100/C190) e o script de criação/migração do esquema do banco (setup_db.js), que define as tabelas de usuários, configuração tributária, de-para de produtos/participantes, LMC, certificados A1, cache MD-e e persistência de encerrantes exportados para continuidade intermensal.

**Tabelas:** usuarios, cad_cfops, config_tributaria, mapeamento_produtos, mapeamento_participantes, lmc_movimentacao, lmc_tanques_config, de_para_xml, empresa_certificados, mde_cache, encerrantes_exportados, encerrantes_bicos_exportados, documentos_d100, documentos_itens_c170 (ALTER, não criada aqui), documentos_c100 (ALTER, não criada aqui), documentos_c190 (ALTER, não criada aqui), empresas (referenciada por FK, não criada aqui), sped_arquivos (referenciada por FK, não criada aqui)

**Registros SPED:** 0000, 0150, 0200, C100, C170, C190, D100, 1300, 1310, 1320, CTe (modelo 57)

### B2 — Rotas MDe & Espião NFe — Manifestação do Destinatário, consulta SEFAZ, importação de chaves, conferência contra SPED e certificado digital

Conjunto de rotas REST que implementa o módulo de Manifestação do Destinatário (MD-e) e o "Espião NF-e" do Audisped. Permite sincronizar o resumo de NF-e (modelo 55) de uma empresa junto à SEFAZ (via API terceira EspiãoNFe), manifestar eventos do destinatário (Ciência, Confirmação, Desconhecimento, Operação não Realizada), baixar/armazenar XMLs completos, importar notas por chave de acesso (avulsa ou em lote) e conferir quais chaves presentes no SPED Fiscal (registros C100) já possuem XML/registro no cache local. Também gerencia o certificado digital A1 (.pfx) por empresa, armazenando senha criptografada e NSU. É a base fiscal para auditoria de entradas (compras de combustível, CFOP 1.102/1.652/2.102 etc.) cruzando a escrituração SPED contra o que efetivamente existe na SEFAZ.

**Tabelas:** mde_cache (id, id_empresa, chave_nfe UNIQUE, nsu, cnpj_emissor, nome_emissor, valor, data_emissao, status_manifesto, tipo_operacao, xml_content, numero_nfe, serie, itens_json JSONB, criado_em) — leitura e escrita (UPSERT/UPDATE/DELETE), empresas (id, cnpj) — leitura para resolver CNPJ, empresa_certificados (id_empresa UNIQUE, pfx_base64, senha_encriptada, data_validade, ultimo_nsu_consultado, periodicidade_sincronizacao) — leitura/escrita do certificado A1

**Registros SPED:** C100 (documento fiscal NF-e modelo 55 — fonte das chaves CHV_NFE para conferência conferir-sped), C170 (itens do documento — alvo futuro do cruzamento com itens_json extraído do XML), C190 (analítico por CST/CFOP/alíquota — relacionado ao CFOP extraído dos itens), 0000 (abertura/identificação da empresa e CNPJ usados para casar com mde_cache.id_empresa)

### B3 — Services MDe, Espião NF-e e SEFAZ — integração de webservices, manifestação e cache de notas

Esta camada de services é responsável por toda a integração do Audisped com o mundo da SEFAZ/NF-e eletrônica: buscar o resumo das notas destinadas ao CNPJ do posto (Manifestação do Destinatário - MDe), registrar eventos de manifestação (Ciência/Confirmação/Desconhecimento/Operação não Realizada), baixar e armazenar os XMLs das NF-e modelo 55 e cruzar essas chaves com o que consta no SPED. Originalmente a integração era direta com a SEFAZ via certificado A1; hoje o mdeService é apenas uma fachada (adapter) que delega quase tudo para o espiaoNfeService, que consome a API comercial EspiãoNFe (provedor terceirizado de DFe). O sefazService restou como utilitário isolado de criptografia de senha de certificado e leitura de metadados do PFX. O objetivo fiscal central é garantir que o contribuinte tenha o XML de todas as notas de entrada (compras de combustível e mercadorias) para conferência contra o C100/C170 do SPED Fiscal e alimentar o LMC.

**Tabelas:** mde_cache (read/write: chave_nfe, nsu, cnpj_emissor, nome_emissor, valor, data_emissao, status_manifesto, tipo_operacao, xml_content, numero_nfe, serie, itens_json), empresa_certificados (read/write: pfx_base64, senha_encriptada, data_validade/validade_fim, ultimo_nsu_consultado, periodicidade_sincronizacao), empresas (read: id, cnpj)

**Registros SPED:** C100 (notas fiscais de entrada cujas chaves são cruzadas em conferirFaltantes), C170 (itens — NCM/CFOP/qCom/vProd extraídos do XML em parseAndSaveXmlData espelham os campos do C170), 0000 (CNPJ da empresa usado para consulta na SEFAZ/EspiãoNFe)

### B4 — B4 - Upload e Parsing do SPED Fiscal (.txt)

Esta parte recebe o arquivo SPED Fiscal (EFD ICMS/IPI) em formato .txt via upload HTTP multipart, faz o parsing linha a linha por registro (delimitado por pipe |), extrai os blocos 0 (cadastro/participantes/produtos), C (NF-e: C100/C170/C190), D (frete: D100) e 1 (LMC consolidado: 1300), e grava tudo em PostgreSQL dentro de uma transacao. Implementa logica multi-empresa (upsert por CNPJ) e sobrescrita/retificacao automatica de periodos ja existentes. O foco fiscal central e o registro 1300 (Movimentacao Diaria de Combustiveis - base do LMC) e os documentos C100/C170 (entradas e saidas de combustivel).

**Tabelas:** empresas, sped_arquivos, lmc_movimentacao, documentos_d100, sped_participantes, sped_produtos, documentos_c100, documentos_itens_c170, documentos_c190, erros_analise

**Registros SPED:** 0000, 0005, 0150, 0200, 1300, 1310, C100, C170, C190, D100

### B5 — Análise de Sintaxe SPED — POST /api/arquivos/analisar-sintaxe (Malha Fina Sintática)

Esta rota faz uma auditoria estática ("malha fina sintática") de um arquivo SPED EFD ICMS/IPI: lê o TXT linha a linha (latin1, pipe-delimited) com máquinas de estado sequenciais e gera um conjunto de infrações estruturais/de coerência sem gravar nada no banco. Foca em integridade entre capa C100 e seus filhos C190, sequência de numeração de notas, validade de NCM no cadastro 0200, coerência entre CFOP de devolução e CST, duplicação de bicos do LMC (1320) em tanques distintos no mesmo dia/produto, cruzamento do estoque físico final do LMC (1300) com o inventário do Bloco H (H010) e divergência do CNPJ embutido na chave de 44 dígitos da NF-e/NFC-e versus o CNPJ do informante (0000). É uma das poucas rotas puramente de leitura de texto, não usa o modelo já parseado no Postgres (exceto para localizar o caminho do arquivo).

**Tabelas:** sped_arquivos

**Registros SPED:** 0000, 0200, 1300, 1310, 1320, H010, C100, C190

### B6 — Rotas Injetor XML — análise de itens, de-para, agrupamento e geração de C100/C170/C190 a partir de NF-e

Conjunto de rotas REST que recebem XMLs de NF-e (modelo 55) e os transformam em registros SPED EFD ICMS/IPI (blocos 0 e C), permitindo: (a) analisar itens para configurar de-para de produto/CFOP/CST; (b) injetar fisicamente as notas dentro de um arquivo SPED existente (costura), recalculando assinaturas de bloco, E110 (apuração ICMS) e E210 (apuração ICMS ST); (c) injetar em grupos com múltiplos CFOPs numa só requisição; (d) gerar SPED standalone só com XMLs. Após a injeção física, atualiza as entradas de combustível no LMC (registro de movimentação) e sincroniza C100/C170 no banco para refletir no Analisador.

**Tabelas:** de_para_xml, empresas, sped_arquivos, sped_participantes, sped_produtos, documentos_c100, documentos_itens_c170, lmc_movimentacao

**Registros SPED:** 0000, 0005, 0100, 0150, 0175, 0190, 0200, 0205, 0206, 0210, 0220, 0990, C001, C100, C170, C190, C990, D001, D100, D190, D500, D590, D990, E110, E111, E210, E220, C500, C590, C600, C690, C790, C791, H005, 9900, 9990, 9999

### B7 — Service Injetor XML — Motor de transformação NF-e → registros SPED (Blocos 0 e C)

Este serviço é o "motor de tributação" do Injetor de XML: recebe NF-e já parseadas (JSON produzido por extractNfeData no server.js) e as converte em linhas de texto do SPED Fiscal (EFD ICMS/IPI), montando os registros do Bloco 0 (0000/0005/0100/0150/0190/0200) e do Bloco C (C100 cabeçalho, C170 itens, C190 analítico). Aplica regras de normalização de CST/CSOSN, mapeamento De-Para (CFOP/CST/conta contábil/NCM por produto+fornecedor), recálculo de bases e valores de ICMS/IPI/ST e ajustes de custo (incorporar IPI/ICMS ao valor do item, uso e consumo). É usado em fluxos de análise (analyzeOnly, para sugerir mapeamentos) e de injeção efetiva de notas de entrada (compras) num arquivo SPED existente.

**Tabelas:** de_para_xml (SELECT: cnpj_emissor, cod_produto_xml, novo_cfop, novo_cst, conta_contabil, descricao_produto, ncm, cod_interno, aliq_icms, bc_icms_override, cst_pis, cst_cofins), empresas (SELECT * WHERE id), sped_produtos (JOIN p/ sugerir cod_item), sped_arquivos (JOIN por id_empresa)

**Registros SPED:** 0000, 0005, 0100, 0150, 0190, 0200, C100, C170, C190

### B8 — Motor de Auditoria SPED — POST /api/analisar/:id e GET /api/erros/:id

Esta é a rota central de auditoria fiscal do Audisped. Ao receber o ID de um arquivo SPED carregado, executa 11+ regras de validação fiscal (continuidade de estoque LMC dia-a-dia e intermensal, capacidade de tanques, variação ANP 0,6%, estoque negativo, participante 0150 não cadastrado, confronto NF-e de entrada vs LMC, CST x CFOP em venda de combustível, quebra de sequência de numeração, notas de emissão própria, PIS/COFINS monofásico e crédito de ICMS sobre frete CT-e). Cada divergência vira um registro em erros_analise classificado como CRITICAL ou WARNING. A rota GET /api/erros/:id apenas devolve os erros previamente persistidos para exibição no frontend.

**Tabelas:** erros_analise, lmc_movimentacao, sped_arquivos, sped_produtos, sped_participantes, documentos_c100, documentos_itens_c170, documentos_d100, lmc_tanques_config, empresas

**Registros SPED:** 0000, 0150, C100, C170, D100, 1300, 1310

### B9 — Empresas, Arquivos, Documentos — CRUD, listagem de documentos de entrada/saída e auditoria de NF/saídas

Esta camada expõe o CRUD de empresas e arquivos SPED (cadastro/listagem/exclusão), além das rotas de consulta e auditoria dos documentos fiscais importados do EFD ICMS/IPI (registros C100/C170/C190 e D100). Serve de espinha dorsal para a navegação do sistema: o usuário escolhe a empresa (0000 do SPED), seleciona um período/arquivo importado e a partir do id_sped_arquivo consulta entradas (ind_oper=0), saídas (ind_oper=1, NF-e mod 55 e NFC-e mod 65) e visões analíticas que cruzam cabeçalho da nota, itens e consolidação por CFOP/CST. Também provê exclusão segura (transacional) de períodos individuais, em lote e de empresas inteiras com cascade manual de tabelas filhas.

**Tabelas:** empresas, sped_arquivos, documentos_c100, documentos_itens_c170, documentos_c190, documentos_d100, sped_produtos, sped_participantes, lmc_movimentacao, erros_analise, empresa_certificados, lmc_tanques_config, lmc_observacoes (não limpada na exclusão), encerrantes_exportados (não limpada na exclusão)

**Registros SPED:** 0000, C100, C170, C190, D100, cod_mod 55 (NF-e), cod_mod 65 (NFC-e)

### B10 — LMC - Dados Core: Continuidade de encerrantes, Diagnóstico de completude e Montagem do LMC diário

Este bloco contém o núcleo de leitura/montagem do Livro de Movimentação de Combustíveis (LMC) para postos. Cobre três rotas GET: (1) continuidade entre meses — confere se o estoque de abertura do mês atual bate com o fechamento físico do mês anterior do mesmo CNPJ; (2) diagnóstico de completude — detecta dias do período de apuração sem registro 1300 por produto (SPED gerado pela metade); (3) montagem do LMC diário consolidado por combustível, cruzando a movimentação física (encerrantes/bicos/tanques) com as NF-e de entrada (C100/C170) e calculando a cascata de estoque escritural, diferença físico-escritural e variação ANP 0,6%.

**Tabelas:** lmc_movimentacao, sped_arquivos, sped_produtos, documentos_c100, documentos_itens_c170, sped_participantes, lmc_tanques_config

**Registros SPED:** 0000, 1300, 1310, 1320, C100, C170, 0200

### B11 — LMC - Estoque & Sincronização (ajuste de abertura, redistribuição de vendas e correção de distribuição)

Conjunto de rotas que permite ao auditor "ancorar" o estoque de abertura do LMC (Livro de Movimentação de Combustíveis) de um produto/mês e, a partir desse novo valor, redistribuir matematicamente as vendas (saídas) e os fechamentos físicos diários de cada tanque, gravando colunas espelho *_ajustado sem destruir os dados originais do SPED. O objetivo fiscal é garantir uma cascata diária coerente (abertura + entradas - saídas = escritural, físico = escritural ± perda/ganho) onde nenhum dia com NFC-e fique com venda zerada, nenhum estoque fique negativo, a capacidade dos tanques (lmc_tanques_config) nunca seja estourada e a variação física x escritural permaneça dentro do limite ANP de 0,60%. Esses valores ajustados alimentam os registros 1300/1310/1320 do Bloco 1 na exportação SPED.

**Tabelas:** lmc_movimentacao (leitura: estq_abert, vol_entr, vol_saidas, fech_fisico, val_perda, val_ganho, num_tanque, data_mov; escrita: estq_abert_ajustado, vol_saidas_ajustado, fech_fisico_ajustado, val_perda_ajustado, val_ganho_ajustado, vol_escr_ajustado, vol_entr_ajustado), lmc_tanques_config (leitura: capacidade, cod_item, cnpj), sped_arquivos (leitura: id, cnpj_empresa para join por CNPJ normalizado)

**Registros SPED:** 1300, 1310, 1320, C100 (NF-e de entrada que define vol_entr), 0000 (CNPJ da empresa para join)

### B12 — LMC - Otimizador Matematico (POST /api/lmc/otimizador-matematico)

Rota que recalcula matematicamente os numeros do LMC (Livro de Movimentacao de Combustiveis) de um item/combustivel num arquivo SPED, ajustando vendas (saidas), aberturas, fechamentos fisicos, perdas e ganhos diarios para que a cascata de estoque feche dentro da variacao tolerada pela ANP (0,6 por cento) sem transbordar a capacidade dos tanques nem gerar estoque negativo. Trabalha sobre o consolidado diario (soma de todos os tanques do mesmo produto por dia), encontra o volume total de vendas mais coerente e depois redistribui esses numeros de volta para cada tanque/registro original, gravando o resultado nas colunas *_ajustado de lmc_movimentacao. E o nucleo do ajuste fiscal que tenta tornar o LMC consistente com a regra ANP e com a realidade fisica antes da exportacao/impressao.

**Tabelas:** lmc_movimentacao (leitura: vol_entr, vol_saidas, estq_abert, estq_abert_ajustado, fech_fisico, val_perda, val_ganho, num_tanque, id; escrita: estq_abert_ajustado, vol_saidas_ajustado, fech_fisico_ajustado, val_perda_ajustado, val_ganho_ajustado, vol_escr_ajustado, vol_entr_ajustado), lmc_tanques_config (leitura: capacidade, cnpj, cod_item), sped_arquivos (leitura via JOIN: id, cnpj_empresa)

**Registros SPED:** 1300 (movimentacao de combustivel / fechamento de tanque - origem dos dados do LMC e da capacidade de tanque), 1310 (movimentacao por tanque), 1320 (volume de vendas por bico/encerrante), C100 (NF-e de entrada - origem das entradas vol_entr, espelhadas e nao ajustadas), C170 (itens da NF-e de entrada)

### B13 — Relatorios: Resumo Gerencial, Resumo de Estoque, Rentabilidade e PDF de Posicao de Estoque

Este bloco expoe quatro rotas GET de relatorio gerencial/fiscal sobre um arquivo SPED ja importado e analisado. Combina dados do SPED Fiscal (blocos C100/C170/C190) com o LMC (Livro de Movimentacao de Combustiveis, tabela lmc_movimentacao derivada dos registros 1300/1310/1320). Entrega: (1) resumo gerencial de entradas/saidas por CFOP + resumo de combustiveis + resumo de estoque com variacao ANP; (2) posicao de estoque do ultimo dia com flag de anomalia; (3) calculo de rentabilidade/custo medio por produto; (4) PDF de posicao do estoque. O foco fiscal e auditar movimentacao fisica de combustiveis (estoque inicial, entradas, saidas, estoque final, variacao percentual vs limite ANP de 0,6%) e estimar margem/custo a partir das NF-e de compra e venda.

**Tabelas:** documentos_c100 (leitura: id, id_sped_arquivo, ind_oper, vl_doc, cod_sit, dt_doc), documentos_c190 (leitura: cfop, vl_opr, vl_bc_icms, vl_icms, id_documento_c100), documentos_itens_c170 (leitura: cod_item, qtd, vl_item, id_documento_c100), sped_produtos (leitura: cod_item, descr_item, id_sped_arquivo), lmc_movimentacao (leitura: cod_item, num_tanque, data_mov, estq_abert, vol_entr, vol_entr_ajustado, vol_saidas, vol_saidas_ajustado, fech_fisico, fech_fisico_ajustado, id_sped_arquivo), erros_analise (leitura via EXISTS: id_sped_arquivo, cod_item_erro, data_erro), sped_arquivos (leitura: id, id_empresa, periodo_apuracao), empresas (leitura: id, nome_empresa, cnpj)

**Registros SPED:** 0000 (identificacao empresa/periodo via sped_arquivos+empresas), 0200 (cadastro de itens -> sped_produtos), C100 (NF-e: ind_oper entrada/saida, vl_doc, cod_sit cancelamento), C170 (itens do documento: qtd litros, vl_item), C190 (registro analitico por CST/CFOP/aliquota: vl_opr, vl_bc_icms, vl_icms), 1300 (movimentacao de combustivel/tanque), 1310 (volume de vendas por tanque), 1320 (volume de vendas por bico)

### B14 — Tanques (config/sugestao por CNPJ), Resumo por Participante, Dossie PDF e Exportacao Excel

Conjunto de 5 rotas auxiliares que sustentam a auditoria do LMC e os relatorios do Audisped. Tres rotas tratam da CAPACIDADE FISICA dos tanques por CNPJ (a capacidade nao vem confiavel no SPED, entao o sistema a persiste manualmente em lmc_tanques_config e oferece sugestao automatica lendo o campo CAP_TANQUE do registro 1310 quando o arquivo esta no layout 020). Essa capacidade alimenta a regra fiscal CRIT-1310-01 (estoque final do tanque nao pode exceder a capacidade) e o motor de redistribuicao do LMC. As outras duas rotas geram artefatos de auditoria: resumo de compras/vendas por participante (a partir de C100) e exportacao do dossie de inconsistencias em PDF e Excel (a partir de erros_analise).

**Tabelas:** lmc_tanques_config (R/W: SELECT cod_item/capacidade; UPSERT cnpj/cod_item/capacidade), sped_arquivos (R: caminho_arquivo, nome_arquivo, periodo_apuracao, id_empresa), empresas (R: nome_empresa, cnpj via JOIN id_empresa), documentos_c100 (R: cod_part, vl_doc, ind_oper, id_sped_arquivo), sped_participantes (R: cod_part, nome via LEFT JOIN), erros_analise (R: tipo_erro, regra_id, titulo_erro, descricao_erro, sugestao_correcao, cod_item_erro, data_erro, id_sped_arquivo)

**Registros SPED:** 0000 (versao do leiaute - decide se CAP_TANQUE existe), 0150 (participantes - nome via sped_participantes), 0200 (produtos/combustivel - cod_item), 1300 (movimentacao diaria por combustivel - fixa cod_item corrente), 1310 (movimentacao por tanque - NUM_TANQUE f[2], CAP_TANQUE f[11] no layout 020, VL_FECH f[10]), 1320 (volume por bico/encerrantes - vendas), C100 (capa NF entrada/saida - ind_oper, vl_doc, cod_part), C170 (itens - referenciado no schema, nao usado aqui), C190 (analitico por CFOP - nao usado aqui)

### B15 — Correções e Ajustes LMC — correção manual de itens, correção em massa, ajuste em cascata de estoque e observações

Conjunto de rotas REST que aplicam correções e ajustes fiscais sobre dados já importados do SPED. Permite corrigir manualmente campos de documentos fiscais (C100/C170/C190) e linhas de LMC, aplicar correção em massa de CST de ICMS em itens sinalizados pela análise de erros, e ajustar manualmente o volume de saídas (vendas) de um produto de combustível em um dia, propagando o efeito dia a dia (cascata) sobre o estoque escritural e físico, respeitando a tolerância ANP de 0,60% para perdas/ganhos. Inclui ainda persistência das observações do LMC (campo 13 do Livro de Movimentação de Combustíveis).

**Tabelas:** lmc_movimentacao, documentos_itens_c170, documentos_c100, documentos_c190, erros_analise, lmc_observacoes, vendas_combustiveis, lmc_tanques_config

**Registros SPED:** C100, C170, C190, 1300, 1310, 1320, 0200/sped_produtos

### B16 — Impressão LMC — Geração de PDF no modelo AutoSystem PRO (Linx)

Este módulo gera o PDF do Livro de Movimentação de Combustíveis (LMC) — documento obrigatório da ANP para postos revendedores varejistas — reproduzindo fielmente o layout do AutoSystem PRO da Linx. Uma folha (página) por combinação dia+combustível, com os campos numerados de 1 a 13 do livro: produto, data, estoque de abertura por tanque, volume recebido (NF-e de entrada), volume vendido por bico (encerrantes), conciliação de estoques, perdas/sobras, valor de vendas e observações. Também persiste observações editáveis por dia/produto na tabela lmc_observacoes.

**Tabelas:** sped_arquivos, empresas, sped_produtos, lmc_movimentacao, documentos_c100, documentos_itens_c170, lmc_observacoes

**Registros SPED:** 0000, 0005, 1300, 1310, 1320, C100, C170, H010 (mencionado em contexto adjacente, não usado aqui)

### B17 — Motor Exportacao SPED V7 - Parte A: carregamento de dados, pre-scan e nucleo flush1300Group (LMC)

Inicio da rota GET /api/exportar-sped/:id, que retifica um arquivo SPED Fiscal (EFD ICMS/IPI) original e devolve um TXT corrigido para download. Esta Parte A faz: (1) carregamento de todos os ajustes do banco (LMC, C100, C190, C170, capacidades de tanques, encerrantes exportados do mes anterior); (2) pre-scan do arquivo fisico para mapear COD_ITEMs referenciados (regra do PVA de que todo 0200 precisa de referencia), detectar 0000 e lacunas no 1300; (3) deduplicacao de D100 (CT-e); (4) montagem do nome do arquivo de saida; e (5) o nucleo do motor: a closure flush1300Group, que recalcula o LMC (registros 1300/1310/1320) aplicando escudo ANP 0,60%, ancora no fechamento fisico do banco, redistribuicao de saidas entre tanques e tratamento de bicos (bomba parada, fantasma, multiproduto, duplicata).

**Tabelas:** sped_arquivos, lmc_movimentacao, lmc_tanques_config, documentos_c100, documentos_c190, documentos_itens_c170, encerrantes_exportados, encerrantes_bicos_exportados, empresas

**Registros SPED:** 0000, 0150, 0200, 0205, 0206, C100, C170, C176, C190, C790, C791, D100, D101-D199, D170, D201, D205, D500, E110, E111, E210, G110, H010, 1300, 1310, 1320, 1601, K200, K210, K220, K230, K235, K250, K255, 9900, 0990, 9999

### B18 — Motor Exportacao SPED V7 - Parte B: Nucleo de Redistribuicao de Vendas (flush1300Group, PASS 1-4)

Esta parte e o coracao da exportacao do Bloco 1 do SPED Fiscal (controle de estoque de combustivel por posto): registros 1300 (estoque global por produto), 1310 (estoque por tanque) e 1320 (volume de vendas por bico/encerrante). A funcao flush1300Group reescreve, na hora de gerar o TXT do SPED, os valores de abertura/entradas/disponivel/saidas/escritural/perda/ganho/fechamento de forma que: (a) a soma dos 1310 bata exatamente com o 1300, (b) a soma dos 1320 (bicos) bata com a saida de cada 1310, (c) perda/ganho fiquem dentro do limite ANP de 0,60% (escudo aplicado a 0,55% por seguranca de arredondamento), (d) os encerrantes dos bicos sejam continuos e crescentes ao longo do mes e entre meses, e (e) o fechamento fisico final (FECH) coincida com a ancora do banco (fech_fisico_ajustado) quando isso nao viola o ANP. Tambem trata casos patologicos dos dados de origem: bicos duplicados, bombas paradas, registros fantasma, e bicos multiproduto.

**Tabelas:** lmc_movimentacao, sped_arquivos, encerrantes_exportados, encerrantes_bicos_exportados

**Registros SPED:** 0000, 0150, 0200, 0205, 0206, 1300, 1310, 1320, H010, 9900, 0990, 9999

### B19 — Motor Exportacao SPED V7 - Parte C: Finalizacao (recalc 1300/1310/1320, recontagem 0990/1990/9999, montagem TXT, nome do arquivo, gravacao de encerrantes_exportados)

Trecho final da rota GET /api/exportar-sped/:id, responsavel pela retificacao/montagem do arquivo SPED EFD ICMS/IPI de saida com foco no Bloco 1 (LMC - Livro de Movimentacao de Combustiveis): registros 1300 (movimentacao diaria por combustivel/cod_item), 1310 (movimentacao por tanque) e 1320 (volume de vendas por bico/encerrante). Faz a reconciliacao matematica entre 1300=Σ1310 e 1310.SAIDA=Σ1320.VOL_VENDAS, aplica o escudo de variacao legal da ANP (0,60% com margem operacional 0,55%), propaga a continuidade intermensal (FECH do mes anterior vira ABERT do mes atual), recalcula os contadores estruturais (9900/0990/1990/9999), monta o nome do arquivo (CNPJ_FANTASIA_MM-YYYY.txt) e persiste os fechamentos fisicos e encerrantes de bicos nas tabelas de continuidade.

**Tabelas:** sped_arquivos, empresas, lmc_movimentacao, encerrantes_exportados, encerrantes_bicos_exportados, sped_participantes

**Registros SPED:** 0000, 0150, 0200, 0205, 0206, 0990, 1300, 1310, 1320, 1601, 1990, C100, C170, C190, C590, C690, C790, C791, D100, D500, D590, D600, D690, E210, H010, 9900, 9999

### B20 — B20 - Rotas finais (exclusao, otimizacao LMC, de-para, MDe x SPED, injecao CTe) + script Redistribuicao Automatica

Esta parte reune as rotas finais do servidor antes do app.listen e o script de automacao de redistribuicao. Cobre a exclusao em background de um arquivo SPED inteiro (podando filhos C170/C190/C100 e tabelas derivadas), a otimizacao matematica do LMC (forcar o volume de saidas de um combustivel a um alvo, com ruido organico e respeito a capacidade do tanque), o cadastro de-para de produtos XML (correcao de CFOP/CST/aliquota por produto/emissor), a conferencia de chaves NF-e entre o cache MDe e o que ja existe no SPED, a sincronizacao de chaves faltantes via EspiaoNFe, e a injecao de CT-e (Bloco D - D100/D190) num SPED ja existente. O script redistribuir_automatico.js orquestra a sincronizacao de estoque (Re-distribuir, Motor V7) em lote para todos os arquivos de uma empresa em ordem cronologica.

**Tabelas:** sped_arquivos, documentos_c100, documentos_itens_c170, documentos_c190, lmc_movimentacao, sped_produtos, sped_participantes, erros_analise, lmc_tanques_config, de_para_xml, mde_cache

**Registros SPED:** 0000, 0005, 0150, 0200, 0990, 1300, 1310, C001, C100, C170, C190, C990, D001, D100, D190, D990, 9900, 9990, 9999

### B21 — Service SPED Costureira - montagem/remontagem do arquivo SPED com integridade de blocos e recálculo de totalizadores

Esta é a "costureira" do Audisped: recebe registros já calculados (blocos 0, C e D, tipicamente gerados a partir de XMLs de NF-e/NFC-e pelo xmlInjectorService) e os injeta dentro de um arquivo SPED Fiscal (EFD ICMS/IPI) existente, preservando a hierarquia pai-filho dos registros, evitando duplicidades e, ao final, recalculando todos os totalizadores/contadores de bloco (X990, 9900, 9990, 9999) e reapurando E110 (ICMS próprio) e E210 (ICMS-ST). É o componente que garante que o arquivo remontado continue válido perante o PVA da SEFAZ/Receita após a injeção de documentos fiscais. Também sabe gerar um SPED "fragmentado" standalone quando não há arquivo base.

**Tabelas:** sped_arquivos

**Registros SPED:** 0000, 0150, 0175, 0190, 0200, 0205, 0206, 0210, 0220, 0990, C001, C100, C170, C190, C500, C590, C600, C690, C790, C791, C990, D001, D100, D500, D590, D600, D690, D990, E110, E111, E210, E220, E990, G990, H005, H990, 0990, 1990, 9001, 9900, 9990, 9999

### B22 — Service Injetor CT-e (Bloco D / D100 + D190) + Extratores Python de DACTE/CT-e

Esta unidade implementa a INJEÇÃO de Conhecimentos de Transporte eletrônicos (CT-e, modelo 57) no SPED Fiscal (EFD ICMS/IPI) de postos de combustível, gerando o Bloco D (D100 cabeçalho + D190 analítico) e os participantes-transportadora (0150) a partir de XMLs de CT-e. Também contém um conjunto de scripts Python auxiliares (não integrados ao servidor Node) para coletar XMLs/DACTEs de CT-e a partir de e-mails locais do Thunderbird (mbox) e extrair as chaves de acesso de 44 dígitos de DACTEs em PDF, produzindo listas para confronto com a escrituração / consulta SEFAZ. O foco fiscal é o crédito de ICMS sobre frete de compras de combustível e a correta escrituração do tomador de serviço (IND_OPER=0, IND_EMIT=1).

**Tabelas:** sped_arquivos (SELECT caminho_arquivo, cnpj_empresa, periodo_apuracao na rota /inject), documentos_d100 (lida pela regra de auditoria RTAX-D100-01 no server.js), pool (dbClient passado a transformarCtesEmSped mas NÃO utilizado)

**Registros SPED:** 0000, 0150, 0175, 0190, 0200, 0220, 0990, C001, C100, C190, C990, D001, D100, D190, D590, D990, E110, E111, E210, E220, H005, 9900, 9990, 9999

### F1 — Frontend Core - App, Router, Store, Auth, Cliente HTTP, Login, Perfil, Home (Gestor de Clientes) e Dashboard Hub

Esta unidade e o nucleo do frontend Vue 3 (Composition API + script setup) do Audisped, um sistema de auditoria fiscal para postos de combustivel que processa SPED Fiscal (EFD ICMS/IPI) e gera o LMC (Livro de Movimentacao de Combustiveis). Ela define o shell visual (sidebar/menu lateral + RouterView), o roteamento SPA com guarda de autenticacao por token JWT, o estado global de sessao (token, usuario) e de auditoria (empresa selecionada e arquivo SPED ativo) persistido em localStorage, o cliente HTTP axios com interceptors de token/401-403, e as telas de Login, Perfil, lista de Empresas (Gestor de Clientes) e o Hub de modulos por cliente. Toda a navegacao para as ferramentas fiscais (Injetor XML/CT-e, De-Para, CFOP, MDe/Manifesto, Motor de Auditoria, Livro LMC, Impressao LMC, Posicao de Estoque) parte deste core.

**Registros SPED:** 0000, C100, C170, C190, 1300, 1310, 1320, H010

### F2 — View Analisador — Tela principal de auditoria do SPED Fiscal (postos de combustível)

É a tela central de análise/auditoria do sistema Audisped. Recebe o upload do arquivo TXT do SPED Fiscal (EFD ICMS/IPI) de um posto de combustível, dispara o motor de auditoria no backend e apresenta os resultados em 7 abas: Upload, Dashboard gerencial (faturamento/compras/litros/CFOP), Auditoria LMC especializada (Livro de Movimentação de Combustíveis — estoque, entradas, saídas, quebras, variação ANP 0,6%), Alertas (erros/regras), Malha Fina (auditoria sintática estrutural do layout SPED), Notas (C100/C170/C190 de entrada) e Saídas NF (modelos 55/65). Permite correções manuais: estoque inicial, saída por dia (cascata), valores de NF (C100/C190), configuração de capacidade de tanques, otimizador matemático de distribuição de vendas e sincronização de continuidade de estoque intermensal. Também exporta Dossiê PDF, Excel e SPED retificado.

**Registros SPED:** 0000, C100, C170, C190, 1300, 1310, 1320, H010

### F3 — F3 - Views LMC (LmcView, ImpressaoLmcView, StockAnalysis)

Camada de UI (Vue 3 / Composition API) do modulo LMC (Livro de Movimentacao de Combustiveis) de postos. LmcView e a tela central: exibe o LMC diario por combustivel reconstruido a partir do SPED Fiscal (bloco 1300/1310/1320 e NF-e C100), com dois motores de calculo paralelos (Raio-X = espelho do SPED original; Laboratorio = simulacao/camuflagem da quebra ANP), edicao de saidas e fechamento fisico em cascata, otimizador matematico de vendas, sincronizacao de continuidade de estoque entre meses e exportacao do SPED retificado. ImpressaoLmcView monta filtros e um resumo por combustivel (2 colunas) e dispara a geracao do PDF do LMC. StockAnalysis e uma tela forense de estoque por tanque/bico, atualmente um esqueleto sem fonte de dados (data fixo em []).

**Registros SPED:** 0000, 0200, 1300, 1310, 1320, C100, C170

### F4 — Views Injetores XML/CTe & De-Para (Frontend Vue)

Conjunto de telas Vue 3 (script setup) que alimentam o motor de reconstrução do SPED Fiscal. Permitem ao auditor fazer upload de XMLs de NF-e de entrada (compras de combustível, lubrificantes, uso/consumo, imobilizado) e de CT-e (frete/Bloco D), aplicar regras de De-Para (CNPJ emissor + código de produto XML -> CFOP/CST/alíquota ICMS/CST PIS-COFINS/conta contábil/código interno), e injetar essas notas retroativamente nos registros C100/C170/C190 (NF-e) e D100 (CT-e) de um arquivo SPED já importado, ou gerar um SPED standalone. É a interface de "forçar a entrada de notas omitidas" no arquivo fiscal, com efeito colateral de alimentar o LMC (entradas de combustível por NCM/data).

**Tabelas:** de_para_xml (leitura via GET /api/de-para; escrita via POST upsert e DELETE; colunas adicionadas em runtime por ALTER TABLE: ncm, cod_interno, conta_contabil, aliq_icms, bc_icms_override, cst_pis, cst_cofins), cfops (GET/POST/PUT/DELETE /api/cfops — indireto), arquivos_sped (indireto: GET /api/arquivos/empresa/:id e /api/sped-info/:id para popular selects e exportar)

**Registros SPED:** 0200 (cadastro de item — descrição/cod_interno do De-Para alimentam este registro), C100 (NF-e de entrada), C170 (itens da NF-e — CFOP/CST/BC/alíquota/valor com ajuste de IPI e ICMS ao custo), C190 (analítico por CST/CFOP/alíquota), D100 (CT-e — Bloco D, injetado pelo InjetorCte), D190 (analítico CT-e), 1300/1310/1320 (LMC — indireto via lmc_atualizados, entradas de combustível)

### F5 — Views MDe, Explorador, CFOP, Rentabilidade e Preview SPED (frontend Vue)

Camada de telas (Vue 3 + script setup) responsável pela interface das operações fiscais auxiliares do Audisped: (1) MD-e — captura, manifestação e download de NF-e emitidas contra o CNPJ da empresa via SEFAZ/EspiãoNFe, mais conferência das chaves contra um arquivo SPED; (2) Explorador — histórico de arquivos SPED importados por empresa, agrupado por ano/período de apuração, com exclusão; (3) ExploradorDeDocumentos — listagem de documentos de entrada (C100) de um arquivo SPED; (4) CFOP — CRUD do cadastro de CFOPs usados como de-para na injeção de XMLs; (5) Rentabilidade/Posição de Estoque — relatório que cruza entradas/saídas (C100/C170) com estoque do LMC; (6) SpedPreview — modal de simulação gerencial e mapeamento De-Para (CFOP/CST por fornecedor+produto) antes de gerar o SPED a partir de XMLs.

**Tabelas:** sped_arquivos, documentos_c100, documentos_itens_c170, sped_produtos, sped_participantes, lmc_movimentacao, cfops (cadastro), de_para (mapeamento CFOP/CST por empresa+cnpj_emissor+cod_produto_xml), tabela de NF-e/MD-e capturadas (mde notas: chave_nfe, status_manifesto, xml_content, itens_json, tipo_operacao), certificado A1 por empresa (pfx, senha, ultimo_nsu, periodicidade)

**Registros SPED:** 0000, 0150, 0200, C100, C170, 1300, 1310, 1320, D100

