// backend/routeScopeRegistry.js — FONTE ÚNICA da cobertura de isolamento por rede (Fase 1).
//
// Toda rota de dados TEM que estar aqui (em ESCOPO) ou na allowlist PUBLICAS. O teste
// backend/tests/scoperede-cobertura.test.js reprova qualquer rota /api/* que não esteja
// classificada — é a garantia default-deny contra "esqueci uma rota".
//
// ⚠️ Esta etapa é SÓ classificação. NÃO monta enrich global nem aplica scopeRede nas rotas
//    (isso é a Task 5). A classificação abaixo é o roteiro que a Task 5/6/7 vai seguir.
//
// Cada valor de ESCOPO descreve COMO a rede-dona do recurso é resolvida:
//   'empresa' → resolve por um id_empresa (em :param, no corpo ou na query) → empresas.rede_id.
//   'sped'    → resolve por um arquivo (id_sped/id_arquivo/id — direto, ou indireto por id de
//               um registro-filho: documento C1xx, correção, etc.) → sped_arquivos → empresa → rede.
//   'chave'   → resolve por chave de NF-e → documento/mde_cache → arquivo/empresa → rede (Task 7).
//   'cnpj'    → resolve por CNPJ (da empresa, ou da tabela cnpj-keyed rede-scoped) → rede (Task 7).
//   'lista'   → coleção: NÃO tem recurso único; a Task 5 FILTRA a query por rede (list-scoping).
//   'global'  → SEM dado de tenant: tabela de referência / motor de regras global / análise
//               stateless de arquivo enviado. NUNCA escopar por rede (justificativa individual abaixo).
//   'self'    → autorização já é feita DENTRO do handler pela identidade do ator / authz.js
//               (papel + rede), não por um recurso empresa/arquivo. scopeRede NÃO se aplica.
//   'write'   → criação pura sem id de recurso pré-existente; o vínculo de tenant é firmado na
//               ESCRITA, amarrando o novo dado à rede do ator (Task 6, write-path IDOR).
//
// Observação sobre 'self'/'write': o master exigiu marcar 'global' APENAS para rotas sem dado de
// tenant. Rotas de auth-próprio e de gestão de usuários/redes/leads TÊM dado de tenant, mas se
// auto-guardam (authz.js) — logo NÃO são 'global'. E os uploads de criação também não devolvem
// dado de outro tenant. Por isso os buckets 'self' e 'write', em vez de esconder essas rotas em
// 'global'. (Contagem por bucket e justificativas: no relatório da tarefa.)

// --- ALLOWLIST PÚBLICA (sem authMiddleware por design) ---
const PUBLICAS = new Set([
  'POST /api/auth/register',        // 410 Gone (cadastro público desativado) — não toca dado
  'POST /api/auth/login',           // emite JWT
  'POST /api/auth/forgot-password', // auto-serviço, resposta genérica, rate-limited
  'POST /api/auth/reset-password',  // consome token de uso único
  'POST /api/demo-lead',            // captura de lead do teste grátis (público, rate-limited)
  'GET /favicon.ico',               // 204, ícone do browser (fora de /api)
  // GET /api/logs/stream SAIU da allowlist (Fase 1, Task 5): era SSE público que vazava o feed
  //   GLOBAL do logger (CNPJs, nomes de arquivo, [DIAG]) cross-tenant. Agora exige papel interno
  //   (gate no handler) → reclassificada como 'self' em ESCOPO.
]);

