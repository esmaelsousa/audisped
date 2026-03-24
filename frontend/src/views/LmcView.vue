<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios'
import { API_BASE_URL } from '../api';
import { arquivoInfo, setArquivoInfo, setEmpresaSelecionada, empresaSelecionada } from '../store';
import { ArrowLeft, Database, Loader2, FileX, Settings, Save, DownloadCloud, AlertTriangle, Eye, Beaker, ChevronDown, ChevronUp, CheckCircle2, XCircle, RefreshCw } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const lmcData = ref([]);
const loading = ref(true);
const processingStatus = ref('');
const savingDate = ref(null);
const savingMacro = ref(false);
const selectedFuel = ref(null);
const expandedDays = ref(new Set()); 
const viewMode = ref('raiox'); // 'raiox' | 'laboratorio'

const metaVendas = ref(''); 
const showOptimizerModal = ref(false);
const volumeAlvo = ref(0);

onMounted(async () => {
    const arquivoId = route.params.id || arquivoInfo.value?.id;
    if (!arquivoId) {
        alert("Nenhum arquivo ativo. Por favor selecione no explorador.");
        router.push('/');
        return;
    }

    // Se não temos o contexto na store, vamos buscar para preencher o Menu Lateral
    if (!empresaSelecionada.value || !arquivoInfo.value || arquivoInfo.value.id != arquivoId) {
        try {
            const res = await axios.get(`${API_BASE_URL}/api/arquivo/info/${arquivoId}`);
            setArquivoInfo(res.data);
            setEmpresaSelecionada({
                id: res.data.id_empresa,
                nome_empresa: res.data.empresa,
                cnpj: res.data.cnpj
            });
        } catch (e) {
            console.warn("Não foi possível restaurar contexto da auditoria:", e);
        }
    }

    await loadData(arquivoId);
});

const currentArquivoId = ref(null);
const continuidade = ref({ tem_mes_anterior: false, divergencias: [] });
const sincronizando = ref({});

// ── Modal de preview de sincronização ──
const showSyncModal = ref(false);
const syncPreviewLoading = ref(false);
const syncConfirmando = ref(false);
const syncPreviews = ref([]);      // [{ cod_item, resumo, ajustes, dias, updates }]
const syncAbaAtiva = ref(0);       // índice da aba ativa
const syncDiasExpandido = ref(false);

async function checkContinuidade() {
    if (!currentArquivoId.value) return;
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/lmc/continuidade/${currentArquivoId.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        continuidade.value = res.data;
    } catch (e) {
        console.error('Erro ao verificar continuidade:', e);
    }
}

