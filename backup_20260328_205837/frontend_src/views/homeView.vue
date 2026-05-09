<script setup>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { useRouter } from 'vue-router'
import { setEmpresaSelecionada } from '../store'
import { Search, Building2, ChevronRight, Plus, Trash2, X } from 'lucide-vue-next'

const router = useRouter();
const empresas = ref([]);
const loading = ref(true);
const busca = ref('');

// Modals State
const isCreateModalOpen = ref(false);
const isDeleteModalOpen = ref(false);
const empresaToDelete = ref(null);
const deletando = ref(false);

// Toast State
const toast = ref({ show: false, message: '', type: 'success' });
function showToast(message, type = 'success') {
  toast.value = { show: true, message, type };
  setTimeout(() => { toast.value.show = false; }, 4000);
}

const novaEmpresa = ref({
  cnpj: '',
  nome_empresa: '',
  uf: '',
  nome_fantasia: ''
});

onMounted(async () => {
  await carregarEmpresas();
});

async function carregarEmpresas() {
  loading.value = true;
  // Segurança: garante que o spinner nunca fica travado para sempre
  const safetyTimer = setTimeout(() => { loading.value = false; }, 15000);
  try {
    const response = await axios.get(`${API_BASE_URL}/api/empresas`);
    empresas.value = response.data;
  } catch (error) {
    // 401/403 já é tratado pelo interceptor global (redireciona para login)
    if (error.response?.status !== 401 && error.response?.status !== 403) {
      console.error('Falha ao buscar empresas:', error);
    }
  } finally {
    clearTimeout(safetyTimer);
    loading.value = false;
  }
}

const empresasFiltradas = computed(() => {
  if (!busca.value) return empresas.value;
  const termo = busca.value.toLowerCase();
  return empresas.value.filter(e =>
    e.nome_empresa?.toLowerCase().includes(termo) ||
    e.nome_fantasia?.toLowerCase().includes(termo) ||
    e.cnpj?.includes(termo)
  );
});

function selecionarEmpresa(empresa) {
  setEmpresaSelecionada(empresa);
  router.push(`/dashboard/${empresa.id}`);
}

const formatCNPJ = (val) => val ? val.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : '';

function confirmDelete(empresa, event) {
  event.stopPropagation();
  empresaToDelete.value = empresa;
  isDeleteModalOpen.value = true;
}

async function deletarEmpresa() {
  if (!empresaToDelete.value || deletando.value) return;
  const nomeEmpresa = empresaToDelete.value.nome_empresa;
  const idEmpresa = empresaToDelete.value.id;
  deletando.value = true;
  try {
    await axios.delete(`${API_BASE_URL}/api/empresas/${idEmpresa}?cascade=true`);
    empresas.value = empresas.value.filter(e => e.id !== idEmpresa);
    isDeleteModalOpen.value = false;
    empresaToDelete.value = null;
    showToast(`Empresa "${nomeEmpresa}" excluída com sucesso.`, 'success');
  } catch (error) {
    console.error('Falha ao excluir empresa:', error);
    isDeleteModalOpen.value = false;
    empresaToDelete.value = null;
    showToast(error.response?.data?.message || 'Erro ao excluir a empresa. Tente novamente.', 'error');
  } finally {
    deletando.value = false;
  }
}

