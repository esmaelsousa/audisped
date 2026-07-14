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
import UiButton from '../components/ui/UiButton.vue';
import { API_BASE_URL } from '../api';

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
    const response = await axios.put(`${API_BASE_URL}/api/auth/profile`, {
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
  <div class="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">Meu Perfil</h1>
      <p class="mt-1 text-[13px] text-risco">Gerencie suas informações pessoais e configurações de segurança.</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Left Column: User Summary Card -->
      <div class="space-y-5">
        <div class="bg-sheet rounded-md border border-line overflow-hidden card-shadow">
          <!-- faixa grafite sólida (sem gradiente) -->
          <div class="bg-graphite h-20 relative">
            <div class="absolute -bottom-10 left-6">
              <div class="relative group">
                <div class="w-20 h-20 rounded-full border-4 border-sheet bg-paper flex items-center justify-center text-bronze overflow-hidden">
                  <User class="w-10 h-10" :stroke-width="1.6" v-if="!usuario?.avatar" />
                  <img v-else :src="usuario.avatar" class="w-full h-full object-cover" />
                </div>
                <button class="absolute bottom-0 right-0 p-1.5 bg-sheet rounded-full border border-line text-risco hover:text-bronze transition-colors" title="Alterar Foto (Em breve)">
                  <Camera class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
          <div class="pt-13 pb-6 px-6 mt-2">
            <h2 class="font-display text-[17px] font-semibold text-ink">{{ usuario?.nome || 'Usuário' }}</h2>
            <p class="text-[12px] text-risco mb-3">{{ usuario?.email }}</p>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-bronze/10 text-bronze border border-bronze/20">
              Administrador do Sistema
            </span>
          </div>
        </div>

        <div class="bg-bronze/[0.04] border border-bronze/15 rounded-md p-4">
          <div class="flex gap-3">
            <AlertCircle class="w-4 h-4 text-bronze shrink-0 mt-0.5" :stroke-width="1.8" />
            <div>
              <h4 class="text-[13px] font-semibold text-ink">Segurança de Dados</h4>
              <p class="text-[12px] text-risco mt-1 leading-relaxed">
                Suas informações são processadas de acordo com as normas da LGPD. Nunca compartilhe sua senha.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Edit Form -->
      <div class="lg:col-span-2">
        <form @submit.prevent="handleSubmit" class="bg-sheet rounded-md border border-line p-6 sm:p-7 space-y-7 card-shadow">

          <!-- Basic Info Section -->
          <section>
            <div class="flex items-center gap-2 mb-5 border-b border-line pb-2.5">
              <div class="w-1 h-5 bg-bronze rounded-full"></div>
              <h3 class="font-display text-[15px] font-semibold text-ink">Dados Pessoais</h3>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div class="space-y-1.5">
                <label for="nome" class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nome Completo</label>
                <div class="relative">
                  <User class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
                  <input
                    id="nome"
                    v-model="form.nome"
                    type="text"
                    required
                    class="w-full pl-9 pr-3 py-2.5 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors"
                    placeholder="Seu nome completo"
                  />
                </div>
              </div>

              <div class="space-y-1.5">
                <label for="email" class="block text-[11px] uppercase tracking-wide text-risco font-medium">E-mail Corporativo</label>
                <div class="relative">
                  <Mail class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
                  <input
                    id="email"
                    v-model="form.email"
                    type="email"
                    required
                    class="w-full pl-9 pr-3 py-2.5 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors"
                    placeholder="exemplo@empresa.com"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- Security Section -->
          <section>
            <div class="flex items-center gap-2 mb-5 border-b border-line pb-2.5">
              <div class="w-1 h-5 bg-bronze rounded-full"></div>
              <h3 class="font-display text-[15px] font-semibold text-ink">Alterar Senha</h3>
            </div>
            <p class="text-[12px] text-risco mb-4">Deixe em branco para manter a senha atual.</p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div class="space-y-1.5">
                <label for="senha" class="block text-[11px] uppercase tracking-wide text-risco font-medium">Nova Senha</label>
                <div class="relative">
                  <Lock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
                  <input
                    id="senha"
                    v-model="form.senha"
                    type="password"
                    class="w-full pl-9 pr-3 py-2.5 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div class="space-y-1.5">
                <label for="confirmarSenha" class="block text-[11px] uppercase tracking-wide text-risco font-medium">Confirmar Nova Senha</label>
                <div class="relative">
                  <Lock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-risco" :stroke-width="1.8" />
                  <input
                    id="confirmarSenha"
                    v-model="form.confirmarSenha"
                    type="password"
                    class="w-full pl-9 pr-3 py-2.5 bg-sheet border border-line rounded-md text-[13px] text-ink outline-none focus:border-bronze transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- Status Message -->
          <div v-if="status.message" :class="[
            'p-3.5 rounded-md flex items-center gap-3 border',
            status.type === 'success' ? 'bg-conforme/[0.06] text-conforme border-conforme/25' : 'bg-lacre/[0.06] text-lacre border-lacre/25'
          ]">
            <CheckCircle2 v-if="status.type === 'success'" class="w-5 h-5" :stroke-width="1.8" />
            <AlertCircle v-else class="w-5 h-5" :stroke-width="1.8" />
            <span class="text-[13px] font-medium">{{ status.message }}</span>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end pt-2">
            <UiButton type="submit" :disabled="loading" class="py-[9px] px-5 disabled:opacity-50">
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <Save v-else class="w-4 h-4" :stroke-width="1.8" />
              Salvar Alterações
            </UiButton>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-shadow {
  box-shadow: 0 1px 4px 0 rgba(18, 24, 32, 0.07);
}
/* compensa o avatar que extrapola a faixa grafite (-bottom-10 => 40px) */
.pt-13 {
  padding-top: 3.25rem;
}
</style>
