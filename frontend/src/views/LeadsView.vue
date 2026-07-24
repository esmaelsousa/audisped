<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import UiButton from '@/components/ui/UiButton.vue'
import { Sparkles, RefreshCw, ExternalLink } from 'lucide-vue-next'

const leads = ref([])
const isLoading = ref(false)
const erro = ref('')

function fmtCnpj(c) {
  const s = String(c || '').replace(/\D/g, '')
  return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '—')
}
function fmtFone(f) {
  const s = String(f || '').replace(/\D/g, '')
  if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return f || '—'
}
function wa(f) {
  const s = String(f || '').replace(/\D/g, '')
  return s ? `https://wa.me/55${s}` : '#'
}
function fmtData(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return d }
}

async function loadLeads() {
  isLoading.value = true
  erro.value = ''
  try {
    const res = await axios.get(`${API_BASE_URL}/api/admin/demo-leads`)
    leads.value = res.data
  } catch (e) {
    erro.value = e.response?.data?.message || 'Erro ao carregar os leads.'
  } finally {
    isLoading.value = false
  }
}

onMounted(loadLeads)
</script>

<template>
  <div class="max-w-5xl mx-auto">

    <!-- Cabeçalho -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <Sparkles :size="20" class="text-bronze" :stroke-width="1.8" />
        <h1 class="font-display text-[18px] font-semibold text-ink">Leads do teste grátis</h1>
        <span v-if="leads.length" class="text-[12px] text-risco">({{ leads.length }})</span>
      </div>
      <UiButton @click="loadLeads" class="gap-1.5">
        <RefreshCw :size="15" :stroke-width="1.8" /> Atualizar
      </UiButton>
    </div>
    <p class="text-[13px] text-risco mb-5">Quem preencheu o formulário de teste grátis na landing page. Mais recentes primeiro.</p>

    <p v-if="erro" class="mb-4 px-3 py-2 rounded-md text-[13px] border bg-lacre/5 border-lacre/30 text-lacre">{{ erro }}</p>

    <!-- Tabela -->
    <div class="border border-line rounded-md overflow-hidden">
      <table class="w-full text-[13px]">
        <thead>
          <tr class="bg-paper text-risco text-[11px] uppercase tracking-wide">
            <th class="text-left font-medium px-3 py-2">Data</th>
            <th class="text-left font-medium px-3 py-2">CNPJ</th>
            <th class="text-left font-medium px-3 py-2">E-mail</th>
            <th class="text-left font-medium px-3 py-2">Telefone</th>
            <th class="text-right font-medium px-3 py-2">Ação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="isLoading">
            <td colspan="5" class="px-3 py-6 text-center text-risco">Carregando…</td>
          </tr>
          <tr v-else-if="!leads.length">
            <td colspan="5" class="px-3 py-6 text-center text-risco">Nenhum lead ainda. Assim que alguém testar, aparece aqui.</td>
          </tr>
          <tr v-for="l in leads" :key="l.id" class="border-t border-line">
            <td class="px-3 py-2 text-risco whitespace-nowrap font-mono text-[12px]">{{ fmtData(l.created_at) }}</td>
            <td class="px-3 py-2 text-ink font-mono text-[12px]">{{ fmtCnpj(l.cnpj) }}</td>
            <td class="px-3 py-2 text-ink"><a :href="`mailto:${l.email}`" class="hover:text-bronze">{{ l.email }}</a></td>
            <td class="px-3 py-2 text-ink">{{ fmtFone(l.telefone) }}</td>
            <td class="px-3 py-2 text-right">
              <a :href="wa(l.telefone)" target="_blank" rel="noopener"
                 class="inline-flex items-center gap-1 text-[12px] text-conforme hover:underline">
                WhatsApp <ExternalLink :size="12" :stroke-width="1.8" />
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
