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
  ArrowLeft
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
    <aside v-if="token" class="w-72 bg-naval text-white flex flex-col shadow-2xl z-20 shrink-0">
      
      <!-- Top Header / Logo -->
      <div class="h-16 px-6 flex items-center border-b border-white/5">
        <h1 class="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
          <div class="w-6 h-6 bg-brand-accent rounded flex items-center justify-center">
            <span class="text-xs font-bold leading-none">A</span>
          </div>
          Audi<span class="text-white/60">Sped</span>
        </h1>
      </div>
      
      <!-- User Profile (Slim) -->
      <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between group">
        <div class="flex flex-col overflow-hidden">
          <span class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">Auditor</span>
          <span class="text-sm font-medium text-slate-300 truncate">{{ usuario?.nome || 'Usuário' }}</span>
        </div>
        <button @click="handleLogout" class="p-2 -mr-2 text-slate-500 hover:text-white transition-colors" title="Sair do Sistema">
          <LogOut class="w-4 h-4" />
        </button>
      </div>

      <!-- Context Header (Qual cliente está ativo?) -->
      <div class="px-4 py-6">
        <div v-if="empresaSelecionada" class="bg-white/5 rounded-lg border border-white/10 p-4 transition-all">
          <div class="flex items-center gap-2 mb-3">
            <Building2 class="w-4 h-4 text-brand-accent" />
            <span class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Cliente Ativo</span>
          </div>
          <p class="text-sm font-medium text-white leading-tight break-words">{{ empresaSelecionada.nome_empresa }}</p>
          <p class="text-[11px] text-slate-400 mt-1 font-mono">{{ empresaSelecionada.cnpj }}</p>
          
          <RouterLink to="/" class="mt-4 flex items-center gap-1.5 text-xs text-brand-accent hover:text-blue-400 font-medium transition-colors">
            <ArrowLeft class="w-3 h-3" />
            Trocar Cliente
          </RouterLink>
        </div>
        <div v-else class="px-2">
          <RouterLink to="/" class="flex items-center gap-3 text-sm font-medium text-slate-300 hover:text-white transition-colors py-2 rounded-md">
            <Building2 class="w-4 h-4 text-brand-accent" />
            Gestor de Clientes
          </RouterLink>
        </div>
      </div>
      
      <!-- Navigation Hub -->
      <nav v-if="empresaSelecionada" class="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar pb-6">
        <h3 class="px-3 text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3 mt-2">Módulos de Auditoria</h3>
        
        <RouterLink :to="`/dashboard/${empresaSelecionada.id}`" 
          class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group text-slate-400 hover:bg-white/5 hover:text-white"
          exact-active-class="bg-brand-accent/10 text-brand-accent"
        >
          <LayoutDashboard class="w-4 h-4" />
          Hub Central
        </RouterLink>

        <RouterLink to="/injetor-xml" 
          class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group mt-1 text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <HardDriveUpload class="w-4 h-4" />
          Injetor de XMLs
        </RouterLink>

        <RouterLink to="/analisador" 
          class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group mt-1 text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <Settings2 class="w-4 h-4" />
          Auditoria (Motor)
        </RouterLink>

        <RouterLink v-if="arquivoInfo" :to="`/lmc/${arquivoInfo.id}`" 
          class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group mt-1 text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <FileText class="w-4 h-4" />
          Livro LMC
        </RouterLink>
        <div v-else class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-slate-600 cursor-not-allowed mt-1 opacity-50" title="Carregue um SPED no Hub Central para habilitar o LMC.">
          <FileText class="w-4 h-4" />
          Livro LMC
        </div>

        <RouterLink :to="`/empresa/${empresaSelecionada.id}`" 
          class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group mt-1 text-slate-400 hover:bg-white/5 hover:text-white"
          active-class="bg-brand-accent/10 text-brand-accent"
        >
          <DatabaseZap class="w-4 h-4" />
          Gestão de Arquivos
        </RouterLink>
      </nav>
      
      <!-- Footer Info -->
      <div v-if="arquivoInfo" class="mt-auto px-6 py-4 border-t border-white/5 bg-black/10">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span class="text-[9px] font-bold text-slate-400 tracking-widest uppercase">SPED em Memória</span>
        </div>
        <p class="text-xs font-medium text-slate-200 truncate leading-snug">{{ arquivoInfo.nome }}</p>
        <p class="text-[10px] text-slate-500 font-mono mt-0.5">{{ arquivoInfo.periodo }}</p>
      </div>
    </aside>
    
    <!-- Área Principal de Conteúdo -->
    <main class="flex-1 h-screen overflow-y-auto bg-brand-surface relative z-10 custom-scrollbar-light">
      <div class="max-w-7xl mx-auto w-full p-8 lg:p-10">
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
