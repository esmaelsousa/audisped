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

// CFOPs do banco
const cfopsDisponiveis = ref([]);
async function loadCfops() {
    try {
        const res = await axios.get(`${API_BASE_URL}/api/cfops`, {
            headers: { Authorization: `Bearer ${token.value}` }
        });
        cfopsDisponiveis.value = res.data;
    } catch (e) {
        // fallback com os 4 padrão se a API falhar
        cfopsDisponiveis.value = [
            { codigo: '1102', descricao: 'Compra para Comercialização' },
            { codigo: '1556', descricao: 'Compra para Uso e Consumo' },
            { codigo: '1652', descricao: 'Compra de Combustível' },
            { codigo: '1551', descricao: 'Compra de Ativo Imobilizado' }
        ];
    }
}

// Filtros do Usuário
const cfopPadrao = ref('1102');
const forcarUsoConsumo = ref(true); 
const idSpedBase = ref('');
const ajusteIpi = ref(false);
const ajusteIcms = ref(false);
const pularDuplicados = ref(true);

// Modo Grupos
const modoGrupos = ref(false);
const grupos = ref([]);
let _grupoSeq = 0;

function criarGrupo() {
    return { id: ++_grupoSeq, xmlFiles: [], cfop: '1102', forcarUsoConsumo: true, ajusteIpi: false, ajusteIcms: false, pularDuplicados: true, forceReplace: false, status: null, logMsg: '' };
}

function toggleModoGrupos() {
    modoGrupos.value = !modoGrupos.value;
    if (modoGrupos.value && grupos.value.length === 0) grupos.value.push(criarGrupo());
}

function triggerGrupoInput(grupoId) {
    const el = document.getElementById(`xml-grupo-${grupoId}`);
    if (el) el.click();
}

function adicionarGrupo() {
    grupos.value.push(criarGrupo());
}

function removerGrupo(idx) {
    grupos.value.splice(idx, 1);
}

function handleGrupoFiles(e, grupo) {
    const files = Array.from(e.target?.files || e.dataTransfer?.files || []).filter(f => f.name.endsWith('.xml'));
    grupo.xmlFiles = [...grupo.xmlFiles, ...files];
    if (e.target) e.target.value = '';
}

function removerArquivoGrupo(grupo, idx) {
    grupo.xmlFiles.splice(idx, 1);
}

