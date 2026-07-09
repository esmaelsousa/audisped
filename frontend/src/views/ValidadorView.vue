<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { empresaSelecionada, idArquivoSped, setArquivoInfo, setEmpresaSelecionada } from '../store';
import { ShieldCheck, UploadCloud, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Wand2, Info, Download } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';

const loading = ref(false);
const erro = ref('');
const resultado = ref(null);
const resultadoId = ref(null);   // id do arquivo (do banco) a que o resultado ATUAL pertence
const filtroBloco = ref('');
const filtroSev = ref('');
const expandido = ref(null);
const buscaErro = ref('');           // filtro de texto (tipo/registro/código) — estilo E-Auditor
const grupoAberto = ref(null);       // regra_id do grupo com ocorrências expandidas
const dicaAberta = ref(null);        // regra_id do grupo com a "dica" (explicação) aberta
const occAberta = ref(null);         // keyErro da ocorrência individual expandida

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
    (!q || normTxt(`${e.titulo || ''} ${e.registro || ''} ${e.regra_id || ''} ${e.refEAuditoria || ''}`).includes(q))
  );
});

// Agrupa os erros por TIPO (regra) — estilo E-Auditor: 1 linha por tipo, com contagem, código e dica.
const errosAgrupados = computed(() => {
  const m = new Map();
  for (const e of errosFiltrados.value) {
    let g = m.get(e.regra_id);
    if (!g) { g = { regra_id: e.regra_id, titulo: e.titulo, registro: e.registro, bloco: e.bloco, codigo: e.refEAuditoria || '—', severidade: e.severidade, instrucaoERP: e.instrucaoERP, ocorrencias: [] }; m.set(e.regra_id, g); }
    g.ocorrencias.push(e);
    if (e.severidade === 'BLOQ') g.severidade = 'BLOQ'; // grupo é bloqueante se qualquer ocorrência for
  }
  return [...m.values()].sort((a, b) => (a.severidade !== b.severidade ? (a.severidade === 'BLOQ' ? -1 : 1) : b.ocorrencias.length - a.ocorrencias.length));
});

// Categoria de ocorrência (nomenclatura do E-Auditor), por código; fallback por severidade.
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
    msgCorr.value = 'Correção salva. Clique em "Re-validar" para conferir o efeito.';
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
    msgCorr.value = 'Cadastro salvo. Clique em "Re-validar" para conferir; o SPED exportado já sai com o valor corrigido.';
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
    erro.value = e.response?.data?.message || ('Erro ao revalidar: ' + e.message);
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

function baixarCorrigido() {
  if (!resultadoId.value) return;
  const t = localStorage.getItem('token') || '';
  window.open(`${API_BASE_URL}/api/exportar-sped/${resultadoId.value}?token=${encodeURIComponent(t)}`, '_blank');
}

