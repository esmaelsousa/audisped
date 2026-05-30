<script setup>
import { ref, onMounted, computed } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { token } from '../store';
import { Scale, Search, RefreshCw } from 'lucide-vue-next';

const regras = ref([]);
const carregando = ref(false);
const erro = ref('');
const busca = ref('');
const filtroEscopo = ref('');   // '' | 'ambos' | 'export' | 'injecao'
const filtroAtivo = ref('');    // '' | 'true' | 'false'

const OPER = { '0': 'Entrada', '1': 'Saída' };

async function carregar() {
  carregando.value = true; erro.value = '';
  try {
    const params = {};
    if (filtroEscopo.value) params.escopo = filtroEscopo.value;
    if (filtroAtivo.value) params.ativo = filtroAtivo.value;
    const res = await axios.get(`${API_BASE_URL}/api/regras-fiscais`, {
      params, headers: { Authorization: `Bearer ${token.value}` }
    });
    regras.value = res.data;
  } catch (e) {
    erro.value = e.response?.data?.message || e.message || 'Falha ao carregar regras fiscais.';
  } finally {
    carregando.value = false;
  }
}
onMounted(carregar);

const filtradas = computed(() => {
  if (!busca.value) return regras.value;
  const q = busca.value.toLowerCase();
  return regras.value.filter(r =>
    (r.nome || '').toLowerCase().includes(q) ||
    (r.fundamento_legal || '').toLowerCase().includes(q));
});

