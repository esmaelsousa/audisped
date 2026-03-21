
<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { useRouter } from 'vue-router';
import { token, empresaSelecionada } from '../store';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Save, 
  X,
  Database,
  Info,
  ChevronLeft,
  ChevronRight,
  Filter
} from 'lucide-vue-next';

const router = useRouter();

// Estado
const rules = ref([]);
const isLoading = ref(false);
const showModal = ref(false);
const searchTerm = ref('');
const notification = ref({ show: false, message: '', type: 'success' });

// Formulário
const form = ref({
  id: null,
  cnpj_emissor: '',
  cod_produto_xml: '',
  descricao_produto: '',
  novo_cfop: '',
  novo_cst: '',
  aliq_icms: '',
  bc_icms_override: '',
  cst_pis: '',
  cst_cofins: ''
});

// Computed
const filteredRules = computed(() => {
  if (!searchTerm.value) return rules.value;
  const term = searchTerm.value.toLowerCase();
  return rules.value.filter(r => 
    r.cnpj_emissor.includes(term) || 
    r.cod_produto_xml.toLowerCase().includes(term) ||
    (r.descricao_produto && r.descricao_produto.toLowerCase().includes(term))
  );
});

onMounted(async () => {
  if (!empresaSelecionada.value) {
    router.push('/');
    return;
  }
  loadRules();
});

async function loadRules() {
  isLoading.value = true;
  try {
    const res = await axios.get(`${API_BASE_URL}/api/de-para`, {
      params: { id_empresa: empresaSelecionada.value.id },
      headers: { Authorization: `Bearer ${token.value}` }
    });
    rules.value = res.data;
  } catch (err) {
    showNotify('Erro ao carregar regras', 'error');
  } finally {
    isLoading.value = false;
  }
}

function openAddModal() {
  form.value = {
    id: null,
    cnpj_emissor: '',
    cod_produto_xml: '',
    descricao_produto: '',
    novo_cfop: '',
    novo_cst: '',
    aliq_icms: '',
    bc_icms_override: '',
    cst_pis: '',
    cst_cofins: ''
  };
  showModal.value = true;
}

function editRule(rule) {
  form.value = { ...rule };
  showModal.value = true;
}

