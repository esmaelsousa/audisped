<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios'
import { API_BASE_URL } from '../api';
import { useRouter } from 'vue-router';
import { token, empresaSelecionada } from '../store';
import { 
  Settings2, 
  UploadCloud, 
  X, 
  FileTerminal,
  Activity,
  HardDriveUpload,
  ChevronRight
} from 'lucide-vue-next';

const router = useRouter();

// Estado
const xmlFiles = ref([]);
const jsonResult = ref(null);
const isLoading = ref(false);
const logs = ref([]);
const spedFiles = ref([]);

// Filtros do Usuário
const cfopPadrao = ref('1102');
const forcarUsoConsumo = ref(true); // CST 040
const idSpedBase = ref('');

onMounted(async () => {
    // Se não tiver empresa, volta pra home. Segurança Hub-Spoke.
    if (!empresaSelecionada.value) {
        router.push('/');
        return;
    }
    
    try {
        const res = await axios.get(`${API_BASE_URL}/api/arquivos`, {
            headers: { Authorization: `Bearer ${token.value}` }
        });
        // Filtra só os arquivos da empresa selecionada (já deveria vir do backend filtrado idealmente, mas reforçamos)
        spedFiles.value = res.data.filter(arq => arq.cnpj_empresa === empresaSelecionada.value.cnpj || !arq.cnpj_empresa);
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

async function parseXmls() {
    if (xmlFiles.value.length === 0) return alert("Adicione ao menos um XML!");
    
    isLoading.value = true;
    logs.value = ["Inicializando motor de injeção de " + xmlFiles.value.length + " XML(s)..."];
    
    const formData = new FormData();
    xmlFiles.value.forEach(file => {
        formData.append('xmlFiles', file);
    });
    
    // Anexando Regras
    formData.append('cfop_padrao', cfopPadrao.value);
    formData.append('forcar_uso_consumo', forcarUsoConsumo.value);
    if (idSpedBase.value) {
        formData.append('id_sped_arquivo', idSpedBase.value);
    }
    
    try {
        logs.value.push("Enviando para Motor Extrator e Tributário...");
        const res = await axios.post(`${API_BASE_URL}/api/xml-injector/parse`, formData, {
            headers: { 
                'Content-Type': 'multipart/form-data',
                'Authorization': `Bearer ${token.value}`
            },
            responseType: 'blob'
        });
        
        let textResult;
        try {
            textResult = await res.data.text();
            if (res.data.type === 'application/json' || textResult.startsWith('{')) {
                 const parsed = JSON.parse(textResult);
                 jsonResult.value = parsed;
                 logs.value.push("Fase 1 e Fase 2 Concluídas em sandbox (memória).");
                 logs.value.push(parsed.message);
                 return;
            }
        } catch(e) {
            // ignorar
        }

        logs.value.push("[SUCCESS] Injeção Física concluída e Blocos revalidados.");
        
        const blob = new Blob([res.data]);
        const reader = new FileReader();
        reader.onloadend = () => {
            const a = document.createElement('a');
            a.href = reader.result;
            
            let filename = `SPED_${empresaSelecionada.value.cnpj}_INJETADO.txt`;
            const disposition = res.headers['content-disposition'];
            if (disposition && disposition.includes('filename=')) {
                filename = disposition.split('filename=')[1].replace(/["']/g, "");
            }
            
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
        reader.readAsDataURL(blob);

        logs.value.push(`Download liberado: ${filename}`);
        
    } catch (e) {
        console.error(e);
        logs.value.push("[ERROR] Falha de comunicação ou processamento no node.");
    } finally {
        isLoading.value = false;
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
        <div class="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-5">
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
                    <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CFOP (Conversão Automática)</label>
                    <div class="relative">
                        <select v-model="cfopPadrao" class="w-full bg-slate-50 border border-slate-200 text-sm text-slate-700 font-medium px-3 py-2.5 rounded-lg outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent appearance-none cursor-pointer">
                            <option value="1556">1.556 - Compra p/ Uso e Consumo</option>
                            <option value="1102">1.102 - Compra p/ Comercialização</option>
                            <option value="1652">1.652 - Compra de Combustível</option>
                        </select>
                        <ChevronRight class="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
                    </div>
                </div>

                <!-- Checkbox -->
                <div class="flex items-center mt-6">
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
            </div>
        </div>

        <!-- Área de Upload e Console -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[450px]">
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

                <!-- Fila de Arquivos -->
                <div class="flex-1 overflow-y-auto mb-4 border border-slate-100 rounded-lg bg-slate-50/50">
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
                <button 
                    @click="parseXmls" 
                    :disabled="xmlFiles.length === 0 || isLoading"
                    class="w-full bg-brand-accent hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm shadow-sm"
                >
                    <Activity v-if="isLoading" class="w-4 h-4 animate-spin" />
                    <span v-if="isLoading">Processando Injeção no Servidor...</span>
                    <span v-else>Injetar {{ xmlFiles.length }} NFe(s) no SPED</span>
                </button>
            </div>

            <!-- Coluna 2: Terminal -->
            <div class="bg-naval rounded-xl border border-slate-800 p-5 flex flex-col shadow-inner">
                <h2 class="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-4">
                    <FileTerminal class="w-4 h-4 text-slate-500" />
                    Log Operacional
                </h2>
                
                <div class="flex-1 overflow-y-auto font-mono text-[10px] text-green-400/90 space-y-1.5 custom-scrollbar-term leading-relaxed">
                    <div v-if="logs.length === 0" class="text-slate-600">
                        > Servidor aguardando lote de injeção...
                    </div>
                    <div v-for="(log, idx) in logs" :key="idx" class="whitespace-pre-wrap word-break">
                        <span class="text-slate-500 mr-2">></span>{{ log }}
                    </div>
                    <div v-if="jsonResult" class="mt-4 pt-4 border-t border-slate-800/50 text-blue-300/80">
                        <div class="mb-2 text-slate-400">> Relatório Tributário Detalhado:</div>
                        <pre class="bg-black/20 p-3 rounded-lg overflow-x-auto text-[10px]">{{ JSON.stringify(jsonResult.gerencial, null, 2) }}</pre>
                    </div>
                </div>
            </div>
        </div>
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

.custom-scrollbar-term::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.custom-scrollbar-term::-webkit-scrollbar-track {
  background: rgba(0,0,0,0.2); 
  border-radius: 4px;
}
.custom-scrollbar-term::-webkit-scrollbar-thumb {
  background: #334155; 
  border-radius: 4px;
}
</style>
