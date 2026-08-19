<script setup>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { useRoute } from 'vue-router'
import { Loader2, TrendingUp, Package, DollarSign, Percent, FileDown } from 'lucide-vue-next'
import UiButton from '../components/ui/UiButton.vue'
import { empresaSelecionada, arquivoInfo } from '@/store'

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
        // Nome do arquivo: "Posicao do Estoque_<cnpj>_<AAAA-MM>.pdf".
        // Montado no frontend (CNPJ + período do store) p/ não depender de rebuild do backend.
        const cnpj = String(arquivoInfo.value?.cnpj || empresaSelecionada.value?.cnpj || '').replace(/\D/g, '');
        const periodo = String(arquivoInfo.value?.periodo || '').split(' a ')[0].substring(0, 7); // AAAA-MM
        const sufixo = [cnpj, periodo].filter(Boolean).join('_') || String(id);
        link.setAttribute('download', `Posicao do Estoque_${sufixo}.pdf`);
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
  <div class="max-w-7xl mx-auto p-6 space-y-6 animate-fade-in">
    <header class="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-line pb-5">
      <div class="space-y-1">
        <h2 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">
          Posição do Estoque
        </h2>
        <p class="text-[13px] text-risco">Análise estratégica de giro, custos e movimentação por produto</p>
      </div>
      <div class="flex items-center gap-2.5">
        <input
          v-model="busca"
          type="text"
          placeholder="Buscar produto ou código..."
          class="px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors w-64"
        />
        <UiButton
          @click="exportPDF"
          title="Exportar Relatório em PDF"
        >
          <FileDown class="w-4 h-4" :stroke-width="1.8" />
          Exportar PDF
        </UiButton>
        <UiButton variant="ghost" @click="loadRentabilidade">
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin text-bronze" :stroke-width="1.8" />
          <span v-else>🔄</span>
        </UiButton>
      </div>
    </header>

    <!-- Filtro de Grupos -->
    <div class="flex p-1 bg-paper rounded-md w-fit border border-line">
      <button
        v-for="grupo in ['COMBUSTÍVEIS', 'OUTROS', 'TODOS']"
        :key="grupo"
        @click="grupoAtivo = grupo"
        class="px-5 py-1.5 rounded-md text-[11px] uppercase tracking-wide font-medium transition-colors"
        :class="grupoAtivo === grupo ? 'bg-sheet text-bronze border border-line' : 'text-risco hover:text-ink border border-transparent'"
      >
        {{ grupo }}
      </button>
    </div>

    <!-- Cards de Resumo -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-sheet p-5 rounded-md border border-line card-shadow flex items-center gap-4">
        <div class="w-11 h-11 bg-paper border border-line text-bronze rounded-md flex items-center justify-center flex-shrink-0">
          <Package class="w-5 h-5" :stroke-width="1.7" />
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wide text-risco font-medium">Volume Total Vendido</p>
          <h3 class="font-mono text-[22px] text-ink">{{ formatNumber(stats.totalVendas) }} L</h3>
        </div>
      </div>

      <div class="bg-sheet p-5 rounded-md border border-line card-shadow flex items-center gap-4">
        <div class="w-11 h-11 bg-conforme/10 border border-conforme/20 text-conforme rounded-md flex items-center justify-center flex-shrink-0">
          <TrendingUp class="w-5 h-5" :stroke-width="1.7" />
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wide text-risco font-medium">Volume Comprado</p>
          <h3 class="font-mono text-[22px] text-ink">{{ formatNumber(stats.totalCompras) }} L</h3>
        </div>
      </div>

      <div class="bg-sheet p-5 rounded-md border border-line card-shadow flex items-center gap-4">
        <div class="w-11 h-11 bg-variacao/10 border border-variacao/20 text-variacao rounded-md flex items-center justify-center flex-shrink-0">
          <DollarSign class="w-5 h-5" :stroke-width="1.7" />
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wide text-risco font-medium">Saldo Total Estoque</p>
          <h3 class="font-mono text-[22px] text-ink">{{ formatNumber(stats.estoqueTotal) }} L</h3>
        </div>
      </div>
    </div>

    <!-- Tabela Principal -->
    <div class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
      <div v-if="loading" class="p-20 flex flex-col items-center justify-center gap-4">
        <Loader2 class="w-9 h-9 animate-spin text-bronze" :stroke-width="1.7" />
        <p class="text-[13px] text-risco">Cruzando dados de vendas e estoque...</p>
      </div>

      <div v-else-if="filteredData.length === 0" class="p-20 text-center">
        <p class="text-[13px] text-risco">Nenhum dado encontrado para este período.</p>
      </div>

      <table v-else class="w-full text-left border-collapse">
        <thead class="bg-paper border-b border-line">
          <tr>
            <th class="px-6 py-3 text-[10px] font-semibold text-risco uppercase tracking-[.08em]">Código</th>
            <th class="px-6 py-3 text-[10px] font-semibold text-risco uppercase tracking-[.08em]">Produto</th>
            <th class="px-6 py-3 text-[10px] font-semibold text-risco uppercase tracking-[.08em] text-right">Estq. Inicial</th>
            <th class="px-6 py-3 text-[10px] font-semibold text-risco uppercase tracking-[.08em] text-right">Entradas</th>
            <th class="px-6 py-3 text-[10px] font-semibold text-risco uppercase tracking-[.08em] text-right">Venda</th>
            <th class="px-6 py-3 text-[10px] font-semibold text-risco uppercase tracking-[.08em] text-right">Estq. Final</th>
            <th class="px-6 py-3 text-[10px] font-semibold text-risco uppercase tracking-[.08em] text-right">Custo (M)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredData" :key="item.codigo" class="border-t border-line hover:bg-paper transition-colors group">
            <td class="px-6 py-3 text-[11px] font-mono text-risco max-w-[120px] truncate" :title="item.codigo">
                {{ item.codigo }}
            </td>
            <td class="px-6 py-3">
              <div class="font-medium text-ink text-[13px]">{{ item.produto }}</div>
            </td>
            <td class="px-6 py-3 text-right text-[12px] font-mono text-risco">
                {{ formatNumber(item.estoque_inicial) }}
            </td>
            <td class="px-6 py-3 text-right text-[12px] font-mono text-ink font-medium">
                {{ formatNumber(item.qtd_comprada) }}
            </td>
            <td class="px-6 py-3 text-right font-mono text-ink text-[13px] font-medium">
                {{ formatNumber(item.qtd_vendida) }}
            </td>
            <td class="px-6 py-3 text-right text-[12px] font-mono font-medium" :class="item.estoque_final < 0 ? 'text-lacre' : 'text-ink'">
                {{ formatNumber(item.estoque_final) }}
            </td>
            <td class="px-6 py-3 text-right text-[13px] font-mono text-ink border-l border-line">
                <div class="flex flex-col items-end">
                    <span>{{ formatCurrency(item.custo_medio) }}</span>
                    <span v-if="item.usou_historico_custo" class="text-[9px] text-risco uppercase font-medium tracking-[-0.01em]">Custo Histórico</span>
                </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="text-[11px] text-risco text-center pb-8">
      * Preços médios e custos calculados a partir das NF-e (Entradas e Saídas) e do Registro 1300 identificados no SPED.
    </footer>
  </div>
</template>

<style scoped>
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
