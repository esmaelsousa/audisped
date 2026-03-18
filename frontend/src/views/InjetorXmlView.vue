<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios'
import { API_BASE_URL } from '../api';
import { useRouter } from 'vue-router';
import { token, empresaSelecionada } from '../store';
import SpedPreview from '@/components/SpedPreview.vue';
import { 
  UploadCloud, 
  X, 
  Activity,
  HardDriveUpload,
  Download,
  TableProperties,
  CheckCircle2, 
  AlertTriangle, 
  Terminal, 
  ChevronDown,
  ChevronRight,
  Play,
  Eye,
  Sparkles,
  FileTerminal,
  Settings2,
  LayoutDashboard,
  ArrowLeft
} from 'lucide-vue-next';


const router = useRouter();

// Estado Principal
const xmlFiles = ref([]);
const jsonResult = ref(null);
const isLoading = ref(false);
const logs = ref([]);
const spedFiles = ref([]);

// Visão e Preview
const isDashboardView = ref(false);
const showPreview = ref(false);
const previewData = ref(null);

// Filtros do Usuário
const cfopPadrao = ref('1102');
const forcarUsoConsumo = ref(true); 
const idSpedBase = ref('');
const ajusteIpi = ref(false);
const ajusteIcms = ref(false);
const pularDuplicados = ref(true);

// De-Para e Análise
const detectedItems = ref([]);
const detectedNotes = ref([]);
const isAnalyzing = ref(false);
const isSavingMapping = ref(false);
const successInjectedId = ref(null);
const showItemsModal = ref(false);


onMounted(async () => {
    if (!empresaSelecionada.value) {
        router.push('/');
        return;
    }
    
    try {
        const res = await axios.get(`${API_BASE_URL}/api/arquivos/empresa/${empresaSelecionada.value.id}`, {
            headers: { Authorization: `Bearer ${token.value}` }
        });
        spedFiles.value = res.data;
    } catch(e) {
        console.error('Erro ao carregar SPEDs', e);
    }
});

function handleFileDrop(e) {
    const files = Array.from(e.target.files || e.dataTransfer.files).filter(f => f.name.endsWith('.xml'));
    if(files.length > 0) {
        xmlFiles.value = [...xmlFiles.value, ...files];
    }
}

function removeFile(index) {
    xmlFiles.value.splice(index, 1);
}

const triggerFileInput = () => document.getElementById('xml-upload').click();

async function parseXmls(forceReplace = false) {
    if (xmlFiles.value.length === 0) return alert("Adicione ao menos um XML!");
    
    isLoading.value = true;
    if (!forceReplace) logs.value = ["Inicializando motor de injeção de " + xmlFiles.value.length + " XML(s)..."];
    
    const formData = new FormData();
    xmlFiles.value.forEach(file => {
        formData.append('xmlFiles', file);
    });
    
    formData.append('cfop_padrao', cfopPadrao.value);
    formData.append('forcar_uso_consumo', forcarUsoConsumo.value);
    formData.append('ajuste_ipi', ajusteIpi.value);
    formData.append('ajuste_icms', ajusteIcms.value);
    formData.append('pular_duplicados', pularDuplicados.value);
    
    if (forceReplace) formData.append('forceReplace', 'true');

    if (detectedItems.value.length > 0) {
        formData.append('item_mapping', JSON.stringify(detectedItems.value));
    }

    if (idSpedBase.value) {
        formData.append('id_sped_arquivo', idSpedBase.value);
    }
    
    try {
        if (!forceReplace) logs.value.push("Enviando para Motor Extrator e Tributário...");
        else logs.value.push("Re-enviando forçando substituição de duplicadas...");
        
        const res = await axios.post(`${API_BASE_URL}/api/xml-injector/parse`, formData, {
            headers: { 
                'Content-Type': 'multipart/form-data',
                'Authorization': `Bearer ${token.value}`
            }
        });
        
        const data = res.data;
        if (data.detalhes) {
            successInjectedId.value = idSpedBase.value;
            logs.value.push('[SUCCESS] ' + data.message);
            logs.value.push(`→ SPED: ${data.detalhes.nome_arquivo}`);
            logs.value.push(`→ Período: ${data.detalhes.periodo}`);
            logs.value.push(`→ XMLs injetados: ${data.detalhes.total_xml_injetados}`);
            logs.value.push(`→ Total linhas no SPED agora: ${data.detalhes.total_linhas_sped}`);
            logs.value.push('[INFO] Arquivo salvo no disco.');
            
            if (isDashboardView.value) {
                alert("Injeção realizada com sucesso! Você já pode baixar o arquivo.");
            }
            
            xmlFiles.value = []; 
            jsonResult.value = null;
            detectedItems.value = [];
        } else if (data.gerencial) {
            jsonResult.value = data;
            logs.value.push('Fase 1 e Fase 2 Concluídas em sandbox (memória).');
        }
    } catch (e) {
        if (e.response && e.response.status === 409) {
            const data = e.response.data;
            const duplicadasStr = data.duplicadas.map(d => `Doc: ${d.num_doc} - Chave: ${d.chv_nfe}`).join('\n');
            const msg = `${data.message}\n\n${duplicadasStr}\n\nDeseja SUBSTITUIR as notas existentes pelas novas?`;
            
            if (confirm(msg)) return parseXmls(true);
            else logs.value.push(`[INFO] Injeção cancelada pelo usuário.`);
        } else {
            console.error(e);
            const errMsg = e.response?.data?.message || e.message || 'Erro na injeção.';
            logs.value.push(`[ERROR] ${errMsg}`);
        }
    } finally {
        isLoading.value = false;
    }
}

