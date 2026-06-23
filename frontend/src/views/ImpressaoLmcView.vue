<script setup>
import { ref, onMounted, watch } from 'vue'
import axios from 'axios'
import { Printer, FileText } from 'lucide-vue-next'
import { empresaSelecionada as empresaStore, arquivoInfo as arquivoStore } from '../store'
import UiButton from '@/components/ui/UiButton.vue'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

const empresas = ref([])
const arquivos = ref([])
const combustiveis = ref([])

const empresaSelecionada = ref(null)
const arquivoSelecionado = ref(null)
const combustivelSelecionado = ref('todos')
const dataInicio = ref('')
const dataFim = ref('')
const folhaInicial = ref(1)
const observacao = ref('')
const carregando = ref(false)
const salvandoObs = ref(false)

onMounted(async () => {
    const token = localStorage.getItem('token')
    try {
        const res = await axios.get(`${API_BASE_URL}/api/empresas`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        empresas.value = res.data || []

        // Pré-selecionar empresa e arquivo se já estão no contexto
        if (empresaStore.value?.id) {
            empresaSelecionada.value = empresaStore.value.id
            await carregarArquivos()
            if (arquivoStore.value?.id) {
                arquivoSelecionado.value = arquivoStore.value.id
                await carregarCombustiveis()
            }
        }
    } catch(e) { console.error('Erro ao carregar empresas:', e) }
})

async function carregarArquivos() {
    if (!empresaSelecionada.value) return
    const token = localStorage.getItem('token')
    try {
        const res = await axios.get(`${API_BASE_URL}/api/arquivos/${empresaSelecionada.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        arquivos.value = (res.data || []).sort((a, b) => a.periodo_apuracao?.localeCompare(b.periodo_apuracao))
    } catch(e) { console.error('Erro ao carregar arquivos:', e) }
}

async function carregarCombustiveis() {
    if (!arquivoSelecionado.value) return
    const token = localStorage.getItem('token')
    try {
        const res = await axios.get(`${API_BASE_URL}/api/lmc/${arquivoSelecionado.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        const cods = new Set()
        const lista = []
        // Filtrar apenas combustíveis (pelo nome ou NCM)
        const termosCombustivel = ['GASOLINA', 'ETANOL', 'DIESEL', 'GNV', 'BIODIESEL', 'QUEROSENE', 'GLP', 'ALCOOL']
        ;(res.data || []).forEach(r => {
            const cod = r.cod_item?.trim()
            const nome = (r.nome_combustivel || '').toUpperCase()
            const ehCombustivel = termosCombustivel.some(t => nome.includes(t))
            if (cod && !cods.has(cod) && ehCombustivel) {
                cods.add(cod)
                lista.push({ cod, nome: r.nome_combustivel || cod })
            }
        })
        combustiveis.value = lista

        // Definir datas do período
        const arq = arquivos.value.find(a => a.id == arquivoSelecionado.value)
        if (arq && arq.periodo_apuracao) {
            const partes = arq.periodo_apuracao.split(' a ')
            if (partes.length === 2) {
                dataInicio.value = partes[0].trim()
                dataFim.value = partes[1].trim()
            }
        }
    } catch(e) { console.error('Erro ao carregar combustíveis:', e) }

    // Carregar resumo
    await carregarResumo()
}

const resumo = ref([])

async function carregarResumo() {
    if (!arquivoSelecionado.value) return
    const token = localStorage.getItem('token')
    try {
        const res = await axios.get(`${API_BASE_URL}/api/lmc/${arquivoSelecionado.value}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        const termosCombustivel = ['GASOLINA', 'ETANOL', 'DIESEL', 'GNV', 'BIODIESEL', 'QUEROSENE', 'GLP', 'ALCOOL']
        const porProduto = {}
        ;(res.data || []).forEach(r => {
            const cod = r.cod_item?.trim()
            const nome = (r.nome_combustivel || '').toUpperCase()
            if (!cod || !termosCombustivel.some(t => nome.includes(t))) return

            if (!porProduto[cod]) {
                porProduto[cod] = {
                    cod, nome: r.nome_combustivel || cod,
                    entradas: 0, saidas: 0, perdas: 0, ganhos: 0, dias: 0,
                    aberturaInicial: null, fechamentoFinal: null
                }
            }
            const p = porProduto[cod]
            const entr = parseFloat(r.vol_entr_lmc || r.vol_entr || 0)
            const saida = parseFloat(r.vol_saidas_final || r.vol_saidas || 0)
            const perda = parseFloat(r.val_perda || 0)
            const ganho = parseFloat(r.val_ganho || 0)
            const abert = parseFloat(r.estq_abert_final || r.estq_abert || 0)
            const fech = parseFloat(r.fech_fisico_final || r.fech_fisico || 0)

            p.entradas += entr
            p.saidas += saida
            p.perdas += perda
            p.ganhos += ganho
            p.dias++
            if (p.aberturaInicial === null) p.aberturaInicial = abert
            p.fechamentoFinal = fech
        })
        resumo.value = Object.values(porProduto)
    } catch(e) { console.error('Erro ao carregar resumo:', e) }
}

async function salvarObservacao() {
    if (!arquivoSelecionado.value || !observacao.value.trim()) return
    const token = localStorage.getItem('token')
    salvandoObs.value = true
    try {
        // Salvar para cada dia do período selecionado e combustível
        const codComb = combustivelSelecionado.value !== 'todos' ? combustivelSelecionado.value : combustiveis.value[0]?.cod
        if (!codComb) return

        const inicio = new Date(dataInicio.value)
        const fim = new Date(dataFim.value)
        for (let d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) {
            const dt = d.toISOString().split('T')[0]
            await axios.post(`${API_BASE_URL}/api/lmc/observacoes`, {
                id_sped_arquivo: arquivoSelecionado.value,
                cod_item: codComb,
                data_mov: dt,
                observacao: observacao.value
            }, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        }
    } catch(e) { console.error('Erro ao salvar observação:', e) }
    finally { salvandoObs.value = false }
}

async function gerarPDF() {
    if (!arquivoSelecionado.value) return

    // Abrir janela ANTES do await (evita bloqueio de popup)
    const token = localStorage.getItem('token')
    const params = new URLSearchParams()
    if (combustivelSelecionado.value !== 'todos') params.set('combustivel', combustivelSelecionado.value)
    if (dataInicio.value) params.set('data_inicio', dataInicio.value)
    if (dataFim.value) params.set('data_fim', dataFim.value)
    if (folhaInicial.value > 1) params.set('folha_inicial', folhaInicial.value)
    const url = `${API_BASE_URL}/api/lmc/imprimir/${arquivoSelecionado.value}?${params.toString()}&token=${token}`

    const win = window.open('about:blank', '_blank')

    // Salvar observação (se preenchida)
    if (observacao.value.trim()) await salvarObservacao()

    // Navegar para o PDF na janela já aberta
    if (win) win.location.href = url
}
</script>

<template>
    <div class="p-4 sm:p-6 max-w-[1200px] mx-auto">
        <header class="flex items-center gap-3 mb-6 border-b border-line pb-5">
            <span class="w-10 h-10 rounded-md border border-line bg-paper flex items-center justify-center text-bronze flex-shrink-0">
                <Printer class="w-5 h-5" :stroke-width="1.7" />
            </span>
            <div class="space-y-0.5">
                <h1 class="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">Impressão do LMC</h1>
                <p class="text-[13px] text-risco">Livro de Movimentação de Combustíveis — filtros e resumo do período.</p>
            </div>
        </header>

        <!-- Layout 2 colunas: Filtros à esquerda | Resumo à direita -->
        <div class="grid grid-cols-1 lg:grid-cols-5 gap-4">

            <!-- COLUNA ESQUERDA: Filtros + Configurações + Botão (2/5) -->
            <div class="lg:col-span-2 space-y-4">
                <div class="bg-sheet border border-line rounded-md p-5 space-y-4 card-shadow">
                    <p class="text-[11px] uppercase tracking-wide text-risco font-medium">Configuração</p>

                    <!-- Empresa -->
                    <div class="space-y-1">
                        <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Empresa</label>
                        <select v-model="empresaSelecionada" @change="carregarArquivos"
                            class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze transition-colors">
                            <option :value="null">Selecione...</option>
                            <option v-for="emp in empresas" :key="emp.id" :value="emp.id">
                                {{ emp.nome_fantasia || emp.nome_empresa }}
                            </option>
                        </select>
                    </div>

                    <!-- Período -->
                    <div v-if="arquivos.length > 0" class="space-y-1">
                        <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Período</label>
                        <select v-model="arquivoSelecionado" @change="carregarCombustiveis"
                            class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze transition-colors">
                            <option :value="null">Selecione...</option>
                            <option v-for="arq in arquivos" :key="arq.id" :value="arq.id">
                                {{ arq.periodo_apuracao }}
                            </option>
                        </select>
                    </div>

                    <!-- Combustível -->
                    <div v-if="combustiveis.length > 0" class="space-y-1">
                        <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Combustível</label>
                        <select v-model="combustivelSelecionado"
                            class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze transition-colors">
                            <option value="todos">Todos os combustíveis</option>
                            <option v-for="comb in combustiveis" :key="comb.cod" :value="comb.cod">
                                {{ comb.nome }}
                            </option>
                        </select>
                    </div>

                    <!-- Datas lado a lado -->
                    <div v-if="arquivoSelecionado" class="grid grid-cols-2 gap-3">
                        <div class="space-y-1">
                            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Data Início</label>
                            <input type="date" v-model="dataInicio"
                                class="w-full bg-sheet border border-line rounded-md px-2.5 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors" />
                        </div>
                        <div class="space-y-1">
                            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Data Fim</label>
                            <input type="date" v-model="dataFim"
                                class="w-full bg-sheet border border-line rounded-md px-2.5 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors" />
                        </div>
                    </div>

                    <!-- Folha Inicial -->
                    <div v-if="arquivoSelecionado" class="space-y-1">
                        <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nº Folha Inicial</label>
                        <input type="number" v-model="folhaInicial" min="1"
                            class="w-24 bg-sheet border border-line rounded-md px-2.5 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors" />
                    </div>

                    <!-- Observações -->
                    <div v-if="arquivoSelecionado" class="space-y-1">
                        <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Observações (Campo 13)</label>
                        <textarea v-model="observacao" rows="2" placeholder="Texto para o campo 13 do LMC..."
                            class="w-full bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze transition-colors resize-none"></textarea>
                    </div>

                    <!-- Botão Gerar -->
                    <div v-if="arquivoSelecionado">
                        <UiButton @click="gerarPDF" :disabled="salvandoObs"
                            class="w-full justify-center py-[9px] disabled:opacity-50">
                            <FileText class="w-4 h-4" :stroke-width="1.8" />
                            {{ salvandoObs ? 'Salvando...' : 'Gerar PDF do LMC' }}
                        </UiButton>
                    </div>
                </div>
            </div>

            <!-- COLUNA DIREITA: Resumo do Período (3/5) -->
            <div class="lg:col-span-3">
                <div v-if="resumo.length > 0" class="space-y-3">

                    <div v-for="r in resumo" :key="r.cod" class="bg-sheet border border-line rounded-md overflow-hidden card-shadow">
                        <div class="bg-graphite px-4 py-2.5 flex items-center justify-between">
                            <span class="font-display text-[13px] font-medium text-white">{{ r.nome }}</span>
                            <span :class="r.saidas > 0 && (Math.abs(r.perdas - r.ganhos) / r.saidas * 100) > 0.6 ? 'bg-lacre/20 text-lacre' : 'bg-conforme/20 text-conforme'" class="font-mono text-[10px] tracking-[.05em] font-medium px-2.5 py-0.5 rounded-[3px]">
                                ANP {{ r.saidas > 0 ? (Math.abs(r.perdas - r.ganhos) / r.saidas * 100).toFixed(2).replace('.', ',') + '%' : '-' }}
                            </span>
                        </div>
                        <div class="grid grid-cols-4 gap-px bg-line">
                            <div class="bg-sheet px-3 py-3 text-center">
                                <p class="text-[10px] text-risco font-medium uppercase tracking-wide">Est. Inicial</p>
                                <p class="text-[15px] font-mono text-ink mt-0.5">{{ r.aberturaInicial !== null ? r.aberturaInicial.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '-' }}</p>
                            </div>
                            <div class="bg-sheet px-3 py-3 text-center">
                                <p class="text-[10px] text-conforme font-medium uppercase tracking-wide">Entradas</p>
                                <p class="text-[15px] font-mono text-conforme mt-0.5">{{ r.entradas.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                            </div>
                            <div class="bg-sheet px-3 py-3 text-center">
                                <p class="text-[10px] text-lacre font-medium uppercase tracking-wide">Saídas</p>
                                <p class="text-[15px] font-mono text-lacre mt-0.5">{{ r.saidas.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                            </div>
                            <div class="bg-sheet px-3 py-3 text-center">
                                <p class="text-[10px] text-risco font-medium uppercase tracking-wide">Est. Final</p>
                                <p class="text-[15px] font-mono text-ink mt-0.5">{{ r.fechamentoFinal !== null ? r.fechamentoFinal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '-' }}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-4 gap-px bg-line border-t border-line">
                            <div class="bg-sheet px-3 py-2 text-center">
                                <p class="text-[9px] text-variacao font-medium uppercase tracking-wide">Perdas</p>
                                <p class="text-[13px] font-mono text-variacao mt-0.5">{{ r.perdas.toFixed(1).replace('.', ',') }}</p>
                            </div>
                            <div class="bg-sheet px-3 py-2 text-center">
                                <p class="text-[9px] text-bronze font-medium uppercase tracking-wide">Ganhos</p>
                                <p class="text-[13px] font-mono text-bronze mt-0.5">{{ r.ganhos.toFixed(1).replace('.', ',') }}</p>
                            </div>
                            <div class="bg-sheet px-3 py-2 text-center">
                                <p class="text-[9px] text-risco font-medium uppercase tracking-wide">Variação</p>
                                <p class="text-[13px] font-mono mt-0.5" :class="(r.ganhos - r.perdas) >= 0 ? 'text-bronze' : 'text-lacre'">{{ (r.ganhos - r.perdas).toFixed(1).replace('.', ',') }}</p>
                            </div>
                            <div class="bg-sheet px-3 py-2 text-center">
                                <p class="text-[9px] text-risco font-medium uppercase tracking-wide">Dias</p>
                                <p class="text-[13px] font-mono text-ink mt-0.5">{{ r.dias }}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Totais -->
                    <div class="bg-graphite rounded-md overflow-hidden card-shadow">
                        <div class="grid grid-cols-4 gap-px">
                            <div class="px-3 py-3 text-center">
                                <p class="text-[9px] text-muted font-medium uppercase tracking-wide">Total Entradas</p>
                                <p class="text-[17px] font-mono text-conforme mt-0.5">{{ resumo.reduce((s,r) => s + r.entradas, 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                            </div>
                            <div class="px-3 py-3 text-center">
                                <p class="text-[9px] text-muted font-medium uppercase tracking-wide">Total Saídas</p>
                                <p class="text-[17px] font-mono text-lacre mt-0.5">{{ resumo.reduce((s,r) => s + r.saidas, 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                            </div>
                            <div class="px-3 py-3 text-center">
                                <p class="text-[9px] text-muted font-medium uppercase tracking-wide">Total Perdas</p>
                                <p class="text-[17px] font-mono text-variacao mt-0.5">{{ resumo.reduce((s,r) => s + r.perdas, 0).toFixed(1).replace('.', ',') }}</p>
                            </div>
                            <div class="px-3 py-3 text-center">
                                <p class="text-[9px] text-muted font-medium uppercase tracking-wide">Total Ganhos</p>
                                <p class="text-[17px] font-mono text-white mt-0.5">{{ resumo.reduce((s,r) => s + r.ganhos, 0).toFixed(1).replace('.', ',') }}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Sem dados -->
                <div v-else-if="arquivoSelecionado" class="bg-sheet border border-line rounded-md p-8 text-center card-shadow">
                    <p class="text-[13px] text-risco">Selecione um período para ver o resumo</p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
</style>
