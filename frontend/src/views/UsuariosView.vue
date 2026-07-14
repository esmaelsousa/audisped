<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { usuario, isSuper } from '../store'
import UiButton from '@/components/ui/UiButton.vue'
import { UserPlus, KeyRound, Power, PowerOff, Users, Save, X, Copy } from 'lucide-vue-next'

const usuarios = ref([])
const redes = ref([])
const isLoading = ref(false)
const notification = ref({ show: false, message: '', type: 'success' })
const form = ref(null)          // { nome, email, senha, role, rede_id } ou null
const formErro = ref('')
const senhaTemp = ref(null)     // { email, senha } após reset

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  staff: 'Staff (interno)',
  escritorio: 'Escritório'
}
const rolesDisponiveis = ['escritorio', 'admin', 'staff', 'super_admin']
const precisaRede = (role) => role === 'admin' || role === 'escritorio'

function notify(message, type = 'success') {
  notification.value = { show: true, message, type }
  setTimeout(() => { notification.value.show = false }, 3500)
}

function redeNome(id) {
  if (id == null) return '—'
  const r = redes.value.find((x) => Number(x.id) === Number(id))
  return r ? r.nome : `#${id}`
}

// Só renderiza ações sobre alvos que o backend permite (evita 403 → logout global).
function canManage(u) {
  if (!u || u.id === usuario.value?.id) return false
  if (isSuper.value) return true
  // admin: só escritório da própria rede
  return u.role === 'escritorio' && u.rede_id != null && Number(u.rede_id) === Number(usuario.value?.rede_id)
}

async function loadUsuarios() {
  isLoading.value = true
  try {
    const res = await axios.get(`${API_BASE_URL}/api/admin/usuarios`)
    usuarios.value = res.data
  } catch (e) {
    notify('Erro ao carregar usuários.', 'error')
  } finally {
    isLoading.value = false
  }
}

async function loadRedes() {
  if (!isSuper.value) return
  try {
    const res = await axios.get(`${API_BASE_URL}/api/admin/redes`)
    redes.value = res.data
  } catch (e) { /* silencioso: sem redes o super só cria staff/super */ }
}

function iniciarNovo() {
  form.value = { nome: '', email: '', senha: '', role: 'escritorio', rede_id: null }
  formErro.value = ''
}
function cancelar() { form.value = null; formErro.value = '' }

async function salvar() {
  formErro.value = ''
  const f = form.value
  if (!f.nome || !f.email || !f.senha) { formErro.value = 'Preencha nome, e-mail e senha.'; return }

  let body
  if (isSuper.value) {
    body = { nome: f.nome, email: f.email, senha: f.senha, role: f.role }
    if (precisaRede(f.role)) {
      if (!f.rede_id) { formErro.value = 'Selecione a rede para este papel.'; return }
      body.rede_id = Number(f.rede_id)
    }
  } else {
    // admin: backend força role=escritorio + própria rede
    body = { nome: f.nome, email: f.email, senha: f.senha }
  }

  try {
    await axios.post(`${API_BASE_URL}/api/admin/usuarios`, body)
    notify('Usuário criado.')
    form.value = null
    await loadUsuarios()
  } catch (e) {
    formErro.value = e.response?.data?.message || 'Erro ao criar usuário.'
  }
}

async function resetSenha(u) {
  if (!confirm(`Gerar senha temporária para ${u.email}?`)) return
  try {
    const res = await axios.post(`${API_BASE_URL}/api/admin/usuarios/${u.id}/reset-senha`)
    senhaTemp.value = { email: u.email, senha: res.data.senhaTemporaria }
  } catch (e) {
    notify('Erro ao resetar senha.', 'error')
  }
}

async function toggleAtivo(u) {
  const acao = u.ativo ? 'desativar' : 'ativar'
  try {
    await axios.patch(`${API_BASE_URL}/api/admin/usuarios/${u.id}/${acao}`)
    notify(u.ativo ? 'Usuário desativado.' : 'Usuário reativado.')
    await loadUsuarios()
  } catch (e) {
    notify('Erro ao alterar status.', 'error')
  }
}

function copiar(txt) {
  if (navigator.clipboard) navigator.clipboard.writeText(txt)
}

onMounted(async () => { await loadRedes(); await loadUsuarios() })
</script>

