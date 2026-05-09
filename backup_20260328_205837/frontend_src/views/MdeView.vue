<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { token, empresaSelecionada } from '../store';
import { useRouter } from 'vue-router';
import { 
  Search, 
  FileText, 
  Key, 
  Download, 
  RefreshCw, 
  CheckCircle,
  Eye,
  Ban,
  ShoppingCart,
  Package,
  CheckCircle2 as CheckIcon,
  Trash2
} from 'lucide-vue-next';

const router = useRouter();
const notas = ref([]);
const isLoading = ref(false);
const isSyncing = ref(false);
const filterStatus = ref('todos');
const searchQuery = ref('');

const isXmlViewerOpen = ref(false);
const currentXml = ref('');

// Certificado vars
const isCertModalOpen = ref(false);
const certStatus = ref(null);
const pfxFile = ref(null);
const pfxSenha = ref('');
const pfxUltimoNsu = ref('0');
const pfxPeriodicidade = ref(0);
const isUploadingCert = ref(false);

const manualChave = ref('');
const isImportingManual = ref(false);

const dataInicioEspiao = ref('');
const dataFimEspiao = ref('');
const isEspiaoSyncing = ref(false);

const selectedNotas = ref([]);
const isDownloadingZip = ref(false);
const isItensModalOpen = ref(false);
const notaSelecionadaItens = ref(null);

function showItens(nota) {
  notaSelecionadaItens.value = nota;
  isItensModalOpen.value = true;
}
const conferenciaResult = ref(null);
const isConferindo = ref(false);
const chavesFaltantesParaBaixar = ref([]);

async function syncEspiao() {
  if (isEspiaoSyncing.value) return;
  if (!dataInicioEspiao.value || !dataFimEspiao.value) {
    alert('Selecione o período de início e fim.');
    return;
  }
  
  isEspiaoSyncing.value = true;
  try {
    const res = await axios.get(`${API_BASE_URL}/api/espiao/sync/${empresaSelecionada.value.id}`, {
      params: {
        inicio: dataInicioEspiao.value,
        fim: dataFimEspiao.value
      },
      headers: { Authorization: `Bearer ${token.value}` }
    });
    alert(res.data.message || 'Sincronização via Espião concluída!');
    await fetchNotas();
  } catch (err) {
    console.error('Erro ao sincronizar Espião:', err);
    alert(err.response?.data?.message || 'Erro ao sincronizar com o Espião NFe.');
  } finally {
    isEspiaoSyncing.value = false;
  }
}

async function importarPorChave() {
  if (manualChave.value.trim().length === 0) {
    alert('Insira ao menos uma chave de acesso.');
    return;
  }
  
  isImportingManual.value = true;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/mde/importar-chave`, {
      id_empresa: empresaSelecionada.value.id,
      chave: manualChave.value
    }, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    
    alert(res.data.mensagem || 'Processamento iniciado! As notas aparecerão na lista em breve.');
    manualChave.value = '';
    await fetchNotas();
  } catch (err) {
    console.error('Erro ao importar:', err);
    const msg = err.response?.data?.message || 'Erro ao processar chaves.';
    alert(msg);
  } finally {
    isImportingManual.value = false;
  }
}

async function downloadZip() {
  if (selectedNotas.value.length === 0) {
    alert('Selecione ao menos uma nota.');
    return;
  }

  isDownloadingZip.value = true;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/espiao/download-zip`, {
      id_empresa: empresaSelecionada.value.id,
      chaves: selectedNotas.value
    }, {
      responseType: 'blob',
      headers: { Authorization: `Bearer ${token.value}` }
    });
    
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `xmls_${empresaSelecionada.value.nome_fantasia}_${Date.now()}.zip`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    console.error('Erro ao baixar ZIP:', err);
    alert('Erro ao gerar arquivo ZIP.');
  } finally {
    isDownloadingZip.value = false;
  }
}

