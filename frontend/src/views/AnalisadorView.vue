<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import VueApexCharts from "vue3-apexcharts";
import { useRoute } from 'vue-router'
import { empresaSelecionada, setArquivoInfo, setEmpresaSelecionada, idArquivoSped, arquivoInfo, auditErros, auditResumoGerencial, auditResumoEstoque, resetArquivoSped } from '../store'
import { Loader2 } from 'lucide-vue-next'

const route = useRoute();

const status = ref('Pronto para iniciar');
const spedButtonDisabled = ref(false);
const activeTab = ref('novo');
const showCorrectionModal = ref(false);
const itemToCorrect = ref(null);
const correctedValue = ref('');
const activeErrorSubTab = ref('TODOS');
const showSuccessToast = ref(false);
const showLmcConfigModal = ref(false);
const tankConfigs = ref([]);

// --- Estado de Upload e Progresso ---
const isUploading = ref(false);
const uploadProgress = ref(0);
const uploadMessage = ref('');
const terminalLogs = ref([]);
const terminalContainer = ref(null);
let logEventSource = null;

function connectToLogStream() {
    if (logEventSource) logEventSource.close();
    terminalLogs.value = [{ msg: 'Iniciando conexão com o Motor...', type: 'sys' }];
    
    logEventSource = new EventSource(`${API_BASE_URL}/api/logs/stream`);
    
    logEventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        terminalLogs.value.push({
            msg: data.message,
            time: new Date(data.timestamp).toLocaleTimeString(),
            type: 'log'
        });
        
        // Auto-scroll para o final
        setTimeout(() => {
            if (terminalContainer.value) {
                terminalContainer.value.scrollTop = terminalContainer.value.scrollHeight;
            }
        }, 50);
    };

    logEventSource.onerror = () => {
        terminalLogs.value.push({ msg: 'Conexão de log encerrada.', type: 'sys' });
        logEventSource.close();
    };
}

// --- Estado Edição de NF (5.929 / 65) ---
const showNfEditModal = ref(false);
const nfToEdit = ref(null);
const nfEditForm = ref({
    vl_doc: 0,
    vl_opr: 0,
    vl_bc_icms: 0,
    vl_icms: 0
});

// --- Estado Auditoria LMC Especializada ---
const lmcData = ref([]);
const loadingLmc = ref(false);
const lmcFilters = ref({
    search: '',
    date: '',
    onlyErrors: false
});
const savingLmcConfig = ref(false);

// --- Estado Otimizador Matemático (Distribuição Inteligente) ---
const showOtimizadorModal = ref(false);
const productToOtimizar = ref(null);
const targetVolume = ref(0);
const savingOtimizacao = ref(false);


function openNfEdit(nf) {
    nfToEdit.value = nf;
    nfEditForm.value = {
        vl_doc: nf.vl_doc_ajustado !== null ? nf.vl_doc_ajustado : nf.vl_doc,
        vl_opr: nf.vl_opr_ajustado !== null ? nf.vl_opr_ajustado : nf.vl_opr,
        vl_bc_icms: nf.vl_bc_icms_ajustado !== null ? nf.vl_bc_icms_ajustado : nf.vl_bc_icms,
        vl_icms: nf.vl_icms_ajustado !== null ? nf.vl_icms_ajustado : nf.vl_icms
    };
    showNfEditModal.value = true;
}

async function saveNfEdit() {
    if (!nfToEdit.value) return;
    try {
        const token = localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        
        // Salva C100
        await axios.post(`${API_BASE_URL}/api/corrigir-item`, {
            tipo: 'C100',
            id_item: nfToEdit.value.id,
            novos_valores: { vl_doc_ajustado: nfEditForm.value.vl_doc }
        }, { headers });

        // Salva C190
        await axios.post(`${API_BASE_URL}/api/corrigir-item`, {
            tipo: 'C190',
            id_item: nfToEdit.value.id_c190,
            novos_valores: { 
                vl_opr_ajustado: nfEditForm.value.vl_opr,
                vl_bc_icms_ajustado: nfEditForm.value.vl_bc_icms,
                vl_icms_ajustado: nfEditForm.value.vl_icms
            }
        }, { headers });

        showNfEditModal.value = false;
        // Força recarga da aba atual de saídas
        saidasMod65.value = [];
        loadSaidasMod65();
    } catch (e) {
        alert('Erro ao salvar ajustes da nota: ' + (e.response?.data?.message || e.message));
    }
}

// --- Estado NF Analíticas ---
const notasAnaliticas = ref([]);
const loadingNotas = ref(false);
const expandedNotas = ref(new Set());
const buscaNF = ref('');

const filteredNotas = computed(() => {
    if (!buscaNF.value) return notasAnaliticas.value;
    const lower = buscaNF.value.toLowerCase();
    return notasAnaliticas.value.filter(nf => 
        (nf.num_doc && nf.num_doc.toLowerCase().includes(lower)) || 
        (nf.nome_fornecedor && nf.nome_fornecedor.toLowerCase().includes(lower))
    );
});

function toggleNota(id) {
    if (expandedNotas.value.has(id)) {
        expandedNotas.value.delete(id);
    } else {
        expandedNotas.value.add(id);
    }
}

async function loadNotasAnaliticas() {
    if (!idArquivoSped.value) return;
    loadingNotas.value = true;
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/documentos/auditoria/nf/${idArquivoSped.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        notasAnaliticas.value = res.data;
    } catch(e) {
        console.error("Erro ao carregar NF Analíticas:", e);
    } finally {
        loadingNotas.value = false;
    }
}

// --- Estado NF Saídas ---
const saidasMod55 = ref([]);
const saidasMod65 = ref([]);
const loadingSaidas55 = ref(false);
const loadingSaidas65 = ref(false);
const activeSaidasSubTab = ref('65');
const expandedCfops = ref(new Set());
const expandedSaidas55 = ref(new Set());
const buscaSaidas = ref('');

const filteredSaidas55 = computed(() => {
    if (!buscaSaidas.value) return saidasMod55.value;
    const lower = buscaSaidas.value.toLowerCase();
    return saidasMod55.value.filter(nf =>
        (nf.num_doc && nf.num_doc.toLowerCase().includes(lower)) ||
        (nf.nome_cliente && nf.nome_cliente.toLowerCase().includes(lower))
    );
});

function toggleCfop(cfop) {
    if (expandedCfops.value.has(cfop)) expandedCfops.value.delete(cfop);
    else expandedCfops.value.add(cfop);
    expandedCfops.value = new Set(expandedCfops.value);
}

function toggleSaida55(id) {
    if (expandedSaidas55.value.has(id)) expandedSaidas55.value.delete(id);
    else expandedSaidas55.value.add(id);
    expandedSaidas55.value = new Set(expandedSaidas55.value);
}

async function loadSaidasMod55() {
    if (!idArquivoSped.value || saidasMod55.value.length > 0) return;
    loadingSaidas55.value = true;
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/documentos/auditoria/saidas/${idArquivoSped.value}?modelo=55`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        saidasMod55.value = res.data;
    } catch(e) { console.error('Erro Saídas Mod 55:', e); }
    finally { loadingSaidas55.value = false; }
}

async function loadSaidasMod65() {
    if (!idArquivoSped.value || saidasMod65.value.length > 0) return;
    loadingSaidas65.value = true;
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/documentos/auditoria/saidas/${idArquivoSped.value}?modelo=65`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        saidasMod65.value = res.data;
    } catch(e) { console.error('Erro Saídas Mod 65:', e); }
    finally { loadingSaidas65.value = false; }
}

watch(activeSaidasSubTab, (sub) => {
    if (sub === '55') loadSaidasMod55();
    else loadSaidasMod65();
});

watch(activeTab, (newTab) => {
    if (newTab === 'notas') loadNotasAnaliticas();
    if (newTab === 'saidas') {
        if (activeSaidasSubTab.value === '55') loadSaidasMod55();
        else loadSaidasMod65();
    }
    if (newTab === 'lmc') loadLmcDetailed();
});

