<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import VueApexCharts from "vue3-apexcharts";
import { useRoute, useRouter } from 'vue-router'
import { empresaSelecionada, setArquivoInfo, setEmpresaSelecionada, idArquivoSped, setIdArquivoSped, arquivoInfo, auditErros, auditResumoGerencial, auditResumoEstoque, resetArquivoSped, token } from '../store'
import { Loader2, ExternalLink } from 'lucide-vue-next'
import NfItens from '../components/NfItens.vue'
import MetricRuler from '../components/analisador/MetricRuler.vue'
import BlockCoverage from '../components/analisador/BlockCoverage.vue'
import OccurrenceTable from '../components/analisador/OccurrenceTable.vue'
import TotalizerGauge from '../components/analisador/TotalizerGauge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSelo from '@/components/ui/UiSelo.vue'

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

// ===== Conciliação SEFAZ (CSV) × escrituração (Fase 1) =====
const concilCsvFile = ref(null);
const concilCsvName = ref('');
const concilLoading = ref(false);
const concilError = ref('');
const concilResult = ref(null);
const concilDesconsiderarCanceladas = ref(true); // padrão: ignorar canceladas
const concilVerCanceladas = ref(false);          // mostrar/ocultar a lista de canceladas
const concilVerConferidas = ref(false);          // mostrar/ocultar a lista de notas conferidas (OK)
const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Loop A/B (SPED automático × SEFAZ): estado das ações de captura/injeção.
const concilActionLoading = ref(false);
const concilActionMsg = ref('');
// FASE ATUAL = só CONSULTA (read-only). Os botões de baixar/injetar ficam ocultos por ora;
// a automação total (download + injeção) foi ADIADA — ver PLANO_SPED_AUTOMATICO_SEFAZ.md.
// Reativar é só flipar para true.
const acoesInjecaoHabilitadas = ref(false);
const idEmpresaAtiva = () => empresaSelecionada?.value?.id || arquivoInfo?.value?.id_empresa || null;

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

