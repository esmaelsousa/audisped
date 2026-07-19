<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import UiButton from '@/components/ui/UiButton.vue'
import { Sparkles, RefreshCw, ExternalLink, Trash2, Check } from 'lucide-vue-next'

const leads = ref([])
const isLoading = ref(false)
const erro = ref('')
const savingId = ref(null)   // lead sendo salvo
const savedId = ref(null)    // lead recém-salvo (mostra "salvo")

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

// Salva a nota ao sair do campo (só se mudou desde o carregamento).
async function salvarNota(l) {
  if ((l.notas || '') === (l._notasOrig || '')) return
  savingId.value = l.id
  try {
    await axios.patch(`${API_BASE_URL}/api/admin/demo-leads/${l.id}`, { notas: l.notas || '' })
    l._notasOrig = l.notas || ''
    savedId.value = l.id
    setTimeout(() => { if (savedId.value === l.id) savedId.value = null }, 2000)
  } catch (e) {
    erro.value = e.response?.data?.message || 'Erro ao salvar a nota.'
  } finally {
    savingId.value = null
  }
}

async function excluirLead(l) {
  if (!window.confirm(`Excluir o lead ${fmtCnpj(l.cnpj)} (${l.email})?\nEsta ação não pode ser desfeita.`)) return
  try {
    await axios.delete(`${API_BASE_URL}/api/admin/demo-leads/${l.id}`)
    leads.value = leads.value.filter(x => x.id !== l.id)
  } catch (e) {
    erro.value = e.response?.data?.message || 'Erro ao excluir o lead.'
  }
}

onMounted(async () => {
  await loadLeads()
  // guarda o valor original das notas p/ detectar mudança no blur
  leads.value.forEach(l => { l._notasOrig = l.notas || '' })
})
</script>

<template>
  <div class="max-w-6xl mx-auto">

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
    <p class="text-[13px] text-risco mb-5">Quem preencheu o formulário de teste grátis na landing page. Mais recentes primeiro. Use a coluna <b>Notas</b> para registrar o andamento de cada contato.</p>

    <p v-if="erro" class="mb-4 px-3 py-2 rounded-md text-[13px] border bg-lacre/5 border-lacre/30 text-lacre">{{ erro }}</p>

    <!-- Tabela -->
    <div class="border border-line rounded-md overflow-x-auto">
      <table class="w-full text-[13px]">
        <thead>
          <tr class="bg-paper text-risco text-[11px] uppercase tracking-wide">
            <th class="text-left font-medium px-3 py-2 whitespace-nowrap">Data</th>
            <th class="text-left font-medium px-3 py-2">CNPJ</th>
            <th class="text-left font-medium px-3 py-2">E-mail</th>
            <th class="text-left font-medium px-3 py-2">Telefone</th>
            <th class="text-left font-medium px-3 py-2 min-w-[220px]">Notas</th>
            <th class="text-right font-medium px-3 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="isLoading">
            <td colspan="6" class="px-3 py-6 text-center text-risco">Carregando…</td>
          </tr>
          <tr v-else-if="!leads.length">
            <td colspan="6" class="px-3 py-6 text-center text-risco">Nenhum lead ainda. Assim que alguém testar, aparece aqui.</td>
          </tr>
          <tr v-for="l in leads" :key="l.id" class="border-t border-line align-top">
            <td class="px-3 py-2 text-risco whitespace-nowrap font-mono text-[12px]">{{ fmtData(l.created_at) }}</td>
            <td class="px-3 py-2 text-ink font-mono text-[12px] whitespace-nowrap">{{ fmtCnpj(l.cnpj) }}</td>
            <td class="px-3 py-2 text-ink"><a :href="`mailto:${l.email}`" class="hover:text-bronze">{{ l.email }}</a></td>
            <td class="px-3 py-2 text-ink whitespace-nowrap">{{ fmtFone(l.telefone) }}</td>
            <td class="px-3 py-2">
              <textarea
                v-model="l.notas"
                @blur="salvarNota(l)"
                rows="2"
                placeholder="Ex.: fiz contato e não obtive resposta…"
                class="w-full min-w-[200px] resize-y rounded-md border border-line bg-sheet px-2 py-1 text-[12px] text-ink placeholder:text-muted focus:border-bronze focus:outline-none"
              ></textarea>
              <span v-if="savingId === l.id" class="text-[11px] text-muted">salvando…</span>
              <span v-else-if="savedId === l.id" class="inline-flex items-center gap-1 text-[11px] text-conforme">
                <Check :size="12" :stroke-width="2" /> salvo
              </span>
            </td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-3">
                <a :href="wa(l.telefone)" target="_blank" rel="noopener"
                   class="inline-flex items-center gap-1 text-[12px] text-conforme hover:underline">
                  WhatsApp <ExternalLink :size="12" :stroke-width="1.8" />
                </a>
                <button
                  type="button"
                  @click="excluirLead(l)"
                  title="Excluir lead"
                  class="inline-flex items-center gap-1 text-[12px] text-lacre hover:underline"
                >
                  <Trash2 :size="13" :stroke-width="1.8" /> Excluir
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
