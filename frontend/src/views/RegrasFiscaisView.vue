<script setup>
import { ref, onMounted, computed, reactive } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { token } from '../store';
import { Scale, Search, RefreshCw, Plus, Pencil, Copy, Power, Trash2, FlaskConical, X } from 'lucide-vue-next';

const regras = ref([]);
const carregando = ref(false);
const erro = ref('');
const busca = ref('');
const filtroEscopo = ref('');
const filtroAtivo = ref('');

const OPER = { '0': 'Entrada', '1': 'Saída' };
const CST_ICMS = ['00','02','10','15','20','30','40','41','50','51','53','60','61','70','90'];
const CST_PISCOFINS = ['01','02','03','04','05','06','07','08','09','49','99'];
const auth = () => ({ headers: { Authorization: `Bearer ${token.value}` } });

async function carregar() {
  carregando.value = true; erro.value = '';
  try {
    const params = {};
    if (filtroEscopo.value) params.escopo = filtroEscopo.value;
    if (filtroAtivo.value) params.ativo = filtroAtivo.value;
    const res = await axios.get(`${API_BASE_URL}/api/regras-fiscais`, { params, ...auth() });
    regras.value = res.data;
  } catch (e) { erro.value = e.response?.data?.message || e.message; }
  finally { carregando.value = false; }
}
onMounted(carregar);

const filtradas = computed(() => {
  if (!busca.value) return regras.value;
  const q = busca.value.toLowerCase();
  return regras.value.filter(r => (r.nome || '').toLowerCase().includes(q) || (r.fundamento_legal || '').toLowerCase().includes(q));
});

function condTexto(r) {
  const ce = r.cond_extra || {}; const p = [];
  p.push(r.ind_oper ? OPER[r.ind_oper] || r.ind_oper : 'Entrada/Saída');
  if (r.ncm_prefix) p.push(`NCM ${r.ncm_prefix}*`);
  if (ce.ncm_list?.length) p.push(`NCM ∈ {${ce.ncm_list.join(', ')}}`);
  if (r.cst_icms_origem) p.push(`CST orig ${r.cst_icms_origem}`);
  if (ce.cst_origem_list?.length) p.push(`CST orig ∈ {${ce.cst_origem_list.join(', ')}}`);
  if (r.cfop_origem) p.push(`CFOP ${r.cfop_origem}*`);
  if (r.regime) p.push(`regime ${r.regime}`);
  if (r.cnpj_emissor) p.push(`forn. ${r.cnpj_emissor}`);
  return p.join(' · ');
}
function acaoTexto(r) {
  const a = [];
  if (r.acao_cst_icms) a.push(`CST ICMS=${r.acao_cst_icms}`);
  if (r.acao_cfop) a.push(`CFOP=${r.acao_cfop}`);
  if (r.acao_cst_pis) a.push(`PIS=${r.acao_cst_pis}`);
  if (r.acao_cst_cofins) a.push(`COFINS=${r.acao_cst_cofins}`);
  if (r.acao_aliq_icms != null) a.push(`alíq=${r.acao_aliq_icms}`);
  if (r.flag_zera_icms) a.push('zera ICMS');
  if (r.flag_usar_st_ret) a.push('usa ST retido');
  if (r.flag_bloqueia_credito_st) a.push('bloqueia créd. ST');
  if (r.flag_apenas_alerta) a.push('só alerta');
  return a.length ? a.join(', ') : '—';
}
const fmtData = d => d ? String(d).slice(0, 10) : '—';
const corEscopo = { ambos: 'bg-emerald-100 text-emerald-700', export: 'bg-blue-100 text-blue-700', injecao: 'bg-purple-100 text-purple-700' };
const corConf = { alta: 'bg-emerald-100 text-emerald-700', media: 'bg-amber-100 text-amber-700', baixa: 'bg-rose-100 text-rose-700' };

// ---------- Formulário (criar/editar) ----------
const modal = ref(false);
const editandoId = ref(null);
const salvando = ref(false);
const form = reactive({});
const cstOrigemStr = ref(''); // edição da lista cst_origem_list como texto

