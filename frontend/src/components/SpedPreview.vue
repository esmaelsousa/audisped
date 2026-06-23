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
import UiButton from '@/components/ui/UiButton.vue';
import UiSelo from '@/components/ui/UiSelo.vue';

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
    <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-ink/40 animate-fade-in">
      <div class="bg-sheet w-full max-w-5xl max-h-[90vh] rounded-md card-shadow flex flex-col overflow-hidden border border-line">

      <!-- Header -->
      <div class="px-6 py-4 border-b border-line flex items-center justify-between bg-sheet">
        <div class="flex items-center gap-3">
          <div class="bg-bronze/10 p-2 rounded-md text-bronze">
            <FileText class="w-5 h-5" :stroke-width="1.8" />
          </div>
          <div>
            <h3 class="font-display text-[18px] font-semibold text-ink leading-tight">Simulação e Mapeamento Tributário</h3>
            <p class="text-[12px] text-risco">Análise prévia dos XMLs e configuração De-Para</p>
          </div>
        </div>
        <button @click="emit('close')" class="text-risco hover:text-ink transition-colors">
          <X class="w-5 h-5" :stroke-width="1.8" />
        </button>
      </div>

      <!-- Tab Navigation -->
      <div class="px-6 bg-paper border-b border-line flex gap-6">
        <button
          @click="activeTab = 'dashboard'"
          :class="[
            'py-3 text-[11px] font-semibold uppercase tracking-[.08em] border-b-2 transition-colors',
            activeTab === 'dashboard' ? 'border-bronze text-ink' : 'border-transparent text-risco hover:text-ink'
          ]"
        >
          Resumo Gerencial
        </button>
        <button
          @click="activeTab = 'depara'"
          :class="[
            'py-3 text-[11px] font-semibold uppercase tracking-[.08em] border-b-2 flex items-center gap-2 transition-colors',
            activeTab === 'depara' ? 'border-bronze text-ink' : 'border-transparent text-risco hover:text-ink'
          ]"
        >
          Mapeamento De-Para
          <UiSelo v-if="itensDetectados.length" :tipo="String(itensDetectados.length)" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
        
        <!-- Tab: Dashboard -->
        <template v-if="activeTab === 'dashboard'">
          <!-- Dashboard Rápido -->
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-paper border border-line p-4 rounded-md flex flex-col gap-1">
              <span class="text-[10px] font-semibold text-risco uppercase tracking-[.08em]">Total de Notas</span>
              <span class="font-mono text-[24px] font-semibold text-ink">{{ estatisticas.totalNotas || 0 }}</span>
            </div>
            <div class="bg-paper border border-line p-4 rounded-md flex flex-col gap-1">
              <span class="text-[10px] font-semibold text-risco uppercase tracking-[.08em]">Valor Total</span>
              <span class="font-mono text-[24px] font-semibold text-bronze">{{ formatCurrency(estatisticas.valorTotalGeral || 0) }}</span>
            </div>
            <div class="bg-paper border border-line p-4 rounded-md flex flex-col gap-1">
              <span class="text-[10px] font-semibold text-risco uppercase tracking-[.08em]">Linhas Bloco 0</span>
              <span class="font-mono text-[24px] font-semibold text-ink">{{ estatisticas.totalLinhasBloco0 || 0 }}</span>
            </div>
            <div class="bg-paper border border-line p-4 rounded-md flex flex-col gap-1">
              <span class="text-[10px] font-semibold text-risco uppercase tracking-[.08em]">Linhas Bloco C</span>
              <span class="font-mono text-[24px] font-semibold text-ink">{{ estatisticas.totalLinhasBlocoC || 0 }}</span>
            </div>
          </div>

          <!-- Lista de Notas -->
          <div class="flex flex-col gap-4">
            <h4 class="font-display text-[13px] font-semibold text-ink uppercase tracking-[.06em] flex items-center gap-2">
              <Package class="w-4 h-4 text-risco" :stroke-width="1.8" />
              Detalhamento por Nota Fiscal
            </h4>

            <div v-if="resumoNotas.length === 0" class="py-12 text-center text-risco text-[13px]">
              Nenhum dado para exibir.
            </div>

            <div v-else class="space-y-3">
              <div v-for="nota in resumoNotas" :key="nota.chave" class="border border-line rounded-md overflow-hidden bg-sheet">
                <div @click="toggleNota(nota.chave)" class="px-4 py-3 cursor-pointer flex items-center justify-between group select-none hover:bg-paper transition-colors">
                  <div class="flex items-center gap-4 flex-1">
                    <div class="w-10 h-10 bg-paper border border-line rounded-md flex items-center justify-center text-risco group-hover:border-bronze/40 group-hover:text-bronze transition-colors font-mono font-semibold text-[12px]">
                      {{ nota.numero }}
                    </div>
                    <div class="flex flex-col min-w-0">
                      <span class="text-[13px] font-medium text-ink truncate">{{ nota.emitente }}</span>
                      <span class="text-[10px] text-risco font-mono">{{ nota.chave }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-6">
                    <span v-if="(nota.itens || []).length" class="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide text-risco border border-line px-2 py-0.5 rounded">
                      <Package class="w-3 h-3" :stroke-width="1.8" /> {{ (nota.itens || []).length }} {{ (nota.itens || []).length === 1 ? 'item' : 'itens' }}
                    </span>
                    <div class="flex flex-col items-end leading-tight">
                      <span class="text-[9px] uppercase tracking-wide text-risco">Data NF</span>
                      <span class="text-[12px] font-mono text-ink">{{ fmtData(nota.data) }}</span>
                    </div>
                    <span class="text-[13px] font-mono font-semibold text-ink">{{ formatCurrency(nota.valor_total) }}</span>
                    <component :is="expandedNota === nota.chave ? ChevronUp : ChevronDown" class="w-4 h-4 text-risco" :stroke-width="1.8" />
                  </div>
                </div>

                <div v-if="expandedNota === nota.chave" class="bg-paper border-t border-line p-4 space-y-3">
                  <!-- Itens DESTA nota (separados por XML) -->
                  <div class="rounded-md border border-line bg-sheet overflow-x-auto">
                    <table class="w-full text-[11px]">
                      <thead class="bg-paper text-risco uppercase text-[10px] font-semibold border-b border-line">
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
                      <tbody>
                        <tr v-for="(it, idx) in (nota.itens || [])" :key="idx" class="border-t border-line hover:bg-paper">
                          <td class="px-2 py-1.5 font-mono text-ink">{{ it.cod_produto }}</td>
                          <td class="px-2 py-1.5 font-medium text-ink">{{ it.descricao }}</td>
                          <td class="px-2 py-1.5 font-mono text-ink">{{ it.ncm }}</td>
                          <td class="px-2 py-1.5 text-right font-mono text-ink">{{ fmtQtd(it.qtd) }}</td>
                          <td class="px-2 py-1.5 text-risco">{{ it.unid }}</td>
                          <td class="px-2 py-1.5 text-right font-mono text-ink">{{ formatCurrency(it.valor_unitario) }}</td>
                          <td class="px-2 py-1.5 text-right font-mono font-semibold text-ink">{{ formatCurrency(it.valor_total) }}</td>
                          <td class="px-2 py-1.5 text-center font-mono text-ink">{{ it.cfop }}</td>
                          <td class="px-2 py-1.5 text-center font-mono text-ink">{{ it.cst }}</td>
                        </tr>
                        <tr v-if="!(nota.itens || []).length">
                          <td colspan="9" class="px-2 py-3 text-center text-risco">Sem itens nesta nota.</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <!-- Linhas SPED geradas (oculto por padrão) -->
                  <div v-if="nota.linhas_geradas && nota.linhas_geradas.length">
                    <button @click="toggleLinhas(nota.chave)" class="text-[10px] font-semibold text-risco hover:text-ink flex items-center gap-1 transition-colors">
                      <component :is="linhasVisiveis[nota.chave] ? ChevronUp : ChevronDown" class="w-3 h-3" :stroke-width="1.8" />
                      {{ linhasVisiveis[nota.chave] ? 'Ocultar' : 'Ver' }} linhas SPED geradas ({{ nota.linhas_geradas.length }})
                    </button>
                    <div v-if="linhasVisiveis[nota.chave]" class="mt-2 bg-graphite rounded-md p-3 font-mono text-[11px] text-paper max-h-40 overflow-y-auto custom-scrollbar-term">
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
                <h4 class="font-display text-[13px] font-semibold text-ink uppercase tracking-[.06em] flex items-center gap-2">
                  <ArrowRightLeft class="w-4 h-4 text-bronze" :stroke-width="1.8" />
                  Regras de Entrada (De-Para)
                </h4>
                <p class="text-[11px] text-risco mt-1">Defina CFOP e CST de destino para cada produto detectado nos XMLs.</p>
              </div>
            </div>

            <div class="border border-line rounded-md overflow-hidden bg-sheet overflow-x-auto">
              <table class="w-full text-left text-[13px]">
                <thead class="bg-paper text-risco uppercase text-[10px] font-semibold border-b border-line">
                  <tr>
                    <th class="px-4 py-3">Fornecedor / Produto</th>
                    <th class="px-4 py-3 w-32 text-center">CFOP Entrada</th>
                    <th class="px-4 py-3 w-24 text-center">CST Destino</th>
                    <th class="px-4 py-3 w-20">Status</th>
                    <th class="px-4 py-3 w-32">Ação</th>
                  </tr>
                </thead>
                <tbody class="italic-inputs">
                  <tr v-for="item in itensDetectados" :key="item.cnpj_fornecedor + item.cod_produto_xml" class="border-t border-line hover:bg-paper">
                    <td class="px-4 py-3">
                      <div class="flex flex-col gap-0.5">
                        <span class="font-medium text-ink text-[13px]">{{ item.descricao_produto }}</span>
                        <span class="text-[10px] text-risco font-mono">{{ item.cnpj_fornecedor }} - Cod: {{ item.cod_produto_xml }}</span>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <input
                        v-model="item.cfop_atual"
                        type="text"
                        maxlength="4"
                        placeholder="CFOP"
                        class="w-full h-8 text-center text-[13px] bg-sheet border border-line rounded-md font-mono text-ink focus:border-bronze outline-none transition-colors"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <input
                        v-model="item.cst_atual"
                        type="text"
                        maxlength="3"
                        placeholder="CST"
                        class="w-full h-8 text-center text-[13px] bg-sheet border border-line rounded-md font-mono text-ink focus:border-bronze outline-none transition-colors"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex justify-center">
                        <CheckCircle2 v-if="item.isMapped" class="w-4 h-4 text-conforme" :stroke-width="1.8" />
                        <span v-else class="w-1.5 h-1.5 rounded-full bg-variacao"></span>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <button
                        @click="saveMapping(item)"
                        :disabled="savingItem === `${item.cnpj_fornecedor}_${item.cod_produto_xml}`"
                        class="w-full h-8 bg-paper border border-line hover:bg-bronze hover:text-white hover:border-bronze text-risco rounded-md text-[10px] font-semibold uppercase tracking-tight transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <template v-if="savingItem === `${item.cnpj_fornecedor}_${item.cod_produto_xml}`">
                          <Loader2 class="w-3 h-3 animate-spin" />
                          Salvando...
                        </template>
                        <template v-else>
                          <Save class="w-3 h-3" :stroke-width="1.8" />
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
      <div class="px-6 py-4 border-t border-line bg-paper flex items-center justify-between">
        <p class="text-[11px] text-risco max-w-md">
          <strong class="text-ink">Aviso:</strong> A alteração do De-Para aqui afeta futuras simulações para os mesmos produtos. Após salvar, realize uma nova geração para aplicar as novas regras.
        </p>
        <div class="flex gap-3">
          <UiButton variant="ghost" @click="emit('close')">
            Fechar
          </UiButton>
          <UiButton @click="emit('close')">
            Finalizar
          </UiButton>
        </div>
      </div>

    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.card-shadow { box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07); }

.animate-fade-in { animation: fadeIn 0.2s ease-out; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: var(--color-paper); }
.custom-scrollbar::-webkit-scrollbar-thumb { background: var(--color-line); border-radius: 10px; }
.custom-scrollbar-term::-webkit-scrollbar { width: 4px; }
.custom-scrollbar-term::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
.custom-scrollbar-term::-webkit-scrollbar-thumb { background: var(--color-graphite-4); border-radius: 4px; }

.italic-inputs input::placeholder { font-weight: normal; color: var(--color-risco); }
</style>
