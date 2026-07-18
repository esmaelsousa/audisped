<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { API_BASE_URL } from '../api'
import { setAuth, setPrecisaTrocarSenha } from '../store'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const showSenha = ref(false)

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
  <div class="lg">
    <!-- FORM SIDE -->
    <main class="lg-formside">
      <div class="lg-form-wrap">
        <div class="lg-form-brand">
          <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden="true">
            <rect width="36" height="36" rx="9" fill="#232C35"/>
            <rect x="10" y="9" width="9" height="18" rx="1.6" stroke="#E0902F" stroke-width="2"/>
            <path d="M19 13h3.4a2 2 0 0 1 2 2v7a1.6 1.6 0 0 0 3.2 0v-6" stroke="#E0902F" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Audi<b>Sped</b>
        </div>

        <h1 class="lg-title">Acesse sua conta</h1>
        <p class="lg-sub">Entre com seu e-mail e senha pra continuar.</p>

        <form @submit.prevent="handleSubmit">
          <div class="lg-field">
            <label for="lg-email">E-mail</label>
            <div class="lg-inp">
              <input id="lg-email" v-model="form.email" type="email" required
                autocomplete="username" placeholder="nome@empresa.com" />
            </div>
          </div>

          <div class="lg-field">
            <label for="lg-senha">Senha</label>
            <div class="lg-inp">
              <input id="lg-senha" v-model="form.senha" :type="showSenha ? 'text' : 'password'" required
                autocomplete="current-password" placeholder="••••••••" />
              <button class="lg-eye" type="button" @click="showSenha = !showSenha"
                :aria-label="showSenha ? 'Ocultar senha' : 'Mostrar senha'">
                <svg v-if="!showSenha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7c2 0 3.8.6 5.3 1.5M22 12s-3.5 7-10 7c-2 0-3.8-.6-5.3-1.5"/><path d="M3 3l18 18"/></svg>
              </button>
            </div>
          </div>

          <div class="lg-forgot">
            <RouterLink to="/esqueci-senha">Esqueci minha senha</RouterLink>
          </div>

          <p v-if="error" class="lg-error">{{ error }}</p>

          <button class="lg-btn" type="submit" :disabled="loading">
            <span>{{ loading ? 'Aguarde...' : 'Entrar' }}</span>
            <svg v-if="!loading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
        </form>

        <div class="lg-foot">
          <p>Não tem acesso? Solicite ao administrador da sua conta.</p>
          <a href="https://wa.me/5574991985228" class="lg-support">Suporte no WhatsApp</a>
        </div>
      </div>
    </main>

    <!-- BRAND SIDE -->
    <aside class="lg-brandside">
      <div class="lg-halo"></div>
      <a class="lg-brand" href="https://www.audisped.com.br">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <rect width="36" height="36" rx="9" fill="#232C35"/>
          <rect x="10" y="9" width="9" height="18" rx="1.6" stroke="#E0902F" stroke-width="2"/>
          <path d="M19 13h3.4a2 2 0 0 1 2 2v7a1.6 1.6 0 0 0 3.2 0v-6" stroke="#E0902F" stroke-width="2" stroke-linecap="round"/>
          <rect x="12.4" y="11.6" width="4.2" height="3.4" rx="0.8" fill="#3C7B58"/>
        </svg>
        Audi<b>Sped</b>
      </a>

      <div class="lg-mid">
        <span class="lg-eyebrow">O sistema completo do posto</span>
        <h2>Do LMC ao SPED fiscal, tudo em dia com o fisco.</h2>
        <p>Entre pra fechar o Livro de Combustível e validar seu SPED antes de entregar — o AudiSped acha o erro que o PVA nem mostra e corrige antes que vire multa.</p>

        <div class="lg-live">
          <div class="lg-live-top"><span class="lg-dot"></span> Monitorando · dez/2024</div>
          <div class="lg-live-row"><span class="lg-rc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span><span class="lg-rt">LMC fechado — bate com a bomba</span><span class="lg-rb">Conforme</span></div>
          <div class="lg-live-row"><span class="lg-rc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span><span class="lg-rt">SPED validado · 44 regras fiscais</span><span class="lg-rb">Sem erro</span></div>
          <div class="lg-live-row"><span class="lg-rc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span><span class="lg-rt">Arquivo pronto pra entrega</span><span class="lg-rb">OK</span></div>
        </div>

        <div class="lg-valline">
          <span class="lg-valic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4v5c0 4-3.5 7-8 9-4.5-2-8-5-8-9V7z"/><path d="M9 12l2 2 4-4"/></svg></span>
          <div>
            <b>Validador SPED Fiscal</b>
            <span class="lg-vt">44+ regras que apontam o erro exato — não a mensagem genérica do PVA — e já exportam o arquivo pronto pra entrega.</span>
          </div>
        </div>
      </div>

      <div class="lg-badges">
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg> Conexão criptografada</span>
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4v5c0 4-3.5 7-8 9-4.5-2-8-5-8-9V7z"/></svg> Dados protegidos (LGPD)</span>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.lg{display:grid;grid-template-columns:.92fr 1.08fr;min-height:100vh;
  font-family:var(--font-body);color:var(--color-ink)}

