/**
 * nfe-completa.js — Extração COMPLETA de uma NF-e (todos os campos, com foco no
 * bloco "Cálculo do Imposto" / ICMSTot) para a aba "Notas Fiscais vs Produtos".
 *
 * Por quê este módulo existe: o SPED Fiscal não carrega vários campos da NFe
 * (monofásico de combustível qBCMonoRet/vICMSMonoRet, vICMSDeson, vFCP, DIFAL,
 * transporte, cobrança, etc.) e o sistema descartava o XML após a injeção. Aqui
 * persistimos o XML/parse na injeção e expomos um inventário agrupado e legível.
 *
 * Saída de parseNfeCompleta(xml):
 *   { grupos: [ { grupo, campos: [ { tag, label_pt, valor, obs } ] } ], destaques: [string], chave }
 */

const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

// ---------------------------------------------------------------------------
// Dicionário de rótulos PT-BR por tag (nome curto da tag, sem caminho).
// ---------------------------------------------------------------------------
const LABELS = {
  // protocolo
  nProt: 'Número do Protocolo', digVal: 'Digest Value', dhRecbto: 'Data/Hora Recebimento',
  chNFe: 'Chave de Acesso', cStat: 'Código do Status', xMotivo: 'Descrição do Status',
  // ide
  cUF: 'UF do Emitente (código)', cNF: 'Código Numérico', natOp: 'Natureza da Operação',
  mod: 'Modelo', serie: 'Série', nNF: 'Número da NF-e', dhEmi: 'Data/Hora de Emissão',
  dEmi: 'Data de Emissão', dhSaiEnt: 'Data/Hora Saída/Entrada', dSaiEnt: 'Data Saída/Entrada',
  tpNF: 'Tipo de Operação', idDest: 'Destino da Operação', cMunFG: 'Município Fato Gerador',
  tpImp: 'Formato do DANFE', tpEmis: 'Tipo de Emissão', cDV: 'Dígito Verificador',
  tpAmb: 'Ambiente', finNFe: 'Finalidade', indFinal: 'Consumidor Final',
  indPres: 'Indicador de Presença', indIntermed: 'Intermediador', procEmi: 'Processo de Emissão',
  verProc: 'Versão do Processo', indPag: 'Forma de Pagamento',
  // emit/dest
  CNPJ: 'CNPJ', CPF: 'CPF', xNome: 'Razão Social / Nome', xFant: 'Nome Fantasia',
  IE: 'Inscrição Estadual', IEST: 'IE Substituto Tributário', IM: 'Inscrição Municipal',
  CNAE: 'CNAE Fiscal', CRT: 'Regime Tributário', indIEDest: 'Indicador IE Destinatário',
  email: 'E-mail', xLgr: 'Logradouro', nro: 'Número', xCpl: 'Complemento', xBairro: 'Bairro',
  cMun: 'Município (código)', xMun: 'Município', UF: 'UF', CEP: 'CEP', cPais: 'País (código)',
  xPais: 'País', fone: 'Telefone',
  // prod
  cProd: 'Código do Produto', cEAN: 'GTIN', cEANTrib: 'GTIN Tributável', xProd: 'Descrição do Produto',
  NCM: 'NCM', CEST: 'CEST', EXTIPI: 'EX TIPI', CFOP: 'CFOP', uCom: 'Unidade Comercial',
  qCom: 'Quantidade Comercial', vUnCom: 'Valor Unitário Comercial', vProd: 'Valor Total do Produto',
  uTrib: 'Unidade Tributável', qTrib: 'Quantidade Tributável', vUnTrib: 'Valor Unitário Tributável',
  vFrete: 'Valor do Frete', vSeg: 'Valor do Seguro', vDesc: 'Valor do Desconto', vOutro: 'Outras Despesas',
  indTot: 'Compõe o Total', xPed: 'Pedido de Compra', nItemPed: 'Item do Pedido', vTotTrib: 'Tributos Aprox. (IBPT)',
  // comb (combustível / ANP)
  cProdANP: 'Código ANP', descANP: 'Descrição ANP', pGLP: '% GLP', pGNn: '% GN Nacional',
  pGNi: '% GN Importado', vPart: 'Valor de Partida', CODIF: 'CODIF', qTemp: 'Qtd a Temperatura',
  pBio: '% Biocombustível', UFCons: 'UF de Consumo', cUFOrig: 'UF de Origem (código)',
  pOrig: '% Originário da UF', indImport: 'Indicador de Importação',
  // ICMS
  orig: 'Origem da Mercadoria', CST: 'CST', CSOSN: 'CSOSN', modBC: 'Modalidade BC ICMS',
  pRedBC: '% Redução BC', vBC: 'Base de Cálculo', pICMS: 'Alíquota ICMS', vICMS: 'Valor do ICMS',
  vICMSDeson: 'ICMS Desonerado', motDesICMS: 'Motivo Desoneração', modBCST: 'Modalidade BC ST',
  pMVAST: '% MVA ST', pRedBCST: '% Redução BC ST', vBCST: 'Base de Cálculo ST', pICMSST: 'Alíquota ICMS ST',
  vICMSST: 'Valor do ICMS ST', vBCFCP: 'BC do FCP', pFCP: '% FCP', vFCP: 'Valor do FCP',
  vBCFCPST: 'BC do FCP ST', pFCPST: '% FCP ST', vFCPST: 'Valor do FCP ST',
  vBCSTRet: 'BC ICMS ST Retido', pST: 'Alíquota Suportada pelo Consumidor Final', vICMSSTRet: 'ICMS ST Retido',
  vBCFCPSTRet: 'BC FCP ST Retido', pFCPSTRet: '% FCP ST Retido', vFCPSTRet: 'FCP ST Retido Ant.',
  pRedBCEfet: '% Redução BC Efetiva', vBCEfet: 'BC Efetiva', pICMSEfet: 'Alíquota Efetiva', vICMSEfet: 'ICMS Efetivo',
  vICMSSubstituto: 'ICMS Substituto', vBCSTDest: 'BC ST UF Destino', vICMSSTDest: 'ICMS ST UF Destino',
  // ICMS monofásico (Conv. ICMS 199/2022) — NÃO existem no SPED
  qBCMono: 'Qtd Tributada (Mono)', adRemICMS: 'Alíquota ad rem ICMS (R$/unid., Mono)', vICMSMono: 'ICMS Monofásico',
  qBCMonoReten: 'Qtd Tributada c/ Retenção (Mono)', adRemICMSReten: 'Alíquota ad rem Retenção (R$/unid., Mono)',
  vICMSMonoReten: 'ICMS Monofásico c/ Retenção', pRedAdRem: '% Redução ad rem', motRedAdRem: 'Motivo Redução ad rem',
  qBCMonoRet: 'Qtd Tributada Retida Anteriormente (Mono)', adRemICMSRet: 'Alíquota ad rem Retida (R$/unid., Mono)',
  vICMSMonoRet: 'ICMS Monofásico Retido Anteriormente', qBCMonoDif: 'Qtd Tributada Diferida (Mono)',
  adRemICMSDif: 'Alíquota ad rem Diferida (R$/unid., Mono)', vICMSMonoDif: 'ICMS Monofásico Diferido',
  // IPI
  cEnq: 'Enquadramento Legal IPI', clEnq: 'Classe de Enquadramento', cSelo: 'Código do Selo',
  qSelo: 'Qtd do Selo', pIPI: 'Alíquota IPI', vIPI: 'Valor do IPI', qUnid: 'Qtd por Unidade', vUnid: 'Valor por Unidade',
  // PIS/COFINS
  pPIS: 'Alíquota PIS', vPIS: 'Valor do PIS', pCOFINS: 'Alíquota COFINS', vCOFINS: 'Valor da COFINS',
  qBCProd: 'Quantidade Vendida (BC)', vAliqProd: 'Alíquota (por unidade)',
  // ICMSTot (Cálculo do Imposto)
  vICMSUFDest: 'ICMS UF Destino (DIFAL)', vICMSUFRemet: 'ICMS UF Remetente (DIFAL)',
  vFCPUFDest: 'FCP UF Destino (DIFAL)', vST: 'Valor Total do ICMS ST', vII: 'Imposto de Importação',
  vIPIDevol: 'IPI Devolvido', vNF: 'Valor Total da NF-e',
  // transp
  modFrete: 'Modalidade do Frete', xEnder: 'Endereço do Transportador', placa: 'Placa', RNTC: 'RNTC',
  qVol: 'Qtd de Volumes', esp: 'Espécie', marca: 'Marca', nVol: 'Numeração', pesoL: 'Peso Líquido',
  pesoB: 'Peso Bruto', vServ: 'Valor do Serviço (frete)', vBCRet: 'BC ICMS Frete', pICMSRet: 'Alíquota ICMS Frete',
  vICMSRet: 'ICMS do Frete', CFOP_frete: 'CFOP do Frete',
  // cobr / pag
  nFat: 'Número da Fatura', vOrig: 'Valor Original', vLiq: 'Valor Líquido', nDup: 'Número da Duplicata',
  dVenc: 'Data de Vencimento', vDup: 'Valor da Duplicata', tPag: 'Meio de Pagamento', vPag: 'Valor do Pagamento',
  vTroco: 'Troco', CNPJPag: 'CNPJ Credenciadora', tBand: 'Bandeira', cAut: 'Autorização',
  // infAdic / resp tec
  infCpl: 'Informações Complementares', infAdFisco: 'Info ao Fisco', xCampo: 'Campo (observação)',
  xTexto: 'Conteúdo', xContato: 'Contato', idCSRT: 'ID CSRT',
};

