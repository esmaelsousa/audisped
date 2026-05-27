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
const carregando = ref(false)

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
}

function gerarPDF() {
    if (!arquivoSelecionado.value) return
    const token = localStorage.getItem('token')
    const params = new URLSearchParams()
    if (combustivelSelecionado.value !== 'todos') params.set('combustivel', combustivelSelecionado.value)
    if (dataInicio.value) params.set('data_inicio', dataInicio.value)
    if (dataFim.value) params.set('data_fim', dataFim.value)
    if (folhaInicial.value > 1) params.set('folha_inicial', folhaInicial.value)

    const url = `${API_BASE_URL}/api/lmc/imprimir/${arquivoSelecionado.value}?${params.toString()}`
    window.open(`${url}&token=${token}`, '_blank')
}
</script>

<template>
    <div class="p-6 max-w-2xl mx-auto">
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

            <!-- Folha Inicial -->
            <div v-if="arquivoSelecionado">
                <label class="block text-xs font-semibold text-slate-600 mb-1">Número da Folha Inicial</label>
                <input type="number" v-model="folhaInicial" min="1"
                    class="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent" />
                <p class="text-[10px] text-slate-400 mt-1">Ex: se o livro anterior terminou na Fl. 120, inicie na 121</p>
            </div>

            <!-- Botão Gerar -->
            <div v-if="arquivoSelecionado" class="pt-2">
                <button @click="gerarPDF"
                    class="flex items-center gap-2 px-6 py-2.5 bg-brand-accent hover:bg-blue-600 text-white text-sm font-bold rounded-xl shadow-lg transition-all">
                    <FileText class="w-4 h-4" />
                    Gerar PDF do LMC
                </button>
            </div>
        </div>
    </div>
</template>
