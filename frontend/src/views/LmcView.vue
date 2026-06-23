<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios'
import { API_BASE_URL } from '../api';
import { arquivoInfo, setArquivoInfo, setEmpresaSelecionada, empresaSelecionada } from '../store';
import { ArrowLeft, Database, Loader2, FileX, Settings, Save, DownloadCloud, AlertTriangle, Eye, Beaker, ChevronDown, ChevronUp, CheckCircle2, XCircle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import UiButton from '../components/ui/UiButton.vue';

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
const otimizadorMsg = ref('');
const pendingGravar = ref(false);

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
    await carregarPeriodos();
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
        const fuelAnterior = selectedFuel.value;
        await loadData(currentArquivoId.value);
        if (fuelAnterior) selectedFuel.value = fuelAnterior;
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
    // Usa a primeira linha com dados reais do LMC (ignora linhas fantasmas do FULL OUTER JOIN)
    const firstRow = movimentacaoAtiva.value.find(r => r.has_lmc_row) || movimentacaoAtiva.value[0];
    const novoEstoque = firstRow.estq_abert_ajustado !== null
        ? parseFloat(firstRow.estq_abert_ajustado)
        : parseFloat(firstRow.estq_abert || 0);
    const nome = combustiveis.value.find(c => c.cod_item === selectedFuel.value)?.nome_combustivel || selectedFuel.value;
    await abrirPreviewSincronizacao([{ cod_item: selectedFuel.value, fechamento_anterior: novoEstoque, nome }]);
}

function sincronizarTodos() {
    abrirPreviewSincronizacao(continuidade.value.divergencias);
}

// Cancela requests anteriores ao navegar rapidamente
let abortController = null;

