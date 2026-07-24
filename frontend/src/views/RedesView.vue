<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { isSuper } from '../store'
import { formatCnpj } from '@/utils/sped'
import UiButton from '@/components/ui/UiButton.vue'
import {
  Network, Plus, Save, X, Pencil, Trash2, Building2, Search,
  UserPlus, Store, Undo2
} from 'lucide-vue-next'

const redes = ref([])
const empresas = ref([])          // todas as empresas (super vê tudo) — base p/ os postos de cada rede
const isLoading = ref(false)
const notification = ref({ show: false, message: '', type: 'success' })

// Modal de criar/editar rede — { id?, nome, documento, email_resp, status } ou null
const redeForm = ref(null)
const redeErro = ref('')

// Painel de postos — rede aberta (objeto rede) ou null
const painelRede = ref(null)
const buscaEmpresa = ref('')
const resultadoBusca = ref([])
const buscando = ref(false)

// Modal "Criar admin da rede" — { rede, nome, email, senha } ou null
const adminForm = ref(null)
const adminErro = ref('')

const STATUS_OPCOES = ['ativa', 'suspensa', 'cancelada']

function notify(message, type = 'success') {
  notification.value = { show: true, message, type }
  setTimeout(() => { notification.value.show = false }, 3500)
}

// Rede default (destino ao "remover" um posto de uma rede).
const redeDefault = computed(() => redes.value.find((r) => r.nome === 'default'))

// Postos de uma rede (a partir das empresas carregadas).
function postosDaRede(redeId) {
  return empresas.value.filter((e) => Number(e.rede_id) === Number(redeId))
}