// Decodificadores (obs) para campos com domínio fixo
const DECODE = {
  tpNF: { '0': 'Entrada', '1': 'Saída' },
  tpAmb: { '1': 'Produção', '2': 'Homologação' },
  tpEmis: { '1': 'Normal', '2': 'Contingência FS', '6': 'SVC-AN', '7': 'SVC-RS' },
  tpImp: { '0': 'Sem DANFE', '1': 'Retrato', '2': 'Paisagem', '3': 'Simplificado', '4': 'NFC-e', '5': 'NFC-e msg eletrônica' },
  idDest: { '1': 'Operação interna', '2': 'Interestadual', '3': 'Exterior' },
  finNFe: { '1': 'NF-e normal', '2': 'Complementar', '3': 'Ajuste', '4': 'Devolução' },
  indFinal: { '0': 'Normal', '1': 'Consumidor final' },
  indPres: { '0': 'Não se aplica', '1': 'Presencial', '2': 'Internet', '3': 'Teleatendimento', '4': 'NFC-e domicílio', '5': 'Presencial fora', '9': 'Não presencial' },
  indPag: { '0': 'À vista', '1': 'A prazo', '2': 'Outros' },
  CRT: { '1': 'Simples Nacional', '2': 'Simples - excesso sublimite', '3': 'Regime Normal', '4': 'MEI' },
  indIEDest: { '1': 'Contribuinte ICMS', '2': 'Isento de IE', '9': 'Não contribuinte' },
  modFrete: { '0': 'Por conta do emitente (CIF)', '1': 'Por conta do destinatário (FOB)', '2': 'Por conta de terceiros', '3': 'Transporte próprio remetente', '4': 'Transporte próprio destinatário', '9': 'Sem frete' },
  orig: { '0': 'Nacional', '1': 'Estrangeira - imp. direta', '2': 'Estrangeira - merc. interno', '3': 'Nacional > 40% imp.', '4': 'Nacional proc. básico', '5': 'Nacional < 40% imp.', '6': 'Estrangeira sem similar', '7': 'Estrangeira merc. interno sem similar', '8': 'Nacional > 70% imp.' },
  tPag: { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito', '05': 'Crédito Loja', '10': 'Vale Alimentação', '11': 'Vale Refeição', '12': 'Vale Presente', '13': 'Vale Combustível', '15': 'Boleto Bancário', '16': 'Depósito Bancário', '17': 'PIX Dinâmico', '18': 'Transferência (Open Finance)', '19': 'Programa de Fidelidade', '90': 'Sem pagamento', '99': 'Outros' },
  CST: {
    '00': 'Tributada integralmente', '10': 'Tributada e com ICMS por ST', '20': 'Com redução de BC',
    '30': 'Isenta/não trib. com ICMS por ST', '40': 'Isenta', '41': 'Não tributada', '50': 'Suspensão',
    '51': 'Diferimento', '60': 'ICMS cobrado anteriormente por ST', '61': 'Tributação monofásica cobrada anteriormente',
    '70': 'Com redução de BC e ICMS por ST', '90': 'Outras',
  },
};
// CST de PIS/COFINS (mesma tabela para ambos)
const CST_PISCOFINS = {
  '01': 'Operação tributável (alíquota normal)', '02': 'Alíquota diferenciada', '03': 'Por unidade de produto',
  '04': 'Monofásica - revenda a alíquota zero', '05': 'ST', '06': 'Alíquota zero', '07': 'Isenta',
  '08': 'Sem incidência', '09': 'Suspensão', '49': 'Outras op. de saída', '99': 'Outras operações',
};
// CSOSN (Simples Nacional — CRT=1), usado no lugar do CST em ICMSSNxxx
const CSOSN = {
  '101': 'Tributada pelo Simples com permissão de crédito', '102': 'Tributada pelo Simples sem permissão de crédito',
  '103': 'Isenção do ICMS no Simples para faixa de receita', '201': 'Tributada com permissão de crédito e ICMS por ST',
  '202': 'Tributada sem permissão de crédito e ICMS por ST', '203': 'Isenção do ICMS no Simples e ICMS por ST',
  '300': 'Imune', '400': 'Não tributada pelo Simples', '500': 'ICMS cobrado anteriormente por ST/antecipação',
  '900': 'Outros',
};

const num = (v) => v === undefined || v === null ? 0 : parseFloat(String(v).replace(',', '.')) || 0;
const asArray = (v) => v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]);