async function simularInjecao() {
    if (xmlFiles.value.length === 0) return alert("Adicione ao menos um XML para simulação!");
    
    isLoading.value = true;
    logs.value = ["Iniciando SIMULAÇÃO (Sandbox) de " + xmlFiles.value.length + " XML(s)..."];
    
    const formData = new FormData();
    xmlFiles.value.forEach(file => {
        formData.append('xmlFiles', file);
    });
    
    formData.append('cfop_padrao', cfopPadrao.value);
    formData.append('forcar_uso_consumo', forcarUsoConsumo.value);
    formData.append('ajuste_ipi', ajusteIpi.value);
    formData.append('ajuste_icms', ajusteIcms.value);
    formData.append('pular_duplicados', pularDuplicados.value);
    formData.append('analyzeOnly', 'true');
    
    if (detectedItems.value.length > 0) {
        formData.append('item_mapping', JSON.stringify(detectedItems.value));
    }

    try {
        logs.value.push("Processando dados em memória...");
        const res = await axios.post(`${API_BASE_URL}/api/xml-injector/parse`, formData, {
            headers: { 
                'Content-Type': 'multipart/form-data',
                'Authorization': `Bearer ${token.value}`
            }
        });
        
        if (res.data?.gerencial) {
            jsonResult.value = res.data;
            previewData.value = res.data.gerencial;
            logs.value.push('[SUCCESS] Simulação concluída.');
            
            if (!isDashboardView.value) showPreview.value = true;
        }
    } catch (e) {
        console.error(e);
        logs.value.push(`[ERROR] Falha na simulação: ${e.response?.data?.message || e.message}`);
    } finally {
        isLoading.value = false;
    }
}

function downloadResultSped() {
    if (!successInjectedId.value) return;
    const downloadUrl = `${API_BASE_URL}/api/exportar-sped/${successInjectedId.value}?token=${token.value}`;
    window.open(downloadUrl, '_blank');
}

