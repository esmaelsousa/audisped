// backend/scopeRede.js — isolamento por rede (Fase 1). Ver plano 2026-07-19.
const { ROLES_CROSS_TENANT } = require('./authz');

// Marcador de serviço: um CLAIM ASSINADO dedicado no token interno de revalidar/relatorio
// (server.js:6805/6907), NUNCA um email. Email é spoofável (criação de usuário, PUT profile),
// então confiar em user.email === 'sys@local' seria um bypass forjável. O claim `svc` só
// pode existir num token assinado com JWT_SECRET → inforjável sem o segredo.
const SVC_CLAIM = 'validador';
// Email legado do marcador de serviço: bloqueado na criação/edição de usuário para que
// ninguém ocupe esse namespace (defesa em profundidade; o bypass já não depende dele).
const EMAIL_SERVICO_LEGADO = 'sys@local';

function ehBypass(ator, user) {
  if (ator && ROLES_CROSS_TENANT.includes(ator.role)) return true;   // super_admin/staff
  if (user && user.svc === SVC_CLAIM) return true;                   // token de serviço (claim assinado)
  return false;
}

// Emails reservados/ inválidos: bloqueados na criação e edição de usuário.
//   - 'sys@local' (marcador de serviço legado): impede colisão de namespace.
//   - qualquer não-endereço: fecha a porta a identificadores forjados fora do formato email.
// Retorna true se o email NÃO pode ser usado por um usuário humano.
function emailReservado(email) {
  if (typeof email !== 'string') return true;
  const e = email.trim().toLowerCase();
  if (e === EMAIL_SERVICO_LEGADO) return true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return true; // exige local@dominio.tld
  return false;
}

// Campos que carregam o identificador do recurso, por tipo de escopo. São procurados em
// req.params, req.body E req.query (nessa ordem de coleta — a UNIÃO de todos vale), inclusive
// dentro de arrays (ex.: itens[].id_arquivo, updates[].id_sped, mapeamentos[].id_empresa) e de
// arrays de escalares (ex.: ids[]). QUALQUER id referenciado tem que ser da rede do ator.
//   empresa → id_empresa (ou :id que é a própria empresa)
//   sped    → arquivo (direto). Inclui os aliases reais das rotas: id_sped_arquivo/id_sped/
//             id_arquivo/arquivoId/:id, mais a lista ids[] do bulk-delete.
//   chave   → chave de NF-e (:chave_nfe / :chave / corpo)
//   cnpj    → CNPJ do POSTO (empresa). ⚠️ NÃO cobre cad_credenciadoras (o cnpj ali é da
//             CREDENCIADORA/adquirente, não do posto) — ver nota em resolverUmId.
const CAMPOS_ID = {
  empresa: ['id_empresa', 'id'],
  sped:    ['id_sped_arquivo', 'id_sped', 'id_arquivo', 'arquivoId', 'ids', 'id'],
  chave:   ['chave_nfe', 'chave'],
  cnpj:    ['cnpj'],
  // contrib → arquivo EFD-Contribuições (tabela PRÓPRIA efd_contrib_arquivos, NÃO sped_arquivos).
  // Usado só por GET /api/contribuicoes/exportar/:id (o IDOR cross-tenant real do módulo).
  contrib: ['id'],
  // --- resolvers INDIRETOS: o :param/corpo NÃO é uma empresa/arquivo direto; é o id de um
  //     registro-filho que só chega à rede subindo a cadeia real (Fase 1, Onda 3). Tratá-los como
  //     id DIRETO (empresa/sped) resolveria a rede errada e daria 404 fail-closed p/ dono legítimo.
  //   depara   → de_para_xml.id           → id_empresa            → empresas.rede_id
  //   correcao → val_correcoes.id          → id_sped_arquivo       → sped_arquivos → empresa → rede
  depara:   ['id'],
  correcao: ['idCorrecao', 'id'],
  // item → corpo { tipo, id_item }: a TABELA depende de `tipo` (C170/C100/C190/LMC), então este
  //   tipo é resolvido por caminho DEDICADO em redeDoRecurso (não pelo loop genérico de CAMPOS_ID).
  item:     ['id_item'],
};

// SQL por 'tipo' de item de POST /api/corrigir-item. Cada linha-alvo sobe até empresas.rede_id.
// C170/C190 dependem de documentos_c100 (id_documento_c100 → id_sped_arquivo). C100/LMC já têm
// id_sped_arquivo direto. tipo desconhecido → sem SQL → fail-closed (null).
const SQL_ITEM_REDE = {
  C170: `SELECT e.rede_id FROM documentos_itens_c170 i
           JOIN documentos_c100 c ON c.id = i.id_documento_c100
           JOIN sped_arquivos s ON s.id = c.id_sped_arquivo
           JOIN empresas e ON e.id = s.id_empresa WHERE i.id = $1`,
  C100: `SELECT e.rede_id FROM documentos_c100 c
           JOIN sped_arquivos s ON s.id = c.id_sped_arquivo
           JOIN empresas e ON e.id = s.id_empresa WHERE c.id = $1`,
  C190: `SELECT e.rede_id FROM documentos_c190 x
           JOIN documentos_c100 c ON c.id = x.id_documento_c100
           JOIN sped_arquivos s ON s.id = c.id_sped_arquivo
           JOIN empresas e ON e.id = s.id_empresa WHERE x.id = $1`,
  LMC:  `SELECT e.rede_id FROM lmc_movimentacao m
           JOIN sped_arquivos s ON s.id = m.id_sped_arquivo
           JOIN empresas e ON e.id = s.id_empresa WHERE m.id = $1`,
};

