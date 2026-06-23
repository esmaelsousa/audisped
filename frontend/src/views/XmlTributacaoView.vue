<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { useRoute, useRouter } from 'vue-router';
import { token, empresaSelecionada } from '../store';
import { 
  FileUp, 
  Settings2, 
  Database, 
  Play, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Search,
  Save,
  Trash2,
  FileJson,
  Download,
  Info,
  Loader2,
  Sparkles,
  Zap,
  Eye,
  X
} from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';

const route = useRoute();
const router = useRouter();

// --- ESTADO ---
const currentStep = ref(1);
const files = ref([]);
const isDragOver = ref(false);
const isLoading = ref(false);
const results = ref(null);
const spedBaseId = ref(route.params.id || null);
const spedBaseNome = ref('');

// Opções de Tributação
const configs = ref({
  cfop_padrao: '1102',
  forcar_uso_consumo: false,
  ajuste_ipi: false,
  ajuste_icms: false
});

// Itens Detectados (Mapeamento em tempo real)
const detectedItems = ref([]);
const searchTerm = ref('');
const selectedItemDetails = ref(null);
const showDetailsModal = ref(false);

// CFOPs Gerenciados
const registeredCfops = ref([]);
const showCfopManager = ref(false);
const newCfop = ref({ codigo: '', descricao: '', tipo: 'entrada' });

// --- COMPUTED ---
const filteredItems = computed(() => {
  if (!searchTerm.value) return detectedItems.value;
  const t = searchTerm.value.toLowerCase();
  return detectedItems.value.filter(i => 
    i.descricao_produto.toLowerCase().includes(t) || 
    i.cod_produto_xml.toLowerCase().includes(t) ||
    i.cnpj_fornecedor.includes(t)
  );
});

const mappedCount = computed(() => detectedItems.value.filter(i => i.isMapped).length);
const totalCount = computed(() => detectedItems.value.length);

// --- CICLO DE VIDA ---
onMounted(async () => {
  if (!empresaSelecionada.value) {
    router.push('/');
    return;
  }
  
  fetchCfops();

  if (spedBaseId.value) {
    // Buscar nome do arquivo base se houver ID
    try {
      const res = await axios.get(`${API_BASE_URL}/api/sped-info/${spedBaseId.value}`, {
        headers: { Authorization: `Bearer ${token.value}` }
      });
      spedBaseNome.value = res.data.nome_arquivo;
    } catch (e) {
      console.error('Erro ao buscar info do SPED base');
    }
  }
});

async function fetchCfops() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/cfops`, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    registeredCfops.value = res.data;
  } catch (err) {
    console.error('Erro ao carregar CFOPs');
  }
}

async function addCfop() {
  if (!newCfop.value.codigo) return;
  try {
    await axios.post(`${API_BASE_URL}/api/cfops`, newCfop.value, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    newCfop.value = { codigo: '', descricao: '', tipo: 'entrada' };
    fetchCfops();
  } catch (err) {
    alert(err.response?.data?.message || 'Erro ao adicionar CFOP');
  }
}

async function removeCfop(id) {
  if (!confirm('Excluir este CFOP?')) return;
  try {
    await axios.delete(`${API_BASE_URL}/api/cfops/${id}`, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    fetchCfops();
  } catch (err) {
    alert('Erro ao excluir CFOP');
  }
}

// --- MÉTODOS ---

function onFileChange(e) {
  const selectedFiles = Array.from(e.target.files);
  files.value = [...files.value, ...selectedFiles];
}

function handleDrop(e) {
  isDragOver.value = false;
  const droppedFiles = Array.from(e.dataTransfer.files);
  files.value = [...files.value, ...droppedFiles];
}

function removeFile(index) {
  files.value.splice(index, 1);
}

async function analyzeFiles() {
  if (files.value.length === 0) return;
  
  isLoading.value = true;
  const formData = new FormData();
  files.value.forEach(f => formData.append('xmls', f));
  formData.append('analyzeOnly', 'true');
  formData.append('id_empresa', empresaSelecionada.value.id);

  try {
    const res = await axios.post(`${API_BASE_URL}/api/inject-xml-v2`, formData, {
      headers: { 
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${token.value}` 
      }
    });
    detectedItems.value = res.data.itensDetectados || [];
    currentStep.value = 2;
  } catch (err) {
    alert('Erro ao analisar arquivos. Verifique se são XMLs válidos.');
  } finally {
    isLoading.value = false;
  }
}