async function standaloneExport() {
    if (xmlFiles.value.length === 0) return alert("Adicione ao menos um XML!");
    
    isLoading.value = true;
    logs.value = ["Inicializando EJEÇÃO STANDALONE de " + xmlFiles.value.length + " XML(s)..."];
    
    const formData = new FormData();
    xmlFiles.value.forEach(file => formData.append('xmlFiles', file));
    
    formData.append('cfop_padrao', cfopPadrao.value);
    formData.append('forcar_uso_consumo', forcarUsoConsumo.value);
    formData.append('ajuste_ipi', ajusteIpi.value);
    formData.append('ajuste_icms', ajusteIcms.value);
    formData.append('pular_duplicados', pularDuplicados.value);

    if (detectedItems.value.length > 0) {
        formData.append('item_mapping', JSON.stringify(detectedItems.value));
    }
    
    try {
        const res = await axios.post(`${API_BASE_URL}/api/xml-injector/standalone`, formData, {
            headers: { 
                'Content-Type': 'multipart/form-data', 
                'Authorization': `Bearer ${token.value}`
            },
            responseType: 'blob' 
        });
        
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `sped_standalone_${new Date().toISOString().split('T')[0]}.txt`);
        link.click();
        logs.value.push('[SUCCESS] SPED Standalone baixado!');
    } catch (e) {
        console.error(e);
        logs.value.push(`[ERROR] Falha na ejeção standalone.`);
    } finally {
        isLoading.value = false;
    }
}

async function analyzeItems() {
    if (xmlFiles.value.length === 0) return alert("Adicione XMLs para análise!");
    
    isAnalyzing.value = true;
    const formData = new FormData();
    if (empresaSelecionada.value) {
        formData.append('id_empresa', empresaSelecionada.value.id);
    }
    formData.append('cfop_padrao', cfopPadrao.value);
    xmlFiles.value.forEach(file => formData.append('xmlFiles', file));

    try {
        const res = await axios.post(`${API_BASE_URL}/api/xml-injector/analyze-items`, formData, {
            headers: { 
                'Content-Type': 'multipart/form-data',
                'Authorization': `Bearer ${token.value}`
            }
        });
        
        detectedNotes.value = res.data.notas || [];
        detectedItems.value = (res.data.itens || []).map(it => ({
            cnpj_emissor: it.cnpj_fornecedor,
            nome_fornecedor: it.nome_fornecedor,
            codigo: it.cod_produto_xml,
            descricao: it.descricao_produto,
            ncm: it.ncm,
            cfop_alvo: it.cfop_atual, // O backend já utiliza o cfop_padrao enviado como userCfop
            cst_alvo: it.cst_atual || '000',
            conta_contabil: it.conta_contabil || '',
            isMapped: it.isMapped,
            cod_interno: it.cod_interno || it.cod_item_sugerido || '',
            cod_item_sugerido: it.cod_item_sugerido,
            numero_nota: it.numero_nota,
            data_nota: it.data_nota
        }));
        showItemsModal.value = true;
    } catch (e) {
        console.error(e);
        alert("Erro ao analisar itens.");
    } finally {
        isAnalyzing.value = false;
    }
}

const applyDefaultCfopToAll = () => {
    detectedItems.value.forEach(item => {
        item.cfop_alvo = cfopPadrao.value;
    });
    logs.value.push(`> Aplicado CFOP padrão (${cfopPadrao.value}) em todos os ${detectedItems.value.length} itens da lista.`);
};

async function saveBatchDePara(silent = false) {
    if (detectedItems.value.length === 0) return;
    isSavingMapping.value = true;
    try {
        const mapeamentos = detectedItems.value.map(it => ({
            id_empresa: empresaSelecionada.value.id,
            cnpj_emissor: it.cnpj_emissor, 
            cod_produto_xml: it.codigo,
            novo_cfop: it.cfop_alvo,
            novo_cst: it.cst_alvo || '000',
            descricao_produto: it.descricao,
            ncm: it.ncm,
            cod_interno: it.cod_interno,
            conta_contabil: it.conta_contabil
        }));

        await axios.post(`${API_BASE_URL}/api/xml-injector/save-de-para-batch`, { mapeamentos }, {
            headers: { Authorization: `Bearer ${token.value}` }
        });

        if (!silent) alert("Mapeamentos salvos com sucesso!");
    } catch (e) {
        console.error(e);
        if (!silent) alert("Erro ao salvar mapeamentos.");
    } finally {
        isSavingMapping.value = false;
    }
}

async function prepararPainel() {
    try {
        await analyzeItems();
        await simularInjecao();
        isDashboardView.value = true;
    } catch (e) {
        console.error(e);
    }
}
</script>

