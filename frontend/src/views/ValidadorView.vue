<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { empresaSelecionada, idArquivoSped, setArquivoInfo, setEmpresaSelecionada } from '../store';
import { ShieldCheck, UploadCloud, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Wand2, Info, Download, ClipboardList } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';

const loading = ref(false);
const erro = ref('');
const resultado = ref(null);
const resultadoId = ref(null);   // id do arquivo (do banco) a que o resultado ATUAL pertence
const filtroBloco = ref('');
const filtroSev = ref('');
const expandido = ref(null);
const buscaErro = ref('');           // filtro de texto (tipo/registro/código) — estilo do painel
const grupoAberto = ref(null);       // regra_id do grupo com ocorrências expandidas
const dicaAberta = ref(null);        // regra_id do grupo com a "dica" (explicação) aberta
const occAberta = ref(null);         // keyErro da ocorrência individual expandida
const detalheAberto = ref(null);     // grupo do relatório "o que foi corrigido" com o detalhe NF-a-NF aberto
const dkey = (bl, rg, i) => `${bl}|${rg}|${i}`;

// --- Seletor empresa → período (igual ao LMC; só arquivos IMPORTADOS no banco) ---
const empresas = ref([]);
const arquivos = ref([]);
const empresaSel = ref(empresaSelecionada.value?.id || null);
const arquivoSel = ref(idArquivoSped.value ? Number(idArquivoSped.value) : null);
const buscaEmpresa = ref('');
const uploadRef = ref(null);
const uploading = ref(false);
const uploadMsg = ref('');

const NOME_BLOCO = {
  '0': 'Bloco 0 — Cadastros', 'C': 'Bloco C — NF-e/NFC-e', 'D': 'Bloco D — CT-e',
  'E': 'Bloco E — Apuração', 'G': 'Bloco G — CIAP', 'H': 'Bloco H — Inventário',
  'K': 'Bloco K — Produção', '1': 'Bloco 1 — Combustíveis/LMC', '9': 'Bloco 9 — Controle',
  'B': 'Bloco B — ISS', '*': 'Estrutural',
};
const nomeBloco = (b) => NOME_BLOCO[b] || ('Bloco ' + b);
const nomeEmpresa = (e) => e ? (e.razao_social || e.nome_empresa || e.nome || e.cnpj || ('Empresa ' + e.id)) : '';
const empresaNome = computed(() => nomeEmpresa(empresas.value.find(e => e.id === empresaSel.value)));

// Busca inteligente: por tokens (sem acento/caixa) em razão social + fantasia, e por dígitos no CNPJ.
const normTxt = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const empresasFiltradas = computed(() => {
  const raw = buscaEmpresa.value.trim();
  if (!raw) return empresas.value;
  const tokens = normTxt(raw).split(/\s+/).filter(Boolean);
  const dig = raw.replace(/\D/g, '');
  return empresas.value.filter(e => {
    const hay = normTxt(`${e.nome_empresa || ''} ${e.nome_fantasia || ''} ${e.razao_social || ''}`);
    const cnpj = String(e.cnpj || '').replace(/\D/g, '');
    const txtOk = tokens.length > 0 && tokens.every(t => hay.includes(t) || cnpj.includes(t));
    const cnpjOk = dig.length >= 2 && cnpj.includes(dig);
    return txtOk || cnpjOk;
  });
});
const fmtPeriodo = (p) => {
  if (!p) return '—';
  const [a, b] = String(p).split('-');
  const f = (d) => (d && d.length === 8) ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}` : d;
  return b ? `${f(a)} a ${f(b)}` : f(a);
};

const authHeader = () => {
  const t = localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const errosFiltrados = computed(() => {
  if (!resultado.value) return [];
  const q = normTxt(buscaErro.value.trim());
  return resultado.value.erros.filter(e =>
    (!filtroBloco.value || e.bloco === filtroBloco.value) &&
    (!filtroSev.value || e.severidade === filtroSev.value) &&
    (!q || normTxt(`${e.titulo || ''} ${e.registro || ''} ${e.regra_id || ''} ${e.refCatalogo || ''}`).includes(q))
  );
});

// Agrupa os erros por TIPO (regra) — estilo do painel: 1 linha por tipo, com contagem, código e dica.
const errosAgrupados = computed(() => {
  const m = new Map();
  for (const e of errosFiltrados.value) {
    let g = m.get(e.regra_id);
    if (!g) { g = { regra_id: e.regra_id, titulo: e.titulo, registro: e.registro, bloco: e.bloco, codigo: e.refCatalogo || '—', severidade: e.severidade, instrucaoERP: e.instrucaoERP, ocorrencias: [] }; m.set(e.regra_id, g); }
    g.ocorrencias.push(e);
    if (e.severidade === 'BLOQ') g.severidade = 'BLOQ'; // grupo é bloqueante se qualquer ocorrência for
  }
  return [...m.values()].sort((a, b) => (a.severidade !== b.severidade ? (a.severidade === 'BLOQ' ? -1 : 1) : b.ocorrencias.length - a.ocorrencias.length));
});

// Categoria de ocorrência (nomenclatura do painel de auditoria), por código; fallback por severidade.
const CATEGORIA_COD = {
  '2890': 'Divergências de Valores', '2075': 'Divergências de Valores', '2951': 'Divergências de Valores', '2800': 'Divergências de Valores', '2481': 'Divergências de Valores', '2023': 'Divergências de Valores', '2033': 'Divergências de Valores',
  '2441': 'Conteúdo Inválido', '2451': 'Conteúdo Inválido',
  '2037': 'Estrutura do Arquivo',
  '2321': 'Outros Alertas', '1003': 'Outros Alertas', '2973': 'Outros Alertas',
};
const categoriaOcorrencia = (g) => CATEGORIA_COD[g.codigo] || (g.severidade === 'BLOQ' ? 'Divergências de Valores' : 'Outros Alertas');
const corCategoria = (g) => {
  const c = categoriaOcorrencia(g);
  if (c === 'Divergências de Valores') return 'bg-lacre/10 text-lacre border-lacre/25';
  if (c === 'Conteúdo Inválido') return 'bg-variacao/10 text-variacao border-variacao/25';
  if (c === 'Estrutura do Arquivo') return 'bg-bronze/10 text-bronze border-bronze/25';
  return 'bg-paper text-risco border-line';
};
function toggleGrupo(k) { grupoAberto.value = grupoAberto.value === k ? null : k; }
function toggleDica(k) { dicaAberta.value = dicaAberta.value === k ? null : k; }
function toggleOcc(e) {
  const k = keyErro(e);
  occAberta.value = occAberta.value === k ? null : k;
  if (occAberta.value === k && e.corrigivel && valoresCorrecao.value[k] === undefined) {
    valoresCorrecao.value = { ...valoresCorrecao.value, [k]: (e.valorSugerido != null && e.valorSugerido !== '') ? String(e.valorSugerido) : '' };
  }
  // COMB-1350-1360-01: pré-preenche a data de aplicação com o 1º dia do período (editável).
  if (occAberta.value === k && e.regra_id === 'COMB-1350-1360-01' && lacreData.value[k] === undefined) {
    lacreData.value = { ...lacreData.value, [k]: primeiroDiaPeriodo() };
  }
  // DOC-0200-CEST-01: carrega os CEST sugeridos pelo NCM do produto ao abrir a ocorrência.
  if (occAberta.value === k && e.regra_id === 'DOC-0200-CEST-01') { carregarCestPorNcm(e); }
}
// Exporta o relatório de inconsistências (agrupado por tipo) em CSV pt-BR (Excel-friendly).
function baixarInconsistencias() {
  const linhas = [['Tipo de ocorrência', 'Registro', 'Ocorrências', 'Código', 'Categoria de ocorrência', 'Severidade']];
  for (const g of errosAgrupados.value) linhas.push([g.titulo, g.registro, g.ocorrencias.length, g.codigo, categoriaOcorrencia(g), g.severidade === 'BLOQ' ? 'Bloqueante' : 'Advertência']);
  const csv = linhas.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `inconsistencias_${resultadoId.value || 'sped'}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// Clicar num card do resumo → filtra a tabela de inconsistências por severidade e rola até ela.
function verErros(sev) {
  filtroSev.value = sev;
  filtroBloco.value = '';
  buscaErro.value = '';
  requestAnimationFrame(() => {
    const el = document.getElementById('tabela-inconsistencias');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function carregarEmpresas() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/empresas`, { headers: authHeader() });
    empresas.value = res.data || [];
  } catch (_) { empresas.value = []; }
}

async function carregarArquivos() {
  arquivos.value = []; arquivoSel.value = null; resultado.value = null;
  if (!empresaSel.value) return;
  try {
    const res = await axios.get(`${API_BASE_URL}/api/arquivos/${empresaSel.value}`, { headers: authHeader() });
    arquivos.value = (res.data || []).sort((a, b) => String(a.periodo_apuracao || '').localeCompare(String(b.periodo_apuracao || '')));
  } catch (_) { arquivos.value = []; }
}

async function analisar() {
  if (!arquivoSel.value) { erro.value = 'Selecione a empresa e o período.'; return; }
  erro.value = ''; loading.value = true; resultado.value = null; expandido.value = null; msgCorr.value = '';
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/analisar/${arquivoSel.value}`, {}, { headers: authHeader() });
    resultado.value = res.data;
    resultadoId.value = arquivoSel.value;
    await carregarCorrecoes();
  } catch (e) {
    erro.value = e.response?.data?.message || ('Erro ao validar: ' + e.message);
  } finally { loading.value = false; }
}

// Importa um SPED novo no banco (REUSA /api/upload, igual ao Analisador) e valida por id.
async function importarSped(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = ''; // permite re-selecionar o mesmo arquivo depois
  if (!file) return;
  if (!confirm(`Importar "${file.name}"?\n\nSe este período já existir no banco, os dados anteriores (inclusive ajustes de LMC) serão substituídos.`)) return;
  uploading.value = true; uploadMsg.value = `Importando ${file.name}…`; erro.value = '';
  try {
    const fd = new FormData();
    fd.append('spedfile', file); // campo EXATO esperado pelo backend
    const res = await axios.post(`${API_BASE_URL}/api/upload`, fd, { headers: authHeader() });
    const { id_sped_arquivo, fileInfo } = res.data;
    // store (ponte p/ outras telas) + seleção da empresa (pode ser NOVA, criada agora)
    setArquivoInfo({ id: id_sped_arquivo, nome: file.name, cnpj: fileInfo?.cnpj_empresa, periodo: fileInfo?.periodo_apuracao });
    setEmpresaSelecionada({ id: fileInfo?.id_empresa, nome_empresa: fileInfo?.nome_empresa, nome_fantasia: fileInfo?.nome_fantasia, cnpj: fileInfo?.cnpj_empresa, uf: fileInfo?.uf });
    await carregarEmpresas();             // recarrega (empresa pode ter sido criada agora)
    buscaEmpresa.value = '';
    empresaSel.value = fileInfo?.id_empresa || null;
    await carregarArquivos();             // zera arquivoSel → por isso o set vem DEPOIS
    arquivoSel.value = id_sped_arquivo;
    uploadMsg.value = '';
    await analisar();
  } catch (e) {
    erro.value = e.response?.data?.message || e.response?.data?.error || ('Erro ao importar: ' + e.message);
    uploadMsg.value = '';
  } finally { uploading.value = false; }
}