async function loadData(arquivoId) {
    if (!arquivoId) return;

    // Cancela qualquer carregamento anterior em andamento
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    currentArquivoId.value = arquivoId;
    loading.value = true;
    selectedFuel.value = null;
    lmcData.value = [];
    try {
        // Atualiza contexto da store para que exportação e header usem o arquivo correto
        if (!arquivoInfo.value || arquivoInfo.value.id != arquivoId) {
            try {
                const infoRes = await axios.get(`${API_BASE_URL}/api/arquivo/info/${arquivoId}`, { signal });
                setArquivoInfo(infoRes.data);
            } catch (e) { if (axios.isCancel(e)) return; }
        }
        const response = await axios.get(`${API_BASE_URL}/api/lmc/${arquivoId}`, { timeout: 60000, signal });
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
        await recalcularTudo();
        await checkContinuidade();
    } catch (error) {
        if (axios.isCancel(error)) return; // Navegação cancelou este request — ignorar
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
    // Só inclui cod_item que tenha ao menos 1 linha real no 1300 (has_lmc_row = true)
    // Impede que aditivos/lubrificantes cujo nome contém "GASOLINA" ou "DIESEL" apareçam no seletor
    const codItensComLmc = new Set(lmcData.value.filter(i => i.has_lmc_row === true).map(i => i.cod_item));
    lmcData.value
        .filter(item =>
            COMBUSTIVEIS_KEYWORDS.some(k => (item.nome_combustivel || '').toUpperCase().includes(k)) &&
            codItensComLmc.has(item.cod_item)
        )
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
    try {
        const uniqueCodes = [...new Set(lmcData.value.map(i => i.cod_item))];
        for (const code of uniqueCodes) {
            const fuelName = lmcData.value.find(i => i.cod_item === code)?.nome_combustivel || code;
            processingStatus.value = `Processando ${fuelName}...`;
            await new Promise(resolve => setTimeout(resolve, 0));

            const items = lmcData.value.filter(i => i.cod_item === code)
                .sort((a,b) => new Date(a.data_movimento) - new Date(b.data_movimento));

            let runningAberturaLab = null;
            let cascadeModified = false; // true a partir do dia em que algo mudou

            items.forEach((row) => {
                const aberturaSped = parseFloat(row.estq_abert || 0);
                const entradas = parseFloat(row.vol_entr_lmc || 0);
                const saidaSped = parseFloat(row.vol_saidas || 0);
                const fisicoSped = parseFloat(row.fech_fisico || 0);

                // Linhas fantasmas (só NF sem LMC correspondente): exibe dados mas não entra na cascata
                // Só filtra quando has_lmc_row for explicitamente false (campo novo da API v2)
                if (row.has_lmc_row === false) {
                    row.raiox = { estq_abert: 0, vol_entr: 0, vol_saidas: 0, estq_escr: 0, fech_fisico: 0, dif: 0, percentual: 0, ultrapassou_limite: false, is_negativo: false };
                    row.lab = { estq_abert: 0, vol_entr: 0, vol_saidas: 0, estq_escr: 0, fech_fisico: 0, val_perda: 0, val_ganho: 0, dif: 0, percentual: 0, ultrapassou_limite: false, is_negativo: false, is_saida_edited: false, is_fisico_edited: false, is_entr_edited: false };
                    return; // não atualiza runningAberturaLab
                }

                // MOTOR 1: RAIO-X
                const escrRaioX = aberturaSped + entradas - saidaSped;
                const difTeoricaRaioX = fisicoSped - escrRaioX;
                const percentualRaioX = fisicoSped > 0 ? (Math.abs(difTeoricaRaioX) / fisicoSped) * 100 : 0;
                row.raiox = {
                    estq_abert: aberturaSped,
                    vol_entr: entradas,
                    vol_saidas: saidaSped,
                    estq_escr: escrRaioX,
                    fech_fisico: fisicoSped,
                    dif: difTeoricaRaioX,
                    percentual: percentualRaioX,
                    ultrapassou_limite: fisicoSped > 0 && percentualRaioX >= 0.61,
                    is_negativo: escrRaioX < -0.01 || fisicoSped < -0.01
                };

                // MOTOR 2: LABORATÓRIO (Cascata Dinâmica)
                const entrLab = row.vol_entr_ajustado !== null ? parseFloat(row.vol_entr_ajustado) : entradas;

                // Preferir abertura salva pelo banco (pós-Redistribuir/Otimizar).
                // runningAberturaLab só é usado quando não há âncora do banco, para propagar
                // edições manuais. Isso evita falso drift em cenários de múltiplos tanques
                // ou após Otimizar/Redistribuir ter gravado valores corretos.
                const abertAjDB = (row.estq_abert_ajustado !== null && row.estq_abert_ajustado !== undefined)
                    ? parseFloat(row.estq_abert_ajustado)
                    : null;
                const aberturaLab = abertAjDB !== null
                    ? abertAjDB
                    : (runningAberturaLab !== null ? runningAberturaLab : aberturaSped);

                const saidaBaseDB = (row.vol_saidas_ajustado !== null && row.vol_saidas_ajustado !== undefined)
                    ? parseFloat(row.vol_saidas_ajustado)
                    : saidaSped;
                const saidaLab = parseFloat(row.edit_value ?? saidaBaseDB);
                const volumeBaseLab = aberturaLab + entrLab;
                const escrLab = Math.max(0, aberturaLab + entrLab - saidaLab);

                const saidaManualEdit = Math.abs(saidaLab - saidaBaseDB) > 0.001;
                const fisicoBaseDB = (row.fech_fisico_ajustado !== null && row.fech_fisico_ajustado !== undefined)
                    ? parseFloat(row.fech_fisico_ajustado)
                    : fisicoSped;
                const fisicoManualEdit = Math.abs(parseFloat(row.fisico_edit_value ?? fisicoBaseDB) - fisicoBaseDB) > 0.001;
                // aberturaAlterada: só verifica quando não há âncora do banco — evita falso positivo
                // ao comparar runningAberturaLab (de outro tanque ou dia) com estq_abert_ajustado.
                const aberturaAlterada = abertAjDB === null
                    && runningAberturaLab !== null
                    && Math.abs(runningAberturaLab - aberturaSped) > 0.001;
                if (saidaManualEdit || fisicoManualEdit || aberturaAlterada) cascadeModified = true;

                let fisicoLab;
                if (cascadeModified) {
                    // Cascata manual: recalcula físico usando perda/ganho ajustados (ou originais) escalados
                    // Cap correto para % = |diff| / físico ≤ 0,60%:
                    //   perda: perdaNova / (escrLab − perdaNova) ≤ 0.006 → cap = escrLab × 0.006/1.006
                    //   ganho: ganhoNovo / (escrLab + ganhoNovo) ≤ 0.006 → cap = escrLab × 0.006/0.994
                    const perdaRef = parseFloat((row.val_perda_ajustado ?? row.val_perda) || 0);
                    const ganhoRef = parseFloat((row.val_ganho_ajustado ?? row.val_ganho) || 0);
                    const baseOriginal = Math.max(0.001, aberturaSped + entradas);
                    const fator = volumeBaseLab / baseOriginal;
                    const capPerda = escrLab * (0.006 / 1.006);
                    const capGanho = escrLab * (0.006 / 0.994);
                    const perdaNova = Math.min(perdaRef * fator, capPerda);
                    const ganhoNovo = Math.min(ganhoRef * fator, capGanho);
                    fisicoLab = Math.max(0, escrLab + ganhoNovo - perdaNova);
                    row.fisico_edit_value = parseFloat(fisicoLab.toFixed(3));
                } else {
                    // Banco já calculou: honra fech_fisico_ajustado diretamente
                    fisicoLab = parseFloat(row.fisico_edit_value ?? fisicoBaseDB);
                }

                const difBruta = fisicoLab - escrLab;
                const perdaLab = difBruta < 0 ? Math.abs(difBruta) : 0;
                const ganhoLab = difBruta > 0 ? difBruta : 0;
                const percentualLab = fisicoLab > 0 ? (Math.abs(difBruta) / fisicoLab) * 100 : 0;
                row.lab = {
                    estq_abert: aberturaLab,
                    vol_entr: entrLab,
                    vol_saidas: saidaLab,
                    estq_escr: escrLab,
                    fech_fisico: fisicoLab,
                    val_perda: perdaLab,
                    val_ganho: ganhoLab,
                    dif: difBruta,
                    percentual: percentualLab,
                    ultrapassou_limite: fisicoLab > 0 && percentualLab >= 0.61,
                    is_negativo: escrLab < -0.01 || fisicoLab < -0.01,
                    is_saida_edited: parseFloat(saidaLab).toFixed(3) !== saidaSped.toFixed(3),
                    is_fisico_edited: parseFloat(fisicoLab).toFixed(3) !== fisicoSped.toFixed(3),
                    is_entr_edited: parseFloat(entrLab).toFixed(3) !== entradas.toFixed(3)
                };

                runningAberturaLab = fisicoLab;
            });
        }
    } finally {
        loading.value = false;
        processingStatus.value = '';
    }
}


// Filtra pra UI e já pega calculados
const movimentacaoAtiva = computed(() => {
    if (!selectedFuel.value) return [];
    return lmcData.value.filter(item => item.cod_item === selectedFuel.value)
        .sort((a,b) => new Date(a.data_movimento) - new Date(b.data_movimento));
});

// Detecta inconsistência: a cascata do frontend produz abertura diferente do que o banco salvou.
// Isso indica que os ajustes automáticos (Corrigir/Otimizador) estão dessincronizados com as
// edições manuais subsequentes do usuário.
const distribuicaoInconsistente = computed(() => {
    if (viewMode.value !== 'lab' || !movimentacaoAtiva.value.length) return false;
    return movimentacaoAtiva.value.some(row => {
        if (!row.lab || row.has_lmc_row === false) return false;
        if (row.estq_abert_ajustado === null || row.estq_abert_ajustado === undefined) return false;
        const abertSalva = parseFloat(row.estq_abert_ajustado);
        const abertLab = parseFloat(row.lab?.estq_abert || 0);
        return Math.abs(abertSalva - abertLab) > 1.0; // divergência > 1L
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

async function rodarAutoOtimizador() {
    savingMacro.value = true;
    try {
        const arquivoId = route.params.id || arquivoInfo.value?.id;
        const response = await axios.post(`${API_BASE_URL}/api/lmc/otimizador-matematico`, {
            id_arquivo: arquivoId,
            cod_item: selectedFuel.value,
            auto: true
        });
        if (response.data.success) {
            otimizadorMsg.value = "Auto-Otimizado: todos os dias ≤ 0,60% ANP. " + (response.data.message || '');
            viewMode.value = 'lab';
            await loadData(arquivoId);
        }
    } catch (error) {
        console.error("Erro no auto-otimizador:", error);
        alert("Falha ao processar auto-otimização.");
    } finally {
        savingMacro.value = false;
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
            otimizadorMsg.value = response.data.message + (response.data.estouro_tanque ? " ⚠️ O teto do tanque foi atingido em alguns dias." : "");
            showOptimizerModal.value = false;
            viewMode.value = 'lab';
            await loadData(arquivoId);
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
    calc.variacaoLiquida = calc.perdasTotal - calc.ganhosTotal;
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

// Salva a venda editada e propaga a cascata para todos os dias seguintes no banco
async function salvarSaidaComCascata(row) {
    const id_sped = route.params.id || arquivoInfo.value?.id;
    savingDate.value = row.data_movimento;
    try {
        await axios.post(`${API_BASE_URL}/api/lmc/ajustar-cascata`, {
            id_sped,
            cod_item: row.cod_item,
            data_mov: row.data_movimento,
            vol_saidas_ajustado: parseFloat(row.edit_value)
        });
        // Recarga silenciosa: atualiza os dados sem exibir o overlay de loading
        const response = await axios.get(`${API_BASE_URL}/api/lmc/${id_sped}`);
        response.data.forEach(serverRow => {
            const local = lmcData.value.find(r =>
                r.cod_item === serverRow.cod_item &&
                r.data_movimento === serverRow.data_movimento
            );
            if (local) {
                local.estq_abert_ajustado = serverRow.estq_abert_ajustado;
                local.vol_saidas_ajustado = serverRow.vol_saidas_ajustado;
                local.fech_fisico_ajustado = serverRow.fech_fisico_ajustado;
                local.vol_escr_ajustado = serverRow.vol_escr_ajustado;
                local.val_perda_ajustado = serverRow.val_perda_ajustado;
                local.val_ganho_ajustado = serverRow.val_ganho_ajustado;
                local.edit_value = serverRow.vol_saidas_ajustado !== null ? serverRow.vol_saidas_ajustado : serverRow.vol_saidas;
                local.fisico_edit_value = serverRow.fech_fisico_ajustado !== null ? serverRow.fech_fisico_ajustado : serverRow.fech_fisico;
            }
        });
        await recalcularTudo();
    } catch (error) {
        alert('Erro ao salvar com cascata: ' + (error.response?.data?.error || error.message));
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


function salvarLoteRateio() {
    pendingGravar.value = true;
}

async function confirmarGravar() {
    pendingGravar.value = false;
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
        otimizadorMsg.value = 'Rateio em Lote salvo com sucesso! Toda a margem ANP foi calculada.';
        metaVendas.value = '';
    } catch (error) {
        otimizadorMsg.value = 'Erro ao salvar em lote.';
    } finally {
        savingMacro.value = false;
    }
}

// Quando trocar combustível, rodar cálculo
watch(selectedFuel, () => recalcularTudo());

// ── Navegação entre períodos (sem sair da página) ──
const periodosEmpresa = ref([]);  // [{ id, periodo, label }] ordenados cronologicamente
const idxPeriodoAtual = computed(() => periodosEmpresa.value.findIndex(p => p.id == currentArquivoId.value));
const periodoAnterior = computed(() => idxPeriodoAtual.value > 0 ? periodosEmpresa.value[idxPeriodoAtual.value - 1] : null);
const periodoSeguinte = computed(() => idxPeriodoAtual.value >= 0 && idxPeriodoAtual.value < periodosEmpresa.value.length - 1 ? periodosEmpresa.value[idxPeriodoAtual.value + 1] : null);

async function carregarPeriodos() {
    try {
        const idEmpresa = empresaSelecionada.value?.id || arquivoInfo.value?.id_empresa;
        if (!idEmpresa) return;
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/arquivos/${idEmpresa}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        periodosEmpresa.value = (res.data || [])
            .filter(a => a.periodo_apuracao)
            .map(a => {
                const p = a.periodo_apuracao;
                const m = p.substring(5, 7);
                const y = p.substring(0, 4);
                const meses = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                return { id: a.id, periodo: p, label: `${meses[parseInt(m)] || m}/${y}`, sort: `${y}-${m}` };
            })
            .sort((a, b) => a.sort.localeCompare(b.sort));
    } catch (e) { /* silencioso */ }
}

function navPeriodo(arquivo) {
    if (!arquivo) return;
    router.push(`/lmc/${arquivo.id}`);
}

// Recarrega dados ao navegar entre meses sem desmontar o componente
watch(() => route.params.id, (newId) => {
    if (newId) loadData(newId);
});

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
            link.href = reader.result;
            // Usar nome do header Content-Disposition do servidor (se disponível)
            const disposition = response.headers['content-disposition'] || '';
            const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            let nomeExport = filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/['"]/g, '')) : '';
            if (!nomeExport) {
                const cnpjLimpo = String(arquivoInfo.value?.cnpj || '').replace(/\D/g, '');
                const partes = String(arquivoInfo.value?.periodo || '').split(' a ');
                const periodoIni = (partes[0] || '').replace(/\D/g, '');
                const periodoFim = (partes[1] || partes[0] || '').replace(/\D/g, '');
                nomeExport = cnpjLimpo && periodoIni
                    ? `${cnpjLimpo}_${periodoIni}_${periodoFim}.txt`
                    : `SPED_FISCAL_${arquivoInfo.value?.nome_arquivo || 'exportado'}.txt`;
            }
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
    <header class="flex flex-col md:flex-row justify-between md:items-end gap-4 border-b border-line pb-5">
      <div class="space-y-1">
        <button @click="router.push('/analisador/' + route.params.id)" class="text-[11px] uppercase tracking-wide font-medium text-bronze hover:opacity-80 mb-1 flex items-center gap-1 group">
          <ArrowLeft class="w-3 h-3 group-hover:-translate-x-1 transition-transform" :stroke-width="1.8" /> Voltar para o Analisador
        </button>
        <h1 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink flex items-center gap-2.5">
          <Database class="w-6 h-6 text-bronze" :stroke-width="1.7" /> LMC Diário Fiscal
        </h1>
        <p class="text-[13px] text-risco">Inspeção interativa de recálculo de inventário e camuflagem de Quebra ANP.</p>
      </div>
      <div v-if="arquivoInfo" class="flex flex-col md:items-end gap-1 max-w-sm">
        <p class="font-display text-[16px] font-semibold text-ink leading-tight md:text-right">
          {{ arquivoInfo?.empresa || empresaSelecionada?.nome_empresa || '—' }}
        </p>
        <p class="text-[12px] font-mono text-risco">
          CNPJ {{ arquivoInfo?.cnpj || empresaSelecionada?.cnpj || '' }}
        </p>
        <div class="mt-1 flex items-center gap-1.5">
          <button
            @click="navPeriodo(periodoAnterior)"
            :disabled="!periodoAnterior"
            :title="periodoAnterior ? `← ${periodoAnterior.label}` : 'Sem período anterior'"
            class="w-7 h-7 rounded-md border flex items-center justify-center transition-colors"
            :class="periodoAnterior ? 'bg-sheet border-line hover:bg-bronze hover:text-white hover:border-bronze text-risco cursor-pointer' : 'bg-paper border-line text-line cursor-not-allowed'"
          >
            <ChevronLeft class="w-4 h-4" :stroke-width="1.8" />
          </button>

          <select
            v-if="periodosEmpresa.length > 1"
            :value="currentArquivoId"
            @change="navPeriodo(periodosEmpresa.find(p => p.id == $event.target.value))"
            class="text-[13px] font-medium font-mono text-bronze bg-bronze/10 border border-bronze/20 px-3 py-1 rounded-md appearance-none text-center cursor-pointer hover:bg-bronze/15 transition-colors outline-none"
          >
            <option v-for="p in periodosEmpresa" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
          <span v-else class="text-[13px] font-medium font-mono text-bronze bg-bronze/10 border border-bronze/20 px-3 py-1 rounded-md">
            {{ arquivoInfo.periodo }}
          </span>

          <button
            @click="navPeriodo(periodoSeguinte)"
            :disabled="!periodoSeguinte"
            :title="periodoSeguinte ? `${periodoSeguinte.label} →` : 'Sem período seguinte'"
            class="w-7 h-7 rounded-md border flex items-center justify-center transition-colors"
            :class="periodoSeguinte ? 'bg-sheet border-line hover:bg-bronze hover:text-white hover:border-bronze text-risco cursor-pointer' : 'bg-paper border-line text-line cursor-not-allowed'"
          >
            <ChevronRight class="w-4 h-4" :stroke-width="1.8" />
          </button>
        </div>
      </div>
    </header>

    <div v-if="loading" class="py-20 flex flex-col justify-center items-center text-center">
      <Loader2 class="w-9 h-9 animate-spin text-bronze mb-4" :stroke-width="1.7" />
      <p class="text-[13px] text-risco">{{ processingStatus || 'Processando fechamentos e encadeamento em cascata...' }}</p>

    </div>

    <div v-else-if="lmcData.length === 0" class="bg-sheet rounded-md p-16 flex flex-col items-center justify-center text-center border border-line card-shadow">
        <div class="w-16 h-16 bg-paper rounded-md border border-line flex justify-center items-center mb-5">
           <FileX class="w-7 h-7 text-line" :stroke-width="1.5" />
        </div>
        <h3 class="font-display text-[15px] font-semibold text-ink">Nenhum dado de LMC (Bloco 1300) encontrado.</h3>
        <p class="text-[13px] text-risco mt-1">Este SPED não possui registros consolidados mensais.</p>
    </div>

    <div v-else class="space-y-4">
        <!-- Dashboard Macro - SLIM VERSION -->
        <div class="bg-graphite px-5 py-3 rounded-md flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="flex items-center gap-3 flex-1">
                <div class="bg-bronze/15 p-2 rounded-md">
                   <Settings class="w-5 h-5 text-bronze" :stroke-width="1.7" />
                </div>
                <div>
                   <h3 class="font-display font-semibold text-[14px] text-white">Distribuição Inteligente</h3>
                   <p class="text-[11px] text-muted leading-tight">Rateio proporcional ANP (±0.35%) e camuflagem de quebras no Banco de Dados.</p>
                </div>
            </div>

            <div class="flex items-center flex-wrap gap-2">
                <button @click="rodarAutoOtimizador" :disabled="savingMacro"
                    title="Distribui automaticamente as vendas do mês garantindo todos os dias ≤ 0,60% ANP"
                    class="bg-conforme hover:opacity-85 text-white px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-opacity disabled:opacity-50 flex items-center gap-1.5">
                    <Loader2 v-if="savingMacro" class="w-3 h-3 animate-spin" />
                    <RefreshCw v-else class="w-3 h-3" :stroke-width="1.8" />
                    AUTO
                </button>
                <div class="relative group">
                    <input type="number" v-model="volumeAlvo" placeholder="Meta Volume (L)"
                        class="w-32 px-3 py-1.5 rounded-md border border-graphite-4 bg-graphite-2 text-white text-[12px] font-mono outline-none focus:border-bronze transition-colors text-right" />
                </div>
                <button @click="rodarOtimizador" :disabled="savingMacro"
                    class="bg-bronze hover:opacity-85 text-white px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-opacity disabled:opacity-50 flex items-center gap-1.5">
                    <Loader2 v-if="savingMacro" class="w-3 h-3 animate-spin" />
                    OTIMIZAR 1300
                </button>
                <div class="w-px h-6 bg-graphite-4 mx-1"></div>
                <button @click="salvarLoteRateio" :disabled="savingMacro"
                    class="bg-graphite-2 border border-graphite-4 hover:bg-graphite-4 text-line px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5">
                    <Save v-if="!savingMacro" class="w-3 h-3" :stroke-width="1.8" />
                    GRAVAR
                </button>
                <UiButton @click="exportarSped" class="text-[12px]">
                    <DownloadCloud class="w-3.5 h-3.5" :stroke-width="1.8" /> EXPORTAR SPED
                </UiButton>
            </div>
        </div>

        <!-- Totais Dashboards - COMPACT CARDS -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <!-- Card destaque: compras do combustível selecionado -->
            <div class="bg-graphite px-4 py-3 rounded-md col-span-1">
                <p class="text-[10px] font-medium text-muted uppercase tracking-wide truncate">
                    Compras · {{ combustiveis.find(c => c.cod_item === selectedFuel)?.nome || '—' }}
                </p>
                <p class="font-mono text-[20px] font-semibold text-white mt-1 break-all">{{ fNum(totais.comprasTotal) }} <span class="text-[10px] text-muted">L</span></p>
                <p v-if="Math.abs(totais.comprasTotal - totais.nfsTotal) > 0.01" class="text-[10px] font-medium text-variacao mt-0.5">
                    ⚠ NF-e: {{ fNum(totais.nfsTotal) }} L
                </p>
                <p v-else class="text-[10px] text-conforme mt-0.5">✓ NF-e conferida</p>
            </div>
            <!-- Card variação líquida (perdas - ganhos) -->
            <div class="bg-sheet px-4 py-3 rounded-md border transition-colors card-shadow"
                 :class="totais.variacaoLiquida > 0 ? 'border-lacre/30' : totais.variacaoLiquida < 0 ? 'border-conforme/30' : 'border-line'">
                <p class="text-[10px] uppercase tracking-wide font-medium"
                   :class="totais.variacaoLiquida > 0 ? 'text-lacre' : totais.variacaoLiquida < 0 ? 'text-conforme' : 'text-risco'">
                    {{ viewMode === 'lab' ? 'Variação Lab.' : 'Variação RX' }}
                </p>
                <p class="font-mono text-[18px] font-semibold mt-1 break-all"
                   :class="totais.variacaoLiquida > 0 ? 'text-lacre' : totais.variacaoLiquida < 0 ? 'text-conforme' : 'text-risco'">
                    {{ totais.variacaoLiquida > 0 ? '-' : totais.variacaoLiquida < 0 ? '+' : '' }}{{ fNum(Math.abs(totais.variacaoLiquida)) }}
                    <span class="text-[10px]">L</span>
                </p>
                <p class="text-[10px] text-risco mt-0.5">
                    {{ totais.variacaoLiquida > 0 ? 'Perda líquida' : totais.variacaoLiquida < 0 ? 'Ganho líquido' : 'Sem variação' }}
                </p>
            </div>
            <div class="bg-sheet px-4 py-3 rounded-md border border-line card-shadow">
                <p class="text-[10px] font-medium text-risco uppercase tracking-wide">NF-e Entradas</p>
                <div class="flex items-center gap-1.5 mt-1">
                    <p class="font-mono text-[18px] font-semibold text-ink break-all">{{ fNum(totais.nfsTotal) }} <span class="text-[10px] text-risco">L</span></p>
                    <AlertTriangle v-if="Math.abs(totais.nfsTotal - totais.comprasTotal) > 0.01" class="w-3.5 h-3.5 text-variacao" :stroke-width="1.8" />
                </div>
            </div>
            <div class="bg-sheet px-4 py-3 rounded-md border border-line card-shadow">
                <p class="text-[10px] font-medium text-risco uppercase tracking-wide">Vendas Brutas</p>
                <p class="font-mono text-[18px] font-semibold text-ink mt-1 break-all">{{ fNum(totais.vendasDeclaradas) }} <span class="text-[10px] text-risco">L</span></p>
            </div>
            <div class="bg-paper px-4 py-3 rounded-md border border-bronze/30 card-shadow">
                <p class="text-[10px] font-medium text-bronze uppercase tracking-wide">Vendas Auditoria</p>
                <p class="font-mono text-[18px] font-semibold text-bronze mt-1 break-all">{{ fNum(totais.vendasAjustadas) }} <span class="text-[10px]">L</span></p>
                <p v-if="Math.abs(totais.vendasAjustadas - totais.vendasDeclaradas) > 0.01" class="text-[10px] font-medium text-bronze/80 mt-1 uppercase">
                    Δ: {{ fNum(totais.vendasAjustadas - totais.vendasDeclaradas) }} L
                </p>
            </div>
        </div>

        <!-- Toast de sucesso do Otimizador 1300 -->
        <div v-if="otimizadorMsg" class="flex items-center justify-between gap-4 bg-conforme/[0.07] border border-conforme/30 rounded-md px-5 py-3">
            <div class="flex items-center gap-3">
                <CheckCircle2 class="w-4 h-4 text-conforme shrink-0" :stroke-width="1.8" />
                <p class="text-[13px] font-medium text-conforme">{{ otimizadorMsg }}</p>
            </div>
            <button @click="otimizadorMsg = ''" class="shrink-0 px-3.5 py-1.5 bg-conforme hover:opacity-85 text-white text-[12px] font-medium rounded-md transition-opacity">
                FECHAR
            </button>
        </div>

        <!-- Confirmação do GRAVAR -->
        <div v-if="pendingGravar" class="flex items-center justify-between gap-4 bg-variacao/[0.08] border border-variacao/30 rounded-md px-5 py-3">
            <div class="flex items-center gap-3">
                <AlertTriangle class="w-4 h-4 text-variacao shrink-0" :stroke-width="1.8" />
                <p class="text-[13px] font-medium text-variacao">Isso reescreverá a auditoria deste combustível e salvará todas as quebras mascaradas. Confirmar?</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button @click="pendingGravar = false" class="px-3.5 py-1.5 border border-line text-risco text-[12px] font-medium rounded-md hover:bg-paper transition-colors">CANCELAR</button>
                <button @click="confirmarGravar" class="px-3.5 py-1.5 bg-variacao hover:opacity-85 text-white text-[12px] font-medium rounded-md transition-opacity">CONFIRMAR</button>
            </div>
        </div>

        <!-- Banner de Continuidade de Estoque -->
        <div v-if="continuidade.divergencias.length > 0" class="bg-variacao/[0.08] border border-variacao/30 rounded-md p-4">
            <div class="flex items-start justify-between gap-4">
                <div class="flex items-start gap-3 flex-1">
                    <AlertTriangle class="w-5 h-5 text-variacao shrink-0 mt-0.5" :stroke-width="1.8" />
                    <div>
                        <p class="text-[13px] font-semibold text-variacao uppercase tracking-wide">
                            Divergência de Estoque Detectada
                        </p>
                        <p class="text-[12px] text-risco mt-0.5">
                            O estoque de abertura deste mês difere do fechamento do mês anterior
                            <span class="font-mono text-ink">({{ continuidade.divergencias[0]?.periodo_anterior?.substring(5,7) }}/{{ continuidade.divergencias[0]?.periodo_anterior?.substring(0,4) }})</span>
                            em {{ continuidade.divergencias.length }} produto(s).
                        </p>
                        <div class="mt-3 space-y-1.5">
                            <div v-for="div in continuidade.divergencias" :key="div.cod_item"
                                class="flex items-center gap-3 bg-sheet rounded-md px-3 py-2 border border-line">
                                <div class="flex-1 min-w-0">
                                    <span class="text-[12px] font-medium text-ink truncate block">{{ div.nome || div.cod_item }}</span>
                                    <div class="flex items-center gap-3 mt-0.5 text-[11px] font-mono">
                                        <span class="text-risco">Fech. anterior: <span class="text-ink">{{ fNum(div.fechamento_anterior) }} L</span></span>
                                        <span class="text-risco">→</span>
                                        <span class="text-risco">Abert. atual: <span class="text-ink">{{ fNum(div.abertura_atual) }} L</span></span>
                                        <span :class="div.diferenca > 0 ? 'text-conforme' : 'text-lacre'" class="font-medium">
                                            (Δ {{ div.diferenca > 0 ? '+' : '' }}{{ fNum(div.diferenca) }} L)
                                        </span>
                                    </div>
                                </div>
                                <button @click="sincronizarEstoque(div.cod_item, div.fechamento_anterior)"
                                    :disabled="sincronizando[div.cod_item]"
                                    class="shrink-0 px-3 py-1.5 bg-variacao hover:opacity-85 text-white text-[11px] font-medium rounded-md transition-opacity disabled:opacity-50 flex items-center gap-1.5">
                                    <Loader2 v-if="sincronizando[div.cod_item]" class="w-3 h-3 animate-spin" />
                                    SINCRONIZAR
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <button v-if="continuidade.divergencias.length > 1" @click="sincronizarTodos"
                    :disabled="Object.keys(sincronizando).length > 0"
                    class="shrink-0 px-4 py-2 bg-variacao hover:opacity-85 text-white text-[12px] font-medium rounded-md transition-opacity disabled:opacity-50 flex items-center gap-2">
                    <Loader2 v-if="Object.keys(sincronizando).length > 0" class="w-3 h-3 animate-spin" />
                    SINCRONIZAR TODOS
                </button>
            </div>
        </div>

        <!-- Controles Interativos -->
        <div class="flex flex-col md:flex-row justify-between md:items-center gap-4 bg-sheet p-2 rounded-md border border-line">
            <!-- Abas de Seleção de Combustível -->
            <div class="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar flex-1">
                <button
                    v-for="comb in combustiveis"
                    :key="comb.cod_item"
                    @click="selectedFuel = comb.cod_item"
                    class="px-4 py-2 rounded-md font-medium text-[11px] uppercase tracking-wide transition-colors whitespace-nowrap border"
                    :class="selectedFuel === comb.cod_item
                        ? 'bg-bronze text-white border-bronze'
                        : 'bg-sheet text-risco border-line hover:border-bronze hover:text-bronze'"
                >
                    {{ comb.nome || `Prod ${comb.cod_item}` }}
                </button>
            </div>

            <!-- Simulador vs Original -->
            <div class="flex items-center gap-2 shrink-0">
                <button v-if="viewMode === 'lab' && selectedFuel && movimentacaoAtiva.length > 0"
                        @click="redistribuirCombustivel"
                        :disabled="syncPreviewLoading"
                        class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium uppercase tracking-wide border border-bronze/30 bg-bronze/10 text-bronze hover:bg-bronze/15 transition-colors disabled:opacity-50"
                        title="Re-executa a distribuição inteligente usando a abertura atual">
                    <RefreshCw class="w-3 h-3" :class="syncPreviewLoading ? 'animate-spin' : ''" :stroke-width="1.8" />
                    Re-distribuir
                </button>
                <div class="bg-paper p-1 rounded-md flex gap-1 h-fit border border-line">
                    <button @click="viewMode = 'raiox'"
                        class="flex items-center gap-2 px-4 py-1.5 rounded-md text-[11px] font-medium uppercase transition-colors"
                        :class="viewMode === 'raiox' ? 'bg-sheet text-ink border border-line' : 'text-risco hover:text-ink'">
                        <Eye class="w-3.5 h-3.5" :stroke-width="1.8" /> RAIO-X
                    </button>
                    <button @click="viewMode = 'lab'"
                        class="flex items-center gap-2 px-4 py-1.5 rounded-md text-[11px] font-medium uppercase transition-colors"
                        :class="viewMode === 'lab' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'">
                        <Beaker class="w-3.5 h-3.5" :stroke-width="1.8" /> LABORATÓRIO
                    </button>
                </div>
            </div>
        </div>

        <!-- Banner: distribuição inconsistente (sync com código antigo) -->
        <div v-if="distribuicaoInconsistente"
             class="flex items-center justify-between gap-4 bg-lacre/[0.07] border border-lacre/30 rounded-md px-5 py-3">
            <div class="flex items-center gap-3">
                <AlertTriangle class="w-5 h-5 text-lacre shrink-0" :stroke-width="1.8" />
                <div>
                    <p class="text-[13px] font-semibold text-lacre">Distribuição inconsistente detectada</p>
                    <p class="text-[12px] text-risco mt-0.5">
                        A cascata calculada diverge dos ajustes salvos. Clique em Corrigir para redistribuir as vendas e realinhar o físico.
                    </p>
                </div>
            </div>
            <button @click="corrigirDistribuicao" :disabled="corrigindoDistribuicao"
                    class="shrink-0 flex items-center gap-2 px-5 py-2 bg-lacre hover:opacity-85 text-white text-[12px] font-medium rounded-md transition-opacity disabled:opacity-50">
                <Loader2 v-if="corrigindoDistribuicao" class="w-3.5 h-3.5 animate-spin" />
                <RefreshCw v-else class="w-3.5 h-3.5" :stroke-width="1.8" />
                {{ corrigindoDistribuicao ? 'Corrigindo...' : 'Corrigir Distribuição' }}
            </button>
        </div>

        <!-- Tabela Progressiva -->
        <div class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse min-w-[900px]">
                    <thead>
                        <tr class="bg-graphite text-[10px] font-medium uppercase text-muted tracking-wide">
                            <th class="py-2 px-2 sticky left-0 bg-graphite z-10 border-b border-graphite-4 text-white">Data</th>
                            <th class="py-2 px-2 border-b border-graphite-4 text-right text-line" title="Estoque de abertura do dia">Est. Inicial</th>
                            <th class="py-2 px-2 border-b border-graphite-4 text-right text-conforme border-r border-graphite-4" title="Entradas LMC · badge ⚠ quando NF-e difere">Entradas <span class="text-variacao">⚠NF</span></th>
                            <th class="py-2 px-2 border-b border-graphite-4 text-right text-line border-r border-graphite-4" title="Est. Inicial + Entradas">Estq. Disponível</th>
                            <th class="py-2 px-2 border-b border-graphite-4 border-r border-graphite-4 text-center text-line">Saídas</th>
                            <th class="py-2 px-2 border-b border-graphite-4 text-right bg-graphite-2 border-r border-graphite-4 text-line">Escritural</th>
                            <th class="py-2 px-2 border-b border-graphite-4 text-center text-bronze border-r border-graphite-4">Est. Físico</th>
                            <th class="py-2 px-2 border-b border-graphite-4 text-center border-r border-graphite-4">Perda / Ganho</th>
                            <th class="py-2 px-2 border-b border-graphite-4 text-center border-l border-graphite-4">% ANP</th>
                        </tr>
                    </thead>
                    <tbody class="text-[13px] text-risco divide-y divide-line">
                        <template v-for="row in movimentacaoAtiva" :key="row.data_movimento">
                            <!-- Linha Principal -->
                            <tr class="hover:bg-paper transition-colors" v-if="row.raiox && row.raiox.estq_abert !== undefined"
                                :class="{
                                    'bg-bronze/[0.06] hover:bg-bronze/[0.1]': row[viewMode].is_negativo,
                                    'bg-lacre/[0.06] hover:bg-lacre/[0.1]': row[viewMode].ultrapassou_limite && !row[viewMode].is_negativo
                                }">

                                <td class="py-1.5 px-2 sticky left-0 z-10 border-r border-line font-mono font-medium"
                                    :class="row[viewMode].is_negativo ? 'bg-bronze/[0.06] text-bronze' : row[viewMode].ultrapassou_limite ? 'bg-lacre/[0.06] text-lacre' : 'bg-sheet text-ink'">
                                    {{ fDate(row.data_movimento) }}
                                </td>

                                <td class="py-1.5 px-2 text-right font-mono text-risco bg-paper/40">
                                    {{ fNum(row[viewMode].estq_abert) }}
                                    <span v-if="viewMode === 'lab' && parseFloat(row.lab.estq_abert) !== parseFloat(row.estq_abert)"
                                          class="text-[9px] text-variacao block -mt-0.5 leading-none" title="Diferente da abertura original">
                                          Real: {{ fNum(row.estq_abert) }}
                                    </span>
                                </td>

                                <td class="py-1.5 px-2 text-right font-mono text-conforme border-r border-line">
                                    <div class="flex flex-col items-end gap-0.5">
                                        <span>{{ fNum(row[viewMode].vol_entr) }}</span>
                                        <!-- Badge ⚠ quando NF-e difere do LMC -->
                                        <span v-if="parseFloat(row.vol_entr_lmc) !== parseFloat(row.volume_nota)"
                                              class="text-[8px] font-medium text-variacao bg-variacao/10 border border-variacao/25 rounded px-1 leading-tight"
                                              :title="`NF-e: ${fNum(row.volume_nota)} L — LMC: ${fNum(row.vol_entr_lmc)} L`">
                                            ⚠ NF: {{ fNum(row.volume_nota) }} L
                                        </span>
                                        <button v-if="row.nfs_detalhadas && row.nfs_detalhadas.length > 0"
                                                @click="toggleDay(row.data_movimento)"
                                                class="px-2 py-0.5 rounded bg-bronze/10 text-bronze hover:bg-bronze/15 transition-colors text-[9px] font-medium self-center mt-0.5">
                                            {{ expandedDays.has(row.data_movimento) ? '⬆ NFs' : '⬇ NFs' }}
                                        </button>
                                    </div>
                                </td>

                                <!-- Estoque Disponível = Inicial + Entradas -->
                                <td class="py-1.5 px-2 text-right font-mono text-ink border-r border-line bg-paper/30">
                                    {{ fNum(row[viewMode].estq_abert + row[viewMode].vol_entr) }}
                                </td>

                                <!-- Input Editável de SAÍDA -->
                                <td class="py-1.5 px-2 bg-paper/30 border-r border-line align-middle">
                                    <div v-if="viewMode === 'raiox'" class="text-right font-mono text-ink">
                                        {{ fNum(row.raiox.vol_saidas) }}
                                    </div>
                                    <div v-else class="flex flex-col gap-1 items-center justify-center">
                                        <div class="flex items-center bg-sheet border rounded-md overflow-hidden transition-colors"
                                            :class="row.lab.is_saida_edited ? 'border-bronze' : 'border-line'">
                                            <input type="number"
                                                @input="recalcularTudo"
                                                v-model="row.edit_value"
                                                class="w-20 px-1.5 py-0.5 text-right text-xs font-mono bg-transparent outline-none"
                                                :class="row.lab.is_saida_edited ? 'text-bronze' : 'text-ink'"
                                                step="0.001"
                                            />
                                            <button @click="salvarSaidaComCascata(row)"
                                                :disabled="savingDate === row.data_movimento"
                                                class="bg-bronze/10 hover:bg-bronze/15 text-bronze px-2 py-1 text-[10px] font-medium h-full border-l border-line transition-colors disabled:opacity-50"
                                                title="Salvar venda e atualizar cascata dos dias seguintes">
                                                {{ savingDate === row.data_movimento ? '...' : '✔' }}
                                            </button>
                                        </div>
                                        <template v-if="row.lab.is_saida_edited">
                                            <span class="text-[9px] text-risco block leading-none">
                                                Orig: {{ fNum(row.vol_saidas) }}
                                            </span>
                                            <span class="text-[9px] font-medium leading-none"
                                                :class="(row.edit_value - row.vol_saidas) >= 0 ? 'text-conforme' : 'text-lacre'">
                                                Δ {{ (row.edit_value - row.vol_saidas) >= 0 ? '+' : '' }}{{ fNum(row.edit_value - row.vol_saidas) }}
                                            </span>
                                        </template>
                                    </div>
                                </td>
                                                                <td class="py-1.5 px-2 text-right font-mono bg-paper/50 border-r border-line" title="Escritural">
                                    <span :class="viewMode === 'lab' ? 'text-ink' : 'text-risco'">
                                        {{ fNum(row[viewMode].estq_escr) }}
                                    </span>
                                </td>

                                <!-- Input Editável de FÍSICO -->
                                <td class="py-1.5 px-2 bg-paper/30 border-r border-line align-middle">
                                    <div v-if="viewMode === 'raiox'" class="text-right font-mono text-ink">
                                        {{ fNum(row.raiox.fech_fisico) }}
                                    </div>
                                    <div v-else class="flex flex-col gap-1 items-center justify-center">
                                        <div class="flex items-center bg-sheet border rounded-md overflow-hidden transition-colors"
                                            :class="row.lab.is_fisico_edited ? 'border-bronze' : 'border-line'">
                                            <input type="number"
                                                @input="recalcularTudo"
                                                v-model="row.fisico_edit_value"
                                                class="w-20 px-1.5 py-0.5 text-right text-xs font-mono bg-transparent outline-none"
                                                :class="row.lab.is_fisico_edited ? 'text-bronze' : 'text-ink'"
                                                step="0.001"
                                                title="Altera o tanque real deste dia para regularizar a ANP"
                                            />
                                            <!-- Botão individual salvar -->
                                            <button @click="salvarAjuste(row)" :disabled="savingDate === row.data_movimento"
                                                class="bg-paper hover:bg-line/60 text-risco px-2 py-1 text-[10px] font-medium h-full border-l border-line transition-colors disabled:opacity-50">
                                                {{ savingDate === row.data_movimento ? '...' : '✔' }}
                                            </button>
                                        </div>
                                        <span v-if="row.lab.is_fisico_edited" class="text-[9px] text-risco block leading-none">
                                            Lido: {{ fNum(row.fech_fisico) }}
                                        </span>
                                    </div>
                                </td>

                                <td class="py-1.5 px-2 text-center border-r border-line">
                                    <template v-if="Math.abs(row[viewMode].dif) < 0.001">
                                        <span class="text-line font-mono text-xs">---</span>
                                    </template>
                                    <template v-else-if="row[viewMode].dif < 0">
                                        <div class="text-xs text-lacre font-medium font-mono">-{{ fNum(Math.abs(row[viewMode].dif)) }} L</div>
                                        <div class="text-[8px] text-lacre/80 font-medium uppercase leading-tight">Perda</div>
                                    </template>
                                    <template v-else>
                                        <div class="text-xs text-conforme font-medium font-mono">+{{ fNum(row[viewMode].dif) }} L</div>
                                        <div class="text-[8px] text-conforme/80 font-medium uppercase leading-tight">Ganho</div>
                                    </template>
                                </td>

                                <td class="py-1.5 px-2 text-center border-l border-line">
                                    <span v-if="row[viewMode].is_negativo"
                                        class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium font-mono tracking-wide bg-bronze/10 text-bronze border border-bronze/30">
                                        NEGATIVO
                                    </span>
                                    <span v-else class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium font-mono tracking-wide"
                                        :class="row[viewMode].ultrapassou_limite
                                            ? 'bg-lacre/10 text-lacre border border-lacre/25'
                                            : 'bg-conforme/10 text-conforme border border-conforme/25'">
                                        <span class="text-[11px] leading-none">{{ row[viewMode].ultrapassou_limite ? '✗' : '✓' }}</span>
                                        {{ fNum(row[viewMode].percentual) }}%
                                    </span>
                                </td>
                            </tr>
                            
                            <!-- Master-Detail Notas Fiscais -->
                            <tr v-if="expandedDays.has(row.data_movimento) && row.nfs_detalhadas && row.nfs_detalhadas.length > 0">
                                <td colspan="9" class="p-0 bg-paper border-b border-line">
                                    <div class="px-8 py-4">
                                        <p class="text-[10px] uppercase font-medium tracking-wide text-risco mb-2">Composição Tributária de Entrada (NF-e C100)</p>
                                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            <div v-for="nf in row.nfs_detalhadas" :key="nf.num_doc" class="bg-sheet border text-left border-line rounded-md p-3 transition-colors hover:border-bronze/40">
                                                <div class="flex justify-between items-start mb-2">
                                                    <span class="text-[11px] font-medium text-risco">NF-e Número</span>
                                                    <span class="px-2 py-0.5 bg-bronze/10 text-bronze rounded text-xs font-medium font-mono">#{{ nf.num_doc }}</span>
                                                </div>
                                                <p class="text-[13px] font-medium text-ink truncate" :title="nf.fornecedor">{{ nf.fornecedor }}</p>
                                                <div class="flex justify-between items-end mt-2 pt-2 border-t border-line">
                                                    <div>
                                                        <p class="text-[9px] text-risco uppercase font-medium">Volume / Quantidade</p>
                                                        <p class="text-xs font-mono text-bronze">{{ fNum(nf.qtd) }} L</p>
                                                    </div>
                                                    <p class="text-[10px] text-risco font-mono">{{ fDate(nf.dt_doc) }}</p>
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
            <div class="bg-graphite p-4 text-[12px] text-muted flex items-center justify-between">
                <div>
                    <strong class="text-line font-medium">Engenharia Tributária:</strong> O Macro Distribuidor de Vendas recálcula todo o Estoque Físico gerando falso-positivos indetectáveis aprovados para passar na ANP (Quebra natural entre -0.35% a +0.35%). O Fechamento sempre alimenta a Abertura consecutiva.
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
        <div class="absolute inset-0 bg-ink/50"></div>

        <!-- Card -->
        <div class="relative bg-sheet rounded-md border border-line card-shadow w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

          <!-- Loading State -->
          <div v-if="syncPreviewLoading" class="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 class="w-9 h-9 text-bronze animate-spin" :stroke-width="1.7" />
            <p class="text-[13px] text-risco uppercase tracking-wide">Calculando distribuição...</p>
          </div>

          <template v-else-if="syncPreviews.length">
            <!-- Header -->
            <div class="px-6 pt-5 pb-4 border-b border-line shrink-0">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h2 class="font-display text-[16px] font-semibold text-ink">Prévia da Sincronização</h2>
                  <p class="text-[12px] text-risco mt-0.5">Revise as alterações antes de confirmar. Esta ação redistribuirá as vendas do mês.</p>
                </div>
                <button @click="showSyncModal = false" :disabled="syncConfirmando"
                        class="w-8 h-8 rounded-md bg-paper hover:bg-line/60 flex items-center justify-center text-risco transition-colors shrink-0">
                  <XCircle class="w-4 h-4" :stroke-width="1.8" />
                </button>
              </div>

              <!-- Abas por produto -->
              <div v-if="syncPreviews.length > 1" class="flex gap-1.5 mt-4 overflow-x-auto pb-0.5">
                <button v-for="(p, i) in syncPreviews" :key="p.cod_item"
                        @click="syncAbaAtiva = i; syncDiasExpandido = false"
                        class="px-3 py-1.5 rounded-md text-[11px] font-medium uppercase tracking-wide transition-colors border whitespace-nowrap"
                        :class="syncAbaAtiva === i
                          ? 'bg-bronze text-white border-bronze'
                          : 'bg-sheet text-risco border-line hover:border-bronze hover:text-bronze'">
                  {{ p.nome }}
                </button>
              </div>
            </div>

            <!-- Corpo scrollável -->
            <div class="overflow-y-auto flex-1 px-6 py-5 space-y-4"
                 v-if="syncPreviews[syncAbaAtiva]">
              <div :key="syncAbaAtiva">

                <!-- Tabela Antes × Depois -->
                <div class="rounded-md border border-line overflow-hidden">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="bg-paper text-[10px] font-medium uppercase text-risco tracking-wide">
                        <th class="px-4 py-3 text-left"></th>
                        <th class="px-4 py-3 text-right text-risco">ANTES</th>
                        <th class="px-4 py-3 text-right text-bronze">DEPOIS</th>
                        <th class="px-4 py-3 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                      <tr v-for="linha in [
                        { label: 'Abertura do mês',   antes: syncPreviews[syncAbaAtiva].resumo.abertura_antes,   depois: syncPreviews[syncAbaAtiva].resumo.abertura_depois },
                        { label: 'Total de vendas',   antes: syncPreviews[syncAbaAtiva].resumo.vendas_antes,     depois: syncPreviews[syncAbaAtiva].resumo.vendas_depois },
                        { label: 'Fechamento do mês', antes: syncPreviews[syncAbaAtiva].resumo.fechamento_antes, depois: syncPreviews[syncAbaAtiva].resumo.fechamento_depois },
                      ]" :key="linha.label">
                        <td class="px-4 py-2.5 text-xs font-medium text-ink">{{ linha.label }}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-xs text-risco line-through">{{ fNum(linha.antes) }} L</td>
                        <td class="px-4 py-2.5 text-right font-mono text-xs text-ink">{{ fNum(linha.depois) }} L</td>
                        <td class="px-4 py-2.5 text-right font-mono text-[11px] font-medium"
                            :class="(linha.depois - linha.antes) === 0 ? 'text-line'
                                  : (linha.depois - linha.antes) > 0 ? 'text-conforme' : 'text-lacre'">
                          {{ (linha.depois - linha.antes) === 0 ? '—'
                           : ((linha.depois - linha.antes) > 0 ? '+' : '') + fNum(linha.depois - linha.antes) + ' L' }}
                        </td>
                      </tr>
                      <tr v-if="syncPreviews[syncAbaAtiva].resumo.capacidade > 0" class="bg-paper/50">
                        <td class="px-4 py-2 text-[10px] text-risco">Capacidade do tanque</td>
                        <td colspan="3" class="px-4 py-2 text-right font-mono text-[10px] text-risco">{{ fNum(syncPreviews[syncAbaAtiva].resumo.capacidade) }} L</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Avisos de ajuste automático -->
                <div v-if="syncPreviews[syncAbaAtiva].ajustes.length"
                     class="bg-variacao/[0.08] border border-variacao/25 rounded-md p-4 space-y-1.5">
                  <p class="text-[10px] font-medium text-variacao uppercase tracking-wide flex items-center gap-1.5">
                    <AlertTriangle class="w-3.5 h-3.5" :stroke-width="1.8" /> Ajustes automáticos aplicados
                  </p>
                  <p v-for="a in syncPreviews[syncAbaAtiva].ajustes" :key="a"
                     class="text-xs text-variacao pl-5">• {{ a }}</p>
                </div>
                <div v-else class="flex items-center gap-2 text-xs text-conforme font-medium px-1">
                  <CheckCircle2 class="w-4 h-4" :stroke-width="1.8" />
                  Distribuição viável — nenhum ajuste necessário.
                </div>

                <!-- Detalhes por dia (colapsável) -->
                <div class="border border-line rounded-md overflow-hidden">
                  <button @click="syncDiasExpandido = !syncDiasExpandido"
                          class="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-ink hover:bg-paper transition-colors">
                    <span>Ver distribuição por dia ({{ syncPreviews[syncAbaAtiva].dias.length }} registros)</span>
                    <ChevronDown v-if="!syncDiasExpandido" class="w-4 h-4 text-risco" :stroke-width="1.8" />
                    <ChevronUp v-else class="w-4 h-4 text-risco" :stroke-width="1.8" />
                  </button>
                  <div v-if="syncDiasExpandido" class="overflow-x-auto border-t border-line">
                    <table class="w-full text-[11px]">
                      <thead>
                        <tr class="bg-paper text-[9px] font-medium uppercase text-risco tracking-wide">
                          <th class="px-3 py-2 text-left">Data</th>
                          <th class="px-3 py-2 text-right">Vendas Antes</th>
                          <th class="px-3 py-2 text-right text-bronze">Vendas Depois</th>
                          <th class="px-3 py-2 text-right">Estq. Antes</th>
                          <th class="px-3 py-2 text-right text-bronze">Estq. Depois</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-line">
                        <tr v-for="dia in syncPreviews[syncAbaAtiva].dias" :key="dia.data"
                            :class="Math.abs(dia.vendas_depois - dia.vendas_antes) > 0.01 ? 'bg-variacao/[0.06]' : ''">
                          <td class="px-3 py-1.5 font-mono text-risco">
                            {{ new Date(dia.data).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' }) }}
                          </td>
                          <td class="px-3 py-1.5 text-right font-mono text-risco">{{ fNum(dia.vendas_antes) }}</td>
                          <td class="px-3 py-1.5 text-right font-mono"
                              :class="Math.abs(dia.vendas_depois - dia.vendas_antes) > 0.01 ? 'text-variacao' : 'text-ink'">
                            {{ fNum(dia.vendas_depois) }}
                          </td>
                          <td class="px-3 py-1.5 text-right font-mono text-risco">{{ fNum(dia.estoque_antes) }}</td>
                          <td class="px-3 py-1.5 text-right font-mono text-ink">{{ fNum(dia.estoque_depois) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t border-line flex items-center justify-between gap-4 shrink-0 bg-paper">
              <p class="text-[10px] text-risco font-medium">
                {{ syncPreviews.length > 1 ? `${syncPreviews.length} produtos serão sincronizados.` : '' }}
              </p>
              <div class="flex items-center gap-3">
                <button @click="showSyncModal = false" :disabled="syncConfirmando"
                        class="px-5 py-2 rounded-md border border-line text-[13px] font-medium text-risco hover:bg-line/50 transition-colors disabled:opacity-50">
                  Cancelar
                </button>
                <button @click="confirmarSincronizacao" :disabled="syncConfirmando"
                        class="px-6 py-2 rounded-md bg-bronze text-white text-[13px] font-medium hover:opacity-85 transition-opacity disabled:opacity-50 flex items-center gap-2">
                  <Loader2 v-if="syncConfirmando" class="w-4 h-4 animate-spin" />
                  <CheckCircle2 v-else class="w-4 h-4" :stroke-width="1.8" />
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
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
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