<template>
  <div class="max-w-5xl mx-auto">

    <!-- Cabeçalho -->
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-2">
        <Users :size="20" class="text-bronze" :stroke-width="1.8" />
        <h1 class="font-display text-[18px] font-semibold text-ink">Usuários</h1>
      </div>
      <UiButton @click="iniciarNovo" class="gap-1.5">
        <UserPlus :size="15" :stroke-width="1.8" /> Novo usuário
      </UiButton>
    </div>

    <!-- Toast -->
    <div v-if="notification.show"
      :class="['mb-4 px-3 py-2 rounded-md text-[13px] border',
        notification.type === 'error' ? 'bg-lacre/5 border-lacre/30 text-lacre' : 'bg-bronze/5 border-bronze/30 text-ink']">
      {{ notification.message }}
    </div>

    <!-- Senha temporária gerada -->
    <div v-if="senhaTemp" class="mb-4 p-4 rounded-md border border-bronze/40 bg-bronze/5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[12px] text-risco uppercase tracking-wide font-medium">Senha temporária — copie e repasse</p>
          <p class="text-[13px] text-ink mt-1">{{ senhaTemp.email }}</p>
          <p class="font-mono text-[16px] text-ink mt-1 select-all">{{ senhaTemp.senha }}</p>
          <p class="text-[11px] text-risco mt-1">O usuário será obrigado a trocá-la no próximo login.</p>
        </div>
        <div class="flex gap-2">
          <button @click="copiar(senhaTemp.senha)" class="p-1.5 text-risco hover:text-bronze bg-transparent border-0 cursor-pointer" title="Copiar">
            <Copy :size="16" :stroke-width="1.8" />
          </button>
          <button @click="senhaTemp = null" class="p-1.5 text-risco hover:text-ink bg-transparent border-0 cursor-pointer" title="Fechar">
            <X :size="16" :stroke-width="1.8" />
          </button>
        </div>
      </div>
    </div>

    <!-- Form de criação -->
    <div v-if="form" class="mb-5 p-4 rounded-md border border-line bg-sheet">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nome</label>
          <input v-model="form.nome" type="text" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="Nome completo" />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">E-mail</label>
          <input v-model="form.email" type="email" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="nome@empresa.com" />
        </div>
        <div class="space-y-1">
          <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Senha inicial</label>
          <input v-model="form.senha" type="text" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="senha temporária" />
        </div>

        <!-- Papel + rede: só super escolhe; admin cria sempre escritório na própria rede -->
        <template v-if="isSuper">
          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Papel</label>
            <select v-model="form.role" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none">
              <option v-for="r in rolesDisponiveis" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
            </select>
          </div>
          <div v-if="precisaRede(form.role)" class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Rede</label>
            <select v-model="form.rede_id" class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none">
              <option :value="null" disabled>Selecione…</option>
              <option v-for="rd in redes" :key="rd.id" :value="rd.id">{{ rd.nome }}</option>
            </select>
          </div>
        </template>
      </div>

      <p v-if="!isSuper" class="text-[12px] text-risco mt-2">Será criado como <b>Escritório</b> na sua rede.</p>
      <p v-if="formErro" class="text-[12px] text-lacre mt-2">{{ formErro }}</p>

      <div class="flex gap-2 mt-3">
        <UiButton @click="salvar" class="gap-1.5"><Save :size="15" :stroke-width="1.8" /> Salvar</UiButton>
        <button @click="cancelar" class="px-3 py-2 text-[13px] text-risco hover:text-ink bg-transparent border border-line rounded-md cursor-pointer">Cancelar</button>
      </div>
    </div>

    <!-- Tabela -->
    <div class="border border-line rounded-md overflow-hidden">
      <table class="w-full text-[13px]">
        <thead>
          <tr class="bg-paper text-risco text-[11px] uppercase tracking-wide">
            <th class="text-left font-medium px-3 py-2">Nome</th>
            <th class="text-left font-medium px-3 py-2">E-mail</th>
            <th class="text-left font-medium px-3 py-2">Papel</th>
            <th class="text-left font-medium px-3 py-2">Rede</th>
            <th class="text-left font-medium px-3 py-2">Status</th>
            <th class="text-right font-medium px-3 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="isLoading">
            <td colspan="6" class="px-3 py-6 text-center text-risco">Carregando…</td>
          </tr>
          <tr v-else-if="!usuarios.length">
            <td colspan="6" class="px-3 py-6 text-center text-risco">Nenhum usuário.</td>
          </tr>
          <tr v-for="u in usuarios" :key="u.id" class="border-t border-line" :class="{ 'opacity-50': !u.ativo }">
            <td class="px-3 py-2 text-ink">{{ u.nome }}</td>
            <td class="px-3 py-2 text-ink">{{ u.email }}</td>
            <td class="px-3 py-2 text-ink">{{ ROLE_LABEL[u.role] || u.role }}</td>
            <td class="px-3 py-2 text-risco">{{ redeNome(u.rede_id) }}</td>
            <td class="px-3 py-2">
              <span :class="u.ativo ? 'text-bronze' : 'text-lacre'">{{ u.ativo ? 'Ativo' : 'Inativo' }}</span>
              <span v-if="u.precisa_trocar_senha" class="ml-1 text-[11px] text-risco">(trocar senha)</span>
            </td>
            <td class="px-3 py-2 text-right">
              <div v-if="canManage(u)" class="flex justify-end gap-1">
                <button @click="resetSenha(u)" class="p-1.5 text-risco hover:text-bronze bg-transparent border-0 cursor-pointer" title="Resetar senha">
                  <KeyRound :size="15" :stroke-width="1.8" />
                </button>
                <button @click="toggleAtivo(u)" class="p-1.5 bg-transparent border-0 cursor-pointer"
                  :class="u.ativo ? 'text-risco hover:text-lacre' : 'text-risco hover:text-bronze'"
                  :title="u.ativo ? 'Desativar' : 'Reativar'">
                  <PowerOff v-if="u.ativo" :size="15" :stroke-width="1.8" />
                  <Power v-else :size="15" :stroke-width="1.8" />
                </button>
              </div>
              <span v-else class="text-[11px] text-risco/50">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