<template>
    <div v-if="empresaSelecionada" class="max-w-6xl w-full mx-auto flex flex-col gap-6 animate-fade-in">
        
        <!-- Breadcrumb e Título -->
        <div class="flex flex-col gap-1 border-b border-slate-200 pb-6">
            <div class="flex items-center gap-2 text-sm text-slate-500 font-medium mb-1">
                <span>Clientes</span>
                <ChevronRight class="w-4 h-4 text-slate-300" />
                <RouterLink :to="`/dashboard/${empresaSelecionada.id}`" class="hover:text-brand-accent transition-colors">
                    {{ empresaSelecionada.nome_empresa }}
                </RouterLink>
                <ChevronRight class="w-4 h-4 text-slate-300" />
                <span class="text-slate-900">Injetor de Notas (XML)</span>
            </div>
            <h1 class="text-3xl font-semibold text-slate-900 tracking-tight">Motor de Injeção XML</h1>
            <p class="text-slate-500 text-sm">Force a reconstrução do arquivo SPED inserindo notas fiscais omitidas retroativamente.</p>
        </div>

        <!-- Regras Fiscais Corporativas -->
        <div class="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-5 shadow-sm">
            <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Settings2 class="w-4 h-4 text-slate-400" />
                Parâmetros Fiscais da Injeção
            </h2>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- SPED Alvo -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Base do SPED (Alvo)</label>
                    <div class="relative">
                        <select v-model="idSpedBase" class="w-full bg-slate-50 border border-slate-200 text-sm text-slate-700 font-medium px-3 py-2.5 rounded-lg outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent appearance-none cursor-pointer">
                            <option value="">Apenas testar tabelas (Simulação)</option>
                            <option v-for="arq in spedFiles" :key="arq.id" :value="arq.id">
                                SPED: {{ arq.periodo_apuracao }}
                            </option>
                        </select>
                        <ChevronRight class="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
                    </div>
                </div>

                <!-- CFOP Padrão -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CFOP Padrão de Entrada</label>
                    <div class="relative">
                        <select v-model="cfopPadrao" class="w-full bg-slate-50 border border-slate-200 text-sm text-slate-700 font-medium px-3 py-2.5 rounded-lg outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent appearance-none cursor-pointer">
                            <option value="1102">1.102 - Compra p/ Comercialização</option>
                            <option value="1556">1.556 - Compra p/ Uso e Consumo</option>
                            <option value="1652">1.652 - Compra de Combustível</option>
                            <option value="1551">1.551 - Compra de Ativo Imobilizado</option>
                        </select>
                        <ChevronRight class="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
                    </div>
                </div>

                <!-- Checkboxes -->
                <div class="flex flex-col gap-4 mt-2">
                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="forcarUsoConsumo" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-slate-300 rounded peer-checked:bg-brand-accent peer-checked:border-brand-accent transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-slate-800 leading-tight">Zerar ICMS (Desoneração)</span>
                                <span class="text-[10px] text-slate-500">Forçar CST 040 e zerar BC (CFOP 1556)</span>
                            </div>
                        </label>
                    </div>

                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="ajusteIpi" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-slate-300 rounded peer-checked:bg-brand-accent peer-checked:border-brand-accent transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-slate-800 leading-tight">Ajustar IPI (Custo)</span>
                                <span class="text-[10px] text-slate-500">Somar IPI ao valor do item e zerar imposto</span>
                            </div>
                        </label>
                    </div>

                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="ajusteIcms" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-slate-300 rounded peer-checked:bg-brand-accent peer-checked:border-brand-accent transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-slate-800 leading-tight">Ajustar ICMS (Custo)</span>
                                <span class="text-[10px] text-slate-500">Somar ICMS ao valor do item e zerar imposto</span>
                            </div>
                        </label>
                    </div>

                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="pularDuplicados" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-slate-300 rounded peer-checked:bg-brand-accent peer-checked:border-brand-accent transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-slate-800 leading-tight">Pular Chaves Duplicadas</span>
                                <span class="text-[10px] text-slate-500">Ignorar notas que já foram injetadas neste SPED</span>
                            </div>
                        </label>
                    </div>
                </div>
            </div>
        </div>

        <!-- Área de Upload e Console -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[500px]">
            <!-- Coluna 1: Upload de XML -->
            <div class="bg-white rounded-xl border border-slate-200 p-5 flex flex-col flex-1 shadow-sm">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                        <UploadCloud class="w-4 h-4 text-slate-400" />
                        Notas Fiscais (NFe)
                    </h2>
                    
                    <button v-if="xmlFiles.length > 0" @click="xmlFiles = []" class="text-[10px] uppercase font-bold tracking-wider text-red-500 hover:text-red-700 transition-colors">
                        Limpar Fila
                    </button>
                </div>

                <!-- Drag & Drop B2B style -->
                <input type="file" id="xml-upload" class="hidden" multiple accept=".xml" @change="handleFileDrop" />
                <div 
                    @click="triggerFileInput"
                    @dragover.prevent
                    @drop.prevent="handleFileDrop"
                    class="border border-dashed border-slate-300 rounded-lg bg-slate-50 hover:bg-slate-100 hover:border-slate-400 transition-colors flex flex-col items-center justify-center gap-2 py-6 cursor-pointer mb-3 relative overflow-hidden group"
                >
                    <HardDriveUpload class="w-6 h-6 text-slate-400 group-hover:text-brand-accent transition-colors" />
                    <p class="text-slate-600 text-xs font-semibold">Arraste os arquivos XML ou clique para buscar</p>
                </div>

                <div class="flex items-center gap-2 mb-3">
                    <button 
                        @click="analyzeItems"
                        :disabled="xmlFiles.length === 0 || isAnalyzing"
                        class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold uppercase tracking-wider py-2 rounded-lg transition-colors flex items-center justify-center gap-2 border border-slate-200"
                    >
                        <TableProperties class="w-3.5 h-3.5" />
                        {{ isAnalyzing ? 'Analisando...' : 'De-Para em Lote (Itens)' }}
                    </button>
                    <div v-if="detectedItems.length > 0" class="bg-emerald-100 text-emerald-700 text-[9px] px-2 py-1 rounded font-bold">
                        {{ detectedItems.length }} ITENS MAPEADOS
                    </div>
                </div>

                <!-- Fila de Arquivos -->
                <div class="flex-1 overflow-y-auto mb-4 border border-slate-100 rounded-lg bg-slate-50/50 p-2">
                    <div v-if="xmlFiles.length === 0" class="h-full flex items-center justify-center text-xs text-slate-400 font-medium">
                        Nenhuma nota inserida na fila.
                    </div>
                    <ul v-else class="divide-y divide-slate-100">
                        <li v-for="(file, index) in xmlFiles" :key="index" class="flex items-center justify-between px-3 py-2 hover:bg-white group transition-colors">
                            <span class="text-xs text-slate-600 font-mono truncate mr-2" :title="file.name">
                                {{ file.name }}
                            </span>
                            <button @click.stop="removeFile(index)" class="text-slate-300 hover:text-red-500 transition-colors" title="Remover da fila">
                                <X class="w-3.5 h-3.5" />
                            </button>
                        </li>
                    </ul>
                </div>
                
                <!-- Action CTA -->
                <div class="flex flex-col gap-3">
                    <div class="flex gap-2">
                        <button 
                            @click="simularInjecao" 
                            :disabled="xmlFiles.length === 0 || isLoading"
                            class="flex-1 bg-white border border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-sm"
                        >
                            <Eye v-if="!isLoading" class="w-4 h-4" />
                            <span>{{ isLoading ? 'Aguarde...' : 'Gerar Prévia' }}</span>
                        </button>

                        <button 
                            @click="parseXmls" 
                            :disabled="xmlFiles.length === 0 || isLoading || !idSpedBase"
                            class="flex-[2] bg-brand-accent hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm shadow-sm"
                        >
                            <Activity v-if="isLoading" class="w-4 h-4 animate-spin" />
                            <span v-if="isLoading">Processando...</span>
                            <span v-else>Injetar no SPED</span>
                        </button>
                    </div>

                    <button 
                        @click="standaloneExport" 
                        :disabled="xmlFiles.length === 0 || isLoading"
                        class="w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm shadow-sm"
                    >
                        <Download v-if="!isLoading" class="w-4 h-4" />
                        <Activity v-else class="w-4 h-4 animate-spin" />
                        <span>Ejeção Standalone (Gerar SPED Novo)</span>
                    </button>

                    <button 
                        v-if="successInjectedId"
                        @click="downloadResultSped" 
                        class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-lg transition-all flex items-center justify-center gap-3 text-sm shadow-lg animate-bounce mt-2"
                    >
                        <Download class="w-5 h-5" />
                        <span>BAIXAR SPED RETIFICADO AGORA</span>
                    </button>
                </div>
            </div>

            <!-- Coluna 2: Terminal -->
            <div class="bg-slate-900 rounded-xl border border-slate-800 p-5 flex flex-col shadow-inner">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <FileTerminal class="w-4 h-4 text-slate-500" />
                        Log Operacional
                    </h2>
                    
                    <button 
                        v-if="jsonResult" 
                        @click="previewData = jsonResult; showPreview = true"
                        class="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider transition-colors animate-pulse"
                    >
                        Visualizar Preview
                    </button>
                </div>
                
                <div class="flex-1 overflow-y-auto font-mono text-[10px] text-green-400/90 space-y-1.5 custom-scrollbar-term leading-relaxed p-2">
                    <div v-if="logs.length === 0" class="text-slate-600">
                        > Servidor aguardando lote de injeção...
                    </div>
                    <div v-for="(log, idx) in logs" :key="idx" class="whitespace-pre-wrap word-break hover:bg-slate-800 transition-colors p-1 rounded">
                        <span class="text-slate-500 mr-2">[{{ new Date().toLocaleTimeString() }}]</span>
                        {{ log }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Modal de De-Para de Itens -->
        <div v-if="showItemsModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <div class="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl animate-pop-in">
                <div class="p-6 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-bold text-slate-900">Análise de XMLs e Itens</h3>
                        <p class="text-xs text-slate-500">Exibindo resumo das notas e mapeamento de itens detectados.</p>
                    </div>
                    <button @click="showItemsModal = false" class="text-slate-400 hover:text-slate-600">
                        <X class="w-6 h-6" />
                    </button>
                </div>
                
                <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
                    <!-- Resumo das Notas -->
                    <section>
                        <h4 class="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Resumo das Notas Fiscal ({{ detectedNotes.length }})</h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            <div v-for="nota in detectedNotes" :key="nota.numero" class="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-1">
                                <div class="flex justify-between items-start">
                                    <span class="text-sm font-bold text-slate-700">NF-e: {{ nota.numero }}</span>
                                    <span class="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono">{{ nota.data }}</span>
                                </div>
                                <div class="flex justify-between items-center text-xs">
                                    <span class="text-slate-500 truncate mr-2">{{ nota.arquivo }}</span>
                                    <span class="font-bold text-brand-accent">R$ {{ (Number(nota.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Mapeamento de Itens Detectados ({{ detectedItems.length }})</h4>
                            <button 
                                @click="applyDefaultCfopToAll"
                                class="text-[10px] bg-brand-accent/10 text-brand-accent hover:bg-brand-accent hover:text-white px-3 py-1 rounded font-bold transition-all flex items-center gap-1.5 border border-brand-accent/20"
                            >
                                <CheckCircle2 class="w-3 h-3" />
                                APLICAR CFOP PADRÃO ({{ cfopPadrao }}) EM TODOS
                            </button>
                        </div>
                        <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
                                <th class="pb-3 px-2">Código/Descrição</th>
                                <th class="pb-3 px-2 w-28">Nota/Data</th>
                                <th class="pb-3 px-2 w-32">NCM</th>
                                <th class="pb-3 px-2 w-32">Cód. Interno</th>
                                <th class="pb-3 px-2 w-40">CFOP Alvo</th>
                                <th class="pb-3 px-2">Conta Contábil</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-50">
                            <tr v-for="(item, idx) in detectedItems" :key="item.codigo + '_' + item.numero_nota + '_' + idx" class="text-sm">
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-1">
                                        <span class="font-mono text-[10px] text-slate-400">XML: {{ item.codigo }}</span>
                                        <input 
                                            v-model="item.descricao" 
                                            type="text" 
                                            class="w-full bg-slate-50 border border-slate-200 text-xs px-2 py-1 rounded-md focus:border-brand-accent outline-none font-medium" 
                                            placeholder="Descrição no SPED"
                                        />
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col text-[10px] text-slate-500 font-medium whitespace-nowrap">
                                        <span class="text-slate-900 font-bold">NF: {{ item.numero_nota }}</span>
                                        <span>{{ item.data_nota ? item.data_nota.replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1') : '-' }}</span>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <input 
                                        v-model="item.ncm" 
                                        type="text" 
                                        class="w-24 bg-slate-50 border border-slate-200 text-xs px-2 py-1 rounded-md focus:border-brand-accent outline-none text-slate-500 font-mono" 
                                        placeholder="NCM"
                                    />
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-1">
                                        <input 
                                            v-model="item.cod_interno" 
                                            type="text" 
                                            class="w-full bg-slate-50 border border-slate-200 text-xs px-2 py-1 rounded-md focus:border-brand-accent outline-none font-mono" 
                                            placeholder="Cód no SPED"
                                        />
                                        <button 
                                            v-if="item.cod_item_sugerido && item.cod_interno !== item.cod_item_sugerido"
                                            @click="item.cod_interno = item.cod_item_sugerido"
                                            class="text-[9px] text-brand-accent hover:underline text-left"
                                        >
                                            Sugerido: {{ item.cod_item_sugerido }}
                                        </button>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <select v-model="item.cfop_alvo" class="w-full bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-md focus:border-brand-accent outline-none">
                                        <option value="1102">1.102 (Comercializ.)</option>
                                        <option value="1556">1.556 (Consumo)</option>
                                        <option value="1652">1.652 (Combustível)</option>
                                        <option value="1551">1.551 (Ativo)</option>
                                    </select>
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.conta_contabil" type="text" placeholder="Ex: 1.01.01..." class="w-full bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-md focus:border-brand-accent outline-none" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </section>
            </div>

            <div class="p-6 border-t border-slate-100 flex justify-between items-center bg-slate-50 rounded-b-2x">
                    <p class="text-[11px] text-slate-400 italic">Os mapeamentos salvos serão aplicados automaticamente nas próximas injeções para o mesmo CNPJ Emissor + Código Produto.</p>
                    <div class="flex items-center gap-3">
                        <button 
                            @click="saveBatchDePara" 
                            :disabled="isSavingMapping"
                            class="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold py-2.5 px-6 rounded-lg transition-colors text-sm shadow-sm flex items-center gap-2"
                        >
                            <Activity v-if="isSavingMapping" class="w-4 h-4 animate-spin" />
                            Salvar de-para no Banco
                        </button>
                        <button @click="showItemsModal = false" class="bg-brand-accent hover:bg-blue-700 text-white font-bold py-2.5 px-8 rounded-lg transition-colors text-sm shadow-sm">
                            Utilizar nesta Injeção
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Modal de Preview -->
        <SpedPreview 
            v-if="showPreview && (jsonResult || previewData)"
            :show="true"
            :data="jsonResult || previewData"
            @close="showPreview = false; jsonResult = null; previewData = null"
        />
    </div>
</template>


<style scoped>
.animate-fade-in {
    animation: fadeIn 0.4s ease-out;
}

.animate-pop-in {
    animation: popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes popIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
}

.custom-scrollbar-term::-webkit-scrollbar {
    width: 4px;
}
.custom-scrollbar-term::-webkit-scrollbar-track {
    background: rgba(0,0,0,0.1);
}
.custom-scrollbar-term::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.1);
    border-radius: 10px;
}
.custom-scrollbar-term::-webkit-scrollbar-thumb:hover {
    background: rgba(255,255,255,0.2);
}

.word-break {
    word-break: break-all;
}
</style>
