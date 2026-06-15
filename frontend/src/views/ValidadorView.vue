<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { empresaSelecionada, idArquivoSped, setArquivoInfo, setEmpresaSelecionada } from '../store';
import { ShieldCheck, UploadCloud, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from 'lucide-vue-next';

const loading = ref(false);
const erro = ref('');
const resultado = ref(null);
const resultadoId = ref(null);   // id do arquivo (do banco) a que o resultado ATUAL pertence
const filtroBloco = ref('');
const filtroSev = ref('');
const expandido = ref(null);

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
  return resultado.value.erros.filter(e =>
    (!filtroBloco.value || e.bloco === filtroBloco.value) &&
    (!filtroSev.value || e.severidade === filtroSev.value)
  );
});

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

function baixarCorrigido() {
  if (!resultadoId.value) return;
  const t = localStorage.getItem('token') || '';
  window.open(`${API_BASE_URL}/api/exportar-sped/${resultadoId.value}?token=${encodeURIComponent(t)}`, '_blank');
}

// Relatório "o que foi corrigido": re-exporta (revalidar grava o changelog e o devolve em .alteracoes)
const alteracoes = ref(null);
const loadingAlt = ref(false);
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

// Relatório consolidado em PDF (para enviar à contabilidade / setor fiscal)
function baixarRelatorioPdf() {
  if (!resultadoId.value) { msgCorr.value = 'Valide um arquivo importado primeiro.'; return; }
  const t = localStorage.getItem('token') || '';
  window.open(`${API_BASE_URL}/api/validador/relatorio-correcoes/${resultadoId.value}?token=${encodeURIComponent(t)}`, '_blank');
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
      <div class="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
        <ShieldCheck class="w-6 h-6" />
      </div>
      <div>
        <h1 class="text-xl font-bold text-slate-800">Validador de SPED Fiscal</h1>
        <p class="text-xs text-slate-500">Selecione um SPED importado, valide todos os blocos, corrija e baixe o arquivo corrigido.</p>
      </div>
    </div>

    <!-- Seletor empresa → período (só arquivos do banco) -->
    <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
      <div class="mb-3">
        <label class="text-[11px] font-bold text-slate-500 uppercase">Buscar empresa</label>
        <div class="relative mt-1">
          <input v-model="buscaEmpresa" type="text" placeholder="CNPJ, razão social ou nome fantasia…"
            class="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 pr-8" />
          <button v-if="buscaEmpresa" @click="buscaEmpresa = ''" type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <p v-if="buscaEmpresa" class="text-[10px] text-slate-400 mt-1">{{ empresasFiltradas.length }} de {{ empresas.length }} empresa(s)</p>
      </div>
      <div class="grid sm:grid-cols-[2fr_1.5fr_auto] gap-3 items-end">
        <div>
          <label class="text-[11px] font-bold text-slate-500 uppercase">Empresa</label>
          <select v-model="empresaSel" @change="carregarArquivos" class="mt-1 w-full text-sm border border-slate-200 rounded-xl px-3 py-2">
            <option :value="null">— selecione —</option>
            <option v-for="e in empresasFiltradas" :key="e.id" :value="e.id">{{ nomeEmpresa(e) }} · {{ e.cnpj }}</option>
          </select>
        </div>
        <div>
          <label class="text-[11px] font-bold text-slate-500 uppercase">Período (SPED)</label>
          <select v-model="arquivoSel" :disabled="!arquivos.length" class="mt-1 w-full text-sm border border-slate-200 rounded-xl px-3 py-2 disabled:bg-slate-50">
            <option :value="null">— selecione —</option>
            <option v-for="a in arquivos" :key="a.id" :value="a.id">{{ a.periodo_apuracao }}</option>
          </select>
        </div>
        <button @click="analisar" :disabled="loading || !arquivoSel"
          class="px-5 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 flex items-center gap-2 justify-center">
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" /><ShieldCheck v-else class="w-4 h-4" />
          {{ loading ? 'Validando…' : 'Validar este SPED' }}
        </button>
      </div>
      <div class="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 flex-wrap">
        <input ref="uploadRef" type="file" accept=".txt,.TXT" class="hidden" @change="importarSped" />
        <button @click="uploadRef && uploadRef.click()" :disabled="uploading"
          class="px-4 py-2 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-2">
          <Loader2 v-if="uploading" class="w-4 h-4 animate-spin" /><UploadCloud v-else class="w-4 h-4" />
          {{ uploading ? 'Importando…' : 'Importar SPED (.txt)' }}
        </button>
        <span v-if="uploadMsg" class="text-xs text-indigo-600 font-semibold">{{ uploadMsg }}</span>
        <span v-else class="text-[11px] text-slate-400">Importa um SPED novo no banco (como o Analisador) e já valida. Ou selecione um já importado acima.</span>
      </div>
    </div>

    <div v-if="erro" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl p-4">{{ erro }}</div>
    <div v-if="loading" class="text-center text-slate-400 text-sm py-10"><Loader2 class="w-6 h-6 animate-spin inline" /> Validando o SPED…</div>

    <template v-if="resultado && !loading">
      <!-- Identificação -->
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 class="text-base font-bold text-slate-800">{{ empresaNome || resultado.arquivo?.cnpj || 'Empresa' }}</h2>
          <span v-if="resultado.validadoSobre === 'exportado'" class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">✓ validado sobre o SPED corrigido</span>
        </div>
        <div class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <span class="text-slate-500">CNPJ: <b class="text-slate-700">{{ resultado.arquivo?.cnpj || '—' }}</b></span>
          <span class="text-slate-500">Período: <b class="text-slate-700">{{ fmtPeriodo(resultado.arquivo?.periodo) }}</b></span>
          <span class="text-slate-500">Leiaute: <b class="text-slate-700">{{ resultado.arquivo?.versao || '—' }}</b></span>
          <span class="text-slate-500">Linhas: <b class="text-slate-700">{{ resultado.arquivo?.totalLinhas?.toLocaleString('pt-BR') }}</b></span>
          <span class="text-slate-400 text-xs">Arquivo: {{ resultado.arquivo?.nome || '—' }}</span>
        </div>
      </div>

      <!-- Métricas -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p class="text-[10px] uppercase font-bold text-slate-400">Ocorrências</p>
          <p class="text-2xl font-bold text-slate-700">{{ resultado.resumo.total }}</p>
        </div>
        <div class="p-4 rounded-2xl border shadow-sm text-center" :class="resultado.resumo.bloqueantes ? 'bg-red-50 border-red-200' : 'bg-white border-slate-100'">
          <p class="text-[10px] uppercase font-bold text-slate-400">Bloqueantes</p>
          <p class="text-2xl font-bold" :class="resultado.resumo.bloqueantes ? 'text-red-600' : 'text-slate-700'">{{ resultado.resumo.bloqueantes }}</p>
        </div>
        <div class="p-4 rounded-2xl border shadow-sm text-center" :class="resultado.resumo.advertencias ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'">
          <p class="text-[10px] uppercase font-bold text-slate-400">Advertências</p>
          <p class="text-2xl font-bold text-amber-600">{{ resultado.resumo.advertencias }}</p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p class="text-[10px] uppercase font-bold text-slate-400">Regras executadas</p>
          <p class="text-2xl font-bold text-slate-700">{{ resultado.resumo.regrasExecutadas }}</p>
        </div>
      </div>

      <!-- Cobertura por bloco (o "X") -->
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
        <p class="text-xs font-bold text-slate-500 uppercase mb-3">Cobertura por bloco</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="b in resultado.resumo.blocosPresentes" :key="b"
            @click="filtroBloco = filtroBloco === b ? '' : b"
            class="px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all"
            :class="[
              filtroBloco === b ? 'ring-2 ring-indigo-400' : '',
              (resultado.porBloco[b]?.bloqueantes) ? 'bg-red-50 border-red-200 text-red-700'
              : (resultado.porBloco[b]?.erros) ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700']">
            <component :is="resultado.porBloco[b]?.erros ? AlertTriangle : CheckCircle2" class="w-3.5 h-3.5" />
            {{ nomeBloco(b) }}<span v-if="resultado.porBloco[b]?.erros"> · {{ resultado.porBloco[b].erros }}</span>
          </button>
        </div>
      </div>

      <!-- Ações de correção -->
      <div v-if="resultadoId" class="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-3">
        <div class="flex items-center gap-3 flex-wrap">
          <button @click="revalidar" :disabled="loading" class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 flex items-center gap-2">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" /><CheckCircle2 v-else class="w-4 h-4" /> Re-validar (sobre o SPED corrigido)
          </button>
          <button @click="baixarCorrigido" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 flex items-center gap-2">
            <UploadCloud class="w-4 h-4 rotate-180" /> Baixar SPED corrigido
          </button>
          <button @click="verAlteracoes" :disabled="loadingAlt" class="px-4 py-2 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 flex items-center gap-2">
            <Loader2 v-if="loadingAlt" class="w-4 h-4 animate-spin" /><span v-else>📋</span> O que foi corrigido
          </button>
          <span v-if="msgCorr" class="text-xs font-semibold" :class="(msgCorr.startsWith('Erro') || msgCorr.startsWith('Informe') || msgCorr.startsWith('Valide')) ? 'text-red-600' : 'text-emerald-600'">{{ msgCorr }}</span>
        </div>
        <div v-if="correcoes.length" class="border border-slate-100 rounded-xl overflow-hidden">
          <div class="px-3 py-2 bg-slate-50 text-[11px] font-bold text-slate-500">Correções a aplicar no SPED corrigido ({{ correcoes.length }})</div>
          <table class="w-full text-[11px]">
            <tbody class="divide-y divide-slate-50">
              <tr v-for="c in correcoes" :key="c.id" class="hover:bg-slate-50/60">
                <td class="px-3 py-1.5 font-mono text-slate-500">{{ c.registro }}</td>
                <td class="px-3 py-1.5 text-slate-500">campo {{ c.campo_idx }}</td>
                <td class="px-3 py-1.5"><span class="text-slate-400 line-through mr-1">{{ c.valor_original || '—' }}</span><span class="font-mono text-emerald-700">{{ c.valor_corrigido }}</span></td>
                <td class="px-3 py-1.5 text-right"><button @click="removerCorrecao(c)" class="text-[10px] text-red-500 hover:text-red-700 font-bold">remover</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[10px] text-slate-400">"Baixar SPED corrigido" gera o arquivo com os auto-ajustes (0220, totalizadores, duplicados, assinatura) + suas correções. "Re-validar" valida esse arquivo já corrigido.</p>
      </div>

      <!-- O QUE FOI CORRIGIDO (changelog antes→depois, por bloco/registro) -->
      <div v-if="alteracoes" class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <span class="text-sm font-bold text-slate-700">📋 O que foi corrigido</span>
          <span class="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">{{ alteracoes.total }} alteração(ões)</span>
          <span v-for="(n, k) in (alteracoes.totais?.porOrigem || {})" :key="k" class="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{{ k }}: {{ n }}</span>
          <button @click="baixarRelatorioPdf" class="ml-auto px-3 py-1 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors" title="Relatório consolidado em PDF para enviar à contabilidade / setor fiscal">📄 Relatório (PDF)</button>
          <button @click="alteracoes = null" class="text-[11px] text-slate-400 hover:text-slate-600 font-bold">fechar ✕</button>
        </div>
        <!-- Correções DESLIGADAS pelo usuário (Fase B) -->
        <div v-if="alteracoes.skips && alteracoes.skips.length" class="px-5 py-3 bg-amber-50 border-b border-amber-100">
          <p class="text-[11px] font-bold text-amber-800 mb-1.5">⏸️ Correções desligadas por você ({{ alteracoes.skips.length }}) — NÃO aplicadas (o erro pode voltar no PVA):</p>
          <div class="flex flex-wrap gap-2">
            <span v-for="(s, i) in alteracoes.skips" :key="i" class="inline-flex items-center gap-1.5 text-[10px] bg-white border border-amber-200 rounded-full px-2 py-0.5">
              <span class="font-semibold text-amber-800">{{ rotuloRegra(s.regra_id) }}<span v-if="s.chave" class="font-mono text-amber-600"> · {{ s.chave }}</span></span>
              <button @click="toggleSkip(s.regra_id, s.chave, false)" :disabled="loadingAlt" class="text-emerald-600 hover:text-emerald-800 font-bold">reativar ↺</button>
            </span>
          </div>
        </div>
        <div v-if="!alteracoes.total" class="px-5 py-6 text-xs text-slate-400 italic text-center">Nenhuma correção aplicada neste arquivo (o SPED já estava coerente nos pontos que tratamos).</div>
        <div v-else class="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          <div v-for="b in alteracoes.agrupado" :key="b.bloco" class="p-4">
            <p class="text-xs font-black text-slate-600 mb-2">BLOCO {{ b.bloco }} <span class="text-slate-400 font-bold">· {{ b.total }}</span></p>
            <div v-for="reg in b.registros" :key="reg.registro" class="mb-3">
              <p class="text-[11px] font-bold text-indigo-600 font-mono mb-1">{{ reg.registro }} <span class="text-slate-400">({{ reg.total }})</span></p>
              <div class="space-y-1">
                <div v-for="(it, i) in reg.itens" :key="i" class="text-[11px] flex items-start gap-2 bg-slate-50/60 rounded-lg px-2 py-1.5">
                  <span class="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                    :class="{ 'bg-violet-100 text-violet-700': it.origem==='injecao', 'bg-amber-100 text-amber-700': it.origem==='fiscal', 'bg-sky-100 text-sky-700': it.origem==='manual', 'bg-slate-200 text-slate-600': it.origem==='auto', 'bg-rose-100 text-rose-700': it.origem==='remocao' }">{{ it.origem }}</span>
                  <span class="min-w-0 flex-1">
                    <b class="text-slate-600">{{ it.campo || it.escopo }}</b>:
                    <span class="text-slate-400 line-through break-all">{{ it.antes || '—' }}</span>
                    <span class="text-slate-300 mx-1">→</span>
                    <span class="font-mono text-emerald-700 break-all">{{ it.depois }}</span>
                    <span class="block text-[10px] text-slate-400 italic">{{ it.motivo }}</span>
                  </span>
                  <button v-if="EXCLUIVEIS.has(it.regraId)" @click="toggleSkip(it.regraId, chaveSkip(it), true)" :disabled="loadingAlt"
                    title="Não aplicar esta correção no SPED corrigido"
                    class="shrink-0 self-center text-[9px] font-bold text-red-500 hover:text-white hover:bg-red-500 border border-red-200 rounded px-1.5 py-0.5 transition-colors">desligar</button>
                  <span v-else class="shrink-0 self-center text-[9px] text-slate-300" title="Correção estrutural — sempre aplicada (o arquivo ficaria inválido sem ela)">🔒</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="px-5 py-2 text-[10px] text-slate-400 border-t border-slate-50">Reflete o ÚLTIMO "Baixar/Re-validar". Itens estruturais (totalizadores, recontagens) são sempre aplicados; injeções e ajustes fiscais são o que o sistema acrescentou para passar no PVA.</p>
      </div>

      <!-- Filtros + lista de erros -->
      <div v-if="resultado.erros.length" class="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <span class="text-sm font-bold text-slate-700">Erros encontrados</span>
          <select v-model="filtroBloco" class="text-xs border border-slate-200 rounded-lg px-2 py-1">
            <option value="">Todos os blocos</option>
            <option v-for="b in resultado.resumo.blocosPresentes" :key="b" :value="b">{{ nomeBloco(b) }}</option>
          </select>
          <select v-model="filtroSev" class="text-xs border border-slate-200 rounded-lg px-2 py-1">
            <option value="">Toda severidade</option>
            <option value="BLOQ">Bloqueantes</option>
            <option value="ADV">Advertências</option>
          </select>
          <span class="text-xs text-slate-400 ml-auto">{{ errosFiltrados.length }} de {{ resultado.erros.length }}</span>
        </div>

        <div class="divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
          <div v-for="(e, i) in errosFiltrados" :key="i">
            <button @click="toggle(i)" class="w-full text-left px-5 py-3 hover:bg-slate-50/60 flex items-start gap-3">
              <span class="px-2 py-0.5 rounded-md text-[9px] font-bold shrink-0 mt-0.5"
                :class="e.severidade === 'BLOQ' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">
                {{ e.severidade === 'BLOQ' ? 'BLOQUEANTE' : 'ADVERTÊNCIA' }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-slate-800 truncate">{{ e.titulo }}</p>
                <p class="text-[11px] text-slate-500">{{ e.regra_id }} · {{ e.registro }} · linha {{ e.linha ?? '-' }}</p>
              </div>
              <span v-if="e.corrigidoPeloUsuario" class="text-[9px] font-bold text-white bg-emerald-600 px-1.5 py-0.5 rounded shrink-0 mt-0.5">✓ corrigido por você</span>
              <span v-else-if="e.jaCorrigidoNoExport" class="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0 mt-0.5">auto no download</span>
              <component :is="expandido === i ? ChevronUp : ChevronDown" class="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            </button>
            <div v-if="expandido === i" class="px-5 pb-4 pt-1 bg-slate-50/50 text-xs space-y-2">
              <div v-if="e.corrigidoPeloUsuario" class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-800">
                <b>✓ Você já corrigiu este item.</b> Ele ainda aparece aqui porque esta tela analisa o arquivo <b>ORIGINAL</b>. Clique em <b>"Re-validar (sobre o SPED corrigido)"</b> ou baixe o SPED corrigido para confirmar — a correção é aplicada no arquivo final.
              </div>
              <p class="text-slate-600">{{ e.detalhe }}</p>
              <div class="grid sm:grid-cols-2 gap-2">
                <div v-if="e.valorAtual !== '' && e.valorAtual != null"><span class="text-slate-400">Valor atual:</span> <span class="font-mono text-slate-700 break-all">{{ e.valorAtual }}</span></div>
                <div v-if="e.valorSugerido !== undefined && e.valorSugerido !== ''"><span class="text-slate-400">Sugestão:</span> <span class="font-mono text-emerald-700 break-all">{{ e.valorSugerido }}</span></div>
              </div>
              <div class="bg-white border border-slate-100 rounded-xl p-3">
                <p class="text-[10px] uppercase font-bold text-slate-400 mb-1">Como corrigir no ERP</p>
                <p class="text-slate-600">{{ e.instrucaoERP || 'Corrija na origem (ERP) e gere o arquivo novamente.' }}</p>
              </div>
              <div v-if="e.corrigivel && resultadoId" class="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3">
                <p class="text-[10px] uppercase font-bold text-indigo-400 mb-1">Corrigir no sistema</p>
                <div class="flex items-center gap-2">
                  <input v-model="valoresCorrecao[keyErro(e)]" type="text" class="flex-1 h-8 text-xs border border-slate-200 rounded-lg px-2 font-mono" :placeholder="e.permiteVazio ? 'deixe vazio para remover, ou digite o valor' : ((e.valorSugerido != null && e.valorSugerido !== '') ? String(e.valorSugerido) : 'novo valor')">
                  <button @click="salvarCorrecao(e)" :disabled="salvando === keyErro(e)" class="px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 shrink-0">
                    {{ salvando === keyErro(e) ? 'Salvando…' : 'Salvar correção' }}
                  </button>
                </div>
                <p v-if="e.permiteVazio" class="text-[9px] text-slate-400 mt-1 italic">Campo opcional: deixe vazio para apagar o conteúdo inválido, ou informe o código correto.</p>
                <p class="text-[10px] text-slate-400 mt-1">A correção entra no SPED ao baixar. Original preservado.</p>
              </div>
              <p class="text-[10px] text-slate-400">Classe de correção: {{ classeLabel(e.classeCorrecao) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="bg-emerald-50 border border-emerald-200 rounded-3xl p-8 text-center text-emerald-700 font-bold">
        ✅ Nenhum erro encontrado pelas regras atuais.
      </div>

      <p class="text-[11px] text-slate-400 text-center">
        Validado contra {{ resultado.resumo.regrasExecutadas }} regra(s) do catálogo. O PVA pode ter validações adicionais — este módulo cresce de forma incremental.
      </p>
    </template>
  </div>
</template>