async function startInjection() {
  isLoading.value = true;
  const formData = new FormData();
  files.value.forEach(f => formData.append('xmls', f));
  
  // Enviar mapeamentos atuais e opções
  formData.append('cfop_padrao', configs.value.cfop_padrao);
  formData.append('forcar_uso_consumo', configs.value.forcar_uso_consumo);
  formData.append('ajuste_ipi', configs.value.ajuste_ipi);
  formData.append('ajuste_icms', configs.value.ajuste_icms);
  formData.append('id_empresa', empresaSelecionada.value.id);
  
  if (spedBaseId.value) {
    formData.append('id_sped_arquivo', spedBaseId.value);
  }

  // Prepara mapeamento (JSON String)
  const itemMapping = detectedItems.value.map(i => ({
    cnpj_fornecedor: i.cnpj_fornecedor,
    cod_produto_xml: i.cod_produto_xml,
    cfop_alvo: i.cfop_atual,
    cst_alvo: i.cst_atual,
    conta_contabil: i.conta_contabil
  }));
  formData.append('item_mapping', JSON.stringify(itemMapping));

  try {
    const res = await axios.post(`${API_BASE_URL}/api/inject-xml-v2`, formData, {
      headers: { 
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${token.value}` 
      }
    });
    results.value = res.data;
    currentStep.value = 4;
  } catch (err) {
    alert('Erro na injeção. Verifique os logs do servidor.');
  } finally {
    isLoading.value = false;
  }
}

async function saveRuleLocal(item) {
  // Salva no banco de dados para usos futuros
  try {
    const payload = {
      cnpj_emissor: item.cnpj_fornecedor,
      cod_produto_xml: item.cod_produto_xml,
      descricao_produto: item.descricao_produto,
      novo_cfop: item.cfop_atual,
      novo_cst: item.cst_atual,
      conta_contabil: item.conta_contabil,
      id_empresa: empresaSelecionada.value.id
    };
    await axios.post(`${API_BASE_URL}/api/de-para`, payload, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    item.isMapped = true;
  } catch (err) {
    alert('Erro ao salvar regra no banco.');
  }
}

function dowloadSpedFragment() {
  if (!results.value) return;
  const content = [...results.value.bloco0, ...results.value.blocoC].join('\n');
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fragmento_sped_xml.txt`;
  a.click();
}

function formatCurrency(val) {
  if (val === undefined || val === null) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function parseValor(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  return parseFloat(val.toString().replace(',', '.'));
}

function openDetails(item) {
  selectedItemDetails.value = item;
  showDetailsModal.value = true;
}

function closeDetails() {
  selectedItemDetails.value = null;
  showDetailsModal.value = false;
}

</script>

<template>
  <div class="flex-1 flex flex-col bg-paper text-ink min-h-screen">
    <!-- Header -->
    <header class="bg-sheet border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-4 px-4 sm:px-8 py-5 sticky top-0 z-20">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-bronze/10 rounded-md flex items-center justify-center border border-bronze/20">
          <Zap class="w-5 h-5 text-bronze" :stroke-width="1.8" />
        </div>
        <div class="space-y-1">
          <h1 class="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">
            Conciliação XML
          </h1>
          <p class="text-[13px] text-risco">Fluxo de Injeção XML → SPED Fiscal</p>
        </div>
      </div>

      <!-- Stepper -->
      <div class="flex items-center gap-3">
        <div v-for="step in 4" :key="step" class="flex items-center">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold transition-colors border"
            :class="[
              currentStep === step ? 'bg-bronze border-bronze text-white' :
              currentStep > step ? 'bg-conforme border-conforme text-white' :
              'bg-paper border-line text-risco'
            ]"
          >
            <CheckCircle2 v-if="currentStep > step" class="w-5 h-5" :stroke-width="1.8" />
            <span v-else>{{ step }}</span>
          </div>
          <div v-if="step < 4" class="w-8 h-0.5 bg-line mx-2" :class="{'bg-conforme': currentStep > step}"></div>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">

      <!-- STEP 1: UPLOAD -->
      <section v-if="currentStep === 1" class="space-y-6">
        <div class="bg-sheet border border-line rounded-md p-8 sm:p-12 text-center">
          <div
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="handleDrop"
            :class="{'border-bronze bg-bronze/5': isDragOver}"
            class="border-2 border-dashed border-line rounded-md p-10 sm:p-16 transition-colors"
          >
            <FileUp class="w-16 h-16 text-bronze mx-auto mb-6" :stroke-width="1.6" />
            <h2 class="font-display text-[18px] font-semibold text-ink mb-2">Arraste seus XMLs de Compra</h2>
            <p class="text-[13px] text-risco mb-8 max-w-md mx-auto">Selecione múltiplos arquivos .xml de NF-e para processamento em lote e remapeamento automático.</p>

            <label class="inline-flex items-center gap-[7px] rounded-md bg-bronze text-white px-[13px] py-[7px] text-[13px] font-medium cursor-pointer transition-opacity hover:opacity-85">
              <Search class="w-4 h-4" :stroke-width="1.8" />
              Procurar Arquivos
              <input type="file" multiple accept=".xml" class="hidden" @change="onFileChange" />
            </label>
          </div>
        </div>

        <!-- Lista de Arquivos Selecionados -->
        <div v-if="files.length > 0" class="bg-sheet border border-line rounded-md p-6">
          <h3 class="text-[11px] font-medium text-risco uppercase tracking-wide mb-4 flex items-center justify-between">
            Arquivos na fila ({{ files.length }})
            <button @click="files = []" class="text-lacre hover:opacity-80 text-[12px] font-medium transition-opacity">Limpar Tudo</button>
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div v-for="(f, i) in files" :key="i" class="bg-paper border border-line rounded-md p-3 flex items-center justify-between group">
               <div class="flex items-center gap-3 truncate">
                 <FileJson class="w-5 h-5 text-bronze shrink-0" :stroke-width="1.8" />
                 <span class="text-[13px] text-risco truncate font-mono">{{ f.name }}</span>
               </div>
               <button @click="removeFile(i)" class="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-lacre/10 rounded-md transition-all">
                 <Trash2 class="w-4 h-4 text-lacre" :stroke-width="1.8" />
               </button>
            </div>
          </div>

          <div class="mt-8 flex justify-end">
             <UiButton
               @click="analyzeFiles"
               :disabled="isLoading"
               class="disabled:opacity-50"
             >
               <Loader2 v-if="isLoading" class="w-4 h-4 animate-spin" :stroke-width="1.8" />
               <Sparkles v-else class="w-4 h-4" :stroke-width="1.8" />
               {{ isLoading ? 'Analisando...' : 'Iniciar Análise' }}
             </UiButton>
          </div>
        </div>
      </section>

      <!-- STEP 2: REGRAS E MAPEAMENTO -->
      <section v-if="currentStep === 2" class="space-y-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
          <div class="space-y-1">
            <h2 class="font-display text-[18px] font-semibold text-ink">
              Detecção de Itens e Tributação
            </h2>
            <p class="text-[13px] text-risco">Validamos {{ totalCount }} itens únicos. Por favor, confirme o CFOP/CST de destino abaixo.</p>
          </div>
          <div class="flex items-center gap-3">
             <div class="bg-conforme/[0.06] border border-conforme/25 px-4 py-2 rounded-md">
               <span class="text-[11px] text-risco uppercase block font-medium tracking-wide">Mapeados</span>
               <span class="text-[18px] font-semibold text-conforme leading-none font-mono">{{ mappedCount }} / {{ totalCount }}</span>
             </div>
             <div class="relative">
                <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
                <input v-model="searchTerm" type="text" placeholder="Filtrar por produto..." class="bg-sheet border border-line rounded-md py-2 pl-9 pr-3 text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors" />
             </div>
          </div>
        </div>

        <div class="bg-sheet border border-line rounded-md overflow-hidden max-h-[500px] overflow-y-auto custom-scrollbar">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10">
              <tr class="bg-paper text-[10px] font-semibold uppercase text-risco tracking-[.08em] border-b border-line">
                <th class="px-5 py-3">Fornecedor / Produto</th>
                <th class="px-5 py-3">Data / Nota</th>
                <th class="px-5 py-3 text-center">NCM</th>
                <th class="px-5 py-3">Valores XML</th>
                <th class="px-5 py-3">Desc / Frete</th>
                <th class="px-5 py-3">CFOP Dest.</th>
                <th class="px-5 py-3">CST Dest.</th>
                <th class="px-5 py-3">Cód. Interno (ERP)</th>
                <th class="px-5 py-3">Conta Contábil</th>
                <th class="px-5 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredItems" :key="item.cnpj_fornecedor + item.cod_produto_xml + item.numero_nota" class="border-t border-line hover:bg-paper transition-colors group">
                <td class="px-5 py-3">
                  <div class="text-[10px] text-bronze font-mono mb-1">{{ item.cnpj_fornecedor }} - {{ item.nome_fornecedor }}</div>
                  <div class="text-[13px] font-medium text-ink line-clamp-1" :title="item.descricao_produto">
                    <span class="text-risco font-mono mr-2">{{ item.cod_produto_xml }}</span>
                    {{ item.descricao_produto }}
                  </div>
                </td>
                <td class="px-5 py-3">
                   <div class="text-[13px] font-semibold text-ink font-mono">{{ item.numero_nota }}</div>
                   <div class="text-[10px] text-risco font-mono">{{ formatDate(item.data_nota) }}</div>
                </td>
                <td class="px-5 py-3 font-mono text-center text-[12px] text-risco">{{ item.ncm }}</td>
                <td class="px-5 py-3">
                   <div class="text-[10px] text-risco">Unit: <span class="text-conforme font-semibold font-mono">{{ formatCurrency(item.valor_unitario) }}</span></div>
                   <div class="text-[10px] text-risco font-mono">Total: {{ formatCurrency(item.valor_total) }}</div>
                </td>
                <td class="px-5 py-3">
                   <div class="text-[10px] text-lacre font-mono" v-if="parseValor(item.desconto) > 0">Desc: -{{ formatCurrency(item.desconto) }}</div>
                   <div class="text-[10px] text-variacao font-mono" v-if="parseValor(item.frete) > 0">Frete: +{{ formatCurrency(item.frete) }}</div>
                   <div class="text-[10px] text-risco" v-else-if="!item.desconto && !item.frete">-</div>
                </td>
                <td class="px-5 py-3">
                  <input v-model="item.cfop_atual" list="cfop-suggestions" type="text" class="w-14 bg-sheet border border-line rounded-md px-2 py-1 text-conforme font-semibold font-mono text-[12px] outline-none focus:border-bronze transition-colors" />
                </td>
                <td class="px-5 py-3">
                   <input v-model="item.cst_atual" type="text" class="w-12 bg-sheet border border-line rounded-md px-2 py-1 text-variacao font-semibold font-mono text-[12px] outline-none focus:border-bronze transition-colors" />
                </td>
                <td class="px-5 py-3">
                   <div class="relative">
                     <input v-model="item.cod_interno" type="text" placeholder="Cód. ERP..." class="w-24 bg-sheet border border-line rounded-md px-2 py-1 text-[12px] text-ink font-mono outline-none focus:border-bronze transition-colors" />
                     <div v-if="item.cod_item_sugerido && !item.cod_interno" class="absolute -top-3 left-0 text-[8px] text-bronze font-semibold font-mono">
                       Sugestão: {{ item.cod_item_sugerido }}
                     </div>
                   </div>
                </td>
                <td class="px-5 py-3">
                   <input v-model="item.conta_contabil" type="text" placeholder="60..." class="w-20 bg-sheet border border-line rounded-md px-2 py-1 text-[10px] text-ink font-mono outline-none focus:border-bronze transition-colors" />
                </td>
                <td class="px-5 py-3 text-right">
                   <div class="flex items-center justify-end gap-1">
                     <button
                       @click="openDetails(item)"
                       class="p-1.5 rounded-md hover:bg-paper transition-colors text-risco hover:text-bronze"
                       title="Ver Detalhes/Origem"
                     >
                        <Eye class="w-4 h-4" :stroke-width="1.8" />
                     </button>
                     <button
                       @click="saveRuleLocal(item)"
                       :disabled="item.isMapped"
                       class="p-1.5 rounded-md hover:bg-conforme/10 transition-colors text-risco hover:text-conforme"
                       :class="{'text-conforme opacity-100': item.isMapped}"
                       title="Salvar Regra"
                     >
                        <Save class="w-4 h-4" :stroke-width="1.8" />
                     </button>
                   </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between pt-6 border-t border-line">
          <button @click="currentStep = 1" class="flex items-center gap-2 text-risco hover:text-ink text-[13px] font-medium transition-colors">
            <ChevronLeft class="w-4 h-4" :stroke-width="1.8" /> Voltar para Arquivos
          </button>
          <UiButton @click="currentStep = 3">
            Configuração Avançada <ChevronRight class="w-4 h-4" :stroke-width="1.8" />
          </UiButton>
        </div>
      </section>

      <!-- STEP 3: CONFIGURAÇÃO DE CUSTO -->
      <section v-if="currentStep === 3" class="max-w-3xl mx-auto space-y-6">
        <div class="bg-sheet border border-line rounded-md p-6 sm:p-8 space-y-6">
          <div class="flex items-center gap-3 mb-2">
             <Settings2 class="w-6 h-6 text-bronze" :stroke-width="1.8" />
             <div class="space-y-1">
               <h2 class="font-display text-[18px] font-semibold text-ink">Regras de Injeção de Custo</h2>
               <p class="text-[13px] text-risco">Configure como o sistema deve tratar impostos e CFOPs residuais.</p>
             </div>
          </div>

          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 bg-paper rounded-md border border-line">
               <div>
                  <h4 class="font-medium text-ink text-[13px] mb-1">CFOP de Entrada Padrão</h4>
                  <p class="text-[12px] text-risco">Usado quando não houver regra específica de De-Para.</p>
               </div>
               <div class="flex gap-2">
                 <input v-model="configs.cfop_padrao" list="cfop-suggestions" type="text" class="w-24 bg-sheet border border-line rounded-md px-4 py-2 text-bronze font-semibold font-mono text-center text-[16px] outline-none focus:border-bronze transition-colors" />
                 <button @click="showCfopManager = true" class="bg-sheet hover:bg-paper border border-line p-2.5 rounded-md transition-colors" title="Gerenciar CFOPs">
                   <Settings2 class="w-5 h-5 text-risco" :stroke-width="1.8" />
                 </button>
               </div>
            </div>

            <!-- FORÇAR CST 040 -->
            <div class="flex items-center justify-between p-4 bg-paper rounded-md border border-line">
               <div class="flex-1 pr-10">
                  <h4 class="font-medium text-ink text-[13px] mb-1">Forçar Uso/Consumo (CST 040)</h4>
                  <p class="text-[12px] text-risco">Itens com CFOP 1.556 serão transformados em Isentos (CST 040) e terão a Base de Cálculo e ICMS zerados automaticamente.</p>
               </div>
               <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="configs.forcar_uso_consumo" type="checkbox" class="sr-only peer">
                  <div class="w-14 h-7 bg-line peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-conforme"></div>
               </label>
            </div>

            <!-- AJUSTE IPI NO CUSTO -->
            <div class="flex items-center justify-between p-4 bg-paper rounded-md border border-line">
               <div class="flex-1 pr-10">
                  <h4 class="font-medium text-ink text-[13px] mb-1">
                    Somar IPI ao Valor do Produto
                  </h4>
                  <p class="text-[12px] text-risco">Incorpora o valor do IPI ao valor unitário da mercadoria (C170) para fins de composição de custo bruto no SPED.</p>
               </div>
               <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="configs.ajuste_ipi" type="checkbox" class="sr-only peer">
                  <div class="w-14 h-7 bg-line rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-bronze after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line after:border after:rounded-full after:h-6 after:w-6 after:transition-all"></div>
               </label>
            </div>

             <!-- AJUSTE ICMS NO CUSTO -->
             <div class="flex items-center justify-between p-4 bg-paper rounded-md border border-line">
               <div class="flex-1 pr-10">
                  <h4 class="font-medium text-ink text-[13px] mb-1">
                    Somar ICMS ao Valor do Produto
                  </h4>
                  <p class="text-[12px] text-risco">Útil para empresas que não recuperam crédito de ICMS. O imposto é incorporado ao custo do item e o crédito é zerado.</p>
               </div>
               <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="configs.ajuste_icms" type="checkbox" class="sr-only peer">
                  <div class="w-14 h-7 bg-line rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-bronze after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line after:border after:rounded-full after:h-6 after:w-6 after:transition-all"></div>
               </label>
            </div>
          </div>
        </div>

        <!-- Arquivo Base Info -->
        <div v-if="spedBaseId" class="bg-bronze/[0.06] border border-bronze/25 rounded-md p-5 flex items-center gap-4">
           <Database class="w-7 h-7 text-bronze" :stroke-width="1.8" />
           <div class="space-y-1">
             <span class="text-[10px] text-bronze font-medium uppercase tracking-wide block">Arquivo Destino de Injeção</span>
             <span class="text-[13px] font-medium text-ink">{{ spedBaseNome }}</span>
           </div>
        </div>

        <div class="flex items-center justify-between pt-4">
          <button @click="currentStep = 2" class="flex items-center gap-2 text-risco hover:text-ink text-[13px] font-medium transition-colors">
            <ChevronLeft class="w-4 h-4" :stroke-width="1.8" /> Revisar Itens
          </button>
          <UiButton
            @click="startInjection"
            :disabled="isLoading"
            class="bg-conforme disabled:opacity-50"
          >
            <Loader2 v-if="isLoading" class="w-4 h-4 animate-spin" :stroke-width="1.8" />
            <Play v-else class="w-4 h-4 fill-current" :stroke-width="1.8" />
            Executar Injeção Final
          </UiButton>
        </div>
      </section>

      <!-- STEP 4: RESULTADO -->
      <section v-if="currentStep === 4" class="max-w-4xl mx-auto space-y-8">
        <div class="text-center space-y-3">
           <div class="w-20 h-20 bg-conforme/[0.08] rounded-full flex items-center justify-center mx-auto border border-conforme/40 mb-4">
              <CheckCircle2 class="w-10 h-10 text-conforme" :stroke-width="1.8" />
           </div>
           <h2 class="font-display text-[26px] font-semibold text-ink tracking-[-0.01em]">Injeção Concluída com Sucesso!</h2>
           <p class="text-risco text-[13px]">Seu fluxo de compras foi integrado com precisão.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
           <div class="bg-sheet border border-line rounded-md p-6 space-y-5">
              <h3 class="text-[11px] font-medium text-risco uppercase tracking-wide border-b border-line pb-4">Resumo da Operação</h3>
              <div class="grid grid-cols-2 gap-4">
                 <div class="space-y-1">
                   <div class="text-[10px] text-risco uppercase font-medium tracking-wide">Documentos</div>
                   <div class="text-[22px] font-semibold text-ink font-mono">{{ results.relatorio.totalNotas }} <span class="text-[12px] font-normal text-risco font-body">NF-es</span></div>
                 </div>
                 <div class="space-y-1 text-right">
                   <div class="text-[10px] text-risco uppercase font-medium tracking-wide">Valor Total Mercadorias</div>
                   <div class="text-[22px] font-semibold text-bronze font-mono">R$ {{ results.relatorio.totalValorCompras }}</div>
                 </div>
              </div>
              <div class="p-4 bg-variacao/[0.06] border border-variacao/25 rounded-md flex items-center gap-3">
                 <AlertCircle class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.8" />
                 <span class="text-[12px] text-ink">Todas as linhas C100, C170 e C190 foram geradas e ajustadas conforme suas regras de custo.</span>
              </div>
           </div>

           <div class="bg-sheet border border-line rounded-md p-6 flex flex-col justify-center gap-4">
              <h3 class="text-[11px] font-medium text-risco uppercase tracking-wide text-center">Próximos Passos</h3>

              <UiButton
                variant="ghost"
                @click="dowloadSpedFragment"
                class="w-full justify-center py-[11px]"
              >
                <Download class="w-4 h-4" :stroke-width="1.8" /> Download Fragmento SPED
              </UiButton>

              <UiButton
                v-if="spedBaseId"
                @click="router.push(`/analisador/${spedBaseId}`)"
                class="w-full justify-center py-[11px]"
              >
                <Database class="w-4 h-4" :stroke-width="1.8" /> Abrir no Analisador Crítico
              </UiButton>

              <button
                @click="currentStep = 1; files = []; results = null;"
                class="w-full text-risco hover:text-ink py-2 text-[12px] font-medium transition-colors"
              >
                Iniciar Novo Processo
              </button>
           </div>
        </div>
      </section>

    </main>

    <!-- Footer Stats -->
    <footer class="h-10 bg-graphite border-t border-line flex items-center px-4 sm:px-8 justify-between text-[10px] text-muted font-medium uppercase tracking-wide">
       <div>
         Status: <span class="text-conforme">Online</span>
       </div>
       <div class="flex items-center gap-4">
         <span>AudiSped</span>
         <div class="flex gap-1">
           <div class="w-1 h-1 bg-bronze rounded-full"></div>
           <div class="w-1 h-1 bg-bronze rounded-full"></div>
           <div class="w-1 h-1 bg-bronze rounded-full"></div>
         </div>
       </div>
    </footer>
    <!-- Datalist para CFOPs -->
    <datalist id="cfop-suggestions">
      <option v-for="cf in registeredCfops" :key="cf.id" :value="cf.codigo">{{ cf.descricao }}</option>
    </datalist>

    <!-- Modal de Gestão de CFOPs -->
    <div v-if="showCfopManager" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        @click="showCfopManager = false"
        class="absolute inset-0 bg-ink/40"
      ></div>

      <div class="relative w-full max-w-2xl bg-sheet border border-line rounded-md overflow-hidden card-shadow">
        <div class="p-6 border-b border-line flex items-center justify-between">
          <h3 class="font-display text-[16px] font-semibold text-ink">
            Gerenciar CFOPs
          </h3>
          <button @click="showCfopManager = false" class="p-2 hover:bg-paper rounded-md text-risco hover:text-ink transition-colors">
            <X class="w-5 h-5" :stroke-width="1.8" />
          </button>
        </div>

        <div class="p-6 space-y-6">
          <div class="bg-paper p-4 rounded-md border border-line space-y-4">
            <h4 class="text-[11px] font-medium text-risco uppercase tracking-wide">Adicionar Novo Código</h4>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input v-model="newCfop.codigo" type="text" placeholder="Cód. ex: 1403" class="bg-sheet border border-line rounded-md px-3 py-2 text-ink font-mono text-[13px] outline-none focus:border-bronze transition-colors" />
              <input v-model="newCfop.descricao" type="text" placeholder="Descrição..." class="bg-sheet border border-line rounded-md px-3 py-2 text-ink text-[13px] outline-none focus:border-bronze transition-colors" />
              <UiButton @click="addCfop" class="justify-center">Adicionar</UiButton>
            </div>
          </div>

          <div class="max-h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            <div v-for="cf in registeredCfops" :key="cf.id" class="flex items-center justify-between p-3 bg-paper rounded-md border border-line hover:border-bronze/40 transition-colors">
              <div class="flex items-center gap-3">
                <span class="text-bronze font-semibold font-mono text-[13px]">{{ cf.codigo }}</span>
                <span class="text-[12px] text-risco">{{ cf.descricao }}</span>
              </div>
              <button @click="removeCfop(cf.id)" class="text-risco hover:text-lacre p-1 transition-colors">
                <Trash2 class="w-4 h-4" :stroke-width="1.8" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(18, 24, 32, 0.12);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(18, 24, 32, 0.22);
}
</style>