async function ejetarTodosGrupos() {
    if (!idSpedBase.value) return alert("Selecione um SPED base!");
    const gruposAtivos = grupos.value.filter(g => g.xmlFiles.length > 0);
    if (gruposAtivos.length === 0) return alert("Adicione XMLs em pelo menos um grupo!");

    isLoading.value = true;
    successInjectedId.value = null;
    logs.value = [`Enviando ${gruposAtivos.length} grupo(s) para processamento unificado...`];
    grupos.value.forEach(g => { g.status = null; g.logMsg = ''; });
    gruposAtivos.forEach(g => { g.status = 'processando'; });

    // Monta um único FormData com todos os grupos
    const fd = new FormData();
    fd.append('id_sped_arquivo', idSpedBase.value);

    const gruposConfig = gruposAtivos.map((g, i) => {
        g.xmlFiles.forEach(f => fd.append(`grupo_${i}_xmlFiles`, f));
        return {
            cfop: g.cfop,
            forcarUsoConsumo: g.forcarUsoConsumo,
            ajusteIpi: g.ajusteIpi,
            ajusteIcms: g.ajusteIcms,
            pularDuplicados: g.pularDuplicados,
            forceReplace: g.forceReplace
        };
    });
    fd.append('grupos_config', JSON.stringify(gruposConfig));

    try {
        const res = await axios.post(`${API_BASE_URL}/api/injetar-grupos`, fd, {
            headers: { 'Content-Type': 'multipart/form-data', 'Authorization': `Bearer ${token.value}` }
        });

        const det = res.data.detalhes;
        logs.value.push('[SUCCESS] ' + res.data.message);
        logs.value.push(`→ SPED: ${det.nome_arquivo}`);
        logs.value.push(`→ XMLs injetados: ${det.total_xml_injetados}`);
        logs.value.push(`→ Total linhas no SPED: ${det.total_linhas_sped}`);

        det.grupos.forEach(g => {
            const icon = g.status === 'ok' ? '[OK]' : '[AVISO]';
            const statusLabel = {
                ok: `${g.injetados} XML(s) injetado(s)`,
                todas_duplicadas: `Pulado — ${g.duplicadas || 0} duplicata(s)`,
                nenhuma_nota_valida: 'Pulado — XMLs inválidos',
                sem_arquivos: 'Pulado — nenhum arquivo recebido',
            };
            logs.value.push(`${icon} Grupo ${g.grupo}: ${statusLabel[g.status] || g.status}`);
            if (g.dica) logs.value.push(`   💡 ${g.dica}`);
            const grupoUI = gruposAtivos[g.grupo - 1];
            if (grupoUI) {
                grupoUI.status = g.status === 'ok' ? 'ok' : 'erro';
                grupoUI.logMsg = statusLabel[g.status] || g.status;
            }
        });

        exibirLogLmc(det.lmc_atualizados);
        successInjectedId.value = idSpedBase.value;
    } catch (e) {
        const data = e.response?.data;

        if (data?.tipo === 'cnpj_invalido') {
            logs.value.push(`[BLOQUEADO] ${data.message}`);
            data.bloqueados.forEach(b => logs.value.push(`  ✗ ${b.arquivo} → XML é de ${b.nome_xml || '(nome indisponível)'} (CNPJ ${b.cnpj_xml}) | SPED selecionado: CNPJ ${b.cnpj_sped}`));
            gruposAtivos.forEach(g => { g.status = 'erro'; });
        } else if (data?.tipo === 'periodo_divergente') {
            _pendingFdNfe = fd;
            _pendingGruposAtivos = gruposAtivos;
            _pendingEndpointNfe = 'grupos';
            modalPeriodoData.value = { periodo_sped: data.periodo_sped, avisos: data.avisos };
            modalPeriodo.value = true;
            gruposAtivos.forEach(g => { if (g.status === 'processando') g.status = null; });
        } else {
            logs.value.push(`[ERRO] ${data?.message || e.message}`);
            if (data?.grupos && Array.isArray(data.grupos)) {
                const statusLabel = {
                    sem_arquivos: 'Nenhum arquivo recebido pelo servidor',
                    nenhuma_nota_valida: 'XMLs inválidos ou não reconhecidos',
                    todas_duplicadas: 'Todos os XMLs já existem no SPED (duplicatas)',
                };
                data.grupos.forEach(g => {
                    logs.value.push(`  → Grupo ${g.grupo}: ${statusLabel[g.status] || g.status}`);
                    if (g.erros?.length) g.erros.forEach(err => logs.value.push(`     ⚠ ${err}`));
                });
            }
            gruposAtivos.forEach(g => { if (g.status === 'processando') g.status = 'erro'; });
        }
    } finally {
        isLoading.value = false;
    }
}