// --- Lógica LMC Detalhada ---
async function loadLmcDetailed() {
    if (!idArquivoSped.value) return;
    loadingLmc.value = true;
    lmcData.value = []; // Limpa explicitamente para forçar reatividade do Vue
    try {
        const token = localStorage.getItem('token');
        const [resLmc, resConfigs] = await Promise.all([
            axios.get(`${API_BASE_URL}/api/lmc/${idArquivoSped.value}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            }),
            axios.get(`${API_BASE_URL}/api/lmc/tanques-config/${empresaSelecionada.value.cnpj}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
        ]);
        lmcData.value = resLmc.data;
        tankConfigs.value = resConfigs.data;
    } catch (e) {
        console.error("Erro ao carregar detalhes LMC:", e);
    } finally {
        loadingLmc.value = false;
    }
}

const filteredLmc = computed(() => {
    let data = lmcData.value;
    if (lmcFilters.value.search) {
        const s = lmcFilters.value.search.toLowerCase();
        data = data.filter(d => d.nome_combustivel.toLowerCase().includes(s) || d.cod_item.toLowerCase().includes(s));
    }
    if (lmcFilters.value.date) {
        data = data.filter(d => d.data_movimento.includes(lmcFilters.value.date));
    }
    if (lmcFilters.value.onlyErrors) {
        data = data.filter(d => d.status_anp !== 'CONFORME');
    }
    return data;
});

const totalVolumeCompra = computed(() => {
    if (!auditResumoGerencial.value?.estoqueResumo) return 0;
    return auditResumoGerencial.value.estoqueResumo.reduce((acc, curr) => acc + (curr.entradas || 0), 0);
});

const totalVolumeVenda = computed(() => {
    if (!auditResumoGerencial.value?.estoqueResumo) return 0;
    return auditResumoGerencial.value.estoqueResumo.reduce((acc, curr) => acc + (curr.saidas || 0), 0);
});

const lmcKpis = computed(() => {
    if (!lmcData.value.length) return [];
    
    // Agrupar dados por combustível
    const grupos = {};
    
    // 1. Agrupar todos os registros por combustível
    lmcData.value.forEach(d => {
        const key = d.nome_combustivel || d.cod_item;
        if (!grupos[key]) {
            grupos[key] = {
                nome: key,
                cod: d.cod_item,
                registros: [],
                totalEntradas: 0,
                totalSaidas: 0,
                irregularidades: 0
            };
        }
        grupos[key].registros.push(d);
        grupos[key].totalEntradas += (parseFloat(d.vol_entr_lmc) || 0);
        grupos[key].totalSaidas += (parseFloat(d.vol_saidas_final || d.vol_saidas || 0));
        if (d.status_anp !== 'CONFORME') grupos[key].irregularidades++;
    });

    // 2. Para cada combustível, calcular os KPIs baseados no período (Primeiro vs Último)
    const resultado = Object.values(grupos).map(g => {
        // Ordenar registros por data para pegar os extremos
        const ordenados = [...g.registros].sort((a, b) => new Date(a.data_movimento) - new Date(b.data_movimento));
        const dataInicial = ordenados[0].data_movimento;
        const dataFinal = ordenados[ordenados.length - 1].data_movimento;

        // Pegar todos os registros do primeiro dia (pode ter vários tanques)
        const primeiroDia = ordenados.filter(r => r.data_movimento === dataInicial);
        const estoqueInicial = primeiroDia.reduce((acc, r) => acc + parseFloat(r.estq_abert_final || r.estq_abert || 0), 0);

        // Pegar todos os registros do último dia para o fechamento físico final
        // NOVIDADE: Buscamos o ÚLTIMO fechamento físico NÃO-ZERO do mês para evitar falsas quebras de 100%
        const registrosComFisico = ordenados.filter(r => (parseFloat(r.fech_fisico_final || r.fech_fisico) || 0) > 0);
        const dataFinalComMedicao = registrosComFisico.length > 0 
            ? registrosComFisico[registrosComFisico.length - 1].data_movimento 
            : dataFinal;

        const ultimoDiaComMedicao = ordenados.filter(r => r.data_movimento === dataFinalComMedicao);
        const fechFisicoFinal = ultimoDiaComMedicao.reduce((acc, r) => acc + parseFloat(r.fech_fisico_final || r.fech_fisico || 0), 0);

        // A Quebra Líquida Mensal correta é calculada no momento da última medição conhecida:
        // (Fisico Final) - (Estoque Inicial + Entradas até aquele dia - Saídas até aquele dia)
        const registrosAteMedicao = ordenados.filter(r => new Date(r.data_movimento) <= new Date(dataFinalComMedicao));
        const entradasAteMedicao = registrosAteMedicao.reduce((acc, r) => acc + (parseFloat(r.vol_entr_lmc) || 0), 0);
        const saidasAteMedicao = registrosAteMedicao.reduce((acc, r) => acc + (parseFloat(r.vol_saidas_final || r.vol_saidas || 0)), 0);

        const escrAteMedicao = estoqueInicial + entradasAteMedicao - saidasAteMedicao;
        const quebraLiquida = fechFisicoFinal - escrAteMedicao;
        const variacaoMensalPerc = g.totalSaidas > 0 ? (Math.abs(quebraLiquida) / g.totalSaidas) * 100 : 0;

        return {
            nome: g.nome,
            cod: g.cod,
            estoqueInicial,
            totalEntradas: g.totalEntradas,
            totalSaidas: g.totalSaidas,
            quebraLiquida,
            variacaoMensalPerc,
            estoqueFinal: fechFisicoFinal,
            irregularidades: g.irregularidades
        };
    });

    // Retorna array ordenado por nome
    return resultado.sort((a, b) => a.nome.localeCompare(b.nome));
});

async function openLmcConfig() {
    // Garante que temos todos os produtos do LMC na lista de configs
    const produtosNoLmc = [...new Set(lmcData.value.map(d => d.cod_item))];
    const newConfigs = produtosNoLmc.map(cod => {
        const existing = tankConfigs.value.find(c => c.cod_item === cod);
        const descr = lmcData.value.find(d => d.cod_item === cod)?.nome_combustivel || 'Produto';
        return { 
            cod_item: cod, 
            descr_item: descr,
            capacidade: existing ? existing.capacidade : 0 
        };
    });
    tankConfigs.value = newConfigs;
    showLmcConfigModal.value = true;
}

async function saveLmcConfig() {
    savingLmcConfig.value = true;
    try {
        const token = localStorage.getItem('token');
        await axios.post(`${API_BASE_URL}/api/lmc/tanques-config`, {
            cnpj: empresaSelecionada.value.cnpj,
            configs: tankConfigs.value
        }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        showLmcConfigModal.value = false;
        loadLmcDetailed(); // Recarregar para aplicar cálculos
    } catch (e) {
        alert("Erro ao salvar capacidades: " + e.message);
    } finally {
        savingLmcConfig.value = false;
    }
}

function openOtimizador(comb) {
    productToOtimizar.value = comb;
    targetVolume.value = comb.totalSaidas; // Sugestão inicial: manter as mesmas vendas
    showOtimizadorModal.value = true;
}

async function startOtimizacao() {
    if (!idArquivoSped.value || !productToOtimizar.value) return;
    
    savingOtimizacao.value = true;
    try {
        const token = localStorage.getItem('token');
        await axios.post(`${API_BASE_URL}/api/lmc/otimizador-matematico`, {
            id_arquivo: idArquivoSped.value,
            cod_item: productToOtimizar.value.cod,
            volume_alvo: targetVolume.value
        }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        
        showOtimizadorModal.value = false;
        
        // Pequeno delay para garantir que o BD terminou o commit e o Vue processe o fechamento do modal
        setTimeout(async () => {
            await runAnalysis(false); // Recalcula totais de auditoria
            await loadLmcDetailed();  // Recarrega a visão detalhada LMC
        }, 300);
    } catch (e) {
        alert("Erro na Distribuição Inteligente: " + (e.response?.data?.error || e.message));
    } finally {
        savingOtimizacao.value = false;
    }
}

// --- Edição Manual de Estoque Inicial (Fase 20) ---
const editingStock = ref({}); // Ex: { "01": 5000 }
const savingStock = ref(false);

function toggleEditStock(cod, atual) {
    if (editingStock.value[cod] !== undefined) {
        delete editingStock.value[cod]; // Cancela edição
    } else {
        editingStock.value[cod] = atual; // Entra em modo edição
    }
}

async function saveInitialStock(cod) {
    if (!idArquivoSped.value) return;
    const novoValor = editingStock.value[cod];
    if (novoValor === undefined) return;

    savingStock.value = true;
    try {
        const token = localStorage.getItem('token');
        console.log("[DEBUG LMC] Enviando payload:", { id_arquivo: idArquivoSped.value, cod_item: cod, novo_estoque: parseFloat(novoValor) });
        const res = await axios.post(`${API_BASE_URL}/api/lmc/update-estoque-inicial`, {
            id_arquivo: idArquivoSped.value,
            cod_item: cod,
            novo_estoque: parseFloat(novoValor)
        }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        console.log("[DEBUG LMC] Resposta recebida:", res.data);
        delete editingStock.value[cod]; 
        await runAnalysis(false); // Roda a auditoria SEM mudar de aba
        await loadLmcDetailed(); // Atualiza a tela
    } catch (e) {
        alert("Erro ao formatar estoque inicial: " + (e.response?.data?.error || e.message));
    } finally {
        savingStock.value = false;
    }
}

// --- Ciclo de Vida ---
const isHistoryLoading = ref(false);

onMounted(async () => {
    const id = route.params.id;
    if (id) {
        isHistoryLoading.value = true;
        status.value = "Carregando auditoria do repositório...";
        try {
            // Se já temos os dados deste arquivo no store, não precisa buscar tudo de novo
            if (idArquivoSped.value == id && auditResumoGerencial.value) {
                activeTab.value = 'dashboard';
                status.value = "Análise carregada do cache local.";
                return;
            }

            // Buscar metadados do arquivo histórico
            const res = await axios.get(`${API_BASE_URL}/api/arquivo/info/${id}`);
            
            // Reconstruir estado global
            idArquivoSped.value = res.data.id;
            setArquivoInfo(res.data);
            setEmpresaSelecionada({
                id: res.data.id_empresa,
                nome_empresa: res.data.empresa,
                cnpj: res.data.cnpj
            });

            // Disparar análise automática (Reprocessamento planejado)
            activeTab.value = 'dashboard';
            await runAnalysis();
        } catch (e) {
            status.value = "Erro ao carregar arquivo histórico.";
            console.error("Falha ao carregar ID dinâmico:", e);
        } finally {
            isHistoryLoading.value = false;
        }
    }
});

// --- Funções de Exportação ---
function downloadDossie() {
    if (!idArquivoSped.value) return;
    const token = localStorage.getItem('token');
    window.open(`${API_BASE_URL}/api/relatorio/dossie/${idArquivoSped.value}${token ? '?token=' + token : ''}`, '_blank');
}

function downloadSpedRetificado() {
    if (!idArquivoSped.value) return;
    const token = localStorage.getItem('token');
    window.open(`${API_BASE_URL}/api/exportar-sped/${idArquivoSped.value}${token ? '?token=' + token : ''}`, '_blank');
}

function downloadExcel() {
    if (!idArquivoSped.value) return;
    const token = localStorage.getItem('token');
    window.open(`${API_BASE_URL}/api/relatorio/excel/${idArquivoSped.value}${token ? '?token=' + token : ''}`, '_blank');
}

async function applyBulkCorrection(regra_id) {
    if (!idArquivoSped.value) return;
    const novos_valores = { cst_icms: '060' }; // Valor padrão sugerido para a regra RTAX-C170-01
    
    if (!confirm(`Deseja corrigir TODOS os itens da regra ${regra_id} para o CST ${novos_valores.cst_icms}?`)) return;

    try {
        await axios.post(`${API_BASE_URL}/api/corrigir-massa`, {
            id_arquivo: idArquivoSped.value,
            regra_id: regra_id,
            novos_valores: novos_valores
        });
        runAnalysis(false);
    } catch (e) {
        alert('Erro ao aplicar correção em massa.');
    }
}

async function applyCorrection() {
    if (!itemToCorrect.value || !correctedValue.value) return;
    
    try {
        await axios.post(`${API_BASE_URL}/api/corrigir-item`, {
            tipo: 'C170', // Simplificado para C170 nesta demo
            id_item: itemToCorrect.value.id, // Precisamos garantir que o ID venha da query de erros
            novos_valores: { cst_icms: correctedValue.value }
        });
        showCorrectionModal.value = false;
        runAnalysis(false); // Recarrega para mostrar que sumiu
    } catch (e) {
        alert('Erro ao aplicar correção.');
    }
}

function openCorrection(erro) {
    // Nesta versão simplificada, apenas demonstramos o fluxo
    itemToCorrect.value = erro;
    correctedValue.value = ''; 
    showCorrectionModal.value = true;
}

// --- Funções Auxiliares ---
const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const formatNumber = (value) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3 }).format(value);

// --- Processamento ---
async function handleSpedFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    isUploading.value = true;
    uploadProgress.value = 0;
    uploadMessage.value = `Subindo ${file.name}...`;
    connectToLogStream(); // Conecta ao console do motor (Fase 12)

    const formData = new FormData();
    formData.append('spedfile', file);
    
    try {
        let response;
        try {
            response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
                onUploadProgress: (progressEvent) => {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    uploadProgress.value = percentCompleted;
                    if (percentCompleted === 100) {
                        uploadMessage.value = "Upload 100%. Aguardando processamento do servidor (isso pode levar um minuto)...";
                    }
                }
            });
        } catch (err) {
            isUploading.value = false;
            if (err.response && err.response.status === 409) {
                const repairedId = err.response.data.arquivo_id;
                const msg = err.response.data.message;
                
                if (msg.includes("REPARADO") && repairedId) {
                    status.value = "Auditoria Localizada e Reparo Físico Concluído!";
                    idArquivoSped.value = repairedId;
                    // Recarregar infos para garantir contexto
                    try {
                        const resInfo = await axios.get(`${API_BASE_URL}/api/arquivo/info/${repairedId}`);
                        setArquivoInfo({ id: repairedId, nome: file.name, cnpj: resInfo.data.cnpj, periodo: resInfo.data.periodo_apuracao });
                    } catch(e) {}
                    return;
                }

                if (confirm("Este período já foi processado. Deseja SOBRESCREVER os dados antigos? (Isso apagará seus ajustes de LMC)")) {
                    status.value = "Sobrescrevendo dados anteriores...";
                    response = await axios.post(`${API_BASE_URL}/api/upload?overwrite=true`, formData);
                } else {
                    status.value = "Upload cancelado pelo usuário.";
                    return;
                }
            } else {
                throw err;
            }
        }

        idArquivoSped.value = response.data.id_sped_arquivo;
        const fileInfo = response.data.fileInfo;
        
        setArquivoInfo({ id: idArquivoSped.value, nome: file.name, cnpj: fileInfo.cnpj_empresa, periodo: fileInfo.periodo_apuracao });
        setEmpresaSelecionada({ id: fileInfo.id_empresa, nome_empresa: fileInfo.nome_empresa, cnpj: fileInfo.cnpj_empresa, uf: fileInfo.uf });

        status.value = `Motor de Auditoria em execução...`;
        
        // DISPARO AUTOMÁTICO DA ANÁLISE (Fase 11)
        await runAnalysis();
    } catch (error) {
        status.value = `Erro: ${error.message}`;
    } finally {
        setTimeout(() => {
           if (logEventSource) logEventSource.close();
        }, 2000); // Fecha os logs após o redirecionamento
        isUploading.value = false;
    }
}