// --- CLASSIFICAÇÃO DE CADA ROTA DE DADOS ---
const ESCOPO = {
  // ===================== self (auto-guardadas por authz.js / identidade do ator) =====================
  'GET /api/logs/stream': 'self',                          // SSE do feed de logs: gate de papel INTERNO no handler (super_admin/staff); enrich global popula req.ator
  'GET /api/auth/me': 'self',                              // usuarios WHERE id = req.user.id (próprio)
  'PUT /api/auth/profile': 'self',                         // UPDATE usuarios WHERE id = req.user.id (próprio)
  'POST /api/admin/usuarios': 'self',                      // resolverCamposNovoUsuario clampa rede do ator (§13.3)
  'GET /api/admin/usuarios': 'self',                       // admin → WHERE rede_id = ator; super/staff = todos (§13.6)
  'PATCH /api/admin/usuarios/:id/desativar': 'self',       // podeGerenciarAlvo checa rede do alvo (§13.7)
  'POST /api/admin/usuarios/:id/reset-senha': 'self',      // idem
  'PATCH /api/admin/usuarios/:id/ativar': 'self',          // idem
  'GET /api/admin/redes': 'self',                          // só super_admin (dropdown de provisionamento)
  'GET /api/admin/demo-leads': 'self',                     // só admin/super (leads são do operador, não de uma rede-cliente)
  'PATCH /api/admin/demo-leads/:id': 'self',               // idem
  'DELETE /api/admin/demo-leads/:id': 'self',              // idem

  // ===================== global (SEM dado de tenant) =====================
  // cad_cfops é tabela de REFERÊNCIA compartilhada (sem coluna de tenant). Escrita por qualquer
  // usuário autenticado é poder de config compartilhada (como regras_fiscais), NÃO um IDOR entre
  // redes (o dado não pertence a nenhuma rede). Hardening dessa escrita é fora do escopo de isolamento.
  'GET /api/cfops': 'global',
  'POST /api/cfops': 'global',
  'PUT /api/cfops/:id': 'global',
  'DELETE /api/cfops/:id': 'global',
  // Catálogo do validador: regras + leiaute.json (arquivos estáticos, sem tenant).
  'GET /api/validador/catalogo': 'global',
  // Sugestões de CEST a partir da tabela `cest` (referência fiscal nacional, sem tenant).
  'GET /api/validador/cest-sugeridos': 'global',
  // Motor de regras fiscais: `regras_fiscais` é GLOBAL (id_empresa pode ser NULL) e ALIMENTA o
  // export. O plano é explícito: NUNCA escopar por rede (Global Constraints). CRUD + simulador.
  'GET /api/regras-fiscais': 'global',
  'POST /api/regras-fiscais': 'global',
  'PUT /api/regras-fiscais/:id': 'global',
  'PATCH /api/regras-fiscais/:id/ativar': 'global',
  'POST /api/regras-fiscais/:id/duplicar': 'global',
  'DELETE /api/regras-fiscais/:id': 'global',
  'POST /api/regras-fiscais/simular': 'global',
  // CT-e analyze: analyzeOnly — só parseia os XMLs ENVIADOS e devolve preview; cteInjectorService
  // só lê/grava o banco quando !analyzeOnly (audit do master). idEmpresa é ignorado no caminho de
  // análise → não lê dado de outro tenant. Stateless. (O inject correspondente NÃO é global — ver 'sped'.)
  'POST /api/cte-injector/analyze': 'global',

  // ===================== empresa (resolve por id_empresa) =====================
  'GET /api/mde/sync/:id_empresa': 'empresa',
  'GET /api/mde/notas/:id_empresa': 'empresa',
  'POST /api/mde/manifestar': 'empresa',                   // corpo: id_empresa
  'POST /api/mde/importar-chave': 'empresa',               // corpo: id_empresa
  'POST /api/mde/delete-notas': 'empresa',                 // corpo: id_empresa (DELETE mde_cache WHERE id_empresa)
  'GET /api/espiao/sync/:id_empresa': 'empresa',
  'GET /api/espiao/notas/:id_empresa': 'empresa',
  'POST /api/espiao/importar-lote': 'empresa',             // corpo: id_empresa
  'POST /api/espiao/conferir-sped': 'empresa',             // corpo: id_empresa
  'POST /api/espiao/download-zip': 'empresa',              // corpo: id_empresa
  'GET /api/espiao/download-xml/:id_empresa/:chave': 'empresa',
  'POST /api/mde/certificado': 'empresa',                  // corpo: id_empresa (grava certificado da empresa)
  'POST /api/mde/certificado/validar': 'empresa',          // corpo: id_empresa (dry-run)
  'GET /api/mde/certificado/:id_empresa': 'empresa',
  'POST /api/xml-injector/analyze-items': 'empresa',       // corpo: id_empresa (opcional) → lê de-para da empresa
  'POST /api/xml-injector/save-de-para-batch': 'empresa',  // corpo: mapeamentos[].id_empresa (upsert de_para_xml)
  'POST /api/xml-injector/standalone': 'empresa',          // corpo: id_empresa (opcional) → lê cnpj da empresa
  'GET /api/arquivos/:id_empresa': 'empresa',              // arquivos da empresa
  'GET /api/arquivos/empresa/:id_empresa': 'empresa',
  'DELETE /api/empresas/:id': 'empresa',                   // :id = id da empresa
  'POST /api/conciliacao/sefaz-live': 'empresa',           // corpo: id_empresa (lê mde_cache/c100 da empresa)
  'GET /api/de-para': 'empresa',                           // query: id_empresa/cnpj (Task 5 força o filtro)
  'POST /api/de-para': 'empresa',                          // corpo: id_empresa (upsert de_para_xml)
  'DELETE /api/de-para/:id': 'empresa',                    // indireto: de_para_xml.id → id_empresa → rede
  'POST /api/mde/check-sped': 'empresa',                   // corpo: id_empresa
  'POST /api/mde/sync-missing': 'empresa',                 // corpo: id_empresa

  // ===================== sped (resolve por arquivo) =====================
  'POST /api/arquivos/analisar-sintaxe': 'sped',           // corpo: id_arquivo (opcional; senão arquivo enviado)
  'POST /api/xml-injector/parse': 'sped',                  // corpo: id_sped_arquivo (injeta no arquivo base)
  'POST /api/injetar-grupos': 'sped',                      // corpo: id_sped_arquivo (obrigatório)
  'POST /api/analisar/:id': 'sped',
  'GET /api/lmc/validacoes-1320/:id': 'sped',
  'POST /api/lmc/1320-corrigir': 'sped',                   // corpo: id_sped_arquivo
  'GET /api/erros/:id': 'sped',
  'GET /api/arquivo/info/:id': 'sped',
  'GET /api/lmc/continuidade/:id_sped': 'sped',
  'GET /api/lmc/diagnostico-completude/:id': 'sped',
  'GET /api/lmc/:id_sped': 'sped',
  'POST /api/lmc/update-estoque-inicial': 'sped',          // corpo: id_arquivo
  'POST /api/lmc/preview-sincronizacao': 'sped',           // corpo: itens[].id_arquivo (multi-id → escopar cada)
  'POST /api/lmc/confirmar-sincronizacao': 'sped',         // corpo: itens[].id_arquivo (multi-id)
  'POST /api/lmc/corrigir-distribuicao': 'sped',           // corpo: id_arquivo
  'POST /api/lmc/otimizador-matematico': 'sped',           // corpo: id_arquivo
  'DELETE /api/periodo/:id': 'sped',                       // :id = id_sped_arquivo
  'POST /api/periodo/bulk-delete': 'sped',                 // corpo: ids[] (multi-id)
  'GET /api/documentos/entradas/:id_arquivo': 'sped',
  'GET /api/documentos/saidas/:id_arquivo': 'sped',
  'GET /api/documentos/auditoria/nf/:id_arquivo': 'sped',
  'GET /api/documentos/auditoria/saidas/:id_arquivo': 'sped',
  'GET /api/resumo/:id_arquivo': 'sped',
  'GET /api/estoque-resumo/:id_arquivo': 'sped',
  'GET /api/relatorio/rentabilidade/:id_arquivo': 'sped',
  'GET /api/relatorio/rentabilidade/:id_arquivo/pdf': 'sped',
  'GET /api/lmc/tanques-sugeridos/:id_arquivo': 'sped',
  'GET /api/lmc/lacres-bombas/:id_arquivo': 'sped',
  'GET /api/cad/credenciadoras-1601/:id_arquivo': 'sped',
  'GET /api/cad/apuracao-e116/:id_arquivo': 'sped',
  'POST /api/conciliacao/aplicar-faltantes': 'sped',       // corpo: id_arquivo (injeta no SPED aberto)
  'POST /api/conciliacao/corrigir-divergentes': 'sped',    // corpo: id_arquivo
  'POST /api/analisador/importar-5929/:id_arquivo': 'sped',
  'POST /api/validador/analisar/:id': 'sped',
  'POST /api/validador/corrigir': 'sped',                  // corpo: id_sped_arquivo
  'POST /api/validador/corrigir-lote/:id': 'sped',
  'DELETE /api/validador/corrigir-lote/:id/:loteId': 'sped',
  'GET /api/validador/correcoes/:id': 'sped',
  'DELETE /api/validador/correcoes/:idCorrecao': 'sped',   // indireto: val_correcoes.id → id_sped_arquivo
  'POST /api/validador/revalidar/:id': 'sped',
  'GET /api/validador/alteracoes/:id': 'sped',
  'POST /api/validador/skip': 'sped',                      // corpo: id_sped_arquivo
  'GET /api/validador/relatorio-correcoes/:id': 'sped',
  'GET /api/validador/produtos-0200/:id': 'sped',
  'POST /api/validador/cod-item-map': 'sped',              // corpo: id_sped_arquivo
  'GET /api/resumo/participante/:id_arquivo': 'sped',
  'GET /api/relatorio/dossie/:id': 'sped',
  'GET /api/relatorio/excel/:id': 'sped',
  // ⚠️ corpo: id_item (id de linha C170/C100/C190/LMC) — indireto: documento → id_sped_arquivo → rede.
  //    Master V14: além do IDOR, monta UPDATE com nomes de coluna vindos do corpo (risco de SQLi).
  'POST /api/corrigir-item': 'sped',
  'POST /api/corrigir-massa': 'sped',                      // corpo: id_arquivo
  'POST /api/lmc/ajustar-cascata': 'sped',                 // corpo: id_sped
  'POST /api/lmc/ajustar': 'sped',                         // corpo: id_sped
  'POST /api/lmc/ajustar-lote': 'sped',                    // corpo: updates[].id_sped (multi-id)
  'GET /api/lmc/observacoes/:id_sped': 'sped',
  'POST /api/lmc/observacoes': 'sped',                     // corpo: id_sped_arquivo
  'GET /api/lmc/imprimir/:id_sped': 'sped',
  'GET /api/exportar-sped/:id': 'sped',
  'DELETE /api/arquivo/:id': 'sped',
  'POST /api/lmc/optimize': 'sped',                        // corpo: arquivoId
  'POST /api/cte-injector/inject': 'sped',                 // corpo: id_arquivo (lê sped_arquivos → gera saída)
  // ⚠️ Master CRÍTICO: exportarArquivo faz SELECT * FROM efd_contrib_arquivos WHERE id=$1 SEM
  //    filtro de rede/empresa → IDOR cross-tenant REAL. Variante 'contrib' (NÃO 'sped'): o :id é de
  //    efd_contrib_arquivos (id-space próprio), resolvido por efd_contrib_arquivos.id_empresa → rede.
  //    scopeRede aplicado DENTRO de routes/contribuicoesRouter.js (rota de sub-router).
  'GET /api/contribuicoes/exportar/:id': 'contrib',

  // ===================== chave (resolve por chave de NF-e — Task 7) =====================
  'GET /api/mde/xml/:chave_nfe': 'chave',                  // mde_cache WHERE chave_nfe (sem filtro de empresa hoje)
  'GET /api/documentos/nfe-completa/:chave': 'chave',
  'GET /api/conciliacao/itens-nf/:chave': 'chave',

  // ===================== cnpj (resolve por CNPJ — Task 7) =====================
  'GET /api/lmc/tanques-config/:cnpj': 'cnpj',
  'POST /api/lmc/tanques-config': 'cnpj',                  // corpo: cnpj
  'GET /api/lmc/lacres/:cnpj': 'cnpj',
  'POST /api/lmc/lacres': 'cnpj',                          // corpo: cnpj
  'POST /api/cad/credenciadoras': 'cnpj',                  // corpo: credenciadoras[].cnpj (Task 7: rede_id + UNIQUE(rede,cnpj))
  'POST /api/cad/apuracao-e116': 'cnpj',                   // corpo: cnpj (CNPJ da empresa/posto)
  'POST /api/conciliacao/sefaz-csv': 'cnpj',               // corpo: cnpj (cruza c100 da empresa)

  // ===================== lista (list-scoping por rede — Task 5) =====================
  'GET /api/empresas': 'lista',                            // hoje SELECT * FROM empresas (sem filtro) → filtrar por rede
  'GET /api/arquivos': 'lista',                            // hoje todos os arquivos → filtrar via join empresas.rede_id

  // ===================== write (criação; vínculo de tenant firmado na escrita — Task 6) =====================
  'POST /api/upload': 'write',                             // cria/atualiza empresa + sped_arquivos; dedup por cnpj_empresa (write-path IDOR)
  'POST /api/empresas': 'write',                           // cria empresa — deve gravar rede_id do ator
  'POST /api/contribuicoes/upload': 'write',               // cria efd_contrib_arquivos — deve amarrar à rede do ator
};

module.exports = { PUBLICAS, ESCOPO };