// --- Helper: log LMC atualizado pós-injeção ---
function exibirLogLmc(lmcAtualizados) {
    if (!lmcAtualizados || lmcAtualizados.length === 0) return;
    const atualizados = lmcAtualizados.filter(l => l.status === 'atualizado');
    const jaFisico   = lmcAtualizados.filter(l => l.status === 'ja_no_fisico');
    const semMapa    = lmcAtualizados.filter(l => l.status === 'ncm_sem_mapeamento');
    const semData    = lmcAtualizados.filter(l => l.status === 'data_nao_encontrada');
    if (atualizados.length > 0) {
        logs.value.push('[LMC] Entradas de combustível atualizadas automaticamente:');
        atualizados.forEach(l => logs.value.push(`  + ${l.descr} | ${l.qcom.toFixed(3)} L | data ${l.dt_doc} | cod ${l.cod_item}`));
        logs.value.push('[LMC] Verifique a necessidade de re-sincronizar o LMC.');
    }
    if (jaFisico.length > 0) {
        logs.value.push('[LMC] Entrada já registrada no físico (encerrantes) — não duplicada:');
        jaFisico.forEach(l => logs.value.push(`  = ${l.descr} | ${l.qcom.toFixed(3)} L | físico em ${l.dt_doc} | cod ${l.cod_item}`));
    }
    if (semMapa.length > 0) {
        logs.value.push('[LMC] Combustível detectado sem mapeamento NCM no SPED (produto novo?):');
        semMapa.forEach(l => logs.value.push(`  ! NCM ${l.ncm} — ${l.descr} — ${l.qcom.toFixed(3)} L`));
    }
    if (semData.length > 0)
        semData.forEach(l => logs.value.push(`  ! LMC: data ${l.dt_doc} não encontrada para ${l.cod_item}`));
}

// --- Modal de confirmação de período ---
const modalPeriodo = ref(false);
const modalPeriodoData = ref({ periodo_sped: '', avisos: [] });
const modalSubstituir = ref(false);   // confirmação rica de substituição de NF já lançada
const duplicadasSub = ref([]);
let _pendingFdNfe = null;
let _pendingGruposAtivos = null;
let _pendingEndpointNfe = null; // 'parse' | 'grupos'

async function confirmarForcePeriodo() {
    modalPeriodo.value = false;
    if (!_pendingFdNfe) return;
    _pendingFdNfe.set('force_periodo', 'true');
    isLoading.value = true;
    try {
        if (_pendingEndpointNfe === 'parse') {
            const res = await axios.post(`${API_BASE_URL}/api/xml-injector/parse`, _pendingFdNfe, {
                headers: { 'Content-Type': 'multipart/form-data', 'Authorization': `Bearer ${token.value}` }
            });
            const data = res.data;
            if (data.detalhes) {
                successInjectedId.value = idSpedBase.value;
                logs.value.push('[SUCCESS] ' + data.message);
                logs.value.push(`→ XMLs injetados: ${data.detalhes.total_xml_injetados}`);
                exibirLogLmc(data.detalhes.lmc_atualizados);
                xmlFiles.value = [];
            }
        } else {
            const res = await axios.post(`${API_BASE_URL}/api/injetar-grupos`, _pendingFdNfe, {
                headers: { 'Content-Type': 'multipart/form-data', 'Authorization': `Bearer ${token.value}` }
            });
            const det = res.data.detalhes;
            logs.value.push('[SUCCESS] ' + res.data.message);
            logs.value.push(`→ XMLs injetados: ${det.total_xml_injetados}`);
            exibirLogLmc(det.lmc_atualizados);
            successInjectedId.value = idSpedBase.value;
        }
    } catch (e) {
        logs.value.push(`[ERRO] ${e.response?.data?.message || e.message}`);
    } finally {
        isLoading.value = false;
        _pendingFdNfe = null;
        _pendingGruposAtivos = null;
        _pendingEndpointNfe = null;
    }
}

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
        // Ordena por período de apuração (cronológico), não pela ordem de upload.
        // Aceita "YYYY-MM-DD a ..." ou "DDMMAAAA" → chave YYYYMM ordenável.
        const chavePeriodo = (p) => {
            const s = String(p || '');
            let m = s.match(/(\d{4})-(\d{2})-\d{2}/);   if (m) return m[1] + m[2];
            m = s.match(/(\d{2})(\d{2})(\d{4})/);        if (m) return m[3] + m[2];
            return s;
        };
        spedFiles.value = (res.data || []).sort((a, b) => chavePeriodo(a.periodo_apuracao).localeCompare(chavePeriodo(b.periodo_apuracao)));
    } catch(e) {
        console.error('Erro ao carregar SPEDs', e);
    }
    await loadCfops();
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

