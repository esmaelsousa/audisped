<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { BookOpen, Loader2, ShieldAlert, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-vue-next';

const loading = ref(true);
const erro = ref('');
const resumo = ref(null);
const regras = ref([]);
const leiaute = ref({});

const busca = ref('');
const filtroBloco = ref('');
const filtroSev = ref('');
const aba = ref('regras'); // 'regras' | 'leiaute'
const expand = ref({});    // id da regra -> aberto

function authHeader() {
    const t = localStorage.getItem('token');
    return t ? { Authorization: `Bearer ${t}` } : {};
}

async function carregar() {
    loading.value = true; erro.value = '';
    try {
        const res = await axios.get(`${API_BASE_URL}/api/validador/catalogo`, { headers: authHeader() });
        resumo.value = res.data.resumo;
        regras.value = res.data.regras || [];
        leiaute.value = res.data.leiaute || {};
    } catch (e) {
        erro.value = e.response?.data?.message || ('Erro ao carregar o catálogo: ' + e.message);
    } finally {
        loading.value = false;
    }
}
onMounted(carregar);

const blocos = computed(() => [...new Set(regras.value.map(r => r.bloco))].sort());

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const regrasFiltradas = computed(() => {
    const q = norm(busca.value).split(/\s+/).filter(Boolean);
    return regras.value.filter(r => {
        if (filtroBloco.value && r.bloco !== filtroBloco.value) return false;
        if (filtroSev.value && r.severidade !== filtroSev.value) return false;
        if (!q.length) return true;
        const hay = norm(`${r.id} ${r.registro} ${r.titulo} ${r.instrucaoERP}`);
        return q.every(t => hay.includes(t));
    });
});

const leiauteArr = computed(() => {
    const q = norm(busca.value);
    return Object.entries(leiaute.value)
        .filter(([reg, def]) => !q || norm(reg + ' ' + (def.campos || []).join(' ')).includes(q))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([reg, def]) => ({ reg, ...def }));
});

const sevClasse = (s) => s === 'BLOQ'
    ? 'bg-red-100 text-red-700'
    : 'bg-amber-100 text-amber-700';
const classeLabel = {
    'estrutural-seguro': 'Estrutural', 'fiscal-deterministico': 'Fiscal (auto)', 'manual': 'Manual',
};
</script>

