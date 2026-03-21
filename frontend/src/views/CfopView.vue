<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { token } from '../store';
import { Plus, Edit2, Trash2, Save, X, Tag, Search, ChevronRight } from 'lucide-vue-next';
import { useRouter } from 'vue-router';

const router = useRouter();

const cfops = ref([]);
const isLoading = ref(false);
const searchTerm = ref('');
const notification = ref({ show: false, message: '', type: 'success' });

// Formulário inline de edição/criação
const editando = ref(null); // { id, codigo, descricao, tipo } ou null (novo)
const formErro = ref('');

const filteredCfops = computed(() => {
    if (!searchTerm.value) return cfops.value;
    const t = searchTerm.value.toLowerCase();
    return cfops.value.filter(c =>
        c.codigo.includes(t) || (c.descricao || '').toLowerCase().includes(t)
    );
});

function notify(message, type = 'success') {
    notification.value = { show: true, message, type };
    setTimeout(() => { notification.value.show = false; }, 3500);
}

async function loadCfops() {
    isLoading.value = true;
    try {
        const res = await axios.get(`${API_BASE_URL}/api/cfops`, {
            headers: { Authorization: `Bearer ${token.value}` }
        });
        cfops.value = res.data;
    } catch (e) {
        notify('Erro ao carregar CFOPs.', 'error');
    } finally {
        isLoading.value = false;
    }
}

function iniciarNovo() {
    editando.value = { id: null, codigo: '', descricao: '', tipo: 'entrada' };
    formErro.value = '';
}

function iniciarEdicao(cfop) {
    editando.value = { ...cfop };
    formErro.value = '';
}

function cancelarEdicao() {
    editando.value = null;
    formErro.value = '';
}

async function salvar() {
    if (!editando.value.codigo.trim()) {
        formErro.value = 'O código do CFOP é obrigatório.';
        return;
    }
    formErro.value = '';
    try {
        if (editando.value.id) {
            await axios.put(`${API_BASE_URL}/api/cfops/${editando.value.id}`, editando.value, {
                headers: { Authorization: `Bearer ${token.value}` }
            });
            notify('CFOP atualizado com sucesso.');
        } else {
            await axios.post(`${API_BASE_URL}/api/cfops`, editando.value, {
                headers: { Authorization: `Bearer ${token.value}` }
            });
            notify('CFOP cadastrado com sucesso.');
        }
        editando.value = null;
        await loadCfops();
    } catch (e) {
        formErro.value = e.response?.data?.message || 'Erro ao salvar.';
    }
}

async function excluir(cfop) {
    if (!confirm(`Excluir o CFOP ${cfop.codigo} — ${cfop.descricao}?`)) return;
    try {
        await axios.delete(`${API_BASE_URL}/api/cfops/${cfop.id}`, {
            headers: { Authorization: `Bearer ${token.value}` }
        });
        notify('CFOP excluído.');
        await loadCfops();
    } catch (e) {
        notify('Erro ao excluir CFOP.', 'error');
    }
}

onMounted(loadCfops);
</script>