// Acha o nó infNFe independentemente de namespace/empacotamento (nfeProc/NFe/raiz)
function findInfNFe(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.infNFe) return parsed.infNFe;
  for (const k of Object.keys(parsed)) {
    const v = parsed[k];
    if (v && typeof v === 'object') {
      const found = findInfNFe(v);
      if (found) return found;
    }
  }
  return null;
}
function findInfProt(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.infProt) return parsed.infProt;
  for (const k of Object.keys(parsed)) {
    if (k === 'NFe' || k === 'infNFe') continue;
    const v = parsed[k];
    if (v && typeof v === 'object') {
      const found = findInfProt(v);
      if (found) return found;
    }
  }
  return null;
}

// Achata um objeto em campos {tag,label_pt,valor,obs}, preservando o caminho (prefix).
// contexto: 'piscofins' faz o DECODE de CST usar a tabela de PIS/COFINS.
function flatten(obj, prefix, out, ctx) {
  if (obj === undefined || obj === null) return;
  if (typeof obj !== 'object') {
    pushCampo(out, prefix, String(obj), ctx);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$') {
      // atributos: captura só os úteis (Id, versao, nItem, xCampo etc.)
      for (const [ak, av] of Object.entries(v || {})) {
        if (['Id', 'versao', 'nItem', 'xCampo', 'numItem', 'item'].includes(ak)) {
          pushCampo(out, prefix ? `${prefix}@${ak}` : ak, String(av), ctx);
        }
      }
      continue;
    }
    // '_' é o texto do próprio nó (elemento com texto + atributo): herda tag/label/decode do pai
    if (k === '_') { pushCampo(out, prefix, v === null ? '' : String(v), ctx); continue; }
    const tag = prefix ? `${prefix}/${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, tag, out, ctx);
    } else if (Array.isArray(v)) {
      v.forEach((it, i) => flatten(it, `${tag}[${i + 1}]`, out, ctx));
    } else {
      pushCampo(out, tag, v === null ? '' : String(v), ctx);
    }
  }
}

function shortTag(tag) {
  // último segmento do caminho, sem índice [n] e sem @attr
  const seg = String(tag).split('/').pop();
  return seg.replace(/\[\d+\]$/, '').replace(/^@/, '');
}

function pushCampo(out, tag, valor, ctx) {
  const st = shortTag(tag);
  let obs = '';
  if (st === 'CST' && ctx === 'piscofins') obs = CST_PISCOFINS[valor] || '';
  else if (st === 'CSOSN') obs = CSOSN[valor] || '';
  else if (DECODE[st]) obs = DECODE[st][valor] || '';
  // marca campos monofásicos (inexistentes no SPED)
  if (/Mono/.test(st)) obs = (obs ? obs + ' · ' : '') + 'Monofásico (não existe no SPED)';
  out.push({ tag, label_pt: LABELS[st] || st, valor, obs });
}

function grupo(nome, campos) { return { grupo: nome, campos: campos.filter(Boolean) }; }

// Extrai o nó ICMS (variante ICMS00/10/.../61/SN…) de imposto.ICMS.
// Ignora a chave '$' (atributos), que o xml2js insere quando o wrapper tem atributo.
function icmsNode(imposto) {
  if (!imposto || !imposto.ICMS) return { variante: null, node: null };
  const variante = Object.keys(imposto.ICMS).find(k => k !== '$');
  return { variante, node: variante ? imposto.ICMS[variante] : null };
}
// Extrai o nó de PIS/COFINS (PISAliq/PISQtde/PISNT/PISOutr…), ignorando '$' (atributos)
function tribNode(parent) {
  if (!parent) return { variante: null, node: null };
  const variante = Object.keys(parent).find(k => k !== '$');
  return { variante, node: variante ? parent[variante] : null };
}

/**
 * parseNfeCompleta(xml) → { grupos, destaques, chave }
 * Aceita string XML (faz o parse) ou objeto já parseado.
 */
async function parseNfeCompleta(xmlOrParsed) {
  let parsed = xmlOrParsed;
  if (typeof xmlOrParsed === 'string') {
    // stripPrefix: remove prefixos de namespace (ex.: <ns2:infNFe>) p/ não quebrar o parse
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, tagNameProcessors: [xml2js.processors.stripPrefix] });
    parsed = await parser.parseStringPromise(xmlOrParsed);
  }
  const inf = findInfNFe(parsed);
  if (!inf) throw new Error('infNFe não encontrado no XML');
  const prot = findInfProt(parsed);

  const grupos = [];
  const destaques = [];

  // chave: do protocolo ou do atributo Id (sem prefixo "NFe")
  let chave = (prot && prot.chNFe) || (inf.$ && inf.$.Id ? String(inf.$.Id).replace(/^NFe/i, '') : '') || '';

  // Protocolo
  if (prot) {
    const c = []; flatten(prot, '', c);
    grupos.push(grupo('Protocolo de Autorização', c.filter(f => !['xmlns', 'Id'].includes(shortTag(f.tag)))));
  }

  // ide / emit / dest
  if (inf.ide) { const c = []; flatten(inf.ide, '', c); grupos.push(grupo('Identificação (ide)', c)); }
  if (inf.emit) { const c = []; flatten(inf.emit, '', c); grupos.push(grupo('Emitente', c)); }
  if (inf.dest) { const c = []; flatten(inf.dest, '', c); grupos.push(grupo('Destinatário', c)); }

  // Itens (det)
  const dets = asArray(inf.det);
  dets.forEach((det, idx) => {
    // nItem pode vir como atributo ($), chave direta, ou ausente (usa o índice — sempre correto)
    const n = (det.$ && (det.$.nItem || det.$.item)) || det.nItem || (idx + 1);
    const prod = det.prod || {};
    const xprod = prod.xProd || prod.cProd || '';
    // Produto (+ comb/ANP)
    const cp = []; flatten(prod, '', cp);
    grupos.push(grupo(`Item ${n} — Produto: ${xprod}`, cp));
    // Impostos do item
    const imp = det.imposto || {};
    const ci = [];
    const { variante: vIcms, node: nIcms } = icmsNode(imp);
    if (nIcms) { const t = []; flatten(nIcms, 'ICMS', t); ci.push({ _sep: `ICMS (${vIcms || ''})` }, ...t); }
    if (imp.IPI) { const t = []; flatten(imp.IPI, 'IPI', t); ci.push({ _sep: 'IPI' }, ...t); }
    if (imp.II) { const t = []; flatten(imp.II, 'II', t); ci.push({ _sep: 'II' }, ...t); }
    if (imp.PIS) { const { variante: vp, node: np } = tribNode(imp.PIS); const t = []; flatten(np, 'PIS', t, 'piscofins'); ci.push({ _sep: `PIS (${vp || ''})` }, ...t); }
    if (imp.COFINS) { const { variante: vc, node: nc } = tribNode(imp.COFINS); const t = []; flatten(nc, 'COFINS', t, 'piscofins'); ci.push({ _sep: `COFINS (${vc || ''})` }, ...t); }
    if (imp.ICMSUFDest) { const t = []; flatten(imp.ICMSUFDest, 'ICMSUFDest', t); ci.push({ _sep: 'ICMS UF Destino (DIFAL)' }, ...t); }
    // remove os marcadores _sep e injeta como "campos" de cabeçalho leve (label começa com "— ")
    const ciCampos = ci.map(x => x._sep ? { tag: '', label_pt: `— ${x._sep} —`, valor: '', obs: '', _header: true } : x);
    grupos.push(grupo(`Item ${n} — Impostos`, ciCampos));
  });

  // ICMSTot — CÁLCULO DO IMPOSTO (destaque)
  const tot = (inf.total && (inf.total.ICMSTot || inf.total.totNFe || inf.total.Tot)) || null;
  if (tot) {
    const c = []; flatten(tot, '', c);
    grupos.push(grupo('Cálculo do Imposto (ICMSTot)', c));
  }
  // ISSQN / retenções (se houver)
  if (inf.total && inf.total.ISSQNtot) { const c = []; flatten(inf.total.ISSQNtot, '', c); grupos.push(grupo('Totais ISSQN', c)); }
  if (inf.total && inf.total.retTrib) { const c = []; flatten(inf.total.retTrib, '', c); grupos.push(grupo('Retenções de Tributos', c)); }

  // transp / cobr / pag / infAdic
  if (inf.transp) { const c = []; flatten(inf.transp, '', c); grupos.push(grupo('Transporte', c)); }
  if (inf.cobr) { const c = []; flatten(inf.cobr, '', c); grupos.push(grupo('Cobrança (fatura/duplicatas)', c)); }
  if (inf.pag) { const c = []; flatten(inf.pag, '', c); grupos.push(grupo('Pagamento', c)); }
  if (inf.infAdic) { const c = []; flatten(inf.infAdic, '', c); grupos.push(grupo('Informações Adicionais', c)); }
  if (inf.infRespTec) { const c = []; flatten(inf.infRespTec, '', c); grupos.push(grupo('Responsável Técnico', c)); }
  if (inf.autXML) { const c = []; asArray(inf.autXML).forEach((a, i) => flatten(a, `aut[${i + 1}]`, c)); grupos.push(grupo('Autorizados a baixar o XML', c)); }

  // ---- destaques (leitura rápida do auditor) ----
  if (tot) {
    // Monofásico: separa retido anteriormente (CST 61) do próprio (CST 02/15) — conceitos distintos
    if (num(tot.vICMSMonoRet) > 0)
      destaques.push(`Combustível MONOFÁSICO RETIDO ANTERIORMENTE (CST 61): qBCMonoRet ${tot.qBCMonoRet || 0} / vICMSMonoRet R$ ${tot.vICMSMonoRet} (Conv. ICMS 199/2022 — não existe no SPED).`);
    if (num(tot.vICMSMono) > 0)
      destaques.push(`Combustível MONOFÁSICO PRÓPRIO (CST 02/15): qBCMono ${tot.qBCMono || 0} / vICMSMono R$ ${tot.vICMSMono} (Conv. ICMS 199/2022 — não existe no SPED).`);
    if (num(tot.vST) > 0) destaques.push(`Substituição Tributária: vBCST R$ ${tot.vBCST || 0} / vST R$ ${tot.vST}.`);
    if (num(tot.vICMSDeson) > 0) destaques.push(`ICMS desonerado: R$ ${tot.vICMSDeson}.`);
    if (num(tot.vICMSUFDest) > 0 || num(tot.vICMSUFRemet) > 0) destaques.push(`DIFAL: UF Destino R$ ${tot.vICMSUFDest || 0} / UF Remetente R$ ${tot.vICMSUFRemet || 0}.`);
    if (num(tot.vFCP) > 0 || num(tot.vFCPST) > 0) destaques.push(`FCP: próprio R$ ${tot.vFCP || 0} / por ST R$ ${tot.vFCPST || 0}.`);
    const deson = num(tot.vICMSDeson) > 0 ? ` − vICMSDeson R$ ${tot.vICMSDeson} (desoneração reduz o total)` : '';
    destaques.push(`vNF R$ ${tot.vNF || 0} ≈ vProd R$ ${tot.vProd || 0} + vST R$ ${tot.vST || 0} − vDesc R$ ${tot.vDesc || 0}${deson} (+ frete/seguro/outros/IPI/II).`);
  }
  // CST/CSOSN ICMS distintos presentes (cobre Simples Nacional — CSOSN — além do CST)
  const csts = new Set();
  dets.forEach(d => {
    const { node } = icmsNode(d.imposto);
    if (node && node.CST) csts.add(`CST ${node.CST} (${DECODE.CST[node.CST] || '?'})`);
    if (node && node.CSOSN) csts.add(`CSOSN ${node.CSOSN} (${CSOSN[node.CSOSN] || '?'})`);
  });
  if (csts.size) destaques.push(`Tributação ICMS por item: ${[...csts].join(', ')}.`);

  return { grupos, destaques, chave };
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------
async function ensureNfeCompletaTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nfe_completa (
      chv_nfe       varchar(44) PRIMARY KEY,
      xml_content   text,
      parsed_json   jsonb,
      criado_em     timestamp DEFAULT CURRENT_TIMESTAMP,
      atualizado_em timestamp DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Salva (upsert) o XML cru + o parse de uma NFe. A chave é derivada do próprio XML
// (parsed.chave), com chaveHint opcional como fallback. Best-effort: nunca lança.
async function salvarNfeCompleta(pool, xmlString, chaveHint) {
  try {
    if (!xmlString) return false;
    const parsed = await parseNfeCompleta(xmlString);
    const chv = String(parsed.chave || chaveHint || '').replace(/\D/g, '');
    if (chv.length !== 44) return false;
    await pool.query(`
      INSERT INTO nfe_completa (chv_nfe, xml_content, parsed_json, atualizado_em)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (chv_nfe) DO UPDATE
        SET xml_content = EXCLUDED.xml_content,
            parsed_json = EXCLUDED.parsed_json,
            atualizado_em = CURRENT_TIMESTAMP
    `, [chv, xmlString, JSON.stringify(parsed)]);
    return true;
  } catch (e) {
    return false;
  }
}

// Busca a NFe completa pela chave, com fallbacks. Retorna { fonte, nfe } ou { fonte:'sped', nfe:null }.
// fontes: 'persistido' (tabela), 'arquivo' (pasta speds/), 'mde_cache', 'espiao_cache'.
async function buscarNfeCompleta(pool, chave, opts = {}) {
  const chv = String(chave || '').replace(/\D/g, '');
  if (chv.length !== 44) return { fonte: 'sped', nfe: null, motivo: 'chave inválida/ausente' };

  // 1) tabela persistida
  try {
    const r = await pool.query(`SELECT parsed_json FROM nfe_completa WHERE chv_nfe = $1`, [chv]);
    if (r.rows.length && r.rows[0].parsed_json) {
      const nfe = typeof r.rows[0].parsed_json === 'string' ? JSON.parse(r.rows[0].parsed_json) : r.rows[0].parsed_json;
      return { fonte: 'persistido', nfe };
    }
  } catch (e) { /* tabela pode não existir ainda */ }

  // 2) arquivo na pasta speds/ (NFe_<chave>.xml ou *<chave>*.xml)
  try {
    const dir = opts.spedsDir || path.join(__dirname, '..', 'speds');
    if (fs.existsSync(dir)) {
      let alvo = path.join(dir, `NFe_${chv}.xml`);
      if (!fs.existsSync(alvo)) {
        const cand = fs.readdirSync(dir).find(f => f.toLowerCase().endsWith('.xml') && f.includes(chv));
        alvo = cand ? path.join(dir, cand) : null;
      }
      if (alvo && fs.existsSync(alvo)) {
        const xml = fs.readFileSync(alvo, 'utf-8');
        const nfe = await parseNfeCompleta(xml);
        // cacheia para próximas leituras
        if (pool) salvarNfeCompleta(pool, xml, chv).catch(() => {});
        return { fonte: 'arquivo', nfe };
      }
    }
  } catch (e) { /* segue p/ próximo fallback */ }

  // 3) mde_cache / espiao_nfe_cache (xml_content por chave)
  for (const tbl of ['mde_cache', 'espiao_nfe_cache']) {
    try {
      const r = await pool.query(`SELECT xml_content FROM ${tbl} WHERE regexp_replace(chave_nfe,'[^0-9]','','g') = $1 AND xml_content IS NOT NULL LIMIT 1`, [chv]);
      if (r.rows.length && r.rows[0].xml_content) {
        const nfe = await parseNfeCompleta(r.rows[0].xml_content);
        if (pool) salvarNfeCompleta(pool, r.rows[0].xml_content, chv).catch(() => {});
        return { fonte: tbl === 'mde_cache' ? 'mde_cache' : 'espiao_cache', nfe };
      }
    } catch (e) { /* tabela pode não existir */ }
  }

  return { fonte: 'sped', nfe: null, motivo: 'XML não disponível (nota só do SPED)' };
}

module.exports = { parseNfeCompleta, ensureNfeCompletaTable, salvarNfeCompleta, buscarNfeCompleta };
