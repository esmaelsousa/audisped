<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { useRoute } from 'vue-router';
import { empresaSelecionada, arquivoInfo, idArquivoSped } from '../store';
import { ShieldCheck, UploadCloud, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from 'lucide-vue-next';

const route = useRoute();

const loading = ref(false);
const erro = ref('');
const resultado = ref(null);
const arqFile = ref(null);
const arqFileName = ref('');
const filtroBloco = ref('');
const filtroSev = ref('');
const expandido = ref(null);

const NOME_BLOCO = {
  '0': 'Bloco 0 — Cadastros', 'C': 'Bloco C — NF-e/NFC-e', 'D': 'Bloco D — CT-e',
  'E': 'Bloco E — Apuração', 'G': 'Bloco G — CIAP', 'H': 'Bloco H — Inventário',
  'K': 'Bloco K — Produção', '1': 'Bloco 1 — Combustíveis/LMC', '9': 'Bloco 9 — Controle',
  'B': 'Bloco B — ISS', '*': 'Estrutural',
};
const nomeBloco = (b) => NOME_BLOCO[b] || ('Bloco ' + b);

const idAtivo = computed(() => route.params.id || idArquivoSped.value);

const errosFiltrados = computed(() => {
  if (!resultado.value) return [];
  return resultado.value.erros.filter(e =>
    (!filtroBloco.value || e.bloco === filtroBloco.value) &&
    (!filtroSev.value || e.severidade === filtroSev.value)
  );
});

const authHeader = () => {
  const t = localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function analisarPorId() {
  if (!idAtivo.value) { erro.value = 'Nenhum SPED selecionado. Abra um arquivo ou faça upload.'; return; }
  erro.value = ''; loading.value = true; resultado.value = null; expandido.value = null;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/analisar/${idAtivo.value}`, {}, { headers: authHeader() });
    resultado.value = res.data;
  } catch (e) {
    erro.value = e.response?.data?.message || ('Erro ao validar: ' + e.message);
  } finally { loading.value = false; }
}

function onFileSelected(e) {
  const f = e.target.files && e.target.files[0];
  arqFile.value = f || null;
  arqFileName.value = f ? f.name : '';
  erro.value = '';
}

async function analisarUpload() {
  if (!arqFile.value) { erro.value = 'Selecione um arquivo .txt do SPED.'; return; }
  erro.value = ''; loading.value = true; resultado.value = null; expandido.value = null;
  try {
    const fd = new FormData();
    fd.append('sped', arqFile.value);
    const res = await axios.post(`${API_BASE_URL}/api/validador/analisar-upload`, fd, { headers: authHeader() });
    resultado.value = res.data;
  } catch (e) {
    erro.value = e.response?.data?.message || ('Erro ao validar: ' + e.message);
  } finally { loading.value = false; }
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

// ===== Correções (Sprint 3c) — só no modo "por id" (arquivo importado) =====
const correcoes = ref([]);          // correções já aplicadas (do banco)
const valoresCorrecao = ref({});    // chave do erro -> valor digitado
const salvando = ref(null);
const msgCorr = ref('');
const keyErro = (e) => `${e.regra_id}|${e.chaveNatural}|${e.campoIdx}`;

async function carregarCorrecoes() {
  if (!idAtivo.value) { correcoes.value = []; return; }
  try {
    const res = await axios.get(`${API_BASE_URL}/api/validador/correcoes/${idAtivo.value}`, { headers: authHeader() });
    correcoes.value = res.data.correcoes || [];
  } catch (_) { correcoes.value = []; }
}

async function salvarCorrecao(e) {
  const k = keyErro(e);
  const valor = (valoresCorrecao.value[k] ?? '').toString().trim();
  if (valor === '') { msgCorr.value = 'Informe o valor corrigido.'; return; }
  salvando.value = k; msgCorr.value = '';
  try {
    await axios.post(`${API_BASE_URL}/api/validador/corrigir`, {
      id_sped_arquivo: idAtivo.value, regra_id: e.regra_id, registro: e.registro,
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
  if (!idAtivo.value) return;
  erro.value = ''; loading.value = true; expandido.value = null;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/validador/revalidar/${idAtivo.value}`, {}, { headers: authHeader() });
    resultado.value = res.data;
  } catch (e) {
    erro.value = e.response?.data?.message || ('Erro ao revalidar: ' + e.message);
  } finally { loading.value = false; }
}

function baixarCorrigido() {
  if (!idAtivo.value) return;
  const t = localStorage.getItem('token') || '';
  window.open(`${API_BASE_URL}/api/exportar-sped/${idAtivo.value}?token=${encodeURIComponent(t)}`, '_blank');
}