// Conferir ao vivo via EspiãoNFe (sem CSV) — mesma saída visual da conciliação por CSV.
async function conciliarSefazLive() {
    concilError.value = ''; concilActionMsg.value = '';
    const cnpj = concilCnpjAtivo();
    const idEmp = idEmpresaAtiva();
    if (!idEmp) { concilError.value = 'Empresa não identificada. Abra um arquivo desta empresa.'; return; }
    if (cnpj.length < 11) { concilError.value = 'CNPJ da empresa ausente.'; return; }
    concilLoading.value = true; concilResult.value = null;
    try {
        const token = localStorage.getItem('token');
        const body = { id_empresa: idEmp, cnpj, sync: true };
        if (idArquivoSped.value) body.id_arquivo = idArquivoSped.value;
        const res = await axios.post(`${API_BASE_URL}/api/conciliacao/sefaz-live`, body, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        concilResult.value = res.data;
    } catch (e) {
        concilError.value = e.response?.data?.message || ('Erro ao conferir ao vivo: ' + e.message);
    } finally { concilLoading.value = false; }
}

const _chavesValidasConcil = (arr) => (arr || []).map(x => limpaChave(x.chave)).filter(c => c.length === 44);

async function _postAcaoConcil(url, chaves) {
    const token = localStorage.getItem('token');
    return axios.post(`${API_BASE_URL}${url}`, {
        id_arquivo: idArquivoSped.value, id_empresa: idEmpresaAtiva(), cnpj: concilCnpjAtivo(), chaves
    }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

// Loop A: baixar o XML dos faltantes e injetar no SPED aberto; reconfere ao final.
async function aplicarFaltantes() {
    concilError.value = ''; concilActionMsg.value = '';
    if (!idArquivoSped.value) { concilError.value = 'Abra o SPED (arquivo) para injetar.'; return; }
    const chaves = _chavesValidasConcil(concilResult.value?.faltantes);
    if (!chaves.length) { concilError.value = 'Nenhum faltante com chave válida (44 dígitos) para baixar.'; return; }
    if (!confirm(`Baixar e INJETAR ${chaves.length} nota(s) faltante(s) no SPED aberto?`)) return;
    concilActionLoading.value = true;
    try {
        const res = await _postAcaoConcil('/api/conciliacao/aplicar-faltantes', chaves);
        concilActionMsg.value = (res.data.message || 'Concluído.') + ' Reconferindo…';
        await conciliarSefazLive();
    } catch (e) { concilError.value = e.response?.data?.message || ('Erro: ' + e.message); }
    finally { concilActionLoading.value = false; }
}

// Loop B: baixar o XML real das divergências e re-injetar (substitui a nota com valor errado).
async function corrigirDivergentes() {
    concilError.value = ''; concilActionMsg.value = '';
    if (!idArquivoSped.value) { concilError.value = 'Abra o SPED (arquivo) para corrigir.'; return; }
    const chaves = _chavesValidasConcil(concilResult.value?.divergencia_valor);
    if (!chaves.length) { concilError.value = 'Nenhuma divergência com chave válida.'; return; }
    if (!confirm(`Baixar o XML real e RE-INJETAR ${chaves.length} nota(s), substituindo a versão com valor errado?`)) return;
    concilActionLoading.value = true;
    try {
        const res = await _postAcaoConcil('/api/conciliacao/corrigir-divergentes', chaves);
        concilActionMsg.value = (res.data.message || 'Concluído.') + ' Reconferindo…';
        await conciliarSefazLive();
    } catch (e) { concilError.value = e.response?.data?.message || ('Erro: ' + e.message); }
    finally { concilActionLoading.value = false; }
}

function exportConcilCsv() {
    const r = concilResult.value; if (!r) return;
    const rows = [['Categoria', 'Numero NF', 'Chave', 'Competencia', 'Emissao', 'Valor / Detalhe', 'Fornecedor']];
    r.faltantes.forEach(f => rows.push([f.uso_consumo ? 'FALTANTE_USO_CONSUMO' : 'FALTANTE', f.numero, f.chave, f.comp, f.data, f.valor, f.fornecedor]));
    r.divergencia_valor.forEach(d => rows.push(['DIVERG_VALOR', d.numero, d.chave, d.dataSped ? `Lancada ${d.dataSped}` : '', d.data, `SEFAZ ${d.valorSefaz} x SPED ${d.valorSped} (dif ${d.dif})`, d.fornecedor]));
    r.divergencia_competencia.forEach(d => rows.push(['LANCADA_OUTRO_MES', d.numero, d.chave, `Emit ${d.data} -> Lancada ${d.dataSped || d.compSped}`, d.data, d.valor, d.fornecedor]));
    r.extras.forEach(x => rows.push(['EXTRA_SPED', x.numero, x.chave, x.comp, x.data, x.valor, x.fornecedor]));
    (r.sem_sped || []).forEach(s => rows.push(['SEM_SPED_NO_PERIODO', s.numero, s.chave, s.comp, s.data, s.valor, s.fornecedor]));
    (r.canceladas || []).forEach(c => rows.push(['CANCELADA', c.numero, c.chave, c.comp, c.data, c.valor, c.fornecedor]));
    (r.conferidas || []).forEach(d => rows.push(['CONFERIDA', d.numero, d.chave, d.dataSped ? `Lancada ${d.dataSped}` : '', d.data, d.valorSefaz != null ? d.valorSefaz : `SEFAZ sem valor (SPED ${d.valorSped})`, d.fornecedor]));
    const csv = '\uFEFF' + rows.map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'conciliacao_sefaz.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

const totalVolumeCompra = computed(() => {
    if (!auditResumoGerencial.value?.estoqueResumo) return 0;
    return auditResumoGerencial.value.estoqueResumo.reduce((acc, curr) => acc + (curr.entradas || 0), 0);
});

const totalVolumeVenda = computed(() => {
    if (!auditResumoGerencial.value?.estoqueResumo) return 0;
    return auditResumoGerencial.value.estoqueResumo.reduce((acc, curr) => acc + (curr.saidas || 0), 0);
});

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

async function downloadSpedRetificado() {
    if (!idArquivoSped.value) {
        alert("Nenhum arquivo SPED selecionado para exportação.");
        return;
    }
    const currentToken = token.value || localStorage.getItem('token');
    try {
        const res = await axios.get(`${API_BASE_URL}/api/exportar-sped/${idArquivoSped.value}`, {
            headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {}, responseType: 'blob'
        });
        const cd = res.headers['content-disposition'] || '';
        const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
        const filename = (m && decodeURIComponent(m[1])) || `SPED_${idArquivoSped.value}.txt`;
        const url = URL.createObjectURL(res.data);
        const a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        // 422 (ex.: CAP_TANQUE faltante) / 502 vêm como JSON dentro de um Blob → extrai a mensagem legível
        let msg = e.message;
        try { const txt = (e.response?.data instanceof Blob) ? await e.response.data.text() : ''; const j = txt ? JSON.parse(txt) : null; msg = j?.message || j?.resumo || j?.erro || txt || msg; } catch (_) {}
        alert('Erro ao exportar: ' + msg);
    }
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
                // Parse+gravação do SPED no servidor pode passar de 30s (default global do axios),
                // abortando o cliente mesmo com o servidor concluindo. 5 min cobre com folga.
                timeout: 300000,
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
                    response = await axios.post(`${API_BASE_URL}/api/upload?overwrite=true`, formData, { timeout: 300000 });
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
    if (score < 30) return 'text-conforme';
    if (score < 70) return 'text-variacao';
    return 'text-lacre';
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

// ── Aferição: métricas para MetricRuler (aba Alertas) ────────────────────────
const afericaoMetrics = computed(() => {
    const total = auditErros.value.length;
    const criticos = auditErros.value.filter(e => e.tipo_erro === 'CRITICAL').length;
    const avisos = auditErros.value.filter(e => e.tipo_erro === 'WARNING').length;
    const conformes = total === 0 ? 1 : 0; // sem erros = arquivo conforme
    const metrics = [
        { label: 'Total de alertas', value: total, severity: total === 0 ? 'conforme' : criticos > 0 ? 'lacre' : 'variacao' },
        { label: 'Críticos', value: criticos, severity: criticos > 0 ? 'lacre' : 'conforme' },
        { label: 'Avisos', value: avisos, severity: avisos > 0 ? 'variacao' : 'conforme' },
    ];
    if (total === 0) {
        metrics.push({ label: 'Status', value: 'OK', severity: 'conforme' });
    }
    return metrics;
});

// ── Aferição: cobertura por bloco SPED (derivado dos registros com erro) ──────
const afericaoBlocks = computed(() => {
    // Extrai o registro de cada regra_id (ex: CRIT-1310-01 → 1310, RTAX-C170-01 → C170)
    // e mapeia para seu bloco pai (1xxx→1, Cxxx→C, Dxxx→D, etc.)
    const blocoMap = new Map(); // bloco → { temCritico, temAviso }
    auditErros.value.forEach(erro => {
        const parts = erro.regra_id.split('-');
        const reg = parts.length > 1 ? parts[1] : 'OUTROS';
        // Extrai o bloco: primeiro caractere uppercase ou numérico primeiro dígito
        const bloco = reg.match(/^[A-Za-z]/) ? reg[0].toUpperCase() : reg[0];
        const entry = blocoMap.get(bloco) || { temCritico: false, temAviso: false };
        if (erro.tipo_erro === 'CRITICAL') entry.temCritico = true;
        else entry.temAviso = true;
        blocoMap.set(bloco, entry);
    });
    return Array.from(blocoMap.entries()).map(([code, v]) => ({
        code,
        status: v.temCritico ? 'lacre' : 'variacao',
    })).sort((a, b) => a.code.localeCompare(b.code));
});

// ── Aferição: linhas para OccurrenceTable ────────────────────────────────────
const afericaoRows = computed(() => {
    return filteredAuditErros.value.map(erro => {
        const parts = erro.regra_id ? erro.regra_id.split('-') : [];
        const registro = parts.length > 1 ? parts[1] : (erro.regra_id || 'GERAL');
        // severity: CRITICAL → lacre; WARNING → variacao; demais → conforme
        const severity = erro.tipo_erro === 'CRITICAL' ? 'lacre'
                       : erro.tipo_erro === 'WARNING'  ? 'variacao'
                       : 'conforme';
        // origem: prefixo REAL da regra_id (ex: RTAX, CRIT, CAD, DOC, EST)
        // Não é uma procedência inventada — é o próprio identificador do grupo da regra.
        const prefixo = parts[0] || (erro.regra_id || 'GERAL');
        return {
            severity,
            registro,
            campo: erro.titulo_erro || erro.regra_id,
            // from: não usado como "linha antes" (não é um diff real de valor).
            // conteudo_linha é contexto, exibido como texto secundário via campo.
            from: undefined,
            // to: descrição do erro/ocorrência
            to: erro.descricao_erro ? erro.descricao_erro.replace(/\*\*/g, '') : '—',
            // contexto: linha SPED crua, se disponível (exibida pelo OccurrenceTable como texto secundário)
            contexto: erro.conteudo_linha && erro.conteudo_linha.trim() ? erro.conteudo_linha.trim() : undefined,
            origem: prefixo,
        };
    });
});

// ── Aferição: TotalizerGauge — maior variação de estoque do período ──────────
// Tolerância ANP (Portaria ANP 420/2019, §5°): 0,60% — Não alterar sem base legal.
const LIMITE_ANP = 0.60
// Gauge só é exibido se existirem dados reais com variação numérica (evita agulha falsa).
const afericaoGauge = computed(() => {
    const es = auditResumoGerencial.value?.estoqueResumo || [];
    if (!es.length) return null;
    // Pega o combustível com maior variação percentual absoluta
    const pior = es.reduce((acc, x) => {
        const v = Math.abs(parseFloat(x.variacao_perc) || 0);
        return v > (Math.abs(parseFloat(acc.variacao_perc) || 0)) ? x : acc;
    }, es[0]);
    const varPerc = Math.abs(parseFloat(pior.variacao_perc) || 0);
    // Se todos os combustíveis têm variação zero, omite o gauge (sem dado real para exibir)
    if (varPerc === 0 && es.every(x => (parseFloat(x.variacao_perc) || 0) === 0)) return null;
    return {
        label: `Variação ANP — maior do período (${pior.nome_combustivel || pior.cod_item || 'Comb.'})`,
        value: varPerc.toFixed(2) + '%',
        min: 0,
        // Teto visual = tolerância ANP (agulha além do limite indica irregularidade)
        max: LIMITE_ANP,
        limit: LIMITE_ANP,
        current: varPerc,
    };
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
      <div v-if="showSuccessToast" class="fixed top-4 right-4 z-[100] w-full max-w-xs bg-sheet rounded-md card-shadow border border-line p-4 flex items-center gap-3">
        <div class="w-8 h-8 bg-conforme/10 rounded-md flex items-center justify-center text-conforme shrink-0">✓</div>
        <div>
          <h4 class="text-[11px] uppercase tracking-wide text-ink font-medium">Auditoria Concluída!</h4>
          <p class="text-[10px] text-risco">Cruzamentos processados com sucesso.</p>
        </div>
        <button @click="showSuccessToast = false" class="text-risco hover:text-ink transition-colors ml-auto text-lg leading-none">&times;</button>
      </div>
    </Transition>

    <!-- Header de Contexto -->
    <header class="flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div>
        <h2 class="font-display text-[22px] font-semibold text-ink tracking-[-0.01em]">
          Motor de Auditoria
        </h2>
        <div v-if="empresaSelecionada" class="flex flex-wrap items-center gap-2 mt-1.5">
          <span class="inline-flex items-center gap-1.5 bg-bronze/10 text-bronze px-2.5 py-1 rounded-md text-[12px] font-medium max-w-[340px] truncate" :title="empresaSelecionada.nome_empresa">
            {{ empresaSelecionada.nome_empresa }}
          </span>
          <span v-if="empresaSelecionada.cnpj" class="inline-flex items-center bg-graphite text-white px-2.5 py-1 rounded-md text-[12px] font-mono tracking-[-0.01em]" title="CNPJ da empresa">
            <span class="opacity-60 text-[9px] uppercase tracking-wide mr-1.5">CNPJ</span>{{ formatCnpj(empresaSelecionada.cnpj) }}
          </span>
          <button @click="trocarEmpresa" class="text-[11px] text-risco hover:text-bronze font-medium underline underline-offset-2">trocar</button>
        </div>
      </div>

      <div v-if="arquivoInfo" class="flex items-center gap-2">
        <div class="flex gap-1.5">
          <UiButton variant="ghost" @click="downloadDossie">
            📥 Dossiê PDF
          </UiButton>
          <UiButton variant="ghost" @click="downloadExcel">
            📊 Excel
          </UiButton>
          <UiButton @click="downloadSpedRetificado">
            🛠️ Exportar SPED
          </UiButton>
        </div>
        <div class="flex items-center gap-2 bg-sheet px-3 py-1.5 rounded-md border border-line">
          <div class="w-7 h-7 rounded-md bg-bronze/10 flex items-center justify-center text-bronze text-sm shrink-0">📄</div>
          <div>
            <p class="text-[12px] font-medium text-ink leading-none">{{ arquivoInfo.periodo }}</p>
            <p class="text-[10px] text-risco font-mono mt-0.5 truncate max-w-[160px]">{{ arquivoInfo.nome }}</p>
          </div>
        </div>
      </div>
    </header>

    <!-- Banner persistente: sequência de meses quebrada -->
    <div v-if="sequenciaAlerta && sequenciaAlerta.faltantes.length" class="bg-variacao/10 border border-variacao/30 rounded-md px-4 py-3 flex items-start gap-3">
      <span class="text-variacao text-lg leading-none mt-0.5">⚠</span>
      <div class="flex-1">
        <p class="text-[11px] uppercase tracking-wide text-variacao font-medium">Sequência de períodos quebrada</p>
        <p class="text-[11px] text-ink mt-0.5">
          Faltam os meses <strong class="font-mono">{{ sequenciaAlerta.faltantes.map(fmtMes).join(', ') }}</strong> desta empresa.
          Auditar/exportar fora da ordem cronológica pode gerar estoque de abertura e encerrantes inconsistentes.
        </p>
      </div>
      <button @click="activeTab = 'novo'" class="text-[10px] font-medium text-variacao hover:opacity-80 bg-variacao/15 px-2.5 py-1 rounded-md whitespace-nowrap shrink-0">Ver arquivos</button>
    </div>

    <!-- Tabs Estilizadas -->
    <div class="flex flex-wrap gap-1 p-1 bg-paper border border-line rounded-md w-fit">
      <button
        @click="activeTab = 'dashboard'"
        :class="activeTab === 'dashboard' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all">
        Dashboard
      </button>
      <button
        @click="activeTab = 'notas'"
        :class="activeTab === 'notas' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all">
        Notas
      </button>
      <button
        @click="activeTab = 'saidas'"
        :class="activeTab === 'saidas' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all">
        Saídas NF
      </button>
      <button
        @click="activeTab = 'conciliacao'"
        :class="activeTab === 'conciliacao' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all relative">
        Conciliação SEFAZ
        <span v-if="concilResult && concilResult.totais.faltantes" class="absolute -top-1 -right-1 w-4 h-4 bg-lacre text-white text-[9px] flex items-center justify-center rounded-full border-2 border-paper">
          {{ concilResult.totais.faltantes }}
        </span>
      </button>
      <button
        @click="idArquivoSped && router.push('/lmc/' + idArquivoSped)"
        :disabled="!idArquivoSped"
        title="Abrir o Livro LMC (inclui a aba Auditoria)"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all text-risco hover:text-ink flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
        Livro LMC
        <ExternalLink class="w-3 h-3" :stroke-width="1.8" />
      </button>
      <button
        @click="activeTab = 'erros'"
        :class="activeTab === 'erros' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all relative">
        Alertas
        <span v-if="auditErros.length" class="absolute -top-1 -right-1 w-4 h-4 bg-lacre text-white text-[9px] flex items-center justify-center rounded-full border-2 border-paper">
          {{ auditErros.length }}
        </span>
      </button>
      <button
        @click="activeTab = 'sintaxe'"
        :class="activeTab === 'sintaxe' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all relative">
        Malha Fina
        <span v-if="totalInfractions" class="absolute -top-1 -right-1 w-4 h-4 bg-variacao text-white text-[9px] flex items-center justify-center rounded-full border-2 border-paper">
          {{ totalInfractions }}
        </span>
      </button>
      <button
        @click="activeTab = 'novo'"
        :class="activeTab === 'novo' ? 'bg-bronze text-white' : 'text-risco hover:text-ink'"
        class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all">
        Upload
      </button>
    </div>

    <!-- Conteúdo: Conciliação SEFAZ (CSV) -->
    <div v-if="activeTab === 'conciliacao'" class="space-y-6">
      <div class="bg-sheet p-6 rounded-md border border-line card-shadow">
        <h3 class="font-display text-[16px] font-semibold text-ink">Conciliação SEFAZ × Escrituração</h3>
        <p class="text-[13px] text-risco mt-1 max-w-2xl">Suba a "Relação de NF-e" (CSV) da SEFAZ. O sistema cruza com as notas de <b>entrada</b> já no banco desta empresa (CNPJ {{ empresaSelecionada?.cnpj || arquivoInfo?.cnpj || '—' }}) e aponta o que está na SEFAZ e falta na sua escrituração. O período é detectado automaticamente pelas datas do CSV.</p>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <label class="px-4 py-2 rounded-md bg-paper hover:bg-line/50 text-[12px] font-medium text-ink border border-line cursor-pointer transition-all">
            <input type="file" accept=".csv,.CSV" class="hidden" @change="onConcilCsvSelected">
            {{ concilCsvName || 'Selecionar CSV da SEFAZ' }}
          </label>
          <UiButton @click="conciliarSefaz" :disabled="concilLoading || !concilCsvFile" :class="(concilLoading || !concilCsvFile) ? 'opacity-50 cursor-not-allowed' : ''">
            {{ concilLoading ? 'Conciliando…' : 'Conciliar' }}
          </UiButton>
          <UiButton @click="conciliarSefazLive" :disabled="concilLoading" :class="concilLoading ? 'opacity-50 cursor-not-allowed' : ''" title="Consulta a SEFAZ ao vivo (EspiãoNFe) e cruza com o SPED — sem precisar de CSV">
            {{ concilLoading ? 'Conferindo…' : '⚡ Conferir com SEFAZ (ao vivo)' }}
          </UiButton>
          <label class="flex items-center gap-1.5 text-[12px] font-medium text-risco cursor-pointer select-none">
            <input type="checkbox" v-model="concilDesconsiderarCanceladas" @change="onToggleCanceladas" class="rounded border-line text-bronze focus:ring-bronze">
            Desconsiderar canceladas
          </label>
          <span v-if="concilError" class="text-[12px] font-medium text-lacre">{{ concilError }}</span>
          <span v-if="concilActionMsg" class="text-[12px] font-medium text-conforme">{{ concilActionMsg }}</span>
          <span v-if="concilResult && concilResult.fonte === 'espiao'" class="text-[11px] text-bronze font-medium">via EspiãoNFe (ao vivo)</span>
        </div>
      </div>

      <div v-if="concilResult" class="space-y-5">
        <!-- Aviso: período do CSV sem SPED importado -->
        <div v-if="concilResult.meses_sem_sped && concilResult.meses_sem_sped.length"
             class="rounded-md border p-4 flex items-start gap-3"
             :class="concilResult.sem_sped_total ? 'bg-variacao/15 border-variacao/40' : 'bg-variacao/10 border-variacao/30'">
          <span class="text-xl leading-none">⚠️</span>
          <div class="text-[13px]">
            <p class="font-medium text-variacao">
              {{ concilResult.sem_sped_total ? 'Não há SPED importado para o período deste CSV.' : 'Alguns meses do CSV não têm SPED importado.' }}
            </p>
            <p class="text-ink mt-0.5">
              Sem SPED para: <b class="font-mono">{{ concilResult.meses_sem_sped.join(', ') }}</b>.
              {{ concilResult.totais.sem_sped }} nota(s) desse(s) mês(es) <b>não foram conferidas</b> e não entram em "faltantes".
              Importe o SPED do período e concilie novamente.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div class="bg-sheet p-4 rounded-md border border-line card-shadow text-center">
            <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Período (CSV)</p>
            <p class="text-[13px] font-mono text-ink">{{ concilResult.periodo || '—' }}</p>
          </div>
          <div class="bg-sheet p-4 rounded-md border border-line card-shadow text-center">
            <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Notas SEFAZ</p>
            <p class="text-lg font-mono text-ink">{{ concilResult.totais.sefaz_valido }}</p>
          </div>
          <div class="p-4 rounded-md border card-shadow text-center" :class="concilResult.totais.faltantes ? 'border-lacre/30 bg-lacre/10' : 'border-line bg-sheet'">
            <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Faltantes</p>
            <p class="text-lg font-mono" :class="concilResult.totais.faltantes ? 'text-lacre' : 'text-ink'">{{ concilResult.totais.faltantes }}</p>
            <p v-if="concilResult.totais.faltantes" class="text-[11px] font-mono text-lacre mt-0.5">{{ fmtBRL(concilResult.totais.faltantes_valor) }}</p>
          </div>
          <div class="p-4 rounded-md border card-shadow text-center" :class="(concilResult.totais.divergencia_valor || concilResult.totais.divergencia_competencia) ? 'border-variacao/30 bg-variacao/10' : 'border-line bg-sheet'">
            <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Divergências</p>
            <p class="text-lg font-mono text-variacao">{{ concilResult.totais.divergencia_valor + concilResult.totais.divergencia_competencia }}</p>
          </div>
          <div class="bg-sheet p-4 rounded-md border border-line card-shadow text-center">
            <p class="text-[10px] uppercase tracking-wide font-medium text-risco">Extras no SPED</p>
            <p class="text-lg font-mono text-ink">{{ concilResult.totais.extras }}</p>
          </div>
        </div>

        <div class="flex items-center gap-3 flex-wrap text-[11px] text-risco">
          <span v-if="concilResult.periodo_escopo" class="text-bronze font-medium">📅 Conferindo só o período do SPED aberto: {{ concilResult.periodo_escopo }}<template v-if="concilResult.totais.fora_escopo"> · {{ concilResult.totais.fora_escopo }} nota(s) de outros meses do CSV ignorada(s)</template></span>
          <button v-if="concilResult.totais.canceladas" @click="concilVerCanceladas = !concilVerCanceladas"
            class="underline decoration-dotted hover:text-ink">
            ⚪ {{ concilResult.totais.canceladas }} cancelada(s) {{ concilResult.incluiu_canceladas ? 'incluída(s)' : 'desconsiderada(s)' }} ({{ concilVerCanceladas ? 'ocultar' : 'ver' }})
          </button>
          <span v-if="concilResult.totais.uso_consumo" class="text-bronze font-medium">🔁 {{ concilResult.totais.uso_consumo }} de uso/consumo (emitidas pela própria empresa)</span>
          <span v-if="concilResult.sem_escrituracao" class="text-variacao font-medium">⚠️ Nenhuma escrituração encontrada para este CNPJ — confira se o SPED foi importado.</span>
          <UiButton @click="exportConcilCsv" class="ml-auto">📥 Exportar resultado (CSV)</UiButton>
        </div>

        <!-- Conferidas (SEFAZ e SPED batem) -->
        <div v-if="concilResult.conferidas && concilResult.conferidas.length" class="bg-sheet rounded-md border border-conforme/20 card-shadow overflow-hidden">
          <button @click="concilVerConferidas = !concilVerConferidas" class="w-full px-5 py-3 bg-conforme/10 border-b border-conforme/20 flex items-center justify-between gap-3 text-left">
            <span class="font-medium text-conforme text-[13px]">✅ Conferidas — SEFAZ e SPED batem ({{ concilResult.conferidas.length }})</span>
            <span class="text-[12px] text-conforme">{{ concilVerConferidas ? 'ocultar' : 'ver notas' }}</span>
          </button>
          <div v-if="concilVerConferidas" class="overflow-x-auto max-h-96">
            <table class="w-full text-[12px]">
              <thead class="bg-paper text-risco uppercase text-[10px] tracking-wide sticky top-0"><tr><th class="w-6 p-2"></th><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Fornecedor</th><th class="text-right p-2">Valor SEFAZ</th><th class="text-right p-2">Valor SPED</th><th class="text-left p-2">Emissão → Lançada</th></tr></thead>
              <tbody>
                <template v-for="(d,i) in concilResult.conferidas" :key="'ok'+i">
                  <tr class="border-t border-line hover:bg-paper">
                    <td class="p-2 text-center"><button @click="toggleNf(d.chave)" class="w-5 h-5 rounded bg-paper border border-line hover:bg-line/50 text-ink font-medium leading-none">{{ nfAberta(d.chave) ? '−' : '+' }}</button></td>
                    <td class="p-2 font-mono text-ink">{{ d.numero || '—' }}</td>
                    <td class="p-2 font-mono text-[10px] text-ink">{{ d.chave }}</td>
                    <td class="p-2">{{ d.fornecedor }}<span v-if="d.uso_consumo" class="ml-1 px-1.5 py-0.5 rounded bg-bronze/10 text-bronze text-[9px] font-medium whitespace-nowrap">uso/consumo</span></td>
                    <td class="p-2 text-right font-mono text-ink">{{ d.valorSefaz != null ? fmtBRL(d.valorSefaz) : '—' }}</td>
                    <td class="p-2 text-right font-mono text-ink">{{ fmtBRL(d.valorSped) }}</td>
                    <td class="p-2 whitespace-nowrap font-mono text-[11px]">{{ d.data || '—' }} <span class="text-risco">→</span> <span class="text-bronze">{{ d.dataSped || '—' }}</span></td>
                  </tr>
                  <tr v-if="nfAberta(d.chave)"><td colspan="7" class="p-0"><NfItens :chave="d.chave" :cnpj="concilCnpjAtivo()" /></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Faltantes -->
        <div v-if="concilResult.faltantes.length" class="bg-sheet rounded-md border border-lacre/20 card-shadow overflow-hidden">
          <div class="px-5 py-3 bg-lacre/10 border-b border-lacre/20 flex items-center justify-between gap-3">
            <span class="font-medium text-lacre text-[13px]">🔴 Na SEFAZ, faltando na escrituração ({{ concilResult.faltantes.length }}) · Total {{ fmtBRL(concilResult.totais.faltantes_valor) }}</span>
            <UiButton v-if="acoesInjecaoHabilitadas" @click="aplicarFaltantes" :disabled="concilActionLoading || !idArquivoSped" :class="(concilActionLoading || !idArquivoSped) ? 'opacity-50 cursor-not-allowed' : ''" :title="idArquivoSped ? 'Baixa o XML de cada faltante e injeta no SPED aberto' : 'Abra o SPED (arquivo) para injetar'">
              {{ concilActionLoading ? 'Injetando…' : '⬇️ Baixar + injetar faltantes' }}
            </UiButton>
          </div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-[12px]">
              <thead class="bg-paper text-risco uppercase text-[10px] tracking-wide sticky top-0"><tr><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <tr v-for="(f,i) in concilResult.faltantes" :key="'f'+i" class="border-t border-line hover:bg-paper">
                  <td class="p-2 font-mono text-ink">{{ f.numero }}</td><td class="p-2 font-mono text-[10px] text-ink">{{ f.chave }}</td><td class="p-2 font-mono">{{ f.comp }}</td><td class="p-2 text-right font-mono text-ink">{{ fmtBRL(f.valor) }}</td><td class="p-2 whitespace-nowrap font-mono">{{ f.data }}</td>
                  <td class="p-2">{{ f.fornecedor }}<span v-if="f.uso_consumo" class="ml-1 px-1.5 py-0.5 rounded bg-bronze/10 text-bronze text-[9px] font-medium whitespace-nowrap">uso/consumo</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Divergência de valor -->
        <div v-if="concilResult.divergencia_valor.length" class="bg-sheet rounded-md border border-variacao/20 card-shadow overflow-hidden">
          <div class="px-5 py-3 bg-variacao/10 border-b border-variacao/20 flex items-center justify-between gap-3">
            <span class="font-medium text-variacao text-[13px]">💰 Divergência de valor (mesma chave, valores diferentes) ({{ concilResult.divergencia_valor.length }})</span>
            <UiButton v-if="acoesInjecaoHabilitadas" @click="corrigirDivergentes" :disabled="concilActionLoading || !idArquivoSped" :class="(concilActionLoading || !idArquivoSped) ? 'opacity-50 cursor-not-allowed' : ''" :title="idArquivoSped ? 'Baixa o XML real e re-injeta corrigindo o valor (substitui a nota)' : 'Abra o SPED (arquivo) para corrigir'">
              {{ concilActionLoading ? 'Corrigindo…' : '🔧 Corrigir do XML real' }}
            </UiButton>
          </div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-[12px]">
              <thead class="bg-paper text-risco uppercase text-[10px] tracking-wide sticky top-0"><tr><th class="w-6 p-2"></th><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Fornecedor</th><th class="text-right p-2">Valor SEFAZ</th><th class="text-right p-2">Valor SPED</th><th class="text-right p-2">Diferença</th><th class="text-left p-2">Emissão → Lançada</th></tr></thead>
              <tbody>
                <template v-for="(d,i) in concilResult.divergencia_valor" :key="'dv'+i">
                  <tr class="border-t border-lacre/20 bg-lacre/[0.05] hover:bg-lacre/[0.10]">
                    <td class="p-2 text-center"><button @click="toggleNf(d.chave)" class="w-5 h-5 rounded bg-paper border border-line hover:bg-line/50 text-ink font-medium leading-none">{{ nfAberta(d.chave) ? '−' : '+' }}</button></td>
                    <td class="p-2 font-mono text-lacre font-medium">{{ d.numero }}</td><td class="p-2 text-lacre">{{ d.fornecedor }}</td><td class="p-2 text-right font-mono text-ink">{{ fmtBRL(d.valorSefaz) }}</td><td class="p-2 text-right font-mono text-ink">{{ fmtBRL(d.valorSped) }}</td><td class="p-2 text-right font-mono font-semibold text-lacre">{{ fmtBRL(d.dif) }}</td><td class="p-2 whitespace-nowrap font-mono text-[11px]"><span title="Emissão (SEFAZ)">{{ d.data || '—' }}</span> <span class="text-risco">→</span> <span title="Lançada no SPED" class="text-bronze">{{ d.dataSped || '—' }}</span></td>
                  </tr>
                  <tr v-if="nfAberta(d.chave)"><td colspan="7" class="p-0"><NfItens :chave="d.chave" :cnpj="concilCnpjAtivo()" /></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Lançada em outro mês (sem omissão) -->
        <div v-if="concilResult.divergencia_competencia.length" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
          <div class="px-5 py-3 bg-paper border-b border-line text-ink text-[13px]">
            <span class="font-medium">📅 Lançadas em outro mês — sem omissão ({{ concilResult.divergencia_competencia.length }})</span>
            <span class="block text-[11px] text-risco font-normal mt-0.5">A NF está na SEFAZ no mês emitido, mas foi escriturada em outra competência do seu SPED. <b>Não é omissão</b> — apenas lançamento em data diferente (atenção a crédito extemporâneo).</span>
          </div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-[12px]">
              <thead class="bg-paper text-risco uppercase text-[10px] tracking-wide sticky top-0"><tr><th class="w-6 p-2"></th><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Fornecedor</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão (SEFAZ)</th><th class="text-left p-2">Lançada no SPED</th></tr></thead>
              <tbody>
                <template v-for="(d,i) in concilResult.divergencia_competencia" :key="'dc'+i">
                  <tr class="border-t border-lacre/20 bg-lacre/[0.05] hover:bg-lacre/[0.10]">
                    <td class="p-2 text-center"><button @click="toggleNf(d.chave)" class="w-5 h-5 rounded bg-paper border border-line hover:bg-line/50 text-ink font-medium leading-none">{{ nfAberta(d.chave) ? '−' : '+' }}</button></td>
                    <td class="p-2 font-mono text-lacre font-medium">{{ d.numero }}</td><td class="p-2 font-mono text-[10px] text-lacre">{{ d.chave }}</td><td class="p-2 text-lacre">{{ d.fornecedor }}</td><td class="p-2 text-right font-mono text-ink">{{ fmtBRL(d.valor) }}</td><td class="p-2 whitespace-nowrap font-mono" title="Emissão (SEFAZ)">{{ d.data }}</td><td class="p-2 whitespace-nowrap font-mono font-medium text-bronze" title="Lançada no SPED">{{ d.dataSped || d.compSped }}</td>
                  </tr>
                  <tr v-if="nfAberta(d.chave)"><td colspan="7" class="p-0"><NfItens :chave="d.chave" :cnpj="concilCnpjAtivo()" /></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Extras -->
        <div v-if="concilResult.extras.length" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
          <div class="px-5 py-3 bg-paper border-b border-line font-medium text-risco text-[13px]">🟡 No SPED, sem correspondência na SEFAZ ({{ concilResult.extras.length }})</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-[12px]">
              <thead class="bg-paper text-risco uppercase text-[10px] tracking-wide sticky top-0"><tr><th class="w-6 p-2"></th><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <template v-for="(x,i) in concilResult.extras" :key="'x'+i">
                  <tr class="border-t border-line hover:bg-paper">
                    <td class="p-2 text-center"><button @click="toggleNf(x.chave)" class="w-5 h-5 rounded bg-paper border border-line hover:bg-line/50 text-ink font-medium leading-none">{{ nfAberta(x.chave) ? '−' : '+' }}</button></td>
                    <td class="p-2 font-mono text-ink">{{ x.numero }}</td><td class="p-2 font-mono text-[10px] text-ink">{{ x.chave }}</td><td class="p-2 font-mono">{{ x.comp }}</td><td class="p-2 text-right font-mono text-ink">{{ fmtBRL(x.valor) }}</td><td class="p-2 whitespace-nowrap font-mono">{{ x.data }}</td><td class="p-2">{{ x.fornecedor }}</td>
                  </tr>
                  <tr v-if="nfAberta(x.chave)"><td colspan="7" class="p-0"><NfItens :chave="x.chave" :cnpj="concilCnpjAtivo()" /></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Notas em meses sem SPED importado (não conferidas) -->
        <div v-if="concilResult.sem_sped && concilResult.sem_sped.length" class="bg-sheet rounded-md border border-variacao/20 card-shadow overflow-hidden">
          <div class="px-5 py-3 bg-variacao/10 border-b border-variacao/20 font-medium text-variacao text-[13px]">⚠️ Notas em meses sem SPED importado — não conferidas ({{ concilResult.sem_sped.length }})</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-[12px]">
              <thead class="bg-paper text-risco uppercase text-[10px] tracking-wide sticky top-0"><tr><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <tr v-for="(s,i) in concilResult.sem_sped" :key="'s'+i" class="border-t border-line hover:bg-paper">
                  <td class="p-2 font-mono text-ink">{{ s.numero }}</td><td class="p-2 font-mono text-[10px] text-ink">{{ s.chave }}</td><td class="p-2 font-mono">{{ s.comp }}</td><td class="p-2 text-right font-mono text-ink">{{ fmtBRL(s.valor) }}</td><td class="p-2 whitespace-nowrap font-mono">{{ s.data }}</td><td class="p-2">{{ s.fornecedor }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Canceladas (visível via o link "ver") -->
        <div v-if="concilVerCanceladas && concilResult.canceladas && concilResult.canceladas.length" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
          <div class="px-5 py-3 bg-paper border-b border-line font-medium text-risco text-[13px]">⚪ Notas canceladas/denegadas no CSV ({{ concilResult.canceladas.length }}) — {{ concilResult.incluiu_canceladas ? 'incluídas na conciliação' : 'desconsideradas' }}</div>
          <div class="overflow-x-auto max-h-96">
            <table class="w-full text-[12px]">
              <thead class="bg-paper text-risco uppercase text-[10px] tracking-wide sticky top-0"><tr><th class="text-left p-2">Nº NF</th><th class="text-left p-2">Chave</th><th class="text-left p-2">Comp.</th><th class="text-right p-2">Valor</th><th class="text-left p-2">Emissão</th><th class="text-left p-2">Fornecedor</th></tr></thead>
              <tbody>
                <tr v-for="(c,i) in concilResult.canceladas" :key="'c'+i" class="border-t border-line hover:bg-paper text-risco line-through decoration-line">
                  <td class="p-2 font-mono">{{ c.numero }}</td><td class="p-2 font-mono text-[10px]">{{ c.chave }}</td><td class="p-2 font-mono">{{ c.comp }}</td><td class="p-2 text-right font-mono">{{ fmtBRL(c.valor) }}</td><td class="p-2 whitespace-nowrap font-mono">{{ c.data }}</td><td class="p-2 no-underline">{{ c.fornecedor }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="!concilResult.sem_sped_total && !concilResult.faltantes.length && !concilResult.divergencia_valor.length && !concilResult.divergencia_competencia.length && !concilResult.extras.length"
             class="bg-conforme/10 border border-conforme/20 rounded-md p-6 text-center text-conforme font-medium">
          ✅ Tudo conciliado — nenhuma divergência no período.
        </div>
      </div>
    </div>

    <!-- Conteúdo: Auditoria Sintática (Malha Fina) -->
    <div v-if="activeTab === 'sintaxe'" class="space-y-6">
      <!-- Resumo Geral -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-sheet p-6 rounded-md border border-line card-shadow flex items-center gap-4">
          <div class="w-12 h-12 bg-lacre/10 rounded-md flex items-center justify-center text-lacre">📉</div>
          <div>
            <p class="text-[10px] font-medium text-risco uppercase tracking-wide">Divergência NFe</p>
            <p class="text-xl font-mono text-ink">{{ infractions.c100_valores_divergentes.length }}</p>
          </div>
        </div>
        <div class="bg-sheet p-6 rounded-md border border-line card-shadow flex items-center gap-4">
          <div class="w-12 h-12 bg-variacao/10 rounded-md flex items-center justify-center text-variacao">❓</div>
          <div>
            <p class="text-[10px] font-medium text-risco uppercase tracking-wide">Omissão (Saltos)</p>
            <p class="text-xl font-mono text-ink">{{ infractions.c100_saltos_enumeracao.length }}</p>
          </div>
        </div>
        <div class="bg-sheet p-6 rounded-md border border-line card-shadow flex items-center gap-4">
          <div class="w-12 h-12 bg-bronze/10 rounded-md flex items-center justify-center text-bronze">📦</div>
          <div>
            <p class="text-[10px] font-medium text-risco uppercase tracking-wide">Erros Cadastro</p>
            <p class="text-xl font-mono text-ink">{{ infractions.cfop_suspeitos.length }}</p>
          </div>
        </div>
        <div class="bg-sheet p-6 rounded-md border border-line card-shadow flex items-center gap-4">
          <div class="w-12 h-12 bg-conforme/10 rounded-md flex items-center justify-center text-conforme">⛽</div>
          <div>
            <p class="text-[10px] font-medium text-risco uppercase tracking-wide">LMC x Inventário</p>
            <p class="text-xl font-mono text-ink">{{ infractions.h010_divergente_1300.length }}</p>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4" v-if="(infractions.chv_nfe_cnpj_divergente?.length || 0) + (infractions.bicos_duplicados_1320?.length || 0) > 0">
        <div v-if="infractions.chv_nfe_cnpj_divergente?.length" class="bg-sheet p-6 rounded-md border border-bronze/30 card-shadow flex items-center gap-4">
          <div class="w-12 h-12 bg-bronze/10 rounded-md flex items-center justify-center text-bronze">🔑</div>
          <div>
            <p class="text-[10px] font-medium text-bronze uppercase tracking-wide">CNPJ Chave Divergente</p>
            <p class="text-xl font-mono text-ink">{{ infractions.chv_nfe_cnpj_divergente.length }}</p>
          </div>
        </div>
        <div v-if="infractions.bicos_duplicados_1320?.length" class="bg-sheet p-6 rounded-md border border-bronze/30 card-shadow flex items-center gap-4">
          <div class="w-12 h-12 bg-bronze/10 rounded-md flex items-center justify-center text-bronze">⛽</div>
          <div>
            <p class="text-[10px] font-medium text-bronze uppercase tracking-wide">Bicos Duplicados</p>
            <p class="text-xl font-mono text-ink">{{ infractions.bicos_duplicados_1320.length }}</p>
          </div>
        </div>
      </div>

      <!-- Detalhamento das Infrações -->
      <div class="bg-sheet rounded-md card-shadow border border-line overflow-hidden">
        <div class="p-6 border-b border-line bg-paper flex justify-between items-center">
          <h3 class="font-display text-[16px] font-semibold text-ink tracking-[-0.01em] uppercase">Laudo de Auditoria Sintática</h3>
          <UiButton @click="runSyntaxAnalysis" :disabled="loadingSintaxe">
            {{ loadingSintaxe ? 'PROCESSANDO...' : 'RE-ANALISAR AGORA' }}
          </UiButton>
        </div>

        <div v-if="loadingSintaxe" class="py-20 flex flex-col items-center justify-center">
           <div class="animate-spin rounded-full h-10 w-10 border-4 border-bronze border-t-transparent mb-4"></div>
           <p class="text-[11px] font-medium text-risco tracking-wide uppercase">Motor em Memória: Escaneando Layout SPED...</p>
        </div>

        <div v-else class="divide-y divide-line">
           <!-- Divergência C100 -->
           <div v-if="infractions.c100_valores_divergentes.length" class="p-6 bg-lacre/5">
              <h4 class="text-[11px] font-medium text-lacre uppercase tracking-wide mb-4 flex items-center gap-2">🚨 Divergência: Capa vs Itens (C190)</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                 <div v-for="err in infractions.c100_valores_divergentes" :key="err.linha" class="p-3 bg-sheet border border-lacre/20 rounded-md text-[11px] flex justify-between items-center">
                    <div>
                      <span class="font-medium font-mono">L-{{ err.linha }}:</span> NF {{ err.num_doc }} divergente.
                      Capa: <span class="font-mono text-ink">{{ formatCurrency(err.valor_capa) }}</span> vs
                      Escriturado: <span class="font-mono text-ink">{{ formatCurrency(err.valor_calculado) }}</span>
                    </div>
                 </div>
              </div>
           </div>

           <!-- Saltos de Numeração -->
           <div v-if="infractions.c100_saltos_enumeracao.length" class="p-6 bg-variacao/5">
              <h4 class="text-[11px] font-medium text-variacao uppercase tracking-wide mb-4 flex items-center gap-2">❓ Omissão de Notas (Saltos no Sequencial)</h4>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                 <div v-for="err in infractions.c100_saltos_enumeracao" :key="err.linha" class="p-3 bg-sheet border border-variacao/20 rounded-md text-[11px]">
                    Detectado salto na linha {{ err.linha }}. Anterior: {{ err.num_anterior }} | Próxima: {{ err.num_atual }}.
                    <span class="block font-medium text-variacao mt-1">Possível falta de lançamento.</span>
                 </div>
              </div>
           </div>

           <!-- Cadastro de Produtos -->
           <div v-if="infractions.cfop_suspeitos.length" class="p-6">
              <h4 class="text-[11px] font-medium text-bronze uppercase tracking-wide mb-4 flex items-center gap-2">📦 Vícios de Cadastro de Produtos (NCM/CEST/CFOP)</h4>
              <div class="space-y-2">
                 <div v-for="err in infractions.cfop_suspeitos" :key="err.linha" class="p-3 bg-paper rounded-md text-[11px] border border-line">
                    <span class="font-medium font-mono">Linha {{ err.linha }}:</span> {{ err.alerta }}
                 </div>
              </div>
           </div>

           <!-- Bloco H vs 1300 -->
           <div v-if="infractions.h010_divergente_1300.length" class="p-6 bg-conforme/5">
              <h4 class="text-[11px] font-medium text-conforme uppercase tracking-wide mb-4 flex items-center gap-2">⛽ Descasamento Físico: LMC x Inventário</h4>
              <div v-for="err in infractions.h010_divergente_1300" :key="err.alerta" class="p-4 bg-sheet border border-conforme/20 rounded-md text-[13px]">
                 {{ err.alerta }}
                 <div class="mt-2 flex gap-4 text-[10px]">
                    <span>LMC: <span class="font-mono text-ink">{{ formatNumber(err.lmc) }} L</span></span>
                    <span>Inventário: <span class="font-mono text-ink">{{ formatNumber(err.inventario) }} L</span></span>
                    <span class="text-lacre">Diferença: {{ formatNumber(err.diff) }} L</span>
                 </div>
              </div>
           </div>

           <!-- CNPJ Divergente na Chave NF-e/NFC-e -->
           <div v-if="infractions.chv_nfe_cnpj_divergente && infractions.chv_nfe_cnpj_divergente.length" class="p-6 bg-bronze/5">
              <h4 class="text-[11px] font-medium text-bronze uppercase tracking-wide mb-4 flex items-center gap-2">🔑 CNPJ Divergente na Chave NF-e/NFC-e</h4>
              <div class="p-4 bg-sheet border border-bronze/20 rounded-md text-[13px] mb-3">
                <p class="font-medium text-bronze mb-2">
                  {{ infractions.chv_nfe_cnpj_divergente.length }} documentos de emissao propria com CNPJ diferente do informante na chave de acesso.
                </p>
                <div class="flex gap-6 text-[10px] text-risco">
                  <span>NFC-e: <span class="font-mono text-ink">{{ infractions.chv_nfe_cnpj_divergente.filter(e => e.modelo === 'NFC-e').length }}</span></span>
                  <span>NF-e: <span class="font-mono text-ink">{{ infractions.chv_nfe_cnpj_divergente.filter(e => e.modelo === 'NF-e').length }}</span></span>
                  <span>CNPJ na chave: <span class="font-mono text-ink">{{ [...new Set(infractions.chv_nfe_cnpj_divergente.map(e => e.cnpj_chave))].join(', ') }}</span></span>
                  <span>CNPJ informante: <span class="font-mono text-ink">{{ infractions.chv_nfe_cnpj_divergente[0]?.cnpj_informante }}</span></span>
                </div>
                <p class="text-[10px] text-bronze mt-2 font-medium">O sistema corrigira automaticamente ao exportar o SPED.</p>
              </div>
           </div>

           <!-- Bicos Duplicados entre Tanques -->
           <div v-if="infractions.bicos_duplicados_1320 && infractions.bicos_duplicados_1320.length" class="p-6 bg-bronze/5">
              <h4 class="text-[11px] font-medium text-bronze uppercase tracking-wide mb-4 flex items-center gap-2">⛽ Bico Duplicado entre Tanques (1320)</h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                 <div v-for="err in infractions.bicos_duplicados_1320.slice(0, 10)" :key="err.data + err.bico" class="p-3 bg-sheet border border-bronze/20 rounded-md text-[11px]">
                    <span class="font-mono text-ink">{{ err.data }}</span> — {{ err.produto }} — Bico <span class="font-mono text-ink">{{ err.bico }}</span>
                    <div class="text-[10px] text-risco mt-1">Tanques: {{ err.tanques }} | Volumes: {{ err.volumes }}</div>
                    <div class="text-[10px] text-bronze font-medium mt-1">Erro no arquivo original — bico registrado em dois tanques.</div>
                 </div>
                 <div v-if="infractions.bicos_duplicados_1320.length > 10" class="p-3 bg-bronze/10 rounded-md text-[11px] text-bronze font-medium flex items-center justify-center">
                    ... e mais {{ infractions.bicos_duplicados_1320.length - 10 }} ocorrencias
                 </div>
              </div>
           </div>

           <!-- Sem erros -->
           <div v-if="totalInfractions === 0" class="py-20 text-center flex flex-col items-center gap-3">
              <div class="text-4xl">💎</div>
              <p class="font-display text-[16px] font-semibold text-conforme uppercase tracking-wide">Nenhuma Infração Estrutural Detectada</p>
              <p class="text-[13px] text-risco">O arquivo parece íntegro nos cruzamentos de Bloco C e H.</p>
           </div>
        </div>
      </div>
    </div>

    <!-- Conteúdo: NFs Analíticas (C100/170/190) -->
    <div v-if="activeTab === 'notas'" class="space-y-6">
       <div class="bg-sheet rounded-md overflow-hidden card-shadow border border-line">
          <div class="p-6 border-b border-line flex flex-col md:flex-row justify-between items-center bg-paper gap-4">
             <div>
                <h3 class="font-display text-[16px] font-semibold text-ink">Notas Fiscais vs Produtos</h3>
                <p class="text-[12px] text-risco">Conciliação C100 (Capa), C190 (Resumo) e C170 (Detalhes)</p>
             </div>
             <div class="flex items-center gap-4">
                 <div class="text-right">
                    <p class="text-[10px] font-medium uppercase text-risco tracking-wide">Total Entradas</p>
                    <p class="text-lg font-mono text-ink leading-none mt-0.5">{{ formatCurrency(totalEntradaNotas) }}</p>
                 </div>
                 <input v-model="buscaNF" type="text" placeholder="Buscar por NF ou Fornecedor" class="px-4 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-bronze w-64" />
             </div>
          </div>

          <div v-if="loadingNotas" class="py-20 flex flex-col items-center justify-center text-risco">
             <div class="animate-spin text-3xl mb-4 border-4 border-bronze/20 border-t-bronze rounded-full w-8 h-8"></div>
             <p class="font-medium text-[13px] tracking-wide uppercase">PROCESSANDO TABELAS REGISTRO C...</p>
          </div>

          <div v-else-if="filteredNotas.length === 0" class="py-20 text-center text-risco">
             <p class="text-[16px] font-medium">Nenhuma Nota Encontrada</p>
          </div>

          <div v-else class="overflow-x-auto">
              <table class="w-full text-left">
                  <thead class="bg-paper border-b border-line text-[10px] font-medium uppercase text-risco tracking-wide">
                      <tr>
                          <th class="py-4 px-6 w-10"></th>
                          <th class="py-4 px-6">Nº NF</th>
                          <th class="py-4 px-6">Emissão</th>
                          <th class="py-4 px-6">Fornecedor</th>
                          <th class="py-4 px-6 text-right">Valor Declarado (NF)</th>
                          <th class="py-4 px-6 text-center border-l border-line bg-paper">Totais Analítico (C190)</th>
                      </tr>
                  </thead>
                  <tbody class="text-[13px] text-risco divide-y divide-line">
                      <template v-for="nf in filteredNotas" :key="nf.id">
                          <tr class="hover:bg-paper cursor-pointer transition-colors" :class="{'bg-paper': expandedNotas.has(nf.id)}" @click="toggleNota(nf.id)">
                              <td class="py-4 px-6 text-risco font-medium">
                                  {{ expandedNotas.has(nf.id) ? '▼' : '▶' }}
                              </td>
                              <td class="py-4 px-6 font-mono text-ink">#{{ nf.num_doc }}</td>
                              <td class="py-4 px-6 font-mono">{{ nf.dt_doc ? new Date(nf.dt_doc).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'S/ Data' }}</td>
                              <td class="py-4 px-6 truncate max-w-[200px]" :title="nf.nome_fornecedor">{{ nf.nome_fornecedor || 'Desconhecido' }}</td>
                              <td class="py-4 px-6 text-right font-mono text-ink">{{ formatCurrency(nf.vl_doc) }}</td>

                              <td class="py-3 px-6 text-right border-l border-line bg-paper">
                                  <div v-if="nf.consolidacao_c190 && nf.consolidacao_c190.length" class="flex flex-col gap-1 items-end">
                                      <div v-for="(c190, idx) in nf.consolidacao_c190" :key="idx" class="flex items-center gap-2 text-[10px]">
                                          <span class="bg-bronze/10 text-bronze px-1.5 py-0.5 rounded font-mono" title="CFOP predominante">{{ c190.cfop }}</span>
                                          <span class="text-risco">Opr: {{ formatCurrency(c190.vl_opr) }}</span>
                                          <span class="font-mono text-ink border-l border-line pl-2">ICMS: {{ formatCurrency(c190.vl_icms) }}</span>
                                      </div>
                                  </div>
                                  <span v-else class="text-[12px] text-risco">Sem C190</span>
                              </td>
                          </tr>
                          
                          <!-- DETALHE C170 -->
                          <tr v-if="expandedNotas.has(nf.id)">
                              <td colspan="6" class="p-0 bg-paper border-b-2 border-line">
                                  <div class="px-14 py-6">
                                      <div class="flex items-center gap-3 mb-4">
                                          <span class="text-[10px] uppercase font-medium tracking-wide text-risco bg-sheet px-3 py-1 rounded-md border border-line">Itens da Nota (C170)</span>
                                          <span class="text-[12px] font-medium text-risco">Encontrados {{ nf.itens_c170?.length || 0 }} produtos</span>
                                      </div>

                                      <div v-if="nf.itens_c170 && nf.itens_c170.length > 0" class="bg-sheet border text-left border-line rounded-md overflow-hidden w-full max-w-5xl">
                                          <table class="w-full">
                                              <thead class="bg-paper text-[9px] uppercase tracking-wide text-risco border-b border-line">
                                                  <tr>
                                                      <th class="py-2 px-4 text-center">Item</th>
                                                      <th class="py-2 px-4">Produto</th>
                                                      <th class="py-2 px-4 text-center">CFOP</th>
                                                      <th class="py-2 px-4 text-center">CST</th>
                                                      <th class="py-2 px-4 text-right">Qtd</th>
                                                      <th class="py-2 px-4 text-right border-l border-line">Total Produto</th>
                                                  </tr>
                                              </thead>
                                              <tbody class="divide-y divide-line">
                                                  <tr v-for="item in nf.itens_c170" :key="item.num_item" class="hover:bg-paper">
                                                      <td class="py-2 px-4 text-center text-[12px] font-mono text-risco">{{ item.num_item }}</td>
                                                      <td class="py-2 px-4 text-[12px] font-medium text-ink">
                                                          {{ item.descr_item || 'S/N' }} <span class="text-[9px] text-risco font-mono block">{{ item.cod_item }}</span>
                                                      </td>
                                                      <td class="py-2 px-4 text-center text-[12px] font-mono text-risco">{{ item.cfop }}</td>
                                                      <td class="py-2 px-4 text-center">
                                                          <span class="text-[10px] px-2 py-0.5 rounded font-mono bg-paper border border-line text-risco">{{ item.cst_icms }}</span>
                                                      </td>
                                                      <td class="py-2 px-4 text-right text-[12px] font-mono text-ink">{{ formatNumber(item.qtd) }} {{ item.unid }}</td>
                                                      <td class="py-2 px-4 text-right border-l border-line font-mono text-bronze text-[12px]">{{ formatCurrency(item.vl_item) }}</td>
                                                  </tr>
                                              </tbody>
                                          </table>
                                      </div>
                                      <p v-else class="text-[13px] text-risco italic">Esta nota não possui detalhes C170 vinculados neste arquivo.</p>

                                      <!-- ===== NFe COMPLETA — Cálculo do Imposto + todos os campos ===== -->
                                      <div v-if="nf.chv_nfe" class="mt-7">
                                          <div class="flex items-center flex-wrap gap-3 mb-4">
                                              <span class="text-[10px] uppercase font-medium tracking-wide text-conforme bg-conforme/10 px-3 py-1 rounded-md border border-conforme/20">NFe Completa — Cálculo do Imposto</span>
                                              <span v-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].fonte" class="text-[9px] font-medium px-2 py-0.5 rounded-full" :class="nfeCompletaCache[nf.id].fonte === 'sped' ? 'bg-variacao/15 text-variacao' : 'bg-conforme/15 text-conforme'">fonte: {{ FONTE_LABEL[nfeCompletaCache[nf.id].fonte] || nfeCompletaCache[nf.id].fonte }}</span>
                                              <span class="text-[9px] font-mono text-risco">{{ nf.chv_nfe }}</span>
                                          </div>

                                          <div v-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].loading" class="text-[13px] text-risco italic">Carregando NFe completa…</div>
                                          <div v-else-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].erro" class="text-[13px] text-lacre">Erro ao carregar a NFe: {{ nfeCompletaCache[nf.id].erro }}</div>

                                          <!-- sem XML disponível (nota só do SPED) -->
                                          <div v-else-if="nfeCompletaCache[nf.id] && !nfeCompletaCache[nf.id].nfe" class="bg-variacao/10 border border-variacao/20 rounded-md p-4 text-[12px] text-ink max-w-3xl">
                                              <b>XML desta NF-e não disponível</b> ({{ nfeCompletaCache[nf.id].motivo || 'nota proveniente apenas do SPED' }}). Campos exclusivos do XML — monofásico (qBCMonoRet/vICMSMonoRet), ICMS desonerado, FCP, DIFAL — não existem no SPED Fiscal. Reinjete o XML desta nota para ver o Cálculo do Imposto completo.
                                          </div>

                                          <!-- NFe completa carregada -->
                                          <template v-else-if="nfeCompletaCache[nf.id] && nfeCompletaCache[nf.id].nfe">
                                              <!-- destaques (leitura rápida) -->
                                              <div v-if="nfeCompletaCache[nf.id].nfe.destaques && nfeCompletaCache[nf.id].nfe.destaques.length" class="mb-4 max-w-4xl space-y-1">
                                                  <div v-for="(d, di) in nfeCompletaCache[nf.id].nfe.destaques" :key="di" class="text-[11px] text-risco flex gap-2"><span class="text-conforme font-medium">▸</span><span>{{ d }}</span></div>
                                              </div>

                                              <!-- ICMSTot em destaque -->
                                              <template v-for="g in nfeCompletaCache[nf.id].nfe.grupos" :key="g.grupo">
                                                  <div v-if="g.grupo.includes('ICMSTot')" class="bg-sheet border border-conforme/30 rounded-md p-4 mb-4 max-w-5xl">
                                                      <h4 class="text-[11px] font-medium uppercase tracking-wide text-conforme mb-3">💰 {{ g.grupo }}</h4>
                                                      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
                                                          <div v-for="(c, ci) in g.campos" :key="ci" class="flex flex-col border-b border-line py-1">
                                                              <span class="text-[9px] uppercase tracking-wide text-risco">{{ c.label_pt }} <span class="font-mono normal-case text-risco/70">{{ c.tag }}</span></span>
                                                              <span class="text-[13px] font-mono" :class="c.obs && c.obs.indexOf('Monofásico') >= 0 ? 'text-bronze' : 'text-ink'">{{ fmtValorNfe(c.valor) }}</span>
                                                              <span v-if="c.obs" class="text-[9px] text-bronze">{{ c.obs }}</span>
                                                          </div>
                                                      </div>
                                                  </div>
                                              </template>

                                              <!-- demais grupos (recolhíveis) -->
                                              <div class="max-w-5xl space-y-2">
                                                  <template v-for="g in nfeCompletaCache[nf.id].nfe.grupos" :key="'sec-' + g.grupo">
                                                      <div v-if="!g.grupo.includes('ICMSTot')" class="bg-sheet border border-line rounded-md overflow-hidden">
                                                          <button @click="toggleGrupoNfe(nf.id, g.grupo)" class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-paper transition-colors text-left">
                                                              <span class="text-[11px] font-medium text-ink">{{ g.grupo }} <span class="text-risco font-normal">({{ g.campos.length }})</span></span>
                                                              <span class="text-risco text-[12px]">{{ grupoNfeAberto(nf.id, g.grupo) ? '▼' : '▶' }}</span>
                                                          </button>
                                                          <div v-if="grupoNfeAberto(nf.id, g.grupo)" class="px-4 pb-3 pt-1 border-t border-line">
                                                              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                                                                  <template v-for="(c, ci) in g.campos" :key="ci">
                                                                      <div v-if="c._header" class="md:col-span-2 lg:col-span-3 mt-2 mb-0.5 text-[10px] font-medium uppercase tracking-wide text-risco border-b border-line pb-0.5">{{ c.label_pt }}</div>
                                                                      <div v-else class="flex items-baseline justify-between gap-2 border-b border-line py-0.5">
                                                                          <span class="text-[10px] text-risco truncate" :title="c.tag">{{ c.label_pt }}</span>
                                                                          <span class="text-[11px] font-mono text-right whitespace-nowrap" :class="c.obs && c.obs.indexOf('Monofásico') >= 0 ? 'text-bronze' : 'text-ink'">{{ fmtValorNfe(c.valor) }}</span>
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
      <div class="bg-sheet rounded-md overflow-hidden card-shadow border border-line">
        <!-- Header + Sub-abas -->
        <div class="p-6 border-b border-line bg-paper flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h3 class="font-display text-[16px] font-semibold text-ink">Notas Fiscais de Saída</h3>
            <p class="text-[12px] text-risco">Conciliação C100 (Capa), C190 (Resumo) e C170 (Detalhes)</p>
            <p class="text-[13px] font-mono text-conforme mt-1">Total Saídas: {{ formatCurrency(totalSaidaNotas) }}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex gap-1 p-1 bg-paper border border-line rounded-md">
              <button @click="activeSaidasSubTab = '65'" :class="activeSaidasSubTab === '65' ? 'bg-bronze text-white' : 'text-risco'" class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all">🛒 Resumo p/ CFOP (Consumidor)</button>
              <button @click="activeSaidasSubTab = '55'" :class="activeSaidasSubTab === '55' ? 'bg-bronze text-white' : 'text-risco'" class="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all">📄 NF-e (Modelo 55)</button>
            </div>
            <input v-if="activeSaidasSubTab === '55'" v-model="buscaSaidas" type="text" placeholder="Buscar NF ou Cliente..." class="px-4 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink focus:outline-none focus:border-bronze w-56" />
          </div>
        </div>

        <!-- SUB-ABA: MODELO 65 (NFC-e) — Agrupado por CFOP -->
        <div v-if="activeSaidasSubTab === '65'">
          <div v-if="loadingSaidas65" class="py-20 flex flex-col items-center justify-center text-risco">
            <div class="animate-spin text-3xl mb-4 border-4 border-conforme/20 border-t-conforme rounded-full w-8 h-8"></div>
            <p class="font-medium text-[13px] tracking-wide uppercase">Carregando NFC-es...</p>
          </div>
          <div v-else-if="saidasMod65.length === 0" class="py-20 text-center text-risco">
            <p class="text-[16px] font-medium">Resumo por CFOP Vazio</p>
            <p class="text-[13px] mt-1">Não há registros de Saída agrupados (Mod 65 ou 55/5929) neste arquivo.</p>
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-paper border-b border-line text-[10px] font-medium uppercase text-risco tracking-wide">
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
              <tbody class="divide-y divide-line">
                <template v-for="grupo in saidasMod65" :key="grupo.cfop + '-' + grupo.cst_icms">
                  <!-- Linha Master: CFOP -->
                  <tr @click="toggleCfop(grupo.cfop + grupo.cst_icms)" class="hover:bg-paper cursor-pointer transition-colors">
                    <td class="py-4 px-6 text-risco font-medium text-lg">{{ expandedCfops.has(grupo.cfop + grupo.cst_icms) ? '▼' : '▶' }}</td>
                    <td class="py-4 px-6">
                      <span class="text-[13px] font-mono bg-conforme/10 text-conforme px-3 py-1 rounded-md border border-conforme/20">{{ grupo.cfop }}</span>
                    </td>
                    <td class="py-4 px-6">
                      <span class="text-[10px] px-2 py-0.5 rounded font-mono bg-paper border border-line text-risco">{{ grupo.cst_icms }}</span>
                    </td>
                    <td class="py-4 px-6 text-right font-mono text-ink">{{ grupo.total_notas }}</td>
                    <td class="py-4 px-6 text-right font-mono text-ink">{{ formatCurrency(grupo.total_vl_opr) }}</td>
                    <td class="py-4 px-6 text-right font-mono text-risco">{{ formatCurrency(grupo.total_vl_bc_icms) }}</td>
                    <td class="py-4 px-6 text-right font-mono text-bronze">{{ formatCurrency(grupo.total_vl_icms) }}</td>
                  </tr>
                  <!-- Detalhe: NFs dentro do CFOP -->
                  <tr v-if="expandedCfops.has(grupo.cfop + grupo.cst_icms)">
                    <td colspan="7" class="p-0 bg-paper border-b border-line">
                      <div class="px-16 py-4">
                        <p class="text-[10px] uppercase font-medium tracking-wide text-conforme mb-3">{{ grupo.notas?.length || 0 }} Notas neste CFOP</p>
                        <div class="bg-sheet border border-line rounded-md overflow-hidden">
                          <table class="w-full text-[13px]">
                            <thead class="bg-paper text-[9px] uppercase text-risco tracking-wide">
                              <tr>
                                <th class="py-2 px-4 text-left">Nº NF</th>
                                <th class="py-2 px-4 text-left">Data Emissão</th>
                                <th class="py-2 px-4 text-left">Cliente</th>
                                <th class="py-2 px-4 text-right">Valor</th>
                                <th class="py-2 px-4 text-center">Ações</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                              <tr v-for="nf in grupo.notas" :key="nf.id" class="hover:bg-paper">
                                <td class="py-2 px-4 font-mono text-ink">#{{ nf.num_doc }}</td>
                                <td class="py-2 px-4 font-mono text-risco">{{ nf.dt_doc ? new Date(nf.dt_doc).toLocaleDateString('pt-BR', {timeZone:'UTC'}) : 'S/ Data' }}</td>
                                <td class="py-2 px-4 text-ink truncate max-w-[200px]">{{ nf.nome_cliente || 'Consumidor Final' }}</td>
                                <td class="py-2 px-4 text-right font-mono" :class="nf.vl_doc_ajustado !== null ? 'text-variacao' : 'text-conforme'">
                                    {{ formatCurrency(nf.vl_doc_ajustado !== null ? nf.vl_doc_ajustado : nf.vl_doc) }}
                                    <span v-if="nf.vl_doc_ajustado !== null" class="block text-[8px] text-risco line-through font-normal">{{ formatCurrency(nf.vl_doc) }}</span>
                                </td>
                                <td class="py-2 px-4 text-center">
                                    <button @click.stop="openNfEdit(nf)" class="p-1.5 hover:bg-paper rounded-md text-conforme transition-colors" title="Editar Valor">
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
          <div v-if="loadingSaidas55" class="py-20 flex flex-col items-center justify-center text-risco">
            <div class="animate-spin text-3xl mb-4 border-4 border-bronze/20 border-t-bronze rounded-full w-8 h-8"></div>
            <p class="font-medium text-[13px] tracking-wide uppercase">Carregando NF-es de Saída...</p>
          </div>
          <div v-else-if="filteredSaidas55.length === 0" class="py-20 text-center text-risco">
            <p class="text-[16px] font-medium">Nenhuma NF-e de Saída Encontrada</p>
          </div>
          <div v-else class="overflow-x-auto">
            <table class="w-full text-left">
                  <thead class="bg-paper border-b border-line text-[10px] font-medium uppercase text-risco tracking-wide">
                    <tr>
                      <th class="py-4 px-6 w-10"></th>
                      <th class="py-4 px-6">Nº NF</th>
                      <th class="py-4 px-6">Emissão</th>
                      <th class="py-4 px-6">Cliente</th>
                      <th class="py-4 px-6 text-right">Valor (NF)</th>
                      <th class="py-4 px-6 text-center border-l border-line bg-paper">Totais C190</th>
                      <th class="py-4 px-6 text-center">Ações</th>
                    </tr>
                  </thead>
              <tbody class="divide-y divide-line">
                <template v-for="nf in filteredSaidas55" :key="nf.id">
                  <tr @click="toggleSaida55(nf.id)" class="hover:bg-paper cursor-pointer transition-colors">
                    <td class="py-4 px-6 text-risco font-medium text-lg">{{ expandedSaidas55.has(nf.id) ? '▼' : '▶' }}</td>
                    <td class="py-4 px-6 font-mono text-ink">#{{ nf.num_doc }}</td>
                    <td class="py-4 px-6 font-mono">{{ nf.dt_doc ? new Date(nf.dt_doc).toLocaleDateString('pt-BR', {timeZone:'UTC'}) : 'S/ Data' }}</td>
                    <td class="py-4 px-6 truncate max-w-[180px]" :title="nf.nome_cliente">{{ nf.nome_cliente }}</td>
                    <td class="py-4 px-6 text-right font-mono" :class="nf.vl_doc_ajustado !== null ? 'text-variacao' : 'text-ink'">
                        {{ formatCurrency(nf.vl_doc) }}
                        <span v-if="nf.vl_doc_ajustado !== null" class="block text-[8px] text-risco line-through font-normal">{{ formatCurrency(nf.vl_doc_original) }}</span>
                    </td>
                    <td class="py-3 px-6 text-right border-l border-line bg-paper">
                      <div v-if="nf.consolidacao_c190 && nf.consolidacao_c190.length" class="flex flex-col gap-1 items-end">
                        <div v-for="c in nf.consolidacao_c190" :key="c.cfop" class="flex items-center gap-2 text-[12px]">
                          <span class="bg-bronze text-white px-2 py-0.5 rounded text-[10px] font-mono">{{ c.cfop }}</span>
                          <span class="text-risco">Opr: {{ formatCurrency(c.vl_opr) }}</span>
                          <span class="text-bronze font-mono">| ICMS: {{ formatCurrency(c.vl_icms) }}</span>
                        </div>
                      </div>
                      <span v-else class="text-risco text-[12px]">Sem C190</span>
                    </td>
                    <td class="py-2 px-4 text-center">
                        <button @click.stop="openNfEdit({...nf, id_c190: nf.consolidacao_c190[0]?.id})" class="p-1.5 hover:bg-paper rounded-md text-risco hover:text-bronze transition-colors" title="Editar Valor">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                        </button>
                    </td>
                  </tr>
                  <!-- Detalhe C170 -->
                  <tr v-if="expandedSaidas55.has(nf.id)">
                    <td colspan="6" class="p-0 bg-paper border-b-2 border-line">
                      <div class="px-14 py-6">
                        <span class="text-[10px] uppercase font-medium tracking-wide text-risco bg-sheet px-3 py-1 rounded-md border border-line">Itens da Nota (C170)</span>
                        <span class="text-[12px] font-medium text-risco ml-2">{{ nf.itens_c170?.length || 0 }} produto(s)</span>
                        <div v-if="nf.itens_c170 && nf.itens_c170.length > 0" class="mt-4 bg-sheet border border-line rounded-md overflow-hidden">
                          <table class="w-full">
                            <thead class="bg-paper text-[9px] uppercase tracking-wide text-risco border-b border-line">
                              <tr>
                                <th class="py-2 px-4 text-center">Item</th>
                                <th class="py-2 px-4">Produto</th>
                                <th class="py-2 px-4 text-center">CFOP</th>
                                <th class="py-2 px-4 text-center">CST</th>
                                <th class="py-2 px-4 text-right">Qtd</th>
                                <th class="py-2 px-4 text-right border-l border-line">Total</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                              <tr v-for="item in nf.itens_c170" :key="item.num_item" class="hover:bg-paper">
                                <td class="py-2 px-4 text-center text-[12px] font-mono text-risco">{{ item.num_item }}</td>
                                <td class="py-2 px-4 text-[12px] font-medium text-ink">{{ item.descr_item || 'S/N' }} <span class="text-[9px] text-risco font-mono block">{{ item.cod_item }}</span></td>
                                <td class="py-2 px-4 text-center text-[12px] font-mono text-risco">{{ item.cfop }}</td>
                                <td class="py-2 px-4 text-center"><span class="text-[10px] px-2 py-0.5 rounded font-mono bg-paper border border-line text-risco">{{ item.cst_icms }}</span></td>
                                <td class="py-2 px-4 text-right text-[12px] font-mono text-ink">{{ formatNumber(item.qtd) }} {{ item.unid }}</td>
                                <td class="py-2 px-4 text-right border-l border-line font-mono text-bronze text-[12px]">{{ formatCurrency(item.vl_item) }}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <p v-else class="text-[13px] text-risco italic mt-3">Esta nota não possui detalhes C170 neste arquivo.</p>
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
      <div class="bg-sheet rounded-md p-8 border-2 border-dashed border-line hover:border-bronze/50 transition-all group text-center space-y-5 max-w-lg w-full card-shadow">
        <div class="w-14 h-14 bg-paper rounded-md flex items-center justify-center mx-auto text-2xl group-hover:scale-110 transition-transform">
          {{ isUploading ? '⚙️' : '📥' }}
        </div>
        <div class="space-y-1.5">
          <h3 class="font-display text-[18px] font-semibold text-ink tracking-[-0.01em]">
            {{ isUploading ? 'Processando Auditoria' : 'Seleção de Arquivo SPED' }}
          </h3>
          <p class="text-risco text-[13px]">
            {{ isUploading ? 'Por favor, não feche a página.' : 'Clique para selecionar o arquivo .txt do SPED' }}
          </p>
        </div>

        <div v-if="!isUploading">
          <label class="inline-block px-8 py-3 bg-bronze hover:opacity-85 text-white rounded-md font-medium cursor-pointer transition-all active:scale-95 text-[13px] uppercase tracking-wide">
            Escolher Arquivo
            <input type="file" @change="handleSpedFile" class="hidden" accept=".txt" />
          </label>
        </div>

        <!-- BARRA DE PROGRESSO DINÂMICA (UI REFINADA) -->
        <div v-else class="w-full max-w-md mx-auto space-y-4">
          <div class="flex justify-between items-center text-[11px] font-medium text-risco uppercase tracking-wide px-1">
             <span class="flex items-center gap-2">
                <Loader2 v-if="uploadProgress === 100" class="w-3 h-3 animate-spin text-bronze" />
                {{ uploadProgress < 100 ? 'Transmitindo Arquivo' : 'Salvando no Banco' }}
             </span>
             <span class="text-bronze text-[13px] font-mono">{{ uploadProgress }}%</span>
          </div>
          <div class="h-4 w-full bg-paper rounded-full overflow-hidden border border-line p-1">
             <div
               class="h-full bg-bronze rounded-full transition-all duration-500 ease-out"
               :style="{ width: `${uploadProgress}%` }"
             ></div>
          </div>
          <p class="text-[11px] text-risco font-medium uppercase tracking-wide">{{ uploadMessage }}</p>
        </div>

        <div v-if="!isUploading && status" class="pt-4 border-t border-line">
           <p class="text-[10px] text-risco uppercase font-medium tracking-wide leading-relaxed">{{ status }}</p>
        </div>

        <!-- CONSOLE DO MOTOR (TERMINAL REAL-TIME) -->
        <div v-if="isUploading" class="w-full mt-6 animate-in slide-in-from-bottom-4 duration-700">
           <div class="bg-graphite rounded-md border border-line/10 overflow-hidden font-mono text-left">
              <div class="bg-graphite-2 px-4 py-2 flex items-center justify-between border-b border-white/[.06]">
                 <div class="flex gap-1.5">
                    <div class="w-2.5 h-2.5 rounded-full bg-lacre/50"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-variacao/50"></div>
                    <div class="w-2.5 h-2.5 rounded-full bg-conforme/50"></div>
                 </div>
                 <span class="text-[9px] font-medium text-muted uppercase tracking-wide">Motor de Auditoria - Live Stream</span>
              </div>
              <div
                ref="terminalContainer"
                class="p-4 h-48 overflow-y-auto space-y-1.5"
              >
                  <div v-for="(log, idx) in terminalLogs" :key="idx" class="text-[12px] flex gap-3">
                     <span v-if="log.time" class="text-muted shrink-0">[{{ log.time }}]</span>
                     <span :class="{
                        'text-conforme': log.type === 'log',
                        'text-bronze font-medium': log.type === 'sys',
                        'text-line': !log.type
                     }">{{ log.msg }}</span>
                  </div>
                  <div v-if="uploadProgress === 100" class="flex items-center gap-2 text-conforme/50 text-[10px] animate-pulse">
                     <span>>_</span>
                     <span class="h-3 w-1 bg-conforme"></span>
                  </div>
              </div>
           </div>
        </div>
      </div>
        </div>

        <!-- PAINEL LATERAL: últimos arquivos + linha do tempo -->
        <aside class="space-y-4">
          <div class="bg-sheet rounded-md border border-line card-shadow p-5">
            <h4 class="text-[11px] font-medium uppercase text-risco tracking-wide mb-3">Últimos arquivos</h4>
            <div v-if="loadingRecentes" class="text-[12px] text-risco py-4 text-center">Carregando…</div>
            <p v-else-if="!arquivosRecentes.length" class="text-[12px] text-risco italic py-4 text-center">Nenhum arquivo carregado para esta empresa ainda.</p>
            <ul v-else class="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              <li v-for="a in [...arquivosRecentes].reverse()" :key="a.id">
                <button @click="abrirArquivo(a.id)" class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-paper transition-colors" :class="String(a.id) === String(idArquivoSped) ? 'bg-bronze/5 ring-1 ring-bronze/20' : ''">
                  <span class="w-2 h-2 rounded-full shrink-0" :class="String(a.id) === String(idArquivoSped) ? 'bg-bronze' : 'bg-line'"></span>
                  <span class="text-[12px] font-mono text-ink w-14 shrink-0">{{ fmtMes(a.mes) }}</span>
                  <span class="text-[10px] text-risco font-mono truncate flex-1" :title="a.nome_arquivo">{{ a.nome_arquivo }}</span>
                  <span v-if="String(a.id) === String(idArquivoSped)" class="text-[8px] font-medium uppercase text-bronze bg-bronze/10 px-1.5 py-0.5 rounded shrink-0">ativo</span>
                </button>
              </li>
            </ul>
          </div>

          <div v-if="sequenciaTimeline.length" class="bg-sheet rounded-md border border-line card-shadow p-5">
            <h4 class="text-[11px] font-medium uppercase text-risco tracking-wide mb-3">Linha do tempo</h4>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="t in sequenciaTimeline" :key="t.mes" @click="t.id && abrirArquivo(t.id)"
                :class="t.carregado ? (t.ativo ? 'bg-bronze text-white' : 'bg-conforme/10 text-conforme hover:bg-conforme/20') : 'bg-lacre/5 text-lacre border border-dashed border-lacre/30 cursor-default'"
                class="px-2 py-1 rounded-md text-[10px] font-mono transition-colors">
                {{ fmtMes(t.mes) }}<span v-if="!t.carregado"> ⚠</span>
              </button>
            </div>
            <p class="text-[9px] text-risco mt-3 leading-relaxed">🟢 carregado · 🟣 ativo · 🔴 mês faltante (quebra de sequência)</p>
          </div>
        </aside>
      </div>
    </div>

    <!-- Conteúdo: Dashboard Analítico -->
    <div v-if="activeTab === 'dashboard'" class="space-y-6 animate-fade-in">

      <!-- FAIXA DE SAÚDE DO ARQUIVO -->
      <div class="bg-sheet rounded-md border border-line card-shadow p-4 flex flex-wrap items-center gap-4 justify-between">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-medium uppercase text-risco tracking-wide">Saúde do arquivo</span>
          <span v-if="arquivoInfo" class="text-[11px] font-mono text-ink bg-paper px-2 py-0.5 rounded">{{ arquivoInfo.periodo }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-5">
          <div class="text-right">
            <p class="text-[9px] uppercase font-medium text-risco tracking-wide">Entradas</p>
            <p class="text-[13px] font-mono text-ink">{{ formatCurrency(totalEntradaNotas) }}</p>
          </div>
          <div class="text-right">
            <p class="text-[9px] uppercase font-medium text-risco tracking-wide">Saídas</p>
            <p class="text-[13px] font-mono text-conforme">{{ formatCurrency(totalSaidaNotas) }}</p>
          </div>
          <div class="text-right">
            <p class="text-[9px] uppercase font-medium text-risco tracking-wide">Variação ANP</p>
            <p class="text-[13px] font-medium" :class="statusAnpGeral === 'CRITICAL' ? 'text-lacre' : statusAnpGeral === 'WARNING' ? 'text-variacao' : 'text-conforme'">
              {{ statusAnpGeral === 'CRITICAL' ? '🔴 Crítico' : statusAnpGeral === 'WARNING' ? '⚠ Atenção' : statusAnpGeral === 'OK' ? '✓ OK' : '—' }}
            </p>
          </div>
          <div class="text-right">
            <p class="text-[9px] uppercase font-medium text-risco tracking-wide">Erros</p>
            <p class="text-[13px] font-mono" :class="auditErros.length ? 'text-lacre' : 'text-conforme'">{{ auditErros.length }}</p>
          </div>
        </div>
      </div>

      <!-- Linha Macro: Faturamento e Compras (Ultra-Compact) -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-sheet p-4 rounded-md border border-line card-shadow flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-medium uppercase text-risco tracking-wide">Faturamento</span>
                  <span class="text-xl font-mono text-ink">{{ formatCurrency(auditResumoGerencial?.total_saidas) }}</span>
              </div>
              <div class="w-8 h-8 rounded-md bg-conforme/10 flex items-center justify-center text-conforme scale-90 group-hover:scale-105 transition-transform">📈</div>
          </div>
          <div class="bg-sheet p-4 rounded-md border border-line card-shadow flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-medium uppercase text-risco tracking-wide">Compras</span>
                  <span class="text-xl font-mono text-ink">{{ formatCurrency(auditResumoGerencial?.total_entradas) }}</span>
              </div>
              <div class="w-8 h-8 rounded-md bg-bronze/10 flex items-center justify-center text-bronze scale-90 group-hover:scale-105 transition-transform">📦</div>
          </div>

          <!-- Total Litros: Compras e Vendas -->
          <div class="bg-sheet p-4 rounded-md border border-line card-shadow flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-medium uppercase text-risco tracking-wide">Total Compras (L)</span>
                  <span class="text-xl font-mono text-ink">{{ formatNumber(totalVolumeCompra) }} L</span>
              </div>
              <div class="w-8 h-8 rounded-md bg-bronze/10 flex items-center justify-center text-bronze scale-90 group-hover:scale-105 transition-transform">🚛</div>
          </div>

          <div class="bg-sheet p-4 rounded-md border border-line card-shadow flex items-center justify-between group">
              <div class="flex flex-col">
                  <span class="text-[9px] font-medium uppercase text-risco tracking-wide">Total Vendas (L)</span>
                  <span class="text-xl font-mono text-ink">{{ formatNumber(totalVolumeVenda) }} L</span>
              </div>
              <div class="w-8 h-8 rounded-md bg-bronze/10 flex items-center justify-center text-bronze scale-90 group-hover:scale-105 transition-transform">⛽</div>
          </div>

          <!-- Cards Dinâmicos de Combustíveis (Compactos) -->
          <template v-for="comb in auditResumoGerencial?.resumoCombustiveis" :key="comb.tipo">
              <div class="bg-graphite p-4 rounded-md border border-line/10 flex flex-col justify-between group relative overflow-hidden">
                  <div class="flex justify-between items-start z-10">
                      <div class="flex flex-col">
                          <span class="text-[8px] font-medium uppercase text-muted tracking-wide">{{ comb.tipo }}</span>
                          <span class="text-base font-mono text-white leading-tight">{{ formatNumber(comb.total_litros) }} L</span>
                      </div>
                      <span class="text-lg opacity-30 group-hover:scale-110 transition-transform">⛽</span>
                  </div>
                  <div class="mt-2 pt-2 border-t border-white/[.06] flex justify-between items-end z-10">
                      <div class="flex flex-col">
                          <span class="text-[8px] font-medium text-conforme uppercase">Custo</span>
                          <span class="text-[12px] font-mono text-white">{{ formatCurrency(comb.custo_medio) }}/L</span>
                      </div>
                      <div class="text-[8px] text-muted text-right">
                         Inv: {{ formatCurrency(comb.total_valor) }}
                      </div>
                  </div>
              </div>
          </template>
      </div>

      <!-- Área Técnica: Ranking de CFOP e Prevenção -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Ranking de CFOP (Compacto) -->
          <div class="lg:col-span-8 bg-graphite p-5 rounded-md text-white relative overflow-hidden">
             <div v-if="auditResumoGerencial?.saidasPorCFOP?.length" class="z-10 relative space-y-4">
                 <div class="flex justify-between items-center">
                    <p class="text-muted text-[9px] font-medium uppercase tracking-wide">Ranking de Faturamento por CFOP</p>
                    <span class="text-[8px] px-2 py-0.5 bg-white/10 rounded-full text-muted uppercase tracking-[-0.01em]">Top 5 Operações</span>
                 </div>
                 <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                     <div v-for="cf in auditResumoGerencial.saidasPorCFOP.slice(0, 4)" :key="cf.cfop" class="flex justify-between items-center bg-white/5 p-3 rounded-md border border-white/5 hover:bg-white/10 transition-colors">
                         <div class="flex items-center gap-3">
                            <div class="w-7 h-7 rounded-md bg-conforme/20 flex items-center justify-center text-[10px] font-mono text-conforme">#{{ cf.cfop }}</div>
                            <div class="flex flex-col">
                                <span class="text-[10px] font-medium leading-tight">Consumo/Saída</span>
                                <span class="text-[8px] text-muted uppercase">Escrituração Fiscal</span>
                            </div>
                         </div>
                         <span class="font-mono text-[12px] text-conforme">{{ formatCurrency(cf.total_operacao) }}</span>
                     </div>
                 </div>
             </div>
             <div class="absolute -right-6 -bottom-6 text-7xl opacity-5 rotate-12">📊</div>
          </div>

          <!-- Card de Economia (Slim) -->
          <div class="lg:col-span-4 bg-bronze p-5 rounded-md text-white relative overflow-hidden group flex flex-col justify-between">
              <div class="z-10">
                  <p class="text-white/70 text-[9px] font-medium uppercase tracking-wide">Prevenção Financeira</p>
                  <h4 class="text-2xl font-mono mt-1 leading-tight">{{ formatCurrency(economiaEstimada) }}</h4>
                  <p class="text-white/80 text-[10px] mt-1 leading-relaxed">Economia estimada em ICMS-ST em duplicidade.</p>
              </div>
              <button class="z-10 mt-4 px-4 py-2 bg-white text-bronze rounded-md text-[9px] font-medium hover:opacity-90 transition-all w-full">DETALHAR CRÉDITOS</button>
              <div class="absolute -right-4 -bottom-4 text-7xl opacity-10 rotate-12 group-hover:scale-110 transition-transform">💰</div>
          </div>
      </div>
    </div>

    <!-- Conteúdo: Lista de Erros -->
    <div v-if="activeTab === 'erros'" class="space-y-6">
       <!-- ── CABEÇALHO + SISTEMA AFERIÇÃO ────────────────────────────────── -->
       <div class="space-y-4">
         <!-- Cabeçalho de tela -->
         <div class="flex items-baseline gap-3">
           <h2 class="font-display text-[22px] font-semibold text-ink leading-none tracking-tight">
             Auditoria SPED
           </h2>
           <span v-if="arquivoInfo?.periodo" class="font-mono text-[13px] text-risco">
             {{ arquivoInfo.periodo }}
           </span>
           <span v-if="empresaSelecionada?.nome_empresa" class="text-[13px] text-risco truncate max-w-[260px]">
             · {{ empresaSelecionada.nome_empresa }}
           </span>
         </div>

         <!-- MetricRuler: contadores reais de alertas -->
         <MetricRuler :metrics="afericaoMetrics" />

         <!-- TotalizerGauge: variação de estoque (só quando há dado real) -->
         <TotalizerGauge
           v-if="afericaoGauge"
           :label="afericaoGauge.label"
           :value="afericaoGauge.value"
           :min="afericaoGauge.min"
           :max="afericaoGauge.max"
           :limit="afericaoGauge.limit"
           :current="afericaoGauge.current"
         />

         <!-- BlockCoverage: blocos SPED com ocorrências (só quando há erros) -->
         <BlockCoverage v-if="afericaoBlocks.length > 0" :blocks="afericaoBlocks" />
       </div>
       <!-- ── FIM AFERIÇÃO ──────────────────────────────────────────────────── -->

       <!-- OccurrenceTable: substitui a apresentação principal dos erros -->
       <OccurrenceTable v-if="afericaoRows.length > 0" :rows="afericaoRows">
         <template #header-action>
           <!-- Filtros de sub-aba preservados via botões existentes abaixo -->
         </template>
         <template #footer>
           <span class="text-[11px] text-risco">
             {{ afericaoRows.length }} ocorrência(s) ·
             {{ errosPorTipo.criticos }} crítico(s) ·
             {{ errosPorTipo.avisos }} aviso(s)
           </span>
         </template>
       </OccurrenceTable>

       <!-- Navegação de Sub-abas de Erros -->
       <div v-if="auditErros.length > 0" class="flex flex-wrap gap-2 pb-2 border-b border-line max-w-4xl mx-auto">
          <button
            @click="activeErrorSubTab = 'TODOS'"
            :class="activeErrorSubTab === 'TODOS' ? 'bg-graphite text-white' : 'bg-sheet text-risco hover:bg-paper border-line'"
            class="px-4 py-2 rounded-md text-[10px] font-medium uppercase tracking-wide border transition-all flex items-center gap-2"
          >
            📋 TODOS <span class="bg-white/20 px-1.5 py-0.5 rounded text-[8px]">{{ auditErros.length }}</span>
          </button>

          <button
            v-for="group in availableErrorGroups"
            :key="group.name"
            @click="activeErrorSubTab = group.name"
            :class="activeErrorSubTab === group.name ? 'bg-bronze text-white border-bronze' : 'bg-sheet text-risco hover:bg-paper border-line'"
            class="px-4 py-2 rounded-md text-[10px] font-medium uppercase tracking-wide border transition-all flex items-center gap-2"
          >
            📦 REG. {{ group.name }} <span class="bg-white/20 px-1.5 py-0.5 rounded text-[8px]">{{ group.count }}</span>
          </button>
       </div>

       <div v-if="auditErros.length === 0" class="text-center py-20 bg-sheet rounded-md border border-line space-y-4 card-shadow">
          <div class="text-5xl">🎉</div>
          <h3 class="font-display text-[22px] font-semibold text-ink">Nenhum erro encontrado!</h3>
          <p class="text-risco">Seu arquivo SPED está 100% em conformidade com as regras atuais.</p>
       </div>

       <div v-else class="max-w-4xl mx-auto space-y-4">
          <div v-for="erro in filteredAuditErros" :key="erro.id"
            class="bg-sheet rounded-md overflow-hidden border-l-4 card-shadow group"
            :class="erro.tipo_erro === 'CRITICAL' ? 'border-lacre' : 'border-variacao'">

            <div class="p-6">
               <div class="flex justify-between items-start mb-2">
                  <span class="text-[9px] font-medium uppercase tracking-wide px-2 py-1 rounded font-mono" :class="erro.tipo_erro === 'CRITICAL' ? 'bg-lacre/10 text-lacre' : 'bg-variacao/10 text-variacao'">
                     {{ erro.regra_id }} • {{ erro.tipo_erro }}
                  </span>
                  <p class="text-[10px] text-risco font-mono">{{ erro.cod_item_erro || 'Geral' }}</p>
               </div>
               <h4 class="font-display text-[16px] font-semibold text-ink group-hover:text-bronze transition-colors">{{ erro.titulo_erro }}</h4>
               <p class="text-risco text-[13px] mt-2 leading-relaxed">{{ erro.descricao_erro }}</p>

               <div class="mt-4 bg-graphite rounded-md p-4 text-[12px] font-mono text-conforme relative overflow-hidden border border-line/10">
                  <div class="absolute left-0 top-0 h-full w-1 bg-conforme/50"></div>
                  <pre class="whitespace-pre-wrap">{{ erro.conteudo_linha }}</pre>
               </div>

               <div class="mt-4 flex items-center justify-between">
                  <div class="text-[12px] bg-paper text-risco px-3 py-1.5 rounded-md border border-line">
                     💡 <strong class="text-ink">Sugestão:</strong> {{ erro.sugestao_correcao }}
                  </div>
                  <div class="flex gap-2">
                    <button v-if="erro.regra_id === 'RTAX-C170-01'"
                      @click="applyBulkCorrection(erro.regra_id)"
                      class="px-4 py-1.5 bg-conforme/10 text-conforme text-[10px] font-medium rounded-md hover:bg-conforme/20 transition-colors">
                      CORRIGIR TODOS
                    </button>
                    <button v-if="erro.regra_id === 'RTAX-C170-01'"
                      @click="openCorrection(erro)"
                      class="px-4 py-1.5 bg-bronze text-white text-[10px] font-medium rounded-md hover:opacity-90 transition-colors">
                      EXECUTAR CURA
                    </button>
                  </div>
               </div>
            </div>
          </div>
       </div>
    </div>

    <!-- Modal de Cura Simplificado -->
    <div v-if="showCorrectionModal" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
       <div class="bg-sheet rounded-md border border-line p-8 max-w-md w-full card-shadow space-y-6">
          <h3 class="font-display text-[18px] font-semibold flex items-center gap-2 text-bronze">
            🔮 Máquina de Cura: Retificação
          </h3>
          <p class="text-[13px] text-risco">Insira o novo código de **CST ICMS** para retificar este item no SPED automaticamente.</p>

          <div class="space-y-2">
             <label class="text-[10px] font-medium uppercase text-risco tracking-wide">Novo CST Sugerido (Ex: 060)</label>
             <input v-model="correctedValue" type="text" class="w-full p-4 bg-sheet border border-line rounded-md font-mono text-[16px] text-ink focus:border-bronze outline-none transition-all" placeholder="060" />
          </div>

          <div class="flex gap-3">
             <button @click="showCorrectionModal = false" class="flex-1 py-3 text-risco font-medium hover:bg-paper rounded-md transition-colors">CANCELAR</button>
             <button @click="applyCorrection" class="flex-1 py-3 bg-bronze text-white font-medium rounded-md hover:opacity-90 transition-all">APLICAR CURA</button>
          </div>
       </div>
    </div>

    <!-- Modal de Ajuste de NF (5.929 / 65) -->
    <div v-if="showNfEditModal" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
        <div class="bg-sheet rounded-md border border-line p-8 max-w-lg w-full card-shadow space-y-6">
            <div class="flex justify-between items-start">
                <div>
                   <h3 class="font-display text-[18px] font-semibold text-ink">Ajustar Valor NF #{{ nfToEdit?.num_doc }}</h3>
                   <p class="text-[12px] text-risco font-mono">Chave: {{ nfToEdit?.chv_nfe || 'N/A' }}</p>
                </div>
                <button @click="showNfEditModal = false" class="text-risco hover:text-ink">✕</button>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1.5">
                    <label class="text-[10px] font-medium uppercase text-risco tracking-wide">Total da Nota (C100)</label>
                    <input v-model.number="nfEditForm.vl_doc" type="number" step="0.01" class="w-full p-3 bg-sheet border border-line rounded-md font-mono text-[13px] text-ink focus:border-bronze outline-none" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-[10px] font-medium uppercase text-risco tracking-wide">Valor Operação (C190)</label>
                    <input v-model.number="nfEditForm.vl_opr" type="number" step="0.01" class="w-full p-3 bg-sheet border border-line rounded-md font-mono text-[13px] text-ink focus:border-bronze outline-none" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-[10px] font-medium uppercase text-risco tracking-wide">BC ICMS (C190)</label>
                    <input v-model.number="nfEditForm.vl_bc_icms" type="number" step="0.01" class="w-full p-3 bg-sheet border border-line rounded-md font-mono text-[13px] text-ink focus:border-bronze outline-none" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-[10px] font-medium uppercase text-risco tracking-wide">Valor ICMS (C190)</label>
                    <input v-model.number="nfEditForm.vl_icms" type="number" step="0.01" class="w-full p-3 bg-sheet border border-line rounded-md font-mono text-[13px] text-ink focus:border-bronze outline-none" />
                </div>
            </div>

            <div class="flex gap-3 pt-2">
                <button @click="showNfEditModal = false" class="flex-1 py-3 text-risco font-medium hover:bg-paper rounded-md transition-colors">CANCELAR</button>
                <button @click="saveNfEdit" class="flex-1 py-3 bg-conforme text-white font-medium rounded-md hover:opacity-90 transition-all">SALVAR AJUSTES</button>
            </div>
        </div>
    </div>

    <!-- Modal de LMC Incompleto: dias do período sem Registro 1300 -->
    <div v-if="showLmcLacunaModal && avisosLmcUpload" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-[80] p-4">
        <div class="bg-sheet rounded-md border border-line p-8 max-w-2xl w-full card-shadow space-y-5 max-h-[85vh] overflow-y-auto">
            <div class="flex justify-between items-start gap-4">
                <div class="flex items-start gap-3">
                    <div class="text-2xl">⚠️</div>
                    <div>
                        <h3 class="font-display text-[18px] font-semibold text-variacao">LMC Incompleto Detectado</h3>
                        <p class="text-[12px] text-risco mt-1">
                            Período <span class="font-mono text-ink">{{ avisosLmcUpload.periodo }}</span> ·
                            {{ avisosLmcUpload.total_dias_periodo }} dias esperados
                        </p>
                    </div>
                </div>
                <button @click="showLmcLacunaModal = false" class="w-9 h-9 bg-paper hover:bg-line/50 rounded-full flex items-center justify-center text-risco">✕</button>
            </div>

            <div class="bg-variacao/10 border border-variacao/20 rounded-md p-4 text-[12px] text-ink leading-relaxed">
                O arquivo SPED foi importado, mas o <b>Registro 1300 (LMC)</b> não cobre todos os dias do período.
                Isso costuma indicar que o LMC parou de ser lançado antes do fim do mês.
                Verifique na tabela abaixo quais combustíveis estão com dias faltantes — corrija no SPED de origem
                e reimporte para evitar erros de continuidade na auditoria.
            </div>

            <div class="space-y-2">
                <div v-for="prod in avisosLmcUpload.produtos.filter(p => p.dias_faltantes.length > 0)" :key="prod.cod_item"
                     class="border border-line rounded-md p-4 space-y-2">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <div class="text-[13px] font-medium text-ink">{{ prod.descr_item }}</div>
                            <div class="text-[10px] font-mono text-risco">{{ prod.cod_item }}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-[12px] font-medium text-lacre">{{ prod.dias_faltantes.length }} dia(s) sem LMC</div>
                            <div class="text-[10px] text-risco">
                                Último lançamento: <span class="font-mono">{{ prod.ultimo_dia_com_lmc || '—' }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-1">
                        <span v-for="d in prod.dias_faltantes" :key="d"
                              class="text-[10px] font-mono bg-lacre/10 text-lacre px-2 py-0.5 rounded border border-lacre/20">
                            {{ d.split('-').reverse().join('/') }}
                        </span>
                    </div>
                </div>
            </div>

            <div class="flex gap-3 pt-2">
                <button @click="showLmcLacunaModal = false"
                        class="flex-1 py-4 bg-graphite text-white font-medium rounded-md hover:opacity-90 transition-all uppercase tracking-wide text-[12px]">
                    Entendi, continuar auditoria
                </button>
            </div>
        </div>
    </div>

    <!-- Modal: Período Fora de Sequência -->
    <div v-if="showSequenciaModal && sequenciaInfo" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-[80] p-4">
        <div class="bg-sheet rounded-md border border-line p-8 max-w-lg w-full card-shadow space-y-5">
            <div class="flex items-start gap-3">
                <div class="w-12 h-12 bg-variacao/15 rounded-md flex items-center justify-center text-2xl shrink-0">⚠️</div>
                <div>
                    <h3 class="font-display text-[16px] font-semibold text-variacao">Período Fora de Sequência</h3>
                    <p class="text-[12px] text-risco mt-1">{{ sequenciaInfo.empresa }}</p>
                </div>
            </div>

            <div class="bg-variacao/10 border border-variacao/20 rounded-md p-5 space-y-3">
                <div class="flex items-center justify-between text-[13px]">
                    <span class="text-risco">Último período carregado:</span>
                    <span class="font-mono text-ink">{{ sequenciaInfo.ultimoPeriodo }}</span>
                </div>
                <div class="flex items-center justify-between text-[13px]">
                    <span class="text-risco">Período esperado:</span>
                    <span class="font-mono text-conforme">{{ sequenciaInfo.esperado }}</span>
                </div>
                <div class="flex items-center justify-between text-[13px]">
                    <span class="text-risco">Período do arquivo:</span>
                    <span class="font-mono text-variacao">{{ sequenciaInfo.novoPeriodo }}</span>
                </div>
            </div>

            <p class="text-[12px] text-risco leading-relaxed">
                O arquivo que você está carregando não é o mês seguinte ao último período processado.
                Isso pode causar quebra de continuidade no LMC e divergências intermensais.
            </p>

            <div class="flex gap-3 pt-1">
                <button @click="cancelarUploadForaSequencia"
                        class="flex-1 py-3.5 bg-paper text-ink font-medium rounded-md hover:bg-line/50 transition-all text-[12px] uppercase tracking-wide">
                    Cancelar
                </button>
                <button @click="confirmarUploadForaSequencia"
                        class="flex-1 py-3.5 bg-variacao text-white font-medium rounded-md hover:opacity-90 transition-all text-[12px] uppercase tracking-wide">
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
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
</style>
