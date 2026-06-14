<script setup>
import { ref, computed } from 'vue';
import { 
  X, 
  FileText, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertCircle,
  Copy,
  Table as TableIcon,
  Package,
  ArrowRightLeft,
  Save,
  Loader2
} from 'lucide-vue-next';
import { token, empresaSelecionada } from '../store';
import axios from 'axios';

const props = defineProps({
  show: Boolean,
  data: Object // O data que vem do backend (gerencial + itensDetectados)
});

const emit = defineEmits(['close']);

const activeTab = ref('dashboard'); // dashboard | depara
const expandedNota = ref(null);
const savingItem = ref(null); // ID ou Key do item sendo salvo

const resumoNotas = computed(() => {
  if (!props.data || !props.data.gerencial?.notas_processadas) return [];
  return props.data.gerencial.notas_processadas;
});

const estatisticas = computed(() => {
  if (!props.data || !props.data.gerencial?.estatisticas) return {};
  return props.data.gerencial.estatisticas;
});

const itensDetectados = computed(() => {
  return props.data?.itensDetectados || [];
});

// Formata a data da NF (vem do backend como YYYY-MM-DD; aceita ISO/DDMMYYYY) → DD/MM/YYYY
const fmtData = (d) => {
  if (!d) return '—';
  const s = String(d);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s;
};

const apiClient = axios.create({
  baseURL: '',
  headers: { Authorization: `Bearer ${token.value}` }
});