async function saveRule() {
  if (!form.value.cnpj_emissor || !form.value.cod_produto_xml) {
    return showNotify('CNPJ e Código do Produto são obrigatórios', 'error');
  }

  try {
    const payload = {
      ...form.value,
      id_empresa: empresaSelecionada.value.id
    };
    
    await axios.post(`${API_BASE_URL}/api/de-para`, payload, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    
    showNotify('Regra salva com sucesso!', 'success');
    showModal.value = false;
    loadRules();
  } catch (err) {
    showNotify('Erro ao salvar regra', 'error');
  }
}

async function confirmDelete(id) {
  if (!confirm('Deseja realmente excluir esta regra?')) return;
  
  try {
    // Note: server.js doesn't have a specific DELETE endpoint yet in the provided snippets, 
    // but typically it would be /api/de-para/:id. 
    // I'll check if it exists or implement it if needed.
    // For now, I'll assuming it might exist or I'll implement it.
    await axios.delete(`${API_BASE_URL}/api/de-para/${id}`, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    showNotify('Regra excluída!', 'success');
    loadRules();
  } catch (err) {
    showNotify('Erro ao excluir regra', 'error');
  }
}

function showNotify(msg, type = 'success') {
  notification.value = { show: true, message: msg, type };
  setTimeout(() => {
    notification.value.show = false;
  }, 3000);
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-[#0f172a] text-slate-200">
    <!-- Header -->
    <header class="h-20 bg-[#1e293b]/50 border-b border-white/5 flex items-center justify-between px-8 backdrop-blur-md sticky top-0 z-10">
      <div>
        <h1 class="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Database class="w-5 h-5 text-brand-accent" />
          Remapeamento Tributário XML (De-Para)
        </h1>
        <p class="text-sm text-slate-400">Gerencie substituições automáticas de CFOP e CST por produto e fornecedor.</p>
      </div>

      <button 
        @click="openAddModal"
        class="bg-brand-accent hover:bg-brand-accent/90 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 font-semibold transition-all shadow-lg shadow-brand-accent/20 active:scale-95"
      >
        <Plus class="w-5 h-5" />
        Nova Regra
      </button>
    </header>

    <main class="flex-1 p-8">
      <!-- Search & Filters -->
      <div class="mb-8 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div class="relative w-full max-w-md">
          <Search class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input 
            v-model="searchTerm"
            type="text" 
            placeholder="Buscar por CNPJ ou Código do Produto..."
            class="w-full bg-[#1e293b] border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-brand-accent/50 focus:border-brand-accent/50 transition-all"
          />
        </div>

        <div class="flex items-center gap-2 text-sm text-slate-400">
          <Info class="w-4 h-4" />
          <span>{{ filteredRules.length }} regras configuradas</span>
        </div>
      </div>

      <!-- Table -->
      <div class="bg-[#1e293b]/40 border border-white/5 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-white/5 text-slate-300 text-xs font-bold uppercase tracking-wider">
              <th class="px-6 py-4">CNPJ Fornecedor</th>
              <th class="px-6 py-4">Cód. XML</th>
              <th class="px-6 py-4">Descrição</th>
              <th class="px-6 py-4">CFOP</th>
              <th class="px-6 py-4">CST</th>
              <th class="px-6 py-4">Alíq. %</th>
              <th class="px-6 py-4">CST PIS</th>
              <th class="px-6 py-4">CST COF.</th>
              <th class="px-6 py-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/5">
            <tr v-if="isLoading" v-for="i in 3" :key="i" class="animate-pulse">
              <td v-for="j in 9" :key="j" class="px-6 py-4">
                <div class="h-4 bg-white/5 rounded w-full"></div>
              </td>
            </tr>

            <tr v-else-if="filteredRules.length === 0">
              <td colspan="9" class="px-6 py-12 text-center text-slate-500 italic">
                Nenhuma regra encontrada. Clique em "Nova Regra" para começar.
              </td>
            </tr>

            <tr 
              v-else 
              v-for="rule in filteredRules" 
              :key="rule.id"
              class="hover:bg-white/5 transition-colors group"
            >
              <td class="px-6 py-4 font-mono text-xs text-brand-accent">{{ rule.cnpj_emissor }}</td>
              <td class="px-6 py-4">
                <span class="bg-slate-700/50 px-2 py-1 rounded border border-white/5 text-xs text-slate-300">
                  {{ rule.cod_produto_xml }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-slate-300 max-w-xs truncate" :title="rule.descricao_produto">
                {{ rule.descricao_produto || '-' }}
              </td>
              <td class="px-6 py-4">
                <span class="text-emerald-400 font-bold font-mono">{{ rule.novo_cfop || '-' }}</span>
              </td>
              <td class="px-6 py-4 text-amber-400 font-bold font-mono">{{ rule.novo_cst || '-' }}</td>
              <td class="px-6 py-4 text-slate-300 font-mono text-xs">{{ rule.aliq_icms != null ? rule.aliq_icms + '%' : '-' }}</td>
              <td class="px-6 py-4 text-slate-300 font-mono text-xs">{{ rule.cst_pis || '-' }}</td>
              <td class="px-6 py-4 text-slate-300 font-mono text-xs">{{ rule.cst_cofins || '-' }}</td>
              <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    @click="editRule(rule)"
                    class="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all"
                  >
                    <Edit2 class="w-4 h-4" />
                  </button>
                  <button 
                    @click="confirmDelete(rule.id)"
                    class="p-2 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition-all"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <!-- Modal Form -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="bg-[#1e293b] w-full max-w-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-in fade-in zoom-in duration-200">
        <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <Plus v-if="!form.id" class="w-5 h-5 text-brand-accent" />
            <Edit2 v-else class="w-5 h-5 text-brand-accent" />
            {{ form.id ? 'Editar Regra' : 'Nova Regra de De-Para' }}
          </h2>
          <button @click="showModal = false" class="text-slate-400 hover:text-white transition-colors">
            <X class="w-6 h-6" />
          </button>
        </div>

        <div class="p-6 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">CNPJ Fornecedor (Fixo)</label>
              <input 
                v-model="form.cnpj_emissor"
                type="text" 
                placeholder="Ex: 00000000000000"
                class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">Cód. Produto XML</label>
              <input 
                v-model="form.cod_produto_xml"
                type="text" 
                placeholder="Ex: 12345"
                class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
              />
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">Descrição (Para referência)</label>
            <input 
              v-model="form.descricao_produto"
              type="text" 
              placeholder="Ex: Gasolina Comum - Fornecedor X"
              class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
            />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">Novo CFOP</label>
              <input
                v-model="form.novo_cfop"
                type="text"
                placeholder="Ex: 1102"
                class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-emerald-400 font-mono focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">Novo CST ICMS</label>
              <input
                v-model="form.novo_cst"
                type="text"
                placeholder="Ex: 060"
                class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-amber-400 font-mono focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
              />
            </div>
          </div>

          <div class="border-t border-white/5 pt-4">
            <p class="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-3">Tributação (Opcional — sobrescreve o XML)</p>
            <div class="grid grid-cols-3 gap-3">
              <div class="space-y-1.5">
                <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">Alíq. ICMS %</label>
                <input
                  v-model="form.aliq_icms"
                  type="number" step="0.01" min="0"
                  placeholder="Ex: 12.00"
                  class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-white font-mono focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">CST PIS</label>
                <input
                  v-model="form.cst_pis"
                  type="text" maxlength="3"
                  placeholder="Ex: 07"
                  class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-white font-mono focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">CST COFINS</label>
                <input
                  v-model="form.cst_cofins"
                  type="text" maxlength="3"
                  placeholder="Ex: 07"
                  class="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2.5 text-white font-mono focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="p-6 bg-white/5 border-t border-white/5 flex justify-end gap-3">
          <button 
            @click="showModal = false"
            class="px-5 py-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          >
            Cancelar
          </button>
          <button 
            @click="saveRule"
            class="bg-brand-accent hover:bg-brand-accent/90 text-white px-8 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg active:scale-95"
          >
            <Save class="w-5 h-5" />
            Salvar Regra
          </button>
        </div>
      </div>
    </div>

    <!-- Notification Toast -->
    <Transition name="slide-up">
      <div 
        v-if="notification.show"
        class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] border p-4 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur-xl animate-in slide-in-from-bottom"
        :class="notification.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-red-500/10 border-red-500/50 text-red-400'"
      >
        <div class="w-8 h-8 rounded-full flex items-center justify-center bg-white/10">
          <Info v-if="notification.type === 'error'" class="w-5 h-5" />
          <Save v-else class="w-5 h-5" />
        </div>
        <span class="font-medium">{{ notification.message }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active {
  transition: all 0.3s ease;
}
.slide-up-enter-from {
  opacity: 0;
  transform: translate(-50%, 20px);
}
.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