async function abrirPreviewSincronizacao(divergencias) {
    if (!currentArquivoId.value || !divergencias.length) return;
    syncPreviewLoading.value = true;
    syncDiasExpandido.value = false;
    syncAbaAtiva.value = 0;
    try {
        const token = localStorage.getItem('token');
        const itens = divergencias.map(d => ({
            id_arquivo: currentArquivoId.value,
            cod_item: d.cod_item,
            novo_estoque: d.fechamento_anterior
        }));
        const res = await axios.post(`${API_BASE_URL}/api/lmc/preview-sincronizacao`, { itens },
            { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        // Injeta nome do produto no preview para exibição
        syncPreviews.value = res.data.previews.map((p, i) => ({
            ...p,
            nome: divergencias[i]?.nome || divergencias[i]?.cod_item
        }));
        showSyncModal.value = true;
    } catch (e) {
        alert('Erro ao gerar prévia: ' + (e.response?.data?.error || e.message));
    } finally {
        syncPreviewLoading.value = false;
    }
}

async function confirmarSincronizacao() {
    syncConfirmando.value = true;
    try {
        const token = localStorage.getItem('token');
        const itens = syncPreviews.value.map(p => ({
            id_arquivo: currentArquivoId.value,
            cod_item: p.cod_item,
            novo_estoque: p.resumo.abertura_depois
        }));
        await axios.post(`${API_BASE_URL}/api/lmc/confirmar-sincronizacao`, { itens },
            { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        showSyncModal.value = false;
        await loadData(currentArquivoId.value);
    } catch (e) {
        alert('Erro ao confirmar: ' + (e.response?.data?.error || e.message));
    } finally {
        syncConfirmando.value = false;
    }
}

function sincronizarEstoque(codItem, fechamentoAnterior) {
    const div = continuidade.value.divergencias.find(d => d.cod_item === codItem);
    if (div) abrirPreviewSincronizacao([div]);
}

async function redistribuirCombustivel() {
    if (!selectedFuel.value || !movimentacaoAtiva.value.length) return;
    const firstRow = movimentacaoAtiva.value[0];
    const novoEstoque = firstRow.estq_abert_ajustado !== null
        ? parseFloat(firstRow.estq_abert_ajustado)
        : parseFloat(firstRow.estq_abert || 0);
    const nome = combustiveis.value.find(c => c.cod_item === selectedFuel.value)?.nome_combustivel || selectedFuel.value;
    await abrirPreviewSincronizacao([{ cod_item: selectedFuel.value, fechamento_anterior: novoEstoque, nome }]);
}

function sincronizarTodos() {
    abrirPreviewSincronizacao(continuidade.value.divergencias);
}

async function loadData(arquivoId) {
    if (!arquivoId) return;
    currentArquivoId.value = arquivoId;
    loading.value = true;
    lmcData.value = []; // Limpa para garantir reatividade total
    try {
        const response = await axios.get(`${API_BASE_URL}/api/lmc/${arquivoId}`);
        lmcData.value = response.data.map(item => ({
            ...item,
            nfs_detalhadas: typeof item.nfs_detalhadas === 'string'
                ? JSON.parse(item.nfs_detalhadas)
                : (item.nfs_detalhadas || []),
            edit_value: item.vol_saidas_ajustado !== null ? item.vol_saidas_ajustado : item.vol_saidas,
            fisico_edit_value: item.fech_fisico_ajustado !== null ? item.fech_fisico_ajustado : item.fech_fisico,
            raiox: {},
            lab: {}
        }));

        if (combustiveis.value.length > 0 && !selectedFuel.value) {
            selectedFuel.value = combustiveis.value[0].cod_item;
        }
        recalcularTudo();
        await checkContinuidade();
    } catch (error) {
        console.error("Erro ao carregar dados do LMC:", error);
    } finally {
        loading.value = false;
    }
}

const COMBUSTIVEIS_KEYWORDS = ['GASOLINA', 'ETANOL', 'ÁLCOOL', 'ALCOOL', 'DIESEL', 'GNV', 'GLP', 'QUEROSENE', 'BIODIESEL'];

// Extrair lista única de combustíveis disponíveis
const combustiveis = computed(() => {
    const list = [];
    const map = new Set();
    lmcData.value
        .filter(item => COMBUSTIVEIS_KEYWORDS.some(k => (item.nome_combustivel || '').toUpperCase().includes(k)))
        .forEach(item => {
            if (!map.has(item.cod_item)) {
                map.add(item.cod_item);
                list.push({ cod_item: item.cod_item, nome: item.nome_combustivel });
            }
        });
    return list;
});

// A Função de Recálculo (Motores Paralelos: Raio-X vs Laboratório)
// OTIMIZAÇÃO: Processamento assíncrono para evitar travamento da UI
async function recalcularTudo() {
    if (!lmcData.value || lmcData.value.length === 0) return;
    
    // Indica que iniciou o processamento interno
    loading.value = true;
    
    // Extraímos os códigos manualmente
    const uniqueCodes = [...new Set(lmcData.value.map(i => i.cod_item))];
    
    for (const code of uniqueCodes) {
        const fuelName = lmcData.value.find(i => i.cod_item === code)?.nome_combustivel || code;
        processingStatus.value = `Processando ${fuelName}...`;
        
        // Pequena pausa para deixar o navegador respirar e atualizar a UI
        await new Promise(resolve => setTimeout(resolve, 0));

        const items = lmcData.value.filter(i => i.cod_item === code)
            .sort((a,b) => new Date(a.data_movimento) - new Date(b.data_movimento));
        
        let runningAberturaLab = null;

        items.forEach((row, index) => {
            // Valores Originais do SPED (Secos)
            const aberturaSped = parseFloat(row.estq_abert || 0);
            const entradas = parseFloat(row.vol_entr_lmc || 0);
            const saidaSped = parseFloat(row.vol_saidas || 0);
            const perdaSped = parseFloat(row.val_perda || 0);
            const ganhoSped = parseFloat(row.val_ganho || 0);
            const escrituralSped = parseFloat(row.estq_escr || 0);
            const fisicoSped = parseFloat(row.fech_fisico || 0);

            // MOTOR 1: RAIO-X
            const volumeBase = aberturaSped + entradas;
            const difTeoricaRaioX = fisicoSped - (aberturaSped + entradas - saidaSped);
            const percentualRaioX = volumeBase > 0 ? (Math.abs(difTeoricaRaioX) / volumeBase) * 100 : 0;

            const escrRaioX = aberturaSped + entradas - saidaSped;
            row.raiox = {
                estq_abert: aberturaSped,
                vol_entr: entradas,
                vol_saidas: saidaSped,
                estq_escr: escrituralSped,
                fech_fisico: fisicoSped,
                dif: difTeoricaRaioX,
                percentual: percentualRaioX,
                ultrapassou_limite: percentualRaioX > 0.601,
                is_negativo: escrRaioX < -0.01 || fisicoSped < -0.01
            };

            // MOTOR 2: LABORATÓRIO (Cascata Dinâmica)
            const entrLab = row.vol_entr_ajustado !== null ? parseFloat(row.vol_entr_ajustado) : entradas;
            const aberturaLab0 = row.estq_abert_ajustado !== null ? parseFloat(row.estq_abert_ajustado) : aberturaSped;
            const aberturaLab = (index === 0) ? aberturaLab0 : (runningAberturaLab ?? aberturaSped);

            const saidaLab = parseFloat(row.edit_value ?? saidaSped);
            const fisicoLab = parseFloat(row.fisico_edit_value ?? fisicoSped);
            
            const volumeBaseLab = aberturaLab + entrLab;
            const difBruta = fisicoLab - (aberturaLab + entrLab - saidaLab); 
            
            const perdaLab = difBruta < 0 ? Math.abs(difBruta) : 0;
            const ganhoLab = difBruta > 0 ? difBruta : 0;

            const escrituralLab = fisicoLab; 
            const percentualLab = volumeBaseLab > 0 ? (Math.abs(difBruta) / volumeBaseLab) * 100 : 0;
            
            const escrLab = aberturaLab + entrLab - saidaLab;
            row.lab = {
                estq_abert: aberturaLab,
                vol_entr: entrLab,
                vol_saidas: saidaLab,
                estq_escr: escrituralLab,
                fech_fisico: fisicoLab,
                val_perda: perdaLab,
                val_ganho: ganhoLab,
                dif: difBruta,
                percentual: percentualLab,
                ultrapassou_limite: percentualLab > 0.601,
                is_negativo: escrLab < -0.01 || fisicoLab < -0.01,
                is_saida_edited: parseFloat(saidaLab).toFixed(3) !== saidaSped.toFixed(3),
                is_fisico_edited: parseFloat(fisicoLab).toFixed(3) !== fisicoSped.toFixed(3),
                is_entr_edited: parseFloat(entrLab).toFixed(3) !== entradas.toFixed(3)
            };

            runningAberturaLab = fisicoLab;
        });
    }
    
    loading.value = false;
    processingStatus.value = '';
}


// Filtra pra UI e já pega calculados
const movimentacaoAtiva = computed(() => {
    if (!selectedFuel.value) return [];
    return lmcData.value.filter(item => item.cod_item === selectedFuel.value)
        .sort((a,b) => new Date(a.data_movimento) - new Date(b.data_movimento));
});

// Detecta inconsistência: fisicoLab foi ajustado mas está muito divergente (sync com código antigo)
const distribuicaoInconsistente = computed(() => {
    if (viewMode.value !== 'lab' || !movimentacaoAtiva.value.length) return false;
    // Verifica se algum dia tem fech_fisico_ajustado setado mas com diferença > 1%
    return movimentacaoAtiva.value.some(row => {
        const temAjuste = row.fech_fisico_ajustado !== null;
        const percentual = row.lab?.percentual || 0;
        return temAjuste && percentual > 1.0;
    });
});

const corrigindoDistribuicao = ref(false);

async function corrigirDistribuicao() {
    if (!selectedFuel.value) return;
    corrigindoDistribuicao.value = true;
    try {
        const token = localStorage.getItem('token');
        await axios.post(`${API_BASE_URL}/api/lmc/corrigir-distribuicao`,
            { id_arquivo: currentArquivoId.value, cod_item: selectedFuel.value },
            { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        await loadData(currentArquivoId.value);
    } catch (e) {
        alert('Erro ao corrigir: ' + (e.response?.data?.error || e.message));
    } finally {
        corrigindoDistribuicao.value = false;
    }
}

async function rodarOtimizador() {
    if (!volumeAlvo.value || volumeAlvo.value <= 0) {
        alert("Informe um volume meta válido.");
        return;
    }
    
    savingMacro.value = true;
    try {
        const arquivoId = route.params.id || arquivoInfo.value?.id;
        const response = await axios.post(`${API_BASE_URL}/api/lmc/otimizador-matematico`, {
            id_arquivo: arquivoId,
            cod_item: selectedFuel.value,
            volume_alvo: volumeAlvo.value
        });
        
        if (response.data.success) {
            alert(response.data.message + (response.data.estouro_tanque ? "\n\nAtenção: O teto do tanque foi atingido em alguns dias." : ""));
            showOptimizerModal.value = false;
            viewMode.value = 'lab'; // Força visualização dos cálculos
            await loadData(arquivoId); // Recarrega tudo do banco
        }
    } catch (error) {
        console.error("Erro no otimizador:", error);
        alert("Falha ao processar otimização matemática.");
    } finally {
        savingMacro.value = false;
    }
}

const totais = computed(() => {
    const calc = { comprasTotal: 0, nfsTotal: 0, vendasDeclaradas: 0, vendasAjustadas: 0, perdasTotal: 0, ganhosTotal: 0 };
    movimentacaoAtiva.value.forEach(row => {
        const isLab = viewMode.value === 'lab';
        calc.comprasTotal += isLab ? (row.lab?.vol_entr || 0) : parseFloat(row.vol_entr_lmc || 0);
        calc.nfsTotal += parseFloat(row.volume_nota || 0);
        calc.vendasDeclaradas += parseFloat(row.vol_saidas || 0); 
        calc.vendasAjustadas += row.lab?.vol_saidas || 0; 
        calc.perdasTotal += isLab ? (row.lab?.val_perda || 0) : parseFloat(row.val_perda || 0);
        calc.ganhosTotal += isLab ? (row.lab?.val_ganho || 0) : parseFloat(row.val_ganho || 0);
    });
    return calc;
});

// Ações
function toggleDay(date) {
    if (expandedDays.value.has(date)) expandedDays.value.delete(date);
    else expandedDays.value.add(date);
}

// Salva linha avulsa
async function salvarAjuste(row) {
    const finalSaida = parseFloat(row.edit_value) === parseFloat(row.vol_saidas) ? null : row.edit_value;
    const finalFisico = parseFloat(row.fisico_edit_value) === parseFloat(row.fech_fisico) ? null : row.fisico_edit_value;
    
    savingDate.value = row.data_movimento;
    try {
        await axios.post(`${API_BASE_URL}/api/lmc/ajustar-lote`, {
            updates: [{
                id_sped: route.params.id || arquivoInfo.value?.id,
                cod_item: row.cod_item,
                data_mov: row.data_movimento,
                vol_saidas_ajustado: finalSaida,
                fech_fisico_ajustado: finalFisico
            }]
        });
        row.vol_saidas_ajustado = finalSaida;
        row.fech_fisico_ajustado = finalFisico;
        recalcularTudo();
    } catch (error) {
        alert('Erro ao salvar o ajuste.');
        console.error(error);
    } finally {
        savingDate.value = null;
    }
}

// MACRO FUNÇÃO: Otimização Matemática com Ruído Orgânico via Backend
async function aplicarRateioInteligente() {
    if (!metaVendas.value || isNaN(metaVendas.value)) {
        alert("Preencha uma meta válida em litros.");
        return;
    }
    
    if (!confirm("O motor matemático vai redistribuir as saídas e embutir oscilações de 0.45% no fechamento físico para simular medições reais nos estoques.\n\nEssa ação não pode ser desfeita. Confirmar?")) return;

    savingMacro.value = true;
    try {
        const id_arquivo = route.params.id || arquivoInfo.value?.id;
        const response = await axios.post(`${API_BASE_URL}/api/lmc/otimizador-matematico`, {
            id_arquivo: id_arquivo,
            cod_item: selectedFuel.value,
            volume_alvo: parseFloat(metaVendas.value)
        });
        
        if (response.data.alertas && response.data.alertas.length > 0) {
            alert(response.data.alertas.join('\n'));
        } else {
            alert(response.data.message || 'Otimização concluída!');
        }

        // Recarregar os dados frescos com o ruído gerado pelo backend
        viewMode.value = 'lab'; // Garante que o usuário veja a visão ajustada
        await loadData(id_arquivo);
        metaVendas.value = '';
    } catch (error) {
        alert('Erro ao otimizar LMC: ' + (error.response?.data?.error || error.message));
        console.error(error);
    } finally {
        savingMacro.value = false;
    }
}


async function salvarLoteRateio() {
    if (!confirm("Isso reescreverá a auditoria deste combustível e salvará todas as quebras mascaradas. Continuar?")) return;
    
    savingMacro.value = true;
    const items = lmcData.value.filter(i => i.cod_item === selectedFuel.value);
    
    const updates = items.map(row => {
        return {
            id_sped: route.params.id || arquivoInfo.value?.id,
            cod_item: row.cod_item,
            data_mov: row.data_movimento,
            vol_saidas_ajustado: parseFloat(row.edit_value) === parseFloat(row.vol_saidas) ? null : row.edit_value,
            fech_fisico_ajustado: parseFloat(row.fisico_edit_value) === parseFloat(row.fech_fisico) ? null : row.fisico_edit_value
        }
    });

    try {
        await axios.post(`${API_BASE_URL}/api/lmc/ajustar-lote`, { updates });
        lmcData.value.forEach(r => {
            if (r.cod_item === selectedFuel.value) {
                r.vol_saidas_ajustado = parseFloat(r.edit_value) === parseFloat(r.vol_saidas) ? null : r.edit_value;
                r.fech_fisico_ajustado = parseFloat(r.fisico_edit_value) === parseFloat(r.fech_fisico) ? null : r.fisico_edit_value;
            }
        });
        recalcularTudo();
        alert("Rateio em Lote salvo com sucesso! Toda a margem ANP foi calculada.");
        metaVendas.value = '';
    } catch (error) {
        alert('Erro ao salvar em lote.');
    } finally {
        savingMacro.value = false;
    }
}

// Quando trocar combustível, rodar cálculo
watch(selectedFuel, () => recalcularTudo());

// Formatação Visual
const fNum = (num) => {
    const val = parseFloat(num || 0);
    if (isNaN(val)) return '0,00';
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : '-';

// FUNÇÃO DE DOWNLOAD DO SPED RETIFICADO
async function exportarSped() {
    const arquivoId = route.params.id || arquivoInfo.value?.id;
    const token = localStorage.getItem('token');
    
    try {
        const response = await axios.get(`${API_BASE_URL}/api/exportar-sped/${arquivoId}`, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'blob'
        });
        
        const blob = new Blob([response.data]);
        const reader = new FileReader();
        reader.onloadend = () => {
            const link = document.createElement('a');
            link.href = reader.result; // Data URI gerado pelo FileReader (Bypassa bloqueios HTTP)
            const cnpjLimpo = String(arquivoInfo.value?.cnpj || '').replace(/\D/g, '');
            const partes = String(arquivoInfo.value?.periodo || '').split(' a ');
            const periodoIni = (partes[0] || '').replace(/\D/g, '');
            const periodoFim = (partes[1] || partes[0] || '').replace(/\D/g, '');
            const nomeExport = cnpjLimpo && periodoIni
                ? `${cnpjLimpo}_${periodoIni}_${periodoFim}.txt`
                : `SPED_FISCAL_${arquivoInfo.value?.nome_arquivo || 'exportado'}.txt`;
            link.setAttribute('download', nomeExport);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
        reader.readAsDataURL(blob);
    } catch (error) {
        console.error(error);
        const status = error.response?.status;
        
        // Se a resposta for um Blob (erro do servidor vindo de responseType: blob), precisamos ler o texto dele
        if (error.response?.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
                const msg = reader.result;
                alert(`Erro na Exportação (${status || 'Conexão'}): ${msg}`);
            };
            reader.readAsText(error.response.data);
        } else {
            const msg = error.response?.data?.message || error.response?.data;
            if (status === 400) {
                alert(`ATENÇÃO: ${msg || "Arquivo antigo sem caminho físico."}`);
            } else {
                alert(`Erro na Exportação (${status || 'Conexão'}): ${msg || 'O servidor não conseguiu processar o arquivo retificado.'}`);
            }
        }
    }
}
</script>

<template>
  <div class="max-w-7xl mx-auto py-8 px-6 space-y-6 animate-fade-in">
    <!-- Header -->
    <header class="flex justify-between items-end border-b border-slate-200 pb-4">
      <div>
        <button @click="router.push('/analisador/' + route.params.id)" class="text-xs font-black text-brand-accent hover:underline mb-2 flex items-center gap-1 group">
          <ArrowLeft class="w-3 h-3 group-hover:-translate-x-1 transition-transform" /> VOLTAR PARA O ANALISADOR
        </button>
        <h1 class="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
          <Database class="w-8 h-8 text-brand-accent" /> LMC Diário Fiscal
        </h1>
        <p class="text-slate-500 font-medium mt-1">Inspeção interativa de recálculo de inventário e camuflagem de Quebra ANP.</p>
      </div>
      <div v-if="arquivoInfo" class="text-right">
        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest">Período Auditado</p>
        <p class="text-lg font-mono text-slate-700 font-bold bg-slate-100 px-3 py-1 rounded-lg mt-1">
          {{ arquivoInfo.periodo }}
        </p>
      </div>
    </header>

    <div v-if="loading" class="py-20 flex flex-col justify-center items-center text-center">
      <Loader2 class="w-10 h-10 animate-spin text-slate-300 mb-4" />
      <p class="text-slate-500 font-bold">{{ processingStatus || 'Processando fechamentos e encadeamento em cascata...' }}</p>

    </div>

    <div v-else-if="lmcData.length === 0" class="bg-white rounded-[3rem] p-24 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 shadow-sm">
        <div class="w-24 h-24 bg-slate-50 rounded-full flex justify-center items-center mb-6">
           <FileX class="w-10 h-10 text-slate-300" />
        </div>
        <h3 class="text-xl font-bold text-slate-700">Nenhum dado de LMC (Bloco 1300) encontrado.</h3>
        <p class="text-slate-400 mt-2">Este SPED não possui registros consolidados mensais.</p>
    </div>

    <div v-else class="space-y-4">
        <!-- Dashboard Macro - SLIM VERSION -->
        <div class="bg-slate-900 px-6 py-3 rounded-2xl shadow-lg border border-slate-700 flex items-center justify-between gap-6">
            <div class="flex items-center gap-4 flex-1">
                <div class="bg-brand-accent/10 p-2 rounded-lg">
                   <Settings class="w-5 h-5 text-brand-accent" />
                </div>
                <div>
                   <h3 class="font-black text-sm text-white uppercase tracking-wider">Distribuição Inteligente</h3>
                   <p class="text-[10px] text-slate-400 font-medium leading-tight">Rateio proporcional ANP (±0.35%) e camuflagem de quebras no Banco de Dados.</p>
                </div>
                <div class="h-8 w-px bg-slate-700 mx-2"></div>
                <div class="flex flex-col leading-tight">
                    <span class="text-xs font-black text-white truncate max-w-[220px]">{{ arquivoInfo?.empresa || empresaSelecionada?.nome_empresa || '—' }}</span>
                    <span class="text-[10px] font-mono text-slate-400">{{ arquivoInfo?.cnpj || empresaSelecionada?.cnpj || '' }}</span>
                    <span class="text-[10px] font-bold text-brand-accent">{{ arquivoInfo?.periodo || '' }}</span>
                </div>
            </div>

            <div class="flex items-center gap-2">
                <div class="relative group">
                    <input type="number" v-model="volumeAlvo" placeholder="Meta Volume (L)" 
                        class="w-32 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-white text-xs font-mono font-bold outline-none focus:ring-1 focus:ring-brand-accent transition-all text-right" />
                </div>
                <button @click="rodarOtimizador" :disabled="savingMacro" 
                    class="bg-brand-accent hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-black transition-all disabled:opacity-50 flex items-center gap-2">
                    <Loader2 v-if="savingMacro" class="w-3 h-3 animate-spin" />
                    OTIMIZAR 1300
                </button>
                <div class="w-px h-6 bg-slate-700 mx-1"></div>
                <button @click="salvarLoteRateio" :disabled="savingMacro" 
                    class="bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all flex items-center gap-2">
                    <Save v-if="!savingMacro" class="w-3 h-3" /> 
                    GRAVAR
                </button>
                <button @click="exportarSped" 
                    class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[10px] font-black transition-all shadow-md shadow-emerald-900/20 flex items-center gap-2">
                    <DownloadCloud class="w-3 h-3" /> EXPORTAR SPED
                </button>
            </div>
        </div>

        <!-- Totais Dashboards - COMPACT CARDS -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div class="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm group hover:border-blue-200 transition-colors">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-tight">Recebido LMC</p>
                <p class="text-lg font-black text-blue-600 mt-1 break-all">{{ fNum(totais.comprasTotal) }} <span class="text-[10px] font-bold">L</span></p>
            </div>
            <div class="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm group hover:border-red-200 transition-colors">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-tight">Perdas (SPED)</p>
                <p class="text-lg font-black text-red-500 mt-1 break-all">-{{ fNum(totais.perdasTotal) }} <span class="text-[10px] font-bold">L</span></p>
            </div>
            <div class="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm group hover:border-emerald-200 transition-colors">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-tight">Ganhos (SPED)</p>
                <p class="text-lg font-black text-emerald-500 mt-1 break-all">+{{ fNum(totais.ganhosTotal) }} <span class="text-[10px] font-bold">L</span></p>
            </div>
            <div class="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm group hover:border-brand-accent transition-colors">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-tight text-brand-accent">XMLs (ANP)</p>
                <div class="flex items-center gap-1.5 mt-1">
                    <p class="text-lg font-black text-slate-700 break-all">{{ fNum(totais.nfsTotal) }} <span class="text-[10px] font-bold text-slate-400">L</span></p>
                    <AlertTriangle v-if="totais.nfsTotal !== totais.comprasTotal" class="w-3.5 h-3.5 text-amber-500" />
                </div>
            </div>
            <div class="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm group hover:border-orange-200 transition-colors">
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-tight">Vendas Brutas</p>
                <p class="text-lg font-black text-orange-500 mt-1 break-all">{{ fNum(totais.vendasDeclaradas) }} <span class="text-[10px] font-bold">L</span></p>
            </div>
            <div class="bg-slate-50 px-4 py-3 rounded-xl border-2 border-indigo-100 shadow-sm relative overflow-hidden group">
                <div class="absolute top-0 right-0 p-1">
                    <div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></div>
                </div>
                <p class="text-[9px] font-black text-indigo-400 uppercase tracking-tight">Vendas Auditoria</p>
                <p class="text-lg font-black text-indigo-600 mt-1 break-all">{{ fNum(totais.vendasAjustadas) }} <span class="text-[10px] font-bold">L</span></p>
                <p v-if="totais.vendasAjustadas !== totais.vendasDeclaradas" class="text-[8px] font-black text-indigo-400/70 mt-1 uppercase">
                    Δ: {{ fNum(totais.vendasAjustadas - totais.vendasDeclaradas) }} L
                </p>
            </div>
        </div>

        <!-- Banner de Continuidade de Estoque -->
        <div v-if="continuidade.divergencias.length > 0" class="bg-amber-50 border border-amber-300 rounded-2xl p-4 shadow-sm">
            <div class="flex items-start justify-between gap-4">
                <div class="flex items-start gap-3 flex-1">
                    <AlertTriangle class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                        <p class="text-sm font-black text-amber-800 uppercase tracking-wide">
                            Divergência de Estoque Detectada
                        </p>
                        <p class="text-xs text-amber-700 mt-0.5">
                            O estoque de abertura deste mês difere do fechamento do mês anterior
                            <span class="font-bold">({{ continuidade.divergencias[0]?.periodo_anterior?.substring(5,7) }}/{{ continuidade.divergencias[0]?.periodo_anterior?.substring(0,4) }})</span>
                            em {{ continuidade.divergencias.length }} produto(s).
                        </p>
                        <div class="mt-3 space-y-1.5">
                            <div v-for="div in continuidade.divergencias" :key="div.cod_item"
                                class="flex items-center gap-3 bg-white/70 rounded-xl px-3 py-2 border border-amber-200">
                                <div class="flex-1 min-w-0">
                                    <span class="text-xs font-black text-slate-700 truncate block">{{ div.nome || div.cod_item }}</span>
                                    <div class="flex items-center gap-3 mt-0.5 text-[10px] font-mono">
                                        <span class="text-slate-500">Fech. anterior: <span class="font-bold text-slate-700">{{ fNum(div.fechamento_anterior) }} L</span></span>
                                        <span class="text-slate-400">→</span>
                                        <span class="text-slate-500">Abert. atual: <span class="font-bold text-slate-700">{{ fNum(div.abertura_atual) }} L</span></span>
                                        <span :class="div.diferenca > 0 ? 'text-emerald-600' : 'text-red-600'" class="font-black">
                                            (Δ {{ div.diferenca > 0 ? '+' : '' }}{{ fNum(div.diferenca) }} L)
                                        </span>
                                    </div>
                                </div>
                                <button @click="sincronizarEstoque(div.cod_item, div.fechamento_anterior)"
                                    :disabled="sincronizando[div.cod_item]"
                                    class="shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black rounded-lg transition-all disabled:opacity-50 flex items-center gap-1.5">
                                    <Loader2 v-if="sincronizando[div.cod_item]" class="w-3 h-3 animate-spin" />
                                    SINCRONIZAR
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <button v-if="continuidade.divergencias.length > 1" @click="sincronizarTodos"
                    :disabled="Object.keys(sincronizando).length > 0"
                    class="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-black rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 shadow-md shadow-amber-200">
                    <Loader2 v-if="Object.keys(sincronizando).length > 0" class="w-3 h-3 animate-spin" />
                    SINCRONIZAR TODOS
                </button>
            </div>
        </div>

        <!-- Controles Interativos -->
        <div class="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/50 p-2 rounded-2xl border border-white">
            <!-- Abas de Seleção de Combustível -->
            <div class="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar flex-1">
                <button 
                    v-for="comb in combustiveis" 
                    :key="comb.cod_item"
                    @click="selectedFuel = comb.cod_item"
                    class="px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all whitespace-nowrap border"
                    :class="selectedFuel === comb.cod_item 
                        ? 'bg-brand-accent text-white border-brand-accent shadow-md shadow-brand-accent/20' 
                        : 'bg-white text-slate-400 border-slate-200 hover:border-brand-accent hover:text-brand-accent'"
                >
                    {{ comb.nome || `Prod ${comb.cod_item}` }}
                </button>
            </div>
            
            <!-- Simulador vs Original -->
            <div class="flex items-center gap-2 shrink-0">
                <button v-if="viewMode === 'lab' && selectedFuel && movimentacaoAtiva.length > 0"
                        @click="redistribuirCombustivel"
                        :disabled="syncPreviewLoading"
                        class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border border-indigo-300 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all disabled:opacity-50"
                        title="Re-executa a distribuição inteligente usando a abertura atual">
                    <RefreshCw class="w-3 h-3" :class="syncPreviewLoading ? 'animate-spin' : ''" />
                    Re-distribuir
                </button>
                <div class="bg-slate-200/50 p-1 rounded-xl flex gap-1 h-fit backdrop-blur-sm">
                    <button @click="viewMode = 'raiox'"
                        class="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all"
                        :class="viewMode === 'raiox' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'">
                        <Eye class="w-3.5 h-3.5" /> RAIO-X
                    </button>
                    <button @click="viewMode = 'lab'"
                        class="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all"
                        :class="viewMode === 'lab' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : 'text-slate-500 hover:text-slate-700'">
                        <Beaker class="w-3.5 h-3.5" /> LABORATÓRIO
                    </button>
                </div>
            </div>
        </div>

        <!-- Banner: distribuição inconsistente (sync com código antigo) -->
        <div v-if="distribuicaoInconsistente"
             class="flex items-center justify-between gap-4 bg-red-50 border border-red-300 rounded-2xl px-5 py-3 shadow-sm">
            <div class="flex items-center gap-3">
                <AlertTriangle class="w-5 h-5 text-red-500 shrink-0" />
                <div>
                    <p class="text-sm font-black text-red-700">Distribuição inconsistente detectada</p>
                    <p class="text-xs text-red-600 mt-0.5">
                        O estoque físico não condiz com a abertura ajustada. Clique em Corrigir para recalcular.
                    </p>
                </div>
            </div>
            <button @click="corrigirDistribuicao" :disabled="corrigindoDistribuicao"
                    class="shrink-0 flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-black rounded-xl transition-all disabled:opacity-50 shadow-md shadow-red-200">
                <Loader2 v-if="corrigindoDistribuicao" class="w-3.5 h-3.5 animate-spin" />
                <RefreshCw v-else class="w-3.5 h-3.5" />
                {{ corrigindoDistribuicao ? 'Corrigindo...' : 'Corrigir Distribuição' }}
            </button>
        </div>

        <!-- Tabela Progressiva -->
        <div class="bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse min-w-[900px]">
                    <thead>
                        <tr class="bg-slate-900 text-[8px] font-black uppercase text-slate-400 tracking-[0.15em]">
                            <th class="py-2 px-2 sticky left-0 bg-slate-900 z-10 border-b border-slate-700 text-white">Data Mov.</th>
                            <th class="py-2 px-2 border-b border-slate-700 text-right" title="Estoque propagado em cascata">Abertura (L)</th>
                            <th class="py-2 px-2 border-b border-slate-700 text-center bg-blue-900/20 text-brand-accent border-r border-slate-700">Audit. Notas</th>
                            <th class="py-2 px-2 border-b border-slate-700 bg-orange-900/20 border-r border-slate-700 text-center text-orange-400">Saída (Edição)</th>
                            <th class="py-2 px-2 border-b border-slate-700 text-right bg-slate-800 border-r border-slate-700">Estq. Escritural</th>
                            <th class="py-2 px-2 border-b border-slate-700 bg-slate-900/50 border-r border-slate-700 text-center">ANP Perda/Ganho</th>
                            <th class="py-2 px-2 border-b border-slate-700 bg-indigo-900/20 text-center text-indigo-400 border-r border-slate-700">Tanque Físico</th>
                            <th class="py-2 px-2 border-b border-slate-700 text-right font-bold text-white">Diferença</th>
                            <th class="py-2 px-2 border-b border-slate-700 text-center border-l border-slate-700">% Margem</th>
                        </tr>
                    </thead>
                    <tbody class="text-sm font-medium text-slate-600 divide-y divide-slate-100">
                        <template v-for="row in movimentacaoAtiva" :key="row.data_movimento">
                            <!-- Linha Principal -->
                            <tr class="hover:bg-slate-50/80 transition-colors" v-if="row.raiox && row.raiox.estq_abert !== undefined"
                                :class="{
                                    'bg-purple-50 hover:bg-purple-100/80': row[viewMode].is_negativo,
                                    'bg-red-50 hover:bg-red-100/80': row[viewMode].ultrapassou_limite && !row[viewMode].is_negativo
                                }">

                                <td class="py-1.5 px-2 sticky left-0 z-10 border-r border-slate-100 font-bold"
                                    :class="row[viewMode].is_negativo ? 'bg-purple-50 text-purple-700' : row[viewMode].ultrapassou_limite ? 'bg-red-50 text-red-600' : 'bg-white text-slate-800'">
                                    {{ fDate(row.data_movimento) }}
                                </td>

                                <td class="py-1.5 px-2 text-right font-mono text-slate-500 font-semibold bg-slate-50/30">
                                    {{ fNum(row[viewMode].estq_abert) }}
                                    <span v-if="viewMode === 'lab' && parseFloat(row.lab.estq_abert) !== parseFloat(row.estq_abert)" 
                                          class="text-[9px] text-orange-400 block -mt-0.5 leading-none" title="Diferente da abertura original">
                                          Real: {{ fNum(row.estq_abert) }}
                                    </span>
                                </td>
                                
                                
                                <td class="py-1.5 px-2 text-center font-mono bg-blue-50/10 border-r border-blue-100 relative group">
                                    <div class="flex flex-col items-center justify-center gap-1">
                                        <span :class="{'text-red-500 font-black': parseFloat(row.vol_entr_lmc) !== parseFloat(row.volume_nota)}">
                                            {{ fNum(row.volume_nota) }}
                                        </span>
                                        <button v-if="row.nfs_detalhadas && row.nfs_detalhadas.length > 0" 
                                                @click="toggleDay(row.data_movimento)"
                                                class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-all text-[9px] font-bold">
                                            {{ expandedDays.has(row.data_movimento) ? '⬆ Ocultar NFs' : '⬇ Ler NFs' }}
                                        </button>
                                    </div>
                                </td>

                                <!-- Input Editável de SAÍDA -->
                                <td class="py-1.5 px-2 bg-orange-50/20 border-r border-orange-100 align-middle">
                                    <div v-if="viewMode === 'raiox'" class="text-right font-mono font-bold text-slate-600">
                                        {{ fNum(row.raiox.vol_saidas) }}
                                    </div>
                                    <div v-else class="flex flex-col gap-1 items-center justify-center">
                                        <div class="flex items-center bg-white border rounded-lg overflow-hidden transition-colors shadow-inner"
                                            :class="row.lab.is_saida_edited ? 'border-orange-400' : 'border-slate-300'">
                                            <input type="number"
                                                @input="recalcularTudo"
                                                v-model="row.edit_value"
                                                class="w-20 px-1.5 py-0.5 text-right text-xs font-mono font-bold bg-transparent outline-none"
                                                :class="row.lab.is_saida_edited ? 'text-orange-500' : 'text-slate-700'"
                                                step="0.001"
                                            />
                                        </div>
                                        <template v-if="row.lab.is_saida_edited">
                                            <span class="text-[9px] text-slate-400 block font-bold leading-none">
                                                Orig: {{ fNum(row.vol_saidas) }}
                                            </span>
                                            <span class="text-[9px] font-bold leading-none"
                                                :class="(row.edit_value - row.vol_saidas) >= 0 ? 'text-emerald-500' : 'text-red-500'">
                                                Δ {{ (row.edit_value - row.vol_saidas) >= 0 ? '+' : '' }}{{ fNum(row.edit_value - row.vol_saidas) }}
                                            </span>
                                        </template>
                                    </div>
                                </td>
                                                                <td class="py-1.5 px-2 text-right font-mono bg-slate-100/50 border-r border-slate-100" title="Escritural">
                                    <span :class="viewMode === 'lab' ? 'text-slate-700 font-bold' : 'text-slate-400'">
                                        {{ fNum(row[viewMode].estq_escr) }}
                                    </span>
                                </td>

                                <td class="py-1.5 px-2 text-center border-r border-slate-100 bg-slate-50/30">
                                    <div class="flex flex-col gap-0.5">
                                        <template v-if="viewMode === 'raiox'">
                                            <div v-if="row.val_perda > 0" class="text-xs text-red-500 font-bold">-{{ fNum(row.val_perda) }} L</div>
                                            <div v-if="row.val_ganho > 0" class="text-xs text-green-600 font-bold">+{{ fNum(row.val_ganho) }} L</div>
                                            <div v-if="!row.val_perda && !row.val_ganho" class="text-slate-300">---</div>
                                        </template>
                                        <template v-else>
                                            <div v-if="row.lab.val_perda > 0" class="text-xs text-red-600 font-black">-{{ fNum(row.lab.val_perda) }} L*</div>
                                            <div v-if="row.lab.val_ganho > 0" class="text-xs text-emerald-600 font-black">+{{ fNum(row.lab.val_ganho) }} L*</div>
                                            <div v-if="!row.lab.val_perda && !row.lab.val_ganho" class="text-slate-300">---</div>
                                            <span v-if="row.lab.val_perda || row.lab.val_ganho" class="text-[8px] text-slate-400 font-bold">AJUSTE ANP</span>
                                        </template>
                                    </div>
                                </td>
                                
                                <!-- Input Editável de FÍSICO -->
                                <td class="py-1.5 px-2 bg-indigo-50/20 border-r border-indigo-100 align-middle">
                                    <div v-if="viewMode === 'raiox'" class="text-right font-mono font-bold text-slate-600">
                                        {{ fNum(row.raiox.fech_fisico) }}
                                    </div>
                                    <div v-else class="flex flex-col gap-1 items-center justify-center">
                                        <div class="flex items-center bg-white border rounded-lg overflow-hidden transition-colors shadow-inner"
                                            :class="row.lab.is_fisico_edited ? 'border-indigo-400' : 'border-slate-300'">
                                            <input type="number"
                                                @input="recalcularTudo"
                                                v-model="row.fisico_edit_value"
                                                class="w-20 px-1.5 py-0.5 text-right text-xs font-mono font-bold bg-transparent outline-none"
                                                :class="row.lab.is_fisico_edited ? 'text-indigo-500' : 'text-slate-700'"
                                                step="0.001"
                                                title="Altera o tanque real deste dia para regularizar a ANP"
                                            />
                                            <!-- Botão individual salvar -->
                                            <button @click="salvarAjuste(row)" :disabled="savingDate === row.data_movimento"
                                                class="bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 text-[10px] font-black h-full border-l transition-colors disabled:opacity-50">
                                                {{ savingDate === row.data_movimento ? '...' : '✔' }}
                                            </button>
                                        </div>
                                        <span v-if="row.lab.is_fisico_edited" class="text-[9px] text-slate-400 block font-bold leading-none">
                                            Lido: {{ fNum(row.fech_fisico) }}
                                        </span>
                                    </div>
                                </td>

                                <td class="py-1.5 px-2 text-right font-mono" :class="row[viewMode].dif < 0 ? 'text-red-500' : (row[viewMode].dif > 0 ? 'text-emerald-500' : '')">
                                    {{ fNum(Math.abs(row[viewMode].dif)) }} {{ row[viewMode].dif < 0 ? ' ▼' : (row[viewMode].dif > 0 ? ' ▲' : '') }}
                                </td>
                                
                                <td class="py-1.5 px-2 text-center border-l-2 border-slate-200">
                                    <span v-if="row[viewMode].is_negativo"
                                        class="px-2 py-1 rounded-md text-[10px] font-black tracking-widest bg-purple-100 text-purple-700 border border-purple-300 shadow-sm animate-pulse">
                                        NEGATIVO
                                    </span>
                                    <span v-else class="px-2 py-1 rounded-md text-[10px] font-black tracking-widest"
                                        :class="row[viewMode].ultrapassou_limite
                                            ? 'bg-red-100 text-red-600 border border-red-200 shadow-sm'
                                            : 'bg-emerald-100 text-emerald-600 shadow-sm opacity-80'">
                                        {{ fNum(row[viewMode].percentual) }}%
                                    </span>
                                </td>
                            </tr>
                            
                            <!-- Master-Detail Notas Fiscais -->
                            <tr v-if="expandedDays.has(row.data_movimento) && row.nfs_detalhadas && row.nfs_detalhadas.length > 0">
                                <td colspan="9" class="p-0 bg-slate-100 border-b border-slate-300 shadow-inner">
                                    <div class="px-8 py-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNjYmQ1ZTEiLz48L3N2Zz4=')]">
                                        <p class="text-[10px] uppercase font-black tracking-widest text-slate-500 mb-2">Composição Tributária de Entrada (NF-e C100)</p>
                                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            <div v-for="nf in row.nfs_detalhadas" :key="nf.num_doc" class="bg-white border text-left border-slate-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow">
                                                <div class="flex justify-between items-start mb-2">
                                                    <span class="text-[11px] font-black text-slate-400">NF-e Número</span>
                                                    <span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold font-mono">#{{ nf.num_doc }}</span>
                                                </div>
                                                <p class="text-sm font-black text-slate-700 truncate" :title="nf.fornecedor">{{ nf.fornecedor }}</p>
                                                <div class="flex justify-between items-end mt-2 pt-2 border-t border-slate-100">
                                                    <div>
                                                        <p class="text-[9px] text-slate-400 uppercase font-bold">Volume / Quantidade</p>
                                                        <p class="text-xs font-mono font-bold text-brand-accent">{{ fNum(nf.qtd) }} L</p>
                                                    </div>
                                                    <p class="text-[10px] text-slate-400 font-mono">{{ fDate(nf.dt_doc) }}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
            <div class="bg-slate-800 p-4 text-xs text-slate-300 flex items-center justify-between">
                <div>
                    <strong>Engenharia Tributária:</strong> O Macro Distribuidor de Vendas recálcula todo o Estoque Físico gerando falso-positivos indetectáveis aprovados para passar na ANP (Quebra natural entre -0.35% a +0.35%). O Fechamento sempre alimenta a Abertura consecutiva.
                </div>
            </div>
        </div>
    </div>
  </div>

  <!-- ── Modal de Prévia da Sincronização ─────────────────────────────── -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="showSyncModal || syncPreviewLoading"
           class="fixed inset-0 z-50 flex items-center justify-center p-4"
           @click.self="!syncConfirmando && (showSyncModal = false)">

        <!-- Backdrop -->
        <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"></div>

        <!-- Card -->
        <div class="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

          <!-- Loading State -->
          <div v-if="syncPreviewLoading" class="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 class="w-10 h-10 text-brand-accent animate-spin" />
            <p class="text-sm font-bold text-slate-500 uppercase tracking-widest">Calculando distribuição...</p>
          </div>

          <template v-else-if="syncPreviews.length">
            <!-- Header -->
            <div class="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h2 class="text-lg font-black text-slate-800 tracking-tight">Prévia da Sincronização</h2>
                  <p class="text-xs text-slate-400 mt-0.5">Revise as alterações antes de confirmar. Esta ação redistribuirá as vendas do mês.</p>
                </div>
                <button @click="showSyncModal = false" :disabled="syncConfirmando"
                        class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-all shrink-0">
                  <XCircle class="w-4 h-4" />
                </button>
              </div>

              <!-- Abas por produto -->
              <div v-if="syncPreviews.length > 1" class="flex gap-1.5 mt-4 overflow-x-auto pb-0.5">
                <button v-for="(p, i) in syncPreviews" :key="p.cod_item"
                        @click="syncAbaAtiva = i; syncDiasExpandido = false"
                        class="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border whitespace-nowrap"
                        :class="syncAbaAtiva === i
                          ? 'bg-brand-accent text-white border-brand-accent'
                          : 'bg-white text-slate-400 border-slate-200 hover:border-brand-accent hover:text-brand-accent'">
                  {{ p.nome }}
                </button>
              </div>
            </div>

            <!-- Corpo scrollável -->
            <div class="overflow-y-auto flex-1 px-6 py-5 space-y-4"
                 v-if="syncPreviews[syncAbaAtiva]">
              <div :key="syncAbaAtiva">

                <!-- Tabela Antes × Depois -->
                <div class="rounded-2xl border border-slate-200 overflow-hidden">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="bg-slate-50 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                        <th class="px-4 py-3 text-left"></th>
                        <th class="px-4 py-3 text-right text-slate-500">ANTES</th>
                        <th class="px-4 py-3 text-right text-brand-accent">DEPOIS</th>
                        <th class="px-4 py-3 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <tr v-for="linha in [
                        { label: 'Abertura do mês',   antes: syncPreviews[syncAbaAtiva].resumo.abertura_antes,   depois: syncPreviews[syncAbaAtiva].resumo.abertura_depois },
                        { label: 'Total de vendas',   antes: syncPreviews[syncAbaAtiva].resumo.vendas_antes,     depois: syncPreviews[syncAbaAtiva].resumo.vendas_depois },
                        { label: 'Fechamento do mês', antes: syncPreviews[syncAbaAtiva].resumo.fechamento_antes, depois: syncPreviews[syncAbaAtiva].resumo.fechamento_depois },
                      ]" :key="linha.label">
                        <td class="px-4 py-2.5 text-xs font-bold text-slate-600">{{ linha.label }}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-xs text-slate-400 line-through">{{ fNum(linha.antes) }} L</td>
                        <td class="px-4 py-2.5 text-right font-mono text-xs font-black text-slate-800">{{ fNum(linha.depois) }} L</td>
                        <td class="px-4 py-2.5 text-right font-mono text-[11px] font-black"
                            :class="(linha.depois - linha.antes) === 0 ? 'text-slate-300'
                                  : (linha.depois - linha.antes) > 0 ? 'text-emerald-600' : 'text-red-500'">
                          {{ (linha.depois - linha.antes) === 0 ? '—'
                           : ((linha.depois - linha.antes) > 0 ? '+' : '') + fNum(linha.depois - linha.antes) + ' L' }}
                        </td>
                      </tr>
                      <tr v-if="syncPreviews[syncAbaAtiva].resumo.capacidade > 0" class="bg-slate-50/50">
                        <td class="px-4 py-2 text-[10px] text-slate-400">Capacidade do tanque</td>
                        <td colspan="3" class="px-4 py-2 text-right font-mono text-[10px] text-slate-400">{{ fNum(syncPreviews[syncAbaAtiva].resumo.capacidade) }} L</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Avisos de ajuste automático -->
                <div v-if="syncPreviews[syncAbaAtiva].ajustes.length"
                     class="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1.5">
                  <p class="text-[10px] font-black text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle class="w-3.5 h-3.5" /> Ajustes automáticos aplicados
                  </p>
                  <p v-for="a in syncPreviews[syncAbaAtiva].ajustes" :key="a"
                     class="text-xs text-amber-700 pl-5">• {{ a }}</p>
                </div>
                <div v-else class="flex items-center gap-2 text-xs text-emerald-600 font-bold px-1">
                  <CheckCircle2 class="w-4 h-4" />
                  Distribuição viável — nenhum ajuste necessário.
                </div>

                <!-- Detalhes por dia (colapsável) -->
                <div class="border border-slate-200 rounded-2xl overflow-hidden">
                  <button @click="syncDiasExpandido = !syncDiasExpandido"
                          class="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                    <span>Ver distribuição por dia ({{ syncPreviews[syncAbaAtiva].dias.length }} registros)</span>
                    <ChevronDown v-if="!syncDiasExpandido" class="w-4 h-4 text-slate-400" />
                    <ChevronUp v-else class="w-4 h-4 text-slate-400" />
                  </button>
                  <div v-if="syncDiasExpandido" class="overflow-x-auto border-t border-slate-100">
                    <table class="w-full text-[11px]">
                      <thead>
                        <tr class="bg-slate-50 text-[9px] font-black uppercase text-slate-400 tracking-widest">
                          <th class="px-3 py-2 text-left">Data</th>
                          <th class="px-3 py-2 text-right">Vendas Antes</th>
                          <th class="px-3 py-2 text-right text-brand-accent">Vendas Depois</th>
                          <th class="px-3 py-2 text-right">Estq. Antes</th>
                          <th class="px-3 py-2 text-right text-brand-accent">Estq. Depois</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-slate-50">
                        <tr v-for="dia in syncPreviews[syncAbaAtiva].dias" :key="dia.data"
                            :class="Math.abs(dia.vendas_depois - dia.vendas_antes) > 0.01 ? 'bg-amber-50/40' : ''">
                          <td class="px-3 py-1.5 font-mono text-slate-500">
                            {{ new Date(dia.data).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' }) }}
                          </td>
                          <td class="px-3 py-1.5 text-right font-mono text-slate-400">{{ fNum(dia.vendas_antes) }}</td>
                          <td class="px-3 py-1.5 text-right font-mono font-bold"
                              :class="Math.abs(dia.vendas_depois - dia.vendas_antes) > 0.01 ? 'text-amber-600' : 'text-slate-600'">
                            {{ fNum(dia.vendas_depois) }}
                          </td>
                          <td class="px-3 py-1.5 text-right font-mono text-slate-400">{{ fNum(dia.estoque_antes) }}</td>
                          <td class="px-3 py-1.5 text-right font-mono font-bold text-slate-700">{{ fNum(dia.estoque_depois) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-4 shrink-0 bg-slate-50/50">
              <p class="text-[10px] text-slate-400 font-medium">
                {{ syncPreviews.length > 1 ? `${syncPreviews.length} produtos serão sincronizados.` : '' }}
              </p>
              <div class="flex items-center gap-3">
                <button @click="showSyncModal = false" :disabled="syncConfirmando"
                        class="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-100 transition-all disabled:opacity-50">
                  Cancelar
                </button>
                <button @click="confirmarSincronizacao" :disabled="syncConfirmando"
                        class="px-6 py-2.5 rounded-xl bg-brand-accent text-white text-sm font-black hover:scale-[1.02] transition-all shadow-lg shadow-brand-accent/20 disabled:opacity-50 flex items-center gap-2">
                  <Loader2 v-if="syncConfirmando" class="w-4 h-4 animate-spin" />
                  <CheckCircle2 v-else class="w-4 h-4" />
                  {{ syncConfirmando ? 'Aplicando...' : 'Confirmar Sincronização' }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.4s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
input[type=number]::-webkit-inner-spin-button, 
input[type=number]::-webkit-outer-spin-button { 
  -webkit-appearance: none; 
  margin: 0; 
}
</style>