function toggle(i) {
  expandido.value = expandido.value === i ? null : i;
  const e = errosFiltrados.value[i];
  if (e && e.corrigivel) {
    const k = keyErro(e);
    if (valoresCorrecao.value[k] === undefined) {
      valoresCorrecao.value = { ...valoresCorrecao.value, [k]: (e.valorSugerido != null && e.valorSugerido !== '') ? String(e.valorSugerido) : '' };
    }
  }
}

const classeLabel = (c) => ({
  'estrutural-seguro': 'Estrutural (corrigível automaticamente)',
  'fiscal-deterministico': 'Fiscal (sugestão; confirmar)',
  'manual': 'Manual / corrigir no ERP',
}[c] || c);

// ===== Correções (overrides que o export aplica; tudo por id do banco) =====
const correcoes = ref([]);          // correções salvas (do banco)
const valoresCorrecao = ref({});    // chave do erro -> valor digitado
const salvando = ref(null);
const msgCorr = ref('');
const keyErro = (e) => `${e.regra_id}|${e.chaveNatural}|${e.campoIdx}`;

// Rótulo legível de uma ocorrência: "NF 588542 · 08/01/2026 · item 1" (enriquecido pelo backend);
// se não for chave de NF (produto 0200 etc.), cai na chave crua. A chave completa fica no tooltip.
function rotuloOcorrencia(c) {
  if (c && c.nf_num) {
    let s = 'NF ' + c.nf_num;
    if (c.nf_data) s += ' · ' + c.nf_data;
    if (c.nf_item) s += ' · item ' + c.nf_item;
    return s;
  }
  return (c && c.chave_natural) || '—';
}

// "O que / por que / como" por TIPO de correção — aparece 1× ao expandir o grupo (não repete em cada linha).
const EXPLICACAO_REGRA = {
  'DOC-C100-VLDOC-01': {
    oque: 'Ajustamos o valor da mercadoria (VL_MERC) da nota.',
    porque: 'O valor informado incluía frete/seguro/outras despesas — que entram no TOTAL da nota, mas não são o valor dos produtos.',
    como: 'Baixamos o VL_MERC até a soma dos itens. O total da nota (VL_DOC) e o imposto ficam preservados.',
  },
  'DOC-C170-ICMSSEMBASE-01': {
    oque: 'Zeramos a alíquota e o ICMS do item (C170).',
    porque: 'Havia alíquota/ICMS informados sem base de cálculo tributável (operação sem débito de ICMS).',
    como: 'ALIQ_ICMS e VL_ICMS do item vão a 0,00; o resto do item é mantido.',
  },
  'DOC-C190-ICMSSEMBASE-01': {
    oque: 'Zeramos a alíquota e o ICMS da consolidação (C190).',
    porque: 'Alíquota/ICMS informados sem base de cálculo tributável.',
    como: 'ALIQ_ICMS e VL_ICMS do C190 vão a 0,00.',
  },
  'DOC-C190-REDBC-01': {
    oque: 'Zeramos a redução de base (VL_RED_BC) do C190.',
    porque: 'Havia redução de base informada sem um CST que comporte redução.',
    como: 'VL_RED_BC vai a 0,00.',
  },
  'DOC-C100-5929-01': {
    oque: 'Removemos o ICMS duplicado da nota CFOP 5929 (espelho de cupom/ECF).',
    porque: 'A venda já foi tributada no cupom fiscal; debitar de novo seria bitributação.',
    como: 'Zeramos o ICMS no C190 e no cabeçalho C100 e reduzimos o débito na apuração (E110).',
  },
  'DOC-C100-SER-01': {
    oque: 'Alinhamos a série do documento (SER) à série contida na chave de acesso.',
    porque: 'A série informada divergia da série embutida na chave — a chave é a identidade oficial da nota.',
    como: 'Ajustamos o campo SER para a série da chave.',
  },
  'DOC-0200-CEST-01': {
    oque: 'Ajuste do CEST do produto (0200).',
    porque: 'O CEST informado não existe na Tabela CEST (Convênio 142/2018).',
    como: 'Você escolhe o CEST correto (ou marca "produto sem ST"); o valor é gravado.',
  },
  'CADASTRO': {
    oque: 'Correção de dado cadastral (Inscrição Estadual / contabilista).',
    porque: 'O valor cadastral estava incorreto ou foi rejeitado pela SEFAZ.',
    como: 'Você digita o valor correto; é aplicado no SPED exportado.',
  },
};
function explicacaoRegra(g) { return EXPLICACAO_REGRA[g && g.regra_id] || null; }
// Motivo CONCRETO de UMA ocorrência (ex.: VLDOC → "R$ 134,08 de seguro estava embutido no valor").
function motivoOcorrencia(c) {
  if (c && c.nf_ajuste_tipo && c.nf_ajuste_valor) return `R$ ${c.nf_ajuste_valor} de ${c.nf_ajuste_tipo} estava embutido no valor da mercadoria`;
  return '';
}

// --- "Corrigir todas as seguras" (lote determinístico: preview → aplicar → desfazer) ---
const previewLote = ref(null);       // resultado do dry-run (preview, não grava)
const showPreviewLote = ref(false);
const corrigindoLote = ref(false);
const loteInfo = ref(null);          // { lote_id, total } do último lote aplicado

async function carregarCorrecoes() {
  if (!resultadoId.value) { correcoes.value = []; return; }
  try {
    const res = await axios.get(`${API_BASE_URL}/api/validador/correcoes/${resultadoId.value}`, { headers: authHeader() });
    correcoes.value = res.data.correcoes || [];
  } catch (_) { correcoes.value = []; }
}

async function salvarCorrecao(e) {
  if (!resultadoId.value) { msgCorr.value = 'Valide um SPED do banco primeiro.'; return; }
  const k = keyErro(e);
  const valor = (valoresCorrecao.value[k] ?? '').toString().trim();
  if (valor === '' && !e.permiteVazio) { msgCorr.value = 'Informe o valor corrigido.'; return; }
  if (e.chaveNatural == null || e.campoIdx == null) { msgCorr.value = 'Este erro não é corrigível por campo.'; return; }
  salvando.value = k; msgCorr.value = '';
  try {
    await axios.post(`${API_BASE_URL}/api/validador/corrigir`, {
      id_sped_arquivo: resultadoId.value, regra_id: e.regra_id, registro: e.registro,
      chave_natural: e.chaveNatural, campo_idx: e.campoIdx,
      valor_original: e.valorAtual, valor_corrigido: valor,
    }, { headers: authHeader() });
    msgCorr.value = 'Correção salva. Clique em "Validar corrigido" para conferir o efeito.';
    await carregarCorrecoes();
  } catch (err) {
    msgCorr.value = err.response?.data?.message || ('Erro ao salvar: ' + err.message);
  } finally { salvando.value = null; }
}

async function removerCorrecao(c) {
  try {
    await axios.delete(`${API_BASE_URL}/api/validador/correcoes/${c.id}`, { headers: authHeader() });
    await carregarCorrecoes();
  } catch (err) { msgCorr.value = err.response?.data?.message || ('Erro ao remover: ' + err.message); }
}

