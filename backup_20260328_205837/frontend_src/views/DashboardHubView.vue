<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { empresaSelecionada, arquivoInfo } from '../store';
import { 
  FileText, 
  Settings2, 
  DatabaseZap, 
  HardDriveUpload,
  ChevronRight
} from 'lucide-vue-next';

const router = useRouter();

// Se não tem empresa na store, volta pra home
if (!empresaSelecionada.value) {
  router.push('/');
}

const modulos = [
  {
    id: 'injetor',
    name: 'Injetor de XMLs',
    description: 'Adicione ou substitua Notas Fiscais diretamente no arquivo SPED Fiscal retificado.',
    icon: HardDriveUpload,
    route: '/injetor-xml',
    active: true,
    tag: 'Operacional'
  },
  {
    id: 'lmc',
    name: 'Livro LMC',
    description: 'Gere o Livro de Movimentação de Combustíveis com base nas leituras de bombas do SPED.',
    icon: FileText,
    route: arquivoInfo.value ? `/lmc/${arquivoInfo.value.id}` : '#',
    active: !!arquivoInfo.value,
    tag: 'Obrigação',
    warning: !arquivoInfo.value ? 'Requer SPED carregado' : null
  },
  {
    id: 'motor',
    name: 'Auditoria Avançada',
    description: 'Cruze dados de entrada, saída, CSTs e alíquotas para identificar inconsistências.',
    icon: Settings2,
    route: '/analisador',
    active: true,
    tag: 'Análise'
  },
  {
    id: 'arquivos',
    name: 'Gestão de SPEDs',
    description: 'Histórico de arquivos processados, originais e relatórios gerados desta empresa.',
    icon: DatabaseZap,
    route: `/empresa/${empresaSelecionada.value?.id}`,
    active: true,
    tag: 'Repositório'
  }
];

const navigateTo = (modulo) => {
  if (modulo.active && modulo.route !== '#') {
    router.push(modulo.route);
  }
};
</script>

<template>
  <div v-if="empresaSelecionada" class="max-w-6xl mx-auto w-full flex flex-col gap-8 fade-in">
    
    <!-- Cabeçalho do Cliente -->
    <div class="flex flex-col gap-1 border-b border-slate-200 pb-6">
      <div class="flex items-center gap-2 text-sm text-slate-500 font-medium mb-1">
        <span>Clientes</span>
        <ChevronRight class="w-4 h-4 text-slate-300" />
        <span class="text-slate-900">{{ empresaSelecionada.nome_empresa }}</span>
      </div>
      <h1 class="text-3xl font-semibold text-slate-900 tracking-tight">Hub de Operações</h1>
      <p class="text-slate-500 text-sm">Selecione o módulo para iniciar a tarefa com o cliente {{ empresaSelecionada.cnpj }}.</p>
    </div>

    <!-- Grid de Módulos (The Spokes) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      
      <div 
        v-for="mod in modulos" 
        :key="mod.id"
        @click="navigateTo(mod)"
        :class="[
          'relative p-6 rounded-xl border transition-all duration-200 flex flex-col gap-4',
          mod.active 
            ? 'bg-white border-slate-200 hover:border-blue-600/30 hover:shadow-sm cursor-pointer group' 
            : 'bg-slate-50 border-slate-100 opacity-60 cursor-not-allowed'
        ]"
      >
        <!-- Ícone e Tag -->
        <div class="flex items-start justify-between">
          <div :class="[
            'p-3 rounded-lg border',
            mod.active ? 'bg-slate-50 border-slate-100 text-slate-700 group-hover:text-blue-600 group-hover:bg-blue-50 group-hover:border-blue-100 transition-colors' : 'bg-slate-100 border-transparent text-slate-400'
          ]">
            <component :is="mod.icon" class="w-6 h-6 stroke-[1.5]" />
          </div>
          
          <span class="text-[10px] font-semibold tracking-wider uppercase px-2 py-1 rounded bg-slate-100 text-slate-500">
            {{ mod.tag }}
          </span>
        </div>

        <!-- Textos -->
        <div class="flex flex-col gap-1.5 mt-2">
          <h2 class="text-lg font-semibold text-slate-900">{{ mod.name }}</h2>
          <p class="text-sm text-slate-500 leading-relaxed">{{ mod.description }}</p>
        </div>
        
        <!-- Warning / Action -->
        <div class="mt-auto pt-4 flex items-center justify-between border-t border-slate-100">
          <span v-if="mod.warning" class="text-xs font-medium text-amber-600 flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            {{ mod.warning }}
          </span>
          <span v-else-if="mod.active" class="text-xs font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            Acessar Módulo
            <ChevronRight class="w-3 h-3" />
          </span>
        </div>

      </div>

    </div>

  </div>
</template>

<style scoped>
.fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