onMounted(() => { if (idAtivo.value) { analisarPorId(); carregarCorrecoes(); } });
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Cabeçalho -->
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
          <ShieldCheck class="w-6 h-6" />
        </div>
        <div>
          <h1 class="text-xl font-bold text-slate-800">Validador de SPED Fiscal</h1>
          <p class="text-xs text-slate-500">Lê o arquivo, varre todos os blocos e lista os erros com instrução de correção.</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="idAtivo" @click="analisarPorId" :disabled="loading"
          class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 flex items-center gap-2">
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" /><ShieldCheck v-else class="w-4 h-4" />
          {{ loading ? 'Validando…' : 'Validar este SPED' }}
        </button>
        <label class="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer flex items-center gap-2">
          <UploadCloud class="w-4 h-4" />
          {{ arqFileName || 'Upload .txt avulso' }}
          <input type="file" accept=".txt,.TXT" class="hidden" @change="onFileSelected">
        </label>
        <button v-if="arqFile" @click="analisarUpload" :disabled="loading"
          class="px-3 py-2 rounded-xl text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300">
          Validar upload
        </button>
      </div>
    </div>

    <div v-if="erro" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl p-4">{{ erro }}</div>
    <div v-if="loading" class="text-center text-slate-400 text-sm py-10"><Loader2 class="w-6 h-6 animate-spin inline" /> Validando o SPED…</div>

    <template v-if="resultado && !loading">
      <!-- Identificação -->
      <div class="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
        <div class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <span class="text-slate-500">Arquivo: <b class="text-slate-700">{{ resultado.arquivo?.nome || '—' }}</b></span>
          <span class="text-slate-500">CNPJ: <b class="text-slate-700">{{ resultado.arquivo?.cnpj || empresaSelecionada?.cnpj || '—' }}</b></span>
          <span class="text-slate-500">Período: <b class="text-slate-700">{{ resultado.arquivo?.periodo || '—' }}</b></span>
          <span class="text-slate-500">Leiaute: <b class="text-slate-700">{{ resultado.arquivo?.versao || '—' }}</b></span>
          <span class="text-slate-500">Linhas: <b class="text-slate-700">{{ resultado.arquivo?.totalLinhas?.toLocaleString('pt-BR') }}</b></span>
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

      <!-- Ações de correção (só p/ arquivo importado) -->
      <div v-if="idAtivo" class="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 space-y-3">
        <div class="flex items-center gap-3 flex-wrap">
          <button @click="revalidar" :disabled="loading" class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 flex items-center gap-2">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" /><CheckCircle2 v-else class="w-4 h-4" /> Re-validar (com correções)
          </button>
          <button @click="baixarCorrigido" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 flex items-center gap-2">
            <UploadCloud class="w-4 h-4 rotate-180" /> Baixar SPED corrigido
          </button>
          <span v-if="msgCorr" class="text-xs font-semibold" :class="(msgCorr.startsWith('Erro') || msgCorr.startsWith('Informe')) ? 'text-red-600' : 'text-emerald-600'">{{ msgCorr }}</span>
        </div>
        <div v-if="correcoes.length" class="border border-slate-100 rounded-xl overflow-hidden">
          <div class="px-3 py-2 bg-slate-50 text-[11px] font-bold text-slate-500">Correções a aplicar no SPED exportado ({{ correcoes.length }})</div>
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
        <p class="text-[10px] text-slate-400">Erros marcados "auto no export" (0220, totalizadores, duplicados) são corrigidos automaticamente ao baixar. Para conferência 100% fiel, baixe o SPED corrigido e revalide-o via "Upload .txt avulso".</p>
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
              <span v-if="e.jaCorrigidoNoExport" class="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0 mt-0.5">auto no export</span>
              <component :is="expandido === i ? ChevronUp : ChevronDown" class="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            </button>
            <div v-if="expandido === i" class="px-5 pb-4 pt-1 bg-slate-50/50 text-xs space-y-2">
              <p class="text-slate-600">{{ e.detalhe }}</p>
              <div class="grid sm:grid-cols-2 gap-2">
                <div v-if="e.valorAtual !== '' && e.valorAtual != null"><span class="text-slate-400">Valor atual:</span> <span class="font-mono text-slate-700 break-all">{{ e.valorAtual }}</span></div>
                <div v-if="e.valorSugerido !== undefined && e.valorSugerido !== ''"><span class="text-slate-400">Sugestão:</span> <span class="font-mono text-emerald-700 break-all">{{ e.valorSugerido }}</span></div>
              </div>
              <div class="bg-white border border-slate-100 rounded-xl p-3">
                <p class="text-[10px] uppercase font-bold text-slate-400 mb-1">Como corrigir no ERP</p>
                <p class="text-slate-600">{{ e.instrucaoERP || 'Corrija na origem (ERP) e gere o arquivo novamente.' }}</p>
              </div>
              <div v-if="e.corrigivel && idAtivo" class="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3">
                <p class="text-[10px] uppercase font-bold text-indigo-400 mb-1">Corrigir no sistema</p>
                <div class="flex items-center gap-2">
                  <input v-model="valoresCorrecao[keyErro(e)]" type="text" class="flex-1 h-8 text-xs border border-slate-200 rounded-lg px-2 font-mono" :placeholder="(e.valorSugerido != null && e.valorSugerido !== '') ? String(e.valorSugerido) : 'novo valor'">
                  <button @click="salvarCorrecao(e)" :disabled="salvando === keyErro(e)" class="px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 shrink-0">
                    {{ salvando === keyErro(e) ? 'Salvando…' : 'Salvar correção' }}
                  </button>
                </div>
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
