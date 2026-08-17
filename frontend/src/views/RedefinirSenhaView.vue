<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import UiButton from '../components/ui/UiButton.vue'

const route = useRoute()
const router = useRouter()
const token = ref('')
const senha = ref('')
const confirmar = ref('')
const loading = ref(false)
const error = ref('')
const ok = ref(false)

onMounted(() => { token.value = String(route.query.token || '') })

async function handleSubmit() {
  error.value = ''
  if (!token.value) { error.value = 'Link inválido. Solicite um novo em "Esqueci minha senha".'; return }
  if (senha.value.length < 6) { error.value = 'A senha deve ter ao menos 6 caracteres.'; return }
  if (senha.value !== confirmar.value) { error.value = 'As senhas não conferem.'; return }
  loading.value = true
  try {
    await axios.post(`${API_BASE_URL}/api/auth/reset-password`, { token: token.value, senha: senha.value })
    ok.value = true
    setTimeout(() => router.push('/login'), 1800)
  } catch (err) {
    error.value = err.response?.data?.message || 'Não foi possível redefinir. Solicite um novo link.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-paper px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="bg-sheet border border-line rounded-md p-8 space-y-6" style="box-shadow:0 1px 4px 0 rgba(18,24,32,.07)">
        <div class="flex items-center gap-2">
          <span class="brand-mark"></span>
          <span class="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink">AudiSped</span>
        </div>

        <template v-if="!ok">
          <div>
            <p class="text-[13px] text-ink font-medium">Redefinir senha</p>
            <p class="text-[12px] text-risco mt-1">Escolha uma nova senha para sua conta.</p>
          </div>
          <form @submit.prevent="handleSubmit" class="space-y-4">
            <div class="space-y-1">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nova senha</label>
              <input v-model="senha" type="password" required
                class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="••••••••" />
            </div>
            <div class="space-y-1">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Confirmar senha</label>
              <input v-model="confirmar" type="password" required
                class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none" placeholder="••••••••" />
            </div>
            <p v-if="error" class="text-[12px] text-lacre">{{ error }}</p>
            <UiButton type="submit" :disabled="loading" class="w-full justify-center py-[9px] disabled:opacity-50">
              {{ loading ? 'Salvando...' : 'Redefinir senha' }}
            </UiButton>
          </form>
        </template>

        <template v-else>
          <div class="space-y-2">
            <p class="text-[13px] text-ink font-medium">Senha redefinida </p>
            <p class="text-[12px] text-risco">Você já pode entrar com a nova senha. Redirecionando para o login…</p>
          </div>
        </template>

        <div class="border-t border-line pt-4">
          <RouterLink to="/login" class="text-[12px] text-risco hover:text-bronze transition-colors">← Voltar ao login</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brand-mark { width:22px;height:22px;border:2px solid var(--color-bronze);border-radius:3px;position:relative;flex:0 0 auto;display:inline-block; }
.brand-mark::before { content:"";position:absolute;inset:4px 4px auto 4px;height:2px;background:var(--color-bronze); }
</style>
