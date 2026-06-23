<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { token } from '../store';
import { Plus, Edit2, Trash2, Save, X, Tag, Search, ChevronRight } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import UiButton from '@/components/ui/UiButton.vue';

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
    <div class="min-h-screen bg-paper p-6 md:p-10">

        <!-- Notificação -->
        <transition name="fade">
            <div v-if="notification.show"
                :class="notification.type === 'success' ? 'bg-conforme/[0.06] border-conforme/25 text-conforme' : 'bg-lacre/[0.06] border-lacre/25 text-lacre'"
                class="fixed top-5 right-5 z-50 border rounded-md px-5 py-3 text-[13px] font-medium card-shadow">
                {{ notification.message }}
            </div>
        </transition>

        <div class="max-w-3xl mx-auto flex flex-col gap-6">

            <!-- Header -->
            <div>
                <div class="flex items-center gap-2 text-[11px] text-risco font-medium mb-2">
                    <span @click="router.push('/')" class="hover:text-bronze cursor-pointer transition-colors">Início</span>
                    <ChevronRight class="w-3 h-3" :stroke-width="1.8" />
                    <span class="text-ink">Cadastro de CFOPs</span>
                </div>
                <h1 class="font-display text-[22px] font-semibold text-ink tracking-[-0.01em]">Cadastro de CFOPs</h1>
                <p class="text-risco text-[13px] mt-1">Gerencie os CFOPs disponíveis para seleção na injeção de XMLs.</p>
            </div>

            <!-- Barra de ações -->
            <div class="flex items-center gap-3">
                <div class="relative flex-1">
                    <Search class="w-4 h-4 text-risco absolute left-3 top-1/2 -translate-y-1/2" :stroke-width="1.8" />
                    <input
                        v-model="searchTerm"
                        placeholder="Buscar por código ou descrição..."
                        class="w-full pl-9 pr-3 py-2.5 bg-sheet border border-line rounded-md text-[13px] text-ink placeholder-risco outline-none focus:border-bronze transition-colors"
                    />
                </div>
                <UiButton
                    @click="iniciarNovo"
                    :disabled="editando !== null"
                    class="disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus class="w-4 h-4" :stroke-width="2" />
                    Novo CFOP
                </UiButton>
            </div>

            <!-- Formulário de novo/edição -->
            <div v-if="editando" class="bg-sheet rounded-md border border-bronze/40 card-shadow p-5 flex flex-col gap-4">
                <h3 class="text-[13px] font-semibold text-ink flex items-center gap-2">
                    <Tag class="w-4 h-4 text-bronze" :stroke-width="1.8" />
                    {{ editando.id ? 'Editar CFOP' : 'Novo CFOP' }}
                </h3>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div class="flex flex-col gap-1">
                        <label class="text-[11px] uppercase tracking-wide text-risco font-medium">Código *</label>
                        <input
                            v-model="editando.codigo"
                            placeholder="ex: 1102"
                            maxlength="10"
                            class="bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink font-mono outline-none focus:border-bronze transition-colors"
                        />
                    </div>
                    <div class="flex flex-col gap-1 sm:col-span-2">
                        <label class="text-[11px] uppercase tracking-wide text-risco font-medium">Descrição</label>
                        <input
                            v-model="editando.descricao"
                            placeholder="ex: Compra para Comercialização"
                            class="bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze transition-colors"
                        />
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-[11px] uppercase tracking-wide text-risco font-medium">Tipo</label>
                        <select
                            v-model="editando.tipo"
                            class="bg-sheet border border-line rounded-md px-3 py-2 text-[13px] text-ink outline-none focus:border-bronze appearance-none cursor-pointer transition-colors"
                        >
                            <option value="entrada">Entrada</option>
                            <option value="saida">Saída</option>
                            <option value="ambos">Ambos</option>
                        </select>
                    </div>
                </div>

                <p v-if="formErro" class="text-[12px] text-lacre font-medium">{{ formErro }}</p>

                <div class="flex gap-2 justify-end">
                    <UiButton variant="ghost" @click="cancelarEdicao">
                        <X class="w-4 h-4" :stroke-width="1.8" /> Cancelar
                    </UiButton>
                    <UiButton @click="salvar">
                        <Save class="w-4 h-4" :stroke-width="1.8" /> Salvar
                    </UiButton>
                </div>
            </div>

            <!-- Lista de CFOPs -->
            <div class="bg-sheet rounded-md border border-line card-shadow overflow-hidden">
                <div class="px-5 py-4 border-b border-line flex items-center justify-between">
                    <span class="text-[11px] uppercase tracking-wide text-risco font-medium">
                        {{ filteredCfops.length }} CFOP(s) cadastrado(s)
                    </span>
                    <span v-if="isLoading" class="text-[11px] text-risco">Carregando...</span>
                </div>

                <div v-if="cfops.length === 0 && !isLoading" class="py-16 text-center text-risco text-[13px]">
                    Nenhum CFOP cadastrado. Clique em "Novo CFOP" para começar.
                </div>

                <table v-else class="w-full text-[13px]">
                    <thead>
                        <tr class="bg-paper text-[10px] uppercase tracking-wide text-risco font-medium">
                            <th class="text-left px-5 py-3">Código</th>
                            <th class="text-left px-5 py-3">Descrição</th>
                            <th class="text-left px-5 py-3">Tipo</th>
                            <th class="px-5 py-3"></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="cfop in filteredCfops" :key="cfop.id"
                            class="hover:bg-paper transition-colors"
                            :class="{ 'bg-bronze/[0.04]': editando?.id === cfop.id }">
                            <td class="px-5 py-3 font-mono font-medium text-ink">{{ cfop.codigo }}</td>
                            <td class="px-5 py-3 text-risco">{{ cfop.descricao || '—' }}</td>
                            <td class="px-5 py-3">
                                <span :class="{
                                    'bg-conforme/10 text-conforme border-conforme/20': cfop.tipo === 'entrada',
                                    'bg-variacao/10 text-variacao border-variacao/20': cfop.tipo === 'saida',
                                    'bg-paper text-risco border-line': cfop.tipo === 'ambos' || !cfop.tipo
                                }" class="text-[10px] font-medium px-2 py-0.5 rounded uppercase border">
                                    {{ cfop.tipo || 'entrada' }}
                                </span>
                            </td>
                            <td class="px-5 py-3">
                                <div class="flex items-center justify-end gap-2">
                                    <button @click="iniciarEdicao(cfop)"
                                        :disabled="editando !== null"
                                        class="text-risco hover:text-bronze transition-colors disabled:opacity-30"
                                        title="Editar">
                                        <Edit2 class="w-4 h-4" :stroke-width="1.6" />
                                    </button>
                                    <button @click="excluir(cfop)"
                                        :disabled="editando !== null"
                                        class="text-risco hover:text-lacre transition-colors disabled:opacity-30"
                                        title="Excluir">
                                        <Trash2 class="w-4 h-4" :stroke-width="1.6" />
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
.card-shadow { box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
