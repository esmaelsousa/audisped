<script setup>
// Aba "Auditoria" do Livro LMC — antiga aba "Auditoria LMC" do AnalisadorView, extraída
// para um componente isolado (escopo próprio → zero colisão com o LmcView).
// Auto-contido: faz o próprio carregamento de /api/lmc/:id e cadastros; emite 'changed'
// quando altera o banco (para o pai recarregar a aba Livro).
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../../api'
import {
  Search, Settings2, Lock, CreditCard, Receipt, AlertTriangle, ChevronRight,
  Pencil, CheckCircle2, Zap, Lightbulb, ShieldCheck, Store, Loader2, X,
} from 'lucide-vue-next'

const props = defineProps({
  arquivoId: { type: [String, Number], default: null },
  cnpj: { type: String, default: '' },
  active: { type: Boolean, default: true }, // aba visível → dispara o carregamento preguiçoso
})
const emit = defineEmits(['changed', 'irregularidades'])

const formatNumber = (value) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3 }).format(value)

// ---------------- estado ----------------
const lmcData = ref([])
const loadingLmc = ref(false)
const lmcFilters = ref({ search: '', date: '', onlyErrors: false })
const expandedFuels = ref({})

const tankConfigs = ref([])
const showLmcConfigModal = ref(false)
const savingLmcConfig = ref(false)

const showLacresModal = ref(false)
const lacresBombas = ref([])
const lacresCnpj = ref('')
const savingLacres = ref(false)

const showCredModal = ref(false)
const credList = ref([])
const savingCred = ref(false)
const dadosPosto = ref(null)

const showE116Modal = ref(false)
const e116Cad = ref({ cod_rec: '0767' })
const savingE116 = ref(false)

const showOtimizadorModal = ref(false)
const productToOtimizar = ref(null)
const targetVolume = ref(0)
const savingOtimizacao = ref(false)

const editingStock = ref({})
const savingStock = ref(false)
const editingSaida = ref({})
const savingSaida = ref(false)

const continuidade = ref({ tem_mes_anterior: false, divergencias: [] })
const sincronizando = ref({})

const COMBUSTIVEIS_LMC = ['GASOLINA', 'ETANOL', 'ÁLCOOL', 'ALCOOL', 'DIESEL', 'GNV', 'GLP', 'QUEROSENE', 'BIODIESEL']

// ---------------- computeds ----------------
const filteredLmc = computed(() => {
  let data = lmcData.value.filter(d => COMBUSTIVEIS_LMC.some(k => (d.nome_combustivel || '').toUpperCase().includes(k)))
  if (lmcFilters.value.search) {
    const s = lmcFilters.value.search.toLowerCase()
    data = data.filter(d => d.nome_combustivel.toLowerCase().includes(s) || d.cod_item.toLowerCase().includes(s))
  }
  if (lmcFilters.value.date) data = data.filter(d => d.data_movimento.includes(lmcFilters.value.date))
  if (lmcFilters.value.onlyErrors) data = data.filter(d => d.status_anp !== 'CONFORME')
  return data
})

const lmcKpis = computed(() => {
  if (!lmcData.value.length) return []
  const grupos = {}
  lmcData.value.forEach(d => {
    const key = d.nome_combustivel || d.cod_item
    if (!grupos[key]) grupos[key] = { nome: key, cod: d.cod_item, registros: [], totalEntradas: 0, totalSaidas: 0, irregularidades: 0 }
    grupos[key].registros.push(d)
    grupos[key].totalEntradas += (parseFloat(d.vol_entr_lmc) || 0)
    grupos[key].totalSaidas += (parseFloat(d.vol_saidas_final || d.vol_saidas || 0))
    if (d.status_anp !== 'CONFORME') grupos[key].irregularidades++
  })
  const resultado = Object.values(grupos).map(g => {
    const ordenados = [...g.registros].sort((a, b) => new Date(a.data_movimento) - new Date(b.data_movimento))
    const dataInicial = ordenados[0].data_movimento
    const dataFinal = ordenados[ordenados.length - 1].data_movimento
    const primeiroDia = ordenados.filter(r => r.data_movimento === dataInicial)
    const estoqueInicial = primeiroDia.reduce((acc, r) => acc + parseFloat(r.estq_abert_final || r.estq_abert || 0), 0)
    const registrosComFisico = ordenados.filter(r => (parseFloat(r.fech_fisico_final || r.fech_fisico) || 0) > 0)
    const dataFinalComMedicao = registrosComFisico.length > 0 ? registrosComFisico[registrosComFisico.length - 1].data_movimento : dataFinal
    const ultimoDiaComMedicao = ordenados.filter(r => r.data_movimento === dataFinalComMedicao)
    const fechFisicoFinal = ultimoDiaComMedicao.reduce((acc, r) => acc + parseFloat(r.fech_fisico_final || r.fech_fisico || 0), 0)
    const registrosAteMedicao = ordenados.filter(r => new Date(r.data_movimento) <= new Date(dataFinalComMedicao))
    const entradasAteMedicao = registrosAteMedicao.reduce((acc, r) => acc + (parseFloat(r.vol_entr_lmc) || 0), 0)
    const saidasAteMedicao = registrosAteMedicao.reduce((acc, r) => acc + (parseFloat(r.vol_saidas_final || r.vol_saidas || 0)), 0)
    const escrAteMedicao = estoqueInicial + entradasAteMedicao - saidasAteMedicao
    const quebraLiquida = fechFisicoFinal - escrAteMedicao
    return {
      nome: g.nome, cod: g.cod, estoqueInicial,
      totalEntradas: g.totalEntradas, totalSaidas: g.totalSaidas,
      quebraLiquida, estoqueFinal: fechFisicoFinal, irregularidades: g.irregularidades,
    }
  })
  return resultado
    .filter(c => COMBUSTIVEIS_LMC.some(k => c.nome?.toUpperCase().includes(k)))
    .sort((a, b) => a.nome.localeCompare(b.nome))
})

function toggleFuel(cod) { expandedFuels.value = { ...expandedFuels.value, [cod]: !expandedFuels.value[cod] } }
function lmcDoCombustivel(cod) { return filteredLmc.value.filter(item => item.cod_item === cod) }

