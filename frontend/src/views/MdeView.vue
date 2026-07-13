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
import UiButton from '@/components/ui/UiButton.vue';

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
// Preview do certificado (validade + confere CNPJ da empresa) antes de salvar.
const certPreview = ref(null);
const certValidando = ref(false);
const fmtCnpj = (c) => c ? String(c).replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '—';
const podeSalvarCert = () => !!(certPreview.value && certPreview.value.confere && !certPreview.value.vencido && !certPreview.value.semCnpj);
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
    case 'Ciência da Operação': return 'bg-bronze/10 text-bronze border-bronze/20';
    case 'Confirmação da Operação': return 'bg-conforme/10 text-conforme border-conforme/25';
    case 'Desconhecimento da Operação': return 'bg-lacre/10 text-lacre border-lacre/25';
    case 'Operação não Realizada': return 'bg-variacao/10 text-variacao border-variacao/25';
    default: return 'bg-paper text-risco border-line';
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
  if (file) { pfxFile.value = file; validarCert(); }
}

// Dry-run: lê validade + CNPJ do certificado e confere com a empresa selecionada (sem salvar).
async function validarCert() {
  certPreview.value = null;
  if (!pfxFile.value || !pfxSenha.value || !empresaSelecionada.value?.id) return;
  certValidando.value = true;
  try {
    const base64 = await fileToBase64(pfxFile.value);
    const res = await axios.post(`${API_BASE_URL}/api/mde/certificado/validar`, {
      id_empresa: empresaSelecionada.value.id, pfx_base64: base64, senha: pfxSenha.value
    }, { headers: { Authorization: `Bearer ${token.value}` } });
    certPreview.value = res.data;
  } catch (err) {
    certPreview.value = { erro: err.response?.data?.message || 'Não foi possível ler o certificado.' };
  } finally {
    certValidando.value = false;
  }
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
    
    const { data } = await axios.post(`${API_BASE_URL}/api/mde/certificado`, {
      id_empresa: empresaSelecionada.value.id,
      pfx_base64: base64,
      senha: pfxSenha.value,
      nsu: pfxUltimoNsu.value,
      periodicidade: pfxPeriodicidade.value
    }, {
      headers: { Authorization: `Bearer ${token.value}` }
    });

    alert(data && data.aviso ? ('Certificado salvo. ' + data.aviso) : 'Certificado configurado com sucesso!');
    isCertModalOpen.value = false;
    pfxFile.value = null;
    pfxSenha.value = '';
    certPreview.value = null;
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
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-line pb-5">
      <div class="space-y-1">
        <h2 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">MDe</h2>
        <p class="text-[13px] text-risco max-w-lg">Manifesto de Destinatário — notas fiscais emitidas contra seu CNPJ direto da SEFAZ.</p>
      </div>

      <div class="flex items-center gap-2">
        <UiButton variant="ghost" @click="isCertModalOpen = true">
          <ShieldCheck v-if="certStatus?.ativo" class="w-4 h-4 text-conforme" :stroke-width="1.8" />
          <AlertCircle v-else class="w-4 h-4 text-variacao" :stroke-width="1.8" />
          Certificado
        </UiButton>

        <UiButton @click="syncNotas" :disabled="isSyncing" class="disabled:opacity-50">
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': isSyncing }" :stroke-width="1.8" />
          {{ isSyncing ? 'Sincronizando...' : 'Capturar Notas' }}
        </UiButton>
      </div>
    </div>
    <!-- Importação Manual por Chave -->
    <div class="bg-sheet p-5 rounded-md border border-line card-shadow space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-paper border border-line rounded-md">
            <Key class="w-5 h-5 text-bronze" :stroke-width="1.7" />
          </div>
          <div>
            <h3 class="font-display text-[15px] font-semibold text-ink">Importação em Lote / Chave</h3>
            <p class="text-[12px] text-risco">Cole uma ou várias chaves (uma por linha) para importar via EspiãoNFe.</p>
          </div>
        </div>

        <!-- Novo Botão de Sped -->
        <input type="file" ref="spedComparerFile" class="hidden" @change="onSpedFileSelected" />
        <UiButton variant="ghost" @click="$refs.spedComparerFile.click()">
          <Filter class="w-4 h-4 text-risco" :stroke-width="1.8" />
          Conferir com Sped
        </UiButton>
      </div>

      <div class="flex flex-col gap-3">
        <textarea
          v-model="manualChave"
          placeholder="Cole aqui as chaves de acesso..."
          rows="3"
          class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors resize-none"
        ></textarea>
        <UiButton
          @click="importarPorChave"
          :disabled="isImportingManual || manualChave.trim().length === 0"
          class="w-full justify-center py-[9px] disabled:opacity-50"
        >
          <Zap v-if="!isImportingManual" class="w-4 h-4" :stroke-width="1.8" />
          <RefreshCw v-else class="w-4 h-4 animate-spin" :stroke-width="1.8" />
          {{ isImportingManual ? 'Processando Lote...' : 'Importar Chaves (EspiãoNFe)' }}
        </UiButton>
      </div>
    </div>
    
    <!-- Espião NFe Section -->
    <div class="bg-sheet p-5 rounded-md border border-line card-shadow space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-paper border border-line rounded-md">
            <Zap class="w-5 h-5 text-bronze" :stroke-width="1.7" />
          </div>
          <div>
            <h3 class="font-display text-[15px] font-semibold text-ink">Espião NFe — Captura Retroativa</h3>
            <p class="text-[12px] text-risco">Capture notas emitidas em períodos anteriores via API EspiãoNFe.</p>
          </div>
        </div>
      </div>

      <div class="flex flex-col md:flex-row gap-4">
        <div class="flex-1 grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Data Início</label>
            <div class="relative">
              <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
              <input
                v-model="dataInicioEspiao"
                type="date"
                class="w-full bg-sheet border border-line rounded-md pl-9 pr-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
              />
            </div>
          </div>
          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Data Fim</label>
            <div class="relative">
              <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
              <input
                v-model="dataFimEspiao"
                type="date"
                class="w-full bg-sheet border border-line rounded-md pl-9 pr-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
              />
            </div>
          </div>
        </div>
        <UiButton
          @click="syncEspiao"
          :disabled="isEspiaoSyncing || !dataInicioEspiao || !dataFimEspiao"
          class="md:self-end justify-center py-[9px] px-6 disabled:opacity-50"
        >
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': isEspiaoSyncing }" :stroke-width="1.8" />
          {{ isEspiaoSyncing ? 'Capturando...' : 'Capturar via Espião' }}
        </UiButton>
      </div>
    </div>


    <!-- Cards Rápidos -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="bg-sheet p-4 rounded-md border border-line card-shadow">
        <span class="text-[11px] uppercase tracking-wide text-risco font-medium block mb-1">Total de Notas</span>
        <div class="flex items-center justify-between">
          <span class="font-mono text-[22px] font-semibold text-ink">{{ filteredNotas.length }}</span>
          <FileText class="w-7 h-7 text-line" :stroke-width="1.6" />
        </div>
      </div>
      <div class="bg-sheet p-4 rounded-md border border-line card-shadow border-l-2 border-l-bronze">
        <span class="text-[11px] uppercase tracking-wide text-risco font-medium block mb-1">Ciência Efetuada</span>
        <div class="flex items-center justify-between">
          <span class="font-mono text-[22px] font-semibold text-bronze">{{ filteredNotas.filter(n => n.status_manifesto === 'Ciência da Operação').length }}</span>
          <Clock class="w-7 h-7 text-bronze/30" :stroke-width="1.6" />
        </div>
      </div>
      <div class="bg-sheet p-4 rounded-md border border-line card-shadow border-l-2 border-l-conforme">
        <span class="text-[11px] uppercase tracking-wide text-risco font-medium block mb-1">Confirmadas</span>
        <div class="flex items-center justify-between">
          <span class="font-mono text-[22px] font-semibold text-conforme">{{ filteredNotas.filter(n => n.status_manifesto === 'Confirmação da Operação').length }}</span>
          <CheckCircle2 class="w-7 h-7 text-conforme/30" :stroke-width="1.6" />
        </div>
      </div>
      <div class="bg-sheet p-4 rounded-md border border-line card-shadow border-l-2 border-l-variacao">
        <span class="text-[11px] uppercase tracking-wide text-risco font-medium block mb-1">Pendentes</span>
        <div class="flex items-center justify-between">
          <span class="font-mono text-[22px] font-semibold text-variacao">{{ filteredNotas.filter(n => !n.status_manifesto || n.status_manifesto === 'Identificada' || n.status_manifesto === 'Sem manifestação').length }}</span>
          <AlertCircle class="w-7 h-7 text-variacao/30" :stroke-width="1.6" />
        </div>
      </div>
    </div>

    <!-- Filtros e Busca -->
    <div class="bg-sheet rounded-md border border-line card-shadow p-4 flex flex-col md:flex-row gap-4 items-center">
      <div class="relative flex-1 w-full">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Buscar por Chave, Emitente ou CNPJ..."
          class="w-full pl-9 pr-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors"
        />
      </div>

      <div class="flex items-center gap-3">
        <!-- Botão Download Lote -->
        <div v-if="selectedNotas.length > 0" class="flex items-center gap-2">
          <UiButton
            @click="downloadZip"
            :disabled="isDownloadingZip"
            class="disabled:opacity-50"
          >
            <Download class="w-4 h-4" :stroke-width="1.8" />
            Download XMLs ({{ selectedNotas.length }})
          </UiButton>

          <button
            @click="deleteSelectedNotas"
            class="inline-flex items-center gap-[7px] px-[13px] py-[7px] bg-lacre text-white rounded-md text-[13px] font-medium hover:opacity-85 transition-opacity"
          >
            <Trash2 class="w-4 h-4" :stroke-width="1.8" />
            Excluir ({{ selectedNotas.length }})
          </button>
        </div>

        <div class="flex items-center gap-2">
          <Filter class="w-4 h-4 text-risco" :stroke-width="1.8" />
          <select
            v-model="filterStatus"
            class="bg-sheet border border-line rounded-md text-[13px] text-ink px-3 py-2 outline-none focus:border-bronze transition-colors"
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
    <div class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
      <div v-if="isLoading" class="p-10 text-center">
        <RefreshCw class="w-7 h-7 text-bronze animate-spin mx-auto mb-3" :stroke-width="1.8" />
        <p class="text-[13px] text-risco">Carregando notas do banco...</p>
      </div>

      <div v-else-if="filteredNotas.length === 0" class="p-16 text-center">
        <div class="w-14 h-14 bg-paper border border-line rounded-md flex items-center justify-center mx-auto mb-4">
          <FileText class="w-7 h-7 text-line" :stroke-width="1.6" />
        </div>
        <h3 class="font-display text-[15px] font-semibold text-ink">Nenhuma nota encontrada</h3>
        <p class="text-[13px] text-risco max-w-xs mx-auto mt-1">Experimente sincronizar com a SEFAZ para capturar as notas emitidas recentemente.</p>
        <button @click="syncNotas" class="mt-5 text-[13px] text-bronze font-medium hover:opacity-80 transition-opacity">Sincronizar Agora</button>
      </div>

      <table v-else class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-paper border-b border-line">
            <th class="px-4 py-3 w-10 text-center">
              <input type="checkbox" @change="toggleSelectAll" class="rounded border-line text-bronze focus:ring-bronze" />
            </th>
            <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Data Emissão</th>
            <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Nº / Série</th>
            <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Emitente</th>
            <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Valor</th>
            <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Status Manifesto</th>
            <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="nota in filteredNotas" :key="nota.id" class="border-t border-line hover:bg-paper transition-colors">
            <td class="px-4 py-3.5 text-center">
              <input type="checkbox" v-model="selectedNotas" :value="nota.chave_nfe" class="rounded border-line text-bronze focus:ring-bronze" />
            </td>
            <td class="px-6 py-3.5">
              <span class="text-[13px] font-mono text-ink">{{ formatDate(nota.data_emissao) }}</span>
            </td>
            <td class="px-6 py-3.5">
              <div class="flex flex-col">
                <span class="text-[13px] font-mono font-medium text-ink">{{ nota.numero_nfe || '---' }}</span>
                <span class="text-[10px] uppercase tracking-wide text-risco">Série: {{ nota.serie || '---' }}</span>
              </div>
            </td>
            <td class="px-6 py-3.5">
              <div class="flex flex-col">
                <span class="text-[13px] font-medium text-ink truncate max-w-[200px]" :title="nota.nome_emissor">
                  {{ nota.nome_emissor || 'NÃO IDENTIFICADO' }}
                </span>
                <span class="text-[10px] text-risco font-mono">{{ nota.cnpj_emissor }}</span>
              </div>
            </td>
            <td class="px-6 py-3.5">
              <span class="text-[13px] font-mono font-medium text-ink">
                {{ isNaN(parseFloat(nota.valor)) ? '---' : formatCurrency(nota.valor) }}
              </span>
            </td>
            <td class="px-6 py-3.5">
              <span
                v-if="nota.status_manifesto && nota.status_manifesto !== 'Identificada' && nota.status_manifesto !== 'Sem manifestação'"
                class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border"
                :class="getStatusColor(nota.status_manifesto)"
              >
                {{ nota.status_manifesto.toUpperCase() }}
              </span>
              <span v-else class="inline-flex items-center text-[10px] font-medium text-variacao bg-variacao/10 px-2 py-0.5 rounded border border-variacao/20">
                PENDENTE
              </span>
            </td>
            <td class="px-6 py-3.5">
              <div class="flex items-center justify-center gap-1.5">
                <!-- Notas de Saída não podem ser manifestadas -->
                <template v-if="nota.tipo_operacao === 'Saída'">
                  <span class="text-[10px] font-medium text-risco bg-paper px-2 py-0.5 rounded border border-line" title="Notas emitidas por você não podem ser manifestadas">
                    EMITIDA
                  </span>
                </template>

                <template v-else>
                <!-- Se não tiver manifesto, mostra botão de Dar Ciência -->
                <button
                  v-if="!nota.status_manifesto || nota.status_manifesto === 'Identificada' || nota.status_manifesto === 'Sem manifestação'"
                  @click="manifestar(nota, 'ciencia')"
                  class="p-1.5 text-bronze hover:bg-bronze/10 rounded-md transition-colors"
                  title="Dar Ciência da Operação"
                >
                  <CheckCircle class="w-5 h-5" :stroke-width="1.6" />
                </button>

                <!-- Se já teve ciência, pode Confirmar ou Desconhecer -->
                <template v-if="nota.status_manifesto === 'Ciência da Operação'">
                  <button
                    @click="manifestar(nota, 'confirmacao')"
                    class="p-1.5 text-conforme hover:bg-conforme/10 rounded-md transition-colors"
                    title="Confirmar Operação"
                  >
                    <CheckIcon class="w-5 h-5" :stroke-width="1.6" />
                  </button>
                  <button
                    @click="manifestar(nota, 'desconhecimento')"
                    class="p-1.5 text-lacre hover:bg-lacre/10 rounded-md transition-colors"
                    title="Desconhecer Operação"
                  >
                    <Ban class="w-5 h-5" :stroke-width="1.6" />
                  </button>
                  <button
                    @click="manifestar(nota, 'nao_realizada')"
                    class="p-1.5 text-variacao hover:bg-variacao/10 rounded-md transition-colors"
                    title="Operação não Realizada"
                  >
                    <Ban class="w-5 h-5" :stroke-width="1.6" />
                  </button>
                </template>
                </template><!-- fim v-else Entrada -->

                <button
                  v-if="(nota.status_manifesto === 'Confirmação da Operação' || nota.status_manifesto === 'Ciência da Operação') && nota.xml_content"
                  @click="downloadSingleXml(nota.chave_nfe)"
                  class="p-1.5 text-risco hover:text-bronze hover:bg-bronze/10 rounded-md transition-colors"
                  title="Baixar XML"
                >
                  <Download class="w-5 h-5" :stroke-width="1.6" />
                </button>

                <button
                  v-if="nota.itens_json"
                  @click="showItens(nota)"
                  class="p-1.5 text-bronze hover:bg-bronze/10 rounded-md transition-colors"
                  title="Ver Itens/Produtos"
                >
                  <ShoppingCart class="w-5 h-5" :stroke-width="1.6" />
                </button>

                <div class="group relative">
                   <button
                     @click="viewXml(nota.chave_nfe)"
                     class="p-1.5 text-risco hover:text-ink rounded-md transition-colors"
                   >
                     <Eye class="w-5 h-5" :stroke-width="1.6" />
                   </button>
                   <!-- Popover Chave -->
                   <div class="absolute right-full mr-2 top-0 hidden group-hover:block bg-graphite text-white font-mono text-[10px] p-2 rounded-md whitespace-nowrap z-50">
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
    <div v-if="filteredNotas.length > 0" class="flex items-center justify-between text-[13px] text-risco px-2">
      <span>Mostrando {{ filteredNotas.length }} nota(s)</span>
      <div class="flex items-center gap-2">
        <button class="p-2 border border-line rounded-md text-risco hover:bg-paper transition-colors disabled:opacity-30" disabled>
          <ChevronLeft class="w-4 h-4" :stroke-width="1.8" />
        </button>
        <button class="p-2 border border-line rounded-md text-risco hover:bg-paper transition-colors disabled:opacity-30" disabled>
          <ChevronRight class="w-4 h-4" :stroke-width="1.8" />
        </button>
      </div>
    </div>
  </div>

  <!-- Modal Certificado -->
    <div v-if="isCertModalOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/40">
      <div class="bg-sheet rounded-md w-full max-w-md card-shadow overflow-hidden border border-line">
        <div class="p-5 bg-paper border-b border-line flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-sheet border border-line rounded-md flex items-center justify-center">
              <Key class="w-5 h-5 text-bronze" :stroke-width="1.7" />
            </div>
            <div>
              <h3 class="font-display text-[15px] font-semibold text-ink">Certificado Digital</h3>
              <p class="text-[12px] text-risco">Configuração para MD-e (.pfx / A1)</p>
            </div>
          </div>
          <button @click="isCertModalOpen = false" class="text-risco hover:text-ink transition-colors">
            <XCircle class="w-5 h-5" :stroke-width="1.8" />
          </button>
        </div>

        <div class="p-5 space-y-4">
          <!-- Status Atual -->
          <div v-if="certStatus" class="p-3 rounded-md border flex items-center gap-3" :class="certStatus.ativo ? 'bg-conforme/[0.06] border-conforme/25' : 'bg-paper border-line'">
            <ShieldCheck v-if="certStatus.ativo" class="w-5 h-5 text-conforme" :stroke-width="1.8" />
            <AlertCircle v-else class="w-5 h-5 text-risco" :stroke-width="1.8" />
            <div class="flex-1">
              <p class="text-[12px] font-medium" :class="certStatus.ativo ? 'text-conforme' : 'text-ink'">
                {{ certStatus.ativo ? 'CERTIFICADO ATIVO' : 'CERTIFICADO NÃO CONFIGURADO' }}
              </p>
              <p v-if="certStatus.ativo" class="text-[10px] text-conforme/80">Válido até: {{ formatDate(certStatus.validade) }}</p>
            </div>
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Arquivo do Certificado (.pfx)</label>
            <input
              type="file"
              accept=".pfx"
              @change="handleFileSelect"
              class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink block outline-none focus:border-bronze transition-colors"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Senha do Certificado</label>
            <input
              v-model="pfxSenha"
              type="password"
              placeholder="Digite a senha do arquivo"
              @blur="validarCert"
              @keyup.enter="validarCert"
              class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors"
            />
          </div>

          <!-- Preview: validade + confere CNPJ da empresa (antes de salvar) -->
          <div v-if="certValidando" class="text-[12px] text-risco">Lendo certificado…</div>
          <div v-else-if="certPreview" class="p-3 rounded-md border text-[12px] space-y-1"
               :class="(certPreview.erro || !podeSalvarCert()) ? 'bg-lacre/[0.06] border-lacre/30' : 'bg-conforme/[0.06] border-conforme/25'">
            <p v-if="certPreview.erro" class="font-medium text-lacre">⚠️ {{ certPreview.erro }}</p>
            <template v-else>
              <p class="text-ink"><b>Titular:</b> {{ certPreview.titular || '—' }}</p>
              <p :class="certPreview.confere ? 'text-conforme font-medium' : 'text-lacre font-medium'">
                {{ certPreview.confere ? '✅' : '❌' }} CNPJ do certificado: {{ fmtCnpj(certPreview.cnpjCert) }}
                <span v-if="certPreview.semCnpj"> (sem CNPJ — é um e-CPF?)</span>
                <span v-else-if="!certPreview.confere"> — empresa selecionada: {{ fmtCnpj(certPreview.cnpjEmpresa) }}</span>
              </p>
              <p :class="certPreview.vencido ? 'text-lacre font-medium' : (certPreview.perto ? 'text-variacao font-medium' : 'text-ink')">
                {{ certPreview.vencido ? '⛔ VENCIDO em' : '📅 Válido até' }} {{ formatDate(certPreview.validadeFim) }}
                <span v-if="!certPreview.vencido">({{ certPreview.diasParaVencer }} dia(s))<span v-if="certPreview.perto"> — vence em breve!</span></span>
              </p>
              <p v-if="!podeSalvarCert()" class="text-lacre text-[11px]">
                Não é possível salvar: {{ certPreview.semCnpj ? 'certificado sem CNPJ' : (!certPreview.confere ? 'CNPJ diferente da empresa selecionada' : 'certificado vencido') }}.
              </p>
            </template>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Último NSU Consultado</label>
              <input
                v-model="pfxUltimoNsu"
                type="text"
                placeholder="Ex: 0"
                class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
              />
            </div>
            <div class="space-y-1">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Periodicidade (Horas)</label>
              <input
                v-model="pfxPeriodicidade"
                type="number"
                placeholder="Ex: 12"
                class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
              />
            </div>
          </div>

          <div class="bg-bronze/[0.04] border border-bronze/15 p-3 rounded-md flex gap-2">
            <AlertCircle class="w-4 h-4 text-bronze flex-shrink-0 mt-0.5" :stroke-width="1.8" />
            <p class="text-[12px] text-risco leading-relaxed">
              O certificado é armazenado de forma segura e utilizado apenas para consultas à SEFAZ. Use o padrão A1 em formato .pfx.
            </p>
          </div>
        </div>

        <div class="p-5 bg-paper border-t border-line flex gap-2">
          <UiButton variant="ghost" @click="isCertModalOpen = false" class="flex-1 justify-center py-[9px]">
            Cancelar
          </UiButton>
          <UiButton @click="saveCertificado" :disabled="isUploadingCert || !podeSalvarCert()" class="flex-1 justify-center py-[9px] disabled:opacity-50" :title="podeSalvarCert() ? '' : 'Selecione um certificado válido e da empresa selecionada'">
            <RefreshCw v-if="isUploadingCert" class="w-4 h-4 animate-spin" :stroke-width="1.8" />
            {{ isUploadingCert ? 'Salvando...' : 'Salvar Certificado' }}
          </UiButton>
        </div>
      </div>
    </div>
    <!-- Modal Conferência Sped -->
    <div v-if="isConferenciaModalOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/40">
      <div class="bg-sheet rounded-md w-full max-w-2xl card-shadow overflow-hidden border border-line">
        <div class="p-5 bg-paper border-b border-line flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-sheet border border-line rounded-md flex items-center justify-center">
              <Filter class="w-5 h-5 text-bronze" :stroke-width="1.7" />
            </div>
            <div>
              <h3 class="font-display text-[15px] font-semibold text-ink">Resultado da Conferência Sped</h3>
              <p class="text-[12px] text-risco">Comparação entre chaves do arquivo e banco de dados.</p>
            </div>
          </div>
          <button @click="isConferenciaModalOpen = false" class="text-risco hover:text-ink transition-colors">
            <XCircle class="w-5 h-5" :stroke-width="1.8" />
          </button>
        </div>

        <div class="p-5">
          <div v-if="isConferindo" class="py-10 text-center">
            <RefreshCw class="w-7 h-7 text-bronze animate-spin mx-auto mb-3" :stroke-width="1.8" />
            <p class="text-[13px] text-risco">Cruzando dados...</p>
          </div>

          <div v-else-if="conferenciaResult" class="space-y-6">
            <div class="grid grid-cols-3 gap-4">
              <div class="bg-paper p-4 rounded-md border border-line">
                <span class="text-[11px] uppercase tracking-wide text-risco font-medium block mb-1">No Arquivo</span>
                <span class="font-mono text-[22px] font-semibold text-ink">{{ conferenciaResult.total_arquivo }}</span>
              </div>
              <div class="bg-conforme/[0.06] p-4 rounded-md border border-conforme/25">
                <span class="text-[11px] uppercase tracking-wide text-conforme font-medium block mb-1">Encontradas</span>
                <span class="font-mono text-[22px] font-semibold text-conforme">{{ conferenciaResult.encontradas }}</span>
              </div>
              <div class="bg-lacre/[0.06] p-4 rounded-md border border-lacre/25">
                <span class="text-[11px] uppercase tracking-wide text-lacre font-medium block mb-1">Faltantes</span>
                <span class="font-mono text-[22px] font-semibold text-lacre">{{ conferenciaResult.faltantes }}</span>
              </div>
            </div>

            <div v-if="chavesFaltantesParaBaixar.length > 0" class="space-y-3">
              <div class="flex items-center justify-between">
                <h4 class="text-[11px] font-medium text-risco uppercase tracking-wide">Chaves Faltantes (Apenas 1ªs 10)</h4>
                <span class="text-[10px] bg-lacre/10 text-lacre border border-lacre/20 px-2 py-0.5 rounded font-medium">AÇÃO NECESSÁRIA</span>
              </div>

              <div class="max-h-40 overflow-y-auto border border-line rounded-md bg-paper p-2 font-mono text-[11px] text-ink space-y-1">
                <div v-for="chave in chavesFaltantesParaBaixar.slice(0, 10)" :key="chave" class="py-1 border-b border-line last:border-0">
                  {{ chave }}
                </div>
                <div v-if="chavesFaltantesParaBaixar.length > 10" class="text-risco py-2">
                  ... e mais {{ chavesFaltantesParaBaixar.length - 10 }} chaves.
                </div>
              </div>

              <UiButton @click="baixarFaltantesSped" class="w-full justify-center py-[9px]">
                <Zap class="w-4 h-4" :stroke-width="1.8" />
                Solicitar Captura de Faltantes via EspiãoNFe
              </UiButton>
            </div>

            <div v-else class="py-6 text-center bg-conforme/[0.06] rounded-md border border-conforme/25">
              <CheckCircle2 class="w-9 h-9 text-conforme mx-auto mb-2" :stroke-width="1.7" />
              <p class="text-[13px] font-medium text-conforme">Tudo em dia!</p>
              <p class="text-[12px] text-conforme/80">Todas as chaves do arquivo já constam no banco de dados.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  <!-- Modal Visualizador de XML -->
  <div v-if="isXmlViewerOpen" class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ink/40">
    <div class="bg-sheet rounded-md w-full max-w-4xl max-h-[90vh] card-shadow overflow-hidden border border-line flex flex-col">
      <div class="p-5 bg-paper border-b border-line flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-sheet border border-line rounded-md flex items-center justify-center">
            <FileText class="w-5 h-5 text-bronze" :stroke-width="1.7" />
          </div>
          <div>
            <h3 class="font-display text-[15px] font-semibold text-ink">Visualizador de XML</h3>
            <p class="text-[12px] text-risco">Conteúdo bruto da nota fiscal</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
           <button
             @click="isXmlViewerOpen = false"
             class="p-2 text-risco hover:text-ink hover:bg-line/50 rounded-md transition-colors"
           >
             <X class="w-5 h-5" :stroke-width="1.8" />
           </button>
        </div>
      </div>

      <div class="p-4 overflow-auto flex-1 bg-graphite">
        <pre class="text-[12px] text-line font-mono leading-relaxed p-4 whitespace-pre-wrap">{{ currentXml }}</pre>
      </div>

      <div class="p-4 bg-paper border-t border-line flex justify-end">
        <UiButton @click="isXmlViewerOpen = false">
          Fechar Visualizador
        </UiButton>
      </div>
    </div>
  </div>

  <!-- Modal de Itens -->
  <div v-if="isItensModalOpen" class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ink/40">
    <div class="bg-sheet rounded-md w-full max-w-4xl max-h-[90vh] card-shadow overflow-hidden border border-line flex flex-col">
      <div class="p-5 bg-paper border-b border-line flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-sheet border border-line rounded-md flex items-center justify-center">
            <ShoppingCart class="w-5 h-5 text-bronze" :stroke-width="1.7" />
          </div>
          <div>
            <h3 class="font-display text-[15px] font-semibold text-ink">Itens / Produtos da Nota</h3>
            <p class="text-[12px] text-risco font-mono">NF: {{ notaSelecionadaItens?.numero_nfe }} | Chave: {{ notaSelecionadaItens?.chave_nfe }}</p>
          </div>
        </div>
        <button @click="isItensModalOpen = false" class="text-risco hover:text-ink transition-colors">
          <XCircle class="w-5 h-5" :stroke-width="1.8" />
        </button>
      </div>

      <div class="flex-1 overflow-auto p-0">
        <table v-if="notaSelecionadaItens?.itens_json?.length" class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-paper border-b border-line sticky top-0 z-10">
              <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Produto</th>
              <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Qtd</th>
              <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">Un</th>
              <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco">V. Unit</th>
              <th class="px-6 py-3 text-[10px] uppercase tracking-wide font-medium text-risco text-right">Total Item</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in notaSelecionadaItens.itens_json" :key="idx" class="border-t border-line hover:bg-paper transition-colors">
              <td class="px-6 py-3.5">
                <div class="flex flex-col">
                  <span class="text-[13px] font-medium text-ink">{{ item.prod }}</span>
                  <span class="text-[10px] text-risco font-mono">CFOP: {{ item.cfop }} | NCM: {{ item.ncm }}</span>
                </div>
              </td>
              <td class="px-6 py-3.5 text-[13px] font-mono text-ink">{{ item.qCom }}</td>
              <td class="px-6 py-3.5 text-[13px] text-risco">{{ item.uCom }}</td>
              <td class="px-6 py-3.5 text-[13px] font-mono text-ink">{{ formatCurrency(item.vUnCom) }}</td>
              <td class="px-6 py-3.5 text-[13px] font-mono font-medium text-ink text-right">{{ formatCurrency(item.vProd) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="p-16 text-center text-risco">
          <Package class="w-11 h-11 mx-auto mb-3 text-line" :stroke-width="1.4" />
          <p class="text-[13px]">Nenhum item encontrado no XML.</p>
        </div>
      </div>

      <div class="p-5 bg-paper border-t border-line flex items-center justify-between">
        <div class="text-[12px] text-risco">
          * Dados extraídos diretamente do arquivo XML autorizado.
        </div>
        <UiButton @click="isItensModalOpen = false">
          Fechar
        </UiButton>
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
