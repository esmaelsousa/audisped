<script setup>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { useRouter } from 'vue-router'
import { setEmpresaSelecionada } from '../store'
import { Search, Building2, ChevronRight, Plus, Trash2, X } from 'lucide-vue-next'
import UiButton from '../components/ui/UiButton.vue'

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
  <div class="max-w-6xl mx-auto py-8 px-4 sm:px-6 space-y-6 animate-fade-in">

    <!-- Header -->
    <header class="flex flex-col md:flex-row md:items-end justify-between gap-5 border-b border-line pb-5">
      <div class="space-y-1">
        <h1 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">Gestor de Clientes</h1>
        <p class="text-[13px] text-risco max-w-lg">Acesse os hubs de ferramentas e repositórios XML de cada unidade da sua carteira.</p>
      </div>

      <div class="flex flex-col sm:flex-row gap-2.5 w-full md:w-auto">
        <div class="relative flex-grow md:w-72">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-risco pointer-events-none" :stroke-width="1.8" />
          <input
            v-model="busca"
            type="text"
            placeholder="Buscar razão social ou CNPJ..."
            class="block w-full pl-9 pr-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors"
          />
        </div>
        <div class="flex gap-2">
          <UiButton variant="ghost" @click="isCreateModalOpen = true">
            <Building2 class="w-4 h-4 text-risco" :stroke-width="1.8" />
            Nova Empresa
          </UiButton>
          <UiButton @click="router.push('/analisador')">
            <Plus class="w-4 h-4" :stroke-width="2" />
            Processar Novo SPED
          </UiButton>
        </div>
      </div>
    </header>

    <!-- Lista de Empresas -->
    <section class="bg-sheet rounded-md border border-line overflow-hidden card-shadow">
      <div v-if="loading" class="p-12 text-center space-y-3">
        <div class="inline-block w-7 h-7 border-2 border-line border-t-bronze rounded-full animate-spin"></div>
        <p class="text-risco text-[13px]">Buscando empresas no servidor...</p>
      </div>

      <div v-else-if="empresasFiltradas.length > 0">
        <!-- Cabeçalho da Tabela -->
        <div class="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 bg-paper border-b border-line text-[10px] font-semibold text-risco uppercase tracking-[.08em]">
          <div class="col-span-5">Cliente</div>
          <div class="col-span-3">CNPJ</div>
          <div class="col-span-1 text-center">UF</div>
          <div class="col-span-3 text-right">Ação</div>
        </div>

        <!-- Itens -->
        <div class="divide-y divide-line">
          <div
            v-for="empresa in empresasFiltradas"
            :key="empresa.id"
            @click="selecionarEmpresa(empresa)"
            class="group grid grid-cols-1 md:grid-cols-12 gap-4 px-5 py-3.5 items-center hover:bg-paper cursor-pointer transition-colors"
          >
            <!-- Info Principal -->
            <div class="col-span-5 flex items-center gap-3">
              <div class="w-9 h-9 rounded-md border border-line bg-paper flex items-center justify-center text-risco flex-shrink-0 group-hover:border-bronze/40 group-hover:text-bronze transition-all">
                <Building2 class="w-5 h-5" :stroke-width="1.6" />
              </div>
              <div class="flex flex-col min-w-0">
                <h4 class="text-[13px] font-medium text-ink truncate">
                  {{ empresa.nome_fantasia || empresa.nome_empresa }}
                </h4>
                <p class="text-[11px] text-risco truncate" v-if="empresa.nome_fantasia">
                  {{ empresa.nome_empresa }}
                </p>
              </div>
            </div>

            <!-- CNPJ -->
            <div class="col-span-3 flex items-center md:block">
              <span class="md:hidden text-[10px] font-semibold text-risco uppercase mr-2">CNPJ:</span>
              <span class="text-[12px] font-mono text-ink">{{ formatCNPJ(empresa.cnpj) }}</span>
            </div>

            <!-- UF -->
            <div class="col-span-1 flex items-center md:justify-center">
              <span class="md:hidden text-[10px] font-semibold text-risco uppercase mr-2">UF:</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-paper border border-line text-ink">
                {{ empresa.uf }}
              </span>
            </div>

            <!-- Ações -->
            <div class="col-span-3 flex justify-end items-center gap-3">
              <button
                @click.stop="confirmDelete(empresa, $event)"
                class="p-1 rounded-md text-risco hover:text-lacre hover:bg-lacre/5 transition-colors"
                title="Excluir Empresa"
              >
                <Trash2 class="w-4 h-4" :stroke-width="1.6" />
              </button>
              <div class="text-[12px] font-medium text-bronze flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                Acessar
                <ChevronRight class="w-4 h-4" :stroke-width="1.8" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty/Search State -->
      <div v-else class="p-16 text-center">
        <Building2 class="mx-auto h-11 w-11 text-line" :stroke-width="1.4" />
        <h3 class="mt-4 text-[13px] font-medium text-ink">Nenhum cliente via SPED</h3>
        <p class="mt-1 text-[13px] text-risco">
          Processe um arquivo SPED no Motor de Auditoria para cadastrá-lo automaticamente.
        </p>
        <div class="mt-5">
          <button v-if="busca" @click="busca = ''" class="text-[13px] text-bronze hover:opacity-80 font-medium">
            Limpar filtros de pesquisa
          </button>
        </div>
      </div>
    </section>

    <!-- Footer Stats -->
    <footer v-if="!loading && empresas.length > 0" class="flex items-center text-[12px] text-risco">
      <span class="font-medium mr-1 text-ink">{{ empresas.length }}</span> clientes indexados a partir dos arquivos SPED.
    </footer>

    <!-- ===================== MODAL NOVA EMPRESA ===================== -->
    <div v-if="isCreateModalOpen" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end sm:items-center justify-center min-h-screen p-4">
        <div class="fixed inset-0 bg-ink/40 transition-opacity" @click="isCreateModalOpen = false"></div>
        <div class="relative bg-sheet rounded-md border border-line w-full sm:max-w-lg card-shadow">
          <div class="px-6 pt-5 pb-4">
            <div class="flex justify-between items-center border-b border-line pb-3 mb-4">
              <h3 class="font-display text-[16px] font-semibold text-ink">Cadastrar Nova Empresa</h3>
              <button @click="isCreateModalOpen = false" class="text-risco hover:text-ink transition-colors">
                <X class="w-5 h-5"/>
              </button>
            </div>
            <div class="space-y-3.5">
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">CNPJ (apenas números)*</label>
                <input type="text" v-model="novaEmpresa.cnpj" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Razão Social*</label>
                <input type="text" v-model="novaEmpresa.nome_empresa" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nome Fantasia</label>
                <input type="text" v-model="novaEmpresa.nome_fantasia" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors" />
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">UF</label>
                <input type="text" v-model="novaEmpresa.uf" maxlength="2" placeholder="Ex: SP" class="w-20 px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink uppercase outline-none focus:border-bronze transition-colors" />
              </div>
            </div>
          </div>
          <div class="bg-paper px-6 py-3 flex flex-row-reverse gap-2 border-t border-line rounded-b-md">
            <UiButton @click="criarEmpresa">Salvar Empresa</UiButton>
            <UiButton variant="ghost" @click="isCreateModalOpen = false">Cancelar</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== MODAL CONFIRMAR EXCLUSÃO ===================== -->
    <div v-if="isDeleteModalOpen" class="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div class="flex items-end sm:items-center justify-center min-h-screen p-4">
        <div class="fixed inset-0 bg-ink/40 transition-opacity" @click="isDeleteModalOpen = false"></div>
        <div class="relative bg-sheet rounded-md border border-line w-full sm:max-w-md card-shadow">
          <div class="px-6 pt-6 pb-4">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-md bg-lacre/10">
                <Trash2 class="h-5 w-5 text-lacre" :stroke-width="1.6" />
              </div>
              <div>
                <h3 class="font-display text-[16px] font-semibold text-ink">Excluir Cliente</h3>
                <p class="mt-2 text-[13px] text-risco leading-relaxed">
                  Tem certeza que deseja excluir a empresa <strong class="text-ink">{{ empresaToDelete?.nome_empresa }}</strong>?<br/><br/>
                  <span class="text-lacre font-semibold">Esta ação é irreversível</span> e apagará permanentemente todos os arquivos SPED processados, XMLs e notas fiscais vinculadas a este cliente.
                </p>
              </div>
            </div>
          </div>
          <div class="bg-paper px-6 py-3 flex flex-row-reverse gap-2 border-t border-line rounded-b-md">
            <button
              @click="deletarEmpresa"
              :disabled="deletando"
              type="button"
              class="inline-flex items-center justify-center gap-2 rounded-md px-[13px] py-[7px] bg-lacre text-white text-[13px] font-medium hover:opacity-85 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
            >
              <span v-if="deletando" class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              {{ deletando ? 'Excluindo...' : 'Sim, Excluir Permanentemente' }}
            </button>
            <UiButton variant="ghost" @click="isDeleteModalOpen = false" :disabled="deletando">Cancelar</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== TOAST DE FEEDBACK ===================== -->
    <transition name="toast">
      <div
        v-if="toast.show"
        :class="[
          'fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-md text-[13px] font-medium text-white card-shadow',
          toast.type === 'success' ? 'bg-conforme' : 'bg-lacre'
        ]"
      >
        <span v-if="toast.type === 'success'" class="text-base">✓</span>
        <span v-else class="text-base">✕</span>
        {{ toast.message }}
        <button @click="toast.show = false" class="ml-2 text-white/70 hover:text-white font-bold">×</button>
      </div>
    </transition>

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

.toast-enter-active, .toast-leave-active {
  transition: all 0.35s ease;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