async function saveMapping(item) {
  if (!empresaSelecionada.value?.id) {
    alert('Empresa não selecionada!');
    return;
  }

  const mKey = `${item.cnpj_fornecedor}_${item.cod_produto_xml}`;
  savingItem.value = mKey;
  try {
    await apiClient.post('/api/de-para', {
      id_empresa: empresaSelecionada.value.id,
      cnpj_emissor: item.cnpj_fornecedor,
      cod_produto_xml: item.cod_produto_xml,
      novo_cfop: item.cfop_atual,
      novo_cst: item.cst_atual,
      descricao_produto: item.descricao_produto,
      ncm: item.ncm
    });
    item.isMapped = true;
    // Feedback visual opcional: mudar cor do status para verde por 2 segundos ou manter isMapped
  } catch (err) {
    console.error('Erro ao salvar mapeamento:', err);
    alert('Erro ao salvar mapeamento. Verifique a conexão.');
  } finally {
    savingItem.value = null;
  }
}
function toggleNota(chave) {
  if (expandedNota.value === chave) {
    expandedNota.value = null;
  } else {
    expandedNota.value = chave;
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function fmtQtd(value) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(Number(value) || 0);
}

// Toggle por nota para exibir as linhas SPED geradas (fica oculto por padrão; itens em destaque).
const linhasVisiveis = ref({});
function toggleLinhas(chave) {
  linhasVisiveis.value = { ...linhasVisiveis.value, [chave]: !linhasVisiveis.value[chave] };
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-900/70 backdrop-blur-sm animate-fade-in">
      <div class="bg-white w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
      
      <!-- Header -->
      <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white">
        <div class="flex items-center gap-3">
          <div class="bg-brand-accent/10 p-2 rounded-lg text-brand-accent">
            <FileText class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-lg font-bold text-slate-900 leading-tight">Simulação e Mapeamento Tributário</h3>
            <p class="text-xs text-slate-500 font-medium">Análise prévia dos XMLs e configuração De-Para</p>
          </div>
        </div>
        <button @click="emit('close')" class="p-2 hover:bg-slate-200/50 rounded-full transition-colors text-slate-400 hover:text-slate-600">
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Tab Navigation -->
      <div class="px-6 bg-slate-50/50 border-b border-slate-100 flex gap-6">
        <button 
          @click="activeTab = 'dashboard'"
          :class="[
            'py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all',
            activeTab === 'dashboard' ? 'border-brand-accent text-brand-accent' : 'border-transparent text-slate-400 hover:text-slate-600'
          ]"
        >
          Resumo Gerencial
        </button>
        <button 
          @click="activeTab = 'depara'"
          :class="[
            'py-3 text-xs font-bold uppercase tracking-wider border-b-2 flex items-center gap-2 transition-all',
            activeTab === 'depara' ? 'border-brand-accent text-brand-accent' : 'border-transparent text-slate-400 hover:text-slate-600'
          ]"
        >
          Mapeamento De-Para
          <span v-if="itensDetectados.length" class="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[9px]">{{ itensDetectados.length }}</span>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
        
        <!-- Tab: Dashboard -->
        <template v-if="activeTab === 'dashboard'">
          <!-- Dashboard Rápido -->
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-1 shadow-sm">
              <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total de Notas</span>
              <span class="text-2xl font-bold text-slate-900">{{ estatisticas.totalNotas || 0 }}</span>
            </div>
            <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-1 shadow-sm">
              <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Valor Total</span>
              <span class="text-2xl font-bold text-brand-accent">{{ formatCurrency(estatisticas.valorTotalGeral || 0) }}</span>
            </div>
            <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-1 shadow-sm">
              <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Linhas Bloco 0</span>
              <span class="text-2xl font-bold text-slate-900">{{ estatisticas.totalLinhasBloco0 || 0 }}</span>
            </div>
            <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col gap-1 shadow-sm">
              <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Linhas Bloco C</span>
              <span class="text-2xl font-bold text-slate-900">{{ estatisticas.totalLinhasBlocoC || 0 }}</span>
            </div>
          </div>

          <!-- Lista de Notas -->
          <div class="flex flex-col gap-4">
            <h4 class="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
              <Package class="w-4 h-4 text-slate-400" />
              Detalhamento por Nota Fiscal
            </h4>

            <div v-if="resumoNotas.length === 0" class="py-12 text-center text-slate-400 italic text-sm">
              Nenhum dado para exibir.
            </div>

            <div v-else class="space-y-3">
              <div v-for="nota in resumoNotas" :key="nota.chave" class="border border-slate-100 rounded-xl overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md bg-white">
                <div @click="toggleNota(nota.chave)" class="px-4 py-3 cursor-pointer flex items-center justify-between group select-none">
                  <div class="flex items-center gap-4 flex-1">
                    <div class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-brand-accent/5 transition-colors font-bold text-xs">
                      {{ nota.numero }}
                    </div>
                    <div class="flex flex-col min-w-0">
                      <span class="text-sm font-bold text-slate-800 truncate">{{ nota.emitente }}</span>
                      <span class="text-[10px] text-slate-500 font-mono">{{ nota.chave }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-6">
                    <span v-if="(nota.itens || []).length" class="hidden sm:inline-flex items-center gap-1 bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[10px] font-bold">
                      <Package class="w-3 h-3" /> {{ (nota.itens || []).length }} {{ (nota.itens || []).length === 1 ? 'item' : 'itens' }}
                    </span>
                    <div class="flex flex-col items-end leading-tight">
                      <span class="text-[9px] uppercase tracking-wide text-slate-400">Data NF</span>
                      <span class="text-xs font-bold text-slate-600">{{ fmtData(nota.data) }}</span>
                    </div>
                    <span class="text-sm font-bold text-slate-700">{{ formatCurrency(nota.valor_total) }}</span>
                    <component :is="expandedNota === nota.chave ? ChevronUp : ChevronDown" class="w-4 h-4 text-slate-400" />
                  </div>
                </div>

                <div v-if="expandedNota === nota.chave" class="bg-slate-50/50 border-t border-slate-100 p-4 space-y-3">
                  <!-- Itens DESTA nota (separados por XML) -->
                  <div class="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                    <table class="w-full text-[11px]">
                      <thead class="bg-slate-50 text-slate-500 uppercase text-[9px] font-bold border-b border-slate-100">
                        <tr>
                          <th class="px-2 py-2 text-left">Cód.</th>
                          <th class="px-2 py-2 text-left">Produto</th>
                          <th class="px-2 py-2 text-left">NCM</th>
                          <th class="px-2 py-2 text-right">Qtd</th>
                          <th class="px-2 py-2 text-left">Un</th>
                          <th class="px-2 py-2 text-right">Vl. Unit.</th>
                          <th class="px-2 py-2 text-right">Vl. Total</th>
                          <th class="px-2 py-2 text-center">CFOP</th>
                          <th class="px-2 py-2 text-center">CST</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-100">
                        <tr v-for="(it, idx) in (nota.itens || [])" :key="idx" class="hover:bg-slate-50/60">
                          <td class="px-2 py-1.5 font-mono text-slate-500">{{ it.cod_produto }}</td>
                          <td class="px-2 py-1.5 font-medium text-slate-700">{{ it.descricao }}</td>
                          <td class="px-2 py-1.5 font-mono text-slate-400">{{ it.ncm }}</td>
                          <td class="px-2 py-1.5 text-right tabular-nums">{{ fmtQtd(it.qtd) }}</td>
                          <td class="px-2 py-1.5 text-slate-500">{{ it.unid }}</td>
                          <td class="px-2 py-1.5 text-right tabular-nums">{{ formatCurrency(it.valor_unitario) }}</td>
                          <td class="px-2 py-1.5 text-right font-bold text-slate-700 tabular-nums">{{ formatCurrency(it.valor_total) }}</td>
                          <td class="px-2 py-1.5 text-center font-mono">{{ it.cfop }}</td>
                          <td class="px-2 py-1.5 text-center font-mono">{{ it.cst }}</td>
                        </tr>
                        <tr v-if="!(nota.itens || []).length">
                          <td colspan="9" class="px-2 py-3 text-center text-slate-400 italic">Sem itens nesta nota.</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <!-- Linhas SPED geradas (oculto por padrão) -->
                  <div v-if="nota.linhas_geradas && nota.linhas_geradas.length">
                    <button @click="toggleLinhas(nota.chave)" class="text-[10px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1">
                      <component :is="linhasVisiveis[nota.chave] ? ChevronUp : ChevronDown" class="w-3 h-3" />
                      {{ linhasVisiveis[nota.chave] ? 'Ocultar' : 'Ver' }} linhas SPED geradas ({{ nota.linhas_geradas.length }})
                    </button>
                    <div v-if="linhasVisiveis[nota.chave]" class="mt-2 bg-slate-900 rounded-lg p-3 font-mono text-[11px] text-slate-300 max-h-40 overflow-y-auto custom-scrollbar-term">
                      <div v-for="(linha, l) in nota.linhas_geradas" :key="l">{{ linha }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Tab: De-Para Mapeamento -->
        <template v-else-if="activeTab === 'depara'">
          <div class="flex flex-col gap-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                  <ArrowRightLeft class="w-4 h-4 text-brand-accent" />
                  Regras de Entrada (De-Para)
                </h4>
                <p class="text-[10px] text-slate-500 mt-1">Defina CFOP e CST de destino para cada produto detectado nos XMLs.</p>
              </div>
            </div>

            <div class="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 text-slate-500 uppercase text-[9px] font-bold border-b border-slate-100">
                  <tr>
                    <th class="px-4 py-3">Fornecedor / Produto</th>
                    <th class="px-4 py-3 w-32 text-center">CFOP Entrada</th>
                    <th class="px-4 py-3 w-24 text-center">CST Destino</th>
                    <th class="px-4 py-3 w-20">Status</th>
                    <th class="px-4 py-3 w-32">Ação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 italic-inputs">
                  <tr v-for="item in itensDetectados" :key="item.cnpj_fornecedor + item.cod_produto_xml" class="hover:bg-slate-50/30">
                    <td class="px-4 py-3">
                      <div class="flex flex-col gap-0.5">
                        <span class="font-bold text-slate-800 text-xs">{{ item.descricao_produto }}</span>
                        <span class="text-[9px] text-slate-400 font-mono">{{ item.cnpj_fornecedor }} - Cod: {{ item.cod_produto_xml }}</span>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <input 
                        v-model="item.cfop_atual" 
                        type="text" 
                        maxlength="4"
                        placeholder="CFOP"
                        class="w-full h-8 text-center text-xs border border-slate-200 rounded font-bold text-slate-700 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20 outline-none"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <input 
                        v-model="item.cst_atual" 
                        type="text" 
                        maxlength="3"
                        placeholder="CST"
                        class="w-full h-8 text-center text-xs border border-slate-200 rounded font-bold text-slate-700 focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20 outline-none"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex justify-center">
                        <CheckCircle2 v-if="item.isMapped" class="w-4 h-4 text-emerald-500" />
                        <span v-else class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <button 
                        @click="saveMapping(item)"
                        :disabled="savingItem === `${item.cnpj_fornecedor}_${item.cod_produto_xml}`"
                        class="w-full h-8 bg-slate-100 hover:bg-brand-accent hover:text-white text-slate-600 rounded text-[10px] font-bold uppercase tracking-tight transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <template v-if="savingItem === `${item.cnpj_fornecedor}_${item.cod_produto_xml}`">
                          <Loader2 class="w-3 h-3 animate-spin" />
                          Salvando...
                        </template>
                        <template v-else>
                          <Save class="w-3 h-3" />
                          Salvar
                        </template>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <p class="text-[10px] text-slate-400 max-w-md">
          <strong>Aviso:</strong> A alteração do De-Para aqui afeta futuras simulações para os mesmos produtos. Após salvar, realize uma nova geração para aplicar as novas regras.
        </p>
        <div class="flex gap-3">
          <button @click="emit('close')" class="bg-white border border-slate-200 text-slate-600 font-bold px-5 py-2 rounded-lg text-sm hover:bg-slate-50 transition-all">
            Fechar
          </button>
          <button 
            @click="emit('close')"
            class="bg-brand-accent hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-lg transition-all text-sm shadow-md"
          >
            Finalizar
          </button>
        </div>
      </div>

    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.animate-fade-in { animation: fadeIn 0.2s ease-out; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
.custom-scrollbar-term::-webkit-scrollbar { width: 4px; }
.custom-scrollbar-term::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
.custom-scrollbar-term::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }

.italic-inputs input::placeholder { font-style: italic; font-weight: normal; color: #94a3b8; }
</style>