// Resolve a rede dona de UM item de corrigir-item, escolhendo a tabela por `tipoItem`.
// Retorna número (rede), ou null quando não existe / tipo desconhecido → fail-closed.
async function resolverItemRede(pool, tipoItem, rawId) {
  const sql = SQL_ITEM_REDE[tipoItem];
  if (!sql || rawId == null) return null;
  const r = await pool.query(sql, [rawId]);
  return r.rows.length ? r.rows[0].rede_id : null;
}

// SQL que liga uma chave de NF-e à(s) rede(s) dona(s). A chave só tem vínculo de tenant por
// onde ela foi ESCRITURADA/CACHEADA: mde_cache.id_empresa, espiao_nfe_cache.id_empresa, ou
// documentos_c100 → sped_arquivos.id_empresa. (nfe_completa é cache GLOBAL sem tenant → NÃO
// serve de binding.) DISTINCT nas redes: 1 rede → ok; 0 → sem binding (fail-closed 404);
// >1 → chave em redes diferentes = ambíguo → fail-closed (nunca serve cross-tenant).
const SQL_CHAVE_REDES = `
  SELECT DISTINCT e.rede_id FROM (
    SELECT id_empresa FROM mde_cache        WHERE regexp_replace(chave_nfe,'[^0-9]','','g') = $1
    UNION
    SELECT id_empresa FROM espiao_nfe_cache WHERE regexp_replace(chave_nfe,'[^0-9]','','g') = $1
    UNION
    SELECT a.id_empresa FROM documentos_c100 c
      JOIN sped_arquivos a ON a.id = c.id_sped_arquivo
      WHERE regexp_replace(c.chv_nfe,'[^0-9]','','g') = $1
  ) src
  JOIN empresas e ON e.id = src.id_empresa`;

// Coleta TODOS os ids candidatos de um tipo, varrendo params/body/query — inclusive dentro de
// arrays de objetos (por campo) e arrays de escalares. Retorna array de valores brutos (dedup).
function coletarIds(req, campos) {
  const fontes = [req.params, req.body, req.query];
  const ids = new Set();
  const addEscalar = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(addEscalar); return; }
    if (typeof v === 'object') return; // objeto aninhado é tratado abaixo, não como id
    ids.add(v);
  };
  for (const src of fontes) {
    if (!src || typeof src !== 'object') continue;
    // 1) campos diretos (escalares OU arrays de escalares, ex.: ids[])
    for (const c of campos) if (src[c] != null) addEscalar(src[c]);
    // 2) arrays de objetos (ex.: itens[].id_arquivo, updates[].id_sped, mapeamentos[].id_empresa,
    //    credenciadoras[].cnpj) — extrai os mesmos campos de cada elemento.
    for (const v of Object.values(src)) {
      if (!Array.isArray(v)) continue;
      for (const el of v) {
        if (el && typeof el === 'object' && !Array.isArray(el)) {
          for (const c of campos) if (el[c] != null) addEscalar(el[c]);
        }
      }
    }
  }
  return [...ids];
}

