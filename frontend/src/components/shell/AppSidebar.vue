<script setup>
import { RouterLink } from 'vue-router'
import {
  BarChart2,
  ShieldCheck,
  GitCompare,
  BookOpen,
  Upload,
  Truck,
  Settings2,
  ArrowLeftRight,
  Printer,
  Download,
  Mail,
  LogOut,
  User
} from 'lucide-vue-next'
import { empresaSelecionada, arquivoInfo, usuario, logout } from '@/store'
import { useRouter } from 'vue-router'

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

// Derive competência from arquivoInfo
function competencia() {
  if (!arquivoInfo.value) return null
  const a = arquivoInfo.value
  // competencia stored as YYYY-MM or MM/YYYY or from dt_ini
  if (a.competencia) return a.competencia
  if (a.periodo) return a.periodo
  if (a.dt_ini) {
    // dt_ini format DDMMYYYY
    const s = String(a.dt_ini)
    if (s.length === 8) return s.slice(2, 4) + '/' + s.slice(4)
    return s
  }
  return null
}

function layoutVer() {
  if (!arquivoInfo.value) return null
  return arquivoInfo.value.cod_ver || arquivoInfo.value.versao || null
}

function formatCnpj(cnpj) {
  if (!cnpj) return ''
  const c = String(cnpj).replace(/\D/g, '')
  if (c.length !== 14) return cnpj
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}
</script>

<template>
  <aside class="flex flex-col bg-graphite text-[#E7EAED] h-full w-60">

    <!-- Brand -->
    <div class="h-14 flex items-center gap-[9px] px-[18px] border-b border-white/[.06] flex-shrink-0">
      <!-- bronze square mark -->
      <span class="w-[22px] h-[22px] flex-shrink-0 border-2 border-bronze rounded-[3px] relative">
        <span class="absolute inset-x-[4px] top-[4px] h-[2px] bg-bronze block"></span>
      </span>
      <b class="font-display font-semibold text-[16px] tracking-[-0.01em] text-white">AudiSped</b>
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto py-[14px]">

      <!-- CONFERIR -->
      <div class="px-[18px] pb-[6px] pt-[14px] text-[11px] tracking-[.10em] uppercase text-[#5C6770] font-semibold first:pt-0">
        Conferir
      </div>
      <RouterLink
        to="/analisador"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <BarChart2 :size="15" :stroke-width="1.6" />
        Analisador
      </RouterLink>
      <RouterLink
        to="/validador"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <ShieldCheck :size="15" :stroke-width="1.6" />
        Validador
      </RouterLink>
      <RouterLink
        to="/catalogo-regras"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <BookOpen :size="15" :stroke-width="1.6" />
        Catalogo de Regras
      </RouterLink>
      <RouterLink
        to="/xml-tributacao"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <GitCompare :size="15" :stroke-width="1.6" />
        Conciliacao XML
      </RouterLink>

      <!-- CORRIGIR -->
      <div class="px-[18px] pb-[6px] pt-[14px] text-[11px] tracking-[.10em] uppercase text-[#5C6770] font-semibold">
        Corrigir
      </div>
      <RouterLink
        to="/injetor-xml"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <Upload :size="15" :stroke-width="1.6" />
        Injetor XML
      </RouterLink>
      <RouterLink
        to="/injetor-cte"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <Truck :size="15" :stroke-width="1.6" />
        Injetor CTe
      </RouterLink>
      <RouterLink
        to="/regras-fiscais"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <Settings2 :size="15" :stroke-width="1.6" />
        Regras Fiscais
      </RouterLink>
      <RouterLink
        to="/de-para"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <ArrowLeftRight :size="15" :stroke-width="1.6" />
        De-Para XML
      </RouterLink>
      <RouterLink
        to="/impressao-lmc"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <Printer :size="15" :stroke-width="1.6" />
        Impressao LMC
      </RouterLink>

      <!-- TRANSMITIR -->
      <div class="px-[18px] pb-[6px] pt-[14px] text-[11px] tracking-[.10em] uppercase text-[#5C6770] font-semibold">
        Transmitir
      </div>
      <RouterLink
        to="/mde"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <Mail :size="15" :stroke-width="1.6" />
        MDe
      </RouterLink>
      <RouterLink
        to="/"
        @click="nav"
        class="flex items-center gap-[10px] px-[18px] py-[7px] text-[14px] text-[#AEB6BD] no-underline border-l-2 border-transparent hover:text-white hover:bg-graphite-2"
        active-class="!text-white !bg-bronze/10 !border-l-bronze font-medium [&_svg]:text-bronze"
      >
        <Download :size="15" :stroke-width="1.6" />
        Exportar SPED
      </RouterLink>

    </nav>

    <!-- Cliente Ativo -->
    <div class="mx-3 mb-3 p-3 border border-white/[.08] rounded-[var(--radius)] bg-white/[.02] flex-shrink-0">
      <template v-if="empresaSelecionada">
        <div class="font-display text-[13px] font-medium text-white truncate">
          {{ empresaSelecionada.nome_empresa || empresaSelecionada.razao_social || 'Empresa' }}
        </div>
        <div class="font-mono text-[11px] text-[#7E8890] mt-[3px]">
          {{ formatCnpj(empresaSelecionada.cnpj) }}
        </div>
        <div v-if="competencia() || layoutVer()" class="font-mono text-[11px] text-[#7E8890] mt-[1px]">
          <template v-if="competencia()">Competencia {{ competencia() }}</template>
          <template v-if="competencia() && layoutVer()"> · </template>
          <template v-if="layoutVer()">leiaute {{ layoutVer() }}</template>
        </div>
      </template>
      <template v-else>
        <div class="text-[12px] text-[#5C6770]">Nenhuma empresa aberta</div>
      </template>
    </div>

    <!-- Footer: user + logout -->
    <div class="flex items-center gap-2 px-3 pb-3 border-t border-white/[.06] pt-2 flex-shrink-0">
      <RouterLink to="/perfil" @click="nav" class="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity">
        <User :size="14" class="text-[#5C6770] flex-shrink-0" :stroke-width="1.6" />
        <span class="text-[12px] text-[#AEB6BD] truncate">{{ usuario?.nome || 'Usuario' }}</span>
      </RouterLink>
      <button
        @click="handleLogout"
        class="p-1.5 text-[#5C6770] hover:text-white transition-colors bg-transparent border-0 cursor-pointer"
        title="Sair"
      >
        <LogOut :size="14" :stroke-width="1.6" />
      </button>
    </div>

  </aside>
</template>
