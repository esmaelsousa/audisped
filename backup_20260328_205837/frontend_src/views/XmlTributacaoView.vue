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
  <div class="flex-1 flex flex-col bg-[#0f172a] text-slate-200 min-h-screen">
    <!-- Header Premium -->
    <header class="h-24 bg-[#1e293b]/50 border-b border-white/5 flex items-center justify-between px-10 backdrop-blur-xl sticky top-0 z-20">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 bg-brand-accent/20 rounded-2xl flex items-center justify-center border border-brand-accent/30 shadow-lg shadow-brand-accent/10">
          <Zap class="w-6 h-6 text-brand-accent animate-pulse" />
        </div>
        <div>
          <h1 class="text-2xl font-black text-white tracking-tighter uppercase italic">
            Analista <span class="text-brand-accent">Premium</span> AI
          </h1>
          <p class="text-xs text-slate-400 font-medium">Fluxo Inteligente de Injeção XML -> SPED Fiscal</p>
        </div>
      </div>

      <!-- Stepper Vertical/Horizontal -->
      <div class="flex items-center gap-4">
        <div v-for="step in 4" :key="step" class="flex items-center">
          <div 
            class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 border-2"
            :class="[
              currentStep === step ? 'bg-brand-accent border-brand-accent text-white scale-110 shadow-lg shadow-brand-accent/30' : 
              currentStep > step ? 'bg-emerald-500 border-emerald-500 text-white' : 
              'bg-transparent border-white/10 text-slate-500'
            ]"
          >
            <CheckCircle2 v-if="currentStep > step" class="w-5 h-5" />
            <span v-else>{{ step }}</span>
          </div>
          <div v-if="step < 4" class="w-8 h-0.5 bg-white/5 mx-2" :class="{'bg-brand-accent/50': currentStep > step}"></div>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 p-10 max-w-7xl mx-auto w-full">
      
      <!-- STEP 1: UPLOAD -->
      <section v-if="currentStep === 1" class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div class="bg-[#1e293b]/40 border border-white/5 rounded-3xl p-12 text-center relative overflow-hidden group">
          <div class="absolute inset-0 bg-gradient-to-br from-brand-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          
          <div 
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="handleDrop"
            :class="{'border-brand-accent bg-brand-accent/5': isDragOver}"
            class="border-2 border-dashed border-white/10 rounded-2xl p-16 transition-all relative z-10"
          >
            <FileUp class="w-20 h-20 text-brand-accent mx-auto mb-6 opacity-80" />
            <h2 class="text-2xl font-bold text-white mb-2">Arraste seus XMLs de Compra</h2>
            <p class="text-slate-400 mb-8 max-w-md mx-auto">Selecione múltiplos arquivos .xml de NF-e para processamento em lote e remapeamento automático.</p>
            
            <label class="bg-brand-accent hover:bg-brand-accent/90 text-white px-8 py-3.5 rounded-xl font-bold cursor-pointer transition-all shadow-xl shadow-brand-accent/20 inline-flex items-center gap-2 active:scale-95">
              <Search class="w-5 h-5" />
              Procurar Arquivos
              <input type="file" multiple accept=".xml" class="hidden" @change="onFileChange" />
            </label>
          </div>
        </div>

        <!-- Lista de Arquivos Selecionados -->
        <div v-if="files.length > 0" class="bg-[#1e293b]/40 border border-white/5 rounded-2xl p-6">
          <h3 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between">
            Arquivos na fila ({{ files.length }})
            <button @click="files = []" class="text-red-400 hover:text-red-300 text-xs font-bold transition-colors">Limpar Tudo</button>
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div v-for="(f, i) in files" :key="i" class="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center justify-between group">
               <div class="flex items-center gap-3 truncate">
                 <FileJson class="w-5 h-5 text-brand-accent shrink-0" />
                 <span class="text-sm text-slate-300 truncate font-mono">{{ f.name }}</span>
               </div>
               <button @click="removeFile(i)" class="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 rounded transition-all">
                 <Trash2 class="w-4 h-4 text-red-400" />
               </button>
            </div>
          </div>
          
          <div class="mt-10 flex justify-end">
             <button 
               @click="analyzeFiles"
               :disabled="isLoading"
               class="bg-brand-secondary hover:bg-brand-secondary/90 text-white px-10 py-4 rounded-xl font-black uppercase text-sm tracking-widest flex items-center gap-3 transition-all shadow-lg active:scale-95 disabled:opacity-50"
             >
               <Loader2 v-if="isLoading" class="w-5 h-5 animate-spin" />
               <Sparkles v-else class="w-5 h-5" />
               {{ isLoading ? 'Analisando Estruturas...' : 'Iniciar Análise Proativa' }}
             </button>
          </div>
        </div>
      </section>

      <!-- STEP 2: REGRAS E MAPEAMENTO -->
      <section v-if="currentStep === 2" class="space-y-6 animate-in fade-in zoom-in-95 duration-500">
        <div class="flex items-center justify-between mb-2">
          <div>
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              Detecção de Itens e Tributação
            </h2>
            <p class="text-sm text-slate-400">Validamos {{ totalCount }} itens únicos. Por favor, confirme o CFOP/CST de destino abaixo.</p>
          </div>
          <div class="flex items-center gap-4">
             <div class="bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-xl">
               <span class="text-xs text-slate-400 uppercase block font-bold tracking-tighter">Mapeados</span>
               <span class="text-lg font-black text-emerald-400 leading-none">{{ mappedCount }} / {{ totalCount }}</span>
             </div>
             <div class="relative">
                <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input v-model="searchTerm" type="text" placeholder="Filtrar por produto..." class="bg-[#1e293b] border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-1 focus:ring-brand-accent outline-none" />
             </div>
          </div>
        </div>

        <div class="bg-[#1e293b]/40 border border-white/5 rounded-2xl overflow-hidden max-h-[500px] overflow-y-auto custom-scrollbar">
          <table class="w-full text-left">
            <thead class="bg-white/5 sticky top-0 z-10 backdrop-blur-md">
              <tr class="text-[10px] font-black uppercase text-slate-500 tracking-widest border-b border-white/5">
                <th class="px-6 py-4">Fornecedor / Produto</th>
                <th class="px-6 py-4">Data / Nota</th>
                <th class="px-6 py-4 text-center">NCM</th>
                <th class="px-6 py-4">Valores XML</th>
                <th class="px-6 py-4">Desc / Frete</th>
                <th class="px-6 py-4">CFOP Dest.</th>
                <th class="px-6 py-4">CST Dest.</th>
                <th class="px-6 py-4">Cód. Interno (ERP)</th>
                <th class="px-6 py-4">Conta Contábil</th>
                <th class="px-6 py-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              <tr v-for="item in filteredItems" :key="item.cnpj_fornecedor + item.cod_produto_xml + item.numero_nota" class="hover:bg-white/5 transition-colors group">
                <td class="px-6 py-3">
                  <div class="text-[10px] text-brand-accent font-mono mb-1">{{ item.cnpj_fornecedor }} - {{ item.nome_fornecedor }}</div>
                  <div class="text-xs font-bold text-slate-200 line-clamp-1" :title="item.descricao_produto">
                    <span class="text-slate-500 font-mono mr-2">{{ item.cod_produto_xml }}</span>
                    {{ item.descricao_produto }}
                  </div>
                </td>
                <td class="px-6 py-3">
                   <div class="text-xs font-black text-white">{{ item.numero_nota }}</div>
                   <div class="text-[10px] text-slate-500">{{ formatDate(item.data_nota) }}</div>
                </td>
                <td class="px-6 py-3 font-mono text-center text-xs text-slate-400">{{ item.ncm }}</td>
                <td class="px-6 py-3">
                   <div class="text-[10px] text-slate-400">Unit: <span class="text-emerald-400 font-bold">{{ formatCurrency(item.valor_unitario) }}</span></div>
                   <div class="text-[10px] text-slate-500">Total: {{ formatCurrency(item.valor_total) }}</div>
                </td>
                <td class="px-6 py-3">
                   <div class="text-[10px] text-red-400/70" v-if="parseValor(item.desconto) > 0">Desc: -{{ formatCurrency(item.desconto) }}</div>
                   <div class="text-[10px] text-amber-400/70" v-if="parseValor(item.frete) > 0">Frete: +{{ formatCurrency(item.frete) }}</div>
                   <div class="text-[10px] text-slate-600" v-else-if="!item.desconto && !item.frete">-</div>
                </td>
                <td class="px-6 py-3">
                  <input v-model="item.cfop_atual" list="cfop-suggestions" type="text" class="w-14 bg-white/5 border border-white/10 rounded px-2 py-1 text-emerald-400 font-bold font-mono text-xs outline-none focus:border-brand-accent" />
                </td>
                <td class="px-6 py-3">
                   <input v-model="item.cst_atual" type="text" class="w-12 bg-white/5 border border-white/10 rounded px-2 py-1 text-amber-400 font-bold font-mono text-xs outline-none focus:border-brand-accent" />
                </td>
                <td class="px-6 py-3">
                   <div class="relative">
                     <input v-model="item.cod_interno" type="text" placeholder="Cód. ERP..." class="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs outline-none focus:border-brand-accent" />
                     <div v-if="item.cod_item_sugerido && !item.cod_interno" class="absolute -top-3 left-0 text-[8px] text-brand-accent font-bold animate-pulse">
                       Sugestão IA: {{ item.cod_item_sugerido }}
                     </div>
                   </div>
                </td>
                <td class="px-6 py-3">
                   <input v-model="item.conta_contabil" type="text" placeholder="60..." class="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] outline-none focus:border-brand-accent" />
                </td>
                <td class="px-6 py-3 text-right">
                   <div class="flex items-center justify-end gap-1">
                     <button 
                       @click="openDetails(item)"
                       class="p-2 rounded-lg hover:bg-white/10 transition-all text-slate-400 hover:text-white"
                       title="Ver Detalhes/Origem"
                     >
                        <Eye class="w-4 h-4" />
                     </button>
                     <button 
                       @click="saveRuleLocal(item)"
                       :disabled="item.isMapped"
                       class="p-2 rounded-lg hover:bg-emerald-500/10 transition-all text-slate-400 hover:text-emerald-400"
                       :class="{'text-emerald-500 opacity-100': item.isMapped}"
                       title="Salvar Regra"
                     >
                        <Save class="w-4 h-4" />
                     </button>
                   </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between pt-6 border-t border-white/5">
          <button @click="currentStep = 1" class="flex items-center gap-2 text-slate-400 hover:text-white font-bold transition-all">
            <ChevronLeft class="w-5 h-5" /> Voltar para Arquivos
          </button>
          <button @click="currentStep = 3" class="bg-brand-accent hover:bg-brand-accent/90 text-white px-10 py-3.5 rounded-xl font-black uppercase text-sm tracking-widest flex items-center gap-3 transition-all">
            Configuração Avançada <ChevronRight class="w-5 h-5" />
          </button>
        </div>
      </section>

      <!-- STEP 3: CONFIGURAÇÃO DE CUSTO -->
      <section v-if="currentStep === 3" class="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
        <div class="bg-[#1e293b]/40 border border-white/5 rounded-3xl p-10 space-y-8">
          <div class="flex items-center gap-4 mb-2">
             <Settings2 class="w-8 h-8 text-brand-accent" />
             <div>
               <h2 class="text-2xl font-bold text-white tracking-tight">Regras de Injeção de Custo</h2>
               <p class="text-slate-400">Configure como o sistema deve tratar impostos e CFOPs residuais.</p>
             </div>
          </div>

          <div class="space-y-6">
            <div class="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
               <div>
                  <h4 class="font-bold text-white mb-1">CFOP de Entrada Padrão</h4>
                  <p class="text-xs text-slate-400 italic">Usado quando não houver regra específica de De-Para.</p>
               </div>
               <div class="flex gap-2">
                 <input v-model="configs.cfop_padrao" list="cfop-suggestions" type="text" class="w-24 bg-[#0f172a] border border-white/10 rounded-xl px-4 py-2 text-brand-accent font-black text-center text-lg shadow-inner outline-none focus:border-brand-accent transition-all" />
                 <button @click="showCfopManager = true" class="bg-[#0f172a] hover:bg-white/5 border border-white/10 p-3 rounded-xl transition-all" title="Gerenciar CFOPs">
                   <Settings2 class="w-5 h-5 text-slate-400" />
                 </button>
               </div>
            </div>

            <!-- FORÇAR CST 040 -->
            <div class="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
               <div class="flex-1 pr-10">
                  <h4 class="font-bold text-white mb-1">Forçar Uso/Consumo (CST 040)</h4>
                  <p class="text-xs text-slate-400">Itens com CFOP 1.556 serão transformados em Isentos (CST 040) e terão a Base de Cálculo e ICMS zerados automaticamente.</p>
               </div>
               <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="configs.forcar_uso_consumo" type="checkbox" class="sr-only peer">
                  <div class="w-14 h-7 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500"></div>
               </label>
            </div>

            <!-- AJUSTE IPI NO CUSTO -->
            <div class="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
               <div class="flex-1 pr-10">
                  <h4 class="font-bold text-white mb-1 flex items-center gap-2">
                    Somar IPI ao Valor do Produto
                    <span class="bg-amber-500/10 text-amber-500 text-[8px] px-1.5 py-0.5 rounded border border-amber-500/20">PREMIUM</span>
                  </h4>
                  <p class="text-xs text-slate-400">Incorpora o valor do IPI ao valor unitário da mercadoria (C170) para fins de composição de custo bruto no SPED.</p>
               </div>
               <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="configs.ajuste_ipi" type="checkbox" class="sr-only peer">
                  <div class="w-14 h-7 bg-white/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-brand-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all"></div>
               </label>
            </div>

             <!-- AJUSTE ICMS NO CUSTO -->
             <div class="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
               <div class="flex-1 pr-10">
                  <h4 class="font-bold text-white mb-1 flex items-center gap-2">
                    Somar ICMS ao Valor do Produto
                    <span class="bg-amber-500/10 text-amber-500 text-[8px] px-1.5 py-0.5 rounded border border-amber-500/20">PREMIUM</span>
                  </h4>
                  <p class="text-xs text-slate-400">Útil para empresas que não recuperam crédito de ICMS. O imposto é incorporado ao custo do item e o crédito é zerado.</p>
               </div>
               <label class="relative inline-flex items-center cursor-pointer">
                  <input v-model="configs.ajuste_icms" type="checkbox" class="sr-only peer">
                  <div class="w-14 h-7 bg-white/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-brand-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all"></div>
               </label>
            </div>
          </div>
        </div>

        <!-- Arquivo Base Info -->
        <div v-if="spedBaseId" class="bg-brand-accent/5 border border-brand-accent/20 rounded-2xl p-6 flex items-center gap-4">
           <Database class="w-8 h-8 text-brand-accent opacity-50" />
           <div>
             <span class="text-[10px] text-brand-accent font-bold uppercase tracking-wider block">Arquivo Destino de Injeção</span>
             <span class="text-sm font-bold text-white">{{ spedBaseNome }}</span>
           </div>
        </div>

        <div class="flex items-center justify-between pt-4">
          <button @click="currentStep = 2" class="flex items-center gap-2 text-slate-400 hover:text-white font-bold transition-all">
            <ChevronLeft class="w-5 h-5" /> Revisar Itens
          </button>
          <button 
            @click="startInjection"
            :disabled="isLoading"
            class="bg-emerald-500 hover:bg-emerald-600 text-white px-12 py-4 rounded-xl font-black uppercase text-sm tracking-widest flex items-center gap-3 transition-all shadow-xl shadow-emerald-500/20 disabled:opacity-50"
          >
            <Loader2 v-if="isLoading" class="w-5 h-5 animate-spin" />
            <Play v-else class="w-5 h-5 fill-current" />
            Executar Injeção Final
          </button>
        </div>
      </section>

      <!-- STEP 4: RESULTADO -->
      <section v-if="currentStep === 4" class="max-w-4xl mx-auto space-y-10 animate-in fade-in zoom-in-95 duration-700">
        <div class="text-center space-y-4">
           <div class="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-4 border-emerald-500/50 mb-6">
              <CheckCircle2 class="w-12 h-12 text-emerald-500" />
           </div>
           <h2 class="text-4xl font-black text-white tracking-tighter">Injeção Concluída com Sucesso!</h2>
           <p class="text-slate-400 text-lg">Seu fluxo de compras foi integrado com precisão cirúrgica.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
           <div class="bg-[#1e293b]/40 border border-white/5 rounded-3xl p-8 space-y-6">
              <h3 class="text-sm font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-4">Resumo da Operação</h3>
              <div class="grid grid-cols-2 gap-4">
                 <div class="space-y-1">
                   <div class="text-[10px] text-slate-500 uppercase font-bold">Documentos</div>
                   <div class="text-2xl font-black text-white">{{ results.relatorio.totalNotas }} <span class="text-xs font-normal text-slate-400">NF-es</span></div>
                 </div>
                 <div class="space-y-1 text-right">
                   <div class="text-[10px] text-slate-500 uppercase font-bold">Valor Total Mercadorias</div>
                   <div class="text-2xl font-black text-brand-accent">R$ {{ results.relatorio.totalValorCompras }}</div>
                 </div>
              </div>
              <div class="p-4 bg-white/5 rounded-2xl flex items-center gap-3">
                 <AlertCircle class="w-5 h-5 text-amber-500" />
                 <span class="text-xs text-slate-300">Todas as linhas C100, C170 e C190 foram geradas e ajustadas conforme suas regras de custo.</span>
              </div>
           </div>

           <div class="bg-[#1e293b]/40 border border-white/5 rounded-3xl p-8 flex flex-col justify-center gap-6">
              <h3 class="text-sm font-black text-slate-500 uppercase tracking-widest text-center">Próximos Passos</h3>
              
              <button 
                @click="dowloadSpedFragment"
                class="w-full bg-[#334155] hover:bg-[#475569] text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95"
              >
                <Download class="w-5 h-5" /> Download Fragmento SPED
              </button>

              <button 
                v-if="spedBaseId"
                @click="router.push(`/analisador/${spedBaseId}`)"
                class="w-full bg-brand-accent hover:bg-brand-accent/90 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all shadow-xl shadow-brand-accent/20 active:scale-95"
              >
                <Database class="w-5 h-5" /> Abrir no Analisador Crítico
              </button>

              <button 
                @click="currentStep = 1; files = []; results = null;"
                class="w-full bg-white/5 hover:bg-white/10 text-slate-400 py-3 rounded-2xl text-xs font-bold transition-all"
              >
                Iniciar Novo Processo
              </button>
           </div>
        </div>
      </section>

    </main>

    <!-- Footer Stats -->
    <footer class="h-10 bg-[#0f172a] border-t border-white/5 flex items-center px-10 justify-between text-[10px] text-slate-500 font-bold uppercase tracking-widest">
       <div>
         Status do Analista: <span class="text-emerald-400">Online & Otimizado</span>
       </div>
       <div class="flex items-center gap-4">
         <span>Powered by Audisped Advanced</span>
         <div class="flex gap-1">
           <div class="w-1 h-1 bg-brand-accent rounded-full animate-ping"></div>
           <div class="w-1 h-1 bg-brand-accent rounded-full"></div>
           <div class="w-1 h-1 bg-brand-accent rounded-full"></div>
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
        class="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
      ></div>
      
      <div class="relative w-full max-w-2xl bg-[#1e293b] border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div class="p-6 border-b border-white/5 flex items-center justify-between">
          <h3 class="text-xl font-black text-white uppercase italic tracking-tighter">
            Gerenciar <span class="text-brand-accent">CFOPs</span>
          </h3>
          <button @click="showCfopManager = false" class="p-2 hover:bg-white/5 rounded-full text-slate-400 transition-colors">
            <X class="w-6 h-6" />
          </button>
        </div>

        <div class="p-6 space-y-6">
          <div class="bg-white/5 p-4 rounded-2xl border border-white/5 space-y-4">
            <h4 class="text-xs font-bold text-slate-400 uppercase tracking-widest">Adicionar Novo Código</h4>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input v-model="newCfop.codigo" type="text" placeholder="Cód. ex: 1403" class="bg-[#0f172a] border border-white/10 rounded-xl px-4 py-2 text-white font-mono text-sm outline-none focus:border-brand-accent" />
              <input v-model="newCfop.descricao" type="text" placeholder="Descrição..." class="bg-[#0f172a] border border-white/10 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-brand-accent" />
              <button @click="addCfop" class="bg-brand-accent hover:bg-brand-accent/90 text-white rounded-xl font-bold text-xs transition-all">ADICIONAR</button>
            </div>
          </div>

          <div class="max-h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            <div v-for="cf in registeredCfops" :key="cf.id" class="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-transparent hover:border-white/10 transition-all">
              <div class="flex items-center gap-3">
                <span class="text-brand-accent font-black font-mono">{{ cf.codigo }}</span>
                <span class="text-xs text-slate-300">{{ cf.descricao }}</span>
              </div>
              <button @click="removeCfop(cf.id)" class="text-slate-500 hover:text-red-400 p-1 transition-colors">
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.bg-brand-secondary {
  background-color: #6366f1; /* Indigo */
}

/* Animations provide that premium feel */
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-fade-in {
  animation: fade-in 0.5s ease-out;
}
</style>
