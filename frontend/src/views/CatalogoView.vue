<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { BookOpen, Loader2, ShieldAlert, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-vue-next';
import UiSelo from '@/components/ui/UiSelo.vue';

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
    ? 'bg-lacre/10 text-lacre border-lacre/20'
    : 'bg-variacao/10 text-variacao border-variacao/20';
const classeLabel = {
    'estrutural-seguro': 'Estrutural', 'fiscal-deterministico': 'Fiscal (auto)', 'manual': 'Manual',
};
</script>

<template>
    <div class="p-6 max-w-6xl mx-auto">
        <div class="flex items-center gap-3 mb-1">
            <BookOpen class="w-6 h-6 text-bronze" :stroke-width="1.8" />
            <h1 class="font-display font-semibold text-[22px] sm:text-[26px] text-ink tracking-[-0.01em]">Catálogo de Regras <span class="text-bronze">&amp; Leiaute</span></h1>
        </div>
        <p class="text-[13px] text-risco mb-5">O que o Validador conhece hoje — regras ativas e leiaute dos registros. Transparência do que cobrimos.</p>

        <div v-if="loading" class="flex items-center gap-2 text-risco text-[13px] py-10 justify-center">
            <Loader2 class="w-5 h-5 animate-spin" /> Carregando catálogo…
        </div>
        <div v-else-if="erro" class="bg-lacre/[0.06] border border-lacre/25 text-lacre rounded-md p-4 text-[13px]">{{ erro }}</div>

        <template v-else>
            <!-- Resumo / selo "N de M" -->
            <div v-if="resumo" class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div class="bg-sheet border border-line rounded-md p-4 card-shadow">
                    <div class="font-mono text-[24px] font-semibold text-ink">{{ resumo.totalRegras }}</div>
                    <div class="text-[10px] uppercase font-medium text-risco tracking-[.08em]">Regras ativas</div>
                </div>
                <div class="bg-sheet border border-line rounded-md p-4 card-shadow">
                    <div class="font-mono text-[24px] font-semibold text-lacre">{{ resumo.bloqueantes }}</div>
                    <div class="text-[10px] uppercase font-medium text-risco tracking-[.08em]">Bloqueantes</div>
                </div>
                <div class="bg-sheet border border-line rounded-md p-4 card-shadow">
                    <div class="font-mono text-[24px] font-semibold text-conforme">{{ resumo.autoCorrigidas }}</div>
                    <div class="text-[10px] uppercase font-medium text-risco tracking-[.08em]">Auto-corrigidas no download</div>
                </div>
                <div class="bg-sheet border border-line rounded-md p-4 card-shadow">
                    <div class="font-mono text-[24px] font-semibold text-ink">{{ resumo.registrosNoLeiaute }}</div>
                    <div class="text-[10px] uppercase font-medium text-risco tracking-[.08em]">Registros no leiaute</div>
                </div>
            </div>

            <div class="bg-variacao/[0.07] border border-variacao/25 rounded-md p-3 mb-5 flex items-start gap-2">
                <ShieldAlert class="w-4 h-4 text-variacao shrink-0 mt-0.5" :stroke-width="1.8" />
                <p class="text-[11px] text-variacao font-medium leading-relaxed">
                    Este catálogo cobre os erros recorrentes de postos. <b>Não substitui a validação oficial no PVA</b> — use como pré-cheque e correção antes de transmitir.
                </p>
            </div>

            <!-- Abas + filtros -->
            <div class="flex flex-wrap items-center gap-2 mb-3">
                <button @click="aba = 'regras'" :class="aba === 'regras' ? 'bg-bronze text-white' : 'bg-paper text-risco'" class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors">Regras ({{ regras.length }})</button>
                <button @click="aba = 'leiaute'" :class="aba === 'leiaute' ? 'bg-bronze text-white' : 'bg-paper text-risco'" class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors">Leiaute ({{ resumo?.registrosNoLeiaute || 0 }})</button>
                <input v-model="busca" placeholder="Buscar (registro, regra, campo)…" class="flex-1 min-w-[180px] h-8 text-[13px] bg-sheet border border-line rounded-md px-3 text-ink placeholder-risco outline-none focus:border-bronze transition-colors" />
                <template v-if="aba === 'regras'">
                    <select v-model="filtroBloco" class="h-8 text-[13px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors">
                        <option value="">Todos os blocos</option>
                        <option v-for="b in blocos" :key="b" :value="b">Bloco {{ b }}</option>
                    </select>
                    <select v-model="filtroSev" class="h-8 text-[13px] bg-sheet border border-line rounded-md px-2 text-ink outline-none focus:border-bronze transition-colors">
                        <option value="">Todas</option>
                        <option value="BLOQ">Bloqueante</option>
                        <option value="ADV">Advertência</option>
                    </select>
                </template>
            </div>

            <!-- Tabela de regras -->
            <div v-if="aba === 'regras'" class="bg-sheet border border-line rounded-md overflow-hidden card-shadow">
                <table class="w-full text-[13px]">
                    <thead class="bg-paper text-risco uppercase text-[10px] tracking-[.08em]">
                        <tr>
                            <th class="text-left px-3 py-2 font-medium">Regra</th>
                            <th class="text-left px-3 py-2 font-medium">Bloco / Registro</th>
                            <th class="text-left px-3 py-2 font-medium">Severidade</th>
                            <th class="text-left px-3 py-2 font-medium">Correção</th>
                            <th class="px-2 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="r in regrasFiltradas" :key="r.id">
                            <tr class="border-t border-line hover:bg-paper cursor-pointer transition-colors" @click="expand[r.id] = !expand[r.id]">
                                <td class="px-3 py-2"><span class="font-mono font-medium text-ink">{{ r.id }}</span><div class="text-risco">{{ r.titulo }}</div></td>
                                <td class="px-3 py-2 font-mono text-risco">{{ r.bloco }} · {{ r.registro }}</td>
                                <td class="px-3 py-2"><span :class="sevClasse(r.severidade)" class="border px-1.5 py-0.5 rounded font-medium text-[10px] uppercase">{{ r.severidade }}</span></td>
                                <td class="px-3 py-2">
                                    <span class="text-risco">{{ classeLabel[r.classeCorrecao] || r.classeCorrecao }}</span>
                                    <span v-if="r.jaCorrigidoNoExport" class="ml-1 inline-flex items-center gap-0.5 text-conforme font-medium text-[9px]"><CheckCircle2 class="w-3 h-3" :stroke-width="1.8" />auto</span>
                                </td>
                                <td class="px-2 py-2 text-risco"><component :is="expand[r.id] ? ChevronUp : ChevronDown" class="w-4 h-4" :stroke-width="1.8" /></td>
                            </tr>
                            <tr v-if="expand[r.id]" class="bg-paper">
                                <td colspan="5" class="px-4 py-2 text-[11px] text-risco leading-relaxed">
                                    <span class="font-medium text-risco uppercase text-[9px] tracking-[.05em]">Como corrigir no ERP:</span> {{ r.instrucaoERP || '—' }}
                                </td>
                            </tr>
                        </template>
                        <tr v-if="!regrasFiltradas.length"><td colspan="5" class="px-3 py-6 text-center text-risco italic">Nenhuma regra para o filtro.</td></tr>
                    </tbody>
                </table>
            </div>

            <!-- Leiaute -->
            <div v-else class="space-y-2">
                <div v-for="r in leiauteArr" :key="r.reg" class="bg-sheet border border-line rounded-md p-3 card-shadow">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="font-mono font-semibold text-ink">{{ r.reg }}</span>
                        <UiSelo :tipo="`${r.nCampos} campos`" />
                        <span v-if="r.nCamposPorVersao" class="text-[9px] font-mono text-variacao bg-variacao/[0.07] border border-variacao/25 px-1.5 py-0.5 rounded">por versão: {{ JSON.stringify(r.nCamposPorVersao) }}</span>
                    </div>
                    <div class="text-[11px] font-mono text-risco">{{ (r.campos || []).join(' · ') }}</div>
                </div>
                <div v-if="!leiauteArr.length" class="px-3 py-6 text-center text-risco italic text-[13px]">Nenhum registro para o filtro.</div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.card-shadow { box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07); }
</style>