<template>
    <div class="p-6 max-w-6xl mx-auto">
        <div class="flex items-center gap-3 mb-1">
            <BookOpen class="w-6 h-6 text-brand-accent" />
            <h1 class="text-2xl font-black text-slate-800 tracking-tighter">Catálogo de Regras <span class="text-brand-accent">& Leiaute</span></h1>
        </div>
        <p class="text-sm text-slate-400 font-medium mb-5">O que o Validador conhece hoje — regras ativas e leiaute dos registros. Transparência do que cobrimos.</p>

        <div v-if="loading" class="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center">
            <Loader2 class="w-5 h-5 animate-spin" /> Carregando catálogo…
        </div>
        <div v-else-if="erro" class="bg-red-50 border border-red-100 text-red-700 rounded-xl p-4 text-sm">{{ erro }}</div>

        <template v-else>
            <!-- Resumo / selo "N de M" -->
            <div v-if="resumo" class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div class="bg-white border border-slate-200 rounded-2xl p-4">
                    <div class="text-2xl font-black text-slate-800">{{ resumo.totalRegras }}</div>
                    <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Regras ativas</div>
                </div>
                <div class="bg-white border border-slate-200 rounded-2xl p-4">
                    <div class="text-2xl font-black text-red-600">{{ resumo.bloqueantes }}</div>
                    <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Bloqueantes</div>
                </div>
                <div class="bg-white border border-slate-200 rounded-2xl p-4">
                    <div class="text-2xl font-black text-emerald-600">{{ resumo.autoCorrigidas }}</div>
                    <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Auto-corrigidas no download</div>
                </div>
                <div class="bg-white border border-slate-200 rounded-2xl p-4">
                    <div class="text-2xl font-black text-slate-800">{{ resumo.registrosNoLeiaute }}</div>
                    <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Registros no leiaute</div>
                </div>
            </div>

            <div class="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-5 flex items-start gap-2">
                <ShieldAlert class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p class="text-[11px] text-amber-700 font-medium leading-relaxed">
                    Este catálogo cobre os erros recorrentes de postos. <b>Não substitui a validação oficial no PVA</b> — use como pré-cheque e correção antes de transmitir.
                </p>
            </div>

            <!-- Abas + filtros -->
            <div class="flex flex-wrap items-center gap-2 mb-3">
                <button @click="aba = 'regras'" :class="aba === 'regras' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all">Regras ({{ regras.length }})</button>
                <button @click="aba = 'leiaute'" :class="aba === 'leiaute' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all">Leiaute ({{ resumo?.registrosNoLeiaute || 0 }})</button>
                <input v-model="busca" placeholder="Buscar (registro, regra, campo)…" class="flex-1 min-w-[180px] h-8 text-xs border border-slate-200 rounded-lg px-3 outline-none focus:border-brand-accent" />
                <template v-if="aba === 'regras'">
                    <select v-model="filtroBloco" class="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white">
                        <option value="">Todos os blocos</option>
                        <option v-for="b in blocos" :key="b" :value="b">Bloco {{ b }}</option>
                    </select>
                    <select v-model="filtroSev" class="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white">
                        <option value="">Todas</option>
                        <option value="BLOQ">Bloqueante</option>
                        <option value="ADV">Advertência</option>
                    </select>
                </template>
            </div>

            <!-- Tabela de regras -->
            <div v-if="aba === 'regras'" class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <table class="w-full text-xs">
                    <thead class="bg-slate-50 text-slate-400 uppercase text-[10px] tracking-wider">
                        <tr>
                            <th class="text-left px-3 py-2 font-bold">Regra</th>
                            <th class="text-left px-3 py-2 font-bold">Bloco / Registro</th>
                            <th class="text-left px-3 py-2 font-bold">Severidade</th>
                            <th class="text-left px-3 py-2 font-bold">Correção</th>
                            <th class="px-2 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="r in regrasFiltradas" :key="r.id">
                            <tr class="border-t border-slate-100 hover:bg-slate-50/50 cursor-pointer" @click="expand[r.id] = !expand[r.id]">
                                <td class="px-3 py-2"><span class="font-mono font-bold text-slate-700">{{ r.id }}</span><div class="text-slate-500">{{ r.titulo }}</div></td>
                                <td class="px-3 py-2 font-mono text-slate-500">{{ r.bloco }} · {{ r.registro }}</td>
                                <td class="px-3 py-2"><span :class="sevClasse(r.severidade)" class="px-1.5 py-0.5 rounded font-bold text-[10px]">{{ r.severidade }}</span></td>
                                <td class="px-3 py-2">
                                    <span class="text-slate-500">{{ classeLabel[r.classeCorrecao] || r.classeCorrecao }}</span>
                                    <span v-if="r.jaCorrigidoNoExport" class="ml-1 inline-flex items-center gap-0.5 text-emerald-600 font-bold text-[9px]"><CheckCircle2 class="w-3 h-3" />auto</span>
                                </td>
                                <td class="px-2 py-2 text-slate-300"><component :is="expand[r.id] ? ChevronUp : ChevronDown" class="w-4 h-4" /></td>
                            </tr>
                            <tr v-if="expand[r.id]" class="bg-slate-50/70">
                                <td colspan="5" class="px-4 py-2 text-[11px] text-slate-600 leading-relaxed">
                                    <span class="font-bold text-slate-400 uppercase text-[9px]">Como corrigir no ERP:</span> {{ r.instrucaoERP || '—' }}
                                </td>
                            </tr>
                        </template>
                        <tr v-if="!regrasFiltradas.length"><td colspan="5" class="px-3 py-6 text-center text-slate-400 italic">Nenhuma regra para o filtro.</td></tr>
                    </tbody>
                </table>
            </div>

            <!-- Leiaute -->
            <div v-else class="space-y-2">
                <div v-for="r in leiauteArr" :key="r.reg" class="bg-white border border-slate-200 rounded-xl p-3">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="font-mono font-black text-slate-700">{{ r.reg }}</span>
                        <span class="text-[10px] font-bold text-slate-400">{{ r.nCampos }} campos</span>
                        <span v-if="r.nCamposPorVersao" class="text-[9px] font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">por versão: {{ JSON.stringify(r.nCamposPorVersao) }}</span>
                    </div>
                    <div class="text-[11px] font-mono text-slate-500">{{ (r.campos || []).join(' · ') }}</div>
                </div>
                <div v-if="!leiauteArr.length" class="px-3 py-6 text-center text-slate-400 italic text-sm">Nenhum registro para o filtro.</div>
            </div>
        </template>
    </div>
</template>
