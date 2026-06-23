<script setup>
import { RouterLink } from 'vue-router'
import {
  BarChart2,
  ShieldCheck,
  BookOpen,
  TrendingUp,
  Upload,
  Truck,
  ArrowLeftRight,
  Settings2,
  Tag,
  FileText,
  Printer,
  Mail,
  LayoutDashboard,
  DatabaseZap,
  Building2,
  LogOut,
  User
} from 'lucide-vue-next'
import { empresaSelecionada, arquivoInfo, usuario, logout } from '@/store'
import { useRouter } from 'vue-router'
import { formatCnpj } from '@/utils/sped'

const emit = defineEmits(['navigate'])

const router = useRouter()

function nav() {
  emit('navigate')
}

function handleLogout() {
  logout()
  router.push('/login')
  emit('navigate')
}

// classes compartilhadas dos itens de navegação
const linkBase = 'flex items-center gap-[10px] px-[18px] py-[4px] text-[13px] text-muted no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2'
const linkActive = '!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze'
const linkDisabled = 'flex items-center gap-[10px] px-[18px] py-[4px] text-[13px] text-risco/60 cursor-not-allowed'
const grupo = 'px-[18px] pb-[2px] pt-[10px] text-[10px] tracking-[.12em] uppercase text-risco/80 font-semibold first:pt-0'
</script>