async function criarEmpresa() {
  if (!novaEmpresa.value.cnpj || !novaEmpresa.value.nome_empresa) {
    alert("Preencha CNPJ e Nome da Empresa.");
    return;
  }
  const rawCnpj = novaEmpresa.value.cnpj.replace(/\D/g, '');
  try {
    await axios.post(`${API_BASE_URL}/api/empresas`, {
      cnpj: rawCnpj,
      nome_empresa: novaEmpresa.value.nome_empresa,
      uf: novaEmpresa.value.uf.toUpperCase(),
      nome_fantasia: novaEmpresa.value.nome_fantasia
    });
    await carregarEmpresas();
    novaEmpresa.value = { cnpj: '', nome_empresa: '', uf: '', nome_fantasia: '' };
    isCreateModalOpen.value = false;
  } catch (error) {
    console.error('Falha ao criar empresa:', error);
    alert(error.response?.data?.message || 'Erro ao criar empresa.');
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto py-8 space-y-8 animate-fade-in">

    <!-- Header Hero -->
    <header class="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-200 pb-6">
      <div class="space-y-1">
        <h1 class="text-3xl font-semibold text-slate-900 tracking-tight">
          Gestor de Clientes
        </h1>
        <p class="text-slate-500 text-sm max-w-lg">
          Acesse os hubs de ferramentas e repositórios XML de cada unidade da sua carteira.
        </p>
      </div>

      <div class="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
        <div class="relative group flex-grow md:w-80">
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search class="h-4 w-4 text-slate-400" />
          </div>
          <input
            v-model="busca"
            type="text"
            placeholder="Buscar razão social ou CNPJ..."
            class="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-accent focus:border-brand-accent sm:text-sm transition-colors"
          />
        </div>
        <div class="flex gap-2">
          <button
            @click="isCreateModalOpen = true"
            class="inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md shadow-sm text-slate-700 bg-white hover:bg-slate-50 transition-colors gap-2"
          >
            <Building2 class="w-4 h-4 text-slate-400" />
            Nova Empresa
          </button>
          <button
            @click="router.push('/analisador')"
            class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-brand-accent hover:bg-blue-700 transition-colors gap-2"
          >
            <Plus class="w-4 h-4" />
            Processar Novo SPED
          </button>
        </div>
      </div>
    </header>

    <!-- Lista de Empresas -->
    <section class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div v-if="loading" class="p-12 text-center space-y-3">
        <div class="inline-block w-8 h-8 border-2 border-slate-200 border-t-brand-accent rounded-full animate-spin"></div>
        <p class="text-slate-500 text-sm font-medium">Buscando empresas no servidor...</p>
      </div>

      <div v-else-if="empresasFiltradas.length > 0">
        <!-- Cabeçalho da Tabela -->
        <div class="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div class="col-span-5">Cliente</div>
          <div class="col-span-3">CNPJ</div>
          <div class="col-span-1 text-center">UF</div>
          <div class="col-span-3 text-right">Ação</div>
        </div>

        <!-- Itens -->
        <div class="divide-y divide-slate-100">
          <div
            v-for="empresa in empresasFiltradas"
            :key="empresa.id"
            @click="selecionarEmpresa(empresa)"
            class="group grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50 cursor-pointer transition-colors"
          >
            <!-- Info Principal -->
            <div class="col-span-5 flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-400 flex-shrink-0 group-hover:border-blue-200 group-hover:text-brand-accent transition-all">
                <Building2 class="w-5 h-5" />
              </div>
              <div class="flex flex-col min-w-0">
                <h4 class="text-sm font-semibold text-slate-900 truncate">
                  {{ empresa.nome_fantasia || empresa.nome_empresa }}
                </h4>
                <p class="text-xs text-slate-500 truncate" v-if="empresa.nome_fantasia">
                  {{ empresa.nome_empresa }}
                </p>
              </div>
            </div>

            <!-- CNPJ -->
            <div class="col-span-3 flex items-center md:block">
              <span class="md:hidden text-xs font-semibold text-slate-400 uppercase mr-2">CNPJ:</span>
              <span class="text-sm font-mono text-slate-600">{{ formatCNPJ(empresa.cnpj) }}</span>
            </div>

            <!-- UF -->
            <div class="col-span-1 flex items-center md:justify-center">
              <span class="md:hidden text-xs font-semibold text-slate-400 uppercase mr-2">UF:</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
                {{ empresa.uf }}
              </span>
            </div>

            <!-- Ações -->
            <div class="col-span-3 flex justify-end items-center gap-4">
              <button
                @click.stop="confirmDelete(empresa, $event)"
                class="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Excluir Empresa"
              >
                <Trash2 class="w-4 h-4" />
              </button>
              <div class="text-sm font-medium text-brand-accent flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                Acessar
                <ChevronRight class="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty/Search State -->
      <div v-else class="p-16 text-center">
        <Building2 class="mx-auto h-12 w-12 text-slate-300" />
        <h3 class="mt-4 text-sm font-medium text-slate-900">Nenhum cliente via SPED</h3>
        <p class="mt-1 text-sm text-slate-500">
          Processe um arquivo SPED no Motor de Auditoria para cadastrá-lo automaticamente.
        </p>
        <div class="mt-6">
          <button v-if="busca" @click="busca = ''" class="text-sm text-brand-accent hover:text-blue-800 font-medium">
            Limpar filtros de pesquisa
          </button>
        </div>
      </div>
    </section>

    <!-- Footer Stats -->
    <footer v-if="!loading && empresas.length > 0" class="flex items-center text-xs text-slate-400">
      <span class="font-medium mr-1 text-slate-500">{{ empresas.length }}</span> clientes indexados a partir dos arquivos SPED.
    </footer>

    <!-- ===================== MODAL NOVA EMPRESA ===================== -->
    <div v-if="isCreateModalOpen" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div class="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" @click="isCreateModalOpen = false"></div>
        <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg w-full relative">
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <h3 class="text-lg leading-6 font-medium text-slate-900">Cadastrar Nova Empresa</h3>
              <button @click="isCreateModalOpen = false" class="text-slate-400 hover:text-slate-500">
                <X class="w-5 h-5"/>
              </button>
            </div>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-700">CNPJ (Apenas números)*</label>
                <input type="text" v-model="novaEmpresa.cnpj" class="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-accent focus:border-brand-accent sm:text-sm" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700">Razão Social*</label>
                <input type="text" v-model="novaEmpresa.nome_empresa" class="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-accent focus:border-brand-accent sm:text-sm" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700">Nome Fantasia</label>
                <input type="text" v-model="novaEmpresa.nome_fantasia" class="mt-1 block w-full border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-accent focus:border-brand-accent sm:text-sm" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700">UF</label>
                <input type="text" v-model="novaEmpresa.uf" maxlength="2" placeholder="Ex: SP" class="mt-1 block w-20 border border-slate-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-brand-accent focus:border-brand-accent sm:text-sm" />
              </div>
            </div>
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-slate-100">
            <button @click="criarEmpresa" type="button" class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-brand-accent text-base font-medium text-white hover:bg-blue-700 sm:ml-3 sm:w-auto sm:text-sm">
              Salvar Empresa
            </button>
            <button @click="isCreateModalOpen = false" type="button" class="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== MODAL CONFIRMAR EXCLUSÃO ===================== -->
    <div v-if="isDeleteModalOpen" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div class="fixed inset-0 bg-slate-500 bg-opacity-75 transition-opacity" @click="isDeleteModalOpen = false"></div>
        <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md w-full relative">
          <div class="bg-white px-6 pt-6 pb-4">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-red-100">
                <Trash2 class="h-6 w-6 text-red-600" />
              </div>
              <div>
                <h3 class="text-lg font-semibold text-slate-900">Excluir Cliente</h3>
                <p class="mt-2 text-sm text-slate-500">
                  Tem certeza que deseja excluir a empresa <strong>{{ empresaToDelete?.nome_empresa }}</strong>?<br/><br/>
                  <span class="text-red-600 font-semibold">Esta ação é irreversível</span> e apagará permanentemente todos os arquivos SPED processados, XMLs e notas fiscais vinculadas a este cliente.
                </p>
              </div>
            </div>
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 flex flex-row-reverse gap-3 border-t border-slate-100">
            <button
              @click="deletarEmpresa"
              :disabled="deletando"
              type="button"
              class="inline-flex items-center justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <span v-if="deletando" class="mr-2 inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              {{ deletando ? 'Excluindo...' : 'Sim, Excluir Permanentemente' }}
            </button>
            <button
              @click="isDeleteModalOpen = false"
              :disabled="deletando"
              type="button"
              class="inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== TOAST DE FEEDBACK ===================== -->
    <transition name="toast">
      <div
        v-if="toast.show"
        :class="[
          'fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-lg shadow-xl text-sm font-semibold text-white',
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        ]"
      >
        <span v-if="toast.type === 'success'" class="text-lg">✓</span>
        <span v-else class="text-lg">✕</span>
        {{ toast.message }}
        <button @click="toast.show = false" class="ml-2 text-white opacity-70 hover:opacity-100 font-bold">×</button>
      </div>
    </transition>

  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

.toast-enter-active, .toast-leave-active {
  transition: all 0.35s ease;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