// ---------------- carregamento ----------------
async function loadLmcDetailed() {
  if (!props.arquivoId) return
  loadingLmc.value = true
  lmcData.value = []
  try {
    const resLmc = await axios.get(`${API_BASE_URL}/api/lmc/${props.arquivoId}`)
    lmcData.value = resLmc.data
    if (props.cnpj) {
      try { tankConfigs.value = (await axios.get(`${API_BASE_URL}/api/lmc/tanques-config/${props.cnpj}`)).data } catch { /* config é opcional */ }
    }
    await checkContinuidade()
  } catch (e) {
    console.error('Erro ao carregar detalhes LMC:', e)
  } finally {
    loadingLmc.value = false
  }
}

async function checkContinuidade() {
  if (!props.arquivoId) return
  try {
    continuidade.value = (await axios.get(`${API_BASE_URL}/api/lmc/continuidade/${props.arquivoId}`)).data
  } catch (e) {
    console.error('Erro ao verificar continuidade:', e)
  }
}

// ---------------- configuração de tanques ----------------
async function openLmcConfig() {
  const produtosNoLmc = [...new Set(lmcData.value.filter(d => d.has_lmc_row === true).map(d => d.cod_item))]
  let sugestoes = []
  try {
    sugestoes = (await axios.get(`${API_BASE_URL}/api/lmc/tanques-sugeridos/${props.arquivoId}`)).data
  } catch (e) {
    console.warn('Não foi possível buscar sugestões de capacidade do SPED:', e)
  }
  tankConfigs.value = produtosNoLmc.map(cod => {
    const existing = tankConfigs.value.find(c => c.cod_item === cod)
    const descr = lmcData.value.find(d => d.cod_item === cod)?.nome_combustivel || 'Produto'
    const sugerido = sugestoes.find(s => s.cod_item === cod)
    let capacidade = 0, fromSped = false
    if (existing && Number(existing.capacidade) > 0) capacidade = existing.capacidade
    else if (sugerido && sugerido.capacidade > 0) { capacidade = sugerido.capacidade; fromSped = true }
    return { cod_item: cod, descr_item: descr, capacidade, fromSped }
  })
  showLmcConfigModal.value = true
}

async function saveLmcConfig() {
  savingLmcConfig.value = true
  try {
    const configs = tankConfigs.value.map(c => ({
      cod_item: c.cod_item,
      capacidade: (c.capacidade === '' || c.capacidade === null || isNaN(c.capacidade)) ? null : Number(c.capacidade),
    }))
    await axios.post(`${API_BASE_URL}/api/lmc/tanques-config`, { cnpj: props.cnpj, configs })
    showLmcConfigModal.value = false
    await loadLmcDetailed()
    emit('changed')
  } catch (e) {
    alert('Erro ao salvar capacidades: ' + e.message)
  } finally {
    savingLmcConfig.value = false
  }
}

// ---------------- lacres das bombas (1360) ----------------
async function openLacresModal() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/lmc/lacres-bombas/${props.arquivoId}`)
    lacresCnpj.value = res.data.cnpj || props.cnpj || ''
    const porSerie = {}
    for (const l of (res.data.lacres || [])) {
      (porSerie[l.serie_bomba] = porSerie[l.serie_bomba] || []).push({ num_lacre: l.num_lacre, dt_aplicacao: l.dt_aplicacao || '' })
    }
    lacresBombas.value = (res.data.bombas || []).map(b => ({
      serie: b.serie, fabricante: b.fabricante, modelo: b.modelo, temLacre: b.temLacre,
      lacres: (porSerie[b.serie] && porSerie[b.serie].length) ? porSerie[b.serie] : [{ num_lacre: '', dt_aplicacao: '' }],
    }))
    showLacresModal.value = true
  } catch (e) {
    alert('Erro ao carregar bombas/lacres: ' + (e.response?.data?.message || e.message))
  }
}
function addLacre(b) { b.lacres.push({ num_lacre: '', dt_aplicacao: '' }) }
function removeLacre(b, i) { b.lacres.splice(i, 1); if (!b.lacres.length) b.lacres.push({ num_lacre: '', dt_aplicacao: '' }) }
async function saveLacres() {
  savingLacres.value = true
  try {
    const lacres = []
    for (const b of lacresBombas.value) {
      for (const l of (b.lacres || [])) {
        if ((l.num_lacre || '').trim()) lacres.push({ serie_bomba: b.serie, num_lacre: String(l.num_lacre).trim(), dt_aplicacao: String(l.dt_aplicacao || '').trim() })
      }
    }
    await axios.post(`${API_BASE_URL}/api/lmc/lacres`, { cnpj: lacresCnpj.value, lacres })
    showLacresModal.value = false
    alert('Lacres salvos. Re-exporte o SPED para injetar os registros 1360.')
  } catch (e) {
    alert('Erro ao salvar lacres: ' + (e.response?.data?.message || e.message))
  } finally {
    savingLacres.value = false
  }
}

// ---------------- credenciadoras (1601) ----------------
async function openCredModal() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/cad/credenciadoras-1601/${props.arquivoId}`)
    credList.value = (res.data.credenciadoras || []).map(c => ({ ...c }))
    dadosPosto.value = res.data.dadosPosto || null
    showCredModal.value = true
  } catch (e) {
    alert('Erro ao carregar credenciadoras: ' + (e.response?.data?.message || e.message))
  }
}
function usarDadosPosto() {
  const d = dadosPosto.value
  if (!d || (!d.cod_mun && !d.endereco)) { alert('Não foi possível ler o município/endereço do posto (0000/0005) deste arquivo.'); return }
  credList.value = credList.value.map(c => ({
    ...c,
    cod_mun: c.cod_mun || d.cod_mun || '',
    endereco: c.endereco || d.endereco || '',
    num: c.num || d.num || '',
    bairro: c.bairro || d.bairro || '',
  }))
}
async function saveCred() {
  savingCred.value = true
  try {
    await axios.post(`${API_BASE_URL}/api/cad/credenciadoras`, { credenciadoras: credList.value })
    showCredModal.value = false
    alert('Credenciadoras salvas. Re-exporte o SPED — o 0150 completo será injetado para as que têm município e endereço.')
  } catch (e) {
    alert('Erro ao salvar credenciadoras: ' + (e.response?.data?.message || e.message))
  } finally {
    savingCred.value = false
  }
}