// Relatório "o que foi corrigido": re-exporta (revalidar grava o changelog e o devolve em .alteracoes)
const alteracoes = ref(null);
const loadingAlt = ref(false);
const baixandoPdf = ref(false);
async function verAlteracoes() {
  if (!resultadoId.value) { msgCorr.value = 'Valide um arquivo importado primeiro.'; return; }
  loadingAlt.value = true; erro.value = '';
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/revalidar/${resultadoId.value}`, {}, { headers: authHeader() });
    resultado.value = res.data; // atualiza os erros residuais também
    alteracoes.value = res.data.alteracoes || { total: 0, agrupado: [], totais: {} };
  } catch (e) {
    // fallback: lê o último changelog persistido
    try { const r = await axios.get(`${API_BASE_URL}/api/validador/alteracoes/${resultadoId.value}`, { headers: authHeader() }); alteracoes.value = r.data; }
    catch (_) { erro.value = e.response?.data?.message || ('Erro ao carregar o relatório: ' + e.message); }
  } finally { loadingAlt.value = false; }
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
const LABEL_REGRA = { 'INV-E116-01': 'Injetar E116 (ICMS a recolher)', 'CAD-0150-08': '0150 da credenciadora (1601)', 'COMB-1350-1360-01': 'Injetar lacres (1360)', 'COMB-CST-01': 'CST 61→60 (pré-monofásico)', 'DOC-C170-CFOP-01': 'Corrigir CFOP de entrada', 'USO-CONSUMO-X90': 'Uso/consumo → CST x90' };
function rotuloRegra(r) { return LABEL_REGRA[r] || r; }
// chave de exclusão: 0150 é por credenciadora (it.chave); as demais desligam a regra toda ('').
function chaveSkip(it) { return it.regraId === 'CAD-0150-08' ? (it.chave || '') : ''; }
async function toggleSkip(regraId, chave, ativo) {
  if (!resultadoId.value) return;
  if (ativo && regraId !== 'CAD-0150-08' && !confirm('Desligar esta correção afeta TODAS as ocorrências desse tipo neste arquivo. O erro pode voltar no PVA. Continuar?')) return;
  loadingAlt.value = true;
  try {
    await axios.post(`${API_BASE_URL}/api/validador/skip`, { id_sped_arquivo: resultadoId.value, regra_id: regraId, chave: chave || '', ativo }, { headers: authHeader() });
    await verAlteracoes(); // re-exporta e atualiza relatório + erros residuais
  } catch (e) {
    erro.value = e.response?.data?.message || ('Erro ao alterar a correção: ' + e.message);
    loadingAlt.value = false;
  }
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
        <UiButton @click="analisar" :disabled="loading || !arquivoSel" class="justify-center disabled:opacity-50 disabled:cursor-not-allowed">
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
        <div class="bg-sheet p-4 rounded-md border border-line card-shadow text-center">
          <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Ocorrências</p>
          <p class="text-[26px] font-display font-semibold text-ink">{{ resultado.resumo.total }}</p>
        </div>
        <div class="p-4 rounded-md border card-shadow text-center" :class="resultado.resumo.bloqueantes ? 'bg-lacre/[0.06] border-lacre/25' : 'bg-sheet border-line'">
          <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Bloqueantes</p>
          <p class="text-[26px] font-display font-semibold" :class="resultado.resumo.bloqueantes ? 'text-lacre' : 'text-ink'">{{ resultado.resumo.bloqueantes }}</p>
        </div>
        <div class="p-4 rounded-md border card-shadow text-center" :class="resultado.resumo.advertencias ? 'bg-variacao/[0.06] border-variacao/25' : 'bg-sheet border-line'">
          <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Advertências</p>
          <p class="text-[26px] font-display font-semibold text-variacao">{{ resultado.resumo.advertencias }}</p>
        </div>
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

      <!-- Ações de correção -->
      <div v-if="resultadoId" class="bg-sheet rounded-md border border-line card-shadow p-5 space-y-3">
        <div class="flex items-center gap-3 flex-wrap">
          <UiButton @click="baixarCorrigido">
            <UploadCloud class="w-4 h-4 rotate-180" :stroke-width="1.8" /> Baixar SPED corrigido
          </UiButton>
          <UiButton variant="ghost" @click="revalidar" :disabled="loading" class="disabled:opacity-50">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><CheckCircle2 v-else class="w-4 h-4" :stroke-width="1.8" /> Re-validar (sobre o SPED corrigido)
          </UiButton>
          <UiButton @click="previewCorrigirTudo" :disabled="corrigindoLote || loading" class="disabled:opacity-50">
            <Loader2 v-if="corrigindoLote" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><Wand2 v-else class="w-4 h-4" :stroke-width="1.8" /> Corrigir todas as seguras
          </UiButton>
          <button v-if="loteInfo" @click="desfazerLote" :disabled="corrigindoLote" class="text-[11px] text-lacre hover:opacity-80 font-medium disabled:opacity-50">↩ desfazer último lote ({{ loteInfo.total }})</button>
          <UiButton variant="ghost" @click="verAlteracoes" :disabled="loadingAlt" class="disabled:opacity-50">
            <Loader2 v-if="loadingAlt" class="w-4 h-4 animate-spin" :stroke-width="1.8" /><span v-else>📋</span> O que foi corrigido
          </UiButton>
          <span v-if="msgCorr" class="text-[12px] font-medium" :class="(msgCorr.startsWith('Erro') || msgCorr.startsWith('Informe') || msgCorr.startsWith('Valide')) ? 'text-lacre' : 'text-conforme'">{{ msgCorr }}</span>
        </div>
        <div v-if="correcoes.length" class="border border-line rounded-md overflow-hidden">
          <div class="px-3 py-2 bg-paper text-[11px] uppercase tracking-wide font-medium text-risco">Correções a aplicar no SPED corrigido ({{ correcoes.length }})</div>
          <table class="w-full text-[11px]">
            <tbody class="divide-y divide-line">
              <tr v-for="c in correcoes" :key="c.id" class="hover:bg-paper">
                <td class="px-3 py-1.5 font-mono text-risco">{{ c.registro }}</td>
                <td class="px-3 py-1.5 text-risco">campo {{ c.campo_idx }}</td>
                <td class="px-3 py-1.5"><span class="text-risco line-through mr-1">{{ c.valor_original || '—' }}</span><span class="font-mono text-conforme">{{ c.valor_corrigido }}</span></td>
                <td class="px-3 py-1.5 text-right"><button @click="removerCorrecao(c)" class="text-[10px] text-lacre hover:opacity-80 font-medium">remover</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-risco">"Baixar SPED corrigido" gera o arquivo com os auto-ajustes (0220, totalizadores, duplicados, assinatura) + suas correções. "Re-validar" valida esse arquivo já corrigido.</p>
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
          <span class="text-[13px] font-semibold text-ink">📋 O que foi corrigido</span>
          <span class="text-[11px] font-medium text-conforme bg-conforme/10 border border-conforme/25 px-2 py-0.5 rounded-md">{{ alteracoes.total }} alteração(ões)</span>
          <span v-for="(n, k) in (alteracoes.totais?.porOrigem || {})" :key="k" class="text-[10px] font-medium text-risco bg-paper border border-line px-2 py-0.5 rounded-md">{{ k }}: {{ n }}</span>
          <button @click="baixarRelatorioPdf" :disabled="baixandoPdf" class="ml-auto px-3 py-1 rounded-md text-[11px] font-medium text-white bg-bronze hover:opacity-85 disabled:opacity-50 transition-opacity" title="Relatório consolidado em PDF para enviar à contabilidade / setor fiscal">{{ baixandoPdf ? 'Gerando…' : '📄 Relatório (PDF)' }}</button>
          <button @click="alteracoes = null" class="text-[11px] text-risco hover:text-ink font-medium">fechar ✕</button>
        </div>
        <!-- Correções DESLIGADAS pelo usuário (Fase B) -->
        <div v-if="alteracoes.skips && alteracoes.skips.length" class="px-5 py-3 bg-variacao/[0.06] border-b border-variacao/20">
          <p class="text-[11px] font-medium text-variacao mb-1.5">⏸️ Correções desligadas por você ({{ alteracoes.skips.length }}) — NÃO aplicadas (o erro pode voltar no PVA):</p>
          <div class="flex flex-wrap gap-2">
            <span v-for="(s, i) in alteracoes.skips" :key="i" class="inline-flex items-center gap-1.5 text-[10px] bg-sheet border border-variacao/25 rounded-md px-2 py-0.5">
              <span class="font-medium text-variacao">{{ rotuloRegra(s.regra_id) }}<span v-if="s.chave" class="font-mono"> · {{ s.chave }}</span></span>
              <button @click="toggleSkip(s.regra_id, s.chave, false)" :disabled="loadingAlt" class="text-conforme hover:opacity-80 font-medium">reativar ↺</button>
            </span>
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
                  </span>
                  <button v-if="EXCLUIVEIS.has(it.regraId)" @click="toggleSkip(it.regraId, chaveSkip(it), true)" :disabled="loadingAlt"
                    title="Não aplicar esta correção no SPED corrigido"
                    class="shrink-0 self-center text-[9px] font-medium text-lacre hover:text-white hover:bg-lacre border border-lacre/25 rounded-md px-1.5 py-0.5 transition-colors">desligar</button>
                  <span v-else class="shrink-0 self-center text-[9px] text-risco" title="Correção estrutural — sempre aplicada (o arquivo ficaria inválido sem ela)">🔒</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="px-5 py-2 text-[10px] text-risco border-t border-line">Reflete o ÚLTIMO "Baixar/Re-validar". Itens estruturais (totalizadores, recontagens) são sempre aplicados; injeções e ajustes fiscais são o que o sistema acrescentou para passar no PVA.</p>
      </div>

      <!-- Filtros + lista de erros -->
      <div v-if="resultado.erros.length" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
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
          <table class="w-full text-[12px] min-w-[700px]">
            <thead class="sticky top-0 z-10">
              <tr class="bg-paper text-[10px] uppercase tracking-wide text-risco">
                <th class="w-8"></th>
                <th class="text-left px-3 py-2 font-medium">Tipo de ocorrência</th>
                <th class="text-left px-3 py-2 font-medium whitespace-nowrap">Registro</th>
                <th class="text-center px-3 py-2 font-medium whitespace-nowrap">Ocorr.</th>
                <th class="text-center px-3 py-2 font-medium">Código</th>
                <th class="text-left px-3 py-2 font-medium whitespace-nowrap">Categoria</th>
                <th class="w-12 text-center px-2 py-2 font-medium">Dica</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <template v-for="g in errosAgrupados" :key="g.regra_id">
                <!-- Linha do grupo (1 por tipo de ocorrência) -->
                <tr class="hover:bg-paper cursor-pointer" @click="toggleGrupo(g.regra_id)">
                  <td class="px-2 text-center align-top pt-3"><component :is="grupoAberto === g.regra_id ? ChevronUp : ChevronDown" class="w-4 h-4 text-risco inline" :stroke-width="1.7" /></td>
                  <td class="px-3 py-2.5">
                    <span class="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle shrink-0" :class="g.severidade === 'BLOQ' ? 'bg-lacre' : 'bg-variacao'"></span>
                    <span class="text-ink">{{ g.titulo }}</span>
                  </td>
                  <td class="px-3 py-2.5 align-top"><span class="font-mono text-bronze whitespace-nowrap">{{ g.registro }}</span></td>
                  <td class="px-3 py-2.5 text-center align-top font-mono font-semibold text-ink">{{ g.ocorrencias.length }}</td>
                  <td class="px-3 py-2.5 text-center align-top font-mono text-risco">{{ g.codigo }}</td>
                  <td class="px-3 py-2.5 align-top"><span class="text-[10px] px-2 py-0.5 rounded-md border whitespace-nowrap" :class="corCategoria(g)">{{ categoriaOcorrencia(g) }}</span></td>
                  <td class="px-2 py-2.5 text-center align-top"><button @click.stop="toggleDica(g.regra_id)" class="hover:opacity-70 transition-opacity" title="Ver explicação do erro"><Info class="w-4 h-4 inline" :stroke-width="1.8" :class="dicaAberta === g.regra_id ? 'text-bronze' : 'text-risco'" /></button></td>
                </tr>
                <!-- Dica (explicação do erro) -->
                <tr v-if="dicaAberta === g.regra_id">
                  <td colspan="7" class="px-6 py-3 bg-bronze/[0.04] border-t border-bronze/15 text-[12px] space-y-1">
                    <p class="text-ink"><b>O que é:</b> {{ g.titulo }}</p>
                    <p class="text-ink"><b>Como corrigir:</b> {{ g.instrucaoERP || 'Corrija na origem (ERP) e gere o arquivo novamente.' }}</p>
                    <p class="text-[10px] text-risco">Código E-Auditoria {{ g.codigo }} · {{ categoriaOcorrencia(g) }} · {{ g.severidade === 'BLOQ' ? 'Bloqueante' : 'Advertência' }} · registro {{ g.registro }}</p>
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
                            <b>✓ Você já corrigiu este item.</b> Ele ainda aparece porque esta tela analisa o arquivo <b>ORIGINAL</b>. Clique em <b>"Re-validar"</b> ou baixe o SPED corrigido para confirmar.
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
                          <!-- Corrigir no sistema -->
                          <div v-if="e.corrigivel && resultadoId" class="bg-bronze/[0.05] border border-bronze/20 rounded-md p-3">
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

      <div v-else class="bg-conforme/[0.06] border border-conforme/25 rounded-md p-8 text-center text-conforme font-semibold">
        ✅ Nenhum erro encontrado pelas regras atuais.
      </div>

      <p class="text-[11px] text-risco text-center">
        Validado contra {{ resultado.resumo.regrasExecutadas }} regra(s) do catálogo. O PVA pode ter validações adicionais — este módulo cresce de forma incremental.
      </p>
    </template>

    <!-- Modal: prévia do "Corrigir todas as seguras" -->
    <div v-if="showPreviewLote && previewLote" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showPreviewLote = false">
      <div class="bg-sheet rounded-lg border border-line shadow-xl max-w-lg w-full max-h-[85vh] overflow-auto">
        <div class="px-5 py-4 border-b border-line">
          <h3 class="text-[15px] font-semibold text-ink">Corrigir todas as seguras</h3>
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
