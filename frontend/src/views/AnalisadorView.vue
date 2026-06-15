<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import VueApexCharts from "vue3-apexcharts";
import { useRoute, useRouter } from 'vue-router'
import { empresaSelecionada, setArquivoInfo, setEmpresaSelecionada, idArquivoSped, setIdArquivoSped, arquivoInfo, auditErros, auditResumoGerencial, auditResumoEstoque, resetArquivoSped, token } from '../store'
import { Loader2 } from 'lucide-vue-next'
import NfItens from '../components/NfItens.vue'

const route = useRoute();
const router = useRouter();

const status = ref('Pronto para iniciar');
const spedButtonDisabled = ref(false);
// Dashboard como primeira aba quando ja ha um arquivo carregado; senao, Upload.
const activeTab = ref(arquivoInfo.value ? 'dashboard' : 'novo');
const showCorrectionModal = ref(false);
const itemToCorrect = ref(null);
const correctedValue = ref('');
const activeErrorSubTab = ref('TODOS');
const showSuccessToast = ref(false);
const showLmcConfigModal = ref(false);
const tankConfigs = ref([]);
// Cadastro de lacres das bombas (registro 1360)
const showLacresModal = ref(false);
const lacresBombas = ref([]); // [{ serie, fabricante, modelo, temLacre, lacres:[{num_lacre, dt_aplicacao}] }]
const lacresCnpj = ref('');
const savingLacres = ref(false);
// Cadastro de credenciadoras (participantes do 1601 — injeta 0150 completo)
const showCredModal = ref(false);
const credList = ref([]); // [{ cnpj, nome, ie, cod_mun, endereco, num, bairro }]
const savingCred = ref(false);

// --- Estado de Upload e Progresso ---
const isUploading = ref(false);
const uploadProgress = ref(0);
const uploadMessage = ref('');
const terminalLogs = ref([]);
const terminalContainer = ref(null);
let logEventSource = null;

// --- Alerta de LMC incompleto (Registro 1300 com dias faltantes) ---
const avisosLmcUpload = ref(null);
const showLmcLacunaModal = ref(false);

// --- Alerta de sequência de período ---
const showSequenciaModal = ref(false);
const sequenciaInfo = ref(null);
let pendingUploadFile = null;

// --- Arquivos recentes da empresa + linha do tempo de meses (camada de seguranca visual) ---
const arquivosRecentes = ref([]);
const loadingRecentes = ref(false);
const sequenciaTimeline = ref([]);   // [{ mes:'YYYY-MM', carregado, ativo, id }]
const sequenciaAlerta = ref(null);   // { faltantes:[...], mesAtivo } quando ha lacuna

function mesDoPeriodo(p) {
    // 'YYYY-MM-DD a ...' -> 'YYYY-MM'
    if (!p || !/^\d{4}-\d{2}/.test(p)) return null;
    return p.substring(0, 7);
}
function fmtMes(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return `${m}/${y}`;
}
function addMeses(ym, n) {
    let [y, m] = ym.split('-').map(Number);
    m += n;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return `${y}-${String(m).padStart(2, '0')}`;
}

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

// --- Accordion LMC por Combustível ---
const expandedFuels = ref({});
function toggleFuel(cod) {
    expandedFuels.value = { ...expandedFuels.value, [cod]: !expandedFuels.value[cod] };
}
function lmcDoCombustivel(cod) {
    return filteredLmc.value.filter(item => item.cod_item === cod);
}

// --- Estado Auditoria Sintática Flash (Fase 1) ---
const infractions = ref({
    c100_valores_divergentes: [],
    c100_sem_c190: [],
    c100_saltos_enumeracao: [],
    h010_divergente_1300: [],
    cfop_suspeitos: [],
    bicos_duplicados_1320: [],
    chv_nfe_cnpj_divergente: []
});
const loadingSintaxe = ref(false);
const totalInfractions = computed(() => {
    return Object.values(infractions.value).reduce((acc, curr) => acc + curr.length, 0);
});


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
// Cache da NFe completa (Cálculo do Imposto + todos os campos) por id da nota
const nfeCompletaCache = ref({});   // { [notaId]: { loading, fonte, nfe, motivo, erro } }
const nfeGruposAbertos = ref(new Set()); // grupos recolhíveis abertos: chave `${notaId}::${grupo}`

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
        const nota = notasAnaliticas.value.find(n => n.id === id);
        if (nota && nota.chv_nfe) carregarNfeCompleta(id, nota.chv_nfe);
    }
}

// Busca (lazy + cache) a NFe completa pela chave ao expandir a nota
async function carregarNfeCompleta(notaId, chave) {
    const cached = nfeCompletaCache.value[notaId];
    if (cached && !cached.erro) return; // já buscado com sucesso (ou em andamento); erro permite nova tentativa
    nfeCompletaCache.value = { ...nfeCompletaCache.value, [notaId]: { loading: true } };
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/documentos/nfe-completa/${String(chave).replace(/\D/g, '')}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        nfeCompletaCache.value = { ...nfeCompletaCache.value, [notaId]: { loading: false, fonte: res.data.fonte, nfe: res.data.nfe, motivo: res.data.motivo } };
    } catch (e) {
        nfeCompletaCache.value = { ...nfeCompletaCache.value, [notaId]: { loading: false, erro: e.response?.data?.message || e.message } };
    }
}

function toggleGrupoNfe(notaId, grupo) {
    const k = `${notaId}::${grupo}`;
    const s = new Set(nfeGruposAbertos.value);
    s.has(k) ? s.delete(k) : s.add(k);
    nfeGruposAbertos.value = s;
}
function grupoNfeAberto(notaId, grupo) {
    return nfeGruposAbertos.value.has(`${notaId}::${grupo}`);
}
// Formata valor numérico da NFe (mantém casas decimais; não mexe em códigos/chaves inteiras)
function fmtValorNfe(v) {
    const s = String(v ?? '');
    const m = s.match(/^-?(\d{1,15})\.(\d{1,6})$/);
    if (m) {
        return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: m[2].length, maximumFractionDigits: m[2].length }).format(Number(s));
    }
    return s;
}
const FONTE_LABEL = {
    persistido: 'XML (injetado)', arquivo: 'XML (pasta speds)', mde_cache: 'XML (Manifesto/MDe)',
    espiao_cache: 'XML (Espião NFe)', sped: 'SPED (XML indisponível)'
};

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
    if (newTab === 'sintaxe') runSyntaxAnalysis();
});

async function runSyntaxAnalysis() {
    if (!idArquivoSped.value) return;
    loadingSintaxe.value = true;
    try {
        const token = localStorage.getItem('token');
        const res = await axios.post(`${API_BASE_URL}/api/arquivos/analisar-sintaxe`, {
            id_arquivo: idArquivoSped.value
        }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        infractions.value = res.data.infractions;
    } catch (e) {
        console.error("Erro na Análise Sintática:", e);
    } finally {
        loadingSintaxe.value = false;
    }
}

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
        await checkContinuidade();
    } catch (e) {
        console.error("Erro ao carregar detalhes LMC:", e);
    } finally {
        loadingLmc.value = false;
    }
}

// ===== Conciliação SEFAZ (CSV) × escrituração (Fase 1) =====
const concilCsvFile = ref(null);
const concilCsvName = ref('');
const concilLoading = ref(false);
const concilError = ref('');
const concilResult = ref(null);
const concilDesconsiderarCanceladas = ref(true); // padrão: ignorar canceladas
const concilVerCanceladas = ref(false);          // mostrar/ocultar a lista de canceladas
const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Re-concilia ao trocar o flag de canceladas (se já houver CSV carregado).
function onToggleCanceladas() {
    if (concilCsvFile.value && concilResult.value) conciliarSefaz();
}

// Expandir "+" para ver os itens (C170) de uma NF escriturada.
const concilNfAberta = ref({});
const concilCnpjAtivo = () => String(empresaSelecionada?.value?.cnpj || arquivoInfo?.value?.cnpj || (concilResult.value && concilResult.value.cnpj_empresa) || '').replace(/\D/g, '');
const limpaChave = (c) => String(c || '').replace(/\D/g, '');
const nfAberta = (chave) => !!concilNfAberta.value[limpaChave(chave)];
function toggleNf(chave) {
    const c = limpaChave(chave);
    if (c.length < 20) return;
    concilNfAberta.value = { ...concilNfAberta.value, [c]: !concilNfAberta.value[c] };
}

function onConcilCsvSelected(e) {
    const f = e.target.files && e.target.files[0];
    concilCsvFile.value = f || null;
    concilCsvName.value = f ? f.name : '';
    concilError.value = '';
    concilResult.value = null;
}

