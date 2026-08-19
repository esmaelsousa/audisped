/**
 * regrasFiscaisService.js — Motor GLOBAL de Regras Fiscais (condição → ação).
 *
 * Substitui a regra fiscal hardcoded/triplicada (ex.: "CST ICMS 60/61 ⇒ PIS/COFINS 04")
 * por um cadastro único, com vigência por COMPETÊNCIA do SPED, prioridade, fundamento legal
 * e trilha. Aplicado na injeção (XML→SPED) e na exportação (normalização da emissão).
 *
 * Separação de responsabilidades:
 *   - de_para_xml  → tradução do CÓDIGO do produto por fornecedor (identidade do item).
 *   - regras_fiscais → TRIBUTAÇÃO universal (CST/CFOP/PIS/COFINS) por NCM/CST/operação.
 *
 * Ver PLANO_REGRAS_FISCAIS.md.
 */
const logger = require('../logger');

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------
async function ensureTabelasRegras(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS regras_fiscais (
      id                  SERIAL PRIMARY KEY,
      nome                TEXT NOT NULL,
      descricao           TEXT,
      fundamento_legal    TEXT,
      prioridade          INTEGER NOT NULL DEFAULT 100,
      ativo               BOOLEAN NOT NULL DEFAULT TRUE,
      confianca           TEXT NOT NULL DEFAULT 'media',
      -- 'injecao' | 'export' | 'ambos' — onde a regra é aplicada (cutover seguro por fase)
      escopo_aplicacao    TEXT NOT NULL DEFAULT 'ambos',
      -- Vigência por COMPETÊNCIA do SPED (nunca por data de cadastro)
      dt_ini              DATE NOT NULL DEFAULT '2000-01-01',
      dt_fim              DATE,
      -- CONDIÇÕES (NULL = curinga; AND entre elas)
      ind_oper            CHAR(1),
      ncm_prefix          TEXT,
      cst_icms_origem     TEXT,
      cfop_origem         TEXT,
      tipo_produto        TEXT,
      regime              TEXT,
      id_empresa          INTEGER,
      cnpj_emissor        TEXT,
      uf_origem           CHAR(2),
      cond_extra          JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- AÇÕES (NULL = mantém)
      acao_cst_icms       TEXT,
      acao_cfop           TEXT,
      acao_cst_pis        TEXT,
      acao_cst_cofins     TEXT,
      acao_aliq_icms      NUMERIC(7,4),
      acao_bc_icms_mode   TEXT,
      acao_bc_icms_valor  NUMERIC(15,2),
      flag_zera_icms          BOOLEAN DEFAULT FALSE,
      flag_usar_st_ret        BOOLEAN DEFAULT FALSE,
      flag_soma_ipi_st_custo  BOOLEAN DEFAULT FALSE,
      flag_bloqueia_credito_st BOOLEAN DEFAULT FALSE,
      flag_para_no_match      BOOLEAN DEFAULT TRUE,
      flag_apenas_alerta      BOOLEAN DEFAULT FALSE,
      acao_extra          JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      criado_por          TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS regras_fiscais_aplicacao (
      id            BIGSERIAL PRIMARY KEY,
      id_regra      INTEGER,
      nome_regra    TEXT,
      fundamento    TEXT,
      id_sped_arquivo INTEGER,
      chv_nfe       TEXT,
      num_item      INTEGER,
      origem        TEXT,
      competencia   DATE,
      valores_antes JSONB,
      valores_depois JSONB,
      criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_regras_fiscais_match
    ON regras_fiscais (ativo, ind_oper, prioridade) WHERE ativo = TRUE`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// CSOSN do Simples Nacional: códigos ATÔMICOS de 3 dígitos (não são origem+situação).
const _CSOSN = new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']);
// Recompõe o CST de 3 dígitos preservando o dígito de origem (origem(1)+situação(2)).
// Para CSOSN, recompor por concatenação geraria CST inválido (ex.: '500'+'60' = '560'); usa-se
// origem nacional ('0') como piso. Tratamento regime-aware (CSOSN→CST) fica para a Fase 2 (injeção).
function comporComOrigem(cstAtual, situacao2) {
  const s = String(cstAtual || '').padStart(3, '0');
  const sit = String(situacao2).padStart(2, '0').slice(-2);
  if (_CSOSN.has(s)) return '0' + sit;
  const orig = s.length >= 3 ? s.slice(0, -2) : '0';
  return orig + sit;
}

function snapshot(item) {
  return { cst_icms: item.cst_icms, cfop: item.cfop, cst_pis: item.cst_pis, cst_cofins: item.cst_cofins };
}

function parseCondExtra(ce) {
  if (!ce) return {};
  if (typeof ce === 'object') return ce;
  try { return JSON.parse(ce); } catch (e) { return {}; }
}

function avaliarCondExtra(condExtra, item) {
  const ce = parseCondExtra(condExtra);
  if (ce.cst_origem_list && ce.cst_origem_list.length) {
    const sit = String(item.cst_icms || '').slice(-2);
    if (!ce.cst_origem_list.map(x => String(x).slice(-2)).includes(sit)) return false;
  }
  if (ce.ncm_list && ce.ncm_list.length) {
    if (!ce.ncm_list.some(p => String(item.ncm || '').startsWith(String(p)))) return false;
  }
  if (ce.cfop_list && ce.cfop_list.length) {
    if (!ce.cfop_list.some(p => String(item.cfop || '').startsWith(String(p)))) return false;
  }
  return true;
}

function casa(regra, item, ctx) {
  if (regra.ind_oper && regra.ind_oper !== ctx.ind_oper) return false;
  if (regra.ncm_prefix && !String(item.ncm || '').startsWith(regra.ncm_prefix)) return false;
  if (regra.cst_icms_origem &&
      String(regra.cst_icms_origem).slice(-2) !== String(item.cst_icms || '').slice(-2)) return false;
  if (regra.cfop_origem && !String(item.cfop || '').startsWith(regra.cfop_origem)) return false;
  if (regra.tipo_produto && regra.tipo_produto !== item.tipo_produto) return false;
  if (regra.regime && regra.regime !== ctx.regime_dest) return false;
  if (regra.id_empresa && regra.id_empresa !== ctx.id_empresa) return false;
  if (regra.cnpj_emissor &&
      String(regra.cnpj_emissor).replace(/\D/g, '') !== String(ctx.cnpj_emissor || '').replace(/\D/g, '')) return false;
  if (regra.uf_origem && regra.uf_origem !== ctx.uf_origem) return false;
  return avaliarCondExtra(regra.cond_extra, item);
}

// Compõe o CFOP da ação preservando o GRUPO conforme o CFOP atual do item:
// entrada interna 1xxx ↔ interestadual 2xxx; saída 5xxx ↔ 6xxx. Evita aplicar '1653'
// (interna) numa operação interestadual que deveria ser '2653'.
function comporCfop(cfopAtual, cfopAcao) {
  if (!cfopAcao) return cfopAtual;
  let c = String(cfopAcao);
  const inter = ['2', '3', '6', '7'].includes(String(cfopAtual || '')[0]);
  if (inter && c[0] === '1') c = '2' + c.slice(1);
  else if (inter && c[0] === '5') c = '6' + c.slice(1);
  return c;
}

function aplicarAcoes(regra, item) {
  if (regra.acao_cst_icms)   item.cst_icms   = comporComOrigem(item.cst_icms, regra.acao_cst_icms);
  if (regra.acao_cfop)       item.cfop       = comporCfop(item.cfop, regra.acao_cfop);
  if (regra.acao_cst_pis)    item.cst_pis    = regra.acao_cst_pis;
  if (regra.acao_cst_cofins) item.cst_cofins = regra.acao_cst_cofins;
  if (regra.acao_aliq_icms != null) item.aliq_icms = Number(regra.acao_aliq_icms);
  if (regra.acao_bc_icms_mode)      item._bc_mode = regra.acao_bc_icms_mode;
  if (regra.flag_zera_icms)           { item.vl_icms = 0; item.bc_icms = 0; item.aliq_icms = 0; }
  if (regra.flag_usar_st_ret)         item._usar_st_ret = true;
  if (regra.flag_soma_ipi_st_custo)   item._soma_ipi_st_custo = true;
  if (regra.flag_bloqueia_credito_st) item._bloqueia_credito_st = true;
}

// ---------------------------------------------------------------------------
// Cache + carregamento (1 query por export/injeção, não por item)
// ---------------------------------------------------------------------------
let _cache = {}; // key: `${competencia}|${escopo}`
function invalidarCache() { _cache = {}; }

async function carregarRegras(dbClient, competencia, escopo = 'ambos') {
  let comp = competencia;
  if (!comp || !/^\d{4}-\d{2}-\d{2}$/.test(String(comp))) {
    logger.warn(`[RegrasFiscais] competência inválida/ausente ('${competencia}') — usando piso 2000-01-01`);
    comp = '2000-01-01';
  }
  const key = `${comp}|${escopo}`;
  if (_cache[key]) return _cache[key];
  const { rows } = await dbClient.query(`
    SELECT * FROM regras_fiscais
     WHERE ativo = TRUE AND flag_apenas_alerta = FALSE
       AND (escopo_aplicacao = 'ambos' OR escopo_aplicacao = $2)
       AND dt_ini <= $1 AND (dt_fim IS NULL OR dt_fim >= $1)
     ORDER BY (CASE WHEN id_empresa IS NOT NULL OR cnpj_emissor IS NOT NULL THEN 0 ELSE 1 END),
              prioridade ASC, id ASC`, [comp, escopo]);
  _cache[key] = rows;
  return rows;
}

// Aplica uma LISTA já carregada (caminho síncrono p/ o loop do export com cache quente).
function aplicarRegrasFiscaisComLista(item, regras, ctx = {}) {
  for (const regra of regras) {
    if (!casa(regra, item, ctx)) continue;
    // `antes` é capturado POR REGRA, não uma vez antes do laço: quando 2+ regras casam no mesmo
    // item, cada entrada da trilha tem que mostrar o que AQUELA regra mudou. Com o snapshot único
    // a 2ª regra aparecia mudando algo que a 1ª já tinha mudado — atribuição falsa no relatório.
    const antes = snapshot(item);
    aplicarAcoes(regra, item);
    if (ctx.trilha) ctx.trilha.push({
      id_regra: regra.id, nome: regra.nome, fundamento: regra.fundamento_legal,
      num_item: item.num_item, chv_nfe: ctx.chv_nfe, origem: ctx.origem,
      antes, depois: snapshot(item),
    });
    if (regra.flag_para_no_match) break;
  }
  return item;
}

async function aplicarRegrasFiscais(item, ctx = {}) {
  const regras = await carregarRegras(ctx.dbClient, ctx.competencia, ctx.escopo || 'ambos');
  if (!ctx.trilha) ctx.trilha = [];
  return aplicarRegrasFiscaisComLista(item, regras, ctx);
}

// ---------------------------------------------------------------------------
// Seed das regras de ALTA confiança (idempotente: só insere se a tabela estiver vazia)
// ---------------------------------------------------------------------------
const COLS = ['nome','descricao','fundamento_legal','prioridade','ativo','confianca','escopo_aplicacao','dt_ini','dt_fim','ind_oper','ncm_prefix','cst_icms_origem','cfop_origem','tipo_produto','regime','cnpj_emissor','cond_extra','acao_cst_icms','acao_cfop','acao_cst_pis','acao_cst_cofins','acao_aliq_icms','flag_zera_icms','flag_usar_st_ret','flag_bloqueia_credito_st','flag_para_no_match','flag_apenas_alerta'];

function regra(o) {
  return {
    nome: o.nome, descricao: o.descricao || null, fundamento_legal: o.fundamento || null,
    prioridade: o.prioridade, ativo: o.ativo !== false, confianca: o.confianca || 'alta',
    escopo_aplicacao: o.escopo || 'ambos', dt_ini: o.dt_ini || '2000-01-01', dt_fim: o.dt_fim || null,
    ind_oper: o.ind_oper || null, ncm_prefix: o.ncm_prefix || null, cst_icms_origem: o.cst_icms_origem || null,
    cfop_origem: o.cfop_origem || null, tipo_produto: o.tipo_produto || null, regime: o.regime || null,
    cnpj_emissor: o.cnpj_emissor || null, cond_extra: JSON.stringify(o.cond_extra || {}),
    acao_cst_icms: o.acao_cst_icms || null, acao_cfop: o.acao_cfop || null,
    acao_cst_pis: o.acao_cst_pis || null, acao_cst_cofins: o.acao_cst_cofins || null,
    acao_aliq_icms: o.acao_aliq_icms != null ? o.acao_aliq_icms : null,
    flag_zera_icms: !!o.flag_zera_icms, flag_usar_st_ret: !!o.flag_usar_st_ret,
    flag_bloqueia_credito_st: !!o.flag_bloqueia_credito_st,
    flag_para_no_match: o.flag_para_no_match !== false, flag_apenas_alerta: !!o.flag_apenas_alerta,
  };
}

// Conjunto SEED consolidado (PLANO_REGRAS_FISCAIS.md §6). Alta confiança = ativo; (revisar) = ativo:false.
const SEED = [
  // ---- TRANSVERSAL / COERÇÃO (rede de segurança — vale na injeção E no export) ----
  regra({
    nome: 'Coerção combustível/lubrificante: CST ICMS 60/61 ⇒ PIS/COFINS 04',
    descricao: 'Combustível/lubrificante com ICMS cobrado anteriormente (ST) ou monofásico exige PIS/COFINS CST 04 (revenda a alíquota zero), nunca 07/vazio. Rede de segurança que substitui os 3 hacks.',
    fundamento: 'Lei 9.718/98; Lei 10.485/02; IN RFB 2.121/22 (Tab. 4.3.3)',
    prioridade: 10, escopo: 'ambos', ind_oper: '1', dt_ini: '2000-01-01', // FIX: so SAIDA (revenda). Entrada monofasica preserva cst_pis 73/70 (04 e codigo de saida)
    cond_extra: { cst_origem_list: ['60', '61'] },
    acao_cst_pis: '04', acao_cst_cofins: '04', flag_para_no_match: false,
  }),
  regra({
    nome: 'Coerção combustível/lubrificante: CST ICMS 60/61 ENTRADA ⇒ PIS/COFINS 73',
    descricao: 'Aquisição de combustível/lubrificante monofásico/ST (CST ICMS 60/61) é operação a alíquota zero na ENTRADA → PIS/COFINS CST 73 (aquisição a alíquota zero). Nunca 04 (que é código de SAÍDA/revenda) nem 50 (crédito vedado no monofásico). Espelha a coerção de saída (⇒04). Escopo export p/ não colidir com as regras de injeção.',
    fundamento: 'Lei 9.718/98; Lei 10.485/02; LC 192/2022; IN RFB 2.121/22 (Tab. 4.3.3, CST 73)',
    prioridade: 10, escopo: 'export', ind_oper: '0', dt_ini: '2000-01-01',
    cond_extra: { cst_origem_list: ['60', '61'] },
    acao_cst_pis: '73', acao_cst_cofins: '73', flag_para_no_match: false,
  }),
  // ---- DERIVAÇÃO (injeção; aplicadas na Fase 2 quando o motor entrar na injeção) ----
  regra({
    nome: 'Gasolina/Diesel/Biodiesel monofásico — entrada (CST 61)',
    descricao: 'NCM 2710 (gasolina/diesel). Posto revendedor escritura a entrada como CST 61 (monofásico cobrado anteriormente), PIS/COFINS 04.',
    fundamento: 'Conv. ICMS 199/2022; LC 192/2022; Ato COTEPE 76/22',
    prioridade: 30, escopo: 'injecao', ind_oper: '0', ncm_prefix: '2710', dt_ini: '2023-05-01',
    cond_extra: { cst_origem_list: ['02','10','15','30','53','60','61','70'] },
    acao_cst_icms: '61', acao_cfop: '1653', acao_cst_pis: '04', acao_cst_cofins: '04',
    flag_usar_st_ret: true,
  }),
  regra({
    nome: 'GLP/GNV monofásico — entrada (CST 61)',
    fundamento: 'Conv. ICMS 199/2022 + 15/2023; LC 192/2022',
    prioridade: 31, escopo: 'injecao', ind_oper: '0', ncm_prefix: '2711', dt_ini: '2023-05-01',
    cond_extra: { cst_origem_list: ['02','10','15','30','53','60','61','70'] },
    acao_cst_icms: '61', acao_cfop: '1653', acao_cst_pis: '04', acao_cst_cofins: '04',
    flag_usar_st_ret: true,
  }),
  regra({
    nome: 'Conversão ST: fornecedor CST 10/30/70 ⇒ substituído CST 60 — entrada',
    descricao: 'Mercadoria com ICMS-ST retido pelo fornecedor: o posto (substituído) escritura a entrada como CST 60, sem crédito.',
    fundamento: 'Conv. 142/2018; 110/2007; LC 87/96',
    prioridade: 40, escopo: 'injecao', ind_oper: '0', dt_ini: '2000-01-01',
    cond_extra: { cst_origem_list: ['10','30','70'] },
    acao_cst_icms: '60', flag_zera_icms: true, flag_usar_st_ret: true,
  }),
  regra({
    nome: 'Lubrificantes (NCM 3403) — ST ICMS 60 + PIS/COFINS 04 — entrada',
    fundamento: 'Conv. 110/2007; Lei 10.485/02',
    prioridade: 41, escopo: 'injecao', ind_oper: '0', ncm_prefix: '3403', dt_ini: '2000-01-01',
    acao_cst_icms: '60', acao_cst_pis: '04', acao_cst_cofins: '04',
    flag_usar_st_ret: true, flag_zera_icms: true,
  }),
  regra({
    nome: 'Bloquear crédito de ICMS em CST 60/61 (E110/E210) — entrada',
    fundamento: 'LC 87/96 art.20/33; Conv. 142/2018; 199/2022',
    prioridade: 20, escopo: 'injecao', ind_oper: '0', dt_ini: '2000-01-01',
    cond_extra: { cst_origem_list: ['60', '61'] },
    flag_zera_icms: true, flag_bloqueia_credito_st: true, flag_para_no_match: false,
  }),
  regra({
    nome: 'Saída (revenda) combustível monofásico — CST 61',
    fundamento: 'Conv. 199/2022; Lei 9.718/98',
    prioridade: 85, escopo: 'injecao', ind_oper: '1', ncm_prefix: '2710', dt_ini: '2023-05-01',
    acao_cst_icms: '61', acao_cst_pis: '04', acao_cst_cofins: '04',
  }),
  // ---- (revisar) — entram desativadas; o contador ativa após simular ----
  regra({
    nome: 'Etanol combustível monofásico — entrada (CST 61) (revisar UF)',
    fundamento: 'Conv. ICMS 199/2022; Conv. 15/2023',
    prioridade: 32, escopo: 'injecao', ind_oper: '0', ncm_prefix: '2207', dt_ini: '2023-06-01',
    cond_extra: { cst_origem_list: ['02','10','30','60','61'] },
    acao_cst_icms: '61', acao_cfop: '1653', acao_cst_pis: '04', acao_cst_cofins: '04',
    flag_usar_st_ret: true, ativo: false, confianca: 'media',
  }),
];

async function seedRegrasFiscais(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM regras_fiscais');
  if (rows[0].n > 0) return 0;
  let inseridas = 0;
  for (const r of SEED) {
    const vals = COLS.map(c => r[c]);
    const ph = COLS.map((_, i) => `$${i + 1}`).join(',');
    await pool.query(`INSERT INTO regras_fiscais (${COLS.join(',')}) VALUES (${ph})`, vals);
    inseridas++;
  }
  invalidarCache();
  return inseridas;
}

module.exports = {
  ensureTabelasRegras, seedRegrasFiscais, carregarRegras,
  aplicarRegrasFiscais, aplicarRegrasFiscaisComLista,
  comporComOrigem, invalidarCache,
};
