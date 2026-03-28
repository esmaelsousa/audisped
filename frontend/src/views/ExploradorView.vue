<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { Search, Plus, FolderOpen, Trash2, ArrowRight, ArrowLeft, Loader2, FolderArchive, ChevronDown, ChevronRight, CalendarDays } from 'lucide-vue-next'

const route = useRoute();
const router = useRouter();
const empresaId = route.params.id;

const arquivos = ref([]);
const empresa = ref({ nome_empresa: 'Carregando...', cnpj: '' });
const loading = ref(false);
const erroCarregamento = ref(false);
const busca = ref('');
const anoFiltro = ref('');
const selecionados = ref([]);
const anosExpandidos = ref([]);

const getAno = (p) => String(p || '').substring(0, 4) || '—';

const formatPeriodo = (p) => {
  const s = String(p || '');
  if (s.length >= 10) return `${s.substring(5, 7)}/${s.substring(0, 4)}`;
  if (s.length === 6)  return `${s.substring(0, 2)}/${s.substring(2)}`;
  return s;
};

const formatData = (d) => {
  if (!d) return '-';
  const s = String(d).substring(0, 10);
  return `${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}`;
};

onMounted(async () => {
  loading.value = true;
  erroCarregamento.value = false;
  // Segurança: garante que o spinner nunca fica travado para sempre
  const safetyTimer = setTimeout(() => { loading.value = false; }, 15000);
  try {
    const [resEmpresas, resArquivos] = await Promise.all([
      axios.get(`${API_BASE_URL}/api/empresas`),
      axios.get(`${API_BASE_URL}/api/arquivos/${empresaId}`)
    ]);

    const emp = resEmpresas.data.find(e => e.id == empresaId);
    if (emp) empresa.value = emp;

    arquivos.value = (resArquivos.data || []).sort((a, b) => {
      const toNum = (p) => {
        const s = String(p || '');
        if (s.length >= 10) return Number(s.substring(0, 4)) * 100 + Number(s.substring(5, 7));
        return 0;
      };
      return toNum(b.periodo_apuracao) - toNum(a.periodo_apuracao);
    });

    if (arquivos.value.length > 0) {
      anosExpandidos.value.push(getAno(arquivos.value[0].periodo_apuracao));
    }
  } catch (error) {
    console.error('Erro ao carregar histórico:', error);
    // 401/403 já é tratado pelo interceptor global (redireciona para login)
    if (error.response?.status !== 401 && error.response?.status !== 403) {
      erroCarregamento.value = true;
    }
  } finally {
    clearTimeout(safetyTimer);
    loading.value = false;
  }
});

const anosDisponiveis = computed(() => {
  const anos = [...new Set(arquivos.value.map(a => getAno(a.periodo_apuracao)))];
  return anos.filter(Boolean).sort((a, b) => b - a);
});

const arquivosFiltrados = computed(() => {
  let lista = arquivos.value;
  if (busca.value)
    lista = lista.filter(a =>
      a.nome_arquivo.toLowerCase().includes(busca.value.toLowerCase()) ||
      String(a.periodo_apuracao || '').includes(busca.value)
    );
  if (anoFiltro.value)
    lista = lista.filter(a => getAno(a.periodo_apuracao) === anoFiltro.value);
  return lista;
});

const arquivosPorAno = computed(() => {
  const grupos = {};
  arquivosFiltrados.value.forEach(a => {
    const ano = getAno(a.periodo_apuracao);
    if (!grupos[ano]) grupos[ano] = [];
    grupos[ano].push(a);
  });
  return Object.entries(grupos).sort(([a], [b]) => b - a);
});

function toggleAno(ano) {
  const idx = anosExpandidos.value.indexOf(ano);
  if (idx !== -1) anosExpandidos.value.splice(idx, 1);
  else anosExpandidos.value.push(ano);
}

async function deletarArquivo(id, periodo) {
  if (!confirm(`TEM CERTEZA?\n\nIsso excluirá permanentemente todos os dados e análises do período ${formatPeriodo(periodo)}.\nEsta ação não pode ser desfeita.`)) return;
  try {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    await axios.delete(`${API_BASE_URL}/api/periodo/${id}`, { headers });
    arquivos.value = arquivos.value.filter(a => a.id !== id);
    selecionados.value = selecionados.value.filter(i => i !== id);
  } catch (e) {
    alert("Falha ao excluir arquivo: " + (e.response?.data?.message || e.message));
  }
}

