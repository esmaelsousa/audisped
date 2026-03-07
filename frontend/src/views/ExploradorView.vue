<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { Search, Plus, FolderOpen, Trash2, ArrowRight, ArrowLeft, Loader2, FolderArchive } from 'lucide-vue-next'

const route = useRoute();
const router = useRouter();
const empresaId = route.params.id;

const arquivos = ref([]);
const empresa = ref({ nome_empresa: 'Carregando...', cnpj: '' });
const loading = ref(true);
const busca = ref('');
const selecionados = ref(new Set());

onMounted(async () => {
  try {
    // Buscar info da empresa (poderíamos ter no store, mas vamos garantir via API)
    const resEmpresas = await axios.get(`${API_BASE_URL}/api/empresas`);
    const emp = resEmpresas.data.find(e => e.id == empresaId);
    if (emp) empresa.value = emp;

    // Buscar lista de arquivos
    const resArquivos = await axios.get(`${API_BASE_URL}/api/arquivos/${empresaId}`);
    arquivos.value = resArquivos.data;
  } catch (error) {
    console.error('Erro ao carregar histórico:', error);
  } finally {
    loading.value = false;
  }
});

async function deletarArquivo(id, periodo) {
  if (!confirm(`TEM CERTEZA?\n\nIsso excluirá permanentemente todos os dados e análises do período ${formatPeriodo(periodo)}.\nEsta ação não pode ser desfeita.`)) return;

  try {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    await axios.delete(`${API_BASE_URL}/api/periodo/${id}`, { headers });
    arquivos.value = arquivos.value.filter(a => a.id !== id);
    selecionados.value.delete(id);
  } catch (e) {
    alert("Falha ao excluir arquivo: " + (e.response?.data?.message || e.message));
  }
}

async function deletarVariosArquivos() {
  const ids = Array.from(selecionados.value);
  if (ids.length === 0) return;

  if (!confirm(`VOCÊ SELECIONOU ${ids.length} PERÍODO(S).\n\nDESEJA EXCLUIR TODOS PERMANENTEMENTE?\nEsta ação não pode ser desfeita.`)) return;

  try {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    await axios.post(`${API_BASE_URL}/api/periodo/bulk-delete`, { ids }, { headers });
    
    arquivos.value = arquivos.value.filter(a => !selecionados.value.has(a.id));
    selecionados.value.clear();
    alert("Exclusão concluída com sucesso.");
  } catch (e) {
    alert("Falha ao excluir arquivos em lote: " + (e.response?.data?.message || e.message));
  }
}

function toggleSelecao(id) {
  if (selecionados.value.has(id)) selecionados.value.delete(id);
  else selecionados.value.add(id);
}

function selecionarTudo() {
  if (selecionados.value.size === arquivosFiltrados.value.length) {
    selecionados.value.clear();
  } else {
    arquivosFiltrados.value.forEach(a => selecionados.value.add(a.id));
  }
}

const arquivosFiltrados = computed(() => {
  if (!busca.value) return arquivos.value;
  return arquivos.value.filter(a => 
    a.nome_arquivo.toLowerCase().includes(busca.value.toLowerCase()) || 
    a.periodo_apuracao.includes(busca.value)
  );
});


function abrirAnalise(id) {
  router.push(`/analisador/${id}`);
}

const formatData = (d) => new Date(d).toLocaleDateString('pt-BR');
const formatPeriodo = (p) => {
  if (!p || p.length !== 6) return p;
  return `${p.substring(0, 2)}/${p.substring(2)}`;
};
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
      
      <div class="flex items-center gap-4">
         <div class="relative group">
            <input v-model="busca" type="text" placeholder="Buscar período (MM/AAAA)..." 
                   class="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl focus:ring-1 focus:ring-brand-accent focus:border-brand-accent outline-none transition-all text-sm w-64 shadow-sm placeholder:text-slate-400">
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
             <input type="checkbox" :checked="selecionados.size === arquivosFiltrados.length && arquivosFiltrados.length > 0" 
                    @change="selecionarTudo" class="w-5 h-5 rounded border-slate-300 text-brand-accent focus:ring-brand-accent" />
             <span class="text-sm font-bold text-slate-600 group-hover:text-slate-800">SELECIONAR TUDO</span>
          </label>
          <span v-if="selecionados.size > 0" class="text-xs font-black bg-brand-accent text-white px-3 py-1 rounded-full animate-bounce">
             {{ selecionados.size }} SELECIONADO(S)
          </span>
       </div>
       <button v-if="selecionados.size > 0" @click="deletarVariosArquivos" 
               class="px-6 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-2 shadow-lg shadow-red-100">
          <Trash2 class="w-4 h-4" />
          EXCLUIR SELECIONADOS
       </button>
    </div>

    <div v-if="loading" class="py-32 flex flex-col items-center justify-center text-center">
       <Loader2 class="w-12 h-12 text-slate-300 animate-spin mb-4" />
       <p class="text-slate-400 font-bold tracking-widest text-xs uppercase">Carregando Repositório...</p>
    </div>

    <div v-else-if="arquivosFiltrados.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
       <div 
         v-for="arq in arquivosFiltrados" 
         :key="arq.id"
         class="group bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer border-l-4 border-l-transparent hover:border-l-brand-accent relative"
         :class="{'border-brand-accent bg-brand-accent/5': selecionados.has(arq.id)}"
       >
         <!-- Checkbox de Seleção -->
         <div class="absolute top-6 left-6 z-10" @click.stop>
            <input type="checkbox" :checked="selecionados.has(arq.id)" @change="toggleSelecao(arq.id)"
                   class="w-5 h-5 rounded-lg border-slate-300 text-brand-accent focus:ring-brand-accent cursor-pointer shadow-sm" />
         </div>

         <div @click="abrirAnalise(arq.id)" class="pt-2">
            <div class="flex justify-between items-start mb-4">
                <div class="w-12 h-12 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-brand-accent/5 group-hover:text-brand-accent group-hover:border-brand-accent/20 transition-all ml-8">
                  <FolderOpen class="w-6 h-6" />
                </div>
                <div class="flex gap-2">
                  <button 
                    @click.stop="deletarArquivo(arq.id, arq.periodo_apuracao)"
                    class="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-500 transition-all flex items-center justify-center shadow-sm"
                    title="Excluir Período"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                  <span class="text-[10px] font-black bg-slate-50 text-slate-400 px-2 py-1 h-8 flex items-center rounded-lg uppercase tracking-tighter self-center border border-slate-100">
                    ID: #{{ arq.id }}
                  </span>
                </div>
            </div>
            
            <div class="space-y-1">
                <h3 class="text-2xl font-black text-slate-700 font-mono tracking-tighter">
                  {{ formatPeriodo(arq.periodo_apuracao) }}
                </h3>
                <p class="text-xs text-slate-400 truncate font-medium">{{ arq.nome_arquivo }}</p>
            </div>

            <div class="mt-6 pt-4 border-t border-slate-50 flex items-center justify-between">
                <div class="text-[10px] text-slate-300 font-bold uppercase tracking-widest">
                  Lido em: {{ formatData(arq.data_upload) }}
                </div>
                <div class="w-8 h-8 rounded-full bg-brand-accent/5 flex items-center justify-center text-brand-accent opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
                  <ArrowRight class="w-4 h-4" />
                </div>
            </div>
         </div>
       </div>
    </div>

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