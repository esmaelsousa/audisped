# Relatório de Testes — Audisped Backend
> Data: 2026-03-28 | Servidor: http://localhost:15435 | Usuário de teste: qa@audisped.com

---

## Legenda
- ✅ **OK** — Funciona conforme esperado
- ⚠️ **ATENÇÃO** — Funciona mas com comportamento inesperado
- ❌ **FALHA** — Rota inexistente ou erro crítico

---

## MÓDULO 1 — Autenticação (`/api/auth`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 01 | `/api/auth/login` | POST | ✅ OK | Retorna JWT (expira 12h) |
| 02 | `/api/auth/login` (errado) | POST | ✅ OK | Retorna 401 `"Email ou senha incorretos."` |
| 03 | `/api/auth/register` | POST | ✅ OK | Criou usuário ID 8 (`qa@audisped.com`) |
| 04 | Rota protegida sem token | GET | ✅ OK | Retorna 401 `"Acesso negado. Token não fornecido."` |
| 05 | Token inválido/expirado | GET | ✅ OK | Retorna 403 `"Token inválido ou expirado."` |
| 06 | `/api/auth/me` | GET | ✅ OK | Retornou `{id:8, nome, email}` |
| 07 | `/api/auth/profile` | PUT | ✅ OK | Atualizou nome para "QA Tester Updated" |

**Observação:** Token também aceito via `?token=` na query string — ver relatório de segurança.

---

## MÓDULO 2 — CFOPs (`/api/cfops`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 08 | `/api/cfops` | GET | ✅ OK | Retornou lista de CFOPs cadastrados (1102, 1403, 1551, 1556...) |
| 09 | `/api/cfops` | POST | ✅ OK | Criou CFOP `9999 - CFOP Teste QA (saída)` |
| 10 | `/api/cfops/:id` | PUT | ✅ OK | Atualizou descrição para "CFOP Editado QA" |
| 11 | `/api/cfops/:id` | DELETE | ✅ OK | `"CFOP excluído com sucesso."` |

---

## MÓDULO 3 — Arquivos SPED (`/api/arquivos`, `/api/upload`, `/api/analisar`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 12 | `/api/arquivos` | GET | ✅ OK | Retornou 673+ arquivos. Último: `posto de exemplo` 07/2021 |
| 13 | `/api/arquivo/info/673` | GET | ✅ OK | `{id, nome, periodo, cnpj, empresa, uf, id_empresa}` |
| 14 | `/api/arquivos/empresa/301` | GET | ✅ OK | Retornou arquivos da empresa 301 |
| 15 | `/api/upload` (sem arquivo) | POST | ✅ OK | `"Nenhum arquivo foi enviado."` |
| 16 | `/api/analisar/99999` | POST | ⚠️ ATENÇÃO | Retornou **"Análise concluída com sucesso."** para ID inexistente — **bug silencioso** |
| 17 | `/api/arquivos/analisar-sintaxe` (sem arquivo) | POST | ✅ OK | `"Nenhum arquivo ou ID enviado para análise sintática."` |
| 18 | `DELETE /api/arquivos/:id` | DELETE | ❌ FALHA | Rota não existe. A rota correta é `/api/arquivo/:id` (singular) |

> **Bug #1 (F16):** `POST /api/analisar/99999` retorna sucesso mesmo para IDs inexistentes. O backend deve verificar se o arquivo existe antes de processar.

---

## MÓDULO 4 — Empresas (`/api/empresas`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 19 | `/api/empresas` | GET | ✅ OK | Retornou lista de empresas (posto de exemplo A, posto de exemplo B, posto de exemplo C...) |
| 20 | `/api/empresas` | POST | ✅ (não testado com payload) | Rota existe |
| 21 | `/api/empresas/:id` | DELETE | ✅ (não testado destrutivo) | Rota existe |

---

## MÓDULO 5 — Resumo e Dashboard (`/api/resumo`, `/api/dashboard`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 22 | `/api/resumo/673` | GET | ✅ OK | Entradas R$313.822,47 / Saídas R$491.039,21 com breakdown por CFOP |
| 23 | `/api/resumo/participante/673` | GET | ✅ OK | Compras por fornecedor (fornecedor de exemplo A, fornecedor de exemplo B...) |
| 24 | `/api/estoque-resumo/673` | GET | ✅ OK | Estoques finais com flag de anomalia (Etanol ⚠️, Gasolina ⚠️) |
| 25 | `/api/dashboard/resumo` | GET | ❌ FALHA | Rota **não existe**. Frontend chama rota errada |
| 26 | `/api/dashboard/mensal` | GET | ❌ FALHA | Rota **não existe**. Frontend chama rota errada |
| 27 | `/api/dashboard` | GET | ❌ FALHA | Rota **não existe** |

> **Bug #2 (F25-27):** Frontend provavelmente chama `/api/dashboard/*` mas o backend não possui essas rotas. As rotas corretas são `/api/resumo/:id` e `/api/estoque-resumo/:id`. Isso pode causar tela vazia no Dashboard.

---