<template>
  <aside class="flex flex-col bg-graphite text-line h-full w-60">

    <!-- Brand -->
    <div class="h-14 flex items-center gap-[9px] px-[18px] border-b border-white/[.06] flex-shrink-0">
      <span class="w-[22px] h-[22px] flex-shrink-0 border-2 border-bronze rounded-[3px] relative">
        <span class="absolute inset-x-[4px] top-[4px] h-[2px] bg-bronze block"></span>
      </span>
      <b class="font-display font-semibold text-[16px] tracking-[-0.01em] text-white">AudiSped</b>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-[8px]">

      <!-- CARTEIRA -->
      <div :class="grupo">Carteira</div>
      <RouterLink to="/" @click="nav" :class="linkBase" exact-active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze">
        <Building2 :size="15" :stroke-width="1.6" />
        Empresas
      </RouterLink>
      <RouterLink v-if="empresaSelecionada" :to="`/dashboard/${empresaSelecionada.id}`" @click="nav" :class="linkBase" :active-class="linkActive">
        <LayoutDashboard :size="15" :stroke-width="1.6" />
        Hub do Cliente
      </RouterLink>
      <RouterLink v-if="empresaSelecionada" :to="`/empresa/${empresaSelecionada.id}`" @click="nav" :class="linkBase" :active-class="linkActive">
        <DatabaseZap :size="15" :stroke-width="1.6" />
        Gestão de Arquivos
      </RouterLink>

      <!-- CONFERIR -->
      <div :class="grupo">Conferir</div>
      <RouterLink to="/analisador" @click="nav" :class="linkBase" :active-class="linkActive">
        <BarChart2 :size="15" :stroke-width="1.6" />
        Analisador
      </RouterLink>
      <RouterLink to="/validador" @click="nav" :class="linkBase" :active-class="linkActive">
        <ShieldCheck :size="15" :stroke-width="1.6" />
        Validador
      </RouterLink>
      <RouterLink v-if="arquivoInfo" :to="`/rentabilidade/${arquivoInfo.id}`" @click="nav" :class="linkBase" :active-class="linkActive">
        <TrendingUp :size="15" :stroke-width="1.6" />
        Posição de Estoque
      </RouterLink>
      <div v-else :class="linkDisabled" title="Carregue um SPED no Hub do Cliente.">
        <TrendingUp :size="15" :stroke-width="1.6" />
        Posição de Estoque
      </div>
      <RouterLink to="/catalogo-regras" @click="nav" :class="linkBase" :active-class="linkActive">
        <BookOpen :size="15" :stroke-width="1.6" />
        Catálogo de Regras
      </RouterLink>

      <!-- CORRIGIR -->
      <div :class="grupo">Corrigir</div>
      <RouterLink to="/injetor-xml" @click="nav" :class="linkBase" :active-class="linkActive">
        <Upload :size="15" :stroke-width="1.6" />
        Injetor XML
      </RouterLink>
      <RouterLink to="/injetor-cte" @click="nav" :class="linkBase" :active-class="linkActive">
        <Truck :size="15" :stroke-width="1.6" />
        Injetor CTe
      </RouterLink>
      <RouterLink to="/de-para" @click="nav" :class="linkBase" :active-class="linkActive">
        <ArrowLeftRight :size="15" :stroke-width="1.6" />
        De-Para XML
      </RouterLink>
      <RouterLink to="/regras-fiscais" @click="nav" :class="linkBase" :active-class="linkActive">
        <Settings2 :size="15" :stroke-width="1.6" />
        Regras Fiscais
      </RouterLink>
      <RouterLink to="/cfops" @click="nav" :class="linkBase" :active-class="linkActive">
        <Tag :size="15" :stroke-width="1.6" />
        Cadastro de CFOPs
      </RouterLink>

      <!-- LMC & ENVIO -->
      <div :class="grupo">LMC &amp; Envio</div>
      <RouterLink v-if="arquivoInfo" :to="`/lmc/${arquivoInfo.id}`" @click="nav" :class="linkBase" :active-class="linkActive">
        <FileText :size="15" :stroke-width="1.6" />
        Livro LMC
      </RouterLink>
      <div v-else :class="linkDisabled" title="Carregue um SPED no Hub do Cliente.">
        <FileText :size="15" :stroke-width="1.6" />
        Livro LMC
      </div>
      <RouterLink to="/impressao-lmc" @click="nav" :class="linkBase" :active-class="linkActive">
        <Printer :size="15" :stroke-width="1.6" />
        Impressão LMC
      </RouterLink>
      <RouterLink to="/mde" @click="nav" :class="linkBase" :active-class="linkActive">
        <Mail :size="15" :stroke-width="1.6" />
        Manifesto NFe
      </RouterLink>

    </nav>

    <!-- Cliente Ativo (clicável → troca de empresa) -->
    <RouterLink
      to="/"
      @click="nav"
      class="block mx-[10px] mb-[10px] p-[10px] border border-white/[.08] rounded-[var(--radius)] bg-white/[.02] flex-shrink-0 no-underline hover:border-bronze/40 hover:bg-white/[.04] transition-colors group"
    >
      <div class="flex items-center justify-between mb-[3px]">
        <span class="text-[9px] tracking-[.10em] uppercase text-risco font-semibold">
          {{ empresaSelecionada ? 'Cliente Ativo' : 'Carteira' }}
        </span>
        <span class="flex items-center gap-[3px] text-[10px] text-muted group-hover:text-bronze transition-colors">
          <ArrowLeftRight :size="11" :stroke-width="1.8" /> trocar
        </span>
      </div>
      <template v-if="empresaSelecionada">
        <div class="font-display text-[13px] font-medium text-white truncate">
          {{ empresaSelecionada.nome_empresa || empresaSelecionada.razao_social || 'Empresa' }}
        </div>
        <div class="font-mono text-[11px] text-muted mt-[2px] truncate">
          {{ formatCnpj(empresaSelecionada.cnpj) }}
        </div>
      </template>
      <template v-else>
        <div class="text-[12px] text-muted">Selecionar empresa</div>
      </template>
    </RouterLink>

    <!-- Footer: user + logout -->
    <div class="flex items-center gap-2 px-3 pb-3 border-t border-white/[.06] pt-2 flex-shrink-0">
      <RouterLink to="/perfil" @click="nav" class="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity">
        <User :size="14" class="text-risco flex-shrink-0" :stroke-width="1.6" />
        <span class="text-[12px] text-muted truncate">{{ usuario?.nome || 'Usuario' }}</span>
      </RouterLink>
      <button
        @click="handleLogout"
        class="p-1.5 text-risco hover:text-white transition-colors bg-transparent border-0 cursor-pointer"
        title="Sair"
      >
        <LogOut :size="14" :stroke-width="1.6" />
      </button>
    </div>

  </aside>
</template>