// ---------------- apuração ICMS (E116) ----------------
async function openE116Modal() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/cad/apuracao-e116/${props.arquivoId}`)
    e116Cad.value = { cod_rec: res.data.cod_rec || '0767', cnpj: res.data.cnpj }
    showE116Modal.value = true
  } catch (e) {
    alert('Erro ao carregar apuração E116: ' + (e.response?.data?.message || e.message))
  }
}
async function saveE116() {
  if (!e116Cad.value.cod_rec) { alert('Informe o código de receita (COD_REC).'); return }
  savingE116.value = true
  try {
    await axios.post(`${API_BASE_URL}/api/cad/apuracao-e116`, { cnpj: e116Cad.value.cnpj, cod_rec: e116Cad.value.cod_rec })
    showE116Modal.value = false
    alert('Apuração E116 salva. Re-exporte o SPED — o E116 será injetado com o valor do ICMS a recolher do E110.')
  } catch (e) {
    alert('Erro ao salvar apuração E116: ' + (e.response?.data?.message || e.message))
  } finally {
    savingE116.value = false
  }
}

// ---------------- otimizador matemático ----------------
function openOtimizador(comb) {
  productToOtimizar.value = comb
  targetVolume.value = Math.round(comb.totalSaidas * 1000) / 1000
  showOtimizadorModal.value = true
}
async function startOtimizacao() {
  if (!props.arquivoId || !productToOtimizar.value) return
  savingOtimizacao.value = true
  try {
    await axios.post(`${API_BASE_URL}/api/lmc/otimizador-matematico`, {
      id_arquivo: props.arquivoId,
      cod_item: productToOtimizar.value.cod,
      volume_alvo: targetVolume.value,
    })
    showOtimizadorModal.value = false
    setTimeout(async () => { await loadLmcDetailed(); emit('changed') }, 300)
  } catch (e) {
    alert('Erro na Distribuição Inteligente: ' + (e.response?.data?.error || e.message))
  } finally {
    savingOtimizacao.value = false
  }
}

// ---------------- edição de saída (cascata) ----------------
function toggleEditSaida(codItem, dataMov, valorAtual) {
  const key = `${codItem}|${dataMov}`
  if (editingSaida.value[key] !== undefined) delete editingSaida.value[key]
  else editingSaida.value[key] = valorAtual
}
async function saveEditSaida(codItem, dataMov) {
  const key = `${codItem}|${dataMov}`
  const novoValor = editingSaida.value[key]
  if (novoValor === undefined || !props.arquivoId) return
  savingSaida.value = true
  try {
    await axios.post(`${API_BASE_URL}/api/lmc/ajustar-cascata`, {
      id_sped: props.arquivoId, cod_item: codItem, data_mov: dataMov, vol_saidas_ajustado: parseFloat(novoValor),
    })
    delete editingSaida.value[key]
    await loadLmcDetailed()
    emit('changed')
  } catch (e) {
    alert('Erro ao salvar saída: ' + (e.response?.data?.error || e.message))
  } finally {
    savingSaida.value = false
  }
}

// ---------------- continuidade de estoque entre meses ----------------
async function sincronizarEstoque(cod, fechamentoAnterior) {
  if (!props.arquivoId) return
  sincronizando.value[cod] = true
  try {
    await axios.post(`${API_BASE_URL}/api/lmc/update-estoque-inicial`, {
      id_arquivo: props.arquivoId, cod_item: cod, novo_estoque: parseFloat(fechamentoAnterior),
    })
    await loadLmcDetailed()
    await checkContinuidade()
    emit('changed')
  } catch (e) {
    alert('Erro ao sincronizar estoque: ' + (e.response?.data?.error || e.message))
  } finally {
    delete sincronizando.value[cod]
  }
}
async function sincronizarTodos() {
  for (const div of continuidade.value.divergencias) {
    await sincronizarEstoque(div.cod_item, div.fechamento_anterior)
  }
}

// ---------------- edição de estoque inicial ----------------
function toggleEditStock(cod, atual) {
  if (editingStock.value[cod] !== undefined) delete editingStock.value[cod]
  else editingStock.value[cod] = atual
}
async function saveInitialStock(cod) {
  if (!props.arquivoId) return
  const novoValor = editingStock.value[cod]
  if (novoValor === undefined) return
  savingStock.value = true
  try {
    await axios.post(`${API_BASE_URL}/api/lmc/update-estoque-inicial`, {
      id_arquivo: props.arquivoId, cod_item: cod, novo_estoque: parseFloat(novoValor),
    })
    delete editingStock.value[cod]
    await loadLmcDetailed()
    emit('changed')
  } catch (e) {
    alert('Erro ao formatar estoque inicial: ' + (e.response?.data?.error || e.message))
  } finally {
    savingStock.value = false
  }
}

// ---------------- ciclo de vida ----------------
let ultimoIdCarregado = null
watch(() => [props.active, props.arquivoId], ([active, id]) => {
  if (active && id && String(id) !== String(ultimoIdCarregado)) {
    ultimoIdCarregado = id
    loadLmcDetailed()
  }
}, { immediate: true })

watch(lmcKpis, (k) => {
  emit('irregularidades', (k || []).reduce((a, c) => a + (c.irregularidades || 0), 0))
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">

    <!-- Barra de Filtros + Configurações -->
    <div class="bg-sheet px-3 py-2 rounded-md card-shadow border border-line flex flex-wrap items-center gap-3 justify-between">
      <div class="flex items-center gap-3">
        <div class="relative">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-risco" :stroke-width="1.8" />
          <input v-model="lmcFilters.search" type="text" placeholder="Filtrar combustível..." class="pl-8 pr-3 py-1.5 bg-paper border border-line rounded-md text-[12px] text-ink focus:border-bronze outline-none w-44">
        </div>
        <input v-model="lmcFilters.date" type="date" class="px-3 py-1.5 bg-paper border border-line rounded-md text-[12px] font-mono text-risco">
        <label class="flex items-center gap-1.5 cursor-pointer group">
          <input v-model="lmcFilters.onlyErrors" type="checkbox" class="w-3.5 h-3.5 rounded border-line text-bronze focus:ring-bronze focus:ring-1">
          <span class="text-[10px] font-medium text-risco group-hover:text-ink uppercase tracking-wide">Só falhas</span>
        </label>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button @click="openLmcConfig" class="px-3.5 py-1.5 bg-graphite hover:opacity-90 text-white rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5">
          <Settings2 class="w-3.5 h-3.5" :stroke-width="1.8" /> Configurar tanques
        </button>
        <button @click="openLacresModal" class="px-3.5 py-1.5 bg-graphite-2 hover:opacity-90 text-white rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5" title="Cadastrar lacres das bombas (registro 1360) — injetados no SPED ao exportar">
          <Lock class="w-3.5 h-3.5" :stroke-width="1.8" /> Lacres das bombas
        </button>
        <button @click="openCredModal" class="px-3.5 py-1.5 bg-graphite-2 hover:opacity-90 text-white rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5" title="Cadastrar credenciadoras do 1601 (maquininhas) — injeta o 0150 completo no SPED ao exportar">
          <CreditCard class="w-3.5 h-3.5" :stroke-width="1.8" /> Credenciadoras (1601)
        </button>
        <button @click="openE116Modal" class="px-3.5 py-1.5 bg-graphite-2 hover:opacity-90 text-white rounded-md text-[12px] font-medium transition-all flex items-center gap-1.5" title="Cadastrar o código de receita (COD_REC) p/ injetar o E116 ausente quando o E110 tem ICMS a recolher">
          <Receipt class="w-3.5 h-3.5" :stroke-width="1.8" /> Apuração ICMS (E116)
        </button>
      </div>
    </div>

    <!-- Banner de Continuidade de Estoque -->
    <div v-if="continuidade.divergencias.length > 0" class="bg-variacao/10 border border-variacao/30 rounded-md p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <AlertTriangle class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.8" />
          <div>
            <p class="text-[13px] font-medium text-variacao">Continuidade de estoque — divergência detectada</p>
            <p class="text-[12px] text-risco">
              O estoque de abertura deste mês difere do fechamento físico do mês anterior
              <span v-if="continuidade.divergencias[0]?.periodo_anterior" class="font-mono text-ink">
                ({{ continuidade.divergencias[0].periodo_anterior.substring(5,7) }}/{{ continuidade.divergencias[0].periodo_anterior.substring(0,4) }})
              </span>.
              Sincronize para corrigir a base de cálculo.
            </p>
          </div>
        </div>
        <button @click="sincronizarTodos" class="px-4 py-1.5 bg-variacao hover:opacity-90 text-white text-[12px] font-medium rounded-md transition-all flex items-center gap-1.5 shrink-0">
          <Loader2 v-if="Object.keys(sincronizando).length > 0" class="w-3 h-3 animate-spin" />
          <span>Sincronizar todos</span>
        </button>
      </div>
      <div class="space-y-2">
        <div v-for="div in continuidade.divergencias" :key="div.cod_item" class="bg-sheet rounded-md border border-line px-4 py-2.5 flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[12px] font-medium text-ink truncate">{{ div.nome || div.cod_item }}</p>
            <p class="text-[10px] text-risco font-mono">Cód: {{ div.cod_item }}</p>
          </div>
          <div class="flex items-center gap-4 text-[12px] font-mono shrink-0">
            <div class="text-center">
              <p class="text-[9px] uppercase font-medium text-risco tracking-wide">Fechamento ant.</p>
              <p class="text-conforme">{{ Number(div.fechamento_anterior).toFixed(3) }} L</p>
            </div>
            <ChevronRight class="w-4 h-4 text-line" :stroke-width="2" />
            <div class="text-center">
              <p class="text-[9px] uppercase font-medium text-risco tracking-wide">Abertura atual</p>
              <p class="text-ink">{{ Number(div.abertura_atual).toFixed(3) }} L</p>
            </div>
            <div class="text-center">
              <p class="text-[9px] uppercase font-medium text-risco tracking-wide">Diferença</p>
              <p :class="div.diferenca > 0 ? 'text-bronze' : 'text-lacre'">
                {{ div.diferenca > 0 ? '+' : '' }}{{ Number(div.diferenca).toFixed(3) }} L
              </p>
            </div>
          </div>
          <button @click="sincronizarEstoque(div.cod_item, div.fechamento_anterior)" :disabled="sincronizando[div.cod_item]" class="px-3 py-1.5 bg-variacao hover:opacity-90 disabled:opacity-50 text-white text-[10px] font-medium rounded-md transition-all flex items-center gap-1 shrink-0">
            <Loader2 v-if="sincronizando[div.cod_item]" class="w-3 h-3 animate-spin" />
            <span v-else>Sincronizar</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loadingLmc" class="py-16 flex flex-col items-center justify-center text-center">
      <Loader2 class="w-8 h-8 animate-spin text-bronze mb-3" :stroke-width="1.7" />
      <p class="text-[13px] text-risco">Carregando auditoria do LMC...</p>
    </div>

    <!-- Vazio -->
    <div v-else-if="!lmcKpis.length" class="bg-sheet border border-line rounded-md p-12 text-center card-shadow">
      <p class="text-[13px] text-risco">Nenhum combustível com registro de LMC (1300) neste período.</p>
    </div>

    <!-- Accordion por Combustível -->
    <div v-else class="space-y-2">
      <div v-for="comb in lmcKpis" :key="comb.cod" class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">

        <div @click="toggleFuel(comb.cod)" class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-paper transition-colors select-none">
          <div class="flex items-center gap-3">
            <ChevronRight class="w-3.5 h-3.5 text-risco transition-transform duration-200" :class="expandedFuels[comb.cod] ? 'rotate-90' : ''" :stroke-width="2" />
            <div class="w-1 h-5 bg-bronze rounded-full"></div>
            <span class="text-[13px] font-medium text-ink uppercase tracking-[-0.01em]">{{ comb.nome }}</span>
            <span class="text-[9px] font-mono text-risco bg-paper px-1.5 py-0.5 rounded-full border border-line">{{ comb.cod }}</span>
          </div>

          <div class="flex items-center gap-2 ml-4 flex-wrap justify-end">
            <div class="flex flex-col items-end">
              <span class="text-[8px] uppercase text-risco font-medium tracking-wide">Est. Inicial</span>
              <div v-if="editingStock[comb.cod] === undefined" class="flex items-center gap-1">
                <span class="text-[12px] font-mono text-ink tabular-nums">{{ formatNumber(comb.estoqueInicial) }}</span>
                <button @click.stop="toggleEditStock(comb.cod, comb.estoqueInicial)" class="text-risco hover:text-bronze transition-colors leading-none" title="Ajustar estoque inicial">
                  <Pencil class="w-3 h-3" :stroke-width="1.8" />
                </button>
              </div>
              <div v-else class="flex items-center gap-1" @click.stop>
                <input v-model="editingStock[comb.cod]" type="number" step="0.001" class="bg-sheet border border-line rounded px-2 py-0.5 text-[12px] font-mono focus:border-bronze outline-none w-28">
                <button @click.stop="saveInitialStock(comb.cod)" :disabled="savingStock" class="bg-conforme text-white rounded px-2 py-0.5 text-[12px] hover:opacity-90 disabled:opacity-50 transition-colors">
                  <Loader2 v-if="savingStock" class="w-3 h-3 animate-spin inline" />
                  <span v-else>Salvar</span>
                </button>
                <button @click.stop="delete editingStock[comb.cod]" class="text-risco hover:text-ink px-1"><X class="w-3 h-3" :stroke-width="2" /></button>
              </div>
            </div>
            <div class="w-px h-6 bg-line"></div>
            <div class="flex flex-col items-end">
              <span class="text-[8px] uppercase text-conforme font-medium tracking-wide">Entradas</span>
              <span class="text-[12px] font-mono text-ink tabular-nums">+{{ formatNumber(comb.totalEntradas) }}</span>
            </div>
            <div class="w-px h-6 bg-line"></div>
            <div class="flex flex-col items-end">
              <span class="text-[8px] uppercase text-variacao font-medium tracking-wide">Saídas</span>
              <span class="text-[12px] font-mono text-ink tabular-nums">-{{ formatNumber(comb.totalSaidas) }}</span>
            </div>
            <div class="w-px h-6 bg-line"></div>
            <div class="flex flex-col items-end">
              <span class="text-[8px] uppercase text-risco font-medium tracking-wide">Quebra</span>
              <span class="text-[12px] font-mono tabular-nums" :class="comb.quebraLiquida >= 0 ? 'text-conforme' : 'text-lacre'">
                {{ comb.quebraLiquida > 0 ? '+' : '' }}{{ formatNumber(comb.quebraLiquida) }} L
              </span>
            </div>
            <div class="w-px h-6 bg-line"></div>
            <div class="flex flex-col items-end">
              <span class="text-[8px] uppercase text-risco font-medium tracking-wide">Saldo M+1</span>
              <span class="text-[12px] font-mono text-ink tabular-nums">{{ formatNumber(comb.estoqueFinal) }}</span>
            </div>
            <div class="w-px h-6 bg-line"></div>
            <span class="px-2 py-1 rounded-md text-[9px] font-medium uppercase flex items-center gap-1"
                  :class="comb.irregularidades > 0 ? 'bg-lacre/10 text-lacre border border-lacre/20' : 'bg-conforme/10 text-conforme border border-conforme/20'">
              <template v-if="comb.irregularidades > 0">{{ comb.irregularidades }} Irreg.</template>
              <template v-else><CheckCircle2 class="w-3 h-3" :stroke-width="2" /> Conforme</template>
            </span>
            <button @click.stop="openOtimizador(comb)" class="px-2 py-1 bg-bronze/10 text-bronze hover:bg-bronze/20 rounded-md transition-all border border-bronze/20" title="Distribuição inteligente (otimizador)">
              <Zap class="w-3.5 h-3.5" :stroke-width="1.8" />
            </button>
          </div>
        </div>

        <!-- Tabela expandível -->
        <div v-if="expandedFuels[comb.cod]" class="border-t border-line">
          <div class="overflow-x-auto">
            <table class="min-w-full text-left">
              <thead class="bg-paper border-b border-line">
                <tr class="text-[9px] text-risco uppercase font-medium tracking-wide">
                  <th class="px-4 py-2.5 whitespace-nowrap">Data</th>
                  <th class="px-4 py-2.5 text-center whitespace-nowrap">Capacidade</th>
                  <th class="px-4 py-2.5 text-right whitespace-nowrap">Est. Inicial</th>
                  <th class="px-4 py-2.5 text-right whitespace-nowrap">Entradas</th>
                  <th class="px-4 py-2.5 text-right text-variacao whitespace-nowrap">Saídas</th>
                  <th class="px-4 py-2.5 text-right whitespace-nowrap">Escritural</th>
                  <th class="px-4 py-2.5 text-right whitespace-nowrap">Físico</th>
                  <th class="px-4 py-2.5 text-right border-l border-line whitespace-nowrap">Diferença (L)</th>
                  <th class="px-4 py-2.5 text-right whitespace-nowrap">Var %</th>
                  <th class="px-4 py-2.5 text-right text-lacre whitespace-nowrap">Excesso</th>
                  <th class="px-4 py-2.5 text-center whitespace-nowrap">Status ANP</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr v-for="item in lmcDoCombustivel(comb.cod)" :key="item.id_movimento" class="hover:bg-paper transition-colors">
                  <td class="px-4 py-2 font-mono text-[11px] text-risco">{{ new Date(item.data_movimento).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) }}</td>
                  <td class="px-4 py-2 text-center font-mono text-[11px] text-risco">{{ item.capacidade_tanque > 0 ? formatNumber(item.capacidade_tanque) + ' L' : '—' }}</td>
                  <td class="px-4 py-2 text-right font-mono text-[12px] text-risco">{{ formatNumber(item.estq_abert_final || item.estq_abert) }}</td>
                  <td class="px-4 py-2 text-right font-mono text-[12px] text-conforme">{{ formatNumber(item.vol_entr_lmc) }}</td>
                  <td class="px-4 py-2 text-right font-mono text-[12px] text-variacao bg-variacao/5">
                    <div v-if="editingSaida[`${item.cod_item}|${item.data_movimento}`] === undefined" class="flex items-center justify-end gap-1">
                      <span>{{ formatNumber(item.vol_saidas_final) }}</span>
                      <button @click="toggleEditSaida(item.cod_item, item.data_movimento, item.vol_saidas_final)" class="text-risco hover:text-variacao transition-colors" title="Editar saída deste dia">
                        <Pencil class="w-3 h-3" :stroke-width="1.8" />
                      </button>
                    </div>
                    <div v-else class="flex items-center justify-end gap-1">
                      <input v-model="editingSaida[`${item.cod_item}|${item.data_movimento}`]" type="number" step="0.001" class="bg-sheet border border-variacao/40 rounded px-1.5 py-0.5 text-[12px] font-mono focus:border-variacao outline-none w-24">
                      <button @click="saveEditSaida(item.cod_item, item.data_movimento)" :disabled="savingSaida" class="bg-variacao text-white rounded px-1.5 py-0.5 text-[10px] hover:opacity-90 disabled:opacity-50 transition-colors">
                        <span v-if="savingSaida">...</span><span v-else>OK</span>
                      </button>
                      <button @click="delete editingSaida[`${item.cod_item}|${item.data_movimento}`]" class="text-risco hover:text-ink"><X class="w-3 h-3" :stroke-width="2" /></button>
                    </div>
                  </td>
                  <td class="px-4 py-2 text-right font-mono text-[12px] text-risco">{{ formatNumber(item.estq_escr_final) }}</td>
                  <td class="px-4 py-2 text-right font-mono text-[12px] text-ink">{{ formatNumber(item.fech_fisico_final) }}</td>
                  <td class="px-4 py-2 text-right border-l border-line">
                    <span :class="item.variacao_litros >= 0 ? 'text-conforme' : 'text-lacre'" class="text-[12px] font-mono">
                      {{ item.variacao_litros > 0 ? '+' : '' }}{{ formatNumber(item.variacao_litros) }}
                    </span>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <span :class="item.variacao_percentual > 0.6 ? 'text-lacre bg-lacre/10 px-1.5 py-0.5 rounded' : 'text-risco'" class="text-[11px] font-mono">
                      {{ item.variacao_percentual.toFixed(3) }}%
                    </span>
                  </td>
                  <td class="px-4 py-2 text-right font-mono text-[11px]" :class="item.excesso > 0 ? 'text-lacre' : 'text-line'">
                    {{ item.excesso > 0 ? formatNumber(item.excesso) + ' L' : '—' }}
                  </td>
                  <td class="px-4 py-2 text-center">
                    <span v-if="item.status_anp === 'CONFORME'" class="px-2 py-0.5 bg-conforme/10 text-conforme text-[9px] font-medium rounded border border-conforme/20">OK</span>
                    <span v-else-if="item.status_anp === 'FORA LIMITE'" class="px-2 py-0.5 bg-lacre/10 text-lacre text-[9px] font-medium rounded border border-lacre/20">FORA LIMITE</span>
                    <span v-else-if="item.status_anp === 'EXCESSO'" class="px-2 py-0.5 bg-variacao/10 text-variacao text-[9px] font-medium rounded border border-variacao/20">EXCESSO</span>
                    <span v-else class="px-2 py-0.5 bg-graphite text-white text-[9px] font-medium rounded">NEGATIVO</span>
                  </td>
                </tr>
                <tr v-if="lmcDoCombustivel(comb.cod).length === 0">
                  <td colspan="11" class="py-8 text-center text-risco italic text-[13px]">Nenhum registro encontrado para este combustível.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== MODAIS ===================== -->

    <!-- Otimizador (Distribuição Inteligente) -->
    <div v-if="showOtimizadorModal" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-[70] p-4">
      <div class="bg-sheet rounded-md border border-line p-10 max-w-xl w-full card-shadow space-y-8 relative overflow-hidden">
        <div class="relative z-10 flex justify-between items-start">
          <div class="space-y-1">
            <div class="inline-flex items-center gap-2 px-3 py-1 bg-bronze/10 rounded-full">
              <span class="w-1.5 h-1.5 bg-bronze rounded-full"></span>
              <span class="text-[10px] font-medium text-bronze uppercase tracking-wide">Motor Matemático V2</span>
            </div>
            <h3 class="font-display text-[22px] font-semibold text-ink tracking-[-0.01em]">Distribuição Inteligente</h3>
            <p class="text-[13px] text-risco leading-relaxed">
              Reconstruir medições e vendas para: <span class="bg-paper px-2 py-0.5 rounded font-medium text-ink">{{ productToOtimizar?.nome }}</span>
            </p>
          </div>
          <button @click="showOtimizadorModal = false" class="w-10 h-10 bg-paper hover:bg-line/50 rounded-full flex items-center justify-center text-risco transition-colors"><X class="w-5 h-5" :stroke-width="1.8" /></button>
        </div>
        <div class="relative z-10 bg-paper rounded-md p-8 border border-line space-y-6">
          <div class="space-y-4">
            <div class="flex justify-between items-end">
              <label class="text-[10px] font-medium uppercase text-risco tracking-wide leading-none">Meta de volume mensal (vendas)</label>
              <span class="text-[9px] font-mono text-risco">Referência atual: {{ formatNumber(productToOtimizar?.totalSaidas) }} L</span>
            </div>
            <div class="relative">
              <input v-model.number="targetVolume" type="number" step="0.001" class="w-full bg-sheet border border-line focus:border-bronze rounded-md px-6 py-5 text-2xl font-mono tabular-nums text-ink transition-all outline-none">
              <div class="absolute right-6 top-1/2 -translate-y-1/2 text-[13px] font-medium text-risco">LITROS</div>
            </div>
          </div>
          <div class="bg-bronze/5 rounded-md p-5 border border-bronze/20 flex items-start gap-4">
            <ShieldCheck class="w-6 h-6 text-bronze shrink-0 mt-0.5" :stroke-width="1.7" />
            <div class="space-y-1">
              <p class="text-[10px] font-medium text-bronze uppercase tracking-wide">Garantia de conformidade</p>
              <p class="text-[12px] text-risco leading-relaxed">
                O motor aplicará ruído orgânico artificial respeitando a variação legal de <b>0,55%</b> e ajustará as medições automaticamente para este volume.
              </p>
            </div>
          </div>
        </div>
        <div class="relative z-10 flex gap-4">
          <button @click="showOtimizadorModal = false" :disabled="savingOtimizacao" class="flex-1 py-5 text-risco font-medium hover:bg-paper rounded-md transition-all uppercase tracking-wide text-[12px]">Cancelar</button>
          <button @click="startOtimizacao" :disabled="savingOtimizacao" class="flex-[2] py-5 bg-graphite text-white font-medium rounded-md hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-3 uppercase tracking-wide text-[12px]">
            <Loader2 v-if="savingOtimizacao" class="w-5 h-5 animate-spin" />
            <Zap v-else class="w-4 h-4" :stroke-width="1.8" />
            {{ savingOtimizacao ? 'Distribuindo...' : 'Iniciar distribuição' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Configuração de Tanques -->
    <div v-if="showLmcConfigModal" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-[80] p-4">
      <div class="bg-sheet rounded-md border border-line p-8 max-w-xl w-full card-shadow space-y-6">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="font-display text-[22px] font-semibold text-ink tracking-[-0.01em] flex items-center gap-2"><Settings2 class="w-5 h-5 text-bronze" :stroke-width="1.7" /> Configuração de tanques</h3>
            <p class="text-[13px] text-risco">Defina a capacidade máxima de armazenamento para cada produto.</p>
          </div>
          <button @click="showLmcConfigModal = false" class="w-10 h-10 bg-paper hover:bg-line/50 rounded-full flex items-center justify-center text-risco transition-colors"><X class="w-5 h-5" :stroke-width="1.8" /></button>
        </div>
        <div class="max-h-[400px] overflow-y-auto pr-2 space-y-4">
          <div v-for="conf in tankConfigs" :key="conf.cod_item" class="bg-paper p-4 rounded-md border flex items-center justify-between gap-4" :class="conf.fromSped ? 'border-bronze/30 bg-bronze/5' : 'border-line'">
            <div class="flex flex-col">
              <div class="flex items-center gap-2">
                <span class="text-[12px] font-medium text-ink">{{ conf.descr_item }}</span>
                <span v-if="conf.fromSped" title="Capacidade detectada automaticamente do arquivo SPED" class="text-[8px] font-medium text-conforme bg-conforme/15 px-1.5 py-0.5 rounded-full uppercase tracking-wide">SPED</span>
              </div>
              <span class="text-[9px] font-mono text-risco">COD: {{ conf.cod_item }}</span>
            </div>
            <div class="relative w-40">
              <input v-model.number="conf.capacidade" type="number" step="0" @input="conf.fromSped = false" class="w-full bg-sheet border focus:border-bronze rounded-md px-4 py-2 text-right font-mono tabular-nums text-ink transition-all outline-none text-[13px]" :class="conf.fromSped ? 'border-bronze/40' : 'border-line'">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[8px] font-medium text-risco uppercase">Litros</span>
            </div>
          </div>
        </div>
        <div class="bg-variacao/10 rounded-md p-4 border border-variacao/20 flex items-start gap-3">
          <Lightbulb class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.7" />
          <p class="text-[10px] text-ink leading-relaxed">As capacidades são usadas para validar o <b>Status ANP</b> e identificar excessos de estoque no LMC.</p>
        </div>
        <div class="flex gap-3 mt-2">
          <button @click="showLmcConfigModal = false" class="flex-1 py-4 text-risco font-medium hover:bg-paper rounded-md transition-colors uppercase tracking-wide text-[12px]">Cancelar</button>
          <button @click="saveLmcConfig" :disabled="savingLmcConfig" class="flex-[2] py-4 bg-graphite text-white font-medium rounded-md hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-wide text-[12px]">
            <Loader2 v-if="savingLmcConfig" class="w-4 h-4 animate-spin" />
            {{ savingLmcConfig ? 'Salvando...' : 'Salvar capacidades' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Lacres das Bombas -->
    <div v-if="showLacresModal" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-[80] p-4">
      <div class="bg-sheet rounded-md border border-line p-8 max-w-2xl w-full card-shadow space-y-6 max-h-[90vh] flex flex-col">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="font-display text-[22px] font-semibold text-ink tracking-[-0.01em] flex items-center gap-2"><Lock class="w-5 h-5 text-bronze" :stroke-width="1.7" /> Lacres das bombas</h3>
            <p class="text-[13px] text-risco">Informe os lacres de cada bomba (registro 1360). São injetados no SPED ao exportar.</p>
          </div>
          <button @click="showLacresModal = false" class="w-10 h-10 bg-paper hover:bg-line/50 rounded-full flex items-center justify-center text-risco transition-colors"><X class="w-5 h-5" :stroke-width="1.8" /></button>
        </div>
        <div v-if="!lacresBombas.length" class="text-[13px] text-risco italic py-6 text-center">Nenhuma bomba (registro 1350) encontrada neste arquivo.</div>
        <div class="overflow-y-auto pr-2 space-y-4 flex-1">
          <div v-for="(b, bi) in lacresBombas" :key="bi" class="bg-paper p-4 rounded-md border border-line space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex flex-col">
                <span class="text-[12px] font-medium text-ink">Bomba: {{ b.serie }}</span>
                <span class="text-[9px] font-mono text-risco">{{ b.fabricante }} · {{ b.modelo }}</span>
              </div>
              <span v-if="b.temLacre" class="text-[8px] font-medium text-conforme bg-conforme/15 px-1.5 py-0.5 rounded-full uppercase tracking-wide">já tem 1360</span>
              <span v-else class="text-[8px] font-medium text-lacre bg-lacre/15 px-1.5 py-0.5 rounded-full uppercase tracking-wide">sem lacre</span>
            </div>
            <div v-for="(l, li) in b.lacres" :key="li" class="flex items-center gap-2">
              <input v-model="l.num_lacre" placeholder="Nº do lacre" class="flex-1 bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] text-ink outline-none transition-all" />
              <input v-model="l.dt_aplicacao" placeholder="DDMMAAAA" maxlength="8" class="w-32 bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] font-mono text-center text-ink outline-none transition-all" />
              <button @click="removeLacre(b, li)" class="w-8 h-8 shrink-0 bg-paper hover:bg-lacre/10 hover:text-lacre rounded-md text-risco transition-colors flex items-center justify-center" title="Remover lacre"><X class="w-4 h-4" :stroke-width="1.8" /></button>
            </div>
            <button @click="addLacre(b)" class="text-[10px] font-medium text-bronze hover:underline">+ adicionar lacre</button>
          </div>
        </div>
        <div class="bg-variacao/10 rounded-md p-4 border border-variacao/20 flex items-start gap-3">
          <Lightbulb class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.7" />
          <p class="text-[10px] text-ink leading-relaxed">O nº do lacre e a data (DDMMAAAA) são os do lacre físico aplicado na bomba. O PVA exige ao menos um lacre (1360) por bomba (1350).</p>
        </div>
        <div class="flex gap-3">
          <button @click="showLacresModal = false" class="flex-1 py-4 text-risco font-medium hover:bg-paper rounded-md transition-colors uppercase tracking-wide text-[12px]">Cancelar</button>
          <button @click="saveLacres" :disabled="savingLacres" class="flex-[2] py-4 bg-graphite text-white font-medium rounded-md hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-wide text-[12px]">
            <Loader2 v-if="savingLacres" class="w-4 h-4 animate-spin" />
            {{ savingLacres ? 'Salvando...' : 'Salvar lacres' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Credenciadoras (1601) -->
    <div v-if="showCredModal" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-[80] p-4">
      <div class="bg-sheet rounded-md border border-line p-8 max-w-3xl w-full card-shadow space-y-6 max-h-[90vh] flex flex-col">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="font-display text-[22px] font-semibold text-ink tracking-[-0.01em] flex items-center gap-2"><CreditCard class="w-5 h-5 text-bronze" :stroke-width="1.7" /> Credenciadoras (1601)</h3>
            <p class="text-[13px] text-risco">Dados das maquininhas/credenciadoras p/ gerar o registro 0150. Município e Endereço são obrigatórios.</p>
          </div>
          <button @click="showCredModal = false" class="w-10 h-10 bg-paper hover:bg-line/50 rounded-full flex items-center justify-center text-risco transition-colors"><X class="w-5 h-5" :stroke-width="1.8" /></button>
        </div>
        <div v-if="!credList.length" class="text-[13px] text-risco italic py-6 text-center">Nenhuma credenciadora do 1601 sem 0150 neste arquivo.</div>
        <div class="overflow-y-auto pr-2 space-y-4 flex-1">
          <div v-for="(c, ci) in credList" :key="ci" class="bg-paper p-4 rounded-md border border-line space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-[9px] font-mono text-risco">CNPJ</span>
              <span class="text-[12px] font-mono text-ink">{{ c.cnpj }}</span>
            </div>
            <input v-model="c.nome" placeholder="Razão social" class="w-full bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] text-ink outline-none" />
            <div class="grid grid-cols-2 gap-2">
              <input v-model="c.cod_mun" placeholder="Cód. município IBGE (7 díg) *" maxlength="7" class="bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] font-mono text-ink outline-none" />
              <input v-model="c.ie" placeholder="IE (deixe vazio p/ credenciadora)" class="bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] text-ink outline-none" />
            </div>
            <input v-model="c.endereco" placeholder="Endereço (logradouro) *" class="w-full bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] text-ink outline-none" />
            <div class="grid grid-cols-2 gap-2">
              <input v-model="c.num" placeholder="Número" class="bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] text-ink outline-none" />
              <input v-model="c.bairro" placeholder="Bairro" class="bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2 text-[12px] text-ink outline-none" />
            </div>
          </div>
        </div>
        <div v-if="credList.length && dadosPosto && (dadosPosto.cod_mun || dadosPosto.endereco)" class="flex items-center justify-between gap-3 bg-bronze/5 rounded-md p-3 border border-bronze/20">
          <p class="text-[10px] text-ink leading-snug">Sem o endereço da credenciadora? Use os dados do próprio posto <span class="font-mono">({{ dadosPosto.cod_mun }} · {{ dadosPosto.endereco }})</span> — o 0150 fica válido no PVA.</p>
          <button @click="usarDadosPosto" type="button" class="shrink-0 px-3 py-1.5 bg-bronze hover:opacity-90 text-white rounded-md text-[10px] font-medium uppercase tracking-wide transition-colors flex items-center gap-1.5">
            <Store class="w-3.5 h-3.5" :stroke-width="1.8" /> Usar dados do posto
          </button>
        </div>
        <div class="bg-variacao/10 rounded-md p-4 border border-variacao/20 flex items-start gap-3">
          <Lightbulb class="w-5 h-5 text-variacao shrink-0" :stroke-width="1.7" />
          <p class="text-[10px] text-ink leading-relaxed">O 0150 só é injetado para credenciadoras com <b>Código de município</b> e <b>Endereço</b> preenchidos (obrigatórios no PVA). Os dados são reaproveitados em todos os arquivos.</p>
        </div>
        <div class="flex gap-3">
          <button @click="showCredModal = false" class="flex-1 py-4 text-risco font-medium hover:bg-paper rounded-md transition-colors uppercase tracking-wide text-[12px]">Cancelar</button>
          <button @click="saveCred" :disabled="savingCred || !credList.length" class="flex-[2] py-4 bg-graphite text-white font-medium rounded-md hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-wide text-[12px]">
            <Loader2 v-if="savingCred" class="w-4 h-4 animate-spin" />
            {{ savingCred ? 'Salvando...' : 'Salvar credenciadoras' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Apuração ICMS (E116) -->
    <div v-if="showE116Modal" class="fixed inset-0 bg-ink/40 flex items-center justify-center z-[80] p-4">
      <div class="bg-sheet rounded-md border border-line p-8 max-w-lg w-full card-shadow space-y-6">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="font-display text-[22px] font-semibold text-ink tracking-[-0.01em] flex items-center gap-2"><Receipt class="w-5 h-5 text-bronze" :stroke-width="1.7" /> Apuração ICMS (E116)</h3>
            <p class="text-[13px] text-risco">Para gerar o E116 ausente quando o E110 tem ICMS a recolher.</p>
          </div>
          <button @click="showE116Modal = false" class="w-10 h-10 bg-paper hover:bg-line/50 rounded-full flex items-center justify-center text-risco transition-colors"><X class="w-5 h-5" :stroke-width="1.8" /></button>
        </div>
        <div class="space-y-3">
          <div>
            <label class="text-[10px] font-medium text-risco uppercase tracking-wide">Código de receita (COD_REC)</label>
            <input v-model="e116Cad.cod_rec" placeholder="ex.: 0767" maxlength="10" class="w-full mt-1 bg-sheet border border-line focus:border-bronze rounded-md px-3 py-2.5 text-[13px] font-mono text-ink outline-none" />
            <p class="text-[10px] text-risco mt-1 italic">Padrão <b>0767</b> (ICMS REGIME NORMAL). Confirme no seu DARE/ERP se usar outro.</p>
          </div>
        </div>
        <div class="bg-conforme/10 rounded-md p-4 border border-conforme/20 flex items-start gap-3">
          <CheckCircle2 class="w-5 h-5 text-conforme shrink-0" :stroke-width="1.7" />
          <p class="text-[10px] text-ink leading-relaxed">Automático ao re-exportar: <b>COD_OR=000</b>; <b>valor</b> = ICMS a recolher do E110; <b>vencimento</b> = último dia do mês de apuração; <b>mês de referência</b> = período do SPED. Você só confirma o COD_REC.</p>
        </div>
        <div class="flex gap-3">
          <button @click="showE116Modal = false" class="flex-1 py-4 text-risco font-medium hover:bg-paper rounded-md transition-colors uppercase tracking-wide text-[12px]">Cancelar</button>
          <button @click="saveE116" :disabled="savingE116 || !e116Cad.cod_rec" class="flex-[2] py-4 bg-graphite text-white font-medium rounded-md hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 uppercase tracking-wide text-[12px]">
            <Loader2 v-if="savingE116" class="w-4 h-4 animate-spin" />
            {{ savingE116 ? 'Salvando...' : 'Salvar apuração' }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.card-shadow { box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07); }
</style>
