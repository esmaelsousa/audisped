<script setup>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { useRouter } from 'vue-router'
import { setEmpresaSelecionada, token } from '../store'
import { Search, Building2, ChevronRight, Plus } from 'lucide-vue-next'

const router = useRouter();
const empresas = ref([]);
const loading = ref(true);
const busca = ref('');

onMounted(async () => {
  await carregarEmpresas();
});

async function carregarEmpresas() {
  loading.value = true;
  try {
    const response = await axios.get(`${API_BASE_URL}/api/empresas`, {
        headers: { Authorization: `Bearer ${token.value}` }
    });
    empresas.value = response.data;
  } catch (error) {
    console.error('Falha ao buscar empresas:', error);
  } finally {
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
  // Roteia para o HUB da Empresa (Padrão Spoke)
  router.push(`/dashboard/${empresa.id}`); 
}

const formatCNPJ = (val) => val ? val.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : '';
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
            <!-- Cadastrar Novo Cliente é feito quando se processa um novo SPED pela primeira vez na Auditoria -->
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
              <div class="w-10 h-10 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-400 group-hover:border-blue-200 group-hover:text-brand-accent transition-all">
                <Building2 class="w-5 h-5" />
              </div>
              <div class="flex flex-col overflow-hidden">
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
            <div class="col-span-3 flex justify-end items-center">
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
</style>