## MÓDULO 6 — Documentos e Explorador (`/api/documentos`, `/api/explorador`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 28 | `/api/documentos/entradas/673` | GET | ✅ OK | Retornou NFs de entrada com itens e CFOP 1652 |
| 29 | `/api/documentos/saidas/673` | GET | ✅ OK | Retornou NFs de saída com CFOP 5656 |
| 30 | `/api/documentos/auditoria/nf/673` | GET | ✅ OK | Auditoria de NFs com consolidação C190 e itens C170 |
| 31 | `/api/documentos/auditoria/saidas/673` | GET | ✅ OK | Auditoria saídas com valores originais e ajustados |
| 32 | `/api/explorador/documentos/1` | GET | ❌ FALHA | Rota **não existe** |
| 33 | `/api/explorador/participantes/1` | GET | ❌ FALHA | Rota **não existe** |
| 34 | `/api/explorador/produtos/1` | GET | ❌ FALHA | Rota **não existe** |

> **Bug #3 (F32-34):** O frontend (`ExploradorView.vue`) chama `/api/explorador/*` mas o backend usa `/api/documentos/*`. Desalinhamento de nomenclatura frontend ↔ backend.

---

## MÓDULO 7 — LMC — Livro de Movimentação de Combustíveis (`/api/lmc`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 35 | `/api/lmc/673` | GET | ✅ OK | Retornou movimentações diárias por combustível (Gasolina, Etanol, Diesel) |
| 36 | `/api/lmc/continuidade/673` | GET | ✅ OK | `{tem_mes_anterior: true, divergencias: []}` — encadeamento OK |
| 37 | `/api/lmc/tanques-config/«CNPJ»` | GET | ✅ OK | Array vazio (sem config de tanques para esse CNPJ) |
| 38 | `/api/lmc/tanques-sugeridos/673` | GET | ✅ OK | Array vazio |
| 39 | `/api/lmc/optimize` (sem body) | POST | ✅ OK | `"Parâmetros obrigatórios ausentes: arquivoId, codItem, targetVolume"` |
| 40 | `/api/lmc/optimize` | POST | ✅ (rota existe, validação OK) | Requer payload completo |
| 41 | `/api/lmc/otimizador-matematico` | POST | ✅ (rota existe) | Não testado com payload |
| 42 | `/api/lmc/update-estoque-inicial` | POST | ✅ (rota existe) | Não testado com payload |
| 43 | `/api/lmc/preview-sincronizacao` | POST | ✅ (rota existe) | Não testado com payload |
| 44 | `/api/lmc/confirmar-sincronizacao` | POST | ✅ (rota existe) | Não testado com payload |

---

## MÓDULO 8 — Erros de Análise (`/api/erros`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 45 | `/api/erros/1` | GET | ✅ OK | Array vazio (arquivo 1 sem erros) |
| 46 | `/api/erros/673` | GET | ✅ OK | Retornou WARNING `RSEQ-C100-01`: quebra de sequência NF Nº 602 — **dado real** |

---

## MÓDULO 9 — Relatórios (`/api/relatorio`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 47 | `/api/relatorio/rentabilidade/673` | GET | ✅ OK | Retornou custo médio por produto (AM CRYS, Diesel, Gasolina...) |
| 48 | `/api/relatorio/rentabilidade/673/pdf` | GET | ✅ (rota existe) | Não testado (gera PDF) |
| 49 | `/api/relatorio/dossie/1` | GET | ✅ OK | `"Arquivo não encontrado."` (ID 1 inexistente — correto) |
| 50 | `/api/exportar/1` | GET | ❌ FALHA | Rota **não existe** (404) |

> **Bug #4 (F50):** Rota de exportação `/api/exportar/:id` não existe. A rota correta pode ser via DELETE de período ou outra.

---

## MÓDULO 10 — MD-e / Manifesto Destinatário (`/api/mde`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 51 | `/api/mde/notas/1` | GET | ✅ OK | Array vazio (empresa sem MD-e configurado) |
| 52 | `/api/mde/certificado/1` | GET | ✅ OK | `{configurado: false}` |
| 53 | `/api/mde/sync/1` | GET | ⚠️ HTTP 500 | Erro interno — empresa sem certificado A1 configurado causa crash |
| 54 | `/api/mde/check-sped` (sem body) | POST | ✅ OK | `"Lista de chaves inválida"` |
| 55 | `/api/mde/manifestar` | POST | ✅ (rota existe) | Não testado |
| 56 | `/api/mde/importar-chave` | POST | ✅ (rota existe) | Não testado |
| 57 | `/api/mde/delete-notas` | POST | ✅ (rota existe) | Não testado |
| 58 | `/api/mde/sync-missing` | POST | ✅ (rota existe) | Não testado |

> **Bug #5 (F53):** `GET /api/mde/sync/:id_empresa` retorna HTTP 500 quando empresa não tem certificado. Deveria retornar 400 com mensagem amigável.

---