// --- COMB-1350-1360-01: informar o lacre (1360) da bomba → injeta |1360|NUM_LACRE|DAT_APLICACAO| ---
// Insere o registro filho 1360 (via val_correcoes, campo_idx=0 = "inserir filho"; reversível).
const lacreVal = ref({});      // keyErro -> nº do lacre digitado
const lacreData = ref({});     // keyErro -> data de aplicação (DD/MM/AAAA, exibição; editável)
const salvandoLacre = ref(null);
// 1º dia do período do arquivo (DT_INI do 0000) em DD/MM/AAAA — pré-preenche a data (editável).
function primeiroDiaPeriodo() {
  const p = String(resultado.value?.arquivo?.periodo || '').split('-')[0] || '';
  return p.length === 8 ? `${p.slice(0, 2)}/${p.slice(2, 4)}/${p.slice(4, 8)}` : '';
}
// Rótulo da bomba a partir da linha 1350 crua (e.valorAtual): "SERIE · FABRICANTE MODELO".
function bombaLabel(e) {
  const f = String(e.valorAtual || '').split('|');
  const serie = (f[2] || '').trim(), fab = (f[3] || '').trim(), mod = (f[4] || '').trim();
  return [serie, [fab, mod].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || (e.chaveNatural || 'bomba');
}
async function salvarLacre(e) {
  const cnpj = String(resultado.value?.arquivo?.cnpj || '').replace(/\D/g, '');
  const k = keyErro(e);
  const serie = String(e.chaveNatural || '').trim();
  const lacre = (lacreVal.value[k] ?? '').toString().trim();
  const data = (lacreData.value[k] ?? '').toString().replace(/\D/g, ''); // DD/MM/AAAA -> DDMMAAAA
  if (!cnpj) { msgCorr.value = 'CNPJ do arquivo não identificado.'; return; }
  if (!serie) { msgCorr.value = 'Série da bomba não identificada.'; return; }
  if (lacre === '') { msgCorr.value = 'Informe o número do lacre.'; return; }
  if (data.length !== 8 || +data.slice(4, 8) < 2000) { msgCorr.value = 'Informe a data de aplicação no formato DD/MM/AAAA (ano ≥ 2000).'; return; }
  salvandoLacre.value = k; msgCorr.value = '';
  try {
    // O cadastro de lacres é POR CNPJ (registro físico, vale p/ todos os períodos). O endpoint
    // substitui a lista inteira → busca os já cadastrados e mescla esta bomba antes de salvar.
    const atuais = (await axios.get(`${API_BASE_URL}/api/lmc/lacres/${cnpj}`, { headers: authHeader() })).data || [];
    const map = new Map(atuais.map(l => [String(l.serie_bomba).trim(), { serie_bomba: String(l.serie_bomba).trim(), num_lacre: String(l.num_lacre).trim(), dt_aplicacao: String(l.dt_aplicacao || '').replace(/\D/g, '') }]));
    map.set(serie, { serie_bomba: serie, num_lacre: lacre, dt_aplicacao: data });
    await axios.post(`${API_BASE_URL}/api/lmc/lacres`, { cnpj, lacres: [...map.values()] }, { headers: authHeader() });
    e.corrigidoPeloUsuario = true; // feedback imediato; "Validar corrigido" confirma via lmc_lacres
    msgCorr.value = 'Lacre salvo. Clique em "Validar corrigido" para confirmar; o SPED baixado já sai com o 1360.';
  } catch (err) {
    msgCorr.value = err.response?.data?.message || ('Erro ao salvar lacre: ' + err.message);
  } finally { salvandoLacre.value = null; }
}

// --- Correções a aplicar: AGRUPADAS por registro+campo+valor (idênticas viram "×742") ---
const grupoCorrAberto = ref(null);
const CAMPO_NOME_CORR = {
  'C100:12': 'VL_DOC', 'C100:16': 'VL_MERC', 'C100:20': 'VL_OUT_DA',
  'C170:10': 'CST_ICMS', 'C170:11': 'CFOP', 'C170:13': 'VL_BC_ICMS', 'C170:14': 'ALIQ_ICMS', 'C170:15': 'VL_ICMS', 'C170:37': 'COD_CTA',
  'C190:2': 'CST_ICMS', 'C190:3': 'CFOP', 'C190:4': 'ALIQ_ICMS', 'C190:6': 'VL_BC_ICMS', 'C190:7': 'VL_ICMS', 'C190:10': 'VL_RED_BC',
  '0000:10': 'IE', '0100:3': 'CPF', '0100:4': 'CRC', '0400:3': 'COD_NAT',
};
const nomeCampoCorr = (reg, i) => CAMPO_NOME_CORR[`${reg}:${i}`] || ('campo ' + i);
const correcoesAgrupadas = computed(() => {
  const m = new Map();
  for (const c of correcoes.value) {
    const k = `${c.registro}|${c.campo_idx}|${c.valor_corrigido}|${c.regra_id || ''}`;
    let g = m.get(k);
    if (!g) { g = { key: k, registro: c.registro, campo_idx: c.campo_idx, valor_corrigido: c.valor_corrigido, regra_id: c.regra_id || '', itens: [] }; m.set(k, g); }
    g.itens.push(c);
  }
  return [...m.values()].sort((a, b) => b.itens.length - a.itens.length);
});
function toggleGrupoCorr(k) { grupoCorrAberto.value = grupoCorrAberto.value === k ? null : k; }
async function removerGrupoCorrecao(g) {
  if (!confirm(`Remover as ${g.itens.length} correção(ões) de ${g.registro} · ${nomeCampoCorr(g.registro, g.campo_idx)}?`)) return;
  for (const c of g.itens) {
    try { await axios.delete(`${API_BASE_URL}/api/validador/correcoes/${c.id}`, { headers: authHeader() }); } catch (_) {}
  }
  await carregarCorrecoes();
}

// --- Correção direta de cadastro (IE do 0000, contabilista do 0100) ---
// O PVA rejeita IE por divergência de cadastro/SEFAZ (não dá p/ detectar por dígito) e exige CPF/CRC
// do contador. Aqui o usuário digita o valor correto → grava em val_correcoes → o export já aplica.
const cadastro = computed(() => resultado.value?.arquivo?.cadastro || null);
const cadVal = ref({});            // chave do campo -> valor digitado
const salvandoCad = ref(null);
async function salvarCadastro(campo, registro, chave, campoIdx, valorOriginal) {
  if (!resultadoId.value) { msgCorr.value = 'Valide um SPED do banco primeiro (upload avulso não salva correção).'; return; }
  const valor = (cadVal.value[campo] ?? '').toString().trim();
  if (valor === '') { msgCorr.value = 'Informe o valor para ' + campo + '.'; return; }
  if (chave == null) { msgCorr.value = 'Registro sem chave estável — não editável.'; return; }
  salvandoCad.value = campo; msgCorr.value = '';
  try {
    await axios.post(`${API_BASE_URL}/api/validador/corrigir`, {
      id_sped_arquivo: resultadoId.value, regra_id: 'CADASTRO', registro,
      chave_natural: chave, campo_idx: campoIdx,
      valor_original: valorOriginal || '', valor_corrigido: valor,
    }, { headers: authHeader() });
    msgCorr.value = 'Cadastro salvo. Clique em "Validar corrigido" para conferir; o SPED exportado já sai com o valor corrigido.';
    cadVal.value[campo] = '';
    await carregarCorrecoes();
  } catch (err) {
    msgCorr.value = err.response?.data?.message || ('Erro ao salvar: ' + err.message);
  } finally { salvandoCad.value = null; }
}

async function revalidar() {
  if (!resultadoId.value) return;
  erro.value = ''; loading.value = true; expandido.value = null;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/revalidar/${resultadoId.value}`, {}, { headers: authHeader() });
    resultado.value = res.data; // valida o SPED EXPORTADO (auto-ajustes + correções) → erros resolvidos aparecem
  } catch (e) {
    const d = e.response?.data;
    if (d && d.bloqueio === 'CAP_TANQUE_FALTANTE') abrirCapBloqueio(d); // export interno bloqueou → mesmo modal
    else erro.value = d?.message || ('Erro ao revalidar: ' + e.message);
  } finally { loading.value = false; }
}

// Prévia do lote: pergunta ao servidor QUANTAS/QUAIS correções seguras seriam aplicadas (não grava).
async function previewCorrigirTudo() {
  if (!resultadoId.value) { msgCorr.value = 'Valide um SPED do banco primeiro.'; return; }
  corrigindoLote.value = true; msgCorr.value = ''; previewLote.value = null;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/corrigir-lote/${resultadoId.value}`, { dry_run: true }, { headers: authHeader() });
    previewLote.value = res.data;
    if (!res.data.total) msgCorr.value = 'Nenhuma correção segura pendente (tudo já corrigido, ou só há itens de revisão manual).';
    else showPreviewLote.value = true;
  } catch (e) {
    msgCorr.value = e.response?.data?.message || ('Erro ao gerar a prévia: ' + e.message);
  } finally { corrigindoLote.value = false; }
}

// Aplica o lote (grava val_correcoes) → recarrega a lista → re-valida sobre o SPED corrigido.
async function aplicarCorrigirTudo() {
  if (!resultadoId.value) return;
  corrigindoLote.value = true; msgCorr.value = '';
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/corrigir-lote/${resultadoId.value}`, {}, { headers: authHeader() });
    loteInfo.value = res.data.lote_id ? { lote_id: res.data.lote_id, total: res.data.total } : null;
    showPreviewLote.value = false;
    await carregarCorrecoes();
    msgCorr.value = `${res.data.total} correção(ões) segura(s) aplicada(s). Revalidando…`;
    await revalidar();
  } catch (e) {
    msgCorr.value = e.response?.data?.message || ('Erro ao aplicar o lote: ' + e.message);
  } finally { corrigindoLote.value = false; }
}

// Desfaz o último lote inteiro (reverte todas as correções daquele lote_id).
async function desfazerLote() {
  if (!resultadoId.value || !loteInfo.value?.lote_id) return;
  corrigindoLote.value = true; msgCorr.value = '';
  try {
    const res = await axios.delete(`${API_BASE_URL}/api/validador/corrigir-lote/${resultadoId.value}/${encodeURIComponent(loteInfo.value.lote_id)}`, { headers: authHeader() });
    msgCorr.value = `${res.data.desfeitas || 0} correção(ões) do lote desfeita(s). Revalidando…`;
    loteInfo.value = null;
    await carregarCorrecoes();
    await revalidar();
  } catch (e) {
    msgCorr.value = e.response?.data?.message || ('Erro ao desfazer: ' + e.message);
  } finally { corrigindoLote.value = false; }
}

// Bloqueio de export com correção INLINE (ex.: CAP_TANQUE faltante no leiaute 2026).
const capBloqueio = ref(null);   // payload estruturado do 422
const capValores = ref({});      // cod_item -> capacidade (litros) digitada
const capSalvando = ref(false);
const capMsg = ref('');

// Abre o modal de correção inline a partir de um payload de bloqueio (vindo do export OU do revalidar).
function abrirCapBloqueio(d) {
  capBloqueio.value = d;
  const v = {}; (d.itens || []).forEach(ci => { v[ci] = ''; }); capValores.value = v;
}

async function baixarCorrigido() {
  if (!resultadoId.value) return;
  capBloqueio.value = null; capMsg.value = '';
  try {
    const res = await axios.get(`${API_BASE_URL}/api/exportar-sped/${resultadoId.value}`, { headers: { ...authHeader(), Accept: 'application/json' }, responseType: 'blob' });
    const cd = res.headers['content-disposition'] || '';
    const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const filename = (m && decodeURIComponent(m[1])) || `SPED_corrigido_${resultadoId.value}.txt`;
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msgCorr.value = 'SPED corrigido baixado (confira os downloads do navegador).';
  } catch (e) {
    // o backend responde JSON (422 bloqueio / 502) COMO blob → extrai a mensagem estruturada
    let j = null;
    try { const txt = (e.response?.data instanceof Blob) ? await e.response.data.text() : ''; j = txt ? JSON.parse(txt) : null; } catch (_) { /* mantém genérico */ }
    if (j && j.bloqueio === 'CAP_TANQUE_FALTANTE') abrirCapBloqueio(j);
    else msgCorr.value = 'Erro ao exportar: ' + (j?.message || j?.erro || e.message);
  }
}

// Grava as capacidades no nosso sistema (durável — reusado nos próximos meses do CNPJ) e REVALIDA —
// NÃO baixa. O cliente revisa todos os erros e só depois clica em "Baixar SPED corrigido" quando quiser.
async function salvarCapacidades() {
  if (!capBloqueio.value) return;
  const configs = Object.entries(capValores.value)
    .map(([cod_item, capacidade]) => ({ cod_item, capacidade: (capacidade === '' || capacidade === null || isNaN(capacidade)) ? null : Number(capacidade) }))
    .filter(c => c.capacidade != null && c.capacidade > 0);
  if (configs.length !== (capBloqueio.value.itens || []).length) { capMsg.value = 'Informe a capacidade (em litros) de todos os tanques.'; return; }
  capSalvando.value = true; capMsg.value = '';
  try {
    await axios.post(`${API_BASE_URL}/api/lmc/tanques-config`, { cnpj: capBloqueio.value.cnpj, configs }, { headers: authHeader() });
    capBloqueio.value = null;
    msgCorr.value = 'Capacidades salvas. Revise os erros e clique em "Baixar SPED corrigido" quando terminar.';
    await revalidar(); // revalida (o bloqueio some, os erros atualizam) — SEM baixar
  } catch (e) {
    capMsg.value = 'Erro ao salvar capacidades: ' + (e.response?.data?.message || e.message);
  } finally { capSalvando.value = false; }
}

// Relatório "o que foi corrigido": re-exporta (revalidar grava o changelog e o devolve em .alteracoes)
const alteracoes = ref(null);
const loadingAlt = ref(false);
const baixandoPdf = ref(false);
// "O que foi corrigido" = SÓ MOSTRA (read-only) o relatório do que já foi corrigido no ÚLTIMO
// export deste arquivo. NÃO re-exporta / NÃO re-corrige o SPED (antes chamava POST /revalidar, que
// rodava a correção de novo a cada clique). Para re-processar existe o botão "Validar corrigido".
async function verAlteracoes() {
  if (!resultadoId.value) { msgCorr.value = 'Valide um arquivo importado primeiro.'; return; }
  loadingAlt.value = true; erro.value = ''; msgCorr.value = '';
  try {
    const r = await axios.get(`${API_BASE_URL}/api/validador/alteracoes/${resultadoId.value}`, { headers: authHeader() });
    if (r.data?.semExport) {
      // ainda não houve export deste arquivo → não há changelog persistido p/ relatar
      alteracoes.value = null;
      msgCorr.value = 'Ainda não há relatório deste arquivo. Clique em "Baixar SPED corrigido" (ou "Validar corrigido") para gerar o SPED — aí o "o que foi corrigido" fica disponível.';
    } else {
      alteracoes.value = r.data;
    }
  } catch (e) {
    erro.value = e.response?.data?.message || ('Erro ao carregar o relatório: ' + e.message);
  } finally { loadingAlt.value = false; }
}

// Re-exporta (aplicando os skips atuais) e atualiza erros residuais + o relatório. Usado após LIGAR/
// DESLIGAR uma correção — ação explícita que muda o resultado do export. NÃO é o botão "O que foi corrigido".
async function reexportarEAtualizarRelatorio() {
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/revalidar/${resultadoId.value}`, {}, { headers: authHeader() });
    resultado.value = res.data;
    alteracoes.value = res.data.alteracoes || { total: 0, agrupado: [], totais: {} };
  } catch (e) {
    const d = e.response?.data;
    if (d && d.bloqueio === 'CAP_TANQUE_FALTANTE') abrirCapBloqueio(d);
    else erro.value = d?.message || ('Erro ao re-exportar: ' + e.message);
  }
}

