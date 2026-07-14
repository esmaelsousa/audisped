<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { usuario, setPrecisaTrocarSenha } from '../store'
import UiButton from '../components/ui/UiButton.vue'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const senha = ref('')
const confirmar = ref('')

async function handleSubmit() {
  error.value = ''
  if (senha.value.length < 6) { error.value = 'A senha deve ter ao menos 6 caracteres.'; return }
  if (senha.value !== confirmar.value) { error.value = 'As senhas não conferem.'; return }
  loading.value = true
  try {
    // envia nome/email atuais junto (o profile atualiza os três) e a nova senha zera a flag no backend
    await axios.put(`${API_BASE_URL}/api/auth/profile`, {
      nome: usuario.value?.nome,
      email: usuario.value?.email,
      senha: senha.value
    })
    setPrecisaTrocarSenha(false)
    router.push('/')
  } catch (err) {
    error.value = err.response?.data?.message || 'Erro ao trocar a senha.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-paper px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="bg-sheet border border-line rounded-md p-8 space-y-6" style="box-shadow: 0 1px 4px 0 rgba(18,24,32,.07)">

        <div class="flex items-center gap-2">
          <span class="brand-mark"></span>
          <span class="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink">AudiSped</span>
        </div>

        <div>
          <p class="text-[13px] text-ink font-medium">Defina uma nova senha</p>
          <p class="text-[12px] text-risco mt-1">Sua senha é temporária. Escolha uma nova para continuar.</p>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nova senha</label>
            <input v-model="senha" type="password" required
              class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-body outline-none"
              placeholder="••••••••" />
          </div>
          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Confirmar nova senha</label>
            <input v-model="confirmar" type="password" required
              class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-body outline-none"
              placeholder="••••••••" />
          </div>

          <p v-if="error" class="text-[12px] text-lacre">{{ error }}</p>

          <UiButton type="submit" :disabled="loading" class="w-full justify-center py-[9px] disabled:opacity-50">
            {{ loading ? 'Aguarde...' : 'Salvar e continuar' }}
          </UiButton>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brand-mark {
  width: 22px; height: 22px; border: 2px solid var(--color-bronze);
  border-radius: 3px; position: relative; flex: 0 0 auto; display: inline-block;
}
.brand-mark::before {
  content: ""; position: absolute; inset: 4px 4px auto 4px; height: 2px; background: var(--color-bronze);
}
</style>
