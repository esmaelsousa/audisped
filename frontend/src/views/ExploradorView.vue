<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { Search, Plus, FolderOpen, Trash2, ArrowRight, ArrowLeft, Loader2, FolderArchive, ChevronDown, ChevronRight, CalendarDays } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'

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
const pendingDelete = ref(null); // { ids: [], label: '' }
const deleteMsg = ref('');

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

function deletarArquivo(id, periodo) {
  pendingDelete.value = {
    ids: [id],
    label: `o período ${formatPeriodo(periodo)}`,
    modo: 'single',
  };
}

function deletarVariosArquivos() {
  const ids = [...selecionados.value];
  if (ids.length === 0) return;
  pendingDelete.value = {
    ids,
    label: `${ids.length} período(s) selecionado(s)`,
    modo: 'lote',
  };
}

async function confirmarDelete() {
  const { ids, modo } = pendingDelete.value;
  pendingDelete.value = null;
  try {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (modo === 'single') {
      await axios.delete(`${API_BASE_URL}/api/periodo/${ids[0]}`, { headers });
    } else {
      await axios.post(`${API_BASE_URL}/api/periodo/bulk-delete`, { ids }, { headers });
    }
    arquivos.value = arquivos.value.filter(a => !ids.includes(a.id));
    selecionados.value = selecionados.value.filter(i => !ids.includes(i));
    deleteMsg.value = 'Exclusão concluída com sucesso.';
  } catch (e) {
    deleteMsg.value = 'Falha ao excluir: ' + (e.response?.data?.message || e.message);
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
  <div class="max-w-6xl mx-auto py-8 px-4 sm:px-6 space-y-6 animate-fade-in">

    <!-- Header -->
    <header class="flex flex-col md:flex-row md:items-end justify-between gap-5 pb-5 border-b border-line">
      <div class="space-y-1">
        <button @click="router.push('/')" class="text-[11px] uppercase tracking-wide font-medium text-bronze hover:opacity-80 mb-2 flex items-center gap-1 group">
          <ArrowLeft class="w-3 h-3 group-hover:-translate-x-1 transition-transform" :stroke-width="1.8" />
          Voltar para empresas
        </button>
        <h1 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">
          Histórico de Auditorias
        </h1>
        <p class="text-[13px] text-risco">
          {{ empresa.nome_empresa }} <span class="font-mono text-[11px]">{{ empresa.cnpj }}</span>
        </p>
      </div>

      <div class="flex items-center gap-2.5 flex-wrap justify-end">
        <!-- Filtro por ano -->
        <div class="relative">
          <CalendarDays class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco pointer-events-none" :stroke-width="1.8" />
          <select v-model="anoFiltro"
            class="pl-9 pr-8 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-medium outline-none focus:border-bronze appearance-none cursor-pointer transition-colors">
            <option value="">Todos os anos</option>
            <option v-for="ano in anosDisponiveis" :key="ano" :value="ano">{{ ano }}</option>
          </select>
          <ChevronDown class="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-risco pointer-events-none" :stroke-width="1.8" />
        </div>

        <!-- Busca -->
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco pointer-events-none" :stroke-width="1.8" />
          <input v-model="busca" type="text" placeholder="Buscar período..."
                 class="pl-9 pr-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors w-52">
        </div>

        <UiButton @click="router.push('/analisador')">
          <Plus class="w-4 h-4" :stroke-width="2" />
          Nova Análise
        </UiButton>
      </div>
    </header>

    <!-- Toolbar de Ações em Massa -->
    <!-- Confirmação de exclusão -->
    <div v-if="pendingDelete" class="flex items-center justify-between gap-4 bg-lacre/[0.06] border border-lacre/25 rounded-md px-5 py-3">
      <div class="flex items-center gap-3">
        <Trash2 class="w-4 h-4 text-lacre shrink-0" :stroke-width="1.8" />
        <p class="text-[13px] font-medium text-lacre">Excluir permanentemente {{ pendingDelete.label }}? Esta ação não pode ser desfeita.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UiButton variant="ghost" @click="pendingDelete = null">Cancelar</UiButton>
        <button @click="confirmarDelete" class="inline-flex items-center gap-[7px] rounded-md text-[13px] font-medium px-[13px] py-[7px] bg-lacre text-white hover:opacity-85 transition-opacity">Confirmar</button>
      </div>
    </div>

    <!-- Resultado da exclusão -->
    <div v-if="deleteMsg" class="flex items-center justify-between gap-4 bg-conforme/[0.06] border border-conforme/25 rounded-md px-5 py-3">
      <p class="text-[13px] font-medium text-conforme">{{ deleteMsg }}</p>
      <UiButton variant="ghost" @click="deleteMsg = ''">Fechar</UiButton>
    </div>

    <div v-if="arquivos.length > 0" class="flex items-center justify-between bg-paper p-4 rounded-md border border-line">
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 cursor-pointer group">
          <input type="checkbox" :checked="selecionados.length === arquivosFiltrados.length && arquivosFiltrados.length > 0"
                 @change="selecionarTudo" class="w-4 h-4 rounded border-line text-bronze focus:ring-bronze accent-bronze" />
          <span class="text-[11px] uppercase tracking-wide font-medium text-risco group-hover:text-ink">Selecionar tudo</span>
        </label>
        <span v-if="selecionados.length > 0" class="text-[10px] font-mono uppercase tracking-[.05em] bg-bronze text-white px-2.5 py-0.5 rounded">
          {{ selecionados.length }} selecionado(s)
        </span>
      </div>
      <button v-if="selecionados.length > 0" @click="deletarVariosArquivos"
              class="inline-flex items-center gap-[7px] rounded-md text-[13px] font-medium px-[13px] py-[7px] bg-lacre text-white hover:opacity-85 transition-opacity">
        <Trash2 class="w-4 h-4" :stroke-width="1.8" />
        Excluir selecionados
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="py-32 flex flex-col items-center justify-center text-center">
      <Loader2 class="w-8 h-8 text-bronze animate-spin mb-4" :stroke-width="1.8" />
      <p class="text-risco text-[11px] uppercase tracking-wide font-medium">Carregando repositório...</p>
    </div>

    <!-- Erro de carregamento -->
    <div v-else-if="erroCarregamento" class="py-32 flex flex-col items-center justify-center text-center">
      <p class="text-lacre text-[13px] font-medium mb-3">Falha ao carregar arquivos. Verifique a conexão com o servidor.</p>
      <UiButton @click="() => { erroCarregamento = false; $nextTick(() => location.reload()); }">
        Tentar novamente
      </UiButton>
    </div>

    <!-- Lista agrupada por ano -->
    <div v-else-if="arquivosPorAno.length > 0" class="space-y-3">
      <div v-for="[ano, itens] in arquivosPorAno" :key="ano" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">

        <!-- Cabeçalho do ano (clicável) -->
        <button
          @click="toggleAno(ano)"
          class="w-full flex items-center justify-between px-5 py-3 hover:bg-paper transition-colors group"
        >
          <div class="flex items-center gap-3">
            <component :is="anosExpandidos.includes(ano) ? ChevronDown : ChevronRight"
              class="w-4 h-4 text-risco group-hover:text-bronze transition-colors" :stroke-width="1.8" />
            <span class="font-display text-[15px] font-semibold text-ink">{{ ano }}</span>
            <span class="text-[10px] font-mono uppercase tracking-[.05em] text-risco bg-paper border border-line px-2 py-0.5 rounded">
              {{ itens.length }} {{ itens.length === 1 ? 'período' : 'períodos' }}
            </span>
          </div>
          <span class="text-[11px] font-mono text-risco">
            {{ formatPeriodo(itens[itens.length - 1].periodo_apuracao) }} — {{ formatPeriodo(itens[0].periodo_apuracao) }}
          </span>
        </button>

        <!-- Tabela de registros (expansível) -->
        <div v-show="anosExpandidos.includes(ano)" class="border-t border-line">
          <table class="w-full text-[13px]">
            <thead>
              <tr class="bg-paper text-left">
                <th class="px-4 py-2 w-10"></th>
                <th class="px-4 py-2 font-medium text-risco uppercase tracking-wide text-[10px]">Período</th>
                <th class="px-4 py-2 font-medium text-risco uppercase tracking-wide text-[10px]">Arquivo</th>
                <th class="px-4 py-2 font-medium text-risco uppercase tracking-wide text-[10px]">Importado em</th>
                <th class="px-4 py-2 font-medium text-risco uppercase tracking-wide text-[10px] w-10 text-center">ID</th>
                <th class="px-4 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="arq in itens"
                :key="arq.id"
                class="group border-t border-line hover:bg-paper transition-colors cursor-pointer"
                :class="{'bg-bronze/[0.05]': selecionados.includes(arq.id)}"
              >
                <!-- Checkbox -->
                <td class="px-4 py-3" @click.stop>
                  <input type="checkbox" :checked="selecionados.includes(arq.id)" @change="toggleSelecao(arq.id)"
                         class="w-4 h-4 rounded border-line text-bronze focus:ring-bronze accent-bronze cursor-pointer" />
                </td>

                <!-- Período -->
                <td class="px-4 py-3" @click="abrirAnalise(arq.id)">
                  <span class="font-mono font-medium text-ink text-[14px]">
                    {{ formatPeriodo(arq.periodo_apuracao) }}
                  </span>
                </td>

                <!-- Nome arquivo -->
                <td class="px-4 py-3 max-w-xs" @click="abrirAnalise(arq.id)">
                  <div class="flex items-center gap-2">
                    <FolderOpen class="w-4 h-4 text-risco group-hover:text-bronze transition-colors shrink-0" :stroke-width="1.6" />
                    <span class="text-risco truncate text-[11px] font-mono">{{ arq.nome_arquivo }}</span>
                  </div>
                </td>

                <!-- Data -->
                <td class="px-4 py-3 text-risco text-[11px] font-mono" @click="abrirAnalise(arq.id)">
                  {{ formatData(arq.data_upload) }}
                </td>

                <!-- ID -->
                <td class="px-4 py-3 text-center" @click="abrirAnalise(arq.id)">
                  <span class="text-[10px] font-mono text-risco bg-paper border border-line px-1.5 py-0.5 rounded">#{{ arq.id }}</span>
                </td>

                <!-- Ações -->
                <td class="px-4 py-3" @click.stop>
                  <div class="flex items-center gap-1 justify-end">
                    <button
                      @click="abrirAnalise(arq.id)"
                      class="w-8 h-8 rounded-md bg-sheet border border-line text-risco hover:border-bronze/40 hover:bg-bronze/[0.05] hover:text-bronze transition-colors flex items-center justify-center"
                      title="Abrir análise"
                    >
                      <ArrowRight class="w-4 h-4" :stroke-width="1.8" />
                    </button>
                    <button
                      @click="deletarArquivo(arq.id, arq.periodo_apuracao)"
                      class="w-8 h-8 rounded-md bg-sheet border border-line text-risco hover:border-lacre/30 hover:bg-lacre/5 hover:text-lacre transition-colors flex items-center justify-center"
                      title="Excluir Período"
                    >
                      <Trash2 class="w-4 h-4" :stroke-width="1.8" />
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
    <div v-else class="bg-sheet rounded-md p-16 text-center border border-line card-shadow flex flex-col items-center">
      <FolderArchive class="w-11 h-11 text-line mb-4" :stroke-width="1.4" />
      <h2 class="font-display text-[15px] font-semibold text-ink">Nenhum arquivo encontrado</h2>
      <p class="text-risco max-w-sm mx-auto mt-1 mb-5 text-[13px]">Parece que ainda não processamos arquivos para este período ou empresa no repositório.</p>
      <UiButton @click="router.push('/analisador')">
        <Plus class="w-4 h-4" :stroke-width="2" />
        Começar primeira análise
      </UiButton>
    </div>

  </div>
</template>

<style scoped>
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