async function deleteSelectedNotas() {
  if (selectedNotas.value.length === 0) {
    alert('Selecione ao menos uma nota.');
    return;
  }

  if (!confirm(`Deseja realmente excluir ${selectedNotas.value.length} nota(s) selecionada(s)? Esta ação não pode ser desfeita.`)) {
    return;
  }

  try {
    const res = await axios.post(`${API_BASE_URL}/api/mde/delete-notas`, {
      id_empresa: empresaSelecionada.value.id,
      chaves: selectedNotas.value
    }, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    
    alert(res.data.message || 'Notas excluídas com sucesso!');
    selectedNotas.value = [];
    await fetchNotas();
  } catch (err) {
    console.error('Erro ao excluir notas:', err);
    alert(err.response?.data?.message || 'Erro ao excluir notas.');
  }
}

async function onSpedFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    const lines = text.split('\n');
    const chaves = [];
    
    // Regex simples para capturar chaves de 44 dígitos
    const regex = /[0-9]{44}/;
    
    lines.forEach(line => {
      // No Sped Fiscal, chaves costumam estar nos registros C100, C170, D100 etc.
      // Vamos pegar qualquer sequência de 44 números que pareça chave de NF-e
      const match = line.match(regex);
      if (match) {
        if (!chaves.includes(match[0])) chaves.push(match[0]);
      }
    });

    if (chaves.length === 0) {
      alert('Nenhuma chave de NF-e encontrada no arquivo Sped.');
      return;
    }

    isConferindo.value = true;
    isConferenciaModalOpen.value = true;
    
    try {
      const res = await axios.post(`${API_BASE_URL}/api/espiao/conferir-sped`, {
        id_empresa: empresaSelecionada.value.id,
        chaves: chaves
      }, {
        headers: { Authorization: `Bearer ${token.value}` }
      });
      
      conferenciaResult.value = res.data;
      chavesFaltantesParaBaixar.value = res.data.todas_faltantes;
    } catch (err) {
      console.error('Erro ao conferir Sped:', err);
      alert('Erro ao realizar conferência.');
      isConferenciaModalOpen.value = false;
    } finally {
      isConferindo.value = false;
    }
  };
  reader.readAsText(file);
}

async function baixarFaltantesSped() {
  if (chavesFaltantesParaBaixar.value.length === 0) return;
  
  if (!confirm(`Deseja solicitar a captura de ${chavesFaltantesParaBaixar.value.length} notas faltantes no EspiãoNFe?`)) return;

  try {
    await axios.post(`${API_BASE_URL}/api/espiao/importar-lote`, {
      id_empresa: empresaSelecionada.value.id,
      chaves: chavesFaltantesParaBaixar.value.join(',')
    }, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    
    alert('Solicitação enviada com sucesso! As notas serão baixadas em segundo plano.');
    isConferenciaModalOpen.value = false;
    fetchNotas();
  } catch (err) {
    alert('Erro ao solicitar download.');
  }
}

function toggleSelectAll(event) {
  if (event.target.checked) {
    selectedNotas.value = filteredNotas.value.map(n => n.chave_nfe);
  } else {
    selectedNotas.value = [];
  }
}

async function downloadSingleXml(chave) {
  try {
     const url = `${API_BASE_URL}/api/espiao/download-xml/${empresaSelecionada.value.id}/${chave}`;
     const res = await axios.get(url, {
       responseType: 'blob',
       headers: { Authorization: `Bearer ${token.value}` }
     });
     
     const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: 'text/xml' }));
     const link = document.createElement('a');
     link.href = blobUrl;
     link.setAttribute('download', `${chave}.xml`);
     document.body.appendChild(link);
     link.click();
     link.remove();
  } catch (err) {
    alert('XML ainda não disponível para este status ou erro no download.');
  }
}