<template>
    <div class="min-h-screen bg-slate-50 p-6 md:p-10">

        <!-- Notificação -->
        <transition name="fade">
            <div v-if="notification.show"
                :class="notification.type === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-red-50 border-red-300 text-red-800'"
                class="fixed top-5 right-5 z-50 border rounded-xl px-5 py-3 text-sm font-semibold shadow-lg">
                {{ notification.message }}
            </div>
        </transition>

        <div class="max-w-3xl mx-auto flex flex-col gap-6">

            <!-- Header -->
            <div>
                <div class="flex items-center gap-2 text-xs text-slate-400 font-medium mb-2">
                    <span @click="router.push('/')" class="hover:text-brand-accent cursor-pointer transition-colors">Início</span>
                    <ChevronRight class="w-3 h-3" />
                    <span class="text-slate-900">Cadastro de CFOPs</span>
                </div>
                <h1 class="text-2xl font-semibold text-slate-900 tracking-tight">Cadastro de CFOPs</h1>
                <p class="text-slate-500 text-sm mt-1">Gerencie os CFOPs disponíveis para seleção na injeção de XMLs.</p>
            </div>

            <!-- Barra de ações -->
            <div class="flex items-center gap-3">
                <div class="relative flex-1">
                    <Search class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        v-model="searchTerm"
                        placeholder="Buscar por código ou descrição..."
                        class="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent"
                    />
                </div>
                <button
                    @click="iniciarNovo"
                    :disabled="editando !== null"
                    class="flex items-center gap-2 bg-brand-accent hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                    <Plus class="w-4 h-4" />
                    Novo CFOP
                </button>
            </div>

            <!-- Formulário de novo/edição -->
            <div v-if="editando" class="bg-white rounded-xl border border-brand-accent/40 shadow-sm p-5 flex flex-col gap-4">
                <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Tag class="w-4 h-4 text-brand-accent" />
                    {{ editando.id ? 'Editar CFOP' : 'Novo CFOP' }}
                </h3>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div class="flex flex-col gap-1">
                        <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Código *</label>
                        <input
                            v-model="editando.codigo"
                            placeholder="ex: 1102"
                            maxlength="10"
                            class="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent"
                        />
                    </div>
                    <div class="flex flex-col gap-1 sm:col-span-2">
                        <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Descrição</label>
                        <input
                            v-model="editando.descricao"
                            placeholder="ex: Compra para Comercialização"
                            class="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent"
                        />
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Tipo</label>
                        <select
                            v-model="editando.tipo"
                            class="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-accent appearance-none cursor-pointer bg-white"
                        >
                            <option value="entrada">Entrada</option>
                            <option value="saida">Saída</option>
                            <option value="ambos">Ambos</option>
                        </select>
                    </div>
                </div>

                <p v-if="formErro" class="text-xs text-red-600 font-medium">{{ formErro }}</p>

                <div class="flex gap-2 justify-end">
                    <button @click="cancelarEdicao" class="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                        <X class="w-4 h-4" /> Cancelar
                    </button>
                    <button @click="salvar" class="flex items-center gap-1.5 text-sm font-semibold bg-brand-accent hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors shadow-sm">
                        <Save class="w-4 h-4" /> Salvar
                    </button>
                </div>
            </div>

            <!-- Lista de CFOPs -->
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {{ filteredCfops.length }} CFOP(s) cadastrado(s)
                    </span>
                    <span v-if="isLoading" class="text-xs text-slate-400">Carregando...</span>
                </div>

                <div v-if="cfops.length === 0 && !isLoading" class="py-16 text-center text-slate-400 text-sm">
                    Nenhum CFOP cadastrado. Clique em "Novo CFOP" para começar.
                </div>

                <table v-else class="w-full text-sm">
                    <thead>
                        <tr class="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <th class="text-left px-5 py-3">Código</th>
                            <th class="text-left px-5 py-3">Descrição</th>
                            <th class="text-left px-5 py-3">Tipo</th>
                            <th class="px-5 py-3"></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        <tr v-for="cfop in filteredCfops" :key="cfop.id"
                            class="hover:bg-slate-50 transition-colors"
                            :class="{ 'bg-blue-50/40': editando?.id === cfop.id }">
                            <td class="px-5 py-3 font-mono font-bold text-slate-800">{{ cfop.codigo }}</td>
                            <td class="px-5 py-3 text-slate-600">{{ cfop.descricao || '—' }}</td>
                            <td class="px-5 py-3">
                                <span :class="{
                                    'bg-emerald-100 text-emerald-700': cfop.tipo === 'entrada',
                                    'bg-amber-100 text-amber-700': cfop.tipo === 'saida',
                                    'bg-slate-100 text-slate-600': cfop.tipo === 'ambos' || !cfop.tipo
                                }" class="text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                                    {{ cfop.tipo || 'entrada' }}
                                </span>
                            </td>
                            <td class="px-5 py-3">
                                <div class="flex items-center justify-end gap-2">
                                    <button @click="iniciarEdicao(cfop)"
                                        :disabled="editando !== null"
                                        class="text-slate-400 hover:text-brand-accent transition-colors disabled:opacity-30"
                                        title="Editar">
                                        <Edit2 class="w-4 h-4" />
                                    </button>
                                    <button @click="excluir(cfop)"
                                        :disabled="editando !== null"
                                        class="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30"
                                        title="Excluir">
                                        <Trash2 class="w-4 h-4" />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

        </div>
    </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