// DOC-C170-01 — vincular COD_ITEM órfão a um produto 0200 (lista suspensa, estilo PVA)
const produtos0200 = ref([]);
const loadingProds = ref(false);
const vincSel = ref({});        // keyErro -> cod_destino selecionado
const salvandoVinc = ref(null);
async function carregarProdutos0200() {
  if (produtos0200.value.length || loadingProds.value || !resultadoId.value) return;
  loadingProds.value = true;
  try {
    const r = await axios.get(`${API_BASE_URL}/api/validador/produtos-0200/${resultadoId.value}`, { headers: authHeader() });
    produtos0200.value = r.data.produtos || [];
  } catch (e) { erro.value = 'Erro ao carregar produtos (0200): ' + (e.response?.data?.message || e.message); }
  finally { loadingProds.value = false; }
}
async function vincularCodItem(e) {
  const dest = vincSel.value[keyErro(e)];
  if (!dest) return;
  salvandoVinc.value = keyErro(e);
  try {
    await axios.post(`${API_BASE_URL}/api/validador/cod-item-map`, { id_sped_arquivo: resultadoId.value, cod_origem: e.valorAtual, cod_destino: dest }, { headers: authHeader() });
    await analisar(); // re-analisa → o erro do item passa a aparecer como "✓ corrigido por você"
  } catch (err) { erro.value = err.response?.data?.message || ('Erro ao vincular: ' + err.message); }
  finally { salvandoVinc.value = null; }
}

// DOC-0200-CEST-01 — lista suspensa de CEST (sugeridos pelo NCM do produto + "buscar em todos")
const cestOpcoes = ref({});       // keyErro -> [{cest, cest_fmt, descricao, segmento}]
const cestSel = ref({});          // keyErro -> cest selecionado (7 díg)
const cestBusca = ref({});        // keyErro -> termo de busca
const cestBuscaAberta = ref({});  // keyErro -> bool (mostra o campo "buscar em todos")
const cestSemST = ref({});        // keyErro -> bool (produto sem ST → salva CEST vazio)
const carregandoCest = ref({});   // keyErro -> bool
const salvandoCest = ref(null);
async function carregarCestPorNcm(e) {
  const k = keyErro(e);
  if (cestOpcoes.value[k] !== undefined || carregandoCest.value[k]) return; // já carregado
  carregandoCest.value = { ...carregandoCest.value, [k]: true };
  try {
    const r = await axios.get(`${API_BASE_URL}/api/validador/cest-sugeridos`, { params: { ncm: e.ncm || '' }, headers: authHeader() });
    cestOpcoes.value = { ...cestOpcoes.value, [k]: r.data || [] };
  } catch (_) { cestOpcoes.value = { ...cestOpcoes.value, [k]: [] }; }
  finally { carregandoCest.value = { ...carregandoCest.value, [k]: false }; }
}
async function buscarCest(e) {
  const k = keyErro(e);
  const q = (cestBusca.value[k] || '').trim();
  if (q.length < 2) { msgCorr.value = 'Digite ao menos 2 caracteres para buscar.'; return; }
  carregandoCest.value = { ...carregandoCest.value, [k]: true }; msgCorr.value = '';
  try {
    const r = await axios.get(`${API_BASE_URL}/api/validador/cest-sugeridos`, { params: { q }, headers: authHeader() });
    cestOpcoes.value = { ...cestOpcoes.value, [k]: r.data || [] };
    if (!(r.data || []).length) msgCorr.value = `Nenhum CEST encontrado para "${q}".`;
  } catch (_) { cestOpcoes.value = { ...cestOpcoes.value, [k]: [] }; }
  finally { carregandoCest.value = { ...carregandoCest.value, [k]: false }; }
}
async function salvarCest(e) {
  if (!resultadoId.value) { msgCorr.value = 'Valide um SPED do banco primeiro.'; return; }
  const k = keyErro(e);
  const semST = !!cestSemST.value[k];
  const valor = semST ? '' : String(cestSel.value[k] || '').trim();
  if (!semST && valor === '') { msgCorr.value = 'Selecione um CEST na lista ou marque "produto sem ST".'; return; }
  salvandoCest.value = k; msgCorr.value = '';
  try {
    await axios.post(`${API_BASE_URL}/api/validador/corrigir`, {
      id_sped_arquivo: resultadoId.value, regra_id: e.regra_id, registro: '0200',
      chave_natural: e.chaveNatural, campo_idx: 13, valor_original: e.valorAtual, valor_corrigido: valor,
    }, { headers: authHeader() });
    msgCorr.value = 'CEST salvo. Clique em "Validar corrigido" para conferir; o SPED baixado já sai corrigido.';
    await carregarCorrecoes();
  } catch (err) {
    msgCorr.value = err.response?.data?.message || ('Erro ao salvar CEST: ' + err.message);
  } finally { salvandoCest.value = null; }
}

// Relatório consolidado em PDF (para enviar à contabilidade / setor fiscal).
// Busca via axios como BLOB (com Authorization) para conseguir TRATAR erro: se o export interno
// abortar (422 CAP_TANQUE / 502), o backend responde JSON — aqui mostramos a mensagem em vez de
// o navegador engolir o download em silêncio ou navegar para fora do app (bug do <a href> anterior).
async function baixarRelatorioPdf() {
  if (!resultadoId.value) { msgCorr.value = 'Valide um arquivo importado primeiro.'; return; }
  baixandoPdf.value = true;
  msgCorr.value = 'Gerando o relatório PDF…';
  try {
    const res = await axios.get(`${API_BASE_URL}/api/validador/relatorio-correcoes/${resultadoId.value}`, {
      headers: authHeader(), responseType: 'blob',
    });
    // nome do arquivo vindo do Content-Disposition (fallback genérico)
    const cd = res.headers['content-disposition'] || '';
    const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const filename = (m && decodeURIComponent(m[1])) || `Correcoes_SPED_${resultadoId.value}.pdf`;
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msgCorr.value = 'Relatório PDF baixado (confira os downloads do navegador).';
  } catch (e) {
    // o backend pode ter respondido um JSON de erro (422/502) COMO blob — extrai a mensagem real
    let msg = e.message;
    try {
      const txt = (e.response?.data instanceof Blob) ? await e.response.data.text() : '';
      const j = txt ? JSON.parse(txt) : null;
      msg = j?.message || j?.erro || txt || msg;
    } catch (_) { /* mantém msg genérica */ }
    msgCorr.value = 'Erro ao gerar o relatório: ' + msg;
  } finally { baixandoPdf.value = false; }
}

// Fase B — ligar/desligar correções. Só fiscais/injeções; estruturais sempre aplicadas.
const EXCLUIVEIS = new Set(['INV-E116-01', 'CAD-0150-08', 'COMB-1350-1360-01', 'COMB-CST-01', 'DOC-C170-CFOP-01', 'USO-CONSUMO-X90']);
const LABEL_REGRA = { 'INV-E116-01': 'Injetar E116 (ICMS a recolher)', 'CAD-0150-08': '0150 da credenciadora (1601)', 'COMB-1350-1360-01': 'Injetar lacres (1360)', 'COMB-CST-01': 'CST 61→60 (pré-monofásico)', 'DOC-C170-CFOP-01': 'Corrigir CFOP de entrada', 'USO-CONSUMO-X90': 'Uso/consumo → CST x90', 'DOC-C100-SER-01': 'Série do C100 = série da chave', 'DOC-C100-5929-01': 'CFOP 5929 espelho de ECF (ICMS duplicado)' };
function rotuloRegra(r) { return LABEL_REGRA[r] || r; }
// chave de exclusão: 0150 é por credenciadora (it.chave); as demais desligam a regra toda ('').
function chaveSkip(it) { return it.regraId === 'CAD-0150-08' ? (it.chave || '') : ''; }
async function toggleSkip(regraId, chave, ativo) {
  if (!resultadoId.value) return;
  if (ativo && regraId !== 'CAD-0150-08' && !confirm('Desligar esta correção afeta TODAS as ocorrências desse tipo neste arquivo. O erro pode voltar no PVA. Continuar?')) return;
  loadingAlt.value = true;
  try {
    await axios.post(`${API_BASE_URL}/api/validador/skip`, { id_sped_arquivo: resultadoId.value, regra_id: regraId, chave: chave || '', ativo }, { headers: authHeader() });
    await reexportarEAtualizarRelatorio(); // re-exporta (reflete o skip) e atualiza relatório + erros residuais
  } catch (e) {
    erro.value = e.response?.data?.message || ('Erro ao alterar a correção: ' + e.message);
  } finally { loadingAlt.value = false; }
}