async function viewXml(chave) {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/mde/xml/${chave}`, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    currentXml.value = res.data.xml;
    isXmlViewerOpen.value = true;
  } catch (err) {
    alert(err.response?.data?.message || 'Erro ao carregar XML.');
  }
}

  onMounted(() => {
  if (!empresaSelecionada.value) {
    router.push('/');
    return;
  }
  fetchNotas();
  checkCertStatus();
  
  // Datas padrão para o Espião (últimos 30 dias)
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);
  
  dataInicioEspiao.value = thirtyDaysAgo.toISOString().split('T')[0];
  dataFimEspiao.value = today.toISOString().split('T')[0];
});

async function fetchNotas() {
  if (!empresaSelecionada.value) return;
  isLoading.value = true;
  try {
    const res = await axios.get(`${API_BASE_URL}/api/mde/notas/${empresaSelecionada.value.id}`, {
      params: {
        inicio: dataInicioEspiao.value,
        fim: dataFimEspiao.value
      },
      headers: { Authorization: `Bearer ${token.value}` }
    });
    notas.value = res.data;
  } catch (err) {
    console.error('Erro ao buscar notas:', err);
  } finally {
    isLoading.value = false;
  }
}

// Watchers para recarregar automaticamente ao mudar datas ou empresa
watch([dataInicioEspiao, dataFimEspiao], () => {
  fetchNotas();
});


async function syncNotas() {
  if (isSyncing.value) return;
  isSyncing.value = true;
  try {
    const res = await axios.get(`${API_BASE_URL}/api/mde/sync/${empresaSelecionada.value.id}`, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    alert(res.data.message || 'Sincronização concluída!');
    await fetchNotas();
  } catch (err) {
    console.error('Erro ao sincronizar:', err);
    alert(err.response?.data?.error || err.response?.data?.message || 'Erro ao sincronizar com a SEFAZ. Verifique o certificado ou token.');
  } finally {
    isSyncing.value = false;
  }
}

async function manifestar(nota, evento) {
  const nomesManifestos = {
    'ciencia': 'Ciência da Operação',
    'confirmacao': 'Confirmação da Operação',
    'desconhecimento': 'Desconhecimento da Operação',
    'nao_realizada': 'Operação não Realizada'
  };
  const nomeDisplay = nomesManifestos[evento] || evento;
  
  if (!confirm(`Deseja realizar a manifestação de "${nomeDisplay}" para esta nota?`)) return;
  
  try {
    const res = await axios.post(`${API_BASE_URL}/api/mde/manifestar`, {
      id_empresa: empresaSelecionada.value.id,
      chave_nfe: nota.chave_nfe,
      evento: evento
    }, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    
    alert(res.data.mensagem || res.data.message || 'Manifestação realizada com sucesso!');
    await fetchNotas();
  } catch (err) {
    console.error('Erro ao manifestar:', err);
    const serverError = err.response?.data?.error || err.message;
    alert(`Erro ao realizar manifestação: ${serverError}`);
  }
}

const filteredNotas = computed(() => {
  return notas.value.filter(n => {
    const searchLower = searchQuery.value.toLowerCase();
    const matchesSearch = n.chave_nfe.includes(searchQuery.value) ||
                         (n.nome_emissor || '').toLowerCase().includes(searchLower) ||
                         (n.cnpj_emissor || '').includes(searchQuery.value);

    if (!matchesSearch) return false;

    if (filterStatus.value === 'todos') return true;
    if (filterStatus.value === 'pendente') return (!n.status_manifesto || n.status_manifesto === 'Identificada' || n.status_manifesto === 'Sem manifestação');
    return n.status_manifesto === filterStatus.value;
  });
});


function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) return '---';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('pt-BR');
}

function getStatusColor(status) {
  switch (status) {
    case 'Ciência da Operação': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Confirmação da Operação': return 'bg-green-100 text-green-700 border-green-200';
    case 'Desconhecimento da Operação': return 'bg-red-100 text-red-700 border-red-200';
    case 'Operação não Realizada': return 'bg-gray-100 text-gray-700 border-gray-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

async function checkCertStatus() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/mde/certificado/${empresaSelecionada.value.id}`, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    certStatus.value = res.data;
    if (res.data.configurado) {
        pfxUltimoNsu.value = res.data.ultimo_nsu || '0';
        pfxPeriodicidade.value = res.data.periodicidade || 0;
    }
  } catch (err) {
    console.error('Erro ao buscar status do certificado:', err);
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) pfxFile.value = file;
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result.split(',')[1]);
  reader.onerror = (error) => reject(error);
});