function novaRegra() { return {
  nome: '', fundamento_legal: '', prioridade: 100, escopo_aplicacao: 'ambos', confianca: 'media',
  ativo: true, dt_ini: '2000-01-01', dt_fim: '', ind_oper: '', ncm_prefix: '', cfop_origem: '',
  regime: '', cnpj_emissor: '', acao_cst_icms: '', acao_cfop: '', acao_cst_pis: '', acao_cst_cofins: '',
  acao_aliq_icms: '', flag_zera_icms: false, flag_usar_st_ret: false, flag_bloqueia_credito_st: false,
  flag_para_no_match: true, flag_apenas_alerta: false,
}; }
function abrirNova() { Object.assign(form, novaRegra()); cstOrigemStr.value = ''; editandoId.value = null; modal.value = true; }
function abrirEditar(r) {
  Object.assign(form, novaRegra(), r);
  form.dt_ini = fmtData(r.dt_ini); form.dt_fim = r.dt_fim ? fmtData(r.dt_fim) : '';
  cstOrigemStr.value = (r.cond_extra?.cst_origem_list || []).join(', ');
  editandoId.value = r.id; modal.value = true;
}
async function salvar() {
  if (!form.nome) { alert('Informe o nome da regra.'); return; }
  salvando.value = true;
  try {
    const lista = cstOrigemStr.value.split(',').map(s => s.trim()).filter(Boolean);
    const payload = {
      nome: form.nome, fundamento_legal: form.fundamento_legal, prioridade: Number(form.prioridade) || 100,
      escopo_aplicacao: form.escopo_aplicacao, confianca: form.confianca, ativo: form.ativo,
      dt_ini: form.dt_ini || '2000-01-01', dt_fim: form.dt_fim || null,
      ind_oper: form.ind_oper || null, ncm_prefix: form.ncm_prefix || null, cfop_origem: form.cfop_origem || null,
      regime: form.regime || null, cnpj_emissor: form.cnpj_emissor || null,
      cond_extra: lista.length ? { cst_origem_list: lista } : {},
      acao_cst_icms: form.acao_cst_icms || null, acao_cfop: form.acao_cfop || null,
      acao_cst_pis: form.acao_cst_pis || null, acao_cst_cofins: form.acao_cst_cofins || null,
      acao_aliq_icms: form.acao_aliq_icms === '' ? null : Number(form.acao_aliq_icms),
      flag_zera_icms: form.flag_zera_icms, flag_usar_st_ret: form.flag_usar_st_ret,
      flag_bloqueia_credito_st: form.flag_bloqueia_credito_st,
      flag_para_no_match: form.flag_para_no_match, flag_apenas_alerta: form.flag_apenas_alerta,
    };
    if (editandoId.value) await axios.put(`${API_BASE_URL}/api/regras-fiscais/${editandoId.value}`, payload, auth());
    else await axios.post(`${API_BASE_URL}/api/regras-fiscais`, payload, auth());
    modal.value = false; await carregar();
  } catch (e) { alert('Erro ao salvar: ' + (e.response?.data?.message || e.message)); }
  finally { salvando.value = false; }
}
async function toggleAtivo(r) {
  try { await axios.patch(`${API_BASE_URL}/api/regras-fiscais/${r.id}/ativar`, {}, auth()); await carregar(); }
  catch (e) { alert('Erro: ' + (e.response?.data?.message || e.message)); }
}
async function duplicar(r) {
  try { await axios.post(`${API_BASE_URL}/api/regras-fiscais/${r.id}/duplicar`, {}, auth()); await carregar(); }
  catch (e) { alert('Erro: ' + (e.response?.data?.message || e.message)); }
}
async function excluir(r) {
  if (!confirm(`Excluir a regra "${r.nome}" (prio ${r.prioridade})?\nIsso afeta a exportação se a regra estiver ativa em escopo export/ambos.`)) return;
  try { await axios.delete(`${API_BASE_URL}/api/regras-fiscais/${r.id}`, auth()); await carregar(); }
  catch (e) { alert('Erro: ' + (e.response?.data?.message || e.message)); }
}