async function runAnalysis(shouldRedirect = true) {
    if (!idArquivoSped.value) return;
    
    status.value = `Executando Auditoria Digital...`;
    auditErros.value = [];
    
    try {
        await axios.post(`${API_BASE_URL}/api/analisar/${idArquivoSped.value}`);
        const [resErros, resResumo, resEstoque] = await Promise.all([
            axios.get(`${API_BASE_URL}/api/erros/${idArquivoSped.value}`),
            axios.get(`${API_BASE_URL}/api/resumo/${idArquivoSped.value}`),
            axios.get(`${API_BASE_URL}/api/estoque-resumo/${idArquivoSped.value}`).catch(() => ({ data: [] }))
        ]);

        auditErros.value = resErros.data.map(erro => {
            const match = erro.descricao_erro.match(/\*\*(.*?)\*\*/);
            return { ...erro, nome_combustivel: match ? match[1] : 'Geral' };
        });
        auditResumoGerencial.value = resResumo.data;
        auditResumoEstoque.value = resEstoque.data;

        status.value = `Concluído!`;
        if (shouldRedirect) activeTab.value = 'dashboard';
        
        // Sucesso Visual
        showSuccessToast.value = true;
        setTimeout(() => { showSuccessToast.value = false; }, 5000);

        // Scroll suave para o topo
        setTimeout(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
    } catch (error) {
        status.value = `Falha na análise: ${error.message}`;
    }
}

const errosPorTipo = computed(() => {
    const criticos = auditErros.value.filter(e => e.tipo_erro === 'CRITICAL').length;
    const avisos = auditErros.value.filter(e => e.tipo_erro === 'WARNING').length;
    return { criticos, avisos };
});

const availableErrorGroups = computed(() => {
    const groups = new Map();
    auditErros.value.forEach(erro => {
        // Extrai o registro da regra (ex: CRIT-1310-01 -> 1310, RTAX-C170-01 -> C170)
        const parts = erro.regra_id.split('-');
        const groupName = parts.length > 1 ? parts[1] : 'OUTROS';
        groups.set(groupName, (groups.get(groupName) || 0) + 1);
    });
    
    // Converte para array ordenado
    return Array.from(groups.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name));
});

const filteredAuditErros = computed(() => {
    if (activeErrorSubTab.value === 'TODOS') return auditErros.value;
    return auditErros.value.filter(erro => {
        const parts = erro.regra_id.split('-');
        const groupName = parts.length > 1 ? parts[1] : 'OUTROS';
        return groupName === activeErrorSubTab.value;
    });
});

const economiaEstimada = computed(() => {
    return auditErros.value
        .filter(e => e.regra_id === 'RTAX-C170-01')
        .reduce((acc, current) => {
            const match = current.conteudo_linha.match(/Valor: R\$ ([\d,.]+)/);
            if (match) {
                // Remove separador de milhar e troca vírgula por ponto
                const cleanVal = match[1].replace(/\./g, '').replace(',', '.');
                const val = parseFloat(cleanVal);
                return acc + (val * 0.18); // Estimativa conservadora de 18% de ICMS-ST recuperável
            }
            return acc;
        }, 0);
});

const getStatusColor = (score) => {
    if (score < 30) return 'text-emerald-600';
    if (score < 70) return 'text-amber-500';
    return 'text-red-500';
};
</script>