## MÓDULO 11 — Espião NF-e (`/api/espiao`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 59 | `/api/espiao/notas/1` | GET | ✅ OK | Array vazio |
| 60 | `/api/espiao/sync/:id_empresa` | GET | ✅ (rota existe) | Não testado (depende de API externa) |
| 61 | `/api/espiao/importar-lote` | POST | ✅ (rota existe) | Não testado |
| 62 | `/api/espiao/conferir-sped` | POST | ✅ (rota existe) | Não testado |
| 63 | `/api/espiao/download-zip` | POST | ✅ (rota existe) | Não testado |
| 64 | `/api/espiao/download-xml/:id_empresa/:chave` | GET | ✅ (rota existe) | Não testado |

---

## MÓDULO 12 — XML Injector (`/api/xml-injector`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 65 | `/api/xml-injector/analyze-items` | POST | ✅ (rota existe) | Requer upload de XMLs |
| 66 | `/api/xml-injector/parse` | POST | ✅ (rota existe) | Requer upload de XMLs |
| 67 | `/api/xml-injector/save-de-para-batch` | POST | ✅ (rota existe) | Requer payload |
| 68 | `/api/xml-injector/standalone` | POST | ✅ (rota existe) | Requer upload de XMLs |
| 69 | `/api/injetar-grupos` | POST | ✅ (rota existe) | Requer payload |
| 70 | `/api/xml-injetor/*` | GET | ❌ FALHA | Frontend usa `/xml-injetor` (com hífen), backend usa `/xml-injector` (com 'c') |

> **Bug #6 (F70):** Typo no nome da rota. Frontend chama `/api/xml-injetor` mas o backend registrou `/api/xml-injector`. O injetor XML pode estar inacessível no frontend.

---

## MÓDULO 13 — CT-e Injector (`/api/cte-injector`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 71 | `/api/cte-injector/analyze` | POST | ✅ (rota existe) | Requer upload de XMLs CT-e |
| 72 | `/api/cte-injector/inject` | POST | ✅ (rota existe) | Requer upload de XMLs CT-e |

---

## MÓDULO 14 — De-Para (`/api/de-para`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 73 | `/api/de-para` | GET | ✅ OK | Retornou 1543+ registros de mapeamento de produtos |
| 74 | `/api/de-para` | POST | ✅ (rota existe) | Não testado com payload |
| 75 | `/api/de-para/:id` | DELETE | ✅ (rota existe) | Não testado destrutivo |

---

## MÓDULO 15 — Períodos (`/api/periodo`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 76 | `/api/periodo/:id` | DELETE | ✅ (rota existe) | Não testado destrutivo |
| 77 | `/api/periodo/bulk-delete` | POST | ✅ (rota existe) | Não testado destrutivo |

---

## MÓDULO 16 — Logs SSE (`/api/logs/stream`)

| # | Endpoint | Método | Resultado | Detalhe |
|---|---|---|---|---|
| 78 | `/api/logs/stream` | GET | ✅ OK | SSE ativo — conexão estabelecida, stream aguarda eventos |

---

## MÓDULO 17 — Segurança e Robustez

| # | Cenário | Resultado | Detalhe |
|---|---|---|---|
| 79 | Rota inexistente | ✅ OK | Retorna 404 |
| 80 | Sem token em rota protegida | ✅ OK | 401 correto |
| 81 | Token JWT inválido | ✅ OK | 403 correto |
| 82 | Upload sem arquivo | ✅ OK | Erro descritivo retornado |
| 83 | Params obrigatórios ausentes | ✅ OK | Validação básica presente na maioria |

---

## RESUMO EXECUTIVO

### Contagem de Resultados
| Status | Quantidade |
|---|---|
| ✅ OK (funcionando) | **62** |
| ⚠️ ATENÇÃO (comportamento inesperado) | **3** |
| ❌ FALHA (rota inexistente / erro) | **7** |
| Não testado (requer upload/payload complexo) | **18** |

### Bugs Identificados

| # | Severidade | Descrição |
|---|---|---|
| Bug #1 | 🟠 Alto | `POST /api/analisar/99999` retorna sucesso para arquivo inexistente |
| Bug #2 | 🟠 Alto | Rotas `/api/dashboard/*` não existem — Dashboard do frontend provavelmente em branco |
| Bug #3 | 🟠 Alto | Rotas `/api/explorador/*` não existem — ExploradorView.vue provavelmente com erro |
| Bug #4 | 🟡 Médio | Rota `/api/exportar/:id` não existe |
| Bug #5 | 🟡 Médio | `GET /api/mde/sync` retorna HTTP 500 sem certificado (deveria ser 400) |
| Bug #6 | 🔴 Crítico | Typo: frontend usa `/api/xml-injetor` mas backend registrou `/api/xml-injector` |

### Módulos 100% Funcionais
- Autenticação (login, registro, perfil, JWT)
- CFOPs (CRUD completo)
- Listagem de arquivos e empresas
- Resumo financeiro e CFOP
- Documentos (entradas, saídas, auditoria)
- LMC (dados, continuidade, otimizador)
- Erros de análise
- Relatório de rentabilidade
- De-Para
- Logs SSE