// ---------- Simulador ----------
const sim = ref(false);
const simItem = reactive({ ncm: '27101259', cst_icms: '061', cfop: '1652', cst_pis: '07', cst_cofins: '07', ind_oper: '0', competencia: '2024-04' });
const simRes = ref(null);
const simLoad = ref(false);
async function simular() {
  simLoad.value = true; simRes.value = null;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/regras-fiscais/simular`, {
      item: { ncm: simItem.ncm, cst_icms: simItem.cst_icms, cfop: simItem.cfop, cst_pis: simItem.cst_pis, cst_cofins: simItem.cst_cofins, ind_oper: simItem.ind_oper },
      competencia: simItem.competencia, escopo: 'ambos'
    }, auth());
    simRes.value = res.data;
  } catch (e) { alert('Erro ao simular: ' + (e.response?.data?.message || e.message)); }
  finally { simLoad.value = false; }
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3 mb-2">
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-xl bg-brand-accent/10"><Scale class="w-5 h-5 text-brand-accent" /></div>
        <div>
          <h1 class="text-xl font-black text-slate-800">Regras Fiscais</h1>
          <p class="text-xs text-slate-500">Cadastro <b>global</b> (condição → ação), aplicado na injeção/exportação. Vigência por competência.</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button @click="sim = true" class="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><FlaskConical class="w-4 h-4" /> Simulador</button>
        <button @click="abrirNova" class="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-accent text-white hover:bg-blue-700 font-semibold"><Plus class="w-4 h-4" /> Nova regra</button>
      </div>
    </div>

    <!-- Filtros -->
    <div class="flex flex-wrap items-center gap-2 my-4">
      <div class="relative flex-1 min-w-[200px]">
        <Search class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input v-model="busca" placeholder="Buscar por nome ou fundamento…" class="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-accent/30" />
      </div>
      <select v-model="filtroEscopo" @change="carregar" class="text-sm border border-slate-200 rounded-lg px-3 py-2">
        <option value="">Todos os escopos</option><option value="ambos">ambos</option><option value="export">export</option><option value="injecao">injeção</option>
      </select>
      <select v-model="filtroAtivo" @change="carregar" class="text-sm border border-slate-200 rounded-lg px-3 py-2">
        <option value="">Ativas e inativas</option><option value="true">Só ativas</option><option value="false">Só inativas</option>
      </select>
      <button @click="carregar" class="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><RefreshCw class="w-4 h-4" /> Atualizar</button>
    </div>

    <div v-if="erro" class="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-4">{{ erro }}</div>
    <div v-if="carregando" class="text-sm text-slate-500 italic">Carregando…</div>

    <!-- Lista -->
    <div v-else class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-200">
          <tr>
            <th class="py-2.5 px-3 text-center w-12">Prio</th><th class="py-2.5 px-3">Regra</th><th class="py-2.5 px-3">QUANDO</th>
            <th class="py-2.5 px-3">ENTÃO</th><th class="py-2.5 px-3 text-center">Vig. ≥</th><th class="py-2.5 px-3 text-center">Status</th><th class="py-2.5 px-3 text-center">Ações</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-50">
          <tr v-for="r in filtradas" :key="r.id" class="hover:bg-slate-50/60 align-top">
            <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-400">{{ r.prioridade }}</td>
            <td class="py-2.5 px-3"><div class="text-xs font-bold text-slate-700">{{ r.nome }}</div><div class="text-[10px] text-slate-400 mt-0.5">{{ r.fundamento_legal }}</div></td>
            <td class="py-2.5 px-3 text-[11px] text-slate-600">{{ condTexto(r) }}</td>
            <td class="py-2.5 px-3 text-[11px] font-medium text-slate-700">{{ acaoTexto(r) }}</td>
            <td class="py-2.5 px-3 text-center text-[10px] font-mono text-slate-500">{{ fmtData(r.dt_ini) }}</td>
            <td class="py-2.5 px-3 text-center whitespace-nowrap">
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" :class="corEscopo[r.escopo_aplicacao] || 'bg-slate-100 text-slate-600'">{{ r.escopo_aplicacao }}</span>
              <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ml-1" :class="corConf[r.confianca] || 'bg-slate-100'">{{ r.confianca }}</span>
              <div class="mt-1"><span class="text-[9px] font-black px-2 py-0.5 rounded-full" :class="r.ativo ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-slate-600'">{{ r.ativo ? 'ATIVA' : 'inativa' }}</span></div>
            </td>
            <td class="py-2.5 px-3 text-center whitespace-nowrap">
              <button @click="abrirEditar(r)" title="Editar" class="p-1.5 text-slate-400 hover:text-brand-accent"><Pencil class="w-3.5 h-3.5" /></button>
              <button @click="duplicar(r)" title="Duplicar" class="p-1.5 text-slate-400 hover:text-blue-600"><Copy class="w-3.5 h-3.5" /></button>
              <button @click="toggleAtivo(r)" :title="r.ativo ? 'Desativar' : 'Ativar'" class="p-1.5" :class="r.ativo ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500'"><Power class="w-3.5 h-3.5" /></button>
              <button @click="excluir(r)" title="Excluir" class="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 class="w-3.5 h-3.5" /></button>
            </td>
          </tr>
          <tr v-if="!filtradas.length"><td colspan="7" class="py-8 text-center text-sm text-slate-400 italic">Nenhuma regra encontrada.</td></tr>
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-slate-400 mt-3">{{ filtradas.length }} regra(s) · tabela <code>regras_fiscais</code> · alterações refletem na próxima exportação.</p>

    <!-- ===== Modal: criar/editar ===== -->
    <Teleport to="body">
      <div v-if="modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" @click.self="modal = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100 sticky top-0 bg-white">
            <h3 class="font-black text-slate-800">{{ editandoId ? 'Editar regra' : 'Nova regra fiscal' }}</h3>
            <button @click="modal = false" class="text-slate-400 hover:text-slate-700"><X class="w-5 h-5" /></button>
          </div>
          <div class="p-5 space-y-4 text-sm">
            <!-- Identificação -->
            <div class="grid grid-cols-12 gap-3">
              <div class="col-span-8"><label class="text-[10px] uppercase font-bold text-slate-400">Nome *</label><input v-model="form.nome" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-2"><label class="text-[10px] uppercase font-bold text-slate-400">Prioridade</label><input v-model="form.prioridade" type="number" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-2 flex items-end pb-1.5"><label class="flex items-center gap-1.5"><input type="checkbox" v-model="form.ativo" class="accent-emerald-500" /> <span class="text-xs">Ativa</span></label></div>
              <div class="col-span-12"><label class="text-[10px] uppercase font-bold text-slate-400">Fundamento legal</label><input v-model="form.fundamento_legal" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-4"><label class="text-[10px] uppercase font-bold text-slate-400">Escopo</label><select v-model="form.escopo_aplicacao" class="w-full border border-slate-200 rounded-lg px-2 py-1.5"><option value="ambos">ambos</option><option value="export">export</option><option value="injecao">injeção</option></select></div>
              <div class="col-span-4"><label class="text-[10px] uppercase font-bold text-slate-400">Confiança</label><select v-model="form.confianca" class="w-full border border-slate-200 rounded-lg px-2 py-1.5"><option value="alta">alta</option><option value="media">media</option><option value="baixa">baixa</option></select></div>
              <div class="col-span-2"><label class="text-[10px] uppercase font-bold text-slate-400">Vig. início</label><input v-model="form.dt_ini" type="date" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-2"><label class="text-[10px] uppercase font-bold text-slate-400">Vig. fim</label><input v-model="form.dt_fim" type="date" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
            </div>
            <!-- QUANDO -->
            <div class="bg-slate-50 rounded-xl p-3">
              <div class="text-[10px] uppercase font-black tracking-wider text-slate-500 mb-2">QUANDO (condições)</div>
              <div class="grid grid-cols-12 gap-3">
                <div class="col-span-3"><label class="text-[10px] text-slate-400">Operação</label><select v-model="form.ind_oper" class="w-full border border-slate-200 rounded-lg px-2 py-1.5"><option value="">Ambos</option><option value="0">Entrada</option><option value="1">Saída</option></select></div>
                <div class="col-span-3"><label class="text-[10px] text-slate-400">NCM (prefixo)</label><input v-model="form.ncm_prefix" placeholder="ex: 2710" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
                <div class="col-span-3"><label class="text-[10px] text-slate-400">CFOP origem (prefixo)</label><input v-model="form.cfop_origem" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
                <div class="col-span-3"><label class="text-[10px] text-slate-400">CST origem (lista)</label><input v-model="cstOrigemStr" placeholder="ex: 60, 61" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              </div>
            </div>
            <!-- ENTÃO -->
            <div class="bg-emerald-50/50 rounded-xl p-3">
              <div class="text-[10px] uppercase font-black tracking-wider text-emerald-700 mb-2">ENTÃO (ações — vazio = mantém)</div>
              <div class="grid grid-cols-12 gap-3">
                <div class="col-span-3"><label class="text-[10px] text-slate-400">CST ICMS</label><select v-model="form.acao_cst_icms" class="w-full border border-slate-200 rounded-lg px-2 py-1.5"><option value="">—</option><option v-for="c in CST_ICMS" :key="c" :value="c">{{ c }}</option></select></div>
                <div class="col-span-3"><label class="text-[10px] text-slate-400">CFOP</label><input v-model="form.acao_cfop" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
                <div class="col-span-3"><label class="text-[10px] text-slate-400">CST PIS</label><select v-model="form.acao_cst_pis" class="w-full border border-slate-200 rounded-lg px-2 py-1.5"><option value="">—</option><option v-for="c in CST_PISCOFINS" :key="c" :value="c">{{ c }}</option></select></div>
                <div class="col-span-3"><label class="text-[10px] text-slate-400">CST COFINS</label><select v-model="form.acao_cst_cofins" class="w-full border border-slate-200 rounded-lg px-2 py-1.5"><option value="">—</option><option v-for="c in CST_PISCOFINS" :key="c" :value="c">{{ c }}</option></select></div>
              </div>
              <div class="flex flex-wrap gap-4 mt-3 text-xs">
                <label class="flex items-center gap-1.5"><input type="checkbox" v-model="form.flag_zera_icms" /> zera ICMS</label>
                <label class="flex items-center gap-1.5"><input type="checkbox" v-model="form.flag_usar_st_ret" /> usa ST retido</label>
                <label class="flex items-center gap-1.5"><input type="checkbox" v-model="form.flag_bloqueia_credito_st" /> bloqueia crédito ST</label>
                <label class="flex items-center gap-1.5"><input type="checkbox" v-model="form.flag_apenas_alerta" /> só alerta (não aplica)</label>
                <label class="flex items-center gap-1.5"><input type="checkbox" v-model="form.flag_para_no_match" /> para no 1º match</label>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 sticky bottom-0 bg-white">
            <button @click="modal = false" class="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm">Cancelar</button>
            <button @click="salvar" :disabled="salvando" class="px-4 py-2 rounded-lg bg-brand-accent text-white text-sm font-bold disabled:opacity-50">{{ salvando ? 'Salvando…' : 'Salvar' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ===== Modal: simulador ===== -->
    <Teleport to="body">
      <div v-if="sim" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" @click.self="sim = false">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
          <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h3 class="font-black text-slate-800 flex items-center gap-2"><FlaskConical class="w-4 h-4 text-brand-accent" /> Simulador de regras</h3>
            <button @click="sim = false" class="text-slate-400 hover:text-slate-700"><X class="w-5 h-5" /></button>
          </div>
          <div class="p-5 space-y-4 text-sm">
            <p class="text-xs text-slate-500">Informe um item e veja qual(is) regra(s) casa(m) e o resultado — sem persistir nada.</p>
            <div class="grid grid-cols-12 gap-3">
              <div class="col-span-3"><label class="text-[10px] text-slate-400">NCM</label><input v-model="simItem.ncm" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-2"><label class="text-[10px] text-slate-400">CST ICMS</label><input v-model="simItem.cst_icms" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-2"><label class="text-[10px] text-slate-400">CFOP</label><input v-model="simItem.cfop" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-2"><label class="text-[10px] text-slate-400">CST PIS</label><input v-model="simItem.cst_pis" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-2"><label class="text-[10px] text-slate-400">COFINS</label><input v-model="simItem.cst_cofins" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-1"><label class="text-[10px] text-slate-400">Oper</label><select v-model="simItem.ind_oper" class="w-full border border-slate-200 rounded-lg px-1 py-1.5"><option value="0">E</option><option value="1">S</option></select></div>
              <div class="col-span-3"><label class="text-[10px] text-slate-400">Competência</label><input v-model="simItem.competencia" placeholder="2024-04" class="w-full border border-slate-200 rounded-lg px-2 py-1.5" /></div>
              <div class="col-span-9 flex items-end"><button @click="simular" :disabled="simLoad" class="px-4 py-2 rounded-lg bg-brand-accent text-white text-sm font-bold disabled:opacity-50">{{ simLoad ? 'Simulando…' : 'Simular' }}</button></div>
            </div>
            <div v-if="simRes" class="bg-slate-50 rounded-xl p-3 text-xs space-y-2">
              <div class="grid grid-cols-2 gap-3">
                <div><div class="text-[10px] uppercase font-bold text-slate-400">Antes</div><div class="font-mono">CST {{ simRes.antes.cst_icms }} · CFOP {{ simRes.antes.cfop }} · PIS {{ simRes.antes.cst_pis }} · COFINS {{ simRes.antes.cst_cofins }}</div></div>
                <div><div class="text-[10px] uppercase font-bold text-emerald-600">Depois</div><div class="font-mono text-emerald-700 font-bold">CST {{ simRes.depois.cst_icms }} · CFOP {{ simRes.depois.cfop }} · PIS {{ simRes.depois.cst_pis }} · COFINS {{ simRes.depois.cst_cofins }}</div></div>
              </div>
              <div>
                <div class="text-[10px] uppercase font-bold text-slate-400 mb-1">Regras que casaram ({{ simRes.trilha.length }})</div>
                <div v-if="!simRes.trilha.length" class="text-slate-400 italic">Nenhuma regra casou (competência {{ simRes.competencia }}).</div>
                <div v-for="(t, i) in simRes.trilha" :key="i" class="text-slate-600">▸ <b>{{ t.nome }}</b> <span class="text-slate-400">({{ t.fundamento }})</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