<template>
  <div class="space-y-8 animate-fade-in relative">
    <!-- TOAST DE SUCESSO -->
    <Transition 
      enter-active-class="transform transition ease-out duration-300" 
      enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2" 
      enter-to-class="translate-y-0 opacity-100 sm:translate-x-0" 
      leave-active-class="transition ease-in duration-100" 
      leave-from-class="opacity-100" 
      leave-to-class="opacity-0"
    >
      <div v-if="showSuccessToast" class="fixed top-6 right-6 z-[100] w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-emerald-100 p-6 flex items-start gap-4 ring-1 ring-black/5">
        <div class="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500 text-xl shrink-0 shadow-inner">
          ✨
        </div>
        <div class="space-y-1">
          <h4 class="text-xs font-black text-slate-900 uppercase tracking-tight">Auditoria Concluída!</h4>
          <p class="text-[10px] text-slate-500 font-medium leading-relaxed">Cruzamentos processados. Você foi levado automaticamente aos resultados.</p>
        </div>
        <button @click="showSuccessToast = false" class="text-slate-300 hover:text-slate-500 transition-colors ml-auto">&times;</button>
      </div>
    </Transition>

    <!-- Header de Contexto -->
    <header class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 class="text-3xl font-extrabold text-slate-800 tracking-tight">
          Motor de <span class="text-brand-accent">Auditoria</span>
        </h2>
        <p class="text-slate-500 mt-1">Validação de conformidade e integridade fiscal (Blocos C e 1300)</p>
      </div>
      
      <div v-if="arquivoInfo" class="flex items-center gap-3">
        <div class="flex gap-2 mr-4">
           <button @click="downloadDossie" class="px-4 py-2 bg-white text-brand-accent border border-brand-accent/20 rounded-xl text-xs font-bold hover:bg-brand-accent/5 transition-all flex items-center gap-2 shadow-sm">
             📥 DOSSIÊ PDF
           </button>
           <button @click="downloadExcel" class="px-4 py-2 bg-emerald-600/10 text-emerald-600 border border-emerald-600/20 rounded-xl text-xs font-bold hover:bg-emerald-600/20 transition-all flex items-center gap-2 shadow-sm">
             📊 EXCEL (.XLSX)
           </button>
           <button @click="downloadSpedRetificado" class="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-900 transition-all flex items-center gap-2 shadow-lg shadow-slate-200">
             🛠️ EXPORTAR SPED
           </button>
        </div>
        <div class="flex items-center gap-3 bg-white p-2 pr-4 rounded-full shadow-sm border border-slate-100 italic">
          <div class="w-10 h-10 rounded-full bg-brand-accent/10 flex items-center justify-center text-brand-accent">
            📄
          </div>
          <div class="text-sm">
            <p class="font-bold leading-none">{{ arquivoInfo.periodo }}</p>
            <p class="text-[10px] text-slate-400 font-mono mt-1">{{ arquivoInfo.nome }}</p>
          </div>
        </div>
      </div>
    </header>

    <!-- Tabs Estilizadas -->
    <div class="flex gap-2 p-1 bg-slate-200/50 rounded-xl w-fit">
      <button 
        @click="activeTab = 'novo'"
        :class="activeTab === 'novo' ? 'bg-white shadow-md text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-6 py-2.5 rounded-lg text-sm font-bold transition-all">
        📂 Upload de Arquivo
      </button>
      <button 
        @click="activeTab = 'dashboard'"
        :class="activeTab === 'dashboard' ? 'bg-white shadow-md text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-6 py-2.5 rounded-lg text-sm font-bold transition-all">
        📊 Dashboard Analítico
      </button>
      <button 
        @click="activeTab = 'lmc'"
        :class="activeTab === 'lmc' ? 'bg-white shadow-md text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-6 py-2.5 rounded-lg text-sm font-bold transition-all">
        ⛽ Auditoria LMC
      </button>
      <button 
        @click="activeTab = 'erros'"
        :class="activeTab === 'erros' ? 'bg-white shadow-md text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-6 py-2.5 rounded-lg text-sm font-bold transition-all relative">
        ⚠️ Alertas de Auditoria
        <span v-if="auditErros.length" class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-slate-100">
          {{ auditErros.length }}
        </span>
      </button>
      <button 
        @click="activeTab = 'notas'"
        :class="activeTab === 'notas' ? 'bg-white shadow-md text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-6 py-2.5 rounded-lg text-sm font-bold transition-all relative">
        📑 Consulta de Notas
      </button>
      <button 
        @click="activeTab = 'saidas'"
        :class="activeTab === 'saidas' ? 'bg-white shadow-md text-emerald-600' : 'text-slate-500 hover:text-slate-700'"
        class="px-6 py-2.5 rounded-lg text-sm font-bold transition-all relative">
        🧾 Saídas NF
      </button>
    </div>

    <!-- Conteúdo: NFs Analíticas (C100/170/190) -->
    <div v-if="activeTab === 'notas'" class="space-y-6">
       <div class="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100">
          <div class="p-6 border-b border-slate-50 flex flex-col md:flex-row justify-between items-center bg-slate-50/50 gap-4">
             <div>
                <h3 class="text-lg font-bold text-slate-800">Notas Fiscais vs Produtos</h3>
                <p class="text-xs text-slate-500">Conciliação C100 (Capa), C190 (Resumo) e C170 (Detalhes)</p>
             </div>
             <div class="flex items-center gap-3">
                 <input v-model="buscaNF" type="text" placeholder="Buscar por NF ou Fornecedor" class="px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-accent w-64 shadow-sm" />
             </div>
          </div>
          
          <div v-if="loadingNotas" class="py-20 flex flex-col items-center justify-center text-slate-400">
             <div class="animate-spin text-3xl mb-4 text-brand-accent border-4 border-brand-accent/20 border-t-brand-accent rounded-full w-8 h-8"></div>
             <p class="font-bold text-sm tracking-widest uppercase">PROCESSANDO TABELAS REGISTRO C...</p>
          </div>
          
          <div v-else-if="filteredNotas.length === 0" class="py-20 text-center text-slate-400">
             <p class="text-lg font-bold">Nenhuma Nota Encontrada</p>
          </div>
          
          <div v-else class="overflow-x-auto">
              <table class="w-full text-left">
                  <thead class="bg-white border-b border-slate-200 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                      <tr>
                          <th class="py-4 px-6 w-10"></th>
                          <th class="py-4 px-6">Nº NF</th>
                          <th class="py-4 px-6">Emissão</th>
                          <th class="py-4 px-6">Fornecedor</th>
                          <th class="py-4 px-6 text-right">Valor Declarado (NF)</th>
                          <th class="py-4 px-6 text-center border-l border-slate-100 bg-indigo-50/30">Totais Analítico (C190)</th>
                      </tr>
                  </thead>
                  <tbody class="text-sm font-medium text-slate-600 divide-y divide-slate-100">
                      <template v-for="nf in filteredNotas" :key="nf.id">
                          <tr class="hover:bg-slate-50 cursor-pointer transition-colors" :class="{'bg-slate-50/80': expandedNotas.has(nf.id)}" @click="toggleNota(nf.id)">
                              <td class="py-4 px-6 text-slate-400 font-bold">
                                  {{ expandedNotas.has(nf.id) ? '▼' : '▶' }}
                              </td>
                              <td class="py-4 px-6 font-mono font-bold text-slate-900">#{{ nf.num_doc }}</td>
                              <td class="py-4 px-6">{{ nf.dt_doc ? new Date(nf.dt_doc).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'S/ Data' }}</td>
                              <td class="py-4 px-6 truncate max-w-[200px]" :title="nf.nome_fornecedor">{{ nf.nome_fornecedor || 'Desconhecido' }}</td>
                              <td class="py-4 px-6 text-right font-mono text-slate-900 font-bold">{{ formatCurrency(nf.vl_doc) }}</td>
                              
                              <td class="py-3 px-6 text-right border-l border-slate-100 bg-indigo-50/10">
                                  <div v-if="nf.consolidacao_c190 && nf.consolidacao_c190.length" class="flex flex-col gap-1 items-end">
                                      <div v-for="(c190, idx) in nf.consolidacao_c190" :key="idx" class="flex items-center gap-2 text-[10px]">
                                          <span class="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold" title="CFOP predominante">{{ c190.cfop }}</span>
                                          <span class="text-slate-500">Opr: {{ formatCurrency(c190.vl_opr) }}</span>
                                          <span class="font-black text-indigo-900 border-l border-indigo-200 pl-2">ICMS: {{ formatCurrency(c190.vl_icms) }}</span>
                                      </div>
                                  </div>
                                  <span v-else class="text-xs text-slate-400">Sem C190</span>
                              </td>
                          </tr>
                          
                          <!-- DETALHE C170 -->
                          <tr v-if="expandedNotas.has(nf.id)">
                              <td colspan="7" class="p-0 bg-slate-100/50 border-b-2 border-slate-200 shadow-inner">
                                  <div class="px-14 py-6 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNjYmQ1ZTEiLz48L3N2Zz4=')]">
                                      <div class="flex items-center gap-3 mb-4">
                                          <span class="text-[10px] uppercase font-black tracking-widest text-slate-500 bg-white px-3 py-1 rounded-md shadow-sm border border-slate-200">Itens da Nota (C170)</span>
                                          <span class="text-xs font-bold text-slate-400">Encontrados {{ nf.itens_c170?.length || 0 }} produtos</span>
                                      </div>
                                      
                                      <div v-if="nf.itens_c170 && nf.itens_c170.length > 0" class="bg-white border text-left border-slate-200 rounded-xl shadow-sm overflow-hidden w-full max-w-5xl">
                                          <table class="w-full">
                                              <thead class="bg-slate-50 text-[9px] uppercase tracking-widest text-slate-400 border-b border-slate-200">
                                                  <tr>
                                                      <th class="py-2 px-4 text-center">Item</th>
                                                      <th class="py-2 px-4">Produto</th>
                                                      <th class="py-2 px-4 text-center">CFOP</th>
                                                      <th class="py-2 px-4 text-center">CST</th>
                                                      <th class="py-2 px-4 text-right">Qtd</th>
                                                      <th class="py-2 px-4 text-right border-l border-slate-100">Total Produto</th>
                                                  </tr>
                                              </thead>
                                              <tbody class="divide-y divide-slate-50">
                                                  <tr v-for="item in nf.itens_c170" :key="item.num_item" class="hover:bg-slate-50">
                                                      <td class="py-2 px-4 text-center text-xs font-bold text-slate-400">{{ item.num_item }}</td>
                                                      <td class="py-2 px-4 text-xs font-bold text-slate-700">
                                                          {{ item.descr_item || 'S/N' }} <span class="text-[9px] text-slate-400 font-mono block">{{ item.cod_item }}</span>
                                                      </td>
                                                      <td class="py-2 px-4 text-center text-xs font-mono font-bold text-slate-500">{{ item.cfop }}</td>
                                                      <td class="py-2 px-4 text-center">
                                                          <span class="text-[10px] px-2 py-0.5 rounded font-black bg-slate-100 text-slate-600">{{ item.cst_icms }}</span>
                                                      </td>
                                                      <td class="py-2 px-4 text-right text-xs font-bold font-mono">{{ formatNumber(item.qtd) }} {{ item.unid }}</td>
                                                      <td class="py-2 px-4 text-right border-l border-slate-100 font-mono font-bold text-brand-accent text-xs">{{ formatCurrency(item.vl_item) }}</td>
                                                  </tr>
                                              </tbody>
                                          </table>
                                      </div>
                                      <p v-else class="text-sm text-slate-500 italic">Esta nota não possui detalhes C170 vinculados neste arquivo.</p>
                                  </div>
                              </td>
                          </tr>
                      </template>
                  </tbody>
              </table>
          </div>
       </div>
    </div>

    <!-- Conteúdo: NF de Saída (Modelo 55 e 65) -->
    <div v-if="activeTab === 'saidas'" class="space-y-4">
      <div class="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100">
        <!-- Header + Sub-abas -->
        <div class="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h3 class="text-lg font-bold text-slate-800">Notas Fiscais de Saída</h3>
            <p class="text-xs text-slate-500">Conciliação C100 (Capa), C190 (Resumo) e C170 (Detalhes)</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex gap-1 p-1 bg-slate-200/50 rounded-xl">
              <button @click="activeSaidasSubTab = '65'" :class="activeSaidasSubTab === '65' ? 'bg-white shadow text-emerald-600' : 'text-slate-500'" class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all">🛒 Resumo p/ CFOP (Consumidor)</button>
              <button @click="activeSaidasSubTab = '55'" :class="activeSaidasSubTab === '55' ? 'bg-white shadow text-brand-accent' : 'text-slate-500'" class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all">📄 NF-e (Modelo 55)</button>
            </div>
            <input v-if="activeSaidasSubTab === '55'" v-model="buscaSaidas" type="text" placeholder="Buscar NF ou Cliente..." class="px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-accent w-56 shadow-sm" />
          </div>
        </div>

        <!-- SUB-ABA: MODELO 65 (NFC-e) — Agrupado por CFOP -->
        <div v-if="activeSaidasSubTab === '65'">
          <div v-if="loadingSaidas65" class="py-20 flex flex-col items-center justify-center text-slate-400">
            <div class="animate-spin text-3xl mb-4 text-emerald-500 border-4 border-emerald-200 border-t-emerald-500 rounded-full w-8 h-8"></div>
            <p class="font-bold text-sm tracking-widest uppercase">Carregando NFC-es...</p>
          </div>
          <div v-else-if="saidasMod65.length === 0" class="py-20 text-center text-slate-400">
            <p class="text-lg font-bold">Resumo por CFOP Vazio</p>
            <p class="text-sm mt-1">Não há registros de Saída agrupados (Mod 65 ou 55/5929) neste arquivo.</p>
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-white border-b border-slate-200 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                <tr>
                  <th class="py-4 px-6 w-10"></th>
                  <th class="py-4 px-6">CFOP</th>
                  <th class="py-4 px-6">CST ICMS</th>
                  <th class="py-4 px-6 text-right">Qtd. Notas</th>
                  <th class="py-4 px-6 text-right">Total Operação</th>
                  <th class="py-4 px-6 text-right">BC ICMS</th>
                  <th class="py-4 px-6 text-right">Total ICMS</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                <template v-for="grupo in saidasMod65" :key="grupo.cfop + '-' + grupo.cst_icms">
                  <!-- Linha Master: CFOP -->
                  <tr @click="toggleCfop(grupo.cfop + grupo.cst_icms)" class="hover:bg-emerald-50/50 cursor-pointer transition-colors">
                    <td class="py-4 px-6 text-slate-400 font-bold text-lg">{{ expandedCfops.has(grupo.cfop + grupo.cst_icms) ? '▼' : '▶' }}</td>
                    <td class="py-4 px-6">
                      <span class="text-sm font-black bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg border border-emerald-100">{{ grupo.cfop }}</span>
                    </td>
                    <td class="py-4 px-6">
                      <span class="text-[10px] px-2 py-0.5 rounded font-black bg-slate-100 text-slate-600">{{ grupo.cst_icms }}</span>
                    </td>
                    <td class="py-4 px-6 text-right font-bold text-slate-700">{{ grupo.total_notas }}</td>
                    <td class="py-4 px-6 text-right font-mono font-bold text-slate-900">{{ formatCurrency(grupo.total_vl_opr) }}</td>
                    <td class="py-4 px-6 text-right font-mono text-slate-600">{{ formatCurrency(grupo.total_vl_bc_icms) }}</td>
                    <td class="py-4 px-6 text-right font-mono text-brand-accent font-bold">{{ formatCurrency(grupo.total_vl_icms) }}</td>
                  </tr>
                  <!-- Detalhe: NFs dentro do CFOP -->
                  <tr v-if="expandedCfops.has(grupo.cfop + grupo.cst_icms)">
                    <td colspan="7" class="p-0 bg-emerald-50/30 border-b border-emerald-100">
                      <div class="px-16 py-4">
                        <p class="text-[10px] uppercase font-black tracking-widest text-emerald-600 mb-3">{{ grupo.notas?.length || 0 }} Notas neste CFOP</p>
                        <div class="bg-white border border-emerald-100 rounded-xl overflow-hidden shadow-sm">
                          <table class="w-full text-sm">
                            <thead class="bg-emerald-50 text-[9px] uppercase text-emerald-600 tracking-wider">
                              <tr>
                                <th class="py-2 px-4 text-left">Nº NF</th>
                                <th class="py-2 px-4 text-left">Data Emissão</th>
                                <th class="py-2 px-4 text-left">Cliente</th>
                                <th class="py-2 px-4 text-right">Valor</th>
                                <th class="py-2 px-4 text-center">Ações</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-emerald-50">
                              <tr v-for="nf in grupo.notas" :key="nf.id" class="hover:bg-emerald-50/50">
                                <td class="py-2 px-4 font-mono font-bold text-slate-700">#{{ nf.num_doc }}</td>
                                <td class="py-2 px-4 text-slate-500">{{ nf.dt_doc ? new Date(nf.dt_doc).toLocaleDateString('pt-BR', {timeZone:'UTC'}) : 'S/ Data' }}</td>
                                <td class="py-2 px-4 text-slate-700 truncate max-w-[200px]">{{ nf.nome_cliente || 'Consumidor Final' }}</td>
                                <td class="py-2 px-4 text-right font-mono font-bold" :class="nf.vl_doc_ajustado !== null ? 'text-amber-600' : 'text-emerald-700'">
                                    {{ formatCurrency(nf.vl_doc_ajustado !== null ? nf.vl_doc_ajustado : nf.vl_doc) }}
                                    <span v-if="nf.vl_doc_ajustado !== null" class="block text-[8px] text-slate-400 line-through font-normal">{{ formatCurrency(nf.vl_doc) }}</span>
                                </td>
                                <td class="py-2 px-4 text-center">
                                    <button @click.stop="openNfEdit(nf)" class="p-1.5 hover:bg-emerald-100 rounded-lg text-emerald-600 transition-colors" title="Editar Valor">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                                    </button>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- SUB-ABA: MODELO 55 (NF-e Saída) — Nota por Nota -->
        <div v-if="activeSaidasSubTab === '55'">
          <div v-if="loadingSaidas55" class="py-20 flex flex-col items-center justify-center text-slate-400">
            <div class="animate-spin text-3xl mb-4 text-brand-accent border-4 border-brand-accent/20 border-t-brand-accent rounded-full w-8 h-8"></div>
            <p class="font-bold text-sm tracking-widest uppercase">Carregando NF-es de Saída...</p>
          </div>
          <div v-else-if="filteredSaidas55.length === 0" class="py-20 text-center text-slate-400">
            <p class="text-lg font-bold">Nenhuma NF-e de Saída Encontrada</p>
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left">
                  <thead class="bg-white border-b border-slate-200 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                    <tr>
                      <th class="py-4 px-6 w-10"></th>
                      <th class="py-4 px-6">Nº NF</th>
                      <th class="py-4 px-6">Emissão</th>
                      <th class="py-4 px-6">Cliente</th>
                      <th class="py-4 px-6 text-right">Valor (NF)</th>
                      <th class="py-4 px-6 text-center border-l border-slate-100 bg-brand-accent/5">Totais C190</th>
                      <th class="py-4 px-6 text-center">Ações</th>
                    </tr>
                  </thead>
              <tbody class="divide-y divide-slate-50">
                <template v-for="nf in filteredSaidas55" :key="nf.id">
                  <tr @click="toggleSaida55(nf.id)" class="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td class="py-4 px-6 text-slate-400 font-bold text-lg">{{ expandedSaidas55.has(nf.id) ? '▼' : '▶' }}</td>
                    <td class="py-4 px-6 font-mono font-bold text-slate-900">#{{ nf.num_doc }}</td>
                    <td class="py-4 px-6">{{ nf.dt_doc ? new Date(nf.dt_doc).toLocaleDateString('pt-BR', {timeZone:'UTC'}) : 'S/ Data' }}</td>
                    <td class="py-4 px-6 truncate max-w-[180px]" :title="nf.nome_cliente">{{ nf.nome_cliente }}</td>
                    <td class="py-4 px-6 text-right font-mono font-bold" :class="nf.vl_doc_ajustado !== null ? 'text-amber-600' : 'text-slate-900'">
                        {{ formatCurrency(nf.vl_doc) }}
                        <span v-if="nf.vl_doc_ajustado !== null" class="block text-[8px] text-slate-400 line-through font-normal">{{ formatCurrency(nf.vl_doc_original) }}</span>
                    </td>
                    <td class="py-3 px-6 text-right border-l border-slate-100 bg-brand-accent/5">
                      <div v-if="nf.consolidacao_c190 && nf.consolidacao_c190.length" class="flex flex-col gap-1 items-end">
                        <div v-for="c in nf.consolidacao_c190" :key="c.cfop" class="flex items-center gap-2 text-xs">
                          <span class="bg-brand-accent text-white px-2 py-0.5 rounded text-[10px] font-black">{{ c.cfop }}</span>
                          <span class="text-slate-500">Opr: {{ formatCurrency(c.vl_opr) }}</span>
                          <span class="text-brand-accent font-bold">| ICMS: {{ formatCurrency(c.vl_icms) }}</span>
                        </div>
                      </div>
                      <span v-else class="text-slate-400 text-xs">Sem C190</span>
                    </td>
                    <td class="py-2 px-4 text-center">
                        <button @click.stop="openNfEdit({...nf, id_c190: nf.consolidacao_c190[0]?.id})" class="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-accent transition-colors" title="Editar Valor">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                        </button>
                    </td>
                  </tr>
                  <!-- Detalhe C170 -->
                  <tr v-if="expandedSaidas55.has(nf.id)">
                    <td colspan="6" class="p-0 bg-slate-100/50 border-b-2 border-slate-200 shadow-inner">
                      <div class="px-14 py-6">
                        <span class="text-[10px] uppercase font-black tracking-widest text-slate-500 bg-white px-3 py-1 rounded-md shadow-sm border border-slate-200">Itens da Nota (C170)</span>
                        <span class="text-xs font-bold text-slate-400 ml-2">{{ nf.itens_c170?.length || 0 }} produto(s)</span>
                        <div v-if="nf.itens_c170 && nf.itens_c170.length > 0" class="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                          <table class="w-full">
                            <thead class="bg-slate-50 text-[9px] uppercase tracking-widest text-slate-400 border-b border-slate-200">
                              <tr>
                                <th class="py-2 px-4 text-center">Item</th>
                                <th class="py-2 px-4">Produto</th>
                                <th class="py-2 px-4 text-center">CFOP</th>
                                <th class="py-2 px-4 text-center">CST</th>
                                <th class="py-2 px-4 text-right">Qtd</th>
                                <th class="py-2 px-4 text-right border-l border-slate-100">Total</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-50">
                              <tr v-for="item in nf.itens_c170" :key="item.num_item" class="hover:bg-slate-50">
                                <td class="py-2 px-4 text-center text-xs font-bold text-slate-400">{{ item.num_item }}</td>
                                <td class="py-2 px-4 text-xs font-bold text-slate-700">{{ item.descr_item || 'S/N' }} <span class="text-[9px] text-slate-400 font-mono block">{{ item.cod_item }}</span></td>
                                <td class="py-2 px-4 text-center text-xs font-mono font-bold text-slate-500">{{ item.cfop }}</td>
                                <td class="py-2 px-4 text-center"><span class="text-[10px] px-2 py-0.5 rounded font-black bg-slate-100 text-slate-600">{{ item.cst_icms }}</span></td>
                                <td class="py-2 px-4 text-right text-xs font-bold font-mono">{{ formatNumber(item.qtd) }} {{ item.unid }}</td>
                                <td class="py-2 px-4 text-right border-l border-slate-100 font-mono font-bold text-brand-accent text-xs">{{ formatCurrency(item.vl_item) }}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <p v-else class="text-sm text-slate-500 italic mt-3">Esta nota não possui detalhes C170 neste arquivo.</p>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Conteúdo: Upload (CENTRALIZADO E AUTOMÁTICO) -->
    <div v-if="activeTab === 'novo'" class="flex justify-center items-center py-10 animate-fade-in">
      <div class="bg-white rounded-[40px] p-16 border-2 border-dashed border-slate-200 hover:border-brand-accent/50 transition-all group text-center space-y-8 max-w-2xl w-full shadow-2xl shadow-slate-200/50">
        <div class="w-24 h-24 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto text-5xl group-hover:scale-110 transition-transform shadow-inner">
          {{ isUploading ? '⚙️' : '📥' }}
        </div>
        <div class="space-y-3">
          <h3 class="text-3xl font-black text-slate-800 tracking-tight">
            {{ isUploading ? 'Processando Auditoria' : 'Seleção de Arquivo SPED' }}
          </h3>
          <p class="text-slate-400 text-base font-medium">
            {{ isUploading ? 'Por favor, não feche a página. Nosso motor está validando os dados.' : 'Arraste seu arquivo .txt ou clique para iniciar o fluxo automático' }}
          </p>
        </div>

        <div v-if="!isUploading">
          <label class="inline-block px-12 py-5 bg-brand-accent hover:bg-opacity-90 text-white rounded-2xl font-black cursor-pointer transition-all shadow-xl shadow-brand-accent/30 active:scale-95 text-lg uppercase tracking-widest">
            ESCOLHER ARQUIVO
            <input type="file" @change="handleSpedFile" class="hidden" accept=".txt" />
          </label>
        </div>
        
        <!-- BARRA DE PROGRESSO DINÂMICA (UI REFINADA) -->
        <div v-else class="w-full max-w-md mx-auto space-y-4">
          <div class="flex justify-between items-center text-xs font-black text-slate-500 uppercase tracking-widest px-1">
             <span class="flex items-center gap-2">
                <Loader2 v-if="uploadProgress === 100" class="w-3 h-3 animate-spin text-brand-accent" />
                {{ uploadProgress < 100 ? 'Transmitindo Arquivo' : 'Salvando no Banco' }}
             </span>
             <span class="text-brand-accent text-sm">{{ uploadProgress }}%</span>
          </div>
          <div class="h-4 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200 p-1">
             <div 
               class="h-full bg-gradient-to-r from-blue-500 to-brand-accent rounded-full transition-all duration-500 ease-out shadow-lg"
               :style="{ width: `${uploadProgress}%` }"
             ></div>
          </div>
          <p class="text-xs text-slate-400 font-bold uppercase tracking-wider animate-pulse italic">{{ uploadMessage }}</p>
        </div>

        <div v-if="!isUploading && status" class="pt-4 border-t border-slate-50">
           <p class="text-[10px] text-slate-400 uppercase font-black tracking-[0.2em] leading-relaxed">{{ status }}</p>
        </div>

        <!-- CONSOLE DO MOTOR (TERMINAL REAL-TIME) -->
        <div v-if="isUploading" class="w-full mt-6 animate-in slide-in-from-bottom-4 duration-700">
           <div class="bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden font-mono text-left">
              <div class="bg-slate-800 px-4 py-2 flex items-center justify-between border-b border-slate-700">
                 <div class="flex gap-1.5">
                    <div class="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-yellow-500/50"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
                 </div>
                 <span class="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Motor de Auditoria - Live Stream</span>
              </div>
              <div 
                ref="terminalContainer"
                class="p-4 h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent space-y-1.5"
              >
                  <div v-for="(log, idx) in terminalLogs" :key="idx" class="text-xs flex gap-3">
                     <span v-if="log.time" class="text-slate-600 shrink-0">[{{ log.time }}]</span>
                     <span :class="{
                        'text-emerald-400': log.type === 'log',
                        'text-blue-400 font-bold': log.type === 'sys',
                        'text-slate-300': !log.type
                     }">{{ log.msg }}</span>
                  </div>
                  <div v-if="uploadProgress === 100" class="flex items-center gap-2 text-emerald-500/50 text-[10px] animate-pulse">
                     <span>>_</span>
                     <span class="h-3 w-1 bg-emerald-500"></span>
                  </div>
              </div>
           </div>
        </div>
      </div>
    </div>

    <!-- Conteúdo: Dashboard Analítico -->
    <div v-if="activeTab === 'dashboard'" class="space-y-6 animate-fade-in">
      
      <!-- Linha Macro: Faturamento e Compras (Ultra-Compact) -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Faturamento</span>
                  <span class="text-xl font-black text-slate-900">{{ formatCurrency(auditResumoGerencial?.total_saidas) }}</span>
              </div>
              <div class="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-500 scale-90 group-hover:scale-105 transition-transform">📈</div>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Compras</span>
                  <span class="text-xl font-black text-slate-900">{{ formatCurrency(auditResumoGerencial?.total_entradas) }}</span>
              </div>
              <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500 scale-90 group-hover:scale-105 transition-transform">📦</div>
          </div>

          <!-- Total Litros: Compras e Vendas -->
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Compras (L)</span>
                  <span class="text-xl font-black text-slate-900">{{ formatNumber(totalVolumeCompra) }} L</span>
              </div>
              <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500 scale-90 group-hover:scale-105 transition-transform">🚛</div>
          </div>

          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Vendas (L)</span>
                  <span class="text-xl font-black text-slate-900">{{ formatNumber(totalVolumeVenda) }} L</span>
              </div>
              <div class="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-500 scale-90 group-hover:scale-105 transition-transform">⛽</div>
          </div>

          <!-- Cards Dinâmicos de Combustíveis (Compactos) -->
          <template v-for="comb in auditResumoGerencial?.resumoCombustiveis" :key="comb.tipo">
              <div class="bg-slate-900 p-4 rounded-2xl border border-slate-800 shadow-lg flex flex-col justify-between group relative overflow-hidden">
                  <div class="flex justify-between items-start z-10">
                      <div class="flex flex-col">
                          <span class="text-[8px] font-black uppercase text-slate-500 tracking-widest">{{ comb.tipo }}</span>
                          <span class="text-base font-black text-white leading-tight">{{ formatNumber(comb.total_litros) }} L</span>
                      </div>
                      <span class="text-lg opacity-30 group-hover:scale-110 transition-transform">⛽</span>
                  </div>
                  <div class="mt-2 pt-2 border-t border-slate-800 flex justify-between items-end z-10">
                      <div class="flex flex-col">
                          <span class="text-[8px] font-bold text-emerald-500 uppercase">Custo</span>
                          <span class="text-xs font-black text-white">{{ formatCurrency(comb.custo_medio) }}/L</span>
                      </div>
                      <div class="text-[8px] text-slate-500 text-right">
                         Inv: {{ formatCurrency(comb.total_valor) }}
                      </div>
                  </div>
                  <!-- Glow Effect -->
                  <div class="absolute -right-4 -bottom-4 w-12 h-12 bg-emerald-500/10 blur-2xl rounded-full"></div>
              </div>
          </template>
      </div>

      <!-- Área Técnica: Ranking de CFOP e Prevenção -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Ranking de CFOP (Compacto) -->
          <div class="lg:col-span-8 bg-slate-900 p-5 rounded-2xl text-white relative overflow-hidden shadow-xl">
             <div v-if="auditResumoGerencial?.saidasPorCFOP?.length" class="z-10 relative space-y-4">
                 <div class="flex justify-between items-center">
                    <p class="text-slate-400 text-[9px] font-black uppercase tracking-widest">Ranking de Faturamento por CFOP</p>
                    <span class="text-[8px] px-2 py-0.5 bg-white/10 rounded-full text-slate-400 uppercase tracking-tighter">Top 5 Operações</span>
                 </div>
                 <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                     <div v-for="cf in auditResumoGerencial.saidasPorCFOP.slice(0, 4)" :key="cf.cfop" class="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5 hover:bg-white/10 transition-colors">
                         <div class="flex items-center gap-3">
                            <div class="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-[10px] font-black text-emerald-400">#{{ cf.cfop }}</div>
                            <div class="flex flex-col">
                                <span class="text-[10px] font-black leading-tight">Consumo/Saída</span>
                                <span class="text-[8px] text-slate-500 uppercase">Escrituração Fiscal</span>
                            </div>
                         </div>
                         <span class="font-mono text-xs font-bold text-emerald-400">{{ formatCurrency(cf.total_operacao) }}</span>
                     </div>
                 </div>
             </div>
             <div class="absolute -right-6 -bottom-6 text-7xl opacity-5 rotate-12">📊</div>
          </div>

          <!-- Card de Economia (Slim) -->
          <div class="lg:col-span-4 bg-indigo-600 p-5 rounded-2xl text-white relative overflow-hidden group shadow-xl flex flex-col justify-between">
              <div class="z-10">
                  <p class="text-indigo-200 text-[9px] font-black uppercase tracking-widest">Prevenção Financeira</p>
                  <h4 class="text-2xl font-black mt-1 leading-tight">{{ formatCurrency(economiaEstimada) }}</h4>
                  <p class="text-indigo-100 text-[10px] mt-1 opacity-80 leading-relaxed italic">Economia estimada em ICMS-ST em duplicidade.</p>
              </div>
              <button class="z-10 mt-4 px-4 py-2 bg-white text-indigo-600 rounded-xl text-[9px] font-black hover:bg-indigo-50 transition-all w-full shadow-lg">DETALHAR CRÉDITOS</button>
              <div class="absolute -right-4 -bottom-4 text-7xl opacity-10 rotate-12 group-hover:scale-110 transition-transform">💰</div>
          </div>
      </div>
    </div>

    <!-- Conteúdo: Auditoria LMC Especializada -->
    <!-- Conteúdo: Auditoria LMC Especializada -->
    <div v-if="activeTab === 'lmc'" class="space-y-6 animate-fade-in">
        
        <!-- Dashboard de KPIs LMC por Combustível -->
        <div v-if="lmcKpis?.length" class="space-y-4">
            <div v-for="comb in lmcKpis" :key="comb.cod" class="space-y-1.5">
                <div class="flex items-center justify-between px-1">
                    <div class="flex items-center gap-3">
                       <div class="w-1.5 h-6 bg-brand-accent rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]"></div>
                       <h3 class="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                          {{ comb.nome }}
                          <span class="text-[9px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">COD: {{ comb.cod }}</span>
                       </h3>
                    </div>
                    <button @click="openOtimizador(comb)" class="px-3 py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 border border-indigo-100">
                        🚀 Distribuição Inteligente
                    </button>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    <div class="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm transition-all hover:border-slate-200 flex flex-col justify-center relative group">
                        <div class="flex justify-between items-center mb-1">
                            <span class="text-[8px] font-black uppercase text-slate-400 tracking-widest leading-none">Estoque Inicial</span>
                            <button @click="toggleEditStock(comb.cod, comb.estoqueInicial)" title="Ajustar Estoque de Abertura do Mês (Ancoragem)" class="text-slate-300 hover:text-brand-accent transition-colors opacity-0 group-hover:opacity-100">
                                ✏️
                            </button>
                        </div>
                        <p v-if="editingStock[comb.cod] === undefined" class="text-lg font-black text-slate-800 tabular-nums leading-tight">
                            {{ formatNumber(comb.estoqueInicial) }}
                        </p>
                        <div v-else class="flex items-center gap-1 mt-1">
                            <input v-model="editingStock[comb.cod]" type="number" step="0.001" class="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm font-black focus:ring-1 focus:ring-brand-accent outline-none">
                            <button @click="saveInitialStock(comb.cod)" :disabled="savingStock" class="bg-emerald-500 text-white rounded p-1 hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                                <Loader2 v-if="savingStock" class="w-3 h-3 animate-spin"/>
                                <span v-else>✅</span>
                            </button>
                        </div>
                    </div>
                    
                    <div class="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm transition-all hover:border-slate-200 flex flex-col justify-center">
                        <span class="text-[8px] font-black uppercase text-slate-400 tracking-widest text-emerald-500 leading-none mb-1">Entradas</span>
                        <p class="text-lg font-black text-slate-800 tabular-nums leading-tight">+{{ formatNumber(comb.totalEntradas) }}</p>
                    </div>
                    
                    <div class="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm transition-all hover:border-slate-200 flex flex-col justify-center">
                        <span class="text-[8px] font-black uppercase text-slate-400 tracking-widest text-amber-500 leading-none mb-1">Saídas</span>
                        <p class="text-lg font-black text-slate-800 tabular-nums leading-tight">-{{ formatNumber(comb.totalSaidas) }}</p>
                    </div>
                    
                    <div class="bg-slate-900 p-3 rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-center relative overflow-hidden group">
                        <span class="text-[8px] font-black uppercase text-slate-500 tracking-widest leading-none mb-1">Quebra Líquida</span>
                        <p class="text-lg font-black tabular-nums leading-tight z-10" :class="comb.quebraLiquida >= 0 ? 'text-emerald-400' : 'text-rose-400'">
                            {{ comb.quebraLiquida > 0 ? '+' : '' }}{{ formatNumber(comb.quebraLiquida) }} L
                        </p>
                        <span class="text-[9px] font-mono font-bold z-10 mt-1" :class="comb.variacaoMensalPerc > 0.6 ? 'text-rose-400 animate-pulse' : 'text-slate-400'">
                            VAR: {{ comb.variacaoMensalPerc.toFixed(3) }}%
                        </span>
                        <div class="absolute -right-2 -bottom-2 text-2xl opacity-10 group-hover:scale-110 transition-transform">⚖️</div>
                    </div>
                    
                    <div class="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm transition-all hover:border-slate-200 flex flex-col justify-center relative group">
                        <span class="text-[8px] font-black uppercase text-slate-400 tracking-widest leading-none mb-1">Saldo Transportado (M+1)</span>
                        <p class="text-lg font-black text-slate-800 tabular-nums leading-tight">{{ formatNumber(comb.estoqueFinal) }}</p>
                    </div>
                    
                    <div class="p-3 rounded-2xl border flex flex-col justify-center transition-all" 
                         :class="comb.irregularidades > 0 ? 'bg-rose-50/50 border-rose-100 shadow-sm' : 'bg-emerald-50/30 border-emerald-100 shadow-sm'">
                        <span class="text-[8px] font-black uppercase tracking-widest leading-none mb-1"
                              :class="comb.irregularidades > 0 ? 'text-rose-500' : 'text-emerald-500'">
                              Status Operacional
                        </span>
                        <p class="text-xs font-black uppercase tracking-tighter" :class="comb.irregularidades > 0 ? 'text-rose-600' : 'text-emerald-600'">
                            {{ comb.irregularidades > 0 ? comb.irregularidades + ' Irregularidade(s)' : '✅ Em Conformidade' }}
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Barra de Filtros e Configurações -->
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-wrap items-center gap-4 justify-between">
            <div class="flex items-center gap-4">
                <div class="relative">
                    <input v-model="lmcFilters.search" type="text" placeholder="Filtrar combustível..." class="pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-xs focus:ring-1 focus:ring-brand-accent w-48">
                    <span class="absolute left-3 top-2.5 opacity-30 text-sm">🔍</span>
                </div>
                <input v-model="lmcFilters.date" type="date" class="px-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold text-slate-500">
                <label class="flex items-center gap-2 cursor-pointer group">
                    <input v-model="lmcFilters.onlyErrors" type="checkbox" class="w-3.5 h-3.5 rounded border-slate-300 text-brand-accent focus:ring-brand-accent focus:ring-1">
                    <span class="text-[10px] font-bold text-slate-400 group-hover:text-slate-600 uppercase tracking-widest">Ver apenas falhas</span>
                </label>
            </div>
            <button @click="openLmcConfig" class="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg">
                ⚙️ CONFIGURAR TANQUES
            </button>
        </div>

        <!-- Tabela LMC Expandida -->
        <div class="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100">
             <div class="overflow-x-auto">
                 <table class="w-full text-left">
                    <thead class="bg-slate-50/50">
                       <tr class="text-[9px] text-slate-400 uppercase font-black tracking-widest border-b border-slate-100">
                          <th class="px-6 py-4">Data Mov.</th>
                          <th class="px-6 py-4">Combustível</th>
                          <th class="px-6 py-4 text-center">Capacidade</th>
                          <th class="px-6 py-4 text-right">Est. Inicial</th>
                          <th class="px-6 py-4 text-right">Entradas</th>
                          <th class="px-6 py-4 text-right">Escritural</th>
                          <th class="px-6 py-4 text-right">Físico</th>
                          <th class="px-6 py-4 text-right border-l border-slate-50">Diferença (L)</th>
                          <th class="px-6 py-4 text-right">Variação %</th>
                          <th class="px-6 py-4 text-right text-rose-500">Excesso</th>
                          <th class="px-6 py-4 text-center">Status ANP</th>
                       </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50">
                       <tr v-for="item in filteredLmc" :key="item.id_movimento" class="hover:bg-slate-50/30 transition-colors group">
                          <td class="px-6 py-4 font-mono text-[11px] text-slate-500">{{ new Date(item.data_movimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) }}</td>
                          <td class="px-6 py-4">
                             <div class="flex flex-col">
                                <span class="text-xs font-bold text-slate-700">{{ item.nome_combustivel }}</span>
                                <span class="text-[9px] text-slate-400 font-mono">{{ item.cod_item }}</span>
                             </div>
                          </td>
                          <td class="px-6 py-4 text-center font-mono text-[11px] font-bold text-slate-400">
                            {{ item.capacidade_tanque > 0 ? formatNumber(item.capacidade_tanque) + ' L' : 'Não Definido' }}
                          </td>

                          <td class="px-6 py-4 text-right font-mono text-xs text-slate-600">{{ formatNumber(item.estq_abert_final || item.estq_abert) }}</td>
                          <td class="px-6 py-4 text-right font-mono text-xs text-emerald-600">{{ formatNumber(item.vol_entr_lmc) }}</td>
                          <td class="px-6 py-4 text-right font-mono text-xs text-slate-600">{{ formatNumber(item.estq_escr_final) }}</td>
                          <td class="px-6 py-4 text-right font-mono text-xs font-black text-slate-800">{{ formatNumber(item.fech_fisico_final) }}</td>
                          <td class="px-6 py-4 text-right border-l border-slate-50">
                             <span :class="item.variacao_litros >= 0 ? 'text-emerald-600' : 'text-rose-600'" class="text-xs font-mono font-bold">
                                {{ item.variacao_litros > 0 ? '+' : '' }}{{ formatNumber(item.variacao_litros) }}
                             </span>
                          </td>
                          <td class="px-6 py-4 text-right">
                             <span :class="item.variacao_percentual > 0.6 ? 'text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded' : 'text-slate-500'" class="text-[11px] font-mono">
                                {{ item.variacao_percentual.toFixed(3) }}%
                             </span>
                          </td>
                          <td class="px-6 py-4 text-right font-mono text-[11px] font-black" :class="item.excesso > 0 ? 'text-rose-600 underline decoration-rose-200' : 'text-slate-300'">
                            {{ item.excesso > 0 ? formatNumber(item.excesso) + ' L' : '0,000' }}
                          </td>
                          <td class="px-6 py-4 text-center">
                             <div class="flex justify-center">
                                <span v-if="item.status_anp === 'CONFORME'" class="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[9px] font-black rounded border border-emerald-100">DENTRO LIMITE</span>
                                <span v-else-if="item.status_anp === 'FORA LIMITE'" class="px-2 py-0.5 bg-rose-50 text-rose-600 text-[9px] font-black rounded border border-rose-100 animate-pulse">FORA LIMITE</span>
                                <span v-else-if="item.status_anp === 'EXCESSO'" class="px-2 py-0.5 bg-amber-50 text-amber-600 text-[9px] font-black rounded border border-amber-100">EXCESSO TANQUE</span>
                                <span v-else class="px-2 py-0.5 bg-slate-900 text-white text-[9px] font-black rounded border border-slate-800">NEGATIVO</span>
                             </div>
                          </td>
                       </tr>
                       <tr v-if="filteredLmc.length === 0">
                           <td colspan="11" class="py-12 text-center text-slate-400 italic text-sm">Nenhum registro encontrado para os filtros selecionados.</td>
                       </tr>
                    </tbody>
                 </table>
             </div>
        </div>
    </div>

    <!-- Conteúdo: Lista de Erros -->
    <div v-if="activeTab === 'erros'" class="space-y-6">
       <!-- Navegação de Sub-abas de Erros -->
       <div v-if="auditErros.length > 0" class="flex flex-wrap gap-2 pb-2 border-b border-slate-100 max-w-4xl mx-auto">
          <button 
            @click="activeErrorSubTab = 'TODOS'"
            :class="activeErrorSubTab === 'TODOS' ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'"
            class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2"
          >
            📋 TODOS <span class="bg-white/20 px-1.5 py-0.5 rounded-md text-[8px]">{{ auditErros.length }}</span>
          </button>
          
          <button 
            v-for="group in availableErrorGroups" 
            :key="group.name"
            @click="activeErrorSubTab = group.name"
            :class="activeErrorSubTab === group.name ? 'bg-brand-accent text-white shadow-md border-brand-accent' : 'bg-white text-slate-500 hover:bg-slate-50 border-slate-200'"
            class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2"
          >
            📦 REG. {{ group.name }} <span class="bg-white/20 px-1.5 py-0.5 rounded-md text-[8px]">{{ group.count }}</span>
          </button>
       </div>

       <div v-if="auditErros.length === 0" class="text-center py-20 bg-white rounded-3xl border border-slate-100 space-y-4 shadow-sm">
          <div class="text-5xl">🎉</div>
          <h3 class="text-2xl font-bold text-slate-800">Nenhum erro encontrado!</h3>
          <p class="text-slate-400">Seu arquivo SPED está 100% em conformidade com as regras atuais.</p>
       </div>
       
       <div v-else class="max-w-4xl mx-auto space-y-4">
          <div v-for="erro in filteredAuditErros" :key="erro.id" 
            class="bg-white rounded-2xl overflow-hidden border-l-4 shadow-sm hover:shadow-md transition-shadow group"
            :class="erro.tipo_erro === 'CRITICAL' ? 'border-red-500' : 'border-amber-400'">
            
            <div class="p-6">
               <div class="flex justify-between items-start mb-2">
                  <span class="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded" :class="erro.tipo_erro === 'CRITICAL' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'">
                     {{ erro.regra_id }} • {{ erro.tipo_erro }}
                  </span>
                  <p class="text-[10px] text-slate-400 font-mono">{{ erro.cod_item_erro || 'Geral' }}</p>
               </div>
               <h4 class="text-lg font-bold text-slate-800 group-hover:text-brand-accent transition-colors">{{ erro.titulo_erro }}</h4>
               <p class="text-slate-500 text-sm mt-2 leading-relaxed">{{ erro.descricao_erro }}</p>
               
               <div class="mt-4 bg-slate-900 rounded-xl p-4 text-xs font-mono text-emerald-400 relative overflow-hidden border border-slate-800 shadow-inner">
                  <div class="absolute left-0 top-0 h-full w-1 bg-emerald-500/50"></div>
                  <pre class="whitespace-pre-wrap">{{ erro.conteudo_linha }}</pre>
               </div>
               
               <div class="mt-4 flex items-center justify-between">
                  <div class="text-xs bg-slate-50 text-slate-500 px-3 py-1.5 rounded-lg border border-slate-100 italic">
                     💡 <strong>Sugestão:</strong> {{ erro.sugestao_correcao }}
                  </div>
                  <div class="flex gap-2">
                    <button v-if="erro.regra_id === 'RTAX-C170-01'" 
                      @click="applyBulkCorrection(erro.regra_id)"
                      class="px-4 py-1.5 bg-emerald-600/10 text-emerald-600 text-[10px] font-black rounded-lg hover:bg-emerald-600/20 transition-colors">
                      CORRIGIR TODOS
                    </button>
                    <button v-if="erro.regra_id === 'RTAX-C170-01'" 
                      @click="openCorrection(erro)"
                      class="px-4 py-1.5 bg-brand-accent text-white text-[10px] font-black rounded-lg hover:bg-blue-700 transition-colors shadow-md">
                      EXECUTAR CURA
                    </button>
                  </div>
               </div>
            </div>
          </div>
       </div>
    </div>

    <!-- Modal de Cura Simplificado -->
    <div v-if="showCorrectionModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
       <div class="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6">
          <h3 class="text-xl font-bold flex items-center gap-2 text-brand-accent">
            🔮 Máquina de Cura: Retificação
          </h3>
          <p class="text-sm text-slate-500">Insira o novo código de **CST ICMS** para retificar este item no SPED automaticamente.</p>
          
          <div class="space-y-2">
             <label class="text-[10px] font-black uppercase text-slate-400">Novo CST Sugerido (Ex: 060)</label>
             <input v-model="correctedValue" type="text" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-lg focus:ring-2 focus:ring-brand-accent outline-none transition-all" placeholder="060" />
          </div>

          <div class="flex gap-3">
             <button @click="showCorrectionModal = false" class="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-2xl transition-colors">CANCELAR</button>
             <button @click="applyCorrection" class="flex-1 py-3 bg-brand-accent text-white font-bold rounded-2xl shadow-lg shadow-brand-accent/20 hover:scale-105 transition-all">APLICAR CURA</button>
          </div>
       </div>
    </div>

    <!-- Modal de Ajuste de NF (5.929 / 65) -->
    <div v-if="showNfEditModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div class="flex justify-between items-start">
                <div>
                   <h3 class="text-xl font-bold text-slate-800">Ajustar Valor NF #{{ nfToEdit?.num_doc }}</h3>
                   <p class="text-xs text-slate-400 font-mono">Chave: {{ nfToEdit?.chv_nfe || 'N/A' }}</p>
                </div>
                <button @click="showNfEditModal = false" class="text-slate-300 hover:text-slate-500">✕</button>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1.5">
                    <label class="text-[10px] font-black uppercase text-slate-400">Total da Nota (C100)</label>
                    <input v-model.number="nfEditForm.vl_doc" type="number" step="0.01" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-brand-accent outline-none" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-[10px] font-black uppercase text-slate-400">Valor Operação (C190)</label>
                    <input v-model.number="nfEditForm.vl_opr" type="number" step="0.01" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-brand-accent outline-none" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-[10px] font-black uppercase text-slate-400">BC ICMS (C190)</label>
                    <input v-model.number="nfEditForm.vl_bc_icms" type="number" step="0.01" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-brand-accent outline-none" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-[10px] font-black uppercase text-slate-400">Valor ICMS (C190)</label>
                    <input v-model.number="nfEditForm.vl_icms" type="number" step="0.01" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-brand-accent outline-none" />
                </div>
            </div>

            <div class="flex gap-3 pt-2">
                <button @click="showNfEditModal = false" class="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-2xl transition-colors">CANCELAR</button>
                <button @click="saveNfEdit" class="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-2xl shadow-lg shadow-emerald-200 hover:scale-105 transition-all">SALVAR AJUSTES</button>
            </div>
        </div>
    </div>

    <!-- Modal de Distribuição Inteligente (Otimizador LMC) -->
    <div v-if="showOtimizadorModal" class="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-[70] p-4">
        <div class="bg-white rounded-[40px] p-10 max-w-xl w-full shadow-2xl space-y-8 animate-fade-in relative overflow-hidden">
            <!-- Background Decoration -->
            <div class="absolute -right-20 -top-20 w-64 h-64 bg-brand-accent/5 rounded-full blur-3xl"></div>
            
            <div class="relative z-10 flex justify-between items-start">
                <div class="space-y-1">
                   <div class="inline-flex items-center gap-2 px-3 py-1 bg-brand-accent/10 rounded-full">
                      <span class="w-1.5 h-1.5 bg-brand-accent rounded-full animate-pulse"></span>
                      <span class="text-[10px] font-black text-brand-accent uppercase tracking-widest">Motor Matemático V2</span>
                   </div>
                   <h3 class="text-3xl font-black text-slate-800 tracking-tighter">
                      Distribuição <span class="text-brand-accent">Inteligente</span>
                   </h3>
                   <p class="text-sm text-slate-400 font-medium leading-relaxed">
                      Reconstruir medições e vendas para: <span class="bg-slate-100 px-2 py-0.5 rounded font-black text-slate-600">{{ productToOtimizar?.nome }}</span>
                   </p>
                </div>
                <button @click="showOtimizadorModal = false" class="w-10 h-10 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-400 transition-colors">✕</button>
            </div>

            <div class="relative z-10 bg-slate-50 rounded-3xl p-8 border border-slate-100 space-y-6 shadow-inner">
                <div class="space-y-4">
                    <div class="flex justify-between items-end">
                        <label class="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none">Meta de Volume Mensal (Vendas)</label>
                        <span class="text-[9px] font-mono font-bold text-slate-400">Referência atual: {{ formatNumber(productToOtimizar?.totalSaidas) }} L</span>
                    </div>
                    <div class="relative">
                        <input v-model.number="targetVolume" type="number" step="0.001" class="w-full bg-white border-2 border-slate-100 focus:border-brand-accent rounded-2xl px-6 py-5 text-2xl font-black tabular-nums transition-all outline-none shadow-sm">
                        <div class="absolute right-6 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300">LITROS</div>
                    </div>
                </div>
                
                <div class="bg-indigo-50/50 rounded-2xl p-5 border border-indigo-100/50 flex items-start gap-4">
                    <div class="text-2xl pt-0.5">🛡️</div>
                    <div class="space-y-1">
                        <p class="text-[10px] font-black text-indigo-700 uppercase tracking-widest">Garantia de Conformidade</p>
                        <p class="text-xs text-indigo-600/70 font-medium leading-relaxed italic">
                            O motor aplicará ruído orgânico artificial respeitando a variação legal de **0,55%** e ajustará as medições automaticamente para este volume.
                        </p>
                    </div>
                </div>
            </div>

            <div class="relative z-10 flex gap-4">
                <button @click="showOtimizadorModal = false" :disabled="savingOtimizacao" class="flex-1 py-5 text-slate-400 font-black hover:bg-slate-50 rounded-2xl transition-all uppercase tracking-widest text-xs">CANCELAR</button>
                <button @click="startOtimizacao" :disabled="savingOtimizacao" class="flex-[2] py-5 bg-slate-900 text-white font-black rounded-2xl shadow-2xl shadow-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-3 group uppercase tracking-widest text-xs">
                    <span v-if="savingOtimizacao" class="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></span>
                    <span v-else class="group-hover:translate-x-1 transition-transform">🚀</span>
                    {{ savingOtimizacao ? 'DISTRIBUINDO...' : 'INICIAR DISTRIBUIÇÃO' }}
                </button>
            </div>
        </div>
    </div>

    <!-- Modal de Configuração de Tanques (Capacidades) -->
    <div v-if="showLmcConfigModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
        <div class="bg-white rounded-3xl p-8 max-w-xl w-full shadow-2xl space-y-6 animate-fade-in">
            <div class="flex justify-between items-start">
                <div>
                   <h3 class="text-2xl font-black text-slate-800 tracking-tighter">⛓️ Configuração de <span class="text-brand-accent">Tanques</span></h3>
                   <p class="text-sm text-slate-400 font-medium">Defina a capacidade máxima de armazenamento para cada produto.</p>
                </div>
                <button @click="showLmcConfigModal = false" class="w-10 h-10 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-400 transition-colors">✕</button>
            </div>

            <div class="max-h-[400px] overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                <div v-for="conf in tankConfigs" :key="conf.cod_item" class="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between gap-4">
                    <div class="flex flex-col">
                        <span class="text-xs font-black text-slate-700">{{ conf.descr_item }}</span>
                        <span class="text-[9px] font-mono text-slate-400">COD: {{ conf.cod_item }}</span>
                    </div>
                    <div class="relative w-40">
                        <input v-model.number="conf.capacidade" type="number" step="0" class="w-full bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-4 py-2 text-right font-black tabular-nums transition-all outline-none text-sm">
                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[8px] font-black text-slate-300 uppercase">Litros</span>
                    </div>
                </div>
            </div>

            <div class="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-start gap-3">
                <div class="text-xl">💡</div>
                <p class="text-[10px] text-amber-700 font-medium leading-relaxed italic">
                    As capacidades são usadas para validar o **Status ANP** e identificar excessos de estoque no LMC.
                </p>
            </div>

            <div class="flex gap-3 mt-2">
                <button @click="showLmcConfigModal = false" class="flex-1 py-4 text-slate-500 font-bold hover:bg-slate-100 rounded-2xl transition-colors uppercase tracking-widest text-xs">CANCELAR</button>
                <button @click="saveLmcConfig" :disabled="savingLmcConfig" class="flex-[2] py-4 bg-slate-900 text-white font-black rounded-2xl shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
                    <Loader2 v-if="savingLmcConfig" class="w-4 h-4 animate-spin"/>
                    {{ savingLmcConfig ? 'SALVANDO...' : 'SALVAR CAPACIDADES' }}
                </button>
            </div>
        </div>
    </div>
  </div>
</template>

<style>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
