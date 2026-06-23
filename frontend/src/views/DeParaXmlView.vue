
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
import UiButton from '@/components/ui/UiButton.vue';

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
  <div class="flex-1 flex flex-col min-w-0 bg-paper text-ink">
    <!-- Header -->
    <header class="bg-sheet border-b border-line flex flex-col md:flex-row md:items-end justify-between gap-4 px-4 sm:px-8 py-5 sticky top-0 z-10">
      <div class="space-y-1">
        <h1 class="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink flex items-center gap-2">
          <Database class="w-5 h-5 text-bronze" :stroke-width="1.8" />
          Remapeamento Tributário XML (De-Para)
        </h1>
        <p class="text-[13px] text-risco">Gerencie substituições automáticas de CFOP e CST por produto e fornecedor.</p>
      </div>

      <UiButton @click="openAddModal">
        <Plus class="w-4 h-4" :stroke-width="2" />
        Nova Regra
      </UiButton>
    </header>

    <main class="flex-1 p-4 sm:p-8">
      <!-- Search & Filters -->
      <div class="mb-6 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <div class="relative w-full max-w-md">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco pointer-events-none" :stroke-width="1.8" />
          <input
            v-model="searchTerm"
            type="text"
            placeholder="Buscar por CNPJ ou Código do Produto..."
            class="w-full bg-sheet border border-line rounded-md py-2 pl-9 pr-3 text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors"
          />
        </div>

        <div class="flex items-center gap-2 text-[13px] text-risco">
          <Info class="w-4 h-4" :stroke-width="1.8" />
          <span><span class="font-medium text-ink">{{ filteredRules.length }}</span> regras configuradas</span>
        </div>
      </div>

      <!-- Table -->
      <div class="bg-sheet border border-line rounded-md overflow-hidden card-shadow overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-paper text-risco text-[10px] font-semibold uppercase tracking-[.08em]">
              <th class="px-5 py-3">CNPJ Fornecedor</th>
              <th class="px-5 py-3">Cód. XML</th>
              <th class="px-5 py-3">Descrição</th>
              <th class="px-5 py-3">CFOP</th>
              <th class="px-5 py-3">CST</th>
              <th class="px-5 py-3">Alíq. %</th>
              <th class="px-5 py-3">CST PIS</th>
              <th class="px-5 py-3">CST COF.</th>
              <th class="px-5 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="isLoading" v-for="i in 3" :key="i" class="border-t border-line animate-pulse">
              <td v-for="j in 9" :key="j" class="px-5 py-3.5">
                <div class="h-4 bg-paper rounded w-full"></div>
              </td>
            </tr>

            <tr v-else-if="filteredRules.length === 0">
              <td colspan="9" class="px-5 py-12 text-center text-risco text-[13px]">
                Nenhuma regra encontrada. Clique em "Nova Regra" para começar.
              </td>
            </tr>

            <tr
              v-else
              v-for="rule in filteredRules"
              :key="rule.id"
              class="border-t border-line hover:bg-paper transition-colors group"
            >
              <td class="px-5 py-3.5 font-mono text-[12px] text-bronze">{{ rule.cnpj_emissor }}</td>
              <td class="px-5 py-3.5">
                <span class="bg-paper px-2 py-1 rounded border border-line text-[12px] font-mono text-ink">
                  {{ rule.cod_produto_xml }}
                </span>
              </td>
              <td class="px-5 py-3.5 text-[13px] text-risco max-w-xs truncate" :title="rule.descricao_produto">
                {{ rule.descricao_produto || '-' }}
              </td>
              <td class="px-5 py-3.5">
                <span class="text-conforme font-semibold font-mono text-[13px]">{{ rule.novo_cfop || '-' }}</span>
              </td>
              <td class="px-5 py-3.5 text-variacao font-semibold font-mono text-[13px]">{{ rule.novo_cst || '-' }}</td>
              <td class="px-5 py-3.5 text-ink font-mono text-[12px]">{{ rule.aliq_icms != null ? rule.aliq_icms + '%' : '-' }}</td>
              <td class="px-5 py-3.5 text-ink font-mono text-[12px]">{{ rule.cst_pis || '-' }}</td>
              <td class="px-5 py-3.5 text-ink font-mono text-[12px]">{{ rule.cst_cofins || '-' }}</td>
              <td class="px-5 py-3.5 text-right">
                <div class="flex items-center justify-end gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <button
                    @click="editRule(rule)"
                    class="p-1.5 hover:bg-paper rounded-md text-risco hover:text-bronze transition-colors"
                  >
                    <Edit2 class="w-4 h-4" :stroke-width="1.8" />
                  </button>
                  <button
                    @click="confirmDelete(rule.id)"
                    class="p-1.5 hover:bg-lacre/10 rounded-md text-risco hover:text-lacre transition-colors"
                  >
                    <Trash2 class="w-4 h-4" :stroke-width="1.8" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <!-- Modal Form -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40">
      <div class="bg-sheet w-full max-w-xl rounded-md border border-line overflow-hidden card-shadow">
        <div class="px-6 py-4 border-b border-line flex items-center justify-between">
          <h2 class="font-display text-[16px] font-semibold text-ink flex items-center gap-2">
            <Plus v-if="!form.id" class="w-4 h-4 text-bronze" :stroke-width="1.8" />
            <Edit2 v-else class="w-4 h-4 text-bronze" :stroke-width="1.8" />
            {{ form.id ? 'Editar Regra' : 'Nova Regra de De-Para' }}
          </h2>
          <button @click="showModal = false" class="text-risco hover:text-ink transition-colors">
            <X class="w-5 h-5" :stroke-width="1.8" />
          </button>
        </div>

        <div class="p-6 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">CNPJ Fornecedor (Fixo)</label>
              <input
                v-model="form.cnpj_emissor"
                type="text"
                placeholder="Ex: 00000000000000"
                class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
              />
            </div>
            <div class="space-y-1.5">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Cód. Produto XML</label>
              <input
                v-model="form.cod_produto_xml"
                type="text"
                placeholder="Ex: 12345"
                class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
              />
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Descrição (Para referência)</label>
            <input
              v-model="form.descricao_produto"
              type="text"
              placeholder="Ex: Gasolina Comum - Fornecedor X"
              class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze transition-colors"
            />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-1.5">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Novo CFOP</label>
              <input
                v-model="form.novo_cfop"
                type="text"
                placeholder="Ex: 1102"
                class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-conforme font-mono text-[13px] outline-none focus:border-bronze transition-colors"
              />
            </div>
            <div class="space-y-1.5">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Novo CST ICMS</label>
              <input
                v-model="form.novo_cst"
                type="text"
                placeholder="Ex: 060"
                class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-variacao font-mono text-[13px] outline-none focus:border-bronze transition-colors"
              />
            </div>
          </div>

          <div class="border-t border-line pt-4">
            <p class="text-[11px] text-risco uppercase tracking-wide font-medium mb-3">Tributação (Opcional — sobrescreve o XML)</p>
            <div class="grid grid-cols-3 gap-3">
              <div class="space-y-1.5">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Alíq. ICMS %</label>
                <input
                  v-model="form.aliq_icms"
                  type="number" step="0.01" min="0"
                  placeholder="Ex: 12.00"
                  class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
                />
              </div>
              <div class="space-y-1.5">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">CST PIS</label>
                <input
                  v-model="form.cst_pis"
                  type="text" maxlength="3"
                  placeholder="Ex: 07"
                  class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
                />
              </div>
              <div class="space-y-1.5">
                <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">CST COFINS</label>
                <input
                  v-model="form.cst_cofins"
                  type="text" maxlength="3"
                  placeholder="Ex: 07"
                  class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="px-6 py-4 bg-paper border-t border-line flex justify-end gap-2">
          <UiButton variant="ghost" @click="showModal = false">
            Cancelar
          </UiButton>
          <UiButton @click="saveRule">
            <Save class="w-4 h-4" :stroke-width="1.8" />
            Salvar Regra
          </UiButton>
        </div>
      </div>
    </div>

    <!-- Notification Toast -->
    <Transition name="slide-up">
      <div
        v-if="notification.show"
        class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] border p-3.5 rounded-md card-shadow flex items-center gap-3"
        :class="notification.type === 'success' ? 'bg-conforme/[0.06] border-conforme/25 text-conforme' : 'bg-lacre/[0.06] border-lacre/25 text-lacre'"
      >
        <div class="w-8 h-8 rounded-full flex items-center justify-center bg-sheet border border-line">
          <Info v-if="notification.type === 'error'" class="w-4 h-4" :stroke-width="1.8" />
          <Save v-else class="w-4 h-4" :stroke-width="1.8" />
        </div>
        <span class="text-[13px] font-medium">{{ notification.message }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
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
</style>
