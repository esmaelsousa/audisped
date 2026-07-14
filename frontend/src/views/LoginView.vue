<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { setAuth, setPrecisaTrocarSenha } from '../store'
import UiButton from '../components/ui/UiButton.vue'

const router = useRouter()
const loading = ref(false)
const error = ref('')

const form = ref({
  email: '',
  senha: ''
})

async function handleSubmit() {
  loading.value = true
  error.value = ''

  try {
    const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
      email: form.value.email,
      senha: form.value.senha
    })
    setAuth(response.data.token, response.data.user)
    setPrecisaTrocarSenha(response.data.precisa_trocar_senha === true)
    // troca obrigatória no 1º login (senha temporária) antes de liberar o app
    router.push(response.data.precisa_trocar_senha === true ? '/trocar-senha' : '/')
  } catch (err) {
    error.value = err.response?.data?.message || 'Erro ao processar requisição.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-paper px-4 py-10">
    <div class="w-full max-w-sm">
      <!-- Cartão central -->
      <div class="bg-sheet border border-line rounded-md login-card p-8 space-y-6">

        <!-- Marca -->
        <div class="flex items-center gap-2">
          <span class="brand-mark"></span>
          <span class="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink">AudiSped</span>
        </div>

        <!-- Subtítulo -->
        <div>
          <p class="text-[13px] text-risco">Acesse sua conta</p>
        </div>

        <!-- Formulário -->
        <form @submit.prevent="handleSubmit" class="space-y-4">

          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">E-mail</label>
            <input
              v-model="form.email"
              type="email"
              required
              class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-body outline-none transition-colors"
              placeholder="nome@empresa.com"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] uppercase tracking-wide text-risco font-medium">Senha</label>
            <input
              v-model="form.senha"
              type="password"
              required
              class="w-full px-3 py-2 bg-sheet border border-line rounded-md text-[13px] text-ink font-body outline-none transition-colors"
              placeholder="••••••••"
            />
          </div>

          <p v-if="error" class="text-[12px] text-lacre">
            {{ error }}
          </p>

          <UiButton
            type="submit"
            :disabled="loading"
            class="w-full justify-center py-[9px] disabled:opacity-50"
          >
            {{ loading ? 'Aguarde...' : 'Entrar' }}
          </UiButton>
        </form>

        <!-- Esqueci a senha + acesso provisionado pelo admin -->
        <div class="border-t border-line pt-4 space-y-2">
          <RouterLink to="/esqueci-senha" class="block text-[12px] text-risco hover:text-bronze transition-colors">
            Esqueci minha senha
          </RouterLink>
          <p class="text-[12px] text-risco">
            Não tem acesso? Solicite ao administrador da sua conta.
          </p>
        </div>
      </div>

      <!-- Rodapé discreto -->
      <p class="text-center mt-6 text-[11px] text-risco">
        AudiSped — Escrituração Fiscal
      </p>
    </div>
  </div>
</template>

<style scoped>
.brand-mark {
  width: 22px;
  height: 22px;
  border: 2px solid var(--color-bronze);
  border-radius: 3px;
  position: relative;
  flex: 0 0 auto;
  display: inline-block;
}
.brand-mark::before {
  content: "";
  position: absolute;
  inset: 4px 4px auto 4px;
  height: 2px;
  background: var(--color-bronze);
}

.login-card {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
</style>
