<script setup>
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { empresaSelecionada, arquivoInfo, token, usuario, logout } from './store'
import {
  Building2,
  LogOut,
  LayoutDashboard,
  HardDriveUpload,
  Settings2,
  FileText,
  DatabaseZap,
  ArrowLeft,
  TrendingUp,
  User,
  Search,
  Tag,
  Truck,
  Printer
} from 'lucide-vue-next'

const router = useRouter();

const handleLogout = () => {
  logout();
  router.push('/login');
};
</script>

<template>
  <div class="flex h-screen bg-brand-surface font-sans text-slate-900 overflow-hidden">
    
    <!-- Sidebar B2B Corporate (Naval) -->
    <aside v-if="token" class="w-60 bg-naval text-white flex flex-col shadow-2xl z-20 shrink-0">

      <!-- Top Header / Logo -->
      <div class="h-11 px-4 flex items-center border-b border-white/5">
        <h1 class="text-base font-semibold tracking-tight text-white flex items-center gap-2">
          <div class="w-5 h-5 bg-brand-accent rounded flex items-center justify-center">
            <span class="text-[10px] font-bold leading-none">A</span>
          </div>
          Audi<span class="text-white/60">Sped</span>
        </h1>
      </div>

      <!-- User Profile (Slim) -->
      <div class="px-4 py-2 border-b border-white/5 flex items-center justify-between">
        <RouterLink to="/perfil" class="flex flex-col overflow-hidden hover:opacity-80 transition-opacity" title="Meus Dados">
          <span class="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">Auditor</span>
          <span class="text-xs font-medium text-slate-300 truncate">{{ usuario?.nome || 'Usuário' }}</span>
        </RouterLink>
        <button @click="handleLogout" class="p-1.5 text-slate-500 hover:text-white transition-colors" title="Sair">
          <LogOut class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Context Header -->
      <div class="px-3 py-2 border-b border-white/5">
        <div v-if="empresaSelecionada" class="bg-white/5 rounded-md border border-white/10 px-3 py-2">
          <div class="flex items-center gap-1.5 mb-1">
            <Building2 class="w-3 h-3 text-brand-accent shrink-0" />
            <span class="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Cliente Ativo</span>
          </div>
          <p class="text-xs font-medium text-white leading-tight truncate">{{ empresaSelecionada.nome_empresa }}</p>
          <RouterLink to="/" class="mt-1.5 flex items-center gap-1 text-[10px] text-brand-accent hover:text-blue-400 font-medium transition-colors">
            <ArrowLeft class="w-2.5 h-2.5" />
            Trocar Cliente
          </RouterLink>
        </div>
        <div v-else>
          <RouterLink to="/" class="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white transition-colors py-1.5 rounded-md">
            <Building2 class="w-3.5 h-3.5 text-brand-accent" />
            Gestor de Clientes
          </RouterLink>
        </div>
      </div>

      <!-- Navigation Hub -->
      <nav v-if="empresaSelecionada" class="flex-1 px-3 overflow-y-auto custom-scrollbar py-2">
        <p class="px-2 text-[9px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Módulos</p>

        <RouterLink :to="`/dashboard/${empresaSelecionada.id}`"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          exact-active-class="bg-brand-accent/10 text-brand-accent"
        >
          <LayoutDashboard class="w-3.5 h-3.5 shrink-0" />
          Hub Central
        </RouterLink>

        <RouterLink to="/injetor-xml"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <HardDriveUpload class="w-3.5 h-3.5 shrink-0" />
          Injetor de XMLs
        </RouterLink>

        <RouterLink to="/injetor-cte"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <Truck class="w-3.5 h-3.5 shrink-0" />
          Injetor CT-e
        </RouterLink>

        <RouterLink to="/de-para"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <DatabaseZap class="w-3.5 h-3.5 shrink-0" />
          De-Para (XML)
        </RouterLink>

        <RouterLink to="/cfops"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <Tag class="w-3.5 h-3.5 shrink-0" />
          Cadastro de CFOPs
        </RouterLink>

        <RouterLink to="/mde"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <Search class="w-3.5 h-3.5 shrink-0" />
          Manifesto (NFe)
        </RouterLink>

        <RouterLink to="/analisador"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <Settings2 class="w-3.5 h-3.5 shrink-0" />
          Auditoria (Motor)
        </RouterLink>

        <RouterLink v-if="arquivoInfo" :to="`/lmc/${arquivoInfo.id}`"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <FileText class="w-3.5 h-3.5 shrink-0" />
          Livro LMC
        </RouterLink>
        <div v-else class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium text-slate-600 cursor-not-allowed opacity-40" title="Carregue um SPED no Hub Central.">
          <FileText class="w-3.5 h-3.5 shrink-0" />
          Livro LMC
        </div>

        <RouterLink to="/impressao-lmc"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <Printer class="w-3.5 h-3.5 shrink-0" />
          Impressão LMC
        </RouterLink>

        <RouterLink v-if="arquivoInfo" :to="`/rentabilidade/${arquivoInfo.id}`"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <TrendingUp class="w-3.5 h-3.5 shrink-0" />
          Posição de Estoque
        </RouterLink>
        <div v-else class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium text-slate-600 cursor-not-allowed opacity-40" title="Carregue um SPED no Hub Central.">
          <TrendingUp class="w-3.5 h-3.5 shrink-0" />
          Posição de Estoque
        </div>

        <RouterLink :to="`/empresa/${empresaSelecionada.id}`"
          class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <DatabaseZap class="w-3.5 h-3.5 shrink-0" />
          Gestão de Arquivos
        </RouterLink>

        <div class="mt-2 pt-2 border-t border-white/5">
          <RouterLink to="/perfil"
            class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all text-slate-400 hover:bg-white/5 hover:text-white"
            active-class="bg-brand-accent/10 text-brand-accent"
          >
            <User class="w-3.5 h-3.5 shrink-0" />
            Meu Perfil
          </RouterLink>
        </div>
      </nav>

      <!-- Footer Info -->
      <div v-if="arquivoInfo" class="px-4 py-2.5 border-t border-white/5 bg-black/10">
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
          <span class="text-[9px] font-bold text-slate-400 tracking-widest uppercase">SPED em Memória</span>
        </div>
        <p class="text-[11px] font-medium text-slate-200 truncate">{{ arquivoInfo.nome }}</p>
        <p class="text-[10px] text-slate-500 font-mono">{{ arquivoInfo.periodo }}</p>
      </div>
    </aside>
    
    <!-- Área Principal de Conteúdo -->
    <main class="flex-1 min-w-0 h-screen overflow-y-auto overflow-x-hidden bg-brand-surface relative z-10 custom-scrollbar-light">
      <div class="w-full max-w-full px-5 py-6">
        <RouterView />
      </div>
    </main>
  </div>
</template>

<style>
/* CSS Resets B2B Base */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scrollbars discretas para UX Limpa */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(255,255,255,0.1);
  border-radius: 10px;
}
.custom-scrollbar-light::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar-light::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar-light::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 10px;
}
.custom-scrollbar-light::-webkit-scrollbar-thumb:hover {
  background-color: #94a3b8;
}

/* Transições de Rota mais Sólidas (Sem pulos malucos) */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease-out;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