async function loadRedes() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/admin/redes`)
    redes.value = res.data
  } catch (e) {
    notify('Erro ao carregar redes.', 'error')
  }
}

async function loadEmpresas() {
  try {
    const res = await axios.get(`${API_BASE_URL}/api/empresas`)
    empresas.value = res.data
  } catch (e) { /* silencioso — sem empresas o painel de postos fica vazio */ }
}

async function loadTudo() {
  isLoading.value = true
  try {
    await Promise.all([loadRedes(), loadEmpresas()])
  } finally {
    isLoading.value = false
  }
}

// ---------- Criar / editar rede ----------
function novaRede() {
  redeForm.value = { id: null, nome: '', documento: '', email_resp: '', status: 'ativa' }
  redeErro.value = ''
}
function editarRede(r) {
  redeForm.value = {
    id: r.id, nome: r.nome || '', documento: r.documento || '',
    email_resp: r.email_resp || '', status: r.status || 'ativa'
  }
  redeErro.value = ''
}
function cancelarRede() { redeForm.value = null; redeErro.value = '' }

async function salvarRede() {
  redeErro.value = ''
  const f = redeForm.value
  if (!f.nome.trim()) { redeErro.value = 'Informe o nome da rede.'; return }
  const body = {
    nome: f.nome.trim(),
    documento: f.documento.trim() || null,
    email_resp: f.email_resp.trim() || null,
    status: f.status
  }
  try {
    if (f.id) {
      await axios.put(`${API_BASE_URL}/api/admin/redes/${f.id}`, body)
      notify('Rede atualizada.')
    } else {
      await axios.post(`${API_BASE_URL}/api/admin/redes`, body)
      notify('Rede criada.')
    }
    redeForm.value = null
    await loadRedes()
  } catch (e) {
    redeErro.value = e.response?.data?.message || 'Erro ao salvar rede.'
  }
}

async function excluirRede(r) {
  if (r.postos > 0 || r.usuarios > 0) {
    notify('Rede com postos/usuários vinculados não pode ser excluída.', 'error')
    return
  }
  if (!confirm(`Excluir a rede "${r.nome}"?`)) return
  try {
    await axios.delete(`${API_BASE_URL}/api/admin/redes/${r.id}`)
    notify('Rede excluída.')
    if (painelRede.value?.id === r.id) painelRede.value = null
    await loadRedes()
  } catch (e) {
    notify(e.response?.data?.message || 'Erro ao excluir rede.', 'error')
  }
}

// ---------- Painel de postos ----------
function abrirPostos(r) {
  painelRede.value = painelRede.value?.id === r.id ? null : r
  buscaEmpresa.value = ''
  resultadoBusca.value = []
}

let buscaTimer = null
function onBuscaInput() {
  clearTimeout(buscaTimer)
  buscaTimer = setTimeout(buscarEmpresas, 300)
}
async function buscarEmpresas() {
  const q = buscaEmpresa.value.trim()
  if (!q) { resultadoBusca.value = []; return }
  buscando.value = true
  try {
    const res = await axios.get(`${API_BASE_URL}/api/empresas`, { params: { busca: q } })
    // Só oferece p/ associar quem não está já nesta rede.
    resultadoBusca.value = res.data.filter((e) => Number(e.rede_id) !== Number(painelRede.value?.id))
  } catch (e) {
    notify('Erro ao buscar empresas.', 'error')
  } finally {
    buscando.value = false
  }
}

async function associarPosto(empresa) {
  try {
    await axios.patch(`${API_BASE_URL}/api/admin/empresas/${empresa.id}/rede`, { rede_id: painelRede.value.id })
    notify(`${empresa.nome_empresa || 'Posto'} associado à rede.`)
    buscaEmpresa.value = ''
    resultadoBusca.value = []
    await loadTudo()
    // Reapontar o painel p/ a rede atualizada (contadores).
    painelRede.value = redes.value.find((r) => r.id === painelRede.value.id) || null
  } catch (e) {
    notify(e.response?.data?.message || 'Erro ao associar posto.', 'error')
  }
}

async function removerPosto(empresa) {
  const dest = redeDefault.value
  if (!dest) { notify('Rede default não encontrada.', 'error'); return }
  if (!confirm(`Remover "${empresa.nome_empresa || 'posto'}" da rede? (volta para a rede default)`)) return
  try {
    await axios.patch(`${API_BASE_URL}/api/admin/empresas/${empresa.id}/rede`, { rede_id: dest.id })
    notify('Posto movido para a rede default.')
    await loadTudo()
    painelRede.value = redes.value.find((r) => r.id === painelRede.value.id) || null
  } catch (e) {
    notify(e.response?.data?.message || 'Erro ao remover posto.', 'error')
  }
}

// ---------- Criar admin da rede ----------
function criarAdmin(r) {
  adminForm.value = { rede: r, nome: '', email: '', senha: '' }
  adminErro.value = ''
}
function cancelarAdmin() { adminForm.value = null; adminErro.value = '' }

async function salvarAdmin() {
  adminErro.value = ''
  const f = adminForm.value
  if (!f.nome.trim() || !f.email.trim() || !f.senha.trim()) {
    adminErro.value = 'Preencha nome, e-mail e senha.'; return
  }
  try {
    await axios.post(`${API_BASE_URL}/api/admin/usuarios`, {
      nome: f.nome.trim(), email: f.email.trim(), senha: f.senha,
      role: 'admin', rede_id: f.rede.id
    })
    notify(`Admin criado para a rede ${f.rede.nome}.`)
    adminForm.value = null
    await loadRedes()
  } catch (e) {
    adminErro.value = e.response?.data?.message || 'Erro ao criar admin.'
  }
}

onMounted(loadTudo)
</script>

<template>
  <div class="max-w-5xl mx-auto">

    <!-- Cabeçalho -->
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-2">
        <Network :size="20" class="text-bronze" :stroke-width="1.8" />
        <h1 class="font-display text-[18px] font-semibold text-ink">Redes</h1>
      </div>
      <UiButton @click="novaRede" class="gap-1.5">
        <Plus :size="15" :stroke-width="1.8" /> Nova rede
      </UiButton>
    </div>

    <!-- Toast -->
    <div v-if="notification.show"
      :class="['mb-4 px-3 py-2 rounded-md text-[13px] border',
        notification.type === 'error' ? 'bg-lacre/5 border-lacre/30 text-lacre' : 'bg-bronze/5 border-bronze/30 text-ink']">
      {{ notification.message }}
    </div>

    <!-- Form de rede (criar/editar) -->
    <div v-if="redeForm" class="mb-5 p-4 rounded-md border border-line bg-sheet">
      <p class="text-[13px] font-medium text-ink mb-3">{{ redeForm.id ? 'Editar rede' : 'Nova rede' }}</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nome</label>
          <input v-model="redeForm.nome" type="text" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="Nome da rede" />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Documento (CNPJ)</label>
          <input v-model="redeForm.documento" type="text" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="opcional" />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">E-mail do responsável</label>
          <input v-model="redeForm.email_resp" type="email" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="opcional" />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Status</label>
          <select v-model="redeForm.status" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none">
            <option v-for="s in STATUS_OPCOES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </div>
      <p v-if="redeErro" class="text-[12px] text-lacre mt-2">{{ redeErro }}</p>
      <div class="flex gap-2 mt-3">
        <UiButton @click="salvarRede" class="gap-1.5"><Save :size="15" :stroke-width="1.8" /> Salvar</UiButton>
        <button @click="cancelarRede" class="px-3 py-2 text-[13px] text-risco hover:text-ink bg-transparent border border-line rounded-md cursor-pointer">Cancelar</button>
      </div>
    </div>

    <!-- Modal criar admin da rede -->
    <div v-if="adminForm" class="mb-5 p-4 rounded-md border border-bronze/40 bg-bronze/5">
      <p class="text-[13px] font-medium text-ink mb-1">Criar admin da rede <b>{{ adminForm.rede.nome }}</b></p>
      <p class="text-[11px] text-risco mb-3">O usuário será criado como <b>Admin</b> desta rede e obrigado a trocar a senha no 1º login.</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nome</label>
          <input v-model="adminForm.nome" type="text" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="Nome completo" />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">E-mail</label>
          <input v-model="adminForm.email" type="email" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="nome@empresa.com" />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Senha inicial</label>
          <input v-model="adminForm.senha" type="text" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="senha temporária" />
        </div>
      </div>
      <p v-if="adminErro" class="text-[12px] text-lacre mt-2">{{ adminErro }}</p>
      <div class="flex gap-2 mt-3">
        <UiButton @click="salvarAdmin" class="gap-1.5"><UserPlus :size="15" :stroke-width="1.8" /> Criar admin</UiButton>
        <button @click="cancelarAdmin" class="px-3 py-2 text-[13px] text-risco hover:text-ink bg-transparent border border-line rounded-md cursor-pointer">Cancelar</button>
      </div>
    </div>

    <!-- Tabela de redes -->
    <div class="border border-line rounded-md overflow-hidden">
      <table class="w-full text-[13px]">
        <thead>
          <tr class="bg-paper text-risco text-[11px] uppercase tracking-wide">
            <th class="text-left font-medium px-3 py-2">Nome</th>
            <th class="text-left font-medium px-3 py-2">Documento</th>
            <th class="text-left font-medium px-3 py-2">Status</th>
            <th class="text-right font-medium px-3 py-2">Postos</th>
            <th class="text-right font-medium px-3 py-2">Usuários</th>
            <th class="text-right font-medium px-3 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="isLoading">
            <td colspan="6" class="px-3 py-6 text-center text-risco">Carregando…</td>
          </tr>
          <tr v-else-if="!redes.length">
            <td colspan="6" class="px-3 py-6 text-center text-risco">Nenhuma rede.</td>
          </tr>
          <template v-for="r in redes" :key="r.id">
            <tr class="border-t border-line" :class="{ 'bg-bronze/[.04]': painelRede?.id === r.id }">
              <td class="px-3 py-2 text-ink font-medium">{{ r.nome }}</td>
              <td class="px-3 py-2 text-risco">{{ r.documento ? formatCnpj(r.documento) : '—' }}</td>
              <td class="px-3 py-2">
                <span :class="r.status === 'ativa' ? 'text-bronze' : 'text-lacre'">{{ r.status }}</span>
              </td>
              <td class="px-3 py-2 text-right text-ink tabular-nums">{{ r.postos }}</td>
              <td class="px-3 py-2 text-right text-ink tabular-nums">{{ r.usuarios }}</td>
              <td class="px-3 py-2 text-right">
                <div class="flex justify-end gap-1">
                  <button @click="abrirPostos(r)" class="p-1.5 text-risco hover:text-bronze bg-transparent border-0 cursor-pointer" title="Postos da rede">
                    <Store :size="15" :stroke-width="1.8" />
                  </button>
                  <button @click="criarAdmin(r)" class="p-1.5 text-risco hover:text-bronze bg-transparent border-0 cursor-pointer" title="Criar admin da rede">
                    <UserPlus :size="15" :stroke-width="1.8" />
                  </button>
                  <button @click="editarRede(r)" class="p-1.5 text-risco hover:text-bronze bg-transparent border-0 cursor-pointer" title="Editar">
                    <Pencil :size="15" :stroke-width="1.8" />
                  </button>
                  <button v-if="r.nome !== 'default' && r.postos === 0 && r.usuarios === 0"
                    @click="excluirRede(r)" class="p-1.5 text-risco hover:text-lacre bg-transparent border-0 cursor-pointer" title="Excluir rede">
                    <Trash2 :size="15" :stroke-width="1.8" />
                  </button>
                  <span v-else class="w-[27px] inline-block"></span>
                </div>
              </td>
            </tr>

            <!-- Painel de postos (expansível) -->
            <tr v-if="painelRede?.id === r.id" class="border-t border-line bg-paper/60">
              <td colspan="6" class="px-4 py-4">
                <div class="flex items-center gap-2 mb-3">
                  <Building2 :size="15" class="text-bronze" :stroke-width="1.8" />
                  <span class="text-[13px] font-medium text-ink">Postos da rede {{ r.nome }}</span>
                </div>

                <!-- Lista de postos atuais -->
                <div class="mb-4">
                  <div v-if="!postosDaRede(r.id).length" class="text-[12px] text-risco">Nenhum posto nesta rede.</div>
                  <ul v-else class="space-y-1">
                    <li v-for="e in postosDaRede(r.id)" :key="e.id"
                      class="flex items-center justify-between gap-3 px-3 py-1.5 rounded-md border border-line bg-sheet">
                      <div class="min-w-0">
                        <span class="text-[13px] text-ink truncate">{{ e.nome_empresa || e.nome_fantasia || 'Empresa' }}</span>
                        <span class="ml-2 font-mono text-[11px] text-risco">{{ formatCnpj(e.cnpj) }}</span>
                      </div>
                      <button v-if="r.nome !== 'default'" @click="removerPosto(e)"
                        class="flex items-center gap-1 text-[12px] text-risco hover:text-lacre bg-transparent border-0 cursor-pointer" title="Mover para a rede default">
                        <Undo2 :size="14" :stroke-width="1.8" /> remover
                      </button>
                    </li>
                  </ul>
                </div>

                <!-- Buscar e associar -->
                <div class="space-y-1 max-w-md">
                  <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Associar posto (buscar por nome ou CNPJ)</label>
                  <div class="flex items-center gap-2 px-3 py-2 bg-sheet border border-line rounded-md">
                    <Search :size="15" class="text-risco flex-shrink-0" :stroke-width="1.8" />
                    <input v-model="buscaEmpresa" @input="onBuscaInput" type="text"
                      class="w-full bg-transparent text-[13px] text-ink outline-none border-0" placeholder="Digite para buscar…" />
                  </div>
                  <div v-if="buscando" class="text-[12px] text-risco pt-1">Buscando…</div>
                  <ul v-else-if="resultadoBusca.length" class="mt-1 border border-line rounded-md overflow-hidden">
                    <li v-for="e in resultadoBusca" :key="e.id"
                      class="flex items-center justify-between gap-3 px-3 py-2 border-b border-line last:border-b-0 bg-sheet">
                      <div class="min-w-0">
                        <span class="text-[13px] text-ink truncate">{{ e.nome_empresa || e.nome_fantasia || 'Empresa' }}</span>
                        <span class="ml-2 font-mono text-[11px] text-risco">{{ formatCnpj(e.cnpj) }}</span>
                        <span class="ml-2 text-[11px] text-risco/70">rede: {{ redes.find(x => x.id === e.rede_id)?.nome || '—' }}</span>
                      </div>
                      <button @click="associarPosto(e)"
                        class="flex items-center gap-1 text-[12px] text-bronze hover:opacity-80 bg-transparent border-0 cursor-pointer">
                        <Plus :size="14" :stroke-width="1.8" /> associar
                      </button>
                    </li>
                  </ul>
                  <div v-else-if="buscaEmpresa.trim()" class="text-[12px] text-risco pt-1">Nenhuma empresa encontrada.</div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
