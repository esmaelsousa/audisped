<script setup>
import { ref, computed } from 'vue';

const filterDate = ref('');
const selectedFuel = ref('');
const onlyAnomalies = ref(false);
const data = ref([]);

const fuelList = computed(() => {
  const fuels = new Set(data.value.map(item => item.produto));
  return Array.from(fuels);
});

const filteredData = computed(() => {
  return data.value.filter(item => {
    const matchDate = !filterDate.value || item.data === filterDate.value;
    const matchFuel = !selectedFuel.value || item.produto === selectedFuel.value;
    const matchAnomaly = !onlyAnomalies.value || item.hasAnomaly;
    return matchDate && matchFuel && matchAnomaly;
  });
});
</script>

<template>
  <div class="space-y-8 animate-fade-in">
    <!-- Header -->
    <header>
      <h2 class="text-3xl font-extrabold text-slate-800 tracking-tight">
        Análise <span class="text-brand-accent">Forense</span> de Estoque
      </h2>
      <p class="text-slate-500 mt-1">Investigação detalhada de movimentação por tanque e bico</p>
    </header>

    <!-- Filtros -->
    <section class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-wrap items-center gap-6">
      <div class="space-y-1.5 flex-1 min-w-[200px]">
        <label class="text-[10px] font-black uppercase text-slate-400 ml-1">Filtrar Data</label>
        <input v-model="filterDate" type="date" 
               class="w-full px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-brand-accent/40 transition-all font-medium text-sm" />
      </div>

      <div class="space-y-1.5 flex-1 min-w-[200px]">
        <label class="text-[10px] font-black uppercase text-slate-400 ml-1">Combustível</label>
        <select v-model="selectedFuel" 
                class="w-full px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:border-brand-accent/40 transition-all font-medium text-sm">
          <option value="">Todos os Combustíveis</option>
          <option v-for="fuel in fuelList" :key="fuel" :value="fuel">{{ fuel }}</option>
        </select>
      </div>

      <div class="flex items-center gap-3 pt-6">
        <input type="checkbox" v-model="onlyAnomalies" id="anomalies" 
               class="w-5 h-5 rounded-lg border-slate-300 text-brand-accent focus:ring-brand-accent/20" />
        <label for="anomalies" class="text-sm font-bold text-slate-600 cursor-pointer select-none">
          Apenas Inconsistências
        </label>
      </div>
    </section>

    <!-- Tabela Forense -->
    <div class="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50/50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <tr>
            <th class="p-6">Data</th>
            <th class="p-6">Produto</th>
            <th class="p-6 text-right">E. Inicial</th>
            <th class="p-6 text-right">Saída (Venda)</th>
            <th class="p-6 text-right">E. Final</th>
            <th class="p-6 text-center">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-50">
          <tr v-for="item in filteredData" :key="item.id" 
              class="hover:bg-slate-50/50 transition-colors group"
              :class="item.hasAnomaly ? 'bg-red-50/30' : ''">
            <td class="p-6 text-sm font-medium text-slate-600">{{ item.data }}</td>
            <td class="p-6 font-bold text-slate-800">{{ item.produto }}</td>
            <td class="p-6 text-right font-mono text-sm">{{ item.estoque_inicial }} L</td>
            <td class="p-6 text-right font-mono text-sm">{{ item.saida }} L</td>
            <td class="p-6 text-right font-mono text-sm font-bold">{{ item.estoque_final }} L</td>
            <td class="p-6 text-center">
              <span v-if="item.hasAnomaly" class="px-3 py-1 rounded-full bg-red-100 text-red-600 text-[10px] font-black uppercase">
                ⚠️ {{ item.anomalyType }}
              </span>
              <span v-else class="px-3 py-1 rounded-full bg-emerald-600/10 text-emerald-600 text-[10px] font-black uppercase text-[9px]">
                ✅ CONSISTENTE
              </span>
            </td>
          </tr>
          <tr v-if="filteredData.length === 0">
             <td colspan="6" class="p-20 text-center text-slate-400 italic">Nenhum dado selecionado ou disponível para análise.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style>
/* Estilos globais definidos no App.vue */
</style>