async function saveCertificado() {
  if (!pfxFile.value || !pfxSenha.value) {
    alert('Selecione o arquivo .pfx e informe a senha.');
    return;
  }

  isUploadingCert.value = true;
  try {
    const base64 = await fileToBase64(pfxFile.value);
    
    await axios.post(`${API_BASE_URL}/api/mde/certificado`, {
      id_empresa: empresaSelecionada.value.id,
      pfx_base64: base64,
      senha: pfxSenha.value,
      nsu: pfxUltimoNsu.value,
      periodicidade: pfxPeriodicidade.value
    }, {
      headers: { Authorization: `Bearer ${token.value}` }
    });
    
    alert('Certificado configurado com sucesso!');
    isCertModalOpen.value = false;
    pfxFile.value = null;
    pfxSenha.value = '';
    await checkCertStatus();
  } catch (err) {
    console.error('Erro ao salvar certificado:', err);
    alert(err.response?.data?.message || 'Erro ao configurar certificado.');
  } finally {
    isUploadingCert.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Search class="w-6 h-6 text-brand-accent" />
          Manifesto de Destinatário (MD-e)
        </h2>
        <p class="text-slate-500 text-sm mt-1">Gerencie as notas fiscais emitidas contra seu CNPJ diretamente da SEFAZ.</p>
      </div>
      
      <div class="flex items-center gap-3">
        <button 
          @click="isCertModalOpen = true"
          class="flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-lg font-semibold hover:bg-slate-50 transition-all shadow-sm"
        >
          <ShieldCheck v-if="certStatus?.ativo" class="w-4 h-4 text-green-500" />
          <AlertCircle v-else class="w-4 h-4 text-amber-500" />
          Certificado
        </button>

        <button 
          @click="syncNotas" 
          :disabled="isSyncing"
          class="flex items-center gap-2 px-4 py-2 bg-brand-accent text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-brand-accent/20"
        >
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': isSyncing }" />
          {{ isSyncing ? 'Sincronizando...' : 'Capturar Notas' }}
        </button>
      </div>
    </div>
    <!-- Importação Manual por Chave -->
    <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-indigo-50 rounded-lg">
            <Key class="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 class="font-bold text-slate-800">Importação em Lote / Chave</h3>
            <p class="text-xs text-slate-500">Cole uma ou várias chaves (uma por linha) para importar via EspiãoNFe.</p>
          </div>
        </div>
        
        <!-- Novo Botão de Sped -->
        <input type="file" ref="spedComparerFile" class="hidden" @change="onSpedFileSelected" />
        <button 
          @click="$refs.spedComparerFile.click()"
          class="px-4 py-2 border border-indigo-200 text-indigo-600 rounded-xl text-xs font-bold hover:bg-indigo-50 transition-all flex items-center gap-2"
        >
          <Filter class="w-4 h-4" />
          Conferir com Sped
        </button>
      </div>
      
      <div class="flex flex-col gap-3">
        <textarea 
          v-model="manualChave"
          placeholder="Cole aqui as chaves de acesso..."
          rows="3"
          class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-accent/20 outline-none transition-all resize-none font-mono"
        ></textarea>
        <button 
          @click="importarPorChave"
          :disabled="isImportingManual || manualChave.trim().length === 0"
          class="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-slate-200"
        >
          <Zap v-if="!isImportingManual" class="w-4 h-4 text-brand-accent" />
          <RefreshCw v-else class="w-4 h-4 animate-spin" />
          {{ isImportingManual ? 'Processando Lote...' : 'Importar Chaves (EspiãoNFe)' }}
        </button>
      </div>
    </div>
    
    <!-- Espião NFe Section -->
    <div class="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-2xl border border-slate-700 shadow-xl space-y-4 text-white">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-brand-accent/20 rounded-lg">
            <Zap class="w-5 h-5 text-brand-accent" />
          </div>
          <div>
            <h3 class="font-bold font-brand">Espião NFe - Captura Retroativa</h3>
            <p class="text-xs text-slate-400">Capture notas emitidas em períodos anteriores via API EspiãoNFe.</p>
          </div>
        </div>
        <div class="hidden md:block">
           <span class="px-2 py-1 bg-brand-accent/10 border border-brand-accent/20 text-brand-accent text-[10px] rounded uppercase font-bold tracking-widest">Premium Integrado</span>
        </div>
      </div>
      
      <div class="flex flex-col md:flex-row gap-4">
        <div class="flex-1 grid grid-cols-2 gap-3">
          <div class="relative">
            <label class="text-[10px] uppercase font-bold text-slate-400 mb-1 block ml-1">Data Início</label>
            <div class="relative">
              <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                v-model="dataInicioEspiao"
                type="date"
                class="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent transition-all"
                style="color-scheme: dark;"
              />
            </div>
          </div>
          <div class="relative">
            <label class="text-[10px] uppercase font-bold text-slate-400 mb-1 block ml-1">Data Fim</label>
            <div class="relative">
              <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                v-model="dataFimEspiao"
                type="date"
                class="w-full bg-slate-800 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent transition-all"
                style="color-scheme: dark;"
              />
            </div>
          </div>
        </div>
        <button 
          @click="syncEspiao"
          :disabled="isEspiaoSyncing || !dataInicioEspiao || !dataFimEspiao"
          class="md:self-end px-8 py-2.5 bg-brand-accent text-white rounded-xl font-bold hover:bg-blue-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-brand-accent/20"
        >
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': isEspiaoSyncing }" />
          {{ isEspiaoSyncing ? 'Capturando...' : 'Capturar via Espião' }}
        </button>
      </div>
    </div>


    <!-- Stats / Cards Rápidos (Opcional, mas dá o impacto "Premium") -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-1">Total de Notas</span>
        <div class="flex items-center justify-between">
          <span class="text-2xl font-bold text-slate-800">{{ filteredNotas.length }}</span>
          <FileText class="w-8 h-8 text-slate-200" />
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500">
        <span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-1">Ciência Efetuada</span>
        <div class="flex items-center justify-between">
          <span class="text-2xl font-bold text-blue-600">{{ filteredNotas.filter(n => n.status_manifesto === 'Ciência da Operação').length }}</span>
          <Clock class="w-8 h-8 text-blue-100" />
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-green-500">
        <span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-1">Confirmadas</span>
        <div class="flex items-center justify-between">
          <span class="text-2xl font-bold text-green-600">{{ filteredNotas.filter(n => n.status_manifesto === 'Confirmação da Operação').length }}</span>
          <CheckCircle2 class="w-8 h-8 text-green-100" />
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-amber-500">
        <span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold block mb-1">Pendentes</span>
        <div class="flex items-center justify-between">
          <span class="text-2xl font-bold text-amber-600">{{ filteredNotas.filter(n => !n.status_manifesto || n.status_manifesto === 'Identificada' || n.status_manifesto === 'Sem manifestação').length }}</span>
          <AlertCircle class="w-8 h-8 text-amber-100" />
        </div>
      </div>
    </div>

    <!-- Filtros e Busca -->
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input 
          v-model="searchQuery"
          type="text" 
          placeholder="Buscar por Chave, Emitente ou CNPJ..." 
          class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/20 transition-all"
        />
      </div>
      
      <div class="flex items-center gap-4">
        <!-- Botão Download Lote -->
        <div v-if="selectedNotas.length > 0" class="flex items-center gap-2">
          <button 
            @click="downloadZip"
            :disabled="isDownloadingZip"
            class="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-all flex items-center gap-2 shadow-sm"
          >
            <Download class="w-4 h-4" />
            Download XMLs ({{ selectedNotas.length }})
          </button>

          <button 
            @click="deleteSelectedNotas"
            class="px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition-all flex items-center gap-2 shadow-sm"
          >
            <Trash2 class="w-4 h-4" />
            Excluir ({{ selectedNotas.length }})
          </button>
        </div>

        <div class="flex items-center gap-2">
          <Filter class="w-4 h-4 text-slate-500" />
          <select 
            v-model="filterStatus"
            class="bg-slate-50 border border-slate-200 rounded-lg text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-brand-accent/20"
          >
            <option value="todos">Todos os Status</option>
            <option value="pendente">Pendentes</option>
            <option value="Ciência da Operação">Com Ciência</option>
            <option value="Confirmação da Operação">Confirmadas</option>
            <option value="Desconhecimento da Operação">Desconhecidas</option>
            <option value="Operação não Realizada">Não Realizadas</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Tabela -->
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div v-if="isLoading" class="p-10 text-center">
        <RefreshCw class="w-8 h-8 text-brand-accent animate-spin mx-auto mb-3" />
        <p class="text-slate-500">Carregando notas do banco...</p>
      </div>
      
      <div v-else-if="filteredNotas.length === 0" class="p-16 text-center">
        <div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileText class="w-8 h-8 text-slate-300" />
        </div>
        <h3 class="text-lg font-semibold text-slate-800">Nenhuma nota encontrada</h3>
        <p class="text-slate-500 max-w-xs mx-auto mt-1">Experimente sincronizar com a SEFAZ para capturar as notas emitidas recentemente.</p>
        <button @click="syncNotas" class="mt-6 text-brand-accent font-semibold hover:underline">Sincronizar Agora</button>
      </div>

      <table v-else class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-slate-50 border-b border-slate-200">
            <th class="px-4 py-4 w-10 text-center">
              <input type="checkbox" @change="toggleSelectAll" class="rounded border-slate-300 text-brand-accent focus:ring-brand-accent" />
            </th>
            <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Data Emissão</th>
            <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Nº / Série</th>
            <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Emitente</th>
            <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Valor</th>
            <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Status Manifesto</th>
            <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500 text-center">Ações</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="nota in filteredNotas" :key="nota.id" class="hover:bg-slate-50/50 transition-colors">
            <td class="px-4 py-4 text-center">
              <input type="checkbox" v-model="selectedNotas" :value="nota.chave_nfe" class="rounded border-slate-300 text-brand-accent focus:ring-brand-accent" />
            </td>
            <td class="px-6 py-4">
              <span class="text-sm font-medium text-slate-700">{{ formatDate(nota.data_emissao) }}</span>
            </td>
            <td class="px-6 py-4">
              <div class="flex flex-col">
                <span class="text-sm font-bold text-slate-700">{{ nota.numero_nfe || '---' }}</span>
                <span class="text-[10px] text-slate-400">SÉRIE: {{ nota.serie || '---' }}</span>
              </div>
            </td>
            <td class="px-6 py-4">
              <div class="flex flex-col">
                <span class="font-bold text-slate-700 truncate max-w-[200px]" :title="nota.nome_emissor">
                  {{ nota.nome_emissor || 'NÃO IDENTIFICADO' }}
                </span>
                <span class="text-[10px] text-slate-500 font-mono">{{ nota.cnpj_emissor }}</span>
              </div>
            </td>
            <td class="px-6 py-4">
              <span class="text-sm font-bold text-slate-900">
                {{ isNaN(parseFloat(nota.valor)) ? '---' : formatCurrency(nota.valor) }}
              </span>
            </td>
            <td class="px-6 py-4">
              <span 
                v-if="nota.status_manifesto && nota.status_manifesto !== 'Identificada' && nota.status_manifesto !== 'Sem manifestação'"
                class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border"
                :class="getStatusColor(nota.status_manifesto)"
              >
                {{ nota.status_manifesto.toUpperCase() }}
              </span>
              <span v-else class="text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                PENDENTE
              </span>
            </td>
            <td class="px-6 py-4">
              <div class="flex items-center justify-center gap-2">
                <!-- Notas de Saída não podem ser manifestadas -->
                <template v-if="nota.tipo_operacao === 'Saída'">
                  <span class="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200" title="Notas emitidas por você não podem ser manifestadas">
                    EMITIDA
                  </span>
                </template>

                <template v-else>
                <!-- Se não tiver manifesto, mostra botão de Dar Ciência -->
                <button
                  v-if="!nota.status_manifesto || nota.status_manifesto === 'Identificada' || nota.status_manifesto === 'Sem manifestação'"
                  @click="manifestar(nota, 'ciencia')"
                  class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                  title="Dar Ciência da Operação"
                >
                  <CheckCircle class="w-5 h-5" />
                </button>

                <!-- Se já teve ciência, pode Confirmar ou Desconhecer -->
                <template v-if="nota.status_manifesto === 'Ciência da Operação'">
                  <button
                    @click="manifestar(nota, 'confirmacao')"
                    class="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="Confirmar Operação"
                  >
                    <CheckIcon class="w-5 h-5" />
                  </button>
                  <button
                    @click="manifestar(nota, 'desconhecimento')"
                    class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Desconhecer Operação"
                  >
                    <Ban class="w-5 h-5" />
                  </button>
                  <button
                    @click="manifestar(nota, 'nao_realizada')"
                    class="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                    title="Operação não Realizada"
                  >
                    <Ban class="w-5 h-5" />
                  </button>
                </template>
                </template><!-- fim v-else Entrada -->

                <button
                  v-if="(nota.status_manifesto === 'Confirmação da Operação' || nota.status_manifesto === 'Ciência da Operação') && nota.xml_content"
                  @click="downloadSingleXml(nota.chave_nfe)"
                  class="p-2 text-slate-400 hover:text-brand-accent hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                  title="Baixar XML"
                >
                  <Download class="w-5 h-5" />
                </button>

                <button 
                  v-if="nota.itens_json"
                  @click="showItens(nota)"
                  class="p-2 text-brand-accent hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                  title="Ver Itens/Produtos"
                >
                  <ShoppingCart class="w-5 h-5" />
                </button>

                <div class="group relative">
                   <button 
                     @click="viewXml(nota.chave_nfe)"
                     class="p-2 text-slate-400 hover:text-slate-600"
                   >
                     <Eye class="w-5 h-5" />
                   </button>
                   <!-- Popover Chave -->
                   <div class="absolute right-full mr-2 top-0 hidden group-hover:block bg-slate-800 text-white text-[10px] p-2 rounded shadow-xl whitespace-nowrap z-50">
                     CHAVE: {{ nota.chave_nfe }}
                   </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Paginação (Placeholder) -->
    <div v-if="filteredNotas.length > 0" class="flex items-center justify-between text-sm text-slate-500 px-2">
      <span>Mostrando {{ filteredNotas.length }} nota(s)</span>
      <div class="flex items-center gap-2">
        <button class="p-2 border border-slate-200 rounded-lg hover:bg-white transition-colors disabled:opacity-30" disabled>
          <ChevronLeft class="w-4 h-4" />
        </button>
        <button class="p-2 border border-slate-200 rounded-lg hover:bg-white transition-colors disabled:opacity-30" disabled>
          <ChevronRight class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>

  <!-- Modal Certificado -->
    <div v-if="isCertModalOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-white/20 animate-in fade-in zoom-in duration-200">
        <div class="p-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-brand-accent/10 rounded-xl flex items-center justify-center">
              <Key class="w-5 h-5 text-brand-accent" />
            </div>
            <div>
              <h3 class="font-bold text-slate-800">Certificado Digital</h3>
              <p class="text-xs text-slate-500">Configuração para MD-e (.pfx / A1)</p>
            </div>
          </div>
          <button @click="isCertModalOpen = false" class="text-slate-400 hover:text-slate-600">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="p-6 space-y-4">
          <!-- Status Atual -->
          <div v-if="certStatus" class="p-3 rounded-lg border flex items-center gap-3" :class="certStatus.ativo ? 'bg-green-50 border-green-100' : 'bg-slate-50 border-slate-200'">
            <ShieldCheck v-if="certStatus.ativo" class="w-5 h-5 text-green-500" />
            <AlertCircle v-else class="w-5 h-5 text-slate-400" />
            <div class="flex-1">
              <p class="text-xs font-bold" :class="certStatus.ativo ? 'text-green-700' : 'text-slate-700'">
                {{ certStatus.ativo ? 'CERTIFICADO ATIVO' : 'CERTIFICADO NÃO CONFIGURADO' }}
              </p>
              <p v-if="certStatus.ativo" class="text-[10px] text-green-600">Válido até: {{ formatDate(certStatus.validade) }}</p>
            </div>
          </div>

          <div class="space-y-2">
            <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Arquivo do Certificado (.pfx)</label>
            <input 
              type="file" 
              accept=".pfx"
              @change="handleFileSelect"
              class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm block"
            />
          </div>

          <div class="space-y-2">
            <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Senha do Certificado</label>
            <input 
              v-model="pfxSenha"
              type="password" 
              placeholder="Digite a senha do arquivo"
              class="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-brand-accent"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Último NSU Consultado</label>
              <input 
                v-model="pfxUltimoNsu"
                type="text" 
                placeholder="Ex: 0"
                class="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-brand-accent"
              />
            </div>
            <div class="space-y-2">
              <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Periodicidade (Horas)</label>
              <input 
                v-model="pfxPeriodicidade"
                type="number" 
                placeholder="Ex: 12"
                class="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-brand-accent"
              />
            </div>
          </div>

          <div class="bg-amber-50 border border-amber-100 p-3 rounded-lg flex gap-2">
            <AlertCircle class="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p class="text-[10px] text-amber-700 leading-normal">
              O certificado é armazenado de forma segura e utilizado apenas para consultas à SEFAZ. Use o padrão A1 em formato .pfx.
            </p>
          </div>
        </div>

        <div class="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button 
            @click="isCertModalOpen = false"
            class="flex-1 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-lg font-bold hover:bg-slate-100 transition-all"
          >
            Cancelar
          </button>
          <button 
            @click="saveCertificado"
            :disabled="isUploadingCert"
            class="flex-1 py-2.5 bg-brand-accent text-white rounded-lg font-bold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <RefreshCw v-if="isUploadingCert" class="w-4 h-4 animate-spin" />
            {{ isUploadingCert ? 'Salvando...' : 'Salvar Certificado' }}
          </button>
        </div>
      </div>
    </div>
    <!-- Modal Conferência Sped -->
    <div v-if="isConferenciaModalOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div class="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden border border-white/20 animate-in fade-in zoom-in duration-200">
        <div class="p-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Filter class="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h3 class="font-bold text-slate-800">Resultado da Conferência Sped</h3>
              <p class="text-xs text-slate-500">Comparação entre chaves do arquivo e banco de dados.</p>
            </div>
          </div>
          <button @click="isConferenciaModalOpen = false" class="text-slate-400 hover:text-slate-600">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="p-6">
          <div v-if="isConferindo" class="py-10 text-center">
            <RefreshCw class="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
            <p class="text-slate-500">Cruzando dados...</p>
          </div>
          
          <div v-else-if="conferenciaResult" class="space-y-6">
            <div class="grid grid-cols-3 gap-4">
              <div class="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <span class="text-[10px] uppercase font-bold text-slate-500 block mb-1">No Arquivo</span>
                <span class="text-2xl font-bold text-slate-800">{{ conferenciaResult.total_arquivo }}</span>
              </div>
              <div class="bg-green-50 p-4 rounded-xl border border-green-100">
                <span class="text-[10px] uppercase font-bold text-green-600 block mb-1">Encontradas</span>
                <span class="text-2xl font-bold text-green-700">{{ conferenciaResult.encontradas }}</span>
              </div>
              <div class="bg-red-50 p-4 rounded-xl border border-red-100">
                <span class="text-[10px] uppercase font-bold text-red-600 block mb-1">Faltantes</span>
                <span class="text-2xl font-bold text-red-700">{{ conferenciaResult.faltantes }}</span>
              </div>
            </div>

            <div v-if="chavesFaltantesParaBaixar.length > 0" class="space-y-3">
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-bold text-slate-700 uppercase tracking-wider">Chaves Faltantes (Apenas 1ªs 10)</h4>
                <span class="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">AÇÃO NECESSÁRIA</span>
              </div>
              
              <div class="max-h-40 overflow-y-auto border border-slate-100 rounded-lg bg-slate-50 p-2 font-mono text-[10px] space-y-1">
                <div v-for="chave in chavesFaltantesParaBaixar.slice(0, 10)" :key="chave" class="py-1 border-b border-slate-200 last:border-0">
                  {{ chave }}
                </div>
                <div v-if="chavesFaltantesParaBaixar.length > 10" class="text-slate-400 italic py-2">
                  ... e mais {{ chavesFaltantesParaBaixar.length - 10 }} chaves.
                </div>
              </div>

              <button 
                @click="baixarFaltantesSped"
                class="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
              >
                <Zap class="w-4 h-4" />
                Solicitar Captura de Faltantes via EspiãoNFe
              </button>
            </div>
            
            <div v-else class="py-6 text-center bg-green-50 rounded-xl border border-green-100">
              <CheckCircle2 class="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p class="font-bold text-green-700">Tudo em dia!</p>
              <p class="text-xs text-green-600">Todas as chaves do arquivo já constam no banco de dados.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  <!-- Modal Visualizador de XML -->
  <div v-if="isXmlViewerOpen" class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
    <div class="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl overflow-hidden border border-white/20 flex flex-col animate-in fade-in zoom-in duration-200">
      <div class="p-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-brand-accent/10 rounded-xl flex items-center justify-center">
            <FileText class="w-5 h-5 text-brand-accent" />
          </div>
          <div>
            <h3 class="font-bold text-slate-800">Visualizador de XML</h3>
            <p class="text-xs text-slate-500">Conteúdo bruto da nota fiscal</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
           <button 
             @click="isXmlViewerOpen = false"
             class="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
           >
             <X class="w-5 h-5" />
           </button>
        </div>
      </div>

      <div class="p-4 overflow-auto flex-1 bg-slate-950">
        <pre class="text-[12px] text-brand-accent font-mono leading-relaxed p-4 whitespace-pre-wrap">{{ currentXml }}</pre>
      </div>

      <div class="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
        <button 
          @click="isXmlViewerOpen = false"
          class="px-6 py-2 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 transition-all shadow-lg"
        >
          Fechar Visualizador
        </button>
      </div>
    </div>
  </div>

  <!-- Modal de Itens -->
  <div v-if="isItensModalOpen" class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
    <div class="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl overflow-hidden border border-white/20 flex flex-col animate-in fade-in zoom-in duration-200">
      <div class="p-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-brand-accent/10 rounded-xl flex items-center justify-center">
            <ShoppingCart class="w-5 h-5 text-brand-accent" />
          </div>
          <div>
            <h3 class="font-bold text-slate-800">Itens / Produtos da Nota</h3>
            <p class="text-xs text-slate-500">NF: {{ notaSelecionadaItens?.numero_nfe }} | Chave: {{ notaSelecionadaItens?.chave_nfe }}</p>
          </div>
        </div>
        <button @click="isItensModalOpen = false" class="text-slate-400 hover:text-slate-600">
          <XCircle class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 overflow-auto p-0">
        <table v-if="notaSelecionadaItens?.itens_json?.length" class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Produto</th>
              <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Qtd</th>
              <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Un</th>
              <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">V. Unit</th>
              <th class="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500 text-right">Total Item</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="(item, idx) in notaSelecionadaItens.itens_json" :key="idx" class="hover:bg-slate-50/50 transition-colors">
              <td class="px-6 py-4">
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-slate-700">{{ item.prod }}</span>
                  <span class="text-[10px] text-slate-500 font-mono">CFOP: {{ item.cfop }} | NCM: {{ item.ncm }}</span>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-slate-700">{{ item.qCom }}</td>
              <td class="px-6 py-4 text-sm text-slate-500 font-bold">{{ item.uCom }}</td>
              <td class="px-6 py-4 text-sm text-slate-700">{{ formatCurrency(item.vUnCom) }}</td>
              <td class="px-6 py-4 text-sm font-bold text-slate-900 text-right">{{ formatCurrency(item.vProd) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="p-16 text-center text-slate-400">
          <Package class="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Nenhum item encontrado no XML.</p>
        </div>
      </div>

      <div class="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <div class="text-sm text-slate-500 italic">
          * Dados extraídos diretamente do arquivo XML autorizado.
        </div>
        <button 
          @click="isItensModalOpen = false"
          class="px-6 py-2 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 transition-all"
        >
          Fechar
        </button>
      </div>
    </div>
  </div>
</template>


<style scoped>
/* Transições suaves */
tr {
  transition: all 0.2s;
}
</style>