function confirmarSubstituicao() {
    modalSubstituir.value = false;
    parseXmls(true); // re-injeta forçando a substituição
}
function cancelarSubstituicao() {
    modalSubstituir.value = false;
    logs.value.push('[INFO] Substituição cancelada pelo usuário.');
}
function fmtDataSped(d) {
    const s = String(d || '').replace(/\D/g, '');
    return s.length === 8 ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4, 8)}` : (d || '-');
}
function fmtMoeda(v) {
    const num = parseFloat(String(v ?? '0').replace(',', '.'));
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(isNaN(num) ? 0 : num);
}

async function parseXmls(forceReplace = false) {
    // Blindagem: @click="parseXmls" passaria o MouseEvent como 1º arg (truthy) e
    // forçaria substituição sem mostrar o modal. Só aceita o boolean explícito (true).
    forceReplace = forceReplace === true;
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
            exibirLogLmc(data.detalhes.lmc_atualizados);
            
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
            // Confirmação rica: mostra a NF que JÁ está no SPED (data, nº, valor, data de entrada) antes de sobrescrever.
            duplicadasSub.value = e.response.data.duplicadas || [];
            modalSubstituir.value = true;
        } else if (e.response?.data?.tipo === 'cnpj_divergente') {
            const data = e.response.data;
            const listaStr = data.bloqueados.map(b => `${b.arquivo}:\n   • Este XML é de: ${b.nome_xml || '(nome indisponível)'} (CNPJ ${b.cnpj_xml})\n   • SPED selecionado: CNPJ ${b.cnpj_sped}`).join('\n\n');
            logs.value.push(`[ERROR] ${data.message}`);
            data.bloqueados.forEach(b => logs.value.push(`  → ${b.arquivo}: XML pertence a ${b.nome_xml || '(nome indisponível)'} — CNPJ ${b.cnpj_xml} ≠ CNPJ do SPED ${b.cnpj_sped}`));
            alert(`BLOQUEADO: ${data.message}\n\n${listaStr}\n\nVocê está injetando um XML de OUTRA empresa. Verifique se selecionou o SPED correto.`);
        } else if (e.response?.data?.tipo === 'periodo_divergente') {
            const data = e.response.data;
            _pendingFdNfe = formData;
            _pendingEndpointNfe = 'parse';
            modalPeriodoData.value = { periodo_sped: data.periodo_sped, avisos: data.avisos };
            modalPeriodo.value = true;
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
            cfop_alvo: it.cfop_atual,
            cst_alvo: it.cst_atual || '000',
            conta_contabil: it.conta_contabil || '',
            isMapped: it.isMapped,
            cod_interno: it.cod_interno || it.cod_item_sugerido || '',
            cod_item_sugerido: it.cod_item_sugerido,
            numero_nota: it.numero_nota,
            data_nota: it.data_nota,
            // Tributação - pré-preenchida do XML; se há override salvo, usa o override
            aliq_icms: it.aliq_icms_override != null ? it.aliq_icms_override : (it.aliq_icms || 0),
            bc_icms_override: it.bc_icms_override != null ? it.bc_icms_override : null,
            cst_pis: it.cst_pis_override || it.cst_pis || '07',
            cst_cofins: it.cst_cofins_override || it.cst_cofins || '07',
            // Referência do XML (somente leitura)
            _aliq_icms_xml: it.aliq_icms || 0,
            _bc_icms_xml: it.bc_icms || 0
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
            conta_contabil: it.conta_contabil,
            aliq_icms: it.aliq_icms != null && it.aliq_icms !== '' ? parseFloat(it.aliq_icms) : null,
            bc_icms_override: it.bc_icms_override != null && it.bc_icms_override !== '' ? parseFloat(it.bc_icms_override) : null,
            cst_pis: it.cst_pis || null,
            cst_cofins: it.cst_cofins || null
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
            <div class="flex items-center justify-between">
                <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <Settings2 class="w-4 h-4 text-slate-400" />
                    Parâmetros Fiscais da Injeção
                </h2>
                <button
                    @click="toggleModoGrupos"
                    :class="modoGrupos ? 'bg-brand-accent text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                    class="text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                >
                    <Sparkles class="w-3.5 h-3.5" />
                    {{ modoGrupos ? 'Modo Grupos Ativo' : 'Ativar Modo Grupos' }}
                </button>
            </div>
            
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
                            <option v-for="c in cfopsDisponiveis" :key="c.codigo" :value="c.codigo">
                                {{ c.codigo }} — {{ c.descricao }}
                            </option>
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
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6" :class="modoGrupos ? 'min-h-[500px]' : 'h-[500px]'">
            <!-- Coluna 1: Upload de XML (modo simples) -->
            <div v-if="!modoGrupos" class="bg-white rounded-xl border border-slate-200 p-5 flex flex-col flex-1 shadow-sm">
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
                            @click="parseXmls()"
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

            <!-- Coluna 1: Modo Grupos -->
            <div v-else class="bg-white rounded-xl border border-slate-200 p-5 flex flex-col shadow-sm">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                        <Sparkles class="w-4 h-4 text-brand-accent" />
                        Grupos de Injeção
                    </h2>
                    <button @click="adicionarGrupo" class="text-[11px] uppercase font-bold tracking-wider text-brand-accent hover:text-blue-700 transition-colors">
                        + Adicionar Grupo
                    </button>
                </div>

                <!-- Lista de Grupos -->
                <div class="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar-term">
                    <div v-for="(grupo, idx) in grupos" :key="grupo.id" class="border border-slate-200 rounded-lg p-3 bg-slate-50">
                        <!-- Header do Grupo -->
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-slate-700">Grupo {{ idx + 1 }}</span>
                                <span v-if="grupo.status === 'processando'" class="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">PROCESSANDO</span>
                                <span v-else-if="grupo.status === 'ok'" class="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold">OK</span>
                                <span v-else-if="grupo.status === 'erro'" class="text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold">ERRO</span>
                                <span v-if="grupo.logMsg" class="text-[9px] text-slate-500">{{ grupo.logMsg }}</span>
                            </div>
                            <button v-if="grupos.length > 1" @click="removerGrupo(idx)" class="text-slate-300 hover:text-red-500 transition-colors">
                                <X class="w-3.5 h-3.5" />
                            </button>
                        </div>

                        <!-- Config: CFOP + Flags -->
                        <div class="flex gap-3 mb-2 flex-wrap items-end">
                            <div class="flex flex-col gap-1">
                                <label class="text-[9px] font-bold text-slate-400 uppercase tracking-wide">CFOP</label>
                                <select v-model="grupo.cfop" class="bg-white border border-slate-200 text-xs text-slate-700 font-medium px-2 py-1.5 rounded-md outline-none focus:border-brand-accent appearance-none cursor-pointer">
                                    <option v-for="c in cfopsDisponiveis" :key="c.codigo" :value="c.codigo">
                                        {{ c.codigo }} — {{ c.descricao }}
                                    </option>
                                </select>
                            </div>
                            <div class="flex flex-col gap-1">
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.forcarUsoConsumo" class="w-3.5 h-3.5 accent-blue-600" />
                                    <span class="text-[10px] text-slate-600">Zerar ICMS</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.ajusteIpi" class="w-3.5 h-3.5 accent-blue-600" />
                                    <span class="text-[10px] text-slate-600">Ajustar IPI</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.ajusteIcms" class="w-3.5 h-3.5 accent-blue-600" />
                                    <span class="text-[10px] text-slate-600">Ajustar ICMS</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.pularDuplicados" :disabled="grupo.forceReplace" class="w-3.5 h-3.5 accent-blue-600" />
                                    <span class="text-[10px]" :class="grupo.forceReplace ? 'text-slate-300' : 'text-slate-600'">Pular Duplicados</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.forceReplace" @change="() => { if (grupo.forceReplace) grupo.pularDuplicados = false }" class="w-3.5 h-3.5 accent-orange-500" />
                                    <span class="text-[10px] text-slate-600">Substituir Existentes</span>
                                </label>
                            </div>
                        </div>

                        <!-- Upload do Grupo -->
                        <input :id="`xml-grupo-${grupo.id}`" type="file" class="hidden" multiple accept=".xml" @change="e => handleGrupoFiles(e, grupo)" />
                        <div
                            @click="triggerGrupoInput(grupo.id)"
                            @dragover.prevent
                            @drop.prevent="e => handleGrupoFiles(e, grupo)"
                            class="border border-dashed border-slate-300 rounded-md bg-white hover:bg-slate-50 hover:border-slate-400 transition-colors flex items-center justify-center gap-2 py-2 cursor-pointer mb-2"
                        >
                            <UploadCloud class="w-3.5 h-3.5 text-slate-400" />
                            <span class="text-[10px] text-slate-500 font-medium">Arraste XMLs ou clique para selecionar</span>
                        </div>

                        <!-- Arquivos do Grupo -->
                        <div v-if="grupo.xmlFiles.length > 0" class="space-y-0.5 max-h-20 overflow-y-auto">
                            <div v-for="(file, fidx) in grupo.xmlFiles" :key="fidx" class="flex items-center justify-between px-2 py-1 bg-white rounded text-[10px]">
                                <span class="text-slate-600 font-mono truncate mr-2">{{ file.name }}</span>
                                <button @click="removerArquivoGrupo(grupo, fidx)" class="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0">
                                    <X class="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        <div v-else class="text-[10px] text-slate-400 text-center py-1">Nenhum XML neste grupo</div>
                    </div>
                </div>

                <!-- Botões de Ação dos Grupos -->
                <div class="flex flex-col gap-2 mt-3">
                    <button
                        @click="ejetarTodosGrupos"
                        :disabled="isLoading || !idSpedBase"
                        class="w-full bg-brand-accent hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm shadow-sm"
                    >
                        <Activity v-if="isLoading" class="w-4 h-4 animate-spin" />
                        <Sparkles v-else class="w-4 h-4" />
                        <span>{{ isLoading ? 'Processando grupos...' : 'Ejetar Todos os Grupos' }}</span>
                    </button>

                    <button
                        v-if="successInjectedId"
                        @click="downloadResultSped"
                        class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-lg transition-all flex items-center justify-center gap-3 text-sm shadow-lg animate-bounce"
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
                                <th class="pb-3 px-2 w-20">CST ICMS</th>
                                <th class="pb-3 px-2 w-20">Alíq. %</th>
                                <th class="pb-3 px-2 w-28">BC ICMS</th>
                                <th class="pb-3 px-2 w-20">CST PIS</th>
                                <th class="pb-3 px-2 w-20">CST COF.</th>
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
                                        <option v-for="c in cfopsDisponiveis" :key="c.codigo" :value="c.codigo">{{ c.codigo }} {{ c.descricao ? '- ' + c.descricao.substring(0, 18) : '' }}</option>
                                    </select>
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.cst_alvo" type="text" maxlength="3" placeholder="000" class="w-16 bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-md focus:border-brand-accent outline-none font-mono text-center" />
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-0.5">
                                        <input v-model="item.aliq_icms" type="number" step="0.01" min="0" placeholder="0,00" class="w-16 bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-md focus:border-brand-accent outline-none text-right" />
                                        <span class="text-[9px] text-slate-400 text-right">XML: {{ item._aliq_icms_xml }}%</span>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-0.5">
                                        <input v-model="item.bc_icms_override" type="number" step="0.01" min="0" placeholder="Calc. auto" class="w-24 bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-md focus:border-brand-accent outline-none text-right" />
                                        <span class="text-[9px] text-slate-400 text-right">Ref: {{ item._bc_icms_xml > 0 ? item._bc_icms_xml.toFixed(2) : 'calculado' }}</span>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.cst_pis" type="text" maxlength="3" placeholder="07" class="w-16 bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-md focus:border-brand-accent outline-none font-mono text-center" />
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.cst_cofins" type="text" maxlength="3" placeholder="07" class="w-16 bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-md focus:border-brand-accent outline-none font-mono text-center" />
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

        <!-- Modal: Período Divergente -->
        <Teleport to="body">
            <div v-if="modalPeriodo" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                    <div class="bg-amber-500 px-6 py-4 flex items-center gap-3">
                        <svg class="w-6 h-6 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                        <h2 class="text-white font-black text-sm uppercase tracking-wide">Atenção — Período Divergente</h2>
                    </div>
                    <div class="px-6 py-4 space-y-3">
                        <p class="text-sm text-slate-600">Os XMLs abaixo possuem data fora do período auditado. Deseja injetá-los mesmo assim?</p>
                        <div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs font-mono text-amber-800 font-bold">
                            Período do SPED: {{ modalPeriodoData.periodo_sped }}
                        </div>
                        <ul class="space-y-1 max-h-48 overflow-y-auto">
                            <li v-for="a in modalPeriodoData.avisos" :key="a.arquivo" class="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                                <span class="text-slate-700 font-medium truncate max-w-[260px]">{{ a.arquivo }}</span>
                                <span class="text-amber-600 font-bold font-mono shrink-0 ml-2">{{ a.data_xml }}</span>
                            </li>
                        </ul>
                    </div>
                    <div class="px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
                        <button @click="modalPeriodo = false; logs.push('[CANCELADO] Injeção cancelada pelo usuário.')" class="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors">
                            Cancelar
                        </button>
                        <button @click="confirmarForcePeriodo" class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black transition-colors">
                            Confirmar Injeção
                        </button>
                    </div>
                </div>
            </div>

            <!-- MODAL: Confirmar substituição de NF já lançada no SPED -->
            <div v-if="modalSubstituir" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
                    <div class="bg-orange-500 px-6 py-4 flex items-center gap-3">
                        <svg class="w-6 h-6 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                        <h2 class="text-white font-black text-sm uppercase tracking-wide">Confirmar Substituição</h2>
                    </div>
                    <div class="px-6 py-4 space-y-3">
                        <p class="text-sm text-slate-600">A(s) NF(s) abaixo <strong>já estão lançadas neste SPED</strong> e serão <strong>removidas e regravadas</strong> com os dados do XML:</p>
                        <div class="overflow-x-auto border border-slate-200 rounded-xl">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-slate-50 text-[10px] uppercase text-slate-400 font-black">
                                    <tr>
                                        <th class="px-3 py-2">Nº NF</th>
                                        <th class="px-3 py-2">Data da NF</th>
                                        <th class="px-3 py-2 text-right">Valor (no SPED)</th>
                                        <th class="px-3 py-2">Data entrada</th>
                                        <th class="px-3 py-2 text-right bg-orange-50/60">Valor (do XML)</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 text-slate-600">
                                    <tr v-for="d in duplicadasSub" :key="d.chv_nfe">
                                        <td class="px-3 py-2 font-mono font-bold text-slate-800">{{ d.num_doc }}</td>
                                        <td class="px-3 py-2">{{ fmtDataSped(d.dt_doc) }}</td>
                                        <td class="px-3 py-2 text-right font-mono">{{ fmtMoeda(d.valor) }}</td>
                                        <td class="px-3 py-2">{{ fmtDataSped(d.dt_e_s) }}</td>
                                        <td class="px-3 py-2 text-right font-mono font-bold text-orange-600 bg-orange-50/40">{{ fmtMoeda(d.valor_novo) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p class="text-[11px] text-slate-400">A coluna "Valor (do XML)" é o que será gravado no lugar do valor atual.</p>
                    </div>
                    <div class="px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
                        <button @click="cancelarSubstituicao" class="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors">Cancelar</button>
                        <button @click="confirmarSubstituicao" class="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-black transition-colors">Substituir</button>
                    </div>
                </div>
            </div>
        </Teleport>
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
