<script setup>
import { ref, onMounted, watch } from 'vue'
import axios from 'axios'
import { Printer, FileText } from 'lucide-vue-next'
import { empresaSelecionada as empresaStore, arquivoInfo as arquivoStore } from '../store'

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
    <div class="p-6 max-w-4xl mx-auto">
        <div class="flex items-center gap-3 mb-6">
            <Printer class="w-6 h-6 text-brand-accent" />
            <h1 class="text-xl font-bold text-slate-800">Impressão do LMC</h1>
        </div>

        <div class="bg-white rounded-2xl shadow-md p-6 space-y-5">
            <!-- Empresa -->
            <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Empresa</label>
                <select v-model="empresaSelecionada" @change="carregarArquivos"
                    class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent">
                    <option :value="null">Selecione a empresa...</option>
                    <option v-for="emp in empresas" :key="emp.id" :value="emp.id">
                        {{ emp.nome_fantasia || emp.nome_empresa }} — {{ emp.cnpj }}
                    </option>
                </select>
            </div>

            <!-- Período (Arquivo SPED) -->
            <div v-if="arquivos.length > 0">
                <label class="block text-xs font-semibold text-slate-600 mb-1">Período (Arquivo SPED)</label>
                <select v-model="arquivoSelecionado" @change="carregarCombustiveis"
                    class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent">
                    <option :value="null">Selecione o período...</option>
                    <option v-for="arq in arquivos" :key="arq.id" :value="arq.id">
                        {{ arq.periodo_apuracao }}
                    </option>
                </select>
            </div>

            <!-- Combustível -->
            <div v-if="combustiveis.length > 0">
                <label class="block text-xs font-semibold text-slate-600 mb-1">Combustível</label>
                <select v-model="combustivelSelecionado"
                    class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent">
                    <option value="todos">Todos os combustíveis</option>
                    <option v-for="comb in combustiveis" :key="comb.cod" :value="comb.cod">
                        {{ comb.nome }} ({{ comb.cod }})
                    </option>
                </select>
            </div>

            <!-- Datas -->
            <div v-if="arquivoSelecionado" class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Data Início</label>
                    <input type="date" v-model="dataInicio"
                        class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent" />
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Data Fim</label>
                    <input type="date" v-model="dataFim"
                        class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent" />
                </div>
            </div>

            <!-- Resumo por Combustível — Cards -->
            <div v-if="resumo.length > 0" class="space-y-3">
                <div class="flex items-center gap-2 mb-1">
                    <p class="text-sm font-bold text-slate-700">Resumo do Período</p>
                </div>

                <div v-for="r in resumo" :key="r.cod" class="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div class="bg-gradient-to-r from-slate-700 to-slate-800 px-4 py-2 flex items-center justify-between">
                        <span class="text-sm font-bold text-white">{{ r.nome }}</span>
                        <span :class="r.saidas > 0 && (Math.abs(r.perdas - r.ganhos) / r.saidas * 100) > 0.6 ? 'bg-red-500 text-white' : 'bg-green-500 text-white'" class="text-xs font-bold px-2.5 py-0.5 rounded-full">
                            ANP {{ r.saidas > 0 ? (Math.abs(r.perdas - r.ganhos) / r.saidas * 100).toFixed(2).replace('.', ',') + '%' : '-' }}
                        </span>
                    </div>
                    <div class="grid grid-cols-4 gap-px bg-slate-100">
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-slate-500 font-semibold uppercase">Estoque Inicial</p>
                            <p class="text-base font-black text-slate-800 font-mono">{{ r.aberturaInicial !== null ? r.aberturaInicial.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '-' }}</p>
                        </div>
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-green-600 font-semibold uppercase">Entradas</p>
                            <p class="text-base font-black text-green-700 font-mono">{{ r.entradas.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                        </div>
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-red-500 font-semibold uppercase">Saídas</p>
                            <p class="text-base font-black text-red-600 font-mono">{{ r.saidas.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                        </div>
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-slate-500 font-semibold uppercase">Estoque Final</p>
                            <p class="text-base font-black text-slate-800 font-mono">{{ r.fechamentoFinal !== null ? r.fechamentoFinal.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '-' }}</p>
                        </div>
                        <div class="bg-white px-4 py-2.5 text-center">
                            <p class="text-[10px] text-orange-500 font-semibold uppercase">Perdas</p>
                            <p class="text-sm font-bold text-orange-600 font-mono">{{ r.perdas.toFixed(1).replace('.', ',') }}</p>
                        </div>
                        <div class="bg-white px-4 py-2.5 text-center">
                            <p class="text-[10px] text-blue-500 font-semibold uppercase">Ganhos</p>
                            <p class="text-sm font-bold text-blue-600 font-mono">{{ r.ganhos.toFixed(1).replace('.', ',') }}</p>
                        </div>
                        <div class="bg-white px-4 py-2.5 text-center">
                            <p class="text-[10px] text-slate-500 font-semibold uppercase">Variação</p>
                            <p class="text-sm font-bold font-mono" :class="(r.ganhos - r.perdas) >= 0 ? 'text-blue-600' : 'text-red-600'">{{ (r.ganhos - r.perdas).toFixed(1).replace('.', ',') }}</p>
                        </div>
                        <div class="bg-white px-4 py-2.5 text-center">
                            <p class="text-[10px] text-slate-500 font-semibold uppercase">Dias</p>
                            <p class="text-sm font-bold text-slate-700 font-mono">{{ r.dias }}</p>
                        </div>
                    </div>
                </div>

                <!-- Totais gerais -->
                <div class="border-2 border-slate-300 rounded-xl overflow-hidden">
                    <div class="bg-slate-800 px-4 py-2">
                        <span class="text-sm font-black text-white">TOTAIS GERAIS</span>
                    </div>
                    <div class="grid grid-cols-4 gap-px bg-slate-200">
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-green-600 font-semibold uppercase">Total Entradas</p>
                            <p class="text-lg font-black text-green-700 font-mono">{{ resumo.reduce((s,r) => s + r.entradas, 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                        </div>
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-red-500 font-semibold uppercase">Total Saídas</p>
                            <p class="text-lg font-black text-red-600 font-mono">{{ resumo.reduce((s,r) => s + r.saidas, 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') }}</p>
                        </div>
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-orange-500 font-semibold uppercase">Total Perdas</p>
                            <p class="text-lg font-black text-orange-600 font-mono">{{ resumo.reduce((s,r) => s + r.perdas, 0).toFixed(1).replace('.', ',') }}</p>
                        </div>
                        <div class="bg-white px-4 py-3 text-center">
                            <p class="text-[10px] text-blue-500 font-semibold uppercase">Total Ganhos</p>
                            <p class="text-lg font-black text-blue-600 font-mono">{{ resumo.reduce((s,r) => s + r.ganhos, 0).toFixed(1).replace('.', ',') }}</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Folha Inicial -->
            <div v-if="arquivoSelecionado">
                <label class="block text-xs font-semibold text-slate-600 mb-1">Número da Folha Inicial</label>
                <input type="number" v-model="folhaInicial" min="1"
                    class="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent" />
                <p class="text-[10px] text-slate-400 mt-1">Ex: se o livro anterior terminou na Fl. 120, inicie na 121</p>
            </div>

            <!-- Observações -->
            <div v-if="arquivoSelecionado">
                <label class="block text-xs font-semibold text-slate-600 mb-1">Observações (Campo 13 do LMC)</label>
                <textarea v-model="observacao" rows="3" placeholder="Digite observações que serão impressas no campo 13 do LMC..."
                    class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent resize-none"></textarea>
                <p class="text-[10px] text-slate-400 mt-1">Será salva e impressa no campo "13) Observações" de cada página do período</p>
            </div>

            <!-- Botão Gerar -->
            <div v-if="arquivoSelecionado" class="pt-2">
                <button @click="gerarPDF" :disabled="salvandoObs"
                    class="flex items-center gap-2 px-6 py-2.5 bg-brand-accent hover:bg-blue-600 text-white text-sm font-bold rounded-xl shadow-lg transition-all disabled:opacity-50">
                    <FileText class="w-4 h-4" />
                    {{ salvandoObs ? 'Salvando...' : 'Gerar PDF do LMC' }}
                </button>
            </div>
        </div>
    </div>
</template>
