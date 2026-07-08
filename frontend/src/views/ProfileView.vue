<script setup>
import { ref, onMounted } from 'vue';
import { usuario, setUsuario, token } from '../store';
import { 
  User, 
  Mail, 
  Lock, 
  Save, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Camera
} from 'lucide-vue-next';
import axios from 'axios';

// Base vazia => caminhos relativos (/api/...). Em produção o Caddy roteia /api para o backend.
const API_URL = import.meta.env.VITE_API_URL || '';

const form = ref({
  nome: usuario.value?.nome || '',
  email: usuario.value?.email || '',
  senha: '',
  confirmarSenha: ''
});

const loading = ref(false);
const status = ref({ type: '', message: '' });

const handleSubmit = async () => {
  if (form.value.senha && form.value.senha !== form.value.confirmarSenha) {
    status.value = { type: 'error', message: 'As senhas não coincidem.' };
    return;
  }

  loading.value = true;
  status.value = { type: '', message: '' };

  try {
    const response = await axios.put(`${API_URL}/api/auth/profile`, {
      nome: form.value.nome,
      email: form.value.email,
      senha: form.value.senha || undefined
    }, {
      headers: { Authorization: `Bearer ${token.value}` }
    });

    setUsuario(response.data);
    status.value = { type: 'success', message: 'Perfil atualizado com sucesso!' };
    form.value.senha = '';
    form.value.confirmarSenha = '';
  } catch (err) {
    status.value = { 
      type: 'error', 
      message: err.response?.data?.message || 'Erro ao atualizar perfil.' 
    };
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 bg-brand-surface min-h-screen">
    <!-- Header -->
    <div class="mb-10 text-center sm:text-left">
      <h1 class="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">Meu Perfil</h1>
      <p class="mt-2 text-lg text-slate-600">Gerencie suas informações pessoais e configurações de segurança.</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Left Column: User Summary Card -->
      <div class="space-y-6">
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div class="bg-gradient-to-br from-brand-accent to-blue-700 h-24 relative">
            <div class="absolute -bottom-12 left-1/2 -translate-x-1/2 sm:left-6 sm:translate-x-0">
              <div class="relative group">
                <div class="w-24 h-24 rounded-full border-4 border-white bg-slate-100 flex items-center justify-center text-brand-accent shadow-md overflow-hidden transition-all group-hover:brightness-90">
                  <User class="w-12 h-12" v-if="!usuario?.avatar" />
                  <img v-else :src="usuario.avatar" class="w-full h-full object-cover" />
                </div>
                <button class="absolute bottom-0 right-0 p-1.5 bg-white rounded-full border border-slate-200 shadow-sm text-slate-500 hover:text-brand-accent transition-colors" title="Alterar Foto (Em breve)">
                  <Camera class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
          <div class="pt-14 pb-8 px-6 text-center sm:text-left">
            <h2 class="text-xl font-bold text-slate-900">{{ usuario?.nome || 'Usuário' }}</h2>
            <p class="text-sm text-slate-500 mb-4">{{ usuario?.email }}</p>
            <div class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
              Administrador do Sistema
            </div>
          </div>
        </div>

        <div class="bg-blue-50 border border-blue-100 rounded-xl p-5">
          <div class="flex gap-3">
            <AlertCircle class="w-5 h-5 text-blue-600 shrink-0" />
            <div>
              <h4 class="text-sm font-semibold text-blue-900">Segurança de Dados</h4>
              <p class="text-xs text-blue-700 mt-1 leading-relaxed">
                Suas informações são processadas de acordo com as normas da LGPD. Nunca compartilhe sua senha.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Edit Form -->
      <div class="lg:col-span-2 space-y-6">
        <form @submit.prevent="handleSubmit" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8 space-y-8">
          
          <!-- Basic Info Section -->
          <section>
            <div class="flex items-center gap-2 mb-6 border-b border-slate-100 pb-2">
              <div class="w-1 h-6 bg-brand-accent rounded-full"></div>
              <h3 class="text-lg font-bold text-slate-900">Dados Pessoais</h3>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div class="space-y-1.5">
                <label for="nome" class="text-sm font-semibold text-slate-700">Nome Completo</label>
                <div class="relative">
                  <User class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    id="nome" 
                    v-model="form.nome" 
                    type="text" 
                    required 
                    class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent outline-none transition-all"
                    placeholder="Seu nome completo"
                  />
                </div>
              </div>

              <div class="space-y-1.5">
                <label for="email" class="text-sm font-semibold text-slate-700">E-mail Corporativo</label>
                <div class="relative">
                  <Mail class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    id="email" 
                    v-model="form.email" 
                    type="email" 
                    required 
                    class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent outline-none transition-all"
                    placeholder="exemplo@empresa.com"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- Security Section -->
          <section>
            <div class="flex items-center gap-2 mb-6 border-b border-slate-100 pb-2">
              <div class="w-1 h-6 bg-brand-accent rounded-full"></div>
              <h3 class="text-lg font-bold text-slate-900 text-slate-900">Alterar Senha</h3>
            </div>
            <p class="text-xs text-slate-500 mb-4 italic">Deixe em branco para manter a senha atual.</p>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div class="space-y-1.5">
                <label for="senha" class="text-sm font-semibold text-slate-700">Nova Senha</label>
                <div class="relative">
                  <Lock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    id="senha" 
                    v-model="form.senha" 
                    type="password" 
                    class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent outline-none transition-all"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div class="space-y-1.5">
                <label for="confirmarSenha" class="text-sm font-semibold text-slate-700">Confirmar Nova Senha</label>
                <div class="relative">
                  <Lock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    id="confirmarSenha" 
                    v-model="form.confirmarSenha" 
                    type="password" 
                    class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent outline-none transition-all"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- Status Message -->
          <div v-if="status.message" :class="[
            'p-4 rounded-xl flex items-center gap-3 transition-all duration-300',
            status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          ]">
            <CheckCircle2 v-if="status.type === 'success'" class="w-5 h-5" />
            <AlertCircle v-else class="w-5 h-5" />
            <span class="text-sm font-medium">{{ status.message }}</span>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end pt-4 gap-4">
            <button 
              type="submit" 
              :disabled="loading"
              class="inline-flex items-center gap-2 px-6 py-3 bg-brand-accent hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all text-sm uppercase tracking-wide"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" />
              Salvar Alterações
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bg-brand-surface {
  background-color: #f8fafc;
}
.text-brand-accent {
  color: #2563eb;
}
.bg-brand-accent {
  background-color: #2563eb;
}
</style>