// Resolve a rede dona de UM id do tipo dado. Retorna a rede (número), ou null quando o id não
// aponta para exatamente uma rede (inexistente, malformado ou ambíguo) → o chamador trata null
// como fail-closed. NUNCA devolve rede quando há dúvida.
async function resolverUmId(pool, tipo, rawId) {
  if (rawId == null) return null;
  if (tipo === 'empresa') {
    const r = await pool.query('SELECT rede_id FROM empresas WHERE id = $1', [rawId]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  if (tipo === 'sped') { // arquivo → empresa → rede
    const r = await pool.query(
      `SELECT e.rede_id FROM sped_arquivos s JOIN empresas e ON e.id = s.id_empresa WHERE s.id = $1`, [rawId]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  if (tipo === 'depara') { // de_para_xml.id → empresa → rede (indireto)
    const r = await pool.query(
      `SELECT e.rede_id FROM de_para_xml d JOIN empresas e ON e.id = d.id_empresa WHERE d.id = $1`, [rawId]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  if (tipo === 'correcao') { // val_correcoes.id → id_sped_arquivo → arquivo → empresa → rede (indireto)
    const r = await pool.query(
      `SELECT e.rede_id FROM val_correcoes v
         JOIN sped_arquivos s ON s.id = v.id_sped_arquivo
         JOIN empresas e ON e.id = s.id_empresa WHERE v.id = $1`, [rawId]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  if (tipo === 'contrib') { // arquivo EFD-Contribuições → empresa → rede
    // efd_contrib_arquivos é tabela distinta de sped_arquivos (id-space próprio) → resolver
    // dedicado. id_empresa PODE ser NULL (upload sem empresa): o JOIN não casa → null (404,
    // fail-closed); super_admin/staff continuam exportando via bypass em scopeRede.
    const r = await pool.query(
      `SELECT e.rede_id FROM efd_contrib_arquivos a JOIN empresas e ON e.id = a.id_empresa WHERE a.id = $1`, [rawId]);
    return r.rows.length ? r.rows[0].rede_id : null;
  }
  if (tipo === 'chave') { // chave NF-e → binding (mde/espiao/c100) → empresa → rede
    const chv = String(rawId).replace(/\D/g, '');
    if (chv.length !== 44) return null;                 // chave malformada → fail-closed
    const r = await pool.query(SQL_CHAVE_REDES, [chv]);
    return r.rows.length === 1 ? r.rows[0].rede_id : null; // 0=sem binding, >1=ambíguo → null
  }
  if (tipo === 'cnpj') { // CNPJ do POSTO → empresas.rede_id
    // ⚠️ cad_credenciadoras: o cnpj do corpo é da CREDENCIADORA (adquirente), NÃO de um posto —
    //    aqui ele NÃO casa com nenhuma empresa → resolve para null (fail-closed). Essa rota precisa
    //    de tenant próprio (rede_id + UNIQUE(rede,cnpj)) antes de ser montada; ver routeScopeRegistry.
    const doc = String(rawId).replace(/\D/g, '');
    if (doc.length < 11) return null;                    // cnpj/cpf malformado → fail-closed
    const r = await pool.query(
      `SELECT DISTINCT rede_id FROM empresas WHERE regexp_replace(cnpj,'[^0-9]','','g') = $1`, [doc]);
    return r.rows.length === 1 ? r.rows[0].rede_id : null; // 0=cnpj não é posto desta base, >1=ambíguo
  }
  throw new Error(`scopeRede: tipo desconhecido '${tipo}'`);
}

// Resolve a rede DONA do recurso pedido.
//   undefined = tipo sem nenhum id identificável (→ 400).
//   null      = recurso inexistente / não resolvível / MÚLTIPLAS redes (→ 404, fail-closed).
//   número    = a única rede dona de TODOS os ids referenciados (→ comparar com a rede do ator).
// Multi-id: se QUALQUER id não existir → null; se os ids abrangerem redes diferentes → null.
// Só devolve uma rede quando TODOS os ids concordam numa única rede.
async function redeDoRecurso(pool, tipo, req) {
  if (tipo === 'item') { // POST /api/corrigir-item: corpo { tipo, id_item } → tabela por tipo → rede
    const body = req.body || {};
    const tipoItem = body.tipo;
    const idItem = body.id_item;
    if (idItem == null || !tipoItem) return undefined; // sem id/tipo identificável → 400
    return await resolverItemRede(pool, tipoItem, idItem); // número | null (fail-closed)
  }
  const campos = CAMPOS_ID[tipo];
  if (!campos) throw new Error(`scopeRede: tipo desconhecido '${tipo}'`);
  const ids = coletarIds(req, campos);
  if (!ids.length) return undefined;
  const redes = new Set();
  for (const rawId of ids) {
    const rede = await resolverUmId(pool, tipo, rawId);
    if (rede == null) return null;         // id inexistente/ambíguo/sem rede → fail-closed
    redes.add(rede);
  }
  return redes.size === 1 ? [...redes][0] : null; // >1 rede → cross-tenant → fail-closed
}

function scopeRede(pool, tipo) {
  return async (req, res, next) => {
    try {
      if (ehBypass(req.ator, req.user)) return next();
      if (!req.ator || req.ator.rede_id == null)
        return res.status(403).json({ erro: 'Sessão sem rede definida.' });
      const redeDona = await redeDoRecurso(pool, tipo, req);
      if (redeDona === undefined) return res.status(400).json({ erro: 'Recurso não identificado.' });
      if (redeDona === null) return res.status(404).json({ erro: 'Recurso não encontrado.' });
      if (redeDona !== req.ator.rede_id) return res.status(403).json({ erro: 'Sem acesso a este recurso.' });
      return next();
    } catch (e) { return res.status(500).json({ erro: 'Falha na verificação de acesso.' }); }
  };
}

module.exports = {
  ehBypass, redeDoRecurso, scopeRede, emailReservado,
  coletarIds, resolverUmId, resolverItemRede, CAMPOS_ID,
  SVC_CLAIM, EMAIL_SERVICO_LEGADO,
};