onMounted(async () => {
  await carregarEmpresas();
  const storeArq = idArquivoSped.value ? Number(idArquivoSped.value) : null;
  if (empresaSel.value) {
    await carregarArquivos();
    if (storeArq && arquivos.value.some(a => a.id === storeArq)) { arquivoSel.value = storeArq; await analisar(); }
  }
});
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Cabeçalho -->
    <div class="flex items-center gap-3">
      <div class="w-11 h-11 rounded-md bg-bronze/10 flex items-center justify-center text-bronze">
        <ShieldCheck class="w-6 h-6" :stroke-width="1.7" />
      </div>
      <div>
        <h1 class="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">Validador de SPED Fiscal</h1>
        <p class="text-[13px] text-risco">Selecione um SPED importado, valide todos os blocos, corrija e baixe o arquivo corrigido.</p>
      </div>
    </div>

    <!-- Seletor empresa → período (só arquivos do banco) -->
    <div class="bg-sheet rounded-md border border-line card-shadow p-5">
      <div class="mb-3">
        <label class="text-[11px] uppercase tracking-wide text-risco font-medium">Buscar empresa</label>
        <div class="relative mt-1">
          <input v-model="buscaEmpresa" type="text" placeholder="CNPJ, razão social ou nome fantasia…"
            class="w-full bg-sheet border border-line rounded-md text-[13px] text-ink px-3 py-2 pr-8 outline-none focus:border-bronze transition-colors" />
          <button v-if="buscaEmpresa" @click="buscaEmpresa = ''" type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-risco hover:text-ink transition-colors">✕</button>
        </div>
        <p v-if="buscaEmpresa" class="text-[11px] text-risco mt-1">{{ empresasFiltradas.length }} de {{ empresas.length }} empresa(s)</p>
      </div>
      <div class="grid sm:grid-cols-[2fr_1.5fr_auto] gap-3 items-end">
        <div>
          <label class="text-[11px] uppercase tracking-wide text-risco font-medium">Empresa</label>
          <select v-model="empresaSel" @change="carregarArquivos" class="mt-1 w-full bg-sheet border border-line rounded-md text-[13px] text-ink px-3 py-2 outline-none focus:border-bronze transition-colors">
            <option :value="null">— selecione —</option>
            <option v-for="e in empresasFiltradas" :key="e.id" :value="e.id">{{ nomeEmpresa(e) }} · {{ e.cnpj }}</option>
          </select>
        </div>
        <div>
          <label class="text-[11px] uppercase tracking-wide text-risco font-medium">Período (SPED)</label>
          <select v-model="arquivoSel" :disabled="!arquivos.length" class="mt-1 w-full bg-sheet border border-line rounded-md text-[13px] text-ink px-3 py-2 outline-none focus:border-bronze transition-colors disabled:bg-paper">
            <option :value="null">— selecione —</option>
            <option v-for="a in arquivos" :key="a.id" :value="a.id">{{ a.periodo_apuracao }}</option>
          </select>
        </div>
        <UiButton @click="analisar" :disabled="loading || !arquivoSel" title="Valida o arquivo ORIGINAL importado — mostra os erros como estão hoje, antes das correções." class="justify-center disabled:opacity-50 disabled:cursor-not-allowed">
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><ShieldCheck v-else class="w-4 h-4" :stroke-width="1.8" />
          {{ loading ? 'Validando…' : 'Validar este SPED' }}
        </UiButton>
      </div>
      <div class="flex items-center gap-3 mt-3 pt-3 border-t border-line flex-wrap">
        <input ref="uploadRef" type="file" accept=".txt,.TXT" class="hidden" @change="importarSped" />
        <UiButton variant="ghost" @click="uploadRef && uploadRef.click()" :disabled="uploading" class="disabled:opacity-50">
          <Loader2 v-if="uploading" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><UploadCloud v-else class="w-4 h-4 text-risco" :stroke-width="1.8" />
          {{ uploading ? 'Importando…' : 'Importar SPED (.txt)' }}
        </UiButton>
        <span v-if="uploadMsg" class="text-[12px] text-bronze font-medium">{{ uploadMsg }}</span>
        <span v-else class="text-[11px] text-risco">Importa um SPED novo no banco (como o Analisador) e já valida. Ou selecione um já importado acima.</span>
      </div>
    </div>

    <div v-if="erro" class="bg-lacre/[0.06] border border-lacre/25 text-lacre text-[13px] rounded-md p-4">{{ erro }}</div>
    <div v-if="loading" class="text-center text-risco text-[13px] py-10"><Loader2 class="w-6 h-6 animate-spin inline" :stroke-width="1.8" /> Validando o SPED…</div>

    <template v-if="resultado && !loading">
      <!-- Identificação -->
      <div class="bg-sheet rounded-md border border-line card-shadow p-5">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 class="font-display text-[16px] font-semibold text-ink">{{ empresaNome || resultado.arquivo?.cnpj || 'Empresa' }}</h2>
          <span v-if="resultado.validadoSobre === 'exportado'" class="text-[10px] font-medium text-conforme bg-conforme/10 border border-conforme/25 px-2 py-1 rounded-md">✓ validado sobre o SPED corrigido</span>
        </div>
        <div class="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
          <span class="text-risco">CNPJ: <b class="font-mono text-ink">{{ resultado.arquivo?.cnpj || '—' }}</b></span>
          <span class="text-risco">Período: <b class="font-mono text-ink">{{ fmtPeriodo(resultado.arquivo?.periodo) }}</b></span>
          <span class="text-risco">Leiaute: <b class="font-mono text-ink">{{ resultado.arquivo?.versao || '—' }}</b></span>
          <span class="text-risco">Linhas: <b class="font-mono text-ink">{{ resultado.arquivo?.totalLinhas?.toLocaleString('pt-BR') }}</b></span>
          <span class="text-risco text-[12px]">Arquivo: {{ resultado.arquivo?.nome || '—' }}</span>
        </div>
      </div>

      <!-- Métricas -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button type="button" @click="verErros('')" class="w-full bg-sheet p-4 rounded-md border card-shadow text-center transition-all hover:shadow-md" :class="filtroSev === '' ? 'border-bronze/50 ring-1 ring-bronze/30' : 'border-line'">
          <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Ocorrências</p>
          <p class="text-[26px] font-display font-semibold text-ink">{{ resultado.resumo.total }}</p>
          <p class="text-[9px] text-risco/70">clique p/ ver todas</p>
        </button>
        <button type="button" @click="verErros('BLOQ')" :disabled="!resultado.resumo.bloqueantes" class="w-full p-4 rounded-md border card-shadow text-center transition-all hover:shadow-md disabled:cursor-default disabled:hover:shadow-none" :class="[resultado.resumo.bloqueantes ? 'bg-lacre/[0.06] border-lacre/25' : 'bg-sheet border-line', filtroSev === 'BLOQ' ? 'ring-1 ring-lacre/40 border-lacre/50' : '']">
          <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Bloqueantes</p>
          <p class="text-[26px] font-display font-semibold" :class="resultado.resumo.bloqueantes ? 'text-lacre' : 'text-ink'">{{ resultado.resumo.bloqueantes }}</p>
          <p v-if="resultado.resumo.bloqueantes" class="text-[9px] text-lacre/80 font-medium">clique p/ ver quais</p>
        </button>
        <button type="button" @click="verErros('ADV')" :disabled="!resultado.resumo.advertencias" class="w-full p-4 rounded-md border card-shadow text-center transition-all hover:shadow-md disabled:cursor-default disabled:hover:shadow-none" :class="[resultado.resumo.advertencias ? 'bg-variacao/[0.06] border-variacao/25' : 'bg-sheet border-line', filtroSev === 'ADV' ? 'ring-1 ring-variacao/40 border-variacao/50' : '']">
          <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Advertências</p>
          <p class="text-[26px] font-display font-semibold text-variacao">{{ resultado.resumo.advertencias }}</p>
          <p v-if="resultado.resumo.advertencias" class="text-[9px] text-variacao/80 font-medium">clique p/ ver quais</p>
        </button>
        <div class="bg-sheet p-4 rounded-md border border-line card-shadow text-center">
          <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Regras executadas</p>
          <p class="text-[26px] font-display font-semibold text-ink">{{ resultado.resumo.regrasExecutadas }}</p>
        </div>
      </div>

      <!-- Cobertura por bloco (o "X") -->
      <div class="bg-sheet rounded-md border border-line card-shadow p-5">
        <p class="text-[11px] uppercase tracking-wide font-medium text-risco mb-3">Cobertura por bloco</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="b in resultado.resumo.blocosPresentes" :key="b"
            @click="filtroBloco = filtroBloco === b ? '' : b"
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border flex items-center gap-1.5 transition-colors"
            :class="[
              filtroBloco === b ? 'ring-2 ring-bronze/50' : '',
              (resultado.porBloco[b]?.bloqueantes) ? 'bg-lacre/[0.06] border-lacre/25 text-lacre'
              : (resultado.porBloco[b]?.erros) ? 'bg-variacao/[0.06] border-variacao/25 text-variacao'
              : 'bg-conforme/[0.06] border-conforme/25 text-conforme']">
            <component :is="resultado.porBloco[b]?.erros ? AlertTriangle : CheckCircle2" class="w-3.5 h-3.5" :stroke-width="1.7" />
            {{ nomeBloco(b) }}<span v-if="resultado.porBloco[b]?.erros" class="font-mono"> · {{ resultado.porBloco[b].erros }}</span>
          </button>
        </div>
      </div>

      <!-- Bloqueio de exportação com correção INLINE (ex.: CAP_TANQUE faltante no leiaute 2026) -->
      <div v-if="capBloqueio" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" @click.self="capBloqueio = null">
        <div class="bg-sheet rounded-lg border border-line shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div class="p-5 border-b border-line flex items-start gap-3">
            <AlertTriangle class="w-5 h-5 text-lacre shrink-0 mt-0.5" :stroke-width="1.8" />
            <div>
              <h3 class="font-display text-[15px] font-semibold text-ink">Falta a capacidade dos tanques</h3>
              <p class="text-[12px] text-risco mt-1">{{ capBloqueio.resumo }}</p>
            </div>
          </div>
          <div class="p-5 space-y-4">
            <p class="text-[12px] text-ink/80">Informe a <b>capacidade total (em litros)</b> de cada tanque. Fica salvo (e reaproveitado nos próximos meses deste CNPJ); depois revise os erros e clique em <b>Baixar SPED corrigido</b> quando terminar.</p>
            <div class="space-y-2">
              <div v-for="ci in capBloqueio.itens" :key="ci" class="flex items-center gap-3">
                <label class="text-[12px] text-ink font-medium w-52 truncate" :title="capBloqueio.nomes?.[ci] || ('Produto ' + ci)">{{ capBloqueio.nomes?.[ci] || ('Produto ' + ci) }} <span class="text-[10px] text-risco font-mono">(cód. {{ ci }})</span></label>
                <input v-model="capValores[ci]" type="number" min="0" step="0.001" placeholder="ex.: 15000"
                  class="h-9 flex-1 text-[13px] bg-paper border border-line rounded-md px-3 font-mono text-ink outline-none focus:border-bronze transition-colors" />
                <span class="text-[11px] text-risco">L</span>
              </div>
            </div>
            <p v-if="capMsg" class="text-[12px] text-lacre">{{ capMsg }}</p>
            <div class="rounded-md bg-paper border border-line p-3">
              <p class="text-[11px] text-risco"><b>Prefere corrigir no ERP?</b> {{ capBloqueio.instrucaoErp }}</p>
            </div>
            <details class="text-[11px] text-risco">
              <summary class="cursor-pointer select-none">Ver detalhe técnico</summary>
              <p class="mt-2 leading-relaxed">{{ capBloqueio.message }}</p>
            </details>
          </div>
          <div class="p-5 border-t border-line flex items-center justify-end gap-3">
            <button @click="capBloqueio = null" class="text-[12px] text-risco hover:text-ink font-medium">Cancelar</button>
            <UiButton @click="salvarCapacidades" :disabled="capSalvando" class="disabled:opacity-50">
              <Loader2 v-if="capSalvando" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><CheckCircle2 v-else class="w-4 h-4" :stroke-width="1.8" /> Salvar capacidades
            </UiButton>
          </div>
        </div>
      </div>

      <!-- Ações de correção -->
      <div v-if="resultadoId" class="bg-sheet rounded-md border border-line card-shadow p-5 space-y-3">
        <div class="flex items-center gap-3 flex-wrap">
          <UiButton @click="baixarCorrigido" title="Gera e baixa o .txt já corrigido (auto-ajustes + suas correções + ajustes do LMC) para enviar ao PVA.">
            <UploadCloud class="w-4 h-4 rotate-180" :stroke-width="1.8" /> Baixar SPED corrigido
          </UiButton>
          <UiButton variant="ghost" @click="revalidar" :disabled="loading" title="Valida a versão já corrigida do SPED (com suas correções e os ajustes do LMC aplicados) — os erros resolvidos deixam de aparecer." class="disabled:opacity-50">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><CheckCircle2 v-else class="w-4 h-4" :stroke-width="1.8" /> Validar corrigido
          </UiButton>
          <UiButton @click="previewCorrigirTudo" :disabled="corrigindoLote || loading" title="Aplica automaticamente as correções fiscais SEGURAS (determinísticas) num lote reversível. NÃO corrige estoque de LMC — isso é no módulo LMC." class="disabled:opacity-50">
            <Loader2 v-if="corrigindoLote" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><Wand2 v-else class="w-4 h-4" :stroke-width="1.8" /> Corrigir SPED
          </UiButton>
          <button v-if="loteInfo" @click="desfazerLote" :disabled="corrigindoLote" class="text-[11px] text-lacre hover:opacity-80 font-medium disabled:opacity-50">desfazer último lote ({{ loteInfo.total }})</button>
          <UiButton variant="ghost" @click="verAlteracoes" :disabled="loadingAlt" title="Mostra o relatório do que o sistema alterou no último SPED corrigido/baixado." class="disabled:opacity-50">
            <Loader2 v-if="loadingAlt" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><ClipboardList v-else class="w-4 h-4" :stroke-width="1.8" /> O que foi corrigido
          </UiButton>
          <span v-if="msgCorr" class="text-[12px] font-medium" :class="(msgCorr.startsWith('Erro') || msgCorr.startsWith('Informe') || msgCorr.startsWith('Valide')) ? 'text-lacre' : 'text-conforme'">{{ msgCorr }}</span>
        </div>
        <div v-if="correcoes.length" class="border border-line rounded-md overflow-hidden">
          <div class="px-3 py-2 bg-paper text-[11px] uppercase tracking-wide font-medium text-risco flex items-center gap-2 flex-wrap">
            <span>Correções a aplicar no SPED corrigido ({{ correcoes.length }})</span>
            <span class="normal-case opacity-70">· {{ correcoesAgrupadas.length }} tipo(s)</span>
          </div>
          <div class="divide-y divide-line max-h-[45vh] overflow-y-auto">
            <template v-for="g in correcoesAgrupadas" :key="g.key">
              <div class="flex items-center gap-2 px-3 py-2 hover:bg-paper text-[11px]">
                <button @click="toggleGrupoCorr(g.key)" class="flex items-center gap-2 min-w-0 flex-1 text-left">
                  <component :is="grupoCorrAberto === g.key ? ChevronUp : ChevronDown" class="w-3.5 h-3.5 text-risco shrink-0" :stroke-width="1.7" />
                  <span class="font-mono text-bronze shrink-0">{{ g.registro }}</span>
                  <span class="text-ink shrink-0">{{ nomeCampoCorr(g.registro, g.campo_idx) }}</span>
                  <span v-if="g.itens.length > 1" class="text-[10px] font-bold text-variacao shrink-0">×{{ g.itens.length }}</span>
                  <span class="text-risco truncate">→ <span class="font-mono text-conforme">{{ g.valor_corrigido }}</span></span>
                </button>
                <button @click="removerGrupoCorrecao(g)" class="text-[10px] text-lacre hover:opacity-80 font-medium shrink-0">remover{{ g.itens.length > 1 ? ' todas' : '' }}</button>
              </div>
              <div v-if="grupoCorrAberto === g.key" class="bg-paper max-h-[30vh] overflow-y-auto divide-y divide-line">
                <!-- O QUE / POR QUE / COMO — uma vez por tipo de correção -->
                <div v-if="explicacaoRegra(g)" class="px-3 py-2 pl-8 text-[10px] bg-bronze/[0.05] space-y-0.5 leading-snug">
                  <p><b class="text-ink">O que:</b> <span class="text-risco">{{ explicacaoRegra(g).oque }}</span></p>
                  <p><b class="text-ink">Por que:</b> <span class="text-risco">{{ explicacaoRegra(g).porque }}</span></p>
                  <p><b class="text-ink">Como:</b> <span class="text-risco">{{ explicacaoRegra(g).como }}</span></p>
                </div>
                <div v-for="c in g.itens" :key="c.id" class="px-3 py-1.5 pl-8 text-[10px]">
                  <div class="flex items-center gap-2">
                    <span class="text-risco truncate min-w-0 flex-1" :class="{ 'font-mono': !c.nf_num }" :title="c.chave_natural">{{ rotuloOcorrencia(c) }}</span>
                    <span class="text-risco line-through shrink-0">{{ c.valor_original || '—' }}</span>
                    <span class="text-risco shrink-0">→</span>
                    <span class="font-mono text-conforme shrink-0">{{ c.valor_corrigido }}</span>
                    <button @click="removerCorrecao(c)" class="text-lacre hover:opacity-80 font-medium shrink-0">remover</button>
                  </div>
                  <p v-if="motivoOcorrencia(c)" class="text-[9px] text-bronze italic mt-0.5">↳ {{ motivoOcorrencia(c) }}</p>
                </div>
              </div>
            </template>
          </div>
        </div>
        <p class="text-[11px] text-risco">"Baixar SPED corrigido" gera o arquivo com os auto-ajustes (0220, totalizadores, duplicados, assinatura) + suas correções. "Validar corrigido" valida esse arquivo já corrigido.</p>
      </div>

      <!-- Corrigir cadastro: IE (0000) e contabilista (0100) — edita direto → aplicado no export -->
      <div v-if="resultadoId && cadastro" class="bg-sheet rounded-md border border-line card-shadow p-5 space-y-4">
        <div>
          <h3 class="text-[13px] font-semibold text-ink">Corrigir cadastro (IE / contabilista)</h3>
          <p class="text-[11px] text-risco">Digite o valor correto e salve — vai para as correções e o SPED exportado já sai corrigido. Use para a IE rejeitada pela SEFAZ e para os dados do contador.</p>
        </div>
        <!-- Inscrição Estadual (0000) -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[12px] font-medium text-risco w-40 shrink-0">Inscrição Estadual <span class="text-risco">(UF {{ cadastro.uf || '—' }})</span></span>
          <span class="text-[11px] text-risco">atual: <b class="font-mono text-ink">{{ cadastro.ie || '(vazio)' }}</b></span>
          <input v-model="cadVal.ie" type="text" placeholder="IE correta" class="flex-1 min-w-[140px] h-8 text-[12px] bg-sheet border border-line rounded-md px-2 font-mono text-ink outline-none focus:border-bronze transition-colors" />
          <button @click="salvarCadastro('ie','0000','unico',10,cadastro.ie)" :disabled="salvandoCad==='ie'" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 shrink-0 transition-opacity">salvar</button>
        </div>
        <!-- Contabilista (0100) -->
        <template v-if="cadastro.contador">
          <div class="text-[11px] text-risco border-t border-line pt-3">Contabilista (0100): <b class="text-ink">{{ cadastro.contador.nome || '—' }}</b> · CNPJ <span class="font-mono">{{ cadastro.contador.cnpj || '—' }}</span></div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[12px] font-medium text-risco w-40 shrink-0">CPF do responsável</span>
            <span class="text-[11px] text-risco">atual: <b class="font-mono text-ink">{{ cadastro.contador.cpf || '(vazio)' }}</b></span>
            <input v-model="cadVal.cpf" type="text" placeholder="CPF (só números)" class="flex-1 min-w-[140px] h-8 text-[12px] bg-sheet border border-line rounded-md px-2 font-mono text-ink outline-none focus:border-bronze transition-colors" />
            <button @click="salvarCadastro('cpf','0100',cadastro.contador.chave,3,cadastro.contador.cpf)" :disabled="salvandoCad==='cpf'" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 shrink-0 transition-opacity">salvar</button>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[12px] font-medium text-risco w-40 shrink-0">CRC</span>
            <span class="text-[11px] text-risco">atual: <b class="font-mono text-ink">{{ cadastro.contador.crc || '(vazio)' }}</b></span>
            <input v-model="cadVal.crc" type="text" placeholder="nº do CRC" class="flex-1 min-w-[140px] h-8 text-[12px] bg-sheet border border-line rounded-md px-2 font-mono text-ink outline-none focus:border-bronze transition-colors" />
            <button @click="salvarCadastro('crc','0100',cadastro.contador.chave,4,cadastro.contador.crc)" :disabled="salvandoCad==='crc'" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 shrink-0 transition-opacity">salvar</button>
          </div>
        </template>
      </div>

      <!-- O QUE FOI CORRIGIDO (changelog antes→depois, por bloco/registro) -->
      <div v-if="alteracoes" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
        <div class="px-5 py-3 border-b border-line flex items-center gap-3 flex-wrap">
          <span class="text-[13px] font-semibold text-ink flex items-center gap-1.5"><ClipboardList class="w-4 h-4" :stroke-width="1.8" /> O que foi corrigido</span>
          <span class="text-[11px] font-medium text-conforme bg-conforme/10 border border-conforme/25 px-2 py-0.5 rounded-md">{{ alteracoes.total }} alteração(ões)</span>
          <span v-for="(n, k) in (alteracoes.totais?.porOrigem || {})" :key="k" class="text-[10px] font-medium text-risco bg-paper border border-line px-2 py-0.5 rounded-md">{{ k }}: {{ n }}</span>
          <button @click="baixarRelatorioPdf" :disabled="baixandoPdf" class="ml-auto px-3 py-1 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 transition-opacity" title="Relatório consolidado em PDF para enviar à contabilidade / setor fiscal">{{ baixandoPdf ? 'Gerando…' : 'Relatório (PDF)' }}</button>
          <button @click="alteracoes = null" class="text-[11px] text-risco hover:text-ink font-medium">fechar ✕</button>
        </div>
        <!-- Correções DESLIGADAS pelo usuário (Fase B) -->
        <div v-if="alteracoes.skips && alteracoes.skips.length" class="px-5 py-3 bg-variacao/[0.06] border-b border-variacao/25">
          <p class="text-[11px] font-semibold text-variacao mb-2">Correções DESLIGADAS por você ({{ alteracoes.skips.length }}) — <b>não estão sendo aplicadas</b> (o erro pode voltar no PVA). Clique em <b>Religar</b> para voltar a aplicar:</p>
          <div class="space-y-1.5">
            <div v-for="(s, i) in alteracoes.skips" :key="i" class="flex items-center gap-2 bg-sheet border border-variacao/25 rounded-md px-3 py-1.5">
              <span class="shrink-0 text-[9px] font-bold uppercase text-variacao bg-variacao/10 border border-variacao/30 rounded px-1.5 py-0.5">off</span>
              <span class="min-w-0 flex-1 text-[11px] font-medium text-ink">{{ rotuloRegra(s.regra_id) }}<span v-if="s.chave" class="font-mono text-risco"> · {{ s.chave }}</span></span>
              <button @click="toggleSkip(s.regra_id, s.chave, false)" :disabled="loadingAlt" class="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-white bg-conforme hover:opacity-85 disabled:opacity-50 rounded-md px-2.5 py-1 transition-opacity" title="Voltar a aplicar esta correção">↻ Religar</button>
            </div>
          </div>
        </div>
        <div v-if="!alteracoes.total" class="px-5 py-6 text-[13px] text-risco italic text-center">Nenhuma correção aplicada neste arquivo (o SPED já estava coerente nos pontos que tratamos).</div>
        <div v-else class="divide-y divide-line max-h-[60vh] overflow-y-auto">
          <div v-for="b in alteracoes.agrupado" :key="b.bloco" class="p-4">
            <p class="text-[12px] font-semibold text-ink mb-2">BLOCO {{ b.bloco }} <span class="text-risco font-mono">· {{ b.total }}</span></p>
            <div v-for="reg in b.registros" :key="reg.registro" class="mb-3">
              <p class="text-[11px] font-medium text-bronze font-mono mb-1">{{ reg.registro }} <span class="text-risco">({{ reg.total }})</span></p>
              <div class="space-y-1">
                <div v-for="(it, i) in reg.itens" :key="i" class="text-[11px] flex items-start gap-2 bg-paper rounded-md px-2 py-1.5">
                  <span class="shrink-0 text-[9px] font-medium uppercase px-1.5 py-0.5 rounded-md border"
                    :class="{ 'bg-bronze/10 text-bronze border-bronze/25': it.origem==='injecao', 'bg-variacao/10 text-variacao border-variacao/25': it.origem==='fiscal', 'bg-conforme/10 text-conforme border-conforme/25': it.origem==='manual', 'bg-paper text-risco border-line': it.origem==='auto', 'bg-lacre/10 text-lacre border-lacre/25': it.origem==='remocao' }">{{ it.origem }}</span>
                  <span class="min-w-0 flex-1">
                    <b class="text-ink">{{ it.campo || it.escopo }}</b><span v-if="it.qtd > 1" class="text-[10px] font-bold text-variacao ml-1">×{{ it.qtd }}</span>:
                    <span class="text-risco line-through break-all">{{ it.antes || '—' }}</span>
                    <span class="text-risco mx-1">→</span>
                    <span class="font-mono text-conforme break-all">{{ it.depois }}</span>
                    <span class="block text-[10px] text-risco italic">{{ it.motivo }}<span v-if="it.regraId" class="font-mono not-italic opacity-70"> · {{ it.regraId }}</span></span>
                    <span v-if="it.itens && it.itens.length" class="block mt-1">
                      <button @click="detalheAberto = (detalheAberto === dkey(b.bloco, reg.registro, i) ? null : dkey(b.bloco, reg.registro, i))" class="inline-flex items-center gap-1 text-[10px] font-medium text-bronze hover:opacity-70 transition-opacity">
                        <component :is="detalheAberto === dkey(b.bloco, reg.registro, i) ? ChevronUp : ChevronDown" class="w-3 h-3" :stroke-width="1.7" />{{ detalheAberto === dkey(b.bloco, reg.registro, i) ? 'ocultar' : 'ver' }} {{ it.itens.length }} item(ns) detalhado(s)
                      </button>
                      <div v-if="detalheAberto === dkey(b.bloco, reg.registro, i)" class="mt-1 border-l-2 border-line pl-2 space-y-0.5 max-h-[30vh] overflow-y-auto">
                        <div v-for="(d, j) in it.itens" :key="j" class="text-[10px] flex items-center gap-1.5">
                          <span class="font-mono text-ink truncate shrink-0 max-w-[55%]" :title="d.chave">{{ d.chave || '—' }}</span>
                          <span class="text-risco line-through break-all">{{ d.antes || '—' }}</span>
                          <span class="text-risco shrink-0">→</span>
                          <span class="font-mono text-conforme break-all">{{ d.depois }}</span>
                        </div>
                      </div>
                    </span>
                  </span>
                  <button v-if="EXCLUIVEIS.has(it.regraId)" @click="toggleSkip(it.regraId, chaveSkip(it), true)" :disabled="loadingAlt"
                    title="Desligar: parar de aplicar esta correção. Para RELIGAR depois, use a faixa amarela 'Correções desligadas' no topo deste relatório."
                    class="shrink-0 self-center text-[9px] font-medium text-lacre hover:text-white hover:bg-lacre border border-lacre/25 rounded-md px-1.5 py-0.5 transition-colors">desligar</button>
                  <span v-else class="shrink-0 self-center text-[9px] text-risco" title="Correção estrutural — sempre aplicada (o arquivo ficaria inválido sem ela); não pode ser desligada">fixa</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="px-5 py-2 text-[10px] text-risco border-t border-line">Reflete o ÚLTIMO "Baixar/Validar corrigido". Itens estruturais (totalizadores, recontagens) são sempre aplicados; injeções e ajustes fiscais são o que o sistema acrescentou para passar no PVA.</p>
      </div>

      <!-- Filtros + lista de erros -->
      <div v-if="resultado.erros.length" id="tabela-inconsistencias" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden scroll-mt-4">
        <div class="px-5 py-3 border-b border-line flex items-center gap-3 flex-wrap">
          <AlertTriangle class="w-4 h-4 text-lacre shrink-0" :stroke-width="1.8" />
          <span class="text-[13px] font-semibold text-ink">Inconsistências e cruzamentos no arquivo</span>
          <button @click="baixarInconsistencias" class="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 transition-opacity" title="Baixar o relatório de inconsistências (CSV)">
            <Download class="w-3.5 h-3.5" :stroke-width="1.8" /> Baixar
          </button>
        </div>
        <div class="px-5 py-2.5 border-b border-line flex items-center gap-2 flex-wrap">
          <input v-model="buscaErro" type="text" placeholder="filtrar por tipo, registro ou código…" class="flex-1 min-w-[180px] h-8 text-[12px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors" />
          <select v-model="filtroBloco" class="h-8 text-[12px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors">
            <option value="">Todos os blocos</option>
            <option v-for="b in resultado.resumo.blocosPresentes" :key="b" :value="b">{{ nomeBloco(b) }}</option>
          </select>
          <select v-model="filtroSev" class="h-8 text-[12px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors">
            <option value="">Toda severidade</option>
            <option value="BLOQ">Bloqueantes</option>
            <option value="ADV">Advertências</option>
          </select>
          <span class="text-[11px] text-risco font-mono ml-auto">{{ errosAgrupados.length }} tipo(s) · {{ errosFiltrados.length }} ocorrência(s)</span>
        </div>

        <div class="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table class="w-full table-fixed text-[12px]">
            <colgroup>
              <col class="w-7" />
              <col />
              <col class="w-16" />
              <col class="w-12" />
              <col class="w-14" />
              <col class="w-24 sm:w-32" />
              <col class="w-9" />
            </colgroup>
            <thead class="sticky top-0 z-10">
              <tr class="bg-paper text-[10px] uppercase tracking-wide text-risco">
                <th></th>
                <th class="text-left px-3 py-2 font-medium">Tipo de ocorrência</th>
                <th class="text-center px-1 py-2 font-medium">Reg.</th>
                <th class="text-center px-1 py-2 font-medium">Ocorr.</th>
                <th class="text-center px-1 py-2 font-medium">Cód.</th>
                <th class="text-left px-2 py-2 font-medium">Categoria</th>
                <th class="text-center px-1 py-2 font-medium">Dica</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <template v-for="g in errosAgrupados" :key="g.regra_id">
                <!-- Linha do grupo (1 por tipo de ocorrência) -->
                <tr class="hover:bg-paper cursor-pointer align-top" @click="toggleGrupo(g.regra_id)">
                  <td class="px-1 text-center pt-3"><component :is="grupoAberto === g.regra_id ? ChevronUp : ChevronDown" class="w-4 h-4 text-risco inline" :stroke-width="1.7" /></td>
                  <td class="px-3 py-2.5 break-words">
                    <span class="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" :class="g.severidade === 'BLOQ' ? 'bg-lacre' : 'bg-variacao'"></span>
                    <span class="text-ink">{{ g.titulo }}</span>
                  </td>
                  <td class="px-1 py-2.5 text-center font-mono text-bronze break-all">{{ g.registro }}</td>
                  <td class="px-1 py-2.5 text-center font-mono font-semibold text-ink">{{ g.ocorrencias.length }}</td>
                  <td class="px-1 py-2.5 text-center font-mono text-risco break-all">{{ g.codigo }}</td>
                  <td class="px-2 py-2.5"><span class="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-md border" :class="corCategoria(g)">{{ categoriaOcorrencia(g) }}</span></td>
                  <td class="px-1 py-2.5 text-center"><button @click.stop="toggleDica(g.regra_id)" class="hover:opacity-70 transition-opacity" title="Ver explicação do erro"><Info class="w-4 h-4 inline" :stroke-width="1.8" :class="dicaAberta === g.regra_id ? 'text-bronze' : 'text-risco'" /></button></td>
                </tr>
                <!-- Dica (explicação do erro) -->
                <tr v-if="dicaAberta === g.regra_id">
                  <td colspan="7" class="px-6 py-3 bg-bronze/[0.04] border-t border-bronze/15 text-[12px] space-y-1">
                    <p class="text-ink"><b>O que é:</b> {{ g.titulo }}</p>
                    <p class="text-ink"><b>Como corrigir:</b> {{ g.instrucaoERP || 'Corrija na origem (ERP) e gere o arquivo novamente.' }}</p>
                    <p class="text-[10px] text-risco">Código de referência {{ g.codigo }} · {{ categoriaOcorrencia(g) }} · {{ g.severidade === 'BLOQ' ? 'Bloqueante' : 'Advertência' }} · registro {{ g.registro }}</p>
                  </td>
                </tr>
                <!-- Ocorrências individuais (com "corrigir") -->
                <tr v-if="grupoAberto === g.regra_id">
                  <td colspan="7" class="p-0 bg-paper">
                    <div class="max-h-[42vh] overflow-y-auto divide-y divide-line">
                      <div v-for="(e, i) in g.ocorrencias" :key="i">
                        <button @click="toggleOcc(e)" class="w-full text-left px-6 py-2 hover:bg-sheet flex items-center gap-3 text-[11px] transition-colors">
                          <span class="font-mono text-risco shrink-0">L{{ e.linha ?? '-' }}</span>
                          <span class="min-w-0 flex-1 truncate text-ink">{{ e.detalhe }}</span>
                          <span v-if="e.corrigidoPeloUsuario" class="text-[9px] font-medium text-white bg-conforme px-1.5 py-0.5 rounded-md shrink-0">✓ corrigido</span>
                          <span v-else-if="e.jaCorrigidoNoExport" class="text-[9px] font-medium text-conforme bg-conforme/10 border border-conforme/25 px-1.5 py-0.5 rounded-md shrink-0">auto no download</span>
                          <component :is="occAberta === keyErro(e) ? ChevronUp : ChevronDown" class="w-3.5 h-3.5 text-risco shrink-0" :stroke-width="1.7" />
                        </button>
                        <div v-if="occAberta === keyErro(e)" class="px-6 pb-4 pt-1 bg-sheet text-[12px] space-y-2">
                          <div v-if="e.corrigidoPeloUsuario" class="bg-conforme/[0.06] border border-conforme/25 rounded-md p-3 text-conforme">
                            <b>✓ Você já corrigiu este item.</b> Ele ainda aparece porque esta tela analisa o arquivo <b>ORIGINAL</b>. Clique em <b>"Validar corrigido"</b> ou baixe o SPED corrigido para confirmar.
                          </div>
                          <p class="text-ink">{{ e.detalhe }}</p>
                          <div class="grid sm:grid-cols-2 gap-2">
                            <div v-if="e.valorAtual !== '' && e.valorAtual != null"><span class="text-risco">Valor atual:</span> <span class="font-mono text-ink break-all">{{ e.valorAtual }}</span></div>
                            <div v-if="e.valorSugerido !== undefined && e.valorSugerido !== ''"><span class="text-risco">Sugestão:</span> <span class="font-mono text-conforme break-all">{{ e.valorSugerido }}</span></div>
                          </div>
                          <!-- DOC-C170-01: vincular o COD_ITEM órfão a um produto 0200 cadastrado -->
                          <div v-if="e.regra_id === 'DOC-C170-01' && resultadoId && !e.corrigidoPeloUsuario" class="bg-bronze/[0.05] border border-bronze/20 rounded-md p-3">
                            <p class="text-[10px] uppercase tracking-wide font-medium text-bronze mb-1">Vincular a um produto cadastrado (0200)</p>
                            <p class="text-[11px] text-risco mb-2">Este COD_ITEM não existe no 0200. Selecione o produto correspondente — vale para <b>todas</b> as notas com esse item.</p>
                            <div class="flex items-center gap-2">
                              <select v-model="vincSel[keyErro(e)]" @focus="carregarProdutos0200" class="flex-1 h-8 text-[12px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors">
                                <option value="">{{ loadingProds ? 'carregando produtos...' : (produtos0200.length ? 'selecione o produto…' : 'clique para carregar…') }}</option>
                                <option v-for="p in produtos0200" :key="p.cod_item" :value="p.cod_item">{{ p.cod_item }} — {{ p.descr }}{{ p.ncm ? ' (NCM ' + p.ncm + ')' : '' }}</option>
                              </select>
                              <button @click="vincularCodItem(e)" :disabled="!vincSel[keyErro(e)] || salvandoVinc === keyErro(e)" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 shrink-0 transition-opacity">Vincular</button>
                            </div>
                          </div>
                          <!-- COMB-1350-1360-01: informar o lacre (1360) da bomba → injeta o registro no download -->
                          <div v-if="e.regra_id === 'COMB-1350-1360-01' && resultadoId && !e.corrigidoPeloUsuario" class="bg-bronze/[0.05] border border-bronze/20 rounded-md p-3">
                            <p class="text-[10px] uppercase tracking-wide font-medium text-bronze mb-1">Informar o lacre da bomba (registro 1360)</p>
                            <p class="text-[11px] text-risco mb-2">Bomba <b class="font-mono text-ink">{{ bombaLabel(e) }}</b>. Informe o nº do lacre e a data de aplicação — o SPED baixado passa a conter o 1360.</p>
                            <div class="flex flex-wrap items-end gap-2">
                              <div class="flex flex-col">
                                <label class="text-[9px] text-risco mb-0.5">Nº do lacre (NUM_LACRE)</label>
                                <input v-model="lacreVal[keyErro(e)]" type="text" class="h-8 w-44 text-[12px] bg-sheet border border-line rounded-md px-2 font-mono text-ink outline-none focus:border-bronze transition-colors" placeholder="ex.: PHR-2422">
                              </div>
                              <div class="flex flex-col">
                                <label class="text-[9px] text-risco mb-0.5">Data de aplicação</label>
                                <input v-model="lacreData[keyErro(e)]" type="text" inputmode="numeric" class="h-8 w-32 text-[12px] bg-sheet border border-line rounded-md px-2 font-mono text-ink outline-none focus:border-bronze transition-colors" placeholder="DD/MM/AAAA">
                              </div>
                              <button @click="salvarLacre(e)" :disabled="salvandoLacre === keyErro(e)" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 shrink-0 transition-opacity">{{ salvandoLacre === keyErro(e) ? 'Salvando…' : 'Salvar lacre' }}</button>
                            </div>
                            <p class="text-[10px] text-risco mt-1">A data já vem com o 1º dia do período — edite se precisar. O lacre entra no SPED ao baixar; original preservado. Você também pode corrigir no ERP.</p>
                          </div>
                          <!-- DOC-0200-CEST-01: lista suspensa de CEST (sugeridos pelo NCM + buscar em todos) -->
                          <div v-if="e.regra_id === 'DOC-0200-CEST-01' && resultadoId && !e.corrigidoPeloUsuario" class="bg-bronze/[0.05] border border-bronze/20 rounded-md p-3">
                            <p class="text-[10px] uppercase tracking-wide font-medium text-bronze mb-1">Corrigir o CEST</p>
                            <p class="text-[11px] text-risco mb-2">Produto <b class="font-mono text-ink">{{ e.chaveNatural }}</b><span v-if="e.ncm"> · NCM <b class="font-mono text-ink">{{ e.ncm }}</b></span>. Escolha o CEST correto na lista.</p>
                            <div class="flex flex-wrap items-center gap-2">
                              <select v-model="cestSel[keyErro(e)]" :disabled="cestSemST[keyErro(e)]" class="flex-1 min-w-0 h-8 text-[12px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors disabled:opacity-40">
                                <option value="">{{ carregandoCest[keyErro(e)] ? 'carregando…' : ((cestOpcoes[keyErro(e)] || []).length ? 'selecione o CEST…' : 'nenhum sugerido — use “buscar em todos”') }}</option>
                                <option v-for="o in (cestOpcoes[keyErro(e)] || [])" :key="o.cest" :value="o.cest">{{ o.cest_fmt }} — {{ o.descricao }}</option>
                              </select>
                              <button @click="salvarCest(e)" :disabled="salvandoCest === keyErro(e)" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 shrink-0 transition-opacity">{{ salvandoCest === keyErro(e) ? 'Salvando…' : 'Salvar CEST' }}</button>
                            </div>
                            <div class="flex items-center gap-3 mt-1.5 flex-wrap">
                              <button @click="cestBuscaAberta[keyErro(e)] = !cestBuscaAberta[keyErro(e)]" class="text-[11px] text-bronze hover:opacity-70 transition-opacity">não achei — buscar em todos</button>
                              <label class="text-[11px] text-risco flex items-center gap-1 cursor-pointer"><input type="checkbox" v-model="cestSemST[keyErro(e)]" class="accent-bronze"> produto sem ST (deixar vazio)</label>
                            </div>
                            <div v-if="cestBuscaAberta[keyErro(e)]" class="flex items-center gap-2 mt-1.5">
                              <input v-model="cestBusca[keyErro(e)]" @keyup.enter="buscarCest(e)" type="text" class="flex-1 h-8 text-[12px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors" placeholder="buscar por código ou descrição… (mín. 2 caracteres)">
                              <button @click="buscarCest(e)" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 shrink-0 transition-opacity">Buscar</button>
                            </div>
                            <p class="text-[10px] text-risco mt-1">A correção entra no SPED ao baixar. Original preservado. Você também pode corrigir no ERP.</p>
                          </div>
                          <!-- Corrigir no sistema (campo livre genérico — exceto CEST, que tem lista própria acima) -->
                          <div v-if="e.corrigivel && resultadoId && e.regra_id !== 'DOC-0200-CEST-01'" class="bg-bronze/[0.05] border border-bronze/20 rounded-md p-3">
                            <p class="text-[10px] uppercase tracking-wide font-medium text-bronze mb-1">Corrigir no sistema</p>
                            <div class="flex items-center gap-2">
                              <input v-model="valoresCorrecao[keyErro(e)]" type="text" class="flex-1 h-8 text-[12px] bg-sheet border border-line rounded-md px-2 font-mono text-ink outline-none focus:border-bronze transition-colors" :placeholder="e.permiteVazio ? 'deixe vazio para remover, ou digite o valor' : ((e.valorSugerido != null && e.valorSugerido !== '') ? String(e.valorSugerido) : 'novo valor')">
                              <button @click="salvarCorrecao(e)" :disabled="salvando === keyErro(e)" class="px-3 h-8 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 shrink-0 transition-opacity">{{ salvando === keyErro(e) ? 'Salvando…' : 'Salvar correção' }}</button>
                            </div>
                            <p v-if="e.permiteVazio" class="text-[9px] text-risco mt-1 italic">Campo opcional: deixe vazio para apagar o conteúdo inválido, ou informe o código correto.</p>
                            <p class="text-[10px] text-risco mt-1">A correção entra no SPED ao baixar. Original preservado.</p>
                          </div>
                          <p class="text-[10px] text-risco">Classe de correção: {{ classeLabel(e.classeCorrecao) }}</p>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else class="bg-conforme/[0.06] border border-conforme/25 rounded-md p-8 text-center text-conforme font-semibold flex items-center justify-center gap-2">
        <CheckCircle2 class="w-5 h-5" :stroke-width="1.8" /> Nenhum erro encontrado pelas regras atuais.
      </div>

      <p class="text-[11px] text-risco text-center">
        Validado contra {{ resultado.resumo.regrasExecutadas }} regra(s) do catálogo. O PVA pode ter validações adicionais — este módulo cresce de forma incremental.
      </p>
    </template>

    <!-- Modal: prévia do "Corrigir todas as seguras" -->
    <div v-if="showPreviewLote && previewLote" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showPreviewLote = false">
      <div class="bg-sheet rounded-lg border border-line shadow-xl max-w-lg w-full max-h-[85vh] overflow-auto">
        <div class="px-5 py-4 border-b border-line">
          <h3 class="text-[15px] font-semibold text-ink">Corrigir SPED</h3>
          <p class="text-[12px] text-risco mt-0.5">Prévia — <b>nada é gravado</b> até você confirmar. Só entram correções <b>determinísticas</b> (bloqueantes, com valor exato e gate fiscal). Itens de revisão manual ficam de fora.</p>
        </div>
        <div class="px-5 py-4 space-y-3">
          <div class="text-[13px] text-ink"><b class="text-conforme text-[20px] align-middle">{{ previewLote.total }}</b> correção(ões) segura(s) a aplicar:</div>
          <div class="border border-line rounded-md divide-y divide-line">
            <div v-for="(n, rid) in previewLote.porRegra" :key="rid" class="flex items-center justify-between px-3 py-2 text-[12px]">
              <span class="font-mono text-risco">{{ rid }}</span>
              <span class="font-medium text-ink">{{ n }}×</span>
            </div>
          </div>
          <div v-if="previewLote.amostra && previewLote.amostra.length" class="bg-paper border border-line rounded-md p-3">
            <p class="text-[10px] uppercase tracking-wide font-medium text-risco mb-1.5">Exemplos</p>
            <div class="space-y-1 text-[11px]">
              <div v-for="(a, i) in previewLote.amostra" :key="i" class="flex items-center gap-2 font-mono">
                <span class="text-risco shrink-0">{{ a.registro }}·L{{ a.linha }}·c{{ a.campoIdx }}</span>
                <span class="text-risco line-through">{{ a.valorAtual }}</span>
                <span class="text-risco">→</span>
                <span class="text-conforme">{{ a.valorSugerido }}</span>
              </div>
            </div>
          </div>
          <p class="text-[11px] text-risco">Aplicado como um <b>lote reversível</b> — dá para desfazer tudo num clique. O arquivo original nunca é alterado: a correção só entra no “SPED corrigido”.</p>
        </div>
        <div class="px-5 py-4 border-t border-line flex items-center justify-end gap-2">
          <button @click="showPreviewLote = false" class="px-3 h-9 rounded-md text-[12px] font-medium text-risco hover:bg-paper transition-colors">Cancelar</button>
          <button @click="aplicarCorrigirTudo" :disabled="corrigindoLote" class="px-4 h-9 rounded-md text-[12px] font-medium text-white bg-conforme hover:opacity-85 disabled:opacity-50 transition-opacity inline-flex items-center gap-1.5">
            <Loader2 v-if="corrigindoLote" class="w-4 h-4 animate-spin" :stroke-width="1.8" /> Aplicar {{ previewLote.total }} correção(ões)
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-shadow { box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07); }
</style>