async function deletarVariosArquivos() {
  const ids = [...selecionados.value];
  if (ids.length === 0) return;
  if (!confirm(`VOCÊ SELECIONOU ${ids.length} PERÍODO(S).\n\nDESEJA EXCLUIR TODOS PERMANENTEMENTE?\nEsta ação não pode ser desfeita.`)) return;
  try {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    await axios.post(`${API_BASE_URL}/api/periodo/bulk-delete`, { ids }, { headers });
    arquivos.value = arquivos.value.filter(a => !selecionados.value.includes(a.id));
    selecionados.value = [];
    alert("Exclusão concluída com sucesso.");
  } catch (e) {
    alert("Falha ao excluir arquivos em lote: " + (e.response?.data?.message || e.message));
  }
}

function toggleSelecao(id) {
  const idx = selecionados.value.indexOf(id);
  if (idx !== -1) selecionados.value.splice(idx, 1);
  else selecionados.value.push(id);
}

function selecionarTudo() {
  if (selecionados.value.length === arquivosFiltrados.value.length) {
    selecionados.value = [];
  } else {
    selecionados.value = arquivosFiltrados.value.map(a => a.id);
  }
}

function abrirAnalise(id) {
  router.push(`/analisador/${id}`);
}
</script>

<template>
  <div class="max-w-6xl mx-auto py-10 px-6 space-y-8 animate-fade-in">

    <!-- Header -->
    <header class="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-100">
      <div class="space-y-1">
        <button @click="router.push('/')" class="text-xs font-black text-brand-accent hover:underline mb-2 flex items-center gap-1 group">
          <ArrowLeft class="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          VOLTAR PARA EMPRESAS
        </button>
        <h1 class="text-4xl font-black text-slate-800 tracking-tight">
          Histórico de <span class="text-brand-accent">Auditorias</span>
        </h1>
        <p class="text-slate-400 font-medium">
          {{ empresa.nome_empresa }} • <span class="font-mono text-xs">{{ empresa.cnpj }}</span>
        </p>
      </div>

      <div class="flex items-center gap-3 flex-wrap justify-end">
        <!-- Filtro por ano -->
        <div class="relative">
          <CalendarDays class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <select v-model="anoFiltro"
            class="pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm text-slate-600 font-semibold shadow-sm focus:outline-none focus:ring-1 focus:ring-brand-accent focus:border-brand-accent appearance-none cursor-pointer transition-all">
            <option value="">Todos os anos</option>
            <option v-for="ano in anosDisponiveis" :key="ano" :value="ano">{{ ano }}</option>
          </select>
          <ChevronDown class="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>

        <!-- Busca -->
        <div class="relative group">
          <input v-model="busca" type="text" placeholder="Buscar período..."
                 class="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl focus:ring-1 focus:ring-brand-accent focus:border-brand-accent outline-none transition-all text-sm w-52 shadow-sm placeholder:text-slate-400">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-hover:text-brand-accent transition-colors" />
        </div>

        <button @click="router.push('/analisador')" class="px-6 py-2.5 flex items-center gap-2 bg-brand-accent text-white font-bold rounded-2xl shadow-lg shadow-brand-accent/20 hover:scale-[1.02] transition-all text-sm">
          <Plus class="w-4 h-4" />
          NOVA ANÁLISE
        </button>
      </div>
    </header>

    <!-- Toolbar de Ações em Massa -->
    <div v-if="arquivos.length > 0" class="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-200">
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 cursor-pointer group">
          <input type="checkbox" :checked="selecionados.length === arquivosFiltrados.length && arquivosFiltrados.length > 0"
                 @change="selecionarTudo" class="w-5 h-5 rounded border-slate-300 text-brand-accent focus:ring-brand-accent" />
          <span class="text-sm font-bold text-slate-600 group-hover:text-slate-800">SELECIONAR TUDO</span>
        </label>
        <span v-if="selecionados.length > 0" class="text-xs font-black bg-brand-accent text-white px-3 py-1 rounded-full animate-bounce">
          {{ selecionados.length }} SELECIONADO(S)
        </span>
      </div>
      <button v-if="selecionados.length > 0" @click="deletarVariosArquivos"
              class="px-6 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-2 shadow-lg shadow-red-100">
        <Trash2 class="w-4 h-4" />
        EXCLUIR SELECIONADOS
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-32 flex flex-col items-center justify-center text-center">
      <Loader2 class="w-12 h-12 text-slate-300 animate-spin mb-4" />
      <p class="text-slate-400 font-bold tracking-widest text-xs uppercase">Carregando Repositório...</p>
    </div>

    <!-- Erro de carregamento -->
    <div v-else-if="erroCarregamento" class="py-32 flex flex-col items-center justify-center text-center">
      <p class="text-red-400 font-bold text-sm mb-3">Falha ao carregar arquivos. Verifique a conexão com o servidor.</p>
      <button @click="() => { erroCarregamento = false; $nextTick(() => location.reload()); }"
        class="px-5 py-2 bg-brand-accent text-white text-xs font-bold rounded-xl">
        Tentar novamente
      </button>
    </div>

    <!-- Lista agrupada por ano -->
    <div v-else-if="arquivosPorAno.length > 0" class="space-y-3">
      <div v-for="[ano, itens] in arquivosPorAno" :key="ano" class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

        <!-- Cabeçalho do ano (clicável) -->
        <button
          @click="toggleAno(ano)"
          class="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/80 transition-colors group"
        >
          <div class="flex items-center gap-3">
            <component :is="anosExpandidos.includes(ano) ? ChevronDown : ChevronRight"
              class="w-4 h-4 text-slate-400 group-hover:text-brand-accent transition-all" />
            <span class="text-base font-black text-slate-700 tracking-tight">{{ ano }}</span>
            <span class="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {{ itens.length }} {{ itens.length === 1 ? 'período' : 'períodos' }}
            </span>
          </div>
          <span class="text-xs text-slate-300 font-medium">
            {{ formatPeriodo(itens[itens.length - 1].periodo_apuracao) }} — {{ formatPeriodo(itens[0].periodo_apuracao) }}
          </span>
        </button>

        <!-- Tabela de registros (expansível) -->
        <div v-show="anosExpandidos.includes(ano)" class="border-t border-slate-50">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-slate-50/60 border-b border-slate-100 text-left">
                <th class="px-4 py-2.5 w-10"></th>
                <th class="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-widest text-xs">Período</th>
                <th class="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-widest text-xs">Arquivo</th>
                <th class="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-widest text-xs">Importado em</th>
                <th class="px-4 py-2.5 font-bold text-slate-400 uppercase tracking-widest text-xs w-10 text-center">ID</th>
                <th class="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="arq in itens"
                :key="arq.id"
                class="group border-b border-slate-50 last:border-0 hover:bg-slate-50/70 transition-colors cursor-pointer"
                :class="{'bg-brand-accent/5': selecionados.includes(arq.id)}"
              >
                <!-- Checkbox -->
                <td class="px-4 py-3" @click.stop>
                  <input type="checkbox" :checked="selecionados.includes(arq.id)" @change="toggleSelecao(arq.id)"
                         class="w-4 h-4 rounded border-slate-300 text-brand-accent focus:ring-brand-accent cursor-pointer" />
                </td>

                <!-- Período -->
                <td class="px-4 py-3" @click="abrirAnalise(arq.id)">
                  <span class="font-black text-slate-800 font-mono tracking-tight text-base">
                    {{ formatPeriodo(arq.periodo_apuracao) }}
                  </span>
                </td>

                <!-- Nome arquivo -->
                <td class="px-4 py-3 max-w-xs" @click="abrirAnalise(arq.id)">
                  <div class="flex items-center gap-2">
                    <FolderOpen class="w-4 h-4 text-slate-300 group-hover:text-brand-accent transition-colors shrink-0" />
                    <span class="text-slate-500 truncate text-xs font-medium">{{ arq.nome_arquivo }}</span>
                  </div>
                </td>

                <!-- Data -->
                <td class="px-4 py-3 text-slate-400 text-xs font-medium" @click="abrirAnalise(arq.id)">
                  {{ formatData(arq.data_upload) }}
                </td>

                <!-- ID -->
                <td class="px-4 py-3 text-center" @click="abrirAnalise(arq.id)">
                  <span class="text-[10px] font-black text-slate-300 bg-slate-50 border border-slate-100 px-2 py-1 rounded-md">#{{ arq.id }}</span>
                </td>

                <!-- Ações -->
                <td class="px-4 py-3" @click.stop>
                  <div class="flex items-center gap-1 justify-end">
                    <button
                      @click="abrirAnalise(arq.id)"
                      class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 hover:border-brand-accent/30 hover:bg-brand-accent/5 hover:text-brand-accent transition-all flex items-center justify-center shadow-sm"
                      title="Abrir análise"
                    >
                      <ArrowRight class="w-4 h-4" />
                    </button>
                    <button
                      @click="deletarArquivo(arq.id, arq.periodo_apuracao)"
                      class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-500 transition-all flex items-center justify-center shadow-sm"
                      title="Excluir Período"
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Vazio -->
    <div v-else class="bg-white rounded-[3rem] p-24 text-center border border-dashed border-slate-200 flex flex-col items-center shadow-sm">
      <div class="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 border border-slate-100">
        <FolderArchive class="w-10 h-10 text-slate-300" />
      </div>
      <h2 class="text-xl font-bold text-slate-700">Nenhum arquivo encontrado</h2>
      <p class="text-slate-400 max-w-sm mx-auto mt-2 mb-8 text-sm">Parece que ainda não processamos arquivos para este período ou empresa no repositório.</p>
      <button @click="router.push('/analisador')" class="px-8 py-3.5 flex items-center gap-2 bg-brand-accent hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-md">
        <Plus class="w-4 h-4" />
        COMEÇAR PRIMEIRA ANÁLISE
      </button>
    </div>

  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
