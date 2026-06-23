<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { empresaSelecionada, arquivoInfo } from '../store';
import { formatCnpj } from '@/utils/sped';
import UiSelo from '../components/ui/UiSelo.vue';
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
  <div v-if="empresaSelecionada" class="max-w-6xl mx-auto w-full py-8 px-4 sm:px-6 flex flex-col gap-6 fade-in">

    <!-- Cabeçalho do Cliente -->
    <div class="flex flex-col gap-1 border-b border-line pb-5">
      <div class="flex items-center gap-1.5 text-[12px] text-risco mb-1">
        <span>Clientes</span>
        <ChevronRight class="w-3.5 h-3.5 text-line" />
        <span class="text-ink font-medium truncate">{{ empresaSelecionada.nome_empresa }}</span>
      </div>
      <h1 class="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">Hub de Operações</h1>
      <p class="text-[13px] text-risco">
        Selecione o módulo para iniciar a tarefa — <span class="font-mono text-ink">{{ formatCnpj(empresaSelecionada.cnpj) }}</span>.
      </p>
    </div>

    <!-- Grid de Módulos (The Spokes) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">

      <div
        v-for="mod in modulos"
        :key="mod.id"
        @click="navigateTo(mod)"
        :class="[
          'relative p-5 rounded-md border transition-all duration-200 flex flex-col gap-4',
          mod.active
            ? 'bg-sheet border-line hover:border-bronze/40 hover:shadow-[0_1px_4px_0_rgba(18,24,32,0.07)] cursor-pointer group'
            : 'bg-paper border-line opacity-60 cursor-not-allowed'
        ]"
      >
        <!-- Ícone e Tag -->
        <div class="flex items-start justify-between">
          <div :class="[
            'p-2.5 rounded-md border',
            mod.active
              ? 'bg-paper border-line text-risco group-hover:text-bronze group-hover:border-bronze/30 transition-colors'
              : 'bg-line/40 border-transparent text-risco'
          ]">
            <component :is="mod.icon" class="w-5 h-5" :stroke-width="1.6" />
          </div>
          <UiSelo :tipo="mod.tag" />
        </div>

        <!-- Textos -->
        <div class="flex flex-col gap-1">
          <h2 class="font-display text-[16px] font-semibold text-ink">{{ mod.name }}</h2>
          <p class="text-[13px] text-risco leading-relaxed">{{ mod.description }}</p>
        </div>

        <!-- Warning / Action -->
        <div class="mt-auto pt-3.5 flex items-center justify-between border-t border-line">
          <span v-if="mod.warning" class="text-[12px] font-medium text-variacao flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-variacao"></span>
            {{ mod.warning }}
          </span>
          <span v-else-if="mod.active" class="text-[12px] font-medium text-bronze opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            Acessar Módulo
            <ChevronRight class="w-3.5 h-3.5" :stroke-width="1.8" />
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
