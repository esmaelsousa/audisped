<script setup>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { useRoute } from 'vue-router'
import { Loader2, TrendingUp, Package, DollarSign, Percent, FileDown } from 'lucide-vue-next'

const route = useRoute();
const loading = ref(true);
const relatorio = ref([]);
const busca = ref('');
const grupoAtivo = ref('COMBUSTÍVEIS');

async function loadRentabilidade() {
    const id = route.params.id;
    if (!id) return;
    
    loading.value = true;
    try {
        const res = await axios.get(`${API_BASE_URL}/api/relatorio/rentabilidade/${id}`);
        relatorio.value = res.data;
    } catch (e) {
        console.error("Erro ao carregar rentabilidade:", e);
    } finally {
        loading.value = false;
    }
}

async function exportPDF() {
    const id = route.params.id;
    if (!id) return;
    
    try {
        const response = await axios.get(`${API_BASE_URL}/api/relatorio/rentabilidade/${id}/pdf?grupo=${grupoAtivo.value}`, {
            responseType: 'blob',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `posicao_estoque_${grupoAtivo.value.toLowerCase()}_${id}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (e) {
        console.error("Erro ao exportar PDF:", e);
        alert("Erro ao gerar PDF do relatório.");
    }
}

const filteredData = computed(() => {
    let data = relatorio.value;
    
    if (grupoAtivo.value !== 'TODOS') {
        data = data.filter(r => r.grupo === grupoAtivo.value);
    }

    if (!busca.value) return data;
    const s = busca.value.toLowerCase();
    return data.filter(r => 
        r.produto.toLowerCase().includes(s) || 
        r.codigo.toLowerCase().includes(s)
    );
});

const stats = computed(() => {
    if (!relatorio.value.length) return { totalVendas: 0, totalCompras: 0, estoqueTotal: 0 };
    
    const totalVendas = relatorio.value.reduce((acc, curr) => acc + curr.qtd_vendida, 0);
    const totalCompras = relatorio.value.reduce((acc, curr) => acc + curr.qtd_comprada, 0);
    const estoqueTotal = relatorio.value.reduce((acc, curr) => acc + curr.estoque_final, 0);

    return { totalVendas, totalCompras, estoqueTotal };
});

onMounted(loadRentabilidade);

const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
const formatNumber = (val, decimals = 2) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(val);
</script>

<template>
  <div class="p-6 space-y-8 animate-fade-in">
    <header class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 class="text-3xl font-extrabold text-slate-800 tracking-tight">
          Posição do <span class="text-emerald-500">Estoque</span>
        </h2>
        <p class="text-slate-500 mt-1">Análise estratégica de giro, custos e movimentação por produto</p>
      </div>
      <div class="flex items-center gap-3">
        <input 
          v-model="busca" 
          type="text" 
          placeholder="Buscar produto ou código..." 
          class="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none w-64 shadow-sm"
        />
        <button 
          @click="exportPDF" 
          class="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-slate-700 transition-all shadow-md active:scale-95"
          title="Exportar Relatório em PDF"
        >
          <FileDown class="w-4 h-4" />
          Exportar PDF
        </button>
        <button @click="loadRentabilidade" class="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
          <Loader2 v-if="loading" class="w-5 h-5 animate-spin text-emerald-500" />
          <span v-else>🔄</span>
        </button>
      </div>
    </header>

    <!-- Filtro de Grupos -->
    <div class="flex p-1 bg-slate-100/50 rounded-2xl w-fit border border-slate-100">
      <button 
        v-for="grupo in ['COMBUSTÍVEIS', 'OUTROS', 'TODOS']" 
        :key="grupo"
        @click="grupoAtivo = grupo"
        class="px-6 py-2 rounded-xl text-xs font-black transition-all"
        :class="grupoAtivo === grupo ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
      >
        {{ grupo }}
      </button>
    </div>

    <!-- Cards de Resumo -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
        <div class="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center">
          <Package class="w-6 h-6" />
        </div>
        <div>
          <p class="text-xs font-bold text-slate-400 uppercase">Volume Total Vendido</p>
          <h3 class="text-2xl font-black text-slate-800">{{ formatNumber(stats.totalVendas) }} L</h3>
        </div>
      </div>
      
      <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
        <div class="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center">
          <TrendingUp class="w-6 h-6" />
        </div>
        <div>
          <p class="text-xs font-bold text-slate-400 uppercase">Volume Comprado</p>
          <h3 class="text-2xl font-black text-slate-800">{{ formatNumber(stats.totalCompras) }} L</h3>
        </div>
      </div>

      <div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
        <div class="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center">
          <DollarSign class="w-6 h-6" />
        </div>
        <div>
          <p class="text-xs font-bold text-slate-400 uppercase">Saldo Total Estoque</p>
          <h3 class="text-2xl font-black text-slate-800">{{ formatNumber(stats.estoqueTotal) }} L</h3>
        </div>
      </div>
    </div>

    <!-- Tabela Principal -->
    <div class="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
      <div v-if="loading" class="p-20 flex flex-col items-center justify-center gap-4">
        <Loader2 class="w-10 h-10 animate-spin text-emerald-500" />
        <p class="text-slate-400 font-medium italic">Cruzando dados de vendas e estoque...</p>
      </div>

      <div v-else-if="filteredData.length === 0" class="p-20 text-center">
        <p class="text-slate-400 font-medium">Nenhum dado encontrado para este período.</p>
      </div>

      <table v-else class="w-full text-left border-collapse">
        <thead class="bg-slate-50/50 border-b border-slate-100">
          <tr>
            <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">Código</th>
            <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider">Produto</th>
            <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Estq. Inicial</th>
            <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Entradas</th>
            <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Venda</th>
            <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Estq. Final</th>
            <th class="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Custo (M)</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-50">
          <tr v-for="item in filteredData" :key="item.codigo" class="hover:bg-slate-50/50 transition-colors group">
            <td class="px-6 py-4 text-[10px] font-mono text-slate-400 max-w-[120px] truncate" :title="item.codigo">
                {{ item.codigo }}
            </td>
            <td class="px-6 py-4">
              <div class="font-bold text-slate-700 text-sm">{{ item.produto }}</div>
            </td>
            <td class="px-6 py-4 text-right text-xs text-slate-500 font-medium">
                {{ formatNumber(item.estoque_inicial) }}
            </td>
            <td class="px-6 py-4 text-right text-xs text-slate-700 font-bold">
                {{ formatNumber(item.qtd_comprada) }}
            </td>
            <td class="px-6 py-4 text-right font-black text-slate-700 text-sm">
                {{ formatNumber(item.qtd_vendida) }}
            </td>
            <td class="px-6 py-4 text-right text-xs font-bold" :class="item.estoque_final < 0 ? 'text-red-500' : 'text-slate-700'">
                {{ formatNumber(item.estoque_final) }}
            </td>
            <td class="px-6 py-4 text-right text-sm font-medium text-slate-600 border-l border-slate-50">
                <div class="flex flex-col items-end">
                    <span>{{ formatCurrency(item.custo_medio) }}</span>
                    <span v-if="item.usou_historico_custo" class="text-[8px] text-slate-400 uppercase font-bold tracking-tighter">Custo Histórico</span>
                </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="text-[10px] text-slate-400 italic text-center pb-8">
      * Preços médios e custos calculados a partir das NF-e (Entradas e Saídas) e do Registro 1300 identificados no SPED.
    </footer>
  </div>
</template>