function condTexto(r) {
  const ce = r.cond_extra || {};
  const partes = [];
  partes.push(r.ind_oper ? OPER[r.ind_oper] || r.ind_oper : 'Entrada/Saída');
  if (r.ncm_prefix) partes.push(`NCM ${r.ncm_prefix}*`);
  if (ce.ncm_list?.length) partes.push(`NCM ∈ {${ce.ncm_list.join(', ')}}`);
  if (r.cst_icms_origem) partes.push(`CST orig ${r.cst_icms_origem}`);
  if (ce.cst_origem_list?.length) partes.push(`CST orig ∈ {${ce.cst_origem_list.join(', ')}}`);
  if (r.cfop_origem) partes.push(`CFOP ${r.cfop_origem}*`);
  if (r.tipo_produto) partes.push(`tipo ${r.tipo_produto}`);
  if (r.regime) partes.push(`regime ${r.regime}`);
  if (r.cnpj_emissor) partes.push(`fornecedor ${r.cnpj_emissor}`);
  return partes.join(' · ');
}
function acaoTexto(r) {
  const a = [];
  if (r.acao_cst_icms) a.push(`CST ICMS=${r.acao_cst_icms}`);
  if (r.acao_cfop) a.push(`CFOP=${r.acao_cfop}`);
  if (r.acao_cst_pis) a.push(`PIS=${r.acao_cst_pis}`);
  if (r.acao_cst_cofins) a.push(`COFINS=${r.acao_cst_cofins}`);
  if (r.acao_aliq_icms != null) a.push(`alíq ICMS=${r.acao_aliq_icms}`);
  if (r.flag_zera_icms) a.push('zera ICMS');
  if (r.flag_usar_st_ret) a.push('usa ST retido');
  if (r.flag_bloqueia_credito_st) a.push('bloqueia crédito ST');
  if (r.flag_apenas_alerta) a.push('só alerta (não aplica)');
  return a.length ? a.join(', ') : '—';
}
function fmtData(d) { return d ? String(d).slice(0, 10) : '—'; }
const corEscopo = { ambos: 'bg-emerald-100 text-emerald-700', export: 'bg-blue-100 text-blue-700', injecao: 'bg-purple-100 text-purple-700' };
const corConf = { alta: 'bg-emerald-100 text-emerald-700', media: 'bg-amber-100 text-amber-700', baixa: 'bg-rose-100 text-rose-700' };
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-2">
      <div class="p-2 rounded-xl bg-brand-accent/10"><Scale class="w-5 h-5 text-brand-accent" /></div>
      <div>
        <h1 class="text-xl font-black text-slate-800">Regras Fiscais</h1>
        <p class="text-xs text-slate-500">Cadastro <b>global</b> de tributação (condição → ação), aplicado na injeção e na exportação do SPED. Vigência por competência.</p>
      </div>
    </div>
    <div class="mb-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <b>Somente leitura (MVP).</b> A edição/criação (CRUD + simulador) entra na Fase 3. Hoje a regra <b>prio 10</b> (escopo <i>ambos</i>) já roda na exportação; as de escopo <i>injeção</i> entram na Fase 2.
    </div>

    <!-- Filtros -->
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="relative flex-1 min-w-[200px]">
        <Search class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input v-model="busca" placeholder="Buscar por nome ou fundamento legal…"
          class="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-accent/30 outline-none" />
      </div>
      <select v-model="filtroEscopo" @change="carregar" class="text-sm border border-slate-200 rounded-lg px-3 py-2">
        <option value="">Todos os escopos</option>
        <option value="ambos">ambos</option>
        <option value="export">export</option>
        <option value="injecao">injeção</option>
      </select>
      <select v-model="filtroAtivo" @change="carregar" class="text-sm border border-slate-200 rounded-lg px-3 py-2">
        <option value="">Ativas e inativas</option>
        <option value="true">Só ativas</option>
        <option value="false">Só inativas</option>
      </select>
      <button @click="carregar" class="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
        <RefreshCw class="w-4 h-4" /> Atualizar
      </button>
    </div>

    <div v-if="erro" class="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-4">{{ erro }}</div>
    <div v-if="carregando" class="text-sm text-slate-500 italic">Carregando…</div>

    <!-- Lista -->
    <div v-else class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3 text-center w-12">Prio</th>
            <th class="py-2.5 px-3">Regra</th>
            <th class="py-2.5 px-3">QUANDO</th>
            <th class="py-2.5 px-3">ENTÃO</th>
            <th class="py-2.5 px-3 text-center">Vigência ≥</th>
            <th class="py-2.5 px-3 text-center">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-50">
          <tr v-for="r in filtradas" :key="r.id" class="hover:bg-slate-50/60 align-top">
            <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-400">{{ r.prioridade }}</td>
            <td class="py-2.5 px-3">
              <div class="text-xs font-bold text-slate-700">{{ r.nome }}</div>
              <div class="text-[10px] text-slate-400 mt-0.5">{{ r.fundamento_legal }}</div>
            </td>
            <td class="py-2.5 px-3 text-[11px] text-slate-600">{{ condTexto(r) }}</td>
            <td class="py-2.5 px-3 text-[11px] font-medium text-slate-700">{{ acaoTexto(r) }}</td>
            <td class="py-2.5 px-3 text-center text-[10px] font-mono text-slate-500">{{ fmtData(r.dt_ini) }}</td>
            <td class="py-2.5 px-3 text-center whitespace-nowrap">
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" :class="corEscopo[r.escopo_aplicacao] || 'bg-slate-100 text-slate-600'">{{ r.escopo_aplicacao }}</span>
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ml-1" :class="corConf[r.confianca] || 'bg-slate-100 text-slate-600'">{{ r.confianca }}</span>
              <div class="mt-1">
                <span class="text-[9px] font-black px-2 py-0.5 rounded-full" :class="r.ativo ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-600'">{{ r.ativo ? 'ATIVA' : 'inativa' }}</span>
              </div>
            </td>
          </tr>
          <tr v-if="!filtradas.length">
            <td colspan="6" class="py-8 text-center text-sm text-slate-400 italic">Nenhuma regra encontrada.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-slate-400 mt-3">{{ filtradas.length }} regra(s) · tabela <code>regras_fiscais</code></p>
  </div>
</template>