/* form side */
.lg-formside{background:var(--color-sheet);display:flex;align-items:center;justify-content:center;padding:48px 32px}
.lg-form-wrap{width:100%;max-width:380px}
.lg-form-brand{display:none;align-items:center;gap:9px;font-family:var(--font-display);font-weight:700;font-size:20px;color:var(--color-ink);margin-bottom:26px}
.lg-form-brand b{color:var(--color-bronze)}
.lg-title{font-family:var(--font-display);font-size:27px;font-weight:700;letter-spacing:-.02em;color:var(--color-ink)}
.lg-sub{margin-top:7px;font-size:14.5px;color:var(--color-risco);margin-bottom:28px}
.lg-field{margin-bottom:15px}
.lg-field label{display:block;font-size:13px;font-weight:600;color:#3A444C;margin-bottom:7px}
.lg-inp{position:relative}
.lg-inp input{width:100%;height:47px;border:1px solid var(--color-line);border-radius:12px;padding:0 15px;
  font-family:var(--font-body);font-size:15px;color:var(--color-ink);background:#FBFBFA;outline:none;
  transition:border-color .15s,box-shadow .15s}
.lg-inp input::placeholder{color:#AAB2B8}
.lg-inp input:focus{border-color:#E0902F;box-shadow:0 0 0 3px rgba(224,144,47,.15);background:#fff}
.lg-eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;
  cursor:pointer;padding:8px;color:var(--color-muted);display:grid;place-items:center}
.lg-eye svg{width:19px;height:19px}
.lg-eye:hover{color:var(--color-bronze)}
.lg-forgot{text-align:right;margin:4px 0 20px}
.lg-forgot a{font-size:13.5px;font-weight:600;color:var(--color-bronze);text-decoration:none}
.lg-forgot a:hover{text-decoration:underline}
.lg-error{font-size:13px;color:var(--color-lacre);background:rgba(174,58,51,.08);
  border:1px solid rgba(174,58,51,.25);border-radius:10px;padding:10px 12px;margin-bottom:14px}
.lg-btn{width:100%;height:50px;border:0;border-radius:999px;cursor:pointer;
  font-family:var(--font-body);font-weight:700;font-size:15.5px;color:#fff;
  background:linear-gradient(135deg,#B56C1E,#8F5316);
  box-shadow:0 12px 26px -12px rgba(168,99,31,.7);transition:transform .16s,box-shadow .16s,opacity .16s;
  display:flex;align-items:center;justify-content:center;gap:9px}
.lg-btn:hover{transform:translateY(-2px);box-shadow:0 18px 34px -12px rgba(168,99,31,.8)}
.lg-btn:disabled{opacity:.6;cursor:default;transform:none;box-shadow:none}
.lg-btn svg{width:18px;height:18px}
.lg-foot{margin-top:26px;text-align:center}
.lg-foot p{font-size:13px;color:var(--color-risco)}
.lg-support{display:inline-block;margin-top:8px;font-family:var(--font-mono);font-size:12px;color:var(--color-conforme);text-decoration:none}
.lg-support:hover{text-decoration:underline}

/* brand side */
.lg-brandside{position:relative;overflow:hidden;padding:48px 56px;display:flex;flex-direction:column;
  color:#EAEEF2;background:linear-gradient(160deg,#1C232A,#0F151B)}
.lg-halo{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(90% 60% at 14% 6%,rgba(224,144,47,.20),transparent 55%),
    radial-gradient(70% 60% at 100% 100%,rgba(60,123,88,.12),transparent 60%)}
.lg-brandside>*{position:relative}
.lg-brand{display:flex;align-items:center;gap:11px;font-family:var(--font-display);font-weight:700;font-size:22px;color:#fff;text-decoration:none}
.lg-brand b{color:#E0902F}
.lg-mid{margin-top:auto;margin-bottom:auto;padding:32px 0;max-width:440px}
.lg-eyebrow{font-family:var(--font-mono);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
  color:#E0902F;display:inline-flex;align-items:center;gap:8px;margin-bottom:16px}
.lg-eyebrow::before{content:"";width:22px;height:1px;background:currentColor;opacity:.5}
.lg-mid h2{font-family:var(--font-display);font-size:clamp(24px,2.6vw,32px);font-weight:700;letter-spacing:-.02em;line-height:1.1;color:#fff}
.lg-mid>p{margin-top:13px;font-size:15.5px;color:#B7C0C9;line-height:1.55}
.lg-live{margin-top:24px;background:#141B22;border:1px solid #2C3540;border-radius:14px;padding:15px 17px;max-width:420px}
.lg-live-top{display:flex;align-items:center;gap:9px;font-family:var(--font-mono);font-size:11.5px;color:#8FA0AC}
.lg-dot{width:9px;height:9px;border-radius:50%;background:#4E9A6E;position:relative}
.lg-dot::after{content:"";position:absolute;inset:0;border-radius:50%;animation:lgpulse 2.4s ease-out infinite}
@keyframes lgpulse{0%{box-shadow:0 0 0 0 rgba(78,154,110,.55)}70%{box-shadow:0 0 0 8px rgba(78,154,110,0)}100%{box-shadow:0 0 0 0 rgba(78,154,110,0)}}
.lg-live-row{display:flex;align-items:center;gap:10px;margin-top:12px}
.lg-rc{width:20px;height:20px;border-radius:6px;background:rgba(78,154,110,.16);color:#4E9A6E;display:grid;place-items:center;flex:0 0 20px}
.lg-rc svg{width:12px;height:12px}
.lg-rt{font-size:13px;color:#D6DDE4;font-weight:600}
.lg-rb{margin-left:auto;font-family:var(--font-mono);font-size:10.5px;color:#4E9A6E;background:rgba(78,154,110,.14);padding:3px 8px;border-radius:99px}
.lg-valline{display:flex;gap:13px;align-items:flex-start;margin-top:20px;max-width:430px}
.lg-valic{width:38px;height:38px;border-radius:10px;flex:0 0 38px;display:grid;place-items:center;
  background:linear-gradient(135deg,rgba(224,144,47,.22),rgba(224,144,47,.06));color:#E0902F}
.lg-valic svg{width:20px;height:20px}
.lg-valline b{display:block;font-size:14.5px;color:#fff;font-weight:700;margin-bottom:3px}
.lg-vt{font-size:13px;color:#9BA6AF;line-height:1.45}
.lg-badges{display:flex;gap:22px;flex-wrap:wrap;font-family:var(--font-mono);font-size:11.5px;color:#8FA0AC}
.lg-badges span{display:flex;align-items:center;gap:7px}
.lg-badges svg{width:14px;height:14px;color:#E0902F}

@media (max-width:880px){
  .lg{grid-template-columns:1fr}
  .lg-brandside{display:none}
  .lg-formside{background:var(--color-graphite);padding:40px 22px}
  .lg-form-wrap{background:#fff;border-radius:20px;padding:32px 26px;box-shadow:0 30px 70px -30px rgba(0,0,0,.5)}
  .lg-form-brand{display:flex}
}
</style>
