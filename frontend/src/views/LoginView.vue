<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { setAuth } from '../store'

const router = useRouter()
const isLogin = ref(true)
const loading = ref(false)
const error = ref('')

const form = ref({
  nome: '',
  email: '',
  senha: ''
})

async function handleSubmit() {
  loading.value = true
  error.value = ''
  
  try {
    const endpoint = isLogin.value ? 'login' : 'register'
    const payload = isLogin.value 
      ? { email: form.value.email, senha: form.value.senha }
      : form.value

    const response = await axios.post(`${API_BASE_URL}/api/auth/${endpoint}`, payload)
    
    if (isLogin.value) {
      setAuth(response.data.token, response.data.user)
      router.push('/')
    } else {
      isLogin.value = true
      alert('Cadastro realizado! Agora faça login.')
    }
  } catch (err) {
    error.value = err.response?.data?.message || 'Erro ao processar requisição.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-brand-accent p-6 relative overflow-hidden">
    <!-- Efeitos de Fundo -->
    <div class="absolute top-0 left-0 w-full h-full opacity-10">
      <div class="absolute -top-24 -left-24 w-96 h-96 bg-white rounded-full blur-3xl"></div>
      <div class="absolute -bottom-24 -right-24 w-96 h-96 bg-emerald-600 rounded-full blur-3xl"></div>
    </div>

    <div class="w-full max-w-md z-10 animate-fade-in">
      <div class="bg-white rounded-[40px] shadow-2xl p-10 space-y-8 border border-white/20">
        <div class="text-center space-y-2">
          <h1 class="text-4xl font-black text-brand-accent tracking-tighter italic">AUDISPED</h1>
          <p class="text-slate-400 text-sm font-medium uppercase tracking-widest">
            {{ isLogin ? 'Acesso ao Portal Safira' : 'Criar Nova Conta' }}
          </p>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div v-if="!isLogin" class="space-y-1">
            <label class="text-[10px] font-black text-slate-400 uppercase ml-2">Nome Completo</label>
            <input v-model="form.nome" type="text" required class="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-brand-accent outline-none transition-all font-medium" placeholder="Ex: João Silva" />
          </div>

          <div class="space-y-1">
            <label class="text-[10px] font-black text-slate-400 uppercase ml-2">E-mail Corporativo</label>
            <input v-model="form.email" type="email" required class="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-brand-accent outline-none transition-all font-medium" placeholder="nome@empresa.com" />
          </div>

          <div class="space-y-1">
            <label class="text-[10px] font-black text-slate-400 uppercase ml-2">Senha de Acesso</label>
            <input v-model="form.senha" type="password" required class="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-brand-accent outline-none transition-all font-medium" placeholder="••••••••" />
          </div>

          <p v-if="error" class="text-xs text-red-500 font-bold text-center bg-red-50 p-3 rounded-xl border border-red-100 italic">
            ⚠️ {{ error }}
          </p>

          <button :disabled="loading" type="submit" class="w-full py-5 bg-brand-accent hover:bg-blue-800 text-white rounded-2xl font-black tracking-widest shadow-xl shadow-brand-accent/20 active:scale-95 transition-all disabled:opacity-50">
            {{ loading ? 'PROCESSANDO...' : (isLogin ? 'ENTRAR NO DASHBOARD' : 'FINALIZAR CADASTRO') }}
          </button>
        </form>

        <div class="text-center">
          <button @click="isLogin = !isLogin" class="text-sm font-bold text-slate-400 hover:text-brand-accent transition-colors">
            {{ isLogin ? 'Ainda não tem acesso? Cadastre-se' : 'Já possui conta? Faça Login' }}
          </button>
        </div>
      </div>

      <p class="text-center mt-8 text-white/40 text-[10px] font-bold uppercase tracking-widest">
        Audisped 2.0 • Proteção Fiscal de Alta Performance
      </p>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