async function conciliarSefaz() {
    concilError.value = '';
    const cnpj = String(empresaSelecionada?.value?.cnpj || arquivoInfo?.value?.cnpj || '').replace(/\D/g, '');
    if (!concilCsvFile.value) { concilError.value = 'Selecione o arquivo CSV da SEFAZ.'; return; }
    if (cnpj.length < 11) { concilError.value = 'Empresa não identificada (CNPJ ausente). Abra um arquivo desta empresa.'; return; }
    concilLoading.value = true;
    concilResult.value = null;
    try {
        const token = localStorage.getItem('token');
        const fd = new FormData();
        fd.append('csv', concilCsvFile.value);
        fd.append('cnpj', cnpj);
        // Escopo: período do SPED aberto — concilia só esse mês (útil p/ CSV semestral).
        if (idArquivoSped.value) fd.append('id_arquivo', idArquivoSped.value);
        fd.append('incluir_canceladas', concilDesconsiderarCanceladas.value ? 'false' : 'true');
        const res = await axios.post(`${API_BASE_URL}/api/conciliacao/sefaz-csv`, fd, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        concilResult.value = res.data;
    } catch (e) {
        concilError.value = e.response?.data?.message || ('Erro ao conciliar: ' + e.message);
    } finally {
        concilLoading.value = false;
    }
}

function exportConcilCsv() {
    const r = concilResult.value; if (!r) return;
    const rows = [['Categoria', 'Numero NF', 'Chave', 'Competencia', 'Emissao', 'Valor / Detalhe', 'Fornecedor']];
    r.faltantes.forEach(f => rows.push([f.uso_consumo ? 'FALTANTE_USO_CONSUMO' : 'FALTANTE', f.numero, f.chave, f.comp, f.data, f.valor, f.fornecedor]));
    r.divergencia_valor.forEach(d => rows.push(['DIVERG_VALOR', d.numero, d.chave, '', '', `SEFAZ ${d.valorSefaz} x SPED ${d.valorSped} (dif ${d.dif})`, d.fornecedor]));
    r.divergencia_competencia.forEach(d => rows.push(['LANCADA_OUTRO_MES', d.numero, d.chave, `Emit ${d.data} -> Lancada ${d.dataSped || d.compSped}`, d.data, d.valor, d.fornecedor]));
    r.extras.forEach(x => rows.push(['EXTRA_SPED', x.numero, x.chave, x.comp, x.data, x.valor, x.fornecedor]));
    (r.sem_sped || []).forEach(s => rows.push(['SEM_SPED_NO_PERIODO', s.numero, s.chave, s.comp, s.data, s.valor, s.fornecedor]));
    (r.canceladas || []).forEach(c => rows.push(['CANCELADA', c.numero, c.chave, c.comp, c.data, c.valor, c.fornecedor]));
    const csv = '\uFEFF' + rows.map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'conciliacao_sefaz.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

const COMBUSTIVEIS_LMC = ['GASOLINA', 'ETANOL', 'ÁLCOOL', 'ALCOOL', 'DIESEL', 'GNV', 'GLP', 'QUEROSENE', 'BIODIESEL'];

const filteredLmc = computed(() => {
    let data = lmcData.value.filter(d => COMBUSTIVEIS_LMC.some(k => (d.nome_combustivel || '').toUpperCase().includes(k)));
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

    const COMBUSTIVEIS = ['GASOLINA', 'ETANOL', 'ÁLCOOL', 'ALCOOL', 'DIESEL', 'GNV', 'GLP', 'QUEROSENE', 'BIODIESEL'];
    return resultado
        .filter(c => COMBUSTIVEIS.some(k => c.nome?.toUpperCase().includes(k)))
        .sort((a, b) => a.nome.localeCompare(b.nome));
});

async function openLmcConfig() {
    // Apenas combustíveis com registro real no 1300 (has_lmc_row = true)
    // Exclui aditivos, filtros e lubrificantes que aparecem só por NF-e de compra
    const produtosNoLmc = [...new Set(lmcData.value.filter(d => d.has_lmc_row === true).map(d => d.cod_item))];

    // Buscar sugestões de capacidade extraídas dos registros 1310 do SPED original
    let sugestoes = [];
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/lmc/tanques-sugeridos/${idArquivoSped.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        sugestoes = res.data;
    } catch (e) {
        console.warn('Não foi possível buscar sugestões de capacidade do SPED:', e);
    }

    const newConfigs = produtosNoLmc.map(cod => {
        const existing = tankConfigs.value.find(c => c.cod_item === cod);
        const descr = lmcData.value.find(d => d.cod_item === cod)?.nome_combustivel || 'Produto';
        const sugerido = sugestoes.find(s => s.cod_item === cod);

        let capacidade = 0;
        let fromSped = false;

        if (existing && Number(existing.capacidade) > 0) {
            capacidade = existing.capacidade;
        } else if (sugerido && sugerido.capacidade > 0) {
            capacidade = sugerido.capacidade;
            fromSped = true;
        }

        return { cod_item: cod, descr_item: descr, capacidade, fromSped };
    });
    tankConfigs.value = newConfigs;
    showLmcConfigModal.value = true;
}

async function saveLmcConfig() {
    savingLmcConfig.value = true;
    try {
        const token = localStorage.getItem('token');
        const configsSanitizadas = tankConfigs.value.map(c => ({
            cod_item: c.cod_item,
            capacidade: (c.capacidade === '' || c.capacidade === null || isNaN(c.capacidade)) ? null : Number(c.capacidade)
        }));
        await axios.post(`${API_BASE_URL}/api/lmc/tanques-config`, {
            cnpj: empresaSelecionada.value.cnpj,
            configs: configsSanitizadas
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

// --- Cadastro de Lacres das bombas (registro 1360) ---
async function openLacresModal() {
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/lmc/lacres-bombas/${idArquivoSped.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        lacresCnpj.value = res.data.cnpj || (empresaSelecionada.value && empresaSelecionada.value.cnpj) || '';
        const porSerie = {};
        for (const l of (res.data.lacres || [])) {
            (porSerie[l.serie_bomba] = porSerie[l.serie_bomba] || []).push({ num_lacre: l.num_lacre, dt_aplicacao: l.dt_aplicacao || '' });
        }
        lacresBombas.value = (res.data.bombas || []).map(b => ({
            serie: b.serie, fabricante: b.fabricante, modelo: b.modelo, temLacre: b.temLacre,
            lacres: (porSerie[b.serie] && porSerie[b.serie].length) ? porSerie[b.serie] : [{ num_lacre: '', dt_aplicacao: '' }]
        }));
        showLacresModal.value = true;
    } catch (e) {
        alert('Erro ao carregar bombas/lacres: ' + (e.response?.data?.message || e.message));
    }
}
function addLacre(b) { b.lacres.push({ num_lacre: '', dt_aplicacao: '' }); }
function removeLacre(b, i) { b.lacres.splice(i, 1); if (!b.lacres.length) b.lacres.push({ num_lacre: '', dt_aplicacao: '' }); }
async function saveLacres() {
    savingLacres.value = true;
    try {
        const token = localStorage.getItem('token');
        const lacres = [];
        for (const b of lacresBombas.value) {
            for (const l of (b.lacres || [])) {
                if ((l.num_lacre || '').trim()) lacres.push({ serie_bomba: b.serie, num_lacre: String(l.num_lacre).trim(), dt_aplicacao: String(l.dt_aplicacao || '').trim() });
            }
        }
        await axios.post(`${API_BASE_URL}/api/lmc/lacres`, { cnpj: lacresCnpj.value, lacres }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        showLacresModal.value = false;
        alert('Lacres salvos. Re-exporte o SPED para injetar os registros 1360.');
    } catch (e) {
        alert('Erro ao salvar lacres: ' + (e.response?.data?.message || e.message));
    } finally {
        savingLacres.value = false;
    }
}

// --- Cadastro de credenciadoras (participantes do 1601 sem 0150) ---
async function openCredModal() {
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/cad/credenciadoras-1601/${idArquivoSped.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        credList.value = (res.data.credenciadoras || []).map(c => ({ ...c }));
        showCredModal.value = true;
    } catch (e) {
        alert('Erro ao carregar credenciadoras: ' + (e.response?.data?.message || e.message));
    }
}
async function saveCred() {
    savingCred.value = true;
    try {
        const token = localStorage.getItem('token');
        await axios.post(`${API_BASE_URL}/api/cad/credenciadoras`, { credenciadoras: credList.value }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        showCredModal.value = false;
        alert('Credenciadoras salvas. Re-exporte o SPED — o 0150 completo será injetado para as que têm município e endereço.');
    } catch (e) {
        alert('Erro ao salvar credenciadoras: ' + (e.response?.data?.message || e.message));
    } finally {
        savingCred.value = false;
    }
}

function openOtimizador(comb) {
    productToOtimizar.value = comb;
    targetVolume.value = Math.round(comb.totalSaidas * 1000) / 1000;
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

// --- Edição Manual de Saída por Dia (cascata) ---
const editingSaida = ref({}); // chave: "cod_item|data_movimento"
const savingSaida = ref(false);

function toggleEditSaida(codItem, dataMov, valorAtual) {
    const key = `${codItem}|${dataMov}`;
    if (editingSaida.value[key] !== undefined) {
        delete editingSaida.value[key];
    } else {
        editingSaida.value[key] = valorAtual;
    }
}

async function saveEditSaida(codItem, dataMov) {
    const key = `${codItem}|${dataMov}`;
    const novoValor = editingSaida.value[key];
    if (novoValor === undefined || !idArquivoSped.value) return;
    savingSaida.value = true;
    try {
        const token = localStorage.getItem('token');
        await axios.post(`${API_BASE_URL}/api/lmc/ajustar-cascata`, {
            id_sped: idArquivoSped.value,
            cod_item: codItem,
            data_mov: dataMov,
            vol_saidas_ajustado: parseFloat(novoValor)
        }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        delete editingSaida.value[key];
        await runAnalysis(false);
        await loadLmcDetailed();
    } catch (e) {
        alert('Erro ao salvar saída: ' + (e.response?.data?.error || e.message));
    } finally {
        savingSaida.value = false;
    }
}

// --- Continuidade de Estoque entre Meses ---
const continuidade = ref({ tem_mes_anterior: false, divergencias: [] });
const sincronizando = ref({});

async function checkContinuidade() {
    if (!idArquivoSped.value) return;
    try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/lmc/continuidade/${idArquivoSped.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        continuidade.value = res.data;
    } catch (e) {
        console.error('Erro ao verificar continuidade:', e);
    }
}

async function sincronizarEstoque(cod, fechamentoAnterior) {
    if (!idArquivoSped.value) return;
    sincronizando.value[cod] = true;
    try {
        const token = localStorage.getItem('token');
        await axios.post(`${API_BASE_URL}/api/lmc/update-estoque-inicial`, {
            id_arquivo: idArquivoSped.value,
            cod_item: cod,
            novo_estoque: parseFloat(fechamentoAnterior)
        }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        await runAnalysis(false);
        await loadLmcDetailed();
        await checkContinuidade();
    } catch (e) {
        alert('Erro ao sincronizar estoque: ' + (e.response?.data?.error || e.message));
    } finally {
        delete sincronizando.value[cod];
    }
}

async function sincronizarTodos() {
    for (const div of continuidade.value.divergencias) {
        await sincronizarEstoque(div.cod_item, div.fechamento_anterior);
    }
}

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
            setIdArquivoSped(res.data.id);
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
    if (empresaSelecionada.value?.id) loadArquivosRecentes();
});

// --- Funções de Exportação ---
function downloadDossie() {
    if (!idArquivoSped.value) return;
    const currentToken = token.value || localStorage.getItem('token');
    const url = `${API_BASE_URL}/api/relatorio/dossie/${idArquivoSped.value}${currentToken ? '?token=' + currentToken : ''}`;
    window.open(url, '_blank');
}

function downloadSpedRetificado() {
    console.log("Tentando exportar SPED ID:", idArquivoSped.value);
    if (!idArquivoSped.value) {
        alert("Nenhum arquivo SPED selecionado para exportação.");
        return;
    }
    const currentToken = token.value || localStorage.getItem('token');
    const url = `${API_BASE_URL}/api/exportar-sped/${idArquivoSped.value}${currentToken ? '?token=' + currentToken : ''}`;
    window.open(url, '_blank');
}

function downloadExcel() {
    if (!idArquivoSped.value) return;
    const currentToken = token.value || localStorage.getItem('token');
    const url = `${API_BASE_URL}/api/relatorio/excel/${idArquivoSped.value}${currentToken ? '?token=' + currentToken : ''}`;
    window.open(url, '_blank');
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
const formatCnpj = (c) => {
    const d = String(c || '').replace(/\D/g, '');
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '');
};

// --- Verificação de Sequência de Período ---
function parseSpedHeader(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const firstLine = text.split('\n')[0] || '';
            const parts = firstLine.split('|');
            // |0000|...|DT_INI|DT_FIN|NOME|CNPJ|...
            if (parts[1] === '0000' && parts.length > 7) {
                const dtIni = parts[3] || ''; // DDMMYYYY
                const cnpj = (parts[7] || '').replace(/\D/g, '');
                resolve({ dtIni, cnpj });
            } else {
                resolve(null);
            }
        };
        reader.onerror = () => resolve(null);
        reader.readAsText(file.slice(0, 2000), 'latin1');
    });
}

async function verificarSequenciaPeriodo(file) {
    const header = await parseSpedHeader(file);
    if (!header || !header.cnpj || !header.dtIni) return true; // não conseguiu ler, prossegue

    // Extrai mês/ano do arquivo sendo carregado
    const mesNovo = parseInt(header.dtIni.substring(2, 4));
    const anoNovo = parseInt(header.dtIni.substring(4, 8));
    if (!mesNovo || !anoNovo) return true;

    // Busca arquivos da empresa pelo CNPJ
    try {
        const token = localStorage.getItem('token');
        const resEmpresas = await axios.get(`${API_BASE_URL}/api/empresas?busca=${header.cnpj}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const empresa = resEmpresas.data?.find(e => e.cnpj?.replace(/\D/g, '') === header.cnpj);
        if (!empresa) return true; // empresa nova, sem histórico

        const resArquivos = await axios.get(`${API_BASE_URL}/api/arquivos/${empresa.id}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const arquivos = resArquivos.data || [];
        if (arquivos.length === 0) return true; // nenhum arquivo anterior

        // Encontra o último período carregado
        const periodos = arquivos.map(a => {
            const p = a.periodo_apuracao || '';
            const m = parseInt(p.substring(5, 7));
            const y = parseInt(p.substring(0, 4));
            return { mes: m, ano: y, label: p };
        }).filter(p => p.mes && p.ano).sort((a, b) => a.ano !== b.ano ? b.ano - a.ano : b.mes - a.mes);

        if (periodos.length === 0) return true;
        const ultimo = periodos[0];

        // Calcula o mês esperado (último + 1)
        const mesEsperado = ultimo.mes === 12 ? 1 : ultimo.mes + 1;
        const anoEsperado = ultimo.mes === 12 ? ultimo.ano + 1 : ultimo.ano;

        if (mesNovo === mesEsperado && anoNovo === anoEsperado) return true; // sequencial

        // Não é sequencial — exibir alerta
        const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        sequenciaInfo.value = {
            empresa: empresa.nome_empresa,
            ultimoPeriodo: `${meses[ultimo.mes]}/${ultimo.ano}`,
            novoPeriodo: `${meses[mesNovo]}/${anoNovo}`,
            esperado: `${meses[mesEsperado]}/${anoEsperado}`
        };
        return false; // não sequencial
    } catch (e) {
        console.warn('Erro ao verificar sequência:', e);
        return true; // em caso de erro, prossegue
    }
}

// --- Processamento ---
async function handleSpedFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Verificação de sequência de período
    status.value = 'Verificando sequência de período...';
    const isSequencial = await verificarSequenciaPeriodo(file);
    if (!isSequencial) {
        pendingUploadFile = file;
        showSequenciaModal.value = true;
        status.value = 'Aguardando confirmação...';
        return;
    }

    await executarUpload(file);
}

function confirmarUploadForaSequencia() {
    showSequenciaModal.value = false;
    const file = pendingUploadFile;
    pendingUploadFile = null;
    if (file) executarUpload(file);
}

function cancelarUploadForaSequencia() {
    showSequenciaModal.value = false;
    pendingUploadFile = null;
    status.value = 'Upload cancelado — período fora de sequência.';
}

async function executarUpload(file) {
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
        loadArquivosRecentes();

        // Alerta de LMC incompleto (dias do período sem Registro 1300, por produto).
        if (response.data.avisos_lmc?.tem_lacuna) {
            avisosLmcUpload.value = response.data.avisos_lmc;
            showLmcLacunaModal.value = true;
        } else {
            avisosLmcUpload.value = null;
        }

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

// --- Arquivos recentes da empresa (alimenta painel lateral do Upload + linha do tempo) ---
async function loadArquivosRecentes() {
    if (!empresaSelecionada.value?.id) return;
    loadingRecentes.value = true;
    try {
        const t = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/arquivos/${empresaSelecionada.value.id}`, {
            headers: t ? { Authorization: `Bearer ${t}` } : {}
        });
        const lista = (res.data || [])
            .map(a => ({ ...a, mes: mesDoPeriodo(a.periodo_apuracao) }))
            .filter(a => a.mes)
            .sort((a, b) => a.mes.localeCompare(b.mes)); // ordena por competencia (nao por upload)
        arquivosRecentes.value = lista;
        construirTimeline(lista);
    } catch (e) {
        console.warn('Erro ao carregar arquivos recentes:', e.message);
    } finally {
        loadingRecentes.value = false;
    }
}

function construirTimeline(lista) {
    if (!lista.length) { sequenciaTimeline.value = []; sequenciaAlerta.value = null; return; }
    const carregados = new Set(lista.map(a => a.mes));
    const mesAtivo = arquivoInfo.value?.periodo ? mesDoPeriodo(arquivoInfo.value.periodo) : null;
    const min = lista[0].mes;
    const max = lista[lista.length - 1].mes;
    const linha = [];
    let cur = min, guard = 0;
    while (guard++ < 240) {
        const arq = lista.find(a => a.mes === cur);
        linha.push({ mes: cur, carregado: carregados.has(cur), ativo: cur === mesAtivo, id: arq ? arq.id : null });
        if (cur === max) break;
        cur = addMeses(cur, 1);
    }
    sequenciaTimeline.value = linha;
    const faltantes = linha.filter(x => !x.carregado).map(x => x.mes);
    sequenciaAlerta.value = faltantes.length ? { faltantes, mesAtivo } : null;
}

// Abre rapidamente um arquivo ja carregado (painel lateral / linha do tempo)
async function abrirArquivo(arqId) {
    if (!arqId) return;
    if (String(arqId) === String(idArquivoSped.value)) { activeTab.value = 'dashboard'; return; }
    try {
        const res = await axios.get(`${API_BASE_URL}/api/arquivo/info/${arqId}`);
        setIdArquivoSped(res.data.id);
        setArquivoInfo(res.data);
        setEmpresaSelecionada({ id: res.data.id_empresa, nome_empresa: res.data.empresa, cnpj: res.data.cnpj });
        activeTab.value = 'dashboard';
        await runAnalysis();
        await loadArquivosRecentes();
    } catch (e) {
        alert('Erro ao abrir arquivo: ' + (e.response?.data?.message || e.message));
    }
}

function trocarEmpresa() {
    resetArquivoSped();
    router.push('/');
}

// Total oficial de entradas/saidas (vem de /api/resumo, ja exclui canceladas) — fonte unica
const totalEntradaNotas = computed(() => auditResumoGerencial.value?.total_entradas || 0);
const totalSaidaNotas = computed(() => auditResumoGerencial.value?.total_saidas || 0);

// Status ANP consolidado do arquivo (pior status entre os combustiveis) para a faixa de saude
const statusAnpGeral = computed(() => {
    const es = auditResumoGerencial.value?.estoqueResumo || [];
    if (!es.length) return null;
    if (es.some(x => x.status === 'CRITICAL')) return 'CRITICAL';
    if (es.some(x => x.status === 'WARNING')) return 'WARNING';
    return 'OK';
});
</script>

<template>
  <div class="space-y-4 animate-fade-in relative">
    <!-- TOAST DE SUCESSO -->
    <Transition
      enter-active-class="transform transition ease-out duration-300"
      enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="showSuccessToast" class="fixed top-4 right-4 z-[100] w-full max-w-xs bg-white rounded-2xl shadow-xl border border-emerald-100 p-4 flex items-center gap-3 ring-1 ring-black/5">
        <div class="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">✨</div>
        <div>
          <h4 class="text-xs font-black text-slate-900 uppercase tracking-tight">Auditoria Concluída!</h4>
          <p class="text-[10px] text-slate-400 font-medium">Cruzamentos processados com sucesso.</p>
        </div>
        <button @click="showSuccessToast = false" class="text-slate-300 hover:text-slate-500 transition-colors ml-auto text-lg leading-none">&times;</button>
      </div>
    </Transition>

    <!-- Header de Contexto -->
    <header class="flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-extrabold text-slate-800 tracking-tight">
          Motor de <span class="text-brand-accent">Auditoria</span>
        </h2>
        <div v-if="empresaSelecionada" class="flex flex-wrap items-center gap-2 mt-1.5">
          <span class="inline-flex items-center gap-1.5 bg-brand-accent/10 text-brand-accent px-2.5 py-1 rounded-lg text-xs font-bold max-w-[340px] truncate" :title="empresaSelecionada.nome_empresa">
            🏢 {{ empresaSelecionada.nome_empresa }}
          </span>
          <span v-if="empresaSelecionada.cnpj" class="inline-flex items-center bg-slate-800 text-white px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-tight" title="CNPJ da empresa">
            <span class="opacity-50 text-[9px] uppercase tracking-widest mr-1.5">CNPJ</span>{{ formatCnpj(empresaSelecionada.cnpj) }}
          </span>
          <button @click="trocarEmpresa" class="text-[10px] text-slate-400 hover:text-slate-600 font-bold underline underline-offset-2">trocar</button>
        </div>
      </div>

      <div v-if="arquivoInfo" class="flex items-center gap-2">
        <div class="flex gap-1.5">
          <button @click="downloadDossie" class="px-3 py-1.5 bg-white text-brand-accent border border-brand-accent/20 rounded-lg text-xs font-bold hover:bg-brand-accent/5 transition-all flex items-center gap-1.5 shadow-sm">
            📥 Dossiê PDF
          </button>
          <button @click="downloadExcel" class="px-3 py-1.5 bg-emerald-600/10 text-emerald-600 border border-emerald-600/20 rounded-lg text-xs font-bold hover:bg-emerald-600/20 transition-all flex items-center gap-1.5 shadow-sm">
            📊 Excel
          </button>
          <button @click="downloadSpedRetificado" class="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-900 transition-all flex items-center gap-1.5 shadow-sm">
            🛠️ Exportar SPED
          </button>
        </div>
        <div class="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl shadow-sm border border-slate-100">
          <div class="w-7 h-7 rounded-lg bg-brand-accent/10 flex items-center justify-center text-brand-accent text-sm shrink-0">📄</div>
          <div>
            <p class="text-xs font-bold leading-none">{{ arquivoInfo.periodo }}</p>
            <p class="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[160px]">{{ arquivoInfo.nome }}</p>
          </div>
        </div>
      </div>
    </header>

    <!-- Banner persistente: sequência de meses quebrada -->
    <div v-if="sequenciaAlerta && sequenciaAlerta.faltantes.length" class="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
      <span class="text-amber-500 text-lg leading-none mt-0.5">⚠</span>
      <div class="flex-1">
        <p class="text-xs font-black text-amber-800 uppercase tracking-wide">Sequência de períodos quebrada</p>
        <p class="text-[11px] text-amber-700 mt-0.5">
          Faltam os meses <strong>{{ sequenciaAlerta.faltantes.map(fmtMes).join(', ') }}</strong> desta empresa.
          Auditar/exportar fora da ordem cronológica pode gerar estoque de abertura e encerrantes inconsistentes.
        </p>
      </div>
      <button @click="activeTab = 'novo'" class="text-[10px] font-bold text-amber-700 hover:text-amber-900 bg-amber-100 px-2.5 py-1 rounded-lg whitespace-nowrap shrink-0">Ver arquivos</button>
    </div>

    <!-- Tabs Estilizadas -->
    <div class="flex flex-wrap gap-1 p-1 bg-slate-200/50 rounded-xl w-fit">
      <button
        @click="activeTab = 'dashboard'"
        :class="activeTab === 'dashboard' ? 'bg-white shadow text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all">
        Dashboard
      </button>
      <button
        @click="activeTab = 'notas'"
        :class="activeTab === 'notas' ? 'bg-white shadow text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all">
        Notas
      </button>
      <button
        @click="activeTab = 'saidas'"
        :class="activeTab === 'saidas' ? 'bg-white shadow text-emerald-600' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all">
        Saídas NF
      </button>
      <button
        @click="activeTab = 'conciliacao'"
        :class="activeTab === 'conciliacao' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all relative">
        Conciliação SEFAZ
        <span v-if="concilResult && concilResult.totais.faltantes" class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] flex items-center justify-center rounded-full border-2 border-slate-100">
          {{ concilResult.totais.faltantes }}
        </span>
      </button>
      <button
        @click="activeTab = 'lmc'"
        :class="activeTab === 'lmc' ? 'bg-white shadow text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all">
        Auditoria LMC
      </button>
      <button
        @click="activeTab = 'erros'"
        :class="activeTab === 'erros' ? 'bg-white shadow text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all relative">
        Alertas
        <span v-if="auditErros.length" class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] flex items-center justify-center rounded-full border-2 border-slate-100">
          {{ auditErros.length }}
        </span>
      </button>
      <button
        @click="activeTab = 'sintaxe'"
        :class="activeTab === 'sintaxe' ? 'bg-white shadow text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all relative">
        Malha Fina
        <span v-if="totalInfractions" class="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[9px] flex items-center justify-center rounded-full border-2 border-slate-100">
          {{ totalInfractions }}
        </span>
      </button>
      <button
        @click="activeTab = 'novo'"
        :class="activeTab === 'novo' ? 'bg-white shadow text-brand-accent' : 'text-slate-500 hover:text-slate-700'"
        class="px-4 py-1.5 rounded-lg text-xs font-bold transition-all">
        Upload
      </button>
    </div>

    <!-- Conteúdo: Conciliação SEFAZ (CSV) -->
    <div v-if="activeTab === 'conciliacao'" class="space-y-6">
      <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
        <h3 class="text-base font-bold text-slate-700">Conciliação SEFAZ × Escrituração</h3>
        <p class="text-xs text-slate-500 mt-1 max-w-2xl">Suba a "Relação de NF-e" (CSV) da SEFAZ. O sistema cruza com as notas de <b>entrada</b> já no banco desta empresa (CNPJ {{ empresaSelecionada?.cnpj || arquivoInfo?.cnpj || '—' }}) e aponta o que está na SEFAZ e falta na sua escrituração. O período é detectado automaticamente pelas datas do CSV.</p>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <label class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600 cursor-pointer transition-all">
            <input type="file" accept=".csv,.CSV" class="hidden" @change="onConcilCsvSelected">
            {{ concilCsvName || 'Selecionar CSV da SEFAZ' }}
          </label>
          <button @click="conciliarSefaz" :disabled="concilLoading || !concilCsvFile"
            class="px-5 py-2 rounded-xl text-xs font-bold text-white transition-all"
            :class="(concilLoading || !concilCsvFile) ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'">
            {{ concilLoading ? 'Conciliando…' : 'Conciliar' }}
          </button>
          <label class="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none">
            <input type="checkbox" v-model="concilDesconsiderarCanceladas" @change="onToggleCanceladas" class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
            Desconsiderar canceladas
          </label>
          <span v-if="concilError" class="text-xs font-semibold text-red-600">{{ concilError }}</span>
        </div>
      </div>

      <div v-if="concilResult" class="space-y-5">
        <!-- Aviso: período do CSV sem SPED importado -->
        <div v-if="concilResult.meses_sem_sped && concilResult.meses_sem_sped.length"
             class="rounded-3xl border p-4 flex items-start gap-3"
             :class="concilResult.sem_sped_total ? 'bg-amber-100 border-amber-300' : 'bg-amber-50 border-amber-200'">
          <span class="text-xl leading-none">⚠️</span>
          <div class="text-sm">
            <p class="font-bold text-amber-800">
              {{ concilResult.sem_sped_total ? 'Não há SPED importado para o período deste CSV.' : 'Alguns meses do CSV não têm SPED importado.' }}
            </p>
            <p class="text-amber-700 mt-0.5">
              Sem SPED para: <b>{{ concilResult.meses_sem_sped.join(', ') }}</b>.
              {{ concilResult.totais.sem_sped }} nota(s) desse(s) mês(es) <b>não foram conferidas</b> e não entram em "faltantes".
              Importe o SPED do período e concilie novamente.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-center">
            <p class="text-[10px] uppercase font-bold text-slate-400">Período (CSV)</p>
            <p class="text-sm font-bold text-slate-700">{{ concilResult.periodo || '—' }}</p>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-center">
            <p class="text-[10px] uppercase font-bold text-slate-400">Notas SEFAZ</p>
            <p class="text-lg font-bold text-slate-700">{{ concilResult.totais.sefaz_valido }}</p>
          </div>
          <div class="p-4 rounded-2xl border shadow-sm text-center" :class="concilResult.totais.faltantes ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'">
            <p class="text-[10px] uppercase font-bold text-slate-400">Faltantes</p>
            <p class="text-lg font-bold" :class="concilResult.totais.faltantes ? 'text-red-600' : 'text-slate-700'">{{ concilResult.totais.faltantes }}</p>
          </div>
          <div class="p-4 rounded-2xl border shadow-sm text-center" :class="(concilResult.totais.divergencia_valor || concilResult.totais.divergencia_competencia) ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'">
            <p class="text-[10px] uppercase font-bold text-slate-400">Divergências</p>
            <p class="text-lg font-bold text-amber-600">{{ concilResult.totais.divergencia_valor + concilResult.totais.divergencia_competencia }}</p>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm text-center">
            <p class="text-[10px] uppercase font-bold text-slate-400">Extras no SPED</p>
            <p class="text-lg font-bold text-slate-700">{{ concilResult.totais.extras }}</p>
          </div>
        </div>

        <div class="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
          <span v-if="concilResult.periodo_escopo" class="text-sky-700 font-semibold">📅 Conferindo só o período do SPED aberto: {{ concilResult.periodo_escopo }}<template v-if="concilResult.totais.fora_escopo"> · {{ concilResult.totais.fora_escopo }} nota(s) de outros meses do CSV ignorada(s)</template></span>
          <button v-if="concilResult.totais.canceladas" @click="concilVerCanceladas = !concilVerCanceladas"
            class="underline decoration-dotted hover:text-slate-700">
            ⚪ {{ concilResult.totais.canceladas }} cancelada(s) {{ concilResult.incluiu_canceladas ? 'incluída(s)' : 'desconsiderada(s)' }} ({{ concilVerCanceladas ? 'ocultar' : 'ver' }})
          </button>
          <span v-if="concilResult.totais.uso_consumo" class="text-indigo-600 font-semibold">🔁 {{ concilResult.totais.uso_consumo }} de uso/consumo (emitidas pela própria empresa)</span>
          <span v-if="concilResult.sem_escrituracao" class="text-amber-600 font-semibold">⚠️ Nenhuma escrituração encontrada para este CNPJ — confira se o SPED foi importado.</span>
          <button @click="exportConcilCsv" class="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">📥 Exportar resultado (CSV)</button>
        </div>

        <!-- Faltantes -->
        <div v-if="concilResult.faltantes.length" class="bg-white rounded-3xl border border-red-100 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-red-50 border-b border-red-100 font-bold text-red-700 text-sm">🔴 Na SEFAZ, faltando na escrituração ({{ concilResult.faltantes.length }})</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 text-slate-500 sticky top-0"><tr><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <tr v-for="(f,i) in concilResult.faltantes" :key="'f'+i" class="border-t border-slate-50 hover:bg-slate-50">
                  <td class="p-2">{{ f.numero }}</td><td class="p-2 font-mono text-[10px]">{{ f.chave }}</td><td class="p-2">{{ f.comp }}</td><td class="p-2 text-right">{{ fmtBRL(f.valor) }}</td><td class="p-2 whitespace-nowrap">{{ f.data }}</td>
                  <td class="p-2">{{ f.fornecedor }}<span v-if="f.uso_consumo" class="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[9px] font-bold whitespace-nowrap">uso/consumo</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Divergência de valor -->
        <div v-if="concilResult.divergencia_valor.length" class="bg-white rounded-3xl border border-amber-100 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-amber-50 border-b border-amber-100 font-bold text-amber-700 text-sm">💰 Divergência de valor (mesma chave, valores diferentes) ({{ concilResult.divergencia_valor.length }})</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 text-slate-500 sticky top-0"><tr><th class="w-6 p-2"></th><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Fornecedor</th><th class="text-right p-2">Valor SEFAZ</th><th class="text-right p-2">Valor SPED</th><th class="text-right p-2">Diferença</th></tr></thead>
              <tbody>
                <template v-for="(d,i) in concilResult.divergencia_valor" :key="'dv'+i">
                  <tr class="border-t border-slate-50 hover:bg-slate-50">
                    <td class="p-2 text-center"><button @click="toggleNf(d.chave)" class="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold leading-none">{{ nfAberta(d.chave) ? '−' : '+' }}</button></td>
                    <td class="p-2">{{ d.numero }}</td><td class="p-2">{{ d.fornecedor }}</td><td class="p-2 text-right">{{ fmtBRL(d.valorSefaz) }}</td><td class="p-2 text-right">{{ fmtBRL(d.valorSped) }}</td><td class="p-2 text-right font-bold" :class="d.dif >= 0 ? 'text-red-600' : 'text-emerald-600'">{{ fmtBRL(d.dif) }}</td>
                  </tr>
                  <tr v-if="nfAberta(d.chave)"><td colspan="6" class="p-0"><NfItens :chave="d.chave" :cnpj="concilCnpjAtivo()" /></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Lançada em outro mês (sem omissão) -->
        <div v-if="concilResult.divergencia_competencia.length" class="bg-white rounded-3xl border border-sky-100 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-sky-50 border-b border-sky-100 text-sky-700 text-sm">
            <span class="font-bold">📅 Lançadas em outro mês — sem omissão ({{ concilResult.divergencia_competencia.length }})</span>
            <span class="block text-[11px] text-sky-600 font-normal mt-0.5">A NF está na SEFAZ no mês emitido, mas foi escriturada em outra competência do seu SPED. <b>Não é omissão</b> — apenas lançamento em data diferente (atenção a crédito extemporâneo).</span>
          </div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 text-slate-500 sticky top-0"><tr><th class="w-6 p-2"></th><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Fornecedor</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão (SEFAZ)</th><th class="text-left p-2">Lançada no SPED</th></tr></thead>
              <tbody>
                <template v-for="(d,i) in concilResult.divergencia_competencia" :key="'dc'+i">
                  <tr class="border-t border-slate-50 hover:bg-slate-50">
                    <td class="p-2 text-center"><button @click="toggleNf(d.chave)" class="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold leading-none">{{ nfAberta(d.chave) ? '−' : '+' }}</button></td>
                    <td class="p-2">{{ d.numero }}</td><td class="p-2 font-mono text-[10px]">{{ d.chave }}</td><td class="p-2">{{ d.fornecedor }}</td><td class="p-2 text-right">{{ fmtBRL(d.valor) }}</td><td class="p-2 whitespace-nowrap">{{ d.data }}</td><td class="p-2 whitespace-nowrap font-semibold text-sky-700">{{ d.dataSped || d.compSped }}</td>
                  </tr>
                  <tr v-if="nfAberta(d.chave)"><td colspan="7" class="p-0"><NfItens :chave="d.chave" :cnpj="concilCnpjAtivo()" /></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Extras -->
        <div v-if="concilResult.extras.length" class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-600 text-sm">🟡 No SPED, sem correspondência na SEFAZ ({{ concilResult.extras.length }})</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 text-slate-500 sticky top-0"><tr><th class="w-6 p-2"></th><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <template v-for="(x,i) in concilResult.extras" :key="'x'+i">
                  <tr class="border-t border-slate-50 hover:bg-slate-50">
                    <td class="p-2 text-center"><button @click="toggleNf(x.chave)" class="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold leading-none">{{ nfAberta(x.chave) ? '−' : '+' }}</button></td>
                    <td class="p-2">{{ x.numero }}</td><td class="p-2 font-mono text-[10px]">{{ x.chave }}</td><td class="p-2">{{ x.comp }}</td><td class="p-2 text-right">{{ fmtBRL(x.valor) }}</td><td class="p-2 whitespace-nowrap">{{ x.data }}</td><td class="p-2">{{ x.fornecedor }}</td>
                  </tr>
                  <tr v-if="nfAberta(x.chave)"><td colspan="7" class="p-0"><NfItens :chave="x.chave" :cnpj="concilCnpjAtivo()" /></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Notas em meses sem SPED importado (não conferidas) -->
        <div v-if="concilResult.sem_sped && concilResult.sem_sped.length" class="bg-white rounded-3xl border border-amber-100 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-amber-50 border-b border-amber-100 font-bold text-amber-700 text-sm">⚠️ Notas em meses sem SPED importado — não conferidas ({{ concilResult.sem_sped.length }})</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 text-slate-500 sticky top-0"><tr><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <tr v-for="(s,i) in concilResult.sem_sped" :key="'s'+i" class="border-t border-slate-50 hover:bg-slate-50">
                  <td class="p-2">{{ s.numero }}</td><td class="p-2 font-mono text-[10px]">{{ s.chave }}</td><td class="p-2">{{ s.comp }}</td><td class="p-2 text-right">{{ fmtBRL(s.valor) }}</td><td class="p-2 whitespace-nowrap">{{ s.data }}</td><td class="p-2">{{ s.fornecedor }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Canceladas (visível via o link "ver") -->
        <div v-if="concilVerCanceladas && concilResult.canceladas && concilResult.canceladas.length" class="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-slate-100 border-b border-slate-200 font-bold text-slate-600 text-sm">⚪ Notas canceladas/denegadas no CSV ({{ concilResult.canceladas.length }}) — {{ concilResult.incluiu_canceladas ? 'incluídas na conciliação' : 'desconsideradas' }}</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 text-slate-500 sticky top-0"><tr><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <tr v-for="(c,i) in concilResult.canceladas" :key="'c'+i" class="border-t border-slate-50 hover:bg-slate-50 text-slate-400 line-through decoration-slate-300">
                  <td class="p-2">{{ c.numero }}</td><td class="p-2 font-mono text-[10px]">{{ c.chave }}</td><td class="p-2">{{ c.comp }}</td><td class="p-2 text-right">{{ fmtBRL(c.valor) }}</td><td class="p-2 whitespace-nowrap">{{ c.data }}</td><td class="p-2 no-underline">{{ c.fornecedor }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="!concilResult.sem_sped_total && !concilResult.faltantes.length && !concilResult.divergencia_valor.length && !concilResult.divergencia_competencia.length && !concilResult.extras.length"
             class="bg-emerald-50 border border-emerald-100 rounded-3xl p-6 text-center text-emerald-700 font-bold">
          ✅ Tudo conciliado — nenhuma divergência no período.
        </div>
      </div>
    </div>

    <!-- Conteúdo: Auditoria Sintática (Malha Fina) -->
    <div v-if="activeTab === 'sintaxe'" class="space-y-6">
      <!-- Resumo Geral -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">📉</div>
          <div>
            <p class="text-[10px] font-black text-slate-400 uppercase">Divergência NFe</p>
            <p class="text-xl font-black text-slate-900">{{ infractions.c100_valores_divergentes.length }}</p>
          </div>
        </div>
        <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500">❓</div>
          <div>
            <p class="text-[10px] font-black text-slate-400 uppercase">Omissão (Saltos)</p>
            <p class="text-xl font-black text-slate-900">{{ infractions.c100_saltos_enumeracao.length }}</p>
          </div>
        </div>
        <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500">📦</div>
          <div>
            <p class="text-[10px] font-black text-slate-400 uppercase">Erros Cadastro</p>
            <p class="text-xl font-black text-slate-900">{{ infractions.cfop_suspeitos.length }}</p>
          </div>
        </div>
        <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500">⛽</div>
          <div>
            <p class="text-[10px] font-black text-slate-400 uppercase">LMC x Inventário</p>
            <p class="text-xl font-black text-slate-900">{{ infractions.h010_divergente_1300.length }}</p>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4" v-if="(infractions.chv_nfe_cnpj_divergente?.length || 0) + (infractions.bicos_duplicados_1320?.length || 0) > 0">
        <div v-if="infractions.chv_nfe_cnpj_divergente?.length" class="bg-white p-6 rounded-3xl border border-orange-200 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-500">🔑</div>
          <div>
            <p class="text-[10px] font-black text-orange-500 uppercase">CNPJ Chave Divergente</p>
            <p class="text-xl font-black text-slate-900">{{ infractions.chv_nfe_cnpj_divergente.length }}</p>
          </div>
        </div>
        <div v-if="infractions.bicos_duplicados_1320?.length" class="bg-white p-6 rounded-3xl border border-purple-200 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-500">⛽</div>
          <div>
            <p class="text-[10px] font-black text-purple-500 uppercase">Bicos Duplicados</p>
            <p class="text-xl font-black text-slate-900">{{ infractions.bicos_duplicados_1320.length }}</p>
          </div>
        </div>
      </div>

      <!-- Detalhamento das Infrações -->
      <div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        <div class="p-6 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
          <h3 class="text-lg font-black text-slate-800 tracking-tight uppercase">Laudo de Auditoria Sintática</h3>
          <button @click="runSyntaxAnalysis" class="px-3 py-1 bg-brand-accent text-white rounded-lg text-[10px] font-bold" :disabled="loadingSintaxe">
            {{ loadingSintaxe ? 'PROCESSANDO...' : 'RE-ANALISAR AGORA' }}
          </button>
        </div>

        <div v-if="loadingSintaxe" class="py-20 flex flex-col items-center justify-center">
           <div class="animate-spin rounded-full h-10 w-10 border-4 border-brand-accent border-t-transparent mb-4"></div>
           <p class="text-xs font-bold text-slate-400 tracking-widest uppercase">Motor em Memória: Escaneando Layout SPED...</p>
        </div>

        <div v-else class="divide-y divide-slate-100">
           <!-- Divergência C100 -->
           <div v-if="infractions.c100_valores_divergentes.length" class="p-6 bg-red-50/20">
              <h4 class="text-xs font-black text-red-600 uppercase mb-4 flex items-center gap-2">🚨 Divergência: Capa vs Itens (C190)</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                 <div v-for="err in infractions.c100_valores_divergentes" :key="err.linha" class="p-3 bg-white border border-red-100 rounded-xl text-[11px] flex justify-between items-center">
                    <div>
                      <span class="font-bold">L-{{ err.linha }}:</span> NF {{ err.num_doc }} divergente. 
                      Capa: <span class="font-bold">{{ formatCurrency(err.valor_capa) }}</span> vs 
                      Escriturado: <span class="font-bold">{{ formatCurrency(err.valor_calculado) }}</span>
                    </div>
                 </div>
              </div>
           </div>

           <!-- Saltos de Numeração -->
           <div v-if="infractions.c100_saltos_enumeracao.length" class="p-6 bg-amber-50/20">
              <h4 class="text-xs font-black text-amber-600 uppercase mb-4 flex items-center gap-2">❓ Omissão de Notas (Saltos no Sequencial)</h4>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                 <div v-for="err in infractions.c100_saltos_enumeracao" :key="err.linha" class="p-3 bg-white border border-amber-100 rounded-xl text-[11px]">
                    Detectado salto na linha {{ err.linha }}. Anterior: {{ err.num_anterior }} | Próxima: {{ err.num_atual }}. 
                    <span class="block font-bold text-amber-500 mt-1">Possível falta de lançamento.</span>
                 </div>
              </div>
           </div>

           <!-- Cadastro de Produtos -->
           <div v-if="infractions.cfop_suspeitos.length" class="p-6">
              <h4 class="text-xs font-black text-indigo-600 uppercase mb-4 flex items-center gap-2">📦 Vícios de Cadastro de Produtos (NCM/CEST/CFOP)</h4>
              <div class="space-y-2">
                 <div v-for="err in infractions.cfop_suspeitos" :key="err.linha" class="p-3 bg-indigo-50/30 rounded-xl text-[11px] border border-indigo-50">
                    <span class="font-bold">Linha {{ err.linha }}:</span> {{ err.alerta }}
                 </div>
              </div>
           </div>

           <!-- Bloco H vs 1300 -->
           <div v-if="infractions.h010_divergente_1300.length" class="p-6 bg-emerald-50/20">
              <h4 class="text-xs font-black text-emerald-600 uppercase mb-4 flex items-center gap-2">⛽ Descasamento Físico: LMC x Inventário</h4>
              <div v-for="err in infractions.h010_divergente_1300" :key="err.alerta" class="p-4 bg-white border border-emerald-100 rounded-2xl text-xs">
                 {{ err.alerta }} 
                 <div class="mt-2 flex gap-4 text-[10px]">
                    <span>LMC: <span class="font-bold">{{ formatNumber(err.lmc) }} L</span></span>
                    <span>Inventário: <span class="font-bold">{{ formatNumber(err.inventario) }} L</span></span>
                    <span class="text-red-500">Diferença: {{ formatNumber(err.diff) }} L</span>
                 </div>
              </div>
           </div>

           <!-- CNPJ Divergente na Chave NF-e/NFC-e -->
           <div v-if="infractions.chv_nfe_cnpj_divergente && infractions.chv_nfe_cnpj_divergente.length" class="p-6 bg-orange-50/20">
              <h4 class="text-xs font-black text-orange-600 uppercase mb-4 flex items-center gap-2">🔑 CNPJ Divergente na Chave NF-e/NFC-e</h4>
              <div class="p-4 bg-white border border-orange-100 rounded-2xl text-xs mb-3">
                <p class="font-bold text-orange-700 mb-2">
                  {{ infractions.chv_nfe_cnpj_divergente.length }} documentos de emissao propria com CNPJ diferente do informante na chave de acesso.
                </p>
                <div class="flex gap-6 text-[10px] text-slate-600">
                  <span>NFC-e: <span class="font-bold">{{ infractions.chv_nfe_cnpj_divergente.filter(e => e.modelo === 'NFC-e').length }}</span></span>
                  <span>NF-e: <span class="font-bold">{{ infractions.chv_nfe_cnpj_divergente.filter(e => e.modelo === 'NF-e').length }}</span></span>
                  <span>CNPJ na chave: <span class="font-bold">{{ [...new Set(infractions.chv_nfe_cnpj_divergente.map(e => e.cnpj_chave))].join(', ') }}</span></span>
                  <span>CNPJ informante: <span class="font-bold">{{ infractions.chv_nfe_cnpj_divergente[0]?.cnpj_informante }}</span></span>
                </div>
                <p class="text-[10px] text-orange-500 mt-2 font-semibold">O sistema corrigira automaticamente ao exportar o SPED.</p>
              </div>
           </div>

           <!-- Bicos Duplicados entre Tanques -->
           <div v-if="infractions.bicos_duplicados_1320 && infractions.bicos_duplicados_1320.length" class="p-6 bg-purple-50/20">
              <h4 class="text-xs font-black text-purple-600 uppercase mb-4 flex items-center gap-2">⛽ Bico Duplicado entre Tanques (1320)</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                 <div v-for="err in infractions.bicos_duplicados_1320.slice(0, 10)" :key="err.data + err.bico" class="p-3 bg-white border border-purple-100 rounded-xl text-[11px]">
                    <span class="font-bold">{{ err.data }}</span> — {{ err.produto }} — Bico <span class="font-bold">{{ err.bico }}</span>
                    <div class="text-[10px] text-slate-500 mt-1">Tanques: {{ err.tanques }} | Volumes: {{ err.volumes }}</div>
                    <div class="text-[10px] text-purple-500 font-semibold mt-1">Erro no arquivo original — bico registrado em dois tanques.</div>
                 </div>
                 <div v-if="infractions.bicos_duplicados_1320.length > 10" class="p-3 bg-purple-50 rounded-xl text-[11px] text-purple-600 font-bold flex items-center justify-center">
                    ... e mais {{ infractions.bicos_duplicados_1320.length - 10 }} ocorrencias
                 </div>
              </div>
           </div>

           <!-- Sem erros -->
           <div v-if="totalInfractions === 0" class="py-20 text-center flex flex-col items-center gap-3">
              <div class="text-4xl">💎</div>
              <p class="text-lg font-black text-emerald-600 uppercase tracking-widest">Nenhuma Infração Estrutural Detectada</p>
              <p class="text-xs text-slate-400">O arquivo parece íntegro nos cruzamentos de Bloco C e H.</p>
           </div>
        </div>
      </div>
    </div>

    <!-- Conteúdo: NFs Analíticas (C100/170/190) -->
    <div v-if="activeTab === 'notas'" class="space-y-6">
       <div class="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100">
          <div class="p-6 border-b border-slate-50 flex flex-col md:flex-row justify-between items-center bg-slate-50/50 gap-4">
             <div>
                <h3 class="text-lg font-bold text-slate-800">Notas Fiscais vs Produtos</h3>
                <p class="text-xs text-slate-500">Conciliação C100 (Capa), C190 (Resumo) e C170 (Detalhes)</p>
             </div>
             <div class="flex items-center gap-4">
                 <div class="text-right">
                    <p class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total Entradas</p>
                    <p class="text-lg font-black text-blue-600 leading-none mt-0.5">{{ formatCurrency(totalEntradaNotas) }}</p>
                 </div>
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
                              <td colspan="6" class="p-0 bg-slate-100/50 border-b-2 border-slate-200 shadow-inner">
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

                                      <!-- ===== NFe COMPLETA — Cálculo do Imposto + todos os campos ===== -->
                                      <div v-if="nf.chv_nfe" class="mt-7">
                                          <div class="flex items-center flex-wrap gap-3 mb-4">
                                              <span class="text-[10px] uppercase font-black tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-md shadow-sm border border-emerald-200">NFe Completa — Cálculo do Imposto</span>
                                              <span v-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].fonte" class="text-[9px] font-bold px-2 py-0.5 rounded-full" :class="nfeCompletaCache[nf.id].fonte === 'sped' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'">fonte: {{ FONTE_LABEL[nfeCompletaCache[nf.id].fonte] || nfeCompletaCache[nf.id].fonte }}</span>
                                              <span class="text-[9px] font-mono text-slate-400">{{ nf.chv_nfe }}</span>
                                          </div>

                                          <div v-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].loading" class="text-sm text-slate-500 italic">Carregando NFe completa…</div>
                                          <div v-else-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].erro" class="text-sm text-rose-600">Erro ao carregar a NFe: {{ nfeCompletaCache[nf.id].erro }}</div>

                                          <!-- sem XML disponível (nota só do SPED) -->
                                          <div v-else-if="nfeCompletaCache[nf.id] && !nfeCompletaCache[nf.id].nfe" class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 max-w-3xl">
                                              <b>XML desta NF-e não disponível</b> ({{ nfeCompletaCache[nf.id].motivo || 'nota proveniente apenas do SPED' }}). Campos exclusivos do XML — monofásico (qBCMonoRet/vICMSMonoRet), ICMS desonerado, FCP, DIFAL — não existem no SPED Fiscal. Reinjete o XML desta nota para ver o Cálculo do Imposto completo.
                                          </div>

                                          <!-- NFe completa carregada -->
                                          <template v-else-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].nfe">
                                              <!-- destaques (leitura rápida) -->
                                              <div v-if="nfeCompletaCache[nf.id].nfe.destaques && nfeCompletaCache[nf.id].nfe.destaques.length" class="mb-4 max-w-4xl space-y-1">
                                                  <div v-for="(d, di) in nfeCompletaCache[nf.id].nfe.destaques" :key="di" class="text-[11px] text-slate-600 flex gap-2"><span class="text-emerald-500 font-black">▸</span><span>{{ d }}</span></div>
                                              </div>

                                              <!-- ICMSTot em destaque -->
                                              <template v-for="g in nfeCompletaCache[nf.id].nfe.grupos" :key="g.grupo">
                                                  <div v-if="g.grupo.includes('ICMSTot')" class="bg-white border-2 border-emerald-200 rounded-xl shadow-sm p-4 mb-4 max-w-5xl">
                                                      <h4 class="text-xs font-black uppercase tracking-wider text-emerald-700 mb-3">💰 {{ g.grupo }}</h4>
                                                      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
                                                          <div v-for="(c, ci) in g.campos" :key="ci" class="flex flex-col border-b border-slate-50 py-1">
                                                              <span class="text-[9px] uppercase tracking-wide text-slate-400">{{ c.label_pt }} <span class="font-mono normal-case text-slate-300">{{ c.tag }}</span></span>
                                                              <span class="text-sm font-bold font-mono" :class="c.obs && c.obs.indexOf('Monofásico') >= 0 ? 'text-purple-600' : 'text-slate-700'">{{ fmtValorNfe(c.valor) }}</span>
                                                              <span v-if="c.obs" class="text-[9px] text-purple-400">{{ c.obs }}</span>
                                                          </div>
                                                      </div>
                                                  </div>
                                              </template>

                                              <!-- demais grupos (recolhíveis) -->
                                              <div class="max-w-5xl space-y-2">
                                                  <template v-for="g in nfeCompletaCache[nf.id].nfe.grupos" :key="'sec-' + g.grupo">
                                                      <div v-if="!g.grupo.includes('ICMSTot')" class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                                          <button @click="toggleGrupoNfe(nf.id, g.grupo)" class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors text-left">
                                                              <span class="text-[11px] font-bold text-slate-700">{{ g.grupo }} <span class="text-slate-400 font-normal">({{ g.campos.length }})</span></span>
                                                              <span class="text-slate-400 text-xs">{{ grupoNfeAberto(nf.id, g.grupo) ? '▼' : '▶' }}</span>
                                                          </button>
                                                          <div v-if="grupoNfeAberto(nf.id, g.grupo)" class="px-4 pb-3 pt-1 border-t border-slate-100">
                                                              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                                                                  <template v-for="(c, ci) in g.campos" :key="ci">
                                                                      <div v-if="c._header" class="md:col-span-2 lg:col-span-3 mt-2 mb-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-0.5">{{ c.label_pt }}</div>
                                                                      <div v-else class="flex items-baseline justify-between gap-2 border-b border-slate-50 py-0.5">
                                                                          <span class="text-[10px] text-slate-500 truncate" :title="c.tag">{{ c.label_pt }}</span>
                                                                          <span class="text-[11px] font-mono font-semibold text-right whitespace-nowrap" :class="c.obs && c.obs.indexOf('Monofásico') >= 0 ? 'text-purple-600' : 'text-slate-700'">{{ fmtValorNfe(c.valor) }}</span>
                                                                      </div>
                                                                  </template>
                                                              </div>
                                                          </div>
                                                      </div>
                                                  </template>
                                              </div>
                                          </template>
                                      </div>
                                      <!-- ===== FIM NFe COMPLETA ===== -->
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
            <p class="text-sm font-black text-emerald-600 mt-1">Total Saídas: {{ formatCurrency(totalSaidaNotas) }}</p>
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

    <!-- Conteúdo: Upload (2 COLUNAS: carregar + recentes/linha do tempo) -->
    <div v-if="activeTab === 'novo'" class="animate-fade-in">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div class="lg:col-span-2 flex justify-center">
      <div class="bg-white rounded-2xl p-8 border-2 border-dashed border-slate-200 hover:border-brand-accent/50 transition-all group text-center space-y-5 max-w-lg w-full shadow-lg shadow-slate-100/50">
        <div class="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto text-2xl group-hover:scale-110 transition-transform shadow-inner">
          {{ isUploading ? '⚙️' : '📥' }}
        </div>
        <div class="space-y-1.5">
          <h3 class="text-xl font-black text-slate-800 tracking-tight">
            {{ isUploading ? 'Processando Auditoria' : 'Seleção de Arquivo SPED' }}
          </h3>
          <p class="text-slate-400 text-sm font-medium">
            {{ isUploading ? 'Por favor, não feche a página.' : 'Clique para selecionar o arquivo .txt do SPED' }}
          </p>
        </div>

        <div v-if="!isUploading">
          <label class="inline-block px-8 py-3 bg-brand-accent hover:bg-opacity-90 text-white rounded-xl font-black cursor-pointer transition-all shadow-md shadow-brand-accent/20 active:scale-95 text-sm uppercase tracking-widest">
            Escolher Arquivo
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

        <!-- PAINEL LATERAL: últimos arquivos + linha do tempo -->
        <aside class="space-y-4">
          <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h4 class="text-xs font-black uppercase text-slate-400 tracking-widest mb-3">Últimos arquivos</h4>
            <div v-if="loadingRecentes" class="text-xs text-slate-400 py-4 text-center">Carregando…</div>
            <p v-else-if="!arquivosRecentes.length" class="text-xs text-slate-400 italic py-4 text-center">Nenhum arquivo carregado para esta empresa ainda.</p>
            <ul v-else class="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              <li v-for="a in [...arquivosRecentes].reverse()" :key="a.id">
                <button @click="abrirArquivo(a.id)" class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left hover:bg-slate-50 transition-colors" :class="String(a.id) === String(idArquivoSped) ? 'bg-brand-accent/5 ring-1 ring-brand-accent/20' : ''">
                  <span class="w-2 h-2 rounded-full shrink-0" :class="String(a.id) === String(idArquivoSped) ? 'bg-brand-accent' : 'bg-slate-300'"></span>
                  <span class="text-xs font-black text-slate-700 w-14 shrink-0">{{ fmtMes(a.mes) }}</span>
                  <span class="text-[10px] text-slate-400 font-mono truncate flex-1" :title="a.nome_arquivo">{{ a.nome_arquivo }}</span>
                  <span v-if="String(a.id) === String(idArquivoSped)" class="text-[8px] font-black uppercase text-brand-accent bg-brand-accent/10 px-1.5 py-0.5 rounded shrink-0">ativo</span>
                </button>
              </li>
            </ul>
          </div>

          <div v-if="sequenciaTimeline.length" class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h4 class="text-xs font-black uppercase text-slate-400 tracking-widest mb-3">Linha do tempo</h4>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="t in sequenciaTimeline" :key="t.mes" @click="t.id && abrirArquivo(t.id)"
                :class="t.carregado ? (t.ativo ? 'bg-brand-accent text-white' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200') : 'bg-red-50 text-red-500 border border-dashed border-red-300 cursor-default'"
                class="px-2 py-1 rounded-md text-[10px] font-black transition-colors">
                {{ fmtMes(t.mes) }}<span v-if="!t.carregado"> ⚠</span>
              </button>
            </div>
            <p class="text-[9px] text-slate-400 mt-3 leading-relaxed">🟢 carregado · 🟣 ativo · 🔴 mês faltante (quebra de sequência)</p>
          </div>
        </aside>
      </div>
    </div>

    <!-- Conteúdo: Dashboard Analítico -->
    <div v-if="activeTab === 'dashboard'" class="space-y-6 animate-fade-in">

      <!-- FAIXA DE SAÚDE DO ARQUIVO -->
      <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-4 justify-between">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-black uppercase text-slate-400 tracking-widest">Saúde do arquivo</span>
          <span v-if="arquivoInfo" class="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{{ arquivoInfo.periodo }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-5">
          <div class="text-right">
            <p class="text-[9px] uppercase font-black text-slate-400 tracking-widest">Entradas</p>
            <p class="text-sm font-black text-blue-600">{{ formatCurrency(totalEntradaNotas) }}</p>
          </div>
          <div class="text-right">
            <p class="text-[9px] uppercase font-black text-slate-400 tracking-widest">Saídas</p>
            <p class="text-sm font-black text-emerald-600">{{ formatCurrency(totalSaidaNotas) }}</p>
          </div>
          <div class="text-right">
            <p class="text-[9px] uppercase font-black text-slate-400 tracking-widest">Variação ANP</p>
            <p class="text-sm font-black" :class="statusAnpGeral === 'CRITICAL' ? 'text-red-500' : statusAnpGeral === 'WARNING' ? 'text-amber-500' : 'text-emerald-600'">
              {{ statusAnpGeral === 'CRITICAL' ? '🔴 Crítico' : statusAnpGeral === 'WARNING' ? '⚠ Atenção' : statusAnpGeral === 'OK' ? '✓ OK' : '—' }}
            </p>
          </div>
          <div class="text-right">
            <p class="text-[9px] uppercase font-black text-slate-400 tracking-widest">Erros</p>
            <p class="text-sm font-black" :class="auditErros.length ? 'text-red-500' : 'text-emerald-600'">{{ auditErros.length }}</p>
          </div>
        </div>
      </div>

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
    <div v-if="activeTab === 'lmc'" class="space-y-4 animate-fade-in">

        <!-- Barra de Filtros + Configurar Tanques -->
        <div class="bg-white px-3 py-2 rounded-xl shadow-sm border border-slate-100 flex flex-wrap items-center gap-3 justify-between">
            <div class="flex items-center gap-3">
                <div class="relative">
                    <input v-model="lmcFilters.search" type="text" placeholder="Filtrar combustível..." class="pl-8 pr-3 py-1.5 bg-slate-50 border-none rounded-lg text-xs focus:ring-1 focus:ring-brand-accent w-44">
                    <span class="absolute left-2.5 top-1.5 opacity-30 text-xs">🔍</span>
                </div>
                <input v-model="lmcFilters.date" type="date" class="px-3 py-1.5 bg-slate-50 border-none rounded-lg text-xs font-bold text-slate-500">
                <label class="flex items-center gap-1.5 cursor-pointer group">
                    <input v-model="lmcFilters.onlyErrors" type="checkbox" class="w-3.5 h-3.5 rounded border-slate-300 text-brand-accent focus:ring-brand-accent focus:ring-1">
                    <span class="text-[10px] font-bold text-slate-400 group-hover:text-slate-600 uppercase tracking-widest">Só falhas</span>
                </label>
            </div>
            <button @click="openLmcConfig" class="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-black transition-all flex items-center gap-1.5">
                ⚙️ Configurar Tanques
            </button>
            <button @click="openLacresModal" class="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-black transition-all flex items-center gap-1.5" title="Cadastrar lacres das bombas (registro 1360) — injetados no SPED ao exportar">
                🔒 Lacres das Bombas
            </button>
            <button @click="openCredModal" class="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-black transition-all flex items-center gap-1.5" title="Cadastrar credenciadoras do 1601 (maquininhas) — injeta o 0150 completo no SPED ao exportar">
                💳 Credenciadoras (1601)
            </button>
        </div>

        <!-- Banner de Continuidade de Estoque -->
        <div v-if="continuidade.divergencias.length > 0"
             class="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-lg">⚠️</span>
                    <div>
                        <p class="text-sm font-black text-amber-800">Continuidade de Estoque — Divergência Detectada</p>
                        <p class="text-xs text-amber-600">
                            O estoque de abertura deste mês difere do fechamento físico do mês anterior
                            <span v-if="continuidade.divergencias[0]?.periodo_anterior" class="font-bold">
                                ({{ continuidade.divergencias[0].periodo_anterior.substring(5,7) }}/{{ continuidade.divergencias[0].periodo_anterior.substring(0,4) }})
                            </span>.
                            Sincronize para corrigir a base de cálculo.
                        </p>
                    </div>
                </div>
                <button @click="sincronizarTodos"
                        class="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-xl transition-all flex items-center gap-1.5 shrink-0">
                    <Loader2 v-if="Object.keys(sincronizando).length > 0" class="w-3 h-3 animate-spin"/>
                    <span>Sincronizar Todos</span>
                </button>
            </div>
            <div class="space-y-2">
                <div v-for="div in continuidade.divergencias" :key="div.cod_item"
                     class="bg-white rounded-xl border border-amber-100 px-4 py-2.5 flex items-center justify-between gap-4">
                    <div class="min-w-0">
                        <p class="text-xs font-black text-slate-700 truncate">{{ div.nome || div.cod_item }}</p>
                        <p class="text-[10px] text-slate-400 font-mono">Cód: {{ div.cod_item }}</p>
                    </div>
                    <div class="flex items-center gap-4 text-xs font-mono shrink-0">
                        <div class="text-center">
                            <p class="text-[9px] uppercase font-black text-slate-400 tracking-widest">Fechamento ant.</p>
                            <p class="font-black text-emerald-600">{{ Number(div.fechamento_anterior).toFixed(3) }} L</p>
                        </div>
                        <div class="text-slate-300 font-bold">→</div>
                        <div class="text-center">
                            <p class="text-[9px] uppercase font-black text-slate-400 tracking-widest">Abertura atual</p>
                            <p class="font-black text-slate-700">{{ Number(div.abertura_atual).toFixed(3) }} L</p>
                        </div>
                        <div class="text-center">
                            <p class="text-[9px] uppercase font-black text-slate-400 tracking-widest">Diferença</p>
                            <p class="font-black" :class="div.diferenca > 0 ? 'text-blue-500' : 'text-rose-500'">
                                {{ div.diferenca > 0 ? '+' : '' }}{{ Number(div.diferenca).toFixed(3) }} L
                            </p>
                        </div>
                    </div>
                    <button @click="sincronizarEstoque(div.cod_item, div.fechamento_anterior)"
                            :disabled="sincronizando[div.cod_item]"
                            class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-[10px] font-black rounded-lg transition-all flex items-center gap-1 shrink-0">
                        <Loader2 v-if="sincronizando[div.cod_item]" class="w-3 h-3 animate-spin"/>
                        <span v-else>Sincronizar</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Accordion por Combustível -->
        <div v-if="lmcKpis?.length" class="space-y-2">
            <div v-for="comb in lmcKpis" :key="comb.cod" class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

                <!-- Cabeçalho clicável -->
                <div @click="toggleFuel(comb.cod)"
                     class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors select-none">
                    <div class="flex items-center gap-3">
                        <!-- Seta expand/collapse -->
                        <span class="text-slate-400 transition-transform duration-200 text-xs"
                              :class="expandedFuels[comb.cod] ? 'rotate-90' : ''">▶</span>
                        <div class="w-1 h-5 bg-brand-accent rounded-full"></div>
                        <span class="text-sm font-black text-slate-800 uppercase tracking-tight">{{ comb.nome }}</span>
                        <span class="text-[9px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full border border-slate-200">{{ comb.cod }}</span>
                    </div>

                    <!-- KPIs inline -->
                    <div class="flex items-center gap-2 ml-4 flex-wrap justify-end">
                        <div class="flex flex-col items-end">
                            <span class="text-[8px] uppercase text-slate-400 font-black tracking-widest">Est. Inicial</span>
                            <div v-if="editingStock[comb.cod] === undefined" class="flex items-center gap-1">
                                <span class="text-xs font-black text-slate-700 tabular-nums">{{ formatNumber(comb.estoqueInicial) }}</span>
                                <button @click.stop="toggleEditStock(comb.cod, comb.estoqueInicial)"
                                        class="text-[10px] text-slate-400 hover:text-brand-accent transition-colors leading-none"
                                        title="Ajustar estoque inicial">✏️</button>
                            </div>
                            <div v-else class="flex items-center gap-1" @click.stop>
                                <input v-model="editingStock[comb.cod]" type="number" step="0.001"
                                       class="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs font-black focus:ring-1 focus:ring-brand-accent outline-none w-28">
                                <button @click.stop="saveInitialStock(comb.cod)" :disabled="savingStock"
                                        class="bg-emerald-500 text-white rounded px-2 py-0.5 text-xs hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                                    <Loader2 v-if="savingStock" class="w-3 h-3 animate-spin inline"/>
                                    <span v-else>Salvar</span>
                                </button>
                                <button @click.stop="delete editingStock[comb.cod]"
                                        class="text-xs text-slate-400 hover:text-slate-600 px-1">✕</button>
                            </div>
                        </div>
                        <div class="w-px h-6 bg-slate-100"></div>
                        <div class="flex flex-col items-end">
                            <span class="text-[8px] uppercase text-emerald-500 font-black tracking-widest">Entradas</span>
                            <span class="text-xs font-black text-slate-700 tabular-nums">+{{ formatNumber(comb.totalEntradas) }}</span>
                        </div>
                        <div class="w-px h-6 bg-slate-100"></div>
                        <div class="flex flex-col items-end">
                            <span class="text-[8px] uppercase text-amber-500 font-black tracking-widest">Saídas</span>
                            <span class="text-xs font-black text-slate-700 tabular-nums">-{{ formatNumber(comb.totalSaidas) }}</span>
                        </div>
                        <div class="w-px h-6 bg-slate-100"></div>
                        <div class="flex flex-col items-end">
                            <span class="text-[8px] uppercase text-slate-400 font-black tracking-widest">Quebra</span>
                            <span class="text-xs font-black tabular-nums" :class="comb.quebraLiquida >= 0 ? 'text-emerald-600' : 'text-rose-600'">
                                {{ comb.quebraLiquida > 0 ? '+' : '' }}{{ formatNumber(comb.quebraLiquida) }} L
                            </span>
                        </div>
                        <div class="w-px h-6 bg-slate-100"></div>
                        <div class="flex flex-col items-end">
                            <span class="text-[8px] uppercase text-slate-400 font-black tracking-widest">Saldo M+1</span>
                            <span class="text-xs font-black text-slate-700 tabular-nums">{{ formatNumber(comb.estoqueFinal) }}</span>
                        </div>
                        <div class="w-px h-6 bg-slate-100"></div>
                        <span class="px-2 py-1 rounded-lg text-[9px] font-black uppercase"
                              :class="comb.irregularidades > 0 ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'">
                            {{ comb.irregularidades > 0 ? comb.irregularidades + ' Irreg.' : '✅ Conforme' }}
                        </span>
                        <button @click.stop="openOtimizador(comb)" class="px-2.5 py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-[9px] font-black transition-all border border-indigo-100">
                            🚀
                        </button>
                    </div>
                </div>

                <!-- Tabela expandível -->
                <div v-if="expandedFuels[comb.cod]" class="border-t border-slate-100">
                    <!-- Edição estoque inicial -->
                    <div class="px-4 py-2 bg-slate-50/50 flex items-center gap-3 border-b border-slate-100">
                        <span class="text-[9px] font-black uppercase text-slate-400 tracking-widest">Est. Inicial do Mês:</span>
                        <div v-if="editingStock[comb.cod] === undefined" class="flex items-center gap-2">
                            <span class="text-xs font-black text-slate-700 font-mono">{{ formatNumber(comb.estoqueInicial) }}</span>
                            <button @click="toggleEditStock(comb.cod, comb.estoqueInicial)" class="text-[10px] text-slate-400 hover:text-brand-accent transition-colors">✏️ Ajustar</button>
                        </div>
                        <div v-else class="flex items-center gap-1">
                            <input v-model="editingStock[comb.cod]" type="number" step="0.001" class="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs font-black focus:ring-1 focus:ring-brand-accent outline-none w-32">
                            <button @click="saveInitialStock(comb.cod)" :disabled="savingStock" class="bg-emerald-500 text-white rounded px-2 py-0.5 text-xs hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                                <Loader2 v-if="savingStock" class="w-3 h-3 animate-spin inline"/>
                                <span v-else>Salvar</span>
                            </button>
                            <button @click="delete editingStock[comb.cod]" class="text-xs text-slate-400 hover:text-slate-600 px-1">✕</button>
                        </div>
                    </div>

                    <div class="overflow-x-auto custom-scrollbar-light">
                        <table class="min-w-full text-left">
                            <thead class="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                                <tr class="text-[9px] text-slate-400 uppercase font-black tracking-widest">
                                    <th class="px-4 py-2.5 whitespace-nowrap">Data</th>
                                    <th class="px-4 py-2.5 text-center whitespace-nowrap">Capacidade</th>
                                    <th class="px-4 py-2.5 text-right whitespace-nowrap">Est. Inicial</th>
                                    <th class="px-4 py-2.5 text-right whitespace-nowrap">Entradas</th>
                                    <th class="px-4 py-2.5 text-right text-orange-400 whitespace-nowrap">Saídas ✏️</th>
                                    <th class="px-4 py-2.5 text-right whitespace-nowrap">Escritural</th>
                                    <th class="px-4 py-2.5 text-right whitespace-nowrap">Físico</th>
                                    <th class="px-4 py-2.5 text-right border-l border-slate-100 whitespace-nowrap">Diferença (L)</th>
                                    <th class="px-4 py-2.5 text-right whitespace-nowrap">Var %</th>
                                    <th class="px-4 py-2.5 text-right text-rose-400 whitespace-nowrap">Excesso</th>
                                    <th class="px-4 py-2.5 text-center whitespace-nowrap">Status ANP</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-50">
                                <tr v-for="item in lmcDoCombustivel(comb.cod)" :key="item.id_movimento" class="hover:bg-slate-50/40 transition-colors">
                                    <td class="px-4 py-2 font-mono text-[11px] text-slate-500">{{ new Date(item.data_movimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) }}</td>
                                    <td class="px-4 py-2 text-center font-mono text-[11px] font-bold text-slate-400">
                                        {{ item.capacidade_tanque > 0 ? formatNumber(item.capacidade_tanque) + ' L' : '—' }}
                                    </td>
                                    <td class="px-4 py-2 text-right font-mono text-xs text-slate-600">{{ formatNumber(item.estq_abert_final || item.estq_abert) }}</td>
                                    <td class="px-4 py-2 text-right font-mono text-xs text-emerald-600">{{ formatNumber(item.vol_entr_lmc) }}</td>
                                    <!-- Saídas editável -->
                                    <td class="px-4 py-2 text-right font-mono text-xs text-amber-700 bg-orange-50/30">
                                        <div v-if="editingSaida[`${item.cod_item}|${item.data_movimento}`] === undefined"
                                             class="flex items-center justify-end gap-1">
                                            <span>{{ formatNumber(item.vol_saidas_final) }}</span>
                                            <button @click="toggleEditSaida(item.cod_item, item.data_movimento, item.vol_saidas_final)"
                                                    class="text-[10px] text-slate-400 hover:text-orange-500 transition-colors"
                                                    title="Editar saída deste dia">✏️</button>
                                        </div>
                                        <div v-else class="flex items-center justify-end gap-1">
                                            <input v-model="editingSaida[`${item.cod_item}|${item.data_movimento}`]"
                                                   type="number" step="0.001"
                                                   class="bg-white border border-orange-300 rounded px-1.5 py-0.5 text-xs font-black focus:ring-1 focus:ring-orange-400 outline-none w-24">
                                            <button @click="saveEditSaida(item.cod_item, item.data_movimento)"
                                                    :disabled="savingSaida"
                                                    class="bg-orange-500 text-white rounded px-1.5 py-0.5 text-[10px] hover:bg-orange-600 disabled:opacity-50 transition-colors">
                                                <span v-if="savingSaida">...</span>
                                                <span v-else>OK</span>
                                            </button>
                                            <button @click="delete editingSaida[`${item.cod_item}|${item.data_movimento}`]"
                                                    class="text-[10px] text-slate-400 hover:text-slate-600">✕</button>
                                        </div>
                                    </td>
                                    <td class="px-4 py-2 text-right font-mono text-xs text-slate-600">{{ formatNumber(item.estq_escr_final) }}</td>
                                    <td class="px-4 py-2 text-right font-mono text-xs font-black text-slate-800">{{ formatNumber(item.fech_fisico_final) }}</td>
                                    <td class="px-4 py-2 text-right border-l border-slate-50">
                                        <span :class="item.variacao_litros >= 0 ? 'text-emerald-600' : 'text-rose-600'" class="text-xs font-mono font-bold">
                                            {{ item.variacao_litros > 0 ? '+' : '' }}{{ formatNumber(item.variacao_litros) }}
                                        </span>
                                    </td>
                                    <td class="px-4 py-2 text-right">
                                        <span :class="item.variacao_percentual > 0.6 ? 'text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded' : 'text-slate-500'" class="text-[11px] font-mono">
                                            {{ item.variacao_percentual.toFixed(3) }}%
                                        </span>
                                    </td>
                                    <td class="px-4 py-2 text-right font-mono text-[11px] font-black" :class="item.excesso > 0 ? 'text-rose-600' : 'text-slate-300'">
                                        {{ item.excesso > 0 ? formatNumber(item.excesso) + ' L' : '—' }}
                                    </td>
                                    <td class="px-4 py-2 text-center">
                                        <span v-if="item.status_anp === 'CONFORME'" class="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[9px] font-black rounded border border-emerald-100">OK</span>
                                        <span v-else-if="item.status_anp === 'FORA LIMITE'" class="px-2 py-0.5 bg-rose-50 text-rose-600 text-[9px] font-black rounded border border-rose-100 animate-pulse">FORA LIMITE</span>
                                        <span v-else-if="item.status_anp === 'EXCESSO'" class="px-2 py-0.5 bg-amber-50 text-amber-600 text-[9px] font-black rounded border border-amber-100">EXCESSO</span>
                                        <span v-else class="px-2 py-0.5 bg-slate-900 text-white text-[9px] font-black rounded">NEGATIVO</span>
                                    </td>
                                </tr>
                                <tr v-if="lmcDoCombustivel(comb.cod).length === 0">
                                    <td colspan="10" class="py-8 text-center text-slate-400 italic text-sm">Nenhum registro encontrado para este combustível.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
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
                <div v-for="conf in tankConfigs" :key="conf.cod_item" class="bg-slate-50 p-4 rounded-2xl border flex items-center justify-between gap-4" :class="conf.fromSped ? 'border-brand-accent/30 bg-brand-accent/5' : 'border-slate-100'">
                    <div class="flex flex-col">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-black text-slate-700">{{ conf.descr_item }}</span>
                            <span v-if="conf.fromSped" title="Capacidade detectada automaticamente do arquivo SPED" class="text-[8px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">SPED</span>
                        </div>
                        <span class="text-[9px] font-mono text-slate-400">COD: {{ conf.cod_item }}</span>
                    </div>
                    <div class="relative w-40">
                        <input v-model.number="conf.capacidade" type="number" step="0" @input="conf.fromSped = false" class="w-full bg-white border focus:border-brand-accent rounded-xl px-4 py-2 text-right font-black tabular-nums transition-all outline-none text-sm" :class="conf.fromSped ? 'border-brand-accent/40' : 'border-slate-200'">
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

    <!-- Modal de Lacres das Bombas (registro 1360) -->
    <div v-if="showLacresModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
        <div class="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl space-y-6 animate-fade-in max-h-[90vh] flex flex-col">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="text-2xl font-black text-slate-800 tracking-tighter">🔒 Lacres das <span class="text-brand-accent">Bombas</span></h3>
                    <p class="text-sm text-slate-400 font-medium">Informe os lacres de cada bomba (registro 1360). São injetados no SPED ao exportar.</p>
                </div>
                <button @click="showLacresModal = false" class="w-10 h-10 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-400 transition-colors">✕</button>
            </div>

            <div v-if="!lacresBombas.length" class="text-sm text-slate-400 italic py-6 text-center">Nenhuma bomba (registro 1350) encontrada neste arquivo.</div>

            <div class="overflow-y-auto pr-2 space-y-4 custom-scrollbar flex-1">
                <div v-for="(b, bi) in lacresBombas" :key="bi" class="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex flex-col">
                            <span class="text-xs font-black text-slate-700">Bomba: {{ b.serie }}</span>
                            <span class="text-[9px] font-mono text-slate-400">{{ b.fabricante }} · {{ b.modelo }}</span>
                        </div>
                        <span v-if="b.temLacre" class="text-[8px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">já tem 1360</span>
                        <span v-else class="text-[8px] font-black text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">sem lacre</span>
                    </div>
                    <div v-for="(l, li) in b.lacres" :key="li" class="flex items-center gap-2">
                        <input v-model="l.num_lacre" placeholder="Nº do lacre" class="flex-1 bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs font-bold outline-none transition-all" />
                        <input v-model="l.dt_aplicacao" placeholder="DDMMAAAA" maxlength="8" class="w-32 bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs font-mono text-center outline-none transition-all" />
                        <button @click="removeLacre(b, li)" class="w-8 h-8 shrink-0 bg-slate-100 hover:bg-red-100 hover:text-red-600 rounded-lg text-slate-400 transition-colors" title="Remover lacre">✕</button>
                    </div>
                    <button @click="addLacre(b)" class="text-[10px] font-black text-brand-accent hover:underline">+ adicionar lacre</button>
                </div>
            </div>

            <div class="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-start gap-3">
                <div class="text-xl">💡</div>
                <p class="text-[10px] text-amber-700 font-medium leading-relaxed italic">
                    O nº do lacre e a data (DDMMAAAA) são os do lacre físico aplicado na bomba. O PVA exige ao menos um lacre (1360) por bomba (1350).
                </p>
            </div>

            <div class="flex gap-3">
                <button @click="showLacresModal = false" class="flex-1 py-4 text-slate-500 font-bold hover:bg-slate-100 rounded-2xl transition-colors uppercase tracking-widest text-xs">CANCELAR</button>
                <button @click="saveLacres" :disabled="savingLacres" class="flex-[2] py-4 bg-slate-900 text-white font-black rounded-2xl shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
                    <Loader2 v-if="savingLacres" class="w-4 h-4 animate-spin"/>
                    {{ savingLacres ? 'SALVANDO...' : 'SALVAR LACRES' }}
                </button>
            </div>
        </div>
    </div>

    <!-- Modal de Credenciadoras (participantes do 1601) -->
    <div v-if="showCredModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
        <div class="bg-white rounded-3xl p-8 max-w-3xl w-full shadow-2xl space-y-6 animate-fade-in max-h-[90vh] flex flex-col">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="text-2xl font-black text-slate-800 tracking-tighter">💳 Credenciadoras <span class="text-brand-accent">(1601)</span></h3>
                    <p class="text-sm text-slate-400 font-medium">Dados das maquininhas/credenciadoras p/ gerar o registro 0150. Município e Endereço são obrigatórios.</p>
                </div>
                <button @click="showCredModal = false" class="w-10 h-10 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-400 transition-colors">✕</button>
            </div>

            <div v-if="!credList.length" class="text-sm text-slate-400 italic py-6 text-center">Nenhuma credenciadora do 1601 sem 0150 neste arquivo. 👍</div>

            <div class="overflow-y-auto pr-2 space-y-4 custom-scrollbar flex-1">
                <div v-for="(c, ci) in credList" :key="ci" class="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2">
                    <div class="flex items-center gap-2">
                        <span class="text-[9px] font-mono text-slate-400">CNPJ</span>
                        <span class="text-xs font-black text-slate-700">{{ c.cnpj }}</span>
                    </div>
                    <input v-model="c.nome" placeholder="Razão social" class="w-full bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs font-bold outline-none" />
                    <div class="grid grid-cols-2 gap-2">
                        <input v-model="c.cod_mun" placeholder="Cód. município IBGE (7 díg) *" maxlength="7" class="bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs font-mono outline-none" />
                        <input v-model="c.ie" placeholder="IE (ou ISENTO)" class="bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs outline-none" />
                    </div>
                    <input v-model="c.endereco" placeholder="Endereço (logradouro) *" class="w-full bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs outline-none" />
                    <div class="grid grid-cols-2 gap-2">
                        <input v-model="c.num" placeholder="Número" class="bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs outline-none" />
                        <input v-model="c.bairro" placeholder="Bairro" class="bg-white border border-slate-200 focus:border-brand-accent rounded-xl px-3 py-2 text-xs outline-none" />
                    </div>
                </div>
            </div>

            <div class="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-start gap-3">
                <div class="text-xl">💡</div>
                <p class="text-[10px] text-amber-700 font-medium leading-relaxed italic">
                    O 0150 só é injetado para credenciadoras com <b>Código de município</b> e <b>Endereço</b> preenchidos (obrigatórios no PVA). Os dados são reaproveitados em todos os arquivos.
                </p>
            </div>

            <div class="flex gap-3">
                <button @click="showCredModal = false" class="flex-1 py-4 text-slate-500 font-bold hover:bg-slate-100 rounded-2xl transition-colors uppercase tracking-widest text-xs">CANCELAR</button>
                <button @click="saveCred" :disabled="savingCred || !credList.length" class="flex-[2] py-4 bg-slate-900 text-white font-black rounded-2xl shadow-lg shadow-slate-200 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs">
                    <Loader2 v-if="savingCred" class="w-4 h-4 animate-spin"/>
                    {{ savingCred ? 'SALVANDO...' : 'SALVAR CREDENCIADORAS' }}
                </button>
            </div>
        </div>
    </div>

    <!-- Modal de LMC Incompleto: dias do período sem Registro 1300 -->
    <div v-if="showLmcLacunaModal && avisosLmcUpload" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
        <div class="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto">
            <div class="flex justify-between items-start gap-4">
                <div class="flex items-start gap-3">
                    <div class="text-2xl">⚠️</div>
                    <div>
                        <h3 class="text-xl font-black text-amber-700">LMC Incompleto Detectado</h3>
                        <p class="text-xs text-slate-500 mt-1 font-medium">
                            Período <span class="font-mono font-bold">{{ avisosLmcUpload.periodo }}</span> ·
                            {{ avisosLmcUpload.total_dias_periodo }} dias esperados
                        </p>
                    </div>
                </div>
                <button @click="showLmcLacunaModal = false" class="w-9 h-9 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-400">✕</button>
            </div>

            <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 leading-relaxed">
                O arquivo SPED foi importado, mas o <b>Registro 1300 (LMC)</b> não cobre todos os dias do período.
                Isso costuma indicar que o LMC parou de ser lançado antes do fim do mês.
                Verifique na tabela abaixo quais combustíveis estão com dias faltantes — corrija no SPED de origem
                e reimporte para evitar erros de continuidade na auditoria.
            </div>

            <div class="space-y-2">
                <div v-for="prod in avisosLmcUpload.produtos.filter(p => p.dias_faltantes.length > 0)" :key="prod.cod_item"
                     class="border border-slate-200 rounded-2xl p-4 space-y-2">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <div class="text-sm font-black text-slate-800">{{ prod.descr_item }}</div>
                            <div class="text-[10px] font-mono text-slate-400">{{ prod.cod_item }}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-xs font-black text-rose-600">{{ prod.dias_faltantes.length }} dia(s) sem LMC</div>
                            <div class="text-[10px] text-slate-400">
                                Último lançamento: <span class="font-mono">{{ prod.ultimo_dia_com_lmc || '—' }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-1">
                        <span v-for="d in prod.dias_faltantes" :key="d"
                              class="text-[10px] font-mono bg-rose-50 text-rose-700 px-2 py-0.5 rounded border border-rose-100">
                            {{ d.split('-').reverse().join('/') }}
                        </span>
                    </div>
                </div>
            </div>

            <div class="flex gap-3 pt-2">
                <button @click="showLmcLacunaModal = false"
                        class="flex-1 py-4 bg-slate-900 text-white font-black rounded-2xl shadow-lg hover:bg-slate-800 transition-all uppercase tracking-widest text-xs">
                    Entendi, continuar auditoria
                </button>
            </div>
        </div>
    </div>

    <!-- Modal: Período Fora de Sequência -->
    <div v-if="showSequenciaModal && sequenciaInfo" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
        <div class="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl space-y-5">
            <div class="flex items-start gap-3">
                <div class="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-2xl shrink-0">⚠️</div>
                <div>
                    <h3 class="text-lg font-black text-amber-700">Período Fora de Sequência</h3>
                    <p class="text-xs text-slate-500 mt-1 font-medium">{{ sequenciaInfo.empresa }}</p>
                </div>
            </div>

            <div class="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                <div class="flex items-center justify-between text-sm">
                    <span class="text-slate-500 font-medium">Último período carregado:</span>
                    <span class="font-black text-slate-800">{{ sequenciaInfo.ultimoPeriodo }}</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-slate-500 font-medium">Período esperado:</span>
                    <span class="font-black text-emerald-600">{{ sequenciaInfo.esperado }}</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-slate-500 font-medium">Período do arquivo:</span>
                    <span class="font-black text-amber-700">{{ sequenciaInfo.novoPeriodo }}</span>
                </div>
            </div>

            <p class="text-xs text-slate-500 leading-relaxed">
                O arquivo que você está carregando não é o mês seguinte ao último período processado.
                Isso pode causar quebra de continuidade no LMC e divergências intermensais.
            </p>

            <div class="flex gap-3 pt-1">
                <button @click="cancelarUploadForaSequencia"
                        class="flex-1 py-3.5 bg-slate-100 text-slate-700 font-bold rounded-2xl hover:bg-slate-200 transition-all text-xs uppercase tracking-wider">
                    Cancelar
                </button>
                <button @click="confirmarUploadForaSequencia"
                        class="flex-1 py-3.5 bg-amber-500 text-white font-black rounded-2xl shadow-lg hover:bg-amber-600 transition-all text-xs uppercase tracking-wider">
                    Carregar mesmo assim
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
