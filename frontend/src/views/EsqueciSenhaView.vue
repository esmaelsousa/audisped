<script setup>
import { ref } from 'vue'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import UiButton from '../components/ui/UiButton.vue'

const email = ref('')
const loading = ref(false)
const enviado = ref(false)
const error = ref('')

async function handleSubmit() {
  error.value = ''
  loading.value = true
  try {
    await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { email: email.value })
    enviado.value = true // resposta é sempre genérica (não revela se o e-mail existe)
  } catch (err) {
    error.value = err.response?.data?.message || 'Erro ao enviar. Tente de novo.'
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

        <template v-if="!enviado">
          <div>
            <p class="text-[13px] text-ink font-medium">Esqueci minha senha</p>
            <p class="text-[12px] text-risco mt-1">Digite seu e-mail. Enviaremos um link para você criar uma nova senha.</p>
          </div>
          <form @submit.prevent="handleSubmit" class="space-y-4">
            <div class="space-y-1">
              <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">E-mail</label>
              <input v-model="email" type="email" required
                class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none"
                placeholder="nome@empresa.com" />
            </div>
            <p v-if="error" class="text-[12px] text-lacre">{{ error }}</p>
            <UiButton type="submit" :disabled="loading" class="w-full justify-center py-[9px] disabled:opacity-50">
              {{ loading ? 'Enviando...' : 'Enviar link' }}
            </UiButton>
          </form>
        </template>

        <template v-else>
          <div class="space-y-2">
            <p class="text-[13px] text-ink font-medium">Verifique seu e-mail</p>
            <p class="text-[12px] text-risco">Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha. Ele expira em 30 minutos.</p>
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
