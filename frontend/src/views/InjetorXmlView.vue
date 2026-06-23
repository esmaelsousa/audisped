<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios'
import { API_BASE_URL } from '../api';
import { useRouter } from 'vue-router';
import { token, empresaSelecionada } from '../store';
import SpedPreview from '@/components/SpedPreview.vue';
import UiButton from '@/components/ui/UiButton.vue';
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
        spedFiles.value = res.data;
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
        <div class="flex flex-col gap-1 border-b border-line pb-6">
            <div class="flex items-center gap-2 text-[12px] text-risco font-medium mb-1">
                <span>Clientes</span>
                <ChevronRight class="w-4 h-4 text-line" :stroke-width="1.8" />
                <RouterLink :to="`/dashboard/${empresaSelecionada.id}`" class="hover:text-bronze transition-colors">
                    {{ empresaSelecionada.nome_empresa }}
                </RouterLink>
                <ChevronRight class="w-4 h-4 text-line" :stroke-width="1.8" />
                <span class="text-ink">Injetor de Notas (XML)</span>
            </div>
            <h1 class="font-display text-[26px] font-semibold text-ink tracking-[-0.01em]">Motor de Injeção XML</h1>
            <p class="text-risco text-[13px]">Force a reconstrução do arquivo SPED inserindo notas fiscais omitidas retroativamente.</p>
        </div>

        <!-- Regras Fiscais Corporativas -->
        <div class="bg-sheet rounded-md border border-line p-6 flex flex-col gap-5 card-shadow">
            <div class="flex items-center justify-between">
                <h2 class="text-[11px] font-medium text-risco uppercase tracking-wide flex items-center gap-2">
                    <Settings2 class="w-4 h-4 text-risco" :stroke-width="1.8" />
                    Parâmetros Fiscais da Injeção
                </h2>
                <button
                    @click="toggleModoGrupos"
                    :class="modoGrupos ? 'bg-bronze text-white border-bronze' : 'bg-paper text-risco border-line hover:bg-line/50'"
                    class="text-[11px] font-medium uppercase tracking-wide px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5"
                >
                    <Sparkles class="w-3.5 h-3.5" :stroke-width="1.8" />
                    {{ modoGrupos ? 'Modo Grupos Ativo' : 'Ativar Modo Grupos' }}
                </button>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- SPED Alvo -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-medium text-risco uppercase tracking-wide">Base do SPED (Alvo)</label>
                    <div class="relative">
                        <select v-model="idSpedBase" class="w-full bg-sheet border border-line text-[13px] text-ink px-3 py-2.5 rounded-md outline-none focus:border-bronze appearance-none cursor-pointer transition-colors">
                            <option value="">Apenas testar tabelas (Simulação)</option>
                            <option v-for="arq in spedFiles" :key="arq.id" :value="arq.id">
                                SPED: {{ arq.periodo_apuracao }}
                            </option>
                        </select>
                        <ChevronRight class="w-4 h-4 text-risco absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" :stroke-width="1.8" />
                    </div>
                </div>

                <!-- CFOP Padrão -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-medium text-risco uppercase tracking-wide">CFOP Padrão de Entrada</label>
                    <div class="relative">
                        <select v-model="cfopPadrao" class="w-full bg-sheet border border-line text-[13px] text-ink px-3 py-2.5 rounded-md outline-none focus:border-bronze appearance-none cursor-pointer transition-colors">
                            <option v-for="c in cfopsDisponiveis" :key="c.codigo" :value="c.codigo">
                                {{ c.codigo }} — {{ c.descricao }}
                            </option>
                        </select>
                        <ChevronRight class="w-4 h-4 text-risco absolute right-3 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" :stroke-width="1.8" />
                    </div>
                </div>

                <!-- Checkboxes -->
                <div class="flex flex-col gap-4 mt-2">
                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="forcarUsoConsumo" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-line rounded peer-checked:bg-bronze peer-checked:border-bronze transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-[13px] font-medium text-ink leading-tight">Zerar ICMS (Desoneração)</span>
                                <span class="text-[11px] text-risco">Forçar CST 040 e zerar BC (CFOP 1556)</span>
                            </div>
                        </label>
                    </div>

                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="ajusteIpi" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-line rounded peer-checked:bg-bronze peer-checked:border-bronze transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-[13px] font-medium text-ink leading-tight">Ajustar IPI (Custo)</span>
                                <span class="text-[11px] text-risco">Somar IPI ao valor do item e zerar imposto</span>
                            </div>
                        </label>
                    </div>

                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="ajusteIcms" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-line rounded peer-checked:bg-bronze peer-checked:border-bronze transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-[13px] font-medium text-ink leading-tight">Ajustar ICMS (Custo)</span>
                                <span class="text-[11px] text-risco">Somar ICMS ao valor do item e zerar imposto</span>
                            </div>
                        </label>
                    </div>

                    <div class="flex items-center">
                        <label class="flex items-center gap-3 cursor-pointer group">
                            <div class="relative flex items-center justify-center">
                                <input type="checkbox" v-model="pularDuplicados" class="peer sr-only" />
                                <div class="w-5 h-5 border-2 border-line rounded peer-checked:bg-bronze peer-checked:border-bronze transition-colors flex items-center justify-center">
                                    <svg class="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-[13px] font-medium text-ink leading-tight">Pular Chaves Duplicadas</span>
                                <span class="text-[11px] text-risco">Ignorar notas que já foram injetadas neste SPED</span>
                            </div>
                        </label>
                    </div>
                </div>
            </div>
        </div>

        <!-- Área de Upload e Console -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6" :class="modoGrupos ? 'min-h-[500px]' : 'h-[500px]'">
            <!-- Coluna 1: Upload de XML (modo simples) -->
            <div v-if="!modoGrupos" class="bg-sheet rounded-md border border-line p-5 flex flex-col flex-1 card-shadow">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-[11px] font-medium text-risco uppercase tracking-wide flex items-center gap-2">
                        <UploadCloud class="w-4 h-4 text-risco" :stroke-width="1.8" />
                        Notas Fiscais (NFe)
                    </h2>

                    <button v-if="xmlFiles.length > 0" @click="xmlFiles = []" class="text-[10px] uppercase font-medium tracking-wide text-lacre hover:opacity-80 transition-opacity">
                        Limpar Fila
                    </button>
                </div>

                <!-- Drag & Drop B2B style -->
                <input type="file" id="xml-upload" class="hidden" multiple accept=".xml" @change="handleFileDrop" />
                <div
                    @click="triggerFileInput"
                    @dragover.prevent
                    @drop.prevent="handleFileDrop"
                    class="border border-dashed border-line rounded-md bg-paper hover:border-bronze transition-colors flex flex-col items-center justify-center gap-2 py-6 cursor-pointer mb-3 relative overflow-hidden group"
                >
                    <HardDriveUpload class="w-6 h-6 text-risco group-hover:text-bronze transition-colors" :stroke-width="1.8" />
                    <p class="text-risco text-[12px] font-medium">Arraste os arquivos XML ou clique para buscar</p>
                </div>

                <div class="flex items-center gap-2 mb-3">
                    <button
                        @click="analyzeItems"
                        :disabled="xmlFiles.length === 0 || isAnalyzing"
                        class="flex-1 bg-paper hover:bg-line/50 text-ink text-[11px] font-medium uppercase tracking-wide py-2 rounded-md transition-colors flex items-center justify-center gap-2 border border-line disabled:opacity-50"
                    >
                        <TableProperties class="w-3.5 h-3.5" :stroke-width="1.8" />
                        {{ isAnalyzing ? 'Analisando...' : 'De-Para em Lote (Itens)' }}
                    </button>
                    <div v-if="detectedItems.length > 0" class="bg-conforme/10 text-conforme text-[9px] px-2 py-1 rounded-[3px] font-medium border border-conforme/25">
                        {{ detectedItems.length }} ITENS MAPEADOS
                    </div>
                </div>

                <!-- Fila de Arquivos -->
                <div class="flex-1 overflow-y-auto mb-4 border border-line rounded-md bg-paper p-2">
                    <div v-if="xmlFiles.length === 0" class="h-full flex items-center justify-center text-[12px] text-risco font-medium">
                        Nenhuma nota inserida na fila.
                    </div>
                    <ul v-else class="divide-y divide-line">
                        <li v-for="(file, index) in xmlFiles" :key="index" class="flex items-center justify-between px-3 py-2 hover:bg-sheet group transition-colors">
                            <span class="text-[12px] text-ink font-mono truncate mr-2" :title="file.name">
                                {{ file.name }}
                            </span>
                            <button @click.stop="removeFile(index)" class="text-risco hover:text-lacre transition-colors" title="Remover da fila">
                                <X class="w-3.5 h-3.5" :stroke-width="1.8" />
                            </button>
                        </li>
                    </ul>
                </div>
                
                <!-- Action CTA -->
                <div class="flex flex-col gap-3">
                    <div class="flex gap-2">
                        <UiButton
                            variant="ghost"
                            @click="simularInjecao"
                            :disabled="xmlFiles.length === 0 || isLoading"
                            class="flex-1 justify-center py-3 disabled:opacity-50"
                        >
                            <Eye v-if="!isLoading" class="w-4 h-4" :stroke-width="1.8" />
                            <span>{{ isLoading ? 'Aguarde...' : 'Gerar Prévia' }}</span>
                        </UiButton>

                        <UiButton
                            @click="parseXmls()"
                            :disabled="xmlFiles.length === 0 || isLoading || !idSpedBase"
                            class="flex-[2] justify-center py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Activity v-if="isLoading" class="w-4 h-4 animate-spin" :stroke-width="1.8" />
                            <span v-if="isLoading">Processando...</span>
                            <span v-else>Injetar no SPED</span>
                        </UiButton>
                    </div>

                    <button
                        @click="standaloneExport"
                        :disabled="xmlFiles.length === 0 || isLoading"
                        class="w-full bg-graphite hover:opacity-90 text-white font-medium py-3 rounded-md transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-[13px]"
                    >
                        <Download v-if="!isLoading" class="w-4 h-4" :stroke-width="1.8" />
                        <Activity v-else class="w-4 h-4 animate-spin" :stroke-width="1.8" />
                        <span>Ejeção Standalone (Gerar SPED Novo)</span>
                    </button>

                    <UiButton
                        v-if="successInjectedId"
                        @click="downloadResultSped"
                        class="w-full justify-center py-3 mt-2"
                    >
                        <Download class="w-5 h-5" :stroke-width="1.8" />
                        <span>BAIXAR SPED RETIFICADO AGORA</span>
                    </UiButton>
                </div>
            </div>

            <!-- Coluna 1: Modo Grupos -->
            <div v-else class="bg-sheet rounded-md border border-line p-5 flex flex-col card-shadow">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-[11px] font-medium text-risco uppercase tracking-wide flex items-center gap-2">
                        <Sparkles class="w-4 h-4 text-bronze" :stroke-width="1.8" />
                        Grupos de Injeção
                    </h2>
                    <button @click="adicionarGrupo" class="text-[11px] uppercase font-medium tracking-wide text-bronze hover:opacity-80 transition-opacity">
                        + Adicionar Grupo
                    </button>
                </div>

                <!-- Lista de Grupos -->
                <div class="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar-term">
                    <div v-for="(grupo, idx) in grupos" :key="grupo.id" class="border border-line rounded-md p-3 bg-paper">
                        <!-- Header do Grupo -->
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-[12px] font-medium text-ink">Grupo {{ idx + 1 }}</span>
                                <span v-if="grupo.status === 'processando'" class="text-[9px] bg-variacao/10 text-variacao border border-variacao/25 px-2 py-0.5 rounded-[3px] font-medium">PROCESSANDO</span>
                                <span v-else-if="grupo.status === 'ok'" class="text-[9px] bg-conforme/10 text-conforme border border-conforme/25 px-2 py-0.5 rounded-[3px] font-medium">OK</span>
                                <span v-else-if="grupo.status === 'erro'" class="text-[9px] bg-lacre/10 text-lacre border border-lacre/25 px-2 py-0.5 rounded-[3px] font-medium">ERRO</span>
                                <span v-if="grupo.logMsg" class="text-[9px] text-risco">{{ grupo.logMsg }}</span>
                            </div>
                            <button v-if="grupos.length > 1" @click="removerGrupo(idx)" class="text-risco hover:text-lacre transition-colors">
                                <X class="w-3.5 h-3.5" :stroke-width="1.8" />
                            </button>
                        </div>

                        <!-- Config: CFOP + Flags -->
                        <div class="flex gap-3 mb-2 flex-wrap items-end">
                            <div class="flex flex-col gap-1">
                                <label class="text-[9px] font-medium text-risco uppercase tracking-wide">CFOP</label>
                                <select v-model="grupo.cfop" class="bg-sheet border border-line text-[12px] text-ink px-2 py-1.5 rounded-md outline-none focus:border-bronze appearance-none cursor-pointer transition-colors">
                                    <option v-for="c in cfopsDisponiveis" :key="c.codigo" :value="c.codigo">
                                        {{ c.codigo }} — {{ c.descricao }}
                                    </option>
                                </select>
                            </div>
                            <div class="flex flex-col gap-1">
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.forcarUsoConsumo" class="w-3.5 h-3.5 accent-bronze" />
                                    <span class="text-[10px] text-risco">Zerar ICMS</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.ajusteIpi" class="w-3.5 h-3.5 accent-bronze" />
                                    <span class="text-[10px] text-risco">Ajustar IPI</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.ajusteIcms" class="w-3.5 h-3.5 accent-bronze" />
                                    <span class="text-[10px] text-risco">Ajustar ICMS</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.pularDuplicados" :disabled="grupo.forceReplace" class="w-3.5 h-3.5 accent-bronze" />
                                    <span class="text-[10px]" :class="grupo.forceReplace ? 'text-line' : 'text-risco'">Pular Duplicados</span>
                                </label>
                                <label class="flex items-center gap-1.5 cursor-pointer">
                                    <input type="checkbox" v-model="grupo.forceReplace" @change="() => { if (grupo.forceReplace) grupo.pularDuplicados = false }" class="w-3.5 h-3.5 accent-variacao" />
                                    <span class="text-[10px] text-risco">Substituir Existentes</span>
                                </label>
                            </div>
                        </div>

                        <!-- Upload do Grupo -->
                        <input :id="`xml-grupo-${grupo.id}`" type="file" class="hidden" multiple accept=".xml" @change="e => handleGrupoFiles(e, grupo)" />
                        <div
                            @click="triggerGrupoInput(grupo.id)"
                            @dragover.prevent
                            @drop.prevent="e => handleGrupoFiles(e, grupo)"
                            class="border border-dashed border-line rounded-md bg-sheet hover:border-bronze transition-colors flex items-center justify-center gap-2 py-2 cursor-pointer mb-2"
                        >
                            <UploadCloud class="w-3.5 h-3.5 text-risco" :stroke-width="1.8" />
                            <span class="text-[10px] text-risco font-medium">Arraste XMLs ou clique para selecionar</span>
                        </div>

                        <!-- Arquivos do Grupo -->
                        <div v-if="grupo.xmlFiles.length > 0" class="space-y-0.5 max-h-20 overflow-y-auto">
                            <div v-for="(file, fidx) in grupo.xmlFiles" :key="fidx" class="flex items-center justify-between px-2 py-1 bg-sheet border border-line rounded-[3px] text-[10px]">
                                <span class="text-ink font-mono truncate mr-2">{{ file.name }}</span>
                                <button @click="removerArquivoGrupo(grupo, fidx)" class="text-risco hover:text-lacre transition-colors flex-shrink-0">
                                    <X class="w-3 h-3" :stroke-width="1.8" />
                                </button>
                            </div>
                        </div>
                        <div v-else class="text-[10px] text-risco text-center py-1">Nenhum XML neste grupo</div>
                    </div>
                </div>

                <!-- Botões de Ação dos Grupos -->
                <div class="flex flex-col gap-2 mt-3">
                    <UiButton
                        @click="ejetarTodosGrupos"
                        :disabled="isLoading || !idSpedBase"
                        class="w-full justify-center py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Activity v-if="isLoading" class="w-4 h-4 animate-spin" :stroke-width="1.8" />
                        <Sparkles v-else class="w-4 h-4" :stroke-width="1.8" />
                        <span>{{ isLoading ? 'Processando grupos...' : 'Ejetar Todos os Grupos' }}</span>
                    </UiButton>

                    <UiButton
                        v-if="successInjectedId"
                        @click="downloadResultSped"
                        class="w-full justify-center py-3"
                    >
                        <Download class="w-5 h-5" :stroke-width="1.8" />
                        <span>BAIXAR SPED RETIFICADO AGORA</span>
                    </UiButton>
                </div>
            </div>

            <!-- Coluna 2: Terminal -->
            <div class="bg-graphite rounded-md border border-graphite-2 p-5 flex flex-col">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-[11px] font-medium text-muted uppercase tracking-wide flex items-center gap-2">
                        <FileTerminal class="w-4 h-4 text-muted" :stroke-width="1.8" />
                        Log Operacional
                    </h2>

                    <button
                        v-if="jsonResult"
                        @click="previewData = jsonResult; showPreview = true"
                        class="bg-bronze hover:opacity-85 text-white text-[10px] px-2 py-1 rounded-[3px] font-medium uppercase tracking-wide transition-opacity"
                    >
                        Visualizar Preview
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto font-mono text-[10px] text-conforme space-y-1.5 custom-scrollbar-term leading-relaxed p-2">
                    <div v-if="logs.length === 0" class="text-muted">
                        > Servidor aguardando lote de injeção...
                    </div>
                    <div v-for="(log, idx) in logs" :key="idx" class="whitespace-pre-wrap word-break hover:bg-graphite-2 transition-colors p-1 rounded-[3px]">
                        <span class="text-muted mr-2">[{{ new Date().toLocaleTimeString() }}]</span>
                        {{ log }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Modal de De-Para de Itens -->
        <div v-if="showItemsModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40">
            <div class="bg-sheet rounded-md border border-line w-full max-w-4xl max-h-[90vh] flex flex-col card-shadow">
                <div class="p-6 border-b border-line flex items-center justify-between">
                    <div>
                        <h3 class="font-display text-[18px] font-semibold text-ink">Análise de XMLs e Itens</h3>
                        <p class="text-[12px] text-risco">Exibindo resumo das notas e mapeamento de itens detectados.</p>
                    </div>
                    <button @click="showItemsModal = false" class="text-risco hover:text-ink transition-colors">
                        <X class="w-6 h-6" :stroke-width="1.8" />
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
                    <!-- Resumo das Notas -->
                    <section>
                        <h4 class="text-[11px] font-medium text-risco uppercase tracking-wide mb-3">Resumo das Notas Fiscal ({{ detectedNotes.length }})</h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            <div v-for="nota in detectedNotes" :key="nota.numero" class="bg-paper border border-line rounded-md p-3 flex flex-col gap-1">
                                <div class="flex justify-between items-start">
                                    <span class="text-[13px] font-medium text-ink">NF-e: {{ nota.numero }}</span>
                                    <span class="text-[10px] bg-line text-risco px-1.5 py-0.5 rounded-[3px] font-mono">{{ nota.data }}</span>
                                </div>
                                <div class="flex justify-between items-center text-[12px]">
                                    <span class="text-risco truncate mr-2">{{ nota.arquivo }}</span>
                                    <span class="font-mono font-medium text-bronze">R$ {{ (Number(nota.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="text-[11px] font-medium text-risco uppercase tracking-wide">Mapeamento de Itens Detectados ({{ detectedItems.length }})</h4>
                            <button
                                @click="applyDefaultCfopToAll"
                                class="text-[10px] bg-bronze/10 text-bronze hover:bg-bronze hover:text-white px-3 py-1 rounded-[3px] font-medium transition-all flex items-center gap-1.5 border border-bronze/20"
                            >
                                <CheckCircle2 class="w-3 h-3" :stroke-width="1.8" />
                                APLICAR CFOP PADRÃO ({{ cfopPadrao }}) EM TODOS
                            </button>
                        </div>
                        <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="text-[10px] uppercase tracking-wide text-risco font-medium border-b border-line">
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
                        <tbody class="divide-y divide-line">
                            <tr v-for="(item, idx) in detectedItems" :key="item.codigo + '_' + item.numero_nota + '_' + idx" class="text-sm">
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-1">
                                        <span class="font-mono text-[10px] text-risco">XML: {{ item.codigo }}</span>
                                        <input
                                            v-model="item.descricao"
                                            type="text"
                                            class="w-full bg-sheet border border-line text-[12px] px-2 py-1 rounded-md focus:border-bronze outline-none text-ink transition-colors"
                                            placeholder="Descrição no SPED"
                                        />
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col text-[10px] text-risco font-medium whitespace-nowrap">
                                        <span class="text-ink font-medium">NF: {{ item.numero_nota }}</span>
                                        <span>{{ item.data_nota ? item.data_nota.replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1') : '-' }}</span>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <input
                                        v-model="item.ncm"
                                        type="text"
                                        class="w-24 bg-sheet border border-line text-[12px] px-2 py-1 rounded-md focus:border-bronze outline-none text-risco font-mono transition-colors"
                                        placeholder="NCM"
                                    />
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-1">
                                        <input
                                            v-model="item.cod_interno"
                                            type="text"
                                            class="w-full bg-sheet border border-line text-[12px] px-2 py-1 rounded-md focus:border-bronze outline-none font-mono text-ink transition-colors"
                                            placeholder="Cód no SPED"
                                        />
                                        <button
                                            v-if="item.cod_item_sugerido && item.cod_interno !== item.cod_item_sugerido"
                                            @click="item.cod_interno = item.cod_item_sugerido"
                                            class="text-[9px] text-bronze hover:underline text-left"
                                        >
                                            Sugerido: {{ item.cod_item_sugerido }}
                                        </button>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <select v-model="item.cfop_alvo" class="w-full bg-sheet border border-line text-[12px] px-2 py-1.5 rounded-md focus:border-bronze outline-none text-ink transition-colors">
                                        <option v-for="c in cfopsDisponiveis" :key="c.codigo" :value="c.codigo">{{ c.codigo }} {{ c.descricao ? '- ' + c.descricao.substring(0, 18) : '' }}</option>
                                    </select>
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.cst_alvo" type="text" maxlength="3" placeholder="000" class="w-16 bg-sheet border border-line text-[12px] px-2 py-1.5 rounded-md focus:border-bronze outline-none font-mono text-center text-ink transition-colors" />
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-0.5">
                                        <input v-model="item.aliq_icms" type="number" step="0.01" min="0" placeholder="0,00" class="w-16 bg-sheet border border-line text-[12px] px-2 py-1.5 rounded-md focus:border-bronze outline-none text-right font-mono text-ink transition-colors" />
                                        <span class="text-[9px] text-risco text-right">XML: {{ item._aliq_icms_xml }}%</span>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <div class="flex flex-col gap-0.5">
                                        <input v-model="item.bc_icms_override" type="number" step="0.01" min="0" placeholder="Calc. auto" class="w-24 bg-sheet border border-line text-[12px] px-2 py-1.5 rounded-md focus:border-bronze outline-none text-right font-mono text-ink transition-colors" />
                                        <span class="text-[9px] text-risco text-right">Ref: {{ item._bc_icms_xml > 0 ? item._bc_icms_xml.toFixed(2) : 'calculado' }}</span>
                                    </div>
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.cst_pis" type="text" maxlength="3" placeholder="07" class="w-16 bg-sheet border border-line text-[12px] px-2 py-1.5 rounded-md focus:border-bronze outline-none font-mono text-center text-ink transition-colors" />
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.cst_cofins" type="text" maxlength="3" placeholder="07" class="w-16 bg-sheet border border-line text-[12px] px-2 py-1.5 rounded-md focus:border-bronze outline-none font-mono text-center text-ink transition-colors" />
                                </td>
                                <td class="py-3 px-2">
                                    <input v-model="item.conta_contabil" type="text" placeholder="Ex: 1.01.01..." class="w-full bg-sheet border border-line text-[12px] px-2 py-1.5 rounded-md focus:border-bronze outline-none text-ink transition-colors" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </section>
            </div>

            <div class="p-6 border-t border-line flex justify-between items-center bg-paper rounded-b-md">
                    <p class="text-[11px] text-risco">Os mapeamentos salvos serão aplicados automaticamente nas próximas injeções para o mesmo CNPJ Emissor + Código Produto.</p>
                    <div class="flex items-center gap-3">
                        <UiButton
                            variant="ghost"
                            @click="saveBatchDePara"
                            :disabled="isSavingMapping"
                            class="py-2.5 px-6"
                        >
                            <Activity v-if="isSavingMapping" class="w-4 h-4 animate-spin" :stroke-width="1.8" />
                            Salvar de-para no Banco
                        </UiButton>
                        <UiButton @click="showItemsModal = false" class="py-2.5 px-8">
                            Utilizar nesta Injeção
                        </UiButton>
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
            <div v-if="modalPeriodo" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
                <div class="bg-sheet rounded-md border border-line card-shadow w-full max-w-lg mx-4 overflow-hidden">
                    <div class="bg-variacao/10 border-b border-variacao/25 px-6 py-4 flex items-center gap-3">
                        <AlertTriangle class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.8" />
                        <h2 class="font-display text-[15px] font-semibold text-ink">Atenção — Período Divergente</h2>
                    </div>
                    <div class="px-6 py-4 space-y-3">
                        <p class="text-[13px] text-risco">Os XMLs abaixo possuem data fora do período auditado. Deseja injetá-los mesmo assim?</p>
                        <div class="bg-paper border border-line rounded-md px-4 py-2 text-[12px] font-mono text-ink">
                            Período do SPED: {{ modalPeriodoData.periodo_sped }}
                        </div>
                        <ul class="space-y-1 max-h-48 overflow-y-auto">
                            <li v-for="a in modalPeriodoData.avisos" :key="a.arquivo" class="flex items-center justify-between bg-paper border border-line rounded-[3px] px-3 py-1.5 text-[12px]">
                                <span class="text-ink font-medium truncate max-w-[260px]">{{ a.arquivo }}</span>
                                <span class="text-variacao font-mono shrink-0 ml-2">{{ a.data_xml }}</span>
                            </li>
                        </ul>
                    </div>
                    <div class="px-6 py-4 flex justify-end gap-3 border-t border-line bg-paper">
                        <UiButton variant="ghost" @click="modalPeriodo = false; logs.push('[CANCELADO] Injeção cancelada pelo usuário.')">
                            Cancelar
                        </UiButton>
                        <UiButton @click="confirmarForcePeriodo">
                            Confirmar Injeção
                        </UiButton>
                    </div>
                </div>
            </div>

            <!-- MODAL: Confirmar substituição de NF já lançada no SPED -->
            <div v-if="modalSubstituir" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
                <div class="bg-sheet rounded-md border border-line card-shadow w-full max-w-2xl mx-4 overflow-hidden">
                    <div class="bg-variacao/10 border-b border-variacao/25 px-6 py-4 flex items-center gap-3">
                        <AlertTriangle class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.8" />
                        <h2 class="font-display text-[15px] font-semibold text-ink">Confirmar Substituição</h2>
                    </div>
                    <div class="px-6 py-4 space-y-3">
                        <p class="text-[13px] text-risco">A(s) NF(s) abaixo <strong class="text-ink">já estão lançadas neste SPED</strong> e serão <strong class="text-ink">removidas e regravadas</strong> com os dados do XML:</p>
                        <div class="overflow-x-auto border border-line rounded-md">
                            <table class="w-full text-left text-[12px]">
                                <thead class="bg-paper text-[10px] uppercase text-risco font-medium">
                                    <tr>
                                        <th class="px-3 py-2">Nº NF</th>
                                        <th class="px-3 py-2">Data da NF</th>
                                        <th class="px-3 py-2 text-right">Valor (no SPED)</th>
                                        <th class="px-3 py-2">Data entrada</th>
                                        <th class="px-3 py-2 text-right bg-variacao/[0.06]">Valor (do XML)</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line text-risco">
                                    <tr v-for="d in duplicadasSub" :key="d.chv_nfe">
                                        <td class="px-3 py-2 font-mono text-ink">{{ d.num_doc }}</td>
                                        <td class="px-3 py-2 font-mono">{{ fmtDataSped(d.dt_doc) }}</td>
                                        <td class="px-3 py-2 text-right font-mono">{{ fmtMoeda(d.valor) }}</td>
                                        <td class="px-3 py-2 font-mono">{{ fmtDataSped(d.dt_e_s) }}</td>
                                        <td class="px-3 py-2 text-right font-mono font-medium text-variacao bg-variacao/[0.04]">{{ fmtMoeda(d.valor_novo) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <p class="text-[11px] text-risco">A coluna "Valor (do XML)" é o que será gravado no lugar do valor atual.</p>
                    </div>
                    <div class="px-6 py-4 flex justify-end gap-3 border-t border-line bg-paper">
                        <UiButton variant="ghost" @click="cancelarSubstituicao">Cancelar</UiButton>
                        <button @click="confirmarSubstituicao" class="inline-flex items-center gap-2 rounded-md px-[13px] py-[7px] bg-lacre text-white text-[13px] font-medium hover:opacity-85 transition-opacity">Substituir</button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>


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
