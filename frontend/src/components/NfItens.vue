<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import { API_BASE_URL } from '../api';

// Mostra os itens (C170) de uma NF escriturada, buscados por chave. Auto-carrega ao montar.
const props = defineProps({ chave: String, cnpj: String });
const loading = ref(true);
const erro = ref('');
const itens = ref([]);

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

onMounted(async () => {
    const c = String(props.chave || '').replace(/\D/g, '');
    if (c.length < 44) { loading.value = false; erro.value = 'Chave inválida.'; return; }
    try {
        const tk = localStorage.getItem('token');
        const cnpj = String(props.cnpj || '').replace(/\D/g, '');
        const res = await axios.get(`${API_BASE_URL}/api/conciliacao/itens-nf/${c}?cnpj=${cnpj}`, {
            headers: tk ? { Authorization: `Bearer ${tk}` } : {}
        });
        itens.value = res.data.itens || [];
    } catch (e) {
        erro.value = e.response?.data?.message || ('Erro ao carregar itens: ' + e.message);
    } finally {
        loading.value = false;
    }
});
</script>

<template>
    <div class="p-3 bg-slate-50/80">
        <div v-if="loading" class="text-[11px] text-slate-400">Carregando itens…</div>
        <div v-else-if="erro" class="text-[11px] text-red-500">{{ erro }}</div>
        <div v-else-if="!itens.length" class="text-[11px] text-slate-400">Nenhum item encontrado (nota não escriturada no sistema).</div>
        <table v-else class="w-full text-[11px]">
            <thead class="text-slate-500">
                <tr>
                    <th class="text-left p-1">Cód.</th>
                    <th class="text-left p-1">Produto</th>
                    <th class="text-right p-1">Qtd</th>
                    <th class="text-left p-1">Un</th>
                    <th class="text-right p-1">Vl. Unit.</th>
                    <th class="text-right p-1">Vl. Total</th>
                    <th class="text-left p-1">CFOP</th>
                    <th class="text-left p-1">CST</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(it, j) in itens" :key="j" class="border-t border-slate-200/70">
                    <td class="p-1">{{ it.cod_item }}</td>
                    <td class="p-1">{{ it.produto }}</td>
                    <td class="p-1 text-right">{{ fmtNum(it.qtd) }}</td>
                    <td class="p-1">{{ it.unid }}</td>
                    <td class="p-1 text-right">{{ fmtBRL(it.vl_unit) }}</td>
                    <td class="p-1 text-right font-semibold text-slate-700">{{ fmtBRL(it.vl_total) }}</td>
                    <td class="p-1">{{ it.cfop }}</td>
                    <td class="p-1">{{ it.cst }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
